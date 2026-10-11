// tests/survey_break.js - a survey broken off for a return home is recorded, and CONTINUE picks it up 100 m back.
//
// Andy, 2026-10-11: "When an ASV breaks off a survey to RTH for refueling the survey departure point must be recorded.
// On refuel, the option to regain the survey from the break off point minus 100m for overlap coverage must be
// presented. The ASV will then proceed to continue or complete the initial survey. From the users point of view I
// envision a "Continue" button next to the "Start" button. But a survey selection process may have to be put in place."
//
// The page's own functions are lifted out and driven, with stubs for the console and the planner:
//   1-1d  the RECORD (surveyBreakNow): taken only for a survey under way with something left to fly - its line's ends,
//         how far along and which way, the remainder from the waypoint she was heading for, its survey, her level -
//         a paused run's from the press of Pause, a break between lines with no line; nothing for another behavior,
//         a hold, or the end of the plan;
//   2     BANKED on the plan (bankBreak): newest first, one per survey, three in all, saved;
//   3     the REFUEL gate (breakReady): a fuel break-off waits until her level is up 2% of the tank since she broke
//         off; an RTH of the operator's, or a vessel that reports no level, does not wait;
//   4-4b  THE POINT (breakTail): 100 m back down her line on the side she came from, ON the line - clamped at the line's
//         start when she broke off nearer it than that - then the remainder;
//   5-5e  CONTINUE (continueSurvey): the way in routed and put in front, uploaded, started as a fresh run without a
//         second question, the record spent - and on every failure (no route, a refused upload, a Start that did not
//         start, a boat commanded meanwhile) nothing more sent and the record KEPT;
//   6-6b  the wiring: doRTH takes the record before its first await and banks it only after the RTH took, never for
//         the end-of-plan chain; the fuel monitor's RTH is a "fuel" break-off; the button sits beside Start; Start's
//         own pause-resume and question are skipped only for Continue; the plan's loader keeps the records.
//   (The plan store's side - saved, loaded, refused in words - is tests/mission_store.py 17-17b.)
//
// TEETH - fifteen mutations RUN on scratch copies of static/, tests/ and vessels/, all caught (the first cut of check 2
// let 'a survey keeps every break-off' SURVIVE: its sequence answered the same with or without the rule - rewritten):
//   rejoined 100 m FORWARD, over water not yet run          -> 4, 4b, 5
//   no overlap: rejoined where she broke off                -> 4, 4b, 5
//   the end-of-plan chain records a break-off               -> 6
//   the fuel RTH not named a fuel break-off                 -> 6
//   a survey holding is recorded                            -> 1d
//   a paused run's mark read again (her drift)              -> 1b
//   the remainder one waypoint short                        -> 1, 1c
//   a survey keeps every break-off                          -> 2
//   no refuel wait                                          -> 3, 5d
//   no level reported waits for ever                        -> 0 (the suite crashes on the level it cannot print)
//   not asked again after the awaits                        -> 5c
//   the record spent before the Start                       -> 5b
//   the way in not put in front                             -> 5
//   Start resumes the old pause                             -> 5
//   the loader drops the break-offs                         -> 6b

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
const APP = path.join(__dirname, "..");
const H = fs.readFileSync(process.env.ASV_HTML || path.join(APP, "static", "asv.html"), "utf8");   // a sweep's sidecar, or the page
const GD = require(path.join(APP, "static", "js", "geodesy.js"));
const F = require(path.join(APP, "static", "js", "fuel.js"));
const SV = require(path.join(APP, "static", "js", "surveys.js"));

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = "THREW: " + e.message; }
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw: " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  const start = H.search(new RegExp("(async )?function " + name + "\\("));
  if (start < 0) throw new Error("function " + name + " not found in the page (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
const decl = (name) => { const m = new RegExp("const " + name + " = [^;]+;").exec(H); if (!m) throw new Error(name + " gone"); return m[0]; };

// a plane about a point off Portsmouth: meters east / north
const REF = { lat: 43.07, lon: -70.71 };
const fr = GD.planeFrame(REF);
const LL = (e, n) => fr.fromEN(e, n), EN = (p) => fr.toEN(p);
// the plan: line 1 east from (0,0) to (400,0), a turn, line 2 west at n = 50; each line tagged S2
const LA = LL(0, 0), LB = LL(400, 0), L2A = LL(400, 50), L2B = LL(0, 50);
const LINES = [{ a: LA, b: LB, sv: "S2" }, { a: L2A, b: L2B, sv: "S2" }];
const ROUTE = [LL(-150, -80), { ...LA, sv: "S2" }, { ...LB, sv: "S2" }, { ...LL(440, 25), turn: true }, { ...L2A, sv: "S2" }, { ...L2B, sv: "S2" }];

// ONE world: the page's functions with the console stubbed round them; `o` sets the stubs a check needs
function world(o) {
  const w = Object.assign({
    S: { behavior: "survey", run: "running", status: { fuel_l: 60, holding: false }, armed: true, estop: false },
    asv: LL(129, 0), wpIndex: 2, runLineIdx: 0, pauseMark: null, mission: { lines: LINES, surveys: [{ id: "S2", no: 2, name: "North" }], breaks: [] },
    calls: [], banners: [], notes: [], saves: 0, canCommand: true,
    plan: (from, to) => ({ route: [LL(-100, -40), to] }),          // the router: a detour, then the target
    upload: { ok: true }, start: true,
  }, o || {});
  const v = { VESSEL: JSON.parse(fs.readFileSync(path.join(APP, "vessels", "drix08_em712.json"), "utf8")), SPEED_KN: { high: 10 } };
  const src = [
    "const {distTo, azTo, atDA} = GD, {energyModel, energyLevel, FUEL_REARM_FRAC} = F, {svOf} = SV;",
    "let S = w.S, asv = w.asv, mission = w.mission, pauseMark = w.pauseMark, runLineIdx = w.runLineIdx, runRoute = w.route || null, runUnsafe = [], planIntent = null;",
    "const window = {_wpIndex: w.wpIndex};",
    "const V = w.V, LINE_MATCH_M = 1;",
    "const fuelModel = () => energyModel(V.VESSEL, 10);",
    "const fuelFmt = (m, x) => x.toFixed(1) + ' ' + m.unit, fmtDist = (m) => m.toFixed(1) + ' m';",
    "const indexedRoute = () => runRoute;",
    "const surveyById = (id) => (mission.surveys || []).find((s) => s.id === id) || null;",
    "const lineNo = (k) => k + 1;",
    "const alongLineM = (L, p) => { const a = GD.toEN(L.a, L.a), b = GD.toEN(L.b, L.a), q = GD.toEN(p, L.a), len = Math.hypot(b.e - a.e, b.n - a.n); return ((q.e - a.e) * (b.e - a.e) + (q.n - a.n) * (b.n - a.n)) / len; };",
    "const saveMission = () => { w.saves++; }, logClient = (k, d) => w.calls.push(['log', k, d]);",
    "const flashNote = (t) => w.notes.push(t), showBanner = (t) => w.banners.push(t), takeDownBanner = () => {}, render = () => {};",
    "const applyCmdState = () => {}, canCommand = () => w.canCommand, supervising = () => true, setTip = () => {};",
    "const guiConfirm = async () => true, ensureNogoCovers = async () => true;",
    "const holdOpts = () => ({}), patClipBufM = () => 5, holdClearAt = () => 7, tailEndsAtHold = () => false, routeTooLong = () => false;",
    "const planNogoRoute = (from, to) => w.plan(from, to);",
    "const planInsideChart = async (pts, opts, plan) => plan();",
    "const planWhy = (p) => p && p.error, heldOffWhy = () => 'it is held off';",
    "const notTookSay = (r) => 'REFUSED: ' + (r && r.error);",
    "const took = (r) => !!(r && r.ok);",
    "const cmd = async (path, body) => { w.calls.push(['cmd', path, body]); if (w.onCmd) w.onCmd(path); return path === '/api/cmd/upload' ? w.upload : {ok: true}; };",
    "const dropCornerSlow = (why) => w.calls.push(['corner', why]);",
    "const setPlanIntent = (k, p, r) => { planIntent = {kind: k, why: [], route: r.length}; };",
    "const legStartsHere = () => {};",
    "const startRun = async (opts) => { w.calls.push(['start', opts]); return w.start; };",
    decl("SURVEY_BREAK_BACK_M"), decl("BREAKS_MAX"),
    "let breakSel = null, continueBusy = false, breakReadySaid = null;",
    grab("lineMark"), grab("resumePointOn"),
    grab("surveyBreakNow"), grab("bankBreak"), grab("breakList"), grab("breakSelected"), grab("breakLabel"),
    grab("breakReady"), grab("breakTail"), grab("continueSurvey"),
    "return {now: (why) => surveyBreakNow(why), bank: bankBreak, ready: breakReady, tail: breakTail, cont: continueSurvey,",
    "        mission: () => mission, runRoute: () => runRoute, setS: (s) => { S = s; w.S = s; }, setAsv: (p) => { asv = p; } };",
  ].join("\n");
  w.V = v;
  w.api = new Function("w", "GD", "F", "SV", src)(w, GD, F, SV);
  return w;
}

console.log("A survey broken off for a return home, and Continue:");

// ── 1. THE RECORD ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  // running east down line 1, 129 m along it, heading for its end (route index 2)
  const W = world({ route: ROUTE });
  const r = W.api.now("fuel");
  check("1. A SURVEY UNDER WAY BROKEN OFF IS RECORDED: its line's own ends, how far along it and which way, the remainder "
        + "from the waypoint she was heading for, its survey (S2) and her level - and the record names why",
        () => r && r.why === "fuel" && r.sv === "S2" && r.no === 2 && r.name === "North" && r.line_no === 1
              && Math.abs(r.line.along - 129) < 0.5 && r.line.fwd === 1 && GD.distTo(r.line.a, LA) < 0.01 && GD.distTo(r.line.b, LB) < 0.01
              && r.route.length === 4 && GD.distTo(r.route[0], LB) < 0.01 && r.route[1].turn === true && r.level === 60 && r.unit === "L",
        () => JSON.stringify({why: r && r.why, sv: r && r.sv, line_no: r && r.line_no, along: r && r.line && Math.round(r.line.along), fwd: r && r.line && r.line.fwd, wpts: r && r.route.length, level: r && r.level}));
  // paused: the mark from the press of Pause, not where she has drifted to
  const P = world({ route: ROUTE, S: { behavior: "survey", run: "paused", status: { fuel_l: 60 } }, asv: LL(300, 30),
                    pauseMark: { line: 0, along: 129, fwd: 1, at: LL(129, 0) } });
  const rp = P.api.now("rth");
  check("1b. ... a PAUSED run's from the press of Pause - not where she has drifted to since - and an operator's RTH "
        + "says so ('rth')",
        () => rp && rp.why === "rth" && rp.line && Math.abs(rp.line.along - 129) < 0.5,
        () => "along " + (rp && rp.line && rp.line.along) + " (she has drifted to 300 m), why " + (rp && rp.why));
  // between lines (on the turn): no line, the remainder from the turn's waypoint
  const T = world({ route: ROUTE, runLineIdx: -1, asv: LL(430, 20), wpIndex: 3 });
  const rt = T.api.now("fuel");
  check("1c. ... broken off BETWEEN lines (on a turn): no line - nothing to back down - and the remainder from the turn on",
        () => rt && rt.line === null && rt.line_no === null && rt.route.length === 3 && rt.route[0].turn === true,
        () => JSON.stringify({line: rt && rt.line, wpts: rt && rt.route.length}));
  const none = [
    world({ route: ROUTE, S: { behavior: "goto", run: "running", status: {} } }).api.now("rth"),
    world({ route: ROUTE, S: { behavior: "survey", run: "running", status: { holding: true } } }).api.now("rth"),
    world({ route: ROUTE, wpIndex: 6 }).api.now("rth"),
    world({ route: ROUTE, S: { behavior: "survey", run: "idle", status: {} } }).api.now("rth"),
  ];
  check("1d. ... and NOTHING is recorded for another behavior, a survey holding (its end, or a hold), the end of the "
        + "plan, or a run not under way",
        () => none.every((x) => x === null),
        () => JSON.stringify(none));
}

// ── 2. BANKED ON THE PLAN ─────────────────────────────────────────────────────────────────────────────────────────
{
  const W = world({ route: ROUTE });
  const rec = (sv, t) => ({ id: "B" + t, t, why: "fuel", sv, no: 1, route: [LB], line: null });
  // one per survey: S2 broken off twice keeps only its later record (a list that kept both would read B3,B2,B1)
  W.api.bank(rec("S1", 1)); W.api.bank(rec("S2", 2)); W.api.bank(rec("S2", 3));
  const per = W.api.mission().breaks.map((b) => b.id).join(",");
  // three in all: a fourth survey's pushes the oldest out
  const C = world({ route: ROUTE });
  C.api.bank(rec("S1", 1)); C.api.bank(rec("S2", 2)); C.api.bank(rec("S3", 3)); C.api.bank(rec("S4", 4));
  const cap = C.api.mission().breaks.map((b) => b.id).join(",");
  check("2. BANKED ON THE PLAN: newest first, ONE per survey (a later break-off of S2 replaces its earlier one), three in "
        + "all, and saved",
        () => per === "B3,B1" && cap === "B4,B3,B2" && W.saves === 3,
        () => "S1, S2, S2 -> " + per + " (want B3,B1); four surveys -> " + cap + " (want B4,B3,B2); saves " + W.saves);
}

// ── 3. THE REFUEL GATE ────────────────────────────────────────────────────────────────────────────────────────────
{
  const W = world({ route: ROUTE });
  const b = { id: "B1", why: "fuel", level: 49.6, unit: "L", route: [LB] };
  const at = (fuel) => { W.api.setS({ behavior: "rth", run: "running", status: { fuel_l: fuel, holding: true } }); return W.api.ready(b); };
  const r1 = at(50), r2 = at(54.5), r3 = at(55), r4 = at(null);
  const op = W.api.ready({ id: "B2", why: "rth", level: 49.6, unit: "L", route: [LB] });
  check("3. THE REFUEL GATE: a fuel break-off waits until she is refueled - her level up 2% of the 250 L tank (5 L) since "
        + "she broke off at 49.6 L - and says so; a vessel reporting no level, or an operator's RTH, does not wait",
        () => !r1.ok && /REFUELED/.test(r1.why) && !r2.ok && r3.ok && r4.ok && op.ok,
        () => "50 L: " + r1.ok + ", 54.5: " + r2.ok + ", 55: " + r3.ok + ", no level: " + r4.ok + ", operator's: " + op.ok);
}

// ── 4. THE POINT ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const W = world({ route: ROUTE });
  const rec = (along, fwd) => ({ id: "B", why: "rth", route: [LB, L2A], line: { a: LA, b: LB, along, fwd } });
  const t = W.api.tail(rec(129, 1)), p = EN(t.to);
  const back = W.api.tail(rec(260, -1)), pb = EN(back.to);
  const early = W.api.tail(rec(40, 1)), pe = EN(early.to);
  const noLine = W.api.tail({ id: "B", route: [LB, L2A], line: null });
  check("4. THE POINT: 100 m back down her line on the side she came FROM, ON the line - 29 m along at 129 m heading "
        + "east; 360 m along at 260 m heading west - then the remainder",
        () => Math.abs(p.e - 29) < 0.2 && Math.abs(p.n) < 0.2 && t.backedM === 100 && t.tail.length === 3 && GD.distTo(t.tail[1], LB) < 0.01
              && Math.abs(pb.e - 360) < 0.2 && Math.abs(pb.n) < 0.2,
        () => "east: " + p.e.toFixed(1) + " m (" + t.backedM + " back), west: " + pb.e.toFixed(1) + " m");
  check("4b. ... CLAMPED at the line's start when she broke off nearer it than 100 m (40 m along: back to its start, 40 m "
        + "of overlap), and a break-off between lines starts from its remainder",
        () => Math.abs(pe.e) < 0.2 && Math.abs(early.backedM - 40) < 1e-6 && noLine.to === null && noLine.tail.length === 2,
        () => "40 m along -> " + pe.e.toFixed(1) + " m, " + early.backedM + " back; no line -> " + noLine.tail.length + " waypoints");
}

