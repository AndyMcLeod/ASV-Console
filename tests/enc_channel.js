// tests/enc_channel.js - THE CHART'S OWN CHANNELS, AND THE MARKS THAT STAND ALONE (2026-10-03).
//
// Andy, 2026-10-03, on a Go-To from New Castle up the Piscataqua to Adams Point: "the ASV does not run to the right
// side of the ENC marked channel for most of the run. It seems to run to the right of a channel only when there are
// buoy pairs. Any given ASV should recognize a channel from the ENC before relying on buoy placement. The buoys will
// act as a secondary position reference ... using the red-right-returning paradigm a vessel should keep red buoys to
// the right and green buoys to the left when returning to port. Often this means keeping the buoy close to the track
// rather than at great distance ... Often, there are not paired buoys but single buoys of a particular color."
// His three calls, asked before the code: a channel on the ENC is a charted Fairway or Dredged Area only; where none
// is charted the buoys shape the route, singles included; a buoy kept to starboard is passed at 10 m or 2 x buffer.
//
// Two stages of static/js/routing.js's channelLaneRoute, and the flags and the wording that carry them:
//
//   1-2    keepouts.js: a charted fairway / dredged ring is `charted`, a buoy-gate corridor is not; a beacon is `fixed`;
//   3-9    chartedChannelLane on a straight charted channel: three quarters of the way across the POLYGON both ways,
//          port to port; nothing without the flag (the CONTROL - it is what the console did); the line held to the
//          channel's END and eased off past it (v3); a crossing, a path beside it, and a basin left alone;
//   10-11  a bend cut between two stretches of the channel bridged, and not past CHART_BRIDGE_REACH_M;
//   12     the lane point foul: back toward the middle, never to port of it, clear of the keep-out;
//   13     buoys wider than the charted channel: the chart's line, not the buoys' (the control: the buoys');
//   14     a dredged cut between banks wider than it: the cut's line, not the banks' (the control: the banks');
//   15-18  marks that stand alone, returning: a buoy kept to starboard passed MARK_PASS_M off; port-hand marks left
//          alone where they already are to port; the count; and leaving, the other hand;
//   19-20  a mark on the WRONG hand: the route crosses to its proper side - a starboard-hand one close, a port-hand
//          one at the wider berth;
//   21     a BEACON is never brought close, and is still left on its proper hand;
//   22-23  a lone mark, and marks with no numbers, say nothing about the direction of buoyage and move nothing;
//   24     a channel that TURNS AWAY past the mark is one she is leaving (the control: one that runs on is hers);
//   25     a route that begins beside a mark is not passing it;
//   26     MARK_PASS_M: 10 m, 2 x buffer, the standoff and a little more; and a set stands her off by it;
//   27     marks inside a charted channel are the chart's, not this stage's;
//   28     land between her and a mark: other water;
//   29     each mark read from its OWN HAND along her route (v3); 29b: where those either side disagree, left alone;
//   30-31  THE PISCATAQUA AS CHARTED (the marks' real positions and the search's own path): through the 12/13 gate,
//          Buoy 15 of the Dover branch left alone, round Fox Point Rock, east of The Rocks and Little Bay 4A; and
//          the same water leaving, where she JOINS the count below 15 (31c);
//   31b    two marks that cannot both be kept: one counted wrong, the route partial, and the banner says a MARK;
//   32-33  marksKept counts the route that SHIPS; a MANEUVER (`marks:false`, `charted:false`) is the pipeline as it was;
//   34-36  passage.js: `how` travels with the plan through planNogoRoute, the standoff re-gate and routePlan; a
//          fly-through and the way back onto station are maneuvers;
//   37     buoyageNote: the old strings without `how`, and what each keep-right says with it;
//   38     the page words the banner and the Intent row from `plan.how`;
//   39-52  v3 (2026-10-04): pairs handing over to the chart and back; an end ahead of the lane; a dredged patch beside the
//          fairway; a channel of its own name across her route; a pair's mark left on its wrong hand; the wrong hand
//          first; a stub beside a sharp turn; a path beside a channel that never enters it; a run rejoining her route
//          at a bend of it; a mark left alone on its proper hand that another pass must not cross; a small berth;
//          the stub rule asked for; a small charted patch off the fairway's side (51); two ways past a mark (52).
//   53-63  the review's findings (2026-10-04): an entrance gate crossed obliquely (53); another named channel's count
//          (54); an entrance gate named apart (55); a turn to port at a channel's end (56); a fairway ending in a basin
//          (57); marks' runs in water the chart rides (58); the cone's band inverted (59); a drawn transit's waypoint
//          beside a mark on its wrong hand (60); the stage bounded by work, not the clock (61); the lane laid clear of
//          the standoff in a set (62); the knot prune keeping a run's pass point, not its ends (63); the chart's lane
//          not claimed where most of its water was crossed short (64); 14c, the banks' lane not claimed where the
//          chart's replaced it; 25b, a mark beside her start excused the count (her berth) - 25d, one far along from
//          it counted; 25c, "passed close" said of
//          the buoys that were; and 60b, a mark both legs of a turning transit judge, counted from the leg that knows
//          its direction.
//   the re-verification (2026-10-04): 53 at 35 and 45 degrees both ways; 54b, a count numbered on FROM the mark, both
//          ways; 58 with the search's path 400 m out (the cone in each sample's own frame); 60c, each transit leg judged
//          on its own part of the route (out and back; an approach with survey lines back down the channel); 65, a
//          channel that really narrows at its end; THE CONE: 66, a width step, with and without land past it; 66b,
//          eased to port of the middle where the narrow part's edge steps in past it on the stretch she runs straight
//          along, never out of the water; 67, a width step round a bend; 59b, the band inverted at the join of two charted rings; 64b, the chart's claim measured in a set on
//          the route the standoff's re-gate ships; 68, a dogleg of two charted rings (the cross-sections where they
//          join are no narrowing); 68b, nor a cross-section that does not hold her.
//
//   node tests/enc_channel.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ASV_HTML points check 38 at a SIDECAR copy for a mutation run. The modules are required from static/js, so a
// mutation of routing.js / keepouts.js / passage.js is run in a scratch export of the tree, not on a sidecar.

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
const R = require("../static/js/routing.js");
const K = require("../static/js/keepouts.js");
const G = require("../static/js/geodesy.js");
const { bbOf } = require("../static/js/geometry.js");

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

const F = G.planeFrame({ lat: 43.07, lon: -70.71 });
const ll = (e, n) => F.fromEN(e, n);
const BUF = 3;
const f1 = (x) => (x == null ? "n/a" : x.toFixed(1));
const rect = (e0, n0, e1, n1) => [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];
const chan = (ring, charted) => (charted ? { ring, bb: bbOf(ring), charted: true } : { ring, bb: bbOf(ring) });
const land = (ring, kind) => ({ ring, bb: bbOf(ring), kind: kind || "land" });
const mark = (e, n, side, num, sys, fixed) => (fixed ? { e, n, side, num, sys, fixed: true } : { e, n, side, num, sys });
const RED = 1, GREEN = -1;                       // CATLAM's hand: starboard-hand marks are red in these waters
const model = (o) => ({ polys: o.polys || [], lines: [], points: o.points || [], marks: o.marks || [],
                        sys: K.markSystems(o.marks || []), chans: o.chans || [] });
// The route as EN points. channelLaneRoute's route BEGINS at the start point (planNogoRoute slices it off), so it is
// the whole track as it stands: prepending the start again made a zero-length first leg, which reads as a 180 degree
// turn on any route that does not head north.
const lane = (world, base, opts, buf) => {
  const pts = base.map((p) => ll(p.e, p.n));
  const r = R.channelLaneRoute(pts, F, world, buf == null ? BUF : buf, opts || {});
  r.track = r.route.map((p) => F.toEN(p));
  return r;
};
const eAtN = (t, nq) => {
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1], b = t[i];
    if ((a.n - nq) * (b.n - nq) <= 0 && a.n !== b.n) return a.e + (b.e - a.e) * (nq - a.n) / (b.n - a.n);
  }
  return null;
};
const nAtE = (t, eq) => {
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1], b = t[i];
    if ((a.e - eq) * (b.e - eq) <= 0 && a.e !== b.e) return a.n + (b.n - a.n) * (eq - a.e) / (b.e - a.e);
  }
  return null;
};
// Where a mark lies off a track: + to STARBOARD of her direction of travel, at the nearest point. Written here from
// the cross product, not taken from the module, so the hand is checked against something outside the code.
const offOf = (t, m) => {
  let bd = 1e18, x = 0;
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1], b = t[i], dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy;
    if (!(l2 > 0)) continue;
    const u = Math.max(0, Math.min(1, ((m.e - a.e) * dx + (m.n - a.n) * dy) / l2));
    const d = Math.hypot(m.e - a.e - u * dx, m.n - a.n - u * dy);
    if (d < bd) { bd = d; x = (dx * (m.n - a.n) - dy * (m.e - a.e)) > 0 ? -d : d; }
  }
  return x;
};
const legsClear = (r, world) => {
  const full = r.route;
  for (let i = 1; i < full.length; i++) if (!K.legClear(full[i - 1], full[i], F, world, BUF)) return false;
  return true;
};
const sharpest = (t) => {
  let m = 0;
  for (let i = 1; i < t.length - 1; i++) {
    const a1 = Math.atan2(t[i].e - t[i - 1].e, t[i].n - t[i - 1].n), a2 = Math.atan2(t[i + 1].e - t[i].e, t[i + 1].n - t[i].n);
    m = Math.max(m, Math.abs((((a2 - a1) * 180 / Math.PI + 540) % 360) - 180));
  }
  return m;
};

console.log("The chart's own channels, and the marks that stand alone:");

// ── 1-2. the flags ───────────────────────────────────────────────────────────────────────────────────────────
{
  const poly = (role, cls, r) => ({ role, cls, props: {}, geometry: { type: "Polygon",
    coordinates: [[...r, r[0]].map((p) => { const q = ll(p.e, p.n); return [q.lon, q.lat]; })] } });
  const pt = (cls, e, n, CATLAM, OBJNAM) => { const q = ll(e, n);
    return { role: "chan_mark", cls, props: { CATLAM, OBJNAM }, geometry: { type: "Point", coordinates: [q.lon, q.lat] } }; };
  const feats = [poly("fairway", "Fairway_area", rect(-100, 0, 100, 1000)),
                 poly("dredged", "Dredged_Area", rect(-40, 1000, 40, 1500)),
                 pt("Buoy_Lateral_point", -900, 5000, 1, "Far Gate Buoy 1"), pt("Buoy_Lateral_point", -800, 5000, 2, "Far Gate Buoy 2"),
                 pt("Beacon_Lateral_point", 300, 300, 2, "Stone Point Light 4")];
  const ko = K.buildKeepouts(F, feats, {});
  check("1. a charted fairway and a charted dredged area are `charted`; the corridor swept between two buoys is not",
        ko.chans.length === 3 && ko.chans[0].charted === true && ko.chans[1].charted === true
          && !("charted" in ko.chans[2]),
        "chans: " + ko.chans.map((c) => (c.charted ? "charted" : "corridor")).join(", "));
  const bcn = ko.marks.find((m) => m.num === 4), buoy = ko.marks.find((m) => m.num === 1);
  check("2. a lateral BEACON is `fixed`; a buoy is the object it always was",
        bcn && bcn.fixed === true && bcn.side === 1 && buoy && !("fixed" in buoy)
          && Object.keys(buoy).join(",") === "e,n,side,num,sys",
        "beacon " + JSON.stringify(bcn && { side: bcn.side, fixed: bcn.fixed }) + "; buoy keys " + (buoy && Object.keys(buoy).join(",")));
}

// ── 3-9. a straight charted channel, 200 m wide, in open water ───────────────────────────────────────────────
// e = -100 .. +100, n = 0 .. 3000. No banks, no buoys: the only thing that says "channel" is the chart's polygon.
const RING = rect(-100, 0, 100, 3000);
const C1 = model({ chans: [chan(RING, true)] });
const NB = [{ e: -80, n: -400 }, { e: -80, n: 3400 }], SB = [{ e: 80, n: 3400 }, { e: 80, n: -400 }];
{
  const nb = lane(C1, NB), sb = lane(C1, SB);
  const en = [1000, 1500, 2000].map((n) => eAtN(nb.track, n)), es = [1000, 1500, 2000].map((n) => eAtN(sb.track, n));
  check("3. NORTHBOUND down the port side of a charted channel: she is brought three quarters of the way across it",
        en.every((e) => e != null && Math.abs(e - 50) < 3) && nb.lane === true && nb.partial === false
          && nb.how.charted === true && nb.how.pairs === false && nb.how.narrow === false,
        "e@1000,1500,2000 = " + en.map(f1).join(",") + " (want +50: the channel is -100..+100 and the routed path was at -80); how "
          + JSON.stringify(nb.how));
  check("4. SOUTHBOUND: the other side of it",
        es.every((e) => e != null && Math.abs(e + 50) < 3) && sb.how.charted === true,
        "e@1000,1500,2000 = " + es.map(f1).join(",") + " (want -50: starboard is WEST going south)");
  check("5. the two pass PORT TO PORT, half the channel apart",
        en.every((e, i) => e - es[i] > 90), "separation " + en.map((e, i) => f1(e - es[i])).join(","));
  // 6. THE CONTROL, and what the console did before 2026-10-03: the same polygon as a buoy-gate corridor (no flag).
  // It only ever said WHERE Rule 9 applies; the lane's edges came from banks, and there are none here.
  const plain = lane(model({ chans: [chan(RING, false)] }), NB);
  const ep = [1000, 1500, 2000].map((n) => eAtN(plain.track, n));
  check("6. THE CONTROL: the same polygon without the chart's flag moves nothing (what the console did before)",
        ep.every((e) => e != null && Math.abs(e + 80) < 1) && plain.lane === false,
        "e = " + ep.map(f1).join(",") + " (the routed path, -80); lane " + plain.lane);
  // 7. THE ENDS (2026-10-04, v3): she holds the chart's line to the END of the channel and eases off PAST it, no
  // steeper than LANE_SLEW, and is on the routed path at the route's own ends. (The first cut eased in after she
  // entered - 370 m of the channel's first stretch ridden off its line, left of center for half of it - and eased
  // freely, the lane was still 65 m off the routed path where the channel ended.)
  const inner = [0, 100, 2900, 3000].map((n) => eAtN(nb.track, n));
  const out = [-300, -100, 3100, 3300].map((n) => eAtN(nb.track, n));
  const slopes = [(out[1] - out[0]) / 200, (out[2] - out[3]) / 200];
  const ends = [nb.track[0].e, nb.track[nb.track.length - 1].e];
  check("7. THE ENDS: the chart's line to the end of the channel, eased off PAST it no steeper than LANE_SLEW, and on "
        + "the routed path at the route's own ends",
        inner.every((e) => e != null && Math.abs(e - 50) < 3) && out.every((e) => e != null)
          && slopes.every((s) => s > 0.2 && s <= R.LANE_SLEW + 0.02) && ends.every((e) => Math.abs(e + 80) < 1),
        "e@0,100,2900,3000 = " + inner.map(f1).join(",") + " (want +50); e@-300,-100,3100,3300 = " + out.map(f1).join(",")
          + ", " + slopes.map((s) => s.toFixed(3)).join(" / ") + " m across per m along (LANE_SLEW " + R.LANE_SLEW
          + "); the route's ends at e = " + ends.map(f1).join(",") + " (want -80)");
  // 8. A crossing is IN the channel too, and "three quarters across" along a crossing track is hundreds of meters
  // up the channel. Rule 9(a) is about a vessel "proceeding along the course" of it.
  const cross = lane(C1, [{ e: -600, n: 1500 }, { e: 600, n: 1500 }]);
  const nc = [-50, 0, 50].map((e) => nAtE(cross.track, e));
  const slant = lane(C1, [{ e: -500, n: 1100 }, { e: 500, n: 1900 }]);          // 51 degrees off the channel's axis
  const ns = nAtE(slant.track, 0);
  check("8. a CROSSING of the channel, square or at 51 degrees to it, is not moved",
        nc.every((n) => n != null && Math.abs(n - 1500) < 1) && cross.how.charted === false
          && ns != null && Math.abs(ns - 1500) < 2 && slant.how.charted === false,
        "square: n@e=-50,0,50 = " + nc.map(f1).join(",") + "; slanted: n@e=0 = " + f1(ns) + " (want 1500)");
  // 8b. ... and one within the ratio IS proceeding along it: 20 degrees off the axis.
  const shallow = lane(C1, [{ e: -95, n: 200 }, { e: -95 + 2400 * Math.tan(4 * Math.PI / 180), n: 2600 }]);
  const e8 = eAtN(shallow.track, 1500);
  check("8b. a track 4 degrees off the channel's axis is proceeding along it, and is laned",
        e8 != null && Math.abs(e8 - 50) < 4 && shallow.how.charted === true, "e@1500 = " + f1(e8) + " (want +50)");
  // 9. A path BESIDE the channel that never enters it is not using it, however near.
  const beside = lane(C1, [{ e: -130, n: -400 }, { e: -130, n: 3400 }]);
  const eb = eAtN(beside.track, 1500);
  check("9. a path 30 m outside the channel that never enters it is left where it is",
        eb != null && Math.abs(eb + 130) < 1 && beside.lane === false, "e@1500 = " + f1(eb) + " (want -130)");
  // 9b. A basin: charted water about as wide as it is long. Nothing in it is "along".
  const basin = lane(model({ chans: [chan(rect(-300, 0, 300, 700), true)] }), [{ e: -250, n: -400 }, { e: -250, n: 1100 }]);
  const e9 = eAtN(basin.track, 350);
  check("9b. a BASIN - 600 m across, 700 m long - is not a channel she is proceeding along",
        e9 != null && Math.abs(e9 + 250) < 1 && basin.how.charted === false,
        "e@350 = " + f1(e9) + " (want -250; three quarters across would be +150)");
}

