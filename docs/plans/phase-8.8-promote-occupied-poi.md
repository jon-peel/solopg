# Phase 8.8 — Promote an occupied POI into a faction

Second Arc B step — see [`phase-8-factions.md`](phase-8-factions.md). Turns an existing occupier
label (`poi.occupant = { kind:"occupied", by:"Bandits" }`) into a full faction object, so a threat
the GM already has on the map becomes a real power **without reading as a brand-new one**. Builds
directly on 8.7's `generateFaction` + Factions tab + holding markers.

**Status:** 📋 planning — awaiting approval.

> Plan → approve → build → `node --test` → commit/push → manual checklist (project convention).

## No schema bump

Promotion adds one **additive** field to an existing occupant — `occupant.factionId` — which self-heals
(absent = "not promoted", the same additive-field convention hooks/features use). Everything else is a
normal faction created by 8.7's generator. So **`SCHEMA_VERSION` stays 16**, no migration step.

## The occupier → faction seed (a JS rule, not a table)

The eight occupier labels live in `data/occupiers.json` (flavour). Mapping a label to a faction
**archetype** (and a coherent starting **disposition**) is a *rule*, so it's a JS const in
`factions.js` per the rules-as-JS-consts convention — not a new table:

```js
const OCCUPIER_SEED = {
  "Bandits":    { archetype: "bandits",           disposition: "hostile" },
  "Cutthroats": { archetype: "bandits",           disposition: "hostile" },
  "Smugglers":  { archetype: "thieves' guild",    disposition: "wary"    },
  "Cultists":   { archetype: "cult",              disposition: "hostile" },
  "Pilgrims":   { archetype: "cult",              disposition: "neutral" },
  "Deserters":  { archetype: "mercenary company", disposition: "wary"    },
  "A hermit":   { archetype: "hermit order",      disposition: "neutral" },
  "Refugees":   {                                 disposition: "friendly" }, // no clean archetype → rolled
};
```

A mapped label pins the archetype so the promoted faction **reads as the same threat** (Bandits stay
bandit-like, Cultists a cult). An unmapped/partly-mapped label (Refugees) leaves `archetype`
undefined so `generateFaction` rolls it, but still seeds a sensible disposition. Goal / strength /
name are generated normally (name flavoured by the resolved archetype), so a promoted Bandits camp
becomes e.g. *"The Ashen Fang"* — an evocative gang name, not "House Blackwood".

## `promoteFaction` (new, pure — a thin wrapper over `generateFaction`)

```js
// js/gen/factions.js
export function promoteFaction(tables, rng, ctx) {
  // ctx: { q, r, poiId, index, seed, occupant:{ by } }
  const seed = OCCUPIER_SEED[ctx.occupant?.by] || {};
  return generateFaction(tables, rng, {
    q: ctx.q, r: ctx.r, poiId: ctx.poiId, index: ctx.index, seed: ctx.seed,
    archetype: seed.archetype,       // undefined → generateFaction rolls it
    disposition: seed.disposition,   // undefined → generateFaction rolls it
    origin: { fromPOI: { q: ctx.q, r: ctx.r, poiId: ctx.poiId } },
  });
}
```

`generateFaction` already honours supplied `archetype`/`disposition`/`origin` (built + tested that
seam in 8.7), so this stays a tiny, well-covered wrapper.

## Trigger — a panel action on the occupied POI's drill-in

Mirror 8.7's panel-button approach (the radial ring is full). In `renderPoiSection`'s **drill-in box**
(where "Occupant: Held: Bandits" already shows), add a **"Promote to faction"** button, shown only when:
- `selectedPoi.occupant?.kind === "occupied"`, **and**
- `!selectedPoi.occupant.factionId` (not already promoted).

Once promoted, the button is replaced by a **"Faction: <name>"** line with a *Jump to faction* link
(centres the map / opens the Factions tab) — so the POI and its faction stay visibly linked and the
POI can't be double-promoted. The parent plan's "radial *or* panel" is resolved to **panel**, same as
8.7; a radial slot can come later.

## Files

| File | Change |
|---|---|
| `js/gen/factions.js` | `OCCUPIER_SEED` const + `promoteFaction(tables, rng, ctx)` |
| `js/ui/panel.js` | `renderPoiSection`: "Promote to faction" button (occupied + unpromoted) / "Faction: <name>" link once promoted; thread `onPromotePoi` + `onCenterFaction` + a `factionNameById` lookup through the selection model |
| `js/ui/app.js` | `onPromotePoi(poiId)` — resolve the POI on the selected hex, `subRng(seed,"faction",q,r,n)`, `promoteFaction`, `addFaction`, tag `poi.occupant.factionId = faction.id`, jump to Factions tab, persist; pass the promote/lookup callbacks into the selection model |
| `test/factions.test.js` | `promoteFaction` tests (see below) |

## Tests (`node --test`, pure logic only)

- `promoteFaction` maps a known label → archetype ("Bandits" → `bandits`, "Smugglers" →
  `thieves' guild`) and seeds its disposition.
- It sets `origin.fromPOI` to the source POI and puts the single holding on that POI (with `poiId`).
- An **unmapped** label ("Refugees") falls back to a *rolled* archetype (still one of the table's
  values) while keeping its seeded disposition — i.e. promotion never throws on an unmapped occupier.
- Determinism: same `(seed, q, r, n, label)` → identical promoted faction.
- The promoted faction is otherwise well-formed (same assertions as `generateFaction`: `build`,
  `goal`, `clock`, `status`, one holding).

## Manual checklist (`./run-local.sh`)

```
[ ] Find/generate a POI with an occupier (e.g. a camp "Held: Bandits"); drill into it
[ ] "Promote to faction" appears; click it → a faction appears in the Factions tab
[ ] The faction's archetype matches the occupier (Bandits → bandits), name reads in-type
[ ] The POI drill-in now shows "Faction: <name>" (no second Promote button — no double-promote)
[ ] A holding marker sits on that POI's hex; "Jump to faction" / the card centre the map on it
[ ] Reload → the faction + the POI↔faction link persist (schema v16); Export→Import identical
```

## Out of scope (later Arc B)
- **Claim / multiple holdings** on one faction — 8.9 (this step gives a promoted faction its one
  origin holding).
- **Faction turns** — 8.10.
- A **radial-menu** slot for Promote — deferred (panel action for now, like Generate faction).
