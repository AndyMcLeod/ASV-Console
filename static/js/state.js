// static/js/state.js — shared mutable state, reachable from every module.
//
// WHY THIS IS AN OBJECT AND NOT A LIST OF `export let`s. An ES module namespace is SEALED:
//
//     import * as S from "./state.js";
//     S.NOGO_BUFFER_M = 5;    // TypeError: Cannot assign to read only property
//
// `export let x` gives importers a LIVE READ-ONLY view - they see writes made inside the
// module, but they cannot make one. Since 68 of this page's 70 shared variables are
// reassigned, not merely mutated, exporting them individually would not survive contact
// with the first `NOGO_BUFFER_M = ...`. A plain exported OBJECT has ordinary writable
// properties, so `V.NOGO_BUFFER_M = 5` works from anywhere and every reader sees it.
//
// THE RULE THAT FALLS OUT, and it is the same one the Python side needs for its
// apply_vessel() block: NEVER destructure this. `const {NOGO_BUFFER_M} = V` copies the
// value at that instant and goes stale on the next vessel switch - silently, and in the
// direction that gives a deeper boat LESS clearance than its own file demands. Always
// reach through the namespace: `V.NOGO_BUFFER_M`.
//
// SCOPE: this is the VESSEL-DERIVED PARAMETER BLOCK only - the values applyVesselToUI()
// rewrites when the operator switches hull, which is exactly the set that goes stale if it
// is ever copied. The page's other shared state (mission, pat, nogo, S, asv, ...) is still
// declared in the page and moves here when the module that owns it is extracted. Growing
// this file for its own sake would just relocate the problem.

export const V = {
  // /api/vessel's whole payload - the profile the server derived from vessels/<id>.json
  VESSEL: null,

  // --- physics mirrors the sim uses for routing + turn geometry ---
  SPEED_KN: {low:1.5, survey:3.0, high:6.0},
  MAX_TURN_RATE_DEG_S: 60,

  // --- planning limits -------------------------------------------------------------
  // Corrected-depth nogo floor: draft + under-keel clearance, so a deeper-draft vessel
  // avoids more shallow water. Drives the ENC extract AND the keep-out reclassification.
  NOGO_MIN_DEPTH_M: 1.0,
  // Keep-clear buffer. A FLOOR, not a default: a persisted mission carries whatever buffer
  // it was saved with - often a smaller boat's - and applying that to a bigger vessel would
  // give it less clearance than its own file demands.
  NOGO_BUFFER_M: 3,
  // COLREGS Rule 9 keep-right wall-detection reach (m): a channel engages keep-right only
  // when BOTH walls are within this on each side. null -> the buf*10 tight-marina default.
  CHANNEL_REACH_M: null,
  // Intrinsic radius for a charted point hazard of UNKNOWN extent - a wreck symbol is a
  // position, not a size, and the casualty under it can be a 100 m ship.
  WRECK_RADIUS_M: 50,
};

// --- the keep-out model ----------------------------------------------------------------
// THE ONE MODEL EVERY BEHAVIOUR ROUTES CLEAR OF: shoreline, manmade structures, charted
// hazards, and water shallower than this vessel's own corrected floor.
//
// WHICH CLASSES ARE ENFORCED. A charted AREA is advisory here; the shoreline, structures,
// depth and point hazards are what actually refuse a route.
export const NOGO_ENF = {land:true, depth:true, haz:true, area:false};

// A CONST OBJECT, MUTATED IN PLACE AND NEVER REASSIGNED - which is why the page's 200-odd
// references needed no change when it moved here. Assign to its FIELDS. Reassigning `nogo`
// itself is impossible through an import, and that is the point: every holder stays in step.
//
// THE INITIALISER IS COPIED VERBATIM AND EVERY FIELD IS LOAD-BEARING. An earlier attempt
// retyped it and got two wrong - `enf:null` for `{...NOGO_ENF}`, and a hardcoded buffer for
// the vessel's. The console came up over Lewes reporting "clear - none charted": 360
// keep-out zones had silently become ZERO, which is the failure that lets a route cross
// land. `features:null` (not `[]`) is the not-yet-loaded signal the readout tells apart
// from a genuinely empty result.
export const nogo = {ready:false, busy:false, ref:null, ko:null, band:null, note:"nogo not loaded",
            buffer:V.NOGO_BUFFER_M, enf:{...NOGO_ENF}, features:null, bbox:null, center:null};

// --- live chart state ------------------------------------------------------------------
// These three ARE reassigned, so they are fields on an object rather than exported bindings
// (a module namespace is sealed - see the note at the top of this file).
export const sea = {
  enc: {features:[], band:null, minDepth:null},   // the fetched ENC feature set
  waterOffset: 0,   // live water level above chart datum (m), ADDED to charted soundings
  chartInfo: null,  // the ENC title block: cells, zone of confidence, survey dates
  // Did the LAST route actually engage the Rule 9 keep-right lane? Read by the
  // readouts so the operator can tell a lane-following leg from a direct one.
  laneUsed: false,
  // ... and did it engage over ALL of it? Set where a lane was ridden but a stretch of
  // the route was not: a second buoy system left un-laned (only one is laned per leg),
  // or a stretch handed back to the router. Both are SCRATCH - channelLaneRoute clears
  // them on entry and consumes them on the same tick, returning the answer WITH the
  // route it describes. Nothing outside channelLaneRoute may read them; the moment a
  // banner does, it is a remembered flag again, able to outlive the plan that set it.
  lanePartial: false,
};
