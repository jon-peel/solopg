# Phase 8.3 — Getting lost

Third step of Arc A. Pure, node-only: a per-terrain chance of drifting off course, rolled once per
day of travel, off-road only. Sits alongside 8.2's pace table in `js/gen/travel.js`; 8.4/8.5's
day-by-day movement will call both together (advance the pace, then check whether that day's step
went sideways).

**Status:** ✅ done.

> Plan → approve → build → `node --test` → commit/push (no manual checklist — node-only).

## Design

Two new exports in `js/gen/travel.js`, matching the master plan's anticipated function names:

```js
export const LOST_CHANCE = {
  Plains: 1/6, Forest: 2/6, Hills: 2/6, Desert: 2/6, Swamp: 3/6, Mountains: 3/6, Lake: 0, Sea: 0,
};

export function rollGetLost(seed, day, q, r, terrain, { road = false } = {}) { ... } // boolean
export function deviateDirection(seed, day, q, r, intendedDir, isPassable = () => true) { ... } // 0-5
```

- **d6-flavoured**, matching the existing B/X travel-tip tooltip's style: Plains 1-in-6, Forest/
  Hills/Desert 2-in-6, Swamp/Mountains 3-in-6 — the master plan's own illustrative numbers.
- **Always false on a road** (`road: true` short-circuits, matching "roads are also faster" from
  8.2) and **always false where `LOST_CHANCE` is 0** (Lake/Sea — moot anyway, since pace there is
  already 0/impassable; included for table completeness, not because travel there can happen).
- **Deterministic per (day, q, r)**, via `subRng(seed, "travel", day, q, r)` (the master plan's own
  suggested key) — same day at the same position always rolls the same, order-independent of when
  it's actually simulated.
- **Deviation, not a random direction**: `deviateDirection` picks one of the **two hex-directions
  adjacent to the intended bearing** in `NEIGHBOR_DIRS`' fixed cyclic order (`intendedDir ± 1 mod
  6`) — never the opposite direction, never a fully random one of all 6. A coin flip (from the same
  deterministic stream) picks which side; if that hex is impassable (checked via an injected
  `isPassable(dir)` predicate — kept as a callback rather than importing world/terrain lookups here,
  so this module stays pure and the caller decides what "impassable" means, including for
  not-yet-generated frontier hexes in 8.5), it swaps to the other side. **Edge case the plan doesn't
  specify:** if *both* adjacent hexes are impassable, `deviateDirection` falls back to the original
  `intendedDir` (hold course) rather than looping or picking further afield — simplest safe default,
  flagged here for the record.
- **Two separate rolls, not one combined function** — `rollGetLost` and `deviateDirection` stay
  independent (matching the master plan's own file/function inventory) so each is independently
  testable; a caller in 8.4/8.5 does `rollGetLost(...) && deviateDirection(...)`.

## Files
- `js/gen/travel.js` — add `LOST_CHANCE`, `rollGetLost`, `deviateDirection` (alongside 8.2's pace
  exports).
- `test/travel.test.js` — determinism; road/impassable-terrain always false; empirical rate matches
  `LOST_CHANCE` within tolerance over many sampled days/positions (same style as `affinity.test.js`'s
  probability sweeps); `deviateDirection` only ever returns an adjacent direction (never the same or
  opposite one), swaps sides when the first pick is blocked, and falls back to `intendedDir` when
  both sides are blocked.

## Verification
`node --test` only (per the master plan's 8.3 checklist row — no manual step).

**Verified:** `node --test` 328/328 passing (10 new) — `LOST_CHANCE` table values; `rollGetLost`
determinism, always-false on a road, always-false where the chance is 0 (Lake/Sea), and an
empirical-rate sweep (4000 sampled day/position combos per terrain, within 3% of the documented
d6 odds for both a low-chance terrain (Plains) and a high-chance one (Mountains)); `deviateDirection`
determinism, adjacency-only output (never the intended or opposite direction, checked for all 6
starting bearings), swapping sides when the first pick is blocked, and the both-sides-blocked
fallback. All seeded (no `Math.random`), so none of this is flaky across runs.
