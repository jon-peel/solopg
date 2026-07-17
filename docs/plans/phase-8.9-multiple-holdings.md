# Phase 8.9 — Multiple holdings ("Claim for faction")

> **⚠️ UI amended in 8.15.** The holdings model here is unchanged, but the **"Claim for faction"
> button was replaced** by a single-owner **"Run by"** picker on the hex Detail tab (shows the current
> holder; reassigns or clears with "None" on change). See
> [phase-8.15-faction-expansion.md](phase-8.15-faction-expansion.md).

Third Arc B step — see [`phase-8-factions.md`](phase-8-factions.md). Delivers the **"reuse one
faction across the map"** requirement: a bandit gang with three camps, a cult with a shrine *and* a
hidden lair. A **"Claim for faction"** action attaches any placed hex (with its POI, if one is there)
to an existing faction's `holdings[]`; the Factions panel lists every holding with click-to-jump, and
the map already draws them all (8.7's marker pass loops every holding).

**Status:** ✅ done.

> Plan → approve → build → `node --test` → commit/push → manual checklist (project convention).

## No schema bump

Just appends to an existing faction's `holdings[]` (already part of the v16-carried faction object).
**`SCHEMA_VERSION` stays 16**, no migration.

## `addHolding` (new, pure)

```js
// js/gen/factions.js
export function addHolding(faction, holding) {
  if (!Array.isArray(faction.holdings)) faction.holdings = [];
  const dup = faction.holdings.some((h) => h.q === holding.q && h.r === holding.r);
  if (dup) return false;                       // a faction can't hold the same hex twice
  const h = { q: holding.q, r: holding.r };
  if (holding.poiId) h.poiId = holding.poiId;
  faction.holdings.push(h);
  return true;                                 // added
}
```

Dedupe is by **(q, r)** — the same hex can't be claimed twice *by the same faction*. Two different
factions contesting one hex is allowed (a deliberate non-restriction — a contested site is legitimate
world state; 8.10+ can make something of it). Returns whether it added, so the handler can report
"already holds it" instead of silently no-op'ing.

## Trigger — "Claim for faction" on the Detail tab

Mirror 8.7's "Generate faction here" (same panel-action home, ring is full). In the Detail tab's
action area, when the world has **≥1 faction** and a **placed hex** is selected, show a compact picker:
a `<select>` of the existing factions (by name) + a **"Claim for faction"** button (the same
`<select>` + button idiom the Travel tab already uses for encumbrance). Claiming records a holding of
`{ q, r, poiId? }` — the selected hex plus its primary POI id if one is placed there (same
`hex.pois[0].id` rule `onGenerateFaction` uses). If the faction already holds that hex, log
"already holds (q, r)" and do nothing.

## Factions panel — list every holding, click-to-jump

Today a card shows a single "Jump to holding" (the first). Extend it: when a faction has **>1**
holding, render one jump link per holding (e.g. "Holding 1 · (q, r)", "Holding 2 · (q, r)"), each
centring the map on that hex — the "click-to-jump like hooks' Target/Origin" the parent plan calls
for. `onCenterFaction(id, index=0)` gains an optional holding index (the 8.8 POI "Faction:" link keeps
calling it with no index → holding 0, unchanged). The summary line ("N holdings · strength M") from
`factionDescription` stays as the at-a-glance count.

## Files

| File | Change |
|---|---|
| `js/gen/factions.js` | `addHolding(faction, holding)` — pure, dedupes by (q,r), preserves `poiId` |
| `js/ui/panel.js` | `renderSelectionPanel`: a faction `<select>` + "Claim for faction" button (≥1 faction, placed hex); `factionCard`: per-holding jump links when >1 holding |
| `js/ui/app.js` | `onClaimHolding(factionId)` — `addHolding` on the selected hex, persist, jump to Factions tab; `onCenterFaction(id, index)` gains the index; thread `factions` + `onClaimHolding` into the selection model |
| `test/factions.test.js` | `addHolding` tests (see below) |

## Tests (`node --test`, pure logic only)

- `addHolding` appends a new `{q,r}` and returns `true`; the faction now lists both holdings.
- **Dedupe**: claiming the same `(q,r)` again returns `false` and leaves `holdings` unchanged.
- `poiId` is preserved when supplied and omitted when not.
- A different `(q,r)` with the *same* `poiId` value still adds (dedupe is by coords, not poiId).
- Two factions are independent (claiming for one doesn't touch the other).

## Manual checklist (`./run-local.sh`)

```
[ ] Generate or promote a faction (so one exists)
[ ] Select a different placed hex → "Claim for faction" + a faction picker appear
[ ] Pick the faction, Claim → its card now lists 2 holdings; a 2nd marker (same colour) shows
[ ] Each holding has its own jump link that centres the map on it
[ ] Claim the same hex again → no duplicate (logged "already holds"); still 2 holdings
[ ] Reload → both holdings persist (schema v16); Export→Import identical
```

## Out of scope (later Arc B)
- **Faction turns** (goal progress / disposition / strength / holdings changing over time) — 8.10.
- **Moving / losing** a holding, contested-hex resolution — beyond 8.9 (8.13 stretch / future).
- A **radial-menu** slot for Claim — deferred (panel action for now).
