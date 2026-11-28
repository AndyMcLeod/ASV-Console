// tests/survey_area.js - a closed boundary stays FULL of survey lines, end to end, at any bearing and spacing.
//
// Andy, 2026-10-11: "The boundary box function constrains line generation within it after initial survey pattern
// generation. When rotating lines by bearing the outer lines disappear. The box should remain full of lines end-to-end
// during any rotation or line spacing change."
//
// THE FAULT: the boundary CLIPPED the A-B box's lines, and that box is the A-B diagonal laid out at the chosen bearing
// and spacing - a new bearing reshapes it (45 degrees off the diagonal it is a thin strip), so turned it no longer
// reached the boundary's corners and every line beyond it was lost. THE FIX (areaPattern in static/asv.html): with a
// closed boundary the lines are laid across the boundary's own extent at the pattern's bearing and spacing, and clipped
// to it as before.
//
// WHAT IS PINNED, each with the page's own functions lifted out (surveyPattern, areaPattern, clipToPoly,
// patSourceLines, planRef, currentPattern) over the real geodesy and geometry modules:
//   1   FULL: at every bearing 0-175 deg in 5 deg steps and four spacings, every point of a 1000 x 600 m boundary is
//       within a spacing of a line and every point a spacing or more inside it within HALF a spacing (worstGap says
//       why those are the two bounds); CONTROL - the old way, the A-B box's lines clipped, leaves points hundreds of
//       meters from any line at 45 deg, so this check can fail;
//   2   END TO END: every line's ends lie on the boundary;
//   3   the pattern is still the pattern: adjacent lines one spacing apart, the bearing reported as typed, legs
//       alternating, the start on A's side and A's end;
//   4   a CONCAVE boundary (an L) is full too, its lines cut in two across the notch;
//   5   a boundary edge parallel to the lines keeps its edge line (not cut to nothing or lost by rounding), and a
//       pointed vertex leaves no sliver;
//   6   no boundary: the A-B box's pattern exactly as before; the cap still applies, and says so;
//   7   the wiring: currentPattern lays the lines across the boundary only while it is closed.
//
// TEETH - eleven mutations RUN on scratch copies of static/ and tests/; ten caught, and the eleventh taught the code:
//   the boundary clips the A-B box's lines again (the fault)  -> 1, 2, 3, 3b, 4, 4b, 5, 6, 7
//   no inset from the outermost edge                         -> 3b, 5
//   slivers kept                                             -> 5
//   alignment ignored across the boundary                    -> 3b
//   the start on B's side                                    -> 3, 3b, 5
//   each line from the far end                               -> 3
//   no boustrophedon                                         -> 3
//   no cap across the boundary                               -> 6
//   the lines' count off the length, not the width           -> 1, 3b, 4, 6
//   the lines only as long as half the box                   -> 1, 2, 4, 4b, 5
//   the lines padded past the box (the first cut) or not     -> SURVIVED: the box's ends touch the boundary only at its
//                                                               outermost vertices, so the clip makes every end either
//                                                               way - the padding was dead, and it went

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
const GM = require(path.join(APP, "static", "js", "geometry.js"));

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
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("function " + name + " not found in the page (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
const decl = (name) => { const m = new RegExp("const " + name + " = [^;]+;").exec(H); if (!m) throw new Error(name + " gone"); return m[0]; };

// The page's pattern code, lifted whole, over the real geodesy and geometry modules (`gm`: another geometry - 9 hands
// one whose ringGrid files nothing, so the clip scans every edge as it did before the grid).
const world = (gm) => new Function("GD", "GM", [
  "const {distTo, azTo, atDA, planeFrame, llEN} = GD, {segInt, pinp, lerpLL, ringGrid} = GM;",
  "let pat = {A: null, B: null, C: null, align: 0}, boundary = [], boundaryClosed = false, center = {lat: 43, lon: -70.7};",
  // BOUNDED, as every check before the switch (2026-10-16) assumed - 8 drives PATTERN
  "let surveyBounded = true;",
  "let patOnly = null; let patOutlineLowM = null, patOnlySig = null, patPlanBSay = ''; const planBDrawingCheck = () => false;",                         // (a Plan B's lines - the survey window phase 3: none here)
  decl("MAX_SURVEY_LINES"), decl("AREA_EDGE_M"), decl("AREA_SLIVER_M"),
  grab("surveyPattern"), grab("areaPattern"), grab("clipToPoly"), grab("boundaryActive"), grab("currentPattern"),
  grab("planRef"), grab("patSourceLines"), grab("patSourceAll"), grab("patOnlyIdx"),
  "let areaGridMemo = null;", grab("areaRingGrid"),
  "return {surveyPattern, set: (o) => { if (o.pat) pat = o.pat; if (o.boundary) { boundary = o.boundary; boundaryClosed = o.boundary.length >= 3; }",
  "                                   if (o.bounded !== undefined) surveyBounded = o.bounded; },",
  "        poke: (i, ll) => { boundary[i] = ll; },",                 // a corner dragged: the page's own in-place edit
  "        memo: () => areaGridMemo, ringGridAt: (ref) => areaRingGrid(ref),",
  "        lines: () => patSourceLines(), sp: () => currentPattern()};",
].join("\n"))(GD, gm || GM);

// a plane about a reference point off Portsmouth, meters east / north
const REF = { lat: 43.06, lon: -70.70 };
const fr = GD.planeFrame(REF);
const LL = (e, n) => fr.fromEN(e, n), EN = (p) => fr.toEN(p);
const RECT = [LL(0, 0), LL(1000, 0), LL(1000, 600), LL(0, 600)];                       // 1000 x 600 m
const ELL = [LL(0, 0), LL(1000, 0), LL(1000, 300), LL(400, 300), LL(400, 600), LL(0, 600)];   // an L, notch NE
// the operator's first pattern: A near the boundary's SW corner, B inside it, lines north-south
const A0 = LL(100, 100), B0 = LL(500, 400);
const patAt = (brg, spacing, align) => ({ A: A0, B: B0, C: GD.atDA(A0, spacing, brg + 90), align: align || 0 });

// distance from an EN point to a segment
const dSeg = (p, a, b) => {
  const dx = b.e - a.e, dy = b.n - a.n, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p.e - a.e) * dx + (p.n - a.n) * dy) / L2)) : 0;
  return Math.hypot(p.e - a.e - t * dx, p.n - a.n - t * dy);
};
const ringEN = (ring) => ring.map(EN);
const inRing = (p, r) => GM.pinp(p, r);
const toEdge = (p, r) => { let m = Infinity; for (let i = 0, j = r.length - 1; i < r.length; j = i++) m = Math.min(m, dSeg(p, r[j], r[i])); return m; };
// the farthest any point of the area (a 10 m grid), at least `inset` m inside its boundary, is from a line.
// ⚠ "FULL" IS TWO BOUNDS, NOT ONE. Inside, every point is within HALF a spacing of a line. Along an edge the lines are
// not parallel to, they meet it at staggered points, and the strip between the edge and the nearest line still inside
// it is up to a WHOLE spacing wide - true of any set of parallel lines over any such edge, not of this code - so there
// the bound is one spacing. (Near a vertex sharper than a right angle there may be no line at all; those are not
// asserted here.)
function worstGap(lines, ring, inset) {
  const r = ringEN(ring), segs = lines.map((l) => [EN(l[0]), EN(l[1])]);
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const q of r) { e0 = Math.min(e0, q.e); e1 = Math.max(e1, q.e); n0 = Math.min(n0, q.n); n1 = Math.max(n1, q.n); }
  let worst = 0, at = null;
  for (let e = e0 + 1; e < e1; e += 10) for (let n = n0 + 1; n < n1; n += 10) {
    const p = { e, n };
    if (!inRing(p, r) || toEdge(p, r) < (inset || 0)) continue;
    let d = Infinity; for (const s of segs) d = Math.min(d, dSeg(p, s[0], s[1]));
    if (d > worst) { worst = d; at = p; }
  }
  return { worst, at };
}
const endsOnBoundary = (lines, ring) => { const r = ringEN(ring); let worst = 0;
  for (const l of lines) for (const p of l) worst = Math.max(worst, toEdge(EN(p), r)); return worst; };

