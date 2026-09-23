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
// TEETH, 2026-09-19 - THE RUNG'S SELECTION TEST (Andy: *"reach versus danger, no dwell, no
// margin, and a cause the banner asserts that the code hasn't established"*). Ten more
// mutations, run against sidecar copies of guard.js and the page with all the guard suites
// re-run each time. NOTHING SURVIVED and nothing crashed. The five that land here:
//   HELM_S back to the full 45 s look-ahead (the old REACH)      -> 5
//   HELM_ENTRY_FRAC back to the whole buffer (the old MARGIN)    -> 5c
//   the stricter drift test dropped entirely (the old rung)      -> 5, 5c
//   the canStop exemption dropped (a stopped boat judged alike)  -> 6, 6b
//   the helm `why` reverted to asserting a set                   -> 6b
// The other five are on the page and red in tests/clearance_guard.js: the dwell unwired
// -> 15r,15t; helmSettled always true -> 15r,15t; the dwell accumulating instead of
// restarting -> 15t; the dwell gagging the ALARM as well as the action -> 15r; the banner
// asserting a set again -> 16c.
//
// ⚠⚠ AND TWO OF THEM FOUND HOLES IN THIS FILE RATHER THAN IN THE CODE. 5c's first draft
// PASSED with the margin widened straight back to the defect it exists for: its "outside"
// case read `clear` for a reason that had nothing to do with the margin, because the
// under-way projection STEPPED OVER the closest approach - 0.92 m per step past a track
// shaving the buffer by 2 mm - so tEntry was null and `assess` returned before the drift
// tests were reached at all. It now separates the two tracks and asserts the rung was
// REACHED in both cases. And the third mutation first CRASHED guard.js instead of failing
// it, by formatting a null into the helm reason; that is guarded there now, by the same
// rule the detail strings in this file already follow.
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
// ⚠⚠ CHECK 5 USED TO READ "...with the set carrying you ON it is HELM" ON THIS VERY
// FIXTURE, AND IT NOW READS HOLD (2026-09-19). That is the change Andy asked for, not a
// regression: *"reach versus danger... firing on a 1 cm clip is not danger."* The old rung
// fired on the mere EXISTENCE of a drift entry inside the 45 s look-ahead, so its trigger
// distance was exactly `buf + 45 s x |set|` - 45.5 m at the strongest set in his own record,
// against a planner that clips plans to the buffer within centimetres. Here the boat is
// 30 m off a pier face with 2 kn setting it on: stopping does not PREVENT contact, but it
// postpones it by 27 s, and 27 s is more than the decision margin this console has always
// used (HOLD_S). So the ladder holds, alarms, and escalates if it keeps closing - which is
// what every other rung on it does. 5b is that escalation, on the same fixture and the same
// set, and the two together are the boundary rather than one side of it.
check("5. the set carrying you ON, with time still in hand, is HOLD — stopping postpones it by longer than a decision needs",
      () => lvl(G.groundVel(0, 6), SET_ON) === "hold",
      "30 m off, 2 kn setting on: drift-only entry at "
        + secs(G.assess(P, G.groundVel(0, 6), SET_ON, W, BUF).tEntryDrift)
        + ", and within half the buffer at "
        + secs(G.assess(P, G.groundVel(0, 6), SET_ON, W, BUF).tEntryDriftNear)
        + " — over the " + G.HELM_S + " s margin, so the answer is to stop and alarm");
check("5b. ... and the SAME set, close enough that stopping no longer buys that, is HELM",
      () => {
        const near = wall(18);                       // 18 m to the face, 13 m to the buffer
        const a = G.assess(P, G.groundVel(0, 6), SET_ON, near, BUF);
        return a.level === "helm" && a.tEntryDriftNear != null
               && a.tEntryDriftNear <= G.HELM_S;
      },
      (() => { const a = G.assess(P, G.groundVel(0, 6), SET_ON, wall(18), BUF);
        return "18 m off, same 2 kn: within half the buffer in " + secs(a.tEntryDriftNear)
               + " — under " + G.HELM_S + " s, so the water gets there before a decision can"; })());
