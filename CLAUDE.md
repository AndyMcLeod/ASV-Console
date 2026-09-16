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

`grep -rniP "teledyne|z-?boat(?!_[a-z0-9])" --include=*.py --include=*.html --include=*.js . | grep -v vessels/`

**⚠ THE LOOKAHEAD IS THE DATA-KEY ALLOWANCE, AND THE CHECK WAS WRONG WITHOUT IT
(fixed 2026-08-26).** The rule above has always permitted a profile *id*; the
grep did not, so it reddened on the six `zboat_1800hs` lines in `data_routes.py`
— a check that flags what its own rule allows is one people learn to ignore, and
this one had been ignored long enough that nine REAL prose hits were sitting
behind the noise. `(?!_[a-z0-9])` says: the brand followed by an id tail is a
data key; the brand standing alone is branding. **`-P`, not `-E`** — a negative
lookahead needs PCRE. It still catches a line carrying BOTH, which is why this
is one command rather than a second `grep -v` that would hide such a line.

**⇒ AND IT IS CLEAN AS OF 2026-08-26.** Fixing the grep surfaced NINE prose hits
that the `zboat_1800hs` noise had been hiding — `static/js/state.js`,
`static/asv.html`, and seven in `tests/survey_card.js`. All nine are scrubbed;
Andy's call, quotes included.

**⚠ A QUOTATION IS ALTERED IN BRACKETS, NEVER SILENTLY.** Four of them quoted
him verbatim, and the replacement reads *"for the [small-class boat] this would
be fine"* with a line beside it saying the brackets are a substitution.
Reworded without saying so, a quotation stops being evidence of what was
actually asked for — which is the only reason to keep quoting him at all.

**⇒ THE HOUSE WORD IS "the small-class boat"**, matching `vessels/*.json`'s own
`"class": "small survey ASV"`. Where a check wants to name the thing exactly,
the PROFILE ID is the sanitized way to do it and the grep now permits it:
`17b`'s detail line reads `drix08=80 zboat_1800hs=0`.

**⚠ AND NOTHING RUNS THIS.** It lives here as prose, so it is a check only when
somebody types it — which is how it stayed wrong. The hook globs `tests/*.py`,
so a suite added there runs the day it is written.

**The rule is scoped to CODE.** THIS FILE deliberately names the sibling and its path — a
maintainer has to be able to find it — which is why the check above filters by source
extension. Don't "finish the job" by scrubbing the maintainer notes.

## ⇒ START HERE (handoff refreshed 2026-09-16 — supervision (#14) FIXED after Andy found it broken; #30 waits on him; the Eastport question is OPEN)

### ➤ PICK UP HERE

**HANDOFF, 2026-09-16. READ THIS BLOCK FIRST, THEN THE 09-15 ONE UNDER IT (how items are built still holds).**

* **ANDY: "the supervisory tab process is broken. Look at current running instance and fix it."** Fixed in one commit
  (the newest block below). He declined a screen view twice; the diagnosis came from his session recording,
  `logs/asv_20260916-082026.jsonl`, and was then reproduced and checked on a throwaway console in headless Edge.
* **STATE:** `master` carries the fix, `34326641`, and the route-order write-up, `18033a5b`, both pushed; 89 suites (all green through the hook); his mission.json / ports.json / comms_config.json
  hash-checked unchanged. ⚠ His own console changed his plan at 08:24:44 (now 465 waypoints over 48 lines - the SURV
  pattern he drew that morning); that is his work, not ours.
* **⚠ HOW IT GOES LIVE ON HIS MACHINE - SAY THIS TO HIM EVERY TIME:** his console (started 08:20 with `--sim`) runs
  the working tree. The PAGE half needs BOTH windows reloaded and the SERVER half needs a restart - and a restart OPENS
  TWO NEW WINDOWS while the old two reconnect, so: close both console windows, restart the console, use the two it
  opens. An old page left open keeps the old timer-driven report, and an old controls window will still compete.
* **LATER THE SAME DAY: "how a route plan is made" WRITTEN DOWN** (the newest block below) - and it found two things now WITH ANDY: a punched survey can start on the FAR side of the box, and a RED reversal is not blocked from being committed or uploaded.
* **OPEN, NOT DONE (each is written up at the end of the supervision block):** a woken page acting on stale buffered
  frames; `render()` on every frame whatever the visibility, and the first real record of #29's hang - both offered to
  Andy as separate tasks the same day. #30 and the Eastport line are unchanged.

**HANDOFF, 2026-09-15 (context window change).**

* **STATE:** `master` carries review #28, pushed; 89 suites; Andy's mission.json / ports.json /
  comms_config.json unchanged by any of this (hash-checked before every commit). His console was OFF throughout
  (nothing on 8790-8799).
  **Everything in this file from before 2026-09-05 is in `HANDOFF_ARCHIVE.md` now (review #26) - see the pointer
  section below the 09-05 handoff.**
* **APPROVAL MODE: CARRY ON.** The review ran one item at a time: build, verify (suites + mutations + live check + docs +
  this handoff), report, WAIT for Andy's "approved", commit, push. Late 2026-09-14 he said, from his iPhone, "Carry on
  all updates until the following session ends", and #12, #13, #15, #17, #18 and #19 went in without per-item approval.
  The next context (2026-09-15) opened with "carry on with updates from previous ASV Console Refinement context window",
  taken as the answer: items go in back to back (build -> verify -> commit -> push), reported as each lands.
* **#20-#27 ARE ALL DONE** (below), #23 and #24 included. 2026-09-15, after answering the retention question, Andy
  said **"carry on with the remaining items from the list of 30. Act on your own best recommendation"** - so what he
  had reserved is being worked in the order #23, #14, #29, #28, with #30 STATED rather than guessed (it needs his
  account details). The local branch `wip/review-20-line-table` (`98a33418`)
  that carried #20 half-built across the context change is superseded by its commit (`a3a1db57`) and was deleted.
* **THE REST OF ANDY'S 2026-09-14 LIST, IN ITS OWN WORDS** (the list itself lives only in that conversation):
  * **Still open:** only #30, and only for want of his account details (the newest block says exactly what). #24's retention question, #23, #14, #29 and #28 are built (below) - and #28 answers
    the CLASS of the Eastport question rather than that one line, which still needs his SURV ->
    RESET answer; #19 addresses the confusion behind it); #29 the page hang placing survey corners A/B/C (never
    isolated; first question: does it happen with a real mouse?); #30 MarineTraffic AIS (on hold until he knows which
    service is enabled and has a sample response with the key removed).
* **HOW THE ITEMS WERE BUILT (the next context has none of the session scratchpad):**
  * A SCRATCH CLONE of this repo (`git clone D:\Claude\ASV <scratch>`, reset to the tip) for building and for
    mutation runs, so a killed runner can never leave the real source mutated. Copy the changed files back with
    patch scripts (exact-anchor replace, EOL detected per file - asv.html is CRLF, static/js/chart.js is LF) or
    whole files, and diff the result against the clone. Docs in the clone need `NODE_PATH=D:/Claude/ASV/tools/node_modules`.
  * Write patch scripts with the Write tool, never a bash heredoc: heredocs mangled `\n` escapes and backslashes, twice.
  * Before any run that WRITES, copy mission.json / ports.json / comms_config.json aside and hash them; check the
    hashes before every commit. `--state-dir` keeps test consoles out of his files; in-process suites call
    `use_state_dir`.
  * LIVE CHECKS on a temp COPY of the program (asv_console.py, currents.py, roc_tracks.py, gps_sim.py, ais_service.py,
    ports.default.json, vessels/, static/) with `--sim --browser none --port 8796 --no-ais-service --no-log --state-dir
    <temp>`. NEVER open a page on his console (8791). The in-app browser's javascript tool runs in an ISOLATED world and
    the page's bindings are module-scoped: to read page state, put a probe hook in the COPY's asv.html and read it
    through an injected `<script>` that writes to a DOM data attribute. The DOM itself IS shared: that tool can click
    the page's own buttons (`#linesBtn`, `#b_arm`, `#b_upload`, `#b_start`) and run a MutationObserver (how #20 was
    measured). ⚠ Andy's Eastport home is AT THE PIER, so a Start there hands the boat to the guard's HELM rung (an
    escape, "holding clear, awaiting the operator") before any line - to watch a survey run, POST `/api/cmd/spawn`
    `{lat, lon}` of the plan's first waypoint to the TEMP console first, then Arm / Upload / Start in the page.
  * A new suite needs, in the SAME commit: a GUARDS entry in tools/build_tech_manual.js, an `advice_for` entry in
    .githooks/pre-commit, a TEETH list of RECORDED mutation results in its header, and a docs rebuild (`cd tools &&
    node build_docs.js`, then `git checkout --` the docx files whose builders did not change).
  * Commit: stage BY NAME, `git commit -F <msg>` in the background (the hook runs every suite, ~15 min; Markdown-only
    commits skip it), then push. A session that ends mid-hook leaves the item STAGED, not committed - check `git log`.
    The "geometric repack" error on fetch/commit is harmless.

**NEWEST, 2026-09-16: HOW A SURVEY PLAN BECOMES THE ROUTE THE BOAT RUNS - WRITTEN DOWN, AND WHAT THAT FOUND.**
Andy: "Describe in detail how a route plan is made based on an uploaded survey plan. What determines waypoint and line
sequencing. If this is in the documentation already tell me where. If its not then add it in." It was NOT - the README
had one sentence ("re-ordered (Boustrophedon Cellular Decomposition)") and the technical manual one bullet. Now:
README "How the plan becomes the route the boat runs" (replacing that sentence), the operations manual's new 9.9, the
technical manual's new 8.3 (8.3.1-8.3.6), and `tests/survey_order.js` (13 checks; 20 mutations, 20 caught) pinning every
rule they state. "Uploaded" was read as the plan built in the console and sent with Upload - there is no file import.

* **THE CHAIN:** surveyPattern (line 1 at A, alternating, stepping toward B) -> boundary + keep-out clip (direction kept)
  -> keptRuns (strikes) -> `regionOrder` (static/js/passage.js: BCD cells, first cell = lowest across-index, next cell =
  greedy nearest, each cell swept from its lowest index, each run entered at the end nearer the last exit, empty indexes
  skipped) -> shorten by max(2, spacing/2) -> drop short -> leads -> the pair loop (reversal: headings 180 +/- 50 and a gap
  under GAP_LINES + 0.6 spacings -> turnWithRetry; else straight / routeAround / red) -> commitPattern APPENDS (ends, then
  `turn:true` joining points) -> doUpload/routePlan in order from the fix (Rule 9 on leg 0 only; positions only) -> the
  vessel steps through by index -> currentLegLine calls a leg a line only when both ends match within 5 m.
* **⚠ FOUND 1 - THE START CORNER IS NOT ALWAYS THE START.** The across axis points toward the THIRD click, so index 0 is
  the outermost line AWAY from it: line 1 at A only when the pattern fills toward C. When B and C lie on opposite sides
  of line 1 the punched survey starts on the FAR side of the box and works back (with an even line count, from the far
  end of that line). An un-punched plan always starts at A. Measured with the page's own functions (checks 1-2), and the
  UI calls A the "start corner". Documented as it is; ANDY ASKED whether the punched order should start at A.
