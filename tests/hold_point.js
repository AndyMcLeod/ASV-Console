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

// ── 6b-6e. THE WORKING MARGIN. "Not blocked" was the old test for a hold point and it is
// not enough: Eastport's HOME passed it with 1.47 m of clear water and the boat drove there
// at 6.07 kn (measured, session 20260903-170505). The margin a berth needs is the water the
// SET moves the boat through while the guard is deciding - the ladder's own HOLD_S budget -
// floored at hull scale so a dead calm is not authority to park against a wall.
{
  const G = require("../static/js/guard.js");
  check("6b. the margin is the ladder's own decision budget spent at the present set, floored "
        + "at hull scale - not a taste",
        () => Math.abs(H.holdMarginM(0) - H.HOLD_MARGIN_MIN_M) < 1e-9
              && Math.abs(H.holdMarginM(1.0) - 1.0 * G.HOLD_S) < 1e-9
              && H.holdMarginM(0.17) === H.HOLD_MARGIN_MIN_M,
        "calm " + H.holdMarginM(0) + " m; 1 m/s of set -> " + H.holdMarginM(1.0)
          + " m (HOLD_S=" + G.HOLD_S + " s); Eastport's 0.33 kn is under the floor");

  // THE REPORTED CASE, to the metre: a pier face 6.5 m off gives 1.5 m of clear water at a
  // 5 m buffer - what HOME actually had. It is not blocked. It must still be refused as a
  // place to leave a boat.
  const face = [{ e: -400, n: 6.5 }, { e: 400, n: 6.5 }, { e: 400, n: 306 }, { e: -400, n: 306 }];
  const EAST = { polys: [{ ring: face, bb: bbOf(face), kind: "a dock / pier" }],
                 lines: [], points: [], marks: [], sys: [], chans: [] };
  const need = H.holdMarginM(0.33 * 0.514444);
  const sn = H.snapClearRadial({ e: 0, n: 0 }, EAST, BUF, HOLD_R, { need });
  check("6c. EASTPORT: a point that is NOT blocked but has 1.5 m of clear water is still "
        + "moved - the old test passed it and the boat hit the pier",
        () => !blocked({ e: 0, n: 0 }, EAST, BUF)          // genuinely not blocked
              && sn && sn.moved > 0 && sn.clr - BUF >= need - 1e-9,
        sn ? "1.5 m -> moved " + sn.moved.toFixed(1) + " m on brg " + sn.brg + ", now "
             + (sn.clr - BUF).toFixed(2) + " m clear (needs " + need.toFixed(1) + ")" : "null");

  // ⚠ 6c ON ITS OWN DOES NOT ISOLATE THE MARGIN RULE, and a mutation proved it: Eastport's
  // 1.5 m fails BOTH the old test (blocked at buf+holdR) and the new one, so collapsing the
  // rule back to "not blocked" still relocated that point and 6c stayed green. The rules
  // only disagree in the BAND between them - clear water above `buf+holdR` but under the
  // working margin - so that band is where the check has to stand.
  const band = [{ e: -400, n: 9 }, { e: 400, n: 9 }, { e: 400, n: 309 }, { e: -400, n: 309 }];
  const BAND = { polys: [{ ring: band, bb: bbOf(band), kind: "a dock / pier" }],
                 lines: [], points: [], marks: [], sys: [], chans: [] };
  const bandSn = H.snapClearRadial({ e: 0, n: 0 }, BAND, BUF, HOLD_R, { need });
  check("6c2. ... so: 4 m of clear water passes 'not blocked' at every margin the old rule "
        + "used, and is STILL moved, because 4 m is not room to hold a boat",
        () => !blocked({ e: 0, n: 0 }, BAND, BUF + HOLD_R)   // the old rule says fine
              && bandSn && bandSn.moved > 0                  // the new one moves it anyway
              && bandSn.clr - BUF >= need - 1e-9,
        bandSn ? "4 m clear -> moved " + bandSn.moved.toFixed(1) + " m, now "
                 + (bandSn.clr - BUF).toFixed(2) + " m (needs " + need.toFixed(1) + ")" : "null");
  check("6d. ... and it moves AWAY from the pier, never along the face into the same trouble",
        () => sn && sn.n < 0 && sn.brg > 90 && sn.brg < 270,
        sn ? "brg " + sn.brg + ", n=" + sn.n.toFixed(1) + " (pier face at n=6.5)" : "null");
  check("6e. a berth with room to spare is left EXACTLY where the operator put it",
        () => { const far = H.snapClearRadial({ e: 0, n: -80 }, EAST, BUF, HOLD_R, { need });
                return far && far.moved === 0 && far.e === 0 && far.n === -80; },
        "no gratuitous relocation of a point that was already fine");

  // ⚠⚠ 6g IS THE CHECK THAT WAS MISSING, AND ITS ABSENCE IS THE WHOLE INCIDENT. Everything
  // above drives snapClearRadial directly - but the reason Eastport's HOME was used as it
  // stood is that it never REACHED snapClearRadial: holdTarget gated the whole relocation on
  // `blockedInfo(en, ko, buf)`, the BARE buffer. HOME's clearance was 6.5 m against a 5 m
  // buffer, so it was "not blocked", so nothing was consulted and 1.47 m of clear water went
  // to the vessel as a hold point. A check that skips the gate cannot see the gate.
  const frame = planeFrame({ lat: 44.9, lon: -66.98 });
  S.nogo.ready = true; S.nogo.frame = frame; S.nogo.ko = EAST; S.nogo.buffer = BUF;
  const ht = P.holdTarget(frame.fromEN(0, 0), { holdR: HOLD_R });
  const htEn = ht.to ? frame.toEN(ht.to) : null;
  check("6g. THE GATE: holdTarget itself moves a point that is clear of the BARE buffer but "
        + "has no room to hold in - the exact way Eastport's HOME reached the vessel",
        () => !blocked({ e: 0, n: 0 }, EAST, BUF)      // the old gate said "fine, use it"
              && !ht.error && ht.heldOff && ht.heldOff.tight === true
              && htEn && htEn.n < 0 && ht.holdClear >= ht.need - 1e-9,
        ht.error ? ht.error
                 : "moved " + (ht.heldOff ? ht.heldOff.m.toFixed(1) : "0") + " m; holdClear "
                   + (ht.holdClear != null ? ht.holdClear.toFixed(2) : "?") + " m, needs "
                   + (ht.need != null ? ht.need.toFixed(1) : "?"));
  check("6h. ... and it says WHICH reason, because 'it is in the pier' and 'there is no room "
        + "to sit there' are different sentences to an operator",
        () => ht.heldOff && ht.heldOff.tight === true && /too tight/.test(ht.heldOff.kind),
        ht.heldOff ? ht.heldOff.kind : "no heldOff");
  S.nogo.ko = KO;
}

