// Canvas hex-map renderer (Phase 2).
//
// Imperative + browser-only (not unit-tested; the math lives in core/hexgeo.js).
// Owns the camera and input; reports clicks via callbacks. Does NO persistence
// or generation — app.js mutates the world and calls setWorld() to redraw.

import {
  axialToPixel,
  pixelToAxial,
  pixelToAxialFractional,
  hexCorners,
  axialKey,
  parseKey,
  NEIGHBOR_DIRS,
} from "../core/hexgeo.js";
import { hashString } from "../core/rng.js";
import { placedHexes } from "../world/world.js";
import {
  colorForTerrain,
  iconForTerrain,
  SELECTED_STROKE,
} from "./terrain-style.js";
import { glyphForPoi, poiDotColor, factionColor, factionHatchDeg } from "./poi-style.js";
import { artFor, TERRAIN_ART } from "./terrain-art.js";
import { MAP, parseHex, watchTheme } from "./theme.js";
import { settlementArt, settlementMark, SETTLEMENT_ART, KEEP_ART } from "./settlement-art.js";
import { settlementName } from "../gen/settlement-name.js";
import { computeRegions, regionName } from "../gen/regions.js";
import { LORD_ARCHETYPES } from "../gen/factions.js";
import { buildLivingField, worldCultureAnchors, listCultures } from "../gen/culture.js";
import { CULTURE_COLORS, RACE_LABELS, RACES } from "../gen/culture-data.js";
import { washOpacity, contestedEdge } from "./culture-style.js";

const HEX_SIZE = 28; // center-to-corner, world px
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;
const DRAG_THRESHOLD = 4; // px before a press counts as a drag (not a click)
const MAX_GRID_CELLS = 4000; // skip empty-cell outlines when zoomed way out
const DETAIL_PX = 26; // at/above: pencil sketches + corner markers (drop to small view sooner)
const MARK_MIN_PX = 7; // below: nothing; between: simplified dots
const TERRAIN_ICON_ALPHA = 0.7; // inked map motifs read as drawn symbols; settlements stay opaque

let canvas = null;
let ctx = null;
let dpr = 1;
let world = null;
let selected = null; // { q, r } | null
let camera = { offsetX: 0, offsetY: 0, scale: 1 }; // CSS-pixel space
let drag = null;
// Touch (Phase 11.7): active pointers for pinch-zoom + a long-press timer that
// stands in for right-click (opens the radial) on touch devices.
const pointers = new Map(); // pointerId -> { x, y }
let pinchPrev = null; // previous 2-finger distance, or null
let longPressTimer = null;
let iconsEnabled = true;
let labelsEnabled = true; // show hex name labels on the map
let cultureEnabled = true; // show the culture overlay (wash / seams / realm labels)
let factionsEnabled = true; // show the faction territory overlay (fill / outline)
let regionLabelsEnabled = true; // show engraved terrain-region names ("the Blackwood")
let hooksEnabled = true; // show adventure-lead rings / pins
let hovered = null; // { q, r } under the cursor | null
let hoverKey = null; // axialKey of `hovered`, to skip redundant re-renders
let lastPpm = null; // last pixels-per-mile emitted to onView (fire only on change)
let hookTargets = new Set(); // axial keys "q,r" of open, unpinned hook destinations
let pinnedTargets = new Set(); // axial keys of PINNED (active-lead) hook destinations
let riverDraft = null; // in-progress manual river being drawn: [{q,r}, ...] | null
let roadDraft = null;  // in-progress manual road being drawn: [{q,r}, ...] | null
let regionCache = { seed: null, count: -1, byHex: new Map() }; // memoised hex -> region name (js/gen/regions.js)
// Culture layer (Phase 14.5): the living field is memoised per (seed, hex count)
// just like regionCache — rebuilt only when the revealed set grows — and read
// per-hex for the tint / labels / contested seams. `field` is set at render time
// (ensureCultureField); mapCultures()/cultureInfoAt() read it for the legend/panel.
let cultureCache = { seed: null, count: -1, field: null, cultures: [] };
let cultureField = null; // the current frame's living field (set in render)
let handlers = { onHexClick: () => {}, onEmptyCellClick: () => {} };

/** Attach the renderer to a canvas. Call once. */
export function attachMap(canvasEl, cbs = {}) {
  canvas = canvasEl;
  ctx = canvas.getContext("2d");
  handlers = { ...handlers, ...cbs };

  // Repaint the map when the OS light/dark preference flips (Phase 12.8): the
  // theme tokens are live bindings, so a re-render picks up the new palette.
  watchTheme(() => render());

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("dblclick", onDblClick);

  preloadTileArt(); // warm terrain/settlement art so tiles never start as emoji
  resize();
}

export function setWorld(w) {
  world = w;
  highlightFaction = null; // a highlight from the old world's legend no longer applies
  regionCache = { seed: null, count: -1, byHex: new Map() }; // invalidate named regions for the new world
  cultureCache = { seed: null, count: -1, field: null, cultures: [] }; // ...and the culture field
  render();
}

let travelPath = null; // the last move's path [{q,r}, …] (origin + each hex entered)
let encounterMarks = null; // hexes on the last route where a wilderness encounter came up (9.7)

/** Show the trail of the party's last move (null clears it). */
export function setTravelPath(path) {
  travelPath = path && path.length > 1 ? path : null;
  render();
}

/** Mark hexes on the last route where a wilderness encounter came up (null clears). */
export function setEncounterMarks(list) {
  encounterMarks = list && list.length ? list : null;
  render();
}

export function setSelected(coordOrNull) {
  selected = coordOrNull;
  render();
}

/** Center the camera on axial cell (q, r). Fractional coords are fine. */
export function recenterOn(q, r) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const p = axialToPixel(q, r, HEX_SIZE);
  camera.offsetX = rect.width / 2 - p.x * camera.scale;
  camera.offsetY = rect.height / 2 - p.y * camera.scale;
  render();
}

/** Screen pixels per mile at the current zoom (for the scale bar). */
export function pixelsPerMile() {
  const milesPerHex = (world && world.hexScale) || 6;
  // Adjacent hex centres are sqrt(3)*HEX_SIZE world px apart = one hex = N miles.
  return (Math.sqrt(3) * HEX_SIZE / milesPerHex) * camera.scale;
}

/** Zoom a step in (dir>0) or out (dir<0), keeping the canvas center fixed. */
// Zoom to an absolute scale, anchored on a client point (clamped). The point
// stays put under the cursor/fingers — used by the wheel, +/−, and pinch.
function zoomAt(scale, clientX, clientY) {
  if (!canvas) return;
  const before = clientToWorld(clientX, clientY);
  camera.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
  const after = clientToWorld(clientX, clientY);
  camera.offsetX += (after.x - before.x) * camera.scale;
  camera.offsetY += (after.y - before.y) * camera.scale;
  render();
}

// Absolute zoom anchored on the viewport centre (the +/−/slider path).
function zoomToScale(scale) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  zoomAt(scale, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

export function zoomStep(dir) {
  zoomToScale(camera.scale * (dir > 0 ? 1.2 : 1 / 1.2));
}

/** Set an absolute zoom (for the zoom slider). */
export function setZoom(scale) {
  zoomToScale(scale);
}

/** Current zoom + its clamp range (for the zoom slider to reflect/drive). */
export function getZoom() {
  return { scale: camera.scale, min: MIN_SCALE, max: MAX_SCALE };
}

/** Recenter on the party marker if there is one; else on placed content (its
 *  centroid); else the origin when the map is empty. */
export function recenter() {
  if (world && world.party) return recenterOn(world.party.q, world.party.r);
  const hexes = world ? placedHexes(world) : [];
  if (!hexes.length) return recenterOn(0, 0);
  let sq = 0, sr = 0;
  for (const h of hexes) { sq += h.coords.q; sr += h.coords.r; }
  recenterOn(sq / hexes.length, sr / hexes.length);
}

function resize() {
  if (!canvas) return;
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  render();
}

// Convert a mouse client coord to world-space px (camera is in CSS-px space, so
// devicePixelRatio does not appear here).
function clientToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cssX = clientX - rect.left;
  const cssY = clientY - rect.top;
  return {
    x: (cssX - camera.offsetX) / camera.scale,
    y: (cssY - camera.offsetY) / camera.scale,
  };
}

