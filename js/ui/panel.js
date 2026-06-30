// Side-panel rendering helpers.

import { glyphForPoi } from "./poi-style.js";
import { featureDescription } from "../gen/feature-detail.js";
import { hookName, hookDescription } from "../gen/hooks.js";

const panel = () => document.getElementById("panel");

// --- panel tabs (Detail | Hooks) -----------------------------------------
// The panel shows one of two tabs at a time; #selection (Detail) and
// #global-hooks (Hooks) are both built once and toggled via a class on #panel.
let activeTab = "detail";
const TAB_REGIONS = { detail: "selection", hooks: "global-hooks", pinned: "pinned-hooks" };

function applyPanelTab() {
  const el = panel();
  if (!el) return;
  for (const [tab, id] of Object.entries(TAB_REGIONS)) {
    const region = document.getElementById(id);
    if (region) region.hidden = tab !== activeTab;
  }
  const tabs = el.querySelector(".panel-tabs");
  if (tabs) {
    for (const b of tabs.querySelectorAll("button")) {
      b.classList.toggle("active", b.dataset.tab === activeTab);
    }
  }
}

/** Switch the side panel to a tab ("detail" | "hooks" | "pinned"). */
export function setPanelTab(tab) {
  activeTab = TAB_REGIONS[tab] ? tab : "detail";
  applyPanelTab();
}

/** One-line summary of a POI's occupant. */
export function occupantSummary(occupant) {
  if (!occupant) return "empty";
  if (occupant.kind === "lair") return `Lair: ${occupant.creature}`;
  if (occupant.kind === "occupied") return `Held: ${occupant.by}`;
  return "empty";
}

/**
 * Record an app event. The on-screen event log was removed — events now go to
 * the browser console only, keeping the panel uncluttered. Kept as a named
 * export so every call site stays unchanged.
 */
export function logLine(text) {
  console.log(text);
}

/**
 * Format a hex as readable text lines (pure — no DOM).
 * @param {object} hex
 * @returns {string[]}
 */
export function describeHex(hex) {
  const terrain = hex.terrainFeature
    ? `${hex.terrain} (${hex.terrainFeature})`
    : hex.terrain;
  const coords = hex.coords
    ? `  Coords: (${hex.coords.q}, ${hex.coords.r})`
    : null;
  // Settlement and POIs have their own panel sections (with controls).
  return [`Hex ${hex.key}`, coords, `  Terrain: ${terrain}`].filter(Boolean);
}

