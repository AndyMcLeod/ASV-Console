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
//     two controls windows the NEWER steps aside - silent at once, then closed (5, 7);
//   * a closed controls window gives the cards back within 6-7 s of its last word, asked every second (6).
//
// The pages here are the page's OWN functions - setupUISplit, pushUISync, applyUISync, the peer table, the split rule,
// the supervision hook - each evaluated in its own world, connected by a fake channel that delivers to every other
// page, on a fake clock.
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
function deliver(from, m) {
  for (const p of pages) {
    if (p === from || p.closed || !p.bus.onmessage) continue;
    p.got.push(m.t);
    p.bus.onmessage({ data: JSON.parse(JSON.stringify(m)) });
  }
}
function advance(ms) {
  const end = clock.t + ms;
  for (;;) {
    const due = timers.filter(x => !x.page.closed && x.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    clock.t = Math.max(clock.t, due.at);
    if (due.every) due.at += due.every; else timers.splice(timers.indexOf(due), 1);
    due.fn();
  }
  clock.t = end;
}

const SRC = [grabDecl("UI_BRIDGED"), grabDecl("UI_PEER_GONE_MS"), grab("setupUISplit"), grab("pushUISync"), grab("applyUISync"),
             grab("uiPeersPrune"), grab("uiSplitApply"), grab("uiSupervisionChanged"), grab("uiOlder"), grab("uiYield"),
             grab("supervising"), grab("applySupervisor")].join("\n");

// A page: the console's own split-window code in a world of its own.
function makePage(role, id, born, opts) {
  const closeBlocked = !!(opts && opts.closeBlocked);    // a browser that will not let a page close a window it did not open
  const p = { role, id, closed: false, got: [], sent: [], clicks: [], renders: 0, listeners: {}, mo: null, dom: {}, hidden: false };
  p.bus = { onmessage: null, postMessage: m => { if (p.closed) return; p.sent.push(m); p.lastSentAt = clock.t; deliver(p, m); } };
  const classes = new Set();
  const el = s => ({
    id: s.replace(/^[#.]/, ""), tagName: "DIV", classList: { contains: () => false },
    get outerHTML() { return p.dom[s] || "<div>" + s + "</div>"; },
    set outerHTML(v) { p.dom[s] = v; p.rebuilt = (p.rebuilt || 0) + 1; },
    querySelectorAll: () => [], contains: () => false,
  });
  const world = {
    UIROLE: role, CLIENT_ID: id, born,
    uiBus: p.bus,
    document: {
      body: { classList: { contains: c => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
                           add: c => classes.add(c), remove: c => classes.delete(c) }, set innerHTML(v) { p.notice = v; } },
      get hidden() { return p.hidden; }, activeElement: null,
      querySelector: s => el(s),
      getElementById: i => ({ id: i, type: "button", click: () => p.clicks.push(i), dispatchEvent: () => {} }),
      addEventListener: () => {},
    },
    window: { addEventListener: (ev, fn) => { p.listeners[ev] = fn; },
              close: () => { if (closeBlocked) return; p.closed = true; p.closedBy = "window.close"; } },
    setInterval: (fn, ms) => timers.push({ page: p, at: clock.t + ms, every: ms, fn }),
    setTimeout: (fn, ms) => timers.push({ page: p, at: clock.t + ms, every: 0, fn }),
    MutationObserver: class { constructor(cb) { p.mo = cb; } observe() {} },
    Date: { now: () => clock.t },
    render: () => { p.renders++; }, $: () => null, showBanner: () => {},
    applyAlertWhere: () => {}, alertCardTidy: () => {}, wrapUICards: () => {}, saveUILayout: () => {}, uiSaveSoon: () => {},
    syncUICards: () => {}, Event: class { constructor(t) { this.type = t; } },
  };
  const names = Object.keys(world);
  // eslint-disable-next-line no-new-func
  const f = new Function(...names,
    "const UI_BORN = born; const uiPeers = new Map(); let uiYielded = false;\n" +
    "const SUPERVISES = UIROLE === \"main\"; let supHolder = null, supStale = false, supSaidViewOnly = false, supWas = true;\n" +
    "let supBeatMs = 2000, supStaleMs = 10000;\n" + grabDecl("uiSyncLast") + "\n" + SRC + "\n" +
    "return { setupUISplit, pushUISync, applySupervisor, peers: () => [...uiPeers.keys()], yielded: () => uiYielded };");
  p.api = f(...names.map(k => world[k]));
  p.split = () => classes.has("ui-split");
  pages.push(p);
  p.api.setupUISplit();
  return p;
}
const syncsFrom = p => p.sent.filter(m => m.t === "sync").length;
function mutate(p, html) { if (html != null) p.dom["#alertCard"] = html; p.mo([]); }   // the chart's observer fires
function close(p) { p.closed = true; }        // a window closed with no word: what a real close was measured to do
console.log("The split windows, with more than two pages:");

// 1. ONE CHART, ONE CONTROLS WINDOW - the ordinary case stays what it was.
const A = makePage("main", "chart-A", 1000);
const C1 = makePage("controls", "ctl-1", 2000);
advance(3500);
check("1. one chart and one controls window: the chart hides its cards (split) once the controls window says hello, "
      + "and gives it a picture at once",
      () => A.split() && A.api.peers().join() === "ctl-1" && syncsFrom(A) >= 1 && C1.got.includes("sync"),
      () => "split " + A.split() + ", peers " + A.api.peers() + ", syncs " + syncsFrom(A));

// 2. THE SAME PICTURE IS NOT SENT AGAIN.
let s0 = syncsFrom(A);
for (let i = 0; i < 10; i++) { mutate(A); advance(250); }
const idle = syncsFrom(A) - s0;
mutate(A, "<div id='alertCard'>NEW</div>"); advance(250);
check("2. ten frames that rewrite the same readouts send NOTHING; one that changes the picture sends ONE sync",
      () => idle === 0 && syncsFrom(A) - s0 === 1 && C1.dom["#alertCard"] === "<div id='alertCard'>NEW</div>",
      () => "idle frames sent " + idle + ", after a change " + (syncsFrom(A) - s0));

// 3. TWO CHARTS: only the supervising one drives the controls window.
const B = makePage("main", "chart-B", 3000);
A.api.applySupervisor({ holder: "chart-A" }); B.api.applySupervisor({ holder: "chart-A" });
advance(3000);
s0 = syncsFrom(B);
for (let i = 0; i < 8; i++) { mutate(B, "<div id='alertCard'>B " + i + "</div>"); advance(250); }
mutate(A, "<div id='alertCard'>A</div>"); advance(250);
C1.bus.postMessage({ t: "ev", kind: "click", id: "lineBtn" });
check("3. two charts: the SUPERVISING one alone hides its cards, mirrors into the controls window and carries out its "
      + "clicks; the view-only one keeps its own cards, sends nothing however its picture changes, and runs no click",
      () => A.split() && !B.split() && syncsFrom(B) - s0 === 0 && C1.dom["#alertCard"] === "<div id='alertCard'>A</div>"
            && A.clicks.join() === "lineBtn" && B.clicks.length === 0,
      () => "split A " + A.split() + " B " + B.split() + "; syncs from B " + (syncsFrom(B) - s0) + "; clicks A "
            + A.clicks + " B " + B.clicks + "; controls shows " + C1.dom["#alertCard"]);

// 4. SUPERVISION MOVES, AND THE CONTROLS WINDOW WITH IT.
const bSyncs = syncsFrom(B);
A.api.applySupervisor({ holder: "chart-B" }); B.api.applySupervisor({ holder: "chart-B" });
advance(250);
check("4. TAKE OVER in the other chart: it hides its cards and sends its picture at once (B's 'B 7'), and the chart "
      + "that lost supervision shows its own again",
      () => B.split() && !A.split() && syncsFrom(B) === bSyncs + 1 && C1.dom["#alertCard"] === "<div id='alertCard'>B 7</div>",
      () => "split A " + A.split() + " B " + B.split() + "; controls shows " + C1.dom["#alertCard"]);

// 5. A SECOND CONTROLS WINDOW: the newer steps aside.
const C2 = makePage("controls", "ctl-2", 5000);
advance(2500);
const c2after = C2.sent.length;
advance(6000);
check("5. a second controls window, opened after the first, hears it and STEPS ASIDE: it closes itself and says "
      + "nothing more - no ping, no hello, no bye; the first one never yields to it",
      () => C2.api.yielded() && C2.closedBy === "window.close" && C2.sent.length === c2after && !C1.api.yielded() && !C1.closed,
      () => "C2 yielded " + C2.api.yielded() + " (" + C2.closedBy + "), C2 sent after " + (C2.sent.length - c2after)
            + "; C1 yielded " + C1.api.yielded());
check("5b. ... and the chart, which heard the newcomer's hello, lets it go within 7 s and stays split on the first",
      () => B.api.peers().join() === "ctl-1" && B.split(), () => "peers " + B.api.peers() + ", split " + B.split());

const C4 = makePage("controls", "ctl-x", 6000, { closeBlocked: true });
advance(2500);
const c4after = C4.sent.length;
advance(7000);
check("5c. ... and where the browser will not let it close: it STAYS open but silent - nothing sent from the moment it "
      + "stepped aside - says why it is blank, and the chart lets it go and stays split on the first",
      () => C4.api.yielded() && !C4.closed && C4.sent.length === c4after && /ANOTHER CONTROLS WINDOW IS ALREADY OPEN/.test(C4.notice || "")
            && B.api.peers().join() === "ctl-1" && B.split(),
      () => "yielded " + C4.api.yielded() + ", open " + !C4.closed + ", sent after " + (C4.sent.length - c4after)
            + ", notice " + !!C4.notice + "; chart peers " + B.api.peers());

// 6. CLOSING THE CONTROLS WINDOW gives the cards back - not while the chart is hidden, at once when it is seen.
B.hidden = true;
const lastWord = clock.t;
close(C1);
advance(9000);
const whileHidden = B.split();
B.hidden = false;
let backAt = null;
for (let i = 0; i < 20 && backAt == null; i++) { advance(250); if (!B.split()) backAt = clock.t; }
check("6. the controls window closed with no word (as a real close was measured to send none): a HIDDEN chart passes "
      + "no verdict, and once it is seen the cards come back within a second - its peer table emptied",
      () => whileHidden && backAt != null && backAt - (lastWord + 9000) <= 1000 && B.api.peers().length === 0,
      () => "hidden: split " + whileHidden + "; seen, back after " + (backAt == null ? "never" : (backAt - lastWord - 9000) + " ms"));
const C3 = makePage("controls", "ctl-3", 9000);
advance(1000);
const split3 = B.split();
close(C3);
let back3 = null;
for (let i = 0; i < 80 && back3 == null; i++) { advance(125); if (!B.split()) back3 = clock.t - C3.lastSentAt; }
check("6b. a visible chart gives the cards back more than 6 s and within 7 s of the controls window's last word - never "
      + "sooner, which is what rides out the page's measured stalls; asked every second (it was every 3 s: 6-9 s, measured 9)",
      () => split3 && back3 != null && back3 > 6000 && back3 <= 7000, () => "back " + back3 + " ms after its last word");

// 7. A BYE drops the page that said it, and only that page; a page with no id is tracked as one.
const D1 = makePage("controls", "ctl-4", 20000);
advance(500);
B.bus.onmessage({ data: { t: "ping" } });                               // a page loaded before ids: tracked as "anon"
D1.listeners.beforeunload(); close(D1);
const afterBye = { split: B.split(), peers: B.api.peers().join() };
check("7. a controls window's bye drops IT, not every controls page: an older page that names no id still holds the "
      + "split, tracked as one anonymous page",
      () => afterBye.split && afterBye.peers === "anon", () => JSON.stringify(afterBye));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
