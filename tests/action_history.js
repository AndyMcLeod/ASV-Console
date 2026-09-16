// tests/action_history.js - the Mission Status card keeps a history of what the console did (review #22, 2026-09-15).
//
// Andy: "There's no history of what the console did. Notes disappear after 4 s, and banners share one slot that about
// 40 different messages overwrite. Add a timestamped list of the last 20 actions to the Mission Status card."
// One recorder is fed by the three ways the console speaks - a command it sends, with the answer it got (the server's
// own note, or the refusal in words); a note it flashes; a banner it posts - newest first, 20 kept, a repeat of the
// newest counted up, kept in localStorage per viewer, and drawn into the card by patching rows, never by markup.
// DRIVEN: the page's own recordAction, historyText, fillHistoryRow, historyRow, renderHistory, cmd, cmdLabel, showNote,
// flashNote, showBanner, setCellText and storage helpers, over a DOM stub that counts inserts, removes and markup
// writes, a fetch that answers as the console does, and a store.
//
//   node tests/action_history.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 33 sidecar mutations RUN, 33/33 caught:
//   a command not recorded -> 1, 2, 5b, 6              the reply's note always the answer -> 2, 6
//   the reply's note never taken -> 1, 2, 6            a refusal recorded as a plain command -> 3
//   a refusal flashed through flashNote (two lines) -> 3, 4    a dropped command not recorded -> 4
//   a flashed note not recorded -> 5, 5b, 7, 8, 9      a banner recorded on every re-assertion -> 5
//   a banner never recorded -> 5, 5b, 10               no counting up -> 5, 5b, 6, 9
//   a repeat matched on answer text only -> 6          banners merged only with the newest line -> 5b
//   commands merged anywhere -> 5b                     a merged banner left where it was -> 5b
//   banner numbers not set aside -> 5b                 a merged banner keeps its old words -> 5b
//   the cap dropped -> 7, 9                            oldest first -> 2, 4, 5, 5b, 6, 7, 8, 9
//   not persisted -> 8, 9                              storage trusted as it is -> 8
//   a repeat rebuilds the list -> 9                    a moved row rebuilt, not moved -> 5b
//   a new entry rebuilds the list -> 5b, 9             the last row not dropped -> 7, 9
//   written as markup -> 1, 2, 3, 4, 5b, 6, 9, 10      no truncation -> 10
//   the count not shown -> 5b, 6, 9                    the tooltip loses the text -> 10
//   refusals not styled apart -> 10                    disarm named Arm -> 11
//   a deviation loses its reason -> 11                 the section removed from the card -> 12
//   not drawn at load -> 8, 9, 12
// ⚠ THE FIRST RUN CAUGHT 24 OF 27, AND ALL THREE MISSES WERE THIS SUITE: check 5 never asserted the re-asserted
// banner's own count (recording every re-assertion read as one line "×10"); damaged storage CRASHED the world's
// construction instead of failing check 8; and commenting out the load-time draw broke the harness's block anchor, so
// that mutant crashed too. A crash is not a catch - it names nothing. And the DOM stub's insertBefore first COPIED a
// node already in the list instead of moving it, which is not what a browser does; 5b found it.
//
// LIVE (port 8796, a temp copy running Andy's Eastport plan): after Arm, Upload, Start, Pause, E-STOP on and off and a
// Return home the E-STOP had disarmed, the card read, newest first, "Return home — refused: ARM before commanding the
// boat" (red), "E-STOP released — Command E-STOP released (still SAFE/disarmed).", "E-STOP — COMMAND E-STOP latched...",
// "Pause — Paused (next waypoint held).", "Speed high — Speed: high (14.0 kn) - applied live." (the speed governor's own
// command), "Start — Survey started (will Return-to-Home at the end).", "Upload — Run plan uploaded (719 waypoints ·
// ENC-routed, rth).", "Arm — ARMED...", and the load banners in amber; a reload brought all of it back. Two faults were
// found THERE, not here: a time column left a 196 px card ~23 characters a line (a banner took seven lines), so the
// time runs inline and a row shows 120 characters; and every load posts two banners - four reloads had taken eight
// lines - so a banner posted again moves up, matched with its numbers set aside (the zone count read 585, 599, 737).
// After both: three reloads, two lines, each ×3.
//
// NOTE: the page's script is <script type="module">, which runs STRICT; the lifted code runs in a strict function here.

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

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

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
function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}

