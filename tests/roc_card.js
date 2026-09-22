// tests/roc_card.js - the ROC card must never show a value the server did not take.
//
// WHY THIS EXISTS. The recovery-offset and ship-motion boxes posted parseFloat() of whatever
// was in them, unguarded. Clear "Off m" and JSON.stringify writes the NaN as null; the server
// reads a null field as "absent, keep what you have" - a DELIBERATE rule, argued at length in
// roc_tracks.py:352-361, so that a config record written before a field existed cannot null
// out a default - and answers HTTP 200 {"ok":true}. Nothing changed, nothing refused.
//
// The second half is the one that bites. renderRoc() rebuilds a row only when the row
// SIGNATURE (id:kind:status:gps) changes; a plain telemetry frame takes the live branch,
// which rewrote the dot, the MOVING tag, lat, lon and the HOME radio - and nothing else. So
// the blank box STAYED blank, frame after frame, while every Return-to-Home recovery point
// was still 30 m off the Mothership. The card read one thing and the boat did another, with
// no refusal anywhere on screen. Same shape for a clamped value: -50 stores max(0.0,-50)=0.0
// server-side and read "-50" on the card for ever.
//
//   node tests/roc_card.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// The listener and renderRoc() are SLICED OUT OF static/asv.html by brace matching and run
// over a small DOM shim, in the manner of ais_table.js: these are the real functions, not a
// paraphrase, so a rename or a rewrite is caught as a setup failure rather than passing
// vacuously. What the shim cannot model is a real browser's constraint validation - note
// that min="0" on the input does NOT suppress the change event, which is exactly why the
// -50 case reaches the server at all.
//
// TEETH (verified by mutation on a sidecar, with the checks each one produces):
//     the four write-back lines removed from the live branch      -> 1, 4, 5, 6
//     the isFinite guard dropped from the roc-off handler         -> 2
//     the isFinite guard dropped from the roc-motion handler      -> 9
//     the guard written `if(rng && brg)` instead of isFinite      -> 3   (a real 0 refused)
//     the activeElement guard dropped from the write-back         -> 7   (fights the typist)

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
const vm = require("vm");

// ASV_HTML points this at a SIDECAR copy for a mutation run - see the note in ais_table.js.
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

// Brace-matched slice from the real page. Takes a function declaration OR a statement that
// opens a brace (the delegated listener), and swallows a trailing `);` so the listener slice
// is a complete statement.
function slice(marker) {
  const i = H.indexOf(marker);
  if (i < 0) throw new Error("test setup: anchor gone - " + marker + " (renamed?)");
  let depth = 0, k = H.indexOf("{", i);
  for (; k < H.length; k++) {
    const c = H[k];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) { let e = k + 1; if (H.slice(e, e + 2) === ");") e += 2; return H.slice(i, e); } }
  }
  throw new Error("test setup: unbalanced braces after " + marker);
}

const SRC_RENDER  = slice("function renderRoc(){");
const SRC_MOVING  = slice("function rocMovingTag(r){");
const SRC_HANDLER = slice('$("#roc_list").addEventListener("change"');
const SRC_ESC     = H.split(/\r?\n/).find(l => l.startsWith("function rocEsc("));
if (!SRC_ESC) throw new Error("test setup: rocEsc gone (renamed?)");

// The live-refresh branch only - the `else` arm of the signature test, where the fault lived.
const LIVE = SRC_RENDER.slice(SRC_RENDER.indexOf("same set"));

