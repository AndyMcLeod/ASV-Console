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
//   * HER HULL GROWN BY HALF HER LENGTH (2026-10-17, Andy, of a survey 29-30 m off VICTORIA T, a 200 m ship at anchor:
//     "the ASV should not come so close to the vessel. Perhaps scale closure range to vessel size?" - asked, "Half her
//     length"; until then his 09-25 rule, the hull alone): 10 m round a 20 m boat, 100 m round a 200 m ship, round her
//     swept hull while she is under way; the boat's buffer outside that as beside a pier; NOT round a boat already
//     inside it (her bare hull then, as before); the escape still a ship-length from her hull (6-6g). The geometry
//     checks below read her BARE hull (`bare`), which is what they are about;
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
// `ko` is her BARE (swept) hull - the geometry checks are about the hull; `full` is the keep-out as built, her clear
// water round it (2026-10-17).
function modelOf(v, o = {}) {
  const q = A.aisKeepout(v, ref, { now: NOW, polledAt: NOW, sweepS: 0, ...o });
  return { q, ko: { polys: q ? [{ ...q, ring: q.bare }] : [], lines: [], points: [] },
           full: { polys: q ? [q] : [], lines: [], points: [] } };
}
const inKo = (ko, e, n, buf = 0) => blocked({ e, n }, ko, buf);
const KN = 0.514444;
const distTo = (a, b) => { const p = ref.toEN(a), q = ref.toEN(b); return Math.hypot(p.e - q.e, p.n - q.n); };

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
  // (2026-10-17: her keep-out carries her clear water, 15 m round a 30 m hull - the ring takes it with the buffer)
  check("10f. calm (standoff = the 3 m buffer): ABEAM the disc of her length less the standoff (27 m) about her CENTER still "
        + "rules - a route kept the standoff off it passes one ship-length (30 m) from her center; AHEAD her clear water plus "
        + "the buffer (15 + 15 + 3 = 33 m from her center) is wider and rules; named, and her hull inside it",
        () => calm.roundM === 30 && calm.stdM === 3 && /, 30 m round her$/.test(calm.kind)
              && Math.abs(clr(0, 30) - 3) < 0.2 && clr(0, 26.5) === 0 && clr(32.5, 0) === 0 && Math.abs(clr(36, 0) - 3) < 0.3 && clr(15, 4) === 0,
        () => "kind " + calm.kind + "; clearance 30 m abeam " + clr(0, 30).toFixed(2) + ", 26.5 m abeam " + clr(0, 26.5).toFixed(2)
            + ", 32.5 m ahead " + clr(32.5, 0).toFixed(2) + ", 36 m ahead " + clr(36, 0).toFixed(2));
  const set = A.aisRoundKeepout(hull30, 19.5, 3), MS = { polys: [set], lines: [], points: [] };
  const clrS = (e, n) => clearanceM({ e, n }, MS, 200);
  check("10g. in a set (standoff 19.5 m) her length less the standoff is 10.5 m, and her CLEAR WATER grown by the buffer "
        + "rules all round: ahead 15 + 15 + 3 = 33 m from her center (32.5 inside, 33.5 out), abeam 4 + 15 + 3 = 22 m (21.5 "
        + "inside, 22.5 out)",
        () => set.stdM === 19.5 && clrS(32.5, 0) === 0 && clrS(33.5, 0) > 0 && clrS(0, 21.5) === 0 && clrS(0, 22.5) > 0,
        () => "32.5 m ahead " + clrS(32.5, 0).toFixed(2) + ", 33.5 m ahead " + clrS(33.5, 0).toFixed(2) + ", 21.5 m abeam " + clrS(0, 21.5).toFixed(2) + ", 22.5 m abeam " + clrS(0, 22.5).toFixed(2));
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
                        + ", " + (reach + 1).toFixed(0) + " m " + inKo(swept.ko, 0, reach + 1) + "; ring of " + swept.q.bare.length
                      : "no keep-out");
  const dflt = A.aisKeepout(v, ref, { now: NOW, polledAt: NOW });
  check("5b. ... over the GUARD'S OWN horizon by default (guard.js HORIZON_S = " + G.HORIZON_S + " s), so the two cannot disagree",
        () => dflt && dflt.sweepS === G.HORIZON_S, () => dflt && "sweepS " + dflt.sweepS);
  const still = modelOf(contact(0, 0, { heading: 0, sog: 0.2, cog: 0 }), { sweepS: 45 });
  check("5c. a stationary contact is not swept - the sweep is her motion, not a margin",
        () => still.q && still.q.sweepS === 0 && !inKo(still.ko, 0, 30) && still.q.bare.length === 4,
        () => still.q && "sweepS " + still.q.sweepS + ", 30 m ahead " + inKo(still.ko, 0, 30) + ", ring of " + still.q.bare.length);
  check("5d. the swept ring is a convex hull of the two boxes: 4 to 8 points, every corner of both boxes inside it",
        () => swept.q && swept.q.bare.length >= 4 && swept.q.bare.length <= 8
              && swept.q.hull.every(c => blocked({ e: c.e * 0.999, n: c.n }, swept.ko, 0) || blocked(c, swept.ko, 0.01)),
        () => swept.q && "ring of " + swept.q.bare.length + " from a hull of " + swept.q.hull.length);
}

