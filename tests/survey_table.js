// tests/survey_table.js - THE SURVEY TABLE (sequenced surveys, phase 2, 2026-10-02).
//
// Andy, 2026-10-02: "Multiple surveys can be created and named/numbered in Survey card. Then the user can select the
// order in which the survey blocks are completed. GOTO function for inter-survey travel." Phase 1 put the surveys in
// the plan (tests/survey_blocks.js). Phase 2 gives them controls, on his calls: each survey keeps its own pattern,
// boundary, Max depth, leads and turn shape (buffer, the three speeds, End of plan and Min depth stay plan-wide); the
// transits between surveys keep right (Rule 9) like every transit; no hold between surveys yet.
//
//   1-6    static/js/surveys.js: surveyEntries, moveSurvey, removeSurvey, replaceSurvey, surveyLabel - pure, and every
//          edit leaves a plan normalizeSurveys judges SOUND (nothing folded, the order it says);
//   7      static/js/passage.js routePlan(..., transitAt): the leg INTO a later survey is routed as a transit - its
//          route IS the pure transit's over the same leg (the standoff, the lane, the re-gate) - and without the set
//          it is the hop it always was (the CONTROL); a one-survey plan routes identically either way;
//   8      the page's commitPattern while a survey is being EDITED: replaced where it stands, its number and name
//          kept, its settings recorded; the old rule (append) as the control; a deleted survey's edit adds a new one;
//   9      editSurvey / applySurveySettings: the drawing and the five settings back on the card, exact values;
//   10     deleteSurvey and moveSurveyRow through the real surveys.js; the confirmation honoured;
//   11     committedPatternInfo(sv): each survey described on its own - two surveys at different headings read BLANK
//          as a whole plan (the old reading, the control); cardSurveyId's choice;
//   12     renderSurveyTable: every control has an id (the controls window forwards by id), the ends disabled, ✎
//          disabled without a drawing, a name escaped, a name being typed never rebuilt under the cursor;
//   13     the LINES card's survey headings and their totals; one survey: no heading (the table as it was);
//   14     the chart labels.
//
//   node tests/survey_table.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ASV_HTML, SURVEYS_JS and PASSAGE_JS point this at SIDECAR copies for a mutation run.

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
const SURVEYS_JS = process.env.SURVEYS_JS || path.join(__dirname, "..", "static", "js", "surveys.js");
const PASSAGE_JS = process.env.PASSAGE_JS || path.join(__dirname, "..", "static", "js", "passage.js");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const SV = require(SURVEYS_JS);
const G = require("../static/js/geodesy.js");

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
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}
const copy = (o) => JSON.parse(JSON.stringify(o));
const tags = (list) => list.map((x) => x.sv || "-").join(" ");
const ids = (m) => m.surveys.map((s) => s.id).join(",");

// A plan in plain numbers: waypoint n at 44.9 + n * 1e-4 N.
const W = (n, sv, extra) => ({ lat: 44.9 + n * 1e-4, lon: -67.0, ...(sv ? { sv } : {}), ...(extra || {}) });
const Ln = (i, j, sv) => ({ a: W(i), b: W(j), ...(sv ? { sv } : {}) });
// Three surveys and two free waypoints: S1 (2 lines), a free waypoint, S2 (1 line), S3 (1 line), a free waypoint.
const THREE = () => ({
  waypoints: [W(0, "S1"), W(1, "S1"), W(2, "S1", { turn: true }), W(3, "S1"), W(4, "S1"), W(50), W(5, "S2"), W(6, "S2"),
              W(7, "S3"), W(8, "S3"), W(51)],
  lines: [Ln(0, 1, "S1"), Ln(3, 4, "S1"), Ln(5, 6, "S2"), Ln(7, 8, "S3")],
  surveys: [{ id: "S1", no: 1, name: "" }, { id: "S2", no: 2, name: "Ledge" }, { id: "S3", no: 3, name: "" }],
});
const sound = (m) => { const c = copy(m), r = SV.normalizeSurveys(c); return !r.folded && !r.migrated && ids(c) === ids(m); };

console.log("The survey table - sequenced surveys, phase 2:");

// ── 1. surveyEntries ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const m = THREE();
  const e = [...SV.surveyEntries(m.waypoints)].sort((a, b) => a - b);
  check("1. surveyEntries names the waypoint where the plan ENTERS each survey from something else - S2 after a free "
        + "waypoint, S3 straight after S2 - and not the approach (index 0, routePlan's own), not a point INSIDE a "
        + "survey, not a free waypoint after one",
        () => JSON.stringify(e) === "[6,8]", JSON.stringify(e));
  check("1b. ... and a plan with no tags (every fixture, a plan from before surveys) has none - its routing unchanged",
        () => SV.surveyEntries([W(0), W(1), W(2)]).size === 0 && SV.surveyEntries([]).size === 0
              && SV.surveyEntries(null).size === 0);
}

