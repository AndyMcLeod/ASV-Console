// Build: ASV Simulator - Development Guide (contributors & maintainers)
//
// GENERATED - edit this script and rebuild; never hand-edit the docx.
//   cd tools && npm install && node build_dev_guide.js
// Writes ../docs/asv-simulator-development-guide.docx (path is script-relative).
//
// AUDIENCE: whoever works on this codebase next. The Technical Manual describes WHAT
// the system is; this describes HOW IT IS BUILT AND VERIFIED, and why the practices are
// the shape they are. The case studies in chapter 8 are real defects from this repo's
// history, kept because each one is a class of bug rather than an incident.
//
// BRAND-FREE BY RULE - see docx_kit.js.
const { P, H1, H2, H3, B, B2, CODE, TBL, SP, NOTE, TITLE, write } = require("./docx_kit");

const c = [];

c.push(TITLE("ASV Simulator"));
c.push(P("Development Guide — how this project is built, verified and extended", { size: 24, color: "2e5f8a" }));
c.push(P("For contributors and maintainers. Covers the constraints the codebase deliberately accepts, the development loop, the testing philosophy and its failure modes, how to verify things tests cannot reach, the recurring defect shapes worth checking for first, documentation discipline, and worked recipes for extending the system.", { italics: true }));
c.push(SP());

c.push(H1("Contents"));
[
  "1  The shape of this codebase",
  "2  Ground rules",
  "3  The development loop",
  "4  Testing — and what makes a test worth having",
  "5  Verification beyond tests",
  "6  Recurring defect shapes",
  "7  Documentation discipline",
  "8  Case studies",
  "9  Extension recipes",
  "10  House rules",
].forEach(t => c.push(B(t)));

// 1 ---------------------------------------------------------------------------
c.push(H1("1  The shape of this codebase"));
c.push(P("Three deliberate constraints shape everything, and each one buys something specific."));
c.push(TBL(["Constraint", "Buys"], [
  ["Python STANDARD LIBRARY ONLY on the server", "Runs anywhere Python does. No dependency resolution on a field laptop, no supply chain, no version drift."],
  ["NO BUILD STEP for the client", "No bundler, no transpile, no install. The page and its modules are served as written — and a harness can call the real shipping functions, not a copy of them."],
  ["Every vessel parameter in a DATA FILE", "The console studies behavior across vessel types. Adding a vessel is a data change; no code knows a hull's numbers."],
], [3000, 6360]));
c.push(P("These are not stylistic preferences. They are the reason the console can be deployed to an operating area by copying a directory, and the reason a regression harness can exercise browser code in plain Node with no toolchain."));
c.push(NOTE("THE COST, STATED HONESTLY", "The client page is large, and it will keep growing. The trade is accepted deliberately: no build step and directly testable shipping code, against file size. Do not introduce a bundler to solve a problem that is really about organization."));
c.push(H2("1.1  The client's modules"));
c.push(P("The page began as one file in one global scope. Its lowest layer now lives in `static/js/` as ES modules, loaded by the page with `<script type=\"module\">` and served by a whitelisted route — a basename from one directory with one extension, guarded exactly like the session-log route, because both turn a URL into a file read."));
c.push(TBL(["Module", "Holds", "Depends on"], [
  ["`geodesy.js`", "Azimuth, distance, ENU, Web Mercator. No DOM, no state, no imports.", "nothing"],
  ["`geometry.js`", "Clipping, bounding boxes, segments, point-in-polygon, GeoJSON walkers.", "geodesy"],
  ["`units.js`", "The distance DISPLAY EDGE. Owns the km/nm preference outright.", "nothing"],
  ["`state.js`", "Shared mutable state: the vessel parameter block, the keep-out model, live chart state.", "nothing"],
  ["`chart.js`", "What the chart SAYS: hazard extent, corrected depth, clearance tests, the fairway's identity.", "geodesy, geometry, state"],
  ["`passage.js`", "How the vessel GETS THERE: the Rule 9 keep-right lane and the keep-out router.", "chart + the above"],
], [1700, 5600, 1500]));
c.push(P("Two rules make this work, and both are the same rule in different clothes. FUNCTIONS are imported by name, because a function binding is never reassigned — so moving one costs no call-site change anywhere. SHARED MUTABLE STATE is reached through an object and never destructured: an ES module namespace is sealed, so `import * as S` cannot be written to at all, and `const {x} = V` copies a value that a vessel switch will later change without telling you."));
c.push(P("The layer is pure on purpose. A suite can require these directly and exercise the SHIPPED function rather than an eval of its source text, which is what made the older harnesses fragile: they matched their own comments, went stale against renames, and could not tell a missing helper from a broken one."));

