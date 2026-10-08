// tests/ais_keepout.js - an AIS contact as a keep-out: the hull she broadcasts (or 20 x 8 m),
// where she is now, where she will be, and NO margin of its own.
//
// Andy, 2026-09-25: "Treat AIS targets with dimensions as NOGO areas. They may be moving so the
// calculation must update with them. ... AIS targets without dimensions are to be assumed 20m
// long and 8m wide." Then: "disregard the 20m perimeter buffer."
//
// The rules this suite encodes (static/js/ais_keepout.js):
//   * a contact with no size is a 20 x 8 m hull about its antenna; one with a size is that hull,
//     with the bow A meters AHEAD of the antenna, not centered on it;
//   * the box points along her heading, else her course while under way; a stationary contact
//     with neither is a disc of the box's half-diagonal;
//   * she is dead-reckoned from her last report by course and speed, capped at AIS_DR_MAX_S;
//   * while under way her keep-out is SWEPT over the guard's look-ahead - the water she will
//     occupy - and a stationary contact is not;
//   * THE HULL IS THE KEEP-OUT. No perimeter buffer of its own: a point 1 m off her side reads
//     clear at buffer 0 and blocked at buffer 2, exactly as it would beside a pier;
//   * contacts beyond AIS_KO_RANGE_M are not modelled, and a poll older than AIS_KO_STALE_S (or
//     none) is STALE - an empty model with a reason, never a quiet sea.
//
//   * and, for a PASSAGE only (2026-10-07), the vessels NOT under way in the chart box are laid round as a pier is,
//     in a copy of the chart's model - never one under way, never a survey pattern's own lines (M1-M8).
//
//   node tests/ais_keepout.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ASV_AIS_KEEPOUT names a sidecar copy of the module for a mutation run (it must sit in
// static/js so its own imports resolve).

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
const MOD = process.env.ASV_AIS_KEEPOUT || path.join(__dirname, "..", "static", "js", "ais_keepout.js");
const A = require(MOD);
const { planeFrame } = require("../static/js/geodesy.js");
const { blocked, clearanceM } = require("../static/js/keepouts.js");
const G = require("../static/js/guard.js");

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

const ref = planeFrame({ lat: 43.07, lon: -70.76 });
const ll = (e, n) => ref.fromEN(e, n);
const NOW = 1_700_000_000_000;
// A contact at frame (e, n) with whatever else `o` says. No size unless `o` gives one.
function contact(e, n, o = {}) {
  const p = ll(e, n);
  return { mmsi: 338111222, lat: p.lat, lon: p.lon, sog: 0, cog: null, heading: null, age: 0, ...o };
}
// The keep-out model of one contact, as `blocked` reads it. sweepS 0 unless asked, so a check
// about the hull is a check about the hull.
function modelOf(v, o = {}) {
  const q = A.aisKeepout(v, ref, { now: NOW, polledAt: NOW, sweepS: 0, ...o });
  return { q, ko: { polys: q ? [q] : [], lines: [], points: [] } };
}
const inKo = (ko, e, n, buf = 0) => blocked({ e, n }, ko, buf);
const KN = 0.514444;

console.log("An AIS contact as a keep-out:");

// ── 1. NO SIZE BROADCAST: 20 x 8 m ABOUT THE ANTENNA ──────────────────────────────────
{
  const { q, ko } = modelOf(contact(0, 0, { heading: 0 }));
  check("1. a contact with no size is a 20 x 8 m hull about its antenna (Andy's assumption), pointing along her heading",
        () => q && q.box.assumed && q.box.lengthM === 20 && q.box.beamM === 8
              && inKo(ko, 0, 9.5) && !inKo(ko, 0, 10.5) && inKo(ko, 0, -9.5) && !inKo(ko, 0, -10.5)
              && inKo(ko, 3.5, 0) && !inKo(ko, 4.5, 0) && inKo(ko, -3.5, 0) && !inKo(ko, -4.5, 0),
        () => q ? q.box.lengthM + " x " + q.box.beamM + " m, assumed " + q.box.assumed
                  + "; 9.5 m ahead " + inKo(ko, 0, 9.5) + ", 10.5 m ahead " + inKo(ko, 0, 10.5)
                  + ", 3.5 m abeam " + inKo(ko, 3.5, 0) + ", 4.5 m abeam " + inKo(ko, 4.5, 0)
                : "no keep-out at all");
  check("1b. ... and says so in its name",
        () => q && /^AIS: MMSI 338111222 \(20 x 8 m assumed\)$/.test(q.kind),
        () => q && q.kind);
}

// ── 2. THE SIZE SHE BROADCAST, ABOUT THE ANTENNA SHE BROADCAST IT FROM ────────────────
{
  // A = 180 to the bow, B = 40 to the stern, C = 16 to port, D = 16 to starboard: a 220 x 32 m
  // ship with the bridge aft, heading east.
  const v = contact(0, 0, { name: "TEST HULL", heading: 90, dim: { a: 180, b: 40, c: 16, d: 16 },
                            length: 220, beam: 32 });
  const { q, ko } = modelOf(v);
  check("2. a contact with a size is THAT hull, with the bow A meters ahead of the antenna and the stern B astern - not a box centered on the position",
        () => q && !q.box.assumed && inKo(ko, 179, 0) && !inKo(ko, 181, 0)
              && inKo(ko, -39, 0) && !inKo(ko, -41, 0),
        () => q ? "179 m ahead " + inKo(ko, 179, 0) + ", 181 " + inKo(ko, 181, 0)
                  + "; 39 m astern " + inKo(ko, -39, 0) + ", 41 " + inKo(ko, -41, 0)
                : "no keep-out");
  check("2b. ... port and starboard the right way round (heading east: port is north)",
        () => inKo(ko, 0, 15) && !inKo(ko, 0, 17) && inKo(ko, 0, -15) && !inKo(ko, 0, -17),
        () => "15 m north " + inKo(ko, 0, 15) + ", 17 " + inKo(ko, 0, 17)
            + "; 15 m south " + inKo(ko, 0, -15) + ", 17 " + inKo(ko, 0, -17));
  check("2c. ... and is named with her name and size",
        () => q && q.kind === "AIS: TEST HULL (220 x 32 m)", () => q && q.kind);
}

