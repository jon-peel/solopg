# Phase 7.3 — Side-panel tabs (Detail | Hooks)

**Goal.** Split the side panel's two jobs into separate places without using more
screen space. Chosen from four mockups (tabs / split / drawer / window) — see
[`docs/prototypes/hooks-layout-mockup.html`](../prototypes/hooks-layout-mockup.html).
Browser-only; no schema change.

**Status:** ✅ done.

## What it does

- A **tab bar** under the world name: **Detail** | **Hooks**. Only one shows at a
  time, so the 320px column isn't split.
  - **Detail** = the selected hex's info (or, in the Dungeon View, the room
    detail) — `#selection`.
  - **Hooks** = the world hook list — `#global-hooks` — still fully actionable
    (→ Target / ↩ Origin / Follow-the-clue / Resolve / Ignore / Remove).
- The **Hooks tab shows an open-count badge** (hidden when zero).
- **Selecting a cell or room switches to Detail** (`setPanelTab("detail")` from
  `selectCell` / `onRoomClick`) — "click a thing → see the thing." Generating a
  hook doesn't yank you off Detail; it just bumps the badge.
- Empty state on the Hooks tab when there are none.

## How it's built

- `panel.js`: `showWorld` builds the tab bar + the two regions; `activeTab`
  module state + `applyPanelTab()` toggle a `.show-hooks` class on `#panel`;
  `setPanelTab()` exported. `renderGlobalHooks` drops the old `<details>`
  wrapper, renders an empty state, and updates `#hooks-tab-badge`.
- `css/app.css`: `.panel-tabs` + show/hide rules (`#panel #global-hooks` hidden
  by default; `#panel.show-hooks` flips which region shows). A
  `.panel-tabs .badge[hidden]` rule is needed so the `hidden` attribute wins over
  the badge's `display:inline-block`.
- `app.js`: imports `setPanelTab`; calls it on selection.

Verified headless: default Detail; switch to Hooks shows the list + empty state;
right-click/left-click a hex returns to Detail; the badge appears ("1") after a
hook is generated and the card lists. 202 `node --test` passing.

## Possible follow-ups

- Auto-open the Hooks tab when a hook is *created* (currently just badges it).
- Let the Hooks tab "pop out" into a floating window (mockup option D) if ever
  wanted.
