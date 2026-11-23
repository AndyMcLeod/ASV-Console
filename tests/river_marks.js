// tests/river_marks.js - THE CORPS' RIVER BUOYS, NUMBERED FROM THE SAILING LINE (2026-11-23, "do the river buoy lanes").
//
// The Corps' buoy overlay (band enc_river) charts each buoy's hand and no name, so no river buoy had a number or a channel,
// and the marks stage read every one as "direction of buoyage not known": a route up a river was never asked to keep a
// buoy on its hand. keepouts.js numberRiverBuoys reads them on the river cells' sailing line (Recommended_Track_line) -
// measured, every buoy lies on its own hand's side of it - joins the line's pieces (riverSailingLines), lets the buoys
// vote the direction of buoyage, and numbers them along it as a chart numbers a channel (port-hand odd, starboard-hand
// even). It leaves them out of the pair lane's systems (they stand staggered), and gives each the direction of buoyage
// at it (`along`) for a buoy no numbered mark near it speaks for (routing.js markPassRoute).
//
// A synthetic river 440 m between its banks - 3 km north, a bend of 45 degrees to the right on a 1500 m radius, 3 km on
// north-east - with its sailing line down the middle and its buoys 70 m either side, staggered, run through the REAL
// buildKeepouts, markPassRoute and channelLaneRoute:
//   1-2    the numbering: in the direction of buoyage, port-hand odd and starboard-hand even, each the next of its
//          parity; one channel name per line that no charted name can be or prefix, and an operator's name
//   3-5    the line: its sense does not matter, its pieces are joined (one reversed, one served twice), and only where it
//          runs on - not across a 40 m gap, not round a right-angle joint
//   6-8    the vote and the limits: hands that disagree number nothing, a buoy on its wrong side is left out, too few
//          say nothing; too far off, too near, off the end: not numbered; only the river band's unnamed buoys, only the
//          river band's line
//   9-10   no pair lane (`ko.sys`), and a buoy served twice is one number
//   11-13  a route up the river along the bank side of the port-hand buoys, and the same route down it: every buoy kept
//          on its hand, on the sailing line's side of her; the buoyed reach ridden; and the control, the same chart
//          with the buoys' band gone (as before this change) - no direction of buoyage read for any of them
//   14-15  lone buoys 2 km apart, read from the line both ways - and not for a route across the river
//   16     the operator's name in the marks stage's words (markName)
//
//   node tests/river_marks.js      # exit 0 = pass, 1 = fail   (stdlib Node)

// --- crash guard: a throw outside a check() must still REPORT ------------------------
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const path = require("path");
const APP = process.env.ASV_APP || path.join(__dirname, "..");
const JS = (f) => path.join(APP, "static", "js", f);
const { planeFrame } = require(JS("geodesy.js"));
const K = require(JS("keepouts.js"));
const R = require(JS("routing.js"));

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

