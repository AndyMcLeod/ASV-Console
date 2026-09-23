/* ========================================================================
 * ⚠⚠ ASV OWNS THIS FILE NOW (2026-08-31). DO NOT RE-VENDOR IT.
 *
 * Andy: "stop updating other projects. We concentrate only on ASV Console
 * moving forward. There may be components of other projects that we pull over."
 *
 * So the flow is ONE WAY from here: asv_core is a place to pull FROM, never a
 * place this repo writes back to. The vendor header below is kept for
 * PROVENANCE -- it records where this body came from -- but its instruction is
 * now wrong for this repo, and dangerously so:
 *
 *   ⚠ RUNNING `python tools/vendor.py` IN THE asv_core REPO WOULD OVERWRITE
 *     THIS FILE AND SILENTLY DELETE TWO DELIBERATE CHANGES. If a `--check`
 *     there reports this copy as DRIFTED, that is correct and expected: it has
 *     drifted, on purpose, and here is the whole of it.
 *
 *       1. clearanceM -- the boat's LIVE distance to the keep-out model, which
 *          is the quantity the runtime guard watches. asv_core does not have
 *          it. Covered by tests/clearance_guard.js.
 *       2. hazPassable, and buildKeepouts DROPPING a hazard the chart proves
 *          passable rather than merely zeroing its extent (2026-09-09). The
 *          core still leaves a buffered point behind, which is what split a
 *          survey line beside a rock with 8.8 m of water over it. Covered by
 *          tests/wreck_clearance.js.
 *
 * The fix is covered by tests/clearance_guard.js, which runs in this repo's own
 * pre-commit hook. If it is ever wanted upstream, carry it there as its own
 * deliberate piece of work -- never by syncing in this direction.
 * ======================================================================== */
/* ========================================================================
 * VENDORED FROM asv_core -- DO NOT EDIT THIS COPY.
 *
 *   source : asv_core_js/keepouts.js
 *   sync   : python tools/vendor.py            (from the asv_core repo)
 *   verify : python tools/vendor.py --check    (fails if this copy drifted)
 *
 * NO ABSOLUTE PATH APPEARS ABOVE, AND THAT IS DELIBERATE. Two of these repos
 * publish scrubbed PUBLIC mirrors, and Transit's exporter ABORTS on anything
 * matching [A-Z]:\Claude -- absolute paths name private sibling projects and
 * point a cloner at a drive they do not have. A header naming a path would be
 * publish-safe only for as long as somebody maintained a substitution rule for
 * it in each exporter separately. Naming the repo instead is safe by
 * construction, in every consumer, including ones that do not exist yet.
 *
 * A copy rather than an import because this repo has to stand on its own: it is
 * a separate repository, and this file is opened by path rather than imported
 * as a package. The old trade was drift -- a vendored file did not follow its
 * source, which is how the estate grew three copies of currents.py. The --check
 * above removes that trade: this copy cannot diverge without failing a suite.
 *
 * THIS CONSUMER, SPECIFICALLY:
 * THIS CONSOLE IS WHERE THE LAYER CAME FROM -- WorldView's file says so in
 * its own header -- and the bodies came back MEASURED, not assumed. ASV's
 * chart.js against WorldView's keepouts.js, both handed this console's flat
 * frame, 2026-08-20:
 *
 *     buildKeepouts    0.000e+0 m over 612 vertices, every bucket count
 *                      identical -- and again with areas enforced, hazards
 *                      off, land off, and a 2.0-6.0 m depth window
 *     blocked          0 of 1200 disagree (805 blocked)
 *     blockedInfo      0 of 1200 -- same kind, same type
 *     legClear         0 of 400 (70 clear, 330 blocked)
 *     firstBlockAlong  0 of 400, worst reported position 0.000e+0 m
 *     markId 0 of 10 names; markSystems, pairGates, systemCenterline,
 *       extendCenterline and channelPolys JSON-identical
 *     depthExcluded 0 of 90; hazExtent 0 of 63
 *
 * ADOPTION HERE IS BY WRAPPER FOR FOUR OF THEM, AND THAT IS A COST, STATED.
 * buildKeepouts, hazExtent, depthExcluded and nogoKind read V.* and sea.* in
 * this console where the core takes options, so chart.js keeps its own
 * signatures and passes the state through at one seam. Everything else --
 * blocked, blockedInfo, legClear, firstBlockAlong, channelPolys, markId,
 * markSystems, systemCenterline, extendCenterline, pairGates and the four
 * constants -- is a plain re-export, because the frame ruling made the
 * signatures identical.
 *
 * ONE ANSWER CHANGED, AND NOTHING CAN REACH IT. nogoKind("chan_mark", false)
 * said "land" here and "a channel buoy" in WorldView. buildKeepouts is the
 * only caller in either repo and it handles marks and CONTINUES before
 * nogoKind is called, so the two always agreed about the model. The core
 * keeps the correct answer; tests/keepouts.py pins the unreachability rather
 * than the strings.
 *
 * ONE FIELD IS NEW ON THE BUOY POINTS. This console pushed channel-buoy
 * keep-outs with no `r` key at all; the core writes `r: 0`. Every reader of
 * that field in this repo -- chart.js twice, the vendored raster once -- goes
 * through `pt.r || 0`, and asv.html only ever reads ko.points.length.
 * Checked, not assumed.
 *
 * NOT ADOPTED, AND STILL BLOCKED ON THE SAME PREREQUISITE: clipLine,
 * featuresBboxRef, punchOut, arcPts, minTurnRadiusM and teardropTurn are
 * inline in asv.html's 4,500-line script block. They cannot be imported,
 * measured or vendored until they come out of it -- and clipLine ALSO
 * differs from WorldView's, so it is a merge as well as an extraction.
 *
 * Edit the core file and re-run the sync. Everything below is verbatim.
 */

