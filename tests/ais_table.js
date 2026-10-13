// tests/ais_table.js - the AIS traffic list is PATCHED, never rebuilt.
//
// WHY THIS EXISTS. renderAisTable() used to assign el.innerHTML on every poll, so every
// 8 seconds the whole body was destroyed and re-created. Andy reported it as the card
// "blanking and rewriting every cycle", and it cost three things at once:
//
//   * THE SCROLL POSITION. The card is `.rsz` - resize:both, overflow:auto - so a list of
//     traffic scrolls. Rebuilding the contents reset it to the top while you were reading.
//   * ANY TEXT SELECTION. Half-way through selecting an MMSI to copy, the node vanished.
//   * A visible flash, and the loss of the row's hover title while it was being replaced.
//
// Rows are now keyed by MMSI and reused: only cells whose text actually CHANGED are
// written, re-sorting MOVES the existing node with insertBefore, and contacts that drop out
// of range are removed. Nothing the operator is touching is destroyed.
//
//   node tests/ais_table.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// These are SOURCE-SHAPE assertions plus one behavioural check on the cell writer, in the
// house style of ui_split.js and panel_drag.js: the patch algorithm needs a DOM, and which
// nodes a browser preserves is not observable from Node. THE LIVE BEHAVIOUR WAS VERIFIED IN
// A REAL BROWSER and is worth recording, because these checks cannot see it:
//
//     a stamped row survived a poll as the SAME NODE (dataset stamp intact)
//     the card's scrollTop stayed at 90 across an update
//     a text selection ("VESSEL 5") survived the same update
//     values still updated: 1.5 -> 6.9 nm, brg 9 -> 2, sog 10 -> 13
//     a contact that dropped out was removed; a newcomer was added and sorted to the top
//     a row re-sorted from last to first was the SAME NODE (moved, not remade)
//     empty -> hides the table, keeps the skeleton, leaves no stale rows; and refills
//
// TEETH (verified by mutation, with the checks each one produces):
//     renderAisTable assigns innerHTML again (the reported fault)   -> 1
//     the status line is rewritten every cycle rather than on change -> 1b
//     the skeleton is rebuilt every call instead of once            -> 2
//     rows stop carrying data-mmsi                                  -> 3
//     the existing row is never looked up, so every row is remade   -> 4
//     re-sorting appends instead of insertBefore                    -> 5
//     vanished contacts are no longer removed                       -> 6
//     setCellText writes unconditionally (kills a live selection)   -> 7
//
// AND FOR THE SORTABLE CPA COLUMN (2026-09-02), seven more mutations RUN:
//     CPA sorted as a plain number (state rank dropped)             -> 14, 15, 16, 17b
//     the state rank REVERSED along with the column                 -> 15, 16, 17
//     an absent value sorted FIRST instead of last                  -> 17c
//     the opening marker dropped from the cell                      -> 18
//     the renderer stops writing the CPA cell                       -> 19
//     the header repainted on every poll                            -> 20
//     the click listener re-attached on every repaint               -> 20b
//
// AND FOR THE STABILITY PASS + TCPA COLUMN (2026-09-08), twelve more mutations RUN, all
// twelve killed. Andy: "The entire AIS traffic card blinks and resets data with each update.
// Make it visually stable and update values independently... Add TCPA after the CPA column."
//     a contact missing ONE update is removed again (the blink)   -> 6d
//     a contact gone for good is never removed                    -> 6, 6d
//     a held contact is not dimmed, so stale data looks live      -> 6b, 6d
//     a contact that reports again stays faded for ever           -> 6c
//     setCellText replaces the text node instead of editing it    -> 7b
//     setCellText writes unconditionally (kills a selection)      -> 7b
//     the status line goes back to a rebuilt innerHTML            -> 1, 1b
//     the TCPA column is declared but never written               -> 19
//     TCPA placed BEFORE cpa                                      -> 17d
//     a PAST cpa printed as a countdown                           -> 17e
//     holding station given an invented time of zero              -> 17f
//
// AND FOR THE LIST'S OWN ORDER (2026-10-10: "Structure this cards contacts by order of acquisition then do not
// reshuffle..."), twenty-five more mutations RUN on scratch copies, all twenty-five killed. They retired 6-6e (the
// grace sweep: dim on one miss, remove on two) and 21-22b (the 60-row cap), which pinned what he asked to be changed:
//     the server's reports beyond the range are ignored           -> 6l
//     the held query names every contact                          -> 6l
//     the poll does not name the held contacts                    -> 6m
//     the renderer drops the beyond reports                       -> 21
//     a hidden card drops the beyond reports                      -> 6i
//     a removed contact's return asks only whether she reports    -> 6k
//     the x arms her on reporting only, not on being in range     -> 6k
//     newcomers go to the TOP                                     -> 6, 6b, 6d, 6e, 6i, 6f
//     the list re-sorted by range on every update                 -> 6, 6b, 6d, 6i, 6f
//     a contact the feed no longer sends is dropped               -> 6b, 6c, 6j
//     out of range and not reporting swapped                      -> 6b, 6j
//     a live (test) contact beyond the range is not struck        -> 6j
//     the headline counts every live row as in range              -> 21b
//     a removed contact never comes back                          -> 6d, 6e, 6h
//     a removed contact comes back at once, still in range        -> 6d, 6h
//     a drop lands AFTER the row, not before it                   -> 6f
//     the order is not saved                                      -> 6g
//     the renderer sorts the list again                           -> 21
//     a row cap again (first draft of 21 missed it: fixed)        -> 21
//     no red line out of range                                    -> 22b
//     the whole row is draggable                                  -> 22c
//     a hidden card acquires nothing (the FIRST build did this)   -> 6i
//     a poll the feed did not answer arms a removed contact       -> 6h
//     an x pressed while the feed is down arms her                -> 6h
//     any feed state counts as answered                           -> 6h
//     the row template loses a cell (last column silently blank)  -> 19
//
// AND FOR DELETING OUT OF RANGE (Andy, 2026-10-13: "for the AIS card delete the out of range vessels instead of the red
// line solution"), twelve more mutations RUN on sidecar copies, all twelve killed; the shipped red-line page fails
// 6b, 6c, 6i-6l, 21b and 22b. They replaced the red-line rows above ("a live (test) contact beyond the range is not
// struck", "no red line out of range"):
//     no deletion out of range                                    -> 6b, 6c, 6i, 6j, 6k, 6l
//     the row hidden but her place kept (back in her old slot)    -> 6b, 6c, 6i, 6j, 6l
//     the deletion not saved                                      -> 6l
//     her absence alone deletes her                               -> 6b, 6c, 6j, 6k, 6l
//     only a live contact beyond the range deleted                -> 6b, 6c, 6i, 6l
//     only a held contact beyond the range deleted                -> 6j, 6k
//     the server's beyond reports ignored                         -> 6i, 6l
//     a removed contact's return asks only whether she reports    -> 6k
//     the headline counts every row as in range                   -> 21b
//     the headline still says "out of range"                      -> 21b
//     the stripe written on a row again                           -> 22b
//     not reporting no longer dimmed                              -> 22b
// ⚠ "the x arms her on reporting only, not on being in range" (above) now SURVIVES, and is equivalent: the x can only be
// pressed on a row, and every row is in range or not reporting - one reporting from beyond the range has none.
//
// ⚠⚠ AND THE FIRST RUN OF THOSE TWELVE REPORTED 0 KILLED, WHICH WAS THE RUNNER AND NOT THE
// CHECKS. This suite read static/asv.html by a FIXED PATH, so a runner pointing ASV_HTML at a
// sidecar mutated a file the suite never opened and every mutation "survived". Twelve of
// twelve surviving is not twelve weak checks, it is a harness fault - the same shape as the
// `FAIL 17c.` scraper note above. It honors ASV_HTML now.
//
// ⚠ TWO OF THE TWELVE THEN SURVIVED HONESTLY, and both were source-shape checks standing in
// for behaviour. Setting `miss = 2` walked past 6, 6b and 6c with every line they look for
// still present and doing the wrong thing - that is the REPORTED FAULT, unguarded - so 6d
// lifts the real sweep out of renderAisTable and drives it over two updates. And 7b asserted
// `nodeValue === "1.5"` after an unchanged write, which is true whether or not it was
// written; it spies on the setter now.
//
// ⚠ 17c EXISTS BECAUSE A MUTATION FOUND NOTHING TO KILL. Breaking `nullLast` so an absent
// value sorts FIRST left every check green: in the CPA column a contact with no track is
// caught by `cpaRank` before nullLast is ever consulted, so the null handling that actually
// governs the brg and kn columns was not being exercised at all.
//
// ⚠⚠ AND THE RUN THAT FOUND IT FIRST REPORTED "SURVIVED", WRONGLY - because the mutation
// runner's own scraper was `FAIL (\d+b?)\.`, which cannot match `FAIL 17c.`. The check was
// failing correctly and the harness could not see it. A mutation runner that cannot parse
// its own suite's check IDs reports false survivals, which is the most expensive kind of
// wrong: it sends you hunting for a hole in code that does not have one.
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

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

