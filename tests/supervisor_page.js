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
  // "#r_avoid" is the AVOIDING badge over the chart: this suite owns WHICH TAB speaks it (2026-11-03).
  const els = { "#supPill": el("supPill"), "#encbanner": el("encbanner"), "#note": el("note"),
                "#r_avoid": el("r_avoid") };
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
    // applySupervisor hands a change of supervision to the split windows (2026-10-10); their side is
    // tests/ui_split_peers.js, so here it is a stand-in.
    decl(/^let supWas = [^;]*;/m),
    "const uiSupervisionChanged = () => {};",
    decl(/^let supBeatMs = [^;]*;/m),
    decl(/^let supLastReport = [^;]*;/m),
    decl(/^const VIEW_ONLY_LIVE = [^;]*;/m),
    // the busy report before a route search, and the stamp its end leaves (2026-10-12)
    decl(/^const SUPERVISOR_BUSY_S = [^;]*;/m),
    decl(/^let supPlanEnd = [^;]*;/m),
    // the page remembers which inherited record it has already ADOPTED, so a handover's offer is taken
    // once rather than on every frame of the console's orphan window (2026-11-03, the fourth review)
    decl(/^let supAdopted = [^;]*;/m),
    "const AbortController = function(){ this.signal = {aborted: false}; this.abort = () => { this.signal.aborted = true; }; };",
    "const setTimeout = () => 0, clearTimeout = () => {};",
    // THE AVOIDING FLAG ACROSS TABS (2026-11-03). Only the supervising tab can RAISE it - it runs the ladder and
    // holds the route its rejoin index counts into - so the badge was DOM in that tab alone and every other
    // window showed nothing while the console had her off her planned track. The supervising tab publishes it on
    // the beat it already sends and a view-only one renders what the console serves: both of those decisions are
    // the page's own functions, LIFTED. `avoidingNow` is this world's stand-in, because what is asserted here is
    // WHICH TAB SPEAKS; the record's own raising and lowering is tests/ais_avoid.js's subject and is lifted there.
    "let avoiding = null;",
    "const avoidingNow = () => avoiding;",
    // ⚠ the RAISER is LIFTED, not mirrored (2026-11-03, the fourth review): the adoption now passes a FIFTH
    // argument - the console's clock, backdated from the served for_s - and a 4-arg stand-in swallowed it, so
    // 6g's duration assertion would have passed on nothing. A mirror that can drift is the harness defect that
    // reddened three checks in round three; logClient is the one thing the real raiser needs stubbed.
    "const logClient = () => {};",
    grab("avoidingRaise"),
    // the sentence that says when the flag comes down, declared by the page (so a rename cannot leave this
    // suite asserting its own copy) - and the CONTROLS window's own badge, which reads it (2026-11-03)
    decl(/^const AVOID_TIP = [\s\S]*?;$/m),
    grab("controlsAvoidShow"),
    ["supervising", "applySupervisor", "supervisorBeat", "supervisorBusy", "supervisorStreamed", "supervisorStreamLost",
     "supervisorReport", "supervisorSlept", "cmd", "cmdLabel", "canCommand", "applyViewOnly",
     "avoidingWire", "avoidingShown", "avoidingForS", "avoidingDur", "avoidingSay",
     "renderAvoiding"].map(grab).join("\n"),
    "return { CLIENT_ID, supervising, applySupervisor, cmd, canCommand, applyViewOnly, supervisorBusy,",
    "         controlsAvoidShow,",
    "         setAvoiding: (a) => { avoiding = a; }, getAvoiding: () => avoiding, renderAvoiding, avoidingWire,",
    "         planned: () => { supPlanEnd = Date.now(); },",
    // what onFrame does for a frame the ladder ran on, and what the console's idle tick does
    "         stream: () => { supervisorStreamed(); supervisorReport(); },",
    "         streamLost: supervisorStreamLost,",
    "         setS: (s) => { S = s; } };",
  ].join("\n");
  // eslint-disable-next-line no-new-func
  const madeIn = { _made: {} };
  const w = new Function("UIROLE", "els", "document", "fetch", "posts", "banners", "notes", "recorded", "Date",
                         "setInterval", "addEventListener", "navigator", "crypto", body)(
    role, els,
    // ⚠ WITH A MINIMAL ELEMENT REGISTRY (2026-11-03): the controls window's AVOIDING badge is built on the fly
    // with inline styles - deliberately, because that window's own stylesheet hides #map and #vcard outright -
    // so it goes through document.createElement / body.appendChild rather than the `$` stub above, and it has to
    // be FOUND again on the next poll or it would be rebuilt every second.
    { querySelectorAll: (sel) => (sel === ".cbtn" ? buttons : []),
      get visibilityState() { return visibility; },
      _made: {},
      getElementById(id) { return madeIn._made[id] || null; },
      createElement() { return { id: "", style: { cssText: "", display: "" }, title: "", textContent: "",
                                 setAttribute() {} }; },
      body: { appendChild(n) { madeIn._made[n.id] = n; } },
      get _reg() { return madeIn._made; } },
    (url, opt) => { posts.push({ url, opt }); return Promise.resolve({ ok: true, status: 200,
                                                                      json: async () => ({ ok: true }) }); },
    posts, banners, notes, recorded,
    { now: () => clock }, () => {}, () => {}, { sendBeacon: () => true }, { randomUUID: () => role + "-tab" });
  const bodyOf = (p) => { try { return JSON.parse(p.opt && p.opt.body); } catch (e) { return {}; } };
  return Object.assign(w, { els, buttons, posts, banners, notes, recorded, made: madeIn._made,
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
const pill5b = { display: W5.els["#supPill"].style.display, text: W5.els["#supPill"].textContent, tip: W5.els["#supPill"].title };
W5.applySupervisor({ holder: W5.CLIENT_ID, stale: false, tabs: 1 });
check("5. the top bar offers TAKE OVER while this tab is view-only, says it once rather than every frame, and the "
      + "offer goes away the moment this tab has the post - in its place, while ANOTHER chart tab is open, how many "
      + "are (2026-10-12: a second tab took his planning tab's post, and nothing in his tab said it was there), and "
      + "nothing once it is the only one",
      () => pill5.display === "" && /VIEW ONLY/.test(pill5.text) && /TAKE OVER/.test(pill5.text)
            && W5.banners.filter((b) => /VIEW ONLY/.test(b)).length === 1
            && pill5b.display === "" && pill5b.text === "⚠ 2 CHART TABS" && !/TAKE OVER/.test(pill5b.text)
            && /1 other chart tab is open/.test(pill5b.tip) && /Close the chart tabs you are not using/.test(pill5b.tip)
            && W5.els["#supPill"].style.display === "none",
      () => "pill '" + pill5.text + "'; banners " + W5.banners.length + "; holding with 2 tabs '" + pill5b.text
            + "'; alone " + W5.els["#supPill"].style.display);

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

// ── 6c-6f. THE AVOIDING FLAG IS THE SUPERVISING TAB'S, AND EVERY TAB SHOWS IT (2026-11-03) ───────────────────
// Andy, 2026-11-02: "Create a flag that attaches to the ASV an reads AVOIDING until it's back on line or natural
// transit". The flag can only be RAISED where the ladder runs, so review found it invisible in every other window:
// a second chart tab, the controls window and a supervisor watching the same console showed nothing at all while
// the console had her off her planned track. It now rides the heartbeat that is already there (avoidingWire) and
// a view-only page renders what the console serves (renderAvoiding) - so these four checks are about WHICH TAB
// SPEAKS, which is this suite's subject. The record's own raising and lowering is tests/ais_avoid.js's.
const WAV = makeWorld("main");
WAV.applySupervisor({ holder: WAV.CLIENT_ID, stale: false, tabs: 2 });
WAV.setAvoiding({ why: "routed round", kind: "a dock / pier", since: 123, rejoin: 7 });
WAV.advance(5000); WAV.stream();
const bAv = JSON.parse(WAV.reports().slice(-1)[0].opt.body);
WAV.setAvoiding(null);                       // she is back on her track: the next beat has to say so
WAV.advance(5000); WAV.stream();
const bClear = JSON.parse(WAV.reports().slice(-1)[0].opt.body);
check("6c. the SUPERVISING tab publishes its AVOIDING record on the beat it already sends - why and what, and "
      + "NOTHING ELSE: not the rejoin index, which means nothing in another page's array, and not `since`, "
      + "which is this page's clock and would be wrong on any other machine - and the beat that follows the "
      + "record coming down carries null, so 'she is back on her track' can reach the other tabs",
      () => bAv.avoiding && bAv.avoiding.why === "routed round" && bAv.avoiding.kind === "a dock / pier"
            // ⚠ `since` LEFT THE WIRE (2026-11-03, review): no page read it, and it is the raising page's
            // clock. The console stamps the record's arrival on its own and serves `for_s`, so an elapsed
            // time on a second machine is measured by ONE clock instead of the difference of two.
            && bAv.avoiding.since === undefined && bAv.avoiding.rejoin === undefined
            && Object.keys(bAv.avoiding).sort().join(",") === "kind,why"
            && "avoiding" in bClear && bClear.avoiding === null,
      () => "raised " + JSON.stringify(bAv.avoiding) + " (fields "
          + Object.keys(bAv.avoiding || {}).sort().join(",") + "); lowered " + JSON.stringify(bClear.avoiding));

const WAV2 = makeWorld("main");
WAV2.applySupervisor({ holder: "another-tab", stale: false, tabs: 2 });
WAV2.setAvoiding({ why: "steered clear", kind: "ITS OWN STALE RECORD", since: 1 });
WAV2.advance(5000); WAV2.stream();
const bView = JSON.parse(WAV2.reports().slice(-1)[0].opt.body);
// ⚠ 6d IS DEFENSE-IN-DEPTH NOW (2026-11-03, the fourth review): the transition clear in applySupervisor
// means a view-only page cannot HOLD a record of its own any more - the harness injects one with setAvoiding
// AFTER the view-only frame, a state the page can only reach through a late reply's write. What this check
// pins from here on is avoidingWire's OWN supervising() gate, the second lock on the same door.
check("6d. a VIEW-ONLY tab publishes nothing, even holding a record of its own from before it was taken over: it "
      + "cannot raise the flag and must not be able to lower the holder's",
      () => "avoiding" in bView && bView.avoiding === null,
      () => "sent " + JSON.stringify(bView.avoiding));

WAV2.setS({ armed: true, estop: false, run: "running", supervisor: { holder: "another-tab", stale: false, tabs: 2,
                          avoiding: { why: "deviated", kind: "a shoal", since: 2 } } });
WAV2.renderAvoiding();
const tagView = { text: WAV2.els["#r_avoid"].textContent, display: WAV2.els["#r_avoid"].style.display };
check("6e. ... and it RENDERS what the console serves instead, in the console's own words - the badge appears in a "
      + "window that is watching rather than commanding, which is the whole point of the fix",
      () => tagView.display === "block" && /AVOIDING/.test(tagView.text) && /DEVIATED ROUND/.test(tagView.text)
            && /a shoal/.test(tagView.text) && !/ITS OWN STALE RECORD/.test(tagView.text),
      () => "'" + tagView.text + "' display " + tagView.display);

const WAV3 = makeWorld("main");
WAV3.applySupervisor({ holder: WAV3.CLIENT_ID, stale: false, tabs: 1 });
WAV3.setAvoiding({ why: "steered clear", kind: "a rock", since: 3 });
WAV3.setS({ armed: true, estop: false, run: "running", supervisor: { holder: WAV3.CLIENT_ID, stale: false, tabs: 1,
                          avoiding: { why: "deviated", kind: "A BEAT OLD", since: 1 } } });
WAV3.renderAvoiding();
const tagHold = WAV3.els["#r_avoid"].textContent;
WAV3.setAvoiding(null); WAV3.renderAvoiding();
const tagDown = { text: WAV3.els["#r_avoid"].textContent, display: WAV3.els["#r_avoid"].style.display };
check("6f. the SUPERVISING tab shows its OWN record and not the served one, which is up to a beat old - and when its "
      + "record comes down the badge goes with it, rather than being held up by the console's copy of it",
      () => /STEERED CLEAR OF a rock/.test(tagHold) && !/A BEAT OLD/.test(tagHold)
            && tagDown.text === "" && tagDown.display === "none",
      () => "holding '" + tagHold + "'; after '" + tagDown.text + "' display " + tagDown.display);

// ── 6g. A HANDOVER DOES NOT END THE MANEUVER ─────────────────────────────────────────────────────────────────
// ⚠⚠ MEASURED BY THE THIRD REVIEW, BY TWO LENSES. The console used to drop the record the moment the post
// changed hands, on the argument that nobody was left who could lower it - so pressing TAKE OVER mid-way-round,
// or simply RELOADING the supervising tab, took the AVOIDING flag off every chart in the building while the
// console still had her off her planned track, with no path back: every raise sits inside its own command's
// reply handler, and the tab now in charge commanded nothing. His instruction was a flag that reads AVOIDING
// "until it's back on line or natural transit"; a handover is neither. The console keeps the record and marks
// it `inherited`, and the new holder adopts it as its own - with `rejoin` null, because the index belonged to
// the other page's route, so what ends it is the next commanded motion.
const WAV4 = makeWorld("main");
WAV4.applySupervisor({ holder: "the-old-tab", stale: false, tabs: 2 });     // this tab is view-only to begin with
const adoptedWhileView = WAV4.getAvoiding();
WAV4.applySupervisor({ holder: WAV4.CLIENT_ID, stale: false, tabs: 2,
                       avoiding: { why: "routed round", kind: "a dock / pier", for_s: 12.5, inherited: true,
                                   rejoin_ll: { lat: 43.07, lon: -70.75 } } });
const adopted = WAV4.getAvoiding();
WAV4.setS({ armed: true, estop: false, run: "running", supervisor: { holder: WAV4.CLIENT_ID, stale: false, tabs: 2,
                          avoiding: { why: "routed round", kind: "a dock / pier", for_s: 12.5, inherited: true,
                                      rejoin_ll: { lat: 43.07, lon: -70.75 } } } });
WAV4.renderAvoiding();
const tagAdopt = WAV4.els["#r_avoid"].textContent;
// and a record the console does NOT mark inherited is not adopted: that is the holder's own, already its own
const WAV5 = makeWorld("main");
WAV5.applySupervisor({ holder: WAV5.CLIENT_ID, stale: false, tabs: 1,
                       avoiding: { why: "deviated", kind: "a shoal", for_s: 3, inherited: false } });
check("6g. the tab that TAKES OVER mid-maneuver adopts the flag the console kept for it - so AVOIDING stays up in "
      + "the window now in charge, and is lowerable there - with no index (it counted into the other page's "
      + "route) but WITH the pick-up's POSITION from the wire, so avoidingNow lowers it like any raised record "
      + "(the fourth review), and WITH the console's clock: the badge reads the real elapsed time, not 0:00; "
      + "a record the console does not mark `inherited` is not adopted by anybody",
      () => adoptedWhileView === null
            && adopted && adopted.why === "routed round" && adopted.kind === "a dock / pier"
            && adopted.rejoin === null
            && adopted.rejoinWp && Math.abs(adopted.rejoinWp.lat - 43.07) < 1e-9
            && Math.abs(adopted.rejoinWp.lon + 70.75) < 1e-9
            && /AVOIDING/.test(tagAdopt) && /ROUTED ROUND a dock \/ pier/.test(tagAdopt)
            && /\u00b7 0:1[0-9]/.test(tagAdopt)
            && WAV5.getAvoiding() === null,
      () => "while view-only " + JSON.stringify(adoptedWhileView) + "; adopted " + JSON.stringify(adopted)
          + "; badge '" + tagAdopt + "'; not-inherited " + JSON.stringify(WAV5.getAvoiding()));

// ── 6j. THE RECORD GOES WITH THE POST, IN BOTH DIRECTIONS (2026-11-03, the fourth review's C3) ──────────────
// A tab that loses the post keeps nothing it can no longer lower: fourteen minutes later, with the plan's
// length moved on, taking the post back used to resurrect the stale record - preferred over the console's by
// the `!avoiding` gate, republished by the heartbeat, and unlowerable because adoptRunRoute will not re-adopt
// a route this page installed itself.
const WJ = makeWorld("main");
WJ.applySupervisor({ holder: WJ.CLIENT_ID, stale: false, tabs: 2 });
WJ.setAvoiding({ why: "deviated", kind: "a dock / pier", since: 123, rejoin: 12 });
WJ.applySupervisor({ holder: "chart-B", stale: false, tabs: 2 });
const lostPost = WJ.getAvoiding();
const lostWire = WJ.avoidingWire();
WJ.applySupervisor({ holder: WJ.CLIENT_ID, stale: false, tabs: 2,
                     avoiding: { why: "routed round", kind: "AIS: TUG SARAH B", for_s: 7, inherited: true } });
const retaken = WJ.getAvoiding();
check("6j. a tab that LOSES the post holds no record at all - and taking the post back adopts the CONSOLE's, "
      + "never its own fourteen-minute-old one: the record belongs to the tenure that raised it, dropped on "
      + "the EVENT and not on a frame's state word",
      () => lostPost === null && lostWire === null
            && retaken && retaken.why === "routed round" && retaken.kind === "AIS: TUG SARAH B",
      () => "after losing the post " + JSON.stringify(lostPost) + ", wired " + JSON.stringify(lostWire)
          + "; taken back " + JSON.stringify(retaken && retaken.kind));

// ── 6j2. AND A REFUSED ESCAPE WRITES NOTHING BACK INTO A PAGE NO LONGER IN CHARGE ───────────────────────────
// The escape's retraction fires on `r.refused` - and a 409 from a post that changed hands between the POST and
// the reply IS a refusal (supervisor_refusal), so that one line could restore a record AFTER the transition
// clear took it away. The statement is lifted BY TEXT: a retyped copy would pass on a page where the guard had
// been reverted, and this suite already carries one mirror too many.
{
  const esc = (H.match(/^\s*if\(r && r\.refused\)\{ guardHeld = heldEsc\.kept; avoiding = .*$/m) || [""])[0];
  check("6j2. the escape's refusal retraction restores the guard's record ALWAYS and the badge only while this "
        + "page still holds the post - a 409 from a lost post is a refusal too, and it must not resurrect a "
        + "record the transition clear just dropped",
        () => /guardHeld = heldEsc\.kept/.test(esc) && /supervising\(\) \? heldEsc\.avoid : null/.test(esc),
        () => "the page's own line: " + JSON.stringify(esc.trim().slice(0, 140)));
}

// ── 6j3. AND ADOPTING AN OFFER IS ONE ACT (the fourth review's C9, the page half) ───────────────────────────
// applySupervisor runs on every state frame and the console goes on offering the inherited record for a short
// window - so a Hold pressed just after a take-over had its own clear UNDONE on the next frame, re-raised into
// a record nothing could lower. The offer is remembered; the SAME offer is taken once; a LATER offer is new.
const WJ3 = makeWorld("main");
WJ3.applySupervisor({ holder: WJ3.CLIENT_ID, stale: false, tabs: 2,
                      avoiding: { why: "routed round", kind: "a dock / pier", for_s: 2, inherited: true } });
const j3adopted = WJ3.getAvoiding();
WJ3.setAvoiding(null);                                 // the operator pressed Hold: giveUpRoute cleared it
WJ3.applySupervisor({ holder: WJ3.CLIENT_ID, stale: false, tabs: 2,
                      avoiding: { why: "routed round", kind: "a dock / pier", for_s: 3, inherited: true } });
const j3after = WJ3.getAvoiding();
WJ3.applySupervisor({ holder: WJ3.CLIENT_ID, stale: false, tabs: 2, avoiding: null });
WJ3.applySupervisor({ holder: WJ3.CLIENT_ID, stale: false, tabs: 2,
                      avoiding: { why: "deviated", kind: "a shoal", for_s: 1, inherited: true } });
const j3fresh = WJ3.getAvoiding();
check("6j3. adopting an offer is ONE act: the operator's Hold inside the console's offer window STAYS DOWN - the "
      + "same record still marked inherited on the next frame is not re-adopted - while a LATER, different offer "
      + "(the console stopped offering, then a new handover) is adopted fresh",
      () => j3adopted && j3adopted.why === "routed round" && j3after === null
            && j3fresh && j3fresh.why === "deviated",
      () => "adopted " + JSON.stringify(j3adopted && j3adopted.why) + "; after the Hold "
          + JSON.stringify(j3after) + "; a later offer " + JSON.stringify(j3fresh && j3fresh.why));

// ── 6c2. THE WIRE CARRIES THE PICK-UP'S POSITION - AND NOTHING PAGE-LOCAL (the fourth review's R5) ──────────
const WC2 = makeWorld("main");
WC2.applySupervisor({ holder: WC2.CLIENT_ID, stale: false, tabs: 2 });
WC2.setAvoiding({ why: "routed round", kind: "a dock / pier", since: 123, rejoin: 7,
                  rejoinWp: { lat: 43.07, lon: -70.75, e: 5, n: 9, seg: 2 } });
WC2.advance(5000); WC2.stream();
const bWp = JSON.parse(WC2.reports().slice(-1)[0].opt.body);
check("6c2. a record with a pick-up puts rejoin_ll on the wire - lat and lon ONLY, never the waypoint object, "
      + "whose e/n/seg are one page's frame - and the keys are exactly kind, rejoin_ll, why",
      () => bWp.avoiding && Object.keys(bWp.avoiding).sort().join(",") === "kind,rejoin_ll,why"
            && Object.keys(bWp.avoiding.rejoin_ll).sort().join(",") === "lat,lon"
            && Math.abs(bWp.avoiding.rejoin_ll.lat - 43.07) < 1e-9,
      () => "wired " + JSON.stringify(bWp.avoiding));

// ── 6k. NOTHING AT ALL OVER A BOAT THAT IS STOPPED, E-STOPPED OR DISARMED - ON A VIEW-ONLY PAGE TOO ─────────
// AVOID_TIP and the ops manual promise it, avoidingNow enforces it for the holder, and the served record had
// no such gate: for up to a beat (and for as long as a holder's lowering was in flight) a view-only chart
// showed AVOIDING over a stopped boat (the fourth review's census - masked only by the WRITER applying the
// gate, which is this feature's recurring failure shape).
const WK = makeWorld("main");
WK.applySupervisor({ holder: "another-tab", stale: false, tabs: 2 });
WK.setS({ armed: true, estop: false, run: "stopped",
          supervisor: { holder: "another-tab", stale: false, tabs: 2,
                        avoiding: { why: "routed round", kind: "a tug", for_s: 42 } } });
WK.renderAvoiding();
const tagStopped = WK.els["#r_avoid"].style.display;
WK.setS({ armed: true, estop: false, run: "running",
          supervisor: { holder: "another-tab", stale: false, tabs: 2,
                        avoiding: { why: "routed round", kind: "a tug", for_s: 42 } } });
WK.renderAvoiding();
const tagRunning = WK.els["#r_avoid"].textContent;
check("6k. a view-only page shows NOTHING over a stopped boat even while the console still serves a record - "
      + "the same state gate the holder's reader applies, so AVOID_TIP's promise is true on every surface",
      () => tagStopped === "none" && /AVOIDING/.test(tagRunning),
      () => "stopped: display '" + tagStopped + "'; running: '" + tagRunning + "'");

// ── 6g2. THE RELOAD'S PAGE HALF: a FRESH page adopts on its FIRST snapshot (the fourth review's C4/C8/C11) ──
// 6g's page had been VIEW-ONLY first, so supHolder was already set when the inherited record arrived. A
// reloaded tab is nothing of the kind: supHolder is null, `avoiding` is null, and the record arrives on the
// reply to its very first beat - the exact scene the reload repair exists for, and no check covered it.
const WRL = makeWorld("main");
const firstWire = WRL.avoidingWire();
WRL.applySupervisor({ holder: WRL.CLIENT_ID, stale: false, tabs: 1,
                      avoiding: { why: "routed round", kind: "a dock / pier", for_s: 9.0, inherited: true } });
const reloadAdopted = WRL.getAvoiding();
WRL.setS({ armed: true, run: "running", estop: false,
           supervisor: { holder: WRL.CLIENT_ID, stale: false, tabs: 1,
                         avoiding: { why: "routed round", kind: "a dock / pier", for_s: 9.0, inherited: true } } });
WRL.renderAvoiding();
const reloadTag = WRL.els["#r_avoid"].textContent;
const reloadWire = WRL.avoidingWire();
check("6g2. a RELOADED supervising tab - no previous record, no view-only frame, supHolder null - adopts the "
      + "record the console kept across the release on the reply to its FIRST beat, paints the badge, and "
      + "re-publishes it as its own on the next beat",
      () => firstWire === null
            && reloadAdopted && reloadAdopted.why === "routed round" && reloadAdopted.rejoin === null
            && /AVOIDING/.test(reloadTag) && /ROUTED ROUND a dock \/ pier/.test(reloadTag)
            && reloadWire && reloadWire.why === "routed round" && reloadWire.kind === "a dock / pier",
      () => "first wire " + JSON.stringify(firstWire) + "; adopted " + JSON.stringify(reloadAdopted)
          + "; badge '" + reloadTag + "'; next wire " + JSON.stringify(reloadWire));

// ── 6h. AND THE OPERATOR IS TOLD HOW LONG, FROM ONE CLOCK ────────────────────────────────────────────────────
// `since` is the raising page's clock and no page ever read it; the console stamps the record's arrival on its
// own and serves `for_s`. A view-only page shows the console's number, the holder times its own record - so two
// machines watching one console agree, which they could not have done from `since` (2026-11-03, review).
const WAV6 = makeWorld("main");
WAV6.applySupervisor({ holder: "another-tab", stale: false, tabs: 2 });
WAV6.setS({ armed: true, estop: false, run: "running", supervisor: { holder: "another-tab", stale: false, tabs: 2,
                          avoiding: { why: "routed round", kind: "a tug", for_s: 42 } } });
WAV6.renderAvoiding();
const tagFor = WAV6.els["#r_avoid"].textContent;
WAV6.setS({ armed: true, estop: false, run: "running", supervisor: { holder: "another-tab", stale: false, tabs: 2,
                          avoiding: { why: "routed round", kind: "a tug", for_s: 2 } } });
WAV6.renderAvoiding();
const tagShort = WAV6.els["#r_avoid"].textContent;
check("6h. a view-only page shows how long the console has had her off her track, measured by the CONSOLE's clock "
      + "(`for_s`) and not by the raising page's `since` - and says nothing at all for the first few seconds, "
      + "where a counter would be noise",
      () => /ROUTED ROUND a tug · 0:42/.test(tagFor) && !/·/.test(tagShort),
      () => "at 42 s '" + tagFor + "'; at 2 s '" + tagShort + "'");

// ── 6i. AND THE CONTROLS WINDOW, WHICH THE DOCUMENTS HAD BEEN CLAIMING FOR A DAY ─────────────────────────────
// ⚠⚠ The ops manual, the technical manual and the commit message all said the badge appears in "a second chart
// tab, the controls window and another machine", and the controls window could not show it at all: it opens no
// EventSource, so renderAvoiding is never called there, and both surfaces the chart uses (#r_avoid inside #map,
// #v_mission inside #vcard) are hidden outright by that window's own stylesheet. A document asserting behavior
// the code cannot produce is this project's named defect, and that document was rewritten while fixing exactly
// that class of thing. It is drawn from the /api/state poll the window ALREADY makes once a second, as an
// element built on the fly with inline styles - which `display:none!important` rules cannot reach.
const WCTL = makeWorld("controls");
WCTL.controlsAvoidShow({ why: "routed round", kind: "a dock / pier", for_s: 75 });
const ctl1 = WCTL.made["ctlAvoid"];
const ctlText1 = ctl1 && ctl1.textContent, ctlStyle = ctl1 && ctl1.style.cssText, ctlTip = ctl1 && ctl1.title;
WCTL.controlsAvoidShow({ why: "routed round", kind: "a dock / pier", for_s: 80 });
const ctlSame = WCTL.made["ctlAvoid"] === ctl1;          // found again, not rebuilt every poll
WCTL.controlsAvoidShow(null);
const ctlDown = { text: WCTL.made["ctlAvoid"].textContent, display: WCTL.made["ctlAvoid"].style.display };
// the wiring: the window's own state poll is what draws it, and that poll is what this window already had
const chartRender = (H.match(/function chartWatchRender\(\)\{[\s\S]*?\n\}/) || [""])[0];
check("6i. the CONTROLS window shows the flag too, from the /api/state poll it already makes - in the console's "
      + "words and on the console's clock, as an element built with inline styles so that window's own "
      + "display:none rules cannot hide it, found again on the next poll rather than rebuilt, and taken down "
      + "when the console stops serving a record",
      () => !!ctl1 && /AVOIDING/.test(ctlText1) && /ROUTED ROUND a dock \/ pier/.test(ctlText1)
            && /1:15/.test(ctlText1)                                  // the CONSOLE's for_s, not a `since`
            && /position:fixed/.test(ctlStyle) && /z-index:1000/.test(ctlStyle)
            && !!ctlTip && /waypoint/.test(ctlTip)
            && ctlSame
            && ctlDown.text === "" && ctlDown.display === "none"
            && /controlsAvoidShow\(/.test(chartRender) && /chartWatch\.sup/.test(chartRender),
      () => "'" + ctlText1 + "'; rebuilt " + !ctlSame + "; down '" + ctlDown.text + "' display "
          + ctlDown.display + "; chartWatchRender draws it " + /controlsAvoidShow\(/.test(chartRender));

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
  "const aisPollTick = () => { flags.aisAsked = (flags.aisAsked || 0) + 1; };",   // 8d
  // 8e. THE CONSOLE'S OWN CONDITIONS, read off the frame it published: the supervision stand-down said on the
  // chart, and the route a page loaded mid-run does not hold. Stubs that only RECORD, because what this suite
  // owns about them is WHERE they are called, not what they do (tests/supervision_standdown.py owns the
  // stand-down itself; tests/governor_says.js owns the route the governor needs).
  "const supHeldSay = () => { calls.push('standdown'); };",
  "const adoptRunRoute = () => { calls.push('route'); };",
  "const renderAvoiding = () => { calls.push('avoiding'); };",
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
      () => calls.join(",") === "pulse,ladder,report,standdown,avoiding,route,pulse,ladder",
      () => calls.join(","));
// ⚠ 8e. AND THE CONSOLE'S OWN CONDITIONS ARE READ INSIDE THE TRY (2026-11-02, HONOLULU). The stand-down alert and
// the mid-run route fetch were first written into onState, where everything is gated on a RUNNING boat - and a
// stood-down boat is PAUSED, so the alert would have been raised by the frame that never came. Written next into
// onFrame's TAIL, where consoleHealth and the rest live; a throw there ESCAPES the frame handler, which
// tests/frame_health.js check 1 exists to forbid. They belong after the report and inside the try: a frame whose
// ladder threw runs neither of them and is counted as a CONSOLE FAULT, said out loud, which is review #12's rule.
check("8e. the stand-down alert, the AVOIDING flag and the mid-run route read all come AFTER the report and "
      + "INSIDE the try - a frame "
      + "whose ladder threw runs neither, and a throw in either is a counted fault rather than an escape",
      () => calls.join(",").indexOf("ladder,report,standdown,avoiding,route") >= 0
            && calls.join(",").lastIndexOf("standdown") < calls.join(",").lastIndexOf("pulse")
            && /supervisorReport\(\);[\s\S]{0,1200}?supHeldSay\(\);[\s\S]{0,220}?renderAvoiding\(\);[\s\S]{0,220}?adoptRunRoute\(\);/.test(H)
            && !/storageCheck\(\);\s*\n\s*supHeldSay\(\)/.test(H),
      () => calls.join(","));
// 8d. THE AIS POLL RIDES THE STREAM TOO (Andy, 2026-10-13: "AIS KEEP-OUTS BLIND" ... "Drove right through it"): a covered
// window's timers are throttled while its stream still arrives, so every state frame asks whether a poll is due - the
// one whose ladder threw as well, since the contacts must be fresh when the ladder runs again (tests/ais_avoid.js 12d-12f
// drive the poll itself). And the page's timer only asks the same question.
check("8d. every state frame asks for the AIS poll (aisPollTick) - the one whose ladder threw too - and what is not a "
      + "state frame does not; the page's timer asks the same question rather than polling outright",
      () => flags.aisAsked === 2 && /aisTimer = setInterval\(aisPollTick, AIS_TICK_MS\);/.test(H)
            && !/setInterval\(pollAIS\b/.test(H),
      () => "asked on " + (flags.aisAsked || 0) + " of 2 state frames; timer " + ((H.match(/aisTimer = setInterval\([^)]*\)/) || ["none"])[0]));

// ── 9. A TAB THAT IS PLANNING KEEPS ITS POST (2026-10-12) ─────────────────────────────────────────────────────
// Andy: "another browser tab is grabbing the process so cannot start a mission". His Go-To's route search held the
// supervising page 11 s and then 17.8 s; it could not report, the console handed the post to his other chart tab, and
// the Go-To was refused when it went. The page now says it is about to plan; the console's half is tests/supervisor.py 13.
const W9 = makeWorld("main");
W9.applySupervisor({ holder: W9.CLIENT_ID, stale: false, tabs: 2 });
W9.supervisorBusy();
const busyPost = W9.reports().map((p) => ({ body: JSON.parse(p.opt.body), signal: !!p.opt.signal }));
const W9v = makeWorld("main");
W9v.applySupervisor({ holder: "another-tab", stale: false, tabs: 2 });
W9v.supervisorBusy();
const W9c = makeWorld("controls");
W9c.supervisorBusy();
W9v.applySupervisor({ holder: "another-tab", stale: false, busy: true, tabs: 2 });
const busyPill = W9v.els["#supPill"].textContent;
check("9. ABOUT TO PLAN: the supervising chart tab tells the console - its id and busy_s " + "60 - with the wait bounded "
      + "(an abort signal), and a view-only tab or the controls window says nothing; a view-only tab whose supervisor "
      + "is planning says so on its pill",
      () => busyPost.length === 1 && busyPost[0].body.id === W9.CLIENT_ID && busyPost[0].body.busy_s === 60
            && busyPost[0].signal && W9v.reports().length === 0 && W9c.reports().length === 0
            && busyPill === "👁 VIEW ONLY · the other tab is planning",
      () => JSON.stringify(busyPost) + "; view-only " + W9v.reports().length + ", controls " + W9c.reports().length
            + "; pill '" + busyPill + "'");
// 9b. a gap that ends as a plan ends is the plan, not sleep - no ASLEEP banner; recorded as planning
const W9b = makeWorld("main");
W9b.applySupervisor({ holder: W9b.CLIENT_ID, stale: false, tabs: 1 });
W9b.show("hidden");
W9b.stream();
W9b.advance(18000);
W9b.planned();
W9b.stream();
const planGap = W9b.asleep();
const W9s = makeWorld("main");
W9s.applySupervisor({ holder: W9s.CLIENT_ID, stale: false, tabs: 1 });
W9s.show("hidden");
W9s.stream();
W9s.advance(18000);
W9s.stream();
check("9b. A GAP THAT ENDS AS A ROUTE SEARCH ENDS is the search, not sleep: no 'THIS TAB WAS ASLEEP' (said of his Go-To "
      + "at 18:49:59), recorded as planning - while the same gap with no search behind it is still called a sleep",
      () => !W9b.banners.some((b) => /ASLEEP/.test(b)) && planGap.length === 1 && planGap[0].data.planning === true
            && W9s.banners.some((b) => /THIS TAB WAS ASLEEP for 18 s/.test(b)),
      () => JSON.stringify(planGap) + "; without a plan: " + (W9s.banners.find((b) => /ASLEEP/.test(b)) || "no banner").slice(0, 40));
// 9c. THE WIRING (2026-10-12, the route worker): a route search now runs in the route worker and holds nothing here, so
// the busy report rides the search that DOES hold this thread - planHere, the worker's fallback (tests/route_worker.js 9)
// - before it, with the stamp after it, a search that throws included; and planInsideChart no longer reports for one.
(async () => {
  const order = [];
  // eslint-disable-next-line no-new-func
  const PH = new Function("order", "Date", "let supPlanEnd = 0; const supervisorBusy = async () => { order.push('busy'); };\n"
    + grab("planHere") + "\nreturn { planHere, end: () => supPlanEnd };")(order, { now: () => 4242 });
  const got = await PH.planHere(() => { order.push("search"); return "planned"; });
  const end1 = PH.end();
  let threw = false;
  // eslint-disable-next-line no-new-func
  const PH2 = new Function("order", "Date", "let supPlanEnd = 0; const supervisorBusy = async () => { order.push('busy2'); };\n"
    + grab("planHere") + "\nreturn { planHere, end: () => supPlanEnd };")(order, { now: () => 4343 });
  try { await PH2.planHere(() => { order.push("throws"); throw new Error("x"); }); } catch (e) { threw = true; }
  const pic = grab("planInsideChart");
  check("9c. THE WIRING: a route search on this page's thread (planHere - the route worker's fallback) is preceded by the "
        + "busy report and followed by the stamp, a search that throws too; and planInsideChart reports for none, its "
        + "searches being the caller's (the route worker, tests/route_worker.js)",
        () => got === "planned" && order.join(",") === "busy,search,busy2,throws" && end1 === 4242 && threw && PH2.end() === 4343
              && !/supervisorBusy/.test(pic) && (pic.match(/await plan\(\)/g) || []).length === 2,
        () => "order " + order.join(",") + "; stamps " + end1 + "/" + PH2.end() + "; threw " + threw);

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
