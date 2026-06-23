// App bootstrap: wires the command bar, world list, side panel, and hex map to
// the engine and persistence layers. Only entry module loaded by index.html.

import { subRng } from "../core/rng.js";
import { loadTables } from "../core/loader.js";
import { axialKey, neighbors } from "../core/hexgeo.js";
import {
  createWorld,
  addHex,
  getHex,
  hasHexAt,
  placedHexes,
  removeHex,
} from "../world/world.js";
import { generateHex } from "../gen/hex.js";
import { generatePoi } from "../gen/poi.js";
import { generateDungeon, DUNGEON_BUILD } from "../gen/dungeon.js";
import { getRoomState, withRoomState } from "../world/dungeon-state.js";
import { profileFor, SIZE_ORDER } from "../gen/terrain-profile.js";
import { exportWorld, importWorld, migrateWorld } from "../data/portability.js";
import {
  listWorlds,
  saveWorld,
  loadWorld,
  deleteWorld,
  setLastWorldId,
  getLastWorldId,
} from "../data/db.js";
import { logLine, showWorld, renderSelectionPanel, renderDungeonPanel } from "./panel.js";
import { attachDungeon, setLevel, setMarks, setSelectedRoom, fitView } from "./dungeon-map.js";
import {
  attachMap,
  setWorld,
  setSelected,
  recenterOn,
  setIconsEnabled,
} from "./map.js";
import { TERRAIN_COLORS } from "./terrain-style.js";
import { POI_GLYPHS } from "./poi-style.js";

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
];

let current = null; // the in-memory current world
let selected = null; // { q, r } | null — selected map cell
let selectedPoiId = null; // drill-in POI within the selected hex

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
  if (dungeonPoi) closeDungeonView(); // leave any open dungeon when switching worlds
  if (world) migrateWorld(world); // upgrade persisted older worlds (v2 -> v3 ...)
  current = world;
  selectedPoiId = null;
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
  await refreshWorldList();
}