// ── 10-11. the bend cut ──────────────────────────────────────────────────────────────────────────────────────
// The router takes the inside of a bend. At Boiling Rock the Go-To ran 13 to 90 m outside the charted fairway for
// 1.7 km between two stretches inside it. Here: inside at e = -80, then 70 m OUTSIDE the port edge for 600 m - past
// the 60 m a path beside a channel is captured at - then inside again.
{
  const cut = (out) => [{ e: -80, n: -200 }, { e: -80, n: 900 }, { e: -100 - out, n: 1100 }, { e: -100 - out, n: 1700 },
                        { e: -80, n: 1900 }, { e: -80, n: 3200 }];
  const near = lane(C1, cut(70));
  const en = [1200, 1400, 1600].map((n) => eAtN(near.track, n));
  check("10. A BEND CUT: 70 m outside the channel between two stretches of it, she is held in the channel's lane",
        en.every((e) => e != null && Math.abs(e - 50) < 4),
        "e@1200,1400,1600 = " + en.map(f1).join(",") + " (want +50; the routed path was at -170, and a path beside a "
          + "channel is only captured within " + R.LANE_CAPTURE_STANDOFF_M(BUF) + " m)");
  const far = lane(C1, cut(R.CHART_BRIDGE_REACH_M + 50));
  const ef = eAtN(far.track, 1400);
  check("11. ... and not past CHART_BRIDGE_REACH_M: a path that goes " + (R.CHART_BRIDGE_REACH_M + 50) + " m off has left it",
        ef != null && Math.abs(ef + 100 + R.CHART_BRIDGE_REACH_M + 50) < 2,
        "e@1400 = " + f1(ef) + " (want " + (-100 - R.CHART_BRIDGE_REACH_M - 50) + ", the routed path)");
}

// ── 12. the lane point foul ──────────────────────────────────────────────────────────────────────────────────
// A pier across the starboard quarter (e = 30 .. 100) for 400 m. The lane is a preference; the keep-out model is law.
{
  const pier = land(rect(30, 1300, 100, 1700), "a dock / pier");
  const w = model({ polys: [pier], chans: [chan(RING, true)] });
  const r = lane(w, NB);
  const at = [1400, 1500, 1600].map((n) => eAtN(r.track, n)), clear = [900, 2200].map((n) => eAtN(r.track, n));
  check("12. THE LANE POINT FOUL (a pier in the starboard quarter): she comes back toward the middle, never to port of "
        + "it, clear of the pier; and is at three quarters again beyond it",
        at.every((e) => e != null && e >= -1 && e <= 30 - BUF) && clear.every((e) => Math.abs(e - 50) < 4)
          && legsClear(r, w),
        "e@1400,1500,1600 = " + at.map(f1).join(",") + " (the pier's face is e=30, the middle e=0); e@900,2200 = "
          + clear.map(f1).join(","));
}

// ── 13. the chart, not the buoys ─────────────────────────────────────────────────────────────────────────────
// Buoy pairs 300 m apart round the 200 m charted channel. The pair lane rides a quarter of the BUOYS' width (e = +75).
{
  const ns = [400, 900, 1400, 1900, 2400];
  const marks = [...ns.map((n, i) => mark(-150, n, GREEN, 2 * i + 1, "ch")), ...ns.map((n, i) => mark(150, n, RED, 2 * i + 2, "ch"))];
  const flagged = lane(model({ marks, chans: [chan(RING, true)] }), NB);
  const control = lane(model({ marks, chans: [chan(RING, false)] }), NB);
  const ef = [1000, 1500, 2000].map((n) => eAtN(flagged.track, n)), ec = [1000, 1500, 2000].map((n) => eAtN(control.track, n));
  check("13. THE CHART BEFORE THE BUOYS: buoy pairs 300 m apart round a 200 m charted channel - she rides the chart's "
        + "line, and the pair lane stands down (the control, no charted flag: the buoys' line)",
        ef.every((e) => Math.abs(e - 50) < 3) && flagged.how.charted && !flagged.how.pairs && flagged.how.marks.kept === 0
          && flagged.marks.every((k) => /charted channel/.test(k.skip || ""))
          && ec.every((e) => Math.abs(e - 75) < 4) && control.how.pairs === true,
        "charted: e = " + ef.map(f1).join(",") + " (want 50); control: e = " + ec.map(f1).join(",") + " (want 75)");
}

// ── 14. the chart, not the banks ─────────────────────────────────────────────────────────────────────────────
// A dredged cut 60 m wide between banks 120 m apart. The unmarked lane measured from the BANKS puts her at +30,
// which is the charted cut's own starboard EDGE. Measured across the cut, +15.
{
  const banks = [land(rect(-400, -600, -60, 3600)), land(rect(60, -600, 400, 3600))];
  const cutRing = rect(-30, 0, 30, 3000), base = [{ e: -10, n: -400 }, { e: -10, n: 3400 }];
  const flagged = lane(model({ polys: banks, chans: [chan(cutRing, true)] }), base);
  const control = lane(model({ polys: banks, chans: [chan(cutRing, false)] }), base);
  const ef = [1000, 1500, 2000].map((n) => eAtN(flagged.track, n)), ec = [1000, 1500, 2000].map((n) => eAtN(control.track, n));
  check("14. THE CHART BEFORE THE BANKS: a 60 m charted cut between banks 120 m apart - a quarter of the CUT's width in "
        + "from its edge (the control: a quarter of the water's, which is the cut's own edge)",
        ef.every((e) => Math.abs(e - 15) < 2.5) && flagged.how.charted === true
          && ec.every((e) => e > 24) && control.how.narrow === true && control.how.charted === false,
        "charted: e = " + ef.map(f1).join(",") + " (want 15); control: e = " + ec.map(f1).join(",") + " (the banks' lane)");
  // 14b. Outside the cut the banks' lane is still there: the unmarked lane lost only the chart's water.
  const eo = [-300, 3300].map((n) => eAtN(flagged.track, n));
  check("14b. ... and beyond the cut's ends the narrow water between the banks is still laned by them",
        eo.every((e) => e != null && e > 15) && flagged.how.narrow === true,
        "e@-300,3300 = " + eo.map(f1).join(",") + " (the banks are 120 m apart: a narrow channel on its own)");
  // 14c. ... and where the cut is charted the WHOLE way, the banks' lane is not claimed: every vertex it moved is in
  // water the chart rides, and she is on the chart's line (the banner said "channel lane, centerline to port" too).
  const whole = lane(model({ polys: [land(rect(-400, -1600, -60, 4600)), land(rect(60, -1600, 400, 4600))],
                             chans: [chan(rect(-30, -1000, 30, 4000), true)] }), base);
  const ew = [0, 1500, 3000].map((n) => eAtN(whole.track, n));
  check("14c. ... and charted the whole way, the banks' lane is NOT claimed: the line she rides is the chart's",
        ew.every((e) => e != null && Math.abs(e - 15) < 2.5) && whole.how.charted === true && whole.how.narrow === false,
        "e@0,1500,3000 = " + ew.map(f1).join(",") + " (want 15); how " + JSON.stringify({ charted: whole.how.charted, narrow: whole.how.narrow }));
}

// ── 15-18. marks that stand alone ────────────────────────────────────────────────────────────────────────────
// Five buoys, each with a name of its own, numbered from seaward going north. Open water. The route runs up e = 0.
const SINGLES = [mark(120, 500, RED, 2, "alpha rock"), mark(-150, 1000, GREEN, 3, "bravo ledge"),
                 mark(200, 1500, RED, 4, "charlie shoal"), mark(-90, 2000, GREEN, 5, "delta point"),
                 mark(150, 2500, RED, 6, "echo reef")];
const M1 = model({ marks: SINGLES });
const UP = [{ e: 0, n: -1500 }, { e: 0, n: 4500 }], DOWN = [{ e: 0, n: 4500 }, { e: 0, n: -1500 }];
const PASS = R.MARK_PASS_M(BUF, 0);
{
  const up = lane(M1, UP);
  const reds = SINGLES.filter((m) => m.side === RED), greens = SINGLES.filter((m) => m.side === GREEN);
  const eu = reds.map((m) => eAtN(up.track, m.n));
  check("15. RETURNING (the numbers rising along the route): each red buoy is passed " + PASS + " m off, on her starboard hand",
        eu.every((e, i) => e != null && Math.abs(e - (reds[i].e - PASS)) < 1.5) && reds.every((m) => offOf(up.track, m) > 0),
        "e abeam of the reds = " + eu.map(f1).join(",") + " (want " + reds.map((m) => m.e - PASS).join(",") + "; the routed path was at 0)");
  check("16. ... the green ones, already to port, are left where they are: she is not brought to them",
        greens.every((m) => offOf(up.track, m) < -R.MARK_PASS_M(BUF, 0)),
        "greens lie " + greens.map((m) => f1(offOf(up.track, m))).join(",") + " m off (- = to port)");
  check("17. ... and the plan says so: five marks kept, three to starboard and two to port, none wrong, nothing partial",
        up.lane === true && up.partial === false && up.how.marks.kept === 5 && up.how.marks.stbd === 3
          && up.how.marks.port === 2 && up.how.marks.wrong === 0 && up.how.pairs === false && up.how.charted === false,
        JSON.stringify(up.how) + " partial " + up.partial);
  const dn = lane(M1, DOWN);
  const ed = greens.map((m) => eAtN(dn.track, m.n));
  check("18. LEAVING (the numbers falling): the green buoys are the ones passed close to starboard, the reds left to port",
        ed.every((e, i) => e != null && Math.abs(e - (greens[i].e + PASS)) < 1.5) && greens.every((m) => offOf(dn.track, m) > 0)
          && reds.every((m) => offOf(dn.track, m) < 0) && dn.how.marks.kept === 5 && dn.how.marks.stbd === 2 && dn.how.marks.port === 3,
        "e abeam of the greens = " + ed.map(f1).join(",") + " (want " + greens.map((m) => m.e + PASS).join(",") + "); " + JSON.stringify(dn.how.marks));
  check("18b. every leg of both is clear, and neither turns sharper than 45 degrees",
        legsClear(up, M1) && legsClear(dn, M1) && sharpest(up.track) < 45 && sharpest(dn.track) < 45,
        "sharpest turn " + f1(sharpest(up.track)) + " / " + f1(sharpest(dn.track)) + " degrees");
}

// ── 19-20. a mark on the wrong hand ──────────────────────────────────────────────────────────────────────────
{
  // Charlie Shoal's red buoy to PORT of the routed path: the search cut inside it.
  const marks = SINGLES.map((m) => (m.num === 4 ? mark(-100, 1500, RED, 4, "charlie shoal") : m));
  const w = model({ marks }), r = lane(w, UP);
  const e4 = eAtN(r.track, 1500);
  check("19. A RED BUOY ON THE WRONG HAND (100 m to port, returning): the route crosses to leave it to starboard, close",
        e4 != null && Math.abs(e4 - (-100 - PASS)) < 1.5 && offOf(r.track, marks[2]) > 0 && r.how.marks.wrong === 0
          && r.how.marks.kept === 5,
        "e@1500 = " + f1(e4) + " (want " + (-100 - PASS) + "; the routed path was at 0, with the buoy on its port hand)");
  // Bravo Ledge's green buoy to STARBOARD of the routed path.
  // (the reds are BEACONS here, which she is never brought to - see 21 - so the routed path stays at e = 0 and the
  // green's own berth is what is measured. With red buoys either side she is 150 m east of it before she gets there.)
  const marks2 = SINGLES.map((m) => (m.num === 3 ? mark(60, 1000, GREEN, 3, "bravo ledge")
                                                 : (m.side === RED ? mark(m.e, m.n, m.side, m.num, m.sys, true) : m)));
  const r2 = lane(model({ marks: marks2 }), UP);
  const e3 = eAtN(r2.track, 1000), berth = R.MARK_PORT_BERTH * PASS;
  check("20. A GREEN BUOY ON THE WRONG HAND (60 m to starboard): she crosses to leave it to port, at the wider berth",
        e3 != null && Math.abs(e3 - (60 + berth)) < 2 && offOf(r2.track, marks2[1]) < 0 && r2.how.marks.wrong === 0,
        "e@1000 = " + f1(e3) + " (want " + (60 + berth) + ": " + R.MARK_PORT_BERTH + " pass distances off a mark left to port)");
}