function actionButton(label, onClick) {
  const b = document.createElement("button");
  b.className = "tile-action";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

// POIs as a read-only/navigable list, or the drill-in detail of one POI.
// Creating and removing POIs live on the right-click radial menu, so there are
// no add/remove buttons here — clicking a row just inspects (and, for a
// dungeon/tower, opens its mapped interior).
function renderPoiSection(sel, hex, model) {
  const pois = Array.isArray(hex.pois) ? hex.pois : [];
  const selectedPoi =
    model.selectedPoiId && pois.find((p) => p.id === model.selectedPoiId);

  // Drill-in detail of one POI (type, occupant, flavor) + a Back link.
  if (selectedPoi) {
    const box = document.createElement("div");
    box.className = "poi-detail";
    const title = document.createElement("div");
    title.className = "poi-detail-title";
    title.textContent = `${glyphForPoi(selectedPoi)} ${selectedPoi.name}`;
    box.appendChild(title);
    // Tier-1 feature types (shrine, …) show a composed description in place of the
    // generic flavour line, and hide the Occupant line when there's no occupant.
    const feature = selectedPoi.detail && selectedPoi.detail.feature;
    const occ = occupantSummary(selectedPoi.occupant);
    const detailLines = feature
      ? featureDescription(feature)
      : [selectedPoi.detail && selectedPoi.detail.flavor];
    for (const line of [
      `Type: ${selectedPoi.type}`,
      // A camp's description already names who holds it; hide the generic line.
      feature && (selectedPoi.type === "camp" || occ === "empty") ? null : `Occupant: ${occ}`,
      ...detailLines,
    ].filter(Boolean)) {
      const div = document.createElement("div");
      div.className = "log-line";
      div.textContent = line;
      box.appendChild(div);
    }
    // Dungeon interior (Phase 4): generated lazily by app.js on first open, so
    // it's normally present by the time we render; show a placeholder otherwise.
    if (selectedPoi.type === "dungeon") {
      const dungeon = selectedPoi.detail && selectedPoi.detail.dungeon;
      if (dungeon) appendDungeon(box, dungeon);
      else {
        const div = document.createElement("div");
        div.className = "log-line";
        div.textContent = "Generating dungeon…";
        box.appendChild(div);
      }
    }
    const back = document.createElement("button");
    back.className = "link-back";
    back.textContent = "← Back to hex";
    back.addEventListener("click", model.onClearPoi);
    box.appendChild(back);
    sel.appendChild(box);
    return;
  }

  sel.appendChild(sectionLabel("POIs"));

  // List of POIs (name already embeds the occupant, e.g. "Ruin — Troll lair").
  if (pois.length > 0) {
    const list = document.createElement("div");
    list.className = "poi-list";
    for (const poi of pois) {
      const row = document.createElement("button");
      row.className = "poi-row";
      row.textContent = `${glyphForPoi(poi)} ${poi.name}`;
      row.addEventListener("click", () => model.onSelectPoi(poi.id));
      list.appendChild(row);
    }
    sel.appendChild(list);
  } else {
    const none = document.createElement("div");
    none.className = "log-line";
    none.textContent = "none";
    sel.appendChild(none);
  }
}

// Render a dungeon's interior into the POI drill-in box: a size/levels header,
// then each level as a <details> disclosure (theme, stocked rooms, and the
// level's generated random-monster table).
function appendDungeon(box, dungeon) {
  const levels = Array.isArray(dungeon.levels) ? dungeon.levels : [];
  box.appendChild(
    sectionLabel(
      `${dungeon.theme || "Dungeon"} — ${dungeon.size}, ${levels.length} level(s)`,
    ),
  );
  for (const level of levels) {
    const det = document.createElement("details");
    det.className = "dungeon-level";
    const summary = document.createElement("summary");
    summary.textContent = `Level ${level.depth}: ${level.theme}`;
    det.appendChild(summary);

    const body = document.createElement("div");
    body.className = "dungeon-body";
    for (const room of level.rooms || []) {
      const r = document.createElement("div");
      r.className = "room-row";
      const bits = [`${room.n}.`, room.content];
      if (room.monster) bits.push(`— ${room.monster.name}`);
      if (room.treasure) bits.push("💰");
      r.textContent = bits.join(" ");
      body.appendChild(r);
    }
    const wandering = document.createElement("div");
    wandering.className = "room-row encounters";
    wandering.textContent =
      "Wandering: " + (level.encounters || []).map((e) => e.value).join(", ");
    body.appendChild(wandering);

    det.appendChild(body);
    box.appendChild(det);
  }
}

function sectionLabel(text) {
  const el = document.createElement("div");
  el.className = "section-label";
  el.textContent = text;
  return el;
}

// Overflow "…" menu for the wayfinding/destructive actions, so the card stays
// tidy even when the map is large and you just need to find a hex.
function hookKebab(hook, model) {
  const menu = document.createElement("details");
  menu.className = "menu kebab";
  const summary = document.createElement("summary");
  summary.textContent = "⋯";
  summary.title = "More";
  menu.appendChild(summary);
  const list = document.createElement("div");
  list.className = "menu-list";
  const item = (label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => { menu.open = false; fn(); });
    list.appendChild(b);
  };
  // Target/origin jumps now live on the card's colour-dot links; the menu keeps
  // only the destructive action, tucked away.
  item("Remove hook", () => model.onRemoveHook(hook.id));
  menu.appendChild(list);
  return menu;
}

