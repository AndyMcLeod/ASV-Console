// tests/survey_order.js - the ORDER a survey plan is run in, and what decides it (2026-09-16).
//
// Andy: "Describe in detail how a route plan is made based on an uploaded survey plan. What determines waypoint and
// line sequencing." The answer is written down in README.md ("How the plan becomes the route the boat runs"), the
// operations manual's 9.9 and the technical manual's 8.3. THIS SUITE PINS IT, so those pages cannot go on describing
// an order the code has stopped producing - and it measured two answers that nobody had written down before:
//   * where a punched survey STARTS depends on which side of line 1 the pattern fills, not on the start corner alone;
//   * deleting a committed line in WPT leaves the turns either side of it, so the vessel still travels its track.
// DRIVEN: the page's own surveyPattern (static/asv.html) and regionOrder (static/js/passage.js) over the console's own
// flat geodesy (static/js/geodesy.js), plus currentLegLine with its world stubbed; the commit, upload and punch wiring
// is read from the source.
//
//   node tests/survey_order.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ASV_HTML and PASSAGE_JS point this at SIDECAR copies for a mutation run - every read of those two files goes
// through them.
//
// TEETH - 20 sidecar mutations RUN (ASV_HTML / PASSAGE_JS), 20/20 caught, none by a crash:
//   the survey starts in the cell with the HIGHEST index -> 4, 4b   every cell swept from its HIGHEST line -> 1, 2, ...
//   the across axis points away from the third click -> 1-5b        runs never re-oriented against the exit -> 3, 5
//   the FARTHEST cell taken next -> 4, 4b                           a cell swept from whichever end is nearer -> 4
//   a line index with no runs closes the cells -> 5b                the first-cell tie-break reversed -> 4b
//   Upload lanes every leg of a pattern -> 8                        Upload sends the raw waypoints -> 8
//   joining points committed before the run's ends -> 7             Add to plan replaces the plan -> 7
//   the leads not committed -> 7                                    an un-punched pattern commits nothing -> 7
//   deleting a line takes the turns with it -> 7b                   a leg matches a line one way only -> 9
//   the line-match tolerance 10 m -> 9                              the reversal test at 60 degrees -> 10
//   the reversal gap three spacings -> 10                           the turn margin a whole spacing -> 10
//   (2026-09-16) Add to plan refusing EVERY punch -> 7 - its world commits a finished punch with nothing red, through
//   the real punchRefusal; what IS refused, and when, is tests/turn_refusal.js
// ⚠ ONE PREDICTION WAS WRONG, AND THE RUN SAID SO: "the survey starts in the highest cell" was expected to redden 1 and
// 2 and reddened 4 and 4b instead - with no keep-outs a pattern is ONE cell, so which cell comes first cannot move its
// start. What does is the sweep inside the cell, which is why that mutation was added and does redden 1 and 2.
//
// NOTE: the page's script is <script type="module">, which runs STRICT; these functions are evaluated strict here.

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
const G = require("../static/js/geodesy.js");     // pure: Node can load it directly (see its header)

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const PASSAGE_JS = process.env.PASSAGE_JS || path.join(__dirname, "..", "static", "js", "passage.js");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const PJ = fs.readFileSync(PASSAGE_JS, "utf8").split("\r\n").join("\n");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond);
        note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}
