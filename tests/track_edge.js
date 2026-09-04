// tests/track_edge.js - the look-ahead follows the PLAN, and a near miss is answered by a
// few metres of track rather than by stopping the boat.
//
// Andy, 2026-09-04, with two reports from one session:
//
//   "A keep out triggered during the start of a survey forced a drift-only track. The punch
//    out should have kept the run clear. In another situation a GOTO run was put into
//    holding because of entering a no go zone. ... stopping and holding the ASV on a run is
//    a problem. Investigate forcing slight deviations in a given track to prevent holds when
//    there is still plenty of available water away from the nogo."
//
// and then: *"or generate a button that allows continued forward progress override. As if a
// user has confirmed its safe to proceed"*.
//
// ⚠⚠ HE IS RIGHT THAT THE PUNCH-OUT KEPT THE RUN CLEAR, AND THAT IS THE WHOLE DEFECT. The
// clearance guard's look-ahead was a STRAIGHT extrapolation of the present ground velocity
// for up to 45 s - a manoeuvre nobody intends to make - while every planner in this console
// clips or routes to the buffer edge and then TURNS. A plan is correct precisely when it
// grazes the buffer, and the guard alarmed 40-60 m before that same edge, so the two rules
// could not both be satisfied. Measured against a pier at buffer 5 m, in DEAD CALM, with no
// set on the boat at all, on a survey line clipLine had trimmed exactly as it should:
//
//     4.0 kn survey line:  SLOW at 90 m of clearance, HOLD with 33 m still to run
//     4.0 kn Go-To turn:   first alarm 90 m short of the turn, HOLD 39 m short of it
//     6.0 kn Go-To turn:   first alarm 136 m short of the turn, HOLD 59 m short of it
//
// And a false HOLD is not a harmless pause. It takes the way off, and a hull lying stopped
// in a 2 kn stream makes 2.00 kn over the ground (tests/currents.py A and E) - so the
// console answered a correct plan by handing the boat to the tide beside the very feature it
// was worried about. That is the "drift-only track" in the report. It also destroys the run:
// a hold replaces the vessel's plan with a single-waypoint route, and the console's only way
// back is to re-run from waypoint one.
//
//   node tests/track_edge.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// THE RULES THIS SUITE ENCODES:
//   * On a plan, the look-ahead WALKS THE ROUTE - and it is not "trust the plan": it starts
//     at the boat's real position and heading, swings at the HULL'S OWN TURN RATE, and adds
//     the drift at every step. A boat being set off its track still reads the entry, and a
//     hull that cannot make the corner still reads the entry (checks 3, 5, 8).
//   * With no route it is EXACTLY the projection it always was, so the Eastport
//     station-keeping case that earned the helm rung is untouched (check 6).
//   * A deviation is VERIFIED by re-projection, not estimated, and must move into real
//     water. The smallest one that works is the one taken.
//   * The console may move a CORNER. It may never move a DESTINATION (check 14).
//   * `edge` outranks slow and hold. It never outranks the helm (check 16).
//   * PROCEED suppresses the two rungs that impede the boat, and nothing else - not the
//     alarm, not a deviation, and not the helm (checks 20-24).
//
// TEETH: TWENTY-FIVE mutations run against a sidecar copy of guard.js and the page,
// twenty-three killed. The check numbers are the ones that actually went red, not the ones
// that looked likely.
//   projection ignores the route (THE REPORTED DEFECT)          -> 1, 2, 8, 10
//   projection ignores the drift                                -> 5, 16
//   projection swings at an unbounded turn rate                 -> 3, 8, 10, 11, 12, 15, 27
//   projection continues past the last waypoint                 -> 7
//   already-inside returns null instead of zero                 -> 9
//   route projection used when heading / way is missing         -> 6
//   the projection does not say WHICH leg fouled                -> 27
//   the corner the boat turns AT is never considered            -> 10, 11, 12, 15, 27
//   edge offered without re-projecting the candidate            -> 11, 12, 14, 15, 27
//   verified at the TRIGGER buffer, so no hysteresis            -> 12
//   `move` allowed on a destination                             -> 14
//   `move` tried before `bend`                                  -> 15
//   edge tried when the drift track enters too                  -> 16
//   the smallest offset is not preferred                        -> 11, 15
//   the page commands a goto instead of amending                -> 18
//   the amendment is spliced at the head of the route           -> 19
//   the page does not redraw the amended route                  -> 19
//   the ladder climbs while a deviation is settling             -> 26
//   PROCEED offered at every rung                               -> 20
//   the override covers `helm`                                  -> 21
//   the override covers `edge`                                  -> 22
//   the override survives a new plan                            -> 23
//   the override never lapses on worsening water                -> 24
//
// ⚠ SIX OF THESE CHECKS WERE WRITTEN WRONG AND MUTATION FOUND ALL SIX. Each looked exactly
// like a test and could not fail:
//   * 7 stood its last waypoint 25 m off the wall, so a projection that never ended just
//     orbited in open water and touched nothing. It is on the buffer edge now, where
//     punchOut actually leaves it.
//   * 12 read the WINNER'S own clearance, then drove `marginM` - both shadowed by the water
//     gate, which refuses on its own. And its first repair used the CORNER, where the
//     offset that clears `buf` and the one that clears `buf + margin` land on the same
//     search step. It uses a pile on an open leg now, where the two differ by exactly one
//     step: 15.0 m verified properly against 12.5 m verified at the bare buffer.
//   * 14 used a destination in CLEAR water, where the projection ends AT the waypoint and
//     reports clear - there was no deviation to classify. (The first repair, 4 m off the
//     face, also could not fail: the projection stops at the capture radius, 2 m short, and
//     never enters. It is 2 m off the face now.)
//   * 15 was a source-shape check that any rename would break and no defect would. It
//     drives both shapes now - a corner answers with a MOVE, a pile on an open leg with a
//     BEND.
//   * 27 first used a TWO-waypoint route, where there is only one corner and so nothing for
//     the fouled-leg index to be wrong ABOUT. Four waypoints now, fouling at the third.
//   * and 15's mid-leg fixture put its pile 120 m up a leg whose look-ahead reaches 93 m,
//     so the search correctly answered null and the check passed for no reason at all.
//
// ⚠ AND TWO MUTATIONS SURVIVE, DELIBERATELY RECORDED, both for the same reason: verifying
// the WHOLE amended track at `buf + margin` turned out to dominate two narrower guards.
// Deleting `edgeAround`'s ahead-of-the-boat test, or its water gate on the via itself,
// changes no answer in any geometry this suite can find. Both stay - the same call
// tests/estop_chain.py 5b records for its own redundant layer - because each states a rule
// that is true independently of how it is currently enforced, and each can still bite where
// the track test cannot: a horizon-limited reversal, and a via in a pinch the boat happens
// to pass wide of. Check 17 sweeps 24 geometries rather than sampling one, so the day
// either does bite, it is caught.

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
const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");
const SRC = fs.readFileSync(path.join(__dirname, "..", "static", "js", "guard.js"), "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? detail + " — " : "") + "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}

