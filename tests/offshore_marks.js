// tests/offshore_marks.js - AN OFFSHORE MARK IS KEPT BETWEEN HER AND THE DANGER IT MARKS (2026-10-12).
//
// Andy, on his Go-To past Thacher Island off Rockport: "Path planning should have run the ASV between these buoys ... and
// especially not over the shallow spot", and then: "offshore buoys are to be handled differently than channel buoys. They
// are meant to guide vessels away from danger rather than route them down a constrained path". Oak Rock Buoy 2 (red) and
// Thacher Island Buoy 1 (green), 335 m apart, each the only mark of its name: the marks stage read no direction of buoyage
// for either and left both alone, and her route ran 90 m west of Oak Rock 2 - outside the pair, over the 5.4-9.1 m patch,
// Oak Rock (1.8 m) 158 m off. routing.js now keeps such a mark - one with no direction read and no channel about it -
// between her and the charted danger beside it (offshoreDangerSide), given a berth, never brought close, never a buoyed
// reach's edge, and counts it apart from the Rule 9 marks (tallyMarks `offshore` / `offshoreWrong`).
//
// THE REAL CHART: tests/fixtures/enc_oak_rock.json, his own tile's features about the two buoys (clipped to a box), built
// through the console's buildKeepouts at his settings that evening - the DriX EM712, Min depth 4.0 m, +0.33 m of water.
//
//   node tests/offshore_marks.js      # exit 0 = pass, 1 = fail   (stdlib Node)

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
const JS = (f) => path.join(APP, "static", "js", f);
const { V, nogo, sea } = require(JS("state.js"));
const { planeFrame } = require(JS("geodesy.js"));
const { buildKeepouts, buildMargin, legClear } = require(JS("chart.js"));
const { bbOf } = require(JS("geometry.js"));
const P = require(JS("passage.js"));
const R = require(JS("routing.js"));
const ASV_HTML = process.env.ASV_HTML || path.join(APP, "static", "asv.html");
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
const f1 = (x) => (x == null ? "null" : (+x).toFixed(1));

// ── THE REAL CHART ───────────────────────────────────────────────────────────────────────────────────────────────
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "enc_oak_rock.json"), "utf8"));
const [W, S, E, N] = FIX.box;
const F = planeFrame({ lat: 42.642, lon: -70.582 });
const ENF = { land: true, depth: true, haz: true, area: false, wreck: true, chan: true };
V.NOGO_MIN_DEPTH_M = 3.15; V.OPER_MIN_DEPTH_M = 4.0; V.NOGO_BUFFER_M = 5; V.AIR_DRAFT_M = 2.85; V.OVERHEAD_CLEARANCE_M = 1.0;
const build = (feats) => { const was = sea.waterOffset; sea.waterOffset = 0.33;
  try { return buildKeepouts(F, ENF, { min: 4.0, max: 0 }, feats); } finally { sea.waterOffset = was; } };
const KO = build(FIX.features);
const BOX = { W: W + 0.002, S: S + 0.002, E: E - 0.002, N: N - 0.002 };
const chart = (ko) => Object.assign(nogo, { ready: true, frame: F, ko, buffer: 5, bbox: BOX, unread: null, ais: null });
const en = (ll) => F.toEN(ll);
const OAK = en({ lat: 42.64041, lon: -70.58413 }), THA = en({ lat: 42.6392, lon: -70.58005 });
const NORTH = { lat: 42.6520, lon: -70.5855 }, SOUTH = { lat: 42.6320, lon: -70.5840 };
const O = { holdR: 20, setMs: 0, standoffM: 20 };
// her route at the pair's own latitude, and the 5.4-9.1 m patch's polygon (the "shallow spot")
const atGate = (route) => {
  const pts = route.map(en), n0 = (OAK.n + THA.n) / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.n - n0) * (b.n - n0) <= 0 && a.n !== b.n) return a.e + (b.e - a.e) * (n0 - a.n) / (b.n - a.n);
  }
  return null;
};
const pip = (p, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
  if ((ring[i].n > p.n) !== (ring[j].n > p.n) && p.e < (ring[j].e - ring[i].e) * (p.n - ring[i].n) / (ring[j].n - ring[i].n) + ring[i].e) c = !c; return c; };