// ── 6f. DOWN-SET, WHERE THE GEOMETRY ALLOWS A CHOICE. Two equally-near berths, one either
// side of a pile: take the one the set carries the boat AWAY from the hazard from, so the
// station-keeping correction is made heading INTO the set - the direction a boat can stop
// in. A preference, never a rule: it is scaled by `need` so it cannot buy a tighter berth.
{
  const pile = { polys: [], lines: [],
                 points: [{ e: 0, n: 0, r: 3, kind: "a pile" }], marks: [], sys: [], chans: [] };
  const need = H.HOLD_MARGIN_MIN_M;
  const setMs = 1.0;
  const east = H.snapClearRadial({ e: 0, n: 0 }, pile, BUF, HOLD_R, { need, setE: setMs, setN: 0 });
  const west = H.snapClearRadial({ e: 0, n: 0 }, pile, BUF, HOLD_R, { need, setE: -setMs, setN: 0 });
  check("6f. the set decides WHICH equally-good berth: down-set of the pile, so the drift "
        + "carries the boat off it and the correction is made into the set",
        () => east && west && east.e > 0 && west.e < 0,
        east && west ? "set east -> brg " + east.brg + " (e=" + east.e.toFixed(1)
                       + "); set west -> brg " + west.brg + " (e=" + west.e.toFixed(1) + ")" : "null");
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
        () => boxed.error && /nowhere within \d+ m/.test(boxed.error) && boxed.reason.mode === "target",
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
              && /planNogoRoute\([^)]*holdOpts\(\)\)/.test(goTo),
        "a Go-To that names the pier as its target would hold ON the pier");
  check("9b. ... and RTH, Transit, Hold and the guard's hold rung all send it too",
        () => /cmd\("\/api\/cmd\/rth", \{route:plan\.route, hold_clear_m:plan\.holdClear\}\)/.test(rth)
              && /holdTarget\(transit\[transit\.length-1\], holdOpts\(\)\)/.test(tran)
              && /cmd\("\/api\/cmd\/transit", \{route: plan\.route, hold_clear_m: plan\.holdClear\}\)/.test(tran)
              && /cmd\("\/api\/cmd\/hold", \{hold_clear_m: holdClearAt\(asv\)\}\)/.test(guard)
              && /cmd\("\/api\/cmd\/hold", \{hold_clear_m: holdClearAt\(asv\)\}\)/.test(noComments(PAGE.slice(PAGE.indexOf('$("#b_hold").onclick'), PAGE.indexOf('$("#b_hold").onclick') + 300))),
        "every holding command tells the vessel how much water it has");
  // 9c. EVERY hold point is chosen against the SAME water. Four call sites reach the
  // planner; if one of them forgets the set, a berth commanded from that button is sized by
  // a different rule than the others - and the one that forgets is the one that hits a pier.
  check("9c. all four hold-point call sites go through the one set-aware definition, and it "
        + "reads the LIVE set rather than assuming calm",
        () => (noComments(PAGE).match(/holdOpts\(\)/g) || []).length >= 5   // 4 call sites + the definition
              && /setMs:\s*\(st\.env_set_kn \|\| 0\) \* 0\.514444/.test(noComments(grab(PAGE, "holdOpts")))
              && /setDeg:\s*st\.env_set_deg/.test(noComments(grab(PAGE, "holdOpts"))),
        "the margin a berth needs is the set's, so the set has to reach the planner");
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
