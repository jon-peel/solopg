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
- **Step — the fork (world-building model), the key decision that gates 3R.4–3R.7:**
  - **(a) Incremental, stronger coherence** — keep hex-by-hex but make neighbour
    influence dominant (transition tables, not a mild additive nudge).
  - **(b) Region/chunk** — an area gets a dominant biome, then fills within it.
  - **(c) Two-layer** — a coarse region map (elevation + moisture + sea level) →
    per-hex detail derived from it. *(Leading candidate: makes coastlines, rivers,
    and biome bands fall out naturally.)*
- **Deliverable:** an audit + baseline stats + a **chosen model** written down. No
  gameplay change yet.

### 3R.3 — Terrain generation v2
- Implement the chosen model. Likely: **elevation + moisture** as first-class per-hex
  fields → biome via a small classifier, giving clustered biomes, **mountain ranges**
  (chains, not speckle), and suppression of lone single-hex anomalies. If we pick the
  incremental model instead, replace the additive nudge with **neighbour transition
  tables**.
- Keep **manual placement** + `terrainBias` meaningful.
- **Tests:** distribution/adjacency assertions (e.g. mountains form runs ≥ N; lone-hex
  rate below a threshold), not exact-art snapshots. Compare against the 3R.2 baseline.
- **Migration/regen:** how existing worlds adopt v2 (regenerate affordance vs leave
  as-is).

### 3R.4 — Water v2: fresh vs salt, coastlines, continents & islands
- Split **Water → Lake (fresh) + Sea (salt)**. *(Recommend "Lake"/"Sea" over
  "Fresh"/"Salt" — reads better on a legend. To confirm.)* Terrain subtype vs two
  terrains is an implementation choice (subtype keeps profile logic simple).
- **Coastline/landmass logic — plan a few options (per request):**
  1. **Edge-sea flood-fill** — sea enters from map edges / large basins; enclosed low
     areas become lakes.
  2. **Elevation threshold ("sea level")** — anything below the threshold connected to
     the border is Sea; below-threshold-but-enclosed is Lake. *(Natural fit if 3R.3
     gives elevation.)*
  3. **Explicit landmass seeds** — grow continents/islands, surround with Sea.
- Rendering: two water colours; legend update. Must land **before** rivers (they need
  water sinks) and before coastal-city logic.

### 3R.5 — Rivers
- **Model (your rules, encoded):** rivers **start in mountains** and flow **downhill**
  to a **lake or sea**; may flow **lake → lake → sea**; **never uphill** (never
  lake→mountain, never range→range); may pass **through their origin range** but route
  **around other ranges**.
- **My proposed logic (for your review):**
  - Elevation-guided **steepest-descent** path from a mountain source to the nearest
    water sink; **guarantee a sink** (carve onward, or form a lake in a landlocked
    basin — the classic "fill depressions" step).
  - **Tributaries merge**; track **stream order** (Strahler-ish) so width grows
    downstream → feeds settlement-size boosts and render thickness.
  - Avoid near-duplicate parallel rivers; cap density per region.
  - Represent as **hex-to-hex flow links / hex-side edges** so rivers render as lines
    and roads/settlements can query "is this hex on a river / at a river mouth?".
  - Deterministic; node-tested (source is mountain, monotonic descent, terminates at a
    sink, no uphill, no range→range).
- Runs **before settlement sizing** so cities can key off rivers/estuaries.

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
- **Rendering pass** — rivers, roads (tiered), two waters, settlement tiers + Keep/Fort
  icon, optional region labels; legend + LOD updates.
- **Migration/compat** for pre-3R worlds. **Performance** pass (large-area gen stays
  snappy). Final **tuning** against the 3R.2 metrics.

---

## Open design decisions (to confirm as we go)

- **World-building model:** (a) incremental / (b) region-chunk / (c) two-layer
  elevation+moisture. *Leaning (c).* — decided in 3R.2.
- **Water naming:** Lake/Sea vs Fresh/Salt. *Leaning Lake/Sea.*
- **Elevation/moisture:** adopt as first-class per-hex fields? *Strong yes — it's the
  keystone that makes terrain coherence, sea level, and rivers all fall out.*
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
  order-independence tests early (3R.1/3R.2).
- **Migration churn** — several schema bumps; keep every step additive and old-world-safe.
- **Perceptual vs real** — 3R.2's baseline decides how much terrain rework is truly
  warranted before we over-engineer.
