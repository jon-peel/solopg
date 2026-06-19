// App bootstrap: wires the command bar, world list, and side panel to the
// engine and persistence layers. This is the only entry module loaded by
// index.html.

import { makeRng } from "../core/rng.js";
import { rollTable } from "../core/table.js";
import { loadTables, makeResolver } from "../core/loader.js";
import { createWorld } from "../world/world.js";
import { exportWorld, importWorld } from "../data/portability.js";
import {
  listWorlds,
  saveWorld,
  loadWorld,
  deleteWorld,
  setLastWorldId,
  getLastWorldId,
} from "../data/db.js";
import { logLine, showWorld } from "./panel.js";

// Tables the test command needs. terrain references swamp-feature via a nested roll.
const TEST_TABLE_IDS = ["terrain", "swamp-feature"];

let current = null; // the in-memory current world
let currentRng = null; // one RNG stream per loaded world, advanced across rolls

const $ = (id) => document.getElementById(id);

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
  // Fresh stream seeded from this world's seed: rolls vary per click but the
  // sequence is reproducible from the start of a session.
  currentRng = world ? makeRng(world.seed) : null;
  if (world) setLastWorldId(world.id);
  showWorld(world);
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