// ── THE RIVER ───────────────────────────────────────────────────────────────────────────────────────────────────
const F = planeFrame({ lat: 34.3, lon: -92.0 });
const LL = (q) => { const p = F.fromEN(q.e, q.n); return [p.lon, p.lat]; };
const ll = (q) => { const p = F.fromEN(q.e, q.n); return { lat: p.lat, lon: p.lon }; };
// the sailing line, upstream: 3000 m north, a 45 degree bend to the right on a 1500 m radius, 3000 m north-east
const AXIS = [];
for (let n = 0; n < 3000; n += 25) AXIS.push({ e: 0, n });
const RB = 1500, a1 = Math.PI * 3 / 4;
for (let k = 0; k <= 48; k++) { const th = Math.PI - (Math.PI / 4) * (k / 48); AXIS.push({ e: RB + RB * Math.cos(th), n: 3000 + RB * Math.sin(th) }); }
const bendEnd = { e: RB + RB * Math.cos(a1), n: 3000 + RB * Math.sin(a1) }, ne = [Math.SQRT1_2, Math.SQRT1_2];
for (let d = 25; d <= 3000; d += 25) AXIS.push({ e: bendEnd.e + ne[0] * d, n: bendEnd.n + ne[1] * d });
const CUM = [0];
for (let i = 1; i < AXIS.length; i++) CUM.push(CUM[i - 1] + Math.hypot(AXIS[i].e - AXIS[i - 1].e, AXIS[i].n - AXIS[i - 1].n));
const LEN = CUM[CUM.length - 1];
// the point at station s, x meters to the RIGHT of the upstream sense
const at = (s, x = 0) => {
  let i = 1;
  while (i < AXIS.length - 1 && CUM[i] < s) i++;
  const a = AXIS[i - 1], b = AXIS[i], L = Math.hypot(b.e - a.e, b.n - a.n), t = (s - CUM[i - 1]) / L;
  const ux = (b.e - a.e) / L, uy = (b.n - a.n) / L;
  return { e: a.e + (b.e - a.e) * t + uy * x, n: a.n + (b.n - a.n) * t - ux * x };
};
const offLine = (x, s0 = 0, s1 = LEN, step = 50) => { const out = []; for (let s = s0; s <= s1 + 1e-6; s += step) out.push(at(Math.min(s, LEN), x)); return out; };
const lineFeat = (pts, band = "enc_river") => ({ cls: "Recommended_Track_line", role: "extra", band, oid: "U37XX001:1",
  props: { INFORM: "Primary Sailing Line", TRAFIC: 4 }, geometry: { type: "LineString", coordinates: pts.map(LL) } });
const SAIL = offLine(0, 0, LEN, 50);
const shore = (x) => ({ cls: "Coastline_line", role: "shore_line", band: "enc_river", geometry: { type: "LineString", coordinates: offLine(x, 0, LEN, 50).map(LL) } });
const BANKS = [shore(-220), shore(220)];
const buoy = (s, x, cat, extra = {}) => ({ cls: "Buoy_Lateral_point", role: "chan_mark", band: "enc_river",
  props: { CATLAM: cat, COLOUR: cat === 2 ? "3" : "4" }, geometry: { type: "Point", coordinates: LL(at(s, x)) }, ...extra });
// staggered: S = starboard-hand (CATLAM 2, right of upstream), P = port-hand (CATLAM 1, left)
const HANDS = "SPSPPSSPSPSPPPS";
// (from 800 m in and 400 m apart: a buoy she is brought to needs the run in to it - markPassRoute's `span` - before it)
const STA = [...HANDS].map((_, i) => 800 + 400 * i);
const BUOYS = [...HANDS].map((h, i) => buoy(STA[i], h === "S" ? 70 : -70, h === "S" ? 2 : 1));
const EXPECT = [2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14, 15, 17, 19, 20];
const ENF = { land: true, depth: true, haz: true, area: false, wreck: true, chan: true };
const build = (feats) => K.buildKeepouts(F, feats, { enforce: ENF });
// each chart buoy's mark in the model, by its position (the model keeps the features' order)
const marksOf = (ko, buoys) => buoys.map((b) => { const q = F.toEN({ lon: b.geometry.coordinates[0], lat: b.geometry.coordinates[1] });
  return ko.marks.find((m) => Math.hypot(m.e - q.e, m.n - q.n) < 0.5); });
const nums = (ms) => ms.map((m) => (m && m.num != null ? m.num : "-")).join(",");

const KO = build([lineFeat(SAIL), ...BANKS, ...BUOYS]);
const MS = marksOf(KO, BUOYS);

// ── 1-2. THE NUMBERS ──────────────────────────────────────────────────────────────────────────────────────────────
check("1. THE NUMBERS: every buoy is numbered in the direction of buoyage (upstream, where the starboard-hand buoys lie to the "
      + "right of the sailing line), port-hand odd and starboard-hand even, each the next of its parity past the one before - "
      + "the staggered hands S P S P P S S P S P S P P P S give 2 3 4 5 7 8 10 11 12 13 14 15 17 19 20",
      () => MS.every((m) => m && m.river) && nums(MS) === EXPECT.join(","),
      () => nums(MS));
