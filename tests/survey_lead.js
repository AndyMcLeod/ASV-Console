// tests/survey_lead.js - LEAD-IN / LEAD-OUT: the run is longer than the coverage.
//
// Andy, 2026-09-08: "implement lead in and lead out extensions to survey lines a selection
// on the survey card. They are meant to extend lines to accommodate settling of vessel
// steering onto path and settling of IMU stability after a turn. The user should have
// options in the survey card to select distance or duration."
//
// The first stretch of a survey line is not usable data: coming out of the reversal the
// steering is still settling onto the track and the IMU is still settling with it. So the
// RUN is extended past both ends of the COVERAGE, and from that moment those are two
// different lengths of two different pieces of water - which is where every fault in this
// feature lives. This suite is about the seam between them:
//
//   * a lead is FLOWN water, so it is clipped against the chart like flown water. An
//     extension nobody checked is an extension into a pier.
//   * a lead is NOT COVERAGE, so the sensor figures, the hull's minimum survey line, the
//     card's "Line len", and the `surveying` flag must all still mean coverage.
//   * a lead IS the survey speed, because settling the boat at any other speed settles it
//     at the wrong one - so the speed ROLE stays "survey" while `surveying` goes false.
//     Two fields, two questions, and the console already had both.
//
//   node tests/survey_lead.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH — 28 mutations against a SIDECAR (ASV_HTML), all killed, 2026-09-08. Six of them
// are graded by OTHER suites, because that is where the seam they break is driven:
// tests/strike_run.js 24b-24e (the coverage midpoint a strike is matched on) and
// tests/survey_transit_roles.js 15-15e (the real accumLineTime / currentLegLine, flown).
// The twenty-two graded here:
//   leadMetres always returns 0 (the CONTROL)                -> 5a, 5, 6, 8
//   convert a duration at the TRANSIT speed                  -> 5, 8
//   convert a duration at the TURN speed                     -> 5, 8
//   drop the clamp, so a typo of 20000 extends 20 km         -> 6
//   let a negative through, shortening the coverage          -> 7
//   extend without asking the chart at all                   -> 10, 11
//   take any clear stretch, not the one reachable            -> 11
//   clip against koClip (the SURVEY model) not koTurn        -> 15
//   leave the ENC pad at a bare 120 m                        -> 16
//   stop counting the leads the chart cut short              -> 31
//   report the RUN length as the line's coverage             -> 18
//   time the plan column on coverage, not on the run         -> 19
//   report the RUN as the card's "Line len"                  -> 20
//   claim coverage through the lead-in / the lead-out        -> 22+24b / 24
//   fly the lead-in at the TRANSIT speed                     -> 23
//   measure the far end with the lead-IN                     -> 24c
//   read the CARD's lead instead of the committed line's     -> 24
//   commit leads for an UN-PUNCHED plan                      -> 28
//   hard-code lead_mode in the client rebuild                -> 25
//   restore the controls numbers-first                       -> 25b
//   leave the stale punch alive after a lead change          -> 4
//
// ⚠ TWO OF THOSE SURVIVED THE FIRST SWEEP, and both were checks standing in for behaviour:
//   * 24 probed the lead-out at 390 m of a 400 m run, which is past BOTH ends' boundaries,
//     so a phase test reading the lead-IN at the far end passed. 24c probes 375 m — the
//     metre that separates a 30 m lead-in from a 20 m lead-out.
//   * 25 matched a bare `lead_mode:` and passed against a rebuild that hard-coded "m". The
//     field was present and every stored duration came back as metres.
//
// NOT mutation-verified, and named here rather than left to look covered: 13, 14 and 14b
// compare SOURCE POSITIONS inside punchOut (the lead must be applied after the min-line and
// strike filters and before the turn loop). A mutation that moves a block is not a text
// substitution, so those three are argued, not driven. What they guard IS driven elsewhere:
// strike_run 24b-24e drives the coverage-midpoint seam the strike order exists for.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// "No FAIL lines" and "the process died" are indistinguishable to anything reading
// stdout, so a mutation that crashes this suite would otherwise score as SURVIVED.
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