// ── 10. NOT UNDER WAY, THOUGH SHE REPORTS A SPEED (2026-09-28) ────────────────────────
// FRIGGA at New Castle: 0.4 to 0.8 kn, twenty minutes between reports, at anchor - and at 0.8 kn she was
// modelled as under way, dead-reckoned a minute and swept 45 s ahead: 43 m of phantom hull up her course that
// reached the way round her. A transponder under way reports every few seconds; one reporting minutes apart at
// under AIS_MOVING_SURE_KN is a vessel at anchor or moored with GPS jitter on her speed.
{
  const old = modelOf(contact(0, 0, { sog: 0.8, cog: 0, heading: null, age: 1200 }), { sweepS: 45 });
  const fresh = modelOf(contact(0, 0, { sog: 0.8, cog: 0, heading: null, age: 20 }), { sweepS: 45 });
  check("10. 0.8 kn reported twenty minutes ago is NOT under way: no dead reckoning, no sweep - her hull where she reported it, nothing 20 m up her course",
        () => old.q && !old.q.moving && old.q.sweepS === 0 && inKo(old.ko, 0, 9) && !inKo(old.ko, 0, 20) && !/kn\)/.test(old.q.kind)
              && A.AIS_MOVING_AGE_S === 400 && A.AIS_MOVING_SURE_KN === 2,
        () => old.q ? "moving " + old.q.moving + ", sweep " + old.q.sweepS + ", 9 m up " + inKo(old.ko, 0, 9) + ", 20 m up " + inKo(old.ko, 0, 20) + ", kind " + old.q.kind : "no keep-out");
  check("10b. the same 0.8 kn reported 20 s ago IS under way, dead-reckoned and swept up her course (30 m up is inside her)",
        () => fresh.q && fresh.q.moving && fresh.q.sweepS === 45 && inKo(fresh.ko, 0, 30) && /0\.8 kn\)/.test(fresh.q.kind),
        () => fresh.q ? "moving " + fresh.q.moving + ", sweep " + fresh.q.sweepS + ", 30 m up " + inKo(fresh.ko, 0, 30) + ", kind " + fresh.q.kind : "no keep-out");
  const anch = modelOf(contact(0, 0, { name: "FRIGGA", sog: 1.5, cog: 0, heading: null, age: 5, nav: 1 }), { sweepS: 45 });
  const moor = modelOf(contact(0, 0, { name: "FRIGGA", sog: 1.5, cog: 0, heading: null, age: 5, nav: 5 }), { sweepS: 45 });
  const fast = modelOf(contact(0, 0, { sog: 3.0, cog: 0, heading: null, age: 1200 }), { sweepS: 45 });
  // 10d-10e. THE REVIEW'S TWO (2026-09-28): a status believed only under AIS_NAV_TRUST_KN, and an age past Class B's
  //          own slow interval - a Class B under way at 0.8 kn reports every 180 s and carries no status.
  const anchoredFast = modelOf(contact(0, 0, { name: "LIAR", sog: 6.0, cog: 0, heading: null, age: 5, nav: 1 }), { sweepS: 45 });
  const aground = modelOf(contact(0, 0, { name: "STUCK", sog: 0.3, cog: 0, heading: null, age: 5, nav: 6 }), { sweepS: 45 });
  check("10d. 'at anchor' reported at 6 kn is NOT believed (the commonest AIS error): she is under way, swept up her course; 'aground' at 0.3 kn is, and says so",
        () => anchoredFast.q && anchoredFast.q.moving && inKo(anchoredFast.ko, 0, 60) && /6\.0 kn\)/.test(anchoredFast.q.kind)
              && aground.q && !aground.q.moving && /STUCK \(20 x 8 m assumed, aground\)/.test(aground.q.kind) && A.AIS_NAV_TRUST_KN === 3,
        () => "6 kn at anchor: moving " + (anchoredFast.q && anchoredFast.q.moving) + " " + (anchoredFast.q && anchoredFast.q.kind) + "; aground: " + (aground.q && aground.q.kind));
  const classB = modelOf(contact(0, 0, { sog: 0.8, cog: 0, heading: null, age: 190 }), { sweepS: 45 });
  const stale = modelOf(contact(0, 0, { sog: 0.8, cog: 0, heading: null, age: 401 }), { sweepS: 45 });
  const edge = modelOf(contact(0, 0, { sog: 1.99, cog: 0, heading: null, age: 401 }), { sweepS: 45 });
  const twoKn = modelOf(contact(0, 0, { sog: 2.0, cog: 0, heading: null, age: 1200 }), { sweepS: 45 });
  check("10e. a Class B at 0.8 kn whose last report is 190 s old (her own slow interval is 180 s) is still under way; 401 s old she is not; 1.99 kn old is not, 2.0 kn old is (the boundary is under 2)",
        () => classB.q && classB.q.moving && stale.q && !stale.q.moving && edge.q && !edge.q.moving && twoKn.q && twoKn.q.moving,
        () => "190 s " + (classB.q && classB.q.moving) + ", 401 s " + (stale.q && stale.q.moving) + ", 1.99 kn old " + (edge.q && edge.q.moving) + ", 2.0 kn old " + (twoKn.q && twoKn.q.moving));
  check("10c. her navigational status outranks her speed: 'at anchor' (1) or 'moored' (5) at 1.5 kn fresh is not under way and says so in her name; 3 kn reported twenty minutes ago IS under way (the reckoning capped at AIS_DR_MAX_S)",
        () => anch.q && !anch.q.moving && /FRIGGA \(20 x 8 m assumed, at anchor\)/.test(anch.q.kind)
              && moor.q && !moor.q.moving && /, moored\)/.test(moor.q.kind)
              && fast.q && fast.q.moving && fast.q.sweepS === 45,
        () => "anchored: " + (anch.q && anch.q.kind) + " moving " + (anch.q && anch.q.moving) + "; moored: " + (moor.q && moor.q.kind)
            + "; 3 kn old: moving " + (fast.q && fast.q.moving));
}

