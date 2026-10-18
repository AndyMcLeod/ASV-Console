// tests/status_bar.js - the status bar is two lines, and nothing in it moves as the numbers change (2026-10-14).
//
// Andy: "The ASV Status bar should be 2 lines tall. The upper, and left aligned portion, will hold the mission/vessel/
// pills group in roughly the same position they are now. The lower line, aligned right, will hold the dynamic data of
// the ASV. This is to accommodate smaller screens where the dynamic data wraps to the second line and jitters about as
// numbers change. Try to keep everything stable in size and lateral placement."
//
// It was ONE wrapping row - the group, a spacer, the readouts - so nearly every screen broke it inside the readouts, and
// the break moved whenever a width did. Now:
//   1   TWO ROWS: the bar a column of exactly two rows, the group's from the left, the readouts' from the right; no spacer;
//   2   THE UPPER ROW: the console's group in its order, the three warnings that come and go LAST - none of the readouts;
//   3   THE LOWER ROW: the eleven readouts in their order, nothing else;
//   4   EVERY CHANGING VALUE AT A FIXED WIDTH, AT ITS LONGEST: each value's min-width (ch) is at least the longest text
//       its writer can put there - derived from the code that writes it (the position and distance formatters run, the
//       console's link modes and states, autonomy labels and route cap read from asv_console.py, the clock's format) -
//       and each writer still writes that format, so a new format fails here before it jitters on the water;
//   5   UNDER THE CARDS: two rows of the bar's padding and gap fit above the cards and buttons at 96 px.
//   6   (2026-10-17) THE CONTROLS WINDOW, a window of its own, WATCHES THE CHART: red across its top on the console's
//       word that the chart has stopped handling the stream (its supervisor post stale, or none held past the
//       stale time), amber in a corner for the supervising chart covered or minimized (6, 6b, 6c).
// Measured live (scratch 8796, 1,366 px): 20 s of a Go-To - 40 positions, 21 times, 13 rolls - moved nothing in the bar
// by more than 0.0125 px; every value written at its shortest and then its longest moved nothing by more than 0.1 px.
// The lower row is 1,168 to 1,172 px, one line in a window wider than about 1,200. At 1,366 px with the station windows
// open, every warning fits beside the group but "VIEW ONLY · the other tab is planning", which adds a line (93 px).
//
//   node tests/status_bar.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 15 sidecar mutations RUN, 15/15 caught:
//   the spacer back -> 1                       the readouts packed from the left -> 1
//   one wrapping row again -> 1, 5             a readout in the upper row -> 2
//   a new pill between the link and the autonomy word -> 2 (two mutants)
//   POS, SOG, HOME→, WPT, TIME, the link's words, the autonomy word each too narrow -> 4 (seven mutants)
//   the speed written in a longer format -> 4  the bar's padding grown to 26 px (about 107 px tall) -> 5
// (a padding of 20 px - about 95 by the estimate, 89 in fact - still clears 96, so it is not a fault)

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
const APP = process.env.ASV_APP || path.join(__dirname, "..");
const H = fs.readFileSync(process.env.ASV_HTML || path.join(APP, "static", "asv.html"), "utf8").split("\r\n").join("\n");
const PY = fs.readFileSync(path.join(APP, "asv_console.py"), "utf8");
const U = require(path.join(APP, "static", "js", "units.js"));

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
console.log("The status bar is two lines, and nothing in it moves:");

// the bar's markup: from its opening tag to the controls that follow it
const bar = H.slice(H.indexOf('<div class="topbar">'), H.indexOf('<div class="controls">'));
const iRow1 = bar.indexOf('<div class="tbrow tbgroup">'), iRow2 = bar.indexOf('<div class="tbrow tblive">');
const row1 = bar.slice(iRow1, iRow2), row2 = bar.slice(iRow2);
const css = (sel) => { const m = new RegExp("\\n\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}").exec(H); return m ? m[1] : null; };
const idsIn = (html) => [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);

