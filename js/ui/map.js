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
} from "../core/hexgeo.js";
import { hashString } from "../core/rng.js";
import { placedHexes } from "../world/world.js";
import {
  colorForTerrain,
  iconForTerrain,
  SELECTED_STROKE,
} from "./terrain-style.js";
import { glyphForPoi } from "./poi-style.js";
import { artFor } from "./terrain-art.js";
import { settlementArt, settlementMark } from "./settlement-art.js";
import { settlementName } from "../gen/settlement-name.js";

const HEX_SIZE = 28; // center-to-corner, world px
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;
const DRAG_THRESHOLD = 4; // px before a press counts as a drag (not a click)
const MAX_GRID_CELLS = 4000; // skip empty-cell outlines when zoomed way out
const DETAIL_PX = 26; // at/above: pencil sketches + corner markers (drop to small view sooner)
const MARK_MIN_PX = 7; // below: nothing; between: simplified dots
const TERRAIN_ICON_ALPHA = 0.45; // terrain motifs recede into the background; settlements stay opaque

let canvas = null;
let ctx = null;
let dpr = 1;
let world = null;
let selected = null; // { q, r } | null
let camera = { offsetX: 0, offsetY: 0, scale: 1 }; // CSS-pixel space
let drag = null;
let iconsEnabled = true;
let labelsEnabled = true; // show hex name labels on the map
let hovered = null; // { q, r } under the cursor | null
let hoverKey = null; // axialKey of `hovered`, to skip redundant re-renders
let lastPpm = null; // last pixels-per-mile emitted to onView (fire only on change)
let hookTargets = new Set(); // axial keys "q,r" of open, unpinned hook destinations
let pinnedTargets = new Set(); // axial keys of PINNED (active-lead) hook destinations
let riverDraft = null; // in-progress manual river being drawn: [{q,r}, ...] | null
let handlers = { onHexClick: () => {}, onEmptyCellClick: () => {} };

/** Attach the renderer to a canvas. Call once. */
export function attachMap(canvasEl, cbs = {}) {
  canvas = canvasEl;
  ctx = canvas.getContext("2d");
  handlers = { ...handlers, ...cbs };

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", () => (drag = null));
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);

  resize();
}

export function setWorld(w) {
  world = w;
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
export function zoomStep(dir) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const px = rect.left + rect.width / 2;
  const py = rect.top + rect.height / 2;
  const before = clientToWorld(px, py);
  const factor = dir > 0 ? 1.2 : 1 / 1.2;
  camera.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
  const after = clientToWorld(px, py);
  camera.offsetX += (after.x - before.x) * camera.scale;
  camera.offsetY += (after.y - before.y) * camera.scale;
  render();
}

