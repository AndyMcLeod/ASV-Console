// tests/ui_tooltips.js - a hover tip the pointer can never occlude.
//
// Andy: every informational popup was partially hidden under the pointer. Those were
// NATIVE title tooltips - drawn by the browser, positioned by the browser, not the
// page's to move. So static/asv.html now carries ONE delegated layer (#uiTip) that
// takes over from [title]: on hover the title is STASHED off the element (suppressing
// the native tip) and the text is shown anchored to the ELEMENT - below its left edge,
// flipped ABOVE when the bottom would clip, clamped to the viewport - so the pointer,
// sitting on the control, sits on the tip never. Verified live before these checks:
// stash, placement, no-overlap, bottom-edge flip, restore, and the mid-hover-writer
// guard all measured in a browser.
//
// TEETH - five mutations RUN against static/asv.html, 5/5 caught (recorded results):
//   * tipPos loses its bottom-edge flip            -> caught by 2
//   * tipPos loses its horizontal clamp            -> caught by 3
//   * the stash stops suppressing the native tip
//     (title left in place)                        -> caught by 5
//   * the restore stops guarding for a mid-hover
//     writer (unconditional restore)               -> caught by 6
//   * the delegation loses its stay-inside guard
//     (moving across a control's children kills
//     the tip)                                     -> caught by 7
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

// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes
// its mutants to a file this suite never reads and scores every one as SURVIVED (audited
// 2026-09-21: 21 of the 53 suites reading this page had no override).
const H = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");

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

console.log("Hover tips — anchored to the control, never under the pointer:");

// The REAL constants, parsed out of the page - a copied value here would drift.
const GAP = +(H.match(/TIP_GAP = (\d+)/) || [])[1];
const MARGIN = +(H.match(/TIP_MARGIN = (\d+)/) || [])[1];
const tipPos = new Function("TIP_GAP", "TIP_MARGIN", grab("tipPos") + "; return tipPos;")(GAP, MARGIN);
const R = (l, t, w, h) => ({left: l, top: t, right: l + w, bottom: t + h});

// 1. The default: below the control, aligned to its left edge, with the gap.
check("1. the tip hangs BELOW the control - where the pointer, on the control, cannot be",
      () => {
        const p = tipPos(R(100, 50, 80, 20), 200, 60, 1280, 720);
        return p.left === 100 && p.top === 70 + GAP;
      },
      () => JSON.stringify(tipPos(R(100, 50, 80, 20), 200, 60, 1280, 720)));

// 2. The bottom edge: flip ABOVE, still clear of the control.
check("2. at the bottom edge it flips ABOVE the control",
      () => {
        const p = tipPos(R(100, 690, 80, 20), 200, 60, 1280, 720);
        return p.top === 690 - GAP - 60 && p.top + 60 <= 690;
      },
      "tipBottom 700 <= controlTop 708 - measured live before this check existed");

// 3. The right edge: clamped inside the viewport.
check("3. at the right edge it clamps fully on-screen",
      () => {
        const p = tipPos(R(1250, 50, 20, 20), 300, 60, 1280, 720);
        return p.left === 1280 - 300 - MARGIN && p.left >= 0;
      },
      () => "left=" + tipPos(R(1250, 50, 20, 20), 300, 60, 1280, 720).left);

// 4. A tiny window with no room above OR below: best effort, never negative.
check("4. with no room either side it degrades to below, never off the top",
      () => {
        const p = tipPos(R(10, 30, 80, 20), 200, 200, 1280, 240);
        return p.top >= MARGIN;
      },
      "a tip pushed to negative coordinates is a tip nobody can read");

// 5-7. The mechanism, by source shape.
const MECH = H.slice(H.indexOf("const TIP_DELAY_MS"), H.indexOf("function drawAIS"));
check("5. hover STASHES the title off the element - that is what suppresses the native tip",
      () => /tipStash = text; el\.removeAttribute\("title"\)/.test(MECH),
      "two tips at once (native + ours) would be worse than the bug");
check("6. the restore is GUARDED: a title already back on the element is not overwritten, and no empty words are put back",
      () => /if\(tipStash && !tipEl\.getAttribute\("title"\)\) tipEl\.setAttribute\("title", tipStash\)/.test(MECH),
      "a title written mid-hover is in the stash by then (tipWatch, 13), so the newest words come back");
