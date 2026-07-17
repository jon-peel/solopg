# Phase 8.19 — Seats, Sphere of Influence, and probabilistic contested expansion

> **✅ Built (as-built).** Shipped as designed — all five chunks (A probabilistic expansion, B seatless
> birth + seating, C seat defence, D relocate-or-dissolve, E delete-faction). `js/gen/factions.js`:
> `EXPANSION_CHANCE`/`expansionChance`, `SEAT_SITES`/`isValidSeat`, `expand` (replaces `moveOrSpread`;
> exported for tests), `SEAT_DEFENSE`, `SOI_DISRUPTION`/`relocateSeat`, `dissolve`, seat backfill in
> `tickFaction`; `FACTION_BUILD` → 2. `js/ui/app.js` seats on a valid birth site, occupies on
> `seated`/`relocate`, un-tags POIs on `eliminated`/delete; `js/ui/panel.js` gains a two-step
> **Delete faction**. Schema stays **v16**.
>
> **Follow-ons (post-plan, by play feedback):** (1) a rank-and-file faction **garrisons** the
> dungeon/tower it holds (its people hold the frontier + patrol; native ecology underneath) —
> `garrison` spec into `generateDungeon`/`generateTower`, `garrisonFor` in `app.js`; `DUNGEON_BUILD` 21,
> `TOWER_BUILD` 2. (2) A seat change now costs **strength as well as SOI** (`disruptSeat`, one shared
> rule), and a **GM can reseat by hand** from the hex Detail tab (`reseatFaction`, two-step confirm).
> Suite green at 431 `node --test`.

> **Self-contained.** Read *Orientation* and *Model* first, then build the chunks in order. Every
> design choice below is decided; you should not need to invent behaviour. This reworks the faction
> **turn** and the **holdings model**, building on 8.15 (the expansion engine), 8.17 (a POI's occupant
> follows its faction), and 8.18 (a lord infuses its interior) — all unchanged except where noted.

---

## Orientation — what exists today (`js/gen/factions.js`, `js/ui/app.js`)

- A **faction** is `{ id, name, archetype, disposition, goal, strength, holdings:[{q,r,poiId?}], clock,
  origin, status }`. `holdings[0]` is treated informally as the seat/lair. `FACTION_BUILD` stamps the
  shape and self-heals older factions on load (no world-schema migration).
- The **turn** (`tickFaction` → `moveOrSpread`, reached via `advanceFactionTurn` / `advanceFactionDays`)
  currently splits behaviour by `ARCHETYPE_MOBILITY`:
  - **roaming** (bandits / monstrous tribe / mercenary company) — moves a single camp (`holdings[0]`),
    emitting a `move` event.
  - **spreading** (everyone else) — grows into an empty adjacent hex (`claim`), or **contests** a
    rival's border hex with a strength-weighted roll `atk/(atk+def)` (`takeover` on a win — the loser
    loses the hex; `repelled` on a loss). A faction reduced to **0 holdings** becomes `status:"destroyed"`
    (`eliminated`).
- **Every turn the faction always acts** if it has a candidate hex — expansion is *deterministic*, not
  a probability, and every archetype moves at the same cadence (one hex per turn).
- **8.17** (`occupyPoiForFaction` / `applyFactionOccupancy`, `js/ui/app.js`): a POI's occupant already
  follows its faction — seating on a POI (generate/promote) is deterministic, and spreading onto a POI
  has a **25 %** chance (`OCCUPY_ON_SPREAD_CHANCE`) to take it over. This is archetype-agnostic.
- **8.18**: a lord (lich/necromancer/vampire/dragon/hag) infuses its dungeon/tower interior. Keyed off
  `poi.occupant.factionId` → `overlordFor`. Unchanged here.
- `js/world/world.js` has `addFaction` / `getFactions` / `removeFaction`. The Factions tab renders a
  card per faction (`renderFactionsPanel`, `js/ui/panel.js`) with an "Advance faction turn" button.

## Model — **seat + SOI**

