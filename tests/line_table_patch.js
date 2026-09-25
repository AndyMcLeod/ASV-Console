// tests/line_table_patch.js - the LINES table is patched in place, not rebuilt every frame (review #20, 2026-09-15).
//
// Andy: "The LINES table is rebuilt four times a second. This is the flicker you had fixed on the AIS card; update the
// cells in place instead." renderLineTable runs on every telemetry frame and assigned the whole body's innerHTML each
// time, so the table was destroyed and re-parsed four times a second: a tooltip being read vanished, a selection was
// dropped mid-copy, the rows flickered. The body is now built once per SHAPE (its drawn lines, their parts and leads,
// how many turns) and a frame writes only the cells whose text, markup or style changed.
// DRIVEN: the page's own renderLineTable, lineTableSkeleton, setCellText, setHtmlIfChanged, setStyleIfChanged,
// buildLineTable, buildTurnTable, transitRowHtml, roleSpeed, roleSpeedMS and the drawn-line helpers, over a DOM stub
// that COUNTS every body build, text write, markup write, style write and lookup - and hands a style back the way a
// browser does ("#bfe8c8" reads "rgb(191, 232, 200)"), so a change test that compares against the readback is seen
// rewriting on every frame.
//
//   node tests/line_table_patch.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 18 sidecar mutations RUN, 18/18 caught:
//   rebuilt every frame (the fault) -> 1, 1b, 2, 2b, 3-7   style compared against its readback -> 1, 2, 2b, 3, 5
//   setCellText writes unconditionally -> 1, 2, 3, 4, 5    cells looked up every frame -> 1b
//   shape ignores the turn count -> 5                      shape ignores the lead -> 6
//   empty note written every frame -> 7                    cell cache kept across a rebuild -> 5, 9
//   line highlight not patched -> 3                        transit rows rewritten every frame -> 1, 2, 4
//   turn clock not patched -> 5, 9                         closed panel still rendered -> 8
//   the ▸ never moves -> 3, 9                              a skeleton id misspelled -> 4, 7, 9
//   actual cell ink not patched -> 2b                      turn highlight not patched -> 5
//   turn total not patched -> 5, 9                         speed heading not patched -> 4, 9
// ⚠ "shape ignores the lead" SURVIVES the first draft of check 6 (spotted reading it, then run against that draft to
// confirm: exit 0 mutated), which added a lead by moving no line end - so the coverage length changed with it and
// rebuilt the body for the wrong reason. Punch Out adds a lead by EXTENDING the run,
// leaving the coverage length exactly as it was; the fixture does that now.
//
// LIVE (port 8796, a temp copy running Andy's 14-line Eastport plan, LINES open, the boat on line 1 at 6.9 kn), a
// MutationObserver on the table body for 15 s: this page - 0 body rebuilds, 0 attribute writes, line 1's clock and the
// total edited in place 15 times each (the same text node throughout), the transit row re-rendered twice as the boat
// moved, the row and table the same nodes, and a selection of "9:20" still selected at the end. The page before this
// change, same console, same 15 s: 50 body rebuilds, the row replaced, the selection gone.
//
// NOTE: the page's script is <script type="module">, which runs STRICT; the functions are evaluated strict here.

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
const UNITS = fs.readFileSync(path.join(__dirname, "..", "static", "js", "units.js"), "utf8").split("\r\n").join("\n");

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
function grabFrom(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = src.indexOf("{", start), depth = 0;
  for (;;) { const c = src[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return src.slice(start, k + 1);
}
const grab = (name) => grabFrom(H, name);
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}

console.log("The LINES table is patched in place, not rebuilt every frame:");

// ── a DOM that counts ────────────────────────────────────────────────────────────────────────────────────────────
const W = { body: 0, text: 0, html: 0, style: 0, textNodes: 0, qs: 0, qsa: 0 };
const snap = () => Object.assign({}, W);
const since = (s) => { const d = {}; for (const k of Object.keys(W)) d[k] = W[k] - s[k]; return d; };
const fmt = (d) => Object.keys(d).map((k) => k + " " + d[k]).join(", ");
// What a browser hands back for a color it was given: "#bfe8c8" -> "rgb(191, 232, 200)" and
// "rgba(63,192,255,.14)" -> "rgba(63, 192, 255, 0.14)".
function normColor(v) {
  let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
  if (m) return "rgb(" + [1, 2, 3].map((i) => parseInt(m[i], 16)).join(", ") + ")";
  m = /^rgba\(([^)]*)\)$/.exec(v);
  if (m) return "rgba(" + m[1].split(",").map((s) => String(Number(s))).join(", ") + ")";
  return v;
}
function textNode(value) {
  W.textNodes++;
  return { nodeType: 3, get nodeValue() { return value; }, set nodeValue(v) { W.text++; value = String(v); } };
}
function makeNode(id) {
  const vals = {};
  const node = { id, firstChild: null, _inner: "" };
  node.style = new Proxy({}, {
    get: (_, p) => (p in vals ? normColor(vals[p]) : ""),
    set: (_, p, v) => { W.style++; vals[p] = String(v); return true; },
  });
  Object.defineProperty(node, "textContent", {
    get: () => (node.firstChild ? node.firstChild.nodeValue : ""),
    set: (v) => { W.text++; node.firstChild = textNode(String(v)); },
  });
  Object.defineProperty(node, "innerHTML", {
    get: () => node._inner,
    set: (v) => { W.html++; node._inner = String(v); node.firstChild = null; },
  });
  return node;
}
function bodyStub() {
  const b = { nodes: {}, _html: "" };
  Object.defineProperty(b, "innerHTML", {
    get: () => b._html,
    set: (v) => {
      W.body++; b._html = String(v); b.nodes = {};
      for (const m of b._html.matchAll(/id="([^"]+)"/g)) b.nodes[m[1]] = makeNode(m[1]);
    },
  });
  b.querySelector = (sel) => { W.qs++; return b.nodes[sel.replace(/^#/, "")] || null; };
  b.querySelectorAll = () => { W.qsa++; return Object.values(b.nodes); };
  return b;
}
const body = bodyStub();
const panel = { style: { display: "block" } };
const els = { "#lineTablePanel": panel, "#lineTableBody": body };
const cell = (id) => body.nodes[id] || makeNode("(missing " + id + ")");

// ── the page ─────────────────────────────────────────────────────────────────────────────────────────────────────
const world = {
  $: (s) => els[s], llEN: G.llEN, distTo: G.distTo, toEN: G.toEN, azTo: G.azTo, alignDeg: G.alignDeg,
  fmtDist: (m) => Math.round(m) + " m", scheduleTransitEst: () => {},
  V: { SPEED_KN: { survey: 4, low: 3, high: 6, transit: 8 } },
};
// eslint-disable-next-line no-eval
const page = eval("(function(){ \"use strict\";\n"
  + "const $ = world.$, llEN = world.llEN, distTo = world.distTo, toEN = world.toEN, azTo = world.azTo, alignDeg = world.alignDeg,"
  + " fmtDist = world.fmtDist, scheduleTransitEst = world.scheduleTransitEst, V = world.V;\n"
  + grabFrom(UNITS, "fmtMS") + "\n"
  + "let mission = { lines: [], waypoints: [], speeds: {} }, S = {}, asv = null, runLineIdx = -1, curTurn = -1, turnSeg = [],"
  + " lineActual = [], transitEst = { transit: null, rth: null };\n"
  // the TRANSITS (2026-09-25): the hop records, the open one, the approach and RTH clocks
  + "let hopSeg = [], curHop = -1, approachSec = 0, rthSec = 0;\n"
  + "const linePhase = () => ({ phase: 'coverage' });\n"
  + decl(/^const LINE_PART_OFFSET_M = [^;]*;/m) + "\n" + decl(/^let _drawnLines = [^;]*;/m) + "\n"
  + decl(/^let _lineTableShape = [^;]*;/m) + "\n"
  + ["lineSetKey", "linePartContinues", "drawnLines", "lineNo", "lineCount", "linePartTxt", "roleSpeed", "roleSpeedMS",
     "setCellText", "setHtmlIfChanged", "setStyleIfChanged", "transitRowHtml", "lineTableSkeleton", "buildLineTable",
     "buildTurnTable", "reversalScaleM", "isReversalGap", "routeLenM", "hopVia", "buildHopTable", "renderLineTable"].map(grab).join("\n")
  + "\nreturn { renderLineTable,"
  + " set: (o) => { if ('lines' in o) mission.lines = o.lines; if ('run' in o) runLineIdx = o.run; if ('speeds' in o) mission.speeds = o.speeds;"
  + "   if ('actual' in o) lineActual = o.actual; if ('turns' in o) turnSeg = o.turns; if ('curTurn' in o) curTurn = o.curTurn;"
  + "   if ('S' in o) S = o.S; if ('est' in o) transitEst = o.est;"
  + "   if ('hops' in o) hopSeg = o.hops; if ('curHop' in o) curHop = o.curHop; if ('approach' in o) approachSec = o.approach;"
  + "   if ('rth' in o) rthSec = o.rth; if ('wps' in o) mission.waypoints = o.wps; },"
  + " turns: () => turnSeg, actual: () => lineActual }; })()");
const frames = (n) => { for (let i = 0; i < n; i++) page.renderLineTable(); };

// ── the plan: three 300 m east-west lines 20 m apart, end for end; a keep-out cuts the middle one in two ────────────
const REF = { lat: 44.9, lon: -66.98 };
const P = (e, n) => G.fromEN(e, n, REF);
const LINES = [
  { a: P(0, 0), b: P(300, 0) },
  { a: P(300, 20), b: P(180, 20) },
  { a: P(120, 20), b: P(0, 20) },
  { a: P(0, 40), b: P(300, 40) },
];
page.set({ lines: LINES, actual: [100, 60, 55, 140], run: 0, curTurn: -1, turns: [],
           S: { run: "running", behavior: "survey" }, speeds: { survey: "low", transit: "transit" },
           est: { transit: { m: 600 }, rth: { m: 900 } } });
page.renderLineTable();

// 1. a quiet frame writes nothing
let s = snap();
frames(4);
const quiet = since(s);
check("1. four frames with nothing changed write NOTHING after the first: the body is built once, and no cell's text, "
      + "markup or style is written again",
      () => W.body === 1 && quiet.body === 0 && quiet.text === 0 && quiet.html === 0 && quiet.style === 0 && quiet.textNodes === 0,
      () => "built " + W.body + "x; over the four frames: " + fmt(quiet));
check("1b. ... and asks the DOM nothing: the cells are found once per build, not looked up every frame",
      () => quiet.qs === 0 && quiet.qsa === 0, () => "querySelector " + quiet.qs + ", querySelectorAll " + quiet.qsa);

// 2. one changed time is one changed cell, edited in place
const tnBefore = cell("lt_r2_act").firstChild;
page.actual()[3] = 141;
s = snap();
page.renderLineTable();
const one = since(s);
check("2. a frame that changes one line's actual time writes that cell and the total - editing the same text node - and "
      + "nothing else",
      () => one.body === 0 && one.text === 2 && one.textNodes === 0 && one.html === 0 && one.style === 0
            && cell("lt_r2_act").firstChild === tnBefore && cell("lt_r2_act").textContent === "2:21"
            && cell("lt_sum_act").textContent === "5:56",
      () => fmt(one) + "; line 3 actual '" + cell("lt_r2_act").textContent + "', total '" + cell("lt_sum_act").textContent
            + "', same text node " + (cell("lt_r2_act").firstChild === tnBefore));

// 2b. a line's clock starting turns its cell green, once
page.actual()[0] = 0;
page.renderLineTable();
const faint = cell("lt_r0_act").textContent, faintInk = cell("lt_r0_act").style.color;
page.actual()[0] = 5;
s = snap();
frames(3);
const lit = since(s);
check("2b. a line not yet run reads -- in the faint ink, and the frame its clock starts it turns green - one style write "
      + "across three frames",
      () => faint === "--" && faintInk === "var(--ink-faint)" && cell("lt_r0_act").textContent === "0:05"
            && cell("lt_r0_act").style.color === "rgb(191, 232, 200)" && lit.style === 1,
      () => "before: '" + faint + "' " + faintInk + "; after: '" + cell("lt_r0_act").textContent + "' "
            + cell("lt_r0_act").style.color + "; " + fmt(lit));

// 3. the highlight follows the run, once
page.set({ run: 3 });
s = snap();
page.renderLineTable();
const moved = since(s);
s = snap();
frames(3);
const after = since(s);
check("3. the highlight follows the run in place - the old row clears, the new row lights, the ▸ moves - ONCE, though "
      + "the browser reads a color back in its own spelling",
      () => moved.body === 0 && moved.style === 2 && moved.text === 2
            && cell("lt_r2").style.background === "rgba(63, 192, 255, 0.14)" && cell("lt_r0").style.background === ""
            && cell("lt_r2_mark").textContent === "▸" && cell("lt_r0_mark").textContent === ""
            && after.style === 0 && after.text === 0,
      () => "the move: " + fmt(moved) + "; the three frames after it: " + fmt(after));

// 4. a speed change re-times in place; the transit rows re-render only their own markup, only when it changed
page.set({ speeds: { survey: "high", transit: "transit" } });
s = snap();
page.renderLineTable();
const surv = since(s);
page.set({ speeds: { survey: "high", transit: "low" } });
s = snap();
page.renderLineTable();
const tran = since(s);
check("4. a survey speed change re-times the plan cells and the heading in place and leaves the transit rows alone; a "
      + "transit speed change re-renders those two rows and nothing else",
      () => surv.body === 0 && surv.text === 5 && surv.html === 0 && cell("lt_speed").textContent === "high speed"
            && cell("lt_r0_plan").textContent === "1:37"
            && tran.body === 0 && tran.text === 0 && tran.html === 2 && /@ low/.test(cell("lt_transit").innerHTML)
            && /RTH L3 → home:/.test(cell("lt_rth").innerHTML),
      () => "survey: " + fmt(surv) + " (line 1 plan '" + cell("lt_r0_plan").textContent + "'); transit: " + fmt(tran));

// 5. a turn adds a row: one build, then its clock ticks in place
page.set({ turns: [{ from: 0, to: -1, sec: 0 }], curTurn: 0 });
s = snap();
page.renderLineTable();
const turnBuild = since(s);
s = snap();
for (let sec = 1; sec <= 4; sec++) { page.turns()[0].sec = sec; page.renderLineTable(); }
const ticking = since(s);
check("5. a turn starting adds its row with ONE build, and then its clock ticks in place: the turn's time and the turns "
      + "total each frame, its color once, its highlight never again",
      () => turnBuild.body === 1 && turnBuild.qsa === 1 && cell("lt_t0").style.background === "rgba(63, 192, 255, 0.14)"
            && ticking.body === 0 && ticking.qsa === 0 && ticking.text === 8 && ticking.style === 1
            && cell("lt_t0_sec").textContent === "0:04" && cell("lt_tsum").textContent === "0:04",
      () => "the build: " + fmt(turnBuild) + "; four ticks: " + fmt(ticking) + "; turn time '" + cell("lt_t0_sec").textContent + "'");

// 6. a plan edit builds again, once. A lead is applied the way Punch Out applies one: the RUN grows 20 m past the
// coverage, so the line's coverage length - its len cell - is exactly what it was, and only the lead tells the shapes apart.
page.set({ lines: [{ a: P(-20, 0), b: P(300, 0), lead_in_m: 20 }, LINES[1], LINES[2], LINES[3]] });
s = snap();
frames(3);
const edit = since(s);
check("6. an edit to the plan builds the body again ONCE - here a lead that leaves the coverage length as it was, and "
      + "adds its column - and not on the frames after",
      () => edit.body === 1 && /lead m/.test(body.innerHTML) && /<td[^>]*>300<\/td><td[^>]*>20<\/td>/.test(body.innerHTML),
      () => "three frames after the edit: " + fmt(edit) + "; lead column " + /lead m/.test(body.innerHTML)
            + "; line 1 reads 300 + lead 20: " + /<td[^>]*>300<\/td><td[^>]*>20<\/td>/.test(body.innerHTML));

// 7. an empty plan writes its note once
page.set({ lines: [], actual: [] });
s = snap();
frames(3);
const empty = since(s), note = body.innerHTML;
page.set({ lines: LINES, actual: [100, 60, 55, 140] });
s = snap();
frames(2);
const back = since(s);
check("7. an empty plan writes its note ONCE, not on every frame, and a plan put back is built again, once",
      () => empty.body === 1 && note === "Punch Out + Add to plan to populate." && back.body === 1
            && cell("lt_r1_plan").textContent !== "",
      () => "empty: " + fmt(empty) + " ('" + note + "'); put back: built " + back.body + "x");

// 8. a closed panel writes nothing
panel.style.display = "none";
page.actual()[0] = 222;
s = snap();
frames(3);
const closed = since(s);
panel.style.display = "block";
s = snap();
page.renderLineTable();
const reopened = since(s);
check("8. a closed panel writes nothing at all, and opening it shows what changed meanwhile",
      () => closed.body + closed.text + closed.html + closed.style + closed.qs + closed.qsa === 0
            && reopened.text > 0 && cell("lt_r0_act").textContent === "3:42",
      () => "closed: " + fmt(closed) + "; reopened: line 1 actual '" + cell("lt_r0_act").textContent + "'");

// 9. every cell the patcher writes is in the body it built
page.set({ lines: [Object.assign({ lead_out_m: 10 }, LINES[0]), LINES[1], LINES[2], LINES[3]], run: 1,
           turns: [{ from: 0, to: 1, sec: 12 }, { from: 2, to: -1, sec: 3 }], curTurn: 1 });
page.renderLineTable();
const want = ["lt_speed", "lt_sum_plan", "lt_sum_act", "lt_tsum", "lt_t0_lbl", "lt_t0_sec", "lt_t1_lbl", "lt_t1_sec"]
  .concat([0, 1, 2].flatMap((i) => ["lt_r" + i + "_plan", "lt_r" + i + "_act"]));
const blank = want.filter((id) => !body.nodes[id] || cell(id).textContent === "");
check("9. every cell the patcher writes is one the build made - none left blank - with the turn labels in drawn-line "
      + "numbers and the transit rows filled",
      () => blank.length === 0 && cell("lt_t0_lbl").textContent === "1→2" && cell("lt_t1_lbl").textContent === "2→·"
            && cell("lt_r1_mark").textContent === "▸" && /transit → L1:/.test(cell("lt_transit").innerHTML)
            && /RTH L3 → home:/.test(cell("lt_rth").innerHTML),
      () => "blank or missing: " + (blank.join(", ") || "none") + "; turn labels '" + cell("lt_t0_lbl").textContent
            + "', '" + cell("lt_t1_lbl").textContent + "'");

// 10. THE TRANSITS (2026-09-25). A second coverage region 600 m north: the gap from line 4 to line 5 is not a
// reversal, so the table grows a transits section - built ONCE with the shape - whose row carries the committed
// route's meters through the plan's detour point, a plan at the transit speed and the clocked actual, lit while the
// hop is under way; and the transit / RTH rows carry their actuals once flown.
const FAR = [{ a: P(0, 600), b: P(300, 600) }];
const VIA = P(150, 300);
page.set({ lines: LINES.concat(FAR), wps: [LINES[3].b, VIA, FAR[0].a, FAR[0].b], run: -1, curTurn: -1, turns: [],
           hops: [{ from: 3, to: -1, sec: 45 }], curHop: 0, approach: 61, rth: 0 });
let s10 = snap();
page.renderLineTable();
const b10 = since(s10);
s10 = snap(); frames(3); const q10 = since(s10);
const viaM = Math.round(G.distTo(LINES[3].b, VIA) + G.distTo(VIA, FAR[0].a));
check("10. a second region 600 m north: the transits table is built once with the row L3→L4 (drawn-line numbers: the split middle line is ONE line) through the plan's detour "
      + "point at the transit speed, its clocked actual lit as the hop under way, quiet frames write nothing, and the "
      + "transit row carries its actual",
      () => b10.body === 1 && body.nodes["lt_h0_lbl"] && cell("lt_h0_lbl").textContent === "3→4"
            && cell("lt_h0_sec").textContent === "0:45" && cell("lt_hsum_act").textContent === "0:45"
            && /^\d+:\d\d$/.test(cell("lt_h0_plan").textContent) && cell("lt_h0_plan").textContent !== "0:00"
            && new RegExp("<td[^>]*>" + viaM + "</td>").test(body.innerHTML) && /^@ (low|survey|high|transit)$/.test(cell("lt_hspeed").textContent)
            && cell("lt_h0").style.background !== "" && q10.body === 0 && q10.text === 0 && q10.html === 0
            && /actual 1:01/.test(cell("lt_transit").innerHTML) && !/actual/.test(cell("lt_rth").innerHTML),
      () => "builds " + b10.body + "; row '" + cell("lt_h0_lbl").textContent + "' plan " + cell("lt_h0_plan").textContent
            + " actual " + cell("lt_h0_sec").textContent + " (" + viaM + " m in body: " + new RegExp("<td[^>]*>" + viaM + "</td>").test(body.innerHTML)
            + "); quiet frames body/text/html " + q10.body + "/" + q10.text + "/" + q10.html + "; transit row: "
            + cell("lt_transit").innerHTML.replace(/<[^>]+>/g, "").slice(0, 60));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