// 2 ---------------------------------------------------------------------------
c.push(H1("2  Ground rules"));
c.push(H2("2.1  The vessel file is the single source of truth"));
c.push(P("No hardcoded vessel constants. Ever. Speeds, turn rate, hull dimensions, energy model, guidance gains, planning defaults and spawn all live in one per-vessel file. The server validates a profile at load — a missing or mistyped field produces a clear, path-pointed error rather than running with placeholder physics — publishes the values, and the client mirrors them so both agree."));
c.push(NOTE("THE TRAP THIS CREATES", "A value DERIVED from the vessel at import time goes stale the moment the operator switches vessel. Anything derived must be re-derived when the profile is applied. This has bitten repeatedly — see 6.1."));
c.push(H2("2.2  The console core is vendor-neutral"));
c.push(P("The sibling console's identity never appears in code; refer to it as “the sibling console”. A modeled vessel's name is DATA and belongs in its profile — the core may name a profile identifier, because that is a data key rather than branding. The rule is scoped to CODE: the maintainer notes deliberately name the sibling and its path, because someone has to be able to find it."));
c.push(H2("2.3  The safety model is not negotiable"));
c.push(P("Arm-gating, the emergency-stop path, the link-loss failsafe and the refusal-with-a-reason contract are load-bearing. A change that makes any of them more permissive needs to be a deliberate, discussed decision — not a side effect of making something else convenient."));
c.push(H2("2.4  Refuse honestly rather than fabricate"));
c.push(P("Where a capability is not implemented, the code says so and refuses. The real-vessel link opens its transport and then declines to actuate, because no wire format is implemented — an honest refusal, never a fabricated frame. Carry that principle into anything new."));

// 3 ---------------------------------------------------------------------------
c.push(H1("3  The development loop"));
c.push(CODE([
  "1.  Read the maintainer notes' START HERE section. It is the authoritative handoff.",
  "2.  Reproduce the behavior. If it came from an operator, reproduce THEIR case.",
  "3.  Find the shape, not the instance (chapter 6).",
  "4.  Fix it structurally where you can, so the whole class dies.",
  "5.  Write the test. Then MUTATE the code and confirm the test fails.",
  "6.  Verify what the test cannot reach (chapter 5).",
  "7.  Update the docs in the SAME change. Rebuild the generated set.",
  "8.  Commit. The pre-commit hook runs every suite.",
]));
c.push(H2("3.1  Running it"));
c.push(CODE([
  "python asv_console.py --sim                              # normal",
  "python asv_console.py --sim --browser none --port 8795   # headless, for testing",
]));
c.push(NOTE("USE A SPARE PORT", "If someone is running the console for real, do not restart it out from under them. Start a scratch instance on a different port. On Windows a stale process holds the port and serves old code — check what is listening and kill by process id before concluding a change did not work."));
c.push(H2("3.2  The pre-commit hook"));
c.push(P("Every regression suite runs on commit unless everything staged is Markdown or git metadata. Enable it once per clone; it is versioned in the repository rather than left to each developer to remember. It reports EVERY failure rather than stopping at the first, because two broken invariants are worth knowing about in one pass."));
c.push(P("SKIP ONLY WHAT NO SUITE READS. The hook once ran only for a list of paths that counted, and the list drifted: a commit touching only the vendored current model, a vessel file or the default ports ran nothing. A suite that hangs is stopped after `SUITE_LIMIT_S` (600 s; `ASV_SUITE_LIMIT_S` overrides) and blocks the commit as TIMED OUT. Every suite has one line of failure advice in `advice_for`, naming the code to look at - a new suite needs one, and `tests/precommit_hook.py` fails without it. A suite that reads a console's output uses `exception_lines` from `tests/lib/server_log.py`: a traceback, socketserver's handler report or a route the console answered with a 500 is an exception; a note that merely names an error, like a geocoder it could not reach, is not."));
c.push(NOTE("TREAT A CRASHED HARNESS AS LOUDLY AS A FAILED CHECK", "A suite that cannot run protects nothing. A suite that prints success while exercising dead code is worse than no suite at all — it tells you to stop looking."));