// ── 10f-10h. THE WAY ROUND'S RING (2026-09-28): a ship-length about HER CENTER, her hull plus the buffer at least ──
{
  const hull30 = modelOf(contact(0, 0, { heading: 90, dim: { a: 15, b: 15, c: 4, d: 4 }, length: 30, beam: 8 })).q;   // 30 x 8 m, e = -15..15
  const calm = A.aisRoundKeepout(hull30, 3, 3), M = { polys: [calm], lines: [], points: [] };
  const clr = (e, n) => clearanceM({ e, n }, M, 200);
  check("10f. calm (standoff = the 3 m buffer): the ring is a disc of her length less the standoff (27 m) about her CENTER - so a route kept the standoff off it passes one ship-length (30 m) from her center - on the beam and ahead alike; named, and her hull inside it",
        () => calm.roundM === 30 && calm.stdM === 3 && /, 30 m round her$/.test(calm.kind)
              && Math.abs(clr(0, 30) - 3) < 0.2 && Math.abs(clr(30, 0) - 3) < 0.2 && clr(0, 26.5) === 0 && clr(26.5, 0) === 0 && clr(15, 4) === 0,
        () => "kind " + calm.kind + "; clearance 30 m abeam " + clr(0, 30).toFixed(2) + ", 30 m ahead " + clr(30, 0).toFixed(2) + ", 26.5 m abeam " + clr(0, 26.5).toFixed(2));
  const set = A.aisRoundKeepout(hull30, 19.5, 3), MS = { polys: [set], lines: [], points: [] };
  const clrS = (e, n) => clearanceM({ e, n }, MS, 200);
  check("10g. in a set (standoff 19.5 m) her length less the standoff is 10.5 m and the HULL grown by the buffer dominates along her length: 18 m ahead of her center is inside the ring (her 15 m half-length + 3), 19 m is outside; abeam the disc still reaches 10.5 m",
        () => set.stdM === 19.5 && clrS(17.9, 0) === 0 && clrS(19, 0) > 0 && clrS(0, 10.4) === 0 && clrS(0, 11.5) > 0,
        () => "18 m ahead " + clrS(17.9, 0).toFixed(2) + ", 19 m ahead " + clrS(19, 0).toFixed(2) + ", 10.4 m abeam " + clrS(0, 10.4).toFixed(2) + ", 11.5 m abeam " + clrS(0, 11.5).toFixed(2));
  const moving = modelOf(contact(0, 0, { sog: 10, cog: 90, heading: 90, dim: { a: 15, b: 15, c: 4, d: 4 }, length: 30, beam: 8 }), { sweepS: 45 }).q;
  const mv = A.aisRoundKeepout(moving, 3, 3), MM = { polys: [mv], lines: [], points: [] };
  const endE = 10 * KN * 45;                                    // where her center is at the end of the sweep
  check("10h. under way, the disc is laid about her center NOW and at the END of her sweep (10 kn x 45 s = 231 m on): 26.5 m abeam of both is inside the ring, 30 m abeam of the end is the standoff off it",
        () => mv.roundM === 30 && clearanceM({ e: 0, n: 26.5 }, MM, 200) === 0 && clearanceM({ e: endE, n: 26.5 }, MM, 200) === 0
              && Math.abs(clearanceM({ e: endE, n: 30 }, MM, 200) - 3) < 0.2,
        () => "sweep end at e = " + endE.toFixed(0) + "; 26.5 m abeam of it " + clearanceM({ e: endE, n: 26.5 }, MM, 200).toFixed(2) + ", 30 m abeam " + clearanceM({ e: endE, n: 30 }, MM, 200).toFixed(2));
}

// ── 3. WHICH WAY SHE POINTS ────────────────────────────────────────────────────────────
{
  const byCog = modelOf(contact(0, 0, { heading: null, sog: 6, cog: 90 }));
  check("3. no heading but under way: the box points along her course over the ground",
        () => byCog.q && byCog.q.hdg === 90 && inKo(byCog.ko, 9.5, 0) && !inKo(byCog.ko, 0, 9.5),
        () => byCog.q ? "hdg " + byCog.q.hdg + "; 9.5 m east " + inKo(byCog.ko, 9.5, 0)
                        + ", 9.5 m north " + inKo(byCog.ko, 0, 9.5) : "no keep-out");
  const stopped = modelOf(contact(0, 0, { heading: null, sog: 0.1, cog: 90 }));
  // hypot(20, 8) / 2 = 10.77 m
  check("3b. stationary with neither heading nor way: a disc of the box's half-diagonal - every orientation at once (her COG is noise)",
        () => stopped.q && stopped.q.hdg == null && inKo(stopped.ko, 0, 10.5) && !inKo(stopped.ko, 0, 11.5)
              && inKo(stopped.ko, 7, 7) && !inKo(stopped.ko, 8, 8),
        () => stopped.q ? "hdg " + stopped.q.hdg + "; 10.5 m " + inKo(stopped.ko, 0, 10.5)
                          + ", 11.5 m " + inKo(stopped.ko, 0, 11.5) + ", (7,7) " + inKo(stopped.ko, 7, 7)
                          + ", (8,8) " + inKo(stopped.ko, 8, 8) : "no keep-out");
  const h511 = modelOf(contact(0, 0, { heading: 511, sog: 6, cog: 90 }));
  check("3c. a heading of 511 (not available) is not a heading",
        () => h511.q && h511.q.hdg === 90, () => h511.q && "hdg " + h511.q.hdg);
}