// ── 2-3. moveSurvey ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const m = THREE();
  const ok = SV.moveSurvey(m, "S3", -1);
  check("2. ▲ on S3 runs it before S2 - in the survey list AND in both plan lists, every entry moving with its survey "
        + "(the turn waypoint inside S1 untouched), and the plan stays SOUND",
        () => ok && ids(m) === "S1,S3,S2" && tags(m.lines) === "S1 S1 S3 S2"
              && tags(m.waypoints) === "S1 S1 S1 S1 S1 - S3 S3 S2 S2 -"
              && m.waypoints[6].lat === W(7).lat && m.waypoints[8].lat === W(5).lat && m.waypoints[2].turn === true
              && sound(m),
        () => ids(m) + " | " + tags(m.waypoints));
  const m2 = THREE();
  SV.moveSurvey(m2, "S1", +1);
  check("2b. ▼ on S1 swaps it with S2 and the FREE waypoint between them stays between them - a free waypoint is "
        + "never moved by a survey edit",
        () => ids(m2) === "S2,S1,S3" && tags(m2.waypoints) === "S2 S2 - S1 S1 S1 S1 S1 S3 S3 -"
              && m2.waypoints[2].lat === W(50).lat && m2.waypoints[10].lat === W(51).lat && sound(m2),
        () => tags(m2.waypoints));
  const m3 = THREE(), before = JSON.stringify(m3);
  check("3. ... and ▲ on the first, ▼ on the last, or an unknown id changes NOTHING and says so (false)",
        () => SV.moveSurvey(m3, "S1", -1) === false && SV.moveSurvey(m3, "S3", +1) === false
              && SV.moveSurvey(m3, "S9", -1) === false && JSON.stringify(m3) === before);
  const m4 = THREE();
  SV.moveSurvey(m4, "S3", -1); SV.moveSurvey(m4, "S3", -1);
  check("3b. two ▲ take S3 to the front; its number and name go with it (the number stays with the survey)",
        () => ids(m4) === "S3,S1,S2" && m4.surveys[2].name === "Ledge" && m4.surveys[2].no === 2
              && tags(m4.lines) === "S3 S1 S1 S2" && sound(m4), () => ids(m4) + " | " + tags(m4.lines));
}

// ── 4. removeSurvey ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const m = THREE();
  const ok = SV.removeSurvey(m, "S2");
  check("4. deleting S2 takes its record, its line and its waypoints - the free waypoints, S1 and S3 untouched, S3 "
        + "still number 3 - and the plan stays SOUND",
        () => ok && ids(m) === "S1,S3" && m.surveys[1].no === 3 && tags(m.lines) === "S1 S1 S3"
              && tags(m.waypoints) === "S1 S1 S1 S1 S1 - S3 S3 -" && sound(m), () => tags(m.waypoints));
  const m2 = THREE(), before = JSON.stringify(m2);
  check("4b. ... and an unknown id deletes nothing", () => SV.removeSurvey(m2, "S7") === false && JSON.stringify(m2) === before);
}

// ── 5. replaceSurvey ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const m = THREE();
  SV.replaceSurvey(m, "S2", [Ln(20, 21, "S2"), Ln(22, 23, "S2")], [W(20, "S2"), W(21, "S2"), W(22, "S2"), W(23, "S2")]);
  check("5. replaceSurvey puts S2's new lines and waypoints WHERE ITS OLD ONES WERE - after S1 and the free waypoint, "
        + "before S3 - and the plan stays SOUND",
        () => tags(m.lines) === "S1 S1 S2 S2 S3" && m.lines[2].a.lat === W(20).lat
              && tags(m.waypoints) === "S1 S1 S1 S1 S1 - S2 S2 S2 S2 S3 S3 -" && m.waypoints[6].lat === W(20).lat
              && !m.waypoints.some((p) => p.lat === W(5).lat) && sound(m), () => tags(m.waypoints));
  const m2 = { waypoints: [W(0, "S1"), W(1, "S1")], lines: [Ln(0, 1, "S1")], surveys: [{ id: "S1", no: 1 }, { id: "S2", no: 2 }] };
  SV.replaceSurvey(m2, "S2", [Ln(5, 6, "S2")], [W(5, "S2"), W(6, "S2")]);
  check("5b. ... and a survey with nothing in the plan yet gets its entries at the END", () => tags(m2.lines) === "S1 S2"
        && tags(m2.waypoints) === "S1 S1 S2 S2");
}

// ── 6. surveyLabel ───────────────────────────────────────────────────────────────────────────────────────────────
check("6. a survey's label is its NUMBER, then its name if it has one - 'S2 Ledge', 'S3' - whatever its id",
      () => SV.surveyLabel({ id: "S2", no: 2, name: " Ledge " }) === "S2 Ledge" && SV.surveyLabel({ id: "x", no: 3, name: "" }) === "S3"
            && SV.surveyLabel({ id: "S4", no: 4 }) === "S4" && SV.surveyLabel(null) === "");

