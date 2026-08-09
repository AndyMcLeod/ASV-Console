// tests/ui_split.js - the two-window split: what is bridged, and what belongs where.
//
// Two things this guards, one of them an operator decision.
//
// 1. THE REGISTRATION LISTS MUST RESOLVE. The split works by naming selectors in three
//    places - UI_BRIDGED (mirrored to the controls window), UI_CARD_TITLES (wrapped as a
//    draggable card there), and the injected controls-window CSS. A selector that no longer
//    matches anything fails SILENTLY: the panel simply stops mirroring, or stops being
//    hidden, and nothing anywhere says so. The maintainer notes have claimed "every bridged
//    selector resolves" since the port - as a sentence somebody checked once. This makes it
//    a test.
//
// 2. THE VESSEL-STATUS CARD BELONGS TO THE CHART WINDOW (Andy, 2026-08-02). It used to be
//    bridged, so the SAME card appeared in BOTH windows - "VESSEL STATUS" on the chart, and
//    a "Vessel" card in the controls window with nine rows trimmed out to stop it echoing
//    the top status bar. Two copies of one card is not a second view, it is a second place
//    to look. The chart window has the card, the top bar has the quick read, the controls
//    window is the toolbar. THE TOP STATUS BAR IS DELIBERATELY UNTOUCHED - it is liked as
//    it is, and the nine-row overlap with the card is accepted, not a defect to fix.
//
//   node tests/ui_split.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// These are SOURCE-SHAPE assertions, like the move-grip draw order: which window a card
// renders in is not observable without standing up two real browser windows, and the
// regression this guards is precisely an entry in a list. A future port from the sibling
// console - which arranges its own windows differently - is exactly how #vcard would get
// re-added without anyone noticing.
//
// TEETH (verified by mutation, not assumed): put "#vcard" back in UI_BRIDGED and 5 fails;
// back in UI_CARD_TITLES and 6 fails; drop the controls-window hide rule and 7 fails; add
// "#vcard" to the ui-split hide list, which would strip it from the CHART window too, and 8
// fails. Break any bridged selector and 2 fails; any card title and 3; any id in the
// injected CSS and 4. Give .rsz a fixed `display` and 11 fails. Drop the vessel card from
// the registry and 12 fails. Save only through the ResizeObserver, with no mouseup, and 13
// fails. Persist any inline size rather than only a changed one and 14 fails.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

const fs = require("fs");
const path = require("path");

// --- source lookup: the page AND its modules -----------------------------------------
// Parts of the client live in static/js/*.js now, so a name this suite lifts as SOURCE TEXT
// may be in either place. MODSRC is those modules concatenated with the `export` keyword
// stripped, which makes each declaration read exactly as it did when it sat in the page -
// so the grab helpers below need no other change.
const MODSRC = require("fs")
  .readdirSync(require("path").join(__dirname, "..", "static", "js"))
  .filter(f => f.endsWith(".js"))
  .map(f => require("fs").readFileSync(
    require("path").join(__dirname, "..", "static", "js", f), "utf8"))
  .join("\n")
  .replace(/^export /gm, "");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) fails++;
}

