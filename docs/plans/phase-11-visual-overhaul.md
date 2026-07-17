# Phase 11 — Visual & UX Overhaul (master plan overview)

A deliberate re-skin + IA (information-architecture) pass to move the app from a functional
"dev-tool" look to a cohesive **cartographer's** identity, and to settle the action model
(radial = the single hex-action surface) and the sidebar's role (a read/navigate **overview**,
not a per-hex editor).

**Pulled ahead of Phases 9–10 at the user's request** ("before we continue"). It **absorbs/supersedes**
several queued Phase 10 items — **10.6 themes**, **10.8 art**, and the touch half of **10.2** — and adds
new work (faction legend + detail, faction hex shading, radial consolidation, sidebar overview) that
wasn't previously scheduled.

## What's in scope (from the picked list)

| Source | Item |
|---|---|
| 1 | Cartographer's theme (the umbrella identity — realized across 11.1/11.2/11.4/11.6) |
| 3 | Typography system |
| 4 | Terrain-art upgrade (hand-inked/hachured tiles, inked hex borders, 3rd variant) |
| 7 | Map-chrome & command-bar polish |
| 11 | Responsive + touch layout |
| 12 | Dungeon-view restyle |
| 13 | Faction territory rendering |
| 14 | Accessibility pass |
| +A | Faction **legend** (swatch + name, map-legend style); click → **detail window** |
| +B | Faction hexes **shaded / hatched** (not just a ring) |
| +C | **All hex-scoped commands live in the radial**, out of the sidebar |
| +D | **Sidebar becomes an overview** (proposals below) |

## Guiding principles (the north star)

- **One identity, two palettes.** A parchment/vellum "old map" light theme and a refined dark
  "grimoire" theme, both driven from a single token set. Inked linework, aged edges, map typography.
- **Presentation-only — no schema bump.** Nothing here changes world data. Theme choice is a UI
  preference (localStorage), not part of the saved world. Import/export and `schemaVersion` are
  untouched. (Faction *colours* are already derived from index, not stored — keep it that way.)
- **Honour the hard conventions.** No build step, no npm runtime deps, ES modules over HTTP, offline.
  Fonts ship as **local `woff2` files** (SIL-OFL, a static asset — not a dependency), with a
  system-serif fallback stack if we'd rather bundle nothing.
- **Test what's pure, checklist what's canvas/DOM.** Palette contracts, WCAG-contrast helpers, and
  faction-colour assignment are node-tested; the visual result is verified with a per-step manual
  checklist via `./run-local.sh` (the standing loop in `PLAN.md`).
- **The action rule.** Hex/POI/dungeon-scoped commands → **radial**. World/session/global commands →
  **command bar**. Read-only detail + results → **sidebar**.

## Order (and why this order)

Dependency- and risk-driven, not by picked-list number:

1. **Foundation must come first** — every later step reads from the token set and the centralized
   canvas palette.
2. **The map surface anchors the identity** — chrome and the faction layer are drawn *on top of* the
   map, so getting base terrain colours/ink right first avoids re-tuning them twice.
3. **Chrome before the faction layer** — the faction legend needs a styled home.
4. **Faction layer before the sidebar/radial IA change** — the redesigned sidebar *hosts* the faction
   legend + detail, so build the content it must present first.
5. **Radial + sidebar IA is the biggest structural change** — do it once the visual language and the
   faction content are settled.
6. **Dungeon restyle is self-contained** — slot it after the main map/IA work.
7. **Responsive, then accessibility, as closing passes** — both are easiest to consolidate against a
   finished design; the a11y *tokens* (focus rings, contrast-safe colours) are seeded back in 11.1 so
   accessibility isn't bolted on only at the end.

