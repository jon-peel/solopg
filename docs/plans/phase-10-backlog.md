# Phase 10 — Backlog

Everything confirmed-but-not-yet-scheduled: the QoL/UX items that used to live under "Phase 7
backlog (7.7+)" (renumbered here now that Phase 7 itself is done — see `PLAN.md`), plus the
previously-unnumbered ideas (party position marker, art, misc). Listed roughly in the order we'd
tackle them — small, self-contained wins first, larger commitments last. Each is **📋 planned**;
none has a detailed sub-plan yet (write one when it's picked up).

**Renumbering note:** old 7.9 (POI dot polish) shipped — see
[phase-7.9-poi-dot-polish.md](phase-7.9-poi-dot-polish.md). Old 7.14 (radial right-click steps
back) shipped earlier, folded into the 3R water-polish work — see the `PLAN.md` status log. Neither
carries forward here.

**Dropped, not carried forward:** ~~user-editable / custom in-app tables~~ — de-scoped (little
value for how this tool is used). The generator tables stay JSON-on-disk.

| # | Item | Size | One-liner |
|---|---|---|---|
| 10.1 | **Search / jump-to** | S–M | Find a hex, POI, or hook by name/note; centre the map on the hit. Closes the loop on the 7.5 notes/labels work. |
| 10.2 | **Radial keyboard & touch parity** | M | Long-press to open the ring; arrow-to-rotate + Enter to pick; maybe number keys. Accessibility + tablet play. |
| 10.3 | **Hooks tab pop-out** | S–M | Float the hooks list into its own window (panel-tabs mockup "D"). Low priority — the tabs already work. |
| 10.4 | **Undo / redo** | M | History for destructive actions (Delete hex, Regenerate, Remove POI/settlement) — the radial put these one click away. Snapshot- or command-history based. |
| 10.5 | **Print / GM-screen view** | M | A clean read-only / printable layout of the current hex or dungeon for at-the-table use. |
| 10.6 | **Themes** | M | Light/dark and colour-blind-friendly palettes. Lower urgency since 7.2's content glyphs already helped colour-blind readability. |
| ~~10.7~~ | ~~**Party position marker**~~ | — | ✅ **Done — shipped in Phase 8.1** (party marker) + **8.4** (travel rules that unblocked it). See [phase-8.1-world-clock-party-marker.md](phase-8.1-world-clock-party-marker.md). |
| 10.8 | **Art** | L | Pencil sketches for POIs; optional "full painted hex"; eventual "pencil-drawn" refinement of tiles; optional 3rd terrain variant; an `svg-tile` authoring skill for consistency. |
| 10.9 | **Misc** | S | Allow a manual settlement on Lake/Sea (currently disallowed); more terrain types. |

## Notes per item

- **10.1 Search** — a filter box (command bar or panel) over `world.hexes` (name/note),
  `pois[].name`, and `world.hooks[]`; results list → click centres via the existing
  `recenterOn`. Pure match logic can be node-tested; wiring is UI.
- **10.2 Radial kbd/touch** — deferred explicitly in `phase-7.1-radial-menu.md`
  ("Deliberate simplifications"). The side panel remains the full accessible path
  until this lands.
- **10.4 Undo** — decide granularity (per-action snapshots of the affected hex vs a
  world-level command log). Interacts with persistence (`saveWorld`) and the radial
  dispatch table in `app.js`.
- **10.6 Themes** — CSS custom-property palette swap; the map canvas reads a handful
  of colours from `terrain-style.js` / dungeon-map constants, so a theme layer needs
  those to become configurable.
- **10.7 Party position marker** — ✅ **done.** Shipped in Phase 8.1 (a single `world.party`
  marker) and unblocked/extended by Phase 8.4's travel rules — no longer a backlog item.

## Recommended sequence

Phase 10 itself comes **after Phase 8 (Factions) and Phase 9 (small oracles)** in the roadmap's
fixed work order (8 → 9 → 10 — see `PLAN.md` Roadmap & status). Within Phase 10, once reached:
10.1 → 10.4 → 10.2 → 10.5 → 10.6 → 10.3. 10.7 stays blocked until travel rules exist; 10.8/10.9 are
opportunistic within this phase, pick up any time after 10.1–10.6/10.3.