// ASV_HTML points this at a SIDECAR copy for a mutation run. Every read of the page goes
// through it - a suite with one parameterised read and one hard-coded one reports every
// mutation as SURVIVED, which is a broken instrument reading the same number for every
// input rather than a suite with weak checks. (ais_table.js, 2026-09-08, twelve of them.)
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
// Line endings normalised: several checks below regex the source with a BOUNDED window to
// say "these two things are near each other", and a CRLF checkout adds a character a line.
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const PY = fs.readFileSync(path.join(__dirname, "..", "asv_console.py"), "utf8");

// THE REAL MODULES, not source text lifted out of the page. A renamed or deleted export
// fails HERE, at load, rather than quietly resolving to a stale copy.
const { distTo, azTo, atDA, llEN, fromEN, planeFrame } = require("../static/js/geodesy.js");
const { blocked, buildKeepouts } = require("../static/js/chart.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try {
    ok = !!(typeof cond === "function" ? cond() : cond);
    note = typeof detail === "function" ? detail() : detail;
  } catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}

function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  const m = H.match(new RegExp("^(?:const|let|var)\\s+" + name + "\\s*=[^;]*;", "m"));
  if (!m) throw new Error("test setup: declaration " + name + " not found (renamed?)");
  return m[0];
}

// ---- the page's world, as the lead code reads it ------------------------------------ //
const V = { SPEED_KN: { low: 4.0, survey: 7.0, high: 14.0 } };
var mission = { lines: [], speeds: { transit: "high", turn: "low", survey: "survey" },
                lead_mode: "m", lead_in: 0, lead_out: 0 };
var lineActual = [], runLineIdx = -1, curTurn = -1, turnSeg = [], lastRunLine = -1;
var S = null, asv = null;
function fmtDist(m) { return Math.round(m) + " m"; }

// The page's own bodies, run for real. clipLine is the primitive extendLead delegates its
// whole safety argument to, so it is grabbed rather than restated - a reimplementation here
// would agree with itself and say nothing about the console.
// eslint-disable-next-line no-eval
eval([
  grabDecl("LEAD_MAX_M"),
  grab("roleSpeed"), grab("roleSpeedMS"),
  grab("leadMetres"), grab("leadInM"), grab("leadOutM"),
  grab("alongLineM"), grab("linePhase"),
  grab("clipLine"), grab("extendLead"),
  grab("buildLineTable"), grab("committedPatternInfo"),
  grab("currentActivity"),
  "function __setMission(m){ mission = m; }",
  // A `const` declared inside a direct eval stays in the EVAL's scope — only the function
  // declarations bind out here — so this is how the checks below read the page's OWN cap
  // rather than a copy restated in this file, which would agree with itself and say
  // nothing about what ships.
  "function __leadMax(){ return LEAD_MAX_M; }",
].join("\n"));

console.log("LEAD-IN / LEAD-OUT — the run is longer than the coverage:");

// ── 1-4. THE CONTROL IS ON THE SURVEY CARD, AND IT OFFERS BOTH UNITS ───────────────
{
  const card = H.slice(H.indexOf('id="linePanel"'), H.indexOf('id="sp_punch"'));
  check("1. the survey card carries a lead-in and a lead-out field",
        () => /id="sp_lead_in"/.test(card) && /id="sp_lead_out"/.test(card),
        "both, on the card the operator plans from — Andy's \"a selection on the survey card\"");
  check("2. ... and a unit selector offering DISTANCE or DURATION",
        () => /id="sp_lead_mode"/.test(card)
              && /<option value="m"[^>]*>m<\/option>/.test(card)
              && /<option value="s"[^>]*>s<\/option>/.test(card),
        "m / s — \"options in the survey card to select distance or duration\"");
  // A DURATION IS NOT A LENGTH until something names the speed it was converted at. The
  // note is the only place the operator can check that 20 s became the metres they meant.
  const note = grab("updateLeadNote");
  check("3. the card says what the setting comes to in METRES, and at what speed",
        () => /sp_lead_note/.test(card) && /m\/s/.test(note) && /roleSpeed\("survey"\)/.test(note),
        "otherwise \"20\" on the card and 41 m on the water are two unrelated numbers");
  // One writer per control, mirroring setBuffer / setMinDepth. The punch MUST be thrown
  // away: a lead is geometry, so a changed lead is a different plan, and a live patClip
  // would let Add to plan commit runs built to the previous setting.
  const setLead = grab("setLead"), setMode = grab("setLeadMode");
  check("4. changing a lead persists it and invalidates the punch",
        () => /saveMission\(\)/.test(setLead) && /patClip = null/.test(setLead)
              && /saveMission\(\)/.test(setMode) && /patClip = null/.test(setMode)
              && /\$\("#sp_lead_in"\)\.onchange/.test(H)
              && /\$\("#sp_lead_mode"\)\.onchange/.test(H),
        "both writers save and drop patClip; both controls are wired to them");
}

