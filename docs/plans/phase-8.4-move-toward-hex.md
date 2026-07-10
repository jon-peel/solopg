# Phase 8.4 — Travel, a day at a time

Arc A's movement step, and the first consumer of 8.2's pace model and 8.3's getting-lost mechanic.

> **Redesigned mid-build (user steer).** The first cut resolved a whole multi-day trip in one click.
> The user wants the opposite: **one press = one day.** You point the party — *toward a hex* or *in a
> direction* — press, and the app shows where they ended up **at the end of that day** (terrain
> crossed, how far they got, whether they got lost). Press again for the next day. This also folds in
> what was going to be **8.5** (travel along a bearing into unexplored territory), so 8.5 is now
> delivered here rather than as its own step.

**Status:** ✅ done (rebuilt to the day-at-a-time model).

## The model

- **One press = one day.** Each travel action advances the clock by exactly one day and moves the
  party as far as their speed allows for that day's terrain — **several hexes across open Plains,
  ~one hex a day through Mountains/Swamp**, faster on a road, slower when heavily loaded. A day
  always moves **at least one hex** (a hard mountain crossing is just "one hex, a hard day"), so the
  party is never fully stuck on passable ground. Getting lost can bend the day's path off course.
- **Two ways to point them:**
  - **Travel toward a hex** — pick an already-placed destination; each day heads that way over known
    terrain (routing around water/mountains via `planRoute`). Arriving ends the trip.
  - **Travel in a direction** — an **8-point compass**: the hex grid's 6 true neighbours
    (E/NE/NW/W/SW/SE) plus **N/S**. A pointy-top hex has no true north/south neighbour, so N/S
    travel **alternates its two flanking directions hex-by-hex** (NE↔NW for north, SE↔SW for south),
    keyed on row parity so it nets a straight vertical course. Each day walks that way, **lazily
    generating new terrain** as the party pushes into the unknown (the seam hooks/dungeons already
    use).
- **No persisted "travel intent."** Each press is self-contained — "toward THIS hex, one day" or
  "THIS direction, one day" — so there's no schema addition; `world.party` stays `{q, r,
  encumbrance?}`. Re-pressing continues naturally from the party's new position.

### The day's movement budget (the one judgment call, confirmed with the user)
A day is a budget of `1.0` day. Entering a hex spends `daysToCross(terrain, {road, encumbrance})`
(8.2). Keep crossing hexes along the aim while budget remains; **always cross at least the first
hex.** So Plains (0.25/hex) → up to 4 hexes/day; Plains-on-road → 8; Mountains/Swamp (1.0/hex) → 1;
heavily-loaded Mountains → still 1 (the at-least-one rule; encumbrance only visibly slows the
faster terrains — flagged as tunable, same as every other travel constant).

### Sight — reveal what the party can see (follow-up, on request)
Travel used to reveal only the hexes actually stepped into (a 1-wide corridor). That's too stingy —
a party crossing open country can see the land for miles either side. Each travel day now reveals a
**sight disc around every hex the party stood in** (the day's origin + each hex crossed), radius by
that hex's **own terrain** — high ground sees far, forest/swamp hems you in. Values (tunable):

| Standing on | Sight radius |
|---|---|
| Mountains / Hills / Plains / Desert | 2 |
| Forest / Swamp | 1 |

`sightHexes(path)` (pure) returns the deduped union of those discs; the app lazily generates any
unplaced hexes in view (same `buildRandomHex` seam), leaving placed hexes untouched. This is fair
by construction — the neighbour-affinity terrain oracle is *built* for incremental reveal. Applies
to **both** modes (you see the country either side of a known route too). Two flagged
simplifications: no line-of-sight occlusion (a peak doesn't hide what's behind it — just a radius),
and sighted hexes are **fully** generated (settlements/POIs and all, like the Area tool) rather than
terrain-only — a "seen vs visited" distinction is a bigger change left for later.

## Design

### `planRoute` (pure) — unchanged from the first cut
A* via the shared `MinHeap`, mirroring `roads.js`'s `routeBetween` shape but costed by
`daysToCross` (so a road is naturally preferred, no separate phase). Placed hexes only; returns
`null` if unreachable. Used by "toward" to pick each day's next hex (routing around water).

### `travelDay` (pure) — the one-day stepper
Callback-driven so it stays pure and testable while the app can feed it lazily-generated terrain:
```js
travelDay(seed, day, from, { encumbrance, atGoal, nextIntended, terrainAt, roadAt })
```
- `nextIntended(cur)` → the hex the party *means* to enter next (`planRoute`'s 2nd hex for "toward";
  `cur + dir` for a bearing), or `null` (no route / stranded).
- `terrainAt(q,r)` → terrain string, or `null` if impassable/unavailable. For a bearing the app's
  callback **generates** the frontier hex here (idempotent — returns existing terrain if placed).
- Each hex: roll `rollGetLost` on the hex being entered; on a lost roll `deviateDirection` picks the
  actual step (checked passable via `terrainAt`), else hold course. Charge `daysToCross` entering.
- Stops at: `atGoal` (arrived), a water/edge block, no route (stranded), or the day's budget spent
  (with ≥1 hex guaranteed). A `MAX_HEXES_PER_DAY` guard backstops runaway loops.
- Returns `{ finalPos, hexesCrossed, daySpent, arrived, reason?, log }`; `log` is one entry per hex
  (`{q, r, terrain, road, lost, dir}`). `daySpent` is true iff ≥1 hex moved — the caller adds
  exactly **one** day when it is.

Thin wrappers: **`travelDayToward`** (builds the callbacks over a `terrainByKey` map + road set) and
**`travelDayBearing`** (fixed direction; `terrainAt` supplied by the caller so the app can generate).

## UI

| Where | What |
|---|---|
| Detail tab (selected hex) | **"Travel toward this hex"** (new) + **"Place party here"** (8.1 teleport, kept) — both hidden once the party is already there |
| **Travel tab** | Encumbrance `<select>`; an **8-point compass rose** (the 6 hex directions + **N/S**) that travels a day per press; the **last day's report** (headline + per-hex lines, lost days highlighted), replaced each press; an empty state before any travel |
| After any travel press | jumps to the Travel tab; the Day readout advances by 1 (only if a day was actually spent) |

The last-day report and `sessionDay` stay **app.js-only ephemeral state** (not persisted); the party
*position* is persisted, and a bearing's newly-generated hexes persist (integrated by the usual
`syncRivers`/`syncRoads` in `persistAndRefresh`).

## Files
- `js/gen/travel.js` — remove `planMoveToward`; add `travelDay`, `travelDayToward`, `travelDayBearing`
  (keep `planRoute`, `roadHexKeySet`, and the 8.2/8.3 primitives).
- `js/world/world.js` — `setPartyEncumbrance` (from the first cut, unchanged).
- `js/ui/panel.js` — Travel tab: direction rose + last-day report; Detail: "Travel toward this hex".
- `js/ui/app.js` — `onTravelToward` (over placed terrain) and `onTravelDirection(dir)` (loads tables,
  `terrainAt` lazily `buildRandomHex`+`addHex` on the frontier); one day per press; `onSetEncumbrance`.
- `test/travel.test.js` — replace the `planMoveToward` suite with `travelDay`/`travelDayToward`
  (crosses several Plains in a day, one hex on Mountains, arrives when close, stranded, water-block)
  and `travelDayBearing` (steps a fixed direction, generates via the `terrainAt` callback, deviates
  on a lost roll). Keep the `planRoute` tests.

## Verification (manual, via `./run-local.sh`)
```
8.4 [ ] "Travel toward this hex" on a distant known hex → Travel tab shows the day's march (1 press
        = 1 day); press again to continue; arriving ends it; a road day covers more ground
    [ ] The 6-direction rose walks a day that way; walking off the generated edge reveals new terrain
    [ ] Heavier encumbrance covers fewer hexes per day; getting lost sometimes bends the day's path
    [ ] "Place party here" still teleports instantly; Day readout +1 per travelled day, resets on reload
