# Phase 15 — Monasteries (a religious settlement variant)

**Status:** planned — spec for the next agent. Not yet implemented.

**Owner's decision (authoritative):** A monastery is a **settlement variant**, like the
existing martial `keep` overlay — not a mere POI. **Even small ones exist.** Every
monastery **does something**: it produces goods (candles, beeswax, beer, wine, cheese,
cloth, manuscripts, trade goods…), and the **number of industries scales with size**.
A **large** monastery is **100% self-sufficient** — it grows its own food, weaves its
own cloth, makes its own tools and items. A **small** one depends on
**traders / merchants / donations** for staples and focuses on one signature craft.

## 1. Why (rationale)
The current POI/settlement set is mostly *threats and ruins* (dungeons, camps, lairs,
bandit-held sites). A monastery is a rare **welcome node** in hostile country —
sanctuary, a signature export, a patron/quest-giver — which the map otherwise lacks.
It is also a natural **hook engine** (relics, lore, a besieged order, a corrupted house)
and it **synergises with the culture/deity system** built in Phase 14 (an order honours a
race-appropriate god). Keep it **rare** and **distinct** from shrines (small, empty
markers) and keeps (martial) and it adds flavour, not noise.

## 2. The model

### 2.1 It's a settlement `kind`
- Set `settlement.kind = "monastery"` — parallel to `"keep"` (see the v14 note in
  `js/world/world.js`; `keep` is rolled today in `js/gen/hex.js` via
  `profile.settlement.keepChance`). **Mutually exclusive** with `keep`: a hex has at
  most one kind. A *fortified* abbey is a monastery with a `fortified` trait (§2.4), NOT
  `kind:"keep"`.
- Rolled on its **own deterministic sub-stream** (`subRng(seed,"monastery",q,r,gen)`),
  **rarer** than a keep, via a new per-terrain `profile.settlement.monasteryChance`
  (`js/gen/terrain-profile.js`). Favour remote/wild terrain (Mountains / Hills / Forest /
  Desert higher; Plains lower — abbeys sit apart from the world). Roll it AFTER the keep
  roll and skip if a keep already fired (document the order).

### 2.2 Size → self-sufficiency + industries
Derived from the settlement's existing size tier:

| Size | Reads as | Self-sufficiency | Industries (goods made) |
|---|---|---|---|
| Hamlet | hermitage / cell | **dependent** (donations/traders) | 1 signature craft |
| Village | priory | mostly dependent | 1–2 |
| Town | abbey | largely self-sufficient (own food) | 2–3 + staples |
| City | great abbey / mother-house | **100% self-sufficient** (food, cloth, tools) | 3–4 + staples + a famed export |

