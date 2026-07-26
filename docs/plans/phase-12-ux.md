# Phase 12 — Living-world surfacing & UX polish

**Status:** planned, not started. **Audience:** an implementer with no prior context on this session.
This doc is self-contained — read the *Orientation* section first, then build the sub-steps in order.

Phase 9 added a lot the GM cannot **see**: faction turns, auto-emergence, rebellions, lord awakenings,
and wilderness encounters all narrate to the browser **console** (the on-screen event log was retired
before Phase 9, so `logLine` now only `console.log`s — see `js/ui/panel.js:54`). This phase surfaces
that world on-screen and cleans up the panels touched along the way.

> **Design loop (every sub-step):** implement → `node --test test/*.test.js` stays green → commit with
> a clear message → hand the user a short **manual checklist** (canvas/DOM/IndexedDB aren't
> node-tested). One coherent sub-step per commit.

---

## Orientation — what an implementer must know first

**Run/test.** `./run-local.sh` (fetches branch, runs `node --test`, serves on :8000) or
`python3 -m http.server 8000`. Tests: `node --test test/*.test.js`. Vanilla ES modules, **no build
step**, must be served over HTTP (never `file://`). Node 22+.

**Golden rule for this whole project right now (user-set):** *no backward compatibility, no data
migration.* Additive world fields go straight into `createWorld` (`js/world/world.js`) with
guard-on-read (`world.x || []`); do **not** bump `SCHEMA_VERSION` or add `migrateWorld` branches for
additive fields. Old saves may be discarded.

**Conventions:**
- **Seeded RNG.** `subRng(worldSeed, ...parts)` (`js/core/rng.js`) → a `mulberry32` stream. Same parts
  ⇒ same stream. `randInt(rng,min,max)`, `pick(rng,arr)`. World generation is reproducible from
  `world.seed`.
- **Weighted tables.** JSON in `/data`, shape `{ id, title, entries:[{weight?,value,roll?}] }`.
  `rollTable(table, rng, {resolve})` (`js/core/table.js`); `loadTables(ids)` (`js/core/loader.js`,
  cached). `validateTable` throws on bad shape.
- **Compose-at-render.** Generators return a **structured pick**; prose is built at render (e.g.
  `oracleLine`, `factionDescription`, `treasureLine`). Store the pick, not the sentence.
- **Interior build-stamps.** Dungeon/tower interiors self-heal: bump `DUNGEON_BUILD`
  (`js/gen/dungeon.js`) / `TOWER_BUILD` (`js/gen/tower.js`) to force regeneration on next open (no
  world migration). Not needed this phase unless you change interior shape.
- **`logLine(text)` is console-only** (`js/ui/panel.js:54`). 12.2 introduces the on-screen channel.
- **`sessionDay`** (`js/ui/app.js:153`) is a **session-only** counter (0 at load), never persisted.
  Anything persisted must not rely on it staying monotonic across reloads.

**Architecture (as built):**
- `index.html` — shell. `#stage` holds the map canvas `#map` and its overlays: `#map-empty`,
  `#map-readout`/`#readout-cell` (bottom-left hover text), `#map-scale` (top-left), `#travel-tip`,
  `#hud-stack` (travel HUD), `#legend` (with `#legend-terrain`, `#legend-poi`, `#legend-factions`),
  `#help-overlay`. The side panel is `<aside id="panel">` (built entirely in JS).
- `js/ui/app.js` — bootstrap + all wiring; owns `current` (the world), `selected` (`{q,r}|null`),
  `sessionDay`, oracle state, faction handlers, travel. Persistence via `persistAndRefresh()`
  (`app.js:2367` → `saveWorld` + a fan-out of refreshers).