// ── THE WORLD ───────────────────────────────────────────────────────────────────────
// A pier occupying the water east of e = 0, its west face running north-south. The boat
// works in the clear water to the west of it.
const ring = [{ e: 0, n: -20 }, { e: 60, n: -20 }, { e: 60, n: 20 }, { e: 0, n: 20 }];
const PIER = { polys: [{ ring, bb: bbOf(ring), kind: "a dock / pier" }],
               lines: [], points: [], marks: [], sys: [], chans: [] };
const BUF = 5;
const KN = (k) => k * 0.514444;
// A DriX holds 20°/s, so ~10 m of turn radius at 7 kn. A small-class boat holds 60°/s,
// ~3 m at 4 kn. The difference is the whole of check 8.
const DRIX = { turnRateDegS: 20, approachM: 2 };
const TIGHT = { turnRateDegS: 60, approachM: 2 };
const SLACK = { e: 0, n: 0 };
// clipLine steps at max(2, buf/3) and drops one more sample, so a correctly clipped run
// ends about buf + 2 m off the face. This is that run, and then the turn away from it.
const CLIPPED_END = -(BUF + 2);
const SURVEY = [{ e: CLIPPED_END, n: 0 }, { e: CLIPPED_END, n: 60 }];
const CORNER = [{ e: -7, n: 0 }, { e: -7, n: 60 }];
const lvl = (p, vel, drift, opts) => G.assess(p, vel, drift, PIER, BUF, opts || {}).level;
const onPlan = (route, hdg, kn, extra) =>
  Object.assign({ route: route, hdgDeg: hdg, twMs: KN(kn) }, extra || {});

