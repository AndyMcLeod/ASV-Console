# ASV Simulator — project guide (CLAUDE.md)

Browser-only command-and-control (C2) shore station **and simulator** for a
small-class **survey ASV** (autonomous surface vehicle, ~2 m × 0.75 m, battery,
short surveys in constrained water). Single-file stdlib-Python server
(`asv_console.py`) + one vanilla-JS page (`static/asv.html`), plus a read-only
`static/playback.html` session-review page. No pip, no build step, Python 3
standard library only.

This project is a **sanitized, generic derivative** — it carries no vendor,
model, or proprietary-protocol identity. Keep it that way: do **not** reintroduce
brand names, model numbers, vendor manual citations, or a specific wire-protocol
format. The onboard controller is the generic **VCU (Vehicle Control Unit)**; the
shore link is a generic serial-over-IP control link.

**Where the line falls** (settled 2026-08-01, see the sanitization section): the **sibling
console's identity never appears in code** — it is the thing this derivative is sanitized
from, so refer to it as "the sibling console". A **modeled vessel's name is DATA** and
belongs in `vessels/*.json`; the core may name a profile *id* (`DEFAULT_VESSEL_ID`) because
that is a data key, not branding. Standing check:
`grep -rniE "z-?boat|teledyne" --include=*.py --include=*.html --include=*.js . | grep -v vessels/`

**The rule is scoped to CODE.** THIS FILE deliberately names the sibling and its path — a
maintainer has to be able to find it — which is why the check above filters by source
extension. Don't "finish the job" by scrubbing the maintainer notes.

## ⇒ START HERE (handoff 2026-08-02, fresh context window)

**Repo:** local git only (no GitHub remote), tree clean. `git log --oneline -5` for the tip —
**this handoff no longer quotes a HEAD hash, because it is now refreshed IN the work commit
and a commit cannot name itself** (see "Keep docs current"). Run:
`python asv_console.py --sim` — **it now comes up as the DriX at Lewes** (`drix08` is
`DEFAULT_VESSEL_ID`; no `--vessel` needed). Web port **8791**; the branded sibling at
`D:\Claude\Zboat` uses 8781, so both run side by side. **Keep this console brand-free**
— the sanitization rules below are locked decisions, not preferences.

**SEVENTEEN REGRESSION SUITES (227 assertions), all run by the pre-commit hook** (`.githooks/pre-commit`;
enable once per clone with `git config core.hooksPath .githooks`). Run them after any
change to what they cover, and treat "harness crashed" as loudly as "check failed".
**The counts below are hand-maintained and DO drift** — twice now an edit has targeted a
number that had already changed, leaving the total wrong. Re-derive rather than trust:

```
for f in tests/*.js; do printf "%-24s " $(basename $f); node  $f | grep -cE '^ *(ok|FAIL) '; done
for f in tests/*.py; do printf "%-24s " $(basename $f); python $f | grep -cE '^ *(ok|FAIL) '; done
```


| | guards |
|---|---|
| `node tests/buoy_lane.js` | Rule 9 channel lane + the lane fact travels with its route (14) |
| `node tests/wreck_clearance.js` | charted point-hazard extent (12) |
| `node tests/water_trust.js` | water-level trust + depth gating (15) |
| `node tests/turn_geometry.js` | survey turn geometry (21) |
| `node tests/end_action.js` | what the card says a run ends as (16) |
| `node tests/nogo_readout.js` | the Nogo row's state, incl. the stuck-on-loading bug (15) |
| `node tests/pattern_move_grip.js` | the survey move grip is reachable AND visible (7) |
| `node tests/survey_card.js` | the survey card still describes a COMMITTED plan (11) |
| `node tests/speed_recalc.js` | plan speed is an INPUT — it recalculates (10) |
| `python tests/roc_tracks.py` | ROC / moving HOME (17) |
| `python tests/live_speed.py` | a speed change REACHES the boat — SOG follows (11, real console) |
| `python tests/ais_range.py` | AIS range filters a wide subscription; never on a lake (9) |
| `node tests/ui_split.js` | split-window lists resolve; card placement + shared resize (14) |
| `node tests/panel_drag.js` | ONE drag + ONE show mechanism; no pop-out forgets its position OR goes off-screen (23) |
| `node tests/stored_settings.js` | guarded localStorage; legacy `"1"`/`"0"` toggles still read (11) |
| `python tests/completion_modes.py` | end-of-plan setting vs run (11, drives a real console) |
| `python tests/post_contract.py` | EVERY POST handler returns `(code, obj)` and none raises (10) |

**FOUR GENERATED DOCUMENTS in `docs/`** — quick start · operations · technical · development.
`cd tools && node build_docs.js` rebuilds all four; **never hand-edit a docx**. Shared
formatting in `tools/docx_kit.js`. Full table in "Keep docs current" below.

**THIS SESSION ("ASV console refinement", 2026-08-02) — a POLISH pass, Andy's choice of
scope: no new features; tighten, delete special cases, verify by pixels, refresh docs.**
- **the retired keep-right is deleted** — 595 lines, 10 % of `static/asv.html`.
  `keepRight`, `channelEndExtend`, `gateProject`, the colour system (`buoyageDir`,
  `buoyLaneAt`, `crossToLine`) and the write-only `lastBuoyage` had been left in place
  after the 2026-07-31 lane port as a recorded "lower risk" divergence; that divergence is
  now CLOSED and this matches the sibling. **No behaviour change** — nothing referenced
  them but each other, so no doc rebuild was owed. See "CHANNEL LANE".
  **Two things the cut exposed that the dead code had been hiding:** `planNogoRoute`'s
  descriptive comment had drifted 46 lines up onto `pairGates` (the gate-projection
  paragraph in between was what separated them), and `pairGates` — which is LIVE, for
  `channelSpanKeepouts` — had no comment of its own describing what it actually does.
  **Deleting dead code is not only tidying: it re-joins things the corpse was holding apart.**
- **one drag mechanism for the pop-out panels** — SIX panels (vessel card, SURV, LINES, AIS
  table, SRC, ROC) each carried a hand-copied drag: restore block, mousedown, a window
  mousemove and a window mouseup. Six copies meant **six handlers ran on every pointer
  move** so five could discover they were not dragging. Now one
  `makeDraggablePanel(el, head, {key, unanchor, ignore, persist})` + one `panelDrag` +
  ONE pair of window listeners. **The drift the copies had already produced: the SRC card
  never persisted its position** — its mouseup cleared the drag and saved nothing, so it
  was the one pop-out that forgot where you put it, while the ops manual had been
  promising since `3080e6a` that the console "remembers your card positions". Fixing the
  mechanism fixed the claim. New suite `tests/panel_drag.js` (11), **9 mutations verified**.
  Ops manual updated + rebuilt (the only docx that changed).
- **one guarded way into `localStorage`** — sixteen hand-written `try`/`catch` blocks around
  `JSON.parse`/`stringify` across eight keys, now `lsGet`/`lsSet`/`lsDel`/`lsBool`. **The
  guard is not decoration:** `localStorage` throws on ACCESS where site data is blocked and
  `setItem` throws on quota, so one bare call takes out start-up — sixteen copies is sixteen
  chances to omit it. **The migration is the risk, and it is tested:** the three display
  toggles were stored as raw `"1"`/`"0"` predating the JSON store, so `lsBool` reads both
  (`JSON.parse` turns `"1"` into `1`). Nobody's saved toggles reset; verified in a browser
  seeded with legacy values, all three non-default. `lsGet` tests `== null`, NOT falsiness —
  the old `JSON.parse(...) || {}` could not tell a stored `false` from a missing key.
  New suite `tests/stored_settings.js` (11), **7 mutations verified**.
  **`panel_drag.js` check 10 failed on this change and was right to** — it named the raw
  `localStorage.setItem` shape; re-pointed at `lsSet` and re-mutated to confirm it still bites.
- **`/api/ais/radius` RAISED ON EVERY CALL** — Andy pasted the traceback from his running
  console. `_dispatch_post`'s contract is `(code, obj)`; that one handler was written in the
  `do_POST` style and did `return self._send(...)`, which returns **None** → `code, obj = None`.
  **`_send` had ALREADY written a correct 200 to the socket**, so the client saw a healthy
  response and the raise happened after — killing the handler thread and, quietly, skipping
  `LOG.command()`, so the session recorder has been missing every AIS radius change since
  `1166068`. Only site: the other ten `return self._send(...)` are in GET handlers, where
  returning None is right.
  **WHY THE SUITE WAS GREEN: `tests/ais_range.py` sent the console's stdout AND stderr to
  `DEVNULL`.** Check 7 asserted the clamp and got a correct answer, from a request that then
  crashed its thread. All three real-console harnesses did this. They now capture the server's
  output to a temp file (not a PIPE — nothing drains it, so a full buffer would hang the test)
  and assert **the console logged no exception**: `ais_range` 9, `live_speed` 10,
  `completion_modes` 11. Mutation-verified in all three, including restoring the exact
  shipped bug. **THE RULE: a client-side assertion cannot see a server that answers correctly
  and then dies. If a test drives a real process, read that process's output.**
- **AUDITED THE OTHER POST HANDLERS** (Andy asked; the answer is that `/api/ais/radius` was
  the only one). Done three ways, because a grep only finds the shape you already know:
  **AST** — all 29 returns in `_dispatch_post` are 2-tuples, it is the only function whose
  result is unpacked into two names, and no GET handler returns a tuple nobody sends (the
  mirror bug); **reachability** — the function cannot fall off the end and return `None`
  implicitly; **live** — all 26 endpoints plus 11 ROC ops POSTed against a real console, all
  answered, server log clean. Kept as `tests/post_contract.py` (10), which **parses the
  endpoint list out of the source**, so a new POST route is covered the day it is added.
  **Checks 7 and 10 do not subsume each other:** a raise BEFORE the response leaves the
  client with nothing (7 sees it); a raise AFTER `_send` has already answered — the bug that
  shipped — is invisible to every client-side check and only the server log shows it (10).
  **Mutation-writing gotcha recorded there:** the handlers are an `if path == …: return`
  chain, so a raise injected before the branch that already handles that path is unreachable
  and the mutation silently does nothing — my first attempt looked like a surviving mutant.
