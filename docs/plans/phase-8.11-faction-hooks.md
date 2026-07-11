# Phase 8.11 — `sourcePower` + faction-emitted hooks (Arc C opens)

Closes the seam Phase 6 left open. Back then hooks were static and self-standing; the note said Type-2
"a power stirs up trouble" hooks *"wait on a future faction feature"*. Arc B built that feature, so
8.11 wires it up: a **"Stir up trouble"** action on a faction generates a **normal Type-1 hook**
through the **unchanged `hooks.js` engine**, biased by the faction's archetype/goal, and **tagged
back** to the faction via a new additive `sourcePower` field.

8.11 is the *manual* half of Arc C (a button press). **8.12** (auto-fire on the day-tick, where
`strength` finally becomes "hook loudness") and the leftover **region-hook** follow, each with its own
sub-plan when built.

**Status:** 📝 planned.

> Plan → approve → build → `node --test` → commit/push → manual checklist (project convention).

## No schema bump

`sourcePower` is an **additive, optional** field on a hook — exactly like every other additive hook
field (it self-heals: an old hook simply lacks it and shows no tag). Export/import already round-trips
the whole `world.hooks[]` array verbatim (`portability.js` carries `data.hooks`), so the tag rides for
free. **`SCHEMA_VERSION` stays 16.**

## The `sourcePower` field

A hook that a faction emitted carries the faction's id:

```js
hook.sourcePower = faction.id   // e.g. "faction:2"  (absent on all normal hooks)
```

Stored on the hook, resolved to a name **at render time** (compose-at-render rule — the id is the
pick, the "Stirred up by …" line is not stored). The hook is otherwise a completely ordinary hook:
same `generateHook`/`buildLocalHook`/… output, same list, same Resolve/Ignore/Pin lifecycle.

## Flavour: archetype → verb/pattern, goal → rumour (a rule → JS const)

The engine already takes an injectable `ctx.verb`, `ctx.pattern`, and `ctx.source`, so biasing needs
**no engine change** — we just pick those from the faction and hand them in. Rules-as-JS-consts, in
`factions.js`, retunable like every other generation constant:

```js
// Which hook shapes read as "this kind of power stirring": patterns + verbs that
// fit the archetype. A weighted-free pick over the SAME hooks.js engine.
const FACTION_HOOK_BIAS = {
  bandits:             { patterns: ["known", "distant"],     verbs: ["threat", "warning"] },
  "monstrous tribe":   { patterns: ["known", "distant"],     verbs: ["threat", "warning"] },
  "mercenary company": { patterns: ["known", "escort"],      verbs: ["threat", "rescue"]  },
  cult:                { patterns: ["known", "distant"],     verbs: ["warning", "threat"] },
  "thieves' guild":    { patterns: ["known", "opportunity"], verbs: ["warning"]           },
  "merchant guild":    { patterns: ["opportunity", "escort"],verbs: ["explore"]           },
  "noble house":       { patterns: ["known", "return"],      verbs: ["rescue", "warning"] },
  "hermit order":      { patterns: ["known", "return"],      verbs: ["explore", "warning"]},
};
// Unknown archetype → no bias: pattern/verb come back undefined and the engine rolls freely.

// Goal → a themed rumour used as the hook's `source` (the "who/what set this off"
// prefix in the prose). Ties the hook's flavour to what the faction is working toward.
const GOAL_RUMOUR = {
  "seize the region":        "Word of a gathering power",
  "hoard wealth":            "Talk of coin changing hands",
  "drive out rivals":        "Rumour of a turf war",
  "spread the faith":        "Whispers of new converts",
  "awaken something buried": "Uneasy talk from the diggings",
  "restore a fallen house":  "Old banners seen again",
  "control the trade roads":  "Merchants grumbling on the road",
  "raid the frontier":        "Smoke on the frontier",
};
```

