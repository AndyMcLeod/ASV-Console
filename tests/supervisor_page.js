// tests/supervisor_page.js - the page half of "all supervision lives in one browser tab" (review #14, 2026-09-15).
//
// The console grants supervision to one tab (tests/supervisor.py). THIS is what the other tabs do about it: they
// show everything and command nothing, they say so rather than failing quietly, and the controls that STOP the boat
// stay live in every one of them. And a tab that was asleep says so, because a supervising tab that stopped running
// is the failure the operator cannot see from the screen.
// DRIVEN: the page's own supervising / applySupervisor / supervisorTick / cmd / canCommand / applyViewOnly, with the
// DOM, fetch and the clock stubbed.
//
//   node tests/supervisor_page.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 10 sidecar mutations RUN, 10/10 caught:
//   a view-only tab commands anyway -> 2                 the stop class is gated too -> 3
//   the command bar stays live in a view-only tab -> 4   the stop buttons are disabled with the rest -> 4
//   canCommand ignores which tab is in charge -> 4b      nobody supervising reads as somebody else -> 6
//   the view-only banner is re-posted every frame -> 5   a tab that was asleep says nothing -> 7
//   the guard acts in every tab (the old code) -> 8      the speed governor acts in every tab (the old code) -> 8
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
function makeWorld() {
  const el = (id) => ({ id, style: {}, textContent: "", title: "", disabled: false, onclick: null,
                        classList: { toggle(){}, add(){}, remove(){} } });
  const buttons = ["b_arm", "b_upload", "b_start", "b_pause", "b_stop", "b_hold", "b_rth", "b_estop", "b_reset"]
    .map((id) => Object.assign(el(id), { className: "cbtn" }));
  const els = { "#supPill": el("supPill"), "#encbanner": el("encbanner"), "#note": el("note") };
  const posts = [], banners = [], notes = [], recorded = [];
  let clock = 1000000;
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
    decl(/^let supHolder = [^;]*;/m),
    decl(/^const VIEW_ONLY_LIVE = [^;]*;/m),
    ["supervising", "applySupervisor", "supervisorBeat", "supervisorTick", "cmd", "cmdLabel",
     "canCommand", "applyViewOnly"].map(grab).join("\n"),
    "return { CLIENT_ID, supervising, applySupervisor, supervisorTick, cmd, canCommand, applyViewOnly,",
    "         setS: (s) => { S = s; }, tick: (ms) => { clock += ms; } };",
  ].join("\n");
  // eslint-disable-next-line no-new-func
  const w = new Function("els", "document", "fetch", "posts", "banners", "notes", "recorded", "Date", "setInterval",
                         "addEventListener", "navigator", "crypto", body)(
    els,
    { querySelectorAll: (sel) => (sel === ".cbtn" ? buttons : []) },
    (url, opt) => { posts.push({ url, opt }); return Promise.resolve({ ok: true, status: 200,
                                                                      json: async () => ({ ok: true }) }); },
    posts, banners, notes, recorded,
    { now: () => clock }, () => {}, () => {}, { sendBeacon: () => true }, { randomUUID: () => "this-tab" });
  return Object.assign(w, { els, buttons, posts, banners, notes, recorded,
                            advance: (ms) => { clock += ms; } });
}

// 1-2. a tab that has the post commands; one that does not is refused HERE, in words
const W = makeWorld();
W.applySupervisor({ holder: W.CLIENT_ID, stale: false, tabs: 1 });
const okCmd = W.cmd("/api/cmd/goto", { lat: 1, lon: 2 });
check("1. the supervising tab commands as it always did",
      () => W.posts.some((p) => p.url === "/api/cmd/goto"),
      () => W.posts.map((p) => p.url).join(", ") || "nothing sent");

W.applySupervisor({ holder: "another-tab", stale: false, tabs: 2 });
const before = W.posts.length;
const refused = W.cmd("/api/cmd/goto", { lat: 1, lon: 2 });
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
const W5 = makeWorld();
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
const W6 = makeWorld();
W6.applySupervisor({ holder: null, stale: false, tabs: 0 });
check("6. with NOBODY holding the post this tab is not held back - a console that has not been told yet, or one from "
      + "before any of this existed, still takes commands",
      () => W6.supervising() === true && W6.els["#supPill"].style.display === "none",
      () => "supervising=" + W6.supervising());

// 7. a tab that was asleep says so
const W7 = makeWorld();
W7.applySupervisor({ holder: W7.CLIENT_ID, stale: false, tabs: 1 });
W7.supervisorTick();                                  // the first beat: nothing to compare against
W7.advance(2000); W7.supervisorTick();                // a normal beat
const quietBanners = W7.banners.length;
W7.advance(45000); W7.supervisorTick();               // the browser slept this tab for 45 s
const slept = W7.banners.filter((b) => /STOPPED RUNNING/.test(b));
const throttlePost = W7.posts.filter((p) => p.url === "/api/logevent"
  && /page_throttled/.test(String(p.opt && p.opt.body)));
check("7. a tab that stopped running says so when it comes back - with how long it was gone - and writes it to the "
      + "session record, because a supervising tab that was asleep is the failure nobody can see afterwards",
      () => quietBanners === 0 && slept.length === 1 && /45 s/.test(slept[0]) && throttlePost.length === 1
            && /"supervising":true/.test(String(throttlePost[0].opt.body)),
      () => (slept[0] || "(nothing said)").slice(0, 90));
check("7b. ... and a beat goes out on every tick, asleep or not, so the console can see the tab is back",
      () => W7.posts.filter((p) => p.url === "/api/supervisor").length === 3,
      () => W7.posts.filter((p) => p.url === "/api/supervisor").length + " beats sent");

// 8. wiring: what the guard and the governor do about it, and the way out
check("8. the guard and the speed governor ACT only in the supervising tab - they still assess, draw and alarm, which "
      + "is what a second screen is for",
      () => /const act = !!\(S && S\.armed && !S\.estop\) && supervising\(\);/.test(H)
            && /const act = !!\(S && S\.run === "running"[^;]*\) && supervising\(\);/.test(H)
            && H.indexOf("renderGuardBar(a, c);") < H.indexOf("if(!act) return c;"),
      "the bar is drawn before the act gate, so a view-only tab shows the same ladder");
check("8b. the page reports in on a timer, tells the console which tab it is on every command, gives the post up on "
      + "the way out, and offers TAKE OVER",
      () => /setInterval\(supervisorTick, SUPERVISOR_BEAT_MS\)/.test(H)
            && /"X-ASV-Client": CLIENT_ID/.test(H)
            && /addEventListener\("pagehide"[\s\S]{0,260}release: true/.test(H)
            && /\$\("#supPill"\)\.onclick/.test(H) && /supervisorBeat\(true\)/.test(H)
            // asked even in the simulator: the handover takes command away from a window somebody may be sitting at
            && /guiConfirm\("Supervise from this tab"[\s\S]{0,400}?\{always: true\}\)/.test(H),
      "one beat, one name, one release, one way to take over - and it asks first, sim or not");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
