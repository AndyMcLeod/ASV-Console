// tests/rule9_scope.js - WHERE COLREGS Rule 9 applies, and where it must not.
//
// Andy, 2026-08-31:
//
//   "Rule 9 is being improperly applied in the current ASV Console implementation. It
//    applies only within narrow channels. ... Rule 9 dictates that a vessel must stay as
//    close to the outer limit of the channel on its starboard (right) side as is safe and
//    practicable. Rule 9(b), (c), and (d) explicitly state that small vessels (<20m) or
//    fishing vessels must not impede larger vessels that can only navigate safely inside
//    the channel. In open bay or open ocean transits and while running various survey
//    patterns the rule should not be considered."
//
// THE GEOMETRY WAS NEVER THE PROBLEM - THE SCOPE WAS. tests/buoy_lane.js already pins the
// lane itself (the quarter-width offset, both directions, the six invariants that each
// cost a live failure). Nothing here touches any of that. This suite is about the two
// questions that come BEFORE it: is this water a narrow channel, and is this leg a transit.
//
//   node tests/rule9_scope.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// WHAT WAS WRONG. `narrowChannelLane` had no width test at all. It marched perpendicular
// and called the water a channel if ANYTHING answered within max(120, buffer*30) on both
// sides - 150 m at the shipped buffer, so 300 m of open bay was "a narrow channel" and got
// a keep-right lane with a banner claiming compliance with a rule of the road. And
// `routePlan` laned every ROUTED DETOUR (`leg.length>1`), which is as true between two
// survey coverage lines as anywhere else, so patterns were laned too.
//
// WHAT IS RIGHT. A narrow channel is not a shape you can infer from two distances:
//   * THE CHART SAYS SO - S-57 FAIRWY (Fairway_area) and DRGARE (Dredged_Area), the
//     objects Rule 9 is written about, plus a buoyed lateral system. Any width.
//   * OR THE WATER IS GENUINELY NARROW - NARROW_MAX_M edge to edge. Rule 9 does not
//     require a channel to be charted, and a 100 m cut between two banks is a narrow
//     channel whether or not an ENC draws a fairway over it.
// and a leg is Rule 9 water only if it is a TRANSIT: a Go-To, an RTH, a drawn transit, or
// the approach out to a pattern. Never the pattern itself.
//
// TEETH: FOURTEEN mutations run against a sidecar of the page, three modules and the
// server; graded on this suite PLUS buoy_lane and turn_channel, since the scope change
// touches all three. The check numbers are the ones that actually went red:
//   routing: drop the narrow-channel gate entirely (the defect) -> 4
//   routing: drop only the WIDTH bound                          -> 4
//   routing: drop only the CHARTED test                         -> 4, buoy_lane
//   routing: widen NARROW_MAX_M back past the old reach         -> 5b
//   routing: inChartedChannel ignores ko.chans                  -> 4b, buoy_lane
//   routing: lane:false also skips the gate and the prune       -> 8, buoy_lane
//   keepouts: a fairway is not a channel                        -> 2
//   keepouts: a fairway is an AREA, so it becomes a keep-out    -> 3
//   passage: lane every routed detour again (patterns laned)    -> 6
//   passage: lane nothing at all (the rule switched off)        -> 6
//   page: the survey pattern rides the lane again               -> 7, turn_channel
//   page: the search pattern rides the lane again               -> 7b
//   server: stop fetching FAIRWY                                -> 1, 1c
//   server: treat a TSS lane as a Rule 9 channel                -> 1, 1c
//
// THREE THINGS THE MUTATIONS FOUND IN THIS SUITE'S OWN FIRST DRAFT:
//   * A GUARD THAT WAS DEAD. `if (r === 'fairway') continue;` was written into
//     buildKeepouts with a comment claiming a fall-through "would make it a polygon
//     keep-out". Removing it changed nothing - a fairway reaches none of those branches -
//     so the comment gave a false reason for a line that did nothing. Deleted; the real
//     risk is `isArea`, and that is what is mutated now.
//   * A FIXTURE THAT COULD NOT DISCRIMINATE. Check 3 ran with area enforcement OFF only,
//     and `if (isArea && !enf.area) continue;` then skipped the mutated fairway - so it
//     passed against code that turned the designated channel into a no-go the moment the
//     operator ticked "Dredged / restricted". It runs both ways now.
//   * A CHECK THAT COULD NOT FAIL. Check 9 read `length_m`, which no vessel file has, and
//     `L == null || L < 20` was true for all three. The value was there all along as
//     `hull.loa_m`; a missing length is a FAILURE now, not a pass.
//
// NOT HERE, AND DELIBERATELY: TCTSBL / Traffic_Separation_* is RULE 10, and RECTRC /
// Recommended_Track is neither a narrow channel nor a fairway. Andy: "There are other
// rules that should apply which we'll deal with later."

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
const { planeFrame } = require("../static/js/geodesy.js");
const { bbOf } = require("../static/js/geometry.js");
const { buildKeepouts, channelPolys } = require("../static/js/keepouts.js");
const { NARROW_MAX_M } = require("../static/js/routing.js");

