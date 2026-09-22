// tests/supervisor_page.js - the page half of "all supervision lives in one browser tab" (review #14, 2026-09-15).
//
// The console grants supervision to one tab (tests/supervisor.py). THIS is what the other tabs do about it: they
// show everything and command nothing, they say so rather than failing quietly, and the controls that STOP the boat
// stay live in every one of them. And a tab that was asleep says so, because a supervising tab that stopped running
// is the failure the operator cannot see from the screen.
//
// 2026-09-16, Andy: "the supervisory tab process is broken." Two faults on this side, each with checks here:
//   * THE CONTROLS WINDOW REPORTED IN (6b). It is this page under ?panel=controls: it opens no stream, runs no ladder,
//     and every control in it is carried out by the chart window. It took the post from the chart window ten times in
//     twelve minutes of his session, and while it held it nothing ran the guard. It never reports now, never holds,
//     and commands nothing itself. (Its clicks go to every chart window in the browser over the UI-split channel, so
//     whichever of them holds the post carries them out.)
//   * REPORTS CAME FROM A TIMER (7-7e, 8b, 8c). A browser slows an off-screen page's timers to a wake-up a minute but
//     keeps delivering the event stream, and the ladder runs on the stream - measured on a hidden tab: one timer
//     wake-up in 30 s against 121 frames. A report now rides the stream, once a beat; a page that has really stopped
//     handles nothing, reports nothing, and on waking says how long it was gone.
// DRIVEN: the page's own supervising / applySupervisor / supervisorStreamed / supervisorReport / supervisorSlept /
// cmd / canCommand / applyViewOnly / onFrame, with the DOM, fetch and the clock stubbed.
//
//   node tests/supervisor_page.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ASV_HTML points this at a SIDECAR copy for a mutation run - every read of the page goes through it.
//
// TEETH - 22 sidecar mutations RUN (ASV_HTML), 22/22 caught, none by a crash:
//   the controls window reports and supervises -> 6b       supervising() ignores the window's role -> 6b
//   supervisorReport has no role guard -> 6b               the controls window's refusal says VIEW ONLY -> 6b
//   a report on every frame (no rate limit) -> 7b, 7d      the rate ignores the console's beat -> 7d
//   the sleep threshold ignores the console's stale time -> 7d
//   the banner keys on where the gap ENDED (the old rule) -> 7, 7c
//   the banner is said for any gap -> 7c                   visibility read after it is updated -> 7, 7c
//   a broken stream is not forgotten -> 7e                 no record for a gap that began on screen -> 7c
//   the report goes before the ladder runs -> 8c           a frame whose ladder threw still reports -> 8c
//   the pulse is taken after the ladder -> 8c              a timer drives the report again -> 8b
//   the idle tick is not listened for -> 8b                the stream's error does not drop the gap -> 8b
//   the controls window releases on the way out -> 8b
//   and three of review #14's own, re-run on this harness: a view-only tab commands anyway -> 2, 6b; canCommand
//   ignores which tab is in charge -> 4b; nobody supervising reads as somebody else -> 6.
// Review #14's other six (the stop class gated, the bar left live, the stop buttons disabled, the banner re-posted
// every frame, the guard and the governor acting in every tab) were caught on 2026-09-15 by checks 3, 4, 5 and 8,
// whose logic this rewrite did not change; they were not re-run.
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
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}

console.log("One tab commands; the others watch, and say so:");

