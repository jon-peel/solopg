# Phase 8.10 — Faction turns

The capstone of Arc B — see [`phase-8-factions.md`](phase-8-factions.md). Factions stop being static
once created: on a **faction turn** their goal doom-clock ticks, their disposition occasionally
drifts, and their strength occasionally changes. Turns fire two ways: **automatically** as days pass
(the `advanceDays` chokepoint from 8.6) and via a **manual "Advance faction turn"** button (GM pacing,
independent of time). Needs 8.7 (faction objects) + 8.6 (the day chokepoint) — both done.

**Status:** 📋 planning.

> Plan → approve → build → `node --test` → commit/push → manual checklist (project convention).

## The clock tension (the real design decision) — resolved with a RELATIVE accumulator

The day (`sessionDay`) is **session-only** by the 8.1 user steer: it resets to 0 on every reload and is
never persisted. So a faction's turn bookkeeping **cannot** key off an absolute day number — after a
reload the day is 0 but the faction's history is not.

**Resolution:** repurpose the already-present `clock.sinceTurn` field from "day-of-last-tick"
(absolute — what 8.7's comment tentatively said) to **"days accumulated since this faction's last
turn"** — a *relative* counter kept in `[0, TURN_LENGTH)`. It's persisted on the faction, it's
independent of the display clock, and it survives reload cleanly. This **keeps the day session-only**
(honouring 8.1) while making faction turns durable — no need to start persisting `day`. Nothing read
`sinceTurn` before now, so repurposing it is free (no back-compat, per the project directive).

This also gives **mid-timeline fairness for free**: a faction created late starts at `sinceTurn: 0`
and only accumulates days *from its creation*, so it never retroactively "catches up" on days that
passed before it existed.

## Faction turn — what one turn does (`tickFaction`, pure)

Per the parent plan ("goal progress, occasional disposition drift, occasional strength/holding
change"). Scoped for 8.10 to goal + disposition + strength; **holding gain/loss is deferred** (adding
a holding needs a target hex / map context — that's 8.13 roaming territory, not this step):

- **Goal doom-clock**: `goal.progress = min(progress + 1, max)` — one segment per turn, the visible
  ticking clock. (Capped; a completed goal simply sits at `max` for the GM to interpret/retire.)
- **Disposition drift** (occasional, ~1-in-3): step one place along `hostile → wary → neutral →
  friendly` (random direction, clamped to the ends).
- **Strength drift** (occasional, ~1-in-3): `strength += ±1`, floored at 1.
- `clock.turns += 1`.

Change constants (drift chance, turn length) are **JS tuning consts** in `factions.js`, retunable like
every other generation number.

## Two entry points (both pure, in `factions.js`)

```js
export const TURN_LENGTH_DAYS = 7; // tunable: how many days make one faction turn

// Manual — one turn for every ACTIVE faction, independent of the day clock
// (does NOT touch sinceTurn). Deterministic: each turn seeds on the faction id +
// its turn ordinal. Returns how many factions ticked.
export function advanceFactionTurn(world, seed) { … }

// Day-driven — accumulate `days` per active faction; fire a turn for each full
// TURN_LENGTH_DAYS, carrying the remainder in sinceTurn. Returns turns fired.
export function advanceFactionDays(world, days, seed) { … }
```

Determinism: each turn uses `subRng(seed, "factionturn", faction.id, clock.turns)` — because
`tickFaction` increments `clock.turns`, consecutive turns get distinct, reproducible streams. Same
world state + seed → identical outcome (the project determinism rule).

## Wiring (app.js) — the `advanceDays` seam

`advanceDays(n)` (the single chokepoint, already routed through by travel **and** "Progress N days")
gains one line: after bumping `sessionDay`, call `advanceFactionDays(current, n, current.seed)`
(mutates `current`), and log "N faction turn(s) elapsed" when any fired.

Persistence: faction turns mutate persisted state, so the callers must save.
- **Travel** already calls `persistAndRefresh()` right after `advanceDays` — covered.
- **`onProgressDays`** currently does *not* persist (the clock was session-only). It now must:
  `advanceDays(n)` then `await persistAndRefresh()` when the world has factions. (The `sessionDay`
  itself still isn't persisted — only the faction clock/goal changes are.)
- **Manual button** → `onAdvanceFactionTurn()` → `advanceFactionTurn(current, current.seed)` →
  `persistAndRefresh()` + a log line.

## UI

- **Factions tab**: an **"Advance faction turn"** button at the top of the panel (shown when ≥1
  active faction) — faction controls stay together, same reasoning as keeping Generate/Claim on the
  panel. (Command-bar was the alternative; the tab is more contextual.)
- **Per-faction readout**: extend `factionDescription` with a turns line —
  `Turn ${clock.turns} · ${sinceTurn}/${TURN_LENGTH_DAYS} d to next` — so the panel shows goal
  progress *and* turn count / time-to-next as the parent plan asks.

## Files

| File | Change |
|---|---|
| `js/gen/factions.js` | `TURN_LENGTH_DAYS` + drift consts; `tickFaction` (pure, one faction one turn); `advanceFactionTurn(world, seed)` (manual, all active); `advanceFactionDays(world, days, seed)` (day-driven accumulator); turns line in `factionDescription`; update `clock.sinceTurn` doc comment (now a relative accumulator) |
| `js/ui/app.js` | `advanceDays` fires `advanceFactionDays`; `onProgressDays` persists when factions exist; `onAdvanceFactionTurn` handler; thread it + into the Factions model |
| `js/ui/panel.js` | `renderFactionsPanel`: "Advance faction turn" button (≥1 active faction) |
| `test/factions.test.js` | turn-math + tick tests (see below); update the `factionDescription` assertion for the new line |

## Tests (`node --test`, pure logic only)

- **Day math**: 6 days → 0 turns; 7 → 1; 14 → 2; **remainder carried** (5 then 5 = 1 turn, `sinceTurn`
  3); a fresh faction (`sinceTurn 0`) needs a full `TURN_LENGTH_DAYS` before its first turn.
- **Manual** `advanceFactionTurn`: fires exactly one turn per active faction, `clock.turns` +1,
  `goal.progress` +1, and **leaves `sinceTurn` untouched** (independent of the day clock).
- **Goal cap**: `progress` never exceeds `max`.
- **Active-only**: a `dormant`/`destroyed` faction is skipped by both entry points.
- **Determinism**: same world state + seed → identical result across two runs (deep-clone, compare).
- **Disposition drift** stays within `hostile…friendly` (never out of range) across many turns.
- **Mid-timeline fairness**: a faction added after N days doesn't retroactively fire turns for those
  N days (it only accumulates from creation).

## Manual checklist (`./run-local.sh`)

```
[ ] With a faction present, click "Advance faction turn" → goal progress +1, Turn count +1
[ ] "Progress 7 days" → each active faction advances one turn automatically (goal/turn move)
[ ] "Progress 3 days" twice → one turn fires on the second (remainder carried, not lost)
[ ] Disposition/strength occasionally shift across several turns; goal progress caps at max
[ ] Reload mid-way (e.g. after 3 of 7 days) → the faction resumes toward its next turn (not reset)
[ ] Export→Import → turn/goal/clock state identical
```

## Out of scope (Arc C and beyond)
- **`sourcePower` + faction-emitted hooks** — 8.11.
- **Auto-fire hooks on day-tick** (proximity × strength) — 8.12 (also hooks `advanceDays`).
- **Holding gain/loss / roaming** — 8.13 stretch (needs a target-hex concept).
