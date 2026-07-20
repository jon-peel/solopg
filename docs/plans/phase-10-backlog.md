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
| ~~10.2~~ | ~~**Radial keyboard & touch parity**~~ | — | ✅ **Done — folded into Phase 11.** Long-press to open the ring + pinch/drag on touch (11.7); arrow-to-rotate + Enter/Space to pick, Esc to step back, with ARIA (11.8). See [phase-11-visual-overhaul.md](phase-11-visual-overhaul.md). |
| 10.3 | **Hooks tab pop-out** | S–M | Float the hooks list into its own window (panel-tabs mockup "D"). Low priority — the tabs already work. |
| 10.4 | **Undo / redo** | M | History for destructive actions (Delete hex, Regenerate, Remove POI/settlement) — the radial put these one click away. Snapshot- or command-history based. |
| 10.5 | **Print / GM-screen view** | M | A clean read-only / printable layout of the current hex or dungeon for at-the-table use. |
| ~~10.6~~ | ~~**Themes**~~ | — | ◐ **Folded into Phase 11.** The re-skin delivered one cohesive parchment theme on a single-source token system (`js/ui/theme.js`) with colour-blind-safe faction hatching + contrast-audited tokens (11.1/11.4/11.8). A *user-selectable* light/dark switcher was **not** built — it can return as a small item on top of the tokens if wanted. |
| ~~10.7~~ | ~~**Party position marker**~~ | — | ✅ **Done — shipped in Phase 8.1** (party marker) + **8.4** (travel rules that unblocked it). See [phase-8.1-world-clock-party-marker.md](phase-8.1-world-clock-party-marker.md). |
| ~~10.8~~ | ~~**Art**~~ | (partial) | ◐ **Partly folded into Phase 11.** Parchment terrain tiles + inked hex borders (11.2) and the inked dungeon restyle (11.6) shipped. Still open: POI pencil sketches, an optional "full painted hex", and an `svg-tile` authoring skill for consistency. |
| 10.9 | **Misc** | S | Allow a manual settlement on Lake/Sea (currently disallowed); more terrain types. |

## Notes per item

- **10.1 Search** — a filter box (command bar or panel) over `world.hexes` (name/note),
  `pois[].name`, and `world.hooks[]`; results list → click centres via the existing
  `recenterOn`. Pure match logic can be node-tested; wiring is UI.
- **10.2 Radial kbd/touch** — ✅ **done in Phase 11** (11.7 touch, 11.8 keyboard + ARIA).
  Deferred originally in `phase-7.1-radial-menu.md` ("Deliberate simplifications"); the radial is
  now fully reachable by keyboard, right-click, long-press, and the "⋯ Actions" button.
- **10.4 Undo** — decide granularity (per-action snapshots of the affected hex vs a
  world-level command log). Interacts with persistence (`saveWorld`) and the radial
  dispatch table in `app.js`.
- **10.6 Themes** — ◐ **folded into Phase 11.** The token layer this note asked for now exists:
  `js/ui/theme.js` is the single source for both canvas and DOM colours, so the map no longer reads
  magic hex strings. A user-facing light/dark *switcher* on top of those tokens was not built and can
  return as a small follow-up.
- **10.7 Party position marker** — ✅ **done.** Shipped in Phase 8.1 (a single `world.party`
  marker) and unblocked/extended by Phase 8.4's travel rules — no longer a backlog item.

## Recommended sequence

Phase 10 itself comes **after Phase 9 (small oracles)** in the roadmap's fixed work order
(9 → 10 — see `PLAN.md` Roadmap & status). Several rows are already resolved: **10.2** and
**10.7** are done, and **10.6 / 10.8** are folded into Phase 11 (see the table). Of what remains,
within Phase 10 once reached: 10.1 → 10.4 → 10.5 → 10.3, with 10.9 opportunistic.