// ── the page's world: the DOM it writes, the console it talks to, and a clock under this suite's hand ──
// `role` is what ?panel= made this page: "main" (the chart window) or "controls".
function makeWorld(role) {
  const el = (id) => ({ id, style: {}, textContent: "", title: "", disabled: false, onclick: null,
                        classList: { toggle(){}, add(){}, remove(){} } });
  const buttons = ["b_arm", "b_upload", "b_start", "b_pause", "b_stop", "b_hold", "b_rth", "b_estop", "b_reset"]
    .map((id) => Object.assign(el(id), { className: "cbtn" }));
  const els = { "#supPill": el("supPill"), "#encbanner": el("encbanner"), "#note": el("note") };
  const posts = [], banners = [], notes = [], recorded = [];
  let clock = 1000000, visibility = "hidden";        // a tab that missed its beats was, as a rule, not on screen
  const body = [
    "\"use strict\";",
    "const $ = (s) => els[s] || null;",
    "let S = {};",
    "const showNote = (m) => { notes.push(m); };",
    "const showBanner = (m) => { banners.push(m); els['#encbanner'].textContent = m; };",
    "const recordAction = (kind, label, answer) => recorded.push([kind, label, answer]);",
    "const guiConfirm = async () => true;",
    decl(/^const CLIENT_ID = [\s\S]*?;$/m),
    decl(/^const SUPERVISOR_BEAT_MS = [^;]*;/m),
    decl(/^const SUPERVISOR_ANY = [^;]*;/m),
    // cmd() bounds its own fetch (2026-09-22) - the bundle carries the bound across
    // rather than restating it, so a change to the page is a change here.
    decl(/^const CMD_TIMEOUT_MS = [^;]*;/m),
    decl(/^const SUPERVISES = [^;]*;/m),
    decl(/^let supHolder = [^;]*;/m),
    decl(/^let supBeatMs = [^;]*;/m),
    decl(/^let supLastReport = [^;]*;/m),
    decl(/^const VIEW_ONLY_LIVE = [^;]*;/m),
    ["supervising", "applySupervisor", "supervisorBeat", "supervisorStreamed", "supervisorStreamLost",
     "supervisorReport", "supervisorSlept", "cmd", "cmdLabel", "canCommand", "applyViewOnly"].map(grab).join("\n"),
    "return { CLIENT_ID, supervising, applySupervisor, cmd, canCommand, applyViewOnly,",
    // what onFrame does for a frame the ladder ran on, and what the console's idle tick does
    "         stream: () => { supervisorStreamed(); supervisorReport(); },",
    "         streamLost: supervisorStreamLost,",
    "         setS: (s) => { S = s; } };",
  ].join("\n");
  // eslint-disable-next-line no-new-func
  const w = new Function("UIROLE", "els", "document", "fetch", "posts", "banners", "notes", "recorded", "Date",
                         "setInterval", "addEventListener", "navigator", "crypto", body)(
    role, els,
    { querySelectorAll: (sel) => (sel === ".cbtn" ? buttons : []),
      get visibilityState() { return visibility; } },
    (url, opt) => { posts.push({ url, opt }); return Promise.resolve({ ok: true, status: 200,
                                                                      json: async () => ({ ok: true }) }); },
    posts, banners, notes, recorded,
    { now: () => clock }, () => {}, () => {}, { sendBeacon: () => true }, { randomUUID: () => role + "-tab" });
  const bodyOf = (p) => { try { return JSON.parse(p.opt && p.opt.body); } catch (e) { return {}; } };
  return Object.assign(w, { els, buttons, posts, banners, notes, recorded,
                            advance: (ms) => { clock += ms; },
                            show: (v) => { visibility = v; },
                            reports: () => posts.filter((p) => p.url === "/api/supervisor"),
                            asleep: () => posts.filter((p) => p.url === "/api/logevent"
                                                        && bodyOf(p).kind === "page_asleep").map(bodyOf) });
}

// 1-2. a tab that has the post commands; one that does not is refused HERE, in words
const W = makeWorld("main");
W.applySupervisor({ holder: W.CLIENT_ID, stale: false, tabs: 1 });
W.cmd("/api/cmd/goto", { lat: 1, lon: 2 });
check("1. the supervising tab commands as it always did",
      () => W.posts.some((p) => p.url === "/api/cmd/goto"),
      () => W.posts.map((p) => p.url).join(", ") || "nothing sent");

W.applySupervisor({ holder: "another-tab", stale: false, tabs: 2 });
const before = W.posts.length;
W.cmd("/api/cmd/goto", { lat: 1, lon: 2 });
check("2. a view-only tab's command never reaches the console, and the refusal says why and what to do about it",
      () => W.posts.length === before && W.notes.some((n) => /VIEW ONLY/.test(n) && /TAKE OVER/.test(n))
            && W.recorded.some((r) => r[0] === "refused" && /Go-To/.test(r[1])),
      () => (W.notes[W.notes.length - 1] || "(nothing said)").slice(0, 96));