```

## Verified

`node --test`: 347/347 passing (18 in `test/travel.test.js` cover the new model — `travelDayToward`
covering several Plains hexes in a day, a single Mountains hex (at-least-one rule), a road day
covering more ground with no lost rolls, heavier encumbrance covering fewer hexes, arriving mid-day,
determinism, and `stranded` with no day spent; `travelDayBearing` stepping a fixed direction while
generating frontier terrain through the callback, blocking on water with no day spent, a straight
unlost day ending due-east, and a swept case confirming a lost roll bends the day's path; the
`planRoute` suite retained).

Manual pass via a headless-browser smoke test (Playwright): the Detail tab shows "Travel toward this
hex" + "Place party here"; one press of Travel-toward advances the clock exactly one day, jumps to
the Travel tab, and reports the day's march (with amber "drifted …" lines on a lost roll), arriving
when the target is within a day; the Travel tab's compass rose walks a day per press — three East
presses moved the party from (2,-1) to (8,-2) over Day 1→4, **visibly growing the map eastward** as
new terrain was generated on the frontier. No console errors beyond the pre-existing `favicon.ico`
404.

**N/S follow-up (user request):** the rose became an **8-point compass** — the 6 hex directions plus
**N/S**, which alternate their flanking hexes (NE/NW, SE/SW) by row parity for a straight vertical
course (`travelDayBearing` now takes `bearing` = 0-5 or `"N"`/`"S"`). Verified: `node --test`
350/350 (5 new N/S cases — alternation, straight-vertical net, row-parity statelessness across
presses); headless pass showed all 8 rose buttons and N/S travel growing the map north/south with
correct reports.

**Sight follow-up (user request):** `SIGHT_RADIUS`/`sightRadius`/`sightHexes` added to `travel.js`;
`app.js`'s `revealSightAlong` reveals the sight swath after each travel day (both modes). Verified:
`node --test` 356/356 (6 new sight cases — radius-by-terrain, disc size/containment, dedup along a
path, empty-path); headless pass — travelling East four days revealed a **wide multi-hex band** of
varied terrain (plains/desert/mountains/forest) rather than a 1-wide line, confirming the party now
sees the countryside as it moves.
