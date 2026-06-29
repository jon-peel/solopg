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
const DOOR_FILL = { door: "#caa46a", locked: "#c0524a", stuck: "#c98a3a", secret: "#9a6fd0" };
const DOOR_SYMBOL = { locked: "L", stuck: "J", secret: "S" }; // plain door: no letter
const ROOM_STROKE = "#11131a";
const ENTRANCE_STROKE = "#5fbf77";
const SELECTED_STROKE = "#6ea8fe";
const PAD = 16; // px border inside the canvas

let canvas = null;
let ctx = null;
let dpr = 1;
let level = null; // { layout, rooms, ... }
let marks = null; // { entrance, exit, down, up } : Sets of room numbers
let frame = null; // shared {minX,minY,w,h} bounding box across all levels (or null)
let selectedRoom = null;
let onRoomClick = () => {};
let hitRects = []; // { n, x, y, w, h } in FITTED CSS px (pre-camera), for click testing
let camera = { scale: 1, x: 0, y: 0 }; // user pan/zoom on top of the fit-to-view base
let drag = null; // { x, y, moved } while a pointer is down

const MIN_SCALE = 0.5;
const MAX_SCALE = 6;
const DRAG_THRESHOLD = 4; // px before a press counts as a drag (not a click)

/** Attach the renderer to a canvas. Call once. */
export function attachDungeon(canvasEl, cbs = {}) {
  canvas = canvasEl;
  ctx = canvas.getContext("2d");
  if (cbs.onRoomClick) onRoomClick = cbs.onRoomClick;
  new ResizeObserver(() => resize()).observe(canvas);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  resize();
}

/**
 * Show a level (its `.layout` + `.rooms`). Pass null to clear.
 * @param {object|null} lvl
 * @param {{entrance:Set,exit:Set,down:Set,up:Set}|null} [m] connector marks by room.
 */
export function setLevel(lvl, m = null, f = null) {
  level = lvl;
  marks = m;
  frame = f; // shared dungeon-wide bounding box, so levels line up; null = per-level fit
  selectedRoom = null;
  // Camera is NOT reset here, so switching levels keeps the view (overlapping
  // stairs stay in place). Opening a dungeon calls fitView() to frame it.
  resize();
}

/** Reset pan/zoom to fit the whole level. */
export function fitView() {
  camera = { scale: 1, x: 0, y: 0 };
  render();
}

/** Update just the connector/state marks and redraw (keeps the selection). */
export function setMarks(m) {
  marks = m;
  render();
}

export function setSelectedRoom(n) {
  selectedRoom = n;
  render();
}

/**
 * Pan the camera so room `n` is in view, keeping the current zoom. No-op if the
 * room is already fully visible, so clicking a room you can see won't yank the
 * view — this is for stair-travel / level-switch landing off-screen.
 */