* **⚠ FOUND 2 - A RED REVERSAL IS NOT ENFORCED, THOUGH THREE PLACES SAID IT WAS.** `patUnsafe` is only drawn and
  bannered; `commitPattern`'s resetPattern clears it; the committed plan keeps a straight leg between the two line ends
  (no joining points); and Upload's routePlan finds that leg clear - so a pair every turn rung refused can be committed
  and uploaded as exactly the unflyable 180 the pair loop refuses to ship (the wharf class). The README ("flagged unsafe
  and Upload blocks") and two punchOut comments said otherwise; all three now say what happens, the operations manual's
  9.5.1 note warns operators, and ANDY ASKED whether to block Add to plan (page-only) or carry the red into the plan and
  block Upload. Found by reading the code - not reproduced live.
* **ALSO WRITTEN DOWN:** SHIFT-deleting a committed line removes its two ENDS only, so the turns either side stay and the
  boat still travels that line's track, uncounted (check 7b); a WPT click appends at the END; several patterns run in
  the order added; a survey line that the model now blocks gets a detour at Upload and stops counting as a line.
* The stale `regionOrder` header ("Option 1 flags rather than auto-routing around") is corrected - punchOut never used
  its `unsafe`. Docs rebuilt; pages not rasterized (no LibreOffice); text read back out of both built manuals.
  Commit `18033a5b`, pushed. Andy's own edit to the technical manual that evening (one comma, 8.1) was ported into
  the builder first - his saved copy is in that session's scratchpad, not the repo.

**BEFORE THAT, 2026-09-16: "THE SUPERVISORY TAB PROCESS IS BROKEN" - REVIEW #14 AS BUILT FOUGHT THE CONSOLE'S OWN TWO WINDOWS.**
His console had run #14 for twelve minutes when he said it. The recording shows the post changing hands TEN times,
between his two pages: `7d444994` is the CONTROLS window (its page_stall records carry 0 waypoints and `run: null` -
it opens no stream) and `5d61fe94` the chart window (the only one with a TAKE OVER pill, pressed at 08:25:25).

* **THREE FAULTS, THREE RULES** (asv_console.py's SUPERVISION header and static/asv.html's supervision block say each
  in full):
  1. **THE CONTROLS WINDOW REPORTED IN.** It is the same page under `?panel=controls`: no stream, no ladder, every
     click forwarded to the chart window over the `asv_ui` BroadcastChannel. Holding the post it made the chart window
     refuse everything - the forwarded clicks included - and left NO page acting: 08:25:54-08:29:27 with the boat
     armed. **`SUPERVISES = UIROLE === "main"`**: the controls window never reports or releases, its `supervising()`
     is always false, and its own `cmd()` refusal says so in its own words.
  2. **THE REPORT RODE A TIMER; THE LADDER RIDES THE STREAM.** Measured (headless Edge 153, own temp profile, a CDP
     background tab): 91 s hidden, ONE timer wake-up in 30 s against 121 frames handled - and the old code logged a
     lapse and a recovery every minute while onState ran four times a second. **`supervisorReport()`** now runs from
     `onFrame` AFTER `onState` (a frame whose ladder threw is no report) and from the stream's named **`tick`**,
     which `_serve_events` sends whenever a beat passes with no frame (no link yet, a link lost) - once per beat,
     never from a timer. **`supervisorStreamed()`** measures the gap between stream events: over the stale time it
     writes **`page_asleep`** {gap_s, supervising, began_hidden} (`page_throttled` is gone) and raises the ASLEEP
     banner when the gap BEGAN off screen. `supervisorStreamLost()` (the stream's onerror) drops the measurement, so
     a console restart is not a sleep. The page adopts the state's `beat_s` / `stale_s`.
  3. **A TAB BACK FROM ITS OWN SILENCE TOOK THE STALE POST** - the once-a-minute ping-pong of 08:29-08:32.
     `Supervision.beat` now gives a STALE post only to a **steady** reporter (previous report within
     `SUPERVISOR_STALE_S`); an EMPTY post still goes to the first tab that reports.
  And **`SUPERVISOR_STALE_S` 6 -> 10 s**: every lapse in that session was 6.3-6.9 s old, and a page carrying his plan
  (465 waypoints, 1,460 keep-out features) was measured stalling 1.5-4.1 s at a time while idle.
* **AND REVIEW #29'S WATCHDOG, BECAUSE THE SAME SESSION BROKE IT:** a gap is a stall iff it BEGAN on screen
  (`stallOnScreen`, taken at the tick before the gap). His 219 s gap began a second after he pressed Arm (08:25:47)
  and ended off screen - recorded only as throttling, with nothing about what the page was doing - and the old rule
  also wrote up (and said) a stall every time the operator came back to a background tab. The stall banner is said
  only on a page that is on screen.
* **LIVE** (throwaway console on 8796 with a probe in the COPY; headless Edge driven over CDP by a 60-line client in
  the session scratchpad; chart and controls windows opened as hidden background tabs): one `supervisor_took`,
  `tabs: 1`, no lapse for 2+ minutes with timers at 0-1 per 30 s; a 15 s CDP freeze of the chart window lapsed at
  10.1 s, the controls window did not take over, and the thaw wrote page_asleep 15 s began_hidden, put up the ASLEEP
  banner and reported back; a SECOND chart window took the post 10 s after the holder froze, and the thawed one
  showed VIEW ONLY; with the link dropped the holder kept reporting on ticks (age never over 2 s in 70 s).
  ⚠ HEADLESS EDGE PUT BOTH HIDDEN BACKGROUND TABS TO SLEEP about five minutes in (a MessageChannel post and a fetch
  both went unanswered) - true lapses, correctly alarmed. The remedy stays Edge's "Never put these sites to sleep".
* **BUILT, THEN DROPPED: a VIEW ONLY mark on the controls column** (a mirrored class). The controls window's clicks
  go to EVERY chart window in the browser, and it mirrors whichever pushed last - so with two chart windows the mark
  flickered while the clicks worked (the holder carries them out). Not shipped; the docs say what does happen.
* **TESTS:** supervisor.py 8 / 8b / 8c / 10b (15 checks; 9 mutations run, 9 caught); supervisor_page.js rewritten
  around the stream (16 checks; 22 mutations, 22 caught, none by a crash); frame_health.js 11 / 11b / 11c and two
  onFrame stubs (17 checks; 4 mutations, 4 caught). The other 53 JS suites unchanged and green. WORDS: README
  ("Using it", and the stall paragraph), the operations manual's 15.1, the technical manual's 6.2b (two new
  paragraphs) and three GUARDS entries, the hook's advice for all three suites. Pages not rasterized: no LibreOffice
  on this machine; the text was read back out of the built documents instead. Commit `34326641`.
* **OPEN - SEEN, NOT FIXED:**
  * A PAGE WOKEN FROM A FREEZE RUNS ITS LADDER ON STALE FRAMES. The browser buffers the stream while the page is
    frozen and delivers it on waking, and onState acts on every one of them (with `act` true, since the page still
    holds the post) before its first report can come back. Frames carry no server time to judge them by. The old
    code did the same; this fix does not change it. Worth a staleness guard of its own.
  * `render()` REDRAWS THE WHOLE CHART SYNCHRONOUSLY ON EVERY FRAME, visible or not - with his plan loaded that is
    the 1.5-4.1 s stalls above, off screen included.
  * THE FIRST REAL RECORD OF #29's HANG: `page_stall` 20.2 s at 08:24:08, survey mode, corners A, B and C down,
    40 runs, 1,314 keep-out features - he was placing a pattern at New Castle. Reproducible from those numbers.
  * CHECKED, NOT A GAP: `/api/connect` and `/api/disconnect` sit outside `/api/cmd/`, so supervision does not gate
    them - but the console page never calls them (only playback.html names them, to label recorded commands), and a
    caller with no tab name is exempt by design.

**BEFORE THAT, 2026-09-16: REVIEW ITEM #30 - MARINETRAFFIC IS NOT BUILT, AND WHY.**
Andy's item: MarineTraffic AIS. It stayed on hold because it CANNOT be built honestly from here, and guessing would
put an adapter in the repo that looks supported and fails on the water.

* WHAT THE CONSOLE ALREADY HAS: ais_service.py carries five sources behind ONE MMSI-keyed Registry - aisstream,
  digitraffic, aishub, nmea, opencpn - each a `Source` subclass with a name, an endpoint, a poll interval, a fetch
  and a normalize, plus an entry in `Registry.PRIORITY`. MarineTraffic would be a sixth of about a hundred lines,
  beside `DigitrafficSource`, with its own suite. The KEY never leaves the service: the console proxies /api/ais so
  the browser never sees a key, and no key is ever put in a URL the page holds.
* ⚠ WHAT IS MISSING IS NOT EFFORT, IT IS THE SHAPE OF THE ANSWER. MarineTraffic sells several products that return
  DIFFERENT fields at different rates (a fleet's positions, an area export, a live stream), and an adapter written
  against the wrong one is wrong in a way no test here would catch.
* SO, THREE THINGS FROM HIM, and it is an afternoon's work after that: (1) which product/endpoint his account has
  enabled, by name; (2) ONE sample response with the key removed - two or three vessels is plenty; (3) the plan's
  rate limit (calls per minute, or credits) and whether it is polled or streamed.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #28 - THE CHART SAYS WHAT A LINE IS.**
Andy, at Eastport: "What is the story with the line heading out to the northwest?" ... "its a green dashed line like a
survey line". ⚠ THE ANSWER TO THAT PARTICULAR LINE IS STILL WITH HIM (SURV -> RESET tells him whether it was the
uncommitted pattern preview). What is built is the answer to the CLASS: he should never have to ask again.

* RIGHT-CLICK -> "What is this line?" names the layer under the click, in the legend's own words: a committed survey
  line (yellow, with its number, length and heading), the uploaded route (green, the only green), the PATTERN PREVIEW
  (cyan, NOT in the plan - and it names both ways out, ADD TO PLAN or SURV then RESET), the survey boundary, a
  measurement (magenta, never uploaded), the trail, or a keep-out. The NEAREST feature within `IDENTIFY_PX` (14 px)
  wins - across layers, not by scan order - and a click near nothing says so rather than naming the nearest line.
* It READS: `#cmWhat` is gated on nothing - no link, disarmed, and in a view-only tab (review #14) alike.
* ⚠⚠ THE LIVE CHECK CAUGHT A BUG THE SUITE HAD AGREED WITH. The keep-out model's entries are `{pts}` / `{ring}` of
  `{e,n}` IN THE CONSOLE'S FLAT PLANE; the first version read them as bare lat/lon arrays, found nothing, and said
  nothing - and the fixture had copied its shape from my code instead of from the model, so the suite passed. A grid
  of clicks over New Castle's 1,083 features identified NOT ONE. The fixture goes through a real `planeFrame` and real
  `bbOf` boxes now, and three mutations cover the shape, the plane and the box test.
* ⚠ AND THE FIRST FIX WAS TOO SLOW TO SHIP: 210-320 ms a click on that model, which is a visible pause on a menu row
  in the console review #29 exists for. It skips by the model's OWN bounding boxes (`inBB`, with the 14 px reach
  converted to metres at the current zoom) - measured live again: 1-36 ms. ⚠ A KEEP-OUT LINE'S BOX HAS ZERO HEIGHT, so
  the reach has to be carried INTO the box test; check 3b is the only fixture shape that can tell that from a dead-on
  click.
* Tests: NEW tests/identify_layer.js (10 checks; 13 mutations, 13 caught). Words: README, the operations manual's new
  4.5, the technical manual's GUARDS, the hook's advice.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #29 - A PAGE THAT STOPS RESPONDING LEAVES EVIDENCE.**
Andy reported the page hanging while placing survey corners A / B / C. It has never been isolated - it was first seen
under SYNTHETIC clicks, which is itself the prime suspect, and it has not been reproduced on demand since.

* ⚠ SO NOTHING HERE FIXES IT. Guessing at a cause nobody can reproduce would have been the worst of both: a change
  with no evidence behind it, and a report still unexplained. What the console does now is make the NEXT one
  diagnosable. `stallWatch` runs on its own `setInterval` - not on the telemetry frames, which is the thing it exists
  to outlive - and measures how late it was.
* A VISIBLE page gone longer than `STALL_MS` (1.5 s) writes `page_stall` with the gap AND the state that would name
  the cause: the editing `mode`, which pattern corners were down (`pattern_anchors`), the punched runs, waypoints,
  lines, boundary, route, track, keep-out zone count, zoom, run state and the operator's last action. Over
  `STALL_SAY_MS` (5 s) it also says so on screen, once per half minute.
* ⚠ A HIDDEN TAB IS NOT A STALL - a browser throttles a background tab deliberately, which is review #14's
  `page_throttled`. ⚠ AND ONE EVENT GETS ONE BANNER: #14's "THIS TAB WAS ASLEEP" is now said only when the tab was
  actually hidden, because a visible freeze is this watchdog's to report, in its own words.
* LIVE, blocking the page's main thread for 6.5 s on the temp console: `page_stall` recorded
  `{gap_ms: 7521, mode: "pan", nogo: 1308, zoom: 13, run: "idle", ...}` and the banner read "THE PAGE STOPPED
  RESPONDING for 7.5 s (pan mode)". ⚠ THE FIRST LIVE RUN SHOWED A FLAW THE SUITE DID NOT: `last_action` was reading
  the newest HISTORY line, which is often a banner the page posted to itself - including this watchdog's own. It skips
  banners now. (The in-app browser pane reports the page HIDDEN when it is not on screen, which is why the hidden
  branch had to be proved first and the visible one with `visibilityState` overridden.)
* Tests: tests/frame_health.js 9-12b (10 mutations, 10 caught). Words: README, the operations manual's 15.1, the
  technical manual's GUARDS, the hook's advice.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #14 - ONE TAB IS IN CHARGE.**
Andy: "All supervision lives in one browser tab", with three options named - a heartbeat with a server alarm or hold,
one controlling page with the others view-only, or excluding the console from Edge's sleeping tabs. ALL THREE, minus
the hold: the post is held by one tab, the others are view-only, a lapse is an ALARM, and the browser's own setting is
documented because the console cannot reach it.

* WHY IT MATTERS, in one line: the clearance guard, the speed governor and the end-of-plan RTH chain all run IN THE
  PAGE. A second tab is a second ladder commanding the same boat, and a slept tab is a ladder that stopped with
  nothing on screen to say so - and at the console both look like ordinary traffic.
* SERVER (`Supervision`, `supervisor_refusal`, `/api/supervisor`, a 1 s watch thread started by `main()`): a tab
  claims the post by reporting in with its own id every `SUPERVISOR_BEAT_S` (2 s); the state carries `supervisor`
  {holder, age_s, tabs, stale, beat_s, stale_s}; a KNOWN non-holder's command is refused 409 in words. A holder that
  stops beating is `stale` after `SUPERVISOR_STALE_S` (6 s) and loses the post to any tab that reports in; `pagehide`
  releases it at once; `SUPERVISOR_FORGET_S` (120 s) forgets a closed tab entirely.
* ⚠ THREE THINGS ARE DELIBERATELY NOT GATED, each with its own check: STOP / PAUSE / E-STOP from any tab (review
  #25's rule extended - a control that reduces risk is never gated on bookkeeping); a caller with NO tab name (a
  script, a suite, curl - refusing those would break every harness); and `/api/mission`, so a second screen can plan
  while the first supervises (the plan's revision guard already stops two tabs overwriting each other).
* PAGE: `supervising()` gates exactly three things - `cmd()` (stop-class exempt), the `act` flags in the guard and the
  governor (AFTER `renderGuardBar`, so a view-only tab still assesses and ALARMS), and `canCommand`, which every
  chart-menu row reads. `applyViewOnly` sweeps `.cbtn` by class rather than by a list of ids, so a control added later
  is gated by default. `#supPill` says 👁 VIEW ONLY · TAKE OVER and hands over on a click - asked even in the simulator
  (`{always:true}`), because what changes is which window is in charge, not what the boat does.
* ⚠ AND A SLEPT TAB SAYS SO: `supervisorTick` compares its own beats, and a gap over `SUPERVISOR_SLEPT_MS` raises a
  banner naming the seconds and writes `page_throttled`. The Edge setting ("Never put these sites to sleep") is in the
  operations manual; the console cannot set it, but it can refuse to pretend the tab was watching.
* ⚠ A LAPSE IS AN ALARM, NOT A HOLD - said on the console, logged, and shown on every page, with the boat untouched. A
  browser hiccup stopping a survey mid-line is its own hazard, and nothing the vessel does depends on the page.
  Whether it should EVER hold is Andy's call; it is stated in the docs and left to him.
* ⚠ THE HEARTBEAT IS NOT A COMMAND: `LOG_QUIET_POSTS` keeps 30 records a minute out of his session recording, while
  every supervision CHANGE (took / took over / released / lapsed / back) is written as an event.
* LIVE, two real tabs on the temp console: the second opened VIEW ONLY with its command bar dead and its E-STOP live;
  TAKE OVER moved the post and the first tab became view-only within a beat; the console's own log read "a browser tab
  is supervising", "a browser tab took over", and - when a tab was closed without a release getting through - "the
  supervising tab has not reported for 6 s ... Nothing was stopped."
* Tests: NEW tests/supervisor.py (13 checks against a real console; 12 mutations, 12 caught) and
  tests/supervisor_page.js (11 checks; 10 mutations, 10 caught). ⚠ SIX EXISTING SUITES had to say which kind of tab
  their world is (action_history, clearance_guard, guard_resume, measure_tool, pause_resume, speed_modes): a global
  predicate that the page's gates consult is a global the suites must declare.
* Words: README ("Using it"), the operations manual's new 15.1, the technical manual's 6.2b and two GUARDS entries,
  the hook's advice.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #23 - THE RUN CLOCK TIMES THE COMMANDED MOTION.**
Andy: "`runElapsed` spans back-to-back runs" - measured at 3:48 across two Go-Tos - and his own question with it:
"time each commanded motion, or each job?"

* THE MOTION, and the row itself is the argument: the other two numbers on it (time left, percent complete) have
  always measured the CURRENT route, so an elapsed measured from an earlier command cannot be reconciled with the
  numbers beside it. That is what made it read as a fault rather than as a longer clock.
* ⚠ THE PAGE CANNOT SEE A NEW COMMAND IN `run`: `_run_route` sets "running" unconditionally, so a Go-To ordered inside
  a run makes no transition at all. The console counts the motion now (`run_seq`, published in the state): it moves on
  a staged-plan Start and on every Go-To / RTH / Transit / Hold / escape, and NOT on a resume (pause then Start) or a
  re-approach (`continuing=True`), which are that motion still running. The ELAPSED clock keys on it; the ETA and the
  percentage stay keyed on the route's own geometry, so a mid-motion amendment (the guard's edge nudge, the pause
  backtrack) rebases those without restarting the clock.
* THE JOB IS NOT THROWN AWAY: `jobElapsed` keeps its own clock across the whole chain from the boat's standing start
  (a survey that chains an end-of-plan RTH is two motions, one job), and the row's tooltip says both as soon as they
  differ. The motion's clock starts AT the command, not at the frame that reports it, which is up to 250 ms later.
* LIVE on the temp console: the row read 0:41 through the first Go-To, then 0:10 the moment a second one went out with
  `run` never leaving "running" - tooltip "This commanded motion: 0:10. Since the boat last got under way: 1:02 over 2
  commanded motions" - and a pause and resume left the count at 2 with the clock running on.
* Tests: line_stats.js 12-15 (6 mutations, 6 caught - ⚠ TWO OF THEM BY THE WIRING CHECK ALONE, recorded in its header;
  the behaviour behind those two is asserted against a real console instead) and run_link_control.py 7c / 15g / 15h (4
  mutations, 4 caught). line_stats.js takes `ASV_HTML` now, so its mutants run against a sidecar page.
* Words: the operations manual's status-bar row, the technical manual's GUARDS entry, the hook's advice.

**BEFORE THAT, 2026-09-15: HIS RETENTION DECISION - OLD RECORDINGS ARE COMPRESSED, THE CHART CACHE IS NOT CAPPED.**
Shown #24's figures he answered: "1. Compress logs over 30 days. 2. Do not limit chart cache size. 3. delete the empty
folders." All three done.

* COMPRESSION (`compress_old_logs`, on the storage thread, before each measurement): a session recording older than
  `STORAGE_OLD_DAYS` is gzipped in place - `asv_<ts>.jsonl` -> `asv_<ts>.jsonl.gz`, keeping its own mtime. ⚠ THE
  ORIGINAL IS REMOVED ONLY AFTER THE COPY HAS BEEN WRITTEN, READ BACK AND COMPARED BYTE FOR BYTE (`_compress_one`); a
  failure at any step leaves the recording as it was, takes the temp away and says so on stderr. Never `LOG.path`, never
  anything in logs/ that is not a recording (`_LOG_NAME_RE`) - the child processes append to theirs in there. A pass
  always does at least ONE and then stops at `LOG_COMPRESS_BUDGET_S` (30 s), so a slow disk can neither starve the work
  nor hold the thread. Announced once with the figures and logged as `logs_compressed`. `--no-log-compress` turns it off.
* ⚠ IT IS STILL THE SAME RECORD, AND THAT IS THE POINT - his logs are what he analyzes. `list_logs` lists a compressed
  recording ONCE under its own `.jsonl` name at the size from the gzip trailer (`_gz_raw_size`) with `on_disk` beside
  it; `safe_log_path` resolves that name to the `.gz`; `read_log_text` decompresses it. So `/api/log`, the playback
  page and any gzip tool are unchanged - measured live through a real console's own routes (check 11).
* THE READOUTS SAY WHICH POLICY IS IN FORCE, because a console claiming a retention it does not have is worse than one
  that says nothing: the state carries `log_compress`, and the low-disk report and the page banner read "recordings over
  30 days are compressed, but nothing is deleted" or "nothing is removed automatically" accordingly.
* NOT CAPPED: the chart cache, by his decision. `storage` also carries `logs_gz_files`, and the `[storage]` line says
  "(X of it older than 30 days, N compressed)".
* Tests: NEW tests/log_compress.py (13 checks, the last through a REAL console; 14 mutations, 14 caught). ⚠ THREE OF
  THOSE MUTANTS FIRST CRASHED THE SUITE INSTEAD OF FAILING A CHECK - setup between checks is not inside a `check()`
  thunk, and a crash scores as a SURVIVAL in a runner that reads FAIL lines. `safely()` now turns those reads into
  values no check can match. storage_watch.py 5/5b and storage_banner.js 6 hold the readout half (2 + 1 mutations).
* ⚠ THE HOOK BLOCKED THE FIRST COMMIT OF THIS, AND WAS RIGHT TO: tests/station_windows.py 1 refuses any 7-DIGIT INT
  constant in asv_console.py, because that is the shape of a NOAA station id - and `1048576` is one. Every megabyte in
  that file is written `1048576.0`; the existing code already did, which is why only the new helper tripped it.
* The 161 EMPTY `asv_amend_*` / `asv_mission_store_*` folders left in %TEMP% by suites from before #27 were removed
  (his item 3). 73 NON-empty ones (~3 MB of old test data) were left alone, and the two hook runs since #27 added none.
* Words: README, the operations manual (4.4 and a new 14.2), the technical manual (chapter 11 and its constants), GUARDS,
  the hook's advice.
* Verified: all 86 suites through the hook (0 FAIL lines), and LIVE on three of his own recordings copied into a temp
  state dir - 144 MB to 3 MB, each decompressing byte for byte to his file, the playback list reading the same sizes as
  before and a compressed session playing on the chart. Committed and pushed as `602a7eeb`.
* ⚠ HIS PLAN CHANGED WHILE THIS WAS BEING BUILT, AND IT WAS HIS OWN DOING: mission.json was saved at 19:26 and twice
  around 19:33 (67 KB -> 73 KB -> 25 KB, now 262 waypoints over 8 lines), his console adding a session recording as it
  started. The pre-session copy is `mission.json.bak2` and also in the scratch backup; the baseline was re-hashed, not
  reverted. ⚠ AND HIS CONSOLE RUNS THE WORKING TREE: the next time he starts it, the first storage pass compresses the
  118 recordings older than 30 days - measured at about 14 s for 309.6 MB, inside one 30 s budget.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #24 - THE CONSOLE SAYS WHAT IT KEEPS ON DISK, AND REMOVES NOTHING.**
Andy: "Logs and caches grow without limit. `logs/` is 471 MB across 190 files, and `charts/` is 4.4 GB." His session logs
are records he analyzes, and anything that deletes them automatically is his call, not a default - so this item MEASURES
and WARNS, and retention is a question for him.

* MEASURED ON HIS D: FIRST (exFAT, 256 KB allocation units; read-only walks, 2026-09-15): `logs/` 475 MB on disk (446 MB
  of content) in 191 files, 329 MB of it (119 files) older than 30 days; `charts/` 861 MB of content in 15,838 files
  OCCUPYING 4.6 GB, 5.5x - every tile takes a whole 256 KB unit, so his "4.4 GB" can only have been the size on disk.
  422.6 GB free. For the retention question: the 118 old session logs gzip from 309.6 MB to 8.9 MB (35x, in memory).
* `StorageWatch` (asv_console.py), a daemon thread started by `main()` - never at import, which dozens of suites do: at
  start and every `STORAGE_CHECK_S` (30 min), `_tree_size` walks logs/ and charts/ for content, on-disk size (priced by
  the allocation unit of the drive the folder's REAL path is on - GetDiskFreeSpaceW) and the part of logs/ older than
  `STORAGE_OLD_DAYS` (30); `shutil.disk_usage` for each drive the plan, the session log and the chart cache are written
  to, grouped by device. The tightest drive goes in the state as `storage` (with `age_s`); one `[storage]` line prints
  at start and then only when a drive goes low or recovers (stderr when low), logged as `storage_low` / `storage_ok`.
* Under `STORAGE_LOW_MB` (2 GB): the page (`storageCheck`, from `onFrame`) raises ⚠ DISK SPACE LOW once - room left,
  drive, what writes there, what the two folders occupy, nothing removed automatically - and keeps `#diskPill`
  "⚠ DISK LOW · N free" in the top bar while it lasts, with the whole warning as its title.
* NOTHING REMOVES ANYTHING, by construction: tests/storage_watch.py 9 audits the watch by AST for remove / unlink /
  rmdir / rmtree / truncate and any write-open.
* ⚠ THE LIVE CHECK FOUND THREE THINGS THE SUITES HAD NOT:
  1. The temp copy's charts/ was a JUNCTION on C: to `D:\Claude\ASV\charts` (so it did not copy 4.6 GB), and the line
     read "charts 897 MB on disk ... 422.6 GB free on C:" - D:'s free space under C:'s name, the tiles priced at C:'s
     4 KB unit. Naming and pricing now go through `os.path.realpath`. And the walk that CLAIMED not to follow links
     followed junctions inside the tree: on Python 3.11 `is_dir(follow_symlinks=False)` is True for one and
     `is_symlink()` False, so it now skips any reparse-point directory. Live after: "charts 4.6 GB on disk in 15838
     files (861 MB of content: each small file takes a whole 256 KB allocation unit); 422.6 GB free on D:".
  2. With low forced in the temp copy (`STORAGE_LOW_MB` edited in the COPY only), the banner went up and the chart's
     own "Nogo established" banner took the single slot FOUR SECONDS later, leaving the warning only in the history.
     Hence the pill - verified in the page, the banner slot holding the chart's banner and the pill still up.
  3. One use on a drive read "where the chart cache write".
* Tests: NEW tests/storage_watch.py (12 checks; 13 mutations, 13 caught - check 12 MODELS a cross-drive link with a
  patched `realpath` on an unused drive letter, because one volume cannot show it, and a junction from a temp folder into
  his repo is a risk not worth taking); tests/storage_banner.js (8; 10 sidecar mutations, 10 caught - "posted on every
  frame" SURVIVED the first draft, because showBanner records only words not already on screen); tests/frame_health.js
  stubs `storageCheck`.
* Words: README (after "Session recording"); the operations manual's top-bar table and 4.4; the technical manual's
  chapter 11 and constants table; GUARDS; the hook's advice.
* Verified: all 85 suites through the hook (0 FAIL lines); Andy's mission.json / ports.json / comms_config.json
  hash-checked unchanged. Committed and pushed as `c9d1aec4`.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #26 - THE HANDOFFS FROM BEFORE 2026-09-05 ARE ARCHIVED.**
Andy: "`CLAUDE.md` is 7,105 lines, and START HERE alone is about 1,200. Archiving the handoffs from before 09-05 would make
every session's start cheaper." It had grown to 7,798.

* MOVED VERBATIM to `HANDOFF_ARCHIVE.md` (5,524 lines, a short header and three marked spans): the 09-04 handoffs through
  the dated topic sections to just before `## Run it`; the dated sections from 07-31 to 08-02 between `## Behaviors` and
  `## Testing notes`; and the 07-23 session checkpoint. CLAUDE.md came down to 2,306 lines: this handoff, the 09-05 handoff, a
  pointer section, and the standing sections (Run it, Architecture, Vessel configuration, Behaviors, Testing notes,
  ROC + MOVING HOME, Keep docs current, Not yet done). Sections were found by their exact headings, never line numbers.
* CHECKED, not assumed: the original 7,798 lines were rebuilt from the new CLAUDE.md and the archive's spans and compared
  line for line - identical. The one difference on the first try was the blank line that had separated "Not yet done"
  from the checkpoint, which belongs to neither.
* ⚠ START HERE ITSELF IS STILL ~1,880 LINES, because all of it is from 09-05 on - the review blocks and the 09-05..09-11
  sessions. The ask was the handoffs from before 09-05; condensing START HERE is a further step, and his call.
* The four code comments that cited a moved section now name the archive (buoy_lane.js, end_action.js, measure_tool.js,
  units_toggle.js); the technical manual's document table lists `HANDOFF_ARCHIVE.md`. The two generic "see CLAUDE.md"
  notes (estop_chain.py, live_speed.py) are about client-side routing, which the kept Architecture section covers.
* Verified: all 83 suites through the hook; in the real repo, the archive's spans compared equal to the text they came
  from at the previous tip. Committed and pushed as `52fc8f24`.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #27 - THE SMALL CLEANUPS, AND WHAT THREE OF THEM TURNED OUT TO BE.**
The list's own words: "a crashed AIS service is never restarted; the NDBC weather-station cache is written non-atomically;
ENC cache writes share one fixed temp-file name; E-STOP sets its flag before commanding the boat; `CLAUDE.md` still says
'no GitHub remote'", and found since: JS suites that say the page "runs sloppy" and eval it sloppy, and suites that leave
temp folders behind.

* AIS: `_ais_watch_once(now)` on a daemon `ais-watchdog` thread (started once by `_ais_wanted_now`, looking every
  `AIS_WATCH_S` 2 s, surviving a look that raises): restart `AIS_RESTART_MIN_S` 5 s after an exit, doubling per failure to
  `AIS_RESTART_MAX_S` 300 s, back to 5 s after `AIS_STABLE_S` 120 s up. Only a service this console started and has not
  stopped (`_ais_wanted`, cleared by `_stop_ais_service` and by finding another service already on the port). A restart
  that produced nothing keeps the dead proc, so it is tried again. The exit is printed and logged (`ais_service_exit`).
* CACHES: `_write_json_atomic(path, obj)` - a temp named for process and thread, `_replace_retrying`, the temp removed on
  any failure - and `_cache_json` over it for every cache (`_enc_layer_map`, `fetch_enc_features`, `fetch_chart_info`,
  `_load_water_stations`, `_load_ndbc_stations`), which reports a failed write and never raises it. ⚠ THE FIRST RUN OF
  THE NEW SUITE FAILED ON THE FIXED CODE, AND WAS RIGHT: under a reader looping on the file, 12 of 300 writes still ran
  out of retries, and three cache writers let that raise into their fetch - the water-station list came back EMPTY with
  the stations in hand. Measured on the old shared `.part`: 67 writes failed on a temp the other writer had moved and 721
  reads found a cache that was not whole JSON.
* E-STOP: `set_estop` commands the link FIRST. A latch holds on the console whatever the link answered (set, disarmed,
  idle; the note says the vessel did not take it), a release clears the flag only when the link took it, and the refusal
  is still raised. RealVcu refuses every command today, so on a real link the old order showed E-STOP on an ARMED console
  with its run under way (the disarm sat below the raise).
* JS SUITES: 27 notes corrected to what is true (the page is a STRICT module; these suites eval sloppy; an assignment to an
  undeclared name is the runtime difference, and nothing checks it). NEW tests/page_strict.js parses the page and every
  static/js module as a module with `node --check` on temp .mjs copies - measured: ais_table.js passes all 31 checks on a
  page with an octal literal in setCellText, a page the browser refuses to run at all.
* TEMP FOLDERS: data_routes, http_contract, roc_persist and mission_store now remove theirs at exit; amend_plan's was never
  used and is gone. tests/state_dir.py 1b audits by AST that every mkdtemp is named and reaches rmtree (JS: rmSync).
* CLAUDE.md's "Not yet done" names the private remote.
* Tests: NEW tests/ais_restart.py (9 checks; 11 mutations, 11 caught - the first run HUNG on its first mutant, an unbounded
  wait in check 2, now bounded), tests/cache_writes.py (6; 7 mutations, 7 caught - one first CRASHED the suite and is a
  failed check now), tests/page_strict.js (4; 6 sidecar mutations, 6 caught); estop_chain.py 15-15b (3 mutations, 3
  caught); state_dir.py 1b.
* Words: README (the AIS service restart; the E-STOP refusal), the operations manual's e-stop row, the technical manual's
  module table and GUARDS.
* Verified: all 83 suites through the hook (9 min). Committed and pushed as `e49e9aa9`.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #25 - A POST MUST SAY IT IS JSON, AND A STOP IS NEVER REFUSED.**
Andy: "POST requests don't require JSON. The page already sends JSON, so requiring it costs nothing and blocks simple posts
from other websites." (With the #10 caution in the list: a garbled Stop must still be honored.)

* THE THREAT, AND WHY THE LABEL IS THE GUARD: a page on any site can make the operator's browser POST to the console without a
  preflight when the request is "simple" - a form, or a body labeled text/plain, form-urlencoded or multipart. A JSON label
  makes the browser ask first (OPTIONS), and this console answers no OPTIONS (501) and sends no Access-Control header, so
  that POST is never sent.
* `post_refusal(path, content_type, body)` (module level, beside `class Server`) is answered by `do_POST` BEFORE dispatch:
  415 {"error": "a POST must be sent as JSON (Content-Type: application/json) - ..."} and logged like any outcome.
  `post_is_json` takes the media type before any `;`, case-insensitively. Every page POST (16) and every suite already
  labels JSON.
* ⚠ THE STOPS ARE EXEMPT: `POST_ANY_TYPE` = /api/cmd/stop, /api/cmd/pause, plus /api/cmd/estop when it LATCHES - another
  website stopping the boat is a nuisance; refusing a stop typed by hand (curl without -H labels its body a form) is a
  hazard. A RELEASE is not a stop and needs JSON.
* ⚠ FOUND BUILDING IT: the E-STOP route read `bool(body.get("on"))`, and `_read_json` reads an unreadable body as {} - so a
  GARBLED E-STOP RELEASED a latched one. `estop_wants_latch(body)` is read by the gate and the route alike: only `on` false
  or 0 releases; unreadable, not an object, missing, null or the string "false" latches. (`/api/cmd/arm` still reads
  `bool(on)`: a garbled Arm disarms, the safe way.)
* Tests: NEW tests/post_json.py (9 checks) - the console's own Handler on a Server in-process, its ENGINE on a sim link, state
  in a temp folder, requests through http.client so the labels are exact. 12 scratch-clone mutations (sidecar original,
  atomic writes, PYTHONDONTWRITEBYTECODE, byte-compared after), 12 caught.
* Words: README (Pause / Stop / E-STOP: "Another website cannot command the console") and the technical manual's section 10.
* LIVE: a temp console on 8796 with logging and a page served from 8797 (another origin) in the in-app browser. A no-cors
  text/plain POST of {"on": true} to /api/cmd/arm was sent and refused - the session log reads "/api/cmd/arm 415 a POST must
  be sent as JSON", still disarmed; the same POST labeled JSON never left the browser ("Failed to fetch", no second arm in
  the log). The console's own page then armed, latched and released E-STOP as before.
* Verified: all 80 suites through the hook (8.5 min). Committed and pushed as `3682458b`.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #22 - THE MISSION STATUS CARD KEEPS A HISTORY OF WHAT THE CONSOLE DID.**
Andy: "There's no history of what the console did. Notes disappear after 4 s, and banners share one slot that about 40
different messages overwrite. Add a timestamped list of the last 20 actions to the Mission Status card." (Counted: 51
`showBanner` call sites and 48 `flashNote`.)

* ONE RECORDER, `recordAction(kind, label, answer)`, fed by the three ways the console speaks: `cmd` records every command
  with `cmdLabel` (the operator's word: Arm/Disarm, E-STOP/E-STOP released, "Speed low", "Route amended — <the guard's
  deviation note>", "ROC select home") and the ANSWER - the server's note from the reply when the command CHANGED it
  (`S.note` is read before the fetch; an unchanged note belongs to an earlier command), or "refused: <error>" / "network
  error" as kind `refused`. `flashNote` = `recordAction("note")` + the old body, renamed `showNote`; cmd flashes its own
  refusal through `showNote`, so a refusal is ONE line. `showBanner` records only when those words are not already on
  screen (consoleHealth re-asserts its banner every frame).
* MERGING: a repeat of the NEWEST line (same kind + label, answer empty or equal) counts up ("×5", the time the last). A
  BANNER posted again anywhere in the list moves its line to the top and counts up, matched with digit runs set aside
  (`unnumbered`) and showing the newest words. Commands and notes are never merged past the newest line - their order is
  the record (Start, Pause, Start is three lines).
* `actionLog` (not `history`, which would shadow the History API) lives in localStorage `asv_history_v1`, newest first,
  `HISTORY_MAX` 20; entries without a string label or finite time are dropped at load. ⚠ THE BLOCK SITS JUST BELOW
  `lsDel`, near the TOP of the module, with `renderHistory()` called there: a `let` declared 8,000 lines down would be in
  its temporal dead zone for any banner posted during load (action_history.js 12 holds the order).
* The card: `#v_history` / `#historyBody` after Intent. `renderHistory(changed)` PATCHES - `{op:"top"}` rewrites the top
  row, `{op:"move", from}` refills and moves that row node, `{op:"new"}` inserts one row and drops the last - and writes
  text through `setCellText`, never markup (a server error is not HTML). Rows: inline faint time, text cut at
  `HISTORY_SHOW` (120) with the full text and date in the title; refusals red, banners amber.
* Tests: NEW tests/action_history.js (13 checks) over a DOM stub that counts inserts, removes and markup writes (its
  insertBefore MOVES a child, as a browser does - the first stub copied it and 5b found that); 33 sidecar mutations, 33
  caught - the first run caught 24 of 27, and all three misses were the suite (see its TEETH). pause_resume.js 12d/12e
  lift the real `cmd`, which needs `recordAction` (stubbed there), `cmdLabel` (the page's) and `showNote` now.
* Words: README (History - last 20, after Intent) and the operations manual (4.4, NOTHING IT SAID IS LOST).
* LIVE (port 8796, temp copy running Andy's Eastport plan): Arm, Upload, Start, Pause, E-STOP on and off, then a Return home
  the E-STOP had disarmed read on the card, newest first: "Return home — refused: ARM before commanding the boat" (red),
  "E-STOP released — Command E-STOP released (still SAFE/disarmed).", "E-STOP — COMMAND E-STOP latched...", "Pause — Paused
  (next waypoint held).", "Speed high — Speed: high (14.0 kn) - applied live." (the governor's own command), "Start —
  Survey started (will Return-to-Home at the end).", "Upload — Run plan uploaded (719 waypoints · ENC-routed, rth).", "Arm
  — ARMED...", and the load banners; a reload brought all of it back. ⚠ TWO FAULTS WERE FOUND ONLY BY LOOKING AT IT: a time
  column left ~23 characters a line in the 196 px card (a banner took seven lines) - the time runs inline now; and every
  page load posts "Extracting ENC nogo boundaries..." and "Nogo established (N zones)" - four reloads had taken eight
  lines, and N differed each time (585, 599, 737), which is why banners merge with their numbers set aside. After both:
  three reloads, two lines, each ×3.
* Verified: all 79 suites through the hook (8.5 min). Committed and pushed as `7067c526`.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #21 - THE TRAIL IS SAVED WHILE THE BOAT MOVES, AND A LONG DAY OF IT IS KEPT.**
Andy: "The trail isn't saved while the boat is moving, and only about 4 km is kept. The browser-storage copy saves only
after 800 ms without a new point. Above about 1.5 kn a point arrives every 0.75 s or sooner, so it never saves. A reload
mid-survey loses the trail back to the last slow-down."

* THE SAVE: `saveTrack` was a DEBOUNCE (every point restarted the 800 ms wait). Now a THROTTLE - the first new point arms
  ONE `writeTrack` `TRACK_SAVE_MS` (3000) later - plus `flushTrack` on `pagehide` and on `visibilitychange` to hidden (wired
  just below `let asv = null;`, OUTSIDE spawn_trail's lifted block, which ends at that line).
* THE LENGTH, MEASURED FIRST: across Andy's 189 session logs (413 boots with a fix; telemetry records carry no boot id, so
  each is filed under the last `state` record's), the longest boot laid 68 km in 8.5 h, then 67 and 56 km; 35 boots passed
  4 km. A point is laid once `distTo(last, asv) >= TRACK_STEP_M` (2 m; it was 5e-6 DEGREES) and `MAX_TRACK` is 40,000 (80 km).
* THE STORED COPY: 40,000 `{lat,lon}` are 2 MB of JSON (19 ms to write) in a store browsers cap at a few megabytes per
  site, with the old quota error swallowed. `encodeTrack` / `decodeTrack` store MICRODEGREE DELTAS under the same key as
  `{bootId, d}`: 226 KB, 9.7 ms, 0.07 m worst round trip (Node). A quota error halves to the NEWEST half, then a quarter; any
  other error (storage off) gives up after one try. `loadTrack` still reads the bare-array and `{bootId, track}` shapes;
  `decodeTrack` is total (it runs at module load), stopping at damage.
* ⚠ THE LENGTH HAD A COST, AND IT WAS FOUND LIVE, NOT PREDICTED: with 40,000 points restored the trail took 12.9 ms a
  render (median, zoom 13). A pixel rule and an off-view rule (`trailScreenPath`) took it to 6.6 ms - and the page itself
  then showed why that was all: PROJECTION was 7 ms of it (40,000 `worldPx` calls) against 2 ms to stroke a seventh of the
  points. Each point now caches its zoom-0 world position (`wx`, `wy`; worldPx at zoom z is exactly that times 2^z) the
  first time it is drawn: 2.1 ms (zoom 13), 2.3 (17), 2.6 (19). The off-view rule tests against the LAST VERTEX DRAWN, not
  the original neighbor - a run leaving by the left and returning by the top through a corner shares no single edge, and
  joining its ends would cut across the view (13b).
* Tests: NEW tests/trail_persist.js (16 checks) over a fake clock, a store that refuses by size or refuses everything, and a
  flat worldPx; spawn_trail.js gains `distTo` in its world and waits `TRACK_SAVE_MS` (read off the page) in 13, not a
  literal 900 ms. 25 sidecar mutations across both suites, 24 caught; ⚠ "clearTrack does not cancel the armed write" is now
  an EQUIVALENT mutant (an empty trail writes nothing) - recorded in both TEETH notes rather than propped up with a check.
* Words: the operations manual's chart paragraph says what is kept and when it is saved.
* LIVE (port 8796, temp copy running Andy's Eastport plan, the boat spawned on line 1 at 6.9 kn): the stored copy stayed
  within 1-3 points of the trail on screen for 40 s; 170 points on screen just before a mid-run reload, 170 restored (a
  probe at `loadTrack`). The old page on the same console: 105 on screen, 65 restored, its stored copy unchanged for 15 s
  at a time - written only when a frame happened to arrive more than 800 ms after the last.
* Verified: all 78 suites through the hook (9 min). Committed and pushed as `616841ed`.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #20 - THE LINES TABLE IS PATCHED IN PLACE, NOT REBUILT EVERY FRAME.**
Andy: "The LINES table is rebuilt four times a second. This is the flicker you had fixed on the AIS card; update the cells
in place instead." `renderLineTable` runs from `onState` on every telemetry frame and assigned the body's whole innerHTML:
measured on the old page, 50 body rebuilds in 15 s of a running survey, the row node replaced, a text selection lost.

* `lineTableSkeleton(lines, anyLead, tt, total)` builds the body with id'd cells (`lt_speed`, `lt_transit`, `lt_r<i>` +
  `_mark` / `_plan` / `_act`, `lt_sum_plan` / `_act`, `lt_t<j>` + `_mark` / `_lbl` / `_sec`, `lt_tsum`, `lt_rth`) only when
  `_lineTableShape` changes - JSON of each drawn line's len / tip / lead, `anyLead`, the turn count. The empty note is its
  own shape ("empty"), written once. Cells are collected into `_lineTableCells` ONCE PER BUILD (`querySelectorAll("[id]")`).
* A frame then writes only what changed: `setCellText` (the AIS card's text-node editor) for figures, `setHtmlIfChanged` for
  the transit and RTH rows (their markup carries spans), and NEW `setStyleIfChanged(node, prop, v)` for the highlight and
  ink.
* ⚠ TWO FAULTS IN THE HALF-BUILT BRANCH, FIXED BEFORE IT LANDED: its style test compared against the READBACK
  (`row.style.background !== bg`), and a browser hands a color back in its own spelling ("rgba(63,192,255,.14)" reads
  "rgba(63, 192, 255, 0.14)", "#bfe8c8" reads "rgb(191, 232, 200)") - never equal, so the highlight and ink were
  rewritten on every frame; `setStyleIfChanged` compares with what it last WROTE. And it looked each cell up with a scoped
  `querySelector` per frame - five a line, four a turn, about a thousand a frame on a 100-line plan.
* Tests: NEW tests/line_table_patch.js (11 checks) over a DOM stub that counts body builds, text / markup / style writes,
  text-node creation and lookups, and reads colors back the browser's way; 18 sidecar mutations, 18 caught. ⚠ The first
  draft of check 6 added a lead without moving a line end, so the coverage length changed too and rebuilt the body for
  the wrong reason - "the shape ignores the lead" survived it (confirmed by running it). Punch Out EXTENDS the run for a
  lead and leaves the coverage length alone; the fixture does that now. drawn_lines.js's body stub gained `id` and
  `querySelectorAll`.
* Words: README's Lines card paragraph and the ops manual's 9.7 say the table is updated in place.
* LIVE (port 8796, temp copy running Andy's 14-line Eastport plan, spawned at its first waypoint, LINES open, the boat on
  line 1 at 6.9 kn), a MutationObserver on the body for 15 s: 0 body rebuilds, 0 attribute writes, line 1's clock and
  the total edited in place 15 times each (the same text node), the transit row re-rendered twice as the boat moved,
  the row and table the same nodes, and a selection of "9:20" still selected. The old page on the same console: 50
  rebuilds, the row replaced, the selection gone.
* Verified: all 77 suites through the hook (9 min). Committed and pushed as `a3a1db57`.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #19 - A PREVIEW NEVER LOOKS LIKE THE ROUTE.**
A punched survey pattern and a clipped search pattern were drawn solid GREEN - the green of the UPLOADED route
(`runRoute`, dashed `rgba(63,191,107,0.7)`) - while committed lines are yellow. That is what the Eastport "line heading out
to the northwest" investigation (2026-09-11) turned on; the question to Andy stays open in the Eastport note.

* `PREVIEW_INK` (`rgba(57,192,255,0.95)`, the drafts' cyan) + `drawPreviewLabel(x, y)` ("PREVIEW — not in plan", bold, cyan
  with a dark halo). drawPattern: punched coverage, its run under a lead (cyan 0.55) and a selected run's inner line are
  cyan; the label sits above the pattern's screen top-left. drawSearch: kept legs cyan, label below the datum. The raw
  (un-punched) previews and the transit draft were already cyan. THREE INKS: cyan = not in the plan, yellow = the plan,
  green = the route sent to the boat - and `rgba(63,191,107` now appears exactly ONCE in the page (preview_ink.js 5).
* Words: the Quick Start's Punch Out and Search steps and the SRCH hint say "cyan kept"; README and the ops manual (9.1
  note THREE INKS, THREE MEANINGS) say it too.
* Tests: NEW tests/preview_ink.js (6 checks) on a canvas stub that records every stroke's ink; 10 sidecar mutations, 10
  caught.
* LIVE (port 8796, temp copy): a drawn pattern showed cyan dashed lines under PREVIEW — not in plan; after Punch Out, solid
  cyan lines clipped around the islands, amber detours, the label, and no green.
* Verified: all 76 suites in the scratch clone. The overnight commit's hook was CUT OFF when that session ended
  (63/76, the item still staged); re-run 2026-09-15 and pushed as `a39344cd`.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #18 - A LINE IS WHAT THE OPERATOR DREW, NOT WHAT THE KEEP-OUTS LEFT OF IT.**
Punch Out cuts a pattern line around a keep-out into segments, and each became a "line": an 8-line pattern read as 9
(the old open-list note in MEMORY) - in the LINES table, the chart's L# labels, every "line N of M" - and
`committedPatternInfo` divided the width by segments - 1, UNDERSTATING the spacing (3 lines, one cut: 13.3 m, not 20).

* `linePartContinues(k)`: segment k+1 continues k when it is on the same straight line (both ends within
  `LINE_PART_OFFSET_M` 1 m), further along it (starts at or beyond k's end) and the same direction (cos > 0.9998).
  `drawnLines()` (memo on `lineSetKey()`) -> {lines: [[seg...]...], of: [line per seg]}; `lineNo(k)`, `lineCount()`,
  `linePartTxt(k)` (" (part 1 of 2)"). Geometric, so Andy's EXISTING plans need no schema change.
* SEGMENTS stay what the boat runs and times: `lineActual`, `runLineIdx`, `turnSeg` are unchanged. Every number SHOWN
  changed: LINES rows (one per drawn line - "120 + 120 (60 m gap)", title naming the parts, plan/actual summed, under
  way while any part is), `RTH L<lineCount>`, turn labels, chart labels (both parts "L2"), line tip, currentActivity
  ("line 2 of 3 (part 2 of 2)"), held-survey bar, resume notes, offTrack, and the survey card's count and spacing.
  Logs: `survey_lines` rows keep `line` (segment) and add `drawn`; the `activity` and `resume` events' `line` is now
  the DRAWN line (activity adds `segment`).
* ⚠ resumeRun HAD A LOCAL `const lineNo` - my calls above it threw in its temporal dead zone; pause_resume.js caught
  it on the first run. Renamed `resumeLine`; drawn_lines.js 8 fails on any `const/let/var lineNo`.
* Ten suites that eval the changed functions now grab the REAL helpers (not stubs); end_action's fixture `lines:
  [{}, {}, {}, {}]` got real geometry; the RTH row hoists `lastLine` because two suites extract `transitRowHtml(...)`
  with a regex that stops at the first ")".
* Tests: NEW tests/drawn_lines.js (9 checks; 15 sidecar mutations, 15 caught).
* LIVE (port 8796, temp copy seeded with a 4-segment plan): the LINES panel read "2 · 120 + 120 (60 m gap) · 1:06",
  Σ 840, "RTH L3"; zoomed in, the chart labelled the lines L3, L2, L2, L1.
* Verified: all 75 suites in the scratch clone.
* Committed and pushed as `e4fc2c08`.

**BEFORE THAT, 2026-09-15: REVIEW ITEM #17 - THE COMMIT GATE HAS NO GAPS.**
Four holes in `.githooks/pre-commit` and the suites it runs: its list of paths that count had drifted (a commit touching
only `currents.py`, `vessels/*.json` or `ports.default.json` ran NOTHING); `track_edge.js` and `amend_plan.py` had two
advice entries each, the second never reachable, and ten suites had none; a hung suite held the commit for ever; and
eleven suites failed on any console output line containing "Error" - data_routes blocked a clean commit on 2026-09-14
because a DNS hiccup printed "[ports] geocoder unreachable: URLError ...".

* Skip rule INVERTED: the suites run unless every staged path is Markdown or `.gitignore`/`.gitattributes`; nothing
  staged (an amend) runs them too.
* `SUITE_LIMIT_S` 600 (`ASV_SUITE_LIMIT_S`), via GNU `timeout` when present (Git's MSYS one kills a native python
  child - measured 3.5 s on a 3 s limit); exit 124 reads "TIMED OUT after N s" and blocks.
* Duplicates dropped (the FIRST, fuller entry of each kept); advice written for chart_source_card, guard_resume,
  pause_resume, survey_lead, turn_channel, units_toggle, ais_sources, currents, roc_persist, station_windows and the
  new suite. ⚠ A NEW SUITE NOW NEEDS AN advice_for ENTRY (precommit_hook.py 5), like its GUARDS entry.
* tests/lib/server_log.py `exception_lines(text)`: a traceback (reported by its error line), socketserver's
  "Exception occurred during processing of request", and the console's own "[http] <path> raised:" (the POST
  catch-all logs without a traceback - a matcher on "Traceback" alone would have MISSED it). Used by all eleven.
* Tests: NEW tests/precommit_hook.py (7) runs a COPY of the real hook in a temp folder with a stand-in `git` (a
  shebang script on PATH) answering `git diff --cached --name-only`. 11 mutations, 11 caught - end to end too:
  with the water-level cast unguarded, env_water 9 still fails, naming "[http] /api/waterlevel raised: ValueError".
* Verified: all 74 suites in the scratch clone.
* ⚠ THE FIRST COMMIT ATTEMPT WAS BLOCKED - by reading_age.py 10, not by #17. A real RACE in #13's monitor loops:
  `wait(poll); clear()` wiped a refresh (or a move) that landed after a wait timed out and before the clear, until
  the next poll - 15 min for the current. Now `if wait(): clear()` in all three loops. 10b PUTS a set() in that
  window with an Event whose next wait times out and sets on its way out; 3 mutations (one per loop), 3 caught.
  A kept refresh is the THIRD round for water/weather (they fetch after every wait anyway) and the second look for
  the current - a threshold of 2 let the water and weather mutations survive the first try.
* Committed and pushed as `488626a7`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #15 - THE PAGE AND THE PROGRAM SAY WHEN THEY ARE DIFFERENT VERSIONS.**
The page and its modules are read from disk on every request; the Python only when the console starts. After a commit
or an edit while a console ran, a refresh paired a NEW page with the OLD program - fields dropped, routes 404, nothing
said. ⚠ ANDY'S CONSOLE RUNS THE WORKING TREE, so this is every commit made while it is up.

* Server: `BuildWatch` (module global `BUILD`) fingerprints `BUILD_PY` (asv_console, currents, roc_tracks,
  ais_service, gps_sim) + static/*.html + static/js/*.js by CONTENT - CRLF normalized, names relative to the program
  folder - re-reading only when a size/mtime changed, looking at most every `BUILD_RECHECK_S` (5 s). State:
  `build` (`BUILD.boot`) and `build_on_disk` (`BUILD.current()`). `GET /` replaces `PAGE_BUILD_TOKEN`
  ("__ASV_PAGE_BUILD__") with `BUILD.current(force=True)`.
* Page: `const PAGE_BUILD` + `buildCheck()` (from `onFrame`, after `consoleHealth`) drive `#buildPill` in the top bar
  beside the link pill: RESTART CONSOLE when build != build_on_disk, or when the state has no `build` (a console from
  before this - the page is newer than it); RELOAD PAGE when a filled-in 12-hex PAGE_BUILD != build; hidden otherwise.
  A pill, not the shared banner: a version notice must not re-assert itself over PLAN NOT SAVED and the like.
  frame_health.js stubs `buildCheck` (onFrame calls it).
* ⚠ WHEN ANDY NEXT REFRESHES HIS PAGE WITH AN OLDER CONSOLE STILL RUNNING, IT WILL SAY RESTART CONSOLE - correctly.
* Tests: NEW tests/build_id.py (6 checks, on a temp COPY of the program; 8 scratch-clone mutations, 8 caught) and
  tests/build_check.js (7; 8 sidecar mutations, 8 caught).
* LIVE (port 8796, temp copy): the #13 console serving the #15 page -> RESTART CONSOLE ("reports no version");
  restarted on #15 and reloaded -> no pill, served f66fbfb77b2c (the clone's fingerprint, though this copy's chart.js
  had other line endings); a module changed under it -> RESTART CONSOLE naming f66fbfb77b2c and 7ffd0afbb6c4;
  restarted with the page open -> RELOAD PAGE; reloaded -> no pill.
* Also: the README paragraph #12 added ran straight into the next one with no blank line - fixed.
* Verified: all 73 suites in the scratch clone (reset to the #13 tip first - a clone left at #12 was missing #13's
  suites, caught by the count: 71, not 73).
* Committed and pushed as `17c5851c`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #13 - WATER, WEATHER AND CURRENT READINGS DO NOT FREEZE, AND SAY HOW OLD THEY ARE.**
`WaterLevel`, `EnvMonitor` and `CurrentsMonitor` each had a loop with no handler: one exception ended the thread and the
reading FROZE, still `ok`, carrying no time - and the page kept adding a frozen water level to every charted depth.
Reproduced before the fix: an `http.client.IncompleteRead` (a connection cut mid-body) is neither OSError nor ValueError,
came up through `fetch_water_level`, and the level never changed again after the upstream recovered.

* Server: `_monitor_pass(mon, name, body)` runs each loop body - a raise sets `_error` (published `monitor_error`),
  printed when its text changes; the last reading is kept (its age grows) and the next completed pass clears it.
  `_coops_get` / `_coops_series` / the station-list fetch catch `http.client.HTTPException`; a station cache that is
  not JSON is fetched again. Snapshots publish `age_s`: water from CO-OPS' own GMT `t` (`_coops_epoch`, else the
  fetch time; none for manual or not-ok), weather from the OLDEST buoy observation in the blend (`obs_t` via
  `_ndbc_epoch`; none under a manual override), current from `_sampled_at`.
* Currents: recomputed from the cached cycle every `SAMPLE_S` (60 s); the cycle is looked for every `POLL_S` (15 min)
  or at once when forced. `_ensure_cycle` returns why no cycle could be had, kept as `_no_cycle_why` through every
  sample until the next look - ⚠ the first version kept it only on the pass that looked, and the live card went back
  to "no cycle cached yet" a minute later (caught live; check 12 now samples between looks). At New Castle the row
  now says "gomofs frames are not hourly - unreadable by this build" (it always said "no cycle cached yet").
* Page: `WATER_STALE_S` = 25 min in static/js/chart.js (measured across forty of Andy's sessions, 5,693 readings: a
  live level is 4.6-17.1 min old, median 11.2). `waterTrust` returns `stale` + `age_s` (numeric ages only; never for
  manual); `effectiveWaterOffset` is 0 when remote OR stale. Rows: water "+1.05 m · 7 min" (stale: "· 41 min ⚠
  (datum)", ghosted, reasons in the survey note and tooltip), wind "· 1 h 40 min" (oldest buoy; none under manual or
  sim off), current's age only past `CURRENT_AGE_SHOW_S` (5 min); `monitorErrTxt` names a failed update in each
  tooltip. `fmtAge` joins an age with NO-BREAK spaces - the live wind row wrapped "1 h 40" over "min".
* Tests: NEW tests/reading_age.py (14 checks; 17 scratch-clone mutations, 17 caught) and tests/reading_age.js (7;
  run with water_trust.js 16-21 against 17 mutations, 17 caught).
* LIVE (port 8796, scratch clone, temp state): water "+1.05 m · 7 min" applied; with its observation time set 40 min
  back it read "+1.05 m · 41 min ⚠ (datum)", `sea.waterOffset` went to 0 and the keep-out model rebuilt at datum
  (`builtOffset` 1.049 -> 0), and back to applied when fresh; wind "2.7 kn @ 355° · 1 h 40 min". After the fix the
  current's reason held for 100 s of per-minute samples.
* Verified: all 71 suites in the scratch clone.
* Committed and pushed as `f191aa72`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #12 - THE SAFETY LOOP DOES NOT FAIL WITHOUT A SIGN.**
Every telemetry frame runs the clearance guard, the speed governor, the re-approach and the end-of-plan chain inside
`onState`, and `connect()`'s handler caught and dropped every error in it - a guard that had stopped running looked
exactly like one with nothing to do. And `Engine._run` had no handler: one exception in a tick ended the thread,
telemetry stopped, and the event stream's keep-alive comments kept the link dot GREEN over frozen readouts.

* Server: `_run` restarts `_run_loop` after `_loop_faulted`, which sets `loop_fault` {error (the latest), count,
  since}, prints the traceback once per raising LINE per episode (not per message - a value in the message differs
  on every tick; at most LOOP_FAULT_SITES_MAX 8), logs `loop_fault`, and pushes the state in its own try (a fault IN
  the state publishes nothing - the page's stale check covers that). Both reports sit in a try: a print to a console
  window that has gone raises, and inside the handler it would end the loop after all. `_loop_clean` takes it down after
  LOOP_FAULT_CLEAR_TICKS (8) clean ticks IN A ROW and logs `loop_recovered`; connect() clears it. The state adds
  `loop_fault` (read once - the loop can clear it between the test and the copy) and `streaming` (`_link is not None`:
  the loop publishes on every tick while a link exists, healthy or lost).
* Page: `onFrame` / `consoleHealth` (every frame, and `setInterval` 1 s from connect). TELEMETRY STALE after 2 s with
  `S.streaming` - dot `lost`, pill `<mode> · stale`, and nothing said about faults (the page holds only the last
  frame). CONSOLE FAULT after 3 failed frames (named; console.error once; `page_frame_fault` logged once per streak),
  down after 8 clean frames in a row; the console's `loop_fault` is said after it. Only a banner matching
  HEALTH_BANNER is ever taken down.
* ⚠ THE PAGE IS `<script type="module">` - STRICT, and its top-level bindings are NOT globals. The browser pane's
  javascript tool runs in an isolated world; an injected `<script>` element runs in the page's world but still
  cannot see module bindings, so the live check put a probe hook into the SCRATCH CLONE's copy of the page. ⚠ Ten or
  more JS suites carry the note "the console's classic browser <script> runs sloppy" and eval page code sloppy;
  frame_health.js evals strict. The technical manual's "one classic script scope" is corrected. (For #27.)
* Tests: NEW tests/frame_health.js (10 checks; 17 sidecar mutations, 17 caught, none by a crash) and
  run_link_control.py 17-17g, in-process (a fault through the home provider, through the state snapshot, and
  under a stderr that raises; 15 scratch-clone mutations, 15 caught).
* LIVE, on an isolated console (port 8796, scratch clone, temp state folder): a fault switched into the loop showed
  CONSOLE FAULT counting at 4 Hz, printed once for 184 faults, and came down after it stopped; a page whose onState
  threw showed CONSOLE FAULT, still up after 4 clean frames and down after 8; killing the console showed TELEMETRY
  STALE with the dot red within 3 s - and the pill beside the dot still read "sim · ok", so it reads "stale" now.
* Verified: all 69 suites in the scratch clone. data_routes 13 failed once on a transient DNS failure - the
  console printed "[ports] geocoder unreachable: URLError ...", and eleven suites' "logged NO exception" checks
  match any line containing "Error" - and passed on re-run. That over-broad match is a hook flake (for #17).
* Andy, 2026-09-14: "Carry on all updates until the following session ends" - items go in one after another,
  each verified, committed and pushed; the "your call" items (#14, #23, #28-30) are left for him.
* Committed and pushed as `862797d4`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #11 - AN EMPTY PAGE NEVER SAVES OVER A REAL PLAN, AND WHAT DESTROYS WORK ASKS FIRST.**
#10 took the first half of #11 (the page reads its save's answer). The rest: `loadMission` took any reply - an
error body, an unreadable answer or a network failure left the page holding its EMPTY default plan with no
revision, and the operator's first edit saved that over the real one (a no-revision save is accepted by design).
And in the simulator `guiConfirm` answers yes by itself, so RESET wiped the saved plan and the trail on one click;
CLR PLAN had no question at all; dropping a held survey's remainder was not asked about either.

* `missionLoaded` (with `missionLoadRetry`, `MISSION_LOAD_RETRY_MS` 3000): set only when `/api/mission` answers
  200 with a `waypoints` LIST (an empty plan is a plan). Until then `flushMission` saves nothing and banners PLAN
  NOT SAVED; a failed load banners PLAN NOT LOADED with the reason and retries; the load that succeeds takes that
  banner down. A later failed RE-load (vessel switch) keeps the plan the page already has.
* `resetMission()` and `clearPlan()` are named functions now (were inline onclick) so they can be driven;
  both, and `dropHeldSurvey`, pass `{always: true}`. CLR PLAN names what it deletes and skips the question for
  an empty plan. Arm / Start / E-STOP still answer themselves in the simulator - they destroy nothing.
* Tests: plan_save.js 7-11 (checks 1-6 now run on a loaded page). TEETH: 9 sidecar mutations, 9 killed.
* Committed and pushed as `3a9be4e4`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #16 - NO TEST WRITES THE OPERATOR'S FILES.**
Seventeen suites started a console in the app folder, and a console keeps its plan, comms settings, port registry,
ROC registry and session logs beside the program. Thirteen "protected" mission.json by reading it at the start and
writing it back at the end - a write of its own, which lost any edit Andy made in his console while the hook ran,
and after #10 rolled the plan revision back so his page refused to save. Measured today: three plan-backup
rotations in his folder fell inside the #9 hook run while his console was up. completion_modes could even DELETE
his plan; log_routes and data_routes wrote test sessions into his logs/.

* `--state-dir DIR` / `use_state_dir()`: re-points MISSION_PATH (with .bak/.corrupt/.part), COMMS_CONFIG_PATH,
  PORTS_PATH, LOG_DIR (session logs, ais_service.log, gps_sim logs) and the ROC registry, and RE-READS the three
  loaded at import (ports, comms, ROC). Applied first in main; --ports-config / --roc-config still win. The session
  logger now gets `log_dir` passed - its default was bound at class definition. Chart/station caches stay put.
* tests/lib/console_state.py (`ConsoleState`: temp folder, `.args()`, `.path()`), one level down so the hook does
  not run it as a suite. All 17 console launches pass `*STATE.args()`; every snapshot and write-back of
  mission.json is gone. run_link_control's in-process Engine calls `_C.use_state_dir(STATE.dir)` (it READ his plan).
* mission_store.py 10 no longer hashes his mission.json - a save from his own console mid-run failed the commit.
  It records every write-mode open / replace / remove naming the app folder's plan files.
* NEW tests/state_dir.py: 1 AST audit (every console Popen passes a state folder); 2-3b on a temp COPY of the
  program, so a broken flag cannot reach his files: the console READS seeded plan/comms/ports from the folder,
  WRITES plan, comms, ports, ROC and session log there and nothing beside the program, and without the flag writes
  beside itself. TEETH: 11 scratch-clone mutations, 11 killed.
* Knock-ons: roc_persist 9 accepts a ConsoleState suite as ROC-isolated; survey_lead 27 and 42 read save_mission
  to the next def instead of a fixed 1400/1600-char window (#10's docstring had pushed the fields past it).
* Verified: all 68 suites in the scratch clone with its state files fingerprinted before and after - unchanged.
* Committed and pushed as `2fe00a96` (#10 as `e779cad9` just before it).

**BEFORE THAT, 2026-09-14: REVIEW ITEM #10 - A PLAN SAVE IS CHECKED, MADE AGAINST A REVISION, AND SAID WHEN IT IS NOT KEPT.**
POST /api/mission saved whatever arrived: an unreadable body came back from `_read_json` as {} and was written as an
EMPTY plan - #5 hardened the READ side only. Two pages that had loaded the same plan each autosaved over the other's
edits without a word, because `saveMission` never read the answer. And eight POST routes (plan, logevent, vessel,
ports, comms, waterlevel, env, roc) sit above `_dispatch_post`'s own try: an exception there dropped the connection,
with no answer and nothing in the session log.

* `check_plan_body` refuses a body with no waypoints list, a waypoint / line end / boundary vertex that is not a
  position, a negative or non-finite setting, or a bad `rev` (`PlanRefused` -> 400, nothing written). An explicitly
  EMPTY plan (CLR PLAN) is still saved.
* `save_mission` compares and bumps `rev` under `_mission_lock`: an older revision raises `PlanConflict` (409, with
  the revision on disk); NO revision (scripts, tests, an older page) is written as before. `_stored_rev` retries a
  locked file and then refuses (503) - it never reads a locked file as 'no plan'. `load_mission` carries `rev`.
  ⚠ The End-of-Plan cache (`_cache_plan_completion`) is updated only AFTER the write: it used to be set while the
  document was built, so a save refused as stale would still have changed the setting the console runs by.
* `do_POST` wraps `_dispatch_post`: any exception is a 500 in words, and the session-log line is reached.
* `_read_json` is UNCHANGED on purpose - refusing every malformed body there would refuse a garbled Stop as well. A
  first cut did exactly that and was reverted.
* Page: `saveMission` debounces into `flushMission`, which sends `missionRev`, adopts the answer's `rev` and sends
  one save at a time; a 409 banners PLAN NOT SAVED ... reload and stops saving (`missionConflict`); any other failure
  banners and is retried with the next change. `loadMission` takes `rev`. The UI split is unaffected: only the main
  window saves (the controls window forwards its gestures), so the two windows never conflict.
* This takes in the first half of #11 ("plan saving in the page fails silently"). #11's remainder: loadMission
  accepting an empty reply, and RESET wiping the plan with no confirmation in the simulator.
* Tests: mission_store.py 9 hardened, 11-14 and 12b; NEW tests/plan_save.js. TEETH: 10 scratch-clone server
  mutations and 8 sidecar page mutations, 18 killed. The first page run scored 2 SURVIVED because a mutated save
  waited for ever and Node exited 0 printing nothing - plan_save.js bounds every wait now and reports FAIL 0 from
  `beforeExit`, and the runner flags a missing summary line.
* ⚠ ANDY'S LIVE CONSOLE RUNS THE WORKING TREE. It was restarted at 16:50 from D:\Claude\ASV, so this item's
  UNCOMMITTED save path wrote his new 719-waypoint plan as `rev` 13. Nothing was lost. But the suites that launch
  the console in the app dir (hold_station, run_link_control, http_contract, completion_modes and others) snapshot
  and RESTORE mission.json, and some POST test plans into it: an edit he makes while the hook runs can be
  overwritten at the restore, and with revisions the restore also rolls `rev` back, so his page then says PLAN NOT
  SAVED. #16, committed straight after this, removed it: no suite writes his files now.
  This item's server suites were verified in a scratch clone for that reason.
* Committed and pushed just before #16 (Andy chose #16 first so the hook never touches his files).

**BEFORE THAT, 2026-09-14: REVIEW ITEM #9 - A ROUTE GOES WHOLE OR NOT AT ALL.**
`Engine._sanitize_route` kept the first 1000 waypoints of any route and dropped the rest with a 200 - a survey
that ended wherever waypoint 1000 fell, which is also where an end-of-plan RTH would fire. The session logs
hold 350 route commands; 9 were over 1000, all uploads the server took and cut: 6,435 (2026-08-01), 3,388,
3,172, 1,288, 1,224, 1,133, 1,031, 1,020, 1,017. (A first count read the log folder twice and said 18 of 232.)

* `ROUTE_MAX_WPTS = 20000` (three times the largest logged plan): a sanity bound on a request, not a vessel
  limit. Over it, `_sanitize_route` REFUSES WHOLE via `too_many_wpts()`; `Engine.upload` applies the same bound
  to the saved plan (an upload with no route never passed the route check). The state publishes
  `route_max_wpts`.
* Page: `routeTooLong(n)` in `doUpload` checks the saved plan's count before the no-chart-model question and
  the ROUTED path's count before anything is drawn as the run; the banner gives both numbers. No limit on the
  state (an older server) sends as before.
* Go-To / RTH / transit / amend / re-approach routes meet the server bound only; none comes near it.
* Tests: run_link_control.py 3c (over-limit transit refused in words, at-limit passes to the arm gate, limit
  covers 6,435) and 16 (saved plan, in-process with the store stubbed); pause_resume.js 1h-1j. TEETH: 4
  scratch-clone mutations of the server and 5 sidecar mutations of the page, 9 killed.
* Andy approved #9 before its final report; it was committed after the verification finished.
* Committed and pushed as `320f1ab7`.

**BEFORE THAT, 2026-09-14: A FRAME READ BEFORE A COMMAND IS NEVER APPLIED AFTER IT (found fixing review #8).**
`Engine._run` asks the link for its frame OUTSIDE the lock (a real link's read can block, and a Stop must not wait on
it) and applies it under the lock, so a command could land in between and be overwritten by a frame that described
the boat before it. Reproduced in-process: a Stop read `running` for 0.45 s and then `complete`, never `stopped`.
For a holding boat that window carried `running` + `holding` to the page's end-of-plan RTH chain, past #8's
re-approach gate, and into the moving-home chase in `_run`, which uploads and STARTS the link with no page involved.

* `Engine._cmd_gen`, bumped by `_commanded()` under the lock in stop / pause / start / set_estop / set_armed(off) /
  `_run_route`. `_run` notes it before `link.tick()` and drops the frame if it moved - not a link miss; the next
  frame is read after the command.
* Upload, amend and the speed/approach tuning do NOT mark: a frame from before them changes no run state, only
  `wp_total` / `speed_key` for one 250 ms frame. Connect/disconnect replace the link and join the old thread.
* Tests: run_link_control.py 15-15f, IN-PROCESS - a SimVcu subclass fires each command from inside `tick()`, the
  only way to put it in that window on demand. TEETH: 8 mutations in a scratch clone against the suite trimmed to
  that part, 8 killed, each by its own check. The tech manual's Engine section says why, and its run-state and
  behavior lists now include `stopped` and `escape`.
* Committed and pushed as `77c78f05`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #8 - NOTHING THAT STOPS A BOAT LEAVES IT STATION-KEEPING, AND NOTHING STARTS ONE BLIND.**
Reported: `SimVcu` kept `_holding` through Stop, E-STOP and a disarm, and `Engine.reapproach` took any boat that
said holding - Go-To, hold, Stop, re-approach: HTTP 200 and 3.9 kn. hold_station.py 11b failed 4 runs in 6 because
its Stop was a GET (404): the boat was never stopped, and 11b passed only if the re-approach had not yet landed.
Found while fixing it, each measured on a sandbox server 6 s after Start: `SimVcu.start()` cleared `_holding` with
`_wp_index` at the END of the plan, so the tick had no leg and no hold and drove the boat off on its heading at the
commanded speed - a paused station-keeping boat resumed (6.9 kn, 9 m off), a finished "complete" run started again
(6.9 kn, 19 m past its end), an E-STOP while holding released and started (6.9 kn, 7 m off). And `Engine.start`
renamed every resume "survey", so a paused escape came back CHAINABLE - the Eastport escape-then-RTH loop.

* SimVcu: `_end_hold()` in stop / estop(on) / set_neutral; start() keeps a resumed hold and restarts a finished plan
  at waypoint 0; tick() has `elif moving: target_kn = 0.0` - no leg and no hold means no way on.
* Engine: `reapproach` passes `continuing=True` and `_run_route` refuses it UNDER THE LOCK unless `run == "running"`
  (which also refuses a PAUSED hold, where a re-approach would un-pause her). `start` keeps the behavior on a
  resume and says "Resumed."
* Page unchanged: Pause then Resume on a holding boat now puts her back on station at LOW, under the same run.
* Tests: hold_station.py 7f-7i (in-process), 11b made a POST and tightened, 11e-11g over the API. TEETH: 11
  scratch-clone mutations, 11 killed. README item 5, the operations manual's Pause/Stop table and the tech manual updated.
* FIXED IN THE NEXT COMMIT (see NEWEST): a telemetry frame read BEFORE a command could be applied AFTER it.
  `Engine._run` calls `link.tick()` outside the lock and applies the frame under it, so a Stop landing in between
  is overwritten: the run read `running` for 0.45 s and then `complete`, never `stopped` (reproduced with a SimVcu
  subclass whose tick() calls `engine.stop()` after computing its frame). For a holding boat that window carries
  `running` + `holding` to the page's RTH chain and past the new re-approach gate. Proposed: a command generation
  counter the poll loop checks before applying a frame.
* Committed and pushed as `92601279`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #7 - THE ESCAPE WORKS FROM INSIDE THE BUFFER, AND AWAY FROM TROUBLE.**
Two faults in `escapeCourse` (static/js/guard.js), both measured first: from INSIDE the buffer `timeToEntry`
answers 0 for every heading, so the search found nothing and the page read BOXED IN with open water straight
behind the boat (pier face, 2 kn set, 5 m buffer: a way out at 5.5 m off, none at 4.5, 3 or 1.5 m); and the
tie-break was ground distance, so with the set running along a face the escape ran ALONG the face (75 deg, 35 m
clear after 45 s, where straight out gives 241 m).

* From inside, each heading's track is walked at a quarter step: fouled if it comes within `ESCAPE_HARD_M`
  (0.5 m) of a feature, out at the first sample outside every buffer, then the ordinary projection from there
  must stay clear a whole horizon. The escape point is `tOut + horizon` along the track.
* Clear headings rank by the WORST clearance along the track (1 s samples), then the clearance at its end.
* ⚠ NO FIXED EXIT DEADLINE. The first cut had one (10 s, `ESCAPE_EXIT_S`, since removed) and nothing tested it;
  asked why, it turned out WRONG: a 15 m buffer in a 4 kn set takes 11.7 s straight out, and it read BOXED IN.
  The escape point one horizon from NOW was also wrong: it ended a late exit a few meters past the edge.
* The BOXED IN banner now names the refusal: from inside, "no heading gets out of the N m buffer and stays out
  for 45 s without touching X"; outside, the old "every heading enters a keep-out within 45 s".
* README's escape paragraph still called it "a computed Go-To" - stale since the dedicated escape behavior
  (2026-09-03); rewritten with the above.
* Cost, 1500-zone synthetic chart: about 35 ms a search outside or in a 5 m buffer, up to about 110 ms deep
  in a 25 m buffer; it runs at most once per `GUARD_REASSESS_MS` (6 s) while steering. An adaptive-step walk
  roughly halved the worst case but was not taken - more safety logic to pin for a stress-chart saving.
* Tests: in_extremis.js 10b-10h; clearance_guard.js 15q (driven through the helm rung). TEETH: 7 scratch-clone
  mutations of guard.js, 7 killed; 2 sidecar mutations of the banner, 2 killed.
* Committed and pushed as `bc53c1d3`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #6 - A COMMAND IS CHECKED, NOT ASSUMED.**
Every speed sender assumed its POST had worked: the governor set `commandedSpeed` before the answer, the
guard set `slowed` before it, `resumeRun` / `resumeHeldSurvey` sent Start after a LOW they never checked,
the slow rung's gate read the CONFIGURED role speed, and `cmd()` answered a network error with {} - which
every `r.error` check in the page read as success.

* `commandSpeed(key)` is the one sender (governor, all three guard rungs, continueAtLow, both resumes) and
  remembers `speedWant`; `speedReconcile(s, st)` runs every frame right after the governor, compares it with
  the vessel's `speed_key`, re-sends after `SPEED_RESEND_MS` (1 s), and after `SPEED_RESEND_MAX` (3) says so
  once in a banner and keeps trying every 5 s. Dropped when not under command; a link with no key is left alone.
* The slow rung reads the reported `speed_key` (falls back to the role only with no key).
* `cmd()` returns `{ok:false, error}` on a refusal or a network error.
* `resumeRun` stops if LOW or Start is refused (still paused, says so); `resumeHeldSurvey` stops at a refused
  pause, upload, LOW or Start and puts her back on station with the offer up. Its comment about the pause
  preventing a take-off was stale since #3 and says so now.
* Tests: speed_modes.js 9 (follows the call into commandSpeed) and 19a-19f; clearance_guard.js 15p;
  pause_resume.js 12c-12e and 15; guard_resume.js 15b; in_extremis.js 12 updated. TEETH: 11 sidecar
  mutations, 11 killed.
* This also removes review #2's trigger (a lost LOW is re-sent within a second); #2's 2 s deadline stays as
  the backstop.
* Committed and pushed as `ca42fffb`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #5 - THE PLAN FILE SURVIVES CONCURRENCY, CORRUPTION AND SPEED COMMANDS.**
Measured before any code: on Windows a reader holding mission.json open makes `os.replace` fail with
WinError 5 (2460 failures to 112 successes in 10 s, one reader) - the open list's 500; a read landing
mid-replace raises PermissionError, and `load_mission` answered that (and a corrupt file) with an EMPTY
plan, 36 times in 10 s with the full plan on disk; and `set_speed` loaded, edited and SAVED the plan
before commanding the boat (over HTTP a speed command sent with a Go-To failed 1 in 60).

* `_read_mission_file()` holds the writer's lock (now an RLock). Only FileNotFoundError is no plan; a
  locked file is retried ~0.3 s then `MissionUnavailable`; a corrupt one is copied to
  `mission.json.corrupt-<sha>` and refused. GET /api/mission answers 503 in words, never an empty plan.
* `save_mission` keeps the previous PLAN on a geometry change (`mission.json.bak1..bak5`, never an empty
  plan, never on settings-only saves), writes a per-writer temp file, and retries the replace.
* `set_speed` writes NOTHING. `_run_route` / the RTH chase use `mission_params()` (the last good plan)
  and the link's live `speed_key` - a Go-To or the escape can no longer fail on a file read.
* ⚠ `load_mission` still owns BOTH dict literals (read path and no-file default): survey_lead.js and
  min_depth_floor.js count them in that exact span - keep new helpers OUTSIDE load_mission..plan_completion,
  and keep save_mission's keys in its first 1400 characters (no long docstring there).
* Tests: NEW suite `tests/mission_store.py` (11 checks, temp path, asserts the real file untouched) and
  `live_speed.py` check 8 rewritten (it asserted the old persistence). TEETH: 9 server mutations in a
  scratch clone, 9 killed - including reads without the lock (the concurrency check still catches it).
* The open list's persistence-500 and empty-plan entries are marked addressed; the 281-byte file itself
  is still unexplained.
* Committed and pushed as `35c20cb3`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #4 - UPLOAD WITHOUT THE CHART MODEL ASKS FIRST, AND SAYS SO AFTER.**
`#b_upload` lumped three cases into one silent branch: no waypoints, no position fix, and the keep-out
model not ready - and for the last two it sent the raw survey waypoints with no routed approach and no
detours, no word to the operator, while the clearance guard (which reads the same model) stood down.

* The handler is now `async function doUpload()` (wrapped in try/catch - an async button handler that
  throws does nothing silently). No fix: refused in words. Model not ready (loading, not loaded, or no
  keep-outs read for the area - `nogo.band` tells the last apart): it ASKS via `guiConfirm(..., {always:
  true})`, sends nothing on a no, and on a yes uploads unrouted with a banner that stays up.
* `guiConfirm` gained `opts.always`: shown even in the simulator, where every other confirmation still
  answers yes by itself (that general question is review #11, not touched here).
* Tests: `pause_resume.js` 1c-1g, driven (inside the async block - `finish()` holds the synchronous
  checks). TEETH: 5 sidecar mutations, 5 killed.
* Docs: ops manual Upload bullet and README step 4 state it; tech manual GUARDS entry names it; docs rebuilt.
* Committed and pushed as `f65da112`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #3 - AN UPLOAD NEVER CHANGES WHAT THE BOAT IS DOING.**
`SimVcu.upload_plan` replaced the active plan and cleared `_holding` but left `_running` set, so a boat
station-keeping at a Go-To point drove off at the upload's transit speed the moment Upload was pressed
(measured 3.9 -> 9.9 kn in 4 s, no Start, still labeled goto) - and Upload was enabled whenever armed.

* A plan uploaded to a RUNNING link (holding, paused, or a one-step command) is STAGED; `start()` applies
  it, `set_speed` carries into it (the guard-hold resume commands LOW between upload and start), and
  Stop / E-STOP / disarm keep it as the loaded plan. An idle link applies at once, as before. Values are
  normalized at upload, so a bad one still fails there.
* `Engine.upload` REFUSES while under way on a plan (409, "Hold or Stop it first"); `state()` publishes
  `plan_staged`. The page disables Upload under way and keeps Start live for a staged plan.
* Tests: `hold_station.py` 7b-7e (link) and 11c-11d (real engine), `pause_resume.js` 1b (gating).
  TEETH: 6 server mutations run in a scratch CLONE (the real source never touched) + 2 page sidecars,
  8 killed.
* ⚠ FOUND ON THE WAY, FOR #8: `hold_station.py`'s `api(port, path)` with no body sends a GET, and
  `/api/cmd/stop` GET is a 404 - so the `stop` before check 11b has never stopped anything. 11b's
  flakiness is that no-op plus re-arrival timing, on top of the real stale-`holding` defect. The new
  11c-11d calls pass `{}`; fix line 341 when doing #8.
* Docs: ops manual Upload/Start bullets and README step 4 state it; tech manual GUARDS entry and hook
  advice name the rule; docs rebuilt.
* Committed and pushed as `41c9932b`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #2 - A SLOW-DOWN IN LIEU OF A HOLD HAS TO BE TAKEN, AND KEEP ANSWERING.**
The 09-10 slow-before-hold rung spent the escalation: every later frame at `hold` read not-escalated, so
a boat that did not actually slow - a speed command refused or lost, which the mission.json WinError 5
race makes real (review #5) - was never held. Driven over consecutive frames: "low" at 30 m, then
NOTHING from 30 m to 10 m at 6 kn, where a fresh guard holds. The rung's own comment ("the guard is back
here next frame") asserted a mechanism that did nothing.

* `slowLieu` {at, sog} is recorded when the rung fires. While the level still reads hold, every frame asks
  whether slowing STILL answers it from where she is now (the same counterfactual, re-asked), and whether
  it was TAKEN within `SLOW_ANSWER_MS` (2 s): `speed_key` "low", or speed over ground down 0.2 kn on a
  link with no key. Either failing fires the hold, and the note names which.
* A hull genuinely coming down is left alone: 15l reads hold > hold > hold > hold > slow with no hold sent.
* Tests: `clearance_guard.js` 15k-15o, driven over consecutive frames with the clock stepped. TEETH: 8
  sidecar mutations, 8 killed - "speed_key ignored, SOG only" SURVIVED until 15o was added, because in
  every other fixture the key and the speed over ground agree.
* Docs: README corrected (it repeated the "back next frame" claim); tech manual GUARDS entry and hook
  advice name the rule; docs rebuilt. The ops manual does not describe this rung and is unchanged.
* Committed and pushed as `c6d03cf0`.

**BEFORE THAT, 2026-09-14: REVIEW ITEM #1 - THE KEEP-OUT MODEL FOLLOWS THE TIDE.** Andy asked for a
reliability/utility review as a numbered list and is taking the items ONE AT A TIME, IN ORDER,
approving each before the next (the 30 items are in the session transcript; the verified ones
are summarized in auto-memory `asv-simulator.md`). Committed and pushed as `a80df030`.

**#1, what was wrong.** `buildKeepouts` reads `sea.waterOffset` only when it runs, and nothing
rebuilt the model when the level moved - `onState` only discarded the preview. So a model built at
high water kept a drying flat and a charted rock OUT of the keep-outs for the router, Punch Out
and the clearance guard however far the tide fell. Real builder, 4 m floor: built at +4.5 m a
VALSOU 1.5 m rock and a 0-2 m flat are open water; at datum both are keep-outs. The keepouts.js
comment "comes back into the model on a falling tide" asserted a mechanism that did not exist.

* `applyWaterOffset(wl)` is now the ONE writer of `sea.waterOffset` (onState and the manual Water m
  override both call it). It rebuilds once the level is `TIDE_REBUILD_M` (0.1 m) from
  `nogo.builtOffset`, which `rebuildNogo` records. **Measured from the BUILT level, never the last
  reading** - station updates move a few cm, and a frame-to-frame test never adds up.
* onState applies it BEFORE `clearanceGuard()` reads the model in the same frame.
* Tests: `min_depth_floor.js` 12-16, driven - the page's own function against the real builder over
  a 4.5 m fall in 5 cm steps (45 rebuilds). TEETH: 8 sidecar mutations, 8 killed.
* Docs: ops manual 7.1 and README state the property; the tech manual GUARDS entry and the hook
  advice name the rule. Docs rebuilt, `docs_valid.py` green (pages not rasterized).
* **Still Andy's call, not built:** whether PLANS should credit the tide at punch time at all, or
  plan to datum / the predicted low over the run window.
* Not done: no live browser check (the logic is driven in the suite; the wiring is source-checked).
* ⚠ The commit hook is likely to go red on `hold_station.py` 11b - review item #8, flaky 4 of 6
  runs at f10b0ec3 because Stop leaves `holding` set. Retry the commit; never `--no-verify`.

---

**⚠ OPEN, 2026-09-11 — EASTPORT: "WHAT IS THE STORY WITH THE LINE HEADING OUT TO THE
NORTHWEST?" NO CODE CHANGED FOR THIS; THE ANSWER IS WITH ANDY.** He was running a 9-row,
385-waypoint survey at **Eastport, ME** on his own console (port 8791), DriX H-8, buffer 3,
Min depth 4, lead 50/10, arc turns, and asked about a line leaving the block to the NW. Then:
*"there is a line drawn from buoy 7 to buoy 9"* and *"its a green dashed line like a survey
line"*.

**WHAT IS PROVEN (measured off his live `/api/state`, his `mission.json`, his session log and
his cached ENC — READ-ONLY GETs, no page opened on his console, his files byte-identical):**

* **The pattern is simple: it is EIGHT lines, not nine.** LINES rows 8 and 9 are two halves of
  ONE line — identical across-track offset (−673.5 m from line 1), identical heading (140.7°),
  split by a **392 m gap** where a keep-out cut it and detoured around. The across-track ladder
  is `0.1, 96.3, 96.1, 96.3, 96.2, 96.3, 96.2, 96.2` m — that leading **0.1** is rows 8 and 9
  sharing an offset. That is why two rows read 833 m and 1115 m instead of 2399 m.
* **The NW line is NOT in the committed plan or the uploaded route.** Of 444 uploaded
  waypoints only 54 stray more than 150 m off the coverage band, and those are the approach:
  3.1 km on **227°** (SW) from home to line 1's start. The only other long external line is the
  RTH, 2.8 km on **050°** (NE) back to home. Nothing runs NW but the survey lines (320.7°).
* **⚠ THE COLOURS ARE THE DIAGNOSTIC, AND THEY ARE NOT WHAT ANYONE ASSUMES.** The COMMITTED
  survey lines (`mission.lines`) are drawn **YELLOW** `#ffd76a` with the `L#` labels. GREEN
  DASHED is a different layer and there are two: `[5,4]` 1.6 px from the boat forward is
  **`runRoute`** (the uploaded run path), and `[3,3]` 1.4 px is **`patClip` — the UNCOMMITTED
  pattern preview**, drawn only while `pat.A` is set and drawn OVER whatever is committed.
* **His SURVEY SETTINGS panel was describing a different box from the committed plan:**
  panel `spacing 13.8 m · line 352 m · width 220 m · direction 350° · 19 lines` against
  committed `spacing 96.2 m · line 2458 m · direction 320.7° · 8 lines`. That mismatch is
  exactly what a stale preview over a committed plan looks like.
* Cobscook Bay Buoy 7 is 1.6 km NW of the block, Popes Folly Ledge Buoy 9 is 4.9 km SE; a line
  between them is 6.6 km on 309°, straight through the survey along its axis and out both
  ends. Nothing in the plan or route does that.
* **RULED OUT, each by measurement:** the trail (`checkBoot` drops it on the boot id a port
  change mints); the ROC layer (`rocs: []`); the boundary (empty); the buoy-derived channel
  model (`chans` are five small rings round the harbour, not a 6 km centreline); and the
  `HOME→ 256°` pill, which is CORRECT — `azTo(home, boat)`, "Bearing and range from Home to
  the ASV" per its own tooltip; home is genuinely 076° / 3.8 km ENE.

**THE ONE-CLICK DISCRIMINATOR HE WAS GIVEN:** SURV → RESET clears the pattern anchors. If the
NW line goes with them it was the preview, not the plan. **His answer is not in yet — start
there.**

**TWO FIXES OFFERED AND NOT YET TAKEN (his call):**
1. The LINES table should say a split line is a split rather than inventing a ninth row — a
   count the operator cannot reconcile with what they can see reads as a fault.
2. The pattern PREVIEW should be visually distinguishable from the COMMITTED plan. Today the
   committed lines are yellow and the preview is green-dashed, which is a distinction nobody
   can be expected to know; it cost this whole investigation.

**⚠ DIAGNOSTIC RECIPES THAT WORKED, BOTH REUSABLE:**
* **The session log is a fixture nobody has to build.** `logs/*.jsonl` carries the
  `/api/cmd/upload` body (which IS `runRoute`), every command with its body, and ~1 Hz
  telemetry. Replaying those frames through the REAL `assess` is what turned "it chatters"
  into "2.80 kn reads slow and 2.99 kn reads clear from the same position".
* **An isolated copy, never his console.** Copy `*.py` + `static/` + `vessels/` +
  `ports*.json` (+ his `mission.json` to reproduce a plan) to a temp dir, `mklink /J` the
  `charts/` cache back to the real one, run on 8796 with `--base <port> --vessel <id>`.
  **NEVER open a browser page on his console** — a second client runs its own clearance guard
  and speed governor and starts POSTing commands to the boat. Read-only GETs are fine.

---



**NEWEST (this commit): THE OTHER THREE OF ANDY'S FOUR — THE OSCILLATION, THE RUNG THAT CAN
ANSWER A TURN, AND THE TWO RESUME BUGS.** *"Fix all four, in that order."* The first (the
root) is the commit below this one.

**② THE SLOW/RELEASE OSCILLATION.** His log, 35 s before the survey stopped: **36
`/api/cmd/speed` commands**, low/survey alternating about once a second. Replaying the
recorded telemetry through the real ladder found the cause and it is NOT the counterfactual
being wrong — it is the question being unstable. On that route (waypoints 0.20 m apart, the
defect the commit below fixes) `projectRoute` grabs a different vertex on a 7% speed change,
so **2.80 kn read `slow` and 2.99 kn read `clear` from the same position**. Thinning the same
route to a 1 m floor takes the level changes over those 37 frames from **2 to 0** and makes
the counterfactual agree with the live reading on every one.

So the root is upstream, and this is the damping that should have been here anyway:
`releaseSettled(ok, now)` — **no single frame may hand back the throttle**. `RELEASE_HOLD_MS`
is 4000, four times the period actually recorded. The counterfactual is the CORRECTNESS test
("would the speed I am about to restore trigger it again?"); the dwell is the SETTLING test.
The clock is an argument so it can be driven over a synthetic minute — a dwell tested by
sleeping is a dwell nobody runs.

**⚠ AND IT IS ASKED ONCE A FRAME, ABOVE THE BRANCH.** Written as a reset on the not-clear
path it survived a mutation sweep: a line anybody could delete with nothing reddening, and a
dwell banked before a slow episode would then release on the first clear frame after it.
Evaluated unconditionally the property holds by construction.

**③ THE RUNG THAT CAN ANSWER A TURN.** Andy: *"The deviation rung can't answer a turn."* His
log proves it — **not one `/api/cmd/amend` all session**, with 15 m of budget unspent, because
`edgeAround` may move a CORNER and a reversal is a run of vertices a metre apart. **But the
answer to a turn was never a deviation.** A turn's trouble is TRACKING and the lever on
tracking is SPEED. From the point the guard stopped her, on her own route:

```
3.0 kn (survey):  hold    "entry in 14 s under way"
1.5 kn (low):     clear   "nothing within 45 s on the route ahead"
```

So the hold rung re-asks the projection at the low speed BEFORE taking the way off, and slows
instead of stopping when that answers it — same shape as the release counterfactual, asked of
the state being proposed. **Not offered when she is already slow** (that answer has been
tried) and **not in extremis** (the drift-only track enters too; stopping is no answer either
and the helm rung is the one that is). ⚠ Mutation proved the `helm` half UNREACHABLE — helm
comes from the drift-only projection, which does not change with commanded speed — and the
clause is kept with that written beside it rather than claimed as covered.

**④ THE TWO RESUME BUGS FROM `228961d1`, both live in his log.**
* **The arrival gap.** A hold uploads its one-waypoint plan and STARTS it; `holding` is
  reported only on ARRIVAL. Commanded 12:39:00, station-keeping 12:39:05 — five seconds in
  which `behavior` is "hold" and `holding` is false. `guardHeldOffer` demanded `holding`, so
  the next telemetry frame spent the captured survey. The predicate is
  `run === "running" && behavior === "hold"` now, arriving or arrived.
* **The second firing.** The hold rung fired **three times in five seconds** as the clearance
  closed (25.4 → 24.0 → 21.3 m). `markGuardHeld` began with `guardHeld = null`, so by the
  third call — behavior already "hold" — it returned early having already spent what the
  first captured. **A function that gives up has to leave what it found alone.**

⚠ Neither was in the fixture: it set `behavior` and `holding` in the same statement and never
called the capture twice. Same lesson as the hand-built plan, one layer down.

**TEETH: 19 mutations across the three, all killed** (12 more on the commit below). Checks
`clearance_guard.js` 15b-15j (the dwell driven over a synthetic minute; the slow-before-hold
rung driven on in_extremis's pier, with both refusals) and `guard_resume.js` 8b-8c, 8b0-8b1.
`clearance_guard.js` now carries a DRIVING harness for `clearanceGuard`, which it did not
before — 15f-15j could not have been source checks.

**⚠⚠ WHAT THE LIVE RUN SHOWED, AND THE OPERATOR CONSEQUENCE.** Ran his exact 645-waypoint
plan on an isolated console with all four fixes:

```
before:  36 speed commands in 35 s, three holds in five seconds, stopped at  90 s
after:   10 speed commands in 419 s, ONE hold,                    stopped at 419 s
```

**Still stopped** — because that plan's turns were PUNCHED BEFORE fix 1 and still carry
0.20 m vertices. Fixes 2 and 3 turn a 90-second stop into a seven-minute run and take the
throttle abuse down about fourfold, but they cannot make an unflyable route flyable. Asked
from the exact point the guard stopped her:

```
her plan, punched BEFORE the fix : ladder at 3.0 kn = hold
the same reversal, punched AFTER : ladder at 3.0 kn = clear
```

**⇒ AN EXISTING PLAN MUST BE RE-PUNCHED to get fix 1.** Tell the operator that; it is not
discoverable.

---

**BEFORE THAT: A TURN IS VERIFIED AS A TRACK, NOT AS A DRAWING — AND THE ROOT WAS
THE WAYPOINT SPACING.** Andy, 2026-09-10: *"the ASV is on hold and there is no way to release
the hold and continue without resetting the entire survey. Am I correct in this?"* He was.
Then, on the four defects that came out of the diagnosis: *"Fix all four, in that order."*
This is **the first of four** — the root; the other three are consequences.

**WHAT HAPPENED, off his own console and his own cached chart.** A 645-waypoint / 17-line
survey, Z-Boat, buffer 3 m, Min depth 3 m, eased turns, lead-in 15 m. She reached coverage
line 1, ran 76 m of an 87 m line, and the guard held her eleven metres short of the end. The
reversal immediately ahead (waypoints 2-18) sat 3.75-4.4 m off a keep-out at a 3 m buffer —
clear by 0.75 m, and `punchOut` was right to ship it. The guard's projection over the same
waypoints came within **2.9 m** and called an entry.

**⚠⚠ THE REASON THEY DISAGREED IS THE VERTEX SPACING, AND NOTHING ELSE.** That reversal was
emitted with vertices **0.20 m** apart. Both the vessel (`approach_m` 1.0, `arrival_m` 2.0)
and the guard's `projectRoute` advance to the next waypoint the moment they are within the
approach radius of it — so nine vertices are swallowed in one integration step and the boat
is left steering at a point half way round the loop. It flies a CHORD across the inside of
its own turn. Walked through the guard's own integrator:

```
as emitted, 39 waypoints, min gap 0.20 m  ->  flown track came within 1.42 m: ENTERS
thinned to a 1 m floor, 15 waypoints      ->  flown track came within 4.01 m: clear
```

**The drawn polyline is 3.75 m off either way. Sampling it eighteen times finer moved the
FLOWN track 2.6 m closer to the feature.** A route sampled finer than the approach radius
that consumes it is not a finer route; it is a worse one. That sampling came from
`spiralTurn`'s `Ls / 8` (my clothoid commit, `70d74d19`) meeting a hull whose settle length
is 2.31 m — written for a DriX at 15 m, floored at 0.35 m, and never asked what would follow it.

**THE FIX, in `static/js/turns.js`.**
* **`thinTrack(pts, minGapM, ref)`** — no two waypoints closer than the approach radius.
  E and F are in the chain that is thinned, not outside it: a first arc vertex 0.20 m off the
  line end is the same seam. A crowded LAST point drops its neighbour, never itself.
* **`turnFlyable(...)`** — every candidate shape is projected with the guard's own
  `projectRoute`: same integrator, same turn rate (`V.MAX_TURN_RATE_DEG_S`), same approach
  radius (the identical expression `guardTrack` uses), same model, same buffer. Horizon is the
  SHAPE'S OWN LENGTH, not 45 s, or a long turn stops being checked half way round. Flown in
  still water — the plan may be flown on the other half of the tide.
* **Thin, THEN verify.** Checking the dense shape and shipping the thinned one is this same
  defect one layer down.
* **The eased rung is withheld** when `easeLs < 4 × gap` — what would ship is an arc wearing
  the word "eased".
* **Armed unless disabled by name.** `fly === false` is the only opt-out (the pure-geometry
  suites); an omitted argument still checks. Same rule as chart.js's `enforce` whitelist.
* punchOut passes `fly` at both call sites and the banner names the new refusal: *"the hull
  cannot TRACK without entering it - the shape fits on paper, the boat flown along it does not"*.

**⚠ A DOCUMENTED SAFETY RUNG'S WINDOW MOVED, DELIBERATELY.** `direct_turn.js` 10 (the wharf
rung) squeezed the outboard water to 3.5 m and demanded an inboard turn. At 3.5 m there is
0.5 m of clear water in front of a hull that needs 1.47 m of radius: it cannot make ANY turn
there, and the loop the old check demanded was one the boat would have clipped. The fixture
is 4.0 m now, where the inboard rung is still reached and still chosen, and a NEW 10b pins the
other edge — at 3.5 m it must REFUSE. That is only safe because a refused reversal has not
shipped as a straight leg since punchOut started flagging it UNSAFE: it blocks Upload.
**Swept across that fixture the two answers are identical from 4.5 m out** — the flyability
test costs nothing in ordinary water and bites only in the last half-metre.

**TEETH: `tests/turn_geometry.js` 43b → 49 (six new), 12 mutations, all killed.** The teeth
that matter are 47 (the SAME semicircle, sampled 94 ways and 14 ways, `legClear` passes both
and only the flown track separates them) and 47b (a 94 m arc against a 45 s horizon).

**⚠ ONE MUTATION IS DELIBERATELY ABSENT AND THE REASON IS WRITTEN DOWN.** Removing the
`legClear` re-check of the THINNED polyline kills no test: across every fixture built for it
(a pile swept 0 to 1 m inside the arc; a pile on the final chord into F) the projection
refuses everything the polyline does. The line is kept — `patRoutes` is what is drawn and
uploaded, and the artifact that ships has to be verified as itself — but it is belt-and-braces
over a stricter test, and inventing a contrived fixture to redden would be theatre.

**STILL TO DO, IN HIS ORDER:** (2) the slow/release oscillation — 36 throttle commands in 35 s;
(3) the deviation rung cannot answer a TURN (0 amendments all session, `edgeAround` returns
null on a 17-vertex arc it can only nudge one vertex of); (4) the two resume bugs from
`228961d1` — `guardHeldOffer` demanding `holding` through the 5 s arrival gap, and
`markGuardHeld` nulling before its own guard.

---

**BEFORE THAT: A CHARTED HAZARD THE CHART PROVES PASSABLE IS DROPPED FROM THE
KEEP-OUT MODEL, NOT MERELY STRIPPED OF ITS EXTENT.** Andy, 2026-09-09, with a screenshot of
a survey plan and a hook drawn round it in red: *"The avoidance maneuver circled in red for a
rock on the chart is unnecessary. Check charted depth and draft of the chosen ASV and tell me
why the avoidance maneuver was implemented."* Then, given the two levers: *"Drop a
proven-passable hazard from the model"*.

**THE DIAGNOSIS, MEASURED OFF HIS OWN PLAN AND HIS OWN CACHED EXTRACT.** The feature is an
`Underwater_Awash_Rock_point` at 43.070934, −70.706792, 81 m from the boat on 111°, carrying
**VALSOU 8.8 m**; plus the live +0.20 m that is **9.00 m of water** over a Z-Boat drawing
**0.12 m** with a **2.0 m** floor in force. It was never a depth refusal:

* `hazExtent` was already returning **0** — the sounding test fired and the assumed 50 m
  wreck radius had already collapsed. That part was right.
* But **`buildKeepouts` pushed the feature in anyway**, extent 0, so the operator's **3 m
  buffer** made it a 3 m no-go dot. Blocked at 3 m, clear at 4 m — probed.
* The dot sat **0.2 m off a survey line**. `clipLine` (2 m sampling, one dropped sample each
  side) split a **350.4 m** line into **334.5 m + an 8.0 m offcut**.
* punchOut serviced the offcut like any other line, because this hull's `min_survey_line_m`
  is **0**: **77 m of track across 16 waypoints to collect 7.8 m of coverage**. A straight
  hop between the two neighbours is 40 m. That hook is what he circled.

**hazExtent's own docstring had said the vessel "can pass over it" since the rule was
written. It could not** — a point in this model still carries the buffer.

**THE FIX.** New `hazPassable(f, opts)` in `static/js/keepouts.js`; `hazExtent` delegates to
it; `buildKeepouts` **`continue`s** on a passable hazard and counts what it dropped
(`ko.passed`). Only the four `HAZ_UNKNOWN_EXTENT` classes reach the test — a pile, buoy or
beacon is an obstruction AT THE SURFACE and no sounding under one makes it passable. Absent
VALSOU is still UNKNOWN and still takes the full berth.

**⚠ AND THE FLOOR IT IS JUDGED AT MOVED, WHICH IS THE SAME LESSON `nogoReadout` LEARNED.**
Two floors were reaching one model build: depth areas filtered at `nogoDR().min` (the deeper
of the hull's limit and the operator's Min depth) while `hazExtent` and `nogoKind` were handed
`V.NOGO_MIN_DEPTH_M`, the hull's alone. `koOpts()` now carries the EFFECTIVE floor, which
fixes three things at once: a test that REMOVES a keep-out is no longer decided at a shallower
floor than the water around it (the conservative direction); the dashed circle the chart draws
round a sized hazard matches the radius the router keeps out of, which is the exact fault the
drawing code's own comment exists to prevent; and a shallow-water polygon no longer reads
*"water shallower than 1.0 m"* on a model built at 2.0.

**WHAT IS GIVEN UP, AND WHERE IT IS SAID.** A dropped hazard no longer refuses a leg, no
longer appears in `blockedInfo`, and no longer counts toward `clearanceM`. It is **still
drawn** — the overlay reads the extract, not the model — and the Nogo row's tooltip now reads
*"Passed over: N charted hazards are NOT in this model … Still DRAWN on the chart"*. Not on
the face of the row, because in charted water it would be up permanently and a chip that is
always up is a chip nobody reads.

**TEETH: `tests/wreck_clearance.js` 12 checks → 21, 11 mutations, all killed.** The new ones
DRIVE `buildKeepouts` and the page's own `clipLine` rather than asking `hazExtent` again —
the whole defect was a function returning the right number beside a model that kept the
feature anyway, so a second look at that number would have agreed with the bug. Check 20
drives `nogoReadout` for the same reason; the one mutation that survived the first sweep put
`XX` in place of the sentence's AUTHORITY clause while leaving the arithmetic, and the check
now pins that the tooltip names the chart's own sounding, not just the numbers.

**VERIFIED BOTH WAYS.** Headless, on the reported line: before `334.5 m + 8.0 m`, after a
single `350.4 m` run; the same rock with its VALSOU removed still clips it to 284.7 m. Live
on the real page and the real chart at New Castle: 10 hazards dropped and the tooltip says so,
the kind labels now use the effective floor, and a 74-line punch straight over the rock came
back **74 lines → 74 segments**, no split, no line under 30 m, no console errors.

**⚠ THE SECOND LEVER IS STILL OPEN, AND IT IS HIS CALL.** `min_survey_line_m` is **0** on
`zboat_1800hs` (the DriX's is 80 m), so ANY offcut, however short, still earns a pair of
reversals. That is what turned a 3 m dot into 77 m of track, and it will bite again on any
line a hazard legitimately clips. Offered, not taken.

---

**BEFORE THAT: A SURVEY THE CLEARANCE GUARD STOPPED CAN BE HANDED BACK, AT LOW
SPEED.** Andy, 2026-09-09: *"after a survey is punched out and uploaded, there can be nogo
violation event that cause a hold and loiter. This should not happens because punch out should
correct before the run. However, in the event this situation happens, institute a feature
wherein on resume, the user should be provided an option to force the ASV survey to continue at
slow speed."*

**TWO THINGS WERE MISSING, AND THE SECOND IS THE EXPENSIVE ONE.** The guard bar's only offer
was PROCEED, which hands the throttle back to the governor and returns the boat to the SURVEY
speed — so past a feature the operator can see, the choice on the bar was "full speed" or "no
survey". And once the HOLD rung has fired it is too late for either: `hold` uploads a
one-waypoint plan over the survey (`Engine._run_route`), so the vessel's plan IS the hold point
and `wp_index` counts that. **That rung's own comment said the survey "cannot be resumed ... the
console's only way back is to re-run from waypoint one". It was right. It is not any more.**

* **`guardHeld`** keeps `{route, idx, mark, kind, clearM}` — captured by `markGuardHeld(c)` in
  the frame BEFORE the hold command goes out, because afterwards `window._wpIndex` describes the
  hold. Only for a SURVEY with an unflown remainder; a held Go-To is re-commanded in one click.
* **The bar outlives the rung.** Once she is station-keeping the ladder reads CLEAR *by
  construction* — `hold` is only ever reached when the drift-only track is clear, which is the
  state stopping produces — so the box that named the hazard used to go out within a frame of
  the survey being stopped, and nothing on screen said the run was over. `renderHeldBar` puts up
  **SURVEY HELD — LOITERING**, naming what she was stopped off and how many waypoints are
  unflown, with **RESUME SURVEY AT LOW SPEED** and **LEAVE IT HOLDING** (which asks first).
* **`guardOverride` has two strengths now**, one record: `.slow` suppresses only the rung that
  STOPS her, a full PROCEED suppresses the slowing too. Both keep the alarm, the readout, the
  deviations and the helm, and both lapse the same three ways. `overSlow` in `clearanceGuard`.
* **`continueAtLow()`** is the same decision taken before the hold, off the live bar.
* **The low speed is the OPERATOR'S**: `clearance.slowed` is handed back at the moment
  `resumeSlow` is taken, or the guard's own release restores the survey speed behind them.

**⚠ THE PAUSE BEFORE THE UPLOAD IS THE SAFETY HALF, AND IT IS MEASURED, NOT REASONED.**
`upload_plan` clears `_holding` and adopts the TRANSIT role's speed while `_running` is still
true from the hold — so an upload to a station-keeping boat releases her before the Start that
was meant to. Driven against a real console on 8796, transit set to `high`:

```
after HOLD                 run=running behav=hold  holding=True  sog=3.00 kn
4 s after UPLOAD (no pause) run=running behav=hold  holding=False sog=8.91 kn   <- no Start sent
   PEAK SOG in those 4 s: 8.17 kn, still climbing toward the 14 kn transit setting
3 s after PAUSE+UPLOAD      run=paused  behav=hold  holding=False sog=0.09 kn
after speed low + START     run=running behav=survey              sog=3.93 kn
```

So the order is **pause → upload → speed low → start**, and a refused upload re-issues the
HOLD rather than leaving her paused and drifting beside the thing she was stopped off.

**AND `legClear` THROWS ON A NULL FRAME**, which `resumeRun` (last commit) was exposed to as
well: a resume pressed while the keep-out model is rebuilding would have thrown inside the
handler and the button would have done nothing at all, silently, on a safety path. Both go
through **`backtrackClear()`** now, and **no model is not a pass** — the console cannot certify
water it has no chart for, so unknown gives up the backtrack exactly as foul does.

**TEETH: new `tests/guard_resume.js`, 22 checks, 23 mutations, all killed** — GUARDS entry in
this commit (65 suites, 65 entries). **⚠ THREE SURVIVED THE FIRST SWEEP AND ALL THREE WERE THE
SAME MISTAKE:** 19 and 20 grepped the function bodies for the banner and the confirmation, so
`if(false)` in front of each left every string in place and both stayed green — the override
silent, the remainder discarded unasked. And 16 drove the rungs but not the SAME rung twice: it
set `guardLevel = "hold"` for the overridden runs, which makes `escalated` false, so those runs
sent nothing for a reason unconnected to the override and the CONTROL walked through. Its own
detail line had been printing the evidence from the first run. `tests/track_edge.js` 22 was
updated deliberately — the slow rung's gate is `overridden && !overSlow` now.

**⚠⚠ WHAT THE LIVE RUN DID AND DID NOT SHOW.** Confirmed against a real console on 8796 with a
REAL punched plan (14 lines, 1245 waypoints, New Castle ENC): the page loads clean, both offers
are present and correctly labelled, and the guard bar renders live at the real EDGE and HELM
rungs with `#gb_low` correctly WITHHELD at both — the "and nowhere else" half of the offer
contract, in the real DOM. **NOT seen live: the HOLD rung itself**, so neither the SURVEY HELD
bar nor the resume was watched on the water. Staging a hold needs the buffered edge 30-70 m
ahead ON THE ROUTE with the drift-only track still clear; at New Castle the deviation rung kept
answering it first, and a buffer big enough to beat that put the boat inside the buffered zone,
which is HELM, not hold. **Next session: stage it deliberately** — a small survey in tight water
with the deviation budget already spent, or a fixture that drives `clearanceGuard` in the page.

---

**BEFORE THAT: PAUSE FLASHES AND TOGGLES, AND RESUMING BACKS DOWN THE LINE.** Andy,
2026-09-09: *"When a pause happens during survey the pause button should flash until pause
button selected. Behavior of ASV is to then turn back to the point in the survey line where
the button push happened, backtrack 12 boat lengths and continue the run at low speed or
until user changes speed manually."*

**Pause is a toggle now.** It used to grey out the instant it worked, leaving Start — a
control nobody looks at during a run — as the only way back. While paused it reads RESUME,
is enabled, and FLASHES (steady amber under `prefers-reduced-motion`: the state is a safety
readout, not decoration). Start still resumes and goes through the **same** `resumeRun()`, so
the behaviour cannot depend on which button the operator reaches for.

**THE BACKTRACK.** `markPause()` records `{line, along, fwd, at}` at the PRESS. On resume,
`resumePointOn()` returns the point twelve hull lengths back down that line, and the plan's
remainder is AMENDED to `[thatPoint, ...runRoute.slice(idx)]` — so she runs back, then
forward through the pause point and on. Four things are load-bearing and each has a check:

* **The mark is taken at the press and never re-derived.** She drifts while paused; reading
  the position again on resume returns the drift, not the mark.
* **The direction is read off the route, not assumed.** A plan edited in WPT mode need not
  run a→b, and backing the wrong way drives her into water never surveyed and lays the
  overlap on the far side of the gap.
* **Amend, not upload** — an upload resets `_wp_index` and would re-run the survey from line
  1. `amend_plan` needs `_running`, and pause leaves that TRUE while stopping the prop, so
  the remainder is rewritten **while still paused**, before the run is released.
* **Twelve BOAT LENGTHS**, from `hull.loa_m`: 92.5 m on the DriX, 22.8 m on the launch. A
  hull that declares no length gets no backtrack rather than a guess.

A foul way back gives up the BACKTRACK, not the resume, checked with the real `legClear`.

**LOW UNTIL THE OPERATOR SAYS OTHERWISE.** `resumeSlow` is a hold in the same shape as
`clearance.slowed` — the governor returns null while it is set — but a different authority:
that one is the safety ladder, this one is the operator's standing instruction, so only a
manual role-speed change ends it (`setRoleSpeed`), along with Stop and a fresh Start. It is
set whether or not there was a line to back down.

**TEETH: new `tests/pause_resume.js`, 19 checks, 19 mutations, all killed** — GUARDS entry in
this commit (64 suites, 64 entries). **⚠ THE FIRST SWEEP LEFT THE CONTROL ALIVE**, which is
the one that matters: checks 9-12 grepped `resumeRun`'s source, so switching the whole
backtrack off (`const to = null`) left every string they look for in place and every check
green — the feature disabled and the suite content. They DRIVE the function now and read what
it SENT. Two more went with it: a fixture where the boat only ever ran a→b could not tell a
direction that was READ from one that was ASSUMED, and an unwrapped call to a mutated
`markPause` threw and killed the run before any FAIL line printed.

**⚠⚠ WHAT THE LIVE RUN DID AND DID NOT SHOW — READ THIS BEFORE TRUSTING THE BACKTRACK.**
Confirmed on the water: the button flashes, toggles, and reads RESUME; the resume commands
`low`; the banner and the Intent card say what happened. **NOT confirmed: the backtrack
itself.** The resume reported *"not on a coverage line when it was paused"* even though the
boat was measurably 253 m along line 1 at 5.7 m cross-track — because `runLineIdx` was −1,
and the LINES table's `actual` column was `--` for both lines, which is the same fact.

**That was my fixture, not the feature.** To dodge slow chart-clicking I POSTed a hand-built
4-waypoint plan (line endpoints only, NO turn vertices); Upload routed it to 21 waypoints by
splicing detours INTO the line legs, so no route leg matched a committed line within
`LINE_MATCH_M`. A real punched plan carries its own turn vertices and matches — verified
headlessly on 2026-09-08 (all 6 lines found by the real `currentLegLine`). **Next session:
watch a pause on a REAL punched plan, in water where the clearance guard is not firing** —
it took the run into a `hold` here, as it did during the lead work.

**Before that (`70d74d19`): EASED REVERSALS — clothoid, arc, clothoid.** Andy: *"build the
clothoid version too."*

Every other reversal in this console steps its curvature from 0 to 1/R the instant the boat
leaves the line — an infinite rudder rate, which the hull answers by overshooting and
settling, and that settling is what the lead-in exists to hide. The eased shape ramps
instead, so the helm rate is constant and the boat rolls onto the next line already straight.

**THE GEOMETRY.** One spiral turns `τ = Ls/2R`, the core takes `π − 2τ`, and the three
phases sum to π exactly for any Ls and R. The shape is symmetric about its half-way point,
so it ends ABEAM of where it started — VERIFIED, the integrated along-track displacement is
1e-13 m and the heading 180.000000° — which is what lets the along-track offset be absorbed
with an on-line straight exactly as in the other two shapes. R is **solved** against the
integrated crossing; `R = [d/2 + sqrt(d²/4 − Ls²/6)]/2` only seeds it.

**⚠ AND THE SOLVE, NOT THE SEED, IS WHAT DECIDES R — ESTABLISHED BY MUTATION.** Deleting the
spiral term from the discriminant, and even dropping the halving so the seed comes out at
TWICE the right radius, both still converge in three Newton steps. **My own header had
claimed R "comes from a closed form, not a search"; the mutation run corrected it.** Only
the FEASIBILITY test genuinely needs the closed form (no radius spans a crossing under
`Ls·√6/2`). Do not "simplify" by trusting the seed: at a long spiral it is tens of
millimetres out and nothing downstream would say so.

**⚠⚠ THE EMIT STEP IS PART OF THE SHAPE, NOT A DETAIL.** A polyline cannot express curvature
continuity — the boat gets WAYPOINTS. MEASURED on a 40 m crossing at Ls 8, worst curvature
change between consecutive waypoints: at the ordinary 3 m arc step eased 0.0188 against the
plain arc's 0.0286 (**1.5× — a label, not a feature**); at 1 m, 0.0065 against 0.0400 (6.2×).
Note which way each moves: refining the sampling drives the PLAIN arc's figure UP toward its
true discontinuity and the eased one DOWN toward its bounded derivative, and that divergence
is the only proof the two shapes differ at all. So the spirals are emitted at `Ls/8` and the
core at the ordinary step — measured better than a uniform fine step on every axis (42
waypoints against 67 for identical curvature figures).

**MEASURED ON A LIVE 7-LINE PUNCH, per turn, isolated (a plan-wide worst vertex is useless
here — two pairs have no turn at all and a straight 180° dwarfs everything):**

| pair | arc | eased | |
|---|---|---|---|
| 1→2 | 0.0491 | **0.0071** | 6.9× |
| 3→4, 4→5 | 0.0494 | **0.0071** | 7.0× |
| 5→6 (racetrack; easing did not fit) | 0.1204 | 0.1204 | unchanged |

90 → 117 waypoints over the plan. Better than the synthetic 3.2× because the real Ls is 14 m
(4 s at this hull's turn speed), which resolves the ramp further.

**WIRING.** `maneuvering.steering_settle_s` in `vessels/*.json` → `V.STEERING_SETTLE_S` →
`easeLsM() = settle × roleSpeedMS("turn")`. **The TURN speed, not the survey speed.** Absent
or zero = the vessel cannot ease, and `updateEaseNote` says so in the warning colour rather
than letting the control read "Eased" over a plan of plain arcs. **The shipped settle times
are ESTIMATES (1.5 / 2.5 / 4.0 s) and no trial has been flown** — how to measure one is in
`state.js` beside the constant. **OFF by default**, and `easeLs = 0` makes `turnWithRetry`'s
ladder byte-identical to the one that shipped before this existed.

**⚠ EASING IS A RUNG ON TOP OF THE LADDER, NEVER A REPLACEMENT** — same guarantee shape as
the lead give-way ladder. It refuses more readily than the plain arc, and its refusal is
deliberately NOT the one reported: `first` skips the eased rung, so "why is there no turn
here" is still answered by the arc the operator expected rather than by a comfort shape
complaining about a crossing too narrow for its spiral.

**TEETH: 19 mutations, 17 killed.** The two survivors are the seed mutations above and are
recorded as INERT with the reason. **The control mutation crashed the suite** — check 37 went
red as intended and then check 38's DETAIL string read `es.pts.length` on a refusal and
threw, losing every check after it, which the runner scores as SURVIVED. `turn_geometry`
evaluates details eagerly; a detail must be as total as its condition. **And `direct_turn.js`
was mutation-blind** (fixed path to asv.html) — the third suite in three commits, which is
why `task_9844f26c` exists for the remaining 22.

**⚠ A COUNTER I FORGOT, CAUGHT ONLY ON THE WATER.** `nRoute = patRoutes.length − nSemi −
nTear − nRace` is "what is left after the turns are taken out", and I added `nEased` without
adding it there — so the eased run reported *"3 routed around obstacles"* where the identical
arc run reported none. A count the operator cannot reconcile with the chart reads as a fault
in the plan. Any new turn shape has to be subtracted there too; `direct_turn` 13 now pins it.

**Before that (`0f5eb6ec`): THE REVERSAL IS BUILT FROM THE TWO POSES, AND THE LEAD GIVES WAY
TO THE TURN.** Andy, looking at a punched plan with leads on it: *"The turns for the lead-in /
lead-out don't make great sense. In the attached picture, I scribed a curve that works better
with red marker. Use a pattern like this and find a mathematical rather than just arbitrarily
drawn curve."*

**⚠⚠ THE LEAD FEATURE SHIPPED A REAL DEFECT AND THIS IS IT.** `teardropTurn`'s SEMICIRCLE
branch centred its arc on the midpoint of E–F and took its radius from half that CHORD, so
its tangents were perpendicular to the chord rather than to the LINES. While the two ends are
abeam those are the same thing — which is why the shape was right for months. Give the pair
an along-track offset and the error is exactly `atan(along / lateral)` at BOTH ends.
**MEASURED: 40 m lead-in against a 25 m lead-out → off the line at 19.2°, onto the next at
21.9°. A 40 m lead-in with no lead-out → 44° and 46°.** A feature whose entire purpose is to
have the boat settled on the line was throwing it onto the line at 46°.

**THE FIX IS WHAT THE OTHER TWO SHAPES ALREADY DID.** `racetrackTurn` and the TEARDROP branch
both decompose E→F into along/lateral and run the offset out ON THE LINE before they arc —
the teardrop's own comment says so. The semicircle was the one shape in the file without it.
`along`/`lateral`/`rgt` are hoisted above the branch now, R is half the **crossing**, and the
branch gate moved to the crossing with it (gated on the chord, a tight crossing with a long
offset hands the boat a radius BELOW its own minimum — 6.0 m against a floor of 8.3 m; that
is check 33b, and the first mutation sweep missed it because every fixture was 40 m spacing).
After: every generated turn leaves the line at **0.0°** and joins at 4.3° (the arc's own
half-chord at a 3 m sampling step), measured on a live 7-line punch.

**TWO THINGS THE FIX EXPOSED, both pre-existing:**

* **`outboard` was ASSERTED, not measured** — the semicircle said `R`, the racetrack said `R`.
  With a run-out the shape reaches `along + R`, so both under-reported by exactly the offset,
  and that is the number the operator answers *"is that water clear?"* with. Measured off the
  points now, in every branch.
* **`along` is 1e-14, not 0, on an abeam pair** — so `if (along > 0)` pushed a waypoint on top
  of the line end. The plan carried a duplicate the boat "arrives" at instantly, and a bearing
  taken across it is noise: it read as a 90° kink out of a turn that was in fact perfect.
  `ALONG_EPS_M = 0.05` now, in all three shapes.

**THE LEAD GIVES WAY TO THE TURN (Andy's call).** A lead pushes the reversal outboard, so it
can take a turn that fitted and make it not fit. Rather than block Upload over a settling
distance, punchOut shortens BOTH leads on that pair — `LEAD_GIVE = [0.6, 0.3, 0]` — retrying
the whole ladder at each rung. **The last rung is 0 on purpose: with no lead the pair IS the
pair this console punched before the feature existed, so a lead can never be the reason a
plan has an unflyable turn.** Scaling both is the right knob because the water a reversal
needs past the COVERAGE end is `max(lead_in, lead_out) + R` — driven against the real shape in
survey_lead 34/35, measured 59.9 / 43.9 / 31.9 / 19.9 m against a prediction of 60 / 44 / 32 / 20.

**⚠ THE GATE CHANGE THAT WAS WRONG, AND HOW IT WAS CAUGHT.** Both spacing gates compare the
straight distance between two line ends against a multiple of the LINE SPACING, and a lead
inflates that distance. The first cut measured the CROSSING instead — geometrically the purer
answer. **It changed plans that have no lead at all.** The crossing is always ≤ the distance,
so it ADMITS pairs the old gate excluded, and the chart clip leaves adjacent runs at different
extents routinely: on the test plan two pairs sat 53.9 m and 22.0 m apart along track with no
lead involved, and measuring across pulled both into the reversal branch where a refusal is
flagged RED rather than routed around — **0 unroutable became 2**. It is a `leadSlack =
Math.max(wantIn, wantOut)` **allowance on the threshold** now, which is a no-op when it is
zero. `max`, not the sum: the separation a lead can open is `|lead_in − lead_out|`, whose
largest value is the larger of the two (strike_run 16c2).

**⚠ AND A CONSEQUENCE ANDY NEEDS TO KNOW ABOUT.** On the harbour test plan, **with no lead at
all**, the corrected geometry turns 2 of 6 reversals RED where the old one shipped them. That
is not a regression: those pairs are offset 53.9 m and 22 m along track, the old chord arc
reached 60.5 m past the line end while any shape actually tangent to both lines needs 68–74 m,
and that water is foul. The old plan was not fitting the turn in, it was cutting the corner.
The banner had to be fixed to say so — it called every red leg a blocked transit (*"the ASV
would cross the obstacle on those legs"*), which for a refused reversal is false in both
halves, since the straight line between those ends is exactly what IS clear.

**TEETH: 18 mutations, 17 killed.** The survivor is not a defect and is recorded as such:
dropping the run-out WAYPOINT (leaving the arc, which already starts at the abeam point) costs
**0.11 m of cross-track** on a 40 m offset — measured, not argued. **One mutation exposed the
`ais_table` harness fault again**: `clearance_guard.js` read `static/asv.html` by a fixed path,
so a mutation deleting a counter its own check greps for by name came back green. It honours
`ASV_HTML` now.

**⚠ core_turns.js IS OWNED BY THIS REPO AND HAS NOW DRIFTED FROM asv_core TWICE.** Its header
records both drifts and names the suite covering each. Do not re-vendor.

**Before that (`e75161ec`): LEAD-IN / LEAD-OUT — THE RUN IS NOW LONGER THAN THE COVERAGE.** Andy:
*"implement lead in and lead out extensions to survey lines a selection on the survey card.
They are meant to extend lines to accommodate settling of vessel steering onto path and
settling of IMU stability after a turn. The user should have options in the survey card to
select distance or duration."*

The SURV card takes a lead-in, a lead-out and a unit (`m` / `s`); Punch Out extends every run
past both ends of the coverage. **From this commit onward "the survey line" is two different
lengths of two different water, and every figure has to say which one it means.** That is the
whole design, and it is where every fault found while building this lived.

**⚠ A LEAD IS FLOWN WATER, SO IT IS CLIPPED LIKE FLOWN WATER.** A punched run ends either
because the operator's box ran out or because the chart said stop, and **nothing can tell
those apart from the endpoint alone** — so `extendLead` does not try: it asks the keep-out
model sample by sample through the real `clipLine`, takes only the stretch that STARTS at the
line's end, and reports what it bought. Against `koTurn`, not `koClip`: a lead is not
coverage, it is the water that connects coverage to a turn. **The ENC fetch pad grew to
`120 + max(leadInM(), leadOutM())`** — outside the extract the keep-out model is *empty*,
which reads as clear rather than as unknown, so a 200 m lead past a 120 m pad would be
certified over 80 m of chart nobody asked for.

**WHERE IT IS APPLIED IS THE DESIGN, and each wrong answer looks right on a plan with no
lead.** AFTER the min-line filter (a 40 m run with a 30 m lead at each end is a 40 m *survey*
line and must still be dropped); AFTER the strike filter (a strike is remembered as a
COVERAGE midpoint); BEFORE the turn loop (the turn happening past the coverage is the point).

**⚠⚠ THE STRIKE SEAM WAS A REAL BUG, CAUGHT BEFORE SHIPPING, AND IT WOULD HAVE BEEN
INVISIBLE.** `strikeSelectedRun` did `patClip = keptRuns(patClip)`, comparing the stored
coverage midpoint against the RUN midpoint — **which agree exactly while the lead-in equals
the lead-out**, the first thing anyone would type. With 40 in / 5 out the run midpoint moves
**17.5 m** against a 1 m tolerance. And `patLead` is parallel to `patClip`, so filtering one
without the other re-points every lead after the gap. Both are fixed in one pass in
`dropStruckFromPunch()`, and `strike_run.js` 24b-24e drive it — 24b prints the drift per run,
because an even lead hides all of it.

**A LEAD IS NOT COVERAGE, BUT IT IS THE SURVEY SPEED.** Two fields, two questions, and the
console already had both: `currentActivity()` returns `surveying:false` (the flag that titles
the readout *"acquiring coverage"*) with `role:"survey"` — flying the lead at any other speed
settles the boat onto the wrong one, which is the fault the lead exists to prevent. The
activity words are **LEAD-IN** / **LEAD-OUT**, Andy's own vocabulary. Coverage figures stay
coverage: `len m` in the LINES table (with a new `lead m` column beside it, shown only when
there is one — `plan` times the whole RUN because `actual` is clocked over the whole run), the
card's **Line len**, and the chart draws the lead stubs thin and dashed so the point where
data starts counting is visible.

**MEASURED ON A LIVE CONSOLE (spare port 8795, sim), same 7-line punch over a harbour:**

| | no lead | lead 40 in / 25 out |
|---|---|---|
| coverage | 1316.2 m | **1316 m** (every line within 0.08 m) |
| run | 1316 m | **1725 m** |
| lead bought | — | 409 m of 455 m asked, **3 runs cut short by the chart** |
| turns | 5 semicircle + 1 racetrack | **6 semicircle** |

The racetrack became a semicircle: the run ends moved outboard and the reversal found room.
The three short leads are real ENC obstructions — the safety clip firing on live data, and
said out loud on the card.

**TEETH: 36 checks in the new `tests/survey_lead.js`, 28 mutations, all 28 killed** (six of
them graded by `strike_run.js` 24b-24e and `survey_transit_roles.js` 15-15e, because that is
where the seam is driven). **Two survived the first sweep and both were checks standing in for
behaviour**: the lead-out probe sat at 390 m of a 400 m run, past BOTH ends' boundaries, so a
phase test reading the lead-IN at the far end passed (24c probes 375 m now, the metre that
separates a 30 m lead-in from a 20 m lead-out); and check 25 matched a bare `lead_mode:` and
passed against a rebuild that hard-coded `"m"` — the field present, the whitelist "complete",
and every stored duration coming back as metres.

**⚠ AND A THIRD MUTATION SURVIVED *CORRECTLY*, WHICH IS ALSO WORTH KNOWING.** Shrinking
`LINE_MATCH_M` to 0.0001 killed nothing, because check 15d's waypoints were the SAME OBJECTS
as the line endpoints — distTo exactly zero, so no tolerance can matter. They are copies now,
as `commitPattern` writes them, and **15e drives what that tolerance is actually for**:
coverage ends written as waypoints sit 30 m from the committed line ends and match NOTHING —
a whole survey flown and reported as an approach transit, at the transit speed, with no error
anywhere. That is why the RUN ends are what gets committed.

**⚠ AND ONE THING THE LIVE RUN DID *NOT* PROVE.** Watching the sim, the activity never
reached LEAD-IN: the clearance guard replaced the run behavior with `hold` in that cramped
harbour (`behavior: "hold"` at 13.8 kn on `/api/state`), so `currentActivity()` never entered
its survey branch at all. **That is the guard, not this feature** — proved by driving the real
`currentLegLine()` over the committed lead-carrying plan headlessly (all 6 lines matched
their own route legs) and then by `survey_transit_roles.js` 15, which flies the real
`accumLineTime` down a lead-carrying line: `lead-in@0m → surveying@35m → lead-out@135m`, one
speed role throughout. **If a lead-carrying run is ever watched on the water, watch it
somewhere the guard is not firing.**

**Persistence is the usual four places** (client `loadMission`, server `load_mission`, its
empty-file default, `save_mission`) for `lead_mode` / `lead_in` / `lead_out`. **The stored
value is the one the operator TYPED, in the unit they chose** — storing converted metres would
freeze a settling TIME into a distance, and the next survey-speed change would leave a lead
that settles nothing. The per-line `lead_in_m` / `lead_out_m` ride inside `lines`, which the
server passes through wholesale, and are written **only for a punched plan**: a lead's whole
safety argument is the chart check that produced it.

**Before that (`60903c45`): THE AIS TRAFFIC CARD IS STABLE BETWEEN UPDATES, AND TCPA IS ITS OWN
COLUMN.** Andy: *"The entire AIS traffic card blinks and resets data with each update. Make it
visually stable and update values independently. Place the closest AIS target at the top and
sequence down with distance. Add TCPA after the CPA column."*

**⚠ THE CARD ALREADY CLAIMED TO BE PATCHED IN PLACE, AND `ais_table.js` HAD NINE CHECKS SAYING
SO.** Reading it found nothing wrong, so it was reproduced instead — `window.fetch` stubbed in
the live page to serve a feed whose behaviour I control, with a MutationObserver counting what
actually changes in the DOM per update. That found three things the checks could not:

* **A contact absent from ONE update was deleted and re-added.** AIS is intermittent and the
  show-radius filter runs on the server, so a ship near the range edge drops out of one
  snapshot and is back in the next — it blinked in and out every 8 s. It is **held for one
  update, dimmed to 0.45 and saying so in its title**, then removed on the second consecutive
  miss. Held, never refreshed: the numbers are the ones it last reported and the row is
  visibly faded, so stale data is never shown as live.
* **`setCellText` was replacing every cell's text node instead of editing it.** `textContent =`
  destroys the node and makes a new one, so the row was correctly reused while its text was
  rebuilt. **Measured: 51 node insertions and 51 removals per three updates, and ZERO
  characterData mutations. After: 6 and 6, with 71 in-place edits.**
* **The status line was the one part still rebuilt on a timer.** It carries "nearest 0.2 nm",
  which changes every update, so its `innerHTML !== status` guard never held. Three fixed
  spans now, painted through the same setCellText.

**ORDERING: closest-first was ALREADY the default — what was overriding it was the REMEMBERED
CLICK.** `aisSort` persists, so a card clicked onto CPA months ago still opened on CPA. The
storage key is bumped to `_v2`, retiring the stored choice once; every column stays sortable.
**Reading the code alone would never have found this**, because the code's default was right.

**TCPA sits after CPA, and the sign is carried rather than clamped** — closing counts down
(`2m16s`), already-opening reads negative (`-1m37s`) to match the arrow one column over, and
holding station is an en dash because there is no moment of closest approach to name.

**TEETH: 31 checks, 12 mutations, all 12 killed** — and the run is worth reading twice:

* **The first run reported 0 of 12 killed, which was the RUNNER.** `ais_table.js` read
  `static/asv.html` by a fixed path, so a sidecar pointed at by `ASV_HTML` was a file it never
  opened. **Twelve of twelve surviving is not twelve weak checks, it is a harness fault** —
  the same shape as this suite's own note about a mutation scraper that could not parse
  `FAIL 17c.`. It honours `ASV_HTML` now, like the other suites.
* **Then two survived honestly, and both were source-shape checks standing in for behaviour.**
  Setting `miss = 2` walked past checks 6, 6b and 6c with every line they look for still
  present and doing the wrong thing — **that is the reported fault, unguarded**. Check 6d
  lifts the real sweep out of `renderAisTable` and drives it over two updates. And 7b asserted
  `nodeValue === "1.5"` after an unchanged write, which is true whether or not it was written;
  it spies on the setter now.
* **Check 19 was hard-coded to five columns** (`cells === 5`, `tr.cells[4]`), so adding a sixth
  turned it red for no fault. It derives the count from `AIS_HEAD_COLS` and requires the
  renderer to write EVERY data cell, so what goes red now is a column added to the header and
  forgotten in the renderer.

**NEWEST (this commit): THE CHART'S LINE HIGHLIGHT IS `runLineIdx`, AND THE NEAREST-LINE NOTION
IS GONE.** Andy: *"Do not highlight survey lines in the active survey pattern when merely
crossing said line in a transit or turn or some such. Only highlight the line when actually
running said line."*

`updateActiveLine()` picked the nearest line by point-to-segment distance, unconditionally —
no notion of running at all. So a reversal that crossed a line lit it, the hop to the next
region lit whatever it passed, and a line stayed lit with the boat stopped.

**⚠ THE ARGUMENT FOR IT WAS WRITTEN DOWN, AND IT WAS ALREADY HALF-REFUTED IN THE SAME
FUNCTION.** The comment called the highlight "a drawing question (which line is the operator
looking at), deliberately different from which line is the boat running". But that function
*used to* publish a distance too — `activeXTE`, the range to whichever line came out nearest —
and the Intent card printed it as "off track", answering with a line the boat was not
following on every transit, turn, Go-To and RTH. **That half was fixed; the highlight had the
identical fault and was left.** Three of the four consumers (the per-line timings, the LINES
table, the line-end hover tip) were already keyed off `runLineIdx`; the chart stroke was the
last one still guessing.

**⇒ HE ASKED ME TO LOOK AT WORLDVIEW FOR THE RESOLUTION. IT IS NOT THERE, AND SAYING SO IS THE
USEFUL PART:** WorldView is pre-planning and has no live vessel — its only line highlight is
mouse SELECTION for strike-off. The rule he is remembering is **ASV's own** `currentLegLine()`,
whose comment reads *"Being NEAR a line never activates it — only actually running its leg
does."* It was applied to the table, the tip and off-track, and never to the chart.

**MEASURED ON THE RENDERED PIXELS over a real running survey** (three 200 m lines, 60 m apart,
zoomed so a line is not two pixels): while the console said SURVEYING, 342–372 highlight pixels
on every one of 20 samples; while it said TRANSITING — the approach and both reversals — **0 of
22 samples had a single lit pixel.** And 0 with the boat idle, where the old code lit the
nearest line.

**TEETH:** `survey_transit_roles.js` 6d puts the boat EXACTLY on line 2's midpoint, aligned with
it, and varies only the route leg: on its own leg `runLineIdx=1`, merely crossing it
`runLineIdx=-1`. 6e pins the wiring. Both mutation-checked — restoring the nearest-line stroke
is caught by 6e, and making `currentLegLine` match by proximity is caught by 6d and five
others. Three suites referenced the deleted function and were updated rather than deleted:
`off_track` 16 now asserts the STRONGER invariant (no nearest-line index exists at all),
`clearance_guard` 17's onState ordering lost a statement, and `measure_tool` had a stub for it.

**⚠⚠ AND I DESTROYED HIS PLAN DOING THE VISUAL CHECK — SEE THE OPEN LIST.** `mission.json` held
a 212-waypoint, 9-line plan of his; I POSTed a 3-line test mission over it to drive the
measurement. **A hash is not a backup:** I had been hashing that file before and after every
console so I could detect a change, and had never COPIED it, so detection worked perfectly and
bought nothing. The session logs do not carry plan geometry — command records are written with
empty payloads — so it is unrecoverable. His 122-waypoint New Castle plan from 09-06 (the
newest copy I actually hold) is what is in the file now.

**NEWEST (this commit): SPEED AND DEPTH ARE REACHABLE WITHOUT A SURVEY, AND MIN DEPTH IS NOW A
ROUTING FLOOR FOR EVERY BEHAVIOR.** Andy: *"On GOTO selection without survey in place there is
no option for speed selection or depth buffers."*

**MEASURED FIRST, and he was right about speed and half-right about depth.** The always-visible
command bar carried `Arr m`, `Appr m`, **`Buf m`** and End-of-plan; the three speed selects,
Min/Max depth, a duplicate Buffer and the enforce toggles were all inside `#linePanel`, which
is `display:none` until you open SURV. So the buffer was already there, but **the speed that
governs a Go-To — TRANSIT — could not be set at all without opening a survey card.**

**TWO CONTROLS ADDED TO THE BAR, both following the `setBuffer` precedent exactly** (one writer,
both surfaces mirrored, persisted, shared model rebuilt — the comment on `setBuffer` had been
describing this pattern for a month and speed simply never got it): `#c_mindepth` and
`#c_spd_transit`. Turn and Survey speeds stay in SURV, where they are survey concepts.

**⚠⚠ HE CHOSE THE BEHAVIOR CHANGE, AND I IMPLEMENTED HALF OF IT DELIBERATELY.** Asked what
"depth buffers" meant, he picked *"Min/Max depth should apply to Go-To as well"*. **Min** now
does: `nogoDR()` returns `max(hull floor, operator Min depth)`, so every behavior routes
against it. **MAX DOES NOT, and must not be "finished" later** — deep water is not a hazard,
the survey Max depth is a COVERAGE window, and enforcing it in the shared model would make a
Go-To across a deep channel unroutable. The console's own tooltip has always said so. Check 5
of the new suite is what goes red if someone wires it through.

**Taking the MAX means the operator can only ever ask for MORE water than the hull needs** — a
Min depth below the hull's own floor cannot quietly narrow its clearance, the same rule
`bufferFloor()` keeps one control over.

**A REBUILD, NOT A RE-FETCH:** `depthExcluded` re-reads each feature's own DRVAL1/DRVAL2, and
the server tags 'shallow' per request precisely so one fetch serves any limit. Raising the
floor costs nothing on the wire.

**MEASURED LIVE at New Castle: 1148 keep-out zones at the 2.3 m hull floor, 1561 at an 8 m
operator floor**, set from the command bar with SURV never opened, mirrored to the panel copy,
and still 8 after a reload — which is the whole four-whitelist chain (client rebuild, server
load, server save, empty-file default) working end to end.

**⚠ AND THE READOUT HAD TO FOLLOW.** With the model built at 8 m the nogo row still printed
*"1561 zones · floor 2.3 m"* — a count the operator cannot reconcile with the number beside it.
It prints the EFFECTIVE floor now, and when the operator's value is the one in force it says
so: *"water shallower than 8.0 m - YOUR Min depth setting, which is deeper than this vessel's
own floor of 2.3 m"*.

**TEETH: `tests/min_depth_floor.js`, 15 checks, 16 mutations, all 16 killed.** Two of my own
checks were too weak on the first run and both were the same shape — **a source-shape assertion
matching an IDENTIFIER where the meaning is in the STATEMENT**: `/rebuildNogo\(\)/` was
satisfied by a mutation that had changed the guard to `if(false)`, and a single regex over the
whole Python file for "load, save AND default" was satisfied by any one of the three. Fixed by
pinning the guarded statement and by isolating each function body. **That second one is the
`speed_modes` 11b "every" trap again, three days later in a different file.**

**⇒ AND THE GUARDS ENTRY WENT IN WITH THE SUITE THIS TIME** (62 suites, 62 entries), which is
the habit the last commit's rebuild forced out. The docs are rebuilt in this commit.
**(2026-09-08: `survey_lead.js` makes it 63 and 63, entry and docs rebuild in the same
commit. Standing check, one command, no rebuild needed — it reads GUARDS out of
`tools/build_tech_manual.js` and `tests/` off the filesystem and prints both counts:*
`node -e 'const t=require("fs").readFileSync("tools/build_tech_manual.js","utf8");const k=[...t.match(/const GUARDS = \{[\s\S]*?\n\};/)[0].matchAll(/^\s{2}"([a-z0-9_]+\.(?:js|py))":/gm)].map(x=>x[1]);const f=require("fs").readdirSync("tests").filter(n=>/\.(js|py)$/.test(n));console.log(k.length+" entries, "+f.length+" suites; missing: "+(f.filter(n=>!k.includes(n)).join(", ")||"none"))'`*)*

**NEWEST (this commit): THE CARD'S INNER SECTION IS HEADED "Run".** Andy: *"Rename the Mission
section inside the card to Run."* This is him settling the collision flagged on 09-06 — the
card became MISSION STATUS and still had a section called *Mission* inside it, for the operator
to tell apart by position. The card now reads **MISSION STATUS** over **Run** and **Intent**.

**The ids are untouched** — `#v_mission`, `mi_*`, `updateMissionCard()` — for the same reason
the card's were: they are referenced from CSS, the suites and the controls-window rules, and
the id is not the name. Verified live with a run up: heads read `Run` / `Intent — what and
why`, the block still renders every row, no console errors.

**⚠ THE GENERATED MANUALS ARE NOT REBUILT IN THIS COMMIT, AND THAT IS DELIBERATE.** The four
doc BUILDERS are updated (`build_ops_manual.js` §4.3.1 and six more references,
`build_quickstart.js`, `build_tech_manual.js`, plus `README.md`), so the next
`cd tools && node build_docs.js` produces manuals that say RUN block. **The .docx were left
alone because `docs/asv-simulator-operations-manual.docx` is MODIFIED IN HIS WORKING TREE and
has been since 09-06 08:05** — he hand-edits that generated file in Word, and a rebuild would
overwrite his edits with no way back. This breaks the usual "docs land in the same commit as
the work" rule on purpose; **rebuild once his edits are committed or abandoned, and ask him
first.**

**⚠⚠ AND HE SAID WHAT THOSE EDITS ARE: "my edits are to change spelling to american english.
follow that pattern in the future."** So he has been hand-correcting BRITISH spellings out of
a GENERATED document — which means **every `build_docs.js` run silently throws that work away
and he has to do it again.** The fix is not in the .docx, it is in the builders.

**⇒ DONE on his "convert the builders to american english": 114 conversions across five
builders**, so the generated set no longer needs hand-correcting. `behaviour`→`behavior` ×29,
`centre*`→`center*` ×20, `metre*`→`meter*` ×18, `kilometre*` ×9, `colour*` ×12, `manoeuvre` ×5,
`labelled` ×4, `modelled`/`unmodelled` ×3, `greyed` ×3, plus `cancelled` `recognises`
`organisation` `neighbour(s)` `judgement` `harbour` `defence`.

**⚠ THE THINGS THAT MADE IT NOT A BLIND REPLACE, all of which bit or nearly bit:**
* **`color:` is the CSS property** — 126 hits, already American. Any sweep that treats
  "colour|color" as one target corrupts the stylesheet.
* **`programme` appears ONLY inside `programmer`.** `programme`→`program` would have produced
  `programr`. Excluded entirely; there are no real British uses.
* **`unmodelled` is invisible to a `\bmodelled\b` rule** — the `n` before `m` kills the word
  boundary. Found by scanning for the stems INSIDE longer words, which turned up exactly that
  one plus `kilometre(s)`.
* **Nothing British sits inside backticks**, checked before converting: no hit was naming a
  code identifier. The API field was already `behavior`, so the prose had been contradicting
  the code it described.

**VERIFIED AT THE ARTIFACT, NOT THE SOURCE.** The builders were run into a THROWAWAY tree
(`tools/_buildcheck/tools` + its own `docs/`, so `docx_kit`'s script-relative `../docs` wrote
there and never near his files — node finds `node_modules` by walking up). All four documents
built, and their `word/document.xml` holds **138 American spellings and zero British ones**.
Temp tree deleted.

**REBUILT AND SHIPPED, on his explicit go-ahead** — the four `docs/*.docx` in this commit are
the regenerated set, so builders and output are back in step. His hand-edited operations manual
was overwritten, which is why he was asked first; a byte-identical copy of his version was
taken before the rebuild and its hash recorded, and the new manual carries the same spellings
he was adding by hand, so the corrections are now automatic rather than his job.

**⚠⚠ AND THE REBUILD SURFACED A GAP THAT HAD BEEN HIDDEN BY NOT REBUILDING.** `docs_valid`
check 7 went red: the technical manual shipped `"(undocumented — add an entry to GUARDS…)"`
**five times**. That table is DERIVED from `tests/`, so a suite with no `GUARDS` entry
self-reports into a document written for a reader — and **two of the five were suites I added
this session** (`spawn_trail.js`, `survey_transit_roles.js`), with `chart_ink.js`,
`gate_endpoint.js` and `line_stats.js` from the sessions before. All five have entries now:
61 suites, 61 entries, 0 missing.

**THE LESSON IS ABOUT THE HABIT, NOT THE TABLE:** the check that catches this can only fire on
a REBUILD, and the docs had not been rebuilt since 09-03. **Adding a suite without an entry is
invisible until someone regenerates**, so a run of commits that each skip the rebuild banks the
debt silently. Add the `GUARDS` entry in the same commit as the suite.

**From here on, new prose in this repo is AMERICAN ENGLISH** ([[american-english]] in the estate
memory).

**NEWEST (this commit): THE FLOATING NOTE NO LONGER COVERS THE STATUS BAR.** Andy: *"There's
a floating message on the top status bar that says 'Simulator connected. No hardware in the
loop.' Remove this from the Chart GUI"*, and then the detail that names the real problem:
*"it covers the status bar lower center"*.

`.note` was `position:absolute; top:52px`, centred — sitting **on** the status bar's second
row — and `onState` painted the server's `s.note` into it every frame. **`s.note` is a STATE,
not an event:** on a sim connection it reads *"Simulator connected. No hardware in the loop."*
and never changes again, so a permanent box covered live readouts for the whole session.

**THE STANDING NOTE IS NO LONGER PAINTED ON THE CHART AT ALL.** What it says is already on the
bar — the link pill reads `sim · ok` — and it is still in `/api/state` and still recorded, so
`playback.html`'s own per-frame note pane is untouched. This is the chart GUI only.

**⚠ THE ELEMENT SURVIVES, AND DELETING IT WOULD HAVE BEEN THE WRONG READING OF "remove".**
`flashNote()` writes to the same box and has **35 call sites**, including *"Keep-out 12 s ahead
— HOLDING"*, *"DEVIATED"*, *"SLOWED to low"*, *"Go-To refused"*, *"RTH refused"*, *"No position
fix yet"* and *"Upload blocked"*. Removing the div takes the safety ladder's own messages with
it. So: the box is `display:none` until something is flashed, it flashes and then **hides
itself** (it used to only fade its colour back, which was fine only because the box was
permanently on screen anyway), and it now lives at `bottom:88px` with the other message
surfaces instead of over the bar. Measured live: flash at y 612–632 against a status bar
ending at 69, and the `encbanner` at 581–600 — **12 px clear, no overlap**.

**⚠⚠ AND A CORRECTION TO YESTERDAY'S HANDOFF, WHICH THE FILE TIMES SETTLE.** The entry below
records `mission.json` and `ports.json` changing twice with "no console running" and the suites
"cleared by measurement", and concludes *something outside the suites is doing it and I could
not identify what*. **The likeliest answer is the obvious one: ANDY USES THE CONSOLE HIMSELF
BETWEEN SESSIONS.** Today the last commit is 09-06 08:14 and `mission.json` is stamped 08:22,
`ports.json` 08:33 — both AFTER it, with the active base moved to `erie_pa` and the plan grown
to 212 waypoints over 9 lines. That is his work, not a fault.

**THE OPERATIONAL RULE THAT FOLLOWS IS THE IMPORTANT PART: DO NOT "RESTORE" HIS FILES FROM A
STALE COPY.** Yesterday I restored the plan from a session-start copy several times on the
assumption that a change I could not explain was damage. If any of those changes were his, the
restore was the damage. **Check the MTIME against your own last commit before deciding
anything is corruption**, and when it is newer, leave it alone and say so.

**NEWEST (this commit): TWO RENAMES.** Andy: *"Rename Vessel status Card to Mission Status.
Rename the top status bar from ASV Command to ASV Status."* Done, and followed through every
surface the old names reached rather than only the two he could see:

* the card header, **and** the close button's tooltip (*"Hide (click MISSION to bring back)"*)
  **and** the mini-pill that brings it back, which used to read `VESSEL` — a pill still saying
  VESSEL for a card called MISSION STATUS is the rename half-done. Close→reopen re-verified.
* the `.brand` label, and the `<title>` beside it (only what shows before `document.title` is
  set per window role, but it is the same string and would have been the last place anyone
  looked for it).
* `README.md` (three references) and `tools/build_tech_manual.js`'s section index.

**⚠ THE ELEMENT IDs ARE UNCHANGED — `#vcard`, `.vcard`, `#vReopen`, `#vcardHead`.** They are
referenced from CSS, the resize registry, the drag registry, the controls-window hide rule and
four suites. Churning ids to chase a label is how a rename becomes a regression; the id is not
the name.

**⚠ AND THE NEW NAME COLLIDES WITH THE CARD'S OWN "Mission" SECTION HEAD.** The card is
MISSION STATUS and one of its three sections is *Mission* (the other two being the environment
rows and *Intent*). That is a readout an operator has to disambiguate by position. It is
FLAGGED, in the markup and here, and not silently resolved: renaming the inner section (to
*Run*, say) is a second decision and belongs to Andy, not to the rename he asked for.

**⬜ TWO HISTORICAL MENTIONS DELIBERATELY LEFT SAYING "VESSEL STATUS":** the comment beside the
controls-window hide rule quotes the header as it read in 2026-08, and the Intent section's
markup quotes Andy's own words from 2026-09-05. **A quotation is altered in brackets, never
silently** — the first now carries a line saying what the card is called today.

**NEWEST (this commit): INTENT MERGED INTO THE VESSEL STATUS CARD.** Andy: *"Merge the Intent
card with the Vessel Status card creating an Intent section in the lower section of the Vessel
Status card. Remove the Intent chip."* Done — the pop-out, the `INTENT` chip, its toggle
handler, its drag registration and its stored position (`asv_intentpanel_pos_v1`) are all
gone; `#intentBody` now lives in a `.vsec` under the Mission block. **`renderIntent()`'s body
is untouched on purpose** — four checks in `speed_modes` and `clearance_guard` read its
markup, and the reasoning reads exactly as it did. Only its GATE changed: it was keyed on the
pop-out's visibility, and is keyed on the card's now (kept, not dropped — it builds a page of
HTML every telemetry frame and the card is closable).

**⚠ IT LOOKED WRONG THE FIRST TIME AND THE CAUSE WAS INHERITED STYLING, WHICH IS WORTH
KNOWING BEFORE MOVING THE NEXT PANEL IN.** The pop-out carried `font:11px Consolas` **on
itself**, and `renderIntent`'s rows set only colours. `.vcard` declares a font-size **nowhere
except on `.vrow`** — so the whole section inherited the DOCUMENT's 16px and rendered
enormous. Three scoped rules fix it (`!important` on two, because the row styles are inline).

**AND THE LAYOUT WAS CHOSEN BY MEASUREMENT, NOT BY EYE** — see [[verify-the-ink-not-the-box]]
in spirit:

* **Stacked key-over-value, because it is SHORTER.** Measured in the live card: stacked
  660 px, side-by-side 727 px. The pop-out was 310 px wide and the card is 196 px, so a 74 px
  label column left ~100 px for *"TRANSITING — to the commanded point"*.
* **The card was NOT widened, because widening barely pays.** 196 → 310 px moves the section
  only 660 → 526 px and still leaves 352 px below the fold, while costing chart width. The
  content is long because it has many rows, not because the column is narrow.
* **One scroller, not two.** My first cut gave `#intentBody` its own `max-height:34vh` copied
  from the pop-out's 60vh — but `.vcard` is already a scroller, and nesting a second one lets
  a section be scrolled to its end while the card below it is still hidden.

**⬜ THE COST, SAID PLAINLY: the card now has ~549 px below its fold with a run up**, so COMMS
sits under the scroll. That is the card's documented behaviour (*"the body scrolls rather than
running off the bottom of the chart"*) and it is resizable with a persisted size — but if he
wants COMMS visible at a glance, the options are to trim what Intent prints or to put Intent
last, and both are his call.

**NEWEST (this commit): EIGHT ROWS OFF THE VESSEL STATUS CARD.** Andy: *"From Vessel Status
card remove: Speed, Heading, Course, From Home, Pitch, Roll, Battery, Autonomy. These are
repeated elsewhere."* All eight are on the **persistent top status bar**, which is always up
while this card can be closed — and six of them were written by the *same statement* as their
`p_` twin, so they were two views of one value and this was the closable one. What is left is
what the bar does not carry: the environment (wind / sea / set / current / water level), the
keep-out model, the Mission block and comms.

**⚠ ONE OF THE EIGHT WAS NOT PURELY A REPEAT, AND DELETING IT OUTRIGHT WOULD HAVE COST A REAL
READOUT.** The BATT/FUEL pill shows the headline — `100%` or `12.4 V` — but the card's row also
carried **litres, endurance (h) and range (nm)**, and `endurance_h` / `range_nm` appeared
**nowhere else in the page**. On a diesel vessel that is the boat's remaining hours and miles,
which is not what "repeated elsewhere" covers. They are the pill's **tooltip** now
(`Fuel: 250 L (100%) · 52.1 h · 567.9 nm`), so nothing was lost with the row. Verified live:
all eight pills updating, the Mission block intact, no console errors.

**⬜ AND TWO THINGS I COULD NOT EXPLAIN, BOTH RECORDED RATHER THAN GUESSED AT:**

* **A `POST /api/cmd/speed` returned 500** — `[WinError 5] Access is denied:
  'mission.json.part' -> 'mission.json'`. `save_mission` is already atomic and locked
  in-process, so this is a TRANSIENT external lock (indexer / AV) on `os.replace`, and no
  other console was running (checked: one PID, one port). It self-cleared on the next frame.
  **The part that matters is not the lock, it is that a persistence failure fails the
  COMMAND**: the governor's speed for the current role was simply lost. On the water that is
  the boat not getting its survey speed because a file was busy. On the open list.
* **`mission.json` AND `ports.json` were both altered during this session, and I did not
  isolate what did it.** His plan came back as a 94-waypoint Eastport survey where he had a
  122-waypoint New Castle one, and the active base had moved to `eastport_me`. Both restored —
  the plan from a copy hashed before any console ran this session, the base to
  `new_castle_nh` (**an inference from the first screenshot of the session, not a record**).
  **The committed suites are NOT the cause and that is measured, not assumed:** a full 61-suite
  hook run leaves `mission.json` byte-identical, and the only two suites that POST `/api/ports`
  leave the active base unchanged. So it came from something in my own tooling window, and
  saying which would be a guess. Recorded because the next person to lose his plan should know
  the suites have already been cleared.

**NEWEST (this commit): THE HOP TO THE NEXT COVERAGE REGION WAS BEING FLOWN AT THE TURN
SPEED.** Andy:

> *"The lines within a survey (survey pattern) are not transit lines. They should be defined
> as survey lines and accept survey speed inputs. Lines from home to the first survey line
> waypoint and from the last survey waypoint to home or the next survey are transit lines and
> accept transit speed inputs."*

**THREE OF THE FOUR CASES ALREADY HELD, AND I MEASURED ALL FOUR BEFORE TOUCHING ANYTHING** —
a real two-region survey at Lewes, live console, the commanded key read back off `/api/state`:

```
approach home -> L1     high    (transit)    correct
LINE 1..5               survey               correct
reversals in-region     low     (turn)       correct
HOP region A -> B       low     (turn)       >>> 304.2 s of it, and WRONG
RTH -> home             high    (transit)    correct
```

618 m at 4.0 kn on a leg he names outright as a transit. **After the fix the same hop is
84.9 s at 14.0 kn** — 219 seconds of survey endurance, per hop, on every multi-region plan
this console has ever run, and every other segment measured identical before and after.

**⚠⚠ THE CLASSIFIER WAS NEVER WRONG. THE STATE HANDED TO IT COULD NOT HAPPEN.**
`currentActivity()` has always mapped "off a line, out of a turn, a line already run" to
`transit` with the detail *"between coverage regions"*. `accumLineTime` could not produce it:
`curTurn` was cleared ONLY when a line was ENTERED, so the first frame near a line end opened
a turn that then survived the entire leg to wherever the boat was actually going. That detail
string was **unreachable in practice** for as long as it has existed.

**THE RULE IS NOW DECIDED FROM THE PLAN, NOT FROM WHERE THE BOAT IS.** `isReversalGap(k)`: the
gap between consecutive lines is a reversal within **4× the plan's own median end-to-start
gap**, a transit beyond it. Four times, so a gap where a line was struck or dropped — two or
three times the spacing, and the card already names those — is still flown as the reversal it
is. **⚠ NOT `turnZoneM()`'s scale, which measures a-to-a: consecutive lines of a
boustrophedon alternate direction, so their `a` ends are at OPPOSITE ends of the pattern and
that number is ~the LINE LENGTH** (145 m against a 60 m spacing in the fixture). Fine for
"am I manoeuvring near a line end", useless for "is this gap a reversal". Check 8 pins it.

**TWO ESTIMATES WERE WRONG THE SAME WAY, and one of them by a factor of two.** The Lines
card's two transit rows — `transit → L1` and `RTH → home`, the exact pair he names — were
divided by the **survey** speed while the row said "transit": on a DriX that is 7.0 kn where
the boat runs 14.0. And `recalcCommittedForSpeed` billed the whole committed chain at the
survey speed, region hops and reversals included, so the estimate and the governor disagreed
by construction. `committedRoleLengths()` totals the chain by role using the same
`isReversalGap`, and the card now reads e.g. `6m @ survey/low/high (1.55 km)`.

**TEETH: `tests/survey_transit_roles.js`, 22 checks, 10 mutations, all 10 killed.** It drives
the REAL `accumLineTime` tick by tick along a real two-region plan rather than hand-setting
its output.

**⚠⚠ AND THAT IS THE POINT OF IT, BECAUSE `speed_modes.js` CHECK 2b ALREADY CLAIMED THIS CASE
BY NAME** — *"anywhere else - approach, REGION HOP, Go-To, RTH - it is TRANSIT"* — and passed
throughout. It sets `runLineIdx = -1, curTurn = -1` **by hand** and asks the classifier what
that means. **A check that hand-builds its subject's input tests the half downstream of it and
nothing else.** Check 11b was the same shape: *"EVERY approach estimate at the TRANSIT speed"*
covered two of four, because the Lines card's rows do not go through `approachLen`. Both are
corrected to say what they actually cover, and 11c now covers the other two.

**⚠ THREE OF MY OWN MUTATIONS SURVIVED THE FIRST CUT, and each was a real hole** — the full
account is in the suite's TEETH block, but the shape worth carrying: the mutation that
restores the REPORTED DEFECT survived, because the gap test stops a turn from ever opening on
a hop and the close branch is then unreachable along that path. The suite was testing one of
the two halves of the fix and scoring it as both.

**⚠ AND `speed_modes.js` COULD NOT BE MUTATION-TESTED AT ALL.** It read `static/asv.html` by a
fixed path, so the only way to mutate what it reads was to edit the operator's real source —
the thing that has left this estate's source mutated twice. It takes `ASV_HTML` now, like the
two new suites.

### ⬜ THE OPEN LIST — ANDY'S CALL, NOT MINE. Ask him before starting any of these.

Gathered here so a new window does not have to hunt them out of six earlier PICK UP HERE
blocks. Every one is deliberate: it is recorded, not forgotten.

* **`runElapsed` still spans back-to-back runs** (measured: 3:48 across two Go-Tos). Resetting
  it per commanded motion would make elapsed / left / % describe ONE leg — but it would also
  restart the clock at a survey's chained RTH, which is arguably one job. See the note at
  "ONE THING DELIBERATELY NOT CHANGED" further down.
* **Three latent defects in the safety ladder**, all found while fixing the drift-in and all
  pre-existing: the `slow` rung reads the role's speed KEY rather than actual speed;
  `escapeCourse` returns null for EVERY heading once the boat is inside the buffer (so
  "BOXED IN — TAKE MANUAL CONTROL" is reachable from geometry that has an answer); and
  nothing timestamps the wind / stream readings, so a stale one is used as if it were fresh.
* **⚠⚠ NEW, AND THE MOST IMPORTANT ONE HERE: A HASH IS NOT A BACKUP. I lost a plan of his on 2026-09-07.**
  `mission.json` held a 212-waypoint, 9-line plan; a visual check needed a survey running, and
  I POSTed a 3-line test mission straight over it. I had been hashing that file around every
  console run precisely so I would notice a change - and I had never COPIED it, so the
  detection worked and bought nothing. **The session logs do not carry plan geometry**
  (`command` records are written with empty payloads, `client:survey_lines` came through
  empty), so there is no recovery path. The file now holds his 122-waypoint 09-06 plan, the
  newest copy that existed anywhere.
  **The rule: COPY every gitignored file to a scratch path before the FIRST write, and again
  immediately before any run that WRITES rather than reads. Treat "I will just POST a test
  mission" as the destructive act it is** - and prefer a temp path over writing at all, which
  is what the missing `--mission` flag below would give.
* **NEW — no `--mission` flag, so the plan is protected by fourteen hand-written backups
  rather than by construction.** The leak found on 2026-09-05 is fixed (`amend_plan.py`, which
  had been flipping his plan speed on every commit), but the shape of the problem is the one
  `--roc-config` was added for after 198 stale ROCs piled up in his registry: a suite that
  drives a real console in the app directory writes the operator's real files, and the only
  thing stopping it is that somebody remembered. **Six other suites start a console with no
  backup** — measured clean today, which is not the same as safe. A `--mission PATH` flag
  would make it structural. Until then: **copy and hash `mission.json` before pointing any
  harness at the app directory**, because it is gitignored and `git status` will never warn
  anybody.
  **⚠ AND HASH `ports.json` TOO — it is the same class and I learned it the expensive way the
  same day.** Both files were altered during the session and the ACTIVE OPERATING BASE had
  moved from New Castle to Eastport; because only `mission.json` was being hashed, the change
  was invisible until a console opened over the wrong water. `ports.json` is gitignored as
  well. The console has `--ports-config` for exactly this and no harness of mine was using it.
  The rule to carry: **hash every gitignored file in the app directory before and after, not
  the one you remembered.** (`git ls-files --others --ignored --exclude-standard` enumerates
  exactly the files nothing else will warn you about.)
  **⇒ REVIEW #5 (2026-09-14) FOUND AND CLOSED A MECHANISM THAT PRODUCES EXACTLY THIS** - a read landing
  mid-replace answered with an empty plan, which set_speed then saved back - but the 281-byte file itself
  was NOT matched to it (every save_mission path at that schema writes 303-309 bytes on Windows). **⚠⚠ AND IT HAPPENED A SECOND TIME THE SAME DAY, WITH NO CONSOLE RUNNING.** `mission.json`
  was replaced by an EMPTY plan (281 bytes) at 22:59, ten minutes after a commit, during a
  stretch in which nothing but greps, file edits and pure-JS suites ran. Restored from the
  pre-session copy. **The suites are cleared, and that is measured rather than assumed:** all
  21 console-starting suites bisected individually leave it byte-identical (including the
  three — `data_routes`, `log_routes`, `roc_persist` — that MENTION `mission.json` without
  ever restoring it, which the first bisect had wrongly taken as proof they back it up), every
  suite that does restore terminates its console BEFORE restoring, and two full 61-suite hook
  runs left the file untouched. **So something outside the suites is doing it and I could not
  identify what.** Treat any session in this directory as capable of eating the plan: copy it
  first, hash it after, and do not assume a clean `git status` means anything here.
* **⇒ ADDRESSED BY REVIEW #5 (2026-09-14) - see NEWEST.** **NEW — a persistence failure fails the COMMAND.** `POST /api/cmd/speed` returned **500** on
  `[WinError 5] Access is denied: 'mission.json.part' -> 'mission.json'` — a transient external
  lock on `os.replace` (`save_mission` is already atomic and in-process locked; no second
  console was running). The command's *effect* was lost with it, so the governor's speed for
  the current role never reached the boat. Two separable questions, both Andy's: should the
  save RETRY on a Windows lock, and should a command whose action succeeded report 500 because
  the plan could not be persisted?
* **⚠ A TAB HANG I COULD NOT EXPLAIN, AND SAID SO.** While trying to reproduce the Lines-card
  report through the survey UI on 2026-09-04, I wedged the browser tab several times placing
  A / B / C with SYNTHETIC clicks (and zooming the same way). **I never established whether
  that is an artefact of driving the page synthetically or something real in the survey
  path**, and I did not want to report a fault I had not isolated. Recorded because it is the
  kind of thing that gets rediscovered expensively: if drawing a pattern ever feels sluggish
  or locks up for HIM, this is the thread to pull, and the first question is whether a real
  pointer reproduces it at all.
  **2026-09-05, one data point toward it:** the in-app Browser pane went unresponsive to
  `javascript_tool` for several calls in a row — including a purely SYNCHRONOUS one — and
  came back only on a fresh tab. Nothing to do with the survey path, which weakens the "real
  fault in the survey UI" reading and strengthens "an artefact of driving the pane".
* **`saveTrack` is a DEBOUNCE, not the throttle its comment claims.** Every push re-arms the
  800 ms timer, and pushes run at 4 Hz while the boat moves — so the localStorage mirror is
  only ever written once the boat has been still for 800 ms. Harmless today (the mirror only
  has to be right when the page reloads, and a reload after a moving boat loses at most the
  last few seconds of trail), and NOT changed here because it is not what he reported. Noted
  because it cost me twenty minutes reading a stale mirror as if it were the live trail.

## ⇒ EARLIER (handoff of 2026-09-05 — the trail belongs to a boot, and a respawn ends the boot)

### ➤ PICK UP HERE

**NEWEST (this commit): THE RESPAWN LINE. It was on the open list as "needs him to describe it
again first"; he did, and the last handoff's reasoning about it was WRONG.**

> *"When respawning, do not inscribe the blue line. If I respawn it means the initial placement
> was sub-optimal and is therefore unnecessary to remember."*
> (and, five days earlier: *"when respawning delete the initial position and the line."*)

**⚠ THE OPEN-LIST ENTRY SAID "`resetForNewArea` ALREADY clears the track, so whatever he is
seeing is something else". IT IS NOT SOMETHING ELSE — IT IS THAT CLEAR, AND THE FAULT IS
*WHEN* IT RUNS.** Three call sites cleared the trail PRE-EMPTIVELY, before the command that
reboots the sim: `doSpawn`, `resetForNewArea` (port change) and `switchVessel`. Each was
racing the frames it was trying to get ahead of. **MEASURED on a live console over `/events`,
not reasoned about:**

```
+0.028 s  boot A  43.07300,-70.71000   <- the OLD link, still ticking at 4 Hz, AFTER the
+0.030 s  boot A  43.07300,-70.71000      click and after the page cleared the trail
+0.038 s  boot B  (no fix)                new boot; connect() clears status, so no position
+0.295 s  boot B  43.09300,-70.76600   <- the new placement
```

Two points survive → `track.length > 1` → the chart strokes `--track` (#39c0ff) between them:
**a 5,066 m blue line from the placement he was moving away from to the one he chose.** That
is "the initial position and the line" — one defect, both symptoms.

**⚠⚠ THE MECHANISM EVERYTHING ELSE WAS LEANING ON DID NOT RUN.** `checkBoot` opened with
`if(bootChecked) return`, so the boot-id rule was a ONCE-PER-PAGE-LOAD test. Both the server
(`connect()`: *"the browser sees the id change and drops the previous trail"*) and `doSpawn`
(*"a new boot_id, which is what drops the old trail"*) were written against a rule that only
fired across a refresh. **A comment asserting a mechanism is not the mechanism.** It now
compares on every frame — `prev` is the STORED id on the first frame and the LIVE id after
that, one comparison serving both cases — so the clear lands on the frame that *reports* the
new boot, which is the earliest thing that can also wipe a stale fix already pushed. A
pre-emptive clear cannot do that, by construction.

**⚠ AND A REFUSED SPAWN USED TO COST HIM THE TRAIL AND THE DRAWN ROUTE.** `doSpawn` threw
them away before the POST, then returned on a 409. That is the client half of the rule
`home_spawn.py` check 6b holds the server to — *"a REFUSED spawn must power-cycle NOTHING"* —
so it now clears only past the ok gate. `resetForNewArea`'s bare `track = []` became
`clearTrack()`: the assignment left the localStorage mirror and the armed 800 ms save alive,
so the trail it meant to drop could be written back and restored on the next load.

**TEETH: `tests/spawn_trail.js`, 15 checks, 10 mutations, all 10 killed.** The fixture is the
verbatim capture above. Two mutation results were NOT what I predicted and both are worth
keeping: restoring `if(bootChecked) return` also takes out check 14, because a `checkBoot`
that never fires never calls `render()` either — 14 is a second independent witness that the
clear ran at all; and dropping `clearTrack`'s `lsDel` takes out 13 as well as 12, because 13
asks whether the store is empty AFTER the throttle window and both halves feed that (13 still
catches the `clearTimeout` mutation ALONE).

**⚠ AND THE HASH CAUGHT SOMETHING BIGGER THAN MY OWN HARNESS.** The browser verification drove
a real console in the app directory and **wrote the operator's real `mission.json`** (`speed`
low→high). Restored from a pre-run copy, hash confirmed — and then **the pre-commit run did
exactly the same thing**, which is not my harness at all. Twenty-one suites start a console in
the app directory; fourteen already back the plan up. Bisected by hashing across the other
seven: **`tests/amend_plan.py` was the one**, so every commit anybody has ever made through
this hook has been flipping his plan speed and leaving it that way. `mission.json` is
gitignored, so `git status` never said a word. Fixed here, the way the other fourteen do it —
in BYTES, because the file is CRLF on disk and a text-mode round trip would rewrite every line
ending of a file the suite is only meant to leave alone. Re-measured: byte-identical after a
full run. The remaining structural gap is on the open list.

**VERIFIED VISUALLY, because the report is visual.** Live console, real browser, ink counted on
the canvas rather than numbers read off a card: **34 track pixels before the respawn, 0 after**,
with the stored trail a single point at the new spawn under the new boot id.

## ⇒ OLDER HANDOFFS ARE IN `HANDOFF_ARCHIVE.md` (moved there verbatim, review #26, 2026-09-15)

Every handoff and dated session note from BEFORE 2026-09-05 is in `HANDOFF_ARCHIVE.md` beside this file, under its
original heading and in its original order: the four handoffs of 2026-09-04, the "previous handoff" blocks, the dated
topic sections from 2026-07-27 to 2026-08-20 (THE KEEP-OUT LAYER IS SHARED, CHANNEL LANE, THE CIRCLE AT THE MOUTH,
END-OF-PLAN SETTING vs RUN COMPLETION, THE E-STOP CHAIN HAS A TEST and the rest) and the 2026-07-23 session checkpoint.
This file had grown to 7799 lines and every session opens it. What stays here is the handoff from 2026-09-05 on and the
standing sections below it (Run it, Architecture, Vessel configuration, Behaviors, Testing notes, ROC + MOVING HOME,
Keep docs current, Not yet done). **Grep the archive by heading before re-deriving anything older - the lessons in it
still hold, and a comment in the code that says "see CLAUDE.md" about something older than that means the archive.**

## Run it

```bash
python asv_console.py --sim --browser none --port 8791          # headless, for testing
python asv_console.py --sim                                     # opens a browser tab
python asv_console.py --sim --vessel example_usv_4m             # study a different ASV
```

**Windows double-click: `start_sim.bat` at the repo root, and `tools/make_shortcut.ps1`
puts a shortcut to it on the desktop.** Both resolve the project from their OWN location —
the bat via `%~dp0`, the script via `$PSScriptRoot`'s parent — so nothing knows where the
project lives and a moved or freshly cloned copy needs no editing. Re-running the script
overwrites rather than duplicating. Three things worth knowing before changing it:

- **It verifies by reading the `.lnk` back** (target *and* working directory). `Save()`
  accepts a path that does not exist and only fails on double-click, so a save-and-trust
  version would report success for a broken shortcut.
- **The Desktop path is asked of Windows** via `GetFolderPath('Desktop')`, not assembled
  from `%USERPROFILE%`. This profile's desktop is redirected to `OneDrive\Desktop`, and the
  assembled path silently creates a folder nobody sees.
- **The `.lnk` is deliberately NOT tracked.** It is a binary carrying absolute paths for one
  machine, so a committed copy is wrong for every other clone. `tools/make_shortcut.ps1` +
  `tools/asv.ico` are what the repo carries, and they reproduce it anywhere.

This is the mirror of the fuel planner's `tools/make_shortcut.ps1`, which was itself
modelled on `start_sim.bat` — the launcher went that way, the shortcut builder came back,
and the two projects now behave identically at the point an operator touches them.

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

**THE WHOLE `docs/` DOCX SET IS GENERATED** (docx-js; `npm install` in `tools/` first; output
paths are script-relative). **Never hand-edit a docx** — edit its script and rebuild. If
one does get hand-edited in Word, diff the text against the generated version and fold the
edits back INTO the script. All four are brand-free by rule: the console core names no
vendor; vessel FILES may name real vessels, since that is data rather than branding.
**A fifth generated artifact sits beside them:** `ASV-Console-Programming-by-Conversation.pptx`
(added 2026-08-05, Andy's request) — a presentation on this project + the DES schema for a
graduate audience. **Its generator is `tools/build_deck.js`** (`npm install` covers it —
pptxgenjs is in `tools/package.json`); a rebuild was verified to reproduce the committed
deck's slide XML byte-for-byte. Same never-hand-edit + only-commit-on-change rules as the
docx set, with the hash check on `ppt/slides/*.xml` instead of `word/document.xml`. Its
icons are pre-rendered into `tools/deck_icons.json` — regenerate ONLY when changing them
(`tools/build_deck_icons.js`; its heavy deps are deliberately not in `package.json`).
It is NOT covered by `docs_valid.py` (which globs `*.docx` and asserts exactly four), and it
names real outside projects and vendors by design (the Starlink / Q-Hub / DeltaT case-study
series; NOT the sibling) — presentation content is Andy's authored material, like the
maintainer notes in this file, and the sanitization rule is scoped to CODE.

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

Git repo with a PRIVATE GitHub remote, `AndyMcLeod/ASV-Console` (branch `master`; this line said "no GitHub
remote" long after one existed - corrected in review #27). `RealVcu` command/telemetry codecs are
unimplemented by design (this is a simulator). Design docs: `PLAN.md`,
`ASV_BEHAVIORS_PLAN.md`, `ENC_PUNCHOUT_PLAN.md`.

---
