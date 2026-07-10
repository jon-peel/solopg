# Phase 8.1 — Foundation: world clock + party marker

First step of Arc A (Travel & Party Movement, see `phase-8-factions.md`). Gives the world a `day`
counter and a single party position, both rendered, plus a stopgap way to place the party before
real movement (8.4/8.5) exists. Everything else in Phase 8 depends on this landing first.

**Status:** ✅ done.

> Plan → approve → build → `node --test` → commit/push → manual checklist (project convention).

## Data model (schema v16)

**Revised per user steer: `day` is NOT persisted.** It's a "session day" — in-memory app state
only, always starts at 0 on page load, never saved to the world/IndexedDB/export. Only `party` and
`factions` are real schema additions:

```js
world: {
  // ...existing fields...
  party: { q: 0, r: 0 }, // single marker; multi-party out of scope
  factions: [],          // reserved for 8.7+, unused until then
}
```

- `party` moves only via the stopgap action below (persisted, survives reload). Real
  day-driven movement is 8.4+; a real day-advancement mechanic is 8.6.
- `factions: []` is added now (per the master plan) even though nothing populates it until 8.7 —
  avoids a second schema bump later.
- **Day readout**: a module-level counter in `app.js` (`sessionDay`, starts at 0), not part of
  `world` at all. Nothing changes it yet in this step (that's 8.6) — it exists now purely so the
  command bar has somewhere to show it. Since it's not tied to a world, switching worlds via the
  picker doesn't reset it separately (only a page reload does) — revisit if 8.6 needs different
  semantics.

## Files

| File | Change |
|---|---|
| `js/world/world.js` | `SCHEMA_VERSION` 15→16 (+ doc comment); `createWorld()` adds `party`, `factions`; new `setPartyPosition(world, q, r)` accessor |
| `js/data/portability.js` | v15→v16 migration step: backfill `party: {q:0,r:0}`, `factions: []` on old worlds (same shape as the v6 `hooks`/v15 `roads` backfills) |
| `js/ui/map.js` | New render pass: draw a party marker at `world.party`'s pixel position, on top of everything else (own pass after the hook-focus rings), visible at every zoom |
| `index.html` / `css/app.css` | "Day N" readout in the command bar (near the world picker), reads the in-memory session counter |
| `js/ui/panel.js` | `renderSelectionPanel`: a "Place party here" button, shown only for a placed hex, guarded by an `onPlaceParty` callback |
| `js/ui/app.js` | `sessionDay` module state + a render of the Day readout; `onPlaceParty` handler calling `setPartyPosition` + persist + re-render map (marker) + re-render panel |
| `test/world.test.js` | New-world defaults (`party:{0,0}`, `factions:[]`, no `day` field); `setPartyPosition` mutates in place |
| `test/migration.test.js` | v15 world upgrades to v16 with `party`/`factions` backfilled; export→import round-trips a world carrying them |

## Design notes / decisions

- **"Place party here" lives in the side panel**, not the radial ring — the ring's 8 slots
  (Terrain, POI, Settlement, Hook, Generate, Regenerate, Delete, Draw) are all full (confirmed by
  reading `radial-model.js`), and this is explicitly a temporary stopgap per the phase doc. Flagged
  as a deliberate, narrow exception to "the panel is read-only, all mutation via the radial menu" —
  party position isn't hex *content* the way terrain/POI/settlement are.
- **Party marker style**: a distinct glyph/colour not already used by hooks/settlements/POIs —
  proposing a small flag/pin glyph in a colour reserved for the party (not stealing hook-amber or
  a terrain colour). Exact art is easy to tweak after a visual look, not worth blocking on.
- **Default position** `{q:0,r:0}` — the world's origin always spawns land, but on a brand-new
  **Empty** world no hex is placed there yet. The marker still draws at that pixel position
  regardless of whether a hex is placed (it's just a coordinate on the infinite grid) — it'll sit
  over blank canvas until something is generated there, which is fine for this slice.
- **No day-tick yet** — nothing advances the session day counter in this step (that's 8.6's
  "Progress N days"). The readout exists now, always showing "Day 0", so later steps have
  something to update. It is never written to `world` or IndexedDB.

## Tests (`node --test`, pure logic only)

- `createWorld()` includes `party: {q:0,r:0}`, `factions: []`; no `day` field anywhere on `world`.
- `setPartyPosition(world, q, r)` mutates `world.party` and returns the world.
- Migration: a v15 fixture upgrades to v16 with `party`/`factions` backfilled; a v16 world is
  untouched (idempotent); export → import round-trips `party`/`factions` (no `day` to round-trip).

## Manual checklist (`./run-local.sh`)

```
[ ] New world (any size) shows "Day 0" in the command bar
[ ] A party marker renders on the map (at the origin hex if one exists)
[ ] Selecting a placed hex shows "Place party here"; clicking it moves the marker there
[ ] Reload the page — party position persists; Day resets to 0 (session-only, by design)
[ ] Export → Import — party position round-trips unchanged; exported JSON has no "day" field
[ ] Load an old (pre-v16) exported world — upgrades cleanly, party appears at (0,0)
```

## Verified

`node --test`: 305/305 passing (6 new: `world.test.js` defaults + `setPartyPosition`,
`migration.test.js` v15→v16 backfill/idempotency/round-trip). Manual pass via a headless-browser
smoke test against `python3 -m http.server`: command bar shows "Day 0" before and after creating a
world and after reload (session-only, confirmed never written to the exported JSON); the party
marker (magenta hex ring + ⚔️ badge, distinct from the amber hook ring / violet pinned ring / POI
icons) renders at the origin on a fresh world; selecting the origin hex shows "The party is here."
(no button); selecting a neighbouring hex shows "Place party here", and clicking it moves the
marker and flips that hex's panel text to "The party is here." No console errors (aside from the
pre-existing, unrelated `favicon.ico` 404).