// ---------------- minimal DOM shim ----------------------------------------------------- //
function parseAttrs(s) {
  const a = {}, re = /([\w:-]+)(?:="([^"]*)")?/g; let m;
  while ((m = re.exec(s))) a[m[1]] = m[2] === undefined ? "" : m[2];
  return a;
}
class El {
  constructor(tag, attrs, text) {
    this.tag = tag; this.attrs = attrs || {}; this.textContent = text || "";
    this.value = this.attrs.value !== undefined ? this.attrs.value : "";
    this.className = this.attrs.class || "";
    this.checked = "checked" in this.attrs;
    this.dataset = {}; for (const k in this.attrs) if (k.startsWith("data-")) this.dataset[k.slice(5)] = this.attrs[k];
    this._row = null; this._kids = [];
    const self = this;
    this.classList = { contains: c => self.className.split(/\s+/).includes(c) };
  }
  closest(sel) { return sel === ".rocrow" ? this._row : null; }
  matches(sel) {
    if (sel.startsWith("[")) {
      const a = sel.slice(1, -1).split("="), k = a[0], v = (a[1] || "").replace(/^"|"$/g, "");
      return this.attrs[k] !== undefined && (a.length === 1 || this.attrs[k] === v);
    }
    const cm = sel.match(/^\.([\w-]+)(?:\[([\w-]+)="?([^"\]]*)"?\])?$/);
    if (cm) return this.classList.contains(cm[1]) && (!cm[2] || this.attrs[cm[2]] === cm[3]);
    throw new Error("shim: unsupported selector " + sel);
  }
  querySelector(sel) { return this._kids.find(e => e.matches(sel)) || null; }
}
class Container extends El {
  set innerHTML(h) { this._html = h; this._parse(h); }
  get innerHTML() { return this._html; }
  _parse(h) {
    this._kids = []; let row = null;
    const re = /<(\w+)([^>]*?)\/?>([^<]*)/g; let m;
    while ((m = re.exec(h))) {
      const el = new El(m[1], parseAttrs(m[2]), m[3]);
      if (el.classList.contains("rocrow")) { row = el; row._kids = []; this._kids.push(row); el._row = row; }
      else if (el.tag === "option") {
        const sels = (row ? row._kids : []).filter(e => e.tag === "select");
        const s = sels[sels.length - 1];
        if (s && "selected" in el.attrs) s.value = el.attrs.value;
      } else if (row) { el._row = row; row._kids.push(el); }
    }
  }
  querySelector(sel) { return this._kids.find(e => e.matches(sel)) || null; }
}

// One ship ROC, ACTIVE, HOME, recovery offset 30 m astern, steaming at 6 kn on 090.
function snap(over) {
  return { home_id: "ship-1", rocs: [Object.assign({
    id: "ship-1", name: "Mothership", kind: "ship", status: "active",
    lat: 41.520000, lon: -70.670000, cog: 90.0, sog: 6.0, heading: 90.0, speed_kn: 6.0,
    offset: { range_m: 30.0, bearing_deg: 180.0, ref: "relative" },
    arrival: { lat: 41.520000, lon: -70.670360 }, arrival_bearing: 270.0,
    link: "ok", age_s: 0.2, source: "manual", moving: true, closing_kn: 2.0, closable: true,
    gps: { attached: false } }, over || {})] };
}

// A fresh card, with the real code running over the shim. Returns the handles a case needs.
function card(first) {
  const list = new Container("div", { id: "roc_list", class: "list" });
  list._kids = []; list._html = "";
  const hint = new El("div", { id: "roc_hint" });
  const posted = [], noted = [];
  const ctx = {
    console, document: { activeElement: null }, CSS: { escape: s => s },
    $: sel => sel === "#roc_list" ? list : (sel === "#roc_hint" ? hint : null),
    S: { roc: null }, render: () => {},
    rocPost: b => { posted.push(b); return Promise.resolve({}); },
    flashNote: m => { noted.push(m); },
    listeners: {},
  };
  ctx.global = ctx;
  list.addEventListener = (ev, fn) => { ctx.listeners[ev] = fn; };
  vm.createContext(ctx);
  vm.runInContext(SRC_ESC + "\nlet rocRowsSig = null;\n" + SRC_RENDER + "\n" + SRC_MOVING + "\n" + SRC_HANDLER, ctx);
  ctx.S.roc = first || snap();
  ctx.renderRoc();                                   // first paint builds the row
  const row = list.querySelector('.rocrow[data-id="ship-1"]');
  return { ctx, list, row, posted, noted,
           fld: s => row && row.querySelector(s),
           frame: over => { ctx.S.roc = snap(over); ctx.renderRoc(); } };
}

