# Enhancements Batch 1 — test & approval checklist

Branch: `claude/enhancements-batch-1-qhjpab` · 9 commits · `npm test` 699 pass / 0 fail

---

## 0. Setup

> ⚠️ **Do not use `./run-local.sh`.** It still has `BRANCH="claude/phase-15-breakdown-muv6e9"`
> hardcoded and does a `git reset --hard` to it — it would wipe this branch's work and
> serve the wrong code. Use the manual steps below instead.

- [ ] `git fetch origin claude/enhancements-batch-1-qhjpab`
- [ ] `git checkout claude/enhancements-batch-1-qhjpab && git pull`
- [ ] `npm test` → **699 tests, 699 pass, 0 fail** (baseline was 691; +8 new)
- [ ] `python3 -m http.server 8000` then open `http://localhost:8000` — **never** open via `file://`
- [ ] Open DevTools → Console. Leave it open for the whole pass. It should stay **empty**.
- [ ] Generate a world (any seed/size). A **Large** world gives the best odds of finding a keep and a monastery.

---

## §1 — Favicon `2ea1c25`

- [ ] The browser tab shows a **parchment tile with a dark red compass star** (not the blank globe)
- [ ] DevTools → Network → reload → there is **no `favicon.ico` 404**
- [ ] View source: the icon is an inline `data:image/svg+xml` URI in `<head>` — no new binary asset in the repo

---

## §2 — Settlement legend `78b30a1`

