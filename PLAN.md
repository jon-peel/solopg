# World Oracle — Master Plan (Overview)

A browser-based **World Oracle** for OSR (Old-School Renaissance) solo and small-group play: a
procedural generation + record-keeping tool. A GM/solo player builds a hex-crawl world piece by
piece — terrain, settlements, points of interest, (later) dungeons, rumors — and the app
remembers the evolving map.

> **This file is the overview.** Per-step detail lives in `docs/plans/` (see
> [Roadmap & status](#roadmap--status)). Completed work is recorded in
> [`docs/plans/phases-0-3.md`](docs/plans/phases-0-3.md).

**Status (current):** Phases 0–6 complete. Phase 4 delivered the full dungeon arc (base interiors +
Dungeon View; themed/explorable 4.5–4.8 arc; the 4.9.1–4.9.14 depth-&-connectivity sub-project —
sizes, room-graphs + loops, doors/secret doors, inter-level + vertical stairs, multiple
entrances/exits, rich room contents, exploration state + GM notes, lighting + occupied frontier,
tiered monster roster + dens, depth/difficulty scaling, dice-notation treasure, named-den
signatures). **Phase 5 detailed the other POI types** (see
[phase-5-poi-detail.md](docs/plans/phase-5-poi-detail.md)): a shared, terrain-aware **Tier-1
description engine** for **shrine / camp / landmark** (`js/gen/feature-detail.js`), and **towers** as
a **Tier-2 mapped interior** (`js/gen/tower.js`) that reuses the Dungeon View with an `orientation:"up"`
flag — floors that climb, a garrison from the POI's occupant, and the master on top. **Phase 6 — Hooks complete** (Type-1 local
adventure hooks; see [phase-6-hooks.md](docs/plans/phase-6-hooks.md)): a manual **"Generate hook"** at a
town (plus **"Read map"** / **"Follow a trail"** anywhere) produces a hook of one of several **kinds** —
**known**, **distant** (lazy target-tile generation), **map** (a revealed corridor), **chain**
(a breadcrumb hunt to a named prize), local **opportunity** / **event**, two-endpoint **escort**, and
**return** (a development at a known place) — across the verbs explore / threat / rescue / warning. A
threat names its **menace** ("Threat: Bandits", tracked to its lair); threat/rescue/escort carry a
**reward** (a patron + coin, or glory). Each hook reads with the target's base name, distance in **miles**,
and tile **terrain**. A global always-visible **open-hooks list** (→ Target /
↩ Origin / Follow-the-clue) and **amber map markers** on every open target tie it together. New `world.hooks`
(schema **v6**), pure `js/gen/hooks.js`. **Phase 7 — QoL & UX started: 7.1 right-click radial menu**
is done (see [phase-7.1-radial-menu.md](docs/plans/phase-7.1-radial-menu.md)) — right-click a tile for a
**fixed-slot ring** of its actions (Terrain / POI / Settlement / Hook / Neighbours / Regenerate / Delete /
Generate); inapplicable slots are **greyed-out (never hidden)** with a reason, submenus open as a **second
outer ring**, and a submenu's "Random" anchors nearest the cursor. Pure model `js/ui/radial-model.js`
(node-tested), overlay `js/ui/radial-menu.js`; no schema change. **Phase 3R — world coherence started:
3R.1 "Generate Area" radial tool is done** (see [phase-3r-world-coherence.md](docs/plans/phase-3r-world-coherence.md)) —
folded into the existing **"Generate" slot** (Random + **Small/Medium/Large/Huge** hex-radius disc,
radius 1/2/3/15 — Huge added later as a bulk-fill/testing aid, up to 721 hexes in one click, ~36ms
measured), always **fill-empty only**; new `hexRing`/`hexDisc` geometry in `js/core/hexgeo.js`; v1 rides
current per-hex generation unchanged — it's the testing aid for 3R.2+ (terrain v2, fresh/salt water &
coastlines, rivers, roads, richer settlements). The freed-up former "Neighbours" slot is now a
`reserved` placeholder (kept so the ring's other 7 slots don't shift) awaiting a future feature (e.g.
travel). **3R.2 (audit + research + world-model decision) is done**: audited today's
generation against the code (found `terrainBias`, the neighbour-affinity multiplier, defaults to `1`
and is never set elsewhere — coherence is stuck at its weakest setting), researched external
hex-generation mechanics (AD&D DMG transition tables, Welsh Piper's hierarchical dominant-terrain,
The Alexandrian's region/chunk method, elevation+moisture Whittaker-style biome classification), built
a stats baseline (`test/stats-harness.js`, run via `node test/stats-harness.js`, **not** part of
`node --test`/`npm test` — see note below) showing a **23–25% lone-hex rate** and settlements
averaging **~1.1–1.2 hexes** apart, and **decided the world-building model: two-layer elevation +
moisture** (coordinate-hashed noise fields, order-independent by construction — feeds 3R.4's sea level
and 3R.5's downhill rivers with no rework). **3R.3 (terrain generation v2) is done**: `js/core/noise.js`
(`valueNoise2D`/`fbm2D`, 3-octave value noise, no npm deps) + `js/gen/biome.js` (`biomeAt`/
`classifyBiome`, a percentile-calibrated Whittaker-style classifier) give every hex a first-class
`elevation`/`moisture` (schema **v8**) that's a **pure function of `(seed, q, r)`** — replacing the old
neighbour-affinity roll (`weightedTerrainTable`/`TERRAIN_AFFINITY`/`terrainBias`, now deleted) outright.
Measured result: **lone-hex rate 23–25% → 2–3%**, **Mountains mean clump size 2.1 → 7.6–13.6** (real
ranges, not speckle) — see [phase-3r-world-coherence.md](docs/plans/phase-3r-world-coherence.md) for the
full before/after. **3R.4 (water v2) is done**: Water split into **Lake (fresh) / Sea (salt)** — two
full terrain values (rendering needs zero signature changes that way), sharing Water's settlement/POI
rules via a new `biasKey()` alias in `terrain-profile.js` so no bias table had to be duplicated. Since
this world is **infinite and generated incrementally** (unlike every reference generator, which
flood-fills a fixed map edge), Lake vs Sea is decided by a coarse `continent` noise field
(`js/gen/biome.js`) rather than flood-fill — order-independent by construction, with no connectivity
search or reclassification risk. **Revised after manual testing caught "inland seas"**: the first pass
decided Sea vs Lake from a field independent of elevation, so Sea read as an oversized lake with no
relationship to an actual landmass edge. Fixed by using `continent` as a pure land/ocean **gate**
(never blended into elevation) — below threshold is always Sea, otherwise the *unchanged* 3R.3 land
classifier runs, with its own low-elevation band now always meaning Lake. Verified: Sea now forms 1–3
genuinely large contiguous bodies (up to ~3200 hexes) per sample, real coastlines rather than scattered
pockets. Also added a smooth land bias around the fixed world spawn `(0,0)` — some seeds otherwise put
the origin itself in open ocean. **Sea contagion added on top**: placing (or generating) a Sea hex now
makes nearby future generation more likely to continue the coastline (`js/gen/biome.js`
`rollSeaContagion`, ~75% chance per already-placed Sea neighbour, compounding, always leaving room for
land to randomly break through) — verified end-to-end (forcing Sea then filling a Large area around it
turned the whole area to Sea in one real run). This is a deliberate, narrowly-scoped exception to
"terrain is a pure function of `(seed, q, r)`" — Sea near existing content now depends on generation
history, everything else stays position-pure. **3R.5 (rivers) is done**: `js/gen/river.js` traces
mountain-peak sources downhill (steepest descent, smoothed with fewer FBM octaves so it tracks real
landform slope) to a Lake/Sea sink, or forces a landlocked depression to become a **Lake** (no carving
in v1). A fully analytical per-hex query (scan candidate sources within a radius, trace each) measured
**~28ms/hex** in the scratchpad — too slow for interactive area generation — so rivers instead **reuse
the sea-contagion propagation pattern**: a hex checks only its own local peak/source status (O(1)) and
whether an already-placed neighbour already has a river edge pointing into it (O(6)), growing
`hex.riverEdges` forward as hexes are generated rather than recomputing a path from scratch. Measured
**0.037ms/hex** (~750× faster). This is a **second** deliberate exception to position-purity — for
raw performance this time, not manual-placement responsiveness. Density tuned for "rare and dramatic"
(`RIVER_SOURCE_CHANCE`, originally 0.06, ~1 source per 1200–2000 hexes). **Rendering pulled forward
from 3R.8 on request** (a river you can't see isn't testable) — `map.js`'s `drawRiverEdges` draws a
line per `riverEdges` direction from a hex's center to the midpoint between its center and that
neighbour's (the true shared-edge midpoint on any regular hex grid, no corner lookup needed), styled
cyan over a dark outline so it reads over any terrain colour. **Revised twice more after real GM
use:** (1) 0.06 was too rare — ~50 "Generate Area" clicks (~1350 hexes) gave only 1 short river;
considered fixing the underlying order-dependent propagation gap with a "pendingRivers" side-channel,
but traced through it carefully (and confirmed via a scratchpad simulation of realistic scattered-click
usage) that it would add **zero value** — the only loss case (a hex explored before the river that
would have flowed through it existed) can't be fixed without rewriting already-placed map content,
which stays off the table. Simply bumped `RIVER_SOURCE_CHANCE` to **0.25** (~4×) instead — same
simulation shows a ~1350-hex map going from under 1 river on average to 3–4, still clearly a landmark.
(2) Bends looked like sharp corners (two straight lines meeting at the hex center); `drawRiverEdges`
now draws a pass-through hex's two edges as **one quadratic curve using the hex's own center as the
control point** — bends smoothly on an actual turn, and degenerates to a perfectly straight line for
opposite edges with no special-casing (the center sits exactly on that line for a regular hex). Verified
visually — a continuous multi-hex river renders correctly from a mountain source downhill, and a
synthetic 4-shape test (straight/bend/source/confluence) confirmed each renders as designed.
**Third revision (real-play bug report): one-hex orphan stubs and rivers dead-ending in
Plains/Hills instead of Lake/Sea.** Diagnosed against an actual exported world: every case
traced back to a river's downhill edge pointing at a neighbour ALREADY PLACED (a separate
earlier click, or the same click processed a moment earlier) before the river existed — its
`incomingRiverEdges` look-back scan had already run and found nothing. Gets worse the more of
a map is already explored in small increments. **Fix (confirmed with the user first, since it
bends a previously-firm rule): `js/ui/app.js`'s `stitchRiverForward`** retroactively extends a
river edge into an already-placed, still-river-free neighbour — purely cosmetic (never touches
terrain/settlement/POIs, never overwrites another river's data), capped at 20 cascaded hops.
This is a THIRD deliberate exception to position-purity, and the first that touches an
already-placed hex at all (the other two only ever affect a hex at its own generation moment).
Verified: scratchpad simulation of realistic scattered-click usage showed mean chain length
1.68→4.46 hexes, one-hex orphans 27→7 (-74%), chains reaching real water 1→5 (5×); a real
40-click browser session then confirmed 0 orphans, mean length 9.75, longest 15 hexes, no
console errors.
**Fourth revision (real-play request): "longer, windier, real transportation routes" +
lake outflow.** Steepest-descent always picked the single lowest neighbour — every river a
short, direct 5-12 hex line, no meander, no relationship to nearby wetlands or the coast.
`js/gen/river.js`'s `downhillDirection` now scores every valid downhill candidate (still
strictly lower elevation, never uphill) on three factors and makes a seeded weighted-random
pick among them (still a pure, deterministic function of `(seed,q,r)`): elevation drop
(original signal), a swamp/moisture attraction (`SWAMP_ATTRACTION=0.8` — also surfaced and
confirmed a fix where a scratchpad prototype had wrongly treated Swamp, which is LAND, as a
river-stopping body of water like Lake), and a coastward pull toward decreasing `continent`
(`COAST_PULL=150` — `continent` is ~13× coarser than elevation so needs a big multiplier to
matter, but even a faint per-step bias compounds into real large-scale drift toward the sea
over a long path). Added **lake outflow**: a Lake with incoming edges now rolls a chance
(`LAKE_OUTFLOW_CHANCE=0.5` per inflow, compounding — reuses sea contagion's exact shape) to
grow an outgoing edge, letting rivers continue past a lake instead of always stopping there.
A "prefer neighbours that aren't placed yet" bias was also prototyped to help connectivity,
but measured WORSE on every metric in both a single-big-fill and scattered-clicks simulation
(it rushes rivers off the edge of whatever's generated so far) — dropped in favour of relying
on stitching alone, which fully resolves the dead-end case on its own. Verified: combined,
in a single big fill mean chain length 3.8→11.4 hexes, reach-water 15%→59%, orphans 79→7; in
scattered clicks mean length 1.7→5.6, reach-water 2%→18.5%, orphans 110→30; confirmed
visually via the new "Huge" tool (two clearly winding, coastward rivers, real curved bends).
Performance unaffected (~0.02-0.04ms/hex).
**Fifth revision (second real-play round):** (1) **rim overflow** — lake outflow rolls were
passing but silently doing nothing, because a lake sits in a local depression by definition, so
steepest-descent from it is usually -1; lakes now exit by spilling their lowest rim neighbour
(excluding inflow dirs), with a ping-pong guard so the next hex can't point straight back;
`LAKE_OUTFLOW_CHANCE` 0.5→0.75 ("more times than not"). Verified: lakes passed through went
~0→50-70 per 8-map batch. (2) **the "bay" rule** (`js/gen/biome.js`) — lake tiles were
appearing mid-ocean/on the coast because the Lake band ignores the continent gate; a
margin-based fix was prototyped and rejected (it just moves the coastline; adjacency
unchanged), the working rule flood-fills the connected would-be-Lake cluster (bounded, cap 48,
no early exit so all members agree) and turns the WHOLE cluster Sea if it touches raw ocean —
a bay/inlet; verified lakes-adjacent-to-Sea 37→0 across ~39k hexes, still position-pure.
(3) **stitch upgrades** — outgoing edge found as the unmirrored edge (a lake's overflow exit
isn't its downhill), and stitching into a river-carrying hex now adds the incoming edge as a
tributary confluence instead of stopping one hex short. (4) `RIVER_SOURCE_CHANCE` 0.25→0.35
(~8 rivers per large map, per request). (5) **Hexside river rendering** (experiment, on
request): `map.js` `RIVER_STYLE` toggle — rivers along hex BORDERS (rim arcs between
side-midpoints, classic wargame look); after a side-by-side comparison the user preferred the
curves, so `"center"` is active again and hexside stays one word away.
**Sixth revision (third real-play round — "still rivers ending in forests"): two root causes
found by instrumenting full simulated fills.** (1) **Sealed dry basins**: a river descending
into a landlocked basin with a dry Swamp/Forest floor hit `forceLake` at STITCH time, which the
cosmetic-only stitcher dropped — the water then spiralled the pocket via rim-spill and merged
back into itself (an invisible mid-map dead end; measured at a third of all rivers in a filled
region). Fix: the **pristine-hex Lake flip** — a basin hex with no settlement/POIs/name/note
flips to Lake at stitch time (the first and only case where an already-placed hex's terrain
changes, gated on "nothing the GM has invested in"); non-pristine basins spill onward instead.
Verified sealed-dry 29→0 across 10 simulated 5-fill maps. (2) **A stitcher regression** from
the previous commit: `unmatchedOutgoingDir` could return an INCOMING edge whenever the
upstream hex wasn't in the world yet (always true mid-stitch — buildRandomHex stitches before
its caller addHex-es), sending the cascade backward to die one hop in; every river in a real
browser world was 1-2 hexes. Fix: thread the incoming direction (`cameFrom`) through the
cascade and exclude it. Verified in 5 fresh browser worlds: every chain reaches water or the
exploration frontier.
**Seventh revision (fourth real-play round):** (1) **a Lake can now spontaneously ORIGINATE a
river** (`isRiverSource` Lake branch, `LAKE_SOURCE_CHANCE=0.08` per lake hex; ~1.9 lake-origin
chains per Huge fill) — previously impossible, so lakes were never seen as sources;
`riverStateAt`'s Lake branch was restructured so outflow fires on either a passed inflow roll or
a spontaneous source. (2) The **inflow-raises-outflow-likelihood** half was already mechanically
present (`LAKE_OUTFLOW_CHANCE=0.75`, compounding) but invisible; combined with the origin fix it
now shows ~7.3 pass-through lakes (inflow AND outflow) per Huge fill. (3) **Solid blue river
line** (`map.js`): the outline pass is now the river colour too, so it reads as one solid
light-blue stroke — verified in-browser.
**Eighth revision (fifth real-play round — "not enough rivers reach the sea"):** the root cause
was NOT routing but that the sea wasn't in the generated area — a Huge (r15) fill centred on the
origin contained ZERO Sea (measured 0/8), because the origin land-bias guaranteed land out to
radius 30 and the whole fill sat inside that bubble. A long routing sweep (coast-pull to 800,
lake-outflow to 0.95, coast-biased spill, a combined elevation+continent flow field) all capped
at ~10% and the flow-field variant made rivers spiral (maxLen 300+) — so it was left un-applied.
**Fix: `FALLOFF_RADIUS` 30 → 15** (`js/gen/biome.js`) — the origin and its inner rings stay
reliably land (origin never Sea across 40 seeds; r3 start disc always land), but coastline now
appears within a starting Huge fill in ~55% of maps (avg ~180 Sea hexes, up from ~0). Real
near-origin Huge fills now average 177 Sea hexes and ~15% reach-sea, with ≥1 sea-reaching river
in ~30% of maps (~60% by radius 25); confirmed visually.
**Ninth revision (sixth real-play round — "not enough rivers reach the sea; discuss why before
changing more"): the whole per-hex flow model was REPLACED with curated tracing.** Paused and
diagnosed with the user that the ~10-15% reach-sea ceiling was an ARCHITECTURAL wall, not a tuning
miss: `elevation` and `continent` are independent noise fields, so "locally downhill" wanders at
random relative to the coast and rivers get trapped in the countless local elevation minima long
before they descend to the sea; five distinct emergent approaches all capped at ~10-15%, and a
prototyped seaward-elevation-slope (the user's first pick) hit the same 14% wall while banding
mountains into unnatural coast-parallel walls. **The fix (user chose it): trace each source to the
sea up front.** New `js/gen/river-trace.js` runs a minimax "fill and spill" (priority-flood) from a
source, always expanding the frontier reachable over the LOWEST elevation pass — exactly how water
fills a basin and spills its lowest rim, repeatedly, until it escapes; the first ocean hex reached
(target = `biome.js` new `isOceanAt` gate) gives the drainage route. Minimax on ELEVATION (not
continent) follows the valleys and threads the lowest saddles, so a river almost never crosses high
ground (~14% of path hexes on Mountains/Hills, mostly the legitimate source descent) — continent-
minimax cut across mountains a third of the time and looked broken. Scratchpad: **100% of ~380
sources reach the sea** across a dozen maps, mean path ~110 hexes, ~870 elevation samples/trace
(paid once when a source is discovered). Rivers are now a top-level `world.rivers[]` registry
(`{id, source, path, reachedSea}`, schema **v12**), populated by `app.js`'s `syncRivers` after every
generation batch and on world load (idempotent, keyed by source; migrated worlds rebuild from their
existing source hexes). `map.js`'s `drawRivers` renders each as one smooth blue polyline through the
hex centres — **including across unexplored hexes**, so a river visibly reaches the coast even when
the sea itself hasn't been generated — with a bounding-box viewport cull. The per-hex flow model
(`downhillDirection`, `riverStateAt`, lake-overflow, `stitchRiverForward`, `hex.riverEdges`) and its
tests were removed; `river.js` keeps only source detection (`isRiverSource`). Verified in-browser:
a Huge fill yields ~19-47 long winding rivers, 100% traced to sea; a coastal seed shows multiple
rivers visibly flowing into a rendered Sea body. **Follow-up (immediate real-play — "a lot of rivers
almost cross and look like spaghetti"): tributary merging.** Independent traces from nearby sources
found near-identical lowest-pass routes to the same coast and ran near-parallel/crossing. Fix:
`syncRivers` now traces sources in **canonical (sorted) order sharing one `claimed` set**, and
`traceRiverToSea` terminates on reaching a claimed hex (a **confluence** — the tributary joins that
trunk and its downstream is drawn once). Result is a dendritic network: scratchpad measured **82% of
rivers join a trunk, 81% less line drawn**, distinct river hexes 2391→667, with ~7 sea-reaching
trunks per large map. Order-independent (canonical, not generation order); the whole network rebuilds
when the source set changes (`world.riversMerged` forces a one-time rebuild of pre-merge worlds).
Confirmed in-browser on the same seed as the spaghetti shot — clean confluences, no parallel bundles.
**Follow-up (real-play — "a river should terminate as soon as it touches a water cell"): terminate at
first water.** Rivers were routing THROUGH rendered lakes/bays and back onto land ("mountain → across
the sea → inland → ends in a lake"), because the trace only recognised the raw ocean GATE
(`isOceanAt`), not lakes or bay-flipped Sea — measured **80% of paths crossed a rendered-water hex
before ending**. Fix: `biome.js` gains `isWaterAt` (Sea OR Lake, pure), and `traceRiverToSea`
terminates at the first water hex outside the source's own body (`sourceWaterBody` flood-fill lets a
Lake source cross its own lake first). Now **0% cross water**; median river length 87→~8-11 hexes,
~17% end at sea / ~83% at an inland lake (the natural nearest sink). `reachedSea`→`reachedWater`
throughout; `world.riversFormat` version stamp (now 3) forces a one-time rebuild of existing worlds.
Verified in-browser on the coastal seed — rivers stop cleanly at the water's edge. (Tradeoff noted to
the user: this shortens rivers and most now end at lakes; a "flow through lakes, stop only at the sea"
variant is a one-line change if longer sea-reaching rivers are preferred.)
**TERRAIN REWRITE (v13 — the big pivot, on request): elevation is gone; the world is a hex ORACLE.**
After many rounds, the direction changed at the root. The elevation/moisture/continent noise
classifier (3R.3/3R.4) and the curated river trace (3R.5) were **deleted** and replaced by a
**neighbour-affinity dice roll** (`js/gen/affinity.js`): every un-revealed hex is a superposition;
on reveal it collapses to a weighted roll biased by its already-revealed neighbours. This
**deliberately gives up strict `(seed,q,r)` determinism** — a hex's terrain now depends on reveal
order — an intentional trade the user chose: it matches the oracle metaphor and lets features shape
terrain. The weight model is **additive** — `weight[T] = SPAWN[T]·spawnScale(n) + Σ AFFINITY[N][T]` —
with a spawn term that DECAYS as a hex gains neighbours (seed at the frontier, conform in the
interior → clean regions, not speckle). SELF-affinity is cranked ~2.5× so the majority neighbour
wins decisively (lone-hex ~3-4%, tuned in the scratchpad); cross terms encode gradients
(mountains→hills→forest→plains, desert shuns forest / likes mountain ridges); Sea↔Lake is a hard
forbid (no coastal lakes). Sea/Lake need no continent gate — Sea's strong self-affinity makes big
coastal bodies, Lake's weak self-affinity keeps it small and inland. The origin `(0,0)` still spawns
land. Files: new `js/gen/affinity.js`; `hex.js`/`app.js` rewired (`neighborTerrains` replaces
`seaNeighborCount`); **deleted** `biome.js`, `river.js`, `river-trace.js`; schema **v13**
(elevation/moisture/continent no longer written — old worlds load as-is, terrain strings still
render). Verified in-browser: a Huge fill renders clean coherent regions with real coastlines, big
oceans, mountain highlands, and lakes; no console errors.
**3R.6 — Rivers v2 (emergent major-water drainage, elevation-free).** With no height field, TERRAIN
is the routing cost. `js/gen/rivers.js` `computeRivers(seed, terrainByKey)` is a DERIVED overlay
(recomputed from the revealed terrain by `app.js`'s `syncRivers` after every generation and on load,
into `world.rivers[]`, rendered by the existing `drawRivers`): (1) find connected water bodies — a
**major** body (sea / large lake, size ≥ 20) is a real sink, small ponds are pass-through; (2) flood
a **cost-to-major-water field** outward (cheap swamp/plains/small-lake, dear hills, dearest mountains)
— "terrain as elevation", monotonically decreasing to water so a river always arrives and never
climbs a mountain; (3) **sources** = deep-interior Mountains (cost ≥ 40 from major water, a local
maximum, past a seeded roll) → long cross-country rivers, and because a big sea owns a big watershed
it naturally collects **more** rivers (sea size drives river count, per real-play request); (4) trace
each source **down** the field to major water, canonical order + shared `claimed` set so tributaries
**merge** at confluences. Fork **(i) revealed-only**: the field floods from major water in the
placed area, so a river only forms where a source can reach a real coast through generated hexes.
Order-dependent by design; cheap (one Dijkstra + short descents). Verified in-browser: ~26 long rivers
(up to 32 hexes) winding from the mountains to the coast/great-lake, big sea collecting the most.
**APPEND-ONLY (real-play bug — "existing rivers sometimes disappear when generating a new area"):**
recomputing the whole network each generation let the shifting cost field drop/re-route existing
rivers. Fixed: `computeRivers(seed, terrain, existingRivers)` keeps every existing river VERBATIM and
only adds rivers for newly-revealed sources (new tributaries still merge into the frozen existing
paths via the seeded `claimed` set). A river, once formed, is permanent. Verified: expanding a world
from 14→30 rivers dropped 0 and re-routed 0. Pre-v13 (elevation-based) rivers are cleared on migration
so the new system rebuilds them.
**Next: tune density/stream-order-width to taste (real-play); optional mountain ranges as features;
then 3R.6b settlements v2 (river/coast size boosts now have real rivers to key off).**
**Map notes & labels (7.5) add `name`/`note` to a hex — schema bumped to v7; 3R.3 added
`elevation`/`moisture` (v8); 3R.4 added `continent` (v9/v10); 3R.5 rivers (v11 `riverEdges` → v12
`world.rivers[]`); v13 the terrain rewrite REMOVED elevation/moisture/continent and the trace-based
rivers (neighbour-affinity terrain, `js/gen/affinity.js`); 3R.6 rivers return as a derived
major-water drainage overlay (`js/gen/rivers.js`), no schema change.**
**Schema v13. 232 `node --test` passing** (run as `test/*.test.js` — `node --test`'s default discovery
treats any file under `test/` as a suite, which would otherwise snag the non-test
`stats-harness.js` diagnostic script). Work merges to **`main`** via PR.

---

## Foundational decisions (confirmed)

| Decision | Choice |
|---|---|
| **Stack** | Client-only, **vanilla HTML/CSS/JS (ES modules), no build step**. Canvas map, HTML panels. |
| **Persistence** | Browser **IndexedDB** (+ `localStorage` for prefs). **JSON export/import**. Fully offline. |
| **Ruleset** | **System-agnostic OSR** — generic terms, no system-specific stat blocks. |
| **Group play** | **Single GM screen**; solo uses the same screen. No backend/networking. |
| **Tables** | **Data-driven** — content in JSON tables rolled by a generic engine. In-app editing is Phase 7. |
| **Dependencies** | **No npm runtime deps.** Node is **dev-only** (test runner + static server). |

**Guiding principles:** vertical slices (each step is usable); engine vs. content separation;
YAGNI; everything persists.

---

## Hard conventions (a new session MUST know these)

- **No build, no runtime deps.** Plain ES modules loaded by the browser. Node is only for
  `node --test` and a static server.
- **Serve over HTTP — never `file://`.** ES `import`, `fetch()` of `/data/*.json`, and IndexedDB
  all need a real origin. Use `./run-local.sh` (or `python3 -m http.server`).
- **Testing:** pure logic (`js/core`, `js/gen`, `js/world`, `js/data/portability.js`) is unit
  tested with **`node --test`** (zero deps). Browser-only code (`js/ui/*`, `js/data/db.js`) is
  verified by hand in the browser — **not** node-tested.
- **Seeded determinism.** A world has a `seed`. Per-element generation uses
  `subRng(seed, "hex", q, r, …)` (order-independent). `gen` counter on a hex lets "regenerate"
  produce a different result deterministically. **Render-time choices (which art variant) are
  derived from coords and NOT stored.**
- **Schema + migration.** `SCHEMA_VERSION` (currently **11**) lives in `js/world/world.js`.
  `migrateWorld()` in `js/data/portability.js` upgrades older worlds and runs on both import and
  load. Bump + add a migration step whenever the persisted shape changes.
- **No backward-compatibility burden right now.** Pre-release, with no real worlds worth
  preserving: don't write migrations for old export formats, don't worry about whether cached
  IndexedDB data matches the current shape — a schema/shape change can just break old worlds; the
  fix is to start a new one. Skip defensive fallbacks/back-compat shims for data shape changes for
  the same reason. **Revisit this once there's real save data worth protecting** — this note
  itself should be removed at that point.
- **Data-driven content.** Roll tables are JSON in `/data` using the
  [canonical schema](#canonical-table-schema). *Rules* (per-terrain settlement caps / POI weights,
  terrain coherence via elevation+moisture) are small pure JS consts/functions
  (`js/gen/terrain-profile.js`, `js/gen/biome.js`, `js/core/noise.js`), not tables.
- **Art = SVG assets with emoji fallback.** Terrain/settlement motifs are coloured-pencil SVGs in
  `assets/`; the renderer falls back to emoji until an image loads / if one is missing. POIs are
  emoji.
- **Design / approval loop:** brainstorm → plan → **approve** → build → `node --test` → commit +
  push to the branch (updates its PR) → **present a manual test checklist for the user to run via
  `./run-local.sh`** (see [How to run & test](#how-to-run--test)). **Visual changes are reviewed
  as files first** (a preview is sent for sign-off before art is wired in). One coherent step per
  commit.

---

## Architecture & file map (as built)

```
index.html                      app shell (command bar, <canvas id="map">, side panel)
css/app.css
run-local.sh                    fetch latest branch, run node --test, serve over HTTP
package.json                    dev-only: "type":"module", scripts: test / serve
/js
  /core   rng.js (mulberry32, hashString, makeRng, subRng, randInt, pick)
          dice.js (rollDice)   table.js (validateTable, rollTable)   loader.js (loadTables, makeResolver)
          hexgeo.js (axial<->pixel, cube rounding, neighbors, hexRing/hexDisc, axialDistance, axialLine, axialKey/parseKey)
          noise.js (valueNoise2D, fbm2D — Phase 3R.3 deterministic coordinate-hashed value noise)
  /gen    hex.js (generateHex)   poi.js (generatePoi)
          terrain-profile.js (per-terrain rules + DUNGEON_THEME_BIAS, SHRINE/CAMP/LANDMARK bias+skin)
          biome.js (biomeAt/classifyLand/elevationAt — Phase 3R.3/3R.4 elevation+moisture -> land terrain,
                    `continent` coarse noise field gates Sea vs. running the land classifier)
          river.js (isRiverSource/downhillDirection/riverStateAt — Phase 3R.5 mountain-to-sink rivers,
                    propagated incrementally like sea contagion for performance, not analytically traced)
          dungeon.js (generateDungeon, DUNGEON_BUILD)   dungeon-layout.js (layoutLevel, deriveDoors)
          feature-detail.js (describeFeature/featureName/featureDescription — Tier-1 shrine/camp/landmark)
          tower.js (generateTower, TOWER_BUILD — Tier-2 mapped tower interior, orientation:"up")
          hooks.js (generateHook/startChain/buildChainStep/buildLocalHook/buildEscortHook, rollHookPattern,
                    chooseDistantTarget, hookName/hookDescription, HOOK_BUILD — Phase 6 adventure hooks)
  /world  world.js (createWorld, SCHEMA_VERSION, getHex/hasHexAt/placedHexes/addHex/removeHex; world.hooks)
  /data   db.js (IndexedDB)    portability.js (exportWorld/importWorld/migrateWorld)
  /ui     app.js (bootstrap/wiring; dungeon view + lazy build; hook generation + map marks; radial dispatch)   map.js (canvas renderer + LOD + hook markers + river lines (3R.5); right-click → radial)
          panel.js (selection UI + dungeon/room view + global hooks list)   dungeon-map.js (dungeon canvas: camera, grid)
          radial-model.js (pure fixed-slot menu model — Phase 7.1)   radial-menu.js (right-click ring overlay)
          terrain-style.js / terrain-art.js / poi-style.js (+ THEME_GLYPHS) / settlement-art.js
/data     terrain, swamp-feature, settlement-size, poi-types, poi-occupant, creatures, occupiers,
          dungeon-{size,theme,room,trap,special,dressing,treasure,treasure-guard,monster-status,light},
          monster-families, dungeon-family,
          shrine-{form,dedication,condition,detail}, camp-{scale,reaction},
          landmark-{feature,trait,hook}, tower-{kind,master},
          hook-{pattern,verb,source,explore,threat,rescue,warning,opportunity,commodity,event,cargo,recipient,clue,payoff,patron,reward,return} (JSON)
/assets   terrain/*.svg  settlement/*.svg
/test     node --test suites, run as `test/*.test.js` (rng, dice, table, world, hexgeo, hex,
          noise, biome, river, terrain-coherence, terrain-profile, terrain-art, settlement-art, poi,
          migration, dungeon, dungeon-layout, feature-detail, tower, hooks); stats-harness.js is a
          diagnostic script
          (not a suite — `node --test`'s directory-based discovery would otherwise pick up ANY
          file under test/, hence the explicit `*.test.js` glob), run via `node
          test/stats-harness.js [seed] [radius]` (3R.2 — terrain/settlement generation baseline)
/docs/plans  per-step sub-plans (this overview links them)
```

**Data flow:** UI command → generator (`js/gen`, reads JSON tables + seeded RNG) → result →
written into the World (`js/world`) → persisted to IndexedDB → rendered to canvas + panel.

```mermaid
graph TD
    P0[0 Foundation] --> P1[1 Single hex] --> P2[2 Hex map] --> P3[3 POIs + terrain rules]
    P3 --> P4[4 Dungeons] --> P5[5 Other POI detail]
    P2 --> P6[6 Hooks]
    P3 --> P8[8 Small oracles]
    P5 --> P7[7 QoL & customization]
    P6 --> P7
    P8 --> P7
```

---

## Current data model (as built, schema v11)

- **World:** `{ schemaVersion:11, id, name, seed, hexScale, hexes:{}, hooks:[], createdAt, updatedAt }`
  (IndexedDB holds a **list** of worlds). No `factions` (deferred).
- **Hook** (Phase 6; top-level `world.hooks[]`):
  `{ id:"hook:<n>", build, pattern, verb, subject:{poiId?,name,type}, origin:{q,r}, target:{q,r,poiId?},
  bearing, distance, targetTerrain, claim, source, status }` plus per-kind fields — `chain:{total,step,prize}`,
  `path:[{q,r}]` (map corridor), `lair` (threat), `cargo` + `reward:{patron,amount}|{glory}` (escort/bounty).
  `pattern` ∈ known/distant/map/chain/opportunity/event/escort/return; `status` ∈ open/resolved/ignored.
  Prose composed at render (`hookName`/`hookDescription`).
- **Hex** (keyed by `axialKey(q,r)` = `"q,r"`):
  `{ key, coords:{q,r}, placed, terrain, terrainFeature|null, elevation, moisture, continent, riverEdges,
  settlement, pois:[], explored, gen, name?, note? }`. `name`/`note` (v7) are optional GM annotations —
  `name` shows as a map label. `elevation`/`moisture` (v8) and `continent` (v9, renamed from `basin` in
  v10; floats in `[0,1)`) are the Phase 3R.3/3R.4 biome-classifier inputs — pure functions of
  `(seed, q, r)`, always present regardless of how terrain was chosen. `continent` is a coarse,
  continent-scale land/ocean **gate** (not flood-fill — this world is infinite/incrementally generated,
  so there's no map edge to flood-fill from): below a threshold it's always Sea; otherwise the unchanged
  land classifier runs, and its own low-elevation band means Lake. A smooth bias keeps the fixed world
  origin `(0,0)` always land. `riverEdges` (v11) is an array of `NEIGHBOR_DIRS` indices (0-5) marking
  which hex-sides carry a river segment — grown incrementally from mountain-peak sources as neighbouring
  hexes are generated (`js/gen/river.js`), the same propagation shape as sea contagion, chosen for
  performance (a fully analytical per-hex query measured ~28ms/hex, too slow for interactive area
  generation; incremental propagation measures ~0.037ms/hex).
- **settlement:** `{ present:false }` or `{ present:true, size }` where size ∈
  `Thorp, Hamlet, Village, Town, City` (capped per terrain; none on Lake/Sea).
- **POI:** `{ id:"poi:<n>", type, name, occupant, detail }`; `occupant` is
  `{kind:"lair",creature}` | `{kind:"occupied",by}` | `{kind:"none"}`. **Dungeon** POIs carry a
  terrain-biased `detail.theme` (drives the map glyph) and gain a generated interior at
  `detail.dungeon`, built lazily on first open. **Tower** POIs likewise build a mapped interior at
  `detail.dungeon` (with `orientation:"up"`, `build:TOWER_BUILD`) on open. **Shrine / camp / landmark**
  carry structured **Tier-1 detail** at `detail.feature` (`{build, type, …axis picks…}`); prose is
  composed at render. All interiors/features self-heal from a build stamp (no schema bump). Auto-gen
  places ≤1 POI; users add/remove more.
- **Terrains:** Forest, Plains, Hills, Mountains, Swamp, Desert, Lake, Sea (Water split into Lake/Sea
  in 3R.4; Lake and Sea share Water's settlement/POI rules via `terrain-profile.js`'s `biasKey()`
  alias). **POI types:** dungeon, shrine, camp, landmark, tower. The explorable types **ruin/cave/mine
  — and creature lairs — are `dungeon` themes** (Ruin, Cave complex, Abandoned mine, Beast den, Ogre
  lair, …).

### Canonical table schema
```json
{ "id": "terrain", "title": "Terrain type",
  "entries": [ { "weight": 4, "value": "Forest" },
               { "weight": 1, "value": "Swamp", "roll": { "table": "swamp-feature" } } ] }
```
`weight` (default 1), `value` (string or object), optional `roll` (nested sub-table).

---

## Roadmap & status

| Phase | Status | Detail |
|---|---|---|
| 0 — Foundation & app shell | ✅ done | [phases-0-3.md](docs/plans/phases-0-3.md) |
| 1 — Single hex generator | ✅ done | [phases-0-3.md](docs/plans/phases-0-3.md) |
| 2 — Hex map (+2.1 interaction, +2.2 terrain look) | ✅ done | [phases-0-3.md](docs/plans/phases-0-3.md) |
| 3 — POIs + terrain-aware gen (+3.1–3.5 POIs/art/LOD) | ✅ done | [phases-0-3.md](docs/plans/phases-0-3.md) |
| **4 — Dungeons** (base + 4.5–4.8 arc + 4.9.1–4.9.14 sub-project) | ✅ done | [phase-4-dungeons.md](docs/plans/phase-4-dungeons.md), [phase-4.9-dungeon-connectivity.md](docs/plans/phase-4.9-dungeon-connectivity.md) |
| **5 — Other POI types detailed** (shrine/camp/landmark + tower) | ✅ done | [phase-5-poi-detail.md](docs/plans/phase-5-poi-detail.md) |
| **6 — Hooks** (Type-1 local adventure hooks; sub-steps 6.1–6.6) | ✅ done | [phase-6-hooks.md](docs/plans/phase-6-hooks.md) |
| 7 — QoL & UX (notes, nav, themes; ~~custom tables~~ dropped) | ▶ **in progress** | **7.1 radial menu ✅** [phase-7.1-radial-menu.md](docs/plans/phase-7.1-radial-menu.md) · **7.2 dungeon-view UX ✅** [phase-7.2-dungeon-view-ux.md](docs/plans/phase-7.2-dungeon-view-ux.md) · **7.3 panel tabs ✅** [phase-7.3-panel-tabs.md](docs/plans/phase-7.3-panel-tabs.md) · **7.4 pinned hooks + select-to-highlight ✅** [phase-7.4-hooks-pinned-focus.md](docs/plans/phase-7.4-hooks-pinned-focus.md) · **7.5 map notes & labels ✅** [phase-7.5-map-notes.md](docs/plans/phase-7.5-map-notes.md) · **7.6 map nav & onboarding ✅** [phase-7.6-map-nav-onboarding.md](docs/plans/phase-7.6-map-nav-onboarding.md) · **7.7+ backlog 📋** [phase-7-backlog.md](docs/plans/phase-7-backlog.md) |
| **3R — World coherence** (terrain/water/settlements/roads/rivers) | ▶ **in progress** | [phase-3r-world-coherence.md](docs/plans/phase-3r-world-coherence.md) — revisit of Phase 3; pure-engine, node-tested; interleaves with 7. **3R.1 "Generate Area" ✅ · 3R.2 audit+research+model-decision ✅ · 3R.3 terrain v2 ✅ · 3R.4 water v2 ✅ · 3R.5 rivers ✅** (Lake/Sea via a `continent` land/ocean gate — revised after manual testing found "inland seas"; real coastlines now; rivers grow incrementally from mountain sources like sea contagion, for performance; schema v11); next 3R.6 (settlements v2). |
| 8 — Additional small oracles | ◻ later | see catalog below |

Phases 0→1→2→3→4→5 are a hard chain; 6/8 need only the map + POIs; 7 is polish. Factions are a
dedicated future phase (see backlog).

**Phase 4 (done) — Dungeons:** a dungeon POI carries a terrain-biased theme (map glyph) and opens
into a multi-level **Dungeon View** — per-level room-graph maps with loops, doors/secret doors,
inter-level stairs (true vertical) + level-skip shafts, multiple entrances/exits, lighting, and
richly stocked rooms (themed monster families with depth/difficulty scaling, dice-notation
treasure & number-appearing, named-den signature creatures), plus exploration state + GM notes.
See [phase-4-dungeons.md](docs/plans/phase-4-dungeons.md) and
[phase-4.9-dungeon-connectivity.md](docs/plans/phase-4.9-dungeon-connectivity.md).

**Phase 5 (done) — Other POI types detailed:** two tiers. **Tier 1** — `shrine`, `camp`, `landmark`
generate a terrain-aware **composable description** (independent axes × a terrain "skin") via a shared
pure engine (`js/gen/feature-detail.js`); picks are stored on `poi.detail.feature`, prose is composed
at render, and a `FEATURE_BUILD` stamp self-heals older saves on open (no schema bump). **Tier 2** —
`tower` opens into a **mapped interior** (`js/gen/tower.js`) that reuses the Dungeon View and layout
engine with an `orientation:"up"` flag: a stack of narrow floors that climb (index 0 = ground/entrance,
master on top), garrisoned by the POI's occupant (held = lit, empty = dark). See
[phase-5-poi-detail.md](docs/plans/phase-5-poi-detail.md).

**Phase 6 (done) — Hooks** (renamed from "Rumors"): Type-1 **local adventure hooks** — a **kind**
(Known / Distant / Map / Chain / Return, plus local Opportunity / Event and two-endpoint Escort) × a
**verb** (explore / threat / rescue / warning), pointing at an existing or freshly-generated hex/POI. The
signature mechanic is **lazy target-tile generation** (point at a tile that doesn't exist yet → generate
just that tile; Map also reveals a corridor). A **threat** names its menace (tracked to its lair) and
threat/rescue/escort carry a **reward** (patron + coin, or glory). A hook reads with the target's base
name, distance in **miles**, and tile **terrain**. Generation is a **manual "Generate hook"** at a town, plus **"Read map"** /
**"Follow a trail"** anywhere; auto-generation waits on a future Travel feature. A global **open-hooks
list** (→ Target / ↩ Origin / Follow-the-clue) and **amber map markers** tie it together. Type-2 "distant
powers" (roaming/region/news-propagation) belong to the future Factions phase. See
[phase-6-hooks.md](docs/plans/phase-6-hooks.md) and the
[small-oracle catalog](#small-oracle-catalog-for-phase-8-selection).

---

## Small-oracle catalog (for Phase 8 selection)

- **Solo core:** Yes/No fate oracle; random event / inspiration; plot/quest hook.
- **World & travel:** weather; wilderness encounter; travel/journey events; region/realm;
  calendar / time & travel tracker.
- **Settlements & people:** settlement details; NPC; tavern/shop; name generators.
- **Encounters & rewards:** reaction & morale; dungeon dressing; treasure/loot; magic item;
  mishap/complication.
- **Living world (stretch):** faction turn / doom clock.

---

## Backlog — other ideas (discussed, not yet scheduled)

- **Factions** — a dedicated phase: generation **plus operating rules** (goals advancing,
  disposition, holdings, faction turns/doom clock, reuse of one faction across the map). POIs
  currently use generic occupier labels only; no faction objects exist.
- **Hydrology, terrain coherence, rivers, roads, richer settlements** — now planned as
  **Phase 3R** ([phase-3r-world-coherence.md](docs/plans/phase-3r-world-coherence.md)): fresh/salt
  water & coastlines, terrain v2, rivers, roads, settlement spacing/names/Keep-Fort/clusters.
- **Party position marker** — needs exploration/travel rules first.
- **Art** — pencil sketches for POIs; optional "full painted hex"; eventual "pencil-drawn"
  refinement of tiles; optional 3rd terrain variant; an `svg-tile` authoring skill for consistency.
- **Misc** — allow a manual settlement on Lake/Sea (currently disallowed); more terrain types.
- **Phase 7 items** — search, undo, print/GM-screen view, themes, POI-dot polish, radial
  keyboard/touch parity (see [phase-7-backlog.md](docs/plans/phase-7-backlog.md)). In-app custom
  tables were **dropped**.

---

## How to run & test

### Run it
- **Run locally:** `./run-local.sh` (fetches the branch, runs `node --test`, then serves on
  `http://localhost:8000` — aborts if tests fail). Needs `git`, `node`, `python3`. The script
  self-updates to the latest branch tip each run (hard reset — it's a tester's script, not for
  local edits). Override the port: `./run-local.sh 9000`.
- **Tests only:** `node --test test/*.test.js` (or `npm test`). (Plain `node --test` also picks up
  `test/stats-harness.js` — a diagnostic, not a suite — since Node's default discovery treats any
  file under `test/` as fair game; the glob avoids that.)
- **Never** open `index.html` via `file://` (modules/`fetch`/IndexedDB need an HTTP origin).

### How a step is verified (the loop, every step)
The container here can't expose a browser, so verification is split:
1. **Automated:** `node --test` covers all pure logic; it must stay green and is the gate in
   `run-local.sh`.
2. **Manual browser:** because UI/canvas/IndexedDB aren't node-tested, **each step ends by
   presenting the user a short numbered/checkbox test checklist** to run via `./run-local.sh`.
   The user ticks items (or reports issues) before we move on. Keep checklists concrete and
   tied to the change.

**Standard manual-verification recipe** (adapt per step):
- Serve via `./run-local.sh`; drive the new feature's UI and confirm the on-screen result.
- **Reload** → state persists (IndexedDB). **Export → re-import** JSON → round-trips
  (`schemaVersion` current). Same seed → reproducible generation.
- Map changes: check pan/zoom, click-select, and the zoom **LOD tiers** (sketches → simplified
  markers → nothing), plus the **Icons** toggle.

**Example checklist shape** (what to hand the user):
```
[ ] <do X in the UI> → <expected on-screen result>
[ ] Reload → <state> persists
[ ] Export → re-import → identical
```

## Out of scope (for now)

Accounts, servers, real-time multiplayer, native apps, system-specific stat blocks, AI/LLM text
generation, and any npm runtime dependency or build step.