console.log("ROC card - the boxes must read back what the server actually took:");

// 1. SOURCE SHAPE. The live-refresh branch is the only thing that ever repaints these boxes
// on a plain telemetry frame, because the row signature does not move when an offset is
// refused or clamped. If it does not write them, no code path does.
check("1. the live-refresh branch writes the offset and motion boxes back, not just lat/lon",
      () => /\[data-k=range_m\]/.test(LIVE) && /\[data-k=bearing_deg\]/.test(LIVE)
            && /\[data-k=heading\]/.test(LIVE) && /\[data-k=speed_kn\]/.test(LIVE),
      () => "live branch names: " + (LIVE.match(/\[data-k=[\w]+\]/g) || ["NONE"]).join(" "));

// 2. THE REPORTED FAULT, driven. A cleared box must not reach the wire at all: null there
// means "keep the old value" to the server, so the post is a silent no-op dressed as a 200.
{
  const c = card();
  const off = c.fld("[data-k=range_m]");
  const before = c.posted.length;
  off.value = "";
  c.ctx.listeners.change({ target: off });
  check("2. THE REPORTED FAULT: clearing Off m posts NOTHING and says so",
        () => c.posted.length === before && c.noted.length === 1,
        () => "posted " + JSON.stringify(c.posted.slice(before)) + "; note=" + JSON.stringify(c.noted[0] || ""));
}

// 3. ACCEPTANCE, and the reason the guard must be isFinite and not truthiness. 0 is a legal
// offset - roc_tracks.py returns the ROC's own position as the recovery point when range_m
// is 0 - so `if(rng)` would refuse a deliberate operator instruction.
{
  const c = card();
  const off = c.fld("[data-k=range_m]");
  off.value = "0";
  c.ctx.listeners.change({ target: off });
  const last = c.posted[c.posted.length - 1];
  check("3. ACCEPTANCE: a legitimate ZERO offset still reaches the server",
        () => last && last.op === "offset" && last.range_m === 0 && c.noted.length === 0,
        () => "posted " + JSON.stringify(last) + "; notes=" + c.noted.length);
}

// 4. THE HALF THAT MAKES THE CARD TELL THE TRUTH. Even with 2 in place, a box can go stale:
// the server clamps, or an older client posted a null. One frame later the card must read
// what the server holds. The frame below moves only lat - the row signature is unchanged, so
// this is the live branch, and 30 must come back.
{
  const c = card();
  const off = c.fld("[data-k=range_m]");
  off.value = "";                                    // whatever put it there
  c.frame({ lat: 41.520100 });                       // one ordinary telemetry frame
  check("4. a box the server did not take is repainted from the snapshot within one frame",
        () => String(off.value) === "30",
        () => "server holds 30, card reads " + JSON.stringify(off.value));
}

// 5. The clamp, which is the same defect wearing a number instead of a blank.
{
  const c = card();
  const off = c.fld("[data-k=range_m]");
  off.value = "-50";
  const s = snap({ lat: 41.520200 }); s.rocs[0].offset.range_m = 0.0;
  c.ctx.S.roc = s; c.ctx.renderRoc();
  check("5. a CLAMPED offset snaps to what the server stored, not what was typed",
        () => String(off.value) === "0",
        () => "server stored 0.0, card reads " + JSON.stringify(off.value));
}

// 6. The motion pair gets the same treatment - a ship's commanded heading is as load-bearing
// as its recovery offset, because Return-to-Home chases the projected position.
{
  const c = card();
  const hd = c.fld("[data-k=heading]"), sp = c.fld("[data-k=speed_kn]");
  hd.value = ""; sp.value = "";
  c.frame({ lat: 41.520100 });
  check("6. the ship's heading and speed boxes are repainted from the snapshot too",
        () => String(hd.value) === "90" && String(sp.value) === "6.0",
        () => "card reads hdg=" + JSON.stringify(hd.value) + " spd=" + JSON.stringify(sp.value));
}

