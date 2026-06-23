# Sub-plan 4.9.12 — Expanded monster roster (tiered) + more dens

A dungeon follow-up to [Phase 4.9](phase-4.9-dungeon-connectivity.md). Bigger, OSE-basic-flavoured
monster families (open content — no IP names), each member **tiered** (1 weak → 4 deadly) to power
the depth/difficulty scaling in 4.9.13. Plus new "den" themes so creature-lairs aren't always Goblin
warrens. (Back-compat ignored; `DUNGEON_BUILD` self-heals.)

## Data
- **`data/monster-families.json`:** each existing family grown to ~7–9 members, every member gets a
  `tier` (1–4); add two families: **Reptiles** (cave geckos, lizard men, troglodytes, giant
  lizards/snakes; elite Basilisk) and **Giants** (ogres, minotaurs, trolls, ettins, hill giants;
  elite Cyclops). Names from the OSE free basic list (no IP).
- **New den themes** (each maps to a distinct family, so dens span all creature types): **Kobold
  tunnels** (Goblinoids), **Spider nest** (Vermin), **Ghoul warren** (Undead), **Troglodyte caves**
  (Reptiles), **Ogre lair** (Giants). Added to `data/dungeon-theme.json` (generic weights),
  `data/dungeon-family.json` (theme→family), `DUNGEON_THEME_BIAS` (terrain bias, spreading them so
  Goblin warren stops dominating), and `THEME_GLYPHS` (`js/ui/poi-style.js`).
- Map Reptiles/Giants into a few existing themes too (Cave complex → Reptiles; Ruined fort / Goblin
  warren → a little Giants).
- Bump `DUNGEON_BUILD` 14 → 15.

The `tier` field is unused until 4.9.13 (scaling) — added now so the data is ready.

## Tests
New `test/dungeon-data.test.js` (parity): every `dungeon-theme.json` theme has a `THEME_GLYPHS`
entry and a `dungeon-family.json` mapping; every family member has a numeric `tier` 1–4; every family
has a string elite; every family referenced by a theme exists.

## Verification
- **Automated:** `node --test` — parity holds; existing family-cohesion / theme-lean suites green.
- **Manual checklist — "4.9.12 — Roster + dens" (`./run-local.sh`):**
```
[ ] Generate dungeons on varied terrain → creature-dens now include Kobold tunnels / Spider nest /
    Ghoul warren / Troglodyte caves / Ogre lair, not just Goblin warren
[ ] New den themes show distinct map glyphs
[ ] Open them → wandering tables show the wider roster (gnolls, troglodytes, ogres, mummies, etc.)
[ ] Reload → identical
```
