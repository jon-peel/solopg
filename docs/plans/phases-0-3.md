# Sub-plan: Phases 0–3 (completed) — as built

Record of the completed steps so a fresh session can understand what exists and why.
See [`../../PLAN.md`](../../PLAN.md) for the overview and conventions. All work is on branch
`claude/refine-local-plan-lg3hiu` (PR #1). End state: **schema v3, 81 `node --test` passing.**

Conventions referenced throughout: no build / no deps; serve over HTTP; seeded determinism via
`subRng`; data-driven JSON tables + JS-const rules; SVG art with emoji fallback. (Details in the
overview.)

---

## Phase 0 — Foundation & app shell ✅
**Goal:** the spine everything hangs on.
- Core engine: `js/core/rng.js` (mulberry32, `hashString`, `makeRng`, `subRng`, `randInt`,
  `pick`), `dice.js` (`rollDice`), `table.js` (`validateTable`, `rollTable` incl. nested `roll`),
  `loader.js` (`loadTable`/`loadTables` via `fetch`, `makeResolver`).
- Persistence: `js/data/db.js` (IndexedDB; **list of worlds**; `lastWorldId`),
  `js/data/portability.js` (`exportWorld`/`importWorld`, `schemaVersion` guard).
- World model: `js/world/world.js` (`createWorld`, `SCHEMA_VERSION`).
- Shell: `index.html`, `css/app.css`, `js/ui/app.js`, `js/ui/panel.js`.
- Dev: `package.json` (dev-only, `node --test`); `run-local.sh` (fetch branch → run tests → serve).
- Tests: rng, dice, table, world.

## Phase 1 — Single hex generator ✅
**Goal:** first real oracle (text only).
- `js/gen/hex.js` `generateHex(tables, rng, opts)` rolling terrain → settlement presence → size →
  POI presence/count; data tables `terrain`, `settlement-presence`, `settlement-size`,
  `poi-presence`.
- Stored on the world under throwaway **`u:<n>` unplaced keys** (`coords:null`); shown as text.
- **Schema bumped 1→2.** Tests: `hex.test.js`.

## Phase 2 — Hex map ✅
**Goal:** turn hexes into a navigable map.
- `js/core/hexgeo.js` (pure, tested): pointy-top **axial↔pixel**, **cube rounding**,
  `hexCorners`, `neighbors`, `axialKey`/`parseKey`.
- `js/ui/map.js` (canvas): camera (pan/drag, wheel-zoom-to-cursor), dpr-aware resize, click
  hit-testing, selection highlight, viewport culling.
- `js/world/world.js`: `getHex`/`hasHexAt`/`placedHexes` (+ later `removeHex`); hexes re-keyed to
  axial `"q,r"` with `coords`/`placed`. **No schema bump** (shape already had the fields).
- `js/ui/terrain-style.js` (`TERRAIN_COLORS`); neighbor-weighted terrain via
  `weightedTerrainTable`. Selection persists per-world in localStorage; camera in memory.

### 2.1 — Map interaction redesign ✅
- Empty cells drawn as outlines; selection works on any cell.
- Actions moved to the **right panel** for the selected tile (`renderSelectionPanel`): empty →
  Generate random / place terrain; filled → Generate neighbors / Regenerate / Delete. Removed the
  old command-bar generate buttons + terrain dropdown. Added `removeHex`. `gen` counter added so
  **Regenerate** yields a different hex deterministically.

### 2.2 — Map look & terrain pass ✅
- Added **Desert** + **Water** terrains (colours). Terrain **emoji icons** over the colour
  (2 variants, deterministic per cell), with an **Icons on/off** toggle + zoom gate.
- **Neighbor weighting upgraded** from "match same" to an affinity matrix
  (`js/gen/terrain-affinity.js`): self strongest, compatible terrains partial, incompatible none.

## Phase 3 — POIs + terrain-aware generation ✅
**Goal:** meaningful POIs + fix "village in open water". Occupants are flavour-only labels (no
faction objects).
- **Typed POIs:** `hex.pois` became `POI[]` (`{id,type,name,occupant,detail}`); occupant =
  creature **lair** / generic **occupier** (label) / **none**. New data: `poi-types`,
  `poi-occupant`, `creatures`, `occupiers`; generator `js/gen/poi.js`.
- **Terrain-aware rules:** `js/gen/terrain-profile.js` — per-terrain settlement chance + **max
  size** (no City in Desert; Mtn/Swamp ≤ Hamlet; **no settlement on Water**) and **allowed POI
  type weights** (Water excludes dungeon/etc.). `cappedSizeTable`, `poiTypeTable`, `profileFor`.
- **Schema bumped 2→3** + `migrateWorld` (v2→v3 resets old POI counts to `[]`; runs on import
  **and** load). Map shows a POI badge + settlement marker (`js/ui/poi-style.js`).
- Tests: `terrain-profile`, `poi`, `migration` (+ updated hex/world).

### 3.1 — One auto-POI + manual add/remove + marker fix ✅
- Auto-gen places **≤1 POI**; `hex.pois` stays an array so users curate more by hand
  (`generatePoi` gained `forceType`). Panel: add random / add specific type / remove.
- Fixed invisible multi-POI badge (dark disc + explicit fill; glyph for one, **count** for many).
- POI names embed occupant ("Ruin — Troll lair").

### 3.2 — Add-POI dropdown + Cave + UI tidy ✅
- Replaced per-type buttons with one **"Add POI ▾"** dropdown (stays open for rapid add). Added
  **Cave** POI type. Removed leftover debug "Roll test table"; tidied command bar + panel sections.

### 3.3 — Pencil terrain tiles ✅
- Coloured-pencil **SVG** motifs (`assets/terrain/*.svg`, 2 variants each) over the colour fill,
  variant chosen by coords at render time (not stored). `js/ui/terrain-art.js`; `map.js` image
  cache with **emoji fallback**. Tests: `terrain-art`.

### 3.4 — Settlement sketches + zoom LOD ✅
- Per-size **SVG sketches** (`assets/settlement/*.svg`) + simple markers
  (`js/ui/settlement-art.js`: `SETTLEMENT_ART`, `SETTLEMENT_MARK` ★◆●•·). Sketch when zoomed in,
  marker when smaller. Tests: `settlement-art`.

### 3.5 — Unified LOD + zoomed-out POI dot ✅
- One detail threshold (`DETAIL_PX`, currently **26**): terrain + settlement sketches
  appear/disappear together. Zoomed out → **no terrain icon**, settlement marker **centered**, and
  a **red dot** (white outline) at the bottom of any hex with a POI. `drawDetailMarkers` /
  `drawSimplifiedMarkers` in `map.js`.
