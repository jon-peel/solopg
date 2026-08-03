# Enhancements Batch 2 — test & approval checklist

Branch: `claude/enhancements-batch-1-qhjpab` · 8 commits · `npm test` 702 pass / 0 fail

Follow-up to batch 1 (which you passed). Three of your nine notes turned out to be
different from what they looked like — those are marked **⚠ finding** below and are
the ones most worth your eyes.

---

## 0. Setup

- [ ] `./run-local.sh` → runs tests, then serves `http://localhost:8000`
- [ ] Confirm **702 tests, 702 pass, 0 fail** (was 699; +3 new keep/radial tests)
- [ ] Open DevTools → Console, leave it open. It should stay **empty**.
- [ ] Generate a world. **Large** is fine now — you no longer need luck to get a keep (see §7).

---

## Note 1 — Legend strings

Already done last round (`7d4080b`); this round removed the **twin in the hover tooltip**.

- [ ] Legend has no "Marks shown when zoomed out…" note and no "— roll on your table"
- [ ] Travel until a ⚔ wilderness encounter mark appears, then hover that hex
- [ ] The tooltip reads **`⚔ Mountains encounter`** — no "— roll on your table", **and no trailing `…`**

> **⚠ finding:** that instruction never actually rendered. The hover pill truncates each line at
> 20 characters and the string was 39, so it always displayed as `⚔ Forest encounter …`. The fix
> also widened the pill cap to 24, otherwise `⚔ Mountains encounter` (21) would still have clipped.

---

## Note 4 — Tooltip missing on monasteries  ⚠ finding

