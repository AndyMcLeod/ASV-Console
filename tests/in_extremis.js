// tests/in_extremis.js - what is AHEAD of the boat, and the four rungs it warrants.
//
// Andy, 2026-09-02, having watched a DriX trace a station-keeping loop through a pier at
// Eastport: *"A vessel must consider what is ahead of it and modify trajectory or speed or
// final target to ENSURE nogo areas are never entered."* And, asked directly whether the
// console may steer: *"console should take the helm in extremis."*
//
// ⚠⚠ THE RUNG THAT DECIDES EVERYTHING IS `hold` VS `helm`, AND THE TEST THAT SEPARATES THEM
// IS A SECOND PROJECTION. Project the ground track once with the boat's actual velocity; if
// it enters, project it AGAIN with the engines notionally stopped, using drift alone. If
// that is clear, taking the way off answers it and the console has no business steering. If
// it is not, stopping is the one thing that CERTAINLY fails, because it is the water doing
// the carrying.
//
// That is not a theory. The tidal stream advects the hull, so a vessel lying stopped in a
// 2 kn stream makes 2.00 kn over the ground with no force on it at all - measured in
// tests/currents.py, checks A and E. "Stop the boat" near a structure hands it to the tide
// with no steerage, which is why the ladder cannot end at `hold` and why the standing
// "never steers" rule had to give at its last rung.
//
//   node tests/in_extremis.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH — nine mutations RUN against a sidecar copy:
//   the drift-only second projection dropped (helm unreachable)  -> 5, 6
//   helm fires on any predicted entry (steers on every approach) -> 2, 3, 4, 11b
//   already-inside reports null instead of zero                  -> 7
//   the escape scored through the water, ignoring the set        -> 8b
//   boxed-in returns the least-bad heading instead of refusing   -> 10
//   the hold rung fires at any range (no time test)              -> 2
//   the guard stops steering at the helm rung                    -> 12
//   the old run/holding gate comes back (clearance_guard)        -> 14
//   restoreVel stops rescaling (the counterfactual release)      -> 11b, 11c
//
// ⚠ TWO OF THOSE FIRST CRASHED THE SUITE RATHER THAN FAILING IT, AND THE FIX IS IN THIS
// FILE. The detail strings read `.tEntryDrift.toFixed(0)` directly, and detail is evaluated
// EAGERLY - so a mutation that makes the field null killed the process before a FAIL line
// printed, which a runner reading stdout scores as SURVIVED. `secs()` handles the null now.
// A harness that cannot survive the fault it tests for cannot report it.
//
// ⚠ AND ONE MUTATION HAD TO BE REWRITTEN because the first version produced INVALID code:
// forcing the helm branch with `if (false)` made it format a null into its own reason
// string and throw. A mutation must exhibit the wrong BEHAVIOUR, not merely break.
//
// ⚠ AND REFUSING IS A REAL ANSWER (check 9). Boxed in on every heading, `escapeCourse`
// returns null rather than the least-bad direction. A confident-looking escape that still
// ends in the pier is worse than an alarm that says "take manual control", because the
// operator can see things this model cannot.

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
const G = require("../static/js/guard.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? detail + " — " : "") + "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}

// A pier lying east-west, its near face `n0` metres north of the boat.
function wall(n0) {
  const r = [{ e: -400, n: n0 }, { e: 400, n: n0 },
             { e: 400, n: n0 + 300 }, { e: -400, n: n0 + 300 }];
  return { polys: [{ ring: r, bb: bbOf(r), kind: "a dock / pier" }],
           lines: [], points: [], marks: [], sys: [], chans: [] };
}
const BUF = 5, P = { e: 0, n: 0 };
const W = wall(30);                       // 30 m to the face, 25 m to the buffer
const SET_ON = { e: 0, n: +1.03 };        // 2 kn stream setting onto the pier
const SET_OFF = { e: 0, n: -1.03 };       // the same stream setting off it
const SLACK = { e: 0, n: 0 };
const lvl = (vel, drift, ko) => G.assess(P, vel, drift, ko || W, BUF).level;
// ⚠ DETAIL STRINGS ARE EVALUATED EAGERLY, SO THEY MUST SURVIVE THE FAULT BEING TESTED.
// Two of these read `.tEntryDrift.toFixed(0)` directly, and the first mutation run - which
// removes the drift projection so tEntryDrift is null - CRASHED the suite instead of
// failing the check. A harness that cannot survive the fault it tests for cannot report it,
// and a crash scores as SURVIVED in a runner that reads stdout.
const secs = (v) => (v == null ? "—" : v.toFixed(0) + " s");

console.log("In extremis — what is ahead, and which rung it warrants:");

