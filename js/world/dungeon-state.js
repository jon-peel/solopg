// Per-dungeon exploration state & GM notes (Phase 4.9.6).
//
// Kept SEPARATE from the generated dungeon interior (poi.detail.dungeon), which
// is regenerated whenever DUNGEON_BUILD changes. This state lives at
// poi.detail.dungeonState and survives regeneration. Pure + immutable so it's
// node-testable; the UI reads/writes it and persists the world as usual.

/** Map key for a room on a level. */
export function stateKey(level, room) {
  return `${level}:${room}`;
}

const DEFAULT = { explored: false, cleared: false, looted: false, note: "" };

/**
 * The state for one room, or a default (never throws on missing state).
 * @param {object|undefined} state poi.detail.dungeonState
 */
export function getRoomState(state, level, room) {
  const r = state && state.rooms && state.rooms[stateKey(level, room)];
  return r ? { ...DEFAULT, ...r } : { ...DEFAULT };
}

/**
 * Return a NEW dungeonState with `patch` merged into one room's state. Never
 * mutates the input.
 * @returns {{rooms: object}}
 */
export function withRoomState(state, level, room, patch) {
  const rooms = { ...(state && state.rooms) };
  rooms[stateKey(level, room)] = { ...getRoomState(state, level, room), ...patch };
  return { ...(state || {}), rooms };
}

/** True if a room carries any non-default state (for badge rendering, etc.). */
export function hasRoomState(state, level, room) {
  const s = getRoomState(state, level, room);
  return s.explored || s.cleared || s.looted || !!s.note;
}
