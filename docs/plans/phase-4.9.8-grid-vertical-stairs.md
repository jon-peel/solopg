# Sub-plan 4.9.8 — Square grid (10 ft) + true vertical stairs

A dungeon follow-up to [Phase 4.9](phase-4.9-dungeon-connectivity.md). Adds a **10 ft square grid**
to the Dungeon View and makes **stairs/shafts connect rooms that physically overlap** on that grid —
verifiable at a glance. (Back-compat ignored; `DUNGEON_BUILD` self-heals.)

## Insight
All levels already share one coordinate grid. So a stair-down room at grid `(x,y)` can have its
stair-up room **pinned** to the same `(x,y)` on the next level — a real vertical shaft.

## Generation (`js/gen/dungeon.js`, `js/gen/dungeon-layout.js`)
- **`layoutLevel(rooms, rng, { side?, pins })`** gains `pins`: an array of `{x,y,w,h}` rects placed
  FIRST (as the level's first rooms), with the rest laid out around them (the grid auto-grows to fit
  any pin). With `pins:[]` behaviour/output is unchanged (existing tests stay green).
- **Top-down generation:** generate levels in order; when a level's **down-stairs/shaft** are chosen
  (spread-out rooms), register their rects as **pins for the target level** (`i+1` for stairs, `i+2`
  for a shaft). When the target level is built, its first rooms land on those pins, and each pin
  resolves to that room's number as the **up** end of the stair. Net: down-room and up-room share the
  same rect → guaranteed overlap. Multi-stairs/entrances/exits logic unchanged otherwise. Bump
  `DUNGEON_BUILD` 10 → 11.

## Rendering (`js/ui/dungeon-map.js`, `js/ui/app.js`)
- **Shared frame:** render every level using one dungeon-wide bounding box (union of all levels'
  rooms/corridors), passed via `setLevel(level, marks, frame)`, so a grid cell maps to the SAME
  screen spot on every level — flip levels and the overlapping stair is in the same place.
- **Camera persists across level switches** (only `fitView()` / opening a dungeon re-fits), so you can
  zoom a stair and flip levels to confirm the overlap.
- **Grid overlay:** faint 10 ft squares drawn under the rooms across the frame; "10 ft" noted in the
  Legend.

## Files
- `js/gen/dungeon-layout.js` (pins), `js/gen/dungeon.js` (top-down pinning + build bump),
  `js/ui/dungeon-map.js` (grid + frame + camera persistence), `js/ui/app.js` (shared frame, fit on
  open), `index.html`/`css` (legend "10 ft"), `test/dungeon.test.js`, `test/dungeon-layout.test.js`.

## Verification
- **Automated:** `node --test` — layout honours pins (pinned rooms land at the given rects); **every
  stair's down-room and up-room rectangles overlap**; existing suites green.
- **Manual checklist — "4.9.8 — Grid + true vertical stairs" (`./run-local.sh`):**
```
[ ] Open a multi-level dungeon → a faint square grid underlies the map; Legend notes 10 ft
[ ] A stairs-down room (▼) and the linked stairs-up room (▲) sit at the SAME grid square
[ ] Click the ▼ → "Stairs down" → level flips and the ▲ room is in the exact same spot (overlap)
[ ] Zoom into a stair, then flip levels with L1/L2 — the view stays put and the stair lines up
[ ] Shafts (skip a level) also line up two levels down
[ ] Reload → identical
```
