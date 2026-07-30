# Phase 14 — Cultures & Ancestry (demihuman regions + heritage POIs)

**Status:** planning → in progress.

**Prime Directive (pre-V1):** No backward compatibility. No data migration. We may
throw out old saved worlds between test batches. So: reshape the schema freely, bump
`SCHEMA_VERSION` if convenient but **do not** write migration code for culture fields —
a world without them is simply regenerated.

The world is mostly **Human**. Human is the **null case** — never stored as a race,
never labelled, never tinted; it is the assumed default. A minority of the map instead
belongs to a BX/OSE demihuman people: **Elf, Dwarf, Halfling, Gnome**. Their presence
skews settlement / region / tavern / POI names and flavour, and is drawn on the map.
Everything is **derived deterministically from (seed, position)** or read from a
bounded field — plus a thin layer of **stored anchors** (settlements & POIs) that pin
the shape so it never re-shuffles as the map is revealed.

---

## 1. The model

### 1.1 Two fields
- **Living field** — "who lives here *now*." A per-hex `{race, strength}` produced by
  terrain-modulated diffusion from discrete **cores** (seeded by terrain regions).
  Strength decays with distance; decay is **slow through the race's favoured terrain,
  fast across hostile terrain, but never to exactly zero** (epsilon floor → any race is
  *possible* anywhere, e.g. deep elves in the mountains at ~1/1000). Above a threshold
  the hex belongs to the dominant culture; below it the hex is Human/null.
- **Heritage field** — "who built here *once*." The same cores with a **wider reach**
  (≈1.5–2× the living reach) and **weaker/absent terrain modulation** — a high-water
  mark of a people's past extent. Ancient/ruined POIs roll their *builder*-race against
  this, so an elf-wrought tower can stand a few hexes beyond the living wood.

Both fields are pure functions of (seed, revealed terrain, anchors). No entity ever
influences another at generation time (see §5, non-negotiables).

### 1.2 Anchors (the pegs)
A culture is a tent: the field is the fabric, the **settlements are the pegs**.
- When a **settlement** is generated in a hex, it is **stamped with a race** (rolled
  against the living field there — see §1.4) and **stored** on the settlement. It never
  re-rolls. Reveal a distant hex and the field's far edge may ripple; stamped towns do
  not move.
- Stored anchors **feed back into the living field as fixed sources**, so the field near
  towns is pinned by the pegs and only the town-less frontier is free to breathe. This
  is what keeps a culture's shape mostly intact.
- **GM paint** (§ Step 6) is just a manual anchor; **remove** clears it. Mechanically
  identical to a town.

### 1.3 POI heritage (§ Step 4)
Every POI gets a heritage roll at generation:
- Baseline ≈ **99.99% neutral/standard**, so a cultural artifact can surface *anywhere*.
- The chance **rises with heritage-field strength** (i.e. with proximity to a culture),
  capped **below 100%** — even inside a living culture some POIs stay neutral, because
  the people may have **moved in after** the thing was built/dug.
- When it fires, the race is weighted by the heritage-field composition at the hex, plus
  the epsilon floor.
- The result is **stamped and stored** on the POI (`poi.heritage`), same anchor logic.
- Builder ≠ occupier is allowed and encouraged (an elf ruin now held by goblins — reuse
  the existing occupier system).

### 1.4 The stamping roll (settlements & POIs)
`P(demihuman) = clamp(FLOOR + strength * GAIN + patchBump, 0, P_MAX)` with `P_MAX < 1`.
If it fires, `race = weightedPick(fieldComposition + patchRace + epsilonAll)`. Else null.

### 1.5 Heritage clusters (§ Step 4) — the safe way
We want lonely ruins to sometimes form a **2–5 POI cluster** of one vanished people.
**Do NOT** implement this as "one POI boosts the next" — that is stateful,
generation-order-dependent, and cascades (it is exactly the runaway-chaining bug an
earlier prototype hit). Instead, every POI independently samples a **shared latent
"heritage-patch" field** built from `fbm2D` (`js/core/noise.js`, layer
`"heritage-patch"`). Because the noise is spatially coherent, POIs that fall in the same
patch read the same race **for free** — no cross-POI communication, deterministic,
order-independent. Cluster size = noise frequency; rarity = threshold.

