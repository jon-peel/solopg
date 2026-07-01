# Phase 7 — remaining backlog (7.7+)

Confirmed-but-not-yet-built QoL/UX items, so they can be picked up later. 7.1–7.6
are done (see their own docs). Listed roughly in the order we'd tackle them —
small, self-contained wins first, larger commitments last. Each is **📋 planned**;
none has a detailed sub-plan yet (write one when it's picked up).

**Dropped from Phase 7:** ~~user-editable / custom in-app tables~~ — de-scoped
(little value for how this tool is used). The generator tables stay JSON-on-disk.

| # | Item | Size | One-liner |
|---|---|---|---|
| 7.7 | **Search / jump-to** | S–M | Find a hex, POI, or hook by name/note; centre the map on the hit. Closes the loop on the 7.5 notes/labels work. |
| 7.8 | **Radial keyboard & touch parity** | M | Long-press to open the ring; arrow-to-rotate + Enter to pick; maybe number keys. Accessibility + tablet play. |
| 7.9 | **POI zoomed-out dot polish** | S | The far-zoom red POI dot becomes a count and/or recolours by type, so a busy hex reads at a glance. |
| 7.10 | **Hooks tab pop-out** | S–M | Float the hooks list into its own window (panel-tabs mockup "D"). Low priority — the tabs already work. |
| 7.11 | **Undo / redo** | M | History for destructive actions (Delete hex, Regenerate, Remove POI/settlement) — the radial put these one click away. Snapshot- or command-history based. |
| 7.12 | **Print / GM-screen view** | M | A clean read-only / printable layout of the current hex or dungeon for at-the-table use. |
| 7.13 | **Themes** | M | Light/dark and colour-blind-friendly palettes. Lower urgency since 7.2's content glyphs already helped colour-blind readability. |

## Notes per item

- **7.7 Search** — a filter box (command bar or panel) over `world.hexes` (name/note),
  `pois[].name`, and `world.hooks[]`; results list → click centres via the existing
  `recenterOn`. Pure match logic can be node-tested; wiring is UI.
- **7.8 Radial kbd/touch** — deferred explicitly in `phase-7.1-radial-menu.md`
  ("Deliberate simplifications"). The side panel remains the full accessible path
  until this lands.
- **7.11 Undo** — decide granularity (per-action snapshots of the affected hex vs a
  world-level command log). Interacts with persistence (`saveWorld`) and the radial
  dispatch table in `app.js`.
- **7.13 Themes** — CSS custom-property palette swap; the map canvas reads a handful
  of colours from `terrain-style.js` / dungeon-map constants, so a theme layer needs
  those to become configurable.

## Recommended sequence

7.7 → 7.11 → 7.9 → 7.8 → 7.12 → 7.13 → 7.10, interleaving with **Phase 3R**
(world-coherence) as desired — the two touch disjoint code (UI vs generator).