// ── 5-8. DISTANCE OR DURATION, AND THE DURATION IS THE SURVEY SPEED ────────────────
// The lead exists so the boat is settled AT THE SPEED IT SURVEYS AT by the first usable
// ping. Timing it at the transit speed (14 kn here) or the turn speed (4 kn) gives a lead
// of the wrong length by construction - and the three roles are deliberately DIFFERENT in
// this fixture so the check can tell which one was used.
{
  mission.lead_mode = "m"; mission.lead_in = 40; mission.lead_out = 25;
  check("5a. in METRES the figure is the distance, untouched",
        () => leadInM() === 40 && leadOutM() === 25,
        "in " + leadInM() + " m, out " + leadOutM() + " m");

  mission.lead_mode = "s"; mission.lead_in = 20; mission.lead_out = 10;
  const surveyMS = 7.0 * 0.514444, transitMS = 14.0 * 0.514444, turnMS = 4.0 * 0.514444;
  check("5. in SECONDS it converts at the SURVEY speed — not transit, not turn",
        () => Math.abs(leadInM() - 20 * surveyMS) < 0.01
              && Math.abs(leadOutM() - 10 * surveyMS) < 0.01,
        "20 s → " + leadInM().toFixed(1) + " m (survey " + surveyMS.toFixed(2)
        + " m/s). transit would give " + (20 * transitMS).toFixed(1)
        + " m, turn " + (20 * turnMS).toFixed(1) + " m");

  mission.lead_mode = "m"; mission.lead_in = 20000;
  check("6. a typo cannot extend a survey line by kilometres",
        () => leadInM() === __leadMax() && __leadMax() > 0 && __leadMax() <= 5000,
        "20000 m clamped to " + leadInM() + " m (the page's own LEAD_MAX_M = "
        + __leadMax() + ")");

  mission.lead_in = -5;
  const neg = leadInM();
  mission.lead_in = "";
  const blank = leadInM();
  mission.lead_in = "abc";
  const junk = leadInM();
  check("7. a negative, a blank and a junk value are all NO LEAD",
        () => neg === 0 && blank === 0 && junk === 0,
        "-5 → " + neg + ", \"\" → " + blank + ", \"abc\" → " + junk
        + " — never a negative extension, which would shorten the coverage");

  mission.lead_mode = "s"; mission.lead_in = 20;
  const atSurvey = leadInM();
  mission.speeds = { transit: "high", turn: "low", survey: "high" };
  const atHigh = leadInM();
  mission.speeds = { transit: "high", turn: "low", survey: "survey" };
  check("8. ... and a duration FOLLOWS the survey speed when the operator changes it",
        () => atHigh > atSurvey * 1.9,
        "20 s = " + atSurvey.toFixed(1) + " m at survey, " + atHigh.toFixed(1)
        + " m at high — which is why the stored value is the SECONDS, not the metres");
  mission.lead_mode = "m"; mission.lead_in = 0; mission.lead_out = 0;
}

