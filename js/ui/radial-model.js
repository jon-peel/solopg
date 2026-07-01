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
  reserved: "·", regenerate: "🔄", deleteHex: "🗑️", generate: "🎲",
};
export const TERRAIN_GLYPH = {
  Forest: "🌲", Plains: "🌾", Hills: "⛰️", Mountains: "🏔️",
  Swamp: "🐊", Desert: "🏜️", Lake: "💧", Sea: "🌊",
};
export const POI_GLYPH = {
  dungeon: "🏰", shrine: "⛩️", camp: "⛺", landmark: "🗿", tower: "🗼",
};

const RANDOM = "__random__";

const leaf = (id, glyph, label, { enabled = true, reason, value, anchor, title, danger } = {}) =>
  ({ kind: "leaf", id, glyph, label, enabled, reason, value, anchor, title, danger });

const submenu = (id, glyph, label, { enabled = true, reason } = {}, children = []) =>
  ({ kind: "submenu", id, glyph, label, enabled, reason, children });

// Terrain submenu: Random (anchored nearest the cursor) + each terrain.
function terrainChildren(terrains) {
  // No "Random" leaf here — Generate (its own slot) already covers random
  // single-hex generation, so Terrain/Place is just the explicit-pick list.
  return terrains.map((t) => leaf("placeTerrain", TERRAIN_GLYPH[t] || "▮", t, { value: t }));
}

const shorten = (s, n = 16) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);

// POI submenu: Random (anchored) + each type to add, then a Remove entry per
// existing POI on this hex (deleting a POI lives here, not in the panel).
// "dungeon" nests a third ring of sizes (Random + each dungeon-size) when
// `dungeonSizes` is supplied; with none it stays a leaf that adds a random one.
function poiChildren(poiTypes, pois, dungeonSizes = []) {
  return [
    leaf("addRandomPoi", "🎲", "Random", { anchor: true }),
    ...poiTypes.map((t) =>
      t === "dungeon" && dungeonSizes.length
        ? submenu("dungeon", POI_GLYPH.dungeon, "dungeon", {}, [
            leaf("addRandomDungeon", "🎲", "Random", { anchor: true }),
            ...dungeonSizes.map((s) => leaf("addDungeon", "🏰", s.label, { value: s.value, title: s.title })),
          ])
        : leaf("addPoi", POI_GLYPH[t] || "⭐", t, { value: t }),
    ),
    ...pois.map((p) => leaf("removePoi", "🗑️", shorten(p.name), { value: p.id, title: `Remove ${p.name}`, danger: true })),
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

// Generate submenu: Random (anchored, single hex — same "generate" id/handler
// as before) + Small/Medium/Large (3R.1 "Area" tool, folded in here rather than
// its own slot). Every size always fills EMPTY hexes only in the hex-radius
// disc around the target (center included) — no overwrite option; a hex
// that's already there just stays put. `value` is the plain radius number.
const AREA_SIZES = [
  { label: "Small", radius: 1 },
  { label: "Medium", radius: 2 },
  { label: "Large", radius: 3 },
];

function generateChildren(placed) {
  return [
    leaf("generate", "🎲", "Random", {
      anchor: true,
      ...(placed ? { enabled: false, reason: "Already here — use Regenerate" } : {}),
    }),
    ...AREA_SIZES.map(({ label, radius }) => {
      const count = 1 + 3 * radius * (radius + 1);
      return leaf("genArea", "🧭", label, { value: radius, title: `${label} — up to ${count} hexes` });
    }),
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
 *   poiTypes       {string[]}
 *   terrains       {string[]}
 *   pois           {{id:string,name:string}[]} existing POIs on this hex (for Remove)
 *   dungeonSizes   {{label:string,value:string,title?:string}[]} size options for the dungeon sub-ring
 * @returns {object[]} 8 slots, always in this order.
 */
export function buildRadialModel(state) {
  const {
    placed = false, terrain = null, hasSettlement = false,
    allowedSizes = [], canGossip = false,
    poiTypes = [], terrains = [], pois = [], dungeonSizes = [],
  } = state || {};

  const needHex = { enabled: false, reason: "Place terrain on this hex first" };

  // Settlement: enabled on a placed hex that either allows a settlement or
  // already has one (so it can be removed). Disabled on water with none.
  const settlementState = !placed
    ? needHex
    : allowedSizes.length || hasSettlement
      ? {}
      : { enabled: false, reason: `No settlement can sit on ${terrain}` };

  return [
    submenu("terrain", ACTION_GLYPH.terrain, placed ? "Terrain" : "Place", {}, terrainChildren(terrains)),
    submenu("poi", ACTION_GLYPH.poi, "POI", placed ? {} : needHex, poiChildren(poiTypes, pois, dungeonSizes)),
    submenu("settlement", ACTION_GLYPH.settlement, "Settlement", settlementState, settlementChildren(allowedSizes, hasSettlement)),
    submenu("hook", ACTION_GLYPH.hook, "Hook", {}, hookChildren(canGossip)),
    // Generate: Random (single hex, gated like before) + Small/Medium/Large
    // (3R.1 "Area" fill-empty, folded in here). The submenu itself is always
    // enabled — Area sizes work regardless of whether the center is placed.
    // Placed at the bottom slot (nearest the cursor for a typical downward
    // right-click) since it's the most-used action.
    submenu("generate", ACTION_GLYPH.generate, "Generate", {}, generateChildren(placed)),
    leaf("regenerate", ACTION_GLYPH.regenerate, "Regenerate", placed ? {} : needHex),
    leaf("deleteHex", ACTION_GLYPH.deleteHex, "Delete", placed ? { danger: true } : { enabled: false, reason: "Nothing here to delete", danger: true }),
    // Reserved — no action lives here yet (a future feature, e.g. travel,
    // may claim it).
    leaf("reserved", ACTION_GLYPH.reserved, "—", { enabled: false, reason: "Reserved for a future feature" }),
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
