// tests/drawn_lines.js - a line is what the operator drew, not what the keep-outs left of it (review #18, 2026-09-15).
//
// Punch Out cuts a pattern line around a keep-out into segments, and each segment became a "line" of its own: an
// 8-line pattern read as 9 lines in the LINES table, with two odd lengths, on the chart's L# labels and in every
// "line N of M" - and the survey card divided the plan's width by one gap too many, understating its spacing. The
// segments are still what the boat runs and the clock times; every number shown to the operator is now the drawn
// line's, and a cut line reads as its parts: "120 + 120 (60 m gap)".
// DRIVEN: the page's own linePartContinues, drawnLines, lineNo, lineCount, linePartTxt, buildLineTable,
// renderLineTable, buildTurnTable, committedPatternInfo and currentActivity, on a three-line boustrophedon whose
// middle line a keep-out cuts in two.
//
//   node tests/drawn_lines.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// NOTE: the page's script is <script type="module">, which runs STRICT; these functions are evaluated with the page's
// own declarations in one strict scope.

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
const G = require("../static/js/geodesy.js");

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

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
function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}

console.log("A line is what the operator drew, not what the keep-outs left of it:");

// ── the plan: three 300 m east-west lines 20 m apart, end for end; a keep-out cuts the middle one ─────────────────
const REF = { lat: 44.9, lon: -66.98 };
const P = (e, n) => G.fromEN(e, n, REF);
const LINES = [
  { a: P(0, 0), b: P(300, 0) },                        // line 1, west to east
  { a: P(300, 20), b: P(180, 20) },                    // line 2 part 1, east to west ...
  { a: P(120, 20), b: P(0, 20) },                      // ... part 2, after a 60 m gap
  { a: P(0, 40), b: P(300, 40) },                      // line 3
];

