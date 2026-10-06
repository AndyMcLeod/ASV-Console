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
//   69-78  THE BUOYED REACH AND BUOY TO BUOY (2026-10-05; Andy, of the Piscataqua past Seavey Island: "the ASV moves
//          to the far side of the channel both outbound and inbound", and of The Rocks Buoy 4: "the red buoy N4 seems
//          to have been ignored"). 69, single marks buoy a channel the chart does not draw: beacons on her starboard
//          hand, she rides its starboard side both ways (the control: the same banks with no marks move nothing); 70,
//          a local restricted area on that hand is the channel's edge (nor a regional one); 71, round a bend the line
//          between two marks is no edge; 72, the cone: a buoy passed close in mid-water is never crossed (72c: and a
//          pier from her starboard bank is eased round); 73, side water is no edge (the water's width is what is
//          judged), and 73b, water a little wider is the channel's own; 74, the chart's lane is laid as it was, and she
//          comes onto it one way; 75, only ever to starboard, 75b, not in water too wide to be a channel, and 75c,
//          an islet short of the reach is a rock, passed wide, not an edge; 76, The Rocks Buoy 4 at the
//          DriX's buffer: the passes aimed buoy to buoy, and a pass that could not be joined asked again (76b: bound
//          out, the pass points of a run held); 77, the words; 78, a close mark with no run held (a seeded world).
//   79-93  THE REVIEW OF IT, two rounds (2026-10-05): 79, a limit read at one sample held over the smoothing; 80, what
//          stands between two rays seen (80b: the ease's room; 80d: a rock in mid-reach held past; 80e, 80f: a
//          bridge support there is the bank, its extent counted; 80g: a dolphin beyond the ease stops it no more than
//          80c's islet); 81, every mark on the chart in
//          the cone; 82, a restricted area her path only clips still an edge (82b: inside one, only toward its nearer
//          edge; 82c: one cut at a cell seam judged whole); 83, an obstruction in water that is no channel, and a
//          stretch too short, lane nothing (83b); 84, a port-hand mark she is on the wrong side of not steered at; 85,
//          buoy to buoy only for the breach (85b) and along her route (85c); 86, a refused pass asked again on a later
//          round; 87, no re-aim costing a mark its distance; 88, no turn over the stage's limit the route without the
//          lane does not have (88b: where it is); 89, the reach asked again in the standoff's re-gate; 90, a lane that
//          puts a counted mark right not vetoed for it; 91, no nearer a rock than the lane's floor where the route
//          without it was further off (91b: nor a bridge support); 92, a drawn transit through a buoyed reach claims it; 93, A ROCK IS A SHALLOW
//          POINT, NOT AN EDGE (his call on the review): in mid-reach she holds her lane past it in both models (93b:
//          on the lane's line, passed either side at each model's floor; 93c: anything built is the bank; 93d: on
//          whichever side is the smaller move; 93e: the page's choice reaches the planner; 93f: rocks closer than
//          twice the floor passed as one; 93g: a rock past a reach's end passed on her path's side, the lane given
//          up for it over its own window only; 93h: a shoal off a bank is the bank; 93i: a chain of rocks longer
//          than ROCK_MAX_M is too (as land); 93j: a hazard a mark stands beside is the edge it marks; and the third
//          review of it: 93k, water all round measured from the outline; 93l, two rocks either side of the line;
//          93m, the smoothed route at a bend and at the ease's knees; 93n, a run of rocks; 93o, a long thin rock's
//          own width; 93p, the chart's classes; 93q, an unknown-extent rock on the line; 93r, a shoal patch and an
//          islet with its shoreline; 93s, her own path; 93t, the re-lay threshold; 93u, the marked distance).
//   95-98  THE REACH'S OLDER MUTATION SURVIVORS (2026-10-05): 95-95c, the route that ships asked of a mark no count
//          speaks for, mark by mark, and so where the planner re-gates; 96-96c, a run's pass points held (in a set too),
//          a starboard mark holding the lane off by the water between them round a hard turn, a close mark with no run
//          held; 97, the hold asking the water a smoothing step either side; 98, water wider than REACH_MAX_WIDTH_M at
//          one cross-section no channel's.
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
                        sys: K.markSystems(o.marks || []), chans: o.chans || [], restricted: o.restricted || [] });
// A charted restricted area as buildKeepouts carries it: a fact about the water, with its area, and no keep-out.
const restr = (ring) => {
  let a2 = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a2 += ring[j].e * ring[i].n - ring[i].e * ring[j].n;
  return { ring, bb: bbOf(ring), area: Math.abs(a2) / 2, name: "" };
};
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
  // (2026-10-05: the wider berth is the LEAST she gives it. Between the green and the line of red beacons the
  // marks buoy a channel, and she rides its starboard side - no nearer a beacon than that same berth: see 69.)
  const beacons = marks2.filter((m) => m.fixed), offB = beacons.map((m) => offOf(r2.track, m));
  check("20. A GREEN BUOY ON THE WRONG HAND (60 m to starboard): she crosses to leave it to port, by the wider berth "
        + "at the least, and no nearer the red beacons than that",
        e3 != null && e3 >= 60 + berth - 2 && offOf(r2.track, marks2[1]) < 0 && r2.how.marks.wrong === 0
          && offB.every((x) => x >= berth - 1),
        "e@1000 = " + f1(e3) + " (at least " + (60 + berth) + ": " + R.MARK_PORT_BERTH + " pass distances off a mark left "
          + "to port); the beacons lie " + offB.map(f1).join(",") + " m to starboard (at least " + berth + ")");
}

// ── 21. a beacon ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const fixedAll = SINGLES.map((m) => (m.side === RED ? mark(m.e, m.n, m.side, m.num, m.sys, true) : m));
  const r = lane(model({ marks: fixedAll }), UP);
  const es = fixedAll.filter((m) => m.fixed).map((m) => eAtN(r.track, m.n));
  // (2026-10-05: "not brought close" is no longer "left on the search's path". The beacons and the green buoys
  // buoy a channel between them, and she rides the starboard side of it - a beacon's berth off the beacons' line
  // at the nearest, where a BUOY kept to starboard is passed MARK_PASS_M off: 15.)
  const berthB = R.MARK_PORT_BERTH * PASS, offs = fixedAll.filter((m) => m.fixed).map((m) => offOf(r.track, m));
  check("21. A BEACON stands on what it marks: she is NOT brought close to a red light or daybeacon - never nearer "
        + "than the berth of a mark left to port - and rides the starboard side of the water they buoy",
        es.every((e) => e != null && e > 1.5) && offs.every((x) => x >= berthB - 1) && r.how.marks.kept === 5
          && r.how.marks.wrong === 0 && r.how.reach === true,
        "e abeam of the red beacons = " + es.map(f1).join(",") + " (the routed path was at 0); they lie " + offs.map(f1).join(",")
          + " m to starboard (at least " + berthB + "); " + JSON.stringify(r.how.marks));
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
      const a = g[i], q = g[j];
      if ((a.n > p.n) !== (q.n > p.n) && p.e < (q.e - a.e) * (p.n - a.n) / (q.n - a.n) + a.e) c = !c;
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
// ── 69-78. THE BUOYED REACH, AND BUOY TO BUOY (2026-10-05) ───────────────────────────────────────────────────
// Andy, 2026-10-04, of his Go-To up the Piscataqua between Henderson Point and Badgers Island: "through this section
// along Seavey Island, the ASV moves to the far side of the channel both outbound and inbound". No fairway is charted
// there, no two of its marks pair, the river is too wide for the banks' lane, and its starboard-hand marks bound up it
// are beacons on the shore - which she is never brought close to. So nothing put her on the starboard side of the
// water the marks buoy: she rounded the green buoys thirty meters off, on the port edge of the channel.
//
// 69. THE REACH: a river 400 m wide (banks at e -200 and +200) running north, nothing charted. Green BUOYS 1, 3, 5
// stand 50 m off its west bank; red BEACONS 2 and 4 on its east bank. The search's path runs up e -100.
const REACH_BANKS = [land(rect(-900, -1600, -200, 4600)), land(rect(200, -1600, 900, 4600))];
const REACH_MARKS = [mark(-150, 500, GREEN, 1, "able rock"), mark(190, 1000, RED, 2, "baker light", true),
                     mark(-150, 1500, GREEN, 3, "cast ledge"), mark(190, 2000, RED, 4, "dog light", true),
                     mark(-150, 2500, GREEN, 5, "easy shoal")];