// ── 6. HER CLEAR WATER: HALF HER LENGTH ROUND HER HULL (Andy, 2026-10-17: "Half her length") ─────────────────────
// Until 2026-10-17 the hull alone ("disregard the 20m perimeter buffer", 09-25), and the boat surveyed 28.8 m off the
// side of a 200 m ship at anchor with the guard content. Now her hull - swept, under way - grown by AIS_MARGIN_FRAC of her
// length; the boat's own buffer outside THAT, as beside a pier.
{
  const { q, full } = modelOf(contact(0, 0, { heading: 0 }));       // 20 x 8 assumed: her side 4 m abeam, 10 m clear
  check("6. her keep-out is her hull grown by HALF HER LENGTH: a 20 x 8 m boat keeps 10 m - 13.5 m off her center abeam is "
        + "inside at buffer 0, 14.5 m clear; the boat's buffer is outside it (15.5 m inside at buffer 2, 16.5 m clear)",
        () => A.AIS_MARGIN_FRAC === 0.5 && q && q.marginM === 10 && !q.marginWaived
              && inKo(full, 13.5, 0, 0) && !inKo(full, 14.5, 0, 0) && inKo(full, 15.5, 0, 2) && !inKo(full, 16.5, 0, 2),
        () => q && "margin " + q.marginM + " m; 13.5 " + inKo(full, 13.5, 0, 0) + ", 14.5 " + inKo(full, 14.5, 0, 0)
            + "; buf 2: 15.5 " + inKo(full, 15.5, 0, 2) + ", 16.5 " + inKo(full, 16.5, 0, 2));
  check("6b. ... and clearanceM measures to her clear water: 50 m abeam of a 20 x 8 m boat is 36 m clear (her side 4, her 10)",
        () => Math.abs(clearanceM({ e: 50, n: 0 }, full) - 36) < 0.05,
        () => clearanceM({ e: 50, n: 0 }, full).toFixed(2) + " m");
  // VICTORIA T as she broadcast it on 2026-10-17: 200 x 32 m, A 173 / B 27 / C 10 / D 22, heading 323 - here heading 0, and
  // here with NO navigational status: at anchor (status 1) she has her watch circle since 2026-11-01 (N2), and these
  // checks are the half-length rule's, which still holds every vessel not under way that has no status rule
  const vic = modelOf(contact(0, 0, { name: "VICTORIA T", heading: 0, nav: null, length: 200, beam: 32, dim: { a: 173, b: 27, c: 10, d: 22 } }));
  const vq = vic.q, vf = vic.full;
  check("6c. ... scaled to her size: VICTORIA T (200 x 32 m, stopped, no status) keeps 100 m - 99 m off her starboard side is "
        + "inside, 101 m clear; 99 m beyond her bow inside, 101 m clear; the survey line 28.8 m off her side is inside",
        () => vq && vq.marginM === 100 && inKo(vf, 22 + 99, 0) && !inKo(vf, 22 + 101, 0) && inKo(vf, 0, 173 + 99) && !inKo(vf, 0, 173 + 101)
              && inKo(vf, 22 + 28.8, 50) && !inKo(vic.ko, 22 + 28.8, 50),
        () => vq && "margin " + vq.marginM + "; 99 off her side " + inKo(vf, 121, 0) + ", 101 " + inKo(vf, 123, 0)
            + "; 99 past her bow " + inKo(vf, 0, 272) + ", 101 " + inKo(vf, 0, 274));
  const sw = modelOf(contact(0, 0, { heading: 0, sog: 10, cog: 0, age: 0 }), { sweepS: 45 });
  const reach = 45 * 10 * KN + 10;
  check("6d. ... round her SWEPT hull while she is under way: 10 m beyond where her bow will be in 45 s is inside, 11 m clear",
        () => sw.q && sw.q.marginM === 10 && inKo(sw.full, 0, reach + 9.5) && !inKo(sw.full, 0, reach + 10.5),
        () => sw.q && (reach + 9.5).toFixed(0) + " m " + inKo(sw.full, 0, reach + 9.5) + ", " + (reach + 10.5).toFixed(0) + " m " + inKo(sw.full, 0, reach + 10.5));
  // the boat already in her clear water: her bare hull, said
  const inside = A.aisKeepout(contact(0, 0, { name: "VICTORIA T", heading: 0, nav: null, length: 200, beam: 32, dim: { a: 173, b: 27, c: 10, d: 22 } }),
                              ref, { now: NOW, polledAt: NOW, sweepS: 0, own: { e: 22 + 60, n: 0 } });
  const outside = A.aisKeepout(contact(0, 0, { name: "VICTORIA T", heading: 0, nav: null, length: 200, beam: 32, dim: { a: 173, b: 27, c: 10, d: 22 } }),
                               ref, { now: NOW, polledAt: NOW, sweepS: 0, own: { e: 22 + 140, n: 0 } });
  const insideKo = { polys: inside ? [inside] : [], lines: [], points: [] };
  check("6e. NOT ROUND A BOAT ALREADY IN IT: the boat 60 m off her side (inside her 100 m) gets her BARE hull - 1 m off her "
        + "side clear at buffer 0 - and it says so (marginWaived); 140 m off, outside it, gets her clear water",
        () => inside && inside.marginWaived && inside.marginM === 0 && !inKo(insideKo, 23, 0, 0) && inKo(insideKo, 21, 0, 0)
              && outside && !outside.marginWaived && outside.marginM === 100,
        () => "inside: waived " + (inside && inside.marginWaived) + ", margin " + (inside && inside.marginM)
            + "; outside: waived " + (outside && outside.marginWaived) + ", margin " + (outside && outside.marginM));
  // ... the guard's model, and a passage's start
  // (no status: moored and still, they would keep 20 m since 2026-11-01 - N1)
  const both = [contact(0, 0, { name: "NEAR", heading: 0, sog: 0, nav: null, length: 100, beam: 20, dim: { a: 50, b: 50, c: 10, d: 10 } }),
                contact(400, 0, { name: "FAR", heading: 0, sog: 0, nav: null, length: 100, beam: 20, dim: { a: 50, b: 50, c: 10, d: 10 } })];
  const g = A.aisKeepouts(both, ref, { now: NOW, polledAt: NOW, own: { e: 40, n: 0 }, sweepS: 0 });
  const m0 = A.aisMooredKeepouts(both, ref, { now: NOW, polledAt: NOW });
  const by = (r, nm) => r.polys.find((p) => p.name === nm) || {};
  check("6f. ... the guard's model (the boat where it is) waives it for the vessel whose clear water she is in and keeps it "
        + "for the others; a PASSAGE keeps every one (M9b: it lays her out of it the short way)",
        () => by(g, "NEAR").marginWaived && by(g, "FAR").marginM === 50 && by(m0, "NEAR").marginM === 50 && by(m0, "FAR").marginM === 50,
        () => JSON.stringify({ guard: [by(g, "NEAR").marginM, by(g, "FAR").marginM], passage: [by(m0, "NEAR").marginM, by(m0, "FAR").marginM] }));
  const esc = A.aisAvoidKeepout(q), escKo = { polys: [esc], lines: [], points: [] };
  check("6g. THE ESCAPE is still a ship-length from her HULL (his 09-27 rule), not from her clear water: a 20 x 8 m boat's "
        + "ring reaches 24 m abeam of her center (4 + 20), not 34",
        () => esc.avoidM === 20 && inKo(escKo, 23.5, 0) && !inKo(escKo, 24.5, 0),
        () => "23.5 " + inKo(escKo, 23.5, 0) + ", 24.5 " + inKo(escKo, 24.5, 0));
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
  // her near end 59.5 and 60.5 m off, her clear water (10 m) 49.5 and 50.5 m off - the keep-out the ladder reaches for
  const inside = hullAt(69.5), outside = hullAt(70.5);
  const got = A.aisInReach(own, [inside, outside]);
  const nearM = (q) => clearanceM(own, { polys: [q], lines: [], points: [] }, 100);
  check("11. aisInReach keeps a contact whose keep-out comes within AIS_LOOKAHEAD_M (50 m) of the boat and drops one beyond it - measured to the edge of her clear water off her near end, not her antenna - and keeps nothing from nothing",
        () => A.AIS_LOOKAHEAD_M === 50 && got.length === 1 && got[0] === inside && A.aisInReach(own, []).length === 0
              && A.aisInReach(null, [inside]).length === 0 && A.aisInReach(own, [inside, outside], 60).length === 2
              && Math.abs(nearM(inside) - 49.5) < 0.6 && Math.abs(nearM(outside) - 50.5) < 0.6,
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
  const r2 = q2 && q2.bare.length ? Math.hypot(q2.bare[0].e - q2.at.e, q2.bare[0].n - q2.at.n) : null;
  check("12e. ... and the keep-out asks the SAME function: AMAZON's outline is her hull at 251, CABRILLO's the disc of aisDiscM - so the ship the layer draws inside the red outline points the way the outline does",
        () => !!q1 && q1.hdg === 251 && q1.bare.length === 4 && !!q2 && q2.hdg === null && q2.bare.length === 12
              && Math.abs(r2 - A.aisDiscM(q2.box)) < 1e-6 && Math.abs(A.aisDiscM(q2.box) - Math.hypot(30, 10) / 2) < 1e-6,
        () => "AMAZON hdg " + (q1 && q1.hdg) + " (" + (q1 && q1.bare.length) + " corners); CABRILLO hdg " + (q2 && q2.hdg)
            + ", " + (q2 && q2.bare.length) + "-point disc of " + (r2 == null ? "—" : r2.toFixed(2)) + " m");
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
  // M1b. A SHIP JUST OUTSIDE THE BOX REACHES INTO IT (the 2026-10-18 review): a 200 m ship at anchor with her antenna 40 m past the
  //      box's north edge, bow south - her hull 60 m into the box, her clear water 160 m - is in the model; one 2 km past it is not;
  //      one beside the box, bow along the edge, whose keep-out never enters it, is not
  const edge = A.aisMooredKeepouts([ship({ mmsi: 11, name: "BOWIN", heading: 180, length: 200, lat: ll(0, 4040).lat }),
                                    ship({ mmsi: 12, name: "FAROUT", heading: 180, length: 200, lat: ll(0, 6000).lat }),
                                    ship({ mmsi: 13, name: "ALONG", heading: 90, length: 200, lat: ll(0, 4400).lat })],
                                   ref, { now: T0, polledAt: T0, bbox: box });
  const bowIn = edge.polys.find((q) => q.name === "BOWIN");
  const reach = bowIn ? Math.min(...bowIn.ring.map((p) => p.n)) : null;         // how far south her keep-out reaches (the edge is n = 4000)
  check("M1b. a ship anchored just OUTSIDE the chart box, bow in, is in the planner's model - her keep-out reaches well inside it; "
        + "one 2 km out, and one beside the edge whose keep-out never enters, are not",
        edge.polys.map((q) => q.name).join() === "BOWIN" && reach != null && reach < 4000 - 100,
        edge.polys.map((q) => q.name).join() + "; BOWIN reaches to n = " + (reach == null ? "-" : reach.toFixed(0)) + " (edge 4000)");
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
  // `hull` is the moored polygon as the passage gets it - her CLEAR WATER since 2026-10-17 (66 m round her) - so M3 and
  // M7 measure the standoff off that, and the straight route reads 0 (inside it); M9 measures to her bare hull
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
  // M9-M9b (2026-10-17): her CLEAR WATER (half her length, 66 m round a 132 m ship) is kept by a passage too - even by one
  // that starts inside it, which the router lays out of it the short way (waived, it ran along her side at 36-40 m)
  nogo.ais = { vessels: [ship()], polledAt: Date.now() };
  const far = P.planNogoRoute(A0, B0, { standoffM: 20 });
  const IN = ll(-30, 51);                                        // 40 m north of her side (n = 11): inside her 66 m
  const fromIn = P.planNogoRoute(IN, B0, { standoffM: 20 });
  const endOk = (r) => r && Array.isArray(r.route) && r.route.length && distTo(r.route[r.route.length - 1], B0) < 1;
  // measured to her BARE hull (passM measures to `one`, the moored polygon - her clear water since 2026-10-17)
  const bareOf = { ...one, ring: one.bare };
  const passBare = (route, from) => {
    const pts = [from, ...route].map((p) => ref.toEN(p));
    let m = 1e9;
    for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 50; k++) {
      const p = { e: pts[i - 1].e + (pts[i].e - pts[i - 1].e) * k / 50, n: pts[i - 1].n + (pts[i].n - pts[i - 1].n) * k / 50 };
      m = Math.min(m, clearanceM(p, { polys: [bareOf], lines: [], points: [] }, 500));
    }
    return m;
  };
  check("M9. a passage keeps her clear water: from 700 m off, the Go-To passes her hull no nearer than her 66 m plus the "
        + "standoff (20 m)",
        one.marginM === 66 && endOk(far) && passBare(far.route, A0) >= 66 + 19.5,
        passBare(far.route, A0).toFixed(1) + " m off her hull");
  // how far off her hull the route is, 100 m of track out from the start
  const offAt = (route, from, atM) => { const pts = [from, ...route].map((p) => ref.toEN(p)); let s0 = 0;
    for (let i = 1; i < pts.length; i++) { const L = Math.hypot(pts[i].e - pts[i - 1].e, pts[i].n - pts[i - 1].n);
      if (s0 + L >= atM) { const t = (atM - s0) / L, p = { e: pts[i - 1].e + (pts[i].e - pts[i - 1].e) * t, n: pts[i - 1].n + (pts[i].n - pts[i - 1].n) * t };
        return clearanceM(p, { polys: [bareOf], lines: [], points: [] }, 500); } s0 += L; }
    return null; };
  const out100 = endOk(fromIn) ? offAt(fromIn.route, IN, 100) : null;
  check("M9b. ... and one that STARTS inside it (40 m off her side) is planned OUT of it the short way: never nearer her "
        + "hull than it started, and 100 m of track on, outside her clear water (66 m)",
        !fromIn.error && endOk(fromIn) && passBare(fromIn.route, IN) >= 40 - 0.5 && out100 != null && out100 >= 66,
        (fromIn.error ? "ERROR " + fromIn.error + "; " : "") + (endOk(fromIn) ? "nearest " + passBare(fromIn.route, IN).toFixed(1)
          + " m off her hull, " + (out100 == null ? "-" : out100.toFixed(1)) + " m off it 100 m on" : "no route to the target"));
  nogo.ais = null;
  Object.assign(nogo, saved);
}

