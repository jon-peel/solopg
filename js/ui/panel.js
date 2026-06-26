// Side-panel rendering helpers.

import { glyphForPoi } from "./poi-style.js";

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
  const coords = hex.coords
    ? `  Coords: (${hex.coords.q}, ${hex.coords.r})`
    : null;
  // Settlement and POIs have their own panel sections (with controls).
  return [`Hex ${hex.key}`, coords, `  Terrain: ${terrain}`].filter(Boolean);
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
    title.textContent = `${glyphForPoi(selectedPoi)} ${selectedPoi.name}`;
    box.appendChild(title);
    for (const line of [
      `Type: ${selectedPoi.type}`,
      `Occupant: ${occupantSummary(selectedPoi.occupant)}`,
      selectedPoi.detail && selectedPoi.detail.flavor,
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
      row.textContent = `${glyphForPoi(poi)} ${poi.name}`;
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

  // Add controls: dungeons (with size choice) get their own menu beside Add POI.
  const adders = document.createElement("div");
  adders.className = "tile-actions";
  adders.appendChild(addDungeonMenu(model));
  adders.appendChild(addPoiMenu(model));
  sel.appendChild(adders);
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
  for (const { label, onClick, title } of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener("click", () => {
      menu.open = false;
      onClick();
    });
    list.appendChild(b);
  }
  menu.appendChild(list);
  return menu;
}

// "Add POI" dropdown: Random, then types alphabetically. Dungeons have their own
// menu (size choice), so they're excluded here — a "Random" POI can still be one.
function addPoiMenu(model) {
  const types = [...(model.poiTypes || [])].filter((t) => t !== "dungeon").sort();
  return buildMenu("Add POI ▾", [
    { label: "Random", onClick: model.onAddRandomPoi },
    ...types.map((t) => ({ label: t, onClick: () => model.onAddPoi(t) })),
  ]);
}

// "Add dungeon" dropdown: random size, then each named size with its level/room
// counts spelled out (so the sizes are clearly different) + a flavor tooltip.
function addDungeonMenu(model) {
  const sizes = model.dungeonSizes || [];
  const range = (r) => (r && r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);
  return buildMenu("Add dungeon ▾", [
    { label: "Random size", onClick: () => model.onAddDungeon() },
    ...sizes.map((s) => ({
      label: `${s.size} — ${range(s.levels)} lvl, ${range(s.rooms)} rooms`,
      title: s.blurb || "",
      onClick: () => model.onAddDungeon(s.size),
    })),
  ]);
}

// Settlement section: current settlement + Remove, or an "Add settlement"
// dropdown offering only the sizes the terrain allows (none on open water).
function renderSettlementSection(sel, hex, model) {
  sel.appendChild(sectionLabel("Settlement"));
  if (hex.settlement && hex.settlement.present) {
    const line = document.createElement("div");
    line.className = "log-line";
    line.textContent = hex.settlement.size;
    sel.appendChild(line);
    const actions = document.createElement("div");
    actions.className = "tile-actions";
    actions.appendChild(actionButton("Remove settlement", model.onRemoveSettlement));
    sel.appendChild(actions);
  } else if (model.settlementSizes && model.settlementSizes.length) {
    sel.appendChild(
      buildMenu("Add settlement ▾", [
        { label: "Random", onClick: model.onAddRandomSettlement },
        ...model.settlementSizes.map((s) => ({
          label: s,
          onClick: () => model.onAddSettlement(s),
        })),
      ]),
    );
  } else {
    const none = document.createElement("div");
    none.className = "log-line";
    none.textContent = "none (terrain allows none)";
    sel.appendChild(none);
  }
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
    renderSettlementSection(sel, hex, model);
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

/**
 * Render the Dungeon View's side panel: the dungeon header, the current level
 * (theme/family + wandering monsters), and the selected room's contents.
 * @param {{ dungeon: object, level: object, room: object|null }} model
 */
// Coins read book-style as a dice expression, no weight ("Loose coins (2d6×10 gp)");
// gems/idols/plate roll a concrete value + weight ("— 240 gp, 12 cn"); leads/magic
// show neither. Guard is always appended.
function treasureLine(t) {
  let amount = "";
  if (t.dice) amount = ` (${t.dice} gp)`;
  else if (t.gp > 0) amount = ` — ${t.gp} gp${t.weight ? `, ${t.weight} cn` : ""}`;
  return `Treasure: ${t.kind}${amount} (${t.guard})`;
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

  sel.appendChild(sectionLabel(`Level ${level.depth} — ${level.family}`));
  if (dungeon.occupation && dungeon.occupation.level === level.depth - 1) {
    const occ = document.createElement("div");
    occ.className = "log-line";
    occ.textContent = `Occupied near an entrance by ${dungeon.occupation.by} (locked door beyond)`;
    sel.appendChild(occ);
  }
  const wandering = document.createElement("div");
  wandering.className = "log-line";
  wandering.textContent =
    "Wandering: " + (level.encounters || []).map((e) => e.value).join(", ");
  sel.appendChild(wandering);

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
    logLine("No world loaded. Create one to begin.");
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
  // Fixed region for the selected-hex details (above the scrolling log).
  const sel = document.createElement("div");
  sel.id = "selection";
  el.appendChild(sel);
  logLine(`seed: ${world.seed}`);
  logLine(`hex scale: ${world.hexScale} miles`);
  logLine(`hexes: ${Object.keys(world.hexes).length}`);
}