/** Recenter on placed content (its centroid), or the origin if the map is empty. */
export function recenter() {
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
    // Terrain motif is background (under the network); a settled tile skips it —
    // its settlement marker (drawn later, over the roads) stands in for it.
    if (detail && !(hex.settlement && hex.settlement.present)) drawTerrainIcon(c.x, c.y, hex.terrain, q, r);
    visible.push({ hex, c });
  }

  // 2a. Rivers then roads — both UNDER the markers below, and roads OVER rivers so
  //     a crossing reads as a bridge (solid trunk) or ford (dashed spur). Roads
  //     are nudged off-centre so one running along a river sits beside it rather
  //     than hiding it (see drawRoads).
  drawRivers(minX, minY, maxX, maxY, margin);
  drawRiverDraft(); // the manual river being traced (if any), on top
  drawRoads(minX, minY, maxX, maxY, margin);

  // 2a″. Markers on placed hexes (settlement/POI + hook rings), on top of the
  //      water/road network so the icons stay legible.
  for (const { hex, c } of visible) {
    if (detail) drawDetailMarkers(c.x, c.y, hex);
    else if (simplified) drawSimplifiedMarkers(c.x, c.y, hex);
    // Hook destinations: pinned leads (a distinct pin) take precedence over the
    // amber "a lead exists here" ring; both visible at all zooms.
    const hk = axialKey(hex.coords.q, hex.coords.r);
    if (pinnedTargets.has(hk)) drawPinnedMark(c.x, c.y, detail);
    else if (hookTargets.has(hk)) drawHookMark(c.x, c.y, detail);
  }

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
    strokeHex(c.x, c.y, "rgba(230,232,238,0.35)", 2);
    // Reveal a settlement's name on hover (names are hidden by default). A GM's
    // own hex name takes precedence; drawn on top of everything else here.
    const hh = world && world.hexes[axialKey(hovered.q, hovered.r)];
    if (detail && hh && hh.placed) {
      const label = hh.name
        || (hh.settlement && hh.settlement.present
          ? settlementName(world.seed, hovered.q, hovered.r, hh.gen, { kind: hh.settlement.kind, terrain: hh.terrain })
          : null);
      if (label) drawHexLabel(c.x, c.y, label);
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

// Rivers (Phase 3R.5, "curated rivers"): each world.rivers[] entry is a full
// watercourse traced from a source to the sea (js/gen/river-trace.js), stored
// as `path` — an array of axial coords, source-first. We draw the whole thing
// as ONE smooth blue polyline through the hex CENTRES, including across hexes
// the GM hasn't generated yet, so a river reads as a complete, sea-reaching
// watercourse rather than a stub that dies at the first pond (the whole point
// of the rework). Solid blue, rounded joins; a cheap bounding-box cull skips
// rivers entirely off-screen, and the canvas clips the rest, so a long river
// only really costs its visible span.
const RIVER_COLOR = "#6fd0f0";
const RIVER_WIDTH = 3.4; // world px at scale 1 (before the /camera.scale divide)

// Roads (3R.7): tiered tan polylines linking settlements. Tier 1 highways
// (City–City) are widest, tier 3 tracks/spurs thinnest and dashed. A dark casing
// under the fill lifts them off the terrain. Widths are world px at scale 1.
const ROAD_TIERS = {
  1: { width: 4.4, color: "#d9b25c" }, // highway (City–City)
  2: { width: 2.9, color: "#c39a54" }, // road
  3: { width: 2.6, color: "#c69a58", dash: [7, 4] }, // track / spur (dashed = ford)
};
const ROAD_CASING = "#4a3a1f";
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

function drawRivers(minX, minY, maxX, maxY, margin) {
  if (!world || !Array.isArray(world.rivers) || !world.rivers.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = RIVER_COLOR;
  ctx.lineWidth = RIVER_WIDTH / camera.scale;
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
// direction, to the left of a->b). Used so a road hugging a river valley draws
// beside the river instead of on top of it.
function offsetPolyline(pts, off) {
  if (!off || pts.length < 2) return pts;
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    out[i] = { x: pts[i].x - ty * off, y: pts[i].y + tx * off }; // left-normal
  }
  return out;
}

// Roads (3R.7): one pass over world.roads[], drawn on top of rivers so a crossing
// reads as a bridge. Each is a smoothed tan polyline through hex centres, tiered
// by width/colour, with a dark casing under the fill for contrast. Whole-road
// bounding-box cull like rivers; endpoints trimmed half a segment so the centred
// settlement icon stays clean where the road arrives.
function drawRoads(minX, minY, maxX, maxY, margin) {
  if (!world || !Array.isArray(world.roads) || !world.roads.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const road of world.roads) {
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
    strokeRoad(offsetPolyline(pts, ROAD_OFFSET), road);
  }
  ctx.restore();
}

function strokeRoad(pts, road) {
  const spec = ROAD_TIERS[road.tier] || ROAD_TIERS[2];
  const w = spec.width / camera.scale;
  ctx.save();
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

// Cache of tile <img>s keyed by url; re-render once each finishes loading.
const tileCache = new Map();
function tileImage(url) {
  let img = tileCache.get(url);
  if (img) return img;
  img = new Image();
  img.onload = () => render();
  img.onerror = () => {};
  img.src = url;
  tileCache.set(url, img);
  return img;
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

// A user's hex name, as a small pill below the hex (legible over terrain art).
function drawHexLabel(cx, cy, name) {
  const fs = Math.max(8, HEX_SIZE * 0.34);
  ctx.font = `${fs}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = name.length > 18 ? name.slice(0, 17) + "…" : name;
  const w = ctx.measureText(text).width;
  const padX = fs * 0.4;
  const y = cy + HEX_SIZE * 0.66;
  ctx.fillStyle = "rgba(13,15,21,0.72)";
  ctx.fillRect(cx - w / 2 - padX, y - fs * 0.7, w + padX * 2, fs * 1.4);
  ctx.fillStyle = "#e6e8ee";
  ctx.fillText(text, cx, y);
}

// Simplified tier (zoomed out): settlement size-marker centered on the tile +
// a red dot at the bottom when the hex has any POIs.
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
    const r = HEX_SIZE * 0.18;
    ctx.beginPath();
    ctx.arc(cx, cy + HEX_SIZE * 0.58, r, 0, Math.PI * 2);
    ctx.fillStyle = "#d23b3b";
    ctx.fill();
    ctx.lineWidth = HEX_SIZE * 0.05;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
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
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
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
  if (e.button !== 0) return; // primary button pans; the right button opens the ring
  drag = {
    startX: e.clientX,
    startY: e.clientY,
    startOffsetX: camera.offsetX,
    startOffsetY: camera.offsetY,
    moved: false,
  };
  canvas.setPointerCapture?.(e.pointerId);
  canvas.classList.add("dragging");
}

// Right-click resolves the cell under the cursor and reports it (with the screen
// position) so app.js can open the radial menu there.
function onContextMenu(e) {
  e.preventDefault();
  const { x, y } = clientToWorld(e.clientX, e.clientY);
  const { q, r } = pixelToAxial(x, y, HEX_SIZE);
  handlers.onContextMenu?.({ q, r, clientX: e.clientX, clientY: e.clientY });
}

function onPointerMove(e) {
  if (drag) {
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      drag.moved = true;
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
  canvas.classList.remove("dragging");
  if (drag && !drag.moved) {
    const { x, y } = clientToWorld(e.clientX, e.clientY);
    const { q, r } = pixelToAxial(x, y, HEX_SIZE);
    const hex = world && world.hexes[`${q},${r}`];
    if (hex && hex.placed) handlers.onHexClick({ q, r });
    else handlers.onEmptyCellClick({ q, r });
  }
  drag = null;
}

function onWheel(e) {
  e.preventDefault();
  const before = clientToWorld(e.clientX, e.clientY);
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  camera.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
  const after = clientToWorld(e.clientX, e.clientY);
  camera.offsetX += (after.x - before.x) * camera.scale;
  camera.offsetY += (after.y - before.y) * camera.scale;
  render();
}
