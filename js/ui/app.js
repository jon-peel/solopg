// App bootstrap: wires the command bar, world list, side panel, and hex map to
// the engine and persistence layers. Only entry module loaded by index.html.

import { subRng } from "../core/rng.js";
import { loadTables } from "../core/loader.js";
import { axialKey, axialLine, hexDisc, neighbors, axialDistance } from "../core/hexgeo.js";
import {
  generateHook,
  hookName,
  rollHookPattern,
  chooseDistantTarget,
  startChain,
  buildChainStep,
  buildLocalHook,
  buildEscortHook,
  buildRegionHook,
  buildExpansionHook,
} from "../gen/hooks.js";
import {
  createWorld,
  addHex,
  getHex,
  hasHexAt,
  placedHexes,
  removeHex,
  setPartyPosition,
  setPartyEncumbrance,
  addFaction,
  getFactions,
} from "../world/world.js";
import { generateFaction, promoteFaction, addHolding, advanceFactionTurn, advanceFactionDays, factionHookContext, expansionHookContext, rollRegionStir } from "../gen/factions.js";
import { generateHex } from "../gen/hex.js";
import { computeRegions } from "../gen/regions.js";
import { computeRivers, buildManualRiver } from "../gen/rivers.js";
import { computeRoads, buildManualRoad } from "../gen/roads.js";
import { travelDayToward, travelDayBearing, roadHexKeySet, sightHexes } from "../gen/travel.js";
import { applyWaterBoosts, seedWaterSettlements, seedHamletClusters } from "../gen/settlement-water.js";
import { generatePoi } from "../gen/poi.js";
import { generateDungeon, DUNGEON_BUILD } from "../gen/dungeon.js";
import { generateTower, TOWER_BUILD } from "../gen/tower.js";
import { describeFeature, featureName, FEATURE_BUILD, FEATURE_TYPES } from "../gen/feature-detail.js";
import { getRoomState, withRoomState } from "../world/dungeon-state.js";
import { profileFor, SIZE_ORDER, isLargeSize } from "../gen/terrain-profile.js";
import { exportWorld, importWorld, migrateWorld } from "../data/portability.js";
import {
  listWorlds,
  saveWorld,
  loadWorld,
  deleteWorld,
  setLastWorldId,
  getLastWorldId,
} from "../data/db.js";
import { logLine, showWorld, renderSelectionPanel, renderDungeonPanel, renderGlobalHooks, renderTravelPanel, renderFactionsPanel, setPanelTab } from "./panel.js";
import { settlementName } from "../gen/settlement-name.js";
import { attachDungeon, setLevel, setMarks, setSelectedRoom, fitView, centerOnRoom } from "./dungeon-map.js";
import {
  attachMap,
  setWorld,
  setSelected,
  recenterOn,
  setIconsEnabled,
  setLabelsEnabled,
  setHookMarks,
  setHookFocus,
  setRiverDraft,
  setRoadDraft,
  zoomStep,
  recenter,
  pixelsPerMile,
} from "./map.js";
import { TERRAIN_COLORS, TERRAIN_ICONS } from "./terrain-style.js";
import { POI_GLYPHS, POI_DOT_COLORS, factionColor } from "./poi-style.js";
import { buildRadialModel } from "./radial-model.js";
import { buildRoomRadialModel } from "./radial-room-model.js";
import { openRadial, closeRadial, isRadialOpen } from "./radial-menu.js";

// Tables the hex generator rolls on. Settlement/POI presence are now driven by
// the terrain profile (not tables); settlement-size is still rolled (capped).
const HEX_TABLE_IDS = [
  "terrain",
  "swamp-feature",
  "settlement-size",
  "poi-types",
  "poi-occupant",
  "creatures",
  "occupiers",
  "dungeon-size",
  "dungeon-theme",
  "dungeon-room",
  "dungeon-trap",
  "dungeon-special",
  "dungeon-dressing",
  "dungeon-treasure",
  "dungeon-treasure-guard",
  "dungeon-monster-status",
  "dungeon-light",
  "monster-families",
  "dungeon-family",
  "shrine-form",
  "shrine-dedication",
  "shrine-condition",
  "shrine-detail",
  "camp-scale",
  "camp-reaction",
  "landmark-feature",
  "landmark-trait",
  "landmark-hook",
  "tower-kind",
  "tower-master",
];

// Tables the hook generator rolls on (loaded on demand when a hook is generated).
// A Distant hook also needs the hex/POI tables to build its target tile, so
// onGenerateHook loads HEX_TABLE_IDS alongside these.
const HOOK_TABLE_IDS = [
  "hook-pattern",
  "hook-verb",
  "hook-source",
  "hook-explore",
  "hook-threat",
  "hook-rescue",
  "hook-warning",
  "hook-opportunity",
  "hook-commodity",
  "hook-event",
  "hook-cargo",
  "hook-recipient",
  "hook-clue",
  "hook-payoff",
  "hook-patron",
  "hook-reward",
  "hook-return",
  "creatures",
];

// Tables the faction generator rolls on (Phase 8.7), loaded on demand.
const FACTION_TABLE_IDS = ["faction-archetype", "faction-goal", "faction-disposition"];
// Tables a faction hook (8.11/8.12) needs: the deed + witness source (rolled by
// factionHookContext) and the reward tables (a threat carries a bounty). The claim
// and source are supplied, so hook-threat/hook-source aren't rolled by the engine.
const FACTION_HOOK_TABLE_IDS = ["faction-deed", "hook-source", "hook-patron", "hook-reward"];
// Region "something is stirring" hooks (8.14) just need the omen table.
const REGION_HOOK_TABLE_IDS = ["region-omen"];

let current = null; // the in-memory current world
let selected = null; // { q, r } | null — selected map cell
let selectedPoiId = null; // drill-in POI within the selected hex
let selectedHookId = null; // hook whose target/origin are highlighted on the map
let draftClicks = null; // manual river/road drawing: clicked anchor hexes, or null when not drawing
let draftKind = null;   // "river" | "road" — what the active draft builds

// World clock (Phase 8.1) — deliberately a SESSION-only counter, never part of
// `world`/IndexedDB/export: always starts at 0 on page load. 8.4 advances it by
// ONE per travelled day; 8.6 adds a manual "Progress N days" while stationary.
let sessionDay = 0;

// Last day's travel report (Phase 8.4) — ephemeral, app.js-only, like
// sessionDay: replaced by each travel press, reset on world switch.
let lastDay = null;

// Dungeon View state (the overlay shown when exploring a dungeon POI).
let dungeonPoi = null; // the open dungeon POI, or null when in the hex map
let dungeonLevelIndex = 0;
let dungeonRoomN = null; // selected room number within the current level
let dungeonSizes = []; // size names from the dungeon-size table (for the add menu)
let dungeonFrameBB = null; // shared bounding box for the open dungeon's levels

const $ = (id) => document.getElementById(id);

// --- selection persistence (per-world, localStorage; not in the world JSON) ---
const selKey = (w) => `selection:${w.id}`;
function saveSelected(w, sel) {
  try {
    if (sel) localStorage.setItem(selKey(w), JSON.stringify(sel));
    else localStorage.removeItem(selKey(w));
  } catch {
    /* non-fatal */
  }
}
function loadSelected(w) {
  try {
    return JSON.parse(localStorage.getItem(selKey(w))) || null;
  } catch {
    return null;
  }
}

function firstPlacedCoord(world) {
  const placed = placedHexes(world);
  return placed.length ? placed[0].coords : null;
}

