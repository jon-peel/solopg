# Phase 8.14 — Region "something is stirring" hooks

Completes the original 8.13 **"roaming / region"** stretch (movement shipped as 8.13; this is the
region half). Where 8.11/8.12 hooks are **one faction → its lair**, a region hook is the opposite: a
**broad, un-pinned escalation signal** for a whole named tract — *"the Blackwood is stirring"* — that
rises out of **cumulative** faction pressure in an area rather than one camp's deeds.

It's the "zoom out" beat: 8.12 tells the party *a faction did a thing*; 8.14 tells them *a whole region
is tipping over*. Rarer, bigger, atmospheric — the GM reads it as "escalation is brewing here," not
"go kill X at Y."

**Status:** 📝 planned.

> Plan → approve → build → `node --test` → commit/push → manual checklist.

## What it hangs on — real regions (3R.8)

`computeRegions(seed, terrainByKey, {minSize})` (js/gen/regions.js) already derives **named terrain
tracts** — `{ id:"region:<anchor>", name:"the Blackwood", terrain, size, cq, cr (centroid), keys[] }` —
the same ones the map engraves. The app has `buildTerrainByKey(current)`. So a region hook attaches to
an **existing** named region: no new geography, and the name/centroid come for free. Regions are
**derived, not stored** → **no schema bump** (the hook itself is a normal `world.hooks[]` entry). v16.

## Trigger — "regional heat" (escalation, not proximity)

Kept deliberately different from 8.12's proximity×strength so it doesn't just duplicate it. Heat is
**escalation pressure** among the active factions **seated in a region**:

```js
const REGION_CONTEST_BONUS = 2;  // each EXTRA faction sharing a region adds tension
const REGION_STIR_BASE = 0.012;  // per heat-point per day — rarer than a faction hook
const REGION_STIR_MAX  = 0.12;

// Each faction contributes strength weighted by how far its doom-clock has run
// (a faction close to its goal makes the whole region feel wrong); multiple powers
// in one tract add contest tension. Pure.
export function regionHeat(factionsInRegion) {
  let heat = 0;
  for (const f of factionsInRegion) {
    const g = f.goal || {};
    const frac = g.max ? Math.min((g.progress || 0) / g.max, 1) : 0;
    heat += (f.strength || 1) * (0.5 + frac);        // 0.5×..1.5× strength
  }
  return heat + REGION_CONTEST_BONUS * Math.max(0, factionsInRegion.length - 1);
}
export const regionStirChance = (fs) => Math.min(REGION_STIR_BASE * regionHeat(fs), REGION_STIR_MAX);

// At most ONE stir per advance per region (a beat, not a stream). Pure/deterministic.
export function rollRegionStir(factionsInRegion, days, rng) {
  const chance = regionStirChance(factionsInRegion);
  if (chance <= 0 || !(days >= 1)) return false;
  for (let i = 0; i < days; i++) if (rng() < chance) return true;
  return false;
}
```