// ── 4. DEAD RECKONING, AND ITS CAP ─────────────────────────────────────────────────────
{
  // 10 kn due north, reported 30 s ago: 154.3 m on from where she was reported.
  const v = contact(0, 0, { heading: 0, sog: 10, cog: 0, age: 30 });
  const { q, ko } = modelOf(v);
  const dr = 30 * 10 * KN;
  check("4. a contact under way is dead-reckoned from her last report by her own course and speed (10 kn, 30 s: " + dr.toFixed(1) + " m on)",
        () => q && inKo(ko, 0, dr) && !inKo(ko, 0, 0) && Math.abs(q.at.n - dr) < 0.01,
        () => q ? "at n=" + q.at.n.toFixed(1) + "; the reported position " + (inKo(ko, 0, 0) ? "STILL" : "no longer")
                  + " in the box" : "no keep-out");
  const old = modelOf(contact(0, 0, { heading: 0, sog: 10, cog: 0, age: 600 }));
  const cap = A.AIS_DR_MAX_S * 10 * KN;
  check("4b. ... capped at AIS_DR_MAX_S (" + A.AIS_DR_MAX_S + " s): a 600 s old report is carried " + cap.toFixed(0) + " m, not 3 km",
        () => old.q && Math.abs(old.q.at.n - cap) < 0.01 && inKo(old.ko, 0, cap) && !inKo(old.ko, 0, 600 * 10 * KN),
        () => old.q && "at n=" + old.q.at.n.toFixed(1));
  // The poll clock: reported 10 s before the poll, and the poll was 20 s ago.
  const both = modelOf(contact(0, 0, { heading: 0, sog: 10, cog: 0, age: 10 }), { polledAt: NOW - 20000 });
  check("4c. the age is the service's own at the poll PLUS the time since the poll (10 s + 20 s)",
        () => both.q && Math.abs(both.q.at.n - 30 * 10 * KN) < 0.01,
        () => both.q && "at n=" + both.q.at.n.toFixed(1) + " (expected " + (30 * 10 * KN).toFixed(1) + ")");
  const stopped = modelOf(contact(0, 0, { heading: 0, sog: 0.2, cog: 0, age: 30 }));
  check("4d. a stationary contact is not dead-reckoned at all",
        () => stopped.q && stopped.q.at.n === 0 && inKo(stopped.ko, 0, 0), () => stopped.q && "at n=" + stopped.q.at.n);
}

// ── 5. THE SWEEP: WHERE SHE WILL BE WITHIN THE LOOK-AHEAD ─────────────────────────────
{
  const v = contact(0, 0, { heading: 0, sog: 10, cog: 0, age: 0 });
  const swept = modelOf(v, { sweepS: 45 });
  const reach = 45 * 10 * KN + 10;                    // 45 s on, plus the bow
  check("5. under way, the keep-out is SWEPT over the look-ahead: the box now and the box 45 s on, hulled (" + reach.toFixed(0) + " m ahead is in it)",
        () => swept.q && swept.q.sweepS === 45 && inKo(swept.ko, 0, 200) && inKo(swept.ko, 0, reach - 1)
              && !inKo(swept.ko, 0, reach + 1) && inKo(swept.ko, 0, 0),
        () => swept.q ? "200 m ahead " + inKo(swept.ko, 0, 200) + ", " + (reach - 1).toFixed(0) + " m " + inKo(swept.ko, 0, reach - 1)
                        + ", " + (reach + 1).toFixed(0) + " m " + inKo(swept.ko, 0, reach + 1) + "; ring of " + swept.q.ring.length
                      : "no keep-out");
  const dflt = A.aisKeepout(v, ref, { now: NOW, polledAt: NOW });
  check("5b. ... over the GUARD'S OWN horizon by default (guard.js HORIZON_S = " + G.HORIZON_S + " s), so the two cannot disagree",
        () => dflt && dflt.sweepS === G.HORIZON_S, () => dflt && "sweepS " + dflt.sweepS);
  const still = modelOf(contact(0, 0, { heading: 0, sog: 0.2, cog: 0 }), { sweepS: 45 });
  check("5c. a stationary contact is not swept - the sweep is her motion, not a margin",
        () => still.q && still.q.sweepS === 0 && !inKo(still.ko, 0, 30) && still.q.ring.length === 4,
        () => still.q && "sweepS " + still.q.sweepS + ", 30 m ahead " + inKo(still.ko, 0, 30) + ", ring of " + still.q.ring.length);
  check("5d. the swept ring is a convex hull of the two boxes: 4 to 8 points, every corner of both boxes inside it",
        () => swept.q && swept.q.ring.length >= 4 && swept.q.ring.length <= 8
              && swept.q.hull.every(c => blocked({ e: c.e * 0.999, n: c.n }, swept.ko, 0) || blocked(c, swept.ko, 0.01)),
        () => swept.q && "ring of " + swept.q.ring.length + " from a hull of " + swept.q.hull.length);
}

// ── 6. NO PERIMETER BUFFER (Andy: "disregard the 20m perimeter buffer") ───────────────
{
  const { ko } = modelOf(contact(0, 0, { heading: 0 }));      // 20 x 8: her side is 4 m abeam
  check("6. THE HULL IS THE KEEP-OUT and has no margin of its own: 1 m off her side is clear at buffer 0 and blocked at buffer 2, as beside a pier",
        () => !inKo(ko, 5, 0, 0) && inKo(ko, 5, 0, 2) && !inKo(ko, 7, 0, 2) && inKo(ko, 7, 0, 4),
        () => "5 m abeam: buf 0 " + inKo(ko, 5, 0, 0) + ", buf 2 " + inKo(ko, 5, 0, 2)
            + "; 7 m abeam: buf 2 " + inKo(ko, 7, 0, 2) + ", buf 4 " + inKo(ko, 7, 0, 4));
  check("6b. ... and clearanceM measures to her side: 50 m abeam of a 20 x 8 m hull is 46 m clear",
        () => Math.abs(clearanceM({ e: 50, n: 0 }, ko) - 46) < 0.01,
        () => clearanceM({ e: 50, n: 0 }, ko).toFixed(2) + " m");
}

// ── 7. RANGE ───────────────────────────────────────────────────────────────────────────
{
  const own = { e: 0, n: 0 };
  const far = A.aisKeepout(contact(0, 3500, { heading: 0 }), ref, { now: NOW, polledAt: NOW, own });
  const near = A.aisKeepout(contact(0, 2500, { heading: 0 }), ref, { now: NOW, polledAt: NOW, own });
  check("7. a contact beyond AIS_KO_RANGE_M (" + A.AIS_KO_RANGE_M + " m) of the boat is not modelled; one inside it is",
        () => far === null && !!near, () => "3500 m: " + (far ? "modelled" : "skipped") + "; 2500 m: " + (near ? "modelled" : "skipped"));
  // 3200 m out, coming at us at 10 kn: her sweep ends 3200 - 231 = 2969 m out, inside the range.
  const coming = A.aisKeepout(contact(0, 3200, { heading: 180, sog: 10, cog: 180 }), ref, { now: NOW, polledAt: NOW, own, sweepS: 45 });
  check("7b. ... measured at the END of her sweep too: 3200 m out and closing at 10 kn, she is modelled",
        () => !!coming, () => coming ? "modelled" : "skipped");
}

