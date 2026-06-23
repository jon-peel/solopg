# Sub-plan 4.9.11 — Lighting Tier B: the occupied frontier

The last meaty dungeon item ([Phase 4.9](phase-4.9-dungeon-connectivity.md)). Generates the evocative
sandbox setup: a group has moved into the rooms by an entrance — **lit and held** — and **locked the
door** to the dark, monster-filled depths they never explored. (Back-compat ignored.)

## Model
`dungeon.occupation = { by, level: 0, rooms: [roomN…] } | null`, plus per-held-room
`room.held = <group>`. A theme-biased chance the dungeon is occupied (interlopers squat in
abandoned places: Ruin/Fort/Mine/Cave/Smugglers/Cult high; native-occupant themes like Goblin warren
/ Beast den low). The occupier is a group from the existing `occupiers.json` (reuse).

## Generation (`js/gen/dungeon.js`, post-pass before lighting)
`assignOccupation(levels, entrances, occupiers, rng, theme)`:
- Roll the theme chance; if occupied, BFS a **contiguous cluster from a level-0 entrance** over
  level-0 edges → the first ~2–4 rooms (always leaving ≥1 unheld so there's a frontier).
- Held rooms: `room.held = group`, **lit** (`light = { source: "Lit — held by <group>" }`), and a
  held Monster room's monster becomes the group (`{name: group, number, status:"alert"}`).
- **Boundary = locked door:** every level-0 edge crossing held↔unheld is re-typed **locked** (kept
  reachable, never secret, so the depths are sealed-but-openable); rebuild markers with
  `deriveDoors(level0.layout.edges)` (the door refactor makes this a one-liner).
- `assignLighting` then skips held rooms (keeps their light) and lights the rest as usual (depths
  stay dark). Bump `DUNGEON_BUILD` 13 → 14.

## UI
- **Panel** (`js/ui/panel.js`): a held room shows **`Held by <group>`**; the level header notes
  occupation on level 0.
- The story already reads on the map: a **warm-lit cluster at the entrance** ringed by **red locked
  doors (L)**, darkness beyond.

## Files
- `js/gen/dungeon.js` (occupation pass + lighting guard + build bump), `js/ui/panel.js`,
  `test/dungeon.test.js` (load `occupiers`).

## Verification
- **Automated:** `node --test` — when occupied: held rooms are a contiguous cluster from an entrance,
  all lit, `dungeon.occupation.by` set; every held↔unheld level-0 edge is `locked` (never secret) and
  the depths remain graph-reachable; determinism. Existing suites green.
- **Manual checklist — "4.9.11 — Occupied frontier" (`./run-local.sh`):**
```
[ ] Make several dungeons (Ruin / Smugglers' tunnels) → some are occupied: a warm-lit cluster of
    rooms by an entrance, with red locked-door (L) markers sealing it from the rest
[ ] Click a held room → "Held by <group>"; its monster (if any) is that group, alert
[ ] Beyond the locked doors: dark rooms with the dungeon's own monsters
[ ] A Goblin warren / Beast den is rarely "occupied" (native monsters already live there)
[ ] Reload → identical
```
