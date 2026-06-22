# Sub-plan 4.9.7 — Dungeon View polish (legend + pan/zoom)

Closes the [Phase 4.9](phase-4.9-dungeon-connectivity.md) sub-project. Two readability wins for the
Dungeon View:

1. **Legend** — a toggleable key explaining the map symbols, so nothing needs memorising.
2. **Pan & zoom + Fit** — Sprawling levels (11–14 rooms) render tiny; let the user drag to pan,
   wheel to zoom (to the cursor), and a **Fit** button to reset.

## Design
### Pan/zoom (`js/ui/dungeon-map.js`)
- Add a `camera = { scale:1, x:0, y:0 }` applied as a canvas transform on top of the existing
  fit-to-view base: `setTransform(dpr…)` → `translate(camera.x,camera.y)` → `scale(camera.scale)`,
  then draw with the fitted `baseCell`/origin as today. Room hit-test inverse-transforms the click
  (`(px-camera.x)/scale`) against fitted `hitRects`.
- **Drag to pan** (pointer move past a small threshold = drag, else click), **wheel to zoom** about
  the cursor (clamped ~0.5×–6×). `setLevel` resets the camera (re-fit on level change). Export
  `fitView()` for the toolbar button.
- Text/badges scale with zoom (drawn under the transform) — so the tiny-cell symbol problem goes
  away when you zoom in.

### Legend (`index.html`, `css/app.css`, `js/ui/app.js`)
- A `Legend` toggle button + a `Fit` button in `#dungeon-toolbar`; a hidden legend panel
  (absolute-positioned in `#dungeon-view`) listing: room content colours (Monster/Trap/Empty/
  Special), doors (door / L locked / J stuck / S secret), connectors (E entrance, X exit, ▲/▼
  stairs, "Shaft" via the panel), and state (• explored, ✓ cleared, $ looted). Toggle shows/hides it.

## Files
- `js/ui/dungeon-map.js` (camera + input + `fitView`), `index.html` (toolbar buttons + legend),
  `css/app.css` (legend + buttons), `js/ui/app.js` (wire Fit/Legend; reset legend on close).

## Out of this step (offered as quick follow-ups)
- **Reroll dungeon** (a button bumping a per-POI gen counter to regenerate + clear state).
- **Enter a dungeon by clicking its glyph on the hex map** (needs POI hit-testing in `map.js`).
- Monster stat detail (out of scope — system-agnostic, no stat blocks).

## Verification
- **Automated:** `node --test` stays green (no new pure logic).
- **Manual checklist — "4.9.7 — Dungeon View polish" (`./run-local.sh`):**
```
[ ] Open a Sprawling dungeon → drag to pan, mouse-wheel to zoom (zooms toward the cursor);
    symbols/text get bigger when zoomed in
[ ] "Fit" button re-centres/zooms the whole level to the view
[ ] Switching levels (L1/L2/…) re-fits automatically
[ ] Clicking a room still selects it correctly after panning/zooming
[ ] "Legend" toggles a key explaining room colours, doors (L/J/S), E/X/▲/▼, and •/✓/$
[ ] "← World" still returns to the hex map
```