// ── 7. routePlan's transitAt ─────────────────────────────────────────────────────────────────────────────────────
// planner_guard_seam 7g's block: a hull-sized block across a leg. Here the leg is the one BETWEEN two surveys: S1 ends
// at (-58, 0), S2 starts at (37, 0). Routed as the pure transit of that one leg is routed (Go-To's, keepRightAll) when
// it is a survey's approach; as a hop between waypoints (the buffer, no lane) without the set.
{
  const { nogo } = require("../static/js/state.js");
  const { routePlan } = require(PASSAGE_JS);
  const K = require("../static/js/keepouts.js");
  const F = G.planeFrame({ lat: 43.07, lon: -70.71 });
  const at = (e, n) => F.fromEN(e, n);
  const { bbOf } = require("../static/js/geometry.js");     // the model's own box (a hand-rolled one hid the block)
  const block = (rotDeg) => { const r = rotDeg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const pts = [[-13, -7], [13, -7], [13, 7], [-13, 7]].map(([x, y]) => ({ e: x * c - y * s, n: x * s + y * c }));
    return { ring: pts, bb: bbOf(pts), kind: "a hull-sized block" }; };
  const model = (polys) => ({ polys, lines: [], points: [], marks: [], sys: [], chans: [] });
  const minClear = (route, from, ko) => { let m = Infinity, prev = F.toEN(from);
    for (const w of route) { const q = F.toEN(w), n = Math.max(1, Math.ceil(Math.hypot(q.e - prev.e, q.n - prev.n) / 0.5));
      for (let i = 0; i <= n; i++) { const t = i / n; m = Math.min(m, K.clearanceM({ e: prev.e + (q.e - prev.e) * t, n: prev.n + (q.n - prev.n) * t }, ko, 200)); }
      prev = q; }
    return m; };
  const key = (r) => r.map((p) => p.lat.toFixed(8) + "," + p.lon.toFixed(8)).join(";");
  const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer };
  const got = [];
  let one = null;
  try {
    nogo.ready = true; nogo.frame = F; nogo.buffer = 3;
    for (const rot of [-42, 30, 60]) {
      const ko = model([block(rot)]); nogo.ko = ko;
      const start = at(-120, 0);
      const wps = [{ ...at(-120, 0), sv: "S1" }, { ...at(-58, 0), sv: "S1" }, { ...at(37, 0), sv: "S2" }, { ...at(100, 0), sv: "S2" }];
      const ent = SV.surveyEntries(wps);
      const withSet = routePlan(start, wps, false, 19.5, ent);
      const without = routePlan(start, wps, false, 19.5);                 // the CONTROL: the hop it always was
      const pure = routePlan(at(-58, 0), [at(37, 0)], true, 19.5);        // Go-To's routing of that one leg
      const slice = (r) => { const i = r.findIndex((p) => Math.abs(F.toEN(p).e + 58) < 0.01 && Math.abs(F.toEN(p).n) < 0.01);
                             const j = r.findIndex((p) => Math.abs(F.toEN(p).e - 37) < 0.01 && Math.abs(F.toEN(p).n) < 0.01);
                             return (i >= 0 && j > i) ? r.slice(i + 1, j + 1) : null; };
      const sW = slice(withSet.route), sO = slice(without.route);
      got.push({ rot, ent: [...ent].join(","), same: !!sW && key(sW) === key(pure.route),
                 mW: sW ? minClear(sW, at(-58, 0), ko) : -1, mO: sO ? minClear(sO, at(-58, 0), ko) : -1,
                 inW: withSet.insideStandoff, unr: withSet.unroutable.length + without.unroutable.length });
    }
    // one survey: the same plan with S2's tags made S1's - no entry, so the set changes nothing
    const ko = model([block(30)]); nogo.ko = ko;
    const wps1 = [at(-120, 0), at(-58, 0), at(37, 0), at(100, 0)].map((p) => ({ ...p, sv: "S1" }));
    one = { a: key(routePlan(at(-120, 0), wps1, false, 19.5, SV.surveyEntries(wps1)).route),
            b: key(routePlan(at(-120, 0), wps1, false, 19.5).route), n: SV.surveyEntries(wps1).size };
  } finally {
    nogo.ready = saved.ready; nogo.frame = saved.frame; nogo.ko = saved.ko; nogo.buffer = saved.buffer;
  }
  check("7. Upload's router routes the leg INTO a later survey exactly as Go-To routes that leg - the same waypoints, "
        + "found at the 19.5 m standoff and through the lane pass - in three orientations of a block across it",
        () => got.length === 3 && got.every((g) => g.ent === "2" && g.same && g.unr === 0 && g.inW === 0 && g.mW >= 19.5 - 0.05),
        () => got.map((g) => "rot " + g.rot + ": " + (g.same ? "= Go-To's" : "DIFFERS") + ", " + g.mW.toFixed(1) + " m").join("; "));
  check("7b. CONTROL - without the set the same leg is the hop it always was: routed at the buffer, inside the "
        + "standoff (what the old Upload flew between two surveys)",
        () => got.every((g) => g.mO >= 3 - 0.05 && g.mO < 19.5),
        () => got.map((g) => "rot " + g.rot + ": " + g.mO.toFixed(1) + " m").join("; "));
  check("7c. ... and a ONE-survey plan has no entry, so it routes identically with the set and without it",
        () => one && one.n === 0 && one.a === one.b);
}

