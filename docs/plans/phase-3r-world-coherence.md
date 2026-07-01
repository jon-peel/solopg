# Phase 3R — World Coherence (revisit of Phase 3: terrain & POI rules)

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
  (radius 3)**, a true hex-radius disc (not a rectangle).
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
  origin-centered land bias (`LAND_BOOST 0.7`, falloff over `FALLOFF_RADIUS 30` hexes via
  `axialDistance`) boosts `continent` near `(0,0)` only, guaranteeing every new world
  spawns on land — verified across 14 seeds (`biomeAt(seed, 0, 0)` is never `"Sea"`).
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
- Schema bumped to **v11** (stamp-only — `riverEdges` is additive, absent on old hexes
  until regenerated).
- **Tests:** `test/river.test.js` (13 tests — `isRiverSource` gated on Mountains and
  rare-not-universal across many seeds; `downhillDirection` always a valid index or -1,
  and when valid the chosen neighbour is genuinely lower, verified both ways by scanning
  real coordinates rather than hardcoded literals; `riverStateAt`'s full decision table —
  no-op, terminate-at-water, land-with-real-downhill, forced-Lake depression, and a
  qualifying source, all found by scanning rather than guessed coordinates).
  `test/terrain-coherence.test.js` gained 3 integration tests mirroring the sea-contagion
  pattern (deliberately not the shared order-independent `generateArea` helper, since
  river propagation is history-dependent by design): rivers appear across a large area,
  an edge toward an already-placed *later-generated* neighbour always connects to that
  neighbour's matching incoming edge (the core propagation invariant), and every
  non-sink river hex has an outgoing edge toward its own real downhill direction.
  262 `node --test test/*.test.js` passing (stable across repeated runs).
- Runs **before settlement sizing** so cities can key off rivers/estuaries (3R.6).

### 3R.6 — Settlements v2
- **Document current types** (Thorp/Hamlet/Village/Town/City) — done above.
- **Add Keep/Fort** — a **martial variant** rather than a new size tier (recommend: a
  Village-equivalent "footprint" with a `kind: "keep"` overlay so sizing/roads treat
  it consistently). To confirm which band and whether it's a separate spawn or a
  reskin.
- **Names** — settlements have none today. Add a seeded name generator (new tables),
  reusing the existing hex `name`/notes plumbing where sensible.
- **Sparser spacing** — replace/augment the flat per-hex chance with a **minimum
  spacing / per-region cap** (Poisson-disc-style rejection or a density budget), and
  retune the high Plains 0.45. Objective target from the 3R.2 spacing metric.
- **Hamlet clusters** — a large settlement seeds a few **farming hamlets** in nearby
  hexes (a "breadbasket"). Needs region/chunk generation (3R.2 model) to place the
  cluster coherently.
- **River/coast boosts (ordering-dependent):** a settlement **on a river** gets a
  size boost; a **river-mouth/estuary** hex gets a boosted chance of a **City** and a
  larger settlement. Enforce order: water → rivers → **then** settlement sizing.
- Schema: settlement `kind` (keep/fort), `name`, and river/coast linkage; migration.

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
  pulled forward on request — see that section.) **Requested tweak:** recolour
  Hills as a blend of Mountains' grey and Plains' green (`terrain-style.js`
  `TERRAIN_COLORS`) so the Mountains→Hills→Plains elevation band reads as a visual
  gradient, reinforcing the 3R.3 biome-coherence work.
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