async function refreshWorldList() {
  const worlds = await listWorlds();
  const sel = $("world-select");
  sel.innerHTML = "";
  if (worlds.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "(no worlds)";
    opt.value = "";
    sel.appendChild(opt);
  }
  for (const w of worlds) {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = w.name;
    if (current && w.id === current.id) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function setCurrent(world) {
  closeRadial(); // switching worlds dismisses any open radial menu
  if (dungeonPoi) closeDungeonView(); // leave any open dungeon when switching worlds
  if (world) migrateWorld(world); // upgrade persisted older worlds (v2 -> v3 ...)
  current = world;
  selectedPoiId = null;
  selectedHookId = null; // clear any hook highlight from the previous world
  lastDay = null; // the last day's travel report is ephemeral, per-world (Phase 8.4)
  if (world) syncRivers(world); // rebuild the river overlay for the loaded world
  if (world) syncRoads(world);  // ...then the road overlay (needs final settlements + rivers)
  if (world) setLastWorldId(world.id);
  showWorld(world, { onRename: onRenameWorld });
  setWorld(world);
  selected = world ? loadSelected(world) : null;
  setSelected(selected);
  if (world) {
    const focus = selected || firstPlacedCoord(world);
    if (focus) recenterOn(focus.q, focus.r);
  }
  renderSelection();
  refreshGlobalHooks();
  refreshFactions();
  refreshTravelPanel();
  refreshHookMarks();
  refreshHookFocus();
  refreshMapChrome();
  await refreshWorldList();
}

// Create a new world. `fillRadius` (from the New World dropdown) optionally
// pre-fills a hex disc of that radius around the origin — Empty (null), Small (1),
// Medium (2), Large (3), Huge (15) — running the full terrain/water/settlement/
// road pipeline via setCurrent's sync passes.
async function onNewWorld(fillRadius = null) {
  // No blocking prompt(): browsers can suppress repeated dialogs (the "prevent
  // this page from creating more dialogs" box), which silently broke this
  // button. Create with a default name; rename inline via the panel title.
  const worlds = await listWorlds();
  const world = createWorld({ name: defaultWorldName(worlds) });
  let filled = 0;
  if (fillRadius) {
    current = world; // buildRandomHex reads `current` for neighbour affinity + spacing
    const tables = await loadTables(HEX_TABLE_IDS);
    for (const { q, r } of hexDisc(0, 0, fillRadius)) {
      if (hasHexAt(current, q, r)) continue;
      addHex(current, buildRandomHex(tables, q, r, 0));
      filled++;
    }
    syncRivers(current);
    syncRoads(current); // persist the derived overlays with the world
  }
  const saved = await saveWorld(world);
  await setCurrent(saved);
  selectCell(0, 0); // land the GM on the origin, ready to right-click
  recenterOn(0, 0);
  logLine(filled ? `Created a new world (${filled} hexes).` : "Created and saved.");
}

// The New World button opens a small dropdown (Empty / Small / Medium / Large /
// Huge); picking a size creates the world pre-filled to that hex radius.
function wireNewWorldMenu() {
  const btn = $("btn-new");
  const menu = $("new-world-menu");
  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  menu.addEventListener("click", (e) => {
    const opt = e.target.closest("button[data-radius]");
    if (!opt) return;
    setOpen(false);
    const raw = opt.dataset.radius;
    onNewWorld(raw ? Number(raw) : null);
  });
  // Dismiss on an outside click or Escape.
  document.addEventListener("click", (e) => { if (!menu.hidden && !e.target.closest("#new-world-menu, #btn-new")) setOpen(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
}

// --- map chrome (hover readout, scale, empty-state prompt, help) ---------

// Update the hovered-hex readout (bottom-left), shown only while hovering.
function onHover(cell) {
  const box = $("map-readout");
  const el = $("readout-cell");
  if (!box || !el) return;
  if (!cell || !current) {
    el.textContent = "";
    box.hidden = true;
    return;
  }
  const hex = getHex(current, cell.q, cell.r);
  const label = hex && hex.placed
    ? (hex.name ? `${hex.name} · ${hex.terrain}` : hex.terrain)
    : (hex && hex.name ? hex.name : "empty");
  el.textContent = `(${cell.q}, ${cell.r}) ${label}`;
  box.hidden = false;
}

// Show the empty-state prompt until the world has a hex; keep the scale bar +
// travel tip current.
function refreshMapChrome() {
  const empty = $("map-empty");
  if (empty) empty.hidden = !current || placedHexes(current).length > 0;
  const scale = $("map-scale");
  if (scale) scale.hidden = !current;
  const tip = $("travel-tip");
  if (tip && current) tip.innerHTML = travelTipHTML(current.hexScale);
  if (current) drawScaleBar(pixelsPerMile());
  renderDayReadout();
}

// Session-only world clock readout (Phase 8.1) — see `sessionDay`.
function renderDayReadout() {
  const el = $("day-readout");
  if (el) el.textContent = `Day ${sessionDay}`;
}

// The single day-advance chokepoint (Phase 8.6). Every place a day passes —
// travelling (8.4) and the stationary "Progress" control — goes through here,
// so Arc B/C have ONE seam to hook: 8.10 faction turns and 8.12 auto-hooks will
// fire as days pass. For now it only bumps the (session-only) clock.
async function advanceDays(n) {
  if (!Number.isFinite(n) || n < 1) return;
  sessionDay += n;
  // Fire the faction turns the elapsed days earn (Phase 8.10); each turn now returns
  // events (8.15) that we (1) log and (2) turn into hooks. Then the region "stirring"
  // pass (8.14). All mutate current.factions/current.hooks; the caller persists once.
  if (current) {
    const events = advanceFactionDays(current, n, current.seed);
    logFactionEvents(events);
    emitExpansionHooks(events);
    const active = getFactions(current).filter((f) => (f.status || "active") === "active");
    if (active.length) await autoFireRegionHooks(active, n, sessionDay - n);
  }
  renderDayReadout();
}

// Phase 8.15 (B) — narrate every faction event on the turn (both the day-tick and
// the manual button route through here). One legible line per event; names resolve
// via getFactions and a place label via destinationLabel.
function logFactionEvents(events) {
  if (!Array.isArray(events) || !events.length) return;
  const factions = getFactions(current);
  const nameOf = (id) => { const f = factions.find((x) => x.id === id); return f ? f.name : "A faction"; };
  const placeOf = (q, r) => destinationLabel(getHex(current, q, r), q, r);
  for (const ev of events) {
    if (ev.kind === "claim") logLine(`${nameOf(ev.factionId)} spreads into ${placeOf(ev.q, ev.r)}.`);
    else if (ev.kind === "move") logLine(`${nameOf(ev.factionId)} moves camp to ${placeOf(ev.q, ev.r)}.`);
    else if (ev.kind === "takeover") logLine(`${nameOf(ev.factionId)} seizes ${placeOf(ev.q, ev.r)} from ${nameOf(ev.fromFactionId)}.`);
    else if (ev.kind === "repelled") logLine(`${nameOf(ev.factionId)} is driven back from ${placeOf(ev.q, ev.r)} (held by ${nameOf(ev.fromFactionId)}).`);
    else if (ev.kind === "eliminated") logLine(`${nameOf(ev.factionId)} is destroyed.`);
  }
}

// Phase 8.15 (C) — what a hex carries, deciding whether an expansion event is worth
// a hook. Priority: settlement > poi > road > bare.
function hexImpact(world, q, r) {
  const hex = getHex(world, q, r);
  if (hex && hex.settlement && hex.settlement.present) return "settlement";
  if (hex && Array.isArray(hex.pois) && hex.pois.length) return "poi";
  if (roadHexKeySet(world.roads).has(axialKey(q, r))) return "road";
  return "bare";
}

// A spreading faction taking a POI hex chases out whoever held it and installs
// itself as the new occupant (Phase 8.15 C). A roamer raid does NOT call this — the
// camp leaves next turn — so only claim/takeover on a spreading faction rewrite.
function rewriteOccupant(faction, q, r) {
  const hex = getHex(current, q, r);
  const poi = hex && (hex.pois || [])[0];
  if (poi) poi.occupant = { kind: "occupied", by: faction.name, factionId: faction.id };
}

// The name a hook uses for the affected place, by impact class (Phase 8.15 C):
// POI → its base name; settlement → its name; road → "the road by <town>" (or a
// bare terrain road when no settlement is near).
function placeLabel(world, q, r, impact) {
  const hex = getHex(world, q, r);
  if (impact === "poi") {
    const poi = hex && (hex.pois || [])[0];
    return poi ? poiBaseName(poi) : `(${q}, ${r})`;
  }
  if (impact === "settlement") return destinationLabel(hex, q, r);
  const near = nearestSettlementTo(world, { q, r });
  if (near) return `the road by ${destinationLabel(getHex(world, near.q, near.r), near.q, near.r)}`;
  return hex && hex.terrain ? `the ${hex.terrain.toLowerCase()} road` : "the road";
}

// Phase 8.15 (C) — turn SIGNIFICANT expansion events into hooks. Only claim /
// takeover / move onto a settlement / poi / road matter (bare → the log line is
// enough; repelled / eliminated → log only). Capped at 2 hooks per faction per
// advance so a busy turn doesn't flood. A spreading claim/takeover onto a POI also
// rewrites the occupant (even past the hook cap — the faction holds it now). Pushes
// to current.hooks + logs; the caller persists once.
const EXPANSION_HOOKABLE = new Set(["claim", "takeover", "move"]);
function emitExpansionHooks(events) {
  if (!Array.isArray(events) || !events.length) return;
  const perFaction = new Map(); // factionId -> hooks emitted this advance (cap 2)
  for (const ev of events) {
    if (!EXPANSION_HOOKABLE.has(ev.kind)) continue;
    const faction = getFactions(current).find((f) => f.id === ev.factionId);
    if (!faction) continue;
    const impact = hexImpact(current, ev.q, ev.r);
    if (impact === "bare") continue;
    // Occupant rewrite is a state change, independent of the hook cap.
    if (impact === "poi" && (ev.kind === "claim" || ev.kind === "takeover")) rewriteOccupant(faction, ev.q, ev.r);
    if ((perFaction.get(ev.factionId) || 0) >= 2) continue;
    perFaction.set(ev.factionId, (perFaction.get(ev.factionId) || 0) + 1);
    if (!Array.isArray(current.hooks)) current.hooks = [];
    const hex = getHex(current, ev.q, ev.r);
    const poi = impact === "poi" && hex ? (hex.pois || [])[0] : null;
    const origin = nearestSettlementTo(current, ev)
      || (current.party ? { q: current.party.q, r: current.party.r } : { q: ev.q, r: ev.r });
    const index = nextHookId(current);
    const rng = subRng(current.seed, "expansion", faction.id, index);
    const { claim } = expansionHookContext(faction, impact, rng);
    const hook = buildExpansionHook({
      actor: faction.name, claim,
      subject: {
        name: placeLabel(current, ev.q, ev.r, impact),
        type: impact === "poi" ? "poi" : impact,
        q: ev.q, r: ev.r,
        poiId: poi ? poi.id : undefined,
        terrain: hex ? hex.terrain : null,
      },
      origin, index, sourcePower: faction.id,
    });
    current.hooks.push(hook);
    logLine(`Word from the frontier — ${hookName(hook)}.`);
  }
}

// Phase 8.14 — a whole named tract "stirs" when the factions seated in it escalate
// (regionHeat: strength × doom-clock progress + contest tension). At most one open
// region hook per region at a time (dedupe). Pushes silently; the caller persists.
async function autoFireRegionHooks(factions, days, dayStart) {
  const regions = computeRegions(current.seed, buildTerrainByKey(current), { minSize: 16 });
  if (!regions.length) return;
  // Which named region does each hex fall in? Then bucket factions by their seat.
  const regionByKey = new Map();
  for (const reg of regions) for (const k of reg.keys) regionByKey.set(k, reg);
  const buckets = new Map(); // region.id -> { region, fs:[] }
  for (const f of factions) {
    const seat = (f.holdings || [])[0];
    if (!seat) continue;
    const reg = regionByKey.get(axialKey(seat.q, seat.r));
    if (!reg) continue;
    let b = buckets.get(reg.id);
    if (!b) buckets.set(reg.id, (b = { region: reg, fs: [] }));
    b.fs.push(f);
  }
  let tables = null;
  for (const { region, fs } of buckets.values()) {
    // One open region hook per region — let it stand until the GM resolves it.
    const open = (current.hooks || []).some(
      (h) => h.pattern === "region" && h.region && h.region.id === region.id && (h.status || "open") === "open",
    );
    if (open) continue;
    if (!rollRegionStir(fs, days, subRng(current.seed, "regionstir", region.id, dayStart))) continue;
    if (!tables) tables = await loadTables(REGION_HOOK_TABLE_IDS);
    if (!Array.isArray(current.hooks)) current.hooks = [];
    const dominant = fs.reduce((a, b) => ((b.strength || 0) > (a.strength || 0) ? b : a));
    const n = nextHookId(current);
    const hook = buildRegionHook(tables, subRng(current.seed, "regionhook", region.id, n), {
      region, index: n, sourcePower: dominant.id,
    });
    current.hooks.push(hook);
    logLine(`The ${region.name.replace(/^the /i, "")} is stirring — ${fs.length} faction${fs.length === 1 ? "" : "s"} at work.`);
  }
}

// "Progress N days" while stationary (Phase 8.6) — advances the (session-only)
// day counter. Since 8.10, elapsed days can fire faction turns (persisted state),
// so persist + refresh when the world has factions. The day itself is still not
// persisted — only the faction clock/goal changes are.
async function onProgressDays() {
  const input = $("progress-days");
  const n = Math.max(1, Math.floor(Number(input && input.value) || 1));
  await advanceDays(n);
  if (current && getFactions(current).length) await persistAndRefresh();
}

// Manual "Advance faction turn" (Phase 8.10) — GM pacing, independent of the day
// clock: fires exactly one turn for every active faction. The turn returns events
// (8.15) that we log and turn into hooks, then persist. No day-driven region pass
// here (that's the day clock's job).
async function onAdvanceFactionTurn() {
  if (!current) return;
  const active = getFactions(current).filter((f) => (f.status || "active") === "active").length;
  if (!active) return logLine("No active factions to advance.");
  const events = advanceFactionTurn(current, current.seed);
  logFactionEvents(events);
  emitExpansionHooks(events);
  if (!events.length) logLine("The factions bide their time — no change on the map.");
  await persistAndRefresh();
}

// Draw the scale bar for the current zoom: a day's march marked at 12/18/24 mi
// (the B/X / OSE travel tiers), solid 0–12 then hollow to 18 and 24.
function drawScaleBar(ppm) {
  const host = $("map-scale");
  if (!host || !current) return;
  // Four 6-mile blocks (= 1 hex each), alternating solid/hollow so every
  // division is visible; marks land on the travel tiers 6/12/18/24.
  const segs = [[6, "solid"], [6, "hollow"], [6, "solid"], [6, "hollow"]];
  const marks = [0, 6, 12, 18, 24];
  const w = ppm * 24;
  const bar = segs
    .map(([mi, cls]) => `<div class="scale-seg ${cls}" style="width:${ppm * mi}px"></div>`)
    .join("");
  const ticks = marks.map((m) => `<span style="left:${ppm * m}px">${m}</span>`).join("");
  host.innerHTML =
    `<div class="scale-bar" style="width:${w}px">${bar}</div>` +
    `<div class="scale-ticks" style="width:${w}px">${ticks}</div>` +
    `<div class="scale-cap">miles</div>`;
}

// Travel-rules popover content, with per-tier distance in this world's hexes.
function travelTipHTML(milesPerHex) {
  const hx = (mi) => Math.round(mi / milesPerHex);
  const row = (label, mi) => {
    const h = hx(mi);
    return `<tr><td>${label}</td><td>${mi} mi</td><td>${h} hex${h === 1 ? "" : "es"}</td></tr>`;
  };
  return (
    `<strong>Overland travel — B/X &amp; OSE</strong>` +
    `<table>${row("Unencumbered", 24)}${row("Lightly loaded", 18)}` +
    `${row("Encumbered", 12)}${row("Heavily loaded", 6)}</table>` +
    `<div class="tt-terrain">Terrain: road ×1½ · hills/forest/desert ×⅔ · mountains/jungle/swamp ×½</div>` +
    `<div class="tt-terrain">Forced march +½ (then rest a day)</div>`
  );
}

function toggleTravelTip(show) {
  const tip = $("travel-tip");
  if (tip) tip.hidden = !show;
}

function toggleHelp(force) {
  const el = $("help-overlay");
  if (!el) return;
  el.hidden = force === undefined ? !el.hidden : !force;
}

// Fill the legend's terrain rows from the single-source colour/icon tables (so
// the key can never drift from the map), then toggle its visibility.
let legendBuilt = false;
function buildLegendTerrain() {
  if (legendBuilt) return;
  const host = $("legend-terrain");
  if (!host) return;
  host.innerHTML = `<div class="legend-sub">Terrain</div>`;
  for (const terrain of Object.keys(TERRAIN_COLORS)) {
    const row = document.createElement("div");
    row.className = "legend-row";
    const sw = document.createElement("span");
    sw.className = "lg-swatch";
    sw.style.background = TERRAIN_COLORS[terrain];
    const icon = (TERRAIN_ICONS[terrain] && TERRAIN_ICONS[terrain][0]) || "";
    row.append(sw, document.createTextNode(`${icon} ${terrain}`));
    host.appendChild(row);
  }
  buildLegendPoi();
  legendBuilt = true;
}

// Far-zoom POI dot colours (Phase 7.9) — same source table map.js reads from.
function buildLegendPoi() {
  const host = $("legend-poi");
  if (!host) return;
  host.innerHTML = `<div class="legend-sub">Points of interest</div>`;
  for (const type of Object.keys(POI_DOT_COLORS)) {
    const row = document.createElement("div");
    row.className = "legend-row";
    const sw = document.createElement("span");
    sw.className = "lg-swatch";
    sw.style.background = POI_DOT_COLORS[type];
    sw.style.borderRadius = "50%";
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    row.append(sw, document.createTextNode(`${POI_GLYPHS[type] || "❖"} ${label}`));
    host.appendChild(row);
  }
  const note = document.createElement("div");
  note.className = "legend-note";
  note.textContent = "Far zoom: dot = single POI (by type); numbered dot = several.";
  host.appendChild(note);
}
function toggleLegend(force) {
  const el = $("legend");
  if (!el) return;
  buildLegendTerrain();
  el.hidden = force === undefined ? !el.hidden : !force;
  $("btn-legend").setAttribute("aria-pressed", String(!el.hidden));
}

// `?` toggles the cheat-sheet; Esc closes it (ahead of other Esc handlers).
function onHelpKey(e) {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  if (e.key === "?") {
    toggleHelp();
  } else if (e.key === "Escape") {
    const el = $("help-overlay");
    if (el && !el.hidden) {
      toggleHelp(false);
      e.stopImmediatePropagation();
    }
  }
}

// First free "New World" / "New World N" name among existing worlds.
function defaultWorldName(worlds) {
  const taken = new Set(worlds.map((w) => w.name));
  if (!taken.has("New World")) return "New World";
  for (let i = 2; ; i++) if (!taken.has(`New World ${i}`)) return `New World ${i}`;
}

async function onRenameWorld(name) {
  if (!current) return;
  current.name = name;
  current = await saveWorld(current);
  await refreshWorldList();
  logLine(`Renamed to "${name}".`);
}

async function onSelectWorld(e) {
  const id = e.target.value;
  if (!id) return;
  const world = await loadWorld(id);
  await setCurrent(world);
}

async function onSave() {
  if (!current) return logLine("Nothing to save — create a world first.");
  current = await saveWorld(current);
  logLine("Saved.");
}

// Two-step delete (no confirm() — see onNewWorld). First click arms the button;
// a second click within a few seconds deletes. Auto-disarms otherwise.
let deleteTimer = null;
function disarmDelete() {
  clearTimeout(deleteTimer);
  deleteTimer = null;
  const btn = $("btn-delete");
  btn.textContent = "Delete";
  btn.classList.remove("armed");
}

async function onDelete() {
  if (!current) return;
  if (!deleteTimer) {
    const btn = $("btn-delete");
    btn.textContent = "Confirm delete";
    btn.classList.add("armed");
    deleteTimer = setTimeout(disarmDelete, 4000);
    return;
  }
  disarmDelete();
  const name = current.name;
  await deleteWorld(current.id);
  logLine(`Deleted "${name}".`);
  const worlds = await listWorlds();
  await setCurrent(worlds[0] || null);
}

function onExport() {
  if (!current) return logLine("Nothing to export — create a world first.");
  const blob = new Blob([exportWorld(current)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${current.name.replace(/\s+/g, "-").toLowerCase()}.world.json`;
  a.click();
  URL.revokeObjectURL(url);
  logLine("Exported JSON.");
}

function onImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const world = importWorld(String(reader.result));
      const saved = await saveWorld(world);
      await setCurrent(saved);
      logLine(`Imported "${saved.name}".`);
    } catch (err) {
      logLine(`Import error: ${err.message}`);
    }
  };
  reader.readAsText(file);
  e.target.value = ""; // allow re-importing the same file
}

// --- selection + its right-panel actions ---------------------------------

function selectCell(q, r) {
  selected = { q, r };
  selectedPoiId = null; // reset drill-in when changing cell
  saveSelected(current, selected);
  setSelected(selected);
  setPanelTab("detail"); // selecting a cell shows its detail
  renderSelection();
}

// The panel is read-only now: it shows the selected cell's info and lets you
// drill into / open a POI. All mutation runs through the radial menu
// (radialDispatch), and the hooks list renders separately (refreshGlobalHooks).
function renderSelection() {
  if (!current || !selected) return renderSelectionPanel(null);
  const { q, r } = selected;
  const hex = getHex(current, q, r);
  renderSelectionPanel({
    coord: { q, r },
    hex: hex && hex.placed ? hex : null,
    seed: current.seed, // lets the panel derive the settlement name
    annotation: { name: (hex && hex.name) || "", note: (hex && hex.note) || "" },
    selectedPoiId,
    onSelectPoi,
    onClearPoi: () => {
      selectedPoiId = null;
      renderSelection();
    },
    onRenameHex,
    onNoteHex,
    partyHere: !!(current.party && current.party.q === q && current.party.r === r),
    onPlaceParty: hex && hex.placed ? onPlaceParty : undefined,
    onTravelToward: hex && hex.placed ? onTravelToward : undefined,
    onGenerateFaction: hex && hex.placed ? onGenerateFaction : undefined,
    onPromotePoi,
    onCenterFaction,
    factionNameById: (id) => (getFactions(current).find((f) => f.id === id) || {}).name,
    factions: hex && hex.placed ? getFactions(current) : [],
    onClaimHolding: hex && hex.placed ? onClaimHolding : undefined,
  });
}

// Instant GM-override teleport (Phase 8.1) — kept alongside real movement
// (8.4) on request: no day cost, no route/lost simulation, just a direct jump.
async function onPlaceParty() {
  if (!current || !selected) return;
  setPartyPosition(current, selected.q, selected.r);
  await persistAndRefresh();
}

// Compass words for the 6 hex directions (indexes match NEIGHBOR_DIRS), plus
// the N/S pseudo-cardinals — used only to phrase the travel report.
const DIR_WORDS = ["east", "north-east", "north-west", "west", "south-west", "south-east"];
function bearingWord(bearing) {
  if (bearing === "N") return "north";
  if (bearing === "S") return "south";
  return DIR_WORDS[bearing];
}

// Travel ONE day toward the selected placed hex (Phase 8.4). Over placed
// terrain only (routes around water/mountains); each press = one day.
async function onTravelToward() {
  if (!current || !selected || !current.party) return;
  const terrainByKey = buildTerrainByKey(current);
  const roadKeys = roadHexKeySet(current.roads);
  const { q: aq, r: ar } = current.party;
  const encumbrance = current.party.encumbrance || "unencumbered";
  const originTerrain = (getHex(current, aq, ar) || {}).terrain;
  const result = travelDayToward(current.seed, sessionDay, aq, ar, selected.q, selected.r, terrainByKey, roadKeys, { encumbrance });
  const tables = await loadTables(HEX_TABLE_IDS);
  revealSightAlong(originTerrain, aq, ar, result, tables);
  const destHex = getHex(current, selected.q, selected.r);
  applyTravel(result, destinationLabel(destHex, selected.q, selected.r), "toward");
}

// Travel ONE day in a hex direction (Phase 8.4) — pushes into the unknown,
// lazily generating each frontier hex the party steps into (same seam as
// area/hook generation). Off-road (cross-country in a compass line).
async function onTravelDirection(bearing) {
  if (!current || !current.party) return;
  const tables = await loadTables(HEX_TABLE_IDS);
  const { q: aq, r: ar } = current.party;
  const encumbrance = current.party.encumbrance || "unencumbered";
  const originTerrain = (getHex(current, aq, ar) || {}).terrain;
  // terrainAt reveals the frontier hex on demand (idempotent — returns the
  // existing terrain if already placed), so walking off the edge grows the map.
  const terrainAt = (q, r) => {
    const existing = getHex(current, q, r);
    if (existing && existing.placed) return existing.terrain;
    const hex = buildRandomHex(tables, q, r, 0);
    addHex(current, hex);
    return hex.terrain;
  };
  const result = travelDayBearing(current.seed, sessionDay, aq, ar, bearing, { encumbrance, terrainAt });
  revealSightAlong(originTerrain, aq, ar, result, tables);
  applyTravel(result, bearingWord(bearing), "bearing");
}

// Reveal the swath of country the party could SEE this day (Phase 8.4 follow-up):
// each hex they stood in (the day's origin + every hex crossed) reveals a sight
// disc sized by that hex's terrain — high ground sees far, forest/swamp keeps
// them blind. Lazily generates any unplaced hexes in view (same seam as area
// generation); already-placed hexes are left untouched.
function revealSightAlong(originTerrain, aq, ar, result, tables) {
  const path = [{ q: aq, r: ar, terrain: originTerrain }, ...result.log];
  for (const cell of sightHexes(path)) {
    if (!hasHexAt(current, cell.q, cell.r)) addHex(current, buildRandomHex(tables, cell.q, cell.r, 0));
  }
}

// Apply a resolved travel day: move the party, advance the clock by one (only
// if a day was actually spent), stash the report, and surface it on the Travel
// tab (same "jump to the tab" convention as a new hook).
async function applyTravel(result, aimLabel, aimKind) {
  setPartyPosition(current, result.finalPos.q, result.finalPos.r);
  if (result.daySpent) await advanceDays(1); // one press = one day, through the shared clock
  lastDay = { headline: travelHeadline(result, aimLabel, aimKind), finalPos: result.finalPos, log: result.log };
  setPanelTab("travel");
  await persistAndRefresh();
}

// One-line summary of a day's travel, composed here (app knows the day, the
// destination name, and the direction word); panel just renders it.
function travelHeadline(result, aimLabel, aimKind) {
  const dayTag = `Day ${sessionDay} — `;
  const n = result.hexesCrossed;
  const hexes = `${n} hex${n === 1 ? "" : "es"}`;
  if (result.arrived) return `${dayTag}arrived at ${aimLabel}.`;
  if (result.reason === "stranded") {
    return n > 0
      ? `${dayTag}lost the way to ${aimLabel} — drifted ${hexes} and could go no further.`
      : `No way through to ${aimLabel} from here.`;
  }
  if (result.reason === "blocked") {
    const where = aimKind === "bearing" ? aimLabel : `toward ${aimLabel}`;
    return n > 0
      ? `${dayTag}reached the water's edge after ${hexes}.`
      : `Water blocks the way ${where}.`;
  }
  const aim = aimKind === "bearing" ? aimLabel : `toward ${aimLabel}`;
  return `${dayTag}travelled ${aim} — ${hexes}.`;
}

// A readable name for a travel destination hex: its GM label, else a settlement
// name, else bare coords.
function destinationLabel(hex, q, r) {
  if (hex && hex.name) return hex.name;
  if (hex && hex.settlement && hex.settlement.present) {
    return settlementName(current.seed, q, r, hex.gen, { kind: hex.settlement.kind, terrain: hex.terrain });
  }
  return `(${q}, ${r})`;
}

// Party pace setting (Phase 8.4) — persists to world.party.encumbrance; no day
// cost by itself, just changes how future travel is paced.
async function onSetEncumbrance(tier) {
  if (!current) return;
  setPartyEncumbrance(current, tier);
  await persistAndRefresh();
}

function buildTerrainByKey(world) {
  const terrainByKey = new Map();
  for (const h of placedHexes(world)) terrainByKey.set(axialKey(h.coords.q, h.coords.r), h.terrain);
  return terrainByKey;
}

// Travel tab (Phase 8.4): pace setting, the direction rose, and the last day's report.
function refreshTravelPanel() {
  renderTravelPanel({
    encumbrance: (current && current.party && current.party.encumbrance) || "unencumbered",
    onSetEncumbrance,
    onTravelDirection,
    lastDay,
  });
}

// GM annotations work on any selected cell. An empty cell is annotated by
// creating a lightweight placed:false hex that carries just name/note; clearing
// both removes it again (no orphan entries). Names show as map labels and notes
// as a 🗒 badge, so both re-render the map.
function annotationHex(q, r, create) {
  let hex = getHex(current, q, r);
  if (!hex && create) {
    hex = { key: axialKey(q, r), coords: { q, r }, placed: false, pois: [] };
    addHex(current, hex);
  }
  return hex;
}

function pruneIfEmpty(hex, q, r) {
  if (hex && !hex.placed && !hex.name && !hex.note) removeHex(current, q, r);
}

async function onRenameHex(name) {
  if (!current || !selected) return;
  const { q, r } = selected;
  const v = (name || "").trim();
  const hex = annotationHex(q, r, !!v);
  if (!hex) return;
  if (v) hex.name = v; else delete hex.name;
  pruneIfEmpty(hex, q, r);
  await persistAndRefresh();
}

async function onNoteHex(text) {
  if (!current || !selected) return;
  const { q, r } = selected;
  const v = text || "";
  const hex = annotationHex(q, r, !!v);
  if (!hex) return;
  if (v) hex.note = v; else delete hex.note;
  pruneIfEmpty(hex, q, r);
  await persistAndRefresh();
}

// Settlement sizes the terrain permits (capped; empty for open water).
function allowedSizes(terrain) {
  const p = profileFor(terrain);
  if (!p.settlement) return [];
  return SIZE_ORDER.slice(0, SIZE_ORDER.indexOf(p.settlement.maxSize) + 1);
}

async function setSettlement(settlement) {
  if (!current || !selected) return;
  const hex = getHex(current, selected.q, selected.r);
  if (!hex || !hex.placed) return;
  hex.settlement = settlement;
  await persistAndRefresh();
}

const onAddSettlement = (size) => setSettlement({ present: true, size });
const onRemoveSettlement = () => setSettlement({ present: false });

function onAddRandomSettlement() {
  if (!current || !selected) return;
  const hex = getHex(current, selected.q, selected.r);
  if (!hex || !hex.placed) return;
  const sizes = allowedSizes(hex.terrain);
  if (!sizes.length) return;
  const size = sizes[Math.floor(Math.random() * sizes.length)];
  setSettlement({ present: true, size });
}

// Next free "poi:<n>" id within a hex (max existing + 1).
function nextPoiId(hex) {
  let max = -1;
  for (const p of hex.pois || []) {
    const m = /^poi:(\d+)$/.exec(p.id || "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

async function addPoiToSelected(forceType, opts = {}) {
  if (!current || !selected) return;
  const { q, r } = selected;
  const hex = getHex(current, q, r);
  if (!hex || !hex.placed) return;
  try {
    const tables = await loadTables(HEX_TABLE_IDS);
    const n = nextPoiId(hex);
    const rng = subRng(current.seed, "hex", q, r, "poi", n);
    const poi = generatePoi(tables, rng, { terrain: hex.terrain, index: n, forceType });
    poi.id = `poi:${n}`;
    // Lock a chosen size onto the dungeon POI; its interior (and size) is built
    // lazily on first open from this hint (undefined = roll a random size).
    if (poi.type === "dungeon" && opts.sizeHint) {
      poi.detail = poi.detail || {};
      poi.detail.sizeHint = opts.sizeHint;
    }
    // Tier-1 feature types (shrine, …) get their structured detail eagerly here,
    // so the POI's name reads richly in the list right away. Older saves backfill
    // the same detail on first open (see onSelectPoi) — both from one sub-stream.
    buildFeatureDetail(poi, hex.terrain, q, r, n, tables);
    hex.pois.push(poi);
    selectedPoiId = null; // stay on the list so the Add menu remains for more
    await persistAndRefresh();
    logLine(`Added ${poi.name}.`);
  } catch (err) {
    logLine(`Add POI error: ${err.message}`);
  }
}

const onAddRandomPoi = () => addPoiToSelected();
const onAddPoi = (type) => addPoiToSelected(type);
// size = undefined → random size; otherwise a named size from the dungeon-size table.
const onAddDungeon = (size) => addPoiToSelected("dungeon", { sizeHint: size });

// Mapped-interior POI types (open into the Dungeon View). Towers reuse the same
// interior shape + renderer as dungeons, with orientation:"up".
const MAPPED_TYPES = new Set(["dungeon", "tower"]);

// A mapped interior needs (re)building if it has none yet, or its interior was
// generated by an older shape. Versioning the interior (DUNGEON_BUILD / TOWER_BUILD)
// lets old saves self-heal on next open without a world-schema migration.
function interiorNeedsBuild(poi) {
  const d = poi.detail && poi.detail.dungeon;
  const wantBuild = poi.type === "tower" ? TOWER_BUILD : DUNGEON_BUILD;
  if (!d || d.build !== wantBuild) return true;
  return !Array.isArray(d.levels) || d.levels.some((l) => !l || !l.layout);
}

// A built tower's list name: its kind + any garrison (e.g. "Watchtower — Bandits").
function towerName(poi) {
  const d = poi.detail && poi.detail.dungeon;
  let nm = (d && d.theme) || "Tower";
  if (poi.occupant && poi.occupant.kind === "occupied") nm += ` — ${poi.occupant.by}`;
  return nm;
}

// Tier-1 feature detail (shrine, …) needs (re)building if absent or stamped by an
// older FEATURE_BUILD — same self-heal pattern as dungeons, no world-schema bump.
function featureNeedsBuild(poi) {
  if (!FEATURE_TYPES.has(poi.type)) return false;
  const f = poi.detail && poi.detail.feature;
  return !f || f.build !== FEATURE_BUILD;
}

// Attach a feature type's structured detail + a richer name. Deterministic from a
// dedicated sub-stream so the eager build (on add) and the self-heal (on open of
// an older save) yield identical picks. No-op for non-feature types.
function buildFeatureDetail(poi, terrain, q, r, n, tables) {
  if (!FEATURE_TYPES.has(poi.type)) return;
  const rng = subRng(current.seed, "hex", q, r, "feature", n);
  poi.detail = poi.detail || {};
  // The camp's "who" is the POI's own occupant (single source of truth), so pass
  // it through; other types ignore it.
  poi.detail.feature = describeFeature(tables, rng, {
    type: poi.type,
    terrain,
    occupant: poi.occupant,
  });
  const name = featureName(poi.detail.feature);
  if (name) poi.name = name;
}

// Select a POI. Non-dungeon POIs drill into the side panel; a dungeon POI opens
// the Dungeon View (generating its interior lazily on first open — deterministic
// from the world seed + coords + the POI's index — then persisting).
async function onSelectPoi(id) {
  selectedPoiId = id;
  const hex = current && selected && getHex(current, selected.q, selected.r);
  const poi = hex && (hex.pois || []).find((p) => p.id === id);
  if (!poi) return renderSelection();

  if (MAPPED_TYPES.has(poi.type)) {
    if (interiorNeedsBuild(poi)) {
      renderSelection(); // show the "Generating…" placeholder immediately
      try {
        const tables = await loadTables(HEX_TABLE_IDS);
        const m = /^poi:(\d+)$/.exec(poi.id || "");
        const n = m ? Number(m[1]) : 0;
        poi.detail = poi.detail || {};
        if (poi.type === "tower") {
          const rng = subRng(current.seed, "hex", selected.q, selected.r, "tower", n);
          poi.detail.dungeon = generateTower(tables, rng, {
            occupant: poi.occupant,
            terrain: hex.terrain,
          });
          poi.name = towerName(poi); // enrich the list label with the tower's kind
        } else {
          const rng = subRng(current.seed, "hex", selected.q, selected.r, "dungeon", n);
          poi.detail.dungeon = generateDungeon(tables, rng, {
            theme: poi.detail.theme,
            size: poi.detail.sizeHint,
            terrain: hex.terrain,
          });
          // Legacy dungeons predate themes — backfill from the generated interior
          // so the map glyph reflects it.
          poi.detail.theme = poi.detail.theme || poi.detail.dungeon.theme;
        }
        await persistAndRefresh();
      } catch (err) {
        logLine(`Interior error: ${err.message}`);
        return;
      }
    }
    return openDungeonView(poi);
  }

  // Tier-1 feature types (shrine, …) drill into the side panel. Self-heal the
  // detail for older saves (placed before 5.1) on first open, then render.
  if (featureNeedsBuild(poi)) {
    try {
      const tables = await loadTables(HEX_TABLE_IDS);
      const m = /^poi:(\d+)$/.exec(poi.id || "");
      const n = m ? Number(m[1]) : 0;
      buildFeatureDetail(poi, hex.terrain, selected.q, selected.r, n, tables);
      await persistAndRefresh();
    } catch (err) {
      logLine(`POI detail error: ${err.message}`);
    }
  }
  renderSelection();
}

// --- Dungeon View (overlay) -----------------------------------------------

// Dungeon-wide bounding box (union of all levels' rooms/corridors) so every
// level renders in the same frame and shared grid coords line up across levels.
function dungeonFrame(dungeon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const lvl of dungeon.levels) {
    for (const r of lvl.layout.rooms) {
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
    for (const c of lvl.layout.corridors) {
      minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + 1); maxY = Math.max(maxY, c.y + 1);
    }
  }
  if (minX === Infinity) { minX = minY = 0; maxX = maxY = 1; }
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

function openDungeonView(poi) {
  const dungeon = poi.detail && poi.detail.dungeon;
  if (!dungeon) return; // nothing to show (build failed); stay on the hex map
  closeRadial(); // changing screens dismisses any open radial menu
  dungeonPoi = poi;
  dungeonFrameBB = dungeonFrame(dungeon);
  // Reveal the overlay BEFORE any rendering so a render hiccup can never leave
  // the user looking at an unchanged map ("nothing happened").
  $("dungeon-view").hidden = false;
  $("dungeon-title").textContent = `${poi.detail.theme || dungeon.theme || "Dungeon"} — ${dungeon.size}`;
  showDungeonLevel(0);
  fitView(); // frame the whole level on open
}

function closeDungeonView() {
  closeRadial(); // changing screens dismisses any open radial menu
  dungeonPoi = null;
  dungeonRoomN = null;
  $("dungeon-view").hidden = true;
  $("dungeon-legend").hidden = true; // collapse the legend when leaving
  setLevel(null);
  selectedPoiId = null; // back to the hex's POI list
  renderSelection();
}

function onToggleLegend() {
  $("dungeon-legend").hidden = !$("dungeon-legend").hidden;
}

// Per-level + whole-dungeon explored/cleared tallies (for the switcher chrome
// and the toolbar progress). A level is "done" once every room is explored.
function dungeonTallies() {
  const dungeon = dungeonPoi.detail.dungeon;
  const state = dungeonPoi.detail.dungeonState;
  const perLevel = dungeon.levels.map((lvl, i) => {
    const rooms = lvl.layout.rooms || [];
    let explored = 0, cleared = 0;
    for (const r of rooms) {
      const st = getRoomState(state, i, r.n);
      if (st.explored) explored++;
      if (st.cleared) cleared++;
    }
    return { total: rooms.length, explored, cleared, fullyExplored: rooms.length > 0 && explored === rooms.length };
  });
  return {
    perLevel,
    total: perLevel.reduce((a, l) => a + l.total, 0),
    cleared: perLevel.reduce((a, l) => a + l.cleared, 0),
  };
}

function renderLevelSwitcher() {
  const bar = $("dungeon-levels");
  bar.innerHTML = "";
  const dungeon = dungeonPoi.detail.dungeon;
  const t = dungeonTallies();
  dungeon.levels.forEach((lvl, i) => {
    const b = document.createElement("button");
    b.textContent = `L${lvl.depth}`;
    if (i === dungeonLevelIndex) b.className = "active";
    if (t.perLevel[i].fullyExplored) b.classList.add("done");
    const pl = t.perLevel[i];
    b.title = `Level ${lvl.depth}: ${lvl.theme || lvl.family || "?"} — ${pl.explored}/${pl.total} explored, ${pl.cleared}/${pl.total} cleared`;
    b.addEventListener("click", () => showDungeonLevel(i));
    bar.appendChild(b);
  });
  const prog = $("dungeon-progress");
  if (prog) prog.textContent = t.total ? `Cleared ${t.cleared}/${t.total}` : "";
}

// Connector marks (entrance/exit/stairs) for one level, as Sets of room numbers.
// `down`/`up` are display directions (▼/▲). A stair stores its lower-index end as
// `st.down` and higher-index end as `st.up`; in a dungeon a higher index is deeper
// (so the lower-index end goes ▼ down), but in an "up" interior (a tower) a higher
// index is a higher floor (so the lower-index end goes ▲ up) — hence the swap.
function levelMarks(dungeon, i) {
  const m = { entrance: new Set(), exit: new Set(), down: new Set(), up: new Set() };
  const up = dungeon.orientation === "up";
  for (const e of dungeon.entrances || []) if (e.level === i) m.entrance.add(e.room);
  for (const e of dungeon.exits || []) if (e.level === i) m.exit.add(e.room);
  for (const st of dungeon.stairs || []) {
    if (st.down.level === i) (up ? m.up : m.down).add(st.down.room);
    if (st.up.level === i) (up ? m.down : m.up).add(st.up.room);
  }
  return m;
}

// Stair navigation available from a given room: each entry switches level + room.
// The travel word at each end follows orientation (see levelMarks).
function roomConnections(dungeon, i, n) {
  const conns = [];
  const up = dungeon.orientation === "up";
  const lowerEndWord = up ? "up" : "down"; // word at the lower-index (st.down) end
  const upperEndWord = up ? "down" : "up"; // word at the higher-index (st.up) end
  for (const st of dungeon.stairs || []) {
    const word = st.kind === "shaft" ? "Shaft" : "Stairs";
    if (st.down.level === i && st.down.room === n)
      conns.push({ label: `${word} ${lowerEndWord} to L${st.up.level + 1} →`, toLevel: st.up.level, toRoom: st.up.room });
    if (st.up.level === i && st.up.room === n)
      conns.push({ label: `${word} ${upperEndWord} to L${st.down.level + 1} →`, toLevel: st.down.level, toRoom: st.down.room });
  }
  return conns;
}

// Surface tags for a room (entrance / exit).
function roomSurface(dungeon, i, n) {
  const tags = [];
  if ((dungeon.entrances || []).some((e) => e.level === i && e.room === n)) tags.push("Dungeon entrance (surface)");
  if ((dungeon.exits || []).some((e) => e.level === i && e.room === n)) tags.push("Exit to surface");
  return tags;
}

// Connector marks for a level PLUS per-room exploration state (for the renderer).
function marksFor(dungeon, i) {
  const m = levelMarks(dungeon, i);
  const state = dungeonPoi.detail.dungeonState;
  m.state = {};
  for (const r of dungeon.levels[i].layout.rooms) m.state[r.n] = getRoomState(state, i, r.n);
  return m;
}

function showDungeonLevel(i) {
  if (!dungeonPoi) return;
  dungeonLevelIndex = i;
  dungeonRoomN = null;
  const dungeon = dungeonPoi.detail.dungeon;
  const level = dungeon.levels[i];
  renderLevelSwitcher();
  setLevel(level, marksFor(dungeon, i), dungeonFrameBB);
  renderDungeonPanel({ dungeon, level, levelIndex: i, room: null, connections: [], surface: [], onGoTo });
}

// Render the side panel for one room (detail + stair nav + exploration tracking).
function renderRoomPanel(n) {
  const dungeon = dungeonPoi.detail.dungeon;
  const level = dungeon.levels[dungeonLevelIndex];
  const room = (level.rooms || []).find((r) => r.n === n) || null;
  renderDungeonPanel({
    dungeon,
    level,
    levelIndex: dungeonLevelIndex,
    room,
    connections: roomConnections(dungeon, dungeonLevelIndex, n),
    surface: roomSurface(dungeon, dungeonLevelIndex, n),
    onGoTo,
    roomState: getRoomState(dungeonPoi.detail.dungeonState, dungeonLevelIndex, n),
    onToggleRoom: (field) => toggleRoomState(dungeonLevelIndex, n, field),
    onNoteRoom: (text) => setRoomNote(dungeonLevelIndex, n, text),
  });
}

function onRoomClick(n) {
  if (!dungeonPoi) return;
  dungeonRoomN = n;
  setSelectedRoom(n);
  centerOnRoom(n); // bring it into view if it landed off-screen (e.g. via stairs)
  setPanelTab("detail"); // selecting a room shows its detail
  renderRoomPanel(n);
}

// Right-click a room: select it, then open the room radial at the cursor. Reuses
// the shared overlay (openRadial) with a room-specific model + dispatch.
function onRoomContextMenu({ n, clientX, clientY }) {
  if (!dungeonPoi) return;
  onRoomClick(n);
  const dungeon = dungeonPoi.detail.dungeon;
  const i = dungeonLevelIndex;
  const st = getRoomState(dungeonPoi.detail.dungeonState, i, n);
  const model = buildRoomRadialModel({
    explored: !!st.explored,
    cleared: !!st.cleared,
    looted: !!st.looted,
    connections: roomConnections(dungeon, i, n),
  });
  openRadial({ clientX, clientY, model, dispatch: (id, value) => roomRadialDispatch(i, n, id, value) });
}

function roomRadialDispatch(level, n, id, value) {
  if (id === "toggle") return toggleRoomState(level, n, value);
  if (id === "goTo") return onGoTo(value.level, value.room);
  if (id === "focus") return centerOnRoom(n, true);
}

// Keyboard for the Dungeon View: Esc leaves; [ / ] (and PageUp/PageDown) switch
// levels. Ignored while typing in the room-note field, and inert outside the view.
function onDungeonKey(e) {
  if (!dungeonPoi) return;
  if (isRadialOpen()) return; // the room ring owns keys while open (Esc closes it)
  const t = e.target;
  if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
  if (e.key === "Escape") {
    closeDungeonView();
    return;
  }
  const last = dungeonPoi.detail.dungeon.levels.length - 1;
  if (e.key === "]" || e.key === "PageDown") {
    e.preventDefault();
    if (dungeonLevelIndex < last) showDungeonLevel(dungeonLevelIndex + 1);
  } else if (e.key === "[" || e.key === "PageUp") {
    e.preventDefault();
    if (dungeonLevelIndex > 0) showDungeonLevel(dungeonLevelIndex - 1);
  }
}

// Take a stair: switch to the connected level and select the connected room.
function onGoTo(levelIndex, roomN) {
  if (!dungeonPoi) return;
  dungeonLevelIndex = levelIndex;
  renderLevelSwitcher();
  setLevel(dungeonPoi.detail.dungeon.levels[levelIndex], marksFor(dungeonPoi.detail.dungeon, levelIndex), dungeonFrameBB);
  onRoomClick(roomN);
}

// --- exploration state (separate from generated content; survives regen) ---
async function toggleRoomState(level, n, field) {
  if (!dungeonPoi) return;
  const cur = getRoomState(dungeonPoi.detail.dungeonState, level, n);
  dungeonPoi.detail.dungeonState = withRoomState(dungeonPoi.detail.dungeonState, level, n, {
    [field]: !cur[field],
  });
  current = await saveWorld(current);
  setMarks(marksFor(dungeonPoi.detail.dungeon, level)); // refresh map badges, keep selection
  renderLevelSwitcher(); // refresh the "done" ✓ + Cleared X/Y progress
  renderRoomPanel(n); // refresh toggle states
}

async function setRoomNote(level, n, text) {
  if (!dungeonPoi) return;
  dungeonPoi.detail.dungeonState = withRoomState(dungeonPoi.detail.dungeonState, level, n, { note: text });
  current = await saveWorld(current); // note has no map badge, so no re-render (keeps focus)
}

async function onRemovePoi(id) {
  if (!current || !selected) return;
  const hex = getHex(current, selected.q, selected.r);
  if (!hex) return;
  hex.pois = (hex.pois || []).filter((p) => p.id !== id);
  if (selectedPoiId === id) selectedPoiId = null;
  await persistAndRefresh();
}

// --- hooks (Phase 6) -------------------------------------------------------

// Mark every OPEN hook's target on the map (skip local opportunity/event, whose
// target is the town itself). Lets the GM find destinations at a glance.
function refreshHookMarks() {
  const open = [];
  const pinned = [];
  for (const h of (current && current.hooks) || []) {
    if ((h.status || "open") !== "open" || !h.target) continue;
    const key = axialKey(h.target.q, h.target.r);
    if (h.pinned) { pinned.push(key); continue; } // active leads always show
    if (h.pattern === "opportunity" || h.pattern === "event") continue; // local; target is the town
    open.push(key);
  }
  setHookMarks({ open, pinned });
}

// Refresh the hook tabs (unpinned list + pinned list, with badges).
function refreshGlobalHooks() {
  renderGlobalHooks({
    hooks: (current && current.hooks) || [],
    hexScale: (current && current.hexScale) || 6,
    selectedHookId,
    onSelectHook,
    onPinHook,
    onCenterHook,
    onFollowClue,
    onResolveHook,
    onIgnoreHook,
    onRemoveHook,
    // Resolve a faction hook's sourcePower tag to a name + jump (8.11 Chunk C).
    factionNameById: (id) => (getFactions(current).find((f) => f.id === id) || {}).name,
    onCenterFaction,
  });
}

// Refresh the Factions tab (list + count badge). Colour is keyed on the
// faction's order in the roster — same index the map marker uses.
function refreshFactions() {
  const factions = getFactions(current);
  renderFactionsPanel({
    factions,
    onCenterFaction,
    onAdvanceFactionTurn,
    onStirTrouble,
    factionColorFor: (id) => factionColor(factions.findIndex((f) => f.id === id)),
  });
}

// Highlight the selected hook's target/origin on the map (clears if none/gone).
function refreshHookFocus() {
  const h = selectedHookId && (current && current.hooks || []).find((x) => x.id === selectedHookId);
  if (!h) {
    selectedHookId = null;
    return setHookFocus(null);
  }
  setHookFocus({ target: h.target || null, origin: h.origin || null });
}

// Clicking a hook card selects it (toggles); selection rings its endpoints.
function onSelectHook(id) {
  selectedHookId = selectedHookId === id ? null : id;
  refreshGlobalHooks();
  refreshHookFocus();
}

// Esc clears a hook highlight (takes priority over leaving the dungeon). Inert
// while a ring is open (the ring owns Esc) or while typing in a field.
// While tracing a river/road, Enter finishes, Esc cancels, Ctrl/Cmd+Z undoes a
// point. Registered before the other key handlers so it wins those keys mid-draw.
function onDraftKey(e) {
  if (!draftClicks) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  if (e.key === "Escape") onCancelDraft();
  else if (e.key === "Enter") onFinishDraft();
  else if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) onUndoDraftPoint();
  else return;
  e.stopImmediatePropagation();
  e.preventDefault();
}

function onWorldKey(e) {
  if (e.key !== "Escape" || !selectedHookId || isRadialOpen()) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  selectedHookId = null;
  refreshGlobalHooks();
  refreshHookFocus();
  e.stopImmediatePropagation(); // we handled Esc; don't also exit the dungeon
}

// Pin / unpin a hook — pinned hooks move to the Pinned tab (out of Hooks).
async function onPinHook(id) {
  if (!current) return;
  const h = (current.hooks || []).find((x) => x.id === id);
  if (!h) return;
  h.pinned = !h.pinned;
  await persistAndRefresh();
}

// Next free "hook:<n>" id across the whole world (hooks are world-level).
function nextHookId(world) {
  let max = -1;
  for (const h of world.hooks || []) {
    const m = /^hook:(\d+)$/.exec(h.id || "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// Next free faction ordinal (mirrors nextHookId) — also seeds the faction's name
// and its per-faction map colour, so it stays stable for the faction's life.
function nextFactionId(world) {
  let max = -1;
  for (const f of getFactions(world)) {
    const m = /^faction:(\d+)$/.exec(f.id || "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// A hook names a POI by its BASE name (the place), not its "— occupant" display
// suffix: "Flooded cistern", not "Flooded cistern — Cultists". The occupant still
// shows in the POI list / dungeon view; hooks just want the place.
function poiBaseName(poi) {
  if (poi.type === "dungeon" && poi.detail && poi.detail.theme) return poi.detail.theme;
  return (poi.name || "").split(" — ")[0] || poi.name;
}

// Candidate subjects for a Known hook: every POI already placed on the map.
function hookSubjects(world) {
  const subs = [];
  for (const hex of placedHexes(world)) {
    for (const poi of hex.pois || []) {
      subs.push({
        poiId: poi.id,
        name: poiBaseName(poi),
        type: poi.type,
        q: hex.coords.q,
        r: hex.coords.r,
        terrain: hex.terrain,
        occupant: poi.occupant,
      });
    }
  }
  return subs;
}

// The terrains of a cell's already-placed neighbours — biases the affinity
// terrain roll (js/gen/affinity.js): a hex tends to match its revealed
// surroundings (mountains cluster, coastlines continue, etc).
function neighborTerrains(q, r) {
  const out = [];
  for (const n of neighbors(q, r)) {
    const h = getHex(current, n.q, n.r);
    if (h && h.placed && h.terrain) out.push(h.terrain);
  }
  return out;
}

// Radius (in hexes ≈ a day's travel at 6 miles/hex) within which an existing
// large settlement soft-suppresses a new one — see generateHex/suppressLargeSizes.
const LARGE_SPACING = 4;

// How many large (Town/City) settlements already sit within a day's travel of
// (q,r). Feeds generateHex's nearbyLargeCount so big settlements rarely cluster.
function nearbyLargeCount(q, r) {
  let count = 0;
  for (const c of hexDisc(q, r, LARGE_SPACING)) {
    if (c.q === q && c.r === r) continue;
    const h = getHex(current, c.q, c.r);
    if (h && h.placed && h.settlement && h.settlement.present && isLargeSize(h.settlement.size)) count++;
  }
  return count;
}

// Rivers (Phase 3R.6): a DERIVED overlay recomputed from the currently-revealed
// terrain (js/gen/rivers.js — major-water drainage over the elevation-free
// affinity world). Recompute after every generation batch and on world load;
// world.rivers holds the traced polylines that map.js draws. Cheap (a Dijkstra
// over the placed hexes + a few short descents), and order-dependent by design
// like the terrain it sits on.
function syncRivers(world) {
  if (!world) return;
  const terrainByKey = new Map();
  const settlementsByKey = new Map(); // key -> size, so new rivers bend toward towns
  for (const h of placedHexes(world)) {
    const key = axialKey(h.coords.q, h.coords.r);
    terrainByKey.set(key, h.terrain);
    if (h.settlement && h.settlement.present) settlementsByKey.set(key, h.settlement.size);
  }
  // Append-only: keep existing rivers, add rivers for newly-revealed sources
  // (a river must never disappear when more terrain is generated). New rivers
  // are pulled toward nearby settlements (see computeRivers' gravity note).
  world.rivers = computeRivers(world.seed, terrainByKey, Array.isArray(world.rivers) ? world.rivers : [], settlementsByKey);
  // Civilisation follows water. First SEED new settlements at water — scattered
  // along rivers, a port (mostly City, sometimes a keep) at most river mouths
  // (the double whammy), shore Cities on lakes — then BUMP every settlement by
  // its river/coast context. Both are idempotent (a decided-flag / baseSize
  // re-derivation), so the repeated syncRivers calls never duplicate or compound.
  const hexByKey = new Map();
  for (const h of placedHexes(world)) hexByKey.set(axialKey(h.coords.q, h.coords.r), h);
  seedWaterSettlements(hexByKey, world.rivers, terrainByKey, world.seed);
  applyWaterBoosts(placedHexes(world), world.rivers, terrainByKey);
  // Then sprinkle a few farming hamlets around the large (now final-sized)
  // settlements and re-run the (idempotent) boost so a riverside one is sized
  // consistently this same sync.
  seedHamletClusters(hexByKey, world.seed);
  applyWaterBoosts(placedHexes(world), world.rivers, terrainByKey);
}

// Rebuild the road overlay (Phase 3R.7) from the current terrain, settlements,
// and rivers. Runs AFTER syncRivers so settlements are their final, boosted size
// and the river valleys exist for roads to hug. Append-only like rivers — a
// built road is kept verbatim (js/gen/roads.js), so revealing more terrain only
// EXTENDS the network, never re-routes it. world.roads holds the tiered polylines
// that map.js draws.
function syncRoads(world) {
  if (!world) return;
  const terrainByKey = new Map();
  const settlementsByKey = new Map(); // key -> size, so roads link the big places
  for (const h of placedHexes(world)) {
    const key = axialKey(h.coords.q, h.coords.r);
    terrainByKey.set(key, h.terrain);
    if (h.settlement && h.settlement.present) settlementsByKey.set(key, h.settlement.size);
  }
  world.roads = computeRoads(
    world.seed,
    terrainByKey,
    settlementsByKey,
    world.rivers,
    Array.isArray(world.roads) ? world.roads : [],
  );
}

// Build the lazily-generated target tile for a Distant hook: a normal placed hex
// (random terrain; generated in isolation, so the route to it stays blank) that
// carries a forced dungeon POI as the hook's subject. Marked unexplored.
function buildDistantTargetHex(tables, q, r) {
  const hexRng = subRng(current.seed, "hex", q, r, 0);
  const hex = generateHex(tables, hexRng, {
    key: axialKey(q, r),
    coords: { q, r },
    placed: true,
    seed: current.seed,
    gen: 0,
    neighborTerrains: neighborTerrains(q, r),
  });
  hex.gen = 0;
  hex.explored = false; // not yet visited; the intervening hexes are blank
  hex.settlement = { present: false }; // a remote wilderness site
  // Force the promised explorable (a dungeon) from its own sub-stream, replacing
  // any auto-rolled POI so the hook reliably points at something.
  const poiRng = subRng(current.seed, "hex", q, r, "poi", "hook");
  const poi = generatePoi(tables, poiRng, { terrain: hex.terrain, index: 0, forceType: "dungeon" });
  poi.id = "poi:0";
  hex.pois = [poi];
  return hex;
}

// A subject descriptor for the hook generator, from a placed hex's first POI.
function subjectFromHex(hex, poi) {
  return {
    poiId: poi.id, name: poiBaseName(poi), type: poi.type,
    q: hex.coords.q, r: hex.coords.r, terrain: hex.terrain, occupant: poi.occupant,
  };
}

// Map pattern: place the target tile AND reveal the corridor of hexes from the
// origin to it (the "found map" traces a route). Returns { subject, path }.
function buildMapTargetAndPath(tables, origin, spot) {
  const path = axialLine(origin.q, origin.r, spot.q, spot.r);
  for (const cell of path) {
    const isOrigin = cell.q === origin.q && cell.r === origin.r;
    const isTarget = cell.q === spot.q && cell.r === spot.r;
    if (isOrigin || isTarget) continue; // origin already exists; target built below
    if (hasHexAt(current, cell.q, cell.r)) continue; // don't clobber existing terrain
    addHex(current, buildRandomHex(tables, cell.q, cell.r, 0)); // a revealed route hex
  }
  const targetHex = buildDistantTargetHex(tables, spot.q, spot.r);
  addHex(current, targetHex);
  return { subject: subjectFromHex(targetHex, targetHex.pois[0]), path };
}

const HOOK_NOTE = {
  distant: " (distant — a new site appeared on the map)",
  map: " (map — a route was revealed to a new site)",
  chain: " (chain — follow the clues to the prize)",
  opportunity: " (a standing offer in town)",
  event: " (a local happening)",
  escort: " (a delivery — a destination appeared on the map)",
  return: " (a development at a known site)",
  known: "",
};

// Generate a hook at the selected settlement. `opts.forcePattern` (e.g. the "Read
// map" button forcing "map") skips the pattern roll; `opts.source` overrides the
// rolled source for a triggered hook.
async function onGenerateHook(opts = {}) {
  // The origin is wherever the GM is looking. A hook — especially a read map —
  // can be made from any selected cell, placed or not.
  if (!current || (!selected && !opts.origin)) return;
  try {
    // Distant/Map hooks build new tiles, so load the hex/POI tables too.
    const tables = await loadTables(HEX_TABLE_IDS.concat(HOOK_TABLE_IDS));
    if (!Array.isArray(current.hooks)) current.hooks = [];
    const n = nextHookId(current);
    // Origin is the selected cell, or an explicit override (a faction's seat, 8.11).
    const origin = opts.origin || { q: selected.q, r: selected.r };
    // opts.nonce (faction stirs) mixes into the seed so repeat stirs from the same
    // origin never collide; normal hooks keep their original seed unchanged.
    const rng = opts.nonce
      ? subRng(current.seed, "hook", origin.q, origin.r, n, opts.nonce)
      : subRng(current.seed, "hook", origin.q, origin.r, n);

    // Faction hooks (8.11) inject their own subject (the lair); everything else
    // draws candidates from the whole map.
    const subjects = opts.subjects || hookSubjects(current);
    const pattern = opts.forcePattern || rollHookPattern(tables, rng, subjects.length > 0);

    let hook;
    if (pattern === "opportunity" || pattern === "event") {
      // Local hooks happen in town — no target tile, no pattern geometry.
      hook = buildLocalHook(tables, rng, { kind: pattern, origin, index: n, source: opts.source });
    } else if (pattern === "escort") {
      // A delivery to a generated destination (a place to deliver to, left blank
      // of any forced contents — the recipient is the flavour).
      const spot = chooseDistantTarget(rng, origin, (q, r) => hasHexAt(current, q, r));
      if (!spot) return logLine("No open ground nearby for an errand.");
      const destHex = buildRandomHex(tables, spot.q, spot.r, 0);
      destHex.explored = false;
      addHex(current, destHex);
      hook = buildEscortHook(tables, rng, {
        origin, index: n, source: opts.source,
        destination: { q: spot.q, r: spot.r },
        terrain: destHex.terrain,
      });
    } else if (pattern === "chain") {
      const spot = chooseDistantTarget(rng, origin, (q, r) => hasHexAt(current, q, r));
      if (!spot) return logLine("No open ground nearby to lay a trail.");
      const targetHex = buildDistantTargetHex(tables, spot.q, spot.r);
      addHex(current, targetHex);
      const subject = subjectFromHex(targetHex, targetHex.pois[0]);
      hook = startChain(tables, rng, {
        origin, index: n,
        target: { q: spot.q, r: spot.r, poiId: subject.poiId },
        subject: { poiId: subject.poiId, name: subject.name, type: subject.type },
        terrain: subject.terrain,
        source: opts.source,
      });
    } else if (pattern === "map" || pattern === "distant") {
      const spot = chooseDistantTarget(rng, origin, (q, r) => hasHexAt(current, q, r));
      if (!spot) return logLine("No open ground nearby for that hook.");
      if (pattern === "map") {
        // The map charts a route to a place; the verb (rolled) colours why you'd
        // go — treasure to dig, a lair to clear, someone lost, a place to shun.
        const { subject, path } = buildMapTargetAndPath(tables, origin, spot);
        hook = generateHook(tables, rng, {
          subjects: [subject], origin, index: n, pattern: "map",
          distance: spot.distance, path, verb: opts.verb, source: opts.source,
        });
      } else {
        const targetHex = buildDistantTargetHex(tables, spot.q, spot.r);
        addHex(current, targetHex);
        hook = generateHook(tables, rng, {
          subjects: [subjectFromHex(targetHex, targetHex.pois[0])],
          origin, index: n, pattern: "distant", distance: spot.distance,
          verb: opts.verb, source: opts.source,
        });
      }
    } else if (pattern === "return") {
      // A development at an existing on-map POI (rollHookPattern guarantees subjects).
      hook = generateHook(tables, rng, { subjects, origin, index: n, pattern: "return", verb: "return", source: opts.source });
    } else {
      hook = generateHook(tables, rng, { subjects, origin, index: n, verb: opts.verb, claim: opts.claim, source: opts.source });
    }

    if (!hook) return logLine("Nothing to gossip about here.");
    if (opts.sourcePower) hook.sourcePower = opts.sourcePower; // tag a Type-2 (faction-emitted) hook (8.11)
    current.hooks.push(hook);
    // Surface the new lead: jump to the Hooks tab with it selected (and its
    // endpoints highlighted on the map) so it's never a silent "nothing happened".
    selectedHookId = hook.id;
    setPanelTab("hooks");
    await persistAndRefresh();
    logLine(`New hook — ${hookName(hook)}${HOOK_NOTE[hook.pattern] || ""}.`);
  } catch (err) {
    logLine(`Generate hook error: ${err.message}`);
  }
}

// "Read map": the party reads a found map → a Map hook (from any selected cell).
const onReadMap = () => onGenerateHook({ forcePattern: "map", source: "A map found below" });
// "Follow a trail": the party finds a riddle/clue here → start a chain anywhere.
const onStartChain = () => onGenerateHook({ forcePattern: "chain", source: "A riddle found here" });

// Generate a faction whose single starting holding is the selected placed hex
// (Phase 8.7) — mirrors onGenerateHook: deterministic sub-stream keyed on the
// coords + ordinal, surfaced on the Factions tab so it's never a silent no-op.
async function onGenerateFaction() {
  if (!current || !selected) return;
  try {
    const tables = await loadTables(FACTION_TABLE_IDS);
    const { q, r } = selected;
    const n = nextFactionId(current);
    const rng = subRng(current.seed, "faction", q, r, n);
    // Attach the holding to a POI here, if one is placed (a faction holds a site).
    const hex = getHex(current, q, r);
    const poiId = hex && Array.isArray(hex.pois) && hex.pois[0] ? hex.pois[0].id : undefined;
    const faction = generateFaction(tables, rng, { q, r, index: n, seed: current.seed, poiId });
    addFaction(current, faction);
    setPanelTab("factions");
    await persistAndRefresh();
    logLine(`New faction — ${faction.name} (${faction.archetype}).`);
  } catch (err) {
    logLine(`Generate faction error: ${err.message}`);
  }
}

// Promote an occupied POI into a faction (Phase 8.8) — seeds the archetype from
// the occupier label so it reads as the same threat, records the POI as origin,
// and tags the POI's occupant with the new faction id (no double-promote).
async function onPromotePoi(poiId) {
  if (!current || !selected) return;
  try {
    const hex = getHex(current, selected.q, selected.r);
    const poi = hex && (hex.pois || []).find((p) => p.id === poiId);
    if (!poi || !poi.occupant || poi.occupant.kind !== "occupied") return;
    if (poi.occupant.factionId) return; // already promoted
    const tables = await loadTables(FACTION_TABLE_IDS);
    const { q, r } = selected;
    const n = nextFactionId(current);
    const rng = subRng(current.seed, "faction", q, r, n);
    const faction = promoteFaction(tables, rng, { q, r, poiId, index: n, seed: current.seed, occupant: poi.occupant });
    addFaction(current, faction);
    poi.occupant.factionId = faction.id; // link the POI to its new faction
    setPanelTab("factions");
    await persistAndRefresh();
    logLine(`Promoted ${poi.occupant.by} → ${faction.name} (${faction.archetype}).`);
  } catch (err) {
    logLine(`Promote faction error: ${err.message}`);
  }
}

// Toggle a hook's status (clicking the same status again clears it back to open).
async function setHookStatus(id, status) {
  if (!current) return;
  const h = (current.hooks || []).find((x) => x.id === id);
  if (!h) return;
  h.status = h.status === status ? "open" : status;
  // Resolving a lead retires it from the Pinned tab automatically.
  if (h.status === "resolved" && h.pinned) h.pinned = false;
  await persistAndRefresh();
}
const onResolveHook = (id) => setHookStatus(id, "resolved");
const onIgnoreHook = (id) => setHookStatus(id, "ignored");

async function onRemoveHook(id) {
  if (!current) return;
  current.hooks = (current.hooks || []).filter((x) => x.id !== id);
  await persistAndRefresh();
}

// Centre the map on a hook's target/origin WITHOUT changing the selection — the
// colour-dot links on a selected hook card use this (stay on the hook, just pan).
function onCenterHook(id, which) {
  const h = (current && current.hooks || []).find((x) => x.id === id);
  const pt = h && (which === "origin" ? h.origin : h.target);
  if (pt) recenterOn(pt.q, pt.r);
}

// Centre the map on a faction's holding — click-to-jump from the Factions tab
// (Phase 8.7). `index` selects which holding (8.9); defaults to the first, so
// the 8.8 POI "Faction:" link (no index) still lands on holding 0.
function onCenterFaction(id, index = 0) {
  const f = getFactions(current).find((x) => x.id === id);
  const hold = f && (f.holdings || [])[index];
  if (hold) recenterOn(hold.q, hold.r);
}

// Claim the selected placed hex for an existing faction (Phase 8.9) — attaches
// it (with its primary POI, if any) to that faction's holdings[]. Dedupes: a
// faction can't hold the same hex twice.
async function onClaimHolding(factionId) {
  if (!current || !selected) return;
  const faction = getFactions(current).find((f) => f.id === factionId);
  if (!faction) return;
  const { q, r } = selected;
  const hex = getHex(current, q, r);
  const poiId = hex && Array.isArray(hex.pois) && hex.pois[0] ? hex.pois[0].id : undefined;
  if (!addHolding(faction, { q, r, poiId })) {
    return logLine(`${faction.name} already holds (${q}, ${r}).`);
  }
  setPanelTab("factions");
  await persistAndRefresh();
  logLine(`${faction.name} claims (${q}, ${r}) — now ${faction.holdings.length} holdings.`);
}

// The placed settlement nearest a point — where word of a faction's deeds reaches
// the party (8.11: "word spreads down to town"). null if the map has no settlement.
function nearestSettlementTo(world, pt) {
  let best = null, bestD = Infinity;
  for (const h of placedHexes(world)) {
    if (!(h.settlement && h.settlement.present)) continue;
    const d = axialDistance(pt.q, pt.r, h.coords.q, h.coords.r);
    if (d < bestD) { bestD = d; best = { q: h.coords.q, r: h.coords.r }; }
  }
  return best;
}

// A readable "lair" name for a holding with no POI of its own: its settlement/GM
// name, else a camp in the terrain (so the threat prose still reads as a place).
function lairPlaceName(hex, lair) {
  if (hex && (hex.name || (hex.settlement && hex.settlement.present))) return destinationLabel(hex, lair.q, lair.r);
  return hex && hex.terrain ? `a camp in the ${hex.terrain.toLowerCase()}` : "a hidden camp";
}

// Build ONE faction hook (shared by the manual "Stir up trouble" button, 8.11, and
// the day-tick auto-fire, 8.12). Returns a fully-formed hook tagged back to the
// faction, or null if it has no lair. Pushes/persist/UI are the caller's job — so
// the auto path can emit several silently and persist once. The deed/opening are
// seeded on the faction + how many hooks it has already emitted (reload-safe), so
// consecutive hooks never read the same.
function buildFactionHook(faction, tables) {
  const lair = (faction.holdings || [])[0];
  if (!lair) return null;
  const lairHex = getHex(current, lair.q, lair.r);
  // Where the party hears it: nearest town, else the party's position, else the
  // lair itself — so the hook has a real leg to travel.
  const origin = nearestSettlementTo(current, lair)
    || (current.party ? { q: current.party.q, r: current.party.r } : null)
    || { q: lair.q, r: lair.r };
  const ordinal = (current.hooks || []).filter((h) => h.sourcePower === faction.id).length;
  const rng = subRng(current.seed, "stir", faction.id, ordinal);
  const { verb, claim, source } = factionHookContext(faction, rng, tables);
  // A synthetic subject: the lair place "occupied by" the faction, so the engine's
  // threat prose prints the FACTION as the menace and the holding as its lair.
  const lairPoi = lairHex && (lairHex.pois || []).find((p) => p.id === lair.poiId);
  const subject = {
    poiId: lair.poiId,
    name: lairPoi ? poiBaseName(lairPoi) : lairPlaceName(lairHex, lair),
    type: lairPoi ? lairPoi.type : "lair",
    q: lair.q, r: lair.r,
    terrain: lairHex ? lairHex.terrain : null,
    occupant: { kind: "occupied", by: faction.name },
  };
  const n = nextHookId(current);
  // nonce keeps the engine's reward roll distinct per emission even from one town.
  const hrng = subRng(current.seed, "hook", origin.q, origin.r, n, `${faction.id}:${ordinal}`);
  const hook = generateHook(tables, hrng, { subjects: [subject], origin, index: n, verb, claim, source });
  if (!hook) return null;
  hook.sourcePower = faction.id; // tag it back to the faction (8.11)
  return hook;
}

// "Stir up trouble" (Phase 8.11) — the manual button: build one faction hook, push
// it, and surface it on the Hooks tab. A deliberate GM nudge that still stands
// alongside the day-driven expansion hooks (8.15). The hook NAMES the faction,
// describes a varied deed, and points the party AT its lair.
async function onStirTrouble(factionId) {
  if (!current) return;
  const faction = getFactions(current).find((f) => f.id === factionId);
  if (!faction || (faction.status || "active") !== "active") return;
  if (!(faction.holdings || [])[0]) return logLine(`${faction.name} has no lair to stir from.`);
  if (!Array.isArray(current.hooks)) current.hooks = [];
  const tables = await loadTables(FACTION_HOOK_TABLE_IDS);
  const hook = buildFactionHook(faction, tables);
  if (!hook) return logLine(`${faction.name} has nowhere to stir from.`);
  current.hooks.push(hook);
  selectedHookId = hook.id;
  setPanelTab("hooks");
  await persistAndRefresh();
  logLine(`New hook — ${hookName(hook)} (stirred up by ${faction.name}).`);
}

// Advance a breadcrumb chain: generate the next site (winding on from where the
// current clue was found) and move the hook to it. The prior site stays on the map.
async function onFollowClue(id) {
  if (!current) return;
  const hook = (current.hooks || []).find((x) => x.id === id);
  if (!hook || hook.pattern !== "chain") return;
  if (hook.chain.step >= hook.chain.total) return; // already at the prize
  try {
    const tables = await loadTables(HEX_TABLE_IDS.concat(HOOK_TABLE_IDS));
    const m = /^hook:(\d+)$/.exec(hook.id || "");
    const hookN = m ? Number(m[1]) : 0;
    const nextStep = hook.chain.step + 1;
    const rng = subRng(current.seed, "hook", hookN, "chain", nextStep);
    const legOrigin = { q: hook.target.q, r: hook.target.r };
    const spot = chooseDistantTarget(rng, legOrigin, (q, r) => hasHexAt(current, q, r));
    if (!spot) return logLine("The trail goes cold — no open ground for the next clue.");
    const targetHex = buildDistantTargetHex(tables, spot.q, spot.r);
    addHex(current, targetHex);
    const subj = subjectFromHex(targetHex, targetHex.pois[0]);
    const fields = buildChainStep(tables, rng, {
      legOrigin, target: { q: spot.q, r: spot.r, poiId: subj.poiId },
      terrain: subj.terrain,
    });
    Object.assign(hook, fields, {
      subject: { poiId: subj.poiId, name: subj.name, type: subj.type },
      chain: { ...hook.chain, step: nextStep }, // keep total + prize
    });
    // Keep the advanced lead in view (Hooks tab, selected, new leg highlighted).
    selectedHookId = hook.id;
    setPanelTab("hooks");
    await persistAndRefresh();
    logLine(
      nextStep >= hook.chain.total
        ? `The trail ends — the prize lies at ${subj.name}.`
        : `The clue leads on to ${subj.name}.`,
    );
  } catch (err) {
    logLine(`Follow clue error: ${err.message}`);
  }
}

async function persistAndRefresh() {
  syncRivers(current); // recompute the river overlay from the revealed terrain before persisting
  syncRoads(current);  // ...then the road overlay (needs final settlements + rivers)
  current = await saveWorld(current);
  setWorld(current);
  refreshHookMarks();
  renderSelection();
  refreshGlobalHooks();
  refreshFactions();
  refreshTravelPanel();
  refreshHookFocus();
  refreshMapChrome();
}

// Build (in memory) a random hex at (q,r) for generation `gen` — terrain comes
// from the neighbour-affinity roll (js/gen/affinity.js), biased by the terrains
// of already-placed neighbours (order-dependent by design).
function buildRandomHex(tables, q, r, gen) {
  const rng = subRng(current.seed, "hex", q, r, gen);
  const hex = generateHex(tables, rng, {
    key: axialKey(q, r),
    coords: { q, r },
    placed: true,
    seed: current.seed,
    gen,
    neighborTerrains: neighborTerrains(q, r),
    nearbyLargeCount: nearbyLargeCount(q, r),
  });
  hex.gen = gen;
  return hex;
}

function onHexClick({ q, r }) {
  if (draftClicks) return addDraftPoint(q, r);
  selectCell(q, r);
}

function onEmptyCellClick({ q, r }) {
  if (draftClicks) return addDraftPoint(q, r);
  selectCell(q, r);
}

// --- Manual river / road drawing (Phase 3R.6 / 3R.7) ---------------------
// Trace a river OR a road by clicking hexes: consecutive clicks are joined by
// the straight hex-line between them, so two clicks make a line and more clicks
// a winding course. `draftKind` ("river" | "road") says which the active draft
// is; on Finish it's stored as a `manual` river (js/gen/rivers.js — open ends
// auto-complete to a mountain source / the sea) or a `manual` road
// (js/gen/roads.js — kept verbatim, seeds the auto road network).

// The full hex path from the clicked anchors (straight lines filled between).
function draftPath() {
  if (!draftClicks || !draftClicks.length) return [];
  const path = [];
  const push = (c) => {
    const last = path[path.length - 1];
    if (!last || last.q !== c.q || last.r !== c.r) path.push({ q: c.q, r: c.r });
  };
  push(draftClicks[0]);
  for (let i = 1; i < draftClicks.length; i++) {
    const seg = axialLine(draftClicks[i - 1].q, draftClicks[i - 1].r, draftClicks[i].q, draftClicks[i].r);
    for (let k = 1; k < seg.length; k++) push(seg[k]);
  }
  return path;
}

function refreshDraft() {
  const pts = draftClicks ? draftPath() : null;
  setRiverDraft(draftKind === "river" ? pts : null);
  setRoadDraft(draftKind === "road" ? pts : null);
  $("draw-bar").hidden = !draftClicks;
  if (draftClicks) $("draw-hint").textContent = `Click hexes to trace a ${draftKind}`;
}

// The id of a GM-drawn (manual) river / road passing through (q, r), or null.
// Only manual ones are individually removable — the auto overlays are derived.
function manualRiverIdAt(q, r) {
  if (!current) return null;
  const k = axialKey(q, r);
  for (const rv of current.rivers || []) if (rv.manual && rv.path.some((p) => axialKey(p.q, p.r) === k)) return rv.id;
  return null;
}
function manualRoadIdAt(q, r) {
  if (!current) return null;
  const k = axialKey(q, r);
  for (const rd of current.roads || []) if (rd.manual && rd.path.some((p) => axialKey(p.q, p.r) === k)) return rd.id;
  return null;
}

async function onRemoveRiver(id) {
  if (!current || !id) return;
  current.rivers = (current.rivers || []).filter((rv) => rv.id !== id);
  await persistAndRefresh(); // syncRivers keeps the rest; auto rivers re-derive
  logLine("River removed.");
}
async function onRemoveRoad(id) {
  if (!current || !id) return;
  current.roads = (current.roads || []).filter((rd) => rd.id !== id);
  await persistAndRefresh(); // syncRoads keeps manual roads; the auto network re-derives
  logLine("Road removed.");
}

function onStartDrawRiver() { startDraft("river"); }
function onStartDrawRoad() { startDraft("road"); }
function startDraft(kind) {
  if (!current || !selected) return;
  draftKind = kind;
  draftClicks = [{ q: selected.q, r: selected.r }];
  refreshDraft();
  logLine(`Drawing a ${kind} — click hexes to trace its course, then Finish.`);
}

function addDraftPoint(q, r) {
  if (!draftClicks) return;
  const last = draftClicks[draftClicks.length - 1];
  if (last.q === q && last.r === r) return; // ignore a repeat click on the same hex
  draftClicks.push({ q, r });
  refreshDraft();
}

function onUndoDraftPoint() {
  if (!draftClicks) return;
  if (draftClicks.length > 1) draftClicks.pop();
  refreshDraft();
}

function onCancelDraft() {
  draftClicks = null;
  draftKind = null;
  refreshDraft();
}

// Next id for a manual overlay entry: manual:<n>, monotonic across the list.
function nextManualId(list) {
  let max = -1;
  for (const item of list || []) {
    const m = /^manual:(\d+)$/.exec(item.id || "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `manual:${max + 1}`;
}

async function onFinishDraft() {
  if (!current || !draftClicks) return;
  const path = draftPath();
  const kind = draftKind;
  if (path.length < 2) { onCancelDraft(); return; }
  if (kind === "river") {
    const terrainByKey = new Map();
    for (const h of placedHexes(current)) terrainByKey.set(axialKey(h.coords.q, h.coords.r), h.terrain);
    if (!Array.isArray(current.rivers)) current.rivers = [];
    current.rivers.push(buildManualRiver(nextManualId(current.rivers), path, terrainByKey));
  } else {
    if (!Array.isArray(current.roads)) current.roads = [];
    current.roads.push(buildManualRoad(nextManualId(current.roads), path));
  }
  draftClicks = null;
  draftKind = null;
  refreshDraft();
  await persistAndRefresh(); // syncRivers/syncRoads integrate the new manual overlay
  logLine(kind === "river" ? "River added." : "Road added.");
}

// Right-click: select the cell, then open the radial menu over it. The model is
// a fixed set of slots (radial-model.js); slots that don't apply to this cell
// are shown disabled. Picks route through `radialDispatch` to existing handlers.
function onContextMenu({ q, r, clientX, clientY }) {
  if (!current) return;
  if (draftClicks) return; // ignore right-click while tracing a river/road
  selectCell(q, r);
  const hex = getHex(current, q, r);
  const placed = !!(hex && hex.placed);
  const hasSettlement = !!(placed && hex.settlement && hex.settlement.present);
  const model = buildRadialModel({
    placed,
    terrain: placed ? hex.terrain : null,
    hasSettlement,
    allowedSizes: placed ? allowedSizes(hex.terrain) : [],
    canGossip: hasSettlement,
    poiTypes: Object.keys(POI_GLYPHS),
    terrains: Object.keys(TERRAIN_COLORS),
    pois: placed ? (hex.pois || []).map((p) => ({ id: p.id, name: p.name })) : [],
    dungeonSizes: dungeonSizes.map((s) => ({ label: s.size, value: s.size, title: s.blurb || "" })),
    manualRiverHere: manualRiverIdAt(q, r),
    manualRoadHere: manualRoadIdAt(q, r),
    locked: !!(placed && hex.locked),
  });
  openRadial({ clientX, clientY, model, dispatch: radialDispatch });
}

// Map a radial pick (action id + optional value) to an existing handler. The
// handlers act on the module-level `selected`, set by selectCell above.
function radialDispatch(id, value) {
  switch (id) {
    case "generate": return onGenerateRandom();
    case "placeTerrain": return onPlaceTerrain(value);
    case "addRandomPoi": return onAddRandomPoi();
    case "addPoi": return onAddPoi(value);
    case "addRandomDungeon": return onAddDungeon();
    case "addDungeon": return onAddDungeon(value);
    case "removePoi": return onRemovePoi(value);
    case "addRandomSettlement": return onAddRandomSettlement();
    case "addSettlement": return onAddSettlement(value);
    case "removeSettlement": return onRemoveSettlement();
    case "genArea": return onGenerateArea(value);
    case "toggleLock": return onToggleLock();
    case "regenHex": return onRegenerate();
    case "regenArea": return onRegenerateArea(value);
    case "deleteHex": return onDeleteHex();
    case "genHook": return onGenerateHook();
    case "readMap": return onReadMap();
    case "followTrail": return onStartChain();
    case "drawRiver": return onStartDrawRiver();
    case "removeRiver": return onRemoveRiver(value);
    case "drawRoad": return onStartDrawRoad();
    case "removeRoad": return onRemoveRoad(value);
  }
}

async function onGenerateRandom() {
  if (!current || !selected) return;
  try {
    const tables = await loadTables(HEX_TABLE_IDS);
    addHex(current, buildRandomHex(tables, selected.q, selected.r, 0));
    await persistAndRefresh();
  } catch (err) {
    logLine(`Generate error: ${err.message}`);
  }
}

async function onPlaceTerrain(terrain) {
  if (!current || !selected) return;
  try {
    const { q, r } = selected;
    const tables = await loadTables(HEX_TABLE_IDS);
    // Terrain is the user's explicit choice; settlement/POIs are rolled (seeded
    // by coords) under THAT terrain's profile so the hex stays consistent.
    const rng = subRng(current.seed, "hex", q, r, 0);
    const hex = generateHex(tables, rng, {
      key: axialKey(q, r),
      coords: { q, r },
      placed: true,
      terrain,
      seed: current.seed,
      gen: 0,
      nearbyLargeCount: nearbyLargeCount(q, r),
    });
    hex.gen = 0;
    addHex(current, hex);
    await persistAndRefresh();
  } catch (err) {
    logLine(`Place error: ${err.message}`);
  }
}

// Batch-generate the empty hexes in the disc of `radius` around the selected
// hex (3R.1 "Area" tool, folded into the "Generate" submenu) — the old
// per-radius-1 "Neighbours" behaviour, generalized to any radius and to the
// full disc (center included). Always fill-empty only; already-placed hexes
// (including the center, if placed) are left untouched. One
// persistAndRefresh() at the end regardless of area size.
async function onGenerateArea(radius) {
  if (!current || !selected) return;
  try {
    const tables = await loadTables(HEX_TABLE_IDS);
    let added = 0;
    for (const { q, r } of hexDisc(selected.q, selected.r, radius)) {
      if (hasHexAt(current, q, r)) continue;
      addHex(current, buildRandomHex(tables, q, r, 0));
      added++;
    }
    if (!added) return logLine("No empty hexes in range.");
    await persistAndRefresh();
    logLine(`Generated ${added} hex(es).`);
  } catch (err) {
    logLine(`Generate area error: ${err.message}`);
  }
}

// "Give me another": bump the per-hex gen counter to escape coord-determinism.
// A locked hex is protected — unlock it first.
async function onRegenerate() {
  if (!current || !selected) return;
  try {
    const { q, r } = selected;
    const existing = getHex(current, q, r);
    if (existing && existing.locked) return logLine("Hex is locked — unlock it to regenerate.");
    const gen = ((existing && existing.gen) || 0) + 1;
    const tables = await loadTables(HEX_TABLE_IDS);
    addHex(current, buildRandomHex(tables, q, r, gen));
    await persistAndRefresh();
  } catch (err) {
    logLine(`Regenerate error: ${err.message}`);
  }
}

// Re-roll every EXISTING hex in the disc around the selection, bumping each one's
// gen. Locked hexes are kept as-is, and the manual rivers/roads stay frozen (only
// the derived overlays re-stitch). This is the "regenerate a region" tool.
async function onRegenerateArea(radius) {
  if (!current || !selected) return;
  try {
    const tables = await loadTables(HEX_TABLE_IDS);
    let n = 0, kept = 0;
    for (const { q, r } of hexDisc(selected.q, selected.r, radius)) {
      const existing = getHex(current, q, r);
      if (!existing || !existing.placed) continue; // only re-roll what's there
      if (existing.locked) { kept++; continue; }    // protected
      addHex(current, buildRandomHex(tables, q, r, ((existing.gen) || 0) + 1));
      n++;
    }
    if (!n) return logLine(kept ? "Every hex in range is locked." : "No hexes to regenerate in range.");
    await persistAndRefresh();
    logLine(`Regenerated ${n} hex(es)${kept ? ` (${kept} locked, kept)` : ""}.`);
  } catch (err) {
    logLine(`Regenerate area error: ${err.message}`);
  }
}

// Toggle the selected hex's `locked` flag — a locked hex is protected from
// regenerate and delete (so you can re-roll a region and keep what you like).
async function onToggleLock() {
  if (!current || !selected) return;
  const hex = getHex(current, selected.q, selected.r);
  if (!hex || !hex.placed) return;
  hex.locked = !hex.locked;
  await persistAndRefresh();
  logLine(hex.locked ? "Hex locked." : "Hex unlocked.");
}

async function onDeleteHex() {
  if (!current || !selected) return;
  const hex = getHex(current, selected.q, selected.r);
  if (hex && hex.locked) return logLine("Hex is locked — unlock it to delete.");
  removeHex(current, selected.q, selected.r);
  await persistAndRefresh();
}

function wire() {
  wireNewWorldMenu();
  $("btn-save").addEventListener("click", onSave);
  $("btn-delete").addEventListener("click", onDelete);
  $("btn-export").addEventListener("click", onExport);
  $("btn-import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", onImportFile);
  $("btn-icons").addEventListener("click", onToggleIcons);
  $("btn-labels").addEventListener("click", onToggleLabels);
  $("btn-legend").addEventListener("click", () => toggleLegend());
  $("btn-progress").addEventListener("click", onProgressDays);
  $("progress-days").addEventListener("keydown", (e) => { if (e.key === "Enter") onProgressDays(); });
  $("world-select").addEventListener("change", onSelectWorld);
  $("btn-dungeon-back").addEventListener("click", closeDungeonView);
  $("btn-dungeon-fit").addEventListener("click", fitView);
  $("btn-dungeon-legend").addEventListener("click", onToggleLegend);
  $("btn-zoom-in").addEventListener("click", () => zoomStep(1));
  $("btn-zoom-out").addEventListener("click", () => zoomStep(-1));
  $("btn-home").addEventListener("click", () => recenter());
  $("btn-help").addEventListener("click", () => toggleHelp());
  $("btn-help-close").addEventListener("click", () => toggleHelp(false));
  $("btn-draw-undo").addEventListener("click", onUndoDraftPoint);
  $("btn-draw-finish").addEventListener("click", onFinishDraft);
  $("btn-draw-cancel").addEventListener("click", onCancelDraft);
  $("map-scale").addEventListener("mouseenter", () => toggleTravelTip(true));
  $("map-scale").addEventListener("mouseleave", () => toggleTravelTip(false));
  $("help-overlay").addEventListener("click", (e) => {
    if (e.target.id === "help-overlay") toggleHelp(false); // click backdrop to close
  });
  window.addEventListener("keydown", onDraftKey); // river/road drawing intercepts Esc/Enter first
  window.addEventListener("keydown", onHelpKey); // Esc closes help before other handlers
  window.addEventListener("keydown", onWorldKey); // before onDungeonKey: hook-clear wins Esc
  window.addEventListener("keydown", onDungeonKey);
}

let iconsOn = true;
function onToggleIcons() {
  iconsOn = !iconsOn;
  setIconsEnabled(iconsOn);
  $("btn-icons").textContent = `Icons: ${iconsOn ? "on" : "off"}`;
}

let labelsOn = true;
function onToggleLabels() {
  labelsOn = !labelsOn;
  setLabelsEnabled(labelsOn);
  $("btn-labels").textContent = `Labels: ${labelsOn ? "on" : "off"}`;
}

async function init() {
  wire();
  attachMap($("map"), { onHexClick, onEmptyCellClick, onContextMenu, onHover, onView: drawScaleBar });
  attachDungeon($("dungeon-canvas"), { onRoomClick, onRoomContextMenu: onRoomContextMenu });
  // Size info for the "Add dungeon" menu (single source of truth: the table).
  try {
    const sizeT = await loadTables(["dungeon-size"]);
    dungeonSizes = sizeT.get("dungeon-size").entries.map((e) => e.value);
  } catch {
    /* menu still works with random size only */
  }
  await refreshWorldList();
  const lastId = getLastWorldId();
  if (lastId) {
    const world = await loadWorld(lastId);
    if (world) {
      await setCurrent(world);
      return;
    }
  }
  showWorld(null);
}

init().catch((err) => logLine(`Startup error: ${err.message}`));