// ── 5. CONTINUE ───────────────────────────────────────────────────────────────────────────────────────────────────
const REC = () => ({ id: "B1", t: 1, why: "fuel", sv: "S2", no: 2, name: "North", line_no: 1,
                     line: { a: LA, b: LB, along: 129, fwd: 1 }, route: [LB, L2A, L2B], level: 49.6, unit: "L" });
const homeAt = (o) => world(Object.assign({ asv: LL(-200, -100),
  S: { behavior: "rth", run: "running", armed: true, status: { fuel_l: 250, holding: true } } }, o || {}));
(async () => {
  {
    const W = homeAt(); W.mission.breaks = [REC()];
    await W.api.cont();
    const up = W.calls.find((c) => c[0] === "cmd" && c[1] === "/api/cmd/upload"), st = W.calls.find((c) => c[0] === "start");
    const route = up && up[2].route, p2 = route && EN(route[1]);
    check("5. CONTINUE: the way in routed and put in front (the router's detour), then the line 100 m back from the "
          + "break-off (29 m along), then what she had left - uploaded, started as a FRESH run without a second question - "
          + "and the record SPENT and saved",
          () => route && route.length === 5 && Math.abs(p2.e - 29) < 0.2 && Math.abs(p2.n) < 0.2 && GD.distTo(route[2], LB) < 0.01
                && st && st[1].fresh === true && st[1].confirmed === true && W.mission.breaks.length === 0 && W.saves === 1
                && /SURVEY CONTINUED/.test(W.banners[W.banners.length - 1] || ""),
          () => "route " + (route ? route.length : "none") + " (want 5), rejoin " + (p2 ? p2.e.toFixed(1) : "-") + " m along, start "
              + JSON.stringify(st && st[1]) + ", breaks left " + W.mission.breaks.length);
  }
  {
    const W = homeAt({ plan: () => ({ error: "no clear route to the target" }) }); W.mission.breaks = [REC()];
    await W.api.cont();
    const U = homeAt({ upload: { ok: false, refused: true, error: "ARM before uploading a plan" } }); U.mission.breaks = [REC()];
    await U.api.cont();
    const N = homeAt({ start: false }); N.mission.breaks = [REC()];
    await N.api.cont();
    const sent = (x) => x.calls.filter((c) => c[0] === "cmd").map((c) => c[1]);
    check("5b. ... and on a FAILURE the break-off is KEPT and nothing more is sent: no way in (nothing at all), a refused "
          + "upload (no Start), a Start that did not start (uploaded, said so)",
          () => sent(W).length === 0 && W.mission.breaks.length === 1 && /CANNOT CONTINUE/.test(W.banners.join(" "))
                && sent(U).join() === "/api/cmd/upload" && !U.calls.some((c) => c[0] === "start") && U.mission.breaks.length === 1
                && N.mission.breaks.length === 1 && /did NOT start/.test(N.banners.join(" ")),
          () => "no route: sent " + JSON.stringify(sent(W)) + "; refused upload: " + JSON.stringify(sent(U)) + "; start failed: kept "
              + N.mission.breaks.length);
  }
  {
    // commanded while the way in was being planned: the router's call flips the world under it
    const W = homeAt(); W.mission.breaks = [REC()];
    W.plan = (from, to) => { W.canCommand = false; return { route: [to] }; };
    await W.api.cont();
    check("5c. ... and one COMMANDED, DISARMED OR STOPPED while the way in was being planned is not uploaded over: asked "
          + "again after the awaits, nothing sent, the break-off kept",
          () => !W.calls.some((c) => c[0] === "cmd") && W.mission.breaks.length === 1 && /NOT CONTINUED/.test(W.banners.join(" ")),
          () => "sent " + JSON.stringify(W.calls.filter((c) => c[0] === "cmd").map((c) => c[1])));
  }
  {
    // not refueled: no Continue at all; under way: no Continue
    const W = homeAt({ S: { behavior: "rth", run: "running", armed: true, status: { fuel_l: 50, holding: true } } }); W.mission.breaks = [REC()];
    await W.api.cont();
    const U = homeAt({ S: { behavior: "goto", run: "running", armed: true, status: { fuel_l: 250, holding: false } } }); U.mission.breaks = [REC()];
    await U.api.cont();
    check("5d. ... and it is not CONTINUED before she is refueled, nor while she is under way on something else",
          () => !W.calls.some((c) => c[0] === "cmd") && /REFUELED/.test(W.notes.join(" ")) && !U.calls.some((c) => c[0] === "cmd")
                && /under way/.test(U.notes.join(" ")),
          () => "unrefueled: " + W.notes.join(" | ").slice(0, 80) + "; under way: " + U.notes.join(" | ").slice(0, 60));
  }

  // ── 6. THE WIRING ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    const R = grab("doRTH"), firstAwait = R.indexOf("await "), take = R.indexOf("surveyBreakNow("), bank = R.indexOf("bankBreak(brk)");
    const tookAt = R.lastIndexOf("if(!took(r)){", bank);
    check("6. doRTH takes the record BEFORE its first await (before the RTH replaces the plan aboard), never for the "
          + "end-of-plan chain, and banks it only AFTER the RTH took; the fuel monitor's RTH is a 'fuel' break-off",
          () => take > 0 && take < firstAwait && /const brk = chained \? null : surveyBreakNow\(opts && opts\.breakWhy\);/.test(R)
                && bank > tookAt && tookAt > 0 && /breakWhy: "fuel"/.test(grab("fuelTick")),
          "doRTH / fuelTick");
    const bar = H.slice(H.indexOf('id="b_start"'), H.indexOf('id="b_pause"'));
    check("6b. CONTINUE sits beside Start; Start skips its pause-resume and its question only for Continue's fresh, "
          + "already-confirmed plan; the plan's loader keeps the break-offs (or the next save would drop them)",
          () => /id="b_continue"/.test(bar) && /id="b_contSel"/.test(bar) && /id="b_contDrop"/.test(bar)
                && /if\(S && S\.run === "paused" && !fresh\) return resumeRun\(\);/.test(grab("startRun"))
                && (H.match(/fresh: true/g) || []).length === 1 && /fresh: true/.test(grab("continueSurvey"))
                && /if\(!confirmed && !await guiConfirm\("Start the autonomous survey"/.test(grab("startRun"))
                && /breaks:Array\.isArray\(m\.breaks\) \? m\.breaks : \[\]/.test(grab("loadMission"))
                && /renderBreakControls\(armed, estop, underWay\)/.test(grab("applyCmdState")),
          "the command bar / startRun / loadMission / applyCmdState");
  }
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
