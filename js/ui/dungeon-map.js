// Dungeon level renderer (Phase 4 arc) — browser-only, not unit-tested.
//
// Draws one level's layout (from js/gen/dungeon-layout.js) on its own canvas:
// corridors as muted cells, rooms tinted by stocked content, room numbers, and
// the entrance highlighted. Fit-to-view (no pan/zoom). Reports room clicks via a
// callback. The layout math lives in the (tested) generator; this just paints.

const CONTENT_FILL = {
  Monster: "#7c3b32",
  Trap: "#7c6b32",
  Empty: "#2f3542",
  Special: "#3b4b7c",
};
const CORRIDOR_FILL = "#262b36";
const DOOR_FILL = { door: "#caa46a", locked: "#c0524a", stuck: "#c98a3a" };
const ROOM_STROKE = "#11131a";
const ENTRANCE_STROKE = "#5fbf77";
const SELECTED_STROKE = "#6ea8fe";
const PAD = 16; // px border inside the canvas

let canvas = null;
let ctx = null;
let dpr = 1;
let level = null; // { layout, rooms, ... }
let selectedRoom = null;
let onRoomClick = () => {};
let hitRects = []; // { n, x, y, w, h } in CSS px, for click testing

/** Attach the renderer to a canvas. Call once. */
export function attachDungeon(canvasEl, cbs = {}) {
  canvas = canvasEl;
  ctx = canvas.getContext("2d");
  if (cbs.onRoomClick) onRoomClick = cbs.onRoomClick;
  new ResizeObserver(() => resize()).observe(canvas);
  canvas.addEventListener("pointerdown", onPointerDown);
  resize();
}

/** Show a level (its `.layout` + `.rooms`). Pass null to clear. */
export function setLevel(lvl) {
  level = lvl;
  selectedRoom = null;
  // The canvas may have been sized while its container was hidden; re-measure
  // now that the view is visible so the backing store matches (resize renders).
  resize();
}

export function setSelectedRoom(n) {
  selectedRoom = n;
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

// Content lookup for a room number, from the level's stocked rooms.
function contentFor(n) {
  const room = (level.rooms || []).find((r) => r.n === n);
  return room ? room.content : "Empty";
}

// Bounding box (in grid cells) of all drawn cells, so we can crop the empty grid.
function boundingBox(layout) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const fold = (x, y, w = 1, h = 1) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  };
  for (const r of layout.rooms) fold(r.x, r.y, r.w, r.h);
  for (const c of layout.corridors) fold(c.x, c.y);
  if (minX === Infinity) { minX = minY = 0; maxX = maxY = 1; }
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

export function render() {
  if (!ctx || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  hitRects = [];
  if (!level || !level.layout) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No map for this level.", rect.width / 2, rect.height / 2);
    return;
  }

  const layout = level.layout;
  const bb = boundingBox(layout);
  const cell = Math.max(
    4,
    Math.floor(
      Math.min((rect.width - 2 * PAD) / bb.w, (rect.height - 2 * PAD) / bb.h),
    ),
  );
  // Center the cropped layout in the canvas.
  const ox = Math.round((rect.width - bb.w * cell) / 2) - bb.minX * cell;
  const oy = Math.round((rect.height - bb.h * cell) / 2) - bb.minY * cell;
  const sx = (gx) => ox + gx * cell;
  const sy = (gy) => oy + gy * cell;

  // Corridors first (under the rooms).
  ctx.fillStyle = CORRIDOR_FILL;
  for (const c of layout.corridors) ctx.fillRect(sx(c.x), sy(c.y), cell, cell);

  // Rooms.
  ctx.lineWidth = 2;
  ctx.font = `${Math.max(9, Math.floor(cell * 1.1))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const r of layout.rooms) {
    const x = sx(r.x), y = sy(r.y), w = r.w * cell, h = r.h * cell;
    hitRects.push({ n: r.n, x, y, w, h });

    ctx.fillStyle = CONTENT_FILL[contentFor(r.n)] || CONTENT_FILL.Empty;
    ctx.fillRect(x, y, w, h);

    const entrance = r.n === layout.entrance;
    ctx.strokeStyle =
      r.n === selectedRoom ? SELECTED_STROKE : entrance ? ENTRANCE_STROKE : ROOM_STROKE;
    ctx.lineWidth = r.n === selectedRoom || entrance ? 3 : 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    ctx.fillStyle = "#e6e8ee";
    ctx.fillText(String(r.n), x + w / 2, y + h / 2);
  }

  // Doors on visible passages (open passages and secret doors draw nothing).
  // Drawn a touch larger than a cell with a bright outline so they read clearly.
  for (const d of layout.doors || []) {
    const s = Math.max(6, Math.round(cell * 0.9));
    const cx = sx(d.x) + cell / 2;
    const cy = sy(d.y) + cell / 2;
    ctx.fillStyle = DOOR_FILL[d.type] || DOOR_FILL.door;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.strokeStyle = "#f4ead2";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
  }
}

function onPointerDown(e) {
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  for (const r of hitRects) {
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      onRoomClick(r.n);
      return;
    }
  }
}