export function centerOnRoom(n) {
  if (!canvas) return;
  const hr = hitRects.find((r) => r.n === n);
  if (!hr) return;
  const rect = canvas.getBoundingClientRect();
  // Room's screen-space rect under the current camera (hitRects are pre-camera).
  const sx = camera.x + hr.x * camera.scale;
  const sy = camera.y + hr.y * camera.scale;
  const sw = hr.w * camera.scale;
  const sh = hr.h * camera.scale;
  const margin = 8;
  const visible =
    sx >= margin && sy >= margin &&
    sx + sw <= rect.width - margin && sy + sh <= rect.height - margin;
  if (visible) return;
  // Center the room's middle, keeping scale.
  const fx = hr.x + hr.w / 2;
  const fy = hr.y + hr.h / 2;
  camera.x = rect.width / 2 - fx * camera.scale;
  camera.y = rect.height / 2 - fy * camera.scale;
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

  // User pan/zoom sits on top of the fit-to-view base. Drawing + fitted hitRects
  // are computed at scale 1; the camera transform handles pan/zoom (and scales
  // text/badges, fixing tiny-cell readability when zoomed in).
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.scale, camera.scale);

  const layout = level.layout;
  const litRooms = new Set((level.rooms || []).filter((r) => r.light).map((r) => r.n));
  const treasureRooms = new Set((level.rooms || []).filter((r) => r.treasure).map((r) => r.n));
  // Use the shared dungeon-wide frame (so every level lines up) when given.
  const bb = frame || boundingBox(layout);
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

  // Square grid (10 ft cells) under everything, for spatial reference.
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1 / camera.scale;
  ctx.beginPath();
  for (let gx = bb.minX; gx <= bb.minX + bb.w; gx++) {
    ctx.moveTo(sx(gx), sy(bb.minY));
    ctx.lineTo(sx(gx), sy(bb.minY + bb.h));
  }
  for (let gy = bb.minY; gy <= bb.minY + bb.h; gy++) {
    ctx.moveTo(sx(bb.minX), sy(gy));
    ctx.lineTo(sx(bb.minX + bb.w), sy(gy));
  }
  ctx.stroke();

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

    // Warm glow for a lit room (dark is the default look) — stronger so it
    // reads at a glance, plus a lamp dot top-right for the rare lit room.
    if (litRooms.has(r.n)) {
      ctx.fillStyle = "rgba(255,168,56,0.4)";
      ctx.fillRect(x, y, w, h);
    }

    // Dim a cleared room (drawn under the number so it stays readable).
    if (marks && marks.state && marks.state[r.n] && marks.state[r.n].cleared) {
      ctx.fillStyle = "rgba(13,15,21,0.5)";
      ctx.fillRect(x, y, w, h);
    }

    const entrance = r.n === layout.entrance;
    ctx.strokeStyle =
      r.n === selectedRoom ? SELECTED_STROKE : entrance ? ENTRANCE_STROKE : ROOM_STROKE;
    ctx.lineWidth = r.n === selectedRoom || entrance ? 3 : 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    ctx.fillStyle = "#e6e8ee";
    ctx.fillText(String(r.n), x + w / 2, y + h / 2);

    // Lamp dot (top-right) marks a lit room unmistakably.
    if (litRooms.has(r.n)) {
      const rad = Math.max(2, cell * 0.22);
      const lx = x + w - rad - 2;
      const ly = y + rad + 2;
      ctx.beginPath();
      ctx.arc(lx, ly, rad, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd27a";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#7a4a10";
      ctx.stroke();
    }
  }

  // Doors on visible passages (open passages and secret doors draw nothing).
  // Drawn as a rectangle straddling the wall between room and corridor: long
  // along the wall, thin across the passage, with L/S for locked/stuck.
  for (const d of layout.doors || []) {
    const dx = d.dx || 0;
    const dy = d.dy || 0;
    // Centre on the wall line (half a cell from the corridor cell toward room).
    const wx = sx(d.x) + cell / 2 + (dx * cell) / 2;
    const wy = sy(d.y) + cell / 2 + (dy * cell) / 2;
    const long = Math.max(7, cell * 1.15); // along the wall
    const thick = Math.max(3, cell * 0.42); // across the passage (overlaps wall)
    const vertWall = dx !== 0; // room left/right -> vertical wall -> tall door
    const w = vertWall ? thick : long;
    const h = vertWall ? long : thick;

    ctx.fillStyle = DOOR_FILL[d.type] || DOOR_FILL.door;
    ctx.fillRect(wx - w / 2, wy - h / 2, w, h);
    ctx.strokeStyle = "#1a1410";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(wx - w / 2, wy - h / 2, w, h);

    const sym = DOOR_SYMBOL[d.type] || "";
    if (sym && cell >= 9) {
      ctx.fillStyle = "#1a1410";
      ctx.font = `bold ${Math.max(8, Math.floor(cell * 0.7))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(sym, wx, wy);
    }
  }

  // Connector badges (entrance/exit/stairs) in each room's top-left corner.
  if (marks) {
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const fs = Math.max(8, Math.floor(cell * 0.95));
    ctx.font = `bold ${fs}px sans-serif`;
    for (const r of layout.rooms) {
      const badges = [];
      if (marks.entrance.has(r.n)) badges.push(["E", "#5fbf77"]);
      if (marks.exit.has(r.n)) badges.push(["X", "#5fbf77"]);
      if (marks.down.has(r.n)) badges.push(["▼", "#6ec6d6"]);
      if (marks.up.has(r.n)) badges.push(["▲", "#6ec6d6"]);
      if (!badges.length) continue;
      let bx = sx(r.x) + 2;
      const by = sy(r.y) + 2;
      for (const [chr, col] of badges) {
        ctx.fillStyle = "#0d0f15";
        ctx.fillText(chr, bx + 1, by + 1);
        ctx.fillStyle = col;
        ctx.fillText(chr, bx, by);
        bx += fs * 0.85;
      }
    }
  }

  // Exploration-state badges in each room's bottom-right corner.
  if (marks && marks.state) {
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    const fs = Math.max(8, Math.floor(cell * 0.95));
    ctx.font = `bold ${fs}px sans-serif`;
    for (const r of layout.rooms) {
      const st = marks.state[r.n];
      if (!st) continue;
      const badges = [];
      if (st.explored) badges.push(["•", "#6ec6d6"]);
      if (st.cleared) badges.push(["✓", "#5fbf77"]);
      if (st.looted) badges.push(["$", "#d8b24a"]);
      if (!badges.length) continue;
      let bx = sx(r.x) + r.w * cell - 2;
      const by = sy(r.y) + r.h * cell - 2;
      for (const [chr, col] of badges.reverse()) {
        ctx.fillStyle = "#0d0f15";
        ctx.fillText(chr, bx + 1, by + 1);
        ctx.fillStyle = col;
        ctx.fillText(chr, bx, by);
        bx -= fs * 0.85;
      }
    }
  }

  // Treasure marker (bottom-left) — rooms holding loot, matching the panel's 💰.
  // The other three corners are taken (connectors TL, lamp TR, state BR).
  if (treasureRooms.size) {
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.font = `${Math.max(9, Math.floor(cell * 0.8))}px sans-serif`;
    for (const r of layout.rooms) {
      if (!treasureRooms.has(r.n)) continue;
      ctx.fillText("💰", sx(r.x) + 2, sy(r.y) + r.h * cell - 2);
    }
  }
}

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e) {
  const p = pointerPos(e);
  drag = { x: p.x, y: p.y, moved: false };
  canvas.setPointerCapture?.(e.pointerId);
}

function onPointerMove(e) {
  if (!drag) return;
  const p = pointerPos(e);
  const dx = p.x - drag.x;
  const dy = p.y - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  drag.moved = true;
  camera.x += dx;
  camera.y += dy;
  drag.x = p.x;
  drag.y = p.y;
  render();
}

function onPointerUp(e) {
  if (!drag) return;
  const wasDrag = drag.moved;
  drag = null;
  if (wasDrag) return; // a pan, not a click
  // Click: inverse-transform into fitted space and hit-test.
  const p = pointerPos(e);
  const fx = (p.x - camera.x) / camera.scale;
  const fy = (p.y - camera.y) / camera.scale;
  for (const r of hitRects) {
    if (fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h) {
      onRoomClick(r.n);
      return;
    }
  }
}

function onWheel(e) {
  if (!level || !level.layout) return;
  e.preventDefault();
  const p = pointerPos(e);
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * Math.exp(-e.deltaY * 0.0015)));
  // Keep the point under the cursor fixed while zooming.
  const worldX = (p.x - camera.x) / camera.scale;
  const worldY = (p.y - camera.y) / camera.scale;
  camera.scale = next;
  camera.x = p.x - worldX * next;
  camera.y = p.y - worldY * next;
  render();
}
