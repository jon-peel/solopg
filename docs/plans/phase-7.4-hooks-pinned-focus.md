# Phase 7.4 — Pinned hooks, kebab actions, select-to-highlight

Extends the hooks panel (7.3). Browser-only; `hooks[].pinned` is additive (absent
= unpinned), so **no schema bump** — old worlds and exports load unchanged.

**Status:** ✅ done.

## What changed

- **Pinned tab.** A third side-panel tab. A hook's **Pin / Unpin** button moves it
  between the **Hooks** list (unpinned) and the **Pinned** list (the party's
  chosen leads). Pinned hooks are filtered *out* of the Hooks tab. Both tabs carry
  a count badge (Hooks = open-unpinned count; Pinned = pinned count).
- **Kebab "…" menu per card.** *Go to target*, *Go to origin*, and *Remove* moved
  into an overflow menu (reusing the `.menu`/`.menu-list` dropdown), so the visible
  row stays tidy (Pin / Resolve / Ignore / Follow-the-clue). The jumps recenter the
  map — handy when it's large.
- **Select-to-highlight.** Clicking a hook card selects it (toggles); the map rings
  its **target (red)** and **origin (teal)** with corner T/O badges, and the card
  shows a small colour legend. Selection is UI-only (not persisted); cleared by
  re-clicking, selecting another, switching worlds, or the hook being removed.

## How it's built

- `js/ui/map.js`: `setHookFocus({target, origin}|null)` + `drawHookFocus` draw the
  two coloured rings/badges (under the blue cell cursor). Distinct from the amber
  open-hook markers.
- `js/ui/panel.js`: three-tab state toggles region `hidden` (`#selection` /
  `#global-hooks` / `#pinned-hooks`); `renderGlobalHooks` splits hooks into the two
  lists via `renderHookList` and sets both badges; `hookCard` gains select +
  Pin/Unpin + a `hookKebab`.
- `js/ui/app.js`: `selectedHookId` state; `onSelectHook` (toggle + `refreshHookFocus`),
  `onPinHook` (toggle `pinned` + persist), `refreshHookFocus`. Hook selection clears
  on world load.
- `css/app.css`: `.hook.selected`, `.hook-legend` dots, `.menu.kebab`.

Verified headless: 3 tabs; row = Pin/Resolve/Ignore (Target/Origin live in the
kebab); Pin moves a hook Hooks→Pinned (badges update) and **persists across
reload**; selecting a card sets `.selected` + legend. 202 `node --test` passing.

## Offered follow-ups (not yet built)

- Persistent distinct map marker on **pinned** targets (see active leads without
  selecting).
- A faint **origin → target line** when a hook is selected.
- **Resolving a pinned hook auto-unpins** it.
- **Esc** clears the hook highlight.
