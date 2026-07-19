// Reusable right-click radial menu overlay (Phase 7.1) — browser-only.
//
// Context-agnostic: callers pass a `model` (array of slot nodes) + a
// `dispatch(id, value)` and get a ring rendered over #stage. Used by the
// world-map menu (radial-model.js) and the dungeon-room menu
// (radial-room-model.js) alike. Node shape per slot:
//   { kind:"leaf"|"submenu", id, glyph, label, enabled, reason, value,
//     children, anchor, title, danger, on }
// Submenus open as a second outer ring (base dims, chosen parent stays lit); an
// `anchor` child is placed at the parent's angle (nearest the cursor). Disabled
// slots render greyed (reason as tooltip); `danger` reddens; `on` marks an
// active toggle. Only one ring is open at a time (isRadialOpen()).

import { ringCenter } from "./radial-model.js";

const BASE_R = 88; // base-ring radius (px) — shrunk from 104 to cut mouse travel to any slot
const OUTER_R = 150; // submenu-ring radius — shrunk from 178, same reason
const BASE_NODE = 56;
const SUB_NODE = 50;
const EDGE_PAD = OUTER_R + SUB_NODE; // keep the outer ring on-screen

let ringEl = null;
let scrim = null;
let dispatch = null;
let state = null; // { x, y, model, stack:[{items}, {items,parentIndex,parentAngle}?] }
let wired = false;

function el() {
  if (!ringEl) {
    ringEl = document.getElementById("ring");
    scrim = ringEl && ringEl.querySelector(".scrim");
  }
  return ringEl;
}

function wireOnce() {
  if (wired || !el()) return;
  wired = true;
  scrim.addEventListener("pointerdown", () => closeRadial());
  // Right-clicking while open steps back one level (or closes at the top),
  // never the OS menu — the same gesture that opened the ring now navigates it.
  ringEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (state) (state.stack.length > 1 ? back() : closeRadial());
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state) (state.stack.length > 1 ? back() : closeRadial());
  });
}

/**
 * Open the ring at a client position for the given model.
 * @param {{clientX:number, clientY:number, model:object[], dispatch:(id:string,value?:any)=>void}} opts
 */
export function openRadial({ clientX, clientY, model, dispatch: onPick }) {
  if (!el()) return;
  wireOnce();
  dispatch = onPick;
  // Show first, then measure: a display:none element reports a zero rect, which
  // would pin the ring to a corner. Measure the parent (#stage) — it's always
  // laid out and the ring fills it (inset:0), so its box is the ring's box.
  ringEl.classList.add("open");
  const host = ringEl.parentElement || ringEl;
  const { x, y } = ringCenter(clientX, clientY, host.getBoundingClientRect(), EDGE_PAD);
  state = { x, y, model, stack: [{ items: model }] };
  draw();
}

// Concentric rings for the directional travel compass (Phase 11): distance is
// the radius — inner = one hex, middle = half a day, outer = a full day.
const TRAVEL_RINGS = [
  { unit: "hex", suffix: "hex", r: 70, size: 38 },
  { unit: "half", suffix: "½ day", r: 114, size: 44 },
  { unit: "full", suffix: "day", r: 158, size: 48 },
];
const TRAVEL_PAD = 158 + 48; // outer radius + node, kept on-screen

const unitWord = (u) => (u === "hex" ? "One hex" : u === "half" ? "Half day" : "Full day");

/**
 * A 3-ring compass for directional travel (double-click the party). `dirs` is
 * the 8 compass points in ring order (N at top, clockwise), each
 * { bearing, glyph, label }. A pick fires onPick(bearing, unit).
 *
 * When `disabled` (no daylight left to cross even one hex), the direction nodes
 * grey out and the hub becomes a "Rest to dawn" action (calls `onRest`).
 */
export function openTravelRadial({ clientX, clientY, dirs, dispatch: onPick, disabled = false, onRest }) {
  if (!el()) return;
  wireOnce();
  ringEl.classList.add("open");
  const host = ringEl.parentElement || ringEl;
  const { x, y } = ringCenter(clientX, clientY, host.getBoundingClientRect(), TRAVEL_PAD);
  state = { x, y, stack: [{ items: [] }] }; // depth 1 → Esc / right-click just close
  clearNodes();
  for (const ring of TRAVEL_RINGS) {
    ringEl.appendChild(guide(x, y, ring.r));
    dirs.forEach((d, i) => {
      const ang = -Math.PI / 2 + (Math.PI * 2 * i) / dirs.length; // N at top, clockwise
      const n = document.createElement("div");
      n.className = "ring-node travel" + (disabled ? " disabled" : "");
      n.style.left = x + ring.r * Math.cos(ang) + "px";
      n.style.top = y + ring.r * Math.sin(ang) + "px";
      n.style.width = n.style.height = ring.size + "px";
      n.title = disabled ? "Not enough daylight — rest to dawn" : `${unitWord(ring.unit)} — ${d.label}`;
      n.innerHTML = `<span class="glyph">${d.glyph}</span><span class="label">${ring.suffix}</span>`;
      if (!disabled) n.addEventListener("click", (e) => { e.stopPropagation(); closeRadial(); onPick(d.bearing, ring.unit); });
      ringEl.appendChild(n);
    });
  }
  const hub = document.createElement("div");
  hub.className = "ring-hub";
  hub.style.left = x + "px";
  hub.style.top = y + "px";
  if (disabled && onRest) {
    hub.innerHTML = `<span class="hub-top">🌅</span><span class="hub-sub">Rest to dawn</span>`;
    hub.addEventListener("click", (e) => { e.stopPropagation(); closeRadial(); onRest(); });
  } else {
    hub.innerHTML = `<span class="hub-top">✕</span><span class="hub-sub">Close</span>`;
    hub.addEventListener("click", (e) => { e.stopPropagation(); closeRadial(); });
  }
  ringEl.appendChild(hub);
}

