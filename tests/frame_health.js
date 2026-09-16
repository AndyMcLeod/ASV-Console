// tests/frame_health.js - the safety loop does not fail without a sign (review #12, 2026-09-14).
//
// Every telemetry frame runs the clearance guard, the speed governor, the re-approach and the end-of-plan
// chain inside onState, and every error in it was caught and dropped - a guard that had stopped running
// looked exactly like one with nothing to do. And a console whose telemetry loop had died kept its event
// stream alive with comments, so the link dot stayed GREEN over readouts that no longer moved. The page
// now says three things: no frame for STALE_AFTER_MS while the console says it streams (TELEMETRY STALE,
// the dot red, the pill "stale"); this page failed FRAME_FAULT_AFTER frames (CONSOLE FAULT, logged once);
// the console's own loop survived a fault (CONSOLE FAULT, from S.loop_fault). A fault comes down only after
// FRAME_CLEAR_AFTER clean frames in a row. The server half - the loop that survives, publishes loop_fault
// and says whether it streams - is tests/run_link_control.py 17-17g.
// DRIVEN: the page's own onFrame, consoleHealth and connect, with the clock, the banner and fetch stubbed.
//
//   node tests/frame_health.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 17 sidecar mutations RUN (ASV_HTML), 17/17 caught, none by a crash:
//   a failed frame not caught -> 1, 2, 2b, 6b     one failed frame is a fault -> 1, 2b
//   cleared on the first good frame -> 2, 2b       good frames between faults count toward the clear -> 2b
//   stale keyed on the link being "ok" -> 4        stale after 5 s -> 4, 6b
//   takes down any banner -> 7                     health not checked every second -> 8
//   the log flag not reset on clear -> 2           logged on every failed frame -> 1, 2
//   any message counts as an update -> 3           the dot left green when stale -> 4
//   the console's loop fault not said -> 6, 6b     a page fault hides the console's -> 6b
//   stale does not replace the faults -> 6b        the pill still says ok when stale -> 4
//   the old swallow-everything handler -> 8
// TEETH for 9-12b (review #29, the page's own watchdog) - 10 sidecar mutations, 10/10 caught:
//   a stall is never recorded -> 10, 11, 12           every tick is a stall (no threshold) -> 9, 10, 11, 12
//   a hidden tab counts as a stall -> 11, 12          the record says how long but not what the page was doing -> 10
//   the last thing the operator did is left out -> 10 the pattern corners are left out -> 10
//   a felt stall is never said -> 12                  said on every stall, however short -> 10, 11, 12
//   said again and again while it keeps happening -> 12
//   the watchdog rides the telemetry frames it is meant to outlive -> 12b
//
// NOTE: the page's script is <script type="module">, which runs STRICT - so the functions under test are evaluated
// strict here too, where an assignment to an undeclared name throws exactly as it would on the page.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
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

// ASV_HTML points this at a SIDECAR copy for a mutation run - every read of the page goes through it.
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
const DECL = ["^const FRAME_FAULT_AFTER = [^;]*;", "^let frameFaults = [^;]*;", "^const HEALTH_BANNER = [^;]*;"]
  .map((re) => {
    const m = H.match(new RegExp(re, "m"));
    if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
    return m[0];
  }).join("\n");

console.log("The safety loop does not fail without a sign:");

// ---- the page's world ------------------------------------------------------------------ //
let clock = 1e9, throwNext = 0, stateSeen = 0;
const els = { "#dot": { className: "dot ok" }, "#linktext": { textContent: "sim · ok" }, "#encbanner": { textContent: "", style: { display: "none" } } };
const logged = [];
const world = {
  $: (sel) => els[sel],
  showBanner: (t) => { els["#encbanner"].textContent = t; els["#encbanner"].style.display = "block"; },
  fetch: (url, opts) => { logged.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); },
};
// eslint-disable-next-line no-eval
const page = eval("(function(){ \"use strict\"; let S = {}; const $ = world.$, showBanner = world.showBanner, fetch = world.fetch;"
  + " const Date = { now: () => clock }; const console = { error: () => {} }; const buildCheck = () => {}; const storageCheck = () => {};"
  + " const onState = (m) => { stateSeen++; S = m; if (throwNext > 0) { throwNext--; throw new TypeError(\"guard fell over\"); } };\n"
  + DECL + "\n" + grab("onFrame") + "\n" + grab("consoleHealth") + "\n"
  + "return { onFrame, consoleHealth, faults: () => frameFaults, lastAt: () => lastFrameAt }; })()");
