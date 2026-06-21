# Sub-plan 4.9.5 — Richer room contents

Part of [Phase 4.9](phase-4.9-dungeon-connectivity.md). Replaces the bare room fields
(`monster` string, `treasure` boolean, unspecified `Special`/`Empty`) with **generated detail** so
each room reads like a stocked key entry.

## Room model (redesign — no back-compat)
```js
room = {
  n, content,                               // content: Monster | Trap | Empty | Special
  monster: { name, number, status } | null, // Monster rooms
  trap:    { name, trigger, effect } | null,// Trap rooms
  special: "…" | null,                       // Special rooms
  dressing:"…" | null,                       // Empty rooms (sensory flavour)
  treasure:{ kind, guard } | null,           // Monster/Trap/Empty rooms, by chance (not Special)
}
```

## Data (new JSON tables in `/data`, canonical schema)
- `dungeon-trap.json` — value `{ name, trigger, effect }` (pit/dart/gas/glyph/collapse…).
- `dungeon-special.json` — value string (altar, fountain, statue, prisoner, puzzle, portal, well…).
- `dungeon-dressing.json` — value string (rubble, dripping water, old bones, scorch marks, draft…).
- `dungeon-treasure.json` — value string `kind` (coins, valuables, a magic item, supplies…).
- `dungeon-treasure-guard.json` — value string `guard` (in plain sight, hidden, locked away,
  trapped, guarded).
- `dungeon-monster-status.json` — value string (asleep, alert, feeding, on guard, squabbling,
  wounded, wandering).

All added to `HEX_TABLE_IDS` (`js/ui/app.js`) and the test loader.

## Generation (`js/gen/dungeon.js`)
Per room, by `content`: Monster → `{name=encounter roll, number=randInt(1,6), status=roll}`;
Trap → `dungeon-trap` roll; Special → `dungeon-special` roll; Empty → `dungeon-dressing` roll. Then
treasure (non-Special) by the existing `treasureChance`: `{ kind=roll, guard=roll }`. Reuse
`rollTable`/`randInt`. Bump `DUNGEON_BUILD` 9 → 10 (self-heal). *(Theme hazards / depth scaling stay
deferred.)*

## UI (`js/ui/panel.js`)
`renderDungeonPanel` room block shows the rich lines: `Monster: 3× Goblins (asleep)`,
`Trap: Pit — pressure plate; 10 ft drop`, `Special: …`, the dressing line for Empty, and
`Treasure: Valuables (hidden)` when present. Fix the legacy `appendDungeon` summary to read
`room.monster.name` (the field is an object now). Map tinting still keys off `room.content` (no
change).

## Tests (`test/dungeon.test.js`)
Load the new tables; assert Monster rooms have `monster.{name(in encounters),number 1–6,status}`,
Trap rooms have `trap.{name,trigger,effect}`, Special rooms a `special` string, Empty rooms a
`dressing` string, and treasure (when present) is `{kind,guard}` and never on Special. Update the
existing "monster drawn from encounters" check to `room.monster.name`.

## Verification
- **Automated:** `node --test` — new content-detail assertions; all prior suites green.
- **Manual checklist — "4.9.5 — Richer room contents" (`./run-local.sh`):**
```
[ ] Enter a dungeon, click rooms of each type:
    Monster → "Monster: N× <creature> (status)"
    Trap → "Trap: <name> — <trigger>; <effect>"
    Special → a specific feature (altar/fountain/…)
    Empty → a dressing line (not just "Empty")
[ ] Treasure rooms show "Treasure: <kind> (<guard>)", never on a Special room
[ ] Reload → identical detail (deterministic)
```