// ── 21. a beacon ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const fixedAll = SINGLES.map((m) => (m.side === RED ? mark(m.e, m.n, m.side, m.num, m.sys, true) : m));
  const r = lane(model({ marks: fixedAll }), UP);
  const es = fixedAll.filter((m) => m.fixed).map((m) => eAtN(r.track, m.n));
  check("21. A BEACON stands on what it marks: she is NOT brought close to a red light or daybeacon, only kept on the "
        + "proper hand of it",
        es.every((e) => e != null && Math.abs(e) < 1.5) && r.how.marks.kept === 5 && r.how.marks.wrong === 0,
        "e abeam of the red beacons = " + es.map(f1).join(",") + " (want 0, the routed path); " + JSON.stringify(r.how.marks));
  const wrong = SINGLES.map((m) => (m.num === 4 ? mark(-40, 1500, RED, 4, "charlie shoal", true) : m));
  const r2 = lane(model({ marks: wrong }), UP), e4 = eAtN(r2.track, 1500);
  check("21b. ... and one on the WRONG hand is still left to starboard",
        e4 != null && e4 < -40 - PASS + 1.5 && offOf(r2.track, wrong[2]) > 0, "e@1500 = " + f1(e4) + " (the beacon is at -40)");
}

// ── 22-23. marks that say nothing about the direction ────────────────────────────────────────────────────────
{
  const lone = lane(model({ marks: [mark(120, 1500, RED, 4, "charlie shoal")] }), UP);
  const e = eAtN(lone.track, 1500);
  check("22. A LONE MARK says nothing about which way the buoyage runs: nothing moves, nothing is claimed, and the "
        + "plan's own list says why",
        e != null && Math.abs(e) < 0.5 && lone.lane === false && lone.how.marks.kept === 0
          && lone.marks.length === 1 && /direction of buoyage not known/.test(lone.marks[0].skip),
        "e@1500 = " + f1(e) + "; lane " + lone.lane + "; " + (lone.marks[0] && lone.marks[0].skip));
  const bare = lane(model({ marks: SINGLES.map((m) => mark(m.e, m.n, m.side, null, m.sys)) }), UP);
  const eb = SINGLES.map((m) => eAtN(bare.track, m.n));
  check("23. MARKS WITH NO NUMBERS (a name like 2KR): the same - left alone",
        eb.every((x) => x != null && Math.abs(x) < 0.5) && bare.lane === false,
        "e = " + eb.map(f1).join(",") + "; lane " + bare.lane);
}

// ── 24. a channel that turns away ────────────────────────────────────────────────────────────────────────────
// Greens 3, 5 and 7 of one water. The route runs north past 5, which stands 200 m to STARBOARD of it - the wrong
// hand, if that water is hers. Where 7 lies east (the channel turns away past 5) she is leaving that water and is not
// sent across it. Where 7 lies on north, the channel is the one she is in, and she crosses to leave 5 to port.
{
  const base = [mark(120, 500, RED, 2, "alpha rock"), mark(-150, 1000, GREEN, 3, "bravo ledge"),
                mark(200, 2000, GREEN, 5, "delta point")];
  const away = lane(model({ marks: [...base, mark(900, 2100, GREEN, 7, "foxtrot bar")] }), UP);
  const on = lane(model({ marks: [...base, mark(260, 3000, GREEN, 7, "foxtrot bar")] }), UP);
  const ea = eAtN(away.track, 2000), eo = eAtN(on.track, 2000);
  const k = away.marks.find((x) => x.m.num === 5);
  check("24. A CHANNEL THAT TURNS AWAY past the mark is one she is LEAVING: its mark is left alone (the control: the "
        + "channel runs on, and she crosses to its proper side)",
        ea != null && Math.abs(ea) < 1 && k && /goes on without her/.test(k.skip || "")
          && eo != null && eo > 200 + PASS - 1.5 && on.how.marks.wrong === 0,
        "turns away: e@2000 = " + f1(ea) + " (want 0), \"" + (k && k.skip) + "\"; runs on: e@2000 = " + f1(eo)
          + " (want > " + (200 + PASS) + ", east of the green at 200)");
}

// ── 25. a route that begins beside a mark ────────────────────────────────────────────────────────────────────
{
  const r = lane(M1, [{ e: 0, n: 380 }, { e: 0, n: 4500 }]);            // she starts 120 m short of Alpha Rock's buoy
  const k = r.marks.find((x) => x.m.num === 2), e2 = eAtN(r.track, 500);
  check("25. A ROUTE THAT BEGINS BESIDE A MARK is not passing it: her berth is what lies off the line of marks, and she "
        + "is not sent out to it at a steeper angle than any other lane eases",
        k && /too near the start or the end/.test(k.skip || "") && e2 != null && e2 < 60,
        "\"" + (k && k.skip) + "\"; e@500 = " + f1(e2) + " (the buoy is at 120; reaching " + (120 - PASS) + " m off the path "
          + "in 120 m of route is three times LANE_SLEW)");
  // 25b. ... nor COUNTED at the route's own start: her berth is what lies inside the line of marks. (At a waypoint
  // between two legs of a drawn transit it is counted - 60 - and here, counted, Cod Rock 5, 216 m off the start of his
  // Go-To, was "1 mark NOT left on the proper hand".)
  const mk = r.how.marks;
  check("25b. ... nor counted at the route's own start (it is counted at a transit's waypoint: 60)",
        k && k.nearStart === true && mk.kept === 4 && mk.wrong === 0, JSON.stringify(mk) + " (red 2 not among them)");
}
// 25d. ... but only BESIDE her start: a red she could not be eased out to (266 m off her route) but 900 m on from her start
// is not her berth's - it is counted, and said. (Excused as her berth's, it was left on her wrong hand, unsaid.)
{
  const ms = [];
  for (let q = 0; q < 6; q++) ms.push(mark(-80, 600 * q, GREEN, 2 * q + 1, "rock " + (2 * q + 1)), mark(80, 600 * q, RED, 2 * q + 2, "rock " + (2 * q + 2)));
  const w = model({ marks: ms, points: ms.map((m) => ({ e: m.e, n: m.n, r: 0, kind: "a channel buoy" })) });
  const r = lane(w, [{ e: 800, n: -600 }, { e: 0, n: 600 }, { e: 0, n: 3600 }]);
  const r2 = ms[1], k = r.marks.find((q) => q.m === r2), x = offOf(r.track, r2);
  check("25d. ... but only BESIDE her start: a red too far off her route to be eased out to, 900 m on from her start, is counted",
        k && /too near the start/.test(k.skip || "") && (x > 0 || r.how.marks.wrong >= 1),
        "red 2 " + f1(x) + " m, \"" + (k && (k.skip || "governed")) + "\"; " + JSON.stringify(r.how.marks));
}
// 25c. "PASSED CLOSE" IS SAID OF THE BUOYS THAT WERE: a pier inside red 4 leaves no clear water at its pass distance, and
// she passes it as close as the water allows - kept to starboard, and NOT among the buoys passed close. (The Intent card
// said "passed close" of every buoy kept to starboard, and then of each one passed within the offset the stage found.)
{
  const w = model({ marks: SINGLES, polys: [land(rect(172, 1440, 197, 1560), "a dock / pier")] });
  const r = lane(w, UP), mk = r.how.marks, x4 = offOf(r.track, SINGLES[2]);
  check("25c. \"PASSED CLOSE\" IS SAID OF THE BUOYS THAT WERE: red 4, with a pier inside it, is kept to starboard but "
        + "not counted close",
        mk.kept === 5 && mk.wrong === 0 && mk.buoys === 3 && mk.close === 2 && x4 > R.MARK_PASS_M(BUF, 0) + 5 && legsClear(r, w),
        JSON.stringify(mk) + "; red 4 passed " + f1(x4) + " m off (MARK_PASS_M " + R.MARK_PASS_M(BUF, 0) + ")");
}

// ── 26. the pass distance ────────────────────────────────────────────────────────────────────────────────────
{
  check("26. MARK_PASS_M: 10 m; twice the buffer where that is more; and outside the guard's standoff in a set",
        R.MARK_PASS_M(3, 0) === 10 && R.MARK_PASS_M(8, 0) === 16 && R.MARK_PASS_M(3, 19.5) === 21.5
          && R.MARK_PASS_M(3, 3) === 10 && R.MARK_PASS_M(0, 0) === 10,
        "buf 3: " + R.MARK_PASS_M(3, 0) + "; buf 8: " + R.MARK_PASS_M(8, 0) + "; buf 3 in a 19.5 m standoff: " + R.MARK_PASS_M(3, 19.5));
  const set = lane(M1, UP, { standoffM: 19.5 });
  const reds = SINGLES.filter((m) => m.side === RED), d = reds.map((m) => offOf(set.track, m));
  check("26b. ... and in that set every red buoy is passed outside the standoff, still on her starboard hand",
        d.every((x) => x >= 19.5 + 1 && x <= 21.5 + 1.5), "the reds lie " + d.map(f1).join(",") + " m to starboard (want 21.5)");
  const big = lane(M1, UP, {}, 8), d8 = reds.map((m) => offOf(big.track, m));
  check("26c. at an 8 m buffer they are passed 16 m off", d8.every((x) => Math.abs(x - 16) < 1.5), "the reds lie " + d8.map(f1).join(","));
}

// ── 27. marks in a charted channel are the chart's ───────────────────────────────────────────────────────────
{
  const inCh = [mark(90, 500, RED, 2, "alpha rock"), mark(-95, 1000, GREEN, 3, "bravo ledge"), mark(95, 1500, RED, 4, "charlie shoal"),
                mark(-90, 2000, GREEN, 5, "delta point"), mark(92, 2500, RED, 6, "echo reef")];
  const r = lane(model({ marks: inCh, chans: [chan(RING, true)] }), NB);
  const es = [1000, 1500, 2000].map((n) => eAtN(r.track, n));
  check("27. MARKS ALONG A CHARTED CHANNEL are not this stage's: she stays on the chart's line, " + PASS + " m off none of them",
        es.every((e) => Math.abs(e - 50) < 3) && r.how.marks.kept === 0 && r.marks.every((k) => /charted channel/.test(k.skip || "")),
        "e = " + es.map(f1).join(",") + " (want 50; " + (95 - PASS) + " would be the buoy's pass); " + r.marks.map((k) => k.skip).join(" | "));
}

// ── 28. land between ─────────────────────────────────────────────────────────────────────────────────────────
{
  const spit = land(rect(60, 1300, 90, 1700));                             // a spit between the route and Charlie Shoal
  const r = lane(model({ polys: [spit], marks: SINGLES }), UP);
  const k = r.marks.find((x) => x.m.num === 4), e4 = eAtN(r.track, 1500);
  check("28. LAND BETWEEN her and a mark puts it on other water: left alone",
        k && /land between/.test(k.skip || "") && e4 != null && e4 < 60 - BUF, "\"" + (k && k.skip) + "\"; e@1500 = " + f1(e4));
}

// ── 29. each mark is read from its own hand along her route ──────────────────────────────────────────────────
// Reds 8, 10 and 12 run north along e = 100; a second water's greens, numbered 20 down to 14 going north, stand
// along e = -400. (2026-10-04, v3: each mark is read from the marks of its OWN HAND before and after it along her
// route - the first cut voted every number in a window, read the greens against red 10, and left 10 alone.) The
// reds rise north (returning: to starboard); the greens fall north (leaving: also to starboard). Both hold, and
// nothing is on its wrong hand.
{
  const marks = [mark(100, 0, RED, 8, "golf"), mark(100, 1000, RED, 10, "hotel"), mark(100, 2000, RED, 12, "india"),
                 mark(-400, 300, GREEN, 20, "x1"), mark(-400, 600, GREEN, 18, "x2"), mark(-400, 1400, GREEN, 16, "x3"),
                 mark(-400, 1700, GREEN, 14, "x4")];
  const r = lane(model({ marks }), UP);
  const k = r.marks.find((x) => x.m.num === 10), o10 = offOf(r.track, marks[1]);
  check("29. EACH MARK IS READ FROM ITS OWN HAND ALONG HER ROUTE: red 10 between reds 8 and 12 is kept to starboard, "
        + "and the other water's greens do not overrule it",
        k && !k.skip && k.keepStbd === true && o10 > 0 && r.how.marks.wrong === 0,
        "\"" + (k && (k.skip || "governed, keepStbd " + k.keepStbd)) + "\"; red 10 lies " + f1(o10) + " m to starboard; "
          + JSON.stringify(r.how.marks));
  // 29b. ... and where the marks of its hand either side of it say opposite things, it is left alone.
  const odd = [mark(100, 0, RED, 8, "golf"), mark(100, 1000, RED, 10, "hotel"), mark(100, 2000, RED, 8, "kilo")];
  const r2 = lane(model({ marks: odd }), UP);
  const k2 = r2.marks.find((x) => x.m.num === 10), e10 = eAtN(r2.track, 1000);
  check("29b. THE TWO READINGS MUST AGREE: red 8 behind it says returning, red 8 ahead says leaving - red 10 is left "
        + "alone and she is not brought to it",
        k2 && /disagree/.test(k2.skip || "") && e10 != null && Math.abs(e10 - (100 - PASS)) > 50,
        "\"" + (k2 && k2.skip) + "\"; e@1000 = " + f1(e10) + " (" + PASS + " m off buoy 10 would be " + (100 - PASS) + ")");
}

