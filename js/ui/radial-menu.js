// Right-click radial menu overlay (Phase 7.1) — browser-only, not unit-tested.
//
// Renders the fixed-slot model from radial-model.js as a ring over #stage and
// reports picks via a dispatch(id, value) callback. Submenus open as a second
// outer ring (the base ring dims, the chosen parent stays lit); a submenu's
// "Random" option is anchored at the parent's angle so it lands nearest the
// cursor. Disabled slots render greyed with their reason as a tooltip.

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
  const rect = ringEl.getBoundingClientRect();
  const x = Math.max(EDGE_PAD, Math.min(rect.width - EDGE_PAD, clientX - rect.left));
  const y = Math.max(EDGE_PAD, Math.min(rect.height - EDGE_PAD, clientY - rect.top));
  state = { x, y, model, stack: [{ items: model }] };
  ringEl.classList.add("open");
  draw();
}

export function closeRadial() {
  if (!ringEl) return;
  state = null;
  ringEl.classList.remove("open");
  clearNodes();
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
    (item.id === "deleteHex" ? " danger" : "") +
    (item.enabled === false ? " disabled" : "");
  n.style.left = x + "px";
  n.style.top = y + "px";
  n.style.width = n.style.height = size + "px";
  if (item.enabled === false && item.reason) n.title = item.reason;
  n.innerHTML = `<span class="glyph">${item.glyph}</span><span class="label">${item.label}</span>`;
  return n;
}

function draw() {
  clearNodes();
  const { x, y, stack } = state;
  const depth = stack.length - 1;
  const base = stack[0].items;

  // Base ring: always shown. When a submenu is open it dims, except the parent.
  ringEl.appendChild(guide(x, y, BASE_R));
  base.forEach((item, i) => {
    const ang = (Math.PI * 2 * i) / base.length - Math.PI / 2;
    const nx = x + BASE_R * Math.cos(ang);
    const ny = y + BASE_R * Math.sin(ang);
    const isParent = depth > 0 && stack[1].parentIndex === i;
    const cls = depth > 0 ? (isParent ? "parent" : "dim") : "";
    const n = nodeEl(item, nx, ny, BASE_NODE, cls);
    if (depth === 0) n.addEventListener("click", (e) => { e.stopPropagation(); pick(item, i); });
    ringEl.appendChild(n);
  });

  // Submenu ring. A "Random" (anchor) child is placed at the parent's angle —
  // the outer slot nearest the cursor — so it's always the least-travel pick.
  if (depth > 0) {
    const sub = stack[1].items;
    const parentAngle = stack[1].parentAngle;
    const anchorIdx = sub.findIndex((it) => it.anchor);
    const baseAng = anchorIdx >= 0 ? parentAngle : -Math.PI / 2;
    const aIdx = anchorIdx >= 0 ? anchorIdx : 0;
    ringEl.appendChild(guide(x, y, OUTER_R));
    sub.forEach((item, i) => {
      const ang = baseAng + (Math.PI * 2 * (i - aIdx)) / sub.length;
      const nx = x + OUTER_R * Math.cos(ang);
      const ny = y + OUTER_R * Math.sin(ang);
      const n = nodeEl(item, nx, ny, SUB_NODE);
      n.addEventListener("click", (e) => { e.stopPropagation(); pick(item, i); });
      ringEl.appendChild(n);
    });
  }

  // Center hub: Back inside a submenu, Close at the top level.
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
    const parentAngle = (Math.PI * 2 * index) / state.stack[0].items.length - Math.PI / 2;
    state.stack[1] = { items: item.children, parentIndex: index, parentAngle };
    draw();
    return;
  }
  const { id, value } = item;
  closeRadial();
  if (dispatch) dispatch(id, value);
}

function back() {
  state.stack.length = 1;
  draw();
}
