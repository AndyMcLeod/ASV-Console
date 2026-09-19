# WHY THE IN-EXTREMIS ESCAPE KEEPS FIRING — the evidence, 2026-09-19

Andy, 2026-09-19: *"start with the escapes."* His console had been taking the helm on his own runs. This
file is the evidence and what it indicts. **⚠ ITEMS 1, 2 AND 3 OF THE ORDER OF WORK ARE NOW FIXED**
(the turn geometry `d7d3f905`; the helm rung's selection test `f2fb80cd`; the planner/guard seam, this commit) — each marked where it
sits below, with what it does and does not close. `DEPARTURE_PARADIGM.md` is the design for one more
class of it, and this file's ORDER OF WORK outranks that file's staging.

Method: seven agents reconstructed every recorded escape from the session logs and read the guard path;
one synthesized. Their measurements come from **rebuilding Andy's own keep-out model** in node from the
cached ENC extracts (`charts/enc/features_v5_*.json`) with the console's own modules, and replaying the
recorded frames through the real `assess`. Raw transcripts:
`.claude/projects/C--Users-Andy-McLeod-Starlink/<session>/subagents/workflows/wf_cfb80832-12f/` (escapes)
and `wf_49c7cc9c-627/` (design). **The session log is the fixture nobody has to build** — the
`/api/cmd/upload` body IS the route the vessel was given, and telemetry is ~1 Hz beside it.

## THE CENSUS — 11 escapes, not 6

| session | port | escapes | note |
|---|---|---|---|
| asv_20260916-102925 | pago_pago, then erie_pa | 4 in 5 starts | **not reconstructed — do this first if you reopen the file** |
| asv_20260916-185954 | honolulu_harbor | 1 | in a generated turn, 414 s in |
| asv_20260917-213929 | — | **0 in 10 starts** | the most informative session in the record |
| asv_20260918-100307 | new_castle_nh | 2 | both on the routed approach |
| asv_20260918-130610 | pago_pago | 4 | includes a chain of three |

- **NOT ONE escape happened on a coverage line.** Four on the ENC-routed approach, one in a generated
  turn, one on the escape leg itself, one while station-keeping at an escape hold point.
- **Only 2 of 11 came within 2 s of Start** (0.45 s and 1.17 s). The rest: t+6.5, 56.6, 83.3, 92.8,
  106.8, 239.7, 288.8, 413.9, 682.4 s.
- **Every reconstructed escape was on a PUNCHED plan** (250, 185, 150, 78, 62 turn vertices). The only
  un-punched plan in the whole record — `mission.json.bak3`, 22 lines x 113 m at ~2 m spacing, zero turn
  points — ran 30 minutes to an RTH with no escape.
- Andy's 09-17/18 sessions ran build `15ddf3ff44eb`, which is the tree as committed, so the
  Add-to-plan refusal (`035878f1`) was live for all of them.

## WHAT WAS VERIFIED DIRECTLY (by hand, not by an agent)

1. **A berthed boat is in extremis by construction.** `timeToEntry` returns 0 on `blocked(p,ko,buf)`
   at static/js/guard.js:194 — *before* the stationary test at :198 — and `projectRoute` short-circuits
   the same way at :246. Inside a buffer both projections read 0 and `assess` lands on `helm` with no
   threshold consulted. **There is no number to tune.**
2. **With no course the guard reads CLEAR, not blind.** `groundVel(null, sog)` returns null
   (guard.js:178-182) and `clearanceGuard` substitutes `{level:"clear"}` (asv.html:1814-1815). A
   stopped boat reports `cog_deg: null`, so the readout says clear exactly when she is stopped.
3. **`guardTrack()` returns null with no way on** (asv.html:1617-1631, `twMs > 0.05`), which is why the
   paradigm keys its regimes on it.
4. **The escape at 14:03:22 was not "before she moved"**: the last telemetry reads `sog 0 / cog null /
   run idle`, but the guard cannot assess without a course, and the next frame (14:03:23) reads
   `sog 1.1 / cog 142`. She had just begun to move. The same second carries `start`, three `speed high`
   commands and the `escape`.
5. **The generated turns ship with reversals at both joins** — see below.

## THE TURN GEOMETRY IS WRONG, AND IT IS IN HIS CURRENT PLANS

From the Honolulu uploaded route (415 pts), legs 14..22 measured with the console's own geodesy:

```
 14->15   47.94 m  bearing 005.0   (coverage line 1)
 15->16    2.59 m  bearing 200.0   turn -165   <-- snap
 16->17    2.59 m  bearing 230.0        +30
 ... four more +30 steps ...
 20->21    2.59 m  bearing 350.0        +30
 21->22    5.99 m  bearing 185.0   turn -165   <-- snap
 22->23   43.94 m  bearing 185.0   (coverage line 2)
```

And in `mission.json.bak5` (09-18, punched, 20 lines), the same signature at 2.8 m spacing: the boat
runs the line on 335, **snaps 172** to 147, arcs left through ~164 in 11 vertices, arrives on 343, and
**snaps 172** again onto the next line at 155.

The arc is correctly ORDERED and correctly PLACED: its points run monotonically from line 1's end
(1.1 m away) to line 2's start (2.8 m away), bulging south of the 20 m gap. What is wrong is the SIDE it
bulges: **its entry tangent matches the outgoing line's stored direction and its exit tangent matches the
incoming one** — i.e. the shape belongs to the opposite transition. Reversing the point order does NOT
fix it (measured: 10 bad joints become 12); the shape itself is mirrored.

### ⇒ ESTABLISHED 2026-09-19, THE GUESS BELOW IT WAS WRONG, AND IT IS FIXED

This paragraph used to end: *"the likely origin is the pair's headings being taken from the lines' stored
`a->b` direction rather than the direction the runs are FLOWN after `regionOrder` re-orients them —
unverified, and the first thing to establish."* **That is not the cause and `regionOrder` is not
involved.** What was done instead of reading: `mission.json.bak5` carries BOTH the flown `waypoints` and
its 20 source `lines`, so every turn can be re-derived from its own pair and matched to the rung that
produced it. Fed the pair's real `(E, F, hE, hF)`, the page's own `turnWithRetry` returns a **correct**
turn every time — including for all six that shipped wrong. The shape functions and the headings are
both fine.

**Every shipped turn matches a LADDER RUNG to the millimetre** (max vertex deviation <= 5 mm):

| plan | arc outboard | racetrack | racetrack slow | **arc INBOARD** |
|---|---|---|---|---|
| `mission.json.bak5` | 11 | 2 | - | **4** |
| `mission.json.bak4` | 11 | 3 | 2 | **1** |
| `mission.json.bak1` | 8 | - | 1 | **1** |
| Honolulu 2026-09-16 (415 wpts) | 21 | 14 | 4 | **4** |

The mirrored shape is `teardropTurn(..., 'inboard')` — **rungs 5 and 6**, the "turn AWAY from the dock"
rung the wharf incident bought. Its semicircle branch reverses the **sweep** about a center that stays
midway between the two lines. That keeps both endpoints and reverses **both tangents**, so the boat is
told to reverse at the line end, fly the arc backwards, and reverse again onto the next line. To sweep
the other way *and* stay tangent, the center has to move to the far side of the line — and a semicircle
from there ends 2R on the wrong side of the next line, not on it. **There is no inboard variant of a
tangent reversal**, which is exactly what `racetrackTurn`'s own header has said about its own shape all
along; the semicircle's `side` option contradicted it. Over 450 reversal geometries x 3 vessel profiles,
**every** inboard semicircle asks more of the hull than it can hold (93-212 deg/s against a 60/20/25
deg/s hull); every other shape asks at most 22.

**⚠ WHERE THE HONOLULU ESCAPE FIRED, AND WHAT THE TURN DID NOT DO.** Route vertex 18 — the 4th of the six
arc vertices of the rung-5 turn at wpts 14-23 — with the boat tracking the commanded polyline to
**0.26 m**. So the turn did **not** throw her off her route, and any account that says so is wrong (an
earlier draft of this work said it). What it did was ask for a 165-degree reversal at the join, which
cost her half her way (**sog 1.98 -> 0.94 kn**, recorded) and swung her COG through ~205 degrees — and an
instantaneous COG mid-pirouette is exactly what the guard's reach test projects on. That is the seam with
H1, and it is why the turns were worth doing first.

Joints over 90 degrees, counted over whole plans: Honolulu route 38 of 413; `bak5` 10; `bak4` 4;
`bak1` 6. ⚠ **Those counts are THREE defects, not one**, and all 38 of Honolulu's are now attributed:

| cause | joints | pairs |
|---|---|---|
| inside an INBOARD turn — **the only one this work fixes** | 8 | 4 |
| at a ZERO-TURN reversal join (the straight-180 class outside the reversal gate) | 19 | 19 |
| approach / region-hop junctions (vertices 14, 32, 36, 42, 70, 301, 304, 329, 332, 365, 397) | 11 | — |

**So this removes 8 of the 38.** The 19 are the still-open "staggered reversals judged as hops" chip.
The 11 are a class nobody has looked at: they are not reversals, so no turn is generated for them at all,
and `pruneJunctionKnots` reaches only the ones that came out of `routeAround`.

**Why nothing caught it:** `turnFlyable` (static/js/turns.js) asks whether the *projected track clears
keep-outs*, not whether the hull can *join* the shape — measured, it passed **120 of 120** cusped shapes.
`legClear` passes every chord, because every chord is lawful water. And `junctionKnot` /
`pruneJunctionKnots` (static/js/passage.js), exactly a ">150 degrees with <12 m on the shorter leg"
detector, is applied ONLY to routed detours in punchOut's `around` branch, never to generated turns. The
Add-to-plan refusal (`035878f1`) does not check turn shape either — only that a turn exists.

**THE FIX, SHIPPED:** `turnJoinable` in `static/js/turns.js`, asked by `turnWithRetry` ahead of
`turnFlyable`. A generated reversal must leave the line on `hE` and arrive on `hF`. Clause 1 refuses a
join past a quarter turn — a sign change rather than a tuned threshold, and the populations are nowhere
near it (worst legitimate join 45 deg, mirrored 175). Clause 2 refuses a join tighter than the hull's own
rate over the leg it has to turn on, judged at the PLAN's speed so a slowed rung cannot buy itself a
join. Held by `tests/turn_geometry.js` 50-57 (nine mutations recorded, nothing surviving) and
`tests/direct_turn.js` 10/10a/10b/10c.

**⚠ OPERATIONAL CONSEQUENCE: the 10 turns in the table above now REFUSE.** Those pairs go red and Add to
plan refuses the pattern until the operator moves the line ends, strikes a run or widens the spacing.
That is the intended trade, and it is only safe because `035878f1` made a refused reversal visible
instead of shipping it as a straight leg.

## THE RANKED CAUSES (from the reconstruction; measurements are the agents')

1. **H1 — the helm rung is a REACH test, not a danger test. ⚠ FIXED 2026-09-19 — see item 2 of the
   ORDER OF WORK; everything below describes the rung AS IT WAS.** `assess` (guard.js:489, :509) returns
   `helm` on the mere existence of a drift-only entry inside the 45 s horizon, with no margin, no
   depth-of-entry, and no comparison with `tEntry`. Its reach is `buffer + 45 s x |set|`.
   **Census:** every escaping session had max `status.env_set_kn` >= 0.58 kn (1.75, 0.58, 1.00, 1.75);
   all 13 sessions with max set <= 0.46 kn produced 0 escapes in 17 starts. Two sessions at 0.59-0.79 kn
   escaped zero times, so a big set is necessary-ish, not sufficient — geometry is the second term.
   **And the set is never a tidal current**: `state.current.ok` is FALSE at every port, for three
   different reasons, so the drift the top rung rests on is the simulator's wind/wave forcing, published
   only while `_running` — it goes 0.00 to full value in the frame the run starts.
   The banner's asserted cause ("being set onto <kind>") is therefore not what the code established.
2. **H2 — containment is scored in extremis with no projection at all** (verified above). Real danger at
   Pago Pago (4.67 m from a LAND polygon inside a 20 m buffer), answered with the wrong rung.
3. **H3 — the planner/guard seam. ⚠ FIXED 2026-09-19 — see item 3 of the ORDER OF WORK.
   ⚠ AND ITS HEADLINE RATIO IS STALE TWICE OVER: the 3-12x below was measured against the OLD helm
   rung; item 2 cut it to about 1.7x, and item 3 then closed it for the coverage lines.** Plans are clipped to the buffer to within centimetres (measured
   minimum waypoint clearance: 5.05 m against a 5 m buffer; 20.28 m against 20 m; zero waypoints inside
   the buffer anywhere) while the guard's helm rung reaches 3-12x further. 34% and 67% of two routes'
   waypoints sit inside the helm band; 265 of Honolulu's 415 lie within 10 m of a keep-out.
   **One of the two numbers has to move, and the guard's is the arbitrary one.**
4. **H5 — no dwell, no hysteresis, no margin on the top rung.** Honolulu: the route projection entered
   8 s ahead where clearance was 4.95 m — **clipping the 5 m buffer by 5 cm**; the drift-only track
   clipped it by 1 cm. Every gentler rung is damped (release 4 s, edge 2 s, slow-in-lieu 2 s); the helm
   rung fires on one frame.
5. **H6 — escapes chain.** The escape point is never required to survive the guard's own test, and a
   boat that arrives and station-keeps loses its route model (`guardTrack` null), so it is re-judged on
   the straight projection of its own wander plus the drift. Pago Pago 14:04:18 fired 3.5 s after
   arriving at the previous escape's hold point.
6. **H4 — New Castle is UNEXPLAINED. ⚠ AND SO IS HONOLULU (established 2026-09-19).**
   The turn work re-derived the Honolulu escape from the record and could not reproduce its trigger
   either: at the frame the escape fired on, a keep-out model rebuilt from the cached ENC gives the
   boat **12.0 m of clearance and `clear`**. That model is not wrong - it reproduces the console's own
   logged `hold_clear_m` at the escape target to **4 mm** (48.961 m raw against a logged 43.965 m,
   which is the same number less the 5 m buffer). The only model input that differs is `chartInk`,
   the raster-read structures `foldChartInk` pushes into `nogo.ko` - and **nothing records it, in any
   session log, ever** (checked across all of `logs/`). So the class is wider than this entry said:
   an escape that fired against chart ink cannot be reconstructed at all, which is why item 5 below
   is now a prerequisite for VERIFYING any guard change against the recordings rather than a tidy-up.
   The original New Castle wording follows. Both escapes fail to reproduce: the ENC-only rebuild gives the
   boat 10.87 m and 13.09 m of clearance, not blocked, drift-only track clear — `assess` would return
   `clear`. Yet the same model reproduces both escape targets' `hold_clear_m` exactly. The suspect is
   `foldChartInk` (asv.html:6612-6624) pushing raster-read structures into the same model, which
   **nothing logs**. Rebuild the ink before concluding anything about these two.
7. **H7 — the start transient** (no way on, set appears with the first COG, no acceleration model) is
   real but explains only the 2 escapes inside 2 s.

## DO NOT CONCLUDE (each of these was tested and is wrong or unsupported)

- That `escapeCourse` or the command path is at fault: 8 of 10 escape targets reproduce from the cached
  ENC alone, 6 of them at 0.00 m, and every logged `hold_clear_m` reproduces exactly.
- That raising `buffer_m` 5 -> 20 caused the Pago Pago trio: the same spot escaped three times on
  2026-09-16 at `buffer_m` 3.
- That the escape was flown at 6 kn: at Honolulu the guard's `speed high` was overwritten by the
  governor with `low` 5 ms later and `survey` 128 ms after that; `speed_key` never reads `high` in any
  of that session's 1279 frames, max sog after the escape 2.57 kn. (So the rung's own "steerage to beat
  the set" argument was not delivered either.)
- That `status.hold_clear_m` is a live clearance readout: it is the console-supplied disc for the last
  commanded point, echoed back (asv.html:9344, asv_console.py:3670), and it lags one command behind.
- That the 103 s Honolulu page stall caused that escape: it ended 79 s earlier and the guard
  demonstrably evaluated frames in between.
- That `enforce.area` explains New Castle: tested and killed — `escapeCourse` then returns null
  (BOXED IN, no command) and the zone count comes out 1547 against a logged 1463.

## ORDER OF WORK — ANDY'S, 2026-09-19: turns, then the helm rung, then the seam, then the launch grant

1. ~~**The turn geometry.**~~ **DONE 2026-09-19** — see the ESTABLISHED block above. It was the INBOARD
   rung, not a heading-derivation bug; `turnJoinable` now refuses any shape that does not join both
   lines. ⚠ The other half of the over-90-degree joints is the zero-turn straight-180 class and is
   untouched (see STILL OPEN).
2. ~~**The helm rung's selection test**~~ **DONE 2026-09-19.** All four: the reach test is now a danger
   test (`HELM_S` = `HOLD_S` = 20 s, not the 45 s look-ahead), it needs a real depth of entry
   (`HELM_ENTRY_FRAC` = half the operator's buffer, not a 2 mm graze), it is damped like every other
   rung (`HELM_DWELL_MS` 1.5 s, on the ACTION - the alarm still fires on the frame), and the banner
   quotes the projection instead of asserting a set it never measured.
   ⚠ **Trigger distance drops from `buf + 45 s x set` to `buf/2 + 20 s x set`** - 18.4 m to 8.5 m at
   his 0.58 kn set, 45.5 m to 20.5 m at 1.75 kn. A boat with NO WAY ON is exempt from both new tests
   (its drift track IS its ground track, so a hold is what she is already doing - the Eastport case).
   ⚠ **AND IT IS UNVERIFIED AGAINST THE RECORD**, by Andy's decision: see H4 below - the escapes do
   not reproduce, so this is measured on synthetic fixtures only.
3. ~~**The planner/guard seam (H3)**~~ **DONE 2026-09-19.** Andy's choice of four options: make the PLANNER
   clip to what the guard needs. The coverage clip is now taken at `guardStandoffM(buffer, set)` =
   `max(buffer, buffer/2 + HELM_S x set)` - 8.5 m at his 0.58 kn set, 20.5 m at 1.75 kn, on a 5 m buffer -
   and that number is DERIVED from the helm rung's own constants rather than written down twice.
   ⚠ **It costs coverage and the card says so.** ⚠ **It is the COVERAGE LINES only**: turns and transits
   still answer to the plain buffer, so a clipped plan cannot have the helm rung fire ON A LINE in that set,
   but it can still fire in a turn, on a transit, or if the set rises afterwards.
4. **The launch grant** (`DEPARTURE_PARADIGM.md`) for the berth/containment class.
5. **Chart ink at New Castle** — rebuild it; nothing records it today.

## STILL OPEN FROM BEFORE

- Staggered reversals judged as hops (task chip, 2026-09-16): `bak1`-era lines 34->35, next entry 81.9 m
  behind the exit and 10 m across, gap beyond the 4.6-spacing gate, so no turn is tried and nothing is
  flagged.
- A folded detour (`nKnotFold`) still ships with its fold and a banner.
- A punch is dropped on ANY water-level change (`TIDE_REBUILD_M` is 0.1 m for the model rebuild, but
  `patClip` goes on any delta).
- 217 `page_stall` records over 09-17/18, 120 in one 66-minute session — `render()` redraws the whole
  chart every frame, visible or not.
