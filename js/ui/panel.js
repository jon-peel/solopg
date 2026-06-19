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
  const settlement = hex.settlement.present
    ? hex.settlement.size
    : "none";
  const pois = hex.pois.present ? String(hex.pois.count) : "none";
  return [
    `Hex ${hex.key}`,
    `  Terrain: ${terrain}`,
    `  Settlement: ${settlement}`,
    `  POIs: ${pois}`,
  ];
}

/** Log a generated hex to the panel as a readable block. */
export function logHex(hex) {
  logLine("—".repeat(3));
  for (const line of describeHex(hex)) logLine(line);
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
  logLine(`seed: ${world.seed}`);
  logLine(`hex scale: ${world.hexScale} miles`);
  logLine(`hexes: ${Object.keys(world.hexes).length}`);
}