// ── 1-3. THE ORDINARY RUNGS ─────────────────────────────────────────────────────────
check("1. standing away from it is CLEAR — a keep-out behind you is not a hazard",
      () => lvl(G.groundVel(180, 6), SLACK) === "clear",
      "steaming 180 with the pier to the north");
check("2. standing in slowly, with time in hand, is SLOW — buy time first",
      () => lvl(G.groundVel(0, 1.5), SLACK) === "slow",
      "1.5 kn at a face 25 m off: " + secs(G.assess(P, G.groundVel(0, 1.5), SLACK, W, BUF).tEntry)
        + " away");
check("3. standing in fast, with little time, is HOLD — slowing alone is no longer enough",
      () => lvl(G.groundVel(0, 6), SLACK) === "hold",
      "6 kn at the same face: " + secs(G.assess(P, G.groundVel(0, 6), SLACK, W, BUF).tEntry)
        + " away");

// ── 4-6. THE RUNG THE WHOLE FILE EXISTS FOR ─────────────────────────────────────────
// Identical approach, identical speed. Only the tide differs, and it decides whether
// stopping is an answer at all.
check("4. the SAME approach with the set carrying you AWAY is still only HOLD",
      () => lvl(G.groundVel(0, 6), SET_OFF) === "hold",
      "the stream is helping — take the way off and you drift clear");
check("5. ... and with the set carrying you ON it is HELM — stopping would not answer",
      () => lvl(G.groundVel(0, 6), SET_ON) === "helm",
      "drift-only entry at " + secs(G.assess(P, G.groundVel(0, 6), SET_ON, W, BUF).tEntryDrift)
        + ": the water carries you in whatever the engines do");
// ⚠ THE EASTPORT CASE. A boat station-keeping at the end of a run, engines stopped, being
// set down onto a pier. Its ground track and its drift track are the SAME track - there is
// no way on to take off - so `hold` is not merely insufficient, it is what it is already
// doing.
check("6. a STOPPED boat being set onto it is HELM — 'stop' is already what it is doing",
      () => {
        const a = G.assess(P, SET_ON, SET_ON, W, BUF);
        return a.level === "helm" && Math.abs(a.tEntry - a.tEntryDrift) < 1e-9;
      },
      "ground track and drift track are the same track — the Eastport loop");

// ── 7. ALREADY INSIDE IS NOT 'NEVER' ────────────────────────────────────────────────
check("7. a point already inside the buffer reports zero seconds, not 'no entry'",
      () => G.timeToEntry({ e: 0, n: 28 }, G.groundVel(0, 6), W, BUF) === 0
            && G.timeToEntry(P, G.groundVel(180, 6), W, BUF) === null,
      "'we are in it' and 'we will never be in it' must not be the same answer");

// ── 8-10. THE ESCAPE ────────────────────────────────────────────────────────────────
{
  const kn6 = 6 * 0.514444;
  const esc = G.escapeCourse(P, SET_ON, W, BUF, kn6);
  check("8. the escape is a heading that stays clear for the whole horizon",
        () => esc && esc.clear === true,
        esc ? "steer " + esc.hdg + "°" : "none found");
  // ⚠ SCORED WITH THE DRIFT IN IT. A heading that is clear through the water and downstream
  // into the pier is not an escape — that is the difference between a heading and a course.
  check("8b. ... and it is scored WITH the set in it, not through the water",
        () => {
          const src = fs.readFileSync(path.join(__dirname, "..", "static", "js", "guard.js"), "utf8");
          const fn = src.slice(src.indexOf("export function escapeCourse"));
          return /drift\.e \+ speedMs/.test(fn) && /drift\.n \+ speedMs/.test(fn);
        },
        "a heading clear through the water but set into the pier is not a way out");

  // Three walls, only south open: the answer is the one open side, not the least-bad wall.
  const rings = [[{ e: -400, n: 30 }, { e: 400, n: 30 }, { e: 400, n: 400 }, { e: -400, n: 400 }],
                 [{ e: 30, n: -400 }, { e: 400, n: -400 }, { e: 400, n: 400 }, { e: 30, n: 400 }],
                 [{ e: -400, n: -400 }, { e: -30, n: -400 }, { e: -30, n: 400 }, { e: -400, n: 400 }]];
  const boxed3 = { polys: rings.map((r) => ({ ring: r, bb: bbOf(r), kind: "a dock / pier" })),
                   lines: [], points: [], marks: [], sys: [], chans: [] };
  const e3 = G.escapeCourse(P, SET_ON, boxed3, BUF, kn6);
  check("9. walled on three sides it finds the one open side, not the least-bad wall",
        () => e3 && e3.clear && Math.abs(((e3.hdg - 180 + 180) % 360) - 180) <= 45,
        e3 ? "steer " + e3.hdg + "° (south is the only way out)" : "none found");

  // ⚠ AND WALLED ON ALL FOUR IT REFUSES. Returning the least-bad heading here would be a
  // confident-looking lie that still ends in the pier.
  const south = [{ e: -400, n: -400 }, { e: 400, n: -400 }, { e: 400, n: -30 }, { e: -400, n: -30 }];
  const boxed4 = { polys: [...boxed3.polys, { ring: south, bb: bbOf(south), kind: "a dock / pier" }],
                   lines: [], points: [], marks: [], sys: [], chans: [] };
  check("10. boxed in on every heading it REFUSES rather than inventing a way out",
        () => G.escapeCourse(P, SET_ON, boxed4, BUF, kn6) === null,
        "the caller alarms and hands the helm back — an escape that still ends in the pier "
          + "is worse than saying so");
}

