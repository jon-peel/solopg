# Phase 8.7 — Foundation: Generate faction

First step of **Arc B (Factions)** — see [`phase-8-factions.md`](phase-8-factions.md). Introduces the
faction object, its generator + tables + derived name, a manual **"Generate faction"** action, a new
**Factions** panel tab, and **holding markers on the map from the first slice** (per the phase steer —
no panel-only deferral). Everything in Arc B (8.8 promote, 8.9 holdings, 8.10 turns) builds on this.

**Status:** ✅ done (no schema bump — v16 already reserved `factions:[]`).

> Plan → approve → build → `node --test` → commit/push → manual checklist (project convention).

## No schema bump

Schema is already **v16** (8.1 reserved `world.factions: []` and the v15→v16 migration already
backfills it). 8.7 only *populates* that array, so **`SCHEMA_VERSION` stays 16** and there is **no
new migration step**. The faction *shape* self-heals on a later change via a `FACTION_BUILD` stamp on
every generated faction — exactly the `HOOK_BUILD` / `DUNGEON_BUILD` pattern. Export/import already
round-trips `factions` for free (`exportWorld` = `JSON.stringify(world)`; the whole array serialises).

## Faction shape (structured picks; prose composed at render)

Matches the master-plan shape; 8.7 fills the create-time subset (`origin` is `null` until 8.8's
Promote; `clock`/`goal.progress`/`strength` bookkeeping starts here, ticked from 8.10):

```js
{
  id: "faction:<n>",                 // nextFactionId, mirrors nextHookId
  build: FACTION_BUILD,              // shape stamp (self-heals later)
  name,                              // STORED (see note) — from faction-name.js
  archetype,                         // data/faction-archetype.json (bandits | cult | merchant guild | …)
  disposition,                       // data/faction-disposition.json (hostile | wary | neutral | friendly)
  goal: { kind, progress: 0, max },  // kind from data/faction-goal.json; max = a rolled clock length
  strength,                          // small starting integer, grows/shrinks on turns (8.10)
  holdings: [ { q, r, poiId? } ],    // exactly ONE at creation (the origin hex/POI); 8.9 adds more
  clock: { turns: 0, sinceTurn: 0 }, // doom-clock bookkeeping; sinceTurn is day-of-last-tick (8.10)
  origin: null,                      // set to { fromPOI:{q,r,poiId} } only by Promote (8.8)
  status: "active",                  // "dormant" | "destroyed" come later
}
```

**Why `name` is STORED here (a deliberate divergence from `settlement-name.js`'s derived-not-stored
rule).** A settlement name is re-derived every render from its *coordinate* (`seed,q,r,gen`), so it
never needs storing. A faction is a first-class object in `world.factions[]` with its own identity
that can outlive/move its holdings (8.9/8.13) — there's no single stable coordinate to re-derive from.
So `faction-name.js` reuses settlement-name's *construction technique* (seeded prefix+suffix picks)
but the result is written into the object once, at creation. Flagging so this isn't read as breaking
the convention.

## Data & generation split (rules-as-JS-consts vs. content-as-JSON-tables)