console.log("The look-ahead follows the plan, and a near miss is answered by a deviation:");

// ── 1-2. THE TWO REPORTS ────────────────────────────────────────────────────────────
check("1. THE SURVEY REPORT: a correctly clipped run reads CLEAR, where the straight " +
      "projection HELD the boat with 33 m of its own certified water still to run",
      () => {
        const at = { e: -40, n: 0 }, v = { e: KN(4), n: 0 };
        return lvl(at, v, SLACK) === "hold"                       // the defect, preserved
            && lvl(at, v, SLACK, onPlan(SURVEY, 90, 4, TIGHT)) === "clear";
      },
      "40 m off the face, running the line it was clipped to, dead calm, no set at all");
check("2. THE GO-TO REPORT: a routed detour that turns at its corner reads CLEAR too",
      () => {
        const at = { e: -46, n: 0 }, v = { e: KN(4), n: 0 };
        return lvl(at, v, SLACK) === "hold"
            && lvl(at, v, SLACK, onPlan(CORNER, 90, 4, TIGHT)) === "clear";
      },
      "39 m short of the turn - the range at which the old projection held it");

// ── 3-9. THE PROJECTION IS NOT "TRUST THE PLAN" ─────────────────────────────────────
check("3. it walks from the BOAT, not from the route: a boat whose head is off the leg and " +
      "too close to swing back still reads the entry",
      () => {
        const route = [{ e: -14, n: 300 }];          // the leg runs north, in clear water
        // ...and the boat is ON it, 14 m off the face, but heading straight at the wall.
        // A DriX needs 10 m of radius to come round, which puts it 4 m INSIDE the buffer.
        return lvl({ e: -14, n: 0 }, { e: KN(7), n: 0 }, SLACK,
                   onPlan(route, 90, 7, DRIX)) !== "clear";
      },
      "the plan is clear, the boat is on it, and its HEAD is not - a route-aware " +
      "projection that assumed the plan would read this clear");
check("4. a boat holding its track in a cross set reads CLEAR — the crab is real steering, " +
      "not an excuse to alarm",
      () => {
        const route = [{ e: -40, n: 300 }];
        const set = { e: KN(0.6), n: 0 };            // 0.6 kn setting onto the pier
        return lvl({ e: -40, n: 0 }, { e: set.e, n: KN(4) }, set,
                   onPlan(route, 0, 4, TIGHT)) === "clear";
      },
      "a waypoint follower crabs; a projection that cannot crab alarms on every tide");
check("5. THE DRIFT IS IN THE INTEGRATION: the same geometry with a set the boat cannot " +
      "hold against does read the entry",
      () => {
        const route = [{ e: -40, n: 300 }];
        const set = { e: KN(6), n: 0 };              // 6 kn of set against 2 kn of way
        return lvl({ e: -40, n: 0 }, { e: set.e, n: KN(2) }, set,
                   onPlan(route, 0, 2, TIGHT)) !== "clear";
      },
      "6 kn on the beam against 2 kn through the water: no heading holds that track");
