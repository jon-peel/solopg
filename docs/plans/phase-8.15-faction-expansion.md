# Phase 8.15 — Faction expansion as the engine (contention + world events)

Corrects a priorities inversion: faction **influence and expansion** was always the primary purpose of
factions, but 8.13 shipped it silent, capped, and minimal while the hooks (8.11/8.12/8.14) got the
design attention. 8.15 makes expansion the **centrepiece** and turns hooks into a **consequence** of it.

The whole change reduces to one architectural move: **a faction turn stops mutating the world silently
and starts producing events.** Those events feed two things — **visibility** (the world visibly moving)
and **hooks** (the fallout). The faction object, generation, and turn-clock are kept as-is.

**Scope:** these are **global/regional powers** — a faction *is* its map footprint. Settlement-internal
factions (guild politics inside one town) are a separate, finer layer, **out of scope** here.

**Status:** 📝 planned.

> Plan → approve → build per chunk → `node --test` → commit/push → manual checklist.

## No schema bump

Holdings can now *shrink* (contention) and `status` can become `"destroyed"` — both already in the v16
faction shape. POI-takeover rewrites an existing `poi.occupant` (the 8.8 shape). Nothing new is
persisted; the turn's **events are transient** (returned, logged, turned into hooks — never stored).
**`SCHEMA_VERSION` stays 16.**

---

## 1. The expansion engine (rework `moveOrSpread`, pure)

Today `moveOrSpread(world, faction, rng)` mutates `holdings` and returns nothing. It becomes the heart
of the turn and **returns the events it caused** (a turn can cause 0–2 events). Structural only — the
app adds flavour:

```js
// event kinds (structural; the app classifies impact + writes prose):
// "claim"     spreading took an EMPTY passable hex
// "move"      roaming relocated its camp to a passable hex
// "takeover"  spreading WON a contested (rival-held) hex   → fromFactionId = loser
// "repelled"  spreading tried a rival hex and LOST          → fromFactionId = holder (no ownership change)
// "eliminated" a faction lost its last holding              → factionId = loser, byFactionId = winner
{ kind, factionId, q, r, poiId?, fromFactionId?, byFactionId? }
```

### Rules
- **No cap.** `HOLDING_CAP` is removed — a spreading faction keeps growing one hex per turn.
- **Spread, prefer empty, then contest.** Frontier = passable placed neighbours of any holding not
  already held by this faction. Split into **empty** vs **rival-held**. If any empty → claim one
  (`"claim"`). Else pick a rival hex and **contest** it.
- **Contest = strength-weighted** (pure, one rng draw): attacker wins with `atk / (atk + def)`.
  - win → the hex moves from loser to attacker (`"takeover"`, `fromFactionId` = loser);
  - loss → nothing changes (`"repelled"`).
- **Elimination.** When a takeover drops the loser to **0 holdings**, set its `status = "destroyed"`
  and emit `"eliminated"`. A destroyed faction is skipped by all turn loops thereafter.
- **Roaming** relocates `holdings[0]` to a passable neighbour **not held by another faction** (prefer
  empty; drop `poiId` on the move as today) → `"move"`. Roamers don't hold territory; their interest is
  *what they camp on* (road/settlement/POI → an event, below).

### Helpers (pure, in `factions.js`)
- `holderOf(world, q, r, exceptId)` → the faction (≠ exceptId) whose holdings include `(q,r)`, or null.
- Reuse `passableNeighborsOf` (unchanged) + the stable q,r sort before every rng pick (determinism).

### Determinism
Same per-turn stream as today (`subRng(seed,"factionturn",id,turnOrdinal)`), draws in a fixed order
(disposition drift → spatial pick → contest roll). A turn is fully reproducible; events are derived.

## 2. Turns return an event log

`tickFaction` returns the events from `moveOrSpread` (goal/disposition still tick). `advanceFactionTurn`
and `advanceFactionDays` **concatenate events across all active factions** and return the list (instead
of a bare count). Callers already exist; they just get richer return values.

## 3. Visibility (Chunk B) — the fastest win

On every turn (day-tick **and** the manual "Advance faction turn" button), the app writes a plain log
line per event, so the world is legible without any hooks:

- `The Ashen Hand spreads into Millbrook.` / `… seizes the Sunken Abbey.`
- `The Gnashers move camp onto the old road.`
- `The Ashen Hand takes a holding from the Red Company.` / `The Red Company is destroyed.`

(Optional later polish: a one-line "latest move" on each faction card — deferred to keep the turn fns
pure.)

## 4. Expansion → hooks (Chunk C)

The app classifies each `claim`/`move`/`takeover` event's hex — **`impact`** ∈
`settlement | road | poi | bare` (from `hex.settlement`, `world.roads`, `hex.pois`; priority
settlement > poi > road > bare) — and turns the **significant** ones into hooks (bare = log line only,
so volume stays sane):

| impact | hook |
|---|---|
| **settlement** | archetype-flavoured: cult → wins converts · bandits/tribe → tribute/raid · noble house → presses a claim · merchant guild → corners the trade · thieves' guild → a den takes root |
| **road** (roamers) | "the road by ‹place› is held — travellers waylaid" |
| **poi** (spread takeover) | "‹Faction› has seized ‹POI›" **and rewrites `poi.occupant`** → `{kind:"occupied", by:‹label›, factionId}` so a return visit is disrupted (roamers only *raid* a POI — an event, no permanent occupant change) |