const REACH_UP = [{ e: -100, n: -1500 }, { e: -100, n: 4500 }], REACH_DN = [{ e: -100, n: 4500 }, { e: -100, n: -1500 }];
const pinRing = (p, g) => {                      // (ray casting, written here and not taken from the module)
  let c = false;
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
    const a = g[i], q = g[j];
    if ((a.n > p.n) !== (q.n > p.n) && p.e < (q.e - a.e) * (p.n - a.n) / (q.n - a.n) + a.e) c = !c;
  }
  return c;
};
const along = (t, step, fn) => {                 // every `step` m of a track
  for (let i = 1; i < t.length; i++) {
    const A = t[i - 1], B = t[i], L = Math.hypot(B.e - A.e, B.n - A.n);
    for (let d = 0; d < L; d += step) fn({ e: A.e + (B.e - A.e) * d / L, n: A.n + (B.n - A.n) * d / L });
  }
};
{
  const w = model({ polys: REACH_BANKS, marks: REACH_MARKS });
  const up = lane(w, REACH_UP), dn = lane(w, REACH_DN);
  const ns = [1000, 1250, 1500, 1750, 2000], eu = ns.map((n) => eAtN(up.track, n)), ed = ns.map((n) => eAtN(dn.track, n));
  const beacons = REACH_MARKS.filter((m) => m.fixed), berth = R.MARK_PORT_BERTH * PASS;
  check("69. A BUOYED REACH, BEACONS ON HER STARBOARD HAND: bound up it she rides the starboard side of the water the "
        + "marks buoy - right of its middle, three quarters across from the greens' line to the beacons' - never nearer "
        + "a beacon than a mark's berth",
        // the greens' line is e -150; the beacons' line, a berth in, e 160: three quarters across is e 82.5
        eu.every((e) => e != null && Math.abs(e - 82.5) < 6) && beacons.every((m) => offOf(up.track, m) >= berth - 1)
          && up.how.reach === true && up.how.marks.wrong === 0 && up.how.marks.kept === 5 && legsClear(up, w),
        "e@" + ns.join(",") + " = " + eu.map(f1).join(",") + " (the search's path: -100; three quarters across: 82.5); how "
          + JSON.stringify({ reach: up.how.reach, marks: up.how.marks }));
  const gOff = REACH_MARKS.filter((m) => m.side === GREEN).map((m) => offOf(dn.track, m));
  check("69b. ... and bound down it, the other side: the green buoys close to starboard, and the two ways pass port to "
        + "port, a hundred meters apart or more",
        // (bound down, the greens are the starboard-hand marks: each passed PASS off; and she is never east of the search's path)
        gOff.every((x) => Math.abs(x - PASS) < 2) && ed.every((e) => e != null && e <= -99) && eu.every((e, i) => e - ed[i] > 100)
          && dn.how.marks.wrong === 0 && legsClear(dn, w),
        "bound down e@" + ns.join(",") + " = " + ed.map(f1).join(",") + "; the greens lie " + gOff.map(f1).join(",") + " m to starboard (want "
          + PASS + "); apart " + eu.map((e, i) => f1(e - ed[i])).join(","));
  // THE CONTROL: the same banks with no marks. Two banks 400 m apart are no channel (Andy, 2026-08-31), and nothing moves.
  const bare = lane(model({ polys: REACH_BANKS }), REACH_UP), eb = ns.map((n) => eAtN(bare.track, n));
  check("69c. THE CONTROL: the same water with NO marks is no channel - nothing moves, nothing is claimed",
        eb.every((e) => e != null && Math.abs(e + 100) < 1) && bare.lane === false && !bare.how.reach,
        "e = " + eb.map(f1).join(",") + "; lane " + bare.lane);
}
// 69d. ... and two marks further apart along her route than MARK_NEIGHBOR_M buoy nothing between them: the same
// banks, two green buoys 2,100 m apart. (Their hands are known - each reads the other - and she passes neither close.)
{
  const far2 = [mark(-150, 400, GREEN, 1, "able rock"), mark(-150, 2500, GREEN, 3, "cast ledge")];
  const r = lane(model({ polys: REACH_BANKS, marks: far2 }), REACH_UP), e = [900, 1450, 2000].map((n) => eAtN(r.track, n));
  check("69d. ... and two marks further apart than MARK_NEIGHBOR_M are no reach: nothing is laned between them",
        e.every((x) => x != null && Math.abs(x + 100) < 1) && !r.how.reach && r.how.marks.kept === 2 && R.MARK_NEIGHBOR_M === 1500,
        "e = " + e.map(f1).join(",") + " (the search's path: -100); how.reach " + r.how.reach + "; " + JSON.stringify(r.how.marks));
}
// 70. A LOCAL RESTRICTED AREA ON HER STARBOARD HAND IS THE CHANNEL'S EDGE. The Naval Shipyard's restricted area lies
// along Seavey Island (33 CFR 334.50), 100-190 m wide: three quarters of the way across the WATER there is inside it.
// The same river, with a restricted area over its east half between n 800 and 2200 (0.28 km2). She is laid right of
// the middle of the water outside it and never in it. One her routed path already runs through is no limit (a
// restricted area is advisory: the route is the search's to make), nor is a REGIONAL one - the Piscataqua's
// no-discharge zone is a single polygon of 18 km2 whose edge runs down the middle of the river.
{
  const local = restr(rect(0, 800, 200, 2200)), regional = restr(rect(0, -3000, 500, 6000));
  const greens = REACH_MARKS.filter((m) => !m.fixed);          // (no beacons: the area is the only edge on that hand)
  const run = (restricted, base) => {
    const w = model({ polys: REACH_BANKS, marks: greens, restricted }), r = lane(w, base);
    let inside = 0, hi = -Infinity, lo = Infinity;
    along(r.track, 5, (p) => { if (p.n < 1000 || p.n > 2000) return; if (pinRing(p, local.ring)) inside++; hi = Math.max(hi, p.e); lo = Math.min(lo, p.e); });
    return { r, inside, hi, lo };
  };
  const lim = run([local], REACH_UP), none = run([], REACH_UP), reg = run([regional], REACH_UP);
  const through = run([local], [{ e: 100, n: -1500 }, { e: 100, n: 4500 }]);
  check("70. A LOCAL RESTRICTED AREA on her starboard hand is the channel's edge: she rides right of the middle of the "
        + "water outside it, and no point of her route is inside it (without it, she rides well into that water)",
        // outside it the water runs e -150 (the greens) to 0: its middle -75, three quarters across about -40
        lim.inside === 0 && lim.hi < 0 && lim.lo > -75 && lim.r.how.reach === true && none.lo > 40 && none.inside > 100,
        "with it: e " + f1(lim.lo) + ".." + f1(lim.hi) + " over n 1000-2000, " + lim.inside + " points inside; without: e "
          + f1(none.lo) + ".." + f1(none.hi) + ", " + none.inside + " inside");
  check("70b. ... one her ROUTED PATH runs through is no edge (she rides where she would with none), and a REGIONAL one "
        + "(over RESTRICTED_LOCAL_M2) is none either",
        through.inside > 100 && Math.abs(through.lo - none.lo) < 2 && Math.abs(through.hi - none.hi) < 2
          && Math.abs(reg.lo - none.lo) < 2 && Math.abs(reg.hi - none.hi) < 2 && regional.area > R.RESTRICTED_LOCAL_M2 && local.area < R.RESTRICTED_LOCAL_M2,
        "routed through it: e " + f1(through.lo) + ".." + f1(through.hi) + "; a " + (regional.area / 1e6).toFixed(1) + " km2 one: e "
          + f1(reg.lo) + ".." + f1(reg.hi) + " (with none: " + f1(none.lo) + ".." + f1(none.hi) + ")");
  // ... and buildKeepouts carries them as facts, whatever the operator's `area` toggle says.
  const ringLL = (g) => [g.concat([g[0]]).map((p) => { const q = ll(p.e, p.n); return [q.lon, q.lat]; })];
  const feats = [{ role: "restricted", cls: "Restricted_Area_area", props: { OBJNAM: "Security Barrier" },
                   geometry: { type: "Polygon", coordinates: ringLL(rect(0, 800, 200, 2200)) } }];
  const off = K.buildKeepouts(F, feats, {}), on = K.buildKeepouts(F, feats, { enforce: { area: true } });
  check("70c. buildKeepouts carries a charted restricted area as a FACT - its ring and its area - whether or not the "
        + "operator enforces it, and as a keep-out only when he does",
        off.restricted.length === 1 && Math.abs(off.restricted[0].area - 280000) < 2000 && off.restricted[0].name === "Security Barrier"
          && off.polys.length === 0 && on.restricted.length === 1 && on.polys.length === 1,
        "advisory: " + off.restricted.length + " fact(s), area " + Math.round(off.restricted[0].area) + " m2, " + off.polys.length
          + " keep-out(s); enforced: " + on.polys.length + " keep-out(s)");
}
// 71. ROUND A BEND THE LINE BETWEEN TWO MARKS IS NO EDGE OF THE CHANNEL. A river 300 m wide runs southeast and turns
// east round a point (the corner at e 62, n 150). Two green buoys stand on the OUTSIDE of the bend, 600 m either side
// of it - South Beacon Shoal Buoy 11 and Goat Island Ledge Buoy 9 either side of Henderson Point - and bound DOWN the
// river both are passed close to starboard. The straight line from the one pass to the other runs 40 m off the point,
// on the far side of the water from both buoys, and that is where the marks stage leaves her. She rides the outside
// of the bend. (Read as the channel's edge, the line between the buoys left her no room to starboard of it.)
{
  const inner = land([{ e: 62, n: 150 }, { e: 2000, n: 150 }, { e: 2000, n: 2600 }, { e: -2388, n: 2600 }]);
  const outer = land([{ e: -62, n: -150 }, { e: 2000, n: -150 }, { e: 2000, n: -1500 }, { e: -3000, n: -1500 }, { e: -3000, n: 2788 }]);
  const g7 = mark(-509, 339, GREEN, 7, "upper ledge"), g5 = mark(600, -120, GREEN, 5, "lower shoal");
  const w = model({ polys: [inner, outer], marks: [g7, g5] });
  // the search's own way: the inside of the bend, 50 m off the bank
  const r = lane(w, [{ e: -1129, n: 1271 }, { e: 42, n: 100 }, { e: 1500, n: 100 }]);
  const corner = { e: 62, n: 150 };
  let near = Infinity;
  along(r.track, 2, (p) => { near = Math.min(near, Math.hypot(p.e - corner.e, p.n - corner.n)); });
  const o7 = offOf(r.track, g7), o5 = offOf(r.track, g5);
  check("71. ROUND A BEND the line between two marks is no edge: bound down the river she passes both green buoys close "
        + "to starboard and rides the OUTSIDE of the bend between them, right of the middle of the water off the point",
        // 300 m of water off the point: its middle 150 m off, and the chord between the two passes 40 m off
        near > 150 && Math.abs(o7 - PASS) < 2 && Math.abs(o5 - PASS) < 2 && r.how.marks.wrong === 0 && r.how.reach === true
          && legsClear(r, w) && sharpest(r.track) < 60,
        "nearest the point " + f1(near) + " m (the middle of the water there: 150; the chord between the two passes: 40); "
          + "the greens lie " + f1(o7) + ", " + f1(o5) + " m to starboard; sharpest turn " + f1(sharpest(r.track)));
}
// 71b. A MARK'S OWN EDGE RUNS ONLY AS FAR AS THE NEXT MARK. The bend of 71, with the upper green buoy in MID-WATER
// (30 m outside the middle of the river, 120 m off its bank) and a red buoy on the far side 150 m on. Beside the green
// its own line is the channel's edge; past the red, the water's. Run on along the water's course past the next mark,
// the green's line held her in mid-river all the way to the bend - South Beacon Shoal Buoy 11's line, straight on at
// Henderson Point, where the channel had turned away from it.
{
  const inner = land([{ e: 62, n: 150 }, { e: 2000, n: 150 }, { e: 2000, n: 2600 }, { e: -2388, n: 2600 }]);
  const outer = land([{ e: -62, n: -150 }, { e: 2000, n: -150 }, { e: 2000, n: -1500 }, { e: -3000, n: -1500 }, { e: -3000, n: 2788 }]);
  // 600 m short of the bend the middle of the river is at (-424, 424): the green 30 m outside it, the red 100 m inside it 150 m on
  const g7 = mark(-445, 403, GREEN, 7, "upper ledge"), r6 = mark(-247, 389, RED, 6, "inner rock"), g5 = mark(600, -120, GREEN, 5, "lower shoal");
  const w = model({ polys: [inner, outer], marks: [g7, r6, g5] });
  const r = lane(w, [{ e: -1129, n: 1271 }, { e: 42, n: 100 }, { e: 1500, n: 100 }]);
  let near = Infinity;
  along(r.track, 2, (p) => { near = Math.min(near, Math.hypot(p.e - 62, p.n - 150)); });
  check("71b. A MARK'S OWN EDGE runs only as far as the next mark: past a red on the far side, a green buoy in mid-water "
        + "no longer bounds the channel, and she rides the outside of the bend",
        near > 150 && Math.abs(offOf(r.track, g7) - PASS) < 2 && offOf(r.track, r6) < -PASS && Math.abs(offOf(r.track, g5) - PASS) < 2
          && r.how.marks.wrong === 0 && legsClear(r, w),
        "nearest the point " + f1(near) + " m (the middle of the water there: 150); green 7 " + f1(offOf(r.track, g7)) + ", red 6 "
          + f1(offOf(r.track, r6)) + ", green 5 " + f1(offOf(r.track, g5)) + " m (+ = to starboard)");
}
// 72. THE CONE: a red BUOY in mid-water (e +40, n 1500) among the reach's greens. Bound up, she passes it close to
// starboard, and between the greens' line and the line through it along the water's course she rides right of the
// middle (three quarters across is e -15) - never beyond its line, and eased inside it by the time she is there.
// (Eased by the slew alone the lane was still 47 m to starboard of her path AT a buoy passed 10 m off, which is the
// buoy on her wrong hand; and the whole lane was then stood down for it.)
{
  const red = mark(40, 1500, RED, 4, "mid rock");
  const marks = [mark(-150, 500, GREEN, 3, "able rock"), red, mark(-150, 2500, GREEN, 5, "easy shoal")];
  const w = model({ polys: REACH_BANKS, marks }), r = lane(w, REACH_UP);
  const o = offOf(r.track, red), e9 = eAtN(r.track, 900), e21 = eAtN(r.track, 2100);
  const maxE = (t, a, c) => { let m = -Infinity; for (let n = a; n <= c; n += 5) { const e = eAtN(t, n); if (e != null) m = Math.max(m, e); } return m; };
  check("72. THE CONE: a red buoy in mid-water is passed close to starboard, never crossed, with the lane well to "
        + "starboard of the search's path either side of it",
        Math.abs(o - PASS) < 2 && r.how.marks.wrong === 0 && e9 > -55 && e9 < 31 && e21 > -55 && e21 < 31 && maxE(r.track, 300, 2700) < 31
          && r.how.reach === true && legsClear(r, w) && sharpest(r.track) < 30,
        "the red lies " + f1(o) + " m to starboard (want " + PASS + "); e@900 = " + f1(e9) + ", e@2100 = " + f1(e21)
          + " (the search's path: -100; the middle: -55; the red's line less its pass distance: 30); furthest east " + f1(maxE(r.track, 300, 2700))
          + "; sharpest turn " + f1(sharpest(r.track)));
}
// 72b. THE LINE BETWEEN TWO MARKS IS MEASURED IN THE PLANE. A river 600 m wide, two red BEACONS in mid-water (e +100)
// a kilometer apart, and between them a green buoy on her wrong hand that her pass takes her 80 m east round. Abeam
// of the green she is 220 m from the beacons' line, and rides three quarters of the way from the green to it, a
// beacon's berth in (e +15). Read as each beacon's offset from her path at the beacon's OWN station - 300 m, where
// her path had not yet moved - the line was "300 m off" her there too, 80 m beyond where it is.
{
  const banks = [land(rect(-1200, -1600, -300, 4600)), land(rect(300, -1600, 1200, 4600))];
  const marks = [mark(100, 1000, RED, 2, "west light", true), mark(-150, 1500, GREEN, 3, "mid ledge"), mark(100, 2000, RED, 4, "east light", true)];
  const w = model({ polys: banks, marks }), r = lane(w, [{ e: -200, n: -1500 }, { e: -200, n: 4500 }]);
  const e15 = eAtN(r.track, 1500), berth = R.MARK_PORT_BERTH * PASS;
  check("72b. THE LINE BETWEEN TWO MARKS is measured in the plane, across her own cross-section: abeam of a green her "
        + "pass took her round, she is three quarters of the way from it to the beacons' line, a berth inside it",
        // the green at -150 (she passes 30 m east of it: -120); the beacons' line less a berth: +70; three quarters across: +22
        e15 != null && e15 > -10 && e15 < 45 && marks.filter((m) => m.fixed).every((m) => offOf(r.track, m) >= berth - 1)
          && offOf(r.track, marks[1]) < -berth + 1 && r.how.marks.wrong === 0 && legsClear(r, w),
        "e@1500 = " + f1(e15) + " (want about 15; the beacons' line less a berth: 70); beacons " + marks.filter((m) => m.fixed).map((m) => f1(offOf(r.track, m))).join(",")
          + " m to starboard");
}
// 72c. THE CONE AT A BANK: the reach of 69 with a pier 20 m wide run out from her starboard bank to e -40, across
// the lane's line (e +82.5), 60 m from her path. The lane is inside every starboard limit ahead and astern BY THE TIME
// SHE REACHES IT, eased at LANE_SLEW: she comes in toward her own path over some 450 m, rounds the pier's head outside
// its margin and goes out again (79 asks how far off). With the limits not eased along her route she held the lane to within 25 m of the pier and darted round
// its head - an 88 degree turn each side of it, 130 m across in 50 m along.
{
  const pier = land(rect(-40, 1490, 200, 1510));
  const w = model({ polys: REACH_BANKS.concat([pier]), marks: REACH_MARKS }), r = lane(w, REACH_UP);
  const ns = [1300, 1400, 1500, 1600, 1700], e = ns.map((n) => eAtN(r.track, n));
  check("72c. THE CONE AT A BANK: a pier from her starboard bank across the lane's line is eased round - inside its "
        + "limit by the time she reaches it, no dart round its head",
        // the pier's head is e -40: she is west of it at 1500, and already west of e 0 100 m either side
        e.every((x) => x != null) && e[2] < -43 && e[1] < 0 && e[3] < 0 && e[0] > e[1] && e[4] > e[3] && sharpest(r.track) < 45
          && r.how.reach === true && r.how.marks.wrong === 0 && legsClear(r, w),
        "e@" + ns.join(",") + " = " + e.map(f1).join(",") + " (the pier's head: -40; the lane's line: 82.5); sharpest turn "
          + f1(sharpest(r.track)) + " (not eased: 88)");
}
// 73. SIDE WATER IS NOT THE CHANNEL'S EDGE: the reach of 70 (green buoys, no beacons) with a basin in its east bank,
// 400 m long and 200 m deep (its back wall in reach of her cross-section: 500 m off, where the bank is 300). West of
// Seavey Island her starboard bank is the Back Channel's far shore, 330 m off, for 150 m of her route; read as the
// edge, it took the lane 200 m toward the shipyard's piers. What is judged is the WATER's width against its width
// along CHART_EDGE_WINDOW_M either way - not either bank's distance from her, which changes with every swing of her
// own path (71 and 72 are the worlds that showed it: the chord of a bend, and a buoy in mid-water).
{
  const greens = REACH_MARKS.filter((m) => !m.fixed);
  const banks = [REACH_BANKS[0], land(rect(200, -1600, 900, 1300)), land(rect(200, 1700, 900, 4600)), land(rect(400, 1300, 900, 1700))];
  const r = lane(model({ polys: banks, marks: greens }), REACH_UP), flat = lane(model({ polys: REACH_BANKS, marks: greens }), REACH_UP);
  const ns = [1100, 1300, 1500, 1700, 1900], e = ns.map((n) => eAtN(r.track, n)), e0 = ns.map((n) => eAtN(flat.track, n));
  check("73. SIDE WATER (a basin in her starboard bank) is not the channel's edge: the lane runs on past it where it "
        + "would with the bank unbroken",
        e.every((x, i) => x != null && Math.abs(x - e0[i]) < 12) && e0.every((x) => x > 40),
        "e@" + ns.join(",") + " = " + e.map(f1).join(",") + " (the bank unbroken: " + e0.map(f1).join(",") + ")");
}
// 73b. ... and a river that WIDENS a little is still the river: the same reach with its east bank 40 m further off
// for 400 m (a tenth of the water's width; an opening is CHART_OPENING_FRAC of it, or CHART_OPENING_M, and more).
// Three quarters of the way across the wider water is 30 m further to starboard, and she rides it.
{
  const greens = REACH_MARKS.filter((m) => !m.fixed);
  const banks = [REACH_BANKS[0], land(rect(200, -1600, 900, 1300)), land(rect(200, 1700, 900, 4600)), land(rect(240, 1300, 900, 1700))];
  const r = lane(model({ polys: banks, marks: greens }), REACH_UP), flat = lane(model({ polys: REACH_BANKS, marks: greens }), REACH_UP);
  const e = eAtN(r.track, 1500), e0 = eAtN(flat.track, 1500);
  check("73b. ... and water a little WIDER is the channel's own: where the bank stands 40 m further off for 400 m she "
        + "rides three quarters across the wider water",
        e != null && e - e0 > 20 && e - e0 < 35 && R.CHART_OPENING_FRAC === 0.15 && R.CHART_OPENING_M === 30 && legsClear(r, model({ polys: banks, marks: greens })),
        "e@1500 = " + f1(e) + " (the bank unbroken: " + f1(e0) + "; three quarters across the wider water: " + f1(e0 + 30) + ")");
}
// 74. THE CHART STILL COMES FIRST. The reach of 69 runs into a charted fairway hard by the west bank (e -150..-50,
// n 2600..4400), whose own three-quarter line (e -75) is 157 m to PORT of the reach's (+82). Inside it the line she
// rides is the chart's, to the meter what it is with no marks at all - from its first hundred meters - and she holds
// the reach's lane until she has to ease across to it.
{
  const fair = chan(rect(-150, 2600, -50, 4400), true);
  const marks = REACH_MARKS.filter((m) => m.n < 2600);
  const withM = lane(model({ polys: REACH_BANKS, marks, chans: [fair] }), REACH_UP);
  const noM = lane(model({ polys: REACH_BANKS, chans: [fair] }), REACH_UP);
  const ns = [2700, 2800, 3000, 3300, 3900, 4200], a = ns.map((n) => eAtN(withM.track, n)), c = ns.map((n) => eAtN(noM.track, n));
  const lo = minE(withM.track, 1000, 2000), lo2 = minE(withM.track, 2000, 2700);
  // (and the ease from the reach's line onto the chart's is one way: never back past the chart's line toward the search's path)
  let rises = 0, prev = Infinity;
  for (let n = 2000; n <= 2700; n += 10) { const e = eAtN(withM.track, n); if (e != null) { if (e > prev + 0.5) rises++; prev = e; } }
  check("74. THE CHART STILL COMES FIRST: in the charted fairway the reach runs into, she rides the chart's line - what "
        + "it is with no marks at all - and comes onto it without swinging back to the search's path",
        a.every((x, i) => x != null && Math.abs(x - c[i]) < 1.5) && Math.abs(a[2] + 75) < 6 && lo > 40 && lo2 >= -77 && rises === 0
          && withM.how.charted === true && withM.how.reach === true && legsClear(withM, model({ polys: REACH_BANKS, marks, chans: [fair] })),
        "e@" + ns.join(",") + " = " + a.map(f1).join(",") + " (with no marks: " + c.map(f1).join(",") + "; the chart's line: -75); "
          + "least e between n 1000 and 2000: " + f1(lo) + " (the reach's line: 82.5; the search's path: -100), and between 2000 and 2700, "
          + "where she eases across: " + f1(lo2) + (rises ? " - turning back " + rises + " times" : ", one way"));
}
// 75. ONLY EVER TO STARBOARD: the reach of 69 (greens only; three quarters across the water is e 105.7) with the
// search's path hard by the starboard bank (e 150) for its first half and on the far side (e -100) for its second.
// "As near to the outer limit ... on her starboard side as is safe and practicable" is not a line to be brought
// back to: where she is already to starboard of it nothing moves, and where she is to port of it she is moved to it.
{
  const w = model({ polys: REACH_BANKS, marks: REACH_MARKS.filter((m) => !m.fixed) });
  const r = lane(w, [{ e: 150, n: -1500 }, { e: 150, n: 1200 }, { e: -100, n: 1700 }, { e: -100, n: 4500 }]);
  const e = [600, 900].map((n) => eAtN(r.track, n)), e2 = eAtN(r.track, 2500);
  check("75. ONLY EVER TO STARBOARD: where her path is already to starboard of the three-quarter line it is left where it "
        + "is, and where it is to port of it she is moved to it",
        e.every((x) => x != null && Math.abs(x - 150) < 1) && e2 != null && Math.abs(e2 - 105.7) < 6 && r.how.reach === true && legsClear(r, w),
        "e@600,900 = " + e.map(f1).join(",") + " (the search's path there: 150); e@2500 = " + f1(e2) + " (the search's: -100; the line: 105.7)");
}
// 75b. ... and WATER TOO WIDE IS NO NARROW CHANNEL, whatever marks stand along it: the banks 1,000 m apart, green
// buoys 50 m off the west one - 933 m from the greens' line to the east bank's standoff, both in reach of her
// cross-section from mid-river (REACH_MAX_WIDTH_M is 800). She is left where the marks' own passes put her.
{
  const banks = [land(rect(-1500, -1600, -500, 4600)), land(rect(500, -1600, 1500, 4600))];
  const greens = [500, 1500, 2500].map((n, i) => mark(-450, n, GREEN, 1 + 2 * i, "wide " + i));
  const r = lane(model({ polys: banks, marks: greens }), [{ e: 0, n: -1500 }, { e: 0, n: 4500 }]);
  const e = [800, 1500, 2200].map((n) => eAtN(r.track, n));
  check("75b. WATER WIDER THAN REACH_MAX_WIDTH_M between its edges is no narrow channel: nothing is laned",
        e.every((x) => x != null && Math.abs(x) < 1) && !r.how.reach && R.REACH_MAX_WIDTH_M === 800 && R.REACH_EDGE_M === 600,
        "e = " + e.map(f1).join(",") + " (the search's path: 0); how.reach " + r.how.reach);
}
// 75c. A ROCK IS PASSED, NOT AN EDGE (Andy, 2026-10-05: "hold the lane and pass the rock wide. do not use a rock as
// an assumed buoy for path planning purposes. treat it as land that may be avoided to either side"). The reach of 69,
// and an islet 20 m across in the water short of its first mark, 45 m to starboard of the search's path - between
// that path and the lane's line. It is a ROCK (no bigger than ROCK_MAX_M, water all round it, no mark beside it): no
// edge of the channel. The lane eases out to its line as it does with no islet, and the islet is passed wide - at the
// lane's floor or more, on whichever side the lane is. (Read as the bank, the lane dipped to pass it on the side the
// search had: in mid-reach that swung her back toward a rock she would have left 146 m off.)
{
  const islet = land(rect(-55, 380, -35, 410));
  const w = model({ polys: REACH_BANKS.concat([islet]), marks: REACH_MARKS }), r = lane(w, REACH_UP);
  const off = (t) => { let m = Infinity; along(t, 1, (p) => { m = Math.min(m, Math.hypot(Math.max(-55 - p.e, 0, p.e + 35), Math.max(380 - p.n, 0, p.n - 410))); }); return m; };
  const eI = eAtN(r.track, 395), e15 = eAtN(r.track, 1500);
  check("75c. A ROCK IS PASSED, NOT AN EDGE: an islet with water all round it between the search's path and the lane's "
        + "line is passed wide, at the lane's floor or more, and the lane is taken up to its line",
        off(r.track) >= 60 && Math.abs(e15 - 82.5) < 6 && r.how.reach === true && r.how.marks.wrong === 0
          && legsClear(r, w) && sharpest(r.track) < 25 && R.ROCK_MAX_M === 150,
        "she passes the islet " + f1(off(r.track)) + " m off (abeam of it at e " + f1(eI) + "; the islet e -55..-35; read as the edge she "
          + "dipped back to her path, 42.7 m off); e@1500 = " + f1(e15)
          + " (the reach's line: 82.5); sharpest turn " + f1(sharpest(r.track)));
}
// 76. BUOY TO BUOY (Andy, 2026-10-04, of red nun 4 off Fox Point: "The red buoy N4 seems to have been ignored. The ASV
// should have routed to the left of it so that its on the right as the ASV passes"). The Piscataqua's marks as
// charted (30), at the DriX's 5 m buffer. Her run round Fox Point Rock Buoy 3 was laid along the SEARCH's track - due
// south, across The Rocks - and the east side of The Rocks Buoy 4 was a 51 degree turn from its last point; the pass
// was refused, the red counted on her wrong hand and said. It is laid again aimed at the buoy's own pass point; and a
// pass that cannot be joined is asked again once the next has been placed (4's way on was still the search's, 52
// degrees back toward it, until Little Bay Buoy 4A had been given its own).
{
  const pt = (e, n, CATLAM, OBJNAM) => { const q = ll(e, n);
    return { role: "chan_mark", cls: "Buoy_Lateral_point", props: { CATLAM, OBJNAM }, geometry: { type: "Point", coordinates: [q.lon, q.lat] } }; };
  const ko = K.buildKeepouts(F, [pt(-3387, -9, 1, "Hen Island Ledge Buoy 1"), pt(-3985, -6, 2, "Eight-Foot Rock Buoy 2"),
    pt(-4103, -183, 1, "Fox Point Rock Buoy 3"), pt(-3819, -712, 2, "The Rocks Buoy 4"), pt(-3653, -1376, 2, "Little Bay Buoy 4A"),
    pt(-4376, -4229, 2, "Great Bay Entrance Buoy 6")], {});
  // ⚠ THE WATER AS CHARTED, AND THE PATH AS THE PLANNER HAD IT. In open water, on the search's bare path (30), every
  // tree passes this - the code of 2026-10-04 too. What refused the pass on his chart was the rocks the marks are
  // there for (three charted with a 50 m extent: Eight-Foot Rock, Hen Island Ledge and The Rocks' own, and the
  // sounding-proven ones) and the 40 m jog the banks' lane makes between two of them, which is what her track
  // "past buoy 3" then was. These are theirs, and the path the marks stage was handed at his 5 m buffer.
  for (const [e, n, r] of [[-3947.2, -1037.2, 0], [-3803.5, -1250.6, 0], [-3856.4, -1232.0, 0], [-3708.7, -1439.8, 0], [-3673.5, -1447.3, 0],
                           [-3998.7, -1024.2, 0], [-4035.5, 18.0, 50], [-3368.0, -33.1, 50], [-4071.2, -737.5, 50], [-3897.9, -712.9, 50],
                           [-4096.1, -659.6, 50], [-3918.2, 294.1, 50], [-3724.8, 360.0, 50]]) ko.points.push({ e, n, r, kind: "a charted hazard" });
  const PATH = [[-1231, -488], [-2804.2, -95.8], [-3313.5, 31.6], [-3343.8, 78.3], [-3382.8, 38.5], [-3416.7, 31.4], [-3906.0, -158.9],
                [-3917.6, -190.4], [-3967.9, -642.7], [-4012.0, -674.9], [-4007.8, -711.7], [-4002.6, -747.0], [-3973.5, -782.4],
                [-3987.3, -1657.3], [-4013, -3399]].map(([e, n]) => ({ e, n }));
  const by = (re) => ko.marks.find((m) => re.test(m.sys));
  const m3 = by(/fox/), m4 = by(/rocks/), m4a = by(/little bay/);
  const r = lane(ko, PATH, {}, 5), pass5 = R.MARK_PASS_M(5, 0);
  const o3 = offOf(r.track, m3), o4 = offOf(r.track, m4), o4a = offOf(r.track, m4a);
  check("76. BUOY TO BUOY, at the DriX's 5 m buffer: round Fox Point Rock Buoy 3 leaving it to port, then EAST of The "
        + "Rocks Buoy 4 and Little Bay Buoy 4A, each close to starboard - none on the wrong hand, no turn over 60 degrees",
        o3 < -pass5 + 0.5 && Math.abs(o4 - pass5) < 2 && Math.abs(o4a - pass5) < 2 && r.how.marks.wrong === 0
          && offOf(PATH, m4) < -100 && sharpest(r.track) < 60 && legsClear(r, ko),
        "3: " + f1(o3) + ", 4: " + f1(o4) + ", 4A: " + f1(o4a) + " m (+ = to starboard; the search's path had 4 at "
          + f1(offOf(PATH, m4)) + "); " + JSON.stringify(r.how.marks) + "; sharpest turn " + f1(sharpest(r.track)));
  // 76b. ... and bound OUT of Little Bay over the same water: Fox Point Rock Buoy 3 is the one passed close to
  // starboard, on an arc - and the samples either side of the one abeam of it point their starboard hands AT the buoy.
  // The pass points of a run past a mark she keeps to starboard are not moved (HOLD): moved 12 m each, as the cone
  // allows, they cut the corner, the buoy came inside its pass distance (6.0 m on his chart at a 3 m buffer, 6.7 m on
  // her wrong hand at first) and the route that ships was better off with no lane at all.
  const out = lane(ko, PATH.slice().reverse(), {}, 5);
  const q3 = offOf(out.track, m3), q4 = offOf(out.track, m4), q4a = offOf(out.track, m4a);
  check("76b. ... and bound OUT round Fox Point: Rock Buoy 3 close to starboard on its arc, the reds left to port, and "
        + "the buoyed reach still ridden (a run's pass points are held where they were laid)",
        Math.abs(q3 - pass5) < 2 && q4 < -pass5 && q4a < -pass5 && out.how.marks.wrong === 0 && out.how.reach === true
          && sharpest(out.track) < 60 && legsClear(out, ko),
        "3: " + f1(q3) + ", 4: " + f1(q4) + ", 4A: " + f1(q4a) + " m (+ = to starboard); how.reach " + out.how.reach + "; "
          + JSON.stringify(out.how.marks) + "; sharpest turn " + f1(sharpest(out.track)));
}
// 78. A CLOSE MARK WITH NO RUN IS HELD. A seeded world of the marks' acceptance fuzz (9107, bound up, in a 19.5 m set):
// red buoy 6 stands some 5 m to starboard of her path with a shoal just beyond it, and its own pass cannot be joined - so
// it has no run, and no kept vertex. The lane's ease-in began 25 m short of it, the smoothing rounded the foot of that
// ease 8 m to starboard, and the buoy shipped 3.5 m on her WRONG hand, where the route without the lane has it right.
// Nothing is moved within two smoothing steps of a mark kept to starboard that has no run and stands that close, and
// the lane is KEPT (asked here). (The route that ships is also asked what the route without the lane would have -
// channelLaneRoute's `finish` - and with no such hold the lane is dropped there instead: a backstop no other world
// has reached. 89 is the same question asked again where the planner re-gates the route at the standoff.)
{
  const M = [[-312.3,461.3,-1,3,0],[62.6,741.1,1,4,0],[-39,1368,-1,5,0],[255.1,1343.7,1,6,0],[401.4,1903.3,1,8,0],[669.9,2459.7,-1,9,0],
             [980.5,2419.7,1,10,0],[1099.3,2780.2,-1,11,1],[1648.7,2658.5,1,12,0],[2283.9,2804.3,-1,13,0],[2372.6,2454.2,1,14,0],[2841.9,2102.7,-1,15,1]];
  const PL = [[0,[[71.1,701.7],[123.3,673.8],[152.3,727.9],[100.1,755.9]]],[0,[[-176.1,1360.8],[-71.1,1350.3],[-66.9,1391.7],[-172,1402.3]]],
              [0,[[284.4,1297.1],[388,1286.7],[396.7,1373.2],[293.1,1383.6]]],[0,[[368,1844.6],[446.8,1755.8],[542.6,1840.7],[463.7,1929.6]]],
              [1,[[1030.9,2830.8],[1059.9,2782.1],[1116.5,2815.8],[1087.5,2864.5]]],[1,[[2292.7,2905.8],[2261.9,2851.8],[2335.9,2809.6],[2366.7,2863.6]]],
              [0,[[2321.5,2488.5],[2245.6,2446.5],[2298.6,2350.7],[2374.5,2392.7]]],[1,[[2847.2,2187.4],[2814.4,2162.7],[2891.9,2059.7],[2924.6,2084.4]]]];
  const ROUTED = [[0,0],[-71.6,96.6],[-55,249.8],[40.9,304.3],[28.9,424.5],[-118.4,547.1],[-250.4,719.4],[-291.1,877.3],[-218.1,974.3],[-40.4,1015.3],
                  [175.7,1035.6],[328.6,1178.8],[250.1,1338.6],[231.3,1429.8],[63.4,1567.3],[-43.6,1769.7],[-12.4,1887.5],[136.1,1950.8],[361,1949.7],
                  [489.1,1933.4],[551.1,1916.4],[668.2,1965.3],[699,2116.1],[668.9,2325.2],[647.3,2525],[694.3,2650.9],[871.4,2686.1],[1060.1,2603.9],
                  [1249.8,2519.8],[1393.3,2513.4],[1468.3,2621.8],[1487.5,2762.5],[1611.9,2934.8],[1734.4,3028],[1864.2,2988.9],[1972.3,2832.2],
                  [2077.9,2644.1],[2077.1,2507.1],[2189.1,2461.2],[2360.4,2519.4],[2558.4,2547.3],[2728.2,2504.1],[2790.1,2401.2],[2742.2,2237.5],
                  [2648.1,2036.9],[2607.5,1856.2],[2686.7,1765.7],[2863,1748.1],[3003.8,1703.8]].map(([e, n]) => ({ e, n }));
  const marks = M.map(([e, n, side, num, fixed], i) => mark(e, n, side, num, "rock 9107 " + num + (i % 7), !!fixed));
  const polys = PL.map(([isLand, ring]) => land(ring.map(([e, n]) => ({ e, n })), isLand ? "land" : "a shoal"));
  const w = model({ marks, polys, points: marks.map((m) => ({ e: m.e, n: m.n, r: 0, kind: "a channel buoy" })) });
  const r = lane(w, ROUTED, { standoffM: 19.5 }), r6 = marks[3];
  const before = offOf(ROUTED, r6), after = offOf(r.track, r6);
  // every mark the routed path has on its proper hand (she is bound up: reds to starboard) is still on it
  const lost = marks.filter((m) => (m.side > 0 ? offOf(ROUTED, m) >= 1 : offOf(ROUTED, m) <= -1) && !(m.side > 0 ? offOf(r.track, m) >= 1 : offOf(r.track, m) <= -1));
  check("78. A CLOSE MARK WITH NO RUN IS HELD: a red 5.9 m off her path with no run of its own is not eased past - no mark "
        + "the routed path has on its proper hand ships on the wrong one, no leg is foul, and the lane is still ridden",
        before > 1 && after >= 1 && lost.length === 0 && legsClear(r, w) && r.how.reach === true,
        "red 6 lay " + f1(before) + " m to starboard of the routed path and ships " + f1(after) + " (it shipped -3.5); marks lost: "
          + lost.length + "; how.reach " + r.how.reach);
}
// ── 79-93. THE REVIEW OF THE BUOYED REACH (2026-10-05) ────────────────────────────────────────────────────────────
// Four lenses read the reach lane and the buoy-to-buoy re-aim before they were committed, and reproduced what they
// reported. Each check here is one of those reproductions, and fails on the code that was reviewed.
const distRect = (p, e0, n0, e1, n1) => Math.hypot(Math.max(e0 - p.e, 0, p.e - e1), Math.max(n0 - p.n, 0, p.n - n1));
const nearestTo = (track, fn) => { let m = Infinity; along(track, 1, (p) => { m = Math.min(m, fn(p)); }); return m; };
const REACH_LIMIT = BUF + Math.max(BUF + 2, 6);    // the lane's own limit off a keep-out: clr + STANDOFF (9 m at this buffer)
const hazard = (e, n, r) => ({ e, n, r: r || 0, kind: "a charted hazard" });
// 79. A LIMIT READ AT ONE SAMPLE HOLDS OVER THE SMOOTHING. The pier of 72c is a notch one sample wide in her starboard
// bank; the cone closed on it as a V whose point was that sample, and the smoothing that follows cut the point off.
// The route shipped 3.5 m off the pier's head in 72c's own world - at the BUFFER, not at the lane's limit - and 3.0 to
// 8.0 m as the pier slid along the bank, the gate splicing six times in eleven, turns to 57 degrees. (72c asked only
// where she was at one northing, at one alignment.)
{
  const rows = [];
  for (let s = 1480; s <= 1504; s += 4) {
    const w = model({ polys: REACH_BANKS.concat([land(rect(-40, s, 200, s + 20))]), marks: REACH_MARKS }), r = lane(w, REACH_UP);
    rows.push({ s, off: nearestTo(r.track, (p) => distRect(p, -40, s, 200, s + 20)), turn: sharpest(r.track),
                ok: r.how.reach === true && r.how.gaps === false && legsClear(r, w) });
  }
  check("79. A LIMIT READ AT ONE SAMPLE HOLDS OVER THE SMOOTHING: wherever the pier of 72c stands among her samples it is "
        + "rounded no nearer than the lane's own limit (clr + STANDOFF), with no turn over 25 degrees and no splice",
        rows.every((q) => q.off >= REACH_LIMIT - 0.5 && q.turn < 25 && q.ok),
        "south face at n " + rows.map((q) => q.s).join(",") + ": " + rows.map((q) => f1(q.off)).join(",") + " m off it (the limit: "
          + REACH_LIMIT + "; the search: 60; it shipped 3.0 to 8.0); sharpest turn " + rows.map((q) => f1(q.turn)).join(","));
}
// 80. WHAT STANDS BETWEEN TWO RAYS IS SEEN. The banks are read along one ray a sample, 25 m apart, each seeing its own
// margin either side: 75c's islet made 14 m long, a charted rock with no extent, a charted line, a small restricted
// area, stands between two of them unseen - and was passed 3 m off, or round its far side. The rocks among them (the
// islet, the rock: small, natural, water all round) are passed wide, at the lane's floor or more, on either side
// (75c); the charted line (a boom, a cable: built) and a bridge support are the bank, and like the restricted area -
// a limit, not a rock - are passed on the side the search passed them.
{
  const pass = (world) => { const r = lane(world, REACH_UP); return { r, e: [375, 388, 400].map((n) => eAtN(r.track, n)), e15: eAtN(r.track, 1500) }; };
  const islet = pass(model({ polys: REACH_BANKS.concat([land(rect(-55, 381, -35, 395))]), marks: REACH_MARKS }));
  const rock = pass(model({ polys: REACH_BANKS, marks: REACH_MARKS, points: [hazard(-45, 387.5)] }));
  const boom = [{ e: -55, n: 383 }, { e: -35, n: 393 }];             // (a charted line: a boom, a cable)
  const line = pass(Object.assign(model({ polys: REACH_BANKS, marks: REACH_MARKS }), { lines: [{ pts: boom, bb: bbOf(boom), kind: "a charted line" }] }));
  const zone = pass(model({ polys: REACH_BANKS, marks: REACH_MARKS, restricted: [restr(rect(-55, 381, -35, 395))] }));
  const built = pass(model({ polys: REACH_BANKS, marks: REACH_MARKS, points: [{ e: -45, n: 387.5, r: 0, kind: "a bridge support" }] }));
  const offBox = (q) => nearestTo(q.r.track, (p) => distRect(p, -55, 381, -35, 395));
  const rockFloor = BUF + Math.max(BUF + 2, 6);
  check("80. WHAT STANDS BETWEEN TWO RAYS IS SEEN: 75c's islet made 14 m long and a charted rock with no extent, between two "
        + "of her cross-sections, are rocks, passed wide (either side, the lane's floor or more); a charted line 22 m long "
        + "and a bridge support there are the bank, and a local restricted area 20 m across a limit - each passed on the "
        + "side the search passed it; and the lane is taken up beyond each",
        [islet, rock].every((q) => offBox(q) >= rockFloor - 0.5 && Math.abs(q.e15 - 82.5) < 6 && q.r.how.reach === true
          && q.r.how.marks.wrong === 0 && sharpest(q.r.track) < 25)
          && [line, built, zone].every((q) => q.e.every((x) => x != null && x < -65) && Math.abs(q.e15 - 82.5) < 6 && q.r.how.reach === true
            && q.r.how.marks.wrong === 0),
        "the islet, the rock passed " + [islet, rock].map((q) => f1(offBox(q))).join(", ") + " m off (the floor " + rockFloor
          + "; they were passed 3 m off); beside the line, the bridge support, the restricted area she is at e "
          + [line, built, zone].map((q) => q.e.map(f1).join(",")).join(" | ") + " (they stand at e -55..-35; unseen, she was taken round "
          + "their far side, e +53); e@1500 = " + [islet, rock, line, built, zone].map((q) => f1(q.e15)).join(", "));
  // ... and a rock 10 m to starboard of her path under the lane's ease-in, wherever it stands along it: passed at the
  // floor or more on whichever side, with no dart round it.
  const ns = [62.5, 87.5, 112.5, 137.5];
  const by = ns.map((n) => { const w = model({ polys: REACH_BANKS, marks: REACH_MARKS, points: [hazard(-90, n)] }), r = lane(w, REACH_UP);
    return { off: nearestTo(r.track, (p) => Math.hypot(p.e + 90, p.n - n)), e: eAtN(r.track, n), turn: sharpest(r.track), e15: eAtN(r.track, 1500) }; });
  check("80b. ... and a rock 10 m off her path where the lane eases in is passed at the lane's floor or more, on either "
        + "side, with no dart round it, and the lane taken up beyond",
        by.every((q) => q.off >= rockFloor - 0.5 && q.turn < 25 && Math.abs(q.e15 - 82.5) < 6),
        "the rock (e -90) at n " + ns.join(", ") + ": she is at e " + by.map((q) => f1(q.e)).join(", ") + ", " + by.map((q) => f1(q.off)).join(", ")
          + " m off it (the floor " + rockFloor + "; with the ray read alone, 4.8 to 5.6 m off); sharpest " + by.map((q) => f1(q.turn)).join(", "));
}
// 80c. ... AND WHAT STANDS BEYOND THE EASE DOES NOT STOP IT. Held past a reach's end the lane is no further off her path
// than the ease leaves it there: an islet 160 m to starboard of her path 400 m short of the reach, where the ease has
// brought her 50 m out, is 110 m clear of her and the ease goes on. (Asked whether the water was open as far as the
// lane's line itself, the hold stopped at the islet and the lane came up 385 m late: in Little Bay, 120 m short of
// its line for a kilometer, for four charted rocks 180 m off the foot of its ease.)
{
  const w = model({ polys: REACH_BANKS.concat([land(rect(60, 100, 80, 130))]), marks: REACH_MARKS }), r = lane(w, REACH_UP);
  const open = lane(model({ polys: REACH_BANKS, marks: REACH_MARKS }), REACH_UP);
  const ns = [300, 500, 700], e = ns.map((n) => eAtN(r.track, n)), e0 = ns.map((n) => eAtN(open.track, n));
  check("80c. ... and what stands beyond the eased lane does not stop the ease: with an islet 160 m to starboard of her "
        + "path 400 m short of the reach, the lane comes up where it does with no islet",
        e.every((x, i) => x != null && Math.abs(x - e0[i]) < 3) && e0[1] > 60 && legsClear(r, w),
        "e@" + ns.join(",") + " = " + e.map(f1).join(",") + " (with no islet: " + e0.map(f1).join(",") + "; her path: -100; the islet: e 60..80)");
}
// 80d. ... AND IN MID-REACH SHE HOLDS HER LANE AND PASSES IT WIDE (Andy, 2026-10-05: "hold the lane and pass the rock
// wide"). A charted rock with an 8 m extent in the middle of the reach, 90 m to starboard of her path, 92 m to port
// of the lane's line: read as the channel's edge, the lane came in to e -35 to pass it 17 m off; now she holds e +82.5
// and passes it 84 m off its extent.
{
  const rock = hazard(-10, 1262.5, 8);
  const w = model({ polys: REACH_BANKS, marks: REACH_MARKS, points: [rock] }), r = lane(w, REACH_UP);
  const off = nearestTo(r.track, (p) => Math.hypot(p.e - rock.e, p.n - rock.n)) - rock.r, e = eAtN(r.track, 1262.5);
  check("80d. ... and in mid-reach she HOLDS HER LANE: a rock with an 8 m extent 92 m to port of the lane's line is passed "
        + "wide, on the lane's line, off its extent",
        off >= 80 && e != null && Math.abs(e - 82.5) < 2 && r.how.reach === true && sharpest(r.track) < 25 && legsClear(r, w),
        "she passes " + f1(off) + " m off its extent, at e " + f1(e) + " abeam of it (the lane's line: 82.5; the rock: e -10, r 8; read as an edge: e -35, 17 m off); sharpest turn "
          + f1(sharpest(r.track)));
}
// 80e. ... BUT WHAT IS BUILT IS THE BANK, AND THE BANK IS READ BETWEEN TWO RAYS: a bridge support 10 m to starboard of
// her path where the lane eases in, wherever it stands along the ease, is neither rounded on its far side nor closed
// on - and (80f) one with an 8 m extent across the lane's line in mid-reach is stood off by its extent, the lane coming
// in that far for it and no further. (80b and 80d as they were before a rock was a shallow point: with every hazard
// in them a rock, nothing in any check stood between two rays for the bank to read, and its reading went untested.)
{
  const support = (e, n, r) => ({ e, n, r: r || 0, kind: "a bridge support" });
  const ns = [62.5, 87.5, 112.5, 137.5];
  const by = ns.map((n) => { const w = model({ polys: REACH_BANKS, marks: REACH_MARKS, points: [support(-90, n)] }), t = lane(w, REACH_UP).track;
    return { off: nearestTo(t, (p) => Math.hypot(p.e + 90, p.n - n)), e: eAtN(t, n) }; });
  check("80e. ... BUT A BRIDGE SUPPORT 10 m off her path where the lane eases in is the bank: neither rounded on its far "
        + "side nor closed on (the ease begins a smoothing step clear of it)",
        by.every((q) => q.off >= REACH_LIMIT && q.e != null && q.e < -95),
        "the support (e -90) at n " + ns.join(", ") + ": she is at e " + by.map((q) => f1(q.e)).join(", ") + ", " + by.map((q) => f1(q.off)).join(", ")
          + " m off it (the limit " + REACH_LIMIT + "; with the ray read alone, 4.8 to 5.6 m off; unseen between the rays, round its far side)");
  const sup = support(-10, 1262.5, 8), w = model({ polys: REACH_BANKS, marks: REACH_MARKS, points: [sup] }), r = lane(w, REACH_UP);
  const off = nearestTo(r.track, (p) => Math.hypot(p.e - sup.e, p.n - sup.n)) - sup.r, e = eAtN(r.track, 1262.5);
  check("80f. ... AND ITS OWN EXTENT is what she stands off: a bridge support with an 8 m extent between two rays, across "
        + "the lane's line, is passed the lane's limit off its extent - and the lane comes in no further than that",
        off >= 13 && e != null && e > -40 && e < -31 && r.how.reach === true && sharpest(r.track) < 25 && legsClear(r, w),
        "she passes " + f1(off) + " m off its extent (the limit: " + REACH_LIMIT + "), at e " + f1(e) + " abeam of it (the support: e -10, "
          + "r 8; its extent not counted, 9.5 m off at e -27.5); sharpest turn " + f1(sharpest(r.track)));
}
// 80g. ... AND WHAT IS BUILT BEYOND THE EASE STOPS IT NO MORE THAN 80c's ISLET: a dolphin (a pier head standing alone,
// the bank) 160 m to starboard of her path 400 m short of the reach, where the ease has brought her 50 m out. The hold
// asks whether the water is open as far as the EASED lane, not as far as the lane's own line (asked that, the lane came
// up 385 m late in Little Bay). 80c's islet is a rock now, which the hold does not ask about at all - so it is asked here
// of what the hold still reads.
{
  const w = model({ polys: REACH_BANKS.concat([land(rect(60, 100, 80, 130), "a dock / pier")]), marks: REACH_MARKS }), r = lane(w, REACH_UP);
  const open = lane(model({ polys: REACH_BANKS, marks: REACH_MARKS }), REACH_UP);
  const ns = [300, 500, 700], e = ns.map((n) => eAtN(r.track, n)), e0 = ns.map((n) => eAtN(open.track, n));
  check("80g. ... and a dolphin beyond the eased lane does not stop the ease either: with one 160 m to starboard of her path "
        + "400 m short of the reach, the lane comes up where it does with nothing there",
        e.every((x, i) => x != null && Math.abs(x - e0[i]) < 3) && e0[1] > 60 && legsClear(r, w),
        "e@" + ns.join(",") + " = " + e.map(f1).join(",") + " (with nothing there: " + e0.map(f1).join(",") + "; her path: -100; the dolphin: e 60..80; "
          + "asked of the lane's line, -65, 5, 71)");
}
// 81. EVERY MARK ON THE CHART, HAND READ OR NOT. A mark with no number in its name, or a junction mark, has no hand for
// the marks stage to keep - and was left out of the lane's cone and of the count with it. In the reach of 69 an
// unnumbered red buoy 140 m to starboard of her path in mid-water was shipped 42.5 m to PORT: nothing counted,
// nothing said, "right of center in the buoyed channel" on the banner.
{
  const run = (m) => { const w = model({ polys: REACH_BANKS, marks: REACH_MARKS.concat([m]) }), r = lane(w, REACH_UP); return { r, w, x: offOf(r.track, m) }; };
  const nameless = run(mark(40, 1250, RED, null, "mid rock")), junction = run(Object.assign(mark(40, 1250, RED, 3, "mid rock"), { junction: true }));
  const berth = R.MARK_PORT_BERTH * PASS;
  check("81. EVERY MARK ON THE CHART, hand read or not: an unnumbered red buoy in mid-water, and a junction buoy, stay on "
        + "the hand of her they were on - a mark's berth off - and the reach is still ridden",
        [nameless, junction].every((q) => q.x >= berth - 2 && q.r.how.reach === true && q.r.how.marks.wrong === 0 && legsClear(q.r, q.w)),
        "the unnumbered buoy lies " + f1(nameless.x) + " m to starboard of the route that ships, the junction buoy " + f1(junction.x)
          + " (of her path: 140; a berth: " + berth + "; they shipped 42.5 m to PORT)");
}
// 82. A RESTRICTED AREA: WHERE SHE IS, NOT WHETHER SHE EVER IS. An area was excused WHOLE wherever one sample of her
// path stood inside it: the area of check 70 with a spur 20 m wide reaching 1 m past her path was no limit anywhere,
// and the lane rode 1,460 m of route through the rest of it, 105 m deep. Now an area bounds her wherever she is
// outside it; and inside one she is moved only toward its nearer edge - out of it where that is to starboard, and
// not at all where the lane would take her further in.
{
  const greens = REACH_MARKS.filter((m) => !m.fixed);
  const inside = (track, ring, a, c) => { let k = 0; along(track, 5, (p) => { if (p.n >= a && p.n <= c && pinRing(p, ring)) k++; }); return k * 5; };
  const spur = restr([{ e: -101, n: 790 }, { e: 0, n: 790 }, { e: 0, n: 800 }, { e: 200, n: 800 }, { e: 200, n: 2200 }, { e: 0, n: 2200 },
                      { e: 0, n: 810 }, { e: -101, n: 810 }]);
  const a = lane(model({ polys: REACH_BANKS, marks: greens, restricted: [spur] }), REACH_UP);
  let hi = -Infinity;
  along(a.track, 5, (p) => { if (p.n >= 1000 && p.n <= 2000) hi = Math.max(hi, p.e); });
  check("82. A LOCAL RESTRICTED AREA HER PATH ONLY CLIPS is still the channel's edge everywhere she is outside it: with a "
        + "spur of it reaching 1 m past her path, she rides outside the rest of it as she does with no spur",
        hi < 0 && hi > -75 && inside(a.track, spur.ring, 1000, 2000) === 0 && a.how.reach === true,
        "e over n 1000-2000 reaches " + f1(hi) + " (the area's edge: 0; she rode at +105.7, 1,460 m of route inside it)");
  // (b) her path swings 10 m into the area's corner and back: in it there, with the rest of it to STARBOARD
  const body = restr(rect(0, 800, 200, 2200));
  const swing = [{ e: -100, n: -1500 }, { e: -100, n: 600 }, { e: 10, n: 820 }, { e: -100, n: 1040 }, { e: -100, n: 4500 }];
  const wb = model({ polys: REACH_BANKS, marks: greens, restricted: [body] });
  const b = lane(wb, swing), b0 = lane(wb, swing, { marks: false });
  const bin = inside(b.track, body.ring, 0, 5000), bin0 = inside(b0.track, body.ring, 0, 5000);
  // (c) the area on her PORT hand, its edge 10 m to starboard of her path for 1,400 m: the lane takes her out of it
  const west = restr(rect(-400, 800, -90, 2200));
  const wc = model({ polys: REACH_BANKS, marks: greens, restricted: [west] });
  const cin = inside(lane(wc, REACH_UP).track, west.ring, 1000, 2000), cin0 = inside(lane(wc, REACH_UP, { marks: false }).track, west.ring, 1000, 2000);
  // (d) her path runs 10 m inside the area's PORT-side edge for 1,400 m, the rest of it to starboard: she is not moved
  const east = restr(rect(-110, 800, 200, 2200));
  const d = lane(model({ polys: REACH_BANKS, marks: greens, restricted: [east] }), REACH_UP);
  const ed = [1200, 1500, 1800].map((n) => eAtN(d.track, n));
  check("82b. ... and INSIDE one she is moved only toward its nearer edge: no further in where the rest of it lies to "
        + "starboard (a clipped corner; 1,400 m run just inside its port-side edge), and out of it where its edge is "
        + "10 m to starboard of her",
        bin <= bin0 + 5 && b.how.reach === true && cin === 0 && cin0 >= 1000 && ed.every((x) => x != null && Math.abs(x + 100) < 1),
        "the corner clipped: " + bin + " m of route inside with the lane, " + bin0 + " without; run along inside its port edge: e = "
          + ed.map(f1).join(",") + " (her path: -100; three quarters across the water: +105); the area to port: " + cin
          + " m inside with the lane, " + cin0 + " without");
}
// 82c. ... AND ONE AREA CUT AT THE CHART'S CELL SEAMS IS STILL ONE AREA. The chart service cuts a feature at each cell's
// edge: judged a ring at a time, 11 pieces of the Right Whale Critical Habitat (210 km2) passed as LOCAL. Two pieces
// of one named area, 0.6 km2 each and touching at a seam, are a 1.2 km2 area - regional - and bound no lane; two
// unnamed areas side by side are not joined.
{
  const ringLL = (g) => [g.concat([g[0]]).map((p) => { const q = ll(p.e, p.n); return [q.lon, q.lat]; })];
  const feat = (ring, OBJNAM) => ({ role: "restricted", cls: "Restricted_Area_area", props: { OBJNAM }, geometry: { type: "Polygon", coordinates: ringLL(ring) } });
  const named = K.buildKeepouts(F, [feat(rect(0, 0, 600, 1000), "Whale Habitat"), feat(rect(600, 0, 1200, 1000), "Whale Habitat")], {});
  const blank = K.buildKeepouts(F, [feat(rect(0, 0, 600, 1000), ""), feat(rect(600, 0, 1200, 1000), "")], {});
  check("82c. ONE AREA CUT AT A CELL SEAM IS STILL ONE AREA: two touching pieces of a named restricted area carry the area "
        + "of the whole (regional, no limit), and two unnamed ones side by side are not joined",
        named.restricted.length === 2 && named.restricted.every((c) => Math.abs(c.area - 1.2e6) < 2e4 && Math.abs(c.ringArea - 6e5) < 1e4)
          && named.restricted[0].area > R.RESTRICTED_LOCAL_M2 && blank.restricted.every((c) => Math.abs(c.area - 6e5) < 1e4),
        "named: " + named.restricted.map((c) => Math.round(c.area) + " (its own " + Math.round(c.ringArea) + ")").join(", ")
          + " m2; unnamed: " + blank.restricted.map((c) => Math.round(c.area)).join(", ") + " m2");
}
// 83. A CHANNEL HAS LENGTH, AND AN OBSTRUCTION IN WATER THAT IS NO CHANNEL IS NOT ITS EDGE. Whether there are two edges
// was asked a sample at a time. One rock abeam of her in the river of 75b - banks a kilometer apart, "nothing is
// laned" - gave ONE sample a cross-section, and 575 m of her route was swung 90 m toward the rock; an islet off an
// open shore the same; and two green buoys 40 m apart moved 1,250 m of route 200 m across the river and back.
{
  const wide = [land(rect(-1500, -1600, -500, 4600)), land(rect(500, -1600, 1500, 4600))];
  const g3 = [500, 1500, 2500].map((n, i) => mark(-450, n, GREEN, 1 + 2 * i, "wide " + i));
  const ns = [1100, 1300, 1500, 1700, 1900];
  const still = (r, e0) => ns.map((n) => eAtN(r.track, n)).every((x) => x != null && Math.abs(x - e0) < 1) && !r.how.reach;
  const rock = lane(model({ polys: wide, marks: g3, points: [hazard(300, 1500, 20)] }), [{ e: 0, n: -1500 }, { e: 0, n: 4500 }]);
  const greens = REACH_MARKS.filter((m) => !m.fixed);
  const islet = lane(model({ polys: [REACH_BANKS[0], land(rect(200, 1400, 260, 1600))], marks: greens }), REACH_UP);
  const pair = lane(model({ polys: REACH_BANKS, marks: [mark(-150, 1000, GREEN, 1, "twin a"), mark(-150, 1040, GREEN, 3, "twin b")] }), REACH_UP);
  check("83. AN OBSTRUCTION IS NOT A CHANNEL'S EDGE, AND A CHANNEL HAS LENGTH: a rock in the kilometer-wide river of 75b, an "
        + "islet off an open shore, and two buoys of a hand 40 m apart each lane nothing",
        still(rock, 0) && still(islet, -100) && still(pair, -100) && R.REACH_MIN_M === 150,
        "e@" + ns.join(",") + ": the rock " + ns.map((n) => f1(eAtN(rock.track, n))).join(",") + " (her path: 0; she was swung to 87); the islet "
          + ns.map((n) => f1(eAtN(islet.track, n))).join(",") + "; the two buoys " + ns.map((n) => f1(eAtN(pair.track, n))).join(",") + " (her path: -100)");
  // ... and a reach 200 m long in a river 700 m wide is a lane - no further off her path than it is long at LANE_SLEW
  const b700 = [land(rect(-900, -1600, -200, 4600)), land(rect(500, -1600, 1200, 4600))];
  const short = lane(model({ polys: b700, marks: [mark(-150, 1000, GREEN, 1, "twin a"), mark(-150, 1200, GREEN, 3, "twin b")] }), REACH_UP);
  let far = -Infinity;
  along(short.track, 5, (p) => { far = Math.max(far, p.e + 100); });
  check("83b. ... and a reach 200 m long is laned no further off her path than it is long at LANE_SLEW (three quarters "
        + "across that river is 355 m: a swing across it and back, not a lane)",
        short.how.reach === true && far > 40 && far < R.LANE_SLEW * 225 + 3,
        "she is moved up to " + f1(far) + " m to starboard (LANE_SLEW x the stretch's 225 m: " + f1(R.LANE_SLEW * 225) + ")");
}
// 84. A PORT-HAND MARK SHE IS ON THE WRONG SIDE OF IS NOT STEERED AT. A green buoy 40 m to STARBOARD of a route that
// begins too near it to be moved for: the port-hand marks' line through it lay on her starboard hand, the lane made
// that line the channel's port edge, and she was shipped 5.6 m off the buoy, close to starboard, turning round it.
// (A starboard-hand mark's line to port of her has always stood the lane down: "not this lane's to mend".)
{
  const g1 = mark(-60, 300, GREEN, 1, "first ledge");
  const w = model({ polys: REACH_BANKS, marks: [g1, mark(-150, 1000, GREEN, 3, "cast ledge"), mark(-150, 2000, GREEN, 5, "easy shoal")] });
  const r = lane(w, [{ e: -100, n: 100 }, { e: -100, n: 4500 }]), x = offOf(r.track, g1), e15 = eAtN(r.track, 1500);
  check("84. A PORT-HAND MARK SHE IS ON THE WRONG SIDE OF IS NOT STEERED AT: a green buoy 40 m to starboard of a route "
        + "that begins too near it stays where the search left it, and the reach beyond it is ridden",
        x > 38 && r.how.reach === true && e15 > 40 && legsClear(r, w),
        "the green lies " + f1(x) + " m to starboard of the route that ships (of her path: 40; it shipped 5.6); e@1500 = " + f1(e15));
}
// 85. BUOY TO BUOY RUNS ALONG HER ROUTE. The re-aim laid two passes aimed at each other and kept them if no mark went
// wrong and no join was over 45 degrees - and nothing asked whether the line between them runs along her route. A red
// buoy 400 m across the channel from a green beside her path: aimed at each other she crossed beam-on to the red (a leg
// 108 degrees off her route), ran back 106 m and shipped a route 400 m longer, every mark "kept".
{
  const marks = [mark(120, 500, RED, 2, "alpha rock"), mark(-150, 1000, GREEN, 3, "bravo ledge"), mark(200, 1500, RED, 4, "charlie shoal"),
                 mark(16, 2000, GREEN, 5, "delta point"), mark(400, 2004, RED, 6, "echo reef"), mark(-90, 2500, GREEN, 7, "foxtrot bar"),
                 mark(150, 3000, RED, 8, "golf spit")];
  const w = model({ marks, points: marks.map((m) => ({ e: m.e, n: m.n, r: 0, kind: "a channel buoy" })) });
  const r = lane(w, [{ e: 0, n: -1500 }, { e: 0, n: 4500 }]), t = r.track;
  let len = 0, steep = 0;
  for (let i = 1; i < t.length; i++) {
    const de = t[i].e - t[i - 1].e, dn = t[i].n - t[i - 1].n, L = Math.hypot(de, dn);
    len += L;
    if (L >= 5) steep = Math.max(steep, Math.abs(Math.atan2(de, dn) * 180 / Math.PI));
  }
  check("85. TWO MARKS ABEAM ACROSS THE CHANNEL ARE A GATE, NOT A COURSE: a red across from a green beside her path is "
        + "not gone across to - no leg more than 45 degrees off her route, no running back, every mark on its proper hand "
        + "(the courtesy rule and the along rule each hold it; 85b and 85c ask each alone)",
        steep < 45 && len < 6200 && r.how.marks.wrong === 0 && r.how.marks.kept === 7 && legsClear(r, w),
        "the route is " + f1(len) + " m (her path: 6000; it shipped 6493), its steepest leg " + f1(steep) + " degrees off north (108); "
          + JSON.stringify(r.how.marks));
}
// 85b, 85c. The re-aim's two rules apart, in the same water with red 6 moved. (b) ONLY FOR THE BREACH: red 6 on its
// proper hand 300 m off, a little along her route from green 5 - the close pass is a courtesy, and aimed buoy to buoy
// for it she went 69 degrees off her route and 200 m further. (c) ONLY ALONG HER ROUTE, even for the breach: red 6 on
// her WRONG hand, 200 m across the channel and 100 m on - the line to it is the gate's own; she is not sent across
// beam-on (85 degrees off her route) to put it right, and the plan says it is on its wrong hand.
{
  const world = (re, rn) => {
    const marks = [mark(120, 500, RED, 2, "alpha rock"), mark(-150, 1000, GREEN, 3, "bravo ledge"), mark(200, 1500, RED, 4, "charlie shoal"),
                   mark(16, 2000, GREEN, 5, "delta point"), mark(re, rn, RED, 6, "echo reef"), mark(-90, 2500, GREEN, 7, "foxtrot bar"),
                   mark(150, 3000, RED, 8, "golf spit")];
    return model({ marks, points: marks.map((m) => ({ e: m.e, n: m.n, r: 0, kind: "a channel buoy" })) });
  };
  const shape = (w) => {
    const r = lane(w, [{ e: 0, n: -1500 }, { e: 0, n: 4500 }]), t = r.track;
    let len = 0, steep = 0;
    for (let i = 1; i < t.length; i++) {
      const de = t[i].e - t[i - 1].e, dn = t[i].n - t[i - 1].n, L = Math.hypot(de, dn);
      len += L;
      if (L >= 5) steep = Math.max(steep, Math.abs(Math.atan2(de, dn) * 180 / Math.PI));
    }
    return { r, len, steep };
  };
  const courtesy = shape(world(300, 2150)), breach = shape(world(-200, 2100));
  check("85b. ... the re-aim is for the BREACH: a red on its proper hand 300 m off is not gone across to for a close pass",
        courtesy.steep < 30 && courtesy.len < 6100 && courtesy.r.how.marks.wrong === 0,
        "the route is " + f1(courtesy.len) + " m, its steepest leg " + f1(courtesy.steep) + " degrees off north (aimed buoy to buoy for the close pass: 6245 m, 69)");
  check("85c. ... and ALONG HER ROUTE even for the breach: a red on her wrong hand 200 m across the channel is not crossed "
        + "to beam-on - it is counted on its wrong hand, and said",
        breach.steep < 45 && breach.len < 6150 && breach.r.how.marks.wrong === 1 && breach.r.partial === true,
        "the route is " + f1(breach.len) + " m, its steepest leg " + f1(breach.steep) + " degrees off north (aimed at it: 6358 m, 85); "
          + JSON.stringify(breach.r.how.marks) + ", partial " + breach.r.partial);
}
// 86-88. Three seeded worlds of the marks reviewer's fuzz (open water but for 87; bound down the numbers).
const seeded = (seed, M, PL) => {
  const marks = M.map(([e, n, side, num, fixed], i) => mark(e, n, side, num, "rock " + seed + " " + num + (i % 7), !!fixed));
  const polys = (PL || []).map(([isLand, ring]) => land(ring.map(([e, n]) => ({ e, n })), isLand ? "land" : "a shoal"));
  return { marks, world: model({ marks, polys, points: PL ? marks.map((m) => ({ e: m.e, n: m.n, r: 0, kind: "a channel buoy" })) : [] }) };
};
const P2 = (a) => a.map(([e, n]) => ({ e, n }));
// 86. A PASS REFUSED "NO JOIN" IS ASKED AGAIN UNTIL A ROUND PLACES NOTHING. A phase went round its marks twice; a pass
// placed in the second round was followed by no retry, and red 14 was left 190 m on her wrong hand on a judgment made
// with five passes placed, where six stood at the end (seed 1484).
{
  const M = [[-64.5,700,-1,3,0],[45,910.3,1,4,0],[23.4,1601.7,-1,5,0],[330.6,2162.9,1,6,0],[241.9,2220.5,-1,7,0],
             [590.7,2643.6,1,8,0],[625.7,3021.5,-1,9,0],[840.8,3381.1,1,10,0],[883.2,3929.2,-1,11,0],
             [1030.9,4409.4,1,12,0],[938.6,4454.6,-1,13,0],[1102.9,5058.1,1,14,0]];
  const PATH = P2([[1354.9,6261.5],[1248,6167.9],[1145.8,6072.9],[1072.3,5969.5],[1079.7,5842.2],[1118.8,5702.6],
                [1171.4,5565.4],[1222.9,5428.6],[1264,5294.3],[1286.8,5164.7],[1298.4,5059],[1278.7,4940.6],
                [1230.9,4827],[1169.7,4732.1],[1088.5,4617.8],[996.4,4504.3],[902.9,4390.9],[818.2,4283.7],
                [745,4171.6],[695.5,4056.7],[673.7,3938.4],[686.6,3850.6],[700.6,3722.2],[734.8,3588.4],[781.7,3451],
                [832.1,3312.7],[871.4,3166.8],[891,3032],[889.6,2905],[862.5,2787.1],[808.4,2679.1],[705.2,2553.3],
                [590,2481.2],[461.6,2416.6],[328.2,2350.9],[205.5,2273.2],[94.7,2190.4],[3,2099.4],[-64.6,1997.9],
                [-113.5,1847.4],[-109.7,1722.5],[-82.6,1591.5],[-33.2,1446.5],[34,1315.9],[100,1185.5],[155.4,1056.5],
                [208.9,957.4],[236.2,837.2],[235.2,717.2],[205.6,597.5],[152.7,484.8],[74.2,362.4],[-0.6,240.1],
                [-25.7,119.3],[0,0]]);
  const s = seeded(1484, M), r = lane(s.world, PATH), r14 = s.marks.find((m) => m.num === 14);
  check("86. A PASS REFUSED 'NO JOIN' IS ASKED AGAIN ON A LATER ROUND: red 14 needs a third round of its phase, is left "
        + "to port, bound down, and no mark ships on its wrong hand (the phase goes round until a round places nothing, "
        + "MARK_STAGE_ROUNDS at most; no world yet needs more than three)",
        r.how.marks.wrong === 0 && offOf(r.track, r14) < 0 && R.MARK_STAGE_ROUNDS >= 3 && legsClear(r, s.world),
        JSON.stringify(r.how.marks) + "; red 14 lies " + f1(offOf(r.track, r14)) + " m to starboard (it shipped 189.9, with a phase of two rounds)");
}
// 87. ... AND A RE-AIM FOR A CLOSE PASS COST A MARK ITS DISTANCE. The re-aim re-lays a pass that was already placed,
// and what it is kept on is the watched marks' HAND: in a 19.5 m set the one kept for green 15's close pass left
// green 17 - placed at its 21.5 m, where the committed code ships it - at 17.7 m, inside the guard's standoff (seed
// 9173). The re-aim is for a mark on its wrong hand, and green 15 was not.
{
  const M = [[127.3,560.9,1,2,0],[-207.9,772.5,-1,3,0],[150.8,1061.5,1,4,0],[-84.5,1719.7,-1,5,0],[239,1627.5,1,6,0],
             [-86.7,1736.5,-1,7,0],[415,2038.8,1,8,1],[307.2,2642.3,-1,9,0],[714.8,2787.8,1,10,0],
             [359.1,3223.3,-1,11,0],[722.1,3404.8,1,12,0],[383.4,3459.5,-1,13,0],[807.2,3619.2,1,14,1],
             [514.2,3964.5,-1,15,0],[863.5,3906.7,1,16,0],[532.2,4313.8,-1,17,0],[535.5,5195.5,-1,19,0],
             [891.7,5233.4,1,20,1],[485.6,5655.5,-1,21,0],[822.8,6178.9,1,22,0]];
  const PL = [[1,[[-349.6,695.8],[-241.1,698.3],[-244.5,845],[-353,842.5]]],[0,[[158.3,1038.1],[255.9,1023.8],
              [262.2,1067.4],[164.7,1081.7]]],[1,[[-232.5,1692.5],[-131.7,1660.5],[-88.8,1795.2],[-189.6,1827.3]]],
              [0,[[257.1,1566.7],[333.4,1542.4],[365.2,1642.4],[288.9,1666.7]]],[1,[[421.9,2013.6],[527.4,1957.6],
              [545.2,1991.2],[439.8,2047.2]]],[1,[[230.2,2640.6],[281.7,2625.5],[294.8,2670.2],[243.3,2685.3]]],
              [0,[[728.4,2738.4],[842.2,2705.1],[866.7,2788.7],[752.9,2822]]],[1,[[731.6,3336.6],[787.2,3331.4],
              [799.7,3465],[744.1,3470.2]]],[1,[[322.8,3438.5],[357.1,3435.3],[362,3488.2],[327.7,3491.4]]],
              [1,[[875.5,3870.2],[911.7,3863.7],[923.6,3930.4],[887.4,3936.9]]],[0,[[396.8,4249.1],[505,4247.7],
              [506.7,4380.5],[398.6,4381.9]]],[0,[[466.3,5145.2],[526.3,5148.9],[520.7,5240.6],[460.6,5236.9]]]];
  const PATH = P2([[638.1,6597.2],[674.9,6476.9],[739.7,6356.3],[793.3,6235.8],[815.3,6129.2],[825.3,6009.6],
                [816.6,5888.8],[790.9,5766.9],[751.5,5644.1],[703,5520.7],[651,5397.2],[601.6,5273.9],[560.5,5151.2],
                [533.8,5022],[527.9,4900.7],[540.6,4781.3],[571.7,4664],[606.5,4563.4],[653.5,4442.8],[708.8,4322],
                [766.8,4201.3],[819.7,4066],[845,3939.6],[856.8,3815.5],[843.9,3677.8],[809.2,3562.9],[756.7,3453],
                [703.5,3367.8],[642.7,3253],[574.2,3138.9],[503.9,3025],[437.6,2910.6],[368,2825.4],[304.1,2719.1],
                [256.8,2607.9],[229.4,2510.8],[205.3,2391],[200,2276.7],[188.8,2146.7],[183.8,2013.5],[188.1,1885.6],
                [203.6,1754.7],[209.3,1627],[225.1,1532],[222.4,1411.5],[200.9,1293.2],[158.3,1173.8],[100.6,1060.9],
                [31.5,949.8],[-30,839.3],[-86.2,718],[-136.9,596.8],[-174.7,471.9],[-178.3,351.6],[-124.6,234.1],
                [-59.5,117.2],[0,0]]);
  const s = seeded(9173, M, PL), r = lane(s.world, PATH, { standoffM: 19.5 }), g17 = s.marks.find((m) => m.num === 17);
  const D = R.MARK_PASS_M(BUF, 19.5), x = offOf(r.track, g17);
  check("87. ... and no re-aim for a close pass costs a mark its distance: in a 19.5 m set green 17 ships at its pass "
        + "distance, outside the standoff",
        x >= D - 0.5 && r.how.marks.wrong === 0,
        "green 17 lies " + f1(x) + " m to starboard (its distance: " + D + "; it shipped 17.7); " + JSON.stringify(r.how.marks));
}
// 88. NO TURN OVER THE STAGE'S OWN LIMIT THAT THE ROUTE WITHOUT THE LANE DOES NOT HAVE. A pass point the lane leaves
// where it is stays a vertex the smoothing may not round, and an ease that starts beside it adds its own turn to the
// run's: 35 degrees laid by the marks stage shipped as 54 at the pass point of a run past red 6, left to port, over
// MARK_JOIN_MAX_DEG. The route that ships is asked, and where the lane makes such a turn it is not kept: in seed 1113
// the lane is laid, and with the route not asked it shipped 56 degrees at the pass point of red 4. (The turn is the
// LANE'S where the route without it turns no less sharply nowhere near it, NEW_TURN_NEAR_M: compared as whole-route
// maxima, a 57 degree S-turn laid beside Seavey Island on a real search path shipped because the route without the
// lane turned 75 degrees 3.4 km away - the scratch probe over the cached real paths is what reaches that.)
{
  const M3 = [[-88.8,687.8,1,2,0],[-183.5,683.1,-1,3,0],[-269.8,1110.9,1,4,0],[-362.3,1120.2,-1,5,0],
             [-574.4,1731,1,6,0],[-986.9,1984.7,-1,7,0],[-1244.5,2342.2,1,8,1],[-1520.8,2389.8,-1,9,0],
             [-1884.5,2584.1,1,10,0],[-2390,3122.8,1,12,0],[-2754.1,3444.3,-1,13,1],[-2785.1,3822.6,1,14,0],
             [-2918.2,4007.9,-1,15,0],[-3182.9,4513.7,1,16,0],[-3455.7,4627.6,-1,17,0],[-3784.2,4876.9,1,18,0],
             [-4259,5241.4,-1,19,0]];
  const PATH3 = P2([[-4650.8,5588.6],[-4586.8,5473.6],[-4522.7,5358.9],[-4430.1,5282.4],[-4293.6,5264.7],
                [-4158.2,5241.1],[-4021.4,5198.6],[-3905.1,5139.2],[-3819.8,5054],[-3802.6,4986],[-3724.3,4873.1],
                [-3653.5,4744.8],[-3580.4,4621.4],[-3495.7,4521.6],[-3439.2,4456.8],[-3326.8,4404.5],[-3192,4379.4],
                [-3044.2,4364],[-2908.1,4318.1],[-2792.3,4256.3],[-2715.5,4083.4],[-2721.7,3959.8],[-2762.6,3829.2],
                [-2821.1,3695.1],[-2875.3,3561.8],[-2838.1,3392.6],[-2778.6,3287.4],[-2684,3207.9],[-2560.6,3149.5],
                [-2422.3,3101.9],[-2284.6,3064],[-2164.8,3009],[-2074.9,2928],[-2018.7,2820],[-1987.5,2687.4],
                [-1962.6,2541],[-1867.9,2432.2],[-1766.7,2347.3],[-1655.1,2300.4],[-1532,2295.5],[-1430.2,2334.4],
                [-1284.9,2320.2],[-1141.5,2303.8],[-1013.7,2268.8],[-911.3,2204],[-836.6,2103.9],[-787.7,1977.4],
                [-751.7,1836],[-730.2,1695.6],[-692.1,1568.5],[-625.1,1467.4],[-525.6,1395.5],[-457.9,1358.8],
                [-349.3,1261.6],[-242.5,1164],[-158.5,1060.8],[-103.6,988.5],[-74,869.5],[-77.8,734.5],[-106.3,589.9],
                [-161.1,455.8],[-179.2,329.4],[-128,225.7],[-56.8,113.7],[0,0]]);
  const s3 = seeded(1113, M3), r3 = lane(s3.world, PATH3);
  check("88. NO TURN OVER THE STAGE'S LIMIT THAT THE ROUTE WITHOUT THE LANE DOES NOT HAVE: the lane is laid in a seeded "
        + "world, makes a turn over MARK_JOIN_MAX_DEG, and is not kept - the turn does not ship, no mark is on its wrong "
        + "hand, and no buoyed reach is claimed",
        r3.reachLaid === true && r3.how.reach === false && sharpest(r3.track) <= R.MARK_JOIN_MAX_DEG + 0.5 && r3.how.marks.wrong === 0
          && legsClear(r3, s3.world) && R.NEW_TURN_NEAR_M === 30,
        "laid " + r3.reachLaid + ", claimed " + r3.how.reach + "; sharpest turn " + f1(sharpest(r3.track)) + " degrees (the limit: "
          + R.MARK_JOIN_MAX_DEG + "; with the route not asked it shipped 55.9)");
}
// 88b. ... AND A TURN IS THE LANE'S WHERE IT IS. The rule asked directly (`newLaneTurn`): a 57 degree S-turn the
// route without the lane does not have is the lane's although that route turns 75 degrees 3 km away (compared as
// whole-route maxima it shipped, beside Seavey Island on a real search path); the same corner sharpened by a degree
// where the route without the lane turns too is not; and a turn under the limit is nobody's concern.
{
  const A = [{ e: 0, n: 0 }, { e: 0, n: 3000 }, { e: 2900, n: 3780 }];                            // 75 deg at (0,3000)
  const S = [{ e: 0, n: 0 }, { e: 0, n: 500 }, { e: 40, n: 520 }, { e: 40, n: 600 }, { e: 0, n: 620 }, { e: 0, n: 3000 }, { e: 2900, n: 3780 }];   // 63 deg each
  const B1 = [{ e: 0, n: 0 }, { e: 0, n: 3000 }, { e: 2950, n: 3760 }];                           // the same corner, 76 deg
  const B2 = [{ e: 0, n: 0 }, { e: 0, n: 500 }, { e: 20, n: 540 }, { e: 20, n: 3000 }, { e: 2900, n: 3780 }];   // 27 deg
  check("88b. A TURN IS THE LANE'S WHERE IT IS: an S-turn over the limit far from the route-without-the-lane's own sharp "
        + "corner is the lane's; that corner a degree sharper is not; a turn under the limit is not",
        R.newLaneTurn(A, S) === true && R.newLaneTurn(A, B1) === false && R.newLaneTurn(A, B2) === false,
        "S-turn " + R.newLaneTurn(A, S) + " (want true), the same corner " + R.newLaneTurn(A, B1) + ", under the limit " + R.newLaneTurn(A, B2));
}
// 89. THE BUOYED REACH IS ASKED AGAIN WHERE THE PLANNER RE-GATES. In a set the route that ships is passage.js
// keepStandoff's re-gate of channelLaneRoute's route at the standoff, whose splices have no notion of a side; the lane
// was kept on what its route did at the BUFFER. A seeded world (4154, bound down, a 12 m standoff at the DriX's 5 m
// buffer - a 0.9 kn set): green 5, on its proper hand on both the lane's route and the route without it at the buffer,
// came back from the re-gate 15.5 m on her WRONG hand with the lane, and 15.1 m on its proper hand without it.
{
  const M = [[-112.4,619.7,-1,1,0],[172.2,1236.4,1,2,0],[245.3,1784.8,1,4,0],[103.3,2344.2,-1,5,0],
             [266.7,2941.5,1,6,0],[-97.1,3536.3,-1,7,0],[-27.5,4093.1,1,8,0],[-263.7,4500.9,-1,9,0],
             [-30.4,4515.5,1,10,0],[-231.1,4939.9,-1,11,0],[-8,5480.8,1,12,0]];
  const PL = [[0,[[-229.9,572.1],[-134.6,576.5],[-138.4,660.6],[-233.8,656.2]]],[0,[[264,1751.9],[312.2,1742.4],
              [323.3,1798.4],[275.1,1808]]],[1,[[-0.2,2286.5],[70.2,2287.9],[68,2399.1],[-2.3,2397.7]]],
              [0,[[286,2907],[342.4,2916.2],[330.5,2989.4],[274.1,2980.3]]],[1,[[-185.9,3459.6],[-96.5,3484.9],
              [-123.5,3580.5],[-212.9,3555.2]]],[0,[[10.7,4035.2],[65.2,4040.1],[54.3,4161.9],[-0.2,4157]]],
              [0,[[-333.4,4464],[-301.3,4464.7],[-302.9,4535.4],[-335,4534.7]]],[0,[[-6.9,4446.5],[80.9,4448.5],
              [77.7,4587.5],[-10.1,4585.5]]],[0,[[-321.6,4892.8],[-245.4,4886.5],[-236.4,4995],[-312.6,5001.3]]],
              [0,[[15.2,5443.6],[98.6,5438.5],[103,5509.6],[19.6,5514.8]]]];
  const PATH = P2([[-127.6,5940],[-163.7,5818.9],[-157.9,5699],[-91.4,5580.8],[-16.7,5456],[25.1,5330.3],[13.2,5210.9],
                [-49.4,5095.7],[-142.4,4983],[-234,4870.2],[-285.3,4740.2],[-279.9,4620.3],[-223.8,4501.5],
                [-137.5,4383.5],[-46,4271.5],[-46.2,4091.1],[-22.5,3912.2],[-76.1,3787.6],[-121.9,3650],
                [-74.9,3532.3],[-76.3,3467.3],[-99.5,3408],[-15.5,3306.6],[97.2,3213],[204.2,3108.5],[270.3,2997.7],
                [267.2,2996.5],[255.2,2996.5],[253.8,2935.1],[249.2,2927.8],[267.2,2885.8],[285,2878.5],
                [250.1,2751.2],[177.2,2619.6],[98.5,2498.1],[119.1,2362.9],[119.1,2326.9],[83.1,2260.9],[61.5,2257.3],
                [115.2,2143],[194.5,2019.6],[268.5,1882.7],[226.7,1801.1],[226.7,1765.1],[244.7,1757.1],
                [261.6,1639.4],[181.9,1531.8],[74.4,1432],[-29.4,1331.3],[-99.1,1223.4],[-112.8,1092.9],[-72,966.8],
                [-3.2,837.1],[63,723.6],[113.8,605.8],[112.2,485.6],[53.7,362.8],[-13.9,239.7],[-31,119.2],[0,0]]);
  const s = seeded(4154, M, PL);
  const { nogo } = require("../static/js/state.js"), was = nogo.buffer;
  nogo.buffer = 5;                                   // (keepStandoff's floor is the operator's buffer)
  const pathLL = PATH.map((p) => ll(p.e, p.n));
  const kr = R.channelLaneRoute(pathLL, F, s.world, 5, { standoffM: 12, marks: true, charted: true });
  const ks = require("../static/js/passage.js").keepStandoff(kr, pathLL, F, s.world, 12);
  nogo.buffer = was;
  const t = ks.route.map((p) => F.toEN(p)), g5 = s.marks.find((m) => m.num === 5);
  check("89. THE BUOYED REACH IS ASKED AGAIN WHERE THE PLANNER RE-GATES: in a 12 m standoff at a 5 m buffer, the route "
        + "that ships has no mark on its wrong hand that the route without the lane has right - green 5 to starboard - "
        + "and claims no buoyed reach it does not ride",
        offOf(t, g5) > 0 && ks.how.marks.wrong === 0 && kr.how.reach === true && ks.how.reach === false,
        "green 5 lies " + f1(offOf(t, g5)) + " m to starboard of the route that ships (reviewed: -15.5; without the lane: 15.1); "
          + JSON.stringify(ks.how.marks) + "; the buffer's route claimed the reach " + kr.how.reach + ", the route that ships " + ks.how.reach);
}
// 90. A LANE THAT PUTS A COUNTED MARK RIGHT IS NOT VETOED FOR IT. The lane is not kept where a lateral mark lies between
// its route and the route without it - asked of every mark, that vetoed every lane that put a counted mark RIGHT, since
// such a mark lies between the two by definition. A seeded land world (2194, bound down): the route without the lane
// leaves greens 13 and 15 on her wrong hand; the lane puts green 15 right - and was dropped for it.
{
  const M = [[-144.3,761.4,-1,1,0],[41.8,1205.6,1,2,0],[-333.7,1751.3,-1,3,0],[-205.9,2017,1,4,0],
             [-562.2,2391.3,-1,5,0],[-516.4,3022.8,1,6,0],[-737.3,2978.8,-1,7,0],[-691,3560.3,1,8,0],
             [-1084.7,3984,-1,9,0],[-1236.2,4557.7,-1,11,0],[-1347.4,4937.3,-1,13,0],[-1155.9,4996.2,1,14,0],
             [-1357.4,4952.7,-1,15,0],[-1214.3,5286,1,16,0],[-1460.3,5494.1,-1,17,0],[-1470.9,5785.3,-1,19,0]];
  const PL = [[1,[[-242.9,732.7],[-178.6,734.6],[-180,786.2],[-244.3,784.3]]],[1,[[-494.9,3003.6],[-424,3024.2],
              [-437.7,3071.2],[-508.6,3050.6]]],[0,[[-819.7,2900.8],[-731.4,2926.5],[-760.4,3026.1],[-848.7,3000.4]]],
              [0,[[-659.4,3522.7],[-620.7,3538.4],[-655.9,3625],[-694.6,3609.3]]],[0,[[-1309.8,4487.8],
              [-1261.1,4501.7],[-1287,4592.2],[-1335.6,4578.3]]],[0,[[-1469.2,4874.7],[-1353.4,4900.4],[-1368.4,4968],
              [-1484.2,4942.3]]],[1,[[-1127.8,4928.6],[-1035.5,4949.1],[-1066.8,5089.9],[-1159.1,5069.4]]],
              [0,[[-1449.8,4873.4],[-1380.5,4888.8],[-1405.4,5000.7],[-1474.7,4985.3]]],[1,[[-1185.4,5236.5],
              [-1078.4,5242.9],[-1084.5,5345],[-1191.5,5338.6]]],[0,[[-1560.8,5434],[-1470.3,5439.5],[-1476.8,5547.1],
              [-1567.3,5541.6]]],[0,[[-1536.2,5745.5],[-1494,5753.3],[-1503.9,5806.8],[-1546.1,5799]]]];
  const PATH = P2([[-1464.7,6389.7],[-1438.7,6272],[-1367.8,6159.4],[-1274.2,6049.5],[-1217,5947.4],[-1179.8,5832.3],
                [-1172.3,5711.7],[-1199.9,5568],[-1256.2,5444.4],[-1324,5320.1],[-1391.7,5195.8],[-1427.2,5052.8],
                [-1342.6,4943.2],[-1345.6,4895.2],[-1413,4786.7],[-1357.5,4679],[-1278.3,4596.7],[-1276.1,4580.5],
                [-1182.4,4491],[-1076.8,4396.4],[-971.5,4302.6],[-877.7,4205.3],[-805.1,4101.7],[-760.7,4009.6],
                [-732.5,3891.5],[-729.6,3763.2],[-745.4,3627.3],[-770.5,3487.5],[-805.5,3353.7],[-830.5,3221.4],
                [-833.8,3095.5],[-753.1,3028.8],[-732.1,2983.8],[-723.1,2920.8],[-760.2,2876.2],[-686.6,2770.3],
                [-593.9,2668.9],[-487.1,2572.2],[-381.6,2479],[-289.3,2381.8],[-219,2279.5],[-175.3,2167.5],
                [-160.2,2046.4],[-170.4,1917.3],[-193.4,1788.8],[-219.6,1649],[-242.9,1510.5],[-269.9,1405.3],
                [-283.6,1281],[-268.8,1161.8],[-224.5,1047.7],[-154.4,938.2],[-75.7,838.2],[4.2,720.4],[80,602.5],
                [140.5,483.7],[157.9,364.1],[106.8,244],[45.7,121.7],[0,0]]);
  const s = seeded(2194, M, PL), r = lane(s.world, PATH), g15 = s.marks.find((m) => m.num === 15);
  check("90. A LANE THAT PUTS A COUNTED MARK RIGHT IS NOT VETOED FOR IT: green 15 ships on its proper hand, the lane kept",
        r.how.reach === true && offOf(r.track, g15) > 0 && r.how.marks.wrong <= 1 && legsClear(r, s.world),
        "how.reach " + r.how.reach + "; green 15 lies " + f1(offOf(r.track, g15)) + " m to starboard (vetoed: -3.6); " + JSON.stringify(r.how.marks));
}
// 91. NO NEARER A HAZARD THAN ITS OWN FLOOR WHERE THE ROUTE WITHOUT IT WAS FURTHER OFF. The lane lays its points at
// least clr + STANDOFF off what bounds it; the smoothing rounds the V it makes round a rock and can cut inside that. A
// straight buoyed river 500 m wide, greens on her port hand, and one charted rock 15 m to starboard of her path: it
// shipped 6.2 m off the rock, where the lane's floor is 9 m and the route without the lane 15 m. Wherever the rock
// stands, the route that ships passes it at the floor or more - or the lane is not kept there.
{
  const banks = [land(rect(-900, -1600, -200, 4600)), land(rect(300, -1600, 900, 4600))];
  const greens = [-1300, -900, -500, -100, 300, 700, 1100, 1500, 1900, 2300, 2700, 3100].map((n, i) => mark(-170, n, GREEN, 1 + 2 * i, "row " + i));
  const rows = [];
  for (const [x, dn] of [[15, 0], [15, 6], [15, 12], [20, 0], [25, 6]]) {
    const rock = hazard(-100 + x, 1500 + dn);
    const w = model({ polys: banks, marks: greens, points: [rock] }), r = lane(w, [{ e: -100, n: -1500 }, { e: -100, n: 4500 }]);
    rows.push({ x, dn, off: nearestTo(r.track, (p) => Math.hypot(p.e - rock.e, p.n - rock.n)), reach: r.how.reach, ok: legsClear(r, w) });
  }
  check("91. NO NEARER A HAZARD THAN THE LANE'S OWN FLOOR WHERE THE ROUTE WITHOUT IT WAS FURTHER OFF: a rock 15-25 m off "
        + "her path in a buoyed river is passed at the floor (clr + STANDOFF) or more, wherever it stands",
        rows.every((q) => q.off >= REACH_LIMIT - 0.5 && q.ok) && rows.some((q) => q.reach),
        rows.map((q) => "rock " + q.x + " m at n+" + q.dn + ": " + f1(q.off) + " m, lane " + q.reach).join("; ") + " (the floor " + REACH_LIMIT
          + "; it shipped 6.2)");
  // (b) ... AND OF THE BANK: a rock is passed by the rock rule now, so the backstop is asked here of a bridge support in
  // the same places - built, and so the bank, which the lane's floor still governs.
  const rowsB = [];
  for (const [x, dn] of [[15, 0], [15, 6], [15, 12], [20, 0], [25, 6]]) {
    const sup = { e: -100 + x, n: 1500 + dn, r: 0, kind: "a bridge support" };
    const w = model({ polys: banks, marks: greens, points: [sup] }), r = lane(w, [{ e: -100, n: -1500 }, { e: -100, n: 4500 }]);
    rowsB.push({ x, dn, off: nearestTo(r.track, (p) => Math.hypot(p.e - sup.e, p.n - sup.n)), reach: r.how.reach, ok: legsClear(r, w) });
  }
  check("91b. ... NOR A BRIDGE SUPPORT: one 15-25 m off her path is passed at the lane's floor or more, wherever it "
        + "stands - or the lane is not kept there",
        rowsB.every((q) => q.off >= REACH_LIMIT - 0.5 && q.ok) && rowsB.some((q) => q.reach),
        rowsB.map((q) => "support " + q.x + " m at n+" + q.dn + ": " + f1(q.off) + " m, lane " + q.reach).join("; ") + " (the floor " + REACH_LIMIT
          + "; with no backstop, 6.2 and 8.3)");
}
// 92. A DRAWN TRANSIT THROUGH A BUOYED REACH CLAIMS IT. routePlan lanes each transit leg alone and adds `how` up over
// them; run over the reach of 69 as a transit of two legs, the plan says "right of center in the buoyed channel"
// (77 read only the source text of the merge).
{
  const P = require("../static/js/passage.js"), { nogo } = require("../static/js/state.js");
  const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer };
  let plan = null;
  try {
    nogo.ready = true; nogo.frame = F; nogo.buffer = BUF; nogo.ko = model({ polys: REACH_BANKS, marks: REACH_MARKS });
    plan = P.routePlan(ll(-100, -1500), [ll(-100, 1250), ll(-100, 4500)], true, 0);
  } finally { Object.assign(nogo, saved); }
  const note = P.buoyageNote(plan.lane, plan.partial, plan.how);
  check("92. A DRAWN TRANSIT THROUGH A BUOYED REACH CLAIMS IT: routePlan over the reach of 69 in two legs says it",
        plan.how.reach === true && /right of center in the buoyed channel/.test(note) && plan.how.marks.wrong === 0,
        JSON.stringify(plan.how) + " | \"" + note + "\"");
}
// 93. THE MID-REACH ROCK, BOTH MODELS (Andy, 2026-10-05: "hold the lane and pass the rock wide" - "treat it as land
// that may be avoided to either side" - "maybe treat a rock as sea bottom - a shallow point to be avoided" - "model
// either way for testing purposes"). A straight buoyed river 500 m wide, greens on her port hand, the lane 276 m to
// starboard of her path. (a) A charted rock 130 m to starboard of her path, 146 m to port of the lane's line: in both
// models she holds the lane and passes it wide - read as an edge, the lane came back to 112 m to pass it 18 m off.
// (b) A rock ON the lane's line: 'land' passes it at the lane's own clearance from a bank (clr + STANDOFF), 'bottom'
// at the planner's ordinary keep-clear and a march step (clr + MS), each on whichever side is the smaller move - and
// the two differ.
{
  const banks = [land(rect(-900, -1600, -200, 4600)), land(rect(300, -1600, 900, 4600))];
  const greens = [-1300, -900, -500, -100, 300, 700, 1100, 1500, 1900, 2300, 2700, 3100].map((n, i) => mark(-170, n, GREEN, 1 + 2 * i, "row " + i));
  const UP = [{ e: -100, n: -1500 }, { e: -100, n: 4500 }];
  const run = (rockE, model_) => {
    const rock = hazard(rockE, 1500), w = model({ polys: banks, marks: greens, points: [rock] }), r = lane(w, UP, { rockModel: model_ });
    return { r, w, off: nearestTo(r.track, (p) => Math.hypot(p.e - rock.e, p.n - rock.n)), e: eAtN(r.track, 1500), line: eAtN(lane(model({ polys: banks, marks: greens }), UP).track, 1500) };
  };
  const midL = run(30, "land"), midB = run(30, "bottom");
  check("93. A ROCK IN MID-REACH: she holds the lane and passes it wide, in both models (land, shallow point)",
        [midL, midB].every((q) => Math.abs(q.e - q.line) < 2 && q.off > 140 && q.r.how.reach === true && legsClear(q.r, q.w)),
        "land: e " + f1(midL.e) + ", " + f1(midL.off) + " m off; shallow point: e " + f1(midB.e) + ", " + f1(midB.off) + " m off (the lane's line: e "
          + f1(midL.line) + "; read as an edge it came back to e 11.7, 18.3 m off)");
  const line = midL.line, onL = run(line, "land"), onB = run(line, "bottom");
  const floorL = BUF + Math.max(BUF + 2, 6), floorB = BUF + Math.max(2, BUF / 2);   // (the keep-clear and a march step)
  check("93b. A ROCK ON THE LANE'S LINE is passed either side: 'land' at the lane's own clearance from a bank, 'bottom' at "
        + "the ordinary keep-clear - and the two models differ",
        onL.off >= floorL - 0.5 && onB.off >= floorB - 0.5 && onB.off <= floorB + 1 && onB.off < onL.off - 2 && onL.r.how.reach === true
          && onB.r.how.reach === true
          && legsClear(onL.r, onL.w) && legsClear(onB.r, onB.w) && sharpest(onL.r.track) < 30 && sharpest(onB.r.track) < 30,
        "land: " + f1(onL.off) + " m off (floor " + floorL + "), at e " + f1(onL.e) + "; shallow point: " + f1(onB.off) + " m off (floor " + floorB
          + "), at e " + f1(onB.e) + " (the rock at e " + f1(line) + ")");
  // (c) ANYTHING BUILT IS THE BANK, however small: a pier 40 m across standing alone where the rock of (a) was. The
  // chart serves no floats, so a pier head standing off on its own may be joined to the shore by one that is not drawn,
  // and the water behind it is a marina's. In both models the lane comes in to pass it on her path's side - and so it
  // does for a float and a bridge support. (Read as rocks, the lane held its line past three charted piers 35-45 m
  // across on the real Piscataqua.)
  const built = (kind, model_) => {
    const pier = land(rect(20, 1480, 60, 1520), kind), w = model({ polys: banks.concat([pier]), marks: greens }), r = lane(w, UP, { rockModel: model_ });
    return { r, w, e: eAtN(r.track, 1500) };
  };
  const SKIN = require("../static/js/skin.js").SKIN_KIND;
  const bl = [built("a dock / pier", "land"), built("a dock / pier", "bottom"), built(SKIN, "land"), built("a bridge support", "land")];
  check("93c. ... BUT ANYTHING BUILT IS THE BANK: a pier 40 m across alone in mid-reach is passed on her path's side, in both "
        + "models - and a float, and a bridge support",
        bl.every((q) => q.e != null && q.e < 20 - BUF && legsClear(q.r, q.w)),
        "abeam of it she is at e " + bl.map((q) => f1(q.e)).join(", ") + " (pier, pier as a shallow point, float, bridge support; its face "
          + "is e 20; the lane's line e " + f1(line) + ")");
  // (d) ... ON WHICHEVER SIDE IS THE SMALLER MOVE from the line: a rock 3 m to port of it is passed to starboard (a move
  // of the floor less 3 m, where to port of it would be the floor and 3 m), and one 3 m to starboard of it to port.
  const port3 = run(line - 3, "land"), stbd3 = run(line + 3, "land");
  check("93d. ... ON WHICHEVER SIDE IS THE SMALLER MOVE: a rock 3 m to port of the lane's line is passed to starboard, "
        + "one 3 m to starboard of it to port - each at the floor or more",
        port3.e > line - 3 && stbd3.e < line + 3 && port3.off >= floorL - 0.5 && stbd3.off >= floorL - 0.5
          && port3.r.how.reach === true && stbd3.r.how.reach === true && legsClear(port3.r, port3.w) && legsClear(stbd3.r, stbd3.w),
        "the rock at e " + f1(line - 3) + ": she is at e " + f1(port3.e) + ", " + f1(port3.off) + " m off; at e " + f1(line + 3) + ": e "
          + f1(stbd3.e) + ", " + f1(stbd3.off) + " m off (the line e " + f1(line) + ", the floor " + floorL + ")");
  // (e) THE PAGE'S CHOICE REACHES THE PLANNER: state.js holds 'land'; passage.js's channelLaneRoute (every Go-To, RTH
  // and transit) hands V.REACH_ROCK down; the page's "Channel rocks" offers both, Land selected, and sets it.
  const { V } = require("../static/js/state.js"), PS = require("../static/js/passage.js");
  const HTML = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");
  const viaPage = (m) => {
    const was = V.REACH_ROCK;
    try {
      V.REACH_ROCK = m;
      const rock = hazard(line, 1500), w = model({ polys: banks, marks: greens, points: [rock] });
      const r = PS.channelLaneRoute(UP.map((p) => ll(p.e, p.n)), F, w, BUF, {}), t = r.route.map((p) => F.toEN(p));
      return nearestTo(t, (p) => Math.hypot(p.e - rock.e, p.n - rock.n));
    } finally { V.REACH_ROCK = was; }
  };
  const fresh = V.REACH_ROCK, pL = viaPage("land"), pB = viaPage("bottom");
  const keySrc = (HTML.match(/\nfunction transitEstKey\([^)]*\)\{[\s\S]*?\n\}/) || [""])[0];
  const keyFor = (m) => {
    try {
      const fn = new Function("nogo", "M_PER_DEG_LAT", "TRANSIT_REKEY_M", "V", keySrc + "\nreturn transitEstKey;")(
        { bbox: null, ready: true, band: "enc_harbour", buffer: 3 }, 111320, 50, { REACH_ROCK: m });
      return fn({ lat: 43.07, lon: -70.71 }, [{ lat: 43.07, lon: -70.71 }, { lat: 43.1, lon: -70.75 }], null);
    } catch (e) { return "ERR " + e.message; }
  };
  check("93e. THE PAGE'S CHOICE REACHES THE PLANNER: 'land' by default, handed down by passage.js's channelLaneRoute, and "
        + "the card's \"Channel rocks\" offers both and sets it",
        fresh === "land" && Math.abs(pL - onL.off) < 0.5 && Math.abs(pB - onB.off) < 0.5
          && /<label>Channel rocks<\/label><select id="enf_rock"><option value="land" selected>Land<\/option><option value="bottom">Shoal<\/option><\/select>/.test(HTML)
          && /\$\("#enf_rock"\)\.onchange = \(\)=>\{ V\.REACH_ROCK = \$\("#enf_rock"\)\.value === "bottom" \? "bottom" : "land"; \};/.test(HTML)
          // (and the line table's transit / RTH estimate is keyed on it: a change of model is a different route - the key
          // RUN with the page's own source, since a regex over it passes code that never runs)
          && keyFor("land") !== keyFor("bottom") && !/^ERR/.test(keyFor("land")),
        "V.REACH_ROCK " + fresh + "; through passage.js the rock on the line is passed " + f1(pL) + " m off as land, " + f1(pB)
          + " m as a shallow point (asked directly: " + f1(onL.off) + ", " + f1(onB.off) + ")");
  // (f) ROCKS CLOSER THAN TWICE THE FLOOR ARE ONE: two 12 m apart straddling the lane's line, as land. Passed one at a
  // time, each was sent to its own smaller move - one to port of the line, the other to starboard of it - and the lane
  // was lost; taken together she passes both on one side, at the floor or more.
  const pairs = [[-6, 6], [-4, 8], [-8, 4]].map(([a, b]) => {
    const p1 = hazard(line + a, 1500), p2 = hazard(line + b, 1500), w = model({ polys: banks, marks: greens, points: [p1, p2] });
    const r = lane(w, UP, { rockModel: "land" }), e = eAtN(r.track, 1500);
    return { r, w, e, o1: nearestTo(r.track, (p) => Math.hypot(p.e - p1.e, p.n - p1.n)), o2: nearestTo(r.track, (p) => Math.hypot(p.e - p2.e, p.n - p2.n)), lo: line + a, hi: line + b };
  });
  check("93f. ... ROCKS CLOSER THAN TWICE THE FLOOR ARE PASSED AS ONE: two 12 m apart across the lane's line are passed "
        + "on one side, both at the floor or more, and the lane is kept",
        pairs.every((q) => q.r.how.reach === true && (q.e > q.hi || q.e < q.lo) && q.o1 >= floorL - 0.5 && q.o2 >= floorL - 0.5 && legsClear(q.r, q.w)),
        pairs.map((q) => "rocks at e " + f1(q.lo) + ", " + f1(q.hi) + ": she is at e " + f1(q.e) + ", " + f1(q.o1) + " / " + f1(q.o2) + " m off").join("; "));
  // (g) THE HOLD PAST A REACH'S END IS NOT STOPPED BY A ROCK: 69's reach ends at green 5 (n 2500) and the lane is held
  // past it as it eases off; a rock on that held line at n 2600 is passed on her path's side (outside a reach there is
  // no far side to read), the lane eased in for it over the rock's own window: on the lane to n 2300, still 143 m out
  // at green 5. (Stopped at the rock, the hold let her go back toward her path 100 m before the reach's end: e -30 at
  // n 2400.)
  const open69 = lane(model({ polys: REACH_BANKS, marks: REACH_MARKS }), REACH_UP);
  const held = hazard(eAtN(open69.track, 2600), 2600), wH = model({ polys: REACH_BANKS, marks: REACH_MARKS, points: [held] }), rH = lane(wH, REACH_UP);
  const gns = [2200, 2300, 2400, 2500], ge = gns.map((n) => eAtN(rH.track, n)), go = gns.map((n) => eAtN(open69.track, n));
  const offH = nearestTo(rH.track, (p) => Math.hypot(p.e - held.e, p.n - held.n));
  check("93g. ... AND A ROCK ON THE LINE HELD PAST A REACH'S END is passed on her path's side at the floor or more, the lane "
        + "eased in for it over its own window only: on the lane to n 2300, and still out at green 5",
        Math.abs(ge[1] - go[1]) < 2 && ge[3] > 25 && offH >= floorL - 0.5 && rH.how.reach === true && legsClear(rH, wH),
        "e@" + gns.join(",") + " = " + ge.map(f1).join(",") + " (with no rock " + go.map(f1).join(",") + "; green 5 is at n 2500); the rock at e "
          + f1(held.e) + " n 2600 passed " + f1(offH) + " m off");
  // (h) A SHOAL OFF A BANK IS THE BANK - "water all round it" is twice the floor, from its outline: a shoal patch 100 m
  // across, 8 m off the east bank, athwart the lane's line (twice the Shoal floor is 10 m, the Land floor's 18). It
  // narrows the water the lane reads, and she passes it at the lane's clearance on her path's side, in both models.
  // (Read as a rock, the lane held its line through it, 14 m off.)
  const offBank = ["land", "bottom"].map((m) => {
    const s = land(rect(192, 1450, 292, 1550), "water shallower than 3.0 m"), w = model({ polys: banks.concat([s]), marks: greens });
    const r = lane(w, UP, { rockModel: m });
    return { r, w, e: eAtN(r.track, 1500), off: nearestTo(r.track, (p) => distRect(p, 192, 1450, 292, 1550)) };
  });
  check("93h. ... BUT A SHOAL OFF A BANK IS THE BANK: one 8 m off it, athwart the lane's line, is passed on her path's "
        + "side at the lane's clearance, in both models",
        offBank.every((q) => q.e < line - 20 && q.off >= floorL - 0.5 && q.r.how.reach === true && legsClear(q.r, q.w)),
        offBank.map((q, i) => (i ? "shallow point" : "land") + ": e " + f1(q.e) + ", " + f1(q.off) + " m off").join("; ") + " (the shoal's face e 192; the line " + f1(line) + ")");
  // (i) ... AND SO IS A CHAIN OF ROCKS LONGER THAN ROCK_MAX_M - as land: rocks 15 m apart for 300 m where the rock of (a)
  // was. Closer together than twice the land floor they are one, and too long to be a rock; as shallow points (twice
  // that floor is 10 m) each is its own, 146 m off the lane's line, and she holds it.
  const chain = []; for (let n = 1350; n <= 1650; n += 15) chain.push(hazard(30, n));
  const wC = model({ polys: banks, marks: greens, points: chain });
  const cL = lane(wC, UP, { rockModel: "land" }), cB = lane(wC, UP, { rockModel: "bottom" }), eCL = eAtN(cL.track, 1500), eCB = eAtN(cB.track, 1500);
  check("93i. ... AND A CHAIN OF ROCKS LONGER THAN ROCK_MAX_M, as land: 300 m of them in mid-reach is an edge she passes on "
        + "her path's side; as shallow points, each is its own and she holds the lane",
        eCL < 30 - floorL && Math.abs(eCB - line) < 2 && cL.how.reach === true && legsClear(cL, wC) && legsClear(cB, wC),
        "land: e " + f1(eCL) + " (the chain at e 30); shallow points: e " + f1(eCB) + " (the line " + f1(line) + ")");
  // (j) A HAZARD A MARK STANDS BESIDE IS THE EDGE IT MARKS (ROCK_MARKED_M), not a rock in the channel: a shoal patch
  // beside green 15 reaching 50 m into the channel narrows the water the lane reads, in both models - the lane stands
  // further to starboard abeam of it. (Read as a rock, the shallow-point model's lane did not move.)
  const marked = ["land", "bottom"].map((m) => {
    const s = land(rect(-165, 1460, -120, 1540), "water shallower than 3.0 m"), w = model({ polys: banks.concat([s]), marks: greens });
    const r = lane(w, UP, { rockModel: m });
    return { r, w, e: eAtN(r.track, 1500) };
  });
  check("93j. ... AND A HAZARD A MARK STANDS BESIDE IS THE EDGE IT MARKS: a shoal beside green 15 reaching into the "
        + "channel narrows the water the lane reads, in both models",
        marked.every((q) => q.e > line + 4 && q.r.how.reach === true && legsClear(q.r, q.w)),
        marked.map((q, i) => (i ? "shallow point" : "land") + ": e " + f1(q.e)).join("; ") + " (with no shoal, the line " + f1(line) + ")");
  // ── THE THIRD REVIEW OF THE ROCK MODELS (2026-10-05): each check fails on the code that was reviewed ──────────────
  const both = ["land", "bottom"], flo = (m) => (m === "bottom" ? floorB : floorL);
  const pt = (p) => (q) => Math.hypot(q.e - p.e, q.n - p.n) - (p.r || 0);
  // (k) WATER ALL ROUND IT IS MEASURED FROM ITS OUTLINE: a shoal 100 m across with 25 m of water to the east bank, more
  // than twice either floor, is a rock - passed at its floor, on the side that is the smaller move. Measured from a
  // circle round its bounding box it had none, and as the bank the lane was pulled in to e 127-144.
  const off25 = both.map((m) => {
    const s = land(rect(175, 1450, 275, 1550), "water shallower than 3.0 m"), w = model({ polys: banks.concat([s]), marks: greens });
    const r = lane(w, UP, { rockModel: m });
    return { m, r, w, e: eAtN(r.track, 1500), off: nearestTo(r.track, (p) => distRect(p, 175, 1450, 275, 1550)) };
  });
  check("93k. WATER ALL ROUND IT IS MEASURED FROM ITS OUTLINE: a shoal 100 m across with 25 m of water to the bank is a rock, "
        + "passed at its floor in both models - not read as the bank",
        off25.every((q) => q.e > 155 && q.off >= flo(q.m) - 0.5 && q.r.how.reach === true && legsClear(q.r, q.w)),
        off25.map((q) => q.m + ": e " + f1(q.e) + ", " + f1(q.off) + " m off").join("; ") + " (the shoal e 175..275; as the bank, e 127-144)");
  // (l) TWO ROCKS EITHER SIDE OF THE LINE: one just to port of it, one just to starboard, 30-150 m apart along her route.
  // Each side was chosen alone: the first sent far, the second near - and the second's cap held the first inside its
  // floor through every round, and the whole lane was lost (29 of 32 such pairs as land). A far pass the other's cap has
  // made impossible now gives way.
  const pairs2 = [];
  for (const [dA, dB] of [[-3, 3], [-6, 6], [-5, 2]]) for (const dn of [30, 60, 100, 150]) for (const m of both) {
    const A = hazard(line + dA, 1500), B = hazard(line + dB, 1500 + dn), w = model({ polys: banks, marks: greens, points: [A, B] });
    const r = lane(w, UP, { rockModel: m });
    pairs2.push({ dA, dB, dn, m, r, w, oA: nearestTo(r.track, pt(A)), oB: nearestTo(r.track, pt(B)) });
  }
  check("93l. ... AND TWO ROCKS EITHER SIDE OF THE LINE, 30-150 m apart along her route, are both passed at their floor, the "
        + "lane kept, in both models",
        pairs2.every((q) => q.r.how.reach === true && q.oA >= flo(q.m) - 0.5 && q.oB >= flo(q.m) - 0.5 && sharpest(q.r.track) < 25 && legsClear(q.r, q.w)),
        pairs2.filter((q) => !(q.r.how.reach === true && q.oA >= flo(q.m) - 0.5 && q.oB >= flo(q.m) - 0.5)).length + " of " + pairs2.length
          + " short (" + pairs2.slice(0, 8).map((q) => q.m[0] + " " + q.dA + "/" + q.dB + "@" + q.dn + ": " + f1(q.oA) + "/" + f1(q.oB)).join("; ") + " ...)");
  // (m) ASKED OF THE ROUTE AS IT WILL BE SMOOTHED: a rock at the apex of a bend in the river, and one at the knee where the
  // lane eases in short of green 1 or off past green 5. The line cleared each by its floor and the smoothing rounded it
  // back onto it (0.2-3.9 m): as land the lane was lost (up to 17 of 21 placements at a bend), as a shallow point it
  // shipped with a 45 degree dart. (The bend: the river of check 93 turned at n 1000 - 3000 m on.)
  const bendWorld = (TURN) => {
    const th = TURN * Math.PI / 180, P0 = { e: -100, n: -1500 }, C = { e: -100, n: 1000 }, d2 = { e: Math.sin(th), n: Math.cos(th) };
    const P2 = { e: C.e + 3000 * d2.e, n: C.n + 3000 * d2.n }, n1 = { e: 1, n: 0 }, n2 = { e: Math.cos(th), n: -Math.sin(th) };
    const bis = (() => { const a = { e: n1.e + n2.e, n: n1.n + n2.n }, L = Math.hypot(a.e, a.n); return { e: a.e / L, n: a.n / L }; })();
    const mit = 1 / Math.cos(th / 2);
    const off = (x) => [{ e: P0.e + x * n1.e, n: P0.n - 100 + x * n1.n }, { e: C.e + x * mit * bis.e, n: C.n + x * mit * bis.n },
      { e: P2.e + 100 * d2.e + x * n2.e, n: P2.n + 100 * d2.n + x * n2.n }];
    const ringOf = (x0, x1) => { const a = off(x0), b = off(x1); return a.concat(b.reverse()); };
    const gr = [];
    for (let s = 200, k = 0; s < 5400; s += 400, k++) {
      const p = s < 2500 ? { e: P0.e, n: P0.n + s } : { e: C.e + (s - 2500) * d2.e, n: C.n + (s - 2500) * d2.n }, nn = s < 2500 ? n1 : n2;
      gr.push(mark(p.e - 70 * nn.e, p.n - 70 * nn.n, GREEN, 1 + 2 * k, "row " + k));
    }
    return { C, bis, banks: [land(ringOf(-100, -1100)), land(ringOf(400, 1400))], greens: gr, PATH: [P0, C, P2] };
  };
  const smo = [];
  for (const TURN of [-20, 35]) {
    const W = bendWorld(TURN), r0 = lane(model({ polys: W.banks, marks: W.greens }), W.PATH);
    let apex = -1e9;
    along(r0.track, 1, (p) => { const v = (p.e - W.C.e) * W.bis.e + (p.n - W.C.n) * W.bis.n, u = Math.abs((p.e - W.C.e) * W.bis.n - (p.n - W.C.n) * W.bis.e); if (u < 1.5 && v > apex) apex = v; });
    for (const dx of [-6, -1, 0, 1, 6]) for (const m of both) {
      const rk = hazard(W.C.e + (apex + dx) * W.bis.e, W.C.n + (apex + dx) * W.bis.n), w = model({ polys: W.banks, marks: W.greens, points: [rk] });
      const r = lane(w, W.PATH, { rockModel: m });
      smo.push({ at: "bend " + TURN + " dx " + dx, m, r, w, off: nearestTo(r.track, pt(rk)) });
    }
  }
  for (const [kn, dx] of [[475, -6], [475, 0], [2500, 0], [2500, 6]]) {
    const rk = hazard(eAtN(open69.track, kn) + dx, kn), w = model({ polys: REACH_BANKS, marks: REACH_MARKS, points: [rk] });
    for (const m of both) { const r = lane(w, REACH_UP, { rockModel: m }); smo.push({ at: "knee n " + kn + " dx " + dx, m, r, w, off: nearestTo(r.track, pt(rk)) }); }
  }
  // (the code re-lays below its floor less 0.5 m; the gate and the knot prune after it may take a little more)
  const smoBad = smo.filter((q) => !(q.r.how.reach === true && q.off >= flo(q.m) - 0.75 && sharpest(q.r.track) < 20 && legsClear(q.r, q.w)));
  check("93m. ... ASKED OF THE ROUTE AS IT WILL BE SMOOTHED: a rock at the apex of a bend, or at the knee where the lane eases "
        + "in or off, is passed at its floor and the lane kept, with no dart, in both models",
        smoBad.length === 0,
        smoBad.length + " of " + smo.length + " short" + (smoBad.length ? ": " + smoBad.slice(0, 6).map((q) => q.at + " " + q.m + " " + (q.r.how.reach ? f1(q.off) + " m, "
          + f1(sharpest(q.r.track)) + " deg" : "LANE LOST")).join("; ") : " (nearest " + f1(Math.min(...smo.map((q) => q.off - flo(q.m) + 0))) + " m from its floor)"));
  // (n) A RUN OF ROCKS: seven in a diagonal 27 m apart, each 11 m further to port - not one cluster. Each near-side pass
  // lays the line onto the next rock, and four rounds found four of them: the fifth stayed inside its floor and the
  // lane was lost. ROCK_ROUNDS rounds pass all seven.
  const stair = []; for (let k = 0; k < 7; k++) stair.push(hazard(line + 2 - 11 * k, 1500 + 25 * k));
  const wS = model({ polys: banks, marks: greens, points: stair }), rS = lane(wS, UP), oS = stair.map((q) => nearestTo(rS.track, pt(q)));
  check("93n. ... AND A RUN OF SEVEN ROCKS, each lane laid onto the next, is passed: every one at its floor, the lane kept",
        rS.how.reach === true && oS.every((x) => x >= floorL - 0.5) && legsClear(rS, wS) && R.ROCK_ROUNDS === 8,
        "the rocks passed " + oS.map(f1).join(", ") + " m off (the floor " + floorL + "); reach " + rS.how.reach);
  // (o) A ROCK'S OWN WIDTH, FROM ITS OUTLINE: a shoal 15 m wide and 140 m long lying along her course, 2 m to port of
  // the lane's line in the reach of 69, is passed at its floor - as one 15 m square is. Read as its bounding box's
  // half-diagonal, it was 141 m wide: the lane moved 71 m and passed it 59 m off.
  const thin = both.map((m) => {
    const s = land(rect(73, 1430, 88, 1570), "water shallower than 3.0 m"), w = model({ polys: REACH_BANKS.concat([s]), marks: REACH_MARKS });
    const r = lane(w, REACH_UP, { rockModel: m });
    return { m, r, w, off: nearestTo(r.track, (p) => distRect(p, 73, 1430, 88, 1570)) };
  });
  check("93o. ... AND ITS OWN WIDTH: a shoal 15 m wide and 140 m long along her course, on the lane's line, is passed at its "
        + "floor, not as if it were 141 m wide",
        thin.every((q) => q.off >= flo(q.m) - 0.5 && q.off < flo(q.m) + 6 && q.r.how.reach === true && legsClear(q.r, q.w)),
        thin.map((q) => q.m + ": " + f1(q.off) + " m off").join("; ") + " (read as 141 m wide: 59 m off)");
  // (p) THE CHART'S CLASSES: a pile, a dolphin, a bridge pylon, a hulk, a shore construction and every aid that is no
  // lateral mark (a cardinal, isolated-danger, safe-water or special-purpose buoy or beacon) are charted as 'a charted
  // hazard' POINTS, just as a rock is. 3 m to port of the lane's line each is the bank, passed on her path's side; a
  // rock awash, a wreck and an obstruction there are rocks, passed on the smaller move (to starboard). Read by kind
  // alone, every one was a rock: piles and dolphins passed on their shore side, a west cardinal on its east.
  const BUILT = ["Pile_point", "Mooring_Warping_Facility_point", "Pylon_Bridge_Support_point", "Hulk_point", "Shoreline_Construction_point",
                 "Buoy_Cardinal_point", "Buoy_Isolated_Danger_point", "Buoy_Safe_Water_point", "Buoy_Special_Purpose_General_point",
                 "Beacon_Safe_Water_point", "Beacon_Special_Purpose_General_point"];
  const NATURAL = ["Underwater_Awash_Rock_point", "Wreck_point", "Obstruction_point"];
  const byCls = (cls) => {
    const p = { e: line - 3, n: 1500, r: 0, kind: "a charted hazard", cls }, w = model({ polys: banks, marks: greens, points: [p] }), r = lane(w, UP);
    return { cls, r, w, e: eAtN(r.track, 1500), off: nearestTo(r.track, pt(p)) };
  };
  const bu = BUILT.map(byCls), na = NATURAL.map(byCls);
  // (... and as the chart builds them: the keep-out must carry its class from the chart feature for the lane to read it)
  const viaChart = ["Pile_point", "Mooring_Warping_Facility_point"].map((cls) => {
    const q = ll(line - 3, 1500), kb = K.buildKeepouts(F, [{ role: "hazard_point", cls, props: {}, geometry: { type: "Point", coordinates: [q.lon, q.lat] } }], {});
    const p = kb.points[0], w = model({ polys: banks, marks: greens, points: kb.points }), r = lane(w, UP);
    return { cls, p, r, w, e: eAtN(r.track, 1500) };
  });
  check("93p. THE CHART'S CLASSES: piles, dolphins, pylons, hulks, shore constructions and the aids charted as hazard points "
        + "are the bank, passed on her path's side; a rock awash, a wreck and an obstruction are rocks, passed on the smaller move",
        bu.every((q) => q.e < line - 3 - floorL + 0.5 && q.r.how.reach === true && legsClear(q.r, q.w))
          && na.every((q) => q.e > line - 3 && q.off >= floorL - 0.5 && q.r.how.reach === true && legsClear(q.r, q.w))
          && viaChart.every((q) => q.p && q.p.cls === q.cls && q.e < line - 3 - (q.p.r || 0) - floorL + 0.5 && q.r.how.reach === true && legsClear(q.r, q.w)),
        "abeam of the point (e " + f1(line - 3) + "): " + bu.concat(na).map((q) => q.cls.replace(/_point$/, "") + " e " + f1(q.e)).join(", ")
          + "; built by the chart: " + viaChart.map((q) => q.cls.replace(/_point$/, "") + " (class " + (q.p && q.p.cls) + ", r " + f1(q.p && q.p.r) + ") e " + f1(q.e)).join(", "));
  // (q) A ROCK OF UNKNOWN EXTENT (the chart's assumed 50 m) on the lane's line: passed at its floor off that extent, the
  // lane kept. After the smoothing it was passed 1-2 m inside its floor and the backstop dropped the whole lane.
  const r50 = both.map((m) => {
    const p = hazard(line - 3, 1500, 50), w = model({ polys: banks, marks: greens, points: [p] }), r = lane(w, UP, { rockModel: m });
    return { m, r, w, off: nearestTo(r.track, pt(p)) };
  });
  check("93q. ... AND A ROCK OF UNKNOWN EXTENT (50 m) on the lane's line is passed at its floor off that extent, the lane kept, "
        + "in both models",
        r50.every((q) => q.off >= flo(q.m) - 0.5 && q.r.how.reach === true && legsClear(q.r, q.w)),
        r50.map((q) => q.m + ": " + f1(q.off) + " m off its extent, lane " + q.r.how.reach).join("; "));
  // (r) A SHOAL PATCH AND AN ISLET WITH ITS SHORELINE are rocks, as a charted rock is: in mid-reach, 146 m to port of the
  // lane's line, she holds the lane past each, in both models. (No check said so: with islets, shoal patches or
  // shorelines dropped from the rocks, every check passed.)
  const kinds = [];
  for (const m of both) {
    const sh = land(rect(25, 1495, 35, 1505), "water shallower than 3.0 m"), wSh = model({ polys: banks.concat([sh]), marks: greens });
    const ring = rect(20, 1490, 40, 1510).concat([{ e: 20, n: 1490 }]), shore = { pts: ring, bb: bbOf(ring), kind: "the shoreline" };
    const wIs = Object.assign(model({ polys: banks.concat([land(rect(20, 1490, 40, 1510))]), marks: greens }), { lines: [shore] });
    for (const [what, w] of [["shoal patch", wSh], ["islet", wIs]]) { const r = lane(w, UP, { rockModel: m }); kinds.push({ what, m, r, w, e: eAtN(r.track, 1500) }); }
  }
  check("93r. ... AND A SHOAL PATCH, AND AN ISLET WITH ITS SHORELINE, in mid-reach: she holds the lane past each, in both models",
        kinds.every((q) => Math.abs(q.e - line) < 2 && q.r.how.reach === true && legsClear(q.r, q.w)),
        kinds.map((q) => q.what + " (" + q.m + "): e " + f1(q.e)).join("; ") + " (the lane's line: e " + f1(line) + ")");
  // (s) HER OWN PATH: a rock 4.5 m to port of her path where the lane eases in moves nothing - the lane does not bring her
  // nearer it than her path already is. (Asked only of the floor, it took the lane away for 265-300 m.)
  const ownN = [-50, 0, 50, 100, 175, 250], own = [-125, -100].map((n) => {
    const rk = hazard(-104.5, n), w = model({ polys: REACH_BANKS, marks: REACH_MARKS, points: [rk] }), r = lane(w, REACH_UP);
    return { n, r, w, e: ownN.map((x) => eAtN(r.track, x)) };
  });
  const ownO = ownN.map((x) => eAtN(open69.track, x));
  check("93s. ... AND A ROCK HER PATH ALREADY PASSES INSIDE ITS FLOOR moves nothing: 4.5 m to port of her path where the lane "
        + "eases in, the lane is laid as with no rock",
        own.every((q) => q.e.every((x, i) => Math.abs(x - ownO[i]) < 1) && q.r.how.reach === true && legsClear(q.r, q.w)),
        own.map((q) => "rock at n " + q.n + ": e " + q.e.map(f1).join(",")).join("; ") + " (with no rock: " + ownO.map(f1).join(",") + ")");
  // (t) THE RE-LAY THRESHOLD: a rock 6-8 m off the lane's line, inside its 9 m floor, is passed at the floor. (Laid again
  // only well inside the floor, the line passed it 6-8 m off and the backstop took the whole lane.)
  const near8 = [-8, -7, -6, 6, 7, 8].map((dx) => {
    const rk = hazard(line + dx, 1500), w = model({ polys: banks, marks: greens, points: [rk] }), r = lane(w, UP);
    return { dx, r, w, off: nearestTo(r.track, pt(rk)) };
  });
  check("93t. ... AND A ROCK 6-8 m OFF THE LANE'S LINE, inside its floor, is passed at the floor, the lane kept",
        near8.every((q) => q.off >= floorL - 0.5 && q.r.how.reach === true && legsClear(q.r, q.w)),
        near8.map((q) => q.dx + " m: " + f1(q.off) + " m off").join("; ") + " (the floor " + floorL + ")");
  // (u) THE MARKED DISTANCE: a shoal patch whose face is 40 m from green 15 - inside ROCK_MARKED_M, 50 m - is the edge
  // that green marks, as 93j's 5 m from it is: the lane stands further to starboard abeam of it, in both models.
  const mk40 = both.map((m) => {
    const s = land(rect(-130, 1460, -120, 1540), "water shallower than 3.0 m"), w = model({ polys: banks.concat([s]), marks: greens });
    const r = lane(w, UP, { rockModel: m });
    return { m, r, w, e: eAtN(r.track, 1500) };
  });
  check("93u. ... AND A SHOAL 40 m FROM A GREEN is the edge that green marks too (ROCK_MARKED_M, 50 m): the lane stands further "
        + "to starboard abeam of it, in both models",
        mk40.every((q) => q.e > line + 4 && q.r.how.reach === true && legsClear(q.r, q.w)) && R.ROCK_MARKED_M === 50,
        mk40.map((q) => q.m + ": e " + f1(q.e)).join("; ") + " (with no shoal, the line " + f1(line) + ")");
}
// ── 95-98. THE REACH'S OLDER MUTATION SURVIVORS (2026-10-05): each check fails on the mutant it pins ──
// 95. A MARK NO COUNT SPEAKS FOR IS ASKED OF THE ROUTE THAT SHIPS TOO. A mark with no number says nothing about the
// direction of buoyage, so the marks stage reads no hand for it and counts it nowhere; the lane's cone keeps the line it
// lays inside it, but the smoothing and the gate come after the cone and know nothing of it. So the lane is not kept where
// such a mark lies between the route that ships with it and the route without it (`crossed`, in channelLaneRoute's
// finish). The reach of 69 with an UNNUMBERED red buoy (charted, so a buoy point the gate routes round): 3 m to starboard
// of her path, passed at the buffer, the lane eases back onto her path to pass it, the smoothing rounded that notch to
// 1.1 m off it and the gate's patch went round its far side - it shipped 4.6 m on her PORT hand, bound up a reach whose
// reds are kept to starboard, with nothing counted and nothing said; and 5.2 m where her path bends 8 m round one
// standing on its line.
{
  const run = (U, base) => {
    const marks = REACH_MARKS.concat([U]);
    const w = model({ polys: REACH_BANKS, marks, points: marks.map((m) => ({ e: m.e, n: m.n, r: 0, kind: "a channel buoy" })) });
    const r = lane(w, base);
    return { r, w, x: offOf(r.track, U), x0: offOf(base, U) };
  };
  const bend = [{ e: -100, n: -1500 }, { e: -100, n: 1260 }, { e: -108, n: 1280 }, { e: -100, n: 1300 }, { e: -100, n: 4500 }];
  const rows = [run(mark(-97, 1300, RED, undefined, "unnamed"), REACH_UP), run(mark(-97, 1750, RED, undefined, "unnamed"), REACH_UP),
                run(mark(-100, 1280, RED, undefined, "unnamed"), bend)];
  check("95. A MARK NO COUNT SPEAKS FOR IS NOT CROSSED BY THE LANE: an unnumbered red buoy her path passes to starboard - "
        + "at the buffer, or bent round - is passed to starboard by the route that ships",
        rows.every((q) => q.x0 > 0 && q.x > 0 && legsClear(q.r, q.w)),
        rows.map((q) => "her path " + f1(q.x0) + " m, the route that ships " + f1(q.x) + " m to starboard (lane " + q.r.how.reach + ")").join("; ")
          + " (with the lane kept across it: -4.6, -4.6, -5.2)");
}
// 95b-c. Two seeded worlds of the marks reviewer's fuzz on one transit (`reaches`): each part [seed, M, PL, PATH, dN, off]
// is laid dN m north of where its seed laid it (south, negative) and numbered on by `off`, so that no mark of the one
// reads a mark of the other; its marks named as seeded() names them, and every mark a buoy point.
const reaches = (parts) => {
  const marks = [], polys = [], route = [];
  for (const [seed, M, PL, PATH, dN, off] of parts) {
    M.forEach(([e, n, side, num, fixed], i) => marks.push(mark(e, n + dN, side, num + (off || 0), "rock " + seed + " " + (num + (off || 0)) + (i % 7), !!fixed)));
    for (const [isLand, ring] of PL) polys.push(land(ring.map(([e, n]) => ({ e, n: n + dN })), isLand ? "land" : "a shoal"));
    for (const p of PATH) route.push({ e: p.e, n: p.n + dN });
  }
  return { marks, route, world: model({ marks, polys, points: marks.map((m) => ({ e: m.e, n: m.n, r: 0, kind: "a channel buoy" })) }) };
};
// 95b. THE REACH LANE IS KEPT MARK BY MARK, NOT BY THE COUNT. A lane that puts one mark on its wrong hand and another on
// its proper one leaves the count where it was. Two reaches on one transit (seeds 229 and 853, bound down, a 12 m
// standoff at the DriX's 5 m buffer; the second 6,263 m south of the first, numbered on from 101): in the first the lane
// leaves green 7 on her wrong hand, which the route without it has right; in the second it puts red 106 right, which the
// route without it has wrong - one wrong either way. Compared by the count, the lane shipped with green 7 9.3 m on her
// wrong hand and the buoyed reach claimed.
{
  const MA = [[205.4,629,1,2,0],[51.5,789.3,-1,3,0],[397.5,968.2,1,4,0],[513.7,1459.1,-1,5,0],[932.7,1980.8,1,6,0],
              [817.4,2677.8,-1,7,0],[1343.7,3096.1,1,8,0],[1748.3,3412.1,-1,9,0],[1979.9,3263.6,1,10,0],
              [2187.7,3443.2,-1,11,0],[2553.8,3464.3,-1,13,0]];
  const PLA = [[1,[[431.2,1461],[455.7,1440.8],[520.6,1519.5],[496.1,1539.7]]],
               [0,[[702.5,2685.4],[792.5,2660.6],[804.8,2705.3],[714.8,2730.1]]],
               [0,[[1330.3,3055.8],[1394.9,2998.9],[1446.6,3057.5],[1382,3114.5]]],
               [1,[[2148,3564.3],[2152.1,3475.2],[2220.3,3478.4],[2216.2,3567.4]]]];
  const PATHA = P2([[3167.6,3255.7],[3067.8,3338.3],[2969.6,3425.7],[2867.6,3501.3],[2745.5,3513.1],[2578.4,3472.3],
                   [2570.1,3446.4],[2521.6,3439.8],[2464.8,3407.4],[2349.9,3342.4],[2232.6,3282.9],[2114.8,3232.3],
                   [1996.3,3195.8],[1877,3177.1],[1774.2,3172.3],[1651.8,3178.8],[1560.4,3199.6],[1430.3,3188.4],
                   [1297.9,3181.4],[1168.8,3129.7],[1054.7,3070.2],[951,3001.6],[860.6,2921.4],[780,2749.5],
                   [826.4,2718.3],[835.2,2683.9],[835,2661.9],[775,2625.9],[770.7,2627.6],[776.8,2501.4],[794,2372.3],
                   [837.9,2243],[900.9,2127.1],[956.3,2010.6],[998.4,1893.2],[954.6,1692],[891.7,1589.8],
                   [812.4,1497.1],[718.9,1412.8],[602,1333.8],[482.4,1276.8],[363.4,1219.4],[250.8,1121.1],
                   [170.8,1024.9],[131.3,963.5],[54.1,871.7],[-8.6,767.4],[-58.6,617.6],[-63.5,488],[-58.2,355.3],
                   [-5.8,242.3],[11.6,123.5],[0,0]]);
  const MB = [[402.1,637.4,1,2,0],[386.3,1306.3,-1,3,0],[642.9,1696.8,1,4,0],[445.9,1934.2,-1,5,0],
              [523.1,2527.9,1,6,0],[379.4,2548.6,-1,7,1],[545.6,2541.5,1,8,0],[411.7,2834.3,-1,9,1],
              [817.4,3313.7,1,10,0],[831.9,3622.2,-1,11,0],[1203.2,3934.3,1,12,0]];
  const PLB = [[1,[[423.5,600.9],[468,593.4],[478.8,657.5],[434.3,665]]],
               [0,[[256.9,1308.9],[368.9,1282.4],[381.4,1335.5],[269.5,1362]]],
               [1,[[661.7,1670.1],[716.3,1673],[713.4,1728.3],[658.7,1725.4]]],
               [0,[[325.1,1855.6],[440.2,1861.7],[432.5,2005.7],[317.4,1999.5]]],
               [0,[[293.6,2502.8],[354.2,2494.9],[368.8,2607],[308.1,2614.9]]],
               [1,[[569.3,2469.2],[667.5,2456.5],[685.2,2592.6],[586.9,2605.3]]],
               [1,[[297.4,2817.1],[392.6,2804.8],[400.7,2867.6],[305.5,2880]]],
               [1,[[1185.3,3885],[1234.4,3817.9],[1304.7,3869.5],[1255.6,3936.5]]]];
  const PATHB = P2([[1543.8,4262.6],[1473.5,4155.5],[1393.1,4062.2],[1295.7,3992.1],[1171.3,3958.9],[1068.2,3903.4],
                   [964.7,3824.6],[866.1,3743],[775.8,3656.6],[705.1,3584],[626.4,3493.2],[560.1,3392.8],
                   [505.6,3283.2],[461,3165.8],[461.8,2998.9],[496.5,2873.4],[531.1,2747.9],[560.8,2623],
                   [505.1,2543.7],[505.1,2507.7],[547.1,2453.6],[553.1,2447.6],[626.4,2442.2],[666.7,2328.9],
                   [682.1,2175.1],[666.3,2054],[637.5,1932.3],[599.1,1810.1],[555.4,1687.6],[480.9,1579.8],
                   [409.5,1472.7],[345.6,1365.8],[401,1353],[407,1287],[390.6,1274.3],[293.2,1254.9],[255.2,1140.6],
                   [233.8,1011.6],[234,889.9],[247.3,766],[270.6,640.4],[299.7,513.8],[284.6,388.4],[254.6,265.9],
                   [189.7,165],[101.8,78.2],[0,0]]);
  const s = reaches([[229, MA, PLA, PATHA, 0, 0], [853, MB, PLB, PATHB, -6263, 100]]);
  const r = lane(s.world, s.route, { standoffM: 12, marks: true, charted: true }, 5);
  const g7 = s.marks.find((m) => m.num === 7), r106 = s.marks.find((m) => m.num === 106);
  check("95b. THE REACH LANE IS KEPT MARK BY MARK, NOT BY THE COUNT: a lane that puts green 7 on her wrong hand and red 106 "
        + "on its proper one is not kept - green 7 ships to starboard, and no buoyed reach is claimed",
        r.reachLaid === true && r.how.reach === false && offOf(r.track, g7) > 0,
        "laid " + r.reachLaid + ", claimed " + r.how.reach + "; green 7 lies " + f1(offOf(r.track, g7)) + " m to starboard, red 106 "
          + f1(offOf(r.track, r106)) + " (kept to port); " + JSON.stringify(r.how.marks) + " (compared by the count: green 7 -9.3, the reach claimed)");
}
// 95c. ... AND SO WHERE THE PLANNER RE-GATES (passage.js keepStandoff): the reach lane is asked again, mark by mark, of
// the routes the re-gate ships. Asked of routes already clear at the standoff - so nothing the re-gate splices decides
// it - in the reach of 69 bound up (12 m standoff, 5 m buffer): the lane's route jogs 25 m west of green 5, the route
// without it 25 m west of green 3 - one mark wrong either way, the count no different. Compared by the count, the lane
// shipped with green 5 25 m on her wrong hand and the buoyed reach claimed. (The pair: a lane that puts green 3 right
// and nothing wrong is kept.)
{
  const { nogo } = require("../static/js/state.js"), was = nogo.buffer;
  const w = model({ polys: REACH_BANKS, marks: REACH_MARKS,
                    points: REACH_MARKS.filter((m) => !m.fixed).map((m) => ({ e: m.e, n: m.n, r: 0, kind: "a channel buoy" })) });
  const jog = (n0) => [{ e: -100, n: -1500 }, { e: -100, n: n0 - 100 }, { e: -175, n: n0 - 20 }, { e: -175, n: n0 + 20 },
                       { e: -100, n: n0 + 100 }, { e: -100, n: 4500 }];   // west of the green at n0, 25 m off it
  const LL = (t) => t.map((p) => ll(p.e, p.n)), pathLL = LL(REACH_UP);
  let kr, trade, accept;
  try {
    nogo.buffer = 5;                                   // (keepStandoff's floor is the operator's buffer)
    kr = R.channelLaneRoute(pathLL, F, w, 5, { standoffM: 12, marks: true, charted: true });
    const ask = (laned, plain) => {
      const ks = require("../static/js/passage.js").keepStandoff({ ...kr, route: LL(laned), keep: [], chartOwn: null,
        withoutReach: { route: LL(plain), keep: [] } }, pathLL, F, w, 12);
      return { ks, t: ks.route.map((p) => F.toEN(p)) };
    };
    trade = ask(jog(2500), jog(1500));
    accept = ask(REACH_UP, jog(1500));
  } finally { nogo.buffer = was; }
  const g3 = REACH_MARKS[2], g5 = REACH_MARKS[4];
  check("95c. ... AND MARK BY MARK WHERE THE PLANNER RE-GATES: a lane whose route puts green 5 on her wrong hand is not "
        + "kept for putting green 3 right - green 5 ships to port, and no buoyed reach is claimed; a lane that puts green 3 "
        + "right and nothing wrong is kept",
        kr.how.reach === true && trade.ks.how.reach === false && offOf(trade.t, g5) < 0
          && accept.ks.how.reach === true && offOf(accept.t, g3) < 0,
        "trade: green 5 " + f1(offOf(trade.t, g5)) + ", green 3 " + f1(offOf(trade.t, g3)) + " m (+ = to starboard), reach "
          + trade.ks.how.reach + ", " + JSON.stringify(trade.ks.how.marks) + "; the pair: green 3 " + f1(offOf(accept.t, g3))
          + ", reach " + accept.ks.how.reach + " (compared by the count: green 5 25.0, the reach claimed)");
}
// 96. A RUN'S PASS POINTS ARE HELD, IN A SET TOO (the cone's holds, mutation review 2026-10-05). 76b's water bound out
// of Little Bay at the DriX's 5 m buffer in a 12 m set. Hen Island Ledge Buoy 1 stands inside its ledge's charted
// extent, so its run is laid wide of the ledge (46.5 m off the buoy, not 14); Fox Point Rock Buoy 3's run arcs round the
// bend. Every pass point of a run past a mark she keeps to starboard is held where the marks stage laid it (HOLD round
// each), and the reach lane is told which marks have one (`placed`). Not held, the lane moved Hen Island Ledge's pass
// point 0.6 m - enough that it was no longer a vertex of her path to keep - the smoothing cut the run's corner toward
// the buoy, and the lane's route came 5.8 m off the ledge: inside the standoff, where the route without the lane passes
// 13 m off. With the runs not told to the lane, 5.5 m off and a 50 degree turn beside it. Either way the backstop
// (channelLaneRoute's `finish`) stood the whole reach lane down.
{
  const pt = (e, n, CATLAM, OBJNAM) => { const q = ll(e, n);
    return { role: "chan_mark", cls: "Buoy_Lateral_point", props: { CATLAM, OBJNAM }, geometry: { type: "Point", coordinates: [q.lon, q.lat] } }; };
  const ko = K.buildKeepouts(F, [pt(-3387, -9, 1, "Hen Island Ledge Buoy 1"), pt(-3985, -6, 2, "Eight-Foot Rock Buoy 2"),
    pt(-4103, -183, 1, "Fox Point Rock Buoy 3"), pt(-3819, -712, 2, "The Rocks Buoy 4"), pt(-3653, -1376, 2, "Little Bay Buoy 4A"),
    pt(-4376, -4229, 2, "Great Bay Entrance Buoy 6")], {});
  for (const [e, n, r] of [[-3947.2, -1037.2, 0], [-3803.5, -1250.6, 0], [-3856.4, -1232.0, 0], [-3708.7, -1439.8, 0], [-3673.5, -1447.3, 0],
                           [-3998.7, -1024.2, 0], [-4035.5, 18.0, 50], [-3368.0, -33.1, 50], [-4071.2, -737.5, 50], [-3897.9, -712.9, 50],
                           [-4096.1, -659.6, 50], [-3918.2, 294.1, 50], [-3724.8, 360.0, 50]]) ko.points.push({ e, n, r, kind: "a charted hazard" });
  const OUT = [[-4013, -3399], [-3987.3, -1657.3], [-3973.5, -782.4], [-4002.6, -747.0], [-4007.8, -711.7], [-4012.0, -674.9], [-3967.9, -642.7],
               [-3917.6, -190.4], [-3906.0, -158.9], [-3416.7, 31.4], [-3382.8, 38.5], [-3343.8, 78.3], [-3313.5, 31.6], [-2804.2, -95.8],
               [-1231, -488]].map(([e, n]) => ({ e, n }));
  const by = (re) => ko.marks.find((m) => re.test(m.sys)), m1 = by(/hen/), m3 = by(/fox/);
  const r = lane(ko, OUT, { standoffM: 12 }, 5), pass = R.MARK_PASS_M(5, 12), ledge = { e: -3368.0, n: -33.1, r: 50 };
  const q1 = offOf(r.track, m1), q3 = offOf(r.track, m3);
  const offLedge = nearestTo(r.track, (p) => Math.hypot(p.e - ledge.e, p.n - ledge.n)) - ledge.r;
  check("96. A RUN'S PASS POINTS ARE HELD, IN A SET TOO: bound out of Little Bay at a 5 m buffer in a 12 m set, Fox Point "
        + "Rock Buoy 3 close to starboard on its arc, Hen Island Ledge Buoy 1 to starboard on its wide run, the ledge no "
        + "nearer than the standoff, and the buoyed reach still ridden",
        r.how.reach === true && Math.abs(q3 - pass) < 2 && q1 > pass && offLedge >= 12 && r.how.marks.wrong === 0
          && sharpest(r.track) < 45 && legsClear(r, ko),
        "3: " + f1(q3) + " (want " + pass + "), 1: " + f1(q1) + " m to starboard; the ledge passed " + f1(offLedge) + " m off its extent; how.reach "
          + r.how.reach + "; sharpest turn " + f1(sharpest(r.track)) + " (runs not held: the lane's route 5.8 m off the ledge, and the lane stood down)");
}
// 96b. A MARK ON HER STARBOARD HAND HOLDS THE LANE OFF BY THE WATER BETWEEN THEM, ROUND A HARD TURN TOO. Her route turns
// hard to starboard (95 and 105 degrees) in a river 360-400 m wide, 60-150 m off its port bank; an unnumbered red buoy
// (no hand read: a mark's berth) stands inside the turn, 60-70 m off both legs. The reach lane's own line (asked of
// buoyedReachLane as channelLaneRoute asks it) keeps the buoy its berth off, wherever her path begins: the cap by the
// water between each sample and the buoy does that, not the cap at the buoy's own station. Asked of the line and not of
// `how.reach`: whether the shipped route keeps the lane depends on the smoothing and the backstop, and with the start
// moved 50 m the backstop stands the lane down in both worlds with the cap in place.
{
  const dir = (deg) => [Math.sin(deg * Math.PI / 180), Math.cos(deg * Math.PI / 180)];
  const BERTH = R.MARK_PORT_BERTH * PASS;
  const bend = (th, x, sb, pw, L1) => {
    const u2 = dir(th), bis = dir((180 + th) / 2), half = (180 - th) / 2 * Math.PI / 180, pn = [-u2[1], u2[0]];
    const at = (r) => ({ e: bis[0] * r, n: bis[1] * r }), m = at(x / Math.sin(half)), A = at(sb / Math.sin(half));
    const o2 = (t) => ({ e: pn[0] * pw + u2[0] * t, n: pn[1] * pw + u2[1] * t }), tc = (-pw - pn[0] * pw) / u2[0];
    const inner = land([A, { e: A.e, n: A.n - 4000 }, { e: A.e + u2[0] * 4000, n: A.n + u2[1] * 4000 }]);
    const outer = land([{ e: -pw, n: -4000 }, o2(tc), o2(4000), { e: o2(4000).e + 3000, n: o2(4000).n }, { e: 6000, n: 6000 },
                        { e: -6000, n: 6000 }, { e: -6000, n: -4000 }]);
    const buoy = mark(m.e, m.n, RED, null, "mid rock");
    const marks = [mark(-pw + 20, -700, GREEN, 1, "able rock"), mark(o2(700).e - pn[0] * 20, o2(700).n - pn[1] * 20, GREEN, 3, "cast ledge"), buoy];
    const w = model({ polys: [inner, outer], marks, points: ptsOf(marks) });
    const path = [{ e: 0, n: -L1 }, { e: 0, n: 0 }, { e: u2[0] * 1500, n: u2[1] * 1500 }];
    const passed = R.markPassRoute(path.map((p) => ll(p.e, p.n)), F, w, BUF, {});
    const rl = R.buoyedReachLane(passed.path, F, w, BUF, { marks: passed.marks });
    const r = lane(w, path);
    return { r, w, used: rl.used, lx: offOf(rl.path.map((p) => F.toEN(p)), buoy), x: offOf(r.track, buoy) };
  };
  const ways = [];
  for (const L1 of [1300, 1450, 1500, 1550, 1700]) ways.push(bend(105, 60, 250, 150, L1), bend(95, 70, 300, 60, L1));
  check("96b. A MARK ON HER STARBOARD HAND HOLDS THE LANE OFF BY THE WATER BETWEEN THEM, round a hard turn too: the reach "
        + "lane's own line keeps an unnumbered red buoy inside a 105 and a 95 degree turn its berth off to starboard, "
        + "wherever her path begins, and the route that ships never has it on her wrong hand",
        ways.every((q) => q.used && q.lx >= BERTH - 3 && q.x > 0 && legsClear(q.r, q.w)),
        "the lane's line: " + ways.map((q) => f1(q.lx)).join(", ") + " m to starboard (berth " + f1(BERTH)
          + "); shipped: " + ways.map((q) => f1(q.x)).join(", ") + "; how.reach " + ways.map((q) => q.r.how.reach).join(", ")
          + " (with no cap by the water between: the line put it -5.6 to 15.1 m)");
}
// 96c. A CLOSE MARK WITH NO RUN IS HELD TWO SMOOTHING STEPS EITHER SIDE. The reach of 69 with red 2 a BUOY 4 m to
// starboard of her path where she threads a gut between it and a spit of land 7 m to port: the nearest pass the marks
// stage can lay is beyond the spit, 46-48 m off the buoy, and it cannot be joined (MARK_JOIN_MAX_DEG), so red 2 has no
// run of its own and no kept vertex. Past it the lane eases out toward red 4's line; with nothing held within two
// smoothing steps of red 2 (only the cone's own flat, KH samples), the smoothing rounded the foot of that ease into the
// buoy's buffer, the gate spliced a patch round its far side, and the backstop stood the whole reach lane down -
// wherever the buoy stood among her samples (78 is the same hold in a set).
{
  const runs = [1000, 1025].map((n2) => {
    const red2 = mark(-96, n2, RED, 2, "baker rock");
    const marks = [mark(-150, 500, GREEN, 1, "able rock"), red2, mark(-150, 1500, GREEN, 3, "cast ledge"),
                   mark(190, 2000, RED, 4, "dog light", true), mark(-150, 2500, GREEN, 5, "easy shoal")];
    const w = model({ polys: REACH_BANKS.concat([land(rect(-113, n2 - 150, -107, n2 + 150))]), marks, points: ptsOf(marks) });
    const r = lane(w, REACH_UP);
    const k = r.marks.find((q) => q.m === red2);
    return { r, w, x: offOf(r.track, red2), bare: !!k && k.keepStbd === true && !k.placed };
  });
  check("96c. A CLOSE MARK WITH NO RUN IS HELD: a red buoy 4 m off her path in a gut beside a spit of land, with no run of its own, "
        + "stays on her starboard hand outside the buffer wherever it stands among her samples, and the buoyed reach is still ridden",
        runs.every((q) => q.bare && q.x >= BUF && q.r.how.reach === true && q.r.how.marks.wrong === 0 && legsClear(q.r, q.w)),
        "red 2 at n 1000, 1025 lies " + runs.map((q) => f1(q.x)).join(", ") + " m to starboard (her path: 4.0); no run: "
          + runs.map((q) => q.bare).join(", ") + "; how.reach " + runs.map((q) => q.r.how.reach).join(", ")
          + " (not held past the cone's own flat: the lane's route had it 4.6 and 5.5 m on her WRONG hand, and the lane stood down)");
}
// 97. THE HOLD ASKS THE WATER A SMOOTHING STEP EITHER SIDE OF EACH SAMPLE IT HOLDS. The lane is held out past a
// reach's end only where the water is open as far as the ease leaves her - there AND over the smoothing step either
// side, because the smoothing rounds the foot of an ease toward whatever stands beside it. Asked at the held sample
// alone, the foot of the ease came to rest beside 80e's bridge support, 10 m to starboard of her path between two of
// her samples: the smoothing rounded her 4.9-5.7 m off it, inside the lane's floor, the backstop dropped the whole
// lane for it, and she rode up the PORT side of 69's channel (e -100) for two kilometers; past the reach's end she
// passed one 8.0 m off. (80e asks only where she is abeam of the support - which the route without the lane is too.)
{
  const rows = [62.5, 87.5, 137.5, 2887.5, 2962.5, 3062.5].map((n) => {
    const sup = { e: -90, n, r: 0, kind: "a bridge support" }, w = model({ polys: REACH_BANKS, marks: REACH_MARKS, points: [sup] });
    const r = lane(w, REACH_UP);
    return { n, reach: r.how.reach, e15: eAtN(r.track, 1500), off: nearestTo(r.track, (p) => Math.hypot(p.e - sup.e, p.n - sup.n)), ok: legsClear(r, w) };
  });
  check("97. THE HOLD ASKS THE WATER A SMOOTHING STEP EITHER SIDE: a bridge support 10 m to starboard of her path beside "
        + "the foot of the lane's ease - in, or off past the reach's end - costs her no reach, and is passed at the lane's "
        + "floor or more",
        rows.every((q) => q.reach === true && q.e15 != null && Math.abs(q.e15 - 82.5) < 6 && q.off >= REACH_LIMIT - 0.5 && q.ok),
        rows.map((q) => "n " + q.n + ": reach " + q.reach + ", e@1500 " + f1(q.e15) + ", " + f1(q.off) + " m off").join("; ")
          + " (the floor " + REACH_LIMIT + "; asked at the held sample alone, the first five shipped no reach - e -100 at n 1500 - "
          + "and the sixth passed it 8.0 m off)");
}
// 98. WATER WIDER THAN REACH_MAX_WIDTH_M AT ONE CROSS-SECTION IS NO CHANNEL'S, HOWEVER NARROW THE RIVER ROUND IT.
// Whether the water is a channel is asked twice: of its edges as they typically stand over CHART_EDGE_WINDOW_M (83's
// rock), and of the cross-section itself. A river 840 m between its banks, green buoys 50 m off the west one: from the
// greens' line to the east bank's standoff is 781 m, a channel. For 400 m its east bank stands 100 m further off - less
// than CHART_OPENING_FRAC of the water's width, so no opening and the wider water is the river's own (73b) - and there
// it is 881 m across, wider than REACH_MAX_WIDTH_M: she holds the lane she rides either side of it and is not taken
// three quarters across it. In a river 100 m narrower the same widening is 781 m across, and she is (THE CONTROL).
// Asked of the typical edges alone, the wider river's widening was laned too: 67 m further toward the far bank, three
// quarters across 881 m of water; and on a real search path up the Piscataqua (buffer 5) two cross-sections 815 and
// 835 m across moved the route that shipped 22 m across the river.
{
  const greens = [500, 1500, 2500].map((n, i) => mark(-350, n, GREEN, 1 + 2 * i, "broad " + i));
  const river = (east) => [land(rect(-1400, -1600, -400, 4600)), land(rect(east, -1600, east + 1000, 1300)),
                           land(rect(east, 1700, east + 1000, 4600)), land(rect(east + 100, 1300, east + 1000, 1700))];
  const ns = [1300, 1400, 1500, 1600, 1700];
  const run = (east) => {
    const w = model({ polys: river(east), marks: greens }), r = lane(w, [{ e: 0, n: -1500 }, { e: 0, n: 4500 }]);
    return { w, r, e0: eAtN(r.track, 1000), e: ns.map((n) => eAtN(r.track, n)) };
  };
  const wide = run(440), narrow = run(340), out = (q) => Math.max(...q.e.map((x) => x - q.e0));
  check("98. WATER WIDER THAN REACH_MAX_WIDTH_M AT ONE CROSS-SECTION IS NO CHANNEL'S, however narrow the river round it: "
        + "where the bank stands 100 m further off and the water there is 881 m across she holds the lane she rides either "
        + "side of it; where the same widening is 781 m across she rides three quarters across it",
        wide.e.every((x) => x != null && Math.abs(x - wide.e0) < 3) && Math.abs(wide.e0 - 235.75) < 3
          && out(narrow) > 50 && Math.abs(narrow.e0 - 160.75) < 3
          && [wide, narrow].every((q) => q.r.how.reach === true && q.r.how.marks.wrong === 0 && legsClear(q.r, q.w))
          && R.REACH_MAX_WIDTH_M === 800 && R.CHART_OPENING_FRAC === 0.15,
        "the wider river: e@1000 " + f1(wide.e0) + " (three quarters across 781 m: 235.7), e@" + ns.join(",") + " = "
          + wide.e.map(f1).join(",") + " (laned across the 881 m she was taken to e 303, 67 m out); the narrower: e@1000 "
          + f1(narrow.e0) + ", e@" + ns.join(",") + " = " + narrow.e.map(f1).join(",") + " - " + f1(out(narrow)) + " m out");
}
// 77. THE WORDS, and the planner's own passes: `how.reach` reads "right of center in the buoyed channel", beside
// whatever else was ridden; a plan without it reads as it did.
{
  const P = require("../static/js/passage.js"), mk = { kept: 5, wrong: 0, stbd: 2, port: 3 };
  const withR = P.buoyageNote(true, false, { charted: true, reach: true, pairs: false, narrow: false, marks: mk, gaps: false });
  const only = P.buoyageNote(true, false, { charted: false, reach: true, pairs: false, narrow: false, marks: mk, gaps: false });
  const none = P.buoyageNote(true, false, { charted: true, reach: false, pairs: false, narrow: false, marks: mk, gaps: false });
  const page = fs.readFileSync(ASV_HTML, "utf8"), pj = fs.readFileSync(path.join(__dirname, "..", "static", "js", "passage.js"), "utf8");
  check("77. THE WORDS: a buoyed reach is said on the banner and the Intent card, and travels through the standoff's "
        + "re-gate and a drawn transit's legs",
        withR === "Rule 9: right of center in the charted channel; right of center in the buoyed channel; 2 marks left to starboard, 3 marks left to port"
          && only === "Rule 9: right of center in the buoyed channel; 2 marks left to starboard, 3 marks left to port"
          && !/buoyed/.test(none) && /how && how\.reach/.test(page) && /BUOYED channel/.test(page)
          && /reach: lane && reach,/.test(pj) && /\["pairs", "charted", "narrow", "reach", "gaps"\]/.test(pj),
        "\"" + only + "\"");
}
// 50. The Rule 9 lane's routes ask the knot prune for the stub rule, and a maneuver's do not (see 45).
{
  const asked = lane(C1, NB), maneuver = lane(C1, NB, { charted: false, marks: false });
  check("50. THE STUB RULE is asked for on the Rule 9 lane's routes and not on a maneuver's",
        asked.stubs === true && maneuver.stubs === false, "lane " + asked.stubs + "; maneuver " + maneuver.stubs);
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED of " + ran : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