check("7. moving within the hovered control's children keeps the tip up",
      () => /if\(tipEl && tipEl\.contains\(e\.target\)\) return;/.test(MECH),
      "the title is stashed, so closest('[title]') no longer matches the hovered element itself");
check("8. a mousedown hides the tip - a click means acting, not reading",
      () => /addEventListener\("mousedown", hideUiTip, true\)/.test(MECH),
      "");
// ⚠⚠ 10. DRIVEN: A RUNTIME WRITE DOES NOT RE-ARM THE NATIVE TIP UNDER THE POINTER. Check 6
// holds the restore on LEAVE; this holds the write DURING the hover, which is the half that
// undid the mechanism. Five readouts rewrite their titles at runtime and the suppression
// works by REMOVING the attribute, so a plain `el.title = ...` put it straight back - on
// EVERY state frame for any tip carrying a live value. The fuel pill is the sharp case: its
// tooltip is the only place `endurance_h` and `range_nm` appear at all, so it is a tip the
// operator dwells on, and it was re-attached four times a second while they read it.
// ⚠ THE PAIR IS THE CHECK. The un-hovered element must still get its attribute, or a
// "fix" that simply never wrote a title would pass the first half and take every tooltip on
// the page away.
{
  const mkEl = () => { const a = {}; return {
    title: "", setAttribute(k, v){ a[k] = v; this.title = v; },
    getAttribute(k){ return a[k]; }, removeAttribute(k){ delete a[k]; this.title = ""; } }; };
  const uiTip = { style: { display: "none" }, textContent: "" };
  const $ = () => uiTip;
  let tipEl = null, tipStash = "";
  eval(grab("setTip")); eval(grab("tipSay"));

  const hovered = mkEl(), other = mkEl();
  tipEl = hovered; tipStash = "old text";
  hovered.title = "";                       // the hover has already stashed it away
  setTip(hovered, "new text while hovered");
  const onHovered = { attr: hovered.title, stash: tipStash };

  setTip(other, "written to an element nobody is on");
  const onOther = { attr: other.title, stash: tipStash };

  // ... and a tip that is ON SCREEN follows the value rather than freezing at the hover.
  uiTip.style.display = ""; uiTip.textContent = "old text";
  setTip(hovered, "fresher still");
  const shown = uiTip.textContent;

  check("10. DRIVEN: a runtime title write during a hover goes to the STASH, not back onto "
        + "the element - and an un-hovered element still gets its title",
        () => onHovered.attr === "" && onHovered.stash === "new text while hovered"
              && onOther.attr === "written to an element nobody is on"
              && shown === "fresher still",
        () => "hovered: attribute " + JSON.stringify(onHovered.attr) + " (empty = the native "
            + "tip stays suppressed), stash " + JSON.stringify(onHovered.stash)
            + "; un-hovered: " + JSON.stringify(onOther.attr)
            + "; the shown tip followed the value -> " + JSON.stringify(shown));
}

check("9. the tip element is pointer-transparent and wraps long text",
      () => /id="uiTip"[^>]*pointer-events:none/.test(H) && /id="uiTip"[^>]*max-width:\s*\d+px/.test(H),
      "a tip that catches the mouse would flicker; a nowrap tip would run off-screen");