// 4 ---------------------------------------------------------------------------
c.push(H1("4  Testing — and what makes a test worth having"));
c.push(H2("4.1  Tests with teeth"));
c.push(P("A check that cannot fail is not a check. EVERY suite here has been verified by MUTATION: deliberately break the behavior under test, run the suite, and confirm the specific assertions fail. The mutation results are recorded in each suite's header, naming which checks die for which break — so a future reader can tell whether a check is doing work without re-deriving it."));
c.push(P("This is not ceremony. It has repeatedly caught tests that passed for the wrong reason, and at least one suite that printed “all checks passed” while exercising code nothing called any more."));
c.push(H2("4.2  Pair every refusal with an acceptance"));
c.push(P("Where a test asserts that something is REFUSED, it must be paired with a case proving the same input is ACCEPTED under valid conditions. Otherwise a function that refused everything would pass — and “refuses everything” is a real and easy regression in a system built around keep-outs and gates."));
c.push(H2("4.3  Preserving a setting and honoring it are two assertions"));
c.push(P("A test once proved a persistent setting survived a command, and passed every mutation but one: the code path that IGNORED the setting entirely survived, because the test never got as far as using it. Assert both that a value is preserved and that it changes what happens."));
c.push(H2("4.4  The browser-code harness"));
c.push(P("Client geometry and logic are tested in plain Node with no server and no dependencies. The harness EXTRACTS the real functions out of the shipping page by brace matching and runs them against synthetic worlds — so the tests exercise shipping code rather than a copy that can drift."));
c.push(H3("4.4.1  How this harness breaks"));
c.push(P("It ENUMERATES the functions it pulls, so it breaks silently when the code under test gains a new dependency. Known traps, all of which have actually happened:"));
c.push(B("A grabber matching `function NAME(` silently drops an `async` prefix. The torn body was a syntax error — loud, and only by luck."));
c.push(B("A stray top-level process exit after an asynchronous section ended the run at SUCCESS having skipped five checks. Suites now print how many checks RAN."));
c.push(B("Nested backticks inside a template expression, and regular-expression literals containing a quote, desynchronise the extractor. Client code that harnesses read uses plain concatenation."));
c.push(B("A suite left pointing at source files that do not exist in this repository, inherited from a port. The source a harness NAMES must be the source it READS."));
c.push(H2("4.5  When a unit test is the wrong tool"));
c.push(P("Some failures live in the INTERACTION between a command and persisted state, and a unit test of either half alone will miss them. One suite deliberately starts a real console and drives it over the API for exactly that reason. Reach for this when the bug is “these two things disagree”, not when it is “this function computes the wrong number”."));
c.push(H3("4.5.1  A test console never keeps its state beside the program"));
c.push(P("A console keeps the plan, comms settings, port registry, ROC registry and session logs beside the program, and the operator may be working in their own console while the suites run. So every suite that starts one passes a temp folder with --state-dir, through tests/lib/console_state.py - and never takes a copy of the operator's plan to put back afterwards: the putting back is a write of its own, and it destroys whatever the operator saved meanwhile. tests/state_dir.py reads every suite's source and fails the day one starts a console without a state folder."));
c.push(H2("4.6  Source-order assertions, used sparingly"));
c.push(P("Two checks in one suite assert the ORDER of calls in the source rather than a computed value, because the property under test is canvas draw order and it is not observable without standing up a full render harness. This is a legitimate tool when the alternative is no coverage at all — but it is brittle, so it is used only where the regression is precisely an ordering, and the check says so in its own text."));

// 5 ---------------------------------------------------------------------------
c.push(H1("5  Verification beyond tests"));
c.push(H2("5.1  Drive the real thing"));
c.push(P("Start a headless console on a spare port, with --state-dir pointing at a temp folder so none of it lands in the operator's plan or logs, and drive it over the API. The state endpoint and the event stream tell you what the server believes; that is the ground truth for anything the server owns."));
c.push(NOTE("THE CLIENT DOES THE ROUTING", "Route planning, keep-out avoidance and channel handling are all BROWSER code. Driving the raw command API with no route bypasses every one of them, and a scripted run will cross keep-outs that the interface would have routed around. Rehearse through the interface, or place raw-API waypoints in open water only."));
c.push(H2("5.2  Look at the pixels"));
c.push(P("The chart is an animating canvas, so screenshots time out. Read the CANVAS DIRECTLY instead: sample a small box of image data at a known screen point and count pixels matching the feature's own color. One call, no screenshot, immune to the animation."));
c.push(P("This is how a control that was live, correct and completely invisible was found — after a byte-identical diff had said there was nothing wrong. Traps: the vessel marker is drawn late and lands on top of several handles, so put synthetic geometry AWAY from it unless burial is the thing under test; long waits belong in a sampler read back by a later call; and a hidden browser pane throttles timers heavily, so trust the outcome rather than the sample density."));
c.push(H2("5.3  Verify against real data, not only fixtures"));
c.push(P("Chart-facing changes are checked against the REAL cached chart for a real operating area, not only synthetic features. That is what turned an abstract clearance fix into a concrete statement: this many charted hazards are now sized, these ones remain passable for this vessel's floor, and here is why that is correct."));
c.push(H2("5.4  What static checks cannot catch"));
c.push(P("A clearance check on a PLANNED path does not catch FOLLOW OVERSHOOT. An idealised arc can validate perfectly clear and still be tighter than the vessel can hold, in which case the vessel overshoots outboard — into the very keep-out the arc was hugging. Path geometry has to be verified with a live run sampling vessel against keep-out, not with geometry alone."));

