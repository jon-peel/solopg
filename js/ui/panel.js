// Side-panel rendering helpers.

import { glyphForPoiType } from "./poi-style.js";

const panel = () => document.getElementById("panel");

/** One-line summary of a POI's occupant. */
export function occupantSummary(occupant) {
  if (!occupant) return "empty";
  if (occupant.kind === "lair") return `Lair: ${occupant.creature}`;
  if (occupant.kind === "occupied") return `Held: ${occupant.by}`;
  return "empty";
}

/** Append a timestamped-ish log line to the panel. */
export function logLine(text) {
  const el = panel();
  if (!el) return;
  const line = document.createElement("div");
  line.className = "log-line";
  line.textContent = text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
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
  const settlement = hex.settlement.present ? hex.settlement.size : "none";
  const poiList = Array.isArray(hex.pois) ? hex.pois : [];
  const pois = poiList.length
    ? `${poiList.length} (${poiList.map((p) => p.type).join(", ")})`
    : "none";
  const coords = hex.coords
    ? `  Coords: (${hex.coords.q}, ${hex.coords.r})`
    : null;
  return [
    `Hex ${hex.key}`,
    coords,
    `  Terrain: ${terrain}`,
    `  Settlement: ${settlement}`,
    `  POIs: ${pois}`,
  ].filter(Boolean);
}

/** Log a generated hex to the panel as a readable block. */
export function logHex(hex) {
  logLine("—".repeat(3));
  for (const line of describeHex(hex)) logLine(line);
}

function actionButton(label, onClick) {
  const b = document.createElement("button");
  b.className = "tile-action";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/**
 * Render the selected tile's details + context actions into #selection.
 * @param {object} model
 *   { coord:{q,r}, hex|null, terrains:string[],
 *     onGenerateRandom, onPlaceTerrain(t), onGenerateNeighbors, onRegenerate, onDelete }
 */
// POI list + add controls, or the drill-in detail of the selected POI.
function renderPoiSection(sel, hex, model) {
  const pois = Array.isArray(hex.pois) ? hex.pois : [];
  const selectedPoi =
    model.selectedPoiId && pois.find((p) => p.id === model.selectedPoiId);

  // Drill-in detail of one POI (type, occupant, flavor) + Back / Remove.
  if (selectedPoi) {
    const box = document.createElement("div");
    box.className = "poi-detail";
    const title = document.createElement("div");
    title.className = "poi-detail-title";
    title.textContent = `${glyphForPoiType(selectedPoi.type)} ${selectedPoi.name}`;
    box.appendChild(title);
    for (const line of [
      `Type: ${selectedPoi.type}`,
      `Occupant: ${occupantSummary(selectedPoi.occupant)}`,
      selectedPoi.detail && selectedPoi.detail.flavor,
      selectedPoi.detail && selectedPoi.detail.stub
        ? "Dungeon interior — detail in Phase 4."
        : null,
    ].filter(Boolean)) {
      const div = document.createElement("div");
      div.className = "log-line";
      div.textContent = line;
      box.appendChild(div);
    }
    const row = document.createElement("div");
    row.className = "tile-actions";
    row.appendChild(actionButton("← Back", model.onClearPoi));
    row.appendChild(actionButton("Remove", () => model.onRemovePoi(selectedPoi.id)));
    box.appendChild(row);
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
      row.textContent = `${glyphForPoiType(poi.type)} ${poi.name}`;
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

  // Single "Add POI" dropdown: Random + each specific type.
  sel.appendChild(addPoiMenu(model));
}

function sectionLabel(text) {
  const el = document.createElement("div");
  el.className = "section-label";
  el.textContent = text;
  return el;
}

// A native disclosure dropdown. `items` = [{ label, onClick }]; first item
// (e.g. "Random") is kept at the top, the rest are shown in given order.
function buildMenu(summaryText, items) {
  const menu = document.createElement("details");
  menu.className = "menu";
  const summary = document.createElement("summary");
  summary.textContent = summaryText;
  menu.appendChild(summary);

  const list = document.createElement("div");
  list.className = "menu-list";
  for (const { label, onClick } of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => {
      menu.open = false;
      onClick();
    });
    list.appendChild(b);
  }
  menu.appendChild(list);
  return menu;
}

// "Add POI" dropdown: Random, then types alphabetically.
function addPoiMenu(model) {
  const types = [...(model.poiTypes || [])].sort();
  return buildMenu("Add POI ▾", [
    { label: "Random", onClick: model.onAddRandomPoi },
    ...types.map((t) => ({ label: t, onClick: () => model.onAddPoi(t) })),
  ]);
}

// "Place terrain" dropdown for an empty cell: Random, then terrains alphabetically.
function placeTerrainMenu(model) {
  const terrains = [...(model.terrains || [])].sort();
  return buildMenu("Place terrain ▾", [
    { label: "Random", onClick: model.onGenerateRandom },
    ...terrains.map((t) => ({ label: t, onClick: () => model.onPlaceTerrain(t) })),
  ]);
}

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
    renderPoiSection(sel, hex, model);
  }

  if (hex) {
    sel.appendChild(sectionLabel("Hex"));
    const actions = document.createElement("div");
    actions.className = "tile-actions";
    actions.appendChild(actionButton("Generate neighbors", model.onGenerateNeighbors));
    actions.appendChild(actionButton("Regenerate", model.onRegenerate));
    actions.appendChild(actionButton("Delete", model.onDelete));
    sel.appendChild(actions);
  } else {
    sel.appendChild(placeTerrainMenu(model));
  }
}

/** Replace the panel contents with a heading describing the current world. */
export function showWorld(world) {
  const el = panel();
  if (!el) return;
  el.innerHTML = "";
  if (!world) {
    logLine("No world loaded. Create one to begin.");
    return;
  }
  const h = document.createElement("h2");
  h.textContent = world.name;
  el.appendChild(h);
  // Fixed region for the selected-hex details (above the scrolling log).
  const sel = document.createElement("div");
  sel.id = "selection";
  el.appendChild(sel);
  logLine(`seed: ${world.seed}`);
  logLine(`hex scale: ${world.hexScale} miles`);
  logLine(`hexes: ${Object.keys(world.hexes).length}`);
}