- **Dependent** houses carry a `provisioning` note — how they get by ("sustained by
  pilgrim donations", "supplied by the nearest market town", "trades its wine for grain").
- **Self-sufficient** houses list staple facilities (farm, mill, weavery, smithy) plus
  their trade exports.

### 2.3 The order (identity)
- **Dedication** — REUSE the culture/deity system: the order honours a god from
  `RACE_DEITIES[settlement.race]` (Phase 14; `settlement.race` is already stamped by
  `syncCultures`), or `data/shrine-dedication.json` when Human. So a dwarven house reads
  "to the Forge-Father", an elven one "to the Moon-Mother".
- **Name** — "<epithet/saint> Abbey / Priory / Cloister / Hermitage / Friary /
  Charterhouse / Grange", culture-flavoured via `settlement.race`.

### 2.4 Trait (optional flavour)
One of: fortified, reclusive/silent, decaying, renowned, militant (warrior-monks),
plague-touched, pilgrim-thronged. Purely descriptive; `fortified` covers the
fortress-abbey without needing `keep`.

### 2.5 Products / trade goods (the core new content)
A weighted list of monastic outputs — candles, beeswax, honey, mead, ale/beer, wine,
brandy/spirits, cheese, preserves, wool, woven cloth, dyes, illuminated manuscripts,
copied books, inks, herbs & medicines, relics/reliquaries, carved icons, iron tools,
stonework, fine woodwork, tinker-goods. Consider **per-race leanings** (dwarf →
tools/stonework/strong ale; elf → wine/woodwork/manuscripts; halfling →
cheese/beer/preserves; gnome → candles/inks/clockwork trinkets) via a small bias map,
mirroring `RACE_DUNGEON_THEMES`.

### 2.6 Catacombs (big / old houses)
Large, long-established houses may have **catacombs** beneath them — an explorable
underground that **reuses the existing dungeon interior system** (`js/gen/dungeon.js`,
lazily built on first open, like every other dungeon), themed "Catacombs". They hold the
order's interred dead, an ossuary, sealed crypts, old relics and forgotten stores — and,
for the rare secret house (§2.7), whatever it truly guards. **Chance + depth scale with
size** (a hermitage rarely has more than a single crypt; a great mother-house can hide
several levels). Model as an optional `dungeon`-type interior hung off the settlement (or
a linked catacomb POI on the same hex) — do **not** write a new interior generator.

### 2.7 The welcoming face (rare, hidden)
**By default a monastery is a genuine refuge — the design should actively encourage
players to shelter there** (rest, healing, sanctuary). That welcome is the whole point;
do not undercut it. **Very rarely** (a few percent), a house is welcoming on the surface
but **hides a secret**: a heresy, a thing sealed in the catacombs, a corrupt abbot, a
false order wearing monks' robes over something else. The darkness is **not visible from
outside** — the surface always reads as safe. Because it is rare and concealed, the
occasional betrayal lands hard while refuge stays the norm. A secret, where present,
usually lives in the **catacombs** (§2.6). NOTE: this is the *living-but-tainted* house;
the fully **ruined/abandoned** abbey is a separate thing — a dungeon theme (§5 bonus).

## 3. Data shape (pre-V1 — additive, no migration)
- `settlement.kind = "monastery"` (existing field, new value).
- `settlement.monastery = { dedication, selfSufficient: boolean, industries: string[],
  provisioning?: string, trait?: string, catacombs?: boolean, secret?: string }` — baked
  deterministically at generation / in the settlement stamp pass (recommended, so it's
  stable and the panel just reads it), the same way the keep's martial name is derived
  and settlement culture is stamped.
- `catacombs` — present on big/old houses (§2.6); the interior itself is a lazily-built
  `dungeon` (attached to the settlement or a linked catacomb POI), NOT stored inline.
- `secret` — **present only on the rare secret house (§2.7)**, and the player-facing
  panel must **NOT** render it. It is GM/discovery-only: surfaced when the catacombs are
  explored, or behind a GM "reveal secret" control. The surface panel always reads as a
  safe refuge.

## 4. New tables (author at "nice large" size, culture-aware where noted)
1. `monastery-product` — the goods list (§2.5), ~40+. **CORE.**
2. `monastery-name` elements — house-types (Abbey/Priory/Cloister/Hermitage/…) + saint /
   virtue / colour epithets. (Or extend `settlement-name.js` with a monastic mode.)
3. `monastery-trait` — §2.4, ~12.
4. `monastery-provisioning` — how dependent houses get by, ~15.
5. `monastery-secret` — the rare hidden truths (§2.7), ~20: "the abbot is not what he
   seems", "a thing lies sealed in the deepest crypt", "the order worships an older,
   darker power", "the wine is pressed from more than grapes", "the brothers feed what
   breeds in the catacombs", "the whole house is a lure for travellers". GM/discovery-only.
6. Dedication — **REUSE** `RACE_DEITIES` + `data/shrine-dedication.json` (no new table).
7. Catacombs — **REUSE** the dungeon interior generator (§2.6); a "Catacombs" theme entry
   may be added to `DUNGEON_THEME_BIAS` / the dungeon family tables.
8. Optional `RACE_MONASTERY_PRODUCTS` bias map (per-race product leanings).

Follow the Phase-14 content-expansion approach (parallel research agents → curate →
codegen) to fill these to size.

## 5. Integration points (where to plug in)
- **Generation:** `js/gen/hex.js` — beside the `settlement.kind="keep"` roll; add the
  monastery roll. `js/gen/terrain-profile.js` — add `monasteryChance` per profile.
- **Detail:** a `describeMonastery(...)` (mirror `describeShrine` in
  `js/gen/feature-detail.js`) or a stamp step (mirror `stampSettlements` in
  `js/gen/culture.js`) that fills `settlement.monastery` from size + `settlement.race`.
- **Naming:** `js/gen/settlement-name.js` — a monastic name mode, like the existing
  `opts.kind === "keep"` martial branch, culture-aware via `opts.race`.
- **Rendering:** `js/ui/map.js` — a distinct glyph (chapel/steeple) vs the keep's ♜;
  `js/ui/panel.js` — a monastery block (dedication, self-sufficiency, industries/exports,
  provisioning, and "has catacombs" if any) in the selected-settlement section (near the
  existing keep/water meta). **Do NOT render `settlement.monastery.secret`** here — it is
  GM/discovery-only (§2.7); the panel must read as a welcoming refuge.
- **Catacombs:** reuse the dungeon interior system (§2.6) — a lazily-built `dungeon`
  attached to the settlement (or a linked catacomb POI opened like any dungeon).
- **Culture:** reuse `RACE_DEITIES` / `settlement.race` — a monastery in a demihuman
  culture reads as that people's order automatically.
- **Bonus (separate track):** a "Ruined abbey / Cloister vaults" dungeon theme in
  `DUNGEON_THEME_BIAS` (`terrain-profile.js`) + a monster family, for the fully
  *ruined/abandoned* monastery — distinct from the living-but-secret house (§2.7).

## 6. Build steps (suggested)
1. **Data + tables** (§4) at full size; per-race product bias. Tests: sizes, uniqueness.
2. **Generation** — `monasteryChance` + kind roll in `hex.js` (dedicated sub-stream,
   mutually exclusive with keep); bake `settlement.monastery` (dedication / self-
   sufficiency / industries / provisioning) from size + race. Tests: determinism,
   size→self-sufficiency mapping, keep/monastery mutual exclusion, rarity bounds.
3. **Naming** — monastic name mode, culture-aware. Tests: Human default unchanged.
4. **Rendering + panel** (never showing `secret`). Screenshot-verify.
5. **Catacombs** — attach a lazily-built "Catacombs" dungeon to big/old houses (reuse
   `js/gen/dungeon.js`); chance/depth scale with size. Tests: determinism, size scaling.
6. **The secret house** — a rare `secret` flag + `monastery-secret` table; surfaced only
   via catacomb discovery / a GM reveal, never the player panel. Tests: rarity bound,
   secret never leaks into the public panel model.
7. *(Optional)* fully-ruined-monastery dungeon theme.

## 7. Open questions for the next agent
- **Placement:** v1 = overlay on a placed settlement (simplest, reuses machinery) vs.
  v2 = independent rare placement in remote/wild hexes even where no normal settlement
  would spawn (truer to isolated abbeys, more work). **Recommend v1 first.**
- Exact industries-count-by-size and the self-sufficient threshold (Town vs City).
- Distinct map glyph now, or reuse the settlement marker with a small tag?
- Do monasteries offer **services** (sanctuary / healing / lore) as adventure hooks in
  v1, or defer?
- Size rules: leave monasteries on the normal per-terrain size caps (a monastery can be
  any size), rather than the demihuman size-cap lift. **Recommend: normal size rules.**
- **Catacombs** — an "age" notion (older houses likelier to have them), or derive the
  chance from size alone? Attach the interior to the settlement, or spawn a linked
  catacomb POI on the hex?
- **Secret** — how is it surfaced to the GM without leaking to players? (Revealed by
  exploring the catacombs, a GM-only "reveal" control, or an export-only field?) Pick one
  and keep the public panel/model clean of it.

## 8. Non-negotiables
- Deterministic (dedicated sub-streams), frozen once generated.
- Reuse the culture/deity system (`settlement.race` → `RACE_DEITIES`) — do NOT add a
  parallel deity list.
- **Rarer than keeps** — must not turn every town into an abbey.
- **Refuge by default** — most monasteries are genuine safe havens; the design should
  encourage players to shelter there. The secret/tainted house (§2.7) is **rare** and its
  `secret` is **never shown in the player-facing panel** (GM/discovery-only).
- Human = null culture still works (Human orders use the standard dedication table).
- Every dev step runs the full `node --test` suite (no degradation) and adds tests for
  new pure logic.