// ── the page world: the survey table, the edit, the card ────────────────────────────────────────────────────────
function el(id) {
  return { id, value: "", textContent: "", disabled: false, style: {}, title: "", writes: 0, _html: "",
           get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this.writes++; },
           contains(x) { return !!x && x.inside === id; } };
}
function pageWorld() { return pageWorldWithEnv().w; }
// A punched pattern of `n` parallel lines, `len` m long, `sp` m apart, at bearing `brg`, starting at east offset `e0`.
const REF = { lat: 43.07, lon: -70.71 };
const P = (e, n) => G.fromEN(e, n, REF);
function pattern(n, len, sp, brg, e0, n0) {
  const r = brg * Math.PI / 180, ux = Math.sin(r), uy = Math.cos(r), vx = Math.cos(r), vy = -Math.sin(r);
  const out = [];
  for (let i = 0; i < n; i++) {
    const ox = e0 + vx * sp * i, oy = (n0 || 0) + vy * sp * i;
    const a = P(ox, oy), b = P(ox + ux * len, oy + uy * len);
    out.push(i % 2 ? [b, a] : [a, b]);
  }
  return out;
}
const lead0 = (n) => Array.from({ length: n }, () => ({ in: 0, out: 0 }));
const ANCH = (e) => ({ A: P(e, 0), B: P(e + 30, 100), C: P(e + 10, 0), align: 1 });
function commit(w, lines, anchors) {
  w.set({ clip: lines, transits: lines.slice(1).map(() => []), lead: lead0(lines.length), anchors });
  return w.commitPattern();
}

