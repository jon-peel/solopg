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
const BASE_NODE = 60;
const SUB_NODE = 54;
// Share of the node a label line may occupy (mirrors `.ring-node .label`'s
// max-width) and the floor fitLabel() will shrink to before giving up.
const LABEL_BOX = 0.88;
const MIN_LABEL_PX = 7.5;
const EDGE_PAD = OUTER_R + SUB_NODE; // keep the outer ring on-screen

let ringEl = null;
let scrim = null;
let dispatch = null;
let state = null; // { x, y, model, stack:[{items}, {items,parentIndex,parentAngle}?] }
let wired = false;
// Keyboard navigation (Phase 11.8): the active ring's items + their DOM nodes,
// and which one has keyboard focus (-1 = none yet).
let activeItems = [];
let activeNodes = [];
let focusIndex = -1;

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
  ringEl.setAttribute("role", "menu");
  ringEl.setAttribute("aria-label", "Actions");
  scrim.addEventListener("pointerdown", () => closeRadial());
  // Right-clicking while open steps back one level (or closes at the top),
  // never the OS menu — the same gesture that opened the ring now navigates it.
  ringEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (state) (state.stack.length > 1 ? back() : closeRadial());
  });
  window.addEventListener("keydown", onRingKey);
}

// Keyboard: arrows move focus round the active ring, Enter/Space activates, Esc
// steps back / closes. Disabled slots are skipped.
function onRingKey(e) {
  if (!state) return;
  if (e.key === "Escape") { e.preventDefault(); state.stack.length > 1 ? back() : closeRadial(); return; }
  if (!activeNodes.length) return;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
  else if (e.key === "Enter" || e.key === " ") {
    if (focusIndex >= 0) { e.preventDefault(); pick(activeItems[focusIndex], focusIndex); }
  }
}

function moveFocus(dir) {
  const n = activeNodes.length;
  if (!n) return;
  let idx = focusIndex < 0 ? (dir > 0 ? -1 : 0) : focusIndex;
  for (let s = 0; s < n; s++) {
    idx = (idx + dir + n) % n;
    if (activeItems[idx].enabled !== false) break; // skip disabled slots
  }
  if (focusIndex >= 0 && activeNodes[focusIndex]) activeNodes[focusIndex].classList.remove("kbd");
  focusIndex = idx;
  const node = activeNodes[idx];
  if (node) { node.classList.add("kbd"); node.focus(); }
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
  activeItems = []; activeNodes = []; focusIndex = -1; // travel ring isn't arrow-navigated
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
  n.setAttribute("role", "menuitem");
  n.setAttribute("aria-label", item.label);
  if (item.kind === "submenu") n.setAttribute("aria-haspopup", "menu");
  n.tabIndex = -1;
  if (item.enabled === false) n.setAttribute("aria-disabled", "true");
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

// Shrink a label whose longest WORD cannot fit the node on one line. Breaking
// mid-word ("Settlemen/t", "Watchtowe/r") reads as a typo, and which labels
// overflow depends on the fonts the viewer happens to have — so this measures
// the real computed font rather than trusting a box tuned on one machine. Only
// the labels that need it shrink; everything else keeps the base size.
const fitCtx = document.createElement("canvas").getContext("2d");
function fitLabel(el, boxW) {
  if (!el || !boxW) return;
  const cs = getComputedStyle(el);
  const fs = parseFloat(cs.fontSize);
  if (!fs) return;
  fitCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
  const track = parseFloat(cs.letterSpacing) || 0; // measureText ignores tracking
  let widest = 0;
  for (const word of el.textContent.split(/\s+/)) {
    widest = Math.max(widest, fitCtx.measureText(word).width + track * word.length);
  }
  if (widest <= boxW) return;
  el.style.fontSize = Math.max(fs * (boxW / widest), MIN_LABEL_PX) + "px";
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
  if (active) activeItems = items;
  items.forEach((item, i) => {
    const ang = baseAng + (Math.PI * 2 * (i - aIdx)) / items.length;
    const nx = x + radius * Math.cos(ang);
    const ny = y + radius * Math.sin(ang);
    const cls = active ? "" : i === parentIndex ? "parent" : "dim";
    const n = nodeEl(item, nx, ny, nodeSize, cls);
    if (active) {
      n.addEventListener("click", (e) => { e.stopPropagation(); pick(item, i); });
      activeNodes[i] = n; // for keyboard navigation
    }
    ringEl.appendChild(n);
    // After append: getComputedStyle only resolves the font once it is in the
    // DOM, and clientWidth gives the CONTENT box the CSS max-width resolves
    // against — measuring off `nodeSize` instead would be a border-width too
    // generous and let the tightest labels through.
    fitLabel(n.querySelector(".label"), n.clientWidth * LABEL_BOX);
  });
}

// Show the deepest two levels: the current (outer, clickable) and its parent
// (inner, dimmed for breadcrumb). Supports arbitrary nesting (POI → dungeon →
// size), always as two concentric rings.
function draw() {
  clearNodes();
  activeItems = [];
  activeNodes = [];
  focusIndex = -1;
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