// 3. ... except the three that stop the boat
const stops = ["/api/cmd/stop", "/api/cmd/pause", "/api/cmd/estop"];
const stopsBefore = W.posts.length;
for (const s of stops) W.cmd(s, {});
check("3. STOP, PAUSE and E-STOP go out from a view-only tab - a control that reduces risk is never gated on which "
      + "tab is in charge",
      () => W.posts.length === stopsBefore + 3 && stops.every((s) => W.posts.some((p) => p.url === s)),
      () => W.posts.slice(stopsBefore).map((p) => p.url).join(", ") || "none sent");

// 4. the command bar, and the chart menu's gate
W.setS({ armed: true, estop: false });
W.applyViewOnly();
const live = W.buttons.filter((b) => !b.disabled).map((b) => b.id);
check("4. the command bar is dead in a view-only tab except those same three, and each dead control says why",
      () => live.join(",") === "b_pause,b_stop,b_estop"
            && W.buttons.filter((b) => b.disabled).every((b) => /VIEW ONLY/.test(b.title) && /TAKE OVER/.test(b.title)),
      () => "still live: " + (live.join(", ") || "none"));
check("4b. and canCommand - the gate on every chart-menu row that commands the boat - is false in a view-only tab "
      + "and true in the supervising one",
      () => {
        const viewOnly = W.canCommand({ armed: true, estop: false });
        W.applySupervisor({ holder: W.CLIENT_ID, stale: false, tabs: 2 });
        return viewOnly === false && W.canCommand({ armed: true, estop: false }) === true;
      },
      "armed and clear either way - the only difference is which tab is in charge");
// 5. the pill and the banner
const W5 = makeWorld("main");
W5.applySupervisor({ holder: "another-tab", stale: false, tabs: 2 });
const pill5 = { display: W5.els["#supPill"].style.display, text: W5.els["#supPill"].textContent };
W5.applySupervisor({ holder: "another-tab", stale: false, tabs: 2 });
W5.applySupervisor({ holder: W5.CLIENT_ID, stale: false, tabs: 2 });
check("5. the top bar offers TAKE OVER while this tab is view-only, says it once rather than every frame, and the "
      + "offer goes away the moment this tab has the post",
      () => pill5.display === "" && /VIEW ONLY/.test(pill5.text) && /TAKE OVER/.test(pill5.text)
            && W5.banners.filter((b) => /VIEW ONLY/.test(b)).length === 1
            && W5.els["#supPill"].style.display === "none",
      () => "pill '" + pill5.text + "'; banners " + W5.banners.length + "; now " + W5.els["#supPill"].style.display);

// 6. nobody supervising is not the same as somebody else supervising
const W6 = makeWorld("main");
W6.applySupervisor({ holder: null, stale: false, tabs: 0 });
check("6. with NOBODY holding the post the chart window is not held back - a console that has not been told yet, or "
      + "one from before any of this existed, still takes commands",
      () => W6.supervising() === true && W6.els["#supPill"].style.display === "none",
      () => "supervising=" + W6.supervising());

// 6b. THE CONTROLS WINDOW (2026-09-16): whatever reaches it, it neither reports nor holds nor commands
const WC = makeWorld("controls");
WC.show("visible");
for (let i = 0; i < 12; i++) { WC.stream(); WC.advance(2500); }
WC.advance(60000); WC.stream();
WC.cmd("/api/cmd/goto", { lat: 1, lon: 2 });
WC.cmd("/api/cmd/stop", {});
check("6b. the CONTROLS window never reports in and never holds the post, even with nobody holding it; it commands "
      + "nothing itself and says so in its own words - its clicks are carried out by the chart window - while a "
      + "stop still goes out from it",
      () => WC.reports().length === 0 && WC.asleep().length === 0 && WC.supervising() === false
            && !WC.posts.some((p) => p.url === "/api/cmd/goto") && WC.posts.some((p) => p.url === "/api/cmd/stop")
            && WC.notes.some((n) => /chart window/.test(n)) && !WC.notes.some((n) => /TAKE OVER/.test(n)),
      () => WC.reports().length + " report(s); supervising=" + WC.supervising() + "; said '"
            + (WC.notes[0] || "(nothing)").slice(0, 70) + "'; sent " + WC.posts.map((p) => p.url).join(", "));