// 6 ---------------------------------------------------------------------------
c.push(H1("6  Recurring defect shapes"));
c.push(P("Nearly every defect found in this system has fallen into one of four shapes. Check for them before doing anything cleverer."));
c.push(H2("6.1  One value serving two masters"));
c.push(P("A single field doing two unrelated jobs, so writing it for one purpose silently destroys the other. Or a value trusted without its provenance — chart data used without its extent or its distance, a derived constant used after the thing it was derived from changed."));
c.push(P("THE FIX IS STRUCTURAL: one field per concept, plus an invariant about who may write it. Splitting the field is not enough on its own; the durable part is the rule that kills the whole class, such as “no method on this object writes that value”."));
c.push(H2("6.2  A readout accurate about its own field and wrong about the vessel"));
c.push(P("The code is live and correct, and the operator still cannot use it. Ask what question the row is actually being READ for, then check whether any field answers it. Three mechanics behind this, each worth checking directly:"));
c.push(B("A value that answers a DIFFERENT question than the one being asked — where one existed for what a run was uploaded with, and none existed for where the run would leave the vessel."));
c.push(B("A paint taken BEFORE the flag it reads was cleared, so the success path is the one that never repaints."));
c.push(B("An edge-triggered reset for a condition that is not edge-shaped — a state machine that never crosses the edge the reset watches for."));
c.push(B("A control painted before something that covers it. Live, draggable, invisible."));
c.push(H2("6.3  A clean diff is not evidence a port works"));
c.push(P("Feature work flows between this console and its sibling in both directions. A ported feature can be byte-identical to its source and still be missing from the operator's point of view — because the two consoles draw in a different order, or because the strings that make it discoverable did not come across with the code."));
c.push(P("“The code is ported” and “the operator can use it” are different claims. Verify a user-facing port by looking at the interface, not the diff."));
c.push(H2("6.4  A check that cannot tell the bug from the fix"));
c.push(P("The most expensive shape, because it does not merely fail to help — it actively tells you to stop looking. Three instances, all found by deliberately breaking the code and watching the check stay green:"));
c.push(B("COMPARING OUTPUT AGAINST ITSELF. A generated document was verified by confirming it came out byte-identical to the previous build. It did. It had also never been openable. A hash proves stability, not correctness."));
c.push(B("TESTING A FILTER WITH NOTHING TO FILTER. A check that a range parameter was honored compared two responses from a registry that happened to be empty, so “filtered” and “unfiltered” were the same bytes. It passed with the fix reverted."));
c.push(B("ASSERTING THE SHAPE INSTEAD OF THE VALUE. A check that a request carried a field named for kilometers passed just as happily when the field held nautical miles — a factor of 1.852 wrong, with a plausible number on screen."));
c.push(P("The common root: the check was written against what the code DOES rather than against what would be different if it were wrong. The discipline that catches all three is the same one described in chapter 4 — break the behavior on purpose, confirm the SPECIFIC assertion fails, and record which. A check that has never been seen to fail is not yet evidence of anything."));
c.push(H2("6.5  The unguarded branch before the safety net"));
c.push(P("The command dispatcher wraps its main handler chain in a try/except that turns a refusal into a clean HTTP error. But branches ADDED ABOVE that try get no net at all: an exception there unwinds the dispatcher, drops the client’s connection with NO response, and kills the handler thread with a traceback. Three routes shipped this way — a numeric cast fed “abc”, and a keyword-unpack fed a client dict whose keys collided with the receiving function’s own parameter names — each reachable by a perfectly legal request body."));
c.push(P("The family resembles the earlier defect in which a handler answered correctly and THEN raised, but is worse for the client: there is no response at all, just a closed socket. And it is invisible to every client-side assertion that inspects only successful answers."));
c.push(NOTE("THE RULE", "A dispatch branch that sits before the safety net must carry its guards LOCALLY — and a suite that drives a real process must read that process’s own output, because a dropped connection plus a server traceback is the only evidence this shape leaves."));
c.push(H2("6.6  The masked branch"));
c.push(P("One of those unguarded branches survived past twenty-eight suites that all drive a real console — because every harness disables session logging for cleanliness, the branch’s first line checks whether logging is enabled, and so the code under test was never once executed. A masked branch is an untested branch no matter how many suites run past it."));
c.push(P("The suite that finally covered it runs the console WITH the feature enabled and cleans up the artifacts it thereby creates. The general form: when a harness disables a subsystem for convenience, list what that mask hides, and make sure at least one suite runs with the mask off."));

