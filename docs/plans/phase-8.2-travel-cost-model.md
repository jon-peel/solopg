# Phase 8.2 — Travel cost model

Second step of Arc A. Pure, node-only: a per-terrain travel **pace** (hexes/day, on foot) plus a
road speed discount. No UI, no world mutation — just the table + lookup functions that 8.4/8.5's
day-by-day movement will consume, and 8.3's lost-chance sits alongside.

**Status:** ✅ done.

> Plan → approve → build → `node --test` → commit/push (no manual checklist — node-only, per the
> master plan's verification table).

## Design

Reuses the terrain-key convention from `terrain-profile.js`/`radial-model.js` (`Plains`, `Forest`,
`Hills`, `Mountains`, `Swamp`, `Desert`, `Lake`, `Sea` — the literal `hex.terrain` values; `Lake`
and `Sea` are separate keys since terrain no longer uses the old `"Water"` string).

```js
export const TRAVEL_COST = {
  Plains: 4, Forest: 2, Hills: 2, Desert: 2, Swamp: 1, Mountains: 1, Lake: 0, Sea: 0,
};
export const ROAD_PACE_MULTIPLIER = 2;

export function paceFor(terrain, { road = false } = {}) { ... } // hexes/day; 0 = impassable on foot
export function daysToCross(terrain, opts) { ... } // 1/pace; Infinity if impassable
```

- **Pace, not cost-to-cross, is the primary table** — matches the master plan's own framing
  ("Pace (hexes/day, off-road)"). `daysToCross` is the reciprocal, for accumulating a multi-hex
  leg's day count in 8.4/8.5.
- **Lake/Sea = 0 pace** (impassable on foot) — naval travel is explicitly out of scope for Phase 8.
  A `road` flag doesn't override this (roads never cross water anyway, so this never comes up in
  practice, but `paceFor` stays correct if ever called directly on a water hex).
- **Road is a flat ×2 multiplier** on whatever the terrain's off-road pace would be — matches the
  doc's single illustrative constant (no per-tier highway-vs-track speed split; that's not
  specified and would be pure invention right now).
- **Getting lost (8.3)** and **the actual multi-day stepping algorithm (8.4/8.5)** are separate,
  later files/functions — this step only lays the pace table + lookup they'll both call.
- Values are the master plan's own "illustrative starting constants," explicitly flagged there for
  real-play retuning later (same as every other generation constant in this project).

## Files
- `js/gen/travel.js` *(new, pure)* — `TRAVEL_COST`, `ROAD_PACE_MULTIPLIER`, `paceFor`, `daysToCross`.
- `test/travel.test.js` *(new)* — table values; `paceFor` off-road/road/impassable; `daysToCross`
  reciprocal + `Infinity` on Sea/Lake.

## Verification
`node --test` only (per the master plan's 8.2 checklist row — no manual step).

**Verified:** `node --test` 312/312 passing (7 new in `test/travel.test.js`) — table values,
off-road pace, road doubling, Lake/Sea impassable on or off road, an unknown-terrain default, and
`daysToCross`'s reciprocal/Infinity behaviour.

## Revision (immediate follow-up, on request): party base rate / encumbrance

Before 8.3 built on top of it, the user asked for a way to set the party's overall pace, defaulting
to standard if never touched. Landed as a revision here (rather than deferred to 8.4) since nothing
consumed `paceFor`'s signature yet — cheaper to extend now than retrofit later.

- **Shape decided (user pick):** reuse the app's existing B/X travel-tip tooltip (hover the scale
  bar, Phase 7.6) — Unencumbered/Lightly loaded/Encumbered/Heavily loaded = 1 / ¾ / ½ / ¼ of full
  speed — rather than a free numeric multiplier or a flat hexes/day override.
- `ENCUMBRANCE_FACTOR = { unencumbered: 1, light: 0.75, encumbered: 0.5, heavy: 0.25 }`;
  `paceFor(terrain, { road, encumbrance })` multiplies by the tier (road and encumbrance combine
  multiplicatively); an unrecognised/absent tier falls back to `unencumbered` — today's numbers are
  completely unchanged unless a GM actively picks a different tier.
- **No schema bump.** The tier will live at `world.party.encumbrance` once there's a UI to set it,
  but it's read with a default (`encumbrance = "unencumbered"`) that covers both "never set" and
  "old world predates this field" — additive, self-healing, same pattern as `hex.locked` /
  `settlement.kind` ("absent = default state"), so no migration step was needed.
- **No UI yet, still node-only.** There's nowhere to put an actual control until movement UI exists
  — that lands in **8.4** ("Move party here"), the first step where changing the tier has any
  visible effect (a day-by-day trip log). Adding a control before then would do nothing observable.

**Verified:** `node --test` 318/318 passing (6 more new tests) — tier factors match the tooltip
ladder exactly, default/fallback behaviour, and combination with the road multiplier.
