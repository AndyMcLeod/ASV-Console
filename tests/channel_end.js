// tests/channel_end.js - THE LANE PAST A CHANNEL'S END: held there only where it moves her to STARBOARD.
//
// Andy, 2026-10-10, of his westbound Go-To up the Piscataqua that afternoon:
//
//   "The red circled swerve to the south seems odd and also seems to violate the stay right rule. Describe why this
//    happens, because it happens a lot on this mission. Present a solution that sticks, because we've tried to fix it
//    before."
//
// WHAT HAPPENED. The charted fairway begins at the Memorial Bridge. The path the marks stage handed the chart's lane ran
// 21 m north of the fairway's starboard edge there, so the fairway's own line (three quarters across) was 49 m to PORT
// of it. chartOwnership's ENDS carry the lane on past a channel's end so she holds it to the end and eases off in the
// water beyond - and they carried it as that OFFSET, -49.4 m, six samples back down a path that bends south below the
// bridge. Laid off a bending path, a 49 m offset to port put her on the port side of the reach below the bridge and
// through the SOUTH half of the lift span's opening. Every westbound run of that mission did it.
//
// THE RULE NOW (routing.js chartOwnership, "ONLY A LANE TO STARBOARD OF HER PATH IS HELD PAST THE END"): a move to
// starboard of the search's path is one Rule 9 asks for anywhere, so a lane to starboard is still held to the end; a
// move to PORT is asked for only inside the channel, to bring her in to its line, so a lane to port is not held past
// the end - it eases in inside the channel's first steps, from its starboard side.
//
//   node tests/channel_end.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// 1-3 run the chart's lane on HIS chart and HIS path (tests/fixtures/memorial_bridge.json: the console's ENC extract
// cropped round the bridge, with the path the shipped planner's marks stage laid on that Go-To). They are measured
// against the chart's own bridge polygon and the path the lane was handed, not against anything the lane computes.
// 4-5b are the same geometry drawn plainly, at the end she enters by and the end she leaves by: the refusal (a lane to
// port is not held) and its acceptance (a lane to starboard still is) - so neither "never hold" nor "always hold" passes.
//
// TEETH (2026-10-10, each mutation on a scratch copy of routing.js, this suite run against it):
//   drop the guard at both ends (the shipped tree, d9eabed)    -> 1, 2, 3, 4, 4b
//   drop it at the end she enters by only                      -> 1, 2, 3, 4
//   drop it at the end she leaves by only                      -> 4b
//   hold no lane past any end (the ramp switched off)          -> 5, 5b
// buoy_lane and enc_channel are both green on the shipped defect, which is why this suite exists.
//
// NOT HERE: the reach below the bridge still runs mid-river for ~100 m short of it (0.47 of the water's width). The
// buoyed reach's lane is capped at the pier on the north side of the opening, and its cone eases toward that cap as an
// offset from a path that jogs 63 m north into the opening; loosened by the jog (as the chart's lane's slew is), the
// lane's approach came inside its own floor off the pier's fender and the judge dropped it for the whole route.

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
const R = require("../static/js/routing.js");
const K = require("../static/js/keepouts.js");
const G = require("../static/js/geodesy.js");
const GU = require("../static/js/guard.js");
const SK = require("../static/js/skin.js");
const { bbOf, pinp } = require("../static/js/geometry.js");

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
const f1 = (x) => (x == null || !Number.isFinite(x) ? "n/a" : x.toFixed(1));

// Signed distance of q from the polyline A, + to STARBOARD of A's direction of travel - from the cross product, here,
// so the hand is checked against something outside the code.
const offFrom = (A, q) => {
  let bd = Infinity, x = 0;
  for (let i = 1; i < A.length; i++) {
    const a = A[i - 1], b = A[i], dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy;
    if (!(l2 > 0)) continue;
    const u = Math.max(0, Math.min(1, ((q.e - a.e) * dx + (q.n - a.n) * dy) / l2));
    const d = Math.hypot(q.e - a.e - u * dx, q.n - a.n - u * dy);
    if (d < bd) { bd = d; x = (dx * (q.n - a.n) - dy * (q.e - a.e)) > 0 ? -d : d; }
  }
  return x;
};
// Every 5 m along a polyline.
const along = (T, fn) => {
  for (let i = 1; i < T.length; i++) {
    const a = T[i - 1], b = T[i], n = Math.max(1, Math.ceil(Math.hypot(b.e - a.e, b.n - a.n) / 5));
    for (let k = 0; k < n; k++) fn({ e: a.e + (b.e - a.e) * k / n, n: a.n + (b.n - a.n) * k / n });
  }
  if (T.length) fn(T[T.length - 1]);
};

console.log("The lane past a channel's end - to starboard of her path, or not at all:");