c.push(H2("6.7  A check that cannot report the fault it exists for"));
c.push(P("THE STRUCTURAL FIX, applied to all 37 suites: a CRASH GUARD. Each one registers an uncaught-exception handler (an excepthook on the Python side) before anything that can throw, including its own imports. A death then prints a FAIL line naming the exception and its location, and exits non-zero — reportable rather than silent. A check asserts every suite still carries one, because a guard that can be quietly deleted is not a guarantee."));
c.push(P("It removed a fragility in the RUNNER as well, which is the more general lesson. The suites end with five different summary wordings, so a runner sniffing summary text to decide whether a suite FINISHED gets it wrong somewhere — and did, reading a perfectly healthy failure as a crash and reporting the wrong thing about the code under test. With the guard, a death always prints a FAIL line, so FAIL lines alone are a sufficient signal and the wording stops mattering. Prefer a signal the subject EMITS over one the observer has to infer."));
c.push(P("A suite that dies part-way prints no failure line at all — and \"no failures printed\" is indistinguishable from \"everything passed\" to anything reading its output, including the mutation runner grading it. So a check that proves a guard exists has to survive that guard being gone."));
c.push(P("The instructive part is how easily the WRONG symptom gets fixed. A range guard on the home coordinate was removed as a mutation and the suite crashed rather than failing. The obvious repair was to assert the console was still answering afterwards — and it was: a non-finite coordinate serializes perfectly happily and the state endpoint hands it straight back. That check passed, the suite took the value as its Return-to-Home target, and died four checks later. The invariant that mattered was never \"the console survived\"; it was \"HOME is still a usable coordinate\", because every remaining check steered to it. Name the property the rest of the suite DEPENDS on, then abort through the normal summary path so the failure is scored as a failure rather than as a crash. When a harness dies, fix what killed it — not the first plausible symptom visible from where you are standing."));

// 7 ---------------------------------------------------------------------------
c.push(H1("7  Documentation discipline"));
c.push(H2("7.1  Same change, not later"));
c.push(P("When a change alters user-facing behavior, the relevant documents are updated in the SAME change. Documentation that lags is documentation nobody trusts, and untrusted documentation gets ignored rather than fixed."));
c.push(H2("7.2  The generated set"));
c.push(P("Every document in the output directory is GENERATED from a build script that shares one formatting module. NEVER hand-edit a generated document: edit the script and rebuild. If one is hand-edited in a word processor anyway, diff the text against the generated version, fold the edits back into the script marked as the author's, and rebuild."));
c.push(CODE([
  "cd tools && npm install       # once",
  "node build_docs.js            # rebuild the whole set",
]));
c.push(H2("7.3  The maintainer notes are the authoritative log"));
c.push(P("The START HERE handoff at the top carries the current commit, the suite inventory, what changed this session, the recurring defect shapes and the open threads. Refresh it when it drifts. Two habits earn their keep: cite code by CONTENT rather than line number, because line numbers rot; and record a DIVERGENCE from the sibling console explicitly, because a future port will otherwise undo it silently."));
c.push(H2("7.4  Write down where a rule's line falls"));
c.push(P("A flag sat open for weeks because the rule it referenced had never had its boundary written down, so nobody could tell what would satisfy it. When a rule generates recurring judgment calls, record the boundary and — where possible — a command that checks it."));

