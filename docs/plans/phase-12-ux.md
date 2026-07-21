# Phase 12 — Living-world surfacing & UX polish

Phase 9 built a lot the GM can't *see*: faction turns, auto-emergence, rebellions, lord awakenings,
and wilderness encounters all narrate to the browser **console** (the on-screen event log was retired
before Phase 9). This phase surfaces that world on-screen and cleans up the panels touched along the
way. Scope confirmed with the user.

> Follows the project design loop: this doc is the **plan** → build per sub-step → `node --test` →
> commit/push → a short manual checklist. One coherent sub-step per commit.

> **Golden rule still applies:** no backward compatibility, no data migration — additive world fields
> go straight into `createWorld` with guarded reads; old saves can be thrown away.

---

## What the user asked for (mapped to sub-steps)

| # (user) | Ask | Sub-step |
|---|---|---|
| 1 | A place to see all events + a bottom **"scroll"** ticker showing the latest — but **near-party only** (a dragon across the planet just logs, doesn't interrupt); everything goes to the log | **12.2** |
| 2 | Emergence / rebellions / lords shown too — an extension of #1 | **12.2** |
| 3 | Hover an encounter star → see its type; **no accumulation** (roll it, move on) | **12.3** |
| 4 | Rolling a town's situation auto-rolls **1+ taverns**, saved with the town (exported), each with its description; taverns can be **closed** and **new ones added** | **12.4** |
| 5 | Treasure Type as a badge + on the 💰 marker | **12.5** |
| 6 | Legend entries for the new marks | **12.6** |
| other | **Tabs don't fit** → move Factions off the tab bar into the legend (clickable list → a faction **popup**) | **12.1** |
| other | Prettify the **dungeon room** + **tile/settlement** detail, and the **Oracle tab** | **12.7** |

---

## 12.1 — Factions off the tab bar → clickable legend + faction popup

Recurring problem: the side-panel tab bar overflows (Selection · Hooks · Pinned · Factions · Oracle,
and 12.2 wants to add Chronicle). Fix by moving **Factions out of the tabs**:

- The map **legend already lists factions** (`renderFactionLegend` → `#legend-factions`). Make each
  row the primary entry point: click → open a **faction popup** (a floating panel over the map) with
  that faction's full card — name · archetype · goal clock · seat · holdings · strength · disposition
  — and its actions (**Advance faction turn**, **Delete**, manual **reseat**), reusing the existing
  `factionCard` content.
- **Remove the Factions tab** (`TAB_REGIONS`, the `mkTab`, the region, `refreshFactions`'s panel
  render — keep the legend + map refresh). Redirect the ~9 `setPanelTab("factions")` call sites to
  open the popup (or just no-op the tab switch).
- Frees a tab slot for **12.2 Chronicle**. Net tabs: Selection · Hooks · Pinned · Chronicle · Oracle.

Manual test: legend faction rows open the popup with correct detail + working actions; no Factions
tab; generating/promoting a faction still works and shows in the legend.

## 12.2 — Event Chronicle + near-party ticker (the big one)

Surface the living world. Two surfaces over one event stream:

- **The stream.** A `recordEvent(text, { at, kind })` helper (in `app.js`) that (a) appends
  `{ day, text, kind, at? }` to a **persisted, capped** `world.chronicle` (newest kept, ~200 max —
  added to `createWorld`, guarded reads, no migration) and (b) mirrors to the console. Route the
  existing **world-event** `logLine` calls through it: faction turns (`logFactionEvents` — claim /
  takeover / relocate / recede / eliminated / **emerge** / **rebellion** / **lord**), the
  **encounter** prompts, and the **travel recap**. *Oracle rolls stay console-only* (the user wants
  no oracle history).
- **The Chronicle panel** (the freed tab from 12.1): the full `world.chronicle`, newest first, grouped
  or tagged by day, each line clickable to **centre the map** on its `at` hex. Persists + exports.
- **The bottom ticker ("scroll").** A slim strip at the **bottom-centre of the map** showing the
  **latest event** — but **only when it's near the party** (`at` within `TICKER_RADIUS` ≈ 10 hexes).
  Distant events (the far-off dragon) go to the Chronicle silently. The ticker shows one line, fades
  after a few seconds (respecting `prefers-reduced-motion`), and clicking it opens the Chronicle /
  centres the hex. Non-located events don't ticker.

Node-testable: `recordEvent` capping + the near-party predicate are pure-ish (extract a
`isNearParty(at, party, radius)` helper). Wiring is UI (manual checklist).

Manual test: progress days near a faction border → its moves appear in the Chronicle and, if near,
the ticker; drive travel → encounters + trip recap appear; a distant emergence logs to the Chronicle
but does **not** ticker; reload/export → the Chronicle persists.

## 12.3 — Encounter-star hover

The route stars (9.7) are silent. Store each mark's terrain (`{ q, r, terrain }`) and, on **hover of
that hex**, add the encounter prompt to the existing hovered-cell readout — *"⚔ Forest encounter —
roll on your table."* No accumulation: stars still clear on the next journey (the GM rolls it and
moves on). (Legend entry lands in 12.6.)

