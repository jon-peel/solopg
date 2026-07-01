# Phase 7.1 — Right-click radial menu

**Goal.** Make worldbuilding fast and on-map: right-click any tile to act on it
without round-tripping to the side panel. First slice of Phase 7 (QoL & UX).

**Status:** ✅ done. No schema change (pure UI). Reuses every existing `app.js`
handler unchanged. Prototype that was signed off:
[`docs/prototypes/radial-menu.html`](../prototypes/radial-menu.html).

## What it does

- **Right-click a tile** → a ring menu opens at the cursor (the cell is also
  selected, so the side panel stays in sync).
- **Submenus open as a second outer ring** — the base ring dims, the chosen
  parent stays lit, so you keep context. A submenu's **"Random"** option is
  anchored at the parent's angle (the outer slot nearest the cursor) so it's
  always the least-travel pick.
- **Center hub** = Back inside a submenu, Close at the top level. **Esc** and
  **click-away** also dismiss; right-clicking again dismisses too.

## Fixed slots, disabled-not-hidden (the two rules)

The ring is a **fixed set of 8 slots in a fixed order**, so each action always
lives in the same place. Actions that don't apply to the current cell are
**greyed out (disabled), never removed** — you can always see what *should* be
there, with the reason on hover (`title`).

| Slot | Submenu / leaf | Enabled when | Disabled reason shown |
|---|---|---|---|
| Terrain | Random + 7 terrains | always (place / replace) | — |
| POI | Random + 5 types + Remove (per existing POI) | placed | "Place terrain on this hex first" |
| Settlement | Random/Remove + allowed sizes | placed & terrain allows, **or** one present | "No settlement can sit on `<terrain>`" |
| Hook | Generate hook / Read map / Follow a trail | always (gossip child gates on a settlement) | child: "Heard only in a settlement" |
| Neighbours | leaf | placed & ≥1 empty neighbour | "All neighbours already filled" |
| Regenerate | leaf | placed | "Place terrain on this hex first" |
| Delete | leaf | placed | "Nothing here to delete" |
| Generate | leaf | empty | "Already here — use Regenerate" |

The fully-surrounded "Neighbours" case is the canonical example: the slot stays
put and greys out instead of disappearing.

## Architecture

- **`js/ui/radial-model.js`** — *pure*. `buildRadialModel(state)` → the fixed
  slot tree with `enabled`/`reason`/`anchor` flags, plus `ringCenter(clientX,
  clientY, rect, pad)` (centers the ring on the click, clamped to the host box;
  falls back to raw coords for a zero/hidden box). No DOM, no app state →
  **node-tested** (`test/radial-model.test.js`).
- **`js/ui/radial-menu.js`** — browser-only overlay. `openRadial({clientX,
  clientY, model, dispatch})` / `closeRadial()`. Lays the ring out with trig,
  renders disabled/parent/dim states, anchors Random, routes picks to
  `dispatch(id, value)`.
- **`js/ui/map.js`** — `contextmenu` resolves the cell under the cursor and
  reports `{q, r, clientX, clientY}`; `pointerdown` now pans on the **primary
  button only** so the right button is free for the ring.
- **`js/ui/app.js`** — `onContextMenu` builds the model from the selected hex's
  state and opens the ring; `radialDispatch(id, value)` maps a pick to the
  existing handler (`onPlaceTerrain`, `onAddPoi`, `onGenerateNeighbors`, …).
- **`index.html` / `css/app.css`** — `#ring` overlay container + ring styles
  (incl. `.ring-node.disabled`).

## Deliberate simplifications (refine later if wanted)

- ~~**Dungeon size** isn't a third ring; "POI → dungeon" adds a random-size
  dungeon.~~ **Done:** "POI → dungeon" now opens a third ring of sizes (Random
  + each size from the `dungeon-size` table); the overlay was generalised to
  arbitrary nesting depth. Falls back to a random-size leaf if no sizes load.
- **Glyphs are emoji** (matching the prototype); the canvas keeps its own art.
- Keyboard/touch parity (long-press, arrow-to-rotate) is out of scope here; the
  side panel remains the full accessible path.

## Panel cleanup (follow-on)

With the radial menu owning every mutation, the side panel was stripped to
**read & navigate** only:

- **Selection panel** (`renderSelectionPanel`) now shows just the cell's info —
  terrain, a settlement line, and POIs as a clickable list (click to inspect, or
  open a dungeon/tower interior). No add/remove/regenerate/delete/settlement/hook
  buttons. A muted hint points at the right-click menu.
- **POI removal** moved into the radial (POI submenu → 🗑 per existing POI), so
  the panel has no action buttons at all. POI *creation* was already there.
- **Open hooks** remain a separate, always-visible list
  (`renderGlobalHooks`) that stays actionable (→ Target / ↩ Origin /
  Follow-the-clue / Resolve / Ignore / Remove) — there's no radial home for hook
  management.
- The **Dungeon View** room panel keeps its stair-nav, exploration toggles, and
  note (dungeon-only; the radial is world-map only).
- The old growing **event log** was removed earlier in Phase 7 (events now go to
  the browser console); a static Seed / Hex-scale footer remains.

So the panel is now two things: **one place for current-cell (or room) info**,
and **one place for the open-hooks list**. Removed dead panel code: the
add-POI / add-dungeon / add-settlement / place-terrain dropdown builders.

## Manual test checklist

- [ ] Right-click an **empty** tile → ring opens; Generate / Place / Hook are
  enabled; POI / Settlement / Neighbours / Regenerate / Delete are greyed (hover
  shows a reason).
- [ ] Right-click a **placed** tile → those are enabled; Generate is greyed.
- [ ] **Terrain ▸** → outer ring; **Random** sits right under the cursor; pick a
  terrain → tile updates (panel matches).
- [ ] Surround a hex on all six sides → its **Neighbours** slot is greyed
  ("All neighbours already filled").
- [ ] **Water** tile → **Settlement** greyed; add one elsewhere → its Settlement
  submenu offers **Remove**.
- [ ] **Hook ▸** on a non-settlement → "Generate hook" greyed; in a town →
  enabled. Read map / Follow a trail work anywhere.
- [ ] Center hub Backs out of a submenu and Closes at the top; **Esc** and
  click-away dismiss; **left-drag still pans**, right-drag does not.
- [ ] Reload → world persists (the menu changes nothing about storage).
