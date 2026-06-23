# Sub-plan 4.9.2 — Room-graph rewrite + loops (foundation)

Part of [Phase 4.9](phase-4.9-dungeon-connectivity.md). Replaces the spanning-**tree** corridor
carver with an explicit room **graph** so levels have **loops / multiple pathways** — the structural
base every later step (doors, secret doors, stairs, entrances/exits) builds on.

## Why
`js/gen/dungeon-layout.js` currently connects each room to its nearest neighbour → exactly one path
between any two rooms (no loops). We want real connectivity choices.

## Design (`js/gen/dungeon-layout.js`)
- **Keep** room placement (non-overlapping rects on a grid) unchanged.
- **Build an edge graph** instead of carving a bare tree:
  - **Spanning tree first** (each room → nearest already-placed room) → guarantees connectivity.
  - **Extra "loop" edges** added between nearby non-connected rooms (candidate pairs sorted
    nearest-first, so loops stay local).
- **Loop tuning (user steer):**
  - A level is **occasionally fully linear** (no loop edges); chance is higher for small levels:
    `count ≤3 → 0.6`, `≤5 → 0.3`, `≤7 → 0.12`, else `0.05`.
  - Otherwise add `randInt(count*0.3 … count*0.6)` loop edges, so **larger levels are noticeably
    loopy** (e.g. a 10-room level gets ~3–6 cycles).
- Each edge is `{ a, b, type:"open" }` (room numbers; `type` is a hook for 4.9.3 doors). Corridors
  are carved per edge as today; `layout` now also returns `edges`.
- Return shape: `{ grid, rooms, corridors, edges, entrance }`.

## Self-heal
Bump `DUNGEON_BUILD` 1 → 2 (`js/gen/dungeon.js`). Existing saved dungeons predate `edges`/loops, so
`dungeonNeedsBuild` regenerates them into the new graph on next open (no migration — pre-v1).

## Renderer
No change required — `dungeon-map.js` draws `layout.corridors` + `layout.rooms`, and the extra loop
corridors now appear automatically. (Drawing `edges`/doors comes in 4.9.3.)

## Files
- `js/gen/dungeon-layout.js` — graph + loop edges.
- `js/gen/dungeon.js` — `DUNGEON_BUILD = 2`.
- `test/dungeon-layout.test.js` — keep existing guarantees; add: edges reference real rooms, graph is
  connected via edges, large levels usually contain cycles, small levels are sometimes linear,
  determinism still holds.

## Verification
- **Automated:** `node --test` — all prior suites green + new graph assertions.
- **Manual checklist — "4.9.2 — Room-graph rewrite + loops" (`./run-local.sh`):**
```
[ ] Open an existing dungeon → it regenerates (self-heal) and still renders a map
[ ] Add dungeon ▾ → Sprawling, open it → larger levels show LOOPS/branches (multiple routes),
    not one snaking path
[ ] Flip through several dungeons → small levels are occasionally a single linear path
[ ] Every room is still connected (no orphan rooms)
[ ] Reload → layouts persist and look identical (deterministic)
```