// A frame that throws OUT of onFrame is recorded, not a crash: the old handler's whole job was to never let one escape.
const escaped = [];
const frame = (extra) => {
  try { page.onFrame({ data: JSON.stringify(Object.assign({ type: "state", mode: "sim", link: "ok", streaming: true, loop_fault: null }, extra || {})) }); }
  catch (e) { escaped.push(e.message); }
};
const banner = () => (els["#encbanner"].style.display === "block" ? els["#encbanner"].textContent : "");

// 1-2. frames that fail
const clean = (n) => { for (let i = 0; i < n; i++) frame(); };
frame();
throwNext = 2;
frame(); frame();
const afterTwo = { faults: page.faults(), banner: banner() };
throwNext = 1;
frame();
const afterThree = { faults: page.faults(), banner: banner(), logs: logged.length };
throwNext = 2;
frame(); frame();
const logsStill = logged.length;
check("1. a failed frame never escapes onFrame; one or two are not a fault; the THIRD says CONSOLE FAULT naming the "
      + "error, and is logged to the session log once, not per frame",
      () => escaped.length === 0 && afterTwo.faults === 2 && afterTwo.banner === "" && afterThree.faults === 3
            && /^⚠ CONSOLE FAULT — this page has failed to process 3 recent telemetry frames \(guard fell over\)/.test(afterThree.banner)
            && afterThree.logs === 1 && logged[0].url === "/api/logevent" && logged[0].body.kind === "page_frame_fault"
            && logsStill === 1,
      () => (escaped.length ? escaped.length + " escaped onFrame ('" + escaped[0] + "'); " : "")
            + "after 2: " + JSON.stringify(afterTwo) + "; after 3: faults " + afterThree.faults + ", logs " + afterThree.logs
            + ", then " + logsStill + " after 2 more");
clean(7);
const sevenClean = { faults: page.faults(), up: /CONSOLE FAULT/.test(banner()) };
frame();
const cleared = { faults: page.faults(), banner: banner() };
throwNext = 3;
frame(); frame(); frame();
check("2. the fault stays up through 7 clean frames and comes down on the 8th in a row - and a later streak is logged again",
      () => sevenClean.faults === 5 && sevenClean.up && cleared.faults === 0 && cleared.banner === "" && logged.length === 2,
      () => "after 7 clean: " + JSON.stringify(sevenClean) + "; after 8: " + JSON.stringify(cleared)
            + "; logs after a second streak " + logged.length);
clean(8);
const flicker = [];
for (let i = 0; i < 3; i++) { throwNext = 1; frame(); frame(); flicker.push(page.faults() + ":" + (banner() ? "up" : "-")); }
clean(6);
const upAfter7 = /CONSOLE FAULT/.test(banner());
frame();
check("2b. a fault on every other frame is a fault, not a flicker - the good frames between neither reset the count nor "
      + "count toward the 8 in a row that take it down",
      () => flicker.join(",") === "1:-,2:-,3:up" && upAfter7 && banner() === "",
      () => "fault:banner after each fail+good pair " + flicker.join(",") + "; up after 7 good in a row " + upAfter7
            + "; after the 8th '" + banner() + "'");

// 3. not a frame
const at3 = page.lastAt(), seen3 = stateSeen;
clock += 500;                             // so a message taken as an update would move lastFrameAt
page.onFrame({ data: "not json at all" });
page.onFrame({ data: JSON.stringify({ type: "hello" }) });
check("3. a message that is not a state frame is not a fault and does not count as an update",
      () => page.faults() === 0 && page.lastAt() === at3 && stateSeen === seen3,
      () => "faults " + page.faults() + ", onState calls " + (stateSeen - seen3));

