# Phase 8.15 — Faction expansion as the engine (contention + world events)

> **⚠️ As-built amendment (supersedes Chunk C below).** This phase shipped with one deliberate
> change of direction from the plan: **faction expansion is played as SUBTEXT, not hooks.**
> - **Chunk A (expansion engine) — shipped as written.** A faction turn is uncapped and contested and
>   returns `FactionEvent[]` (`claim`/`move`/`takeover`/`repelled`/`eliminated`); `HOLDING_CAP` and the
>   retired proximity code are gone; a faction at 0 holdings is `destroyed`.
> - **Chunk B (visibility) — shipped as written.** Both the day-tick and the manual button log one line
>   per event.
> - **Chunk C (expansion → hooks) — built, then removed.** Play feedback: a GM would rather read the
>   growing faction *in the fiction* (the map's coloured territory + the Chunk B log) than field a
>   stream of auto-generated leads. So `buildExpansionHook` / `expansionHookContext` / `hexImpact` /
>   the occupant rewrite / the `pattern:"expansion"` hook were all removed. The **manual "Stir up
>   trouble" faction hook (8.11) and the region "something is stirring" hook (8.14) were also removed**
>   for the same reason — factions emit **no hooks at all**. (The region *naming* engine, `computeRegions`,
>   stays — it still labels tracts on the map.)
> - **UI (not in the original plan):** the faction map **flag badge was removed** (coloured ring only,
>   so a held POI's glyph stays visible), and the hex Detail tab's "Claim for faction" button became a
>   single-owner **"Run by"** picker (shows the current holder; reassigns or clears on change).
>
> Everything from here down is the *original plan* and is kept for the engine/visibility design (Chunks
> A–B). Treat the Chunk C sections as historical.

> **This document is self-contained.** It assumes no prior knowledge of the app or of any earlier
> discussion. Read the *Orientation*, *Glossary*, and *Conventions* first; then build the chunks in
> order. Every design choice is already decided — you should not need to invent behaviour.

---

## Orientation — what this application is

This repo (`solopg`) is a **browser-based "world oracle" for tabletop role-playing games** — a tool a
solo player or a game master uses to generate and run an overworld. It is:

- **Client-only, offline, no build step.** Plain HTML/CSS/**JavaScript ES modules** loaded straight
  into the browser (`index.html`). There is no bundler, framework, or transpiler.
- **A hex map.** The world is a grid of hexagonal tiles ("hexes") using **axial coordinates** `{q, r}`.
  Each hex has terrain (Plains, Forest, Hills, Mountains, Swamp, Desert, Sea, Lake), and may carry a
  settlement, rivers, roads, and points of interest.
- **Deterministic from a seed.** Everything is regenerated reproducibly from a single integer
  `world.seed` via seeded random sub-streams, so a world is shareable and stable.
- **Persisted in the browser** (IndexedDB) with JSON export/import. **Node.js is used only for the
  test runner and a local static server** — it is not a runtime dependency.
- **System-agnostic OSR fantasy** — generic old-school content, no specific rules system.

You will mostly touch three kinds of file:
- `js/gen/*.js` — **pure generator/logic modules** (no DOM), unit-tested with `node --test`.
- `js/ui/*.js` — the **browser glue** (DOM, canvas map, panels, event dispatch). Not unit-tested.
- `data/*.json` — **content tables** rolled by a generic engine.

## Glossary (objects this plan manipulates)

- **world** — the top-level object: `{ seed, hexes, party, hooks[], factions[], roads[], rivers[], … }`.
  `hexes` is a map keyed by `axialKey(q,r)` → hex. There is also an in-memory, **session-only** day
  counter (`sessionDay` in `app.js`) that is *not* persisted.
- **hex** — `{ coords:{q,r}, terrain, placed, explored, settlement?, pois?[] }`. `placed` means the
  tile actually exists on the map. `settlement` (when present) is `{ present:true, kind, size, … }`.
- **POI (point of interest)** — a site sitting on a hex, in `hex.pois[]`: `{ id:"poi:N", type, name,
  occupant? }`. `type` is e.g. `dungeon`, `shrine`, `ruin`, `tower`, `camp`. `occupant` (optional) is
  `{ kind:"occupied"|"lair"|"none", by?, creature?, factionId? }` — who currently holds the site.
- **faction** — a **regional power**; it *is* its footprint on the map. Shape:
  ```js
  {
    id: "faction:N", name, archetype, disposition,
    goal: { kind, progress, max },     // a "doom clock"; progress rises 1 per faction turn, capped at max
    strength,                          // small integer 2..4; how powerful the faction is
    holdings: [ { q, r, poiId? } ],    // the hexes it controls (≥1); holdings[0] is its seat
    clock: { turns, sinceTurn },       // turns taken; days banked toward the next day-driven turn
    origin, status,                    // status: "active" | "dormant" | "destroyed"
  }
  ```
  Two behaviour families, keyed by `archetype` (see `ARCHETYPE_MOBILITY` in `js/gen/factions.js`):
  - **roaming** (`bandits`, `monstrous tribe`, `mercenary company`) — a single mobile camp.
  - **spreading** (`cult`, `merchant guild`, `noble house`, `thieves' guild`) — grows its territory.
- **faction turn** — the faction heartbeat. On each turn a faction advances its goal clock, may drift
  disposition, and **acts on the map** (moves or spreads). A turn fires either **every
  `TURN_LENGTH_DAYS` (= 7) in-world days** as time passes, **or** immediately via a manual
  "Advance faction turn" button.
- **hook** — an adventure lead in `world.hooks[]`, pointing at a place: `{ id:"hook:N", pattern, verb,
  subject:{name,…}, origin:{q,r}, target:{q,r,poiId?}, claim, source, status:"open"|"resolved"|"ignored",
  sourcePower? }`. `sourcePower` (optional) holds a **faction id**, tying the hook to the faction that
  caused it (the panel renders a "Stirred up by ‹faction name›" link from it). Prose is **composed at
  render time** from the stored fields (see `hookName`/`hookDescription` in `js/gen/hooks.js`) — the
  sentence is not stored, the picks are.
- **the day-tick chokepoint** — `advanceDays(n)` in `js/ui/app.js`. Both travelling and the stationary
  "Progress N days" control route through it. It bumps `sessionDay`, fires the faction turns those days
  earn, and (currently) rolls auto-hooks. **This is the single seam where time-driven faction behaviour
  runs.**
- **region** — a *derived*, named terrain tract (e.g. "the Blackwood"): a connected clump of same-terrain
  hexes ≥ 16 tiles. Computed on demand by `computeRegions(seed, terrainByKey, {minSize})`
  (`js/gen/regions.js`); not stored. (Used only tangentially here — see "keep the region hook".)

## Conventions this codebase follows (obey these)

- **Seeded determinism.** All randomness comes from `subRng(worldSeed, ...parts)`
  (`js/core/rng.js`), which returns a `() => number` stream seeded by hashing the parts. The same parts
  always produce the same stream. When you add randomness, key it on stable parts (ids, coords,
  ordinals) so results are reproducible and reload-safe.
- **Content vs rules.** Rollable *content* (names, phrases) lives in `data/*.json` tables rolled with
  `rollTable(table, rng)` (`js/core/table.js`). *Rules* (which archetype does what, tuning numbers) live
  as JS consts in the generator modules. This plan's flavour phrasing is small and archetype-keyed, so
  it lives as **JS consts** (mirroring the existing `GOAL_RUMOUR` const in `factions.js`), not tables.
- **Compose prose at render.** Store structured picks on the object; build the sentence in a
  `*Description` function. Never store rendered prose.
- **No data migrations.** Schema changes are a version *stamp*, not a transform. **This plan needs no
  schema change** (see below), so leave `SCHEMA_VERSION` alone.
- **Pure generators, thin UI.** Put logic (and its tests) in `js/gen/`; keep `js/ui/app.js` to wiring.

## Prerequisites & baseline

- **Branch:** work on `claude/arch-c-onboarding-dkx4yl` (or a fresh branch off it).
- **Tests:** run `node --test` from the repo root. **Baseline is green — 419 tests pass.** Keep it
  green after every chunk.
- **Run the app:** `./run-local.sh` serves it at `http://localhost:8000` (it fetches + hard-resets the
  branch named in the script, runs the tests, then serves). Hard-refresh the browser tab to pick up
  changes.
- **Key files you will edit:** `js/gen/factions.js`, `js/gen/hooks.js`, `js/ui/app.js`,
  `test/factions.test.js`, `test/hooks.test.js`.
- **Optional background** (not required): the sibling docs `phase-8.11-faction-hooks.md`,
  `phase-8.13-movement-expansion.md`, and `phase-8.14-region-hooks.md` describe the current hook,
  movement, and region mechanics this builds on.

---

## Why this change

Factions exist to **grow and contend for influence** — that is their point. Today they *do* move and
spread, but the mechanic is minimal and **completely silent** (it mutates the map with no log line and
no consequence), and it is bounded by an arbitrary `HOLDING_CAP = 6`. Meanwhile faction-driven *hooks*
became the elaborate part. This phase corrects that: **expansion becomes the primary, visible engine,
and hooks become a consequence of it.**

## The one architectural move

**A faction turn stops mutating the world silently and instead returns a list of events.** Those events
drive two things:
1. **Visibility** — the app logs what each faction did (Chunk B).
2. **Hooks** — significant events become adventure hooks (Chunk C).

Everything else is a consequence of that. The faction object, generation, goal clock, and disposition
drift are unchanged.

## No schema bump

Holdings can now *shrink* (a hex is lost to a rival) and `status` can become `"destroyed"` — both
already valid in the v16 faction shape. A POI takeover overwrites an existing `poi.occupant` (an
existing shape). Events are **transient** (returned, logged, turned into hooks — never persisted).
**Leave `SCHEMA_VERSION` at 16.**

---

## Chunk A — the expansion engine (pure, in `js/gen/factions.js`)

Rework the spatial turn so it is uncapped, contested, and **returns events**.

### The Event type (returned by the turn; the app adds flavour)

```js
/** @typedef {{
 *   kind: "claim"|"move"|"takeover"|"repelled"|"eliminated",
 *   factionId: string,        // the acting faction (for "eliminated": the faction destroyed)
 *   q?: number, r?: number,   // the hex acted on (absent on "eliminated")
 *   fromFactionId?: string,   // "takeover"/"repelled": the rival that held/holds the hex
 *   byFactionId?: string,     // "eliminated": the faction that finished it off
 * }} FactionEvent */
```

Kinds:
- **`claim`** — a spreading faction took an **empty** passable hex.
- **`move`** — a roaming faction relocated its camp to a passable hex.
- **`takeover`** — a spreading faction **won** a contested (rival-held) hex; `fromFactionId` = loser.
- **`repelled`** — a spreading faction **tried** a rival hex and **lost**; nothing changed.
- **`eliminated`** — a faction lost its last holding (emitted right after the `takeover` that did it).

### `moveOrSpread(world, faction, rng)` → `FactionEvent[]`

Currently returns nothing and stops at `HOLDING_CAP`. Rewrite it to return an array (0–2 events):

1. `mobility = ARCHETYPE_MOBILITY[faction.archetype]`. If neither `"roaming"` nor `"spreading"` (i.e.
   an unknown archetype → treat as static), return `[]`.
2. **Roaming:** candidates = `passableNeighborsOf(world, holdings[0])` (existing helper) **minus** any
   hex held by *another active faction* (use `holderOf`, below) **and** minus this faction's own
   holdings. If none, return `[]`. Otherwise pick one (`Math.floor(rng()*cands.length)` over the
   already-sorted list — keep the stable q,r sort before the pick), set `holdings[0] = {q,r}` (drop
   `poiId`), and return `[{ kind:"move", factionId, q, r }]`.
3. **Spreading (no cap):** build the frontier = every `passableNeighborsOf` of every holding, not
   already this faction's own, **deduped and q,r-sorted**. Split into `empty` (no other faction holds
   it) and `rival` (held by another active faction).
   - If `empty` is non-empty: pick one, `holdings.push({q,r})`, return `[{ kind:"claim", factionId,
     q, r }]`.
   - Else if `rival` is non-empty: pick one; let `def = holderOf(world, q, r, faction.id)`. **Contest**
     (one rng draw): attacker wins iff `rng() < atk / (atk + def)` where `atk = faction.strength||1`,
     `def = def.strength||1`.
     - **Win:** remove `{q,r}` from `def.holdings`; `holdings.push({q,r})`. Events: start with
       `[{ kind:"takeover", factionId, q, r, fromFactionId: def.id }]`. If `def.holdings.length === 0`,
       set `def.status = "destroyed"` and append `{ kind:"eliminated", factionId: def.id,
       byFactionId: faction.id }`.
     - **Loss:** change nothing; return `[{ kind:"repelled", factionId, q, r, fromFactionId: def.id }]`.
   - Else (frontier empty): return `[]`.

Prefer-empty-then-contest means factions grow into open space first and only fight at the borders.

### `holderOf(world, q, r, exceptId)` (new pure helper)

Returns the first **active** faction (`status` "active", and `id !== exceptId`) whose `holdings`
include `(q,r)`, or `null`. Iterate `world.factions`.

### Wire it through the turn functions (change their return types)

- **`tickFaction(world, faction, rng)`** — keep the goal-clock tick and disposition drift exactly as
  they are (they draw rng first, then `moveOrSpread` draws — preserve that order for determinism).
  Change it to **return the `FactionEvent[]` from `moveOrSpread`** (it currently returns `faction`).
- **`advanceFactionTurn(world, seed)`** — currently returns a count. Change it to **collect and return
  `FactionEvent[]`** concatenated across every active faction it ticks. (A faction destroyed earlier in
  the loop is skipped by the existing `isActive` guard.)
- **`advanceFactionDays(world, days, seed)`** — currently returns a turn count. Change it to **collect
  and return `FactionEvent[]`** across every turn it fires.

Determinism is unchanged: the per-turn stream is still `subRng(seed,"factionturn",id,turns)`, and draws
happen in a fixed order (disposition, then the spatial pick, then — only when contesting — the contest
roll).

### Remove `HOLDING_CAP`

Delete the const and its check. Contention + the finite revealed map are the limiter now. (A lone
faction with no rivals will keep spreading slowly, one hex per turn — accepted.)

### Also delete the retired proximity-hook code

Delete `autoHookChance` and `rollAutoHookCount` (and the `AUTO_HOOK_*` consts) — Chunk C removes their
only caller. (Keep `regionHeat`/`regionStirChance`/`rollRegionStir` — the region hook stays.)

### Chunk A tests (`test/factions.test.js`)

Remove the `autoHookChance`/`rollAutoHookCount` tests. Add (build small worlds the way the existing
movement tests do — see the `placedWorld`/`factionAt` helpers already in the file):
- **No cap:** a lone spreading faction grows past 6 holdings over enough turns.
- **Claim:** spreading onto empty ground returns a `claim` event and adds the hex.
- **Contention is strength-weighted + deterministic:** a much stronger attacker wins the large majority
  of many seeded contests; same seed → same outcome; a win yields `takeover` and moves the hex from
  loser to winner; a loss yields `repelled` and changes nothing.
- **Elimination:** reducing a faction to 0 holdings sets `status:"destroyed"` and emits `eliminated`;
  it is skipped on later turns.
- **Roaming:** returns `move`, drops `poiId`, never steps onto a rival's hex; stays (`[]`) when boxed in.
- **Return contract:** `advanceFactionTurn`/`advanceFactionDays` return well-formed `FactionEvent[]`.

---

## Chunk B — visibility (in `js/ui/app.js`)

Make every turn legible. The turn functions now return events; **log one line per event** on both
paths, and drop the old summary count lines.

- Add `logFactionEvents(events)` that resolves faction names via `getFactions(current)` and a place
  label via `destinationLabel(getHex(current,q,r), q, r)` (existing helper: returns a hex's GM name,
  else its settlement name, else `"(q, r)"`), then logs:
  - `claim` → `` `${name} spreads into ${place}.` ``
  - `move` → `` `${name} moves camp to ${place}.` ``
  - `takeover` → `` `${name} seizes ${place} from ${fromName}.` ``
  - `repelled` → `` `${name} is driven back from ${place} (held by ${fromName}).` ``
  - `eliminated` → `` `${name} is destroyed.` ``
- In **`advanceDays`**: replace `const turns = advanceFactionDays(...)` + the `"N faction turns passed"`
  log with `const events = advanceFactionDays(current, n, current.seed); logFactionEvents(events);` then
  call the Chunk C hook step with those `events`.
- In **`onAdvanceFactionTurn`** (the manual button): `const events = advanceFactionTurn(current,
  current.seed);` For the "nothing to do" guard, check the **active-faction count** (
  `getFactions(current).filter(f => (f.status||"active")==="active").length`) rather than the old return
  count; then `logFactionEvents(events)`, run the Chunk C hook step, and persist.

Test in the browser: generating a couple of factions and advancing turns now prints a running
commentary, and the holding markers move.

---

## Chunk C — expansion → hooks (in `js/ui/app.js` + `js/gen/hooks.js`)

Turn **significant** events into hooks, and rewrite a seized POI's occupant. Retire the proximity roll.

### 1. Classify the hex (`app.js`, new helper)

```js
// Priority: settlement > poi > road > bare.
function hexImpact(world, q, r) {
  const hex = getHex(world, q, r);
  if (hex && hex.settlement && hex.settlement.present) return "settlement";
  if (hex && Array.isArray(hex.pois) && hex.pois.length) return "poi";
  if (roadHexKeySet(world).has(axialKey(q, r))) return "road"; // roadHexKeySet: js/gen/travel.js, already imported
  return "bare";
}
```

### 2. Which events become hooks

Only `claim`, `takeover`, and `move` events, and only when `hexImpact` is `settlement`, `poi`, or
`road`. **`bare` → no hook** (the Chunk B log line is enough). `repelled` and `eliminated` → **no hook**
(log only). This keeps volume sane; additionally **cap at 2 expansion hooks per faction per
`advanceDays`/turn call** (mirrors the retired proximity cap): count per `factionId` as you go and skip
beyond 2.

### 3. Occupant rewrite (the "disrupted revisit")

When a **spreading** faction takes a POI hex (`claim` or `takeover` — *not* a roamer `move`), rewrite
the POI it now holds:
```js
const hex = getHex(current, q, r);
const poi = hex && (hex.pois || [])[0];
if (poi) poi.occupant = { kind: "occupied", by: faction.name, factionId: faction.id };
```
(Any prior occupant is overwritten — the faction chased them out.) A roamer `move` onto a POI is a
**raid** — it produces the hook below but does **not** rewrite the occupant (the camp leaves next turn).

### 4. Flavour seam (`factions.js`, pure, tested)

Mirror the existing `factionHookContext`. Add archetype-keyed JS consts (write a few phrasings each so
repeats are rare; phrasings read as `"‹Faction› ‹phrase› ‹place›"`, so write them for a plural/collective
subject, e.g. *"are winning converts in"*):

```js
const SETTLEMENT_ACTION = {
  cult: ["are winning converts in", "raise a shrine over"],
  bandits: ["are extorting tribute from", "raid"],
  "monstrous tribe": ["are raiding", "terrorise"],
  "noble house": ["press their claim over", "install a magistrate in"],
  "merchant guild": ["are cornering the trade of", "buy up"],
  "thieves' guild": ["have opened a den in", "run a racket in"],
  "mercenary company": ["garrison", "quarter their company in"],
};
const ROAD_ACTION = ["hold the road by", "waylay travellers near", "have set an ambush on the road by"];
const POI_ACTION  = ["have seized", "have occupied", "have taken"];

// Returns the verb phrase for this faction acting on this impact class. Pure.
export function expansionHookContext(faction, impact, rng) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  if (impact === "road") return { claim: pick(ROAD_ACTION) };
  if (impact === "poi")  return { claim: pick(POI_ACTION) };
  const opts = SETTLEMENT_ACTION[faction.archetype] || ["move against"];
  return { claim: pick(opts) };
}
```

### 5. The expansion hook (a new `pattern:"expansion"`, in `hooks.js`)

Add a small builder alongside `buildRegionHook` (engine otherwise unchanged). The hook points at the
**affected place** and stores the actor name so the sentence can be composed at render:

```js
// ctx: { actor:string(faction name), claim:string, subject:{name,type,q,r,poiId?,terrain?},
//        origin:{q,r}, index?:number, sourcePower?:string }
export function buildExpansionHook(ctx) {
  const s = ctx.subject;
  return {
    id: ctx.index != null ? `hook:${ctx.index}` : undefined,
    build: HOOK_BUILD, pattern: "expansion", verb: "expansion",
    actor: ctx.actor,
    subject: { name: s.name, type: s.type, poiId: s.poiId },
    origin: { q: ctx.origin.q, r: ctx.origin.r },
    target: { q: s.q, r: s.r, poiId: s.poiId },
    bearing: bearingTo(ctx.origin, s),
    distance: axialDistance(ctx.origin.q, ctx.origin.r, s.q, s.r),
    targetTerrain: s.terrain || null,
    claim: ctx.claim, source: null, status: "open",
    ...(ctx.sourcePower ? { sourcePower: ctx.sourcePower } : {}),
  };
}
```

Add prose branches (keep them beside the existing `region` branch):
- `hookName`: `if (hook.pattern === "expansion") return \`${cap(hook.actor)}: ${hook.subject.name}\`;`
- `hookDescription`: an `expansion` branch producing one line —
  `` `${cap(hook.actor)} ${hook.claim} ${hook.subject.name}, ${whither}.` `` — where `whither` is the
  existing distance/bearing phrase already computed in that function (e.g. *"18 miles to the
  north-east (Hills)"*, or *"close by"* when distance 0). No reward line.

Attribution shows twice, which is fine: the sentence names the faction (`actor`), and the panel also
renders the existing "Stirred up by ‹faction›" link from `sourcePower`.

### 6. Assemble + push (`app.js`, the Chunk C hook step)

For each hookable event (respecting the per-faction cap of 2):
```js
const faction = getFactions(current).find(f => f.id === ev.factionId);
if (!faction) continue;
const impact = hexImpact(current, ev.q, ev.r);
if (impact === "bare") continue;
if (impact === "poi" && (ev.kind === "claim" || ev.kind === "takeover")) rewriteOccupant(faction, ev.q, ev.r);
const place = placeLabel(current, ev.q, ev.r, impact); // POI base name / settlement name / "the road by <town>"
const origin = nearestSettlementTo(current, ev)         // existing helper (js/ui/app.js); where word is heard
   || (current.party ? { q: current.party.q, r: current.party.r } : ev);
const rng = subRng(current.seed, "expansion", faction.id, nextHookId(current));
const { claim } = expansionHookContext(faction, impact, rng);
const hook = buildExpansionHook({
  actor: faction.name, claim,
  subject: { name: place, type: impact === "poi" ? "poi" : impact, q: ev.q, r: ev.r,
             poiId: /* the POI id if impact poi */, terrain: getHex(current, ev.q, ev.r)?.terrain },
  origin, index: nextHookId(current), sourcePower: faction.id,
});
current.hooks.push(hook);
logLine(`Word from the frontier — ${hookName(hook)}.`);
```
Place naming (`placeLabel`): POI → its base name (see `poiBaseName` in `app.js`); settlement → its name
(see `destinationLabel`); road → `` `the road by ${nearestSettlementName}` `` if a settlement exists,
else `` `the ${terrain.toLowerCase()} road` ``. `nearestSettlementTo(world, pt)` already exists in
`app.js`.

### 7. Retire the proximity auto-fire

In `autoFireFactionHooks`, **delete the per-faction proximity loop** (the `rollAutoHookCount` block) but
**keep the call to `autoFireRegionHooks`** (the region "stirring" hook, Chunk 8.14). Rename the function
if you like (e.g. `runFactionDayHooks`). The manual **"Stir up trouble"** button and its
`buildFactionHook` stay untouched (a GM nudge). Wire the Chunk C hook step (steps 1–6) into `advanceDays`
and `onAdvanceFactionTurn` using the `events` those paths now produce.

### Chunk C tests
- `test/factions.test.js`: `expansionHookContext` returns an archetype-appropriate claim for each
  impact (road/poi from the fixed lists; settlement from the archetype list; unknown archetype →
  fallback), and is deterministic for a given rng.
- `test/hooks.test.js`: `buildExpansionHook` yields `pattern:"expansion"`, `target` = the place hex,
  stores `actor`+`claim`+`sourcePower`; `hookName`/`hookDescription` render the branch (name appears,
  ends with a period).

---

## Files touched

| File | Change |
|---|---|
| `js/gen/factions.js` | remove `HOLDING_CAP`; rework `moveOrSpread` → `FactionEvent[]`; add `holderOf`; `tickFaction`/`advanceFactionTurn`/`advanceFactionDays` return `FactionEvent[]`; add `expansionHookContext` + `SETTLEMENT_ACTION`/`ROAD_ACTION`/`POI_ACTION`; delete `autoHookChance`/`rollAutoHookCount` + `AUTO_HOOK_*` |
| `js/gen/hooks.js` | add `buildExpansionHook` + `expansion` branches in `hookName`/`hookDescription` (engine otherwise unchanged) |
| `js/ui/app.js` | `logFactionEvents`; `hexImpact`; the Chunk C hook step + occupant rewrite; adapt `advanceDays` + `onAdvanceFactionTurn` to the new `FactionEvent[]` returns; delete the proximity loop (keep the region pass) |
| `test/factions.test.js` | expansion-engine tests + `expansionHookContext` tests; remove proximity tests |
| `test/hooks.test.js` | `buildExpansionHook` test |
| `data/` | none (flavour is JS consts) |

## Manual verification (`./run-local.sh`, browser)

```
[ ] New World ▾ → Large/Huge. Generate two SPREADING factions (e.g. two cults) a few hexes apart.
[ ] Press "Advance faction turn" repeatedly (Factions tab). Each press prints what every faction did.
[ ] The factions grow toward each other, contest the border, and one takes the other's hexes over time;
    a faction can be wiped out ("… is destroyed") and stops acting.
[ ] A lone spreading faction keeps growing past 6 holdings (no cap).
[ ] When a faction spreads onto a settlement / road / dungeon, a hook appears in the Hooks tab naming
    the place and tagged "Stirred up by ‹faction›".
[ ] A faction seizing a dungeon rewrites its occupant → open that POI and it shows the new holder.
[ ] "Progress 20" a few times reproduces the same via the day clock. No more purely-random proximity
    hooks; the region "stirring" hook and the manual "Stir up trouble" button still work.
[ ] Reload and Export→Import: unaffected (still schema v16).
```

## Decisions already locked (do not re-litigate)

1. Contested hex → **strength-weighted** roll `atk/(atk+def)`; winner takes it, loser loses it.
2. A faction at **0 holdings → `destroyed`** and drops out.
3. **No cap** on expansion.
4. Expansion hooks are a **new `pattern:"expansion"`** (not shoe-horned into `threat`); origin = nearest
   town to the affected place; **cap 2 per faction per advance**; `bare`/`repelled`/`eliminated` are
   **log-only** (no hook).
5. A **spreading** takeover/claim onto a POI **rewrites the occupant**; a roamer raid does not.
6. **Retire** the 8.12 proximity auto-fire; **keep** the manual stir button and the region "stirring" hook.

## Out of scope (deliberate)

- **New faction *types*** (e.g. a necromancer/death-cult) — a **content follow-on**: because the engine
  keys off mobility family + impact class, a flavour-only type is just data (an archetype row + a
  mobility mapping + phrasing rows) with **no engine change**. Do it *after* this lands and is tuned.
- **Novel behaviours** (a mobility that isn't roam/spread, a non-territorial "blight" spread, naval
  crossing) — would need a new engine seam; none is assumed here.
- **Settlement-internal factions** (guild politics inside one town) — a different, finer layer; separate
  feature, maybe never.
- **Army/siege resolution** beyond single-hex contention — contention is the whole resolver here.