console.log("A closed boundary stays full of survey lines, end to end, at any bearing and spacing:");

// ── 1-2. FULL, AND END TO END, AT EVERY BEARING AND SPACING ───────────────────────────────────────────────────────
{
  const W = world();
  W.set({ boundary: RECT });
  let worst = { ratio: 0 }, inner = { ratio: 0 }, endWorst = 0, n = 0;
  for (const spacing of [25, 50, 80, 130]) {
    for (let brg = 0; brg < 180; brg += 5) for (const al of [0, 1, 2]) {   // start, center, finish
      W.set({ pat: patAt(brg, spacing, al) });
      const lines = W.lines(), g = worstGap(lines, RECT, 0), gi = worstGap(lines, RECT, spacing);
      const ratio = (g.worst - 0.1) / spacing, ri = (gi.worst - 0.1) / (spacing / 2);
      if (ratio > worst.ratio) worst = { ratio, brg, spacing, gap: g.worst, lines: lines.length };
      if (ri > inner.ratio) inner = { ratio: ri, brg, spacing, gap: gi.worst };
      endWorst = Math.max(endWorst, endsOnBoundary(lines, RECT));
      n++;
    }
  }
  // CONTROL: the old way at 45 degrees - the A-B box's lines, clipped to the boundary
  const old = World0();
  check("1. FULL AT EVERY BEARING AND SPACING: every point of the boundary is within a spacing of a line, and every point "
        + "a spacing or more inside it within HALF a spacing - " + n + " cases, 0-175 deg in 5 deg steps at 25, 50, 80 and "
        + "130 m, each alignment - where the old way (the A-B box's lines clipped to the boundary) left points hundreds of meters from any line",
        () => worst.ratio <= 1 && inner.ratio <= 1 && old.gap > 4 * 25,
        () => "worst anywhere " + (worst.gap != null ? worst.gap.toFixed(2) + " m at " + worst.brg + " deg, " + worst.spacing + " m spacing" : "within")
            + "; worst inside " + (inner.gap != null ? inner.gap.toFixed(2) + " m at " + inner.brg + " deg, " + inner.spacing + " m" : "within")
            + "; the old way at 45 deg, 25 m: " + old.gap.toFixed(0) + " m from the nearest line (" + old.lines + " lines)");
  check("2. END TO END: every line's two ends lie on the boundary",
        () => endWorst < 0.5,
        () => "farthest end from the boundary " + endWorst.toFixed(3) + " m");
}
// the old way, rebuilt from the same page functions: the A-B box's pattern (no area) clipped to the boundary
function World0() {
  const W = world();
  const sp = W.surveyPattern(A0, B0, GD.atDA(A0, 25, 45 + 90), 1);       // no area: the box's lines
  const ref = REF, ring = RECT.map((p) => GD.llEN(p.lat, p.lon, ref));
  const clip = new Function("GD", "GM", "const {llEN} = GD, {segInt, pinp, lerpLL} = GM;\n" + grab("clipToPoly") + "\nreturn clipToPoly;")(GD, GM);
  const lines = []; sp.lines.forEach((l) => clip(l[0], l[1], ring, ref).forEach((s) => lines.push(s)));
  return { gap: worstGap(lines, RECT, 0).worst, lines: lines.length };
}

