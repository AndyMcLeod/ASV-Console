// static/js/inkreads.js — THE CHART READS THE CONSOLE HAS MADE, KEPT AND MERGED (2026-10-02, phase 1 of sequenced
// surveys).
//
// THE READ HELD ONE AREA. The page read the chart image over the water of each command - the punch's box, the Upload's
// box over the boat and every waypoint, a Go-To's box - and kept only the LAST read: a new one replaced it, a refused
// one emptied it, and either way every structure found before it left the keep-out model the planners and the clearance
// guard use. The read's budget is 256 tiles: at 43 N about a 0.9 km square at full detail, and about 3.5 km at the
// coarsest zoom it accepts (17); beyond that it is refused outright. So a plan spread over a harbor - the sequence of
// surveys Andy asked for, or one survey with the boat a few kilometers off - read nothing at all, and took with it
// the piers each survey's own punch had found.
//
// WHAT THIS MODULE DOES:
//   * KEEPS every read of the present chart extract (the page drops them all when the extract changes - a new extract
//     is a new explained mask - exactly as it did the one before);
//   * MERGES them into one list of structures: a structure two reads both found is counted once, the finer read's
//     (at the same zoom, the later one's);
//   * says whether a box is ALREADY READ at a useful detail (coveringRead), so the same water is not read twice;
//   * cuts a plan too big for one box into boxes that are not (pathBoxes) - the Upload reads its transits that way.
//
// ⚠ NOTHING IS DROPPED FOR NOT BEING FOUND AGAIN. A coarse read's structure that a finer read over the same water did
// not report is KEPT: a tile the finer read never received is blank paper, and blank paper reads exactly like clear
// water ("I could not look" must never pass for "I looked and found nothing" - the scan's own rule). The cost is the
// odd false keep-out from a coarse read, drawn in magenta where the operator can see it and disagree; the other way
// round, the cost is a pier.
//
// PURE: boxes and structures in, boxes and structures out. No DOM, no fetch, no page state.
import { M_PER_DEG_LAT } from "./geodesy.js";
import { bboxContains } from "./geometry.js";

export const INK_GOOD_Z = 18;          // a read at this zoom or finer is detail enough to stand for any finer request
export const INK_DUP_M = 15;           // two reads' structures closer than this, end for end, are one structure
export const INK_PATH_MAX_BOXES = 16;  // the most boxes the Upload reads its transits in, leg by leg
export const INK_READS_MAX = 64;       // reads kept per extract; past it the oldest goes (and is read again if needed)

/** The box round `pts`, padded by `padM` meters - the same box ensureNogoCovers has always built. */
export function boxAround(pts, padM){
  let S = 1e9, N = -1e9, W = 1e9, E = -1e9;
  for(const p of pts){ S = Math.min(S, p.lat); N = Math.max(N, p.lat); W = Math.min(W, p.lon); E = Math.max(E, p.lon); }
  const pad = padM || 0, mid = (S + N) / 2;
  const dlat = pad / M_PER_DEG_LAT, dlon = pad / (M_PER_DEG_LAT * Math.cos(mid * Math.PI / 180));
  return {W: W - dlon, S: S - dlat, E: E + dlon, N: N + dlat};
}

/** Does `read` already cover `bb`, read at zoom `z`? Its box must hold bb whole, and it must have been read at least as
 *  finely as bb would be - or at INK_GOOD_Z, which is detail enough to stand for a finer one. */
export function readCovers(read, bb, z){
  return !!read && !!read.bb && bboxContains(read.bb, bb) && (read.z >= z || read.z >= INK_GOOD_Z);
}
export function coveringRead(reads, bb, z){ return (reads || []).find(r => readCovers(r, bb, z)) || null; }

