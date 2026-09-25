// tests/page_log_posts.js - the page posts its OWN card data into the session log, on change and never per frame
// (2026-09-25, for playback's cards): the nogo readout, the History rows, the guard bar, the LINES table.
//
// DRIVEN: the page's own logClient, updateNogoUI, recordAction, historyText, logGuardChange and logLinesTick, brace-
// matched out of static/asv.html and evaluated with a recording `fetch`, a fake element per selector and the state each
// reads. What is asserted is WHEN a post happens and what it carries - a readout repeated is not re-posted, a History
// row that merges into an existing one is not re-posted, the guard bar posts only when it changes, the LINES tick
// posts only while a run is under way.
//
//   node tests/page_log_posts.js      # exit 0 = pass, 1 = fail
// ASV_HTML points this at a SIDECAR copy for a mutation run.
const fs = require("fs");
const path = require("path");

// crash guard: a death outside a check() is REPORTED, not silent (turn_geometry.js 30)
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond); note = typeof detail === "function" ? detail() : detail; }
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
function decl(re) { const m = H.match(re); if (!m) throw new Error("test setup: declaration " + re + " not found"); return m[0]; }

function world() {
  const posts = [];
  const els = {};
  const fakeEl = (id) => ({ id, textContent: "", className: "", style: {}, title: "", disabled: false,
                            classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } } });
  const $ = (s) => els[s] || (els[s] = fakeEl(s));
  const fetch = (url, opts) => { posts.push({ url, body: JSON.parse(opts.body) }); return { catch() {} }; };
  const readout = { text: "1300 zones · floor 2.0 m", cls: "" };
  const S = { run: "idle" };
  const mission = { lines: [] };
  // eslint-disable-next-line no-new-func
  const W = new Function("$", "fetch", "readout", "S", "mission", `"use strict";
    const nogo = { ready: true }; let nogoShow = true;
    const nogoReadout = () => ({ text: readout.text, cls: readout.cls, title: "" });
    const setTip = () => {};
    const HISTORY_MAX = 20, HISTORY_KEY = "k";
    let actionLog = [];
    const lsSet = () => {}; const renderHistory = () => {};
    const buildLineTable = () => [{ len_m: 100, plan_s: 60, actual_s: 30 }]; const buildTurnTable = () => [];
    ${decl(/^let lastNogoLogged = null;/m)}
    ${decl(/^let lastGuardLogged = "";/m)}
    ${["logClient", "updateNogoUI", "recordAction", "historyText", "logGuardChange", "logLinesTick"].map(grab).join("\n")}
    return { updateNogoUI, recordAction, logGuardChange, logLinesTick, log: () => actionLog };`)($, fetch, readout, S, mission);
  return { W, posts, els, readout, S, mission, $ };
}

