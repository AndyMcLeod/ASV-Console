// tests/keepout_index.js - the row-band index for big rings answers EXACTLY as the plain edge walk
// (2026-09-26), and only the big rings get one.
//
// Andy: "The current instance of ASV Console has frozen. This has happened the last few times."
// MEASURED on his New Castle chart at the boat's recorded position in the frozen session: the land
// and shallow-water rings there run to 5,000-9,000 vertices, their bounding boxes cover the whole
// harbor, and every point test walked every edge of every one of them - 0.3 ms a point, 4.6 s for
// one deviation search, and the guard ran that search on every frame. keepouts.js now indexes a
// ring of RING_INDEX_MIN_VERTS or more vertices by horizontal band on first use, so a point test
// touches only the edges near it. A faster wrong answer here is a route through a pier, so this
// suite is the proof of IDENTITY: the module's blocked / clearanceM / blockedInfo against a plain
// re-walk of the same primitives (core pinp and dSeg, exported), over thousands of points, several
// buffers, big rings, big polylines and the small features that must stay on the plain walk.
//
//   node tests/keepout_index.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ASV_KEEPOUTS names a sidecar copy of the module for a mutation run (it must sit in static/js so
// its own imports resolve).

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
const MOD = process.env.ASV_KEEPOUTS || path.join(__dirname, "..", "static", "js", "keepouts.js");
const K = require(MOD);
const { pinp, dSeg, bbOf } = require("../static/js/core_geometry.js");

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

// ---- a deterministic world ------------------------------------------------------------------
let seed = 20260926;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;

// A big, concave, noisy ring: a radius-300 m coast with bays and headlands, 4,000 vertices.
function coast(cx, cn, nVerts, r0) {
  const ring = [];
  for (let i = 0; i < nVerts; i++) {
    const a = (i / nVerts) * 2 * Math.PI;
    const r = r0 * (1 + 0.25 * Math.sin(7 * a) + 0.12 * Math.sin(23 * a) + 0.03 * (rnd() - 0.5));
    ring.push({ e: cx + r * Math.cos(a), n: cn + r * Math.sin(a) });
  }
  ring.push({ ...ring[0] });                    // GeoJSON-style: the first point repeated
  return ring;
}
// A big polyline: a wandering shoreline of 2,000 points running east.
function shore(e0, n0, nPts) {
  const pts = [];
  let n = n0;
  for (let i = 0; i < nPts; i++) { n += (rnd() - 0.5) * 4; pts.push({ e: e0 + i * 0.5, n }); }
  return pts;
}
const BIG = coast(0, 0, 4000, 300);
const BIG2 = coast(900, 400, 3000, 200);
const SMALL = [{ e: 500, n: -500 }, { e: 540, n: -500 }, { e: 540, n: -460 }, { e: 500, n: -460 }];
const SHORE = shore(-600, -700, 2000);
const SHORT = [{ e: 700, n: 700 }, { e: 760, n: 720 }, { e: 800, n: 700 }];
const polys = [
  { ring: BIG, bb: bbOf(BIG), kind: "land" },
  { ring: BIG2, bb: bbOf(BIG2), kind: "water shallower than 3.0 m" },
  { ring: SMALL, bb: bbOf(SMALL), kind: "a dock / pier" },
];
const lines = [
  { pts: SHORE, bb: bbOf(SHORE), kind: "a shoreline" },
  { pts: SHORT, bb: bbOf(SHORT), kind: "a dock / pier" },
];
const points = [{ e: -700, n: 600, r: 20, kind: "a wreck" }];
const KO = { polys, lines, points, marks: [], sys: [], chans: [] };