// --- merging -------------------------------------------------------------------------------------------------------
// Meters in a plane at `ref`: plenty at the reach of one structure.
function en(p, ref){
  return {e: (p.lon - ref.lon) * M_PER_DEG_LAT * Math.cos(ref.lat * Math.PI / 180), n: (p.lat - ref.lat) * M_PER_DEG_LAT};
}
function ptSegM(p, a, b){
  const P = en(p, a), B = en(b, a);
  const l2 = B.e * B.e + B.n * B.n;
  const t = l2 > 0 ? Math.max(0, Math.min(1, (P.e * B.e + P.n * B.n) / l2)) : 0;
  return Math.hypot(P.e - t * B.e, P.n - t * B.n);
}
/** `s` lies along `k`: both its ends within INK_DUP_M of k - the same pier read twice, or read shorter once. */
function sameLine(s, k){ return ptSegM(s.a, k.a, k.b) <= INK_DUP_M && ptSegM(s.b, k.a, k.b) <= INK_DUP_M; }
function centroid(ring){
  let lat = 0, lon = 0; for(const q of ring){ lat += q.lat; lon += q.lon; }
  return {lat: lat / ring.length, lon: lon / ring.length};
}
function inRing(p, ring){
  let inside = false;
  for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const a = ring[i], b = ring[j];
    if((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon)
      inside = !inside;
  }
  return inside;
}
/** `A` is `K`'s footprint again: either one's centroid inside the other's ring. */
function sameArea(A, K){
  if(!A.ring || A.ring.length < 3 || !K.ring || K.ring.length < 3) return false;
  return inRing(centroid(A.ring), K.ring) || inRing(centroid(K.ring), A.ring);
}

/**
 * Every read's structures as ONE set: {lines, areas, detached}. The reads are taken finest first (and, at one zoom,
 * latest first); a structure that repeats one already taken from a finer or later read is counted once. Within one read
 * nothing is merged - a read's own structures are distinct by construction.
 */
export function mergeReads(reads){
  const order = (reads || []).slice().sort((x, y) => (y.z - x.z) || ((y.seq || 0) - (x.seq || 0)));
  const lines = [], areas = [], detached = [];
  for(const r of order){
    const nL = lines.length, nA = areas.length, nD = detached.length;
    for(const s of (r.lines || [])) if(!lines.slice(0, nL).some(k => sameLine(s, k))) lines.push(s);
    for(const A of (r.areas || [])) if(!areas.slice(0, nA).some(K => sameArea(A, K))) areas.push(A);
    for(const s of (r.detached || [])) if(!detached.slice(0, nD).some(k => sameLine(s, k))) detached.push(s);
  }
  return {lines, areas, detached};
}

// --- a plan too big for one read ------------------------------------------------------------------------------------
/** Halve the leg a-b until every piece's padded box `fits`: the pieces, as point pairs that share their ends. */
function splitLeg(a, b, padM, fits, depth){
  if(fits(boxAround([a, b], padM)) || depth >= 8) return [[a, b]];
  const m = {lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2};
  return [...splitLeg(a, m, padM, fits, depth + 1), ...splitLeg(m, b, padM, fits, depth + 1)];
}

/**
 * The water along `pts` as boxes that can each be read: walking the path, a box grows point by point while it still
 * `fits`, and closes - its last point opening the next, so the two overlap there - when the next point would not fit;
 * a single leg too long for any box is halved until its pieces do. Each box is padded by `padM`, as the single box was.
 * Returns {boxes, dropped}: past `maxBoxes` the rest of the path is NOT read, and `dropped` says how many boxes that
 * was, so the page can say so rather than claim the water was read.
 */
export function pathBoxes(pts, padM, fits, maxBoxes){
  const cap = maxBoxes == null ? INK_PATH_MAX_BOXES : maxBoxes;
  const boxes = [];
  let run = [];
  for(const p of (pts || [])){
    if(!run.length){ run = [p]; continue; }
    if(fits(boxAround([...run, p], padM))){ run.push(p); continue; }
    const last = run[run.length - 1];
    if(run.length > 1) boxes.push(boxAround(run, padM));
    if(fits(boxAround([last, p], padM))){ run = [last, p]; continue; }
    for(const [a, b] of splitLeg(last, p, padM, fits, 0)) boxes.push(boxAround([a, b], padM));
    run = [p];
  }
  // A run left with ONE point after a halved leg is that leg's end, already inside its last piece: a box round it alone
  // would be read for nothing and counted against the cap. A path of one point is the one exception.
  if(run.length > 1 || (run.length && !boxes.length)) boxes.push(boxAround(run, padM));
  return boxes.length > cap ? {boxes: boxes.slice(0, cap), dropped: boxes.length - cap} : {boxes, dropped: 0};
}