/**
 * asv_core · keep-outs — what the chart says, and whether the vessel may be there.
 *
 * The keep-out MODEL and the questions routing asks of it:
 *
 *   `buildKeepouts(frame, feats, opts)`  role-tagged ENC geometry → the model
 *   `blocked(p, ko, buf)`                may the vessel be at this point?
 *   `legClear(a, b, frame, ko, buf)`     may it run this straight leg?
 *   `firstBlockAlong(...)`               and if not, what stops it, and where?
 *
 * plus the CHANNEL structure the COLREGS Rule 9 lane rides — `markId`,
 * `markSystems`, `systemCenterline`, `extendCenterline`, `pairGates`,
 * `channelPolys`.
 *
 * ─ WHY THIS FILE EXISTS ─
 *
 * The ASV console and WorldView had this layer twice. A textual diff said the
 * bodies were all different; run side by side over the same features they are
 * one algorithm with two parameter lists. Measured 2026-08-20 BEFORE the move,
 * ASV's `chart.js` against WorldView's `globe/keepouts.js`, both handed ASV's
 * flat frame:
 *
 *   buildKeepouts   0.000e+0 m over 612 vertices, counts identical in every
 *                   bucket (polys lines points marks sys chans), and again
 *                   with areas enforced, hazards off, land off, and a
 *                   2.0–6.0 m survey depth window
 *   blocked         0 of 1200 disagree (805 blocked)
 *   blockedInfo     0 of 1200 — same kind, same type
 *   legClear        0 of 400 disagree (70 clear, 330 blocked)
 *   firstBlockAlong 0 of 400, worst reported position 0.000e+0 m
 *   markId          0 of 10 names · markSystems, pairGates, systemCenterline,
 *                   extendCenterline, channelPolys — JSON-identical
 *   depthExcluded   0 of 90 · hazExtent 0 of 63
 *
 * ─ THE ONE PLACE THEY DISAGREED, AND IT IS UNREACHABLE ─
 *
 * `nogoKind('chan_mark', false)` answered "land" in ASV and "a channel buoy" in
 * WorldView. Neither console can reach it: `buildKeepouts` handles `chan_mark`
 * and `continue`s BEFORE `nogoKind` is called, and `buildKeepouts` is the only
 * caller in either repo. WorldView's answer is kept because it is the correct
 * one — the buoy points it builds are labeled "a channel buoy" at the push
 * site, so the two agree about the model and only ever disagreed about a
 * question nothing asks. `tests/keepouts.py` pins both halves of that claim.
 *
 * ─ THE FRAME IS PART OF THE MODEL ─
 *
 * Rings, paths and points are projected into a local east/north plane at BUILD
 * time and never re-projected — that is what makes the point tests cheap enough
 * to run thousands of times per line. So pass the SAME frame to `blocked`,
 * `legClear` and `firstBlockAlong` that built the model, or the answers are
 * about somewhere else.
 *
 * A `frame` is duck-typed `{toEN(p) → {e,n}, fromEN(e, n) → {lat,lon}}`, which
 * is deliberately the narrowest thing both consoles can supply. Hand it ASV's
 * FLAT pair and you get ASV's numbers; hand it WorldView's ELLIPSOIDAL pair and
 * you get WorldView's, 1.719 m apart on the same features. That divergence is
 * real and documented, and it is why the core ships both frame constructors:
 * neither console changes behavior on the day it adopts this file.
 *
 * ─ WHAT IS DELIBERATELY NOT HERE ─
 *
 * `keepoutFrame`, `keepoutModel`, `fetchKeepouts` and `importKeepouts` are
 * WorldView's own — they know its `/api/enc` endpoints, and ASV's equivalents
 * are still inline in `asv.html`.
 *
 * `clipLine` looks like it belongs with `legClear` and does NOT. Both consoles
 * have one, and they are not the same function: WorldView interpolates the
 * clipped ends in ENU METERS and converts back through the frame, while ASV
 * interpolates in LAT/LON directly. Under a flat frame those are nearly the
 * same answer and under an ellipsoidal one they are not, so it is a merge to
 * decide rather than a body to move. It stays in WorldView.
 */

// The planar primitives. `./geometry.js` resolves to the core copy in BOTH
// destinations, but by two different routes: WorldView's vendored tree keeps
// the natural name (`core/geometry.js` beside this file), while ASV's flat
// layout renames the core copy to `core_geometry.js` and its own
// `static/js/geometry.js` re-exports all seven from it. `tests/geometry.py`
// asserts that re-export by IDENTITY — `app.dSeg === vendored.dSeg` — so the
// hop this import takes in ASV is exactly the one already under test. A console
// that grew a private `dSeg` back would fail that check, not silently feed a
// different primitive to the model.
import {
  bbOf, inBB, dSeg, pinp, eachRing, eachPath, eachPoint,
} from './geometry.js';

export { bbOf, inBB, dSeg, pinp, eachRing, eachPath, eachPoint };

