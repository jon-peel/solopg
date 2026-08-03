# solopg — Enhancements Batch 1 (implementation plan)

A pick-up-and-go spec for nine small enhancements. Each item is self-contained
(files, exact anchors, code sketches, tests, verification). Do them in any order
— **§5 (trade hook) is the only non-trivial one; the rest are ≤ ~30 lines each.**

## Conventions (read once)
- **Golden rule:** NO backward compatibility, NO data migration. New fields are
  additive; existing worlds are never migrated. No version stamps for back-compat.
- **Tests:** `npm test` (= `node --test test/*.test.js`). Baseline **691 pass / 0
  fail**. Every change keeps it green; add tests for any new pure logic.
- **App shape:** static browser app, ES modules, no build step. `js/gen/*` = pure
  generators (node-tested); `js/ui/*` = DOM/canvas. `logLine()` writes to the
  console only (relevant to §5's user feedback).
- **Run locally:** `./run-local.sh` (serves on :8000). Never open via `file://`.
- **Smoke test (headless):** serve, then load with Playwright
  (`require('/opt/node22/lib/node_modules/playwright')`, chromium is preinstalled,
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; do NOT run `playwright install`) and
  assert zero `console`/`pageerror` events (ignore the `favicon.ico` 404 until §1).
- **Commit style:** each item its own commit; body ends with the Co-Authored-By /
  Claude-Session trailers used on the branch. Do not open a PR unless asked.

---

## §1 — Add a favicon  🟢 tiny
**Goal:** kill the `GET /favicon.ico 404` on every boot; give the tab an icon.

**File:** `index.html` (the `<head>`, lines 3–8).

**Change:** add a self-contained inline-SVG favicon `<link>` right after the
`<title>` (line 6). No binary asset — a data-URI keeps the app dependency-free and
matches the CSP-free static setup. Suggested mark: a parchment-toned compass/rose
consistent with the map theme.
```html
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23e8dabb'/%3E%3Cpath d='M16 4l3 9 9 3-9 3-3 9-3-9-9-3 9-3z' fill='%238a3324'/%3E%3C/svg%3E" />
```
(Feel free to swap the glyph; the point is any inline SVG.)

**Tests:** none. **Verify:** boot smoke test shows **no** `favicon.ico` 404; the
tab shows the icon.

---

## §2 — Legend: document the settlement markers  🟢 tiny
**Goal:** the map legend keys terrain + POI dots but not the settlement glyphs
(size dots, ♜ keep, ✝ monastery). Add a "Settlements" section.

**Files:** `index.html` (legend markup ~line 119–129) and `js/ui/app.js`
(`buildLegendTerrain`/`buildLegendPoi`, lines 840–875).

**Changes:**
1. `index.html` — add a section container after `#legend-poi` (line 122):
   ```html
   <div class="legend-section" id="legend-settlements"></div>
   ```
2. `js/ui/app.js` — import the marks at the top (they live in `settlement-art.js`):
   ```js
   import { SETTLEMENT_MARK, KEEP_MARK, MONASTERY_MARK } from "./settlement-art.js";
   import { SIZE_ORDER } from "../gen/terrain-profile.js"; // if not already imported
   ```
   Add a builder mirroring `buildLegendPoi` and call it from `buildLegendTerrain`
   right after `buildLegendPoi()` (line 855):
   ```js
   function buildLegendSettlements() {
     const host = $("legend-settlements");
     if (!host) return;
     host.innerHTML = `<div class="legend-sub">Settlements</div>`;
     const row = (glyph, label) => {
       const r = document.createElement("div");
       r.className = "legend-row";
       const g = document.createElement("span");
       g.className = "lg-swatch";
       g.style.background = "transparent";
       g.textContent = glyph; // reuse the map's white-on-tile glyphs
       r.append(g, document.createTextNode(` ${label}`));
       host.appendChild(r);
     };
     for (const size of SIZE_ORDER) row(SETTLEMENT_MARK[size], size);
     row(KEEP_MARK, "Keep (fortified)");
     row(MONASTERY_MARK, "Monastery");
   }
   ```
   Call it inside `buildLegendTerrain` after `buildLegendPoi();`.

**Notes:** `.lg-swatch` is a small square; the glyphs are single chars, so setting
`textContent` renders them fine. If they look cramped, add a `.lg-glyph` variant in
`css/app.css` (inline-block, text-align:center, same box size as `.lg-swatch`).

**Tests:** none (DOM). **Verify:** open the 🗺 legend → a "Settlements" section
lists the four size dots + ♜ Keep + ✝ Monastery.

---

## §3 — Dungeon title glyph  🟢 tiny
**Goal:** show the theme glyph next to the Dungeon View title for quick ID.

**File:** `js/ui/app.js`, `openDungeonView` (the `$("dungeon-title").textContent`
line, ~1620).

**Change:** prepend `glyphForDungeon(theme)`.
```js
const theme = poi.detail.theme || dungeon.theme || "Dungeon";
$("dungeon-title").textContent = `${glyphForDungeon(theme)} ${theme} — ${dungeon.size}`;
```
Ensure `glyphForDungeon` is imported in app.js (it's exported from
`js/ui/poi-style.js`; check the existing poi-style import and add it if missing).

**Tests:** none. **Verify:** open a dungeon → title reads e.g. "🪦 Catacombs —
Sprawling". (The in-panel `renderDungeonPanel` header at panel.js:1008 uses
`dungeon.theme` for its own `<h3>`; optionally mirror the glyph there too for
consistency — same one-liner.)