Introduce a formal **seat** (a faction's HQ) distinct from its **sphere of influence (SOI)**:

- `faction.holdings[]` **= the SOI** — every hex the faction influences (unchanged shape).
- **New:** `faction.seat = { q, r, poiId? } | null` — which holding is the HQ. The seat hex is always
  **also in `holdings`**. `null` = **seatless** (a young faction with only raw influence, no base yet).
- A valid **seat site** is a hex carrying a **POI or settlement** that the archetype is allowed to seat
  on (see `SEAT_SITES`). The seat is where the faction is "based"; the SOI is where it merely reaches.

**Schema:** additive field → **bump `FACTION_BUILD`** (a stamp, not a migration). On load, a faction with
no `seat` **backfills**: `seat = holdings[0]` if that hex is a valid seat site, else `seat = null`
(seatless). Leave `SCHEMA_VERSION` at 16.

---

## Chunk A — probabilistic, per-archetype expansion (retire roam/spread)

Make expansion a **probability per faction turn**, varying by archetype, and **unify all factions onto
SOI growth** (a bandit gang now accumulates bases like everyone else — the "second base" idea — rather
than shuffling one camp).

- **Retire `ARCHETYPE_MOBILITY` and the roaming branch.** Every faction spreads. `moveOrSpread` becomes
  `expand(world, faction, rng)`: pure SOI growth (claim empty ground; else contest a rival border hex).
  The `move` event kind is retired (nothing emits it); `claim` / `takeover` / `repelled` / `eliminated`
  stay. Update `logFactionEvents` (drop the `move` line) and remove the roaming tests.
- **Per-turn expansion gate.** In `tickFaction`, after the goal-clock tick + disposition drift, draw the
  expansion roll **first**, then only call `expand` on success:
  ```
  if (rng() < expansionChance(faction)) events = expand(world, faction, rng);
  ```
  Keep the rng draw order fixed (drift → expansion gate → pick → contest) for determinism.
- **`expansionChance(faction)`** = a per-archetype base (tunable JS const), optionally nudged by goal
  progress (a faction near its doom-clock pushes harder). Defaults:
  ```
  EXPANSION_CHANCE = { cult:.7, "monstrous tribe":.65, bandits:.6, "thieves' guild":.55,
    "mercenary company":.55, "merchant guild":.5, "noble house":.4, rebellion:.5,
    necromancer:.3, lich:.3, vampire:.3, hag:.35, dragon:.25 }   // fallback .4
  ```

### Chunk A tests
- A high-chance archetype grows faster than a low-chance one over many seeded turns (statistical).
- With the gate failing (rng ≥ chance) a turn produces **no** spatial event but still ticks the goal.
- Determinism unchanged for a given seed; contested-takeover still moves the hex loser→winner.

---

## Chunk B — the seat: seatless birth, seating on first site, seat-type rules

- **`SEAT_SITES`** (rule, JS const) — what an archetype may seat on:
  - **settlement *or* POI:** bandits, cult, thieves' guild, merchant guild, noble house, mercenary
    company, rebellion.
  - **POI only (a lair, never a town):** monstrous tribe.
  - **lords:** their bound site from 8.16 (`eligibleLords`) — lich/vampire/dragon → dungeon,
    necromancer → tower, hag → swamp POI.
  `isValidSeat(faction, hex)` → does the hex carry a settlement/POI of an allowed kind?
- **Seatless birth.** `generateFaction` no longer forces a seat. On creation:
  - created **on** a valid seat site → `seat` = that hex (and 8.17 occupies its POI, as today).
  - created on a **bare** hex → `seat = null` (SOI only).
- **Seating on first site.** In `expand`, whenever a **seatless** faction claims/takes a hex that
  `isValidSeat`, set that hex as the **seat** (the first base wins) and occupy its POI (reuse 8.17).
- `onGenerateFaction` / `promoteFaction` set the seat accordingly; a promoted lord's seat is its lair.

### Chunk B tests
- A faction generated on a bare hex is **seatless**; after enough turns spreading onto a POI/settlement
  it **gains a seat** at the first such hex.
- A faction generated on a POI is **seated there** immediately.
- `isValidSeat` respects the archetype rule (a monstrous tribe won't seat in a settlement; a thieves'
  guild will).

---

## Chunk C — the seat is harder to take than the SOI

Taking a rival's **SOI** hex uses the existing strength-weighted contest. Taking a rival's **seat** is
**much rarer** — possible, but defended.

- In `expand`'s contest, when the target hex **is the defender's seat**, multiply the defender's
  effective strength by **`SEAT_DEFENSE` (= 6, tunable)** before the roll:
  `atk / (atk + def·SEAT_DEFENSE)`. (A strong attacker still has a small, non-zero chance.)
- Prefer non-seat rival hexes when both are available (attack the edges before the capital).

### Chunk C tests
- Over many seeded contests, a rival's **seat** falls far less often than an equally-defended **SOI**
  hex; both are strength-weighted and deterministic for a seed.

---

## Chunk D — seat falls → relocate + SOI disruption, or dissolve

When a faction **loses its seat hex** (a rival `takeover` on it):

1. **Relocate.** Among the faction's remaining holdings, pick the **nearest valid seat site**
   (`isValidSeat`, nearest by `axialDistance` to the lost seat). If found → it becomes the new `seat`.
2. **Disruption.** **Halve the SOI:** keep the new seat, then drop the farthest ~half of the other
   holdings (round down). Log it: *"‹Faction› is driven from its seat at ‹A› and regroups at ‹B› — its
   reach falters."*
3. **Dissolve** when there is **no valid relocation site**, or the faction has **no holdings left**.
   `dissolve(faction)` → `status:"destroyed"` + `eliminated` event, and clears the faction's
   `occupant.factionId` tags on any POIs it held. This **replaces** the current bare "0 holdings →
   destroyed" path (one dissolution route).

Emit this from the `takeover` handler in `expand` (the winner reports the takeover; the loser then runs
relocate-or-dissolve). Order the rng-free so it stays deterministic.

### Chunk D tests
- Losing a seat with a valid fallback holding → the seat **moves** to the nearest valid site and the SOI
  **halves**; the faction stays active.
- Losing a seat with **no** valid fallback → the faction **dissolves** (`destroyed` + `eliminated`), and
  its held POIs lose the `factionId` tag.
- Reaching 0 holdings still dissolves (same path).

---

## Chunk E — delete a faction (UI)

- A **"Delete"** action on each faction card (`renderFactionsPanel`, with a confirm) → `onDeleteFaction`
  in `app.js`: `removeFaction(current, id)`, clear its POI `occupant.factionId` tags, persist + refresh.
- Deleting is a GM override (distinct from in-world dissolution): the faction simply vanishes.

### Chunk E tests
- Deleting removes the faction from `getFactions` and un-tags its POIs; other factions are untouched.

---

## Numbers (all tunable JS consts)

| Const | Default | Meaning |
|---|---|---|
| `EXPANSION_CHANCE[archetype]` | see Chunk A | per-turn chance a faction expands |
| `SEAT_DEFENSE` | 6 | defender strength ×-multiplier when its **seat** is attacked |
| `SOI_DISRUPTION` | 0.5 | fraction of non-seat holdings kept after a seat falls |
| `OCCUPY_ON_SPREAD_CHANCE` | 0.25 (existing) | chance a spread onto a POI takes it over (8.17) |

## Files touched

| File | Change |
|---|---|
| `js/gen/factions.js` | retire `ARCHETYPE_MOBILITY`/roaming; `expand` + `expansionChance`; `seat` field + `isValidSeat` + `SEAT_SITES`; seat defense in the contest; relocate-or-`dissolve`; seatless birth; `FACTION_BUILD` bump + backfill |
| `js/ui/app.js` | seat-aware `onGenerateFaction`/promote; drop the `move` log; `onDeleteFaction`; centre-on-seat |
| `js/ui/panel.js` | faction card: seat/SOI readout + a **Delete** button |
| `test/factions.test.js` | rework roaming→expansion tests; seat, defense, relocation, dissolution tests |

## Manual verification (`./run-local.sh`, browser)

```
[x] Generate a faction on a BARE hex → card shows "seatless"; advance turns → it seats on the first
    POI/settlement it reaches.
[x] Generate two spreading factions apart → they expand at visibly different rates (probabilistic).
[x] One faction contests and takes another's SOI hex → the loser's holdings drop by one.
[x] Push an attacker into a rival's SEAT repeatedly → it usually holds; occasionally falls. When it
    falls, the loser relocates to a nearby site and its SOI roughly halves (log line prints).
[x] Corner a faction with no fallback seat → it dissolves; its POIs lose the faction tag.
[x] Delete a faction from its card → it's gone; its POIs are un-tagged; others unaffected.
[x] Reload + Export→Import: seats/SOI round-trip (still schema v16; FACTION_BUILD self-heals old saves).
[x] GM manual reseat: on a held, seat-worthy hex, "Make this ‹faction›'s seat" moves the HQ and its
    reach + strength both fall (two-step confirm).
[x] A rank-and-file faction that holds a dungeon/tower garrisons it (its creatures hold the frontier +
    patrol); a held dungeon keeps native monsters in its depths; a lord fully re-themes instead.
```

## Decisions locked

1. **Roam/spread is retired** — every faction grows an SOI; archetype only sets the **expansion chance**.
2. **seat ⊆ holdings**, plus a `seat` pointer; **seatless** is valid (`seat:null`).
3. **Seat defense** = a strength ×-multiplier in the existing contest (rare but possible to fall).
4. **Seat falls → relocate to nearest valid site + halve SOI AND strength**; **no site / no holdings →
   dissolve** (the single dissolution path). The same disruption applies to a **GM manual reseat**.
5. **Seatless factions seat on the first valid site** their expansion reaches.
6. **Delete-faction** is a GM override, separate from in-world dissolution.
7. Additive `seat` field; **bump `FACTION_BUILD`**, backfill on load; `SCHEMA_VERSION` stays 16.

## Out of scope (deliberate)

- **Emergent rebellion** (auto-spawn against an oppressor) — still a later idea.
- ~~**Generalising 8.18 interior infusion to non-lord factions**~~ — **shipped as a follow-on:** a
  rank-and-file faction (cult / tribe / bandits / …) that holds a dungeon or tower now **garrisons**
  it — its people hold the entrance frontier and patrol as wandering monsters, while the native
  ecology stays underneath (a garrison *augments*; only a lord *re-themes*). `generateDungeon` /
  `generateTower` take a `garrison` spec; `app.js` `garrisonFor(poi)`. `DUNGEON_BUILD` 21,
  `TOWER_BUILD` 2.
- **Diplomacy / alliances** between factions — contention is the only inter-faction resolver here.
- **Multi-hex sieges** beyond single-hex contest — out of scope, as in 8.15.
