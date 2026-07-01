# Phase 7.6 — Map navigation, feedback & onboarding

Bring the world map up to the polish level of the Dungeon View and ease first use.
Browser-only; no schema change.

**Status:** ✅ done.

## What changed

**Map navigation & feedback (Theme 1)**
- **On-canvas controls** (bottom-right): `＋` / `−` zoom (about the canvas
  centre), `⌂` recenter on placed content (centroid, or origin if empty), and
  `?` help.
- **Hover highlight** — the hex under the cursor gets a subtle outline (skipped
  on the selected cell); only re-renders when the hovered hex changes.
- **Readout** (bottom-left, shown only while hovering) — the hovered hex's
  `(q, r)` + its name/terrain (or "empty").
- **Scale bar** (top-left) — a zoom-aware graphic scale marking a **day's march**
  at the **B/X / OSE travel tiers** (12 / 18 / 24 mi): solid 0–12, hollow to 18
  and 24. Redrawn when the zoom changes (`map.onView` / `pixelsPerMile()`).
  **Hovering it shows the travel rules** — miles/day by encumbrance (with the
  distance in *this world's* hexes), terrain modifiers, and forced march.
- **Screen changes dismiss the ring** — opening/closing the Dungeon View or
  switching worlds calls `closeRadial()`, so a menu can't linger over a new screen.

**Onboarding & discoverability (Theme 3)**
- **Empty-state prompt** — "Right-click anywhere to begin" centred on a fresh
  world, hidden once any hex is placed.
- **New world selects hex 0,0** and recenters there, so the GM lands ready to
  right-click.
- **🗒 note indicator** — hexes carrying a GM note show a small note badge
  (bottom-left corner), so notes are findable without selecting.
- **Cheat-sheet** — a `?` overlay (button, `?` key) listing the interactions;
  closes on Esc / Close / backdrop click.

## How it's built

- `js/ui/map.js`: `zoomStep(dir)`, `recenter()`; hover tracking on
  `pointermove` (+ `pointerleave` clear) with an `onHover` callback; the hover
  outline + note badge in `render`/`drawDetailMarkers`.
- `js/ui/app.js`: `onHover` updates the readout; `refreshMapChrome` toggles the
  empty-state + scale (called from `setCurrent`/`persistAndRefresh`); `onNewWorld`
  selects/recenters 0,0; `toggleHelp` + `onHelpKey` for the cheat-sheet; buttons
  wired in `wire()`; `onHover` passed to `attachMap`.
- `index.html` / `css/app.css`: `#map-controls`, `#map-readout`, `#map-empty`,
  `#help-overlay`.

Verified headless: new world shows the prompt + selects 0,0 + scale `⬡ 6 mi`; 4
controls; hover updates the readout; help opens/closes via button/Esc/`?`; the
prompt hides after placing a hex; no errors. 204 `node --test` passing.

## Deferred (from Theme 3, if wanted later)

- A visual scale *bar* (currently a text label).
- A Labels on/off toggle for the map name labels.
