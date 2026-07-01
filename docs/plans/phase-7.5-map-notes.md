# Phase 7.5 — Map notes & labels

Give the GM somewhere to record what a place *is*: a custom **name** and freeform
**notes** per hex. Browser-side editing; the name doubles as a map label.

**Status:** ✅ done. **Schema bumped to v7** (additive `hex.name` / `hex.note`).

## What it does

- The **Detail tab** of a placed hex gains a **Notes** section: a *Name this hex…*
  input and a *Notes…* textarea (both commit on blur/Enter). These are the only
  editable fields in the otherwise read-only panel.
- A named hex shows its **name as a label** on the map (a small pill below the
  hex, at the detail zoom tier).
- Empty (unplaced) cells have no Notes section — annotations live on a real hex.
- Everything **persists** (IndexedDB) and **round-trips** through export/import.

## How it's built

- `js/world/world.js`: `SCHEMA_VERSION` → **7** (doc comment for the additive
  `name`/`note`).
- `js/data/portability.js`: `migrateWorld` gains a v6→v7 step — additive, so it
  just stamps the version (older hexes default to no name/note).
- `js/ui/app.js`: `onRenameHex` (persists + re-renders so the map label updates)
  and `onNoteHex` (persists only — a note has no map presence, so it keeps focus),
  both acting on the selected placed hex; passed to `renderSelectionPanel`.
- `js/ui/panel.js`: `renderHexNotes` builds the Name input + Notes textarea
  (reusing `.room-note`).
- `js/ui/map.js`: `drawHexLabel` renders `hex.name` as a pill below the hex in
  the detail tier.
- `css/app.css`: `.hex-name`.

Tests: `test/migration.test.js` adds a v6→v7 stamp test and a name/note
export/import round-trip. Verified headless: fields appear for a placed hex (not
empty cells), the name renders as a map label, and both persist across reload.
**204 `node --test` passing.**

## Possible follow-ups

- ~~A **Labels on/off** toggle in the command bar (like Icons).~~ **Done (7.6).**
- ~~Allow naming/annotating an **empty** cell (would need a placeholder hex).~~
  **Done:** empty cells are annotated via a lazily-created `placed:false` hex
  that's pruned again when name+note are both cleared.
- ~~A 🗒 indicator on hexes that have a note.~~ **Done:** placed hexes and
  annotated empty cells both show a 🗒 badge on the map.
