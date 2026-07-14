# Phase 8.16 — More faction types (lair-bound lords, a dragon, rebellions, monster diversity)

A **content + light-rules** follow-on to the Phase 8 faction engine (see
[phase-8-factions.md](phase-8-factions.md) and [phase-8.15-faction-expansion.md](phase-8.15-faction-expansion.md)).
The engine (uncapped, contested, subtext-only turns) is unchanged; this adds new *kinds* of power and
a little variety. No new movement behaviour — every new type reuses **spreading** or **roaming**.

## What ships

1. **Lair-bound lords** — `necromancer`, `lich`, `vampire`, `dragon`, `hag`. Each: **seated at a
   site**, **spreading** (the lair — holding #0 — never moves; a spreader only *adds* surrounding
   hexes, so the lair stays put while its influence creeps outward), **boss-tier strength**, hostile.
   They **never roll in the random "Generate faction here"** — they arise **only by Promote**, and the
   Promote action offers the lord(s) whose **site** matches (POI type + terrain). Eligibility (POI
   types are dungeon/shrine/camp/landmark/tower — there is no "ruin" type):
   - **necromancer** ← occupied **tower**
   - **lich** ← occupied **dungeon**
   - **vampire** ← occupied **dungeon or shrine** (a crypt / desecrated chapel)
   - **dragon** ← occupied **dungeon** on **Mountains/Hills** terrain; **singular** (one per world)
   - **hag** ← any occupied POI on **Swamp** terrain
   A given site may offer more than one (e.g. a mountain dungeon → Lich / Vampire / Dragon); the GM
   picks. Beholder is **not** a lord — it went to the dungeon roster (below), as its menace is met in
   the depths, not spread across the map.
2. **Rebellion** — a **rare** rollable archetype (low weight in the table), **spreading**, hostile;
   name flavour covers both a *peasant rising* and a *breakaway house*.
3. **Monster-tribe diversity** — a rolled **kind** inside the existing `monstrous tribe` archetype,
   woven into the name and the faction card: *"The Gnolls of the Waste"* · *"Monstrous tribe (gnolls)"*.
   Kinds: `goblins, orcs, gnolls, hobgoblins, kobolds, ogres, lizardfolk, beastmen, ratfolk`.
4. **Dungeon roster (folded in)** — extend `data/monster-families.json` with the classic "big"
   monsters as high-tier members, in **`OSE name (D&D name)`** form where OSE renames them (e.g.
   `Eye of Terror (Beholder)`; `Medusa` unchanged). Verified per-monster against the OSE SRD.

## Data & schema

- **No schema bump** (stays **v16**). The only new stored field is `faction.kind` (monster kind),
  additive and optional — it self-heals on older saves via the existing `FACTION_BUILD` stamp, like
  every other additive faction field.
- Bosses (necromancer/lich/dragon) are **not** added to `data/faction-archetype.json` — they're never
  randomly rolled; Promote supplies their archetype directly. Only **rebellion** goes in that table.

## Chunk A — data, mobility, strength, naming (pure, in `js/gen/`)

- `data/faction-archetype.json`: add **`rebellion`** at a **low weight** (rare). (Bosses omitted — see
  above.)
- `js/gen/factions.js`:
  - `ARCHETYPE_MOBILITY`: add `necromancer`, `lich`, `vampire`, `dragon`, `hag`, `rebellion` → all
    `"spreading"`.
  - **Strength tiers** — a new `ARCHETYPE_STRENGTH` override (min/max), falling back to the current
    `2..4` for unlisted archetypes: `necromancer 3..4`, `lich 4..5`, `vampire 4..5`, `dragon 5..6`,
    `hag 3..4`, `rebellion 2..4`. Read it in `generateFaction` in place of the flat `inRange(STRENGTH_*)`.
  - **Monster kind:** when `archetype === "monstrous tribe"`, roll a `kind` from a new
    `data/faction-monster-kind.json` and store it on the faction. Surface it in `factionDescription`
    (`Monstrous tribe · gnolls`).
- `js/gen/faction-name.js`: name branches —
  - `dragon` → a **named wyrm** (e.g. `"Varethyx, the Ashen Wyrm"` from a name-parts list) — singular,
    so it reads as an individual, not an order.
  - `necromancer`/`lich` → arcane order/binding names (the existing "The ‹Adj› ‹Body›" set already
    reads well; add a few undead-leaning words).
  - `rebellion` → *"The Free Banners"*, *"the ‹Place› Uprising"*, or *"House ‹X› in Revolt"* (covers
    peasant-rising and breakaway-house).
  - `monstrous tribe` with a `kind` → fold the kind into the wild name (*"The Gnolls of the Waste"*).

