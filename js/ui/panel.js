// Side-panel rendering helpers.

import { glyphForPoi } from "./poi-style.js";
import { featureDescription } from "../gen/feature-detail.js";
import { hookName, hookDescription } from "../gen/hooks.js";
import { factionLabel, factionDescription, factionHome } from "../gen/factions.js";
import { settlementName } from "../gen/settlement-name.js";
import { ORACLE_LABELS, ORACLE_ODDS } from "../gen/oracle.js";

const panel = () => document.getElementById("panel");

// --- panel tabs (Detail | Hooks | Pinned | Travel) ------------------------
// The panel shows one tab at a time; each region is built once (in showWorld)
// and toggled via a class on #panel.
let activeTab = "detail";
const TAB_REGIONS = { detail: "selection", hooks: "global-hooks", pinned: "pinned-hooks", oracle: "oracle-panel", chronicle: "chronicle-panel" };

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
      const on = b.dataset.tab === activeTab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    }
  }
}

/** Switch the side panel to a tab ("detail" | "hooks" | "pinned" | "oracle" | "chronicle"). */
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

// At-a-glance counts of the world's contents for the overview header (11.5b).
function worldStats(world) {
  let hexes = 0, settlements = 0, pois = 0, dungeons = 0;
  for (const h of Object.values(world.hexes || {})) {
    if (!h.placed) continue;
    hexes++;
    if (h.settlement && h.settlement.present) settlements++;
    const ps = Array.isArray(h.pois) ? h.pois : [];
    pois += ps.length;
    dungeons += ps.filter((p) => p.type === "dungeon").length;
  }
  return { hexes, settlements, pois, dungeons };
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
  // Promoting an occupied POI into a power lives on the radial (Faction →
  // Promote) now (Phase 11.5); the panel just shows the occupant read-only.
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
export function factionCard(faction, model) {
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

  // A single home jump link (12.1 refinement) — click-to-centre on the
  // faction's seat, or the centroid of its holdings when seatless. Replaces
  // the old per-holding link list, which grew unwieldy for large factions.
  if (model.onCenterFactionHome && factionHome(faction)) {
    const legend = document.createElement("div");
    legend.className = "hook-legend";
    const a = document.createElement("button");
    a.type = "button";
    a.className = "legend-link";
    a.title = "Centre the map on this faction";
    a.textContent = faction.seat ? "Jump to seat" : "Jump to centre";
    a.addEventListener("click", () => model.onCenterFactionHome(faction.id));
    legend.appendChild(a);
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
 * Render the Oracle tab (Phase 9.2/9.3) into #oracle-panel: each oracle's controls
 * followed by ITS OWN latest result block. The oracle is a transient GM aid —
 * nothing is stored or exported; a page reload starts blank. The app owns the
 * roll; this only draws the per-kind results + wires clicks back through
 * model.onRoll(kind, odds). `model.flashKind` (set only to the kind that just
 * rolled) replays that block's flash so a repeated answer still registers.
 * @param {{ results?: Record<string,{tag?:string,line:string,note?:string|null}>,
 *   flashKind?: string|null, onRoll?: (kind:string, odds?:string)=>void }} model
 */
export function renderOraclePanel(model) {
  const host = document.getElementById("oracle-panel");
  if (!host) return;
  host.innerHTML = "";
  const results = (model && model.results) || {};
  const flashKind = model && model.flashKind;
  const roll = model && model.onRoll;

  const head = document.createElement("div");
  head.className = "hooks-head";
  head.textContent = "Oracle";
  host.appendChild(head);

  // Yes/No fate oracle (9.2): pick the odds → roll. Each button both sets the
  // likelihood and rolls, so it's one click. (9.4-9.6 add more oracle sections.)
  host.appendChild(sectionLabel(ORACLE_LABELS.yesno));
  const odds = document.createElement("div");
  odds.className = "oracle-odds tile-actions";
  if (roll) {
    for (const o of ORACLE_ODDS) {
      const b = actionButton(o.label, () => roll("yesno", o.key));
      b.title = `Roll Yes / No at ${o.label.toLowerCase()} odds`;
      odds.appendChild(b);
    }
  }
  host.appendChild(odds);
  appendOracleResult(host, results.yesno, flashKind === "yesno");

  // Meaning oracle (9.3): an action × subject pair to interpret an open question
  // or a Yes/No's random-event flag.
  host.appendChild(sectionLabel(ORACLE_LABELS.meaning));
  const meaning = document.createElement("div");
  meaning.className = "oracle-meaning tile-actions";
  if (roll) {
    const b = actionButton("Roll meaning", () => roll("meaning"));
    b.title = "Roll an action + subject pair to read into the scene";
    meaning.appendChild(b);
  }
  host.appendChild(meaning);
  appendOracleResult(host, results.meaning, flashKind === "meaning");

  // Complication oracle (9.4): a terse setback for a "yes, but…" / "no, and…"
  // beat, or to spice a quiet scene.
  host.appendChild(sectionLabel(ORACLE_LABELS.complication));
  const complication = document.createElement("div");
  complication.className = "oracle-complication tile-actions";
  if (roll) {
    const b = actionButton("Roll complication", () => roll("complication"));
    b.title = "Roll a terse twist to drop into the scene";
    complication.appendChild(b);
  }
  host.appendChild(complication);
  appendOracleResult(host, results.complication, flashKind === "complication");

  // Settlement situation (9.5): context-aware — it reads the selected town (its
  // size/terrain + any faction presence). The button shows only when a settlement
  // is selected; otherwise a hint points at the map.
  host.appendChild(sectionLabel(ORACLE_LABELS.settlement));
  const settlement = (model && model.settlement) || {};
  if (roll && settlement.available) {
    const row = document.createElement("div");
    row.className = "oracle-settlement tile-actions";
    const b = actionButton("Roll situation", () => roll("settlement"));
    b.title = `What's stirring in ${settlement.label}?`;
    row.appendChild(b);
    host.appendChild(row);
    appendOracleResult(host, results.settlement, flashKind === "settlement");
  } else {
    const hint = document.createElement("div");
    hint.className = "panel-hint";
    hint.textContent = "Select a town on the map to read what's stirring there.";
    host.appendChild(hint);
  }

  // Tavern / shop (9.6): a sign × specialty × quirk to make a stop memorable.
  // Context-free like Meaning; no proprietor NPC.
  host.appendChild(sectionLabel(ORACLE_LABELS.tavern));
  const tavern = document.createElement("div");
  tavern.className = "oracle-tavern tile-actions";
  if (roll) {
    const b = actionButton("Roll tavern / shop", () => roll("tavern"));
    b.title = "Roll a sign, specialty, and quirk for an establishment";
    tavern.appendChild(b);
  }
  host.appendChild(tavern);
  appendOracleResult(host, results.tavern, flashKind === "tavern");
  // (Wilderness encounters live on the map now — starred along the travel route,
  // not rolled from this panel. See applyTravel / drawEncounterMarks.)
}

// One oracle kind's latest result block (or an empty hint), appended to `host`.
// `flash` replays the reveal animation for a just-happened roll.
function appendOracleResult(host, result, flash) {
  if (!result) {
    const empty = document.createElement("div");
    empty.className = "panel-hint";
    empty.textContent = "No roll yet.";
    host.appendChild(empty);
    return;
  }
  const block = document.createElement("div");
  block.className = "oracle-result" + (flash ? " oracle-flash" : "");
  if (result.tag) {
    const tag = document.createElement("span");
    tag.className = "oracle-kind";
    tag.textContent = result.tag;
    block.appendChild(tag);
  }
  const ans = document.createElement("span");
  ans.className = "oracle-answer";
  ans.textContent = result.line != null ? String(result.line) : "";
  block.appendChild(ans);
  host.appendChild(block);

  // Body lines (9.6) — normal-weight detail under the headline (e.g. a tavern's
  // specialty + quirk).
  if (Array.isArray(result.body)) {
    for (const b of result.body) {
      const line = document.createElement("div");
      line.className = "oracle-body" + (flash ? " oracle-flash-note" : "");
      line.textContent = b;
      host.appendChild(line);
    }
  }

  // Accent note (9.2 random event / 9.5 faction) — its own line under the result.
  if (result.note) {
    const note = document.createElement("div");
    note.className = "oracle-note" + (flash ? " oracle-flash-note" : "");
    note.textContent = result.note;
    host.appendChild(note);
  }
}

/**
 * Render the Chronicle tab (Phase 12.2) into #chronicle-panel: the world's
 * persisted, capped log of located world events (faction turns/emergence, travel
 * recaps, encounters). Rendered NEWEST-FIRST by iterating the array in reverse —
 * never sorted by `day`, so within a day insertion order is preserved. A row with
 * an `at` (and an onCenter handler) is clickable to recentre the map there.
 * @param {{ chronicle?: {day:number,text:string,kind?:string,at?:{q:number,r:number}|null}[],
 *   onCenter?: (q:number, r:number)=>void }} model
 */
export function renderChroniclePanel(model) {
  const host = document.getElementById("chronicle-panel");
  if (!host) return;
  host.innerHTML = "";
  const entries = (model && model.chronicle) || [];
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "panel-hint";
    empty.textContent = "Nothing has happened yet — travel, advance the clock, or advance a faction turn to fill the chronicle.";
    host.appendChild(empty);
    return;
  }
  const head = document.createElement("div");
  head.className = "hooks-head";
  head.textContent = `${entries.length} event${entries.length === 1 ? "" : "s"}`;
  host.appendChild(head);

  const onCenter = model && model.onCenter;
  // Newest-first: walk the array backwards (do NOT sort — insertion order carries
  // the sequence within a shared day).
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const row = document.createElement("div");
    row.className = "chron-row";

    const tag = document.createElement("span");
    tag.className = "chron-tag";
    tag.textContent = `Day ${e.day}` + (e.kind && e.kind !== "event" ? ` · ${e.kind}` : "");
    row.appendChild(tag);

    const text = document.createElement("span");
    text.className = "chron-text";
    text.textContent = e.text;
    row.appendChild(text);

    if (e.at && onCenter) {
      row.classList.add("clickable");
      row.title = "Centre the map here";
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.addEventListener("click", () => onCenter(e.at.q, e.at.r));
      row.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onCenter(e.at.q, e.at.r); }
      });
    }
    host.appendChild(row);
  }
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
  // Title row: the selection heading + a "⋯ Actions" button that opens the
  // radial on this cell (Phase 11.5b) — so every hex action is reachable without
  // a right-click (touch / keyboard friendly).
  const head = document.createElement("div");
  head.className = "selection-head";
  const h = document.createElement("h3");
  h.textContent = hex ? "Selected hex" : `Empty (${coord.q}, ${coord.r})`;
  head.appendChild(h);
  if (model.onOpenActions) {
    const act = document.createElement("button");
    act.className = "sel-actions";
    act.textContent = "⋯ Actions";
    act.title = "Open the actions ring for this hex";
    act.addEventListener("click", () => model.onOpenActions());
    head.appendChild(act);
  }
  sel.appendChild(head);

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

    // Hex/POI actions (party, faction, reseat, promote) all live on the
    // right-click radial now (Phase 11.5) — the panel is read-only. A quiet
    // status line notes when the party stands here.
    if (model.partyHere) {
      const div = document.createElement("div");
      div.className = "log-line";
      div.textContent = "🚩 The party is here.";
      sel.appendChild(div);
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
// The app is a referee's oracle, not a rulebook (9.8): a hoard reads as a B/X lair
// Treasure Type LETTER + how it's guarded, and the GM rolls the contents on their
// own tables — no invented gp. ("Treasure Type D, hidden — roll on your tables.")
function treasureLine(t) {
  return `Treasure Type ${t.type}, ${t.guard} — roll on your tables.`;
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
  // Overview stats (Phase 11.5b): an at-a-glance count of the world's contents.
  const stats = worldStats(world);
  const chips = document.createElement("div");
  chips.className = "world-stats";
  for (const [label, n] of [["hexes", stats.hexes], ["towns", stats.settlements], ["POIs", stats.pois], ["dungeons", stats.dungeons]]) {
    const chip = document.createElement("span");
    chip.className = "wchip";
    const b = document.createElement("b");
    b.textContent = String(n);
    chip.append(b, ` ${label}`);
    chips.appendChild(chip);
  }
  el.appendChild(chips);
  // Tab bar: Selection (selected hex/room) | Hooks | Pinned | Oracle.
  // Switching just toggles which region shows.
  const tabs = document.createElement("div");
  tabs.className = "panel-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Panel sections");
  const mkTab = (key, label, badgeId) => {
    const b = document.createElement("button");
    b.dataset.tab = key;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", TAB_REGIONS[key]);
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
    mkTab("detail", "Selection"),
    mkTab("hooks", "Hooks", "hooks-tab-badge"),
    mkTab("pinned", "Pinned", "pinned-tab-badge"),
    mkTab("oracle", "Oracle"),
    mkTab("chronicle", "Chronicle"),
  );
  el.appendChild(tabs);
  const region = (id, hidden) => {
    const d = document.createElement("div");
    d.id = id;
    d.setAttribute("role", "tabpanel");
    if (hidden) d.hidden = true;
    el.appendChild(d);
    return d;
  };
  region("selection"); // selected hex / dungeon room details
  region("global-hooks", true); // unpinned world hooks (renderGlobalHooks)
  region("pinned-hooks", true); // the party's pinned leads
  region("oracle-panel", true); // on-demand GM oracle rolls (renderOraclePanel)
  region("chronicle-panel", true); // the world's located-event log (renderChroniclePanel)
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
