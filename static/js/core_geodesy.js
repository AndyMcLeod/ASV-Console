/* ========================================================================
 * VENDORED FROM asv_core -- DO NOT EDIT THIS COPY.
 *
 *   source : asv_core_js/geodesy.js
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
 * THIS REPO IS WHERE THE FLAT MODEL CAME FROM. The core's flatDistanceM,
 * flatBearingDeg and flatOffset reproduce this console's distTo, azTo and
 * atDA -- including the asymmetry nobody would invent on purpose: distance
 * and bearing take the cosine at the MID-latitude, the offset at the START
 * latitude. The core kept that rather than smoothing it, because smoothing
 * it would move keep-out decisions.
 *
 * ADOPTION HERE IS PARTIAL, AND THE SPLIT IS MEASURED, NOT AESTHETIC.
 * static/js/geodesy.js delegates distTo, azTo, atDA, alignDeg and
 * M_PER_DEG_LAT to this file. It KEEPS toEN, fromEN and llEN, because the
 * core's take a Frame where this console passes a bare ref point, and a
 * Frame is a validated contract object:
 *
 *     llEN today, cosine inline          123 ns/call
 *     core toEN, Frame built per call    328 ns/call   2.7x SLOWER
 *     core toEN, Frame hoisted            26 ns/call   4.7x faster
 *
 * llEN has 63 call sites in the keep-out raster, which runs inside a drag.
 * The naive wrapper is a real regression; the fast form needs the Frame
 * threaded through all 63, which is a refactor of the keep-out path and has
 * to be its own job with its own verification. Doing it here would have
 * buried it inside a change whose whole claim is "no behaviour change".
 *
 * NOT ADOPTED AND NOT IN THE CORE AT ALL: worldPx, worldToLatLon, TILE and
 * distPtSegPx. Web Mercator and pixel hit-testing are the VIEW layer.
 *
 * Edit the core file and re-run the sync. Everything below is verbatim.
 */

/**
 * ASV Core -- geodesy.
 *
 * THE MODEL IS PART OF EVERY NAME, AND THAT IS THE WHOLE POINT OF THIS MODULE.
 *
 * Before the core, three apps had a function called `distTo` and a function
 * called `atDA`, and they were not the same maths:
 *
 *   * ASV's are EQUIRECTANGULAR -- a flat plane, 111320 m per degree of
 *     latitude, cosine taken at the mid-latitude of the pair.
 *   * WorldView's `distTo` is VINCENTY, while its `atDA` is a SPHERICAL great
 *     circle at R = 6371008.8 m. Two different models inside one module.
 *   * Transit's `inverse`/`direct` are Vincenty.
 *
 * Measured from the DriX spawn at Lewes (38.78 N), against Vincenty:
 *
 *       leg      ASV distTo   ASV atDA err   WV atDA err
 *      1 km       +0.74 m         2.11 m        2.08 m
 *      5 km       +3.68 m         9.51 m       10.41 m
 *     10 km       +7.33 m        16.69 m       20.81 m
 *     50 km      +137 m         112.67 m      103.90 m
 *
 * ASV's `azTo` reads 44.884 deg on a leg Vincenty calls 45.000. At 5 km the
 * disagreement is three times `NOGO_BUFFER_DEFAULT_M`.
 *
 * So this module does NOT offer one `distance()` that quietly picks a model. An
 * app migrates onto it by ALIASING its historic name to the explicit one --
 * `const distTo = flatDistanceM` in ASV, `= geodesicDistanceM` in WorldView --
 * which is a rename, not a behaviour change.
 *
 * WHICH TO USE:
 *   flat*      Survey patterns, keep-out rasters, Rule 9 lanes -- anything
 *              built inside a Frame. CHAINING geodesic steps to build a pattern
 *              makes the lines FAN; the flat plane is the correct tool there.
 *   sphere*    Rough range/bearing, and great-circle interpolation.
 *   geodesic*  Transit legs, fuel, anything an operator reads as a distance.
 *
 * NAMING NOTE: functions are camelCase here because they are called from JS
 * code, while the CONTRACT FIELDS stay snake_case because those cross the wire
 * as JSON. Data keeps one spelling everywhere; call sites read naturally in
 * their own language.
 *
 * NOT IN HERE, DELIBERATELY: `worldPx` / `worldToLatLon` / `distPtSegPx` (ASV)
 * and the ECEF, mercator-tile, camera-pose and horizon block (WorldView) are
 * RENDER concerns and belong to the thing doing the drawing. This module has no
 * THREE.js dependency and must not grow one.
 */

import { frame as makeFrame } from './contracts.js';