// -- 11. NOBODY INSIDE THE 4 Hz FRAME WRITES `title` DIRECTLY ---------------------------
// ⚠⚠ CHECK 10 PROVES THE MECHANISM; THIS PROVES IT IS USED. The suppression works by
// REMOVING the title attribute while the element is hovered, so any runtime write puts it
// straight back - and setTip is the one door that does not. The defect this catches is not
// hypothetical: the energy pill's FUEL branch was routed through setTip and given the comment
// "see setTip: not under the pointer", while the BATTERY branch SEVEN LINES BELOW IT, on the
// same pill in the same frame, kept writing `pill.title` directly. The fix landed for a fuel
// vessel and missed every battery one, which is this console's own default hull.
//
// ⚠ SCOPED TO onState's OWN SOURCE, not to a line range, so it follows the function. A tip
// written once at construction cannot be re-armed under a pointer and is not in scope.
{
  const on = grab("onState");
  const direct = (on.match(/[A-Za-z_$][\w$]*\.title\s*=/g) || []);
  check("11. no writer inside the 4 Hz telemetry frame re-arms the native tip - every one "
        + "goes through setTip",
        () => direct.length === 0,
        () => direct.length
                ? direct.length + " direct write(s) in onState: " + direct.join(", ")
                  + " - each re-attaches the native tooltip under the pointer four times a second"
                : "onState writes no title directly; " + (on.match(/setTip\(/g) || []).length
                  + " call(s) go through the guarded writer");
}

// -- 12. ... AND THE PER-FRAME CARDS onState CALLS OUT TO -------------------------------
// ⚠ THE FRAME IS NOT ONLY onState'S OWN BODY. It calls updateRunTime, updateWaterUI and
// updateEnvUI on every telemetry frame, and a tip rewritten in one of those is rewritten just
// as often as one written inline - the run-time tip is a LIVE readout the operator dwells on.
{
  const fns = ["updateRunTime", "updateWaterUI", "updateEnvUI"];
  const bad = [];
  for (const f of fns) {
    const src = grab(f);
    const d = (src.match(/[A-Za-z_$][\w$]*\.title\s*=/g) || []);
    if (d.length) bad.push(f + ": " + d.join(", "));
  }
  check("12. ... and neither do the cards it refreshes on every frame",
        () => bad.length === 0,
        () => bad.length ? bad.join(" | ")
                         : fns.join(", ") + " all write through setTip");
}

// ==== 13-18. DRIVEN: THE TIP HOLDS STEADY UNDER A STILL POINTER (2026-10-14) ================================ //
// Andy: "hovering tool tips flash rather than hold steady so I can read them. Fix this." Measured live on the build
// before the fix, the pointer still for 10 s:
//   * CHART WINDOW: the mission speed readout's title was rewritten 86 times in 8 s by a DIRECT `.title =` write (not
//     setTip), and was back on the hovered element in 107 of 108 samples - the browser's own tip re-armed under the
//     cursor ten times a second;
//   * CONTROLS WINDOW: the mirror replaced the whole Path planning card on each reading change, so the hovered Go
//     button was a NEW element 4 times in 10 s, carrying its title (the browser's tip again) while ours stayed on the
//     node that had gone.
// The fix, each half driven here through the page's OWN code - its whole tooltip layer and its mirror, evaluated
// together over a small DOM:
//   * tipWatch: the hovered control is observed while the pointer is on it; a title written to it - by ANY writer -
//     is taken off before the page is next drawn (the microtask checkpoint, `settle` here) and becomes the tip's words
//     (13-16);
//   * the mirror PATCHES its cards after their first picture (uiMorph): the hovered control is kept, brought up to
//     date (17-18).
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}
function pageWorld() {
  const handlers = {}, timers = [], observers = [], queued = new Set();
  const W = { downs: 0 };
  // #uiTip: counts every time it is taken DOWN while up - a flash is exactly that
  let disp = "none";
  const style = { left: "", top: "" };
  Object.defineProperty(style, "display", { get: () => disp,
    set: v => { if (disp !== "none" && v === "none") W.downs++; disp = v; } });
  const uiTip = { style, textContent: "", get offsetWidth() { return 200; },
                  get offsetHeight() { return this.textContent.length > 40 ? 120 : 40; } };
  W.uiTip = uiTip;
  class MO {
    constructor(cb) { this.cb = cb; this.on = new Set(); this.q = []; observers.push(this); }
    observe(el, o) { this.on.add(el); this.filter = o && o.attributeFilter; }
    disconnect() { this.on.clear(); this.q = []; queued.delete(this); }
  }
  function notify(el, k) {
    for (const o of observers) {
      if (!o.on.has(el) || (o.filter && !o.filter.includes(k))) continue;
      o.q.push({ type: "attributes", target: el, attributeName: k }); queued.add(o);
    }
  }
  // the microtask checkpoint: everything that runs before the browser next paints or hit-tests
  W.settle = () => { for (const o of [...queued]) { queued.delete(o); const q = o.q; o.q = []; if (q.length) o.cb(q, o); } };
  // ---- a small DOM: elements, text, attributes in order, parse and serialize ----
  function detach(n) { if (n.parentNode) { const k = n.parentNode.kids; k.splice(k.indexOf(n), 1); n.parentNode = null; } }
  function Text(v) { const t = { nodeType: 3, nodeValue: v, parentNode: null, remove() { detach(t); } }; return t; }
  function El(tag) {
    const attrs = new Map();
    const el = { nodeType: 1, tagName: tag.toUpperCase(), kids: [], parentNode: null, rect: null,
      get id() { return attrs.get("id") || ""; },
      get attributes() { return [...attrs].map(([name, value]) => ({ name, value })); },
      get childNodes() { return el.kids; },
      get firstElementChild() { return el.kids.find(k => k.nodeType === 1) || null; },
      get isConnected() { let n = el; while (n.parentNode) n = n.parentNode; return n === root; },
      getAttribute: k => (attrs.has(k) ? attrs.get(k) : null), hasAttribute: k => attrs.has(k),
      setAttribute(k, v) { attrs.set(k, String(v)); notify(el, k); },
      removeAttribute(k) { if (attrs.delete(k)) notify(el, k); },
      get title() { return attrs.get("title") || ""; }, set title(v) { el.setAttribute("title", v); },
      appendChild(c) { detach(c); c.parentNode = el; el.kids.push(c); return c; },
      replaceChild(c, old) { detach(c); el.kids[el.kids.indexOf(old)] = c; c.parentNode = el; old.parentNode = null; return old; },
      remove() { detach(el); },
      contains(x) { for (let n = x; n; n = n.parentNode) if (n === el) return true; return false; },
      closest(s) { for (let n = el; n && n.nodeType === 1; n = n.parentNode) if (s === "[title]" && n.hasAttribute("title")) return n; return null; },
      getBoundingClientRect: () => el.rect || { left: 100, top: 50, right: 180, bottom: 70, width: 80, height: 20 },
      get outerHTML() { return ser(el); },
      set outerHTML(h) { el.parentNode.replaceChild(parse(h), el); },
    };
    return el;
  }
  function ser(n) {
    if (n.nodeType === 3) return n.nodeValue;
    const t = n.tagName.toLowerCase();
    return "<" + t + n.attributes.map(a => " " + a.name + '="' + a.value + '"').join("") + ">" + n.kids.map(ser).join("") + "</" + t + ">";
  }
  function parse(h) {
    const top = El("frag"), stack = [top], re = /<(\/?)([a-z0-9]+)((?:\s+[\w-]+="[^"]*")*)\s*>|([^<]+)/gi;
    let m;
    while ((m = re.exec(h))) {
      if (m[4] != null) { stack[stack.length - 1].appendChild(Text(m[4])); continue; }
      if (m[1]) { stack.pop(); continue; }
      const e = El(m[2]);
      for (const a of m[3].matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(a[1], a[2]);
      stack[stack.length - 1].appendChild(e); stack.push(e);
    }
    return top.firstElementChild;
  }
  function find(n, s) {
    if (n.nodeType !== 1) return null;
    if (s[0] === "#" ? n.id === s.slice(1) : (n.getAttribute("class") || "").split(" ").includes(s.slice(1))) return n;
    for (const k of n.kids) { const f = find(k, s); if (f) return f; }
    return null;
  }
  const root = El("body");
  W.body = h => { root.kids.length = 0; root.appendChild(parse(h)); };
  W.q = s => find(root, s);
  W.el = (id, title, rect) => { const e = El("span"); e.setAttribute("id", id); if (title != null) e.setAttribute("title", title);
                                e.rect = rect || null; root.appendChild(e); return e; };
  W.over = el => handlers.mouseover({ target: el });
  W.out = (el, to) => handlers.mouseout({ target: el, relatedTarget: to || null });
  W.wait = () => { const t = timers.splice(0); t.forEach(f => f()); };          // the hover delay elapses
  W.sync = html => W.api.applyUISync({ t: "sync", html, vals: {} });
  const document = {
    addEventListener: (ev, fn) => { handlers[ev] = fn; }, activeElement: null,
    querySelector: s => find(root, s), getElementById: id => find(root, "#" + id),
    createElement: t => (t === "template" ? { set innerHTML(h) { this.content = { firstElementChild: parse(h) }; } } : El(t)),
  };
  const window = { addEventListener: () => {}, MutationObserver: MO };
  const $ = s => (s === "#uiTip" ? uiTip : null);
  const setTimeout = fn => { timers.push(fn); return timers.length; }, clearTimeout = () => { timers.length = 0; };
  const SRC = H.slice(H.indexOf("const TIP_DELAY_MS"), H.indexOf("function drawAIS")) + "\n"
            + [grabDecl("UI_BRIDGED"), grabDecl("uiMirrored"), grab("uiSameNode"), grab("uiMorph"), grab("applyUISync")].join("\n");
  // eslint-disable-next-line no-new-func
  W.api = new Function("document", "window", "$", "setTimeout", "clearTimeout", "MutationObserver", "innerWidth", "innerHeight",
                       "syncUICards", SRC + "\nreturn { applyUISync, setTip };")
                      (document, window, $, setTimeout, clearTimeout, MO, 1280, 720, () => {});
  return W;
}

// -- 13. THE CHART WINDOW'S CASE: a DIRECT title write, four times a second, under a still pointer --------------- //
{
  const W = pageWorld();
  const go = W.el("mi_speed", "Speed: 6.0 kn"), other = W.el("v_wind", "Wind 5 kn");
  W.over(go); W.wait();
  const up = W.uiTip.style.display === "block" && W.uiTip.textContent === "Speed: 6.0 kn" && !go.hasAttribute("title");
  let present = 0;
  for (let i = 0; i < 40; i++) {                      // ten seconds of the frame writing it directly
    go.title = "Speed: " + (6 + i / 100).toFixed(2) + " kn";
    W.settle();
    if (go.hasAttribute("title")) present++;
  }
  const words = W.uiTip.textContent, downs = W.downs;
  other.title = "Wind 6 kn"; W.settle();              // ... and a control nobody is on keeps what is written to it
  const otherKept = other.getAttribute("title") === "Wind 6 kn";
  W.out(go, null);
  const back = go.getAttribute("title");
  check("13. DRIVEN: a title written DIRECTLY to the hovered control 40 times never stays on it, the tip follows "
        + "the words without once coming down, and an un-hovered control keeps its own",
        () => up && present === 0 && words === "Speed: 6.39 kn" && downs === 0 && otherKept && back === "Speed: 6.39 kn",
        () => "shown " + up + "; on the hovered control after the checkpoint " + present + "/40 (the browser's own tip "
            + "re-armed each time); tip reads " + JSON.stringify(words) + ", taken down " + downs + "x; un-hovered kept "
            + otherKept + "; restored on leave " + JSON.stringify(back));
}

// -- 14. Words written during the hover DELAY are the ones shown ------------------------------------------------ //
{
  const W = pageWorld();
  const b = W.el("mi_activity", "Transiting");
  W.over(b); b.title = "Transiting - 2.1 km to go"; W.settle(); W.wait();
  check("14. DRIVEN: words written during the hover delay are the ones the tip shows, not those it had when the hover began",
        () => W.uiTip.style.display === "block" && W.uiTip.textContent === "Transiting - 2.1 km to go" && !b.hasAttribute("title"),
        () => "tip " + W.uiTip.style.display + " " + JSON.stringify(W.uiTip.textContent));
}

// -- 15. A title CLEARED mid-hover takes the tip down, and the old words do not come back --------------------------- //
{
  const W = pageWorld();
  const b = W.el("b_passage", "Plan the passage");
  W.over(b); W.wait();
  const was = W.uiTip.style.display;
  b.title = ""; W.settle();
  const after = W.uiTip.style.display;
  W.out(b, null);
  const back = b.getAttribute("title");
  check("15. DRIVEN: a title CLEARED mid-hover takes the tip down, and the old words are not put back on leave",
        () => was === "block" && after === "none" && !back,
        () => "tip " + was + " -> " + after + "; title after leave " + JSON.stringify(back));
}

// -- 16. A tip that GROWS while up is placed again -------------------------------------------------------------- //
{
  const W = pageWorld();
  const b = W.el("v_water", "short", { left: 100, top: 690, right: 180, bottom: 710, width: 80, height: 20 });
  W.over(b); W.wait();                                  // at the bottom edge: flipped ABOVE the control
  const top0 = parseFloat(W.uiTip.style.top);
  b.title = "x".repeat(60); W.settle();                 // three times as tall
  const top1 = parseFloat(W.uiTip.style.top), h1 = W.uiTip.offsetHeight;
  check("16. DRIVEN: a tip that grows while up is placed again - flipped above the control, it never reaches down over it",
        () => top0 + 40 <= 690 && top1 + h1 <= 690,
        () => "before: top " + top0 + " (40 tall); after: top " + top1 + " (" + h1 + " tall), bottom " + (top1 + h1)
            + " against the control's top 690");
}

// -- 17. THE CONTROLS WINDOW'S CASE: the mirror keeps the hovered control --------------------------------------- //
{
  const W = pageWorld();
  W.body('<div id="pathPanel"><button id="gt_go" title="Go">Go</button><span id="pp_rd" title="Range">--</span></div>');
  const boot = W.q("#gt_go");
  const pic = km => '<div id="pathPanel"><button id="gt_go" title="Go: ' + km + ' km">Go</button>'
                  + '<span id="pp_rd" title="Range ' + km + '">' + km + ' km</span></div>';
  W.sync({ "#pathPanel": pic("4.0") });
  const first = W.q("#gt_go");
  W.over(first); W.wait();
  let same = 0, onIt = 0;
  for (const km of ["3.9", "3.8", "3.7"]) {             // three reading changes while the pointer is still
    W.sync({ "#pathPanel": pic(km) }); W.settle();
    if (W.q("#gt_go") === first) same++;
    if (first.hasAttribute("title")) onIt++;
  }
  const rd = W.q("#pp_rd");
  check("17. DRIVEN: the first picture REPLACES the card (the boot's nodes dropped); every later one PATCHES it - the "
        + "hovered control is the same element through three reading changes, its new words in the tip, never on it",
        () => first !== boot && same === 3 && onIt === 0 && first.isConnected && W.downs === 0
              && W.uiTip.textContent === "Go: 3.7 km" && rd.getAttribute("title") === "Range 3.7" && rd.kids[0].nodeValue === "3.7 km",
        () => "first picture replaced the boot's button " + (first !== boot) + "; kept " + same + "/3; title on it "
            + onIt + "x; tip " + JSON.stringify(W.uiTip.textContent) + ", taken down " + W.downs + "x; readout "
            + JSON.stringify(rd.kids[0].nodeValue) + " / " + JSON.stringify(rd.getAttribute("title")));
  // ... and when the picture takes the hovered control's title AWAY, the tip comes down and nothing stale returns
  W.sync({ "#pathPanel": '<div id="pathPanel"><button id="gt_go">Go</button><span id="pp_rd" title="Range 3.7">3.7 km</span></div>' });
  W.settle();
  const down = W.uiTip.style.display;
  W.out(first, null);
  check("17b. DRIVEN: a picture that drops the hovered control's title takes the tip down, and the old words are not put back",
        () => down === "none" && !first.getAttribute("title"),
        () => "tip " + down + "; title after leave " + JSON.stringify(first.getAttribute("title")));
}

// -- 18. The patch is exact: kept, rebuilt, added, removed --------------------------------------------------------- //
{
  const W = pageWorld();
  W.body('<div id="rocPanel"><ul id="rl"><li id="r1">one</li></ul></div>');
  W.sync({ "#rocPanel": '<div id="rocPanel"><ul id="rl"><li id="r1" style="color:red">one</li><li id="r2">two</li></ul><i id="gone">x</i></div>' });
  const r1 = W.q("#r1"), r2 = W.q("#r2");
  const want = '<div id="rocPanel" class="x"><ul id="rl"><li id="r1">one!</li><li id="r3">three</li><li id="r4">four</li></ul></div>';
  W.sync({ "#rocPanel": want });
  const got = W.q("#rocPanel").outerHTML;
  check("18. DRIVEN: the patched card is EXACTLY the picture - an attribute dropped, text changed, a node of another id "
        + "rebuilt, a row added, a trailing node removed - and the row still there is the same element",
        () => got === want && W.q("#r1") === r1 && W.q("#r3") !== r2 && !W.q("#gone"),
        () => (got === want ? "card == picture" : "card " + got) + "; row 1 kept " + (W.q("#r1") === r1)
            + "; row of another id rebuilt " + (W.q("#r3") !== r2));
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
