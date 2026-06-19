// Side-panel rendering helpers.

const panel = () => document.getElementById("panel");

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
  const pois = hex.pois.present ? String(hex.pois.count) : "none";
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
  }

  const actions = document.createElement("div");
  actions.className = "tile-actions";
  if (hex) {
    actions.appendChild(actionButton("Generate neighbors", model.onGenerateNeighbors));
    actions.appendChild(actionButton("Regenerate", model.onRegenerate));
    actions.appendChild(actionButton("Delete", model.onDelete));
  } else {
    actions.appendChild(actionButton("Generate random", model.onGenerateRandom));
    for (const t of model.terrains) {
      actions.appendChild(actionButton(t, () => model.onPlaceTerrain(t)));
    }
  }
  sel.appendChild(actions);
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