// ── 3. THE PATTERN IS STILL THE PATTERN ───────────────────────────────────────────────────────────────────────────
{
  const W = world();
  W.set({ boundary: RECT, pat: patAt(30, 50, 0) });
  const sp = W.sp(), L = sp.lines.map((l) => [EN(l[0]), EN(l[1])]);
  const brg = (a, b) => (Math.atan2(b.e - a.e, b.n - a.n) * 180 / Math.PI + 360) % 360;
  const across = (k) => { const a = L[k][0], b = L[k][1], p = L[k + 1][0], u = { e: (b.e - a.e), n: (b.n - a.n) }, m = Math.hypot(u.e, u.n);
    return Math.abs(((p.e - a.e) * u.n - (p.n - a.n) * u.e) / m); };
  const gaps = L.slice(0, -1).map((_, k) => across(k));
  const legs = L.map((l) => brg(l[0], l[1]));
  // (tolerances for two flat frames - the pattern's at A, this test's at REF - which differ by ~0.1% over a kilometer)
  const alternate = legs.every((b, k) => k === 0 || Math.abs((((b - legs[k - 1]) % 360) + 360) % 360 - 180) < 0.05);
  // the start: A's side (the first line nearer A than the last) and A's end (line 0 runs away from A's end)
  const a = EN(A0), d0 = dSeg(a, L[0][0], L[0][1]) , dN = dSeg(a, L[L.length - 1][0], L[L.length - 1][1]);
  const along0 = (L[0][1].e - L[0][0].e) * Math.sin(30 * Math.PI / 180) + (L[0][1].n - L[0][0].n) * Math.cos(30 * Math.PI / 180);
  check("3. THE PATTERN IS STILL THE PATTERN across the boundary: adjacent lines one spacing apart, the bearing reported as "
        + "typed, the legs alternating (boustrophedon), the first line on A's side and running from A's end",
        () => sp.area === true && gaps.every((g) => Math.abs(g - 50) < 0.1) && Math.abs(sp.direction - 30) < 1e-3 && alternate
              && d0 < dN && along0 > 0 && sp.count === L.length,
        () => "direction " + sp.direction + ", spacings " + [...new Set(gaps.map((g) => g.toFixed(3)))].join("/") + " m, "
            + L.length + " lines, alternating " + alternate + ", first line " + d0.toFixed(0) + " m from A, last " + dN.toFixed(0) + " m");
}

