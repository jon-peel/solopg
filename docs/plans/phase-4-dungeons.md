# Sub-plan: Phase 4 — Dungeons

Expands the Phase-3 dungeon **stub** into a real, generated, explorable dungeon interior with a
panel detail view. See [`../../PLAN.md`](../../PLAN.md) for the overview and conventions. Work is on
branch `claude/refine-local-plan-lg3hiu` (PR #1).

Conventions inherited: no build / no deps; serve over HTTP; seeded determinism via `subRng`;
data-driven JSON content + JS-const rules; SVG art with emoji fallback (dungeons reuse the 🏰 emoji —
no new art); schemaVersion + `migrateWorld`; one coherent step per commit; manual browser checklist
per UI step.

---

## Data model — `poi.detail.dungeon`

A dungeon POI's interior is generated **lazily on first open** and then persisted:

```js
poi.detail.dungeon = {
  size: "Sizable",                 // from data/dungeon-size.json
  levels: [
    {
      depth: 1,
      theme: "Forgotten tomb",     // from data/dungeon-theme.json
      encounters: [                // generated random-monster table for this level
        { weight: 3, value: "Goblins" }, ...
      ],
      rooms: [                     // OSR-style stocked contents
        { n: 1, content: "Monster", monster: "Goblins", treasure: true },
        { n: 2, content: "Empty",   monster: null,      treasure: false }, ...
      ],
    }, ...
  ],
}
```

**Lazy generation** (not at POI-roll time): seeded by `subRng(seed, "hex", q, r, "dungeon",
poiIndex)` — an axis independent of the POI-type roll stream. Keeps `generatePoi` cheap, makes the
v3→v4 migration trivial (it can't roll), and gives one code path for both new and migrated dungeons.

## Generation — `js/gen/dungeon.js` (pure, node-tested)

`generateDungeon(tables, rng, ctx = {})`:
1. Roll `dungeon-size` → `{ size, levels:[min,max], rooms:[min,max] }`; `randInt` the level count.
2. Per level: roll `dungeon-theme`; build the level encounter table by sampling 4–6 **distinct**
   creatures from `creatures.json` (reused) keeping base weights; `randInt` the room count; per room
   roll `dungeon-room` for `content`+`treasureChance`, draw `monster` from the level's own encounter
   table when `Monster`, and set `treasure = rng() < treasureChance`.

Weighted picks live in JSON; counts/sequencing live in the generator (same split as `hex.js`).

## Data tables (`/data`)
- `dungeon-size.json` — weighted small→large; `value:{ size, levels:[min,max], rooms:[min,max] }`.
- `dungeon-theme.json` — system-agnostic level themes.
- `dungeon-room.json` — OSR stocking; `value:{ content, treasureChance }` (Monster/Trap/Empty/Special).

Added to `HEX_TABLE_IDS` in `js/ui/app.js`.

## Schema + migration
- `SCHEMA_VERSION` 3 → 4 (`js/world/world.js`).
- `migrateWorld` v3→v4 (`js/data/portability.js`): drop any `poi.detail.stub`; the detail view
  generates `detail.dungeon` on first open.

## Detail view (UI slice)
- `js/ui/panel.js`: dungeon POI drill-in renders size + per-level `<details>` (theme, room list,
  random-monster table) instead of the old stub line.
- `js/ui/app.js`: `onSelectPoi` becomes async — a dungeon POI without `detail.dungeon` loads tables,
  `generateDungeon(...)`, assigns, persists, then renders.
- `css/app.css`: light `.dungeon-level` / `.room-row` styling.

## Tests
- `test/dungeon.test.js` — determinism; level/room counts within size ranges; distinct non-empty
  encounter tables; Monster rooms drawn from the level pool; themes from the table.
- `test/poi.test.js` — dungeon POIs carry no `detail.stub`/`detail.dungeon` at roll time.
- `test/migration.test.js` — v3 dungeon-stub world migrates to v4 with the stub dropped; v2 lands on
  the current version.

---

# Arc 4.5–4.8 — Themed, explorable dungeons

User-confirmed expansion: a **Dungeon View** with a per-level **map** (rooms + corridors), themed
**monster families** with within-level cohesion, and **dungeon themes** that drive content. The
explorable POI types (ruin/cave/mine) are **merged into `dungeon` as themes**.

### 4.5 — Themes + POI-type merge (schema v5) ✅ built
- `data/poi-types.json`: dropped ruin/cave/mine (now themes). `data/dungeon-theme.json`: rebuilt as
  the canonical **theme manifest** (Ruin, Abandoned mine, Cave complex, Forgotten tomb, Mausoleum,
  …); no longer rolled per level.
- `js/gen/terrain-profile.js`: folded ruin/cave/mine into a single per-terrain `dungeon` weight; new
  `DUNGEON_THEME_BIAS` (terrain → theme weights) + `dungeonThemeTable(terrain)`.
- `js/gen/poi.js`: dungeon POIs roll a terrain-biased `detail.theme` at POI-roll time (drives the
  map glyph); flavor simplified.
- `js/gen/dungeon.js`: one theme per dungeon (from `ctx.theme`), inherited by every level; returns
  top-level `theme`.
- `js/ui/poi-style.js`: `THEME_GLYPHS` + `glyphForDungeon` + `glyphForPoi(poi)` (theme glyph for
  dungeons). `map.js` / `panel.js` use `glyphForPoi`; panel header shows the theme.
- Schema **4 → 5**; `migrateWorld` v4→v5 converts ruin/cave/mine POIs → themed dungeons.
- `js/ui/app.js`: passes `theme` into lazy `generateDungeon`, backfills legacy dungeons' theme.
- Tests updated (poi, migration, terrain-profile) + glyph/manifest coverage. **92 passing.**

### 4.6 — Monster families + within-level ecology (node-tested) ✅ built
`data/monster-families.json` (7 families with weighted members + an elite) + `data/dungeon-family
.json` (theme → family weights). `dungeon.js` picks a theme-appropriate family per level, samples
its members for the wandering table, adds an occasional **interloper** from another family, and
puts the family **elite** on the deepest level. `level.family` recorded. Tests cover cohesion
(majority in-family), theme→family lean, and determinism. **95 passing.**

### 4.7 — Layout (rooms + corridors on a grid; pure, node-tested) ✅ built
`js/gen/dungeon-layout.js` `layoutLevel(rooms, rng)` places each room as a non-overlapping rectangle
on a generously-sized grid and connects each to its nearest placed room with an L-shaped corridor
(spanning tree → all reachable). Returns `{ grid, rooms:[{n,x,y,w,h}], corridors:[{x,y}], entrance }`,
attached to each level by `generateDungeon`. Tests: deterministic, one rect/room within grid, no
overlaps, every room reachable from the entrance (flood fill), single-room/empty edge cases. **101
passing.** (4.8's renderer crops to the cell bounding box.)

### 4.8 — Dungeon View UI ✅ built
`js/ui/dungeon-map.js`: fit-to-view canvas renderer (crops to the cell bounding box; rooms tinted by
content, corridors, room numbers, entrance/selected highlight, click hit-testing). `index.html`:
`#stage` wraps the hex `#map` + an overlay `#dungeon-view` (back button, title, level switcher,
`#dungeon-canvas`). `css/app.css`: stage/overlay/toolbar styles. `js/ui/app.js`: selecting a dungeon
POI generates the interior (lazy) then `openDungeonView`; level switcher; `onRoomClick` →
`renderDungeonPanel` (panel.js) shows the room's contents; back-to-world; world-switch closes it.
Headless smoke-tested (render + click hit-testing); browser checklist handed to the user.

> Phase 4 was extended by the **4.9 depth-&-connectivity sub-project** — see
> [phase-4.9-dungeon-connectivity.md](phase-4.9-dungeon-connectivity.md).
