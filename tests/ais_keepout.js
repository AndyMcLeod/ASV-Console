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

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