const patches = FIX.features.filter((f) => f.role === "depth_area" && f.props.DRVAL1 === 5.4)
  .flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0])))
  .map((ring) => ring.map(([lon, lat]) => en({ lat, lon })));
const overPatch = (route) => { const pts = route.map(en);
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.e - a.e, b.n - a.n) / 5));
    for (let k = 0; k <= n; k++) { const q = { e: a.e + (b.e - a.e) * k / n, n: a.n + (b.n - a.n) * k / n };
      if (q.n > Math.min(OAK.n, THA.n) - 150 && q.n < Math.max(OAK.n, THA.n) + 150 && patches.some((r) => pip(q, r))) return true; } }
  return false; };
const legsClear = (route, ko) => { const pts = route; for (let i = 1; i < pts.length; i++) if (!legClear(pts[i - 1], pts[i], F, ko, 5)) return false; return true; };
const oaks = (r) => (r.marks || []).filter((k) => /oak rock|thacher island/.test(k.m.sys || ""));

console.log("Offshore marks: kept between her and the danger each marks:");
chart(KO);
const south = P.planNogoRoute(NORTH, SOUTH, O), north = P.planNogoRoute(SOUTH, NORTH, O);
const eS = atGate([NORTH, ...south.route]), eN = atGate([SOUTH, ...north.route]);
const berth = R.MARK_PORT_BERTH * R.MARK_PASS_M(5, 0);
// (the 5.4-9.1 m patch about Oak Rock reaches further east of the red than its berth: she still crosses its edge, said in
// the detail below - keeping her off water that shallow is the deep-water-first step's, not this one's)
check("1. HIS GO-TO'S WATER, BOUND SOUTH: the route passes BETWEEN Oak Rock Buoy 2 and Thacher Island Buoy 1 - each kept between "
      + "her and the danger beside it, the red its berth off; both counted as OFFSHORE marks kept, none as a Rule 9 mark, and "
      + "no lane claimed; every leg clear",
      () => !south.error && eS > OAK.e + berth - 1 && eS < THA.e - 1
            && south.how.marks.offshore === 2 && south.how.marks.offshoreWrong === 0 && south.how.marks.kept === 0
            && south.lane === false && legsClear([NORTH, ...south.route], KO),
      () => "at the pair: " + f1(eS - OAK.e) + " m east of Oak Rock 2, " + f1(THA.e - eS) + " m west of Thacher Island 1 (berth "
            + f1(berth) + "); over the patch " + overPatch([NORTH, ...south.route]) + "; " + JSON.stringify(south.how.marks) + ", lane " + south.lane);
check("2. ... AND BOUND NORTH THE SAME: between them - an offshore mark's hand is read from where its danger lies, not from a "
      + "direction of buoyage, so either way she goes it puts her on the safe side of each",
      () => !north.error && eN > OAK.e + berth - 1 && eN < THA.e - 1
            && north.how.marks.offshore === 2 && north.how.marks.offshoreWrong === 0,
      () => "at the pair: " + f1(eN - OAK.e) + " m east of Oak Rock 2, " + f1(THA.e - eN) + " m west of Thacher Island 1; over the patch "
            + overPatch([SOUTH, ...north.route]) + "; " + JSON.stringify(north.how.marks));
const ok1 = oaks(south);
check("3. NEVER BROUGHT CLOSE, NEVER A CHANNEL: both offshore marks are governed with `pull` off (no close pass, as a channel's "
      + "starboard buoy gets), the red given the berth of a mark left to port; and no buoyed reach is laid between them",
      () => ok1.length === 2 && ok1.every((k) => k.offshore && k.pull === false && !k.skip)
            && ok1.find((k) => /oak/.test(k.m.sys)).keepStbd === true && ok1.find((k) => /thacher/.test(k.m.sys)).keepStbd === false
            && south.how.reach === false,
      () => ok1.map((k) => k.m.sys + ": " + (k.keepStbd ? "starboard" : "port") + ", pull " + k.pull + ", offshore "
            + JSON.stringify(k.offshore && { stbdM: f1(k.offshore.stbdM), portM: f1(k.offshore.portM) })).join("; ") + "; reach " + south.how.reach);
