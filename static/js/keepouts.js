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
 *       3. A FEATURE MAY NAME ITS OWN KIND (2026-09-30): buildKeepouts takes
 *          `f.kind` before nogoKind's role-based one, so the floats skin.js reads
 *          off the depth areas' holes are refused as what they are rather than
 *          as "a dock / pier" NOAA served. Covered by tests/skin_gaps.js.
 *       4. TWO MORE ENFORCEMENT KEYS (2026-09-30): `wreck` drops the charted wrecks
 *          and counts them as `wrecksOff`; `chan` is the survey's channel rules,
 *          read by punchOut. Both default armed. Covered by tests/wreck_clearance.js
 *          and tests/turn_channel.js.
 *       5. A BUOY CORRIDOR YIELDS TO THE CHART (2026-09-30): channelPolys sweeps a
 *          gate's corridor along the channel only until it would touch a charted
 *          dredged area or fairway (`gateSweep`), and a gate whose own line touches
 *          one sweeps nothing. asv_core still sweeps every gate a full gate width
 *          each way. Covered by tests/turn_channel.js.
 *       6. A GATE IS TWO MARKS OF ONE CHANNEL (2026-10-01): pairGates pairs a mark
 *          only with marks of its own channel, by the prefix merge markSystems uses
 *          (now `markRoots`, one rule for both). asv_core pairs the nearest mark of
 *          the other hand whatever channel it marks. Covered by tests/turn_channel.js.
 *       7. A CHARTED CHANNEL SAYS SO, AND SO DOES A BEACON (2026-10-03): channelPolys
 *          marks each fairway and dredged ring `charted`, which the buoy-gate corridors
 *          are not, and buildKeepouts marks a lateral BEACON `fixed`. routing.js rides
 *          the Rule 9 lane across the first by its own polygon, and brings a vessel
 *          close to a buoy she keeps to starboard but never to a beacon. asv_core has
 *          neither flag. Covered by tests/enc_channel.js.
 *       8. THE ASSUMED EXTENT IS 10 m, NOT 50 (2026-10-09, Andy's call, for all four
 *          kinds - rocks, obstructions, wrecks and hulks): DEFAULTS.wreckRadiusM, equal
 *          to state.js's V.WRECK_RADIUS_M. asv_core still assumes 50 m. Covered by
 *          tests/wreck_clearance.js 1b.
 *       9. DEEP WATER FIRST (2026-10-12, Andy's choice): deepKeepouts builds the
 *          MARGIN LAYER - water within 2 m of her floor, a 50 m berth off charted
 *          rocks and shoal soundings - and blocked, clearanceM and blockedInfo
 *          read it where a planner arms it (`ko.deep`), outside its released
 *          stretches (deepReleased). asv_core has neither. Covered by
 *          tests/deep_first.js.
 *      10. A GRID OVER EVERY FEATURE LIST (2026-10-13, Andy: "build the
 *          spatial index for the floor model"): blocked, clearanceM and
 *          blockedInfo read each list through a grid of GRID_CELL_M cells
 *          (nearIn), the same answers from the features that could give
 *          them. asv_core walks every feature. Covered by
 *          tests/keepout_index.js.
 *      11. THE CORPS' RIVER BUOYS ARE NUMBERED (2026-11-23): numberRiverBuoys
 *          gives each unnamed lateral buoy of the river band (enc_river) a
 *          number, a channel and a direction of buoyage (`along`) read off
 *          the river's sailing line, and buildKeepouts keeps those marks out
 *          of `sys` - no pair lane. asv_core has no river band. Covered by
 *          tests/river_marks.js.
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
 * ... and charted points whose extent the chart does not give EITHER, but which stand AT OR ABOVE THE SURFACE, so no
 * sounding ever passes them (2026-10-12): an islet charted as a point (LNDARE - land too small for an area at the
 * cell's scale), an offshore platform, an aquaculture site, a fishing facility (stake, trap, weir). Each takes the
 * assumed extent, like a wreck; none reaches hazPassable's sounding test. They were `extra` until today - nothing.
 */
export const HAZ_SURFACE_SIZED = new Set([
  'Land_Area_point', 'Offshore_Platform_point', 'Marine_Farm_Culture_point', 'Fishing_Facility_point',
]);

/**
 * What a class IS, where the role's own word would say less (2026-10-12): a refusal names the thing that refused it.
 * Read by buildKeepouts after a feature's own `kind` and before nogoKind's role-based one.
 */
export const CLS_KIND = {
  Land_Area_point: 'a charted islet', Land_Area_line: 'a charted islet',
  Offshore_Platform_point: 'an offshore platform', Offshore_Platform_area: 'an offshore platform',
  Marine_Farm_Culture_point: 'an aquaculture site', Marine_Farm_Culture_area: 'an aquaculture site',
  Marine_Farm_Culture_line: 'an aquaculture site',
  Fishing_Facility_point: 'a fishing facility', Fishing_Facility_area: 'a fishing facility',
  Fishing_Facility_line: 'a fishing facility',
  Oil_Barrier_line: 'an oil boom', Light_Float_point: 'a light float', Dry_Dock_area: 'a dry dock',
};

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
  wreckRadiusM: 10,      // assumed extent of a hazard the chart does not size (50 until 2026-10-09: drift 8)
  waterOffsetM: 0,       // live water level above chart datum; see depthExcluded
  airNeedM: 0,           // the clearance she needs overhead: air draft + overhead margin; 0 = no check (overheadBlocks)
};

/**
 * ⚠ A CHART NOT ON THE TIDE'S DATUM IS READ AS CHARTED (2026-11-23, the Corps' river charts - asv_console.py
 * ENC_RIVER). The water level the console adds to a charted depth is a tide station's, measured from the station's
 * datum, and NOAA's charts sound to that datum. The Corps' river cells do not: they chart depths below the river's own
 * low-water reference plane (DSPM VDAT/SDAT 31), which the river stands above nearly always. A station's level added
 * to them is a number from another datum - and on the lower rivers a station within reach (the page applies one up to
 * WATER_REMOTE_KM off) would credit her with water nobody measured there. So a feature of these bands takes no
 * offset, in every test that adds one: the depth window (depthExcluded), a sounding over a hazard (hazPassable), the
 * margin layer (deepKeepouts). As charted is the conservative reading: the river is above its reference plane.
 */
export const AS_CHARTED_BANDS = new Set(['enc_river']);
export function asCharted(f, waterOffset) {
  return f && AS_CHARTED_BANDS.has(f.band) ? 0 : waterOffset;
}

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
 *
 * TWO MORE, BOTH ARMED BY DEFAULT, AND BOTH ONLY EVER NARROW (Andy, 2026-09-30: "on
 * the survey settings card add options to disregard shipwreck avoidance and shipping
 * channel avoidance"):
 *   wreck  the charted WRECKS - Wreck_point and Wreck_area - within the classes they
 *          already belong to. Off drops them; on leaves them to `haz` (points) and
 *          `land` (areas), so it can disregard a wreck those would have enforced and
 *          can never enforce one they switched off.
 *   chan   the SURVEY's channel rules (channelSpanKeepouts, channelTurnKeepouts) -
 *          not a class this function builds at all. It rides here because it is a
 *          keep-out the operator arms with the others, and because the punch memo's
 *          key already names this whole object, so a toggle cannot be served a clip
 *          taken under the other setting. Transits keep right in a channel under
 *          Rule 9 whatever it says.
 * `contracts.nogoEnforcement` is vendored from asv_core and still names four; this
 * file is ASV's own (see its header), and nothing here calls that validator.
 */
export const ENFORCE_DEFAULTS = { land: true, depth: true, haz: true, area: false, wreck: true, chan: true };

/**
 * Merge an operator's enforcement toggles over the defaults, REFUSING a key
 * that is not one of the six.
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
  // ⚠⚠ THE SEABED'S OTHER GROUP 1 OBJECTS (2026-10-12). S-57 tiles the seabed with depth areas, land, docks - AND
  // dredged areas and unsurveyed areas, each IN PLACE OF a depth area: where one lies there is no Depth_Area under it.
  // This test read depth areas alone, so both were water of no known depth to it, which it treated as no shallow water
  // at all. Measured with this file on his Portsmouth tiles: every dredged channel shallower than the hull's floor read
  // OPEN WATER - the Back Channel at 1.8 m and Northward Channel at 0.9 m for a DriX drawing 2.25 m; 333 such channels
  // in his cache below that floor - and unsurveyed water open for every hull (11 of 11 at Erie).
  //   A DREDGED AREA is judged as a depth area by its own DRVAL1, the depth it is maintained to (DRVAL2 when given).
  //   AN UNSURVEYED AREA has no depth anybody measured: under every floor, and outside any survey window.
  if (f.role === 'unsurveyed') return true;
  if (f.role !== 'depth_area' && f.role !== 'dredged') return false;
  waterOffset = asCharted(f, waterOffset);       // a river chart's depths take no tide (AS_CHARTED_BANDS)
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
  if (HAZ_SURFACE_SIZED.has(f.cls)) return o.wreckRadiusM;       // at the surface: sized, never passed (2026-10-12)
  if (!HAZ_UNKNOWN_EXTENT.has(f.cls)) return 0;
  return hazPassable(f, o) ? 0 : o.wreckRadiusM;
}

/**
 * QUASOU values that make a sounding no proof of water (S-57): 3 doubtful, 4 unreliable, 8 value reported (not
 * surveyed), 9 value reported (not confirmed). QUASOU is a LIST ("2,6").
 */
export const QUASOU_UNTRUSTED = new Set([3, 4, 8, 9]);

/**
 * WATLEV values that put the object at or above the surface whatever its sounding says: 1 partly submerged at high
 * water, 2 always dry, 7 floating.
 */
export const WATLEV_SURFACE = new Set([1, 2, 7]);

/**
 * The clearance under a bridge span or an overhead line, meters - the LOWER of VERCLR (a fixed span, a cable) and VERCCL
 * (an opening bridge SHUT: she cannot ask for an opening) where both are charted - or null where neither is.
 */
export function overheadClearance(f) {
  const p = (f && f.props) || {};
  let lo = null;
  for (const k of ['VERCLR', 'VERCCL']) {
    const v = p[k];
    if (v == null || v === '' || typeof v === 'boolean') continue;
    const n = Number(v);
    if (Number.isFinite(n) && (lo === null || n < lo)) lo = n;
  }
  return lo;
}

/**
 * Is this span or line too low for a hull that needs `airNeedM` overhead (air draft + overhead clearance)? A clearance
 * the chart does not give is UNKNOWN, and unknown is the conservative case here as for a wreck: too low. A hull that
 * needs nothing declared (0) is never blocked - the answer before 2026-10-12, kept for a hull nobody has measured.
 */
export function overheadBlocks(f, airNeedM) {
  if (!(airNeedM > 0)) return false;
  // ⚠ A CLEARANCE NOT READ IS NOT A CLEARANCE NOT CHARTED (2026-10-12, his Go-To to Adams Point). A span from a tile an
  // older reader kept carries no clearance because that reader dropped them all; the server marks it `clr_unread`
  // (asv_console.py _clr_unread) and it is not judged - the answer before overhead was judged at all - where calling it
  // unknown made every bridge on the Piscataqua a wall to the DriX while the console sat on the older copy.
  if (f && f.clr_unread) return false;
  const c = overheadClearance(f);
  return c === null || c < airNeedM;
}

/** Does the chart say a sounding over this hazard is not to be trusted, or that the hazard stands at the surface? */
export function soundingUntrusted(props) {
  const p = props || {};
  if (WATLEV_SURFACE.has(Number(p.WATLEV))) return true;
  const q = String(p.QUASOU == null ? '' : p.QUASOU).split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
  return q.some((x) => QUASOU_UNTRUSTED.has(x));
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
  // ⚠ AND ONLY ON A SOUNDING THE CHART STANDS BEHIND (2026-10-12). The quality and water-level attributes were never
  // kept, so a VALSOU the chart itself calls doubtful, unreliable or only reported passed a rock exactly as a surveyed
  // least depth did, and a rock the chart says is always dry needed only a number beside it.
  if (soundingUntrusted(f.props)) return false;
  const vs = f.props?.VALSOU;
  return typeof vs === 'number'
      && (vs + asCharted(f, o.waterOffsetM)) >= o.minDepthM + WRECK_CLEAR_MARGIN_M;
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
 * WHICH CHANNEL each mark name belongs to: name -> the root name of its system, by the
 * PREFIX MERGE `markSystems` describes ("erie harbor entrance" into "erie harbor" when
 * one name is a word prefix of the other and their numbers do not collide). An unnamed
 * mark ('') is a group of its own. ONE rule, read by `markSystems` and by `pairGates`,
 * so the lane's systems and the gates cannot come to disagree about what is one channel.
 */
export function markRoots(marks) {
  const by = new Map();
  for (const m of marks || []) {
    const s = m.sys || '';
    if (!by.has(s)) by.set(s, []);
    by.get(s).push(m);
  }
  const names = [...by.keys()].filter((s) => s);
  const root = new Map([['', '']]);
  for (const s of names) {
    let r = s;
    for (const o of names) {
      if (o !== s && o.length < r.length && s.startsWith(`${o} `)) {
        const a = by.get(o).map((x) => x.num).filter((x) => x != null);
        const b = by.get(s).map((x) => x.num).filter((x) => x != null);
        if (!a.some((x) => b.includes(x))) r = o;
      }
    }
    root.set(s, r);
  }
  return root;
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
  const root = markRoots(uniq);
  for (const s of names) {
    const r = root.get(s);
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
 * starboard-hand mark OF THE SAME CHANNEL across it, giving the gate center, its
 * width and the channel axis through it.
 *
 * ⚠ OF THE SAME CHANNEL (Andy, 2026-10-01: "fix the cross-channel buoy pairing").
 * The nearest mark of the other hand used to be taken whatever channel it marked, and
 * at Portsmouth three of the extract's seven gates paired a Sagamore Creek mark with a
 * Northward Channel one where the two channels meet - corridors bracketing no channel
 * at all, 135 to 377 m across. The channel is the mark's name less its tail (`markId`),
 * grouped by the same prefix merge as the systems (`markRoots`); unnamed marks pair
 * only with each other.
 */
export function pairGates(marks) {
  const root = markRoots(marks);
  const chanOf = (m) => root.get(m.sys || '') ?? '';
  const ports = (marks || []).filter((m) => m.side < 0);
  const stbds = (marks || []).filter((m) => m.side > 0);
  const gates = [];
  for (const p of ports) {
    let best = null, bd = 1e9;
    for (const s of stbds) {
      if (chanOf(s) !== chanOf(p)) continue;
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
 * Charted-channel polygons: the ENC dredged areas and fairways, plus buoy-gate
 * corridors for the water the chart charts no channel in (an inlet mouth, typically).
 *
 * ONE list, shared by the lane's centerline extension, the lane's Rule 9 scope
 * and the survey span and turn rules, so "what counts as a channel" cannot drift
 * between them.
 *
 * ⚠⚠ THE CHART WINS (Andy, 2026-09-30: "fix the buoy corridor so charted channels
 * win"). This comment always said "where no dredged polygon is charted", and the
 * code swept a corridor for EVERY gate anyway. At the Northward Channel
 * (Portsmouth) buoys #3 and #4 stand 244 m apart either side of a charted strip
 * about 20 m wide; their corridor, 244 m across and two gate widths along, held
 * the strip AND its banks. The span rule takes the UNION of these polygons, so a
 * survey line drawn across the charted channel there began and ended inside the
 * corridor and was "contained" - the channel was never cut out of the coverage,
 * with Shipping channels armed. Five of the seven gates in that extract bracket
 * charted water, three of them pairing a Sagamore Creek mark with a Northward
 * Channel one; at Lewes the one gate, the Roosevelt Inlet jetties, does too.
 *
 * So a corridor is swept along its axis only until it would first touch a charted
 * dredged area or fairway (`gateSweep`), and a gate whose own line touches one
 * sweeps nothing: those buoys mark a channel the chart has already drawn. A gate
 * whose corridor would touch no charted channel keeps exactly the corridor it always
 * had. A mouth beyond a charted end keeps its seaward corridor, stopped AT the
 * charted end rather than wrapped round it, which is the overlap that could still
 * hide the channel if the test were only "does the gate line cross it".
 */
export function channelPolys(frame, feats, marks) {
  const chans = [];
  for (const f of feats || []) {
    // A CHARTED CHANNEL IS A CHARTED OBJECT. S-57 names two that are a "narrow
    // channel or fairway" in COLREGS Rule 9's own words: DRGARE (Dredged_Area -
    // depth artificially maintained, so a deep-draft vessel can navigate
    // safely only within it, which is Rule 9(b)'s own test) and FAIRWY
    // (Fairway_area - the designated lane for larger vessels, which is the
    // object the rule is written about). Traffic separation schemes and
    // recommended tracks are deliberately NOT here: those are Rule 10 and good
    // practice respectively, not Rule 9. See ENC_ROLES in asv_console.py.
    if (f.role !== 'dredged' && f.role !== 'fairway') continue;
    // `charted` (2026-10-03) is what tells a channel the CHART draws from a corridor swept
    // between two buoys below. The Rule 9 lane rides the first by its own polygon
    // (`chartedChannelLane`); the second is still only where a rule applies.
    eachRing(f.geometry, (rg) => {
      const ring = rg.map((c) => frame.toEN({ lon: c[0], lat: c[1] }));
      if (ring.length >= 3) chans.push({ ring, bb: bbOf(ring), charted: true, src: f.role });   // src: 'fairway' | 'dredged'
    });
  }
  // Sweep each gate line along the channel axis - one gate width each way, or until it would touch charted water.
  const charted = chans.slice();
  for (const g of pairGates(marks)) {
    const gux = g.axis[1], guy = -g.axis[0];
    const P = { e: g.C.e - gux * g.width / 2, n: g.C.n - guy * g.width / 2 };
    const S = { e: g.C.e + gux * g.width / 2, n: g.C.n + guy * g.width / 2 };
    const [ax, ay] = g.axis, Le = g.width;
    const { fwd, back } = gateSweep(P, gux, guy, ax, ay, g.width, Le, charted);
    if (fwd + back < GATE_SWEEP_MIN_M) continue;   // the gate brackets charted water: no corridor
    const ring = [
      { e: P.e - ax * back, n: P.n - ay * back }, { e: S.e - ax * back, n: S.n - ay * back },
      { e: S.e + ax * fwd, n: S.n + ay * fwd }, { e: P.e + ax * fwd, n: P.n + ay * fwd },
    ];
    chans.push({ ring, bb: bbOf(ring) });
  }
  return chans;
}

/** A corridor shallower than this along its axis, both ways together, is not swept at all. */
export const GATE_SWEEP_MIN_M = 1;

/**
 * How far a gate's corridor may run along its axis, each way, before it would first
 * touch a CHARTED channel ring - capped at `Le`.
 *
 * In the gate's own strip coordinates - u along the gate line from P (0) to S (w),
 * t along the axis from the gate line - a polygon first touches the swept line at
 * the smallest |t| of its boundary inside 0 <= u <= w. That is an endpoint of an
 * edge clipped to the strip, since t is linear along an edge, so the answer is
 * exact and O(edges). Any clipped edge reaching t = 0, or the gate's midpoint lying
 * inside a ring, means the gate line itself touches charted water: { fwd: 0, back: 0 }.
 * Rings whose box misses the full corridor's box are skipped.
 */
export function gateSweep(P, gx, gy, ax, ay, w, Le, rings) {
  let fwd = Le, back = Le;
  const corner = (u, t) => ({ e: P.e + gx * u + ax * t, n: P.n + gy * u + ay * t });
  const box = bbOf([corner(0, -Le), corner(w, -Le), corner(w, Le), corner(0, Le)]);
  const C = corner(w / 2, 0);
  for (const c of rings) {
    const bb = c.bb;
    if (bb.x1 < box.x0 || bb.x0 > box.x1 || bb.y1 < box.y0 || bb.y0 > box.y1) continue;
    if (pinp(C, c.ring)) return { fwd: 0, back: 0 };
    const r = c.ring;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const ua = (a.e - P.e) * gx + (a.n - P.n) * gy, ta = (a.e - P.e) * ax + (a.n - P.n) * ay;
      const ub = (b.e - P.e) * gx + (b.n - P.n) * gy, tb = (b.e - P.e) * ax + (b.n - P.n) * ay;
      let s0 = 0, s1 = 1;                            // the part of the edge inside 0 <= u <= w
      const du = ub - ua;
      if (Math.abs(du) < 1e-12) {
        if (ua < 0 || ua > w) continue;
      } else {
        let sA = -ua / du, sB = (w - ua) / du;
        if (sA > sB) { const x = sA; sA = sB; sB = x; }
        if (sA > s0) s0 = sA;
        if (sB < s1) s1 = sB;
        if (s0 > s1) continue;
      }
      const t0 = ta + (tb - ta) * s0, t1 = ta + (tb - ta) * s1;
      if ((t0 <= 0 && t1 >= 0) || (t0 >= 0 && t1 <= 0)) return { fwd: 0, back: 0 };   // reaches the gate line
      if (t0 > 0) fwd = Math.min(fwd, t0, t1);
      else back = Math.min(back, -t0, -t1);
    }
  }
  return { fwd, back };
}

// ── The Corps' river buoys (2026-11-23) ─────────────────────────────────────

/**
 * THE CORPS' RIVER BUOYS, NUMBERED FROM THE SAILING LINE (2026-11-23, "do the river buoy lanes").
 *
 * The Corps' buoy overlay (band enc_river) charts each buoy's hand (CATLAM) and no name, so `markId` gives none of
 * them a number or a channel, and `markPassRoute` read every one as "direction of buoyage not known": no route on a
 * river was asked to keep a buoy on its hand. What the river cells DO chart is the sailing line
 * (Recommended_Track_line, "Primary Sailing Line") down the channel, and measured against it every buoy lies on its
 * own hand's side - port-hand to the left of the way the river's miles increase, starboard-hand to the right: 86 of
 * 86 on the Arkansas in U37AR001, 105 of 105 in U37AR063, 27 of 27 on the White in U37AR001, a median 58 to 72 m off
 * it and nine in ten within 122 m. So the line says what a name would: the ORDER of the buoys along the channel, and,
 * from which side of it each hand lies on, the DIRECTION OF BUOYAGE.
 *
 * For each sailing line (its pieces joined end to end, `riverSailingLines`):
 *   - each unnamed river buoy within RIVER_MARK_LINE_M of it and abeam of it (not off either end) may be placed on it -
 *     its station along it and the side it lies on (one within RIVER_MARK_MIN_OFF_M of a line is on neither). A buoy
 *     abeam of two lines (a confluence) is placed on the nearer one whose vote it agrees with, else on the nearer;
 *   - the buoys VOTE the direction of buoyage: the line's own sense where RIVER_VOTE_AGREE of them (and
 *     RIVER_VOTE_MIN at least) lie on their hand's side for it, the other sense where that many lie on it for that,
 *     and none where they do not agree - nothing on that line is numbered then;
 *   - each buoy on its hand's side is numbered in the direction of buoyage as a chart numbers a channel, port-hand
 *     odd and starboard-hand even, each the next of its parity past the one before; a buoy on the other side is
 *     left unnumbered (the line does not say where its channel is);
 *   - one line's buoys share a channel name (`sys`) no charted name can be, nor begin (markRoots' prefix merge), and
 *     each carries an operator's name (`label`, routing.js markName). `river` marks it numbered here, and `along` is
 *     the direction of buoyage at it (the line's heading there, a unit [e, n]): a buoy with no numbered mark near it
 *     along her route - the next buoy of its hand is a median 850 to 950 m on, and one in ten more than 4 km - takes
 *     the way she runs past it from that (routing.js markPassRoute).
 *
 * ⚠ WHAT THE NUMBERS SAY, AND ALL THEY SAY: `markPassRoute` keeps a numbered buoy on its hand for the way she runs,
 * and that hand leaves it on the far side of her from the sailing line - upstream or down, she passes each one on
 * the sailing line's side. tests/river_marks.js holds it both ways.
 *
 * ⚠ NO PAIR LANE. The river's buoys stand staggered, not in pairs: in U37AR001 16 of 61 port-hand buoys have a
 * starboard-hand buoy within 500 m, and the nearest is a median 864 m off (1513 m in U37AR063), so `systemCenterline`
 * would pair them across the river on the diagonal and overstate the channel's width. Their systems are left out of
 * `ko.sys` (buildKeepouts): the lane between them is `buoyedReachLane`'s, the lane single marks buoy.
 *
 * The sailing line is no Rule 9 object (a recommended track: good practice - see channelPolys), only the frame the
 * buoys are read on. The numbers are this model's own: the chart names no buoy, and the page draws none of them.
 */
export const RIVER_BAND = 'enc_river';
/** Two pieces of a sailing line join where their ends lie this near (meters)... */
export const RIVER_LINE_JOIN_M = 25;
/** ... and the line runs on through the joint, turning no more than 45 degrees there. */
export const RIVER_LINE_JOIN_COS = Math.cos(45 * Math.PI / 180);
/** A buoy further than this from every sailing line is not numbered from one (meters). ⚠ NOT A WIDER NET THAN THE
 *  RIVER'S OWN BUOYS NEED (review 2026-11-23, item 3): at 300 m a harbor's entrance green 250 m off the line was
 *  numbered into the river's count, and a route down the river was taken 200 m across to pass it close. Measured, the
 *  farthest of the 222 buoys within 300 m of a line on the Arkansas and the White is 157 m off it, and the next 532 m. */
export const RIVER_MARK_LINE_M = 200;
/** ... nor one this near it: it lies on neither side (meters). */
export const RIVER_MARK_MIN_OFF_M = 5;
/** The fewest buoys whose sides say a line's direction of buoyage ... */
export const RIVER_VOTE_MIN = 3;
/** ... and the share of them that must agree on it. */
export const RIVER_VOTE_AGREE = 0.9;
/** How many times the buoys are placed again on the lines whose votes they agree with, the lines voting again each time. */
export const RIVER_PLACE_PASSES = 4;

/**
 * The river band's sailing lines in the frame's meters, each a list of {e, n} with its pieces joined: where a piece's
 * end lies within RIVER_LINE_JOIN_M of another's and the line runs on through the joint (RIVER_LINE_JOIN_COS), the
 * nearest and straightest such ends first, each end joined once and never back into its own line. The server cuts a line at every
 * tile's edge and a cell's line stops at the cell's, so one river comes as many pieces, in either sense; a piece
 * served twice is read once.
 */
export function riverSailingLines(frame, feats) {
  const pieces = [], seen = new Set();
  for (const f of feats || []) {
    if (f.band !== RIVER_BAND || f.cls !== 'Recommended_Track_line') continue;
    eachPath(f.geometry, (p) => {
      const pts = [];
      for (const c of p || []) {
        if (!Array.isArray(c)) continue;             // (a vertex that is not one: the model is built without it)
        const q = frame.toEN({ lon: c[0], lat: c[1] });
        if (!Number.isFinite(q.e) || !Number.isFinite(q.n)) continue;
        const z = pts[pts.length - 1];
        if (!z || Math.hypot(q.e - z.e, q.n - z.n) > 0.01) pts.push({ e: q.e, n: q.n });
      }
      if (pts.length < 2) return;
      // (by its ends, its middle and its count, whichever way it runs: the two halves of a line round an island share
      // their ends and may share a count)
      const a = pts[0], b = pts[pts.length - 1];
      const m0 = pts[(pts.length - 1) >> 1], m1 = pts[pts.length >> 1];
      const ka = `${Math.round(a.e)},${Math.round(a.n)}`, kb = `${Math.round(b.e)},${Math.round(b.n)}`;
      const key = `${ka < kb ? ka + '|' + kb : kb + '|' + ka}|${pts.length}`
        + `|${Math.round((m0.e + m1.e) / 2)},${Math.round((m0.n + m1.n) / 2)}`;
      if (seen.has(key)) return;
      seen.add(key);
      pieces.push(pts);
    });
  }
  const tip = (P, end) => (end ? P[P.length - 1] : P[0]);
  const away = (P, end) => {                     // the line's heading as it leaves the piece at that end
    const q = end ? P[P.length - 1] : P[0], p = end ? P[P.length - 2] : P[1];
    const L = Math.hypot(q.e - p.e, q.n - p.n) || 1;
    return [(q.e - p.e) / L, (q.n - p.n) / L];
  };
  const joins = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      for (const ei of [0, 1]) {
        for (const ej of [0, 1]) {
          const a = tip(pieces[i], ei), b = tip(pieces[j], ej), d = Math.hypot(a.e - b.e, a.n - b.n);
          if (!(d <= RIVER_LINE_JOIN_M)) continue;
          const ua = away(pieces[i], ei), ub = away(pieces[j], ej), c = -(ua[0] * ub[0] + ua[1] * ub[1]);
          if (c < RIVER_LINE_JOIN_COS) continue;
          // ⚠ NEAREST AND STRAIGHTEST, NOT FIRST (review 2026-11-23, item 2): where three ends meet at one node - the main
          // river's two pieces and a tributary's, all at 0 m - distance alone left the tie to the features' order, and the
          // tributary was joined to the main river below the node and carried on its count. A turn costs up to
          // RIVER_LINE_JOIN_M of distance, all of it at RIVER_LINE_JOIN_COS.
          joins.push({ i, ei, j, ej, d, cost: d + RIVER_LINE_JOIN_M * (1 - c) / (1 - RIVER_LINE_JOIN_COS) });
        }
      }
    }
  }
  joins.sort((x, y) => x.cost - y.cost);
  const link = pieces.map(() => [null, null]), up = pieces.map((_, i) => i);
  const root = (i) => { while (up[i] !== i) i = up[i] = up[up[i]]; return i; };
  for (const c of joins) {
    if (link[c.i][c.ei] || link[c.j][c.ej] || root(c.i) === root(c.j)) continue;
    up[root(c.i)] = root(c.j);
    link[c.i][c.ei] = { p: c.j, end: c.ej };
    link[c.j][c.ej] = { p: c.i, end: c.ei };
  }
  // Each line walked from a free end (every line has two: a join never closes a ring).
  const used = pieces.map(() => false), lines = [];
  for (let s = 0; s < pieces.length; s++) {
    if (used[s] || (link[s][0] && link[s][1])) continue;
    const line = [];
    let p = s, from = link[s][0] ? 1 : 0;
    while (p != null && !used[p]) {
      used[p] = true;
      const P = from === 0 ? pieces[p] : pieces[p].slice().reverse();
      for (const q of P) {
        const z = line[line.length - 1];
        if (!z || Math.hypot(q.e - z.e, q.n - z.n) > 0.01) line.push(q);
      }
      const nx = link[p][1 - from];
      p = nx ? nx.p : null;
      from = nx ? nx.end : 0;
    }
    if (line.length >= 2) lines.push(line);
  }
  return lines;
}

/** Where `q` lies against the polyline `pts` (cumulative stations `cum`): its distance `d`, station `s`, signed offset
 *  `x` (positive to the RIGHT of the line's sense) and whether it lies off either end (`beyond`). */
function placeOnLine(pts, cum, q) {
  let bd = Infinity, x = 0, s = 0, seg = 1, tt = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy;
    if (!(l2 > 0)) continue;
    const t0 = ((q.e - a.e) * dx + (q.n - a.n) * dy) / l2, t = Math.max(0, Math.min(1, t0));
    const d = Math.hypot(q.e - a.e - t * dx, q.n - a.n - t * dy);
    if (d < bd) {
      bd = d; seg = i; tt = t0;
      x = dx * (q.n - a.n) - dy * (q.e - a.e) > 0 ? -d : d;
      s = cum[i - 1] + t * Math.sqrt(l2);
    }
  }
  const a = pts[seg - 1], b = pts[seg], L = Math.hypot(b.e - a.e, b.n - a.n) || 1;
  return { d: bd, s, x, u: [(b.e - a.e) / L, (b.n - a.n) / L],
           beyond: (seg === 1 && tt < 0) || (seg === pts.length - 1 && tt > 1) };
}

/**
 * Number the unnamed river buoys among `marks` (those `buildKeepouts` flags `riverBuoy`) from the sailing lines of
 * `feats`, IN PLACE - see the section's note above. Returns how many were numbered.
 */
export function numberRiverBuoys(frame, feats, marks) {
  const cands = (marks || []).filter((m) => m.riverBuoy);
  if (!cands.length) return 0;
  const lines = riverSailingLines(frame, feats).map((pts) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].e - pts[i - 1].e, pts[i].n - pts[i - 1].n));
    return { pts, cum, bb: bbOf(pts), on: [] };
  });
  // Each buoy's places: every line it stands abeam of within RIVER_MARK_LINE_M, nearest first (none for a buoy ON a line).
  const near = [];
  for (const m of cands) {
    const ps = [];
    let onOne = false;
    for (const L of lines) {
      if (!inBB(m, L.bb, RIVER_MARK_LINE_M)) continue;
      const pr = placeOnLine(L.pts, L.cum, m);
      if (pr.d < RIVER_MARK_MIN_OFF_M) onOne = true;
      else if (pr.d <= RIVER_MARK_LINE_M && !pr.beyond) ps.push({ L, m, s: pr.s, x: pr.x, u: pr.u, d: pr.d });
    }
    if (!onOne && ps.length) near.push(ps.sort((a, b) => a.d - b.d));
  }
  const vote = (on) => {
    if (on.length < RIVER_VOTE_MIN) return 0;
    const agree = on.filter((q) => q.m.side * q.x > 0).length / on.length;
    return agree >= RIVER_VOTE_AGREE ? 1 : agree <= 1 - RIVER_VOTE_AGREE ? -1 : 0;
  };
  const seat = (pick) => {
    for (const L of lines) L.on = [];
    for (const q of pick) q.L.on.push(q);
    for (const L of lines) L.dir = vote(L.on);
  };
  // ⚠ AT A CONFLUENCE, THE LINE IT STANDS ON ITS HAND'S SIDE OF (review 2026-11-23, M2a): a main river's red 70 m off
  // its own line stood 39 m off a tributary's, on that line's wrong side - placed on its nearest line it was left
  // unnumbered, and passed on the bank side. Each buoy takes the nearest of its lines whose vote it agrees with, else its
  // nearest; and as a buoy moves the lines vote again (one on its wrong side had outvoted a tributary's own buoys).
  let pick = near.map((ps) => ps[0]);
  for (let pass = 0; pass < RIVER_PLACE_PASSES; pass++) {
    seat(pick);
    const next = near.map((ps) => ps.find((q) => q.L.dir && q.m.side * q.x * q.L.dir > 0) || ps[0]);
    if (next.every((q, i) => q === pick[i])) break;
    pick = next;
  }
  seat(pick);
  // (each numbered buoy carries its own line, and every line of the read, for routing.js markPassRoute to ask which river
  // she is running at it - not enumerable, so no copy, post or string of the marks carries the lines' points)
  const slim = lines.map((L) => ({ pts: L.pts, cum: L.cum, bb: L.bb }));
  let count = 0;
  lines.forEach((L, k) => {
    const dir = L.dir;
    if (!dir) return;
    const sys = `~river-line-${k + 1}`;
    const own = L.on.filter((q) => q.m.side * q.x * dir > 0).sort((a, b) => dir * (a.s - b.s));
    let last = 0;
    const done = [];
    for (const q of own) {
      // (a buoy served twice - a point on a tile's edge - is one buoy, one number)
      const twin = done.find((t) => t.side === q.m.side && Math.hypot(t.e - q.m.e, t.n - q.m.n) < 3);
      let num = twin ? twin.num : last + 1;
      if (!twin) {
        if ((num % 2 === 0) !== (q.m.side > 0)) num++;
        last = num;
      }
      Object.assign(q.m, { num, sys, river: true, along: [dir * q.u[0], dir * q.u[1]],
                           label: q.m.side > 0 ? 'a starboard-hand river buoy' : 'a port-hand river buoy' });
      Object.defineProperty(q.m, 'riverLine', { value: slim[k], enumerable: false, configurable: true, writable: true });
      Object.defineProperty(q.m, 'riverLines', { value: slim, enumerable: false, configurable: true, writable: true });
      done.push(q.m);
      count++;
    }
  });
  return count;
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
  // The two Group 1 objects that stand in for a depth area say what they are (2026-10-12): "water shallower than 3.2 m"
  // over a dredged channel reads like a misdrawn chart, and over unsurveyed water it is not even true.
  if (role === 'unsurveyed') return 'unsurveyed water';
  if (depthbad && role === 'dredged') return `a dredged channel shallower than ${o.minDepthM.toFixed(1)} m`;
  if (depthbad) return `water shallower than ${o.minDepthM.toFixed(1)} m`;
  if (role === 'bridge_span') return 'a bridge too low for her';
  if (role === 'overhead') return 'an overhead line too low for her';
  if (role === 'land_point' || role === 'land_line') return 'a charted islet';
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
 * @param {object} [opts.enforce]  {land, depth, haz, area, wreck, chan} — operator toggles
 * @returns {{polys:Array, lines:Array, points:Array, marks:Array, passed:number,
 *            wrecksOff:number, sys:Array, chans:Array}} in the frame's meters. `passed`
 *          counts the charted hazards a charted sounding proved passable, and which are
 *          therefore absent from `points` -- a model that drops something has to
 *          be able to say how much. `wrecksOff` counts, for the same reason, the charted
 *          wrecks the operator's `wreck` toggle dropped that the model would otherwise hold.
 */
export function buildKeepouts(frame, feats, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const dr = opts.depthRange || { min: o.minDepthM, max: 0 };
  const enf = enforcement(opts.enforce);

  const polys = [], lines = [], points = [], marks = [];
  let passed = 0;              // hazards the chart proves passable, and this drops
  let wrecksOff = 0;           // wrecks the operator disregards, and this drops
  for (const f of feats || []) {
    const g = f.geometry, r = f.role;
    // ⚠ `bridge` IS THE SUPPORTS, NOT THE SPAN. A bridge pylon is a pier that happens
    // to hold something up and is enforced exactly like one; the DECK (`bridge_span`)
    // is overhead and is enforced ONLY WHERE IT IS TOO LOW FOR HER (the overhead branch
    // below, 2026-10-12) - enforcing every span would refuse passage under every bridge,
    // which for a hull with a meter of air draft is wrong on all of them.
    // ⚠ EACH ROLE BELONGS TO EXACTLY ONE OF THESE, because the dispatch below is an
    // if/else chain on geometry: `isLand` draws RINGS, `isShore` draws PATHS, `isHaz`
    // draws POINTS, and the first match wins. Putting `bridge` in both isLand and isHaz
    // - which the first cut of this did - means the ring branch always takes it, and a
    // pylon charted as a POINT yields no rings and is silently dropped. The pylon POINT
    // class lives in `hazard_point` instead, where the dispatch is already right.
    const isLand = (r === 'land' || r === 'dock' || r === 'hazard_area' || r === 'bridge');
    const isShore = (r === 'shore_line' || r === 'dock_line' || r === 'hazard_line' || r === 'land_line');
    const depthbad = depthExcluded(f, dr, o.waterOffsetM);
    const isHaz = (r === 'hazard_point');
    const isArea = (r === 'dredged' || r === 'restricted');
    // An islet charted as a POINT is land, under the land toggle, sized by the assumed extent (HAZ_SURFACE_SIZED) and
    // never passed on a sounding - it was `extra` until 2026-10-12, and at +1.5 m of tide its drying flat stopped
    // holding the 1 m hulls off it.
    const isLandPt = (r === 'land_point');

    // ⚠⚠ OVERHEAD: A SPAN OR A LINE IS A KEEP-OUT ONLY WHEN IT IS TOO LOW FOR HER (2026-10-12). Until today a span was
    // never one, which was right for the hull it was written for (a meter of air draft) and wrong for a DriX at 2.85 m
    // under New Castle's 1.8-2.4 m bridges. `airNeedM` is her air draft plus her overhead clearance (the vessel file);
    // 0 means she declared none and nothing overhead is judged - the old answer, for a hull nobody measured. The water
    // under a span she clears stays what it is: this decides the span alone. Its rings or paths by its geometry.
    if (r === 'bridge_span' || r === 'overhead') {
      if (!enf.land || !overheadBlocks(f, o.airNeedM)) continue;
      const clr = overheadClearance(f);
      const kind = clr == null
        ? (r === 'bridge_span' ? 'a bridge with no charted clearance' : 'an overhead line with no charted clearance')
        : nogoKind(r, false, o);
      eachRing(g, (rg) => {
        const ring = rg.map((c) => frame.toEN({ lon: c[0], lat: c[1] }));
        if (ring.length > 2) polys.push({ ring, bb: bbOf(ring), kind, cls: f.cls, clr });
      });
      eachPath(g, (p) => {
        const pts = p.map((c) => frame.toEN({ lon: c[0], lat: c[1] }));
        if (pts.length > 1) lines.push({ pts, bb: bbOf(pts), kind, cls: f.cls, clr });
      });
      continue;
    }

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
      // A BEACON IS FIXED: a light or a daybeacon stands ON the rock or the shore it marks,
      // where a buoy floats at the edge of the water it marks. A vessel is brought close to
      // a buoy she keeps to starboard and never to a beacon (`markPassRoute`).
      const fixed = f.cls === 'Beacon_Lateral_point';
      // A PREFERRED-CHANNEL MARK (CATLAM 3/4) stands where a channel divides: which hand she
      // keeps it on depends on the branch she takes, and nothing here knows that, so the marks
      // stage leaves it alone (2026-10-04: a route taking the side creek was sent round the
      // wrong side of one). It still pairs into a gate as the side it is given.
      const junction = cat === 3 || cat === 4;
      // AN UNNAMED RIVER BUOY of a known hand is numbered from the river's sailing line once every mark is read
      // (numberRiverBuoys, below the loop).
      const riverBuoy = f.band === RIVER_BAND && f.cls === 'Buoy_Lateral_point' && !(f.props && f.props.OBJNAM)
        && side !== 0 && !junction;
      eachPoint(g, (c) => {
        const q = frame.toEN({ lon: c[0], lat: c[1] });
        const m = { e: q.e, n: q.n, side, num: id.num, sys: id.sys };
        if (fixed) m.fixed = true;
        if (junction) m.junction = true;
        if (riverBuoy) m.riverBuoy = true;
        marks.push(m);
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
    if ((isLand || isShore || isLandPt) && !enf.land) continue;
    if (depthbad && !enf.depth) continue;
    if (isHaz && !enf.haz) continue;
    // ⚠ PROVEN PASSABLE IS NOT A KEEP-OUT AT ALL -- see hazPassable. Zeroing the
    // extent was never enough: with r = 0 the operator's buffer still leaves a dot,
    // and a dot on a survey line splits that line in two.
    if (isHaz && hazPassable(f, o)) { eachPoint(g, () => passed++); continue; }
    // ⚠ A DISREGARDED WRECK, AFTER EVERY GATE THAT WOULD HAVE DROPPED IT ANYWAY (2026-09-30).
    // So the count is of wrecks the toggle ITSELF took out: one a sounding proves passable
    // is counted as passed, one whose own class is switched off is not counted at all, and
    // the toggle can only ever narrow - it cannot arm a wreck `haz` or `land` disarmed.
    if (!enf.wreck && (f.cls === 'Wreck_point' || f.cls === 'Wreck_area')) { wrecksOff++; continue; }
    // ⚠ A DREDGED AREA TOO SHALLOW FOR HER IS ENFORCED BY THE DEPTH TOGGLE, NOT THE AREA ONE (2026-10-12). The `area`
    // toggle - off by default, rightly: a dredged channel is where the deep water is - dropped every dredged area here,
    // the shallow ones with the deep, so a 0.9 m channel was water to a 3.15 m floor however depth was enforced.
    if (isArea && !enf.area && !depthbad) continue;

    // A feature that carries its own kind keeps it: a float read off the seabed's gaps (skin.js) is refused as
    // what it is, not as a dock NOAA served. Then what its class is (CLS_KIND), then what its role is.
    const kind = f.kind || CLS_KIND[f.cls] || nogoKind(r, depthbad, o);
    if (isLand || depthbad || isArea) {
      eachRing(g, (rg) => {
        const ring = rg.map((c) => frame.toEN({ lon: c[0], lat: c[1] }));
        if (ring.length > 2) polys.push({ ring, bb: bbOf(ring), kind, cls: f.cls });
      });
    } else if (isShore) {
      eachPath(g, (p) => {
        const pts = p.map((c) => frame.toEN({ lon: c[0], lat: c[1] }));
        if (pts.length > 1) lines.push({ pts, bb: bbOf(pts), kind, cls: f.cls });
      });
    } else if (isHaz || isLandPt) {
      const radius = hazExtent(f, o);
      eachPoint(g, (c) => {
        const q = frame.toEN({ lon: c[0], lat: c[1] });
        points.push({ e: q.e, n: q.n, r: radius, kind, cls: f.cls });
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
  // `restricted` is THE CHART'S RESTRICTED AREAS AS FACTS (2026-10-05), carried the same way and
  // for the same reason: whether one is a keep-out is the operator's `area` toggle, but WHERE it
  // lies is what tells a keep-right lane not to take her into one (routing.js buoyedReachLane -
  // the Naval Shipyard's restricted area along Seavey Island, 33 CFR 334.50, lies on the
  // starboard hand of every vessel bound up the Piscataqua). Outer rings only, with each ring's
  // area: the same layer holds a no-discharge zone covering half the river, which is no limit
  // on where she rides (RESTRICTED_LOCAL_M2).
  const restricted = [];
  for (const f of feats || []) {
    if (f.role !== 'restricted' || !f.geometry) continue;
    const outers = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]]
      : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map((p) => p[0]) : [];
    for (const rg of outers) {
      if (!rg || rg.length < 3) continue;
      const ring = rg.map((c) => frame.toEN({ lon: c[0], lat: c[1] }));
      let a2 = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a2 += ring[j].e * ring[i].n - ring[i].e * ring[j].n;
      const pr = f.props || {};
      restricted.push({ ring, bb: bbOf(ring), area: Math.abs(a2) / 2, name: pr.OBJNAM || '',
                        key: [pr.OBJNAM || '', pr.CATREA || '', pr.INFORM || ''].join('|') });
    }
  }
  // ⚠ ONE AREA, CUT AT THE CHART'S CELL SEAMS, IS STILL ONE AREA. The service cuts a feature at
  // each cell's edge, and judged a ring at a time, 11 pieces of the Right Whale Critical
  // Habitat (210 km2) passed as "local" (124 m2 to 0.12 km2). Rings of the same named area
  // (OBJNAM, CATREA, INFORM) that touch are one area, and each carries the area of the whole
  // (`area`; its own is `ringArea`). (A hole in a ring is read as part of the area.)
  const parent = restricted.map((_, i) => i);
  const root = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let i = 0; i < restricted.length; i++) {
    for (let j = i + 1; j < restricted.length; j++) {
      const a = restricted[i], c = restricted[j];
      if (a.key !== c.key || a.key === '||') continue;
      if (a.bb.x0 > c.bb.x1 + 1 || c.bb.x0 > a.bb.x1 + 1 || a.bb.y0 > c.bb.y1 + 1 || c.bb.y0 > a.bb.y1 + 1) continue;
      parent[root(i)] = root(j);
    }
  }
  const total = new Map();
  restricted.forEach((c, i) => total.set(root(i), (total.get(root(i)) || 0) + c.area));
  restricted.forEach((c, i) => { c.ringArea = c.area; c.area = total.get(root(i)); delete c.key; });
  // The Corps' river buoys, numbered from the sailing line - and left out of the pair lane's systems: they stand
  // staggered, not in pairs (numberRiverBuoys).
  numberRiverBuoys(frame, feats, marks);
  return {
    polys, lines, points, marks, passed, wrecksOff,
    sys: markSystems(marks.filter((m) => !m.river)),
    chans: channelPolys(frame, feats, marks),
    restricted,
  };
}

// ── DEEP WATER FIRST: THE MARGIN LAYER (Andy, 2026-10-12) ───────────────────────────────────────────────────────────
// His Go-To past Thacher Island ran over the 5.4-9.1 m patch off Oak Rock, legal water at her 4.0 m floor: "good safe
// practice would have put it between the buoys and especially not over the shallow spot. There should be an awareness
// that although the ENC is an excellent source of data it can be inaccurate in some instances." His choice, asked:
// plan first keeping DEEP_MARGIN_M over the floor and DEEP_BERTH_M off charted rocks and shoal soundings; today's floor
// and buffer only on stretches where there is no other way, and say so on the plan.
//
// THIS LAYER IS THAT MARGIN, AND IT IS NOT A KEEP-OUT. Built beside the model (`ko.margin`) it is inert: blocked,
// clearanceM and the raster read it only where a planner ARMS it as `ko.deep` ({...layer, release}), and a point inside
// one of `release`'s regions is outside it - the stretches with no deeper way (passage.js deepFirst). The guard, the
// punch and the hold point never see it: a margin is a preference of the search, not a wall the boat is held off.
export const DEEP_MARGIN_M = 2;
export const DEEP_BERTH_M = 50;
// ⚠ A COARSE BAND IS NOT MARGIN WATER (Andy, 2026-10-13: "yes, build the 10 m band-width rule"). His Go-To from New
// Castle to Portland went 970 m round open water off Biddeford Pool - up to 837 m off the straight line, just inside
// the detour allowed - because the coastal chart draws ONE band from the shoreline to the 10-fathom line, 0-18.2 m, and
// its 0 is the shore, not the water: the shallowest charted sounding within 300 m of the 3.0 km the straight line ran
// in it was 15.5 m. A band says how deep its water is only when it is narrow. Over his cached charts the bands that
// could be margin water fall in two groups - up to 9.1 m wide (3.6-5.4, 5.4-9.1, 0-9.1 m: the Oak Rock patch is one)
// and from 12.8 m (5.4-18.2, 0-18.2 m) - and a band wider than DEEP_BAND_MAX_M is not margin water itself. Inside one,
// each shoal sounding and every rock still gets its DEEP_BERTH_M, so a charted shallow spot is still kept off.
export const DEEP_BAND_MAX_M = 10;
// ⚠ A RIVER'S CHANNEL IS ITS DEEP WATER (Andy, 2026-11-23: "make the planner prefer the deep area, but keeping right is
// still a valid action that should be considered as a priority"). The Corps' river cells chart the navigation channel
// only as their deepest depth area - DRVAL1 2.74 m (the 9 ft project depth) and no DRVAL2 - and the water from it to the
// banks as one 0-2.74 m band, which her floor's test (depthExcluded, by the band's deepest value) passes. At Pine Bluff the
// channel is one strip 76 m wide about the sailing line, unbroken for the 101.9 km read (32 m at its three narrowest),
// and the Go-To's four replayed legs ran only 4.0-6.4 km of their 9.5-10.4 km in it, the rest up to 112 m outside it,
// among the buoys the Corps sets 14-56 m outside it. At her 2.0 m floor the margin rule made BOTH margin water - the channel is
// 0.74 m over it, the band 0 m - so deep water first found no deeper way anywhere on the river, and the search's route
// stood. A river's channel is therefore never margin water to AVOID: there is no deeper water in the river to take her
// to. It is margin water to SAY (`sayOnly`): she has less than the margin over her floor there, and the plan says so as
// it always did; and the band beside it is margin water as before, which deep water first now finds a deeper way round.
/** Is the depth area `f` a RIVER'S CHANNEL: a band read as charted (AS_CHARTED_BANDS, the Corps' river cells) with a
 *  shallowest depth and no deepest - the open-ended deepest band, as those cells chart the navigation channel? */
export function riverChannelArea(f) {
  return !!f && f.role === 'depth_area' && AS_CHARTED_BANDS.has(f.band)
    && f.props?.DRVAL1 != null && f.props?.DRVAL2 == null;
}

/** Each RIVER'S CHANNEL among `feats` (riverChannelArea) as rings in `frame`'s plane, [{ring, bb}] - whatever her floor and
 *  the water, and whatever the Depth toggle: the navigation channel the Corps' cells chart only as their deepest band. For
 *  a survey's wait (asv.html waitRiverChannels), which keeps out of a navigation channel while Shipping channels is
 *  checked: at a 2.0 m floor the channel is the only water in the river the floor tier lets her lie in, and she held there,
 *  the barge lane, said to be "out of navigation channels" (2026-11-23). */
export function riverChannelRings(frame, feats) {
  const out = [];
  for (const f of feats || []) {
    if (!riverChannelArea(f) || !f.geometry) continue;
    eachRing(f.geometry, (rg) => {
      const ring = rg.map((c) => frame.toEN({ lon: c[0], lat: c[1] }));
      if (ring.length > 2) out.push({ ring, bb: bbOf(ring) });
    });
  }
  return out;
}

/**
 * The margin layer for a hull whose floor is `opts.depthRange.min` (else `opts.minDepthM`), at `opts.waterOffsetM`:
 *   polys   each depth or dredged area legal at the floor whose SHALLOWEST depth is under floor + DEEP_MARGIN_M (the
 *           floor's own test, depthExcluded, reads a band by its DEEPEST value: a 5.4-9.1 m band is legal at 4.0) -
 *           and whose band is no wider than DEEP_BAND_MAX_M (a 0-18.2 m coastal band is not; an area with one bound
 *           is judged by it, as before);
 *   points  each rock, obstruction, wreck and hulk no charted sounding clears floor + DEEP_MARGIN_M over (hazPassable at
 *           that floor), and each SOUNDING shallower than it, at `berth: DEEP_BERTH_M` - the radius is set where the
 *           layer is armed, as the berth less the margin the plan keeps, so the berth is the distance kept whatever the
 *           buffer or standoff. A sounding whose berth lies wholly inside a keep-out or a margin area adds nothing and is
 *           not kept.
 *   sayOnly a RIVER'S CHANNEL that is margin water by the same test (riverChannelArea): never avoided - it is the
 *           deepest water the river has - and said wherever her route runs in it (passage.js marginRuns), as every
 *           area above is.
 * Follows the toggles: depth (the areas and soundings), haz (the rocks and obstructions), wreck (the wrecks).
 * `opts.floorPolys`: the areas of the model built at the floor (buildKeepouts' polys), which the soundings are read
 * against - built here when not given.
 * {polys, lines: [], points, sayOnly, counts: {areas, rocks, soundings, channel}}.
 */
export function deepKeepouts(frame, feats, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const enf = enforcement(opts.enforce);
  const floor = (opts.depthRange && opts.depthRange.min) ?? o.minDepthM;
  const marginM = opts.marginM ?? DEEP_MARGIN_M, berth = opts.berthM ?? DEEP_BERTH_M;
  // (`opts.bandMaxM`, 2026-11-20, the survey window's wait point: a band wider than this is left to its soundings - right
  //  for a route that passes through, and wrong for a place to lie for hours on a falling tide, where a 0-18.2 m band
  //  with no sounding near is water charted from 0 m. Infinity counts every band by its shallowest depth.)
  const bandMax = opts.bandMaxM ?? DEEP_BAND_MAX_M;
  const deepTo = floor + marginM;
  const polys = [], points = [], snd = [], sayOnly = [];
  const counts = { areas: 0, rocks: 0, soundings: 0, channel: 0 };
  for (const f of feats || []) {
    const g = f.geometry, r = f.role;
    if (!g) continue;
    if (r === 'depth_area' || r === 'dredged') {
      if (!enf.depth || depthExcluded(f, { min: floor, max: 0 }, o.waterOffsetM)) continue;   // a keep-out already
      const d1 = f.props?.DRVAL1, d2 = f.props?.DRVAL2, d = d1 ?? d2;
      if (d == null || d + asCharted(f, o.waterOffsetM) >= deepTo) continue;
      if (d1 != null && d2 != null && d2 - d1 > bandMax) continue;   // a coarse band: its soundings say (above)
      const kind = 'water less than ' + marginM + ' m over her floor';
      // (a river's channel: said, never avoided - riverChannelArea, above)
      const chan = riverChannelArea(f), river = AS_CHARTED_BANDS.has(f.band);   // (`river`: routing.js buoyedReachLane's edges)
      eachRing(g, (rg) => {
        const ring = rg.map((c) => frame.toEN({ lon: c[0], lat: c[1] }));
        if (ring.length > 2 && chan) { sayOnly.push({ ring, bb: bbOf(ring), kind, cls: f.cls, channel: true }); counts.channel++; }
        else if (ring.length > 2) { polys.push({ ring, bb: bbOf(ring), kind, cls: f.cls, ...(river ? { river } : {}) }); counts.areas++; }
      });
    } else if (r === 'hazard_point' && HAZ_UNKNOWN_EXTENT.has(f.cls)) {
      const wreck = f.cls === 'Wreck_point' || f.cls === 'Hulk_point';
      if (!enf.haz || (wreck && !enf.wreck)) continue;
      if (hazPassable(f, { ...o, minDepthM: deepTo })) continue;
      const what = wreck ? 'a charted wreck' : f.cls === 'Obstruction_point' ? 'a charted obstruction' : 'a charted rock';
      eachPoint(g, (c) => {
        const q = frame.toEN({ lon: c[0], lat: c[1] });
        points.push({ e: q.e, n: q.n, r: 0, berth, kind: berth + ' m off ' + what, cls: f.cls });
        counts.rocks++;
      });
    } else if (r === 'sounding') {
      if (!enf.depth) continue;
      eachPoint(g, (c) => {
        const d = c.length > 2 && c[2] != null ? c[2] : (f.props?.VALSOU ?? f.props?.DEPTH);
        if (typeof d !== 'number' || d + asCharted(f, o.waterOffsetM) >= deepTo) return;
        const q = frame.toEN({ lon: c[0], lat: c[1] });
        snd.push({ e: q.e, n: q.n, r: 0, berth, kind: berth + ' m off a sounding of ' + d.toFixed(1) + ' m', cls: f.cls });
      });
    }
  }
  // (a sounding inside a keep-out area or a margin area, its berth's whole radius from that area's edge, adds nothing:
  //  on his Cape Ann tile 349 of 1,424 shoal soundings)
  if (snd.length) {
    const fl = opts.floorPolys || buildKeepouts(frame, feats, { ...opts, depthRange: { min: floor, max: 0 } }).polys;
    const grid = fileList(fl.concat(polys));
    for (const q of snd) {
      let inside = false;
      for (const p of grid.get(gridCell(Math.floor(q.e / GRID_CELL_M), Math.floor(q.n / GRID_CELL_M))) || NO_FEATURES) {
        if (!inBB(q, p.bb, 0) || !ringInside(q, p.ring)) continue;
        if (ringDist(q, p.ring, true, berth) >= berth) { inside = true; break; }
      }
      if (!inside) { points.push(q); counts.soundings++; }
    }
  }
  return { polys, lines: [], points, sayOnly, counts };
}

// ---- A GRID OVER EVERY FEATURE LIST (2026-10-13, Andy: "build the spatial index for the floor model") ----------------
//
// A POINT TEST WALKED EVERY FEATURE OF THE MODEL, and that was most of what a plan cost: on his 61 km Go-To's chart (1,634
// areas, 1,509 lines, 1,510 points) one test cost 43-85 us, nearly all of it bounding boxes nowhere near the point, and
// `blocked` was 70 % of a long plan's CPU (a profile of the lane pass, 2026-10-12). Each feature list now gets a grid:
// GRID_CELL_M cells, a feature filed - in the list's own order - in every cell its box, grown by its own radius and
// GRID_PAD_M, touches. A test within GRID_PAD_M of a point reads that point's cell alone and finds every feature that
// could answer it (a feature with an edge within `buf` of the point has the point inside its own grown box); a wider one
// reads every cell within its reach less the pad, each feature once; one wider than GRID_WIDE_CELLS cells walks the list.
// THE ANSWERS ARE THE WALK'S OWN: the same primitives on a subset holding every feature that could answer, in the same
// order, so blockedInfo names the same feature (it reads a wider set only by walking the list) - tests/keepout_index.js
// holds them side by side against a plain re-walk, on his own charts too.
//   A LIST IS FILED ONCE IT HAS BEEN ASKED GRID_AFTER TIMES, and never if it holds fewer than GRID_MIN features: the
// planner makes short-lived views of the model (the lane stages' walls, a contact's ring folded in, one feature at a time)
// that may be asked a handful of times, and filing one costs more than walking it. Kept in a WeakMap on the list with its
// length - a list that grows is filed afresh - and nothing here writes on a feature.
// (Deep water first's armed margin layer had a grid of its own from 2026-10-12; it reads through this one now.)
export const GRID_CELL_M = 250;
export const GRID_PAD_M = 100;
export const GRID_MIN = 16;
export const GRID_AFTER = 64;
export const GRID_WIDE_CELLS = 64;
const GRID = new WeakMap();
const NO_FEATURES = [];
const gridCell = (gx, gy) => (gx + 1048576) * 2097152 + (gy + 1048576);
/** `list` filed by cell: Map(cell -> the features whose grown box touches it, in the list's order). */
function fileList(list) {
  const g = new Map();
  for (const f of list) {
    const r = (f.r || 0) + GRID_PAD_M;
    const bb = f.bb || { x0: f.e, x1: f.e, y0: f.n, y1: f.n };
    const gx0 = Math.floor((bb.x0 - r) / GRID_CELL_M), gx1 = Math.floor((bb.x1 + r) / GRID_CELL_M);
    const gy0 = Math.floor((bb.y0 - r) / GRID_CELL_M), gy1 = Math.floor((bb.y1 + r) / GRID_CELL_M);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const k = gridCell(gx, gy);
        const c = g.get(k);
        if (c) c.push(f); else g.set(k, [f]);
      }
    }
  }
  return g;
}
function gridOf(list) {
  let x = GRID.get(list);
  if (!x || x.n !== list.length) { x = { n: list.length, asked: 0, g: null }; GRID.set(list, x); }
  if (!x.g && ++x.asked >= GRID_AFTER) x.g = fileList(list);
  return x.g;
}
/** The features of `list` that can lie within `R` of `p`: its grid's cell, the cells within its reach, or all of it. */
function nearIn(list, p, R) {
  if (!list) return NO_FEATURES;
  if (list.length < GRID_MIN) return list;
  const g = gridOf(list);
  if (!g) return list;
  if (R <= GRID_PAD_M) return g.get(gridCell(Math.floor(p.e / GRID_CELL_M), Math.floor(p.n / GRID_CELL_M))) || NO_FEATURES;
  const w = R - GRID_PAD_M;
  if (!Number.isFinite(w) || !Number.isFinite(p.e) || !Number.isFinite(p.n)) return list;
  const gx0 = Math.floor((p.e - w) / GRID_CELL_M), gx1 = Math.floor((p.e + w) / GRID_CELL_M);
  const gy0 = Math.floor((p.n - w) / GRID_CELL_M), gy1 = Math.floor((p.n + w) / GRID_CELL_M);
  if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > GRID_WIDE_CELLS) return list;
  const seen = new Set();
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) {
      const c = g.get(gridCell(gx, gy));
      if (c) for (const f of c) seen.add(f);
    }
  }
  return [...seen];
}
/** Has `list` been filed in a grid (tests/keepout_index.js)? */
export function listGridded(list) { const x = GRID.get(list); return !!(x && x.g); }

/** Is `p` inside one of a margin layer's released regions (passage.js deepFirst): {pts, r, bb}, the water within `r`
 *  of the polyline `pts` (a point, as [c, c])? */
export function deepReleased(p, release) {
  if (!release) return false;
  for (const c of release) {
    if (!inBB(p, c.bb, c.r)) continue;
    if (ringDist(p, c.pts, false, c.r) < c.r) return true;
  }
  return false;
}

// ⚠ IN A SET, THE RIVER'S SHALLOWS AT THE BUFFER, NOT THE STANDOFF (Andy, 2026-11-24: "fix (b) for 2 kn and up"). From a
// 23 m standoff (2 kn of set) the Corps' 76 m channel at Pine Bluff left too little water clear of the 0-2.74 m water beside
// it for deep water first's search to find, and every stretch was released: the legs ran as they did before the channel
// was the river's deep water, up to 112 m outside it. Where a stretch has no deeper way at the standoff, deep water first
// asks again with the river's own margin water (`river`, deepKeepouts) kept at the operator's buffer inside a SOFTENED
// region about it (`soft`: {pts, r, bb, at} - the water within `r` of the polyline `pts`, at `at` meters), and the stages
// after it plan on the same - and once one is found, the whole leg ({all: true, at}: everywhere the layer is read, its
// river's water at `at`; deepFirst AND THEN ALONG THE WHOLE LEG). Everything else of the layer - a rock's or a shoal sounding's berth, another chart's margin
// water - is kept at the clearance asked, inside a softened region or not; and her floor's own hazards are not the
// layer's at all, so the standoff is kept off them. `blocked` and `blockedInfo` read the softened regions; `clearanceM`
// does not (it reports the distance to the river's water itself, nearer than `blocked` refuses - no planner asks it of
// an armed layer).
/** The buffer the river's margin water is kept at about `p` (frame meters): the least `at` of the softened regions it lies
 *  in, or null where it lies in none. (A region with no finite `at` softens nothing - softUnder.) */
export function deepSoftAt(p, soft) {
  if (!soft || !soft.length) return null;
  let at = null;
  for (const c of soft) {
    if (!Number.isFinite(c.at)) continue;
    if (c.all) { if (at == null || c.at < at) at = c.at; continue; }
    if (!inBB(p, c.bb, c.r)) continue;
    if (ringDist(p, c.pts, false, c.r) < c.r && (at == null || c.at < at)) at = c.at;
  }
  return at;
}
/** Does the softened region `c` soften anything read at `buf` - a finite `at` under it? ONE TEST FOR EVERY READER
 *  (blocked, legClear, the raster): a NaN `at` was no region to one reader and a softer one to another, and the raster
 *  left cells free that `blocked` refused (the review of the softened regions, 2026-11-24). */
export function softUnder(c, buf) { return Number.isFinite(c.at) && c.at < buf; }
/** The margin layer `L` split into its river's own water and the rest, each a model of its own ({polys, lines, points}).
 *  The two lists of areas are kept with the layer's own, so each is filed in its grid once, not once per point. */
export function deepSplit(L) {
  let s = SPLIT.get(L.polys);
  if (!s || s.n !== L.polys.length) SPLIT.set(L.polys, s = { n: L.polys.length, river: L.polys.filter((q) => q.river), other: L.polys.filter((q) => !q.river) });
  return { river: { polys: s.river, lines: NO_FEATURES, points: NO_FEATURES },
           other: { polys: s.other, lines: L.lines || NO_FEATURES, points: L.points || NO_FEATURES } };
}
const SPLIT = new WeakMap();
/** Is `p` in the armed margin layer `L` at `buf` - outside its released regions, and with its river's water kept at a
 *  softened region's own buffer where that is less?
 *  ⚠ NOT MONOTONE IN `buf` FOR THE RIVER'S WATER IN A SOFTENED REGION: it is read at min(buf, at) whatever radius is
 *  asked, so `blocked(p, ko, R)` at an inflated R is no screen there for what `blocked` refuses at a smaller one. A
 *  sampled test that detects at an inflated radius and refines at the buffer (legClear) misses the river's water between
 *  its samples - legClearEN's river pass is built for that; turns.js cornerBreaches, which screens so, never sees an
 *  armed layer (the review of the softened regions, 2026-11-24). */
function deepBlocked(p, L, buf) {
  if (!blocked(p, L, buf) || deepReleased(p, L.release)) return false;
  const at = deepSoftAt(p, L.soft);
  if (at == null || !(at < buf)) return true;
  const s = deepSplit(L);
  return blocked(p, s.other, buf) || blocked(p, s.river, at);
}

// ---- A ROW-BAND INDEX FOR BIG RINGS (2026-09-26) ----------------------------------------------
//
// Andy: "The current instance of ASV Console has frozen. This has happened the last few times."
// MEASURED on his New Castle chart at the boat's recorded position: the land and shallow-water
// rings there run to 5,000-9,000 vertices each, their bounding boxes cover the whole harbor, and
// every point test below walked every edge of every one of them. One point test cost ~0.3 ms;
// the guard's deviation search samples ~5,000 points a frame and cost 4.6 s; the page ran it on
// every frame and froze for 123 s.
//
// A ring (or polyline) of RING_INDEX_MIN_VERTS or more vertices gets, on first use, an index of
// its edges by horizontal BAND of northing. Point-in-polygon needs only the edges that straddle
// the point's northing - all of them live in the point's own band, whatever its height. (The
// nearest-edge search walked bands outward from the point; since 2026-11-24 it reads the grid of
// edges below, and a band is at most RING_BAND_MAX_M tall: 128 bands of a river area 53 km from
// north to south were 417 m each, up to 2,423 edges in one.) Smaller features walk their edges exactly as before, so nothing changes for a
// pier, a wreck or a test fixture; for the big rings the answers are IDENTICAL (the same crossing
// test on the same edges, the same dSeg on every edge that could be within the cap) and
// tests/keepout_index.js holds the two side by side over thousands of points. The index lives in
// a WeakMap keyed by the ring array, so a model rebuilt with new arrays indexes itself afresh and
// nothing here writes on a feature object.
export const RING_INDEX_MIN_VERTS = 256;
export const RING_INDEX_BANDS = 128;
export const RING_BAND_MAX_M = 32;
// (and tall enough that its edges cross no more than RING_BAND_ROWS_PER_EDGE bands each on the mean, so the bands and
//  what is filed in them are bounded by the ring's edges, as its grid is - its cell no smaller than its mean edge. A
//  ring's edges rise at least its span, so there are no more than RING_BAND_ROWS_PER_EDGE bands an edge, and one more:
//  one vertex 1e8 m off was 3.1 million bands of 32 m, and a run of vertices 1e7 m off, each edge of them filed in
//  thousands, was 281 MB - the reviews of 2026-11-24)
export const RING_BAND_ROWS_PER_EDGE = 8;
const RING_INDEX = new WeakMap();
/** Can a ring be indexed - are all its vertices numbers, and the length of its edges, added up, one too? A ring with a
 *  vertex that is not (Infinity, NaN: a corrupt read), or with edges too long to add up (two vertices 1.8e308 m apart),
 *  gets no index and no grid and walks its edges as a small ring does, so neither can be built wrong over it (the
 *  reviews of 2026-11-24: a vertex at Infinity hung the grid's filing and made the bands' count infinite; two at
 *  +-9e307 made the cell infinite, and a search through it found nothing - blocked false beside the ring, failing
 *  open). A ring's spans are no longer than its edges, so they are numbers too. No test answers on an edge to a vertex
 *  that is not a number: dSeg is NaN on it and segX null. */
function indexable(pts, closed) {
  for (const q of pts) if (!Number.isFinite(q.e) || !Number.isFinite(q.n)) return false;
  const n = pts.length, m = closed ? n : n - 1;
  let len = 0;
  for (let k = 0; k < m; k++) {
    const a = closed ? pts[(k + n - 1) % n] : pts[k], b = closed ? pts[k] : pts[k + 1];
    len += Math.hypot(b.e - a.e, b.n - a.n);
  }
  return Number.isFinite(len);
}
function bandIndex(pts, closed) {
  const n = pts.length;
  let y0 = Infinity, y1 = -Infinity;
  for (const q of pts) { if (q.n < y0) y0 = q.n; if (q.n > y1) y1 = q.n; }
  const span = y1 - y0;
  // edge k is (pts[k-1], pts[k]) around a closed ring - the same k pinp's `j = i++` walk visits -
  // and (pts[k], pts[k+1]) along an open line
  const m = closed ? n : n - 1;
  let rise = 0;
  for (let k = 0; k < m; k++) rise += Math.abs((closed ? pts[k] : pts[k + 1]).n - (closed ? pts[(k + n - 1) % n] : pts[k]).n);
  const h = Math.max(1, Math.min(span / RING_INDEX_BANDS, RING_BAND_MAX_M), rise / (RING_BAND_ROWS_PER_EDGE * Math.max(1, m)));
  const R = Math.max(1, Math.floor(span / h) + 1);
  const rows = [];
  for (let r = 0; r < R; r++) rows.push([]);
  for (let k = 0; k < m; k++) {
    const a = closed ? pts[(k + n - 1) % n] : pts[k], bq = closed ? pts[k] : pts[k + 1];
    let r0 = Math.floor((Math.min(a.n, bq.n) - y0) / h), r1 = Math.floor((Math.max(a.n, bq.n) - y0) / h);
    if (r0 < 0) r0 = 0;
    if (r1 > R - 1) r1 = R - 1;
    for (let r = r0; r <= r1; r++) rows[r].push(k);
  }
  return { y0, h, rows };
}
function indexFor(pts, closed) {
  if (!pts || pts.length < RING_INDEX_MIN_VERTS) return null;
  let idx = RING_INDEX.get(pts);
  if (idx === undefined) { idx = indexable(pts, closed) ? bandIndex(pts, closed) : null; RING_INDEX.set(pts, idx); }
  return idx;
}
/** Has this ring / polyline been indexed? (tests: the big ones are, the small ones never are) */
export function ringIndexed(pts) { return !!RING_INDEX.get(pts); }
/** pinp, through the index where there is one: the crossing test over the edges in the point's band. */
function ringInside(p, ring) {
  const idx = indexFor(ring, true);
  if (!idx) return pinp(p, ring);
  const r = Math.floor((p.n - idx.y0) / idx.h);
  if (r < 0 || r >= idx.rows.length) return false;     // no edge straddles a northing outside the ring's span
  const n = ring.length;
  let inside = false;
  for (const k of idx.rows[r]) {
    const xi = ring[k].e, yi = ring[k].n, j = (k + n - 1) % n, xj = ring[j].e, yj = ring[j].n;
    if (((yi > p.n) !== (yj > p.n)) && (p.e < (xj - xi) * (p.n - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// A GRID OF A BIG RING'S EDGES IN BOTH AXES (2026-11-24, Andy: "continue through the night using your best
// recommendations" - the river Go-To's planning time). The band index above serves the crossing test, but the
// nearest-edge search walked every edge in the bands about the point, and a band ran the ring's whole width: a Corps
// river area is ONE feature, up to 25,240 vertices and 131 km round, so a band held kilometers of bank. Profiled on a
// Pine Bluff leg (12.8 m standoff, 123 s out and back): ringDist 56% of it, and legCrossesEN's walk of every edge of
// every ring its box touched 17%. A ring's cells are square, the mean length of its edges and no smaller than
// RING_CELL_M, so an edge crosses few of them (a 600 km coast in 940 m edges was 93 MB in 32 m cells: the review of
// 2026-11-24). Each edge is filed in every cell it can reach - the cells of its bounding box, or, for a longer one, the
// cells about points along it no more than a cell apart - so the cell of any point ON the edge holds it; an edge across
// more than RING_LONG_CELLS cells is on the grid's long list instead, read by every search. The nearest-edge search
// walks square rings of cells outward from the point's and stops as the band walk did (a ring d cells out holds no
// point nearer than d - 1 cells, less a hair for rounding: RING_TIE); one reaching further than RING_GRID_REACH_CELLS
// walks the bands as before (a clearance capped at 500 m read hundreds of empty cells). A leg's crossings are counted
// over the edges in the cells about points along it. The same dSeg and the same crossing test on every edge that could
// answer, each edge once: the same answers (tests/keepout_index.js 15-22, against the plain walk).
export const RING_CELL_M = 32;
export const RING_LONG_CELLS = 64;
export const RING_GRID_REACH_CELLS = 4;
// (the crossing test reads the grid where the cells along a leg cost less than the ring's edges walked: measured on
// rings of 300 to 24,000 vertices and legs of 50 m to 15 km, a point along the leg cost what about RING_LEG_COST edges
// walked did, and a search four points more)
export const RING_LEG_COST = 175;
const RING_FAR_CELLS = 1e6;   // (a point further off than this, in cells, walks the edges: ringDist)
const RING_TIE = 1e-6;        // (in cells: the stop rules' margin over rounding in a cell's or a band's index)
const RING_GRID = new WeakMap();
/** The keys of the cells about points along a->b no more than a cell apart (each point's cell and the eight round it),
 *  into `out` (a Set): every point of the segment is within half a cell of one of the points, so in its cell or the
 *  next. */
function cellsAlong(G, a, b, out) {
  const g = G.g, L = Math.hypot(b.e - a.e, b.n - a.n), N = Math.max(1, Math.ceil(L / g));
  for (let s = 0; s <= N; s++) {
    const t = s / N, ci = Math.floor((a.e + (b.e - a.e) * t - G.x0) / g), cj = Math.floor((a.n + (b.n - a.n) * t - G.y0) / g);
    for (let i = ci - 1; i <= ci + 1; i++) {
      if (i < 0 || i >= G.W) continue;
      for (let j = cj - 1; j <= cj + 1; j++) if (j >= 0 && j < G.H) out.add(i * G.H + j);
    }
  }
}
function cellGrid(pts, closed) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pts) { if (q.e < x0) x0 = q.e; if (q.e > x1) x1 = q.e; if (q.n < y0) y0 = q.n; if (q.n > y1) y1 = q.n; }
  const n = pts.length, m = closed ? n : n - 1;
  // edge k: (pts[k-1], pts[k]) round a closed ring, (pts[k], pts[k+1]) along a line - as the band index files it
  const A = (k) => (closed ? pts[(k + n - 1) % n] : pts[k]), B = (k) => (closed ? pts[k] : pts[k + 1]);
  let len = 0;
  for (let k = 0; k < m; k++) len += Math.hypot(B(k).e - A(k).e, B(k).n - A(k).n);
  const g = Math.max(RING_CELL_M, m > 0 ? len / m : 0);
  const G = { x0, y0, g, W: Math.floor((x1 - x0) / g) + 1, H: Math.floor((y1 - y0) / g) + 1, cells: new Map(), long: [],
              seen: new Uint32Array(Math.max(1, m)), tick: 0 };
  const file = (key, k) => { let c = G.cells.get(key); if (!c) G.cells.set(key, c = []); c.push(k); };
  for (let k = 0; k < m; k++) {
    const a = A(k), b = B(k);
    const i0 = Math.floor((Math.min(a.e, b.e) - x0) / g), i1 = Math.floor((Math.max(a.e, b.e) - x0) / g);
    const j0 = Math.floor((Math.min(a.n, b.n) - y0) / g), j1 = Math.floor((Math.max(a.n, b.n) - y0) / g);
    if (i1 - i0 > RING_LONG_CELLS || j1 - j0 > RING_LONG_CELLS) { G.long.push(k); continue; }
    if ((i1 - i0 + 1) * (j1 - j0 + 1) <= 16) { for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) file(i * G.H + j, k); }
    else { const ks = new Set(); cellsAlong(G, a, b, ks); for (const key of ks) file(key, k); }   // (a longer diagonal edge)
  }
  return G;
}
function gridFor(pts, closed) {
  if (!pts || pts.length < RING_INDEX_MIN_VERTS) return null;
  let G = RING_GRID.get(pts);
  if (G === undefined) { G = indexable(pts, closed) ? cellGrid(pts, closed) : null; RING_GRID.set(pts, G); }
  return G;
}
/** Has this ring / polyline a grid of its edges? (tests: the big ones do, once asked; the small ones never) */
export function ringGridded(pts) { return !!RING_GRID.get(pts); }
/** How big is a ring's grid - its cell, its cells, the edges filed in them, its long list? (tests: bounded by its edges) */
export function ringGridSize(pts) {
  const G = RING_GRID.get(pts);
  if (!G) return null;
  let filed = 0;
  for (const c of G.cells.values()) filed += c.length;
  return { g: G.g, cells: G.cells.size, filed, long: G.long.length };
}
/** A fresh mark for "this edge already seen" in one search (a Uint32Array stamp; it wraps after four billion). */
function nextTick(G) { G.tick = (G.tick + 1) >>> 0; if (G.tick === 0) { G.seen.fill(0); G.tick = 1; } return G.tick; }
/** The nearest-edge search through the bands (the index's own, before the grid): bands outward from the point's, each
 *  edge first rejected by its own bounding box, stopping when the next band's nearest possible edge is no nearer than
 *  the best so far (less RING_TIE of a band for rounding). */
function bandDist(p, pts, closed, idx, cap) {
  let best = cap;
  const n = pts.length, R = idx.rows.length, rc = Math.floor((p.n - idx.y0) / idx.h);
  for (let d = 0; ; d++) {
    const lo = rc - d, hi = rc + d;
    if (lo < 0 && hi >= R) break;
    // a band d away cannot hold an edge nearer than (d - 1) band heights
    if (d > 0 && (d - 1) * idx.h >= best + RING_TIE * idx.h) break;
    for (let s = 0; s < (d === 0 ? 1 : 2); s++) {
      const r = s === 0 ? lo : hi;
      if (r < 0 || r >= R) continue;
      for (const k of idx.rows[r]) {
        const a = closed ? pts[(k + n - 1) % n] : pts[k], bq = closed ? pts[k] : pts[k + 1];
        if (a.e > p.e + best && bq.e > p.e + best) continue;
        if (a.e < p.e - best && bq.e < p.e - best) continue;
        if (a.n > p.n + best && bq.n > p.n + best) continue;
        if (a.n < p.n - best && bq.n < p.n - best) continue;
        const dd = dSeg(p, a, bq);
        if (dd < best) best = dd;
      }
    }
  }
  return best;
}
/**
 * The distance from `p` to the nearest edge of a ring (closed) or polyline (open), or `cap` when
 * no edge is nearer. Through the grid where there is one and the reach is a few cells: the long
 * list, then square rings of cells outward from the point's, each edge once and first rejected by
 * its own bounding box, stopping when the next ring's nearest possible point is no nearer than the
 * best so far; through the bands for a longer reach.
 */
function ringDist(p, pts, closed, cap) {
  let best = cap;
  const n = pts.length;
  const G = gridFor(pts, closed);
  const ci = G ? Math.floor((p.e - G.x0) / G.g) : NaN, cj = G ? Math.floor((p.n - G.y0) / G.g) : NaN;
  // (a point that is not a number walks the edges as a small ring does - `blocked` refuses one before it gets here - and
  //  so does one past a million cells, a corrupt position: there a ring of cells more is lost in the rounding)
  if (!G || !Number.isFinite(ci) || !Number.isFinite(cj) || Math.abs(ci) > RING_FAR_CELLS || Math.abs(cj) > RING_FAR_CELLS) {
    if (closed) { for (let i = 0, j = n - 1; i < n; j = i++) { const d = dSeg(p, pts[j], pts[i]); if (d < best) best = d; } }
    else { for (let i = 1; i < n; i++) { const d = dSeg(p, pts[i - 1], pts[i]); if (d < best) best = d; } }
    return best;
  }
  // (a reach of more than a few cells - a clearance capped at 500 m, an uncapped one - through the bands, as before)
  if (!(cap <= RING_GRID_REACH_CELLS * G.g)) return bandDist(p, pts, closed, indexFor(pts, closed), cap);
  const tick = nextTick(G), seen = G.seen, H = G.H, W = G.W;
  const look = (k) => {
    if (seen[k] === tick) return;
    seen[k] = tick;
    const a = closed ? pts[(k + n - 1) % n] : pts[k], bq = closed ? pts[k] : pts[k + 1];
    if (a.e > p.e + best && bq.e > p.e + best) return;
    if (a.e < p.e - best && bq.e < p.e - best) return;
    if (a.n > p.n + best && bq.n > p.n + best) return;
    if (a.n < p.n - best && bq.n < p.n - best) return;
    const dd = dSeg(p, a, bq);
    if (dd < best) best = dd;
  };
  const cell = (i, j) => { const c = G.cells.get(i * H + j); if (c) for (const k of c) look(k); };
  for (const k of G.long) look(k);
  for (let d = 0; ; d++) {
    if (d > 0) {
      // every cell already walked: the window d - 1 cells out covered the grid
      if (ci - d + 1 <= 0 && cj - d + 1 <= 0 && ci + d - 1 >= W - 1 && cj + d - 1 >= H - 1) break;
      // a ring d cells out holds no point nearer than d - 1 cells (less a hair: the point's cell and an edge's are
      // rounded apart, and an edge two cells off was 32 m less 3e-13 away)
      if ((d - 1) * G.g >= best + RING_TIE * G.g) break;
    }
    if (d === 0) { if (ci >= 0 && ci < W && cj >= 0 && cj < H) cell(ci, cj); continue; }
    const i0 = Math.max(0, ci - d), i1 = Math.min(W - 1, ci + d);
    if (cj + d < H && cj + d >= 0) for (let i = i0; i <= i1; i++) cell(i, cj + d);         // the top row
    if (cj - d >= 0 && cj - d < H) for (let i = i0; i <= i1; i++) cell(i, cj - d);         // the bottom row
    const j0 = Math.max(0, cj - d + 1), j1 = Math.min(H - 1, cj + d - 1);
    if (ci - d >= 0 && ci - d < W) for (let j = j0; j <= j1; j++) cell(ci - d, j);         // the left column
    if (ci + d < W && ci + d >= 0) for (let j = j0; j <= j1; j++) cell(ci + d, j);         // the right column
  }
  return best;
}

/** A position or a buffer that is not a number: unknown, and unknown reads as BLOCKED (the 2026-10-16 review,
 *  finding 7 - NaN read as clear water: `blocked` false, `clearanceM` its cap, a leg with an undefined buffer clear
 *  through land). The wire refuses non-finite numbers, so this is the backstop, and it fails the safe way. */
const unknownAt = (p, buf) => !p || !Number.isFinite(p.e) || !Number.isFinite(p.n) || !Number.isFinite(buf);
export const UNKNOWN_KIND = 'a position or buffer that is not a number';
/** Is this point (frame meters) inside a keep-out, or within `buf` of one? */
export function blocked(p, ko, buf) {
  if (unknownAt(p, buf)) return true;
  // (each list through its grid: only the features that could be within `buf` of `p`, in their own order)
  for (const poly of nearIn(ko.polys, p, buf)) {
    if (!inBB(p, poly.bb, buf)) continue;
    if (ringInside(p, poly.ring)) return true;
    // The EDGE test is not redundant with the inside test: it is what gives a
    // shoreline its keep-clear margin from the water side.
    if (ringDist(p, poly.ring, true, buf) < buf) return true;
  }
  for (const ln of nearIn(ko.lines, p, buf)) {
    if (!inBB(p, ln.bb, buf)) continue;
    if (ringDist(p, ln.pts, false, buf) < buf) return true;
  }
  // R is the hazard's OWN extent plus the buffer as the clearance margin.
  for (const pt of nearIn(ko.points, p, buf)) {
    const R = buf + (pt.r || 0);
    if (Math.abs(p.e - pt.e) > R || Math.abs(p.n - pt.n) > R) continue;
    if (Math.hypot(p.e - pt.e, p.n - pt.n) < R) return true;
  }
  // THE MARGIN LAYER, WHERE A PLANNER ARMED IT (deepKeepouts, passage.js deepFirst), outside its released stretches - and
  // its river's water at a softened region's own buffer (deepSoftAt, above).
  if (ko.deep && deepBlocked(p, ko.deep, buf)) return true;
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
  if (!p || !Number.isFinite(p.e) || !Number.isFinite(p.n) || Number.isNaN(cap)) return 0;   // an infinite cap is no cap
  let best = cap;
  for (const poly of nearIn(ko.polys, p, cap)) {
    if (!inBB(p, poly.bb, best)) continue;
    if (ringInside(p, poly.ring)) return 0;
    best = ringDist(p, poly.ring, true, best);
  }
  for (const ln of nearIn(ko.lines, p, cap)) {
    if (!inBB(p, ln.bb, best)) continue;
    best = ringDist(p, ln.pts, false, best);
  }
  // Measured from the hazard's OWN EDGE, matching `blocked`'s `buf + pt.r` test: a wreck
  // with a 20 m extent, 21 m away, is 1 m clear and not 21. Clamped at 0 rather than
  // going negative, so "inside" reads the same whichever of the three kinds it is.
  for (const pt of nearIn(ko.points, p, cap)) {
    const r = pt.r || 0;
    if (Math.abs(p.e - pt.e) > best + r || Math.abs(p.n - pt.n) > best + r) continue;
    const d = Math.max(0, Math.hypot(p.e - pt.e, p.n - pt.n) - r);
    if (d < best) best = d;
  }
  // (the margin layer where a planner armed it, as `blocked` reads it - but for a softened region, which is not read here:
  // the distance is to the river's water itself, nearer than `blocked` refuses there - deepSoftAt)
  if (ko.deep && best > 0 && !deepReleased(p, ko.deep.release)) best = clearanceM(p, ko.deep, best);
  return best;
}

/**
 * The clearance from ONE feature, in the same terms `clearanceM` measures all of them.
 *
 * ⚠ IT DELEGATES RATHER THAN RE-IMPLEMENTS, AND THAT IS THE WHOLE POINT. The launch grant
 * decides membership by asking "is THIS feature one of the ones that makes the berth
 * uncertifiable?" - a per-feature question `clearanceM` cannot answer because it returns the
 * minimum over the whole model. Writing the three loops again here would be a second copy of
 * the rule that a wreck is measured from its own EDGE and a polygon from its ring, and the
 * two copies would answer differently the first time either moved. So it builds a model of
 * one feature and asks the real function.
 *
 * The allocation is deliberate and it is not on a hot path: the grant memoises membership on
 * the keep-out model's own identity, so this runs once per `rebuildNogo`, not once per frame.
 */
export function featureClearanceM(p, f, cap = 500) {
  if (!p || !f) return cap;
  const one = { polys: [], lines: [], points: [], marks: [] };
  if (f.ring) one.polys.push(f);
  else if (f.pts) one.lines.push(f);
  else one.points.push(f);
  return clearanceM(p, one, cap);
}

/** Like `blocked`, but returns the offending keep-out so a refusal can name it. */
export function blockedInfo(p, ko, buf) {
  if (unknownAt(p, buf)) return { kind: UNKNOWN_KIND, type: 'unknown' };
  const near = (list) => (buf <= GRID_PAD_M ? nearIn(list, p, buf) : list || NO_FEATURES);
  for (const poly of near(ko.polys)) {
    if (!inBB(p, poly.bb, buf)) continue;
    if (ringInside(p, poly.ring)) return { kind: poly.kind, type: 'poly', ring: poly.ring };
    if (ringDist(p, poly.ring, true, buf) < buf) return { kind: poly.kind, type: 'poly', ring: poly.ring };
  }
  for (const ln of near(ko.lines)) {
    if (!inBB(p, ln.bb, buf)) continue;
    if (ringDist(p, ln.pts, false, buf) < buf) return { kind: ln.kind, type: 'line', pts: ln.pts };
  }
  for (const pt of near(ko.points)) {
    const R = buf + (pt.r || 0);
    if (Math.abs(p.e - pt.e) > R || Math.abs(p.n - pt.n) > R) continue;
    if (Math.hypot(p.e - pt.e, p.n - pt.n) < R) {
      return { kind: pt.kind, type: 'point', pt: { e: pt.e, n: pt.n }, r: pt.r || 0 };
    }
  }
  if (ko.deep && !deepReleased(p, ko.deep.release)) {
    // (a softened region's river water at its own buffer, as `blocked` reads it)
    const at = deepSoftAt(p, ko.deep.soft), s = at != null && at < buf ? deepSplit(ko.deep) : null;
    const d = s ? blockedInfo(p, s.other, buf) || blockedInfo(p, s.river, at) : blockedInfo(p, ko.deep, buf);
    if (d) return { ...d, margin: true };
  }
  return null;
}

/**
 * Straight-leg clearance, sampled.
 *
 * THE KEEP-OUT TESTS ARE POINT TESTS, so a leg is only as well tested as it is
 * densely sampled. Half the buffer is the step, which guarantees no keep-out
 * wide enough to matter can sit between two samples.
 *
 * ⚠ AND THE CLEARANCE READ BETWEEN TWO SAMPLES (the 2026-10-16 review, finding 3). A step of h means a point of the
 * leg lies up to h/2 from the nearest sample, so a keep-out `d` off the leg reads as sqrt(d^2 + h^2/4) off that sample:
 * asked at the buffer, the leg passed 4.845 m of a 5 m buffer and 9.685 m of 10 m (2.84 m of 3 m with the 2 m floor).
 * The closest point of the leg to a keep-out is either perpendicular to the leg - the nearest sample within h/2 along
 * it - or one of the leg's ends, which are sampled exactly; so a keep-out within `buf` of the leg is within
 * hypot(buf, h/2) of a sample - and that radius is what DETECTS one. A sample that answers blocked at it but not at
 * the buffer has a keep-out in the slack: the leg's nearest point to it lies within h of that sample, and that stretch
 * is asked again at the buffer itself, LEG_FINE_M apart (a slack of 0.4 mm at a 3 m buffer). So the answer is the
 * buffer's, to a millimeter, in both directions: a leg 2.9 m off is refused, one 3.1 m off is clear - the refinement
 * only runs where something is near, so a leg in open water costs what it always did.
 */
export const LEG_FINE_M = 0.1;
export function legClear(a, b, frame, ko, buf) {
  return legClearEN(frame.toEN(a), frame.toEN(b), ko, buf);
}
/** legClear of the leg ae -> be in frame meters. */
export function legClearEN(ae, be, ko, buf) {
  const L = Math.hypot(be.e - ae.e, be.n - ae.n);
  if (!Number.isFinite(L) || !Number.isFinite(buf)) return false;   // unknown is not clear (finding 7): the loop below never ran on NaN
  // (a softened region at or over `buf` changes nothing `blocked` answers at `buf` - but left in, the pass below would
  //  read the river's water at its `at` where it detects at hypot(buf, step / 2), and a leg 4.9 m off it passed a 5 m
  //  buffer: the review of the softened regions, F1)
  const k = softView(ko, buf);
  if (!sampledClear(ae, be, L, buf, (p, r) => blocked(p, k, r))) return false;
  // ⚠ AND THE RIVER'S WATER NEAR A SOFTENED REGION ASKED AGAIN ON ITS OWN (deepSoftAt, 2026-11-24). The pass above is
  // exact for everything but the river's water there: in a softened region `blocked` reads it at the region's smaller
  // `at` whatever the radius asked (deepBlocked), so at a 23 m standoff, samples 11.5 m apart, a leg could come within
  // it between two of them unseen - and at a region's EDGE a sample inside it reads it at `at` while the leg's points
  // just outside are held to `buf` (the review, F2: a leg 14.3 m off it outside the region, at 23 m, passed). So where
  // the leg comes near a softened region the river's water is asked again at the least `at`'s step, each sample against
  // the most any point of the leg within half a step of it is held to (softPass) - and only there.
  const sp = softPass(ae, be, k, buf);
  return !sp || softClear(ae, be, L, sp);
}
/** `ko` with only the softened regions of its armed layer that soften anything at `buf` (softUnder) - `ko` itself where
 *  that is all of them. */
function softView(ko, buf) {
  const L = ko && ko.deep, soft = L && L.soft;
  if (!soft || !soft.length || soft.every((c) => softUnder(c, buf))) return ko;
  return { ...ko, deep: { ...L, soft: soft.filter((c) => softUnder(c, buf)) } };
}
/** The sampled test of the leg ae -> be (frame meters, `L` long) at `buf`, `hit(p, r)` the point test at a radius (see
 *  legClear's note). */
function sampledClear(ae, be, L, buf, hit) {
  const n = Math.max(1, Math.ceil(L / Math.max(2, buf / 2)));
  const h = L / n, r = Math.hypot(buf, h / 2);
  const at = (t) => ({ e: ae.e + (be.e - ae.e) * t, n: ae.n + (be.n - ae.n) * t });
  for (let i = 0; i <= n; i++) {
    const p = at(i / n);
    if (!hit(p, r)) continue;                         // nothing could lie within the buffer of the leg near this sample
    if (hit(p, buf)) return false;                    // within the buffer of the sample itself
    const m = Math.max(1, Math.ceil(2 * h / LEG_FINE_M));
    for (let j = 0; j <= m; j++) {                    // the stretch within h either side, at the buffer
      const t = (i - 1 + 2 * j / m) / n;
      if (t > 0 && t < 1 && hit(at(t), buf)) return false;
    }
  }
  return true;
}
/** For legClear: where the leg ae -> be comes near a softened region of `ko`'s armed layer (softView's: each `at` under
 *  `buf`), its river's water as a test of its own - {at (the least such `at`, which sets the step), hit(p, d)}: is the
 *  river's water within e + d of `p`, where e is the buffer it is kept at about `p` (the least `at` of the regions `p`
 *  lies in, else `buf`) - and for d > 0, `buf` where a ring region's edge lies within d of `p`, the most a point of the
 *  leg within d of it may be held to; and a released region's water clear, for d > 0 only where `p` is d inside it -
 *  else null. */
function softPass(ae, be, ko, buf) {
  const L = ko.deep, soft = L && L.soft;
  if (!soft || !soft.length) return null;
  const bb = { x0: Math.min(ae.e, be.e), x1: Math.max(ae.e, be.e), y0: Math.min(ae.n, be.n), y1: Math.max(ae.n, be.n) };
  const near = soft.filter((c) => c.all || !(c.bb.x0 - c.r > bb.x1 || c.bb.x1 + c.r < bb.x0 || c.bb.y0 - c.r > bb.y1 || c.bb.y1 + c.r < bb.y0));
  if (!near.length) return null;
  const at = Math.min(...near.map((c) => c.at)), rings = near.filter((c) => !c.all), rel = L.release || [];
  const river = deepSplit(L).river;
  const edge = (p, d) => rings.some((c) => inBB(p, c.bb, c.r + d) && Math.abs(ringDist(p, c.pts, false, c.r + d + 1) - c.r) <= d);
  const freed = (p, d) => rel.some((c) => inBB(p, c.bb, c.r) && ringDist(p, c.pts, false, c.r) < c.r - d);
  return { at, hit: (p, d) => {
    if (freed(p, d)) return false;
    const a = deepSoftAt(p, near);
    return blocked(p, river, (d > 0 && edge(p, d) ? buf : a != null && a < buf ? a : buf) + d);
  } };
}
/** The river pass of legClear (softPass's `sp`): a point q of the leg whose river's water lies within its own buffer e(q)
 *  lies within h/2 of a sample, so that water lies within e(q) + h/2 of the sample - and e(q) is the sample's own unless
 *  a ring region's edge lies within h/2 of it, where it is at most `buf` (and q is released only where the sample is h/2
 *  inside a released region): the sample's test at d = h/2 sees it, and the stretch within h either side is asked point
 *  by point, LEG_FINE_M apart. */
function softClear(ae, be, L, sp) {
  const n = Math.max(1, Math.ceil(L / Math.max(2, sp.at / 2)));
  const h = L / n;
  const pt = (t) => ({ e: ae.e + (be.e - ae.e) * t, n: ae.n + (be.n - ae.n) * t });
  for (let i = 0; i <= n; i++) {
    const p = pt(i / n);
    if (!sp.hit(p, h / 2)) continue;                  // no point of the leg near this sample has the water within its buffer
    if (sp.hit(p, 0)) return false;
    const m = Math.max(1, Math.ceil(2 * h / LEG_FINE_M));
    for (let j = 0; j <= m; j++) {
      const t = (i - 1 + 2 * j / m) / n;
      if (t > 0 && t < 1 && sp.hit(pt(t), 0)) return false;
    }
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
  if (!Number.isFinite(L) || !Number.isFinite(buf)) return { at: a, info: { kind: UNKNOWN_KIND, type: 'unknown' }, distance: 0 };
  const n = Math.max(2, Math.ceil(L / Math.max(2, buf / 2)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = { e: ae.e + (be.e - ae.e) * t, n: ae.n + (be.n - ae.n) * t };
    const info = blockedInfo(p, ko, buf);
    if (info) return { at: frame.fromEN(p.e, p.n), info, distance: L * t };
  }
  return null;
}

/**
 * DOES THE LEG a->b CROSS A CHARTED EDGE (the 2026-10-16 review, finding 1): a keep-out LINE (the coastline, a dock
 * line, an islet's or a hazard's line), a polygon's RING (into or out of land, a dock, a hazard area), or a point
 * hazard's own extent? GEOMETRIC, NOT SAMPLED. `legClear` tests points along the leg, and at a radius under half its
 * step - the ends' END_CLEAR_M of 0.05 m against its 2 m step - a zero-width line between two samples is never seen:
 * that is how a start 0.8 m off a pier drawn as a line was routed straight across the pier, three geometries in four.
 * An endpoint already inside a polygon (or a point hazard's extent) is led OUT of it: its one exit is not a crossing.
 * An intersection at the leg's own ends (an endpoint on the edge) is none, and a run exactly along an edge (collinear)
 * is none - `blocked` holds the leg off it at the buffer. The margin layer (ko.deep) is a band, not an edge: not asked.
 */
export function legCrosses(a, b, frame, ko) {
  return legCrossesEN(frame.toEN(a), frame.toEN(b), ko);
}
const EDGE_T_EPS = 1e-6;
/** The leg's parameter t where A->B meets the edge P->Q, strictly inside the leg and on the edge (the edge's far end
 *  counted by the next edge), or null - a parallel edge included. */
function segX(A, B, P, Q) {
  const d1x = B.e - A.e, d1y = B.n - A.n, d2x = Q.e - P.e, d2y = Q.n - P.n, den = d1x * d2y - d1y * d2x;
  // (parallel, or so near it that `den` is rounding: relative to the products it is made of - an edge on the leg's own
  //  line 209 m past its end was counted a crossing by the absolute test alone, the review of 2026-11-24)
  if (Math.abs(den) < 1e-12 || Math.abs(den) <= 1e-12 * (Math.abs(d1x * d2y) + Math.abs(d1y * d2x))) return null;
  const t = ((P.e - A.e) * d2y - (P.n - A.n) * d2x) / den, u = ((P.e - A.e) * d1y - (P.n - A.n) * d1x) / den;
  return (t > EDGE_T_EPS && t < 1 - EDGE_T_EPS && u >= 0 && u < 1) ? t : null;
}
const bbTouch = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
export function legCrossesEN(A, B, ko) {
  if (!ko) return false;
  const L = Math.hypot(B.e - A.e, B.n - A.n);
  if (!(L > 0)) return false;
  const mid = { e: (A.e + B.e) / 2, n: (A.n + B.n) / 2 }, half = L / 2 + 1;
  const box = { x0: Math.min(A.e, B.e), x1: Math.max(A.e, B.e), y0: Math.min(A.n, B.n), y1: Math.max(A.n, B.n) };
  for (const poly of nearIn(ko.polys, mid, half)) {
    if (!bbTouch(box, poly.bb)) continue;
    const ring = poly.ring, n = ring.length, G = gridFor(ring, true);
    let cuts = 0;
    // (through the grid only where the cells along the leg cost less than the ring's edges walked: a long leg past a
    //  ring of a few hundred vertices walks the edges, as it always did - RING_LEG_COST, above)
    if (G && (Math.ceil(L / G.g) + 5) * RING_LEG_COST < n) {
      // (a big ring through its grid: its long list, and the edges in the cells about points along the leg - the cell
      //  of any point where the leg meets an edge is among them - each edge once, the same test: RING_CELL_M, above)
      const tick = nextTick(G), seen = G.seen;
      const cut = (k) => { if (seen[k] !== tick) { seen[k] = tick; if (segX(A, B, ring[(k + n - 1) % n], ring[k]) != null) cuts++; } };
      for (const k of G.long) cut(k);
      const keys = new Set();
      cellsAlong(G, A, B, keys);
      for (const key of keys) { const c = G.cells.get(key); if (c) for (const k of c) cut(k); }
    } else for (let i = 0, j = n - 1; i < n; j = i++) if (segX(A, B, ring[j], ring[i]) != null) cuts++;
    if (!cuts) continue;
    const allowed = (ringInside(A, ring) ? 1 : 0) + (ringInside(B, ring) ? 1 : 0);   // the way out of the water it lies in
    if (cuts > allowed) return true;
  }
  for (const ln of nearIn(ko.lines, mid, half)) {
    if (!bbTouch(box, ln.bb)) continue;
    const pts = ln.pts;
    for (let i = 1; i < pts.length; i++) if (segX(A, B, pts[i - 1], pts[i]) != null) return true;
  }
  for (const pt of nearIn(ko.points, mid, half)) {
    const r = Math.max(pt.r || 0, 0.05);
    if (!bbTouch(box, { x0: pt.e - r, x1: pt.e + r, y0: pt.n - r, y1: pt.n + r })) continue;
    const aIn = Math.hypot(A.e - pt.e, A.n - pt.n) < r, bIn = Math.hypot(B.e - pt.e, B.n - pt.n) < r;
    if (!aIn && !bIn && dSeg({ e: pt.e, n: pt.n }, A, B) < r) return true;
  }
  return false;
}