// 8 ---------------------------------------------------------------------------
c.push(H1("8  Case studies"));
c.push(P("Real defects from this repository. Each is kept because it is a CLASS."));
c.push(H2("8.1  The setting that a command overwrote"));
c.push(P("SYMPTOM: the operator selected a return-home end-of-plan behavior; the console acted on a loiter. Confirmed live — the stored mission said one thing, the reported state another."));
c.push(P("CAUSE: one field doing two jobs. It was both the operator's persistent END-OF-PLAN SETTING and the completion of the RUN CURRENTLY IN PROGRESS. Direct behaviors legitimately station-keep at their own endpoint, so commanding one set the field to “loiter” — and thereby overwrote the setting with it."));
c.push(P("FIX: one field per concept, plus the invariant that no method on the engine writes the setting. That invariant, not the split, is what kills the class — every future endpoint-holding behavior would otherwise have to remember not to touch a field it has every reason to touch."));
c.push(P("LESSON: when the same value is written by both a user action and a system action, it is two values."));
c.push(H2("8.2  The hazard with no size"));
c.push(P("SYMPTOM: a planned route ran straight over a charted wreck."));
c.push(P("CAUSE: the chart handling was fine — the wreck was fetched, classified and enforced. But every point keep-out was given a radius of exactly the clearance buffer, so a wrecked ship, a mooring pile and a channel buoy were the same object to the router. At a small buffer, a wreck was a small obstacle. THE BUFFER IS A CLEARANCE MARGIN AND WAS BEING ASKED TO DOUBLE AS THE OBJECT'S EXTENT. It cannot do both."));
c.push(P("FIX: hazards whose extent the chart does not give carry an intrinsic radius, with the buffer added ON TOP as the margin it always was. A charted sounding over the hazard, tide-corrected, collapses it back to a point — and NO sounding means UNKNOWN, which takes the full berth rather than the benefit of the doubt."));
c.push(P("LESSON: both clearance paths had to learn it. Fixing only the exact check would have made the search plan through the hazard and the leg then fail validation — a refusal instead of a detour."));
c.push(H2("8.3  The tide from another coast"));
c.push(P("SYMPTOM: a water level from hundreds of kilometers away, displayed exactly as authoritatively as a local one."));
c.push(P("CAUSE: not a fault. The reading was correctly labeled and the position logic did force a refetch — but the tide service polls on its own cadence, so the previous station's value stands in the gap and looks entirely normal."));
c.push(P("FIX: band the reading by distance to the NEAREST contributing station, and show that GRAPHICALLY — translucency reads as low confidence at a glance, so the operator never has to inspect a station name on a number that is usually fine. Beyond a threshold the reading is shown but NOT APPLIED to charted depths."));
c.push(P("LESSON: the nearest station decides, not the average. Averaging would discredit a good local reading with one distant contributor, and would let two distant stations either side average into a falsely local one."));
c.push(H2("8.4  The readout that was right about itself"));
c.push(P("SYMPTOM: an end-of-plan return home worked, but every readout said the run would loiter, right up until the moment the vessel turned for home."));
c.push(P("CAUSE: the field said what the run was UPLOADED with, which was accurate. What happened next was a separate mechanism the readouts knew nothing about. Each field was accurate about itself and wrong about the vessel."));
c.push(P("FIX: a third value answering the question actually being asked — where does this run leave the vessel — and it is the only one the cards show. It reports the return only when the return can actually happen."));
c.push(P("LESSON, AND THE MORE VALUABLE HALF: verifying the display found a real behavioral bug. The mechanism was a one-shot guard re-armed on a state edge that a second command issued mid-run never crosses, so that run inherited a spent guard and held at its endpoint indefinitely. Invisible until a readout started making a promise about it."));
c.push(H2("8.5  The control that was drawn, live, and invisible"));
c.push(P("SYMPTOM: an operator reported a control as missing and asked for it to be ported from the sibling console."));
c.push(P("CAUSE: it had already been ported, completely and byte-identically, and it worked — the hit test answered and a drag did the right thing. It was drawn EARLY, and the vessel marker is drawn LATE and lands exactly where that control sits in the commonest case there is. Measured on the running page: zero control-colored pixels when it coincided with the vessel, seventy when it did not."));
c.push(P("FIX: draw it last, with a halo. And the actual gap in the port was the HINT TEXT — the sibling's string names the control and this one's did not, so nothing on screen ever said it existed."));
c.push(P("LESSON: a control the operator cannot see is a control they do not have. The diff was clean, the logic was right, the feature was missing."));