// ── 30-31. THE PISCATAQUA, AS CHARTED ────────────────────────────────────────────────────────────────────────
// The marks' own charted positions (meters, origin by the Turning Basin) and the path the search found on Andy's
// Go-To of 2026-10-03, through the real buildKeepouts. Open water here: the keep-outs are not what this is about.
// What flew that night left Piscataqua River 12 and 13 unvisited to the north, and ran down the WEST side of
// Little Bay with The Rocks 4 and Little Bay 4A on its PORT hand.
{
  const pt = (cls, e, n, CATLAM, OBJNAM) => { const q = ll(e, n);
    return { role: "chan_mark", cls, props: { CATLAM, OBJNAM }, geometry: { type: "Point", coordinates: [q.lon, q.lat] } }; };
  const B = "Buoy_Lateral_point";
  const feats = [
    pt(B, 500, -840, 1, "Piscataqua River Lighted Buoy 11"), pt(B, 242, -298, 2, "Piscataqua River Buoy 12"),
    pt(B, 58, -320, 1, "Piscataqua River Buoy 13"), pt(B, -954, -56, 1, "Piscataqua River Buoy 15"),
    pt(B, -838, 71, 2, "Piscataqua River Buoy 16"), pt(B, -1116, 429, 1, "Piscataqua River Buoy 17"),
    pt(B, -3387, -9, 1, "Hen Island Ledge Buoy 1"), pt(B, -3985, -6, 2, "Eight-Foot Rock Buoy 2"),
    pt(B, -4103, -183, 1, "Fox Point Rock Buoy 3"), pt(B, -3819, -712, 2, "The Rocks Buoy 4"),
    pt(B, -3653, -1376, 2, "Little Bay Buoy 4A"), pt(B, -4376, -4229, 2, "Great Bay Entrance Buoy 6"),
    // the Turning Basin, as the chart draws it: buoy 11 is in it, 12 and 13 stand just beyond its upper end
    { role: "fairway", cls: "Fairway_area", props: {}, geometry: { type: "Polygon", coordinates: [[
      [430, -1500], [1300, -1500], [1300, -640], [300, -430], [430, -1500]].map(([e, n]) => { const q = ll(e, n); return [q.lon, q.lat]; })] } },
  ];
  const ko = K.buildKeepouts(F, feats, {});
  const PATH = [[2497, -2653], [776, -1019], [231, -574], [145, -546], [-500, -417], [-1231, -488], [-3339, 42],
                [-3397, 42], [-3913, -159], [-3970, -689], [-4013, -3399]].map(([e, n]) => ({ e, n }));
  const by = (num, sysRe) => ko.marks.find((m) => m.num === num && sysRe.test(m.sys));
  const m12 = by(12, /piscataqua/), m13 = by(13, /piscataqua/), m15 = by(15, /piscataqua/), m1 = by(1, /hen/),
        m2 = by(2, /eight/), m3 = by(3, /fox/), m4 = by(4, /rocks/), m4a = by(4, /little bay/);
  const inb = lane(ko, PATH), o = (m) => offOf(inb.track, m);
  const pre = PATH, oPre = (m) => offOf(pre, m);
  check("30. THE PISCATAQUA, RETURNING: through the 12/13 gate with red 12 close to starboard; south of Eight-Foot Rock "
        + "2, round Fox Point Rock 3 leaving it to port, and EAST of The Rocks 4 and Little Bay 4A, each close to starboard",
        // (Eight-Foot Rock 2 to starboard, not close: Fox Point Rock 3, 210 m on round the bend, is on its wrong hand
        // on the search's path and is placed first, and 2's close pass then has no join under MARK_JOIN_MAX_DEG.)
        Math.abs(o(m12) - PASS) < 2 && o(m13) < -PASS && o(m1) < 0 && o(m2) > PASS - 0.5 && o(m3) < -PASS
          && Math.abs(o(m4) - PASS) < 2 && Math.abs(o(m4a) - PASS) < 2 && inb.how.marks.wrong === 0
          && oPre(m4) < -100 && oPre(m4a) < -250 && oPre(m13) > 150,
        "12: " + f1(o(m12)) + ", 13: " + f1(o(m13)) + ", 1: " + f1(o(m1)) + ", 2: " + f1(o(m2)) + ", 3: " + f1(o(m3)) + ", 4: "
          + f1(o(m4)) + ", 4A: " + f1(o(m4a)) + " m (+ = to starboard). The search's own path had 4 at " + f1(oPre(m4))
          + ", 4A at " + f1(oPre(m4a)) + " and 13 at " + f1(oPre(m13)));
  const k15 = inb.marks.find((k) => k.m === m15);
  check("30b. ... and Piscataqua River Buoy 15, which leads north to Dover, is left alone: a route bound west into "
        + "Little Bay passes it 400 m off and is not sent up to it",
        k15 && /goes on without her/.test(k15.skip || "") && Math.abs(o(m15) - oPre(m15)) < 40,
        "\"" + (k15 && k15.skip) + "\"; it lies " + f1(o(m15)) + " m off (the search's path: " + f1(oPre(m15)) + ")");
  check("30c. every leg clear; seven marks kept (11 is in the charted basin, 15 is the Dover branch's, and 16, 17 and "
        + "Great Bay Entrance 6 are out of reach), none wrong; no turn over 70 degrees",
        legsClear(inb, ko) && inb.how.marks.kept === 7 && inb.how.marks.stbd === 4 && inb.how.marks.port === 3
          && inb.how.marks.wrong === 0 && sharpest(inb.track) < 70,
        JSON.stringify(inb.how.marks) + "; sharpest turn " + f1(sharpest(inb.track)) + " degrees");
  const outb = lane(ko, PATH.slice().reverse()), q = (m) => offOf(outb.track, m);
  check("31. THE SAME WATER, LEAVING: the greens close to starboard (13, Fox Point Rock 3, Hen Island Ledge 1), the "
        + "reds to port - still east of The Rocks and 4A, where the channel is",
        // (Hen Island Ledge 1 within the marks stage's own "close": PASS - 0.5 .. PASS + 5 - the search's path
        // already passes it 13.6 m off, and she is not moved for 3.6 m)
        Math.abs(q(m13) - PASS) < 2 && Math.abs(q(m3) - PASS) < 2 && q(m1) >= PASS - 0.5 && q(m1) <= PASS + 5 && q(m12) < -PASS
          && q(m2) < -PASS && q(m4) < -PASS + 0.5 && q(m4a) < -PASS + 0.5 && outb.how.marks.wrong === 0,
        "13: " + f1(q(m13)) + ", 3: " + f1(q(m3)) + ", 1: " + f1(q(m1)) + ", 12: " + f1(q(m12)) + ", 2: " + f1(q(m2)) + ", 4: "
          + f1(q(m4)) + ", 4A: " + f1(q(m4a)) + " m (+ = to starboard)");
  // 31c. Leaving, she JOINS the Piscataqua's count below 15 (out of Little Bay at Dover Point): the mark numbered
  // before it in her direction is off her route and off her heading, so 15 is not hers. (It was sent to starboard
  // close: a 480 m detour up the Dover branch.)
  const q15 = outb.marks.find((k) => k.m === m15);
  check("31c. ... and leaving, Buoy 15 is one whose channel she joins beyond it: left alone, where the search left it",
        q15 && /joins its channel beyond it/.test(q15.skip || "") && Math.abs(q(m15) - offOf(PATH.slice().reverse(), m15)) < 40,
        "\"" + (q15 && q15.skip) + "\"; it lies " + f1(q(m15)) + " m off");
}

// ── 31b. two marks that cannot both be kept ──────────────────────────────────────────────────────────────────
// Charlie Shoal's red buoy and a green one, abeam of each other and the wrong way round for a vessel returning: the
// red 120 m WEST of the green. Leaving the red to starboard puts her west of both; leaving the green to port puts her
// east of both. Whatever she does one of them is on its wrong hand, and the plan has to say which thing went wrong:
// a mark, not a stretch that was "not laned".
{
  const marks = [mark(120, 500, RED, 2, "alpha rock"), mark(-60, 1500, RED, 4, "charlie shoal"),
                 mark(60, 1500, GREEN, 5, "delta point"), mark(150, 2500, RED, 6, "echo reef")];
  const r = lane(model({ marks }), UP);
  const P = require("../static/js/passage.js");
  const note = P.buoyageNote(r.lane, r.partial, r.how);
  check("31b. TWO MARKS THAT CANNOT BOTH BE KEPT (a red west of a green, returning): one is counted WRONG, the route is "
        + "`partial`, and the banner says a mark is not on its proper hand - not that a stretch is \"not laned\"",
        r.how.marks.wrong === 1 && r.how.marks.kept === 3 && r.partial === true && r.lane === true && r.how.gaps === false
          && /1 mark NOT left on the proper hand/.test(note) && !/PARTIAL/.test(note) && legsClear(r, model({ marks })),
        JSON.stringify(r.how.marks) + " partial " + r.partial + " gaps " + r.how.gaps + "; \"" + note + "\"");
}

// ── 32-33. the count is of the route that ships; the way round a contact ─────────────────────────────────────
{
  const up = lane(M1, UP);
  const straight = [ll(0, -1500), ll(0, 4500)];                           // the route the marks were NOT shaped into
  const here = R.marksKept([ll(0, -1500), ...up.route], F, up.marks), there = R.marksKept(straight, F, up.marks);
  // a route that runs up the far side of the reds: every one of them on her port hand
  const wrongSide = R.marksKept([ll(400, -1500), ll(400, 4500)], F, up.marks);
  check("32. marksKept counts the route it is GIVEN: all five on the shaped route and on the straight one (the reds were "
        + "to starboard of it already), three WRONG on a route up the far side of the reds",
        here.kept === 5 && here.wrong === 0 && there.kept === 5 && wrongSide.wrong === 3 && wrongSide.kept === 2
          && wrongSide.stbd === 0 && wrongSide.port === 2,
        "shaped " + JSON.stringify(here) + "; straight " + JSON.stringify(there) + "; far side " + JSON.stringify(wrongSide));
  const off = lane(M1, UP, { marks: false });
  const es = SINGLES.map((m) => eAtN(off.track, m.n));
  check("33. `marks:false` (a way round a contact, or back onto a line): not shaped to the buoys, and nothing claimed",
        es.every((e) => e != null && Math.abs(e) < 0.5) && off.lane === false && off.marks.length === 0 && off.how.marks.kept === 0,
        "e = " + es.map(f1).join(",") + "; lane " + off.lane);
  // 33b. `charted:false` with it: THE PIPELINE AS IT WAS. In check 13's water (buoy pairs 300 m apart round the 200 m
  // charted channel) the pair lane captures in charted water again and rides the BUOYS' line; and in check 3's
  // (the polygon alone) nothing moves at all.
  const ns = [400, 900, 1400, 1900, 2400];
  const marks = [...ns.map((n, i) => mark(-150, n, GREEN, 2 * i + 1, "ch")), ...ns.map((n, i) => mark(150, n, RED, 2 * i + 2, "ch"))];
  const old = lane(model({ marks, chans: [chan(RING, true)] }), NB, { marks: false, charted: false });
  const eo = [1000, 1500, 2000].map((n) => eAtN(old.track, n));
  const bare = lane(C1, NB, { marks: false, charted: false });
  const eb = [1000, 1500, 2000].map((n) => eAtN(bare.track, n));
  check("33b. `charted:false` too (a MANEUVER): the pipeline as it was - the pair lane rides the buoys' line in charted "
        + "water, and a charted polygon with no banks and no buoys moves nothing",
        eo.every((e) => Math.abs(e - 75) < 4) && old.how.pairs === true && old.how.charted === false
          && eb.every((e) => Math.abs(e + 80) < 1) && bare.lane === false,
        "with buoys: e = " + eo.map(f1).join(",") + " (want 75, the buoys' quarter; the chart's is 50); polygon alone: e = "
          + eb.map(f1).join(",") + " (want -80)");
}

// ── 34-36. passage.js: `how` travels with the plan ───────────────────────────────────────────────────────────
{
  const { nogo } = require("../static/js/state.js");
  const P = require("../static/js/passage.js");
  const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer };
  let go = null, fly = null, set = null, plan = null, man = null, goC = null, manC = null, flyC = null;
  try {
    nogo.ready = true; nogo.frame = F; nogo.buffer = BUF; nogo.ko = M1;
    go = P.planNogoRoute(ll(0, -1500), ll(0, 4500), {});
    fly = P.planNogoRoute(ll(0, -1500), ll(0, 4500), { flyThrough: true });
    man = P.planNogoRoute(ll(0, -1500), ll(0, 4500), { maneuver: true });
    nogo.ko = C1;                                                    // the charted channel, and nothing else
    goC = P.planNogoRoute(ll(-80, -400), ll(-80, 3400), {});
    manC = P.planNogoRoute(ll(-80, -400), ll(-80, 3400), { maneuver: true });
    flyC = P.planNogoRoute(ll(-80, -400), ll(-80, 3400), { flyThrough: true });
    nogo.ko = M1;
    set = P.planNogoRoute(ll(0, -1500), ll(0, 4500), { standoffM: 19.5 });
    plan = P.routePlan(ll(0, -1500), [ll(0, 1250), ll(0, 4500)], true, 0);   // a transit of two legs
  } finally { Object.assign(nogo, saved); }
  const tr = (p, from) => [from, ...p.route].map((q) => F.toEN(q));
  const reds = SINGLES.filter((m) => m.side === RED);
  check("34. planNogoRoute (Go-To, RTH) carries `how` and the marks; a fly-through target (the way round a contact) is "
        + "not shaped to the buoys",
        go.lane === true && go.how && go.how.marks.kept === 5 && go.marks.length === 5
          && reds.every((m) => Math.abs(offOf(tr(go, ll(0, -1500)), m) - PASS) < 1.5)
          && fly.how.marks.kept === 0 && reds.every((m) => Math.abs(eAtN(tr(fly, ll(0, -1500)), m.n)) < 0.5),
        "Go-To: " + JSON.stringify(go.how.marks) + ", reds " + reds.map((m) => f1(offOf(tr(go, ll(0, -1500)), m))).join(",")
          + " m to starboard; fly-through: e = " + reds.map((m) => f1(eAtN(tr(fly, ll(0, -1500)), m.n))).join(","));
  const at1500 = (p) => eAtN(tr(p, ll(-80, -400)), 1500);
  check("34b. A MANEUVER IS LANED AS IT ALWAYS WAS: the way back onto station (`maneuver`) and a fly-through are neither "
        + "shaped to the buoys nor brought to a charted channel's starboard quarter; Go-To is",
        man.how.marks.kept === 0 && reds.every((m) => Math.abs(eAtN(tr(man, ll(0, -1500)), m.n)) < 0.5)
          && Math.abs(at1500(goC) - 50) < 3 && goC.how.charted === true
          && Math.abs(at1500(manC) + 80) < 1 && manC.lane === false && Math.abs(at1500(flyC) + 80) < 1 && flyC.lane === false,
        "in the charted channel at n=1500: Go-To e = " + f1(at1500(goC)) + " (want 50), maneuver " + f1(at1500(manC))
          + ", fly-through " + f1(at1500(flyC)) + " (want -80, the routed path)");
  const ds = reds.map((m) => offOf(tr(set, ll(0, -1500)), m));
  check("35. in a set the route is re-gated at the guard's standoff, and the marks are counted on what comes out of it: "
        + "still five kept, the reds outside the standoff on her starboard hand",
        set.standoffM === 19.5 && set.how.marks.kept === 5 && set.how.marks.wrong === 0 && ds.every((x) => x > 19.5),
        "reds " + ds.map(f1).join(",") + " m to starboard (standoff 19.5); " + JSON.stringify(set.how.marks));
  check("36. routePlan (a drawn transit, the approach, the leg into a later survey) adds `how` up over its legs",
        plan.lane === true && plan.how && plan.how.marks.kept >= 4 && plan.how.marks.wrong === 0 && plan.how.charted === false,
        JSON.stringify(plan.how));
}