// 4-5. stale
frame();
els["#dot"].className = "dot ok";
clock += 1500; page.consoleHealth();
const at1500 = banner();
clock += 1000; page.consoleHealth();
const staleSaid = banner(), staleDot = els["#dot"].className, staleText = els["#linktext"].textContent;
frame();
const freshAgain = banner();
frame({ link: "lost" });
clock += 2500; page.consoleHealth();
const lostSaid = banner();
frame();
check("4. no frame for over 2 s while the console says it streams says TELEMETRY STALE, with the age, turns the dot "
      + "red and the pill beside it to 'stale' - with the link lost too, since a lost link still streams - and the next "
      + "frame takes it down",
      () => at1500 === "" && /^⚠ TELEMETRY STALE — no update from the console for 3 s/.test(staleSaid)
            && staleDot === "dot lost" && staleText === "sim · stale" && freshAgain === "" && /^⚠ TELEMETRY STALE/.test(lostSaid) && banner() === "",
      () => "at 1.5 s '" + at1500 + "'; at 2.5 s dot " + staleDot + ", pill '" + staleText + "', '" + staleSaid.slice(0, 60) + "'; after a frame '"
            + freshAgain + "'; link lost '" + lostSaid.slice(0, 26) + "'");
frame({ link: "idle", streaming: false });
clock += 10000; page.consoleHealth();
const idleSaid = banner();
// eslint-disable-next-line no-eval
const fresh = eval("(function(){ \"use strict\"; let S = {}; const $ = world.$, showBanner = world.showBanner, fetch = world.fetch;"
  + " const Date = { now: () => clock }; const console = { error: () => {} }; const buildCheck = () => {}; const storageCheck = () => {}; const onState = (m) => { S = m; };\n"
  + DECL + "\n" + grab("onFrame") + "\n" + grab("consoleHealth") + "\n return { consoleHealth }; })()");
clock += 10000; fresh.consoleHealth();
check("5. ... but not when the console says nothing is streaming (no link: no frames to go stale), nor before the first frame",
      () => idleSaid === "" && banner() === "",
      () => "no link: '" + idleSaid + "'; before any frame: '" + banner() + "'");

// 6. the console's own loop
const LF = { error: "ZeroDivisionError: a monitor fell over", count: 7, since: "18:42:05" };
frame({ loop_fault: LF });
const loopSaid = banner();
frame({ loop_fault: null });
check("6. a fault the console's telemetry loop survived is said - count, time and error - and goes when the console clears it",
      () => /^⚠ CONSOLE FAULT — the console's telemetry loop has failed 7 time\(s\) since 18:42:05 \(ZeroDivisionError: a monitor fell over\) and keeps running/.test(loopSaid)
            && banner() === "",
      () => "'" + loopSaid.slice(0, 90) + "'; after it clears '" + banner() + "'");
throwNext = 3;
frame({ loop_fault: LF }); frame({ loop_fault: LF }); frame({ loop_fault: LF });
const bothSaid = banner();
clock += 2500; page.consoleHealth();
const staleOverFaults = banner();
clean(8);
check("6b. a page fault and a console fault together are both said, page first; frames that stop say only STALE, since "
      + "neither fault is current then; clean frames take it all down",
      () => /^⚠ CONSOLE FAULT — this page has failed to process 3 recent telemetry frames \(guard fell over\)\..* And the console's telemetry loop has failed 7 time\(s\)/.test(bothSaid)
            && /^⚠ TELEMETRY STALE/.test(staleOverFaults) && !/CONSOLE FAULT/.test(staleOverFaults) && banner() === "",
      () => "both '" + bothSaid.replace(/(.{70}).*(And.{40}).*/, "$1 ... $2") + "'; stopped '" + staleOverFaults.slice(0, 30)
            + "'; after 8 clean '" + banner() + "'");

// 7. somebody else's banner
world.showBanner("⚠ PLAN NOT LOADED — the console did not answer.");
frame();
page.consoleHealth();
check("7. a healthy console never takes down a banner that is not its own",
      () => /PLAN NOT LOADED/.test(banner()), () => "'" + banner() + "'");

// 8. wired
const conn = grab("connect");
check("8. connect() hands every message to onFrame and checks the console's health every second",
      () => /es\.onmessage = onFrame;/.test(conn) && /setInterval\(consoleHealth, 1000\)/.test(conn)
            && !/catch\(e\)\{\}/.test(conn),
      () => conn.replace(/\s+/g, " ").slice(0, 160));