c.push(H2("8.6  The deliverable nobody opened"));
c.push(P("SYMPTOM: an operator tried to open the generated Word documents. None of the four would open. Not one of them ever had."));
c.push(P("CAUSE: the formatting module's code-block helper returns an ARRAY of paragraphs, one per line, while every other helper returns a single object. Every generator wrote `c.push(CODE([...]))`, pushing the array itself as ONE child. The document serializer emitted it as the literal element `<0/>` — an element name cannot begin with a digit — so the main document part was not well-formed XML and Word refused the file outright. The array's CONTENTS went with it, so every code block in every document was missing: the Quick Start, whose whole job is to tell a new operator which commands to type, did not contain them."));
c.push(P("It shipped that way from the day the first document was generated until an operator tried to read one — eighteen commits and four documents later."));
c.push(P("WHY IT SURVIVED is the part worth keeping. Three separate signals all said “fine”:"));
c.push(B("The build printed “written: <name>, N bytes” for every document. A file appeared, and its size was plausible."));
c.push(B("The set was rebuilt many times and the process never errored — a malformed child element is still a perfectly valid ZIP entry."));
c.push(B("A refactor of the shared module was checked by confirming the main document part came out BYTE-IDENTICAL before and after, and that was reported as evidence the refactor was safe. It was byte-identical. It was also identically broken."));
c.push(NOTE("THE LESSON", "A hash proves STABILITY, never CORRECTNESS. Comparing output against previous output can only tell you that nothing changed; it cannot tell you the output was ever right. Compare against a READER instead — something that has to consume the artifact and is entitled to refuse it."));
c.push(P("FIX: flatten in the writer rather than spreading at each of the six call sites, which repairs them all at once and makes the next list-returning helper safe by construction. Then a suite that does what nothing did before: checks each document is a package a reader will accept — every part well-formed, every part declared, every relationship target present, every internal reference resolvable."));
c.push(P("And a CONTENT check beside the validity ones, because validity alone is not enough here. Filtering the arrays away instead of flattening them yields four perfectly valid documents with every code block still missing — the same silent loss, now wearing a clean bill of health. That check compares against the code lines PARSED OUT OF THE GENERATORS, so a block added tomorrow is covered without anyone remembering to list it."));
c.push(P("Confirmed against real Word at both ends: the committed documents were refused with “Word experienced an error trying to open the file”; the rebuilt ones open at 15, 14, 8 and 3 pages. The suite is the cheap stand-in, since Word cannot run in a commit hook."));
c.push(H2("8.7  The coverage campaign — auditing by consequence"));
c.push(P("SYMPTOM: none, and that is the point. The question that started it was “does anything prove the emergency stop actually stops the vessel?” — and the answer was no. Twenty of the console’s thirty-three API routes had no behavioral test, because every suite before then had been written REACTIVELY, the day something broke. A net shaped by history guards the code that has already failed; the most safety-critical control in the console had never been on that list."));
c.push(P("The campaign covered the remainder in eight suites, picked by CONSEQUENCE — the safety chain first, data plumbing last — each driving one real console through one arc in mission order. GROUNDING came before every suite: read the handler and its seams, write down what the contract actually is, and only then write checks. That order found five live defects before a single assertion existed for them, including a stale-telemetry home capture and the whole family of section 6.5."));
c.push(P("The mutation discipline grew four rules along the way, each earned by a run that surprised its author:"));
c.push(B("A mutation of SHARED code must be caught from BOTH its consumers — being watched from two suites is the payoff a deduplication has to demonstrate, not assume."));
c.push(B("A predicted survival is only earned when removing the WHOLE layered pair is caught. Predicting one correctly before the run is the discipline working; a surprise survival is a weak check found."));
c.push(B("A mutation that survives the suite that OWNS the endpoint and is caught only by a bystander is a weak-check finding — the guard would not survive the bystander’s refactor."));
c.push(B("Pick the observable only the mechanism under test can produce. An energy gauge that flips on a vessel switch proved a parameter reload, not the respawn the check claimed — the boat coming up at the NEW vessel’s own spawn point was the observable that could not lie."));
c.push(P("The arithmetic at the end: eight suites, five defects fixed, and no route whose failure mode is unwatched. The stability guarantee the campaign set out to earn is now a property of the commit hook, not a hope."));