---

## §4 — "Enter the catacombs" (relabel once built)  🟢 tiny
**Goal:** after a monastery's catacombs POI has been created (first explore), the
button should read **Enter** rather than **Explore**, and the "Has catacombs
beneath" line should itself be a way back in.

**Files:** `js/ui/app.js` (panel model near `onExploreCatacombs`, ~line 1061) and
`js/ui/panel.js` (the `.sel-monastery` catacombs button, ~line 884).

**Changes:**
1. `app.js` — add a flag to the selection model alongside `onExploreCatacombs`:
   ```js
   catacombsBuilt: !!(hex && hex.pois && hex.pois.some((p) => p.detail && p.detail.catacombs)),
   ```
2. `panel.js` — in the catacombs action row, switch the label and (optionally) make
   the "Has catacombs beneath" signal line clickable:
   ```js
   const enter = model.catacombsBuilt;
   row.appendChild(actionButton(enter ? "Enter the catacombs" : "Explore the catacombs", () => model.onExploreCatacombs()));
   ```
   For the clickable signal line, when `model.onExploreCatacombs` exists, render the
   "Has catacombs beneath" `monLine` as a button/link instead of static text (reuse
   `actionButton` with a link-style class, or add `role="button"` + a click handler).
   Keep it a no-op-safe call (onExploreCatacombs already find-or-creates the POI).

**Tests:** none (DOM). **Verify:** a monastery with catacombs shows "Explore the
catacombs"; after exploring once and returning, it reads "Enter the catacombs" and
re-opens the same interior.

---

## §5 — Monastery trade hook seed  🟡 small-medium (the meaty one)
**Goal:** a monastery's baked `industries` should feed the hook system — an
"opportunity" hook generated at (or on) a monastery hex should be for that house's
actual export ("a buyer seeks Whitethorn Abbey's wine") instead of a generic
`hook-commodity` roll.

**Files:** `js/gen/hooks.js` (`buildLocalHook`, ~line 193; `hookDescription`,
~line 319) and `js/ui/app.js` (`onGenerateHook` opportunity branch, ~line 2608).

**Background (verified):**
- `buildLocalHook(tables, rng, { kind:"opportunity"|"event", origin, index, source })`
  rolls `claim = hook-opportunity` and, for opportunity, `subjectName =
  hook-commodity`. The hook object carries `{ pattern, verb:kind, subject:{name},
  claim, … }`.
- `onGenerateHook` picks the opportunity branch and calls `buildLocalHook`.

**Changes:**
1. `hooks.js` `buildLocalHook` — accept optional `ctx.commodity` and
   `ctx.commoditySource`. When `kind==="opportunity"` and `commodity` is given, use
   it as the goods and skip the `hook-commodity` roll (draw NOTHING from that table
   so the rng stream only diverges when we intend it to — i.e. gate the roll):
   ```js
   if (ctx.kind === "opportunity") {
     claim = rollTable(tables.get("hook-opportunity"), rng).value;
     subjectName = ctx.commodity || rollTable(tables.get("hook-commodity"), rng).value;
   }
   ```
   Store the source on the hook when present so the description can name the house:
   ```js
   ...(ctx.commoditySource ? { commoditySource: ctx.commoditySource } : {}),
   ```