export function render() {
  if (!ctx || !canvas) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr); // draw in CSS px
  ctx.translate(camera.offsetX, camera.offsetY);
  ctx.scale(camera.scale, camera.scale); // draw in world px

  if (!world) return;

  ensureCultureField(); // memoised living field for the tint / labels / seams

  // Visible world-space rect (canvas-local CSS coords 0..cssW/cssH inverted
  // through the camera), padded so partially-visible hexes still draw.
  const rect = canvas.getBoundingClientRect();
  const minX = (0 - camera.offsetX) / camera.scale;
  const minY = (0 - camera.offsetY) / camera.scale;
  const maxX = (rect.width - camera.offsetX) / camera.scale;
  const maxY = (rect.height - camera.offsetY) / camera.scale;
  const margin = 2 * HEX_SIZE;

  // 1. Empty-cell outlines across the visible axial range (skip when too zoomed
  //    out, to avoid drawing thousands of cells).
  drawEmptyGrid(minX, minY, maxX, maxY);

  // 2. Placed hexes (filled), culled to the viewport. Two overlay tiers:
  //    detail (terrain sketch + corner markers) and simplified (centered
  //    settlement dot + red POI dot), both gated by the icons toggle.
  const onScreen = HEX_SIZE * camera.scale;
  const detail = iconsEnabled && onScreen >= DETAIL_PX;
  const simplified = iconsEnabled && onScreen >= MARK_MIN_PX && onScreen < DETAIL_PX;
  // Network LOD is zoom-only (roads/rivers draw regardless of the icons toggle):
  // full styling when close, a thin solid skeleton once hexes shrink past detail.
  const netDetail = onScreen >= DETAIL_PX;
  // Two passes so the water/road network layers correctly: first the hex FILLS +
  // terrain motifs (background), then rivers + roads, then the settlement/POI/hook
  // MARKERS on top — so a town icon sits cleanly ON the network, not under it. The
  // first pass collects the visible hexes so the marker pass reuses its cull.
  const visible = [];
  for (const hex of placedHexes(world)) {
    const { q, r } = hex.coords;
    const c = axialToPixel(q, r, HEX_SIZE);
    if (
      c.x < minX - margin ||
      c.x > maxX + margin ||
      c.y < minY - margin ||
      c.y > maxY + margin
    ) {
      continue;
    }
    drawHexFill(c.x, c.y, colorForTerrain(hex.terrain));
    // Culture wash (14.5): a translucent race tint UNDER the terrain motif +
    // markers, opacity ramped by living-field strength. Human hexes get none.
    if (cultureEnabled) drawCultureWash(c.x, c.y, q, r);
    // Terrain motif is background (under the network); a settled tile skips it —
    // its settlement marker (drawn later, over the roads) stands in for it.
    if (detail && !(hex.settlement && hex.settlement.present)) drawTerrainIcon(c.x, c.y, hex.terrain, q, r);
    visible.push({ hex, c });
  }

  // 2a⁰. Faction territory FILL + hatch (Phase 11.4) — a translucent colour wash
  //      per power, UNDER the roads/markers so those stay crisp on top. The
  //      inked border + seat marker come later (over everything).
  if (factionsEnabled) drawFactionFill(minX, minY, maxX, maxY, margin, onScreen);

  // 2a. Roads + rivers, UNDER the markers below. Draw order IS the bridge/ford:
  //     dashed tracks/spurs go UNDER the river (a ford — water runs over them),
  //     then the river, then solid roads OVER it (a bridge). Roads are nudged
  //     off-centre so one running along a river sits beside it (see drawRoads).
  drawRoads(minX, minY, maxX, maxY, margin, roadFordsRiver, netDetail); // fords, under the water
  drawRivers(minX, minY, maxX, maxY, margin, netDetail);
  drawRiverDraft(); // the manual river being traced (if any), on top
  drawRoads(minX, minY, maxX, maxY, margin, (rd) => !roadFordsRiver(rd), netDetail); // bridges, over
  drawRoadDraft(); // the manual road being traced (if any), on top

  // 2a″. Markers on placed hexes (settlement/POI + hook rings), on top of the
  //      water/road network so the icons stay legible.
  for (const { hex, c } of visible) {
    if (detail) drawDetailMarkers(c.x, c.y, hex);
    else if (simplified) drawSimplifiedMarkers(c.x, c.y, hex);
    // Hook destinations: pinned leads (a distinct pin) take precedence over the
    // amber "a lead exists here" ring; both visible at all zooms.
    const hk = axialKey(hex.coords.q, hex.coords.r);
    if (hooksEnabled) {
      if (pinnedTargets.has(hk)) drawPinnedMark(c.x, c.y, detail);
      else if (hookTargets.has(hk)) drawHookMark(c.x, c.y, detail);
    }
    // A locked hex (protected from regenerate/delete) shows a small padlock.
    if (detail && hex.locked) {
      const off = HEX_SIZE * 0.52, sz = HEX_SIZE * 0.4;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `${sz}px sans-serif`;
      drawMarker(c.x - off, c.y - off, "🔒", sz, "#fff");
    }
  }

  // 2a⁗. Contested culture seams (14.5) — a two-tone dashed front line where two
  //      peoples meet, over the markers so the tension reads. Under the faction
  //      outline + labels below.
  if (cultureEnabled) drawContestedBorders(visible);

  // 2a‴. Faction territory OUTLINE + seat (Phase 11.4) — the inked sphere-of-
  //      influence border, over the roads/markers but UNDER the labels, hover
  //      readout, selection, hooks and party so those all stay legible on top.
  if (factionsEnabled) drawFactionOutline(minX, minY, maxX, maxY, margin);

  // 2a⁵. Engraved culture realm labels (14.5) at each realm's peak, over the
  //      territory art but under the hover/selection/party chrome below. Region
  //      names engrave first (under the realm labels).
  if (regionLabelsEnabled) drawRegionLabels(minX, minY, maxX, maxY, margin);
  if (cultureEnabled) drawCultureLabels(minX, minY, maxX, maxY, margin);

  // 2b. Annotations on un-generated cells: a name label / note badge float on
  //     the empty grid (detail tier only, to avoid clutter when zoomed out).
  if (detail) {
    const off = HEX_SIZE * 0.5;
    const size = HEX_SIZE * 0.44;
    for (const hex of Object.values(world.hexes)) {
      if (hex.placed || !hex.coords || (!hex.name && !hex.note)) continue;
      const c = axialToPixel(hex.coords.q, hex.coords.r, HEX_SIZE);
      if (c.x < minX - margin || c.x > maxX + margin || c.y < minY - margin || c.y > maxY + margin) continue;
      if (hex.note) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${size}px sans-serif`;
        drawMarker(c.x - off, c.y + off, "🗒", size, "#fff");
      }
      if (hex.name && labelsEnabled) drawHexLabel(c.x, c.y, hex.name);
    }
  }

  // Hover outline (under the selection ring; skipped on the selected cell).
  if (hovered && !(selected && selected.q === hovered.q && selected.r === hovered.r)) {
    const c = axialToPixel(hovered.q, hovered.r, HEX_SIZE);
    strokeHex(c.x, c.y, MAP.hoverStroke, 2);
    // Reveal names on hover (hidden by default): the GM's own hex name (or a
    // settlement's name) on top, then the region, then — coloured to match its
    // territory — the faction that runs the hex. Multi-line when several apply.
    const hh = world && world.hexes[axialKey(hovered.q, hovered.r)];
    if (detail && hh && hh.placed) {
      const primary = hh.name
        || (hh.settlement && hh.settlement.present
          ? settlementName(world.seed, hovered.q, hovered.r, hh.gen, { kind: hh.settlement.kind, terrain: hh.terrain, race: hh.settlement.race })
          : null);
      const region = regionNameAt(hovered.q, hovered.r);
      const fac = factionAt(hovered.q, hovered.r);
      const lines = [];
      if (primary) lines.push(primary);
      if (region && region !== primary) lines.push(region);
      if (fac) lines.push({ text: `⚑ ${fac.name}`, color: darkenRgba(fac.color, 0.25, 1) });
      const enc = encounterMarks && encounterMarks.find((m) => m.q === hovered.q && m.r === hovered.r);
      if (enc) lines.push({ text: `⚔ ${enc.terrain} encounter — roll on your table`, color: "#8a3324" });
      if (lines.length) drawHexLabel(c.x, c.y, lines);
    }
  }

  // 3. Selection highlight (works for empty or filled cells).
  if (selected) {
    const c = axialToPixel(selected.q, selected.r, HEX_SIZE);
    strokeHex(c.x, c.y, SELECTED_STROKE, 3);
  }

  // 4. Selected hook's endpoints (distinct colours) ON TOP — a hook's origin is
  //    usually the selected cell, so these must beat the blue selection ring.
  if (hookFocus) {
    const t = hookFocus.target, o = hookFocus.origin;
    if (t && o && !(t.q === o.q && t.r === o.r)) drawHookLine(o, t); // under the rings
    if (o) drawHookFocus(o, FOCUS_ORIGIN);
    if (t) drawHookFocus(t, FOCUS_TARGET);
  }

  // 4c. The last move's trail (Phase 11) — under the party marker.
  drawTravelPath();
  drawEncounterMarks(); // stars on the route's encounter hexes (9.7), over the trail

  // 5. Party marker (Phase 8.1) — the single most important marker, always ON
  //    TOP of everything else and visible at every zoom, regardless of whether
  //    a hex is placed there yet (it's just a coordinate on the infinite grid).
  if (world && world.party) {
    const pc = axialToPixel(world.party.q, world.party.r, HEX_SIZE);
    if (pc.x >= minX - margin && pc.x <= maxX + margin && pc.y >= minY - margin && pc.y <= maxY + margin) {
      drawPartyMark(pc.x, pc.y, detail);
    }
  }

  // Notify the scale bar only when the zoom (px-per-mile) actually changes.
  const ppm = pixelsPerMile();
  if (ppm !== lastPpm) {
    lastPpm = ppm;
    handlers.onView?.(ppm);
  }
}

/** Toggle terrain icons; re-renders. */
export function setIconsEnabled(on) {
  iconsEnabled = !!on;
  render();
}

/** Toggle hex name labels; re-renders. */
export function setLabelsEnabled(on) {
  labelsEnabled = !!on;
  render();
}

/** Toggle the culture overlay (wash / contested seams / realm labels); re-renders. */
export function setCultureOverlay(on) {
  cultureEnabled = !!on;
  render();
}

/** Toggle the faction territory overlay (fill / outline); re-renders. */
export function setFactionsOverlay(on) {
  factionsEnabled = !!on;
  render();
}

/** Toggle the engraved terrain-region names; re-renders. */
export function setRegionLabels(on) {
  regionLabelsEnabled = !!on;
  render();
}

/** Toggle the adventure-lead rings / pins; re-renders. */
export function setHooksOverlay(on) {
  hooksEnabled = !!on;
  render();
}

/**
 * Mark hook destinations; re-renders. `open` = amber rings (available leads),
 * `pinned` = a distinct pin (the party's active leads).
 */
export function setHookMarks({ open = [], pinned = [] } = {}) {
  hookTargets = new Set(open);
  pinnedTargets = new Set(pinned);
  render();
}

// The selected hook's endpoints, highlighted with distinct colours.
let hookFocus = null; // { target:{q,r}|null, origin:{q,r}|null } | null
const FOCUS_TARGET = "#e8493a"; // red — where the hook points
const FOCUS_ORIGIN = "#39c0c8"; // teal — where it was heard / reported

/** Highlight one hook's target/origin on the map, or null to clear. Re-renders. */
export function setHookFocus(focus) {
  hookFocus = focus && (focus.target || focus.origin) ? focus : null;
  render();
}

// A bold coloured ring for a focused hook endpoint (which is which is read from
// the card's colour legend, so no letter badge here).
function drawHookFocus(coord, color) {
  const c = axialToPixel(coord.q, coord.r, HEX_SIZE);
  strokeHex(c.x, c.y, color, 4);
}

// A faint dashed line between a selected hook's origin and target.
function drawHookLine(a, b) {
  const pa = axialToPixel(a.q, a.r, HEX_SIZE);
  const pb = axialToPixel(b.q, b.r, HEX_SIZE);
  ctx.save();
  ctx.strokeStyle = "rgba(230,232,238,0.45)";
  ctx.lineWidth = 2 / camera.scale;
  ctx.setLineDash([6 / camera.scale, 5 / camera.scale]);
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
  ctx.restore();
}

// Named regions (3R.8): memoise a hex -> region-name map per (seed, hex count) so
// we only flood-fill when the world grows. The name shows on HOVER (see the hover
// block in render) — no always-on labels cluttering the map.
const REGION_LABEL_MIN_SIZE = 16; // a clump needs this many same-terrain hexes to earn a name

// Memoise the named regions (+ a hex -> name map) per (seed, hex count) so we only
// flood-fill when the world grows. Used by the hover readout AND the toggleable
// engraved region-name overlay (drawRegionLabels).
function ensureRegions() {
  if (!world) return [];
  const hexes = placedHexes(world);
  if (!(regionCache.seed === world.seed && regionCache.count === hexes.length && regionCache.regions)) {
    const terrainByKey = new Map();
    for (const h of hexes) terrainByKey.set(axialKey(h.coords.q, h.coords.r), h.terrain);
    const regions = computeRegions(world.seed, terrainByKey, { minSize: REGION_LABEL_MIN_SIZE });
    const byHex = new Map();
    for (const reg of regions) for (const k of reg.keys) byHex.set(k, reg.name);
    regionCache = { seed: world.seed, count: hexes.length, byHex, regions };
  }
  return regionCache.regions;
}

function regionNameAt(q, r) {
  ensureRegions();
  return (regionCache.byHex && regionCache.byHex.get(axialKey(q, r))) || null;
}

// --- Culture layer (Phase 14.5) --------------------------------------------
// A translucent race-colour wash (opacity ∝ living-field strength) under the
// terrain art, engraved realm labels at each culture's peak, and a contested
// seam where two peoples meet. Presentation only: the field is rebuilt from the
// revealed terrain + STORED settlement anchors (settlementAnchors) with the same
// defaults the generator stamped against, so the render agrees with the stored
// races and never mutates the world (§5: reading the fields at render is fine).

// Build (or reuse) the living culture field for the current revealed set. Uses
// buildLivingField's default minSize (8) so it matches syncCultures' stamping.
// Anchors combine stamped settlements AND the GM's manual paint overrides
// (worldCultureAnchors, Step 6) — a painted hex renders as that race immediately.
function ensureCultureField() {
  if (!world) { cultureField = null; return null; }
  const hexes = placedHexes(world);
  if (!(cultureCache.seed === world.seed && cultureCache.count === hexes.length && cultureCache.field)) {
    const terrainByKey = new Map();
    for (const h of hexes) terrainByKey.set(axialKey(h.coords.q, h.coords.r), h.terrain);
    const anchors = worldCultureAnchors(world);
    const field = buildLivingField(world.seed, terrainByKey, { anchors });
    cultureCache = { seed: world.seed, count: hexes.length, field, cultures: listCultures(field) };
  }
  cultureField = cultureCache.field;
  return cultureField;
}

/**
 * The living culture at a hex, for the selection panel: {race, strength} or null
 * (Human — never tinted or labelled). Reads the memoised render field.
 */
export function cultureInfoAt(q, r) {
  const field = ensureCultureField();
  if (!field) return null;
  const { race, strength } = field.at(q, r);
  return race ? { race, strength } : null;
}

/**
 * The cultures present on the current map, for the legend: the distinct races
 * present (canonical order, each with colour + label) plus the raw name-bearing
 * culture list. Empty when the world is all-Human.
 */
export function mapCultures() {
  ensureCultureField();
  const cultures = cultureCache.cultures || [];
  const present = new Set(cultures.map((c) => c.race));
  const races = RACES.filter((r) => present.has(r)).map((race) => ({
    race,
    color: CULTURE_COLORS[race],
    label: RACE_LABELS[race],
  }));
  return { races, cultures };
}

// A translucent race-colour tint on one hex, opacity ramped by living-field
// strength (floored so a frontier hex still reads). Human hexes get none. Drawn
// UNDER the terrain motif + markers so those stay legible on top.
function drawCultureWash(cx, cy, q, r) {
  if (!cultureField) return;
  const { race, strength } = cultureField.at(q, r);
  if (!race) return;
  const a = washOpacity(strength);
  if (a <= 0) return;
  hexPath(cx, cy);
  ctx.fillStyle = rgba(CULTURE_COLORS[race], a);
  ctx.fill();
}

// Where two different cultures share an edge, draw a contested SEAM: a dark
// casing under a two-tone dashed line (each people's colour interleaved), so the
// border reads as a front line the GM can see (tension = a feature, §Step 5.3).
// Each shared edge is drawn once (deduped by its canonical endpoint pair).
function drawContestedBorders(visible) {
  if (!cultureField) return;
  const drawn = new Set();
  ctx.save();
  ctx.lineCap = "butt";
  const w = 2.4 / camera.scale;
  const dash = 5 / camera.scale;
  const seg = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
  for (const { hex } of visible) {
    const { q, r } = hex.coords;
    const here = cultureField.at(q, r).race;
    if (!here) continue;
    const key = axialKey(q, r);
    const c = axialToPixel(q, r, HEX_SIZE);
    const corners = hexCorners(c.x, c.y, HEX_SIZE);
    for (let dir = 0; dir < 6; dir++) {
      const [dq, dr] = NEIGHBOR_DIRS[dir];
      const nq = q + dq, nr = r + dr;
      const nbRace = cultureField.at(nq, nr).race;
      if (!contestedEdge(here, nbRace)) continue;
      const nk = axialKey(nq, nr);
      const ek = key < nk ? `${key}|${nk}` : `${nk}|${key}`;
      if (drawn.has(ek)) continue;
      drawn.add(ek);
      const e = (6 - dir) % 6; // neighbour dir -> the hex edge it shares
      const a = corners[e], b = corners[(e + 1) % 6];
      ctx.setLineDash([]);
      ctx.lineWidth = w + 1.6 / camera.scale;
      ctx.strokeStyle = "rgba(28,18,6,0.6)"; // dark casing (reads on any terrain)
      seg(a, b);
      ctx.setLineDash([dash, dash]);
      ctx.lineWidth = w;
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = darkenRgba(CULTURE_COLORS[here], 0.05, 0.95);
      seg(a, b);
      ctx.lineDashOffset = dash; // interleave the rival's colour into the gaps
      ctx.strokeStyle = darkenRgba(CULTURE_COLORS[nbRace], 0.05, 0.95);
      seg(a, b);
    }
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.restore();
}

const CULTURE_LABEL_MIN_SIZE = 4; // realms smaller than this stay unlabelled (noise)

// The proper realm name for a culture, matching how its core was seeded: prefer
// the terrain-region core's (terrain, anchor) so the name is stable; fall back to
// the peak hex for an anchor-only (town-pinned) culture. "Realm of the Silvaal".
function cultureRealmName(cul) {
  const core = (cultureField.cores || []).find((c) => `core:${c.originKey}` === cul.srcId);
  if (core) return `Realm of ${regionName(world.seed, core.terrain, core.anchor, cul.race)}`;
  const { q, r } = parseKey(cul.peakKey);
  const terrain = (world.hexes[axialKey(q, r)] || {}).terrain || "Plains";
  return `Realm of ${regionName(world.seed, terrain, cul.originKey, cul.race)}`;
}

// Engraved culture labels at each realm's peak ("Realm of the Silvaal · Elf").
// Constant screen-size serif with a parchment halo so it reads over terrain at any
// zoom; larger realms are placed first and a cheap box-overlap test drops labels
// that would collide, so the map stays legible instead of a wall of text.
function drawCultureLabels(minX, minY, maxX, maxY, margin) {
  if (!cultureField) return;
  const cultures = [...(cultureCache.cultures || [])].sort((a, b) => b.size - a.size);
  if (!cultures.length) return;
  const fs = 13 / camera.scale;
  ctx.save();
  ctx.font = `italic 600 ${fs}px "Iowan Old Style", Palatino, Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const placed = [];
  for (const cul of cultures) {
    if (cul.size < CULTURE_LABEL_MIN_SIZE) continue;
    const { q, r } = parseKey(cul.peakKey);
    const p = axialToPixel(q, r, HEX_SIZE);
    if (offView(p, minX, minY, maxX, maxY, margin)) continue;
    const text = `${cultureRealmName(cul)} · ${RACE_LABELS[cul.race]}`;
    const w = ctx.measureText(text).width;
    const box = { x: p.x - w / 2, y: p.y - fs * 0.7, w, h: fs * 1.4 };
    if (placed.some((o) => box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y)) {
      continue; // would collide with a bigger realm's label already drawn
    }
    placed.push(box);
    ctx.lineWidth = fs * 0.3;
    ctx.strokeStyle = MAP.labelBg; // parchment halo for contrast
    ctx.strokeText(text, p.x, p.y);
    ctx.fillStyle = darkenRgba(CULTURE_COLORS[cul.race], 0.12, 0.96);
    ctx.fillText(text, p.x, p.y);
  }
  ctx.restore();
}

// Engraved terrain-region names ("the Blackwood", "the Grey Peaks") at each
// region's centroid — the faint atmosphere layer (toggleable via the Layers menu).
// Skips a region already shown as a culture realm ("Realm of X") when the culture
// overlay is on, so a region is never double-labelled. Same constant-size serif +
// halo + overlap cull as the culture labels; larger regions placed first.
const REGION_LABEL_COLOR = "rgba(74,58,31,0.72)"; // faded ink
function drawRegionLabels(minX, minY, maxX, maxY, margin) {
  const regions = ensureRegions();
  if (!regions.length) return;
  // Regions currently shown as a culture realm — don't also draw their plain name.
  const skip = new Set();
  if (cultureEnabled && cultureField) {
    const cores = cultureField.cores || [];
    for (const cul of cultureCache.cultures || []) {
      if (cul.size < CULTURE_LABEL_MIN_SIZE) continue; // won't draw a realm label anyway
      const core = cores.find((c) => `core:${c.originKey}` === cul.srcId);
      if (core) skip.add(core.anchor);
    }
  }
  const list = [...regions].sort((a, b) => b.size - a.size);
  const fs = 12 / camera.scale;
  ctx.save();
  ctx.font = `italic ${fs}px "Iowan Old Style", Palatino, Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const placed = [];
  for (const reg of list) {
    if (skip.has(reg.anchor)) continue;
    const p = axialToPixel(reg.cq, reg.cr, HEX_SIZE);
    if (offView(p, minX, minY, maxX, maxY, margin)) continue;
    const text = reg.name;
    const w = ctx.measureText(text).width;
    const box = { x: p.x - w / 2, y: p.y - fs * 0.7, w, h: fs * 1.4 };
    if (placed.some((o) => box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y)) {
      continue; // would collide with a bigger region's label already drawn
    }
    placed.push(box);
    ctx.lineWidth = fs * 0.3;
    ctx.strokeStyle = MAP.labelBg; // parchment halo
    ctx.strokeText(text, p.x, p.y);
    ctx.fillStyle = REGION_LABEL_COLOR;
    ctx.fillText(text, p.x, p.y);
  }
  ctx.restore();
}

// Rivers (Phase 3R.5, "curated rivers"): each world.rivers[] entry is a full
// watercourse traced from a source to the sea (js/gen/river-trace.js), stored
// as `path` — an array of axial coords, source-first. We draw the whole thing
// as ONE smooth blue polyline through the hex CENTRES, including across hexes
// the GM hasn't generated yet, so a river reads as a complete, sea-reaching
// watercourse rather than a stub that dies at the first pond (the whole point
// of the rework). Solid blue, rounded joins; a cheap bounding-box cull skips
// rivers entirely off-screen, and the canvas clips the rest, so a long river
// only really costs its visible span.
const RIVER_WIDTH = 3.4; // constant screen px at the detail zoom
const RIVER_WIDTH_FAR = 1.5; // thinner in the zoomed-out overview so it doesn't dominate tiny hexes

// Roads (3R.7): tiered tan polylines linking settlements. Tier 1 highways
// (City–City) are widest, tier 3 tracks/spurs thinnest and dashed. A dark casing
// under the fill lifts them off the terrain. `width` is the detail-zoom screen px;
// `far` is the zoomed-out overview width — thin + solid (no dash), so a big map
// reads as a clean network skeleton instead of fat dashed tubes on tiny hexes.
const ROAD_TIERS = {
  1: { width: 4.4, far: 2.1, color: "#d9b25c" }, // highway (City–City)
  2: { width: 2.9, far: 1.5, color: "#c39a54" }, // road
  3: { width: 2.6, far: 1.2, color: "#c69a58", dash: [7, 4] }, // track / spur (dashed = ford)
};
const ROAD_CASING = "#4a3a1f";
const ANCIENT_COLOR = "#d8cba6"; // pale bone — a weathered ancient desert road (dead-straight, dotted)
const ROAD_END_TRIM = 0.5; // pull each end back this fraction of its last segment,
                           // so the centred settlement icon sits cleanly where the road arrives
const ROAD_OFFSET = HEX_SIZE * 0.2; // world px: nudge roads off hex-centre (perpendicular to
                                    // travel) so a road along a river sits beside it, not on it

// Smooth a polyline through its points: anchor each curve segment at the
// midpoint between consecutive vertices and use the vertex itself as the
// quadratic control point. Passes through the endpoints exactly and glides
// through the interior, turning the hex-to-hex zig-zag into natural meanders.
function strokeSmoothPath(pts) {
  if (!pts || pts.length < 2) return; // nothing to draw (e.g. a 1-point middle segment)
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.quadraticCurveTo(pts[pts.length - 2].x, pts[pts.length - 2].y, last.x, last.y);
  }
  ctx.stroke();
}

function drawRivers(minX, minY, maxX, maxY, margin, detail) {
  if (!world || !Array.isArray(world.rivers) || !world.rivers.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = colorForTerrain("Lake"); // rivers read as the same water as lakes (theme-aware)
  ctx.lineWidth = (detail ? RIVER_WIDTH : RIVER_WIDTH_FAR) / camera.scale;
  for (const river of world.rivers) {
    const path = river && river.path;
    if (!path || path.length < 2) continue;
    const pts = new Array(path.length);
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (let i = 0; i < path.length; i++) {
      const c = axialToPixel(path[i].q, path[i].r, HEX_SIZE);
      pts[i] = c;
      if (c.x < bMinX) bMinX = c.x;
      if (c.x > bMaxX) bMaxX = c.x;
      if (c.y < bMinY) bMinY = c.y;
      if (c.y > bMaxY) bMaxY = c.y;
    }
    // Whole-river cull: skip if its bounding box misses the padded viewport.
    if (bMaxX < minX - margin || bMinX > maxX + margin || bMaxY < minY - margin || bMinY > maxY + margin) {
      continue;
    }
    strokeRiver(pts, river);
  }
  ctx.restore();
}

// Draw one river: solid, except a MANUAL river's still-open end(s) — not yet
// anchored to a mountain source / the sea — render dashed to signal "this end
// is unresolved; it'll complete as you explore".
function strokeRiver(pts, river) {
  if (!river.manual || (!river.upstreamOpen && !river.downstreamOpen)) { strokeSmoothPath(pts); return; }
  const n = pts.length;
  const cap = Math.min(4, Math.max(1, Math.floor(n / 2)));
  const upEnd = river.upstreamOpen ? cap : 0; // pts[0..upEnd] is the open head
  const downStart = river.downstreamOpen ? n - cap : n; // pts[downStart..] the open tail
  if (upEnd >= downStart) { strokeDashed(pts); return; } // short / fully unresolved
  strokeSmoothPath(pts.slice(upEnd, downStart)); // anchored middle, solid
  if (river.upstreamOpen) strokeDashed(pts.slice(0, upEnd + 1));
  if (river.downstreamOpen) strokeDashed(pts.slice(downStart - 1));
}

function strokeDashed(pts) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.setLineDash([7 / camera.scale, 5 / camera.scale]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

function lerpPt(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

// Shift a polyline sideways by `off` world px (perpendicular to the local travel
// direction). Used so a road hugging a river valley draws beside the river instead
// of on top of it. The offset side is CANONICAL — it depends only on the segment's
// orientation, not on which way the road is traversed — so two roads sharing a
// corridor (in either direction) offset to the SAME side and merge into one line
// instead of doubling up.
function offsetPolyline(pts, off) {
  if (!off || pts.length < 2) return pts;
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    let nx = -ty, ny = tx; // perpendicular
    if (nx < 0 || (nx === 0 && ny < 0)) { nx = -nx; ny = -ny; } // canonical side (orientation-only)
    out[i] = { x: pts[i].x + nx * off, y: pts[i].y + ny * off };
  }
  return out;
}

// A dashed track/spur (tier 3, not the ancient road) FORDS a river — it's drawn
// UNDER the river so the water runs across it. Everything else (solid roads +
// the ancient road) is a BRIDGE, drawn OVER the river. No crossing glyph: the
// bridge/ford reads purely from which layer wins where they meet.
function roadFordsRiver(road) {
  return road.kind !== "ancient" && (road.tier || 2) >= 3;
}

// Roads (3R.7): a pass over world.roads[] matching `keep`. Each is a smoothed tan
// polyline through hex centres, tiered by width/colour, with a dark casing under
// the fill for contrast. Whole-road bounding-box cull like rivers; endpoints
// trimmed half a segment so the centred settlement icon stays clean. Called twice
// per frame — fords before the river, bridges after — so crossings layer right.
function drawRoads(minX, minY, maxX, maxY, margin, keep, detail) {
  if (!world || !Array.isArray(world.roads) || !world.roads.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Draw lowest tier first so where roads share a corridor the BIGGER one (drawn
  // last) shows on top — overlapping roads read as one bigger road.
  const ordered = world.roads.filter(keep).sort((a, b) => (a.tier || 2) - (b.tier || 2));
  for (const road of ordered) {
    const path = road && road.path;
    if (!path || path.length < 2) continue;
    const pts = new Array(path.length);
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (let i = 0; i < path.length; i++) {
      const c = axialToPixel(path[i].q, path[i].r, HEX_SIZE);
      pts[i] = c;
      if (c.x < bMinX) bMinX = c.x;
      if (c.x > bMaxX) bMaxX = c.x;
      if (c.y < bMinY) bMinY = c.y;
      if (c.y > bMaxY) bMaxY = c.y;
    }
    if (bMaxX < minX - margin || bMinX > maxX + margin || bMaxY < minY - margin || bMinY > maxY + margin) {
      continue;
    }
    // Trim the settlement end(s) back toward their neighbour so the town icon
    // stays clean; a crossroad end (road.junction) is left long so it meets the
    // road it joins. Then nudge the line off-centre so it sits beside any river.
    pts[0] = lerpPt(pts[0], pts[1], ROAD_END_TRIM); // a is always the owning settlement
    if (!road.junction) pts[pts.length - 1] = lerpPt(pts[pts.length - 1], pts[pts.length - 2], ROAD_END_TRIM);
    if (road.kind === "ancient") {
      strokeAncient(offsetPolyline([pts[0], pts[pts.length - 1]], ROAD_OFFSET), detail); // dead-straight
    } else {
      strokeRoad(offsetPolyline(pts, ROAD_OFFSET), road, detail);
    }
  }
  ctx.restore();
}

function strokeRoad(pts, road, detail) {
  const spec = ROAD_TIERS[road.tier] || ROAD_TIERS[2];
  ctx.save();
  if (!detail) {
    // Overview (zoomed out): a thin SOLID line with a hairline casing — no dashes
    // (they turn to noise at this scale). The network reads as a clean skeleton.
    const w = spec.far / camera.scale;
    ctx.strokeStyle = ROAD_CASING;
    ctx.lineWidth = w + 0.8 / camera.scale;
    strokeSmoothPath(pts);
    ctx.strokeStyle = spec.color;
    ctx.lineWidth = w;
    strokeSmoothPath(pts);
    ctx.restore();
    return;
  }
  const w = spec.width / camera.scale;
  // A dashed track gets the same dark casing as a solid road (dashed too), so its
  // dashes read clearly against the terrain instead of washing out.
  if (spec.dash) ctx.setLineDash(spec.dash.map((d) => d / camera.scale));
  ctx.strokeStyle = ROAD_CASING; // dark casing first...
  ctx.lineWidth = w + 1.8 / camera.scale;
  strokeSmoothPath(pts);
  ctx.strokeStyle = spec.color; // ...then the tan fill on top
  ctx.lineWidth = w;
  strokeSmoothPath(pts);
  ctx.restore();
}

// An ancient desert road: a pale, dead-straight, dotted line (weathered/broken).
// Zoomed out the dots vanish into noise, so it becomes a faint thin solid line.
function strokeAncient(pts, detail) {
  ctx.save();
  ctx.lineCap = "round";
  if (!detail) {
    ctx.strokeStyle = ANCIENT_COLOR;
    ctx.lineWidth = 1.1 / camera.scale;
    strokeSmoothPath(pts);
    ctx.restore();
    return;
  }
  const w = 2.4 / camera.scale;
  ctx.setLineDash([2 / camera.scale, 6 / camera.scale]);
  ctx.strokeStyle = ROAD_CASING;
  ctx.lineWidth = w + 1.2 / camera.scale;
  strokeSmoothPath(pts);
  ctx.strokeStyle = ANCIENT_COLOR;
  ctx.lineWidth = w;
  strokeSmoothPath(pts);
  ctx.restore();
}

/** Set (or clear) the in-progress manual river being traced; re-renders. */
export function setRiverDraft(points) {
  riverDraft = Array.isArray(points) && points.length ? points : null;
  render();
}

// The manual river being drawn: a dashed bright line through the clicked hex
// centres, with a dot on each point so the GM sees exactly what's captured.
function drawRiverDraft() {
  if (!riverDraft || !riverDraft.length) return;
  const pts = riverDraft.map((p) => axialToPixel(p.q, p.r, HEX_SIZE));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#bff0ff";
  ctx.lineWidth = RIVER_WIDTH / camera.scale;
  if (pts.length >= 2) {
    ctx.setLineDash([6 / camera.scale, 4 / camera.scale]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = "#bff0ff";
  const rr = 3.2 / camera.scale;
  for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

/** Set (or clear) the in-progress manual road being traced; re-renders. */
export function setRoadDraft(points) {
  roadDraft = Array.isArray(points) && points.length ? points : null;
  render();
}

// The manual road being drawn: a dashed bright-tan line through the clicked hex
// centres, with a dot on each point so the GM sees exactly what's captured.
function drawRoadDraft() {
  if (!roadDraft || !roadDraft.length) return;
  const pts = roadDraft.map((p) => axialToPixel(p.q, p.r, HEX_SIZE));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#f4d68a";
  ctx.lineWidth = (ROAD_TIERS[1].width + 0.5) / camera.scale;
  if (pts.length >= 2) {
    ctx.setLineDash([6 / camera.scale, 4 / camera.scale]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = "#f4d68a";
  const rr = 3.2 / camera.scale;
  for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// Cache of tile <img>s keyed by url; re-render once each finishes loading.
//
// Resilience matters here: a tile that fails to load must NOT be cached as a
// permanently-broken Image, or that terrain/settlement silently shows its emoji
// fallback until a full page reload happens to succeed (the "reverted to emoji,
// fixed by a few cmd-shift-r" symptom — a transient fetch failure, e.g. the
// single-threaded dev server dropping one of a burst of concurrent SVG requests,
// getting stuck). So on error we DROP the entry (bounded retries) and warn, and
// a later render re-attempts the load — the tile self-heals without a reload.
const tileCache = new Map();
const tileRetries = new Map(); // url -> attempts, to cap retries on a genuinely-missing file
const MAX_TILE_RETRIES = 4;
function tileImage(url) {
  let img = tileCache.get(url);
  if (img) return img;
  img = new Image();
  img.onload = () => {
    tileRetries.delete(url); // loaded cleanly — reset its retry budget
    render();
  };
  img.onerror = () => {
    const attempts = (tileRetries.get(url) || 0) + 1;
    tileRetries.set(url, attempts);
    if (attempts <= MAX_TILE_RETRIES) {
      // Transient failure: drop the broken image so the next render re-creates
      // and re-fetches it (self-heal), instead of caching a
      // `complete && naturalWidth===0` husk that shows emoji forever.
      tileCache.delete(url);
      console.warn(`tile art failed to load (attempt ${attempts}), will retry: ${url}`);
    } else {
      // Give up after repeated failures — LEAVE the broken image cached so we
      // stop re-fetching every render; the emoji fallback stands in. (A truly
      // missing file is caught by the node --test art-integrity check.)
      console.error(`tile art gave up after ${attempts} attempts (check the file exists): ${url}`);
    }
  };
  img.src = url;
  tileCache.set(url, img);
  return img;
}

// Warm every terrain/settlement art image up front (called from attachMap) so
// tiles never first-paint as emoji and no first-time load races mid-session
// (e.g. when travel reveals a terrain type for the first time). Idempotent —
// tileImage caches, and a failed preload simply retries on the next render.
export function preloadTileArt() {
  const urls = new Set();
  for (const variants of Object.values(TERRAIN_ART)) for (const u of variants) urls.add(u);
  for (const u of Object.values(SETTLEMENT_ART)) urls.add(u);
  urls.add(KEEP_ART);
  for (const url of urls) tileImage(url);
}

function drawTerrainIcon(cx, cy, terrain, q, r) {
  // Semi-transparent so the motif recedes into the tile (settlement icons, drawn
  // fully opaque, stand out against it). Restored before returning.
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * TERRAIN_ICON_ALPHA;
  // Deterministic variant per cell so it's stable without storing it.
  const variants = artFor(terrain);
  if (variants.length) {
    const url = variants[hashString(`${q},${r}`) % variants.length];
    const img = tileImage(url);
    if (img.complete && img.naturalWidth > 0) {
      const side = HEX_SIZE * 1.9;
      ctx.drawImage(img, cx - side / 2, cy - side / 2, side, side);
      ctx.globalAlpha = prevAlpha;
      return;
    }
    // else fall through to the emoji until the SVG has loaded
  }
  const glyph = iconForTerrain(terrain, hashString(`${q},${r}`) % 2);
  if (glyph) {
    ctx.font = `${HEX_SIZE * 0.9}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, cx, cy);
  }
  ctx.globalAlpha = prevAlpha;
}

