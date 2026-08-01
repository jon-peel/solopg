# Phase 15 — Monasteries (a religious settlement variant)

**Status:** ✅ **Complete** — implemented in Steps 1–9 on branch
`claude/phase-15-breakdown-muv6e9` (commits `fc278c2`…`8fb0124`). Delivered: the monastery
settlement variant (rare, terrain-biased, mutually exclusive with `keep`), culture-aware name +
dedication (reusing `RACE_DEITIES`), size→self-sufficiency + race-leaned industries, a library +
Phase-9 **research** odds-ladder oracle, **relics**, **catacombs** (a lazily-built "Catacombs"
dungeon reusing the interior generator), and the rare **GM/discovery-only secret** (never in the
player panel — a test-enforced `publicMonasteryFields` sanitizer). Plus the optional bonus: a
rollable **"Ruined abbey"** wilderness dungeon theme + a new **Fallen Order** monster family.
Additive throughout — no back-compat, no migration. +65 tests (619 → 684, 0 fail).

**Owner's decision (authoritative):** A monastery is a **settlement variant**, like the
existing martial `keep` overlay — not a mere POI. **Even small ones exist.** Every
monastery **does something**: it produces goods (candles, beeswax, beer, wine, cheese,
cloth, manuscripts, trade goods…), and the **number of industries scales with size**.
A **large** monastery is **100% self-sufficient** — it grows its own food, weaves its
own cloth, makes its own tools and items. A **small** one depends on
**traders / merchants / donations** for staples and focuses on one signature craft.

## 1. Why (rationale)
The current POI/settlement set is mostly *threats and ruins* (dungeons, camps, lairs,
bandit-held sites). A monastery is a distinct settlement type the map otherwise lacks — a
**productive, self-sufficient religious house** with its own goods, a library, sometimes a
famed relic or catacombs, and (rarely) a dark secret. It **synergises with the
culture/deity system** built in Phase 14 (an order honours a race-appropriate god). Keep
it **rare** and **distinct** from shrines (small, empty markers) and keeps (martial) so it
adds flavour, not noise.

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
**Most monasteries are exactly what they seem — a wholesome, welcoming house. That is the
norm and must stay so.** **Very rarely** (a few percent), a house is welcoming on the
surface but **hides a secret**: a heresy, a thing sealed in the catacombs, a corrupt
abbot, a false order wearing monks' robes over something else. The darkness is **not
visible from outside** — the surface always reads as safe. Because it is rare and
concealed, the occasional betrayal lands hard while the wholesome house stays the norm. A
secret, where present, usually lives in the **catacombs** (§2.6). NOTE: this is the
*living-but-tainted* house; the fully **ruined/abandoned** abbey is a separate thing — a
dungeon theme (§5 bonus).

### 2.8 Library & research (a knowledge service)
Every house has a **library**, its size scaling with the monastery's size (a hermitage:
a few shelves; a great mother-house: a renowned library). Library size drives a
**research roll** — an Oracle-style *trigger-and-prompt* aid in the spirit of Phase 9:
**the app decides the tier of result, the GM supplies the actual book/answer** (it does
NOT invent titles, just as it never invents gp/loot). When a PC researches a topic, roll
against library size for one of:
- **the exact source** — the precise book/answer,
- **a closely related source** — a partial or adjacent answer,
- **something on the topic** — a hint / general lore,
- **nothing useful**.
Bigger libraries shift the odds toward "exact"; small ones toward "topical / nothing".
Surface it as a "Research" action on the monastery (panel or Oracle tab), gated by
library size. This is a roll + prompt, not a content table of book titles.

### 2.9 Relics
A house — especially a large or old one — may be **known for a relic** it keeps: the
incorrupt remains of a saint, a holy weapon or text, a wonder-working icon, a sealed
reliquary. This is a **headline feature** (panel: "Keeps: <relic>"), a treasure or
pilgrimage draw — and it can be **the very thing a secret house guards** (§2.7):
sometimes the "relic" is what should have stayed sealed. Chance + fame scale with
size/age. Needs a `monastery-relic` table (typed/named relics).