---

## 2. Data shapes (pre-V1 — change freely, no migration)
- `settlement.race?: "elf"|"dwarf"|"halfling"|"gnome"` — absent = Human/null.
- `poi.heritage?: { race: "elf"|... }` — absent = neutral.
- Culture **overrides** (GM paint, Step 6): a top-level `world.cultureAnchors: [{q,r,race}]`
  (empty by default). Living cores are derived, not stored.
- The living/heritage fields themselves are **derived at render/generation** — never
  persisted (only the anchors that pin them are).

## 3. Knobs (defaults — TUNE against screenshots)
- `CULTURE_DENSITY` (master dial — user wants this **low** so borders are rare). Per
  candidate-core chance of being demihuman at all: Forest 0.25, Hills 0.20,
  Mountains 0.22, Plains 0.10, Swamp 0.05, Desert 0.05, Water 0.
- Race-by-terrain weights (+ epsilon so every race is possible anywhere):
  - Forest: Elf 60, Gnome 8, Halfling 6, Dwarf 3
  - Mountains: Dwarf 55, Gnome 20, Elf 1, Halfling 1
  - Hills: Gnome 30, Halfling 30, Dwarf 15, Elf 3
  - Plains: Halfling 40, Gnome 5, Elf 3, Dwarf 2
  - Swamp: Elf 3, Gnome 3, Dwarf 2, Halfling 2
  - Desert: Dwarf 3, Gnome 2, Halfling 2, Elf 1
- Living field: decay per hex; favoured-terrain multiplier; `THRESHOLD` for membership.
- Heritage field: reach ≈ 1.5–2× living; weak terrain modulation.
- POI heritage: `FLOOR≈0.0001`, `GAIN`, `P_MAX≈0.85`.
- Anchor source strength `S_ANCHOR` (how hard a town pins the field).
- Colours: Elf = deep green/teal, Dwarf = slate blue-grey, Halfling = warm gold/amber,
  Gnome = ochre/rust.