// Detail tier: settlement sketch centered + enlarged (it stands in for the
// terrain motif, which is skipped on settled tiles; corner-marker fallback until
// the SVG loads) + POI emoji badge bottom-right (glyph for 1, count for >1).
function drawDetailMarkers(cx, cy, hex) {
  const off = HEX_SIZE * 0.5;
  const size = HEX_SIZE * 0.44;

  if (hex.settlement && hex.settlement.present) {
    const url = settlementArt(hex.settlement.size, hex.settlement.kind);
    const img = url ? tileImage(url) : null;
    if (img && img.complete && img.naturalWidth > 0) {
      const side = HEX_SIZE * 1.9; // same footprint the terrain motif used
      ctx.drawImage(img, cx - side / 2, cy - side / 2, side, side);
    } else {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const ms = HEX_SIZE * 0.85;
      ctx.font = `${ms}px sans-serif`;
      drawMarker(cx, cy, settlementMark(hex.settlement.size, hex.settlement.kind), ms, "#fff");
    }
  }

  const pois = Array.isArray(hex.pois) ? hex.pois : [];
  if (pois.length) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${size}px sans-serif`;
    const label = pois.length === 1 ? glyphForPoi(pois[0]) : String(pois.length);
    drawMarker(cx + off, cy + off, label, size, pois.length === 1 ? undefined : "#fff");
  }

  // A note indicator (bottom-left) for hexes carrying GM notes.
  if (hex.note) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${size}px sans-serif`;
    drawMarker(cx - off, cy + off, "🗒", size, "#fff");
  }

  // Only a GM's explicit hex name labels the map by default. A settlement's
  // derived name is shown on HOVER only (see the hover pass in render()) — auto
  // labels on every town cluttered the map.
  if (hex.name && labelsEnabled) drawHexLabel(cx, cy, hex.name);
}

