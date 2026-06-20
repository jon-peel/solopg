// Point-of-interest generator (Phase 3).
//
// Pure: given preloaded tables + an rng stream + context, returns one typed POI.
// POI type is terrain-weighted (via terrain-profile); occupant is a creature
// lair, a generic occupier (flavor label, NO faction machinery), or empty.
// Factions are deferred to a dedicated later phase.

import { rollTable } from "../core/table.js";
import { poiTypeTable } from "./terrain-profile.js";

// Build a Map of poi type -> metadata from the poi-types table (keyed lookup).
function poiTypeMeta(tables) {
  const map = new Map();
  for (const entry of tables.get("poi-types").entries) {
    map.set(entry.value.type, entry.value);
  }
  return map;
}

// Find the kinds sub-table for a given occupant lean.
function kindsForLean(tables, lean) {
  const row = tables
    .get("poi-occupant")
    .entries.find((e) => e.value.lean === lean);
  const kinds = (row && row.value.kinds) || [{ weight: 1, value: "none" }];
  return { id: `poi-occupant:${lean}`, entries: kinds };
}

function nameFor(type, label, occupant) {
  if (occupant.kind === "lair") return `${occupant.creature} ${label}`;
  if (occupant.kind === "occupied") return `${label} (${occupant.by})`;
  return label;
}

function flavorFor(type, occupant) {
  if (occupant.kind === "lair") return `A ${type} that is home to ${occupant.creature.toLowerCase()}.`;
  if (occupant.kind === "occupied") return `A ${type} held by ${occupant.by.toLowerCase()}.`;
  return `An abandoned ${type}.`;
}

/**
 * Generate one POI.
 * @param {Map<string,object>} tables incl. poi-types, poi-occupant, creatures, occupiers
 * @param {() => number} rng a dedicated sub-stream for this POI
 * @param {{ terrain: string, index: number }} ctx
 * @returns {object} POI
 */
export function generatePoi(tables, rng, ctx) {
  const type = rollTable(poiTypeTable(ctx.terrain), rng).value;
  const meta = poiTypeMeta(tables).get(type) || { label: type, occupantLean: "none" };

  // Decide occupant kind from the type's lean.
  const kind = rollTable(kindsForLean(tables, meta.occupantLean), rng).value;
  let occupant;
  if (kind === "lair") {
    occupant = { kind: "lair", creature: rollTable(tables.get("creatures"), rng).value };
  } else if (kind === "occupied") {
    occupant = { kind: "occupied", by: rollTable(tables.get("occupiers"), rng).value };
  } else {
    occupant = { kind: "none" };
  }

  const detail = { flavor: flavorFor(type, occupant) };
  if (type === "dungeon") detail.stub = { phase: 4 }; // deep internals come in Phase 4

  return {
    id: `poi:${ctx.index}`,
    type,
    name: nameFor(type, meta.label, occupant),
    occupant,
    detail,
  };
}
