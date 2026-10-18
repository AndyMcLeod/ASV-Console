// tests/ui_split_peers.js - the two-window split when there are MORE than two pages (2026-10-10).
//
// Andy: "behavior is buggy. When closing the control browser all the cards failed to come over to chart window. The
// Alert card is flashing with continuous updates."
//
// The chart window and the controls window talk over one BroadcastChannel, and it reaches EVERY page of the console,
// not one pair. Every start of the console opens a chart and a controls window, and pages left open from before
// reconnect on their own - his session had two chart pages reporting in. With no idea who was on the other end:
//   * both charts mirrored into the controls window, four times a second each (the page rewrites many readouts every
//     frame whether or not they changed), and it swapped between their two alert cards - the same banners at
//     different times: the flashing, reproduced live (29 rebuilds of the card in 5 s);
//   * every click on the controls window ran in BOTH charts;
//   * and a second controls window left open answers for the one closed, so the chart keeps its cards hidden -
//     reproduced live, and the likely reason his did not come back.
// The fix, each rule a check here:
//   * ONLY THE SUPERVISING CHART drives the controls window: it alone mirrors into it, carries out what it sends, and
//     hides its own cards; a view-only chart keeps its own (3), and the controls window follows supervision (4);
//   * the SAME PICTURE IS NOT SENT AGAIN - a forced send for a page that has just said hello (2);
//   * each controls page says which it is and when it was opened, the chart keeps a table of the ones alive, and of
//     two controls windows the NEWER steps aside - silent at once, then closed (5, 7).
// And (2026-10-18, Andy: "Stop moving cards to chart automatically unless the browser window closes. allow button to
// swap back and forth."):
//   * a controls window is gone when it CLOSES: it holds a Web Lock for its life and the chart waits on it, so the cards
//     come back the moment it closes, the chart hidden or not (6), never while it is open but asleep (8), and a word
//     still on its way from a closed one brings nothing back (8b); a page that holds no lock (one loaded before, or a
//     browser without Web Locks) still goes by its silence, 6-7 s after its last word (6b);
//   * the chart's swap pill and the controls window's own buttons move the cards between the two while both are open;
//     only the supervising chart heeds them; a controls window coming after none takes the cards again (9, 9b).
//
// The pages here are the page's OWN functions - setupUISplit, pushUISync, applyUISync, the peer table, the split rule,
// the supervision hook - each evaluated in its own world, connected by a fake channel that delivers to every other
// page, on a fake clock, sharing one fake Web Locks manager.
//
//   node tests/ui_split_peers.js      # exit 0 = pass, 1 = fail   (stdlib Node)

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
// ASV_HTML points this at a SIDECAR copy for a mutation run, never the real page.
const H = fs.readFileSync(process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}

let fails = 0;
function check(name, cond, detail) {
  let ok = false, err = "";
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : "") + err);
  if (!ok) fails++;
}