// The faction (if any) that runs hex (q, r), with its map colour — for the
// hover readout. Returns null when the hex is unowned.
function factionAt(q, r) {
  if (!world || !Array.isArray(world.factions)) return null;
  const key = axialKey(q, r);
  for (let i = 0; i < world.factions.length; i++) {
    const f = world.factions[i];
    if ((f.holdings || []).some((h) => axialKey(h.q, h.r) === key)) {
      return { name: f.name || "Faction", color: factionColor(i) };
    }
  }
  return null;
}

// A small pill below the hex (legible over terrain art). `label` is a string or
// an array of lines, each a string or a { text, color } for a coloured line.
function drawHexLabel(cx, cy, label) {
  const lines = (Array.isArray(label) ? label : [label])
    .map((l) => (typeof l === "string" ? { text: l, color: MAP.labelInk } : l))
    .map((l) => ({ color: l.color || MAP.labelInk, text: l.text.length > 20 ? l.text.slice(0, 19) + "…" : l.text }));
  if (!lines.length) return;
  const fs = Math.max(8, HEX_SIZE * 0.34);
  ctx.font = `${fs}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l.text).width);
  const padX = fs * 0.45, padY = fs * 0.3, lineH = fs * 1.25;
  const bw = maxW + padX * 2;
  const bh = lineH * lines.length + padY * 2 - (lineH - fs);
  const bx = cx - bw / 2, by = cy + HEX_SIZE * 0.6;
  ctx.fillStyle = MAP.labelBg;
  ctx.fillRect(bx, by, bw, bh);
  ctx.lineWidth = 1 / camera.scale;
  ctx.strokeStyle = MAP.labelEdge;
  ctx.strokeRect(bx, by, bw, bh);
  lines.forEach((l, i) => {
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, cx, by + padY + lineH * i + fs * 0.5);
  });
}

// Simplified tier (zoomed out): settlement size-marker centered on the tile +
// a dot at the bottom when the hex has any POIs — coloured by type for a
// single POI, or a neutral dot carrying the count for several (Phase 7.9).
function drawSimplifiedMarkers(cx, cy, hex) {
  if (hex.settlement && hex.settlement.present) {
    const size = HEX_SIZE * 0.8;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${size}px sans-serif`;
    drawMarker(cx, cy, settlementMark(hex.settlement.size, hex.settlement.kind), size, "#fff");
  }
  const pois = Array.isArray(hex.pois) ? hex.pois : [];
  if (pois.length) {
    const multi = pois.length > 1;
    const r = HEX_SIZE * (multi ? 0.24 : 0.18);
    const dotY = cy + HEX_SIZE * 0.58;
    ctx.beginPath();
    ctx.arc(cx, dotY, r, 0, Math.PI * 2);
    ctx.fillStyle = multi ? "#3a3f4b" : poiDotColor(pois[0].type);
    ctx.fill();
    ctx.lineWidth = HEX_SIZE * 0.05;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
    if (multi) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${HEX_SIZE * 0.26}px sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.fillText(String(pois.length), cx, dotY);
    }
  }
}