// ── 9-12. A LEAD IS FLOWN WATER, SO IT IS CLIPPED LIKE FLOWN WATER ─────────────────
// The clipped run ends where it does for one of two reasons - the operator's box ran out,
// or the chart said stop - and only the first is safe to extend past. Nothing can tell
// those apart from the endpoint alone, so extendLead does not try: it asks the keep-out
// model sample by sample, exactly as clipLine builds the runs themselves.
{
  const ref = planeFrame({ lat: 43.07, lon: -70.76 });
  const ll = (e, n) => fromEN(e, n, ref);
  const ringLonLat = pts => [pts.map(([e, n]) => { const p = ll(e, n); return [p.lon, p.lat]; })];
  // A block of land 60 m NORTH of the line's north end, running the full width.
  const landRing = [[-200, 360], [200, 360], [200, 500], [-200, 500], [-200, 360]];
  const feats = [{ role: "land", cls: "Land_Area", props: {},
                   geometry: { type: "Polygon", coordinates: ringLonLat(landRing) } }];
  const enf = { land: true, depth: true, haz: true, area: false };
  const ko = buildKeepouts(ref, enf, { min: 2.0, max: 0 }, feats);
  const buffer = 3;

  // Two S→N runs. The first ends 300 m from the land; the second ends 20 m from it.
  const clearRun = [ll(-100, 0), ll(-100, 300)];      // 60 m of clear water past its end
  const tightRun = [ll(100, 0), ll(100, 300)];        // same — the land is at n=360
  // (both ends sit 60 m short of the land; the difference below is how much is ASKED)

  const wantSmall = 30, wantBig = 200;
  const got30 = extendLead(clearRun[1], clearRun[0], wantSmall, ref, ko, buffer);
  check("9. a lead into clear water buys the whole thing, on the line's own bearing",
        () => Math.abs(got30.m - wantSmall) < 1.5
              && Math.abs(azTo(clearRun[0], got30.p) - azTo(clearRun[0], clearRun[1])) < 0.5,
        "asked " + wantSmall + " m, got " + got30.m.toFixed(1) + " m at "
        + azTo(clearRun[0], got30.p).toFixed(2) + "° (line bears "
        + azTo(clearRun[0], clearRun[1]).toFixed(2) + "°)");

  const gotBig = extendLead(tightRun[1], tightRun[0], wantBig, ref, ko, buffer);
  check("10. a lead into a keep-out comes back SHORT rather than crossing it",
        () => gotBig.m > 10 && gotBig.m < 60
              && !blocked(llEN(gotBig.p.lat, gotBig.p.lon, ref), ko, buffer),
        "asked " + wantBig + " m, got " + gotBig.m.toFixed(1)
        + " m — the land edge is 60 m out and the buffer is " + buffer
        + " m, and the point it stopped at is clear");

  // A clear patch further out with an obstacle in between is water this line cannot reach.
  const insideEnd = ll(0, 420);                       // an endpoint INSIDE the land block
  const gotFrom = extendLead(insideEnd, ll(0, 0), 200, ref, ko, buffer);
  check("11. only the stretch that STARTS at the line's end counts",
        () => gotFrom.m === 0,
        "extending out of a blocked endpoint bought " + gotFrom.m
        + " m — clipLine will happily report clear water past the obstacle, and that "
        + "water is not reachable along this line");

  const tiny = extendLead(clearRun[1], clearRun[0], 0.4, ref, ko, buffer);
  check("12. a sub-metre lead is no lead",
        () => tiny.m === 0 && tiny.p === clearRun[1],
        "0.4 m → " + tiny.m + " m, and the endpoint is returned unchanged "
        + "(clipLine reports nothing under a metre of segment)");
}