function grab(src, name) {
  let start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (src.slice(start - 6, start) === "async ") start -= 6;
  let k = src.indexOf("{", start), depth = 0;
  for (;;) { const c = src[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return src.slice(start, k + 1);
}
function decl(src, re) {
  const m = src.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}

console.log("The order a survey is run in:");

// ── the page's own generator and orderer ──
// eslint-disable-next-line no-new-func
const surveyPattern = new Function("distTo", "azTo", "atDA",
  "\"use strict\";\n" + decl(H, /^const MAX_SURVEY_LINES = [^;]*;/m) + "\n" + grab(H, "surveyPattern")
  + "\nreturn surveyPattern;")(G.distTo, G.azTo, G.atDA);
// eslint-disable-next-line no-new-func
const regionOrder = new Function("distTo", "llEN",
  "\"use strict\";\n" + grab(PJ, "regionOrder") + "\nreturn regionOrder;")(G.distTo, G.llEN);

// A world in metres: x east, y north of the start corner A.
const A = { lat: 43.07, lon: -70.71 };
const at = (x, y) => G.atDA(G.atDA(A, y, 0), x, 90);
const REF = at(0, 200);
const same = (p, q) => G.distTo(p, q) < 0.5;
const xy = (p) => { const e = G.llEN(p.lat, p.lon, A); return Math.round(e.e) + "," + Math.round(e.n); };
const order = (runs, sp) => regionOrder(runs.map((r) => [r[0], r[1]]), REF, sp.direction, sp.spacing, () => true).ordered;
const lineOf = (sp, run) => sp.lines.findIndex((l) => (same(l[0], run[0]) && same(l[1], run[1]))
                                                   || (same(l[0], run[1]) && same(l[1], run[0])));
const asDrawn = (sp, run) => { const i = lineOf(sp, run); return i >= 0 && same(sp.lines[i][0], run[0]); };
const antiParallel = (r, s) => Math.abs(((G.azTo(s[0], s[1]) - G.azTo(r[0], r[1]) + 360) % 360) - 180) < 1;
const label = (sp, runs) => runs.map((r) => (lineOf(sp, r) + 1) + (asDrawn(sp, r) ? "" : "r")).join(" ");

// The third click 40 m due EAST of A: 40 m spacing, lines running north-south.
const C = at(40, 0);

// 1. the pattern fills TOWARD the third click
const toward = surveyPattern(A, at(170, 400), C, 0);
const o1 = order(toward.lines, toward);
check("1. a pattern that fills TOWARD the third click is punched to start on line 1 at the start corner, as drawn, and "
      + "runs its lines in order",
      () => toward.count === 5 && o1.length === 5 && o1.every((r, i) => lineOf(toward, r) === i && asDrawn(toward, r))
            && same(o1[0][0], A),
      () => toward.count + " lines; order " + label(toward, o1) + "; starts at " + xy(o1[0][0]));

// 2. ... and AWAY from it
const away = surveyPattern(A, at(-170, 400), C, 0);
const o2 = order(away.lines, away);
check("2. one that fills AWAY from the third click is punched to start on its LAST line - the far side of the box - and "
      + "works back to line 1 at the start corner (the outermost line on the side away from the click comes first)",
      () => away.count === 5 && o2.length === 5
            && o2.every((r, i) => lineOf(away, r) === away.count - 1 - i && asDrawn(away, r))
            && same(o2[4][0], A) && !same(o2[0][0], A),
      () => away.count + " lines; order " + label(away, o2) + "; starts at " + xy(o2[0][0]));

// 3. orientation comes from the previous exit, not from how a run was handed in
const northward = toward.lines.map((l) => (l[0].lat < l[1].lat ? [l[0], l[1]] : [l[1], l[0]]));
const o3 = regionOrder(northward, REF, toward.direction, toward.spacing, () => true).ordered;
check("3. every run after the first is ENTERED at its end nearer the previous exit: handed five runs all pointing north, "
      + "the first is flown as handed and the rest alternate",
      () => same(o3[0][0], northward[0][0])
            && o3.every((r, i) => i === 0 || G.distTo(o3[i - 1][1], r[0]) <= G.distTo(o3[i - 1][1], r[1]))
            && o3.every((r, i) => i === 0 || antiParallel(o3[i - 1], r)),
      () => o3.map((r) => xy(r[0]) + ">" + xy(r[1])).join("  "));

// 4. a keep-out splitting the interior lines: separate cells, greedy between them, each swept from its lowest line
const split = [];
for (let i = 0; i < 6; i++) {
  const x = i * 40, up = i % 2 === 0;
  const parts = (i >= 1 && i <= 3) ? [[0, 150], [250, 400]] : [[0, 400]];
  for (const [y0, y1] of parts) split.push(up ? [at(x, y0), at(x, y1)] : [at(x, y1), at(x, y0)]);
}
const o4 = regionOrder(split, REF, 0, 40, () => true).ordered;
const want4 = ["0,0>0,400", "40,400>40,250", "80,250>80,400", "120,400>120,250",
               "40,150>40,0", "80,0>80,150", "120,150>120,0", "160,0>160,400", "200,400>200,0"];
const got4 = o4.map((r) => xy(r[0]) + ">" + xy(r[1]));
check("4. a keep-out across lines 2-4 splits the survey into CELLS: the nearer cell next, each swept from its lowest "
      + "line - the south cell is entered on line 2 although line 4's end was nearer - and the lines beyond run last",
      () => got4.join(" ") === want4.join(" ")
            && G.distTo(o4[3][1], at(120, 150)) < G.distTo(o4[3][1], at(40, 150)),
      () => got4.join("  "));

// 4b. two cells on the FIRST line: the along-track tie-break
const firstSplit = [[at(0, 0), at(0, 150)], [at(0, 250), at(0, 400)], [at(40, 400), at(40, 0)]];
const o4b = regionOrder(firstSplit, REF, 0, 40, () => true).ordered.map((r) => xy(r[0]) + ">" + xy(r[1]));
check("4b. when the first line itself is split, the survey starts on the part furthest BACK along the line heading, "
      + "and takes the other part next because it is nearer than line 2",
      () => o4b.join(" ") === "0,0>0,150 0,250>0,400 40,400>40,0",
      () => o4b.join("  "));

// 5. a missing line
const struck = toward.lines.filter((l, i) => i !== 2);
const o5 = order(struck, toward);
check("5. with a line struck off, lines 1, 2, 4, 5 still run in order as a serpentine - re-phased across the gap, so "
      + "lines 4 and 5 are flown the other way from how they were drawn",
      () => o5.map((r) => lineOf(toward, r) + 1).join(",") === "1,2,4,5"
            && o5.every((r, i) => i === 0 || antiParallel(o5[i - 1], r))
            && !asDrawn(toward, o5[2]) && !asDrawn(toward, o5[3]),
      () => label(toward, o5));

// 5b. ... and the missing lines do not break the CELL - which shows only where it changes the order
const joined = [[at(0, 0), at(0, 400)], [at(40, 400), at(40, 0)], [at(40, -50), at(40, -100)],   // a stub on line 2
                [at(160, 0), at(160, 400)], [at(200, 400), at(200, 0)]];                       // lines 3-4 have no runs
const o5b = regionOrder(joined, REF, 0, 40, () => true).ordered.map((r) => xy(r[0]) + ">" + xy(r[1]));
check("5b. line indexes with NO runs at all are skipped, so the cell carries on across them: lines 5 and 6 run straight "
      + "after line 2 and the stub beside line 2, only 50 m away, waits until last - a cell broken at the gap would "
      + "have taken the stub first",
      () => o5b.join(" ") === "0,0>0,400 40,400>40,0 160,0>160,400 200,400>200,0 40,-50>40,-100",
      () => o5b.join("  "));

// 6. the un-punched pattern
check("6. the drawn pattern is already a serpentine that starts at the start corner - which is the order an UN-punched "
      + "plan commits in",
      () => same(toward.lines[0][0], A) && same(away.lines[0][0], A)
            && toward.lines.every((l, i) => i === 0 || antiParallel(toward.lines[i - 1], l))
            && away.lines.every((l, i) => i === 0 || antiParallel(away.lines[i - 1], l)),
      "line 1 starts at A and each line runs back the other way");

// 7. committing - the page's own commitPattern, over a plan that already holds something. The punch it commits is a
// FINISHED one with nothing red (patJoined, an empty patRed), asked through the real punchRefusal: what Add to plan
// refuses, and when, is tests/turn_refusal.js.
// eslint-disable-next-line no-new-func
const commitWorld = new Function("\"use strict\";\n"
  + "const mission = {lines: [], waypoints: []}; let planKind = null; const NO_LEAD = {in: 0, out: 0};\n"
  + "let patClip = null, patTransits = [], patLead = [], patRepunchT = null, punchInFlight = null, drawn = [];\n"
  + "let patRed = [], patJoined = true, patDropped = null;\n"
  + "const $ = () => ({disabled: false}); const flushRepunch = async () => {}; const updatePatReadout = () => {};\n"
  + "const currentPattern = () => ({}); const patSourceLines = () => drawn;\n"
  + "const resetPattern = () => {}; const recalcCommittedForSpeed = () => {}; const saveMission = () => {};\n"
  + "const render = () => {}; const showBanner = () => {}; const flashNote = () => {};\n"
  + grab(H, "punchRefusal") + "\n"
  + grab(H, "commitPattern")
  + "\nreturn { mission, commitPattern, set: (o) => { patClip = o.clip || null; patTransits = o.transits || [];"
  + " patLead = o.lead || []; drawn = o.drawn || []; } };")();
const tag = (p) => (p.turn ? "T" : "") + xy(p);
const before7 = { a: at(-40, 0), b: at(-40, 400) };
commitWorld.mission.lines.push({ ...before7, lead_in_m: 0, lead_out_m: 0 });
commitWorld.mission.waypoints.push(before7.a, before7.b);
commitWorld.set({ clip: [[at(0, 0), at(0, 400)], [at(40, 400), at(40, 0)]],
                  transits: [[at(15, 420), at(25, 420)]], lead: [{ in: 5, out: 6 }, { in: 0, out: 0 }] });
commitWorld.commitPattern();
const punched7 = commitWorld.mission.waypoints.map(tag).join(" ");
commitWorld.set({ drawn: [[at(80, 0), at(80, 400)], [at(120, 400), at(120, 0)]] });
commitWorld.commitPattern();
const lines7 = commitWorld.mission.lines.map((L) => xy(L.a) + ">" + xy(L.b) + "/" + L.lead_in_m + "+" + L.lead_out_m);
const drawn7 = commitWorld.mission.waypoints.slice(8).map(tag).join(" ");
check("7. Add to plan APPENDS to the plan already there: each punched run's two ends, then its joining points flagged "
      + "turn, one line entry per run with its leads - and an un-punched pattern commits its drawn lines in order, with "
      + "no joining points and no leads",
      () => punched7 === "-40,0 -40,400 0,0 0,400 T15,420 T25,420 40,400 40,0"
            && lines7.join(" ") === "-40,0>-40,400/0+0 0,0>0,400/5+6 40,400>40,0/0+0 80,0>80,400/0+0 120,400>120,0/0+0"
            && drawn7 === "80,0 80,400 120,400 120,0",
      () => punched7 + " | then " + drawn7);
// eslint-disable-next-line no-new-func
const planWorld = new Function("\"use strict\";\n"
  + "const mission = {lines: [], waypoints: []}; const saveMission = () => {};\n"
  + decl(H, /^const _eqLL=.*;$/m) + "\n" + grab(H, "deleteLineByIndex")
  + "\nreturn { mission, deleteLineByIndex };")();
{
  // A committed three-line plan, shaped exactly as commitPattern writes it: each run's ends, then its turn.
  const ends = [[at(0, 0), at(0, 400)], [at(40, 400), at(40, 0)], [at(80, 0), at(80, 400)]];
  const turn = (x, y) => ({ ...at(x, y), turn: true });
  planWorld.mission.lines = ends.map(([a, b]) => ({ a, b, lead_in_m: 0, lead_out_m: 0 }));
  planWorld.mission.waypoints = [ends[0][0], ends[0][1], turn(20, 420), ends[1][0], ends[1][1], turn(60, -20),
                                 ends[2][0], ends[2][1]];
  planWorld.deleteLineByIndex(1);
}
const left7b = planWorld.mission.waypoints;
const i7b = left7b.findIndex((p) => p.turn);
check("7b. ... and deleting a committed line removes only its two ENDS: the turns either side stay in the plan, so the "
      + "vessel still travels that line's track, from one turn to the other, as an uncounted leg",
      () => planWorld.mission.lines.length === 2 && left7b.length === 6
            && left7b.filter((p) => p.turn).length === 2 && left7b[i7b + 1] && left7b[i7b + 1].turn
            && G.distTo(left7b[i7b], left7b[i7b + 1]) > 400,
      () => left7b.map((p) => (p.turn ? "T" : "") + xy(p)).join(" "));

// 8. upload
const routePlan = grab(PJ, "routePlan"), upload = grab(H, "doUpload");
check("8. Upload routes mission.waypoints IN ORDER from the fix, laning only leg 0 - the approach - unless the whole "
      + "route is a transit, and sends positions only",
      () => /const wps = mission\.waypoints \|\| \[\];/.test(upload)
            && /const plan = routePlan\(\{lat:asv\.lat, lon:asv\.lon\}, wps\);/.test(upload)
            && /cmd\("\/api\/cmd\/upload", \{route: plan\.route,/.test(upload)
            && /wps\.forEach\(\(wp, i\)=>\{/.test(routePlan) && /legPath\(prev, wp, ref, ko, buf\)/.test(routePlan)
            && /if\(keepRightAll \|\| i===0\)\{/.test(routePlan)
            && /out\.push\(\{lat:seg\[k\]\.lat, lon:seg\[k\]\.lon\}\)/.test(routePlan),
      "routePlan(fix, wps); lane on i===0; {lat, lon} out");

// 9. what counts as a line while it runs
// eslint-disable-next-line no-new-func
const legWorld = new Function("distTo", "\"use strict\";\n"
  + "let runRoute = null; const mission = {waypoints: [], lines: []}; const window = {_wpIndex: 0};\n"
  + decl(H, /^const LINE_MATCH_M = [^;]*;/m) + "\n" + decl(H, /^let _legLine = [^;]*;/m) + "\n"
  + grab(H, "indexedRoute") + "\n" + grab(H, "currentLegLine")
  + "\nreturn { currentLegLine, set: (route, lines, idx) => { runRoute = route; mission.lines = lines;"
  + " window._wpIndex = idx; _legLine = {key: '', line: -1}; } };")(G.distTo);
const p0 = at(-50, -50), p1 = at(0, 0), p2 = at(0, 400), p3 = at(40, 420);
const L1 = { a: p1, b: p2 };
const legAt = (route, idx, lines) => { legWorld.set(route, lines || [L1], idx); return legWorld.currentLegLine(); };
check("9. while it runs, a leg is a survey LINE only when both its ends match a committed line's (within 5 m, either "
      + "direction) - the approach, a turn and a line with a detour spliced into it are not",
      () => legAt([p0, p1, p2, p3], 2) === 0 && legAt([p0, p2, p1, p3], 2) === 0
            && legAt([p0, p1, p2, p3], 1) === -1 && legAt([p0, p1, p2, p3], 3) === -1
            && legAt([p0, p1, at(0, 200), p2], 2) === -1 && legAt([p0, at(4, 0), at(-4, 400), p3], 2) === 0
            && legAt([p0, at(6, 0), p2, p3], 2) === -1,
      "on the line: 0; approach / turn / spliced / 6 m off: -1; 4 m off: 0");

// 10. the numbers the technical manual quotes
const punch = grab(H, "punchOut");
check("10. the pair gate and the margin the technical manual quotes: a reversal is headings 180 +/- 50 degrees apart "
      + "and a gap under (GAP_LINES + 0.6) spacings, GAP_LINES = 4; every run loses max(2 m, half a spacing) each end",
      () => /const antiParallel = Math\.abs\(\(\(hF-hE\+360\)%360\)-180\) < 50;/.test(punch)
            && /const GAP_LINES = 4, gapSpan = GAP_LINES \+ 0\.6;/.test(punch)
            && /if\(antiParallel && distTo\(Ap,Bp\) < sp\.spacing\*gapSpan \+ 3 \+ leadSlack\)\{/.test(punch)
            && /const turnMargin = Math\.max\(2, sp\.spacing\*0\.5\);/.test(punch)
            && /const ro=regionOrder\(runs, ref, sp\.direction, sp\.spacing, legSafe\);/.test(punch),
      "antiParallel < 50; gapSpan 4.6; turnMargin max(2, spacing/2); regionOrder on the kept runs");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