// Hook destination: an amber hex ring (visible at every zoom) and, in the detail
// tier, a flag badge in the free top-left corner.
function drawHookMark(cx, cy, detail) {
  strokeHex(cx, cy, "rgba(245,196,90,0.95)", 2.5);
  if (detail) {
    const off = HEX_SIZE * 0.5;
    const size = HEX_SIZE * 0.44;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${size}px sans-serif`;
    drawMarker(cx - off, cy - off, "⚑", size, "#f5c45a");
  }
}

// Pinned (active-lead) destination: a violet ring + a pin badge in the detail tier.
function drawPinnedMark(cx, cy, detail) {
  strokeHex(cx, cy, "#b794f6", 3);
  if (detail) {
    const off = HEX_SIZE * 0.5;
    const size = HEX_SIZE * 0.44;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${size}px sans-serif`;
    drawMarker(cx - off, cy - off, "📌", size, "#b794f6");
  }
}

// Faction holding (Phase 8.7): just a hex ring in the faction's colour. The old
// banner badge was dropped (8.15) — it hid the POI glyph on a held hex, and the
// coloured border alone reads clearly enough as "this faction runs it".
// --- Faction territory (Phase 11.4) -------------------------------------
// A power's holdings render as a translucent colour wash + a per-faction hatch
// (the colour-blind-safe differentiator), an inked border around the territory's
// outer edge, and a star on the seat. Fill/hatch are drawn early (under the
// network + markers); the border/seat late (over them).