// One hook's card: name + status + prose, and a row of actions. Clicking the
// card body selects the hook (rings its target/origin on the map); wayfinding
// jumps + remove live in the "…" menu.
function hookCard(hook, model) {
  const status = hook.status || "open";
  const selected = hook.id === model.selectedHookId;
  const box = document.createElement("div");
  box.className = "hook" + (status !== "open" ? ` ${status}` : "") + (selected ? " selected" : "");
  if (model.onSelectHook) box.addEventListener("click", () => model.onSelectHook(hook.id));

  const title = document.createElement("div");
  title.className = "poi-detail-title";
  title.textContent = hookName(hook) + (status !== "open" ? ` (${status})` : "");
  box.appendChild(title);

  for (const line of hookDescription(hook, { hexScale: model.hexScale })) {
    const div = document.createElement("div");
    div.className = "log-line";
    div.textContent = line;
    box.appendChild(div);
  }

  // Selected: the two coloured rings on the map are mirrored here as links —
  // click one to centre the map on that hex (selection/tab stay put).
  if (selected) {
    const legend = document.createElement("div");
    legend.className = "hook-legend";
    legend.addEventListener("click", (e) => e.stopPropagation()); // don't toggle the card
    const link = (which, label, dotClass) => {
      const a = document.createElement("button");
      a.type = "button";
      a.className = "legend-link";
      a.title = `Centre the map on the ${which}`;
      const dot = document.createElement("span");
      dot.className = `dot ${dotClass}`;
      a.append(dot, label);
      a.addEventListener("click", () => model.onCenterHook(hook.id, which));
      return a;
    };
    if (hook.target) legend.appendChild(link("target", "Target", "t"));
    if (hook.origin) legend.appendChild(link("origin", "Origin", "o"));
    const note = document.createElement("span");
    note.className = "muted";
    note.textContent = "— click to centre";
    legend.appendChild(note);
    box.appendChild(legend);
  }

  const row = document.createElement("div");
  row.className = "tile-actions";
  row.addEventListener("click", (e) => e.stopPropagation()); // actions don't toggle selection
  row.appendChild(actionButton(hook.pinned ? "Unpin" : "Pin", () => model.onPinHook(hook.id)));
  row.appendChild(actionButton(status === "resolved" ? "Reopen" : "Resolve", () => model.onResolveHook(hook.id)));
  row.appendChild(actionButton(status === "ignored" ? "Reopen" : "Ignore", () => model.onIgnoreHook(hook.id)));
  // A chain advances clue-by-clue until the final site (the prize).
  if (hook.pattern === "chain" && hook.chain && hook.chain.step < hook.chain.total && model.onFollowClue) {
    row.appendChild(actionButton("Follow the clue", () => model.onFollowClue(hook.id)));
  }
  row.appendChild(hookKebab(hook, model));
  box.appendChild(row);
  return box;
}

// Rank for sorting the global list: open hooks first, then resolved/ignored.
const hookStatusRank = (h) => ((h.status || "open") === "open" ? 0 : 1);

/**
 * Render the always-visible global hooks list into #global-hooks. Open hooks
 * sort first (and undimmed); resolved/ignored dim below so nothing is lost.
 * @param {{ hooks: object[], selectedHookId, onSelectHook, onPinHook,
 *   onCenterHook, onResolveHook, onIgnoreHook, onRemoveHook, onFollowClue }} model
 */