// 4. THE CONTROL: the same water with the dangers the buoys mark taken off the chart - the stage has no danger to keep her
// off, says nothing, and the search's own route stands: OUTSIDE the pair, as his Go-To ran.
const bare = build(FIX.features.filter((f) => !(f.role === "hazard_point" || f.role === "land" || f.role === "shore_line"
                                                || f.role === "land_point" || f.role === "hazard_area" || f.role === "depth_area")));
chart(bare);
const ctl = P.planNogoRoute(NORTH, SOUTH, O), eC = atGate([NORTH, ...ctl.route]);
chart(KO);
check("4. THE CONTROL: with nothing charted beside the buoys - no danger for either to mark - neither is governed (direction "
      + "of buoyage not known, as before) and the route is the search's own straight line, OUTSIDE the pair: it is the danger "
      + "beside a mark that puts her on its safe side",
      () => !ctl.error && oaks(ctl).every((k) => k.skip === "direction of buoyage not known" && !k.offshore)
            && (eC < OAK.e || eC > THA.e) && ctl.how.marks.offshore === 0,
      () => "at the pair: " + f1(eC - OAK.e) + " m from Oak Rock 2; " + oaks(ctl).map((k) => k.m.sys + ": " + k.skip).join("; "));

// ── offshoreDangerSide, one mark at a time ───────────────────────────────────────────────────────────────────────
const sideOf = (m, t, ko) => R.offshoreDangerSide(m, t, ko);
const sOakS = sideOf(OAK, [0, -1], KO), sThaS = sideOf(THA, [0, -1], KO), sOakN = sideOf(OAK, [0, 1], KO), sThaN = sideOf(THA, [0, 1], KO);
check("5. offshoreDangerSide ON HIS CHART: Oak Rock 2's rock lies to starboard of a vessel bound south (west of the buoy) and "
      + "Thacher Island 1's shoal water to port (east of it); bound north each flips; a buoy's own point is not its danger",
      () => sOakS.side === 1 && sThaS.side === -1 && sOakN.side === -1 && sThaN.side === 1
            && sOakS.stbdM > 40 && sOakS.stbdM < 80 && sThaS.portM > 140 && sThaS.portM < 200,
      () => "south: Oak Rock 2 " + JSON.stringify({ s: sOakS.side, stbd: f1(sOakS.stbdM), port: f1(sOakS.portM) })
            + ", Thacher 1 " + JSON.stringify({ s: sThaS.side, stbd: f1(sThaS.stbdM), port: f1(sThaS.portM) })
            + "; north: " + sOakN.side + ", " + sThaN.side);
const ring = (e0, n0, e1, n1) => { const r = [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }]; return { ring: r, bb: bbOf(r), kind: "land" }; };
const M0 = { e: 0, n: 0 };
const sym = sideOf(M0, [0, 1], { polys: [ring(50, -20, 80, 20), ring(-80, -20, -55, 20)], lines: [], points: [] });
const ahead = sideOf(M0, [0, 1], { polys: [ring(-10, 60, 10, 90)], lines: [], points: [] });
// (a polygon past OFFSHORE_DANGER_M is dropped by its box; a POINT hazard just past it - 450 m - is the reach's own test)
const none = sideOf(M0, [0, 1], { polys: [ring(500, -20, 600, 20)], lines: [], points: [{ e: 450, n: 0, r: 0, kind: "a charted hazard" }] });
const ownAndShips = sideOf(M0, [0, 1], { polys: [{ ...ring(10, -10, 30, 10), kind: "AIS: TEST SHIP (60 m)" }, { ...ring(-30, -10, -12, 10), moored: true, kind: "a vessel" }],
                                         lines: [], points: [{ e: 3, n: 0, r: 0, kind: "a channel buoy" }, { e: -60, n: 5, r: 2, kind: "a charted hazard" }] });