// ── 8. THE MODEL FOR A FRAME, AND WHAT STALE MEANS ─────────────────────────────────────
{
  const vs = [contact(0, 100, { heading: 0 }), contact(0, 200, { heading: 0 })];
  const fresh = A.aisKeepouts(vs, ref, { now: NOW, polledAt: NOW - 10000, own: { e: 0, n: 0 } });
  check("8. a poll 10 s old models the contacts",
        () => fresh.polys.length === 2 && !fresh.stale && /2 AIS contacts modelled/.test(fresh.note),
        () => fresh.polys.length + " polys, stale " + fresh.stale + ": " + fresh.note);
  const stale = A.aisKeepouts(vs, ref, { now: NOW, polledAt: NOW - 50000, own: { e: 0, n: 0 } });
  check("8b. a poll older than AIS_KO_STALE_S (" + A.AIS_KO_STALE_S + " s) is NO MODEL, said as stale with the age - never a quiet sea",
        () => stale.polys.length === 0 && stale.stale === true && /50 s old/.test(stale.note),
        () => stale.polys.length + " polys, stale " + stale.stale + ": " + stale.note);
  const none = A.aisKeepouts(vs, ref, { now: NOW, polledAt: 0 });
  check("8c. no poll yet is stale too",
        () => none.polys.length === 0 && none.stale === true, () => none.note);
  const empty = A.aisKeepouts([], ref, { now: NOW, polledAt: NOW });
  check("8d. a fresh poll with no contacts is an EMPTY model, not a stale one",
        () => empty.polys.length === 0 && empty.stale === false && /0 AIS contacts/.test(empty.note), () => empty.note);
  const noFrame = A.aisKeepouts(vs, null, { now: NOW, polledAt: NOW });
  check("8e. no chart frame: nothing modelled, nothing thrown",
        () => noFrame.polys.length === 0 && /no chart frame/.test(noFrame.note), () => noFrame.note);
}

// ── 9. WHAT IS NOT A CONTACT ───────────────────────────────────────────────────────────
{
  const noPos = A.aisKeepout({ mmsi: 1, lat: null, lon: null, sog: 5, cog: 0 }, ref, { now: NOW, polledAt: NOW });
  check("9. a contact without a position is skipped, not placed at (0,0)", () => noPos === null, () => noPos ? "modelled at " + JSON.stringify(noPos.at) : "skipped");
  const noSpeed = modelOf(contact(0, 0, { heading: 45, sog: null, cog: null }));
  check("9b. a contact with no speed report is a stationary hull, still a keep-out",
        () => noSpeed.q && !noSpeed.q.moving && noSpeed.q.hdg === 45 && inKo(noSpeed.ko, 0, 0),
        () => noSpeed.q ? "moving " + noSpeed.q.moving + ", hdg " + noSpeed.q.hdg : "no keep-out");
  const named = modelOf(contact(0, 0, { name: "  EVER GIVEN ", heading: 0, sog: 8.04, cog: 0 }));
  check("9c. the name is trimmed and the speed carried: 'AIS: EVER GIVEN (20 x 8 m assumed, 8.0 kn)'",
        () => named.q && named.q.kind === "AIS: EVER GIVEN (20 x 8 m assumed, 8.0 kn)", () => named.q && named.q.kind);
}