// ── 13-16. WHERE IT IS APPLIED, WHICH IS THE WHOLE DESIGN ─────────────────────────
// Order is not a style question here. Each of these four has a different wrong answer that
// looks right on a plan that does not use the feature.
{
  const punch = grab("punchOut");
  const iMin = punch.indexOf("const nShort = shortened.length");
  const iLead = punch.indexOf("patLead = patClip.map(");
  const iStrike = punch.indexOf("const runs = keptRuns(clipped)");
  const iTurns = punch.indexOf("for(let k=0;k<patClip.length-1;k++)");

  check("13. the lead is applied AFTER the hull's minimum-survey-line filter",
        () => iMin > 0 && iLead > iMin,
        "min-line at " + iMin + ", lead at " + iLead + " — a 40 m run with a 30 m lead at "
        + "each end is a 40 m SURVEY line, and must still be dropped for the reason it "
        + "always was");
  check("14. ... and AFTER the strike filter, so a struck run is matched on its coverage",
        () => iStrike > 0 && iLead > iStrike,
        "strike at " + iStrike + ", lead at " + iLead + " — the strike list holds COVERAGE "
        + "midpoints (strike_run 24b: an uneven lead moves the run midpoint 17.5 m)");
  check("14b. ... and BEFORE the turns, so every reversal is built from the run's ends",
        () => iTurns > 0 && iLead < iTurns,
        "lead at " + iLead + ", turn loop at " + iTurns + " — the turn happens past the "
        + "coverage, which is the point of the whole feature");

  // A lead is not coverage; it is the water that CONNECTS coverage to a turn, which is
  // exactly what koTurn models. koClip would refuse a lead for a SURVEY reason (a channel
  // the operator chose not to survey) rather than a navigation one.
  check("15. the lead is clipped against koTurn — the water the turn it leads into uses",
        () => /extendLead\(seg\[0\], seg\[1\], wantIn,\s*ref, koTurn, buffer\)/.test(punch)
              && /extendLead\(seg\[1\], seg\[0\], wantOut, ref, koTurn, buffer\)/.test(punch),
        "both ends, koTurn — and note the SECOND call is aimed from b back toward a, so "
        + "the lead-out extends the far way");

  // ⚠ THE PAD. Outside the fetched extract the keep-out model is EMPTY, which reads as
  // "clear" rather than as "unknown" - so a lead longer than the pad is certified over
  // chart nobody asked for.
  const ensure = grab("ensureNogoArea");
  check("16. the ENC fetch pad covers the lead, so no lead is checked off the extract",
        () => /encBbox\(120 \+ Math\.max\(leadInM\(\), leadOutM\(\)\)\)/.test(ensure),
        "an empty extract is indistinguishable from clear water — a 200 m lead-out past a "
        + "120 m pad would be validated over 80 m of nothing");
}

// ── 17-20. COVERAGE IS COVERAGE, AND THE CARD MUST NOT INFLATE IT ─────────────────
{
  const ref = planeFrame({ lat: 43.07, lon: -70.76 });
  const ll = (e, n) => fromEN(e, n, ref);
  // Three 400 m runs: two with a 30 m / 20 m lead, one with none.
  __setMission({
    lines: [
      { a: ll(0, 0),   b: ll(0, 400),   lead_in_m: 30, lead_out_m: 20 },
      { a: ll(30, 400), b: ll(30, 0),   lead_in_m: 30, lead_out_m: 20 },
      // The un-led line is SHORTER than the led ones' runs on purpose: with it at 400 m
      // too, "longest coverage" and "longest run" would be the same number and check 20
      // would pass against either answer.
      { a: ll(60, 0),  b: ll(60, 300),  lead_in_m: 0,  lead_out_m: 0 },
    ],
    speeds: { transit: "high", turn: "low", survey: "survey" },
    lead_mode: "m", lead_in: 30, lead_out: 20,
  });
  lineActual = [0, 0, 0];
  const t = buildLineTable();
  const spd = 7.0 * 0.514444;

  check("17. the LINES table reports a lead column only where there IS a lead",
        () => t[0].lead_m === 50 && t[1].lead_m === 50 && t[2].lead_m === 0,
        "leads: " + t.map(r => r.lead_m).join(", ") + " m");
  check("18. \"len m\" stays COVERAGE — the run minus both leads",
        () => t[0].len_m === 350 && t[2].len_m === 300,
        "run 400 m, lead 30 + 20 → len " + t[0].len_m + " m; the un-led 300 m line reads "
        + t[2].len_m + " m — a run length here would inflate the survey by twice the lead");
  check("19. ... and \"plan\" times the whole RUN, because \"actual\" is clocked over it",
        () => Math.abs(t[0].plan_s - 400 / spd) < 1 && Math.abs(t[2].plan_s - 300 / spd) < 1,
        "plan " + t[0].plan_s + " s = 400 m / " + spd.toFixed(2) + " m/s. Timing the "
        + "coverage would read " + Math.round(350 / spd) + " s against an actual the boat "
        + "spends on the whole line — two columns measuring different water");

  const info = committedPatternInfo();
  check("20. the survey card's \"Line len\" is coverage too",
        () => Math.abs(info.legLength - 350) < 1,
        "longest coverage " + info.legLength.toFixed(0) + " m across " + info.count
        + " lines — the longest RUN is 400 m, so reporting the run would read 400");
}