// ── 1. two rows ────────────────────────────────────────────────────────────────────
{
  const top = css(".topbar") || "", g = css(".topbar .tbgroup") || "", l = css(".topbar .tblive") || "", r = css(".topbar .tbrow") || "";
  check("1. TWO ROWS: the bar is a column of exactly two rows - the group's, packed from the LEFT, then the readouts', "
        + "packed from the RIGHT - and no spacer between them",
        () => /flex-direction:column/.test(top) && iRow1 > 0 && iRow2 > iRow1 && (bar.match(/class="tbrow /g) || []).length === 2
              && /justify-content:flex-start/.test(g) && /justify-content:flex-end/.test(l) && /display:flex/.test(r)
              && !/class="spacer"/.test(bar),
        () => JSON.stringify({ top, g, l, rows: (bar.match(/class="tbrow /g) || []).length, spacer: /class="spacer"/.test(bar) }));
}

// ── 2-3. what each row holds ──────────────────────────────────────────────────────────
// cardsSwap beside ctlReopen (2026-10-18): one or the other shows - reopen a controls window gone, swap with one open
const GROUP = ["portSel", "vesselSel", "dot", "linktext", "p_autonomy", "autonomy", "ctlReopen", "cardsSwap", "tideWin", "wxWin",
               "curWin", "buildPill", "diskPill", "supPill"];
const LIVE = ["p_pos", "p_sog", "p_hdg", "p_cog", "p_home", "p_pitch", "p_roll", "battPill", "p_batt_k", "p_batt", "p_wpt",
              "unitsPill", "p_units", "p_time"];
{
  const ids = idsIn(row1), at = (id) => ids.indexOf(id);
  check("2. THE UPPER ROW: the console's group in its order - port, vessel, link, autonomy, Playback, Controls, the station "
        + "windows - and the three warnings that come and go (build, disk, supervisor) LAST, so one showing moves nothing; "
        + "none of the readouts",
        () => JSON.stringify(ids) === JSON.stringify(GROUP) && /class="brand"/.test(row1) && /href="\/playback"/.test(row1)
              && at("curWin") < at("buildPill") && LIVE.every((id) => !ids.includes(id)),
        () => JSON.stringify(ids));
}
check("3. THE LOWER ROW: the eleven readouts, in their order - POS, SOG, HDG, COG, HOME→, PITCH, ROLL, the energy, WPT, the "
      + "distance unit, TIME - and nothing else",
      () => JSON.stringify(idsIn(row2)) === JSON.stringify(LIVE),
      () => JSON.stringify(idsIn(row2)));

// ── 4. fixed widths, at their longest ───────────────────────────────────────────────────
{
  const ch = (id) => { const m = new RegExp("#" + id + "\\{[^}]*min-width:(\\d+(?:\\.\\d+)?)ch").exec(H); return m ? +m[1] : 0; };
  const list = (re) => [...PY.matchAll(re)].map((m) => m[1]);
  // the console's own words: its link modes and states, its autonomy labels, its route cap
  const modes = ((/self\._mode = None\s*#\s*([^\n]*)/.exec(PY) || [])[1] || "").match(/"([a-z]+)"/g).map((s) => s.slice(1, -1));
  const links = [...list(/LINK_[A-Z]+ = "([a-z]+)"/g), "stale"];
  const labelsSrc = PY.slice(PY.indexOf("def _autonomy_label"), PY.indexOf("def state(self)"));
  // (its quoted words, less the two that are not labels: the run state it looks up by, and the status key it reads)
  const labels = [...labelsSrc.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).filter((w) => w !== "running" && w !== "holding")
    .map((w) => w.toUpperCase());
  const routeMax = +(/^ROUTE_MAX_WPTS = (\d+)/m.exec(PY) || [])[1];
  const len = (s) => [...s].length, longest = (xs) => Math.max(...xs.map(len));
  U.setDistUnit("km"); const homeKm = "359° · " + U.fmtDist(9999990);
  U.setDistUnit("nm"); const homeNm = "359° · " + U.fmtDist(9999990);
  U.setDistUnit("km");
  const want = {
    p_pos: longest([U.fmtLL(-89.99999, -179.99999), U.fmtLL(89.99999, 179.99999), "no fix"]),
    p_sog: len("99.99 kn"),                       // the console's two places (sog_kn), under 100 kn
    p_hdg: len("359.9°"), p_cog: len("359°"),     // heading to one place; COG rounded
    p_pitch: len("-99.9°"), p_roll: len("-99.9°"), // one place each
    p_home: longest([homeKm, homeNm]),             // a home 9,999 km off, either unit
    p_batt: longest(["100%", "99.99 V", "on RC", "--"]),
    p_wpt: len(routeMax + " / " + routeMax),
    p_time: len("00:00:00 · 00:00:00Z"),
    p_units: longest([U.unitLabel("km"), U.unitLabel("nm")]),   // the unit system, METRIC or SAE (2026-10-17)
    linktext: longest(modes.flatMap((m) => links.map((l) => m + " · " + l)).concat(links)),
    // the autonomy word carries .08em of letter-spacing a character, in a font whose ch is about .6em
    autonomy: Math.ceil(longest(labels) * (1 + 0.08 / 0.6)),
  };
  const short = Object.entries(want).filter(([id, n]) => !(ch(id) >= n)).map(([id, n]) => id + " " + ch(id) + "ch < " + n);
  // ... and each writer still writes the format the width was taken from
  const writers = {
    sog: /\$\("#p_sog"\)\.textContent = st\.sog_kn!=null \? st\.sog_kn\+" kn" : "--";/.test(H) && /"sog_kn": round\(sog_ground, 2\)/.test(PY),
    hdg: /\$\("#p_hdg"\)\.textContent = st\.heading_deg!=null \? st\.heading_deg\+"°" : "--";/.test(H) && /"heading_deg": round\(self\.heading, 1\)/.test(PY),
    cog: /\$\("#p_cog"\)\.textContent = st\.cog_deg!=null \? Math\.round\(st\.cog_deg\)\+"°" : "--";/.test(H),
    att: /\$\("#p_pitch"\)\.textContent = st\.pitch_deg!=null \? st\.pitch_deg\+"°" : "--";/.test(H) && /self\.pitch = round\([^\n]*, 1\)/.test(PY),
    home: /homeTxt = String\(Math\.round\(brg\)%360\)\.padStart\(3,"0"\)\+"° · "\+fmtDist\(rng\);/.test(H),
    pos: /\$\("#p_pos"\)\.textContent = fmtLL\(asv\.lat, asv\.lon\);/.test(H),
    wpt: /const wtxt = \(s\.wp_total \? \(s\.wp_index\|\|0\)\+" \/ "\+s\.wp_total : "--"\);/.test(H),
    time: /el\.textContent = L\+" · "\+U\+"Z";/.test(H),
    link: /\$\("#linktext"\)\.textContent = s\.mode \? \(s\.mode\+" · "\+\(s\.link\|\|"idle"\)\) : \(s\.link\|\|"idle"\);/.test(H),
    autonomy: /\$\("#autonomy"\)\.textContent = s\.estop \? "E-STOP" : auto;/.test(H) && /const auto = \(s\.autonomy\|\|"safe"\)\.toUpperCase\(\);/.test(H),
  };
  check("4. EVERY CHANGING VALUE AT A FIXED WIDTH, AT ITS LONGEST - derived from the code that writes it (the formatters run, "
        + "the console's modes, states, autonomy labels and route cap read from asv_console.py) - and every writer still "
        + "writing that format; the link and autonomy words (the upper row) too",
        () => short.length === 0 && Object.values(writers).every(Boolean) && modes.includes("serial") && labels.includes("FAILSAFE")
              && routeMax >= 10000,
        () => (short.length ? "too narrow: " + short.join("; ") + "; " : "") + "writers " + JSON.stringify(writers)
              + "; want " + JSON.stringify(want));
}

// ── 5. under the cards ───────────────────────────────────────────────────────────────
{
  const top = css(".topbar") || "", rowcss = css(".topbar .tbrow") || "";
  const pad = +((/padding:(\d+)px/.exec(top) || [])[1]), gap = +((/flex-direction:column;gap:(\d+)px/.exec(top) || [])[1]);
  const ROW_PX = 24;                             // a row's tallest item, a pill or a picker, measured 22-23 px
  const barPx = 2 * pad + 2 * ROW_PX + gap + 1;  // and the bottom border
  const at96 = /\.controls\{position:absolute;top:96px;/.test(H) && /\.panel\{position:absolute;left:14px;top:96px;/.test(H)
               && /function vcardDefaultPos\(\)\{[^\n]*top: 96\}/.test(H);
  check("5. UNDER THE CARDS: two rows of the bar - its padding, a row's tallest pill or picker each, the gap - stand above the "
        + "Path planning card, the Mission Status card and the chart buttons at 96 px",
        () => at96 && pad > 0 && gap > 0 && barPx < 96 && /flex-wrap:wrap/.test(rowcss),
        () => "padding " + pad + ", gap " + gap + " -> about " + barPx + " px; cards at 96: " + at96);
}

// ── THE CONTROLS WINDOW, A WINDOW; AND IT WATCHES THE CHART (2026-10-17: the performance review, then "implement option 2") ─
// The morning's red banner said the chart "CANNOT BE SEEN" whenever the chart page was hidden, and Edge calls a window
// hidden when another covers it: on one screen, the Controls window maximized over the Chart, it was up through his whole
// 12:27-12:54 run, which went well. Now RED only on the CONSOLE's word that the chart has stopped (its supervisor post
// stale, or no chart holding it past the stale time), AMBER for the supervising chart covered or minimized.
(async () => {
  const grabFn = (name) => { let st = H.indexOf("function " + name + "("); if (st < 0) throw new Error(name + " not found");
    if (H.slice(st - 6, st) === "async ") st -= 6;      // an async function keeps its keyword
    let k = H.indexOf("{", st), d = 0; for (;;) { const c = H[k]; if (c === "{") d++; else if (c === "}") { d--; if (!d) break; } k++; }
    return H.slice(st, k + 1); };
  const grabDecl = (name) => { const i = H.indexOf("const " + name + " ="); if (i < 0) throw new Error(name + " not declared");
    return H.slice(i, H.indexOf(";", i) + 1) + "\n"; };
  // the page's own watch, in a world of its own: a document, the channel, the console's answers queued, a clock
  const mkWorld = () => {
    const w = { els: {}, posts: [], listeners: {}, intervals: [], fetched: [], answers: [], now: 1e9 };
    const body = { kids: [], appendChild(e) { this.kids.push(e); w.els[e.id] = e; } };
    w.body = body;
    w.doc = { getElementById: (id) => w.els[id] || null, body, visibilityState: "visible",
              addEventListener: (ev, fn) => { w.listeners[ev] = fn; },
              createElement: () => ({ id: "", style: {}, attrs: {}, textContent: "", setAttribute(k, v) { this.attrs[k] = v; } }) };
    const fetchStub = (url) => { w.fetched.push(url); const a = w.answers.shift();
      return a ? Promise.resolve({ json: () => Promise.resolve(a) }) : Promise.reject(new Error("the console did not answer")); };
    const src = grabDecl("SUPERVISOR_BEAT_MS") + grabDecl("CHART_WATCH_MS") + grabDecl("chartWatch") + grabDecl("CHART_COVERED_SAY") + grabDecl("CHART_SLEEP_SAY")
      + ["chartStoppedSay", "chartNoneSay", "chartWatchVerdict", "chartWatchNote", "chartWatchVis", "chartWatchRender",
         "chartWatchPoll", "chartWatchStart", "chartWarnShow"].map(grabFn).join("\n")
      + "\nreturn {chartWatch, chartWatchVerdict, chartWatchVis, chartWatchPoll, chartWatchStart, chartWarnShow};";
    // eslint-disable-next-line no-new-func
    w.api = new Function("document", "uiBus", "fetch", "setInterval", "setTimeout", "clearTimeout", "AbortController", "Date", src)(
      w.doc, { postMessage: (m) => w.posts.push(m) }, fetchStub, (fn, ms) => w.intervals.push([fn, ms]),
      setTimeout, clearTimeout, AbortController, { now: () => w.now });
    return w;
  };

  // 6. the wiring, and the one element: red across the top, amber small in the corner, hidden for nothing to say
  const reopen = (H.match(/\$\("#ctlReopen"\)\.onclick = [^;]*;/) || [""])[0];
  const E = mkWorld();
  E.api.chartWarnShow(null); const madeForNothing = E.body.kids.length;
  E.api.chartWarnShow({ level: "red", text: "R1" }); const el = E.els.chartWarn;
  const red = el && { shown: el.style.display === "", role: el.attrs.role, top: /top:0/.test(el.style.cssText), text: el.textContent };
  E.api.chartWarnShow({ level: "amber", text: "A1" });
  const amber = el && { shown: el.style.display === "", role: el.attrs.role, corner: /bottom:12px/.test(el.style.cssText)
                        && !/top:0/.test(el.style.cssText), text: el.textContent };
  E.api.chartWarnShow(null); const gone = el && el.style.display === "none";
  E.api.chartWarnShow({ level: "red", text: "R2" }); const once = E.body.kids.length;
  check("6. THE CONTROLS WINDOW IS A WINDOW AND WATCHES THE CHART: the page's own reopen asks for a popup window, not a tab; "
        + "the chart window names itself in its word on whether it can be seen (every visibility change, its hello, and when "
        + "asked: \"vis?\"); the Controls window keeps that word by chart (chartWatchVis) and starts its watch (chartWatchStart) "
        + "- the old warning gone; and its one element shows red across the top, amber small in the corner, nothing for no "
        + "verdict, and is made once",
        () => /"asv_controls",\s*"popup[^"]*"/.test(reopen)
              && /t: "vis", from: CLIENT_ID, hidden: document\.visibilityState === "hidden"/.test(H)
              && /document\.addEventListener\("visibilitychange", sayVis\)/.test(H)
              && /if\(m\.t==="hello"\)\{ peerSeen\(m\.from, m\.lock\); pushUISync\(true\); sayVis\(\); return; \}/.test(H)
              && /if\(m\.t==="vis\?"\)\{ sayVis\(\); return; \}/.test(H)
              && /else if\(m\.t==="vis"\) chartWatchVis\(m\);/.test(H)
              && /\nif\(UIROLE === "controls"\) chartWatchStart\(\);/.test(H)
              && /fetch\("\/api\/state"/.test(grabFn("chartWatchPoll"))
              && !/function chartHiddenWarn\(/.test(H)
              && madeForNothing === 0 && red && red.shown && red.role === "alert" && red.top && red.text === "R1"
              && amber && amber.shown && amber.role === "status" && amber.corner && amber.text === "A1"
              && gone && once === 1 && el.textContent === "R2",
        () => JSON.stringify({ reopen: reopen.slice(0, 100), madeForNothing, red, amber, gone, once }));

  // 6b. the verdict, case by case
  const NOW = 5e9, api = E.api;
  const V = (sup, o = {}) => api.chartWatchVerdict({ sup, at: o.at != null ? o.at : NOW, lastFresh: o.lastFresh != null ? o.lastFresh : NOW,
                                                     hidden: new Map(o.hidden || []) }, NOW);
  const fresh = { holder: "A", stale: false, busy: false, age_s: 1.2, stale_s: 10 };
  const lv = (v) => v ? v.level + ":" + v.why : "none";
  const got = {
    noWord: lv(V(null, { hidden: [["A", true]] })),
    oldWord: lv(V({ ...fresh, stale: true, age_s: 30 }, { at: NOW - 7000, hidden: [["A", true]] })),
    covered: lv(V(fresh, { hidden: [["A", true]] })),
    inView: lv(V(fresh, { hidden: [["A", false]] })),
    unasked: lv(V(fresh)),
    otherTab: lv(V(fresh, { hidden: [["B", true]] })),
    stale: V({ ...fresh, stale: true, age_s: 14.2 }, { hidden: [["A", true]] }),
    planning: lv(V({ ...fresh, busy: true, age_s: 30 }, { hidden: [["A", false]] })),
    noneYet: lv(V({ holder: null, stale: false, stale_s: 10 }, { lastFresh: NOW - 5000 })),
    none: V({ holder: null, stale: false, stale_s: 10 }, { lastFresh: NOW - 12000 }),
    forgotten: lv(V({ holder: null, stale: false, stale_s: 10 }, { lastFresh: NOW - 130000 })),
  };
  check("6b. RED ON THE CONSOLE'S WORD, AMBER FOR THE SUPERVISING CHART COVERED: no word from the console, or one older than "
        + "CHART_WATCH_FRESH_MS, says nothing; the supervising chart covered is amber, in view nothing, and another chart's "
        + "word nothing; a stale post is red and says how long, even with the chart's word that it is covered, and names "
        + "the Edge setting that keeps the console awake (\"Never put these sites to sleep\", 127.0.0.1); a post held "
        + "by a chart that is planning is not red; no chart holding the post is nothing for the stale time - a chart loading "
        + "alongside - and red after it, and still red once the console has forgotten a chart that stopped long ago",
        () => got.noWord === "none" && got.oldWord === "none" && got.covered === "amber:hidden" && got.inView === "none"
              && got.unasked === "none" && got.otherTab === "none"
              && got.stale && got.stale.level === "red" && got.stale.why === "stale" && /STOPPED ANSWERING/.test(got.stale.text)
              && /for 14 s/.test(got.stale.text) && /closed, asleep in the browser, or stuck/.test(got.stale.text)
              // and the one Edge setting that keeps a tab from being put to sleep, and what to add to it (2026-10-18)
              && /add 127\.0\.0\.1 under "Never put these sites to sleep"/.test(got.stale.text)
              && /edge:\/\/settings\/system\/managePerformance/.test(got.stale.text)
              && got.planning === "none" && got.noneYet === "none"
              && got.none && got.none.level === "red" && got.none.why === "none" && /NO CHART WINDOW/.test(got.none.text)
              && /for 12 s/.test(got.none.text) && got.forgotten === "red:none",
        () => JSON.stringify({ ...got, stale: lv(got.stale), none: lv(got.none) }));

  // 6c. the watch driven: the console asked, the chart asked for its word once, an unanswered ask lapses, a shown window asks
  const W = mkWorld(), A = W.api;
  W.answers.push({ supervisor: { ...fresh } });
  A.chartWatchStart();
  await new Promise((r) => setImmediate(r));
  const first = { fetched: W.fetched.slice(), asked: W.posts.filter((m) => m.t === "vis?").length, el: !!W.els.chartWarn,
                  every: W.intervals.length === 1 && W.intervals[0][1] === 2000, onShow: typeof W.listeners.visibilitychange === "function" };
  A.chartWatchVis({ t: "vis", from: "A", hidden: true });
  const amberNow = W.els.chartWarn && W.els.chartWarn.style.display === "" && W.els.chartWarn.attrs.role === "status";
  W.now += 2000; W.answers.push({ supervisor: { ...fresh, age_s: 0.8 } });
  await A.chartWatchPoll();
  const askedAgain = W.posts.filter((m) => m.t === "vis?").length;
  W.now += 13000; W.answers.push({ supervisor: { ...fresh, stale: true, age_s: 15.4 } });
  await A.chartWatchPoll();
  const redNow = W.els.chartWarn && W.els.chartWarn.style.display === "" && W.els.chartWarn.attrs.role === "alert"
                 && /for 15 s/.test(W.els.chartWarn.textContent);
  W.now += 7000;                                     // the console does not answer, and its last word is 7 s old
  await A.chartWatchPoll();
  const lapsed = W.els.chartWarn && W.els.chartWarn.style.display === "none";
  const before = W.fetched.length;
  W.doc.visibilityState = "visible"; W.answers.push({ supervisor: { ...fresh } });
  W.listeners.visibilitychange();
  await new Promise((r) => setImmediate(r));
  const askedOnShow = W.fetched.length === before + 1;
  // the chart closed: the console's post empty, asked on and on - red once no chart has held it for the stale time
  W.now += 2000; W.answers.push({ supervisor: { holder: null, stale: false, stale_s: 10 } });
  await A.chartWatchPoll();
  const noneAtOnce = !W.els.chartWarn || W.els.chartWarn.style.display === "none";
  for (let i = 0; i < 5; i++) { W.now += 2000; W.answers.push({ supervisor: { holder: null, stale: false, stale_s: 10 } }); await A.chartWatchPoll(); }
  const noneRed = W.els.chartWarn && W.els.chartWarn.style.display === "" && /NO CHART WINDOW/.test(W.els.chartWarn.textContent);
  check("6c. THE WATCH, DRIVEN: it asks the console at once (/api/state) and then every 2 s, and again whenever its window "
        + "is shown; it asks the supervising chart for its word once, not again once it has it; the chart's word that it is "
        + "covered shows amber, the console's stale post red; and a console that stops answering takes its word with it - "
        + "nothing is said on a word 7 s old; and with the chart closed - the post empty, answer after answer - nothing at "
        + "first, then red once no chart has held it for the stale time",
        () => first.fetched.length === 1 && first.fetched[0] === "/api/state" && first.asked === 1 && !first.el && first.every
              && first.onShow && amberNow && askedAgain === 1 && redNow && lapsed && askedOnShow && noneAtOnce && noneRed,
        () => JSON.stringify({ first, amberNow, askedAgain, redNow, lapsed, askedOnShow, noneAtOnce, noneRed }));

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
