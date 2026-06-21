# Sub-plan 4.9.1 — Dungeon creation UI: randomize or choose size

Part of [Phase 4.9](phase-4.9-dungeon-connectivity.md). First step: let the user **randomize or pick
a dungeon's size at creation**, and lock that choice on the POI so later steps (levels, entrances,
loop density) can build on it. Small, visible, independently testable.

## Why first
Size is the upstream input the connectivity steps depend on. Today it's rolled lazily when a dungeon
is first opened; making it a **creation-time choice** establishes that model cleanly before we touch
the graph.

## Design
- **`generateDungeon` honors a forced size** (`js/gen/dungeon.js`): if `ctx.size` names a row in the
  `dungeon-size` table, use it (no roll); otherwise roll as today. Mirrors how `ctx.theme` already
  works. Interior shape is unchanged, so **no `DUNGEON_BUILD` bump**.
- **POI carries a `sizeHint`** (`js/ui/app.js`): adding a dungeon stores `poi.detail.sizeHint`
  (`undefined` = random). The lazy build + self-heal in `onSelectPoi` pass `size: poi.detail.sizeHint`
  into `generateDungeon`. Old dungeons (no hint) keep rolling — fine, no back-compat needed.
- **Dedicated "Add dungeon ▾" menu** (`js/ui/panel.js`): offers `Random size` + each size
  (Cramped/Modest/Sizable/Sprawling, read from the `dungeon-size` table so it stays data-driven).
  `dungeon` is removed from the generic "Add POI ▾" list to avoid two ways in (a random POI roll can
  still produce a dungeon — random size).
- **Size names** are loaded once at init (`loadTables(["dungeon-size"])`) into a module var and passed
  to the panel model as `dungeonSizes` — single source of truth, no hardcoded list.

## Files
- `js/gen/dungeon.js` — `ctx.size` lookup/forcing.
- `js/ui/app.js` — `onAddDungeon(size?)`, `addPoiToSelected(forceType, opts)` sets `sizeHint`,
  `onSelectPoi` passes `size`, load `dungeonSizes` at init, model wiring.
- `js/ui/panel.js` — `addDungeonMenu`, filter `dungeon` out of `addPoiMenu`.
- `test/dungeon.test.js` — `ctx.size` honored + counts in range.

## Reuse
`buildMenu` (panel.js), `loadTables` (loader.js), `rollTable`/size table, the existing lazy-gen +
`dungeonNeedsBuild` seam in `app.js`.

## Verification
- **Automated:** `node --test` — forced size honored, level/room counts within that size's range;
  all prior suites green.
- **Manual checklist (`./run-local.sh`):**
```
[ ] Select a land hex → POI section shows an "Add dungeon ▾" menu with size options
[ ] Add dungeon ▾ → Sizable → a dungeon POI appears; open it → title reads "… — Sizable"
    and it has the expected number of levels/rooms for Sizable
[ ] Add dungeon ▾ → Random size → repeat a few times → sizes vary
[ ] "Add POI ▾" no longer lists Dungeon (but Random there can still yield one)
[ ] Reload → the created dungeons + their sizes persist
```