// ── 1-3. HIS CHART, HIS PATH ─────────────────────────────────────────────────────────────────────────────────────
{
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "memorial_bridge.json"), "utf8"));
  const feats = fx.features.slice();
  for (const g of SK.skinGaps(feats, fx.bbox, { partial: fx.partial || [] }).gaps) feats.push(SK.skinGapFeature(g));
  const F = G.planeFrame({ lat: (fx.bbox.S + fx.bbox.N) / 2, lon: (fx.bbox.W + fx.bbox.E) / 2 });
  // (his settings that afternoon: a 5 m buffer, a 5 m depth floor, the water 0.136 m below datum, a 1.23 kn set,
  // a 10 kn transit - the guard's standoff is the lane's clearance in a set)
  const BUF = 5;
  const ko = K.buildKeepouts(F, feats, { minDepthM: 5, wreckRadiusM: K.DEFAULTS.wreckRadiusM, bufferM: BUF, waterOffsetM: -0.136,
    depthRange: { min: 5, max: 0 }, enforce: { land: true, depth: true, haz: true, area: false, wreck: true } });
  const clr = Math.max(BUF, GU.transitStandoffM(BUF, 1.23 * 0.514444, 10 * 0.514444, 20));
  const handed = fx.marks, A = handed.map((p) => F.toEN(p));
  const charted = R.chartedChannelLane(handed, F, ko, BUF, { hold: [], own: null, base: fx.leg, clr });
  const O = R.chartOwnership(handed, F, ko, BUF, fx.leg, clr);
  const B = charted.path.map((p) => F.toEN(p));
  // THE LIFT SPAN she passes under: the chart's bridge polygon her path crosses, as the ENC draws it (overhead, so it
  // is no keep-out - it is read here from the features, not from the model).
  const spans = feats.filter((f) => f.role === "bridge_span" && f.geometry && f.geometry.type === "Polygon")
    .map((f) => f.geometry.coordinates[0].map(([lon, lat]) => F.toEN({ lat, lon })));
  let span = null;
  along(A, (q) => { if (!span) span = spans.find((r) => pinp(q, r)) || null; });
  const sb = span ? bbOf(span) : null;
  // 1. BELOW THE BRIDGE - east of the span's downstream face - the chart's lane moves her nowhere to port.
  let worst = 0, portM = 0, prev = null;
  along(B, (q) => {
    if (sb && q.e > sb.x1 + 1) { const o = offFrom(A, q); worst = Math.min(worst, o); if (o < -1 && prev) portM += Math.hypot(q.e - prev.e, q.n - prev.n); }
    prev = q;
  });
  check("1. BELOW THE MEMORIAL BRIDGE the chart's lane moves her nowhere to PORT of the path it was handed (the fairway "
        + "begins at the bridge: the water below it is not the fairway's)",
        !!span && charted.used && worst >= -1,
        "most to port " + f1(worst) + " m, over " + f1(portM) + " m of route (shipped: 37.9 m over 122 m)");
  // 2. ... because no sample carried past the fairway's end holds a lane to port of her path.
  const rampT = [];
  for (let i = 0; i < O.N; i++) if (O.ramp[i]) rampT.push(O.T[i]);
  check("2. ... every sample the lane is carried on past the fairway's end holds it to STARBOARD of her path, or none is "
        + "carried (it was 49.4 m to port, six samples back)",
        rampT.every((t) => t >= 0),
        rampT.length ? "carried: " + rampT.map(f1).join(", ") + " m" : "none carried - the lane to port eases in inside the fairway");
  // 3. ... and she passes under the lift span on its STARBOARD half (bound up the river: its north half).
  // (measured ALONG THE SPAN, pier to pier: its long axis is its vertices' principal axis - the diagonal of a span
  // 95 m long and 40 m deep is 23 degrees off it - and where she is under it is the middle of her route's run inside
  // its ring, projected onto that axis)
  let frac = NaN, width = NaN;
  if (span) {
    const z = span[span.length - 1], V = z.e === span[0].e && z.n === span[0].n ? span.slice(0, -1) : span;
    const me =V.reduce((s, v) => s + v.e, 0) / V.length, mn = V.reduce((s, v) => s + v.n, 0) / V.length;
    let a = 0, b = 0, c = 0;
    for (const v of V) { a += (v.e - me) ** 2; b += (v.e - me) * (v.n - mn); c += (v.n - mn) ** 2; }
    const th = 0.5 * Math.atan2(2 * b, a - c);
    let u = [Math.cos(th), Math.sin(th)];
    if (u[1] < 0) u = [-u[0], -u[1]];                                   // from its south end
    const t = (v) => (v.e - me) * u[0] + (v.n - mn) * u[1];
    const ts = span.map(t), lo = Math.min(...ts), hi = Math.max(...ts), under = [];
    along(B, (v) => { if (pinp(v, span)) under.push(t(v)); });
    if (under.length) { frac = ((Math.min(...under) + Math.max(...under)) / 2 - lo) / (hi - lo); width = hi - lo; }
  }
  check("3. ... and she passes under the lift span on its STARBOARD half (bound up the river, its north half) - not, "
        + "as she did, close along its south pier",
        frac >= 0.5 && frac <= 1,
        "under the span " + f1(frac * 100) + "% of the way from its south end (" + f1(width) + " m pier to pier)");
}

