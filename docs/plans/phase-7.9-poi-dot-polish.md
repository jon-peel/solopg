# Phase 7.9 — POI zoomed-out dot polish

Make the far-zoom POI marker read at a glance instead of every hex with any
POI showing the same red dot. Browser-only; no schema change.

**Status:** ✅ done.

## What changed

- **Colour by type** — a hex with exactly one POI shows its far-zoom dot in a
  type colour (dungeon red, shrine violet, camp orange, landmark teal, tower
  brown) instead of the previous flat red.
- **Count when several** — a hex with more than one POI shows a slightly
  larger neutral dark dot with the count as white text, so a busy hex reads
  as "has several" without decoding colours.
- **Legend** — the map legend (🗺 button) gained a "Points of interest"
  section built from the same colour table, so the key can't drift from the
  renderer.

## How it's built

- `js/ui/poi-style.js`: `POI_DOT_COLORS` (type → colour) + `poiDotColor(type)`
  (falls back to the dungeon red for unknown/legacy types).
- `js/ui/map.js`: `drawSimplifiedMarkers` reads `poiDotColor` for a single POI,
  or draws the neutral count dot for several.
- `js/ui/app.js`: `buildLegendPoi()` (called from `buildLegendTerrain`) renders
  the legend rows from `POI_DOT_COLORS`/`POI_GLYPHS`.
- `index.html`: `#legend-poi` section host.

Verified: `node --test` (299 passing, unchanged — this is UI-only, no new pure
logic). Manual browser check: place several POI types across hexes, zoom out
past the detail tier, confirm dot colours match type and a 2+ POI hex shows a
numbered dot; open the legend and confirm the new section matches.