const FACTION_FILL_ALPHA = 0.3; // base wash; the highlighted faction goes bolder
const HATCH_MIN_ONSCREEN = 16; // px/hex below which the fine hatch is skipped
const FACTION_INK = "rgba(40,28,10,0.55)"; // dark casing so a border reads on any terrain

let highlightFaction = null; // index of the faction to emphasise on hover (or null)

/** Emphasise one faction's territory on the map (by roster index; null clears). */
export function setFactionHighlight(index) {
  const next = index == null ? null : index;
  if (next === highlightFaction) return;
  highlightFaction = next;
  render();
}

function rgba(hex, a) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// A hex colour mixed toward black by factor f (0 = unchanged, 1 = black), at
// alpha a — used to darken the hatch lines so they read on light terrain.
function darkenRgba(hex, f, a) {
  const [r, g, b] = parseHex(hex).map((v) => Math.round(v * (1 - f)));
  return `rgba(${r},${g},${b},${a})`;
}

function offView(p, minX, minY, maxX, maxY, margin) {
  return p.x < minX - margin || p.x > maxX + margin || p.y < minY - margin || p.y > maxY + margin;
}

// Parallel hatch lines filling the current hex (call inside a hex clip).
function hatchHex(cx, cy, deg, color, strong) {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad); // line direction
  const nx = -dy, ny = dx; // step direction (perpendicular)
  const R = HEX_SIZE * 1.15;
  const gap = strong ? 5.5 : 6.5;
  ctx.strokeStyle = darkenRgba(color, 0.35, strong ? 0.85 : 0.6);
  ctx.lineWidth = (strong ? 1.5 : 1.15) / camera.scale;
  for (let t = -R; t <= R; t += gap) {
    ctx.beginPath();
    ctx.moveTo(cx + nx * t - dx * R, cy + ny * t - dy * R);
    ctx.lineTo(cx + nx * t + dx * R, cy + ny * t + dy * R);
    ctx.stroke();
  }
}

