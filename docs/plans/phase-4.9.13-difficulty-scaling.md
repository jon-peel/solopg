# Sub-plan 4.9.13 — Depth & difficulty scaling

A dungeon follow-up to [Phase 4.9](phase-4.9-dungeon-connectivity.md). Deeper = tougher (by chance,
not a floor), some dungeons just nastier, and treasure scales to match (OSR gold-is-XP). Uses the
member `tier` data from 4.9.12. (Back-compat ignored.)

## Model
- **Per-dungeon difficulty** roll → `dungeon.difficulty` ∈ soft / standard / deadly (≈25/50/25),
  giving `shift` of −1 / 0 / +1.
- **Monster target tier per level** = `clamp(1..4, depth + shift)` (absolute depth: L1→1, L4+→4). A
  level's members are re-weighted by **tier affinity** `2^(−|tier − target|)` — so a deep/deadly
  level mostly rolls tier-3/4 (gnolls, wights, ogres, wraiths), a shallow level mostly tier-1/2
  (kobolds, skeletons, giant rats). The family ceiling still applies (a bandit hideout stays
  bandits); the deepest-level **elite** is the capstone.
- **Treasure target tier per level** = `clamp(1..3, ceil(depth/2) + shift)`. The `dungeon-treasure`
  table gains a `tier` per entry; a level's treasure is re-weighted the same way, so deep/deadly
  rooms yield hoards / magic items and shallow rooms yield coins.

## Data / Gen
- `data/dungeon-treasure.json`: entry `value` → `{ kind, tier }` (coins=1, gems/supplies=2,
  hoard/magic item=3). `room.treasure` stays `{ kind, guard }` (kind = value.kind).
- `js/gen/dungeon.js`: roll difficulty; per level compute the two target tiers; `tierWeighted()`
  helper re-weights members (via `buildLevelMonsters(targetTier)`) and the treasure table; return
  `dungeon.difficulty`. Bump `DUNGEON_BUILD` 16 → 17.

## UI
`js/ui/panel.js`: show `Difficulty: <x>` in the dungeon header (and treasure already reads richer
deep down).

## Tests (`test/dungeon.test.js`)
- Average monster tier rises with depth (deepest > level-1) and with difficulty (deadly > soft).
- Treasure tier rises with depth.
- `room.treasure.kind` still comes from the table; determinism preserved.

## Verification
- **Automated:** `node --test` — tier-by-depth/difficulty assertions; existing suites green.
- **Manual checklist — "4.9.13 — Depth & difficulty scaling" (`./run-local.sh`):**
```
[ ] A multi-level dungeon: level 1 monsters are weak (kobolds/skeletons/rats), deep levels skew
    tough (gnolls/wights/ogres/wraiths)
[ ] Header shows "Difficulty: soft/standard/deadly"; deadly dungeons feel nastier top to bottom
[ ] Treasure gets richer deeper (coins up top → hoards / magic items below)
[ ] Reload → identical
```
