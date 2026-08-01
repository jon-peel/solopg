// Monastery generation (Phase 15, Step 2) — the bake that fills
// `settlement.monastery` for every hex the kind roll marked
// `settlement.kind === "monastery"` (js/gen/hex.js). Pure module: no DOM, no
// fetch, no persistence — a deterministic function of
// (seed, q, r, gen, size, race) plus the preloaded flavour tables, so it is
// unit-testable under `node --test` and reproduces byte-identically from a seed.
//
// Mirrors the culture stamp pass (js/gen/culture.js stampSettlements): filter the
// pending hexes, roll each from its OWN dedicated sub-stream in a FIXED order, and
// freeze the result (the `settlement.monastery` object itself is the freeze flag —
// the `!monastery` guard makes a re-run a no-op). NO backward compat / migration:
// only newly-generated or regenerated monasteries get baked; everything additive.
//
// The monastery's size drives whether it is SELF-SUFFICIENT (a big house farms its
// own valley) or a DEPENDENT house (a small priory that must be provisioned), and
// how many trade INDUSTRIES it runs. A demihuman house honours its people's gods
// (RACE_DEITIES) and leans its output toward its people's crafts
// (RACE_MONASTERY_PRODUCTS); a Human house (no `settlement.race`) rolls the plain
// shrine-dedication / product tables. Later steps (6/8) fill library/relic/secret/
// catacombs onto the same object — this bake deliberately leaves those absent.

import { subRng, pick, randInt } from "../core/rng.js";
import { rollTable } from "../core/table.js";
import { RACE_DEITIES, RACE_MONASTERY_PRODUCTS, RACE_NAME_POOLS } from "./culture-data.js";

// Size -> house economics. `selfSufficient` big houses (Town/City) work their own
// lands and need no provisioning; small houses (Hamlet/Village) are dependent and
// roll a provisioning clause. `min`/`max` is the industry count drawn for that size
// (a lonely hamlet runs one craft; a grand abbey several).
const MONASTERY_SIZE_RULES = {
  Hamlet:  { selfSufficient: false, min: 1, max: 1 },
  Village: { selfSufficient: false, min: 1, max: 2 },
  Town:    { selfSufficient: true,  min: 2, max: 3 },
  City:    { selfSufficient: true,  min: 3, max: 4 },
};

// Per-house chance of carrying an optional descriptive TRAIT (renowned, fortified,
// reclusive…). Rolled UNCONDITIONALLY (one draw either way) so the sub-stream stays
// uniform whether or not a trait lands.
const TRAIT_CHANCE = 0.5;

/**
 * Sample `count` DISTINCT entries from a weighted list WITHOUT replacement,
 * returning their `value`s as a string[]. Running-subtraction weighted pick (like
 * rollTable), removing the chosen entry each round so it can't repeat. Race-
 * AGNOSTIC — any per-race bias is already folded into the entry weights by the
 * caller. `count` is clamped to the list length (can never over-draw). Pure: never
 * mutates the input array (it copies before splicing).
 *
 * @param {() => number} rng
 * @param {{ value: string, weight?: number }[]} entries
 * @param {number} count
 * @returns {string[]}
 */
export function pickDistinctWeighted(rng, entries, count) {
  const pool = entries.slice(); // copy — never mutate the caller's list
  const n = Math.min(count, pool.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    let total = 0;
    for (const e of pool) total += e.weight ?? 1;
    let target = rng() * total;
    let idx = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      target -= pool[j].weight ?? 1;
      if (target < 0) {
        idx = j;
        break;
      }
    }
    out.push(pool[idx].value);
    pool.splice(idx, 1); // without replacement — distinct picks only
  }
  return out;
}

/**
 * A monastic PROPER NAME for a house — "Saint Morwenna's Priory", "the Abbey of
 * Silent Mercy", "Whitethorn Hermitage", or (for a demihuman house) its own
 * people's stem "Duromar Abbey". Pure: a deterministic function of the passed
 * `rng` stream and the class-tagged `monastery-name` table, so the caller can
 * reproduce it byte-for-byte.
 *
 * The table's entries are `{ class, text }` values (class ∈ house | saint |
 * virtue | colour). We partition them into weighted per-class sub-tables: `house`
 * is the settlement-word (Abbey/Priory/…); saint/virtue/colour supply the
 * epithet. A demihuman house (~half the time) instead prefixes its people's own
 * name-stem (RACE_NAME_POOLS[race].prefixes); a Human house always composes from
 * a saint/virtue/colour epithet (weighted 2/2/1).
 *
 * @param {() => number} rng
 * @param {{ entries: { weight?: number, value: { class: string, text: string } }[] }} nameTable
 * @param {{ race?: string }} [opts]
 * @returns {string}
 */