// ── 37. the wording ──────────────────────────────────────────────────────────────────────────────────────────
{
  const P = require("../static/js/passage.js");
  const mk = (kept, wrong, stbd, port) => ({ kept, wrong, stbd, port });
  const none = mk(0, 0, 0, 0);
  const got = {
    off: P.buoyageNote(false, false, { charted: true, marks: mk(3, 0, 3, 0) }),
    old: P.buoyageNote(true, false), oldPartial: P.buoyageNote(true, true),
    charted: P.buoyageNote(true, false, { charted: true, pairs: false, narrow: false, marks: none, gaps: false }),
    pairs: P.buoyageNote(true, false, { charted: false, pairs: true, narrow: false, marks: none, gaps: false }),
    marks: P.buoyageNote(true, false, { charted: false, pairs: false, narrow: false, marks: mk(5, 0, 3, 2), gaps: false }),
    one: P.buoyageNote(true, false, { charted: false, pairs: false, narrow: false, marks: mk(1, 0, 1, 0), gaps: false }),
    all: P.buoyageNote(true, true, { charted: true, pairs: false, narrow: true, marks: mk(4, 1, 2, 2), gaps: true }),
    wrongOnly: P.buoyageNote(true, true, { charted: true, pairs: false, narrow: false, marks: mk(2, 1, 2, 0), gaps: false }),
  };
  check("37. buoyageNote: silent without a lane; the old words for a plan that carries no `how`; and each keep-right in "
        + "its own words, a mark on the wrong hand said as that and not as \"not laned\"",
        got.off === "" && got.old === "Rule 9: channel lane, centerline to port"
          && got.oldPartial === "Rule 9: channel lane, centerline to port — PARTIAL: some of this route is not laned"
          && got.charted === "Rule 9: right of center in the charted channel"
          && got.pairs === "Rule 9: channel lane, centerline to port"
          && got.marks === "Rule 9: 3 marks left to starboard, 2 marks left to port"
          && got.one === "Rule 9: 1 mark left to starboard"
          && got.all === "Rule 9: right of center in the charted channel; channel lane, centerline to port; 2 marks left to "
                       + "starboard, 2 marks left to port — 1 mark NOT left on the proper hand — PARTIAL: some of this route is not laned"
          && got.wrongOnly === "Rule 9: right of center in the charted channel; 2 marks left to starboard — 1 mark NOT left on the proper hand",
        JSON.stringify(got));
}

// ── 38. the page ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
  const calls = (H.match(/buoyageNote\(plan\.lane, plan\.partial, plan\.how\)/g) || []).length;
  const bare = (H.match(/buoyageNote\(plan\.lane, plan\.partial\)/g) || []).length;
  const i0 = H.indexOf("function setPlanIntent("), body = H.slice(i0, H.indexOf("\nfunction ", i0 + 10));
  check("38. the page words Go-To's, RTH's and the Transit's banner from `plan.how`, and the Intent card has a row for "
        + "the charted channel, the marks, and a mark on the wrong hand",
        calls === 3 && bare === 0 && /const how = plan\.how/.test(body) && /in the CHARTED channel/.test(body)
          && /riding the Rule 9 marks/.test(body) && /NOT left on the proper hand/.test(body)
          && /riding the Rule 9 channel lane/.test(body) && /PARTIAL/.test(body),
        calls + " banner call(s) with plan.how, " + bare + " without");
}

// ── 39-52. v3 (2026-10-04): what the review and the replays of his Go-To found ───────────────────────────────
const minE = (t, a, b) => { let m = Infinity; for (let n = a; n <= b; n += 5) { const e = eAtN(t, n); if (e != null) m = Math.min(m, e); } return m; };
const pairsAt = (ns, half, sys) => [...ns.map((n, i) => mark(-half, n, GREEN, 2 * i + 1, sys)), ...ns.map((n, i) => mark(half, n, RED, 2 * i + 2, sys))];
// 39. Buoy pairs, then the charted fairway, on one centerline: the pair lane eases back across the fairway to the
// search's path and the chart takes over. Read from a path that jogged 130 m, the fairway's straight edges looked
// like an opening and the stretch was dropped; then the lane was slewed in as a shift from that jogging path.
{
  const w = model({ marks: pairsAt([-2000, -1500, -1000, -500, -100], 100, "ch"), chans: [chan(RING, true)] });
  const r = lane(w, [{ e: -80, n: -2600 }, { e: -80, n: 3400 }]);
  // (held, not just kept to starboard: within 10 m of the line through the junction - without the cone measured
  // across the search's path it swung 41-66 m there)
  const dev = (t, line) => { let m = 0; for (let n = -400; n <= 400; n += 5) { const e = eAtN(t, n); if (e != null) m = Math.max(m, Math.abs(e - line)); } return m; };
  const lo = minE(r.track, -1700, 2600), near = dev(r.track, 50);
  check("39. PAIRS HAND OVER TO THE CHART: she holds +50 through the junction, never to port of the shared centerline",
        lo >= 0 && near <= 10 && legsClear(r, w),
        "least e n=-1700..2600 " + f1(lo) + "; within 400 m of the junction at most " + f1(near) + " m off the +50 line (want <= 10)");
  // 39b. ... and the chart handing over to the pairs, southbound: the lane's cone is measured across the SEARCH's
  // path (`lat`) - measured as a shift from a path the pair lane had jogged, a straight lane looked steep and the
  // cone pulled it in.
  const s = lane(w, [{ e: 80, n: 3400 }, { e: 80, n: -2600 }]);
  const hi = -minE(s.track.map((p) => ({ e: -p.e, n: p.n })), -1700, 2600);
  const nearS = dev(s.track, -50);
  check("39b. ... THE CHART HANDS OVER TO THE PAIRS, southbound: -50 held through it, never to port (east) of the centerline",
        hi <= 0 && nearS <= 10 && legsClear(s, w),
        "most easterly e n=-1700..2600 " + f1(hi) + "; within 400 m of the junction at most " + f1(nearS) + " m off the -50 line (want <= 10)");
}
// 40. In the channel, then out through its side 120 m short of its end, 160 m from her lane: the channel ends ahead
// of the lane within the water she needs to ease back in, so it is an END - held, and eased off past it. Read two
// steps ahead, it was a side: eased back across the channel inside it (outbound past Badgers Island, 400 m).
{
  // a channel 400 m wide (e = -100..300): her lane at +200, 310 m to starboard of the path
  const w = model({ chans: [chan(rect(-100, 0, 300, 2000), true)] });
  const r = lane(w, [{ e: -80, n: -400 }, { e: -80, n: 1400 }, { e: -110, n: 1600 }, { e: -110, n: 1800 }, { e: -600, n: 2200 }]);
  const es = [1500, 1600, 1700].map((n) => eAtN(r.track, n));
  check("40. AN END AHEAD OF THE LANE: the line held toward the channel's end, not eased back across it inside",
        es.every((e) => e != null && e > 150),
        "e@1500,1600,1700 = " + es.map(f1).join(",") + " (want > 150; the lane is +200, and eased inside it is -27 at 1700)");
}
// 41. The search's path steps 120 m into a dredged patch beside the fairway and back. The patch is not the
// channel (the fairway before a dredged area beside it), and each cross-section is square to her COURSE, not to
// the 100 m leg: measured on both rings it read 400 m wide, and square to the leg its quarter line folded back.
{
  const w = model({ chans: [{ ...chan(RING, true), src: "fairway" }, { ...chan(rect(-300, 1300, -100, 1700), true), src: "dredged" }] });
  const r = lane(w, [{ e: -80, n: -400 }, { e: -80, n: 1250 }, { e: -200, n: 1350 }, { e: -200, n: 1650 },
                     { e: -80, n: 1750 }, { e: -80, n: 3400 }]);
  const at = [1400, 1500, 1600].map((n) => eAtN(r.track, n)), lo = minE(r.track, 300, 2700);
  check("41. A DREDGED PATCH BESIDE THE FAIRWAY: the fairway's line through it, never to port of the fairway's middle",
        lo >= 0 && at[1] != null && Math.abs(at[1] - 50) < 15 && legsClear(r, w),
        "e@1400,1500,1600 = " + at.map(f1).join(",") + " (want ~+50); least e n=300..2700 " + f1(lo));
}
// 42. Two greens of one name stand across her route, 92 m apart across it and 34 m along (Pierce Island 3 and 5,
// up the Piscataqua): that channel crosses hers, and its marks are not hers. (The control: the same two along it.)
{
  const others = [mark(120, 500, RED, 2, "alpha rock"), mark(150, 2500, RED, 6, "echo reef")];
  const across = lane(model({ marks: [mark(-40, 1000, GREEN, 3, "pierce"), mark(-130, 1034, GREEN, 5, "pierce"), ...others] }), UP);
  const along = lane(model({ marks: [mark(-40, 1000, GREEN, 3, "pierce"), mark(-40, 1500, GREEN, 5, "pierce"), ...others] }), UP);
  const ka = across.marks.filter((k) => k.m.sys === "pierce"), kb = along.marks.filter((k) => k.m.sys === "pierce");
  check("42. A CHANNEL OF ITS OWN NAME ACROSS HER ROUTE: its marks are left alone (the control: along it, they are hers)",
        ka.length === 2 && ka.every((k) => /crosses her route/.test(k.skip || "")) && Math.abs(eAtN(across.track, 1000)) < 1
          && kb.length === 2 && kb.every((k) => !k.skip && k.keepStbd === false),
        "across: " + ka.map((k) => k.skip).join(" | ") + "; along: " + kb.map((k) => k.skip || "governed, to port").join(" | "));
}
// 43. A pair lane that ends before its last green, and a route that turns away short of it: the green is on her
// wrong hand, and it is not "ridden as a pair" - it is governed, and where it cannot be kept it is COUNTED.
// (Up the Piscataqua she cut into Little Bay south of Buoy 13, 204 m on the wrong hand, and nothing was said.)
{
  const marks = [...pairsAt([0, 400, 800, 1200, 1600], 100, "river"), mark(-100, 2000, GREEN, 11, "river")];
  const r = lane(model({ marks }), [{ e: 0, n: -600 }, { e: 0, n: 1900 }, { e: -1200, n: 2300 }]);
  const k = r.marks.find((q) => q.m.num === 11), o = offOf(r.track, marks[marks.length - 1]);
  check("43. A PAIR'S MARK LEFT ON ITS WRONG HAND is governed: kept to port, or counted wrong and said",
        k && !k.skip && k.keepStbd === false && (o < 0 || (r.how.marks.wrong >= 1 && r.partial === true)),
        "\"" + (k && (k.skip || "governed")) + "\"; green 11 lies " + f1(o) + " m (+ = starboard); " + JSON.stringify(r.how.marks));
}
// 44. A red to keep close, and 210 m on round the bend a green on her WRONG hand: the wrong hand is seen to first.
// (With the set at 1.75 kn, Eight-Foot Rock Buoy 2's close pass was placed first and Fox Point Rock Buoy 3 could no
// longer be joined.)
{
  const marks = [mark(120, 0, RED, 2, "a"), mark(60, 1000, RED, 4, "b"), mark(80, 1210, GREEN, 5, "c"),
                 mark(150, 2400, RED, 6, "d"), mark(-150, 2800, GREEN, 7, "e")];
  const r = lane(model({ marks }), UP);
  check("44. THE WRONG HAND FIRST: the green round the bend is left to port, and the red before it still to starboard",
        offOf(r.track, marks[2]) < 0 && offOf(r.track, marks[1]) > 0 && r.how.marks.wrong === 0,
        "red 4 " + f1(offOf(r.track, marks[1])) + ", green 5 " + f1(offOf(r.track, marks[2])) + " m (+ = starboard); "
          + JSON.stringify(r.how.marks));
}
// 45. A stub beside a sharp vertex the knot prune cannot cut (the corner it would cut is foul): the stub goes.
// Only on the Rule 9 lane's routes (`stubs`); the router's own stitches and a maneuver prune as they always did.
{
  const ko = model({ points: [{ e: 6.5, n: 50, r: 0, kind: "a pile" }] });
  const pts = [[0, 100], [0, 0], [13, 0], [40, -35], [80, -90]].map(([e, n]) => ll(e, n));
  const a = R.pruneStitch(pts, F, ko, BUF, { stubs: true }), b = R.pruneStitch(pts, F, ko, BUF, {});
  const en = (r) => r.map((p) => F.toEN(p));
  check("45. A STUB BESIDE A SHARP TURN: with `stubs` the 13 m stub goes and the turn is under 60 degrees; without, as before",
        a.length === 4 && sharpest(en(a)) < 60 && b.length === 5 && sharpest(en(b)) > 85
          && a.every((p, i) => i === 0 || K.legClear(a[i - 1], p, F, ko, BUF)),
        a.length + " points, sharpest " + f1(sharpest(en(a))) + "; without: " + b.length + " points, sharpest " + f1(sharpest(en(b))));
}
// 46. A path 10 m outside the channel that never enters it, turning away near its end: not laned. (A sample read
// as an opening was carried as "inside", and a path beside the fairway was laned as if it had entered.)
{
  const w = model({ chans: [chan(rect(-100, 0, 100, 2000), true)] });
  const r = lane(w, [{ e: -110, n: -400 }, { e: -110, n: 1880 }, { e: -500, n: 2300 }]);
  const e = eAtN(r.track, 1000);
  check("46. BESIDE IT, NEVER IN IT: a path 10 m outside a channel that turns away near its end is left where it is",
        e != null && Math.abs(e + 110) < 1 && r.how.charted === false, "e@1000 = " + f1(e) + " (want -110); how.charted " + r.how.charted);
}
// 47. A close pass whose run rejoins her route exactly at a 56 degree bend of it: the join limit is asked AT the
// run's kept vertices; the bend of her own route is the smoothing's to round. (Asked one vertex either side, it
// refused Little Bay Buoy 4A on his Go-To, reversed in the set.)
{
  const marks = [mark(120, -800, RED, 2, "a"), mark(60, 1000, RED, 4, "b"), mark(-150, -300, GREEN, 3, "c")];
  const r = lane(model({ marks }), [{ e: 0, n: -1500 }, { e: 0, n: 1233 }, { e: 400, n: 1503 }, { e: 400, n: 4000 }]);
  const o = offOf(r.track, marks[1]);
  check("47. A RUN THAT REJOINS HER ROUTE AT A BEND OF IT: the red is still passed close",
        Math.abs(o - PASS) < 2 && legsClear(r, model({ marks })), "red 4 lies " + f1(o) + " m to starboard (want " + PASS + "; refused, 60)");
}
// 48. LEFT ALONE IS NOT LEFT TO BE CROSSED: bravo 4, a red she has on her starboard hand, is left alone (its channel
// goes on without her, to bravo 6 in the east) - and green 5 of another water, 300 m on, is on her WRONG hand. Its
// pass takes her east across bravo 4 unless bravo 4's own pass comes with it. (Crossing the mouth of Palmer Cove,
// Derby Channel Buoy 4's pass took her across Palmer Cove Buoy 4, and nothing was said.)
{
  const marks = [mark(40, 400, RED, 2, "bravo"), mark(15, 1000, RED, 4, "bravo"), mark(700, 1300, RED, 6, "bravo"),
                 mark(-200, 400, GREEN, 3, "c"), mark(80, 1300, GREEN, 5, "c"), mark(-200, 2200, GREEN, 7, "c")];
  const r = lane(model({ marks }), UP);
  const k = r.marks.find((q) => q.m === marks[1]), b = offOf(r.track, marks[1]), a = offOf(r.track, marks[4]);
  check("48. A MARK LEFT ALONE ON ITS PROPER HAND STAYS THERE: another's pass brings its pass along (or is refused)",
        k && /goes on without her/.test(k.skip || "") && b > 0 && a < 0 && r.how.marks.wrong === 0,
        "bravo 4 \"" + (k && k.skip) + "\" lies " + f1(b) + " m (want > 0); green 5 " + f1(a) + " m (want < 0); "
          + JSON.stringify(r.how.marks));
}
// 49. A small berth 40 m deep x 60 m long against the starboard edge of a 200 m channel, the two charted alike: it
// is an opening (CHART_OPENING_FRAC of the width), not the channel. Read at a quarter of the width it stood inside
// the tolerance and drew the lane 17 m toward itself.
{
  const w = model({ chans: [chan(RING, true), chan(rect(100, 1300, 140, 1360), true)] });
  const r = lane(w, NB);
  let off = 0;
  for (let n = 1250; n <= 1410; n += 5) { const e = eAtN(r.track, n); if (e != null) off = Math.max(off, Math.abs(e - 50)); }
  check("49. A SMALL BERTH BESIDE THE CHANNEL is an opening: the lane passes it within 10 m of its line",
        off <= 10 && legsClear(r, w), "furthest off the +50 line alongside it " + f1(off) + " m (want <= 10)");
}
// 51. The search's path steps into a small charted patch 15-20 m off the fairway's port side, charted alike. The
// patch is not a channel she proceeds along (shorter than a real stretch, MIN_RUN), and a cross-section carried
// over it is clipped from INSIDE the carried channel, never from the patch she stands in. (Read as along, a 55 x 90 m
// patch was laned 216 m to port of the fairway's middle; clipped from the sample, the 40 x 40 m one put her at -94.)
{
  const r = [[-160, 1450, -120, 1490], [-170, 1430, -115, 1520]].map((pat) => {
    const w = model({ chans: [chan(RING, true), chan(rect(...pat), true)] }), mid = (pat[0] + pat[2]) / 2;
    const t = lane(w, [{ e: -80, n: -400 }, { e: -80, n: pat[1] - 50 }, { e: mid, n: pat[1] + 10 }, { e: mid, n: pat[3] - 10 },
                       { e: -80, n: pat[3] + 50 }, { e: -80, n: 3400 }]);
    return { lo: minE(t.track, 300, 2700), ok: legsClear(t, w) };
  });
  check("51. A SMALL CHARTED PATCH OFF THE FAIRWAY'S SIDE: the fairway's line past it, never to port of its middle",
        r.every((x) => x.lo >= 0 && x.ok), "least e n=300..2700: " + r.map((x) => f1(x.lo)).join(", ") + " (40 x 40 m, 55 x 90 m)");
}
// 52. Greens 1, 3 and 5 of one channel run 33 degrees off her track, and green 3 stands on her WRONG hand. A run past
// it along the channel's course meets her route at more than MARK_JOIN_MAX_DEG; the run along her own track does not,
// and is the second way past it. (With the DriX's 5 m buffer on his Go-To, Gangway Rocks 13 was left on its wrong hand.)
{
  const marks = [mark(-200, 600, GREEN, 1, "g"), mark(60, 1000, GREEN, 3, "g"), mark(320, 1400, GREEN, 5, "g"), mark(-150, -400, RED, 2, "r")];
  const r = lane(model({ marks }), [{ e: 0, n: -1500 }, { e: 0, n: 3500 }]);
  const o = offOf(r.track, marks[1]), k = r.marks.find((q) => q.m.num === 3);
  check("52. TWO WAYS PAST A MARK: the run along her own track where the channel's course will not join",
        Math.abs(o + R.MARK_PORT_BERTH * PASS) < 3 && k && !k.clash && r.how.marks.wrong === 0 && legsClear(r, model({ marks })),
        "green 3 lies " + f1(o) + " m (want " + (-R.MARK_PORT_BERTH * PASS) + "; with one way past it, -141, not placed)");
}