## Chunk B — Promote-seeding by site + boss rules (in `js/gen/factions.js` + `js/ui/app.js` + `panel.js`)

- `js/gen/factions.js` (pure): a data-driven `LORD_SITES` map + `eligibleLords(poiType, terrain,
  factions)` → the lord archetypes whose site matches, minus a singular lord that already exists
  (dragon). `promoteFaction` takes an explicit `ctx.archetype` (the chosen lord) → seeds that archetype
  + `hostile` disposition + its strength tier (bypasses the occupier-label seed).
- `js/ui/app.js`: `onPromotePoi(poiId, archetype?)` — with an archetype it raises that lord; without,
  the normal label-seeded promote. Compute `lordOptionsFor(poi)` (uses the selected hex terrain +
  `getFactions`) and pass it into the selection-panel model.
- `js/ui/panel.js`: alongside "Promote to faction", render one **"‹Raise a Lich› / ‹Awaken a Dragon›…"**
  button per eligible lord.
- **Dragon uniqueness:** `eligibleLords` drops `dragon` once an active one exists, so the button
  disappears; the core also refuses a second.

## Chunk C — surfacing (in `js/ui/panel.js` / `factionDescription`)

- Faction card shows the monster kind and reads the boss archetypes cleanly (`Necromancer · hostile`,
  `Dragon · hostile`, `Monstrous tribe (gnolls) · wary`).
- No map change — bosses draw as ordinary coloured-ring territory (the 8.15 convention).

## Chunk D — dungeon roster (in `data/monster-families.json`)

- Add the classic "big" monsters as high-tier members of the right families, in `OSE (D&D)` form
  where OSE renames them: Aberrations → `Eye of Terror (Beholder)`, a mind-flayer-alike; Undead →
  a death-knight-alike (alongside the existing Vampire elite); Reptiles → `Medusa`, a yuan-ti-alike.
  Names verified against the OSE SRD; where OSE has no open equivalent, keep the plain name and flag it.
- Additive weighted members only — elites and the family structure are unchanged (no generator/test
  churn).

## Tests

- `ARCHETYPE_MOBILITY` maps every new archetype to spreading; a boss stays seated (holding #0 unchanged)
  while gaining holdings over turns.
- Strength tiers land in range per archetype (dragon > lich > necromancer ≥ rebellion baseline).
- Monster-kind roll is deterministic for a seed and appears in the name + description.
- Promote seeds necromancer from a tower, lich/dragon from a dungeon; **a second dragon is refused**.
- `rebellion` is rollable but rare (present in the table at low weight); name flavour renders.
- `node --test` stays green.

## Manual verification (`./run-local.sh`, browser)

```
[ ] Place/occupy a TOWER → Promote → "Necromancer" seats there; advance turns → its influence spreads,
    the tower (holding #0) never moves.
[ ] Occupy a DUNGEON → Promote → offered "Lich" (and "Dragon" if none exists yet); pick each.
[ ] A second dragon can't be created (option gone / refused) — singular.
[ ] Generate factions a while → a rebellion shows up occasionally (rare), spreading + hostile.
[ ] Monstrous tribes now read with a kind ("The Gnolls of the Waste" / card "· gnolls"); kinds vary.
[ ] Reload + Export→Import unaffected (still v16; faction.kind round-trips).
```

## Decisions locked

1. Necromancer/lich/dragon = **spreading** (static lair + growing influence), **boss strength**,
   **Promote-only** on their site; **not** in the random roll.
2. **Dragon is singular** (one per world).
3. **Rebellion** = a **rare rollable archetype** (emergent "uprising vs a dominant faction" is a
   deliberate *later* option, not this phase).
4. **Monster diversity** = a rolled `kind` field on `monstrous tribe`, name + card flavour.

## Out of scope (deliberate)

- **Emergent rebellion** (auto-spawns against an oppressive faction) — a real trigger mechanic; a
  fast-follow if wanted.
- **Boss doom-clock payoff** (what happens when a lich/necromancer's clock completes) — its own beat.
- **New behaviours** (naval, non-territorial blight) — would need a new engine seam.