{
  // ALIGNMENT across the boundary: north-south lines at 70 m across a 1000 m width - 15 lines spanning 980 m, 20 m over.
  // Start: the 20 m on the far (east) side; center: 10 m each side; finish: on the near (west) side. (A flush line sits
  // AREA_EDGE_M, 5 cm, inside its edge.)
  const W = world();
  W.set({ boundary: RECT });
  const margins = [0, 1, 2].map((al) => { W.set({ pat: patAt(0, 70, al) });
    const xs = W.lines().map((l) => EN(l[0]).e).sort((a, b) => a - b); return [xs[0], 1000 - xs[xs.length - 1], xs.length]; });
  const near = (a, b) => Math.abs(a - b) < 0.2;
  check("3b. ... and ALIGNMENT puts the leftover where it always did: start - all of it on the far side from A (20 m "
        + "east); center - half each side; finish - all of it on A's side",
        () => margins.every((m) => m[2] === 15) && near(margins[0][0], 0.05) && near(margins[0][1], 20)
              && near(margins[1][0], 10) && near(margins[1][1], 10) && near(margins[2][0], 20) && near(margins[2][1], 0.05),
        () => margins.map((m, i) => ["start", "center", "finish"][i] + " " + m[0].toFixed(2) + " / " + m[1].toFixed(2) + " m (" + m[2] + " lines)").join("; "));
}

// ── 4. A CONCAVE BOUNDARY ─────────────────────────────────────────────────────────────────────────────────────────
{
  const W = world();
  W.set({ boundary: ELL });
  let worst = 0, inner = 0, endWorst = 0;
  for (let brg = 0; brg < 180; brg += 15) {
    W.set({ pat: patAt(brg, 40, 1) });
    const lines = W.lines();
    worst = Math.max(worst, worstGap(lines, ELL, 0).worst);
    inner = Math.max(inner, worstGap(lines, ELL, 40).worst);
    endWorst = Math.max(endWorst, endsOnBoundary(lines, ELL));
  }
  W.set({ pat: patAt(0, 40, 1) });
  const ns = W.lines(), sp0 = W.sp();
  check("4. A CONCAVE BOUNDARY (an L) is full too, at every bearing 0-165 deg, by the same two bounds, and end to end",
        () => worst <= 40 + 0.1 && inner <= 20 + 0.1 && endWorst < 0.5 && ns.length === sp0.count,
        () => "worst anywhere " + worst.toFixed(2) + " m (a spacing is 40), inside " + inner.toFixed(2) + " m (half is 20), farthest end "
            + endWorst.toFixed(3) + " m, " + ns.length + " north-south pieces from " + sp0.count + " lines");
  W.set({ pat: patAt(90, 40, 1) });
  const ew = W.lines(), sp1 = W.sp();
  // the L's north arm (x 0-400, y 300-600) and its east foot (x 0-1000, y 0-300): an east-west line in the foot spans
  // the whole 1000 m, one in the arm stops at x = 400 - each line one piece; a north-south line west of x = 400 runs
  // the full 600 m, east of it 300 m.
  const long = ew.filter((l) => GD.distTo(l[0], l[1]) > 900).length, short = ew.filter((l) => GD.distTo(l[0], l[1]) < 450).length;
  check("4b. ... east-west across the L: the lines in its foot run its whole 1000 m, the lines in its arm stop at its "
        + "inside corner (400 m) - nothing past the notch, nothing short of the wall",
        () => long + short === ew.length && long > 0 && short > 0,
        () => long + " lines across the foot, " + short + " across the arm, of " + ew.length + " (" + sp1.count + " laid)");
}