// ── 11. THE LADDER'S REACH (Andy, 2026-09-29: "The buffer zone on approach to an AIS target appears to be 150m. confirm
//        distance and modify to 50m." - then, when the stopping margin was raised, "extend for drix if necessary") ────
{
  const own = { e: 0, n: 0 };
  const hullAt = (e) => modelOf(contact(e, 0, { heading: 90 })).q;      // 20 x 8 m assumed about her antenna, heading east
  const inside = hullAt(59.5), outside = hullAt(60.5);                    // her near end 49.5 m and 50.5 m off
  const got = A.aisInReach(own, [inside, outside]);
  const nearM = (q) => clearanceM(own, { polys: [q], lines: [], points: [] }, 100);
  check("11. aisInReach keeps a contact whose keep-out comes within AIS_LOOKAHEAD_M (50 m) of the boat and drops one beyond it - measured to her near end, not her antenna - and keeps nothing from nothing",
        () => A.AIS_LOOKAHEAD_M === 50 && got.length === 1 && got[0] === inside && A.aisInReach(own, []).length === 0
              && A.aisInReach(null, [inside]).length === 0 && A.aisInReach(own, [inside, outside], 60).length === 2,
        () => "reach " + A.AIS_LOOKAHEAD_M + ", kept " + got.length + " of 2 (near ends " + nearM(inside).toFixed(1) + " / " + nearM(outside).toFixed(1) + " m)");
  const drix = JSON.parse(require("fs").readFileSync(path.join(__dirname, "..", "vessels", "drix08.json"), "utf8"));
  const man = drix.maneuvering, coast = man.coast, low = drix.propulsion.speeds_kn.low * KN;
  // MEASURED 2026-10-03 (her logs): the guard's SLOW is flown in gear, so her `slowdown` block answers - a 3.3 s dead
  // time, then a decay toward her 3.65 kn idle-in-gear speed. 6.2 kn is what her "7 kn" setpoint really makes.
  const r62 = A.aisReachM(man, 6.2 * KN, low), r7 = A.aisReachM(man, 7 * KN, low), r14 = A.aisReachM(man, 14 * KN, low);
  const rLow = A.aisReachM(man, low, low), rSet = A.aisReachM(man, 6.2 * KN, low, 1.0);
  check("11b. EXTENDED FOR THE DRIX, BY HER MEASURED SLOW-DOWN: 50 m plus the water she needs to come down to LOW (4 kn) IN GEAR - 87.2 m at her real 6.2 kn, 92.7 m at 7 kn, 124.0 m at 14 kn, 50 m at LOW - and more in a set, which carries her the while (14.3 s of it from 6.2 kn)",
        () => Math.abs(r62 - 87.166) < 0.005 && Math.abs(r7 - 92.700) < 0.005 && Math.abs(r14 - 124.019) < 0.005 && rLow === 50
              && Math.abs(rSet - r62 - 14.284) < 0.005,
        () => "6.2 kn " + r62.toFixed(2) + ", 7 kn " + r7.toFixed(2) + ", 14 kn " + r14.toFixed(2) + ", LOW " + rLow
            + ", 6.2 kn in a 1 m/s set +" + (rSet - r62).toFixed(2));
  // CONTINUOUS AT LOW (found reviewing this change): the dead time ramps in over the first half knot above the target,
  // or a hundredth of a knot of speed noise at LOW moved the ladder's horizon by 7 m (50.0 -> 56.8 m at 4.001 kn)
  const just = A.aisReachM(man, 4.001 * KN, low), half = A.aisReachM(man, 4.5 * KN, low), halfMinus = A.aisReachM(man, 4.499 * KN, low);
  check("11b1. ... and it is CONTINUOUS at LOW: a thousandth of a knot over LOW reaches less than 0.1 m past 50 m (a full "
        + "dead time there made it 56.8 m), and the dead time is whole from half a knot over LOW on",
        () => just > 50 && just < 50.1 && Math.abs(half - halfMinus) < 0.05,
        () => "4.001 kn " + just.toFixed(3) + " m; 4.499 / 4.500 kn " + halfMinus.toFixed(3) + " / " + half.toFixed(3) + " m");
  // THE CONSOLE'S OWN COMMAND DELAY (2026-10-03, Andy: "fix the guard's model of slowing down"): the page asks the reach with
  // SPEED_CMD_LATENCY_S, and she runs on - with the set - for that long before the SLOW reaches her. Without it a contact first
  // in reach at 7 kn read 20.1 s to entry against the 20 s hold threshold. A hull with nothing to shed adds nothing.
  const LAT = require("../static/js/turns.js").SPEED_CMD_LATENCY_S;
  const d62 = A.aisReachM(man, 6.2 * KN, low, 0, undefined, LAT), d7 = A.aisReachM(man, 7 * KN, low, 0, undefined, LAT);
  const d14 = A.aisReachM(man, 14 * KN, low, 0, undefined, LAT), dSet = A.aisReachM(man, 7 * KN, low, 1.75 * KN, undefined, LAT);
  check("11b3. ... and the page asks it WITH the console's 1 s command delay - her speed and the set run on for it first: "
        + "90.36 m at 6.2 kn, 96.30 at 7, 131.22 at 14, 111.17 at 7 in a 1.75 kn set - nothing is added at LOW or with no datum, "
        + "and it stays CONTINUOUS at LOW (the delay ramps in over the half knot, as the dead time does)",
        () => LAT === 1 && Math.abs(d62 - 90.355) < 0.005 && Math.abs(d7 - 96.301) < 0.005 && Math.abs(d14 - 131.221) < 0.005
              && Math.abs(dSet - 111.172) < 0.005 && Math.abs((d7 - r7) - 7 * KN * LAT) < 1e-9
              && A.aisReachM(man, low, low, 0, undefined, LAT) === 50 && A.aisReachM(null, 7 * KN, low, 0, undefined, LAT) === 50
              // ... and CONTINUOUS at LOW with it: the delay ramps in over the half knot above LOW as the dead time does
              // (charged in full it jumped 50.0 -> 52.1 m between 4.000 and 4.001 kn - the flicker the ramp exists to stop)
              && A.aisReachM(man, 4.001 * KN, low, 0, undefined, LAT) < 50.1
              && A.aisReachM({ coast }, 4.001 * KN, low, 0, undefined, LAT) < 50.1
              && Math.abs(A.aisReachM(man, 4.5 * KN, low, 0, undefined, LAT) - A.aisReachM(man, 4.499 * KN, low, 0, undefined, LAT)) < 0.05,
        () => d62.toFixed(3) + " / " + d7.toFixed(3) + " / " + d14.toFixed(3) + " m; in the set " + dSet.toFixed(3) + " m");
  const cBare = A.aisReachM(coast, 7 * KN, low), cOnly = A.aisReachM({ coast }, 7 * KN, low);
  const badSlow = A.aisReachM({ coast, slowdown: { idle_kn: 0 } }, 7 * KN, low);
  check("11b2. ... and a hull with only a COAST datum keeps the coast law (the DriX's measured prop-out coast, 40.3 m "
        + "from 6 to 2 kn: 70.5 m at 7 kn), whether handed its maneuvering block or the bare coast block - the slow-down "
        + "law is preferred only where one is declared, and a malformed one falls back to the coast",
        () => Math.abs(cBare - 70.53) < 0.05 && Math.abs(cOnly - cBare) < 1e-9 && Math.abs(badSlow - cBare) < 1e-9 && r7 > cBare + 20,
        () => "bare coast " + cBare.toFixed(2) + ", {coast} " + cOnly.toFixed(2) + ", malformed slowdown " + badSlow.toFixed(2)
            + ", with slowdown " + r7.toFixed(2));
  check("11c. ... and a hull with no datum (every vessel file but the DriX's), a malformed one, or no LOW to come down to, is seen from 50 m at any speed",
        () => A.aisReachM(null, 14 * KN, low) === 50 && A.aisReachM(undefined, 7 * KN, low) === 50 && A.aisReachM({}, 7 * KN, low) === 50
              && A.aisReachM({ from_kn: 2, to_kn: 7, distance_m: 44 }, 7 * KN, low) === 50 && A.aisReachM(coast, 7 * KN, 0) === 50
              && A.aisReachM(man, 7 * KN, 0) === 50,
        () => "no datum " + A.aisReachM(null, 14 * KN, low) + ", reversed " + A.aisReachM({ from_kn: 2, to_kn: 7, distance_m: 44 }, 7 * KN, low)
            + ", no LOW " + A.aisReachM(coast, 7 * KN, 0));
}