check("6. WITH NO ROUTE IT IS THE PROJECTION IT ALWAYS WAS — the Eastport station-keeping " +
      "case that earned the helm rung is untouched",
      () => {
        const at = { e: -40, n: 0 }, v = { e: KN(4), n: 0 };
        // A route present but the boat not being steered along it: no heading, or no way on.
        return lvl(at, v, SLACK, { route: SURVEY, twMs: KN(4) }) === "hold"
            && lvl(at, v, SLACK, { route: SURVEY, hdgDeg: 90 }) === "hold"
            && lvl(at, v, SLACK, {}) === "hold";
      },
      "all three of route, heading and way through the water are needed, or it falls back");
check("7. the projection ENDS where the route ends and invents no continuation",
      () => {
        // ⚠ THE WAYPOINT IS ON THE BUFFER EDGE, WHICH IS WHERE punchOut ACTUALLY PUTS IT.
        // A first version stood it 25 m off the face, and a mutation that clamped the index
        // instead of ending SURVIVED: the boat orbited its last waypoint in open water and
        // never touched anything. Here an orbit at the hull's turn radius, and a straight
        // continuation, both foul - so the check can only pass by ENDING.
        const route = [{ e: CLIPPED_END, n: 0 }];
        return G.projectRoute({ e: -60, n: 0 }, 90, KN(7), SLACK, route, PIER, BUF, TIGHT)
               === null;
      },
      "what happens after the plan is the HOLD POINT's question - hold.js certifies it");
check("8. THE TURN RATE IS THE HULL'S: the same corner is clear for a boat that can make " +
      "it and an entry for one that cannot",
      () => {
        const at = { e: -60, n: 0 };
        const tight = lvl(at, { e: KN(4), n: 0 }, SLACK, onPlan(CORNER, 90, 4, TIGHT));
        const drix  = lvl(at, { e: KN(7), n: 0 }, SLACK, onPlan(CORNER, 90, 7, DRIX));
        return tight === "clear" && drix !== "clear";
      },
      "a 10 m turn circle at a corner 7 m off the face reaches 3 m INSIDE the structure");
check("9. a boat ALREADY inside the buffer projects t = 0, never clear",
      () => {
        const r = G.projectRoute({ e: -2, n: 0 }, 270, KN(4), SLACK,
                                 [{ e: -200, n: 0 }], PIER, BUF, TIGHT);
        return !!r && r.t === 0;
      },
      "\"we are in it\" and \"we will never be in it\" must not be the same answer");

// ── 10-17. THE DEVIATION ────────────────────────────────────────────────────────────
const edgeAt = (at, kn, opts, route) =>
  G.edgeAround(at, 90, KN(kn), SLACK, route || CORNER, PIER, BUF,
               Object.assign({}, opts || DRIX));
check("10. the corner the DriX cannot fly is answered by a DEVIATION, not by a hold",
      () => {
        const a = G.assess({ e: -60, n: 0 }, { e: KN(7), n: 0 }, SLACK, PIER, BUF,
                           onPlan(CORNER, 90, 7, DRIX));
        return a.level === "edge" && !!a.edge && a.edge.offsetM > 0;
      },
      "the same geometry that reads `hold` on the old projection and on a hull that cannot " +
      "turn tight enough");
check("11. the deviation taken is VERIFIED by re-projecting the amended track, and nothing " +
      "smaller would have done",
      () => {
        const at = { e: -60, n: 0 };
        const e = edgeAt(at, 7);
        if (!e) return false;
        const amended = [e.via].concat(CORNER.slice(e.drop));
        if (G.projectRoute(at, 90, KN(7), SLACK, amended, PIER, BUF, DRIX)) return false;
        // ... and a cap one step below what it chose finds nothing at all.
        return e.offsetM <= G.edgeStepM(BUF) + 1e-9
            || !G.edgeAround(at, 90, KN(7), SLACK, CORNER, PIER, BUF,
                             Object.assign({}, DRIX, { capM: e.offsetM - G.edgeStepM(BUF) }));
      },
      "score the actual track, never the intention");
