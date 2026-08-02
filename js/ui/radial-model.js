// Pure builder for the right-click radial menu (Phase 7.1).
//
// Returns a FIXED set of slots in a FIXED order so each action always sits in
// the same angular position. Actions that don't apply to the current cell are
// kept (never hidden) but marked `enabled:false` with a `reason` — so you can
// always see what *should* be there, and why it isn't available right now
// (e.g. "Neighbours" on a fully-surrounded hex). No DOM, no app state: this is
// node-tested; radial-menu.js renders it and app.js dispatches the picks.

import { MONASTERY_RANK } from "../gen/monastery.js"; // monastic rank labels for the Settlement→Monastery menu

// Glyphs are emoji stand-ins (match the approved prototype); the canvas uses
// its own terrain/POI art — these only label the menu.
export const ACTION_GLYPH = {
  terrain: "🗺️", poi: "⭐", settlement: "🏠", hook: "🎣",
  draw: "✏️", river: "🏞️", road: "🛣️", regenerate: "🔄", deleteHex: "🗑️", generate: "🎲",
  culture: "👥", modify: "🔧", world: "🌍",
};
export const TERRAIN_GLYPH = {
  Forest: "🌲", Plains: "🌾", Hills: "⛰️", Mountains: "🏔️",
  Swamp: "🐊", Desert: "🏜️", Lake: "💧", Sea: "🌊",
};
export const POI_GLYPH = {
  dungeon: "🏰", shrine: "⛩️", camp: "⛺", landmark: "🗿", tower: "🗼",
};

const RANDOM = "__random__";

const leaf = (id, glyph, label, { enabled = true, reason, value, anchor, title, danger, swatch } = {}) =>
  ({ kind: "leaf", id, glyph, label, enabled, reason, value, anchor, title, danger, swatch });

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
// Random (anchored) + the sizes this terrain allows. Either way, a nested
// "Monastery" submenu drops a religious house (kind:"monastery") of a chosen
// size — rolled rarely in normal generation, but the GM can place one on demand
// (parity with placing a plain settlement; reuses the settlement machinery).
function settlementChildren(allowedSizes, hasSettlement) {
  const sizes = allowedSizes.map((s) => leaf("addSettlement", "🏠", s, { value: s }));
  const monastery = submenu("addMonasteryMenu", "✝", "Monastery", {}, [
    leaf("addRandomMonastery", "🎲", "Random", { anchor: true }),
    // Label by monastic RANK (Hermitage/Priory/Abbey/Great Abbey), not the plain
    // settlement tier; the underlying size still rides in `value`.
    ...allowedSizes.map((s) => leaf("addMonastery", "✝", MONASTERY_RANK[s] || s, { value: s })),
  ]);
  if (hasSettlement) return [leaf("removeSettlement", "❌", "Remove"), ...sizes, monastery];
  return [leaf("addRandomSettlement", "🎲", "Random", { anchor: true }), ...sizes, monastery];
}

// Culture submenu (moved off the side panel): a GM culture override for this hex
// — a leaf per race (the active one marked ✓), plus Clear (only enabled when an
// anchor is painted here). Applies to any placed hex, cultured or not.
function cultureChildren(cultureRaces, paintedRace) {
  const kids = cultureRaces.map(({ value, label }) =>
    leaf("paintCulture", ACTION_GLYPH.culture, (value === paintedRace ? "✓ " : "") + label, { value }));
  kids.push(leaf("clearCulture", "❌", "Clear", paintedRace ? { danger: true } : { enabled: false, reason: "No culture painted here" }));
  return kids;
}

// Modify submenu: the "edit this hex" actions grouped — Lock/Unlock, re-roll this
// hex / a disc around it (regenChildren), and Delete (folded in here off its own
// slot; a locked hex can't be deleted). The parent gates on a placed hex, so the
// Delete leaf only needs the locked case.
function modifyChildren(locked) {
  return [
    ...regenChildren(locked),
    leaf("deleteHex", ACTION_GLYPH.deleteHex, "Delete",
      locked ? { enabled: false, reason: "Hex is locked", danger: true } : { danger: true }),
  ];
}

// World submenu: the living-world / play actions grouped off the top ring — a
// Hook, the Party, and Faction submenus (each keeps its own children + gating).
function worldChildren({ canGossip, placed, partyHere, factions, ownerId, canReseat, promotable }) {
  return [
    submenu("hook", ACTION_GLYPH.hook, "Hook", {}, hookChildren(canGossip)),
    submenu("party", "🚩", "Party", {}, partyChildren(placed, partyHere)),
    submenu("faction", "⚑", "Faction", {}, factionChildren({ placed, factions, ownerId, canReseat, promotable })),
  ];
}