export function closeRadial() {
  if (!ringEl) return;
  state = null;
  ringEl.classList.remove("open");
  clearNodes();
}

/** Whether a ring is currently open (so callers can defer their own keys). */
export function isRadialOpen() {
  return !!state;
}

function clearNodes() {
  ringEl.querySelectorAll(".ring-node, .ring-hub, .ring-guide").forEach((n) => n.remove());
}

function guide(x, y, radius) {
  const g = document.createElement("div");
  g.className = "ring-guide";
  g.style.left = x + "px";
  g.style.top = y + "px";
  g.style.width = g.style.height = radius * 2 + "px";
  return g;
}

function nodeEl(item, x, y, size, cls) {
  const n = document.createElement("div");
  n.className =
    "ring-node " + (cls || "") +
    (item.kind === "submenu" ? " submenu" : "") +
    (item.danger ? " danger" : "") +
    (item.on ? " on" : "") +
    (item.enabled === false ? " disabled" : "");
  n.style.left = x + "px";
  n.style.top = y + "px";
  n.style.width = n.style.height = size + "px";
  if (item.enabled === false && item.reason) n.title = item.reason;
  else if (item.title) n.title = item.title;
  // A `swatch` colour (e.g. the faction in a "Run by" pick) shows as a colour
  // chip in place of the glyph, and tints the node's border.
  const glyph = item.swatch
    ? `<span class="glyph"><span class="ring-swatch" style="background:${item.swatch}"></span></span>`
    : `<span class="glyph">${item.glyph}</span>`;
  n.innerHTML = glyph + `<span class="label">${item.label}</span>`;
  if (item.swatch) n.style.borderColor = item.swatch;
  return n;
}

// Render one ring of items at `radius`. `active` rings are clickable; inactive
// (parent-context) rings dim, with the chosen parent lit. `anchorAngle` places
// an `anchor` child (e.g. "Random") nearest the cursor.
function drawRing(items, radius, nodeSize, { active, parentIndex, anchorAngle }) {
  const { x, y } = state;
  ringEl.appendChild(guide(x, y, radius));
  const anchorIdx = active && anchorAngle != null ? items.findIndex((it) => it.anchor) : -1;
  const baseAng = anchorIdx >= 0 ? anchorAngle : -Math.PI / 2;
  const aIdx = anchorIdx >= 0 ? anchorIdx : 0;
  items.forEach((item, i) => {
    const ang = baseAng + (Math.PI * 2 * (i - aIdx)) / items.length;
    const nx = x + radius * Math.cos(ang);
    const ny = y + radius * Math.sin(ang);
    const cls = active ? "" : i === parentIndex ? "parent" : "dim";
    const n = nodeEl(item, nx, ny, nodeSize, cls);
    if (active) n.addEventListener("click", (e) => { e.stopPropagation(); pick(item, i); });
    ringEl.appendChild(n);
  });
}

// Show the deepest two levels: the current (outer, clickable) and its parent
// (inner, dimmed for breadcrumb). Supports arbitrary nesting (POI → dungeon →
// size), always as two concentric rings.
function draw() {
  clearNodes();
  const { x, y, stack } = state;
  const depth = stack.length - 1;

  if (depth === 0) {
    drawRing(stack[0].items, BASE_R, BASE_NODE, { active: true, anchorAngle: null });
  } else {
    const level = stack[depth];
    drawRing(stack[depth - 1].items, BASE_R, BASE_NODE, { active: false, parentIndex: level.parentIndex });
    drawRing(level.items, OUTER_R, SUB_NODE, { active: true, anchorAngle: level.parentAngle });
  }

  const hub = document.createElement("div");
  hub.className = "ring-hub";
  hub.style.left = x + "px";
  hub.style.top = y + "px";
  hub.innerHTML = depth > 0
    ? `<span class="hub-top">↩</span><span class="hub-sub">Back</span>`
    : `<span class="hub-top">✕</span><span class="hub-sub">Close</span>`;
  hub.addEventListener("click", (e) => { e.stopPropagation(); depth > 0 ? back() : closeRadial(); });
  ringEl.appendChild(hub);
}

function pick(item, index) {
  if (item.enabled === false) return; // greyed-out: visible but inert
  if (item.kind === "submenu") {
    // Anchor the child submenu at the picked item's angle within its own ring.
    const current = state.stack[state.stack.length - 1].items;
    const parentAngle = (Math.PI * 2 * index) / current.length - Math.PI / 2;
    state.stack.push({ items: item.children, parentIndex: index, parentAngle });
    draw();
    return;
  }
  const { id, value } = item;
  closeRadial();
  if (dispatch) dispatch(id, value);
}

function back() {
  state.stack.pop();
  draw();
}
