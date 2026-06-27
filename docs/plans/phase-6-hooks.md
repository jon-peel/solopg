# Phase 6 — Hooks (was "Rumors")

**Renamed:** *Rumors → Hooks.* These aren't just flavour the party overhears — they're actionable
adventure seeds that **point at a place on the map** and reward travel/exploration. A hook is heard
somewhere (a settlement, a traveller) and **points at a target** (an existing or freshly-generated
hex/POI), with a hidden truth value and a resolution lifecycle.

This phase delivers **Type-1 hooks only** — *local* seeds the party can act on now. The signature
new mechanic is **lazy target-tile generation**: a hook can point at a tile that doesn't exist yet,
and we generate **just that tile** (route in between stays blank) the way dungeons build lazily on
open. **Type-2 "distant powers"** (moving threats, spreading influence, news propagation by
distance) is explicitly **deferred to the Factions phase** — see [Forward hooks](#forward-hooks-to-type-2--factions).

> Follows the project design loop: this doc is the **plan** → **approve** → build per sub-step →
> `node --test` → commit/push → manual checklist. One coherent sub-step per commit.

---

## The model: two independent axes

A hook is a **resolution pattern** × a **verb**. Two small axes multiplied (plus terrain/subject
skins) give effectively endless combinations — the same approach as `feature-detail.js`.

### Axis A — resolution pattern (how the target tile comes to exist)
| Pattern | Target | New tiles generated | Example |
|---|---|---|---|
| **Known** | a POI already on/adjacent to the map | none | "A bandit camp in the next wood is harassing merchants." |
| **Distant** | a tile *n* away | **only the target tile** (`explored:false`); route stays blank; bearing + distance stored | "A lost artifact lies in a temple, three days north-east." |
| **Map** | a tile *n* away | target tile **plus a revealed corridor** of hexes leading to it | "This old map traces a path to a forgotten tomb." |
| **Chain** | a sequence of targets | each step generated lazily as the prior clue is resolved | Indiana-Jones style: a shrine inscription → a dungeon → a clue behind a tomb altar → the payoff. |
| **Return** | an **already-explored** POI with a new development | none (reuses an explored tile) | "The mine you cleared has been reoccupied." |

### Axis B — verb (what the hook is *about*)
- **Explore / treasure** — go find the thing (lost artifact, hidden tomb).
- **Threat** — a danger sits nearby (raiders harassing the road).
- **Opportunity** — non-combat payoff: a buyer in town pays well for *X* (ancient artifacts, looted
  paintings, even deer skins / furs). Aim for several of these.
- **Rescue / missing** — someone went to POI *X* and never came back.
- **Warning / avoid** — a *negative* steer paired with a genuinely dangerous target (a cut-throat
  camp, a dragon lair) so it has teeth.
- **Escort / delivery** — take a person/parcel/message to a distant place ("get word to the hermit
  in the desert," "carry the relic over the mountains to the city").
- **Event / pilgrimage** — a time-flavoured draw at a settlement/shrine (a travelling market, a music
  festival, a religious celebration).

Not every verb fits every pattern; a small **compatibility map** gates the sensible combos (e.g.
*event* → Known/Distant, *escort* → Distant/Map with two endpoints, *return* → threat/opportunity).

### Truth & source
- **Truth** ∈ `true | partial | false`, **stored but GM-only** (revealed behind a toggle). A false
  hook still points somewhere — the promise just isn't there (or it's a nastier surprise).
- **Source** — where it was heard (tavern talk, a traveller, a drunk, a dying man, a found note);
  flavour plus a nudge to plausibility.

---

## Data model & persistence

Hooks span tiles (origin ≠ target), so they live as a **top-level list on the world**, not on a hex.

- **`world.hooks: []`** — new persisted field ⇒ **schema bump to v6** + a `migrateWorld` step
  (old worlds get `hooks: []`) + `export/import` round-trip. This is the one unavoidable schema bump.
- **Hook shape** (structured picks; prose composed at render, per the "derived-not-stored" rule):
  ```js
  {
    id: "hook:<n>",
    pattern: "known|distant|map|chain|return",
    verb:    "explore|threat|opportunity|rescue|warning|escort|event",
    origin:  { q, r },              // where it was heard
    target:  { q, r, poiId? },      // what it points at
    subject: { … },                 // the thing (POI ref / creature / commodity / person)
    truth:   "true|partial|false",  // GM-only
    source:  "tavern|traveller|…",
    status:  "open|resolved|ignored",
    // pattern-specific:
    distance, bearing,              // distant
    path: [ {q,r}, … ],             // map (revealed corridor)
    chainNext: "hook:<id>",         // chain
    build: HOOK_BUILD               // self-heal stamp
  }
  ```
- **Self-heal:** stamp `HOOK_BUILD`; regenerate composed prose / backfill on open if stale — same
  pattern as `DUNGEON_BUILD` / `FEATURE_BUILD`. Only the *world field* forces the v6 bump; everything
  inside a hook self-heals without further bumps.

---

## The new core mechanic — lazy target-tile generation

Most patterns need a target that may not be on the map yet. One small **pure** helper, deterministic
via `subRng(seed, "hook", n, …)`:

1. **Pick a target coordinate** — a bearing + distance from the origin (Distant/Map), or an existing
   placed hex (Known/Return).
2. **Ensure the target hex exists** — if unplaced, generate **just that hex** (normal `generateHex`)
   and **force the POI the hook promises** (a temple for the artifact, a den for the threat), leaving
   it `explored:false`. The intervening hexes are **not** placed — the blank route *is* the adventure.
3. **Map pattern only:** also place/reveal a thin **corridor** of hexes from origin → target.

Because target selection is seeded and order-independent, the same world + seed always produces the
same hook targets, and a target tile self-consistently "was always there."

---

## Sub-steps (build order)

Each sub-step is a usable vertical slice; later steps add patterns/verbs as mostly more table rows.

| Step | Scope | Status |
|---|---|---|
| **6.1** | **Foundation** — schema v6 + migration + portability; `js/gen/hooks.js`; tables; **Known** pattern with a starter verb set (explore + threat); a settlement **Hooks** panel (generate 1d_N_, GM truth toggle, resolve/ignore, click-to-select target). Node tests. | ◻ |
| **6.2** | **Distant targets** — lazy target-tile generation (the signature mechanic): isolated target hex *n* away, bearing + distance, blank route, **click-to-jump** the map to the target. | ◻ |
| **6.3** | **Treasure maps** — Map pattern: target **plus a revealed corridor**; "found map" source flavour. | ◻ |
| **6.4** | **Breadcrumb chains** — Chain pattern: multi-step clue→clue→payoff, each step generated lazily; chain linkage + per-step resolve. | ◻ |
| **6.5** | **Verb & flavour library** — the breadth pass: full verbs × terrain/subject skins via a composable prose engine — opportunity **buyers**, rescue/missing, warning **paired with a dangerous target**, escort **two-endpoint**, event/pilgrimage. Mostly JSON rows + biases. | ◻ |
| **6.6** | **Return trips + lifecycle & map polish** — Return pattern; hook lifecycle (open/resolved/ignored, optional expiry); **map indicators** on hook targets; verification + back-compat sweep. | ◻ |

Foundation first (cheapest, proves persistence + the Known slice). Distant second — it's the new
mechanic everything else leans on. Breadth (6.5) deliberately late, when the structure is stable.

---

## Files (anticipated)
- **`js/gen/hooks.js`** *(new, pure)* — `generateHook(world, origin, rng, opts)`, the pattern/verb
  rollers, the **target-selection + lazy-tile** helper, `HOOK_BUILD`, prose-pick assembly.
- **`/data`** *(new tables)* — `hook-pattern`, `hook-verb`, `hook-source`, `hook-truth`,
  `hook-subject` (+ per-verb tables: `hook-threat`, `hook-opportunity` (commodities/buyers),
  `hook-escort`, `hook-event`, …). Terrain/subject biases as small consts in `terrain-profile.js`.
- **`js/world/world.js`** — `SCHEMA_VERSION = 6`; `createWorld` seeds `hooks: []`; hook accessors
  (`addHook/removeHook/getHooks`).
- **`js/data/portability.js`** — `migrateWorld` v5→v6 step; export/import carries `hooks`.
- **`js/ui/panel.js`** — settlement **Hooks** section: generate, list, compose prose, GM truth
  toggle, resolve/ignore, click-through to target.
- **`js/ui/app.js`** — register new tables in `HEX_TABLE_IDS`; wire generate/select/jump; lazy
  target-tile build seam (mirrors the dungeon lazy-build hook).
- **`js/ui/map.js`** — hook-target indicator + (Map pattern) the revealed corridor.
- **`/test`** — `hooks.test.js`, plus `migration.test.js` / `portability` updates.

## Reuse (don't fork)
`subRng`/`rollTable`/`loadTables`; `generateHex` + `generatePoi` (forced type, as `ctx.theme`/
`ctx.size` already do); the **lazy-build seam** in `app.js` (dungeon/tower); `feature-detail.js`'s
**compose-at-render** approach for prose; `terrain-profile.js` bias consts; `hexgeo.js` for
bearing/distance and the Map corridor; `buildMenu`/panel patterns.

## Tests (`node --test`, pure logic only)
- `generateHook` returns a well-formed hook for each pattern; values come from the loaded tables;
  the **verb×pattern compatibility map** never emits an illegal combo.
- **Determinism** — same world+seed → identical hook (target, picks, truth).
- **Lazy target generation** — Distant/Map place exactly **one** target hex (Map: + corridor),
  route hexes stay unplaced, the forced POI is present, `explored:false`.
- **Migration/portability** — v5 world upgrades to v6 with `hooks: []`; export→import round-trips a
  world carrying hooks; `schemaVersion` current.

## Verification (manual, per step, via `./run-local.sh`)
```
6.1 [ ] At a settlement, generate hooks → a list of distinct seeds pointing at nearby POIs
    [ ] GM truth toggle reveals true/partial/false; resolve/ignore updates status
    [ ] Click a hook → selects its target hex; reload + export→import → identical (schema v6)
6.2 [ ] A "Distant" hook generates ONE far tile (route blank); click jumps the map there
6.3 [ ] A "Map" hook reveals a corridor of hexes from town to the target
6.4 [ ] A "Chain" hook: resolving step 1 reveals step 2's target; payoff at the end
6.5 [ ] Verbs read distinctly: a buyer's offer, a rescue, a warning tied to a deadly lair, an escort
6.6 [ ] A "Return" hook reuses an explored POI with a new development; targets show a map marker
```

---

## Forward hooks (to Type-2 / Factions)

Deliberately **out of scope** here, recorded so 6.x data leaves room for them:

- **Roaming target** — a hunt whose target hex **moves each turn** (influence grow/shrink factor
  ~1/1). Needs a turn engine ⇒ Factions.
- **Region / "something is stirring"** — a vague disturbance over a region (malign *or* benign — a
  necromancer raising an army, **or** a travelling pilgrim spreading light and good news). Whether
  the party knows *what* stirs is a play choice, not generation. ⇒ Factions.
- **News propagation by distance** — a distant power's deeds reach the party with probability scaling
  on **proximity × influence size**: a 10-tile threat is common gossip; a 500-tile one (another
  continent) is a once-a-campaign whisper. ⇒ Factions.

Design seam to keep open now: a hook should be able to carry an optional `sourcePower` ref later, so
a faction can **emit** Type-1 hooks without reworking the schema.

## Open decisions (confirm before building 6.1)
1. **Where hooks are generated** — only at settlements (lean: yes for v1), or also from
   travellers/random events on the map?
2. **How many at once** — a fixed `1d6` "tavern board," or a per-settlement-size count?
3. **Truth visibility** — single global GM toggle (lean) vs per-hook reveal.
4. **False-hook targets** — still generate a (wrong/empty/trapped) target tile (lean: yes), or point
   at nothing?
