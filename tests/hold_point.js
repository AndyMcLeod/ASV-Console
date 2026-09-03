// tests/hold_point.js - WHERE a boat is asked to hold, and how much water it has there.
//
// The command-time half of the Eastport work. Andy, 2026-09-02: *"A vessel must consider
// what is ahead of it and modify trajectory or speed or FINAL TARGET to ENSURE nogo areas
// are never entered."* The run-time ladder (in_extremis.js) is the braces: it catches a boat
// being set onto a structure while it holds. This is the belt: the boat should not be ASKED
// to hold somewhere unsafe, and when it is set off a safe hold point it should not drive a
// blind bearing back.
//
// Two defects, both stated in the handoff and both fixed here:
//
//   1. THE HOLD POINT WAS WHATEVER THE PLAN ENDED WITH. A Go-To onto a pier, or a
//      Return-to-Home to a HOME set at a berth, was REFUSED - which arrived at the one moment
//      it was least useful, mid-mission on the chained RTH. The target is now a HOLD POINT:
//      moved to the nearest clear water in ANY direction (hold.js, a radial search - the
//      existing snapClearLL nudges along ONE axis, which is right for splitting a leg and
//      wrong for a hold), with the whole hold DISC clear, and the move is said out loud.
//   2. THE RE-APPROACH WAS A RAW BEARING. SimVcu's station-keep branch turned toward the
//      hold point and drove, with no keep-out check, from any range. It is now told, with
//      every holding command, how much water is certified clear round the hold point
//      (`hold_clear_m`); inside that disc a chord back to the centre is clear by
//      construction, beyond it the boat takes the way off and the console supplies a ROUTED
//      re-approach (reapproachIfSetOff -> /api/cmd/reapproach). The vessel side of that is
//      tests/hold_station.py; this file holds the geometry and the page wiring.
//
//   node tests/hold_point.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - mutations RUN against sidecar copies, and the checks that went red:
//   snapClearRadial searches ONE axis (degStep 180)                -> 3
//   the snap margin drops the hold radius (buf only)               -> 4
//   holdTarget ignores the snap and returns the operator's point   -> 7, 7b
//   holdClearM forgets to subtract the buffer                      -> 5
//   doGoTo commands the operator's point rather than the route end -> 9
//   the page never calls reapproachIfSetOff                        -> 12
//   reapproachIfSetOff loses its authority gate                    -> 11
//
// ⚠ PAGE CHECKS READ CODE, NOT COMMENTS. Every function grabbed from the page has its
// line comments stripped before a regex touches it - the self-matching trap has now been
// sprung three times in this repo (a check matching the comment that explained the fix).

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
const { bbOf } = require("../static/js/geometry.js");
const { planeFrame } = require("../static/js/geodesy.js");
const { blocked } = require("../static/js/keepouts.js");
const { snapClearLL } = require("../static/js/routing.js");
const H = require("../static/js/hold.js");
const S = require("../static/js/state.js");
const P = require("../static/js/passage.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? detail + " — " : "") + "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}
function grab(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = src.indexOf("{", start), depth = 0;
  for (;;) { const c = src[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return src.slice(start, k + 1);
}
// ⚠ BLOCK COMMENTS TOO. The first draft stripped only `//` lines, and a mutation that
// commented the onState call out as `/* reapproachIfSetOff(s, st); */` SURVIVED check 12 -
// the text was still there, inside a comment. Both forms go before a regex looks.
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "")
                           .replace(/^[^\n]*\/\/[^\n]*$/gm, (l) => l.replace(/\/\/.*$/, ""));

// A pier lying east-west from e=-400 to e=+400, its near face at n=30, 300 m deep.
function pierModel() {
  const r = [{ e: -400, n: 30 }, { e: 400, n: 30 }, { e: 400, n: 330 }, { e: -400, n: 330 }];
  return { polys: [{ ring: r, bb: bbOf(r), kind: "a dock / pier" }],
           lines: [], points: [], marks: [], sys: [], chans: [] };
}
const BUF = 5, HOLD_R = 2;
const KO = pierModel();

console.log("The hold point, and the water round it:");

// ── 1-6. THE GEOMETRY ──────────────────────────────────────────────────────────────
check("1. a point in clear water is its own hold point — nothing moves",
      () => { const r = H.snapClearRadial({ e: 0, n: -100 }, KO, BUF, HOLD_R);
              return r && r.moved === 0 && r.e === 0 && r.n === -100; },
      "moved 0");

{
  const r = H.snapClearRadial({ e: 0, n: 50 }, KO, BUF, HOLD_R);   // 20 m INSIDE the pier
  check("2. a point inside the pier is moved to the nearest clear water, off the near face",
        () => r && r.moved > 0 && r.n < 30 - (BUF + HOLD_R) && !blocked(r, KO, BUF + HOLD_R),
        r ? "to n=" + r.n.toFixed(1) + " (face at 30, margin " + (BUF + HOLD_R) + "), moved "
              + r.moved.toFixed(0) + " m" : "null");
}

{
  // Just inside the pier's EAST END: 2 m from the end face, 10 m from the near face. The
  // nearest clear water is EAST (2 + 7 = 9 m) and not SOUTH (10 + 7 = 17 m). A one-axis
  // nudge along north-south - what snapClearLL does - finds the further one.
  const p = { e: 398, n: 40 };
  const r = H.snapClearRadial(p, KO, BUF, HOLD_R);
  const frame = planeFrame({ lat: 44.9, lon: -66.98 });
  const ll = snapClearLL(frame.fromEN(p.e, p.n), frame, KO, BUF + HOLD_R, 0, 1);
  const llMoved = ll ? Math.hypot(frame.toEN(ll).e - p.e, frame.toEN(ll).n - p.n) : null;
  check("3. ANY DIRECTION: at the pier's end the nearest water is off the END, not the face — "
        + "and the one-axis nudge would have gone further",
        () => r && r.e > 400 && Math.abs(r.n - 40) < 6 && r.brg >= 60 && r.brg <= 120
              && llMoved != null && r.moved < llMoved,
        r ? "radial " + r.moved.toFixed(0) + " m on " + r.brg + "°; north-south nudge "
              + (llMoved != null ? llMoved.toFixed(0) + " m" : "refused") : "null");
}

{
  // THE WHOLE DISC IS CLEAR, not just the centre. The boat wanders the hold radius before it
  // re-approaches, so a hold point clear only at its centre alarms the moment the tide moves.
  const r = H.snapClearRadial({ e: 0, n: 50 }, KO, BUF, HOLD_R);
  let bad = 0;
  for (let a = 0; a < 360; a += 10) {
    const q = { e: r.e + HOLD_R * Math.sin(a * Math.PI / 180), n: r.n + HOLD_R * Math.cos(a * Math.PI / 180) };
    if (blocked(q, KO, BUF)) bad++;
  }
  check("4. the whole hold DISC round the snapped point is clear at the operator's buffer",
        () => bad === 0 && r.n <= 30 - (BUF + HOLD_R) + 1e-9,
        bad + " of 36 points on the hold circle blocked; centre " + (30 - r.n).toFixed(1) + " m off the face");
}

check("5. holdClearM is the water round a point LESS the buffer: 12 m off the face is 7 m of "
      + "certified water, inside is none, open water is the cap less the buffer",
      () => Math.abs(H.holdClearM({ e: 0, n: 18 }, KO, BUF) - 7) < 1e-6
            && H.holdClearM({ e: 0, n: 100 }, KO, BUF) === 0
            && H.holdClearM({ e: 0, n: -5000 }, KO, BUF) === 500 - BUF,
      "7 / 0 / 495");

{
  // Boxed in: a keep-out square 400 m to every side - beyond the search cap.
  const r = [{ e: -400, n: -400 }, { e: 400, n: -400 }, { e: 400, n: 400 }, { e: -400, n: 400 }];
  const box = { polys: [{ ring: r, bb: bbOf(r), kind: "land" }], lines: [], points: [], marks: [], sys: [], chans: [] };
  check("6. no clear water within the cap is a REFUSAL (null), not the least-bad point",
        () => H.snapClearRadial({ e: 0, n: 0 }, box, BUF, HOLD_R) === null,
        "cap " + H.snapCapM(BUF) + " m, nearest water 400 m");
}

// ── 7-8. THE PLANNER: the target is a hold point ───────────────────────────────────
{
  const frame = planeFrame({ lat: 44.9, lon: -66.98 });
  S.nogo.ready = true; S.nogo.frame = frame; S.nogo.ko = KO; S.nogo.buffer = BUF;
  const from = frame.fromEN(0, -300);
  const onPier = frame.fromEN(0, 50);
  const plan = P.planNogoRoute(from, onPier, { holdR: HOLD_R });
  const end = plan.route ? frame.toEN(plan.route[plan.route.length - 1]) : null;
  check("7. a Go-To onto the pier is not refused: the route ends at the nearest clear water and "
        + "says what the point sat in and how far off it the boat will hold",
        () => !plan.error && plan.heldOff && plan.heldOff.kind === "a dock / pier"
              && plan.heldOff.m > 0 && end && !blocked(end, KO, BUF + HOLD_R)
              && Math.abs(end.e) < 1 && end.n < 30 - (BUF + HOLD_R),
        plan.error ? plan.error : "route ends " + (end ? (30 - end.n).toFixed(1) : "?")
              + " m off the face, heldOff " + (plan.heldOff ? plan.heldOff.m.toFixed(0) + " m" : "none"));
  check("7b. ... and the plan carries the certified clear disc for the vessel",
        () => plan.holdClear != null && plan.holdClear >= HOLD_R - 1e-9 && plan.holdClear < 50,
        "holdClear " + (plan.holdClear != null ? plan.holdClear.toFixed(1) : "none") + " m");
  const clear = P.planNogoRoute(from, frame.fromEN(0, -50), { holdR: HOLD_R });
  const cend = clear.route ? frame.toEN(clear.route[clear.route.length - 1]) : null;
  check("8. a target in clear water is left EXACTLY where the operator put it",
        () => !clear.error && !clear.heldOff && cend && Math.abs(cend.e) < 1e-6 && Math.abs(cend.n + 50) < 1e-6
              && Math.abs(clear.holdClear - (80 - BUF)) < 1e-6,
        "heldOff " + (clear.heldOff ? "SET" : "null") + ", holdClear " + (clear.holdClear != null ? clear.holdClear.toFixed(1) : "?"));
  const r = [{ e: -400, n: -400 }, { e: 400, n: -400 }, { e: 400, n: 400 }, { e: -400, n: 400 }];
  S.nogo.ko = { polys: [{ ring: r, bb: bbOf(r), kind: "land" }], lines: [], points: [], marks: [], sys: [], chans: [] };
  const boxed = P.holdTarget(frame.fromEN(0, 0), { holdR: HOLD_R });
  check("8b. boxed in, the refusal remains and names the search cap",
        () => boxed.error && /no clear water within \d+ m/.test(boxed.error) && boxed.reason.mode === "target",
        boxed.error || "no error");
  S.nogo.ko = KO;
}

// ── 9-14. THE PAGE WIRING ──────────────────────────────────────────────────────────
{
  const PAGE = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");
  const goTo = noComments(grab(PAGE, "doGoTo"));
  const rth = noComments(grab(PAGE, "doRTH"));
  const tran = noComments(grab(PAGE, "doTransit"));
  const guard = noComments(grab(PAGE, "clearanceGuard"));
  const re = noComments(grab(PAGE, "reapproachIfSetOff"));
  const onState = noComments(grab(PAGE, "onState"));
  const act = noComments(grab(PAGE, "currentActivity"));
  const hr = noComments(grab(PAGE, "holdRadiusM"));

  check("9. Go-To commands the ROUTE'S END - the hold point - not the operator's point, and "
        + "sends the certified disc with it",
        () => /const hp = plan\.route\[plan\.route\.length-1\]/.test(goTo)
              && /cmd\("\/api\/cmd\/goto", \{lat:hp\.lat, lon:hp\.lon, route:plan\.route, hold_clear_m:plan\.holdClear\}\)/.test(goTo)
              && !/\{lat:target\.lat, lon:target\.lon, route/.test(goTo)
              && /planNogoRoute\([^)]*\{holdR: holdRadiusM\(\)\}\)/.test(goTo),
        "a Go-To that names the pier as its target would hold ON the pier");
  check("9b. ... and RTH, Transit, Hold and the guard's hold rung all send it too",
        () => /cmd\("\/api\/cmd\/rth", \{route:plan\.route, hold_clear_m:plan\.holdClear\}\)/.test(rth)
              && /holdTarget\(transit\[transit\.length-1\], \{holdR: holdRadiusM\(\)\}\)/.test(tran)
              && /cmd\("\/api\/cmd\/transit", \{route: plan\.route, hold_clear_m: plan\.holdClear\}\)/.test(tran)
              && /cmd\("\/api\/cmd\/hold", \{hold_clear_m: holdClearAt\(asv\)\}\)/.test(guard)
              && /cmd\("\/api\/cmd\/hold", \{hold_clear_m: holdClearAt\(asv\)\}\)/.test(noComments(PAGE.slice(PAGE.indexOf('$("#b_hold").onclick'), PAGE.indexOf('$("#b_hold").onclick') + 300))),
        "every holding command tells the vessel how much water it has");
  check("10. the hold radius is the vessel model's own floor, never below it",
        () => /Math\.max\(HOLD_RADIUS_MIN_M, \+\(mission\.approach_radius_m\) \|\| 0\)/.test(hr)
              && Math.abs(H.HOLD_RADIUS_MIN_M - 2.0) < 1e-9,
        "SimVcu holds within max(approach, 2.0); the client's disc must be the same disc");
  check("11. the routed re-approach fires only with authority, only when the vessel ASKS, and "
        + "never under a moving home or a pending end-of-plan RTH",
        () => /st\.hold_wants_route/.test(re) && /s\.armed && !s\.estop/.test(re)
              && /s\.home_following/.test(re) && /rthPending\(\)/.test(re)
              && /cmd\("\/api\/cmd\/reapproach", \{route: plan\.route, hold_clear_m: plan\.holdClear\}\)/.test(re)
              && /planNogoRoute\(/.test(re),
        "a re-approach sent to a boat the operator is driving is a control the console was never given");
  check("11b. ... one in flight at a time, with a floor between them",
        () => /reapproachBusy/.test(re) && /REAPPROACH_MIN_MS/.test(re) && /finally \{ reapproachBusy = false; \}/.test(re),
        "the tide sets a tight hold off every few seconds; each re-approach is a real command");
  check("11c. ... and a refused route back is SAID, with the boat left where it is",
        () => /NO clear route back/.test(re) && /plan\.error/.test(re),
        "silence would read as a re-approach in progress");
  check("12. and it is actually CALLED from onState, on every frame — as a statement of its "
        + "own, not text inside a comment",
        () => /^\s*reapproachIfSetOff\(s, st\);/m.test(onState),
        "a re-approach nothing calls leaves the boat with the way off, for ever");
  check("13. the cards say when the boat is set beyond the certified water",
        () => /hold_wants_route/.test(act) && /off_station_m/.test(act)
              && /SET OFF STATION/.test(noComments(grab(PAGE, "updateMissionCard"))),
        "a boat that has taken the way off must not read as 'station-keeping'");
  check("14. the reasoning is captured WITH the plan: a moved hold point is a 'why'",
        () => /plan\.heldOff/.test(noComments(grab(PAGE, "setPlanIntent")))
              && /holding "[\s\S]{0,80} off it, at the nearest clear water/.test(grab(PAGE, "setPlanIntent")),
        "the operator picked a point they can see; the boat stops somewhere else");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
