// tests/panel_drag.js - the floating pop-out panels: ONE drag mechanism, and every
// panel registered on it correctly.
//
// WHY THIS EXISTS. Six panels - the vessel card, SURV, LINES, the AIS table, the SRC
// chart card and ROC - each carried its OWN hand-copied drag: a restore block, a
// mousedown, a window mousemove and a window mouseup. Six copies meant six handlers ran
// on every pointer move anywhere in the window, only for five of them to discover they
// were not dragging. It also meant the copies could drift, and one had:
//
//   * THE SRC CARD NEVER PERSISTED ITS POSITION. Its mouseup cleared the drag state and
//     saved nothing, so it was the one pop-out that forgot where the operator put it.
//     Nothing said so - the card simply reappeared at its authored corner next session,
//     which reads as "it does not remember" rather than "this is broken".
//
// That is the same shape as the resize mechanism the maintainer notes already record
// (see tests/ui_split.js 10-14): a per-card special case beside a general one that
// already did the job. The fix was one `makeDraggablePanel(el, head, opts)` plus a
// single `panelDrag` and ONE pair of window listeners.
//
//   node tests/panel_drag.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// THE SECOND FAULT, reported live by Andy: THE VESSEL STATUS CARD WAS ABSENT FROM THE
// CHART. Not hidden, not broken - display:block and fully live, at a position saved when
// the window was bigger, sitting outside the viewport. The DRAG had always clamped to the
// chart; RESTORE never did, so a position from a larger window (or a second monitor) came
// back verbatim. The vessel card was the cruel case: placeVcard() puts its VESSEL reopen
// pill at the SAME coordinates, so the one control that brings the card back went off-screen
// with it and there was no way home. 12-20 cover the clamp; the clamp is DISPLAY-ONLY, so a
// card parked at the edge of a big monitor still returns there when the window is big again.
//
// THAT RESIDUAL IS NOW CLOSED. The pop-outs that start hidden were shown from SEVEN bare
// `style.display = ...` sites, so a panel restored while hidden kept the 0x0 sliver clamp
// and appeared with only a corner on the chart. showPanel(el, show, display) shows and
// re-clamps in one step, in that order. 21-23 keep it that way. Verified live: every keyed
// pop-out seeded at {4000,3000} while hidden now reveals FULLY inside the chart, with the
// stored position untouched.
//
// Most of these are SOURCE-SHAPE assertions, in the house style of tests/ui_split.js: which
// listener a browser calls is not observable from Node, and the regression this guards is
// precisely a registration going missing or losing an option. The live behaviour WAS
// verified separately in a real browser - all six panels dragged, landed, persisted,
// released their anchors and restored across a reload, and the three close buttons
// refused to start a drag while a plain header still did.
//
// TEETH (verified by mutation, not assumed): drop the SRC card's `key` and 6 fails - that
// is the original defect restored. Drop LINES' `unanchor` and 7 fails; drop the AIS
// `ignore` and 8 fails. Point two panels at the same storage key and 5 fails. Re-add a
// second window mousemove that reads panelDrag and 2 fails. Leave a per-panel drag
// variable behind and 3 fails. Make the helper restore a position without releasing the
// anchor, or stop releasing it during the drag, and 9 fails. Persist on something other
// than mouseup and 10 fails. Remove the missing-element guard and 11 fails.
// The clamp, same way: strip it from the restore path and 18 fails (the reported fault
// restored); feed placePanel the element's on-screen position instead of the stored one and
// 19 fails (the ratchet); clamp only negatives and 13 fails; drop the 0x0 sliver rule and 15
// fails; widen the assumed panel size and 12 fails; measure before showing in placeVcard and
// 20 fails. NOTE 12-17 exercise clampPanelPos DIRECTLY, so they stayed green when the clamp
// was ripped out of its caller - 18 and 19 exist because of that miss.
// showPanel, same way: restore a bare style.display show at any of the seven sites and 21
// fails; clamp before showing and 22 fails; persist on reveal and 23 fails; drop the
// re-clamp entirely and 22 fails. 20 and 22 compare the LAST display write against the
// clamp, not the first - checking indexOf alone let a mutation through that moved the real
// write after the clamp while an earlier one in a guard clause still satisfied it.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// check() turns a throw inside its own thunk into a failed check. Scenario SETUP is not
// inside one - building a world, eval-ing page code, awaiting a fetch - and a throw there
// would kill the process before a single FAIL line printed. "No FAIL lines" and "the
// process died" are indistinguishable to anything reading stdout, so a mutation that
// crashes this suite would score as SURVIVED. Report it instead, in the normal format.
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

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

