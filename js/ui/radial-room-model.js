// Pure model for the dungeon-room right-click radial (Phase 7.2 Step 3).
//
// Same node shape as radial-model.js, so the shared overlay (radial-menu.js)
// renders it. Fixed slots in a fixed order; "Take stairs" greys out (rather than
// disappearing) when the room has no stair links — matching the world-map menu's
// disabled-not-hidden rule. No DOM, no app state → node-tested.

const leaf = (id, glyph, label, opts = {}) => ({
  kind: "leaf", id, glyph, label,
  enabled: opts.enabled !== false,
  reason: opts.reason, value: opts.value, title: opts.title, on: opts.on,
});

const submenu = (id, glyph, label, opts = {}, children = []) => ({
  kind: "submenu", id, glyph, label,
  enabled: opts.enabled !== false, reason: opts.reason, children,
});

/**
 * Build the fixed-slot room menu.
 * @param {object} state
 *   explored,cleared,looted {boolean} current room flags (shown as active toggles)
 *   connections {{label:string,toLevel:number,toRoom:number}[]} stair links
 * @returns {object[]} slots, always in this order.
 */
export function buildRoomRadialModel(state) {
  const { explored = false, cleared = false, looted = false, connections = [] } = state || {};
  const stairs = connections.map((c) =>
    leaf("goTo", "🪜", `L${c.toLevel + 1}`, { value: { level: c.toLevel, room: c.toRoom }, title: c.label }),
  );
  return [
    leaf("toggle", "•", "Explored", { value: "explored", on: explored }),
    leaf("toggle", "✓", "Cleared", { value: "cleared", on: cleared }),
    leaf("toggle", "$", "Looted", { value: "looted", on: looted }),
    submenu("stairs", "🪜", "Take stairs",
      connections.length ? {} : { enabled: false, reason: "No stairs in this room" }, stairs),
    leaf("focus", "🎯", "Center", {}),
  ];
}
