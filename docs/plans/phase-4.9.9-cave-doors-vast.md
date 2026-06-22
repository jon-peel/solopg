# Sub-plan 4.9.9 — Cave doors + rare "Vast" size

A dungeon follow-up to [Phase 4.9](phase-4.9-dungeon-connectivity.md). Two small, data-driven tweaks.
(Back-compat ignored; `DUNGEON_BUILD` self-heals.)

## A. Theme-aware doors (caves)
A Cave complex is natural rock: mostly **open** passages, few crafted **doors**, the odd **stuck**
(a cave-in/rockfall) and **secret** (a hidden fissure). So caves get a different door-weight profile.
- `js/gen/dungeon-layout.js`: wrap the existing weights as `DOOR_STYLES.built` and add
  `DOOR_STYLES.natural` (open-heavy, door-light). `layoutLevel(rooms, rng, { …, doorStyle })`
  selects; default `built` keeps every other theme (and the existing tests) unchanged.
- `js/gen/dungeon.js`: pass `doorStyle: theme === "Cave complex" ? "natural" : "built"`.
- The `stuck` type already reads as a cave-in narratively (no new type needed).

## B. "Vast" size (5–6 levels), rare on random
- `data/dungeon-size.json`: add `Vast` — `levels [5,6]`, `rooms [12,16]`, low roll-weight (**0.5**, so
  ≈5% on a random roll vs the others), blurb "A mega-dungeon — a campaign in itself". The Add-dungeon
  menu lists it (so it's always pickable). All stair/shaft/pin/lighting logic already scales to 6
  levels.

`DUNGEON_BUILD` 12 → 13.

## Files
- `js/gen/dungeon-layout.js` (door styles), `js/gen/dungeon.js` (doorStyle + build bump),
  `data/dungeon-size.json` (Vast), `test/dungeon.test.js`, `test/dungeon-layout.test.js`.

## Verification
- **Automated:** `node --test` — cave dungeons have a markedly lower door-marker rate than a built
  theme; `layoutLevel` honours `doorStyle`; Vast level/room counts stay in range (table-driven);
  existing suites green.
- **Manual checklist — "4.9.9 — Cave doors + Vast size" (`./run-local.sh`):**
```
[ ] Add dungeon ▾ lists "Vast — 5–6 lvl, 12–16 rooms"; pick it → a 5–6 level mega-dungeon
[ ] Random dungeons are almost never Vast (≈5%)
[ ] A Cave complex dungeon has mostly open passages — far fewer door markers than, say, a Ruin
[ ] Caves still show the occasional door / cave-in (stuck) / secret
[ ] Reload → identical
```