let fails = 0, ran = 0;
// `cond` may be a value (the source-shape checks) or a THUNK (the clamp checks below, which
// call real code). A throw is reported as a failed check rather than killing the run - see
// the note in tests/stored_settings.js: a harness that cannot survive the fault it tests for
// cannot report it, and a mutation that crashes the process prints no FAIL line at all.
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try {
    ok = !!(typeof cond === "function" ? cond() : cond);
    note = typeof detail === "function" ? detail() : detail;
  } catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}

const IDS = new Set((H.match(/\bid="[^"]+"/g) || []).map(s => s.slice(4, -1)));

function grab(name) {                            // a whole `function NAME(...){...}`
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {                        // `const NAME = ...;` on one line
  const m = H.match(new RegExp("^\\s*(?:const|let|var)\\s+" + name + "\\s*=.*?;", "m"));
  if (!m) throw new Error("test setup: declaration " + name + " not found (renamed?)");
  return m[0];
}
const PLACE = grab("placePanel");                              // the restore path
const MOVE = (H.match(/window\.addEventListener\("mousemove"[\s\S]{0,500}?\n\}\);/) || [""])[0];

// --- parse the registrations ---------------------------------------------- //
// Each call is makeDraggablePanel(<el>, <head>, {<opts>}); possibly wrapped over lines.
// Take the text from the "(" to its matching ")" so an option list can wrap freely.
function calls(name) {
  const out = [];
  let i = 0;
  for (;;) {
    i = H.indexOf(name + "(", i);
    if (i < 0) break;
    let k = H.indexOf("(", i), depth = 0, end = k;
    // Skip the DECLARATION - its parameter names would otherwise be resolved as if they
    // were element variables (`el` collides with a `const el = $(...)` elsewhere, which
    // silently invented a seventh panel the first time this test ran).
    if (/function\s+$/.test(H.slice(Math.max(0, i - 10), i))) { i = k; continue; }
    for (; end < H.length; end++) {
      const c = H[end];
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (!depth) break; }
    }
    out.push(H.slice(k + 1, end));
    i = end;
  }
  return out;
}
// A `const NAME = $("#sel")` / `NAME = $("#sel")` map, so a registration written with a
// variable resolves to the selector it actually binds.
const VARSEL = {};
for (const m of H.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*\$\("(#[A-Za-z0-9_-]+)"\)/g)) VARSEL[m[1]] = m[2];
// A `const NAME_KEY = "..."` map, so a registration written with a constant resolves too.
const VARKEY = {};
for (const m of H.matchAll(/\b([A-Z][A-Z0-9_]*_KEY)\s*=\s*"([^"]+)"/g)) VARKEY[m[1]] = m[2];

const selOf = (tok) => {
  tok = tok.trim();
  const direct = tok.match(/^\$\("(#[A-Za-z0-9_-]+)"\)$/);
  if (direct) return direct[1];
  return VARSEL[tok] || null;
};

const REG = calls("makeDraggablePanel").map(argtext => {
  // split the first two args off the leading part, before the options object
  const brace = argtext.indexOf("{");
  const head = brace < 0 ? argtext : argtext.slice(0, brace);
  const parts = head.split(",");
  const opts = brace < 0 ? "" : argtext.slice(brace);
  const keyTok = (opts.match(/\bkey:\s*([A-Za-z0-9_$]+)/) || [])[1];
  return {
    el: selOf(parts[0] || ""),
    head: selOf(parts[1] || ""),
    key: keyTok ? (VARKEY[keyTok] || keyTok) : null,
    unanchor: (opts.match(/\bunanchor:\s*"([a-z]+)"/) || [])[1] || null,
    ignore: (opts.match(/\bignore:\s*"([^"]+)"/) || [])[1] || null,
    persist: /\bpersist:/.test(opts),
    noRestore: /\brestore:\s*false/.test(opts),
  };
});

// The helper body, for the invariants that live inside it.
const HELPER = H.slice(H.indexOf("function makeDraggablePanel"),
                       H.indexOf("const VCARD_KEY"));

console.log("Panel drag — one mechanism, and every pop-out registered on it:");

check("1. every draggable pop-out is registered through the shared helper",
      REG.length >= 6, REG.length + " panels: " + REG.map(r => r.el || "?").join(", "));

