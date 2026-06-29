# Phase 7.2 — Dungeon View UX

**Goal.** Carry the world-map UX improvements into the Dungeon View and close
its interaction/wayfinding gaps. Browser-only (no schema change); the layout
math stays in the tested generator.

Stepwise, each its own commit + manual checklist:

| Step | What | Status |
|---|---|---|
| 1 | Wayfinding: `Esc` exits; `[`/`]` (+ PgUp/PgDn) switch levels; auto-center a selected/target room that lands off-screen | ✅ done |
| 2 | At-a-glance room markers: 💰 on rooms with treasure (content glyphs deferred) | ✅ done |
| 3 | Room right-click radial (Explored/Cleared/Looted/Take-stairs/Center) — **reuses the config-driven radial overlay** so the world-map ring keeps working | ✅ done |
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

## Step 3 (done) — room radial via a shared overlay

The ring overlay (`radial-menu.js`) is now **context-agnostic**: callers pass a
`model` (slot nodes) + a `dispatch(id, value)`. Two pure models feed it:

- `radial-model.js` → world-map menu (8 slots).
- `radial-room-model.js` → dungeon-room menu (5 fixed slots): **Explored /
  Cleared / Looted** (toggles, showing the current state via an `on` flag),
  **Take stairs ▸** (greyed with a reason when the room has no links — same
  disabled-not-hidden rule), and **Center** (force-centres the room).

Refactor to make the overlay generic: `danger` and `on` are now **model flags**
on a node (was a hardcoded id check); `isRadialOpen()` is exported so the
Dungeon View's key handler defers to the ring (Esc closes the ring instead of
exiting the dungeon). Right-click on the dungeon canvas resolves the room
(`roomAtPointer`) and reports it; `pointerdown` pans on the primary button only.

Touches: `js/ui/radial-menu.js` (generic flags + `isRadialOpen`),
`js/ui/radial-model.js` (`danger` flags), `js/ui/radial-room-model.js` (new,
node-tested), `js/ui/dungeon-map.js` (contextmenu + `roomAtPointer` + button
gate + `centerOnRoom(force)`), `js/ui/app.js` (room ctx-menu + dispatch + key
deferral), `css/app.css` (`.ring-node.on`). Verified headless: **both** rings —
world map (8 slots, dispatch, danger) and room (5 slots, Cleared toggle
round-trips, Esc closes ring without leaving the dungeon).