// ── 8. the commit, while a survey is being edited ────────────────────────────────────────────────────────────────
(async () => {
  {
    const w = pageWorld();
    await commit(w, pattern(2, 100, 10, 0, 0), ANCH(0));
    await commit(w, pattern(2, 100, 10, 0, 300), ANCH(300));
    await commit(w, pattern(2, 100, 10, 0, 600), ANCH(600));
    w.renameSurvey("S2", "  Ledge ");
    const s2Old = w.mission.lines.filter((l) => l.sv === "S2").map((l) => l.a.lat).join();
    // the edit: S2 redrawn as THREE lines further north, with its own settings on the card
    w.editingSv = "S2";
    w.setBoundary([P(290, -10), P(400, -10), P(400, 300)]);
    w.mission.lead_mode = "s"; w.mission.lead_in = 6; w.mission.lead_out = 4; w.mission.turn_ease = "eased";
    await commit(w, pattern(3, 80, 12, 0, 300, 200), ANCH(305));
    const m = w.mission, s2 = m.surveys.find((s) => s.id === "S2");
    const s2New = m.lines.filter((l) => l.sv === "S2");
    check("8. Add to plan while S2 is being EDITED replaces S2 WHERE IT STANDS - between S1 and S3 in the survey list "
          + "and in both plan lists, its number 2 and name 'Ledge' kept, its old lines gone, its three new ones in - "
          + "and the plan stays SOUND; the edit ends",
          () => ids(m) === "S1,S2,S3" && s2.no === 2 && s2.name === "Ledge" && s2New.length === 3
                && tags(m.lines) === "S1 S1 S2 S2 S2 S3 S3"
                && tags(m.waypoints).replace(/S2( S2)*/, "S2*") === "S1 S1 S1 S1 S2* S3 S3 S3 S3"
                && !m.lines.some((l) => l.sv === "S2" && s2Old.split(",").includes(String(l.a.lat)))
                && sound(m) && w.editingSv === null && w.cardSv === "S2",
          () => ids(m) + " | " + tags(m.lines) + " | " + tags(m.waypoints) + " | editing " + w.editingSv);
    check("8b. ... and S2 records what it was punched WITH - its boundary (closed), the leads in their unit, the turn "
          + "shape - and the drawing it came from",
          () => s2.settings && s2.settings.boundary.length === 3 && s2.settings.lead_mode === "s"
                && s2.settings.lead_in === 6 && s2.settings.lead_out === 4 && s2.settings.turn_ease === "eased"
                && s2.settings.max_depth_m === null && s2.pattern && Math.abs(s2.pattern.A.lat - ANCH(305).A.lat) < 1e-12
                && s2.punched === true,
          () => JSON.stringify(s2.settings));
    // CONTROL: the same commit with NO edit in progress appends - the phase-1 rule
    await commit(w, pattern(2, 60, 10, 0, 900), ANCH(900));
    check("8c. CONTROL - with no edit in progress Add to plan appends a NEW survey, S4, after S3 (the rule it always had)",
          () => ids(w.mission) === "S1,S2,S3,S4" && w.mission.surveys[3].no === 4 && tags(w.mission.lines).endsWith("S3 S3 S4 S4"),
          () => ids(w.mission) + " | " + tags(w.mission.lines));
    // a survey deleted while it was being edited: the drawing goes in as a NEW survey, never under the dead number
    w.editingSv = "S3";
    w.mission = (SV.removeSurvey(w.mission, "S3"), w.mission);
    await commit(w, pattern(2, 60, 10, 0, 1200), ANCH(1200));
    check("8d. ... and an edit whose survey was deleted meanwhile commits as a NEW survey, S5 - its old number is never "
          + "handed out again",
          () => ids(w.mission) === "S1,S2,S4,S5" && !w.mission.surveys.some((s) => s.no === 3),
          () => ids(w.mission));
    w.setBoundary([]);
  }

  // ── 9. editSurvey / applySurveySettings ────────────────────────────────────────────────────────────────────────
  {
    const w = pageWorld();
    await commit(w, pattern(2, 100, 10, 0, 0), ANCH(0));
    const st = { boundary: [P(-5, -5), P(50, -5), P(50, 120)], max_depth_m: 40, lead_mode: "s", lead_in: 10,
                 lead_out: 12, turn_ease: "eased" };
    w.mission.surveys[0].settings = st;
    w.mission.surveys[0].name = "Pier";
    await w.editSurvey("S1");
    const E = w.surveySettingsNow();
    check("9. ✎ loads S1 back onto the card: its drawing (corners, alignment), its boundary CLOSED, Max depth 40, leads "
          + "10 s / 12 s, eased turns - the card in SURV, S1 being edited",
          () => w.editingSv === "S1" && w.pat.A && Math.abs(w.pat.A.lat - ANCH(0).A.lat) < 1e-12 && w.pat.align === 1
                && Math.abs(w.pat.C.lon - ANCH(0).C.lon) < 1e-12 && w.boundaryClosed && w.boundary.length === 3
                && E.max_depth_m === 40 && E.lead_mode === "s" && E.lead_in === 10 && E.lead_out === 12
                && E.turn_ease === "eased" && w.mission.lead_in === 10,
          () => JSON.stringify({ ed: w.editingSv, E }));
    const w2 = pageWorld();
    await commit(w2, pattern(2, 100, 10, 0, 0), ANCH(0));
    w2.mission.surveys[0].pattern = null;
    await w2.editSurvey("S1");
    check("9b. a survey with no recorded drawing (planned before surveys were kept) cannot be loaded back - nothing "
          + "changes (9d: the note says why)",
          () => w2.editingSv === null && w2.pat.A === null);
    const w3 = pageWorld();
    await commit(w3, pattern(2, 100, 10, 0, 0), ANCH(0));
    delete w3.mission.surveys[0].settings;
    w3.mission.lead_in = 7;
    await w3.editSurvey("S1");
    check("9c. a survey from before phase 2 (no settings recorded) loads its drawing and leaves the card's settings as "
          + "they were",
          () => w3.editingSv === "S1" && w3.mission.lead_in === 7 && w3.pat.A !== null);
  }
  {
    // the notes and the question - the env is reachable through a world built with its log kept
    const SVn = pageWorldWithEnv();
    const { w, env } = SVn;
    await commit(w, pattern(2, 100, 10, 0, 0), ANCH(0));
    w.mission.surveys[0].pattern = null;
    await w.editSurvey("S1");
    check("9d. ... and its note names the reason (no recorded drawing) and the way on", () =>
          env.log.notes.some((t) => /no recorded drawing/.test(t) && /draw it again/.test(t)), () => env.log.notes.join(" | "));
    const v = pageWorldWithEnv();
    await commit(v.w, pattern(2, 100, 10, 0, 0), ANCH(0));
    v.w.set({ clip: null }); v.w.pat.A = P(500, 0);                 // a pattern being drawn
    v.env.answer = false;
    await v.w.editSurvey("S1");
    check("9e. ✎ over a pattern being drawn ASKS first (in the simulator too), and a No keeps the drawing and starts no edit",
          () => v.env.log.asked.length === 1 && v.env.log.asked[0].opts.always === true && v.w.editingSv === null
                && v.w.pat.A && Math.abs(v.w.pat.A.lat - P(500, 0).lat) < 1e-12);
  }

  // ── 10. delete and move through the page ───────────────────────────────────────────────────────────────────────
  {
    const v = pageWorldWithEnv();
    for (const e of [0, 300, 600]) await commit(v.w, pattern(2, 100, 10, 0, e), ANCH(e));
    v.env.answer = false;
    await v.w.deleteSurvey("S2");
    const kept = ids(v.w.mission);
    v.env.answer = true; v.w.editingSv = "S2";
    await v.w.deleteSurvey("S2");
    check("10. ✕ asks first (always), a No deletes nothing; a Yes takes S2 out - S3 keeps its number - and ends an edit of it",
          () => kept === "S1,S2,S3" && ids(v.w.mission) === "S1,S3" && v.w.mission.surveys[1].no === 3
                && v.w.editingSv === null && v.env.log.asked.every((a) => a.opts.always === true)
                && /2 line\(s\) and 4 waypoint\(s\)/.test(v.env.log.asked[0].msg),
          () => ids(v.w.mission) + " | " + (v.env.log.asked[0] || {}).msg);
    v.w.moveSurveyRow("S3", -1);
    check("10b. ▲ through the page runs S3 first, saves, and says the new order and that Upload sends it",
          () => ids(v.w.mission) === "S3,S1" && tags(v.w.mission.lines) === "S3 S3 S1 S1"
                && v.env.log.notes.some((t) => /Run order: S3, S1\. Upload sends the new order/.test(t)),
          () => v.env.log.notes.slice(-1)[0]);
  }

  // ── 11. committedPatternInfo(sv) and cardSurveyId ──────────────────────────────────────────────────────────────
  {
    const w = pageWorld();
    await commit(w, pattern(4, 200, 10, 0, 0), ANCH(0));            // S1: N-S lines 10 m apart
    await commit(w, pattern(3, 150, 25, 90, 400, -300), ANCH(400)); // S2: E-W lines 25 m apart
    const all = w.committedPatternInfo(), s1 = w.committedPatternInfo("S1"), s2 = w.committedPatternInfo("S2");
    check("11. each survey is described on its own - S1 4 lines 10 m apart, S2 3 lines 25 m apart at 90° - where the "
          + "whole plan, the old reading (the CONTROL), is BLANK: two surveys at different headings are not one pattern",
          () => all === null && s1 && s1.count === 4 && Math.abs(s1.spacing - 10) < 0.05
                && s2 && s2.count === 3 && Math.abs(s2.spacing - 25) < 0.05 && Math.abs(((s2.direction % 180) + 180) % 180 - 90) < 0.5,
          () => JSON.stringify({ all, s1: s1 && [s1.count, s1.spacing.toFixed(2)], s2: s2 && [s2.count, s2.spacing.toFixed(2), s2.direction.toFixed(1)] }));
    w.cardSv = null; const last = w.cardSurveyId();
    w.cardSv = "S1"; const picked = w.cardSurveyId();
    w.editingSv = "S2"; const editing = w.cardSurveyId();
    w.editingSv = null; w.cardSv = "S9"; const gone = w.cardSurveyId();
    check("11b. the card describes the survey being edited, else the row picked, else the last listed - and a picked "
          + "survey since deleted falls back to the last",
          () => last === "S2" && picked === "S1" && editing === "S2" && gone === "S2", [last, picked, editing, gone].join(","));
  }

  // ── 12. renderSurveyTable ──────────────────────────────────────────────────────────────────────────────────────
  {
    const v = pageWorldWithEnv();
    for (const e of [0, 300, 600]) await commit(v.w, pattern(2, 100, 10, 0, e), ANCH(e));
    v.w.mission.surveys[1].name = 'Bob\'s "<pier>"';
    v.w.mission.surveys[2].pattern = null;
    v.w.renderSurveyTable();
    const tb = v.env.els["#sv_table"], html = tb.innerHTML;
    const idsIn = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const acts = [...html.matchAll(/<(\w+)[^>]*data-act="([^"]+)"[^>]*>/g)];
    check("12. one row per survey, in run order; EVERY control - row, name, ▲ ▼ ✎ ✕ - carries a unique id (the "
          + "controls window forwards clicks and edits BY ID)",
          () => /S1<\/span>[\s\S]*S2<\/span>[\s\S]*S3<\/span>/.test(html) && idsIn.length === 18
                && new Set(idsIn).size === 18 && acts.length === 15 && acts.every((m) => / id="/.test(m[0])),
          () => idsIn.length + " ids, " + new Set(idsIn).size + " unique, " + acts.length + " actions");
    check("12b. ▲ is disabled on the first row, ▼ on the last, ✎ on the survey with no recorded drawing - and only there",
          () => /id="svr0_up"[^>]* disabled/.test(html) && !/id="svr1_up"[^>]* disabled/.test(html)
                && /id="svr2_dn"[^>]* disabled/.test(html) && !/id="svr1_dn"[^>]* disabled/.test(html)
                && /id="svr2_ed"[^>]* disabled/.test(html) && !/id="svr0_ed"[^>]* disabled/.test(html));
    check("12c. a name with quotes and angle brackets is ESCAPED into the field, never parsed as markup",
          () => html.includes('value="Bob\'s &quot;&lt;pier&gt;&quot;"') && !html.includes("<pier>"));
    const writes = tb.writes;
    v.w.mission.surveys[0].name = "typed";
    v.env.document.activeElement = { tagName: "INPUT", inside: "sv_table" };
    v.w.renderSurveyTable();
    const heldOff = tb.writes === writes;
    v.env.document.activeElement = null;
    v.w.renderSurveyTable();
    check("12d. the table is NOT rebuilt under a name being typed, and is the moment the field lets go",
          () => heldOff && tb.writes === writes + 1 && tb.innerHTML.includes('value="typed"'));
    v.w.renderSurveyTable();
    check("12e. ... and nothing changed, nothing is rewritten (the table is not rebuilt every frame)", () => tb.writes === writes + 1);
    v.w.editingSv = "S2"; v.w.renderSurveyTable();
    check("12f. the survey being edited is marked on its row, and the note under the table says what Update will do",
          () => /class="svrow[^"]* edit"[^>]*data-sv="S2"/.test(tb.innerHTML) && v.env.els["#sv_note"].style.display === ""
                && /EDITING S2 .* Update S2 replaces it where it stands/.test(v.env.els["#sv_note"].textContent),
          () => v.env.els["#sv_note"].textContent);
    const e2 = pageWorldWithEnv();
    e2.w.renderSurveyTable();
    check("12g. a plan with no surveys shows no table", () => e2.env.els["#sv_table"].style.display === "none"
          && e2.env.els["#sv_head"].style.display === "none");
  }

  // ── 13. the LINES card ─────────────────────────────────────────────────────────────────────────────────────────
  {
    const skel = (() => { // eslint-disable-next-line no-new-func
      return new Function("\"use strict\";\n" + grab("rocEsc") + "\n" + grab("lineTableSkeleton") + "\nreturn lineTableSkeleton;")(); })();
    const rows = [0, 1, 2].map((i) => ({ i, len: "100", tip: "", lead: 0 }));
    const plain = skel(rows, false, [], { len: 300, lead: 0 }, []);
    const same = skel(rows, false, [], { len: 300, lead: 0 }, [], []);
    const grouped = skel(rows, false, [], { len: 300, lead: 0 }, [], [{ j: 0, at: 0, label: "S1" }, { j: 1, at: 2, label: "S2 <Ledge>" }]);
    check("13. LINES: each survey gets a heading row in front of its first line, carrying its own plan and actual cells; "
          + "a plan with no groups is the table exactly as it was",
          () => plain === same && !/lt_s0/.test(plain)
                && /<tr id="lt_s0"[\s\S]*S1[\s\S]*<tr id="lt_r0"[\s\S]*<tr id="lt_r1"[\s\S]*<tr id="lt_s1"[\s\S]*S2 &lt;Ledge&gt;[\s\S]*<tr id="lt_r2"/.test(grouped)
                && /id="lt_s1_plan"/.test(grouped) && /id="lt_s1_act"/.test(grouped));
    const R = grab("renderLineTable");
    check("13b. ... and renderLineTable builds the groups only for MORE than one survey, and fills each heading with the "
          + "sum of ITS lines' plan and actual",
          () => /if\(svList\.length > 1\)\{/.test(R)
                && /const gp = g\.rows\.reduce\(\(a,r\)=>a\+r\.plan,0\), ga = g\.rows\.reduce\(\(a,r\)=>a\+r\.act,0\);/.test(R)
                && /lineTableSkeleton\(lines, anyLead, tt,[\s\S]*?, ht, groups\)/.test(R)
                && /groups\.map\(g => \[g\.at, g\.label\]\)/.test(R));
  }

  // ── 14. the chart labels ───────────────────────────────────────────────────────────────────────────────────────
  {
    const calls = [];
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => calls.push([k, ...a])),
                                set: (t, k, v) => { t[k] = v; if (k === "fillStyle") calls.push(["fill", v]); return true; } });
    // eslint-disable-next-line no-new-func
    const draw = new Function("ctx", "SV", "M", "\"use strict\";\nconst surveyLabel = SV.surveyLabel; let editingSv = 'S2';"
      + " const mission = M;\n" + grab("drawSurveyLabels") + "\nreturn drawSurveyLabels;")(ctx, SV,
      { lines: [Ln(0, 1, "S1"), Ln(2, 3, "S1"), Ln(4, 5, "S2")],
        surveys: [{ id: "S1", no: 1, name: "Pier" }, { id: "S2", no: 2, name: "" }, { id: "S3", no: 3, name: "" }] });
    draw((lat, lon) => ({ x: Math.round((lat - 44.9) * 1e4), y: 0 }));
    const texts = calls.filter((c) => c[0] === "fillText").map((c) => c[1] + "@" + c[2]);
    const fills = calls.filter((c) => c[0] === "fill").map((c) => c[1]);
    check("14. the chart names each survey beside its FIRST line's start - 'S1 Pier' at line 1, 'S2' at its own first "
          + "line - the one being edited in the editor's cyan, marked so; a survey with no lines is not drawn",
          () => JSON.stringify(texts) === JSON.stringify(["S1 Pier@5", "S2 — editing@9"])
                && fills[fills.length - 2] === "#ffd76a" && fills[fills.length - 1] === "#39c0ff",
          () => JSON.stringify(texts) + " " + JSON.stringify(fills));
  }

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED of " + ran : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();