// --------------------------------------------------------------------------- //
//  Constants
// --------------------------------------------------------------------------- //
export const A = 6378137.0;                    // WGS84 semi-major axis, m
export const F = 1 / 298.257223563;            // flattening
export const B = A * (1 - F);                  // semi-minor axis, m
export const E2 = (A * A - B * B) / (A * A);   // first eccentricity squared

export const R_MEAN = 6371008.8;               // IUGG mean radius, m

export const M_PER_NM = 1852.0;
export const NM_PER_DEG = 60.0;

/**
 * ASV's flat-earth constant. NOT the ellipsoidal metres-per-degree at any
 * latitude -- a round number that has been in the survey maths since it was a
 * faithful port of surveypattern.cpp, and every keep-out decision in that
 * console is computed with it. A defined constant, not a measurement.
 */
export const M_PER_DEG_LAT_FLAT = 111320.0;

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

// --------------------------------------------------------------------------- //
//  Tangent-plane frames
// --------------------------------------------------------------------------- //

/** [metres per degree latitude, metres per degree longitude] on WGS84. */
export function metresPerDegreeEllipsoidal(latDeg) {
  const s = Math.sin(latDeg * D2R);
  const w2 = 1 - E2 * s * s;
  const meridian = (A * (1 - E2)) / Math.pow(w2, 1.5);
  const prime = A / Math.sqrt(w2);
  return [meridian * D2R, prime * Math.cos(latDeg * D2R) * D2R];
}

/**
 * ASV's tangent plane: a constant 111320 m per degree of latitude, and the same
 * figure times cos(ref.lat) going east.
 *
 * THIS IS NOT THE ELLIPSOIDAL FRAME AND MUST NOT BE "CORRECTED" INTO ONE. At
 * Lewes the two disagree by +0.278 % north and -0.131 % east, which is 3.07 m
 * per kilometre of extent -- the same order as the entire keep-out buffer, in
 * the frame the keep-out routing and the Rule 9 lane are computed in.
 */
export function frameFlat(ref) {
  return makeFrame({
    ref: { lat: ref.lat, lon: ref.lon },
    m_per_deg_lat: M_PER_DEG_LAT_FLAT,
    m_per_deg_lon: M_PER_DEG_LAT_FLAT * Math.cos(ref.lat * D2R),
    frame_id: 'flat',
  });
}

/** WorldView's tangent plane: true WGS84 radii at the reference latitude. */
export function frameEllipsoidal(ref) {
  const [mLat, mLon] = metresPerDegreeEllipsoidal(ref.lat);
  return makeFrame({
    ref: { lat: ref.lat, lon: ref.lon },
    m_per_deg_lat: mLat,
    m_per_deg_lon: mLon,
    frame_id: 'ellipsoidal',
  });
}

/**
 * Position -> {e, n} metres in `frame`.
 *
 * Takes loose numbers rather than a contract because this is the hot path --
 * the keep-out raster calls it tens of thousands of times per plan. The Frame
 * is the contract; the points crossing this seam are numbers.
 */
export function toEN(lat, lon, frame) {
  return {
    e: (lon - frame.ref.lon) * frame.m_per_deg_lon,
    n: (lat - frame.ref.lat) * frame.m_per_deg_lat,
  };
}

/** {e, n} metres in `frame` -> {lat, lon}. */
export function fromEN(e, n, frame) {
  return {
    lat: frame.ref.lat + n / frame.m_per_deg_lat,
    lon: frame.ref.lon + e / frame.m_per_deg_lon,
  };
}

// --------------------------------------------------------------------------- //
//  Flat / equirectangular  -- ASV's model
// --------------------------------------------------------------------------- //

/**
 * Equirectangular distance, cosine at the MID-LATITUDE of the pair.
 *
 * Mid-latitude, not the first point's: ASV's `distTo` and `azTo` both use the
 * mean, while its `atDA` and `toEN` use a single point's. That asymmetry is
 * real and is reproduced here rather than smoothed over, because smoothing it
 * would move keep-out decisions.
 */
export function flatDistanceM(lat1, lon1, lat2, lon2) {
  const mlon = M_PER_DEG_LAT_FLAT * Math.cos(((lat1 + lat2) / 2) * D2R);
  return Math.hypot((lat2 - lat1) * M_PER_DEG_LAT_FLAT, (lon2 - lon1) * mlon);
}

/** Equirectangular initial bearing, degrees true in [0, 360). */
export function flatBearingDeg(lat1, lon1, lat2, lon2) {
  const mlon = M_PER_DEG_LAT_FLAT * Math.cos(((lat1 + lat2) / 2) * D2R);
  return (Math.atan2((lon2 - lon1) * mlon,
                     (lat2 - lat1) * M_PER_DEG_LAT_FLAT) * R2D + 360) % 360;
}

/**
 * Move `distM` along `azDeg` on the flat plane. ASV's `atDA`.
 *
 * Cosine at the STARTING latitude, matching ASV. Chaining this is what a survey
 * pattern is built from, and it is why patterns do not fan.
 */