const SYS = MS[0] && MS[0].sys;
const named = buoy(800, 150, 2, { band: "enc_harbour", props: { CATLAM: 2, OBJNAM: "River Buoy 3" } });
const KON = build([lineFeat(SAIL), ...BANKS, ...BUOYS, named]);
const roots = K.markRoots(KON.marks);
check("2. ONE CHANNEL NAME PER LINE, THAT NO CHARTED NAME CAN BE OR BEGIN: one name for the line's buoys, with no space in "
      + "it, so markRoots' prefix merge cannot fold it into a charted channel named 'river' beside it (River Buoy 3), and "
      + "an operator's name for each by its hand",
      () => SYS && MS.every((m) => m.sys === SYS) && !/\s/.test(SYS) && /^~/.test(SYS)
            && KON.marks.some((m) => m.sys === "river" && m.num === 3) && roots.get(SYS) === SYS && roots.get("river") === "river"
            && MS.every((m) => m.label === (m.side > 0 ? "a starboard-hand river buoy" : "a port-hand river buoy")),
      () => "sys " + JSON.stringify(SYS) + ", its root " + JSON.stringify(roots.get(SYS)) + "; labels " + [...new Set(MS.map((m) => m && m.label))].join(" / "));

// ── 3-5. THE LINE ─────────────────────────────────────────────────────────────────────────────────────────────────
const rev = build([lineFeat(SAIL.slice().reverse()), ...BANKS, ...BUOYS]);
check("3. THE LINE'S SENSE DOES NOT MATTER: the same sailing line drawn downstream gives every buoy the same number - the "
      + "direction of buoyage is the buoys' hands', not the way the line was digitized",
      () => nums(marksOf(rev, BUOYS)) === EXPECT.join(","),
      () => nums(marksOf(rev, BUOYS)));
const cut1 = SAIL.slice(0, 41), cut2 = SAIL.slice(40, 101), cut3 = SAIL.slice(100);
const pieces = [lineFeat(cut3), lineFeat(cut2.slice().reverse()), lineFeat(cut1), lineFeat(cut2.slice().reverse())];
const cutKO = build([...pieces, ...BANKS, ...BUOYS]);
const cutLines = K.riverSailingLines(F, pieces);
check("4. ITS PIECES ARE ONE LINE: cut in three, given out of order, the middle piece reversed and served twice (a tile's "
      + "edge), it is joined into ONE line of the whole length, and every buoy has the same number",
      () => cutLines.length === 1 && Math.abs(cutLines[0].length - SAIL.length) <= 1
            && nums(marksOf(cutKO, BUOYS)) === EXPECT.join(","),
      () => "lines " + cutLines.length + " of " + cutLines.map((l) => l.length).join("/") + " points (whole: " + SAIL.length
            + "); " + nums(marksOf(cutKO, BUOYS)));
const gapA = SAIL.slice(0, 61), gapB = SAIL.slice(60).map((q) => ({ e: q.e + 40, n: q.n }));
const gapLines = K.riverSailingLines(F, [lineFeat(gapA), lineFeat(gapB)]);
const T = SAIL[60], spur = [T, { e: T.e + 3000, n: T.n }];          // a second line ending where the first does, at right angles
const spurLines = K.riverSailingLines(F, [lineFeat(SAIL.slice(0, 61)), lineFeat(spur)]);
const nearLines = K.riverSailingLines(F, [lineFeat(gapA), lineFeat(SAIL.slice(60).map((q) => ({ e: q.e + 20, n: q.n })))]);
check("5. ONLY WHERE IT RUNS ON: two pieces 40 m apart are two lines (RIVER_LINE_JOIN_M 25), 20 m apart one; a line ending "
      + "where another does at right angles - a second river's - is not joined to it (RIVER_LINE_JOIN_COS, 45 degrees)",
      () => K.RIVER_LINE_JOIN_M === 25 && gapLines.length === 2 && nearLines.length === 1 && spurLines.length === 2,
      () => "40 m: " + gapLines.length + " lines; 20 m: " + nearLines.length + "; right angle: " + spurLines.length);