// 7. a tab that the browser put to sleep says so when it comes back
const W7 = makeWorld("main");
W7.applySupervisor({ holder: W7.CLIENT_ID, stale: false, tabs: 1 });
W7.show("hidden");
W7.stream(); W7.advance(250); W7.stream();           // off screen, and the stream still arriving
const quietBanners = W7.banners.length;
W7.advance(45000);                                    // then the browser slept the tab for 45 s
W7.show("visible");                                   // ... and the operator came back to it
W7.stream();
const slept = W7.banners.filter((b) => /WAS ASLEEP/.test(b));
const rec7 = W7.asleep();
check("7. a supervising tab that stopped handling the stream while OFF screen says so when it next handles it - with "
      + "how long it was gone, even though the operator is looking by then - and writes page_asleep",
      () => quietBanners === 0 && slept.length === 1 && /45 s/.test(slept[0]) && rec7.length === 1
            && rec7[0].data.gap_s === 45 && rec7[0].data.supervising === true && rec7[0].data.began_hidden === true,
      () => (slept[0] || "(nothing said)").slice(0, 60) + " | " + JSON.stringify(rec7[0] && rec7[0].data));

// 7b. reports ride the stream: once a beat, however many frames, and with no timer at all
const W7b = makeWorld("main");
W7b.show("hidden");
for (let i = 0; i < 8; i++) { W7b.stream(); W7b.advance(250); }    // 8 frames inside one beat
const inOneBeat = W7b.reports().length;
for (let i = 0; i < 240; i++) { W7b.stream(); W7b.advance(250); }  // a minute off screen, the stream still arriving
const inAMinute = W7b.reports().length - inOneBeat;
check("7b. an off-screen page that is still handling the stream REPORTS - once per beat however many frames arrive, "
      + "with its own name - and records no sleep: its timers may be down to one a minute, and its ladder is running",
      () => inOneBeat === 1 && inAMinute >= 29 && inAMinute <= 31 && W7b.asleep().length === 0
            && W7b.banners.length === 0
            && W7b.reports().every((p) => JSON.parse(p.opt.body).id === W7b.CLIENT_ID),
      () => inOneBeat + " report(s) in the first beat, " + inAMinute + " in the next minute; "
            + W7b.asleep().length + " sleep record(s)");

// 7c. ONE EVENT, ONE BANNER: a gap that began ON screen is the page's own stall, which review #29 says
const W7c = makeWorld("main");
W7c.applySupervisor({ holder: W7c.CLIENT_ID, stale: false, tabs: 1 });
W7c.show("visible");
W7c.stream(); W7c.advance(250); W7c.stream();
W7c.advance(45000);                                   // the main thread stopped while the operator watched
W7c.show("hidden");                                   // ... and they had gone elsewhere by the time it came back
W7c.stream();
const rec7c = W7c.asleep();
check("7c. a gap that BEGAN on screen is not called a sleep - it is a stall, and review #29 says that with what the "
      + "page was doing; two banners for one freeze is one too many. The record is written either way",
      () => W7c.banners.filter((b) => /WAS ASLEEP/.test(b)).length === 0 && rec7c.length === 1
            && rec7c[0].data.began_hidden === false && rec7c[0].data.supervising === true,
      () => W7c.banners.length + " banner(s); " + JSON.stringify(rec7c[0] && rec7c[0].data));

// 7d. the console's own numbers
const W7d = makeWorld("main");
W7d.show("hidden");
W7d.stream(); W7d.advance(8000); W7d.stream();        // 8 s: inside the page's own default
const under7d = W7d.asleep().length;
W7d.applySupervisor({ holder: W7d.CLIENT_ID, stale: false, tabs: 1, beat_s: 5, stale_s: 6 });
W7d.advance(7000); W7d.stream();                      // 7 s against the 6 s this console says
const over7d = W7d.asleep();
const reportsBefore7d = W7d.reports().length;
for (let i = 0; i < 40; i++) { W7d.advance(250); W7d.stream(); }  // 10 s of frames at the console's 5 s beat
const at5s = W7d.reports().length - reportsBefore7d;
check("7d. the page keeps to the CONSOLE's numbers once it has them - its stale time for what counts as a sleep, its "
      + "beat for how often to report - so one number governs both ends",
      () => under7d === 0 && over7d.length === 1 && over7d[0].data.gap_s === 7 && at5s === 2,
      () => "8 s under the default: " + under7d + "; 7 s over the console's 6: " + over7d.length
            + "; reports in 10 s at a 5 s beat: " + at5s);

