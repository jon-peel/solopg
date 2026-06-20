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
import { exportWorld, importWorld, migrateWorld } from "../data/portability.js";
import {
  listWorlds,
  saveWorld,
  loadWorld,
  deleteWorld,
  setLastWorldId,
  getLastWorldId,
} from "../data/db.js";
import { logLine, showWorld, renderSelectionPanel } from "./panel.js";
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
];

let current = null; // the in-memory current world
let selected = null; // { q, r } | null — selected map cell
let selectedPoiId = null; // drill-in POI within the selected hex

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
  if (world) migrateWorld(world); // upgrade persisted older worlds (v2 -> v3 ...)
  current = world;
  selectedPoiId = null;
  if (world) setLastWorldId(world.id);
  showWorld(world);
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
  const name = prompt("World name?", "New World");
  if (name === null) return;
  const world = await saveWorld(createWorld({ name: name || "Untitled World" }));
  await setCurrent(world);
  logLine("Created and saved.");
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

async function onDelete() {
  if (!current) return;
  if (!confirm(`Delete "${current.name}"?`)) return;
  await deleteWorld(current.id);
  logLine(`Deleted "${current.name}".`);
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
    selectedPoiId,
    poiTypes: Object.keys(POI_GLYPHS),
    onSelectPoi: (id) => {
      selectedPoiId = id;
      renderSelection();
    },
    onClearPoi: () => {
      selectedPoiId = null;
      renderSelection();
    },
    onAddRandomPoi,
    onAddPoi,
    onRemovePoi,
    onGenerateRandom,
    onPlaceTerrain,
    onGenerateNeighbors,
    onRegenerate,
    onDelete: onDeleteHex,
  });
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

async function addPoiToSelected(forceType) {
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