## 4. Naming
Race-specific pools, wired into `settlement-name.js`, `regions.js` (region/realm name),
`oracle.js` (`rollTavern`), and `poi.js` (POI name/flavour incl. heritage descriptors
like "elf-wrought", "dwarf-delved"). Naming rolls against strength so fringe hexes are
only *sometimes* racial. Flavour of the pools:
- Elf: flowing, vowel-heavy, soft, occasional apostrophe (Silvaal, Aeloth, Cael'thas).
- Dwarf: hard/guttural, doubled consonants, -grim/-dûr/-hold/-forge (Karr-dûr, Durrangar).
- Halfling: homely/pastoral English (Tuckborough, Greenhollow, Bramblewick).
- Gnome: tinkery/whimsical (Fizzwick, Coppercog, Glimmerdell, Nackwick).

---

## 5. Determinism & non-negotiables (the anti-bug rules)
1. **No entity-to-entity influence at generation time.** Correlation (clusters, shape)
   comes only from shared latent fields / stored anchors — never from "the last thing I
   rolled." This is the #1 rule; violating it is what caused the chaining bug.
2. **Bounded reach.** Field strength is monotonically non-increasing with distance from
   its sources. Tests must assert a culture cannot cover the whole map.
3. **Order independence.** Revealing/generating hexes in a different order must not change
   any stamped race or field value. Test both orders.
4. **Human is null** — never stored, labelled, or tinted.
5. **Every dev step runs the full `node --test` suite before sign-off** and must show **no
   degradation** vs. the previous step. Add unit tests for new pure logic.

---

## 6. Build steps

Executed **serially** (each builds on the previous, committed step) — the dependency
chain is real and serial keeps merge-conflict and cascade risk at zero. Model/thinking
level chosen per step's difficulty.

### Step 1 — Foundations: race registry, weights, name pools, race-aware naming
*(model: sonnet, medium)* — content-heavy, low algorithmic risk.
- New `js/gen/culture-data.js`: race list, `CULTURE_DENSITY`, terrain→race weights (with
  epsilon), `CULTURE_COLORS`, and per-race name pools.
- Extend `settlementName`, `regionName`, `rollTavern` to accept an optional `race` → race
  pools; **default (no race) = existing Human behaviour, byte-for-byte**.
- Tests: pools non-empty & deterministic; Human default unchanged; every race produces a
  plausible name for each name-type.
- **Acceptance:** full suite green; new naming tests pass; no caller behaviour changes yet.

### Step 2 — Culture field engine (`js/gen/culture.js`)
*(model: opus, high)* — the keystone; correctness-critical.
- Derive cores from terrain regions (reuse `computeRegions`); assign race per core
  (weights + epsilon + `CULTURE_DENSITY`), seeded from the region anchor.
- `livingField`/`cultureAt(...)`: per-hex `{race,strength}` via terrain-modulated decay,
  max across cores + optional anchor sources, threshold → dominant or null.
- `heritageField`/`heritageAt(...)`: wider reach, weak terrain modulation.
- `listCultures(...)` for labels/legend; export `CULTURE_COLORS` passthrough.
- Tests: determinism, order-independence, epsilon floor, monotonic decay, **bounded
  reach** (no whole-map takeover), density behaviour, anchor pinning.
- **Acceptance:** full suite green; engine tests prove §5 rules 1–4.

### Step 3 — Anchors & generation integration
*(model: opus, high)* — integration correctness; where cascade bugs live.
- At hex generation, stamp `settlement.race` from the living field (roll §1.4, `P_MAX<1`),
  store it; wire settlement/region/tavern naming to the stored race.
- Feed stored settlement anchors back into the living field as fixed sources.
- Tests: strong-culture hex stamps that race; stamp stable across re-derive & across
  reveal order; naming uses the stored race; anchors pin the field.
- **Acceptance:** full suite green; a generated Huge world shows stamped demihuman towns.

### Step 4 — POI heritage & clustering
*(model: opus, high)* — probability model + coherent noise; subtle.
- POI heritage roll at generation (§1.3/1.4) against the heritage field; stamp
  `poi.heritage`; race-aware POI names/flavour ("Kaelthar, an elf-wrought tower");
  allow builder ≠ occupier.
- Clustering via `fbm2D("heritage-patch")` (§1.5) — **stateless**, order-independent.
- Tests: ~99.99% neutral floor far from cultures; proximity scaling; cluster coherence
  (adjacent hexes in one patch share race with high probability); determinism &
  order-independence; Human-null dominates.
- **Acceptance:** full suite green; heritage ruins appear, occasionally clustered.

### Step 5 — Rendering & UI
*(model: opus, medium-high)* — the deliverable the user judges by eye.
- `map.js`: per-hex culture tint (opacity ∝ strength) under the terrain art; core/peak
  labels ("Realm of X · Elf"); legend entries; contested borders visibly blended
  (tension = feature); heritage POIs surfaced in the panel.
- `panel.js`: selection shows settlement race, POI heritage/builder, hex culture.
- Verify with the screenshot harness (`.../scratchpad/shot.mjs`, fresh Huge world).
- **Acceptance:** full suite green; screenshots show legible, low-density cultures with
  race-correct names and at least one contested border.

### Step 6 — GM paint / remove (override anchors)
*(model: sonnet, medium)* — additive UI on top of a working derived world.
- Radial-menu / panel action to assign or clear a culture on a hex/region
  (`world.cultureAnchors`); painted anchor feeds the field as a source; clear removes.
- Tests: paint sets anchor & field reflects it; remove clears.
- **Acceptance:** full suite green; paint/remove works in-app.

---

## 7. Progress
- [x] Step 1 — Foundations
- [x] Step 2 — Culture field engine
- [x] Step 3 — Anchors & generation
- [x] Step 4 — POI heritage & clustering  *(mechanism done; heritage rate ~43% on a test world — TUNE DOWN in the post-Step-5 pass, alongside culture density)*
- [x] Step 5 — Rendering & UI
- [ ] Step 5.5 — Tuning pass (culture density down, heritage rate down, fix "Meadowmeadows" region-name stutter)
- [ ] Step 6 — GM paint / remove