// a sailing line round an island, closed, in two pieces: each joint runs on, and joining both would leave no end to start from
const ring = [];
for (let k = 0; k <= 72; k++) { const th = 2 * Math.PI * k / 72; ring.push({ e: 20000 + 800 * Math.cos(th), n: 800 * Math.sin(th) }); }
const ringLines = K.riverSailingLines(F, [lineFeat(ring.slice(0, 37)), lineFeat(ring.slice(36))]);
check("5b. A CLOSED LINE IS STILL A LINE: a sailing line round an island in two pieces, both joints running on, is joined at one "
      + "and kept whole - never closed into a ring with no end to read it from",
      () => ringLines.length === 1 && ringLines[0].length >= 72,
      () => ringLines.length + " line(s) of " + ringLines.map((l) => l.length).join("/") + " points");
// a fork: a line ending at P, and two lines on from it that both run on (20 degrees either way), one starting AT P and one
// 10 m off it - the nearer joins, once, and the other is a line of its own
const P0 = { e: 30000, n: 0 }, P1 = { e: 30000, n: 2000 };
const leg = (from, deg) => [from, { e: from.e + 2000 * Math.sin(deg * Math.PI / 180), n: from.n + 2000 * Math.cos(deg * Math.PI / 180) }];
const forkLines = K.riverSailingLines(F, [lineFeat([P0, P1]), lineFeat(leg({ e: P1.e - 10, n: P1.n }, -20)), lineFeat(leg(P1, 20))]);
const joinedFork = forkLines.find((l) => l.length === 3);
const nearEnd = leg(P1, 20)[1];
check("5c. AT A FORK THE NEAREST END JOINS, ONCE: a line ending where two run on from it, one at its end and one 10 m off it, "
      + "joins the nearer - one line of three points through it to the far end of the nearer - and the other is its own",
      () => forkLines.length === 2 && joinedFork
            && [joinedFork[0], joinedFork[2]].some((q) => Math.hypot(q.e - nearEnd.e, q.n - nearEnd.n) < 0.5)
            && forkLines.some((l) => l.length === 2),
      () => forkLines.map((l) => l.length + " points, ends " + [l[0], l[l.length - 1]].map((q) => Math.round(q.e) + "," + Math.round(q.n)).join(" / ")).join("; "));
// (review 2026-11-23, item 2) three ends at ONE node - the main river's two pieces and a tributary's 30 degrees off, all at
// 0 m: the main river runs on through it, whichever order the features come in
const Q0 = { e: 40000, n: 2000 };
const mainDown = lineFeat([{ e: 40000, n: 0 }, Q0]), mainUp = lineFeat([Q0, { e: 40000, n: 4000 }]);
const trib = lineFeat([Q0, { e: 40000 + 2000 * Math.sin(Math.PI / 6), n: 2000 + 2000 * Math.cos(Math.PI / 6) }]);
const nodeOrders = [[mainDown, mainUp, trib], [mainDown, trib, mainUp], [trib, mainDown, mainUp]].map((fs) => K.riverSailingLines(F, fs));
const mainWhole = (ls) => ls.length === 2 && ls.some((l) => l.length === 3 && l.every((q) => Math.abs(q.e - 40000) < 0.5));
check("5d. AT A NODE THE STRAIGHTEST JOINS: where the main river's two pieces and a tributary's meet at one point, the main "
      + "river is one line through it and the tributary a line of its own - in every order the pieces come",
      () => nodeOrders.every(mainWhole),
      () => nodeOrders.map((ls) => ls.map((l) => l.length + " pts to " + Math.round(l[l.length - 1].e) + "," + Math.round(l[l.length - 1].n)).join(" + ")).join("; "));