- `js/ui/panel.js` — side-panel rendering. **Tabs** live in `TAB_REGIONS` (`panel.js:16`), built in
  `showWorld()` (`panel.js:901`) via a local `mkTab(key,label,badgeId?)` + `region(id,hidden)`;
  `setPanelTab(key)` (`panel.js:36`) toggles `hidden` on regions. Render fns per surface:
  `renderSelectionPanel` (707), `renderDungeonPanel` (792), `renderGlobalHooks` (407),
  `renderFactionsPanel` (501) + `factionCard` (427), `renderOraclePanel` (543) + `appendOracleResult`
  (635). Helpers: `actionButton` (88), `sectionLabel` (245), `setTabBadge` (374).
- `js/ui/map.js` — canvas renderer. `render()` (194) draws in order: terrain → overlays → hover
  outline+label (`~308-330`) → selection → hooks → `drawTravelPath()` (1110) → `drawEncounterMarks()`
  (1146) → party. State setters: `setWorld`, `setSelected`, `setTravelPath`, `setEncounterMarks` (101),
  `setHookMarks`, `setHookFocus`, `setFactionHighlight` (978). `hovered` (`{q,r}|null`, line 52).
  `recenterOn(q,r)` (112). Helpers used in hover: `factionAt(q,r)`, `regionNameAt(q,r)`, `drawHexLabel`.
- `js/gen/` — pure generators: `oracle.js` (Phase 9 oracles), `factions.js` (faction engine +
  emergence), `dungeon.js`/`tower.js`, `hooks.js`, `settlement-name.js`, etc.

**Data model (relevant bits):**
- World: `{ schemaVersion, id, name, seed, hexScale, hexes:{}, hooks:[], rivers:[], roads:[],
  party:{q,r}, factions:[], emergeTicks, emergeSince, createdAt, updatedAt }`. **12.2 adds
  `chronicle:[]`.**
- Hex (`hexes["q,r"]`): `{ key, coords:{q,r}, placed, terrain, terrainFeature, settlement, pois:[],
  explored, gen, name?, note?, locked? }`.
- `settlement`: `{present:false}` or `{present:true, size, kind?, waterBoost?}` (size ∈ Hamlet/
  Village/Town/City). **12.4 adds `taverns:[{sign,specialty,quirk}]`.**
- POI: `{ id:"poi:<n>", type, name, occupant, detail }`; occupant ∈ `{kind:"lair",creature}` |
  `{kind:"occupied",by,factionId?}` | `{kind:"none"}`. Dungeon/tower rooms carry
  `treasure:{type,guard}|null` (9.8).
- Faction (`world.factions[]`): `{ id:"faction:<n>", build, name, archetype, disposition,
  goal:{kind,progress,max}, strength, holdings:[{q,r,poiId?}], seat:{q,r,poiId?}|null,
  clock:{turns,sinceTurn}, origin, status, kind? }`.

**Oracle system (Phase 9, for 12.4/12.7 context):** `js/gen/oracle.js` exports `askYesNo`,
`rollMeaning`, `rollComplication`, `rollSettlement`, `rollTavern`, `rollEncounterCheck`, `oracleLine`,
`ORACLE_LABELS`, `ORACLE_ODDS`, `ORACLE_TABLE_IDS`, `ENCOUNTER_CHANCE`. The Oracle tab
(`renderOraclePanel`) has sections Yes/No · Meaning · Complication · Settlement · Tavern, each with a
per-kind result block via `appendOracleResult(host,result,flash)` where `result = {tag,line,body?,note?}`.
Roll handler `onOracleRoll(kind, odds)` (`app.js:1758`) keeps the latest result per kind in the
in-memory `oracleResults` map (transient, never persisted — the user wants no oracle history).
`rollTavern(tables,rng)` → `{kind:"tavern",sign,specialty,quirk}` (tables: `tavern-sign/-specialty/
-quirk`, in `ORACLE_TABLE_IDS`).

