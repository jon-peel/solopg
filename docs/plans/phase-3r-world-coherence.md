# Phase 3R — World Coherence (revisit of Phase 3: terrain & POI rules)

> **⚠️ SUPERSEDED at the terrain layer (v13 rewrite).** Sub-phases 3R.3/3R.4
> (elevation/moisture/continent noise classifier) and 3R.5 (curated river
> trace) described below were **deleted** and replaced by a **neighbour-affinity
> dice roll** (`js/gen/affinity.js`): the world is now a hex ORACLE — every
> un-revealed hex is a superposition that collapses on reveal to a weighted roll
> biased by its already-revealed neighbours. This deliberately drops strict
> `(seed,q,r)` determinism (terrain is now reveal-order-dependent) in exchange
> for the oracle model and for letting features shape terrain. Elevation/
> moisture/continent are gone; Sea/Lake emerge from self-affinity (no continent
> gate); rivers are temporarily OFF pending an emergent, endpoint-triggered
> rework (rivers/ranges as *features over* the affinity terrain). Schema **v13**.
> See PLAN.md's "TERRAIN REWRITE" entry. The 3R.3–3R.5 detail below is kept for
> history; the classifier/river code it references no longer exists.

**Status: 📋 planning only.** No code in this pass. Every sub-phase carries its
own **research/design step** — external research is done *there*, not now.

This is a revisit of Phase 3 ("POIs + terrain-aware generation"), not Phase 6
(Hooks) or Phase 7 (QoL/UX). It's **generation quality** — what the world *is* —
and lives in pure, node-tested engine code (`js/gen/*`, `js/world/*`), verified by
tests + a stats harness rather than by eye. It runs independently of the Phase 7
UX queue; the two touch disjoint code and can interleave.

---

## Why

Today the map is rolled **one hex at a time, independently**:

- **Terrain** — each empty hex rolls the `terrain` table with only a *mild additive*
  neighbour nudge (`weightedTerrainTable` + `TERRAIN_AFFINITY`: self +3, compatible
  +1–2, else 0, scaled by `terrainBias`). No elevation, no moisture, no region
  structure — so a single strong roll drops a lone Desert hex into Forest and it
  "doesn't flow." (This may be *partly* perceptual; **3R.2 measures it** before we
  decide how far to go.)
- **Settlements** — a flat per-hex `rng() < profile.settlement.chance` (Forest 0.30,
  **Plains 0.45**, Hills 0.35, Desert 0.20, Mountains/Swamp 0.15, Water none). No
  spacing rule → towns clump. They have **no names** and only five sizes: **Thorp,
  Hamlet, Village, Town, City** (no Keep/Fort).
- **Water** is one terrain (no fresh/salt), so no coastlines, lakes, or seas.
- **No rivers, no roads.**

Goal: move from independent per-hex rolls to a **coherent world** — clustered
biomes, real coastlines/continents/islands, rivers from mountains to the sea, roads
between settlements, and settlement placement/sizing that respects all of it —
while staying **fully seeded/deterministic** and reproducible.

## Current behaviour (grounded, for reference)

| Concern | Where | Today |
|---|---|---|
| Terrain choice | `js/gen/hex.js` `weightedTerrainTable`, `js/gen/terrain-affinity.js` | Independent roll + additive neighbour bonus. |
| Terrain rules | `js/gen/terrain-profile.js` | Per-terrain settlement chance/cap, POI weights, theme bias. |
| Settlement | `js/gen/hex.js` (§2) | `rng() < chance`, size from `data/settlement-size.json`, capped by terrain. No name, no spacing. |
| Water | `terrain` table + profile | Single "Water"; `settlement: null`. |
| Neighbour info | `js/ui/app.js` `neighborTerrains(q,r)` | Feeds `neighborTerrains` into `generateHex`. |

---

## Cross-cutting principles (apply to every sub-phase)

- **Determinism** — everything stays seeded via `subRng`; **region/area generation
  must be order-stable** (same seed + same request → same world, regardless of the
  order hexes are visited).
- **Additive schema + migrations** — several sub-phases add fields (water subtype,
  river/road edges, settlement subtype/name, region id, elevation/moisture). Each
  bumps `SCHEMA_VERSION` with an additive `migrateWorld` step; old worlds keep working.
- **Pure + node-tested engine**; browser UI (rendering) verified separately.
- **Manual-edit coexistence** — the radial lets a GM edit a single hex. Coherent
  regeneration must not silently stomp manual edits: introduce a per-hex
  `locked`/`manual` flag and decide regen policy (see Open decisions).
- **Measure, don't guess** — a **stats harness** (3R.2) reports terrain distribution,
  biome clump sizes, settlement spacing, river/road counts, connectivity — so tuning
  is objective ("is it actually bad, or does it just look funny?").

---

## Sub-phases (in recommended order)

| # | Sub-phase | Depends on | Gist |
|---|---|---|---|
| 3R.1 | **"Generate Area" radial tool** | — | Batch-generate a region of hexes; the iteration/testing aid for everything below. |
| 3R.2 | **Audit + research + world-model decision** | 3R.1 (nice) | Document today's behaviour, research hex-gen mechanics, choose the generation model. |
| 3R.3 | **Terrain generation v2** | 3R.2 | Coherent biomes, mountain ranges, no lone hexes; optional elevation/moisture. |
| 3R.4 | **Water v2: fresh vs salt + coastlines** | 3R.3 | Lake vs Sea; continents & islands. |
| 3R.5 | **Rivers** | 3R.3, 3R.4 | Mountains → lakes/seas; flow rules; width/order. |
| 3R.6 | **Settlements v2** | 3R.3–3R.5 | Types (+Keep/Fort), names, sparser spacing, hamlet clusters, river/coast boosts. |
| 3R.7 | **Roads** | 3R.6 | Gravity-weighted links between settlements; mountain routing; desert suppression; tiers; spurs. |
| 3R.8 | **Integration: pipeline, regen, render, migration, tuning** | all | Wire the full deterministic region pipeline and ship the rendering/migration. |

Runtime generation order for a region (settled by this plan):
**terrain → water/coastlines → rivers → settlements (sized w/ boosts) → roads.**
Development order mirrors it, so each sub-phase builds on a finished layer.

---

### 3R.1 — "Generate Area" radial tool ✅ done
*A testing aid first, a genuine QoL feature second.*

- **Folded into the existing "Generate" slot** (`js/ui/radial-model.js`) rather
  than a separate "Area" slot: **Generate** is now a submenu — **Random**
  (anchored nearest the cursor, the original single-hex action, gates on
  `placed` as before) plus **Small (radius 1) / Medium (radius 2) / Large
  (radius 3)**, a true hex-radius disc (not a rectangle). **Huge (radius 15,
  up to 721 hexes) added later** (3R.5 follow-up, on request) as a bulk-fill
  aid for testing/prep — manual verification of features like rivers across a
  big enough sample was tedious one 49-hex Large click at a time. Measured
  ~36ms for a full 721-hex fill (including river propagation) — no chunking/
  progress UI needed at this size.
- **Always fill-empty only** — the "Fill empty" vs "Regenerate all" choice from
  the first pass was **removed**: every size just fills whatever's empty in its
  disc (center included) and leaves already-placed hexes untouched. Simpler
  mental model, no destructive option to guard against.
- The freed-up **"Neighbours"/"Area" slot position is now `reserved`** — an
  always-disabled placeholder (`"—"`, reason "Reserved for a future feature")
  so the other 7 slots keep their fixed angular position; a future feature
  (e.g. **travel**) may claim it.
- **Geometry:** `hexRing(q, r, radius)` / `hexDisc(q, r, radius)` in
  `js/core/hexgeo.js` — the standard axial spiral, a pure function of
  `(q, r, radius)` so fill order is deterministic regardless of caller/Map
  iteration order.
- **v1 rides current per-hex logic** exactly (`buildRandomHex`/`generateHex`,
  unchanged) — this is the iteration/testing aid for 3R.2+; **3R.8** will swap it
  onto the v2 pipeline.
- `js/ui/app.js`: `onGenerateArea(radius)` walks the full `hexDisc(...)`
  (center included), skipping any already-placed cell; `radialDispatch` case
  `"genArea"`.
- **Tests:** `test/hexgeo.test.js` (ring/disc count, no-dupes, exact-distance,
  matches `neighbors()` at r=1, deterministic order, matches doc sizing 7/19/37,
  center-first ring-by-ring order) and `test/radial-model.test.js` (reserved
  slot, Generate submenu shape/gating). 214 `node --test` passing. Manually
  verified in-browser (Playwright smoke pass): Small/Medium/Large fill exactly
  the empty cells in range (including an empty center), and report "No empty
  hexes in range." once full.

### 3R.2 — Audit + research + world-model decision
*Design/analysis; minimal code (harness + docs).*

- **Step — audit ✅ done:** confirmed the "Current behaviour" table above against
  the actual code (`js/gen/hex.js`, `terrain-affinity.js`, `terrain-profile.js`,
  `data/terrain.json`, `data/settlement-size.json`) — no corrections needed, plus
  one new finding:
  - **`terrainBias` (the neighbour-affinity multiplier) is dead in practice.** It
    defaults to `1` in `weightedTerrainTable` and **no caller anywhere in `app.js`
    ever passes a different value** — so every hex gets exactly the *weakest*
    documented affinity bonus (self +3, compatible +1/+2, additive across
    neighbours), with no way for a GM to dial coherence up or down today. Worth
    fixing as part of 3R.3 regardless of which world-model wins the fork below.
  - Worked example: a lone Forest hex surrounded by 6 Plains gets weight
    `4 + 1×6 = 10` for staying Forest vs. `4 + 3×6 = 22` pulling toward Plains on
    a reroll — confirms a single hex genuinely can and does drop in as a visible
    anomaly under today's weights.
  - Settlements: confirmed zero neighbour/spacing code path exists (`rng() <
    profile.settlement.chance` only) — chances Forest .30 / Plains .45 / Hills
    .35 / Desert .20 / Mountains+Swamp .15 / Water none; only 5 sizes exist
    anywhere in the data (no Keep/Fort); no `name` field.
  - Rivers/roads: confirmed genuinely absent — the only "road" hits in the
    codebase are flavor strings (shrine/landmark setting phrases) and a static
    B/X travel-tooltip (`app.js` `travelTipHTML`) describing a rule for the GM
    to apply by hand, not backed by any generated road data.
  - **Why it reads as haphazard, in one line:** the only coherence mechanism
    (neighbour affinity) is real but stuck at its weakest setting and only sees
    immediate neighbours (no region-scale structure); settlements/water/rivers/
    roads have no coherence mechanism at all — every hex is an independent roll.
  - *(Execution note: this pass does research next, then the stats harness
    together with the world-model decision — the harness's numbers feed that
    decision directly — rather than harness-before-research as listed below.)*