// ── 6-8. THE VOTE AND THE LIMITS ────────────────────────────────────────────────────────────────────────────────
const swapped = BUOYS.map((b, i) => ([1, 4, 8, 12].includes(i) ? buoy(STA[i], b.props.CATLAM === 2 ? 70 : -70, b.props.CATLAM === 2 ? 1 : 2) : b));
// (each of the four keeps its position and takes the other hand: 11 of 15 on their side)
const swapKO = build([lineFeat(SAIL), ...BANKS, ...swapped]);
const wrong1 = BUOYS.map((b, i) => (i === 6 ? buoy(STA[i], -70, 2) : b));            // one starboard-hand buoy on the port side
const w1KO = build([lineFeat(SAIL), ...BANKS, ...wrong1]);
const w1 = marksOf(w1KO, wrong1);
const two = build([lineFeat(SAIL), ...BANKS, BUOYS[0], BUOYS[1]]);
check("6. THE VOTE: four of the fifteen given the other hand where they stand (11 of 15 on their side, under RIVER_VOTE_AGREE "
      + "0.9) number NOTHING on that line; one starboard-hand buoy on the port side (14 of 15) is itself left unnumbered and "
      + "the rest are numbered round it; two buoys (under RIVER_VOTE_MIN 3) say nothing",
      () => K.RIVER_VOTE_AGREE === 0.9 && K.RIVER_VOTE_MIN === 3
            && marksOf(swapKO, swapped).every((m) => m && m.num == null && !m.river)
            && w1[6].num == null && !w1[6].river && w1.filter((m) => m.river).length === 14
            && nums(w1) === "2,3,4,5,7,8,-,9,10,11,12,13,15,17,18"
            && marksOf(two, [BUOYS[0], BUOYS[1]]).every((m) => m.num == null),
      () => "swapped: " + nums(marksOf(swapKO, swapped)) + "; one wrong: " + nums(w1) + "; two: " + nums(marksOf(two, [BUOYS[0], BUOYS[1]])));
const odd = [buoy(1000, 350, 2), buoy(2000, -3, 1), { ...buoy(0, 0, 2), geometry: { type: "Point", coordinates: LL({ e: 0, n: -200 }) } }];
const oddKO = build([lineFeat(SAIL), ...BANKS, ...BUOYS, ...odd]);
check("7. THE LIMITS: a buoy 350 m off the line (past RIVER_MARK_LINE_M 300), one 3 m off it (inside RIVER_MARK_MIN_OFF_M 5: on "
      + "neither side) and one 200 m off its end are not numbered - and the line's own buoys still are, as before",
      () => K.RIVER_MARK_LINE_M === 300 && K.RIVER_MARK_MIN_OFF_M === 5
            && marksOf(oddKO, odd).every((m) => m && m.num == null && !m.river) && nums(marksOf(oddKO, BUOYS)) === EXPECT.join(","),
      () => "the three: " + nums(marksOf(oddKO, odd)) + "; the line's: " + nums(marksOf(oddKO, BUOYS)));
// (review 2026-11-23, item 1: a vertex of null threw out of buildKeepouts, and the model was not built at all)
const holed = lineFeat(SAIL);
holed.geometry.coordinates.splice(60, 0, null);
let holedNums = "threw";
try { holedNums = nums(marksOf(build([holed, ...BANKS, ...BUOYS]), BUOYS)); } catch (e) { holedNums = "threw: " + e.message; }
check("7b. A VERTEX THAT IS NOT ONE: a sailing line with a null among its coordinates builds the model, without it - the line's "
      + "buoys numbered as before",
      () => holedNums === EXPECT.join(","),
      () => holedNums);