// 7. ACCEPTANCE: the repaint must not fight the operator. renderRoc runs every telemetry
// frame; without the activeElement guard, typing "45" into Off m would be overwritten by the
// next frame before the change event ever fired.
{
  const c = card();
  const off = c.fld("[data-k=range_m]");
  c.ctx.document.activeElement = off;                // focused, mid-type
  off.value = "45";
  c.frame({ lat: 41.520100 });
  check("7. ACCEPTANCE: a frame does not overwrite the box the operator is typing into",
        () => String(off.value) === "45",
        () => "typed 45, after a frame the box reads " + JSON.stringify(off.value));
}

// 8. ACCEPTANCE: the live track must still track. This is what the live branch was FOR, and
// a write-back added carelessly must not cost it.
{
  const c = card();
  const la = c.fld("[data-fld=lat]"), mv = c.fld("[data-fld=moving]");
  c.frame({ lat: 41.520100, moving: true, closable: false, closing_kn: 1.4 });
  check("8. ACCEPTANCE: lat/lon and the MOVING tag still update in place",
        () => String(la.value) === "41.520100" && /closing 1\.4 kn/.test(mv.textContent),
        () => "lat=" + JSON.stringify(la.value) + " tag=" + JSON.stringify(mv.textContent));
}

// 9. The motion handler carries the same guard as the offset handler. A steaming Mothership
// whose heading box is cleared used to post heading:null and keep steaming on the old one.
{
  const c = card();
  const hd = c.fld("[data-k=heading]");
  const before = c.posted.length;
  hd.value = "";
  c.ctx.listeners.change({ target: hd });
  check("9. clearing Hdg on a steaming ship posts NOTHING and says so",
        () => c.posted.length === before && c.noted.length === 1,
        () => "posted " + JSON.stringify(c.posted.slice(before)) + "; note=" + JSON.stringify(c.noted[0] || ""));
}

// 10. A SHORE ROC has no motion boxes at all. The write-back must tolerate their absence -
// a throw inside renderRoc takes out the whole card and every frame after it.
{
  const shore = { home_id: "sh-1", rocs: [{
    id: "sh-1", name: "Pier", kind: "shore", status: "active", lat: 41.51, lon: -70.66,
    heading: 0, speed_kn: 0, offset: { range_m: 15.0, bearing_deg: 0.0, ref: "true" },
    arrival: { lat: 41.51, lon: -70.66 }, link: "ok", moving: false, closable: true,
    gps: { attached: false } }] };
  let threw = null, offVal = null;
  try {
    const list = new Container("div", { id: "roc_list" }); list._kids = []; list._html = "";
    const hint = new El("div", { id: "roc_hint" });
    const ctx = { console, document: { activeElement: null }, CSS: { escape: s => s },
      $: s => s === "#roc_list" ? list : (s === "#roc_hint" ? hint : null),
      S: { roc: null }, render: () => {}, rocPost: () => Promise.resolve({}), flashNote: () => {}, listeners: {} };
    ctx.global = ctx;
    list.addEventListener = (ev, fn) => { ctx.listeners[ev] = fn; };
    vm.createContext(ctx);
    vm.runInContext(SRC_ESC + "\nlet rocRowsSig = null;\n" + SRC_RENDER + "\n" + SRC_MOVING + "\n" + SRC_HANDLER, ctx);
    ctx.S.roc = shore; ctx.renderRoc();
    shore.rocs[0].lat = 41.5101; ctx.renderRoc();     // the live branch, on a row with no motion row
    offVal = list.querySelector('.rocrow[data-id="sh-1"]').querySelector("[data-k=range_m]").value;
  } catch (e) { threw = e.message; }
  check("10. a SHORE row, which has no motion boxes, survives the live branch",
        () => !threw && String(offVal) === "15",
        () => threw ? "THREW: " + threw : "shore offset box reads " + JSON.stringify(offVal));
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