// ── 9-12. THE PAGE'S OWN WATCHDOG: A STALL LEAVES EVIDENCE (review #29, 2026-09-15) ──────────────────
// Andy reported the page hanging while placing survey corners A / B / C. It has never been isolated - it was first
// seen under SYNTHETIC clicks, which is itself a suspect - so nothing here fixes it. What it does is make the NEXT
// one leave a record: how long the main thread was gone, and what the page was doing when it went.
const STALL_DECLS = ["^const STALL_TICK_MS = [^;]*;", "^let stallLast = [^;]*;"]
  .map((re) => {
    const m = H.match(new RegExp(re, "m"));
    if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
    return m[0];
  }).join("\n");
let sclock = 5e8, visible = "visible";
const sbanners = [], slogged = [];
// eslint-disable-next-line no-eval
const stall = eval("(function(){ \"use strict\";"
  + " const Date = { now: () => sclock };"
  + " const document = { get visibilityState(){ return visible; } };"
  + " const fetch = (url, opts) => { slogged.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); };"
  + " const console = { warn: () => {} };"
  + " const showBanner = (t) => { sbanners.push(t); };"
  + " let mode = 'survey'; const pat = { A: {}, B: {}, C: null }; const patClip = [[1], [2]];"
  + " const mission = { waypoints: new Array(212), lines: new Array(9), boundary: [] };"
  + " const nogo = { ko: { polys: new Array(40), lines: new Array(5), points: new Array(3) } };"
  + " const runRoute = new Array(645), track = new Array(1200), zoom = 15, S = { run: 'running' };"
  // newest first, and the newest is a BANNER the page posted to itself - which is what the operator did NOT do
  + " const actionLog = [{ kind: 'banner', label: '3 transit(s) auto-routed' }, { kind: 'cmd', label: 'Pattern corner B' }];\n"
  + STALL_DECLS + "\n" + grab("stallContext") + "\n" + grab("stallWatch") + "\n"
  + "return { stallWatch, setMode: (m) => { mode = m; } }; })()");
const stallTick = (ms) => { sclock += ms; stall.stallWatch(); };

stallTick(0); stallTick(500); stallTick(500);
check("9. a page that is keeping up records nothing - the watchdog is not a metronome writing a line every half second",
      () => slogged.length === 0 && sbanners.length === 0,
      () => slogged.length + " record(s), " + sbanners.length + " banner(s)");

stallTick(2200);
const rec = slogged[0] && slogged[0].body;
check("10. a VISIBLE page that stopped for longer than STALL_MS writes page_stall - with how long, what mode it was "
      + "in, which pattern corners were down, how much geometry was on the chart, and the last thing the operator did",
      () => slogged.length === 1 && rec.kind === "page_stall" && rec.data.gap_ms === 2200
            && rec.data.mode === "survey" && rec.data.pattern_anchors === "AB" && rec.data.pattern_runs === 2
            && rec.data.waypoints === 212 && rec.data.lines === 9 && rec.data.route === 645
            && rec.data.nogo === 48 && rec.data.track === 1200 && rec.data.zoom === 15
            // the last thing the OPERATOR did, not the last banner the page posted to itself - and this watchdog's
            // own banner was that banner, in the live check, for every stall after the first
            && rec.data.last_action === "Pattern corner B" && sbanners.length === 0,
      () => JSON.stringify(rec && rec.data).slice(0, 170));

visible = "hidden";
stallTick(9000);
check("11. a HIDDEN tab going quiet is not a stall - a browser throttles a background tab on purpose, and review "
      + "#14's page_throttled is where that belongs",
      () => slogged.length === 1 && sbanners.length === 0,
      () => slogged.length + " record(s) after 9 s hidden");

visible = "visible";
stallTick(9000);
const said = sbanners.length;
stallTick(9000);
check("12. a stall long enough to be FELT is said once, in the operator's words, and not again every time it "
      + "happens in the next half minute",
      () => said === 1 && /STOPPED RESPONDING for 9\.0 s \(survey mode\)/.test(sbanners[0])
            && /nothing was commanded/.test(sbanners[0]) && sbanners.length === 1 && slogged.length === 3,
      () => (sbanners[0] || "(nothing said)").slice(0, 110));

check("12b. and it is WIRED: the watchdog runs on its own timer, not off the telemetry frames it is there to "
      + "outlive",
      () => /setInterval\(stallWatch, STALL_TICK_MS\)/.test(H),
      "a frame-driven watchdog cannot see the page stop between frames");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
