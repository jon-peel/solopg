// Side-panel rendering helpers.

import { glyphForPoi } from "./poi-style.js";
import { featureDescription } from "../gen/feature-detail.js";
import { hookName, hookDescription } from "../gen/hooks.js";
import { factionLabel, factionDescription } from "../gen/factions.js";
import { settlementName } from "../gen/settlement-name.js";

const panel = () => document.getElementById("panel");

// --- panel tabs (Detail | Hooks | Pinned | Travel) ------------------------
// The panel shows one tab at a time; each region is built once (in showWorld)
// and toggled via a class on #panel.
let activeTab = "detail";
const TAB_REGIONS = { detail: "selection", hooks: "global-hooks", pinned: "pinned-hooks", travel: "travel-panel", factions: "factions-panel" };

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

/** Switch the side panel to a tab ("detail" | "hooks" | "pinned" | "travel" | "factions"). */
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

// Promote / faction controls for one POI, appended under its list row (8.8/8.16).
// An OCCUPIED, unpromoted POI shows "Promote to faction" + any "Raise a ‹lord›"
// its site allows; an already-promoted one shows a jump-to-faction link. Lives in
// the LIST (not the drill-in) so a tower/dungeon — which opens its interior on
// click — can still be promoted.
function appendFactionControls(list, poi, model) {
  const occ = poi.occupant;
  if (!occ || occ.kind !== "occupied") return;
  if (occ.factionId) {
    const info = document.createElement("div");
    info.className = "hook-legend";
    const a = document.createElement("button");
    a.type = "button";
    a.className = "legend-link";
    a.textContent = `Faction: ${(model.factionNameById && model.factionNameById(occ.factionId)) || occ.factionId}`;
    a.title = "Centre the map on this faction's holding";
    if (model.onCenterFaction) a.addEventListener("click", () => model.onCenterFaction(occ.factionId));
    info.appendChild(a);
    list.appendChild(info);
    return;
  }
  if (!model.onPromotePoi) return;
  const acts = document.createElement("div");
  acts.className = "tile-actions";
  acts.appendChild(actionButton("Promote to faction", () => model.onPromotePoi(poi.id)));
  const lords = model.lordOptionsFor ? model.lordOptionsFor(poi) : [];
  for (const { archetype, label } of lords) {
    acts.appendChild(actionButton(label, () => model.onPromotePoi(poi.id, archetype)));
  }
  list.appendChild(acts);
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
    // Promote / faction controls live in the POI LIST (see appendFactionControls),
    // not here — a dungeon/tower opens its mapped interior on click, so its drill-in
    // is never shown; the list keeps promote reachable for every POI type (8.16).

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
      // Promote / raise-a-lord (8.8/8.16) inline, so an occupied tower/dungeon can
      // be promoted without opening its mapped interior (which clicking the row does).
      appendFactionControls(list, poi, model);
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

  // A faction-emitted hook (8.11) is tagged back to its faction via sourcePower —
  // surface who stirred it, with a jump-to-faction link (the id is stored; the name
  // and link are resolved at render). Shows even when the card isn't selected.
  if (hook.sourcePower && model.factionNameById) {
    const name = model.factionNameById(hook.sourcePower);
    const tag = document.createElement("div");
    tag.className = "hook-legend";
    tag.addEventListener("click", (e) => e.stopPropagation()); // don't toggle the card
    if (name && model.onCenterFaction) {
      const a = document.createElement("button");
      a.type = "button";
      a.className = "legend-link";
      a.title = "Centre the map on this faction's holding";
      a.textContent = `Stirred up by ${name}`;
      a.addEventListener("click", () => model.onCenterFaction(hook.sourcePower));
      tag.appendChild(a);
    } else {
      const span = document.createElement("span");
      span.className = "muted";
      span.textContent = name ? `Stirred up by ${name}` : "Stirred up by a faction (gone)";
      tag.appendChild(span);
    }
    box.appendChild(tag);
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

// One faction's card: name + archetype/disposition/goal prose, and — when it has
// a holding — a click-to-centre link (mirrors a hook card's Target legend link).
function factionCard(faction, model) {
  const box = document.createElement("div");
  box.className = "hook"; // reuse the hook-card styling
  const dot = model.factionColorFor ? model.factionColorFor(faction.id) : null;

  const title = document.createElement("div");
  title.className = "poi-detail-title";
  if (dot) {
    const swatch = document.createElement("span");
    swatch.className = "dot";
    swatch.style.background = dot;
    title.append(swatch, " ");
  }
  title.append(factionLabel(faction));
  box.appendChild(title);

  for (const line of factionDescription(faction)) {
    const div = document.createElement("div");
    div.className = "log-line";
    div.textContent = line;
    box.appendChild(div);
  }

  // Every holding gets a jump link (8.9) — click-to-centre like a hook's
  // Target/Origin. One holding → a single "Jump to holding"; several → one link
  // per site, each centring the map on that hex.
  const holdings = faction.holdings || [];
  if (holdings.length && model.onCenterFaction) {
    const legend = document.createElement("div");
    legend.className = "hook-legend";
    holdings.forEach((h, i) => {
      const a = document.createElement("button");
      a.type = "button";
      a.className = "legend-link";
      a.title = "Centre the map on this holding";
      a.textContent = holdings.length === 1 ? "Jump to holding" : `Holding ${i + 1} · (${h.q}, ${h.r})`;
      a.addEventListener("click", () => model.onCenterFaction(faction.id, i));
      legend.appendChild(a);
    });
    box.appendChild(legend);
  }

  // Delete (Phase 8.19) — a GM override, two-step (arm then confirm, no confirm()
  // dialog — matching the world-delete button). The panel re-renders on delete, so
  // the armed state resets itself; a timeout disarms if the GM walks away.
  if (model.onDeleteFaction) {
    const row = document.createElement("div");
    row.className = "tile-actions";
    const del = actionButton("Delete faction", () => {});
    let armTimer = null;
    del.addEventListener("click", () => {
      if (!armTimer) {
        del.textContent = "Confirm delete";
        del.classList.add("armed");
        armTimer = setTimeout(() => { armTimer = null; del.textContent = "Delete faction"; del.classList.remove("armed"); }, 4000);
        return;
      }
      clearTimeout(armTimer);
      armTimer = null;
      model.onDeleteFaction(faction.id);
    });
    row.appendChild(del);
    box.appendChild(row);
  }
  return box;
}

/**
 * Render the Factions tab (Phase 8.7) into #factions-panel — one card per
 * faction, with a count badge on the tab. Mirrors the Hooks tab (7.3).
 * @param {{ factions: object[], onCenterFaction?: (id:string)=>void,
 *   onAdvanceFactionTurn?: ()=>void, onDeleteFaction?: (id:string)=>void,
 *   factionColorFor?: (id:string)=>string }} model
 */
export function renderFactionsPanel(model) {
  const host = document.getElementById("factions-panel");
  if (!host) return;
  host.innerHTML = "";
  const factions = (model && model.factions) || [];
  setTabBadge("factions-tab-badge", factions.length);

  if (!factions.length) {
    const empty = document.createElement("div");
    empty.className = "panel-hint";
    empty.textContent = 'No factions yet — select a placed hex and press "Generate faction here" on the Detail tab.';
    host.appendChild(empty);
    return;
  }

  const head = document.createElement("div");
  head.className = "hooks-head";
  head.textContent = `${factions.length} faction${factions.length === 1 ? "" : "s"}`;
  host.appendChild(head);

  // Manual "Advance faction turn" (Phase 8.10) — GM pacing, independent of the
  // day clock. Shown when at least one faction is active.
  if (model.onAdvanceFactionTurn && factions.some((f) => (f.status || "active") === "active")) {
    const row = document.createElement("div");
    row.className = "tile-actions";
    row.appendChild(actionButton("Advance faction turn", model.onAdvanceFactionTurn));
    host.appendChild(row);
  }

  for (const faction of factions) host.appendChild(factionCard(faction, model));
}

// Encumbrance tier labels (Phase 8.4), matching ENCUMBRANCE_FACTOR's keys
// (js/gen/travel.js) and the existing B/X travel-tip tooltip's phrasing.
const ENCUMBRANCE_LABELS = {
  unencumbered: "Unencumbered",
  light: "Lightly loaded",
  encumbered: "Encumbered",
  heavy: "Heavily loaded",
};

// The 6 hex neighbour directions as compass labels (indexes match core
// hexgeo.js NEIGHBOR_DIRS; derived from each delta's pixel bearing on a
// pointy-top grid: E / NE / NW / W / SW / SE). Used to name a step in the log.
export const DIR_LABELS = ["E", "NE", "NW", "W", "SW", "SE"];

// The compass rose, laid out as a 3×3 grid (center empty). Each cell's `id` is
// the bearing passed to onTravelDirection: a hex-direction index (0-5) for the
// 6 true neighbours, or "N"/"S" for the pseudo-cardinals (which alternate their
// two flanking directions hex-by-hex — see travel.js travelDayBearing).
const ROSE_CELLS = [
  { id: 2, label: "NW", arrow: "↖" }, { id: "N", label: "N", arrow: "↑" }, { id: 1, label: "NE", arrow: "↗" },
  { id: 3, label: "W", arrow: "←" }, null, { id: 0, label: "E", arrow: "→" },
  { id: 4, label: "SW", arrow: "↙" }, { id: "S", label: "S", arrow: "↓" }, { id: 5, label: "SE", arrow: "↘" },
];

/**
 * Render the Travel tab: the party's pace (encumbrance) setting, a 6-direction
 * compass rose (each button travels ONE day that way), and the LAST DAY's
 * report. Everything here is app.js-only ephemeral state (not persisted); the
 * report is replaced on every travel press.
 * @param {{ encumbrance?: string, onSetEncumbrance?: (tier:string)=>void,
 *   onTravelDirection?: (bearing:number|"N"|"S")=>void,
 *   lastDay: {headline:string, finalPos:{q:number,r:number},
 *     log:{terrain:string,road:boolean,lost:boolean,dir:number}[]}|null }} model
 */
export function renderTravelPanel(model) {
  const host = document.getElementById("travel-panel");
  if (!host) return;
  host.innerHTML = "";

  host.appendChild(sectionLabel("Party pace"));
  const select = document.createElement("select");
  select.className = "encumbrance-select";
  select.setAttribute("aria-label", "Party encumbrance");
  for (const [value, label] of Object.entries(ENCUMBRANCE_LABELS)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === (model.encumbrance || "unencumbered")) opt.selected = true;
    select.appendChild(opt);
  }
  if (model.onSetEncumbrance) {
    select.addEventListener("change", () => model.onSetEncumbrance(select.value));
  }
  host.appendChild(select);

  // Compass rose — travel a day in a direction (into the unknown, generating
  // terrain as the party goes). 8 points: the 6 hex neighbours + N/S (which
  // zig-zag their flanking hexes).
  host.appendChild(sectionLabel("Travel a day"));
  const rose = document.createElement("div");
  rose.className = "dir-rose";
  for (const cell of ROSE_CELLS) {
    if (!cell) {
      const spacer = document.createElement("div");
      spacer.className = "dir-spacer";
      rose.appendChild(spacer);
      continue;
    }
    const b = document.createElement("button");
    b.className = "dir-btn";
    b.textContent = `${cell.arrow} ${cell.label}`;
    b.title = `Travel one day ${cell.label}`;
    if (model.onTravelDirection) b.addEventListener("click", () => model.onTravelDirection(cell.id));
    rose.appendChild(b);
  }
  host.appendChild(rose);

  host.appendChild(sectionLabel("Last day"));
  const last = model.lastDay;
  if (!last) {
    const empty = document.createElement("div");
    empty.className = "panel-hint";
    empty.textContent = 'No travel yet — press a direction above, or "Travel toward this hex" on a selected hex.';
    host.appendChild(empty);
    return;
  }

  const summary = document.createElement("div");
  summary.className = "log-line trip-summary";
  summary.textContent = last.headline;
  host.appendChild(summary);

  for (const entry of last.log) {
    const div = document.createElement("div");
    div.className = "log-line trip-day" + (entry.lost ? " trip-lost" : "");
    const road = entry.road ? " (road)" : "";
    const bend = entry.lost ? `, drifted ${DIR_LABELS[entry.dir]}` : "";
    div.textContent = `${entry.terrain}${road}${bend}`;
    host.appendChild(div);
  }

  const where = document.createElement("div");
  where.className = "log-line";
  where.textContent = `Now at (${last.finalPos.q}, ${last.finalPos.r}).`;
  host.appendChild(where);
}

// Editable GM annotations for a hex: a name (shown as a map label) + freeform
// notes. Both commit on blur/Enter (change event) — the only editable bits left
// in the otherwise read-only Detail tab.
function renderHexNotes(sel, model) {
  const a = model.annotation || { name: "", note: "" };
  sel.appendChild(sectionLabel("Notes"));

  const name = document.createElement("input");
  name.className = "hex-name";
  name.placeholder = "Name this hex…";
  name.value = a.name || "";
  name.setAttribute("aria-label", "Hex name");
  if (model.onRenameHex) {
    name.addEventListener("change", () => model.onRenameHex(name.value));
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });
  }
  sel.appendChild(name);

  const note = document.createElement("textarea");
  note.className = "room-note";
  note.rows = 3;
  note.placeholder = "Notes…";
  note.value = a.note || "";
  if (model.onNoteHex) note.addEventListener("change", () => model.onNoteHex(note.value));
  sel.appendChild(note);
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
    // Settlement as a plain info line (controls are on the radial menu). The
    // name is derived from the seed + coords (settlement-name.js), so it needs no
    // stored field; a GM hex `name` annotation, if set, still labels the map.
    if (hex.settlement && hex.settlement.present) {
      const div = document.createElement("div");
      div.className = "log-line";
      const name = settlementName(model.seed, coord.q, coord.r, hex.gen, {
        kind: hex.settlement.kind,
        terrain: hex.terrain,
      });
      const kindLabel = hex.settlement.kind === "keep" ? `${hex.settlement.size} — Keep (fortified)` : hex.settlement.size;
      const water = { estuary: "river-mouth port", river: "on a river", coast: "coastal" }[hex.settlement.waterBoost];
      div.textContent = `Settlement: ${name} (${kindLabel})${water ? ` · ${water}` : ""}`;
      sel.appendChild(div);
    }
    renderPoiSection(sel, hex, model);

    // Party actions: panel, not the radial ring — the ring's 8 slots are all
    // spoken for. "Place party here" (8.1) is an instant GM-override teleport;
    // "Travel toward this hex" (8.4) heads that way ONE day per press (pace,
    // getting lost) — kept alongside each other on purpose. Both hidden once
    // the party is already here.
    if (model.onPlaceParty || model.onTravelToward) {
      if (model.partyHere) {
        const div = document.createElement("div");
        div.className = "log-line";
        div.textContent = "The party is here.";
        sel.appendChild(div);
      } else {
        const row = document.createElement("div");
        row.className = "tile-actions";
        if (model.onTravelToward) row.appendChild(actionButton("Travel toward this hex", model.onTravelToward));
        if (model.onPlaceParty) row.appendChild(actionButton("Place party here", model.onPlaceParty));
        sel.appendChild(row);
      }
    }

    // Generate faction (Phase 8.7) — a panel action (the ring is full), mirroring
    // "Generate hook": the selected placed hex becomes the new faction's one
    // starting holding. A radial slot can come later (parent plan defers it).
    if (model.onGenerateFaction) {
      const frow = document.createElement("div");
      frow.className = "tile-actions";
      frow.appendChild(actionButton("Generate faction here", model.onGenerateFaction));
      sel.appendChild(frow);
    }

    // Which faction runs this hex (Phase 8.15) — a single-owner picker. It shows
    // the current holder (so the GM can see who runs the tile) and reassigns the
    // hex on change; "None" clears it. Replaces the old add-only claim button.
    if (model.onSetHexFaction && (model.factions || []).length) {
      const crow = document.createElement("div");
      crow.className = "tile-actions";
      const label = document.createElement("span");
      label.className = "faction-select-label";
      label.textContent = "Run by:";
      const pick = document.createElement("select");
      pick.className = "faction-select";
      pick.setAttribute("aria-label", "Faction that runs this hex");
      const held = model.factions.find((f) => (f.holdings || []).some((hd) => hd.q === coord.q && hd.r === coord.r));
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "None";
      pick.appendChild(none);
      for (const f of model.factions) {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.textContent = f.name;
        if (held && held.id === f.id) opt.selected = true;
        pick.appendChild(opt);
      }
      pick.addEventListener("change", () => model.onSetHexFaction(pick.value || null));
      crow.appendChild(label);
      crow.appendChild(pick);
      sel.appendChild(crow);
    }
  }

  // Annotations (name + notes) work for any selected cell — even an ungenerated
  // one — so the GM can label a spot before placing terrain there.
  renderHexNotes(sel, model);

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
    mkTab("travel", "Travel"),
    mkTab("factions", "Factions", "factions-tab-badge"),
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
  // Travel region (Phase 8.4): encumbrance setting + the last trip's report
  // (filled by renderTravelPanel).
  const travel = document.createElement("div");
  travel.id = "travel-panel";
  travel.hidden = true;
  el.appendChild(travel);
  // Factions region (Phase 8.7): the world's factions (filled by renderFactionsPanel).
  const factions = document.createElement("div");
  factions.id = "factions-panel";
  factions.hidden = true;
  el.appendChild(factions);
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
