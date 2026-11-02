// tests/governor_says.js - the console does not announce a throttle command it never sent, and a page loaded
// mid-run can name the leg she is on.
//
// Andy, 2026-11-02, after the overnight Honolulu Harbor run: "do all the fixes".
//
// WHAT HAPPENED, in the log. At t=6,922.96 s a chart page that had just been reloaded printed
//
//     "Clear ahead again (47.5 m) - speed back to 6 kn (transit)."
//
// as a completed fact. `speedGovernor` stood down on its very next line - `indexedRoute()` was null, because
// that page had never uploaded the 388-waypoint way round the vessel was flying and the drawn mission held 451
// - so no /api/cmd/speed was sent. The guard's `low` stood. It was the LAST speed command of a 9.3 h session,
// and she ran the following 7 h 21 m at a mean 1.099 kn. The operator's only record of the throttle was a note
// for a command that did not exist.
//
// TWO FIXES, AND THIS SUITE OWNS BOTH ENDS OF EACH.
//   (d) `govHeldBy` - ONE function answering "will the governor put the plan's speed back, and if not why
//       not". The guard's release note asks it instead of asserting. Two copies of that question had already
//       drifted apart: the note asked about `escapeThrottle` and `resumeSlow`, which are two of the
//       governor's SEVEN exits.
//   (e) `/api/run_route` + `adoptRunRoute` - the console serves the array her waypoint index counts into (it
//       is on the link; the Engine used to throw it away after the upload) and a page that did not upload it
//       asks for it. That is the condition behind the false note, and behind "the leg she is on is not known
//       to this page" on every readout for the rest of a run.
//
// ⚠⚠ CHECK 6 IS THE ONE THAT MATTERS IN A YEAR. It reads speedGovernor's OWN early returns out of the page and
// fails if one of them is not accounted for - either answered by govHeldBy or named here with the reason it is
// deliberately not. The fault being repaired is two copies of one question drifting; a suite that only checked
// today's seven exits would let the eighth drift in silently, which is the same bug with a new number on it.
//
//   node tests/governor_says.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// WHERE THE REST LIVES. The release note's own wording is asserted where the guard's world already is -
// tests/ais_avoid.js 18g (it must not say "speed back to") and 18g2 (what it says instead); the governor
// commanding nothing in each stand-down is tests/speed_modes.js; the console half of the stand-down and of
// /api/run_route is tests/supervision_standdown.py.
//
// TEETH - mutations run against a sidecar copy of static/asv.html, and the checks each one turned red:
//     govHeldBy answers null for a view-only tab                      -> 2
//     govHeldBy answers null when indexedRoute() is null              -> 4
//     govHeldBy answers null while she is coasting                    -> 3
//     govHeldBy drops the escape-hold branch                          -> 2c
//     govHeldBy answers a reason for a perfectly governed boat         -> 1
//     an eighth stand-down added to speedGovernor, govHeldBy untouched -> 6
//     the release note stops asking govHeldBy                          -> 7
//     adoptRunRoute adopts a route of the wrong length                 -> 9
//     adoptRunRoute adopts a STAGED plan                               -> 9b
//     adoptRunRoute re-fetches every frame                             -> 10
//     adoptRunRoute latches a FAILED fetch (degraded for the whole run) -> 10b
//     indexedRoute stops preferring runRoute                           -> 8

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const fs = require("fs");
const path = require("path");

// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes its mutants to a file
// this suite never reads and scores every one as SURVIVED. tests/precommit_hook.py check 8 enforces it.
const H = fs.readFileSync(process.env.ASV_HTML
                          || path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}
