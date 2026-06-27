# Phase 5 — Other POI types detailed

Gives the remaining POI types their own generated detail, the way Phase 4 gave dungeons theirs.
Today only `dungeon` opens into something; `shrine`, `camp`, `landmark`, `tower` are just a name +
generic occupant + one flavour line (`js/gen/poi.js` `flavorFor`). Two tiers:

- **Tier 1 — text-only detail (no map):** `shrine`, `camp`, `landmark`. One shared, terrain-aware
  **composable-description engine** — independent axes multiplied together, skinned by terrain.
- **Tier 2 — mapped interior:** `tower` — a **generalised structure interior** that reuses the
  dungeon machinery (level stack, vertical-stair pinning, occupied frontier, boss room, lighting)
  with the vertical axis pointing **up**.

**Lair — retired (5.1):** the standalone `lair` POI type was redundant with the dungeon den themes
(`Beast den`, `Goblin warren`, `Ogre lair`, `Kobold tunnels`, …), so it was removed from the Add-POI
list and from auto-generation (its terrain weight folded into `dungeon`). A creature lair now arises
as a dungeon den. The `lair` **occupant** kind still exists (a creature lairing inside a dungeon), and
old saves' lair POIs still render (legacy 🐾 glyph).

## Sub-steps (build order)
| Step | Scope | Status |
|---|---|---|
| **5.1** | Tier-1 description engine + **shrine** (proves the engine) | ✅ done |
| **5.2** | **camp** (same engine, scale-driven; reaction + numbers) | ✅ done |
| **5.3** | **landmark** (lightest config — pure description) | ✅ done |
| **5.4** | **tower** — mapped interior reusing the dungeon machinery | ✅ done |

Tier-1 first: cheap, high coverage, low risk. Tower last: the only piece that touches the interior
generator/renderer.

---

## The Tier-1 engine (shared by 5.1–5.3)

A small **pure** `describeFeature(tables, rng, { type, terrain })` helper (new, e.g.
`js/gen/feature-detail.js`): rolls a type's **axes** from JSON tables, applies a **terrain bias**, and
returns the **structured picks** (an object of axis → value). It does **not** return a finished string
— prose is composed at render time (see Storage). Pure → node-testable, seeded via the POI's existing
sub-RNG.

**Terrain awareness** reuses the established pattern: `DUNGEON_THEME_BIAS` in
`js/gen/terrain-profile.js` already biases a roll table per terrain. Add sibling biases
(`SHRINE_FORM_BIAS`, `CAMP_*`, …) so e.g. Mountains lean to a cliff-carving shrine, Swamp to a
sunken idol. Same mechanism, new consts.

### Storage & back-compat (decided)
- **Store the structured axis picks** on `poi.detail` (not the composed sentence); **compose prose at
  render** in `panel.js`. Matches the "render-time derived, not stored" rule used for art, and keeps
  the data clean for later editing (Phase 8).
- **No world-schema bump.** Stamp a `detailBuild` constant on generated detail and **self-heal on
  panel open** when missing/stale — exactly how dungeons self-heal via `DUNGEON_BUILD`. New POIs get
  detail at creation (`generatePoi`); pre-existing saved shrines/camps/landmarks backfill the first
  time they're opened. The rich detail **supersedes** the generic `flavorFor` line for these types.

---

## 5.1 — Shrine

Above-ground only; no map. Near-endless combinations from independent axes:

- **Form** — statue, altar, carved relief/face, standing stone, cairn, idol, obelisk, holy
  spring/well, tree-shrine, wayside marker, **colossal cliff-carving**.
- **Dedication** — a power/domain (war, harvest, death, sea, sun, the wild, a trickster…), a
  hero/knight, an ancestor, a local spirit, the unnamed/forgotten.
- **Condition** — freshly tended, maintained, weathered, **overgrown** (only a face through the
  vines), toppled, defaced/desecrated, half-buried.
- **Telling detail** — a guttering pilgrim's candle, coins/bones/flowers, scratched prayers, a dried
  garland, an empty offering bowl.
- **Terrain skin** (material + setting, via bias) — Mountains→cliff-carving/cairn; Forest→moss-furred
  tree-shrine; Desert→wind-scoured, sand-buried; Swamp→slimed idol on a hummock; Plains→roadside
  standing stone; Hills→barrow-shrine.

**Optional watcher (light):** only when `condition` warrants (desecrated→undead/cultist;
tended→a guardian/pilgrim). A single `creatures`-table roll, no encounter machinery. Off by default.

Example composed line:
> *"A weathered altar to a forgotten sea-god, half-buried in dune sand — a dried garland still on it."*

**Data:** `shrine-form.json`, `shrine-dedication.json`, `shrine-condition.json`, `shrine-detail.json`
(canonical schema). **Code:** new biases in `terrain-profile.js`; `describeFeature` config for shrine.
**Register** every new table in `HEX_TABLE_IDS` (`js/ui/app.js`) + the test loader.

## 5.2 — Camp

Same engine; the spine is **scale × state**:

- **Scale** (drives the rest) — cold fire-pit remnant → small party → war-band → semi-permanent
  (palisade/ditch).
- **State** — abandoned & cold, recently struck, currently occupied.
- **Who** — reuse the existing `occupiers` table.
- **Signs/defenses** scale with size — lean-tos → picket line, drying racks, a gibbet → palisade.
- **Terrain skin** — cave-mouth camp (Hills), raft-camp (Swamp), oasis camp (Desert).