Pure, node-testable helper (mirrors the other pure faction fns; consumes the rng in a fixed order so
it's deterministic):

```js
export function factionHookContext(faction, rng) {
  const bias = FACTION_HOOK_BIAS[faction.archetype];
  const pick = (a) => a[Math.floor(rng() * a.length)];
  return {
    pattern: bias ? pick(bias.patterns) : undefined, // undefined → engine rolls
    verb:    bias ? pick(bias.verbs)    : undefined,
    source:  (faction.goal && GOAL_RUMOUR[faction.goal.kind]) || undefined,
  };
}
```

`factions.js` does **not** import `hooks.js` — it only returns strings the app hands to the engine, so
no new coupling is introduced.

## Origin: the faction's seat

The hook radiates from **`holdings[0]`** (always a placed hex — holdings are only ever placed/claimed/
roamed-to placed hexes). Because `hooks.js`'s `pickSubject` already weights candidate POIs by
proximity to the origin, using the seat as origin makes a faction's trouble land on **places near it**
(often its own holdings) for free — no extra targeting code.

## Wiring (`app.js`) — reuse `onGenerateHook`, don't fork it

`onGenerateHook(opts)` already exists and already handles every pattern (distant/escort/chain/map/…).
Extend it with three opt fields so a faction can drive it, then add a thin wrapper:

- **`opts.origin`** — override the origin (default stays `selected`); relax the guard to
  `if (!current || (!selected && !opts.origin)) return;`.
- **`opts.verb`** — thread into the `generateHook(...)` ctx on the verb-carrying branches
  (known/distant/map). Harmless where a pattern fixes its own verb (opportunity/event/escort/chain/
  return ignore it).
- **`opts.source`** — already threaded to the local/escort/chain/map builders; **add it** to the
  known/distant/return `generateHook` ctx too (the engine takes `ctx.source`; absent → rolled, so the
  plain "Generate hook" button is unchanged).
- After the hook is built, before `push`: `if (opts.sourcePower) hook.sourcePower = opts.sourcePower;`.

```js
// "Stir up trouble" (8.11): a faction emits a normal hook from its seat, biased by
// archetype/goal and tagged back to it. Reuses onGenerateHook wholesale.
async function onStirTrouble(factionId) {
  if (!current) return;
  const faction = getFactions(current).find((f) => f.id === factionId);
  if (!faction || (faction.status || "active") !== "active") return;
  const seat = (faction.holdings || [])[0];
  if (!seat) return logLine(`${faction.name} has no holding to stir from.`);
  // Flavour picks come off a dedicated substream; the hook itself re-seeds inside
  // onGenerateHook (keyed on origin+ordinal), so both halves stay deterministic.
  const rng = subRng(current.seed, "stir", faction.id, nextHookId(current));
  const { pattern, verb, source } = factionHookContext(faction, rng);
  await onGenerateHook({ origin: { q: seat.q, r: seat.r }, forcePattern: pattern, verb, source,
                         sourcePower: faction.id });
}
```

`onGenerateHook` already jumps to the Hooks tab with the new hook selected and logs it, so a faction
hook surfaces exactly like a manual one — never a silent no-op.

## UI

- **Factions tab** (`panel.js` `factionCard`): a **"Stir up trouble"** action button per **active**
  faction (gated on `model.onStirTrouble` + a holding), wired through the factions-panel model in
  `refreshFactions()`.
- **Hooks tab** (`panel.js` hook card): when `hook.sourcePower` is set, show a small
  **"Stirred up by <faction name>"** line with a jump-to-faction link — resolved via a
  `factionNameById` + `onCenterFaction` callback added to the hooks-panel model (both already exist on
  the Detail model, so it's the same idiom). This keeps `hooks.js` engine-pure (the name lookup lives
  in the app/panel layer, not in `hookDescription`).

## Files

| File | Change |
|---|---|
| `js/gen/factions.js` | `FACTION_HOOK_BIAS` + `GOAL_RUMOUR` consts; export pure `factionHookContext(faction, rng)` |
| `js/ui/app.js` | extend `onGenerateHook(opts)` (origin/verb/source/sourcePower threading); add `onStirTrouble`; add it to the factions-panel model; add `factionNameById`/`onCenterFaction` to the hooks-panel model |
| `js/ui/panel.js` | `factionCard` "Stir up trouble" button; hook card "Stirred up by …" tag when `hook.sourcePower` |
| `test/factions.test.js` | `factionHookContext` tests (bias membership, goal→rumour, unknown-archetype passthrough, determinism) |

`hooks.js` is **not touched** — the engine stays exactly as-is (the plan's "unchanged engine"
requirement).

## Tests (`node --test`, pure logic only)

- **archetype bias** — for each mapped archetype, `factionHookContext` returns a `pattern` in that
  archetype's `patterns` and a `verb` in its `verbs`.
- **unknown archetype** — `pattern`/`verb` come back `undefined` (engine rolls freely).
- **goal → rumour** — a known goal maps to its `GOAL_RUMOUR` string; an unmapped/absent goal → `source`
  undefined.
- **determinism** — same faction + same seeded rng sequence → identical `{pattern, verb, source}`.

(The `sourcePower` stamping + reuse of `onGenerateHook` live in the UI layer; the hook it produces is
already covered by `hooks.test.js`. The node-testable seam is `factionHookContext`.)

## Manual checklist (`./run-local.sh`)

```
[ ] "Stir up trouble" on an active faction (Factions tab) → a new hook appears on the Hooks tab,
    tagged "Stirred up by <faction>", pointing at a place near the faction's seat
[ ] A bandits / monstrous-tribe faction reads as a threat/warning; a merchant guild as trade/errand
[ ] The "Stirred up by <faction>" link on the hook centres the map on that faction's holding
[ ] Stir twice from the same faction → two different hooks (successive ordinals differ)
[ ] Reload, then Export → Import → the hook keeps its sourcePower tag (still schema v16)
```

## Out of scope (the rest of Phase 8, each its own sub-plan)

- **8.12 — auto-fire hooks on the day-tick.** In the `advanceDays` chokepoint, a small per-day chance
  **scaled by proximity × faction `strength`** ("news propagation by distance") emits a hook with **no
  button press**. This is where `strength` — frozen as a stable value in 8.13 — is finally read. It
  reuses 8.11's `factionHookContext` + the `sourcePower` tag; only the *trigger* is new.
- **Region hook** — the leftover half of the old 8.13 stretch: a region-wide "something is stirring"
  area-hook (not pinned to one target POI). Confirm shape when 8.12 lands; may slip to a later phase.
- **Contested/again:** no faction-vs-faction hook interplay here — one faction, one hook, one press.