// ── 5. AN EDGE PARALLEL TO THE LINES, AND A POINTED VERTEX ────────────────────────────────────────────────────────
{
  const W = world();
  W.set({ boundary: RECT, pat: patAt(0, 50, 0) });              // lines north-south, start flush on the west edge
  const L = W.lines(), first = L[0], firstLen = GD.distTo(first[0], first[1]), firstE = EN(first[0]).e;
  const D = [LL(0, 300), LL(500, 0), LL(1000, 300), LL(500, 600)];   // a diamond: every vertex pointed
  W.set({ boundary: D });
  let shortest = Infinity;
  for (let brg = 0; brg < 180; brg += 15) { W.set({ pat: patAt(brg, 37, 0) }); for (const l of W.lines()) shortest = Math.min(shortest, GD.distTo(l[0], l[1])); }
  check("5. a boundary EDGE PARALLEL to the lines keeps its edge line - full length, a few centimeters inside it, not cut "
        + "to nothing or lost by rounding - and a POINTED vertex leaves no sliver of a line",
        () => Math.abs(firstLen - 600) < 0.5 && firstE > 0 && firstE < 0.2 && shortest >= 1,
        () => "edge line " + firstLen.toFixed(2) + " m long, " + (firstE * 100).toFixed(1) + " cm inside the west edge; shortest piece in the diamond "
            + shortest.toFixed(2) + " m");
}

// ── 6. NO BOUNDARY, AND THE CAP ───────────────────────────────────────────────────────────────────────────────────
{
  const W = world();
  const sp = W.surveyPattern(A0, B0, GD.atDA(A0, 50, 90), 0);   // north-south lines, the box 400 x 300 m
  const W2 = world(); W2.set({ boundary: RECT, pat: patAt(0, 1, 0) });
  const capped = W2.sp();
  check("6. with NO boundary the A-B box's pattern is as it was (8 lines across its 400 m, 300 m each); and across a "
        + "boundary the line cap still applies and says so",
        () => !sp.area && sp.count === 8 && Math.abs(sp.legLength - 300) < 0.5 && Math.abs(sp.width - 400) < 0.5
              && capped.capped && capped.count === +(/const MAX_SURVEY_LINES = (\d+);/.exec(H) || [])[1] && capped.wanted > capped.count,
        () => "box: " + sp.count + " lines, " + sp.legLength.toFixed(1) + " x " + sp.width.toFixed(1) + " m; at 1 m across the boundary "
            + capped.count + " of " + capped.wanted);
}

// ── 7. THE WIRING ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const W = world();
  W.set({ pat: patAt(45, 50, 1) });
  const open = W.sp();
  W.set({ boundary: RECT });
  const closed = W.sp();
  check("7. currentPattern lays the lines across the boundary only while one is closed (and the boundary, not the box, "
        + "sets the line length and width the card reads)",
        () => !open.area && closed.area === true && /surveyPattern\(pat\.A, pat\.B, pat\.C, pat\.align, boundaryActive\(\) \? boundary : null\)/.test(grab("currentPattern"))
              && Math.abs(closed.width - (1000 + 600) * Math.SQRT1_2) < 1 && Math.abs(closed.legLength - (1000 + 600) * Math.SQRT1_2) < 1,
        () => "open: " + open.count + " lines; closed: " + closed.count + " lines, " + closed.legLength.toFixed(0) + " x " + closed.width.toFixed(0) + " m");
}