console.log("The Mission Status card keeps a history of what the console did:");

// ── a DOM that counts ────────────────────────────────────────────────────────────────────────────────────────────
const W = { inserts: 0, removes: 0, markup: 0 };
function textNode(v) { return { nodeType: 3, nodeValue: String(v) }; }
function makeEl(tag, id) {
  const el = { tagName: tag, id: id || "", className: "", title: "", style: {}, childNodes: [] };
  Object.defineProperty(el, "firstChild", { get: () => el.childNodes[0] || null });
  Object.defineProperty(el, "lastChild", { get: () => el.childNodes[el.childNodes.length - 1] || null });
  Object.defineProperty(el, "textContent", {
    get: () => el.childNodes.map((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent)).join(""),
    set: (v) => { el.childNodes = String(v) === "" ? [] : [textNode(v)]; },
  });
  Object.defineProperty(el, "innerHTML", { get: () => "", set: () => { W.markup++; } });
  // like the DOM, inserting a node that is already a child MOVES it
  const detach = (c) => { const j = el.childNodes.indexOf(c); if (j >= 0) el.childNodes.splice(j, 1); };
  el.appendChild = (c) => { detach(c); el.childNodes.push(c); W.inserts++; return c; };
  el.insertBefore = (c, ref) => { detach(c); const i = el.childNodes.indexOf(ref); if (i < 0) el.childNodes.push(c); else el.childNodes.splice(i, 0, c); W.inserts++; return c; };
  el.removeChild = (c) => { const i = el.childNodes.indexOf(c); if (i >= 0) el.childNodes.splice(i, 1); W.removes++; return c; };
  return el;
}
function makeStore(init) {
  const map = new Map(init ? [["asv_history_v1", init]] : []);
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}
// fetch answering as the console's POST dispatch does: 200 {ok, state}, 409 {error, state}, or a dropped connection
function makeFetch() {
  const f = async (url, init) => {
    f.calls.push({ url, body: JSON.parse(init.body || "{}") });
    const a = f.next.shift() || { status: 200, body: { ok: true, state: { note: f.note } } };
    if (a.drop) throw new TypeError("Failed to fetch");
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  f.calls = []; f.next = []; f.note = "Simulator connected. No hardware in the loop.";
  return f;
}

// The history's declarations and functions, lifted one by one; and the page's own load-time draw, lifted only if the
// page still makes it - a page that stopped drawing at load is a failed check below, not a harness that cannot start.
const HIST_DECLS = decl(/^const HISTORY_MAX = [^;]*;/m) + "\n"
  + H.slice(H.indexOf("let actionLog = "), H.indexOf("})();", H.indexOf("let actionLog = ")) + "})();".length);
const LOAD_CALL = /^renderHistory\(\);$/m.test(H) ? "renderHistory();" : "";
const HISTORY_SHOW = Number(/HISTORY_SHOW = (\d+)/.exec(H)[1]);
function makeWorld(store) {
  const els = { "#historyBody": makeEl("div", "historyBody"), "#note": makeEl("div", "note"), "#encbanner": makeEl("div", "encbanner") };
  const doc = { createElement: (t) => makeEl(t) };
  const fetchStub = makeFetch();
  const body = [
    "\"use strict\";",
    "const $ = (s) => els[s];",
    "let S = { note: fetchStub.note };",
    // review #14: cmd() asks whether this tab is the supervising one. This world is a supervising tab - the
    // view-only refusal is tests/supervisor_page.js's subject, not this suite's.
    "const supervising = () => true; const CLIENT_ID = \"test-tab\";",
    "const SUPERVISOR_ANY = [\"/api/cmd/stop\", \"/api/cmd/pause\", \"/api/cmd/estop\"];",
    grab("lsGet"), grab("lsSet"), grab("lsDel"), grab("setCellText"),
    HIST_DECLS,
    ["recordAction", "historyText", "fillHistoryRow", "historyRow", "renderHistory"].map(grab).join("\n"),
    LOAD_CALL,
    grab("cmd").replace(/^function cmd/, "async function cmd"), grab("cmdLabel"), decl(/^let noteTimer = [^;]*;/m),
    grab("showNote"), grab("flashNote"), grab("showBanner"),
    "return { recordAction, renderHistory, cmd, cmdLabel, flashNote, showBanner, get log(){ return actionLog; },",
    "         setNote: (n) => { S.note = n; } };",
  ].join("\n");
  const w = new Function("els", "document", "localStorage", "fetch", "fetchStub", "setTimeout", "clearTimeout", body)(
    els, doc, store, fetchStub, fetchStub, () => 0, () => {});
  w.els = els; w.fetch = fetchStub; w.store = store;
  return w;
}
const rowsOf = (w) => w.els["#historyBody"].childNodes.filter((n) => /\bhrow\b/.test(n.className));
const rowText = (r) => r.lastChild.textContent;

(async () => {
  // 1-2. a command and its answer
  const W1 = makeWorld(makeStore());
  W1.fetch.note = "Run plan uploaded (722 waypoints · ENC-routed, rth).";
  await W1.cmd("/api/cmd/upload", { route: [{}, {}] });
  W1.setNote(W1.fetch.note);                          // the next frame brings the server's note to the page
  const firstRow = rowsOf(W1)[0];
  check("1. a command that is answered is one line: the operator's word for it and the server's own note in reply",
        () => W1.log.length === 1 && W1.log[0].kind === "cmd" && rowText(firstRow) === "Upload — Run plan uploaded (722 waypoints · ENC-routed, rth).",
        () => rowsOf(W1).map(rowText).join(" | "));
  await W1.cmd("/api/cmd/start");
  check("2. a reply that leaves the server's note as it was borrows no answer from an earlier command",
        () => W1.log.length === 2 && rowText(rowsOf(W1)[0]) === "Start" && rowText(rowsOf(W1)[1]).startsWith("Upload — Run plan"),
        () => rowsOf(W1).map(rowText).join(" | "));

  // 3-4. refused, and dropped
  const W3 = makeWorld(makeStore());
  W3.fetch.next.push({ status: 409, body: { error: "not armed", state: { note: W3.fetch.note } } });
  const r3 = await W3.cmd("/api/cmd/start");
  check("3. a REFUSED command is ONE line - the command and the refusal in words - and the refusal still flashes",
        () => r3.ok === false && W3.log.length === 1 && W3.log[0].kind === "refused" && rowText(rowsOf(W3)[0]) === "Start — refused: not armed"
              && W3.els["#note"].textContent === "not armed" && W3.els["#note"].style.display === "block",
        () => rowsOf(W3).map(rowText).join(" | ") + "; on screen: '" + W3.els["#note"].textContent + "'");
  W3.fetch.next.push({ drop: true });
  await W3.cmd("/api/cmd/stop");
  check("4. a command the network dropped says so, once",
        () => W3.log.length === 2 && rowText(rowsOf(W3)[0]) === "Stop — network error" && W3.els["#note"].textContent === "network error",
        () => rowsOf(W3).map(rowText).join(" | "));

  // 5. notes and banners
  const W5 = makeWorld(makeStore());
  W5.flashNote("Keep-out 12 s ahead and closing — HOLDING.");
  for (let i = 0; i < 10; i++) W5.showBanner("⚠ CONSOLE LOOP FAULT — the guard raised 3 time(s).");   // re-asserted per frame
  const afterRepeat = W5.log.length;
  W5.showBanner("3 transit(s) auto-routed around obstacles (amber).");
  W5.els["#encbanner"].style.display = "none";          // cleared ...
  W5.showBanner("3 transit(s) auto-routed around obstacles (amber).");   // ... and posted again
  check("5. a flashed note is kept; a banner is kept when it is POSTED - ten re-assertions of the same words on screen "
        + "are one posting, counted once - and a banner posted again after it was cleared is kept again",
        () => afterRepeat === 2 && W5.log.length === 3 && W5.log[0].n === 2 && W5.log[1].kind === "banner" && W5.log[1].n === 1
              && W5.log[2].kind === "note",
        () => W5.log.map((a) => a.kind + ":" + a.label.slice(0, 24) + " x" + a.n).join(" | "));

  // 5b. a banner posted again later moves up; commands keep their order
  const W5b = makeWorld(makeStore());
  W5b.showBanner("Extracting ENC nogo boundaries for the operating area…");
  W5b.showBanner("Nogo established (585 nogo zone(s) · band harbour).");
  W5b.flashNote("Speed changed");
  const loadRow = rowsOf(W5b)[2];                        // the first banner's row, before the page loads again
  W5b.els["#encbanner"].style.display = "none";
  W5b.showBanner("Extracting ENC nogo boundaries for the operating area…");     // the next load posts both again ...
  W5b.showBanner("Nogo established (737 nogo zone(s) · band harbour).");        // ... the count grown since
  const texts5b = rowsOf(W5b).map(rowText);
  await W5b.cmd("/api/cmd/start"); await W5b.cmd("/api/cmd/pause"); await W5b.cmd("/api/cmd/start");
  const order = W5b.log.slice(0, 3).map((a) => a.label).join(", ");
  check("5b. a banner posted again after other lines MOVES its line to the top counted up - the same row, moved, its "
        + "numbers set aside in the match and the newest words shown - so the load-time banners of four reloads are two "
        + "lines, not eight; commands are never merged past the newest line, so Start, Pause, Start stays three lines in "
        + "that order",
        () => texts5b.length === 3 && texts5b[0] === "Nogo established (737 nogo zone(s) · band harbour). ×2"
              && texts5b[1] === "Extracting ENC nogo boundaries for the operating area… ×2" && texts5b[2] === "Speed changed"
              && rowsOf(W5b)[4] === loadRow && order === "Start, Pause, Start",
        () => texts5b.join(" | ") + "; then " + order + "; moved row is the same node: " + (rowsOf(W5b)[4] === loadRow));

  // 6. a repeat of the newest counts up
  const W6 = makeWorld(makeStore());
  W6.fetch.note = "Speed: low (3.0 kn) - applied live.";
  await W6.cmd("/api/cmd/speed", { speed: "low" });
  W6.setNote(W6.fetch.note);
  for (let i = 0; i < 4; i++) await W6.cmd("/api/cmd/speed", { speed: "low" });
  await W6.cmd("/api/cmd/speed", { speed: "high" });
  check("6. the same command sent five times is ONE line counted up - the first reply's answer kept, the time the "
        + "last - and a different one is a new line",
        () => W6.log.length === 2 && W6.log[1].n === 5 && rowText(rowsOf(W6)[1]) === "Speed low — Speed: low (3.0 kn) - applied live. ×5"
              && rowText(rowsOf(W6)[0]) === "Speed high",
        () => rowsOf(W6).map(rowText).join(" | "));

  // 7. the cap
  const W7 = makeWorld(makeStore());
  for (let i = 1; i <= 25; i++) W7.flashNote("note " + i);
  check("7. twenty are kept, newest first: the 25th is at the top and the first five are gone",
        () => W7.log.length === 20 && W7.log[0].label === "note 25" && W7.log[19].label === "note 6" && rowsOf(W7).length === 20,
        () => W7.log.length + " kept, " + W7.log[0].label + " ... " + W7.log[19].label + ", " + rowsOf(W7).length + " rows");

  // 8. it outlives the page
  const W8 = makeWorld(W7.store);
  // built inside a guard: a history that throws at load would stop the page, and here it must fail check 8, not the run
  const loadFrom = (raw) => { try { return makeWorld(makeStore(raw)); } catch (e) { return { log: [], threw: e.message }; } };
  const damaged = [loadFrom("{\"not\":\"a list\"}"), loadFrom("[{\"t\":1},null,{\"label\":\"ok\",\"t\":5}]"), loadFrom("not json")];
  check("8. a reload brings the history back and draws it; storage holding something else gives back only what is "
        + "whole, without throwing",
        () => W8.log.length === 20 && W8.log[0].label === "note 25" && rowsOf(W8).length === 20
              && damaged.every((d) => !d.threw) && damaged[0].log.length === 0 && damaged[1].log.length === 1 && damaged[1].log[0].label === "ok" && damaged[2].log.length === 0,
        () => "restored " + W8.log.length + " (" + rowsOf(W8).length + " rows); damaged stores gave "
              + damaged.map((d) => (d.threw ? "THREW " + d.threw : d.log.length)).join(", "));

  // 9. patched in place
  const before = rowsOf(W8).slice();
  let s = { ...W };
  W8.flashNote("note 25");                              // a repeat of the newest
  const repeat = { inserts: W.inserts - s.inserts, removes: W.removes - s.removes };
  const sameAfterRepeat = rowsOf(W8).every((r, i) => r === before[i]);
  s = { ...W };
  W8.flashNote("note 26 <b>not markup</b>");            // a new one
  const fresh = { inserts: W.inserts - s.inserts, removes: W.removes - s.removes };
  const after = rowsOf(W8);
  check("9. the card is patched, not rebuilt: a repeat rewrites the top row's text in the same row; a new entry inserts "
        + "one row and drops the last, the other nineteen the same nodes; and a message is text, never markup",
        () => repeat.inserts === 0 && repeat.removes === 0 && sameAfterRepeat && rowText(before[0]) === "note 25 ×2"
              && fresh.inserts === 3 && fresh.removes === 1 && after.length === 20 && after.slice(1).every((r, i) => r === before[i])
              && rowText(after[0]) === "note 26 <b>not markup</b>" && W.markup === 0,
        () => "repeat: " + repeat.inserts + " inserts / " + repeat.removes + " removes; new: " + fresh.inserts + " inserts (a row and its two cells) / "
              + fresh.removes + " removes; markup writes " + W.markup);

  // 10. long words, and the time
  const W10 = makeWorld(makeStore());
  const long = "⚠⚠ IN EXTREMIS — being set onto a pier and stopping would not answer it. " + "x".repeat(300);
  W10.showBanner(long);
  const r10 = rowsOf(W10)[0];
  check("10. a long message is cut to fit the card with an ellipsis, and the row's tooltip carries all of it with the "
        + "date and time",
        () => rowText(r10).length === HISTORY_SHOW && HISTORY_SHOW <= 160 && rowText(r10).endsWith("…") && r10.title.endsWith(long)
              && /^\d\d:\d\d:\d\d$/.test(r10.firstChild.textContent) && r10.className === "hrow banner",
        () => rowText(r10).length + " chars shown; time '" + r10.firstChild.textContent + "'; class " + r10.className);

  // 11. the words
  const L = W10.cmdLabel;
  check("11. commands are named in the operator's words: arm and disarm, E-STOP and its release, the speed key, a "
        + "deviation with its reason, a ROC operation",
        () => L("/api/cmd/arm", { on: true }) === "Arm" && L("/api/cmd/arm", { on: false }) === "Disarm"
              && L("/api/cmd/estop", { on: true }) === "E-STOP" && L("/api/cmd/estop", { on: false }) === "E-STOP released"
              && L("/api/cmd/speed", { speed: "low" }) === "Speed low"
              && L("/api/cmd/amend", { note: "Deviation: 4 m right to keep clear of a pier." }) === "Route amended — Deviation: 4 m right to keep clear of a pier."
              && L("/api/roc", { op: "select_home" }) === "ROC select home" && L("/api/cmd/rth") === "Return home",
        () => [L("/api/cmd/arm", { on: false }), L("/api/cmd/estop", { on: false }), L("/api/roc", { op: "select_home" })].join(" | "));

  // 12. where it lives
  const card = H.slice(H.indexOf('<div class="vcard" id="vcard">'), H.indexOf('<div class="vminipill" id="vReopen"'));
  const iHist = H.indexOf("const HISTORY_MAX = "), iRender = H.indexOf("\nrenderHistory();\n");
  check("12. the section is on the Mission Status card, and the history is declared and drawn at the top of the module - "
        + "before any code that can post a banner or flash a note",
        () => /id="v_history"/.test(card) && /id="historyBody"/.test(card) && iHist > 0 && iRender > iHist
              && iRender < H.indexOf("let track = loadTrack();") && iRender < H.indexOf("async function cmd(")
              && iRender < H.indexOf("function showBanner("),
        () => "declared at " + iHist + ", drawn at " + iRender + "; first showBanner at " + H.indexOf("function showBanner("));

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