const nameRiver = buoy(1000, 90, 2, { props: { CATLAM: 2, OBJNAM: "Mile Buoy 8" } });
const harbour = buoy(1500, -70, 1, { band: "enc_harbour" });
const junction = buoy(1700, 70, 4);
// (two buoys of no hand - no CATLAM - left of the line: neither numbered nor counted against the vote, 15 of 15 still agree)
const noHand = [buoy(2500, -90, undefined), buoy(4100, -90, undefined)];
const others = build([lineFeat(SAIL), ...BANKS, ...BUOYS, nameRiver, harbour, junction, ...noHand]);
const [mName, mHarb, mJunc, mNo1, mNo2] = marksOf(others, [nameRiver, harbour, junction, ...noHand]);
const noaaLine = build([lineFeat(SAIL, "enc_harbour"), ...BANKS, ...BUOYS]);
check("8. ONLY THE RIVER'S OWN: a named buoy keeps its charted number and channel, an unnamed buoy of a NOAA band, a "
      + "junction mark and two buoys of no hand are not numbered - nor do the last two count against the vote: the line's "
      + "own are numbered as before - and a sailing line of a NOAA band numbers nothing",
      () => mName.num === 8 && mName.sys === "mile" && !mName.river && mHarb.num == null && !mHarb.river
            && mJunc.num == null && !mJunc.river && [mNo1, mNo2].every((m) => m.num == null && !m.river)
            && nums(marksOf(others, BUOYS)) === EXPECT.join(",")
            && marksOf(noaaLine, BUOYS).every((m) => m.num == null && !m.river),
      () => "named " + mName.num + "/" + mName.sys + ", NOAA band " + mHarb.num + ", junction " + mJunc.num + ", no hand "
            + nums([mNo1, mNo2]) + "; the line's: " + nums(marksOf(others, BUOYS))
            + "; NOAA line: " + nums(marksOf(noaaLine, BUOYS)));

// ── 9-10. NO PAIR LANE; ONE BUOY, ONE NUMBER ─────────────────────────────────────────────────────────────────────
const pairA = buoy(0, 0, 1, { band: "enc_harbour", props: { CATLAM: 1, OBJNAM: "Test Channel Buoy 1" }, geometry: { type: "Point", coordinates: LL({ e: -5000, n: 0 }) } });
const pairB = buoy(0, 0, 2, { band: "enc_harbour", props: { CATLAM: 2, OBJNAM: "Test Channel Buoy 2" }, geometry: { type: "Point", coordinates: LL({ e: -4900, n: 0 }) } });
const withPair = build([lineFeat(SAIL), ...BANKS, ...BUOYS, pairA, pairB]);
check("9. NO PAIR LANE: the river's buoys stand staggered, and their channel is not one of the model's systems (`ko.sys`, the "
      + "pair lane's) - a charted pair of a NOAA channel beside them still is",
      () => KO.sys.length === 0 && withPair.sys.length === 1 && withPair.sys[0].sys === "test channel",
      () => "river alone: " + KO.sys.length + " systems; with the pair: " + withPair.sys.map((s) => s.sys).join(", "));
const twinned = [...BUOYS.slice(0, 5), BUOYS[4], ...BUOYS.slice(5)];
const twKO = build([lineFeat(SAIL), ...BANKS, ...twinned]);
const twMarks = twKO.marks.filter((m) => m.river);
check("10. ONE BUOY, ONE NUMBER: a buoy served twice (a point on a tile's edge) is numbered once - both copies 7 - and the "
      + "numbers after it run on as without it",
      () => twMarks.length === 16 && twMarks.filter((m) => m.num === 7).length === 2
            && [...new Set(twMarks.map((m) => m.num))].sort((a, b) => a - b).join(",") === EXPECT.join(","),
      () => twMarks.map((m) => m.num).sort((a, b) => a - b).join(","));