**Flavour** is a pure, tested seam mirroring `factionHookContext`:
`expansionHookContext(faction, impact, rng)` → `{ claim }`, drawing from JS-const phrasing maps
(`SETTLEMENT_ACTION[archetype][]`, `ROAD_ACTION[]`, `POI_ACTION[]` — same rules-as-consts style as
`GOAL_RUMOUR`, with a few phrasings each so repeats are rare). The hook is built pointing at the
**affected hex** (target = the place), tagged `sourcePower = faction.id`, surfaced in the existing Hooks
list (generalise `buildFactionHook` to take the target subject instead of always the lair).

**Retire the 8.12 proximity auto-fire.** Expansion-events are its causal replacement, so remove the
proximity roll (`autoHookChance`/`rollAutoHookCount` + their use in `autoFireFactionHooks` + their
tests). **Keep:** the manual "Stir up trouble" button (8.11, a GM nudge) and the region "stirring" hook
(8.14, the aggregate signal), now fed naturally by expansion activity.

## Files

| File | Change |
|---|---|
| `js/gen/factions.js` | remove `HOLDING_CAP`; rework `moveOrSpread` → returns events (no cap, contention, elimination); `holderOf`; `tickFaction`/`advanceFactionTurn`/`advanceFactionDays` return an event log; `expansionHookContext` + `SETTLEMENT_ACTION`/`ROAD_ACTION`/`POI_ACTION` consts; delete `autoHookChance`/`rollAutoHookCount` |
| `js/gen/hooks.js` | generalise a faction-hook build to accept an arbitrary target subject (or a small `buildExpansionHook`) — engine otherwise unchanged |
| `js/ui/app.js` | day-tick + manual turn: log the event list (Chunk B); classify impact + build/push expansion hooks + rewrite POI occupant (Chunk C); drop the proximity pass from `autoFireFactionHooks` (keep the region pass) |
| `data/` | none required if flavour stays JS consts; (optional: move phrasings to tables later) |
| `test/factions.test.js` | expansion-engine tests (below); remove the proximity-auto tests |
| `test/hooks.test.js` | expansion-hook build test |

## Build chunks (test after each)

| Chunk | Scope | How you test it |
|---|---|---|
| **A — engine** (pure) | rework `moveOrSpread` (no cap, contention, elimination, returns events); turns return an event log. | `node --test` |
| **B — visibility** | log every turn event on the day-tick + manual button. | Browser: advance turns → a running commentary of who moved/spread/seized/was destroyed; markers update |
| **C — hooks** | impact classification → expansion hooks; POI-takeover rewrites occupant; retire 8.12 proximity. | Browser: a faction spreading onto a town/road/dungeon throws a tagged hook; a seized dungeon shows its new occupant on the map/POI list |

## Tests (`node --test`, pure)
- **No cap:** a spreading faction grows past 6 holdings over enough turns.
- **Contention:** a spreading faction hemmed by a rival **contests**; the contest is strength-weighted
  (a much stronger attacker wins the large majority of seeded trials) and deterministic for a stream; a
  win moves the hex from loser to winner (`"takeover"`), a loss changes nothing (`"repelled"`).
- **Elimination:** a faction reduced to 0 holdings gets `status:"destroyed"` + an `"eliminated"` event,
  and is skipped thereafter.
- **Roaming:** relocates onto a passable non-rival hex, drops `poiId`, emits `"move"`; stays put when
  boxed in.
- **Event log:** `advanceFactionTurn`/`advanceFactionDays` return the concatenated, well-formed events.
- **Flavour:** `expansionHookContext` returns an archetype-appropriate claim per impact; deterministic.

## Manual checklist (`./run-local.sh`)
```
[ ] Two spreading factions grown toward each other → they contest the border; one takes the other's
    hexes over turns; a faction can be wiped out ("… is destroyed")
[ ] No cap: a lone spreading faction keeps growing past 6 holdings
[ ] Every "Advance faction turn" prints what each faction did (spread / seized / took / destroyed)
[ ] A faction spreading onto a settlement / road / dungeon throws a tagged hook naming the place
[ ] A cult seizing a dungeon rewrites its occupant → revisiting the POI shows the new holder
[ ] No more purely-random proximity hooks; region "stirring" + manual "stir" still work
[ ] Reload / export→import unaffected (v16)
```

## Out of scope (deliberate)
- **New faction *types*** (necromancer, etc.) — a **content follow-on**, once the engine is tuned. The
  engine keys off archetype *family* (roam/spread) + impact class, so a flavour-only type is just data
  (an archetype row + a mobility mapping + phrasing rows) with **no engine change**.
- **Novel behaviours** (a non-roam/spread mobility, non-territorial spread like a blight, naval
  crossing) — would need an engine seam; none planned until a type calls for one.
- **Settlement-internal factions** — a different layer, separate feature.
- **Faction-vs-faction beyond hex contention** (armies, sieges) — contention is the whole resolver here.