check("12. THE DEVIATION IS VERIFIED WITH ROOM TO SPARE — the amended track is clear at the " +
      "buffer PLUS the margin, not merely at the buffer that triggered it",
      () => {
        // ⚠ A PILE ON AN OPEN LEG, NOT THE CORNER, AND MUTATION IS WHY. At the corner the
        // offset that clears `buf` and the one that clears `buf + margin` land on the SAME
        // search step, so weakening the verification changed no answer and survived. Here
        // the track's clearance grows smoothly with the offset, so the two differ by
        // exactly one step: 15.0 m verified properly, 12.5 m verified at the bare buffer -
        // and 12.5 m is NOT clear at buf + margin, which is the whole point.
        const pile = { polys: PIER.polys, lines: [],
                       points: [{ e: -40, n: 60, r: 4, kind: "an obstruction" }],
                       marks: [], sys: [], chans: [] };
        const route = [{ e: -40, n: 200 }, { e: -40, n: 400 }];
        const at = { e: -40, n: 0 };
        const e = G.edgeAround(at, 0, KN(4), SLACK, route, pile, BUF, TIGHT);
        if (!e) return false;
        const cand = [...route.slice(0, e.at), e.via, ...route.slice(e.at + e.drop)];
        // ⚠ THIS IS THE HYSTERESIS, AND IT IS WHY ONE DEVIATION HOLDS. Verified at the bare
        // buffer, the smallest offset that works leaves the boat a hair outside, and the
        // next frame - three metres on - fouls again and asks for another. Measured live at
        // New Castle before this was written: three amendments in twelve seconds, then the
        // budget was spent and the boat held anyway.
        //
        // ⚠ IT ALSO REPLACED A CHECK THAT COULD NOT FAIL. Reading the winner's own clearance
        // and driving `marginM` past the water available both pass with the verification
        // weakened, because the water GATE alone still refuses - the gate shadowed the
        // thing that actually matters, which is the whole track.
        return !G.projectRoute(at, 0, KN(4), SLACK, cand, pile, BUF + G.edgeMarginM(BUF), TIGHT)
            && e.water >= BUF + G.edgeMarginM(BUF) - 1e-9;
      },
      "\"when there is still plenty of available water away from the nogo\" — of track, not " +
      "just of waypoint");
check("13. and it is bounded — in a gut with no water to either side, no deviation is " +
      "invented and the ordinary rungs answer",
      () => {
        const west = [{ e: -30, n: -200 }, { e: -26, n: -200 },
                      { e: -26, n: 200 }, { e: -30, n: 200 }];
        const gut = { polys: [PIER.polys[0], { ring: west, bb: bbOf(west), kind: "a shoal" }],
                      lines: [], points: [], marks: [], sys: [], chans: [] };
        const e = G.edgeAround({ e: -20, n: 0 }, 90, KN(7), SLACK,
                               [{ e: -14, n: 0 }, { e: -14, n: 60 }], gut, BUF, DRIX);
        return e === null || e.offsetM <= G.edgeCapM(BUF) + 1e-9;
      },
      "edgeCapM is the authority bound AND the per-episode budget");
check("14. THE CONSOLE MAY MOVE A CORNER AND NEVER A DESTINATION — a commanded point that " +
      "is itself inside the buffer is REFUSED, not quietly re-aimed",
      () => {
        // ⚠ THE FIRST VERSION OF THIS CHECK COULD NOT FAIL, and mutation said so: it used a
        // destination in clear water, where the projection ends at the waypoint and reports
        // clear, so there was no deviation to classify at all. The rule only bites where a
        // MOVE is the only thing that would work - which is a destination inside the buffer.
        // No bend can answer that, because every bent track still ends at the same point.
        // ⚠ AND IT HAS TO BE DEEP ENOUGH INSIDE TO ACTUALLY FOUL THE APPROACH. At 4 m off
        // the face the projection ends 2 m short of the point - the waypoint capture radius
        // - and never touches the buffer, so there is no entry and nothing to classify:
        // that fixture survived the mutation too. At 2 m the run in is blocked.
        const inside = [{ e: -2, n: 0 }];
        const e = G.edgeAround({ e: -60, n: 0 }, 90, KN(7), SLACK, inside, PIER, BUF, DRIX);
        return e === null;
      },
      "moving the last waypoint is not a deviation, it is a different command - and where " +
      "a commanded point is unsafe, hold.js moves it AT COMMAND TIME and says so");