**Encounter lives here, not at shrines:** when `scale` is large **and** `state` is occupied, roll a
**reaction** + **number appearing** (reuse the `NA_BY_TIER` dice-notation idea — e.g. `4d10 bandits`).

**Data:** `camp-scale.json`, `camp-state.json`, `camp-signs.json` (+ reuse `occupiers`).

## 5.3 — Landmark

Lightest config: pure description, no occupant, no encounter. Axes: **feature** (lone tree, monolith,
waterfall, battlefield bones, crater, arch, petrified beast…), **quality/notable trait**, optional
**secret/hook** seed (a nod toward Phases 6/7). Terrain-skinned like the others.

**Data:** `landmark-feature.json` (+ a small trait/hook table).

---

## 5.4 — Tower (generalised structure interior)

Reuse, don't fork. The dungeon arc already built nearly everything: a level stack, **true vertical
stair pinning** (`js/gen/dungeon.js` pins stair-up rooms above their down partner — towers lean on
this hard), the **occupied-frontier** logic, the **deepest-level boss**, lighting, treasure. Towers
are three deltas on top of that, framed as turning "dungeon interior" into a **structure interior**
with an **orientation** + a **floor profile**:

1. **Orientation = up.** Keep the level stack, but a tower's floors go up from the ground (and
   classically a basement/crypt *below* — wizard's-tower-over-a-cellar). Panel/`dungeon-map` label
   and ▲/▼ stair direction follow orientation; the `isDeepest` boss rule maps to the **topmost**
   floor (the wizard / warlord / the thing in the eyrie).
2. **Floor profile = narrow.** Dungeon floors are sprawling multi-room graphs with loops; a tower
   floor is **1–few rooms, single stair up**. A `floorProfile` parameter on `layoutLevel`
   (`js/gen/dungeon-layout.js`) — not new layout code.
3. **Tower-like content top-down** — guards/entrance at the base, quarters mid, master + treasure +
   flying things up top.

Because tower is occupied by default (`poi-types` lean `occupied`), the occupied-frontier machinery
fits naturally — a tower is "occupied top-to-bottom" rather than abandoned.

**Consistency note (carry into generation):** `Cult shrine` and `Wizard's sanctum` are already
**dungeon themes**. Stance: the **POI** is the surface thing (a roadside shrine, a standing tower);
the **dungeon theme** is when it's deep/explorable enough to map. Same fiction, two scales — so
shrine-POI vs `Cult shrine`-dungeon and tower-POI vs `Wizard's sanctum`-dungeon are intentional, not
redundant.

**Decided (built):** the vertical axis is an `orientation:"up"` flag on the shared `levels[]` (option
a). A tower is a focused `generateTower` (`js/gen/tower.js`) that produces the **same interior shape**
the Dungeon View already renders and reuses `layoutLevel` + vertical-stair pinning; only the ▲/▼ stair
direction and the up/down stair labels flip on orientation (`js/ui/app.js` `levelMarks`/
`roomConnections`), and the panel reads "Floor" instead of "Level". Index 0 = ground (the entrance);
higher index = higher floor; the master waits on top. A held tower is lit throughout and garrisoned by
the POI's occupant; an empty tower is dark. A **below-ground cellar is deferred** (towers go up from
the ground in v1).

---

## Generation & wiring (all steps)
- **`js/gen/poi.js`** — for shrine/camp/landmark, attach structured detail (eager for new POIs).
  Tower attaches a build-stamp + builds its interior lazily on open, mirroring dungeon.
- **`js/gen/terrain-profile.js`** — new per-terrain bias consts (shrine form/material, camp type).
- **`js/ui/panel.js`** — compose + render the prose for Tier-1 types; tower drills into the existing
  Dungeon View (orientation-aware labels).
- **`js/ui/app.js`** — register all new tables in `HEX_TABLE_IDS`; tower reuses the lazy-build hook.

## Tests
- **`test/poi.test.js`** (+ a new `test/feature-detail.test.js`): `describeFeature` returns the
  expected axes for each type; values come from the loaded tables; **terrain bias** shifts
  distributions (e.g. Mountains → cliff-carving shrine appears); same seed → identical picks
  (determinism); camp large+occupied yields a reaction + numbers.
- **`test/dungeon.test.js`** / layout: tower orientation = up, floors are narrow (≤ profile cap),
  boss on the topmost floor, vertical pinning still aligns. `node --test` stays green throughout.

## Verification (manual, per step, via `./run-local.sh`)
```
5.1 [ ] Place/open shrines across terrains → each reads as a distinct composed line
    [ ] Mountains skews to cliff-carvings, Swamp to sunken idols (terrain-aware)
    [ ] Reload + export→import → identical detail (deterministic, schema current)
5.2 [ ] Camps span cold fire-pit → big occupied stockade; big+occupied shows reaction + "Nd10 …"
5.3 [ ] Landmarks read as pure description (no occupant/encounter)
5.4 [ ] A tower opens into stacked floors going UP; boss on the top floor; stairs labelled ▲/▼ right
    [ ] Reload → tower interior persists/self-heals; old saves still open
```

## Open decisions (to confirm before building)
1. **Shrine watcher** — optional light watcher when condition warrants (lean: yes), or none.
2. **Storage** — store structured picks + compose on render (lean: yes), or store finished string.
3. **Tower vertical model** — ✅ `orientation:"up"` flag on the shared `levels[]` (cellar deferred).
4. **Retire flat `lair` POI type?** — ✅ done in 5.1 (folded into dungeon den themes).
