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
// These are SOURCE-SHAPE assertions, in the house style of tests/ui_split.js: which
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
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

const fs = require("fs");
const path = require("path");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) fails++;
}

const IDS = new Set((H.match(/\bid="[^"]+"/g) || []).map(s => s.slice(4, -1)));

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
check("9. the anchor is released on RESTORE as well as during the drag",
      (HELPER.match(/release\(\)/g) || []).length >= 2 && /const release\s*=/.test(HELPER),
      (HELPER.match(/release\(\)/g) || []).length + " release() calls in the helper");

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

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