// ASV_HTML points this at a SIDECAR copy for a mutation run. Without it the only way to
// mutate what this suite reads is to edit static/asv.html itself, and a runner killed
// mid-flight then leaves the operator's real source mutated. Worse, a runner that sets
// ASV_HTML against a suite that ignores it reports every mutation as SURVIVED - twelve of
// twelve on 2026-09-08, which is a runner fault wearing the costume of twelve weak checks.
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8");

let fails = 0, ran = 0;
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

function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}

const RENDER = grab("renderAisTable");
const SKELETON = grab("ensureAisSkeleton");
const MAKEROW = grab("aisMakeRow");
// The column list itself, so the column checks are derived from what the page declares
// rather than from a number written here that goes stale the day a column is added.
const HEADCOLS = (() => {
  const i = H.indexOf("const AIS_HEAD_COLS");
  if (i < 0) throw new Error("anchor gone: AIS_HEAD_COLS (renamed?)");
  return H.slice(i, H.indexOf(";", i) + 1);
})();

console.log("AIS traffic list — patched in place, so nothing you are reading is destroyed:");

// 1. THE REPORTED FAULT. An innerHTML assignment anywhere in the per-cycle path throws away
// every row, and with them the scroll position and any selection. The skeleton builder is
// allowed exactly one, which is why it lives in its own function (check 2).
const renderInnerHtml = /\.innerHTML\s*=/.test(RENDER.replace(/statusEl\.innerHTML\s*=/g, ""));
check("1. THE REPORTED FAULT: renderAisTable does not assign innerHTML to the list",
      () => !renderInnerHtml,
      "rebuilding the body every 8 s is what reset the scroll and dropped selections");