- **Step — stats harness:** a `node` script that generates large areas and reports
  terrain histogram, biome clump-size distribution, mean nearest-settlement spacing,
  etc. Establishes a **baseline** to tune against.
- **Step — research ✅ done:** surveyed external hex-generation mechanics (web
  search; several primary sources — welshpiper.com, thealexandrian.net,
  medium.com, azgaar.wordpress.com, necropraxis.com — blocked direct fetch
  with bot-protection 403s, so findings below lean on search-result synthesis
  plus two cleanly-fetched technical sources; citations below).
  - **Dominant-terrain / transition tables (option a lineage):** the **AD&D DMG
    Appendix B** (1979) already implements a genuine **transition matrix** — roll
    d20, look up the column for the *current* hex's terrain, read off the *next*
    hex's terrain, with baked-in special cases ("1 in 10 forests also include
    hills," "1 in 20 mountains have a pass"). **Welsh Piper** uses a
    **hierarchical dominant-terrain** scheme instead: a large "Atlas hex" gets one
    Primary Terrain, then each sub-hex inside it rolls against *that terrain's own
    table* (e.g. a Mountain Atlas hex's sub-hexes roll 20% peak / 10% pass / 5%
    volcano) — coherence comes from scoping the sub-table to the parent, not from
    checking literal neighbours. **Hexmancer / Wilderness Hexplore Revised** (a
    modern OSR tool) is closest to our *current* code: odds shift by **how many
    neighbours already share a terrain** — validates our approach isn't wrong in
    kind, just too weak (per the audit, `terrainBias` stuck at 1×) and too local
    (no larger structure beyond immediate neighbours).
  - **Region/chunk (option b):** **The Alexandrian**'s hexcrawl-design method
    drops per-hex terrain rolling for the top-level shape entirely — draw large
    hand-placed terrain **regions** first ("that's the Old Forest"), then stock
    individual hexes for local variation, with separate per-region encounter
    tables. This is option (b) already a named, popular OSR technique, not a
    hypothetical.
  - **Two-layer elevation + moisture (option c):** **Amit Patel / Red Blob
    Games' "Polygonal Map Generation for Games"** (2010, the seminal reference)
    classifies biome from two independent fields — elevation and moisture
    (distance to fresh water in his version) — combined via **Whittaker-diagram
    bins** (high elevation → snow/rock/tundra; medium → forest/grassland/desert
    by moisture; low → beach/grassland/rainforest by moisture). A from-scratch
    implementation (GitHub `HextoryWorld/ProceduralHexTerrainGenerator`) confirms
    the mechanism concretely: **two Simplex-noise fields** (elevation, moisture)
    sampled per-hex, then a Whittaker lookup combines them. The structural
    insight: **noise fields are spatially continuous by construction** — adjacent
    hexes sample nearby noise-field points, so they naturally get similar
    elevation/moisture (and thus the same biome) *without ever checking
    neighbours* — this is what actually fixes "lone anomalous hex," rather than
    approximating a fix via bonuses.
  - **Coastlines/water:** two established, complementary techniques — **flood-fill
    from the map edge** (water reachable from the border = sea; enclosed pockets
    = lake) and **elevation threshold ("sea level")** (below cutoff = water, then
    flood-fill still splits sea vs. lake). Real generators (Red Blob's mapgen2,
    Azgaar's Fantasy Map Generator) combine both — matches the doc's own 3R.4
    option 2 recommendation.
  - **Bonus finds for later sub-phases (captured now, not re-researched later):**
    Azgaar's Fantasy Map Generator drains each cell to its **lowest neighbour**
    with a **depression-filling pass** (raise a landlocked low point until it can
    drain) to guarantee every river reaches a sink — matches our 3R.5 sketch's
    "carve onward or form a lake" rule already. For roads, Azgaar's own writeup
    says **plain Dijkstra produced ugly tree/river-like branching** — they had to
    add elevation cost, cheaper reuse of existing roads, region borders, and
    rivers as combined path cost. Real-world confirmation that our 3R.7
    gravity-model-plus-least-cost-path plan is the right complexity level, not
    over-engineering.
  - **Sources:** [Welsh Piper Part 1](https://welshpiper.com/hex-based-campaign-design-part-1/) ·
    [AD&D DMG wilderness terrain discussion](https://www.cartographersguild.com/showthread.php?t=4550) ·
    [The Alexandrian — Stocking Your Hexes](https://thealexandrian.net/wordpress/48054/roleplaying-games/designing-the-hexcrawl-part-2-stocking-your-hexes) ·
    [Hexmancer](https://www.martinralya.com/tabletop-rpgs/hexmancer-procedural-hex-generation-system/) ·
    [Polygonal Map Generation for Games — Amit Patel](http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/) ·
    [ProceduralHexTerrainGenerator (GitHub)](https://github.com/HextoryWorld/ProceduralHexTerrainGenerator) ·
    [Azgaar — Coastline](https://azgaar.wordpress.com/2017/04/03/coastline/) ·
    [Azgaar — River systems](https://azgaar.wordpress.com/2017/05/08/river-systems/) ·
    [Azgaar — Settlements, Regions, Routes](https://azgaar.wordpress.com/2017/11/21/settlements/) ·
    [Worldographer river generator notes](https://inkwellideas.com/2016/09/worldographerhexographer-2-programming-updates-river-generator-sample-better-child-maps-more/)
  - *(The model fork below is intentionally kept open — the research surfaces (c)
    as structurally the cleanest fix, but the actual pick waits on Step 3's
    baseline stats rather than being pre-decided here.)*
- **Step — stats harness ✅ done:** `test/stats-harness.js` — a diagnostic
  script, **not** a `node --test` suite (see below), that fills a large hex disc
  under **today's unchanged engine** (`generateHex`/`buildRandomHex`'s real code
  path, real `data/*.json` weights) and reports a terrain histogram, connected-
  same-terrain "biome clump" sizes (+ lone-hex rate), and mean nearest-settlement
  spacing. Run: `node test/stats-harness.js [seed] [radius]` (defaults
  `seed=1 radius=25`, ≈1951 hexes).
  - **Discovery while building it:** `node --test`'s default discovery treats
    *any* file under a directory named `test/` as a test file regardless of
    name, so a bare diagnostic script there was silently getting picked up and
    "passing" as a no-op test. Fixed by scoping both `package.json`'s `test`
    script and `run-local.sh`'s gate to `test/*.test.js` (every real suite
    already followed that naming) — `stats-harness.js` is excluded from
    `node --test`/`npm test` but still runs directly.
  - **Baseline (3 seeds, radius 25, ~1951 hexes each — stable across seeds):**
    terrain roughly tracks the base table weights (Forest/Plains ~22%, Hills
    ~21%, Mountains ~12%, Swamp/Water/Desert ~7–8% each) — the neighbour bias
    barely shifts the aggregate mix. **Lone-hex rate: 23–25%** — nearly a
    quarter of all hexes share no terrain with any existing neighbour. **Clump
    sizes are small**: median 1–2 hexes for every terrain (Forest, the biggest
    clumper, still usually tops out well under 20). **Settlement spacing:** mean
    nearest-neighbour distance **~1.1–1.2 hexes** — settlements are almost
    always immediately adjacent to another settlement. These numbers turn the
    doc's "doesn't flow" / "towns clump" complaints into measured facts, and are
    the baseline 3R.3/3R.6 tune against.
- **Step — the fork (world-building model) ✅ decided: (c) two-layer
  elevation + moisture.**
  - **(a) Incremental, stronger coherence** — keep hex-by-hex but make neighbour
    influence dominant (transition tables, not a mild additive nudge).
  - **(b) Region/chunk** — an area gets a dominant biome, then fills within it.
  - **(c) Two-layer (chosen)** — a coarse region map (elevation + moisture + sea
    level) → per-hex detail derived from it.
  - **Why (c), beyond the doc's original "coastlines/rivers/biome-bands fall out
    naturally" case:**
    1. **Avoids rework.** 3R.4 (water/coastlines) and 3R.5 (rivers) both need
       elevation regardless — the doc already names elevation-threshold sea
       level as "a natural fit if 3R.3 gives elevation." Picking (a) or (b) now
       means adding elevation again later anyway.
    2. **It structurally closes the doc's #1-listed risk — determinism under
       area generation.** Today's neighbour-affinity bias reads *already-placed*
       neighbours at generation time, so a hex's terrain roll technically
       depends on fill order (which neighbours exist yet) — order-independence
       is an emergent property of "always use the same fixed fill order," not a
       guarantee. Elevation/moisture as a **coordinate-hashed noise field** (a
       pure function of `(seed, q, r)`, no npm deps needed — a value-noise
       function evaluated directly from position, no external libraries
       required) is a pure function of position alone: trivially
       order-independent, with no fixed-fill-order discipline needed to get
       there.
    3. The baseline numbers above (23–25% lone-hex rate, median clump size 1–2)
       show the *current* mechanism is too weak to fix by degree alone — a
       structural change is warranted, not just a bigger multiplier.
- **Deliverable:** audit ✅ + research ✅ + baseline stats ✅ + a **chosen model
  ✅ (two-layer elevation + moisture)**. **3R.2 complete.** No gameplay change in
  this sub-phase — 3R.3 implements the model against this baseline.

### 3R.3 — Terrain generation v2 ✅ done
> ⚠️ **SUPERSEDED at schema v13 (the big pivot).** The elevation/moisture/continent
> noise classifier described in 3R.3 and 3R.4 below, and the downhill river trace in
> 3R.5, were **deleted** and replaced by a **neighbour-affinity hex oracle**
> (`js/gen/affinity.js`) plus an **emergent terrain-cost drainage** river system
> (`js/gen/rivers.js`). Hexes no longer carry `elevation`/`moisture`/`continent`/
> `riverEdges`. The sub-sections below are kept as design history; for the CURRENT
> terrain and river implementation see `PLAN.md` (the "TERRAIN REWRITE (v13)",
> "Rivers v2", and "MANUAL rivers" log entries). 3R.6 (Settlements v2) builds on the
> post-pivot world.
- Implemented the 3R.2-chosen model: **elevation + moisture** as first-class per-hex
  fields (`hex.elevation`, `hex.moisture`, floats in `[0,1)`), each a **coordinate-hashed
  value-noise field** (`js/core/noise.js` — `valueNoise2D`/`fbm2D`, 3-octave FBM, no npm
  deps, built only from `subRng`/`hashString`), combined via a Whittaker-style threshold
  classifier (`js/gen/biome.js` — `biomeAt`/`classifyBiome`) into one of the existing 7
  terrains. Both fields are a **pure function of `(seed, q, r)` alone** — order-
  independent by construction, closing the doc's #1-listed determinism risk (a
  regression test asserts forward vs. reverse fill order give identical results).
- **Frequency/threshold tuning was measured, not guessed:** a first-draft attempt (naive
  `[0,1)`-linear thresholds, frequency 0.08) produced a **~65% single-terrain blob**
  (FBM output clusters toward the middle of its range, not uniform) — caught by
  simulating standalone before writing any real code. Recalibrated to **percentile-
  derived thresholds** (elevation `<0.35`→Water/Swamp band, `<0.58`→mid band,
  `<0.68`→Hills, else Mountains; moisture splits Desert/Plains/Forest within the mid
  band and Water/Swamp within the low band) at **frequency 0.2** — verified against 3
  seeds before implementation, then re-verified live via `test/stats-harness.js`.
- **Retired the old neighbour-affinity mechanism** (superseded, not layered under):
  deleted `js/gen/terrain-affinity.js` (`TERRAIN_AFFINITY`), `weightedTerrainTable`, the
  `terrainBias`/`neighborTerrains` opts, and `app.js`'s now-dead `neighborTerrains()`
  helper + its 2 call-site args. `terrainBias` was already flagged dead in the 3R.2
  audit (stuck at its default of 1) — no longer meaningful to keep once the coherence
  mechanism moved to noise fields, so the doc's original "keep terrainBias meaningful"
  goal is met differently: manual placement (`opts.terrain` forced) still works exactly
  as before, and still gets real elevation/moisture data (always computed regardless of
  how terrain was chosen) for 3R.4/3R.5 to consume uniformly.
- **Nested terrain features stay data-driven**: Swamp's `swamp-feature` roll still
  resolves via `data/terrain.json`'s `entries[].roll`, just looked up directly against
  the classified/forced terrain instead of re-rolling the top-level table.
- **Measured result** (3 seeds, radius 25, ~1951 hexes — matches the 3R.2 baseline
  sample): **lone-hex rate dropped from 23–25% to 2–3%**; **Mountains mean clump size
  rose from 2.1 to 7.6–13.6** (real ranges, not speckle); terrain histograms land in the
  same ballpark as the old weights for most seeds (one seed skews Forest-heavy at ~39%,
  accepted as natural per-world variety, not a regression). Settlement spacing is
  unaffected (~1.1 hexes apart still — that's 3R.6's job).
- **Tests:** `test/noise.test.js` (determinism, range, continuity, layer decorrelation),
  `test/biome.test.js` (threshold boundaries, always a known terrain, pure-function
  determinism), `test/hex.test.js` (elevation/moisture present & in-range, independent
  of forced terrain, Swamp nested roll still fires), `test/terrain-coherence.test.js`
  (lone-hex rate < 15%, Mountains mean clump ≥ 4 with a run ≥ 8, determinism, and the
  forward/reverse fill-order regression test). 231 `node --test test/*.test.js` passing.
- **Migration:** `SCHEMA_VERSION` 7→8, stamp-only (no data transform — additive fields,
  and per PLAN.md's relaxed backward-compat policy no regen affordance is needed for
  old worlds right now).

### 3R.4 — Water v2: fresh vs salt, coastlines ✅ done
> **Note (post-v13):** the continent-gate coastline mechanics below were part of the
> elevation-era design; the v13 terrain rewrite folded Sea/Lake into the neighbour-affinity
> oracle (`js/gen/affinity.js`). A later **flooding retune** (play feedback — Sea was averaging
> ~31% of the map, up to 90%) cut Sea's spawn (`SPAWN.Sea` 2→0.8) and self-affinity
> (`AFFINITY.Sea.Sea` 38→28), bringing water to a coastal minority (~10% median, worst ~40%;
> flooded maps 24→8 of 40) while keeping coherent oceans on ~75% of maps. Guarded by an
> `affinity.test.js` water-fraction sweep.
- Split **Water → Lake (fresh) + Sea (salt)** as done — confirmed "Lake"/"Sea" over
  "Fresh"/"Salt". Implemented as **two full terrain values**, not a `Water` + subtype
  field: reading every consumer showed rendering (`terrain-style.js`, `terrain-art.js`)
  needs zero signature changes with two values, vs. threading a second argument through
  `map.js` for a subtype. The doc's original "subtype keeps profile logic simple" worry
  is handled instead by a **shared alias** (`terrain-profile.js` `biasKey()`, mapping
  `Lake`/`Sea` → `Water`) at the 7 terrain-keyed lookups (`profileFor`,
  `dungeonThemeTable`, `shrineFormTable`, `landmarkFeatureTable`, and 3 `*_SETTING`
  lookups in `feature-detail.js`) — so `TERRAIN_PROFILE.Water` and every bias/flavor
  table stay keyed `Water`, unchanged and undoubled; Lake and Sea share its settlement
  rule (none) and POI weights for now (no lake-vs-sea gameplay distinction yet — that's
  3R.6's job for coastal/river boosts).
- **Coastline logic: none of the 3 originally-listed options apply as-is.** Every
  real-world reference (Red Blob's mapgen2, Azgaar's generator — see 3R.2's research)
  flood-fills from a **fixed map edge**, assuming a bounded, one-shot-generated map.
  This world is **infinite and generated incrementally** — there's no edge, and a
  bounded flood-fill over just the currently-placed hexes would be **unstable** (a hex
  classified Lake today could flip to Sea once more area is generated around it later,
  breaking 3R.3's order-independence guarantee and silently changing already-shown
  content).
- **First pass (landed, then found broken):** a coarse independent noise field
  (`basin`) decided Sea vs Lake per-hex with no relationship to elevation. This produced
  "inland seas" — a Sea reads as an oversized lake, not a coastline, since nothing tied
  it to the edge of an actual landmass. **Caught via manual testing after shipping**, not
  by the (misleadingly passing) coherence tests, which only checked "both terrains
  appear," not "Sea is topologically a coastline."
- **Revised design (in place now):** a coarse `continent` field (frequency 0.015,
  ~65-hex features — far coarser than elevation's ~5-hex texture) used purely as a
  **land/ocean GATE**, never blended into elevation. Below `OCEAN_THRESHOLD` (0.45) →
  always Sea; otherwise → run the **unchanged 3R.3 land classifier** verbatim, where its
  own low-elevation band (previously "Water") now always means **Lake** (Sea isn't
  reachable from the land classifier at all — it's decided upstream by the gate). Two
  earlier attempts at *blending* a coarse continent signal into elevation itself (widen
  elevation's own FBM to include very-low-frequency octaves; or a weighted
  `continent*0.6 + detail*0.4` blend) both **broke Mountains almost entirely** (0 in some
  samples) **and produced zero Lakes** — the coarse octaves dominated ~76% of the blended
  sum's weight, starving local terrain variety everywhere and leaving no room for an
  isolated low pocket to read as a lake. Keeping `continent` as a pure gate — decoupling
  "is this the ocean" from "what's the local terrain" — avoided both failures; verified
  at radius 70 (~14911 hexes, matching continent scale) across 3 seeds: **Sea forms
  1–3 clumps of 797–3247 hexes** (a real, single contiguous ocean) while **Lake stays
  pocket-sized** (mean 6.7–8.9 hexes, matching the original small-lake behaviour), with
  Mountains/Hills/Forest/Plains/Desert/Swamp proportions stable and close to 3R.3's
  original tuning (land classification is byte-for-byte unchanged).
- **Second bug found during this fix, not in the original ask:** the world's spawn point
  is always the fixed origin `(0,0)`. Some seeds place the origin deep in an ocean basin
  — one tested seed gave **100% Sea at the origin itself**. **Fix:** a smooth
  origin-centered land bias (`LAND_BOOST 0.7`, falloff over `FALLOFF_RADIUS` hexes via
  `axialDistance`) boosts `continent` near `(0,0)` only, guaranteeing every new world
  spawns on land — verified across 14 seeds (`biomeAt(seed, 0, 0)` is never `"Sea"`).
  (`FALLOFF_RADIUS` was later shrunk 30 → 15 — see the "not enough rivers reach the sea"
  round in 3R.5 — so coastline appears within a starting Huge fill; the origin and its
  immediate start rings stay reliably land either way.)
- The renamed **`hex.continent`** field (was `basin`) is always computed and stored
  (mirrors elevation/moisture's precedent), available uniformly for 3R.5+.
- Rendering: `Lake`/`Sea` get distinct colours (`terrain-style.js`) and emoji
  (💧/🌊 split from Water's existing pair); **no new SVG art this pass** — both share the
  old `water-*.svg` placeholder (art changes are reviewed as files first, per
  convention); distinct pencil art is a follow-up. **Islands** (a rare high hex poking
  above the ocean threshold) are also a follow-up, not implemented this pass.
- Schema bumped to **v10** (stamp-only — old `terrain:"Water"` hexes and the `basin`→
  `continent` rename both need no retrofit).
- **Sea contagion (a further revision, on request):** placing/finding a Sea hex should
  make hexes generated *near* it more likely to continue the coastline, decaying with
  distance until land randomly breaks through (an island/continent) — the `continent`
  gate alone doesn't do this (it's a pure function of position, so a manually-placed Sea
  hex had zero effect on anything generated near it later). Added `rollSeaContagion` in
  `js/gen/biome.js`: if any already-placed neighbour is Sea, roll a chance (compounding
  with more Sea neighbours, capped, `SEA_CONTAGION_CHANCE = 0.75` per neighbour) to
  continue the coast outright, before even consulting the `continent` gate; falling
  through (or having zero Sea neighbours) reverts to the unchanged pure-position
  behaviour. **This is a deliberate, narrowly-scoped exception to "terrain is a pure
  function of `(seed, q, r)`"** — Sea classification near existing content now depends
  on generation history (`seaNeighborCount`, computed from already-placed neighbours in
  `js/ui/app.js`, mirroring the pre-3R.3 `neighborTerrains` helper removed in that pass),
  not position alone. Verified in the scratchpad (walking outward from a forced Sea hex)
  and end-to-end in the browser: forcing Sea at a point then filling a Large area around
  it turned the whole area to Sea in one real run — a visible, one-placement coastline.
  Land still reliably breaks through at lower neighbour counts (tested, non-flaky).
- **Tests:** `test/biome.test.js` (`classifyLand` boundary tests — Sea isn't reachable
  from it; origin-never-Sea regression across 14 seeds; `seaNeighborCount=0` is
  byte-identical to the old pure-position path; high neighbour counts make Sea
  overwhelmingly likely without ever being literally certain), `test/terrain-profile.test.js`
  (`biasKey` + shared-profile assertions), `test/terrain-coherence.test.js` (Lake/Sea
  both appear at continent scale, Sea forms a large contiguous body dwarfing Lake by
  10×+, origin is always land, `continent` included in the order-independence check,
  plus a dedicated sea-contagion integration test mirroring `app.js`'s real
  `seaNeighborCount` wiring — deliberately *not* using the shared order-independent
  `generateArea` test helper, since contagion is the one place order now matters).
  245 `node --test test/*.test.js` passing.

### 3R.5 — Rivers ✅ done
> ⚠️ **SUPERSEDED at schema v13.** The elevation-downhill river design in this section
> (`isRiverSource`/`downhillDirection`/`incomingRiverEdges`/per-hex `riverEdges`, propagated
> like sea contagion) was **deleted** with the elevation field. Rivers are now an emergent
> **terrain-cost drainage** overlay in `world.rivers[]`: `js/gen/rivers.js` floods a
> cost-to-nearest-major-water field and traces deep-interior mountain sources down it, plus
> **manual GM-drawn rivers** that auto-complete their open ends. Kept below as history; for the
> CURRENT design see `PLAN.md` ("Rivers v2" + "MANUAL rivers").
- **Model (your rules, encoded):** rivers **start in mountains** and flow **downhill**
  to a **lake or sea**; may flow **lake → lake → sea**; **never uphill** (never
  lake→mountain, never range→range); may pass **through their origin range** but route
  **around other ranges**.
- **The architectural fork:** every 3R.3/3R.4 mechanism classifies a hex from
  `(seed, q, r)` alone. A river is a **path**, not a point — spanning dozens of hexes
  from a distant mountain source to a distant sink, in a world that's infinite and
  generated incrementally (no fixed edge to flood-fill from, same constraint 3R.4 hit).
  The first design measured a **fully analytical per-hex query** (scan every candidate
  source within a search radius, trace each from scratch, check if it crosses the
  queried hex) at **~28ms/hex** in the scratchpad — a 1951-hex "Generate Area" fill
  would take close to a minute. Not viable for an interactive tool.
- **Shipped design: reuse the sea-contagion propagation pattern instead of analytical
  tracing.** A hex only needs two cheap, local facts, both O(1)/O(6):
  1. Is this hex itself a river **source**? (`isRiverSource` — `classifyLand`-Mountains,
     a local elevation peak among its 6 neighbours, and a seeded density-chance roll).
  2. Do any of its already-placed neighbours have a river edge pointing **into** this
     hex? (`incomingRiverEdges`, `js/ui/app.js` — mirrors `seaNeighborCount` exactly: a
     neighbour's edge in direction *i* points at us from that neighbour's own
     `opposite(i) = (i+3)%6` side).
  Given those, the hex decides its own outgoing edge via `downhillDirection` (steepest
  descent among its 6 neighbours, sampled with **fewer FBM octaves (`FLOW_OCTAVES=1`)**
  than terrain classification's elevation — a smoothed field so descent tracks the real
  landform slope instead of getting stuck in fine noise texture). The river then
  **grows forward** as hexes are generated, one hex at a time — not recomputed from a
  stored path. This is a **second deliberate exception** to position-purity (after sea
  contagion), for a **different reason**: raw performance of an otherwise-correct
  analytical model, not responsiveness to a manual placement.
  - Measured: **0.037ms/hex** for a 1951-hex area fill (real `generateHex` + river
    wiring) — about **750× faster** than the rejected brute-force design.
- **Landlocked depressions → forced Lake.** If `downhillDirection` finds no neighbour
  lower than here (and the hex carries an incoming edge, so it's mid-river, not just
  passing through untouched), the hex's terrain is overridden to `"Lake"` — the river's
  new sink. No carving/routing logic in v1. Skipped entirely for manually-forced
  terrain (a GM's explicit placement is never silently overridden), matching how sea
  contagion also only affects the auto-classified path.
- **Density: rare and dramatic, confirmed via scratchpad numeric verification before
  writing real code** (matching every prior sub-phase's discipline) — `isRiverSource`'s
  seeded chance (originally `RIVER_SOURCE_CHANCE = 0.06`, **revised to 0.25** — see
  below) against real Mountains-peak rates (~1-1.5% of all hexes) yields roughly **1
  river source per 1200-2000 hexes** at the original value: finding one is meant to feel
  like a landmark, not routine terrain. Fully analytical (order-ignoring) path tracing in
  the scratchpad showed real rivers run **5-12 hexes** before reaching a Lake/Sea or a
  depression; the incremental, generation-order-dependent propagation means how much of
  that length is actually *visible* in a single fill depends on which direction the fill
  grows relative to the river's downhill direction — an accepted, documented trade-off of
  the same shape as sea contagion's order-dependence, not a bug.
- **Revision (user report): 0.06 was too rare in practice** — ~50 "Generate Area" clicks
  (~1350 unique hexes) produced just 1 short river. Investigated whether the
  order-dependent propagation gap could be *fixed* rather than just made more frequent: a
  "pendingRivers" side-channel was designed (remember an outgoing edge toward a
  not-yet-placed neighbour, honour it whenever that neighbour is eventually generated,
  regardless of how much later) and traced through carefully before writing any code.
  **Turned out to add zero value, proven both by reasoning and by a scratchpad
  simulation of realistic usage (50 scattered "Large" clicks, not one big coherent
  fill):** whenever a downstream hex is generated *after* its upstream source, the
  existing already-placed-neighbour scan already finds the connection with no extra
  bookkeeping — pending only matters for a downstream hex generated *before* its source
  even exists, and that hex is by then permanently finalized (never retroactively
  edited, by design), so pending can't help there either. The sole loss case — a hex
  explored before the river that would have flowed through it existed — is structurally
  unfixable without rewriting already-shown map content, which stays off the table.
  Abandoned the pendingRivers idea (no schema bump, no added complexity) and instead
  simply **raised `RIVER_SOURCE_CHANCE` to 0.25** (~4x): the same "scattered clicks"
  simulation shows this moves a ~1350-hex map from averaging under 1 river to averaging
  3-4, while keeping most Mountains hexes river-free (still clearly a landmark, not
  wallpaper).
- **Data shape:** `hex.riverEdges: number[]` — `NEIGHBOR_DIRS` indices (0-5) marking
  which hex-sides carry a river segment. No stream-order/tributary-width field yet
  (deferred; would fall out of the same incremental-propagation data if needed later).
- **Rendering: shipped in this pass, pulled forward from 3R.8** (on request — rivers
  weren't observable/testable without it; the original schedule deferred all 3R map-art
  to 3R.8 alongside roads/settlement tiers, but a river that's invisible on the map
  wasn't a useful deliverable on its own). `js/ui/map.js`'s `drawRiverEdges`: for each
  `riverEdges` direction, draws a line from the hex's own center to the **midpoint
  between its center and that neighbour's center** — true for any regular hex grid, so
  no shared-edge/corner-index lookup is needed, and each hex draws its own edges
  independently. A hex whose edge points at a neighbour that never registered the
  matching incoming edge (the accepted order-dependent gap) simply renders a shorter
  stub rather than a missing segment — still visible, degrades gracefully. Drawn on top
  of terrain art/icons, at every zoom tier (not gated behind the icons toggle), styled as
  a bright cyan line (`#6fd0f0`) over a dark outline so it reads over every terrain
  colour including Mountains' grey and Plains' green. Verified visually in the browser:
  built a small world around a known river source and confirmed a continuous multi-hex
  blue line renders correctly from the mountain peak downhill.
- **Revision (user request): curved bends, not sharp corners.** The first cut drew two
  independent straight lines per pass-through hex (center to each edge's midpoint),
  meeting at a hard angle whenever the river actually turned. Replaced with: a
  pass-through hex (exactly 2 edges) draws **one quadratic curve** between the two edge
  midpoints, using the hex's own **center as the control point**. This bends smoothly
  through the hex when the edges aren't opposite (an actual turn), and — with no special
  casing needed — degenerates to a perfectly straight line when they *are* opposite,
  since a regular hex's center sits exactly on the line between two opposite edge
  midpoints (a quadratic Bézier through a colinear control point is a straight line by
  construction). A source (1 edge) or a confluence (3+, tributaries merging) has no
  single obvious "through" pair, so those still fall back to straight center-to-midpoint
  spokes. Verified visually with a synthetic 4-hex test world covering all four shapes
  (straight-through, bend, source stub, confluence) — each rendered exactly as designed.
- **Revision (real-play bug report): rivers dead-ending as one-hex orphans, or in
  Plains/Hills instead of a Lake/Sea.** Diagnosed against an actual exported world: every
  case traced back to the same cause — a river's downhill edge pointed at a neighbour
  that was **already placed** (sometimes from a wholly separate, earlier "Generate Area"
  click; sometimes from the very same click, just processed a moment earlier in that
  fill's internal order) before the river existed to claim it. That neighbour's
  `incomingRiverEdges` scan (a look-BACKWARD-only check, by design) had already run and
  found nothing, and per the "never edit an already-placed hex" rule, nothing update it
  afterward — so the edge just had nowhere to go, reading as a pointless stub or an
  abrupt stop on dry land. This gets WORSE the more of a map is already explored in small
  increments (exactly how the reporting user was playing), since less "fresh," not-yet-
  placed territory remains for a newly-discovered river to grow into.
  **Fix, confirmed with the user first (a genuine trade-off, not a pure bug fix):**
  `js/ui/app.js`'s new `stitchRiverForward` — when a freshly-generated hex's river wants
  to continue into an already-placed neighbour that has **no river data of its own yet**,
  extend the river edge into it, purely as an overlay: that neighbour's terrain/
  settlement/POIs are **never** touched, even if `riverStateAt` would otherwise force a
  Lake there (it might already carry a settlement rolled for its original terrain;
  retroactively flooding it would leave that inconsistent). This is a deliberate,
  narrowly-scoped exception to "never edit an already-placed hex" — scoped to cosmetic
  river-edge data only, never overwriting a neighbour that already carries its own river,
  capped at `RIVER_STITCH_MAX_HOPS = 20` cascaded hops so one connection can't sweep
  through an unbounded stretch of the map. **Verified via a scratchpad simulation of the
  realistic "many scattered Generate-Area clicks" scenario** (the same one used to tune
  density earlier): mean chain length 1.68 → 4.46 hexes, one-hex orphans 27 → 7 (-74%),
  chains reaching a real Lake/Sea sink 1 → 5 (5×). Confirmed again via a real
  browser-driven session (40 scattered "Large" clicks through the actual UI): 0 one-hex
  orphans, mean chain length 9.75, longest chain 15 hexes, no console errors.
- **Flow-direction redesign (real-play request): "longer, windier, real transportation
  routes."** The steepest-descent rule always picked the single lowest neighbour —
  deterministic, but every river was a short, direct line (5-12 hexes analytically, per
  earlier scratchpad tracing), with no meander and no relationship to nearby wetlands or
  the coast. `downhillDirection` now scores every valid downhill candidate (still
  strictly lower elevation — "never uphill" stays unconditional) on **three** factors,
  then makes a seeded weighted-random pick among them — still a pure, deterministic
  function of `(seed, q, r)`, just no longer always the single argmax:
  1. **Elevation drop** (the original signal, unchanged in spirit).
  2. **Swamp/wetland attraction** (`SWAMP_ATTRACTION = 0.8`) — biases toward the wetter
     of the two candidate neighbours. Moisture is a smooth, spatially-correlated field
     (unlike raw per-hex noise), so a cheap "prefer the wetter neighbour" rule, applied
     every step, compounds over a multi-hex path into a genuine drift toward a wetland
     cluster — no expensive wide-radius lookahead needed. Also fixed a real classifier
     bug this surfaced: **Swamp is LAND** (in `classifyLand`'s low band alongside Lake,
     split by moisture), so a river should flow *through* it toward the sea, not
     terminate there — an earlier scratchpad prototype had this backwards, treating any
     low-elevation hex as a stop; the real `riverStateAt` never had this bug (only
     `Sea`/`Lake` were ever checked as termini), but it's now an explicit test.
  3. **Coastward pull** (`COAST_PULL = 150`) — biases toward lower `continent` (closer to
     the ocean gate). `continent` is a MUCH coarser field than elevation — measured
     ~13× smaller step-to-step difference in the scratchpad — so on its own it's far too
     faint to affect any single hex's choice, but a small, *consistent* per-step bias
     compounds over a long path into real large-scale drift toward the sea, which raw
     elevation alone has no reason to produce (the two fields are independent noise
     layers with no inherent relationship).
  A **"prefer neighbours that aren't placed yet"** world-aware bias was also prototyped,
  hoping to sidestep the incremental-generation dead-end case from the stitching fix
  above — but measured **worse on every metric in both a single-big-fill and a
  many-scattered-clicks simulation**: it rushes rivers toward the edge of whatever's been
  generated so far, cutting the *visible* portion short. Stitching alone turned out to
  already fully resolve the "points at an already-placed dry neighbour" case (confirmed:
  0 such cases in either scenario once stitching is in place), so this idea was dropped —
  `downhillDirection` stays a pure function of position, no world-state awareness needed.
- **Lake outflow** (the other real-play request: "if rivers flow into a lake, there
  should be a greater chance of one flowing out"). `riverStateAt`: a Lake hex that
  receives incoming edges now rolls a chance to *also* add an outgoing edge, continuing
  the river past it rather than always terminating there. Reuses sea contagion's exact
  compounding shape (`js/gen/biome.js` `rollSeaContagion`) — `LAKE_OUTFLOW_CHANCE = 0.5`
  per inflow, `chance = 1 - (1 - 0.5)^inflowCount`, so a lake fed by more tributaries is
  more likely to have an outlet, never certain. Sea never rolls an outflow — it's the
  actual ocean, the end of the line; only a landlocked Lake can pass a river onward
  toward the next lake or the sea.
- **Combined verification** (scratchpad, all four mechanisms together — meander, swamp
  attraction, coast pull, lake outflow — plus the existing stitching, no world-awareness):
  in a single big fill (radius-40 disc, ~4921 hexes, matching what the "Huge" tool now
  makes practical): mean chain length **3.8 → 11.4 hexes**, chains reaching real water
  **15% → 59%**, one-hex orphans **79 → 7**. In the more fragmented many-scattered-clicks
  scenario (50 separate "Large" clicks, ~1350 hexes): mean chain length **1.7 → 5.6**,
  reach-water **2% → 18.5%**, orphans **110 → 30**. Confirmed visually in the browser
  (using the new "Huge" tool): a 33-hex chain rendered as two clearly winding rivers,
  both trending toward a coastline, with real curved bends (not straight segments) —
  screenshot on file. Performance unaffected: ~0.02-0.04ms/hex measured for both a 721-hex
  ("Huge") and a 4921-hex fill, despite the extra moisture/continent sampling per step.
- **Second real-play round of fixes** (reported: lakes still never visibly outflow;
  rivers ending in Swamp/Plains/Forest; lake tiles marooned mid-ocean and on the
  coastline; want ~8 rivers per large map):
  - **Rim overflow — the real reason lake outflow "never" happened.** The outflow
    *roll* was passing half the time, but a lake sits in a local depression by
    definition (that's why the water pooled there), so `downhillDirection` from a lake
    hex is usually -1 and the successful roll silently added no edge. Real lakes exit
    by rising until they spill the lowest point of their rim, even though the rim is
    uphill of the lake surface: `overflowDirection` picks the lowest neighbour
    excluding the inflow directions. Verified: lakes passed through per 8-map batch
    went from ~0 to 50-70. `LAKE_OUTFLOW_CHANCE` also bumped 0.5 → **0.75** per inflow
    ("more times than not", per the request), still compounding, still never certain.
    A **ping-pong guard** accompanies it: the hex just past an overflow can sit uphill
    of the lake it left, so its own steepest-descent could point straight back —
    outgoing picks now exclude the inflow directions, and if nothing else is downhill
    the pocket floods (forceLake) as part of the same basin.
  - **Coastal/mid-ocean lake fix — the "bay" rule** (`js/gen/biome.js`). The Lake band
    of `classifyLand` has no relationship to the continent gate, so a hex barely
    clearing the ocean threshold could classify Lake while marooned in open Sea, and
    fresh lakes could sit directly on the coast. A margin-based fix (reclassify
    near-threshold Lakes) was prototyped and REJECTED — it just moves the coastline
    one band inland; measured adjacency was unchanged. The working rule: flood-fill
    the connected would-be-Lake cluster (bounded, `LAKE_REGION_CAP = 48`, no early
    exit so every member computes the identical answer); if it touches raw ocean
    anywhere it's a **bay/inlet — the whole cluster is Sea**. Still a pure function of
    position. Verified: lakes-adjacent-to-Sea 37 → **0** across 8 maps (~39k hexes),
    zero cluster-mate disagreements; regression test scans dense 51×51 grids across
    3 seeds. Perf: "Huge" fill 26ms → 95ms (~0.13ms/hex) — still instant.
  - **Stitch upgrades** (`js/ui/app.js`): the stitcher now finds a hex's outgoing edge
    as its one edge NOT mirrored by the matching neighbour edge (incoming edges are
    mirrored by construction) instead of via `downhillDirection` — required because a
    lake's overflow exit is a direction steepest-descent would never report. And when
    the next hex already carries its own river, the stitch now adds the single
    incoming edge — a **tributary confluence** — instead of stopping dead one hex
    short (a visible gap and another source of "river ends in a field" reports).
    `RIVER_STITCH_MAX_HOPS` 20 → 30 (paths are longer now). Still cosmetic-only.
  - **Density**: `RIVER_SOURCE_CHANCE` 0.25 → **0.35** — real usage saw 6 rivers on a
    large map and asked for ~8; verified ~11 per 2800-hex single fill, which lands
    near 8 under realistic fragmented exploration. Combined with the fixes above, the
    same verification run shows mean chain length ~11 hexes (max 43+) and dry endings
    down to ~2-3 per map, almost all at the exploration frontier ("to be continued",
    not a true dead end).
- **Hexside river rendering** (experiment, on request — "use the hex edges as the
  river"): `js/ui/map.js` gained a `RIVER_STYLE` toggle. `"hexside"` draws the river
  along the hex's own BORDER — walking the rim (corner to corner) between its
  side-midpoints, the classic hex-wargame look — instead of cutting through the
  interior. Crossings still meet neighbours at the shared side-midpoint, so continuity
  across hexes is preserved, and confluences chain arcs along the rim. Opposite-side
  ties pick a rim side deterministically from the hex coords. Comparison screenshots
  of the identical fixed-seed world were captured; **verdict: the user preferred the
  curves — `"center"` is the active style again**, hexside stays available behind the
  one-word toggle.
- **Third real-play round: "still have rivers ending in forests." Two genuine root
  causes found and fixed, both diagnosed by instrumenting full simulated fills:**
  1. **Sealed dry basins.** A river descending into a landlocked basin whose floor is
     dry Swamp/Forest would, at STITCH time, hit `forceLake` — which the cosmetic-only
     stitcher just dropped (it never edits terrain), leaving the water to spiral the
     pocket via rim-spill and merge back into itself: a chain with every edge matched,
     no water, no frontier — an invisible mid-map dead end. Measured at a THIRD of all
     rivers in a filled region (15/45 chains). Spilling onward alone was tried first
     and measured nearly useless (15→12) — the spiral just reforms. **Fix: the
     pristine-hex Lake flip.** A basin hex the GM has never touched (no settlement, no
     POIs, no name/note) now flips to Lake at stitch time, terminating the river
     properly — the first and only case where an already-placed hex's TERRAIN changes,
     gated exactly on "nothing the GM has invested in"; a non-pristine basin keeps its
     terrain and the water spills its rim instead. Verified: sealed-dry chains 29 → 0
     across 10 simulated 5-fill maps (reach-water 46% → 78%, remainder all frontier).
  2. **A stitcher regression from the previous commit.** `unmatchedOutgoingDir` could
     return a hex's INCOMING edge whenever the upstream hex wasn't in the world yet —
     which is always true mid-stitch, since `buildRandomHex` stitches before its
     caller `addHex`-es the fresh hex. The cascade followed the river BACKWARD into a
     not-yet-placed cell and died one hop in; a real browser world showed every river
     1-2 hexes long, unmatched on placed land. **Fix:** thread the known incoming
     direction (`cameFrom`) through the cascade and exclude it from the unmatched-edge
     scan. Verified end-to-end in 5 fresh browser worlds (3 overlapping Huge fills
     each): every chain now reaches water or the exploration frontier; a single
     non-pristine-basin spill fallback appeared once across all runs.
- **Fourth real-play round: lakes as river origins + a solid line.**
  1. **A Lake can now SPONTANEOUSLY originate a river** (`isRiverSource` gained a Lake
     branch, `LAKE_SOURCE_CHANCE = 0.08` per lake hex — so a multi-hex lake's effective
     chance scales with its size). Verified ~1.9 lake-origin river chains per Huge
     (721-hex) fill — clearly rarer than a mountain source, but no longer never-seen.
     A lake exits the same way it does for an inflow: by spilling its rim
     (`overflowDirection`), since a lake sits in a depression. `riverStateAt`'s Lake
     branch was restructured so the outflow fires on EITHER a passed inflow-outflow roll
     OR a spontaneous source — the old early-return meant a no-inflow lake never even
     consulted `isSource`.
  2. **The "inflow raises outflow likelihood" half was already mechanically present**
     (`LAKE_OUTFLOW_CHANCE = 0.75`, compounding) but was invisible in practice; the
     lake-origin fix and the earlier rim-overflow/stitch fixes together make it show:
     ~7.3 pass-through lakes (inflow AND outflow) per Huge fill in simulation. No new
     stitch code needed — a river reaching an already-placed empty lake already routes
     through `riverStateAt`, which now rolls the outflow.
  3. **Solid blue line** (`js/ui/map.js`): the river's dark outline pass is now drawn in
     the river colour too, so the two width passes read as one solid light-blue stroke
     instead of an outlined one. Verified in the browser.
- **Fifth real-play round: "not enough rivers reach the sea." The root cause was NOT
  routing — it was that the sea wasn't in the generated area at all.** Instrumenting a
  big fill showed the sea IS reachable in principle (591 sea hexes in a radius-40 fill)
  but only ~6% of rivers reached it — so the first instinct was to tune routing. A long
  sweep (coast-pull 150→800, lake-outflow 0.75→0.95, coast-biased rim spill, and a
  combined "flow down elevation+continent" field) all capped at ~10% and one variant
  (the combined flow field) actually made rivers *spiral* — maxLen 300+. **The real
  diagnosis:** a Huge fill (radius 15) centred on the origin contains **ZERO Sea**
  (measured 0/8 sample maps), because the origin land-bias guaranteed land out to
  radius 30 and the whole fill sat inside that bubble. Rivers can't reach a coast that
  was never generated. **Fix: shrink `FALLOFF_RADIUS` 30 → 15** (`js/gen/biome.js`). At
  15 the origin and its inner ~5 rings stay reliably land (origin never Sea across 40
  seeds; the r3 start disc always fully land), but real coastline now appears within a
  starting Huge fill in ~55% of maps (avg ~180 Sea hexes, up from ~0). Re-measured with
  the real modules + real stitcher on the actual near-origin scenario: a Huge (r15) fill
  now averages 177 Sea hexes and ~15% of rivers reach the sea, with ≥1 sea-reaching
  river in ~30% of maps (rising to ~60% by radius 25). Confirmed visually — a river
  running mountains-to-coast within a fresh near-origin Huge fill. (The routing sweep
  was left un-applied: it was marginal and the combined-field variant risked spirals;
  the honest fix was making the sea exist where people generate.)
- **Sixth real-play round: "not enough rivers reach the sea; discuss why before changing
  more." The per-hex flow model was REPLACED with curated tracing.** Paused first, as
  asked, and established that the ~10-15% reach-sea ceiling was **architectural, not a
  tuning miss**: `elevation` and `continent` are independent noise fields, so "locally
  downhill" wanders at random relative to the coast, and forward-growing rivers get
  trapped in the countless local elevation minima long before descending to the sea.
  Prototyped the user's first choice (give elevation a seaward slope so downhill trends
  coastward) — it hit the **same ~14% wall** and banded mountains into unnatural
  coast-parallel walls; five distinct emergent approaches all capped at ~10-15%. Since a
  guaranteed sea-reaching river needs to know the whole basin — which forward growth
  never has — the fix (the user chose it over reverting) is to **trace each source to
  the sea up front**, the way most hexcrawl map tools do rivers.
  - **`js/gen/river-trace.js` (new, pure):** `traceRiverToSea(seed, q, r)` runs a
    **minimax "fill and spill"** (priority-flood) from the source — always expanding the
    frontier reachable over the **lowest elevation pass** (the highest point you'd cross
    to get there). That's literally how water fills each depression and spills its lowest
    rim, repeatedly, until it escapes; the first ocean hex reached (target = `biome.js`'s
    new **`isOceanAt`** gate, so the trace shares the exact rendered coastline) gives the
    drainage route, reconstructed via parent pointers. Minimax on **elevation** (not
    continent) follows the valleys and threads the lowest saddles, so a river almost
    never crosses high ground (~14% of path hexes on Mountains/Hills, mostly the
    legitimate source descent); continent-minimax cut across mountains a third of the
    time. Pure function of `(seed, q, r)` — deterministic, placement-independent, with a
    graceful partial fallback to the most-seaward frontier if the sea is beyond a large
    expand budget. Scratchpad: **100% of ~380 sources reach the sea** across a dozen
    maps, mean path ~110 hexes (median 70, p90 228), ~870 elevation samples/trace.
  - **Registry:** rivers moved from per-hex `riverEdges` to a top-level
    `world.rivers[]` (`{id, source:{q,r}, path:[{q,r}...], reachedSea}`), populated by
    `js/ui/app.js`'s **`syncRivers`** after every generation batch and on world load —
    idempotent, keyed by source id, so only newly-discovered sources cost a trace and
    migrated worlds rebuild from their existing source hexes.
  - **Rendering:** `js/ui/map.js`'s **`drawRivers`** draws each river as one smooth blue
    polyline through the hex centres (midpoint-anchored quadratics), **including across
    unexplored hexes** — so a river visibly runs to the coast even when the sea itself
    hasn't been generated — with a bounding-box viewport cull. The per-hex renderer
    (`drawRiverEdges`, hexside/center styles) is retired.
  - **Removed:** the whole per-hex flow model — `downhillDirection`, `riverStateAt`,
    lake-overflow, `overflowDirection`, `stitchRiverForward`/`incomingRiverEdges`, and
    the `hex.riverEdges` field. `river.js` keeps only source detection (`isRiverSource`).
  - Verified in-browser: a Huge fill yields ~19-47 long winding rivers, all traced to
    sea; a coastal seed shows multiple rivers visibly flowing into a rendered Sea body.
  - **Follow-up (immediate real-play — "a lot of rivers almost cross and look like
    spaghetti"): tributary merging.** Independent traces from nearby sources found
    near-identical lowest-pass routes to the same coast, so they ran near-parallel and
    crossed. Fix: `syncRivers` traces sources in **canonical (sorted) order** sharing one
    `claimed` set, and `traceRiverToSea` takes a `claimed` option — the trace terminates
    on reaching a claimed hex (a **confluence**; the tributary joins that trunk and its
    downstream is drawn once, not duplicated). This yields a dendritic network:
    scratchpad measured **82% of rivers join a trunk, 81% less total line drawn**,
    distinct river hexes 2391→667, ~7 sea-reaching trunks per large map. Deterministic
    and order-independent (canonical order, not generation order); the network rebuilds
    whenever the source set changes, and `world.riversMerged` forces a one-time rebuild
    of any pre-merge world. Confirmed in-browser on the same seed as the spaghetti shot —
    clean confluences, no parallel bundles.
  - **Follow-up (real-play — "a river should terminate as soon as it touches a water
    cell"): terminate at first water.** Rivers routed THROUGH rendered lakes/bays and back
    onto land ("mountain → across the sea → inland → ends in a lake") because the trace
    only recognised the raw ocean GATE (`isOceanAt`), not lakes or bay-flipped Sea —
    measured **80% of paths crossed a rendered-water hex before ending**. Fix: `biome.js`
    exports `isWaterAt` (Sea OR fresh Lake, pure/position-based), and `traceRiverToSea`
    terminates at the first water hex OUTSIDE the source's own water body — a bounded
    `sourceWaterBody` flood-fill lets a Lake source cross its own lake before ending at the
    next water downhill. Result: **0% cross water**; median length 87→~8-11 hexes, ~17% end
    at the sea and ~83% at an inland lake (the nearest natural sink). `reachedSea` renamed
    `reachedWater` throughout; `world.riversFormat` (now 3) stamps the tracing logic version
    and forces a one-time rebuild when it changes. Tradeoff surfaced to the user: this
    shortens rivers and most now end at lakes rather than the sea — a "flow through lakes,
    stop only at the sea" variant is a one-line change if longer sea-reaching rivers are
    wanted. Two design ideas the user floated were also assessed: (a) WFC + probabilistic
    elevation mesh — rejected (the downhill-to-water constraint is already free from the
    pure elevation field; WFC needs a bounded, order-dependent solve, the opposite of our
    determinism — but the "grey out invalid tiles during manual placement" nugget is worth
    keeping as a local check later); (b) "retro rivers" (simple hexes, draw rivers later) —
    already essentially our architecture (derived `world.rivers[]` layer over river-free
    hexes); if drawing across unexplored land is undesirable, clip the RENDER to explored
    hexes rather than changing the deterministic trace.
- Schema bumped to **v12** (top-level `rivers` array; backfilled empty on load and
  rebuilt from source hexes. The earlier v11 `riverEdges` field is left unused.).
- **Tests (post-rework):** `test/river.test.js` now covers only source detection
  (Mountains-peak and spontaneous-Lake origins, rare-not-universal, deterministic,
  non-peak Mountains gated out). New `test/river-trace.test.js`: the path is a connected
  adjacent chain source-first, >95% reach the sea and terminate on an ocean hex, interior
  hexes are land, deterministic, stable `riverId`. `test/terrain-coherence.test.js`'s
  river integration tests rewritten to mirror `syncRivers` (registry built over a real
  fill, connected chains, >90% reach sea). `test/biome.test.js` keeps the
  Lake-never-adjacent-to-Sea bay-rule regression; the tracer suite also covers the
  `claimed`-confluence early-termination (a tributary joining a trunk) and the
  integration suite mirrors the merged canonical-order rebuild. **261 `node --test
  test/*.test.js` passing.**
- **Historical (pre-rework) v11 design, superseded above — kept for the record:**
  Schema was bumped to **v11** (stamp-only — `riverEdges` additive).
- **Tests (pre-rework):** `test/river.test.js` (19 tests — source detection now covers BOTH
  Mountains-peak and spontaneous-Lake origins (only those two terrains ever source;
  both rare-not-universal across many seeds); `downhillDirection` always a valid index
  or -1, and when valid the chosen neighbour is genuinely lower, verified both ways by
  scanning real coordinates rather than hardcoded literals; `riverStateAt`'s full
  decision table — no-op, terminate-at-water, land-with-real-downhill, forced-Lake
  depression, a qualifying mountain source, a non-source Lake staying inert, a
  spring-fed Lake origin growing exactly one outflow, Swamp-as-pass-through-land, and
  the inflow-outflow escape-hatch/compounding pair — all found by scanning rather than
  guessed coordinates). `test/terrain-coherence.test.js` gained 3 integration tests
  mirroring the sea-contagion pattern (deliberately not the shared order-independent
  `generateArea` helper, since river propagation is history-dependent by design):
  rivers appear across a large area, an edge toward an already-placed *later-generated*
  neighbour always connects to that neighbour's matching incoming edge (the core
  propagation invariant), and every non-sink river hex has an outgoing edge toward its
  own real downhill direction. `test/biome.test.js` gained the Lake-never-adjacent-to-Sea
  bay-rule regression. 269 `node --test test/*.test.js` passing (stable across repeated
  runs).
- Runs **before settlement sizing** so cities can key off rivers/estuaries (3R.6).

### 3R.6 — Settlements v2
- **Document current types** (Thorp/Hamlet/Village/Town/City) — done above.
- **Spawn-density dial-down (step A) ✅ done** — the flat per-hex settlement `chance`
  (`terrain-profile.js` `TERRAIN_PROFILE`) was cut ~4× from the pre-3R.6 rates, taking the land
  settlement rate from ~30% to ~10%. (Step B below took it further — see there for current numbers.)
  Pure-data change at the single `generateHex` choke-point; no schema/migration. Node suite
  `settlement-density.test.js` pins the band + ties the constants to real `generateHex` output.
- **Sparser + size-tiered (step B) ✅ done** — after play feedback ("too many settlements; big ones
  cluster"), chances went to "very sparse", then a further retune (still too many overall; too many
  in desert) landed at Plains 0.022, Hills 0.016, Forest 0.014, Mountains/Swamp 0.007, Desert 0.006
  (Desert now the harshest — oasis-only, ~0–1 settlements even across dozens of desert hexes;
  DEFAULT 0.014) — a Huge fill now ~5–11 settlements, down from ~33–47 — and big settlements were
  made sparse + non-clustering. Model (a hex = 6 miles; a day =
  ~4 hexes): (1) `data/settlement-size.json` reskewed so Town+City is ~10% of the roll (was ~20%),
  Thorp/Hamlet dominant; (2) **soft proximity suppression** — `generateHex` takes `nearbyLargeCount`
  (existing Town/City within 4 hexes, from `app.js`'s `nearbyLargeCount(q,r)`, mirroring
  `neighborTerrains`) and scales the Town/City size-roll weights by `LARGE_SUPPRESSION(0.15)**count`
  (`suppressLargeSizes`/`isLargeSize`). A big settlement near another *usually* rolls smaller, but
  the weight never reaches 0 — a cluster stays **possible, just rare** (the user's "anything
  possible; use probability to make it very rare"). Nothing is demoted/removed post-hoc, and the rng
  stream is unchanged (reweight only) so determinism/POI rolls hold. No schema/migration. Measured
  end-to-end: 0–2 large per Huge fill, none within a day of each other. **Forward hook:** the rivers
  step will pass a bypass (e.g. `nearbyLargeCount: 0` on-river) so clusters form where a river/coast
  gives a reason. This SUPERSEDES the min-spacing / per-region-cap idea below (a soft probabilistic
  penalty was preferred over a hard geometric cap).
- **Keep/Fort + drop Thorp ✅ done** — Thorp (near-identical to Hamlet) was removed; Hamlet is now
  the smallest tier (size table reweighted, `SIZE_ORDER` trimmed, schema **v13→v14**, stamp-only —
  no back-compat migration, per the user's no-back-compat directive). **Keep/Fort** landed as the recommended `kind: "keep"` **martial overlay**
  (any size, not a new tier), rolled from its own `subRng` sub-stream conditional on the settlement
  roll and terrain-biased via `TERRAIN_PROFILE.settlement.keepChance` (Mountains 0.4 … Plains 0.1 →
  ~0–2 per Huge fill). New `keep.svg` sketch + rook (♜) marker; `settlementArt/Mark(size, kind)`;
  node-tested. Naming (keep vs fort vs watchtower) can come with the Names sub-step.
- **Names ✅ done** — every settlement gets an evocative seeded name
  (`js/gen/settlement-name.js` `settlementName(seed, q, r, gen, {kind, terrain})`), **derived not
  stored** (pure function of coords → no schema field; manual settlements named for free; regen
  reshuffles). Prefix + terrain-flavored ending (Brackholt/Westercrag/Fenmoor), martial style for
  keeps (Fort Marsh, Dun Keep), stutter-guarded. Element lists are JS consts (render path needs them
  sync). Rendered as the default map label (GM `hex.name` still overrides) + panel line. Node-tested.
  (Ended up NOT reusing the hex-name field for storage — deriving is cleaner and needs no plumbing.)
- **Sparser spacing** — replace/augment the flat per-hex chance with a **minimum
  spacing / per-region cap** (Poisson-disc-style rejection or a density budget), and
  retune the high Plains 0.45. Objective target from the 3R.2 spacing metric.
- **Hamlet clusters ✅ done** — a large (Town/City) settlement sprinkles a few **farming
  hamlets** in the arable land (Plains/Hills) of its immediate ring — a "breadbasket". Kept a
  deliberate SPRINKLING: `CLUSTER_HAMLET_CHANCE` 0.2 per farmland neighbour, so ~half of big towns
  get a hamlet or two and the rest stand alone (`settlement-water.js` `seedHamletClusters`, run by
  `syncRivers` after the water passes — so anchors are their final boosted size — then a second
  idempotent `applyWaterBoosts` so a riverside hamlet is sized consistently that same sync).
  Deterministic + idempotent via a per-hex `clusterSeeded` decided-flag (no duplicates; a deleted
  hamlet isn't resurrected); doesn't override an existing settlement. Measured: ~3.6 cluster hamlets
  per Huge fill. Node-tested. (Did NOT need region/chunk generation — the immediate-ring approach
  reads as a breadbasket and stays deterministic under lazy reveal.)
- **River→settlement gravity (side step) ✅ done** — a river tracing past a settlement now bends to
  pass close to it. `computeRivers` takes a `settlementsByKey` map and biases the descent trace with a
  size-weighted, radius-limited attraction (`PULL_SIZE_WEIGHT`, `pullRadius` = 3 for City, 2 for
  Town-and-smaller), picking among non-climbing neighbours only so rivers still always reach water; a
  steepest-descent fallback means no river is ever lost, and away from towns it's plain steepest
  descent. New/auto traces only (existing/manual frozen). Tuned in the scratchpad (near-river
  settlement adjacency ~doubled); node-tested. This is distinct from the size boost below (routing,
  not sizing).
- **River/coast boosts ✅ done** — a settlement **on/beside a river** or **on the coast** (sea-adjacent)
  is bumped **+1** size tier; a **river-mouth/estuary** (both) gets **+2** (→ Towns/Cities). New pure
  `js/gen/settlement-water.js` (`applyWaterBoosts`), run by `syncRivers` right after `computeRivers`
  (enforcing the water → rivers → **then** sizing order). **Idempotent**: the rolled size is captured
  once as `settlement.baseSize` and the effective `size` is re-derived from base + water context each
  sync, so it never compounds. May exceed the terrain maxSize (water is the reason). A `waterBoost` tag
  surfaces in the panel. Node-tested. (Delivered as deterministic tier bumps rather than a "City chance"
  roll — cleaner and idempotent; a seeded probability is a one-liner if preferred.)
- **Water settlement GENERATION ✅ done** (the "generate NEW settlements, not just boost" half) —
  `settlement-water.js` `seedWaterSettlements`, run by `syncRivers` before the boost: scattered small
  settlements **along a river's course** (Hamlet/Village base; the +1 riverside boost lifts a share to
  **Towns**), a **port at most river mouths** (double whammy — where it meets the sea or a big lake:
  `MOUTH_SETTLE_CHANCE` 0.6 so not every mouth settles, a **random base type** that the +2 estuary
  boost lifts to mostly-City/occasional-Town, and `MOUTH_KEEP_CHANCE` 0.25 for the odd martial **keep**),
  and **shore Cities on lakes** (big always, small sometimes). Deterministic + idempotent via a per-hex
  `waterSeeded` decided-flag (no duplicates on the repeated syncs; a GM-deleted seed isn't resurrected).
  Measured over 8 Huge seeds: mouths settle ~58% (mostly City, some Town, ~18% keeps); river courses
  carry a scatter of Villages and Towns; landlocked seeds barely change. Node-tested. Tunable:
  `RIVER_SETTLE_CHANCE`, `MOUTH_SETTLE_CHANCE`, `MOUTH_KEEP_CHANCE`, `BIG_LAKE_SIZE`, `SMALL_LAKE_CITY_CHANCE`.
- Schema: no bump needed — `kind`, `baseSize`, `waterBoost` are all additive fields (no migration, per
  the no-back-compat directive); `name` is derived, not stored.

### 3R.7 — Roads
- **Connect settlements**, weighted by size — a **gravity model**: desirability ∝
  `sizeA·sizeB / distance^k`; build a road when it clears a threshold. Larger
  settlements "pull" roads from further away.
- **Routing / pathfinding** — least-cost path over hexes:
  - **Mountains** = high cost → route **around** a range when the detour ≤ *n* tiles;
    if going around costs more than *n*, **cut through**, but the range **inflates the
    effective distance** (so a long range can make the link fail the gravity threshold
    entirely — exactly your "act as though further away").
  - **Deserts** = very high cost → roads **almost never**; allow a rare **ancient dead-
    straight road** that ignores terrain cost.
- **Tiers/sizes** — from the gravity weight: **ancient wide paved roads** between major
  cities down to local tracks. Render by width/style.
- **Spurs / side roads** — a small settlement near an existing road links to it with a
  short **spur** instead of a full long-haul road.
- **Timing** — your proposal: when a settlement is generated, evaluate it against every
  existing settlement **largest → smallest** and decide each link. *(This is close to a
  known technique — a greedy gravity/Steiner network; the research step compares
  incremental-per-settlement vs a batch network pass, and how to keep either
  deterministic under area generation.)*
- Represent as hex-path / hex-side edges (tiered). Node-tested: connectivity, mountain
  avoidance-then-cut-through, desert suppression, spur behaviour.

### 3R.8 — Integration: pipeline, regeneration, rendering, migration, tuning
- Wire the full **deterministic region pipeline**: terrain → water/coastline → rivers
  → settlements (with boosts) → roads. Point the **3R.1 "Generate Area"** tool at it.
- **Regeneration policy** — whole-region regenerate; single-hex re-roll inside a
  coherent region without breaking coastlines/rivers/roads (respect the `locked`/
  `manual` flag; re-stitch edges).
- **Rendering pass** — roads (tiered), settlement tiers + Keep/Fort icon, optional
  region labels; legend + LOD updates. (Rivers' line rendering already shipped in 3R.5,
  pulled forward on request — see that section.) **Requested tweak ✅ done (pulled forward):**
  Hills recoloured `#b08d4f` → **`#8c9e71`** (`terrain-style.js` `TERRAIN_COLORS`), a grey-green
  midpoint of Mountains grey + Plains green, so the Mountains→Hills→Plains band reads as an
  elevation gradient.
- **Migration/compat** for pre-3R worlds. **Performance** pass (large-area gen stays
  snappy). Final **tuning** against the 3R.2 metrics.

---

## Open design decisions (to confirm as we go)

- **World-building model: ✅ decided in 3R.2 — (c) two-layer elevation+moisture**
  (coordinate-hashed noise fields for elevation + moisture, Whittaker-style
  biome classification). See 3R.2's fork write-up for the full reasoning.
- **Water naming:** ✅ decided in 3R.4 — Lake/Sea (as two full terrain values, not a
  Water+subtype field — see 3R.4's write-up for why).
- **Elevation/moisture:** ✅ adopted as first-class per-hex fields (3R.2) — the
  keystone that makes terrain coherence, sea level, and rivers all fall out.
- **Keep/Fort:** new size tier vs martial overlay on an existing band. *Leaning overlay.*
- **Road generation:** incremental per-settlement vs batch network pass.
- **Regen vs manual edits:** per-hex `locked` flag semantics.

## Ideas worth folding in (things that pair well)

- **Elevation + moisture fields** (as above) — the single highest-leverage addition.
- **Named regions/biomes** ("the Blackpine", "the Salt Marches") — pairs with the
  Phase 7.7 **search** feature and gives GMs flavour hooks.
- **Bridges/fords** where a road crosses a river; **ports** where a road meets a
  coastal city — cheap emergent detail once rivers+roads+coast exist.
- **Travel tie-in (future, not in scope):** roads speed travel / rivers slow crossing —
  hooks into the existing scale-bar & travel-tier work.
- **Hook/POI synergy:** rivers, roads, and coasts are natural hook geography ("bandits
  on the north road", "smugglers at the river mouth").

## Risks / watch-items

- **Scope** — this is a multi-sub-phase arc; keep each shippable on its own.
- **Determinism under area generation** — the biggest correctness risk; lock it with
  order-independence tests early (3R.1/3R.2). **Structurally closed in 3R.3** — terrain
  is now a pure function of `(seed, q, r)` (elevation/moisture noise), not a read of
  already-placed neighbours, so order-independence is provable, not just tested.
  **Deliberately reopened, narrowly, in 3R.4's sea-contagion revision**: Sea propagation
  near existing content depends on generation history (which neighbours are already
  placed) — an explicit, requested trade-off, scoped to Sea only; everything else
  (Mountains/Hills/Forest/Plains/Desert/Swamp/Lake, and Sea itself with zero Sea
  neighbours) stays pure-position as before. Watch this doesn't creep into other
  terrain types without the same explicit trade-off being made consciously.
  **Reopened again, for a second reason, in 3R.5's river propagation**: not
  responsiveness to a manual placement this time, but the ~28ms/hex cost of a fully
  analytical per-hex river query (measured too slow for interactive area generation) —
  `hex.riverEdges` grows forward from already-placed upstream neighbours instead, the
  same propagation shape as sea contagion.
  **A third, DIFFERENT kind of exception, in 3R.5's river-stitching follow-up**: the first
  two exceptions only ever affect a hex's classification at the moment it's *generated* —
  they never modify a hex that's already placed. River stitching (`stitchRiverForward`,
  `js/ui/app.js`) is the first case that does: it retroactively adds a purely cosmetic
  river edge to an already-placed hex, confirmed explicitly with the user first since it
  bends a rule that had otherwise held everywhere. Scoped tightly (river-edge data only,
  never terrain/settlement/POIs, never overwrites a hex that already carries its own
  river, capped at 20 cascaded hops) specifically because it's a different *kind* of
  exception from the other two. Three deliberate exceptions now exist, each independently
  justified, narrowly scoped, and explicitly reasoned through; watch for a fourth creeping
  in without the same rigor.
- **Migration churn** — several schema bumps; keep every step additive and old-world-safe.
- **Perceptual vs real** — 3R.2's baseline decides how much terrain rework is truly
  warranted before we over-engineer.
- **Coherence tests can pass while the *topology* is still wrong** — 3R.4's first pass
  had automated tests confirming "Lake and Sea both appear, neither near 0%", which all
  passed, while the actual bug (Sea reading as an inland lake, not a coastline) was only
  caught by manual/visual inspection. Distribution checks alone don't verify shape —
  worth a manual eyeball pass on anything geometry-shaped (coastlines, later rivers/
  roads), not just a green test suite.
