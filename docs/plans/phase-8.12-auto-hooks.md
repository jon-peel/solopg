# Phase 8.12 — Auto-fire faction hooks on the day-tick

The last of Arc C's committed steps. 8.11 gave the GM a **button** to make a faction stir trouble; 8.12
makes it happen **on its own as days pass** — "news propagation by distance": a nearby, powerful
faction's deeds are common gossip; a distant or weak one, a rare whisper. This is where **`strength`**
(frozen as a stable value back in 8.13) is finally read.

Nothing about the *hook* changes — 8.12 reuses 8.11 wholesale (the lair-pointing threat, the deed
table, the `sourcePower` tag). **Only the trigger is new.**

**Status:** 📝 planned.

> Plan → approve → build → `node --test` → commit/push → manual checklist.

## No schema bump

Auto-hooks are ordinary hooks pushed to `world.hooks[]` (already persisted). `SCHEMA_VERSION` stays 16.

## Where it fires

The single day-advance chokepoint, `advanceDays(n)` (travel + "Progress N days" both route through it —
the seam 8.10 already uses). After faction turns fire, roll auto-hooks for the elapsed days, then the
existing caller persists. `advanceDays` becomes **async** (emission loads tables + pushes hooks); its
two callers (`onProgressDays`, `applyTravel`) already `await persistAndRefresh()` right after, so they
just `await advanceDays(...)` first.

## The probability model (a rule → JS const, tunable)

Per **active** faction, per day, a chance its deeds reach the party — louder + nearer ⇒ likelier:

```js
const AUTO_HOOK_BASE = 0.02;  // per strength-point per day, at the party's doorstep
const AUTO_HOOK_MAX  = 0.20;  // cap: even a strong neighbour isn't a firehose
const AUTO_HOOK_CAP  = 2;     // most auto-hooks one advance can spawn per faction

// distance = party → the faction's lair (holdings[0]); strength = 2..4.
export function autoHookChance(faction, party) {
  if (!faction || (faction.status||"active")!=="active") return 0;
  const lair = (faction.holdings||[])[0];
  if (!lair || !party) return 0;
  const dist = axialDistance(party.q, party.r, lair.q, lair.r);
  return Math.min(AUTO_HOOK_BASE * (faction.strength||1) / (1 + dist), AUTO_HOOK_MAX);
}
```

Rolled once per elapsed day over an advance of `n` days, capped:

```js
export function rollAutoHookCount(faction, party, days, rng) {
  const chance = autoHookChance(faction, party);
  if (chance <= 0 || !(days >= 1)) return 0;
  let count = 0;
  for (let i = 0; i < days; i++) if (rng() < chance) count++;
  return Math.min(count, AUTO_HOOK_CAP);
}
```

Feel (tunable after play): a **strength-4 faction the party is standing on** ≈ 8%/day (~1 per ~12 days);
**5 hexes off** ≈ 1.3%/day (a rare whisper); a **strength-2 faction 10 hexes away** ≈ near-silent.

### Determinism / the session-only clock
The day counter is session-only (not persisted), so the roll is seeded on the **session day**:
`subRng(seed, "autohook", faction.id, absoluteDay)` per day. Reproducible **within** a session; across a
reload the day resets — but every fired hook is already **persisted** in `world.hooks[]`, so nothing is
lost or silently regenerated differently. This is the same trade the session-only clock made in 8.1/8.10
and is consistent with it. (A reload + re-progress can roll fresh — acceptable, matches the clock model.)

## Emission — factor 8.11 so both paths share it

Extract the hook-building half of `onStirTrouble` into `buildFactionHook(faction, tables, ordinal)`
(returns a hook: nearest-settlement origin + lair subject + `factionHookContext` + `generateHook`,
tagged `sourcePower`). Then:
- **Manual (8.11 button):** `buildFactionHook` → push → jump to Hooks tab + `persistAndRefresh` (the UI
  niceties stay).
- **Auto (8.12):** in `advanceDays`, for each active faction, `rollAutoHookCount` → build that many
  (recomputing `ordinal` from the growing list so seeds differ) → push **silently** (no tab-jump); the
  caller's single `persistAndRefresh` saves them. Each logs a quiet line: *"Word reaches you: ‹hook›."*

Tables: a small `FACTION_HOOK_TABLE_IDS = ["faction-deed","hook-source","hook-patron","hook-reward"]`
(all a threat needs once the deed/source are supplied and the menace comes from the subject).

## Build chunks (test after each)

| Chunk | Change | How you test it |
|---|---|---|
| **A — core** | `autoHookChance` + `rollAutoHookCount` + consts, in `factions.js`; node tests. | `node --test test/factions.test.js` |
| **B — wire** | `buildFactionHook` extraction (manual button reuses it); `advanceDays` async + per-faction auto-roll + quiet log; callers `await`. | Browser: **Progress ~20 days** near a strong faction → hooks appear with no button press, tagged "Stirred up by ‹faction›"; far/weak factions stay quiet |

## Tests (`node --test`, pure logic only)
- `autoHookChance`: 0 for inactive / no-party / no-holding; **strictly increases** with strength and
  **decreases** with distance; never exceeds `AUTO_HOOK_MAX`.
- `rollAutoHookCount`: 0 when chance is 0; deterministic for a given rng; **capped at `AUTO_HOOK_CAP`**;
  a high-chance faction over many days fires more than a low-chance one (statistical, fixed seed).
- (Emission + `advanceDays` wiring is UI; the hook it builds is covered by `hooks.test.js`/8.11.)

## Manual checklist (`./run-local.sh`)
```
[ ] Generate a faction near where the party stands; Progress ~20 days → occasionally a hook appears
    (Hooks tab), tagged to the faction, no button pressed; the day readout advances
[ ] Move the party far from every faction, Progress ~20 days → few or none (distance falloff)
[ ] Travelling several days near a faction can also surface one (same advanceDays seam)
[ ] Reload → the auto-generated hooks are still there (persisted, v16)
```

## Out of scope
- **Region hook** ("something is stirring", area-wide) — the old 8.13 leftover; its own step / later phase.
- **Encroachment/takeover, goal-omen, per-archetype deeds** — later refinements (from the 8.11 chat).
- A GM on/off toggle for auto-hooks — add only if play wants it (not building speculatively).