**Faction emergence (Phase 9.9, for 12.1/12.2/12.6 context):** `js/gen/factions.js` `rollEmergences
(world,days,seed)` (pure gate, pressure model) returns descriptors `{type:"external"|"internal"|
"lord",...}`; `app.js` `maybeEmergeFactions(days)` (called from `advanceTime`) creates each via
`emergeExternal`/`emergeRebellion`/`emergeLord` and emits `{kind:"emerge",...}` FactionEvents.
`logFactionEvents(events)` (`app.js:581`) narrates every faction event (claim/takeover/relocate/
recede/eliminated/emerge — emerge has `.internal` and `.lord` variants) via `logLine`. **12.2 routes
these on-screen.**

---

## Shared data-model additions (do these as part of the first step that needs them)

Add to `createWorld` (`js/world/world.js`), guarded on read elsewhere:
```js
chronicle: [],   // 12.2 — persisted event log, capped (newest kept)
```
`settlement.taverns` (12.4) is added lazily when first generated (no createWorld change; settlements
are per-hex).

---

## 12.1 — Factions off the tab bar → clickable legend + faction popup

**Goal.** Stop the tab bar overflowing and free a slot for the 12.2 Chronicle, by moving Factions out
of the tabs into the map **legend** (already lists them) + a floating **faction popup**.

**Current state.**
- Tab defined in `TAB_REGIONS` (`panel.js:16`, key `factions` → region `factions-panel`), created in
  `showWorld` by a `mkTab("factions","Factions","factions-tab-badge")` call and a
  `region("factions-panel", true)` call. Rendered by `renderFactionsPanel(model)` (`panel.js:501`),
  which lays out `factionCard(faction, model)` (`panel.js:427`) cards. `factionCard` already renders
  name + `factionDescription` lines + per-holding "Jump to" links + a two-step "Delete faction".
- `refreshFactions()` (`app.js:1699`) calls `renderFactionsPanel(...)` **and** `renderFactionLegend
  (factions)` (`app.js:1794`). The legend rows (`#legend-factions`) are clickable and currently do
  `setPanelTab("factions"); onCenterFaction(f.id,0)` and hover→`setFactionHighlight`.
- `setPanelTab("factions")` is also called at `app.js:2202` and `:2229` (after generate/promote).

**Implementation.**
1. **Build the popup** (new code in `app.js`, styled in `css/app.css`). A floating `<div
   id="faction-popup">` appended to `#stage` (position: absolute, near the legend / centered), with a
   close ✕. Populate it by reusing `factionCard(faction, model)` — export `factionCard` from
   `panel.js` (or add a `renderFactionPopup(host, faction, model)` export that wraps it). Model needs
   `factionColorFor`, `onCenterFaction`, `onDeleteFaction`, and (optional) `onAdvanceFactionTurn`
   (the manual "Advance faction turn" button currently lives in `renderFactionsPanel` — decide
   whether to keep it in the popup, or on the legend header; recommend a single "Advance faction turn"
   button on the legend's "Powers" header since it's world-wide, not per-faction).
2. **Add an app fn** `openFactionPopup(id)` that finds the faction, renders the popup, centers via
   `onCenterFaction(id,0)`, and wires the ✕ + click-outside/Esc to close. Add a module var to track
   the open popup so it re-renders on `persistAndRefresh` if still open (or just close it on refresh —
   simpler).
3. **Rewire the legend** (`renderFactionLegend`, `app.js:1794`): row click → `openFactionPopup(f.id)`
   instead of `setPanelTab("factions")`. Keep the hover→`setFactionHighlight` behavior.
4. **Remove the tab:** delete the `factions` entry from `TAB_REGIONS`; remove its `mkTab(...)` and
   `region("factions-panel",...)` lines in `showWorld`; drop the `renderFactionsPanel` call from
   `refreshFactions` (keep `renderFactionLegend`); the other two `setPanelTab("factions")` sites
   (`:2202`,`:2229`) → call `openFactionPopup(faction.id)` (or just `refreshFactions()` so the legend
   shows the new faction). `renderFactionsPanel` can be deleted or left unused; if deleted, remove its
   export + import.
5. **Update the setPanelTab JSDoc** and any `"factions"` string references.