check("6. ... AND WHERE IT DOES NOT SAY: dangers about as near on both sides (50 m and 55 m) - no side; a danger only dead ahead "
      + "of the mark - no side; none within OFFSHORE_DANGER_M - no side; and a buoy's own point, a contact's hull and a vessel "
      + "not under way are no danger it marks (only the rock 60 m west is)",
      () => sym.side === 0 && ahead.side === 0 && none.side === 0 && ownAndShips.side === -1 && ownAndShips.stbdM === Infinity
            && R.OFFSHORE_DANGER_M === 400,
      () => "both sides " + sym.side + " (" + f1(sym.stbdM) + "/" + f1(sym.portM) + "); ahead " + ahead.side + "; none " + none.side
            + "; with buoys and hulls " + ownAndShips.side + " (stbd " + f1(ownAndShips.stbdM) + ", port " + f1(ownAndShips.portM) + ")");

// ── IN A CHANNEL IT IS NOT ONE ──────────────────────────────────────────────────────────────────────────────────
// A buoyed channel of one name, 1..4 along her track, and an unnumbered red buoy among them by the west bank: the channel's
// marks read the direction of buoyage, so the unnumbered one is no offshore mark - it is left as before (and its
// keeping is the cone's, tests/enc_channel.js 95). The same unnumbered buoy with no channel about it IS one.
const GF = planeFrame({ lat: 42.0, lon: -70.0 });
const gll = (e, n) => { const q = GF.fromEN(e, n); return { lat: q.lat, lon: q.lon }; };
const banks = [ring(-900, -1600, -200, 4600), ring(200, -1600, 900, 4600)];
const mk = (e, n, side, num, sys) => ({ e, n, side, num, sys });
const chanMarks = [mk(-150, 500, -1, 1, "test channel"), mk(150, 1000, 1, 2, "test channel"), mk(-150, 1500, -1, 3, "test channel"),
                   mk(150, 2000, 1, 4, "test channel")];
const lone = mk(-140, 1250, 1, undefined, "unnamed");
const worldOf = (marks) => ({ polys: banks, lines: [], marks, sys: [], chans: [],
                              points: marks.map((m) => ({ e: m.e, n: m.n, r: 0, kind: "a channel buoy" })) });
const up = [gll(-100, -1500), gll(-100, 4500)];
const inChan = R.markPassRoute(up, GF, worldOf(chanMarks.concat([lone])), 5, {});
const alone = R.markPassRoute(up, GF, worldOf([lone]), 5, {});
const kIn = inChan.marks.find((k) => k.m === lone), kAlone = alone.marks.find((k) => k.m === lone);
check("7. IN A CHANNEL IT IS NOT ONE: an unnumbered red buoy among a buoyed channel's marks (their direction read) is left as "
      + "before - no direction of its own, no offshore hand - while the same buoy with no channel about it is an offshore "
      + "mark, kept between her and the bank 60 m beside it",
      () => kIn && kIn.skip === "direction of buoyage not known" && !kIn.offshore
            && kAlone && !kAlone.skip && kAlone.offshore && kAlone.keepStbd === false,
      () => "in the channel: " + (kIn ? kIn.skip + ", offshore " + !!(kIn.offshore) : "none") + "; alone: "
            + (kAlone ? (kAlone.skip || "governed") + ", offshore " + !!kAlone.offshore + ", keep to " + (kAlone.keepStbd ? "starboard" : "port") : "none"));

