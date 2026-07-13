# Phase 8.11 — Faction-emitted hooks (points the party AT the faction)

> **⚠️ Superseded — this feature was removed.** 8.11's faction-emitted hooks (the "Stir up
> trouble" button, `factionHookContext`, the `faction-deed` table) shipped and were later **removed**
> in the 8.15 arc: factions are now played as **subtext** (the map's coloured territory + the per-turn
> log), not hooks. The `sourcePower` hook field survives (still used by the region "something is
> stirring" hook, 8.14). See [phase-8.15-faction-expansion.md](phase-8.15-faction-expansion.md) and
> PLAN.md for the as-built. This doc is kept as the historical plan.

Closes the seam Phase 6 left open (Type-2 "a power stirs up trouble" hooks *"wait on a future
faction feature"*). Arc B built the faction, so 8.11 wires it up — but with a sharper idea of **what a
faction hook is** than the first draft had.

## What a faction hook IS (design)

A generic Type-1 hook is a rumour pointing at a place. **If a faction hook were just that, we'd use
the plain generator** — so a faction hook has to be something the plain generator *cannot* produce:

> **It names the faction, describes something the faction did, and points the party AT the faction.**

The distinguishing property is **causality**, not location. Distance is welcome — it gives the party
somewhere to travel — *as long as the destination is the faction's lair*, with an in-world reason the
party heard about it. That reason is **"word reached the nearest town."**

### The 8.11 shape — predation → the lair (a `threat`)

The party, **in the nearest settlement**, catches word that the faction has been **preying on the
region** (raiding roads, carrying folk off, demanding tribute). The hook points at the **faction's
lair** — go deal with them. This is the "bandits rob/kidnap a notable, word spreads down" case, and it
reuses the hook engine's existing **`threat`** verb *exactly*:

- **menace** = the faction (named),
- **lair** = the faction's holding (the place to go),
- **origin** = the nearest settlement (where the party hears it) → a real travel leg,
- **reward** = the engine already rolls a bounty for a `threat` (a patron will pay).

Reads like: *"Smoke on the frontier: The Red Company have been carrying folk off. Their lair: the
Ruined Tower, 18 miles to the south-east (Hills). Reward: 400 gp from the Reeve."* — vague on purpose
(who was taken, the ransom = GM's call), but unmistakably **this faction**, and it sends the party
**to** them.

### Deferred siblings (their own steps — noted so this one stays tight)
- **Encroachment / takeover** — a faction moves *into* an existing site and chases out the occupants,
  so a return visit is disrupted. This is the richest kind but it should **mutate a real POI's
  occupant** on the map, which couples to 8.13's movement — a step of its own.
- **Goal omen** — the doom clock advances and a symptom leaks out. A small later add.
- **8.12 — news by distance.** 8.11 is the *manual* button (the GM says "this faction acts now"). 8.12
  makes the *hearing* automatic on the day-tick, scaled by **proximity × strength** — that's where
  distance-from-the-party belongs, and where `strength` (frozen in 8.13) is finally read.

**Status:** ✅ done. Rebuilt around "points at the lair" (was: a generic biased hook — dropped because
it read as an unrelated far site), then a variety pass (deed table + per-stir seed) after play showed
repeat stirs reading the same, and the "Stirred up by ‹faction›" tag (Chunk C). **Next in Arc C:
8.12** (auto-fire on the day-tick, reads `strength`).

> Plan → approve → build → `node --test` → commit/push → manual checklist (project convention).

## No schema bump

`sourcePower` is an **additive, optional** hook field (self-heals: an old hook lacks it, shows no tag).
Export/import already round-trips the whole `world.hooks[]` (`portability.js` carries `data.hooks`), so
the tag rides for free. **`SCHEMA_VERSION` stays 16.**

## The `sourcePower` field

```js
hook.sourcePower = faction.id   // e.g. "faction:2"  (absent on all normal hooks)
```

Stored on the hook, resolved to a name **at render time** (compose-at-render rule). Otherwise the hook
is an ordinary `threat` hook — same list, same Resolve/Ignore/Pin lifecycle.

## Flavour & variety (a faction hook must not read the same twice)

A faction hook is always a `threat` — the only verb whose engine prose names the menace (→ the
faction) and carries a `lair` (→ the holding to travel to). But "always threat, same lair" reads
identical every stir (the first cut did — five stirs looked like one), so the **varying** parts have to
carry it:

- **The deed** — a rolled **`data/faction-deed.json`** entry (vivid, victim-bearing: *"have carried
  off a merchant's heir for ransom"*, *"seized a noble's envoy…"*), passed as **`ctx.claim`** (a tiny
  additive engine hook: `claim = ctx.claim || roll`). Replaces the generic 7-entry `hook-threat` so
  consecutive stirs differ.
- **The opening** — the `source` alternates (`RUMOUR_CHANCE`) between the faction's **goal rumour**
  (`GOAL_RUMOUR`, ties the opening to its aim) and a **rolled witness** (*"A nervous merchant"*), so
  stirs don't all start alike.
- **The seed** — each stir draws from a **per-stir stream** keyed on the faction + how many hooks it
  has already stirred (`subRng(seed,"stir",id,ordinal)`), so repeats never collide, and it's
  reload-safe (derived from the persisted hooks list).

```js
const GOAL_RUMOUR = { /* goal -> "word on the wind" that reaches town */ };
const RUMOUR_CHANCE = 0.5;

// Pure given tables + a per-stir rng; roll order fixed (deed, then the source flip).
export function factionHookContext(faction, rng, tables) {
  const claim = rollTable(tables.get("faction-deed"), rng).value;
  const rumour = (faction && faction.goal && GOAL_RUMOUR[faction.goal.kind]) || null;
  const source = rumour && rng() < RUMOUR_CHANCE
    ? rumour
    : rollTable(tables.get("hook-source"), rng).value;
  return { verb: "threat", claim, source };
}
```

## Wiring (`app.js`)

`onGenerateHook(opts)` already grew `origin`/`verb`/`source`/`sourcePower` (Chunk 2). Add **one** more:
`opts.subjects` — override the candidate subjects (`const subjects = opts.subjects || hookSubjects(current);`),
so a faction hook can inject *its lair* as the sole subject rather than the whole map.

`onStirTrouble(factionId)` becomes:
- pick the **lair** = the faction's seat (`holdings[0]`);
- **origin** = `nearestSettlementTo(lair)`, falling back to the party position, then the lair;
- build a **synthetic subject** for the lair whose `occupant = { kind:"occupied", by: faction.name }`
  — that's what makes the engine's `threat` prose print the **faction** as the menace and the holding
  as the **lair** place; `poiId` links back to the real site (so map jumps land on it);
- call `onGenerateHook({ origin, forcePattern:"known", verb:"threat", source, subjects:[lair], sourcePower: faction.id })`.

Two small helpers: `nearestSettlementTo(world, pt)` (closest placed `hex.settlement.present`), and a
lair place-name (`poiBaseName` if the holding has a POI, else the settlement/GM name, else "a camp in
the ‹terrain›"). New import: `axialDistance` from `hexgeo`.

## UI

- **Factions tab** — the per-faction **"Stir up trouble"** button (already shipped in Chunk 2) now
  produces a lair-pointing threat.
- **Hooks tab** — when `hook.sourcePower` is set, show **"Stirred up by ‹faction›"** with a
  jump-to-faction link (Chunk C), resolved via `factionNameById` + `onCenterFaction` on the hooks
  model (same idiom as the Detail tab). Keeps `hooks.js` engine-pure.

## Build chunks (test after each)

| Chunk | Change | How you test it |
|---|---|---|
| **A — core** | Rework `factionHookContext` (→ `threat` + goal rumour), drop the old pattern bias; keep `GOAL_RUMOUR`. Rework the node tests. | `node --test test/factions.test.js` |
| **B — emit** | Rework `onStirTrouble` (lair subject + nearest-settlement origin + threat); add `nearestSettlementTo`/lair-name helpers + `opts.subjects` + `axialDistance` import. | Browser: "Stir up trouble" → a hook heard in the nearest town, naming the faction, pointing at its lair |
| **C — tag** ✅ | "Stirred up by ‹faction›" line + jump-link on the hook card (both the global + pinned lists), via `factionNameById`/`onCenterFaction` on the hooks model. | Browser: the hook shows its origin faction; the link centres on it |

## Tests (`node --test`, pure logic only)

- `factionHookContext` returns `verb: "threat"` always.
- a known goal → its `GOAL_RUMOUR` string; an unmapped/absent goal → `source` undefined.
- (the lair-subject construction + nearest-settlement pick live in the UI layer; the `threat` hook they
  produce is already covered by `hooks.test.js`.)

## Manual checklist (`./run-local.sh`)

```
[ ] Generate a faction on/near a settlement, then "Stir up trouble" → a hook appears on the Hooks tab
    that NAMES the faction, reads as a threat ("<Faction> have been raiding the roads"), and gives the
    faction's holding as the lair with a distance/bearing FROM a town
[ ] The hook's → Target centres the map on the faction's holding (you can travel there)
[ ] A faction with a goal opens with that goal's rumour ("Smoke on the frontier: ...")
[ ] Stir twice → two different threats (claim/reward vary), both pointing at the same lair
[ ] Reload + Export→Import → the hook keeps its sourcePower tag (schema v16)
```

## Out of scope (this step)
- Encroachment/takeover (mutating a POI's occupant), goal omens — their own steps.
- Auto-firing without a button + reading `strength` — 8.12.
- Per-archetype deed tables (so `warning`/`rescue` can also name the faction) — a later refinement.