// THE STATUS LINE IS NOT REWRITTEN AT ALL ANY MORE. It used to be one guarded innerHTML
// assignment, on the argument that it is short and has nothing selectable to lose - but it
// carries "nearest 0.2 nm", which changes on EVERY update, so the guard never held and the
// headline at the top of the card was re-parsed every 8 s while the rows beneath it were
// being carefully patched. It is three fixed spans now (dot, main, faint note), painted
// through the same setCellText the cells use. Andy, 2026-09-08: "The entire AIS traffic card
// blinks and resets data with each update."
// ⚠ SCOPED TO CODE. Two traps in one line here. A bare /innerHTML/ matched the comment that
// explains what used to be there; narrowing to `.innerHTML =` was not enough either, because
// that comment QUOTES the retired statement verbatim - `statusEl.innerHTML = status` - which
// is exactly what a maintainer needs it to say. So the comments come off first, the way
// off_track does it. `[^\n]*` runs to the true end of the line, \r included: this file is
// CRLF and /\/\/.*$/ without /m cannot reach past the \r.
const RENDER_CODE = RENDER.split("\n").map(l => l.replace(/\/\/[^\n]*/, "")).join("\n");
check("1b. ... and the status line is PATCHED too, never re-parsed",
      () => !/\.innerHTML\s*=/.test(RENDER_CODE)
            && /#aisStMain/.test(RENDER) && /#aisStNote/.test(RENDER)
            && /setCellText\(el\.querySelector\("#aisStMain"\)/.test(RENDER),
      "the one part of the card that was still rebuilt on a timer");

// 2. The furniture is built ONCE, guarded by an existence test - not re-created per poll.
check("2. the skeleton is built once, guarded by a check that it is already there",
      () => /if\s*\(\s*el\.querySelector\("#aisRowsBody"\)\s*\)\s*return;/.test(SKELETON)
            && /\.innerHTML\s*=/.test(SKELETON),
      "one innerHTML, in the builder, behind an early return");

// 3-4. Row identity is what makes the patch possible: without a stable key every row is a
// new node and nothing is preserved.
check("3. rows are keyed by MMSI, so a contact keeps its node between polls",
      () => /tr\.dataset\.mmsi\s*=/.test(RENDER) && /dataset\.mmsi/.test(RENDER),
      "the key is the identity - no key, no reuse");

check("4. an existing row is looked up and REUSED before a new one is made",
      () => /existing\.get\(key\)/.test(RENDER) && /aisMakeRow\(\)/.test(RENDER)
            && /if\s*\(\s*tr\s*\)\s*existing\.delete\(key\)/.test(RENDER),
      "found -> reuse; missing -> create. Creating unconditionally is the old behaviour");

// 5. Sorting by range means the order changes constantly. Moving a node preserves it;
// re-creating it in the new position does not.
check("5. re-sorting MOVES the existing node rather than rebuilding it",
      () => /insertBefore\(tr,\s*body\.children\[i\]/.test(RENDER),
      "insertBefore on a node already in the tree is a move, not a copy");

// 6-6g. THE LIST IS THE LIST'S, NOT THE FEED'S (Andy, 2026-10-10: "The jumpy characteristic of the AIS card has
// returned. Structure this cards contacts by order of acquisition then do not reshuffle. Once a vessel is out of
// selected range, one line through it in red. allow the user to scroll contacts. Allow the user to drag contacts to
// selected position. Like the top position. Allow the user to delete a contact, but bring it back if it comes back
// into range."). It retired the grace sweep these checks used to pin - dim on one missed update, remove on two - and the
// sort re-applied on every update: a contact that leaves the feed inside the range STAYS, dimmed on her last report,
// until the operator removes it. And OUT OF RANGE SHE IS DELETED (Andy, 2026-10-13: "for the AIS card delete the out of
// range vessels instead of the red line solution"): off the list, her place gone, acquired again at the bottom when she
// next reports in range. That retired the red line 6b, 6i-6l, 21b and 22b used to pin.
//   DRIVEN: the page's own aisListUpdate, aisRemove, aisMoveTo, aisSortOnce, saveAisList and the list's state are lifted
// out and fed a sequence of updates, with a stub store, a flat distance (111 km a degree) and a 5 km range. Positions are
// due north of the boat at (0, 0); 0.01 degrees is 1,110 m.
const LIST = (() => {
  const a = H.indexOf("const AIS_LIST_KEY"), b = H.indexOf("})();", H.indexOf("const aisList = (function(){"));
  if (a < 0 || b < 0) throw new Error("anchor gone: the AIS list's state (AIS_LIST_KEY / aisList)");
  return H.slice(a, b + 5);
})();
const listSandbox = (store) => new Function("store", [
  "let aisVessels = [], aisArea = {mode: 'sea', show_km: 5}, renders = 0, aisSort = {key: 'rng', dir: 1}, aisState = 'ok';",
  "let aisBeyondRpts = [];",
  "const lsGet = (k, f) => (k in store ? JSON.parse(store[k]) : f), lsSet = (k, v) => { store[k] = JSON.stringify(v); };",
  "const renderAisTable = () => { renders++; }, aisCenter = () => ({lat: 0, lon: 0}), azTo = () => 0, aisCpa = () => null;",
  "const distTo = (a, b) => Math.hypot(b.lat - a.lat, b.lon - a.lon) * 111000;",
  // the page's renderer, renamed, with its card hidden: what a poll does while the operator has the card closed
  "const $ = (s) => (s === '#aisTablePanel' ? {style: {display: 'none'}} : null);",
  grab("renderAisTable").replace("function renderAisTable(", "function renderHidden("),
  grab("nullLast"), grab("cpaRank"), grab("aisRowCmp"), LIST, grab("aisHeard"), grab("aisBeyond"),
  grab("saveAisList"), grab("aisListUpdate"), grab("aisRemove"), grab("aisMoveTo"), grab("aisSortOnce"),
  grab("aisHeldQuery"),
  "return {",
  // st: the feed's state after the poll (pollAIS): 'ok'/'empty' answered; 'offline', 'error', 'connecting' did not.
  // far: the server's `beyond` - its reports of held contacts it still collects beyond the range
  "  feed: (vs, c = {lat: 0, lon: 0}, st = 'ok', far = []) => { aisVessels = vs; aisState = st; aisBeyondRpts = far;",
  "    return aisListUpdate(vs.map((v) => ({v, rng: distTo(c, v), brg: 0, cpa: null})), c, aisHeard(), aisBeyondRpts); },",
  "  heldQuery: () => aisHeldQuery(),",
  "  hidden: (vs, far = []) => { aisVessels = vs; aisBeyondRpts = far; aisState = 'ok'; renderHidden(); },",
  "  range: (km) => { aisArea = {mode: 'sea', show_km: km}; },",
  "  order: () => aisList.order.slice(), removed: () => [...aisList.removed], remove: aisRemove, move: aisMoveTo,",
  "  sortOnce: () => { aisSort = {key: 'rng', dir: 1}; aisSortOnce(); }, renders: () => renders };",
].join("\n"))(store);
const ship = (mmsi, km) => ({ mmsi, lat: km / 111, lon: 0, name: "SHIP " + mmsi });
const states = (rows) => rows.map((x) => x.k + ":" + x.state).join(" ");
{
  const L = listSandbox({});
  L.feed([ship(1, 3), ship(2, 1)]);                                  // two first seen together: nearest first
  const first = L.order().join(",");
  L.feed([ship(3, 0.5), ship(1, 3), ship(2, 1)]);                    // a third, NEARER than both: still at the bottom
  const second = L.order().join(",");
  L.feed([ship(2, 1), ship(1, 3.2), ship(3, 0.4)]);                  // every range moves: nothing moves in the list
  const third = L.order().join(",");
  check("6. CONTACTS STAND IN THE ORDER THEY WERE ACQUIRED, AND NOTHING THE FEED DOES RESHUFFLES THEM: two first seen "
        + "together go nearest first, a third goes to the bottom however near it is, and moving ranges move no row",
        () => first === "2,1" && second === "2,1,3" && third === "2,1,3",
        () => "after the first update " + first + ", the second " + second + ", the third " + third
            + " (the shipped card sorted by range on every update: 3,2,1)");
  // a contact missing from the feed: DELETED where her last report puts her beyond 5 km from the boat, held on that
  // report, NOT REPORTING, where it does not
  const held = L.feed([ship(2, 1)], { lat: -2.5 / 111, lon: 0 });    // the boat 2.5 km south: 1 at 5.7 km, 3 at 2.9 km
  check("6b. A CONTACT OUT OF RANGE IS DELETED - off the list, her place gone (Andy, 2026-10-13: \"delete the out of range "
        + "vessels instead of the red line solution\") - while one the feed no longer sends INSIDE the range stays on her "
        + "last report, in her place, dimmed as not reporting",
        () => states(held) === "2:live 3:lost" && L.order().join(",") === "2,3",
        () => states(held) + ", order " + L.order().join(",") + " (want 2:live 3:lost, order 2,3; the red-line card kept "
            + "her struck in her place: 2:live 1:out 3:lost)");
  const empty = L.feed([]), down = L.feed([], undefined, "offline");
  check("6c. ... and an EMPTY update (the feeder empties the list on any throw), answered or not, keeps every row in range "
        + "on its last report - her absence alone deletes no one",
        () => states(empty) === "2:lost 3:lost" && states(down) === "2:lost 3:lost" && L.order().join(",") === "2,3",
        () => "answered: " + states(empty) + "; offline: " + states(down) + "; order " + L.order().join(","));
}
{
  // REMOVED, AND BACK WHEN IT COMES BACK INTO RANGE - both ways round
  const L = listSandbox({});
  L.feed([ship(1, 1), ship(2, 2), ship(3, 3)]);
  L.remove("2");                                                     // removed while IN range
  const gone = L.feed([ship(1, 1), ship(2, 2), ship(3, 3)]);         // still in range: stays removed
  const left = L.feed([ship(1, 1), ship(3, 3)]);                     // out of the feed: now it may come back
  const back = L.feed([ship(1, 1), ship(2, 2), ship(3, 3)]);         // back in range: back, at the bottom
  check("6d. A CONTACT THE OPERATOR REMOVES WHILE IN RANGE STAYS OFF THE LIST WHILE IT STAYS IN RANGE, and comes back - "
        + "at the bottom, as a contact acquired again - when it has left the range and come back into it",
        () => !gone.some((x) => x.k === "2") && !left.some((x) => x.k === "2") && L.order().join(",") === "1,3,2"
              && back.some((x) => x.k === "2" && x.state === "live"),
        () => "while in range: " + states(gone) + "; once gone: " + states(left) + "; back: " + states(back));
  L.feed([ship(1, 1), ship(2, 2)]);                                  // 3 leaves the feed: held, not reporting
  L.remove("3");                                                     // removed while NOT in range
  const stillOut = L.feed([ship(1, 1), ship(2, 2)]);
  const reports = L.feed([ship(1, 1), ship(2, 2), ship(3, 3)]);
  check("6e. ... and one removed while out of range (or not reporting) comes back the next time it reports in range",
        () => !stillOut.some((x) => x.k === "3") && reports.some((x) => x.k === "3" && x.state === "live")
              && L.order().join(",") === "1,2,3",
        () => "removed, still out: " + states(stillOut) + "; reporting in range: " + states(reports));
}
{
  // ONLY AN ANSWERED POLL IS NEWS. A failed poll, an erroring feed and the warm-up after the layer comes back on all
  // arrive EMPTY; a contact removed in range has not left it, and must not come back on the next good poll.
  const L = listSandbox({});
  L.feed([ship(1, 1), ship(2, 2)]);
  L.remove("2");
  for (const st of ["offline", "error", "connecting"]) L.feed([], undefined, st);
  const after = L.feed([ship(1, 1), ship(2, 2)]);
  // the acceptance case: a poll the feed DID answer, with her absent, is her leaving - and she comes back
  const M = listSandbox({});
  M.feed([ship(1, 1), ship(2, 2)]);
  M.remove("2");
  M.feed([ship(1, 1)], undefined, "ok");
  const back = M.feed([ship(1, 1), ship(2, 2)]);
  // and an x pressed WHILE the feed is down: her absence from an empty model is not her leaving either
  const N = listSandbox({});
  N.feed([ship(1, 1), ship(2, 2)]);
  N.feed([], undefined, "offline");
  N.remove("2");
  const downX = N.feed([ship(1, 1), ship(2, 2)]);
  check("6h. A REMOVED CONTACT IS NOT BROUGHT BACK BY A POLL THE FEED DID NOT ANSWER (offline, error, warming up: all "
        + "empty), nor when the x was pressed while it was down - and IS by an answered poll with her absent, once she "
        + "reports again",
        () => !after.some((x) => x.k === "2") && !downX.some((x) => x.k === "2")
              && back.some((x) => x.k === "2" && x.state === "live"),
        () => "after failed polls: " + states(after) + " (want no 2); removed while down, then reporting: " + states(downX)
            + " (want no 2); after an answered poll without her: " + states(back));
}
{
  // THE ORDER OF ACQUISITION IS THE CONSOLE'S, NOT THE CARD'S: polls with the card closed still acquire, in order
  const L = listSandbox({});
  L.hidden([ship(1, 3), ship(2, 1)]);
  L.hidden([ship(3, 0.5), ship(1, 3), ship(2, 1)]);
  const order = L.order().join(",");
  // ... and the server's report of one that sailed out while it was closed: deleted with the card closed
  L.hidden([ship(3, 0.5), ship(2, 1)], [ship(1, 6)]);
  const closed = L.order().join(",");
  const opened = L.feed([ship(3, 0.5), ship(2, 1)]);
  check("6i. CONTACTS ACQUIRED WHILE THE CARD IS CLOSED TAKE THEIR PLACE IN THE ORDER OF ACQUISITION (the page's own "
        + "renderer, card hidden): the first two nearest first, the later one below them - and one that sailed out of "
        + "range meanwhile is deleted, card closed or not",
        () => order === "2,1,3" && closed === "2,3" && states(opened) === "2:live 3:live",
        () => "order after two polls with the card closed: '" + order + "' (want 2,1,3; the first build acquired only "
            + "while the card was drawing); after the server reported 1 beyond the range, card closed: '" + closed
            + "' (want 2,3); on opening: " + states(opened));
}
{
  // BEYOND THE RANGE, STILL REPORTING: the server serves the simulator's test contacts wherever they are placed, so a
  // live contact CAN be past the range - and she is not on the list either
  const L = listSandbox({});
  L.feed([ship(1, 1), ship(2, 2)]);
  const rows = L.feed([ship(1, 1), ship(990000001, 7)]);            // 2 held at 2 km; a test contact live at 7 km
  check("6j. A CONTACT REPORTING FROM BEYOND THE RANGE IS NOT ON THE LIST EITHER (a test contact, which the server serves "
        + "wherever it is placed); one live in range is, and one held inside the range is",
        () => states(rows) === "1:live 2:lost" && L.order().join(",") === "1,2",
        () => states(rows) + ", order " + L.order().join(",") + " (want 1:live 2:lost, order 1,2; the red-line card "
            + "struck her: 1:live 2:lost 990000001:live+beyond)");
  // widening the range past her brings her on, at the bottom, while one the operator removed INSIDE the range stays
  // removed through the same widening - she never left it
  L.remove("1");
  const still = L.feed([ship(1, 1), ship(990000001, 7)]);
  L.range(10);
  const wide = L.feed([ship(1, 1), ship(990000001, 7)]);
  // ... and one removed in range that the operator then narrows the range past, still reporting (a test contact), HAS
  // left it: widened again, she is back
  const M = listSandbox({});
  M.feed([ship(1, 1), ship(2, 3)]);
  M.remove("2");
  M.range(2);
  M.feed([ship(1, 1), ship(2, 3)]);
  M.range(5);
  const again = M.feed([ship(1, 1), ship(2, 3)]);
  check("6k. ... and widening the range past her brings her onto the list, at the bottom - she has come into range - while "
        + "one removed inside the range stays removed through the same widening; one removed in range and then put "
        + "beyond a narrowed range has left it, and is back when it is widened again",
        () => states(still) === "2:lost" && states(wide) === "2:lost 990000001:live" && states(again) === "1:live 2:live",
        () => "1 removed, range 5 km: " + states(still) + " (want 2:lost); widened to 10 km: " + states(wide)
            + " (want 2:lost 990000001:live); removed, narrowed past her, widened: " + states(again) + " (want 1:live 2:live)");
}
{
  // ONE THAT SAILS OUT OF RANGE. The server stops sending her in `vessels` the moment she crosses the line, so the
  // card's last report of her is from just INSIDE it - 4.9 km of a 5 km range. Named in `held`, the server reports
  // her beyond it (`beyond`), and she is deleted; without that report she could only read as not reporting.
  const store = {}, L = listSandbox(store);
  L.feed([ship(2, 4.9)]);
  L.feed([ship(2, 4.9), ship(1, 1), ship(3, 2)]);                    // order 2,1,3: she heads the list
  L.feed([ship(1, 1), ship(3, 2)]);                                  // she has crossed: gone from the live set
  const q = L.heldQuery();
  const out = L.feed([ship(1, 1), ship(3, 2)], undefined, "ok", [ship(2, 5.4)]); // the server's report of her, beyond
  const afterOut = L.order().join(","), reloaded = listSandbox(store).order().join(",");
  const back = L.feed([ship(1, 1), ship(3, 2), ship(2, 4.8)]);       // she turns back in: acquired again, at the bottom
  // the control: no report of her beyond the range (she stopped transmitting) - held where she was, not reporting
  const M = listSandbox({});
  M.feed([ship(1, 1), ship(2, 4.9)]);
  const silent = (M.feed([ship(1, 1)]).find((x) => x.k === "2") || {}).state;
  check("6l. A CONTACT THAT SAILS OUT OF RANGE IS DELETED, not dimmed on her last report from just inside the line: the "
        + "card names her in `held`, the server's `beyond` report of her takes her off the list (and that is saved), and "
        + "she comes back AT THE BOTTOM, acquired again, when she turns back in - while one that falls silent inside is "
        + "not reporting",
        () => q === "&held=2" && states(out) === "1:live 3:live" && afterOut === "1,3" && reloaded === "1,3"
              && states(back) === "1:live 3:live 2:live" && silent === "lost",
        () => "held query '" + q + "' (want &held=2); with the server's report: " + states(out) + ", order " + afterOut
            + ", after a reload " + reloaded + " (want 1:live 3:live, 1,3, 1,3); turned back in: " + states(back)
            + " (want 1:live 3:live 2:live); silent inside: " + silent + " (want lost)");
  // the poll is what carries it: `held` on the request, `beyond` off the answer, and nothing left over from a failure
  const POLL = grab("pollAIS");
  check("6m. ... and the poll is what carries it: the request names the held contacts (aisHeldQuery), the answer's "
        + "`beyond` is kept apart from aisVessels (the guard's model), and a failed poll clears it",
        () => /\/api\/ais\?center=[^`]*\$\{aisHeldQuery\(\)\}`/.test(POLL)
              && /aisBeyondRpts = \(d && Array\.isArray\(d\.beyond\)\) \? d\.beyond : \[\];/.test(POLL)
              && /catch\(e\)\{[^}]*aisBeyondRpts=\[\];/.test(POLL) && !/aisVessels[^;\n]*d\.beyond/.test(POLL),
        "pollAIS: " + POLL.slice(POLL.indexOf("const r=await fetch"), POLL.indexOf("const r=await fetch") + 110));
}
{
  // THE OPERATOR'S ORDER: dragged to the top, and once by a header click - and kept across a reload
  const store = {}, L = listSandbox(store);
  L.feed([ship(1, 1), ship(2, 2), ship(3, 3)]);
  L.move("3", "1");                                                  // dragged above the first: to the top
  const dragged = L.order().join(",");
  L.move("1", null);                                                 // dropped below the last
  const bottom = L.order().join(",");
  L.feed([ship(1, 1), ship(2, 2), ship(3, 3)]);
  const held = L.order().join(",");
  L.sortOnce();                                                      // a header click (range, ascending)
  const sorted = L.order().join(",");
  L.feed([ship(4, 0.2), ship(1, 1), ship(2, 2), ship(3, 3)]);        // a new and nearest contact: NOT sorted in
  const after = L.order().join(",");
  const reloaded = listSandbox(store).order().join(",");
  check("6f. THE OPERATOR SETS THE ORDER: a contact dragged to the top stays there, and to the bottom stays there; a "
        + "header click sorts the list ONCE - a newer, nearer contact still joins at the bottom",
        () => dragged === "3,1,2" && bottom === "3,2,1" && held === "3,2,1" && sorted === "1,2,3" && after === "1,2,3,4",
        () => "dragged to the top " + dragged + ", one to the bottom " + bottom + ", after an update " + held
            + ", sorted by range once " + sorted + ", then a nearer newcomer " + after);
  check("6g. ... and the order and the removals are the operator's across a reload (lsGet/lsSet, not the page's memory)",
        () => reloaded === after,
        () => "after a reload: " + reloaded + " (before it: " + after + ")");
}

// 7. BEHAVIOURAL. Writing an identical string to a text node still collapses a selection
// inside it, so the guard is not an optimisation - it is the reason a selection survives a
// poll where nothing about that row changed.
eval(grab("setCellText"));
const writes = [];
const fakeNode = { _t: "1.5", get textContent() { return this._t; },
                   set textContent(v) { writes.push(v); this._t = v; } };
setCellText(fakeNode, "1.5");                       // unchanged - must not write
setCellText(fakeNode, "6.9");                       // changed - must write
setCellText(null, "x");                             // a missing cell must not throw
check("7. a cell is written ONLY when its text changed",
      () => writes.length === 1 && writes[0] === "6.9" && fakeNode.textContent === "6.9",
      () => "writes: " + JSON.stringify(writes) + " (an identical write still kills a selection)");

// 7b. BEHAVIOURAL, and the other half of "update values independently". `textContent = s`
// DESTROYS the cell's text node and creates a new one, so every changed cell was a
// remove-plus-add in the DOM even though the ROW was correctly reused. Measured on a
// six-contact feed before the fix: 51 node removals and 51 insertions across three updates,
// with ZERO characterData mutations. After it: 6 and 6, with 71 characterData edits - the
// same values, written in place. This drives the real function against a node that HAS a
// text child, which is the case the shipped page always presents.
{
  // ⚠ nodeValue IS SPIED ON, not merely read back. Asserting `tnode.nodeValue === "1.5"`
  // after an unchanged write proves nothing - writing the same string leaves it looking
  // identical - so a mutation dropping the guard on THIS branch survived. The setter records
  // every write, which is the only way to see a write that changed nothing.
  const replaced = [], nvWrites = [];
  const tnode = { nodeType: 3, _v: "1.5",
                  get nodeValue() { return this._v; },
                  set nodeValue(v) { nvWrites.push(v); this._v = v; } };
  const cell = { firstChild: tnode, _t: "1.5",
                 get textContent() { return this._t; },
                 set textContent(v) { replaced.push(v); this._t = v; } };
  setCellText(cell, "1.5");                          // unchanged - nothing at all
  const untouched = nvWrites.length === 0 && replaced.length === 0;
  setCellText(cell, "6.9");                          // changed - EDIT, do not replace
  check("7b. ...and it EDITS the text node rather than replacing it",
        () => untouched && tnode.nodeValue === "6.9"
              && nvWrites.length === 1 && replaced.length === 0,
        () => "nodeValue writes: " + JSON.stringify(nvWrites)
              + ", textContent assignments: " + replaced.length
              + " (a textContent write is a node remove + add, and the browser relays out the cell)");
}

// 8. The row template must carry the two spans the patch addresses, or the cell writes
// silently target nothing - setCellText tolerates a missing node, so this would not throw.
check("8. the row template provides the marker and name spans the patch writes to",
      () => /class="aisMk"/.test(MAKEROW) && /class="aisNm"/.test(MAKEROW)
            && /querySelector\("\.aisNm"\)/.test(RENDER) && /querySelector\("\.aisMk"\)/.test(RENDER),
      "setCellText ignores a null node, so a typo here would fail silently");

// --- AIS CONTACTS: the same glyph as our own boat, in the operator's colours ----------
// Andy, 2026-08-28: "it will be an isosceles triangle with the sharp end pointed toward
// the line of travel. green for cargo vessels, grey for military, blue for fishing, black
// for tug or tug and tow and pink for sailing."
{
  const H2 = require("fs").readFileSync(ASV_HTML, "utf8");   // the same page as above
  const grabDecl2 = (name) => {
    for (const kw of ["const ", "let "]) {
      const i = H2.indexOf(kw + name + " =");
      if (i >= 0) return H2.slice(i, H2.indexOf("};", i) + 2);
    }
    throw new Error("test setup: " + name + " not found (renamed?)");
  };
  // eval it as an EXPRESSION: `const` inside a direct eval is lexical to that eval,
  // so declaring it there leaves the name here undefined (the same trap twice today).
  const AIS_COL = eval("(" + grabDecl2("AIS_COL")
        .replace(/^const\s+AIS_COL\s*=\s*/, "").replace(/;\s*$/, "") + ")");
  const hex = (c) => String(c || "").toLowerCase();
  const lum = (c) => { const n = parseInt(hex(c).slice(1), 16);
    return (0.2126*((n>>16)&255) + 0.7152*((n>>8)&255) + 0.0722*(n&255)) / 255; };

  // 10. THE FIVE THE OPERATOR NAMED. Asserted by HUE, not by matching a hex string: the
  // requirement is "green", not "#3fbf6b", and pinning the literal would make a legibility
  // tweak within the same colour read as a regression.
  const isGreen = (c)=>{ const n=parseInt(hex(c).slice(1),16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return g > r + 40 && g > b + 40; };
  const isBlue  = (c)=>{ const n=parseInt(hex(c).slice(1),16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return b > r + 40 && b >= g; };
  const isPink  = (c)=>{ const n=parseInt(hex(c).slice(1),16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return r > 180 && b > 140 && g < r - 40; };
  const isGrey  = (c)=>{ const n=parseInt(hex(c).slice(1),16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return Math.max(r,g,b) - Math.min(r,g,b) < 24 && lum(c) > 0.4; };
  const isBlack = (c)=> lum(c) < 0.15;
  check("10. cargo is GREEN, military GREY, fishing BLUE, tug BLACK, sailing PINK",
        isGreen(AIS_COL.cargo) && isGrey(AIS_COL.military) && isBlue(AIS_COL.fishing)
        && isBlack(AIS_COL.tug) && isPink(AIS_COL.sailing),
        "cargo " + AIS_COL.cargo + ", military " + AIS_COL.military + ", fishing "
        + AIS_COL.fishing + ", tug " + AIS_COL.tug + ", sailing " + AIS_COL.sailing);

  // 11. NO TWO CATEGORIES SHARE A COLOUR. Two ship types the same colour on a crowded
  // harbour is the same as having no colour scheme - and adding the operator's five DID
  // collide with what was there (passenger held the green, hsc a pink close to sailing's).
  {
    const seen = new Map(), dupes = [];
    for (const k of Object.keys(AIS_COL)) {
      if (k === "unknown") continue;                 // deliberately shares `other`'s grey
      const c = hex(AIS_COL[k]);
      if (seen.has(c)) dupes.push(seen.get(c) + "/" + k); else seen.set(c, k);
    }
    check("11. no two ship categories are drawn the same colour",
          dupes.length === 0, dupes.length ? dupes.join(", ") : Object.keys(AIS_COL).length + " categories");
  }

  // 12. A BLACK HULL ON A NEAR-BLACK CHART NEEDS A LIGHT EDGE, or the tug is invisible.
  // The outline is picked from the fill's luminance rather than fixed, so this holds for
  // any colour added later - which is why it is asserted through the real function.
  {
    // the eval brings its OWN `function glyphOutline` declaration into this scope,
    // so declaring one here as well is a redeclaration - let the source provide it
    eval((()=>{ const i=H2.indexOf("function glyphOutline(");
      let k=H2.indexOf("{", i), d=0; for(;;){ const c=H2[k]; if(c==="{")d++; else if(c==="}"){d--; if(!d)break;} k++; }
      return H2.slice(i, k+1); })());
    const onTug = glyphOutline(AIS_COL.tug), onGrey = glyphOutline(AIS_COL.military);
    check("12. a dark hull gets a LIGHT outline and a light hull a dark one",
          lum(onTug.match(/\d+/g) ? "#ffffff" : onTug) > 0.5 || /2[0-9]{2}/.test(onTug),
          "tug outline " + onTug + " | military outline " + onGrey);
    check("12b. ... and they are not the same outline, or the rule is doing nothing",
          onTug !== onGrey, onTug + " vs " + onGrey);
  }

  // 13. THE CONTACT IS DRAWN BY THE SAME GLYPH AS OUR OWN VESSEL. One shape, one idea of
  // which way forward is; a second triangle drawn inline would be free to disagree.
  check("13. AIS contacts use the shared vessel glyph, scaled - not their own shape",
        /drawVesselGlyph\(ctx, s\.x, s\.y,[^)]*0\.62\)/.test(H2)
        && !/moveTo\(0,-7\); ctx\.lineTo\(5,6\)/.test(H2),
        "the old inline dart is gone and the shared glyph is called");
}


// ── 14-18. THE CPA COLUMN, AND WHY IT IS NOT SORTED AS A NUMBER ─────────────────────
//
// Andy, 2026-09-02: "add CPA as a sortable column on the AIS table."
//
// ⚠⚠ THE TRAP IS THAT CPA LOOKS LIKE A NUMBER AND MUST NOT BE ORDERED LIKE ONE. A contact
// that passed 10 m astern a minute ago has a SMALLER closest approach than a ship closing
// to 400 m, and a plain ascending sort puts it at the head of the list — which is exactly
// backwards for the one job a collision-ordered table has. The order is by STATE first
// (closing, then holding station, then opening, then no track) and by distance only within
// a state; and the state rank is NOT reversed when the column is, because "sort descending"
// must never promote a vessel that is leaving. Checks 14 and 15 are that rule from both
// sides, and the fixture's opening contact deliberately holds the smallest CPA in the set.
{
  eval(grab("cpaRank"));
  eval(grab("nullLast"));
  eval(grab("cpaCell"));
  // aisRowCmp closes over `aisSort` and `fmtDist`, both module state in the page. Give the
  // eval'd body its own rather than reaching into the real ones.
  let aisSort = { key: "cpa", dir: 1 };
  const fmtDist = (m) => (m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km");
  eval(grab("aisRowCmp"));

  const R = (name, cpaM, tcpaS, closing) => ({
    v: { mmsi: name.length, name, sog: 5, cog: 90 }, rng: 100, brg: 90,
    cpa: cpaM == null ? null : { cpaM, tcpaS, closing, rangeM: 500, bearingDeg: 0 },
  });
  const CLOSE_NEAR = R("closing near", 334, 100, true);
  const CLOSE_FAR = R("closing far", 398, 260, true);
  const HOLDING = R("holding", 879, null, false);
  const OPENING = R("opening", 10, -40, false);        // the smallest number in the set
  const NOTRACK = R("no track", null);
  const order = (dir) => {
    aisSort = { key: "cpa", dir };
    return [OPENING, NOTRACK, HOLDING, CLOSE_FAR, CLOSE_NEAR].slice()
      .sort(aisRowCmp).map((r) => r.v.name);
  };
  const asc = order(1), desc = order(-1);

  check("14. a closing contact outranks one already opening, however small its CPA",
        () => asc.indexOf("opening") > asc.indexOf("closing far"),
        "ascending: " + asc.join(" < ") + "   (opening's CPA is 10 m, the smallest here)");
  check("15. ... and REVERSING the column does not promote it",
        () => desc.indexOf("opening") > desc.indexOf("closing near") && desc[0] === "closing far",
        "descending: " + desc.join(" < ") + "   (state rank is not reversed; distance is)");
  check("16. within the closing contacts the direction DOES reverse",
        () => asc[0] === "closing near" && desc[0] === "closing far",
        "asc heads with " + asc[0] + ", desc heads with " + desc[0]);
  check("17. a contact with no track sorts LAST whichever way the column points",
        () => asc[asc.length - 1] === "no track" && desc[desc.length - 1] === "no track",
        "an absence is not a small number: asc ends " + asc[asc.length - 1]
          + ", desc ends " + desc[desc.length - 1]);
  check("17b. ... and holding-station sits between the closing and the opening",
        () => asc.indexOf("holding") > asc.indexOf("closing far")
              && asc.indexOf("holding") < asc.indexOf("opening"),
        "converging on nothing, but not leaving either: " + asc.join(" < "));
  // ⚠ 17c EXISTS BECAUSE A MUTATION FOUND NOTHING TO KILL. Breaking `nullLast` so an
  // absent value sorts FIRST left every check above GREEN - because in the CPA column a
  // contact with no track is caught by `cpaRank` before nullLast is ever consulted. The
  // null handling actually governs the OTHER columns, where there is no state rank in
  // front of it, and nothing was exercising them at all.
  {
    const withSog = (n, sog) => ({ v: { mmsi: n, name: n, sog }, rng: 100, brg: sog, cpa: null });
    const rows = [withSog("none", null), withSog("fast", 12), withSog("slow", 3)];
    const by = (key, dir) => { aisSort = { key, dir };
      return rows.slice().sort(aisRowCmp).map((r) => r.v.name); };
    check("17c. an absent SPEED or BEARING also sorts last, in both directions",
          () => by("sog", 1)[2] === "none" && by("sog", -1)[2] === "none"
                && by("brg", 1)[2] === "none" && by("brg", -1)[2] === "none",
          "kn asc " + by("sog", 1).join(" < ") + " | kn desc " + by("sog", -1).join(" < ")
            + "   (these columns have no state rank in front of nullLast)");
  }
  // 17d-17f. THE TCPA COLUMN (Andy, 2026-09-08: "Add TCPA after the CPA column"). The time
  // to closest approach used to ride only in the row's hover title, so the one number that
  // says HOW LONG YOU HAVE was the one you had to hover to read.
  {
    eval(grab("tcpaFmt"));
    eval(grab("tcpaCell"));
    check("17d. TCPA is its own column, placed AFTER cpa",
          () => { const cols = (HEADCOLS.match(/\["(\w+)"/g) || []).map(s => s.slice(2, -1));
                  return cols.indexOf("tcpa") === cols.indexOf("cpa") + 1; },
          () => "columns: " + (HEADCOLS.match(/\["(\w+)"/g) || []).map(s => s.slice(2, -1)).join(" "));

    // ⚠ THE SIGN IS CARRIED, NOT CLAMPED - cpaOf documents tcpaS as NEGATIVE when the closest
    // approach is already past. Printing a past CPA as a countdown is the one wrong answer
    // that reads exactly like a working alarm, which is the same rule check 18 keeps for the
    // distance cell one column over.
    check("17e. a CLOSING contact counts down, an OPENING one reads negative",
          () => tcpaCell({cpaM: 300, tcpaS: 136, closing: true}) === "2m16s"
                && tcpaCell({cpaM: 300, tcpaS: -84, closing: false}) === "-84s",
          () => "closing -> '" + tcpaCell({cpaM:300,tcpaS:136,closing:true}) + "', opening -> '"
                + tcpaCell({cpaM:300,tcpaS:-84,closing:false}) + "'");

    check("17f. holding station has NO time, and says so rather than inventing one",
          () => tcpaCell({cpaM: 500, tcpaS: null, closing: false}) === "–"
                && tcpaCell(null) === "–",
          "a vessel converging on nothing has no moment of closest approach");
  }

  check("18. the cell MARKS a contact already opening, so its number is not misread",
        () => /↗/.test(cpaCell(OPENING.cpa)) && !/↗/.test(cpaCell(CLOSE_NEAR.cpa))
              && cpaCell(null) === "–",
        "opening -> '" + cpaCell(OPENING.cpa) + "', closing -> '" + cpaCell(CLOSE_NEAR.cpa)
          + "', no track -> '" + cpaCell(null) + "'");
}

// ── 19-20. THE COLUMN EXISTS, AND THE HEADER IS STILL NOT REBUILT EVERY POLL ────────
{
  const cells = (MAKEROW.match(/<td /g) || []).length;
  // The template, the renderer and the HEADER must all agree on how many columns there are,
  // or `tr.cells[n]` is undefined, setCellText silently writes nothing, and the whole column
  // is blank with every other check in this file still green.
  //
  // ⚠ DERIVED FROM AIS_HEAD_COLS, NOT HARD-CODED. This read `cells === 5` and asserted
  // `tr.cells[4]` by name, so adding the TCPA column on 2026-09-08 turned it red for a reason
  // that had nothing to do with a fault - and the column after that would have done the same.
  // It counts the DECLARED columns and requires the renderer to write every data cell, so
  // what goes red now is a column added to the header and forgotten in the renderer.
  const declared = (HEADCOLS.match(/\["/g) || []).length;
  const written = [];
  for (let i = 1; i < declared; i++)
    if (new RegExp("setCellText\\(tr\\.cells\\[" + i + "\\]").test(RENDER)) written.push(i);
  // (the template has one cell more than the header declares: the x that removes a contact, 2026-10-10)
  check("19. the row template, the header and the renderer agree on the columns",
        () => cells === declared + 1 && /class="aisDel"/.test(MAKEROW) && written.length === declared - 1,
        declared + " columns declared, " + cells + " cells in the template, renderer writes "
          + (written.length ? "cells[" + written.join("], cells[") + "]" : "none")
          + "  (cell 0 is the name, written through .aisNm)");
  // This card is PATCHED, never rebuilt — checks 1-9. The header is the one part that IS
  // re-rendered, so it is gated on the sort having actually moved: repainting it every 8 s
  // would fight the operator for the very click they are making on it.
  const HEAD = grab("aisPaintHead");
  check("20. the header is repainted only when the sort MOVES, not on every poll",
        () => /!aisRebuildHead\) return;/.test(HEAD) && /aisRebuildHead = false;/.test(HEAD),
        "gated on aisRebuildHead, which only the skeleton builder sets now - a click sorts the list once and the "
          + "header carries no arrow claiming an order the list is not kept in");
  check("20b. ... and its click listener is bound ONCE, not re-attached on every repaint",
        () => /row\.dataset\.bound/.test(HEAD),
        "a listener attached per repaint leaks one handler per sort click");
}


// ── 21-22. NO CAP, NO SORT ON AN UPDATE, AND A HEADLINE THAT COUNTS WHAT IT SHOWS (2026-10-10) ──
//
// The card drew at most AIS_MAX_ROWS (60) rows of a list re-sorted on every update. In the order of acquisition a cap cuts
// the NEWEST contact, and the re-sort was the jump Andy reported ("The jumpy characteristic of the AIS card has
// returned"); the list scrolls instead (#aisTableBody, max-height:46vh). The headline counts the rows by what they are.
{
  const R = RENDER.split("\n").map((l) => l.replace(/\/\/[^\n]*/, "")).join("\n");
  check("21. THE LIST IS NOT SORTED ON AN UPDATE AND NOT CUT: no comparator, no row cap - the rows are the list's, "
        + "drawn in its own order",
        () => !/\.sort\(/.test(R) && !/AIS_MAX_ROWS|(?<!nm)\.slice\(0,/.test(R) && /aisListUpdate\(live, c, aisHeard\(\), aisBeyondRpts\)/.test(R)
              && /list\.forEach\(\(x, i\) =>/.test(R) && /max-height:46vh;overflow:auto/.test(H),
        "a sort on every update is the jump; a cap cuts the newest contact in the order of acquisition");
  const at = R.indexOf("const nIn = "), end = R.indexOf("// STATUS LINE", at);
  const heldSrc = RENDER.slice(RENDER.indexOf("const nIn = "), RENDER.indexOf("const held = "))
                + RENDER.slice(RENDER.indexOf("const held = "), RENDER.indexOf("\n", RENDER.indexOf("const held = ")));
  const main = RENDER.slice(RENDER.indexOf("stMain=`${nIn}"), RENDER.indexOf("stNote=[srcLbl, nearest"));
  const headline = (list) => new Function("list", "aisAreaLabel",
    heldSrc + "\nlet stMain;" + main + "return stMain;")(list, () => "5 nm");
  // two live in range and one not reporting - out of range there is no row (aisListUpdate deletes her, 6b, 6i-6l)
  const L = [{ state: "live" }, { state: "live" }, { state: "lost" }];
  const h = at < 0 ? null : headline(L), one = at < 0 ? null : headline([{ state: "live" }]);
  check("21b. ... and the headline counts what is drawn, by what it is: in range, not reporting - and no 'out of range', "
        + "since out of range there is no row",
        () => h === "2 vessels in 5 nm · 1 not reporting" && one === "1 vessel in 5 nm" && !/out of range/.test(heldSrc),
        () => "two live, one dimmed -> \"" + h + "\"; one live -> \"" + one + "\" (want 2 in / 1 not reporting)");
  // 22. ONLY A ROW NO LONGER IN THE LIST IS REMOVED - the one removal left in the renderer; the list drops a contact on
  // the operator's x or out of range, and keeps every other it has seen (6b-6e)
  check("22. the only row the renderer removes is one no longer in the list - the operator's x, or a contact deleted out "
        + "of range",
        () => /for\(const tr of existing\.values\(\)\) tr\.remove\(\);/.test(R)
              && (R.match(/\.remove\(\)/g) || []).length === 1,
        "the shipped card removed a row on its second missed update");
  // 22b. NO RED LINE (Andy, 2026-10-13: "delete the out of range vessels instead of the red line solution") - and the
  // dim, written on a change of state only (an unchanged row is not touched)
  check("22b. ... no red line any more: no stripe written on a row and its constant gone; not reporting is dimmed, written "
        + "only when the row's state changes",
        () => !/backgroundImage/.test(R) && !/AIS_OUT_LINE/.test(H) && /if\(tr\.dataset\.state !== x\.state\)\{/.test(R)
              && /tr\.style\.opacity = x\.state === "lost" \? "0\.45" : ""/.test(R),
        "out of range she is off the list (6b), so there is nothing to strike");
  // 22c. THE OPERATOR'S HANDS: bound ONCE, in the skeleton builder behind its early return
  check("22c. the x and the drag are delegated on the list body and bound once, with the skeleton - and only a row's "
        + "GRIP drags, so the rest of the row stays selectable",
        () => /addEventListener\("click"/.test(SKELETON) && /\.aisDel/.test(SKELETON) && /addEventListener\("dragstart"/.test(SKELETON)
              && /addEventListener\("drop"/.test(SKELETON) && /\.aisGrip/.test(SKELETON)
              && /class="aisGrip" draggable="true"/.test(MAKEROW) && !/<tr[^>]*draggable/.test(MAKEROW),
        "a listener per repaint would leak one handler per update; a draggable row cannot have its text selected");
}

// ── 23. WHICH WAY THE LAYER DRAWS A SHIP: THE KEEP-OUT'S RULE, NOT HER COURSE (Andy, 2026-09-30, at the Port of Los
//        Angeles: "The red outlines are perfectly alongside their respective pier as expected, while the green targets
//        are rotated.") The page's own drawAIS, with the three shapes it can draw spied on - which shape, at which
//        angle - and every rotation it makes itself (the speed stalk). The contacts are his feed round Pier 300. ──────
{
  const KO = require(process.env.ASV_AIS_KEEPOUT || path.join(__dirname, "..", "static", "js", "ais_keepout.js"));
  const { hullBox } = require("../static/js/targets.js");
  const drawn = [], stalks = [];
  const ctxStub = { save() {}, restore() {}, translate() {}, rotate(a) { stalks.push(Math.round(a * 180 / Math.PI * 10) / 10); },
                    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, fillText() {}, arc() {}, closePath() {},
                    setLineDash() {}, globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textBaseline: "" };
  const glyphDecl = (H.match(/^const GLYPH_FWD = [^;]*;/m) || [""])[0];
  const make = new Function("ctx", "aisShow", "aisVessels", "AIS_COL", "aisMotion", "aisDiscM", "aisPolledAt", "hullBox",
                            "center", "zoom", "aisNote", "drawHullToScale", "drawVesselGlyph", "drawHullDisc",
                            glyphDecl + "\n" + grab("drawAIS") + "\nreturn drawAIS;");
  const at = { lat: 33.737, lon: -118.2669 };
  const fleet = [
    { ...at, mmsi: 1, name: "CMA CGM AMAZON", cat: "cargo", sog: 0.0, cog: 327.5, heading: 251, nav: 5, length: 366, beam: 48 },
    { ...at, mmsi: 2, name: "CABRILLO", cat: "tug", sog: 0.0, cog: 223.0, heading: null, nav: 0, length: 30, beam: 10 },
    { ...at, mmsi: 3, name: "UNDER WAY", cat: "cargo", sog: 8, cog: 90, heading: null, nav: 0, length: 100, beam: 20 },
    { ...at, mmsi: 4, name: "CRABBING", cat: "cargo", sog: 12, cog: 95, heading: 88, nav: 0, length: 100, beam: 20 },
    { ...at, mmsi: 5, name: "NO SIZE", cat: "tug", sog: 0.0, cog: 12.0, heading: 170, nav: 5 },
    { ...at, mmsi: 6, name: "DRIFTER", cat: "cargo", sog: 0.6, cog: 40.0, heading: 200, nav: 5, length: 50, beam: 10 },   // moored: 0.6 kn of fix noise
  ];
  const drawAIS = make(ctxStub, true, fleet, { cargo: "#3c3", tug: "#333", unknown: "#999" }, KO.aisMotion, KO.aisDiscM, 0, hullBox,
                       { lat: at.lat }, 15, "",
                       (c, x, y, course) => drawn.push(["hull", course]),
                       (c, x, y, course) => drawn.push(["glyph", course]),
                       (c, x, y, col, rPx) => drawn.push(["disc", Math.round(rPx * 10) / 10]));
  const realNow = Date.now; Date.now = () => 0;
  try { drawAIS(() => ({ x: 100, y: 100 })); } finally { Date.now = realNow; }
  const shapes = drawn.map(d => d[0] + (d[0] === "disc" ? "" : "@" + d[1])).join(", ");
  check("23. the AIS layer points each ship by the KEEP-OUT'S rule: the moored AMAZON along her heading 251 (not her course noise 327.5), the stopped CABRILLO with no heading as a DISC (not along 223), a ship under way with no heading along her course, a crabbing one along her heading 88, a moored glyph along her heading 170, a moored ship whose fix wanders at 0.6 kn along her heading 200",
        () => shapes === "hull@251, disc, hull@90, hull@88, glyph@170, hull@200",
        () => "drawn: " + shapes);
  check("23b. ... and the speed stalk alone follows the COURSE, and only for a ship under way: 90 and 95 - none for the four that are stopped, the moored one whose fix wanders at 0.6 kn included",
        () => JSON.stringify(stalks) === JSON.stringify([90, 95]),
        () => "stalk rotations " + JSON.stringify(stalks));
  // 23d. THE KEEP-OUTS ARE DRAWN OVER THE SHIPS: pointed by one rule, a moored ship's hull lies exactly on her red
  // outline, and drawn first the outline was painted over by it - her keep-out disappeared from the chart.
  const RENDER_ALL = grab("render");
  const iShips = RENDER_ALL.indexOf("drawAIS(toScreen);"), iKo = RENDER_ALL.indexOf("drawAisKeepouts(toScreen);");
  check("23d. ... and the red keep-outs are drawn AFTER the ships, so a moored ship's outline - now lying exactly on her hull - is not painted over by it",
        () => iShips > 0 && iKo > iShips,
        () => "render(): drawAIS at " + iShips + ", drawAisKeepouts at " + iKo);
  // 23e. THE HOVER TIP SAYS WHICH WAY SHE IS DRAWN, AND WHY - the page's own updateAisTip
  const tipEl = { style: {}, innerHTML: "" };
  const makeTip = new Function("aisShow", "dragging", "patDrag", "boundDrag", "searchDrag", "wpDrag", "roseDrag", "aisAt",
                               "aisTypeLabel", "fmtHullM", "aisCpa", "cpaText", "aisMotion", "aisPolledAt", "$",
                               grab("updateAisTip") + "\nreturn updateAisTip;");
  const tipFor = (v) => {
    const f = makeTip(true, false, false, null, false, false, false, () => v, () => "cargo", (m) => m + " m", () => null,
                      () => "", KO.aisMotion, 0, () => tipEl);
    const was = Date.now; Date.now = () => 0;
    try { f({ clientX: 10, clientY: 10 }); } finally { Date.now = was; }
    return tipEl.innerHTML;
  };
  const tA = tipFor({ ...fleet[0], age: 0 }), tC = tipFor({ ...fleet[1], age: 0 }), tU = tipFor({ ...fleet[2], age: 0 });
  check("23e. ... and the hover tip says which way she is drawn and why: along her heading (AMAZON, her course marked as noise while she is stopped), as a circle with no heading (CABRILLO), along her course under way (no noise mark)",
        () => /Drawn along her heading, 251°/.test(tA) && /COG 328° \(noise while she is stopped\)/.test(tA)
              && /drawn as a circle: she can lie any way round/.test(tC)
              && /Drawn along her course, 90° — under way, no heading reported/.test(tU) && !/noise while she is stopped/.test(tU),
        () => "AMAZON: " + tA.replace(/<br>/g, " | ").slice(0, 170) + " || UNDER WAY: " + tU.replace(/<br>/g, " | ").slice(0, 120));
  const tip = (H.match(/id="aisBtn" title="([^"]*)"/) || [])[1] || "";
  check("23c. ... and the AIS button says it in words: the bow, the heading, the course only while under way, the circle, and that the red outline is the guard's keep-out by the same rule - not the old 'Triangles point along course' or 'Situational awareness only'",
        () => /points the way her BOW does/.test(tip) && /course over the ground only while she is under way/.test(tip)
              && /dashed circle/.test(tip) && /KEEP-OUT/.test(tip) && !/Triangles point along course/.test(tip)
              && !/Situational awareness only/.test(tip),
        () => "title: " + tip.slice(0, 160));
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
