// Pure builder for the right-click radial menu (Phase 7.1).
//
// Returns a FIXED set of slots in a FIXED order so each action always sits in
// the same angular position. Actions that don't apply to the current cell are
// kept (never hidden) but marked `enabled:false` with a `reason` — so you can
// always see what *should* be there, and why it isn't available right now
// (e.g. "Neighbours" on a fully-surrounded hex). No DOM, no app state: this is
// node-tested; radial-menu.js renders it and app.js dispatches the picks.

// Glyphs are emoji stand-ins (match the approved prototype); the canvas uses
// its own terrain/POI art — these only label the menu.
export const ACTION_GLYPH = {
  terrain: "🗺️", poi: "⭐", settlement: "🏠", hook: "🎣",
  neighbors: "🧭", regenerate: "🔄", deleteHex: "🗑️", generate: "🎲",
};
export const TERRAIN_GLYPH = {
  Forest: "🌲", Plains: "🌾", Hills: "⛰️", Mountains: "🏔️",
  Swamp: "🐊", Desert: "🏜️", Water: "🌊",
};
export const POI_GLYPH = {
  dungeon: "🏰", shrine: "⛩️", camp: "⛺", landmark: "🗿", tower: "🗼",
};

const RANDOM = "__random__";

const leaf = (id, glyph, label, { enabled = true, reason, value, anchor } = {}) =>
  ({ kind: "leaf", id, glyph, label, enabled, reason, value, anchor });

const submenu = (id, glyph, label, { enabled = true, reason } = {}, children = []) =>
  ({ kind: "submenu", id, glyph, label, enabled, reason, children });

// Terrain submenu: Random (anchored nearest the cursor) + each terrain.
function terrainChildren(terrains) {
  return [
    leaf("generate", "🎲", "Random", { anchor: true }),
    ...terrains.map((t) => leaf("placeTerrain", TERRAIN_GLYPH[t] || "▮", t, { value: t })),
  ];
}

// POI submenu: Random (anchored) + each type (dungeon adds a random-size dungeon;
// size-specific dungeons stay in the side panel).
function poiChildren(poiTypes) {
  return [
    leaf("addRandomPoi", "🎲", "Random", { anchor: true }),
    ...poiTypes.map((t) => leaf("addPoi", POI_GLYPH[t] || "⭐", t, { value: t })),
  ];
}

// Settlement submenu: when one exists, offer Remove + size changes; otherwise
// Random (anchored) + the sizes this terrain allows.
function settlementChildren(allowedSizes, hasSettlement) {
  const sizes = allowedSizes.map((s) => leaf("addSettlement", "🏠", s, { value: s }));
  if (hasSettlement) return [leaf("removeSettlement", "❌", "Remove"), ...sizes];
  return [leaf("addRandomSettlement", "🎲", "Random", { anchor: true }), ...sizes];
}

// Hook submenu: gossip is heard only in a settlement; a found map / trail works
// anywhere — so the parent is always enabled, only "Generate hook" gates.
function hookChildren(canGossip) {
  return [
    leaf("genHook", "💬", "Generate hook", canGossip ? {} : { enabled: false, reason: "Heard only in a settlement" }),
    leaf("readMap", "🗺️", "Read map"),
    leaf("followTrail", "👣", "Follow a trail"),
  ];
}

/**
 * Build the fixed-slot radial model for the cell under the cursor.
 * @param {object} state
 *   placed         {boolean} hex exists & is placed
 *   terrain        {string|null}
 *   hasSettlement  {boolean}
 *   allowedSizes   {string[]} settlement sizes this terrain permits
 *   canGossip      {boolean} a settlement is present (town gossip)
 *   emptyNeighbors {number} count of not-yet-generated neighbours
 *   poiTypes       {string[]}
 *   terrains       {string[]}
 * @returns {object[]} 8 slots, always in this order.
 */
export function buildRadialModel(state) {
  const {
    placed = false, terrain = null, hasSettlement = false,
    allowedSizes = [], canGossip = false, emptyNeighbors = 0,
    poiTypes = [], terrains = [],
  } = state || {};

  const needHex = { enabled: false, reason: "Place terrain on this hex first" };

  // Settlement: enabled on a placed hex that either allows a settlement or
  // already has one (so it can be removed). Disabled on water with none.
  const settlementState = !placed
    ? needHex
    : allowedSizes.length || hasSettlement
      ? {}
      : { enabled: false, reason: `No settlement can sit on ${terrain}` };

  // Neighbours: needs a placed hex with at least one empty neighbour.
  const neighborsState = !placed
    ? { enabled: false, reason: "Place this hex first" }
    : emptyNeighbors > 0
      ? {}
      : { enabled: false, reason: "All neighbours already filled" };

  return [
    submenu("terrain", ACTION_GLYPH.terrain, placed ? "Terrain" : "Place", {}, terrainChildren(terrains)),
    submenu("poi", ACTION_GLYPH.poi, "POI", placed ? {} : needHex, poiChildren(poiTypes)),
    submenu("settlement", ACTION_GLYPH.settlement, "Settlement", settlementState, settlementChildren(allowedSizes, hasSettlement)),
    submenu("hook", ACTION_GLYPH.hook, "Hook", {}, hookChildren(canGossip)),
    leaf("neighbors", ACTION_GLYPH.neighbors, "Neighbours", neighborsState),
    leaf("regenerate", ACTION_GLYPH.regenerate, "Regenerate", placed ? {} : needHex),
    leaf("deleteHex", ACTION_GLYPH.deleteHex, "Delete", placed ? {} : { enabled: false, reason: "Nothing here to delete" }),
    leaf("generate", ACTION_GLYPH.generate, "Generate", placed ? { enabled: false, reason: "Already here — use Regenerate" } : {}),
  ];
}

export const RANDOM_VALUE = RANDOM;

// --- ring geometry (pure, so it's node-tested) ---------------------------

// Clamp one axis so the ring's outer edge stays `pad` inside a box of `size`.
// If the box is too small to honour the padding, fall back to its center.
function clampAxis(v, size, pad) {
  if (size <= pad * 2) return size / 2;
  return Math.max(pad, Math.min(size - pad, v));
}

/**
 * Local (host-relative) center for the ring: the click point translated into
 * the host box and clamped so the outer ring stays fully on-screen.
 *
 * Defensive: a hidden or detached host measures as a zero-size box (this was the
 * "ring always pinned top-left" bug — it was measured while still display:none).
 * In that case fall back to the raw client coords so the ring still appears at
 * the cursor rather than in a corner.
 *
 * @param {number} clientX  cursor X in client space
 * @param {number} clientY  cursor Y in client space
 * @param {{left:number,top:number,width:number,height:number}} rect host box
 * @param {number} pad      outer-ring radius + node, kept inside the box
 * @returns {{x:number,y:number}} center in host-local coordinates
 */
export function ringCenter(clientX, clientY, rect, pad) {
  if (!rect || !rect.width || !rect.height) return { x: clientX, y: clientY };
  return {
    x: clampAxis(clientX - rect.left, rect.width, pad),
    y: clampAxis(clientY - rect.top, rect.height, pad),
  };
}