// ── 11-13. THE ROUTE, UP AND DOWN ──────────────────────────────────────────────────────────────────────────────
// Her path from the search runs up the river 130 m left of the sailing line - between the port-hand buoys and the left bank,
// on the wrong side of every port-hand buoy - the whole 7.2 km reach; then the same path down the river.
const SIDE = (route) => {
  // every buoy against her route: which side of the buoy she passes, against which side of it the sailing line lies
  const en = route.map((p) => F.toEN(p));
  return BUOYS.map((b, i) => {
    const q = F.toEN({ lon: b.geometry.coordinates[0], lat: b.geometry.coordinates[1] });
    let bd = Infinity, bp = null;
    for (let j = 1; j < en.length; j++) {
      const a = en[j - 1], c = en[j], dx = c.e - a.e, dy = c.n - a.n, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((q.e - a.e) * dx + (q.n - a.n) * dy) / l2)), p = { e: a.e + t * dx, n: a.n + t * dy };
      const d = Math.hypot(p.e - q.e, p.n - q.n);
      if (d < bd) { bd = d; bp = p; }
    }
    const foot = at(STA[i], 0), nx = foot.e - q.e, ny = foot.n - q.n;      // from the buoy toward the sailing line
    return { i, off: bd, lineSide: (bp.e - q.e) * nx + (bp.n - q.n) * ny > 0 };
  });
};
const UP = offLine(-130, 0, LEN, 50).map(ll), DOWN = UP.slice().reverse();
const upR = R.channelLaneRoute(UP, F, KO, 5, {}), downR = R.channelLaneRoute(DOWN, F, KO, 5, {});
const gov = (res) => res.marks.filter((k) => k.m.river);
const handOK = (res, way) => gov(res).every((k) => (k.dir === way) && k.keepStbd === (k.m.side * way > 0) && !k.skip);
const vUp = R.markVerdicts(upR.route, F, upR.marks), vDown = R.markVerdicts(downR.route, F, downR.marks);
const sideUp = SIDE(upR.route), sideDown = SIDE(downR.route), sideBase = SIDE(UP);
check("11. UP THE RIVER: every buoy is read with the direction of buoyage and kept on its hand - starboard-hand to starboard, "
      + "port-hand to port - and her route passes every one on the sailing line's side, where her path from the search had "
      + "the eight port-hand buoys on the bank side; the buoyed reach is ridden",
      () => gov(upR).length === 15 && handOK(upR, 1) && vUp.length === 15 && vUp.every((v) => v.proper)
            && upR.how.marks.kept === 15 && upR.how.marks.wrong === 0 && upR.how.reach === true
            && sideUp.every((x) => x.lineSide) && sideBase.filter((x) => !x.lineSide).length === 8,
      () => "governed " + gov(upR).length + ", " + JSON.stringify(upR.how.marks) + ", reach " + upR.how.reach
            + "; on the line's side " + sideUp.filter((x) => x.lineSide).length + " of 15 (her path's: "
            + sideBase.filter((x) => x.lineSide).length + ")");
check("12. DOWN THE RIVER: the same buoys the other way - starboard-hand to PORT, port-hand to starboard - every one passed "
      + "on the sailing line's side of her, the buoyed reach ridden",
      () => gov(downR).length === 15 && handOK(downR, -1) && vDown.every((v) => v.proper) && downR.how.marks.wrong === 0
            && downR.how.marks.kept === 15 && downR.how.reach === true && sideDown.every((x) => x.lineSide),
      () => "governed " + gov(downR).length + ", " + JSON.stringify(downR.how.marks) + ", reach " + downR.how.reach
            + "; on the line's side " + sideDown.filter((x) => x.lineSide).length + " of 15");
const asBefore = build([lineFeat(SAIL), ...BANKS, ...BUOYS.map((b) => ({ ...b, band: undefined }))]);
const beforeR = R.channelLaneRoute(UP, F, asBefore, 5, {});
check("13. THE CONTROL: the same chart with the buoys' band gone - unnumbered, as every river buoy was before this - and no "
      + "buoy is read with a direction of buoyage: none is kept on a hand as a channel's mark",
      () => beforeR.marks.length === 15 && beforeR.marks.every((k) => k.dir !== 1 && k.dir !== -1 && !k.m.river)
            && beforeR.how.marks.kept === 0,
      () => "near " + beforeR.marks.length + "; " + JSON.stringify(beforeR.how.marks) + "; read as "
            + [...new Set(beforeR.marks.map((k) => k.skip || (k.offshore ? "offshore" : "dir " + k.dir)))].join(" / "));