Manual test: travel until a ★ appears → hovering that hex shows the encounter line with the right
terrain; a new journey clears the old stars.

## 12.4 — Persistent settlement taverns

Taverns become a **fixed, saved** part of a town (not a transient oracle roll):

- **Data.** `settlement.taverns = [{ sign, specialty, quirk }]` on the hex's settlement (persisted,
  exported). Generated once, on demand.
- **Auto-roll on situation.** Rolling a town's **situation** (9.5) — from the Oracle tab *and* a new
  **"What's stirring?"** action on the town's selection card — also **generates its taverns if it has
  none**: a **size-scaled count** (Hamlet 1 · Village 1–2 · Town 2–3 · City 3–4, retunable) via the
  existing `rollTavern`, seeded per settlement so it's reproducible.
- **On the town's card.** The selection panel lists the town's taverns (sign + specialty + quirk),
  each with a **close (✕)** to remove it and an **"Add tavern"** to roll one more. Situation stays
  transient (it's *right now*); the taverns are the town's fixture.
- The Oracle-tab **Tavern/shop** button stays for an *ad-hoc* roadside inn (not tied to a town).

Node-testable: the size→count mapping + generation are pure. Card wiring is UI.

Manual test: select a town → "What's stirring?" → a mood/event line + N taverns saved on the card;
close one, add one; reload/export → taverns persist; a City has more than a Hamlet.

## 12.5 — Treasure-type badge

Render the B/X letter (9.8) as a small **pill/badge** (e.g. a boxed `D`) in the dungeon room view
instead of inline text, and include it in the **💰 room-marker tooltip** so it reads without opening
the room.

## 12.6 — Legend polish (new marks)

Add legend key entries for the marks this session introduced: the wilderness-encounter **★**, and —
if 12.6b lands — a **lord seat marker**. A distinct **lord marker** on the map (a crown/skull on the
seat) so a lich/dragon reads differently from a rank-and-file faction; legend documents it.

## 12.7 — Visual polish

A styling pass (no behaviour change) on the surfaces this session leaned on:

- **Oracle tab** — better section rhythm, per-oracle icons, nicer result cards + empty states.
- **Dungeon room view** — clearer hierarchy (monster / trap / special / treasure / dressing), the
  treasure badge from 12.5, tighter typography.
- **Tile & settlement detail** — prettier selection card (terrain header, settlement line, POI list,
  taverns from 12.4, notes).

---

## Build order

Dependency-first: **12.1** (free the tab) → **12.2** (Chronicle + ticker into it) → **12.3** →
**12.4** → **12.5** → **12.6** → **12.7**. 12.3 / 12.5 / 12.6 are small and can be pulled earlier as
quick wins if wanted. Each ends with `node --test` green + a manual checklist.

## Open questions (resolve as each is picked up)
- **12.1** Faction popup: a bespoke floating panel, or reuse the radial/overlay styling? (lean:
  floating panel near the legend row.)
- **12.2** `TICKER_RADIUS` and the chronicle cap — set defaults, retune in play. Does a **lord**
  awakening ticker even when distant? (user: no — distance-gate everything.)
- **12.4** Tavern counts per size — start from the table above, retune. Keep the Oracle-tab tavern
  button, or fold it fully into settlements?