// ── 4-5b. THE SAME, DRAWN PLAINLY ─────────────────────────────────────────────────────────────────────────────────
// A fairway 200 m wide (e -100..100) from n 1000 to n 3000 in open water; bound north her starboard is east, and the
// fairway's line, three quarters across, is e +50. The search's path comes up to its mouth 20 m OUTSIDE one of its
// edges - in 4 from the south-west, bending north just short of the mouth, as the Piscataqua bends below the bridge -
// and runs on so for 400 m before it comes into the fairway (the chart's lane is laid where the path is in the
// channel somewhere, and on a path beside it within LANE_CAPTURE_STANDOFF_M).
{
  const F = G.planeFrame({ lat: 43.07, lon: -70.71 }), ll = (e, n) => F.fromEN(e, n), BUF = 3;
  const rect = (e0, n0, e1, n1) => [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];
  const ring = rect(-100, 1000, 100, 3000);
  const world = { polys: [], lines: [], points: [], marks: [], sys: K.markSystems([]), restricted: [],
                  chans: [{ ring, bb: bbOf(ring), charted: true }] };
  const lay = (base) => {
    const r = R.channelLaneRoute(base.map((p) => ll(p.e, p.n)), F, world, BUF, {});
    return { r, t: r.route.map((p) => F.toEN(p)) };
  };
  const eAtN = (t, nq) => {
    for (let i = 1; i < t.length; i++) { const a = t[i - 1], b = t[i];
      if ((a.n - nq) * (b.n - nq) <= 0 && a.n !== b.n) return a.e + (b.e - a.e) * (nq - a.n) / (b.n - a.n); }
    return null;
  };
  // (outside it by more than two smoothing steps: the smoothing rounds the knee where she eases in at the mouth - 11 m
  // to port at the mouth itself - and a few meters off the inside of the path's own bend is the smoothing's too; the
  // lane held past the mouth was 70 m to port of her path for 225 m)
  const outside = (q) => q.n < 950 || q.n > 3050;
  // Each END both ways: bound NORTH she comes in at the south mouth (the end she ENTERS by, as at the bridge); bound
  // SOUTH, the same paths reversed, she leaves by it. Bound south her starboard is west and the line is e -50.
  const north = (P) => P, south = (P) => P.slice().reverse();
  const toPort = [{ e: -150, n: -800 }, { e: 120, n: 900 }, { e: 120, n: 1400 }, { e: 20, n: 1700 }, { e: 20, n: 3900 }];
  const toStbd = [{ e: -120, n: -800 }, { e: -120, n: 1400 }, { e: -20, n: 1700 }, { e: -20, n: 3900 }];
  // 4. THE LINE TO PORT OF HER PATH (north: path 20 m outside the starboard edge, the line 70 m to port of it; south:
  // the other path, outside the WEST edge - her starboard edge bound south): not held past the end, either way.
  for (const [n, dir, base, line, paths] of [["4", "bound north, past the end she enters by", north(toPort), 50, "+120"],
                                            ["4b", "bound south, past the end she leaves by", south(toStbd), -50, "-120"]]) {
    const { r, t } = lay(base);
    let worst = 0;
    along(t, (q) => { if (outside(q)) worst = Math.min(worst, offFrom(base, q)); });
    const mid = eAtN(t, 2000);
    check(n + ". A LANE TO PORT OF HER PATH IS NOT HELD PAST A CHANNEL'S END (" + dir + "): with the search's path 20 m "
          + "outside the fairway's starboard edge, nothing outside the fairway is moved to port of it - and inside it she "
          + "rides the fairway's line",
          r.how.charted === true && worst >= -5 && mid != null && Math.abs(mid - line) < 10,
          "outside it, most to port " + f1(worst) + " m; e@2000 " + f1(mid) + " (the line: " + line + "; her path at the mouth: " + paths + ")");
  }
  // 5. THE LINE TO STARBOARD OF HER PATH (170 m): held to the end, as before, either way.
  for (const [n, dir, base, line, paths] of [["5", "bound north, the end she enters by", north(toStbd), 50, "-120"],
                                            ["5b", "bound south, the end she leaves by", south(toPort), -50, "+120"]]) {
    const { r, t } = lay(base);
    const atMouth = eAtN(t, 1000), mid = eAtN(t, 2000);
    check(n + ". ... AND A LANE TO STARBOARD IS STILL HELD TO THE END (" + dir + "): with the search's path 20 m outside "
          + "the fairway's PORT edge, she is on the fairway's line at its mouth, not easing across it inside",
          r.how.charted === true && atMouth != null && Math.abs(atMouth - line) < 10 && mid != null && Math.abs(mid - line) < 10,
          "e@1000 (the mouth) " + f1(atMouth) + ", e@2000 " + f1(mid) + " (the line: " + line + "; her path at the mouth: " + paths + ")");
  }
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED of " + ran : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