| Step | Title | Picked items | Kind |
|---|---|---|---|
| **11.1** | Design foundation — tokens, palette, typography | 1, 3, 14(tokens) | CSS + a new `theme.js`; pure palette test |
| **11.2** | Terrain art & the map surface | 4, 1(on-map) | assets + `map.js` render; manual |
| **11.3** | Map chrome & command bar | 7 | CSS/DOM; manual |
| **11.4** | Faction layer — shaded territory + legend + detail | 13, +A, +B | canvas + UI; pure colour test |
| **11.5** | Radial consolidation + sidebar overview | +C, +D | IA across `radial-*`, `panel.js`, `app.js`; manual |
| **11.6** | Dungeon & tower view restyle | 12 | `dungeon-map.js` + CSS; manual |
| **11.7** | Responsive & touch | 11 | CSS + input handling; manual |
| **11.8** | Accessibility close-out | 14(rest) | keyboard/ARIA/contrast; manual |

## Steps in detail

### 11.1 — Design foundation: tokens, palette, typography
- A CSS custom-property **design system**: semantic tokens (`--surface`, `--ink`, `--edge`,
  `--accent`, `--danger`, elevation, radii, spacing) with a **parchment** and a **grimoire** value set;
  a **type scale**; a **focus-ring** token.
- Bundle **1–2 OFL fonts** locally (a display/old-map face for headings + a readable body face) via
  `@font-face` over `assets/fonts/*.woff2`; fall back to a system serif stack.
- New **`js/ui/theme.js`** — the *single* source for canvas colours (terrain fills, faction palette,
  routes, party, hooks, selection). `terrain-style.js` / `poi-style.js` re-export from it. This is the
  hinge that lets the parchment/grimoire switch **and** a colour-blind-safe map be one change.
- Reskin existing chrome (bar, buttons, panel, menus, overlays) onto the tokens — **structure
  unchanged**. A visible, low-risk first win. Wire a **theme toggle** to a localStorage pref.
- **Verify:** node test for the palette contract + a WCAG-contrast helper; manual checklist for the
  reskin + toggle + reload persistence of the pref.

### 11.2 — Terrain art & the map surface
- New **hand-inked / hachured** terrain tiles (mountains, hills, coast, forest, swamp, desert), a
  **3rd variant** per terrain, **inked hex borders**, a parchment base fill and a subtle paper texture.
- Old-map **water/coast treatment** (hachure or line-shading).
- Keep the existing **deterministic per-hex variant** selection (`hashString` in `map.js`).
- **Verify:** manual visual checklist across every terrain, the zoom **LOD tiers** (sketch → simplified
  → none) and the **Icons** toggle; confirm fills stay distinguishable under the colour-blind palette.

### 11.3 — Map chrome & command bar
- Reframe legend / readout / scale / map-controls / help into **consistent framed (or glass) floating
  clusters** on the new tokens. Add a **zoom slider**; *(stretch)* a minimap.
- **Regroup the command bar** into clusters — **world** (New/Save/Delete/Export/Import) · **session**
  (Day/Progress) · **view** (Icons/Labels/Theme) — as icon buttons + tooltips, with an overflow menu.
- **Verify:** manual checklist per control; bar stays usable as width shrinks (sets up 11.7).

### 11.4 — Faction layer: shaded territory + legend + detail
- **Canvas:** replace the per-hex coloured **ring** (`drawFactionMark`) with **filled / hatched
  territory** per faction (shaded fill; **seat emphasized**; an **inked sphere-of-influence border**;
  optional label). Colours are **stable per-faction, colour-blind-safe**, assigned by a small pure
  helper (node-testable) rather than raw index → colour.
