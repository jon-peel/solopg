# Phase 8.6 — Progress N days (stationary)

Last step of Arc A. A control to advance the world clock **without moving** — for when the party
sits still (resting, waiting out a siege, holding a position). This is the clock other systems will
key off: 8.10 faction turns and 8.12 auto-hooks both fire as days pass.

> Plan → approve → build → `node --test` → commit/push → manual checklist.

## Adapted to the session-only clock (user decision, 8.1)

The phase doc originally proposed `advanceDays(world, n)` bumping a persisted `world.day`. But the
clock was made **session-only** (an in-memory `sessionDay` in `app.js`, never persisted — always
starts at 0 on load, per the 8.1 steer). So there's no `world.day` to mutate and nothing pure to
unit-test here. Instead:

- **`advanceDays(n)` becomes the single day-advance chokepoint in `app.js`.** It bumps `sessionDay`
  and refreshes the readout. **Travel** (which already advanced the day inline) is refactored to call
  it too, so there's **one** place where a day passes — exactly the seam 8.10/8.12 need. For now it
  only increments; a comment marks where faction turns / auto-hooks will hook in.

## UI

A compact **Progress** control next to the "Day N" readout in the command bar (per the phase doc —
"a small numeric Progress control next to the Day readout"): a small number input (default 1) + a
button. Pressing it (or Enter in the input) advances the clock by that many days. No movement, no
world mutation, no persistence (the day is session-only) — just the counter and readout move.

## Files
- `index.html` — the Progress input + button beside `#day-readout`.
- `css/app.css` — a narrow number input style.
- `js/ui/app.js` — `advanceDays(n)` chokepoint; refactor `applyTravel` to call it; `onProgressDays`
  handler + wiring (click + Enter).

No schema change, no new pure logic, so **no node tests** (the increment is trivial and app-only —
consistent with the master plan's "browser-verified UI" convention). The existing 358 tests must
stay green.

## Verification (manual, via `./run-local.sh`)
```
8.6 [ ] "Progress 5" → the Day readout jumps by 5; the party does not move
    [ ] Travelling a day still advances the Day readout by 1 (same clock, one chokepoint)
    [ ] Reload → Day resets to 0 (session-only, by design)
```
