# Phase 8.4 — Move toward a hex

Fourth step of Arc A, and the first consumer of 8.2's pace model and 8.3's getting-lost mechanic.
The GM picks an already-placed destination hex; the engine resolves the whole trip — route,
day-by-day pace, lost rolls — in one action, and reports what happened.

**Status:** ✅ done.

> Plan → approve → build → `node --test` → commit/push → manual checklist.

## Decided (user steer, this session)
1. **8.1's stopgap "Place party here" (instant teleport) stays**, alongside the new **"Move party
   here"** (simulated, costs days, can end up lost) — both live in the Detail tab for a selected
   hex. Teleport is a GM-override; Move is the real mechanic.
2. **A dedicated Travel tab** (alongside Detail/Hooks/Pinned) holds the party's **encumbrance**
   setting and the **last trip's day-by-day report** — replaced (not appended) on every new trip.
   Completing a trip auto-switches to this tab (same convention as generating a hook jumping to the
   Hooks tab, 3R.8).

## Design

### Route-finding — `planRoute` (pure)
Mirrors `roads.js`'s `routeBetween` shape exactly (A* via the shared `MinHeap`, a `g`/`came`/`closed`
map trio, an admissible heuristic scaled by the cheapest possible per-hex cost) — same algorithm,
different cost function. Roads.js's own `routeBetween`/`hexCost` aren't exported (and answer a
different question — cost to *build* a road, not to *travel* one), so this is a **new function that
reuses the shared `MinHeap` + mirrors the proven A* shape**, not a fork of private road-building
logic.

- **Cost to enter a hex** = `daysToCross(terrain, { road })` (8.2) — so road hexes are naturally
  preferred by a cost-minimizing search (half the days), no separate "prefer roads" phase needed.
- **Placed hexes only.** `terrainByKey` (built the same way `syncRivers`/`syncRoads` already build
  it in `app.js`) only has entries for placed hexes — any coordinate outside it is treated as
  impassable, so a route can never cross an unplaced gap. That's 8.5's territory (lazy generation
  along a bearing), not this one's. If no route exists, `planRoute` returns `null`.
- **Encumbrance is deliberately left out of route-finding.** It's a flat multiplier applied equally
  to every terrain/road combination (8.2), so it can never change which path has the lowest *total*
  cost — only the day-by-day simulation needs it, to convert the chosen route's days into the
  actual elapsed time.

### Day-by-day simulation — `planMoveToward` (pure)
The master plan's own anticipated name for this piece. Walks the route one hex at a time:

- **Re-plans only when needed** — keeps the last computed path and only calls `planRoute` again on
  the first step or right after a deviation (self-correcting, but not wastefully re-solving A* every
  single day when nothing went wrong).
- **One lost-roll per hex crossed, not per calendar day.** The plan's wording ("rolled once per day
  of a leg") is ambiguous once pace varies by terrain (a Plains day can cover 4 hexes) — resolved by
  making risk scale with **distance** (one roll per hex, regardless of pace), and elapsed **time**
  scale separately via `daysToCross`. This also avoids the perverse alternative where fast travel
  would need *fewer* lost-rolls than slow travel over the same distance. The `day` argument threaded
  into `rollGetLost`/`deviateDirection` for the Nth hex crossed is `startDay + n` (the actual session
  day the trip started on, plus a sequence counter) — so a repeat trip from the same hex on a later
  day rolls independently, not identically.