// Everything the document actually defines.
const IDS = new Set(H.match(/\bid="[^"]+"/g).map(s => s.slice(4, -1)));
const CLASSES = new Set();
(H.match(/\bclass="[^"]+"/g) || []).forEach(c => c.slice(7, -1).split(/\s+/).forEach(w => w && CLASSES.add(w)));
const resolves = sel => sel[0] === "#" ? IDS.has(sel.slice(1))
                 : sel[0] === "." ? CLASSES.has(sel.slice(1)) : false;

function block(name) {
  const i = H.indexOf("const " + name);
  if (i < 0) throw new Error("test setup: " + name + " not found (renamed?)");
  return H.slice(i, H.indexOf(";", i));
}
const bridged = (block("UI_BRIDGED").match(/"([.#][A-Za-z0-9_-]+)"/g) || []).map(s => s.slice(1, -1));
const titles  = (block("UI_CARD_TITLES").match(/"([.#][A-Za-z0-9_-]+)"\s*:/g) || []).map(s => s.match(/"([^"]+)"/)[1]);

// The injected controls-window stylesheet, as one string.
const cssStart = H.indexOf('const s = document.createElement("style"); s.textContent =');
const cssEnd = H.indexOf("document.head.appendChild(s);", cssStart);
const CSS = H.slice(cssStart, cssEnd);
const cssIds = [...new Set((CSS.match(/#[A-Za-z][A-Za-z0-9_-]*/g) || [])
  .filter(x => !/^#[0-9a-fA-F]{3,8}$/.test(x)))];        // drop colour literals

console.log("UI split — the registration lists must resolve, and the card belongs on the chart:");

check("1. all three registration surfaces were found",
      bridged.length > 5 && titles.length > 5 && cssIds.length > 5,
      bridged.length + " bridged, " + titles.length + " titled, " + cssIds.length + " ids in CSS");

const badB = bridged.filter(s => !resolves(s));
check("2. every UI_BRIDGED selector resolves in the DOM",
      badB.length === 0, badB.length ? badB.join(", ") : bridged.length + " checked");
const badT = titles.filter(s => !resolves(s));
check("3. every UI_CARD_TITLES key resolves in the DOM",
      badT.length === 0, badT.length ? badT.join(", ") : titles.length + " checked");
const badC = cssIds.filter(s => !resolves(s));
check("4. every #id in the injected controls-window CSS resolves",
      badC.length === 0, badC.length ? badC.join(", ") : cssIds.length + " checked");

// 5-8. THE OPERATOR'S DECISION. The card is not mirrored, not wrapped, hidden in the
// controls window - and NOT in the ui-split hide list, which is what keeps it on the chart.
check("5. the vessel-status card is NOT bridged to the controls window",
      !bridged.includes("#vcard"), "one card, one place to look");
check("6. ... and is NOT wrapped as a controls-window card",
      !titles.includes("#vcard"));
check("7. ... and IS hidden there outright",
      /body\.ui-controls #vcard\{display:none!important;\}/.test(CSS.replace(/\s+/g, " ")),
      "same page under ?panel=controls, so it is hidden rather than removed");

// 8. The other half, and the easy mistake: hiding it on the CHART window instead. The
// ui-split list strips the toolbar and panels from the chart window while the controls
// window is alive - the vessel card must never join it.
const splitLine = (CSS.match(/body\.ui-split [^"]*/g) || []).join(" ");
check("8. ... and never added to the ui-split list, which would strip it from the CHART",
      !/body\.ui-split #vcard\b/.test(splitLine),
      "the chart window is where it lives");

// 9. The top status bar is deliberately left alone, overlap and all. If someone ever
// "tidies" the duplication away, this says it was a decision.
check("9. the top status bar still carries its own quick-read pills",
      (H.match(/<b id="p_[a-z_0-9]+"/g) || []).length >= 9,
      (H.match(/<b id="p_[a-z_0-9]+"/g) || []).length + " pills — the overlap with the card is accepted");

// 10-13. RESIZABLE CARDS - ONE MECHANISM, not a special case per card.
// The vessel-status card was very nearly given a private resize with its own storage key
// and its own save path, sitting beside the .uicard mechanism that already did the same job
// in the controls window. Two mechanisms for one behaviour is how they drift. These lock
// the shared one in place.
const RSZ = H.slice(H.indexOf(".rsz{"), H.indexOf(".vminipill{"));
check("10. there is a SHARED resizable-card class, not per-card CSS",
      /resize:both/.test(RSZ) && /overflow:auto/.test(RSZ)
      && /\.rsz > :first-child\{position:sticky/.test(RSZ),
      "resize + scroll container + sticky header, once");
check("11. ... and it is DISPLAY-AGNOSTIC — cards are shown as block AND as flex",
      !/\.rsz\{[^}]*display:flex/.test(RSZ),
      "requiring one display value would no-op on half the cards");

const reg = H.slice(H.indexOf("const RESIZABLE_CARDS"), H.indexOf("function loadCardSizes"));
const regCards = (reg.match(/sel:"#([A-Za-z0-9_]+)"/g) || []).map(x => x.slice(6, -1));
// DERIVED, not counted. This asserted `regCards.length >= 10` and broke the day the ENV
// card was deleted - the registry was still complete, the magic number had just gone
// stale. The real property is that every panel the PAGE defines is registered, so the
// check reads the panel ids out of the markup: a new card fails this the day it is
// added, and a deleted one needs no edit here. Same rule as the hook's suite list and
// the manual's harness table - name the paths, don't count them.
const pagePanels = [...H.matchAll(/<div class="panel" id="([A-Za-z0-9_]+)"/g)].map(m => m[1]);
const unregistered = pagePanels.filter(id => !regCards.includes(id));
// A BOOLEAN, not a thunk: this file's check() reads `cond` directly rather than calling
// it, so an arrow function here is an object, an object is truthy, and the check passes
// no matter what the page says. Mine did exactly that until an injected unregistered
// panel failed to fail it.
check("12. every panel the page defines is in the resizable registry, vessel card included",
      regCards.includes("vcard") && pagePanels.length > 0 && unregistered.length === 0,
      regCards.length + " registered vs " + pagePanels.length + " panels in the page" +
      (unregistered.length ? "; NOT registered: " + unregistered.join(", ") : ""));

// 13. THE SAVE MUST NOT DEPEND ON RENDERING. A ResizeObserver is delivered with the
// rendering steps, and an occluded window has those suspended - measured in a hidden pane:
// it does not fire at all, not even on attach. Same trap that froze the window-split mirror
// when it used requestAnimationFrame. mouseup and beforeunload are event-driven and land
// whatever the window is doing. BOTH windows are checked: the controls window's own layout
// save had the identical gap.
check("13. the size save is event-driven in BOTH windows, not only observer-driven",
      H.indexOf('window.addEventListener("mouseup", saveCardSizesSoon)') >= 0
      && H.indexOf('window.addEventListener("beforeunload", saveCardSizes)') >= 0
      && H.indexOf('window.addEventListener("mouseup", uiSaveSoon)') >= 0,
      "chart window + controls window both get a mouseup trigger");

// 14. A stored DEFAULT would override a changed default forever - the same shape as the
// mission buffer that undercut a vessel's own floor. Only a size that differs from what the
// markup authored is persisted.
check("14. only an operator-CHANGED size is persisted, never the authored default",
      H.indexOf("rszDefW") >= 0 && H.indexOf("rszDefH") >= 0
      && /w === \(el\.dataset\.rszDefW \|\| ""\)/.test(H),
      "compared against the authored default, not inferred from gestures");

// --- 15-17. A CARD MAY NOT GROW PAST THE SCREEN --------------------------- //
// `max-width:96vw` had always said so for width. Height had no cap at all, so a card sized
// by its CONTENT ran off the bottom: 40 AIS contacts made the traffic card 797 px tall in a
// 720 px viewport, with the rest of the list unreachable. Measured, before and after.
check("15. the chart-window card declares a viewport HEIGHT cap, as it always did for width",
      /\.rsz\{[^}]*max-height:\s*\d+vh/.test(H) && /\.rsz\{[^}]*max-width:\s*96vw/.test(H),
      (H.match(/\.rsz\{[^}]*\}/) || ["(rule not found)"])[0].slice(0, 92));

// The controls window resizes the .uicard WRAPPER instead, and it was uncapped for the same
// reason - two rules for one job is how one of them gets forgotten.
check("16. ... and so does the controls-window wrapper, which is what resizes there",
      /body\.ui-controls \.uicard\{[^"]*max-height:\s*\d+vh/.test(H),
      "the .uicard wrapper is the resizable element in that window");

// THE TRAP THIS WOULD OTHERWISE FALL INTO. makeCardsResizable used to write
// el.style.maxHeight = "none" on restore and on mousedown, to release "the default height
// cap". No card has ever carried a card-level max-height - those live on the BODIES, which
// .rszbody already overrides - so it released nothing and was dead. It was harmless only
// while .rsz had no cap: an inline `none` beats a stylesheet rule, so the first mousedown on
// any card would have uncapped it permanently. A viewport cap is not the operator's to
// release, exactly like max-width, so those writes are gone rather than pointed elsewhere.
check("17. nothing writes an inline maxHeight, which would defeat the cap on first touch",
      !/style\.maxHeight\s*=/.test(H),
      "inline beats the stylesheet — one mousedown and the cap would be gone for good");

// --- 18-22. A UICARD MUST STAY REACHABLE ---------------------------------- //
// The SURV card "did not properly resize and occasionally locked to the right side"
// - ONE bug: wrapUICards restored a saved position VERBATIM, so a layout saved on a
// bigger window put the card past the right edge, where its resize handle (far
// corner) leaves the screen first and its grip follows. The chart pop-outs got this
// fix in 2aef779; the controls window's parallel mechanism never did - the standing
// cost of a parallel mechanism. These checks pin the SAME three properties the
// chart's clamp keeps: clamp on restore, clamp during drag, stored layout never
// rewritten by a clamp (display-only). Five mutations RUN, 5/5 caught, each by
// exactly the check written for it (18-22; the shipped bug restored is U1/19).
// the grab() extractor, as in ais_table.js - brace-matched function source from H
function grab(name){
  const HS = H.indexOf("function " + name + "(") >= 0 ? H : MODSRC;
  const start = HS.indexOf("function " + name + "(");
  if(start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = HS.indexOf("{", start), depth = 0;
  for(;;){ const c = HS[k]; if(c === "{") depth++; else if(c === "}"){ depth--; if(!depth) break; } k++; }
  return HS.slice(start, k + 1);
}
const CLAMP = grab("clampUICard");
const WRAP = grab("wrapUICards"), UISAVE = grab("saveUILayout"), UIDRAG = grab("makeUIDraggable");
const MINVIS = (H.match(/const UICARD_MIN_VIS = (\d+);/) || [0, "0"])[1];   // the real constant, not a copy
const cl = new Function("innerWidth", "innerHeight", "const UICARD_MIN_VIS=" + MINVIS + ";" + CLAMP + "; return clampUICard;")(1280, 720);
check("18. clampUICard: far-right restores land reachable, never off-screen",
      cl(2400, 40).left === 1280 - 120 && cl(2400, 40).top === 40
      && cl(-50, -50).left === 0 && cl(-50, -50).top === 0
      && cl(100, 5000).top === 720 - 28,
      "seeded 2400px in a 1280px window restored at 1160 - measured live");
check("19. the restore path places THROUGH the clamp and remembers the stored layout",
      /placeUICard\(card, parseFloat\(rl\), parseFloat\(rt\)\)/.test(WRAP)
      && /dataset\.storedLeft=rl/.test(WRAP) && /dataset\.storedTop=rt/.test(WRAP),
      "a stale big-monitor position must stay reachable AND stay stored");
check("20. the clamp is DISPLAY-ONLY: a save prefers the STORED value while it stands",
      /dataset\.storedLeft \|\| card\.style\.left/.test(UISAVE)
      && /dataset\.storedTop\s+\|\| card\.style\.top/.test(UISAVE),
      "a beforeunload after a silent clamp must not bake 1160 over the parked 2400");
check("21. a DRAG clamps every move and makes the operator's placement the truth",
      /const mv=ev=>\{ placeUICard\(card/.test(UIDRAG)
      && /delete card\.dataset\.storedLeft/.test(UIDRAG),
      "the grip can never be dragged off-screen; a re-place clears the stored value");
check("22. a window RESIZE re-derives from the STORED layout, never the DOM",
      /addEventListener\("resize"/.test(WRAP)
      && /dataset\.storedLeft\|\|card\.style\.left/.test(WRAP),
      "re-clamping the clamped would RATCHET: shrink then grow strands the card");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