export function flatOffset(lat, lon, distM, azDeg) {
  const r = azDeg * D2R;
  return {
    lat: lat + (distM * Math.cos(r)) / M_PER_DEG_LAT_FLAT,
    lon: lon + (distM * Math.sin(r)) / (M_PER_DEG_LAT_FLAT * Math.cos(lat * D2R)),
  };
}

// --------------------------------------------------------------------------- //
//  Sphere
// --------------------------------------------------------------------------- //

/** Haversine great-circle distance. */
export function sphereDistanceM(lat1, lon1, lat2, lon2, radius = R_MEAN) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle initial bearing, degrees true in [0, 360). */
export function sphereBearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Move `distM` along a great circle. WorldView's `atDA` / `offsetByAngle`. */
export function sphereOffset(lat, lon, distM, azDeg, radius = R_MEAN) {
  const ang = distM / radius;
  const p1 = lat * D2R, l1 = lon * D2R, th = azDeg * D2R;
  const sp = Math.sin(p1) * Math.cos(ang) + Math.cos(p1) * Math.sin(ang) * Math.cos(th);
  const p2 = Math.asin(Math.max(-1, Math.min(1, sp)));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(ang) * Math.cos(p1),
                             Math.cos(ang) - Math.sin(p1) * sp);
  return { lat: p2 * R2D, lon: wrapLon(l2 * R2D) };
}

// --------------------------------------------------------------------------- //
//  Geodesic -- Vincenty on WGS84
// --------------------------------------------------------------------------- //

/**
 * Vincenty inverse: [distanceM, initialBearingDeg, finalBearingDeg].
 *
 * Bearings in [0, 360). Coincident points give [0, 0, 0] rather than a NaN out
 * of atan2(0, 0) -- a zero-length leg is legitimate where an operator
 * double-clicked, and it must not poison a whole table.
 *
 * THE THIRD VALUE IS THE FORWARD AZIMUTH AT THE DESTINATION -- the course still
 * being steered on arrival. Geoscience Australia's published test vector lists
 * its alpha2 as the REVERSE azimuth, which is this value minus 180. If you are
 * checking this against a published table, check which alpha2 it means before
 * concluding it is broken.
 *
 * Vincenty fails to converge on near-antipodal pairs; it falls back to the
 * sphere so the caller sees a coarse value instead of a confident lie.
 */
export function geodesicInverse(lat1, lon1, lat2, lon2) {
  return geodesicInverseExact(lat1, lon1, lat2, lon2).slice(0, 3);
}

/**
 * Vincenty inverse plus WHETHER IT CONVERGED: [distance, a1, a2, exact].
 *
 * THE FOURTH VALUE EXISTS BECAUSE THE FALLBACK WAS SILENT. On a near-antipodal
 * pair Vincenty does not converge and this drops to the sphere -- a coarser
 * answer, quietly substituted. Transit's original returned three values and said
 * nothing, and the core inherited that. WorldView's independent implementation
 * has always returned an `exact` flag and its measure tool READS it, marking the
 * reading approximate. Adopting the core there without this would have deleted a
 * signal an operator can see.
 *
 * That is the same defect this estate keeps finding in other clothes: a clamp
 * that truncates without saying so, a vendored file that stops following its
 * source, a cap that drops 400 lines quietly. A degraded answer that looks
 * identical to a good one is the fault, not the degradation.
 */