- [ ] Select any hex (click it), then **hover that same hex** → the tooltip pill appears
- [ ] Confirm the hover **outline** is still suppressed on the selected hex (the selection ring
      is the only marker — you shouldn't see a double outline)
- [ ] Place a monastery via the radial (it stays selected afterwards) → hover it → tooltip shows
      its name, rank and POI count
- [ ] Same for a town and a keep

> **⚠ finding: this was never monastery-specific.** A working monastery tooltip was reproduced in
> the browser. The real bug: the label was nested inside the "skip the hover outline on the
> selected cell" guard, so **every** selected hex lost its tooltip. It looked monastery-shaped
> only because monasteries are nearly always hand-placed — and placing one leaves it selected.
> The fix is general; it was verified on a plain hamlet, not a monastery.

---

## Note 6 — Tooltips when zoomed out

- [ ] Zoom out one step → hover a settled hex → tooltip still appears
- [ ] Zoom all the way out → tooltip **still appears and is still legible** (it no longer shrinks
      away with the camera)
- [ ] Zoom back in → the tooltip is exactly the size it always was
- [ ] Turn the **terrain-icons layer OFF** → hover a hex → the tooltip **still appears**

> The icons toggle used to silently kill every tooltip as a side effect — that's fixed too.
> Watch for: the ambient GM hex-name labels share the same draw helper. They're unchanged at
> normal zoom and ~7% larger at the threshold. Give a world with named hexes a quick look.

---

## Note 5 + Note 8 — Keep ranks, and "(fortified)"

Keeps now read martially instead of borrowing town words, matching how monasteries already work.

- [ ] Select a keep of each size — the meta line reads:
  - [ ] Hamlet-scale → **Watchtower**
  - [ ] Village-scale → **Fort**
  - [ ] Town-scale → **Keep**
  - [ ] City-scale → **Citadel**
- [ ] The garrison line below is unchanged (`a small watch` / `a standing garrison` /
      `a full garrison` / `a war-garrison`)
- [ ] **No "(fortified)" anywhere** on the keep card
- [ ] Hover a keep → reads e.g. **`Citadel`**, no longer `City keep`
- [ ] A plain town still shows its plain size and **no** garrison line

> **⚠ finding: unfortified keeps aren't a thing.** There is no fortification field anywhere in the
> settlement schema — `fortified` exists in the codebase only as a *monastery* trait. So
> "(fortified)" on a keep was a tautology and simply went. If you want the *concept*, the
> meaningful version is a **slighted / ruined / ungarrisoned** keep, which needs a new baked field
> and a generation pass — a phase of its own, not built here.
>
> **Note the deliberate change:** the underlying size (Hamlet…City) no longer appears on a keep's
> meta line, exactly as it already doesn't for monasteries. The garrison line still conveys scale.
> If you'd rather see the tier too, say so — it's a one-liner.

---

## Note 7 — Being able to generate a keep  ⚠ finding

- [ ] Right-click any land hex → **Settlement** → the ring now offers **Keep** alongside Monastery
- [ ] Open **Keep** → five options: `Random`, `Watchtower`, `Fort`, `Keep`, `Citadel` (all ♜)
- [ ] Pick **Citadel** → a keep appears on the hex, panel shows `Citadel` + `Garrison: a war-garrison`
- [ ] Pick **Random** on another hex → a keep of some valid size is placed
- [ ] The Keep submenu is also offered on a hex that **already** has a settlement

> **⚠ finding:** keeps are not under-generated. Measured across generated worlds, they appear in
> **2% of Small, 7% of Medium, 12% of Large and 80% of Huge** worlds (~1.65 per Huge). That
> sparsity is deliberate, documented in the terrain profile, and pinned by two existing tests —
> so generation rates were left alone. The actual gap was that the radial had a Monastery
> placement submenu (added in Phase 15) and never got the keep equivalent. That's what was added.
>
> If you *also* want keeps to spawn more often in normal generation, that's a separate change and
> it means retuning two density tests. Say the word.

---

## Note 3 — "· the deadliest"

- [ ] Open a dungeon → Monsters list
- [ ] The apex row reads e.g. **`☠ Goblins — L4`** — the ☠ is still there, the trailing
      "· the deadliest" is gone
- [ ] The apex row is still **bold oxblood red**
- [ ] Other rows still show their tier pips (`••• Wights — L2, L3`)

> Checked your "unless it might be different on some creatures" caveat: it never varies. It's a
> hardcoded literal on a boolean flag, on exactly one row per dungeon. Safe to remove, and no test
> depended on it.

---

## Note 9 — Monastery library next to its button

- [ ] Select a monastery
- [ ] The library description now sits **on the same row as its button**:
      `Library: a fine library  [Research the library]`
- [ ] The old decorative label **"Consult the stacks:"** is gone
- [ ] There is **exactly one** `Library:` line — it's no longer duplicated up in the fact list
- [ ] The trait / catacombs / secret lines now sit **above** the research row
- [ ] The label and button share one row without the button wrapping awkwardly

---

## Note 2 — Dungeon pane header

- [ ] Open a dungeon → the overlay title (e.g. `🐲 Lair — Sprawling`) now reads as a **title**,
      not as bold body text jammed between two buttons
- [ ] It uses the same font as the side-panel dungeon header and the app's other titles
- [ ] It is clearly larger than the `← World` button beside it
- [ ] The emoji sits **on the baseline** — no longer oversized and sitting low
- [ ] The side-panel `<h3>` header gets the same glyph treatment
- [ ] Check dark mode — the title colour flips correctly

> **What was actually wrong:** it was the only header in the entire app rendered in the *body*
> font, at 15px — a mere 0.6px larger than the button next to it. Meanwhile its own side-panel
> twin was already using the display font. So the two views disagreed about how the same string
> should look. Now they agree.

---

## Final

- [ ] Console still **empty** after all of the above
- [ ] `npm test` → 702 pass / 0 fail
- [ ] `git log --oneline` shows 8 new commits since the batch-1 checklist

---

## Open items you may want to decide

1. **Keep tier visibility** — a keep's panel no longer shows its underlying size, only the rank.
   Add the tier back if you miss it.
2. **Keep spawn rate** — left deliberately rare. The radial menu is now the way to get one on
   demand; raising the rate is a separate change.
3. **Unfortified / slighted keeps** — not viable as a label tweak; needs a real generation pass.
4. **Settlement-oracle context label** still shows the raw size for keeps *and* monasteries
   (pre-existing, predates both batches). Left alone as out of scope — happy to fix separately.