- **Cost is charged entering a hex** (matches `roads.js`'s own "cost to ENTER a hex" convention),
  using that hex's terrain + whether it's on a road (`roadHexKeySet`, a small new helper scanning
  `world.roads[].path` — the equivalent Set roads.js builds internally but doesn't export).
- **On a lost roll**, `deviateDirection` picks the actual hex stepped into instead of the intended
  next one (checked passable = placed and not Lake/Sea); if it returns the *same* direction anyway
  (both sides were blocked), the step is logged as "on course" rather than "lost" — nothing actually
  changed.
- **Stops** when the party reaches the target (`arrived: true`), when `planRoute` can't find a route
  from the *current* (possibly deviated) position (`arrived: false, reason: "stranded"`), or after a
  generous safety cap (300 steps — nothing realistic gets close) as a defensive backstop.
- **Returns** `{ finalPos, days, arrived, reason?, log }` — `days` is the summed fractional
  `daysToCross` over every hex actually crossed, rounded up (`Math.ceil`) once at the end (not
  per-step, to avoid compounding rounding); `log` is one entry per hex crossed (`day`, `q`, `r`,
  `terrain`, `road`, `lost`, a short note).

## UI

| Where | What |
|---|---|
| Detail tab (selected hex) | "Place party here" (unchanged, 8.1) + new "Move party here" — both hidden once the party is already on that hex |
| **New Travel tab** | Encumbrance `<select>` (persists to `world.party.encumbrance`, no schema bump — additive/self-defaulting, per 8.2's revision); the last trip's day-by-day report, replaced each trip; an empty state before any trip |
| On trip completion | `setPanelTab("travel")` — jumps the GM straight to the result |

The trip report and the "last trip" data are **app.js-only ephemeral state** (like `sessionDay`) —
not persisted to `world`/IndexedDB. `sessionDay` **does** advance here (`Math.ceil(days)` added to
it) — 8.6's "Progress N days" is a separate *manual* way to advance it while stationary, not the
only way it moves.

## Files
- `js/gen/travel.js` — add `roadHexKeySet`, `planRoute`, `planMoveToward`.
- `js/world/world.js` — `setPartyEncumbrance(world, tier)` accessor (mirrors `setPartyPosition`).
- `js/ui/panel.js` — new Travel tab region/renderer (`renderTravelPanel`); Detail tab gains "Move
  party here" next to "Place party here".
- `js/ui/app.js` — `onMovePartyHere` (builds `terrainByKey`/`roadHexKeySet` from `current`, same
  pattern as `syncRivers`/`syncRoads`; calls `planMoveToward`; advances `sessionDay`; persists;
  jumps to Travel tab); `onSetEncumbrance`; tab bar gains "Travel".
- `test/travel.test.js` — `planRoute` (prefers roads, fails on an unplaced gap, ignores encumbrance
  for ranking); `planMoveToward` (determinism, arrives with no lost rolls on an all-road route,
  reports `stranded` when disconnected, `days` matches a hand-computed sum for a simple all-Plains
  leg, log length matches hexes crossed).

## Verification (manual, via `./run-local.sh`)
```
8.4 [ ] "Move party here" on a distant known town → Travel tab opens with a day-by-day log, party
        arrives (or ends up lost nearby); a road route is visibly faster and never reports "lost"
       [ ] "Place party here" still works as an instant teleport, unaffected
       [ ] Changing the encumbrance tier and moving again produces a slower/faster trip accordingly
```

## Verified

`node --test`: 342/342 passing (24 new in `test/travel.test.js` — `roadHexKeySet`; `planRoute`
null on an unplaced start/goal, trivial start===goal, null across a Sea gap, straight-line cost
matches 8.2's pace table, and a hand-verified case where it takes a longer detour because a road
makes it cheaper overall; `planMoveToward` determinism, immediate arrival at zero distance, an
all-road trip with zero lost days at the documented pace, `"stranded"` when the target is
disconnected, the log's day index starting at `startDay`, heavier encumbrance taking longer over
the same route, and a swept sample confirming a real deviation shows up on high-lost-chance
terrain).

Manual pass via a headless-browser smoke test (`python3 -m http.server` + Playwright, since this
step has real UI): selecting a non-party hex shows both "Move party here" and "Place party here";
clicking Move auto-jumps to the new Travel tab; a Sea target correctly reports "No route through
from here" (a live "stranded" case caught by accident, not staged); a reachable target arrives with
a day-by-day log (a lost day rendered in amber); the Day readout advances by the trip's day count
and resets to 0 on reload (session-only, per 8.1); changing the encumbrance-tier select and moving
again visibly changes trip duration; no console errors beyond the pre-existing unrelated
`favicon.ico` 404.