// A page world whose env (the elements, the notes, the confirmation answer) the checks can reach.
function pageWorldWithEnv() {
  const els = {};
  for (const id of ["sv_table", "sv_head", "sv_note", "sp_mindepth", "sp_maxdepth", "sp_lead_mode", "sp_lead_in",
                    "sp_lead_out", "sp_turn_ease", "sp_align", "sp_add", "sp_hint"]) els["#" + id] = el(id);
  els["#sp_mindepth"].value = "2";
  const env = { els, log: { notes: [], asked: [], saves: 0, modes: [] }, answer: true, SVM: SV, G,
                document: { activeElement: null } };
  const w = buildWorld(env);
  return { w, env };
}
function buildWorld(env) {
  // eslint-disable-next-line no-new-func
  const f = new Function("env", "\"use strict\";\n"
    + "const $ = (s) => env.els[s]; const document = env.document;\n"
    + "const {replaceSurvey, moveSurvey, removeSurvey, surveyLabel, normalizeSurveys} = env.SVM;\n"
    + "const llEN = env.G.llEN, distTo = env.G.distTo;\n"
    + "const fmtDist = (m) => Math.round(m) + ' m';\n"
    + "let mission = {lines: [], waypoints: [], surveys: [], lead_mode: 'm', lead_in: 0, lead_out: 0, turn_ease: 'arc'};\n"
    + "let planKind = null; const NO_LEAD = {in: 0, out: 0};\n"
    + "let patClip = null, patTransits = [], patLead = [], patRepunchT = null, punchInFlight = null, drawn = [];\n"
    + "let patRed = [], patJoined = true, patDropped = null, patFunnel = null; let turnSlowAt = {}; let ANCHORS = null;\n"
    + "let pat = {A: null, B: null, C: null, align: 0}, mode = 'pan', boundary = [], boundaryClosed = false, boundDrag = null;\n"
    + decl(/^let editingSv = [^;]*;/m) + "\n" + decl(/^let cardSv = [^;]*;/m) + "\n"
    + decl(/^const LEAD_MAX_M = [^;]*;/m) + "\n" + decl(/^const LINE_PART_OFFSET_M = [^;]*;/m) + "\n"
    + decl(/^let _drawnLines = [^;]*;/m) + "\n" + decl(/^let _svTableKey = [^;]*;/m) + "\n"
    + "const flushRepunch = async () => {}; const updatePatReadout = () => {};\n"
    + "const currentPattern = () => ({anchors: ANCHORS}); const patSourceLines = () => drawn;\n"
    + "const resetPattern = () => { editingSv = null; pat = {A: null, B: null, C: null, align: pat.align}; patClip = null; };\n"
    + "const recalcCommittedForSpeed = () => {}; const saveMission = () => { env.log.saves++; };\n"
    + "const render = () => {}; const renderLineTable = () => {}; const showBanner = () => {};\n"
    + "const flashNote = (t) => env.log.notes.push(t);\n"
    + "const guiConfirm = (title, msg, opts) => { env.log.asked.push({title, msg, opts}); return Promise.resolve(env.answer); };\n"
    + "const setMode = (m) => { env.log.modes.push(m); mode = m; };\n"
    + "const updateLeadNote = () => {}; const updateEaseNote = () => {};\n"
    + ["rocEsc", "depthRange", "boundaryActive", "lineSetKey", "linePartContinues", "drawnLines", "lineNo", "lineCount",
       "committedPatternInfo", "surveySettingsNow", "applySurveySettings", "surveyById", "surveyFigures",
       "renderSurveyTable", "cardSurveyId", "surveysChanged", "editSurvey", "deleteSurvey", "moveSurveyRow",
       "renameSurvey", "emptyPunchRefusal", "punchRefusal", "commitPattern"].map(grab).join("\n")
    + "\nreturn { get mission(){ return mission; }, set mission(v){ mission = v; },"
    + " get editingSv(){ return editingSv; }, set editingSv(v){ editingSv = v; }, get cardSv(){ return cardSv; },"
    + " set cardSv(v){ cardSv = v; }, get pat(){ return pat; }, get boundary(){ return boundary; },"
    + " get boundaryClosed(){ return boundaryClosed; }, setBoundary: (b) => { boundary = b; boundaryClosed = b.length >= 3; },"
    + " commitPattern, editSurvey, deleteSurvey, moveSurveyRow, renameSurvey, renderSurveyTable, cardSurveyId,"
    + " committedPatternInfo, surveySettingsNow, applySurveySettings,"
    + " set: (o) => { patClip = o.clip || null; patTransits = o.transits || []; patLead = o.lead || [];"
    + "   drawn = o.drawn || []; ANCHORS = o.anchors || null; } };");
  return f(env);
}
