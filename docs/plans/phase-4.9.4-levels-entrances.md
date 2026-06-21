# Sub-plan 4.9.4 — Inter-level links, multiple entrances & exits

Part of [Phase 4.9](phase-4.9-dungeon-connectivity.md). Connects the levels into one dungeon:
**stairs** between adjacent levels you can click to traverse, **multiple surface entrances**
(size-scaled), and **exits** that can surface on a deeper level for hill/mountain sites.

## Data model (added to `dungeon`, no back-compat)
```js
dungeon.stairs    = [{ down:{level,room}, up:{level,room} }]  // down.level+1 === up.level
dungeon.entrances = [{ level, room }]   // surface entries; on level 0, count scales with size
dungeon.exits     = [{ level, room }]   // extra surface openings; may be on level >=1 (Hills/Mtn)
```
(`level` is a 0-based index into `dungeon.levels`.)

## Generation (`js/gen/dungeon.js`, after the levels loop, deterministic on the dungeon rng)
- **Stairs:** ≥1 between each adjacent level pair (a random room in the upper level ↔ a random room
  in the lower), so every level is reachable from the surface; Sizable/Sprawling sometimes get a 2nd.
- **Entrances:** on level 0; count by size — Cramped/Modest 1, Sizable 1–2, Sprawling 2–3 (distinct
  rooms).
- **Exits:** only when `ctx.terrain` is Hills/Mountains and there are ≥2 levels — a chance of 1–2
  exits on a level ≥1 (a mine adit / cliff mouth surfacing partway down).
- Reuse `pick`/`randInt` (`js/core/rng.js`). Bump `DUNGEON_BUILD` 6 → 7 (self-heal).

## UI
- **Map markers** (`js/ui/dungeon-map.js`): per current level, badge rooms that are an **entrance**
  (green **E**), **exit** (green **X**), **stairs down** (cyan **▼**), or **stairs up** (cyan **▲**),
  drawn in the room corner so they don't clash with the room number. `setLevel(level, marks)`.
- **Navigation** (`js/ui/app.js` + `js/ui/panel.js`): clicking a room still shows its contents; if
  that room has a stair, the panel shows a **"Stairs down to L2 →"** / **"Stairs up to L1 →"** button
  that switches the viewed level and selects the connected room. Entrance/exit rooms get a note. The
  existing L1/L2/L3 switcher stays.

## Files
- `js/gen/dungeon.js` (gen + build bump), `js/ui/dungeon-map.js` (markers),
  `js/ui/app.js` (marks + room-connection nav), `js/ui/panel.js` (stair buttons + notes),
  `test/dungeon.test.js`.

## Verification
- **Automated:** `node --test` — stairs connect adjacent levels and every level is reachable from an
  entrance; entrance count scales with size; exits only for Hills/Mountains on level ≥1; determinism.
- **Manual checklist — "4.9.4 — Inter-level links, entrances & exits" (`./run-local.sh`):**
```
[ ] Open a multi-level dungeon (Sizable/Sprawling) → level 1 shows green E entrance marker(s)
[ ] Some room shows ▼ (stairs down); click it → panel shows "Stairs down to L2 →"; click it →
    view switches to L2 and the connected room (▲ stairs up) is selected
[ ] Larger dungeons have multiple entrances; the L1/L2/L3 switcher still works
[ ] A Mountains/Hills dungeon sometimes has a green X exit on level 2/3; a Plains one never does
[ ] Reload → stairs/entrances/exits persist identically
```
