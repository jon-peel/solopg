# Phase 8.20 — Factions decline and disband on their own

> **✅ Built (as-built).** The last faction follow-on: an organic ebb so a faction with no rivals
> doesn't grow forever and never die. Builds on the 8.19 seat/SOI model.

## What ships

Each faction turn now resolves to **at most one fortune**, with growth checked **first** so the map
still trends upward:

1. **Expansion** is rolled first (favoured, per-archetype `expansionChance`).
2. **Only if nothing grew** — the gate failed *or* there was no room — a **rank-and-file** faction has a
   small chance (`CONTRACTION_CHANCE` = 0.15) to:
   - **recede** — shed its **outermost** SOI hex (farthest from the seat; the seat is never lost this
     way). The released hex's POI tag is cleared. Event: `recede`.
   - **disband** — when worn down to just its seat (or a single-hex seatless faction), it **fades on its
     own**: `eliminated` with **no** `byFactionId` (a natural death, vs a conquest which names a
     finisher). The log reads *"fades into history"* vs *"is destroyed"*.

Emergent behaviour: thriving factions (still finding room) rarely decline; **stagnant / boxed-in ones
fade** — decline self-targets the factions already stuck. **Lair-bound lords are exempt** — a lich or
dragon holds its lair until something kills it.

Decline is **territory only** — strength changes only on seat events (the 8.19 reseat / seat-fall
disruption).

## Where it lives

- `js/gen/factions.js`: `CONTRACTION_CHANCE`, `contract(world, faction)` (recede-or-disband, rng-free,
  deterministic), gated in `tickFaction` after the expansion gate and skipped for `LORD_ARCHETYPES`.
  New `FactionEvent` kind `recede`.
- `js/ui/app.js`: `logFactionEvents` gets a `recede` line + distinguishes a natural fade from a
  conquest; `applyFactionOccupancy` un-tags a receded hex's POI.

No schema change (holdings can shrink, `status:"destroyed"` is a valid v16 shape, events are transient);
still v16.

## Numbers (tunable)

| Const | Default | Meaning |
|---|---|---|
| `CONTRACTION_CHANCE` | 0.15 | per-turn chance a non-growing rank-and-file faction recedes/disbands |

## Manual verification (`./run-local.sh`, browser)

```
[x] Box a faction in (surrounded by water/unrevealed/rivals) + Advance turns → the log shows it losing
    its grip on hexes ("recede") and eventually "fades into history" (no attacker).
[x] Give a faction open room + Advance many turns → it keeps growing overall (only the odd recede).
[x] Raise a lich/dragon and box it in → it never recedes or fades (holds its lair indefinitely).
[x] After a recede off an absorbed POI → re-open it → reverted to native occupants (tag released).
[x] A conquest still logs "is destroyed" (names the aggressor), not "fades into history".
[x] Deterministic for a seed (node --test); Reload + Export→Import unaffected.
```