Per the [data-driven-content convention](../../PLAN.md#hard-conventions-a-new-session-must-know-these):
**content** (the flavour words a GM rolls) is JSON tables; **rules/tuning** (clock lengths, starting
strength) are JS consts/rolls in `factions.js`, so they retune like every other generation constant.

- **`data/faction-archetype.json`** — weighted archetypes (`bandits`, `cult`, `merchant guild`,
  `noble house`, `monstrous tribe`, `hermit order`, …). Canonical table schema (`{id,title,entries:
  [{weight,value}]}`), same as `hook-pattern.json`.
- **`data/faction-goal.json`** — weighted goal **kinds** as strings (`seize the region`,
  `hoard wealth`, `spread the faith`, `drive out rivals`, `awaken something`, …). The clock **length**
  (`goal.max`) is *not* in the table — it's a JS roll (below), because it's tuning, not flavour.
- **`data/faction-disposition.json`** — weighted `hostile | wary | neutral | friendly`.
- **JS tuning in `factions.js`:** `goal.max` = a rolled clock length (proposed **4 + d4 → 5–8
  segments**, echoing how `startChain` rolls `total = 3 + rng*3`); `strength` = a small starting
  integer (proposed **2 + d3 → 2–4**). Both flagged for real-play retune like every other const.

## Files

| File | Change |
|---|---|
| `data/faction-archetype.json` | **new** table — weighted archetypes |
| `data/faction-goal.json` | **new** table — weighted goal kinds |
| `data/faction-disposition.json` | **new** table — weighted dispositions |
| `js/gen/faction-name.js` | **new**, pure — `factionName(seed, n, opts)`; seeded prefix/suffix picks flavoured by archetype (mirrors `settlement-name.js`'s technique) |
| `js/gen/factions.js` | **new**, pure — `FACTION_BUILD`, `generateFaction(tables, rng, ctx)`, `factionLabel(faction)` (short list label) + `factionDescription(faction)` (composed prose lines, mirroring `hookName`/`hookDescription`) |
| `js/world/world.js` | new accessors `addFaction(world, faction)`, `getFactions(world)`, `removeFaction(world, id)` (plan-anticipated; hooks mutate `world.hooks` directly, but the plan lists these and 8.8/8.9/8.10 want the seam) |
| `js/ui/poi-style.js` | `FACTION_COLORS` palette + `factionColor(index)` — per-faction map colour, distinct from party-magenta / hook-amber / pinned-violet |
| `js/ui/map.js` | new render pass: draw a holding marker at each `world.factions[*].holdings[*]` (per-faction colour + a banner glyph 🚩), under the party marker, over POIs |
| `js/ui/panel.js` | new **Factions** tab (`#factions-panel`, `renderFactionsPanel(model)`); a **"Generate faction here"** button on the Detail tab for a placed selected hex; `mkTab("factions", …)` with a count badge |
| `js/ui/app.js` | `nextFactionId(world)` (mirrors `nextHookId`); `onGenerateFaction()` handler (load tables → `subRng(seed,"faction",q,r,n)` → `generateFaction` → `addFaction` → jump to Factions tab → `persistAndRefresh`); wire `renderFactionsPanel` model (list + click-to-jump to a holding) into `showWorld` |
| `test/factions.test.js` | **new** — generator + name determinism + shape (see Tests) |
| `test/migration.test.js` | small addition — a world carrying a generated faction round-trips through export→import unchanged (no version change) |

## Generate-faction action — placement

Mirror **"Generate hook"**: the action reads from the **selected hex** (`origin = selected`), and the
faction's single starting holding is that hex (with its POI id if one is there). For this slice it
lives as a **"Generate faction here" button on the Detail tab** of a placed hex — the same narrow,
deliberate exception the 8.1 "Place party here" button already set (party/faction placement isn't hex
*content* like terrain/POI, so it's a panel action, not a radial slot). The parent plan explicitly
leaves exact **radial-ring** placement for later and flags the ring as full; a radial slot/submenu can
be added in a later polish step without reworking this. After generating, jump to the **Factions tab**
with the new faction surfaced (same "never a silent nothing-happened" move as `onGenerateHook`).

## Factions tab (mirrors the 7.3 Hooks tab)

- A fourth-plus tab button **"Factions"** with a count badge (`mkTab` already supports a badge id),
  and a `#factions-panel` region toggled by `TAB_REGIONS`.
- `renderFactionsPanel(model)` lists each faction as a card: **name** (heading), **archetype ·
  disposition**, and the **goal** with a `progress / max` readout (a small text meter for now; a real
  bar is cheap later). Empty state: *"No factions yet — select a hex and press 'Generate faction
  here', or Promote an occupied POI (8.8)."*
- Click a faction → centre the map on its (first) holding, same click-to-jump as a hook's Target.
- Prose is **composed at render** from the picks (`factionDescription`), never stored — the
  compose-at-render rule from `feature-detail.js`/hooks.

## Map presence (holding markers, from this slice)

A dedicated render pass in `map.js` (after POIs, before/under the party marker so the party stays the
top marker): for every faction, for every holding, draw a marker at the holding's pixel position in
that faction's colour (`factionColor(index)`) with a banner glyph in the detail tier. Colour is
**per-faction** (the plan's "coloured per faction"), cycling `FACTION_COLORS`; kept clear of party
magenta (`#ff4fd8`), hook amber, and pinned violet. Visible like the other markers; at far zoom it
degrades to a coloured dot (same treatment as POI dots in 7.9).

## Tests (`node --test`, pure logic only)

- **`generateFaction`** returns a well-formed faction: `id` shape, `build === FACTION_BUILD`,
  `archetype`/`disposition`/`goal.kind` all drawn from the loaded tables, exactly **one** holding at
  the origin coords, `goal.progress === 0`, `goal.max` in the rolled range, `strength` in range,
  `clock:{turns:0,sinceTurn:0}`, `origin:null`, `status:"active"`.
- **Determinism**: same `(seed, q, r, n)` → byte-identical faction (incl. name), per project
  determinism rule.
- **`factionName`** is deterministic for a given `(seed, n)` and varies with `n`.
- **Composed prose**: `factionLabel`/`factionDescription` are pure functions of the picks (no table
  access), produce stable strings.
- **Migration/portability**: a world with one generated faction survives export→import identical;
  `SCHEMA_VERSION` still 16 (no bump); a v15 fixture still upgrades to v16 with `factions:[]`.

## Manual checklist (`./run-local.sh`)

```
[ ] Select a placed hex → Detail tab shows "Generate faction here"; click it
[ ] A faction appears in a new Factions tab: name / archetype · disposition / goal (0 / N)
[ ] Its one holding shows a coloured banner marker on the map (distinct from party/hook markers)
[ ] Generate a second faction elsewhere → a different colour; both listed, both marked
[ ] Click a faction in the list → map centres on its holding
[ ] Reload → factions persist (v16); Export → Import → identical (factions round-trip)
[ ] Far-zoom → holding markers degrade to coloured dots, still legible
```

## Out of scope (later Arc B steps)

- **Promote** an occupied POI into a faction, seeding archetype/name from the occupier label — **8.8**.
- **Claim / multiple holdings** on one faction — **8.9**.
- **Faction turns** (goal progress, disposition drift, strength/holding change; the day/turn clock
  tension) — **8.10**. 8.7 only *initialises* `clock`/`goal.progress`/`strength`; nothing ticks yet.
- **Radial-menu slot** for Generate faction — deferred (ring is full; panel button for now).
