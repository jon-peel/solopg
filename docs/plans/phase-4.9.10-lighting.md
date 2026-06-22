# Sub-plan 4.9.10 — Lighting (Tier A): dark by default, rarer with depth

A dungeon follow-up to [Phase 4.9](phase-4.9-dungeon-connectivity.md). Dungeons are pitch black by
default; a small, **distance-and-depth-decaying** chance a room is lit, with an evocative source — so
a lone candle on level 4 is a genuine mystery. (Back-compat ignored; `DUNGEON_BUILD` self-heals.)

## Model
For each room compute its **distance from the nearest surface entrance** through the real dungeon
graph (intra-level room edges = cost 1; a staircase/shaft = cost 4 so going deeper costs more). Then:
```
p(lit) = clamp( BASE * DECAY^distance , MIN, BASE )   // BASE 0.25, DECAY 0.75, MIN ~0.0004
```
≈ 25% at an entrance room, ~8–10% a few rooms into L1, ~1/1000 by level 4, ~1/4000 deeper. Never
zero ("not impossible"). Depth is captured by the staircase cost, so the two factors are one metric.

## Generation (`js/gen/dungeon.js`)
- New **post-pass** `assignLighting(levels, stairs, entrances, lightTable, rng)` AFTER the structure
  exists: Dijkstra from all entrance rooms over `layout.edges` (incl. secret) + `stairs`; set
  `room.light = rng() < p ? { source: <roll dungeon-light> } : null`. Deterministic (fixed order).
- New data table **`dungeon-light.json`** — evocative source lines (candle, embers, torches, lantern,
  cave fungus, faint magical glow; some carry the built-in mystery hook). Added to `HEX_TABLE_IDS`
  + the test loader.
- Bump `DUNGEON_BUILD` 11 → 12.

## UI
- **Map** (`js/ui/dungeon-map.js`): a lit room gets a subtle **warm tint** overlay (so dark is the
  default look). 
- **Panel** (`js/ui/panel.js`): a clicked room shows a **`Lit: <source>`** line when lit; dark rooms
  show nothing (darkness implied). Legend gets a "warm tint = lit" note.

## Files
- New `data/dungeon-light.json`; `js/gen/dungeon.js` (post-pass + build bump),
  `js/ui/app.js` (table id), `js/ui/dungeon-map.js` (tint), `js/ui/panel.js` (line),
  `index.html` (legend), `test/dungeon.test.js`.

## Verification
- **Automated:** `node --test` — `room.light` is null or `{source}` from the table; lit-rate on
  level 0 is much higher than the deepest level, and the deepest level's lit-rate is low (<3%);
  determinism preserved.
- **Manual checklist — "4.9.10 — Lighting (Tier A)" (`./run-local.sh`):**
```
[ ] Most rooms are dark (no tint); near an entrance a few rooms are warm-tinted (lit)
[ ] Click a lit room → "Lit: <source>" line; dark rooms show no light line
[ ] Deeper levels are almost entirely dark; a lit room down deep is a rare, eyebrow-raising find
[ ] Reload → identical lighting (deterministic)
```