function setTabBadge(id, n) {
  const badge = document.getElementById(id);
  if (!badge) return;
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

// Render one hook list (with a header, or an empty-state hint) into a host.
function renderHookList(host, hooks, model, emptyMsg) {
  if (!host) return;
  host.innerHTML = "";
  if (!hooks.length) {
    const empty = document.createElement("div");
    empty.className = "panel-hint";
    empty.textContent = emptyMsg;
    host.appendChild(empty);
    return;
  }
  const openCount = hooks.filter((h) => (h.status || "open") === "open").length;
  const head = document.createElement("div");
  head.className = "hooks-head";
  head.textContent = `${openCount} open / ${hooks.length} total`;
  host.appendChild(head);
  for (const hook of [...hooks].sort((a, b) => hookStatusRank(a) - hookStatusRank(b))) {
    host.appendChild(hookCard(hook, model));
  }
}

/**
 * Render the world hooks into two tabs: pinned hooks (the party's chosen leads)
 * in #pinned-hooks, the rest in #global-hooks. Tab badges show the open
 * (unpinned) count and the pinned count.
 */
export function renderGlobalHooks(model) {
  const all = model.hooks || [];
  const pinned = all.filter((h) => h.pinned);
  const unpinned = all.filter((h) => !h.pinned);

  setTabBadge("hooks-tab-badge", unpinned.filter((h) => (h.status || "open") === "open").length);
  setTabBadge("pinned-tab-badge", pinned.length);

  renderHookList(
    document.getElementById("global-hooks"), unpinned, model,
    "No hooks yet — generate one at a town (right-click → Hook).",
  );
  renderHookList(
    document.getElementById("pinned-hooks"), pinned, model,
    "No pinned hooks yet — press Pin on a hook in the Hooks tab to track your active leads here.",
  );
}

// Read-only info for the selected cell: terrain, settlement, and POIs. Every
// action (place/generate/regenerate/delete, settlements, POIs, hooks) lives on
// the right-click radial menu — the panel is just for seeing what's here.
export function renderSelectionPanel(model) {
  const sel = document.getElementById("selection");
  if (!sel) return;
  sel.innerHTML = "";
  if (!model || !model.coord) return;

  const { coord, hex } = model;
  const h = document.createElement("h3");
  h.textContent = hex ? "Selected hex" : `Empty (${coord.q}, ${coord.r})`;
  sel.appendChild(h);

  if (hex) {
    for (const line of describeHex(hex)) {
      const div = document.createElement("div");
      div.className = "log-line";
      div.textContent = line;
      sel.appendChild(div);
    }
    // Settlement as a plain info line (controls are on the radial menu).
    if (hex.settlement && hex.settlement.present) {
      const div = document.createElement("div");
      div.className = "log-line";
      div.textContent = `Settlement: ${hex.settlement.size}`;
      sel.appendChild(div);
    }
    renderPoiSection(sel, hex, model);
  }

  // Point at the radial menu now that the action buttons are gone.
  const hint = document.createElement("div");
  hint.className = "panel-hint";
  hint.textContent = hex
    ? "Right-click the hex for actions."
    : "Right-click to place terrain or generate here.";
  sel.appendChild(hint);
}

/**
 * Render the Dungeon View's side panel: the dungeon header, the current level
 * (theme/family + wandering monsters), and the selected room's contents.
 * @param {{ dungeon: object, level: object, room: object|null }} model
 */
// Coins read book-style as a dice expression, no weight ("Loose coins (2d6×10 gp)");
// gems/idols/plate roll a concrete value + weight ("— 240 gp, 12 cn"); leads/magic
// show neither. Guard is always appended.
function treasureLine(t) {
  let amount = "";
  if (t.dice) amount = ` (${t.dice} gp)`;
  else if (t.gp > 0) amount = ` — ${t.gp} gp${t.weight ? `, ${t.weight} cn` : ""}`;
  return `Treasure: ${t.kind}${amount} (${t.guard})`;
}

export function renderDungeonPanel({
  dungeon,
  level,
  room,
  connections = [],
  surface = [],
  onGoTo,
  roomState,
  onToggleRoom,
  onNoteRoom,
}) {
  const sel = document.getElementById("selection");
  if (!sel) return;
  sel.innerHTML = "";

  const h = document.createElement("h3");
  h.textContent = `${dungeon.theme || "Dungeon"} — ${dungeon.size}`;
  sel.appendChild(h);
  if (dungeon.difficulty) {
    const diff = document.createElement("div");
    diff.className = "log-line";
    diff.textContent = `Difficulty: ${dungeon.difficulty}`;
    sel.appendChild(diff);
  }

  // Towers ("up" orientation) are floors, not levels; their floors carry a
  // garrison rather than a family, and have no wandering-monster table.
  const floorWord = dungeon.orientation === "up" ? "Floor" : "Level";
  sel.appendChild(
    sectionLabel(level.family ? `${floorWord} ${level.depth} — ${level.family}` : `${floorWord} ${level.depth}`),
  );
  if (dungeon.occupation && dungeon.occupation.level === level.depth - 1) {
    const occ = document.createElement("div");
    occ.className = "log-line";
    occ.textContent = `Occupied near an entrance by ${dungeon.occupation.by} (locked door beyond)`;
    sel.appendChild(occ);
  }
  if (level.encounters && level.encounters.length) {
    const wandering = document.createElement("div");
    wandering.className = "log-line";
    wandering.textContent = "Wandering: " + level.encounters.map((e) => e.value).join(", ");
    sel.appendChild(wandering);
  }

  if (room) {
    sel.appendChild(sectionLabel(`Room ${room.n}`));
    for (const line of [
      room.held ? `Held by ${room.held}` : null,
      room.monster
        ? `Monster: ${room.monster.na} ${room.monster.name} (${room.monster.status})`
        : `Content: ${room.content}`,
      room.trap ? `Trap: ${room.trap.name} — ${room.trap.trigger}; ${room.trap.effect}` : null,
      room.special ? `Special: ${room.special}` : null,
      room.dressing || null,
      room.treasure ? treasureLine(room.treasure) : null,
      room.light ? `Lit: ${room.light.source}` : null,
      ...surface, // "Dungeon entrance (surface)", "Exit to surface"
    ].filter(Boolean)) {
      const div = document.createElement("div");
      div.className = "log-line";
      div.textContent = line;
      sel.appendChild(div);
    }
    // Stair navigation buttons (switch level + select the connected room).
    if (connections.length && onGoTo) {
      const row = document.createElement("div");
      row.className = "tile-actions";
      for (const c of connections) {
        row.appendChild(actionButton(c.label, () => onGoTo(c.toLevel, c.toRoom)));
      }
      sel.appendChild(row);
    }
    // Exploration tracking: toggles + a GM note (kept separate from generated
    // content, so it survives dungeon regeneration).
    if (roomState && onToggleRoom) {
      sel.appendChild(sectionLabel("Tracking"));
      const row = document.createElement("div");
      row.className = "tile-actions";
      for (const field of ["explored", "cleared", "looted"]) {
        const b = document.createElement("button");
        b.className = "tile-action toggle" + (roomState[field] ? " on" : "");
        b.textContent = field[0].toUpperCase() + field.slice(1);
        b.addEventListener("click", () => onToggleRoom(field));
        row.appendChild(b);
      }
      sel.appendChild(row);

      const note = document.createElement("textarea");
      note.className = "room-note";
      note.rows = 2;
      note.placeholder = "Notes…";
      note.value = roomState.note || "";
      if (onNoteRoom) note.addEventListener("change", () => onNoteRoom(note.value));
      sel.appendChild(note);
    }
  } else {
    const hint = document.createElement("div");
    hint.className = "log-line";
    hint.textContent = "Click a room on the map. E=entrance, X=exit, ▲/▼=stairs.";
    sel.appendChild(hint);
  }
}

/**
 * Replace the panel contents with a heading describing the current world.
 * The world name is an editable input (non-blocking rename — no prompt()).
 * @param {object} world
 * @param {{ onRename?: (name: string) => void }} [opts]
 */
export function showWorld(world, opts = {}) {
  const el = panel();
  if (!el) return;
  el.innerHTML = "";
  if (!world) {
    const msg = document.createElement("div");
    msg.className = "panel-empty";
    msg.textContent = "No world loaded. Create one to begin.";
    el.appendChild(msg);
    return;
  }
  const name = document.createElement("input");
  name.className = "world-name";
  name.value = world.name;
  name.setAttribute("aria-label", "World name");
  name.title = "Rename world";
  if (opts.onRename) {
    const commit = () => {
      const v = name.value.trim();
      if (v && v !== world.name) opts.onRename(v);
    };
    name.addEventListener("change", commit);
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") name.blur();
    });
  }
  el.appendChild(name);
  // Tab bar: Detail (selected hex/room) | Hooks (world hook list, with an
  // open-count badge). Switching just toggles which region shows.
  const tabs = document.createElement("div");
  tabs.className = "panel-tabs";
  const mkTab = (key, label, badgeId) => {
    const b = document.createElement("button");
    b.dataset.tab = key;
    b.append(label);
    if (badgeId) {
      const badge = document.createElement("span");
      badge.id = badgeId;
      badge.className = "badge";
      badge.hidden = true;
      b.append(" ", badge);
    }
    b.addEventListener("click", () => setPanelTab(key));
    return b;
  };
  tabs.append(
    mkTab("detail", "Detail"),
    mkTab("hooks", "Hooks", "hooks-tab-badge"),
    mkTab("pinned", "Pinned", "pinned-tab-badge"),
  );
  el.appendChild(tabs);
  // Detail region: the selected hex (or dungeon room) details.
  const sel = document.createElement("div");
  sel.id = "selection";
  el.appendChild(sel);
  // Hooks region: unpinned world hooks (filled by renderGlobalHooks).
  const gh = document.createElement("div");
  gh.id = "global-hooks";
  gh.hidden = true;
  el.appendChild(gh);
  // Pinned region: the party's chosen leads (filled by renderGlobalHooks).
  const pinned = document.createElement("div");
  pinned.id = "pinned-hooks";
  pinned.hidden = true;
  el.appendChild(pinned);
  activeTab = "detail"; // a freshly loaded world starts on Detail
  // Static world-metadata footer (seed & scale are immutable per world, so it
  // never goes stale). The old growing event log moved to the browser console.
  const meta = document.createElement("div");
  meta.className = "world-meta";
  for (const line of [`Seed: ${world.seed}`, `Hex scale: ${world.hexScale} miles`]) {
    const div = document.createElement("div");
    div.textContent = line;
    meta.appendChild(div);
  }
  el.appendChild(meta);
  applyPanelTab(); // reflect the active tab (Detail) on the freshly built bar
}
