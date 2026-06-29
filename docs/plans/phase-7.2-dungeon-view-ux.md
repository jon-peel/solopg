# Phase 7.2 — Dungeon View UX

**Goal.** Carry the world-map UX improvements into the Dungeon View and close
its interaction/wayfinding gaps. Browser-only (no schema change); the layout
math stays in the tested generator.

Stepwise, each its own commit + manual checklist:

| Step | What | Status |
|---|---|---|
| 1 | Wayfinding: `Esc` exits; `[`/`]` (+ PgUp/PgDn) switch levels; auto-center a selected/target room that lands off-screen | ✅ done |
| 2 | At-a-glance room markers: 💰 on rooms with treasure (content glyphs deferred) | ✅ done |
| 3 | Room right-click radial (Explored/Cleared/Looted/Take-stairs/Focus) — **reuses an extracted, config-driven radial submodule** so the world-map ring keeps working | ◻ |
| 4 | Progress & switcher polish: "Cleared X/Y", level theme on the switcher, mark levels with unexplored rooms | ◻ |

## Step 1 (done)

- **`Esc`** leaves the dungeon view (was only the ← World button).
- **`[` / `]`** and **PageUp / PageDown** switch level (by switcher index;
  ignored while typing in the room-note field, inert outside the view).
- **`centerOnRoom(n)`** (`dungeon-map.js`): pans a selected/target room into view
  *only if it's off-screen*, keeping zoom — so clicking a visible room never
  yanks the camera, but landing on a room via stairs/level-switch while zoomed in
  no longer leaves it out of frame. Called from `onRoomClick`.
- Toolbar tooltips note the new keys.

Touches: `js/ui/dungeon-map.js` (centerOnRoom), `js/ui/app.js` (onDungeonKey +
wiring, onRoomClick), `index.html` (tooltips). Verified headless: 3-level dungeon
nav `]`→L1 `[`→L0, room click OK, Esc hides the view, no errors.

## Step 2 (done)

- **💰 marker** on rooms with `room.treasure`, drawn in the room's **bottom-left**
  corner (the other three are taken: connectors TL, lamp TR, exploration state
  BR). Matches the panel's and hex-summary's 💰. Legend updated.
- Content glyphs (monster/trap icons) **deferred** — content is already
  colour-coded and the corners are busy; offered to revisit if wanted.

Touches: `js/ui/dungeon-map.js` (treasure pass), `index.html` (legend). Verified
headless: 6-level dungeon renders with treasure present and no errors.

## Note for Step 3

Extract the ring into a reusable submodule (the overlay mechanics + a passed-in
model + a `dispatch`), so both the world-map menu and the new dungeon-room menu
share it. Test **both** rings after the refactor to confirm the existing one
still works.