2. `hooks.js` `hookDescription` — in the `opportunity` branch, if
   `hook.commoditySource` is set, phrase it as the house's export, e.g.
   `"A buyer seeks ${hook.subject.name} from ${hook.commoditySource}."` (mirror the
   existing opportunity sentence; keep the non-source path byte-for-byte).
3. `app.js` `onGenerateHook` — in the opportunity/event branch, if the ORIGIN hex
   is a monastery, pass one of its industries as the commodity:
   ```js
   if (pattern === "opportunity" || pattern === "event") {
     const oh = getHex(current, origin.q, origin.r);
     const mon = oh && oh.settlement && oh.settlement.monastery;
     const trade = mon && pattern === "opportunity" && mon.industries && mon.industries.length
       ? { commodity: pick(subRng(current.seed, "hook-trade", origin.q, origin.r, n), mon.industries),
           commoditySource: mon.name }
       : {};
     hook = buildLocalHook(tables, rng, { kind: pattern, origin, index: n, source: opts.source, ...trade });
   }
   ```
   (`pick` from `../core/rng.js`; import if not already. Use a dedicated
   `subRng(...,"hook-trade",...)` sub-stream so the main hook rng is unperturbed and
   the pick is deterministic.)

**Decision to confirm with the owner:** whether the seed fires only when the origin
IS a monastery (spec above), or also when a monastery is within N hexes of the town.
Default to "origin is a monastery" (simplest, deterministic); note the nearby-radius
variant as a follow-up.

**Tests:** `test/hooks.test.js` —
- `buildLocalHook` with `commodity:"wine"` → `hook.subject.name === "wine"` and no
  dependence on `hook-commodity`; with `commoditySource` set, `hookDescription`
  names the source; without either, output is unchanged (regression).
- Determinism of the app-side pick is covered by the pure `pick`/`subRng`; add a
  focused test that a monastery's industry list yields a stable choice for a fixed
  seed/coord if you extract the selection into a tiny pure helper.

**Verify:** generate an opportunity hook at a monastery town (radial → World → Hook
→ Generate hook) → the hook names the abbey's actual export.

---

## §6 — Tier pips on the bestiary  🟢 tiny
**Goal:** show each monster's danger tier at a glance (the bestiary already carries
`tier` from `rankBestiary`).

**File:** `js/ui/panel.js`, the Monsters-list loop (the `bestiary` `for` loop,
~lines 1021–1033).

**Change:** add a small pip helper and prefix each row. Elite (tier 5) already gets
the ☠ deadliest flag; use pips for 1–4 and keep ☠ for the apex.
```js
const tierPips = (t) => (t >= 5 ? "☠" : t >= 1 ? "•".repeat(t) : "");
// inside the loop, before composing textContent:
const pips = m.deadliest ? "☠" : tierPips(m.tier);
li.textContent = `${pips ? pips + " " : ""}${m.name} — ${m.floors.map((f) => "L" + f).join(", ")}${m.deadliest ? " · the deadliest" : ""}`;
```
Optionally colour the pips by tier via a `<span>` with a class (`.tier-1..4`) if you
want a visual ramp; text pips alone are fine to start.

**Tests:** if you extract `tierPips` to `bestiary.js` and export it, add a 1-line
unit test (1→"•", 3→"•••", 5→"☠", 0→""). Otherwise none.
**Verify:** the Monsters list shows `••• Wights — L3, L4`, `☠ Death Knight …`.

---

## §7 — Richer hover  🟢 tiny
**Goal:** the hex tooltip shows name/region/faction; add the settlement **rank**
and a **POI count**.

**File:** `js/ui/map.js`, the hover block (~lines 347–366, where `lines` is built).

**Change:** after the settlement-name line, add rank + POI count lines. Import
`MONASTERY_RANK` from `../gen/monastery.js` for the monastic rank.
```js
if (hh.settlement && hh.settlement.present) {
  const s = hh.settlement;
  const rank = s.kind === "monastery" ? (MONASTERY_RANK[s.size] || "Monastery")
             : s.kind === "keep" ? `${s.size} keep`
             : s.size;
  lines.push({ text: rank, color: "…" }); // match the existing meta line colour
}
const poiCount = (hh.pois || []).length;
if (poiCount) lines.push({ text: `${poiCount} POI${poiCount > 1 ? "s" : ""}`, color: "…" });
```
Match the `{text, color}` shape and muted colour the existing hover lines use (copy
from the region/faction lines already there).

