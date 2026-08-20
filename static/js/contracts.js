/* ========================================================================
 * VENDORED FROM asv_core -- DO NOT EDIT THIS COPY.
 *
 *   source : asv_core_js/contracts.js
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
 * Carried in because core_geodesy.js imports the Frame factory.
 *
 * IT KEEPS ITS OWN NAME HERE WHILE THE GEODESY IS RENAMED, AND THAT IS NOT
 * A WHIM. This console's server resolves a client module with
 * safe_js_path(), which refuses anything whose basename is not the whole
 * name -- so unlike WorldView there can be no core/ SUBDIRECTORY, and the
 * two files must sit flat beside the app's own. The core geodesy imports
 * `./contracts.js` verbatim, so THAT name has to survive; the geodesy is the
 * one that would collide with static/js/geodesy.js, so it is the one that
 * gets the prefix. Widening the path guard to allow a subdirectory would be
 * trading a security boundary for a tidier filename.
 *
 * Edit the core file and re-run the sync. Everything below is verbatim.
 */

/**
 * ASV Core -- data contracts.
 *
 * GENERATED FROM contracts/asv.schema.json BY tools/gen_contracts.py -- DO NOT EDIT
 *
 * THE single source of truth for every type that crosses a module seam.
 * asv_core/contracts.py and asv_core_js/contracts.js are BOTH generated from
 * this file by tools/gen_contracts.py. Never hand-edit either one: two
 * hand-written contract files in two languages is the drift this whole
 * exercise exists to kill.
 *
 * Field names are snake_case here too, matching the Python side, so a dict
 * the backend produced is a valid contract object with no rename shim.
 *
 * Every factory VALIDATES and FREEZES. Frozen because these cross module
 * seams: a keep-out router that quietly mutated the frame it was handed
 * would be indistinguishable from one that computed a different answer.
 *
 * Schema version 1. 20 contract types.
 */

export const SCHEMA_VERSION = 1;

export class ContractError extends Error {
  constructor(msg) { super(msg); this.name = "ContractError"; }
}

export const WAYPOINT_KIND_VALUES = Object.freeze(["transit", "line", "turn", "home", "loiter", "station"]);
export const SURVEYPARAMS_ALIGN_VALUES = Object.freeze(["start", "centre", "finish"]);
export const PATTERN_ALIGN_VALUES = Object.freeze(["start", "centre", "finish"]);
export const VERDICT_SEVERITY_VALUES = Object.freeze(["clear", "caution", "block"]);
export const TIMELINEEVENT_KIND_VALUES = Object.freeze(["depart", "arrive", "line_start", "line_end", "turn", "waypoint", "refuel", "reserve", "loiter", "abort", "mark"]);
export const TIMELINEEVENT_PHASE_VALUES = Object.freeze(["outbound", "survey", "inbound", "station", "other"]);


/**
 * A geographic position, degrees. The only position type that crosses a
 * seam. Metres belong in EN, and only ever paired with the Frame they were
 * measured in.
 *
 * @param {number} o.lat deg
 * @param {number} o.lon deg
 * @returns {Readonly<Object>}
 */