check("5c. ... and it is the DEPTH of the entry that separates them, not just the clock",
      () => {
        const graze = { polys: [], lines: [],
                        points: [{ e: 0, n: 40, r: 0 }], marks: [], sys: [], chans: [] };
        // ⚠⚠ THE FIRST DRAFT OF THIS CHECK PASSED FOR THE WRONG REASON AND THE MUTATION RUN
        // IS WHAT SAID SO: widening HELM_ENTRY_FRAC back to the whole buffer - the exact
        // defect this check exists for - SURVIVED. Its "outside" case read `clear` not
        // because the margin refused it but because the under-way projection STEPPED OVER
        // the closest approach: 0.92 m per step past a track shaving the buffer by 2 mm, so
        // tEntry was null and `assess` returned before the drift tests were reached at all.
        //
        // So the two tracks are separated here. The DRIFT runs due east and its closest
        // approach to the hazard is exactly `d`; the boat additionally makes way NORTH, so
        // the under-way track climbs into the hazard and tEntry is non-null in both cases.
        // The only thing that differs between them is `d` against the half-buffer.
        const set = { e: 0.30, n: 0 };               // drifting past it, closing nothing
        const way = { e: 0.30, n: 0.50 };            // ...while making way toward it
        const at = (d) => G.assess({ e: -3, n: 40 - d }, way, set, graze, BUF);
        const out = at(BUF - 0.002), inn = at(BUF / 2 - 0.002);
        return out.tEntry != null && inn.tEntry != null       // the rung is REACHED in both
               && out.level !== "helm" && inn.level === "helm";
      },
      (() => {
        const graze = { polys: [], lines: [], points: [{ e: 0, n: 40, r: 0 }],
                        marks: [], sys: [], chans: [] };
        const at = (d) => G.assess({ e: -3, n: 40 - d }, { e: 0.30, n: 0.50 },
                                   { e: 0.30, n: 0 }, graze, BUF);
        const o = at(BUF - 0.002), i = at(BUF / 2 - 0.002);
        return "drift shaving 2 mm inside the " + BUF + " m buffer -> " + o.level
          + " (entry under way at " + secs(o.tEntry) + ", so the rung was reached); 2 mm "
          + "inside HALF the buffer -> " + i.level + ". Before this the two were 'clear' and "
          + "'in extremis' with 2 mm between them";
      })());

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