**Tests:** none (canvas). **Verify:** hover a monastery → shows its rank ("Abbey")
and "2 POIs"; hover a plain town → shows the size + POI count.

---

## §8 — Keep panel parity  🟢 tiny (but needs a content decision)
**Goal:** a keep currently shows only "`<size> — Keep (fortified)`" with no detail
block; give it a small parallel to the monastery block.

**File:** `js/ui/panel.js`, the settlement callout (after the meta line, alongside
the `hex.settlement.monastery` block, ~lines 828–855).

**Design (derived — no schema change):** a keep has no baked data object, so derive
a one-line garrison descriptor from size, plus the holding faction if the hex is
faction-owned. Add a block only when `hex.settlement.kind === "keep"`:
```js
if (hex.settlement.kind === "keep") {
  const GARRISON = { Hamlet: "a small watch", Village: "a standing garrison",
                     Town: "a full garrison", City: "a war-garrison" };
  const line = GARRISON[hex.settlement.size] || "a garrison";
  // reuse the .sel-monastery/.sel-mon-line pattern for a single muted line
  // "Garrison: a full garrison" (+ " · held by <faction>" if model.culture/faction owner known)
}
```
**Decision to confirm with the owner:** the garrison wording, and whether to also
show the **holding faction** (the panel already knows faction ownership via the
radial/`factionAt`; thread a `holder` name into the model if wanted). Keep it
derived and additive; no new stored fields. If richer keep content is desired
(a named warden, a defining feature), that's a larger follow-up — flag it, don't
build it here.

**Tests:** none (DOM) unless a pure helper is extracted. **Verify:** select a keep
→ a "Garrison: …" line appears under the meta.

---

## §9 — Unify the accent callouts  🟢 tiny (CSS + light panel touch)
**Goal:** the GM-note callouts use slightly different styling/reds:
`.research-result`/`.research-line`, `.sel-situation`, `.bestiary-apex`,
`.sel-mon-secret`. Pin them to one shared base so the panel reads consistently.

**Files:** `css/app.css` (the rules at 869, 873–877, 899–906, 1509) and
`js/ui/panel.js` (add the shared class where these are created).

**Change:**
1. `css/app.css` — add a base:
   ```css
   .gm-note { margin-top: 0.4rem; padding: 0.4rem 0.55rem; border-radius: 6px;
     font-size: 0.85rem; font-style: italic; line-height: 1.35;
     background: var(--gold-wash); color: var(--ink); }
   ```
   Then have the specific callouts extend it, keeping only their accent difference
   (e.g. `.gm-note.is-danger { background: transparent; color: #8a3324; padding-left: 0; }`
   for the apex/secret lines, which read as inline warnings rather than boxes).
   Reduce the four bespoke rules to `@extend`-style overrides (plain CSS: add the
   `.gm-note` class in markup and keep a thin modifier rule).
2. `js/ui/panel.js` — add `gm-note` (and a modifier where needed) to the elements:
   - research result → `className = "gm-note"` (drop the near-duplicate
     `.research-result` box; keep `.research-line` for the text or fold in).
   - situation callout → `gm-note` + keep the `.situation-refresh` button rule.
   - `.bestiary-apex` and `.sel-mon-secret` → `gm-note is-danger` (inline red).

**Care:** this touches several render sites — verify each callout still renders (the
smoke test + a visual pass on the dungeon panel, a town situation, a monastery card,
and a monastery secret). Keep the reds (`#8a3324`) for danger/secret and the gold
wash for research/situation.

**Tests:** none (CSS). **Verify:** research, situation, apex and secret lines share a
consistent shape; danger/secret stay red, research/situation stay gold.

---

## Suggested order & batching
1. **Trivial, independent, no-risk:** §1 favicon, §3 dungeon glyph, §6 tier pips,
   §7 hover, §2 legend, §4 enter-catacombs. (Each a single small commit.)
2. **Content decisions:** §8 keep parity (garrison wording / holder), then
   §9 callout unification (visual pass).
3. **Last, largest:** §5 monastery trade hook (touches hooks.js + app.js + tests;
   confirm the "origin-is-monastery vs nearby-radius" decision first).

Every step: keep `npm test` green, boot smoke-test for no console errors, commit
individually. No PR unless requested.