// ── 8. PATTERN (Andy, 2026-10-16: "Otherwise, allow the unbounded survey pattern 3 point draw functionality") ────────
// The Survey tab's switch: in PATTERN a closed area is kept but not applied - the three clicks' box, unclipped, exactly
// what no area gives - and BOUNDED applies it again.
{
  const W = world(), N = world();
  W.set({ pat: patAt(45, 50, 1), boundary: RECT, bounded: false });
  N.set({ pat: patAt(45, 50, 1) });                          // no area at all
  const kept = W.sp(), none = N.sp(), kl = W.lines(), nl = N.lines();
  W.set({ bounded: true });
  const back = W.sp();
  const sameLines = kl.length === nl.length && kl.every((l, i) => GD.distTo(l[0], nl[i][0]) < 1e-6 && GD.distTo(l[1], nl[i][1]) < 1e-6);
  check("8. PATTERN: with an area closed but the switch on Pattern, the pattern is the three clicks' box - the same lines, "
        + "unclipped, as with no area at all; Bounded lays them across the area again",
        () => !kept.area && kept.count === none.count && sameLines && back.area === true
              && /return surveyBounded && boundaryClosed && boundary\.length >= 3;/.test(grab("boundaryActive")),
        () => "pattern: " + kept.count + " lines (no area: " + none.count + "), same " + sameLines + "; bounded: area " + back.area);
}

