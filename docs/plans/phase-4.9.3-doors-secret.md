# Sub-plan 4.9.3 — Doors, passages & secret doors

Part of [Phase 4.9](phase-4.9-dungeon-connectivity.md). Gives the room-graph edges **types** —
`open / door / locked / stuck / secret` — and draws them, with **secret doors hidden** until a later
reveal step (4.9.5). Also lands a light corridor-routing fix so passages clip through unrelated rooms
less often.

## Design (`js/gen/dungeon-layout.js`)
- **Edge types** assigned from weighted JS consts (structural rule, kept with the other layout
  consts; rolled via `rollTable`):
  - **Tree edges** (the spanning-tree connectivity edges): `open/door/stuck/locked` — **never
    secret**, so every room is reachable without finding a secret door.
  - **Loop edges** (the redundant extra connections): same set **plus `secret`** (decent weight), so
    secret doors show up as hidden shortcuts/loops only.
  - This satisfies the rule: *no room reachable only via a secret edge* (tree path always exists).
- **Corridors** are carved only for **non-secret** edges → secret connections leave no visible trace
  until revealed. Secret edges still live in `layout.edges` (type `secret`).
- **Door render hints:** `layout.doors = [{ x, y, type }]` for **visible** non-`open` edges
  (door/locked/stuck) — one marker per such edge at the corridor cell next to a room. `open` = no
  marker; `secret` = nothing (hidden).
- **Routing fix:** carve picks the L-orientation (horizontal-first vs vertical-first) that passes
  through **fewer foreign rooms**, reducing the "corridor cuts through a room it doesn't connect to"
  cosmetic.
- Return shape adds `doors`: `{ grid, rooms, corridors, edges, doors, entrance }`.

## Self-heal
Bump `DUNGEON_BUILD` 2 → 3 (`js/gen/dungeon.js`) so saved dungeons regenerate with typed
edges/doors on next open.

## Renderer (`js/ui/dungeon-map.js`)
- Draw `layout.doors` after corridors/rooms: small markers coloured by type — **door** wood,
  **locked** red, **stuck** orange. (A proper legend/key comes with 4.9.7 polish.)

## Files
- `js/gen/dungeon-layout.js` — edge types, secret handling, doors, routing heuristic.
- `js/gen/dungeon.js` — `DUNGEON_BUILD = 3`.
- `js/ui/dungeon-map.js` — draw door markers.
- `test/dungeon-layout.test.js` — every edge has a valid type; tree (non-secret) edges keep the graph
  connected (no secret-only rooms); secret edges occur on some loop levels; `doors` only list visible
  types at corridor cells; determinism.

## Verification
- **Automated:** `node --test` — new type/secret/door assertions; all prior suites green.
- **Manual checklist — "4.9.3 — Doors, passages & secret doors" (`./run-local.sh`):**
```
[ ] Open a dungeon (self-heals) → corridors now show door markers at some connections
    (wood = door, red = locked, orange = stuck); open passages have none
[ ] Larger/loopy levels sometimes have a missing-looking connection — that's a hidden
    secret door (will become revealable in 4.9.5); every room is still reachable anyway
[ ] Corridors cut through unrelated rooms noticeably less than before
[ ] Reload → doors/types persist and are identical (deterministic)
```