// The table's body is built once and then PATCHED by id (review #20): a body whose innerHTML setter registers every
// id'd cell it is given, so the checks read what was written into them.
function bodyStub() {
  let html = "";
  const nodes = {};
  return {
    nodes, writes: 0,
    get innerHTML() { return html; },
    set innerHTML(v) {
      html = v; this.writes++;
      for (const k of Object.keys(nodes)) delete nodes[k];
      for (const m of v.matchAll(/id="([^"]+)"/g)) nodes[m[1]] = { id: m[1], textContent: "", innerHTML: "", style: {}, firstChild: null };
    },
    querySelector(sel) { return nodes[sel.replace(/^#/, "")] || null; },
    querySelectorAll() { return Object.values(nodes); },
  };
}
const els = { "#lineTablePanel": { style: { display: "block" } }, "#lineTableBody": bodyStub() };
const world = {
  $: (s) => els[s], llEN: G.llEN, distTo: G.distTo, toEN: G.toEN, azTo: G.azTo, alignDeg: G.alignDeg,
  fmtDist: (m) => Math.round(m) + " m", fmtMS: (s) => s + "s", roleSpeed: () => "Survey", roleSpeedMS: () => 2,
  scheduleTransitEst: () => {}, transitRowHtml: (label) => "<row>" + label + "</row>",
};
// eslint-disable-next-line no-eval
const page = eval("(function(){ \"use strict\";\n"
  + "const $ = world.$, llEN = world.llEN, distTo = world.distTo, toEN = world.toEN, azTo = world.azTo, alignDeg = world.alignDeg,"
  + " fmtDist = world.fmtDist, fmtMS = world.fmtMS, roleSpeed = world.roleSpeed, roleSpeedMS = world.roleSpeedMS,"
  + " scheduleTransitEst = world.scheduleTransitEst, transitRowHtml = world.transitRowHtml;\n"
  + "let mission = { lines: [], waypoints: [] }, S = {}, asv = null, runLineIdx = -1, curTurn = -1, turnSeg = [],"
  + " lineActual = [], transitEst = { transit: null, rth: null };\n"
  + "const linePhase = () => ({ phase: 'coverage' });\n"
  + decl(/^const LINE_PART_OFFSET_M = [^;]*;/m) + "\n" + decl(/^let _drawnLines = [^;]*;/m) + "\n"
  + decl(/^let _lineTableShape = [^;]*;/m) + "\n"
  + ["lineSetKey", "linePartContinues", "drawnLines", "lineNo", "lineCount", "linePartTxt", "setCellText", "setHtmlIfChanged", "setStyleIfChanged",
     "lineTableSkeleton", "buildLineTable", "buildTurnTable", "renderLineTable", "committedPatternInfo", "currentActivity"].map(grab).join("\n")
  + "\nreturn { drawnLines, lineNo, lineCount, linePartTxt, linePartContinues, buildLineTable, renderLineTable,"
  + " committedPatternInfo, currentActivity,"
  + " set: (o) => { if ('lines' in o) mission.lines = o.lines; if ('run' in o) runLineIdx = o.run;"
  + "   if ('actual' in o) lineActual = o.actual; if ('turns' in o) turnSeg = o.turns; if ('S' in o) S = o.S; if ('asv' in o) asv = o.asv; } }; })()");

// 1. the grouping
page.set({ lines: LINES, actual: [100, 60, 55, 140] });
const d = page.drawnLines();
check("1. a line the keep-outs cut into two parts is ONE line: four segments are three lines, numbered by the line",
      () => JSON.stringify(d.lines) === "[[0],[1,2],[3]]" && page.lineCount() === 3
            && [0, 1, 2, 3].map(page.lineNo).join(",") === "1,2,2,3"
            && page.linePartTxt(1) === " (part 1 of 2)" && page.linePartTxt(2) === " (part 2 of 2)" && page.linePartTxt(0) === "",
      () => JSON.stringify(d.lines) + "; lineNo " + [0, 1, 2, 3].map(page.lineNo).join(","));

// 1b. the numbering follows the plan
page.set({ lines: [LINES[0], LINES[3]] });
const edited = page.lineCount();
page.set({ lines: LINES });
check("1b. the numbering follows the plan: take the cut line out and there are two lines; put it back and there are three",
      () => edited === 2 && page.lineCount() === 3, () => "without it " + edited + ", with it " + page.lineCount());

// 2. what is not a part
const not = (b) => { page.set({ lines: [LINES[1], b] }); return page.linePartContinues(0); };
const beside = not({ a: P(120, 25), b: P(0, 25) });          // 5 m off the line: the next pass, not a part
const back = not({ a: P(0, 20), b: P(120, 20) });            // the same line, run the other way
const behind = not({ a: P(200, 20), b: P(80, 20) });         // starts back inside the first part
const onward = not({ a: P(120, 20.4), b: P(0, 20.4) });      // 0.4 m off - still the same line
check("2. a part must lie on the SAME straight line, further along it, in the same direction: the next pass beside it, "
      + "the same line run back, and a segment that starts inside the last one are not parts - a few decimeters off is",
      () => !beside && !back && !behind && onward,
      () => "beside " + beside + ", back " + back + ", behind " + behind + ", 0.4 m off " + onward);

// 3-4. the table
page.set({ lines: LINES, actual: [100, 60, 55, 140], run: 2, S: { run: "running", behavior: "survey" }, turns: [] });
page.renderLineTable();
const html = els["#lineTableBody"].innerHTML, cellOf = (id) => els["#lineTableBody"].nodes[id] || {};
const rows = html.split("<tr").slice(2, -1);                  // past the header row, before the sum row
check("3. the LINES table has ONE row per drawn line, and the cut line reads as its parts with the gap between them",
      () => rows.length === 3 && /120 \+ 120 <span[^>]*>\(60 m gap\)<\/span>/.test(rows[1])
            && /title="Line 2 is cut by a keep-out into 2 parts: 120 m \+ 120 m, with 60 m between them\."/.test(rows[1]),
      () => rows.length + " rows; row 2: " + (rows[1] || "").replace(/style="[^"]*"/g, "").slice(0, 160));
check("4. ... its plan and actual are its parts' sums, it is under way while either part is, and the totals do not "
      + "move - the RTH row leaves from line 3, the last drawn line",
      () => cellOf("lt_r1_plan").textContent === "120s" && cellOf("lt_r1_act").textContent === "115s"
            && cellOf("lt_r1_mark").textContent === "▸" && cellOf("lt_r0_mark").textContent === ""
            && /<row>RTH L3 → home:<\/row>/.test(cellOf("lt_rth").innerHTML) && /Σ<\/td><td[^>]*>840<\/td>/.test(html),
      () => "row 2: plan " + cellOf("lt_r1_plan").textContent + ", actual " + cellOf("lt_r1_act").textContent
            + ", mark '" + cellOf("lt_r1_mark").textContent + "'; RTH " + cellOf("lt_rth").innerHTML
            + "; sum: " + (html.match(/Σ<\/td><td[^>]*>(\d+)/) || [])[1]);

// 5. the log keeps both
const t = page.buildLineTable();
check("5. the session log's rows keep the segment as `line` - what it has always counted - and add the drawn line",
      () => t.map((r) => r.line + ":" + r.drawn).join(",") === "1:1,2:2,3:2,4:3", () => t.map((r) => r.line + ":" + r.drawn).join(","));

// 6. the survey card
page.set({ lines: LINES });
const info = page.committedPatternInfo();
check("6. the survey card counts three lines and a spacing of 20 m - not four lines and 13.3 m",
      () => info && info.count === 3 && Math.abs(info.spacing - 20) < 0.01 && Math.abs(info.width - 40) < 0.01,
      () => info && ("count " + info.count + ", spacing " + info.spacing.toFixed(2) + " m, width " + info.width.toFixed(1) + " m"));

// 7. the activity
page.set({ lines: LINES, run: 2, S: { run: "running", behavior: "survey", status: {} }, asv: P(60, 20), turns: [] });
const act = page.currentActivity();
check("7. on the second part of the cut line the activity says line 2 of 3, part 2 of 2",
      () => /on coverage line 2 of 3 \(part 2 of 2\)/.test(act.detail), () => act.detail);

// 8. wiring the grab cannot reach
const draw = H.slice(H.indexOf("drawBoundary(toScreen);") - 3000, H.indexOf("drawBoundary(toScreen);"));
check("8. the chart's labels, the turn table, the line tip, the held-survey bar and the resume notes all speak drawn lines, "
      + "and nothing in the page shadows lineNo",
      () => /ctx\.fillText\("L"\+lineNo\(i\)/.test(draw) && /const no=n=>n>=1\?lineNo\(n-1\):n;/.test(H)
            && /tip\.textContent="line "\+lineNo\(runLineIdx\)\+linePartTxt\(runLineIdx\)/.test(H)
            && /", on line " \+ lineNo\(g\.mark\.line\)/.test(H) && /down line " \+ lineNo\(pauseMark\.line\)/.test(H)
            && !/\b(const|let|var)\s+(lineNo|lineCount|drawnLines)\b/.test(H),
      () => "shadowing declarations: " + ((H.match(/\b(const|let|var)\s+(lineNo|lineCount|drawnLines)\b/g) || []).join(", ") || "none"));

// -- EVERY "line N" GOES THROUGH lineNo() ------------------------------------------------
// ⚠⚠ THE FIXTURE ABOVE IS WHY THIS MATTERS: four segments map to lineNo 1,2,2,3, because
// the keep-outs cut the second drawn line in two. A raw `k + 1` calls those last two segments
// 3 and 4 - numbers that are on no chart the operator is looking at. On a plan with no clipped
// line the two agree exactly, which is why it went unnoticed for so long.
{
  const H = require("fs").readFileSync(
    process.env.ASV_HTML || require("path").join(__dirname, "..", "static", "asv.html"), "utf8");
  const code = H.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  // ⚠⚠ NO LOOKAHEAD, AND THE COUNT IS EXACT. The first cut of this carried a `(?! *:)`
  // that excluded the TERNARY form - which is precisely the SESSION LOG site
  // (`g.mark ? g.mark.line + 1 : null`), the one an episode is reconstructed from. And it
  // asked for `>= 3` against FOUR real sites, so reverting one still satisfied it. The
  // mutation that put the log back SURVIVED both. A threshold below the true count cannot
  // see a single regression.
  const raw = (code.match(/g\.mark\.line \+ 1/g) || []);
  const viaHelper = (code.match(/lineNo\(g\.mark\.line\)/g) || []).length;
  // the held bar (1727) plus resumeHeldSurvey's note, banner and session log
  const logSite = /line: g\.mark \? lineNo\(g\.mark\.line\) : null/.test(code);
  check("every 'line N' the HELD resume states goes through lineNo(), like the pause resume "
        + "beside it",
        () => raw.length === 0 && viaHelper === 4 && logSite,
        () => raw.length
                ? raw.length + " raw segment-index conversion(s) left: " + raw.join(", ")
                  + " - the note, the banner and the session log each name a line the chart "
                  + "does not have"
                : viaHelper + " site(s) through lineNo (the held bar, and the note, "
                  + "banner and session log of the held resume); the log names the drawn "
                  + "line: " + logSite);
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