Feel (tunable): a lone strength-3 faction with a **half-run** clock → heat 3 → ~3.6%/day (an occasional
portent). **Two** strength-3 factions contesting a tract, clocks half → heat ~8 → capped ~10%/day (the
region is clearly heating up). A faction whose clock is **nearly full** contributes 1.5× — the omen
intensifies as its doom nears (ties straight into 8.10's goal clock).

**Dedupe + rarity:** a region can hold **one open region hook at a time** — if it already has an open
`pattern:"region"` hook for that `region.id`, skip. So the signal escalates once and waits for the GM
to resolve/ignore it rather than spamming.

## The hook shape (a new kind, in `hooks.js`)

A region hook has **no lair and no travel leg** — it's about the area:

```js
// buildRegionHook(tables, rng, { region:{id,name,cq,cr}, index?, sourcePower? })
{
  pattern: "region", verb: "region",
  subject: { name: region.name, type: "region" },
  region: { id, name, cq, cr },
  origin: centroid, target: centroid,   // centroid = {round(cq), round(cr)} → jump/centre works
  bearing: null, distance: 0,
  claim: roll("region-omen"),           // "war-drums echo from every direction after dark"
  status: "open",
  ...(sourcePower ? { sourcePower } : {}),   // the dominant faction (cross-links via 8.11's tag)
}
```

Prose (`hookName`/`hookDescription` gain a `region` branch, kept engine-pure):
- **name:** `Stirring: the Blackwood`
- **line:** `Something stirs in the Blackwood: war-drums echo from every direction after dark.`
- optional 2nd line naming the powers at work (from `sourcePower`/count) — decide in build.

New table **`data/region-omen.json`** (~12 broad, place-agnostic portents): *"refugees stream out of the
interior", "no caravan has come through in a fortnight", "shrines are found defaced, their keepers
fled", "the militia has stopped patrolling the far tracks"…*

## Wiring (`app.js`, in the day-tick)

In `autoFireFactionHooks` (already the per-day faction-hook pass), after the per-faction loop:
1. `const regions = computeRegions(current.seed, buildTerrainByKey(current), { minSize: 16 });`
2. Bucket active factions by the region their **seat** (`holdings[0]`) falls in (region `keys` → Set).
3. For each region with ≥1 faction: skip if it already has an open region hook (dedupe); else
   `rollRegionStir(factions, days, subRng(seed,"regionstir",region.id,dayStart))`; on a hit,
   `buildRegionHook` (dominant = highest-strength faction as `sourcePower`), push, log *"The Blackwood
   is stirring — …"*. Caller persists once (same seam as 8.12).

Determinism/session-clock: same trade as 8.12 (seeded on the session day; fired hooks are persisted).

## Build chunks (test after each)

| Chunk | Change | How you test it |
|---|---|---|
| **A — core** | `region-omen.json`; `regionHeat`/`regionStirChance`/`rollRegionStir` (factions.js); `buildRegionHook` + `region` prose branch (hooks.js). Node tests. | `node --test` |
| **B — wire** | Region bucketing + dedupe + fire in `autoFireFactionHooks`; quiet log. | Browser: cluster strong/advancing factions in one tract, Progress many days → occasionally a **"Stirring: the ‹region›"** hook appears (one at a time); a quiet lone region stays silent |
| **C — map (optional)** | Shade the region's hexes when its hook is selected (reuse `region.keys`). | Browser: selecting a region hook tints the tract |

## Tests (`node --test`, pure)
- `regionHeat`: rises with faction count, strength, and goal progress; 0 for an empty region.
- `regionStirChance` never exceeds `REGION_STIR_MAX`; `rollRegionStir` is deterministic, false when
  chance is 0 / days < 1, true when every day would hit.
- `buildRegionHook`: `pattern:"region"`, target = rounded centroid, a `region-omen` claim, no lair.
- `hookName`/`hookDescription` render the region branch; a region hook survives export/import.

## Manual checklist (`./run-local.sh`)
```
[ ] Put 2 factions (or one strong, advanced-clock faction) in the same terrain tract; Progress ~30 days
    → a "Stirring: the ‹region›" hook appears on the Hooks tab (no button), pointing at the region
[ ] Only ONE stirring hook per region at a time (resolve/ignore it before another can appear)
[ ] A single weak faction's tract rarely/never stirs (escalation, not mere presence)
[ ] The hook's jump link centres on the region; reload keeps it (v16)
```

## Decisions to confirm
1. **Escalation-driven heat** (goal-progress + multiplicity + strength), *not* party-proximity — so it
   reads as regional tipping-over, distinct from 8.12. (Recommended.)
2. **One open region hook per region** at a time (dedupe). (Recommended.)
3. **Tag the dominant faction** as `sourcePower` so the card cross-links to it, even though the prose is
   regional — vs leaving it untagged/anonymous. (Leaning: tag the dominant one.)
4. **Map treatment:** centroid-jump now, region **shading** as optional Chunk C later. (Recommended.)

## Out of scope (unchanged from 8.13)
- Wandering off the revealed map; contraction / contested-hex *resolution* (region hooks *signal* the
  contest; they don't resolve it).