// ── 53-58. the second review (2026-10-04) ────────────────────────────────────────────────────────────────────
const ptsOf = (ms) => ms.map((m) => ({ e: m.e, n: m.n, r: 0, kind: m.fixed ? "a beacon" : "a channel buoy" }));
// 53. A buoyed channel's entrance gate crossed obliquely: the green across from red 2 is its GATE PARTNER (judged in the
// plane), never "the mark before it" - read so, red 2 was one whose channel she "joins beyond it", left 44-136 m on its
// wrong hand and counted nowhere. Singles crossing at 12 degrees, and one channel name at 22.
{
  const gates = (named) => {
    const ms = [];
    for (let i = 0; i < 6; i++) {
      ms.push(mark(-80, 600 * i, GREEN, 2 * i + 1, named ? "harbor channel" : "rock " + (2 * i + 1)));
      ms.push(mark(80, 600 * i, RED, 2 * i + 2, named ? "harbor channel" : "rock " + (2 * i + 2)));
    }
    return ms;
  };
  // (and crossing the gate line 35 and 45 degrees off square, 20 m outside red 2, both ways: judged as "across HER
  // track" - within 30 degrees of square to it - a gate crossed more obliquely still read its partner as the mark
  // before or after, and red 2 was left on its wrong hand, unsaid)
  const oblique = (th, rev) => {
    const t = th * Math.PI / 180, base = [{ e: 100 + Math.tan(t) * 700, n: -700 }, { e: 0, n: 100 / Math.tan(t) }, { e: 0, n: 3600 }];
    return rev ? base.slice().reverse() : base;
  };
  const res = [[false, [{ e: 250, n: -600 }, { e: 0, n: 600 }, { e: 0, n: 3600 }]], [true, [{ e: 450, n: -600 }, { e: 0, n: 600 }, { e: 0, n: 3600 }]],
               [false, oblique(35)], [false, oblique(45)], [false, oblique(35, true)], [false, oblique(45, true)]]
    .map(([named, base]) => {
      const ms = gates(named), w = model({ marks: ms, points: ptsOf(ms) }), r = lane(w, base);
      const r2 = ms.find((m) => m.side === RED && m.num === 2), k = r.marks.find((q) => q.m === r2);
      const rev = base[0].n > base[base.length - 1].n;                     // leaving: red 2 to port
      return { x: rev ? -offOf(r.track, r2) : offOf(r.track, r2), k, wrong: r.how.marks.wrong, ok: legsClear(r, w) };
    });
  check("53. AN ENTRANCE GATE CROSSED OBLIQUELY: red 2 is governed - left on its proper hand, or, where no join under "
        + "MARK_JOIN_MAX_DEG reaches it, counted wrong and said (singles at 12, 35 and 45 degrees both ways, one name at 22)",
        res.every((q) => q.k && !q.k.skip && (q.x > 0 ? q.wrong === 0 : q.wrong >= 1) && q.ok) && res.slice(0, 3).every((q) => q.x > 0),
        res.map((q) => "red 2 " + f1(q.x) + " m, \"" + (q.k && (q.k.skip || "governed")) + "\"" + (q.x > 0 ? "" : ", counted wrong " + q.wrong)).join("; "));
}
// 54. ANOTHER NAMED CHANNEL'S COUNT: a harbor's red 4 'alpha ledge', then a cove channel numbered again from 1. Read from
// the cove's red 2, red 4 was "leaving" and she was taken across it, counted KEPT to port. The cove's count does not
// continue red 4's, so it does not speak for it; numbered from 5 (continuing it), it does.
{
  const run = (first) => {
    const a4 = mark(60, 500, RED, 4, "alpha ledge");
    const ms = [mark(-60, -1500, GREEN, 1, "bravo rock"), mark(60, -1000, RED, 2, "charlie ledge"), a4];
    for (let i = 0; i < 4; i++) {
      const g = first + 2 * i + (first % 2 ? 0 : 1);
      ms.push(mark(-60, 1500 + 600 * i, GREEN, g, "cove channel"), mark(60, 1550 + 600 * i, RED, g + 1, "cove channel"));
    }
    const w = model({ marks: ms, points: ptsOf(ms) });
    const r = lane(w, [{ e: -2500, n: 0 }, { e: -20, n: 0 }, { e: -20, n: 4500 }]);
    return { x: offOf(r.track, a4), k: r.marks.find((q) => q.m === a4) };
  };
  const one = run(1), five = run(5);
  check("54. ANOTHER NAMED CHANNEL'S COUNT speaks only where it continues the mark's: red 4 is not crossed (the cove from 1), "
        + "and is passed close where the cove continues its count (from 5)",
        one.x > 0 && one.k && one.k.skip && Math.abs(five.x - PASS) < 2 && five.k && !five.k.skip,
        "cove from 1: red 4 " + f1(one.x) + " m, \"" + (one.k && one.k.skip) + "\"; cove from 5: red 4 " + f1(five.x) + " m");
}
// 54b. ... and numbered on FROM it: the count's mark nearest the single carries the count's number facing it. A cove
// numbered 1-8 lies all below a harbor's red 10 - "one side" - but starts again at 1 beside it (Bellingham's I and J
// Street Waterway beside Starr Rock Buoy 4: she was taken across the red both ways, counted kept). And the other way: a
// cove's entrance gate 1/2 is not read from the harbor's single red 4, 1 km off (it read "leaving", counted wrong).
{
  const run = (num, cove) => {
    const a = mark(60, 500, RED, num, "alpha ledge");
    const ms = [mark(-60, -1500, GREEN, num - 3, "bravo rock"), mark(60, -1000, RED, num - 2, "charlie ledge"), a, ...cove];
    const w = model({ marks: ms, points: ptsOf(ms) });
    const r = lane(w, [{ e: -2500, n: 0 }, { e: -20, n: 0 }, { e: -20, n: 4500 }]);
    return { x: offOf(r.track, a), k: r.marks.find((q) => q.m === a), mk: r.how.marks };
  };
  const cove = (from, pairs, name) => {
    const out = [];
    for (let i = 0; i < pairs; i++) out.push(mark(-60, 1500 + 600 * i, GREEN, from + 2 * i, name), mark(60, 1550 + 600 * i, RED, from + 2 * i + 1, name));
    return out;
  };
  const ten = run(10, cove(1, 4, "cove channel")), gate = run(4, cove(1, 1, "cove entrance"));
  check("54b. ... and only where it is numbered on FROM the mark: a cove numbered again from 1 beside a harbor's red 10 does "
        + "not speak for it, nor the harbor's single red 4 for the cove's entrance gate",
        ten.x > 0 && ten.k && /direction of buoyage not known/.test(ten.k.skip || "") && gate.x > 0 && gate.mk.wrong === 0,
        "red 10 " + f1(ten.x) + " m, \"" + (ten.k && (ten.k.skip || "governed")) + "\"; with the cove's gate alone: red 4 "
          + f1(gate.x) + " m, " + JSON.stringify(gate.mk));
}
// 55. AN ENTRANCE GATE NAMED APART from its channel ('harbor entrance' 1 and 2, then 'harbor' 4-12) has only its gate
// partner of its own name: that is not a channel crossing her route. Read so, it was neither governed nor watched, and
// on the real Honolulu chart she passed the Ala Wai entrance red 8 m on its wrong hand both ways, unsaid.
{
  const ms = [mark(-80, 0, GREEN, 1, "harbor entrance"), mark(80, 0, RED, 2, "harbor entrance")];
  for (let i = 1; i < 6; i++) ms.push(mark(80, 600 * i, RED, 2 * i + 2, "harbor"));
  const w = model({ marks: ms, points: ptsOf(ms) }), r = lane(w, [{ e: 110, n: -1500 }, { e: 110, n: 3600 }]);
  const k = r.marks.find((q) => q.m === ms[1]), x = offOf(r.track, ms[1]);
  check("55. AN ENTRANCE GATE NAMED APART: the entrance red is governed and passed close to starboard, from outside it",
        Math.abs(x - PASS) < 2 && k && !k.skip && legsClear(r, w), "red 2 " + f1(x) + " m, \"" + (k && (k.skip || "governed")) + "\"");
}
// 56. A TURN TO PORT AT A CHANNEL'S END: the last sample's cross-section, square to the turn, clips the end's corner - a
// sliver - and must not be taken for a narrower stretch ahead (it dragged the lane to the port edge for 135-250 m).
{
  const polys = [land(rect(-3000, -200, -140, 3000)), land(rect(140, -200, 3000, 3000)), land(rect(-3000, 3400, 3000, 4000))];
  const w = model({ polys, chans: [chan(rect(-100, 0, 100, 3000), true)] });
  const A = ll(0, -150), B = ll(-1500, 3200), leg = R.legPath(A, B, F, w, BUF);
  const r = R.channelLaneRoute([A, ...leg], F, w, BUF, {}), t = r.route.map((p) => F.toEN(p));
  const lo = minE(t, 600, 2950);
  check("56. A TURN TO PORT AT THE CHANNEL'S END: the lane is held to within 50 m of the end, never to port of the middle",
        lo >= 0 && legsClear(r, w), "least e n=600..2950 " + f1(lo) + " (the port edge -100; dragged by the sliver, -27 at 2900)");
}
// 57. A FAIRWAY ENDING IN A DREDGED BASIN: the basin is past the fairway's END (the lane leaves the fairway's own ring),
// so the lane is held to the end - it was eased back inside the fairway's last 250 m because the basin is charted.
{
  const w = model({ chans: [chan(RING, true), chan(rect(-300, 3000, 300, 3500), true)] });
  const r = lane(w, [{ e: -80, n: -400 }, { e: -80, n: 3000 }, { e: 0, n: 3250 }]);
  const lo = minE(r.track, 300, 2950);
  check("57. A FAIRWAY ENDING IN A BASIN: the lane held to the end of the fairway, never to port of its middle",
        lo >= 0 && legsClear(r, w), "least e n=300..2950 " + f1(lo) + " (eased inside it, -71)");
}
// 58. MARKS' RUNS IN WATER THE CHART RIDES: greens at a 300 m fairway's port edge, the routed path 250 m outside it. The
// runs bring her into the fairway; once there the chart's line is the line (held, the runs put her 20 m inside the port
// edge for 1.7 km). And 400 m outside it: the cone, measured across the SEARCH's path, took the step for a shift of the
// channel and held the lane 90 m to port of its middle for 870 m - measured in the plane, it does not.
{
  const greens = [1, 3, 5, 7, 9].map((num, i) => mark(-160, 1000 + 500 * i, GREEN, num, "fairway channel"));
  const ring = rect(-150, 0, 150, 5000);
  const w = model({ chans: [{ ...chan(ring, true), src: "fairway" }], marks: greens });
  const res = [400, 550].map((out) => {
    const r = lane(w, [{ e: -130, n: -400 }, { e: -130, n: 700 }, { e: -out, n: 900 }, { e: -out, n: 2700 }, { e: -130, n: 2900 }, { e: -130, n: 5400 }]);
    let left = 0;
    for (let n = 1200; n <= 4500; n += 10) { const e = eAtN(r.track, n); if (e != null && e > -150 && e < -2) left += 10; }
    return { left, r };
  });
  check("58. MARKS' RUNS IN WATER THE CHART RIDES: she rides the chart's line there, not the buoys' - the search's path 250 m "
        + "and 400 m outside the fairway",
        res.every((q) => q.left === 0 && q.r.how.marks.wrong === 0 && legsClear(q.r, w)),
        res.map((q) => "left of its middle " + q.left + " m; " + JSON.stringify(q.r.how.marks)).join(" | ") + " (were 1,710 and 870)");
}
// 59. THE CONE'S BAND INVERTED: a 120 m charted channel that jogs 1,000 m east over 1,000 m (45 degrees) while the
// search's path runs straight across the bend, and the path being laned follows the channel (as the pair lane does).
// In the search's frame the channel's edges move faster than LANE_SLEW, hi falls below lo, and the middle of the
// inverted band put the lane outside the channel: here 53 samples, up to 66 m out (seeded fuzz: 114 m; at a 19.5 m
// standoff 1,048 m, and a 2.4 km Go-To shipped as 10.3 km).
{
  const bend = [{ e: -60, n: 0 }, { e: 60, n: 0 }, { e: 60, n: 1000 }, { e: 1060, n: 2000 }, { e: 1060, n: 3200 },
                { e: 940, n: 3200 }, { e: 940, n: 2000 }, { e: -60, n: 1000 }];
  const w = model({ chans: [chan(bend, true)] });
  const laned = [{ e: -45, n: -400 }, { e: -45, n: 1000 }, { e: 955, n: 2000 }, { e: 955, n: 3600 }].map((p) => ll(p.e, p.n));
  const search = [ll(-45, -400), ll(955, 3600)];
  const O = R.chartOwnership(laned, F, w, BUF, search);
  let out = 0, owned = 0, worst = 0;
  for (let i = 0; O && i < O.N; i++) {
    if (!O.own[i]) continue;
    owned++;
    const c = O.ch[i], d = Math.max(c.xL - O.T[i], O.T[i] - c.xR, 0);
    if (d > 0) { out++; worst = Math.max(worst, d); }
  }
  check("59. THE CONE'S BAND INVERTED (a channel bending faster than LANE_SLEW across the search's path): every owned "
        + "lane point stands inside its own cross-section",
        owned > 40 && out === 0, owned + " owned samples; " + out + " outside their cross-section, worst " + f1(worst) + " m");
}
// 59b. ... and where her path runs out of one charted ring through its slanting starboard edge just as the next begins
// to starboard of her (the join of two rings, as the cone fuzz found it): the last samples of the first ring see the
// whole of their chord to port, the first of the next its whole chord to starboard, and the band inverts. Each keeps its
// own lane point, inside its own cross-section. (Split down the band's middle: 7 samples, up to 41 m outside it.)
{
  const A = [{ e: -150, n: 0 }, { e: 150, n: 0 }, { e: -5, n: 1000 }, { e: -150, n: 1000 }];
  const B = [{ e: 90, n: 1000 }, { e: 300, n: 1000 }, { e: 300, n: 2500 }, { e: -200, n: 2500 }, { e: -200, n: 1150 }, { e: 90, n: 1060 }];
  const O = R.chartOwnership([ll(0, -400), ll(0, 2900)], F, model({ chans: [chan(A, true), chan(B, true)] }), BUF, null);
  let owned = 0, out = 0, worst = 0;
  for (let i = 0; O && i < O.N; i++) {
    if (!O.own[i]) continue;
    owned++;
    const c = O.ch[i], d = Math.max(c.xL - O.T[i], O.T[i] - c.xR, 0);
    if (d > 1) { out++; worst = Math.max(worst, d); }
  }
  check("59b. THE CONE'S BAND INVERTED at the join of two charted rings: every owned lane point stands inside its own "
        + "cross-section",
        owned > 40 && out === 0, owned + " owned samples; " + out + " outside their cross-section, worst " + f1(worst) + " m");
}
// 60. A DRAWN TRANSIT lanes each leg alone, so every waypoint is a route's END: red 4 stands 100 m to PORT of the track
// (the wrong hand, returning) with a waypoint 150 m past it. Too near the leg's end to be moved for, it was counted by
// neither leg, and the banner said "2 marks left to starboard, 2 marks left to port". Excused the move, never the count:
// the plan's marks are counted once, on the route it ships, from every leg's.
{
  const P = require("../static/js/passage.js"), { nogo } = require("../static/js/state.js");
  const marks = [mark(120, 500, RED, 2, "alpha rock"), mark(-150, 1000, GREEN, 3, "bravo ledge"),
                 mark(-100, 1500, RED, 4, "charlie shoal"), mark(-90, 2000, GREEN, 5, "delta point"),
                 mark(150, 2500, RED, 6, "echo reef")];
  const saved = { ready: nogo.ready, frame: nogo.frame, buffer: nogo.buffer, ko: nogo.ko };
  Object.assign(nogo, { ready: true, frame: F, buffer: BUF, ko: model({ marks }) });
  const A = ll(0, -1500);
  let tr;
  try { tr = P.routePlan(A, [ll(0, 1650), ll(0, 4500)], true, 0); } finally { Object.assign(nogo, saved); }
  const t = [A, ...tr.route].map((p) => F.toEN(p)), x4 = offOf(t, marks[2]);
  const note = P.buoyageNote(tr.lane, tr.partial, tr.how), mk = tr.how.marks;
  check("60. A DRAWN TRANSIT'S WAYPOINT BESIDE A MARK ON ITS WRONG HAND: the mark is counted WRONG and said, and every "
        + "mark is counted once",
        x4 < 0 && mk.wrong === 1 && mk.kept + mk.wrong === 5 && tr.partial === true && /1 mark NOT left on the proper hand/.test(note),
        "red 4 at x " + f1(x4) + "; " + JSON.stringify(mk) + "; \"" + note + "\"");
  // 60b. ... and a mark BOTH legs judge - the transit turns at a waypoint beside it - is counted from the leg that knows its
  // direction: heading west past red 4 nothing of its count is in sight (direction not known), and heading south from the
  // turn red 2 below it says she is leaving, so it is kept to port.
  const marksB = marks.slice(); marksB[2] = mark(200, 1500, RED, 4, "charlie shoal");
  Object.assign(nogo, { ready: true, frame: F, buffer: BUF, ko: model({ marks: marksB }) });
  let tb;
  try { tb = P.routePlan(ll(2500, 1650), [ll(0, 1650), ll(0, -1500)], true, 0); } finally { Object.assign(nogo, saved); }
  check("60b. ... and a mark both legs judge (the transit turns beside it) is counted from the leg that knows its direction",
        tb.how.marks.kept === 3 && tb.how.marks.port === 2 && tb.how.marks.wrong === 0, JSON.stringify(tb.how.marks)
          + " (red 4 kept to port, leaving, from the second leg; the first could not read its direction)");
  // 60c. ... and each leg is judged on ITS OWN part of the route: up a channel of singles and back down it (a drawn
  // transit), every mark is on its proper hand both ways - 24 passes kept, none wrong. Judged by the first leg's hand
  // against the nearest point of the whole plan, the banner read "6 marks NOT left on the proper hand"; an approach up
  // the channel whose SURVEY lines run back down it read the same.
  const cm = [];
  for (let q = 0; q < 6; q++) cm.push(mark(-80, 600 * q, GREEN, 2 * q + 1, "rock " + (2 * q + 1)), mark(80, 600 * q, RED, 2 * q + 2, "rock " + (2 * q + 2)));
  Object.assign(nogo, { ready: true, frame: F, buffer: BUF, ko: model({ marks: cm, points: ptsOf(cm) }) });
  let ob, sv;
  try {
    ob = P.routePlan(ll(0, -600), [ll(0, 3300), ll(0, -600)], true, 0);
    sv = P.routePlan(ll(0, -600), [ll(0, 3300), ll(-60, 3300), ll(-60, -600)], false, 0);
  } finally { Object.assign(nogo, saved); }
  check("60c. ... and each leg is judged on its own part of the route: up a channel and back, 24 passes kept and none "
        + "wrong; an approach whose survey lines run back down the channel, 12 kept and none wrong",
        ob.how.marks.kept === 24 && ob.how.marks.wrong === 0 && sv.how.marks.kept === 12 && sv.how.marks.wrong === 0,
        "out and back " + JSON.stringify(ob.how.marks) + "; approach + survey " + JSON.stringify(sv.how.marks));
}
// 61. THE MARKS STAGE'S LIMIT IS WORK, NOT TIME: the same route with a clock that runs 60 s every time it is read. Past
// 4 s of wall-clock time the stage counted the rest of the marks where they stood, so the route depended on how busy
// the machine was (at 4x, six of his Go-To's marks on their wrong hand).
{
  const base = lane(M1, UP);
  const realNow = Date.now;
  let fake = realNow();
  Date.now = () => (fake += 60000);
  let slow;
  try { slow = lane(M1, UP); } finally { Date.now = realNow; }
  const same = JSON.stringify(base.track) === JSON.stringify(slow.track) && JSON.stringify(base.how.marks) === JSON.stringify(slow.how.marks);
  check("61. THE MARKS STAGE IS BOUNDED BY WORK, NOT THE CLOCK: a clock running 60 s a read ships the same route and the same count",
        same && base.how.marks.close === 3, "normal " + JSON.stringify(base.how.marks) + "; slow clock " + JSON.stringify(slow.how.marks)
          + (slow.marks.some((k) => k.unplaced) ? "; unplaced: " + slow.marks.filter((k) => k.unplaced).map((k) => k.unplaced).join(", ") : ""));
}
// 62. IN A SET THE CHART'S LANE POINTS ARE LAID CLEAR OF THE GUARD'S STANDOFF where the channel has one right of its
// middle, as the marks' runs are. A pile 10 m to starboard of the quarter line: at the buffer the lane points pass it
// 9 m off, and in a set every leg inside the 19.5 m standoff was the standoff re-gate's to splice (16 legs in one seeded
// world, where the banks' lane had 2; one splice went round the land - 10.6 km for an 89 m gap). The re-gate still
// splices what the smoothing brings back inside it; here the lane only hands it less.
{
  const w = model({ points: [{ e: 60, n: 1500, r: 0, kind: "an obstruction" }], chans: [chan(RING, true)] });
  const pile = { e: 60, n: 1500 };
  const pointsOff = (O) => {
    let m = Infinity;
    for (let i = 0; O && i < O.N; i++) if (O.own[i]) { const p = O.at(i, O.T[i]); m = Math.min(m, Math.hypot(p.e - pile.e, p.n - pile.n)); }
    return m;
  };
  const legsOff = (t) => {
    let m = Infinity;
    for (let i = 1; i < t.length; i++) {
      const a = t[i - 1], b = t[i], dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((pile.e - a.e) * dx + (pile.n - a.n) * dy) / l2));
      m = Math.min(m, Math.hypot(pile.e - a.e - u * dx, pile.n - a.n - u * dy));
    }
    return m;
  };
  const path = NB.map((p) => ll(p.e, p.n));
  const O0 = R.chartOwnership(path, F, w, BUF, null), O1 = R.chartOwnership(path, F, w, BUF, null, 19.5);
  let left = 0;
  for (let i = 0; O1 && i < O1.N; i++) if (O1.own[i] && O1.T[i] < (O1.ch[i].xL + O1.ch[i].xR) / 2) left++;
  const atBuf = lane(w, NB), inSet = lane(w, NB, { standoffM: 19.5 });
  check("62. IN A SET THE CHART'S LANE POINTS ARE LAID CLEAR OF THE STANDOFF, right of the channel's middle: a pile 10 m "
        + "to starboard of the quarter line, and the lane hands the re-gate legs further from it",
        pointsOff(O0) < 19.5 && pointsOff(O1) >= 19.5 && left === 0 && legsOff(inSet.track) > legsOff(atBuf.track) + 2
          && inSet.how.charted === true,
        "lane points at the buffer " + f1(pointsOff(O0)) + " m off, in a set " + f1(pointsOff(O1)) + " m (" + left + " left of the "
          + "middle); the lane's legs " + f1(legsOff(atBuf.track)) + " -> " + f1(legsOff(inSet.track)) + " m");
}
// 63. THE KNOT PRUNE KEEPS A RUN'S PASS POINT, NOT ITS ENDS: the `keep` a caller prunes with again (the standoff's
// re-gate) holds each run's interior and neither of its ends. With every vertex kept, a splice that overshot a run's
// first vertex and turned back onto it shipped a Z - 101 degrees, 12.6 m, 106 degrees - that the prune could not cut.
{
  const up = lane(M1, UP);
  const isKept = (p) => up.keep.some((q) => Math.hypot(q.e - p.e, q.n - p.n) < 0.75);
  const runs = up.marks.filter((k) => k.via && k.via.length > 2 && k.via.slice(1, -1).some(isKept));
  check("63. THE KNOT PRUNE KEEPS A RUN'S PASS POINT, NOT ITS ENDS: every run's interior is kept, neither of its ends",
        runs.length === 3 && runs.every((k) => k.via.slice(1, -1).every(isKept) && !isKept(k.via[0]) && !isKept(k.via[k.via.length - 1])),
        runs.length + " runs; ends kept: " + runs.filter((k) => isKept(k.via[0]) || isKept(k.via[k.via.length - 1])).length);
}
// 64. THE CHART'S LANE IS NOT CLAIMED WHERE MOST OF ITS WATER WAS CROSSED SHORT: the channel's starboard half is land for
// 2 km, so every lane point there is foul and eased back toward the routed path at the port edge. The banner said "right
// of center in the charted channel" over a route that rode 2,225 m of 2,225 m short of it; PARTIAL says the rest.
{
  const r = lane(model({ chans: [chan(RING, true)], polys: [land(rect(0, 500, 100, 2500))] }), NB);
  check("64. THE CHART'S LANE IS NOT CLAIMED where most of the water it owns was crossed short of it: PARTIAL says it",
        r.how.charted === false && r.how.chartedShortM > 1000 && r.partial === true && r.how.gaps === true && legsClear(r, model({ chans: [chan(RING, true)], polys: [land(rect(0, 500, 100, 2500))] })),
        "how " + JSON.stringify({ charted: r.how.charted, short: r.how.chartedShortM, gaps: r.how.gaps }) + " partial " + r.partial);
}
// 64b. ... and IN A SET it is measured on the route the standoff's re-gate ships (keepStandoff), not carried over from
// the buffer's: a 100 m charted channel (e -50..50) with a bank at its starboard edge and piles 15 m right of its middle
// along 2.6 km of its 3 km, planned at a 19.5 m standoff. No lane point right of the middle is clear of the standoff, so
// the re-gate splices the search's own way down the port side - and the claim goes. In calm water (at the buffer) the
// lane rides it, and claims it. (Carried over, "right of center in the charted channel" was said of the port side.)
{
  const P = require("../static/js/passage.js"), { nogo } = require("../static/js/state.js");
  const points = [];
  for (let n = -300; n <= 2300; n += 30) points.push({ e: 15, n, r: 0, kind: "a pile" });
  const ko = model({ chans: [chan(rect(-50, -500, 50, 2500), true)], polys: [land(rect(50, -2000, 400, 4000))], points });
  const saved = { ready: nogo.ready, frame: nogo.frame, buffer: nogo.buffer, ko: nogo.ko };
  let set, calm;
  try {
    Object.assign(nogo, { ready: true, frame: F, buffer: BUF, ko });
    set = P.planNogoRoute(ll(-20, -800), ll(-20, 2800), { standoffM: 19.5, ko });
    calm = P.planNogoRoute(ll(-20, -800), ll(-20, 2800), { ko });
  } finally { Object.assign(nogo, saved); }
  const h = (r) => (r.how ? { charted: r.how.charted, short: r.how.chartedShortM } : r.error);
  check("64b. ... and in a set it is measured on the route the standoff's re-gate ships: not claimed where that route "
        + "crossed most of the owned water short of it (calm, it is ridden and claimed)",
        !set.error && set.how.charted === false && set.how.chartedShortM > 1500 && set.partial === true
        && !calm.error && calm.how.charted === true && calm.how.chartedShortM === 0,
        "set " + JSON.stringify(h(set)) + " partial " + set.partial + "; calm " + JSON.stringify(h(calm)));
}
// 65. A CHANNEL THAT REALLY NARROWS AT ITS END is the channel, not an end's corner sliver: a 400 m fairway whose last
// 600 m is 150 m wide, run straight up it. Trimmed as a sliver (every end sample under half the run's median width), the
// narrow part was not laned at all, the end ramp carried the wide part's lane into it past its starboard edge, and she
// ran it on its port side under "right of center in the charted channel".
{
  const ring = [{ e: -200, n: 0 }, { e: 200, n: 0 }, { e: 200, n: 2400 }, { e: 75, n: 2400 }, { e: 75, n: 3000 },
                { e: -75, n: 3000 }, { e: -75, n: 2400 }, { e: -200, n: 2400 }];
  const w = model({ chans: [chan(ring, true)], polys: [land(rect(-3000, 0, -240, 2400)), land(rect(240, 0, 3000, 2400)),
                                                       land(rect(-3000, 2400, -115, 3000)), land(rect(115, 2400, 3000, 3000))] });
  const r = lane(w, [{ e: -50, n: -400 }, { e: -50, n: 3400 }]);
  const en = [2600, 2700, 2800, 2900, 2990].map((n) => eAtN(r.track, n)), lo = minE(r.track, 2500, 2950);
  check("65. A CHANNEL THAT NARROWS AT ITS END is laned to its end: three quarters across the 150 m entrance, never to "
        + "port of its middle, nor past its starboard edge",
        en.every((e) => e != null && Math.abs(e - 37.5) < 6) && lo >= 0 && r.how.charted === true && legsClear(r, w),
        "e@2600..2900,2990 = " + en.map(f1).join(",") + " (want 37.5); least e n=2500..2950 " + f1(lo));
}
// 66. THE CONE: a width step - 400 m wide (e -100..300) to n 1500, 200 m (e -100..100) above it, open water beyond and
// then land just past the narrow part's starboard edge. The lane is eased toward the narrower stretch AHEAD of it, so it
// never stands outside it: in the narrow part inside the polygon, starboard of its middle, and past an easing allowance
// within 20 m of its quarter line. (Read with no neighbor, from no frame - the lane ran 120 m on into the narrow part
// still at the wide part's line, outside its starboard edge.)
{
  const ring = [{ e: -100, n: 0 }, { e: 300, n: 0 }, { e: 300, n: 1500 }, { e: 100, n: 1500 }, { e: 100, n: 3000 }, { e: -100, n: 3000 }];
  const res = [[], [land(rect(103, 1503, 600, 3400))]].map((polys) => {
    const w = model({ polys, chans: [chan(ring, true)] }), r = lane(w, NB);
    let hi = -Infinity, lo = Infinity, off = 0;
    for (let n = 1500; n <= 2700; n += 5) { const e = eAtN(r.track, n); if (e != null) { hi = Math.max(hi, e); lo = Math.min(lo, e); } }
    for (let n = 1650; n <= 2700; n += 5) { const e = eAtN(r.track, n); if (e != null) off = Math.max(off, Math.abs(e - 50)); }
    return { hi, lo, off, ok: legsClear(r, w) };
  });
  check("66. THE CONE: at a width step the lane is eased toward the narrower stretch AHEAD, and never stands outside it",
        res.every((q) => q.hi <= 102 && q.lo >= 0 && q.off <= 20 && q.ok),
        res.map((q) => "narrow part e " + f1(q.lo) + ".." + f1(q.hi) + ", furthest off +50 past n 1650 " + f1(q.off) + " m").join(" | "));
}
// 66b. ... and where the narrow part's starboard edge steps in to PORT of the wide part's middle (e -100..40 or
// -100..0 above n 1500; the wide part's middle at e 100), her path straight up it: the lane is eased to port of the wide
// part's middle before the step - the narrowing is on the stretch she runs straight along - and the route that ships
// never stands past the narrow part's starboard edge, and rides right of its middle. (Held at the wide part's middle up
// to the step - "never to port of the middle" everywhere - the route ran 32 m and 162 m past that edge, 7.8 and 32.9 m
// out of the charted water.)
{
  const res = [40, 0].map((xr) => {
    const ring = [{ e: -100, n: 0 }, { e: 300, n: 0 }, { e: 300, n: 1500 }, { e: xr, n: 1500 }, { e: xr, n: 3000 }, { e: -100, n: 3000 }];
    const w = model({ chans: [chan(ring, true)] }), r = lane(w, [{ e: -50, n: -400 }, { e: -50, n: 3400 }]);
    let past = 0, far = 0, lo = Infinity;
    for (let n = 1500; n <= 2950; n += 1) {
      const e = eAtN(r.track, n);
      if (e == null) continue;
      if (e > xr) { past++; far = Math.max(far, e - xr); }
      if (n >= 1800 && n <= 2900) lo = Math.min(lo, e);
    }
    return { xr, past, far, lo, mid: (xr - 100) / 2, charted: r.how.charted, ok: legsClear(r, w) };
  });
  check("66b. THE CONE eases the lane to port of the middle for a narrowing on the stretch she runs straight along: past "
        + "a starboard edge that steps in beyond the wide part's middle, she is never out of the charted water",
        res.every((q) => q.past === 0 && q.lo > q.mid && q.charted === true && q.ok),
        res.map((q) => "edge e " + q.xr + ": " + q.past + " m past it (" + f1(q.far) + " m), least e in the narrow part "
                         + f1(q.lo) + " (its middle " + q.mid + ")").join(" | "));
}
// 67. THE CONE ROUND A BEND: the width step of 66 at a bend - 400 m wide (e -100..300) to n 1500, then 200 m wide
// centered on her path, turned 10, 20 or 45 degrees to starboard. The lane is eased toward the narrow part before the
// bend, and never runs more than a meter out of the charted water past the narrow part's starboard edge. (Read from the
// neighbors running its own way alone - within 3 degrees - the narrowing was not seen before the bend: 14 route points
// out of the water at 10 and 20 degrees, 22 and 25 m past the edge, and 12 at 45 degrees, 21 m. The samples where her
// path is still turning are not read - see 68 - and at 20 degrees that leaves 0.6 m for 2 m.)
{
  const res = [10, 20, 45].map((deg) => {
    const a = deg * Math.PI / 180, u = [Math.sin(a), Math.cos(a)], v = [Math.cos(a), -Math.sin(a)];   // along; starboard
    const P = (s, x) => ({ e: u[0] * s + v[0] * x, n: 1500 + u[1] * s + v[1] * x });
    const w = model({ chans: [chan(rect(-100, 0, 300, 1500), true),
                              chan([P(-30, -100), P(-30, 100), P(1500, 100), P(1500, -100)], true)] });
    const r = lane(w, [{ e: 0, n: -400 }, { e: 0, n: 1500 }, P(1900, 0)]);
    let out = 0, far = 0;
    for (let i = 1; i < r.track.length; i++) {
      const A = r.track[i - 1], B = r.track[i], L = Math.hypot(B.e - A.e, B.n - A.n);
      for (let t = 0; t <= L; t += 5) {
        const q = { e: A.e + (B.e - A.e) * t / L, n: A.n + (B.n - A.n) * t / L };
        const s = q.e * u[0] + (q.n - 1500) * u[1], x = q.e * v[0] + (q.n - 1500) * v[1];
        if (s > 20 && s < 1400 && x > 100 && !(q.e > -100 && q.e < 300 && q.n < 1500)) { far = Math.max(far, x - 100); if (x > 101) out++; }
      }
    }
    return { deg, out, far, charted: r.how.charted, ok: legsClear(r, w) };
  });
  check("67. THE CONE ROUND A BEND: a width step at a bend is eased toward before the bend, and the lane never runs more "
        + "than a meter out of the charted water past the narrow part's starboard edge",
        res.every((q) => q.out === 0 && q.charted === true && q.ok),
        res.map((q) => q.deg + " deg: " + q.out + " points over a meter out (furthest " + f1(q.far) + " m)").join(" | "));
}
// 68. A DOGLEG OF TWO CHARTED RINGS: a 200 m fairway north (e -100..100, to n 2000), then another turned 40 degrees to
// PORT, 50 m on or touching, her path up the middle of each. Where the rings join, a cross-section square to her turning
// track is cut short by the end of the ring she is leaving - or, in the gap, is a corner of it wholly to port - and it
// is no narrowing of either channel: the route that ships is never to port of the middle of either, over the last 300 m
// of the one and the first 300 m of the other. (Read as a narrowing, one such sample held the lane at the middle 250 m
// either side, and the blend took the route 38 m and 23 m to port of their middles - 8 m with the rings touching.)
{
  const res = [50, 0].map((gap) => {
    const a = -40 * Math.PI / 180, u = [Math.sin(a), Math.cos(a)], v = [Math.cos(a), -Math.sin(a)];   // along; starboard
    const P = (s, x) => ({ e: u[0] * s + v[0] * x, n: 2000 + u[1] * s + v[1] * x });
    const w = model({ chans: [chan(rect(-100, 0, 100, 2000), true),
                              chan([P(gap, -100), P(gap, 100), P(gap + 2000, 100), P(gap + 2000, -100)], true)] });
    const r = lane(w, [{ e: 0, n: -400 }, { e: 0, n: 2000 }, P(gap + 2300, 0)]);
    let portA = 0, worstA = 0, portB = 0, worstB = 0;
    for (let i = 1; i < r.track.length; i++) {
      const A = r.track[i - 1], B = r.track[i], L = Math.hypot(B.e - A.e, B.n - A.n);
      for (let t = 0; t < L; t += 1) {
        const q = { e: A.e + (B.e - A.e) * t / L, n: A.n + (B.n - A.n) * t / L };
        if (q.n >= 1700 && q.n <= 2000 && q.e < 0 && q.e > -100) { portA++; worstA = Math.max(worstA, -q.e); }
        const s = q.e * u[0] + (q.n - 2000) * u[1], x = q.e * v[0] + (q.n - 2000) * v[1];
        if (s >= gap && s <= gap + 300 && x < 0 && x > -100) { portB++; worstB = Math.max(worstB, -x); }
      }
    }
    return { gap, portA, worstA, portB, worstB, charted: r.how.charted, ok: legsClear(r, w) };
  });
  check("68. A DOGLEG OF TWO CHARTED RINGS: the cross-sections where the rings join are no narrowing - the route is never "
        + "to port of either channel's middle",
        res.every((q) => q.portA === 0 && q.portB === 0 && q.charted === true && q.ok),
        res.map((q) => "gap " + q.gap + " m: to port of the first's middle " + q.portA + " m (" + f1(q.worstA) + "), of the "
                         + "second's " + q.portB + " m (" + f1(q.worstB) + ")").join(" | "));
}
// 68b. ... and a cross-section that does not hold her is no narrowing either: a 200 m fairway (e -100..100) to n 1000,
// then the next reach stepped 120 m to PORT (e -220..-20), her path straight on up e 0 - past the new reach's starboard
// edge. The route is to port of the middle of the water it is in only on the approach to the step, where getting into
// the new reach needs it: no more than 80 m of it, never more than 20 m. (Read as narrowings, the cross-sections wholly
// to port of her held the lane down for 137 m, up to 42.5 m to port of the middle.)
{
  const rings = [rect(-100, 0, 100, 1000), rect(-220, 1000, -20, 2500)];
  const w = model({ chans: rings.map((g) => chan(g, true)) }), r = lane(w, [{ e: 0, n: -400 }, { e: 0, n: 2900 }]);
  const pinRing = (p, g) => {                    // (ray casting, written here and not taken from the module)
    let c = false;
    for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
      const a = g[i], b = g[j];
      if ((a.n > p.n) !== (b.n > p.n) && p.e < (b.e - a.e) * (p.n - a.n) / (b.n - a.n) + a.e) c = !c;
    }
    return c;
  };
  const inW = (p) => rings.some((g) => pinRing(p, g));
  let port = 0, worst = 0;
  for (let i = 1; i < r.track.length; i++) {
    const A = r.track[i - 1], B = r.track[i], L = Math.hypot(B.e - A.e, B.n - A.n);
    for (let t = 0; t < L; t += 1) {
      const q = { e: A.e + (B.e - A.e) * t / L, n: A.n + (B.n - A.n) * t / L };
      if (q.n < 300 || q.n > 2600 || !inW(q)) continue;
      let lo = q.e, hi = q.e;
      while (inW({ e: lo - 1, n: q.n }) && lo > q.e - 800) lo--;
      while (inW({ e: hi + 1, n: q.n }) && hi < q.e + 800) hi++;
      if (q.e < (lo + hi) / 2) { port++; worst = Math.max(worst, (lo + hi) / 2 - q.e); }
    }
  }
  check("68b. ... nor a cross-section that does not hold her: where the next reach steps to port of her straight path, the "
        + "route is to port of the middle of its water only on the approach to the step",
        port <= 80 && worst <= 20 && r.how.charted === true && legsClear(r, w),
        "to port of the middle of the water it is in for " + port + " m, worst " + f1(worst) + " m");
}
// 50. The Rule 9 lane's routes ask the knot prune for the stub rule, and a maneuver's do not (see 45).
{
  const asked = lane(C1, NB), maneuver = lane(C1, NB, { charted: false, marks: false });
  check("50. THE STUB RULE is asked for on the Rule 9 lane's routes and not on a maneuver's",
        asked.stubs === true && maneuver.stubs === false, "lane " + asked.stubs + "; maneuver " + maneuver.stubs);
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED of " + ran : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