// ── SINGLES FAR APART ARE NOT ONE CHANNEL ───────────────────────────────────────────────────────────────────────
// Off Cape Ann on his Go-To, Thacher Island Buoy 1 took a direction of buoyage from Avery Ledge Lighted Buoy 2, 3.2 km back
// along her route, and was to be passed close on the island's side; Oak Rock Buoy 2 beside it, then "in a channel", was
// left alone and crossed. A single reads a single of another name no further than MARK_SINGLE_NEIGHBOR_M along her route.
// Two singles (red 2, then green 1, each with a rock 50 m on its far side from her route): 3 km apart, each is an offshore
// mark; 600 m apart, they read each other as before, and neither is one.
const pairWorld = (gap) => {
  const ms = [mk(60, 0, 1, 2, "alpha ledge"), mk(-60, gap, -1, 1, "bravo rock")];
  return { polys: [], lines: [], marks: ms, sys: [], chans: [],
           points: ms.map((m) => ({ e: m.e, n: m.n, r: 0, kind: "a channel buoy" }))
                     .concat([{ e: 110, n: 0, r: 3, kind: "a charted hazard" }, { e: -110, n: gap, r: 3, kind: "a charted hazard" }]) };
};
const far = R.markPassRoute([gll(0, -1000), gll(0, 4000)], GF, pairWorld(3000), 5, {}).marks;
const close = R.markPassRoute([gll(0, -1000), gll(0, 1600)], GF, pairWorld(600), 5, {}).marks;
check("9. SINGLES FAR APART ARE NOT ONE CHANNEL: a red 2 and a green 1 of other names 3 km apart along her route are each an "
      + "OFFSHORE mark - kept off the rock beside it - not read from each other's numbers; 600 m apart they read each other "
      + "as before (a channel of singles, as into Little Bay), and neither is one",
      () => R.MARK_SINGLE_NEIGHBOR_M === 1500 && R.MARK_ROUTE_NEIGHBOR_M === 4000
            && far.length === 2 && far.every((k) => k.offshore && !k.skip)
            && close.length === 2 && close.every((k) => !k.offshore && (k.dir === 1 || k.dir === -1)),
      () => "3 km: " + far.map((k) => k.m.sys + " " + (k.offshore ? "offshore" : (k.skip || "dir " + k.dir))).join(", ")
            + "; 600 m: " + close.map((k) => k.m.sys + " " + (k.offshore ? "offshore" : (k.skip || "dir " + k.dir))).join(", "));

// ── THE WORDS ─────────────────────────────────────────────────────────────────────────────────────────────────────
const say1 = P.offshoreNote({ marks: { offshore: 2, offshoreWrong: 0 } }), say2 = P.offshoreNote({ marks: { offshore: 1, offshoreWrong: 1 } });
const say0 = P.offshoreNote({ marks: { kept: 3, offshore: 0 } }), rule9 = P.buoyageNote(false, false, south.how);
const banners = (H.match(/\[buoyageNote\(plan\.lane, plan\.partial, plan\.how\), offshoreNote\(plan\.how\), deepNote\(plan\.deep, fmtDist\), mooredNote\(plan\)\]/g) || []).length;
// the Intent card's own lines, DRIVEN (the page's offshoreWhy), and asked of every plan - after the lane's block, not in it
const grabFn = (name) => { const st = H.indexOf("function " + name + "("); let k = H.indexOf("{", st), dp = 0;
  for (;;) { const c = H[k]; if (c === "{") dp++; else if (c === "}") { dp--; if (!dp) break; } k++; } return H.slice(st, k + 1); };
// eslint-disable-next-line no-eval
const offshoreWhy = eval("(" + grabFn("offshoreWhy") + ")");
const why2 = offshoreWhy({ lane: false, how: { marks: { offshore: 2, offshoreWrong: 1 } } }), why0 = offshoreWhy({ how: { marks: { kept: 4 } } });
const SPI = grabFn("setPlanIntent"), iLane = SPI.indexOf("if(plan.lane){"), iCall = SPI.indexOf("w.push(...offshoreWhy(plan));");
check("8. THE WORDS: the banner says the offshore marks kept - and any NOT kept - apart from the Rule 9 claim, which a route "
      + "laned by nothing makes none of; the Go-To, RTH and transit banners all carry it; and the plan's intent card says both "
      + "of a plan that rode no lane - asked of every plan, after the lane's own lines and not inside them",
      () => say1 === "2 offshore marks kept between her and their dangers" && /1 offshore mark NOT kept between her and its danger/.test(say2)
            && say0 === "" && rule9 === "" && banners === 3
            && why2.length === 2 && why2[0].t === "lane" && /kept off the dangers of 2 offshore marks/.test(why2[0].s)
            && why2[1].t === "warn" && /^1 offshore mark NOT kept between her and the danger beside it/.test(why2[1].s) && why0.length === 0
            && iLane > 0 && iCall > iLane && SPI.indexOf("}", SPI.indexOf("Rule 9 lane ridden, but PARTIAL")) < iCall,
      () => JSON.stringify([say1, say2, say0, rule9]) + "; banners " + banners + "; card " + JSON.stringify(why2.map((x) => x.t + ": " + x.s.slice(0, 40)))
            + "; called after the lane block " + (iCall > iLane));

