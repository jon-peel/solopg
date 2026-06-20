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

## Status
- **4.0** — engine + data + schema/migration + tests. ✅ built (87 `node --test` passing)
- **4.1** — detail view + lazy generation wiring. ✅ built; ◻ pending manual browser verification
- **4.2** — optional polish (only if agreed). ◻

## Deferred / backlog
- Theme-biased monster pools and terrain-biased size; dungeon-specific art; per-level reroll.