// ── 6b. AND THE REASON IT GIVES IS WHAT IT MEASURED ─────────────────────────────────
// Andy, 2026-09-19: *"a cause the banner asserts that the code hasn't established."* The
// rung established that the DRIFT-ONLY projection reaches within half the buffer inside
// HELM_S; it never measured how much of the set is closing the feature and how much is
// running past it, and `state.current.ok` was false at every port in the record, so it is
// not established to be a current either. Both sentences it can produce are checked here,
// and neither may claim to know which way the water is setting.
check("6b. the reason quotes the measurement, and never asserts which way the water sets",
      () => {
        const a = G.assess(P, G.groundVel(0, 6), SET_ON, wall(18), BUF);   // stopping is an option
        const b = G.assess(P, SET_ON, SET_ON, W, BUF);                     // nothing to stop
        const bad = /set onto|setting onto|being set/i;
        return a.level === "helm" && b.level === "helm"
               && !bad.test(a.why) && !bad.test(b.why)
               && /drift ALONE/.test(a.why) && /within/.test(a.why)
               && /no way on to take off/.test(b.why)
               && a.why !== b.why;                        // two ways in, two arguments
      },
      (() => {
        const a = G.assess(P, G.groundVel(0, 6), SET_ON, wall(18), BUF);
        const b = G.assess(P, SET_ON, SET_ON, W, BUF);
        return "stoppable: \"" + a.why + "\" | stopped: \"" + b.why + "\"";
      })());

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

  // ⚠⚠ HOW FAR IT DRIVES HER, which had no check at all until the day it mattered.
  // Andy, 2026-09-23, mid-incident: *"the asv ran away from shore."* The escape point was
  // `p + v * run`, and `run` is the SCORING HORIZON - the length of the safety argument, spent
  // as a driving distance. Nothing ever asked how far she needed to go.
  //
  // ⚠⚠ AND THE WHOLE SUITE STAYED GREEN WHEN THAT CHANGED. Capping the escape moved this
  // geometry from 92.5 m to 33.9 m and all 26 checks passed, because not one of them asserted
  // anything about the distance. That is what these are for, and it is why "the suite is
  // green" is never evidence that a behaviour is covered.
  //
  // ⚠ AND THEY ARE DRIVEN FROM AN IN-EXTREMIS STATE, WHICH `P` IS NOT. With SET_ON the
  // drift reaches the buffer from P in 24.5 s, against a HELM_S of 20 - so the helm rung never
  // fires there and the cap would be being measured somewhere it is never called. 8 and 8b are
  // unaffected: they ask the SEARCH whether a clear heading exists, which is a fair question
  // from anywhere. `pEx` is 12 m north of P, a 13.0 s entry, which is the real thing.
  const pEx = { e: 0, n: 12 };
  const escCap = G.escapeCourse(pEx, SET_ON, W, BUF, kn6);
  const tEx = G.timeToEntry(pEx, SET_ON, W, BUF, G.HORIZON_S);
  const far = (q, from) => (q ? Math.hypot(q.e - from.e, q.n - from.n) : null);
  const mm = (v) => (v == null ? "none" : v.toFixed(1) + " m");

  check("8c. the escape stops where it has to, not at the far end of its own proof",
        () => escCap && escCap.capped === true
              && far(escCap.to, pEx) < far(escCap.fullTo, pEx) * 0.5
              && tEx != null && tEx <= G.HELM_S,       // the fixture is genuinely in extremis
        "in extremis at " + secs(tEx) + "; driven " + mm(far(escCap && escCap.to, pEx))
          + " of the " + mm(far(escCap && escCap.fullTo, pEx)) + " the search projected - and "
          + "all three fields are new, so this cannot pass on the code before the cap: there "
          + "was no `fullTo`, no `capped` and no `m`");

  // ⚠ THE ACCEPTANCE CASE FOR THE RULE, and why the stopping point is not the cheaper one.
  // She does not transit this point, she SITS at it - Engine.escape station-keeps there and
  // waits for the operator. "The in-extremis condition stopped holding" is a knife edge to be
  // left loitering on, in the set that caused it: it reads barely over HELM_S, by definition.
  // This is the stronger property, and its margin is a horizon of water rather than a constant
  // somebody picked.
  const tThere = escCap ? G.timeToEntry(escCap.to, SET_ON, W, BUF, G.HORIZON_S) : 0;
  check("8d. ... at a point the drift cannot reach at all, which is what makes it a place to SIT",
        // THE CONTROL IS THE SECOND CLAUSE: the same question at the boat's own position must
        // answer differently, or this is a model saying "never" everywhere and the first
        // clause is measuring nothing at all.
        () => escCap && tThere == null && tEx != null,
        "at the escape point the set never reaches her inside the " + G.HORIZON_S + " s horizon"
          + (tThere == null ? "" : " (IT DOES, in " + secs(tThere) + ")")
          + "; at the boat it reaches her in " + secs(tEx));

  // ⚠⚠ IT WALKS THE TRACK, NOT THE HEADING, and with any cross set those are different
  // lines. Only the track was verified by the search, so only the track may be stopped on -
  // walking the heading would stop her somewhere nothing was ever projected.
  const CROSS = { e: 1.03, n: 1.03 };
  const escX = G.escapeCourse(pEx, CROSS, W, BUF, kn6);
  const tX = G.timeToEntry(pEx, CROSS, W, BUF, G.HORIZON_S);
  const offAxis = escX
    ? Math.abs((escX.to.e - pEx.e) * Math.cos(escX.hdg * Math.PI / 180)
               - (escX.to.n - pEx.n) * Math.sin(escX.hdg * Math.PI / 180))
    : null;
  check("8e. ... and it stops on the TRACK, not on the heading - with a cross set they differ",
        () => escX && escX.capped === true && offAxis > 1
              && tX != null && tX <= G.HELM_S,
        "in extremis at " + secs(tX) + "; the escape point lies " + mm(offAxis)
          + " off the heading ray - zero would mean the walk followed the heading and stopped "
          + "somewhere the search never projected");

  // ⚠ THE REFUSAL, PAIRED WITH 8c's ACCEPTANCE. A cap that fired every time would pass 8c
  // and still be wrong: where no point on the track answers the rule, the escape keeps the run
  // it has always had. It may shorten a verified escape or do nothing, and never lengthen one.
  const escNo = G.escapeCourse(P, { e: 0, n: 4 * 0.514444 }, W, BUF, kn6);
  check("8f. ... and where no point on the track answers the rule, the full run stands",
        () => escNo && escNo.capped === false && escNo.to === escNo.fullTo,
        "a 4 kn set: nowhere on the track is past the drift's reach, so the escape keeps its "
          + mm(far(escNo && escNo.to, P)) + " - 8c is this same assertion with the other answer");

  // ⚠⚠ AND IT NEVER APPLIES FROM INSIDE THE BUFFER, which is not caution: 10h below asserts
  // the inside branch's own answer - "a whole horizon of clear water past the buffer, not a few
  // meters" - written after an earlier design "ended a late exit a few meters outside the
  // buffer, holding in the set that put it there". MEASURED 2026-09-23: capping from 2 m off a
  // face cut 95.6 m to 49.4 m and HALVED 10h's own measure, 45.0 s of clear water down to
  // 22.5 s. Two properties that genuinely disagree, and the one with a measurement wins.
  const escIn = G.escapeCourse({ e: 0, n: 28 }, SET_ON, W, BUF, kn6);
  check("8g. ... and never from INSIDE the buffer, where 10h's horizon of clear water rules",
        () => escIn && escIn.capped === false,
        "from inside, the escape keeps its full " + mm(far(escIn && escIn.to, { e: 0, n: 28 }))
          + " - the cap is an OUTSIDE-branch rule and 10h is what it must not weaken");

  // ⚠ THE SEARCH IS UNTOUCHED, which is what makes the rest safe to ship: the cap runs after
  // the winner is chosen and moves only where she stops. If it ever changed WHICH heading wins,
  // every check above would be measuring a different escape.
  check("8h. ... and the SEARCH is untouched: the uncapped point is still a whole horizon out",
        () => {
          if (!escCap) return false;
          const a = escCap.hdg * Math.PI / 180;
          const v = { e: SET_ON.e + kn6 * Math.sin(a), n: SET_ON.n + kn6 * Math.cos(a) };
          return Math.abs(far(escCap.fullTo, pEx) - Math.hypot(v.e, v.n) * G.HORIZON_S) < 0.5;
        },
        "fullTo is " + mm(far(escCap && escCap.fullTo, pEx)) + ", still " + G.HORIZON_S
          + " s of the scored track - the cap moved `to`, not the search");

  // ⚠⚠ AND A TOKEN ESCAPE IS UNREACHABLE BY CONSTRUCTION, which is why there is no floor
  // constant here and why one would be the wrong shape. The rung fires while the drift enters
  // within HELM_S; the cap stops only where it does not enter within HORIZON_S. HELM_S is the
  // stricter, so from any state the rung can fire in she must be carried from "reached in under
  // 20 s" to "not reached in 45" - a real distance, not a nominal one. A floor in meters would
  // be a second, weaker statement of the same thing, needing re-tuning per hull and buffer.
  // MEASURED across four in-extremis fixtures in this geometry: 29.8, 33.9, 37.0, 40.1 m.
  check("8i. ... and it cannot answer a real in-extremis state with a token move",
        () => escCap && tEx != null && tEx <= G.HELM_S && escCap.m > 10,
        "in extremis at " + secs(tEx) + " (HELM_S is " + G.HELM_S + " s), and the cap still "
          + "drove her " + mm(escCap && escCap.m) + " - the rung's threshold is stricter than "
          + "the cap's, so no state the rung fires in can pass a token escape");

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

  // ── 10b-10h. REVIEW #7, 2026-09-14: FROM INSIDE THE BUFFER, AND AWAY FROM TROUBLE ───────
  // timeToEntry answers 0 for every heading from a point already in the buffer, so the search
  // found nothing there and the page read BOXED IN - with open water straight behind the boat.
  // And the tie-break was ground distance, so with the set running along a face the escape ran
  // ALONG the face. The comment said "distance made good away from trouble"; now the code does.
  //
  // TEETH, 7 mutations run against a scratch-clone copy of guard.js, 7 killed:
  //   inside the buffer scored the old way (timeToEntry)   -> 10b, 10e, 10g, 10h
  //   the tie-break back to ground distance                -> 10b, 10c, 10e, 10g
  //   the hard check dropped from the inside walk          -> 10d
  //   the re-entry projection dropped after the exit       -> 10f
  //   the worst clearance along the track ignored          -> 10e
  //   a fixed 10 s deadline to get out of the buffer       -> 10g, 10h
  //   the escape point one horizon from NOW, not the exit  -> 10h
  const inside = { e: 0, n: 27 };                        // 3 m off the face, inside the 5 m buffer
  const eIn = G.escapeCourse(inside, SET_ON, W, BUF, kn6);
  check("10b. being set onto the face from INSIDE the buffer, it still finds the way out - straight away from it",
        () => eIn && eIn.clear && Math.abs(((eIn.hdg - 180 + 540) % 360) - 180) <= 15,
        eIn ? "steer " + eIn.hdg + "°, ending " + eIn.gain.toFixed(0) + " m clear" : "none found - BOXED IN");

  const along = { e: 1.03, n: 0 };                       // 2 kn stream running along the face
  const near = { e: 0, n: 22 };                          // 8 m off the face, outside the buffer
  const eAl = G.escapeCourse(near, along, W, BUF, kn6);
  check("10c. with the set running along the face, the tie goes to CLEARANCE gained, not ground distance",
        () => eAl && eAl.clear && Math.abs(((eAl.hdg - 180 + 540) % 360) - 180) <= 30 && eAl.gain > 100,
        eAl ? "steer " + eAl.hdg + "°, ending " + eAl.gain.toFixed(0) + " m clear" : "none found");

  // Pocketed: walls close on three sides, a THIN pier (0.3 m) 2.5 m east, slack water - and the
  // only open water is through the pier. Crossing it is not a way out, so the answer is to
  // refuse. ⚠ The pier is thinner than a one-second stride, so only the fine hard-margin walk
  // sees the crossing: the worst-clearance samples can step clean over it.
  const thin = [{ e: 0, n: -60 }, { e: 0.3, n: -60 }, { e: 0.3, n: 60 }, { e: 0, n: 60 }];
  const pocket = [
    [{ e: -400, n: -400 }, { e: -10, n: -400 }, { e: -10, n: 400 }, { e: -400, n: 400 }],   // west
    [{ e: -400, n: 6 }, { e: 0, n: 6 }, { e: 0, n: 400 }, { e: -400, n: 400 }],             // north
    [{ e: -400, n: -400 }, { e: 0, n: -400 }, { e: 0, n: -6 }, { e: -400, n: -6 }],         // south
  ];
  const pocketed = { polys: [thin, ...pocket].map((r) => ({ ring: r, bb: bbOf(r), kind: "a dock / pier" })),
                     lines: [], points: [], marks: [], sys: [], chans: [] };
  const eTh = G.escapeCourse({ e: -2.5, n: 0 }, SLACK, pocketed, BUF, kn6);
  check("10d. ... and from inside, a track that CROSSES the feature is never the way out - pocketed, it refuses",
        () => eTh === null,
        eTh ? "steered " + eTh.hdg + "° - through the pier at e=0..0.3" : "refused: the only open water is through the pier");

  // Straight away from the face passes 2 m from a pile - never touching it, but back inside a
  // buffer, which is not a way OUT. The answer has to go round it.
  const withPile = { ...W, points: [{ kind: "a pile", e: 2, n: 20, r: 0.5 }] };   // 7 m in: 180 still ENDS in the most water
  const ePl = G.escapeCourse(inside, SET_ON, withPile, BUF, kn6);
  check("10e. ... and a track that leaves the buffer only to pass inside another's is not a way out either",
        () => ePl && ePl.clear && ePl.hdg !== 180 && Math.abs(((ePl.hdg - 180 + 540) % 360) - 180) <= 45,
        ePl ? "steer " + ePl.hdg + "° (straight away, 180°, passes 2 m from the pile)" : "none found");

  // A corridor with an 8 m free band: every candidate heading that gets out of this buffer
  // crosses the band into the far wall's inside a horizon. Out of one buffer into another is not
  // a way out. (A 37 m corridor is NOT boxed - a slow crab across it stays clear for the horizon -
  // which is how the first cut of this check was wrong.)
  const farWall = [{ e: -400, n: -290 }, { e: 400, n: -290 }, { e: 400, n: 12 }, { e: -400, n: 12 }];
  const corridor = { ...W, polys: [...W.polys, { ring: farWall, bb: bbOf(farWall), kind: "a dock / pier" }] };
  const eCo = G.escapeCourse(inside, SET_ON, corridor, BUF, kn6);
  check("10f. ... and in a corridor, out of this buffer only into the far wall's, it REFUSES",
        () => eCo === null,
        eCo ? "steered " + eCo.hdg + "° - a way out it does not have" : "refused: 18 m between the faces, 8 m of it outside both buffers");

  // Deep in a WIDE buffer, in a strong set: 3 m off the face, a 15 m buffer the operator set for
  // the structure, a 4 kn stream onto it. Straight out makes 2 kn over the ground and takes
  // 11.7 s to leave the buffer. A fixed exit deadline (10 s, the first cut of this fix) read that
  // as BOXED IN - with open water straight behind the boat. Slow is not the same as no way out.
  const SET_HARD = { e: 0, n: 4 * 0.514444 };
  const WIDE = 15;
  const eWd = G.escapeCourse(inside, SET_HARD, W, WIDE, kn6);
  check("10g. deep in a WIDE buffer in a strong set, a slow way out is still the way out - it is not BOXED IN",
        () => eWd && eWd.clear && Math.abs(((eWd.hdg - 180 + 540) % 360) - 180) <= 15,
        eWd ? "steer " + eWd.hdg + "°; straight out takes 11.7 s to leave a 15 m buffer in a 4 kn set"
            : "none found - BOXED IN, with open water straight behind the boat");

  // ... and it ends a whole horizon of clear water past the buffer's edge, like an escape that
  // starts outside one - not a horizon from NOW, which put this one 33 s past the edge and a
  // late exit a few meters past it, holding in the set that put it there. Worked from the
  // geometry, not the code: the edge is 15 m off a face that runs east-west, so the escape
  // point's distance past it, over the speed away from the face, is the time run in clear water.
  check("10h. ... and the escape point is a whole horizon of clear water past the buffer, not a few meters",
        () => {
          if (!eWd) return false;
          const a = eWd.hdg * Math.PI / 180;
          const away = -(SET_HARD.n + kn6 * Math.cos(a));          // m/s over the ground, off the face
          return away > 0 && (30 - WIDE - eWd.to.n) / away >= G.HORIZON_S - 0.01;
        },
        eWd ? ((30 - WIDE - eWd.to.n) / -(SET_HARD.n + kn6 * Math.cos(eWd.hdg * Math.PI / 180))).toFixed(1)
                + " s of clear water past the edge (the horizon is " + G.HORIZON_S + " s)"
            : "none found");
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
// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes
// its mutants to a file this suite never reads and scores every one as SURVIVED (audited
// 2026-09-21: 21 of the 53 suites reading this page had no override).
  const H = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");
  const fn = H.slice(H.indexOf("function clearanceGuard("), H.indexOf("// --- THE SPEED GOVERNOR"));
  const code = fn.replace(/^[^\n]*\/\/[^\n]*$/gm, (l) => l.replace(/\/\/.*$/, ""));
  check("12. every rung commands something different, and only the last one steers",
        // commandSpeed() since review #6 - it sends /api/cmd/speed and remembers the key the
        // console reconciles against (tests/speed_modes.js 9 and 19)
        () => /commandSpeed\("low"\)/.test(code)
              && /cmd\("\/api\/cmd\/hold"/.test(code)
              && /cmd\("\/api\/cmd\/escape"/.test(code)
              && !/cmd\("\/api\/cmd\/goto"/.test(code)
              && code.indexOf('cmd("/api/cmd/escape"') > code.indexOf('a.level === "helm"'),
        "slow -> speed low, hold -> hold, helm -> escape - a dedicated behaviour, not a " +
        "Go-To, so its arrival can never re-chain the end-of-plan RTH (tests/end_action.js 5b/16b)");
  check("13. a refused escape ALARMS and hands the helm back rather than falling through",
        () => /BOXED IN/.test(fn) && /TAKE MANUAL CONTROL/.test(fn),
        "the one case where the console must say it cannot help");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