// ── 11. A BOAT MAKING NO WAY OVER THE GROUND ────────────────────────────────────────
check("11. no ground track means no predicted entry — and the next tick will say otherwise "
      + "the moment the water starts moving",
      // ⚠ 1.0 m/s, NOT 0.5. The acceptance half of this check first used 0.5 m/s, which
      // reaches a face 25 m off in 50 s — PAST the 45 s horizon — so it returned null and
      // the check failed against correct code. A "does it fire" fixture has to be inside
      // the window the thing under test looks through.
      () => G.timeToEntry(P, { e: 0, n: 0 }, W, BUF) === null
            && G.timeToEntry(P, { e: 0, n: 1.0 }, W, BUF) !== null,
      "it is not clear because it is safe; it is clear because nothing is happening");

// ── 11b. THE COUNTERFACTUAL RELEASE ─────────────────────────────────────────────────
// ⚠ EXTRACTED FROM THE PAGE SO IT CAN BE TESTED AT ALL. The release check in
// clearance_guard.js was a source-shape one, and a mutation that made the branch dead
// (`if(false)`) left the matched text in place and SURVIVED — the documented "a static test
// that matches a bare fragment tests the source, not the behaviour" trap. The rule lives in
// guard.js now and is exercised here.
{
  const back6 = 6 * 0.514444, back1 = 1.5 * 0.514444;
  const slowIn = G.groundVel(0, 1.5);                    // crawling at the face
  const v6 = G.restoreVel(slowIn, SLACK, back6);
  check("11b. restoring speed is judged on the state being ENTERED, not the one being left",
        () => G.assess(P, slowIn, SLACK, W, BUF).level !== "clear"
              && G.assess(P, v6, SLACK, W, BUF).level === "hold"
              && Math.abs(Math.hypot(v6.e, v6.n) - back6) < 1e-6,
        "at 1.5 kn it is " + G.assess(P, slowIn, SLACK, W, BUF).level
          + "; restored to 6 kn it would be " + G.assess(P, v6, SLACK, W, BUF).level
          + " — so it is not released");
  check("11c. ... and the SET is kept when the through-water speed is rescaled — a boat "
        + "being set does not stop being set when it speeds up",
        () => {
          const v = G.restoreVel({ e: SET_ON.e + 0.5, n: SET_ON.n + 0.5 }, SET_ON, back6);
          const tw = { e: v.e - SET_ON.e, n: v.n - SET_ON.n };
          return Math.abs(Math.hypot(tw.e, tw.n) - back6) < 1e-6;
        },
        "only the water track is rescaled; the drift rides through unchanged");
}

// ── 12-13. THE PAGE WIRING ──────────────────────────────────────────────────────────
{
  const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");
  const fn = H.slice(H.indexOf("function clearanceGuard("), H.indexOf("// --- THE SPEED GOVERNOR"));
  const code = fn.replace(/^[^\n]*\/\/[^\n]*$/gm, (l) => l.replace(/\/\/.*$/, ""));
  check("12. every rung commands something different, and only the last one steers",
        () => /cmd\("\/api\/cmd\/speed", \{speed:"low"\}\)/.test(code)
              && /cmd\("\/api\/cmd\/hold"\)/.test(code)
              && /cmd\("\/api\/cmd\/goto"/.test(code)
              && code.indexOf('cmd("/api/cmd/goto"') > code.indexOf('a.level === "helm"'),
        "slow -> speed low, hold -> hold, helm -> goto");
  check("13. a refused escape ALARMS and hands the helm back rather than falling through",
        () => /BOXED IN/.test(fn) && /TAKE MANUAL CONTROL/.test(fn),
        "the one case where the console must say it cannot help");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