c.push(H2("8.8  The tool that damaged the thing it was testing"));
c.push(P("Mutation testing here is not a framework. It is a short script that REWRITES A REAL SOURCE FILE in the working tree, runs a suite against the damage, and puts the original back. That last step is the whole safety of the method, and it is the step that does not always happen: a runner stopped by a timeout, a canceled command or a closed session is killed outright, and a killed process does not run its cleanup. Twice now that has left the console's main source file altered on disk — once emptied, and once far worse, left silently MUTATED with one branch of a command quietly doing nothing. Everything still parsed. Most checks still passed. It was one commit away from shipping, and what caught it was not a test but an insert count being off by one in a routine diff."));
c.push(P("The lesson is not \"be careful\". A cleanup step that only runs when the process exits normally is not a safeguard, because the case it must cover is the process not exiting normally. The recovery has to be durable and it has to be visible:"));
c.push(B("Write the pristine copy to a SIDECAR FILE before the first mutation, and restore from that sidecar on START if one is already there. A killed run then heals itself on the next run instead of quietly persisting, and the sidecar's presence at rest is a standing signal that the source is suspect."));
c.push(B("Write each mutation ATOMICALLY — to a temporary file, then rename over the target — so a process killed mid-write cannot leave a half-written source."));
c.push(B("Run the set as a background job rather than under a foreground timeout, so the thing most likely to kill it is removed."));
c.push(B("After ANY mutation run, DIFF THE SOURCE before trusting a green suite. A restored file and a subtly unrestored one both compile and both look calm."));
c.push(P("Two smaller traps come from the same run and cost as much. A multi-line anchor written with one line ending will not match a file stored with the other — the repository's blob may be LF while the working copy a script opens is CRLF, and every mutation then silently matches nothing. Score a missing anchor as SKIPPED rather than as caught, or a whole run of no-ops reads as a clean sweep. And when a mutation KILLS the harness instead of failing a check, the fix belongs in the harness, not the report: see 6.7."));

// 9 ---------------------------------------------------------------------------
c.push(H1("9  Extension recipes"));
c.push(H2("9.1  Add a vessel"));
c.push(B("Copy an existing profile. It must be COMPLETE — validation requires every field."));
c.push(B("Fill in hull, propulsion, energy, guidance, planning defaults and spawn."));
c.push(B("Record provenance in the notes: which figures are official, which are derived, which are estimated. A future reader cannot tell them apart otherwise."));
c.push(B("Start on it and confirm the derived values — depth floor, turn radius, buffer floor — are what you expect."));
c.push(H2("9.2  Add a vessel-dependent value"));
c.push(B("Put it in the profile. Never in code."));
c.push(B("Publish it where the profile is applied, so a LIVE SWITCH re-derives it. This is the single most repeated bug in this system."));
c.push(B("If the client needs it, mirror it through the vessel endpoint so both sides agree."));
c.push(B("Add a test that switches vessel and asserts the value MOVED."));
c.push(H2("9.3  Add a behavior"));
c.push(B("Gate it behind arming and the emergency stop, like every other."));
c.push(B("Route it clear of the keep-out model, and REFUSE with a named reason where it cannot be."));
c.push(B("Decide what it does at its own end, and make sure it does not write the operator's persistent setting (8.1)."));
c.push(B("Give it a banner that says what it actually did, including any degradation."));
c.push(B("Make sure the mission readout covers it — it is one paradigm for every commanded run."));
c.push(H2("9.4  Add a display element"));
c.push(B("Ask what QUESTION it answers, then check a field actually answers it (6.2)."));
c.push(B("Name the STATE rather than printing a bare value where several states look alike."));
c.push(B("Check the draw order if it is a control. Later layers cover earlier ones."));
c.push(B("Register it wherever the multi-window bridge needs to know about it."));
c.push(B("Confirm it on the running page, by pixels if it is drawn (5.2)."));
c.push(H2("9.5  Port something from the sibling console"));
c.push(B("Port the STRINGS as well as the code — discoverability lives in them."));
c.push(B("Check draw order and layout independently. The two consoles differ."));
c.push(B("Re-derive anything the sibling hardcodes but this console takes from the vessel profile."));
c.push(B("Record any deliberate DIVERGENCE in the maintainer notes, or a future port will undo it."));
c.push(B("Verify through the interface, not the diff (6.3)."));

// 10 --------------------------------------------------------------------------
c.push(H1("10  House rules"));
c.push(B("No hardcoded vessel constants. Ever. The vessel file is the single source of truth."));
c.push(B("Keep the console core vendor-neutral. Vessel files may name real vessels; the console may not."));
c.push(B("Never weaken the safety model: arm-gating, emergency stop, link-loss failsafe, and refusal-with-a-reason."));
c.push(B("Every new suite is mutation-verified before it is trusted, and records its mutations in its own header."));
c.push(B("A refusal test is paired with an acceptance test."));
c.push(B("Update the relevant documents in the same change, and rebuild the generated set from its scripts."));
c.push(B("Cite code by content, not line number."));
c.push(B("Record divergences from the sibling console explicitly."));
c.push(B("Treat a crashed harness as loudly as a failed check."));

write("asv-simulator-development-guide.docx", c);
