# Phase 8.17 — A POI's occupant follows its faction

> **✅ Built (as-built).** A retro-doc for a small faction follow-on that shipped between 8.16 and 8.19.

## What ships

When a faction takes control of a hex that carries a POI, the POI's **occupant follows the faction** —
the site is now "run by" that faction, its list label gains the faction's name, and its `occupant`
carries a `factionId` link. Two routes:

- **Seating on a POI is deterministic** — generating or promoting a faction on a POI (or, from 8.19,
  seating onto the first valid site it reaches) takes that POI over immediately.
- **Spreading over a POI is a chance** — when a faction's SOI merely rolls across a hex with a POI, it
  has a small chance (`OCCUPY_ON_SPREAD_CHANCE` = 0.25) to absorb it, seeded per (faction, hex) so it's
  reproducible.

A monster **lair** is left alone — a passing power doesn't clear a beast's den.

## Where it lives

- `js/ui/app.js`: `occupyPoiForFaction(poi, faction)` (tag the occupant + rename), `applyFactionOccupancy(events)`
  (walk a turn's `FactionEvent[]`, occupy deterministically on a `seated` claim/takeover and by chance
  on a plain spread). The `factionId` tag is what 8.18/8.19 read to infuse/garrison the interior, and
  it's cleared when the faction is eliminated or deleted.

No schema change (occupant already had a free-form shape); still v16.

## Manual verification (`./run-local.sh`, browser)

```
[x] Generate/promote a faction on a POI → the POI's list row shows "— ‹faction name›" and is run by it.
[x] Advance turns so a faction spreads across a hex with a POI → occasionally it absorbs that POI (~25%).
[x] A monster lair is never taken over by a passing faction.
[x] Delete/eliminate the faction → its POIs lose the faction tag (revert to their own occupant).
[x] Reload + Export→Import: occupant/factionId round-trips.
```