// ── 9. THE GRID OF THE AREA'S EDGES (2026-11-27, Andy's 5999-corner area) ─────────────────────────────────────────
// patSourceAll clips every line to the area on every redraw; geometry.js ringGrid files the edges so a line asks only
// those near it. It must be the FULL SCAN'S ANSWER EXACTLY - so it is asked where a grid is likeliest to drop an edge:
// rings on a lattice (corners sharing northings and eastings, runs of straight edges), lines laid ALONG their edges and
// THROUGH their corners, points ON their corners' northings; then the page's own clip, grid against no grid, bit for bit.
{
  let seed = 20261127;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (k) => Math.floor(rnd() * k);
  // a raster outline on a 10 m lattice: a stepped floor and a stepped roof, k columns wide
  const stairs = (k) => {
    const lo = [], hi = [];
    for (let i = 0; i <= k; i++) { lo.push(ri(5) * 10); hi.push(200 + ri(5) * 10); }
    const r = [];
    for (let i = 0; i < k; i++) { r.push({ e: i * 10, n: lo[i] }); r.push({ e: (i + 1) * 10, n: lo[i] }); }
    for (let i = k - 1; i >= 0; i--) { r.push({ e: (i + 1) * 10, n: hi[i] }); r.push({ e: i * 10, n: hi[i] }); }
    return r.filter((p, i) => i === 0 || p.e !== r[i - 1].e || p.n !== r[i - 1].n);
  };
  const star = (N) => Array.from({ length: N }, (_, i) => { const a = 2 * Math.PI * i / N, rr = 200 + 800 * rnd();
    return { e: 1000 + rr * Math.cos(a), n: 1000 + rr * Math.sin(a) }; });
  const fullTs = (a, b, r) => { const ts = []; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const t = GM.segInt(a, b, r[j], r[i]); if (t != null) ts.push(t); } return ts.sort((x, y) => x - y); };
  const gridTs = (a, b, r, g) => { const ts = []; g.edgesNear(a, b, (i, j) => { const t = GM.segInt(a, b, r[j], r[i]); if (t != null) ts.push(t); }); return ts.sort((x, y) => x - y); };
  let segs = 0, segBad = 0, pts = 0, ptBad = 0, firstBad = "";
  const rings = [];
  for (let k = 0; k < 40; k++) rings.push(stairs(2 + ri(60)));
  for (let k = 0; k < 20; k++) rings.push(star(3 + ri(400)));
  for (const r of rings) {
    const g = GM.ringGrid(r);
    const xs = r.map((p) => p.e), ys = r.map((p) => p.n);
    const lines = [];
    for (let q = 0; q < 60; q++) {
      const a = r[ri(r.length)], b = r[ri(r.length)];
      lines.push([a, b]);                                                                   // corner to corner
      const y = ys[ri(ys.length)], x = xs[ri(xs.length)];
      lines.push([{ e: Math.min(...xs) - 5, n: y }, { e: Math.max(...xs) + 5, n: y }]);    // along a corner's northing
      lines.push([{ e: x, n: Math.min(...ys) - 5 }, { e: x, n: Math.max(...ys) + 5 }]);    // along a corner's easting
      lines.push([{ e: -100 + 1400 * rnd(), n: -100 + 1400 * rnd() }, { e: -100 + 1400 * rnd(), n: -100 + 1400 * rnd() }]);
    }
    for (const [a, b] of lines) {
      segs++;
      const f = JSON.stringify(fullTs(a, b, r)), gg = JSON.stringify(gridTs(a, b, r, g));
      if (f !== gg) { segBad++; if (!firstBad) firstBad = "segment " + JSON.stringify([a, b]) + ": full " + f + ", grid " + gg; }
    }
    const probes = [];
    for (const p of r) { probes.push(p, { e: p.e + 3, n: p.n }, { e: p.e - 3, n: p.n }); }
    for (let q = 0; q < 200; q++) probes.push({ e: -100 + 1400 * rnd(), n: -100 + 1400 * rnd() });
    for (const p of probes) {
      pts++;
      if (GM.pinp(p, r) !== g.inside(p)) { ptBad++; if (!firstBad) firstBad = "point " + JSON.stringify(p) + ": pinp " + GM.pinp(p, r); }
    }
  }
  check("9. THE GRID OF THE AREA'S EDGES gives the full scan's answer exactly: the same crossings for every segment (corner "
        + "to corner, along a corner's northing and easting, at random) and the same inside for every point (on and beside "
        + "the corners, at random), over 40 lattice rings and 20 stars",
        () => segs > 10000 && pts > 10000 && segBad === 0 && ptBad === 0,
        () => segs + " segments (" + segBad + " differ), " + pts + " points (" + ptBad + " differ)" + (firstBad ? "; first: " + firstBad : ""));

  // the page's clip itself: patSourceLines with the grid against the same functions with no grid (the full scan)
  const NOGRID = Object.assign({}, GM, { ringGrid: () => null });
  const winding = (N) => Array.from({ length: N }, (_, i) => { const a = 2 * Math.PI * i / N, w = 1 + 0.05 * Math.sin(37 * a) + 0.03 * Math.sin(131 * a);
    return LL(1500 + 1500 * w * Math.cos(a), 1000 + 1000 * w * Math.sin(a)); });
  const BIG = winding(6000);
  let cases = 0, diff = 0, pieces = 0, at = "";
  for (const area of [RECT, ELL, BIG]) {
    const Wg = world(), Wf = world(NOGRID);
    Wg.set({ boundary: area }); Wf.set({ boundary: area });
    for (let brg = 0; brg < 180; brg += 20) for (const spc of [9, 40]) {
      const p = { A: LL(100, 100), B: LL(900, 500), C: GD.atDA(LL(100, 100), spc, brg + 90), align: 1 };
      Wg.set({ pat: p }); Wf.set({ pat: p });
      const a = JSON.stringify(Wg.lines()), b = JSON.stringify(Wf.lines());
      cases++; pieces += JSON.parse(a).length;
      if (a !== b) { diff++; if (!at) at = area.length + " corners at " + brg + " deg, " + spc + " m"; }
    }
  }
  check("9b. ... and the page's clip (patSourceLines) is the same with the grid as without it, bit for bit - a rectangle, "
        + "the L and a winding 6000-corner area, 0-160 deg at 9 and 40 m",
        () => cases === 54 && diff === 0 && pieces > 1000,
        () => cases + " drawings, " + pieces + " pieces, " + diff + " differ" + (at ? " (first: " + at + ")" : ""));

  // ... and it asks only the edges near a line: on the 6000-corner area, the edges handed over a line are a few percent
  const ringBig = BIG.map((p) => GD.llEN(p.lat, p.lon, REF)), gBig = GM.ringGrid(ringBig);
  const Wl = world(); Wl.set({ boundary: BIG, pat: { A: LL(100, 100), B: LL(900, 500), C: GD.atDA(LL(100, 100), 9, 120), align: 1 } });
  const laid = Wl.sp().lines.map((l) => [GD.llEN(l[0].lat, l[0].lon, REF), GD.llEN(l[1].lat, l[1].lon, REF)]);
  let asked = 0;
  for (const [a, b] of laid) gBig.edgesNear(a, b, () => { asked++; });
  const t0 = process.hrtime.bigint(); Wl.lines(); const msGrid = Number(process.hrtime.bigint() - t0) / 1e6;
  const Wn = world(NOGRID); Wn.set({ boundary: BIG, pat: { A: LL(100, 100), B: LL(900, 500), C: GD.atDA(LL(100, 100), 9, 120), align: 1 } });
  const t1 = process.hrtime.bigint(); Wn.lines(); const msFull = Number(process.hrtime.bigint() - t1) / 1e6;
  // ... and the grid KEPT between redraws (areaRingGrid) is handed back only for the same area: a corner moved IN PLACE
  // (the page's drag is `boundary[i] = ll`) files it again, so the lines are a fresh drawing's of the moved area
  {
    const Wm = world(), pat9 = { A: LL(100, 100), B: LL(900, 500), C: GD.atDA(LL(100, 100), 40, 90), align: 1 };
    const area = RECT.slice();
    Wm.set({ boundary: area, pat: pat9 });
    Wm.lines(); const m1 = Wm.memo(); Wm.lines(); const kept = Wm.memo() === m1;
    Wm.poke(2, LL(1000, 420));                                     // the NE corner pulled 180 m south, in place
    const moved = JSON.stringify(Wm.lines()), rebuilt = Wm.memo() !== m1;
    const Wfresh = world(); Wfresh.set({ boundary: [RECT[0], RECT[1], LL(1000, 420), RECT[3]], pat: pat9 });
    const fresh = JSON.stringify(Wfresh.lines());
    check("9c. ... the grid kept between redraws is handed back for the same area only: a corner moved in place files it "
          + "again, and the lines are a fresh drawing's of the moved area",
          () => kept && rebuilt && moved === fresh,
          () => "kept for the same area " + kept + "; filed again after the move " + rebuilt + "; lines as a fresh drawing's " + (moved === fresh));
    // ... the memo asked directly (the review of 2026-11-27: a memo keyed on latitude alone, or on the reference's
    // latitude alone, passed 9c): a corner moved DUE EAST, and the reference moved due east alone, each file it again -
    // its plane ring the one a fresh read of that area about that reference gives
    const Wk = world(); Wk.set({ boundary: RECT.slice(), pat: pat9 });
    const r0 = { lat: 43.06, lon: -70.70 }, k0 = Wk.ringGridAt(r0), kSame = Wk.ringGridAt({ lat: r0.lat, lon: r0.lon }) === k0;
    const east = LL(1300, 600); Wk.poke(2, { lat: RECT[2].lat, lon: east.lon });            // the NE corner, east only
    const k1 = Wk.ringGridAt(r0), kEast = k1 !== k0 && k1.ring[2].e > k0.ring[2].e + 299;
    const r1 = { lat: r0.lat, lon: r0.lon + 0.01 }, k2 = Wk.ringGridAt(r1);
    const kRef = k2 !== k1 && Math.abs(k2.ring[0].e - GD.llEN(RECT[0].lat, RECT[0].lon, r1).e) < 1e-9
                 && Math.abs(k2.ring[0].e - k1.ring[0].e) > 700;
    check("9c-b. ... and asked directly: the same area about the same reference is handed back; a corner moved DUE EAST "
          + "(its latitude unchanged) files it again, and so does the reference moved due east alone - each ring the "
          + "area's about that reference",
          () => kSame && kEast && kRef,
          () => "same " + kSame + "; corner east " + kEast + " (" + (k1.ring[2].e - k0.ring[2].e).toFixed(1) + " m); reference east "
              + kRef + " (" + (k2.ring[0].e - k1.ring[0].e).toFixed(1) + " m)");
  }
  check("9d. ... asking only the edges near each line: on the 6000-corner area a line is handed under 5% of its edges",
        () => laid.length > 100 && asked / laid.length < 0.05 * ringBig.length,
        () => laid.length + " lines, " + (asked / laid.length).toFixed(0) + " edges a line of " + ringBig.length
            + "; the clip " + msGrid.toFixed(1) + " ms with the grid, " + msFull.toFixed(1) + " ms scanning every edge (not asserted)");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
