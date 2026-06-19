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