// ── 12. ONE RULE FOR WHICH WAY SHE POINTS - the keep-out's, and now the AIS layer's (Andy, 2026-09-30, at the Port of
//        Los Angeles: "The red outlines are perfectly alongside their respective pier as expected, while the green
//        targets are rotated.") The fixtures are his feed round Pier 300, as broadcast. ─────────────────────────────
{
  const at = { lat: 33.737, lon: -118.2669 };
  const AMAZON = { ...at, mmsi: 1, name: "CMA CGM AMAZON", sog: 0.0, cog: 327.5, heading: 251, nav: 5, length: 366, beam: 48 };
  const CABRILLO = { ...at, mmsi: 2, name: "CABRILLO", sog: 0.0, cog: 223.0, heading: null, nav: 0, length: 30, beam: 10 };
  const m1 = A.aisMotion(AMAZON), m2 = A.aisMotion(CABRILLO);
  check("12. MOORED WITH A HEADING (CMA CGM AMAZON: 0.0 kn, heading 251 - her berth - course 327.5, noise): she points along her HEADING, not her course, and she is not under way",
        () => m1.moving === false && m1.hdg === 251 && m1.from === "heading",
        () => JSON.stringify({ moving: m1.moving, hdg: m1.hdg, from: m1.from }));
  check("12b. ... STOPPED WITH NO HEADING (CABRILLO: 0.0 kn, course 223 noise, no heading): NO direction - she can lie any way round - never her course",
        () => m2.moving === false && m2.hdg === null && m2.from === null,
        () => JSON.stringify({ moving: m2.moving, hdg: m2.hdg, from: m2.from }));
  const under = A.aisMotion({ ...at, sog: 8, cog: 90, heading: null, nav: 0 });
  const headed = A.aisMotion({ ...at, sog: 12, cog: 95, heading: 88, nav: 0 });
  check("12c. ... UNDER WAY: with no heading reported she points along her course (and says so); with one, along her heading - the course is then only where she is GOING",
        () => under.moving && under.hdg === 90 && under.from === "course" && headed.moving && headed.hdg === 88 && headed.from === "heading"
              && Math.abs(Math.atan2(headed.vel.e, headed.vel.n) * 180 / Math.PI - 95) < 1e-6,
        () => JSON.stringify({ under: [under.moving, under.hdg, under.from], headed: [headed.moving, headed.hdg, headed.from] }));
  const na = A.aisMotion({ ...at, sog: 0.0, cog: 100, heading: 511, nav: 5 });           // 511: AIS for "not available"
  const mooredDrift = A.aisMotion({ ...at, sog: 0.6, cog: 40, heading: null, nav: 5 });  // a moored ship's fix wandering
  const slowOld = A.aisMotion({ ...at, sog: 1.0, cog: 40, heading: null, nav: 0, age: 600 });
  check("12d. ... and the keep-out's own tests of 'under way' decide it: heading 511 (not available) is no heading; a MOORED ship's 0.6 kn of fix noise is not way; a 1 kn report 10 minutes old is a ship at anchor - none of them points along her course",
        () => na.hdg === null && !mooredDrift.moving && mooredDrift.hdg === null && !slowOld.moving && slowOld.hdg === null,
        () => JSON.stringify({ n511: na.hdg, mooredDrift: [mooredDrift.moving, mooredDrift.hdg], slowOld: [slowOld.moving, slowOld.hdg] }));
  // THE KEEP-OUT IS DRAWN BY THE SAME ANSWER: the red outline is the hull at that heading, or the disc
  const fr = planeFrame(at);
  const q1 = A.aisKeepout(AMAZON, fr, { now: 0, polledAt: 0 }), q2 = A.aisKeepout(CABRILLO, fr, { now: 0, polledAt: 0 });
  const r2 = q2 && q2.ring.length ? Math.hypot(q2.ring[0].e - q2.at.e, q2.ring[0].n - q2.at.n) : null;
  check("12e. ... and the keep-out asks the SAME function: AMAZON's outline is her hull at 251, CABRILLO's the disc of aisDiscM - so the ship the layer draws inside the red outline points the way the outline does",
        () => !!q1 && q1.hdg === 251 && q1.ring.length === 4 && !!q2 && q2.hdg === null && q2.ring.length === 12
              && Math.abs(r2 - A.aisDiscM(q2.box)) < 1e-6 && Math.abs(A.aisDiscM(q2.box) - Math.hypot(30, 10) / 2) < 1e-6,
        () => "AMAZON hdg " + (q1 && q1.hdg) + " (" + (q1 && q1.ring.length) + " corners); CABRILLO hdg " + (q2 && q2.hdg)
            + ", " + (q2 && q2.ring.length) + "-point disc of " + (r2 == null ? "—" : r2.toFixed(2)) + " m");
}