// 2. ONE mechanism. Exactly one window mousemove may read panelDrag, and one mouseup.
const moveHandlers = (H.match(/window\.addEventListener\("mousemove"[\s\S]{0,160}?panelDrag/g) || []).length;
const upHandlers = (H.match(/window\.addEventListener\("mouseup"[\s\S]{0,160}?panelDrag/g) || []).length;
check("2. ONE window mousemove and ONE mouseup serve every panel",
      moveHandlers === 1 && upHandlers === 1,
      moveHandlers + " mousemove, " + upHandlers + " mouseup reading panelDrag");

// 3. No per-panel drag state may survive - each one was a whole private copy.
const strays = ["vdrag", "survDrag", "lineTableDrag", "aisTableDrag", "rocDrag"]
  .filter(v => new RegExp("\\b" + v + "\\b").test(H));
check("3. no per-panel drag state variables are left behind",
      strays.length === 0, strays.length ? strays.join(", ") : "one panelDrag holds whichever is live");

// 4. Every registration binds something real.
const badSel = REG.filter(r => !r.el || !r.head || !IDS.has(r.el.slice(1)) || !IDS.has(r.head.slice(1)));
check("4. every registered panel and header resolves in the DOM",
      badSel.length === 0,
      badSel.length ? badSel.map(r => (r.el || "?") + "/" + (r.head || "?")).join(", ")
                    : REG.length + " pairs checked");

// 5. A copy-paste that reused a key would silently tie two panels to one position.
const keys = REG.map(r => r.key).filter(Boolean);
check("5. every panel that persists uses its OWN storage key",
      new Set(keys).size === keys.length,
      keys.length + " keys, " + new Set(keys).size + " distinct");

// 6. THE ORIGINAL DEFECT. Every panel must persist SOMEHOW - by key, or by its own
// callback (the vessel card folds position into the prefs that also hold `hidden`).
const forgetful = REG.filter(r => !r.key && !r.persist);
check("6. NO PANEL FORGETS WHERE IT WAS PUT — each persists by key or by callback",
      forgetful.length === 0,
      forgetful.length ? forgetful.map(r => r.el).join(", ")
                       : REG.filter(r => r.key).length + " by key, " + REG.filter(r => r.persist).length + " by callback");

// 7. A card authored bottom- or right-anchored must release that anchor, or the anchor
// and the new left/top fight and the card stretches instead of moving.
const anchored = REG.filter(r => {
  if (!r.el) return false;
  const m = H.match(new RegExp('<div id="' + r.el.slice(1) + '"[^>]*>'));
  return m && /style="[^"]*\b(bottom|right):\s*\d/.test(m[0]);
});
const unreleased = anchored.filter(r => !r.unanchor);
check("7. a bottom/right-anchored panel declares the anchor to release",
      unreleased.length === 0,
      unreleased.length ? unreleased.map(r => r.el).join(", ")
                        : anchored.map(r => r.el + ":" + r.unanchor).join(", ") || "none authored anchored");

// 8. A close control inside the drag grip must not start a drag. Each header's markup is
// one line, so "does this header contain a Close id" is answerable directly.
const LINES = H.split("\n");
const needIgnore = REG.filter(r => {
  if (!r.head) return false;
  const line = LINES.find(l => l.includes('id="' + r.head.slice(1) + '"'));
  return line && /id="[A-Za-z0-9_]*Close"/.test(line);
});
const missing = needIgnore.filter(r => !r.ignore);
check("8. every header carrying a close button excludes it from the grip",
      missing.length === 0,
      missing.length ? missing.map(r => r.el).join(", ")
                     : needIgnore.map(r => r.ignore).join(", "));

// 9. The anchor must be released on BOTH paths. Releasing only while dragging leaves a
// restored panel fighting its own anchor on the next page load, which is the stretch bug
// arriving one session later - exactly the kind of gap a hand-copied block leaves.
// Counts the SHARED unanchor helper. It was an inline `release()` closure until the clamp
// work split restore out into placePanel, which left two copies of the same two-line rule -
// so it became a function, and this now checks both paths call THAT.
// Names the two paths explicitly rather than counting call sites: a count of ">= 2" stayed
// green when the restore path lost its unanchor, because a third site elsewhere covered for
// it. Which paths, not how many.
check("9. the anchor is released on RESTORE as well as during the drag",
      () => /function unanchorPanel\(/.test(H) && /unanchorPanel\(/.test(PLACE) && /unanchorPanel\(/.test(MOVE),
      () => "restore:" + /unanchorPanel\(/.test(PLACE) + " drag:" + /unanchorPanel\(/.test(MOVE));

// 10. Event-driven persistence, the lesson from the resize save: a ResizeObserver or a
// rAF is delivered with the rendering steps and an occluded window has those suspended.
// Matches the STORE HELPER rather than a raw localStorage call - the storage guards were
// consolidated into lsGet/lsSet/lsDel afterwards, and this check named the old shape.
check("10. the position is persisted on mouseup, not on a rendering-driven callback",
      /window\.addEventListener\("mouseup"[\s\S]{0,400}?\blsSet\(/.test(H),
      "mouseup lands whatever the window is doing");

// 11. The controls window renders a subset of the page, so a panel can legitimately be
// absent. Without the guard the helper throws during start-up and takes the rest with it.
check("11. a panel absent from this window is skipped, not thrown on",
      /if\(!el \|\| !head\) return;/.test(HELPER),
      "the controls window renders a subset of these panels");

// --- 12-17. THE CLAMP. Behavioural, not source-shape: clampPanelPos is pure geometry. --- //
// THE REPORTED FAULT (Andy, live): the vessel status card was absent from the chart. It was
// not hidden and not broken - it was display:block, fully live, at a position saved when the
// window was bigger, sitting outside the viewport. The drag had always clamped; RESTORE
// never did. The vessel card was the cruel case because placeVcard() puts its VESSEL reopen
// pill at the SAME coordinates, so the one control that brings the card back went with it.
let MAP = { width: 1280, height: 720 };
globalThis.mapEl = { getBoundingClientRect: () => MAP };
eval(grabDecl("PANEL_MIN_VIS") + "\n" + grab("clampPanelPos"));
const panel = (w, h) => ({ offsetWidth: w, offsetHeight: h });

check("12. a position that already fits is left exactly where it is",
      () => { const c = clampPanelPos(panel(196, 354), 900, 96);
              return c.left === 900 && c.top === 96; },
      "clamping must not move a card the operator placed legitimately");

check("13. THE REPORTED FAULT: a position saved on a bigger window is pulled back on screen",
      () => { const c = clampPanelPos(panel(196, 354), 2400, 1300);
              return c.left === 1280 - 196 && c.top === 720 - 354; },
      () => { const c = clampPanelPos(panel(196, 354), 2400, 1300);
              return "2400,1300 -> " + c.left + "," + c.top + " in a 1280x720 chart"; });

check("14. a negative position is pulled back too (dragged off the top or left)",
      () => { const c = clampPanelPos(panel(196, 354), -500, -80);
              return c.left === 0 && c.top === 0; },
      "0,0 is the near corner");

// A hidden panel measures 0x0. Clamping against a width of zero would allow left = full
// chart width, parking it exactly at the edge - missing again the moment it is shown.
check("15. a HIDDEN panel (0x0) is still kept reachable, not parked at the far edge",
      () => { const c = clampPanelPos(panel(0, 0), 5000, 5000);
              return c.left <= 1280 - 120 && c.top <= 720 - 120; },
      () => { const c = clampPanelPos(panel(0, 0), 5000, 5000);
              return "0x0 panel -> " + c.left + "," + c.top + " (a sliver is assumed)"; });

check("16. a panel larger than the chart lands at the near corner, not at a negative offset",
      () => { const c = clampPanelPos(panel(2000, 1200), 300, 300);
              return c.left === 0 && c.top === 0; },
      "an oversized card must still show its header");

// NO RATCHET. The clamp is display-only and re-derived from the STORED position, so
// shrinking the window and growing it back returns the card to where the operator put it.
// Clamping the already-clamped DOM value instead would strand it at the smaller size.
check("17. shrinking the window and growing it back RESTORES the stored position",
      () => {
        const stored = { left: 1050, top: 300 }, p = panel(196, 354);   // fits the big chart
        MAP = { width: 700, height: 500 };
        const small = clampPanelPos(p, stored.left, stored.top);      // squeezed
        MAP = { width: 1280, height: 720 };
        const back = clampPanelPos(p, stored.left, stored.top);       // re-derived from STORAGE
        const ratchet = clampPanelPos(p, small.left, small.top);      // what re-clamping the DOM would give
        return back.left === 1050 && back.top === 300 && ratchet.left !== 1050;
      },
      "re-clamping the on-screen value instead would leave it at the small window's edge");

// --- 18-19. THE CALLER MUST USE IT. ---------------------------------------- //
// 12-17 prove the geometry. They do NOT prove the restore path calls it: mutation showed
// that ripping clampPanelPos out of placePanel left all six green, because they exercise
// the pure function directly. Having a correct helper and honouring it are two assertions.
check("18. the RESTORE path actually clamps — a correct helper nothing calls is no help",
      () => /clampPanelPos\(/.test(PLACE),
      "this is the exact line whose absence was the reported fault");

// Re-clamping the element's CURRENT position ratchets: shrink the window and grow it back
// and the card stays at the small window's edge for good. 17 proves the maths is reversible;
// this proves placePanel feeds it the stored value rather than the on-screen one.
check("19. ... from the STORED position, not the element's current on-screen position",
      () => /lsGet\(/.test(PLACE) && !/parseFloat\(\s*el\.style/.test(PLACE),
      "reads storage: " + /lsGet\(/.test(PLACE) + ", reads the DOM: " + /parseFloat\(\s*el\.style/.test(PLACE));

// --- 20. ORDER OF OPERATIONS in placeVcard. -------------------------------- //
// A display:none element measures 0x0, so clamping before the card is shown falls back to
// the sliver rule and leaves it half off the chart on the very reveal meant to rescue it.
// Measured doing exactly that in a browser (card revealed at 1160,600 in a 1280x720 chart);
// same family as the move-grip paint-order check, and invisible to every other assertion.
const VC = grab("placeVcard");
check("20. placeVcard sets visibility BEFORE it measures for the clamp",
      () => writesBeforeClamp(VC).ok, () => writesBeforeClamp(VC).note);

// --- 21-23. ONE WAY TO SHOW A PANEL. -------------------------------------- //
// The residual left by the clamp work: six pop-outs were shown from SEVEN separate bare
// `style.display = ...` sites (two of them auto-opens I missed on the first sweep), so a
// panel restored while hidden kept the 0x0 sliver clamp and appeared with only a corner on
// the chart. showPanel() shows and re-clamps in one step. This check is the thing that
// stops the seven growing back to eight.
const SHOW = grab("showPanel");
const rawShows = H.split("\n")
  .map((l, i) => ({ line: i + 1, text: l }))
  // ASSIGNMENT only. `=(?!=)` because reading `style.display === "none"` to decide whether
  // to toggle is fine and common - it is the WRITE that has to go through showPanel.
  .filter(o => /\.style\.display\s*=(?!=)/.test(o.text))
  .filter(o => !/^\s*(\/\/|\*)/.test(o.text.trim()))
  // Derived from the registrations themselves, so a seventh panel is covered the day it is
  // registered rather than the day someone remembers to add it to a list here.
  .filter(o => REG.map(r => r.el).filter(Boolean).some(sel => o.text.includes('"' + sel + '"')));
check("21. no registered pop-out is shown by a bare style.display any more",
      () => rawShows.length === 0,
      () => rawShows.length ? rawShows.map(o => "line " + o.line + ": " + o.text.trim().slice(0, 50)).join(" | ")
                            : "every show goes through showPanel()");

// EVERY display write must precede the measure, not merely the first one. Checking
// `indexOf` alone let a mutation through that moved the real write after the clamp while an
// earlier write in an early-return branch still satisfied it.
function writesBeforeClamp(src) {
  const clampAt = src.indexOf("clampPanelPos(");
  const writes = [...src.matchAll(/\.style\.display\s*=(?!=)/g)].map(m => m.index);
  return { ok: clampAt > 0 && writes.length > 0 && Math.max(...writes) < clampAt,
           note: "last display write @" + (writes.length ? Math.max(...writes) : "none") + ", clamp @" + clampAt };
}
check("22. showPanel sets display BEFORE it re-clamps",
      () => writesBeforeClamp(SHOW).ok, () => writesBeforeClamp(SHOW).note);

// The re-clamp must not write storage: it only tightens what is on screen now, so the next
// restore or resize still re-derives the operator's own position from lsGet.
check("23. ... and does NOT persist, so a reveal cannot overwrite the stored position",
      () => !/lsSet\(/.test(SHOW) && !/saveVcardPrefs\(/.test(SHOW),
      "showing a panel is not the operator moving it");

// --- a card is not a mode ------------------------------------------------------------
// REPORTED LIVE (Andy, 2026-08-09): opening the ROC card deselected the SURV chip. The
// drawn pattern survived - it is kept across mode switches on purpose - but the MODE was
// cancelled, so mid-layout a glance at HOME cost the operator their drawing mode.
//
// The cause was a `setMode("pan")` inside the ROC button, whose comment explained it as
// hiding "any mode panel behind it": #rocPanel and the mode panels are all `.panel`, so
// they shared one default position and the card opened on top of them. The cure closed
// the operator's mode instead of moving the card. It was also UNCONDITIONAL while the
// collision was not - a dragged ROC position is persisted, so for anyone who had ever
// moved the card there was no overlap left to justify it.
//
// Checked as a PAIR, because either half alone is a half-fix: the button must not touch
// the mode, AND the card must not default on top of the mode panels - otherwise removing
// the setMode simply restores the overlap it was papering over.
// Read the handler's real BODY (brace-matched, not a fixed window) and strip comments
// before matching. The first version of check 24 did neither and failed against the fixed
// code, because the comment explaining the removal quotes the very call it removed - the
// same self-matching trap roc_persist.py hit when its "no suite writes the registry" audit
// found its own source text. A source-shape check must read CODE, not prose about code.
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
function handlerBody(id) {
  const at = H.indexOf('$("#' + id + '").onclick');
  if (at < 0) return null;
  const open = H.indexOf("{", at);
  if (open < 0) return "";
  let k = open, depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return stripComments(H.slice(open, k + 1));
}
const ROCBTN = handlerBody("rocBtn");
check("24. opening the ROC card does NOT cancel the chart mode",
      () => ROCBTN !== null && !/setMode\(/.test(ROCBTN),
      () => (ROCBTN || "").match(/setMode\([^)]*\)/) ?
            "still calls " + ROCBTN.match(/setMode\([^)]*\)/)[0] : "no setMode call in the body");

// ... and the sibling cards never did, which is what made ROC the odd one out. Derived
// from the source so a NEW card that cancels the mode is caught the day it is written.
const CARD_TOGGLES = ["linesBtn", "srcBtn", "rocBtn"];
check("24b no card toggle cancels the mode (ROC was the only one that did)", () => {
  for (const id of CARD_TOGGLES) {
    const body = handlerBody(id);
    if (body && /setMode\(/.test(body)) return false;
  }
  return true;
}, () => CARD_TOGGLES.filter(id => handlerBody(id) !== null).join(" / ") + " checked");

// The ROC card must not default onto the mode panels' spot. `.panel` puts every panel at
// left:14px and the mode panels are 158px wide, so anything sharing that origin lands on
// top of SURV. Read BOTH numbers out of the stylesheet rather than restating them.
function panelDefaults() {
  const rule = (H.match(/\.panel\{[^}]*\}/) || [""])[0];
  const left = parseFloat((rule.match(/left:(-?[\d.]+)px/) || [0, NaN])[1]);
  const width = parseFloat((rule.match(/width:([\d.]+)px/) || [0, NaN])[1]);
  const roc = (H.match(/id="rocPanel"[^>]*style="([^"]*)"/) || [0, ""])[1];
  const rocLeft = parseFloat((roc.match(/left:(-?[\d.]+)px/) || [0, NaN])[1]);
  return { left, width, rocLeft, right: left + width };
}
check("25. the ROC card's default position CLEARS the mode panels",
      () => { const d = panelDefaults();
              return Number.isFinite(d.rocLeft) && d.rocLeft >= d.right; },
      () => { const d = panelDefaults();
              return "mode panels " + d.left + "-" + d.right + "px, ROC opens at " + d.rocLeft + "px"; });

// --- what "visible" means is the PANEL's property, not the caller's ---------------------
// The ROC card opened as `display:block`, overriding `.panel`'s `display:flex`, so it lost
// the 6px row gap SURV has. The cause was showPanel defaulting to "block" and expecting
// each caller to pass "flex" - which exactly one of seven call sites did, while the ROC
// card is shown from THREE. Derived from the class now, so no caller can forget.
//
// FUNCTIONAL, not source-shape: run the real showPanel against a fake element and read
// back what it set. A regex for the word "flex" would pass on a comment mentioning it -
// the trap check 24 fell into one commit ago.
function displayAfterShow(classes) {
  const el = { classList: { contains: c => classes.includes(c) },
               style: { display: "none", left: "", top: "" } };
  const fn = new Function("clampPanelPos", "return " + SHOW)(() => ({ left: 0, top: 0 }));
  fn(el, true);
  return el.style.display;
}
check("26. a .panel opens as FLEX, so it keeps the row gap the stylesheet gives it",
      () => displayAfterShow(["panel"]) === "flex",
      () => ".panel -> " + displayAfterShow(["panel"]));

check("26b ... and a plain pop-out still opens as block",
      () => displayAfterShow(["rsz"]) === "block",
      () => "non-.panel -> " + displayAfterShow(["rsz"]));

// The derivation only pays off if the callers STOP passing the hint - otherwise one
// forgotten argument is still a differently-rendered card. The ROC card is the case that
// proved it, so name it rather than counting call sites.
// BALANCED PARENS, not [^)]*. The first version of this check used a character class that
// cannot cross a ")", so `showPanel($("#linePanel"), mode==="survey", "block")` hid its
// third argument behind the ")" of $("#linePanel") - and the mutation restoring a
// hard-coded display SURVIVED. Any check that reads a CALL has to parse the call.
function showPanelCalls() {
  const out = [];
  for (let i = 0; ; ) {
    const at = H.indexOf("showPanel(", i);
    if (at < 0) break;
    i = at + 10;
    if (/function\s+$/.test(H.slice(Math.max(0, at - 12), at))) continue;   // the definition
    let k = at + "showPanel".length, depth = 0;
    for (;;) {
      const c = H[k];
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (!depth) break; }
      if (k++ > at + 400) break;                       // unbalanced: give up, don't hang
    }
    out.push(H.slice(at, k + 1));
  }
  return out;
}
const HARDCODED = showPanelCalls().filter(s => /"(flex|block|inline[\w-]*)"/.test(s));
check("26c no call site hard-codes a display any more - every one derives it",
      () => HARDCODED.length === 0,
      () => HARDCODED.length ? HARDCODED.join(" | ")
                             : showPanelCalls().length + " showPanel calls, none hard-coded");

// --- 27: the WIND ROSE is the one movable thing that is NOT a panel ------------------- //
// Andy asked for it "on the chart... with background transparency", explicitly not a card
// or chip, so it is painted straight onto the map canvas and cannot use makeDraggablePanel
// (there is no DOM element to move). That exemption is fine; what is NOT fine is the thing
// it creates: an object sitting over the chart in EVERY mode, which the mode chain would
// otherwise act underneath - a press on it dropping a waypoint, placing a pattern corner
// or anchoring a measurement. Same class as the right-button misfire the chain already
// guards. Verified live before this was written: in WPT mode a press on the rose added no
// waypoint while a press on open water still did.
{
  const md = H.slice(H.indexOf('mapEl.addEventListener("mousedown"'),
                     H.indexOf('window.addEventListener("mouseup"'));
  const roseAt = md.indexOf("roseAt(");
  const firstMode = md.indexOf('mode === "survey"');
  check("27. the wind rose claims a press BEFORE any mode handler sees it",
        () => roseAt >= 0 && firstMode >= 0 && roseAt < firstMode,
        () => "roseAt at " + roseAt + ", first mode branch at " + firstMode
              + " (rose must come first, or a press on it edits the plan underneath)");
  // the branch body carries object literals, so brace-counting a regex is the wrong tool:
  // assert instead that a `return` lands between the hit test and the first mode branch
  const branch = md.slice(roseAt, firstMode);
  check("27b. ... and it RETURNS, so no pan starts under it either",
        () => /\breturn;/.test(branch),
        () => "no `return` between roseAt() and the first mode branch - the chain runs on");
  check("27c. releasing the drag PERSISTS the position, so it survives a reload",
        () => /roseDrag\s*\)\s*\{[\s\S]{0,220}lsSet\(ROSE_KEY/.test(H),
        () => "mouseup must lsSet(ROSE_KEY, ...)");
  // The rose is clamped on READ, not on write - a window resize can strand a position
  // that was legal when it was saved. roseCentre() is the only place that answers "where
  // is it", so the clamp belongs there and nowhere else.
  check("27d. the position is clamped inside the viewport every time it is read",
        () => /function roseCentre\(\)[\s\S]{0,400}Math\.max\(ROSE_R[\s\S]{0,120}Math\.min\(/.test(H),
        () => "roseCentre() must clamp, or a resize can strand it off-screen");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