export function monasteryName(rng, nameTable, { race } = {}) {
  // Partition the {class,text} entries into weighted sub-tables by class.
  const byClass = (cls) => ({ id: `monastery-name:${cls}`, entries:
    nameTable.entries.filter((e) => e.value.class === cls)
      .map((e) => ({ weight: e.weight ?? 1, value: e.value.text })) });
  const houses = byClass("house");
  const house = rollTable(houses, rng).value;

  // Culture-aware: a demihuman house ~half the time takes its own people's name-stem.
  const stems = race && RACE_NAME_POOLS[race] && RACE_NAME_POOLS[race].prefixes;
  if (stems && stems.length && rng() < 0.5) {
    return `${pick(rng, stems)} ${house}`;            // "Duromar Abbey"
  }
  // else compose from a saint / virtue / colour epithet (weighted 2/2/1).
  const cls = pick(rng, ["saint", "saint", "virtue", "virtue", "colour"]);
  const epithet = rollTable(byClass(cls), rng).value;
  if (cls === "saint")  return `${epithet}'s ${house}`;          // "Saint Morwenna's Priory"
  if (cls === "virtue") return `the ${house} of ${epithet}`;      // "the Abbey of Silent Mercy"
  return `${epithet} ${house}`;                                   // "Whitethorn Hermitage"
}

/**
 * Bake `settlement.monastery` onto every not-yet-resolved monastery hex in
 * `placedHexes`, in ONE pass. Mutates the hexes (like stampSettlements): a stamped
 * hex gets a `settlement.monastery` object; the object's presence is the freeze
 * flag, so a later re-derive with the same inputs never re-rolls it. Idempotent and
 * cheap when nothing is pending. Each hex rolls from its own
 * `subRng(seed,"monastery-stamp",q,r,gen)` sub-stream in a FIXED order (count →
 * dedication → industries → provisioning → trait → name), so the batch is order-
 * independent and byte-deterministic in (seed,q,r,gen,size,race)+tables.
 *
 * @param {number|string} seed
 * @param {{coords?:{q:number,r:number}, gen?:number, settlement?:object}[]} placedHexes
 * @param {Map<string,object>} tables must include monastery-product,
 *   monastery-provisioning, monastery-trait, shrine-dedication, monastery-name.
 * @param {object} [opts] reserved for later steps; unused here.
 * @returns {object[]} the same array (mutated)
 */
export function stampMonasteries(seed, placedHexes, tables, opts = {}) {
  const pending = (placedHexes || []).filter(
    (h) => h.settlement?.present && h.settlement.kind === "monastery" && !h.settlement.monastery,
  );
  if (!pending.length) return placedHexes; // nothing to do — skip all work

  for (const h of pending) {
    const { q, r } = h.coords;
    const rng = subRng(seed, "monastery-stamp", q, r, h.gen ?? 0);

    // 1. Size -> economics rule (fall back to Village's rule for an unknown size).
    const size = h.settlement.size ?? h.settlement.baseSize;
    const rule = MONASTERY_SIZE_RULES[size] ?? MONASTERY_SIZE_RULES.Village;

    // 2. Industry count — ALWAYS one draw (even a Hamlet's min==max==1) so the
    //    stream advances identically for every size.
    const count = randInt(rng, rule.min, rule.max);

    // 3. Dedication — a demihuman house honours its people's gods (RACE_DEITIES),
    //    a Human/no-race house rolls the plain shrine-dedication table. One draw
    //    either branch.
    const race = h.settlement.race;
    const dedication = (race && RACE_DEITIES[race])
      ? pick(rng, RACE_DEITIES[race])
      : rollTable(tables.get("shrine-dedication"), rng).value;

    // 4. Industries — race-bias the product entries HERE (race is in scope),
    //    iterating in array order for determinism, then hand a race-AGNOSTIC list
    //    to pickDistinctWeighted for `count` distinct crafts.
    const biasedEntries = tables.get("monastery-product").entries.map((e) => ({
      value: e.value,
      weight: (e.weight ?? 1) * (RACE_MONASTERY_PRODUCTS[race]?.[e.value] ?? 1),
    }));
    const industries = pickDistinctWeighted(rng, biasedEntries, count);

    // 5. Provisioning — only a DEPENDENT (non-self-sufficient) house rolls one; a
    //    self-sufficient house draws nothing here (keeps the stream tight).
    const provisioning = rule.selfSufficient
      ? null
      : rollTable(tables.get("monastery-provisioning"), rng).value;

    // 6. Trait — draw UNCONDITIONALLY; keep it only when the draw clears TRAIT_CHANCE.
    const trait = rng() < TRAIT_CHANCE
      ? rollTable(tables.get("monastery-trait"), rng).value
      : null;

    // 7. Name — the house's proper name, rolled LAST so it never perturbs the
    //    earlier draws. Culture-aware via `race` (see monasteryName).
    const name = monasteryName(rng, tables.get("monastery-name"), { race });

    // Freeze — omit absent optional fields so the object stays clean. Steps 6/8
    // add library/relic/secret/catacombs onto this same object later.
    h.settlement.monastery = {
      name,
      dedication,
      selfSufficient: rule.selfSufficient,
      industries,
      ...(provisioning ? { provisioning } : {}),
      ...(trait ? { trait } : {}),
    };
  }
  return placedHexes;
}