/** Charted point hazards whose EXTENT the chart does not give. */
export const HAZ_UNKNOWN_EXTENT = new Set([
  'Wreck_point', 'Hulk_point', 'Obstruction_point', 'Underwater_Awash_Rock_point',
]);

/**
 * A wreck with a CHARTED depth over it is a known quantity: if the corrected
 * sounding clears the navigability floor by this margin the vessel can pass
 * over it, and the hazard collapses back to a point.
 */
export const WRECK_CLEAR_MARGIN_M = 1.0;

/**
 * Defaults, from the ASV console's vessel fallbacks — and they are the same
 * numbers on both sides, checked rather than assumed: ASV's `V.NOGO_MIN_DEPTH_M`,
 * `V.WRECK_RADIUS_M` and `V.NOGO_BUFFER_M` equal these three exactly.
 */
export const DEFAULTS = {
  minDepthM: 1.0,        // the navigability floor
  bufferM: 3,            // keep-clear margin around every keep-out
  wreckRadiusM: 50,      // assumed extent of a hazard the chart does not size
  waterOffsetM: 0,       // live water level above chart datum; see depthExcluded
};

/**
 * Which keep-out classes are armed, and the default state of each.
 *
 * A CHARTED AREA IS ADVISORY BY DEFAULT. The shoreline, the structures, the
 * depth and the point hazards are what actually refuse a route; a dredged or
 * restricted area is a fact about the water, not a wall.
 *
 * Enforcing it by default is wrong in a way that looks like caution and is not.
 * A dredged channel is where the DEEP water is — exactly the water a survey
 * wants — so treating it as a keep-out clips the best coverage away and then
 * refuses every transit through it. Measured at Lewes with `area` wrongly
 * defaulted on: over half the plan clipped, and nine transits unroutable, every
 * one of them reporting "a dredged area".
 *
 * The key is `haz`, which is the spelling `contracts.nogoEnforcement` already
 * carries — ASV's `NOGO_ENF`, promoted verbatim into the schema before this
 * file existed. WorldView spelled it `hazard` and had no caller that passed it.
 */
export const ENFORCE_DEFAULTS = { land: true, depth: true, haz: true, area: false };

/**
 * Merge an operator's enforcement toggles over the defaults, REFUSING a key
 * that is not one of the four.
 *
 * A spread would silently drop `{hazard: false}` on the floor and leave the
 * default `haz: true` armed — the caller asks for hazards off and gets them
 * enforced, with nothing anywhere reporting a problem. That is the same
 * silent-success shape as a UTM zone of 99 writing an openable shapefile four
 * million kilometers out, and the answer is the same: refuse rather than guess.
 */
export function enforcement(o) {
  const out = { ...ENFORCE_DEFAULTS };
  for (const k of Object.keys(o || {})) {
    if (!(k in ENFORCE_DEFAULTS)) {
      throw new Error(
        `keepouts: unknown enforcement key "${k}" (expected ${Object.keys(ENFORCE_DEFAULTS).join(', ')})`);
    }
    if (o[k] !== undefined) out[k] = !!o[k];
  }
  return out;
}

// ── Classification ──────────────────────────────────────────────────────────

/**
 * Is this depth area outside the depth window?
 *
 * Classified by the band's DEEPEST value, so a band straddling the minimum
 * (1.8–3.6 m against a 2 m floor) is KEPT — only bands entirely shallower than
 * the minimum are excluded, and genuinely deeper water stops being clipped away.
 * Too-deep applies only when a max is set: a blank max means deep water is fine.
 *
 * Charted depths are to a fixed datum, so the live water level is added to get
 * the depth actually available now. It defaults to 0 — see `waterOffsetM`; a
 * distant tide station's reading is not information about this water, and
 * crediting the vessel with depth nobody measured here is the same failure as
 * trusting a chart symbol without its size.
 */
export function depthExcluded(f, dr, waterOffset = 0) {
  if (f.role !== 'depth_area') return false;
  const d1 = f.props?.DRVAL1, d2 = f.props?.DRVAL2;
  const deepest = (d2 != null) ? d2 + waterOffset : (d1 != null ? d1 + waterOffset : null);
  const shallowest = (d1 != null) ? d1 + waterOffset : (d2 != null ? d2 + waterOffset : null);
  const tooShallow = (deepest != null && deepest < dr.min);
  const tooDeep = (dr.max > 0 && shallowest != null && shallowest > dr.max);
  return tooShallow || tooDeep;
}

/**
 * Intrinsic radius of a charted POINT hazard, before the buffer is added.
 *
 * Zero for genuinely point-sized objects — piles, buoys, beacons, mooring
 * points. For a wreck, hulk, obstruction or awash rock the chart gives a
 * position and NO extent, so the configured radius is assumed unless the
 * feature carries a charted sounding over it proving there is water above.
 *
 * Absent VALSOU means UNKNOWN, and unknown is the conservative case. Without
 * this every point hazard was buffer-sized, so a charted wreck was modelled as
 * a 3 m dot and a route could thread past it.
 */
export function hazExtent(f, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!HAZ_UNKNOWN_EXTENT.has(f.cls)) return 0;
  return hazPassable(f, o) ? 0 : o.wreckRadiusM;
}