**Tests.** No new engine tests (this is UI). Existing suite must stay green (nothing engine-level
changes).

**Manual checklist.**
```
[ ] Tab bar: Selection · Hooks · Pinned · Oracle (no Factions). Everything fits.
[ ] Generate/Promote a faction → it appears in the legend "Powers" list.
[ ] Click a legend faction row → a popup opens with its card (name/goal/holdings/strength/seat),
    the map centres on it; hovering the row still brightens its territory.
[ ] Popup actions work: jump-to-holding, delete (two-step), (advance-turn if kept).
[ ] ✕ / click-away / Esc closes the popup. Reload → factions persist and re-list.
```

**Gotchas.** `factionColor(index)`/`factionHatchDeg(index)` are keyed on the faction's **index in
`getFactions(current)`** (must match the map marker) — pass the same index the legend uses. Don't
break the map territory rendering (unrelated to the tab).

---

## 12.2 — Event Chronicle (persisted) + near-party ticker

**Goal.** Surface the living world. One event stream → two views: a persisted **Chronicle** panel
(the freed tab) and a bottom **ticker "scroll"** that only interrupts for **near-party** events.

**Current state.** World events narrate via `logLine` (console only): `logFactionEvents` (`app.js:581`,
faction turns + emerge/rebellion/lord), the encounter prompt in `travelEncounterHexes` (`app.js:1049`,
`⚔ Encounter in the …`), and the travel recap in `applyTravel` (`app.js:1035`, `travelHeadline`).
Oracle rolls also `logLine` — **leave those console-only** (user wants no oracle history).

**Implementation.**
1. **Data.** Add `chronicle: []` to `createWorld`. Define a cap const (e.g. `CHRONICLE_CAP = 200`).
2. **`recordEvent(text, opts = {})`** in `app.js` (`opts = { at?: {q,r}, kind?: string }`):
   - push `{ day: sessionDay, text, kind: opts.kind || "event", at: opts.at || null }` to
     `current.chronicle`; `while (length > CHRONICLE_CAP) shift()`.
   - `logLine(text)` (keep console mirror).
   - **Ticker gate:** if `opts.at` and `isNearParty(opts.at, current.party, TICKER_RADIUS)` → show it
     in the ticker (see step 5). Non-located events do **not** ticker.
   - Extract a pure helper `isNearParty(at, party, radius)` (`at && party && axialDistance(at.q,at.r,
     party.q,party.r) <= radius`) — **unit-test this** (`axialDistance` from `js/core/hexgeo.js`).
   - `TICKER_RADIUS` ≈ 10 (tunable const).
3. **Route world events through it.** Update `logFactionEvents` to call `recordEvent(text, {at:{q:ev.q,
   r:ev.r}, kind:ev.kind})` per event (instead of `logLine`). Update `travelEncounterHexes` to
   `recordEvent(\`⚔ Encounter in the ${step.terrain} …\`, {at:{q:step.q,r:step.r}, kind:"encounter"})`.
   Update `applyTravel`'s recap `logLine(travelHeadline(...))` → `recordEvent(travelHeadline(...),
   {at: result.finalPos, kind:"travel"})`.
4. **Chronicle panel.** Add a `chronicle` tab (`TAB_REGIONS` key `chronicle` → region
   `chronicle-panel`; `mkTab("chronicle","Chronicle")` + `region("chronicle-panel",true)` in
   `showWorld`). Add `renderChroniclePanel(model)` in `panel.js` (host `#chronicle-panel`): render
   `current.chronicle` **newest-first**, each row showing the text (+ a small "Day N" / kind tag),
   clickable to `recenterOn(entry.at.q, entry.at.r)` when `at` is set. Add `refreshChronicle()` in
   `app.js` and call it in the load path + `persistAndRefresh` (like `refreshOracle`). Optional: a
   count/"new" badge on the tab.
