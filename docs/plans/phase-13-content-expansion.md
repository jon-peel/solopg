# Phase 13 — Content expansion (flavour tables & name pools)

**Status:** planned. **Goal:** greatly widen the pool of random flavour text so the world stops repeating itself — dungeon rooms, specials, traps, shrines, landmarks, settlement/tavern colour, hooks, and the name generators. This is **content only**: no schema change, no new mechanics.

## For an implementer / agent picking up an item

Each numbered item below is an independent, self-contained task: **open the linked file, add new entries, done.**

**Weighted JSON tables** (`data/*.json`) share one shape — `{ id, title, entries: [ { "weight": N, "value": <string|object> } ] }`:
- **Append** new objects to the `entries` array. Use `"weight": 1` for a normal entry (raise it only for a deliberately-common one; match the spread already in the file).
- `value` is a **plain string** for almost every table. The exception is `monster-telegraph`, whose value is `{ "monster": "<exact name from monster-families.json>", "telegraphs": ["…","…"] }`.
- **Match the existing voice** (read the current entries first), keep each entry **self-contained** (prose is composed at render — no trailing punctuation tricks), and **no duplicates / near-duplicates**.
- Some tables read as **sentence fragments** in a larger template (see each hook item's note / the table `title`) — keep new entries grammatically drop-in.

**Name pools** (§12–13) are JS `const` arrays of strings in the linked file — append strings, keep the register. They're **combinatorial** (ADJ × BODY, PREFIX × SUFFIX…), so modest additions multiply into large variety gains.

**Verify:** `node --test test/*.test.js` — every table is loaded + `validateTable`'d by the suite, so a malformed entry fails the tests. No app wiring, no schema bump.

**Targets are suggestions** (a sensible "aim for" size); the requester may override per item.

---

## 1. Dungeon rooms & features

- **1.1** [`data/dungeon-dressing.json`](../../data/dungeon-dressing.json) — Empty-room dressing · **10** now → ~40
- **1.2** [`data/dungeon-special.json`](../../data/dungeon-special.json) — Dungeon special features · **10** now → ~40
- **1.3** [`data/dungeon-trap.json`](../../data/dungeon-trap.json) — Dungeon traps · **8** now → ~40
- **1.4** [`data/dungeon-light.json`](../../data/dungeon-light.json) — Light source (a lit room) · **8** now → ~40
- **1.5** [`data/monster-telegraph.json`](../../data/monster-telegraph.json) — Monster telegraphs · **18** now → ~40
- **1.6** [`data/dungeon-treasure-guard.json`](../../data/dungeon-treasure-guard.json) — How a hoard is protected · **6** now → ~40

## 2. Shrines

- **2.1** [`data/shrine-form.json`](../../data/shrine-form.json) — Shrine form · **11** now → ~40
- **2.2** [`data/shrine-condition.json`](../../data/shrine-condition.json) — Shrine condition · **8** now → ~40
- **2.3** [`data/shrine-dedication.json`](../../data/shrine-dedication.json) — Shrine dedication · **12** now → ~40
- **2.4** [`data/shrine-detail.json`](../../data/shrine-detail.json) — Shrine telling detail · **12** now → ~40

## 3. Landmarks

- **3.1** [`data/landmark-feature.json`](../../data/landmark-feature.json) — Landmark feature · **11** now → ~40
- **3.2** [`data/landmark-trait.json`](../../data/landmark-trait.json) — Landmark trait · **9** now → ~40
- **3.3** [`data/landmark-hook.json`](../../data/landmark-hook.json) — Landmark hook · **8** now → ~40

## 4. Towers

- **4.1** [`data/tower-kind.json`](../../data/tower-kind.json) — Tower kind · **8** now → ~40
- **4.2** [`data/tower-master.json`](../../data/tower-master.json) — Tower master · **9** now → ~40

## 5. Camps & lair occupants

- **5.1** [`data/occupiers.json`](../../data/occupiers.json) — POI occupier flavour · **8** now → ~40
- **5.2** [`data/creatures.json`](../../data/creatures.json) — Lair creatures · **8** now → ~40

## 6. Settlements

- **6.1** [`data/settlement-mood.json`](../../data/settlement-mood.json) — Settlement mood · **24** now → ~34
- **6.2** [`data/settlement-event.json`](../../data/settlement-event.json) — Settlement happening · **30** now → ~42
- **6.3** [`data/settlement-faction.json`](../../data/settlement-faction.json) — Settlement — faction presence · **16** now → ~22

## 7. Taverns / shops

- **7.1** [`data/tavern-sign.json`](../../data/tavern-sign.json) — Tavern / shop sign · **40** now → ~56
- **7.2** [`data/tavern-specialty.json`](../../data/tavern-specialty.json) — Tavern / shop specialty · **28** now → ~39
- **7.3** [`data/tavern-quirk.json`](../../data/tavern-quirk.json) — Tavern / shop quirk · **30** now → ~42

## 8. Oracle (Meaning + Complication)

- **8.1** [`data/oracle-action.json`](../../data/oracle-action.json) — Meaning — action word · **52** now → ~73
- **8.2** [`data/oracle-subject.json`](../../data/oracle-subject.json) — Meaning — subject word · **50** now → ~70
- **8.3** [`data/oracle-complication.json`](../../data/oracle-complication.json) — Complication / twist · **48** now → ~67

## 9. Adventure hooks (text fragments)

- **9.1** [`data/hook-source.json`](../../data/hook-source.json) — Where the hook was heard · **8** now → ~20
- **9.2** [`data/hook-clue.json`](../../data/hook-clue.json) — Intermediate breadcrumb clue (points onward to the next site) · **7** now → ~19
- **9.3** [`data/hook-event.json`](../../data/hook-event.json) — Local event (reads "<claim> here") · **8** now → ~20
- **9.4** [`data/hook-explore.json`](../../data/hook-explore.json) — Explore / treasure claim (reads after "… where") · **7** now → ~19
- **9.5** [`data/hook-threat.json`](../../data/hook-threat.json) — Threat claim (reads "<menace> <claim>") · **7** now → ~19
- **9.6** [`data/hook-warning.json`](../../data/hook-warning.json) — Warning / avoid claim (reads "<claim> at <site>") · **7** now → ~19
- **9.7** [`data/hook-rescue.json`](../../data/hook-rescue.json) — Rescue / missing claim (reads "<claim> at <site>") · **7** now → ~19
- **9.8** [`data/hook-return.json`](../../data/hook-return.json) — Return development (reads "<place> <claim>, …") · **7** now → ~19
- **9.9** [`data/hook-payoff.json`](../../data/hook-payoff.json) — Chain prize (reads after "word of …" and "and … with it") · **8** now → ~20
- **9.10** [`data/hook-reward.json`](../../data/hook-reward.json) — Reward on offer (reads "<reward> from <patron>") · **6** now → ~18
- **9.11** [`data/hook-patron.json`](../../data/hook-patron.json) — Who offers the reward · **8** now → ~20
- **9.12** [`data/hook-recipient.json`](../../data/hook-recipient.json) — Escort recipient (who to deliver to — reads "… to <recipient>") · **8** now → ~20
- **9.13** [`data/hook-cargo.json`](../../data/hook-cargo.json) — Escort cargo (what to carry — reads "carry <cargo> to …") · **9** now → ~21
- **9.14** [`data/hook-commodity.json`](../../data/hook-commodity.json) — Goods a buyer wants · **9** now → ~21
- **9.15** [`data/hook-opportunity.json`](../../data/hook-opportunity.json) — Opportunity / buyer offer (reads "a buyer here <claim> <commodity>") · **6** now → ~18

## 10. Factions (content)

- **10.1** [`data/faction-goal.json`](../../data/faction-goal.json) — Faction goal (what it is working toward; the clock length is JS tuning, not here) · **8** now → ~20
- **10.2** [`data/faction-monster-kind.json`](../../data/faction-monster-kind.json) — Monstrous tribe kind · **9** now → ~20

## 11. Terrain / misc flavour

- **11.1** [`data/swamp-feature.json`](../../data/swamp-feature.json) — Swamp feature · **4** now → ~40
- **11.2** [`data/dungeon-theme.json`](../../data/dungeon-theme.json) — Dungeon theme identities — COUPLED to dungeon-family weights · **18** now → ~—

## 12. Faction names — [`js/gen/faction-name.js`](../../js/gen/faction-name.js)

- **12.1** `ADJ` — **20** now → ~32
- **12.2** `BODY` — **16** now → ~26
- **12.3** `KIN` — **13** now → ~21
- **12.4** `OF_PLACE` — **12** now → ~19
- **12.5** `HOUSE` — **14** now → ~22
- **12.6** `UNDEAD_BODY` — **8** now → ~13
- **12.7** `VAMP_TITLE` — **6** now → ~10
- **12.8** `HAG_ADJ` — **7** now → ~11
- **12.9** `HAG_BODY` — **6** now → ~10
- **12.10** `DRAGON_NAMES` — **10** now → ~16
- **12.11** `WYRM` — **5** now → ~8
- **12.12** `REBEL_ADJ` — **5** now → ~8
- **12.13** `REBEL_BODY` — **5** now → ~8

## 13. Settlement names — [`js/gen/settlement-name.js`](../../js/gen/settlement-name.js)

- **13.1** `PREFIX` — **40** now → ~64
- **13.2** `COMMON_SUFFIX` — **19** now → ~30
- **13.3** `NOUN` — **16** now → ~26
- **13.4** `MARTIAL_SUFFIX` — **7** now → ~11

---

## Left off (fixed / structural — not expansion targets)

The engine keys on these, or their range is already fully covered, so expanding adds churn, not play value:

- **dungeon-room (4)** — Structural taxonomy (Monster/Trap/Empty/Special) — expanding = new room mechanics.
- **dungeon-monster-status (7)** — Reaction/state ladder (asleep/wary/hunting…) already spans the space.
- **dungeon-size (5)** — Fixed size tiers the generator keys on.
- **camp-reaction (5) · camp-scale (4)** — Fixed reaction/scale ladders — range already covered.
- **treasure-type (15)** — B/X Treasure Type codes A–O — fixed by the rules system.
- **terrain (6)** — Engine terrain set — coupled to generation/art/water/roads; adding one is a feature.
- **settlement-size (4)** — Fixed Hamlet/Village/Town/City tiers.
- **poi-types (5) · poi-occupant (4)** — Structural POI taxonomy the engine branches on.
- **faction-disposition (4)** — Fixed 4-rung ladder (hostile/wary/neutral/friendly).
- **faction-archetype (8)** — Structural — drives lord types, seats, interiors; a systems change.
- **dungeon-family (18) · monster-families (9)** — Mechanical: theme→family weights + monster stat blocks (stats/balance task, not a word list).
- **hook-pattern (8) · hook-verb (4)** — Structural hook grammar the assembler branches on.

## Coupling / gotchas

- **11.2 `dungeon-theme`** — a new theme also needs matching weights in `dungeon-family` (theme → monster-family), so it's not a pure word-list add.
- **1.5 `monster-telegraph`** — keys must be exact monster names from `monster-families.json` (members + elites) or a lord archetype; only authored monsters show an inline hint.
- Nothing here changes `SCHEMA_VERSION` or any generator logic — it's data + word lists only.