// ── 21-24. ON A LINE IS NOT THE SAME AS ACQUIRING COVERAGE ────────────────────────
// `surveying` is the flag that paints the readout green and titles it "acquiring
// coverage". A lead-in is deliberately not coverage. The ROLE stays "survey" regardless,
// because the lead has to be flown at the speed the coverage is flown at or it settles the
// boat onto the wrong one. Two fields, two questions - which is why they are two.
{
  const ref = planeFrame({ lat: 43.07, lon: -70.76 });
  const ll = (e, n) => fromEN(e, n, ref);
  __setMission({
    lines: [
      { a: ll(0, 0), b: ll(0, 400), lead_in_m: 30, lead_out_m: 20 },
      { a: ll(30, 0), b: ll(30, 400), lead_in_m: 0, lead_out_m: 0 },
    ],
    speeds: { transit: "high", turn: "low", survey: "survey" },
    lead_mode: "m", lead_in: 30, lead_out: 20,
  });
  S = { behavior: "survey", run: "running", status: {} };
  curTurn = -1; turnSeg = []; lastRunLine = -1;

  const at = (k, alongM) => { runLineIdx = k; asv = ll(k === 0 ? 0 : 30, alongM);
                              return currentActivity(); };

  const inLead = at(0, 12);
  check("21. the phase is read off the COMMITTED line, and 12 m along a 30 m lead is lead-in",
        () => inLead.activity === "lead-in" && /settling onto line 1 of 2/.test(inLead.detail),
        "\"" + inLead.detail + "\"");
  check("22. ... and it is NOT acquiring coverage",
        () => inLead.surveying === false,
        "surveying=" + inLead.surveying + " — this flag titles the readout "
        + "\"acquiring coverage\", and through the lead-in that would be a claim about "
        + "data the operator has just said not to trust");
  check("23. ... but the SPEED ROLE is still survey, or the lead settles nothing",
        () => inLead.role === "survey",
        "role=" + inLead.role + " — flown at the transit speed the boat arrives at the "
        + "coverage settled onto the wrong speed, which is what the lead is there to avoid");

  const mid = at(0, 200), out = at(0, 390), plain = at(1, 5);
  check("24. coverage, lead-out and a line with NO lead each answer correctly",
        () => mid.surveying === true && /on coverage line 1 of 2/.test(mid.detail)
              && out.activity === "lead-out" && out.surveying === false && out.role === "survey"
              && plain.surveying === true && /on coverage line 2 of 2/.test(plain.detail),
        "200 m → " + mid.activity + "/" + mid.surveying + ", 390 m → " + out.activity
        + "/" + out.surveying + ", un-led line at 5 m → " + plain.activity + "/"
        + plain.surveying + " (a plan committed before this feature is all coverage, "
        + "which is what leaves every old mission untouched)");

  // The boundary, named: 30 m in is the FIRST metre of coverage, not the last of the lead.
  const justIn = at(0, 30.5), justOut = at(0, 29.5);
  check("24b. the coverage starts AT the lead length, not a metre either side of it",
        () => justIn.surveying === true && justOut.surveying === false,
        "29.5 m → " + justOut.activity + ", 30.5 m → " + justIn.activity
        + " on a 30 m lead-in");

  // ⚠ AND THE FAR END IS MEASURED WITH ITS OWN NUMBER. The lead-in is 30 m and the
  // lead-out 20 m, so the coverage ends at 380 m, not at 370. Probing at 390 cannot tell
  // those apart — both are past both boundaries — and a phase test that read the lead-IN
  // at the far end survived a mutation sweep against a check that only probed there.
  // 375 m is the metre that separates them, and it is COVERAGE.
  const between = at(0, 375);
  check("24c. the lead-OUT is measured with the lead-out, not with the lead-in",
        () => between.surveying === true && between.activity === "surveying",
        "375 m on a 400 m run, lead-in 30 / lead-out 20 → " + between.activity
        + ". Coverage ends at 380 m; reading the lead-IN at this end would end it at 370 "
        + "and call this lead-out");
  runLineIdx = -1; asv = null; S = null;
}