5. **Bottom ticker.** Add `<div id="event-ticker" hidden>` inside `#stage` (bottom-centre; CSS
   absolute, above `#map-scale`/HUD, `pointer-events:auto`). A `showTicker(text, at?)` in `app.js`
   sets its text, unhides it, and starts a fade-out timer (respect `prefers-reduced-motion` — if
   reduced, just show/replace with no animation). Clicking it → open the Chronicle tab and/or
   `recenterOn(at)`. Only `recordEvent` calls it (gated on near-party).
6. **Persistence.** `chronicle` rides on `current`, so `persistAndRefresh`/`saveWorld` and export
   include it automatically. On world switch (`setCurrent`), nothing special — it's per-world.

**Tests.** `isNearParty` (near true / far false / null false). Optionally a `recordEvent` cap test if
you factor the push+cap into a pure helper over a plain object.

**Manual checklist.**
```
[ ] Progress days near a faction border → its moves appear in the Chronicle tab; if within
    ~10 hexes of the party, the bottom ticker shows the latest.
[ ] Travel → encounter lines + the trip recap appear in the Chronicle; near ones ticker.
[ ] Cause/await a distant emergence → it appears in the Chronicle but does NOT ticker.
[ ] Click a Chronicle row → map centres on that hex. Click the ticker → opens Chronicle / centres.
[ ] Reload and Export → the Chronicle persists / is in the JSON. Oracle rolls are NOT in it.
[ ] prefers-reduced-motion: the ticker still shows (no motion), doesn't auto-hide jarringly.
```

**Gotchas.** `sessionDay` resets to 0 on reload, so chronicle `day` tags are session-relative — that's
acceptable for a log; don't sort by `day`, keep insertion order. Cap the array to avoid unbounded
growth in long campaigns.

---

## 12.3 — Encounter-star hover

**Goal.** Hovering a wilderness-encounter star shows its type; no accumulation.

**Current state.** `travelEncounterHexes(result)` (`app.js:1049`) returns hit coords and calls
`setEncounterMarks(hits)`; `map.js` `setEncounterMarks(list)` (101) stores `encounterMarks`, drawn as
red ★ by `drawEncounterMarks()` (1146). Marks are **cleared on the next journey** (each `applyTravel`
replaces them) and on world switch — keep this (user: roll it and move on, no accumulation). The
canvas hover label is built in `render()` at `map.js:~308-330` (the `lines` array → `drawHexLabel`).

**Implementation.**
1. **Carry terrain on the mark.** In `travelEncounterHexes`, push `{q, r, terrain: step.terrain}`
   (currently `{q,r}`). `drawEncounterMarks` ignores extra fields — fine.
2. **Augment the hover label.** In `map.js render()`, where the hover `lines` array is built (~322),
   after the faction line, check if `hovered` matches an `encounterMarks` entry; if so push a line
   like `{ text: "⚔ <terrain> encounter — roll on your table", color: <accent red> }`. (encounterMarks
   is module state in map.js, already in scope.)
3. Optional: also show it in the `#map-readout` DOM if that's preferred, but the canvas hover label is
   the consistent home (matches settlement/region/faction hover lines).

**Tests.** None (canvas). Suite stays green.

**Manual checklist.**
```
[ ] Travel until a red ★ appears → hover that hex → the hover label includes
    "⚔ <terrain> encounter — roll on your table" with the correct terrain.
[ ] Start a new journey → previous stars clear (no accumulation).
```

---

## 12.4 — Persistent, editable settlement taverns

**Goal.** Taverns become a saved fixture of a town (exported), auto-generated when its situation is
first rolled, shown on the town's card, closeable + addable. The situation (mood/event) stays
transient.

**Current state.** `rollTavern(tables,rng)` → `{sign,specialty,quirk}` (pure, `oracle.js`). The
Settlement oracle rolls `rollSettlement` from the Oracle tab only (`onOracleRoll("settlement")`,
`app.js:1758`), gated on a selected town via `selectedSettlementContext()` (`app.js:1729`). Settlements
render as a single info line in `renderSelectionPanel` (`panel.js:~742`); `hex.settlement =
{present,size,kind?,waterBoost?}`.