console.log("The page posts its own card data into the session log, on change:");
{
  const { W, posts, readout } = world();
  W.updateNogoUI(); W.updateNogoUI(); W.updateNogoUI();
  const one = posts.length;
  readout.text = "1310 zones · floor 2.0 m · +10 chart"; readout.cls = "warn";
  W.updateNogoUI(); W.updateNogoUI();
  check("1. the nogo readout is posted when it CHANGES - three identical updates make one post, a changed readout one more, "
        + "each to /api/logevent as {kind:'nogo', data:{text, cls, ready}}",
        () => one === 1 && posts.length === 2 && posts.every((p) => p.url === "/api/logevent" && p.body.kind === "nogo")
              && posts[0].body.data.text === "1300 zones · floor 2.0 m" && posts[1].body.data.text === "1310 zones · floor 2.0 m · +10 chart"
              && posts[1].body.data.cls === "warn" && posts[1].body.data.ready === true,
        () => posts.length + " post(s): " + JSON.stringify(posts.map((p) => p.body.data.text)));
}
{
  const { W, posts } = world();
  W.recordAction("banner", "Nogo established (1300 nogo zone(s))");
  W.recordAction("banner", "Nogo established (1300 nogo zone(s))");     // merges into the row above: not a new row
  W.recordAction("cmd", "Arm", "ARMED");
  W.recordAction("cmd", "Arm", "ARMED");                                 // a repeat on top: merged
  check("2. a History row is posted when it is NEW - a repeat that merges into an existing row is not re-posted - with "
        + "the row's text as the card shows it",
        () => posts.length === 2 && posts.every((p) => p.body.kind === "history")
              && posts[0].body.data.text === "Nogo established (1300 nogo zone(s))" && posts[0].body.data.what === "banner"
              && posts[1].body.data.text === "Arm — ARMED" && W.log().length === 2,
        () => posts.length + " post(s): " + JSON.stringify(posts.map((p) => p.body.data.text)) + "; rows " + W.log().length);
}
{
  const { W, posts, $ } = world();
  const bar = $("#guardBar"); bar.style.display = "none"; bar.textContent = "";
  W.logGuardChange(); W.logGuardChange();
  const hidden = posts.length;
  bar.style.display = ""; bar.className = "guardbar blind"; bar.textContent = "  GUARD BLIND\n 96.8 m off a keep-out ";
  W.logGuardChange(); W.logGuardChange();
  const shownOnce = posts.length;
  bar.className = "guardbar helm"; bar.textContent = "HELM - the console would steer now";
  W.logGuardChange();
  bar.style.display = "none";
  W.logGuardChange();
  check("3. the guard bar is posted on CHANGE: nothing while hidden, once when it shows (whitespace folded), once when its "
        + "rung changes, and once more when it hides again",
        () => hidden === 0 && shownOnce === 1 && posts.length === 3 && posts.every((p) => p.body.kind === "guard")
              && posts[0].body.data.shown === true && posts[0].body.data.text === "GUARD BLIND 96.8 m off a keep-out"
              && posts[0].body.data.cls === "guardbar blind" && posts[1].body.data.cls === "guardbar helm"
              && posts[2].body.data.shown === false && posts[2].body.data.text === "",
        () => posts.length + " post(s): " + JSON.stringify(posts.map((p) => [p.body.data.shown, p.body.data.cls])));
}
{
  const { W, posts, S, mission, $ } = world();
  W.logLinesTick();                                    // idle: nothing
  S.run = "running"; W.logLinesTick();                 // running with no lines: nothing
  mission.lines = [{}];
  $("#v_runtime").textContent = " 1:00 · 2:00 left · 33% "; $("#v_surveydur").textContent = "5m @ survey";
  $("#v_approach").textContent = "1m @ high"; $("#v_wpt").textContent = "3 / 40"; $("#v_mission").textContent = "Run\n running";
  S.run = "idle"; W.logLinesTick();                    // lines drawn but nothing running: still nothing
  const before = posts.length;
  S.run = "running"; W.logLinesTick();
  check("4. the LINES tick posts only while a run is under way with lines - a plan drawn and idle posts nothing - carrying "
        + "the table and the run-time readouts as the cards show them (whitespace folded)",
        () => before === 0 && posts.length === 1 && posts[0].body.kind === "lines"
              && posts[0].body.data.lines.length === 1 && posts[0].body.data.runtime === "1:00 · 2:00 left · 33%"
              && posts[0].body.data.survey === "5m @ survey" && posts[0].body.data.approach === "1m @ high"
              && posts[0].body.data.wpt === "3 / 40" && posts[0].body.data.mission === "Run running",
        () => posts.length + " post(s): " + JSON.stringify(posts[0] && posts[0].body.data).slice(0, 200));
}
check("5. the tickers are installed beside consoleHealth's: the guard bar every 2 s, the LINES table every 30 s",
      () => /setInterval\(logGuardChange, 2000\)/.test(H) && /setInterval\(logLinesTick, 30000\)/.test(H),
      "setInterval(logGuardChange, 2000) / setInterval(logLinesTick, 30000)");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
