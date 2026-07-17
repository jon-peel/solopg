# Phase 8.18 — A lair-bound lord infuses its interior

> **✅ Built (as-built).** A retro-doc for the faction follow-on that makes a lord's dungeon/tower
> read as *its own*. Builds on 8.16 (lair-bound lords) + 8.17 (a POI's occupant follows its faction).

## What ships

When a **lair-bound lord** (lich / necromancer / vampire / dragon / hag) holds a dungeon or tower, the
interior is **re-themed to the lord** on next open:

- Every level's monster **family** becomes the lord's own (undead for a lich/necromancer/vampire,
  reptiles for a dragon, aberrations for a hag) — the theme's usual family/signature is overridden.
- The **lord itself waits as the final boss** on the deepest level (dungeon) or the master's chamber
  (tower).
- The entrance **garrison stays as holdouts** (the occupied-frontier cluster), so the way in still
  reads as manned.
- The interior is **stamped with the lord** (`overlordId`) and **re-forms when the site changes hands**
  (a takeover, a hand-off, or the lord gone) — which resets that interior's exploration, by design.

(8.19 later generalised this to *non-lord* factions as a lighter **garrison** — see phase-8.19.)

## Where it lives

- `js/gen/dungeon.js` / `js/gen/tower.js`: `generateDungeon`/`generateTower` take a `ctx.overlord`
  spec `{ family, boss, id }`; `buildLevelMonsters` swaps the family + boss; the interior stamps
  `overlordId`. `DUNGEON_BUILD` / `TOWER_BUILD` bumped so old interiors self-heal.
- `js/ui/app.js`: `LORD_INTERIOR` (archetype → `{ family, boss }`), `overlordFor(poi)` (resolve the
  lord holding a POI), `interiorNeedsBuild` (re-form on a holder change), `onSelectPoi` passes the
  overlord into the generators.

No world-schema change; still v16.

## Manual verification (`./run-local.sh`, browser)

```
[x] Raise a LICH in a dungeon → open it → its halls are undead and the Lich is the deepest boss.
[x] Raise a NECROMANCER in a tower → open it → undead throughout, the necromancer is the master on top.
[x] Awaken a DRAGON in a mountain dungeon → reptilian interior with a Dragon boss.
[x] Take a lord's site with another faction (or delete the lord) → re-open → the interior re-forms.
[x] Reload + Export→Import: the interior (and overlordId) round-trips; identical for a seed.
```