**Implementation.**
1. **Size→count.** A pure helper (in `app.js` or `oracle.js`) `tavernCountForSize(size)` →
   Hamlet 1 · Village 1–2 · Town 2–3 · City 3–4 (rolled with a seeded rng; retunable). Export + unit-
   test if placed in `oracle.js`.
2. **Generate + persist.** `ensureTaverns(hex, q, r)` in `app.js`: if `hex.settlement.present` and
   `!hex.settlement.taverns`, load `ORACLE_TABLE_IDS`, roll `count` taverns via
   `rollTavern(tables, subRng(current.seed,"taverns",q,r,i))`, set `hex.settlement.taverns = [...]`,
   persist. Seeded per (settlement, index) so it's reproducible.
3. **Trigger on situation.** In `onOracleRoll("settlement")` **and** in a new selection-card action
   **"What's stirring?"** (see step 4), call `ensureTaverns` for the selected town before/after the
   situation roll.
4. **Selection card** (`renderSelectionPanel`, `panel.js:707`). Under the settlement line, when
   `hex.settlement.taverns?.length`, render a "Taverns" `sectionLabel` + one row per tavern (sign bold,
   then "known for {specialty}. {quirk}") each with a **close ✕** (`model.onCloseTavern(index)`), and
   an **"Add tavern"** button (`model.onAddTavern()`). Also add a **"What's stirring?"** action (calls
   `model.onRollSituation()`), which rolls the situation (show it as a transient line or route to the
   Oracle tab's Settlement block) and ensures taverns. Wire these callbacks from `renderSelection()`
   (`app.js:902`) into `renderSelectionPanel`'s model: `onCloseTavern`, `onAddTavern`, `onRollSituation`
   → app fns that mutate `hex.settlement.taverns` (+ persist) and re-render.
5. **Persistence/export.** `taverns` is on the hex/settlement (part of `current.hexes`) → saved +
   exported automatically. Guard reads with `hex.settlement.taverns || []`.
6. **Oracle-tab Tavern button** — keep for an *ad-hoc* roadside inn (open question: keep vs fold). If
   kept, it stays transient (not saved to a settlement).

**Tests.** `tavernCountForSize` ranges per size; determinism of the per-settlement roll (same seed/
coords → same taverns). `rollTavern` already tested.

**Manual checklist.**
```
[ ] Select a town → "What's stirring?" → a mood/event line + N taverns saved on the card
    (N scales with size: a City has more than a Hamlet).
[ ] Close a tavern (✕) → it's removed; "Add tavern" → a new one appears.
[ ] Reload → the town's taverns persist (same set). Export → they're in the JSON.
[ ] A second town has its own independent taverns.
```

---

## 12.5 — Treasure-type badge

**Goal.** Render the B/X Treasure Type letter (9.8) as a badge, and show it on the 💰 marker.

**Current state.** `treasureLine(t)` (`panel.js:788`) returns `"Treasure Type D, hidden — roll on your
tables."` as a plain line in the room view (`renderDungeonPanel`, `panel.js:~843`). The dungeon canvas
marks treasure rooms with a 💰 (`js/ui/dungeon-map.js:~341`, `treasureRooms` set).

**Implementation.**
1. In `renderDungeonPanel`'s room section, instead of the plain `treasureLine`, render a small
   **badge** element (e.g. `<span class="treasure-badge">D</span>`) + the guard text ("hidden — roll
   on your tables"). Add `.treasure-badge` CSS (a boxed/pill letter, wax-seal accent). Keep
   `treasureLine` for the console/log or refactor into a `{type,guard}`-aware renderer.
2. Optional (dungeon canvas): the 💰 marker has no tooltip today (canvas). A cheap win is to show the
   type in the **room-select** flow already (the panel badge covers it). A true canvas hover tooltip
   would need hit-testing on `dungeon-map.js` — defer unless wanted.

**Tests.** None (rendering). Suite stays green.

**Manual checklist.**
```
[ ] Open a dungeon/tower with treasure → a stocked room shows a [D]-style badge + guard text.
[ ] The 💰 room marker still appears on treasure rooms.
```

---

## 12.6 — Legend polish (new marks) + lord marker

**Goal.** Document the new marks in the legend and give lords a distinct map marker.

**Current state.** `#legend` has `#legend-terrain`, `#legend-poi`, `#legend-factions` sections. Faction
territory + seat are drawn on the map (`map.js`), rank-and-file and lords look the same. Encounter ★
(9.7) has no legend entry.

**Implementation.**
1. **Encounter ★ legend entry** — add a static key row (a red ★ + "Wilderness encounter — roll on
   your table") to the legend (a new small section or appended to `#legend-poi`). Populate wherever
   the terrain/POI legend is built (search `legend-terrain`/`legend-poi` population in `app.js`).
2. **Lord marker (12.6b).** Give a lord faction's **seat** a distinct glyph (e.g. a crown/skull) on
   the map so a lich/dragon reads differently from a rank-and-file seat. Detect via
   `LORD_ARCHETYPES.includes(faction.archetype)` (export `LORD_ARCHETYPES` is already in
   `factions.js`). Draw it in the map's faction/seat rendering pass. Add a legend key entry for it.

**Manual checklist.**
```
[ ] Legend shows a "Wilderness encounter ★" key.
[ ] A lord's seat draws a distinct marker (crown/skull) vs a normal faction seat; legend documents it.
```

---

## 12.7 — Visual polish (no behaviour change)

**Goal.** Prettify the surfaces this session leaned on. Pure CSS/markup structure; keep behaviour.

- **Oracle tab** (`renderOraclePanel`, `panel.js:543`; CSS `.oracle-*`) — better section rhythm,
  optional per-oracle icons, nicer result cards + empty states.
- **Dungeon room view** (`renderDungeonPanel`, `panel.js:792`) — clearer hierarchy (monster / trap /
  special / treasure-badge / dressing / light), tighter typography; align with the treasure badge (12.5).
- **Tile & settlement detail** (`renderSelectionPanel`, `panel.js:707`) — a cleaner card: terrain
  header, settlement line, POI list, the 12.4 taverns block, notes. Follow the existing parchment
  token system in `css/app.css` / `js/ui/theme.js` (Phase 11) — don't introduce magic colours.

**Manual checklist.**
```
[ ] Oracle tab, dungeon room, and tile/settlement cards look cleaner; light + dark parchment OK;
    nothing functional regressed (rolls, room nav, notes, taverns still work).
```

---

## Build order & tuning summary

**Order (dependency-first):** 12.1 → 12.2 → 12.3 → 12.4 → 12.5 → 12.6 → 12.7. 12.3 / 12.5 / 12.6 are
small and may be pulled earlier as quick wins.

**New tunable consts (all retunable, flag as such):**
- `CHRONICLE_CAP` ≈ 200, `TICKER_RADIUS` ≈ 10 (12.2)
- `tavernCountForSize` ranges (12.4)

**Open questions (resolve when picked up):**
- 12.1 popup style: floating panel near the legend (lean) vs a modal; keep the per-faction "Advance
  turn" or move it to a legend header (lean: legend header, since it's world-wide).
- 12.2 does a **lord** awakening ticker even when distant? User answer: **no** — distance-gate
  everything.
- 12.4 keep the Oracle-tab Tavern button for ad-hoc inns, or fold taverns fully into settlements?

## Cross-references
- Phase 9 oracles: `docs/plans/phase-9-oracles.md`. Phase 11 visual system: `docs/plans/
  phase-11-visual-overhaul.md`. Faction engine: `docs/plans/phase-8-factions.md` (+ 8.15–8.20).
