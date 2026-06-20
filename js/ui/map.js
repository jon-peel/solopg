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
import { glyphForPoiType } from "./poi-style.js";
import { artFor } from "./terrain-art.js";
import { settlementArt, settlementMark } from "./settlement-art.js";

const HEX_SIZE = 28; // center-to-corner, world px
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;
const DRAG_THRESHOLD = 4; // px before a press counts as a drag (not a click)
const MAX_GRID_CELLS = 4000; // skip empty-cell outlines when zoomed way out
const DETAIL_PX = 26; // at/above: pencil sketches + corner markers (drop to small view sooner)
const MARK_MIN_PX = 7; // below: nothing; between: simplified dots

let canvas = null;
let ctx = null;
let dpr = 1;
let world = null;
let selected = null; // { q, r } | null
let camera = { offsetX: 0, offsetY: 0, scale: 1 }; // CSS-pixel space
let drag = null;
let iconsEnabled = true;
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
  canvas.addEventListener("wheel", onWheel, { passive: false });

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

/** Center the camera on axial cell (q, r). */
export function recenterOn(q, r) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const p = axialToPixel(q, r, HEX_SIZE);
  camera.offsetX = rect.width / 2 - p.x * camera.scale;
  camera.offsetY = rect.height / 2 - p.y * camera.scale;
  render();
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
    if (detail) {
      drawTerrainIcon(c.x, c.y, hex.terrain, q, r);
      drawDetailMarkers(c.x, c.y, hex);
    } else if (simplified) {
      drawSimplifiedMarkers(c.x, c.y, hex);
    }
  }

  // 3. Selection highlight on top (works for empty or filled cells).
  if (selected) {
    const c = axialToPixel(selected.q, selected.r, HEX_SIZE);
    strokeHex(c.x, c.y, SELECTED_STROKE, 3);
  }
}

/** Toggle terrain icons; re-renders. */
export function setIconsEnabled(on) {
  iconsEnabled = !!on;
  render();
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
  // Deterministic variant per cell so it's stable without storing it.
  const variants = artFor(terrain);
  if (variants.length) {
    const url = variants[hashString(`${q},${r}`) % variants.length];
    const img = tileImage(url);
    if (img.complete && img.naturalWidth > 0) {
      const side = HEX_SIZE * 1.9;
      ctx.drawImage(img, cx - side / 2, cy - side / 2, side, side);
      return;
    }
    // else fall through to the emoji until the SVG has loaded
  }
  const glyph = iconForTerrain(terrain, hashString(`${q},${r}`) % 2);
  if (!glyph) return;
  ctx.font = `${HEX_SIZE * 0.9}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, cx, cy);
}

// Detail tier: settlement sketch top-right (corner-marker fallback until the SVG
// loads) + POI emoji badge bottom-right (glyph for 1, count for >1).
function drawDetailMarkers(cx, cy, hex) {
  const off = HEX_SIZE * 0.5;
  const size = HEX_SIZE * 0.44;

  if (hex.settlement && hex.settlement.present) {
    const sx = cx + off;
    const sy = cy - off;
    const url = settlementArt(hex.settlement.size);
    const img = url ? tileImage(url) : null;
    if (img && img.complete && img.naturalWidth > 0) {
      const side = HEX_SIZE * 1.0;
      ctx.drawImage(img, sx - side / 2, sy - side / 2, side, side);
    } else {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${size}px sans-serif`;
      drawMarker(sx, sy, settlementMark(hex.settlement.size), size, "#fff");
    }
  }

  const pois = Array.isArray(hex.pois) ? hex.pois : [];
  if (pois.length) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${size}px sans-serif`;
    const label = pois.length === 1 ? glyphForPoiType(pois[0].type) : String(pois.length);
    drawMarker(cx + off, cy + off, label, size, pois.length === 1 ? undefined : "#fff");
  }
}

// Simplified tier (zoomed out): settlement size-marker centered on the tile +
// a red dot at the bottom when the hex has any POIs.
function drawSimplifiedMarkers(cx, cy, hex) {
  if (hex.settlement && hex.settlement.present) {
    const size = HEX_SIZE * 0.8;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${size}px sans-serif`;
    drawMarker(cx, cy, settlementMark(hex.settlement.size), size, "#fff");
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

function onPointerMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
    drag.moved = true;
  }
  camera.offsetX = drag.startOffsetX + dx;
  camera.offsetY = drag.startOffsetY + dy;
  render();
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
