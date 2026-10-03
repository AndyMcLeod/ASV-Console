// tests/survey_blocks.js - the SURVEYS in the plan (sequenced surveys, phase 1, 2026-10-02).
//
// Andy, 2026-10-02: "Recommend feature structure to create sequenced surveys. Multiple surveys can be created and
// named/numbered in Survey card. Then the user can select the order in which the survey blocks are completed. GOTO
// function for inter-survey travel." Then: "Start phase 1, keep the number with the survey".
//
// Phase 1 adds no controls. The plan stays one flat list of waypoints and one of lines, and learns which SURVEY each
// entry belongs to: `mission.surveys` in run order ({id, no, name, pattern, punched}), an `sv` tag on every line and on
// every waypoint a survey put there, and each survey's entries together. Add to plan makes each committed pattern a
// survey of its own, numbered one past the highest the plan holds - and the number STAYS WITH THE SURVEY.
// static/js/surveys.js judges a loaded plan: a plan from before surveys were kept is ONE survey, S1; a sound one is
// kept; one whose grouping does not hold is folded into one survey and said. What reads the tags - a gap between two
// surveys is never a reversal, each survey's reversals are judged by its own spacing - is tests/survey_transit_roles.js
// 16-16d; the drawn-line count, tests/drawn_lines.js 9; the load, tests/plan_save.js 12; the console's save,
// tests/mission_store.py 16-16c.
//
// DRIVEN: static/js/surveys.js directly (it is pure), and the page's own commitPattern and waypoint drag
// (static/asv.html) over a world.
//
//   node tests/survey_blocks.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ASV_HTML and SURVEYS_JS point this at SIDECAR copies for a mutation run - every read of those two files goes through
// them.
//
// NOTE: the page's script is <script type="module">, which runs STRICT; the page functions are evaluated strict here.

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
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const SURVEYS_JS = process.env.SURVEYS_JS || path.join(__dirname, "..", "static", "js", "surveys.js");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const SV = require(SURVEYS_JS);

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

// A plan in plain numbers: waypoint n sits at 44.9 + n * 1e-4 N; a line joins two of them.
const W = (n, sv, extra) => ({ lat: 44.9 + n * 1e-4, lon: -67.0, ...(sv ? { sv } : {}), ...(extra || {}) });
const Ln = (i, j, sv) => ({ a: W(i), b: W(j), ...(sv ? { sv } : {}) });
const copy = (o) => JSON.parse(JSON.stringify(o));
const tags = (list) => list.map((x) => x.sv || "-").join(" ");
const ids = (m) => m.surveys.map((s) => s.id + "#" + s.no).join(",");
// The sound two-survey plan most checks start from: S1 (two lines), S2 (one line), then a free waypoint.
const SOUND = {
  waypoints: [W(0, "S1"), W(1, "S1"), W(2, "S1", { turn: true }), W(3, "S1"), W(4, "S1"), W(5, "S2"), W(6, "S2"), W(7)],
  lines: [Ln(0, 1, "S1"), Ln(3, 4, "S1"), Ln(5, 6, "S2")],
  surveys: [{ id: "S1", no: 1, name: "North", pattern: null, punched: true },
            { id: "S2", no: 2, name: "", pattern: null, punched: false }],
};

console.log("The surveys in the plan:");

// ── 1. a plan from before surveys were kept ─────────────────────────────────────────────────────────────────────
{
  const m = { waypoints: [W(0), W(1), W(2), W(3), W(9)], lines: [Ln(0, 1), Ln(2, 3)] };
  const r = SV.normalizeSurveys(m);
  check("1. a plan from before surveys were kept - lines, no surveys - is ONE survey, S1 number 1, holding EVERYTHING "
        + "(every line and every waypoint), with nothing to say: it is the plan it was",
        () => ids(m) === "S1#1" && tags(m.lines) === "S1 S1" && tags(m.waypoints) === "S1 S1 S1 S1 S1"
              && r.migrated === true && r.folded === false && r.note === null,
        () => ids(m) + " lines " + tags(m.lines) + " waypoints " + tags(m.waypoints) + " note " + r.note);
  const free = { waypoints: [W(0), W(1, "S4")], lines: [] };
  const r2 = SV.normalizeSurveys(free);
  check("1b. ... while a plan with no lines and no surveys (WPT points, a search) lists none and its waypoints stay free - "
        + "a tag that names no survey at all is an orphan and goes",
        () => free.surveys.length === 0 && tags(free.waypoints) === "- -" && r2.migrated === false && r2.note === null,
        () => "surveys " + free.surveys.length + ", waypoints " + tags(free.waypoints));
}

