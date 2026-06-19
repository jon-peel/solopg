// App bootstrap: wires the command bar, world list, side panel, and hex map to
// the engine and persistence layers. Only entry module loaded by index.html.

import { makeRng, subRng } from "../core/rng.js";
import { rollTable } from "../core/table.js";
import { loadTables, makeResolver } from "../core/loader.js";
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
import { exportWorld, importWorld } from "../data/portability.js";
import {
  listWorlds,
  saveWorld,
  loadWorld,
  deleteWorld,
  setLastWorldId,
  getLastWorldId,
} from "../data/db.js";
import { logLine, showWorld, renderSelectionPanel } from "./panel.js";
import { attachMap, setWorld, setSelected, recenterOn } from "./map.js";
import { TERRAIN_COLORS } from "./terrain-style.js";

// Tables the test command needs. terrain references swamp-feature via a nested roll.
const TEST_TABLE_IDS = ["terrain", "swamp-feature"];

// Tables the single-hex generator rolls on.
const HEX_TABLE_IDS = [
  "terrain",
  "swamp-feature",
  "settlement-presence",
  "settlement-size",
  "poi-presence",
];

let current = null; // the in-memory current world
let currentRng = null; // one RNG stream per loaded world, advanced across rolls
let selected = null; // { q, r } | null — selected map cell

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
  current = world;
  currentRng = world ? makeRng(world.seed) : null;
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

async function onRollTest() {
  if (!current || !currentRng) return logLine("Create a world first.");
  try {
    const tables = await loadTables(TEST_TABLE_IDS);
    const result = rollTable(tables.get("terrain"), currentRng, {
      resolve: makeResolver(tables),
    });
    const detail = result.sub ? ` (${result.sub.value})` : "";
    logLine(`Rolled terrain: ${result.value}${detail}`);
  } catch (err) {
    logLine(`Roll error: ${err.message}`);
  }
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
    onGenerateRandom,
    onPlaceTerrain,
    onGenerateNeighbors,
    onRegenerate,
    onDelete: onDeleteHex,
  });
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
    // Settlement/POI still rolled (seeded by coords) so the hex is complete;
    // terrain is the user's explicit choice.
    const rng = subRng(current.seed, "hex", q, r, 0);
    const hex = generateHex(tables, rng, {
      key: axialKey(q, r),
      coords: { q, r },
      placed: true,
    });
    hex.terrain = terrain;
    if (terrain !== "Swamp") hex.terrainFeature = null;
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
  $("btn-roll").addEventListener("click", onRollTest);
  $("world-select").addEventListener("change", onSelectWorld);
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