// ── NO REACH BETWEEN OFFSHORE MARKS ─────────────────────────────────────────────────────────────────────────────
// Two unnumbered marks in a river 400 m wide (no fairway charted, no channel's marks about), each beside its own bank: each
// is an offshore mark - the red off the west bank, the green off the east - and she is on the safe side of both already.
// They make no buoyed reach: she is not laned right of center between them (buoyedReachLane's `known`), and nothing moves.
const riverMarks = [mk(-160, 1000, 1, undefined, "unnamed"), mk(150, 1800, -1, undefined, "unnamed")];
const river = { polys: banks, lines: [], marks: riverMarks, sys: [], chans: [],
                points: riverMarks.map((m) => ({ e: m.e, n: m.n, r: 0, kind: "a channel buoy" })) };
const rv = R.channelLaneRoute([gll(-100, -1500), gll(-100, 4500)], GF, river, 5, {});
const eRiver = [1200, 1400, 1600].map((n) => { const pts = rv.route.map((q) => GF.toEN(q));
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i];
    if ((a.n - n) * (b.n - n) <= 0 && a.n !== b.n) return a.e + (b.e - a.e) * (n - a.n) / (b.n - a.n); } return null; });
check("10. NO REACH BETWEEN OFFSHORE MARKS: an unnumbered red off a river's west bank and an unnumbered green off its east, "
      + "800 m apart along her route, are both offshore marks on their safe hands - and no buoyed reach is laid between them: "
      + "she is not laned right of center, nothing moves",
      () => rv.marks.filter((k) => k.offshore).length === 2 && rv.how.reach === false && rv.how.marks.offshore === 2
            && eRiver.every((e) => e != null && Math.abs(e + 100) < 1),
      () => "offshore " + rv.marks.filter((k) => k.offshore).length + "; reach " + rv.how.reach + "; e at n 1200/1400/1600 = "
            + eRiver.map(f1).join(", ") + " (her path: -100)");

// ── THE WHOLE BERTH (Andy, 2026-10-13: "yes, hold offshore marks to the full 30 m berth") ─────────────────────────
// Live off Rockport, deep water first's route came past Oak Rock Buoy 2 already on its safe side, 15 m off: the stage moved
// her for an offshore mark only nearer than the close-pass distance (10 m at her 5 m buffer), so it left her there. An
// offshore mark is held to its whole berth now (k.min = k.want); a channel mark keeps the close pass. The live run's water
// and settings, deep water first's layer on, to its end point (its start lies within 100 m of this fixture's edge, so from
// 42.6540 N 70.5852 W): the committed code passed Oak Rock 2 at 11.8 m with no standoff and 15.9 m at 10 m.
const LIVE_A = { lat: 42.6540, lon: -70.5852 }, LIVE_B = { lat: 42.63251384542095, lon: -70.5845133544922 };
const KOM = (() => { const was = sea.waterOffset; sea.waterOffset = 0.33;
  try { return { ...KO, margin: buildMargin(F, ENF, { min: 4.0, max: 0 }, FIX.features, undefined, KO) }; } finally { sea.waterOffset = was; } })();
const passOak = (route) => { const pts = route.map(en); let d = Infinity;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.e - a.e, b.n - a.n)));
    for (let k = 0; k <= n; k++) d = Math.min(d, Math.hypot(a.e + (b.e - a.e) * k / n - OAK.e, a.n + (b.n - a.n) * k / n - OAK.n)); }
  return d; };