const R = (f) => fs.readFileSync(path.join(__dirname, "..", "static", "js", f), "utf8");
const ROUTING = R("routing.js"), PASSAGE = R("passage.js"), KEEPOUTS = R("keepouts.js");
const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");
const PY = fs.readFileSync(path.join(__dirname, "..", "asv_console.py"), "utf8");

function grab(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let q = src.indexOf("(", start), par = 0;
  for (;;) { const c = src[q]; if (c === "(") par++; else if (c === ")") { par--; if (!par) break; } q++; }
  let k = src.indexOf("{", q), depth = 0;
  for (;;) { const c = src[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return src.slice(start, k + 1);
}

let fails = 0;
function check(name, cond, detail) {
  let ok = false, err = "";
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : "") + err);
  if (!ok) fails++;
}

console.log("Rule 9 scope - a narrow channel, and a transit. Not a bay, and not a pattern:");

// ---- 1-3. THE CHART NAMES THE CHANNEL -------------------------------------------- //
// A narrow channel is a charted object. S-57 gives it a class, and the console has to
// FETCH that class before it can honour the rule at all.
{
  check("1. the ENC extract fetches FAIRWY (Fairway_area), the object Rule 9 names",
        () => /"fairway":\s*\["Fairway_area"\]/.test(PY),
        "COLREGS Rule 9: 'a narrow channel or fairway' — FAIRWY is that fairway");
  check("1b. ... and DRGARE is already fetched, which is Rule 9(b)'s own test",
        () => /"dredged":\s*\["Dredged_Area"\]/.test(PY),
        "a vessel 'which can safely navigate only within' a channel is one constrained by "
          + "a maintained depth");
  // Rule 10 and good practice are NOT Rule 9, and leaving them out is a decision rather
  // than an omission - Andy: "There are other rules that should apply which we'll deal
  // with later." A future reader adding them here should have to argue for it.
  // ⚠ SCOPED TO CODE, because the ENC_ROLES block NAMES both classes in the comment that
  // explains why they are excluded — and a check that flags the note explaining the fix is
  // one people learn to ignore. Strip Python comments and look at what is actually fetched.
  {
    const roles = PY.slice(PY.indexOf("ENC_ROLES"), PY.indexOf("ENC_KEEP_PROPS"))
                    .split(/\r?\n/).map((l) => l.replace(/#.*$/, "")).join("\n");
    check("1c. ... and TSS / recommended tracks are NOT fetched as Rule 9 channels",
          () => !/Traffic_Separation/.test(roles) && !/Recommended_Track/.test(roles) &&
                /Fairway_area/.test(roles),
          "TCTSBL is Rule 10; RECTRC is neither a narrow channel nor a fairway — and the "
            + "comment saying so is not what is being tested");
  }
}

// ---- the world ------------------------------------------------------------------- //
const F = planeFrame({ lat: 43.07, lon: -70.71 });
const ll = (e, n) => F.fromEN(e, n);
// a rectangle in lon/lat, as an ENC feature of the given role
const feat = (role, e0, n0, e1, n1) => ({
  role,
  geometry: { type: "Polygon", coordinates: [[ll(e0, n0), ll(e1, n0), ll(e1, n1), ll(e0, n1), ll(e0, n0)]
    .map((p) => [p.lon, p.lat])] },
  props: {},
});
const ENF = { land: true, depth: true, haz: true, area: false };

// 2-3. A FAIRWAY IS A CHANNEL, AND IT IS NOT A KEEP-OUT. Those are two different claims
// and the second is the one that would ground the boat: FAIRWY is the water a large vessel
// is DESIGNATED to use, so letting it fall through into the keep-out polygons would refuse
// every route down the middle of a marked channel.
{
  const feats = [feat("fairway", -80, 0, 80, 1000)];
  const chans = channelPolys(F, feats, []);
  check("2. a charted FAIRWAY is a Rule 9 channel",
        () => chans.length === 1 && chans[0].ring.length >= 4,
        chans.length + " channel polygon(s) from one Fairway_area");
  // ⚠ TESTED WITH AREA ENFORCEMENT BOTH OFF AND ON, and the ON case is the one that
  // matters. The first draft only ran it OFF, which masked the mutation it exists to catch:
  // adding 'fairway' to `isArea` beside 'dredged' and 'restricted' looks tidy, and with
  // `area:false` the very next line skips it, so the check passed against code that turned
  // the designated channel into a no-go the moment the operator ticked that box.
  const kos = [["area off", { ...ENF, area: false }], ["area ON", { ...ENF, area: true }]]
    .map(([tag, enforce]) => [tag, buildKeepouts(F, feats, { enforce, depthRange: { min: 0, max: 0 } })]);
  const count = (k) => (k.polys || []).length + (k.lines || []).length + (k.points || []).length;
  check("3. ... and is NOT a keep-out — it is the water the rule sends you INTO",
        () => kos.every(([, k]) => count(k) === 0),
        kos.map(([tag, k]) => tag + ": " + count(k) + " keep-out(s)").join(" · ")
          + " — a fairway as a polygon keep-out refuses every route down a marked channel, "
          + "and enabling dredged/restricted enforcement must not do that");
  // A DREDGED AREA is both: a channel for Rule 9 AND an area the operator may enforce as
  // a keep-out. The two roles are independent and this pins that they stay so.
  const dz = channelPolys(F, [feat("dredged", -80, 0, 80, 1000)], []);
  check("3b. ... while a DREDGED area is a channel too (and stays enforceable as an area)",
        () => dz.length === 1,
        "DRGARE serves the survey depth window and Rule 9 both; the roles are separate");
}

// ---- 4-6. THE APPLICABILITY GATE -------------------------------------------------- //
// Read off the source, because the behavioural half is buoy_lane's checks 5 / 5a: a 100 m
// cut rides +24 m of starboard offset and a 400 m bay reads 0.0. What is pinned here is
// that the DECISION is the one Andy specified, and that it is made before the offset.
{
  const NCL = grab(ROUTING, "narrowChannelLane");
  check("4. the lane fires only where the chart charts a channel OR the water is narrow",
        () => /if \(!\(inChartedChannel\(samp\[i\]\) \|\| rc \+ lc <= NARROW_MAX_M\)\) continue;/.test(NCL),
        "two ways to be a narrow channel, and open water is neither");
  check("4b. ... and 'charted' means ko.chans — FAIRWY / DRGARE / the buoyed system",
        () => /const chans = ko\.chans \|\| \[\];/.test(NCL) && /inChartedChannel/.test(NCL),
        "the same model channelSpanKeepouts uses, not a second opinion about what a channel is");
  // THE BOUND IS A POLICY NUMBER AND IS NAMED AS ONE. COLREGS gives no width, so a
  // threshold has to be chosen; what must not happen is it being buried in a comparison
  // where nobody can find or argue with it.
  check("5. the narrow-channel width bound is a named, documented constant",
        () => Number.isFinite(NARROW_MAX_M) && NARROW_MAX_M > 0 &&
              /POLICY NUMBER/.test(ROUTING) && /export const NARROW_MAX_M/.test(ROUTING),
        NARROW_MAX_M + " m edge to edge — COLREGS defines no width, so this is stated "
          + "rather than implied");
  // ... and it must actually be narrower than the old reach, or nothing changed. The old
  // test was "edges within CONFINE = max(120, buf*30)" on BOTH sides, i.e. up to 2*CONFINE
  // of water. At the shipped 5 m buffer that is 300 m.
  check("5b. ... and it is tighter than the reach the old test called a channel",
        () => NARROW_MAX_M < 2 * Math.max(120, 5 * 30),
        NARROW_MAX_M + " m vs the " + (2 * Math.max(120, 5 * 30))
          + " m of open water the ray-march used to accept");
}

// ---- 6-8. AND ONLY ON A TRANSIT ---------------------------------------------------- //
{
  const RP = grab(PASSAGE, "routePlan");
  check("6. a plan lanes only pure-transit routes and the APPROACH to a pattern",
        () => /if\(keepRightAll \|\| i===0\)\{/.test(RP) && !/leg\.length>1\)\{/.test(RP),
        "`leg.length>1` meant 'routeAround inserted a detour', which is as true between two "
          + "coverage lines as anywhere else — that clause laned survey patterns");
  // Go-To / RTH / a drawn transit still pass keepRightAll, or the rule would apply nowhere.
  // A rule switched off everywhere passes every "it is not over-applied" check ever written.
  check("6b. ... and a pure transit still asks for it — the rule is not switched off",
        () => /routePlan\(\{lat:asv\.lat,lon:asv\.lon\}, transit, true\)/.test(H),
        "the drawn-transit behaviour passes keepRightAll=true");
  const PO = grab(H, "punchOut");
  check("7. a SURVEY pattern's inter-line hop does not ride the lane",
        () => /channelLaneRoute\(\[Ap,\.\.\.around,Bp\], ref, koHere, buffer, \{lane:false\}\)/.test(PO),
        "Andy: 'while running various survey patterns the rule should not be considered'");
  check("7b. ... nor does a SEARCH pattern's",
        () => /channelLaneRoute\(\[A,\.\.\.via,B\], ref, ko, buf, \{lane:false\}\)/.test(H),
        "a search pattern is a pattern");
  // ⚠ AND `lane:false` MUST NOT MEAN "SKIP THE PIPELINE". The three stages after the lane
  // are not Rule 9: smoothTrack thins the route, gateLegClear RE-CHECKS EVERY LEG against
  // the keep-out model, and pruneStitch removes the reversal knots a gate splice can fold
  // in. Dropping the call to drop the lane would trade a safety re-check for a legal
  // correction, which is the wrong way round.
  const CLR = grab(ROUTING, "channelLaneRoute");
  check("8. `lane:false` skips the OFFSET, never the smooth / gate / prune pipeline",
        () => /const laneWanted = opts\.lane !== false;/.test(CLR) &&
              /smoothTrack\(unmarked\.path/.test(CLR) && /gateLegClear\(smoothed/.test(CLR) &&
              /pruneStitch\(g\.route/.test(CLR),
        "the gate is a per-leg keep-out re-check and every route needs it, laned or not");
}

// ---- 9. RULE 9(b): THE VESSEL IS ALWAYS THE SMALL ONE ----------------------------- //
// "small vessels (<20m) ... must not impede larger vessels that can only navigate safely
// inside the channel." Every hull this console drives is well under 20 m, so the duty is
// not conditional - it always binds. Two things follow, and both are already implemented:
// keeping to the starboard outer limit (the lane), and not obstructing the channel by
// crossing it, which is what channelSpanKeepouts does for survey coverage.
{
  const dir = path.join(__dirname, "..", "vessels");
  const hulls = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, v: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }));
  // ⚠ LENGTH OVERALL, AND IT MUST BE PRESENT. The first draft of this check looked for
  // `length_m` and fell back to null, so `L == null || L < 20` was true for every hull and
  // the check could not fail - it passed against three vessel files that recorded no length
  // at all. The detail line is what showed it: three question marks. The value was always
  // there under its proper name, `hull.loa_m`, and a missing one is now a FAILURE rather
  // than a pass, because a hull of unknown length cannot be assumed to be the small one.
  const lens = hulls.map(({ f, v }) => [f, (v.hull && v.hull.loa_m) || null]);
  check("9. every shipped hull is under 20 m, so Rule 9(b)'s duty always binds",
        () => hulls.length >= 2 && lens.every(([, L]) => typeof L === "number" && L > 0 && L < 20),
        lens.map(([f, L]) => f.replace(".json", "") + "=" + (L == null ? "NO LOA" : L + " m")).join(" · ")
          + " — the not-impede duty is unconditional here, never a case to test for");
  check("9b. ... and a survey line that SPANS a channel is clipped out of it (Rule 9(d))",
        () => /export function channelSpanKeepouts/.test(ROUTING) &&
              /spans across.{0,400}?keep-out/is.test(ROUTING),
        "'shall not cross a narrow channel if such crossing impedes' — a contained survey "
          + "is untouched, because surveying a channel is a lawful thing to be asked for");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