// Draw submenu: trace a manual River or Road; plus a Remove entry for whichever
// GM-drawn (manual) river/road this hex lies on (auto-generated ones aren't
// individually removable — they're derived overlays).
function drawChildren(manualRiverHere, manualRoadHere) {
  return [
    leaf("drawRiver", ACTION_GLYPH.river, "River"),
    leaf("drawRoad", ACTION_GLYPH.road, "Road"),
    ...(manualRiverHere ? [leaf("removeRiver", "🗑️", "Remove river", { value: manualRiverHere, danger: true })] : []),
    ...(manualRoadHere ? [leaf("removeRoad", "🗑️", "Remove road", { value: manualRoadHere, danger: true })] : []),
  ];
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
  { label: "Huge", radius: 15 }, // bulk-fill for testing/prep — up to 721 hexes in one go
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

// Regenerate submenu: Lock/Unlock this hex (protect it from re-roll/delete), then
// re-roll THIS hex, or a Small/Medium/Large disc around it (existing hexes only;
// locked ones are kept, manual rivers/roads stay). `value` is the radius.
const REGEN_SIZES = [{ label: "Small", radius: 1 }, { label: "Medium", radius: 2 }, { label: "Large", radius: 3 }];
function regenChildren(locked) {
  return [
    leaf("toggleLock", locked ? "🔓" : "🔒", locked ? "Unlock" : "Lock"),
    leaf("regenHex", "🔄", "This hex", locked ? { enabled: false, reason: "Hex is locked" } : {}),
    ...REGEN_SIZES.map(({ label, radius }) => leaf("regenArea", "🧭", label, { value: radius, title: `Re-roll a ${label.toLowerCase()} area (locked hexes kept)` })),
  ];
}

// Party submenu (Phase 11.5, moved off the panel): march the party toward this
// hex (one day per press) or drop it here (GM teleport). Both need a placed hex
// and are inert once the party already stands here.
function partyChildren(placed, partyHere) {
  if (partyHere) {
    return [leaf("partyHere", "🚩", "Party is here", { enabled: false, reason: "The party already stands on this hex" })];
  }
  const need = placed ? {} : { enabled: false, reason: "Place terrain on this hex first" };
  return [
    leaf("travelToward", "🥾", "Travel toward", need),
    leaf("placeParty", "🚩", "Place here", need),
  ];
}

// Faction submenu (Phase 11.5, moved off the panel): birth a power here, set who
// runs the hex (single-owner picker), make it a held faction's seat, or promote
// an occupied POI into a power (optionally as a lair-bound lord). The current
// owner is marked with a ✓.
function factionChildren({ placed, factions, ownerId, canReseat, promotable }) {
  const need = placed ? {} : { enabled: false, reason: "Place terrain on this hex first" };
  const kids = [leaf("genFaction", "🎲", "Generate here", need)];
  if (placed && factions.length) {
    kids.push(
      submenu("runBy", "⚑", "Run by", {}, [
        leaf("setOwner", "🚫", ownerId == null ? "✓ None" : "None", { value: null }),
        ...factions.map((f) =>
          leaf("setOwner", "⚑", (ownerId === f.id ? "✓ " : "") + shorten(f.name), { value: f.id, swatch: f.color }),
        ),
      ]),
    );
  }
  if (placed && canReseat) {
    kids.push(leaf("reseat", "★", `Seat ${shorten(canReseat.name)}`, { value: canReseat.id, title: `Make this ${canReseat.name}'s seat — costs reach + strength` }));
  }
  for (const p of promotable) {
    if (p.lords && p.lords.length) {
      kids.push(
        submenu("promoteMenu", "👑", `Promote ${shorten(p.name)}`, {}, [
          leaf("promote", "⚑", "Ordinary faction", { value: { poiId: p.poiId } }),
          ...p.lords.map((l) => leaf("promote", "👑", shorten(l.label), { value: { poiId: p.poiId, archetype: l.archetype } })),
        ]),
      );
    } else {
      kids.push(leaf("promote", "⚑", `Promote ${shorten(p.name)}`, { value: { poiId: p.poiId } }));
    }
  }
  return kids;
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
    manualRiverHere = null, manualRoadHere = null, locked = false,
    partyHere = false, factions = [], ownerId = null, canReseat = null, promotable = [],
    cultureRaces = [], paintedRace = null,
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
    // Culture (moved off the panel): GM-paint an ancestry anchor on this hex.
    submenu("culture", ACTION_GLYPH.culture, "Culture", placed ? {} : needHex, cultureChildren(cultureRaces, paintedRace)),
    // Generate: Random (single hex, gated like before) + Small/Medium/Large/Huge
    // (3R.1 "Area" fill-empty, folded in here). Always enabled — Area sizes work
    // regardless of whether the center is placed. The most-used action.
    submenu("generate", ACTION_GLYPH.generate, "Generate", {}, generateChildren(placed)),
    // Draw: trace a manual river / road from this hex, and Remove one that already
    // passes through it.
    submenu("draw", ACTION_GLYPH.draw, "Draw", {}, drawChildren(manualRiverHere, manualRoadHere)),
    // Modify: the "edit this hex" group — Lock/Unlock, Regenerate this hex / an
    // area, and Delete (folded in off its own slot).
    submenu("modify", ACTION_GLYPH.modify, "Modify", placed ? {} : needHex, modifyChildren(locked)),
    // World: the living-world / play group — Hook, Party, Faction, folded off the
    // top ring so it stays manageable (each keeps its own children + gating).
    submenu("world", ACTION_GLYPH.world, "World", {}, worldChildren({ canGossip, placed, partyHere, factions, ownerId, canReseat, promotable })),
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
