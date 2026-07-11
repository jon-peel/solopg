# Phase 8.13 — Faction movement & expansion (brought forward)

Makes a faction turn a **spatial** act, not just numbers moving. Per the user steer (2026-07):
**both** behaviours, **archetype-driven** — a roaming warband migrates its camp; a rooted power grows
its footprint; a hermit stays. Also does a small **strength cleanup**: strength becomes a stable,
inherent value reserved for **8.12 hook loudness** (proximity × strength) — no random drift, not
gated to expansion — because the user scoped strength to that one job.

This is the parent plan's 8.13 "roaming / region" stretch, **promoted to a committed step** and
widened to cover expansion too. Arc C hooks (8.11 `sourcePower`, 8.12 auto-fire) still follow.

**Status:** 📋 planning.

> Plan → approve → build → `node --test` → commit/push → manual checklist (project convention).

## No schema bump

Only mutates a faction's existing `holdings[]` (add/move) and leaves `strength` a plain number.
**`SCHEMA_VERSION` stays 16.**

## Archetype → mobility (a rule → JS const)

```js
const ARCHETYPE_MOBILITY = {
  "bandits": "roaming", "monstrous tribe": "roaming", "mercenary company": "roaming",
  "cult": "spreading", "thieves' guild": "spreading", "merchant guild": "spreading", "noble house": "spreading",
  "hermit order": "static",
};
// unknown archetype → "static" (safe default)
```

## What a turn does spatially (added to `tickFaction`, now `tickFaction(world, faction, rng)`)

After the goal/disposition tick (strength drift removed — see below), the faction acts by mobility:

- **roaming** — **move the primary holding** (`holdings[0]`) to a random *passable, placed* neighbour
  it doesn't already hold; if none, it stays. On a move it **drops that holding's `poiId`** (the
  warband is now in the field at a hex, not at a named POI). `origin.fromPOI` is untouched (history).
- **spreading** — **claim one new hex**: a random *passable, placed* hex adjacent to **any** current
  holding, not already this faction's, up to a `HOLDING_CAP` (proposed **6**). The "sphere" creeps
  outward one hex per turn until capped. No contraction (strength doesn't gate it, per the steer).
- **static** — nothing spatial.

**Passability** reuses travel's single source of truth: a hex is a candidate only if it's **placed**
and `TRAVEL_COST[terrain] > 0` (Sea/Lake are 0 → never stepped onto — naval travel stays out of
scope). Movement/expansion therefore stay **within the revealed map** (no lazy tile generation here —
that keeps this step bounded; a faction wandering off the known edge can be a later extension).

**Determinism** holds: the spatial pick consumes the same per-turn stream
(`subRng(seed,"factionturn",id,turnOrdinal)`) right after the disposition roll, so a turn is fully
reproducible from the world seed + state. Candidate hexes are gathered in a **sorted** order (by q
then r) before the rng pick, so the choice doesn't depend on object/iteration order.

Both entry points already pass `world`, so `advanceFactionTurn` (manual) and `advanceFactionDays`
(day-driven) both drive movement/expansion — a manual turn moves a warband too.

## Strength cleanup (per the steer: strength = 8.12 hook loudness only)

Remove the `strength += ±1` random drift from `tickFaction`. Strength stays whatever it was rolled at
creation — a stable, inherent "loudness" that 8.12 will read for auto-hook frequency. (Disposition
drift stays; only *strength* drift goes.) The panel line still shows it.

## Files

| File | Change |
|---|---|
| `js/gen/factions.js` | `ARCHETYPE_MOBILITY` + `HOLDING_CAP` consts; passability import (`TRAVEL_COST`) + `neighbors`/`axialKey` from hexgeo; `tickFaction(world, faction, rng)` gains the spatial act; drop strength drift; `advanceFactionTurn`/`advanceFactionDays` pass `world` into `tickFaction` |
| `test/factions.test.js` | movement/expansion/static tests over a small placed-hex world fixture; passability; determinism (see below) |

No UI change needed: the map already draws **every** holding (8.7's marker loop), so a moved camp or a
spreading blob shows automatically; the panel's "N holdings" + per-holding jump links (8.9) already
reflect it. (A per-move log line is possible polish, but the pure turn fns stay pure — skipped.)

## Tests (`node --test`, pure logic only)

Fixture: a small world `{ seed, hexes, factions }` with a patch of placed Plains around the origin,
one **Sea** neighbour (impassable), and at least one **unplaced** neighbour.

- **roaming** moves `holdings[0]` to a passable placed neighbour each turn; never onto the Sea hex or
  the unplaced hex; drops `poiId` on the move.
- **roaming with no passable placed neighbour** stays put (holding unchanged).
- **spreading** adds an adjacent passable placed hex per turn, up to `HOLDING_CAP`, then stops growing.
- **static** (hermit order) never changes its holdings across many turns.
- **determinism**: same world+seed → identical holdings after N turns.
- **manual `advanceFactionTurn`** also moves/expands (not just the day-driven path).

## Manual checklist (`./run-local.sh`)

```
[ ] Promote/generate a BANDITS faction, then Advance faction turn a few times → its camp marker
    hops hex to hex (roaming); it never lands on water
[ ] Generate a CULT faction, Advance turns → new holding markers bloom outward from it (spreading),
    stopping around the cap
[ ] A hermit-order faction stays put across turns
[ ] "Progress 14 days" → movement/expansion happen automatically as turns fire
[ ] Reload → the new/moved holdings persist (v16); Export→Import identical
```

## Out of scope
- **Wandering off the revealed map** (lazy-generating frontier terrain for a roamer) — later extension.
- **Contraction / losing holdings**, contested-hex resolution — not wanted now (strength doesn't gate).
- **`sourcePower` + faction hooks (8.11)** and **auto-fire hooks (8.12)** — remaining Arc C; 8.12 is
  where `strength` finally gets read (hook loudness).