// 7e. a gap across a broken stream belongs to the console
const W7e = makeWorld("main");
W7e.applySupervisor({ holder: W7e.CLIENT_ID, stale: false, tabs: 1 });
W7e.show("hidden");
W7e.stream();
W7e.streamLost();                                     // the stream broke - the console went away
W7e.advance(60000);                                   // and came back a minute later
W7e.stream();
check("7e. a gap that spans a BROKEN stream is not called a sleep - the console was gone, not this page - and the "
      + "next gap is measured afresh",
      () => W7e.asleep().length === 0 && W7e.banners.length === 0,
      () => W7e.asleep().length + " record(s), " + W7e.banners.length + " banner(s)");

// 8. wiring: what the guard and the governor do about it, and the way out
check("8. the guard and the speed governor ACT only in the supervising tab - they still assess, draw and alarm, which "
      + "is what a second screen is for",
      () => /const act = !!\(S && S\.armed && !S\.estop\) && supervising\(\);/.test(H)
            && /const act = !!\(S && S\.run === "running"[^;]*\) && supervising\(\);/.test(H)
            && H.indexOf("renderGuardBar(a, c);") < H.indexOf("if(!act) return c;"),
      "the bar is drawn before the act gate, so a view-only tab shows the same ladder");
const conn = grab("connect");
check("8b. the page reports as it handles the STREAM - the console's idle tick included - and from no timer; it "
      + "forgets a gap when the stream breaks, names itself on every command, gives the post up on the way out (the "
      + "chart window only), and offers TAKE OVER",
      () => /es\.addEventListener\("tick", \(\)=>\{ supervisorStreamed\(\); supervisorReport\(\); \}\);/.test(conn)
            && /es\.onerror = \(\)=>\{[^}]*supervisorStreamLost\(\);/.test(conn)
            && !/setInterval\(supervisor/.test(H) && !/setTimeout\(supervisor/.test(H)
            && /"X-ASV-Client": CLIENT_ID/.test(H)
            && /addEventListener\("pagehide", \(\)=>\{\n\s*if\(!SUPERVISES\) return;[\s\S]{0,260}release: true/.test(H)
            && /\$\("#supPill"\)\.onclick/.test(H) && /supervisorBeat\(true\)/.test(H)
            // asked even in the simulator: the handover takes command away from a window somebody may be sitting at
            && /guiConfirm\("Supervise from this tab"[\s\S]{0,400}?\{always: true\}\)/.test(H),
      "one stream, one name, one release, one way to take over - and it asks first, sim or not");

// 8c. onFrame: every state frame is a pulse; only a frame the ladder RAN on is a report
const calls = [], flags = { throwIt: false };
// eslint-disable-next-line no-new-func
const onFrame = new Function("calls", "flags", [
  "\"use strict\";",
  "let S = {};",
  "const Date = { now: () => 5e8 };",
  "const console = { error(){} };",
  "const fetch = () => Promise.resolve({ ok: true });",
  "const consoleHealth = () => {}, buildCheck = () => {}, storageCheck = () => {};",
  "const supervisorStreamed = () => { calls.push('pulse'); };",
  "const supervisorReport = () => { calls.push('report'); };",
  "const onState = (m) => { calls.push('ladder'); if (flags.throwIt) throw new TypeError('guard fell over'); };",
  decl(/^const FRAME_FAULT_AFTER = [^;]*;/m),
  decl(/^let frameFaults = [^;]*;/m),
  grab("onFrame"),
  "return onFrame;",
].join("\n"))(calls, flags);
onFrame({ data: JSON.stringify({ type: "state" }) });
flags.throwIt = true;
onFrame({ data: JSON.stringify({ type: "state" }) });
flags.throwIt = false;
onFrame({ data: JSON.stringify({ type: "tick" }) });
onFrame({ data: "not a frame" });
check("8c. every state frame is a pulse, taken BEFORE the ladder runs; a report goes only after the ladder ran on the "
      + "frame - one whose ladder threw is no report - and what is not a state frame is neither",
      () => calls.join(",") === "pulse,ladder,report,pulse,ladder",
      () => calls.join(","));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