check("15. a BEND is preferred to a MOVE at the same offset — the smallest disturbance to " +
      "the operator's plan wins, and both shapes are reachable",
      () => {
        // The bend base is pushed first and the search returns on the first winner...
        const order = SRC.indexOf('const bend = onLeg("bend"') < SRC.indexOf('onLeg("move"')
                   && /if \(best\) return best;\s*\/\/ BEND BEFORE MOVE/.test(SRC);
        // ...and each shape really is produced where it is the answer. The corner the DriX
        // cannot fly needs the CORNER moved (a bend on the fouled leg cannot help - the boat
        // has already committed to the turn); a hazard sitting ON a leg needs a bend.
        const corner = edgeAt({ e: -60, n: 0 }, 7);
        const pile = { polys: PIER.polys, lines: [],
                       points: [{ e: -40, n: 60, r: 4, kind: "an obstruction" }],
                       marks: [], sys: [], chans: [] };
        // ⚠ WITHIN THE HORIZON. At 4 kn the look-ahead reaches 93 m, so a pile 120 m up the
        // leg is not a foul at all and the search correctly answers null - which would have
        // passed this check for no reason.
        const midLeg = G.edgeAround({ e: -40, n: 0 }, 0, KN(4), SLACK,
                                    [{ e: -40, n: 200 }, { e: -40, n: 400 }],
                                    pile, BUF, TIGHT);
        return order && !!corner && corner.mode === "move"
            && !!midLeg && midLeg.mode === "bend";
      },
      "the corner case answers with a move; a pile on an otherwise clear leg answers with " +
      "a bend");
check("16. EDGE NEVER OUTRANKS THE HELM: where the drift-only track enters too, the answer " +
      "is still the helm and no deviation is offered",
      () => {
        // 3 kn of stream on the beam against 2 kn of way: the boat cannot hold its track,
        // and taking the way off only hands it to the same stream sooner.
        const setOn = { e: KN(3), n: 0 };
        const a = G.assess({ e: -30, n: 0 }, { e: KN(3), n: KN(2) }, setOn, PIER, BUF,
                           onPlan([{ e: -30, n: 300 }], 0, 2, TIGHT));
        return a.level === "helm" && !a.edge;
      },
      "a few metres of track is not an answer to the water doing the carrying");
check("17. a candidate abeam or astern is never returned — a via behind the boat is not a " +
      "deviation, it is a reversal that scores clear only because the horizon ran out",
      () => {
        // ⚠ SWEPT, NOT SAMPLED, AND MUTATION IS WHY. Deleting the ahead-of-the-boat guard
        // SURVIVED a single-geometry version of this check: in every case tried, a via
        // astern needs a turn the re-projection already refuses, so the guard is currently
        // REDUNDANT with the verification. It is kept as a cheap, explicit invariant - the
        // same call estop_chain 5b records - and this is the sweep that would catch the day
        // a horizon-limited reversal did score clear.
        for (let hdg = 0; hdg < 360; hdg += 30) {
          for (const kn of [4, 7]) {
            const r = hdg * Math.PI / 180;
            const far = { e: -14 + 300 * Math.sin(r), n: 300 * Math.cos(r) };
            const at = { e: -14, n: 0 };
            const e = G.edgeAround(at, hdg, KN(kn), SLACK, [far, { e: far.e, n: far.n + 200 }],
                                   PIER, BUF, DRIX);
            if (!e) continue;
            const L = Math.hypot(far.e - at.e, far.n - at.n);
            const along = ((e.via.e - at.e) * (far.e - at.e)
                         + (e.via.n - at.n) * (far.n - at.n)) / L;
            if (along <= 0) return false;
          }
        }
        return true;
      },
      "24 geometries, two speeds - every via the search offers is ahead along its own leg");

