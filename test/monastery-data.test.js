import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateTable } from "../js/core/table.js";
import { RACE_MONASTERY_PRODUCTS } from "../js/gen/culture-data.js";

const read = (id) => JSON.parse(readFileSync(`./data/${id}.json`, "utf8"));

const STRING_TABLES = [
  "monastery-product",
  "monastery-trait",
  "monastery-provisioning",
  "monastery-secret",
  "monastery-relic",
];
const ALL_TABLES = [...STRING_TABLES, "monastery-name"];
const MIN_ENTRIES = {
  "monastery-product": 40,
  "monastery-name": 30,
  "monastery-trait": 10,
  "monastery-provisioning": 12,
  "monastery-secret": 18,
  "monastery-relic": 20,
};

// 1. All six tables validate, id === filename, and are stocked to size.
test("all monastery tables validate, are self-identified, and meet minimum size", () => {
  for (const id of ALL_TABLES) {
    const table = read(id);
    assert.doesNotThrow(() => validateTable(table), `${id} failed validateTable`);
    assert.equal(table.id, id, `${id}: id field must equal filename stem`);
    assert.ok(
      table.entries.length >= MIN_ENTRIES[id],
      `${id} has ${table.entries.length} entries, want >= ${MIN_ENTRIES[id]}`,
    );
  }
});

// 2. Every entry weight (where present) is a number > 0.
test("every monastery-table weight, where present, is a positive number", () => {
  for (const id of ALL_TABLES) {
    for (const e of read(id).entries) {
      if ("weight" in e) {
        assert.equal(typeof e.weight, "number", `${id}: non-number weight`);
        assert.ok(e.weight > 0, `${id}: weight ${e.weight} must be > 0`);
      }
    }
  }
});

// 3. String tables carry unique, non-empty string values.
test("string monastery tables hold unique, non-empty string values", () => {
  for (const id of STRING_TABLES) {
    const values = read(id).entries.map((e) => e.value);
    for (const v of values) {
      assert.equal(typeof v, "string", `${id}: value ${JSON.stringify(v)} is not a string`);
      assert.ok(v.length > 0, `${id}: has an empty string value`);
    }
    assert.equal(new Set(values).size, values.length, `${id}: has duplicate values`);
  }
});

// 4. Product convention: bare lowercase noun phrases, no leading article.
test("monastery-product values are lowercase and carry no leading article", () => {
  for (const v of read("monastery-product").entries.map((e) => e.value)) {
    assert.equal(v, v.toLowerCase(), `product "${v}" is not lowercase`);
    assert.ok(
      !/^(a |an |the )/.test(v),
      `product "${v}" must not start with an article`,
    );
  }
});

// 5. monastery-name: class-tagged object values, per-class coverage & uniqueness.
test("monastery-name values are class-tagged and meet per-class coverage", () => {
  const CLASSES = new Set(["house", "saint", "virtue", "colour"]);
  const byClass = { house: [], saint: [], virtue: [], colour: [] };
  for (const e of read("monastery-name").entries) {
    const v = e.value;
    assert.equal(typeof v, "object", "name value must be an object");
    assert.ok(v && CLASSES.has(v.class), `bad name class ${JSON.stringify(v && v.class)}`);
    assert.equal(typeof v.text, "string", "name text must be a string");
    assert.ok(v.text.length > 0, "name text must be non-empty");
    byClass[v.class].push(v.text);
  }
  // text unique within each class
  for (const cls of CLASSES) {
    const texts = byClass[cls];
    assert.equal(new Set(texts).size, texts.length, `${cls}: duplicate text`);
  }
  // all seven house types present
  for (const h of ["Abbey", "Priory", "Cloister", "Hermitage", "Friary", "Charterhouse", "Grange"]) {
    assert.ok(byClass.house.includes(h), `missing house type "${h}"`);
  }
  assert.ok(byClass.saint.length >= 12, `saints: ${byClass.saint.length}, want >= 12`);
  assert.ok(byClass.virtue.length >= 10, `virtues: ${byClass.virtue.length}, want >= 10`);
  assert.ok(byClass.colour.length >= 6, `colours: ${byClass.colour.length}, want >= 6`);
});

// 6. monastery-secret _note flags it as GM/discovery-only, never in the panel.
test("monastery-secret _note marks it GM/discovery-only", () => {
  const note = read("monastery-secret")._note;
  assert.equal(typeof note, "string");
  assert.match(note, /GM|never .*panel|player/i);
});

// 7. RACE_MONASTERY_PRODUCTS is the four demihuman races only, well-formed.
test("RACE_MONASTERY_PRODUCTS: exactly dwarf/elf/halfling/gnome, no human, valid multipliers", () => {
  assert.deepEqual(Object.keys(RACE_MONASTERY_PRODUCTS).sort(), ["dwarf", "elf", "gnome", "halfling"]);
  assert.equal(RACE_MONASTERY_PRODUCTS.human, undefined);
  for (const [race, map] of Object.entries(RACE_MONASTERY_PRODUCTS)) {
    assert.equal(typeof map, "object", `${race} map is not an object`);
    assert.ok(Object.keys(map).length > 0, `${race} map is empty`);
    for (const [product, mult] of Object.entries(map)) {
      assert.ok(Number.isFinite(mult) && mult > 0, `${race}.${product} multiplier ${mult} must be finite > 0`);
    }
  }
});

// 8. Bias sync: every keyed product exists in monastery-product.
test("RACE_MONASTERY_PRODUCTS keys all exist in monastery-product", () => {
  const products = new Set(read("monastery-product").entries.map((e) => e.value));
  for (const [race, map] of Object.entries(RACE_MONASTERY_PRODUCTS)) {
    for (const product of Object.keys(map)) {
      assert.ok(products.has(product), `${race} keys unknown product "${product}"`);
    }
  }
});

// 9. Signature leanings: each race leans its three signature products (> 1x).
test("RACE_MONASTERY_PRODUCTS: each race leans its signature products above 1x", () => {
  const signatures = {
    dwarf: ["iron tools", "stonework", "strong ale"],
    elf: ["wine", "fine woodwork", "illuminated manuscripts"],
    halfling: ["cheese", "beer", "preserves"],
    gnome: ["beeswax candles", "inks", "clockwork trinkets"],
  };
  for (const [race, sigs] of Object.entries(signatures)) {
    const map = RACE_MONASTERY_PRODUCTS[race];
    for (const product of sigs) {
      assert.ok(product in map, `${race} missing signature product "${product}"`);
      assert.ok(map[product] > 1, `${race}.${product} multiplier ${map[product]} must be > 1`);
    }
  }
});