/**
 * Does the CHART ITSELF say there is enough water over this hazard for the
 * vessel the model is being built for?
 *
 * ⚠ THIS DECIDES WHETHER THE FEATURE IS A KEEP-OUT AT ALL, NOT HOW BIG IT IS,
 * and that distinction is the whole of the 2026-09-09 fix. Andy, with a survey
 * line cut in two beside a charted rock: *"The avoidance maneuver circled in red
 * for a rock on the chart is unnecessary."* He was right, and the depth logic was
 * not the fault -- this test already fired, and hazExtent already collapsed the
 * assumed 50 m extent to zero. What nothing did was take the feature OUT. So the
 * operator's buffer still made it a 3 m no-go dot; the dot sat 0.2 m off a survey
 * line; clipLine split a 350.4 m line into 334.5 m and an 8.0 m offcut; and the
 * offcut earned its own pair of reversals -- 77 m of track across 16 waypoints to
 * collect 7.8 m of coverage. Measured on his own plan, over a rock carrying
 * VALSOU 8.8 m with a hull drawing 0.12 m.
 *
 * hazExtent's docstring had said the vessel "can pass over it" since the rule was
 * written. It could not. Now it can.
 *
 * ⚠ ONLY THE FOUR CLASSES WHOSE EXTENT THE CHART DOES NOT GIVE. A pile, buoy,
 * beacon or mooring point is an obstruction AT THE SURFACE and no sounding under
 * it makes one passable; none of them is in HAZ_UNKNOWN_EXTENT, so none of them
 * ever reaches the sounding test. The four that do are the ones the chart sizes
 * by assumption, which is exactly the set a charted sounding can settle.
 *
 * ⚠ AND ONLY ON A CHARTED SOUNDING, TIDE-CORRECTED, WITH A MARGIN. Absent
 * VALSOU is UNKNOWN and unknown stays a hazard at the full assumed radius -- the
 * conservative case, unchanged. The water has to beat the floor by
 * WRECK_CLEAR_MARGIN_M, so this is never a decision taken at the water's edge,
 * and the correction is the live level, so a hazard marginal at datum comes back
 * into the model on a falling tide.
 *
 * ⚠ WHAT IS GIVEN UP, STATED. A dropped hazard no longer refuses a leg, no
 * longer appears in blockedInfo, and no longer counts toward clearanceM. It is
 * still DRAWN -- the chart overlay reads the extract, not this model -- so the
 * operator can still see what they are passing over. That is the same split this
 * file already draws for channels: "may the vessel be here" is the keep-out
 * model; "what is charted here" is the chart.
 */
export function hazPassable(f, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!HAZ_UNKNOWN_EXTENT.has(f.cls)) return false;
  const vs = f.props?.VALSOU;
  return typeof vs === 'number'
      && (vs + o.waterOffsetM) >= o.minDepthM + WRECK_CLEAR_MARGIN_M;
}

// ── Channel structure ───────────────────────────────────────────────────────
// Where the chart says a channel IS. Model construction, not routing — the lane
// that rides it stays in each console.

/**
 * The designator tail of a lateral mark's name.
 *
 * A mark carries its channel identity in OBJNAM ("Erie Harbor Lighted Buoy 11"):
 * the trailing integer is the buoy NUMBER, which by IALA convention increases in
 * the conventional direction of buoyage, and the leading text names the SYSTEM.
 */
export const MARK_TAIL =
  /\s*(lighted\s+)?(bell\s+|gong\s+|whistle\s+|horn\s+)?(junction\s+)?(buoy|light|beacon|daybeacon|daymark)\b.*$/i;

export function markId(props) {
  const nm = (props && props.OBJNAM) || '';
  const m = nm.match(/(\d+)\s*[A-Za-z]?\s*$/);
  return { num: m ? parseInt(m[1], 10) : null, sys: nm.replace(MARK_TAIL, '').trim().toLowerCase() };
}

/**
 * Group marks into channel SYSTEMS, and within each into the two ordered buoy
 * lines (port-hand and starboard-hand, ordered by number = ordered along).
 *
 * Two refinements matter on real ENC data:
 *
 *  • DEDUPE — a buoy is charted twice ("Erie Harbor Buoy 9" AND "Erie Harbor
 *    Lighted Buoy 9") at identical coordinates; without this the line doubles
 *    back on itself.
 *  • PREFIX MERGE — "Erie Harbor Entrance" (buoys 1–5) and "Erie Harbor" (7–14)
 *    are the same channel continuing inland. Merging systems where one name is a
 *    word prefix of the other, and their numbers do not collide, closes the ~2 km
 *    unmarked gap between them. Unrelated systems stay separate, each with its
 *    own numbering restarting at 1.
 */