## 3. Data shape (pre-V1 — additive, no migration)
- `settlement.kind = "monastery"` (existing field, new value).
- `settlement.monastery = { dedication, selfSufficient: boolean, industries: string[],
  library: string, provisioning?: string, trait?: string, catacombs?: boolean,
  relic?: string, secret?: string }` — baked deterministically at generation / in the
  settlement stamp pass (recommended, so it's stable and the panel just reads it), the
  same way the keep's martial name is derived and settlement culture is stamped.
- `library` — a size tier (e.g. "a few shelves" … "a renowned library"), derived from the
  monastery's size; drives the research roll (§2.8).
- `relic` — the notable relic the house keeps (§2.9), when present; may coincide with the
  `secret` (the guarded thing).
- `catacombs` — present on big/old houses (§2.6); the interior itself is a lazily-built
  `dungeon` (attached to the settlement or a linked catacomb POI), NOT stored inline.
- `secret` — **present only on the rare secret house (§2.7)**, and the player-facing
  panel must **NOT** render it. It is GM/discovery-only: surfaced when the catacombs are
  explored, or behind a GM "reveal secret" control. The surface panel always reads as a
  safe, wholesome house.

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
6. `monastery-relic` — the notable relics a house may keep (§2.9), ~24: "the incorrupt
   body of the founder", "a saint's hand in a gilded reliquary", "a wonder-working icon",
   "a holy blade", "a fragment of the first temple", "a codex no living tongue can read".
7. Library **research odds** by library size (§2.8) — NOT a content table; an odds ladder
   (exact / related / topical / nothing) per library tier, authored oracle-style in
   `js/gen/oracle.js`. Library tier itself derives from monastery size.
8. Dedication — **REUSE** `RACE_DEITIES` + `data/shrine-dedication.json` (no new table).
9. Catacombs — **REUSE** the dungeon interior generator (§2.6); a "Catacombs" theme entry
   may be added to `DUNGEON_THEME_BIAS` / the dungeon family tables.
10. Optional `RACE_MONASTERY_PRODUCTS` bias map (per-race product leanings).

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
  provisioning, library, "Keeps: <relic>" if any, and "has catacombs" if any) in the
  selected-settlement section (near the existing keep/water meta), plus a **"Research"**
  action gated by library size (§2.8). **Do NOT render `settlement.monastery.secret`** —
  it is GM/discovery-only (§2.7); the panel must read as a wholesome, welcoming house.
- **Research roll:** `js/gen/oracle.js` — an odds-ladder roll (exact / related / topical /
  nothing) by library size (§2.8), in the Phase-9 trigger-and-prompt style.
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
5. **Library + research** — derive a `library` tier from size; a "Research" odds-ladder
   roll (exact / related / topical / nothing) in `oracle.js`. Tests: bigger library skews
   toward "exact"; determinism.
6. **Relics** — a `relic` on big/old houses from `monastery-relic`; shown as "Keeps: …".
   Tests: rarity by size, may coincide with a secret.
7. **Catacombs** — attach a lazily-built "Catacombs" dungeon to big/old houses (reuse
   `js/gen/dungeon.js`); chance/depth scale with size. Tests: determinism, size scaling.
8. **The secret house** — a rare `secret` flag + `monastery-secret` table; surfaced only
   via catacomb discovery / a GM reveal, never the player panel. Tests: rarity bound,
   secret never leaks into the public panel model.
9. *(Optional)* fully-ruined-monastery dungeon theme.

## 7. Open questions for the next agent
- **Placement:** v1 = overlay on a placed settlement (simplest, reuses machinery) vs.
  v2 = independent rare placement in remote/wild hexes even where no normal settlement
  would spawn (truer to isolated abbeys, more work). **Recommend v1 first.**
- Exact industries-count-by-size and the self-sufficient threshold (Town vs City).
- Distinct map glyph now, or reuse the settlement marker with a small tag?
- Size rules: leave monasteries on the normal per-terrain size caps (a monastery can be
  any size), rather than the demihuman size-cap lift. **Recommend: normal size rules.**
- **Catacombs** — an "age" notion (older houses likelier to have them), or derive the
  chance from size alone? Attach the interior to the settlement, or spawn a linked
  catacomb POI on the hex?
- **Secret** — how is it surfaced to the GM without leaking to players? (Revealed by
  exploring the catacombs, a GM-only "reveal" control, or an export-only field?) Pick one
  and keep the public panel/model clean of it.
- **Library** — is the tier purely size-derived, or its own roll with a size bias? Does
  the "Research" action live in the settlement panel, the Oracle tab, or both? Tune the
  per-tier odds ladder against play.
- **Relic ↔ secret** — how often does a secret house's `secret` *be* its `relic` (the
  guarded thing)? Set a linkage probability; otherwise they're independent.

## 8. Non-negotiables
- Deterministic (dedicated sub-streams), frozen once generated.
- Reuse the culture/deity system (`settlement.race` → `RACE_DEITIES`) — do NOT add a
  parallel deity list.
- **Rarer than keeps** — must not turn every town into an abbey.
- Most monasteries are exactly what they seem; the secret/tainted house (§2.7) is **rare**,
  and its `secret` is **never shown in the player-facing panel** (GM/discovery-only).
- Human = null culture still works (Human orders use the standard dedication table).
- Every dev step runs the full `node --test` suite (no degradation) and adds tests for
  new pure logic.