// ── N. HER NAVIGATIONAL STATUS SETS HER CLEAR WATER (Andy, 2026-11-01) ────────────────────────────────────────────────
// "When a vessel is moored or anchored and it is broadcasting AIS it may have Code 1 (anchored) or Code 5 (moored) in the
// message. If so, utilize this to override avoidance distances as follows: Moored and unmoving in a harbor or alongside a
// pier change avoidance distance to 20m, Anchored we must assume a watch circle driven by tide and/or current and/or wind.
// Calculate watch circle and add another 10m to the radius for safety."
{
  // alongside: her hull 2 m off a charted berth (berth_m, which the page writes from the chart - N9 measures it)
  const MOOR = (o = {}) => contact(0, 0, { name: "MOORED", heading: 0, sog: 0.2, nav: 5, length: 100, beam: 20,
                                           dim: { a: 50, b: 50, c: 10, d: 10 }, berth_m: 2, ...o });
  const m = modelOf(MOOR());
  check("N1. MOORED ALONGSIDE AND STILL (status 5, 0.2 kn, 2 m off a charted berth): her hull grown by 20 m, not half her length (50) - 19.5 m off her starboard "
        + "side inside, 20.5 m clear; 19.5 m past her bow inside, 20.5 m clear; her name unchanged",
        () => A.AIS_MOORED_CLEAR_M === 20 && m.q && m.q.rule === "moored" && m.q.marginM === 20
              && inKo(m.full, 10 + 19.5, 0) && !inKo(m.full, 10 + 20.5, 0) && inKo(m.full, 0, 50 + 19.5) && !inKo(m.full, 0, 50 + 20.5)
              && /^AIS: MOORED \(100 x 20 m, moored\)$/.test(m.q.kind),
        () => m.q && "rule " + m.q.rule + ", margin " + m.q.marginM + ", kind " + m.q.kind);
  const fast = modelOf(MOOR({ sog: 0.6 })), noSog = modelOf(MOOR({ sog: null }));
  check("N1b. ... \"unmoving\" is a reported speed under 0.5 kn: moored at 0.6 kn, or moored with no speed reported, is not proof "
        + "she is still, and the half-length rule (50 m) stands",
        () => fast.q && fast.q.rule === null && fast.q.marginM === 50 && noSog.q && noSog.q.rule === null && noSog.q.marginM === 50
              && A.AIS_MOORED_STILL_KN === 0.5,
        () => "0.6 kn: " + (fast.q && fast.q.rule) + " " + (fast.q && fast.q.marginM) + "; no sog: " + (noSog.q && noSog.q.rule) + " " + (noSog.q && noSog.q.marginM));
  const small = modelOf(contact(0, 0, { heading: 0, sog: 0, nav: 5, berth_m: 0 }));
  check("N1c. ... and a small boat moored alongside keeps 20 m too, where half her length was 10: a 20 x 8 m (assumed) boat's side "
        + "is 4 m off her center, 23.5 m inside, 24.5 m clear",
        () => small.q && small.q.rule === "moored" && small.q.marginM === 20 && inKo(small.full, 23.5, 0) && !inKo(small.full, 24.5, 0),
        () => small.q && "margin " + small.q.marginM);

  // VICTORIA T at anchor, 200 x 32 m, A 173 / B 27 / C 10 / D 22, heading 0, in a charted 12 m
  const VIC = (o = {}) => contact(0, 0, { name: "VICTORIA T", heading: 0, nav: 1, length: 200, beam: 32,
                                          dim: { a: 173, b: 27, c: 10, d: 22 }, chart_depth_m: 12, ...o });
  const v = modelOf(VIC()), w = v.q && v.q.watch;
  const near = (a, b, tol = 0.05) => Math.abs(a - b) < tol;
  check("N2. AT ANCHOR: her WATCH CIRCLE plus 10 m - cable 3 x 12 + 90 = 126 m; the circle round her anchor hypot(126 + 200, "
        + "32 / 2) = 326.4 m; her anchor 126 m ahead of her bow on its centerline (6 m to starboard of her antenna), at "
        + "(6, 299); the circle kept out centered 126 cos 20 = 118.4 m ahead of her bow and 326.4 + 126 sin 20 + 10 = 379.5 m",
        () => v.q && v.q.rule === "anchored" && w && w.rodeM === 126 && w.depthM === 12 && w.depthFrom === "chart"
              && near(w.watchM, Math.hypot(326, 16)) && near(w.anchor.e, 6) && near(w.anchor.n, 299)
              && near(w.center.e, 6) && near(w.center.n, 173 + 126 * Math.cos(20 * Math.PI / 180))
              && near(w.koM, Math.hypot(326, 16) + 126 * Math.sin(20 * Math.PI / 180) + 10) && v.q.marginM === 0
              && /^AIS: VICTORIA T \(200 x 32 m, at anchor\)$/.test(v.q.kind),
        () => w && JSON.stringify({ rode: w.rodeM, watch: +w.watchM.toFixed(2), anchor: [w.anchor.e, w.anchor.n],
                                   center: [+w.center.e.toFixed(2), +w.center.n.toFixed(2)], ko: +w.koM.toFixed(2) }));
  const c = w.center, R = w.koM;
  check("N2b. ... the ring IS that circle: 379 m east of its center inside, 380.5 m clear; 379 m south inside (past her "
        + "stern, 27 m behind her antenna), 380.5 m clear",
        () => inKo(v.full, c.e + R - 0.5, c.n) && !inKo(v.full, c.e + R + 1, c.n) && inKo(v.full, c.e, c.n - R + 0.5)
              && !inKo(v.full, c.e, c.n - R - 1),
        () => "R " + R.toFixed(1));
  // every water her hull can sweep, with her cable leading anywhere within 20 deg of her heading
  let missed = 0, tried = 0;
  for (const lead of [-20, -10, 0, 10, 20]) {
    const a = lead * Math.PI / 180, anc = { e: 6 + 126 * Math.sin(a), n: 173 + 126 * Math.cos(a) };
    for (let k = 0; k < 72; k++) {
      const b = k * 5 * Math.PI / 180, p = { e: anc.e + w.watchM * Math.sin(b), n: anc.n + w.watchM * Math.cos(b) };
      tried++; if (!inKo(v.full, p.e, p.n)) missed++;
    }
  }
  check("N2c. ... and it holds the whole watch circle wherever her cable leads within 20° of her heading (" + tried
        + " points on five circles, 10 m inside the ring's edge at the worst)",
        () => tried === 360 && missed === 0, () => missed + " outside");
  const deep = modelOf(VIC({ chart_depth_m: 500 })), none = modelOf(VIC({ chart_depth_m: undefined }));
  check("N2d. ... no charted depth on her record: 30 m assumed (cable 180 m) and said so; a band with no useful deep "
        + "bound is asked at 80 m at most (cable 330 m)",
        () => none.q && none.q.watch.depthM === 30 && none.q.watch.depthFrom === "assumed" && none.q.watch.rodeM === 180
              && deep.q && deep.q.watch.depthM === 80 && deep.q.watch.rodeM === 330,
        () => "none " + (none.q && none.q.watch.rodeM) + " " + (none.q && none.q.watch.depthFrom) + "; 500 m " + (deep.q && deep.q.watch.rodeM));
  const nh = modelOf(VIC({ heading: null })), nw = nh.q && nh.q.watch;
  const nhR = Math.hypot(173, 22) + 126 + Math.hypot(326, 16) + 10;
  check("N2e. ... NO HEADING: the anchor may lie any way - the circle is centered on her antenna, reaching her bow's "
        + "distance from it (hypot(173, 22)), her cable, the watch radius and the 10 m: " + nhR.toFixed(1) + " m",
        () => nw && !nw.fromHeading && nw.anchor === null && near(nw.center.e, 0) && near(nw.center.n, 0) && near(nw.koM, nhR)
              && inKo(nh.full, 0, -(nhR - 0.5)) && !inKo(nh.full, 0, -(nhR + 1)),
        () => nw && nw.koM.toFixed(1));
  const liar = modelOf(VIC({ sog: 6, cog: 0, age: 5 }), { sweepS: 45 }), slow = modelOf(VIC({ sog: 1.5, cog: 0, age: 5 }));
  check("N2f. ... only where her status is believed: 'at anchor' at 6 kn is a vessel under way (no rule, swept); at 1.5 kn "
        + "it is believed (under 3 kn) and she has her circle",
        () => liar.q && liar.q.moving && liar.q.rule === null && slow.q && !slow.q.moving && slow.q.rule === "anchored",
        () => "6 kn: " + (liar.q && liar.q.rule) + "; 1.5 kn: " + (slow.q && slow.q.rule));

  // the boat already in her water: ONE STEP AT A TIME
  const at = (own) => A.aisKeepout(VIC(), ref, { now: NOW, polledAt: NOW, sweepS: 0, own });
  const out = at({ e: 500, n: 0 }), mid = at({ e: 22 + 140, n: 0 }), inn = at({ e: 22 + 60, n: 0 });
  check("N3. THE BOAT INSIDE HER WATCH CIRCLE IS KEPT TO THE HALF-LENGTH CLEAR WATER, her bare hull only inside both: 573 m "
        + "from the circle's center (outside it) she has the circle; 140 m off her side (inside the circle, outside her "
        + "100 m) she has the 100 m (ruleWaived); 60 m off her side she has her hull (marginWaived)",
        () => out && out.rule === "anchored" && !out.ruleWaived && !out.marginWaived && out.ring === out.ruleRing
              && mid && mid.ruleWaived && !mid.marginWaived && mid.marginM === 100
              && inn && inn.ruleWaived && inn.marginWaived && inn.marginM === 0 && inn.ring === inn.bare,
        () => JSON.stringify([out, mid, inn].map((q) => q && { ruleWaived: q.ruleWaived, waived: q.marginWaived, margin: q.marginM })));

  // THE ESCAPE
  const escM = A.aisAvoidKeepout(m.q), escMko = { polys: [escM], lines: [], points: [] };
  const escOut = A.aisAvoidKeepout(out), escOutKo = { polys: [escOut], lines: [], points: [] };
  const escMid = A.aisAvoidKeepout(mid), escMidKo = { polys: [escMid], lines: [], points: [] };
  const ringIn = (q, ko) => q.ruleRing.every((p) => blocked({ e: c.e + (p.e - c.e) * 0.999, n: c.n + (p.n - c.n) * 0.999 }, ko, 0));
  check("N4. THE ESCAPE: moored and still, 20 m round her hull (his number, not her length); at anchor with the boat outside "
        + "her circle, the circle AND a ship-length round her hull (it must hold the guard's ring); with the boat inside "
        + "her circle, a ship-length round her hull as before (a 380 m circle is not left within the escape's horizon)",
        () => escM.avoidM === 20 && inKo(escMko, 10 + 19.5, 0) && !inKo(escMko, 10 + 21, 0)
              && ringIn(out, escOutKo) && inKo(escOutKo, 0, -27 - 199) && /and her watch circle$/.test(escOut.kind)
              && !inKo(escMidKo, 6, 661) && inKo(escMidKo, 0, 173 + 199) && !/watch circle/.test(escMid.kind),
        () => "moored " + escM.avoidM + "; outside: " + escOut.kind + "; inside: " + escMid.kind);

  // THE WAY ROUND
  const rM = A.aisRoundKeepout(m.q, 3, 3), rMko = { polys: [rM], lines: [], points: [] };
  const rOut = A.aisRoundKeepout(out, 3, 3), rMid = A.aisRoundKeepout(mid, 3, 3);
  check("N5. THE WAY ROUND: moored and still, her 20 m and the buffer (the router's standoff outside it) - no ship-length "
        + "disc (60 m off her side is clear of it); at anchor, her watch circle; inside her circle, the ship-length disc as before",
        () => rM.roundM === 20 && inKo(rMko, 10 + 22.5, 0) && !inKo(rMko, 60, 0) && /20 m round her$/.test(rM.kind)
              && near(rOut.roundM, w.koM) && /round her watch circle$/.test(rOut.kind) && rMid.roundM === 200,
        () => "moored " + rM.roundM + ", anchored " + (+rOut.roundM).toFixed(1) + ", inside " + rMid.roundM);

  // A PASSAGE: the rule's rings, never waived; and a ship anchored past the chart box's edge whose circle reaches into it
  const sw = ll(-300, -300), ne = ll(300, 300), box = { W: sw.lon, S: sw.lat, E: ne.lon, N: ne.lat };
  const outside = contact(0, 1000, { mmsi: 9, name: "OFF THE BOX", heading: 180, nav: 1, length: 200, beam: 32,
                                     dim: { a: 173, b: 27, c: 16, d: 16 } });
  const pm = A.aisMooredKeepouts([MOOR({ mmsi: 7 }), VIC({ mmsi: 8 }), outside], ref, { now: NOW, polledAt: NOW, bbox: box });
  const byN = (nm) => pm.polys.find((q) => q.name === nm) || {};
  check("N6. A PASSAGE lays her round the status's ring: the moored ship's 20 m, the anchored ship's circle - and a ship "
        + "anchored 700 m north of the box (bow toward it, 30 m assumed) whose 452 m circle reaches 94 m into it is kept "
        + "(the box's pad is 0.015 deg since the circle)",
        () => byN("MOORED").marginM === 20 && byN("VICTORIA T").rule === "anchored" && byN("VICTORIA T").ring === byN("VICTORIA T").ruleRing
              && byN("OFF THE BOX").rule === "anchored" && byN("OFF THE BOX").bb.y0 < 300,
        () => pm.polys.map((q) => q.name + " " + q.rule + " " + Math.round(q.bb.y0)).join("; "));

  // THE CHARTED DEPTH UNDER HER
  const sq = (e0, n0, e1, n1) => [ll(e0, n0), ll(e1, n0), ll(e1, n1), ll(e0, n1), ll(e0, n0)].map((p) => [p.lon, p.lat]);
  const feats = [
    { role: "depth_area", props: { DRVAL1: 10, DRVAL2: 20 }, geometry: { type: "Polygon", coordinates: [sq(-500, -500, 500, 500), sq(-50, -50, 50, 50)] } },
    { role: "depth_area", props: { DRVAL1: 5, DRVAL2: 10 }, geometry: { type: "Polygon", coordinates: [sq(-50, -50, 50, 50)] } },
    { role: "dredged", props: { DRVAL1: 12 }, geometry: { type: "MultiPolygon", coordinates: [[sq(200, -20, 400, 20)]] } },
    { role: "dredged", props: { DRVAL1: 25 }, geometry: { type: "Polygon", coordinates: [sq(600, -20, 700, 20)] } },
    { role: "land", props: {}, geometry: { type: "Polygon", coordinates: [sq(-500, -500, 500, 500)] } },
  ];
  const dAt = (e, n) => { const p = ll(e, n); return A.chartDepthAt(feats, p.lat, p.lon); };
  check("N7. THE CHARTED DEPTH UNDER HER, the deeper bound: 20 m in a 10-20 m area; 10 m in the 5-10 m area that fills its "
        + "hole; 20 m where a dredged 12 m lies inside the 20 m band (the deeper); a dredged area alone gives its own 25 m; "
        + "no depth area at all, null",
        () => dAt(100, 0).deepM === 20 && dAt(0, 0).deepM === 10 && dAt(300, 0).deepM === 20 && dAt(650, 0).deepM === 25
              && dAt(900, 900) === null,
        () => JSON.stringify([dAt(100, 0), dAt(0, 0), dAt(300, 0), dAt(650, 0), dAt(900, 900)]));
  const pAt = (e, n) => ll(e, n);
  const recs = [{ mmsi: 1, nav: 1, ...pAt(100, 0) }, { mmsi: 2, nav: 5, ...pAt(100, 0) },
                { mmsi: 3, nav: 1, ...pAt(900, 900), chart_depth_m: 7 }, { mmsi: 4, nav: 1, ...pAt(0, 0) }];
  recs.push({ mmsi: 5, nav: 0, ...pAt(100, 0) });
  const up = A.aisWithChart(recs, feats, 1.5), down = A.aisWithChart(recs, feats, -2);
  check("N7b. ... written on each record AT ANCHOR OR MOORED (aisWithChart): the deeper bound plus a rising tide (20 + 1.5); a "
        + "falling tide takes nothing off (20); moored, the same, and her berth_m (this world's land polygon covers her: 0); one the chart "
        + "does not cover loses a stale depth (aisWatchCircle then assumes 30 m); status 0 is left as it came; the records "
        + "are copies",
        () => up[0].chart_depth_m === 21.5 && down[0].chart_depth_m === 20 && up[1].chart_depth_m === 21.5 && up[1].berth_m === 0
              && up[2].chart_depth_m === undefined && up[3].chart_depth_m === 11.5 && up[4] === recs[4]
              && recs[0].chart_depth_m === undefined && recs[1].chart_depth_m === undefined,
        () => JSON.stringify(up.map((r) => [r.chart_depth_m, r.berth_m])));

  // ── N9. MOORED, NOT ALONGSIDE: HER SWING CIRCLE (settled 2026-11-01, "commit rules as you best suggest") ──────────────
  // A 20 x 6 m boat moored in a charted 10 m with no berth near her (KLEOS's kind): mooring line 3 m + riser 1.118 x 10 =
  // 11.2 m, so 14.2 m of "cable"; her swing circle hypot(14.2 + 20, 3) = 34.3 m round her mooring; kept to that, plus
  // 14.2 sin 20 = 4.9 m and the 10 m: 49.2 m, centered 14.2 cos 20 = 13.3 m ahead of her bow
  const SW = (o = {}) => contact(0, 0, { name: "ON A MOORING", heading: 0, sog: 0.1, nav: 5, length: 20, beam: 6,
                                         dim: { a: 10, b: 10, c: 3, d: 3 }, chart_depth_m: 10, ...o });
  const sq9 = modelOf(SW()), sw9 = sq9.q && sq9.q.watch;
  const cab = 3 + Math.sqrt(1.25) * 10, swR = Math.hypot(cab + 20, 3) + cab * Math.sin(20 * Math.PI / 180) + 10;
  check("N9. MOORED AND STILL BUT NOT ALONGSIDE: she may swing round a mooring - her SWING CIRCLE, worked as the watch "
        + "circle is with a mooring's cable (3 m of line + 1.118 x the depth of riser): " + swR.toFixed(1) + " m, centered "
        + (cab * Math.cos(20 * Math.PI / 180)).toFixed(1) + " m ahead of her bow; the same boat alongside keeps 20 m",
        () => sq9.q && sq9.q.rule === "swinging" && sw9 && sw9.kind === "swinging" && near(sw9.rodeM, cab, 0.01)
              && near(sw9.koM, swR) && near(sw9.center.n, 10 + cab * Math.cos(20 * Math.PI / 180))
              && inKo(sq9.full, 0, sw9.center.n + swR - 0.5) && !inKo(sq9.full, 0, sw9.center.n + swR + 1)
              && modelOf(SW({ berth_m: 12 })).q.rule === "moored" && modelOf(SW({ berth_m: 31 })).q.rule === "swinging"
              && /^moored and still, not alongside a charted berth: she may swing round a mooring - swing circle 34 m, kept to 49 m/.test(A.aisNavRuleText(sq9.q)),
        () => sw9 && "rule " + sq9.q.rule + ", cable " + sw9.rodeM.toFixed(2) + ", ko " + sw9.koM.toFixed(2) + " | " + A.aisNavRuleText(sq9.q));
  const escSw = A.aisAvoidKeepout(A.aisKeepout(SW(), ref, { now: NOW, polledAt: NOW, sweepS: 0, own: { e: 200, n: 0 } }));
  const rSw = A.aisRoundKeepout(A.aisKeepout(SW(), ref, { now: NOW, polledAt: NOW, sweepS: 0, own: { e: 200, n: 0 } }), 3, 3);
  check("N9b. ... and the escape and the way round treat her circle as the watch circle's (named so)",
        () => /and her swing circle$/.test(escSw.kind) && /round her swing circle$/.test(rSw.kind) && near(rSw.roundM, swR),
        () => escSw.kind + " | " + rSw.kind);

  // HOW FAR HER HULL LIES FROM A CHARTED BERTH: MOOR's hull is e -10..10, n -50..50 about her antenna
  const line = (pts) => ({ type: "LineString", coordinates: pts.map(([e, n]) => { const p = ll(e, n); return [p.lon, p.lat]; }) });
  const pt = (e, n) => { const p = ll(e, n); return { type: "Point", coordinates: [p.lon, p.lat] }; };
  const pier = [{ role: "dock_line", cls: "Shoreline_Construction_line", props: {}, geometry: line([[12, -80], [12, 80]]) }];
  const buoy = [{ role: "hazard_point", cls: "Mooring_Warping_Facility_point", props: { CATMOR: 7 }, geometry: pt(0, 55) }];
  const dolphin = [{ role: "hazard_point", cls: "Mooring_Warping_Facility_point", props: { CATMOR: "1" }, geometry: pt(-15, 0) }];
  const noCat = [{ role: "hazard_point", cls: "Mooring_Warping_Facility_point", props: {}, geometry: pt(-15, 0) }];
  const shoal = [{ role: "depth_area", props: { DRVAL1: 0, DRVAL2: 2 }, geometry: { type: "Polygon", coordinates: [sq(-500, -500, 500, 500)] } }];
  const quay = [{ role: "land", props: {}, geometry: { type: "Polygon", coordinates: [sq(-40, -100, -10.5, 100)] } }];
  const far = [{ role: "dock_line", cls: "Shoreline_Construction_line", props: {}, geometry: line([[45, -80], [45, 80]]) }];
  const v0 = MOOR({ berth_m: undefined });
  const bM = (fs) => A.chartBerthM(fs, v0);
  check("N9c. HOW FAR HER HULL LIES FROM A CHARTED BERTH (chartBerthM): a pier line 2 m off her side reads 2 m; a quay's "
        + "edge 0.5 m off it 0.5 m; a dolphin (CATMOR 1) 5 m off it 5 m; a MOORING BUOY (CATMOR 7) at her bow, a mooring "
        + "facility with no category, a depth area, or a pier 35 m off: none (null) - she is not alongside",
        () => near(bM(pier), 2, 0.11) && near(bM(quay), 0.5, 0.11) && near(bM(dolphin), 5, 0.11)
              && bM(buoy) === null && bM(noCat) === null && bM(shoal) === null && bM(far) === null && bM([]) === null,
        () => JSON.stringify({ pier: bM(pier), quay: bM(quay), dolphin: bM(dolphin), buoy: bM(buoy), noCat: bM(noCat), shoal: bM(shoal), far: bM(far) }));
  const recs9 = A.aisWithChart([v0, { ...v0, mmsi: 2, nav: 1 }, MOOR({ berth_m: undefined, ...ll(0, 200), mmsi: 3 })], pier, 0);
  const rule9 = recs9.map((r) => { const q = A.aisKeepout(r, ref, { now: NOW, polledAt: NOW, sweepS: 0 }); return q && q.rule; });
  check("N9d. ... written on the MOORED records only (berth_m), and read by the rule: the ship 2 m off the pier is moored "
        + "alongside (20 m); at anchor in the same place she has no berth_m and her watch circle; moored 200 m up the pier's "
        + "line, past its end, she is swinging",
        () => recs9[0].berth_m === 2 && recs9[1].berth_m === undefined && recs9[2].berth_m === undefined
              && rule9[0] === "moored" && rule9[1] === "anchored" && rule9[2] === "swinging",
        () => JSON.stringify(recs9.map((r, i) => [r.berth_m, rule9[i]])));

  // ── N10. STOPPED ALONGSIDE, WHATEVER SHE BROADCASTS (Andy, 2026-11-01, of the Honolulu piers: "The vessels at the pier
  //         do not have the updated avoidance distance applied" - then "make these changes as recommended") ──────────────
  // His live feed: 15 Class B contacts (no status at all) and 6 Class A alongside at 0 kn broadcasting 0 kept half their
  // length - MAUNAWILI, 217 x 32 m, 109 m across his survey lines.
  const MAU = (o = {}) => contact(0, 0, { name: "MAUNAWILI", heading: 122, sog: 0, nav: 0, length: 217, beam: 32,
                                          dim: { a: 150, b: 67, c: 16, d: 16 }, berth_m: 0, berth_deg: 122, ...o });
  const mau = modelOf(MAU()), mq = mau.q;
  const box10 = A.aisBox(MAU());
  const sideE = (m) => { const a = 122 * Math.PI / 180; return { e: Math.cos(a) * (16 + m), n: -Math.sin(a) * (16 + m) }; };   // to starboard
  const p19 = sideE(19.5), p21 = sideE(20.5);
  check("N10. STATUS 0 AT 0 KN ALONGSIDE IS MOORED: MAUNAWILI (217 x 32 m, 'under way using engine', her hull on the pier) "
        + "keeps 20 m off her hull, not half her length (109) - 19.5 m off her side inside, 20.5 m clear - and her name and "
        + "the tip say it was read so",
        () => mq && mq.rule === "moored" && mq.ruleInferred && mq.marginM === 20 && box10.lengthM === 217
              && inKo(mau.full, p19.e, p19.n) && !inKo(mau.full, p21.e, p21.n)
              && /^AIS: MAUNAWILI \(217 x 32 m, alongside\)$/.test(mq.kind)
              && A.aisNavRuleText(mq) === "stopped alongside a charted berth, broadcasting status 0, under way using engine: read as moored - kept 20 m off her hull",
        () => mq && "rule " + mq.rule + ", inferred " + mq.ruleInferred + ", margin " + mq.marginM + ", kind " + mq.kind + " | " + A.aisNavRuleText(mq));
  const cb = modelOf(contact(0, 0, { sog: 0, nav: null, berth_m: 4 })), cbq = cb.q;
  const fish = modelOf(MAU({ nav: 7 })), sail = modelOf(MAU({ nav: 8 })), undef = modelOf(MAU({ nav: 15 }));
  check("N10b. ... and so is a Class B boat with NO status (the Pier 38 fleet: 20 x 8 m assumed, 4 m off the pier) - 20 m "
        + "where she had 10 - and status 7 (fishing), 8 (sailing) and 15 (undefined)",
        () => cbq && cbq.rule === "moored" && cbq.ruleInferred && cbq.marginM === 20
              && A.aisNavRuleText(cbq) === "stopped alongside a charted berth, broadcasting no navigational status: read as moored - kept 20 m off her hull"
              && fish.q.rule === "moored" && sail.q.rule === "moored" && undef.q.rule === "moored",
        () => [cbq && cbq.rule, cbq && cbq.marginM, fish.q.rule, sail.q.rule, undef.q.rule].join(", "));
  const notAlong = modelOf(MAU({ berth_m: undefined, berth_deg: undefined })), far31 = modelOf(MAU({ berth_m: 31 }));
  const noSog10 = modelOf(MAU({ sog: null })), slowish = modelOf(MAU({ sog: 0.6 }));
  const nuc = modelOf(MAU({ nav: 2 })), ram = modelOf(MAU({ nav: 3 })), cbd = modelOf(MAU({ nav: 4 })), agr = modelOf(MAU({ nav: 6 })), sart = modelOf(MAU({ nav: 14 }));
  check("N10c. NOT INFERRED: not alongside (no berth, or 31 m off one); no speed reported (heard only by her static report); "
        + "0.6 kn; or a status that declares a condition - 2 not under command, 3 restricted, 4 constrained by draught, 6 "
        + "aground, 14 AIS-SART: each keeps half her length (109 m)",
        () => [notAlong, far31, noSog10, slowish, nuc, ram, cbd, agr, sart].every((x) => x.q && x.q.rule === null && !x.q.ruleInferred && Math.round(x.q.marginM) === 109),
        () => [notAlong, far31, noSog10, slowish, nuc, ram, cbd, agr, sart].map((x) => x.q && (x.q.rule + "/" + Math.round(x.q.marginM))).join(", "));
  const anchAlong = modelOf(MAU({ nav: 1, chart_depth_m: 12 })), moorTrue = modelOf(MAU({ nav: 5 }));
  check("N10d. ... and the two broadcast rules stand: at anchor (1) beside a pier keeps her watch circle; moored (5) is the "
        + "moored rule NOT inferred (its own words)",
        () => anchAlong.q.rule === "anchored" && !anchAlong.q.ruleInferred && moorTrue.q.rule === "moored" && !moorTrue.q.ruleInferred
              && /^moored alongside and still/.test(A.aisNavRuleText(moorTrue.q)),
        () => anchAlong.q.rule + " " + moorTrue.q.rule + " " + moorTrue.q.ruleInferred);

  // ── N11. ALONGSIDE WITH NO HEADING, SHE LIES ALONG THE BERTH ──────────────────────────────────────────────────────────
  // CG ACTIVE, 64 x 9 m, no heading, on the Sand Island pier: a disc of every orientation, 52 m from her antenna. Along
  // the berth (30 deg), either way round: her larger offsets both ways, 20 m outside them.
  const ACT = (o = {}) => contact(0, 0, { name: "CG ACTIVE", heading: null, sog: 0, nav: 5, length: 64, beam: 9,
                                          dim: { a: 40, b: 24, c: 3, d: 6 }, berth_m: 0, berth_deg: 30, ...o });
  const act = modelOf(ACT()), aq = act.q;
  const mo11 = A.aisMotion(ACT(), { now: NOW, polledAt: NOW });
  const along = (m) => { const a = 30 * Math.PI / 180; return { e: Math.sin(a) * m, n: Math.cos(a) * m }; };
  const across = (m) => { const a = 120 * Math.PI / 180; return { e: Math.sin(a) * m, n: Math.cos(a) * m }; };
  const pts11 = [[along(40 + 19.5), true], [along(40 + 20.5), false], [along(-(40 + 19.5)), true], [along(-(40 + 20.5)), false],
                 [across(6 + 19.5), true], [across(6 + 20.5), false], [across(-(6 + 19.5)), true], [across(-(6 + 20.5)), false]];
  check("N11. NO HEADING, ALONGSIDE: she lies ALONG THE BERTH (aisMotion 'berth', 30 deg) - kept out as the box of her larger "
        + "offsets (40 m fore and aft, 6 m each side) EITHER WAY ROUND, plus 20 m: 59.5 m along the berth inside both ways, "
        + "60.5 clear; 25.5 m across inside both sides, 26.5 clear - where the disc of every orientation reached 52 m every way",
        () => mo11.from === "berth" && mo11.hdg === 30 && aq.byBerth && aq.rule === "moored"
              && pts11.every(([p, inside]) => inKo(act.full, p.e, p.n) === inside),
        () => "from " + mo11.from + ", hdg " + mo11.hdg + "; " + pts11.map(([p, i]) => (inKo(act.full, p.e, p.n) === i ? "ok" : "X")).join(""));
  const nb1 = A.aisMotion(ACT({ nav: 1 }), { now: NOW, polledAt: NOW }), nb2 = A.aisMotion(ACT({ sog: 0.6 }), { now: NOW, polledAt: NOW });
  const nb3 = A.aisMotion(ACT({ berth_m: 31 }), { now: NOW, polledAt: NOW }), nb4 = A.aisMotion(ACT({ nav: 3 }), { now: NOW, polledAt: NOW });
  const nb5 = A.aisMotion(ACT({ heading: 200 }), { now: NOW, polledAt: NOW });
  const old11 = modelOf(ACT(), { navRules: false });
  check("N11b. ... only alongside, stopped, moored or with no condition declared: at anchor (1), at 0.6 kn, 31 m off, or "
        + "status 3 she is the disc as before; a heading she reports wins over the berth; navRules false is the model before "
        + "(the disc)",
        () => nb1.from === null && nb2.from !== "berth" && nb3.from === null && nb4.from === null && nb5.from === "heading" && nb5.hdg === 200
              && old11.q && !old11.q.byBerth && old11.q.hdg === null,
        () => [nb1.from, nb2.from, nb3.from, nb4.from, nb5.from + "@" + nb5.hdg, old11.q && old11.q.hdg].join(", "));

  // ── N12. THE BERTH'S BEARING, AND HOW FAR A HULL WITH NO HEADING IS FROM IT ─────────────────────────────────────────
  const diag = [{ role: "dock_line", cls: "Shoreline_Construction_line", props: {}, geometry: line([[-100, -100], [100, 100]]) }];
  const bN = A.chartBerth(pier, MOOR({ berth_m: undefined })), bD = A.chartBerth(diag, MOOR({ heading: 45, berth_m: undefined, ...ll(20, 0) }));
  const quayIn = A.chartBerth(quay, contact(-20, 0, { sog: 0, nav: 0 }));
  const dolph = A.chartBerth(dolphin, v0);
  check("N12. chartBerth gives the bearing of the berth's face nearest her: a pier line running north, 0; one running "
        + "north-east, 45; her antenna on the quay, 0 m and the quay's face (0); a dolphin (a point), no bearing",
        () => bN && bN.m === 2 && bN.deg === 0 && bD && near(bD.deg, 45, 0.11) && quayIn && quayIn.m === 0 && quayIn.deg === 0
              && dolph && dolph.m === 5 && dolph.deg === null,
        () => JSON.stringify({ bN, bD, quayIn, dolph }));
  const big = (e) => contact(e, 0, { name: "BIG", heading: null, sog: 0, nav: 0, length: 217, beam: 32, dim: { a: 150, b: 67, c: 16, d: 16 } });
  const b40 = A.chartBerthM(pier, big(12 - 40)), b60 = A.chartBerthM(pier, big(12 - 60));
  check("N12b. WITH NO HEADING, HER SIDE OFFSET, NOT EVERY ORIENTATION: a 217 m ship (16 m to either side of her antenna) "
        + "40 m from a pier line is 24 m off it - alongside; 60 m from it, 44 m - not (the disc of every orientation, 109 m, "
        + "read both as touching it)",
        () => b40 === 24 && b60 === null,
        () => "40 m: " + b40 + ", 60 m: " + b60);

  // ── N13. CATMOR AS CODE OR TEXT ─────────────────────────────────────────────────────────────────────────────────────
  const mf = (c) => A.chartBerthM([{ role: "hazard_point", cls: "Mooring_Warping_Facility_point", props: { CATMOR: c }, geometry: pt(-15, 0) }], v0);
  const kinds13 = { "dolphin": mf("dolphin"), "deviation dolphin": mf("deviation dolphin"), "bollard": mf("bollard"),
                    "tie-up wall": mf("tie-up wall"), "post or pile": mf("post or pile"), "\"1\"": mf("1"), "5": mf(5),
                    "mooring buoy": mf("mooring buoy"), "chain/wire/cable": mf("chain/wire/cable"), "7": mf(7), "\"6\"": mf("6") };
  check("N13. A MOORING FACILITY IS A BERTH BY ITS CATMOR, AS A CODE OR AS TEXT: dolphin, deviation dolphin, bollard, tie-up "
        + "wall, post or pile, 1-5 - 5 m off; a mooring buoy, chain/wire/cable, 6 or 7 - none; and the console keeps CATMOR",
        () => ["dolphin", "deviation dolphin", "bollard", "tie-up wall", "post or pile", "\"1\"", "5"].every((k) => kinds13[k] === 5)
              && ["mooring buoy", "chain/wire/cable", "7", "\"6\""].every((k) => kinds13[k] === null)
              && /ENC_KEEP_PROPS = \([\s\S]{0,700}"CATMOR"/.test(require("fs").readFileSync(path.join(__dirname, "..", "asv_console.py"), "utf8")),
        () => JSON.stringify(kinds13));

  // ── N14. WHAT THE PAGE WRITES ON THE RECORDS ────────────────────────────────────────────────────────────────────────
  const recs14 = A.aisWithChart([{ ...v0, nav: null, berth_m: 99, berth_deg: 7 }, { ...v0, nav: 0, sog: 3 }, { ...v0, nav: 3, sog: 0 },
                                 { ...v0, nav: 0, sog: null }, { ...v0, nav: 1, sog: 0 },
                                 { ...v0, ...ll(0, 400), nav: null, berth_m: 5, berth_deg: 9 }], pier, 0);
  check("N14. aisWithChart writes berth_m and berth_deg on a still vessel with no status (the stale 99 m and 7 deg replaced: "
        + "2 m, 0 deg) - and drops them from one 400 m up the pier's line, past its end; not on one at 3 kn, one reporting a "
        + "condition (3), one with no speed, or one at anchor (her depth only)",
        () => recs14[0].berth_m === 2 && recs14[0].berth_deg === 0 && recs14[1].berth_m === undefined && recs14[2].berth_m === undefined
              && recs14[3].berth_m === undefined && recs14[4].berth_m === undefined && recs14[4].berth_deg === undefined
              && recs14[5].berth_m === undefined && recs14[5].berth_deg === undefined,
        () => JSON.stringify(recs14.map((r) => [r.nav, r.sog, r.berth_m, r.berth_deg])));

  const off = modelOf(VIC(), { navRules: false });
  check("N8. navRules false builds her without the status rules - the half-length rule (100 m), as before 2026-11-01 (the "
        + "suites that measure that rule alone ask for it)",
        () => off.q && off.q.rule === null && off.q.marginM === 100 && off.q.watch === null,
        () => off.q && "rule " + off.q.rule + ", margin " + off.q.marginM);
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
