// Weighted-table engine.
//
// All generated content lives in JSON tables of the canonical shape (see
// PLAN.md). This module validates that shape and rolls on it. Generators are a
// thin layer over this — adding content never means rewriting logic.
//
// Canonical entry: { weight?: number (default 1), value: any, roll?: { table: string } }

/**
 * Validate a table's shape, throwing a descriptive Error on any problem.
 * Returns the table unchanged so it can be used inline.
 * @param {any} table
 * @returns {any} the same table
 */
export function validateTable(table) {
  const id = table && table.id;
  const where = id ? `table "${id}"` : "table";

  if (!table || typeof table !== "object") {
    throw new Error(`Invalid table: not an object`);
  }
  if (typeof table.id !== "string" || table.id.length === 0) {
    throw new Error(`Invalid table: missing string "id"`);
  }
  if (!Array.isArray(table.entries) || table.entries.length === 0) {
    throw new Error(`Invalid ${where}: "entries" must be a non-empty array`);
  }

  table.entries.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Invalid ${where}: entry ${i} is not an object`);
    }
    if (!("value" in entry)) {
      throw new Error(`Invalid ${where}: entry ${i} is missing "value"`);
    }
    if ("weight" in entry) {
      const w = entry.weight;
      if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) {
        throw new Error(
          `Invalid ${where}: entry ${i} has non-positive/finite weight ${w}`,
        );
      }
    }
    if ("roll" in entry) {
      if (
        !entry.roll ||
        typeof entry.roll !== "object" ||
        typeof entry.roll.table !== "string"
      ) {
        throw new Error(
          `Invalid ${where}: entry ${i} "roll" must be { table: string }`,
        );
      }
    }
  });

  return table;
}

/**
 * Roll on a weighted table.
 * @param {object} table validated table (canonical shape)
 * @param {() => number} rng float in [0,1)
 * @param {{ resolve?: (id: string) => object }} [opts] resolver for nested rolls
 * @returns {{ value: any, entry: object, sub?: object }}
 */
export function rollTable(table, rng, opts = {}) {
  const entries = table.entries;
  let totalWeight = 0;
  for (const e of entries) totalWeight += "weight" in e ? e.weight : 1;

  let target = rng() * totalWeight;
  let chosen = entries[entries.length - 1];
  for (const e of entries) {
    target -= "weight" in e ? e.weight : 1;
    if (target < 0) {
      chosen = e;
      break;
    }
  }

  const result = { value: chosen.value, entry: chosen };

  if (chosen.roll) {
    if (typeof opts.resolve !== "function") {
      throw new Error(
        `Entry in table "${table.id}" needs a sub-table "${chosen.roll.table}" ` +
          `but no resolve() was provided`,
      );
    }
    const subTable = opts.resolve(chosen.roll.table);
    if (!subTable) {
      throw new Error(`Could not resolve sub-table "${chosen.roll.table}"`);
    }
    result.sub = rollTable(subTable, rng, opts);
  }

  return result;
}