// ── M1-M8. THE VESSELS NOT UNDER WAY, FOR A PASSAGE (Andy, 2026-10-07: "build ... Solution 2") ──────────────────
// His RTH outbound passed NORD LOGOS, 132 m and stopped at the Newington pier, 79 m off her AIS fix at 10 kn, and the
// route had not known she was there. A vessel NOT under way (aisMotion) is now laid round by a passage as a pier is -
// her hull as the guard models it, wherever she is in the chart box - in a COPY of the chart's model (passage.js
// passageKo), never in nogo.ko, never for a vessel under way, and never for a survey pattern's own lines.
{
  const P = require("../static/js/passage.js");
  const K = require("../static/js/keepouts.js");
  const { nogo } = require("../static/js/state.js");
  const box = { W: ll(-4000, -4000).lon, S: ll(-4000, -4000).lat, E: ll(4000, 4000).lon, N: ll(4000, 4000).lat };
  const T0 = Date.now();
  const ship = (o = {}) => contact(0, 0, { mmsi: 374033000, name: "TESTSHIP", heading: 90, length: 132, ...o });   // 132 x 22 m, e -66..66, n -11..11
  // M1-M2: the model itself
  const got = A.aisMooredKeepouts([ship(), ship({ mmsi: 1, name: "UNDERWAY", sog: 6, cog: 90 }),
                                   ship({ mmsi: 2, name: "MOORED", nav: 5, sog: 0.3, lat: ll(0, 900).lat }),
                                   ship({ mmsi: 3, name: "SLOWOLD", sog: 1.0, age: 500, lat: ll(0, 1800).lat }),
                                   ship({ mmsi: 4, name: "FAR", lat: ll(0, 3500).lat }),
                                   ship({ mmsi: 5, name: "OUTSIDE", lat: ll(0, 6000).lat })],
                                  ref, { now: T0, polledAt: T0, bbox: box });
  const names = got.polys.map((q) => q.name).join(",");
  const one = got.polys.find((q) => q.name === "TESTSHIP"), ref1 = A.aisKeepout(ship(), ref, { now: T0, polledAt: T0, sweepS: 0 });
  check("M1. the vessels NOT under way in the chart box are the model: stopped, moored, and reporting like one at anchor; "
        + "3.5 km off as well (no AIS_KO_RANGE_M here: a passage reaches the whole chart); not one under way, not one outside the box",
        names === "TESTSHIP,MOORED,SLOWOLD,FAR" && one && JSON.stringify(one.ring) === JSON.stringify(ref1.ring)
          && /132 x 22 m, stopped\)$/.test(one.kind) && /moored\)$/.test(got.polys[1].kind) && got.polys.every((q) => q.moored),
        names + " | " + (one && one.kind) + " | " + (got.polys[1] && got.polys[1].kind));
  const stale = A.aisMooredKeepouts([ship()], ref, { now: T0, polledAt: T0 - 60000, bbox: box });
  const none = A.aisMooredKeepouts([ship()], ref, { now: T0, polledAt: 0, bbox: box });
  check("M2. a read older than AIS_KO_STALE_S, or none at all, is no model - with its reason, never a quiet sea",
        stale.polys.length === 0 && stale.stale && /60 s old/.test(stale.note) && none.polys.length === 0 && none.stale,
        stale.note + " / " + none.note);
  // M3-M6: planNogoRoute past her, in open water
  const open = { polys: [], lines: [], points: [], marks: [], sys: K.markSystems([]), chans: [], restricted: [] };
  const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer, bbox: nogo.bbox, ais: nogo.ais };
  Object.assign(nogo, { ready: true, frame: ref, ko: open, buffer: 3, bbox: box, ais: null });
  const A0 = ll(-700, 20), B0 = ll(700, 20);                       // 9 m off her side, straight
  const hull = one;
  const passM = (route, from) => {
    const pts = [from, ...route].map((p) => ref.toEN(p));
    let m = 1e9;
    for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 50; k++) {
      const p = { e: pts[i - 1].e + (pts[i].e - pts[i - 1].e) * k / 50, n: pts[i - 1].n + (pts[i].n - pts[i - 1].n) * k / 50 };
      m = Math.min(m, clearanceM(p, { polys: [hull], lines: [], points: [] }, 500));
    }
    return m;
  };
  const plain = P.planNogoRoute(A0, B0, { standoffM: 20 });
  nogo.ais = { vessels: [ship()], polledAt: Date.now() };
  const laid = P.planNogoRoute(A0, B0, { standoffM: 20 });
  const koAfter = nogo.ko;
  check("M3. A GO-TO / RTH PAST A STOPPED SHIP IS LAID ROUND HER: no read, the straight route 9 m off her side (as before); "
        + "read, routed at the standoff (20 m) or more, and she is named on the plan",
        plain.direct && passM(plain.route, A0) < 10 && laid.routed && passM(laid.route, A0) >= 19.5
          && laid.moored.length === 1 && /TESTSHIP \(132 x 22 m, stopped\)/.test(laid.moored[0]),
        "no read: " + passM(plain.route, A0).toFixed(1) + " m; read: " + passM(laid.route, A0).toFixed(1) + " m via "
          + laid.route.length + " waypoints, named " + JSON.stringify(laid.moored));
  check("M4. ... in a COPY: nogo.ko is the chart's model still (the guard models every contact itself and would hold her twice)",
        koAfter === open && open.polys.length === 0 && !("moored" in open), "nogo.ko polys " + open.polys.length);
  nogo.ais = { vessels: [ship({ sog: 6, cog: 90 })], polledAt: Date.now() };
  const moving = P.planNogoRoute(A0, B0, { standoffM: 20 });
  check("M5. THE SAME SHIP UNDER WAY IS NOT LAID ROUND: she will not be where the plan saw her - the guard answers her",
        moving.direct && moving.moored.length === 0, "direct " + moving.direct + ", named " + JSON.stringify(moving.moored));
  nogo.ais = { vessels: [ship()], polledAt: Date.now() - 60000 };
  const old = P.planNogoRoute(A0, B0, { standoffM: 20 });
  check("M6. a stale read lays nothing: the chart's model alone, as before", old.direct && old.moored.length === 0,
        "direct " + old.direct);
  // M7-M8: routePlan - the transit legs are laid round her, a pattern's own lines are not
  nogo.ais = { vessels: [ship()], polledAt: Date.now() };
  const tr = P.routePlan(A0, [B0], true, 20);
  const pat = P.routePlan(ll(-700, 400), [ll(-700, 13), ll(700, 13)], false, 20);   // the approach, then a LINE 2 m off her side
  const line = pat.route.slice(-2).map((p) => ref.toEN(p));
  nogo.ais = null;
  const patPlain = P.routePlan(ll(-700, 400), [ll(-700, 13), ll(700, 13)], false, 20);
  check("M7. A DRAWN TRANSIT IS LAID ROUND HER as a Go-To is", passM(tr.route, A0) >= 19.5 && tr.moored.length === 1,
        passM(tr.route, A0).toFixed(1) + " m, named " + JSON.stringify(tr.moored));
  check("M8. A SURVEY PATTERN'S OWN LINE IS NOT: a coverage line 2 m off her side is flown as drawn (a moored ship "
        + "reconfigures no survey, Andy 2026-09-25); the guard answers her on the water",
        JSON.stringify(pat.route) === JSON.stringify(patPlain.route) && Math.abs(line[0].n - 13) < 0.5
          && Math.abs(line[0].e + 700) < 0.5 && Math.abs(line[1].n - 13) < 0.5 && Math.abs(line[1].e - 700) < 0.5
          && pat.unroutable.length === 0,
        "the plan with the read is the plan without it (" + pat.route.length + " points); the line "
          + line.map((p) => p.e.toFixed(0) + "," + p.n.toFixed(0)).join(" -> "));
  Object.assign(nogo, saved);
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
