# Phase 8.16 — More faction types (lair-bound lords, a dragon, rebellions, monster diversity)

A **content + light-rules** follow-on to the Phase 8 faction engine (see
[phase-8-factions.md](phase-8-factions.md) and [phase-8.15-faction-expansion.md](phase-8.15-faction-expansion.md)).
The engine (uncapped, contested, subtext-only turns) is unchanged; this adds new *kinds* of power and
a little variety. No new movement behaviour — every new type reuses **spreading** or **roaming**.

## What ships

1. **Lair-bound lords** — `necromancer`, `lich`, `dragon`. Each: **seated at a site**, **spreading**
   (the lair — holding #0 — never moves; a spreader only *adds* surrounding hexes, so the lair stays
   put while its influence creeps outward), **boss-tier strength**, hostile. They **never roll in the
   random "Generate faction here"** — they arise **only by Promote** on the matching site:
   - **necromancer** ← promote an occupied **tower**
   - **lich** ← promote an occupied **dungeon**
   - **dragon** ← promote an occupied **dungeon or a mountain/hills lair**; **singular** (at most one
     per world). Where a site could be either, Promote offers a pick (lich / dragon).
2. **Rebellion** — a **rare** rollable archetype (low weight in the table), **spreading**, hostile;
   name flavour covers both a *peasant rising* and a *breakaway house*.
3. **Monster-tribe diversity** — a rolled **kind** inside the existing `monstrous tribe` archetype,
   woven into the name and the faction card: *"The Gnolls of the Waste"* · *"Monstrous tribe · gnolls"*.
   Kinds: `goblins, orcs, gnolls, hobgoblins, kobolds, ogres, lizardfolk, beastmen, ratfolk`.

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
  - `ARCHETYPE_MOBILITY`: add `necromancer`, `lich`, `dragon`, `rebellion` → all `"spreading"`.
  - **Strength tiers** — a new `ARCHETYPE_STRENGTH` override (min/max), falling back to the current
    `2..4` for unlisted archetypes: `necromancer 3..4`, `lich 4..5`, `dragon 5..6`, `rebellion 2..4`.
    Read it in `generateFaction` in place of the flat `inRange(STRENGTH_*)`.
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

## Chunk B — Promote-seeding by site + boss rules (in `js/gen/factions.js` + `js/ui/app.js`)

- Extend the Promote path so the boss archetype is chosen by the **site**, not the occupier label:
  tower → necromancer; dungeon → lich (or dragon); mountain/hills lair → dragon. Seed
  archetype + a hostile disposition + the boss strength tier.
- **Dragon uniqueness:** if the world already has an active `dragon`, the Promote UI does not offer
  "dragon" again (and the core refuses it) — singular.
- The Promote action surfaces the valid boss choice(s) for the selected site; a plain occupied POI
  still promotes to a normal faction as today.

## Chunk C — surfacing (in `js/ui/panel.js` / `factionDescription`)

- Faction card shows the monster kind and reads the boss archetypes cleanly (`Necromancer · hostile`,
  `Dragon · hostile`, `Monstrous tribe · gnolls`).
- No map change — bosses draw as ordinary coloured-ring territory (the 8.15 convention).

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