function drawFactionFill(minX, minY, maxX, maxY, margin, onScreen) {
  if (!world || !Array.isArray(world.factions)) return;
  const withHatch = onScreen >= HATCH_MIN_ONSCREEN;
  world.factions.forEach((f, i) => {
    const color = factionColor(i);
    const deg = factionHatchDeg(i);
    const hi = i === highlightFaction;
    const fillA = hi ? 0.46 : FACTION_FILL_ALPHA;
    for (const hold of f.holdings || []) {
      const c = axialToPixel(hold.q, hold.r, HEX_SIZE);
      if (offView(c, minX, minY, maxX, maxY, margin)) continue;
      hexPath(c.x, c.y);
      ctx.fillStyle = rgba(color, fillA);
      ctx.fill();
      if (withHatch) {
        ctx.save();
        hexPath(c.x, c.y);
        ctx.clip();
        hatchHex(c.x, c.y, deg, color, hi);
        ctx.restore();
      }
    }
  });
}

// Stroke every outer edge of a faction's territory (edges bordering a hex the
// faction doesn't own). Called twice per faction: a dark casing, then the colour.
function strokeTerritoryEdges(holdings, owned, minX, minY, maxX, maxY, margin, style, width) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width / camera.scale;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const h of holdings) {
    const c = axialToPixel(h.q, h.r, HEX_SIZE);
    if (offView(c, minX, minY, maxX, maxY, margin)) continue;
    const corners = hexCorners(c.x, c.y, HEX_SIZE);
    for (let dir = 0; dir < 6; dir++) {
      const [dq, dr] = NEIGHBOR_DIRS[dir];
      if (owned.has(axialKey(h.q + dq, h.r + dr))) continue; // shared edge — interior
      const e = (6 - dir) % 6; // neighbour dir -> the hex edge it shares
      const a = corners[e], b = corners[(e + 1) % 6];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

function drawFactionOutline(minX, minY, maxX, maxY, margin) {
  if (!world || !Array.isArray(world.factions)) return;
  world.factions.forEach((f, i) => {
    const holdings = f.holdings || [];
    if (!holdings.length) return;
    const color = factionColor(i);
    const hi = i === highlightFaction;
    const owned = new Set(holdings.map((h) => axialKey(h.q, h.r)));
    const w = hi ? 4 : 2.8;
    // Highlighted faction blooms first (a wide, soft colour glow under the line).
    if (hi) strokeTerritoryEdges(holdings, owned, minX, minY, maxX, maxY, margin, rgba(color, 0.35), w + 6);
    // Dark casing so the border reads on light AND dark terrain, then the colour.
    strokeTerritoryEdges(holdings, owned, minX, minY, maxX, maxY, margin, FACTION_INK, w + 2);
    strokeTerritoryEdges(holdings, owned, minX, minY, maxX, maxY, margin, color, w);
    if (f.seat) {
      const sc = axialToPixel(f.seat.q, f.seat.r, HEX_SIZE);
      if (!offView(sc, minX, minY, maxX, maxY, margin))
        drawSeatMark(sc.x, sc.y, color, LORD_ARCHETYPES.includes(f.archetype));
    }
  });
}

// The seat (HQ): a small coin with a star, in the top-right corner of the hex so
// it doesn't cover a settlement/POI icon in the centre.
function drawSeatMark(cx, cy, color, isLord = false) {
  const off = HEX_SIZE * 0.5;
  const x = cx + off, y = cy - off;
  const r = HEX_SIZE * 0.24;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.4 / camera.scale;
  ctx.strokeStyle = "rgba(40,28,10,0.65)";
  ctx.stroke();
  if (isLord) {
    // A wax-seal-red ring flags a lord seat (lich/dragon/hag…) as a boss power,
    // distinct from a rank-and-file seat's plain coin. Ring is the primary
    // signal (guaranteed to render); the crown glyph reinforces it.
    ctx.beginPath();
    ctx.arc(x, y, r * 1.32, 0, Math.PI * 2);
    ctx.lineWidth = 2.2 / camera.scale;
    ctx.strokeStyle = "#8a3324"; // matches the encounter-alert red
    ctx.stroke();
  }
  ctx.fillStyle = "#f4ead2";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${r * 1.6}px serif`;
  ctx.fillText(isLord ? "♚" : "★", x, y + r * 0.08);
}

// The last move's trail: a dark-cased gold dashed line through the hex centres
// the party crossed, with a dot at each hex entered — so a multi-hex day reads.
function drawTravelPath() {
  if (!travelPath || travelPath.length < 2) return;
  const pts = travelPath.map((c) => axialToPixel(c.q, c.r, HEX_SIZE));
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  };
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(40,28,10,0.5)"; // dark casing
  ctx.lineWidth = 4.5 / camera.scale;
  trace();
  ctx.stroke();
  ctx.strokeStyle = "#c8892b"; // gold trail
  ctx.lineWidth = 2.2 / camera.scale;
  ctx.setLineDash([6 / camera.scale, 5 / camera.scale]);
  trace();
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 1; i < pts.length; i++) {
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, 3.5 / camera.scale, 0, Math.PI * 2);
    ctx.fillStyle = "#c8892b";
    ctx.fill();
    ctx.lineWidth = 1.2 / camera.scale;
    ctx.strokeStyle = "rgba(40,28,10,0.6)";
    ctx.stroke();
  }
  ctx.restore();
}

// A star on each route hex where a wilderness encounter came up (9.7) — the app
// flags WHERE; the GM rolls WHAT on their own tables. Drawn over the travel trail,
// nudged up off the route dot; scales with zoom like the other glyph markers.
function drawEncounterMarks() {
  if (!encounterMarks || !encounterMarks.length) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.font = `${HEX_SIZE * 0.78}px sans-serif`;
  ctx.lineWidth = HEX_SIZE * 0.14;
  for (const m of encounterMarks) {
    const c = axialToPixel(m.q, m.r, HEX_SIZE);
    const y = c.y - HEX_SIZE * 0.14; // sit above the route dot
    ctx.strokeStyle = "rgba(250,241,222,0.95)"; // parchment halo for contrast
    ctx.strokeText("★", c.x, y);
    ctx.fillStyle = "#8a3324"; // wax-seal red — an encounter alert
    ctx.fillText("★", c.x, y);
  }
  ctx.restore();
}

// Party position (Phase 8.1): a bold magenta ring — a colour not already used
// by hooks (amber/violet) or hook-focus (red/teal) — plus a crossed-swords
// badge in the detail tier. Visible at every zoom, same convention as hooks.
const PARTY_COLOR = "#ff4fd8";
function drawPartyMark(cx, cy, detail) {
  strokeHex(cx, cy, PARTY_COLOR, 3.5);
  if (detail) {
    const off = HEX_SIZE * 0.5;
    const size = HEX_SIZE * 0.5;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${size}px sans-serif`;
    drawMarker(cx + off, cy - off, "⚔️", size, PARTY_COLOR);
  }
}

function drawMarker(x, y, text, size, textColor) {
  ctx.beginPath();
  ctx.arc(x, y, size * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill();
  ctx.fillStyle = textColor || "#fff"; // emoji ignore this; counts/text use it
  ctx.fillText(text, x, y);
}

function drawEmptyGrid(minX, minY, maxX, maxY) {
  // Axial bbox covering the visible rect corners, padded by 1.
  const corners = [
    pixelToAxialFractional(minX, minY, HEX_SIZE),
    pixelToAxialFractional(maxX, minY, HEX_SIZE),
    pixelToAxialFractional(minX, maxY, HEX_SIZE),
    pixelToAxialFractional(maxX, maxY, HEX_SIZE),
  ];
  const qs = corners.map((c) => c.q);
  const rs = corners.map((c) => c.r);
  const qMin = Math.floor(Math.min(...qs)) - 1;
  const qMax = Math.ceil(Math.max(...qs)) + 1;
  const rMin = Math.floor(Math.min(...rs)) - 1;
  const rMax = Math.ceil(Math.max(...rs)) + 1;

  if ((qMax - qMin + 1) * (rMax - rMin + 1) > MAX_GRID_CELLS) return;

  for (let r = rMin; r <= rMax; r++) {
    for (let q = qMin; q <= qMax; q++) {
      const hex = world.hexes[axialKey(q, r)];
      if (hex && hex.placed) continue; // filled cells drawn separately
      const c = axialToPixel(q, r, HEX_SIZE);
      strokeHex(c.x, c.y, "rgba(255,255,255,0.10)", 1);
    }
  }
}

function hexPath(cx, cy) {
  const pts = hexCorners(cx, cy, HEX_SIZE);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function drawHexFill(cx, cy, fill) {
  hexPath(cx, cy);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1 / camera.scale;
  ctx.strokeStyle = MAP.hexBorder;
  ctx.stroke();
}

function strokeHex(cx, cy, color, widthPx) {
  hexPath(cx, cy);
  ctx.lineWidth = widthPx / camera.scale; // visually constant
  ctx.strokeStyle = color;
  ctx.stroke();
}

// --- input ---------------------------------------------------------------

function onPointerDown(e) {
  if (e.pointerType !== "touch" && e.button !== 0) return; // mouse: only the primary button pans
  try { canvas.setPointerCapture?.(e.pointerId); } catch { /* stray/synthetic pointer id */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    // Second finger down → pinch-zoom; abandon any pan / long-press.
    drag = null;
    clearTimeout(longPressTimer);
    pinchPrev = null;
    canvas.classList.remove("dragging");
    return;
  }

  drag = { startX: e.clientX, startY: e.clientY, startOffsetX: camera.offsetX, startOffsetY: camera.offsetY, moved: false };
  canvas.classList.add("dragging");
  // Touch has no right-click: a stationary long-press opens the radial instead.
  if (e.pointerType === "touch") {
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      if (drag && !drag.moved && pointers.size === 1) {
        const { x, y } = clientToWorld(e.clientX, e.clientY);
        const { q, r } = pixelToAxial(x, y, HEX_SIZE);
        drag = null; // consume — no tap-select on release
        canvas.classList.remove("dragging");
        handlers.onContextMenu?.({ q, r, clientX: e.clientX, clientY: e.clientY });
      }
    }, 500);
  }
}

// Right-click resolves the cell under the cursor and reports it (with the screen
// position) so app.js can open the radial menu there.
function onContextMenu(e) {
  e.preventDefault();
  const { x, y } = clientToWorld(e.clientX, e.clientY);
  const { q, r } = pixelToAxial(x, y, HEX_SIZE);
  handlers.onContextMenu?.({ q, r, clientX: e.clientX, clientY: e.clientY });
}

// Double-click resolves the cell and reports it (with the screen position) so
// app.js can open the travel radial when it's the party's hex (Phase 11.5).
function onDblClick(e) {
  const { x, y } = clientToWorld(e.clientX, e.clientY);
  const { q, r } = pixelToAxial(x, y, HEX_SIZE);
  handlers.onDblClick?.({ q, r, clientX: e.clientX, clientY: e.clientY });
}

function onPointerMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // Two fingers → pinch-zoom around their midpoint.
  if (pointers.size === 2) {
    const [p1, p2] = [...pointers.values()];
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (pinchPrev && dist > 0) zoomAt(camera.scale * (dist / pinchPrev), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    pinchPrev = dist;
    return;
  }

  if (drag) {
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      drag.moved = true;
      clearTimeout(longPressTimer); // a drag isn't a long-press
    }
    camera.offsetX = drag.startOffsetX + dx;
    camera.offsetY = drag.startOffsetY + dy;
    render();
    return;
  }
  // Hover feedback: outline the hex under the cursor + report it (only when the
  // hex changes, so we don't re-render on every pixel of movement).
  const { x, y } = clientToWorld(e.clientX, e.clientY);
  const { q, r } = pixelToAxial(x, y, HEX_SIZE);
  const key = axialKey(q, r);
  if (key !== hoverKey) {
    hoverKey = key;
    hovered = { q, r };
    render();
    handlers.onHover?.({ q, r });
  }
}

function onPointerLeave() {
  drag = null;
  if (hovered) {
    hovered = null;
    hoverKey = null;
    render();
    handlers.onHover?.(null);
  }
}

function onPointerUp(e) {
  clearTimeout(longPressTimer);
  canvas.classList.remove("dragging");
  const wasPinch = pointers.size >= 2;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchPrev = null;
  if (!wasPinch && drag && !drag.moved) {
    const { x, y } = clientToWorld(e.clientX, e.clientY);
    const { q, r } = pixelToAxial(x, y, HEX_SIZE);
    const hex = world && world.hexes[`${q},${r}`];
    if (hex && hex.placed) handlers.onHexClick({ q, r });
    else handlers.onEmptyCellClick({ q, r });
  }
  drag = null;
}

function onPointerCancel(e) {
  clearTimeout(longPressTimer);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchPrev = null;
  drag = null;
  canvas.classList.remove("dragging");
}

function onWheel(e) {
  e.preventDefault();
  zoomAt(camera.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY);
}