// ---- THE REFERENCE: the plain walk, from the exported primitives ------------------------------
const inBB = (p, bb, buf) => p.e >= bb.x0 - buf && p.e <= bb.x1 + buf && p.n >= bb.y0 - buf && p.n <= bb.y1 + buf;
function refBlocked(p, ko, buf) {
  for (const poly of ko.polys) {
    if (!inBB(p, poly.bb, buf)) continue;
    if (pinp(p, poly.ring)) return true;
    const rg = poly.ring;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) if (dSeg(p, rg[j], rg[i]) < buf) return true;
  }
  for (const ln of ko.lines) {
    if (!inBB(p, ln.bb, buf)) continue;
    for (let i = 1; i < ln.pts.length; i++) if (dSeg(p, ln.pts[i - 1], ln.pts[i]) < buf) return true;
  }
  for (const pt of ko.points) {
    const R = buf + (pt.r || 0);
    if (Math.abs(p.e - pt.e) > R || Math.abs(p.n - pt.n) > R) continue;
    if (Math.hypot(p.e - pt.e, p.n - pt.n) < R) return true;
  }
  return false;
}
function refClearance(p, ko, cap) {
  let best = cap;
  for (const poly of ko.polys) {
    if (!inBB(p, poly.bb, best)) continue;
    if (pinp(p, poly.ring)) return 0;
    const rg = poly.ring;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) { const d = dSeg(p, rg[j], rg[i]); if (d < best) best = d; }
  }
  for (const ln of ko.lines) {
    if (!inBB(p, ln.bb, best)) continue;
    for (let i = 1; i < ln.pts.length; i++) { const d = dSeg(p, ln.pts[i - 1], ln.pts[i]); if (d < best) best = d; }
  }
  for (const pt of ko.points) {
    const r = pt.r || 0;
    if (Math.abs(p.e - pt.e) > best + r || Math.abs(p.n - pt.n) > best + r) continue;
    const d = Math.max(0, Math.hypot(p.e - pt.e, p.n - pt.n) - r);
    if (d < best) best = d;
  }
  return best;
}
function refInfoKind(p, ko, buf) {
  for (const poly of ko.polys) {
    if (!inBB(p, poly.bb, buf)) continue;
    if (pinp(p, poly.ring)) return poly.kind;
    const rg = poly.ring;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) if (dSeg(p, rg[j], rg[i]) < buf) return poly.kind;
  }
  for (const ln of ko.lines) {
    if (!inBB(p, ln.bb, buf)) continue;
    for (let i = 1; i < ln.pts.length; i++) if (dSeg(p, ln.pts[i - 1], ln.pts[i]) < buf) return ln.kind;
  }
  for (const pt of ko.points) {
    const R = buf + (pt.r || 0);
    if (Math.abs(p.e - pt.e) > R || Math.abs(p.n - pt.n) > R) continue;
    if (Math.hypot(p.e - pt.e, p.n - pt.n) < R) return pt.kind;
  }
  return null;
}

// ---- the points: everywhere, and DENSE along the edges where the answers flip ----------------
const pts = [];
for (let i = 0; i < 2500; i++) pts.push({ e: rnd() * 2400 - 1200, n: rnd() * 2000 - 1000 });
for (let i = 0; i < 1500; i++) {                              // within a few meters of BIG's edge
  const v = BIG[Math.floor(rnd() * (BIG.length - 1))];
  pts.push({ e: v.e + (rnd() - 0.5) * 12, n: v.n + (rnd() - 0.5) * 12 });
}
for (let i = 0; i < 600; i++) {                               // and of the shoreline's
  const v = SHORE[Math.floor(rnd() * SHORE.length)];
  pts.push({ e: v.e + (rnd() - 0.5) * 10, n: v.n + (rnd() - 0.5) * 10 });
}
for (let i = 0; i < 300; i++) {                               // and exactly on a band boundary of BIG, where a rounding slip would show
  const v = BIG[Math.floor(rnd() * (BIG.length - 1))];
  pts.push({ e: v.e + (rnd() - 0.5) * 6, n: v.n });
}
const BUFS = [0, 0.5, 3, 5, 12];

console.log("The keep-out index answers exactly as the plain walk:");

// ── 1. IDENTITY ────────────────────────────────────────────────────────────────────────────
{
  let bad = [], n = 0, blockedN = 0;
  for (const p of pts) for (const buf of BUFS) {
    n++;
    const a = K.blocked(p, KO, buf), b = refBlocked(p, KO, buf);
    if (a) blockedN++;
    if (a !== b) bad.push({ p, buf, got: a, want: b });
  }
  check("1. blocked(): the same yes/no as the plain walk at every point and buffer (" + n + " asks, " + blockedN + " blocked)",
        () => bad.length === 0, () => bad.length + " disagreement(s): " + JSON.stringify(bad.slice(0, 3)));
}
{
  let bad = [], worst = 0;
  for (const p of pts) for (const cap of [500, 40, 3]) {
    const a = K.clearanceM(p, KO, cap), b = refClearance(p, KO, cap);
    const d = Math.abs(a - b); if (d > worst) worst = d;
    if (d > 1e-9) bad.push({ p, cap, got: a, want: b });
  }
  check("2. clearanceM(): the same distance to the nearest edge, to a nanometer, at every point and cap",
        () => bad.length === 0, () => "worst difference " + worst + " m; " + bad.length + " disagreement(s): " + JSON.stringify(bad.slice(0, 3)));
}
{
  let bad = [];
  for (const p of pts) for (const buf of BUFS) {
    const a = K.blockedInfo(p, KO, buf), b = refInfoKind(p, KO, buf);
    if ((a ? a.kind : null) !== b) bad.push({ p, buf, got: a && a.kind, want: b });
  }
  check("3. blockedInfo(): names the same feature (or none) at every point and buffer",
        () => bad.length === 0, () => bad.length + " disagreement(s): " + JSON.stringify(bad.slice(0, 3)));
}