- **THE VESSEL CARD WAS ABSENT FROM THE CHART** (Andy, live). **Not hidden and not broken —
  `display:block`, fully live, at a position saved when the window was bigger, sitting
  outside the viewport.** The DRAG had always clamped to the chart; **RESTORE never did**, so
  a position from a larger window or a second monitor came back verbatim. Pre-existing, not
  from the drag consolidation — `git show e0e3e8c^` has the same unclamped restore — but the
  consolidation is why there was one place to fix it for all six pop-outs. **The vessel card
  was the cruel case: `placeVcard()` puts its VESSEL reopen pill at the SAME coordinates, so
  the one control that brings the card back went off-screen with it.** Now `clampPanelPos` +
  `placePanel`, shared by restore, drag and a new `resize` listener.
  **Three properties worth keeping:** the clamp is **DISPLAY-ONLY** (a card parked at a big
  monitor's edge returns there when the window is big again); the resize re-clamp re-derives
  from **STORAGE, not the DOM**, or it would RATCHET; and `placeVcard` **sets visibility
  BEFORE measuring**, because a `display:none` card measures 0×0 and would be clamped by the
  sliver rule on the very reveal meant to rescue it — I shipped that bug and caught it by
  measuring in the browser, and check 20 now guards the ordering.
  `tests/panel_drag.js` 11 → 20, **8 mutations verified**. Ops manual updated + rebuilt (the
  other three docs' `word/document.xml` are byte-identical, so only that one is committed).
- **`showPanel()` — ONE way to show a floating panel** (closes the residual above, Andy's
  call). The pop-outs were shown from **SEVEN** bare `style.display = …` sites — I found five
  on the first sweep and the grep caught two more ROC auto-opens — so a panel restored while
  hidden kept the 0×0 sliver clamp and revealed with only a corner on the chart. `showPanel`
  shows AND re-clamps, **in that order**. It does **not** persist: a reveal only tightens what
  is on screen now, so the operator's stored position still governs the next restore.
  `clampPanelPos` + `PANEL_MIN_VIS` **moved up beside `mapEl`** — `showPanel` is called from
  `setMode` and toolbar handlers that can run before the pop-out section executes, and a
  `const` read before its declaration is a **ReferenceError, not `undefined`**. Note
  `#v_mission` is a SECTION of the vessel card, not a pop-out — it keeps its own
  `style.display`. `tests/panel_drag.js` 20 → 23, **5 more mutations verified**; check 21
  derives the panel list from the registrations, so a seventh pop-out is covered the day it
  is registered. Live: every keyed pop-out seeded at `{4000,3000}` while hidden now reveals
  FULLY inside the chart.
- **the lane fact travels WITH its route** — `channelLaneRoute` now returns `{route, lane}`
  and `buoyageNote(lane)` takes it as an argument; the module flag `lastChannelLane` is gone.
  I raised the stale flag as *inert* (a refusal returns before any reader) — **it was not.**
  Looking properly found a SECOND, live fault in the same flag: `routePlan` calls
  `channelLaneRoute` ONCE PER LEG, and the reset at the top of that function meant only the
  **last leg counted**. Proven at Lewes on the real ENC — a transit out of the canal into
  Delaware Bay rides the lane on leg 0 and open water on legs 1–2; the plan now reports
  `true`, **the old flag would have said `false`** and dropped the Rule 9 note from a
  transit that genuinely rode the lane. `routePlan` accumulates (`lane ||= kr.lane`) and
  returns it; the two search/survey call sites that only ever wanted the array take
  `.route`. `laneUsed` remains as scratch that `channelLaneRoute` resets and consumes on the
  same tick — **nothing outside it may read that variable**, which is what makes the
  staleness structurally impossible. `tests/buoy_lane.js` +3 (14): the lane is reported,
  is not reported in open water, and **a lane plan followed by an open-water plan does not
  inherit the lane** — mutation-verified by restoring the old no-reset design, which fails
  exactly that check. The ops manual already promised the banner reports "whether it rode a
  channel lane", so **again the doc was right and the code was wrong** — no rebuild owed.
  **Lesson: "inert today" is a claim about every reader, present and future. Check it by
  looking at the producer, not the reader** — the producer had a second bug the reader
  audit would never have found.
- **the pre-commit path filter named its suites individually and had drifted** — five
  (`wreck_clearance`, `water_trust`, `ais_range`, `live_speed`, `completion_modes`) were
  never listed, so editing one of them ALONE ran nothing. Replaced with `*tests/*`. Same
  shape as the panels and the suite counts: **a hand-maintained list beside a directory
  that already answers the question.**

**A TEST-DESIGN LESSON FROM THIS SESSION, and it applies to all sixteen suites.** The first
`stored_settings.js` called the helpers directly. Stripping `lsGet`'s `try`/`catch` — the
exact fault check 4 exists for — made check **3** throw and killed the process before check 4
ran, so **no `FAIL` line was printed at all and the mutation runner scored it as SURVIVED**.
The suite now evaluates every condition as a thunk and reports a throw as a failed check.
Two rules fall out, both cheap:
- **A HARNESS THAT CANNOT SURVIVE THE FAULT IT TESTS FOR CANNOT REPORT IT.** If a check
  proves a function does not throw, calling that function unguarded elsewhere in the same
  file makes the proof unreachable.
- **A MUTATION RUNNER MUST SCORE A CRASH SEPARATELY FROM A PASS.** "No FAIL lines" and "the
  process died" look identical if you only parse stdout. This is the same rule the hook
  already states for suites — treat a crash as loudly as a failure — applied to the thing
  that grades the suites.
- **TESTING A PURE HELPER DOES NOT TEST THAT ANYTHING CALLS IT.** Six assertions exercised
  `clampPanelPos` directly and all six stayed green when the clamp was ripped out of
  `placePanel` — the reported fault restored, undetected. Checks 18–19 assert the CALLER.
  Same family as the `completion_modes` lesson: preserving a value and honouring it are two
  assertions. **And prefer naming the paths to counting them** — check 9 counted
  "`>= 2` unanchor call sites" and stayed green when the restore path lost its one, because
  a third site elsewhere covered the count. **An ORDERING check has the same failure mode:**
  comparing `indexOf("style.display")` against the clamp passed a mutation that moved the
  real write after it, because an earlier write in a guard clause satisfied the first index.
  Compare the **LAST** occurrence.

**Previous session (2026-08-01 → 08-02), fifteen commits, all with sections below:**
- **vessel card off the controls window** — it was bridged, so one card rendered in BOTH
  windows. Now chart-window only; top bar untouched by request. New suite
  `tests/ui_split.js` (9), which also turns "every bridged selector resolves" from a
  sentence into a test.
- **AIS range control** — a live range control on the AIS card. **Andy's design: collect
  wide (150 km), filter narrow (50 km default), never on a lake.** That DELETES the old
  "subscription and query must move together" invariant instead of working around it. New
  suite `tests/ais_range.py` (8).
- **live speed** — SOG did not follow a speed change because the commanded speed reached the
  boat ONLY via `upload_plan`. There was no speed command AT ALL: no seam method, no Engine
  method, no endpoint. Added `set_speed` through the whole seam (+ honest `RealVcu` refusal),
  `/api/cmd/speed`, and `speed_key`/`speed_target_kn` on the state. New suite
  `tests/live_speed.py` (10, drives a real console). **First commit under the folded-handoff
  rule.**
- `f382b85` **plan speed is an INPUT to the plan, not a label on it** — Punch Out already
  advises "widen the lines or slow down"; acting on that advice recomputed **nothing**.
  `recalcForSpeed()` re-punches a drawn pattern (live: 7 teardrops → 7 semicircles, routed
  length 0.63 → 0.44 → 1.27 km across survey → low → high); a COMMITTED plan can't be
  re-punched, so durations are recomputed and the spacing re-checked against the new turn
  radius. **Asymmetric on purpose: slowing down is always safe, speeding up can make a
  committed reversal untrackable while the chart looks identical.** End-of-plan's "applies
  on the next Upload" was half true in the dangerous direction — the SETTING is live.
  New suite `tests/speed_recalc.js` (10). **Two gaps the live run found:** durations blanked
  at `Add to plan`, and the warning never cleared when you slowed back down.
- `d832456` **the survey card keeps describing a committed plan** — Andy reported it going
  blank "after uploading"; the blanking is actually at **`Add to plan`**, one step earlier,
  because `resetPattern()` drops the anchors every figure was derived from. **Reproduce the
  operator's CASE, not their diagnosis.** `committedPatternInfo()` now DERIVES the figures
  from `mission.lines` instead of snapshotting them — which forced out two bugs a snapshot
  would have hidden: `planKind` is unreliable after a refresh, and the line direction came
  back as the RECIPROCAL (typed 327, card read 147). New suite `tests/survey_card.js` (11).
- `3080e6a` **documentation set** — there was one generated document, for engineers; Andy
  asked for three more readers to be served. **Quick Start** (976 w, ~20 min to a running
  survey, deliberately ruthless — don't grow it), **Operations Manual** (5,487 w, 17 ch, the
  person at the console with a vessel in the water), **Development Guide** (3,523 w, 10 ch,
  how the project is BUILT AND VERIFIED, since the tech manual covers what it is — including
  five case studies kept because each is a CLASS). Helpers extracted to `tools/docx_kit.js`;
  **the tech manual's `word/document.xml` is byte-identical across that extraction**, which
  is the only reason the refactor was safe — re-verify the same way if you touch the kit.
- `3c8fd9e` **sanitization — the sibling console's identity is out of the core.** Andy's call
  on the long-standing flag; **the line is now written down** (top of this file) instead of
  being re-argued. Five core sites cleared, not the four the old note claimed, and it had
  stale line numbers too — hence the standing `grep`. The sweep also found `buoy_lane.js`
  naming two source files **that do not exist in this repo**, and `turn_geometry.js`'s
  `const ZBOAT` labelled `"4 m USV"` when those are `zboat_1800hs`'s numbers and that hull
  is **1.9 m** — a mislabel that had propagated into this file and README.md. Data
  untouched; all 21 turn assertions unchanged.
- `e070350` **the survey move grip was drawn, live, and invisible** — Andy asked for the SURV
  whole-pattern handle to be ported from the sibling. **It already was, byte-identical and
  working**; it was drawn inside `drawPattern()` (early) and the boat marker (late) painted
  over it, and the boat sits at the A-B midpoint whenever you draw the box around it.
  Measured: **0 grip pixels on the boat, 70 off it.** Now drawn last, haloed, and finally
  named in the SURV hint — which was the one thing the port actually missed. New suite
  `tests/pattern_move_grip.js` (7). **DIVERGENCE FROM THE SIBLING — see that section.**
- `8669230` **the cards say what the boat is actually going to do** — three readout faults
  Andy reported, all the same shape. (a) **END ACTION**: an end-of-plan RTH now reads `rth`
  on a Go-To / Transit / Survey from the START of the run, and is *not* promised when the
  chain cannot fire. Found while verifying it: **the chain's one-shot never re-armed for a
  run commanded while already under way**, so it held at its endpoint indefinitely.
  (b) the **Mission card is now a section of the vessel-status card** (`#missionPanel` gone;
  the old `Run mode` row deleted as the duplicate it was). (c) the **Nogo row was stuck on
  "loading…"** — a repaint painted one statement too early, on the one path that ends in a
  working model; it now names its state. New suites `tests/end_action.js` (16) and
  `tests/nogo_readout.js` (15). **Live-verified in a real browser, both windows.**
- `2a28a59` **ROC + moving HOME** ported from the sibling (`roc_tracks.py`, `/api/roc`,
  ROC card, RTH chases a mothership), plus `gps_sim.py`, the **Mission card**, the
  **SURV move grip** (old parity gap, now closed), and the **docs set** —
  `tools/build_tech_manual.js` → `docs/asv-simulator-technical-manual.docx`, 15 chapters,
  generated, brand-free. ROC was made **vessel-aware** (standoff scales off LOA; a
  closing check against the vessel's top speed).
- `494f048` **charted point hazards have an EXTENT** — a wreck was a buffer-sized dot,
  so a Go-To planned over one off Lewes. Both the exact check and the A* raster fixed.
- `7151149` **end-of-plan setting vs run completion** — a conflated field meant a Go-To
  overwrote "End of Plan: RTH" with loiter. Split; no Engine method writes the setting.
- `2388856` **default vessel → `drix08`**. The default also decides AIS start-up scope
  and the tide station, so an Erie default pointed both at the wrong water.
- `055373f` + `21d7810` **water level earns trust by distance** — ghosted when the
  station is far, and **not applied to charted depths** when it is remote.

**THE RECURRING THEME, worth carrying forward:** every bug this session was one value
serving two masters, or one value trusted without its provenance. Vessel-derived
constants going stale on a switch (`apply_vessel` must re-derive — see `HULL_A_LAT`,
the ROC standoff, the nogo buffer floor); a persistent setting clobbered by a transient
one; chart data trusted without its extent or its distance. Check for that shape first.

**THE ANTIDOTE, and it is cheap (`d832456`): DERIVE, DON'T REMEMBER.** A value read back
off the thing it describes cannot drift from it, survives a reload for free, and follows
later edits. The survey card's obvious fix was to snapshot the pattern figures on commit;
deriving them from `mission.lines` instead **forced out two bugs the snapshot would have
hidden** — `planKind` is unreliable after a refresh, and the derived direction came back
as the RECIPROCAL, which only showed up because it had to agree with the typed value.
Prefer derivation wherever the source of truth is already in hand, and make the derivation
**self-validating** (the card checks the lines really ARE parallel) rather than trusting a
flag alongside it.

**THE READOUT COROLLARY (`8669230`, three instances in one pass):** a card can be
perfectly accurate about its own field and still be **wrong about the boat**. Ask what
question the operator is actually reading the row for, then check whether any field
answers it — "where does this run leave the boat" had no field at all, and "loading…"
answered "what is the console doing" with a word that fit four different states. Two
mechanics behind it, both worth checking directly: a **paint taken before the flag it
reads was cleared** (the Nogo row; the success path was the one that never repainted),
and an **edge-triggered reset for a condition that is not edge-shaped** (the RTH
one-shot re-armed on idle→running, but "a new run" does not always cross that edge).
`e070350` added a third: a **control painted before something that covers it** (the move
grip under the boat marker). `d832456` a fourth: a **readout whose only source was thrown
away by a normal step in the workflow** (the survey card, blanked by the `resetPattern()`
inside `Add to plan`). All four were live, correct, and unusable.

**AND A DIAGNOSTIC HABIT WORTH THE SAME WEIGHT:** Andy reported the survey card blanking
"after uploading". It blanks at `Add to plan`, one step earlier — upload was simply when he
noticed. **Reproduce the operator's CASE, not their diagnosis.** Their account of *when*
is a clue about where to look, never the answer.

**AND THE PORT COROLLARY (`e070350`):** a clean diff is not evidence a UI port works. That
grip was byte-identical to the sibling's and the feature was still missing. **Verify a UI
port by looking at the pixels** — `getImageData` at a known screen point costs one tool
call, works on the animating canvas where screenshots time out, and answered in a minute
what the diff had already said was fine. Ask "can the operator SEE it and REACH it", not
"is the code here".

**OPEN / NEXT:**
- **THE DOC BURDEN JUST QUADRUPLED** (`3080e6a`). A user-facing change now has FOUR generated
  documents plus three READMEs that can go stale, not one. The **operations manual is the
  operator-facing source of truth** — a new control, a changed refusal, a new readout state
  or a new safety behaviour belongs in it, and `node build_docs.js` must be run in the same
  commit. The quick start is deliberately thin: **point into the ops manual, don't grow it.**
- **`rearmRthChain()` is a BEHAVIOUR change, not just a display one** (`8669230`). A run
  commanded while the boat is already under way now gets its own end-of-plan RTH, where
  before it silently got none. Correct, and Andy has run it — but if an RTH ever looks
  more eager than expected, that function is the first place to look.
- **Payloads / sonar NOT ported** (Andy's call). It needs a vessel-declared `payloads`
  block first; the sibling's single-beam console is built from vendor manual citations
  and proprietary telegrams that this console's rules forbid.
- **The sibling's teardrop branch is undriven** — reachable only at high speed under
  8.3 m line spacing. Low risk, but the 2026-07-20 lesson stands: static `legClear` does
  not catch follow overshoot.
- Residual, by design: chart datum is the LOW-water reference, so a real tide BELOW datum
  leaves charted depths optimistic. The manual override is the answer.

## LINE-TIMING: sequence-keyed activation (2026-07-27)

The LINES-card actual-time accrual is now **sequence-keyed**: a coverage line
accrues time ONLY while the boat's current uploaded-route leg (the waypoint pair
it is between, from the live `wp_index`) IS that line — `currentLegLine()` matches
leg endpoints against committed line endpoints (either direction, 5 m tolerance).
Approach / detour / teardrop / inter-area legs match no line and can never
activate one; the old geometry checks (moving + aligned + XTE) remain only as a
secondary dropout within a line's own leg. The hover time-to-end tooltip gates on
the same `runLineIdx`. This fixes lines "activating" and banking time while the
boat merely transits across or parallel to them on its way to the survey start —
a twice-shipped bug in the sibling console; if it ever resurfaces, check the
sequence gate first and do NOT re-add a geometry-only guard. Harness-verified
(4 cases against the real page functions).

## CHANNEL LANE — the shipping Rule 9 behaviour (ported 2026-07-31)

**This is what runs.** The buoy-line section below is history: that colour design, and
the geometric quarter-width keep-right that replaced it on the sibling, BOTH rode the
wrong side of the buoys on the water. Ported here from the Z-Boat with the routing.

**The rule** (operator-specified from a marked-up chart of the Erie Harbor Channel):
outbound keeps the GREEN buoys to starboard, inbound keeps the RED to starboard, and
**both keep the channel CENTRELINE TO PORT**. One direction-based geometric rule —
ride a lane offset to **STARBOARD of the centreline, `LANE_FRAC` (0.5) of the local
half-width** out (= a quarter of the full width in from the edge). Colour is never an
input; it falls out of where IALA marks sit.

**Applies to EVERY mode**: Go-To, RTH, the drawn Transit, the survey approach leg, the
survey inter-line transits, search-pattern transits, and any routed obstacle detour.
Survey coverage lines and teardrop turns are never offset.

**Pipeline** (`channelLaneRoute` in `static/asv.html`):
1. `buoyChannelLane` — marked channels. `systemCenterline(sy)` pairs each port-hand
   buoy with its nearest starboard-hand buoy, takes midpoints ordered by number; each
   point carries `hw` (half the pair spacing). The system is chosen by the **longest
   stretch of the ROUTED PATH inside it**.
2. `narrowChannelLane` — the SAME rule with no buoys (basin exit, canal). Centreline
   from the water's own edges: `ctr=(RC−LC)/2`, `hw=(RC+LC)/2`. Fires only where BOTH
   edges answer within `CONFINE`. **This is where the ASV's `channel_reach_m` vessel
   override now lives** (it used to set `keepRight`/`channelEndExtend`'s wall-search
   REACH; both DELETED 2026-08-02): `CONFINE = max(120, channel_reach_m ?? buf*30)`.
3. `smoothTrack` — resample by ARC LENGTH at `STEP = max(45, buf*13)` (the waypoint
   count dial) + two light `[0.25,0.5,0.25]` passes to round the bends.

**Non-negotiable invariants — each one is a bug that actually shipped on the sibling:**
a lone buoy is NOT a wall (the edge march runs against a mark-free keep-out view);
SPLICE the lane into the routed path, never replace it; never emit an unverified leg
(abandon the lane instead); the full quarter-width is not always available (take the
largest offset that stays in clear water, then slew-limit); always SAMPLE a polyline,
never trust its vertex count; and measure the lane against the pre-shift samples, not
by marching perpendicular to the final route.

**DELETED 2026-08-02 — the divergence is closed.** `keepRight`, `channelEndExtend`,
`gateProject`, the colour system (`buoyageDir`, `buoyLaneAt`, `crossToLine`) and the
write-only `lastBuoyage` are **gone** (595 lines, 10 % of the page). They had been left
in place as a deliberate "lower risk" divergence after the port; the sibling deleted its
colour helpers outright and this now matches. Nothing referenced them but each other —
verified by a reference scan before and after, which also confirmed **no function was
newly orphaned** by the cut. `pairGates` SURVIVES: it is live for `channelSpanKeepouts`
(the buoy-gate fairway corridor), which is a different job from the retired gate
projection. **NOT implemented** (retired with them, unchanged): the channel end
extension and the buoy-gate projection.

Dead code is not free: it was still being read, still being maintained in comments, and
`tools/buoy_lane_test.js` had already been deleted for *testing* it and passing. The cut
was verified three ways — all 14 suites (177 assertions) green, both pages parse, and the
real page driven in a browser: `planNogoRoute` along the Lewes canal returned 26
waypoints with the lane engaged and no console errors.

**Test:** `node tests/buoy_lane.js` — 11 assertions (lane side + magnitude both
directions, opposing transits pass port-to-port, unmarked channel both ways, a lone
buoy is not a wall, open-water no-op, `systemCenterline` geometry). Verified on the
real Erie cache: outbound **99 % starboard at 0.50 of half-width**, inbound **98 % at
0.39** — matching the sibling. The old `tools/buoy_lane_test.js` was **deleted** with
this port: it exercised the dead colour keep-right and still printed "all checks
passed", which is worse than no test — it tells you to stop looking.

## MULTI-MONITOR UI SPLIT (ported 2026-07-31)

Two windows: **main** (chart + status + command bar) and **controls** (`?panel=controls`,
only the control column + its pop-out panels). Independent pages talking over a same-origin
**BroadcastChannel** (`asv_ui`). Main is the single source of truth — it owns the chart and
all logic; the controls window renders no app logic, mirrors main's control DOM, and
forwards gestures back so every existing handler still runs exactly once, on main.

- `UIROLE` from the query string; tabs self-title **ASV Chart** / **ASV Controls**.
- `UI_BRIDGED` = `.controls` + every pop-out this console has. No `#missionPanel` (it is a
  section of `#vcard`) and, since 2026-08-02, **no `#vcard` either** — see below.
  **`node tests/ui_split.js` now VERIFIES** that every bridged selector, every
  `UI_CARD_TITLES` key and every `#id` in the injected CSS resolves; that claim used to be a
  sentence somebody had checked once.
- **THE VESSEL-STATUS CARD LIVES ON THE CHART WINDOW ONLY (Andy, 2026-08-02).** It used to
  be bridged, so the SAME card rendered in BOTH windows — "VESSEL STATUS" on the chart and a
  "Vessel" uicard in the controls window with nine rows trimmed to stop it echoing the top
  bar. **Two copies of one card is not a second view, it is a second place to look.** Now:
  not bridged, not titled, and `body.ui-controls #vcard{display:none}` — hidden rather than
  removed, because the controls window is the same page under `?panel=controls`. It is
  deliberately NOT in the `ui-split` hide list; that would strip it from the chart too.
  **THE TOP STATUS BAR IS LEFT ALONE** — Andy likes it, and its nine-row overlap with the
  card is accepted rather than a defect. The old row-trimming CSS is retired with the mirror.

**RESIZABLE CARDS — ONE MECHANISM (2026-08-02).** Asked to make the vessel-status card
resizable, I built it a private resize: own CSS, own key, own save path — beside the
`.uicard` mechanism that already did exactly that in the controls window. **Andy asked
whether something was fundamentally different about that card. It was: I had made it a
special case.** Generalised to `.rsz` + `RESIZABLE_CARDS` + ONE key `asv_card_sizes_v1`,
mirroring `asv_ui_cards_v1`. All ten chart-window cards resize.
- **DISPLAY-AGNOSTIC ON PURPOSE.** Cards are shown by different paths, some as `block` and
  some as `flex`. A mechanism needing one of them would silently no-op on half, and the next
  card added would be a coin toss. So the CARD is the scroll container with a **sticky
  header** — the same shape as `.uicard-grip`. A nominated `.rszbody` gives up its OWN
  scrolling (`!important`, the caps are inline).
- **ONLY AN OPERATOR-CHANGED SIZE IS PERSISTED**, compared against the authored default
  captured at init. Several cards carry an inline width in the markup, so "has an inline
  size" stored the DEFAULT the moment a card opened — and a stored default overrides a
  changed default forever, which is the mission-buffer-vs-vessel-floor shape again. An
  earlier attempt inferred intent from gestures and marked cards nobody had touched: a
  mousedown while a card is HIDDEN measures 0×0, so any later reveal looked like a resize.
- **THE SAVE IS EVENT-DRIVEN, IN BOTH WINDOWS.** `ResizeObserver` is delivered with the
  rendering steps, and an occluded window has those suspended — **measured: in a hidden pane
  it does not fire at all, not even on attach.** Same trap that froze the split mirror under
  `requestAnimationFrame`. `mouseup` + `beforeunload` carry the guarantee; the observer is
  the extra. **The controls window had the identical gap** and now gets the same trigger.
- **The card is RESIZABLE** (same pass), and remembers its size next to its position.
  `resize:both` needs a non-visible overflow, and the card had to become a **flex column** so
  `.vbody` absorbs the dragged height instead of the rows spilling past the border — which is
  why `display` now toggles to `"flex"`, never `"block"`.
  **THE SAVE IS ON `mouseup`, NOT ONLY `ResizeObserver`.** An observer is RENDERING-driven,
  and an occluded window has its rendering steps suspended — **measured here: in a hidden
  pane the observer does not fire at all, not even on attach.** That is the same trap that
  froze the window-split mirror when it used `requestAnimationFrame`; the note in the split
  section says "use setTimeout, not rAF" and this is the same rule wearing a different name.
  The observer is kept as the extra that catches a non-mouse resize.
- Controls-window CSS hides the chart/status/command bar, pins the buttons as a left column,
  and wraps each panel in
  a draggable+resizable `.uicard` (layout persisted to `localStorage`, key
  `asv_ui_cards_v1`).
- **Main is only stripped while a controls peer is actually alive** (`body.ui-split`, driven
  by presence pings). With `--single-window`, or if the controls window closes/crashes,
  everything returns to main and a **⏏ Controls** pill appears to reopen it — the console is
  never left without its toolbar.
- Server opens the second window 1 s after the first (sidesteps the pop-up blocker);
  `--single-window` skips it.

## BUOY-LINE KEEP-RIGHT: full backport (2026-07-28) — HISTORY, superseded
> Superseded by the CHANNEL LANE above (2026-07-31). Everything below describes the
> retired colour design; `keepRight` and its helpers are dead code. Retained for the
> record and because several of its *mechanisms* encode real failure modes.

The keep-right is now the sibling's current **IALA-B buoy-line generation** (the
old wall-only version lagged behind while routing work continued on the branded
console). Added: `MARK_TAIL`/`markId`/`markSystems`/`crossToLine` (mark identity +
buoy lines), `buoyageDir`/`buoyLaneAt`/`lastBuoyage`/`buoyageNote` (direction of
travel + signed lane constraint). Replaced with the current generation:
`buildKeepouts` (marks carry `num`/`sys`; returns grouped `sys`), `keepRight`
(buoy-lane tier + wall tier + open-water approach alignment, fast occupancy grid,
curvature limit, clear-water envelope), `channelEndExtend` (grid-aware), and
`drawMarks` (draws the buoy lines). The ASV's `channel_reach_m` vessel override is
preserved inside the new `keepRight`/`channelEndExtend` (the sibling hardcodes
`buf*10`). Banners now report the buoyage reading. Same-day routing fixes carried
in the same code: escalating-region long-goto fix and stitch/knot pruning were
already ported (`ea5e92a`, `85dcf55`). Verified at the time by the since-deleted
`tools/buoy_lane_test.js`
(ported alongside, cache picker keyed to the Erie transit): all checks green —
INBOUND/OUTBOUND direction read, 100% right-side in the fairway, no hairpin at
the buoy gap, no nogo violation, confidence guard holds.

## CHART SOURCE CARD (`SRC`) — backported 2026-07-29

The ENC's answer to a paper chart's title block, ported from the sibling. Server
`fetch_chart_info()` → **`/api/chartinfo?bbox=`** reads two S-57 META layers on the same
band the routing extract used: `Coverage_area` (M_COVR — cell identity; `DSNM`'s 3rd
character is the usage band) and `Quality_of_Data_area` (M_QUAL — `CATZOC`, survey dates,
source) **with geometry**, so confidence can be reported per position. Client `#chartPanel`
shows cell / usage / units / datum / correction, then the zone of confidence **under the
vessel**, amber at ZOC C or worse.

**Deliberately a separate endpoint** — folding M_COVR/M_QUAL into `ENC_ROLES` would bloat
every routing keep-out cache and force a `features_v3` → `v4` bump, dumping every cached
extract for data no route consults. Caches to `charts/enc/chartinfo_v1_<bbox>.json`;
soft-fails per layer and honours the ENC circuit breaker.

**Divergences from the sibling:**
1. ~~No multi-window UI split here~~ — **RESOLVED 2026-07-31**: the split was ported, and
   `#chartPanel` is now registered in `UI_BRIDGED`, the `ui-split` hide-list and
   `UI_CARD_TITLES` like every other pop-out. (It keeps its own `chartPanelHead` drag for
   the main window; in the controls window the `.uicard` grip moves it — same combination
   the sibling runs.)
2. **The nogo floor is VESSEL-DERIVED** (`hull.draft_m + planning.under_keel_clearance_m`),
   so the units tooltip quotes the live `NOGO_MIN_DEPTH_M` instead of the sibling's fixed
   1 m. Keep it dynamic on future ports.

**UNITS — display ≠ data.** The rendered NOAA tiles print soundings in **FEET**; the ENC
vector data and everything this console computes/logs (nogo floor, corrected depths) are
**METRES**. Verified empirically (the chart service's metadata endpoint 500s and the tile
request carries no units parameter): US `Depth_Area` bands come out at exact foot contours
(1.8/3.6/5.4/7.3/9.1/18.2 m = 6/12/18/24/30/60 ft) while the chart prints numbers only
consistent with feet. The card says both out loud. **Don't "fix" it to say metres.**

**Live-verified over the DriX base (Lewes, DE):** 4 cells (`US5DE1DF/DG/EF/EG`), 13 quality
polygons — 7 × ZOC B and **6 × ZOC D**, the lowest confidence class. The spawn resolves to
`US5DE1EF`, ZOC B, source `US,US,reprt,L-297/15`. Harness-tested against that real payload.

**Client-code style rule inherited with the port:** the extract-page-functions harnesses
desync on a nested backtick inside `${…}` and on a regex literal containing a quote — this
card uses plain concatenation and `split('"').join()`.

## Run it

```bash
python asv_console.py --sim --browser none --port 8791          # headless, for testing
python asv_console.py --sim                                     # opens a browser tab
python asv_console.py --sim --vessel example_usv_4m             # study a different ASV
```

- Web UI at `http://localhost:<port>/`; playback at `/playback`.
- Commands: `POST /api/cmd/{arm,upload,start,pause,stop,estop,rth,goto,hold,sethome,transit,speed,approach,energy,reset,spawn}`.
  `speed` and `approach` are LIVE tuning — they apply to a run in progress.
- Vessels: `GET /api/vessel` (active + params + available list), `GET /api/vessels` (list), `POST /api/vessel {id}` (switch — only when disarmed & idle).
- State + telemetry stream over SSE at `/events`; snapshot at `/api/state` (live telemetry is nested under `status`).
- Session recorder writes `logs/*.jsonl` (disable with `--no-log`); playback reads them via `/api/logs`, `/api/log?file=`.
- `--acm <host>` (generic VCU host) + `--transport {tcp,serial}` for a real link; `RealVcu` opens the transport but **refuses to actuate** (no wire format implemented — honest 409, never a fabricated frame).
- **AIS layer (2026-07-25):** selectable **AIS** on/off overlay of nearby vessels + an openable/closable draggable **AIS traffic table** (range/bearing/speed, nearest-first). Data from a **separate stdlib script `ais_service.py`** the console proxies at `/api/ais` (`--ais URL`, default `http://127.0.0.1:8788`). **Area is lake-aware, decided server-side** from the boat centre via `_lake_of`/`GREAT_LAKES_BOXES`: whole lake on a Great Lake, else a 50 km box (response carries an `area` tag). Sources: **digitraffic** (keyless REST), **aisstream** (global WS, minimal stdlib WS client), **nmea** (RTL-SDR/AIS-catcher AIVDM; bundled stdlib AIVDM decoder verified vs canonical vectors). **Zero-config key:** `ais_key.txt` (gitignored) or `$AISSTREAM_KEY`; `--source auto` picks aisstream if a key exists else digitraffic; `--bbox` needs `=` for a leading minus. Feeds + key live in the service, never the browser. **The console AUTO-STARTS `ais_service.py`** as a child in `main()` (`_start_ais_service`, after `apply_vessel` so the spawn is current): scopes `--bbox` to the operating area (whole lake via `_lake_of`, else a box around `SPAWN_LAT/LON`), reuses an already-running one, and passes `--parent-pid` so the service watchdog reaps itself on console exit — robust to a hard kill. `--no-ais-service` opts out. Same generic `ais_service.py` in the Z-Boat console. MarineTraffic scraping ruled out (ToS); no keyless US source. **LIVE-VERIFIED on Lake Erie (Z-Boat, 2026-07-25):** aisstream + the stdlib WS client work against the real server; whole-lake path returned `area: Lake Erie` with ~56 real vessels (lakers/tankers/tour/USCG). Gotcha: ship TYPE lags (~6-min AIS static cycle) — `cat` is "unknown" until a static msg arrives, then classifies right. Client draw/table still want a real-browser eyeball.

## Architecture

- **`VcuLink` seam** with two implementations: `SimVcu` (full boat model — GPS
  fix, waypoint-following autonomy, battery drain, wind/wave environmental
  effects) and `RealVcu` (transport + honest protocol stubs).
- **`Engine`** owns authoritative C2 state (armed / e-stop / run / plan) and the
  arming gates. The console comes up SAFE and read-only; every actuating command
  requires an explicit ARM.
- **Safety model:** the RC transmitter is master; this console is additive and
  cannot touch the RC autonomy switch or E-stop. Link-loss is safe (stop
  commanding, surface the vehicle failsafe: motors 0 / steering straight; never
  auto-resume). Commands are validated/clamped before encode.

## Vessel configuration (the single source of truth for a modeled ASV)

Every vessel-specific parameter lives in one self-contained `vessels/<id>.json`
file — hull/windage, speeds, turn rate, guidance gains, an **energy model**,
planning defaults (incl. under-keel clearance), and spawn. The console studies ASV
behavior **across vessel types**: `--vessel <id>` picks the active profile at
startup, and the UI's vessel picker (or `POST /api/vessel`) switches live when
disarmed & idle (the sim respawns with the new physics).

**Energy model** — `power.type` is `"battery"` (voltage that sags with load; block
`battery_v` + `drain`) or `"fuel"` (diesel litres burned at ~`idle + (full-idle)·
(v/vmax)^exp`; block `fuel`). Battery vessels report V/%, fuel vessels report
fuel %/endurance/range. Validation branches on the type. The DriX is `fuel`.

**Vessel-aware nogo** — the nogo depth floor is `hull.draft_m +
planning.under_keel_clearance_m` (a deep-draft boat avoids more shallow water). The
client reads it via `/api/vessel` and **re-extracts** the nogo model on a switch.

**COLREGS Rule 9 keep-right — SUPERSEDED 2026-07-31 by the CHANNEL LANE (see the top
of this file); the description below is the retired colour design, now dead code.**
(IALA-B buoy-line generation, backported 2026-07-28) —
every transit offsets to the starboard side of a channel. The primary channel model
is the **buoy lines**: lateral marks (ENC `chan_mark` role = buoys + beacons, with
`CATLAM`) carry their channel identity in OBJNAM — `markId()` strips the designator
to get the SYSTEM name + buoy NUMBER, `markSystems()` groups and sorts each system's
port-hand and starboard-hand marks into two polylines (the red line and the green
line), and `buoyageDir()` correlates buoy number against along-track distance to
read the **direction of travel** (numbers rising = INBOUND, red kept to starboard;
falling = OUTBOUND, green to starboard; ambiguous/short hop = no claim). At each
path sample `buoyLaneAt()` gives a SIGNED offset to the line that must be kept to
starboard — so a path on the wrong side is pulled back **across** the line, which a
purely geometric wall search can never see. Where no buoyage answers, a wall-based
tier takes over (both channel walls within reach → lane 20% right of center), and
in open water an approach-alignment query (`buoyLaneAt` with an extended fairway
projection) lines the track up with an upcoming buoyed channel instead of a blind
bias. The reach is `planning.channel_reach_m` (optional vessel override; falls back
to `nogo_buffer_m*10`, the tight-marina scale — the DriX sets 120 m for the ~150 m
Lewes fairway). The offset never trades away obstacle clearance (fast occupancy
grid + exact check), a curvature limit keeps the result followable, and
`channelEndExtend()` stands the track straight on out of a channel mouth.
`pairGates()`/`gateProject()` still steer a Go-To/RTH through the outermost gate
centre and one gate-width past it. Marks are small keep-outs (don't hit a buoy) and
drawn green (port-hand) / red (starboard-hand) with their buoy lines; Go-To/RTH/
Transit banners report the reading ("buoy lane INBOUND (red to starboard)").
Regression harness: `node tests/buoy_lane.js` — **run it after ANY routing change**
(it exercises the real page functions against synthetic marked/unmarked channels).

- **Server:** `load_vessel()` reads + `validate_vessel()` checks a profile at
  load (missing/mistyped field → clear, path-pointed error; a bad file never runs
  with placeholder physics). `apply_vessel()` publishes the values to the module
  globals `SimVcu` reads (`SPEED_KN`, `MAX_TURN_RATE_DEG_S`, `BATT_*`/`DRAIN_*` or
  `FUEL_*`, `POWER_TYPE`, `MIN_NAV_DEPTH_M`, `WP_*`, `WIND_*`, `SPAWN_*`, etc.).
  **Do not reintroduce hardcoded vessel constants** — add/adjust the vessel file.
- **Client:** `loadVessel()` fetches `/api/vessel` and drives the JS mirrors
  (`SPEED_KN`, `MAX_TURN_RATE_DEG_S`, `NOGO_BUFFER_M`, `NOGO_MIN_DEPTH_M`,
  search-pattern sizes) and the energy gauge (BATT vs FUEL), so server and UI agree.
- **Adding a vessel:** drop a new `vessels/<id>.json` (copy an existing one; it
  must be complete — validation requires every field). `vessels/zboat_1800hs.json`
  models the small survey ASV; `vessels/drix08.json` models the Exail DriX H-8 (7.71 m diesel USV; see
  its `notes` for official-spec vs doc-derived vs estimated figures); `vessels/example_usv_4m.json`
  is a larger illustrative USV for comparison. A profile may name a real modeled
  vessel (it's data); keep the console *core* generic (no vendor protocol / manual figures).

## Behaviors (all ENC-aware, arm-gated)

Go-To, Return-to-Home, Hold/station-keep, Set-Home, Transit (multi-vertex),
Search patterns (expanding box / sector / parallel), and Survey (CAMP-style
boustrophedon with Punch-Out clipping to NOAA ENC features + arbitrary polygon
clip). Punch-Out also **excludes a navigation channel when the survey spans across
it** (`channelSpanKeepouts`): a coverage line that runs outside→into the channel
→outside gets a gap there. The channel is the ENC **dredged area** OR the
**buoy-gate fairway** — `pairGates()` pairs the lateral marks and sweeps each gate
line ±one gate-width into a corridor polygon (so a marked inlet with no dredged
polygon is covered too). It applies ONLY to the survey-line clip, not to the transit
routing — so normal transits still cross the channel, and a survey confined *within*
a channel (never out→in→out) is unaffected. Every commanded motion routes
clear of a startup-built **nogo model**
(shoreline + manmade features + water shallower than a 1 m corrected floor),
with COLREGS Rule-9 keep-right in channels. Real-time water-level datum
correction from NOAA CO-OPS; wind/wave sim from NOAA NDBC buoys.

**Survey operational awareness & editing:** (1) hovering the survey line the ASV is
currently on (running survey) shows a time-to-end-of-line tooltip (remaining dist /
live SOG); (2) WPT mode edits a punched plan before Upload — drag a waypoint (its
line endpoint follows), click a waypoint to delete, click a line to delete it (+ its
endpoints), click open water to add; (3) the **LINES** panel shows a per-line table
(length, planned time = length/speed, and ACTUAL time accrued while running — keyed
off the boat's active line, robust to Upload re-routing), written to the session log
as a `client:survey_lines` event on run end (`POST /api/logevent`).

Public data sources (kept): NOAA ENC / ENCDirect ArcGIS, NOAA CO-OPS water
levels, NOAA NDBC buoys, NOAA chart tiles. All cached under `charts/`
(gitignored, regenerated at runtime).

## WATER LEVEL EARNS ITS CONFIDENCE BY DISTANCE (2026-08-01)

Andy saw an **Erie water level at Lewes**. Not a fault: the console had started on the
Erie vessel, the card **named** its station, and `update_position` forces a refetch past a
3 km move — but CO-OPS polls ~every 6 min, so the previous station's value stands in the
gap and *looks exactly as authoritative as a local one*. He diagnosed it himself.

`waterTrust(wl)` now bands the reading by the **nearest contributing station**:
`local` ≤ 25 km · `far` > 25 km (ghosted + italic) · `remote` > 75 km (heavily ghosted,
warn colour, explicit "not the local tide"). **Graphical, not textual** — translucency
reads as low confidence at a glance, so the operator never has to inspect a station name
on a number that is usually fine. Manual overrides are never ghosted (the operator set
them); `!ok` is not a distance problem and keeps the existing `!` mark.
**NEAREST decides, not the average** — averaging would ghost a good local blend that has
one distant station in it, and would let two remote stations either side average into a
falsely "local" reading. Test `node tests/water_trust.js` (9 assertions, teeth-verified:
averaging → 6 fails, no manual exemption → 4, swapped thresholds → 2 and 8).

**THE OFFSET IS ALSO GATED (Andy's call, done same day).** `effectiveWaterOffset()` is
what actually corrects charted depths for the NOGO model. A `remote` reading is SHOWN
(ghosted, so the operator can see what the distant station says) but **NOT APPLIED** —
routing falls back to chart datum, exactly as it already does with no data at all.
Otherwise an 800 km tide of +1.16 m makes shallow water look 1.16 m deeper than it is:
the same failure mode as trusting a chart symbol without its size. `far` IS still applied
— indicative, not irrelevant, and the ghosting says so. A change in the effective offset
(including the gate flipping) invalidates `patClip`, since the punched survey was clipped
against the old one. The card and tooltip state that the level is not being applied, so a
`+1.16 m` on screen can't be mistaken for a depth correction that happened.
**RESIDUAL, shared with the pre-existing no-data path:** chart datum is the LOW-water
reference, so if the real local tide is BELOW datum, charted depths are optimistic. The
manual override exists for that; the manual exemption lives in `waterTrust()` and ONLY
there (a duplicate guard in `effectiveWaterOffset` was unreachable and was removed —
an unreachable guard is one nobody is testing).

## THE END ACTION — what the card says a run ENDS as (2026-08-01)

**Andy's report:** with End of Plan = RTH the boat *does* come home at the end of a Go-To,
a Transit or a Survey — the chain works — but until it fired, every readout said the run
would LOITER. "An RTH triggered at end of mission should SHOW as an RTH."

**Same shape as the completion bug above, one layer up.** `run_completion` is the literal
completion the LINK was uploaded with, and for a Go-To/Transit/Hold that really is
`loiter`. What happens NEXT is the client's chain, which the readouts knew nothing about.
Each field was accurate about itself and **wrong about the boat**.

**`endAction()` is the third value, and the ONLY one the cards show.** The run's own
completion, upgraded to `rth` when the chain will fire and downgraded `rth`→`loiter` when
it cannot. `rthPending()` holds the preconditions: a home, ARM, no E-STOP, the **live**
setting (not the frozen uploaded one), a run that actually HOLDS (`runHolds()` — repeat
laps forever, complete stops, neither can chain), and `!rthChainFailed` (doRTH refused →
retract the promise; set only for `doRTH({chained:true})`, since the button hands it a
click Event). **The link holds for both `loiter` and `rth`; only the chain makes it a
return home** — so the field never decides on its own.

**Found live while verifying it, and worth more than the display fix:** the chain's
one-shot `rthChained` was re-armed only on the idle→running edge. The console lets you
command a second Go-To while the first is still running, so `run` never leaves `running`
and that edge never fires — the second run inherited a **spent chain** and held at its
endpoint indefinitely. Invisible before; now the card would advertise a return home for
five minutes. `rearmRthChain()` re-arms on **UNDER WAY** (`running && !holding`), which is
either a new commanded run (has earned its own chain) or the chained RTH itself (excluded
by the `behavior!=="rth"` guard). Holding — including the seconds `doRTH` spends routing —
never re-arms, so the one-shot still does its job.

**Test:** `node tests/end_action.js` — 16 assertions over the real page functions.
Teeth-verified: drop `runHolds()` → 10,11; drop the `rth`→`loiter` fallback → 6,12; read
`run_completion` instead of the live setting → 1,2,12; drop `rthChainFailed` → 9; drop the
armed/estop guards → 7,8; drop `behavior!=="rth"` → 5; re-arm on every running frame → 15;
re-arm only on idle→running (the old behaviour) → 14. **Live-verified** on a scratch
console: a Go-To under RTH reads `Type GOTO / End mode RTH` from the start, the hold reads
"END OF PLAN — returning home (RTH)", and a second Go-To commanded mid-run chains its own
RTH (before the fix it sat holding for 5 min).

## SANITIZATION: THE SIBLING'S IDENTITY IS OUT OF THE CORE (2026-08-01)

Andy's call on the long-standing flag. **The line that was drawn, and the one to keep
drawing:** the SIBLING CONSOLE's identity must not appear anywhere in this repo's code —
that is the thing this derivative exists to be sanitized from. **A modeled vessel's name is
DATA and stays** (`vessels/*.json`), including `DEFAULT_VESSEL_ID = "drix08"`, which is a
data key the core cannot avoid naming.

Cleared (five in the core, comments/docstrings all): the CHANNEL LANE header and the dead
`keepRight` divergence note in `static/asv.html` → "the sibling console"; the port-number
note and the `connect()` docstring in `asv_console.py`; and the spawn-override comments in
both, which named which vessel spawns where — replaced with "each profile carries its own
operating area", which is also **more accurate**, since it does not go stale when a
profile's spawn moves.

**STANDING CHECK — this must return nothing:**
```
grep -rniE "z-?boat|teledyne" --include=*.py --include=*.html --include=*.js . | grep -v vessels/
```

**Two things found while sweeping, both fixed:**
- `tests/buoy_lane.js` cited `static/routing.js` and the sibling's page as the source it
  reads. **Neither exists here** — it reads `static/asv.html`. A ported comment sending the
  next reader after a file that was never in this repo. The rule it now states: *the source
  a harness names must be the source it actually reads.*
- `tests/turn_geometry.js` had `const ZBOAT` / `const DRIX` labelled `"4 m USV"` / `"8 m
  USV"`. Renamed to `SMALL` / `LARGE` — but the labels were also **factually wrong**: those
  are `zboat_1800hs`'s numbers and that vessel is **1.9 m LOA**, not 4 m (the real 4 m
  profile, `example_usv_4m`, has neither those speeds nor that turn rate). The same
  mislabel had propagated into CLAUDE.md's turn-geometry section and README.md; both
  corrected. Data untouched, so the 21 assertions are unchanged and still pass.

## AIS RANGE: COLLECT WIDE, FILTER NARROW (2026-08-02)

**Andy asked for a range control on the AIS card, and specified the design:** subscribe at
**150 km**, default the control to **50 km**, filter to the operator's selection inside the
app, and **do not apply it to lakes — all contacts in a lake are still displayed.**

**That is better than what I was about to build, and worth understanding why.** One radius
used to drive BOTH the service subscription and the display query, which is where the
documented invariant "they must move together" came from: widening only the query filtered
against vessels the service had never subscribed to, and silently showed nothing new. My
instinct was to honour the invariant by re-scoping the subscription on every change — which
means restarting the child process while the operator drags a number. **Collecting wide and
filtering narrow DELETES the invariant.** Every radius up to the collect width is already in
hand, so a change is instant, needs no restart, and cannot out-run the subscription.

- `AIS_COLLECT_RADIUS_KM` (150, boot-only, `--ais-collect-km`) — what the service SUBSCRIBES
  to. `AIS_SHOW_RADIUS_KM` (50, live, `--ais-radius-km`) — what the operator looks at.
  `AIS_SEA_RADIUS_KM` is **retired**; the old flag now means the display radius.
- **Filtered SERVER-SIDE in the `/api/ais` proxy**, so the chart overlay, the table and the
  count cannot disagree — one decision about what is displayed. Verified live: rows and
  overlay matched at 50 / 150 / 10 km.
- **A true great-circle CIRCLE, not the collect box** — a contact in the box corner is ~1.4×
  the radius out and must not sneak in.
- **`POST /api/ais/radius` clamps to the collected width.** Asking to see 900 km would show
  nothing extra while implying the sea beyond is empty. The control snaps back to 150.
- **NOT APPLIED ON A LAKE.** The area is the whole lake and every contact stands. The card
  disables the input and says *"whole lake — all contacts"* rather than sitting there looking
  broken — a control that silently does nothing is the failure this console keeps re-learning.
- The row reports **"3 of 6 in 150 km"**, so *nothing out there* is distinguishable from
  *I narrowed it down myself*.

**Test:** `python tests/ais_range.py` — 8 assertions against a STUB provider at known ranges,
because the subject is what the console does with an answer, not whether a real feed has
traffic near the test machine today. Teeth-verified: drop the filter → 3,4,5,8; filter a lake
→ 6; filter by box → 3,4,5,8; unclamped radius → 7. **A flake fixed in the stub itself:** it
first routed queries by substring-matching the path and mis-served the lake case, failing
check 6 for a reason unrelated to the console. It filters by BBOX now, like a real provider —
a different filter from the console's range circle, so it cannot mask what is under test.

## SPEED IS A LIVE COMMAND, NOT A PROPERTY OF THE LAST UPLOAD (2026-08-02)

**Andy's report:** speed over ground is not changing with user speed changes; these must be
real time, with application-wide awareness of the ASV state and how it affects the sim.

**He was right, and the previous commit had made it worse-looking.** `f382b85` made a speed
change recompute every planning figure on screen — turn geometry, durations, per-line times.
It did not make the boat go faster, because **`SimVcu._speed_key` was set in exactly one
place: `upload_plan()`.** There was no speed command anywhere in the stack — no seam method,
no Engine method, no endpoint. The selector recorded an intention nothing acted on.

**The tell was sitting next to it in the command bar:** `Appr m` has been a live command all
along (`/api/cmd/approach` → `set_approach`). Speed had the same shape and none of the
plumbing.

- `VcuLink.set_speed` on the seam; `SimVcu.set_speed` applies it live; **`RealVcu.set_speed`
  refuses honestly** like every other actuating call.
- `Engine.set_speed` validates against **the active vessel's own `SPEED_KN`** (so a profile
  with different speeds validates against its own), commands the link, **persists to the
  mission store** so a later Upload re-sends the operator's choice instead of reverting, and
  sets `note` — which is a SALIENT field, so the session recorder snapshots it for free.
- `/api/cmd/speed`.
- **State publishes `speed_key` + `speed_target_kn`**, and `speed_key` rides `TELEM_FIELDS`
  so a playback can put commanded speed beside speed made good. The MISSION block's new
  **Speed** row shows the BOAT's value and turns warn if it disagrees with the selector —
  because these are two values that were silently disagreeing for as long as the command
  went nowhere.

**Live-verified:** under way, SOG **4.11 → 13.94 → 7.06 → 4.08 kn** as the selector moved
low → high → survey → low. (Slightly over target is the environmental set — correct.)

**Test:** `python tests/live_speed.py` — 10 assertions, drives a REAL console, because the
failure spans a command, the link's internal state and the persisted mission. **It has to
let the boat ACCELERATE**: asserting the command was accepted proves nothing, since the old
code accepted the selector change too and dropped it. Teeth-verified: restore the bug → 6,7;
stop publishing `speed_key` → 1 (at the readiness gate); no validation → 4; skip the persist
→ 8.

**A FLAKE CAUGHT AND FIXED IN THE TEST ITSELF:** the first version waited only for the
console to ANSWER, then asserted on a status that had no telemetry in it yet — checks 3 and
4b failed once and passed on re-run. **A test that fails for the wrong reason discredits
every assertion around it.** Readiness now means answering AND the link reporting a frame.

## PLAN SPEED IS AN INPUT, NOT A LABEL (2026-08-02)

**Andy's report:** the speed selection is not monitored when a change of speed for a given
plan is suggested; speed and end-of-plan settings should initiate recalculation on user
input.

**The "suggested" part is what makes it sharp.** Punch Out ALREADY advises on speed — when
the spacing is inside `2 × minTurnRadiusM(speed)` it quotes the spacing a plain reversal
needs at the plan speed AND at low speed, precisely so the operator can choose between
widening the lines and slowing down. Acting on that advice changed **nothing**: `#c_speed`
saved the value and recomputed nothing at all. **Advice the console then ignores is worse
than no advice.**

- `recalcForSpeed()` — if a punched pattern is still drawn, re-run `punchOut()`: it OWNS
  the whole recalculation and its chart extract is cached, so it is cheap. Live proof it is
  real work: the same plan went **7 teardrops → 7 semicircles** and the routed length
  **0.63 → 0.44 → 1.27 km** across survey → low → high.
- `recalcCommittedForSpeed()` — a COMMITTED plan cannot be re-punched (anchors gone), so
  durations are recomputed from `mission.waypoints`, and the reversal feasibility is
  re-checked using `committedPatternInfo().spacing`. **Slowing down is always safe** (the
  radius shrinks); **speeding up can make a committed reversal untrackable and the plan
  looks identical on the chart** — so that case, and only that case, is reported.
- **Also called from `commitPattern()`**: `resetPattern()` blanked the duration rows at the
  moment the plan became real — the same fault as the survey card, one row over.
- **End of plan**: the note said "applies on the next Upload", which was **half true in the
  dangerous direction**. The SETTING is live the moment it is saved — the RTH chain gates on
  `s.completion` every frame — so switching to RTH mid-run arms a return the operator may
  not expect. What waits for Upload is the completion the LINK is given.

**TWO GAPS THE LIVE RUN FOUND, both fixed:** the durations blanked at `Add to plan` (above),
and **the warning did not clear** — slowing back down left it on screen claiming the plan
could not be flown at a speed it was no longer set to. `speedWarnShown` clears it, and only
if OUR banner is still the one showing, so an unrelated banner is not wiped.

**Test:** `node tests/speed_recalc.js` — 10 assertions. Teeth-verified: radius instead of
DIAMETER → 2,3,5b; warn on every change (cry-wolf) → 1,4,5,5b; never clear → 5b; fixed speed
for durations → 7; no recompute → 6,7,7b. **Live-verified:** committed at low → sped up to
high (duration recomputed, warning raised quoting 24.9 m vs 57.8 m) → slowed back (recomputed,
warning cleared).

**NOTE for anything using `flashNote()`:** `onState` overwrites `#note` with the vessel's own
note every frame, so a flashNote is visible for well under a second. Anything the operator
must actually read belongs in `showBanner()` or a panel hint.

## THE SURVEY CARD BLANKED ON A COMMITTED PLAN (2026-08-02)

**Andy's report:** the survey card's information goes blank after uploading the plan; keep
the inputs until the user clears or resets. The blanking is actually at **`Add to plan`**,
one step earlier — `addPatternToPlan()` ends with `resetPattern()`, which drops the three
anchors, and **every figure on the card was derived from those anchors alone**. Spacing,
direction, line length, width and count all went at exactly the moment the operator most
wanted to check them: immediately before Upload. The plan was still there; the chart still
drew it. Only the card forgot.

**`committedPatternInfo()` DERIVES the figures from `mission.lines` — it does not remember
them.** A remembered snapshot is one more value that can drift from the plan, which is the
bug shape this repo has paid for most often. Deriving cannot disagree with the plan,
survives a page refresh for free (the mission persists server-side), and correctly follows
a plan edited in WPT mode — the card then describes what the plan IS, not what was typed.

- **SELF-VALIDATING, not `planKind`-gated.** `planKind` is NOT persisted and resets to
  `"survey"` on refresh, so gating on it would have described a committed SEARCH as a
  survey with meaningless spacing. Instead the lines must actually BE parallel (~2°).
  Expanding-box and sector searches get no figures; parallel-track lanes do, and correctly.
- **`width` is the measured across-plan extent**, not `spacing × (n−1)`, so an unevenly
  edited plan is described truthfully. `legLength` is the LONGEST line, not the first — a
  clipped plan has short end lines.
- **DIRECTION MUST MATCH THE TYPED CONVENTION.** A boustrophedon alternates end for end, so
  line 0's raw bearing is only defined modulo 180 — reading it raw returned the RECIPROCAL
  about half the time (caught live: typed 327, card read 147). `surveyPattern` derives
  direction as `across-bearing − 90`; this derives it the same way from the across-plan
  offset. A single-line plan has no across direction and falls back to its own bearing.
- `loadMission()` now calls `updatePatReadout()` — without it a committed plan read blank
  after every page refresh, since nothing else repaints the card on load.

**Clearing:** `CLR PLAN` empties `mission.lines`, so the card blanks with it. The SURV
`Reset` discards only the pattern being DRAWN — the card then reverts to describing the
committed plan, which is still in the mission and still on the chart. That is deliberate.

**Test:** `node tests/survey_card.js` — 11 assertions. Teeth-verified: restore the blanking
→ 1 (loudly); drop the parallel test → 8; first line's length instead of the longest → 5;
width as `spacing × (n−1)` → 7; gate on `planKind` again → 9. **Live-verified** end to end:
drawn → Add to plan → Upload → page refresh all hold 34.7 m / 029° / 188 m / 21 lines, and
CLR PLAN blanks it.

**Known cosmetic difference:** the drawn `width` is the pattern's nominal box width and the
committed one is the measured line-to-line extent, so they differ by the alignment margin
(seen live: 698 → 693 m). The measured figure is the more truthful of the two.

## THE SURVEY MOVE GRIP WAS DRAWN, LIVE, AND INVISIBLE (2026-08-01)

**Andy's report:** the SURV whole-pattern move handle "is not there — find it in zboat and
apply it here". **It had already been ported, completely.** `patMoveLL` / `patMoveScreen` /
the `"M"` branch of `patHandleAt` / `patMoveLast` / the translate-every-anchor drag are all
byte-identical to the sibling, and `drawPattern` diffs identical too. Measured on the
running page: the hit test returned `"M"` at the midpoint and a drag moved the pattern
rigidly with spacing/direction/width/count preserved exactly.

**So why "not there"? It was drawn INSIDE `drawPattern()`, which `render()` calls early —
and `render()` paints the boat marker near the END.** The grip sits at the A-B midpoint, and
the operator's normal move is to drive to the survey area and draw the box **around the
boat**. A 6 px grip under a 6 px boat disc plus its 26 px heading line is simply not there.
Measured: **ZERO grip-coloured pixels when the midpoint landed on the boat, 70 when it did
not.** Live, draggable, and invisible in the commonest case there is.

- `drawPatMoveGrip()` split out and called **last in `render()`**, just before
  `drawViolation`. Dark halo ring + outlined "move" label so it reads against the boat and
  the coverage lines. Worst case (grip exactly on the boat) went 0 → 24 amber px.
- **The real port gap was the HINT.** The sibling's `#sp_hint` names the grip in both
  variants; this port's copied the strings without the mention, so nothing on screen ever
  told the operator the handle existed. Ported verbatim.
- The hit-test tie-break is unchanged and load-bearing: **corners win**, so reshape stays
  reachable on a small pattern where the grip sits near a corner.

**DIVERGENCE FROM THE Z-BOAT, and it is now the only one in this feature.** The sibling
still draws its grip inside `drawPattern()` and has the same burial — it was never noticed
there. **A future re-port of the survey code from the sibling would silently undo this**;
`tests/pattern_move_grip.js` check 5 is what will catch that. The hint strings, by contrast,
now MATCH the sibling — that half was a plain port gap, not a divergence.

**The lesson, and it is the READOUT COROLLARY again in a different costume:** "the code is
ported" and "the operator can use it" are different claims. The diff was clean, the logic
was right, and the feature was still missing. **Verify a UI port by looking at the pixels,
not the diff** — the canvas sample is what found this in about a minute.

**Test:** `node tests/pattern_move_grip.js` — 7 assertions. 5 and 6 are deliberately
**source-order** assertions (canvas z-order is not observable without a full render
harness): the grip must NOT be drawn inside `drawPattern`, and `render()` must call
`drawPatMoveGrip()` after the boat marker (anchored on `getCSS("--asv")`). Teeth-verified:
grip back inside `drawPattern` → 5; no post-boat draw → 6; drop either hint mention → 7;
wrong anchor pair → 1,2; grip wins a tie → 4; 60 px hit radius → 3.

## THE NOGO ROW WAS STUCK ON "loading…" (2026-08-01)

**Andy's report:** "the nogo entry in both cards always shows ...loading". It did — and it
was a **repaint bug wearing a vague word**, not a wording problem.

`refreshNogo()`'s success path ended `rebuildNogo(); nogo.busy=false;` — and `rebuildNogo()`
finishes by calling `updateNogoUI()`. So the row was painted **while `busy` was still true**,
printed "loading…", and then nothing ever repainted it. **The one path that ends in a working
model was the one path that never showed it.** Every behaviour routed correctly off a model
the card insisted was still loading — the worst kind of stale readout: it reports NOT READY
about something that is. Fix: clear `busy` **before** `rebuildNogo()`.

**Then the wording, which was the real ask.** `nogoReadout()` names the STATE — the same
lesson the AIS table already learned about its link status. Four states, and the pair that
matters: **"clear water" and "no chart" both look like zero keep-outs and are opposite
facts** — one is open water, the other means nothing was checked and every route is direct
and unverified. `nogo.band` (set only by a SUCCESSFUL extract) is what tells them apart;
`nogo.ready` cannot, because it is false in both.

- reading → `reading chart… 6 s`, **counting seconds** so a hung chart service does not look
  like a slow first fetch. Ticked from `tickClock()` while `busy`.
- read → `334 zones · floor 2.3 m` (the floor is **vessel-derived**, so the operator sees
  what "shallow" means for the boat they are driving), tooltip broken down by the keep-outs'
  **own `kind` strings** — it can never invent a category the model does not have.
- clear water → `clear — none charted`, normal colour.
- no chart / failed → the reason, truncated in the row and whole in the tooltip, warn colour,
  and the tooltip says routes will go DIRECT. The `catch` now sets `nogo.note` instead of
  leaving the previous one standing.

**NO NEW STATE FIELD** — every state derives from `busy` / `nogo.band` / `nogo.note` / the
counts, so nothing can drift out of step with the model behaviours actually route against.
(Only `nogo.since`, a timestamp for the elapsed display.)

**Test:** `node tests/nogo_readout.js` — 15 assertions. 10–14 drive the **real**
`refreshNogo` → `rebuildNogo` → `updateNogoUI` with only the leaves stubbed (chart fetch,
keep-out builder, banner, DOM) and record every paint, because wording assertions alone
would never have caught a statement-ordering bug. Teeth-verified: **restore the original
order → 10,11 fail**; key off `nogo.ready` → 4,6; drop the busy branch → 1,2,12; drop the
elapsed counter → 2; fold no-chart into clear-water → 5,13,14; drop the article strip → 7;
untruncated note → 6; no note on the throw path → 14. Live at Lewes: `334 zones · floor
2.3 m`, tooltip `126 × dock / pier, 93 × shoreline, 57 × charted hazard, 37 × water
shallower than 2.3 m, 16 × land, 5 × channel buoy`.

**Two harness traps this suite hit, both worth remembering:**
1. `grab()` matches `"function NAME("` and **silently drops an `async` prefix** — the torn
   body was a SyntaxError (loud, luckily). It now grabs the modifier too.
2. A **stray top-level `process.exit()`** after the async IIFE ended the process at exit 0
   after check 9, silently skipping five checks. The summary now prints the number of
   checks that RAN.

## MISSION CARD MERGED INTO THE VESSEL-STATUS CARD (2026-08-01)

Andy's call, same pass. The operator was reading the boat on one card and its run on
another. `#missionPanel` is gone; its rows live in `#vcard` as `#v_mission`, a `.vsec`
shown only while there is a run to describe (`updateMissionCard()` now targets it).

- **The old `Run mode` row (`#v_mode`) is DELETED, not moved** — it was `behaviour ·
  completion`, which is exactly the block's `Type` + `End mode`. Merging means removing
  the duplicate, not carrying it.
- `#v_wpt` moved INTO the block (so the controls window's "drop what the top bar already
  shows" rule still hides it) and gained the old `mi_wpts` pre-upload fallback, as
  "N planned". `#mi_wpts` is gone.
- Removed with the panel: its drag/persist block (the orphaned `asv_missionpanel_pos_v1`
  key is left in localStorage), and its entries in `UI_BRIDGED`, `UI_CARD_TITLES` and the
  `ui-split` hide list. **The stale comment claiming this console has no Mission card is
  now true again.**
- `.vbody` gained `max-height:calc(100vh - 170px); overflow-y:auto` — the block pushed the
  card past a laptop viewport with a run up.
- Verified live in BOTH windows: main renders the merged card; the controls window shows
  one `.uicard` "Vessel" carrying the mission rows and no stale Mission card.

## END-OF-PLAN SETTING vs RUN COMPLETION — one field per concept (2026-08-01)

**Bug Andy hit (and had hit before):** End of Plan **RTH** selected, console acting on
**loiter**. Confirmed live — the mission store said `rth`, `/api/state` said `loiter`.

**Root cause: a CONFLATED FIELD.** `Engine.completion` was doing two unrelated jobs —
the operator's persistent END-OF-PLAN SETTING (owned by the mission store, decides what
happens when a survey/search PLAN finishes) *and* the completion of the RUN CURRENTLY IN
PROGRESS. Go-To / RTH / Hold / Transit all correctly station-keep at their own endpoint,
so `_run_route()` set the field to `"loiter"` — **and thereby overwrote the setting with
it.** Nothing restored it until the next `start()` re-read the mission. The command bar
still SHOWED RTH, the RUN MODE pill read `goto · loiter`, and the client's end-of-plan
RTH chain (which gates on that value) was silently disarmed in between.

**The robust fix is structural, not a patch — one field per concept:**
- `plan_completion()` — THE SETTING. Cached in `_PLAN_COMPLETION`, refreshed by
  `_cache_plan_completion()`, which **every** mission read and write funnels through, so
  the cache cannot drift from disk and the 4 Hz telemetry loop never touches the file.
  **No Engine method writes it** — that is the invariant that kills the whole bug class.
- `Engine.run_completion` — what the run in progress does at ITS end. `_run_route` sets
  `loiter` (correct for a Go-To); `start()` sets it from `plan_completion()`.
- **Both** are published: `completion` (setting) and `run_completion` (this run). Client:
  the command-bar selector and the RTH chain read `s.completion`; the cards read
  **`endAction()`**, which is built on `runCompletion()` — see the END ACTION section
  above; the RUN MODE row that read `runCompletion()` directly is gone.
  `syncCompletionSel()` mirrors the server's setting back into the selector (skipped
  while focused), so the two **cannot drift unnoticed**.

**Test:** `python tests/completion_modes.py` — 10 assertions, ~5 s, drives a REAL console
over the API because the failure was an interaction between a command and persisted
state, which a unit test of either half alone would have missed. In the pre-commit hook.
Teeth-verified: publishing `run_completion` as `completion` → 3,7,8,9 fail; `_run_route`
writing the setting (the exact old code) → 3,7; `start()` ignoring the setting → 10;
breaking the cache refresh → 8.

**Note on check 10:** the first version of this test passed all its mutations except
`start()` ignoring the setting, because it never STARTED a plan — the setting would have
been perfectly preserved and then never used. Preserving a setting and *honouring* it are
two assertions, and a test needs both. (The same pass also caught a flake in the test
itself: it assumed a position fix instead of waiting for one, so it failed on the wrong
check. A test that fails for the wrong reason discredits every assertion around it.)

## CHARTED POINT HAZARDS HAVE AN EXTENT (2026-08-01)

**Bug Andy hit:** a live Go-To out of Lewes planned straight over a charted wreck. The
wreck was fetched (`Wreck_point` → `hazard_point`), classified and enforced (`enf.haz`
defaults **true**) — the ENC side was fine. The failure was that `blocked()` gave EVERY
point keep-out a radius of exactly the nogo buffer, so a **wrecked ship, a mooring pile
and a channel buoy were the same object to the router**. At the 3 m buffer in the
report, a charted wreck was a 3 m obstacle: a route only had to miss the charted
position by 3 m to validate clear. **The buffer is a CLEARANCE MARGIN and was being
asked to double as the OBJECT'S EXTENT.** It cannot do both.

**Fix, three parts:**
- `hazExtent(f)` gives an intrinsic radius to hazards whose extent the chart does not
  give — `HAZ_UNKNOWN_EXTENT` = Wreck / Hulk / Obstruction / Underwater-Awash-Rock
  points. `WRECK_RADIUS_M` defaults **50 m**, vessel-configurable via
  `planning.wreck_radius_m`. The buffer is then added ON TOP as the margin. Piles,
  buoys and beacons keep extent 0 — the fix must not inflate every mark on the chart.
- **VALSOU is now used.** It was fetched in `ENC_KEEP_PROPS` and thrown away. A wreck
  with a charted sounding that clears `NOGO_MIN_DEPTH_M + WRECK_CLEAR_MARGIN_M`
  (tide-corrected by `waterOffset`, same as depth areas) collapses back to a point.
  **No VALSOU means UNKNOWN, and unknown takes the full berth** — not the reverse.
- `bufferFloor()`: the vessel's `planning.nogo_buffer_m` is a FLOOR. `loadMission` was
  doing `nogo.buffer = mission.buffer_m ?? 10`, so a plan saved against a small boat
  silently gave the DriX 3 m where its own file demands 5. Same vessel-staleness class
  as the ROC standoff. The operator can still widen it beyond the floor by hand.

**BOTH clearance paths had to learn it.** `blocked`/`blockedInfo` is the exact check;
`rasterKeepouts` is the A* occupancy grid, and it stamped each point into a SINGLE CELL
before the uniform buffer dilation. Fixing only the exact check would make the search
plan through the wreck and the leg then simply fail — no detour. The raster now stamps a
disc of `pt.r` first. Sized hazards also DRAW their circle (dashed red), so the operator
can see why a route swings wide instead of reading a bare cross as the whole danger.

**Verified against the REAL cached Lewes ENC** (6,210 features, 38 `Wreck_point`
records → 7 distinct wrecks): 5 have no VALSOU → 50 m extent → a leg 10 m abeam is now
REFUSED where it was clear; 2 carry VALSOU 4.5 m and 3.6 m → extent 0 → still passable
for the DriX's 2.3 m floor, which is correct. 161 of 448 point keep-outs are now sized.
**NOTE:** the wreck in Andy's screenshot may well be one of the VALSOU pair, which the
fix deliberately still allows — a wreck with 3.6 m over it is passable for a 2.0 m draft.

**Test:** `node tests/wreck_clearance.js` — 12 assertions, in the pre-commit hook.
Teeth-verified by mutation: bare-buffer radius → 4,5,6,12 fail; single-cell raster stamp
→ 9; no VALSOU branch → 2,10; extent on every class → 1,8; no `bufferFloor` → 11.

## SURVEY TURN GEOMETRY — radius decoupled from line spacing (2026-07-31)

`teardropTurn()` in `static\asv.html` builds every line-to-line reversal. **Two
shapes, one contract**: end on the next line aligned with its heading, at a radius
the boat can HOLD at the plan speed (`minTurnRadiusM` = `1.4 × v/ω` from the vessel
file's `max_turn_rate_deg_s`), nogo-validated before return.

- **Semicircle** — line offset ≥ `2×minR`. One 180° arc at *half the offset*,
  bulging outboard; reaches exactly `R` past the line ends. Unchanged behaviour.
- **Teardrop** — line offset < `2×minR`. Three tangent circles **at `minR`**: a short
  arc away from the next line, a >180° loop over the top, a short arc onto the line.
  In a frame with the entry at the origin, `+y` = exit heading, `+x` = towards the
  next line, offset `d`: `C1=(-R,0)`, `C3=(d+R,0)`, `C2=(d/2, √(4R² − ((d+2R)/2)²))`,
  tangent points at the centre midpoints. Solvable exactly when `d ≤ 2R` — precisely
  the case the semicircle can't serve — and it degenerates into the semicircle at
  `d = 2R`, so the two families agree on their shared boundary. Along-track offset
  between the line ends (clipped lines of unequal length) is absorbed by a straight
  run collinear with a survey line.

**WHY this exists.** The old code had only the semicircle, so a boat whose minimum
radius exceeded half the spacing got **no turn at all** and fell back to a "straight"
hop between anti-parallel line ends — which is a 180° reversal at half the spacing,
i.e. the exact radius just rejected as unflyable, only now unmodelled. Coupling the
turn radius to the line spacing meant a big boat on tight lines could never get a
turn: **the 7.71 m USV needs 14.4 m of radius at its 7 kn survey speed (28.9 m of
spacing) where the 1.9 m ASV needs 2.1 m (4.1 m)**, so ordinary small-boat line spacing
silently produced no teardrops at all. That symptom is what prompted the rework.

**Cost, and what the operator is told.** A teardrop reaches up to ~`2.75×minR` past
the line ends (vs `R` for the semicircle), so `punchOut()` reports the actual
excursion, the spacing a semicircle would need at the plan speed, and the spacing
needed at low speed. If even the teardrop hits a keep-out the reversal falls back to a
straight hop and the banner calls it **untrackable**, not merely routed — that is a
plan defect to act on, not a working turn. `turnMargin` (`spacing/2`) was deliberately
**left alone**: raising it to suit the teardrop would trade coverage off every line,
which is the operator's call, not a silent default.

**Known modelling limit (unchanged, but now load-bearing):** the sim caps yaw RATE,
not radius, so `minR` grows linearly with speed. Real hulls hold a roughly constant
minimum radius — Exail publishes ~8 m for the DriX H-8 at 14 kn, where the 20°/s cap
implies 20.6 m. The cap is calibrated at survey speed (10.3 m physical vs the spec's
~8–10 m), so it is right where surveys are planned and pessimistic at high speed.

**Test:** `node tests/turn_geometry.js` — 21 assertions over the real page functions
for both shipped vessels (shape selection, radius, curvature floor along the whole
path, exit alignment, turn-away direction, outboard excursion, the `d = 2R` boundary,
nogo refusal *and* its clear-water twin, along-track absorption, skew refusal, speed
as the operator's lever). **Run it after ANY change to the turn geometry.** Verified
with teeth: restoring the old clamp fails 3 checks, building the teardrop at half the
offset fails 6, reversing the middle sweep fails 4, dropping the nogo sweep fails 1.

## Testing notes

- Headless: `python asv_console.py --sim --browser none --port 8791`, then drive
  via the `/api/cmd/*` endpoints and read `/api/state` / `/events`.
- Geometry/routing regressions run offline against `static\asv.html` with plain
  Node (no deps, no server): `node tests/turn_geometry.js`, `node tests/buoy_lane.js`.
  **A pre-commit hook runs BOTH** when `static\asv.html` or either test is staged
  (`.githooks/pre-commit`, ported from the sibling 2026-07-31; enable per clone with
  `git config core.hooksPath .githooks`, bypass with `--no-verify`). `.gitattributes`
  pins `.githooks/**` to LF — a CRLF shebang breaks the interpreter on checkout.
- The map page canvas animates continuously — **browser-pane screenshots time
  out**; verify via DOM/`read_page` or the state endpoints instead.
- **CANVAS PIXEL SAMPLING is the way to check anything DRAWN** (found 2026-08-01, and it
  found the buried move grip). `canvas.getContext("2d").getImageData(x, y, w, h)` over a
  small box at a known screen point, then count pixels matching the feature's own colour —
  one `javascript_tool` call, no screenshot, immune to the animation. Two traps: the boat
  is drawn at the same place as several handles, so **place synthetic geometry AWAY from
  the boat** unless burial is what you are testing (an accidental overlap is what made the
  grip look broken, then proved it was); and `javascript_tool` caps at ~30 s, so long waits
  belong in a `setInterval` sampler read back by a later call — but note a **hidden browser
  pane throttles timers to ~1/min**, so trust the outcome, not the sample density.
- Windows/store-Python gotcha: a stray server process can hold the port and serve
  stale code. Check `netstat -ano | grep :<port>` and `taskkill //F //PID <n>`
  before retesting server changes.

## ROC + MOVING HOME (ported from the sibling 2026-08-01)

`roc_tracks.py` — Remote Operations Center tracking, GPS ingest, and a HOME that can
MOVE. Self-contained: it owns all ROC state and imports NOTHING from the console (the
console injects the boat-fix getter). Wired in at four points in `asv_console.py`:
`ROC = roc_tracks.RocTracker(...)` global · `GET/POST /api/roc` · `ENGINE.set_home_provider(
ROC.home_intent)` in `main()` · the Engine tick, which resolves HOME every telemetry
frame and runs the moving-HOME chase.

**Shore vs ship.** A shore ROC is a fixed antenna whose ARRIVAL POINT is offset by an
operator-entered range/bearing (the ramp). A ship (mothership) ROC moves, and its offset
is normally `relative` — measured from the ship's COURSE, so "50 m astern" stays astern
as she turns. `PLACE → EDIT → CONFIRM`: staged ROCs are editable and **cannot be HOME**;
confirming activates (and starts a ship steaming). Hold reverts to staged.

**The chase.** While an RTH follows a ROC, the run loop re-aims the boat at the current
arrival point, re-issuing a single-waypoint plan only once it has drifted past ~half the
arrival radius — reusing the link's own waypoint-follow, no separate pursuit controller.
A ROC home is driven DIRECT, not ENC-routed: a detour to a moving point is stale on
arrival. Any command leaving RTH/running clears the chase.

**VESSEL-DERIVED — the divergence from the sibling.** The sibling hardcodes a 50 m astern
standoff and has no closing check. Neither survives contact with this console's vessel
system, so both are re-derived in `apply_vessel()` via `roc_tracks.configure_vessel(v)`:
- `SHIP_RECOVERY_M` = `planning.roc.ship_recovery_m` if declared, else `max(20, 6×LOA)`.
  1.9 m boat → 20 m, 7.71 m → 46.3 m. Existing ROCs keep operator-entered offsets; only
  the default for NEW ships moves.
- `ASV_MAX_SPEED_KN` = `propulsion.speeds_kn.high`, backing `Roc.closing_kn()`/`closable()`.
  RTH to a moving mothership only converges with a real overtake margin; below
  `CLOSE_MARGIN_KN` the card, `home_intent` and the RTH note all say it is unreachable.
**This is the `HULL_A_LAT` staleness trap** — an import-time-only derived constant goes
stale on a live vessel switch. Verified live: DriX→small boat moved the new-ship default
46.3→20 m and re-based the closing check 14→6 kn.

`gps_sim.py` — NMEA-0183 emitter (RMC/GGA, XOR checksums, TCP server or UDP), the "real
GPS feed" stand-in. The tracker can spawn one per ROC (`--parent-pid` reaped). Ingest
verifies the checksum and rejects a void fix: a GPS feed is untrusted input.

**Test:** `python tests/roc_tracks.py` — 17 assertions, teeth-verified (drop the relative
branch → 4 fails; let a staged ROC be HOME → 6 fails; hardcode the standoff → 9 fails;
skip `configure_vessel` → 11 fails; skip the checksum → 14 fails). Run by the pre-commit
hook. Also ported in the same pass: the **Mission card** (then `#missionPanel`, one readout
for every commanded run; **merged into the vessel-status card later the same day** — see
that section) and the **SURV whole-pattern MOVE GRIP** (`patDrag==="M"` — crosshair
at the A-B centre translates all CAMP anchors by one delta; corner handles win hit-test
ties — **but it was buried under the boat marker and unmentioned in the hint until
2026-08-01; see that section**). **NOT ported, by decision:** the sonar/payload subsystem — it hardcodes a specific
two-sonar fit and would need a vessel-declared `payloads` block first, and the single-beam
echosounder console is built from vendor manual citations and proprietary telegrams that
this console's sanitization rules forbid.

## Keep docs current

**THE START HERE HANDOFF IS REFRESHED IN THE SAME COMMIT AS THE WORK — Andy's standing
instruction (2026-08-02). Not as a follow-up commit.** Five separate "refresh the handoff"
commits were made in one session, and **each one immediately falsified its own `HEAD` line**,
because the refresh moved the tip it had just named. Folding it in ends that: the handoff
lands with the change it describes, and there is no trailing docs commit to invalidate it.

**Which is why the "Repo" line no longer quotes a hash.** A self-referential pointer cannot
be right — a commit cannot name itself. The session list carries hashes, which are
historical facts that never rot, and the tip is one `git log --oneline -5` away.

**Every commit that changes behaviour updates, in that same commit:** the START HERE session
list (one line per commit) · any section the change touches · the suite table if a suite was
added · the relevant README(s) — `README.md` (overview + "Using it"), `README_SIM.md` (sim
model / command flow / endpoints / walkthrough), `README_PLAYBACK.md` · and
`node build_docs.js` if a generated document covers it. Internal-only refactors need none of
it — say so in the commit rather than silently skipping.

**THE WHOLE `docs/` SET IS GENERATED** (docx-js; `npm install` in `tools/` first; output
paths are script-relative). **Never hand-edit a docx** — edit its script and rebuild. If
one does get hand-edited in Word, diff the text against the generated version and fold the
edits back INTO the script. All four are brand-free by rule: the console core names no
vendor; vessel FILES may name real vessels, since that is data rather than branding.

```
cd tools && node build_docs.js     # rebuilds all four
```

| script | → `docs/` | for |
|---|---|---|
| `build_quickstart.js` | `asv-simulator-quick-start.docx` | first-time users, ~20 min to a running survey |
| `build_ops_manual.js` | `asv-simulator-operations-manual.docx` | operators: safety, display, every behaviour, contingencies, checklists (17 ch) |
| `build_tech_manual.js` | `asv-simulator-technical-manual.docx` | engineers: architecture, API, formats, extension (15 ch) |
| `build_dev_guide.js` | `asv-simulator-development-guide.docx` | contributors: testing philosophy, defect shapes, case studies (10 ch) |

**`tools/docx_kit.js` holds the shared formatting** — extracted 2026-08-02 when the set
grew to four, and the tech manual's `word/document.xml` is **byte-identical across that
extraction**, which is the only reason the refactor was safe. Add a document by writing
`build_<name>.js` against the kit, listing it in `build_docs.js`, and adding it to the
document-set table in the tech manual AND `README.md`.

## Not yet done

Git repo (local, no GitHub remote). `RealVcu` command/telemetry codecs are
unimplemented by design (this is a simulator). Design docs: `PLAN.md`,
`ASV_BEHAVIORS_PLAN.md`, `ENC_PUNCHOUT_PLAN.md`.

---

## SESSION CHECKPOINT — 2026-07-23 ("ASV Simulator Project Continued 1" handoff)

Full context for resuming in a fresh session. Everything below is committed
(clean working tree). `git log --oneline` is the authoritative record.

### How this project started
Derived from `D:\Claude\Zboat` (the Teledyne Z-Boat console) as a **sanitized,
brand-free generic ASV simulator**. All vendor/model/proprietary identity was
stripped (VCU not ACM; no ZBoat/Teledyne names, no proprietary wire protocol).
Then a **per-vessel config system** was added (`vessels/*.json`, single source of
truth loaded by server + served to client). Do NOT reintroduce brand identity into
the console core; vessel *files* may name real modeled vessels.

### Current state
- **Server running** (during dev) on port **8791**, active vessel **drix08**,
  logging ON (`logs/asv_*.jsonl`). Restart pattern: kill stale PIDs on the port
  first (see Testing notes), then `python asv_console.py --sim --vessel drix08`.
- **Vessels:** `drix08` is the **DEFAULT** (`DEFAULT_VESSEL_ID`) — it is the vessel
  actually operated, and the default also decides the AIS start-up scope (the service
  subscribes around the then-current spawn, so an Erie default left the traffic layer on
  the wrong water until a switch re-scoped it). `zboat_1800hs` (small battery ASV),
  `example_usv_4m` (battery),
  `drix08` = **Exail DriX H-8**, 7.71 m **diesel** (fuel model), operating from the
  **UDel Lewes facility** — spawn `38.789650, -75.160940` (Lewes-Rehoboth Canal
  centerline). DriX tuned params: `nogo_buffer_m 5`, `under_keel_clearance_m 0.3`
  (nogo floor 2.3 m), `channel_reach_m 120` (Rule 9 fairway reach for the wide
  Lewes channel), speeds 4/7/14 kn, `max_turn_rate_deg_s 20`.

### What was built this session (newest first — see commit hashes)
1. **Survey ops-awareness/editing:** hover current line → time-to-end tooltip;
   WPT-mode plan editing (drag waypoint / click-delete waypoint / **Shift**-click
   line to delete / plain click adds); **LINES** panel per-line table (length,
   plan, actual) logged as `client:survey_lines` via `POST /api/logevent`.
   Mission duration on Punch Out split into **Survey** + **Approach** vessel-card
   rows; TIME pill shows **local · UTC** (1 s ticker).
2. **Punch-Out channel exclusion:** a survey that SPANS ACROSS a channel excludes
   it from coverage (`channelSpanKeepouts`, survey-clip only — transits unaffected,
   internal-channel surveys unaffected). Channel = dredged area OR **buoy-gate
   fairway** (`pairGates` sweeps a corridor).
3. **Lateral channel marks (buoys/beacons):** server role `chan_mark` + `CATLAM`
   (cache bumped to `features_v3_`); client draws them (green port / red stbd),
   keeps clear, uses them as Rule 9 channel walls; `gateProject()` steers a
   Go-To/RTH through the outer gate centre and stands on past it.
4. **Rule 9 keep-right** vessel-tunable reach (`channel_reach_m`); DriX now keeps
   right in the ~150 m Lewes fairway (was tuned for tight marinas).
5. **DriX fixes:** couldn't route around ENC objects → buffer 10→5 m; UKC 0.5→0.3;
   spawn moved to Lewes (from Presque Isle).
6. **Trail:** persists across page refresh within a session, **dropped on sim
   reboot** (tagged with server `boot_id`).
7. **Named-reason nogo refusal highlight** for Go-To/RTH AND Survey/Transit/Punch
   Out legs (pulses the offending feature + ✕ marker; names the kind).
8. **Server:** suppress benign client-disconnect tracebacks; `boot_id` +
   `/api/logevent` + `/api/vessel(s)` endpoints; energy model (battery|fuel).

### NEEDS LIVE VERIFICATION (historical list — see the correction below). All were
unit/harness-tested where possible, but the click/drag/hover UX itself was unverified
in a real browser at the time:

> **The stated reason was WRONG and cost real coverage.** "localhost is blocked in the
> in-app browser" was never true — disproved 2026-08-02 by simply doing it
> (`preview_start` on `http://127.0.0.1:<port>/`, then `javascript_tool` to drive the
> page). Canvas screenshots do still time out, but `getImageData` reads the pixels
> instead. **A believed-blocked tool is worse than a missing one: nobody retries it.**
> Start a scratch console on a SPARE port so Andy's 8791 is untouched.
- WPT-mode waypoint **drag** feel + hit radius (10 px); **Shift**-click line delete.
- **Hover** time-to-end tooltip on the active line during a run.
- **LINES** panel live actuals + the auto-log on run end.
- Gate-pairing projection visually threading the Roosevelt Inlet jetty gate.

### Open threads / possible next
- Only ONE gate is charted in the Lewes ENC cell (Roosevelt Inlet jetty lights +
  Buoy 4); gate features engage only where marks exist.
- Mission-duration estimate is straight length ÷ speed (no turn/accel modeling).
- Could add a playback-viewer table view of the logged `survey_lines` events.

### Key gotchas learned (don't relearn these)
- **Client-side routing:** `routeAround`/`planNogoRoute`/`channelLaneRoute`
  are ALL browser JS (this list named `keepRight`/`gateProject` until they were
  deleted 2026-08-02). Driving via raw `/api/cmd/*` + `upload` with no `route`
  BYPASSES ENC routing → the boat crosses nogo. The GUI Punch-Out+Upload flow
  routes clear.
- **Go-To distance (2026-07-25):** two effects made distant Go-To inconsistent —
  (1) coverage: the nogo model is a ~5 km box and `doGoTo`/`doRTH`/`doTransit` didn't
  extend the fetch to the target (surveys do); (2) resolution: `routeAround`'s grid
  coarsens past ~4 km (cell = bbox/1400). **COVERAGE FIX shipped:** `ensureNogoCovers`
  (mirror of `ensureNogoArea`); the three behaviors are now `async` and `await` it
  (boat ⋃ target) before planning. **Resolution fix also shipped:** `routeAroundSeg`
  splits a leg >~4.5 km into ~2.2 km sub-legs (each keeps the fine 3 m grid), routes
  each with `routeAround`, stitches; `legPath` calls it. Safe by construction (falls
  back to a single `routeAround`); short legs byte-identical. Harness-validated on the
  Z-Boat (same code). Live GUI spot-check owed.
- **Stale server PIDs** on Windows hold the port and serve old code — always kill
  by PID before retesting server changes.
- **Testing pattern that works well:** extract the real JS functions from
  `static/asv.html` with a brace-balance grabber into a Node harness and run
  against real ENC fetched from `/api/enc` (see the many scratchpad `*.js` tests).
- Delete a stale `mission.json` to pick up new vessel defaults (it persists old
  buffer/arrival).
- **NDBC station id case:** `activestations.xml` lists coastal / C-MAN ids in
  **lowercase** (`lwsd1`, `cman4`), but the realtime2 data files are served under
  **UPPERCASE** (`LWSD1.txt`) — using the raw id 404s and silently drops the nearest
  local wind stations (near Lewes it fell back to a buoy 55 km out). Ids are now
  normalised to uppercase at ingestion + at the data URL; keep them that way.