// ── 14-15. A LONE BUOY ────────────────────────────────────────────────────────────────────────────────────────────
// Three buoys 2 km apart along the river (past MARK_NEIGHBOR_M and MARK_SINGLE_NEIGHBOR_M, 1500 m): no numbered mark near
// any of them along her route speaks for it, and each is read from the sailing line's direction of buoyage at it.
const LONE = [buoy(1200, 70, 2), buoy(3300, -70, 1), buoy(5400, 70, 2)];
const loneKO = build([lineFeat(SAIL), ...BANKS, ...LONE]);
const loneM = marksOf(loneKO, LONE);
const lUp = R.markPassRoute(UP, F, loneKO, 5, {}), lDown = R.markPassRoute(DOWN, F, loneKO, 5, {});
// (and with the line drawn downstream: the direction of buoyage at each is the buoys' vote's, not the line's own sense)
const loneRev = build([lineFeat(SAIL.slice().reverse()), ...BANKS, ...LONE]);
const rUp = R.markPassRoute(UP, F, loneRev, 5, {}), rDown = R.markPassRoute(DOWN, F, loneRev, 5, {});
const lDir = (res) => res.marks.map((k) => (k.skip ? k.skip : "dir " + k.dir + (k.keepStbd ? " stbd" : " port"))).join(", ");
const keptBy = (res, way) => res.marks.length === 3 && res.marks.every((k) => !k.skip && k.dir === way && k.keepStbd === (k.m.side * way > 0));
check("14. A LONE BUOY IS READ FROM THE LINE: three buoys 2 km apart, each with no numbered mark within reach along her "
      + "route, are each read with the direction of buoyage at it (`along`) - up the river with it, down against it - and "
      + "kept on its hand both ways; the same with the sailing line drawn downstream",
      () => R.MARK_NEIGHBOR_M === 1500 && loneM.every((m) => m.river && Array.isArray(m.along))
            && keptBy(lUp, 1) && keptBy(lDown, -1) && keptBy(rUp, 1) && keptBy(rDown, -1),
      () => "up: " + lDir(lUp) + "; down: " + lDir(lDown) + "; the line reversed, up: " + lDir(rUp) + "; down: " + lDir(rDown));
// `along` is the line's heading AT the buoy, upstream: north on the first reach, north-east on the last
const hd = (m) => (Math.atan2(m.along[0], m.along[1]) * 180 / Math.PI + 360) % 360;
const adiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
check("14b. ... AND THE DIRECTION IT IS READ FROM IS THE LINE'S AT IT: north at the lone buoy on the first reach, north-east "
      + "at the one on the last - upstream either way the line was drawn",
      () => [loneM, marksOf(loneRev, LONE)].every((ms) => adiff(hd(ms[0]), 0) < 2 && adiff(hd(ms[2]), 45) < 2),
      () => [loneM, marksOf(loneRev, LONE)].map((ms) => ms.map((m) => hd(m).toFixed(1)).join("/")).join("; reversed: "));
const ACROSS = [ll(at(3300, -200)), ll(at(3300, 200))];
const lAcross = R.markPassRoute(ACROSS, F, loneKO, 5, {});
const kAcross = lAcross.marks.find((k) => k.m === loneM[1]);
check("15. ... BUT NOT FOR A ROUTE ACROSS THE RIVER: a route from bank to bank past the lone port-hand buoy runs neither with "
      + "the river nor against it (its course within 60 degrees of neither, MARK_ALONG_COS), and the line gives it no "
      + "direction of buoyage",
      () => kAcross && kAcross.dir !== 1 && kAcross.dir !== -1,
      () => (kAcross ? (kAcross.skip || "dir " + kAcross.dir) + (kAcross.offshore ? " (offshore)" : "") : "not near"));

// ── 16. THE OPERATOR'S NAME ─────────────────────────────────────────────────────────────────────────────────────
check("16. THE OPERATOR'S NAME: the marks stage names a numbered river buoy by its hand, never by the model's own channel "
      + "name and number; a charted mark keeps its name and number",
      () => R.markName(MS[0]) === "a starboard-hand river buoy" && R.markName(MS[1]) === "a port-hand river buoy"
            && R.markName({ sys: "erie harbor", num: 11 }) === "erie harbor 11",
      () => JSON.stringify([R.markName(MS[0]), R.markName(MS[1])]));

console.log(fails ? `\n${fails} of ${ran} CHECK(S) FAILED` : `\nall ${ran} checks passed`);
process.exit(fails ? 1 : 0);