export function markSystems(marks) {
  const seen = new Set(), uniq = [];
  for (const m of marks || []) {
    const k = `${Math.round(m.e / 3)},${Math.round(m.n / 3)},${m.side}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(m);
  }
  const by = new Map();
  for (const m of uniq) {
    const s = m.sys || '';
    if (!by.has(s)) by.set(s, []);
    by.get(s).push(m);
  }
  const names = [...by.keys()].filter((s) => s);
  const merged = new Map();
  const rootOf = (s) => {
    let r = s;
    for (const o of names) {
      if (o !== s && o.length < r.length && s.startsWith(`${o} `)) {
        const a = by.get(o).map((x) => x.num).filter((x) => x != null);
        const b = by.get(s).map((x) => x.num).filter((x) => x != null);
        if (!a.some((x) => b.includes(x))) r = o;
      }
    }
    return r;
  };
  for (const s of names) {
    const r = rootOf(s);
    if (!merged.has(r)) merged.set(r, []);
    merged.get(r).push(...by.get(s));
  }
  const out = [];
  for (const [sys, ms] of merged) {
    const num = (a, b) => a.num - b.num;
    const port = ms.filter((m) => m.side < 0 && m.num != null).sort(num);
    const stbd = ms.filter((m) => m.side > 0 && m.num != null).sort(num);
    if (port.length || stbd.length) out.push({ sys, port, stbd });
  }
  return out;
}

/**
 * The CENTERLINE of one buoy system, ordered along the channel.
 *
 * Pair each port-hand buoy with its nearest starboard-hand buoy, take the
 * midpoint, order by buoy NUMBER. This is the geometric middle of the buoyed
 * fairway, independent of any routed path — and being independent of the path is
 * exactly what made this work where two earlier designs failed on the water.
 *
 * Each point carries `hw`, the channel HALF-WIDTH there, which is what the lane
 * offset is scaled by.
 */
export function systemCenterline(sy) {
  if (!sy || !sy.port || !sy.stbd || !sy.port.length || !sy.stbd.length) return [];
  const mids = [];
  for (const p of sy.port) {
    let best = null, bd = 1e18;
    for (const s of sy.stbd) {
      const d = Math.hypot(s.e - p.e, s.n - p.n);
      if (d < bd) { bd = d; best = s; }
    }
    if (best && bd >= 10 && bd <= 500) {
      mids.push({ e: (p.e + best.e) / 2, n: (p.n + best.n) / 2, hw: bd / 2, num: p.num ?? 0 });
    }
  }
  mids.sort((a, b) => a.num - b.num);
  const out = [];
  for (const q of mids) {
    if (!out.length || Math.hypot(q.e - out[out.length - 1].e, q.n - out[out.length - 1].n) > 10) {
      out.push({ e: q.e, n: q.n, hw: q.hw });
    }
  }
  return out;
}

export const CL_EXTEND_CAP_M = 1200;

/**
 * A CHANNEL DOES NOT END AT ITS LAST BUOY, and neither may the lane.
 *
 * The rule is to hold the lane "until past the extent of the channel as
 * expressed on the chart, or at the final set of buoys that mark that channel".
 * A vessel that drops the lane the instant it passes the last mark cuts back
 * across the fairway at exactly the place converging traffic expects it to hold
 * — the mouth.
 *
 * ASV shipped without this on the reasoning that the centerline "already runs
 * out to the last buoy pair". Measured, it does not: the offset was decaying
 * 50 m INSIDE the buoyage, was 21 of a wanted 25 AT the final pair, and 7 one
 * channel width past it. It took nine days to notice because every suite stayed
 * green — the clause had no implementation to fail.
 *
 * The fix is upstream of the lane rather than inside it: extend the CENTERLINE
 * along its own terminal axis and the existing machinery holds the full offset
 * through the extension without knowing it is there. Straight, because standing
 * on is what a mouth asks for; following a curve out of one invents water.
 *
 * How far — whichever reaches further, capped:
 *   • CHARTED: while still inside a charted channel polygon;
 *   • BUOYED: one full channel width past the final pair.
 * `hw` is HELD at the terminal value, the width the last pair actually
 * measured, not an extrapolation of it.
 */
export function extendCenterline(cl, chans) {
  if (!cl || cl.length < 2) return cl || [];
  const STEP = 10;
  const inChan = (p) => {
    for (const c of chans || []) if (inBB(p, c.bb, 0) && pinp(p, c.ring)) return true;
    return false;
  };
  const reach = (tip, ux, uy, hw) => {
    let charted = 0;
    if (inChan(tip)) {
      for (let d = STEP; d <= CL_EXTEND_CAP_M; d += STEP) {
        if (!inChan({ e: tip.e + ux * d, n: tip.n + uy * d })) break;
        charted = d;
      }
    }
    return Math.min(CL_EXTEND_CAP_M, Math.max(charted, 2 * hw));
  };
  const span = (tip, ux, uy, hw) => {
    const L = reach(tip, ux, uy, hw);
    if (!(L > 1)) return [];
    const N = Math.max(1, Math.ceil(L / 50)), pts = [];
    for (let k = 1; k <= N; k++) {
      pts.push({ e: tip.e + ux * (L * k / N), n: tip.n + uy * (L * k / N), hw });
    }
    return pts;
  };
  const a0 = cl[0], a1 = cl[1], b1 = cl[cl.length - 1], b0 = cl[cl.length - 2];
  let hx = a0.e - a1.e, hy = a0.n - a1.n;
  const hl = Math.hypot(hx, hy) || 1; hx /= hl; hy /= hl;
  let tx = b1.e - b0.e, ty = b1.n - b0.n;
  const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
  // Head points are generated outward, so they reverse into travel order.
  return [...span(a0, hx, hy, a0.hw ?? 0).reverse(), ...cl, ...span(b1, tx, ty, b1.hw ?? 0)];
}

/**
 * Pair lateral marks into channel GATES: each port-hand mark with its nearest
 * starboard-hand mark across the channel, giving the gate center, its width and
 * the channel axis through it.
 */
export function pairGates(marks) {
  const ports = (marks || []).filter((m) => m.side < 0);
  const stbds = (marks || []).filter((m) => m.side > 0);
  const gates = [];
  for (const p of ports) {
    let best = null, bd = 1e9;
    for (const s of stbds) {
      const d = Math.hypot(s.e - p.e, s.n - p.n);
      if (d >= 15 && d <= 400 && d < bd) { bd = d; best = s; }
    }
    if (best) {
      const C = { e: (p.e + best.e) / 2, n: (p.n + best.n) / 2 };
      const gx = (best.e - p.e) / bd, gy = (best.n - p.n) / bd;
      gates.push({ C, width: bd, axis: [-gy, gx] });
    }
  }
  return gates;
}

/**
 * Charted-channel polygons: the ENC dredged areas, plus buoy-gate FAIRWAY
 * corridors where no dredged polygon is charted (an inlet mouth, typically).
 *
 * ONE list, shared by the lane's centerline extension and the survey span and
 * turn rules, so "what counts as a channel" cannot drift between them.
 */
export function channelPolys(frame, feats, marks) {
  const chans = [];
  for (const f of feats || []) {
    // A CHARTED CHANNEL IS A CHARTED OBJECT. S-57 names two that are a "narrow
    // channel or fairway" in COLREGS Rule 9's own words: DRGARE (Dredged_Area -
    // depth artificially maintained, so a deep-draught vessel can navigate
    // safely only within it, which is Rule 9(b)'s own test) and FAIRWY
    // (Fairway_area - the designated lane for larger vessels, which is the
    // object the rule is written about). Traffic separation schemes and
    // recommended tracks are deliberately NOT here: those are Rule 10 and good
    // practice respectively, not Rule 9. See ENC_ROLES in asv_console.py.
    if (f.role !== 'dredged' && f.role !== 'fairway') continue;
    eachRing(f.geometry, (rg) => {
      const ring = rg.map((c) => frame.toEN({ lon: c[0], lat: c[1] }));
      if (ring.length >= 3) chans.push({ ring, bb: bbOf(ring) });
    });
  }
  // Sweep each gate line one gate-width each way along the channel axis.
  for (const g of pairGates(marks)) {
    const gux = g.axis[1], guy = -g.axis[0];
    const P = { e: g.C.e - gux * g.width / 2, n: g.C.n - guy * g.width / 2 };
    const S = { e: g.C.e + gux * g.width / 2, n: g.C.n + guy * g.width / 2 };
    const [ax, ay] = g.axis, Le = g.width;
    const ring = [
      { e: P.e - ax * Le, n: P.n - ay * Le }, { e: S.e - ax * Le, n: S.n - ay * Le },
      { e: S.e + ax * Le, n: S.n + ay * Le }, { e: P.e + ax * Le, n: P.n + ay * Le },
    ];
    chans.push({ ring, bb: bbOf(ring) });
  }
  return chans;
}

/**
 * A human-readable category, so a refusal can say WHAT blocks it.
 *
 * `chan_mark` is here for completeness and is NOT reachable from
 * `buildKeepouts`, which handles marks and continues before this is called —
 * the buoy points it builds are labeled at the push site. It is the one answer
 * the two consoles gave differently before this file existed (ASV said "land"),
 * and it is why `tests/keepouts.py` pins the unreachability rather than
 * asserting the strings agree.
 */
export function nogoKind(role, depthbad, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (depthbad) return `water shallower than ${o.minDepthM.toFixed(1)} m`;
  if (role === 'dock' || role === 'dock_line') return 'a dock / pier';
  if (role === 'bridge') return 'a bridge support';
  if (role === 'hazard_area' || role === 'hazard_point' || role === 'hazard_line')
    return 'a charted hazard';
  if (role === 'chan_mark') return 'a channel buoy';
  if (role === 'dredged') return 'a dredged area';
  if (role === 'restricted') return 'a restricted area';
  if (role === 'shore_line') return 'the shoreline';
  return 'land';
}

// ── The model ───────────────────────────────────────────────────────────────

/**
 * Build the keep-out model from role-tagged ENC features.
 *
 * @param {object} frame   the ONE frame every later test must use
 * @param {Array}  feats   features from the chart extract
 * @param {object} [opts]
 * @param {{min:number,max:number}} [opts.depthRange]  the survey depth window
 * @param {object} [opts.enforce]  {land, depth, haz, area} — operator toggles
 * @returns {{polys:Array, lines:Array, points:Array, marks:Array, passed:number,
 *            sys:Array, chans:Array}} in the frame's meters. `passed` counts the
 *          charted hazards a charted sounding proved passable, and which are
 *          therefore absent from `points` -- a model that drops something has to
 *          be able to say how much.
 */
export function buildKeepouts(frame, feats, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const dr = opts.depthRange || { min: o.minDepthM, max: 0 };
  const enf = enforcement(opts.enforce);

  const polys = [], lines = [], points = [], marks = [];
  let passed = 0;              // hazards the chart proves passable, and this drops
  for (const f of feats || []) {
    const g = f.geometry, r = f.role;
    // ⚠ `bridge` IS THE SUPPORTS, NOT THE SPAN. A bridge pylon is a pier that happens
    // to hold something up and is enforced exactly like one; the DECK (`bridge_span`)
    // is overhead and is deliberately absent from every list here - enforcing it would
    // refuse passage under every bridge, which for a hull with a meter of air draft is
    // wrong on all of them. The span is fetched and cached for drawing, and that is all.
    // ⚠ EACH ROLE BELONGS TO EXACTLY ONE OF THESE, because the dispatch below is an
    // if/else chain on geometry: `isLand` draws RINGS, `isShore` draws PATHS, `isHaz`
    // draws POINTS, and the first match wins. Putting `bridge` in both isLand and isHaz
    // - which the first cut of this did - means the ring branch always takes it, and a
    // pylon charted as a POINT yields no rings and is silently dropped. The pylon POINT
    // class lives in `hazard_point` instead, where the dispatch is already right.
    const isLand = (r === 'land' || r === 'dock' || r === 'hazard_area' || r === 'bridge');
    const isShore = (r === 'shore_line' || r === 'dock_line' || r === 'hazard_line');
    const depthbad = depthExcluded(f, dr, o.waterOffsetM);
    const isHaz = (r === 'hazard_point');
    const isArea = (r === 'dredged' || r === 'restricted');

    // Lateral marks do TWO jobs, and they are not the same job. As keep-outs
    // they are small points — do not hit a buoy. As channel structure they pair
    // into the centerline the Rule 9 lane rides. CATLAM gives the side: 1/3 are
    // port-hand, 2/4 starboard-hand.
    //
    // They are collected as `marks` regardless of the hazard toggle: turning off
    // hazard enforcement says "do not refuse a route for these", not "the
    // channel is not there".
    if (r === 'chan_mark') {
      const cat = f.props?.CATLAM;
      const side = (cat === 2 || cat === 4) ? 1 : (cat === 1 || cat === 3) ? -1 : 0;
      const id = markId(f.props);
      eachPoint(g, (c) => {
        const q = frame.toEN({ lon: c[0], lat: c[1] });
        marks.push({ e: q.e, n: q.n, side, num: id.num, sys: id.sys });
        if (enf.haz) points.push({ e: q.e, n: q.n, r: 0, kind: 'a channel buoy' });
      });
      continue;
    }

    // ⚠ A FAIRWAY IS NOT A KEEP-OUT — IT IS THE OPPOSITE, and it needs no guard
    // here to stay that way. FAIRWY is the water a large vessel is DESIGNATED to
    // use; it is carried so `channelPolys` can say where COLREGS Rule 9 is in
    // force, and for nothing else. It reaches none of the branches below —
    // `isLand`, `isShore`, `isHaz` and `isArea` are all false for it — so it
    // falls out at the bottom with the depth areas and the soundings, which is
    // what the closing comment there already says. An explicit `continue` was
    // written here first and MUTATION PROVED IT DEAD: removing it changed
    // nothing, because the fall-through was already the right answer. The rule
    // lives in one place now, and rule9_scope check 3 asserts the behavior
    // rather than the guard.
    //
    // ⚠ THE REAL RISK IS `isArea`, one line down. Adding 'fairway' to it beside
    // 'dredged' and 'restricted' looks tidy and would make the designated
    // channel a polygon keep-out — refusing every route down the middle of a
    // marked channel. That is the mutation the check is aimed at.
    if ((isLand || isShore) && !enf.land) continue;
    if (depthbad && !enf.depth) continue;
    if (isHaz && !enf.haz) continue;
    // ⚠ PROVEN PASSABLE IS NOT A KEEP-OUT AT ALL -- see hazPassable. Zeroing the
    // extent was never enough: with r = 0 the operator's buffer still leaves a dot,
    // and a dot on a survey line splits that line in two.
    if (isHaz && hazPassable(f, o)) { eachPoint(g, () => passed++); continue; }
    if (isArea && !enf.area) continue;

    const kind = nogoKind(r, depthbad, o);
    if (isLand || depthbad || isArea) {
      eachRing(g, (rg) => {
        const ring = rg.map((c) => frame.toEN({ lon: c[0], lat: c[1] }));
        if (ring.length > 2) polys.push({ ring, bb: bbOf(ring), kind });
      });
    } else if (isShore) {
      eachPath(g, (p) => {
        const pts = p.map((c) => frame.toEN({ lon: c[0], lat: c[1] }));
        if (pts.length > 1) lines.push({ pts, bb: bbOf(pts), kind });
      });
    } else if (isHaz) {
      const radius = hazExtent(f, o);
      eachPoint(g, (c) => {
        const q = frame.toEN({ lon: c[0], lat: c[1] });
        points.push({ e: q.e, n: q.n, r: radius, kind });
      });
    }
    // Everything else — depth areas inside the window, contours, soundings —
    // is chart context, not an obstacle. Falling through is the answer.
  }
  // `chans` is WHERE THE CHART SAYS A CHANNEL IS, carried alongside the
  // keep-outs but NOT one of them. Two different questions share this model:
  // "may the vessel be here" (polys/lines/points, gated by `enforce`) and "is
  // this water a channel" (marks/sys/chans). The second is chart FACT and must
  // not depend on the first — a dredged area is only a keep-out when the
  // operator enforces it, yet its EXTENT is what tells the lane how far the
  // fairway runs past the last buoy. Built unconditionally for that reason.
  return {
    polys, lines, points, marks, passed,
    sys: markSystems(marks),
    chans: channelPolys(frame, feats, marks),
  };
}

/** Is this point (frame meters) inside a keep-out, or within `buf` of one? */
export function blocked(p, ko, buf) {
  for (const poly of ko.polys) {
    if (!inBB(p, poly.bb, buf)) continue;
    if (pinp(p, poly.ring)) return true;
    // The EDGE test is not redundant with the inside test: it is what gives a
    // shoreline its keep-clear margin from the water side.
    const rg = poly.ring;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
      if (dSeg(p, rg[j], rg[i]) < buf) return true;
    }
  }
  for (const ln of ko.lines) {
    if (!inBB(p, ln.bb, buf)) continue;
    for (let i = 1; i < ln.pts.length; i++) {
      if (dSeg(p, ln.pts[i - 1], ln.pts[i]) < buf) return true;
    }
  }
  // R is the hazard's OWN extent plus the buffer as the clearance margin.
  for (const pt of ko.points) {
    const R = buf + (pt.r || 0);
    if (Math.abs(p.e - pt.e) > R || Math.abs(p.n - pt.n) > R) continue;
    if (Math.hypot(p.e - pt.e, p.n - pt.n) < R) return true;
  }
  return false;
}

/**
 * How far this point (frame meters) is from the NEAREST keep-out, capped at `cap`.
 *
 * `blocked` answers yes/no at ONE buffer, which is all a PLANNER needs: a leg is either
 * clear or it is not. A RUNNING BOAT needs the number. Andy, 2026-08-31, after a DriX
 * passed a wharf at 0.6 m with a 5 m buffer set: the buffer was honored by the planner
 * (the commanded path cleared the pier by 14.3 m) and then enforced on nothing, because
 * every keep-out test in this console is a plan-time test. There was no quantity to watch.
 *
 * Zero means inside a keep-out. Built from the same three primitives as `blocked`, in the
 * same order, so the two can never disagree about what a keep-out IS - and capped, so a
 * boat in open water costs one bounding-box test per feature and nothing more.
 */
export function clearanceM(p, ko, cap = 500) {
  let best = cap;
  for (const poly of ko.polys) {
    if (!inBB(p, poly.bb, best)) continue;
    if (pinp(p, poly.ring)) return 0;
    const rg = poly.ring;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
      const d = dSeg(p, rg[j], rg[i]);
      if (d < best) best = d;
    }
  }
  for (const ln of ko.lines) {
    if (!inBB(p, ln.bb, best)) continue;
    for (let i = 1; i < ln.pts.length; i++) {
      const d = dSeg(p, ln.pts[i - 1], ln.pts[i]);
      if (d < best) best = d;
    }
  }
  // Measured from the hazard's OWN EDGE, matching `blocked`'s `buf + pt.r` test: a wreck
  // with a 20 m extent, 21 m away, is 1 m clear and not 21. Clamped at 0 rather than
  // going negative, so "inside" reads the same whichever of the three kinds it is.
  for (const pt of ko.points) {
    const r = pt.r || 0;
    if (Math.abs(p.e - pt.e) > best + r || Math.abs(p.n - pt.n) > best + r) continue;
    const d = Math.max(0, Math.hypot(p.e - pt.e, p.n - pt.n) - r);
    if (d < best) best = d;
  }
  return best;
}

/** Like `blocked`, but returns the offending keep-out so a refusal can name it. */
export function blockedInfo(p, ko, buf) {
  for (const poly of ko.polys) {
    if (!inBB(p, poly.bb, buf)) continue;
    if (pinp(p, poly.ring)) return { kind: poly.kind, type: 'poly', ring: poly.ring };
    const rg = poly.ring;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
      if (dSeg(p, rg[j], rg[i]) < buf) return { kind: poly.kind, type: 'poly', ring: poly.ring };
    }
  }
  for (const ln of ko.lines) {
    if (!inBB(p, ln.bb, buf)) continue;
    for (let i = 1; i < ln.pts.length; i++) {
      if (dSeg(p, ln.pts[i - 1], ln.pts[i]) < buf) {
        return { kind: ln.kind, type: 'line', pts: ln.pts };
      }
    }
  }
  for (const pt of ko.points) {
    const R = buf + (pt.r || 0);
    if (Math.abs(p.e - pt.e) > R || Math.abs(p.n - pt.n) > R) continue;
    if (Math.hypot(p.e - pt.e, p.n - pt.n) < R) {
      return { kind: pt.kind, type: 'point', pt: { e: pt.e, n: pt.n }, r: pt.r || 0 };
    }
  }
  return null;
}

/**
 * Straight-leg clearance, sampled.
 *
 * THE KEEP-OUT TESTS ARE POINT TESTS, so a leg is only as well tested as it is
 * densely sampled. Half the buffer is the step, which guarantees no keep-out
 * wide enough to matter can sit between two samples.
 */
export function legClear(a, b, frame, ko, buf) {
  const ae = frame.toEN(a), be = frame.toEN(b);
  const L = Math.hypot(be.e - ae.e, be.n - ae.n);
  const n = Math.max(1, Math.ceil(L / Math.max(2, buf / 2)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (blocked({ e: ae.e + (be.e - ae.e) * t, n: ae.n + (be.n - ae.n) * t }, ko, buf)) return false;
  }
  return true;
}

/**
 * Walk the direct line and return the first blocked spot, and what blocks it.
 *
 * This is what lets a refusal say "a dock / pier, 340 m along" instead of
 * "unroutable" — and a keep-out the operator is staring at can be open-looking
 * water, so naming it is not a nicety.
 */
export function firstBlockAlong(a, b, frame, ko, buf) {
  const ae = frame.toEN(a), be = frame.toEN(b);
  const L = Math.hypot(be.e - ae.e, be.n - ae.n);
  const n = Math.max(2, Math.ceil(L / Math.max(2, buf / 2)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = { e: ae.e + (be.e - ae.e) * t, n: ae.n + (be.n - ae.n) * t };
    const info = blockedInfo(p, ko, buf);
    if (info) return { at: frame.fromEN(p.e, p.n), info, distance: L * t };
  }
  return null;
}