// ── 2. a sound plan is kept ─────────────────────────────────────────────────────────────────────────────────────
{
  const m = copy(SOUND);
  const r = SV.normalizeSurveys(m);
  check("2. a SOUND plan - two surveys together and in one order, a free waypoint after them - is left exactly as it "
        + "was: numbers, names, tags and the free waypoint",
        () => JSON.stringify(m) === JSON.stringify(SOUND) && r.note === null && !r.migrated && !r.folded,
        () => ids(m) + " | " + tags(m.waypoints) + " | note " + r.note);
  const out = copy(SOUND);
  out.surveys = [out.surveys[1], { id: "S9", no: 9, name: "outline", pattern: null, punched: null }, out.surveys[0]];
  SV.normalizeSurveys(out);
  check("2b. a survey list out of RUN ORDER is put into the order the plan runs them - the lists are what the boat flies - "
        + "and a survey with nothing in the plan (an outline) keeps its place after them",
        () => ids(out) === "S1#1,S2#2,S9#9",
        () => ids(out));
}

// ── 3. a grouping that does not hold is folded, and said ────────────────────────────────────────────────────────
{
  const broken = {
    "a line with no tag": [(m) => { delete m.lines[1].sv; }, /line 2 belongs to no survey/],
    "a line naming a survey the plan does not list": [(m) => { m.lines[2].sv = "S8"; },
                                                      /line 3 names survey S8, which the plan does not list/],
    "a waypoint naming a survey the plan does not list": [(m) => { m.waypoints[7].sv = "S8"; },
                                                          /waypoint 8 names survey S8/],
    "one survey's lines split by another's": [(m) => { m.lines = [m.lines[0], m.lines[2], m.lines[1]]; },
                                              /survey S1's lines are not together/],
    "a free waypoint inside a survey's run": [(m) => { delete m.waypoints[2].sv; },
                                              /survey S1's waypoints are not together/],
    "the lines and the waypoints in different orders": [(m) => {
      m.waypoints = [...m.waypoints.slice(5, 7), ...m.waypoints.slice(0, 5), m.waypoints[7]]; },
      /different orders/],
  };
  const res = Object.entries(broken).map(([k, [mutate, why]]) => {
    const m = copy(SOUND); mutate(m);
    const r = SV.normalizeSurveys(m);
    const again = SV.normalizeSurveys(m);
    return { k, ok: r.folded && why.test(r.note || "") && ids(m) === "S1#1" && m.surveys[0].name === "North"
                    && m.lines.every((L) => L.sv === "S1") && m.waypoints.every((p) => p.sv === "S1")
                    && again.note === null && !again.folded,
             note: r.note };
  });
  check("3. a plan whose grouping does not hold is FOLDED into one survey - the first listed, its number and name kept, "
        + "everything tagged with it - and the note names the fault; folded once, it is sound (a fixed point)",
        () => res.every((x) => x.ok),
        () => res.filter((x) => !x.ok).map((x) => x.k + ": " + x.note).join(" | ") || res.length + " faults, each named");
}

// ── 4. records that are not surveys ─────────────────────────────────────────────────────────────────────────────
{
  const m = copy(SOUND);
  m.surveys = [{ id: "", no: 3 }, { id: "S1", no: 1.5 }, { no: 4 }, { id: "S1", no: 0 },
               ...m.surveys, { id: "S1", no: 5 }, { id: "S6", no: 2 }];
  SV.normalizeSurveys(m);
  check("4. a record with no id or no whole-number `no` from 1 is dropped, and a repeated id or number keeps its FIRST "
        + "record - so the plan's own S1 and S2 stand",
        () => ids(m) === "S1#1,S2#2" && m.surveys[0].name === "North",
        () => ids(m));
}

// ── 5-6. where each survey is, and the path the transits take ──────────────────────────────────────────────────
{
  const m = copy(SOUND);
  m.surveys.push({ id: "S5", no: 5, name: "", pattern: null, punched: null });
  const pts = SV.surveyPoints(m);
  check("5. surveyPoints gives each survey its own waypoints in order - and an outline survey none",
        () => pts.map((s) => s.id + ":" + s.pts.length).join(",") === "S1:5,S2:2,S5:0"
              && pts[1].pts[0] === m.waypoints[5],
        () => pts.map((s) => s.id + ":" + s.pts.length).join(","));
  const start = { lat: 44.8, lon: -67.1 };
  const p = SV.pathThroughSurveys(start, m.waypoints);
  const lone = SV.pathThroughSurveys(null, [W(0, "S1"), W(1), W(2, "S3")]);
  check("6. the transits' path is the start, then each survey cut to its FIRST and LAST waypoint (its inside is read as "
        + "a survey), with free waypoints as they are - a one-waypoint survey gives one point, and no start none",
        () => p.length === 6 && p[0] === start && p[1] === m.waypoints[0] && p[2] === m.waypoints[4]
              && p[3] === m.waypoints[5] && p[4] === m.waypoints[6] && p[5] === m.waypoints[7]
              && lone.length === 3,
        () => p.length + " points; lone " + lone.length);
}

// ── 7. idempotent ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const m = copy(SOUND);
  SV.normalizeSurveys(m);
  const once = JSON.stringify(m);
  const r = SV.normalizeSurveys(m);
  const old = { waypoints: [W(0), W(1)], lines: [Ln(0, 1)] };
  SV.normalizeSurveys(old);
  const oldOnce = JSON.stringify(old);
  SV.normalizeSurveys(old);
  check("7. judging a plan twice changes nothing the first judgment did not - a migrated plan saved and loaded again is "
        + "not migrated again",
        () => JSON.stringify(m) === once && r.note === null && JSON.stringify(old) === oldOnce,
        "sound and migrated plans both");
}

// ── 8-11. Add to plan makes a survey ────────────────────────────────────────────────────────────────────────────
// The page's own commitPattern, committing a FINISHED punch with nothing red through the real punchRefusal (what Add
// to plan refuses is tests/turn_refusal.js), over a plan that may already hold surveys.
// eslint-disable-next-line no-new-func
const world = () => new Function("\"use strict\";\n"
  + "const mission = {lines: [], waypoints: [], surveys: []}; let planKind = null; const NO_LEAD = {in: 0, out: 0};\n"
  + "let patClip = null, patTransits = [], patLead = [], patRepunchT = null, punchInFlight = null, drawn = [];\n"
  + "let patRed = [], patJoined = true, patDropped = null, patFunnel = null; let turnSlowAt = {}; let ANCHORS = null;\n"
  + "const $ = () => ({disabled: false}); const flushRepunch = async () => {}; const updatePatReadout = () => {};\n"
  + "const currentPattern = () => ({anchors: ANCHORS}); const patSourceLines = () => drawn;\n"
  + "const resetPattern = () => {}; const recalcCommittedForSpeed = () => {}; const saveMission = () => {};\n"
  + "const render = () => {}; const showBanner = () => {}; const flashNote = () => {};\n"
  // phase 2 (2026-10-02): no survey is being edited here, so every Add to plan is a NEW survey; the settings recorder
  // and the edit's replace are tests/survey_table.js's subject.
  + "let editingSv = null, cardSv = null; const surveySettingsNow = () => null; const replaceSurvey = () => {};\n"
  // phase 3a: the commit records the water level the punch was cut at
  + "const sea = {waterOffset: 0};\n"
  + grab(H, "emptyPunchRefusal") + "\n" + grab(H, "punchRefusal") + "\n" + grab(H, "commitPattern")
  + "\nreturn { mission, commitPattern, set: (o) => { patClip = o.clip || null; patTransits = o.transits || [];"
  + " patLead = o.lead || []; drawn = o.drawn || []; ANCHORS = o.anchors || null; } };")();
const P = (n) => ({ lat: 43.07 + n * 1e-4, lon: -70.71 });
const ANCH = { A: { ...P(0), extra: "not kept" }, B: P(9), C: P(1), align: 1 };
{
  const w = world();
  w.mission.waypoints.push({ lat: 43.0, lon: -70.8 });            // a WPT point, added before any pattern
  w.set({ clip: [[P(0), P(4)], [P(5), P(1)]], transits: [[P(6), P(7)]], lead: [{ in: 0, out: 0 }, { in: 0, out: 0 }],
          anchors: ANCH });
  w.commitPattern();
  const s1 = w.mission.surveys[0];
  check("8. the first Add to plan makes the pattern survey S1, number 1: its lines and EVERY waypoint it put in the plan "
        + "- the run ends and the turn between them - carry S1; it records what it was drawn from (corners and alignment, "
        + "plain positions) and that it was punched; a WPT point added before it stays free",
        () => ids(w.mission) === "S1#1" && s1.name === "" && s1.punched === true
              && JSON.stringify(s1.pattern) === JSON.stringify({ A: P(0), B: P(9), C: P(1), align: 1 })
              && tags(w.mission.lines) === "S1 S1" && tags(w.mission.waypoints) === "- S1 S1 S1 S1 S1 S1"
              && w.mission.waypoints[3].turn === true,
        () => ids(w.mission) + " " + JSON.stringify(s1.pattern) + " | waypoints " + tags(w.mission.waypoints));
  w.set({ drawn: [[P(20), P(24)], [P(25), P(21)]], anchors: { A: P(20), B: P(29), C: null, align: 0 } });
  w.commitPattern();
  const s2 = w.mission.surveys[1];
  check("9. a second Add to plan is survey S2, listed AFTER S1 - the order the plan runs them - with only its own entries "
        + "tagged S2; an un-punched pattern is recorded as not punched, a pattern with no third click with C null",
        () => ids(w.mission) === "S1#1,S2#2" && s2.punched === false && s2.pattern.C === null
              && tags(w.mission.lines) === "S1 S1 S2 S2"
              && tags(w.mission.waypoints) === "- S1 S1 S1 S1 S1 S1 S2 S2 S2 S2",
        () => ids(w.mission) + " | lines " + tags(w.mission.lines) + " | waypoints " + tags(w.mission.waypoints));
  // Valid by its own judge: what Add to plan wrote is a sound plan.
  const judged = copy(w.mission);
  const r = SV.normalizeSurveys(judged);
  check("9b. ... and the plan Add to plan writes is SOUND by the judgment loadMission makes of it - nothing folded, "
        + "nothing reordered",
        () => r.note === null && !r.folded && JSON.stringify(judged) === JSON.stringify(w.mission),
        () => r.note || "sound");
}
{
  // S1 and S5 in the plan, S2-S4 gone: one past the highest is S6 - and counting the surveys would say S3, which nothing
  // in the plan holds, so only the rule itself can give S6 (with S3 in the plan the id check would hide a count).
  const w = world();
  w.mission.surveys.push({ id: "S1", no: 1 }, { id: "S5", no: 5 });
  w.set({ drawn: [[P(0), P(4)]], anchors: ANCH });
  w.commitPattern();
  const odd = world();
  odd.mission.surveys.push({ id: "S2", no: 1 });                   // a hand-edited file: S2 carries number 1
  odd.set({ drawn: [[P(0), P(4)]], anchors: ANCH });
  odd.commitPattern();
  check("10. THE NUMBER STAYS WITH THE SURVEY: with S1 and S5 in the plan (S2-S4 gone) the next is S6 - one past the "
        + "highest, never a number handed out before, never a count - and an id a hand-edited file already uses is not "
        + "handed out twice",
        () => ids(w.mission) === "S1#1,S5#5,S6#6" && ids(odd.mission) === "S2#1,S3#3",
        () => ids(w.mission) + " | " + ids(odd.mission));
}

// ── 12. a drag moves a point and keeps what it is ───────────────────────────────────────────────────────────────
{
  const i = H.indexOf("if(wpDrag){ const np={lat:ll.lat, lon:ll.lon};");
  const end = "renderSoon(); return; }";
  const j = H.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error("test setup: the waypoint drag block moved");
  // eslint-disable-next-line no-new-func
  const drag = new Function("\"use strict\";\n"
    + "const mission = {waypoints: [{lat: 1, lon: 2, sv: 'S1', turn: true}, {lat: 1, lon: 3, sv: 'S1'}],"
    + " lines: [{a: {lat: 1, lon: 2}, b: {lat: 1, lon: 3}, sv: 'S1'}]};\n"
    + "const wpDrag = {i: 0, prev: {lat: 1, lon: 2}}; const ll = {lat: 1.5, lon: 2.5};\n"
    + "const $ = () => ({style: {}}); const renderSoon = () => {};\n"
    + decl(H, /^const _eqLL=.*;$/m) + "\n" + grab(H, "syncLineEndpoint") + "\n"
    + "function run(){ " + H.slice(i, j + end.length) + " }\nreturn { run, mission };")();
  drag.run();
  const p = drag.mission.waypoints[0];
  check("12. a dragged waypoint MOVES and keeps what it is - its survey and, for a turn point, that it is one - and the "
        + "line end it carried follows it",
        () => p.lat === 1.5 && p.lon === 2.5 && p.sv === "S1" && p.turn === true
              && drag.mission.lines[0].a.lat === 1.5 && drag.mission.lines[0].sv === "S1",
        () => JSON.stringify(p) + " line a " + JSON.stringify(drag.mission.lines[0].a));
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