// ── 18-19. THE PAGE TAKES THE DEVIATION, AND DRAWS WHAT IT TOOK ─────────────────────
// ⚠ THE RUNG BLOCKS ARE SLICED BY THEIR BANNERS, NOT BY THE FIRST `a.level === "..."` IN
// THE FILE. The first version of check 18 ordered two indexOf() hits and passed on text
// inside renderGuardBar - which mentions three rungs by name and commands nothing at all.
// A check that can be satisfied by a readout is not a check on behaviour.
function rung(name) {
  const b = H.indexOf("// ── RUNG " + name);
  if (b < 0) return "";
  const nxt = H.indexOf("// ── RUNG ", b + 12);
  return H.slice(b, nxt < 0 ? b + 4000 : nxt);
}
const R_EDGE = rung("1: EDGE"), R_SLOW = rung("2: SLOW"),
      R_HOLD = rung("3: HOLD"), R_HELM = rung("4: THE HELM");
check("18. the edge rung AMENDS the running plan — it does not command a Go-To, and it " +
      "does not command a heading",
      () => R_EDGE.length > 500
            && /cmd\("\/api\/cmd\/amend"/.test(R_EDGE)
            && !/cmd\("\/api\/cmd\/(goto|escape|hold)"/.test(R_EDGE)
            && !/cmd\("\/api\/cmd\/amend"/.test(R_SLOW + R_HOLD),
      "a Go-To would rename the survey, re-arm the end-of-plan chain and reset the index " +
      "to waypoint one - the same trap the in-extremis escape was rebuilt to avoid");
check("19. and the DRAWN route follows the amendment — the chart may not show a track the " +
      "boat is not flying",
      () => /const tail = \[\.\.\.trkNow\.ahead\.slice\(0, at\), w,\s*\.\.\.trkNow\.ahead\.slice\(at \+ a\.edge\.drop\)\]/.test(H)
            && /runRoute = \[\.\.\.runRoute\.slice\(0, trkNow\.idx\), \.\.\.tail\]/.test(H),
      "every figure on the cards is measured off runRoute - and the splice is at the index " +
      "the search named, so the waypoints between the boat and the amendment survive");

// ── 20-24. THE OPERATOR'S OVERRIDE ──────────────────────────────────────────────────
// Andy: "generate a button that allows continued forward progress override. As if a user
// has confirmed its safe to proceed". What it does NOT cover is the whole design.
const OVR = H.slice(H.indexOf("function guardOverrideOk"),
                    H.indexOf("function guardOverrideOk") + 900);
check("20. there IS a button, it is wired, and it is offered only where it means something",
      () => /id="gb_proceed"/.test(H) && /\$\("#gb_proceed"\)\.onclick/.test(H)
            && /const offerable = \(a\.level === "slow" \|\| a\.level === "hold"\)/.test(H),
      "offering it at a rung that is not stopping the boat teaches the operator to press " +
      "it out of habit before the one that matters");
check("21. PROCEED NEVER COVERS THE HELM — it lapses the moment stopping stops being an " +
      "answer",
      () => /level === "clear" \|\| level === "helm"/.test(OVR)
            && /guardOverride = null; return false;/.test(OVR),
      "\"keep going\" was never an answer to \"the water is carrying you in\"");
check("22. ... and it never suppresses a DEVIATION, which is the forward progress it is " +
      "asking for",
      () => R_EDGE.length > 500 && R_SLOW.length > 200 && R_HOLD.length > 200
            && R_HELM.length > 200
            && !/if\(overridden\)/.test(R_EDGE)
            && !/if\(overridden\)/.test(R_HELM)
            && /if\(overridden\) return c;/.test(R_SLOW)
            && /if\(overridden\) return c;/.test(R_HOLD),
      "suppressing the deviation would make PROCEED strictly worse than not pressing it");
check("23. it is ONE DECISION ABOUT ONE SITUATION — a new commanded motion clears it, so " +
      "it can never become a standing permission",
      () => {
        const sp = H.slice(H.indexOf("function setPlanIntent"),
                           H.indexOf("function setPlanIntent") + 1200);
        return /guardOverride = null; edgeSpentM = 0; edgeCount = 0;/.test(sp);
      },
      "setPlanIntent is written wherever runRoute is - every Go-To, RTH, transit and survey");
check("24. and it lapses when the water gets materially worse than the water the operator " +
      "looked at — bounded by WHAT CHANGED, not by a clock",
      () => /clearM < guardOverride\.clearM - OVERRIDE_GIVE_M/.test(OVR)
            && !/Date\.now\(\) - guardOverride\.t >/.test(OVR),
      "a five-minute cap re-holds a boat halfway down a channel it has already assessed, " +
      "and a long enough one never fires");

// ── 27. THE DEVIATION GOES WHERE THE TROUBLE IS ─────────────────────────────────────
check("27. on a multi-leg route the amendment lands at the leg that FOULS, not at the leg " +
      "being flown now",
      () => {
        // Four waypoints: a clear run east, a small clear jog north, then the corner the
        // DriX cannot turn at, and a leg away from it. Nothing on the first two legs is
        // wrong, and the corner that must move is the THIRD waypoint.
        const four = [{ e: -105, n: 0 }, { e: -105, n: 15 },
                      { e: -7, n: 15 }, { e: -7, n: 80 }];
        const at = { e: -120, n: 0 };
        const hit = G.projectRoute(at, 90, KN(7), SLACK, four, PIER, BUF, DRIX);
        const e = G.edgeAround(at, 90, KN(7), SLACK, four, PIER, BUF, DRIX);
        // ⚠ `hit.i` IS WHAT MAKES THIS TESTABLE, and forcing it to 0 SURVIVED a two-waypoint
        // fixture: with one corner there is nothing for the index to be wrong ABOUT.
        return !!hit && hit.i === 3 && !!e && e.at === 2 && e.mode === "move";
      },
      "amending the leg the boat is on would move the track somewhere nothing was ever " +
      "going to happen");

// ── 26. A DEVIATION IN FLIGHT IS NOT A REASON TO STOP ───────────────────────────────
// ⚠ FOUND BY DRIVING IT, NOT BY READING IT. Live at New Castle, the guard edged and then,
// in the two seconds before the next search, was asked WITHOUT the deviation, answered
// `hold` on the very entry the deviation had just been commanded to remove, and stopped the
// boat: three amendments and two holds in twenty seconds, with the hold/re-approach chain
// churning underneath. `settling` gates the search AND the escalation - and never the helm.
check("26. while a commanded deviation is still settling, the ladder does not climb past it " +
      "— and the helm is never gated",
      () => R_SLOW.length > 200 && R_HOLD.length > 200 && R_HELM.length > 200
            && /if\(settling\) return c;/.test(R_SLOW)
            && /if\(settling\) return c;/.test(R_HOLD)
            && !/settling/.test(R_HELM)
            && /const settling = Date\.now\(\) - guardEdgeAt < EDGE_REASSESS_MS;/.test(H),
      "do not judge a state on the measurement the command you just issued was meant to " +
      "change - the same argument as the release counterfactual");

// ── 25. THE NUMBERS THE OPERATOR READS ──────────────────────────────────────────────
check("25. the deviation says what it did, in words, on the banner and the Intent card",
      () => {
        const t = G.edgeText({ offsetM: 7.5, hand: "starboard", early: true, mode: "move" });
        return /7\.5 m to starboard/.test(t) && /moving the next waypoint/.test(t)
            && /edgeText\(a\.edge\)/.test(H) && /DEVIATED/.test(H);
      },
      "a boat that is not where the plan says must say so, and why");

console.log("");
console.log(fails ? (fails + " CHECK(S) FAILED of " + ran) : ("all " + ran + " checks pass"));
process.exit(fails ? 1 : 0);
