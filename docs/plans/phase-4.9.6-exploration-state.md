# Sub-plan 4.9.6 — Exploration state & GM notes

Part of [Phase 4.9](phase-4.9-dungeon-connectivity.md). The record-keeping payoff: mark rooms
**explored / cleared / looted** and attach a **per-room note**, shown on the map and persisted.

## Key decision: state lives SEPARATELY from generated content
The dungeon interior (`poi.detail.dungeon`) is **regenerated** whenever `DUNGEON_BUILD` bumps (our
self-heal). So play-state must NOT live on the generated rooms or every refinement would erase it.
Instead it lives in `poi.detail.dungeonState`, keyed by level+room, untouched by regeneration:
```js
poi.detail.dungeonState = {
  rooms: { "0:3": { explored:true, cleared:true, looted:false, note:"trapped chest" }, ... }
}
```
(No `DUNGEON_BUILD` bump, no schema bump — `dungeonState` is additive user data.)

## Pure state module (node-tested) — `js/world/dungeon-state.js`
- `stateKey(level, room)` → `"level:room"`.
- `getRoomState(state, level, room)` → the entry or a default `{explored,cleared,looted:false, note:""}`.
- `withRoomState(state, level, room, patch)` → a NEW state with that room merged (immutable).
Tests: toggles flip; unrelated rooms untouched; JSON round-trips.

## UI
- **Panel** (`js/ui/panel.js` `renderDungeonPanel`): under a clicked room, add **Explored / Cleared
  / Looted** toggle buttons (pressed state styled) and a **note** text input that saves on change.
  Needs `roomState`, `onToggle(field)`, `onNote(text)` in the model.
- **Map** (`js/ui/dungeon-map.js`): bottom-right state badges per room — explored **•** (cyan),
  cleared **✓** (green), looted **$** (amber); a cleared room is also dimmed. Passed via
  `marks.state[roomN]`.
- **App** (`js/ui/app.js`): read/write `poi.detail.dungeonState` via the pure helpers, persist
  (`persistAndRefresh`-style save), and re-render the level + panel on change. Build the per-level
  `marks.state` for the renderer.

*(Secret-door "reveal" is now moot on the GM map — secrets are already shown; a player-facing hide/
reveal belongs to a future player view, deferred.)*

## Files
- New `js/world/dungeon-state.js`, `test/dungeon-state.test.js`.
- Edit `js/ui/app.js`, `js/ui/panel.js`, `js/ui/dungeon-map.js`, `css/app.css` (toggle/badge styling).

## Verification
- **Automated:** `node --test` — state module transitions + round-trip; all prior suites green.
- **Manual checklist — "4.9.6 — Exploration state & GM notes" (`./run-local.sh`):**
```
[ ] Click a room → Explored / Cleared / Looted toggles + a note field appear
[ ] Toggle Cleared → room dims + green ✓ on the map; Looted → $ badge; Explored → • badge
[ ] Type a note → it sticks when you click away and come back to the room
[ ] Reload → all room states + notes persist
[ ] Regenerate the hex's dungeon (or a future build bump) → the MAP changes but your
    states/notes for that dungeon are preserved (kept separate from generated content)
```