// ── 25-29. IT SURVIVES A RELOAD, AND ONLY A PUNCHED PLAN CARRIES ONE ──────────────
// A field has to be in ALL FOUR whitelists - the client rebuild, the server load, the
// server's empty-file default and the server save - or it is dropped by whichever one
// forgot it, silently, on the next refresh.
{
  const load = grab("loadMission");
  // ⚠ EACH ONE MUST CARRY THE VALUE OUT OF THE PAYLOAD, which is not the same as being
  // mentioned. A first cut of this check matched a bare `lead_mode:` and survived a
  // mutation that hard-coded `lead_mode:"m"` — the field was present, the whitelist was
  // "complete", and every duration a mission had stored came back as metres.
  check("25. the client's mission rebuild carries all three lead fields FROM the payload",
        () => /lead_mode:\(m\.lead_mode/.test(load) && /lead_in:m\.lead_in/.test(load)
              && /lead_out:m\.lead_out/.test(load),
        "the rebuild is an explicit whitelist — a field absent from it is DROPPED, and one "
        + "present but not read from `m` is worse: it looks carried and is a constant");
  check("25b. ... and puts them back on the controls, mode FIRST",
        () => load.indexOf('$("#sp_lead_mode").value') > 0
              && load.indexOf('$("#sp_lead_mode").value') < load.indexOf('$("#sp_lead_in").value'),
        "the two numbers mean different lengths depending on the mode, so a mode restored "
        + "after them leaves the note quoting metres for a duration");

  const pyLoad = PY.slice(PY.indexOf("def load_mission()"), PY.indexOf("def plan_completion()"));
  const pySave = PY.slice(PY.indexOf("def save_mission("), PY.indexOf("def save_mission(") + 1400);
  // The KEY position, not the word — the read path writes "lead_mode" twice on one line
  // (once as the key, once inside m.get), and counting the word would call one literal two.
  const nLoad = (pyLoad.match(/^\s*"lead_mode":/gm) || []).length;
  check("26. the server load AND its empty-file default both carry them",
        () => nLoad === 2 && /"lead_in": m\.get\("lead_in", 0\)/.test(pyLoad)
              && /"lead_mode": "m", "lead_in": 0, "lead_out": 0/.test(pyLoad),
        nLoad + " literal(s) assigning lead_mode in load_mission — the read path and the "
        + "no-file default are two separate dicts and both must have it");
  check("27. ... and the server SAVE writes them back",
        () => /"lead_mode"/.test(pySave) && /"lead_in"/.test(pySave) && /"lead_out"/.test(pySave),
        "a field the save drops survives exactly until the next write");

  // The per-line lengths ride in `lines`, which the server passes through wholesale.
  const commit = grab("commitPattern");
  check("28. a committed line carries the lead ACTUALLY APPLIED — and only if punched",
        () => /const leads = patClip \? patLead : null;/.test(commit)
              && /lead_in_m: ld\.in \|\| 0, lead_out_m: ld\.out \|\| 0/.test(commit),
        "an un-punched plan gets NO lead: the lead's whole safety argument is the chart "
        + "check that produced it, and one attached to lines nobody clipped would be an "
        + "extension into water nobody looked at, wearing the same field name");
  check("29. ... and a missing per-line lead reads as none, never as undefined",
        () => /\(leads && leads\[k\]\) \|\| NO_LEAD/.test(commit)
              && /patLead\[k\] \|\| NO_LEAD/.test(grab("patCoverSeg")),
        "patLead is parallel to patClip and to nothing else, so every read of it is total");
}

// ── 30-31. THE OPERATOR IS TOLD WHAT THEY BOUGHT, AND WHAT THEY DID NOT ───────────
{
  const punch = grab("punchOut");
  check("30. the punch readout names the lead as RUN, not as coverage",
        () => /lead \$\{wantIn\.toFixed\(0\)\} m in \/ \$\{wantOut\.toFixed\(0\)\} m out/.test(punch)
              && /run only — not coverage/.test(punch),
        "every other number on that line is coverage gained or lost; this one is distance "
        + "paid for and not surveyed, and would read as the first kind unnamed");
  check("31. ... and says out loud when the chart cut one short",
        () => /nLeadCut\+\+/.test(punch) && /cut short of the full lead by the chart/.test(punch),
        "a lead trimmed in silence is a settling distance the operator believes they have");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