- [ ] Click the 🗺 legend button
- [ ] There is **exactly one** "Settlements" section (the old static one was *replaced*, not added to — check you don't see two)
- [ ] It lists six rows, in this order, with the glyphs column-aligned:
  - [ ] `•` Hamlet
  - [ ] `●` Village
  - [ ] `◆` Town
  - [ ] `★` City
  - [ ] `♜` Keep / fort
  - [ ] `✝` Monastery
- [ ] **No** explanatory note under the rows — just the six marks
- [ ] Under **Marks**, the encounter row reads plainly `★ Wilderness encounter` (no "— roll on your table")
- [ ] **The old section is gone** — you should no longer see the row "Icon grows Hamlet → City"
- [ ] ✝ Monastery is present (the old legend omitted it entirely — this was the actual gap)
- [ ] Zoom the map out until glyphs appear on tiles — the marks on the map match the legend rows

---

## §3 — Dungeon title glyph `0cd3835`

- [ ] Open any dungeon (click a dungeon POI → Enter)
- [ ] The **Dungeon View title** now reads `<glyph> <Theme> — <Size>`, e.g. `🪦 Catacombs — Sprawling`
- [ ] The **in-panel dungeon header** (`<h3>` in the side panel) shows the same glyph
- [ ] Open a dungeon of a *different* theme — the glyph changes to match
- [ ] An unusual/unknown theme still shows a generic dungeon glyph (never a blank or `undefined`)

---

## §4 — "Enter the catacombs" `95ec41a`

Needs a monastery whose card says *"Has catacombs beneath"*.

- [ ] Select that monastery. **Before** ever exploring, the row reads:
  - [ ] Label: **"Descend below:"**
  - [ ] Button: **"Explore the catacombs"**
- [ ] Click it — the catacombs interior opens
- [ ] Close the dungeon view and re-select the same monastery. The row now reads:
  - [ ] Label: **"Return below:"**
  - [ ] Button: **"Enter the catacombs"**
- [ ] Click "Enter the catacombs" → it reopens **the same** interior (same rooms/layout)
- [ ] The hex's POI list contains **one** Catacombs POI, not two (no duplicate was created)

> Note: the "Has catacombs beneath" line was deliberately **left as static text**, not made
> clickable — making it a button meant threading a handler through a helper with 7 other
> call sites, for an action already available as a real button one row below. Flagged as a
> follow-up if you want it.

---

## §6 — Bestiary tier pips `c2b974d`

- [ ] Open a dungeon → **Monsters** list in the panel
- [ ] Rows are prefixed with dot pips by danger tier, e.g. `•• Skeletons — L1, L2`, `••• Wights — L3, L4`
- [ ] The apex monster still shows `☠` and `· the deadliest` exactly as before
- [ ] Pip count rises with tier (tier 1 = `•` … tier 4 = `••••`)
- [ ] **Expected, not a bug:** some rows have *no* pips. Monsters absent from `monster-families.json`
      get tier 0 and render exactly as they did before.

---

## §7 — Richer hex hover `b95ba7b`

- [ ] Hover a **monastery** hex → tooltip shows its monastic rank (`Hermitage` / `Priory` / `Abbey` / `Great Abbey`)
- [ ] Hover a **keep** hex → shows e.g. `Town keep`
- [ ] Hover a **plain settlement** → shows its size (`Village`)
- [ ] Any hex with POIs shows a count line: `2 POIs` (and `1 POI`, singular, for one)
- [ ] A hex with no POIs shows **no** count line
- [ ] New lines use the same ink colour as the existing hover lines — nothing looks mismatched
- [ ] **Density check:** a named settlement now shows name *and* size on separate lines. Confirm you're happy with that — it's the intended behaviour but it is a visible change on every settled hex.

---

## §8 — Keep garrison line `8c160dc`

- [ ] Select a **keep**. Under the `<size> — Keep (fortified)` meta line there is now a `Garrison:` line
- [ ] The wording tracks size:
  - [ ] Hamlet → `Garrison: a small watch`
  - [ ] Village → `Garrison: a standing garrison`
  - [ ] Town → `Garrison: a full garrison`
  - [ ] City → `Garrison: a war-garrison`
- [ ] It sits on **its own row** (not run together inline with the meta text)
- [ ] Select a **monastery** → **no** garrison line (monasteries and keeps are mutually exclusive)
- [ ] Select a **plain town** → **no** garrison line

> **Decision I defaulted:** garrison wording only, **no holding faction** shown. You were asked
> and didn't answer, so I took the spec's default. Say the word and I'll add `· held by <faction>`.
> It's derived text only — no new stored fields, so nothing to migrate either way.

---

## §9 — Unified GM-note callouts `2c8bb92`

The point of this one is that **nothing should look different in light mode** — it's a consolidation.

- [ ] **Monastery research result** — gold-washed box with a gold left border, italic text: unchanged
- [ ] **Town situation callout** — gold box, and the ↻ refresh button is still correctly positioned top-right *inside* the box (not overlapping the text)
- [ ] **Monastery secret line** — still inline dark red italic, no box
- [ ] **Dungeon bestiary apex cue** — still inline dark red italic, no box
- [ ] All four still render at all (they're created in four different places — confirm none vanished)

**Dark-mode fix (bonus, not in the original spec):**

- [ ] Switch your OS/browser to dark mode (or DevTools → Rendering → `prefers-color-scheme: dark`)
- [ ] The monastery secret, bestiary apex, and "deadliest" monster lines are now **legible salmon-red** on the dark background
- [ ] Previously these were hardcoded `#8a3324` with no dark override — near-black-on-black. Confirm they read cleanly now.
- [ ] Switch back to light — those lines are **exactly** the old dark red (this was verified as byte-identical computed styles)

---

## §5 — Monastery trade hook `b059e08`

- [ ] Select a **monastery** hex. Note its **Produces:** list and the house's name.
- [ ] Radial menu → World → Hook → **Generate hook**
- [ ] Repeat until an **opportunity** hook lands (the pattern is a weighted roll, so it may take several tries)
- [ ] The hook reads: *"A buyer here `<claim>` **`<one of that monastery's industries>`** from **`<the abbey's name>`**."*
- [ ] The commodity is genuinely one from that house's `Produces:` list — not a random generic good
- [ ] Now generate an opportunity hook at a **non-monastery** town
- [ ] It reads the old way: *"A buyer here `<claim>` `<commodity>`."* — no "from ..." clause, generic commodity

Real generated example from the end-to-end check:

> A buyer here keeps a standing order for **bread and grain** from **Saint Elgiva's Friary**.

> **Decision I defaulted:** the seed fires **only when the hook's origin hex is itself a monastery**.
> The "monastery within N hexes of a town" variant was *not* built — it's noted as a follow-up in
> the commit body. You were asked and didn't answer, so I took the spec's default.

---

## Final

- [ ] Console is still **empty** after all of the above
- [ ] `npm test` → 699 pass / 0 fail
- [ ] `git log --oneline main..HEAD` shows exactly 9 commits, one per section

---

## Things worth knowing before you sign off

1. **The spec's §2 was wrong.** It said the legend didn't document settlements — it already had a
   static Settlements section. Implemented as a *replace*; following the spec literally would have
   produced two "Settlements" headings. This is the check most worth your eyes.
2. **`run-local.sh` is stale** — still pinned to `claude/phase-15-breakdown-muv6e9` and it hard-resets.
   Not touched (out of scope), but it will actively mislead the next person. Worth a one-line fix.
3. **Two owner decisions were defaulted, not confirmed** — §5 scope and §8 faction holder (both marked
   above). Both are cheap to change.
4. **What was *not* verified end-to-end:** the §5 in-browser click path through `onGenerateHook`, and
   §4's `catacombsBuilt` derivation, were verified by unit test + source reading, not by driving the
   real UI headlessly. The §5 logic *was* proven end-to-end against real generated worlds in Node.
   Those two are why the manual steps above matter.
