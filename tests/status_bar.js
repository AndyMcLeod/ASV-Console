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
const GROUP = ["portSel", "vesselSel", "dot", "linktext", "p_autonomy", "autonomy", "ctlReopen", "tideWin", "wxWin", "curWin",
               "buildPill", "diskPill", "supPill"];
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

// ── THE CONTROLS WINDOW, A WINDOW; AND THE CHART WINDOW SAYS WHEN IT CANNOT BE SEEN (2026-10-17, the performance review) ─
{
  const grabFn = (name) => { const st = H.indexOf("function " + name + "("); if (st < 0) throw new Error(name + " not found");
    let k = H.indexOf("{", st), d = 0; for (;;) { const c = H[k]; if (c === "{") d++; else if (c === "}") { d--; if (!d) break; } k++; }
    return H.slice(st, k + 1); };
  const say = (H.match(/const CHART_HIDDEN_SAY = [\s\S]*?;\n/) || [""])[0];
  const els = {}, body = { kids: [], appendChild(e) { this.kids.push(e); els[e.id] = e; } };
  const doc = { getElementById: (id) => els[id] || null, body,
                createElement: () => ({ id: "", style: {}, attrs: {}, textContent: "", setAttribute(k, v) { this.attrs[k] = v; } }) };
  const warn = new Function("document", say + grabFn("chartHiddenWarn") + "\nreturn chartHiddenWarn;")(doc);
  warn(false); const none = body.kids.length;
  warn(true); const el = els.chartHiddenWarn, shown = el && el.style.display === "";
  warn(true); const once = body.kids.length;
  warn(false); const hidden = el && el.style.display === "none";
  const reopen = (H.match(/\$\("#ctlReopen"\)\.onclick = [^;]*;/) || [""])[0];
  check("5. THE CONTROLS WINDOW IS A WINDOW AND SAYS WHEN THE CHART CANNOT BE SEEN: the page's own reopen asks for a popup "
        + "window, not a tab; the chart window tells the Controls window on every visibility change and on its hello, with "
        + "whether it supervises; the Controls window heeds only the supervising chart's word; and its warning is created "
        + "once, shown, and hidden again - nothing made while the chart is visible",
        () => /"asv_controls",\s*"popup[^"]*"/.test(reopen)
              && /document\.addEventListener\("visibilitychange", sayVis\)/.test(H)
              && /t: "vis", hidden: document\.visibilityState === "hidden", sup: supervising\(\)/.test(H)
              && /if\(m\.t==="hello"\)\{ peerSeen\(m\.from\); pushUISync\(true\); sayVis\(\); return; \}/.test(H)
              && /else if\(m\.t==="vis" && m\.sup !== false\) chartHiddenWarn\(!!m\.hidden\);/.test(H)
              && none === 0 && shown && once === 1 && hidden && /CANNOT BE SEEN/.test(el.textContent) && el.attrs.role === "alert",
        () => JSON.stringify({ reopen: reopen.slice(0, 140), none, shown, once, hidden, text: el && el.textContent.slice(0, 60) }));
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