// ── 2. WHO IS INDEXED ──────────────────────────────────────────────────────────────────────
check("4. after those asks the big rings and the long shoreline carry an index, and the small features never do",
      () => K.ringIndexed(BIG) && K.ringIndexed(BIG2) && K.ringIndexed(SHORE) && !K.ringIndexed(SMALL) && !K.ringIndexed(SHORT)
            && BIG.length >= K.RING_INDEX_MIN_VERTS && SMALL.length < K.RING_INDEX_MIN_VERTS,
      () => "BIG " + K.ringIndexed(BIG) + ", BIG2 " + K.ringIndexed(BIG2) + ", SHORE " + K.ringIndexed(SHORE) + ", SMALL " + K.ringIndexed(SMALL)
          + ", SHORT " + K.ringIndexed(SHORT) + " (threshold " + K.RING_INDEX_MIN_VERTS + " vertices)");

// ── 3. THE EDGE CASES A BAND INDEX CAN GET WRONG ───────────────────────────────────────────
{
  // points outside the ring's northing span but inside its bbox-with-buffer, above and below
  const bb = bbOf(BIG);
  const probes = [{ e: 0, n: bb.y1 + 1 }, { e: 0, n: bb.y0 - 1 }, { e: 0, n: bb.y1 + 0.001 }, { e: 0, n: bb.y0 - 0.001 },
                  { e: bb.x1 + 1, n: 0 }, { e: bb.x0 - 1, n: 0 }, { e: 0, n: bb.y1 }, { e: 0, n: bb.y0 }];
  let bad = [];
  for (const p of probes) for (const buf of [0, 3, 12]) {
    if (K.blocked(p, KO, buf) !== refBlocked(p, KO, buf) || Math.abs(K.clearanceM(p, KO, 200) - refClearance(p, KO, 200)) > 1e-9)
      bad.push({ p, buf });
  }
  check("5. a point just outside the ring's northing span (its band would not exist) reads as the plain walk does, inside or out, near or far",
        () => bad.length === 0, () => JSON.stringify(bad));
}
{
  // a ring that is a single horizontal band tall (degenerate height): still indexed, still right
  const flat = []; for (let i = 0; i < 600; i++) flat.push({ e: i, n: 2000 + (i % 2) * 0.001 });
  for (let i = 599; i >= 0; i--) flat.push({ e: i, n: 2000.5 });
  const ko2 = { polys: [{ ring: flat, bb: bbOf(flat), kind: "a sliver" }], lines: [], points: [] };
  let bad = [];
  for (let i = 0; i < 400; i++) {
    const p = { e: rnd() * 700 - 50, n: 2000.25 + (rnd() - 0.5) * 8 };
    for (const buf of [0, 1, 3]) if (K.blocked(p, ko2, buf) !== refBlocked(p, ko2, buf)) bad.push({ p, buf });
  }
  check("6. a 600-vertex sliver half a meter tall - one band - answers as the plain walk",
        () => bad.length === 0 && K.ringIndexed(flat), () => bad.length + " disagreement(s); indexed " + K.ringIndexed(flat));
}
{
  // legClear and firstBlockAlong go through the same primitives: a leg grazing the big ring
  const frame = { toEN: (q) => q, fromEN: (e, n) => ({ e, n }) };
  const a = { e: -400, n: 0 }, b = { e: 400, n: 0 };
  const legRef = (() => { const L = 800, n = Math.max(1, Math.ceil(L / 1.5)); for (let i = 0; i <= n; i++) { const t = i / n; if (refBlocked({ e: a.e + 800 * t, n: 0 }, KO, 3)) return false; } return true; })();
  check("7. legClear reads through the index too: a leg across the big ring is blocked, exactly as the plain walk says",
        () => K.legClear(a, b, frame, KO, 3) === legRef && legRef === false
              && K.firstBlockAlong(a, b, frame, KO, 3).info.kind === "land",
        () => "legClear " + K.legClear(a, b, frame, KO, 3) + " (plain " + legRef + "); first block: " + JSON.stringify(K.firstBlockAlong(a, b, frame, KO, 3).info.kind));
}

// ── 4. THE COST, said rather than asserted (a timing assertion is a flaky check) ───────────
{
  const probe = { e: 250, n: 40 };
  let t0 = Date.now(); for (let i = 0; i < 2000; i++) K.blocked(probe, KO, 3); const tIdx = Date.now() - t0;
  t0 = Date.now(); for (let i = 0; i < 2000; i++) refBlocked(probe, KO, 3); const tRef = Date.now() - t0;
  console.log("  (2000 point tests beside the 4,000-vertex ring: indexed " + tIdx + " ms, plain walk " + tRef + " ms)");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