- **Legend (+A):** a **map-legend-style list** — swatch + name (+ a mini strength/goal indicator) per
  faction; **hover → highlight** that faction's territory; **click → open the faction detail window**
  (a floating detail card, or the sidebar's detail slot — decided in 11.5).
- **Shaded/hashed hexes (+B):** the fill style above; hatch pattern as the colour-blind-safe
  differentiator so two adjacent factions never rely on hue alone.
- **Verify:** node test for faction-colour assignment (stable + distinct); manual checklist for
  shading/hatching at all zooms, legend hover-highlight, and click → detail.

### 11.5 — Radial consolidation + sidebar overview
- **+C:** move the **remaining hex-scoped actions out of the sidebar** into the radial (the ones still
  in the Detail tab — e.g. **Promote to faction**, POI add/remove). The radial already owns
  terrain/POI/settlement/hook/generate/regenerate/delete/draw, so this closes the gap. Apply **the
  action rule** consistently.
- **+D:** rebuild the sidebar as an **overview dashboard** (proposals below). Selection becomes a
  **read-only card** with a **"⋯ Actions"** button that **opens the radial at that hex** — so the radial
  is the one action surface but is still reachable **without a right-click** (key for touch + a11y).
- The **faction legend + detail** from 11.4 docks here as the **Factions** section.
- **Verify:** manual checklist — *every* former sidebar action is reachable via the radial; each
  overview section renders; selection → "⋯ Actions" opens the radial on the right hex.

### 11.6 — Dungeon & tower view restyle
- Parchment/inked **dungeon aesthetic**: textured floors, inked walls, clearer door/stair glyphs, and
  the raw hex-swatch legend (`index.html` `#dungeon-legend`) rebuilt on tokens. Match the world map's
  identity so the two views read as one product.
- **Verify:** manual checklist across a multi-level dungeon **and** a tower — legend, Fit, level switch.

### 11.7 — Responsive & touch
- Adapt the fixed `1fr / 320px` grid for tablet: **collapsible / overlay sidebar**, larger hit targets,
  **long-press to open the radial**, verify pinch-zoom and drag-pan on touch.
- **Verify:** manual checklist on a narrow viewport / touch emulation.

### 11.8 — Accessibility close-out
- Visible **focus rings**, full **keyboard navigation** (radial arrow-rotate + Enter — overlaps the
  keyboard half of old 10.2), **ARIA** roles on the radial / menus / dialogs, `prefers-reduced-motion`,
  and a **final contrast + colour-blind audit** across the finished skin.
- **Verify:** keyboard-only walkthrough checklist; contrast audit.

## Sidebar overview — proposals (+D)

Once every per-hex action moves to the radial, the sidebar stops being an editor and becomes a
**read / navigate dashboard**. Three shapes:

**Option A — single scrollable "World Overview" with collapsible sections *(recommended)***
- **World** — name, size, region count; quick stats (explored hexes, POIs, dungeons).
- **Session** — day clock, party status, Progress, travel log.
- **Factions** — the legend list (swatch + name + mini bar); hover → highlight, click → detail.
- **Hooks** — the existing open-hooks list.
- **Selection** — read-only card for the selected hex/POI (name, terrain, region, occupant, notes) +
  **"⋯ Actions" → opens the radial**.
- *Why:* least disruption to the existing tab/section code, answers "overview" directly, keeps
  everything visible. Retain the tab bar as a secondary affordance so it can degrade to Option B on
  small screens in 11.7.

**Option B — tabbed overview** (evolve the current `Detail | Hooks | Pinned | Travel | Factions` tabs
into `Overview | Factions | Hooks | Selection | Log`). Cleaner as content grows; one thing at a time.

**Option C — icon rail + context pane** — a slim left rail switches what fills the panel; selection
detail is contextual. Most "app-like," biggest change.

## Cross-cutting notes

- **Risk — canvas re-theming touch points:** terrain fills, faction colours, routes, party, hooks, and
  selection are each read in `map.js` / `dungeon-map.js`. 11.1's `theme.js` centralization is what keeps
  the re-skin from becoming a scatter of magic hex strings.
- **Risk — radial as the sole action surface:** it must be *fully* reachable — right-click, long-press
  (11.7), and the selection card's "⋯ Actions" button (11.5). No action may become orphaned.
- **Risk — hatched fills at scale:** cache hatch patterns (canvas `createPattern`) so large worlds
  (Huge = 700+ hexes) stay smooth.
- **Fonts/licensing:** OFL only, bundled locally; record the license under `assets/fonts/`.
- **Accessibility is woven in, not bolted on:** contrast-safe + colour-blind tokens land in 11.1;
  11.8 is the audit, not the first time a11y is considered.

## How this threads into `PLAN.md`

Added to the roadmap as **Phase 11 — Visual & UX Overhaul (▶ in planning, pulled ahead of 9–10)**.
It supersedes Phase 10's **10.6 (themes)** and **10.8 (art)** and the touch half of **10.2**; those rows
in `phase-10-backlog.md` should be marked "folded into Phase 11" when this starts. Each step still ends
with the standard manual-verification checklist handed to the user before moving on.