export function latLon(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("latLon() needs an object");
  }
  const out = {}; let v;
  if (o["lat"] === undefined || o["lat"] === null) {
    throw new ContractError("LatLon.lat is required");
  }
  v = o["lat"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("LatLon.lat must be a finite number, got" + " " + JSON.stringify(v));
  if (v < -90)     throw new ContractError("LatLon.lat must be >= -90, got" + " " + JSON.stringify(v));
  if (v > 90)     throw new ContractError("LatLon.lat must be <= 90, got" + " " + JSON.stringify(v));
  out.lat = v;
  if (o["lon"] === undefined || o["lon"] === null) {
    throw new ContractError("LatLon.lon is required");
  }
  v = o["lon"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("LatLon.lon must be a finite number, got" + " " + JSON.stringify(v));
  if (v < -180)     throw new ContractError("LatLon.lon must be >= -180, got" + " " + JSON.stringify(v));
  if (v > 180)     throw new ContractError("LatLon.lon must be <= 180, got" + " " + JSON.stringify(v));
  out.lon = v;
  return Object.freeze(out);
}


/**
 * East/north metres in a tangent plane. MEANINGLESS without the Frame it was
 * computed in: two EN values from different Frames must never be compared,
 * differenced or drawn together. Carrying the frame id makes that mistake
 * catchable instead of silent.
 *
 * @param {number} o.e m
 * @param {number} o.n m
 * @param {string|null} o.frame_id=
 * @returns {Readonly<Object>}
 */
export function eN(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("eN() needs an object");
  }
  const out = {}; let v;
  if (o["e"] === undefined || o["e"] === null) {
    throw new ContractError("EN.e is required");
  }
  v = o["e"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("EN.e must be a finite number, got" + " " + JSON.stringify(v));
  out.e = v;
  if (o["n"] === undefined || o["n"] === null) {
    throw new ContractError("EN.n is required");
  }
  v = o["n"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("EN.n must be a finite number, got" + " " + JSON.stringify(v));
  out.n = v;
  v = o["frame_id"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "string")       throw new ContractError("EN.frame_id must be a string, got" + " " + JSON.stringify(v));
    out.frame_id = v;
  } else out.frame_id = null;
  return Object.freeze(out);
}


/**
 * A local tangent plane about a reference position. THIS TYPE EXISTS BECAUSE
 * CHAINED GEODESICS FAN: building a survey pattern by stepping exact
 * geodesic distances accumulates convergence error and the lines splay.
 * Patterns are built in a Frame; long transits use the exact geodesic.
 * Making the plane an explicit VALUE rather than an ambient ref global is
 * what lets one implementation serve every app.
 *
 * @param {LatLon} o.ref
 * @param {number} o.m_per_deg_lat m/deg
 * @param {number} o.m_per_deg_lon m/deg
 * @param {string|null} o.frame_id=
 * @returns {Readonly<Object>}
 */
export function frame(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("frame() needs an object");
  }
  const out = {}; let v;
  if (o["ref"] === undefined || o["ref"] === null) {
    throw new ContractError("Frame.ref is required");
  }
  v = o["ref"];
  out.ref = latLon(v);
  if (o["m_per_deg_lat"] === undefined || o["m_per_deg_lat"] === null) {
    throw new ContractError("Frame.m_per_deg_lat is required");
  }
  v = o["m_per_deg_lat"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("Frame.m_per_deg_lat must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("Frame.m_per_deg_lat must be > 0, got" + " " + JSON.stringify(v));
  out.m_per_deg_lat = v;
  if (o["m_per_deg_lon"] === undefined || o["m_per_deg_lon"] === null) {
    throw new ContractError("Frame.m_per_deg_lon is required");
  }
  v = o["m_per_deg_lon"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("Frame.m_per_deg_lon must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("Frame.m_per_deg_lon must be > 0, got" + " " + JSON.stringify(v));
  out.m_per_deg_lon = v;
  v = o["frame_id"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "string")       throw new ContractError("Frame.frame_id must be a string, got" + " " + JSON.stringify(v));
    out.frame_id = v;
  } else out.frame_id = null;
  return Object.freeze(out);
}


/**
 * Where a number came from and how much to trust it. Every app reinvented
 * this independently -- marine.QUALITY (ndbc 3.0 / nws 1.5 / ww3 1.0),
 * chart.js waterTrust, qualityAt (CATZOC), the currents projection flags,
 * in_fit_window -- same concept, four vocabularies, no shared type. On a
 * safety-critical console that is the one most worth pinning down.
 *
 * @param {string} o.source
 * @param {string|null} o.observed_at=
 * @param {number|null} o.age_s= s
 * @param {number} o.quality=
 * @param {boolean} o.estimated=
 * @param {string|null} o.method=
 * @param {string} o.note=
 * @returns {Readonly<Object>}
 */
export function provenance(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("provenance() needs an object");
  }
  const out = {}; let v;
  if (o["source"] === undefined || o["source"] === null) {
    throw new ContractError("Provenance.source is required");
  }
  v = o["source"];
  if (typeof v !== "string")     throw new ContractError("Provenance.source must be a string, got" + " " + JSON.stringify(v));
  out.source = v;
  v = o["observed_at"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "string")       throw new ContractError("Provenance.observed_at must be a string, got" + " " + JSON.stringify(v));
    out.observed_at = v;
  } else out.observed_at = null;
  v = o["age_s"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("Provenance.age_s must be a finite number, got" + " " + JSON.stringify(v));
    if (v < 0)       throw new ContractError("Provenance.age_s must be >= 0, got" + " " + JSON.stringify(v));
    out.age_s = v;
  } else out.age_s = null;
  v = o["quality"];
  if (v === undefined || v === null) v = 1.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("Provenance.quality must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("Provenance.quality must be >= 0, got" + " " + JSON.stringify(v));
  if (v > 5)     throw new ContractError("Provenance.quality must be <= 5, got" + " " + JSON.stringify(v));
  out.quality = v;
  v = o["estimated"];
  if (v === undefined || v === null) v = false;
  if (typeof v !== "boolean")     throw new ContractError("Provenance.estimated must be a boolean, got" + " " + JSON.stringify(v));
  out.estimated = v;
  v = o["method"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "string")       throw new ContractError("Provenance.method must be a string, got" + " " + JSON.stringify(v));
    out.method = v;
  } else out.method = null;
  v = o["note"];
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string")     throw new ContractError("Provenance.note must be a string, got" + " " + JSON.stringify(v));
  out.note = v;
  return Object.freeze(out);
}


/**
 * One point on a route, with why it exists. kind is what lets the timeline
 * and the endurance model tell surveying from getting there without
 * re-deriving it from geometry.
 *
 * @param {number} o.lat deg
 * @param {number} o.lon deg
 * @param {string} o.name=
 * @param {number|null} o.arrival_radius_m= m
 * @param {string} o.kind=
 * @returns {Readonly<Object>}
 */
export function waypoint(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("waypoint() needs an object");
  }
  const out = {}; let v;
  if (o["lat"] === undefined || o["lat"] === null) {
    throw new ContractError("Waypoint.lat is required");
  }
  v = o["lat"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("Waypoint.lat must be a finite number, got" + " " + JSON.stringify(v));
  if (v < -90)     throw new ContractError("Waypoint.lat must be >= -90, got" + " " + JSON.stringify(v));
  if (v > 90)     throw new ContractError("Waypoint.lat must be <= 90, got" + " " + JSON.stringify(v));
  out.lat = v;
  if (o["lon"] === undefined || o["lon"] === null) {
    throw new ContractError("Waypoint.lon is required");
  }
  v = o["lon"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("Waypoint.lon must be a finite number, got" + " " + JSON.stringify(v));
  if (v < -180)     throw new ContractError("Waypoint.lon must be >= -180, got" + " " + JSON.stringify(v));
  if (v > 180)     throw new ContractError("Waypoint.lon must be <= 180, got" + " " + JSON.stringify(v));
  out.lon = v;
  v = o["name"];
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string")     throw new ContractError("Waypoint.name must be a string, got" + " " + JSON.stringify(v));
  out.name = v;
  v = o["arrival_radius_m"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("Waypoint.arrival_radius_m must be a finite number, got" + " " + JSON.stringify(v));
    if (v <= 0)       throw new ContractError("Waypoint.arrival_radius_m must be > 0, got" + " " + JSON.stringify(v));
    out.arrival_radius_m = v;
  } else out.arrival_radius_m = null;
  v = o["kind"];
  if (v === undefined || v === null) v = "transit";
  if (!WAYPOINT_KIND_VALUES.includes(v))     throw new ContractError("Waypoint.kind must be one of transit/line/turn/home/loiter/station, got" + " " + JSON.stringify(v));
  out.kind = v;
  return Object.freeze(out);
}


/**
 * What the hull will do. max_turn_rate_deg_s belongs here and not with the
 * hull dims because it is the limit the turn geometry solves against
 * (minTurnRadiusM), not a physical dimension.
 *
 * @param {number} o.transit_kt kt
 * @param {number} o.survey_kt kt
 * @param {number} o.max_kt kt
 * @param {number} o.loiter_kt= kt
 * @param {number} o.max_turn_rate_deg_s= deg/s
 * @returns {Readonly<Object>}
 */
export function speedProfile(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("speedProfile() needs an object");
  }
  const out = {}; let v;
  if (o["transit_kt"] === undefined || o["transit_kt"] === null) {
    throw new ContractError("SpeedProfile.transit_kt is required");
  }
  v = o["transit_kt"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("SpeedProfile.transit_kt must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("SpeedProfile.transit_kt must be > 0, got" + " " + JSON.stringify(v));
  out.transit_kt = v;
  if (o["survey_kt"] === undefined || o["survey_kt"] === null) {
    throw new ContractError("SpeedProfile.survey_kt is required");
  }
  v = o["survey_kt"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("SpeedProfile.survey_kt must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("SpeedProfile.survey_kt must be > 0, got" + " " + JSON.stringify(v));
  out.survey_kt = v;
  if (o["max_kt"] === undefined || o["max_kt"] === null) {
    throw new ContractError("SpeedProfile.max_kt is required");
  }
  v = o["max_kt"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("SpeedProfile.max_kt must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("SpeedProfile.max_kt must be > 0, got" + " " + JSON.stringify(v));
  out.max_kt = v;
  v = o["loiter_kt"];
  if (v === undefined || v === null) v = 0.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("SpeedProfile.loiter_kt must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("SpeedProfile.loiter_kt must be >= 0, got" + " " + JSON.stringify(v));
  out.loiter_kt = v;
  v = o["max_turn_rate_deg_s"];
  if (v === undefined || v === null) v = 20.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("SpeedProfile.max_turn_rate_deg_s must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("SpeedProfile.max_turn_rate_deg_s must be > 0, got" + " " + JSON.stringify(v));
  out.max_turn_rate_deg_s = v;
  return Object.freeze(out);
}


/**
 * Physical dimensions. draft_m gates depth, air_draft_m gates overhead
 * clearance -- both are safety inputs, not display fields.
 *
 * @param {number} o.length_m m
 * @param {number} o.beam_m m
 * @param {number} o.draft_m m
 * @param {number} o.air_draft_m= m
 * @returns {Readonly<Object>}
 */
export function hull(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("hull() needs an object");
  }
  const out = {}; let v;
  if (o["length_m"] === undefined || o["length_m"] === null) {
    throw new ContractError("Hull.length_m is required");
  }
  v = o["length_m"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("Hull.length_m must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("Hull.length_m must be > 0, got" + " " + JSON.stringify(v));
  out.length_m = v;
  if (o["beam_m"] === undefined || o["beam_m"] === null) {
    throw new ContractError("Hull.beam_m is required");
  }
  v = o["beam_m"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("Hull.beam_m must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("Hull.beam_m must be > 0, got" + " " + JSON.stringify(v));
  out.beam_m = v;
  if (o["draft_m"] === undefined || o["draft_m"] === null) {
    throw new ContractError("Hull.draft_m is required");
  }
  v = o["draft_m"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("Hull.draft_m must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("Hull.draft_m must be >= 0, got" + " " + JSON.stringify(v));
  out.draft_m = v;
  v = o["air_draft_m"];
  if (v === undefined || v === null) v = 0.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("Hull.air_draft_m must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("Hull.air_draft_m must be >= 0, got" + " " + JSON.stringify(v));
  out.air_draft_m = v;
  return Object.freeze(out);
}


/**
 * Wind and hull drag areas and coefficients, for the leeway/set model.
 * Lifted from asv_console.py's WIND_CD / HULL_CD / WIND_A_SIDE /
 * WIND_A_FRONT / HULL_A_LAT module globals.
 *
 * @param {number} o.wind_cd=
 * @param {number} o.hull_cd=
 * @param {number} o.wind_a_side= m2
 * @param {number} o.wind_a_front= m2
 * @param {number} o.hull_a_lat= m2
 * @returns {Readonly<Object>}
 */
export function dragCoeffs(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("dragCoeffs() needs an object");
  }
  const out = {}; let v;
  v = o["wind_cd"];
  if (v === undefined || v === null) v = 0.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("DragCoeffs.wind_cd must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("DragCoeffs.wind_cd must be >= 0, got" + " " + JSON.stringify(v));
  out.wind_cd = v;
  v = o["hull_cd"];
  if (v === undefined || v === null) v = 0.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("DragCoeffs.hull_cd must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("DragCoeffs.hull_cd must be >= 0, got" + " " + JSON.stringify(v));
  out.hull_cd = v;
  v = o["wind_a_side"];
  if (v === undefined || v === null) v = 0.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("DragCoeffs.wind_a_side must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("DragCoeffs.wind_a_side must be >= 0, got" + " " + JSON.stringify(v));
  out.wind_a_side = v;
  v = o["wind_a_front"];
  if (v === undefined || v === null) v = 0.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("DragCoeffs.wind_a_front must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("DragCoeffs.wind_a_front must be >= 0, got" + " " + JSON.stringify(v));
  out.wind_a_front = v;
  v = o["hull_a_lat"];
  if (v === undefined || v === null) v = 0.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("DragCoeffs.hull_a_lat must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("DragCoeffs.hull_a_lat must be >= 0, got" + " " + JSON.stringify(v));
  out.hull_a_lat = v;
  return Object.freeze(out);
}


/**
 * Voltage-drain endurance, as the ASV console models it. A discriminated
 * union member: kind is battery.
 *
 * @param {number} o.full_v V
 * @param {number} o.warn_v V
 * @param {number} o.crit_v V
 * @param {number} o.empty_v V
 * @param {string} o.kind=
 * @param {number} o.drain_idle= V/s
 * @param {number} o.drain_load= V/s
 * @returns {Readonly<Object>}
 */
export function batteryModel(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("batteryModel() needs an object");
  }
  const out = {}; let v;
  if (o["full_v"] === undefined || o["full_v"] === null) {
    throw new ContractError("BatteryModel.full_v is required");
  }
  v = o["full_v"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("BatteryModel.full_v must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("BatteryModel.full_v must be > 0, got" + " " + JSON.stringify(v));
  out.full_v = v;
  if (o["warn_v"] === undefined || o["warn_v"] === null) {
    throw new ContractError("BatteryModel.warn_v is required");
  }
  v = o["warn_v"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("BatteryModel.warn_v must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("BatteryModel.warn_v must be > 0, got" + " " + JSON.stringify(v));
  out.warn_v = v;
  if (o["crit_v"] === undefined || o["crit_v"] === null) {
    throw new ContractError("BatteryModel.crit_v is required");
  }
  v = o["crit_v"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("BatteryModel.crit_v must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("BatteryModel.crit_v must be > 0, got" + " " + JSON.stringify(v));
  out.crit_v = v;
  if (o["empty_v"] === undefined || o["empty_v"] === null) {
    throw new ContractError("BatteryModel.empty_v is required");
  }
  v = o["empty_v"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("BatteryModel.empty_v must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("BatteryModel.empty_v must be > 0, got" + " " + JSON.stringify(v));
  out.empty_v = v;
  v = o["kind"];
  if (v === undefined || v === null) v = "battery";
  if (v !== "battery")     throw new ContractError("BatteryModel.kind must be 'battery'");
  out.kind = v;
  v = o["drain_idle"];
  if (v === undefined || v === null) v = 0.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("BatteryModel.drain_idle must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("BatteryModel.drain_idle must be >= 0, got" + " " + JSON.stringify(v));
  out.drain_idle = v;
  v = o["drain_load"];
  if (v === undefined || v === null) v = 0.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("BatteryModel.drain_load must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("BatteryModel.drain_load must be >= 0, got" + " " + JSON.stringify(v));
  out.drain_load = v;
  return Object.freeze(out);
}


/**
 * Litres-burned endurance. gauge_profile is OPTIONAL and non-linear on
 * purpose: the DriX tank is 250 L by drawings against a gauge span of ~206
 * L, so percentage is not proportional to litres. Absent means treat the
 * gauge as linear.
 *
 * @param {number} o.capacity_l L
 * @param {number} o.burn_idle_lph L/h
 * @param {number} o.burn_full_lph L/h
 * @param {string} o.kind=
 * @param {number} o.burn_exp=
 * @param {number} o.reserve_warn_frac=
 * @param {number} o.reserve_crit_frac=
 * @param {Array|null} o.gauge_profile=
 * @returns {Readonly<Object>}
 */
export function fuelTankModel(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("fuelTankModel() needs an object");
  }
  const out = {}; let v;
  if (o["capacity_l"] === undefined || o["capacity_l"] === null) {
    throw new ContractError("FuelTankModel.capacity_l is required");
  }
  v = o["capacity_l"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("FuelTankModel.capacity_l must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("FuelTankModel.capacity_l must be > 0, got" + " " + JSON.stringify(v));
  out.capacity_l = v;
  if (o["burn_idle_lph"] === undefined || o["burn_idle_lph"] === null) {
    throw new ContractError("FuelTankModel.burn_idle_lph is required");
  }
  v = o["burn_idle_lph"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("FuelTankModel.burn_idle_lph must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("FuelTankModel.burn_idle_lph must be >= 0, got" + " " + JSON.stringify(v));
  out.burn_idle_lph = v;
  if (o["burn_full_lph"] === undefined || o["burn_full_lph"] === null) {
    throw new ContractError("FuelTankModel.burn_full_lph is required");
  }
  v = o["burn_full_lph"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("FuelTankModel.burn_full_lph must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("FuelTankModel.burn_full_lph must be > 0, got" + " " + JSON.stringify(v));
  out.burn_full_lph = v;
  v = o["kind"];
  if (v === undefined || v === null) v = "fuel";
  if (v !== "fuel")     throw new ContractError("FuelTankModel.kind must be 'fuel'");
  out.kind = v;
  v = o["burn_exp"];
  if (v === undefined || v === null) v = 3.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("FuelTankModel.burn_exp must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("FuelTankModel.burn_exp must be > 0, got" + " " + JSON.stringify(v));
  out.burn_exp = v;
  v = o["reserve_warn_frac"];
  if (v === undefined || v === null) v = 0.25;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("FuelTankModel.reserve_warn_frac must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("FuelTankModel.reserve_warn_frac must be >= 0, got" + " " + JSON.stringify(v));
  if (v > 1)     throw new ContractError("FuelTankModel.reserve_warn_frac must be <= 1, got" + " " + JSON.stringify(v));
  out.reserve_warn_frac = v;
  v = o["reserve_crit_frac"];
  if (v === undefined || v === null) v = 0.1;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("FuelTankModel.reserve_crit_frac must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("FuelTankModel.reserve_crit_frac must be >= 0, got" + " " + JSON.stringify(v));
  if (v > 1)     throw new ContractError("FuelTankModel.reserve_crit_frac must be <= 1, got" + " " + JSON.stringify(v));
  out.reserve_crit_frac = v;
  v = o["gauge_profile"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (!Array.isArray(v))       throw new ContractError("FuelTankModel.gauge_profile must be an array, got" + " " + JSON.stringify(v));
    out.gauge_profile = v;
  } else out.gauge_profile = null;
  return Object.freeze(out);
}


/**
 * One ASV's capability, whole. planning is a deliberately free-form dict
 * carrying the OPTIONAL planning keys (CHANNEL_REACH_M and friends): absent
 * or 0 means the old behaviour, which is how a vessel config adds behaviour
 * without forking the code path.
 *
 * @param {string} o.id
 * @param {Hull} o.hull
 * @param {SpeedProfile} o.speeds
 * @param {BatteryModel|FuelTankModel} o.power
 * @param {string} o.name=
 * @param {DragCoeffs} o.drag=
 * @param {number} o.under_keel_clearance_m= m
 * @param {number} o.min_nav_depth_m= m
 * @param {Object} o.planning=
 * @returns {Readonly<Object>}
 */
export function vesselProfile(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("vesselProfile() needs an object");
  }
  const out = {}; let v;
  if (o["id"] === undefined || o["id"] === null) {
    throw new ContractError("VesselProfile.id is required");
  }
  v = o["id"];
  if (typeof v !== "string")     throw new ContractError("VesselProfile.id must be a string, got" + " " + JSON.stringify(v));
  if (v.length < 1)     throw new ContractError("VesselProfile.id must not be empty");
  out.id = v;
  if (o["hull"] === undefined || o["hull"] === null) {
    throw new ContractError("VesselProfile.hull is required");
  }
  v = o["hull"];
  out.hull = hull(v);
  if (o["speeds"] === undefined || o["speeds"] === null) {
    throw new ContractError("VesselProfile.speeds is required");
  }
  v = o["speeds"];
  out.speeds = speedProfile(v);
  if (o["power"] === undefined || o["power"] === null) {
    throw new ContractError("VesselProfile.power is required");
  }
  v = o["power"];
  out.power = powerModel(v);
  v = o["name"];
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string")     throw new ContractError("VesselProfile.name must be a string, got" + " " + JSON.stringify(v));
  out.name = v;
  v = o["drag"];
  if (v === undefined || v === null) v = null;
  out.drag = dragCoeffs(v === undefined || v === null ? {} : v);
  v = o["under_keel_clearance_m"];
  if (v === undefined || v === null) v = 0.9;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("VesselProfile.under_keel_clearance_m must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("VesselProfile.under_keel_clearance_m must be >= 0, got" + " " + JSON.stringify(v));
  out.under_keel_clearance_m = v;
  v = o["min_nav_depth_m"];
  if (v === undefined || v === null) v = 1.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("VesselProfile.min_nav_depth_m must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("VesselProfile.min_nav_depth_m must be >= 0, got" + " " + JSON.stringify(v));
  out.min_nav_depth_m = v;
  v = o["planning"];
  if (v === undefined || v === null) v = {};
  if (typeof v !== "object" || Array.isArray(v))     throw new ContractError("VesselProfile.planning must be an object, got" + " " + JSON.stringify(v));
  out.planning = v;
  return Object.freeze(out);
}


/**
 * The dials on a survey. NOTE WHAT IS NOT HERE: no stored spacing/direction
 * override. In both consoles a typed value MOVES A POINT -- spacing and
 * direction move C, length moves B -- so dragging always wins afterwards.
 * Storing an override alongside the geometry is what made the two disagree.
 *
 * @param {number} o.spacing_m m
 * @param {number} o.direction_deg deg true
 * @param {number|null} o.line_length_m= m
 * @param {number|null} o.swath_m= m
 * @param {number|null} o.speed_kt= kt
 * @param {string} o.align=
 * @returns {Readonly<Object>}
 */
export function surveyParams(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("surveyParams() needs an object");
  }
  const out = {}; let v;
  if (o["spacing_m"] === undefined || o["spacing_m"] === null) {
    throw new ContractError("SurveyParams.spacing_m is required");
  }
  v = o["spacing_m"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("SurveyParams.spacing_m must be a finite number, got" + " " + JSON.stringify(v));
  if (v <= 0)     throw new ContractError("SurveyParams.spacing_m must be > 0, got" + " " + JSON.stringify(v));
  out.spacing_m = v;
  if (o["direction_deg"] === undefined || o["direction_deg"] === null) {
    throw new ContractError("SurveyParams.direction_deg is required");
  }
  v = o["direction_deg"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("SurveyParams.direction_deg must be a finite number, got" + " " + JSON.stringify(v));
  out.direction_deg = v;
  v = o["line_length_m"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("SurveyParams.line_length_m must be a finite number, got" + " " + JSON.stringify(v));
    if (v <= 0)       throw new ContractError("SurveyParams.line_length_m must be > 0, got" + " " + JSON.stringify(v));
    out.line_length_m = v;
  } else out.line_length_m = null;
  v = o["swath_m"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("SurveyParams.swath_m must be a finite number, got" + " " + JSON.stringify(v));
    if (v <= 0)       throw new ContractError("SurveyParams.swath_m must be > 0, got" + " " + JSON.stringify(v));
    out.swath_m = v;
  } else out.swath_m = null;
  v = o["speed_kt"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("SurveyParams.speed_kt must be a finite number, got" + " " + JSON.stringify(v));
    if (v <= 0)       throw new ContractError("SurveyParams.speed_kt must be > 0, got" + " " + JSON.stringify(v));
    out.speed_kt = v;
  } else out.speed_kt = null;
  v = o["align"];
  if (v === undefined || v === null) v = "start";
  if (!SURVEYPARAMS_ALIGN_VALUES.includes(v))     throw new ContractError("SurveyParams.align must be one of start/centre/finish, got" + " " + JSON.stringify(v));
  out.align = v;
  return Object.freeze(out);
}


/**
 * The three-handle survey pattern: A the origin, B the along-track extent, C
 * the across-track extent. ASV's model, promoted. Spacing is the distance A
 * to C and direction is the bearing A to C; line length is the A-B box along
 * track.
 *
 * @param {LatLon} o.a
 * @param {LatLon} o.b
 * @param {LatLon|null} o.c=
 * @param {string} o.align=
 * @param {number|null} o.turn_radius_m= m
 * @returns {Readonly<Object>}
 */
export function pattern(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("pattern() needs an object");
  }
  const out = {}; let v;
  if (o["a"] === undefined || o["a"] === null) {
    throw new ContractError("Pattern.a is required");
  }
  v = o["a"];
  out.a = latLon(v);
  if (o["b"] === undefined || o["b"] === null) {
    throw new ContractError("Pattern.b is required");
  }
  v = o["b"];
  out.b = latLon(v);
  v = o["c"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    out.c = latLon(v);
  } else out.c = null;
  v = o["align"];
  if (v === undefined || v === null) v = "start";
  if (!PATTERN_ALIGN_VALUES.includes(v))     throw new ContractError("Pattern.align must be one of start/centre/finish, got" + " " + JSON.stringify(v));
  out.align = v;
  v = o["turn_radius_m"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("Pattern.turn_radius_m must be a finite number, got" + " " + JSON.stringify(v));
    if (v <= 0)       throw new ContractError("Pattern.turn_radius_m must be > 0, got" + " " + JSON.stringify(v));
    out.turn_radius_m = v;
  } else out.turn_radius_m = null;
  return Object.freeze(out);
}


/**
 * Wind and sea at a place and time. sea_state_wmo is the SINGLE agreed
 * sea-state channel: ASV derives it from wind speed, Transit from wave
 * height (hs_to_wmo). Those disagree today -- one field with provenance is
 * how that becomes visible rather than silent.
 *
 * @param {Provenance} o.provenance
 * @param {number|null} o.wind_kt= kt
 * @param {number|null} o.wind_from_deg= deg true
 * @param {number|null} o.gust_kt= kt
 * @param {number|null} o.wave_m= m
 * @param {number|null} o.wave_period_s= s
 * @param {number|null} o.wave_from_deg= deg true
 * @param {number|null} o.sea_state_wmo=
 * @returns {Readonly<Object>}
 */
export function envSample(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("envSample() needs an object");
  }
  const out = {}; let v;
  if (o["provenance"] === undefined || o["provenance"] === null) {
    throw new ContractError("EnvSample.provenance is required");
  }
  v = o["provenance"];
  out.provenance = provenance(v);
  v = o["wind_kt"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvSample.wind_kt must be a finite number, got" + " " + JSON.stringify(v));
    if (v < 0)       throw new ContractError("EnvSample.wind_kt must be >= 0, got" + " " + JSON.stringify(v));
    out.wind_kt = v;
  } else out.wind_kt = null;
  v = o["wind_from_deg"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvSample.wind_from_deg must be a finite number, got" + " " + JSON.stringify(v));
    out.wind_from_deg = v;
  } else out.wind_from_deg = null;
  v = o["gust_kt"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvSample.gust_kt must be a finite number, got" + " " + JSON.stringify(v));
    if (v < 0)       throw new ContractError("EnvSample.gust_kt must be >= 0, got" + " " + JSON.stringify(v));
    out.gust_kt = v;
  } else out.gust_kt = null;
  v = o["wave_m"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvSample.wave_m must be a finite number, got" + " " + JSON.stringify(v));
    if (v < 0)       throw new ContractError("EnvSample.wave_m must be >= 0, got" + " " + JSON.stringify(v));
    out.wave_m = v;
  } else out.wave_m = null;
  v = o["wave_period_s"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvSample.wave_period_s must be a finite number, got" + " " + JSON.stringify(v));
    if (v < 0)       throw new ContractError("EnvSample.wave_period_s must be >= 0, got" + " " + JSON.stringify(v));
    out.wave_period_s = v;
  } else out.wave_period_s = null;
  v = o["wave_from_deg"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvSample.wave_from_deg must be a finite number, got" + " " + JSON.stringify(v));
    out.wave_from_deg = v;
  } else out.wave_from_deg = null;
  v = o["sea_state_wmo"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvSample.sea_state_wmo must be a finite number, got" + " " + JSON.stringify(v));
    if (!Number.isInteger(v))       throw new ContractError("EnvSample.sea_state_wmo must be an integer, got" + " " + JSON.stringify(v));
    if (v < 0)       throw new ContractError("EnvSample.sea_state_wmo must be >= 0, got" + " " + JSON.stringify(v));
    if (v > 9)       throw new ContractError("EnvSample.sea_state_wmo must be <= 9, got" + " " + JSON.stringify(v));
    out.sea_state_wmo = v;
  } else out.sea_state_wmo = null;
  return Object.freeze(out);
}


/**
 * Set and drift. set_deg is the direction the water is going TOWARD
 * (oceanographic convention, as DBOFS reports it) -- the opposite of the
 * meteorological from convention used by wind_from_deg. Getting these two
 * backwards is a whole class of bug, so they are named differently on
 * purpose.
 *
 * @param {number} o.set_deg deg true (toward)
 * @param {number} o.drift_kt kt
 * @param {Provenance} o.provenance
 * @returns {Readonly<Object>}
 */
export function currentSample(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("currentSample() needs an object");
  }
  const out = {}; let v;
  if (o["set_deg"] === undefined || o["set_deg"] === null) {
    throw new ContractError("CurrentSample.set_deg is required");
  }
  v = o["set_deg"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("CurrentSample.set_deg must be a finite number, got" + " " + JSON.stringify(v));
  out.set_deg = v;
  if (o["drift_kt"] === undefined || o["drift_kt"] === null) {
    throw new ContractError("CurrentSample.drift_kt is required");
  }
  v = o["drift_kt"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("CurrentSample.drift_kt must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("CurrentSample.drift_kt must be >= 0, got" + " " + JSON.stringify(v));
  out.drift_kt = v;
  if (o["provenance"] === undefined || o["provenance"] === null) {
    throw new ContractError("CurrentSample.provenance is required");
  }
  v = o["provenance"];
  out.provenance = provenance(v);
  return Object.freeze(out);
}


/**
 * The tide correction applied to charted depth, and how far away the station
 * is that justified it. distance_km is not decoration: chart.js grades trust
 * by it (WATER_FAR_KM 25, WATER_REMOTE_KM 75).
 *
 * @param {number} o.offset_m m
 * @param {Provenance} o.provenance
 * @param {string} o.datum=
 * @param {string|null} o.station_id=
 * @param {number|null} o.distance_km= km
 * @returns {Readonly<Object>}
 */
export function waterLevel(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("waterLevel() needs an object");
  }
  const out = {}; let v;
  if (o["offset_m"] === undefined || o["offset_m"] === null) {
    throw new ContractError("WaterLevel.offset_m is required");
  }
  v = o["offset_m"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("WaterLevel.offset_m must be a finite number, got" + " " + JSON.stringify(v));
  out.offset_m = v;
  if (o["provenance"] === undefined || o["provenance"] === null) {
    throw new ContractError("WaterLevel.provenance is required");
  }
  v = o["provenance"];
  out.provenance = provenance(v);
  v = o["datum"];
  if (v === undefined || v === null) v = "MLLW";
  if (typeof v !== "string")     throw new ContractError("WaterLevel.datum must be a string, got" + " " + JSON.stringify(v));
  out.datum = v;
  v = o["station_id"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "string")       throw new ContractError("WaterLevel.station_id must be a string, got" + " " + JSON.stringify(v));
    out.station_id = v;
  } else out.station_id = null;
  v = o["distance_km"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("WaterLevel.distance_km must be a finite number, got" + " " + JSON.stringify(v));
    if (v < 0)       throw new ContractError("WaterLevel.distance_km must be >= 0, got" + " " + JSON.stringify(v));
    out.distance_km = v;
  } else out.distance_km = null;
  return Object.freeze(out);
}


/**
 * The environmental gate: what conditions the mission refuses to run in.
 * Every field is a limit, so every field is a refusal an operator can be
 * shown a reason for.
 *
 * @param {number|null} o.max_wind_kt= kt
 * @param {number|null} o.max_gust_kt= kt
 * @param {number|null} o.max_wave_m= m
 * @param {number|null} o.max_sea_state_wmo=
 * @param {number|null} o.max_current_kt= kt
 * @param {number|null} o.min_depth_m= m
 * @param {number} o.under_keel_clearance_m= m
 * @param {number} o.nogo_buffer_m= m
 * @returns {Readonly<Object>}
 */
export function envConstraints(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("envConstraints() needs an object");
  }
  const out = {}; let v;
  v = o["max_wind_kt"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvConstraints.max_wind_kt must be a finite number, got" + " " + JSON.stringify(v));
    if (v <= 0)       throw new ContractError("EnvConstraints.max_wind_kt must be > 0, got" + " " + JSON.stringify(v));
    out.max_wind_kt = v;
  } else out.max_wind_kt = null;
  v = o["max_gust_kt"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvConstraints.max_gust_kt must be a finite number, got" + " " + JSON.stringify(v));
    if (v <= 0)       throw new ContractError("EnvConstraints.max_gust_kt must be > 0, got" + " " + JSON.stringify(v));
    out.max_gust_kt = v;
  } else out.max_gust_kt = null;
  v = o["max_wave_m"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvConstraints.max_wave_m must be a finite number, got" + " " + JSON.stringify(v));
    if (v <= 0)       throw new ContractError("EnvConstraints.max_wave_m must be > 0, got" + " " + JSON.stringify(v));
    out.max_wave_m = v;
  } else out.max_wave_m = null;
  v = o["max_sea_state_wmo"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvConstraints.max_sea_state_wmo must be a finite number, got" + " " + JSON.stringify(v));
    if (!Number.isInteger(v))       throw new ContractError("EnvConstraints.max_sea_state_wmo must be an integer, got" + " " + JSON.stringify(v));
    if (v < 0)       throw new ContractError("EnvConstraints.max_sea_state_wmo must be >= 0, got" + " " + JSON.stringify(v));
    if (v > 9)       throw new ContractError("EnvConstraints.max_sea_state_wmo must be <= 9, got" + " " + JSON.stringify(v));
    out.max_sea_state_wmo = v;
  } else out.max_sea_state_wmo = null;
  v = o["max_current_kt"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvConstraints.max_current_kt must be a finite number, got" + " " + JSON.stringify(v));
    if (v <= 0)       throw new ContractError("EnvConstraints.max_current_kt must be > 0, got" + " " + JSON.stringify(v));
    out.max_current_kt = v;
  } else out.max_current_kt = null;
  v = o["min_depth_m"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("EnvConstraints.min_depth_m must be a finite number, got" + " " + JSON.stringify(v));
    if (v < 0)       throw new ContractError("EnvConstraints.min_depth_m must be >= 0, got" + " " + JSON.stringify(v));
    out.min_depth_m = v;
  } else out.min_depth_m = null;
  v = o["under_keel_clearance_m"];
  if (v === undefined || v === null) v = 0.9;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("EnvConstraints.under_keel_clearance_m must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("EnvConstraints.under_keel_clearance_m must be >= 0, got" + " " + JSON.stringify(v));
  out.under_keel_clearance_m = v;
  v = o["nogo_buffer_m"];
  if (v === undefined || v === null) v = 3.0;
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("EnvConstraints.nogo_buffer_m must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("EnvConstraints.nogo_buffer_m must be >= 0, got" + " " + JSON.stringify(v));
  out.nogo_buffer_m = v;
  return Object.freeze(out);
}


/**
 * Which keep-out classes are armed. ASV's NOGO_ENF, promoted verbatim
 * including its default: area is OFF because charted areas are advisory far
 * more often than they are hard.
 *
 * @param {boolean} o.land=
 * @param {boolean} o.depth=
 * @param {boolean} o.haz=
 * @param {boolean} o.area=
 * @returns {Readonly<Object>}
 */
export function nogoEnforcement(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("nogoEnforcement() needs an object");
  }
  const out = {}; let v;
  v = o["land"];
  if (v === undefined || v === null) v = true;
  if (typeof v !== "boolean")     throw new ContractError("NogoEnforcement.land must be a boolean, got" + " " + JSON.stringify(v));
  out.land = v;
  v = o["depth"];
  if (v === undefined || v === null) v = true;
  if (typeof v !== "boolean")     throw new ContractError("NogoEnforcement.depth must be a boolean, got" + " " + JSON.stringify(v));
  out.depth = v;
  v = o["haz"];
  if (v === undefined || v === null) v = true;
  if (typeof v !== "boolean")     throw new ContractError("NogoEnforcement.haz must be a boolean, got" + " " + JSON.stringify(v));
  out.haz = v;
  v = o["area"];
  if (v === undefined || v === null) v = false;
  if (typeof v !== "boolean")     throw new ContractError("NogoEnforcement.area must be a boolean, got" + " " + JSON.stringify(v));
  out.area = v;
  return Object.freeze(out);
}


/**
 * The answer to any safety question, with its reasons. reasons is plural and
 * ordered because a leg can fail three ways at once and the operator needs
 * all three, not the first.
 *
 * @param {boolean} o.ok
 * @param {string} o.severity=
 * @param {Array} o.reasons=
 * @returns {Readonly<Object>}
 */
export function verdict(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("verdict() needs an object");
  }
  const out = {}; let v;
  if (o["ok"] === undefined || o["ok"] === null) {
    throw new ContractError("Verdict.ok is required");
  }
  v = o["ok"];
  if (typeof v !== "boolean")     throw new ContractError("Verdict.ok must be a boolean, got" + " " + JSON.stringify(v));
  out.ok = v;
  v = o["severity"];
  if (v === undefined || v === null) v = "clear";
  if (!VERDICT_SEVERITY_VALUES.includes(v))     throw new ContractError("Verdict.severity must be one of clear/caution/block, got" + " " + JSON.stringify(v));
  out.severity = v;
  v = o["reasons"];
  if (v === undefined || v === null) v = [];
  if (!Array.isArray(v))     throw new ContractError("Verdict.reasons must be an array, got" + " " + JSON.stringify(v));
  out.reasons = v;
  return Object.freeze(out);
}


/**
 * One thing that happens during a mission. into_nm is always present, at
 * only when a departure time was given -- so a plan is orderable without
 * being scheduled.
 *
 * @param {number} o.into_nm NM
 * @param {string} o.kind
 * @param {string|null} o.at=
 * @param {string} o.phase=
 * @param {string} o.label=
 * @param {number|null} o.fuel_l= L
 * @param {number|null} o.batt_pct= %
 * @returns {Readonly<Object>}
 */
export function timelineEvent(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("timelineEvent() needs an object");
  }
  const out = {}; let v;
  if (o["into_nm"] === undefined || o["into_nm"] === null) {
    throw new ContractError("TimelineEvent.into_nm is required");
  }
  v = o["into_nm"];
  if (typeof v !== "number" || !Number.isFinite(v))     throw new ContractError("TimelineEvent.into_nm must be a finite number, got" + " " + JSON.stringify(v));
  if (v < 0)     throw new ContractError("TimelineEvent.into_nm must be >= 0, got" + " " + JSON.stringify(v));
  out.into_nm = v;
  if (o["kind"] === undefined || o["kind"] === null) {
    throw new ContractError("TimelineEvent.kind is required");
  }
  v = o["kind"];
  if (!TIMELINEEVENT_KIND_VALUES.includes(v))     throw new ContractError("TimelineEvent.kind must be one of depart/arrive/line_start/line_end/turn/waypoint/refuel/reserve/loiter/abort/mark, got" + " " + JSON.stringify(v));
  out.kind = v;
  v = o["at"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "string")       throw new ContractError("TimelineEvent.at must be a string, got" + " " + JSON.stringify(v));
    out.at = v;
  } else out.at = null;
  v = o["phase"];
  if (v === undefined || v === null) v = "other";
  if (!TIMELINEEVENT_PHASE_VALUES.includes(v))     throw new ContractError("TimelineEvent.phase must be one of outbound/survey/inbound/station/other, got" + " " + JSON.stringify(v));
  out.phase = v;
  v = o["label"];
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string")     throw new ContractError("TimelineEvent.label must be a string, got" + " " + JSON.stringify(v));
  out.label = v;
  v = o["fuel_l"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("TimelineEvent.fuel_l must be a finite number, got" + " " + JSON.stringify(v));
    if (v < 0)       throw new ContractError("TimelineEvent.fuel_l must be >= 0, got" + " " + JSON.stringify(v));
    out.fuel_l = v;
  } else out.fuel_l = null;
  v = o["batt_pct"];
  if (v === undefined || v === null) v = null;
  if (v !== null && v !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v))       throw new ContractError("TimelineEvent.batt_pct must be a finite number, got" + " " + JSON.stringify(v));
    if (v < 0)       throw new ContractError("TimelineEvent.batt_pct must be >= 0, got" + " " + JSON.stringify(v));
    if (v > 100)       throw new ContractError("TimelineEvent.batt_pct must be <= 100, got" + " " + JSON.stringify(v));
    out.batt_pct = v;
  } else out.batt_pct = null;
  return Object.freeze(out);
}


const POWER_KINDS = Object.freeze({
  "battery": batteryModel,
  "fuel": fuelTankModel,
});

/**
 * Resolve a power model from its discriminator.
 *
 * A missing or unknown kind throws rather than defaulting: guessing battery
 * for a fuelled hull would silently produce an endurance number with no
 * relation to the vessel.
 */
export function powerModel(o) {
  if (o === null || typeof o !== "object") {
    throw new ContractError("power must be an object");
  }
  const make = POWER_KINDS[o.kind];
  if (!make) {
    throw new ContractError(
      "power kind must be one of " + Object.keys(POWER_KINDS).join("/") +
      ", got " + JSON.stringify(o.kind));
  }
  return make(o);
}
