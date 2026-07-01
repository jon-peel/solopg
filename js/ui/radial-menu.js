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

const BASE_R = 104; // base-ring radius (px)
const OUTER_R = 178; // submenu-ring radius
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
  // Right-clicking again while open dismisses rather than showing the OS menu.
  ringEl.addEventListener("contextmenu", (e) => e.preventDefault());
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
  n.innerHTML = `<span class="glyph">${item.glyph}</span><span class="label">${item.label}</span>`;
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