export function geodesicInverseExact(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return [0, 0, 0, true];

  const L = (lon2 - lon1) * D2R;
  const U1 = Math.atan((1 - F) * Math.tan(lat1 * D2R));
  const U2 = Math.atan((1 - F) * Math.tan(lat2 * D2R));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1);
  const sU2 = Math.sin(U2), cU2 = Math.cos(U2);

  let lam = L;
  let sinSigma = 0, cosSigma = 0, sigma = 0, cos2Alpha = 0, cos2SigmaM = 0;
  let converged = false;
  for (let i = 0; i < 200; i++) {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    sinSigma = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl);
    if (sinSigma === 0) return [0, 0, 0, true];
    cosSigma = sU1 * sU2 + cU1 * cU2 * cl;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cU1 * cU2 * sl) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    // cos2Alpha === 0 on an equatorial line; the C term vanishes with it.
    cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - (2 * sU1 * sU2) / cos2Alpha;
    const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
    const lamPrev = lam;
    lam = L + (1 - C) * F * sinAlpha
      * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lam - lamPrev) < 1e-12) { converged = true; break; }
  }

  if (!converged) {
    return [
      sphereDistanceM(lat1, lon1, lat2, lon2),
      sphereBearingDeg(lat1, lon1, lat2, lon2),
      (sphereBearingDeg(lat2, lon2, lat1, lon1) + 180) % 360,
      false,
    ];
  }

  const u2 = (cos2Alpha * (A * A - B * B)) / (B * B);
  const Aa = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const Bb = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dSigma = Bb * sinSigma
    * (cos2SigmaM + (Bb / 4) * (cosSigma * (-1 + 2 * cos2SigmaM ** 2)
      - (Bb / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  const s = B * Aa * (sigma - dSigma);

  const sl = Math.sin(lam), cl = Math.cos(lam);
  const a1 = ((Math.atan2(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl) * R2D) % 360 + 360) % 360;
  const a2 = ((Math.atan2(cU1 * sl, -sU1 * cU2 + cU1 * sU2 * cl) * R2D) % 360 + 360) % 360;
  return [s, a1, a2, true];
}

/** Vincenty direct: travel `distM` from (lat, lon) on `azDeg`. -> {lat, lon}. */
export function geodesicDirect(lat, lon, azDeg, distM) {
  if (distM === 0) return { lat, lon };
  const a1 = azDeg * D2R;
  const sA1 = Math.sin(a1), cA1 = Math.cos(a1);
  const U1 = Math.atan((1 - F) * Math.tan(lat * D2R));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1);
  // sigma1 = angular distance from the equator to the start point on the great
  // circle. cU1 is zero only at the poles, which a hull never sees.
  const sigma1 = Math.atan2(sU1, cU1 * cA1);
  const sinAlpha = cU1 * sA1;
  const cos2Alpha = 1 - sinAlpha * sinAlpha;
  const u2 = (cos2Alpha * (A * A - B * B)) / (B * B);
  const Aa = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const Bb = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));

  let sigma = distM / (B * Aa);
  let cos2SigmaM = 0, ss = 0, cs = 0;
  for (let i = 0; i < 200; i++) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    ss = Math.sin(sigma); cs = Math.cos(sigma);
    const dSigma = Bb * ss * (cos2SigmaM + (Bb / 4) * (cs * (-1 + 2 * cos2SigmaM ** 2)
      - (Bb / 6) * cos2SigmaM * (-3 + 4 * ss ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
    const sigmaPrev = sigma;
    sigma = distM / (B * Aa) + dSigma;
    if (Math.abs(sigma - sigmaPrev) < 1e-12) break;
  }

  cos2SigmaM = Math.cos(2 * sigma1 + sigma);
  ss = Math.sin(sigma); cs = Math.cos(sigma);
  const lat2 = Math.atan2(sU1 * cs + cU1 * ss * cA1,
                          (1 - F) * Math.hypot(sinAlpha, sU1 * ss - cU1 * cs * cA1));
  const lam = Math.atan2(ss * sA1, cU1 * cs - sU1 * ss * cA1);
  const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
  const L = lam - (1 - C) * F * sinAlpha
    * (sigma + C * ss * (cos2SigmaM + C * cs * (-1 + 2 * cos2SigmaM ** 2)));
  return { lat: lat2 * R2D, lon: lon + L * R2D };
}

/** Vincenty distance only -- the common case, without unpacking a triple. */
export const geodesicDistanceM = (lat1, lon1, lat2, lon2) =>
  geodesicInverse(lat1, lon1, lat2, lon2)[0];

/** Vincenty initial bearing only. */
export const geodesicBearingDeg = (lat1, lon1, lat2, lon2) =>
  geodesicInverse(lat1, lon1, lat2, lon2)[1];

/** Total geodesic length of a [[lat, lon], ...] polyline. */
export function geodesicPathLengthM(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += geodesicInverse(points[i][0], points[i][1],
                             points[i + 1][0], points[i + 1][1])[0];
  }
  return total;
}

// --------------------------------------------------------------------------- //
//  Angles
// --------------------------------------------------------------------------- //

/** Longitude into [-180, 180). */
export function wrapLon(lon) {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

/** Bearing into [0, 360). */
export function normaliseBearing(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Signed turn from `a` to `b`, in (-180, 180].
 *
 * Exactly -180 comes back as +180, so a reversal has one representation rather
 * than two that compare unequal.
 */
export function angleDelta(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * How far off a course is from a line's direction, 0..90.
 *
 * A survey line runs in either direction, so parallel and anti-parallel both
 * read as aligned -- ASV's `alignDeg`, and the fold at 90 is the point of it.
 */
export function alignDeg(courseDeg, lineDeg) {
  let d = Math.abs((((courseDeg - lineDeg) % 360) + 360) % 360);
  if (d > 180) d = 360 - d;
  return Math.min(d, 180 - d);
}

// --------------------------------------------------------------------------- //
//  Units
// --------------------------------------------------------------------------- //
export const nmFromM = (metres) => metres / M_PER_NM;
export const mFromNm = (nm) => nm * M_PER_NM;