async function onNewWorld() {
  // No blocking prompt(): browsers can suppress repeated dialogs (the "prevent
  // this page from creating more dialogs" box), which silently broke this
  // button. Create with a default name; rename inline via the panel title.
  const worlds = await listWorlds();
  const world = await saveWorld(createWorld({ name: defaultWorldName(worlds) }));
  await setCurrent(world);
  logLine("Created and saved.");
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

// Terrain strings of a cell's existing placed neighbors (for weighting).
function neighborTerrains(q, r) {
  return neighbors(q, r)
    .map((n) => getHex(current, n.q, n.r))
    .filter((h) => h && h.placed)
    .map((h) => h.terrain);
}

// --- selection + its right-panel actions ---------------------------------

function selectCell(q, r) {
  selected = { q, r };
  selectedPoiId = null; // reset drill-in when changing cell
  saveSelected(current, selected);
  setSelected(selected);
  renderSelection();
}

function renderSelection() {
  if (!current || !selected) return renderSelectionPanel(null);
  const { q, r } = selected;
  const hex = getHex(current, q, r);
  renderSelectionPanel({
    coord: { q, r },
    hex: hex && hex.placed ? hex : null,
    terrains: Object.keys(TERRAIN_COLORS),
    settlementSizes: hex && hex.placed ? allowedSizes(hex.terrain) : [],
    selectedPoiId,
    poiTypes: Object.keys(POI_GLYPHS),
    dungeonSizes,
    onAddSettlement,
    onAddRandomSettlement,
    onRemoveSettlement,
    onSelectPoi,
    onClearPoi: () => {
      selectedPoiId = null;
      renderSelection();
    },
    onAddRandomPoi,
    onAddPoi,
    onAddDungeon,
    onRemovePoi,
    onGenerateRandom,
    onPlaceTerrain,
    onGenerateNeighbors,
    onRegenerate,
    onDelete: onDeleteHex,
  });
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

// A dungeon needs (re)building if it has no interior yet, or its interior was
// generated by an older shape (e.g. predates per-level layouts). Versioning the
// interior with DUNGEON_BUILD lets old saves self-heal on next open.
function dungeonNeedsBuild(poi) {
  const d = poi.detail && poi.detail.dungeon;
  if (!d || d.build !== DUNGEON_BUILD) return true;
  return !Array.isArray(d.levels) || d.levels.some((l) => !l || !l.layout);
}

// Select a POI. Non-dungeon POIs drill into the side panel; a dungeon POI opens
// the Dungeon View (generating its interior lazily on first open — deterministic
// from the world seed + coords + the POI's index — then persisting).
async function onSelectPoi(id) {
  selectedPoiId = id;
  const hex = current && selected && getHex(current, selected.q, selected.r);
  const poi = hex && (hex.pois || []).find((p) => p.id === id);
  if (!poi || poi.type !== "dungeon") return renderSelection();

  if (dungeonNeedsBuild(poi)) {
    renderSelection(); // show the "Generating dungeon…" placeholder immediately
    try {
      const tables = await loadTables(HEX_TABLE_IDS);
      const m = /^poi:(\d+)$/.exec(poi.id || "");
      const n = m ? Number(m[1]) : 0;
      const rng = subRng(current.seed, "hex", selected.q, selected.r, "dungeon", n);
      poi.detail = poi.detail || {};
      poi.detail.dungeon = generateDungeon(tables, rng, {
        theme: poi.detail.theme,
        size: poi.detail.sizeHint,
        terrain: hex.terrain,
      });
      // Legacy dungeons predate themes — backfill from the generated interior so
      // the map glyph reflects it.
      poi.detail.theme = poi.detail.theme || poi.detail.dungeon.theme;
      await persistAndRefresh();
    } catch (err) {
      logLine(`Dungeon error: ${err.message}`);
      return;
    }
  }
  openDungeonView(poi);
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

function renderLevelSwitcher() {
  const bar = $("dungeon-levels");
  bar.innerHTML = "";
  dungeonPoi.detail.dungeon.levels.forEach((lvl, i) => {
    const b = document.createElement("button");
    b.textContent = `L${lvl.depth}`;
    if (i === dungeonLevelIndex) b.className = "active";
    b.addEventListener("click", () => showDungeonLevel(i));
    bar.appendChild(b);
  });
}

// Connector marks (entrance/exit/stairs) for one level, as Sets of room numbers.
function levelMarks(dungeon, i) {
  const m = { entrance: new Set(), exit: new Set(), down: new Set(), up: new Set() };
  for (const e of dungeon.entrances || []) if (e.level === i) m.entrance.add(e.room);
  for (const e of dungeon.exits || []) if (e.level === i) m.exit.add(e.room);
  for (const st of dungeon.stairs || []) {
    if (st.down.level === i) m.down.add(st.down.room);
    if (st.up.level === i) m.up.add(st.up.room);
  }
  return m;
}

// Stair navigation available from a given room: each entry switches level + room.
function roomConnections(dungeon, i, n) {
  const conns = [];
  for (const st of dungeon.stairs || []) {
    const word = st.kind === "shaft" ? "Shaft" : "Stairs";
    if (st.down.level === i && st.down.room === n)
      conns.push({ label: `${word} down to L${st.up.level + 1} →`, toLevel: st.up.level, toRoom: st.up.room });
    if (st.up.level === i && st.up.room === n)
      conns.push({ label: `${word} up to L${st.down.level + 1} →`, toLevel: st.down.level, toRoom: st.down.room });
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
  renderRoomPanel(n);
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

async function persistAndRefresh() {
  current = await saveWorld(current);
  setWorld(current);
  renderSelection();
}

// Build (in memory) a neighbor-weighted random hex at (q,r) for generation `gen`.
function buildRandomHex(tables, q, r, gen) {
  const rng = subRng(current.seed, "hex", q, r, gen);
  const hex = generateHex(tables, rng, {
    key: axialKey(q, r),
    coords: { q, r },
    placed: true,
    neighborTerrains: neighborTerrains(q, r),
    seed: current.seed,
    gen,
  });
  hex.gen = gen;
  return hex;
}

function onHexClick({ q, r }) {
  selectCell(q, r);
}

function onEmptyCellClick({ q, r }) {
  selectCell(q, r);
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
    });
    hex.gen = 0;
    addHex(current, hex);
    await persistAndRefresh();
  } catch (err) {
    logLine(`Place error: ${err.message}`);
  }
}

async function onGenerateNeighbors() {
  if (!current || !selected) return;
  try {
    const tables = await loadTables(HEX_TABLE_IDS);
    let added = 0;
    for (const { q, r } of neighbors(selected.q, selected.r)) {
      if (hasHexAt(current, q, r)) continue;
      addHex(current, buildRandomHex(tables, q, r, 0));
      added++;
    }
    if (!added) return logLine("All neighbors already filled.");
    await persistAndRefresh();
    logLine(`Generated ${added} neighbor hex(es).`);
  } catch (err) {
    logLine(`Generate error: ${err.message}`);
  }
}

// "Give me another": bump the per-hex gen counter to escape coord-determinism.
async function onRegenerate() {
  if (!current || !selected) return;
  try {
    const { q, r } = selected;
    const existing = getHex(current, q, r);
    const gen = ((existing && existing.gen) || 0) + 1;
    const tables = await loadTables(HEX_TABLE_IDS);
    addHex(current, buildRandomHex(tables, q, r, gen));
    await persistAndRefresh();
  } catch (err) {
    logLine(`Regenerate error: ${err.message}`);
  }
}

async function onDeleteHex() {
  if (!current || !selected) return;
  removeHex(current, selected.q, selected.r);
  await persistAndRefresh();
}

function wire() {
  $("btn-new").addEventListener("click", onNewWorld);
  $("btn-save").addEventListener("click", onSave);
  $("btn-delete").addEventListener("click", onDelete);
  $("btn-export").addEventListener("click", onExport);
  $("btn-import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", onImportFile);
  $("btn-icons").addEventListener("click", onToggleIcons);
  $("world-select").addEventListener("change", onSelectWorld);
  $("btn-dungeon-back").addEventListener("click", closeDungeonView);
  $("btn-dungeon-fit").addEventListener("click", fitView);
  $("btn-dungeon-legend").addEventListener("click", onToggleLegend);
}

let iconsOn = true;
function onToggleIcons() {
  iconsOn = !iconsOn;
  setIconsEnabled(iconsOn);
  $("btn-icons").textContent = `Icons: ${iconsOn ? "on" : "off"}`;
}

async function init() {
  wire();
  attachMap($("map"), { onHexClick, onEmptyCellClick });
  attachDungeon($("dungeon-canvas"), { onRoomClick });
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