// ---- one clock, one channel ----------------------------------------------------------------------------------- //
const clock = { t: 1000000 };
const timers = [];                     // {page, at, every, fn}
const pages = [];
// a page ASLEEP (the browser froze it - open, but it runs nothing and answers nothing) hears nothing and fires no timer
function deliver(from, m) {
  for (const p of pages) {
    if (p === from || p.closed || p.asleep || !p.bus.onmessage) continue;
    p.got.push(m.t);
    p.bus.onmessage({ data: JSON.parse(JSON.stringify(m)) });
  }
}
const flush = () => new Promise(r => setImmediate(r));      // a freed lock's grant runs as a promise settles
async function advance(ms) {
  const end = clock.t + ms;
  await flush();
  for (;;) {
    const due = timers.filter(x => !x.page.closed && !x.page.asleep && x.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    clock.t = Math.max(clock.t, due.at);
    if (due.every) due.at += due.every; else timers.splice(timers.indexOf(due), 1);
    due.fn();
    await flush();
  }
  clock.t = end;
}

// ---- the browser's Web Locks: ONE manager for every page (a lock belongs to the origin, not to a page) ----------- //
// Granted in the order asked, one holder per name, and LATER - never inside the request, as the browser grants it; held
// while the callback's promise is unsettled; and every lock a page holds is freed when the page closes (lockFreeAll) -
// what the browser does for a page closed, reloaded or crashed.
const locks = { held: new Map(), queue: [] };              // name -> holding page; [{page, name, cb, done}]
function lockPump() {
  locks.queue = locks.queue.filter(q => !q.page.closed);
  const i = locks.queue.findIndex(q => !locks.held.has(q.name));
  if (i < 0) return;
  const q = locks.queue.splice(i, 1)[0];
  locks.held.set(q.name, q.page);
  const release = () => { if (locks.held.get(q.name) === q.page) locks.held.delete(q.name); q.done(); lockPump(); };
  const r = q.cb();
  if (r && typeof r.then === "function") r.then(release, release); else release();
  lockPump();
}
function lockFreeAll(page) { for (const [n, p] of [...locks.held]) if (p === page) locks.held.delete(n); setImmediate(lockPump); }
const lockApi = page => ({ request: (name, cb) => new Promise(done => { locks.queue.push({ page, name, cb, done }); setImmediate(lockPump); }) });

const SRC = [grabDecl("UI_BRIDGED"), grabDecl("UI_PEER_GONE_MS"), grabDecl("UI_LOCK"), grab("uiCardsTo"),
             grab("setupUISplit"), grab("pushUISync"), grab("applyUISync"),
             grabDecl("uiMirrored"), grab("uiSameNode"), grab("uiMorph"),      // the mirror's patch (ui_tooltips 17-18)
             grab("uiPeersPrune"), grab("uiSplitApply"), grab("uiSupervisionChanged"), grab("uiOlder"), grab("uiYield"),
             grab("supervising"), grab("applySupervisor"),
             // the chart says whether it can be seen, and the controls window keeps its word (2026-10-17; status_bar 6-6c
             // hold the watch - nothing asks the console here, so it says nothing)
             grabDecl("SUPERVISOR_BEAT_MS"), grabDecl("CHART_WATCH_MS"), grabDecl("chartWatch"), grabDecl("CHART_COVERED_SAY"), grabDecl("CHART_SLEEP_SAY"),
             grab("chartStoppedSay"), grab("chartNoneSay"), grab("chartWatchVerdict"), grab("chartWatchVis"),
             grab("chartWatchRender"), grab("chartWarnShow")].join("\n");
// the page's own state, as the page declares it
const STATE = ["uiPeers", "uiWatched", "uiClosed", "uiYielded", "uiLockFree", "uiCardsHome"].map(grabDecl).join("\n");

// A page: the console's own split-window code in a world of its own.
function makePage(role, id, born, opts) {
  const closeBlocked = !!(opts && opts.closeBlocked);    // a browser that will not let a page close a window it did not open
  const noLocks = !!(opts && opts.noLocks);              // a page with no Web Locks: one loaded before them, or a browser without
  const p = { role, id, closed: false, got: [], sent: [], clicks: [], renders: 0, listeners: {}, mo: null, dom: {}, hidden: false,
              made: {}, swapPill: { textContent: "", title: "", onclick: null } };
  p.bus = { onmessage: null, postMessage: m => { if (p.closed) return; p.sent.push(m); p.lastSentAt = clock.t; deliver(p, m); } };
  const classes = new Set();
  const el = s => ({
    id: s.replace(/^[#.]/, ""), tagName: "DIV", classList: { contains: () => false },
    get outerHTML() { return p.dom[s] || "<div>" + s + "</div>"; },
    set outerHTML(v) { p.dom[s] = v; p.rebuilt = (p.rebuilt || 0) + 1; },
    querySelectorAll: () => [], contains: () => false,
  });
  const made = e => { if (e.id) p.made[e.id] = e; (e.kids || []).forEach(made); };    // what the page put on its body
  const world = {
    UIROLE: role, CLIENT_ID: id, born,
    uiBus: p.bus,
    navigator: noLocks ? {} : { locks: lockApi(p) },
    document: {
      body: { classList: { contains: c => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
                           add: c => classes.add(c), remove: c => classes.delete(c) }, set innerHTML(v) { p.notice = v; },
              appendChild: e => made(e) },
      get hidden() { return p.hidden; }, activeElement: null,
      querySelector: s => el(s),
      getElementById: i => ({ id: i, type: "button", style: {}, click: () => p.clicks.push(i), dispatchEvent: () => {} }),
      addEventListener: () => {},
      createElement: tag => ({ tagName: tag.toUpperCase(), id: "", className: "", textContent: "", title: "", style: {},
                               onclick: null, kids: [], appendChild(c) { this.kids.push(c); } }),
    },
    window: { addEventListener: (ev, fn) => { p.listeners[ev] = fn; },
              close: () => { if (closeBlocked) return; p.closed = true; p.closedBy = "window.close"; lockFreeAll(p); } },
    setInterval: (fn, ms) => timers.push({ page: p, at: clock.t + ms, every: ms, fn }),
    setTimeout: (fn, ms) => timers.push({ page: p, at: clock.t + ms, every: 0, fn }),
    MutationObserver: class { constructor(cb) { p.mo = cb; } observe() {} },
    Date: { now: () => clock.t },
    render: () => { p.renders++; }, $: s => (s === "#cardsSwap" ? p.swapPill : null), showBanner: () => {},
    applyAlertWhere: () => {}, alertCardTidy: () => {}, wrapUICards: () => {}, saveUILayout: () => {}, uiSaveSoon: () => {},
    syncUICards: () => {}, Event: class { constructor(t) { this.type = t; } },
  };
  const names = Object.keys(world);
  // eslint-disable-next-line no-new-func
  const f = new Function(...names,
    "const UI_BORN = born;\n" + STATE + "\n" +
    "let tipEl = null; const tipSay = () => {};\n" +     // nothing hovered here: the tip's half is ui_tooltips 13-18
    "const SUPERVISES = UIROLE === \"main\"; let supHolder = null, supStale = false, supSaidViewOnly = false, supWas = true;\n" +
    "let supBeatMs = 2000, supStaleMs = 10000;\n" + grabDecl("uiSyncLast") + "\n" + SRC + "\n" +
    "return { setupUISplit, pushUISync, applySupervisor, peers: () => [...uiPeers.keys()], yielded: () => uiYielded, " +
    "home: () => uiCardsHome };");
  p.api = f(...names.map(k => world[k]));
  p.split = () => classes.has("ui-split");
  p.peerOn = () => classes.has("ui-peer");
  p.away = () => classes.has("ui-away");
  pages.push(p);
  p.api.setupUISplit();
  return p;
}
const syncsFrom = p => p.sent.filter(m => m.t === "sync").length;
function mutate(p, html) { if (html != null) p.dom["#alertCard"] = html; p.mo([]); }   // the chart's observer fires
// a window closed with no word - what a real close was measured to send - and every lock it held freed by the browser
function close(p) { p.closed = true; lockFreeAll(p); }

(async () => {
console.log("The split windows, with more than two pages:");

// 1. ONE CHART, ONE CONTROLS WINDOW - the ordinary case stays what it was.
const A = makePage("main", "chart-A", 1000);
const C1 = makePage("controls", "ctl-1", 2000);
await advance(3500);
check("1. one chart and one controls window: the chart hides its cards (split) once the controls window says hello, "
      + "and gives it a picture at once",
      () => A.split() && A.api.peers().join() === "ctl-1" && syncsFrom(A) >= 1 && C1.got.includes("sync"),
      () => "split " + A.split() + ", peers " + A.api.peers() + ", syncs " + syncsFrom(A));

// 2. THE SAME PICTURE IS NOT SENT AGAIN.
let s0 = syncsFrom(A);
for (let i = 0; i < 10; i++) { mutate(A); await advance(250); }
const idle = syncsFrom(A) - s0;
mutate(A, "<div id='alertCard'>NEW</div>"); await advance(250);
check("2. ten frames that rewrite the same readouts send NOTHING; one that changes the picture sends ONE sync",
      () => idle === 0 && syncsFrom(A) - s0 === 1 && C1.dom["#alertCard"] === "<div id='alertCard'>NEW</div>",
      () => "idle frames sent " + idle + ", after a change " + (syncsFrom(A) - s0));

// 3. TWO CHARTS: only the supervising one drives the controls window.
const B = makePage("main", "chart-B", 3000);
A.api.applySupervisor({ holder: "chart-A" }); B.api.applySupervisor({ holder: "chart-A" });
await advance(3000);
s0 = syncsFrom(B);
for (let i = 0; i < 8; i++) { mutate(B, "<div id='alertCard'>B " + i + "</div>"); await advance(250); }
mutate(A, "<div id='alertCard'>A</div>"); await advance(250);
C1.bus.postMessage({ t: "ev", kind: "click", id: "pp_draw" });
check("3. two charts: the SUPERVISING one alone hides its cards, mirrors into the controls window and carries out its "
      + "clicks; the view-only one keeps its own cards, sends nothing however its picture changes, and runs no click",
      () => A.split() && !B.split() && syncsFrom(B) - s0 === 0 && C1.dom["#alertCard"] === "<div id='alertCard'>A</div>"
            && A.clicks.join() === "pp_draw" && B.clicks.length === 0,
      () => "split A " + A.split() + " B " + B.split() + "; syncs from B " + (syncsFrom(B) - s0) + "; clicks A "
            + A.clicks + " B " + B.clicks + "; controls shows " + C1.dom["#alertCard"]);

// 4. SUPERVISION MOVES, AND THE CONTROLS WINDOW WITH IT.
const bSyncs = syncsFrom(B);
A.api.applySupervisor({ holder: "chart-B" }); B.api.applySupervisor({ holder: "chart-B" });
await advance(250);
check("4. TAKE OVER in the other chart: it hides its cards and sends its picture at once (B's 'B 7'), and the chart "
      + "that lost supervision shows its own again",
      () => B.split() && !A.split() && syncsFrom(B) === bSyncs + 1 && C1.dom["#alertCard"] === "<div id='alertCard'>B 7</div>",
      () => "split A " + A.split() + " B " + B.split() + "; controls shows " + C1.dom["#alertCard"]);

// 5. A SECOND CONTROLS WINDOW: the newer steps aside.
const C2 = makePage("controls", "ctl-2", 5000);
await advance(2500);
const c2after = C2.sent.length;
await advance(6000);
check("5. a second controls window, opened after the first, hears it and STEPS ASIDE: it closes itself and says "
      + "nothing more - no ping, no hello, no bye; the first one never yields to it",
      () => C2.api.yielded() && C2.closedBy === "window.close" && C2.sent.length === c2after && !C1.api.yielded() && !C1.closed,
      () => "C2 yielded " + C2.api.yielded() + " (" + C2.closedBy + "), C2 sent after " + (C2.sent.length - c2after)
            + "; C1 yielded " + C1.api.yielded());
check("5b. ... and the chart, which heard the newcomer's hello, lets it go - its lock freed as it stepped aside - and "
      + "stays split on the first",
      () => B.api.peers().join() === "ctl-1" && B.split(), () => "peers " + B.api.peers() + ", split " + B.split());

const C4 = makePage("controls", "ctl-x", 6000, { closeBlocked: true });
await advance(2500);
const c4after = C4.sent.length;
await advance(7000);
check("5c. ... and where the browser will not let it close: it STAYS open but silent - nothing sent from the moment it "
      + "stepped aside - says why it is blank, frees its lock, and the chart lets it go and stays split on the first",
      () => C4.api.yielded() && !C4.closed && C4.sent.length === c4after && /ANOTHER CONTROLS WINDOW IS ALREADY OPEN/.test(C4.notice || "")
            && B.api.peers().join() === "ctl-1" && B.split() && !locks.held.has("asv_ui_controls_ctl-x"),
      () => "yielded " + C4.api.yielded() + ", open " + !C4.closed + ", sent after " + (C4.sent.length - c4after)
            + ", notice " + !!C4.notice + "; chart peers " + B.api.peers());

// 6. CLOSING THE CONTROLS WINDOW gives the cards back the moment its lock is freed - the chart hidden or not.
B.hidden = true;
close(C1);
await advance(10);
const hiddenBack = { split: B.split(), peers: B.api.peers().length };
B.hidden = false;
check("6. the controls window closed with no word (as a real close was measured to send none): the browser frees its "
      + "lock and the cards come back at once - no wait on its silence - even to a chart that is hidden",
      () => !hiddenBack.split && hiddenBack.peers === 0, () => JSON.stringify(hiddenBack));
const C3 = makePage("controls", "ctl-3", 9000, { noLocks: true });
await advance(1000);
const split3 = B.split();
close(C3);
let back3 = null;
// read every 10 ms: the time is the end of the step it changed in, so up to one step late
for (let i = 0; i < 1000 && back3 == null; i++) { await advance(10); if (!B.split()) back3 = clock.t - C3.lastSentAt; }
check("6b. a controls page that holds NO lock (loaded before them, or a browser without): a visible chart gives the cards "
      + "back more than 6 s and within 7 s of its last word (read to 10 ms) - never sooner, which is what rides out the "
      + "page's measured stalls; asked every second",
      () => split3 && back3 != null && back3 > 6000 && back3 <= 7010, () => "back " + back3 + " ms after its last word");

// 7. A BYE drops the page that said it, and only that page; a page with no id is tracked as one.
const D1 = makePage("controls", "ctl-4", 20000);
await advance(500);
B.bus.onmessage({ data: { t: "ping" } });                               // a page loaded before ids: tracked as "anon"
D1.listeners.beforeunload(); close(D1);
const afterBye = { split: B.split(), peers: B.api.peers().join() };
check("7. a controls window's bye drops IT, not every controls page: an older page that names no id still holds the "
      + "split, tracked as one anonymous page",
      () => afterBye.split && afterBye.peers === "anon", () => JSON.stringify(afterBye));

// ---- 2026-10-18: closed, not quiet; and the swap -------------------------------------------------------------- //
close(A); close(B);                                         // a fresh pair: one chart, no supervisor named (it supervises)
const E = makePage("main", "chart-E", 30000);
const C5 = makePage("controls", "ctl-5", 31000);
await advance(3500);
const before8 = E.split();
C5.asleep = true;                                           // the browser freezes it: open, silent, answering nothing
await advance(60000);
const asleep8 = { split: E.split(), peers: E.api.peers().join(), sent: C5.sent.length };
C5.asleep = false; close(C5);
await advance(10);
check("8. A CONTROLS WINDOW ASLEEP IS NOT CLOSED: frozen by the browser for a minute - not a word from it - the chart "
      + "keeps its cards there; closed, they come back at once",
      () => before8 && asleep8.split && asleep8.peers === "ctl-5" && !E.split() && E.api.peers().length === 0,
      () => "before " + before8 + "; asleep 60 s: " + JSON.stringify(asleep8) + "; closed: split " + E.split());
E.bus.onmessage({ data: { t: "ping", from: "ctl-5", born: 31000, lock: true } });   // still on its way as it closed
const late = { split: E.split(), peers: E.api.peers().join() };
check("8b. ... and a word from it still on its way when it closed brings nothing back",
      () => !late.split && late.peers === "", () => JSON.stringify(late));

const C6 = makePage("controls", "ctl-6", 40000);
await advance(3500);
const pill0 = { split: E.split(), peer: E.peerOn(), label: E.swapPill.textContent, btn: (C6.made.cardsSwapCtl || {}).textContent };
C6.made.cardsSwapCtl.onclick();                             // the controls window's own button: the cards to the chart
await advance(250);
const toChart = { split: E.split(), peer: E.peerOn(), home: E.api.home(), away: C6.away(), label: E.swapPill.textContent };
C6.made.cardsHere.onclick();                                // ... and back, from the note it shows while they are away
await advance(250);
const toCtl = { split: E.split(), home: E.api.home(), away: C6.away(), label: E.swapPill.textContent };
E.swapPill.onclick();                                       // the chart's pill: here
await advance(250);
const pillHere = { split: E.split(), away: C6.away() };
E.swapPill.onclick();                                       // ... and back
await advance(250);
const pillBack = { split: E.split(), away: C6.away() };
const F = makePage("main", "chart-F", 41000);               // a second chart, view-only: E supervises
E.api.applySupervisor({ holder: "chart-E" }); F.api.applySupervisor({ holder: "chart-E" });
await advance(500);
C6.made.cardsSwapCtl.onclick();
await advance(250);
const viewOnly = { fHome: F.api.home(), eHome: E.api.home(), eSplit: E.split() };
check("9. THE SWAP: with the controls window open the chart shows its pill (⇄ Cards here) and the controls window "
      + "its button; that button sends the cards to the chart - the chart unsplit, the controls window showing only its "
      + "note, the pill reading ⇄ Cards to Controls - and the note's button brings them back; the chart's pill does "
      + "the same both ways; only the supervising chart heeds it",
      () => pill0.split && pill0.peer && pill0.label === "⇄ Cards here" && /Cards to chart/.test(pill0.btn || "")
            && !toChart.split && toChart.peer && toChart.home === "chart" && toChart.away
            && toChart.label === "⇄ Cards to Controls"
            && toCtl.split && toCtl.home === "controls" && !toCtl.away && toCtl.label === "⇄ Cards here"
            && !pillHere.split && pillHere.away && pillBack.split && !pillBack.away
            && viewOnly.fHome === "controls" && viewOnly.eHome === "chart" && !viewOnly.eSplit,
      () => JSON.stringify({ pill0, toChart, toCtl, pillHere, pillBack, viewOnly }));

close(C6);
await advance(10);
const closedAway = E.split();
const C7 = makePage("controls", "ctl-7", 50000);
await advance(3500);
check("9b. the cards on the chart and the controls window closed: they stay on the chart; a controls window opened "
      + "after takes them again",
      () => !closedAway && E.split() && E.api.home() === "controls" && !C7.away(),
      () => "after the close split " + closedAway + "; the new window: split " + E.split() + ", home " + E.api.home());

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
})();