chart(KOM);
const live0 = P.planNogoRoute(LIVE_A, LIVE_B, { holdR: 20, setMs: 0 }), live10 = P.planNogoRoute(LIVE_A, LIVE_B, { holdR: 20, setMs: 0, standoffM: 10 });
chart(KO);
const kOak = (r) => (r.marks || []).find((k) => /oak rock/.test(k.m.sys));
const chanD = inChan.marks.filter((k) => !k.skip && !k.offshore);
check("11. THE WHOLE BERTH, ON THE SAFE SIDE TOO: on the live run's water with deep water first, Oak Rock Buoy 2 - which the "
      + "route already passed on its safe side, 12-16 m off, and was left there - is passed at its berth (30 m at her 5 m "
      + "buffer) with no standoff and at 10 m; the offshore mark's limit is its berth, a channel mark's still the close pass",
      () => !live0.error && !live10.error && passOak([LIVE_A, ...live0.route]) >= berth - 1 && passOak([LIVE_A, ...live10.route]) >= berth - 1
            && kOak(live0).min === berth && live0.how.marks.offshoreClose === 0 && live0.how.marks.offshoreWrong === 0
            && chanD.length > 0 && chanD.every((k) => k.min === R.MARK_PASS_M(5, 0)) && R.MARK_BERTH_SLACK_M === 1,
      () => "Oak Rock 2 passed " + f1(passOak([LIVE_A, ...live0.route])) + " m (no standoff), " + f1(passOak([LIVE_A, ...live10.route]))
            + " m (10 m); its limit " + f1(kOak(live0) && kOak(live0).min) + " (berth " + f1(berth) + "); channel marks' "
            + [...new Set(chanD.map((k) => k.min))].join(", "));
// ... and where the water gives her less, it is SAID: a lone red buoy, a rock 50 m east of it (bound north she keeps it to
// starboard, west of her), her line 12 m west of it, and a pier from the west shore ending 20 m west of the buoy's line 70 m
// before it - no run out to the berth clears the pier. The CONTROL, without the pier: moved out to the berth.
const lone2 = mk(0, 0, 1, undefined, "lone ledge");
const tight = (pier) => ({ polys: [ring(-900, -2000, -300, 2000), ...(pier ? [{ ...ring(-300, -80, -20, -60), kind: "a dock / pier" }] : [])],
  lines: [], points: [{ e: 0, n: 0, r: 0, kind: "a channel buoy" }, { e: 50, n: 0, r: 10, kind: "a charted rock" }],
  marks: [lone2], sys: [], chans: [] });
const GBOX2 = (() => { const a = GF.fromEN(-2500, -2500), b = GF.fromEN(2500, 2500); return { W: a.lon, S: a.lat, E: b.lon, N: b.lat }; })();
const onTight = (pier) => { Object.assign(nogo, { ready: true, frame: GF, ko: tight(pier), buffer: 5, bbox: GBOX2, unread: null, ais: null });
  const A = gll(-12, -1500), r = P.planNogoRoute(A, gll(-12, 1500), {}); return { r, v: R.markVerdicts([A, ...r.route], GF, r.marks || []) }; };
const tp = onTight(true), tc = onTight(false);
chart(KO);
const whyTight = offshoreWhy({ lane: false, how: tp.r.how });
check("12. ... AND WHERE THE WATER GIVES HER LESS, IT IS SAID: past a lone buoy 12 m off on its safe side, with a pier that "
      + "leaves no run out to the berth, the mark is still kept between her and its danger and counted INSIDE its berth - the "
      + "banner says so and the Intent card warns; the CONTROL, the same water with no pier, is moved out to the berth",
      () => !tp.r.error && tp.v.length === 1 && tp.v[0].proper && tp.v[0].inside && tp.r.how.marks.offshore === 1 && tp.r.how.marks.offshoreClose === 1
            && /kept between her and its danger - inside its berth/.test(P.offshoreNote(tp.r.how))
            && whyTight.some((w) => w.t === "warn" && /^1 offshore mark passed inside its berth/.test(w.s))
            && !tc.r.error && tc.v.length === 1 && tc.v[0].proper && !tc.v[0].inside && Math.abs(tc.v[0].x) >= berth - 1 && tc.r.how.marks.offshoreClose === 0,
      () => "with the pier: " + (tp.v[0] ? f1(tp.v[0].x) + " m, inside " + tp.v[0].inside : "none") + ", '" + P.offshoreNote(tp.r.how) + "'; card "
            + JSON.stringify(whyTight.map((w) => w.t)) + "; control " + (tc.v[0] ? f1(tc.v[0].x) + " m" : "none"));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