// ⚠ SOURCE CHECKS READ CODE, NOT COMMENTS. Every ⚠ paragraph in this page names the thing it was written
// about, so a check that greps for `indexedRoute` matches the note ABOUT it. Strip first, then match.
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")
                             .replace(/([^:"'])\/\/.*$/gm, "$1");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok = false, err = "";
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  console.log((ok ? "  ok   " : "  FAIL ") + name
              + (detail ? "   [" + (typeof detail === "function" ? detail() : detail) + "]" : "") + err);
  if (!ok) fails++;
}

console.log("The governor's own answer, and the route a page loaded mid-run cannot name:");

// ---- THE WORLD. Only what govHeldBy and adoptRunRoute read. ----
var SUPERVISES = true;
var supHolder = null, CLIENT_ID = "tab-under-test";
var runRoute = null;
var mission = { waypoints: [], lines: [] };
var S = null;
var notes = [], logged = [];
function flashNote(t) { notes.push(t); }
function logClient(kind, data) { logged.push({ kind, data }); }
function updateMissionCard() {}
function renderIntent() {}
function render() {}
// ⚠ adoptRunRoute's THREE STATE VARIABLES ARE DECLARED HERE, WITH `var`, AND NOT LIFTED. `grabDecl` returns
// the page's `let adoptedSeq = null, ...`, and a `let` inside a direct eval is scoped TO THE EVAL - so the
// lifted function and this suite each got their own binding, every reset from out here was invisible to it,
// and checks 10 and 10b read 0 fetches with nothing wrong in the page at all. `var` puts one binding in the
// enclosing scope. They are mutable state rather than tuning values, so a copy costs no coverage - but a
// RENAME would silently give the lifted function fresh globals, which is what check 11 is for.
var adoptedSeq = null, adoptNextAt = 0, adoptBusy = false;
// the page's own supervising(), lifted - a stub here would be a copy of the one test that gates every command
// eslint-disable-next-line no-eval
eval(grab("supervising") + "\n" + grab("indexedRoute") + "\n" + grab("govHeldBy") + "\n"
     + grab("adoptRunRoute"));

const running = (over) => Object.assign({
  run: "running", armed: true, estop: false, behavior: "survey", wp_total: 0, wp_index: 0, run_seq: 1,
  status: { holding: false, drifting: false, speed_key: "6" },
}, over || {});

// ── 1. a governed boat: no reason, because there is nothing holding the throttle ──────────────────
S = running(); runRoute = null; mission.waypoints = [{ lat: 1, lon: 1 }, { lat: 1.001, lon: 1 }];
check("1. armed, running, supervised, on a plan this page can place her in: govHeldBy answers NULL - the "
      + "governor will put the plan's speed back, so the release note may say so",
      () => govHeldBy() === null, () => JSON.stringify(govHeldBy()));

// ── 2. every stand-down is NAMED, in the operator's words ─────────────────────────────────────────
const cases = [
  ["2a. she is not under autonomous command (not running)", running({ run: "paused" }), /not under autonomous command/],
  ["2a2. ... nor disarmed", running({ armed: false }), /not under autonomous command/],
  ["2a3. ... nor e-stopped", running({ estop: true }), /not under autonomous command/],
  ["2c. the escape's throttle stands while she holds on it", running({ behavior: "escape", status: { holding: true } }),
   /escape/],
  ["3. she is coasting, and a coast is the ABSENCE of a commanded speed - the governor would re-power the prop "
   + "within a frame of it stopping", running({ status: { drifting: true } }), /coasting/],
];
for (const [name, st, re] of cases) {
  S = st;
  const why = govHeldBy();
  check(name, () => typeof why === "string" && re.test(why), () => JSON.stringify(why));
}

S = running(); supHolder = "another-tab";
check("2b. a VIEW-ONLY tab says so - it governs nothing, and a release note promising the plan's speed from a "
      + "tab with no authority is the same false sentence in a different place",
      () => /view-only/.test(govHeldBy() || ""), () => JSON.stringify(govHeldBy()));
supHolder = null;

// ── 4. the one that happened: a page that cannot name her leg ─────────────────────────────────────
S = running({ wp_total: 388 });
mission.waypoints = new Array(451).fill(0).map((_, i) => ({ lat: 1 + i * 1e-5, lon: 1 }));
runRoute = null;
const why4 = govHeldBy();
check("4. HONOLULU: the vessel holds 388 waypoints, this page's drawn mission holds 451, and it never uploaded "
      + "the way round - indexedRoute() is null, the governor stands down, and govHeldBy says which leg it "
      + "cannot name instead of letting the note promise 6 kn",
      () => indexedRoute() === null && /cannot say which leg/.test(why4 || ""),
      () => "indexedRoute=" + JSON.stringify(indexedRoute()) + " why=" + JSON.stringify(why4));

// ── 5. the four exits it deliberately does NOT repeat ─────────────────────────────────────────────
const govSrc = codeOnly(grab("govHeldBy"));
check("5. govHeldBy does not repeat `clearance.slowed`, `escapeThrottle`, `resumeSlow` or the "
      + "EDGE_REASSESS_MS refusal: the first and the last read state the release nulls on its very next line, "
      + "and the middle two are the two the note already had its own sentence for",
      () => !/clearance\.slowed/.test(govSrc) && !/escapeThrottle/.test(govSrc)
            && !/resumeSlow/.test(govSrc) && !/EDGE_REASSESS_MS/.test(govSrc)
            // ⚠ THE REASONS LIVE IN THE DOC COMMENT ABOVE THE FUNCTION, which `grab` does not include - it
            // starts at `function`. Asserted against the page, so the four stay DOCUMENTED, not merely absent.
            && /each omission is a reason, not an oversight/.test(H),
      () => "slowed " + /clearance\.slowed/.test(govSrc) + ", escape " + /escapeThrottle/.test(govSrc)
            + ", resumeSlow " + /resumeSlow/.test(govSrc) + ", edge " + /EDGE_REASSESS_MS/.test(govSrc));

// ── 6. ⚠⚠ THE ANTI-DRIFT INSTRUMENT. Every early return in speedGovernor is accounted for. ────────
// Read the governor's own body, take every statement that returns before the one `commandSpeed(want)`, and
// require each to match a gate this suite knows about. An EIGHTH stand-down added later matches nothing and
// this goes red - which is the only way "two copies of one question" cannot drift again in silence.
{
  const gov = codeOnly(grab("speedGovernor"));
  const cut = gov.indexOf("commandSpeed(want)");
  const body = gov.slice(0, cut < 0 ? gov.length : cut);
  // every line that returns, minus the two that are the governor's ordinary answers
  const rets = body.split("\n").map(l => l.trim())
                   .filter(l => /\breturn\b/.test(l))
                   .filter(l => !/^return (commandedSpeed|want);/.test(l))
                   .filter(l => !/^if\s*\(want === commandedSpeed\)/.test(l));
  const KNOWN = [
    [/if\(!act\)/, "govHeldBy", /run === "running"/],
    [/if\(clearance\.slowed\)/, "the release clears it on its next line", null],
    [/if\(resumeSlow\)/, "the note's own LOW sentence", null],
    [/if\(escapeThrottle\)/, "the note's own escape sentence", null],
    [/if\(st\.drifting\)/, "govHeldBy", /st\.drifting/],
    [/if\(!indexedRoute\(\)\)/, "govHeldBy", /!indexedRoute\(\)/],
    // ⚠ THIS ROW IS WHAT CHECK 6 LOOKS LIKE WHEN IT WORKS. The refusal-to-raise was three inline lines
    // reading `Date.now() - guardEdgeAt < EDGE_REASSESS_MS`; fixing the speed-zone release banner turned it
    // into govRaiseHeld, the governor's line became one statement, it matched nothing here, and this check
    // went red on the same commit that made the change (Andy, 2026-11-02: "fix the zone banner too"). It is
    // still not govHeldBy's business: the release nulls `commandedSpeed` on its very next line, so the raise
    // test cannot be standing when the note is read - it is the ZONE banner that had to ask it.
    [/if\(govRaiseHeld\(want\)\) return commandedSpeed;/,
     "govRaiseHeld - asked by the zone release banner, not by the guard's note (commandedSpeed is nulled there)",
     null],
  ];
  const unknown = rets.filter(l => !KNOWN.some(([re]) => re.test(l)));
  const unanswered = KNOWN.filter(([, , inGov]) => inGov && !inGov.test(govSrc)).map(([re]) => String(re));
  check("6. EVERY early return in speedGovernor is accounted for - answered by govHeldBy, or named here with "
        + "the reason it is deliberately not. An eighth stand-down added without touching govHeldBy fails HERE, "
        + "which is the only thing that stops the two copies drifting apart again",
        () => rets.length >= 6 && unknown.length === 0 && unanswered.length === 0,
        () => rets.length + " early returns; unaccounted: " + (unknown.join(" | ") || "none")
              + "; claimed by govHeldBy but missing from it: " + (unanswered.join(", ") || "none"));
}

// ── 7. the guard's release note ASKS, instead of asserting ────────────────────────────────────────
{
  const guard = codeOnly(grab("clearanceGuard"));
  const i = guard.indexOf("speed back to ");
  const near = i < 0 ? "" : guard.slice(Math.max(0, i - 900), i + 60);
  // ⚠ THE ORDER IS THE WHOLE COMPOSITION RISK, so it is asserted and not assumed. `govWhy` must be taken
  // BEFORE the note (a ternary cannot ask a question it has already answered) and the note BEFORE
  // `clearance.slowed = false; commandedSpeed = null` - and the escape and LOW branches must still come first,
  // because each has a truer sentence than "something holds the throttle". tests/ais_avoid.js 18g drives the
  // live wording of the LOW branch, which is this same ternary one arm along.
  check("7. the release note ASKS govHeldBy before it says \"speed back to N kn\", says the reason instead "
        + "when something else holds the throttle, and asks it in the right order - the note and the throttle "
        + "cannot disagree any more",
        () => i > 0 && /govHeldBy\(\)/.test(near) && /her speed stays as commanded/.test(guard)
              && /govWhy\s*\n?\s*\?/.test(guard)
              && guard.indexOf("const govWhy") > 0 && guard.indexOf("const govWhy") < i
              && i < guard.indexOf("clearance.slowed = false")
              && /\(escapeThrottle \|\| resumeSlow\) \? null : govHeldBy\(\)/.test(guard),
        () => i < 0 ? "the note is gone" : ("asks govHeldBy: " + /govHeldBy\(\)/.test(near)
              + ", honest branch: " + /her speed stays as commanded/.test(guard)
              + ", asked before the note: " + (guard.indexOf("const govWhy") < i)
              + ", note before the reset: " + (i < guard.indexOf("clearance.slowed = false"))
              + ", escape/LOW first: " + /\(escapeThrottle \|\| resumeSlow\) \? null/.test(guard)));
}

// ── 8. indexedRoute, settled ──────────────────────────────────────────────────────────────────────
S = running({ wp_total: 2 }); mission.waypoints = [{ lat: 1, lon: 1 }, { lat: 1.1, lon: 1 }];
runRoute = [{ lat: 2, lon: 2 }, { lat: 2.1, lon: 2 }, { lat: 2.2, lon: 2 }];
const pref = indexedRoute();
runRoute = null;
const fallback = indexedRoute();
S = running({ wp_total: 3 });
const mismatch = indexedRoute();
S = running({ wp_total: 0 });
const noRun = indexedRoute();
check("8. indexedRoute prefers the route THIS PAGE installed, falls back to the drawn plan when the counts "
      + "agree, and answers null ONLY on a disagreement - not for every page loaded mid-run, which is what it "
      + "was reported as",
      () => pref && pref.length === 3 && fallback && fallback.length === 2
            && mismatch === null && noRun && noRun.length === 2,
      () => "runRoute->" + (pref || []).length + ", fallback->" + (fallback || []).length
            + ", mismatch->" + JSON.stringify(mismatch) + ", idle->" + (noRun || []).length);

// ── 9-10. adoptRunRoute: the integer compare, and the latch ───────────────────────────────────────
let served = null, fetches = 0;
global.fetch = function () {
  fetches++;
  return Promise.resolve({ json: () => Promise.resolve(served) });
};
const tick = () => { adoptRunRoute(); return new Promise(r => setTimeout(r, 0)); };

(async () => {
  const R3 = [{ lat: 1, lon: 1 }, { lat: 1.1, lon: 1 }, { lat: 1.2, lon: 1 }];

  runRoute = null; S = running({ wp_total: 3, run_seq: 7 }); mission.waypoints = [];
  served = { route: R3, wp_total: 3, staged: false, behavior: "survey" };
  await tick();
  check("9. a page with no route of its own, on a running boat, reads the one she is flying from the console - "
        + "and can place her again: the governor governs, and every line readout works",
        () => runRoute && runRoute.length === 3 && indexedRoute() === runRoute && govHeldBy() === null
              && notes.some(n => /Read the route she is flying/.test(n)),
        () => "runRoute=" + JSON.stringify(runRoute) + " why=" + JSON.stringify(govHeldBy()));

  for (const [name, bad] of [
    ["9b. ... and REFUSES a route of the wrong length - adopting it is the wrong water measured confidently, "
     + "which is the whole reason indexedRoute carries a length test",
     { route: R3, wp_total: 3, staged: false }],
    ["9c. ... and refuses one whose served wp_total disagrees with the frame's",
     { route: R3, wp_total: 9, staged: false }],
    ["9d. ... and refuses a STAGED plan, whose waypoints are not what her index counts into",
     { route: R3, wp_total: 4, staged: true }],
    ["9e. ... and refuses an empty answer rather than adopting nothing as something",
     { route: [], wp_total: 4, staged: false }],
  ]) {
    runRoute = null; adoptedSeq = null; adoptNextAt = 0;
    S = running({ wp_total: 4, run_seq: 11 });
    served = bad;
    await tick();
    check(name, () => runRoute === null, () => "runRoute=" + JSON.stringify(runRoute));
  }

  // 10. one try per commanded motion, latched on SUCCESS only
  runRoute = null; adoptedSeq = null; adoptNextAt = 0; fetches = 0;
  S = running({ wp_total: 3, run_seq: 21 });
  served = { route: R3, wp_total: 3, staged: false };
  await tick(); await tick(); await tick();
  const afterOk = fetches;
  check("10. one fetch per commanded motion, not one per frame: the page asks 4 times a second otherwise",
        () => afterOk === 1 && adoptedSeq === 21, () => afterOk + " fetches, adoptedSeq " + adoptedSeq);

  runRoute = null; adoptedSeq = null; adoptNextAt = 0; fetches = 0;
  S = running({ wp_total: 5, run_seq: 22 });
  served = { route: R3, wp_total: 3, staged: false };          // a refusal
  await tick();
  const f1 = fetches;
  await tick(); await tick();
  const f2 = fetches;
  check("10b. a fetch that fails or is refused is NOT latched - it would leave the page unable to place her "
        + "for the whole run - but it is not retried four times a second either: a cooldown, then again",
        () => f1 === 1 && f2 === 1 && adoptedSeq === null && adoptNextAt > 0,
        () => f1 + " then " + f2 + " fetches; adoptedSeq " + adoptedSeq + ", cooldown " + (adoptNextAt > 0));

  runRoute = null; adoptedSeq = null; adoptNextAt = 0; fetches = 0;
  SUPERVISES = false;
  S = running({ wp_total: 3, run_seq: 23 });
  served = { route: R3, wp_total: 3, staged: false };
  await tick();
  const ctrlFetches = fetches;
  SUPERVISES = true;
  check("10c. the controls window never asks - it holds no chart model, and the route is for the page that "
        + "runs the ladder",
        () => ctrlFetches === 0 && runRoute === null, () => ctrlFetches + " fetches from ?panel=controls");

  runRoute = null; adoptedSeq = null; adoptNextAt = 0; fetches = 0;
  for (const st of [running({ wp_total: 0, run_seq: 31 }), running({ run: "idle", wp_total: 3, run_seq: 32 }),
                    running({ run: "complete", wp_total: 3, run_seq: 33 })]) {
    S = st; await tick();
  }
  check("10d. and nothing is asked for a boat with no plan aboard, or one that is idle or finished",
        () => fetches === 0, () => fetches + " fetches with wp_total 0 / run idle / run complete");

  // ── 10e-10g. AN AMEND GOES STALE WITHOUT MOVING run_seq ─────────────────────────────────────────
  // Engine.amend keeps the run - that is its whole point - so run_seq does not move, but it splices the link's
  // array and changes wp_total. A route adopted before a deviation is then the WRONG LENGTH, and indexedRoute
  // does not length-test runRoute (only cardRoute and guardTrack do), so the governor would run on the stale
  // array. Found by an adversarial read of this fix, not by the fix.
  runRoute = null; adoptedSeq = null; adoptNextAt = 0; fetches = 0;
  S = running({ wp_total: 3, run_seq: 41 });
  served = { route: R3, wp_total: 3, staged: false };
  await tick();
  const adopted = runRoute;
  const R4 = R3.concat([{ lat: 1.3, lon: 1 }]);
  S = running({ wp_total: 4, run_seq: 41 });                 // an amend: wp_total moved, run_seq did NOT
  served = { route: R4, wp_total: 4, staged: false };
  await tick();
  check("10e. a route this page ADOPTED is re-adopted when an amend changes her waypoint count without moving "
        + "run_seq - otherwise the governor runs on the array she was flying before the deviation",
        () => adopted && adopted.length === 3 && runRoute && runRoute.length === 4 && fetches === 2,
        () => "adopted " + (adopted || []).length + " -> now " + (runRoute || []).length + " after " + fetches
              + " fetches");

  // but a route this page INSTALLED is its own, and a staged upload is legitimately a different length
  runRoute = [{ lat: 9, lon: 9 }]; adoptedSeq = null; adoptNextAt = 0; fetches = 0;
  S = running({ wp_total: 4, run_seq: 51 });
  served = { route: R4, wp_total: 4, staged: false };
  await tick();
  check("10f. ... and a route this page INSTALLED is never replaced on a length disagreement: its own staged "
        + "upload is legitimately a different length from what the vessel is counting into, and a deliberate "
        + "give-up is not an invitation to re-read",
        () => runRoute.length === 1 && fetches === 0,
        () => "runRoute " + runRoute.length + " after " + fetches + " fetches");

  runRoute = null; adoptedSeq = null; adoptNextAt = 0; fetches = 0;
  S = running({ wp_total: 3, run_seq: 61 });
  served = { route: R3, wp_total: 3, staged: false };
  await tick();
  const keep = runRoute;
  await tick(); await tick();
  check("10g. ... and an adopted route whose length still AGREES is left alone - the re-adopt is keyed on the "
        + "disagreement, not on having adopted at all, or it would fetch once a frame for ever",
        () => runRoute === keep && fetches === 1,
        () => "same array " + (runRoute === keep) + " after " + fetches + " fetches");

  // ⚠ 11 IS THE PRICE OF DECLARING THE THREE STATE VARIABLES HERE INSTEAD OF LIFTING THEM. A rename in the
  // page would leave the lifted adoptRunRoute creating fresh implicit globals, every check above would still
  // pass, and the page's own latching would be untested. One regex, against the page's real declaration.
  check("11. the page still declares adoptRunRoute's state as this suite does - a rename would give the "
        + "lifted function its own globals and leave checks 10 and 10b passing on nothing",
        () => /let adoptedSeq = null, adoptNextAt = 0, adoptBusy = false;/.test(H),
        () => (H.match(/let adopted[^\n]*/) || ["(no declaration found)"])[0]);

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})().catch(__crash);
