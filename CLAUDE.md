# ASV Simulator — project guide (CLAUDE.md)

Browser-only command-and-control (C2) shore station **and simulator** for a
small-class **survey ASV** (autonomous surface vehicle, ~2 m × 0.75 m, battery,
short surveys in constrained water). Single-file stdlib-Python server
(`asv_console.py`) + one vanilla-JS page (`static/asv.html`), plus a read-only
`static/playback.html` session-review page. No pip, no build step, Python 3
standard library only.

This project is a **sanitized, generic derivative** — it carries no vendor,
model, or proprietary-protocol identity. Keep it that way: do **not** reintroduce
brand names, model numbers, vendor manual citations, or a specific wire-protocol
format. The onboard controller is the generic **VCU (Vehicle Control Unit)**; the
shore link is a generic serial-over-IP control link.

**Where the line falls** (settled 2026-08-01, see the sanitization section): the **sibling
console's identity never appears in code** — it is the thing this derivative is sanitized
from, so refer to it as "the sibling console". A **modeled vessel's name is DATA** and
belongs in `vessels/*.json`; the core may name a profile *id* (`DEFAULT_VESSEL_ID`) because
that is a data key, not branding. Standing check:

`grep -rniP "teledyne|z-?boat(?!_[a-z0-9])" --include=*.py --include=*.html --include=*.js . | grep -v vessels/`

**⚠ THE LOOKAHEAD IS THE DATA-KEY ALLOWANCE, AND THE CHECK WAS WRONG WITHOUT IT
(fixed 2026-08-26).** The rule above has always permitted a profile *id*; the
grep did not, so it reddened on the six `zboat_1800hs` lines in `data_routes.py`
— a check that flags what its own rule allows is one people learn to ignore, and
this one had been ignored long enough that nine REAL prose hits were sitting
behind the noise. `(?!_[a-z0-9])` says: the brand followed by an id tail is a
data key; the brand standing alone is branding. **`-P`, not `-E`** — a negative
lookahead needs PCRE. It still catches a line carrying BOTH, which is why this
is one command rather than a second `grep -v` that would hide such a line.

**⇒ AND IT IS CLEAN AS OF 2026-08-26.** Fixing the grep surfaced NINE prose hits
that the `zboat_1800hs` noise had been hiding — `static/js/state.js`,
`static/asv.html`, and seven in `tests/survey_card.js`. All nine are scrubbed;
Andy's call, quotes included.

**⚠ A QUOTATION IS ALTERED IN BRACKETS, NEVER SILENTLY.** Four of them quoted
him verbatim, and the replacement reads *"for the [small-class boat] this would
be fine"* with a line beside it saying the brackets are a substitution.
Reworded without saying so, a quotation stops being evidence of what was
actually asked for — which is the only reason to keep quoting him at all.

**⇒ THE HOUSE WORD IS "the small-class boat"**, matching `vessels/*.json`'s own
`"class": "small survey ASV"`. Where a check wants to name the thing exactly,
the PROFILE ID is the sanitized way to do it and the grep now permits it:
`17b`'s detail line reads `drix08=80 zboat_1800hs=0`.

**⚠ AND NOTHING RUNS THIS.** It lives here as prose, so it is a check only when
somebody types it — which is how it stayed wrong. The hook globs `tests/*.py`,
so a suite added there runs the day it is written.

**The rule is scoped to CODE.** THIS FILE deliberately names the sibling and its path — a
maintainer has to be able to find it — which is why the check above filters by source
extension. Don't "finish the job" by scrubbing the maintainer notes.

## ⇒ START HERE (handoff refreshed 2026-09-02 — AIS contacts carry their particulars, and every one has a CPA)

**NEWEST (this commit): THE PARTICULARS ANDY ASKED FOR WERE ALREADY ARRIVING AND BEING
THROWN AWAY.**

> *"AIS contacts need more data made available... add to the AIS capture data the type of
> vessel, length, width, tonnage. Add destination. Add and recalculate CPA/TCPA as needed
> especially after a maneuver. Build the resultant vessel icon to match the relative size...
> Review MagicPort access rules... as compared to aisstream."*

**⚠ FOUR OF THE FIVE NEEDED NO NEW SOURCE AT ALL.** AIS message 5 carries hull DIMENSIONS,
DESTINATION, draught, IMO and call sign; messages 19 and 24B carry type and dimensions. Both
decoders — the aisstream JSON handler and the NMEA bit-decoder — read `name` and `type` and
discarded the rest, and **the aisstream subscription had been asking for `ShipStaticData`
since the day it was written.** The data was arriving, being parsed, and dropped. Both
decoders now keep it; verified against the published AIVDM conformance sentence (EVER
DIADEM, 295 × 32 m, IMO 9134270, NEW YORK, 12.2 m).

**⚠ AND THE SERIALISER WOULD HAVE SWALLOWED ALL OF IT.** `Registry.snapshot()` builds the
served record from an EXPLICIT WHITELIST, so every field could decode, merge and be held
correctly and still never reach the console. Same shape that lost `speeds` out of a mission
load. Enumerated once in `Registry.STATIC_KEYS` now, and the suite reads THAT list.

**⚠ MAGICPORT CANNOT BE USED, AND THAT IS A LICENSING ANSWER NOT A TECHNICAL ONE.** They
publish no API, and their terms forbid exactly what this would need: *"Access, monitor,
reproduce... including... the use of any robot, spider, scraper or other device, program,
tool, algorithm, code, process or methodology... without our express written permission."*
So nothing is wired to them. **TONNAGE IS THE ONE FIELD AIS GENUINELY DOES NOT CARRY** — no
message has GT or DWT, it is a registry fact — so `gt`/`dwt`/`built`/`flag` are in
STATIC_KEYS, carried when a source supplies them, and absent until Andy licenses one.

**CPA / TCPA, in a new `static/js/targets.js`.** *"Recalculate after a manoeuvre"* is free
here and deliberately so: `cpa()` is a PURE function of the present kinematics, so there is
no cached value to go stale and no manoeuvre detector to miss one. A contact drawing away
reports a NEGATIVE tcpa rather than having its past closest approach shown as if ahead; two
vessels holding station get a range and no time rather than an enormous one divided out of
jitter.

**⚠⚠ THE MATHS WAS RIGHT AND THE READOUT WAS NOT — TWICE, AND NEITHER IS VISIBLE FROM THE
MODULE'S OWN NUMBERS:** `aisCpa` read `asv.sog`/`asv.cog`, **which do not exist** (the boat's
track is `S.status.sog_kn` / `cog_deg`), so every CPA was null and the row silently never
rendered — which on a collision readout reads as *nothing is closing*. And `cpaText` called
`fmtDist(cpaM/1000)` when **fmtDist takes METRES**, so a **434 m** closest approach displayed
as **"0 m"**. Both found by reading the live tip against the computed values, not by any
unit check.

**The icon is drawn to TRUE HULL SIZE** while the hull is bigger on screen than the glyph,
and anchored on the **GNSS antenna** rather than centred — AIS gives A forward / B aft / C
port / D starboard, and on a 295 m ship with the bridge aft, centring puts the stem 77 m
from where it is. Below the crossover it falls back to the glyph, because a 300 m ship at
40 m/px is seven pixels and drawing that to scale hides more than it shows.

**CPA IS A SORTABLE COLUMN ON THE TRAFFIC TABLE** (his follow-up). Every header sorts;
range stays the default because that is what the card has always opened as.

**⚠ SORTING BY CPA IS NOT SORTING BY A NUMBER, AND THAT IS THE WHOLE DESIGN.** A contact
that passed 10 m astern a minute ago has a SMALLER closest approach than a ship closing to
400 m, so a plain ascending sort puts the one that is leaving at the head of a
collision-ordered list. The order is by STATE first — closing, then holding station, then
opening, then no track — and by distance only within a state; **the state rank is not
reversed when the column is**, because "sort descending" must never promote a vessel that
is drawing away. Ties inside "closing" break by TCPA. The cell marks an opening contact
with an arrow so its number cannot be misread, and the row's tip carries the time, the hull
and the destination.

**⚠ A MUTATION FOUND NOTHING TO KILL, AND THAT WAS THE FINDING.** Breaking `nullLast` so an
absent value sorts FIRST left every check green: in the CPA column a no-track contact is
caught by `cpaRank` before nullLast is consulted, so the null handling that governs the brg
and kn columns was never exercised. Check 17c covers it now. **⚠⚠ AND THE RUN THAT FOUND IT
FIRST REPORTED "SURVIVED", WRONGLY** — the mutation runner's own scraper was
`FAIL (\d+b?)\.`, which cannot match `FAIL 17c.`. The check was failing correctly and the
harness could not see it. A runner that cannot parse its own suite's check IDs reports
false survivals, and that sends you hunting for a hole in code that does not have one.

**PREVIOUS: the approach stops detouring, and a refused turn no longer inverts

**NEWEST (this commit): TWO THINGS ANDY SAW ON ONE ERIE SCREENSHOT, AND BOTH DIAGNOSES CAME
OUT DIFFERENT FROM THE REPORT.**

> *"1. The route taken from home to the first point of the survey pattern is wildly
> circuitous. Through the narrow channel the ASV should stay right and then aim right at the
> beginning of the survey. 2. The turn away from threat functionality is working, but the
> turns are implemented as inverted teardrop turns. Consider a more direct, curvilinear
> format for this implementation."*

**(1) THE LANE GEOMETRY WAS NEVER WRONG — THE CAPTURE RADIUS WAS.** Reproduced at Erie: home
to the first survey line is **681 m and the router returns it as ONE waypoint**, so the
straight run is already clear of everything. The lane turned that into **20 waypoints and
829 m**. The buoyed channel has a 150 m half-width and the capture test was `hw * 2.5` =
**375 m, i.e. 225 m BEYOND the buoy line**. Sampled along the straight run, **only 7 of 21
points are actually inside the channel** — it leaves the buoys a third of the way along and
ends 129 m outside them — yet **21 of 21 were captured**, so a leg that had left the channel
was pinned to its starboard edge for its whole length and then cut back across. Capture is
`hw + LANE_CAPTURE_STANDOFF_M(buf)` now: a standoff from the BUOYS, not a multiple of the
water. The splice already hands the rest of the leg back to the routed path, which is "stay
right, THEN aim at the survey" exactly. **681 m straight, 743 m laned (was 829).**

**⚠ AND IT LOOKED LIKE A COLREGS VIOLATION ON THE WAY THERE, WHICH IT IS NOT.** Measured
against the centreline's own direction every sample read **"port"** — the wrong side for
Rule 9. But a buoyed centreline runs in the direction of BUOYAGE and that transit was
outbound against it; measured against the DIRECTION OF TRAVEL it is 75 m to **starboard**, at
exactly `LANE_FRAC` of the half-width. Correct all along. A sign convention nearly became a
reported safety defect — check the frame before writing the finding.

**(2) THEY ARE NOT TEARDROPS — THEY ARE INBOARD SEMICIRCLES, AND THE RADIUS EXPLAINS THEM.**
`teardropTurn` sweeps an arc of **half the line offset** whenever the hull can hold it. A
Z-Boat at survey speed holds **2.06 m**; at 31.5 m spacing it was flown round a **15.75 m**
half-circle, seven times wider than it needs. That arc must bulge somewhere, it needs 15.75 m
of clear water past the line end to bulge outboard, and where a wharf takes that water away
the only rung left was **the same arc swept the other way: back across 33 m of just-surveyed
water.** That is the shape on his chart.

**THE FIX IS A RACETRACK RUNG** — two quarter-circles at the hull's own radius joined by a
straight. **33.8 m against 49.5 m (32% shorter), and it reaches `minR` past the line end AT
ANY SPACING** instead of half the spacing: 2.06 m instead of 15.75 m, so a turn that had to
invert for want of 15 m of water now asks for 2 m and stays outboard, away from the feature.
Ladder: outboard arc → outboard racetrack → slow racetrack → inboard arc → slow inboard.
**⚠ RUNG 1 IS DELIBERATELY UNCHANGED** (check 8 holds it) — the gentle half-circle is what
every unobstructed turn in every existing plan flies, it is kinder to a towed body, and
nobody complained about those; only what happens AFTER a refusal changed. **⚠ AND THE
INBOARD RUNGS STAY** (check 10): they are the wharf rung, and refusing is what put the boat
on the pier.

**⚠ A REAL DEFECT THE NEW SHAPE EXPOSED: THE ARC STEP.** `arcStepFor` floors at 3 m and ASV
passes a flat 3 m — ample on a 15.75 m semicircle, useless on a **3.2 m** quarter-arc at
R = 2.06 m, which it resolves with ONE chord. Measured: the vessel rolled out **11° off** the
next line. The step is a fraction of R now (5.6° at every spacing, better than the shipped
semicircle's 15° at tight spacing).

**⚠ AND TWO HOLES MUTATION FOUND IN MY OWN NEW CHECKS.** Centring both arc centres on the
midpoint gives a shape that **does not start at the line end** — a teleport with an arc drawn
after it — and checks 1-5 all stayed GREEN, because every one measures the path's EXTENT and
none measured where it is ANCHORED (check 1b exists because of that run). And buoy_lane's
check 30 first used the 50 m-half fixture channel, where the old capture rule (125 m) and the
new one (110 m) barely differ, so reverting the defect changed nothing the check could see;
it needs the wide channel the bug was reported on. Ten mutations, all as predicted once the
predictions were corrected by what the runs printed.

**⚠ ALSO FIXED IN PASSING, IN THE HOOK ITSELF:** the `rule9_scope` advice line carried
backticked text inside a double-quoted `echo`, i.e. **command substitution** — firing that
advice would have executed it and left a stray file named `1` in the repo.

**PREVIOUS: a punched run can be struck off by hand, and the transits rebuild around the gap

**NEWEST (this commit): SELECT A PUNCHED SURVEY RUN AND DELETE IT.** Andy: *"The WorldView
application has the ability to select and delete punched out survey lines and recalculate
interline transits. Implement this ability in ASV Console."*

Click a run on a punched plan (it highlights amber), press **Delete**. Escape or open water
deselects. `Put them back` on the SURV card restores. Ported from WorldView's `SurveyPlan`,
which got there the expensive way — its first build was reported as breaking the
application and reverted undiagnosed — so this carries the three fixes that came out of
diagnosing that, plus two defects of ASV's own that the port walked straight into.

**⚠ MIDPOINTS, NOT INDICES.** Runs are rebuilt from the corners and the chart on every
change, so an index names a different line the moment anything moves. A midpoint names the
RUN and stops naming anything when that run ceases to exist — which is what makes a stale
strike harmless instead of destructive. It survives `shortenSeg` (a symmetric lerp:
`t0 = m/d`, `t1 = 1 - m/d`, so the shortened midpoint IS the parent's — measured, 0.000000 m
drift) and `regionOrder` (orders and re-orients, never splits). So the green segment the
operator clicks and the clipped run the filter matches are the same thing.

**⚠ THE FILTER SITS AFTER THE CHART CLIP AND BEFORE THE ORDERING, AND BOTH HALVES MATTER.**
Above the clip is what got WorldView's build reverted: one pattern line becomes several
clipped runs, so striking a short stub took the 900 m run on the far side of an island with
it. Below the ordering would be wrong the other way — the serpentine would stay numbered
through a line that is not there.

**⚠ THE REBUILD IS COALESCED, AND THAT IS CORRECTNESS, NOT POLISH.** `punchOut` opens with
`if(punchBusy) return;` — a strike arriving during a rebuild would be DROPPED, leaving the
plan on screen disagreeing with the strike list behind it. Everything now goes through
`punchNow()`, which CHAINS. **Measured live: three strikes in a burst → ONE punch.** And
`commitPattern` is async and awaits `flushRepunch()`, because 400 ms is longer than it takes
to press Delete then Add to plan: verified by doing exactly that with no pause, and a
16-run plan committed as **15**.

**⚠ THE RE-PUNCH WAS 10–15 SECONDS OF FROZEN TAB, AND STILL IS ON A COLD ONE.** Measured on
a 10-line plan over New Castle (1,318 zones), chart already cached: **15,978 ms total, the
main thread blocked solid for 14.7 s of it** (one interval sample fired in the whole
period). Phases: `clipLine` **4,354 ms**, the turn/transit loop **3,326 ms**, `regionOrder`
821 ms, `buildKeepouts` 37 ms. That is pre-existing — pressing Punch Out has always cost
this — but a Delete key that costs it is the "unusable" verdict WorldView got.
**`clipLine` is now MEMOISED and a re-punch is 686 ms.** The memo is SOUND where
WorldView's attempted router memo was not: `clipped` is computed BEFORE the strike filter,
so it cannot see the strike list and cannot be invalidated by one. Keyed on
`patStrikeKey()` — the same key that decides whether a strike is still valid, because both
answer "would the clip come out differently?", and two keys would be two chances to forget
an input. The routed transits below it re-solve every time, on purpose.

**⚠ TWO ASV DEFECTS THE PORT WALKED INTO, BOTH PRE-EXISTING:**

1. **A GAP LEFT A SILENT 180 NO HULL CAN TRACK.** The reversal gate was
   `spacing*1.6 + 3`. Take a line out — struck, clipped by the chart, or under
   `MIN_SURVEY_LINE_M` — and the survivors are TWO spacings apart, so the pair fell
   through: `nNoTurn` was never incremented (it only counts inside the branch the pair
   never entered), and the run fell to the straight-leg fallback. No turn, no count, no
   banner. Now `GAP_LINES = 4`, `gapSpan = 4.6`, with `turnMaxHalf` sized off the same
   figure so the "is this a reversal pair" judgement is made once. **It fires on ordinary
   punches too** — the very first test plan reported *"1 reversal(s) swing across a gap
   where a line is missing"* with 12 lines dropped by the hull minimum and no strike
   involved.
2. **A STRAY CLICK IN SURVEY MODE THREW THE PUNCH AWAY.** With A, B and C all placed the
   branch assigned nothing and still ran `patClip=null` — any click discarded a punch that
   had just cost an ENC extract and a full re-solve. Guarded on `placed` now. Found only
   because the selection gesture wanted the same click, and the punch would have lost.

**⚠⚠ AND THE ONE NO UNIT CHECK COULD SEE: THE HIGHLIGHT WAS INVISIBLE.** The first cut drew
the amber halo at 5 px under the 2.5 px coverage stroke. **Counted on the live canvas,
selecting a run changed ONE PIXEL** — while every check passed and the card read *"Selected:
a 819 m run. Press Delete to strike it off."* For a gesture whose entire safety argument is
"you see which run is going before it goes", that is the feature missing, not a cosmetic
flaw. 9 px halo plus end caps now (a short run's halo is a short run's halo); **measured
again: 1,621 amber pixels.** See [[verify-the-ink-not-the-box]].

**`tests/strike_run.js` — 25 checks, 17 mutations, all as predicted.** ⚠ Two of its own
checks were written wrong and mutation found both: 16 read `/nGapTurn\+\+/` and 18 read the
POSITION of a call, so changing the guard to `if(false)` left both texts in place and both
checks green while neither line could run. **A bare fragment tests the source, not the
behaviour** — both pin the guard now.

**PREVIOUS: THE EXTRACT STOPPED BEING A LIST OF CLASSES AND BECAME THE WHOLE
CHART.** Andy: *"add obstruction_line, bridge structure and cardinal buoys. download all
layers when entering a new area. review database and download all layers now for all sites."*

**⚠ THE POINT OF DOWNLOADING EVERYTHING IS THAT A CACHE CANNOT KNOW WHAT IT DOES NOT
CONTAIN.** Fetching only the classes the roles happened to name meant a role added later was
invisible to every area already cached — which had just happened twice in one session
(`fairway` shipped without a cache bump; `Restricted_Area` never resolved at all). The
extract now fetches **every layer the band publishes**: the named classes role-tagged as
before, and everything else carried as `extra`. Classifying a new class is now a decision
about data already on disk instead of a refetch of every operating area. `features_v5_`, and
**v5 should be the last bump made for a role added** — that is what it buys.

**THE THREE GAPS FROM THE AUDIT ARE CLOSED**, each previously fetched by nothing:
`Obstruction_line` (a submerged barrier or a line of piles charted as ONE object — the point
and area forms were fetched, the line was not), bridge structure, and `Buoy_Cardinal_point`.

**⚠ THE BRIDGE SPLITS IN TWO AND THE SPLIT IS THE WHOLE POINT.** The **supports** are a hard
obstruction at the waterline and are enforced like a pier. The **span** is OVERHEAD: a
`Bridge_area` covers the water it crosses, so enforcing it would refuse passage under every
bridge on the chart — New Castle NH alone charts 35 of them — and it would refuse
*plausibly*, naming a real charted object, so nobody would call it a bug. `bridge_span` is
fetched to draw and is deliberately not a keep-out role. **A cardinal buoy is a
`hazard_point`, NOT a `chan_mark`**: it carries no CATLAM, so filing it with the lateral
marks would feed it to the pairing that builds the Rule 9 centreline and invent a fairway
out of a warning.

**⚠ AND A BUG I WROTE IN THE SAME HOUR, WORTH KEEPING: `bridge` WAS IN TWO DISPATCH
BRANCHES.** `buildKeepouts` is an if/else chain on GEOMETRY — `isLand` draws rings,
`isShore` draws paths, `isHaz` draws points, first match wins. Putting `bridge` in both
`isLand` and `isHaz` is not belt-and-braces: the ring branch always takes it, and a pylon
charted as a POINT yields no rings and is **dropped on the floor** — no error, no count, no
gap. Fixed at the source: the pylon POINT class lives in `hazard_point`, the pylon AREA in
`bridge`.

**⚠⚠ AND THE CHECK I WROTE TO CATCH THAT BUG DID NOT CATCH IT — MUTATION FOUND THAT, NOT
READING.** The first `enc_roles.js` check 8 fed poly+line+point under each role and required
output in exactly one bucket. Crossing `bridge` into two branches **survived it**, because
the crossed role still emits its ring; what it loses is the point, and *a bucket count cannot
see a feature that was never emitted*. The check is inverted now: every class carries its
geometry in its name (`Obstruction_line`, `Wreck_point`, `Bridge_area`), so for each keep-out
role, feed one feature of each form **the server actually requests** and require it to arrive
somewhere. That version goes red the instant the pylon point moves back. Two more holes came
out of the same battery: `roleOf` returned the FIRST matching role, so a class named under
two roles passed silently (now `rolesOf`, plus check 14b — one class, one role); and check 15
read the role table with a line-anchored regex while check 8 did not, so a role declared on a
shared line was invisible to the one check that exists to report an undecided role.

**ONE MUTATION IS INERT AND IS RECORDED AS INERT, WHICH IS WORTH MORE THAN A KILL:** adding
`bridge` to `isHaz` today changes nothing and no check fails, because the `bridge` role
requests only `_area` classes. Crossing a role into two branches is only a defect once the
role also requests a geometry the winning branch cannot draw — which is exactly the pairing
check 8 tests. Claiming a catch there would be claiming teeth the file does not have.

**ALL SEVEN OPERATING PORTS ARE WARMED**, via the new `tools/warm_enc.py` (`--list`
inventories, `--base <id>` does one, `--prune` deletes superseded-version caches and **asks
first**). Every site came back `enc_harbour` in 17–29 s. New Castle NH 5,672 features
(4 `hazard_line`, 35 `bridge_span`, 26 `restricted`); Port of LA 5,396 (the only site with
charted pylon AREAS, 4); Portland ME 3,959; Eastport ME 3,609 (15 `hazard_line`); Erie PA
3,493; Pago Pago 1,280; Lewes DE 1,099. **It reports PER ROLE, not just a total**, and that
is the whole design: ENCDirect reports failure as a normal-looking EMPTY layer, so a bare
count cannot tell a quiet harbour from a fetch that half-failed — a coastal extract with
soundings but no shoreline is flagged, not reported as open water.

**THE SUPERSEDED CACHES ARE PRUNED (2026-09-01, on his instruction).** 124 files, 617 MB,
v2/v3/v4 gone; `charts/enc/` is 15 v5 extracts and 164 MB, and all 8 ports re-served from
cache in 0.2–2.6 s afterwards.

**⚠ AND THE PRUNE ANNOUNCED 122 AND DELETED 124, WHICH IS THE SECOND PREDICATE MISMATCH
IN THAT ONE TOOL.** The count required a `.json` suffix; the delete matched any
`features_v*`. The two extra were orphaned `.json.part` writes from interrupted fetches at
dead versions — nothing was lost, and removing them was right — but a confirmation prompt
whose number is not the number that goes is theatre. (The first mismatch compared a bare
tag against a whole prefix and put the LIVE cache on the delete list.) There is now ONE
enumeration: `main` prints `len(prune_targets(...))` and deletes that same list, so they
cannot disagree. **⚠ AND THE CHECK TOOK THREE GOES TO WRITE:** the first compared
`inventory` against `cached_files` — one built from the other, so they agreed by
construction and two mutations of the real defect walked through; the fixture then had no
file the strict predicate rejects, so it still could not see the divergence. It needed a
`features_v3_z.json.bak`. enc_extract 11d/11e.

**PREVIOUS: THE ENC EXTRACT WAS AUDITED AGAINST WHAT THE SERVICE PUBLISHES, AND
THREE CLASSES WERE NOT BEING FETCHED AT ALL.** Andy: *"confirm ENC downloads include all
layers available for use in this application."* The answer was no, and one of the three was
mine from an hour earlier.

**⚠ AN UNRESOLVED CLASS IS SILENTLY SKIPPED.** The fetch builds its job list with
`if cls in lm` — a class ENCDirect does not publish under that exact name is dropped with no
error, no warning and no gap in the result. Everything downstream then reports success:

1. **`Restricted_Area` was never the published name** — it is `Restricted_Area_area`, with
   the geometry suffix the rest carry. Wrong from the day the role was added, so it fetched
   **nothing, ever**: zero restricted features across 110 real cached extracts, while the
   operator's *"Dredged / restricted"* checkbox said it was enforcing both halves.
2. **`Pontoon_line` is published by no band at all.** PONTON is a real S-57 class; this
   service does not serve it under that name. Removed — a requested class that cannot
   resolve is worse than none, because it reads like coverage.
3. **THE FAIRWAY ROLE SHIPPED WITHOUT A CACHE BUMP, which is mine.** `fetch_enc_features`
   keys its cache `features_v3_<bbox>`, and the comment there says outright that adding a
   role means bumping it. I added `fairway` and did not. **110 cached v3 extracts covered
   every operating area in use**, every one would have served happily, and not one contained
   a fairway feature — so Rule 9 would never have applied anywhere the console had already
   been, and nothing would have said so. **A cache does not know what it does not contain.**
   Now `features_v4_`.

**`tests/enc_extract.py` checks 9 / 9b / 10** close it: every declared class must resolve
against the service's OWN cached layer map, in the harbour and approach bands a survey ASV
works in (coastal and general legitimately omit harbour furniture). Check 9 found
`Pontoon_line` the moment it ran. A missing layer map is a stated FAILURE, not a skip — a
coverage check that quietly reports nothing is the fault it exists to catch. And the suite
now reads the cache version FROM the source rather than restating it: it had `features_v3_`
hard-coded, so my bump made five of its checks fail for a reason unrelated to what they test.

**WHAT IS PUBLISHED AND STILL UNUSED** — this paragraph said *"203 layers in the harbour
band, 39 requested"* and listed the gaps worth a decision. **That framing is gone: all 203
are fetched now**, 45 role-tagged and the rest as `extra`. The three named gaps
(`Obstruction_line`, bridge structure, `Buoy_Cardinal_point`) are classified above; the
others it listed — `Offshore_Platform_*`, `Anchorage_Area`, `Caution_Area`,
`Dumping_Ground_area` — are **on disk in every warmed area as `extra`**, waiting on a
decision rather than on a download. The routeing layers (TSS, deep-water route, recommended
track, two-way and ferry routes) are Rule 10 and later rules and remain deliberately
unclassified — but they too are now cached, so adopting them costs a role, not a refetch.

**PREVIOUS: COLREGS RULE 9 WAS BEING APPLIED WHERE IT DOES NOT APPLY.** Andy:

> *"Rule 9 is being improperly applied in the current ASV Console implementation. It applies
> only within narrow channels. ... In open bay or open ocean transits and while running
> various survey patterns the rule should not be considered. There are other rules that
> should apply which we'll deal with later."*

**⚠ THE GEOMETRY WAS NEVER THE PROBLEM - THE SCOPE WAS.** The lane itself (quarter-width to
starboard of the centreline, the six invariants that each cost a live failure) is untouched.
Two gates in front of it were wrong:

1. **THERE WAS NO WIDTH TEST AT ALL.** `narrowChannelLane` marched perpendicular and called
   the water a channel if anything answered within `max(120, buffer*30)` on **both** sides -
   150 m at the shipped buffer, so **300 m of open bay was "a narrow channel"**, got a
   keep-right lane, and the card told the operator it was complying with a rule of the road.
2. **`routePlan` laned every ROUTED DETOUR** (`leg.length>1`), which is as true between two
   coverage lines as anywhere else - so survey patterns were laned. The comment beside it
   admitted the ambiguity it could not resolve (*"at Upload we can't tell a survey coverage
   line from a plain hop"*) and resolved it toward APPLYING a rule of the road.

**A NARROW CHANNEL IS A CHARTED OBJECT, AND S-57 NAMES IT** - Andy supplied the classes:
**FAIRWY** (`Fairway_area`, the designated lane for larger vessels - what Rule 9 is written
about) and **DRGARE** (`Dredged_Area`, a maintained depth, which is Rule 9(b)'s own test: a
vessel "which can safely navigate only within"). `Fairway_area` is now fetched and
`channelPolys` reads both. The gate is **charted channel OR genuinely narrow**
(`NARROW_MAX_M`, 150 m edge to edge) - because Rule 9 does not require a channel to be
charted, and a 100 m cut between two banks is a narrow channel whether or not an ENC draws a
fairway over it. The march no longer decides *whether* there is a channel; it measures the
edges of one already declared.

**NOT Rule 9, deliberately: TCTSBL / `Traffic_Separation_*` is RULE 10**, and RECTRC /
`Recommended_Track` is neither a narrow channel nor a fairway. Andy: *"other rules ... which
we'll deal with later."*

**AND ONLY A TRANSIT GETS THE LANE.** Go-To, RTH, a drawn transit, and the approach out to a
pattern. Never the pattern: punchOut's inter-line hops and the search pattern's now pass
`{lane:false}`. **⚠ `lane:false` SKIPS THE OFFSET, NOT THE PIPELINE** - `smoothTrack`,
`gateLegClear` (a per-leg keep-out RE-CHECK) and `pruneStitch` are not Rule 9 and a pattern
needs all three, so dropping the call to drop the lane would have traded a safety check for
a legal correction.

**RULE 9(b) BINDS UNCONDITIONALLY HERE**: every shipped hull is under 20 m (DriX 7.71,
Z-Boat 1.9, example 4.0 - `hull.loa_m`), so the not-impede duty is never a case to test for.
Both of its actions were already implemented: keeping to the starboard outer limit is the
lane, and not obstructing by crossing is `channelSpanKeepouts`, which clips a survey line
that SPANS a channel while leaving one contained within it alone.

**`tests/rule9_scope.js` - 20 checks, FOURTEEN MUTATIONS**, graded across this suite plus
`buoy_lane` and `turn_channel`. **Three of its own first-draft checks were broken and the
mutations found all three**: a guard in `buildKeepouts` that was DEAD (removing it changed
nothing - the comment gave a false reason for a line that did nothing; deleted); check 3
running with area enforcement OFF only, which masked the tidy-looking edit that would turn a
fairway into a no-go the moment the operator ticks "Dredged / restricted"; and check 9
reading `length_m`, which no vessel file has, so `L == null || L < 20` could not fail. The
length was there all along as `hull.loa_m`.

**PREVIOUS: one speed became three.**

**THE SPEEDS ARE ON THE INTENT CARD, AND THE TRANSIT CASES ARE
NAMED.** Andy: *"Add speed values to the intent card. Transit speed applies to goto, rth,
and transits to the beginning of a survey and after the survey to home."*

The card carries three rows now, because one number answers none of the questions once
there are three speeds:

```
speed     6.8 kn · told survey (7.0)                     actual, then commanded
for       SURVEY — on coverage line 7 of 22              which ROLE, and why
speeds    transit high 14.0 · turn low 4.0 · survey 7.0  the three, live one in bold
```

The middle row earns its place: 14 kn in the middle of a survey reads as *TRANSIT —
approach to the survey area* rather than as a fault. When the clearance guard has the
throttle it says **SAFETY OVERRIDE** instead, because then the role is not why the boat is
slow and naming the role would mislead.

**⚠ AND THE FOUR NAMED CASES MADE speedRole() WRONG, WHICH IS WHY IT NOW ASKS
currentActivity().** It read `runLineIdx` and `curTurn` directly. Those give the same answer
everywhere except one place: **`curTurn` survives a run stopped mid-reversal**, so the
Return-to-Home that follows — Andy's *"after the survey to home"* — would have been flown at
the TURN speed the whole way home. `currentActivity()` has always got this right because it
asks what the BEHAVIOUR is before it looks at either variable, so the role is its output
now. One classifier, one answer, one place; `speedRole()` is a single line. Check 16 pins
it, and the "re-derive the role" mutation is caught by that check and by **nothing else**.
A search pattern takes the SURVEY speed, following the same classifier, which has always
called it surveying.

**⚠ AND A REAL DATA-LOSS BUG, FOUND BY READING THE CARD IN A RUNNING CONSOLE.** `loadMission`
rebuilds `mission` from an EXPLICIT WHITELIST of fields, and `speeds` was not in it — so it
was dropped on every load and the migration refilled all three roles from `mission.speed`,
which is *not the operator's setting* but the last value the governor commanded. A mission
holding `{transit:high, turn:low, survey:survey}` came back as `{high, high, high}` the
moment the boat had been told "high" once, and the next save wrote that over the real
setting. **Every unit check passed throughout** — they drive `mission` directly and none of
them goes through that rebuild. It was visible only as the card's own speeds row reading
three identical values when the file on disk said otherwise. Checks 18/18b.

**PREVIOUS: SPEED BY ROLE.** Andy: *"Vessel speed should be selectable for
various modes. Allow separate speed selection for transits, turns, and survey. These values
may be temporarily over-ridden for safety of vessel situations. Remove the old speed
selection function from the chart bar and implement in the survey card."*

A survey run is **three jobs** and they do not want one speed. Coverage wants the speed the
sensor is specified at; the reversals want a speed whose radius the hull can hold; the
transits want whatever wastes least time. `mission.speeds = {transit, turn, survey}`, three
selects in the SURV card, and the old `#c_speed` is gone from the command bar.

**THE CONSOLE GOVERNS WHICH ONE IS LIVE.** `speedGovernor()` runs every telemetry frame and
commands the speed the current job wants. Four rules, each pinned by a check:
* **The role is NOT re-derived** — it comes off `runLineIdx` and `curTurn`, the same two
  variables `accumLineTime` maintains and `currentActivity` reads. A second classifier would
  drift from the one that bills the time, and then the speed the boat runs and the activity
  the recorder logs would describe different moments.
* **Safety outranks the role.** While the clearance guard holds the boat slow the governor
  stands off entirely — it does not re-assert underneath it, which would be two things
  fighting over the throttle at 4 Hz. The guard's hand-back goes to the ROLE's speed, not to
  a remembered one: by the time the boat is clear it may be doing a different job.
* **It sends only on change**, and only under autonomous command (running, armed, no E-STOP,
  not holding). **It slows and it NEVER steers.**
* **A turn the planner could only fit at the SLOW radius is flown at the slow speed** — the
  per-gap `turnSlowAt` flag from the wharf fix. The radius that made it fit is the radius the
  hull holds at that speed.

**⚠ `speeds` IS THE OPERATOR'S SETTING; `speed` BESIDE IT IS WHAT THE BOAT IS COMMANDED NOW.**
Two fields on purpose. The governor changes the commanded value several times a minute and
`Engine.set_speed` persists it; folding that back into the setting would eat the operator's
choice every line. Exactly the completion-field lesson, one field over — and `set_speed`'s
docstring, which used to claim the plan speed was one concept, now says so.

**⚠ AND THE TURN RADIUS IS DERIVED FROM THE TURN SPEED.** This is a safety change, not a
convenience: a hull holds v/ω, so the radius every generated reversal is BUILT at must be
the speed it is FLOWN at. A slower turn is tighter and reaches less far outboard — the
clearance the wharf incident was short of. Every planning figure moved to the role that
governs it: per-line times at the survey speed, approach estimates at the transit speed,
both turn-radius checks at the turn speed.

**MIGRATION IS A NO-OP, deliberately.** A mission with only the legacy `speed` starts all
three roles there, client and server (`_norm_speeds`), so nobody's boat changes speed
because they pulled a build. The card says so out loud while they are equal.

**⚠ AN EXISTING CHECK CAUGHT A DEFECT I INTRODUCED IN THE SAME RUN.** `recalcCommittedForSpeed`
raises a banner and a later branch clears it — identified by the prefix `"Speed "`, written
as a literal in BOTH places. Renaming the banner to "Turn speed" (the radius comes from the
turn role now) left the clear branch matching a prefix nothing produced, so a warning raised
by speeding up could never be cleared by slowing back down. `speed_recalc` check 5b went red.
It is `SPEED_WARN_PREFIX`, one constant, now.

**`tests/speed_modes.js` — 20 checks, FOURTEEN MUTATIONS.** Two survived the first pass and
both were fixtures that could not discriminate: check 5 drove a world whose turn speed was
already `low`, so a governor ignoring the slow-turn flag still produced `low`; and check 11b
asserted ONE approach estimate where there are two (drawn and committed), so a mutation
changing the first left the second matching. **Verified live:** a Go-To with transit set to
`high` commanded `high` and the boat ran 13.78 kn while `mission.speed` still read `survey`,
and the operator's three settings were intact afterwards.

**PREVIOUS: the buffer is enforced on the boat, not only on the plan.**

**⇒ ANDY'S RULING, 2026-08-31: THIS IS THE ONLY ACTIVE PROJECT.** *"stop updating other
projects. We concentrate only on ASV Console moving forward. There may be components of
other projects that we pull over."*

So the estate flow is **ONE WAY** from here: asv_core, WorldView, Zboat and Transit are
places to pull FROM, never places this repo writes back to. Two consequences that will bite
somebody otherwise:

* **`static/js/core_turns.js` and `static/js/keepouts.js` ARE THIS REPO'S FILES NOW**, and
  both carry local safety changes asv_core does not have. Their vendor headers still say
  *"DO NOT EDIT THIS COPY"* and name `tools/vendor.py` — that instruction is now WRONG
  here, and running it from the asv_core repo would **silently delete the fix behind
  `tests/clearance_guard.js`**. Each file now opens with a loud ASV-OWNS-THIS note saying
  exactly that; a `--check` over there reporting them DRIFTED is correct and expected.
* **Don't "tidy up" by syncing them back.** If a change is wanted upstream, that is its own
  deliberate piece of work in that repo, not a sync in this direction.

**A DriX PASSED A WHARF AT 0.6 m WITH A 5 m BUFFER SET, AND NOTHING REACTED.** Andy, with a screenshot of the recorded track:

> *"This image shows a path line intersecting a pier without any reaction from the system.
> This is very bad. During this sort of maneuver and when extreme close range is an issue,
> the turn should be AWAY from the shoreline or dock or other feature rather than through
> it. Speed MAY be modified temporarily to slow and reduce impact damage if a turn will not
> resolve. This may be a buffer related situation improperly set by the user in the GUI but
> the 5m setting in the recent instance seems to have been ignored."*

**⚠ THE BUFFER WAS NOT IGNORED. IT WAS NEVER APPLIED TO THE VEHICLE.** Measured off the
screenshot (Pago Pago, DriX H-8, z18 = 0.5787 m/px):

| | closest approach to the pier |
|---|---|
| the commanded ROUTE | 24.8 px = **14.3 m** |
| the recorded TRACK | 1.0 px = **0.6 m** |

The planner honoured the buffer and there was nothing downstream of it. **Every keep-out
check this console had — Go-To, RTH, transit, punch-out, upload — is a PLAN-TIME check**
(all six `setViolations` call sites). Once a plan was running nothing compared where the
boat actually was with the model.

**AND THE REASON THE BOAT WAS THERE IS THE SECOND MEASUREMENT FROM THE SAME IMAGE.** Route
waypoints at the two ends of the same block: **west 26** (a full teardrop), **east, beside
the pier, 4** — the two line ends and nothing between them. `teardropTurn` refused, and
punchOut's fallback for a refused reversal was a STRAIGHT leg between the line ends, which
`legSafe` passes because the straight line genuinely is clear. What shipped was a 180° in
~26 m the hull cannot track. The boat then looped on its own, uncommanded, OUTBOARD — into
the very feature that refused the turn. **Refusing the turn is what put the boat on the
pier: it removed the only geometry that was steering it away.** The old code's own comment
said as much — *"clear of nogo, but a 180 the boat cannot track"* — and shipped it anyway.

**THE FIX IS IN THREE PLACES.**

1. **`core_turns.js` gained `side`, and this console gained `turnWithRetry` (the ladder).**
   A semicircle traces the same circle either way round; the sweep only decides which side
   of the E–F chord it bulges, and only the outboard one was ever tried. The ladder is
   outboard → **inboard** → both again at the **slow radius**, and it is exactly Andy's two
   levers.
2. **A refused reversal is now UNSAFE, not shipped.** Once every rung has refused, the
   console knows the water for that loop is foul on every side and at every radius it can
   fly. Flagged red like any other unroutable leg, so Upload blocks.
3. **`clearanceM` + the runtime guard.** The boat's live distance to the keep-out model,
   built from `blocked`'s own three primitives so the number the operator watches cannot
   disagree with the rule the route was cleared against. On the Intent card beside off
   track; alarms inside the buffer naming the feature; and **commands the low speed when
   inside AND closing**, handing it back at 1.5× the buffer.

**⚠ THE CONSOLE SLOWS. IT NEVER STEERS.** Slowing cuts the energy of a contact and buys
turning room without fighting the RC transmitter, which is master here and is the true
failsafe. Check 16 asserts the guard's only command is a speed; check 14 asserts it commands
nothing at all unless the boat is running, armed, not E-STOPped and not holding.

**⚠ AND "SLOW DOWN AND IT WILL FIT" IS NOT TRUE IN GENERAL — the test is what established
that.** `teardropTurn` takes the SEMICIRCLE branch when half the line offset already clears
the hull's radius, and that semicircle's radius is `half`, set by the SPACING and not the
speed. On a wide-spaced plan (the Pago Pago geometry: half 13 m, minR 10 m) the slow rungs
fly the identical arc and refuse identically. Widening the spacing is the lever there. Check
10b pins this so nobody offers the wrong advisory, and 10a pins that `side` is inert on a
teardrop — its loop side is fixed by which side the next line is on.

**`tests/clearance_guard.js` — 23 checks, FIFTEEN MUTATIONS** run against a sidecar of the
page and both modules. **⚠ THE FIXTURES WERE WRONG TWICE AND THE SUITE CAUGHT ITSELF BOTH
TIMES.** `bbOf` returns `{x0,y0,x1,y1}`; the obvious guess is `{w,e,s,n}`, and with the wrong
keys `inBB` rejected every feature — so `blocked` AND `clearanceM` skipped everything and
check 1, which compares them, PASSED over 2,214 points of nothing. It now asserts the sweep
actually hits something. Then the turn fixtures placed the pier by arithmetic on paper and
the arc stopped 7 m short of it; obstacles are placed from the **measured** reach now
(`reach()` flies the real turn in clear water first). One mutation survived the first pass —
deleting the Intent card's clearance row — which is why check 18 exists: a guard acting on a
quantity nobody can see is most of the way back to the defect it was written for.

**PREVIOUS: A PORT CHANGE WAS A TELEPORT WITH A ONE-LINE NOTE OVER IT.** Andy:
*"On selection of a new survey port show some more obvious and overt indication that a shift
of port is in process and move is happening. Perhaps a scaled speed slew towards the new
area."*

`center` was assigned, the next paint was a different sea, and the only evidence was a
`flashNote` the operator may well have been looking away from. Now a **MOVING BASE** card
goes up the instant they pick — before the console has been told where the new base is — and
stays up through the lookup, the slew and the chart read, clearing when the area is READY
rather than on a timer. Under it the chart **slews**: zoom out until both bases fit, cross,
zoom back in.

**THE ARC IS FORCED BY THE TILE LAYER, not chosen for looks.** `zoom` is a TILE LEVEL — it
goes in the tile key and the tile URL — so it cannot be interpolated fractionally, and a
straight pan at survey zoom across 600 km would request thousands of screens of tiles. The
zoom-out is also where **"scaled speed"** lives: the pan holds a constant SCREEN speed, so
ground speed scales with distance while total time scales with its LOG (5 km → 0.7 s, z13
untouched; 606 km → 2.7 s via z6; 14,000 km → 4.1 s via z3).

**⚠ THREE THINGS THIS WOULD HAVE GOT WRONG, AND TWO WERE ONLY FOUND BY WATCHING IT RUN.**
1. **`!slew` ALONE DID NOT HOLD BOAT-FOLLOW OFF, AND THE WHOLE FEATURE WAS A NO-OP.** The
   server respawns the sim boat at the new base *inside* the `/api/ports` request, so its
   telemetry frame can land **before the fetch promise resolves** — and at that instant
   `slew` is still null, because the slew is built from the reply. Follow moved `center` to
   the destination first; `startPortSlew` then planned a flight from the new base to the new
   base, total 0 ms, short-circuited. A perfect teleport with a card over it, and every unit
   check green. Found by **sampling the live zoom readout — it never left z13.** Closed by
   `portMoving`, set BEFORE the request, plus a departure point captured before it too.
2. **THE CHART UNDER THE CROSSING IS BLACK.** Tiles are fetched from NOAA per request on a
   cache miss, so the moment the arc passes the levels this console has ever cached it is
   flying over nothing. `drawSlewLeg()` draws the journey on the CANVAS instead — both bases
   ringed and named, the leg between them — which owes nothing to the tile cache.
3. **`measure_tool` CHECK 13 CAUGHT THE SLEW CANCEL IN THE SAME RUN.** It asserts the
   `e.button !== 0` guard is the LITERAL FIRST STATEMENT of mapEl's mousedown; the cancel was
   written above it. It belongs below, with the right-click case in the contextmenu handler
   — which must land first anyway, because every menu row acts on a coordinate captured off
   a chart that would still be moving.

**AND THE MOVE IS NOT OVER WHEN THE CHART ARRIVES: `resetForNewArea()` NEVER REFETCHED THE
KEEP-OUT MODEL.** It sets `nogo.ready = false`, which makes BOTH arms of the re-extract in
`onState()` unreachable — the first is behind the one-shot `nogoInit`, already spent, and the
second requires the `nogo.ready` just cleared. So a port change left the console at the new
base reading "nogo not loaded", planning `degraded` — *"driving DIRECT, unverified against
the chart"* — in a sea it had never read, until somebody happened to press NOGO or Punch Out.
The vessel switch has always re-extracted; this is that, for the bigger change. It extracts
around the NEW BASE (the boat's respawn arrives on a later frame) and waits out an extract
still running for the old area, because `refreshNogo()` no-ops while busy and firing into it
would leave the new base holding the old sea's keep-outs.

**`tests/port_slew.js` — 23 checks, THIRTEEN MUTATIONS run against a sidecar**, listed in its
docstring with the check numbers that actually went red. Two survived the first pass and both
were gaps in the checks: "clamp at total-1" is invisible on a long move (its last phase pins
the position to the destination regardless of progress), so check 1b flies a hop with no zoom
levels where the pan IS the ending; and the ease-in-out had no check at all, so 10b measures
it.

**VERIFIED LIVE, and the live check is what found defects 1 and 2.** Ink on the canvas during
a real crossing: **0** px of the leg's bronze before, **487–551 px throughout**, **1** after
landing. Zoom sampled at 40 ms: 13→12→11→10→9→8→7→6→5→4→**3** (held 1.4 s for the crossing)
→4→5→6→7→8→9→10→11→12→**13**. Also flown with the pane HIDDEN, where timers clamp to 1 Hz:
five frames for a four-second flight, full arc, landed exactly — which is the whole reason it
is on `setTimeout` + `Date.now()` and not `requestAnimationFrame`.

**PREVIOUS: "OFF TRACK" WAS MEASURING THE DISTANCE TO THE NEAREST SURVEY LINE.**
Andy: *"On the Intent card the 'off track' value is measure current position to the nearest
survey line. This is nonsensical. 'off track' should measure displacement from active
planned line of advance."* Then, on the one state where the old number was defensible:
*"if the ASV is on a survey line in active survey mode then it makes sense."*

`updateXTE()` took a **global minimum over every line in `mission.lines`** and published it
as `activeXTE`; the card printed that. So the subject of the reading was whichever line
happened to be closest — which is the line being flown ONLY while the boat is on coverage,
and is a line the boat has no relationship with on the approach, in a reversal, on a Go-To,
on a Transit and on an RTH. On a lawnmower plan it also **hopped to the neighbouring line at
every midpoint crossing**: the number moved because the geometry moved, not because the boat
had gone anywhere.

**THE SENSIBLE CASE FALLS OUT OF THE GENERAL RULE — IT IS NOT A SECOND BRANCH.** `offTrack()`
measures the signed perpendicular from `rr[idx-1] → rr[idx]`, the leg being flown. While the
boat runs a coverage line that leg IS the line, and `currentLegLine()` (already shipped, and
already what the LINES table highlights off) proves it by matching BOTH endpoints — so on
line it returns exactly the number Andy means, and says `of line 3`; elsewhere it says
`of leg 7→8`. **NAMING THE SUBJECT IS HALF THE FIX**: the row was a bare distance, so a
number describing a line 35 km away was indistinguishable from one describing the boat's
track. That is how this survived.

**⚠ TWO THINGS THE OLD ONE ALSO GOT WRONG, WORTH NOT REINTRODUCING.** It came out of
`Math.hypot`, so the card's `left` branch was **unreachable code — every reading in this
console's life said "right"**. And it was point-to-**segment**, which decays into
range-to-waypoint as the boat closes a leg end: a boat holding its track but carried 100 m
past the turn read 101 m off track. Off track is now the perpendicular to the infinite line
and is signed positive to starboard.

**`updateXTE` IS NOW `updateActiveLine`, AND IT PUBLISHES NO DISTANCE.** It still resolves
the nearest-line INDEX, which the chart highlight legitimately wants — that is a drawing
question. A distance re-added there is a second definition of off track waiting to be
mistaken for the first, and check 16 of the new suite forbids it.

**`tests/off_track.js` — 17 checks, and TEN MUTATIONS RUN AGAINST A SIDECAR COPY**, listed
in its docstring with the check numbers that actually went red. The wholesale
restore-the-bug mutation is caught by twelve. **Its first version was a SPLICE that left a
name undeclared, so the suite died with a ReferenceError and the crash guard "caught" it —
a non-zero exit that says nothing about whether any check encodes the rule.** It is a
whole-function swap now. **Verified live in the running console, not only in Node:** the
card was watched through `— no leg of advance yet` at index 0, `0.1 m left of leg 3→4` on a
routed approach, the sign flipping right→left as the boat crossed its track, and
`2.4 m right of line 1` once a coverage line became the active leg.

**PREVIOUS: THE AIS CONTACTS GET THE SAME GLYPH.** Andy: "green for cargo
vessels, grey for military, blue for fishing, black for tug or tug and tow and pink for
sailing." The dart-shaped AIS marker is gone; contacts are drawn by the SAME
`drawVesselGlyph` as the vessel under command, at 0.62 scale. They are boats, and a second
inline triangle would have been free to disagree about which way forward is.
**THE FIVE COLOURS ARE THE OPERATOR'S AND ARE NOT TO BE RE-TUNED FOR CONTRAST.** Two other
categories had to MOVE instead (passenger held the green cargo now owns; hsc held a pink
too close to sailing's), and check 11 forbids any two categories sharing a colour.
**⚠ THE FINDING WORTH KEEPING: A BLACK HULL ON A NEAR-BLACK CHART IS INVISIBLE, AND THE
PIXELS ARE HOW I KNEW.** `#101418` was tried first. Measured with the AIS layer toggled off
then on, its contribution was **−211 pixels** — NEGATIVE: the glyph's outline was erasing
background-coloured pixels and no hull was appearing, because the fill sat six units from
the ground colour `#0a141c`. True `#000000` measures **+23** — a real triangle. `glyphOutline`
now picks the edge from the FILL'S LUMINANCE (light edge on a dark hull), so this holds for
any colour added later rather than for black alone.
**⚠ CARGO GREEN IS THE SAME GREEN THE CHART ALREADY USES FOR HOME AND REACHED WAYPOINTS**
(`#3fbf6b`, ~830 px of it on screen before any AIS draws). Told apart by shape and place,
not colour. Andy named the colour, so it stands — but if a cargo contact is ever mistaken
for the home marker, that is the reason and moving one of the two is the fix.
**MEASURING TECHNIQUE, because the first attempt was confounded twice:** count with the
layer OFF and again with it ON and take the DIFFERENCE — a global colour count catches the
home marker, the waypoints and the background. And do it in ONE pass over the pixels; five
separate full-canvas scans wedged the renderer in a hidden pane.
`ais_table.js` 9→14, 6/6 mutations caught.


## ⇒ (previous handoff — the vessel points where it is going)

**NEWEST (this commit): THE VESSEL GLYPH.** Andy: "it will be an isosceles triangle with the
sharp end pointed toward the line of travel. Color will be the common color of the given
ASV. Yellow for the small ZBoat, Red for the DriX and yellow/black for BEN."
**LINE OF TRAVEL, NOT HEADING** — course over ground while making way, falling back to
heading below ~0.3 kn where COG is fix noise and a marker would spin with it. Same rule the
line-timing already uses. It replaced a CIRCLE, which could not show facing at all.
**THE COLOUR IS VESSEL CONFIGURATION:** `display.hull_color` (+ optional `hull_color2`, a
livery filled across the AFT THIRD) in `vessels/<id>.json`, through `V.HULL_COLOR`. **No
table of vessel ids in the page** — check 34d forbids it, and that is the hardcoded-vessel-
constant this console spent a refactor removing. null falls back to the chart's `--asv`.
Shipped: small launch **#ffd400**, DriX **#d0342c**.
**⛔ BEN IS NOT IN THIS CONSOLE and its yellow/black is therefore not applied.** WorldView
has a full BEN profile (`D:\Claude\WorldView\worldviewesselsen.json`, real operator
figures: 5.5 kn max sustained 20 h, 0.4 m hull draft, 1.3 m survey draft) but it carries
**NO POWER BLOCK** on purpose — "20 hours at 5.5 kn is an endurance, not a tank size and a
burn rate, and inventing one would be worse than having none". **This console REQUIRES a
power block**, so porting BEN means inventing fuel figures. That is Andy's call, not a
side-effect of an icon change. When it lands: `display.hull_color` yellow,
`hull_color2` black.
**Verified by measuring the INK** ([[verify-the-ink-not-the-box]]): on the live canvas at
course 090, the hull's half-width profile runs 5.5 → 4.5 → 3.5 → 2.5 → 1.5 → 0 px from
stern to bow in the DriX's EXACT #d0342c. A first attempt measured a loose "reddish" and
was confounded by the unsafe-leg red (217,83,79) and by the heading stalk sharing the hull
colour — **an exact-colour filter and an along-course axis were what made the measurement
mean anything.** The Z-Boat yellow was NOT re-measured (the pane lost layout on reload);
its colour is proven at the config level only.
**⚠ A CHECK I HAD TO RE-ANCHOR, and the reason matters:** `pattern_move_grip` check 6 (the
grip must be drawn AFTER the boat, the fix for a buried handle) anchored on
`getCSS("--asv")` — the boat's COLOUR — and went blind the moment the marker became a
vessel-coloured triangle, reporting `boat@-1`. It anchors on `drawVesselGlyph(` now. **A
check pinned to an incidental detail fails on correct changes and passes when the real
property breaks.** Two colour checks were weak the same way and survived mutation until a
SENTINEL colour replaced the real one.
`end_action.js` 36→45, 7/7 mutations caught.


## ⇒ (previous handoff — surveying is not the same as being on a survey)

**NEWEST (this commit): ACTIVITY vs MODE.** Andy: "Status must be clarified. When
transiting between home and survey and also between lines, the ASV is not surveying. It is
transiting. This may be confusing later on as we add sonar data that is collected
continuously. But its a paradigm to follow."
**HE IS RIGHT AND THE CONSOLE WAS REPORTING THE WRONG THING.** `behavior` is the MODE the
run is in and stays "survey" for the whole run — so the card said SURVEY while the boat was
still an hour from the first line. **Mode is not activity.** Two levels now, and the top one
is the paradigm: `activity` = SURVEYING | TRANSITING | HOLDING | IDLE, `detail` = which line,
which turn, what the transit is for. **SURVEYING MEANS ON A COVERAGE LINE AND NOTHING ELSE
DOES** — approach, inter-line reversal, region hop, Go-To, RTH are all transits. Holding
wins over an on-line index (a boat stopped on a line is holding, check 29b).
**ONE CLASSIFIER, ONE ANSWER: `currentActivity()`.** It DERIVES from `runLineIdx` / `curTurn`,
which `accumLineTime` already maintains every tick for the per-component timing — it does not
keep a second copy that could drift from the clock that bills the time. Check 30 asserts every
consumer reads it rather than re-deriving, because two implementations of "is this coverage"
will eventually disagree.
**⇒ THE SONAR HALF, WHICH IS WHY HE RAISED IT.** Sonar is collected CONTINUOUSLY, so nothing
downstream can tell coverage from transit by looking at the data. Every activity CHANGE is
written to the session log (`kind:"activity"`, change-only, with time/position/line), so a
recorded run can be segmented into "these pings are coverage on line 7" and "these were
acquired on the way there" **without re-deriving the classification from the track**. When
sonar lands, key off that stream; do not write a second classifier.
`end_action.js` 26→36, 6/6 mutations caught. Verified live: mode SURVEY, doing
**TRANSITING — approach to the survey area — under way, NOT acquiring coverage**.


## ⇒ (previous handoff — the console explains itself)

**ALSO IN THIS COMMIT, forced by the hook: `ports.json` IS NO LONGER TRACKED.** The
shipped seed is `ports.default.json`; `ports.json` is the LIVE registry and is gitignored,
created from the default on first run. Keeping both in one tracked file meant an operator
simply USING the console dirtied the repo — and worse, `data_routes` seeded its own copy
from that file, so a check on the shipped defaults FAILED the moment someone was working
from a different base. It failed exactly that way, against a live console based in Pago
Pago. Same separation the ROC registry needed, for the same reason. The suite seeds from
`ports.default.json` now, so it tests the shipped contract rather than whoever's port
happens to be active.


**NEWEST (this commit): THE INTENT CARD.** Andy, running live in Pago Pago: "Path planning
seems odd but workable. is it possible to generate a path planning tool that continuously
updates status and reasoning for current and immediate future intentions".
**THE REASONING ALREADY EXISTED AND WAS BEING THROWN AWAY.** Every plan already knew why it
looked the way it did — routed or direct, the detour count, whether it rode the Rule 9 lane
and whether that lane was PARTIAL, legs with no clear detour, a chart that never loaded —
and all of it went into ONE banner at commit time and was gone by the next paint. So a
track that looked odd on the water could not be interrogated afterwards.
**THE RULE THAT SHAPED IT:** the rationale is CAPTURED WITH THE ROUTE at commit
(`setPlanIntent` beside every `runRoute =`) and DROPPED WITH IT (`planIntent=null` beside
every clear) — never re-derived, because a re-derivation describes whatever the console
holds NOW rather than the route being flown. Same rule the lane fact already follows. Check
23 counts the two against each other in the page source, so a new behaviour cannot ship a
route the card is unable to explain, or leave stale reasoning behind one that ended.
**WAYPOINT ROLES ARE LABELLED ONLY FROM WHAT IS KNOWN** — a point matching a committed plan
waypoint IS one, the last IS the target, everything else is honestly "generated". A
confident label that is wrong on the one occasion it matters is worse than a vague one that
is always true.
**THE DIAGNOSTIC THAT ANSWERS HIS ACTUAL COMPLAINT: mean waypoint spacing.** His live plan
showed `wp 42/43/44` three METRES apart with bearings swinging 037→043→050° — that is the
resampled smooth track, not the boat misbehaving, and the card now says so
(`28.7 m mean over the next 40 · 528 total`).
**A plan committed before the page loaded SAYS SO** rather than showing an empty WHY: a
silently missing section reads as "no reasons", which is a different and wrong claim.
`end_action.js` 16→26, 6/6 mutations caught. Check 23's first regex counted the page's own
`let runRoute = null;` DECLARATION as a clear site and could never pass — tightened with a
lookbehind rather than relaxed.
**⚠ AND A PROCESS FAILURE OF MINE WORTH NOT REPEATING: I started a verification console on
8791 WHILE ANDY'S WAS LIVE ON IT.** Windows let both bind, so my requests may have reached
his session; I sent one `arm`, which was a no-op because his run was already armed. Check
the port is free before starting a console — his was running a 563-waypoint survey in Pago
Pago at the time. Verification was redone on 8795 with `--ports-config`, and `mission.json`
was hashed before and after (byte-identical, sha `26552e0b`).


## ⇒ (previous handoff — the base and the boat are chosen separately)

**NEWEST (this commit): OPERATING PORTS.** Andy: "Stop spawning at Erie. change
initialization to select port and ASV. the ASV selection is a good model. All entries made
by user will be added to drop down selection as retained values. Start with New Castle NH
as primary and Lewes, DE as the next."
**WHAT WAS WRONG:** the chart opened on a HARD-CODED Lake Erie centre (`asv.html`, "fallback
until first fix") that belonged to no vessel and no base, and each hull file owned its own
`spawn` — so choosing the DriX chose Lewes and the console could not be pointed anywhere
else without editing a vessel's configuration.
**THE MODEL:** `ports.json` + `/api/ports`, deliberately the same shape as the vessel
picker — a list, an active id, a switch the server gates on SAFE (disarmed + idle). **A
PORT IS WHERE YOU ARE; THE VESSEL IS WHAT YOU ARE DRIVING.** `apply_port()` runs at the END
of `apply_vessel()`, so the port has the last word on SPAWN and the hull's own spawn is only
the fallback. **A vessel switch no longer moves the boat** — `data_routes` check 9 was
INVERTED to say so (it demanded the new hull's spawn; read its comment before "fixing" it,
same shape as `home_spawn` 2a).
**A PORT IS FOUND BY NAME, NOT JUST BOOKMARKED.** Andy's follow-up: "The position function
is not just to memorize a manually found spot, but to initialize a survey area from the
name entered... identify a survey home port like Nome, Alaska and then the chart goes
there." So `POST /api/ports {name}` with NO position geocodes it (OpenStreetMap Nominatim,
keyless, stdlib, cached, identified User-Agent).
**⚠ AND THEN SNAPS IT TO WATER, WHICH IS THE HALF THAT MATTERS. A GEOCODER RETURNS A TOWN
CENTRE AND A TOWN CENTRE IS ON LAND.** "Nome, Alaska" resolves to 64.4975, -165.4062 — a
street corner. Taken as a survey home port that spawns the boat inland and refuses every
route out of it. `snap_to_water()` walks outward through the ENC's own depth areas for the
nearest water at least `MIN_NAV_DEPTH_M` deep and returns a berth: Nome lands 600 m away
in charted 3.6 m. Landlocked or off-chart, the port is still created at the place centre
but carries `unverified: true` and the reason — never dressed up as a berth. A name that
matches nothing is a 400. **This is the same failure the seeded New Castle position hit**
(a pierside guess inside a charted 1.8 m area), caught twice now by asking the chart
instead of trusting a coordinate.
**TWO WAYS IN, deliberately:** "⊕ Find port by name…" to START somewhere, "+ Save this view
as a port…" to REFINE once the berth is visible — the second carries the point the way
Go-To / Set Home / Spawn do.
**⚠ `--ports-config` EXISTS AND EVERY SUITE THAT TOUCHES PORTS MUST PASS IT.** Switching or
adding SAVES; a suite run against the app directory would rewrite the operator's own bases.
This is the `roc_config` lesson (a suite once wrote 198 records into the real ROC registry)
applied BEFORE it could bite. `data_routes` 12e asserts the real registry is untouched.
**⚠ A PORT CARRIES ITS OWN FORECAST MODEL (`ofs`), AND THIS WAS FOUND BY A CHECK, NOT BY
READING.** A NOAA OFS is REGIONAL: pointing the console at New Castle NH under the `dbofs`
default asked the Delaware model for a Gulf of Maine box, and `data_routes` check 13 ("the
console logged NO exception") caught it. New Castle declares `gomofs`, Lewes `dbofs`.
**TWO BOOT-ORDER BUGS IN ONE FEATURE, both of the same family:** `apply_port()` ran during
import BEFORE `CURRENTS` existed (so `set_ofs` was a no-op — re-applied after construction),
and `main()` set `CURRENTS._ofs` from the CLI AFTER `apply_port` and clobbered the base's
model (the CLI is now the FALLBACK, applied first, with the port having the last word).
**⛔ NEW CASTLE HAS NO CURRENT READING, AND THAT IS NOT A BUG IN THE WIRING.** GOMOFS
publishes **3-HOURLY** frames; the vendored `currents.py` assumes hourly — both in its
fetch guard and in its `// 3600` frame indexing. The readout says so in words. **Fix it
UPSTREAM in the Fuel planner and re-vendor — do NOT patch the third copy in place**; this
is exactly the "if the three ever need to move together, make it a package" moment its own
header warns about. Recorded in `ports.json`'s New Castle note too, where the next person
looking at that base will find it.
**AND A DEFECT OF MY OWN, caught by four suites at once:** currents lookup failures printed
to stderr every poll, which spammed the server log and tripped the "console logged no
exception" invariant in `energy_chartinfo`, `home_spawn`, `live_speed` and
`run_link_control`. **Every lookup failure is now a READOUT STATE, never a log line** — what
goes wrong there is a property of the DATA (outside the domain, nothing posted yet, a model
this build cannot read), not an exception in serving a request. `data_routes` 11→23.

## ⇒ (previous handoff)

**Tip `62457f2`, tree clean + pushed, 38 suites green.** The estate around it:
asv_core **`4006166`**, WorldView **`75839d95`**, Zboat `178dadd`, Transit `cda2773`,
Fuel `1ec55f83`.

**NEWEST (2026-08-26): A TRIP-WIRE ON THE ENC EXTRACT — WORLDVIEW HAD A ROCK BUG AND
THIS CONSOLE DOES NOT, MEASURED. `_enc_keep_props` IS A NO-OP TODAY, ON PURPOSE.**

WorldView drew a mission that detoured around a charted rock with **5.1 m of water over
it**. `hazExtent` — the same body this console runs — exempts a point hazard the chart has
sounded, and it tests `typeof vs === 'number'`. **S-57 attributes come off a CELL as
text**, so it saw the string `"5.1"`, the test failed, and the rock took the full 50 m
assumed radius. Its neighbouring rule hid it for as long as it existed: `depthExcluded`
uses `<`, which COERCES, so the depth areas were right all along.

**THIS CONSOLE CANNOT HAVE IT.** One chart source — `_enc_query` with `f=geojson`, and
ArcGIS types its numerics. No local S-57 reader, no operator chart-file import; both are
WorldView's (`s57.py`, `importKeepouts`), and they are the only two roads the text
travelled. Measured, not reasoned — this console's own `hazExtent` run over this
console's own cache: **629 point hazards, 48 sounded, ZERO with a string `VALSOU`, and
ZERO kept as a hazard despite having enough water over them.**

⚠ **SO WHY CHANGE ANYTHING.** Because every fixture in this estate feeds `VALSOU` as a
NUMBER — this suite's own SENTINEL does, and so does `wreck_clearance.js`. The tests were
green about a wire they had never seen. The day a second source appears the fault lands
again and **nothing here would notice**. `_enc_keep_props` coerces at the one seam so a
new source is safe by construction, and `enc_extract.py` 8–8e feed it the STRING form so
the guarantee is checked rather than asserted. **8e pins the CALL SITE**, because testing
a pure helper does not test that anything calls it — `?mutate=seam-reverted` reddens 8e
alone while every direct check of the helper stays green.

Four mutations, real file writes, atomic + sidecar + restored byte-for-byte:
`no-coercion` → 3 red, `coerce-everything` → 2, `junk-kept` → 1, `seam-reverted` → 1.

**(2026-08-20): `static/js/turns.js` IS A SEAM — THE TURN GEOMETRY COMES FROM
`asv_core`, AND THE MERGE FOUND A DEFECT THAT REACHED THE WATER.**

The four bodies came out of `asv.html` yesterday; today they are one implementation behind
both survey consoles. Measured before anything was written, this console's `turns.js`
against WorldView's `mission.js`, both handed this console's flat frame and its 3 m arc
step: **`teardropTurn` 0.000e+0 m over 3,240 cases** with R and outboard exact and all five
outcomes reached (954 semicircle, 201 teardrop, 1,080 degenerate, 441 skew, 564 nogo);
`arcPts` 0.000e+0 over 3,000 with identical point counts; `shortenSeg` 0.000e+0 over 6,000
once the metric is shared. Against the finished core, the same, with `minTurnRadiusM`
7.105e-15 m — **one ULP**, from `(rate*PI)/180` there against `rate*(PI/180)` here.

**⚠ AND `teardropTurn`'s REVERSAL-PAIR GUARD WAS A BARE 60 m, WHICH IS A 4 m-BOAT
ASSUMPTION.** Driven exactly the way `punchOut` drives it, with the 7.7 m USV profile
(14.4 m of minimum radius at survey speed):

```
  120 m spacing  →  semicircle, R = 60.0 m     drawn
  122 m spacing  →  why:"degenerate"           NO TURN AT ALL
```

**Above 120 m of line spacing — ordinary deep-water multibeam spacing — every reversal lost
its generated turn** and fell back to a straight hop. And the banner told the operator the
loop *"would enter a keep-out … it needs 61.0 m of radius there and has 14.4 m"*. **Both
halves false**: nothing was blocked, and a 61 m semicircle is four times inside what that
boat can hold. The advisory alongside it said WIDEN THE LINES, which makes it strictly
worse. **Andy: "fix it in the merge."** `punchOut` now passes
`Math.max(MAX_HALF_M, sp.spacing*1.6)` — the same 1.6 its own reversal gate uses. Below
120 m of spacing nothing moves. See *THE TURN LAYER IS SHARED* below.

**AND THE BANNER STOPPED ASSERTING A CAUSE IT HAD NEVER MEASURED.** `punchOut` counts
`nTurnNogo` / `nTurnSkew` / `nTurnDegen` / `nKnotFold` and names them. The "it needs N m of
radius there and has M" clause is gone: a loop exists at ANY spacing, so a radius shortfall
is **never** the reason a reversal has no turn. `Widen the spacing to N m` is offered only
when `sp.spacing < 2*minTurnR`, where widening can actually help.

**⇒ ONE OPEN DECISION THIS MERGE LEFT, AND IT IS OPERATOR-FACING.** The SEMICIRCLE assumes
the two line ends are ABEAM — its endpoints are a diameter, so its exit tangent is
perpendicular to `EF`. The teardrop absorbs an along-track offset with a straight run
before the loop; the semicircle does not. A clipped line that ends short of its neighbour
therefore rolls the boat out **off the next line**, and `outboard` — the number the banner
tells the operator to have clear water for — is REPORTED as `R` where the teardrop MEASURES
it. Inside `punchOut`'s own two gates: worst **97.3°** of roll-out and worst **125.0 m**
of understatement (reaches 285.1 m, reports 160.1 m). An ABEAM pair is exact. **This is in
BOTH consoles and is older than the merge** — it was neither caused nor fixed here, because
fixing the geometry moves turns on the water. `asv_core/tests/turns.py` RATCHETS both
numbers so they cannot quietly get worse. The cheap half of the fix is three lines (measure
`outboard` in both branches instead of assuming it in one) and cannot move a route.

**PREVIOUSLY (2026-08-20): THE TURNS CAME OUT OF `asv.html`.** `arcPts`,
`minTurnRadiusM`, `shortenSeg` and `teardropTurn` became `static/js/turns.js` — the ONE
genuine prerequisite left in the estate, and the reason the merge above was possible at
all. See *THE TURNS LEAVE THE PAGE* below, including why `punchOut` did NOT come with
them and why the audit's "shared symbol" row is misleading about it.

**PREVIOUSLY (2026-08-20): `static/js/passage.js` IS A SEAM TOO — THE ROUTER AND THE RULE 9
LANE COME FROM `asv_core`.** 862 lines down to 331. See *THE ROUTING LAYER IS SHARED* below
for what moved, and for the finding that nearly slipped past: **`distTo` is not the same
quantity in the two consoles**, the shared bodies call it, and every fixture agreed at
0.000e+0 m anyway. The metric travels with the frame now. No behaviour change: the adopted
module reproduces the one in git **0.000e+0 m** across the router, the lane, the gate and
both survey rules, with the lane flags and the `sea.*` mirror agreeing. All 38 suites green.

**✓ AND THAT QUESTION IS NOW CLOSED — ANDY: "standardize" (2026-08-20).** `planeFrame`
supplies `trueDistTo`/`trueAzTo`, the core's geodesic pair, which are LITERALLY the same
functions WorldView's `tangentFrame` supplies. See *THE ROUTER MEASURES TRULY NOW* below —
including what it moved on the water, which is nothing measurable, and why that is the
honest answer rather than a reason to think it did not matter.

**PREVIOUSLY (2026-08-20): `static/js/chart.js` IS NOW A SEAM, NOT A KEEP-OUT LAYER.**
All eighteen shared keep-out symbols come from `asv_core` — see *THE KEEP-OUT LAYER IS
SHARED* below for what moved, what did not, and the two holes the mutation run found in
the test that guards it. No behaviour change: the adopted module reproduces the one in git
**0.000e+0 m over 4,945 vertices** across nine depth/tide settings, with `blocked`,
`blockedInfo`, `legClear`, `firstBlockAlong` and `snapClearLL` at zero mismatches and no
export dropped. All 38 suites green.

**PREVIOUSLY (2026-08-18): THE SURVEY-LINE CAP HAS ALWAYS BEEN SILENT, AND NOW IT IS NOT.**
`MAX_SURVEY_LINES = 600` has clamped the derived count since the pattern maths was ported
from `surveypattern.cpp`, and said nothing. Past 600 the pattern stopped widening while the
box carried on: the operator got coverage that did **not** fill the area they drew, with
nothing on screen to say why. **600 is reachable by a real survey — 25 m spacing across
15 km is exactly 600.**

`surveyPattern` now also returns `wanted` (the count BEFORE the clamp) and
`capped: wanted > count`, and the survey card says so in amber, naming both numbers and the
spacing that would fill the box. `sp_count` reads "600 of 1000" rather than a bare 600.

**`capped` compares against the PRE-CLAMP count, which is stricter than WorldView's.** Its
equivalent tests `count >= MAX`, which also fires at exactly MAX — where nothing was dropped
and the box IS covered. Checks 18–30 in `tests/survey_card.js`, mutation-verified; adopting
WorldView's form makes 20 fail.

**Andy's ruling (2026-08-18): the console KEEPS 600, it does not rise to WorldView's 4000.**
WorldView removed its bound because Andy's rule for the planner was "no bounding limits
other than typed length and spacing"; the console has a per-line table that rebuilds with
the plan and the planner does not, so the cap stays and becomes honest instead. Raising it
here would need the `LEG_ROWS`-style table work WorldView did first.

**2026-08-19: `static/js/geometry.js` RE-EXPORTS ITS PLANAR PRIMITIVES FROM `asv_core`.**
`bbOf`, `inBB`, `dSeg`, `pinp`, `eachRing`, `eachPath`, `eachPoint` are the core's now;
`bboxContains`, `bboxAround`, `lerpLL`, `segInt`, `ptInGeom` and `segSamplesEN` stay here —
WorldView has no equivalent of those.

**Measured BEFORE the move, not after**, because a textual diff of this console's keep-out
layer against WorldView's claims all 25 shared symbols differ — and for these seven that is
reading whitespace. `dSeg` is bit-identical over 500 random cases; `bbOf`/`inBB`/`pinp` have
zero mismatches over 500 each; the three walkers yield identically across seven geometry
shapes. **Call the functions; do not trust the diff on this layer.**

**⚠ THE WARNING THAT STOOD HERE — "nothing else in the keep-out layer moved" — WAS TRUE
UNTIL 2026-08-20 AND IS NOT NOW.** The whole layer is shared; see *THE KEEP-OUT LAYER IS
SHARED* below. The seven symbols it said had "NOT been differentially measured" have been:
`blocked` and `blockedInfo` 0 of 1200, `markId` 0 of 10 names, and `markSystems`,
`extendCenterline`, `pairGates` and `systemCenterline` JSON-identical.

**2026-08-20: `static/js/passage.js` RE-EXPORTS THE ROUTING GRID FROM `asv_core`.**
`stampSeg`, `dilateGrid` and `rasterKeepouts` are the core's now. They take a keep-out model
already in ENU metres and a cell grid — no frame, no coordinates — which is why these three
could move when the rest of the file could not. Measured identical against WorldView's
before the move: stampSeg 0 of 60 grids differ, dilateGrid 0 of 40, rasterKeepouts **0 of
3072 cells**. Same signatures on both sides, so nothing needed adapting.

**⚠ AND THE BIG FINDING: THE KEEP-OUT "MERGE" IS A CALLING CONVENTION, NOT A REWRITE.**
Handed this console's flat frame, WorldView's `buildKeepouts` reproduces THIS console's
model **bit-for-bit** — 0.000e+0 m over 156 vertices on 180 land polygons, and 0.000e+0 m
with identical bucket counts on a mixed extract (land, dock, hazard_area, shore_line,
dock_line, hazard_points, dredged, restricted, depth areas, chan_marks) across three
enforcement configurations. The differences are packaging: `(ref, enf, dr, feats)` against
`(frame, feats, opts)`, `enf.haz` against `enf.hazard`, scalar `dr` against `{min,max}`.

WorldView's `frame` is duck-typed `{toEN, fromEN}` — hand it this console's flat pair and
you get these numbers; hand it the ellipsoidal pair and you get WorldView's, **1.719 m
apart**. That is the tangent-plane divergence, and the core already ships both constructors
so neither console changes behaviour on adoption.

Downstream already agrees, fed the same model: `blocked` 0 of 800, `blockedInfo` 0 of 800,
`markId`/`markSystems`/`pairGates` agree. Routing likewise — of 16 shared symbols, five were
identical (now extracted) and eleven differ by that one parameter.

**What is actually left here:** **getting `arcPts`, `minTurnRadiusM`, `punchOut`,
`teardropTurn`, `clipLine` and `featuresBboxRef` out of `asv.html`** — they are inline in
the 4,521-line script block, so they cannot be imported, measured or vendored until they
move. (`ref`-vs-`frame` was ruled: **frame**, and it is done.)

### THE TURN LAYER IS SHARED (2026-08-20)

`static/js/turns.js` is a **seam**: nine symbols from `asv_core`, four of them wrapped.
`static/js/core_turns.js` is the vendored copy — **DO NOT EDIT IT**; `python tools/vendor.py`
in the core rewrites it and `--check` fails the core's suite if it has drifted.

| | |
|---|---|
| plain re-exports (5) | `TRACKING_MARGIN` `ANTI_PARALLEL_DEG` `SKEW_LIMIT_DEG` `MAX_HALF_M` `arcStepFor` |
| wrapped (4) | `minTurnRadiusM` `shortenSeg` `arcPts` `teardropTurn` |
| kept here | `ARC_STEP_M` — this console's 3 m pin |

**ALL FOUR BEHAVIOURS ARE WRAPPED, AND THAT IS THE POINT OF THE SEAM.** `minTurnRadiusM`
reads `V.SPEED_KN` and `V.MAX_TURN_RATE_DEG_S` where the core takes plain numbers;
`teardropTurn` takes `(ref, ko, buf, minR, maxHalfM)` where the core takes a frame and an
injected `clear`; `arcPts` and `shortenSeg` pin this console's arc step and its FLAT metric.
Every call site in `asv.html` and in the five suites keeps its own signature, at the price
of one closure per call. Same trade as `chart.js`.

**⚠ THE METRIC IS PASSED, NOT TAKEN FROM THE FRAME, AND THAT IS LOAD-BEARING.** Every other
shared body in this estate reads `frame.distTo`, deliberately, because the two consoles do
not mean the same quantity by it. `shortenSeg` must NOT: `planeFrame.distTo` is
`trueDistTo` since Andy's "standardize" ruling, while line shortening has always used the
module-level FLAT `distTo`, **in the same flat plane the line is drawn in**. A core that
read `frame.distTo` would move every survey line end by up to **1.113 m** — measured — and
put the drawn length 0.131 % from the trimmed one. So it is an argument, where the choice
is visible at the call site.

**THE ARC STEP IS PINNED AT 3 m, AND THAT COST NOTHING TODAY.** The core scales the step
with the radius (`arcStepFor`: 3 m at a 2 m radius, 12.5 m at 250 m) so a survey ship's turn
does not emit 260 waypoints to hold a 4 mm sagitta. **The two are the SAME NUMBER below
R = 60 m** — every radius this console's semicircle branch can produce, and every one its
vessel profiles' minimum radii reach. Andy chose the pin so the merge stayed at 0.000e+0;
adopting the scaling is a separate decision with its own measurement.

**TWO HARDENINGS CAME WITH THE BODIES AND NEITHER IS REACHABLE FROM THIS UI.**
`minTurnRadiusM` returns 0 rather than Infinity on a zero turn rate — this console divided
by ω unguarded, so a vessel file with `max_turn_rate_deg_s: 0` drove `teardropTurn` straight
to **NaN waypoints** — and `shortenSeg` refuses a zero, negative or NaN margin rather than
**EXTENDING the line past both ends**. `applyVesselToUI` guards the first on truthiness and
`punchOut`'s margin is `Math.max(2, …)`, so both are unreachable. **Checked, not assumed**,
and pinned in the core's `tests/turns.py` rather than left as prose.

**WHAT `tests/turns.py` IN THE CORE HAS TO DO THAT A DIFFERENTIAL CANNOT.** Once both
consoles adopt, mutating the core moves them together and every "0.000e+0" stays green.
Worse, **three of this console's four wrapper choices COINCIDE with the core's defaults on
an ordinary fixture** — the pinned 3 m step IS `arcStepFor(R)` below R = 60 m, and a dropped
`clear` or a dropped `maxHalfM` is invisible in open water at ordinary spacings. So it
probes each where it shows and then requires the probe to have been OBSERVABLE: 991 arc
cases where the core default differs, 117 where dropping `clear` changes the answer, 162
where dropping `maxHalfM` does. 50 checks, 7 mutations, all caught.

**AND `punchOut` STILL DOES NOT MOVE.** WorldView's `punchOut(pattern, opts)` is a pure
assembler with injected seams; this console's `punchOut()` takes no arguments and is the
BUTTON HANDLER — `#sp_hint`, `#sp_punch`, `encShow`, `render()`, `showBanner()`. One is UI
and the other is algorithm. What corresponds to WorldView's is the ASSEMBLY INSIDE the
handler, and separating those is its own job with its own decisions.

### THE TURNS LEAVE THE PAGE (2026-08-20)

**`static/js/turns.js`** — `arcPts`, `minTurnRadiusM`, `shortenSeg`, `teardropTurn`. 142
lines out of `asv.html`, which drops 5,154 → 5,015.

**IT WAS A CLEAN MOVE BECAUSE THOSE FOUR NEVER TOUCHED THE DOM.** `shortenSeg` takes
`distTo`; `minTurnRadiusM` reads the vessel block through `V`; `arcPts` needs nothing at
all; `teardropTurn` uses `llEN`/`M_PER_DEG_LAT` and validates every chord with `legClear`.
All four were already reaching for ES modules. No body changed — the only edit was four
`function` → `export function` keywords.

**MEASURED FUNCTION BY FUNCTION against the page as it was**, the old bodies eval'd out of
the backed-up HTML and run beside the module in one process:

| | |
|---|---|
| `shortenSeg` | **0.000e+0 m**, 500 cases (491 shortened, 9 left alone — both branches) |
| `minTurnRadiusM` | **0**, 12 cases across 3 yaw-rate caps, 7 distinct values |
| `arcPts` | **0.000e+0 m**, 300 arcs / **9,816 points** |
| `teardropTurn` | **0.000e+0 m**, 600 cases / **17,370 points** — 335 semicircle, 215 teardrop, and all three refusals (37 skew, 9 nogo, 4 degenerate) |

**AND VERIFIED IN A REAL BROWSER, not just node.** The console boots on 8791 with 24 chart
tiles, zero console errors, the overlay painting **380,744 px**, and `/static/js/turns.js`
served 200. Both shapes produced live through the module: semicircle R = 20 m / 20 points /
20 m outboard, teardrop R = 12 m / 27 points / **29.9 m outboard** (≈2.49·R, inside the
documented ~2.75·R). `minTurnRadiusM("survey")` = 14.443 m for the DriX.

**⚠ `punchOut` DELIBERATELY DID NOT COME, AND THE AUDIT'S ROW IS MISLEADING ABOUT IT.**
Another shared name that is not a shared quantity, this time at the architecture level:
WorldView's `punchOut(pattern, opts)` is a PURE MISSION ASSEMBLER with injected seams
(`clear`, `routeAround`). This console's `punchOut()` **takes no arguments at all** and is
the BUTTON HANDLER — it reads `currentPattern()`, writes `#sp_hint`, toggles `#sp_punch`,
flips `encShow`, calls `render()` and `showBanner()`. One is UI, the other is algorithm.
What corresponds to WorldView's `punchOut` is the ASSEMBLY INSIDE this handler, and
separating those is its own job with its own decisions.

**⚠ AND THE NEXT JOB HAS A DETAIL WAITING FOR IT.** `teardropTurn` takes a value it uses
BOTH ways: its own maths goes through `llEN(E.lat, E.lon, ref)` and `ref.lat`, while the
`legClear` it hands the same value needs `frame.toEN`. That works only because a
`planeFrame` IS also a ref — the property Andy's frame ruling was built on. A merge with
WorldView's turn geometry will have to settle it, the way the keep-out and routing layers
did. (Found by passing a bare `{lat, lon}` to the live module and watching it throw.)

**FIVE SUITES STOPPED LIFTING SOURCE TEXT, WHICH IS THE POINT OF THE MOVE.**
`turn_geometry.js` had an `eval` of the whole turn cluster and now has **none at all**;
`turn_channel.js` dropped both its grabs; `speed_recalc.js`, `units_toggle.js` and
`survey_card.js` each replaced a `grab()` with a `require`. A renamed or deleted export now
fails at LOAD, loudly, instead of quietly resolving to a stale copy of a function the
console no longer runs. **Two of those five were not in my first survey** — I had grepped
for CALLERS, and `survey_card.js` and `units_toggle.js` name the functions only as strings
inside `grab("…")`. The full suite run found them; a narrower check would not have.

### THE ROUTER MEASURES TRULY NOW — Andy: "standardize" (2026-08-20)

**`planeFrame` supplies `trueDistTo`/`trueAzTo`**, which are `geodesicDistanceM` and
`geodesicBearingDeg` from `core_geodesy.js` — **the same functions WorldView's
`tangentFrame` supplies**, so the two consoles' route searches ask the same question rather
than merely similar ones. One file changed: `static/js/geodesy.js`.

**⚠ THIS CONSOLE'S OWN `distTo`/`azTo` ARE STILL FLAT, AND MUST STAY THAT WAY.** They have
118 call sites — the turn geometry, the survey pattern, the readouts, the mission legs —
and all of them live in the SAME FLAT PLANE as `toEN`/`llEN`, where the hypotenuse of an ENU
difference IS the distance. Giving them true distances without also moving the plane would
make the console internally inconsistent: a leg's drawn length and its stated length would
part company by 0.278 %. The new pair is deliberately named `trueDistTo`/`trueAzTo` so that
one name never means two quantities inside one repo — which is the exact trap the routing
extraction spent a session documenting.

**THE PLANE IS UNTOUCHED.** `toEN`/`fromEN` are still flat, the keep-out model is still
built in them, and every clearance test still runs there. Moving the plane to the
ellipsoidal scale is the tangent-plane divergence the core documents; it would move every
keep-out decision by about 1.7 m, and nobody has asked for that.

**⚠ SO THE PLANE AND THE METRIC NOW DISAGREE BY 0.278 %, ON PURPOSE.** A point placed r
metres out through `fromEN` measures 0.9972·r by `frame.distTo`. Safe because of WHERE the
router uses the metric: `legPath` filters and sorts its escape candidates, `pruneStitch`
folds a vertex past 60°, `gateLegClear` forgives a block within 2·buf of an endpoint. All
three are HEURISTICS. **Not one is a clearance bound** — every route is still proved by
`legClear`, which works in the plane through `toEN` and never reads the metric.

**WHAT IT MOVED: NOTHING MEASURABLE, AND THAT IS THE HONEST ANSWER.**

| | |
|---|---|
| `legPath`, 600 legs with clear endpoints | **0 routes moved** |
| `channelLaneRoute`, 4 runs incl. westbound | 0 moved, `lane`/`partial` unchanged |
| `pruneStitch`, 400 paths | 0 changed vertex count |
| the safety invariant | 250 routes, **758 legs, 0 not clear** |

**The escape ring — where the metric has the most leverage — was reached 0 times in 300
legs.** The "92 of 20,000 decisions differ" figure was measured on the DECISION in isolation;
routed through the escalation ladder, `routeAroundSeg` or the wider retries solve almost
everything first. The change is real and correct; surfacing it needs a genuinely tight
basin. **Do not read the zeros as "it did not matter" — read them as "these fixtures cannot
reach the branch where it does".**

**⚠ AND ONE OF MY MEASUREMENTS WAS WRONG BEFORE IT WAS RIGHT, WHICH IS WORTH RECORDING.**
The first safety check reported **39 of 373 legs not clear** — which reads like a serious
regression. It was the CHECK: it drew random endpoints, most of which land inside this
fixture's banks, and `routeAround` DELIBERATELY snaps a blocked start or goal to the nearest
free cell (“the route's job is to lead it out”). An unclear first hop out of land is the
designed behaviour, not a failure. Re-run with both endpoints required clear: **0 of 758.**

### THE ROUTING LAYER IS SHARED (2026-08-20)

**`static/js/passage.js` went from 862 lines to 331.** Fourteen symbols now come from
`static/js/routing.js`: the obstacle search (`routeAround`, `routeAroundSeg`, `legPath`,
`pruneStitch`, `snapClearLL`, `SEG_LEN_M`) and the Rule 9 lane (`buoyChannelLane`,
`narrowChannelLane`, `smoothTrack`, `gateLegClear`, `channelSpanKeepouts`,
`channelTurnKeepouts`, `LANE_FRAC`), with `channelLaneRoute` wrapped.

**What stays here:** `regionOrder`, `buoyageNote`, `junctionKnot`, `pruneJunctionKnots`,
`KNOT_TURN_DEG`, `KNOT_STEP_M`, `planNogoRoute`, `routePlan`. The first four exist in
WorldView too (in `mission.js`) but `pruneJunctionKnots` genuinely DIFFERS — it takes an
injected `clear` predicate there and a keep-out model here — so the mission layer is a merge
to decide, not the next vendoring.

**No behaviour change, measured against the module in git rather than asserted:**
`routeAround`, `routeAroundSeg` and `legPath` 0 of 6 legs each; `pruneStitch` and
`smoothTrack` 0 of 3; both lane producers 0 of 8 with `used`/`partial` agreeing;
`gateLegClear` 0 of 3 with `abandoned` and `splices` agreeing; `channelLaneRoute` 0 of 4 end
to end; both survey channel rules 0 of 2; and the `V.CHANNEL_REACH_M` knob agreeing at
null / 400 / 1500.

**⚠ THE FINDING: `distTo` IS NOT THE SAME QUANTITY IN THE TWO CONSOLES, AND THE SHARED
BODIES CALL IT.** Here it is the FLAT model; WorldView's `survey.js` exports a `distTo` that
is VINCENTY on the ellipsoid. They disagree by a steady **0.278 %** — 4.4 m at 1600 m and
**22.5 m at the 8100 m escalation margin** — and `azTo` by up to **0.120°**.

`legPath`'s open-water escape ring keeps a candidate only while
`distTo(p, toward) <= distTo(C, toward) + r` and then sorts the survivors best-first;
`pruneStitch` folds a vertex past 60°; `gateLegClear` forgives a block within 2·buf of an
endpoint. Fed different functions, those decisions part company: **92 of 20,000 keep/drop
calls, 3.0 % of best-first orderings, 11 of 20,000 fold tests, 9 of 20,000 exemptions.**

**AND EVERY FIXTURE STILL AGREED AT 0.000e+0 m**, because the gap only decides anything
within metres of a threshold. That is the whole lesson: *the differential was true and it
was luck.* So `planeFrame` carries this console's own `distTo`/`azTo` beside
`toEN`/`fromEN`, the shared bodies call `frame.distTo`, and nothing here moved. A core that
had imported one metric would have moved the other console's routing silently.

**⚠ THE LANE PRODUCERS RETURN THEIR FLAGS NOW.** `buoyChannelLane` and `narrowChannelLane`
used to write `sea.laneUsed` / `sea.lanePartial` — a module-level scratch flag set by three
producers, reset and read by one consumer — where WorldView returns `{path, used, partial}`.
The core takes the returned form. `channelLaneRoute` here MIRRORS it back into `sea.*`, so
those fields are now a REPORT rather than a channel and anything reading them is still
right. `tests/buoy_lane.js` reads `.path` from the producers accordingly.

**⚠ THREE VENDORED FILES WERE RENAMED, and the rule behind it is worth knowing.** The core's
`routing.js` imports `./keepouts.js` and `./raster.js`, which resolve in WorldView's `core/`
directory and did NOT here. The rule `contracts.js` had been following all along: **a
vendored file keeps its natural name when another vendored file imports it that way, and
takes the `core_` prefix only when it would collide with an app module.** This console owns
`geometry.js` and `geodesy.js`, so `core_geometry.js` and `core_geodesy.js` keep theirs; it
owns no `keepouts.js`, `routing.js` or `raster.js`, so those are now
`static/js/{keepouts,routing,raster}.js`. `safe_js_path` still refuses subdirectories, so
they stay flat.

**⚠ AND `tests/buoy_lane.js`'s `grab()` COULD NOT READ THE NEW SIGNATURES.** It found the
first `{` after a function name and started counting braces — which for
`legPath(A, B, frame, ko, buf, opts = {})` is the DEFAULT ARGUMENT. It returned the
signature and nothing else, and the eval died with a bare "Unexpected token '}'" pointing at
the eval call rather than the cause. It walks the parameter list first now.

### THE KEEP-OUT LAYER IS SHARED (2026-08-20)

**`static/js/chart.js` went from 419 lines of keep-out layer to a seam.** Eighteen symbols
now come from `static/js/core_keepouts.js`:

- **Fourteen are plain re-exports** — `blocked`, `blockedInfo`, `legClear`,
  `firstBlockAlong`, `markId`, `markSystems`, `systemCenterline`, `extendCenterline`,
  `pairGates`, `channelPolys`, `HAZ_UNKNOWN_EXTENT`, `WRECK_CLEAR_MARGIN_M`, `MARK_TAIL`,
  `CL_EXTEND_CAP_M`. The `frame` ruling made every signature match, so no caller moved.
- **Four are WRAPPERS, and that is a cost, stated** — `buildKeepouts`, `hazExtent`,
  `depthExcluded` and `nogoKind` read `V.*` and `sea.*` here where the core takes options.
  `koOpts()` is the one seam that converts, **built per call** because every field is live:
  `V.*` is rewritten on a vessel switch and `sea.waterOffset` moves with the tide. Caching
  it is exactly the staleness `state.js` warns about, in the direction that gives a deeper
  boat LESS clearance than its own file demands.

**Eleven behaviours stay here** because WorldView has no equivalent: `waterTrust`,
`effectiveWaterOffset`, `WATER_FAR_KM`, `WATER_REMOTE_KM`, `qualityAt`, `bufferFloor`,
`nogoDR`, `nogoKindCounts`, `legReason`, `legReasons`, `snapClearLL`.

**No behaviour change, measured against the module in git rather than asserted:** the model
is reproduced **0.000e+0 m over 4,945 vertices** across three depth windows × three water
levels; `blocked`/`blockedInfo` 0 of 1000; `legClear`/`firstBlockAlong` 0 of 400 (70 clear,
330 blocked — the fixture exercises both answers); `snapClearLL` 0 of 200; `depthExcluded`
0 of 180; `hazExtent` 0 of 108; the channel structure JSON-identical; and no export that
`asv.html`, `passage.js` or any suite names has gone missing.

**⚠ ONE ANSWER CHANGED, AND NOTHING CAN REACH IT.** `nogoKind("chan_mark", false)` said
`"land"` here and `"a channel buoy"` in WorldView. `buildKeepouts` is the only caller in
either repo and it handles marks and CONTINUES before `nogoKind` runs — the buoy points it
builds are labelled at the push site — so the two always agreed about the model. The core
keeps the correct answer.

**⚠ ONE FIELD IS NEW ON THE BUOY POINTS.** This console pushed channel-buoy keep-outs with
no `r` key at all; the core writes `r: 0`. Every reader here goes through `pt.r || 0`
(`chart.js` twice, `core_raster.js` once) and `asv.html` only reads `ko.points.length`.
Checked, not assumed.

**⚠ AN ABSENT ENFORCEMENT KEY NO LONGER MEANS "OFF".** `buildKeepouts` used to read a
missing `enf.land` as falsy — disarmed — so a caller who forgot a key silently got no
shoreline keep-outs. The core defaults an absent key to its ARMED value (`area` alone
defaults off, because a charted area is advisory) and REFUSES a key that is not one of the
four. Every caller here passes a full `{...NOGO_ENF}`, so nothing moved.

**⚠ FIVE SUITES PASSED A BARE REF AND NOW BUILD A FRAME.** `turn_channel`,
`wreck_clearance`, `buoy_lane` and `turn_geometry` constructed `{lat, lon}` literals. The
core's bodies convert through `frame.toEN`, so each needed one line —
`planeFrame({lat, lon})` — and nothing else, because a frame still carries `lat`/`lon` and
every `llEN(...)`/`fromEN(...)` call beside it keeps working. **That property is why the
ruling was one line in `rebuildNogo` rather than seventy call sites.** `buoy_lane` is the
one suite that evals module SOURCE into a shared scope, so it picks the clearance bodies
out of `core_keepouts.js` now; it needed the same one-line fix and nothing more.

**⚠ 2026-08-19: `static/js/geodesy.js` NOW DELEGATES ITS FLAT MODEL TO `asv_core` — AND
KEEPS ITS ENU TRANSFORM. THE SPLIT IS A MEASUREMENT, NOT A PREFERENCE.**

Delegated: `distTo`, `azTo`, `atDA`, `alignDeg`, `M_PER_DEG_LAT`.
**Kept local: `toEN`, `fromEN`, `llEN`** — and `worldPx` / `worldToLatLon` / `TILE` /
`distPtSegPx`, which are the VIEW layer and are not in the core at all.

The core's `toEN` takes a `Frame` — a validated, frozen contract object with
`m_per_deg_lon` precomputed — where this console passes a bare ref point. Building one per
call costs **328 ns against 123**: a real regression for no gain, so these three stay.

**⚠ THE REST OF WHAT THIS SECTION USED TO SAY WAS WRONG, AND THE REFACTOR IT BOOKED IS
CANCELLED (corrected 2026-08-19).** It claimed the hoisted form was "worth 4.7×" because
`llEN` had "63 call sites in the keep-out raster, which runs inside a drag". **63 is a count
of call sites in the SOURCE.** It was asserted to mean runtime volume on the drag path and
never measured there. Counted properly:

| operation | `llEN` | `fromEN` |
|---|---|---|
| `legClear` — the drag-path call | **2** | 2 |
| `firstBlockAlong` | **2** | 3 |
| `planNogoRoute` — a whole route search | **0** | 2 |
| `buildKeepouts`, 180 polygons | **3,060** | 0 — but **once per chart**, not per drag |

A leg is converted at its two endpoints and the raster then works in ENU, where the
coordinates already are. The 4.7× was a **microbenchmark of the function in isolation**; end
to end the hoist is unmeasurable, with run-to-run variance (build 0.2–0.5 ms, 40-leg pass
4.0–8.7 ms) far larger than any difference. **Keeping `toEN`/`fromEN`/`llEN` here is the end
state, not a staging post.**

**These are WRAPPERS, not aliases, and that is a real cost.** The estate prefers aliases
because a wrapper is an adapter that can drift. It is impossible here — the core takes
loose `(lat, lon)`, this console has always passed `{lat, lon}` POINTS, and there are 118
call sites across the three. Three one-line adapters beat rewriting 118 call sites in the
thing that drives the boat. Cost: distTo 84→80 ns, azTo 116→111, atDA 26→53.

**What moved, in numbers:** distTo **3.6e-12 m**, azTo **5.7e-14°**, atDA and alignDeg
**exactly 0** — the core precomputes `D2R` where this file wrote `*Math.PI/180` inline.
That is the *same class* of hoist the comment above `toEN` has always warned about, at one
part in 1e12 of the 3 m keep-out buffer.

**`DELEGATES_TO_CORE` IS LOAD-BEARING — DO NOT EDIT IT TO MATCH AN INTENTION.** asv_core's
differential reads it and stops counting those metrics as evidence, then **proves the claim
over a 400-pair sweep**: a wrapper returns the core's own bits, a private copy differs at
~1e-12. Adding a name here without actually delegating makes that suite go red, which is
the point. (It was verified by mutation: a declared-but-private `distTo` is caught at
3.638e-12.)

**THE TWO VENDORED FILES ARE FLAT, AND THAT IS THE SERVER'S DOING.** `safe_js_path()`
refuses anything whose basename is not the whole name — `tests/http_contract.py` pins it —
so there can be **no `core/` subdirectory** the way WorldView has one.
`static/js/contracts.js` keeps its own name because `core_geodesy.js` imports
`./contracts.js` verbatim; the geodesy took the prefix because it would have collided.
**Do not widen the path guard to make the filenames tidier.**

Verified beyond the 38 suites: the module graph resolves over HTTP, the console boots with
24 tiles and zero console errors, `distTo === core.flatDistanceM` in the page, and the
chart overlay paints 380,692 px.

**ALSO (2026-08-19): `roc_tracks.py` IS VENDORED FROM `asv_core`. NO EXECUTABLE LINE
CHANGED HERE.** The core body is this repo's; the only edits are a docstring made
app-neutral and a comment. What changed is who else runs it — Zboat's copy was the older
generation and this body carries **three live crashes** across to it: a checksum-valid NMEA
sentence with a garbage speed field (bare `float()` → `ValueError` → the GPS link drops for
3 s), a persisted record spelling an absent offset field as `None` (→ `AttributeError`
inside `snapshot()`, taking out the ROC card and every `/api/state` frame), and an unbounded
`roc_config.json`.

**`tests/roc_tracks.py` and `tests/roc_persist.py` STAY HERE** — 677 lines, and they now
exercise the *vendored* file, which is what proves this console runs the core body. The core
adds only the one case they cannot: **every check here calls `configure_vessel()` first,
because this console does.** Zboat never will, and nothing anywhere had asserted what an
unconfigured module does. That is now 14 checks in the core.

**A CONSEQUENCE FOR THIS REPO: the placeholders in `SHIP_RECOVERY_M` / `ASV_MAX_SPEED_KN`
are now load-bearing for someone else.** They read 50.0 m and 6.0 kn, which is exactly what
a single-hull console hardcodes. They are no longer "a value that gets overwritten a
millisecond later" — do not retune them as if they were.

**ALSO (2026-08-19): `ais_service.py` IS VENDORED FROM `asv_core`, AND ITS AISHUB UNIT
DETECTOR HAD A BUG.** The core body is THIS repo's — Zboat's copy was the older generation
and a strict subset, so nothing about the merge, the sources or the error frames changes
here. One thing does, and it is a fix.

AISHub serves positions in either decimal degrees or raw 1/600000-degree integers, and the
two are indistinguishable field by field (a raw SOG of 74 is 7.4 kn; 74 kn is also 74). So
`_aishub_normalize` settled the format once per response, from the coordinates, on the
sound principle that a raw latitude is off Earth read as degrees. It settled it with
`any()`. **The 91/181 "not available" sentinel that every vessel without a GPS fix
broadcasts is off Earth read as degrees.** One unfixed ship flipped an ordinary
human-format response into raw and divided every good position by 600000 — measured, two
vessels off Lewes came back at 0.00006 N 0.0001 W doing 0.5 kn, no error anywhere. The
sentinels are now excluded from the vote (they are exact and known in both unit systems)
and raw must win a **majority**, which also covers what a sentinel list cannot: a merely
corrupt coordinate.

**Latent, not live.** `AishubSource` does not start without a member username and there is
no membership, so this has never run — but it was on the path the moment one existed, and
it was about to be copied into Zboat. `tests/ais_service.py` in the core pins it: 28
checks, every mixed-response case paired with a genuine raw response that must still be
rescaled.

**`tests/ais_sources.py` and `tests/ais_error_frames.py` were NOT moved to the core, and
that is deliberate** — they now exercise the *vendored* file, which is what proves this
console really runs the core body. Do not edit `ais_service.py` here; change the core and
re-sync.

**ALSO (2026-08-18): `currents.py` IS VENDORED FROM `asv_core`, AND THE THIRD-COPY
PROBLEM IS SOLVED.** The header below used to say the drift risk was "real and compounding"
across a Fuel → Transit → ASV chain. There is no chain any more: one body in the core, three
synced copies, and `python tools/vendor.py --check` from that repo fails if any of them
differs by a character. **The body did not change here** — ASV's copy was already byte-identical
to Transit's, which is what the core adopted. **Do not edit it here.** The `ofs.py` decision
below still holds and now rides in the file as a per-consumer note, so it stays where a reader
will meet it.

**ALSO (2026-08-18): `gps_sim.py` IS VENDORED FROM `asv_core`. DO NOT EDIT IT HERE.**
It and Zboat's copy differed by one docstring word across 215 lines, so it was the first
and cheapest thing to de-duplicate. Source: `D:\Claude\Core\asv_core\gps_sim.py`; sync
with `python tools/vendor.py` from that repo, verify with `python tools/vendor.py --check`
— an edit made here is reported as drift and then overwritten. **No executable line
changed**: only the docstring, which is now app-neutral, plus a generated header. The file
stays at this path because `roc_tracks.py` Popens it by `os.path.join(APP_DIR,
"gps_sim.py")`. It also gained its first tests — 60 NMEA-0183 conformance checks in the
core, where before neither copy had any. All 38 suites here stay green.

**PREVIOUS: THE CURRENT JOINS THE WIND ROSE.** Andy: "add the current to the
wind rose on the chart." **⚠ THE HAZARD THAT SHAPED IT: WIND AND CURRENT USE OPPOSITE
CONVENTIONS.** Wind is named by where it blows FROM; a current's SET is where the water
GOES. Two needles of the same shape differing only in colour is precisely how an operator
reads one as the other, so the current is a **single-headed ARROW** (one unambiguous
point, in the direction of travel) riding the RING outside the star, against the wind's
two-tone double-ended needle through the middle. Colour (sea-blue) agrees with the
convention rather than carrying it. A PROJECTED current draws **hollow** so an estimate
cannot pass as a measured set, and the reading below is LABELLED `set N.NN kn DDD°` —
two unlabelled knot figures stacked would be a guessing game.
**A REAL BUG FOUND WHILE ADDING IT: the clamp was wrong before this and would have got
worse.** `roseCentre()` clamped to `ROSE_R`, but the rose paints well outside R — cardinal
letters at 1.20 R, readings hanging to 1.70 R BELOW. The wind's direction line could
already slide under the bottom edge while the ring still looked correctly placed; the
current's line would have made it obvious. Now clamped to the true drawn extent.
**AND THE CHECK THAT GUARDED IT WAS THE WRONG KIND.** `panel_drag` 27d asserted the
literal `Math.max(ROSE_R` — so it FAILED when the clamp was IMPROVED, and would have
PASSED for any wrong expression of the same shape. Rewritten to RUN `roseCentre()` with an
absurd position in a fake 900×700 viewport and assert the whole rose lands inside,
readings included. **Third time this session: a check on a mechanism must execute the
mechanism** (see also `survey_card` 12-15 and `measure_tool` 15b).
**Verified by measuring the INK, not the box** ([[verify-the-ink-not-the-box]]): sampled
the live canvas around the rose — 539 sea-blue arrow pixels beside the wind needle's 438
red / 514 teal, then walked the shaft from 0.65R to 0.95R along the reported set (285.8°)
and along its reciprocal: **10 hits along the set, 0 on the reciprocal.** The arrow points
where the water goes, and that is measured rather than assumed.

## ⇒ (previous) handoff — the console reads the tide under the boat

**NEWEST (this commit): SURFACE CURRENTS AT THE VESSEL'S POSITION.** Andy: "implement the
current module from the transit calculator project... use asv position for reference."
`currents.py` was **VENDORED** from `D:\Claude\Transit`, which vendored it from
`D:\Claude\Fuel` — the THIRD copy in a chain, with a drift risk its header could describe
but not prevent. **Superseded 2026-08-18: it now comes from `asv_core`, one body with a
check that fails on any divergence** (see the top of this handoff). Unmodified in the move. **`ofs.py` (multi-model chaining) is deliberately NOT vendored:** the console asks
for a current at ONE POINT — the boat — not along a line that may cross a model boundary,
so one model (`--currents-ofs`, default `dbofs`) is the honest scope. If a hull ever needs
coverage spanning two models, vendor `ofs.py` + `geo.py`; do not rewrite this.
**`CurrentsMonitor` is shaped exactly like `EnvMonitor`** — position in, background thread
does the networking, `snapshot()` rides `Engine.state()` as `current`. **Nothing blocks:**
a cycle fetch is a multi-megabyte OPeNDAP read, and `?force=1` KICKS the thread rather
than fetching in-request.
**⚠ IT IS NOT SIM-GATED, AND THAT IS DELIBERATE.** The wind rows are sim-only because the
simulator invents the wind; nobody invents the tide, so a real hull gets this too. Check
10 pins it at the SOURCE, since a sim run cannot observe the real branch.
**THE READOUT IS A FORECAST, NOT A MEASUREMENT, AND NOT THE SET ROW.** `Set / crab` is the
leeway the sim is actually applying; `Current` is what NOAA predicts the water is doing
there. Different questions, separate rows, neither derived from the other. Degradation is
spoken in words at every step: no cycle cached / no model water at this position /
projected N h by tidal cycle (flagged `~` and amber; 0.14–0.21 kt RMS per the source
project's own measurement) / refused past 3 cycles.
**Live-verified against real NOAA before shipping:** cycle `dbofs_20260814_t18z` fetched,
spanning 08-14 13:00Z → 08-16 18:00Z, giving **0.30 kn @ 285.3 °T at the DriX spawn**,
`projected_h=0.00` — then read back identically off `/api/currents`, off `/api/state`, and
out of the rendered card. **A false alarm worth remembering: my first probe reported
"0 cycles" and looked like broken vendoring — it was `days_back=1` on a day whose cycle
had not posted yet. Running the SAME call in the source project separated "my copy is
broken" from "NOAA has nothing yet" in one step; do that before debugging a vendored
module.** `tests/currents.py` NEW (14 checks): it tests THE CONSOLE'S WIRING, not the
model maths, which the parent projects own and which a third copy of would only drift.
7/8 mutations caught by their own check; the eighth (an unexpected error escaping the
background thread) is caught by the crash guard, which is the right place for it.
**`ofs_cache/` is gitignored** — fetched model grids, megabytes.

**THE WORK BEFORE THIS ONE: THE DESKTOP SHORTCUT IS BUILT BY THE REPO, NOT BY HAND (Andy's
ask).** "Make sure the desktop shortcut and script are included in the repository."
`start_sim.bat` and `tools/asv.ico` were already tracked, but nothing here could RECREATE
the shortcut — the README told the operator to right-drag the bat to the desktop and change
its icon by hand, so a fresh clone had no repeatable way to the same result. Now
`tools/make_shortcut.ps1` does it, the mirror of the fuel planner's script of the same name
(the launcher went Fuel-ward, the shortcut builder came back). **It verifies by reading the
`.lnk` back** — `Save()` accepts a target that does not exist and only fails on
double-click. **Proven against the live shortcut**: generated into a scratch folder and
compared field-by-field with the real desktop one — target, arguments, working directory,
description, icon and window style all identical, so the operator's existing shortcut is
reproduced rather than changed. Both refusals were exercised (script moved out of `tools\`,
bad `-DesktopPath`) alongside their acceptance cases, and a re-run reports *Updated* with no
second `.lnk`. **The `.lnk` itself stays untracked** — a binary of absolute paths for one
machine is wrong for every other clone; the script plus the icon are what travel. See
"Run it" for the three things to know before changing any of it.

**THE WORK BEFORE THIS ONE (`1a39cb0`): THE MINIMUM SURVEY LINE, PER VESSEL (Andy's ask).** "Short survey
lines are inefficient and unnecessary for vessels the size of DriX. For the ZBoat this
would be fine... if a generated plan has lines or line segments of less than 80m cut them
out of the plan and jump straight to the next waypoint. This applies only to surveys.
Figure out how to apply this to vessel configuration." A line costs TWO TURNS whatever its
length, so the threshold belongs to the HULL — `planning.min_survey_line_m`, reaching
punchOut through `V.MIN_SURVEY_LINE_M`, never a constant in the page. Shipped: DriX **80**,
example USV **25**, Z-Boat **0**. **Absent or 0 = keep every line**, so an older or
third-party vessel file behaves exactly as before (the parameter is deliberately OPTIONAL,
like `channel_reach_m` — not added to `_VESSEL_SCHEMA`).
**THE DECISION THAT MATTERS: the length compared is AS RUN**, i.e. after `shortenSeg` has
taken the turn margin off both ends, because that is the water the boat actually surveys —
a 100 m line at 30 m spacing runs as 70 m and is judged on the 70. One line changed in
punchOut, right where the existing `>1 m` sliver filter already sat; the ordering has
already run, so survivors keep their serpentine and the transit loop bridges the gap with
its usual turn / straight / route-around ladder. **NEVER SILENTLY** — the punch-out hint
names the count and the threshold, or a thin survey reads as a chart fault.
**⚠ A TESTING LESSON, RE-LEARNED THE HARD WAY:** my first version of checks 12-15
REIMPLEMENTED the filter in the harness. Every behavioural mutation of the page SURVIVED,
because the checks were grading a copy. The block is now LIFTED FROM `asv.html` VERBATIM
and eval'd with the harness supplying its inputs — same trap as `measure_tool` 15b, and
the same cure: **a check on a mechanism must execute the mechanism.** `survey_card.js`
11→19; 6/8 mutations caught by their own check, one more caught loudly by the crash guard
(hardcoding the threshold makes the harness refuse to find the block at all).

**AND BEFORE THAT (`75a1234`, same day): THE WIND ROSE (Andy's ask).** "Need a wind speed and direction on
the chart. Create a small wind rose with direction and speed that can be dragged around."
Then, on seeing a compass-rose reference: **"I do not want that on a card or chip.
Something like this with background transparency."** So it is a CHART OVERLAY painted in
`render()` — no panel, no uicard, nothing behind it — which is why it is the ONE movable
thing here that does not use `makeDraggablePanel` (that mechanism moves DOM elements;
there is no element). Graduated ring (5° ticks, longer every 30°), 8-point star, cardinal
letters, a needle whose RED half points where the wind is GOING so the barb sits on the
side it blows FROM, speed + from-direction at the hub. `ROSE_R` is the ONE dimension and
every number derives from it — the `327ce0c` lesson that killed the deleted ENV-card rose,
applied up front rather than after Andy spotted it.
**⚠ THE HAZARD IT CREATES, and the reason it has checks: it sits over the chart in EVERY
mode**, so without a guard a press on it would drop a waypoint / place a pattern corner /
anchor a measurement UNDERNEATH it — the same class as the right-button misfire. It claims
the press before any mode branch and returns. **Proven live: in WPT mode a press on the
rose added NO waypoint while a press on open water still did.** `panel_drag.js` 29→33.
**It also broke `measure_tool.js` for real** (its `gesture()` harness evals the mouseup
chain and had no `roseDrag`) — fixed by giving the harness the true value, `null`, not a
convenience stub. Andy then asked for **double size and black rings/lettering**: `ROSE_R`
46→92, `ROSE_INK`/`ROSE_INK_SOFT` constants, and I flipped the readout to dark-on-light-halo
too, since black rings on a pale NOAA tile would have left a light readout the only
illegible thing on it.

**THE WORK BEFORE THIS ONE (same day): TRANSIT + RTH TIMES ON THE LINES CARD (Andy's ask).** Two rows
bracketing the per-line table: the **ENC-routed** time/distance from the boat to line 1,
and from the last line home — the same `planNogoRoute` every behaviour flies, because at
Lewes the straight line to the survey area crosses LAND (the vessel card's `#v_approach`
straight-line figure is exactly the shortcut these rows improve on; measured live, routed
2.85 km vs 2.14 km straight). Routing is CPU work and `renderLineTable` runs on EVERY
telemetry frame, so the routes are computed OFF the tick, one in flight, re-keyed only on
real change (boat > `TRANSIT_REKEY_M` = 50 m, plan endpoints, home, nogo identity);
**metres are cached, seconds are derived at render from the CURRENT plan speed**, so a
speed change re-times instantly with no re-route (verified live: 13:13→6:36 at
survey→high, same 2.85 km). Rows degrade ALONE and honestly (no fix / no home / planner's
own refusal / "direct" when nogo unloaded). **The run-state gate was REMOVED the same day
it shipped:** the first cut blanked the transit row to `--` once running, and Andy watched
the boat fly the transit against a dash — the row now stays LIVE through the run, one
re-route per 50 m bucket.
`speed_recalc.js` 10→22, **7/7 mutations caught by the check that claims to guard each**
(straight-line length, RTH-from-boat, swallowed refusal, fixed-speed time, hidden
"direct", boat out of the key, running boat still routing). Read "THE LINES CARD'S
TRANSIT + RTH ROWS" below.

**THE WORK BEFORE THIS ONE (same day): THE MISSION'S OWN KNOTS — the junction seam.** The task chip the
circle-at-the-mouth commit left open: the SURVEY MISSION itself (not the Upload route)
carried two reversal knots, wpt 475 and 551 of session `20260810-131214`. Replayed offline
against the real ENC at the live parameters: **475 (interior splice seam) was already cured
by the `pruneStitch` move** and does not reproduce; **551 (a routed transit folding 176° in
4.5 m at the LINE END itself) still reproduced at HEAD, byte-exact** — the junction is a
seam `pruneStitch` structurally cannot see, because the line's heading is outside the
route. Fixed with `pruneJunctionKnots` in punchOut's routed branch (the one place holding
both the via and the line endpoints). Read "THE MISSION'S OWN KNOTS" below;
`turn_geometry.js` 21→29, 6/6 mutations incl. the exact shipped fault.

**THE WORK BEFORE THIS ONE (same day): THE CIRCLE AT THE MOUTH.** Andy flew the new lane
live; the transit was clean until just past the outer green, then the boat orbited 360°.
The plan — not the boat: the Upload path shipped a gate-splice seam as a 4 m reversal knot,
unflyable at a 20 m turn radius. `pruneStitch` moved into `channelLaneRoute` (the
producer), so Upload inherits what Go-To/RTH always had. Read "THE CIRCLE AT THE MOUTH"
below.

**THE WORK BEFORE THAT (2026-08-10, two commits back): WHERE THE RULE 9 LANE LETS GO.** Andy
reported that keep-right "has degraded or been lost" and restated the spec: see the
centreline, stay ¼ width to the vessel's own right entering **or** leaving, and **hold it
until past the extent of the channel as expressed on the chart, or at the final set of
buoys that mark that channel and only that channel.** A five-lens investigation found the
last clause had **no implementation** — it was deleted with the old colour keep-right
(`channelEndExtend` / `gateProject`, `bcd9529`) and the geometric rework shipped a comment
asserting a replacement was unnecessary. It was not. **Read "THE LANE'S ENDS" below before
touching `buoyChannelLane`, `extendCenterline` or the `CONFINE` knob.**

**THE REFACTOR WAS NOT THE CULPRIT — do not go looking there.** The lane's output is
identical to 0.1 m between the rework's ship commit `7d3c0b5` and the pre-fix tip
`5927ac1`; `e35ecf4` (Rule 9 leaving the page) changed nothing about it. What *did* exist
was a three-commit crash window on 2026-08-09 (`d1c11db`…`02c3f1c`) where `CONFINE` read a
bare `CHANNEL_REACH_M` the state split had deleted — `ReferenceError`, killing the whole
lane pipeline for any vessel with the override set, which the DriX has. Fixed the same day
by `e35ecf4`. If Andy's observation dates from that day, that alone explains "lost".

**Repo:** PRIVATE GitHub remote `AndyMcLeod/ASV-Console` (created 2026-08-06 at Andy's
instruction — push after committing; before this it was local-only and every note below
saying "never push" predates it). Tree clean. `git log --oneline -5` for the tip —
**this handoff no longer quotes a HEAD hash, because it is now refreshed IN the work commit
and a commit cannot name itself** (see "Keep docs current"). Run:
`python asv_console.py --sim` — **it now comes up as the DriX at Lewes** (`drix08` is
`DEFAULT_VESSEL_ID`; no `--vessel` needed). Web port **8791**; the branded sibling at
`D:\Claude\Zboat` uses 8781, so both run side by side. **Keep this console brand-free**
— the sanitization rules below are locked decisions, not preferences.
**⛔ THE SIBLING IS PARKED (Andy's standing directive, 2026-08-05): all future effort
resides HERE. Do not port fixes back to the Z-Boat console or touch its repo until he
redirects** — every "flows both ways" / "port to the sibling" note below predates this.

**STATE: tree CLEAN, everything pushed, nothing held back.** The long-running
turn-water hold is closed (`a548c14`). **48 regression suites / 923 assertions** (27 JS / 573,
21 Python / 350), derived
with the one-liner below and matching the hook. If you are picking this up cold: read
this section, then "THE SESSION JUST FINISHED" for what changed most recently, then
OPEN / NEXT at the end of this section for what is actually open.

**⚠ A FEATURE WAS BUILT AND REVERTED THE SAME DAY (2026-08-06) — READ BEFORE TOUCHING
THE RECORDER OR PLAYBACK.** `d473b5b` shipped full-picture recording (a `LOG.aux`
change-only/throttled mechanism feeding env/water/ais/vessel/mission streams) + a
CHART|CONTROLS two-tab playback. Hours later, live mid-mission, Andy called it back —
"too many things that worked are now broken" — and `1a1e8dc` reverts it whole; the tree
is PROVEN byte-identical to `734ec90` (`git diff 734ec90 1a1e8dc` is empty). **Do not
rebuild it unasked.** The design, both suites (13 mutations earned) and the docs live
intact in `d473b5b` if he ever asks. Four things survive the event:
- **The fault that triggered the call was NEVER root-caused**: his LINES card froze in
  the controls window. The controls window is a DOM MIRROR of the chart window's hidden
  panels over a **BroadcastChannel — which is ORIGIN-SCOPED: a chart window on
  `localhost:8791` and a controls window on `127.0.0.1:8791` can never sync, silently,
  while commanding still works.** Works-after-revert carries a restart confound (the
  restart is also the cure for both mirror suspects), so the feature stands unconvicted.
  If the card freezes again on THIS code: F5 the controls window, compare the two
  address bars, then F12 on the chart window.
- **A real gap found during diagnosis, parked**: a SECOND full client (a laptop beside
  the console) never learns of plan edits — each window loads `mission` once at boot.
  The built-and-tested-live fix is 4 lines of design: server bumps `MISSION_REV` in
  `save_mission` + publishes it on the state + the POST returns it; client adopts its
  own echo, guards in-flight edits with `savePending`, refetches on a foreign rev.
- Sessions recorded during the feature window carry extra record kinds (`env`, `water`,
  `ais`, `vessel`, `mission`); this playback ignores unknown kinds — they replay fine.
- The revert-day conversation also closed: aisstream's empty feed was THEIR outage
  (fresh key installed and equally silent — the discriminator ran); `02bacb9` means an
  upstream error frame now SHOWS instead of reading as a quiet sea.

**FORTY-EIGHT REGRESSION SUITES (923 assertions), all run by the pre-commit hook** (`.githooks/pre-commit`;
enable once per clone with `git config core.hooksPath .githooks`). **The hook now DERIVES its
run list from `tests/`** — a new suite runs from the day it is written; only the per-suite
failure ADVICE is still hand-kept (a missing advice line is cosmetic, a missing run was a
hole). Run them after any change to what they cover, and treat "harness crashed" as loudly
as "check failed".
**The counts below are hand-maintained and DO drift** — twice now an edit has targeted a
number that had already changed, leaving the total wrong. Re-derive rather than trust:

```
for f in tests/*.js; do printf "%-24s " $(basename $f); node  $f | grep -cE '^ *(ok|FAIL) '; done
for f in tests/*.py; do printf "%-24s " $(basename $f); python $f | grep -cE '^ *(ok|FAIL) '; done
```


| | guards |
|---|---|
| `node tests/buoy_lane.js` | Rule 9 channel lane + the lane fact travels with its route; the lane yields to the law; WHERE IT LETS GO — held at the final pair, stood on one width past, released before a separate channel, `partial` when a stretch went un-laned, a reach knob that may only widen; and NO ROUTE SHIPS A REVERSAL KNOT — the knot prune runs in the producer on the gate's own output (30) |
| `node tests/wreck_clearance.js` | charted point-hazard extent (12) |
| `node tests/water_trust.js` | water-level trust + depth gating (15) |
| `node tests/turn_geometry.js` | survey turn geometry + THE JUNCTION SEAM: a routed inter-line transit may not fold a reversal knot at a line end — pruned lawfully, kept when obstacle-forced, reported either way (29) |
| `node tests/turn_channel.js` | turns may only use channel water the survey lines occupy (14) |
| `node tests/chart_source_card.js` | the SRC card lists EVERY chart in view, vessel's marked (16) |
| `node tests/end_action.js` | what the card says a run ends as (16) |
| `node tests/rule9_scope.js` | **WHERE COLREGS RULE 9 APPLIES.** A narrow channel is a CHARTED object (S-57 FAIRWY / DRGARE / a buoyed system) or water genuinely under NARROW_MAX_M wide - never a ray-march for walls within reach; and only a TRANSIT gets the lane, never a survey or search pattern (14) |
| `node tests/speed_modes.js` | SPEED BY ROLE: the three settings (transit / turn / survey), the governor that commands the one the current job wants, the safety override outranking it, and the TURN RADIUS being derived from the TURN speed (25) |
| `node tests/clearance_guard.js` | **SAFETY.** The turn LADDER (outboard -> inboard -> slow radius -> refuse) and the RUNTIME clearance guard: the live distance to the keep-out model, the alarm, and the automatic slow-down that never steers and never acts unless the boat is under autonomous command (23) |
| `node tests/port_slew.js` | the port change is a visible journey that always ARRIVES: the zoom-out/cross/zoom-in arc, scaled by distance, the short way over the antimeridian, elapsed-time driven so a throttled window still lands, and the new area's keep-out model fetched before the card comes down (23) |
| `node tests/off_track.js` | off track is the SIGNED PERPENDICULAR from the leg being flown, never the range to the nearest survey line; it names its subject; and no leg means no reading (17) |
| `node tests/nogo_readout.js` | the Nogo row's state, incl. the stuck-on-loading bug (16) |
| `node tests/pattern_move_grip.js` | the survey move grip is reachable AND visible (7) |
| `node tests/survey_card.js` | the survey card still describes a COMMITTED plan (11) |
| `node tests/measure_tool.js` | the chart ruler + the point-command menu: the reading flows ALONG the leg sized by ONE constant, the gesture is click-move-click, each row asks the console's own gate predicate, Set Home sends the click, checks it against the keep-out model, and confirms only on the server's own ok (34) |
| `node tests/speed_recalc.js` | plan speed is an INPUT — it recalculates (10) |
| `python tests/roc_tracks.py` | ROC / moving HOME + NMEA ingest robustness; gps_sim round-trip (23) |
| `python tests/roc_persist.py` | only the most recent 3 ROCs survive a restart; no suite may write the operator's registry (16) |
| `python tests/currents.py` | the surface-current readout's WIRING (not the vendored model's maths): never blocks or raises, every degradation said in words, a projected value flagged as an estimate, fed the vessel's own fix, and NOT sim-gated (14) |
| `python tests/live_speed.py` | a speed change REACHES the boat — SOG follows (11, real console) |
| `python tests/ais_range.py` | AIS range filters a wide subscription; never on a lake; nm + empty state (20) |
| `node tests/ui_split.js` | split-window lists resolve; card placement, shared resize + height cap, the uicard clamp (22) |
| `node tests/panel_drag.js` | ONE drag + ONE show mechanism; no pop-out forgets its position OR goes off-screen; a CARD IS NOT A MODE; what "visible" means is DERIVED from the panel (29) |
| `node tests/ui_tooltips.js` | hover tips the pointer cannot occlude; guarded restore for runtime title writers (9) |
| `node tests/ais_table.js` | the AIS traffic list is PATCHED, never rebuilt (9) |
| `node tests/stored_settings.js` | guarded localStorage; legacy `"1"`/`"0"` toggles still read (11) |
| `node tests/units_toggle.js` | the km↔nm DIST pill: value converts BOTH ways, short stays metric, one formatter (12) |
| `python tests/completion_modes.py` | end-of-plan setting vs run (11, drives a real console) |
| `python tests/estop_chain.py` | E-STOP reaches the VESSEL, latches, refuses, releases cleanly (17, real console) |
| `python tests/run_link_control.py` | transit/pause/reset/connect/disconnect: pause is NOT stop; reset refuses on real; no zombie link (21, real console) |
| `python tests/home_spawn.py` | sethome lands where it says from BOTH sources — an explicit point, or the LIVE fix when none is given (the stale-status fix); RTH closes on home; spawn = power-cycle AT the point; and the console SURVIVES a malformed one (18, real console) |
| `python tests/energy_chartinfo.py` | energy override: sim layer + engine layer earned separately; chartinfo served from its exact-key cache, 400 on bad bbox (13, real console) |
| `python tests/enc_extract.py` | /api/enc: 400 usage, the cache answers, per-request shallow retag (exclusive boundary, disk untouched); shared bbox helpers guarded from BOTH suites; **and the depth-is-a-number trip-wire, fed the STRING form an S-57 cell produces** (15, real console) |
| `python tests/env_water.py` | env override REACHES the running boat + disable returns calm; waterlevel manual set/clear; bad input is a 400, never a dropped connection (11, real console) |
| `python tests/log_routes.py` | logevent survives colliding data keys (renamed, flat record); /api/logs lists the live session; safe_log_path serves ONLY bare asv_*.jsonl (9, real console, logging ON) |
| `python tests/data_routes.py` | vessel switch SAFE gate + energy-gauge flip; the comms password's THREE never-leak paths; tide answers; ROC HTTP error mapping (15, real console, logging ON) |
| `python tests/ais_error_frames.py` | an aisstream error frame SURFACES (state error, note names it), survives the quiet-box re-stamp, clears on real data (10, hermetic, scripted fake websocket) |
| `python tests/ais_sources.py` | many AIS feeds, ONE merged picture: per-vessel provenance, the stale-position guard, AISHub fault-as-data + per-response format detection, endpoint specs, a real AIVDM sentence over TCP and UDP (26, hermetic) |
| `python tests/tide_note.py` | the tide card names ONE cause ONCE (8) |
| `python tests/station_windows.py` | the third + fourth windows: station DERIVED from the fix, one shared opener, the IDW blend disclosed (24) |
| `python tests/docs_valid.py` | the generated documents are packages a reader will OPEN — and carry no note addressed to their own maintainer (8) |
| `python tests/http_contract.py` | BOTH servers: POST returns `(code, obj)`, GET commits its own response; nothing raises (26) |

**FOUR GENERATED DOCUMENTS in `docs/`** — quick start · operations · technical · development.
`cd tools && node build_docs.js` rebuilds all four; **never hand-edit a docx**. Shared
formatting in `tools/docx_kit.js`. Full table in "Keep docs current" below.

**THE WORK BEFORE THIS ONE (`eb6e34f` + `575855f`, 2026-08-08): THE THIRD AND FOURTH
WINDOWS — the NOAA tide page and the NDBC buoy page for the stations the VESSEL'S OWN FIX
selects.** The IDW over 3 proximal stations Andy asked for already existed in the water and
env monitors; what was new is the windows, and disclosing the blend instead of reporting it
under one station's name. No station id is hardcoded anywhere — check 1 enforces that by
AST. **Read "THE THIRD AND FOURTH WINDOWS" below.**

**THE SESSION JUST FINISHED (2026-08-08 → 08-09, "ASV console refinement") — FIFTEEN COMMITS,
TREE CLEAN, EVERYTHING PUSHED.** Andy drove it card by card from live use, and every
item below started as something he SAW on his own console — or, at the end, asked for. In order:

| commit | what |
|---|---|
| `eec6794` | ENV graphics scale with the card (**superseded, see `327ce0c`**) + **the SRC card lists EVERY chart in view** |
| `327ce0c` | ENV graphics REWRITTEN: one design space, one uniform scale (**then deleted whole in `324b1b7`**) |
| `1a9e7c1` | **the ROC card** — cap what survives at 3, and lock the test suites out of the operator's registry |
| `324b1b7` | **the ENV card is DELETED** — client card only; the environment itself still runs |
| `a548c14` | **the turn yields to the channel** — survey turns may only use channel water the lines occupy |
| `eb6e34f` | **the third window** — the NOAA tide page for the station the vessel's fix selects |
| `575855f` | **the fourth window** — the NDBC buoy page, same derived mechanism |
| `4e3b4e9` | **the chart measuring tool + the right-click menu** — and the latent right-click fault it exposed |
| `db0555b` | every suite now describes itself in the tech manual's derived harness table |
| `c6c4425` | measurement numbers 11 → 15 px, sized by **one** constant everything derives from |
| `7eceab5` | **Go-To / Spawn / Set Home leave the command bar** for the chart menu; gates become named predicates |
| `c752a30` | **Set Home takes the CLICKED POINT** (Andy's reversal of the old rule) + the keep-out warning |
| `5ca63d0` | the dev guide documents the mutation runner that damaged this repo twice |
| `d43c8bf` | `start_sim.bat` + `tools/asv.ico` — a double-click launcher for simulator mode |
| `0ac3ae6` | **a card is not a mode** — opening ROC no longer cancels SURV |
| `d742f42` | what "visible" means is the panel's property, not the caller's |
| `d1c11db` | **LAYER 0 LEAVES THE PAGE** — `static/js/{geodesy,geometry,units,state}.js` as ES modules |
| `f4d5376` | **the chart STATE moves; the code does not** — `nogo` + `sea` to `state.js` |
| `02c3f1c` | **the chart CODE follows** — 22 functions + 5 constants to `static/js/chart.js` |
| (this commit) | **RULE 9 + THE ROUTER LEAVE THE PAGE** — 18 functions to `static/js/passage.js` |

**⇒ THE CLIENT SPLIT IS COMPLETE (this commit). `static/js/passage.js`, 20 exports.** The
COLREGS Rule 9 keep-right lane and the keep-out router, **in ONE module because they are
mutually recursive** — the router asks for a lane, and building that lane asks the router
for a path. `gateLegClear` belongs with them despite reading like a clearance test.
`segSamplesEN` went to `geometry.js`; `laneUsed` became `sea.laneUsed`.
**ONE suite needed touching**, against seven for the combined attempts — the `MODSRC`
search path added with `02c3f1c` absorbed the rest automatically. **The page is 4,790 lines,
down from 5,979**; the six modules hold 1,471.
**⚠ THE BUG THE SUITES COULD NOT SEE, AND THE CHECK THAT NOW CATCHES IT.** `passage.js`
carried a **bare `CHANNEL_REACH_M`** — undefined in the browser, where that value lives on
`V`. **Every suite still passed**, because `buoy_lane`'s eval stubs `let CHANNEL_REACH_M =
null` into its own scope to exercise the default reach; the stub satisfied the reference.
The console threw *"CHANNEL_REACH_M is not defined"* the moment a route was planned for
real, and **only the live probe found it**. New **check 20** reads the module SOURCE for
bare vessel-parameter names across every module — a stub cannot mask a name that is never
resolved there. Mutation-verified: re-introducing the bare reference fails it.
**THE GENERAL LESSON: a harness that STUBS a global cannot tell you the shipped code needs
it.** Wherever a suite substitutes for the real world, that substitution is a blind spot,
and the cheap cover is a source-shape check rather than another runtime one.

**⇒ THE CHART STATE MOVED, THE CHART CODE DID NOT — AND THAT SPLIT IS THE POINT (this
commit).** `nogo`, `NOGO_ENF` and a new `sea` object (`enc`, `waterOffset`, `chartInfo`) now
live in `state.js`; every chart function is still in `asv.html`, reading them through those
objects. **This is step one of moving the chart model to `chart.js`, deliberately separated
so the file move that follows is pure cut-and-paste with no state change.**
**WHY IT IS SPLIT: I FAILED THE COMBINED MOVE TWICE.** Doing code and state together broke
**seven** suites at once, because they do not merely read those functions — they *drive*
them by assigning page globals. Both attempts were reverted rather than committed red.
Splitting it broke **three**, each a small scenario-setup change. **If a later step feels
like it is fighting the harness, the state and the code are probably moving together again.**
**`nogo` IS NEVER REASSIGNED** — 138 property writes, zero rebinds — so it exports as a
`const` object and its ~200 page references needed no edit at all. `enc`/`waterOffset`/
`chartInfo` **are** reassigned, so they are fields on `sea`.
**THREE REWRITE TRAPS, ALL PAID FOR:**
- **Never rewrite inside a string.** An earlier pass turned `"/api/enc?bbox="` into
  `"/api/sea.enc?bbox="` and the ENC fetch 404'd.
- **...but a TEMPLATE LITERAL is not just a string.** Protecting backticks wholesale left
  `${chartInfo.note}` unrenamed at `asv.html:5084`, and the SRC card broke. `${…}` holds
  executable code and must be rewritten; the literal text around it must not.
- **No `(?!\s*:)` lookahead.** Meant to skip object keys, it silently skips **ternaries**
  too (`waterOffset : (…)`), which is how four references survived a "complete" rewrite.
**`nogo_readout` needed the sharpest change:** it used to rebind `nogo` wholesale per
scenario. It now writes into the shared object and **clears the keys first** — `Object.assign`
cannot remove a field, so a model omitting `ko` would inherit the previous scenario's.
**⇒ AND THE CHART CODE FOLLOWED (this commit): `static/js/chart.js`, 27 exports.** The
two-step split paid for itself exactly as intended — **with the state already migrated, the
move rewrote NOTHING inside the function bodies**, and only three suites needed touching:
one leftover `H` where the widened helper wanted `HS`, two constants the suite pulled out of
the page by hand, and one eval-scope `const` that no longer leaked to an imported caller.
Compare that to the seven-suite breakage of the combined attempts.
**HOW THE SUITES FIND IT NOW: `MODSRC`.** Each suite's `grab()` / `grabDecl()` searches the
page AND `static/js/*.js` with `export ` stripped, so a declaration reads exactly as it did
when it sat in the page. **This is a deliberate half-measure.** Layer 0 converted its suites
to real `require()`s, which is better — but Layer 0 moved small PURE functions that suites
merely CALLED, while these 22 are woven through eval'd page code in half a dozen spellings,
and two automated rewrites damaged suites faster than they fixed them. Widening the search
path is one edit per suite and cannot change what any check asserts. **Converting suites to
real imports one at a time remains worth doing, off the critical path.**
**3/3 mutations caught** — `blocked()` always clear, the wreck's intrinsic extent collapsed
to a point, the water-trust distance threshold defeated — so the suites really do bind to
the module. Two of those registered as CRASHES rather than clean check failures: the same
reportability gap recorded for `home_spawn` 2e, noted rather than counted as a pass.
**STILL IN THE PAGE, AND TOGETHER ON PURPOSE:** the Rule 9 lane and the keep-out router.
They are mutually recursive — the router asks for a keep-right lane, and building that lane
asks the router for a path — so they move as ONE unit or not at all, and `gateLegClear`
belongs with them despite reading like a clearance test.

**⇒ THE CLIENT NOW HAS MODULES (this commit). READ THIS BEFORE TOUCHING `static/asv.html`.**
The page is a **`<script type="module">`**, and its lowest layer lives in `static/js/`:
`geodesy.js` (zero imports), `geometry.js`, `units.js` (owns the km/nm preference outright),
`state.js` (the vessel-derived parameter block). Served by a new whitelisted route,
`safe_js_path`, **guarded exactly like `safe_log_path`** because both turn a URL into a file
read; `http_contract.py` 23–26 probe it live, including nine traversal and near-miss
spellings and the JavaScript MIME type (a wrong type fails as a BLANK CONSOLE, not a 404).
**THE TWO RULES, which are one rule twice over:**
- **FUNCTIONS are imported BY NAME.** A function binding is never reassigned, so moving one
  costs **zero call-site edits** — 142 call sites needed no change.
- **SHARED MUTABLE STATE goes through an object and is NEVER destructured.** An ES module
  namespace is **sealed**: `import * as S` then `S.x = 1` throws `TypeError`. I claimed the
  opposite in the analysis and had to correct it — **measured, not assumed**. And
  `const {NOGO_BUFFER_M} = V` copies a value a vessel switch later changes silently, in the
  direction that gives a deeper boat LESS clearance. Always `V.NOGO_BUFFER_M`.
**WHAT IT BOUGHT:** eleven suites stopped regex-ing functions out of HTML and now
`require()` the real modules (Node 24 supports `require()` of ESM). A renamed export is a
**load error** now, not a silent "helper not found"; `turn_geometry`, `buoy_lane` and
`turn_channel` call the shipped `distTo`/`llEN` themselves.
**VERBATIM MATTERS:** `toEN`/`fromEN`/`llEN` keep the unfactored `*M_PER_DEG_LAT*Math.cos(…)`.
Hoisting that product reads better and is **not the same number** — IEEE-754 multiplication
is not associative, and this is the frame the keep-out routing and the Rule 9 lane are
computed in. A move whose whole claim is "no behaviour change" should not spend its
credibility on a tidier line.
**8/9 mutations caught.** The survivor was real: nothing owned `state.js`'s **shipped**
depth floor, because every `nogo_readout` check seeds its own first — now check 15. **Three
"catches" were CRASHES rather than clean check failures** — those suites die in scenario
setup instead of failing a check, the same reportability gap `home_spawn` 2e had. Recorded
as a known gap, not quietly counted as a pass.
**HOOK:** the pre-commit path filter is `*static/*` now, not `*static/asv.html*` — a change
to a module alone would otherwise have run nothing.
**A TOOLING TRAP THAT COST FOUR ATTEMPTS:** a `<<'PY'` heredoc in this environment **strips
one backslash level**, so a Python `"\\n"` arrives as a REAL newline. It kept landing inside
JS regex literals and I misdiagnosed it as CRLF three times. **Write patch scripts to a
file and run them; do not pipe them through a heredoc.**

**⚠ A CARD IS NOT A MODE (`0ac3ae6`) — DO NOT PUT THE `setMode` BACK.** Andy, live:
"the selection of ROC chip deselects the SURV chip, although the active mission data
preserves on re-selection." Right on both halves — the drawn pattern DOES survive (it is
kept across mode switches on purpose), and what was lost was only the MODE. Cause:
`$("#rocBtn").onclick` opened with `setMode("pan")`, commented as hiding "any mode panel
behind it". **`#rocPanel` and the mode panels (SURV / BND / SRCH / TRAN) are all `.panel`,
so they shared one default position — `left:14px; top:96px` — and the ROC card opened
directly on top of them.** The cure closed the operator's mode instead of moving the card,
so glancing at HOME mid-layout cost you your drawing mode.
**Two things made it wrong rather than a trade-off:** it was the ONLY card that did this
(LINES, SRC and AIS never have — they sit at their own coordinates), and it was
**UNCONDITIONAL while the collision was not** — the ROC card's position is persisted, so for
anyone who had ever dragged it there was no overlap left to justify cancelling anything.
**Fixed where the problem actually lives:** the `setMode` is gone and `#rocPanel` now
defaults to `left:186px` (14 + the mode panels' 158 px = 172, so a 14 px gap).
**Both halves are load-bearing** — remove the `setMode` alone and you restore the overlap it
was papering over, which is why checks 24 and 25 are a pair. `panel_drag.js` 23 → 26,
**5 mutations, 0 survivors**, including the shipped bug restored and a variant using a
DIFFERENT mode so the check cannot pass by keying on the string `"pan"`. Live-measured with
both cards open: SURV 14–172 px, ROC 186–438 px, **overlap false**, mode still `survey`,
both chips lit, anchors intact. **`armRocPlace` still calls `setMode("roc-place")` and must
— arming a placement IS a mode change, because the next chart click means "put a ROC here".**
**A TEST-WRITING TRAP HIT ON THE WAY, the third instance of this shape here:** my first
check 24 searched a fixed window after the handler for `setMode(` — and FAILED against the
FIXED code, because **the comment explaining the removal quotes the very call it removed.**
Same family as `roc_persist.py` matching its own source text. It now brace-matches the
handler's real body and strips comments first: **a source-shape check must read CODE, not
prose about code.**

**THE FOLLOW-UP ANDY ASKED FOR — WHAT "VISIBLE" MEANS IS THE PANEL'S PROPERTY, NOT THE
CALLER'S.** Found while measuring the fix above: the ROC card opened as `display:block`,
overriding `.panel`'s `display:flex`, so it silently lost the **6 px row gap** every other
`.panel` has. `showPanel(el, show, display)` defaulted to `"block"` and expected each caller
to pass `"flex"` — **exactly one of eight call sites did, and the ROC card is shown from
THREE.** A per-caller hint is the wrong mechanism when the answer is a property of the
element: it is derived now, `el.classList.contains("panel") ? "flex" : "block"`, and the one
site that passed the hint no longer needs to. Measured live with both cards open: SURV and
ROC both `flex` / `column` / `rowGap 6px`, ROC 264 px tall and fully on screen, still no
overlap. `panel_drag.js` 26 → 29.
**AND THE MUTATION THAT SURVIVED IS THE LESSON:** check 26c matched
`showPanel\([^)]*"block"\)` — a character class **cannot cross a `)`**, so
`showPanel($("#linePanel"), mode==="survey", "block")` hid its third argument behind the
`)` of `$("#linePanel")`, and the mutation restoring a hard-coded display went undetected.
It extracts each call with **balanced parens** now. **A check that reads a CALL has to parse
the call** — nested parentheses are normal in every real call site, so a regex over
arguments is wrong by default, not by accident.

**THE FOUR THAT STILL MATTER, and each has its own section below:**
- **THE TURN YIELDS TO THE CHANNEL** (`a548c14`) — the safety one. Turns arced 34 m into
  the Lewes dredged channel across a charted pile row. Built 08-07, **HELD at his
  instruction while he tested his own approach**, completed on his word 08-08 and
  re-verified whole first (it had been carried across three commits by patch
  re-application). **Read it before touching punchOut's keep-out plumbing.**
- **THE ENV CARD IS DELETED** (`324b1b7`) — scoped with him BEFORE cutting, because the
  card held three separable things. The CLIENT card is gone; `EnvMonitor`, `/api/env`,
  the wind/wave forcing and the water-level correction all still run. **Read it before
  re-adding anything environmental** — and note it retired `327ce0c` and half of
  `eec6794` from the same day, both recoverable there if he ever wants the rose back.
- **THE ROC CARD** (`1a9e7c1`) — the Remove button he reported as broken was CORRECT;
  198 stale ROCs (written by our own test suite, one per run) made it look dead. Capped
  at 3, suites locked out with `--roc-config`. **Read it before touching the registry.**
- **THE SRC CARD LISTS EVERY CHART IN VIEW** (`eec6794`) — one row per ENC cell,
  broadest scale first, the vessel's own marked.

**FIVE THINGS THIS SESSION COST TIME TO LEARN. They are general, and three of them are
about CHECKS THAT LOOKED LIKE CHECKS:**
- **A geometry check on the CONTAINER cannot see a composition that does not scale.** The
  first ENV-graphics fix measured the canvas box — perfect at every size — and shipped;
  Andy came back with "still distorted". The ring had been round all along; the 9 px
  labels and 1 px strokes were what did not scale. **Measure the INK.**
- **A control that is correct but smothered by data reads exactly like a broken one.**
  Reading the ROC Remove handler found nothing, because there was nothing to find.
- **A harness that launches the real app in the app directory writes the operator's real
  files.** `http_contract.py` had been adding a ROC to his own registry on every run.
- **KNOW WHICH HARNESS TAKES A THUNK.** `ui_split.js`'s `check()` reads `cond` directly,
  so an arrow function is an object, an object is truthy, and the check passes forever. I
  shipped exactly that and only caught it by making it fail on purpose.
- **A source-shape check whose pattern occurs in ITS OWN source will match itself.**
  `roc_persist.py`'s "no suite may write the registry" audit put itself in its own set
  and passed on its own text; it parses the AST for a real call now.

**Previous headline (2026-08-05): MULTI-SOURCE AIS — many feeds, one merged
picture** (aishub + multi-endpoint nmea + opencpn sources, merge provenance, the
stale-position guard, and the collect-radius ordering fix). New suite
`tests/ais_sources.py` (26, 6/6 mutations). **See "MULTI-SOURCE AIS" below before
touching the AIS layer.** One new parked credential: AISHub membership (OPEN/NEXT).

**DOCS-ONLY COMMITS, 2026-08-05 (after the coverage thread) — THE PRESENTATION. No code
touched; the suites owe nothing here.**
- `528ab59` — **`docs/ASV-Console-Programming-by-Conversation.pptx` added** (graduate-level
  deck: this project + the DES schema from Andy's case-study series). **NOT generated** —
  see the exception note in "Keep docs current" before assuming `tools/` builds it. README's
  Documentation section updated in the same commit.
- `8370618` — `.gitignore` gains `~$*` (Office drops a lock file beside an open deck; with a
  pptx in `docs/` those would recur as untracked noise).
- `548d1eb` — **the deck gains an ASV effort-economics estimate** (now 14 slides):
  unaided professional ≈200 person-hours by the papers' own PERT method (10 components,
  tabled on its own slide; UI and test infrastructure dominate, not discovery) vs ≈30 h
  measured from the repo itself — 109 commits clustered into 27 bursts at a ≤60-min gap.
  ≈7×, smaller than the small tools' 10–16×, exactly the series' scaling caveat. The slide
  names the new bias plainly: the estimate was produced by the development agent grading
  its own work.
- (this commit) — **the deck generator moved INTO the repo: `tools/build_deck.js`**
  (Andy's call, reversing the scratchpad note `548d1eb` carried). `npm install` in
  `tools/` now covers it (pptxgenjs added); icons pre-rendered in `tools/deck_icons.json`
  with `build_deck_icons.js` to regenerate them. **Rebuild verified byte-identical** on
  `ppt/slides/*.xml` against the committed deck, so the rebuilt pptx was NOT committed —
  zip-timestamp noise, the same rule as the docx set. Full notes in "Keep docs current".

**THE SESSION JUST FINISHED ("ASV console refinement", 2026-08-02 → 08-04) — SEVENTEEN
commits.** Andy's scope was a POLISH pass: no new features; tighten, delete special cases,
verify by pixels, refresh docs. It ran well past that, because five faults he reported live
and four audits he asked for turned up real defects. **Read the first six entries below
before touching anything** — they are the ones a fresh context is most likely to undo.

**IF YOU READ ONLY ONE THING:** four of this session's bugs were things that LOOKED verified.
A green suite hid a server crashing on every request; a byte-identical hash hid four Word
documents that had never opened; a passing check compared two responses that were identical
because the registry was empty; another asserted a field was NAMED for km while it held nm.
**Verify against something entitled to refuse you** — a reader, a real Word, the server's own
stderr — not against the previous output.
- **the retired keep-right is deleted** — 595 lines, 10 % of `static/asv.html`.
  `keepRight`, `channelEndExtend`, `gateProject`, the colour system (`buoyageDir`,
  `buoyLaneAt`, `crossToLine`) and the write-only `lastBuoyage` had been left in place
  after the 2026-07-31 lane port as a recorded "lower risk" divergence; that divergence is
  now CLOSED and this matches the sibling. **No behaviour change** — nothing referenced
  them but each other, so no doc rebuild was owed. See "CHANNEL LANE".
  **Two things the cut exposed that the dead code had been hiding:** `planNogoRoute`'s
  descriptive comment had drifted 46 lines up onto `pairGates` (the gate-projection
  paragraph in between was what separated them), and `pairGates` — which is LIVE, for
  `channelSpanKeepouts` — had no comment of its own describing what it actually does.
  **Deleting dead code is not only tidying: it re-joins things the corpse was holding apart.**
- **one drag mechanism for the pop-out panels** — SIX panels (vessel card, SURV, LINES, AIS
  table, SRC, ROC) each carried a hand-copied drag: restore block, mousedown, a window
  mousemove and a window mouseup. Six copies meant **six handlers ran on every pointer
  move** so five could discover they were not dragging. Now one
  `makeDraggablePanel(el, head, {key, unanchor, ignore, persist})` + one `panelDrag` +
  ONE pair of window listeners. **The drift the copies had already produced: the SRC card
  never persisted its position** — its mouseup cleared the drag and saved nothing, so it
  was the one pop-out that forgot where you put it, while the ops manual had been
  promising since `3080e6a` that the console "remembers your card positions". Fixing the
  mechanism fixed the claim. New suite `tests/panel_drag.js` (11), **9 mutations verified**.
  Ops manual updated + rebuilt (the only docx that changed).
- **NONE OF THE FOUR WORD DOCUMENTS HAD EVER OPENED** (Andy tried to; Word refused all four).
  **Not a regression — broken since `2a28a59`, the day the first one was generated,** across
  eighteen commits. `CODE()` returns an ARRAY of paragraphs while every other helper returns
  one object, and every builder wrote `c.push(CODE([...]))`, pushing the array as ONE child.
  The serializer emitted it as the literal element **`<0/>`** — an element name cannot start
  with a digit — so `word/document.xml` was **not well-formed** and Word refused the file.
  **Worse than the validity error: the array's CONTENTS were dropped**, so every code block in
  every document was missing — the Quick Start did not contain `python asv_console.py --sim`,
  which is most of why it exists. Fixed by **flattening in `write()`** (`children.flat(Infinity)`),
  which repairs all six call sites at once and makes the next list-returning helper safe.
  **HOW IT SURVIVED, and this is mine to own:** the build printed `written: <name> N bytes`
  for every file; rebuilds never errored (a malformed child is still a valid ZIP entry); and
  **I repeatedly checked `word/document.xml` was BYTE-IDENTICAL across rebuilds and reported
  that as safety.** It was byte-identical. It was identically broken. **A hash proves
  STABILITY, never CORRECTNESS — compare against a READER, something entitled to refuse it.**
  New suite **`tests/docs_valid.py`** (7): every part well-formed, every part declared in
  `[Content_Types].xml`, every relationship target present, every `r:id` resolvable, **plus a
  CONTENT check** — filtering the arrays away instead of flattening yields four VALID
  documents with every code block still missing, and only the content check separates those.
  The expected code lines are **parsed out of the builders**, so a new block is covered the
  day it is written. **2 mutations verified.** Confirmed against real Word at both ends: the
  committed files were refused with "Word experienced an error trying to open the file"; the
  rebuilt ones open at 16 / 15 / 10 / 3 pages. **The hook's path filter did not cover `tools/`
  or `docs/`** — editing a builder ran nothing — now widened.
- **DOCUMENT CONTENT BROUGHT CURRENT** in the same pass (Andy's request). Ops manual: card
  height cap + lists patched in place (scroll and selection survive) + a new **7.3 on the two
  kinds of tide failure**, with 7.3 renumbered to 7.4. Technical manual: the **stale
  `AIS display radius` row claiming the display radius "also scales the upstream subscription;
  the two must move together"** — an invariant DELETED in `1166068` — replaced with the real
  `AIS_SHOW_RADIUS_KM` / `AIS_COLLECT_RADIUS_KM` pair; and **13.1's harness table is now
  DERIVED from `tests/`** (it said "Fourteen" when there were twenty — same list-beside-a-
  directory drift as the hook). Development guide: case study **8.6 "the deliverable nobody
  opened"**, and a fourth recurring defect shape, **6.4 "a check that cannot tell the bug from
  the fix"**, which this session hit three times (hash-vs-correctness, a filter test with
  nothing to filter, asserting a field's NAME instead of its VALUE).
- **AIS AT LEWES: "many vessels west, none in Delaware Bay" — THE CONFIG WAS FINE.** Andy
  asked for the aisstream configuration to be checked. **It is correct**, verified end to
  end: the subscription box is built as `[[lat_min,lon_min],[lat_max,lon_max]]` (what
  aisstream wants) and computes to `-77.24,37.17,-73.09,40.41` — covering the bay AND the
  Chesapeake; `_ingest` reads MetaData lat/lon with a body fallback, no swap or sign error;
  `Registry.snapshot`'s bbox test is right. **Then measured with his key against that exact
  box: 94 vessels, 101 reports in 90 s, no errors — and the NEAREST of all 94 was 81.6 km
  (44 nm).** Sector split W 59 / N 15 / NW 14 / NE 4 / SW 2, matching his report exactly;
  only 3 in the bay at all, 90–102 km up near the C&D canal. **aisstream simply has no
  receiver inside ~44 nm of Lewes** — not even the Cape May–Lewes ferry. Volunteer network,
  so coverage is where the volunteers are. **`--source` takes a COMMA-SEPARATED list and
  `nmea` already exists**, so `--source aisstream,nmea` + a local receiver is the answer if
  local traffic ever matters.
  **WHAT THAT EXPOSED, and what was fixed:** the card said `no vessels in 27 nm yet`, which
  **reads like a dead feed when the feed is healthy**. The client CANNOT tell the difference —
  the range filter runs on the SERVER, so the browser never sees what was excluded. The area
  block now carries **`nearest_km`** (nearest COLLECTED, from the loop that already measures
  every vessel — free), and the empty card reads `none within 27 nm · nearest 44 nm of 94
  tracked`. Still says `no vessels in … yet` when nothing is tracked anywhere, and a LAKE
  reports no nearest at all — there is no filter to widen, so offering one would be a lie.
  `ais_range.py` 15 → 20, **3 mutations verified**. Ops manual updated + rebuilt.
- **THE TIDE NOTE SAID ONE CAUSE TWICE** (Andy, live, on the ENV card): `no observed data
  (fetch failed: HTTP Error 502: Bad Gateway) · fetch failed: HTTP Error 502: Bad Gateway`.
  **The 502 was NOT ours** — every request shape the console sends was replayed against NOAA
  CO-OPS by hand and all four answered **200**, including the exact Lewes calls; a transient
  outage at their end. The console already degraded correctly (never raises, shows a note,
  and `drawTide()`'s success path resets both the text AND the colour, so it self-clears on
  the next good fetch — checked). **What was wrong was only what the operator had to read.**
  Observed and predicted are two independent calls to the SAME upstream, so one outage fails
  both identically and the note joined them verbatim. The repetition added nothing and
  **HID the fact that BOTH series were gone**, not just the observed one. Now
  `no observed data and no predictions (…)` — one sentence naming both losses and the single
  cause; two DIFFERENT failures are still reported separately. Split out as a pure
  `tide_note(past, pred)` so it runs with no network. New suite `tests/tide_note.py` (8),
  **5 mutations verified**.
  **A MUTATION-TESTING TRAP LEARNT HERE, and it applies to every Python suite:
  `__pycache__` can serve a STALE `.pyc`.** Rewriting `asv_console.py` repeatedly in a loop
  puts several versions inside the mtime granularity Python uses to validate its cache, so a
  run imports the PREVIOUS mutation's bytecode. Nothing crashes and nothing looks wrong —
  one mutation was graded against the wrong code and reported check 2 instead of check 1,
  and the same mechanism could report a live mutation as CAUGHT when the test never ran
  against it. **Set `PYTHONDONTWRITEBYTECODE=1` (or delete `__pycache__`) when mutating a
  Python source.** Confirmed by re-running with the cache disabled: the numbers then matched
  the isolated runs exactly. The JS suites are immune — Node has no equivalent on-disk cache.
- **THE AIS TRAFFIC LIST IS PATCHED, NOT REBUILT** (Andy: "blanks and rewrites every
  cycle"). `renderAisTable()` assigned `el.innerHTML` on every poll, so **every 8 s the whole
  body was destroyed and re-created**. Three costs at once, and the first is the one that
  actually hurts: the card is `.rsz` (`resize:both; overflow:auto`) so the list SCROLLS —
  rebuilding **reset the scroll position while you were reading it**; it **dropped any text
  selection** mid-copy of an MMSI; and it flashed. Rows are now keyed by **MMSI** and reused,
  only cells whose text CHANGED are written, re-sorting **moves** the node with `insertBefore`,
  and contacts that leave are removed. The row map is **derived from the DOM each cycle**, not
  kept alongside it — a parallel map would go stale the moment the card is closed and reopened.
  **`setCellText`'s guard is not an optimisation:** writing an identical string still collapses
  a selection inside that node, which is why a selection survives a poll where nothing changed.
  New suite `tests/ais_table.js` (9), **8 mutations verified**; live-verified in a browser for
  the parts source-shape cannot see (same node across a poll, `scrollTop` held at 90, the
  selection "VESSEL 5" intact, values still updating 1.5 → 6.9 nm, add/drop/re-sort, empty and
  refill). No doc change owed — the manual never described the flashing.
  **AND THE CARD HEIGHT IS NOW CAPPED** (Andy's call, same session). `max-width:96vw` had
  always said a card may not grow past the screen; **height had no cap at all**, so a card
  sized by its CONTENT ran off the bottom — those 40 contacts made it **797 px in a 720 px
  viewport** with the rest of the list unreachable. `max-height:82vh` on `.rsz` AND on the
  controls window's `.uicard` wrapper (the resizable element there, uncapped for the same
  reason). 82vh leaves room for the ~100 px cards sit down from the top, so a card at its
  normal place is fully visible **without `clampPanelPos` having to haul it upwards**.
  **THE TRAP IT WOULD HAVE FALLEN INTO:** `makeCardsResizable` wrote `el.style.maxHeight =
  "none"` on restore AND on mousedown, to release "the default height cap". **No card has ever
  carried a card-level max-height** — those live on the BODIES, which `.rszbody` already
  overrides — so it released nothing and was DEAD. It was harmless only while `.rsz` had no
  cap: inline beats a stylesheet rule, so **the first mousedown on any card would have uncapped
  it for good.** Both writes deleted; check 17 asserts no inline `maxHeight` write returns.
  Display-only, like the position clamp: a stored 900 px height renders at 590 and **stays
  900 px in storage**, so a taller monitor still honours it. `ui_split.js` 14 → 17.
- **THE AIS RANGE CONTROL READS IN NAUTICAL MILES** (Andy's call). The contact list had
  always reported range in nm via `fmtNm`, so a selector in km meant **filtering in one unit
  and reading distances in another**. Converted at the DISPLAY EDGE: `M_PER_NM = 1852` +
  `nmFromKm`/`kmFromNm`/`nmRound`; **the wire is untouched** — `/api/ais/radius` still takes
  `km`, `AIS_SHOW_RADIUS_KM` and the `--ais-radius-km` / `--ais-collect-km` flags are
  unchanged, and every wire field is still named `_km`. That is this console's standing units
  rule (chart tiles print feet, all data and maths are metric), and it is why the flags keep
  their names. Default is unchanged behaviour: 50 km opens the control at **27 nm**.
  **A SECOND FIELD SERVING TWO MASTERS, found on the way:** `area.name` was a real place name
  on a lake (`"Lake Erie"`) and the string `"%g km"` at sea — so the SERVER was choosing the
  client's display unit. The sea branch no longer sends `name` at all; `aisAreaLabel()`
  derives it from `show_km`, and the lake keeps the one name the client cannot derive.
  `tests/ais_range.py` 9 → 15, **6 mutations verified**. **The one that nearly got through:
  asserting only that the request body is KEYED `km` still passes when the raw nm value is
  posted** — type 27, the server stores 27 km, the field redraws as 15 nm. Silently wrong by
  1.852 with a plausible number on screen. Check 8e now asserts the conversion in BOTH
  directions. Ops manual updated + rebuilt (the only docx that changed); it also now records
  that the CLI flags stay in km.
- **one guarded way into `localStorage`** — sixteen hand-written `try`/`catch` blocks around
  `JSON.parse`/`stringify` across eight keys, now `lsGet`/`lsSet`/`lsDel`/`lsBool`. **The
  guard is not decoration:** `localStorage` throws on ACCESS where site data is blocked and
  `setItem` throws on quota, so one bare call takes out start-up — sixteen copies is sixteen
  chances to omit it. **The migration is the risk, and it is tested:** the three display
  toggles were stored as raw `"1"`/`"0"` predating the JSON store, so `lsBool` reads both
  (`JSON.parse` turns `"1"` into `1`). Nobody's saved toggles reset; verified in a browser
  seeded with legacy values, all three non-default. `lsGet` tests `== null`, NOT falsiness —
  the old `JSON.parse(...) || {}` could not tell a stored `false` from a missing key.
  New suite `tests/stored_settings.js` (11), **7 mutations verified**.
  **`panel_drag.js` check 10 failed on this change and was right to** — it named the raw
  `localStorage.setItem` shape; re-pointed at `lsSet` and re-mutated to confirm it still bites.
- **`/api/ais/radius` RAISED ON EVERY CALL** — Andy pasted the traceback from his running
  console. `_dispatch_post`'s contract is `(code, obj)`; that one handler was written in the
  `do_POST` style and did `return self._send(...)`, which returns **None** → `code, obj = None`.
  **`_send` had ALREADY written a correct 200 to the socket**, so the client saw a healthy
  response and the raise happened after — killing the handler thread and, quietly, skipping
  `LOG.command()`, so the session recorder has been missing every AIS radius change since
  `1166068`. Only site: the other ten `return self._send(...)` are in GET handlers, where
  returning None is right.
  **WHY THE SUITE WAS GREEN: `tests/ais_range.py` sent the console's stdout AND stderr to
  `DEVNULL`.** Check 7 asserted the clamp and got a correct answer, from a request that then
  crashed its thread. All three real-console harnesses did this. They now capture the server's
  output to a temp file (not a PIPE — nothing drains it, so a full buffer would hang the test)
  and assert **the console logged no exception**: `ais_range` 9, `live_speed` 10,
  `completion_modes` 11. Mutation-verified in all three, including restoring the exact
  shipped bug. **THE RULE: a client-side assertion cannot see a server that answers correctly
  and then dies. If a test drives a real process, read that process's output.**
- **AUDITED THE OTHER POST HANDLERS** (Andy asked; the answer is that `/api/ais/radius` was
  the only one). Done three ways, because a grep only finds the shape you already know:
  **AST** — all 29 returns in `_dispatch_post` are 2-tuples, it is the only function whose
  result is unpacked into two names, and no GET handler returns a tuple nobody sends (the
  mirror bug); **reachability** — the function cannot fall off the end and return `None`
  implicitly; **live** — all 26 endpoints plus 11 ROC ops POSTed against a real console, all
  answered, server log clean. Kept as `tests/post_contract.py` (10) — **renamed to
  `tests/http_contract.py` in the very next commit** when the GET side joined it, so that is
  the file on disk — which **parses the endpoint list out of the source**, so a new POST
  route is covered the day it is added.
  **Checks 7 and 10 do not subsume each other:** a raise BEFORE the response leaves the
  client with nothing (7 sees it); a raise AFTER `_send` has already answered — the bug that
  shipped — is invisible to every client-side check and only the server log shows it (10).
  **Mutation-writing gotcha recorded there:** the handlers are an `if path == …: return`
  chain, so a raise injected before the branch that already handles that path is unreachable
  and the mutation silently does nothing — my first attempt looked like a surviving mutant.
- **AUDITED THE GET HANDLERS TOO** (Andy asked; also clean — no source change). **The GET
  contract is the MIRROR of the POST one:** `do_GET` and its `_serve_*` helpers are VOID and
  each must commit its OWN response. On the POST side *sending* is the mistake; on the GET
  side *not sending* is. Suite renamed `post_contract.py` → **`tests/http_contract.py`** (16),
  covering both — the question is the same and both halves share one console.
  Checked: every path of all 7 GET handlers commits a response; the dispatch chain ends in an
  `else` (an unmatched GET would otherwise commit nothing); all 25 routes incl. the
  400/404 branches answered live; the SSE stream commits headers + a first frame.
  **FALSE POSITIVE WORTH NOT RE-DERIVING:** the first analysis flagged `_serve_tile` and
  `_serve_events` as non-responding. They are fine — a **binary PNG** and an **endless SSE
  body** cannot go through `_send`, so they use raw `send_response`/`end_headers`/`wfile.write`.
  **`end_headers` is the moment a response is committed** and must be in the sender set.
  **Three PAIRS of checks that look redundant and are not** (each half verified by its own
  mutation): **10 vs 16** — a raise BEFORE the response leaves the client with nothing; a raise
  AFTER `_send` is invisible to any client check. **13 vs 14** — a handler that RETURNS without
  sending closes the connection (no response); one that BLOCKS looks like a slow request; only
  a `sleep` produces 14. **6 vs 13** — static reads paths no request reaches, live catches what
  the analysis is too coarse to see.
- **`ais_service.py` AUDITED TOO — and it produced the one real FINDING of the three audits.**
  A SECOND HTTP server, own process, own port, so nothing in the console's checks covered it.
  Structurally clean (GET-only, every path sends, unconditional 404 fall-through; `bbox`/`max`
  guards hold against nan/inf/bad arity). **But its query parser never percent-decoded**, so
  `?bbox=1%2C2%2C3%2C4` — a legal spelling — was silently dropped and the caller got the
  **WHOLE registry instead of the box**. Not a live bug (the console sends plain commas) but
  the wrong way to fail. Fixed with `urllib.parse.unquote`, strictly more permissive; the
  explicit `import urllib.parse` matters because it was only arriving via `urllib.request`.
  Suite 16 → 22, now covering both servers.
  **THE TEST LESSON, the sharpest of the session:** my first check 20 compared the two
  responses over the wire and **PASSED with the fix reverted** — with no AIS source the
  registry is EMPTY, so a dropped box and an honoured one both return zero vessels,
  byte-identical. It now runs the real parsing code on both spellings. **When a fix changes a
  FILTER, a test with nothing to filter cannot see it.**
  **AND A MUTATION TRAP:** `asv_console.py` is **LF**, `ais_service.py` is **CRLF** — a
  multi-line anchor written with `\n` matches one and not the other. Two mutations reported
  SKIP; only because the runner scores a missing anchor as SKIP rather than "caught" did that
  surface instead of reading as clean passes.
- **`roc_tracks.py` + `gps_sim.py` AUDITED — a second real finding, and a worse one.**
  Not HTTP, so the contract differs: **a background thread must survive bad input.**
  `gps_sim.py` is CLEAN (`TcpServer` reaps dead clients under its lock, `_accept` handles
  `OSError`; its fixes round-trip through `parse_nmea` to <4 cm at the poles, the dateline and
  a negative course). **`parse_nmea` was NOT:** speed and course used a bare `float()` while
  the position fields beside them used `_nmea_deg`'s guard — **one function, two standards.**
  A **checksum-VALID** sentence can still carry rubbish (8-bit XOR, ~1 corruption in 256
  passes; a flaky receiver can checksum an already-mangled buffer), so `float("abc")` raised,
  unwound `GpsFeed`'s read loop, closed the socket, and was swallowed by `run()`'s catch-all —
  **THE GPS LINK DROPPED and reconnected 3 s later.** Measured before: **2 TCP connections,
  6 of 8 fixes**; after: **1, all of them.** Fixed with `_nmea_float` (garbage → `None`,
  exactly as an empty field already behaved — a bad speed is no reason to bin a good
  position), plus a `try` in `_emit` as a **blast-radius limit at the thread boundary** (not a
  duplicate guard: that feed can be driving a moving HOME for a boat recovering to a
  mothership, so one malformed line must cost one line).
  **THE TWO LAYERS WERE EARNED SEPARATELY — the technique worth reusing:** revert the parser
  fix with the `_emit` guard PRESENT and 18/19 fail but **21 still passes** (the guard held the
  link); remove BOTH and 21 fails too. Removing the guard ALONE survives, and that is correct —
  with the parser honouring its contract there is nothing left to catch.
  **A GAP THE ROUND-TRIP COULD NOT SEE:** dropping `%07.4f`'s zero-pad survived every check,
  because `parse_nmea` splits at a fixed offset and still reads it — malformed on the wire,
  fine for its sibling. Check 23 asserts NMEA's fixed widths directly. 17 → 23 assertions.
- **THE VESSEL CARD WAS ABSENT FROM THE CHART** (Andy, live). **Not hidden and not broken —
  `display:block`, fully live, at a position saved when the window was bigger, sitting
  outside the viewport.** The DRAG had always clamped to the chart; **RESTORE never did**, so
  a position from a larger window or a second monitor came back verbatim. Pre-existing, not
  from the drag consolidation — `git show e0e3e8c^` has the same unclamped restore — but the
  consolidation is why there was one place to fix it for all six pop-outs. **The vessel card
  was the cruel case: `placeVcard()` puts its VESSEL reopen pill at the SAME coordinates, so
  the one control that brings the card back went off-screen with it.** Now `clampPanelPos` +
  `placePanel`, shared by restore, drag and a new `resize` listener.
  **Three properties worth keeping:** the clamp is **DISPLAY-ONLY** (a card parked at a big
  monitor's edge returns there when the window is big again); the resize re-clamp re-derives
  from **STORAGE, not the DOM**, or it would RATCHET; and `placeVcard` **sets visibility
  BEFORE measuring**, because a `display:none` card measures 0×0 and would be clamped by the
  sliver rule on the very reveal meant to rescue it — I shipped that bug and caught it by
  measuring in the browser, and check 20 now guards the ordering.
  `tests/panel_drag.js` 11 → 20, **8 mutations verified**. Ops manual updated + rebuilt (the
  other three docs' `word/document.xml` are byte-identical, so only that one is committed).
- **`showPanel()` — ONE way to show a floating panel** (closes the residual above, Andy's
  call). The pop-outs were shown from **SEVEN** bare `style.display = …` sites — I found five
  on the first sweep and the grep caught two more ROC auto-opens — so a panel restored while
  hidden kept the 0×0 sliver clamp and revealed with only a corner on the chart. `showPanel`
  shows AND re-clamps, **in that order**. It does **not** persist: a reveal only tightens what
  is on screen now, so the operator's stored position still governs the next restore.
  `clampPanelPos` + `PANEL_MIN_VIS` **moved up beside `mapEl`** — `showPanel` is called from
  `setMode` and toolbar handlers that can run before the pop-out section executes, and a
  `const` read before its declaration is a **ReferenceError, not `undefined`**. Note
  `#v_mission` is a SECTION of the vessel card, not a pop-out — it keeps its own
  `style.display`. `tests/panel_drag.js` 20 → 23, **5 more mutations verified**; check 21
  derives the panel list from the registrations, so a seventh pop-out is covered the day it
  is registered. Live: every keyed pop-out seeded at `{4000,3000}` while hidden now reveals
  FULLY inside the chart.
- **the lane fact travels WITH its route** — `channelLaneRoute` now returns `{route, lane}`
  and `buoyageNote(lane)` takes it as an argument; the module flag `lastChannelLane` is gone.
  I raised the stale flag as *inert* (a refusal returns before any reader) — **it was not.**
  Looking properly found a SECOND, live fault in the same flag: `routePlan` calls
  `channelLaneRoute` ONCE PER LEG, and the reset at the top of that function meant only the
  **last leg counted**. Proven at Lewes on the real ENC — a transit out of the canal into
  Delaware Bay rides the lane on leg 0 and open water on legs 1–2; the plan now reports
  `true`, **the old flag would have said `false`** and dropped the Rule 9 note from a
  transit that genuinely rode the lane. `routePlan` accumulates (`lane ||= kr.lane`) and
  returns it; the two search/survey call sites that only ever wanted the array take
  `.route`. `laneUsed` remains as scratch that `channelLaneRoute` resets and consumes on the
  same tick — **nothing outside it may read that variable**, which is what makes the
  staleness structurally impossible. `tests/buoy_lane.js` +3 (14): the lane is reported,
  is not reported in open water, and **a lane plan followed by an open-water plan does not
  inherit the lane** — mutation-verified by restoring the old no-reset design, which fails
  exactly that check. The ops manual already promised the banner reports "whether it rode a
  channel lane", so **again the doc was right and the code was wrong** — no rebuild owed.
  **Lesson: "inert today" is a claim about every reader, present and future. Check it by
  looking at the producer, not the reader** — the producer had a second bug the reader
  audit would never have found.
- **the pre-commit path filter named its suites individually and had drifted** — five
  (`wreck_clearance`, `water_trust`, `ais_range`, `live_speed`, `completion_modes`) were
  never listed, so editing one of them ALONE ran nothing. Replaced with `*tests/*`. Same
  shape as the panels and the suite counts: **a hand-maintained list beside a directory
  that already answers the question.**

**A TEST-DESIGN LESSON FROM THIS SESSION, and it applies to all twenty suites.** The first
`stored_settings.js` called the helpers directly. Stripping `lsGet`'s `try`/`catch` — the
exact fault check 4 exists for — made check **3** throw and killed the process before check 4
ran, so **no `FAIL` line was printed at all and the mutation runner scored it as SURVIVED**.
The suite now evaluates every condition as a thunk and reports a throw as a failed check.
Two rules fall out, both cheap:
- **A HARNESS THAT CANNOT SURVIVE THE FAULT IT TESTS FOR CANNOT REPORT IT.** If a check
  proves a function does not throw, calling that function unguarded elsewhere in the same
  file makes the proof unreachable.
- **A MUTATION RUNNER MUST SCORE A CRASH SEPARATELY FROM A PASS.** "No FAIL lines" and "the
  process died" look identical if you only parse stdout. This is the same rule the hook
  already states for suites — treat a crash as loudly as a failure — applied to the thing
  that grades the suites.
- **TESTING A PURE HELPER DOES NOT TEST THAT ANYTHING CALLS IT.** Six assertions exercised
  `clampPanelPos` directly and all six stayed green when the clamp was ripped out of
  `placePanel` — the reported fault restored, undetected. Checks 18–19 assert the CALLER.
  Same family as the `completion_modes` lesson: preserving a value and honouring it are two
  assertions. **And prefer naming the paths to counting them** — check 9 counted
  "`>= 2` unanchor call sites" and stayed green when the restore path lost its one, because
  a third site elsewhere covered the count. **An ORDERING check has the same failure mode:**
  comparing `indexOf("style.display")` against the clamp passed a mutation that moved the
  real write after it, because an earlier write in a guard clause satisfied the first index.
  Compare the **LAST** occurrence.

**Previous session (2026-08-01 → 08-02), fifteen commits, all with sections below:**
- **vessel card off the controls window** — it was bridged, so one card rendered in BOTH
  windows. Now chart-window only; top bar untouched by request. New suite
  `tests/ui_split.js` (9), which also turns "every bridged selector resolves" from a
  sentence into a test.
- **AIS range control** — a live range control on the AIS card. **Andy's design: collect
  wide (150 km), filter narrow (50 km default), never on a lake.** That DELETES the old
  "subscription and query must move together" invariant instead of working around it. New
  suite `tests/ais_range.py` (8).
- **live speed** — SOG did not follow a speed change because the commanded speed reached the
  boat ONLY via `upload_plan`. There was no speed command AT ALL: no seam method, no Engine
  method, no endpoint. Added `set_speed` through the whole seam (+ honest `RealVcu` refusal),
  `/api/cmd/speed`, and `speed_key`/`speed_target_kn` on the state. New suite
  `tests/live_speed.py` (10, drives a real console). **First commit under the folded-handoff
  rule.**
- `f382b85` **plan speed is an INPUT to the plan, not a label on it** — Punch Out already
  advises "widen the lines or slow down"; acting on that advice recomputed **nothing**.
  `recalcForSpeed()` re-punches a drawn pattern (live: 7 teardrops → 7 semicircles, routed
  length 0.63 → 0.44 → 1.27 km across survey → low → high); a COMMITTED plan can't be
  re-punched, so durations are recomputed and the spacing re-checked against the new turn
  radius. **Asymmetric on purpose: slowing down is always safe, speeding up can make a
  committed reversal untrackable while the chart looks identical.** End-of-plan's "applies
  on the next Upload" was half true in the dangerous direction — the SETTING is live.
  New suite `tests/speed_recalc.js` (10). **Two gaps the live run found:** durations blanked
  at `Add to plan`, and the warning never cleared when you slowed back down.
- `d832456` **the survey card keeps describing a committed plan** — Andy reported it going
  blank "after uploading"; the blanking is actually at **`Add to plan`**, one step earlier,
  because `resetPattern()` drops the anchors every figure was derived from. **Reproduce the
  operator's CASE, not their diagnosis.** `committedPatternInfo()` now DERIVES the figures
  from `mission.lines` instead of snapshotting them — which forced out two bugs a snapshot
  would have hidden: `planKind` is unreliable after a refresh, and the line direction came
  back as the RECIPROCAL (typed 327, card read 147). New suite `tests/survey_card.js` (11).
- `3080e6a` **documentation set** — there was one generated document, for engineers; Andy
  asked for three more readers to be served. **Quick Start** (976 w, ~20 min to a running
  survey, deliberately ruthless — don't grow it), **Operations Manual** (5,487 w, 17 ch, the
  person at the console with a vessel in the water), **Development Guide** (10 ch,
  how the project is BUILT AND VERIFIED, since the tech manual covers what it is — including
  five case studies kept because each is a CLASS). Helpers extracted to `tools/docx_kit.js`;
  **the tech manual's `word/document.xml` is byte-identical across that extraction**, which
  is the only reason the refactor was safe — re-verify the same way if you touch the kit.
- `3c8fd9e` **sanitization — the sibling console's identity is out of the core.** Andy's call
  on the long-standing flag; **the line is now written down** (top of this file) instead of
  being re-argued. Five core sites cleared, not the four the old note claimed, and it had
  stale line numbers too — hence the standing `grep`. The sweep also found `buoy_lane.js`
  naming two source files **that do not exist in this repo**, and `turn_geometry.js`'s
  `const ZBOAT` labelled `"4 m USV"` when those are `zboat_1800hs`'s numbers and that hull
  is **1.9 m** — a mislabel that had propagated into this file and README.md. Data
  untouched; all 21 turn assertions unchanged.
- `e070350` **the survey move grip was drawn, live, and invisible** — Andy asked for the SURV
  whole-pattern handle to be ported from the sibling. **It already was, byte-identical and
  working**; it was drawn inside `drawPattern()` (early) and the boat marker (late) painted
  over it, and the boat sits at the A-B midpoint whenever you draw the box around it.
  Measured: **0 grip pixels on the boat, 70 off it.** Now drawn last, haloed, and finally
  named in the SURV hint — which was the one thing the port actually missed. New suite
  `tests/pattern_move_grip.js` (7). **DIVERGENCE FROM THE SIBLING — see that section.**
- `8669230` **the cards say what the boat is actually going to do** — three readout faults
  Andy reported, all the same shape. (a) **END ACTION**: an end-of-plan RTH now reads `rth`
  on a Go-To / Transit / Survey from the START of the run, and is *not* promised when the
  chain cannot fire. Found while verifying it: **the chain's one-shot never re-armed for a
  run commanded while already under way**, so it held at its endpoint indefinitely.
  (b) the **Mission card is now a section of the vessel-status card** (`#missionPanel` gone;
  the old `Run mode` row deleted as the duplicate it was). (c) the **Nogo row was stuck on
  "loading…"** — a repaint painted one statement too early, on the one path that ends in a
  working model; it now names its state. New suites `tests/end_action.js` (16) and
  `tests/nogo_readout.js` (15). **Live-verified in a real browser, both windows.**
- `2a28a59` **ROC + moving HOME** ported from the sibling (`roc_tracks.py`, `/api/roc`,
  ROC card, RTH chases a mothership), plus `gps_sim.py`, the **Mission card**, the
  **SURV move grip** (old parity gap, now closed), and the **docs set** —
  `tools/build_tech_manual.js` → `docs/asv-simulator-technical-manual.docx`, 15 chapters,
  generated, brand-free. ROC was made **vessel-aware** (standoff scales off LOA; a
  closing check against the vessel's top speed).
- `494f048` **charted point hazards have an EXTENT** — a wreck was a buffer-sized dot,
  so a Go-To planned over one off Lewes. Both the exact check and the A* raster fixed.
- `7151149` **end-of-plan setting vs run completion** — a conflated field meant a Go-To
  overwrote "End of Plan: RTH" with loiter. Split; no Engine method writes the setting.
- `2388856` **default vessel → `drix08`**. The default also decides AIS start-up scope
  and the tide station, so an Erie default pointed both at the wrong water.
- `055373f` + `21d7810` **water level earns trust by distance** — ghosted when the
  station is far, and **not applied to charted depths** when it is remote.

**THE RECURRING THEME, worth carrying forward:** every bug this session was one value
serving two masters, or one value trusted without its provenance. Vessel-derived
constants going stale on a switch (`apply_vessel` must re-derive — see `HULL_A_LAT`,
the ROC standoff, the nogo buffer floor); a persistent setting clobbered by a transient
one; chart data trusted without its extent or its distance. Check for that shape first.

**THE ANTIDOTE, and it is cheap (`d832456`): DERIVE, DON'T REMEMBER.** A value read back
off the thing it describes cannot drift from it, survives a reload for free, and follows
later edits. The survey card's obvious fix was to snapshot the pattern figures on commit;
deriving them from `mission.lines` instead **forced out two bugs the snapshot would have
hidden** — `planKind` is unreliable after a refresh, and the derived direction came back
as the RECIPROCAL, which only showed up because it had to agree with the typed value.
Prefer derivation wherever the source of truth is already in hand, and make the derivation
**self-validating** (the card checks the lines really ARE parallel) rather than trusting a
flag alongside it.

**THE READOUT COROLLARY (`8669230`, three instances in one pass):** a card can be
perfectly accurate about its own field and still be **wrong about the boat**. Ask what
question the operator is actually reading the row for, then check whether any field
answers it — "where does this run leave the boat" had no field at all, and "loading…"
answered "what is the console doing" with a word that fit four different states. Two
mechanics behind it, both worth checking directly: a **paint taken before the flag it
reads was cleared** (the Nogo row; the success path was the one that never repainted),
and an **edge-triggered reset for a condition that is not edge-shaped** (the RTH
one-shot re-armed on idle→running, but "a new run" does not always cross that edge).
`e070350` added a third: a **control painted before something that covers it** (the move
grip under the boat marker). `d832456` a fourth: a **readout whose only source was thrown
away by a normal step in the workflow** (the survey card, blanked by the `resetPattern()`
inside `Add to plan`). All four were live, correct, and unusable.

**AND A DIAGNOSTIC HABIT WORTH THE SAME WEIGHT:** Andy reported the survey card blanking
"after uploading". It blanks at `Add to plan`, one step earlier — upload was simply when he
noticed. **Reproduce the operator's CASE, not their diagnosis.** Their account of *when*
is a clue about where to look, never the answer.

**AND THE PORT COROLLARY (`e070350`):** a clean diff is not evidence a UI port works. That
grip was byte-identical to the sibling's and the feature was still missing. **Verify a UI
port by looking at the pixels** — `getImageData` at a known screen point costs one tool
call, works on the animating canvas where screenshots time out, and answered in a minute
what the diff had already said was fine. Ask "can the operator SEE it and REACH it", not
"is the code here".

**OPEN / NEXT:**
- **NOTHING IS HELD BACK.** The turn-water hold is closed and the tree is clean; the
  items below are genuinely open, not work in progress. Andy's three standing parks
  (MarineTraffic, payloads, AISHub membership) are further down and unchanged.
- ~~**ONE COSMETIC DOC GAP**~~ **CLOSED the same day — and it was FIFTEEN suites, not the
  one I reported. I had read a window of the table and generalised from it. See "THE
  MANUAL WAS TALKING TO ITS OWN MAINTAINER" below; `docs_valid.py` check 7 is now the
  alarm on it.**
- **THE LINES-CARD MIRROR FAULT IS STILL OPEN, and it is the oldest live unknown.** His
  LINES card froze in the controls window on 2026-08-06; the recording feature was
  reverted the same day but never convicted. **Prime suspect, and it costs nothing to
  check the next time it happens: the mirror rides a BroadcastChannel, which is
  ORIGIN-SCOPED — a chart window on `localhost:8791` and a controls window on
  `127.0.0.1:8791` can NEVER sync, silently, while commanding still works.** So: F5 the
  controls window, compare the two address bars, then F12 on the chart window. See the
  ⚠ entry at the top.
- **THE SECOND-CLIENT GAP, designed and parked.** A second full client (a laptop beside
  the console) never learns of plan edits — each window loads `mission` once at boot.
  The fix is 4 lines of design, built and live-tested during the revert-day diagnosis:
  server bumps `MISSION_REV` in `save_mission` + publishes it on the state + the POST
  returns it; client adopts its own echo, guards in-flight edits with `savePending`,
  refetches on a foreign rev. **Not started here — ask before building it.**
- **THE ENV CARD IS GONE BUT THE ENVIRONMENT IS NOT** (`324b1b7`). If anything
  environmental is asked for again, read that section first: the forcing, the buoys and
  the water-level correction all still run and are reachable at `POST /api/env` and
  `/api/waterlevel`. The deleted wind rose / tide chart live in `327ce0c`. **Do not
  rebuild them unasked.**
- **ROUTE COVERAGE, remainder.** The estop_chain audit found 20 of 33 routes untested;
  covered since: E-STOP, the five in `run_link_control.py` (transit/pause/reset/connect/
  disconnect), `sethome` + `spawn` in `home_spawn.py` — which also drives `rth`'s
  happy path (closes on home) for the first time — and `energy` + `chartinfo` in
  `energy_chartinfo.py`, and `enc` in `enc_extract.py` (2026-08-05, which also
  DEDUPLICATED the chartinfo twin: `_bbox_key` + `_bbox_from_query` now serve both
  endpoints, and shared-helper mutations are run against BOTH suites). Still open, all
  lower-consequence data/plumbing routes: `logevent`, `logs`, `vessels`, `comms`,
  ~~`tide`, `roc`~~ — ALL FOUR remaining surfaces covered in `data_routes.py`
  2026-08-05; THE COVERAGE THREAD IS COMPLETE (see the section above) — `logevent` +
  `logs` + `log` covered in `log_routes.py` 2026-08-05 (logging ON — the --no-log mask
  was the coverage hole), which also fixed the kwargs-collision defect — `env` +
  `waterlevel` covered in `env_water.py` 2026-08-05, which also fixed the
  dropped-connection defect on bad manual_offset input. NOTE `/api/enc` and `/api/chartinfo` are GETs — an earlier arithmetic here
  counted them among POST routes off a grep of the string literal. If continuing, keep
  the estop_chain rule: pick by CONSEQUENCE, and drive a real console for anything
  whose failure is an interaction.
- **BLOCKED, WAITING ON ANDY — MARINETRAFFIC AIS.** He is negotiating API access under
  `andy.mcleod@unh.edu` and said **"hold this for now"**. Nothing has been built. When it
  lands, two things are needed before a line is written: **(1) which service is enabled** on
  the account, and **(2) one sample response with the key REDACTED** — the response shape
  differs per service and a wrong guess costs real metered credits to discover.
  **There is no password**: MarineTraffic authenticates with an API KEY in the URL. Supply it
  as `$MARINETRAFFIC_KEY` (the `$AISSTREAM_KEY` pattern) or a gitignored key file — never in
  chat. **Design note already settled:** aisstream PUSHES over a websocket and costs nothing
  per message; MarineTraffic is PULL and metered, so the source must poll on a minutes-scale
  interval. The architecture already allows that — the service holds a registry and the
  console reads *that*, so the upstream poll rate is independent of the card's 8 s refresh.
  `--source` is comma-separated, so it can run **alongside** aisstream.
- **PARKED — AISHUB MEMBERSHIP (2026-08-05).** The `aishub` source is built, tested and
  skipped-with-a-note until a member username exists (`setx AISHUB_USER ...` or
  `--aishub-user`). Membership is earned by CONTRIBUTING a feed to aishub.net — i.e. it
  needs a local receiver actually feeding them first. Do not poll their API on guessed
  credentials; the refusal is measured and surfaced already.
- **WHY he is switching, measured, don't re-litigate:** aisstream has **no receiver within
  44 nm of Lewes**. Ran 90 s against the real subscription box with his key: 94 vessels, 101
  reports, no errors — and the nearest of all 94 was 81.6 km. Sector split W 59 / N 15 /
  NW 14. Not even the Cape May–Lewes ferry is in the feed. **The configuration is correct**;
  it is a volunteer-receiver coverage hole. A local receiver via `--source aisstream,nmea` is
  the only thing that will show local traffic.
- ~~ABORTED: the GLOBAL km↔nm units selector~~ — **BUILT 2026-08-04, Andy's choice for the
  "ASV console refinement 1" session** (he picked it from the offered options, which
  supersedes the earlier abort). Shipped to his two recorded decisions exactly: LONG
  distances only, one DIST pill on the top status bar. See "THE km↔nm DISTANCE DISPLAY"
  section for what must not regress.
- **THE DOC BURDEN QUADRUPLED** (`3080e6a`) **AND THE DOCS WERE BROKEN THE WHOLE TIME**
  (`15cf36a`). A user-facing change has FOUR generated documents plus three READMEs, and the
  **operations manual is the operator-facing source of truth** — a new control, a changed
  refusal, a new readout state or a new safety behaviour belongs in it, and
  `cd tools && node build_docs.js` must run in the SAME commit. The quick start is
  deliberately thin: **point into the ops manual, don't grow it.**
  **`tests/docs_valid.py` now proves the output is openable** — it did not exist while all
  four documents were malformed for three days. When you rebuild, only commit a docx whose
  `word/document.xml` actually CHANGED; the others differ by zip timestamp alone and are
  noise in the diff. Compare with:
  `python -c "import zipfile,hashlib;print(hashlib.sha256(zipfile.ZipFile(P).read('word/document.xml')).hexdigest())"`
- **`rearmRthChain()` is a BEHAVIOUR change, not just a display one** (`8669230`). A run
  commanded while the boat is already under way now gets its own end-of-plan RTH, where
  before it silently got none. Correct, and Andy has run it — but if an RTH ever looks
  more eager than expected, that function is the first place to look.
- **Payloads / sonar NOT ported** (Andy's call). It needs a vessel-declared `payloads`
  block first; the sibling's single-beam console is built from vendor manual citations
  and proprietary telegrams that this console's rules forbid.
- **The sibling's teardrop branch is undriven** — reachable only at high speed under
  8.3 m line spacing. Low risk, but the 2026-07-20 lesson stands: static `legClear` does
  not catch follow overshoot.
- Residual, by design: chart datum is the LOW-water reference, so a real tide BELOW datum
  leaves charted depths optimistic. The manual override is the answer.
- ~~RESIDUAL: hidden pop-outs clamped by the 0×0 sliver rule on reveal~~ — **STALE, DO NOT
  REBUILD IT** (caught 2026-08-04): this entry described the state at `ae4eceb`, one commit
  before `2aef779` **closed it** — `showPanel()` IS the "reveal hook the six show sites all
  pass through", and it shows-then-re-clamps in that order precisely so the panel measures
  its real size. The only true residual is narrower and invisible to the operator:
  `placePanel()` at registration still clamps a hidden panel against the 120 px fallback,
  and `showPanel` corrects it on reveal.
- **MUTATION-TESTING GOTCHAS, all three cost a false result this session.** Set
  **`PYTHONDONTWRITEBYTECODE=1`** when mutating a Python source — rapid rewrites fall inside
  the mtime granularity and a run imports the PREVIOUS mutation's `.pyc`.
  **⚠ LINE ENDINGS — THIS NOTE USED TO SAY "`asv_console.py` is LF, `ais_service.py` is
  CRLF" AND IT WAS WRONG ON DISK. Corrected 2026-08-08 after all seven server mutations
  scored SKIP against it.** This clone has git `autocrlf` on, so **the repo BLOB is LF while
  the WORKING COPY a mutation runner opens is CRLF** — and a runner reads the disk. Measured:
  `asv_console.py`, `ais_service.py` and `static/asv.html` are **all CRLF** (0 bare LF);
  `tests/*.py` are LF. **Do not reason about this from the repo or from this file — measure
  it**, and normalise both sides of every multi-line anchor:
  `s.replace("\r\n","\n").replace("\n","\r\n")`. And a runner **must score a missing anchor
  as SKIP and a crash as its own outcome**, never as "caught": "no FAIL lines" and "the
  process died" look identical if you only parse stdout.

```
python -c "b=open('asv_console.py','rb').read(); c=b.count(b'\r\n'); print('CRLF',c,'bare-LF',b.count(b'\n')-c)"
```

## THE CIRCLE AT THE MOUTH — the knot prune moves into the producer (2026-08-10)

**ANDY'S REPORT, WITH A SCREENSHOT:** the survey transit "worked perfectly until just after
the green outer buoy", then the boat flew a full circle. His theory was a look-forward
delay on the shallows. **The log said otherwise** (session `20260810-131214`, diagnosed by
replaying it — the standing rule): the shallows were fully modeled at plan time and nothing
re-planned mid-run; the flown circle is the boat FAITHFULLY flying a defective plan. The
uploaded route carried two REVERSAL KNOTS at the mouth of Roosevelt Inlet — wpt 10→11 a
3.9 m step backwards (arrive 042°, leave 211°), wpt 15→17 the same shape — and the DriX at
13.8 kn has a ~20 m turn radius (20°/s yaw cap), so a 177° turn demanded in 4 m becomes a
360° orbit chasing the waypoint. The heading trace shows it: 61→184° in six seconds, then a
full wrap through 346°.

**THE PRODUCER WAS gateLegClear'S SPLICE SEAM, and the dissection proves it stage by
stage** (offline replay against the same ENC + vessel + mission: pre-lane 0 knots, buoy 0,
narrow 0, smoothTrack 0, **after the gate: 2, splices=1**). legPath's patch is lawful, but
where it rejoins the lane a few metres BEHIND the point it left, the seam itself is the
reversal. `planNogoRoute` has always pruned this (`pruneStitch` — "the lane offset can fold
a sharp corner into a small reversal knot"); **`routePlan` — the Upload path — took the
lane output RAW**, so Go-To and RTH never showed the fault while every uploaded survey
approach could carry it. That asymmetry is also why Andy's RTH back through the same
channel was clean.

**FIX: `pruneStitch` moved INTO `channelLaneRoute`** (on the gate's output — after the law,
before the return), so every consumer inherits it; `planNogoRoute`'s own call is deleted as
redundant. Same producer-not-consumers rule as the gate itself. The prune is lawful by
construction: a waypoint goes only if its neighbours connect CLEAR. Measured on the replay:
the mouth knots are GONE from `routePlan`'s output; suites `buoy_lane.js` 27→29 (check 28 =
the mechanism unfolds a reversal, 28b = the wiring pins `pruneStitch(g.route`, the 19/19b
split — no synthetic world folds the seam, measured, so the real-geometry proof lives in
the session-log replay). 3/3 mutations caught, incl. the exact pre-fix behaviour.

**~~STILL OPEN FROM THE SAME LOG~~ CLOSED (the commit after this one, same day):** the
MISSION ITSELF carried two more reversal knots — mission wpt 475 (155° in 3.8 m) and
wpt 551 (176° in 4.5 m) — client-side punchOut stitching, present before routePlan ever
ran. See "THE MISSION'S OWN KNOTS" directly below: 475 turned out to be already cured by
THIS commit's prune move; 551 was a JUNCTION fold the prune structurally cannot reach,
fixed at punchOut's transit assembly.

## THE LINES CARD'S TRANSIT + RTH ROWS (2026-08-10)

**WHAT ANDY ASKED FOR:** "In the Lines card, add transit time to survey area and RTH time
home." Two rows now bracket the per-line table: `transit → L1: 13:13 (2.85 km)` above,
`RTH L3 → home: 13:34 (2.93 km)` below.

**ROUTED, NOT STRAIGHT-LINE — this is the design decision that matters.** The vessel
card's `#v_approach` is a straight-line estimate whose own comment admits the real
approach is ENC-routed at Upload. Here that shortcut would not be an approximation but a
different route's time: at Lewes the geodesic from the pier to the bay CROSSES LAND. Both
rows run `planNogoRoute` — keep-outs + the Rule 9 lane, the planner every behaviour flies
— so the quoted time belongs to the route the boat would actually run. Transit legs:
BOAT → `wps[0]`. RTH legs: `wps[last]` → HOME (the boat is deliberately NOT in the RTH
leg — an RTH after a completed survey departs from where the survey ends).

**THE CONSTRAINT THAT SHAPED THE CODE: `renderLineTable` RUNS ON EVERY TELEMETRY FRAME**
(the `updateActiveLine()` tick — `updateXTE` until 2026-08-29). A synchronous A* there
freezes the chart. So:
`scheduleTransitEst()` computes OFF the tick (setTimeout 0, one in flight), keyed by
`transitEstKey` — plan endpoints + home + nogo identity + the boat bucketed to
`TRANSIT_REKEY_M` (50 m) cells, so GPS jitter never re-routes but real motion does. The
cache stores METRES; SECONDS are derived at render from the current plan speed —
`mission.speed` re-times both rows in the same click with zero routing (measured live:
13:13 → 6:36 on survey → high, distance unchanged). **A run-state gate here was shipped
and REVERSED the same day (Andy: "the transit line out to the survey does not land in the
lines card"): the first cut blanked the transit row to `--` while running, reasoning the
Mission card owns the live ETA — but the operator flying the transit is exactly who wants
the number.** The row stays live through the run; the 50 m bucket (one re-route per 50 m
of real motion, ~every 14 s at survey speed) is the cost control a run-state gate was
wrongly doing double duty for. No `ensureNogoCovers` in the passive path — a readout must
not trigger chart extraction; the command paths still widen the extract before flying.

**EACH ROW DEGRADES ALONE AND SAYS WHY:** no fix → transit `--` while RTH still answers
(it never needed the boat); no home → the mirror; a planner REFUSAL renders as
`unroutable — <the planner's own reason>` (never a silent `--`, which would be
indistinguishable from "no fix", and never a number); nogo-not-loaded renders the figure
with `direct — nogo not loaded` beside it.

**Suite:** `speed_recalc.js` 10 → 22 (the plan-speed suite is the right home — the rows'
whole contract is "metres routed once, timed at the current speed"). 7/7 mutations caught
by the check that claims to guard each: `routeLenM` straight-lined → 9; RTH routed from
the boat → 10b; refusal swallowed to null → 12; time at a fixed speed → 14; "direct"
hidden → 13; boat dropped from the key → 15; running boat still an input → 15c. Two
mutation anchors initially missed because **asv.html is CRLF** (the standing trap — the
runner reads `newline=''`, so multi-line anchors need `\r\n`).

**Verified live** (sim console, 3-line plan in the bay NW of Roosevelt Inlet posted via
`/api/mission`): rows render with believable numbers (routed 2.85 km = the inlet transit,
vs 2.14 km straight across land), speed change re-times without re-routing, zero console
errors. The live eyeball was DOM reads (`#lineTableBody.innerText` three ways), not a
screenshot — the Browser pane wasn't compositing.

## THE MISSION'S OWN KNOTS — the junction seam (2026-08-10)

**WHAT THE REPLAY PROVED, knot by knot.** The transit-builder stage was replayed OFFLINE
against the committed 23-line plan from the log, the real Lewes ENC extract (the cached
`features_v3_-75.2400_38.7400_-75.0800_38.8400`), and the DriX's own numbers — no server,
no browser; the harness lives in the session scratchpad and the method below. At HEAD:

* **wpt 475 (interior fold, 154.6° in 3.79 m inside a 500 m routed region transit):
  GONE.** The `pruneStitch`-into-`channelLaneRoute` move (the circle-at-the-mouth fix
  above) already covers punchOut's routed vias — same producer, inherited fix. Nothing
  further was owed; do not go add a second interior prune.
* **wpt 551 (junction fold, 175.9° in 4.46 m where a routed transit meets a 22 m sliver
  line end): STILL EMITTED, byte-exact** — same turn, same step. The gap is two nearly
  COLLINEAR anti-parallel slivers 50 m apart: the teardrop refuses (`degenerate` — zero
  lateral offset), the straight hop is blocked at buffer 5, `routeAround` +
  `channelLaneRoute` produce a lawful path — whose first point sits 4.46 m BEHIND the
  line end the boat arrives at. A ~176° turn demanded in 4.5 m orbits any real hull.

**WHY NO EXISTING GUARD COULD SEE IT.** `pruneStitch` walks INTERIOR vertices; the fold is
at the route's own FIRST vertex, and the deflection that makes it a knot is measured
against the SURVEY LINE's heading — which is outside the route, invisible to
`channelLaneRoute` and everything inside it, at this or any version. And `smoothTrack`'s
45 m resample, which happens to stretch most seams flat, passes any route shorter than
2×STEP through RAW (`pts.length<3` returns the input), so short-gap vias keep their
folded first point. The one place that holds BOTH the via and the line endpoints is
punchOut's transit loop. **Producer-not-consumers, one level up.**

**THE FIX.** `passage.js` exports `KNOT_TURN_DEG`/`KNOT_STEP_M` (150° / 12 m — the log
replay's own detector, NOT pruneStitch's 60°: a lane via lawfully leaves a line end
steeply, and eating those points would trade Rule 9 discipline for nothing),
`junctionKnot(a,b,c)` (the detector, min-of-both-legs, used for REPORTING), and
`pruneJunctionKnots(lineIn, Ap, via, Bp, lineOut, ref, ko, buf)`: while the seam folds
past 150° within a VIA step under 12 m and the bridge to the next point is `legClear`,
the folding point goes; mirrored at the exit junction. **The drop keys on the via's OWN
step, not the detector's min-of-both-legs** — a sliver LINE under 12 m would otherwise
hold the knot test true whatever is dropped and drain a lawful via to nothing.
punchOut's routed branch runs every via through it, and a fold that SURVIVES (the bridge
refused — obstacle-forced) is counted into `nNoTurn` + `turnBlocks` with
`firstBlockAlong` naming the blocker, so nothing ships silently.

**MEASURED ON THE REPLAY, live parameters (buffer 5, plan speed high):** the raw assembly
still folds 175.9°/4.46 m at HEAD; with the prune the mission carries ZERO knots, zero
surviving-fold flags, and every other routed via ships untouched (8→8, 3→3, 4→4 points;
the folded one 2→1). The live page boots clean after the import change: 334 nogo zones,
no console errors, probed in a real browser.

**HOW THE REPLAY FOUND THE LIVE PARAMETERS — worth keeping.** The logged vias march in
64.98 m steps; `smoothTrack`'s STEP is `max(45, buf*13)`, so the punch ran at
**buffer 5** (the DriX's own floor), not the mission body's `buffer_m: 3` — the saved
field is what the mission CARRIES, not what the punch USED. And the replayed waypoint
count matches the log at plan speed **high** (559 vs 557), not survey (359). When a
replay diverges from a log, suspect the reconstructed PARAMETERS before the code.

**SUITE: `tests/turn_geometry.js` 21 → 29** (junction-seam section 22–27: the detector
with an acceptance pair, entry prune, exit mirror, obstacle-forced fold KEPT and still
reported, the wide fold NOT pruned, the punchOut wiring + report). **6/6 mutations
caught** — both thresholds loosened, the helper neutered, the `legClear` bridge guard
dropped, the wiring reverted to the exact shipped fault, and the report removed. The
runner normalized anchors to each file's OWN line endings (`passage.js` is CRLF — the
recorded `ais_service` trap, hit again). NO SYNTHETIC WORLD FOLDS THE SEAM through the
real router (same finding as buoy_lane 19/19b), so the real-geometry proof lives in the
session-log replay, recorded here.

**STILL OPEN / RECORDED, NOT FIXED:**
* A **straight-hop reversal under 12 m** (two collinear slivers nearly touching, hop
  `legSafe`-clear) would knot with NO via to prune — plan-structure, not stitching; never
  observed in a real plan. If it shows up: the flag belongs beside the straight-hop
  branch, the cure probably in `regionOrder`/clip merging tiny collinear fragments.
* An anti-parallel gap FARTHER than the teardrop distance gate (`spacing*1.6+3`) skips
  the turn attempt silently — no `nNoTurn` flag even though the transit is a genuine
  reversal (the 504 m gap 13 shipped that way pre-fix). The junction guard now covers
  the dangerous outcome; the missing ADVISORY remains missing.

## THE LANE'S ENDS — hold to the charted extent, stand on past the mouth (2026-08-10)

**THE CLAUSE THAT HAD NO CODE.** The geometric ¼-width rework (`7d3c0b5`) replaced the old
colour keep-right and, in the same move, retired `channelEndExtend` ("a channel extends past
its ends by its own width — stand on straight out of a mouth") and `gateProject` ("steer
through the outermost gate centre and STAND ON past it by the gate width"). `bcd9529` then
deleted them as dead code. **Nothing replaced them**, and `planNogoRoute` carried a comment
saying nothing needed to — "the lane's own centreline already runs out to the last buoy pair,
so the fairway projects past the mouth without a separate pass". Measured on the regression
suite's own channel (pairs n=100..900, half-width 50, lane target 25), that was false:

| along-channel | before | after |
|---|---|---|
| n=850 — 50 m *inside* the buoyage | 24.3 | **25.0** |
| n=900 — **the final buoy pair** | 21.3 | **24.9** |
| n=1000 — one channel width past | 7.0 | **21.2** |
| n=1300 — released | 0 | 0 |
| charted dredged area to n=1400 | *never an input* | **25.0 held to n=1300** |

**THE FIX IS UPSTREAM OF THE LANE, NOT INSIDE IT.** `extendCenterline` (`static/js/chart.js`)
extends the buoy-pair centreline straight along its own terminal axis before the lane is
built on it; `buoyChannelLane` and `narrowChannelLane` both reach it through the single
`laneCenterline` helper in `passage.js`, so "how far does this channel reach" cannot mean one
thing to the lane builder and another to the rule that skips already-laned water. The lane
machinery then holds the full offset through the extension **without knowing it is there** —
no second pass, no special case in the offset code.

**HOW FAR — both halves of the operator's rule, whichever reaches further:** march the axis
while still inside a charted channel polygon (`ko.chans`), or one full channel WIDTH past the
final pair. **Capped at `CL_EXTEND_CAP_M` = 1200 m**, because "that channel and only that
channel" cuts both ways: a dredged area running kilometres past the buoyage must not drag the
lane along water the marks never claimed. `hw` is HELD at the terminal value through the
extension — the width the last pair actually measured, never an extrapolation of it.

**`ko.chans` IS NEW AND IS NOT A KEEP-OUT.** `buildKeepouts` now also returns the charted
channel polygons. Two different questions share that model — "may the vessel be here"
(`polys`/`lines`/`points`, gated by `enf`) and "is this water a channel" (`chans`) — and the
second must not depend on the first: a dredged area is only a blanket keep-out when the
operator enforces "Dredged / restricted", **which would also stop transiting it**, yet its
extent is exactly what tells the lane how far the fairway runs. Built unconditionally.

**THE REACH KNOB WAS INVERTED.** `channel_reach_m` was added (`0f36df7`) to REACH FURTHER so
keep-right would engage in a wide fairway. The rework rewired it as `max(120, override ??
buf*30)` — a **replacement**, not a maximum. The DriX's 120 is below its own `buf*30` of 150,
so the knob that exists to widen was silently narrowing by 30 m. Now `max(120, buf*30,
override)`: **a widening knob is a maximum, never a substitute.** The vessel file's 120 is
left as written; under the corrected semantics it is simply inert for this hull.

**THE BANNER TELLS THE TRUTH NOW.** Only ONE buoy system is laned per leg, so a route down
two successive channels rides the second **dead on its centreline** — the head-on position —
and the old flag recorded only "a lane was ridden". `channelLaneRoute` returns `partial`
alongside `lane`, set when a second system qualified but went un-laned, when the lane needed
a rescue, or when `gateLegClear` spliced. `buoyageNote(lane, partial)` says so. **A banner
claiming Rule 9 over a route that is not keeping right is worse than no banner: it is a claim
the operator would otherwise have checked.**

**WHAT IS STILL NOT FIXED** (Andy chose the termination scope; these were the other options):
one-system-per-leg itself, bearing-unconstrained buoy pairing, the unbounded OBJNAM prefix
merge that can chain two channels into one system, unnamed/unnumbered marks forming no system
at all, and the wide-channel case where no lane engages and nothing says so (the CH-flag
decision, still open). `partial` now *surfaces* the first of these rather than hiding it.

**LEWES IS NOT COVERED BY ANY OF THIS, AND THAT IS THE IMPORTANT PART.** Measured against the
live console's own ENC: the harbour band serves 5 lateral marks, and the "roosevelt inlet"
system is `port=1 stbd=2` → a **1-point centreline**. Both consumers require ≥2, so the buoy
lane cannot engage at the home site at all, and an extension cannot help a centreline that
does not exist. Keep-right there rests **entirely** on `narrowChannelLane`'s bank
confinement. A live probe of that was attempted and is **inconclusive** — a straight sample
line up the inlet reads blocked-both-sides at nearly every sample for the DriX's 2.3 m floor
(draft 2.0 + UKC 0.3), i.e. the line is not a navigable channel, so it measures nothing. **If
you pick this up: build the probe off the dredged-area centreline, not a guessed straight
line.** The synthetic evidence above is mutation-verified; the Lewes claim is not made.

**Suite:** `tests/buoy_lane.js` 20 → **27**. Checks 21-27 cover leaving, standing on,
entering, charted extent, channel separation, the honest banner, and the widening knob.
**All six mutations were caught by the check that claims to guard them** — extension disabled
(21/22/23/24), charted extent ignored (24), extension unbounded so channels chain (25), the
reach knob back to a replacement (27), the second channel uncounted (26), `partial` hard-coded
false (26). Every other suite (18 JS / 12 Python) re-run green, and the real page boots with
334 nogo zones and no console errors.

## THE MANUAL WAS TALKING TO ITS OWN MAINTAINER (2026-08-08)

Andy: *"fix the log_routes GUARDS entry too."* **It was not one entry. It was fifteen of
thirty-seven** — and the reason I told him "one line" is worth recording, because it is the
same mistake in miniature as the fault this repo keeps finding: I read a WINDOW of the
generated table (a grep with context), saw one `(undocumented)` in it, and reported that as
the count. **A partial view is not a census. Enumerate against the directory.** The
one-liner that actually answers it:

```
node -e 'const fs=require("fs");const s=fs.readFileSync("tools/build_tech_manual.js","utf8");
const b=s.slice(s.indexOf("const GUARDS = {"),s.indexOf("};",s.indexOf("const GUARDS = {")));
const have=new Set([...b.matchAll(/^\s*"([\w.]+)":/gm)].map(m=>m[1]));
console.log(fs.readdirSync("tests").filter(f=>/\.(js|py)$/.test(f)&&!have.has(f)))'
```

**THE MECHANISM, and it is a GOOD design that was working.** Chapter 13.1's harness table is
DERIVED from `tests/` so a new suite appears in the manual the day it is written; the
per-suite descriptions come from a hand-kept `GUARDS` lookup, and a suite with no entry
renders `(undocumented — add an entry to GUARDS in tools/build_tech_manual.js)` in its row.
It self-reports rather than failing silently. **Nothing read the report.** Fifteen rows of
build instructions addressed to a developer sat in a Word document written for an engineer
reader, in every commit since the table was first derived.

**THE HALF-DERIVED SHAPE IS THE HAZARD, and this repo now has three instances of it** (the
hook's suite list, this file's suite counts, and now GUARDS): when one half of a table is
derived and the other is hand-kept, the derived half keeps GROWING the hand-kept half's
debt, silently, and the graceful placeholder is what makes it survivable enough to ignore.
**So the degradation now has an alarm on it:** `tests/docs_valid.py` check 7 — *no document
ships a note addressed to its own maintainer* — scans every generated document for
`(undocumented`, `TODO`, `FIXME`, `XXX:`. Deliberately generic, not a match on that one
string. **2 mutations caught** (a suite's entry removed; a `TODO` inside a REAL suite's
description so it actually renders). **Two others SURVIVED correctly and are worth not
re-deriving: a GUARDS key for a suite that does not exist, and an unused JS constant
containing "FIXME", neither of which reaches the rendered prose — a mutation that never
renders cannot violate a check on what was rendered.** That is the second time in two days
that trap cost a round; see the same note in the measuring-tool section.

All fifteen entries were written from each suite's OWN docstring rather than invented, in
the voice of the existing rows. `docs_valid.py` 7 → 8 checks.

## THE POINT COMMANDS MOVED TO THE CHART MENU (2026-08-08)

Andy: *"add set home to right click. remove set home, spawn and go-to from bottom bar."*
Go-To and Spawn were already menu rows; this removes their toolbar buttons and adds Set
Home. **The command bar is now Arm · Upload · Start · Pause · Stop · Hold · RTH · E-STOP ·
Reset.**

**⚠ SET HOME USES THE CLICKED POINT. THIS REVERSES A TESTED INVARIANT, DELIBERATELY, ON
ANDY'S EXPLICIT INSTRUCTION** — *"yes, make set home use the clicked point"*, after I
shipped it as "Set Home at vessel" and flagged the conflict. **Do not "restore" the old rule
because a comment or an old suite docstring says home is "where the boat is".** The history,
so nobody re-litigates it:
- **What it was:** `Engine.set_home()` took no position and DISCARDED one sent to it;
  `home_spawn.py` check 2 posted a decoy 0.5° off to prove the discard. That rule existed
  because HOME had once been captured from a DEAD boat's stale telemetry (`5ac17bc`).
- **What it is now:** `set_home(lat=None, lon=None)` — an explicit point is honoured;
  **no point still captures the live fix, with BOTH original guards intact** (link up, and a
  real fix present). Half a coordinate is a refusal, never a silent fall-back. The point is
  validated as INPUT: numeric, finite, on the globe.
- **THE HAZARD DID NOT GO AWAY — IT MOVED SOMEWHERE THE OPERATOR CAN SEE IT.** RTH still
  drives to HOME, so a home on land is still a return that gets refused. Two things now
  carry that: **`doSetHome()` tests the chosen point against the same keep-out model every
  behaviour routes by and WARNS on the banner**, and RTH still refuses a route it cannot
  plan clear. **It warns, it does not refuse** — the operator asked for the point they
  picked, and this console's rule is that a refusal is a RESULT, not a veto to work around.
  **VERIFIED LIVE END TO END, and the warning turns out to be exactly truthful:** Home set
  on land banners *"it sits in a keep-out zone (land) — Return-to-Home may be REFUSED from
  here"*, and commanding RTH from that home then answers *"RTH refused: the target sits in
  land."* Warned at placement, refused at use — the warning predicts the refusal rather
  than merely gesturing at it.
- **The warning had to widen the extract first** (`ensureNogoCovers`, as Go-To does): a home
  outside the modelled box tests "clear" because nothing is loaded near it, and **silence
  would read as approval**. An unloaded model says so rather than passing. Checks 15b2's
  three clauses each earned their own mutation.
- **A ROC is still the right answer for a MOVING home** (a tender, a ship) — it is confirmed
  before it takes effect and it tracks.

**THE SERVER MUTATION PASS PRODUCED THREE REAL FINDINGS — two from SURVIVORS and one from a
CRASH, which is precisely why a runner must score a crash as its own outcome:**
- **⚠ A SUITE THAT COULD NOT REPORT THE FAULT IT TESTS FOR (new check 2e) — AND I MISREAD
  THE DIAGNOSIS THE FIRST TIME.** Dropping the range guard did not fail a check: it **killed
  the harness**, which printed **no FAIL line at all**. That is the runner's own rule one
  level down — *"no FAIL lines" and "the process died" look identical if you only parse
  stdout*. **My first fix asserted the console was still ANSWERING. It was.** A `nan` home
  serialises perfectly happily and `/api/state` hands it straight back; the suite passed
  that check, took **`(nan, nan)` as its Return-to-Home target**, and died four checks later
  — so the mutation crashed a SECOND full run before I looked properly. The real invariant
  is not "the console survived" but **"HOME is still a USABLE coordinate"** — finite, in
  range, and where it was — because every check below steers to it. 2e asserts that and
  aborts through the normal summary line, so the mutation is now **CAUGHT** and names the
  poison: `aborted: home {'lat': nan, 'lon': -75.0}`. **THE LESSON: when a harness dies, fix
  WHAT KILLED IT — not the first plausible symptom visible from where you are standing.**
- **A GUARD NOTHING COULD REACH.** `set_home` was written with an `isfinite()` check beside
  the range check. Its mutation SURVIVED — correctly, because `-90.0 <= x <= 90.0` is
  already False for `inf`, `-inf` AND `nan` (every nan comparison is). **One guard subsumed
  the other entirely, so the second could never be earned.** Deleted, with the reasoning
  left behind so it is not re-added; check 2d now feeds nan as well as inf to hold that.
- **A CHECK THAT COULD NOT TELL THE BUG FROM THE FIX** — the fourth instance of that shape
  here. Dropping the local numeric guard leaves a bare `float("abc")`, which
  `_dispatch_post`'s **catch-all `except Exception → 500`** turns into an error response.
  Check 2d asserted only that *some* error string came back, so **it survived the guard
  being removed entirely.** It now requires the refusal to NAME the rule (`home …`) rather
  than echo the interpreter (`could not convert string to float`) — the difference between
  a handler refusing and a handler falling over, which the session recorder logs
  differently. **The local guard's whole value is that it is not the catch-all.**
- And a third wrong-mutation, same family as the two before it: `if given == 1 and False`
  never produced the fallback it was meant to test — it fell through to the explicit branch,
  hit `float(None)` and refused anyway. **A mutation that never violates the invariant
  proves nothing.** Corrected to `given = 0`; caught by 2c.

**A BUG I SHIPPED INTO `doSetHome`, CAUGHT BY RE-READING IT (now check 15b3).** I guarded
the response with `if(r && r.error) return;` — but **`cmd()` returns `{}` on a network
error**, having already flashed it, so that guard falls straight through and the banner
announces "Home set at the chosen point" **for a command the server never saw.** Now
`if(!(r && r.ok)) return;`: test for the POSITIVE signal, because only the server sends
`{ok:true}`. **Same shape as the extract-widening bullet above, and the pair is worth one
rule: THE ABSENCE OF BAD NEWS WAS BEING READ AS GOOD NEWS.** Wherever this console reports
that something worked, ask what it would say if nothing had happened at all.

**⚠ AND A NEAR-MISS WORTH MORE THAN ALL THREE — THE SECOND TIME THIS HAS HAPPENED.** A
mutation runner was killed by a tool timeout **before its `finally`**, leaving
`asv_console.py` MUTATED in the working tree — the bodyless Set-Home path silently not
setting home at all. It was caught only because a `git diff --stat` I happened to run showed
the insert count off by one. **A `finally` does not run when the process is killed, and the
previously recorded fix (atomic writes, after a run left the file at 0 bytes) addresses a
DIFFERENT failure — a torn write, not an unrestored one.** The runner now writes a
**`.mutorig` sidecar** before touching anything and **restores from it on start if one is
present**, so a killed run is self-healing and, more importantly, LOUD; it also runs in the
BACKGROUND rather than against a foreground timeout. **If you ever find
`asv_console.py.mutorig` on disk, a mutation run died and the source is suspect — restore
from it before doing anything else.** Runner kept at `scratchpad/mutate_server.py`.
**The general rule: after ANY mutation run, verify the source is restored before you trust
a green suite — `git diff` it, do not assume the `finally` ran.**

**THE GATES MOVED OUT OF THE BUTTONS, because the buttons left.** The menu used to read
`#b_goto.disabled` / `#b_spawn.disabled` — right while those buttons existed, and broken the
moment they did not (`cmGate` would have seen `btn = null` and greyed the rows forever). The
rules are now named predicates beside `applyCmdState`: `linkConnected(s)` ·
**`canCommand(s)`** (armed && !estop — the safety model's core motion gate, shared by Go-To,
Hold and RTH; RTH just adds a home) · `canSpawn(s)` (sim only) · `canSetHome(s)` (a live
link, NOT an arm). Each defaults to the live `S`, so a caller with no state in hand asks the
same question. `cmGate(rowId, allowed, why)` now takes the predicate's ANSWER, so the rule is
never spelled inside the menu — check 16 still enforces that.

**AND THE `goto` / `spawn` MODES ARE DELETED.** They were reachable ONLY from those two
buttons, so removing them left two unreachable branches in the mouseup chain, two `classList`
toggles and the "never leave placement armed on a real link" reset. All gone — `setMode("goto")`
and `setMode("spawn")` no longer exist. **Careful when grepping: `S.behavior === "goto"` is the
SERVER's behaviour name and is very much alive** (the run-route diamonds, the plan readout);
check 15d asserts the modes are gone AND that the behaviour name survived.

**32 checks, 36 mutations, 0 survivors.** **THE ONE THAT SURVIVED FIRST IS THE LESSON, and it
is the sharpest of these three sessions:** my check 15b — *Set Home never sends the clicked
point*, the safety property above — **re-registered the row with a handler the test wrote
itself**, then asserted that handler sent no point. It passed happily with the real row
mutated to send one. **A CHECK ON A REGISTRATION MUST EXECUTE THE REGISTRATION.** Fixed with
`G.runShipped(src)` — a direct `eval` inside the harness's `with(G)` scope, so the shipped
`cmRow("#cmHome", …)` line runs against the fakes. Same family as "testing a pure helper does
not test that anything calls it", but worse, because here the call site WAS the subject.

**Live-verified on a SECOND console (port 8792) while Andy's own ran on 8791** — never touch
the operator's running console; `mission.json` was hashed before and after and is
byte-identical. Home landed **0 m from the boat and 4,556 m from the clicked point**; Go-To
routed 15 ENC-aware waypoints; Spawn put the boat 0 m from the click; the rows opened on arm
and closed the instant an E-STOP latched. **A launch entry `asv-console-verify` (port 8792,
`--no-log`, temp `--roc-config`) is in `.claude/launch.json` for exactly this.**

## THE MEASURING TOOL + THE CHART CONTEXT MENU (2026-08-08)

Andy: *"Create a right click menu for a measurement tool. Click in one spot drag a line to
another and click again. A measurement of distance flows along the line."* Three forks were
put to him before a line was written, and all three answers shaped the build: the menu also
carries the **point-at-cursor chart actions**; the label reads **distance AND bearing**; and
completed measurements **stay until cleared**.

**WHAT IT IS.** Right-click anywhere on `#map` → `#chartMenu`, which remembers the chart
point it was opened over (`menuLL`, shown in its header) and acts THERE. Rows: Measure
distance (arm/disarm, reads the live `mode`), Clear measurements, Go-To here, Spawn here,
Copy position. The tool itself is `mode === "measure"`, a peer of `wpt`/`survey`/`goto` —
**not a parallel mechanism**, which is why it needed no state machine (see below).

**THE GESTURE NEEDS NO STATE MACHINE, AND THAT IS THE DESIGN.** The measure branch is one
more `else if` in the window `mouseup` chain, which means it sits BELOW the handler's
existing `if(moved > 5 || mode === "pan") return;`. That single pre-existing guard does all
the work: a press-drag is a PAN in every mode, so it can never be read as a measurement, and
a click is a click. First click anchors `measPend`, `mousemove` walks `measPend.b`, second
click pushes to `measures`. **My first design had a `measFresh` flag and a
distance-from-anchor threshold to tell a press-drag-release from a click-move-click; reading
the existing handler properly deleted both.** `tests/measure_tool.js` check 12 is the guard
on that ordering — move the branch above the pan guard and it fails.

**⚠ THE FEATURE EXPOSED A LATENT FAULT WITH NOTHING TO DO WITH MEASURING.** A right-click
fires `mousedown` AND `mouseup`, so the chart's mode chain has ALWAYS run on the right
button — **right-clicking in WPT mode dropped a waypoint**, and had since the handler was
written. Nobody saw it because the browser's own context menu appeared over the result.
Adding a menu of our own would have made it anchor a measurement on the very gesture that
opens the menu. Fixed with **one line at the top of `mapEl`'s mousedown:
`if(e.button !== 0) return;`** — refusing to record drag state there is enough on its own,
because the window `mouseup` then returns at its existing `!wasDrag || !downAt` guard, so
there is no second place to keep in step. Costs middle-button panning, which was never a
stated feature and carried the same misfire. Check 13.

**THE MENU'S VESSEL GATES ARE DERIVED, NOT RE-DERIVED.** `cmGate(rowId, btnId, why)` reads
the `.disabled` of the button that already owns each command — `#b_goto` (armed, no E-STOP),
`#b_spawn` (simulator only) — so a change to either rule reaches the menu for free and the
two can never disagree. **A second ungated path to a vessel command is precisely the "one
value serving two masters" shape this console keeps finding**, and deriving is what keeps
there being only one. A disabled row is inert AND says why beside itself (`arm first`,
`sim only`) — the ROC lesson: a greyed control with no reason reads exactly like a broken
one. Check 16 asserts the menu section contains **no second copy** of either rule.

**THE LABEL FLOWS ALONG THE LINE**: `drawMeasureLeg` translates to the leg's midpoint,
rotates to its screen angle, flips by π when that would print upside-down, and draws haloed
text just off the leg. Distance goes through **`fmtDist()`** — so a measurement follows the
DIST pill like every other long distance, and `units_toggle.js` stays green. Bearing is the
true azimuth **a→b**, three digits.

**THE READING'S SIZE IS ONE CONSTANT: `MEAS_FONT_PX` (15).** Andy asked for bigger numbers
after seeing the first version at 11 px; if he asks again, that is the only number to
change. `MEAS_FONT`, `MEAS_LABEL_GAP` (the gap holding the text off the leg) and
`MEAS_HALO_PX` are all **derived from it** rather than restated — check 7b fails the moment
any of them becomes a pixel literal again. **This is the ENV-rose lesson applied before it
could bite** (`327ce0c`: the ring scaled, the 9 px labels and 1 px strokes did not, and the
composition came apart as it grew). **And the fit floor is now MEASURED, not remembered:**
a leg carries a label only if it is longer than `ctx.measureText(text).width` plus
`MEAS_LABEL_PAD_PX` — the old hardcoded 30 px floor was tuned at 11 px and would have been
simply wrong at 15. Check 7c pins Andy's actual requirement rather than the number: the
reading must be LARGER than the chart's ordinary markers, whose size is read out of
`render()` instead of restated. **Measured on the live canvas at 15 px: cap height 10.1 px
(36 % up from 11 px), text 112 px for a 14-character reading, sitting 7.5 px off the leg.**
**MAGENTA** (`MEAS_COL`) on purpose: S-52 reserves it for the mariner's own information and
it was the one chart colour unspent here — amber is the plan, cyan the track and transit
draft, green/orange the routed run — so a ruler can never be mistaken for something the boat
will drive. Drawn AFTER the boat in `render()` (check 25): the move-grip lesson.

**IT IS AN ANNOTATION, DELIBERATELY WITH NO PERSISTENCE.** Not uploaded, not in
`mission.json`, not on the wire, not in the session log, not in `localStorage` — a refresh
clears it. Check 24 scans every line in the page that mentions `measures`/`measPend` against
the outbound paths. **If a future session is asked to persist measurements, that check is the
thing to change deliberately, not to work around.** `Esc` peels ONE layer per press — menu,
then the half-drawn leg, then the completed set, then the tool — and skips a focused
INPUT/SELECT/TEXTAREA.

**TWO TEST LESSONS EARNED HERE, both already in the general list but re-learnt the hard way:**
- **THE HARNESS THAT CANNOT SURVIVE THE FAULT IT TESTS FOR.** I moved the menu scenarios out
  of their thunks so failure notes would report the state the check actually saw (they had
  been rebuilding a fresh empty object and printing `[]`). That made the `cmGate` mutation
  **CRASH** the suite instead of failing it — and only because the runner scores a crash
  separately did it show up as anything other than a clean pass. Setup that runs outside a
  thunk now goes through `attempt()`, which turns a throw into data.
- **A MUTATION THAT DOES NOT VIOLATE THE INVARIANT PROVES NOTHING.** My first "drawMeasure
  painted before the boat" mutation only swapped it past `drawPatMoveGrip` — still after the
  boat — and check 25 rightly passed. The real mutation needs TWO edits (lift it out, re-seat
  it above `if(asv){`). It survived once for exactly the right reason, and the fix was to the
  mutation, not the check. **The CRLF trap also cost a round: `static/asv.html` is CRLF, so
  six multi-line anchors written with `\n` matched nothing and scored SKIP.**

**29 checks, 29 mutations, 0 survivors, 0 skipped.** Live-verified in a real browser for
everything source shape cannot see — screenshots time out on the animating canvas, so the
ink was read with `getImageData`: the magenta bounding box hugs the leg's own box (the label
is contained ALONG the line, not sticking out horizontally), and `ctx.rotate` was intercepted
on the LIVE canvas across twelve compass directions, worst effective rotation exactly 90°.
Also confirmed live: the pill converts a drawn measurement (3.68 km ↔ 1.99 nm), a right-click
anchors nothing, the click that dismisses the menu commands nothing, and the controls window
suppresses the menu even when forced visible.

## MULTI-SOURCE AIS — MANY FEEDS, ONE MERGED PICTURE (2026-08-05)

Andy's ask: "multiple source feeds merged into a single display source", naming AISHub,
AIS-catcher, rtl-ais and OpenCPN. The service already had the right shape — every source
writes one MMSI-keyed `Registry` — so this build-out added SOURCES and made the merge honest.

**What was built (`ais_service.py` + console pass-throughs + card logic):**
- **`aishub`** — HTTP poll at AISHub's hard 1-req/min limit (65 s; 15 min after an auth
  refusal). **Faults arrive AS DATA on HTTP 200** (`[{"ERROR":true,...}]` — measured live:
  `Invalid username or password!`) and are surfaced in the upstream's words, never ingested
  as an empty sea — the aisstream error-frame lesson, third instance. **Response format
  (human units vs raw AIS units) is detected ONCE PER RESPONSE from the coordinates**, then
  scales every field — field-by-field guessing cannot work, a raw SOG of 74 (7.4 kn) is
  indistinguishable from 74 kn on its own.
- **multi-endpoint `nmea`** — repeat `--nmea udp:PORT | tcp:HOST:PORT` (console:
  `--ais-nmea`); one source per endpoint, each named (`nmea-udp-10110`) with its own health.
  AIS-catcher and rtl-ais both emit AIVDM over UDP — `udp` BINDS; `tcp` CONNECTS to a
  served stream. A bad spec REFUSES loudly (`_parse_nmea_spec`), never binds the wrong thing.
- **`opencpn`** — a NAMED TCP client source (subclass of NmeaSource) for OpenCPN's relay:
  Options → Connections → Add → Network/TCP, port 10110, Output enabled. Console:
  `--ais-opencpn [HOST:]PORT`. Nothing OpenCPN-specific on the wire; the name is provenance.
- **Merge provenance + the stale-position guard** (`Registry.update`): per-vessel `srcs` =
  every feed that reported it; `src` = the feed whose POSITION is displayed; a polled report
  with `pos_time` OLDER than the held position drops its position fields (statics still
  merge) — a 1-min AISHub poll can never walk a live receiver track backwards.
- **`auto` expands IN PLACE** in a comma list (`auto,opencpn` keeps both) and appends
  `aishub` when `$AISHUB_USER` exists. **Naming an endpoint enables its source** — the
  console appends `nmea`/`opencpn` to `--ais-source` when `--ais-nmea`/`--ais-opencpn` given.
- **Card logic** (`asv.html`): the named source is the healthiest by preference order
  (prefix-matched so `nmea-udp-*` reads as a local receiver); the layer reads "error" ONLY
  when EVERY source errors — one dead feed beside a live one is a note, not an outage.

**A LIVE ORDERING DEFECT FIXED ON THE WAY:** `main()` applied `--ais-collect-km` AFTER
`_start_ais_service()`, so a widened collect radius never widened the FIRST subscription —
only the one rebuilt after a vessel switch. The radii and source flags now settle before
the child starts (and `_rescope_ais_service` reproduces the same config from module globals).

**Machine recon (2026-08-05):** OpenCPN 5.10.2 IS installed (`C:\Program Files\OpenCPN`)
but has never been configured — no connections in its config, so its Output relay needs the
4 clicks above before `--ais-opencpn` has anything to read. AIS-catcher / rtl-ais are NOT
installed (no RTL-SDR path exercised); their UDP path is verified synthetically. AISHub API
probed live: answers, and refuses without a member username — **membership requires
CONTRIBUTING a feed**, so like MarineTraffic this is PARKED until Andy has an account
(`setx AISHUB_USER ...`; it is a username, not a secret, but still never hardcoded).

**Verification:** `tests/ais_sources.py` (26 assertions, hermetic — fake AISHub HTTP
server, loopback TCP/UDP, the canonical GPSd AIVDM sentence: MMSI exact, position range
checked, and my remembered "Vancouver" coordinates were WRONG — it decodes to 47.58 N
Seattle; the fixture originally mixed human+raw units in one response, contradicting the
uniform-format premise the detector rests on — both fixture bugs, not code bugs).
**6/6 mutations caught** (stale guard, error-head swallow, format detection, proto
honoured, provenance, opencpn label), source restored byte-for-byte, runner table in the
docstring. **Live end-to-end:** a real console with `--ais-nmea udp:31399` + a crafted
AIVDM sentence at Lewes → `/api/ais` returned the vessel (decode exact, `src`
`nmea-udp-31399`, range 2.5 km); browser-driven check on a scratch console: card reads
`● 2 vessels · 27 nm · nmea-udp-31388`, label "(local receiver)" via the prefix match.
All AIS-adjacent suites green (`ais_range`, `ais_error_frames`, `ais_table`,
`http_contract`, `data_routes`). Ops + tech manuals updated and rebuilt (the only two
docx that changed); README AIS section rewritten for the merge model.

## THE EMPTY AISSTREAM FEED, AND THE ERROR-FRAME SWALLOW (2026-08-05)

Andy: “check aisstream. no vessels to 81nm seems strange.” He was right — the baseline
measured 2026-08-04 was 94 vessels / nearest 44 nm on this exact geography, and 81 nm is
just the 150 km collect radius in nm: the display was maxed over an EMPTY registry.

**THE DIAGNOSIS CHAIN, each link verified live (keep the technique):** console healthy at
Lewes → service child running with the CORRECT key (`auto → aisstream`) and the CORRECT
box (byte-identical to the proven-good subscription) → fresh service instance: connected,
zero reports → the proven-instant NY/NJ box: zero → a RAW-SOCKET probe printing every
frame verbatim: handshake accepted, subscription accepted, then pure silence — no data,
no error frame, no close → **whole-world, filterless: zero frames in 60 s**, which rules
out geography, box format and message filter in one stroke. **VERDICT: upstream —
aisstream delivering nothing on this key that day.** Discriminator if it recurs: mint a
second free key; silence on a fresh key = their outage, traffic on it = this key flagged.
**ALSO MEASURED: aisstream rate-limits connections PER KEY** — a fourth simultaneous
connection got `429 Too Many Requests` on the handshake. `$AISSTREAM_KEY` is
machine-wide, so the ASV and Z-Boat consoles CONTEND if both run AIS at once.

**THE FIX THE INVESTIGATION FORCED OUT (Andy's call): the error-frame swallow.**
aisstream reports faults — “Api Key Is Not Valid”, connection limits — as a TEXT frame
`{"error": ...}` on the SAME channel as vessel data. The read loop stamped “ok /
connected” on ANY frame and passed it to `_ingest`, whose no-MMSI discard dropped it
silently; and the quiet-box timeout path re-stamps its note every 30 s, so even a
surfaced error would have been overwritten moments later. **A dead key read as a quiet
sea, forever.** Now: `_frame_error()` classifies (MetaData = vessel data whatever other
keys it carries), the loop surfaces `aisstream: <message>` as state “error”, the timeout
path HOLDS a remembered error instead of erasing it, and real data flowing clears it.
`tests/ais_error_frames.py` (10 assertions, hermetic — the REAL run() loop driven
through a scripted fake websocket, no network, no console; 4/4 mutations caught incl.
the swallow restored). Ops manual: the empty-card taxonomy gains its third kind — an
upstream-named fault is never displayed as a quiet sea.

## THE ROUTE-COVERAGE THREAD IS COMPLETE — vessels/comms/tide/roc (2026-08-05)

The last four surfaces, and with them **every route the estop_chain audit flagged now
has a behavioural suite watching it**. `tests/data_routes.py` (15 assertions, real
console, logging ON, 8/8 mutations caught after one weak check was exposed and
strengthened — table in its docstring).

**What it pins:**
- **The vessel switch's SAFE gate** (409 while armed — read in code the day the audit
  began, exercised now for the first time) and the switch itself — where the mutation
  pass caught ME: the energy-gauge flip alone SURVIVED the respawn-dropped mutation,
  because `energy_type` reads the module global `POWER_TYPE` at snapshot time and the
  OLD boat starts reporting "battery" the moment `apply_vessel` runs. The check now
  demands the boat come up at the NEW vessel's OWN spawn — the one observable a
  respawn uniquely produces. **Pick the observable only the mechanism under test can
  produce** — the estop seam lesson, hit again from a new angle.
- **The comms password's THREE never-leak paths, separately mutated:** not persisted
  (comms_config.json), not echoed (the GET's config dict), not logged (`_redact` →
  `***` in the session recording — needs logging ON, the --no-log mask again). Plus
  the mode whitelist ignoring garbage.
- **/api/tide answers** whatever CO-OPS' mood — degradation lives in the body, never
  the response.
- **The ROC HTTP face's error mapping**, which roc_tracks.py's unit tests never see:
  unknown op → 400 naming it, malformed args → 400 "bad roc request", feed for a
  missing id → 404 ok:false, and an add echoes the fresh snapshot.

**COVERAGE ARITHMETIC, FINAL:** the audit found 20 of 33 routes untested on 2026-08-04.
Every consequential route got its suite (estop_chain, run_link_control, home_spawn,
energy_chartinfo, enc_extract, env_water, log_routes, data_routes — eight suites, five
live defects found and fixed on the way: the AIS-radius tuple break's three
dropped-connection cousins, Set-Home's dead-boat fix, and the enc/chartinfo twin's
weak-check findings). The thread that began with "does anything prove E-STOP stops the
boat" ends with 29 suites / 405 assertions and no route whose failure mode is untested.
**The development guide now carries the campaign** (added 2026-08-05, after the
closing commit): defect shapes **6.5 "the unguarded branch before the safety net"**
(the dropped-connection family + its placement rule) and **6.6 "the masked branch"**
(--no-log; a masked branch is untested no matter how many suites run past it), and case
study **8.7 "the coverage campaign"** with the four mutation rules the thread earned.

**AND THE MUTATION RUNNER ITSELF IS NOW DOCUMENTED (2026-08-09), because it damaged this
repo twice.** Defect shape **6.7 "a check that cannot report the fault it exists for"** —
a suite that dies part-way prints no FAIL line, and "no failures printed" is
indistinguishable from "everything passed" to whatever grades it; **including the trap of
fixing the wrong symptom** (asserting the console still ANSWERS when the real invariant was
that HOME is still a usable coordinate). Case study **8.8 "the tool that damaged the thing
it was testing"** — a killed runner does not run its cleanup, so the recovery must be
durable and visible: **a `.mutorig` sidecar restored on START, atomic writes, background
execution, and a `git diff` after every run**. It also records the two cheaper traps from
the same session: **a line-ending mismatch silently matching no anchors** (the repo blob is
LF, the working copy CRLF), and why a missing anchor must score as SKIPPED rather than
caught. **Read 8.8 before writing another mutation runner.**

## /api/logevent + /api/logs + /api/log UNDER TEST — THE FAMILY'S THIRD MEMBER (2026-08-05)

Andy's next two routes (plus /api/log, their sibling). Grounding found the THIRD
dropped-connection defect in three rounds, and the sharpest: **/api/logevent unpacked the
CLIENT-supplied `data` dict as kwargs — `LOG.event("client:"+kind, **data)` against
`event(self, kind, **payload)` — so a legal JSON body with a data key named `kind` or
`self` was a TypeError** ("got multiple values for argument"), a dropped connection and a
dead thread, in a branch before the dispatch try. Reproduced live, both spellings.
**WHY 28 SUITES NEVER SAW IT: every real-console harness passes `--no-log`, which sets
`LOG = None` and skips the branch entirely** — a masked branch is an untested branch no
matter how many suites drive the console. `tests/log_routes.py` boots WITH logging on.

**THE FIX: RENAME, don't refuse** — colliding keys become `kind_`/`self_`; a session log
should swallow an odd field name, not reject the operator's event over it. The record
shape stays FLAT (playback reads it — a nesting fix would have been a silent format
change, and check 2 pins the flat shape as a contract).

**`tests/log_routes.py` (9 assertions, real console, logging ON; 6 mutations caught + 1
survival predicted-then-earned — table in its docstring).** Beyond the fix: the logevent
round-trip is read back OUT OF THE JSONL (kind prefixing, default kind, non-dict data
wrapped, 64-char truncation, a non-identifier key recorded); `/api/logs` lists the live
session with name/size/mtime; and **`safe_log_path`'s traversal guard is exercised for
the first time since it was written** — seven refusal spellings including two SEEDED
targets that isolate each layer: a shape-perfect `asv_*.jsonl` OUTSIDE the dir (only the
bare-basename rule refuses it) and a wrong-shape file INSIDE it (only the shape rule
does). **The seeding is the lesson: a layered guard cannot be tested by spellings one
layer happens to stop** — and the lone bare-basename drop SURVIVES by design (the join
is on the basename), predicted before the run this time, earned by the pair.

## /api/env + /api/waterlevel UNDER TEST — AND A DROPPED-CONNECTION DEFECT (2026-08-05)

Andy's next two routes. Grounding found a live defect BEFORE any check was written, in
the recurring family but a new subspecies: **`/api/waterlevel`'s `manual_offset` cast
was a bare `float()` in a branch that sits BEFORE `_dispatch_post`'s try/except** — the
only unguarded numeric cast outside the guarded region (swept: env guards locally, ROC
has its own 400-returning try). POST `{"manual_offset": "abc"}` unwound the dispatcher:
**the client's connection DROPPED with no response at all and the handler thread died
with a ValueError traceback** — reproduced live before fixing. A cousin of the
ais/radius shape, but worse for the client: ais/radius at least answered before dying.
Fixed with a local guard in env's style → 400 naming the rule. **Placement note for
future routes: a branch added before the dispatch try gets NO safety net — its guards
must be local.**

**`tests/env_water.py` (11 assertions, real console, 6/6 mutations caught — table in
its docstring).** What it pins:
- **THE PHYSICS SEAM:** a manual 25 kn wind + enabled monitor on a RUNNING boat must
  publish a nonzero `env_set_kn` — the override REACHES the boat, not just the
  snapshot; idle stays zero (env applies only to a running boat); **DISABLING returns
  the set to zero** — `field()` yielding None on disabled is what makes calm reproduce
  clean tracking, and every other suite that assumes calm water stands on it.
- **Merge semantics:** field-by-field merge across posts; `""` clears ONE field;
  `auto` drops the whole override and the source reverts to the live buoys. **The
  mutation lesson: a check that catches a merge bug must SPAN posts** — fields sent in
  one body look identical under merge and replace; only a two-post sequence tells them
  apart (the merge mutation survived the one-body check and was caught by the
  two-post one).
- **Waterlevel server half** (the client trust chain is `water_trust.js`'s): manual
  set echoes source/value/note; `""` CLEARS rather than becoming a 0.0 override — a
  cleared box and a zero-metre override are different states with the same rendered
  number, and `source` is what says which.

## /api/enc UNDER TEST + THE CHARTINFO TWIN DEDUPLICATED (2026-08-05)

Andy's instruction: cover `/api/enc` and collapse the duplication the previous pass had
surfaced (the anchor-×2 SKIP). Both done in one commit — `tests/enc_extract.py`
(10 assertions, real console, 6/6 mutations fully caught) plus two shared helpers.

**THE DEDUPE:** `_bbox_key(bbox)` — one cache-key format for the features cache AND the
chartinfo cache; `_bbox_from_query()` — one query parse for both GET handlers, each
keeping its OWN usage message. Behaviour-preserving (energy_chartinfo passed untouched
against it before the new suite existed). **The mutation rule that makes the dedupe pay:
shared-code mutations run BOTH suites and must be caught from BOTH sides** — the key
break was caught by six checks across the two suites on its first run.

**THE ENDPOINT'S CONTRACTS:** malformed bbox (five spellings incl. no query at all) is a
400 naming the ENC usage, never a 502; the extract is SERVED FROM `features_v3_<key>`
cache (proven by a sentinel at a mid-ocean bbox upstream would refuse — only the cache
can answer); **the shallow retag is PER-REQUEST and the cache is READ-ONLY under it** —
`shallow = DRVAL1 < min_depth` computed fresh every request, `min_depth` echoed, the
boundary EXCLUSIVE (DRVAL1 exactly at the limit is not shallow), the cache byte-identical
across three different depth limits. That read-only property is what makes one fetch
safe for every depth limit; a baked-in tag would answer only the first limit ever asked.
The retag touches ONLY depth_area features. `%2C` and plain commas are the same bbox.

**THE PASS'S BEST FINDING WAS A WEAK CHECK IN THE NEIGHBOUR SUITE:** cross-wiring
chartinfo's usage message to the ENC one was caught by enc_extract's cross-check and
SURVIVED energy_chartinfo — whose 2b accepted ANY message containing "usage". The suite
that OWNS an endpoint could not see its own usage line replaced; the guard lived only in
a bystander a refactor could delete. 2b now demands `usage: /api/chartinfo?` and the
re-run is caught from BOTH. **Rule worth keeping: a mutation that survives the owner and
is caught by a bystander is a weak-check finding, not a covered property.**

Also corrected in OPEN/NEXT: `/api/enc` and `/api/chartinfo` are GETs — the earlier
route arithmetic counted them among POSTs off a grep of the string literal.

## ENERGY OVERRIDE + CHARTINFO UNDER TEST (2026-08-05)

Andy's next two routes. No defect this time — but the pass pinned two shapes that were
one refactor away from silent loss, and recorded a twin worth knowing about.

**`tests/energy_chartinfo.py` (13 assertions, real console, 6 mutations caught + 1
survival EARNED by its pair — table in its docstring).**

**ENERGY IS TWO LAYERS, and the suite had to be designed around the mask.** The sim link
stops the burn and holds the tank (`SimVcu.set_unlimited_energy` + the tick's
`_unlimited_energy` branch, which RE-FILLS every frame); the engine SEPARATELY force-fills
the published gauge at `state()` time. While the override is ON, the engine force masks
whatever the sim tank does — so check 8 holds the override ON through ~45 s of hard
running and reads the tank ON THE FRAME AFTER lifting it: only then can a silently-dead
sim layer show (a missing ~0.13 L at the 1-decimal gauge). Asserting during the ON window
cannot see this. The engine layer's own proof is check 10: override ON while
DISCONNECTED — no sim to snap, stale status carrying the burned reading — and the gauge
must still publish full; the force-fill mutation was caught by that check ALONE.
The enable-time snap mutation SURVIVED alone (the tick hold re-fills every frame) and the
pair-removal was caught — earned layered defence, same as the estop tick gate.

**CHARTINFO IS HERMETICALLY TESTABLE via its exact-key cache** (`chartinfo_v1_W_S_E_N
.json`, %.4f each, under `charts/enc`): the suite SEEDS a sentinel entry at a mid-ocean
bbox and the endpoint must serve it byte-for-byte, in BOTH spellings — plain commas and
`%2C` (the ais_service percent-decoding bug made that a class). Malformed or wrong-arity
bbox is a 400 with the usage string, never a 502 from downstream. The REAL Lewes cache is
checked opportunistically when present (gitignored, so a fresh clone reports the reduced
scope explicitly rather than failing).

**THE TWIN, recorded for whoever covers `/api/enc`:** the first mutation runner SKIPPED
both chartinfo mutations — anchor matched TWICE, because `/api/enc` carries a
byte-identical parse-and-key block. The SKIP rule surfaced it instead of silently
mutating the wrong function. `/api/enc` is still uncovered, and that duplication is a
refactor candidate the day it gets a suite.

Ops manual: the BATT/FUEL pill row now documents the click-to-override the pill has
always carried (it only said "energy remaining"). Tech manual 13.1 picks up the suite
(derived).

## SET-HOME COULD CAPTURE A DEAD BOAT'S FIX — FOUND COVERING sethome/spawn (2026-08-04)

Andy's next two routes. Grounding the contracts before writing a single check found a
REAL defect of the project's recurring shape (one value trusted without its provenance):
**`Engine.status` was only ever ASSIGNED when a telemetry frame arrived** (`if telem:` in
the run loop), so it retained the previous link's last fix forever — and **`set_home` had
no not-connected guard**. Two live consequences: Set-Home after `/api/disconnect`
"succeeded" and captured the DEAD boat's position, announcing "Home set to present
position"; and connecting a REAL link (Phase 0 produces no telemetry at all) after a sim
session did the same — a home for a real boat, taken from a simulation. **RTH drives to
home, so a stale home is a destination, not a display blemish.**

**THE FIX, two halves, deliberately both:**
- `set_home` gains `_require(self._link is not None, "not connected")` — the guard every
  other command already had. The no-fix guard STAYS behind it for a link that is up but
  has not fixed yet.
- `connect()` clears `self.status = {}` — a new link's life starts with NO telemetry.
  This is the server-side twin of the boot_id rule (the browser drops the old trail; the
  server now drops the old boat's last frame). Every consumer of `status` benefits, not
  just Set-Home.
The halves are INDEPENDENT: the guard catches the disconnected case, the clear catches
the connected-but-fixless case, and the mutation pass proved neither check covers the
other's fault (`home_spawn` 9 and 10, each caught alone).

**`tests/home_spawn.py` (14 assertions, real console, 8/8 mutations caught — table in
its docstring).** The other contracts it pins: **sethome captures the boat's own fix and
IGNORES the request body** (a decoy posted 0.5° off must be discarded — a home the client
can plant is a home a stale form field can plant); **HOME IS THE RTH TARGET** — sail out
~600 m, Return-to-Home closes to <120 m on exactly the home sethome captured, which puts
`rth`'s happy path under test for the first time; **spawn is reset-with-a-position** —
numeric + range-validated (a REFUSED spawn power-cycles NOTHING: same boot_id, the
running RTH hold undisturbed), and an accepted one is a full fresh boot AT the point with
home re-arming THERE, not at the old home a kilometre away. Spawn on a real link refuses
with reset's simulator-only message — the same guard covers both doors into the
power-cycle. Best unplanned catch: planting client coordinates as home failed check 5
too — the RTH closed on the planted point, so the consequence check sees the lie from
the other end.

Ops manual 8.5 (Set Home) now states the provenance rule and both refusals. No client
change — the SET HOME button already sent no coordinates; the decoy in check 2 proves
the server ignores them if anything ever does.

## THE ENV CARD IS DELETED — THE ENVIRONMENT IS NOT (2026-08-08)

Andy: "delete the ENV card functionality." **Scope confirmed with him before cutting,
because the card held three separable things with different consequences:** the env SIM
CONTROLS (which drive real physics), the WIND ROSE (display), and a TIDE · WATER LEVEL
box belonging to a different subsystem whose offset corrects charted depths. His answers:
**delete the CLIENT card only — keep the server-side environment — and delete the tide
DISPLAY while keeping the correction.**

**GONE (client only):** `#envPanel` and the `ENV` toolbar button, `drawWindRose`,
`drawTide`, `fitEnvCanvas`, `ENV_DESIGN`, `compassName`, `fetchTide`/`tideData`,
`postEnv`, `redrawEnvGraphics` + its resize wiring, every `#env_*` / `#tide_*` /
`#wind_*` control, and the card's entries in `UI_BRIDGED`, the split CSS, the card-title
map and `RESIZABLE_CARDS`. ~18.6 k characters of `static/asv.html`.

**AND A WHOLE SUBSYSTEM THE CUT EXPOSED AS DEAD:** the split-window CANVAS MIRRORING —
`paintUICanvas`, `uiCanvasCache`, the `{t:"canvas"}` message and a 400 ms `setInterval`
shipping PNGs between windows — existed ONLY because those two canvases cannot travel
through the `outerHTML` mirror. With them gone it has no other user. *Deleting a feature
is not only tidying: it retires the scaffolding that existed solely to carry it.*

**KEPT, and this is the load-bearing half.** `EnvMonitor` still locates NDBC buoys,
`/api/env` still overrides and disables, and `SimVcu` still pushes the boat with wind
and wave — `env_water.py`'s physics-seam checks (2/3/4) pass untouched. The water-level
correction still adjusts charted depths and the nogo floor. What remains of the UI is
`updateEnvUI`, now feeding ONLY the vessel-status card's WIND / SEA / SET·CRAB rows —
**those are not a leftover duplicate of the deleted card, they are the readouts that
explain a boat sitting off its trackline, and they are now the only place that says so.**
The SRC card still states the water correction and its datum, so an adjusted depth is
not entirely silent. Overriding or disabling the forcing is now an API-only action
(`POST /api/env`), which the ops manual says plainly.

**A TEST TRAP WORTH THE WHOLE ENTRY.** `ui_split.js` check 12 asserted
`regCards.length >= 10` — a magic number that failed the moment a card was deleted while
the registry was still complete. Rewritten to DERIVE the panel list from the markup. **My
replacement then passed no matter what, because I handed this suite's `check()` an arrow
function and it reads `cond` directly rather than calling it — a function object is
truthy.** Every other check in that file passes a boolean; mine was silently vacuous, and
the only reason I caught it is that I injected an unregistered panel and it FAILED TO
FAIL. **Before trusting a check you just wrote, make it fail on purpose** — and know
which harnesses take thunks (`env_water`, `roc_persist`, `panel_drag`) and which take
booleans (`ui_split`). `tests/env_card_graphics.js` is deleted with the feature.

## THE SRC CARD LISTS EVERY CHART IN VIEW (2026-08-07)

Andy: "Chart source Card: Display all charts rather than the selected chart and
'others'." The card named one cell and counted the rest — `US5DE1EF +3 in view` —
with the other names reachable only as a hover tooltip. **A survey routinely spans
several cells, and the sheet the vessel floats on says nothing about the scale,
survey dates or currency of the ones the lines are about to run over**, so the
count hid exactly the charts worth looking at. Now one row per cell, sorted
BROAD→DETAILED by usage band (the name's 3rd character) then by name, each row
keyed `data-cell` (the AIS table's `data-mmsi` pattern) and carrying its usage band
spelled out; the vessel's own cell is bulleted AND named in words underneath —
a bare green dot is a guess.

**TWO CORRECTNESS FIXES CAME OUT OF IT, both invisible before the list existed:**
- **one cell arrives as SEVERAL `Coverage_area` polygons**, so the rows are folded
  by name and the vessel is inside a cell if **ANY** of its polygons contains the
  fix (latched, never overwritten per polygon);
- **which cell is "mine"** was `cells.find(...)` — whichever polygon the service
  happened to return first. It is now the **largest-scale** cell containing the
  vessel (the sheet a navigator is bound to where scales overlap), and the card
  says how many cover the vessel in total. Inside none of them, it says so rather
  than promoting a neighbour.

`tests/chart_source_card.js` (16 checks, 10/10 mutations) runs the real
`updateChartCard` against a stub DOM. **THREE OF ITS CHECKS ONLY GREW TEETH ON THE
SECOND ATTEMPT — all the 6.4 "cannot tell the bug from the fix" shape, and all three
traps are generic to list rendering:** (1) **order matters in a fold** — with the
containing polygon listed SECOND an overwriting fold still ends up `true`; only
containing-FIRST separates "any polygon counts" from "the last one decides".
(2) **US cell names cannot test a band sort** — every US name starts `US`, so the
usage digit is the 3rd char of an identical prefix and alphabetical order IS band
order; a Canadian sheet beside a US one splits them (real: CA/US cells overlap
across the Great Lakes). (3) **a tie-break needs a tie** — three cells one-per-band
never exercise the within-band comparator; the four real band-5 Lewes cells do.
**A harness trap worth keeping too:** `let` declared inside an `eval` is
block-scoped to that eval, so state assigned from outside is a DIFFERENT binding
from the one the card reads — the first harness painted an empty card and blamed
the page. It now returns a painter closure from inside the eval.

Live against the real Lewes ENC: all four cells (`US5DE1DF/DG/EF/EG`) listed in
order, `US5DE1EF` marked `data-here`, legend reading "● the vessel is on
US5DE1EF". Ops manual 6.3 + tech manual's card table + README updated and rebuilt.

## THE ROC CARD: THE REMOVE BUTTON WAS NEVER BROKEN (2026-08-08)

Andy: "The ROC card opens with old data. The remove button on each entry fails to remove
the entry. Delete the data and allow only the most recent 3 entries to preserve through
restarts."

**`roc_config.json` held 198 IDENTICAL STAGED ROCs, and they were OURS.**
`tests/http_contract.py` POSTs every ROC op — `add` among them — against a live console
started with `cwd=APP`, so **every run wrote one more ROC into the OPERATOR'S OWN
registry** and nothing ever removed it. Same class as the mission.json scare, except this
one was real and had been accumulating since the suite was written.

**THE REMOVE BUTTON WORKS. IT ALWAYS DID.** Every ROC edit ships the whole registry back
and re-renders the whole list, so measured in a real browser one Remove took **~1200 ms
at 198 entries against 28 ms at 4** — and it took away 1 row out of 198 identical ones.
The operator clicks, nothing appears to happen, the list looks unchanged. **A control
that is correct but smothered by data reads exactly like a broken control**, and the
first instinct — go and read the click handler — finds nothing, because there is nothing
there to find. Check 12 now pins `remove()` so a real regression is not blamed on the UI.

**THE FIX, three parts:**
- **`ROC_PERSIST_MAX = 3`, enforced on SAVE AND ON LOAD.** The load side is what makes an
  oversized file left by an older build heal itself on the next start instead of needing
  to be deleted by hand. **The LIVE registry is NOT capped** — a session may place as
  many as the work needs; the cap is a property of what SURVIVES.
- **HOME is the one exception to "most recent".** If it falls outside the tail it
  displaces the OLDEST kept entry, so the count stays 3 and Return-to-Home cannot quietly
  move on a restart.
- **`--roc-config PATH` + `RocTracker.use_config()`**, and both ROC-touching suites now
  pass it. Proven by hash: the operator's file is byte-identical after running them.

**A REAL LATENT BUG FOUND ON THE WAY, and it is the sharper one:** `_load` builds the
offset as `{"range_m": c.get("range_m"), ...}`, so a record written before those fields
existed arrives with the keys PRESENT and None. The merge used `if k in offset`, which
overwrote the defaults with None, and `set_offset()` SKIPS None — so `self.range_m` was
**never assigned at all** and the first read of the arrival point raised inside
`snapshot()`. **One malformed record would have taken out the whole ROC card and every
`/api/state` frame with it.** Fixed in `Roc.__init__` (`offset.get(k) is not None`), which
covers the `/api/roc add` body too — the producer, so every caller inherits it.

**New suite `tests/roc_persist.py` (16, 8/8 mutations).** **TWO of those mutations first
scored as survivors by KILLING THE HARNESS** — module-level `snapshot()` and `add()` calls
threw under the very fault check 8 exists for, so the process died before the relevant
check ran and printed no FAIL line. *A harness that cannot survive the fault it tests for
cannot report it* — already written down in this file for `stored_settings.js`, and
reintroduced twice here. Every fault-touching call is now inside a thunk. **A third check
was auditing ITSELF:** the "no suite may write to the operator's registry" check matched
files by substring, and this file names both `asv_console.py` and `--roc-config`, so it
put itself in its own audit set and passed on its own text. It parses the AST for a real
`Popen` CALL now — a pattern that occurs in its own source cannot tell the two apart.

## THE TURN YIELDS TO THE CHANNEL — channelTurnKeepouts / koTurn (2026-08-07, landed 08-08)

Andy, with a screenshot, mid-mission at Lewes: "The survey plan end of line turns are
pushing into the channel across the line of pilings in a dangerous maneuver. This must
not happen." **Diagnosed from his exact logged plan** (the session log carries the
`/api/mission` save — 897 waypoints, 38 lines): all 50 in-channel waypoints were TURN
points, zero coverage-line points, two 24-point loops reaching 34.3 m inside the
dredged channel. **Every layer was individually "correct", and that is the finding:**
- the dredged channel is only a keep-out when the operator enforces "Dredged /
  restricted" — OFF by default, or no boat could ever transit a channel;
- `channelSpanKeepouts` fires only when a coverage line crosses the channel
  out→in→out, and his lines ran PARALLEL to it (bearing 213° vs the channel's axis) —
  and it only ever clipped LINES, never the turns connecting them;
- the pilings are charted as individual `Pile_point` features ~60 m apart, so the
  turn's legClear sweep lawfully THREADED between their keep-out disks while crossing
  the pile ROW as a real-world barrier. **A row of points is not a line to the model.**
- reproduction needed the plan-time tide: at `waterOffset` 0 the turns refuse on
  shallow water and the fault hides; at his +1.54 m (live NOAA, verified) 30 turns
  generate and 68 arc points sit inside the channel.

**THE RULE (one derived rule, no new setting): a turn may only use channel water the
survey's own coverage lines occupy.** `channelPolys` (factored out of
channelSpanKeepouts: dredged areas + buoy-gate fairway corridors) minus the polys any
CLIPPED line samples into = `turnExcl`; `koTurn = ko + turnExcl` governs
`teardropTurn`, the `legSafe` closure (serpentine adjacency AND the reversal
straight-hop fallback) and, via `koHere = antiParallel ? koTurn : ko`, the
routeAround/channelLaneRoute fallback for a REVERSAL — while genuine region-hop
transits keep plain `ko` (crossing a channel to reach the other side is lawful
navigation under gateLegClear). The grant is PER POLY and strict on purpose: a
wrongly refused turn is a visible straight-hop flag; a wrongly granted one is a
silent excursion into traffic. An in-channel survey keeps each fragment its lines
reach; the spanning case (lines clipped OUT of the channel) forbids it to turns too.

**The refusal names its blocker**: `teardropTurn` returns `{why:"nogo", seg}` (the
failing chord), punchOut runs `firstBlockAlong` over it with koTurn, the nNoTurn
banner branch now calls `setViolations(turnBlocks)` (never clearViolation) so the
channel is OUTLINED with the blocked spot marked, the hint counts "refused by a
navigation channel", and the banner quotes the standoff (~2.75×minR) — because this
"keep-out" LOOKS like open water and the widen-the-spacing advisory alone may not
cure a line that already ends at the channel's edge.

**Verified three ways**: replay of his exact 38 lines (old ko: 30 turns, 68 arc
points in-channel; new koTurn: the 3 channel-crossing reversals refuse by name, 0
points inside, dock refusals unchanged); `tests/turn_channel.js` (14 checks — the
synthetic pier-row world proves the scenario has teeth by running the UNgated
function; 8/8 mutations caught, including restoring the shipped `ko` at the call
site, which only the CALLER check sees); and live in the real console against the
real ENC (reconstructed his box from the log: "25 semicircle turn(s), 5 with no
clear loop (3 refused by a navigation channel)", channel outlined, zero reversal
arc points in the channel — the 8 in-channel via points that remain are genuine
region-hop ROUTED transits, allowed by design). **Mutation trap re-confirmed:
`static/asv.html` is CRLF** — three multi-line anchors written with `\n` scored
SKIP until rewritten with `\r\n`; only a runner that scores a missing anchor as
SKIP (not "caught") surfaces that.

**TWO TEST DEFECTS THE HOOK RUN EXPOSED, both in `run_link_control.py` check 6
(PAUSE → standstill), both fixed in this commit:** (1) the sim's EnvMonitor pushes
the boat with LIVE NDBC weather at the spawn, so the paused boat's SOG floor was
the real wind at Lewes — the check passed for days in calm air and then failed at
sog 0.16–0.18 vs its 0.15 threshold the evening Lewes blew up. A control suite must
not be hostage to the weather: the suite now runs its console becalmed
(`/api/env {"enabled": false}` at boot — the disable-returns-calm behaviour is
env_water.py's own check). (2) Becalming it unmasked the second: the check read
`(sog_kn or 1) <= 0.15`, and a PERFECT standstill reads sog 0.0 → `0.0 or 1` → 1 →
FAIL. The lsGet falsiness lesson, server-side: live weather had hidden it because
sog never actually reached zero. Now `is None`-guarded (`sog_of`). Three
consecutive clean runs after both.

## THE THIRD AND FOURTH WINDOWS: THE STATIONS THE VESSEL SELECTS (2026-08-08)

Andy: "Add a third browser window with `…/waterlevels.html?id=8557380`. This is for Lewes
Delaware. Use the vessel GPS to get the nearest tide station. Conduct a IDW analysis of 3
proximal stations if there isn't one in the immediate area."

**HALF OF IT ALREADY EXISTED, and that is the point worth carrying:** the water monitor
has always located the nearest CO-OPS stations FROM THE VESSEL FIX and blended up to
`WATER_K` (3) of them by inverse-distance weighting (`WATER_IDW_POWER` 2,
`WATER_MAX_KM` 200), banding by distance so a remote reading is never applied to charted
depths. The IDW he asked for was already running. **What was missing was the window — and
the disclosure.**

**THE STATION IS DERIVED, NEVER CONFIGURED.** `tide_station_url()` is the one place the
URL is built and **no station id exists as a literal anywhere in the console** (check 1
guards it, by AST). 8557380 is simply what the DriX spawn resolves to — measured live:
**Lewes 3.7 km (95.5% of the weight), Brandywine Shoal Light 22.3 km (2.6%), Cape May
26.4 km (1.9%)**. Move the boat and the window follows.

**WHY IT IS A DEFERRED DAEMON THREAD, not a `threading.Timer` beside the other two
windows:** at process start there is NO GPS FIX, so there is no nearest station to open.
`open_tide_window` waits for the monitor to resolve one, gives up after
`TIDE_WINDOW_WAIT_S` rather than living forever, and never raises — a browser that will
not open is a missing convenience, not a reason to take the console down. `--browser
none` opens nothing (so every real-console harness is untouched), `--no-tide-window`
skips just this one.

**THE PAGE SHOWS ONE STATION; THE CORRECTION MAY USE THREE.** A CO-OPS page takes a
single id, so it shows the PRIMARY — the nearest station actually returning data, which
is the same one the chart-source card attributes the correction to (**both read
`water.station`, so they cannot disagree** — check 15). Naming one station against a
blended number would misrepresent it, so the blend is PRINTED when the window opens and
the card's Correction tooltip lists every contributor, with an `idw N` marker on the row.
**Reported to one decimal deliberately:** inverse-SQUARE weighting means a station four
times further away counts a sixteenth as much, so at Lewes the split rounds to
"100%, 0%, 0%" at integer precision and hides that the far stations are in it at all.

**THE FOURTH WINDOW (same ask, the other network):** the NDBC page for the nearest
WEATHER BUOY. The env monitor had already been doing the identical thing for wind and
sea — nearest NDBC buoys, `ENV_K` = 3, `ENV_IDW_POWER` = 2 — so again only the window and
the disclosure were missing, plus carrying the contributing buoy ids **with distances**
through `EnvMonitor.snapshot()` (it had the ids but not the distances, and an id alone
cannot say how much a station contributed).

**BUILT AS ONE MECHANISM, NOT A SECOND COPY.** `STATION_WINDOWS` is a registry of two
entries — each naming its snapshot source, URL builder, IDW power, reach and the words it
describes a blend in — driven by a single `open_station_window()`. The hard part (there
is no station until the vessel has a fix) is identical for a tide gauge and a weather
buoy, so a second wait loop would only drift. A third network would be another entry.

**THE NEAREST BUOY IS NOT THE ONE ANDY NAMED, and that is the point of deriving it:** he
gave BRND1 (Brandywine Shoal) as the example, but from the DriX spawn the nearest is
**LWSD1 at Lewes, 3.7 km, taking 95.5% of the weight**; BRND1 is 22.3 km out at 2.6% and
CMAN4 26.4 km at 1.9%. **Both networks resolve to the same three sites** — NDBC carries
the co-located CO-OPS gauges — which is why the weather percentages match the tide ones
exactly.

`tests/station_windows.py` (24, hermetic — fake opener + fake water monitor, no network and
no browser; 9/9 mutations). **TWO HARNESS FAULTS FOUND WHILE MUTATING, both old friends:**
check 8's call sat at module level, so the fault it tests for (a throwing browser)
KILLED the suite instead of failing the check — *a harness that cannot survive the fault
it tests for cannot report it*, third instance in this repo. And check 1 first matched
its own subject: a plain substring search for a pinned station id flagged the word
inside my own COMMENT explaining what Lewes resolves to, so it now walks the AST for
constants used as VALUES, skipping docstrings.

**A REAL SCARE, and the reason the mutation runner now writes atomically:** the first
mutation pass timed out (one mutation removes the wait's deadline, so the SUITE hangs
rather than fails), the runner was killed between `open(path,'w')` truncating and the
write completing, and **`asv_console.py` was left at 0 bytes**. Recovered from HEAD plus
re-applied edits. The runner now writes to a temp file and `os.replace`s it, bounds each
run with a subprocess timeout, and scores TIMEOUT as its own verdict — for that mutation
a hang IS the expected result, and it proves the give-up path is real.

## THE LANE YIELDS TO THE LAW — gateLegClear (2026-08-06)

Andy, with a screenshot: the zboat's Go-To at Erie drove through a charted seawall while
the banner said "routed around nogo zone(s) · Rule 9: channel lane". **Diagnosed with
his exact recorded route (the session log carries every goto's waypoints) and reproduced
to five decimal places: `legPath` HAD routed clear of every keep-out — then
`channelLaneRoute` REPLACED that route with the buoy-gate centreline (offset to port),
`smoothTrack` rounded the bends, and where Erie's charted channel hugs the waterfront
that lane geometry crossed the seawall's land polygon in three places. NOTHING re-checked
the substitution** — the banner's safety claim described a route that no longer existed.
The raster, the exact test and the search all agreed the cells were blocked; the lane
pass simply never asked. (Ruled out on the way, each measured: extract radius — the 10 km
box covers the bay; enforcement toggles — land-off routes nearly DIRECT, not shore-hugging;
raster line-stamping — the walls were stamped.)

**THE FIX: `gateLegClear`, one gate inside `channelLaneRoute`** — no route leaves the
lane pipeline without passing the SAME `legClear` the search obeyed. A failing stretch is
re-routed by `legPath` and spliced (the lane survives everywhere it is lawful — at Erie
the 41-wpt lane became 44 wpts: the arc plus three small lawful detours, `lane:true`
kept); endpoint exemption within 2·buf of the route's own start/goal (a boat moored
inside the buffer is led OUT on its own first leg, same as routeAround's A-rule); a
spliced patch is legPath's own product and is NOT re-checked (the gate catches the
lane's inventions, not the search's — and re-checking an in-buffer patch end would loop);
if the law cannot patch, the pre-lane input ships and `abandoned` DEMOTES the lane fact
— the Rule 9 banner never claims a lane the gate threw away. Because the gate lives in
the producer, every lane consumer (goto, transit, routePlan, survey approach) inherits it.

`tests/buoy_lane.js` 14→20: the synthetic pier world reproduces the Erie class (check 15
proves the scenario has teeth by running the UN-gated pipeline), 4/4 mutations caught —
including the exemption drop, whose check took THREE forms to grow teeth: wp[0] survives
a splice, a length equality broke on clean code (mid-route splices are lawful), wp[1] is
the observable the exemption actually protects. Ops manual: the banner chapter now states
the lane-yields-to-the-law rule and the honest fallback.

## HOVER TIPS THE POINTER CANNOT OCCLUDE (2026-08-06)

Andy: every informational popup was partially hidden under the pointer. Those were the
console's 118 NATIVE `title` tooltips — drawn and positioned by the BROWSER, not the
page's to move — so the fix is ONE delegated layer (`#uiTip`) that takes over from
`[title]`: on hover the title is STASHED off the element (which is what suppresses the
native tip), and the text shows anchored to the ELEMENT — below its left edge with a
gap, flipped ABOVE when the bottom would clip, clamped to the viewport — so the
pointer, sitting on the control, can never sit on the tip. 400 ms delay to match native
pacing; hidden on mouseout / mousedown / blur; `pointer-events:none` and a 340 px wrap.

**THE RESTORE IS GUARDED, and this is the part a rewrite would lose:** FIVE readouts
rewrite their titles at runtime (nogo, AIS table rows, water trust ×2, mission speed).
On leave the stash is restored ONLY if the title is still absent — a value written
mid-hover wins. Measured live before the suite existed: stash, placement, no-overlap,
the bottom-edge flip (tip bottom 700 ≤ control top 708), restore, and the mid-hover
writer all verified in a browser. `#aisTip` stays separate on purpose — it is a canvas
pointer-follower over hit-tested vessels, not an attribute tip.

`tests/ui_tooltips.js` (9 assertions; tipPos driven PURE with the page's own constants
parsed out of the source; 5/5 mutations caught, each by exactly the check written for
it). Works identically in both split windows — one document-level delegation, no
per-element listeners to lose across the mirror's DOM replacement.

## THE SURV CARD'S RIGHT-EDGE LOCK — THE UICARD CLAMP (2026-08-06)

Andy: the survey card "does not properly resize and occasionally locks to the right side
of the browser window." **ONE bug, both symptoms, and it lived in the CONTROLS window:**
`wrapUICards` restored a saved layout VERBATIM — a position saved on a bigger window put
the card past the right edge, where the RESIZE HANDLE (far corner) leaves the screen
first and the grip follows. Reproduced live: seeded `left:2400px` in a 1280px window
restored at 2400, unreachable. **The chart pop-outs got exactly this fix in `2aef779`;
the controls window's parallel mechanism never did — the standing cost of a parallel
mechanism.** The chart window itself was verified healthy end to end (resize, persist,
restore, clamp) before touching anything.

**THE FIX is the chart treatment applied to uicards, all three properties kept:**
`clampUICard`/`placeUICard` (against the WINDOW — uicards are position:fixed) at
RESTORE, during DRAG (every move), and on window RESIZE re-derived from the STORED
layout (never the DOM — re-clamping the clamped ratchets). **Display-only via
`dataset.storedLeft/Top`: `saveUILayout` prefers the stored value while it stands, so a
beforeunload after a silent clamp cannot bake 1160 over a parked 2400; a DRAG deletes
the dataset — the operator's placement becomes the truth.** Verified live at every step:
restore 2400→1160 reachable; save still writes 2400; drag to 5000 holds at 1160 and
saves 1160; card resizes both axes with the panel following (300→283, 200→183 — the
delta is padding). `tests/ui_split.js` 17→22 (+ its first grab() extractor), **5/5
mutations caught, each by exactly the check written for it.**
**NOTE FOR ANCHOR-WRITERS: `static/asv.html` is CRLF** — the fourth file this trap has
bitten; `cat -A` under Git Bash masked it, `python newline=''` told the truth.

## RUN + LINK CONTROL: FIVE MORE ROUTES UNDER TEST (2026-08-04)

Andy's follow-on to the estop_chain audit: cover transit, pause, reset, connect and
disconnect — the five most consequential of the routes the audit had measured as
untested. **`tests/run_link_control.py` (21 assertions, drives a real console, 9/9
mutations caught, table in its docstring).** ONE console, ONE arc in mission order
(a boot is the expensive part and the routes genuinely interleave): transit under way →
pause mid-leg → resume → reset → disconnect → a REAL link to a dead host → sim reconnect.

**The contracts it pins down (read from the code, not assumed):**
- **PAUSE IS NOT STOP.** SOG to a standstill, `run="paused"`, and the plan AND
  `wp_index` preserved so start() resumes the SAME leg. The transit's first leg is
  deliberately ~245 m at high speed with a 30 m approach radius so the boat is on
  wp_index 1 BEFORE the pause — "resume did not restart the route" asserted at index 0
  proves nothing, and the injected restart bug was caught only because the index was real.
- **Reset is the sim power-cycle, and its identity change is load-bearing:** back at the
  vessel's spawn, SAFE/idle/no plan, energy refilled, home dropped then re-armed on the
  next fix, and a **NEW `boot_id`** — that is what tells the browser to drop the previous
  trail, so losing it would splice two boats' lives into one track. On a REAL link reset
  REFUSES with the honest simulator-only message.
- **The link lifecycle is a circle with honest edges:** disconnect leaves no zombie
  (commands refuse "not connected"); a fresh connect ALWAYS comes up SAFE with a new
  boot_id; a real link to a dead host reports unreachable and refuses commands with the
  Phase-0 message rather than hanging or faking.

**TWO HARNESS TRAPS, both now written into the suite and both general:**
- **A bodyless "POST" is a GET.** `urllib.request` with `data=None` sends GET, the
  command routes only dispatch on POST, and the response still LOOKS healthy — the
  suite's first run watched a "paused" boat sail on at 13.8 kn. Every command now goes
  through a `cmd()` wrapper that forces `{}`. If a harness commands a console and the
  command seems to change nothing, check the VERB before anything else.
- **After reset, the state carries the DEAD boat's last telemetry** until the fresh
  SimVcu's first frame lands — sampling straight after the POST read the old boat's
  position (248 m off spawn) and fuel (249.9 L) and attributed them to the new one.
  Same family as estop_chain's telemetry lag: wait for the new boot's first fix.

**The best catch was unplanned:** cutting `Engine.pause`'s `link.pause()` call broke the
pause checks AND check 11 — the real link's honest refusal travels through the same seam
(`link.pause()` is what reaches `RealVcu._blocked()`), so one cut loses two contracts.

Coverage arithmetic after this suite: of the audit's 20 untested routes, the five most
consequential are now covered; the remainder (`sethome`, `spawn`, `energy`, `chartinfo`,
the GET-side data routes…) are lower-consequence and still open — see OPEN / NEXT.

## THE km↔nm DISTANCE DISPLAY (2026-08-04)

The units selector Andy scoped and aborted on 2026-08-02 came back at his choice for this
session, and was built to the two decisions he had already recorded — nothing was
re-litigated: **LONG distances only** (line spacing, buffers, draft, DEPTHS and the LINES
table stay metric — 25 m of spacing is 0.0135 nm, unusable) and **one global toggle on the
top status bar** (the DIST pill — Andy's standing rule: global toggles live on the
persistent top bar, not on a card). Canonical is METRES
everywhere; the unit is applied at the DISPLAY EDGE like the feet on chart tiles and the
nm on the AIS card.

**The shape (static/asv.html):**
- `fmtDist(m, dp)` beside the state block near the top — **THE formatter for a long
  distance**. Under 1000 m prints metres IN BOTH MODES (that is the scope decision, not an
  accident); above, km with `dp` decimals or nm via `M_PER_NM`, whose single declaration
  MOVED here from the AIS section (one definition serves both display edges;
  `ais_range.py`'s regex still finds it). `fmtLenM` is GONE — fmtDist replaced it, and the
  old hand-rolled `(x/1000).toFixed(2)+" km"` sites (punchOut survey/approach,
  recalcCommittedForSpeed, the HOME→ pill, the tide-station distances) all call fmtDist
  now. `tests/units_toggle.js` check 9 fails if a hand-rolled km site creeps back.
- `applyDistUnit(u, save)` beside the battPill handler + a `storage` listener: ONE function
  whether the change is a click here or arrived from the OTHER window of the UI split
  (localStorage is shared; `storage` fires in the windows that didn't write). The listener
  passes `save=false` — adoption must not write back. Repaint rides EXISTING paths: the
  mission card / HOME range / water note redraw every state frame, and the survey/committed
  figures are owned by `recalcForSpeed()` — the SAME path a plan-speed change takes.
- **Startup sets the PILL TEXT ONLY, deliberately not applyDistUnit()** — its
  recalcForSpeed() walks plan state that later top-level script may not have initialized,
  and a `let` read before its declaration is a ReferenceError that kills the whole script
  (the showPanel lesson). Nothing unit-dependent has painted yet, so there is nothing to
  repaint.
- Preference: `lsGet/lsSet` under `asv_units_v1`; **default km** — an operator who never
  touches the pill sees exactly what they saw before.

**What deliberately does NOT follow the pill** (each asserted in the suite): short/metric
sites (check 11), chart-tile feet, and the AIS card, which reads nm ALWAYS by its own
earlier decision (check 12) — two display edges, deliberately independent.

**`tests/units_toggle.js` (12 checks, 7/7 mutations caught).** The check that matters most
is 3, straight from the AIS-range lesson: assert the nm VALUE both ways (1852 m = "1.00
nm"), because a field can be labelled nm while holding the km number — wrong by 1.852 with
a plausible number on screen. Check 10 runs the REAL `recalcCommittedForSpeed` under both
units. Live-verified in the browser on a moving boat: HOME→ read `996 m` at 13.76 kn
(short metric), then `0.54 nm` (= 1000 m exactly — the value converts), then `1.02 km`;
choice survives a reload; console clean.

**Suite-harness note:** `speed_recalc.js` now greps `fmtDist` and declares
`M_PER_NM`/`distUnit` beside its other page globals — a harness that extracts page
functions must track their new collaborators.

## THE E-STOP CHAIN HAS A TEST, AND THE HOOK DERIVES ITS SUITE LIST (2026-08-04)

Session "ASV console refinement 1", Andy's scope: expand usability AND make working
components stay stable version to version while adding capability. The stability half
started with a question none of the twenty suites had ever been asked: **what does the net
FAIL to cover?** Cross-referencing every `/api/*` route against `tests/` (excluding
`http_contract.py`, which names every route but only proves the handler contract) showed
20 of 33 routes with NO behavioural test — and among them `/api/cmd/estop`. The only two
mentions of `estop` in the whole test tree were a display prediction (`end_action.js` 8)
and a contract POST of `{"on": false}`. **The most safety-critical control in the console
had no test because it had never broken** — a net shaped by history, not by consequence.

**`tests/estop_chain.py` (17 assertions, drives a real console, in the hook).** Structure
and the reasons for it:
- **The vessel must be genuinely UNDER WAY first** (checks 3–4). Everything else asserts
  that motion stops; without real motion, a console that never moved at all passes.
- **The seam is asserted separately from the engine's flags** (5b vs 6/7/8). `/api/state`
  carries TWO `estop` fields — the engine's commanded latch at top level and the LINK's own
  reported one inside `status` — and they are different facts: what the console commanded
  vs what the vessel heard. Cutting `link.estop()` out of `Engine.set_estop` leaves every
  console-side flag looking right; only the telemetry shows the boat was never told.
- **Latch, refusals, release, re-arm** (9–12): release must leave the boat SAFE — clearing
  the latch must NOT re-arm or resume — and a deliberate re-arm must run again, because an
  E-STOP that cannot be cleared is a different bug from one that does not latch.
- **Telemetry lags the POST**: the engine's field updates synchronously, the link's lands
  on the next frame — sample-once assertions on `status.estop` flake; `wait_link_estop()`
  waits, same reasoning as `wait_stopped`.

**Mutations: 8 run, 6 caught alone, and the 2 survivors were then EARNED as layered
defence** (the roc_tracks technique — remove the pair together and the suite must fail):
the tick gate's `not self._estop` survives because `SimVcu.estop` also halts directly
(pair caught by 5/5b/10b/11); `Engine.set_estop`'s `run="idle"` survives because the
telemetry path re-derives it at line ~2745 (pair caught by 7). Full table in the suite's
docstring.

**AN UNREACHABLE-GUARD FINDING** (recorded in the docstring, don't re-derive): the
`_require(not self.estop, ...)` guards in `upload`, `start` and `_run_route` can NEVER
fire through the API — latching always force-disarms and `_require(self.armed, ...)` runs
first, so the operator always sees "ARM before …". They are defence in depth behind the
disarm; deliberately kept (they back a safety chain), but no test can provoke their
message, which is why check 10 asserts the refusal and not the wording.

**THE HOOK NO LONGER CARRIES A HAND-MAINTAINED SUITE LIST.** Fourth instance of the
"list beside a directory" drift, found while adding the suite: the hook's HEADER comment
documented seventeen suites while the run block ran twenty, and the run block itself
needed a hand edit per suite — so a suite written and not registered would never run in
anger. Both replaced: the loop globs `tests/*.js tests/*.py`, so **a new suite is run the
day it is written**; `gps_sim.py` added to the staged-path filter (it was missing).
README's test section had the same disease ("Six regression suites" heading thirteen
descriptions with eight suites absent) — rewritten to name the directory as the authority
and describe a sample. What stays hand-kept, deliberately: the per-suite failure ADVICE
in `advice_for()` — a missing advice line is cosmetic, a missing run was a hole.

## LINE-TIMING: sequence-keyed activation (2026-07-27)

The LINES-card actual-time accrual is now **sequence-keyed**: a coverage line
accrues time ONLY while the boat's current uploaded-route leg (the waypoint pair
it is between, from the live `wp_index`) IS that line — `currentLegLine()` matches
leg endpoints against committed line endpoints (either direction, 5 m tolerance).
Approach / detour / teardrop / inter-area legs match no line and can never
activate one; the old geometry checks (moving + aligned + XTE) remain only as a
secondary dropout within a line's own leg. The hover time-to-end tooltip gates on
the same `runLineIdx`. This fixes lines "activating" and banking time while the
boat merely transits across or parallel to them on its way to the survey start —
a twice-shipped bug in the sibling console; if it ever resurfaces, check the
sequence gate first and do NOT re-add a geometry-only guard. Harness-verified
(4 cases against the real page functions).

## CHANNEL LANE — the shipping Rule 9 behaviour (ported 2026-07-31)

**This is what runs.** The buoy-line section below is history: that colour design, and
the geometric quarter-width keep-right that replaced it on the sibling, BOTH rode the
wrong side of the buoys on the water. Ported here from the Z-Boat with the routing.

**The rule** (operator-specified from a marked-up chart of the Erie Harbor Channel):
outbound keeps the GREEN buoys to starboard, inbound keeps the RED to starboard, and
**both keep the channel CENTRELINE TO PORT**. One direction-based geometric rule —
ride a lane offset to **STARBOARD of the centreline, `LANE_FRAC` (0.5) of the local
half-width** out (= a quarter of the full width in from the edge). Colour is never an
input; it falls out of where IALA marks sit.

**Applies to EVERY mode**: Go-To, RTH, the drawn Transit, the survey approach leg, the
survey inter-line transits, search-pattern transits, and any routed obstacle detour.
Survey coverage lines and teardrop turns are never offset.

**Pipeline** (`channelLaneRoute` in `static/asv.html`):
1. `buoyChannelLane` — marked channels. `systemCenterline(sy)` pairs each port-hand
   buoy with its nearest starboard-hand buoy, takes midpoints ordered by number; each
   point carries `hw` (half the pair spacing). The system is chosen by the **longest
   stretch of the ROUTED PATH inside it**.
2. `narrowChannelLane` — the SAME rule with no buoys (basin exit, canal). Centreline
   from the water's own edges: `ctr=(RC−LC)/2`, `hw=(RC+LC)/2`. Fires only where BOTH
   edges answer within `CONFINE`. **This is where the ASV's `channel_reach_m` vessel
   override now lives** (it used to set `keepRight`/`channelEndExtend`'s wall-search
   REACH; both DELETED 2026-08-02): `CONFINE = max(120, channel_reach_m ?? buf*30)`.
3. `smoothTrack` — resample by ARC LENGTH at `STEP = max(45, buf*13)` (the waypoint
   count dial) + two light `[0.25,0.5,0.25]` passes to round the bends.

**Non-negotiable invariants — each one is a bug that actually shipped on the sibling:**
a lone buoy is NOT a wall (the edge march runs against a mark-free keep-out view);
SPLICE the lane into the routed path, never replace it; never emit an unverified leg
(abandon the lane instead); the full quarter-width is not always available (take the
largest offset that stays in clear water, then slew-limit); always SAMPLE a polyline,
never trust its vertex count; and measure the lane against the pre-shift samples, not
by marching perpendicular to the final route.

**DELETED 2026-08-02 — the divergence is closed.** `keepRight`, `channelEndExtend`,
`gateProject`, the colour system (`buoyageDir`, `buoyLaneAt`, `crossToLine`) and the
write-only `lastBuoyage` are **gone** (595 lines, 10 % of the page). They had been left
in place as a deliberate "lower risk" divergence after the port; the sibling deleted its
colour helpers outright and this now matches. Nothing referenced them but each other —
verified by a reference scan before and after, which also confirmed **no function was
newly orphaned** by the cut. `pairGates` SURVIVES: it is live for `channelSpanKeepouts`
(the buoy-gate fairway corridor), which is a different job from the retired gate
projection. **NOT implemented** (retired with them, unchanged): the channel end
extension and the buoy-gate projection.

> **SUPERSEDED 2026-08-10 — and this paragraph is why it took nine days to notice.** The
> channel end extension was not a colour-rule detail; it was the only implementation of the
> operator's "hold the lane until past the extent of the channel" clause, and deleting it
> left that clause with NO implementation at all while every suite stayed green. Measured
> on the regression suite's own channel before the fix: the offset was already decaying
> 50 m INSIDE the buoyage (24.3 of a wanted 25 at n=850), was **21.3 AT the final pair**,
> and **7.0 one channel width past it** where the deleted rule required it held. Restored
> as `extendCenterline` in `static/js/chart.js` — see "THE LANE'S ENDS" below. The
> buoy-gate projection stays retired: extending the CENTRELINE upstream of the lane
> subsumes it, and the lane machinery then holds the offset through the extension without
> knowing it is there.

Dead code is not free: it was still being read, still being maintained in comments, and
`tools/buoy_lane_test.js` had already been deleted for *testing* it and passing. The cut
was verified three ways — all 14 suites (177 assertions) green, both pages parse, and the
real page driven in a browser: `planNogoRoute` along the Lewes canal returned 26
waypoints with the lane engaged and no console errors.

**Test:** `node tests/buoy_lane.js` — 11 assertions (lane side + magnitude both
directions, opposing transits pass port-to-port, unmarked channel both ways, a lone
buoy is not a wall, open-water no-op, `systemCenterline` geometry). Verified on the
real Erie cache: outbound **99 % starboard at 0.50 of half-width**, inbound **98 % at
0.39** — matching the sibling. The old `tools/buoy_lane_test.js` was **deleted** with
this port: it exercised the dead colour keep-right and still printed "all checks
passed", which is worse than no test — it tells you to stop looking.

## MULTI-MONITOR UI SPLIT (ported 2026-07-31)

Two windows: **main** (chart + status + command bar) and **controls** (`?panel=controls`,
only the control column + its pop-out panels). Independent pages talking over a same-origin
**BroadcastChannel** (`asv_ui`). Main is the single source of truth — it owns the chart and
all logic; the controls window renders no app logic, mirrors main's control DOM, and
forwards gestures back so every existing handler still runs exactly once, on main.

- `UIROLE` from the query string; tabs self-title **ASV Chart** / **ASV Controls**.
- `UI_BRIDGED` = `.controls` + every pop-out this console has. No `#missionPanel` (it is a
  section of `#vcard`) and, since 2026-08-02, **no `#vcard` either** — see below.
  **`node tests/ui_split.js` now VERIFIES** that every bridged selector, every
  `UI_CARD_TITLES` key and every `#id` in the injected CSS resolves; that claim used to be a
  sentence somebody had checked once.
- **THE VESSEL-STATUS CARD LIVES ON THE CHART WINDOW ONLY (Andy, 2026-08-02).** It used to
  be bridged, so the SAME card rendered in BOTH windows — "VESSEL STATUS" on the chart and a
  "Vessel" uicard in the controls window with nine rows trimmed to stop it echoing the top
  bar. **Two copies of one card is not a second view, it is a second place to look.** Now:
  not bridged, not titled, and `body.ui-controls #vcard{display:none}` — hidden rather than
  removed, because the controls window is the same page under `?panel=controls`. It is
  deliberately NOT in the `ui-split` hide list; that would strip it from the chart too.
  **THE TOP STATUS BAR IS LEFT ALONE** — Andy likes it, and its nine-row overlap with the
  card is accepted rather than a defect. The old row-trimming CSS is retired with the mirror.

**RESIZABLE CARDS — ONE MECHANISM (2026-08-02).** Asked to make the vessel-status card
resizable, I built it a private resize: own CSS, own key, own save path — beside the
`.uicard` mechanism that already did exactly that in the controls window. **Andy asked
whether something was fundamentally different about that card. It was: I had made it a
special case.** Generalised to `.rsz` + `RESIZABLE_CARDS` + ONE key `asv_card_sizes_v1`,
mirroring `asv_ui_cards_v1`. All ten chart-window cards resize.
- **DISPLAY-AGNOSTIC ON PURPOSE.** Cards are shown by different paths, some as `block` and
  some as `flex`. A mechanism needing one of them would silently no-op on half, and the next
  card added would be a coin toss. So the CARD is the scroll container with a **sticky
  header** — the same shape as `.uicard-grip`. A nominated `.rszbody` gives up its OWN
  scrolling (`!important`, the caps are inline).
- **ONLY AN OPERATOR-CHANGED SIZE IS PERSISTED**, compared against the authored default
  captured at init. Several cards carry an inline width in the markup, so "has an inline
  size" stored the DEFAULT the moment a card opened — and a stored default overrides a
  changed default forever, which is the mission-buffer-vs-vessel-floor shape again. An
  earlier attempt inferred intent from gestures and marked cards nobody had touched: a
  mousedown while a card is HIDDEN measures 0×0, so any later reveal looked like a resize.
- **THE SAVE IS EVENT-DRIVEN, IN BOTH WINDOWS.** `ResizeObserver` is delivered with the
  rendering steps, and an occluded window has those suspended — **measured: in a hidden pane
  it does not fire at all, not even on attach.** Same trap that froze the split mirror under
  `requestAnimationFrame`. `mouseup` + `beforeunload` carry the guarantee; the observer is
  the extra. **The controls window had the identical gap** and now gets the same trigger.
- **The card is RESIZABLE** (same pass), and remembers its size next to its position.
  `resize:both` needs a non-visible overflow, and the card had to become a **flex column** so
  `.vbody` absorbs the dragged height instead of the rows spilling past the border — which is
  why `display` now toggles to `"flex"`, never `"block"`.
  **THE SAVE IS ON `mouseup`, NOT ONLY `ResizeObserver`.** An observer is RENDERING-driven,
  and an occluded window has its rendering steps suspended — **measured here: in a hidden
  pane the observer does not fire at all, not even on attach.** That is the same trap that
  froze the window-split mirror when it used `requestAnimationFrame`; the note in the split
  section says "use setTimeout, not rAF" and this is the same rule wearing a different name.
  The observer is kept as the extra that catches a non-mouse resize.
- Controls-window CSS hides the chart/status/command bar, pins the buttons as a left column,
  and wraps each panel in
  a draggable+resizable `.uicard` (layout persisted to `localStorage`, key
  `asv_ui_cards_v1`).
- **Main is only stripped while a controls peer is actually alive** (`body.ui-split`, driven
  by presence pings). With `--single-window`, or if the controls window closes/crashes,
  everything returns to main and a **⏏ Controls** pill appears to reopen it — the console is
  never left without its toolbar.
- Server opens the second window 1 s after the first (sidesteps the pop-up blocker);
  `--single-window` skips it.

## BUOY-LINE KEEP-RIGHT: full backport (2026-07-28) — HISTORY, superseded
> Superseded by the CHANNEL LANE above (2026-07-31). Everything below describes the
> retired colour design; `keepRight` and its helpers are dead code. Retained for the
> record and because several of its *mechanisms* encode real failure modes.

The keep-right is now the sibling's current **IALA-B buoy-line generation** (the
old wall-only version lagged behind while routing work continued on the branded
console). Added: `MARK_TAIL`/`markId`/`markSystems`/`crossToLine` (mark identity +
buoy lines), `buoyageDir`/`buoyLaneAt`/`lastBuoyage`/`buoyageNote` (direction of
travel + signed lane constraint). Replaced with the current generation:
`buildKeepouts` (marks carry `num`/`sys`; returns grouped `sys`), `keepRight`
(buoy-lane tier + wall tier + open-water approach alignment, fast occupancy grid,
curvature limit, clear-water envelope), `channelEndExtend` (grid-aware), and
`drawMarks` (draws the buoy lines). The ASV's `channel_reach_m` vessel override is
preserved inside the new `keepRight`/`channelEndExtend` (the sibling hardcodes
`buf*10`). Banners now report the buoyage reading. Same-day routing fixes carried
in the same code: escalating-region long-goto fix and stitch/knot pruning were
already ported (`ea5e92a`, `85dcf55`). Verified at the time by the since-deleted
`tools/buoy_lane_test.js`
(ported alongside, cache picker keyed to the Erie transit): all checks green —
INBOUND/OUTBOUND direction read, 100% right-side in the fairway, no hairpin at
the buoy gap, no nogo violation, confidence guard holds.

## CHART SOURCE CARD (`SRC`) — backported 2026-07-29

The ENC's answer to a paper chart's title block, ported from the sibling. Server
`fetch_chart_info()` → **`/api/chartinfo?bbox=`** reads two S-57 META layers on the same
band the routing extract used: `Coverage_area` (M_COVR — cell identity; `DSNM`'s 3rd
character is the usage band) and `Quality_of_Data_area` (M_QUAL — `CATZOC`, survey dates,
source) **with geometry**, so confidence can be reported per position. Client `#chartPanel`
shows cell / usage / units / datum / correction, then the zone of confidence **under the
vessel**, amber at ZOC C or worse.

**Deliberately a separate endpoint** — folding M_COVR/M_QUAL into `ENC_ROLES` would bloat
every routing keep-out cache and force a `features_v3` → `v4` bump, dumping every cached
extract for data no route consults. Caches to `charts/enc/chartinfo_v1_<bbox>.json`;
soft-fails per layer and honours the ENC circuit breaker.

**Divergences from the sibling:**
1. ~~No multi-window UI split here~~ — **RESOLVED 2026-07-31**: the split was ported, and
   `#chartPanel` is now registered in `UI_BRIDGED`, the `ui-split` hide-list and
   `UI_CARD_TITLES` like every other pop-out. (It keeps its own `chartPanelHead` drag for
   the main window; in the controls window the `.uicard` grip moves it — same combination
   the sibling runs.)
2. **The nogo floor is VESSEL-DERIVED** (`hull.draft_m + planning.under_keel_clearance_m`),
   so the units tooltip quotes the live `NOGO_MIN_DEPTH_M` instead of the sibling's fixed
   1 m. Keep it dynamic on future ports.

**UNITS — display ≠ data.** The rendered NOAA tiles print soundings in **FEET**; the ENC
vector data and everything this console computes/logs (nogo floor, corrected depths) are
**METRES**. Verified empirically (the chart service's metadata endpoint 500s and the tile
request carries no units parameter): US `Depth_Area` bands come out at exact foot contours
(1.8/3.6/5.4/7.3/9.1/18.2 m = 6/12/18/24/30/60 ft) while the chart prints numbers only
consistent with feet. The card says both out loud. **Don't "fix" it to say metres.**

**Live-verified over the DriX base (Lewes, DE):** 4 cells (`US5DE1DF/DG/EF/EG`), 13 quality
polygons — 7 × ZOC B and **6 × ZOC D**, the lowest confidence class. The spawn resolves to
`US5DE1EF`, ZOC B, source `US,US,reprt,L-297/15`. Harness-tested against that real payload.

**Client-code style rule inherited with the port:** the extract-page-functions harnesses
desync on a nested backtick inside `${…}` and on a regex literal containing a quote — this
card uses plain concatenation and `split('"').join()`.

## Run it

```bash
python asv_console.py --sim --browser none --port 8791          # headless, for testing
python asv_console.py --sim                                     # opens a browser tab
python asv_console.py --sim --vessel example_usv_4m             # study a different ASV
```

**Windows double-click: `start_sim.bat` at the repo root, and `tools/make_shortcut.ps1`
puts a shortcut to it on the desktop.** Both resolve the project from their OWN location —
the bat via `%~dp0`, the script via `$PSScriptRoot`'s parent — so nothing knows where the
project lives and a moved or freshly cloned copy needs no editing. Re-running the script
overwrites rather than duplicating. Three things worth knowing before changing it:

- **It verifies by reading the `.lnk` back** (target *and* working directory). `Save()`
  accepts a path that does not exist and only fails on double-click, so a save-and-trust
  version would report success for a broken shortcut.
- **The Desktop path is asked of Windows** via `GetFolderPath('Desktop')`, not assembled
  from `%USERPROFILE%`. This profile's desktop is redirected to `OneDrive\Desktop`, and the
  assembled path silently creates a folder nobody sees.
- **The `.lnk` is deliberately NOT tracked.** It is a binary carrying absolute paths for one
  machine, so a committed copy is wrong for every other clone. `tools/make_shortcut.ps1` +
  `tools/asv.ico` are what the repo carries, and they reproduce it anywhere.

This is the mirror of the fuel planner's `tools/make_shortcut.ps1`, which was itself
modelled on `start_sim.bat` — the launcher went that way, the shortcut builder came back,
and the two projects now behave identically at the point an operator touches them.

- Web UI at `http://localhost:<port>/`; playback at `/playback`.
- Commands: `POST /api/cmd/{arm,upload,start,pause,stop,estop,rth,goto,hold,sethome,transit,speed,approach,energy,reset,spawn}`.
  `speed` and `approach` are LIVE tuning — they apply to a run in progress.
- Vessels: `GET /api/vessel` (active + params + available list), `GET /api/vessels` (list), `POST /api/vessel {id}` (switch — only when disarmed & idle).
- State + telemetry stream over SSE at `/events`; snapshot at `/api/state` (live telemetry is nested under `status`).
- Session recorder writes `logs/*.jsonl` (disable with `--no-log`); playback reads them via `/api/logs`, `/api/log?file=`.
- `--acm <host>` (generic VCU host) + `--transport {tcp,serial}` for a real link; `RealVcu` opens the transport but **refuses to actuate** (no wire format implemented — honest 409, never a fabricated frame).
- **AIS layer (2026-07-25):** selectable **AIS** on/off overlay of nearby vessels + an openable/closable draggable **AIS traffic table** (range/bearing/speed, nearest-first). Data from a **separate stdlib script `ais_service.py`** the console proxies at `/api/ais` (`--ais URL`, default `http://127.0.0.1:8788`). **Area is lake-aware, decided server-side** from the boat centre via `_lake_of`/`GREAT_LAKES_BOXES`: whole lake on a Great Lake, else a 50 km box (response carries an `area` tag). Sources: **digitraffic** (keyless REST), **aisstream** (global WS, minimal stdlib WS client), **nmea** (RTL-SDR/AIS-catcher AIVDM; bundled stdlib AIVDM decoder verified vs canonical vectors). **Zero-config key:** `ais_key.txt` (gitignored) or `$AISSTREAM_KEY`; `--source auto` picks aisstream if a key exists else digitraffic; `--bbox` needs `=` for a leading minus. Feeds + key live in the service, never the browser. **The console AUTO-STARTS `ais_service.py`** as a child in `main()` (`_start_ais_service`, after `apply_vessel` so the spawn is current): scopes `--bbox` to the operating area (whole lake via `_lake_of`, else a box around `SPAWN_LAT/LON`), reuses an already-running one, and passes `--parent-pid` so the service watchdog reaps itself on console exit — robust to a hard kill. `--no-ais-service` opts out. Same generic `ais_service.py` in the Z-Boat console. MarineTraffic scraping ruled out (ToS); no keyless US source. **LIVE-VERIFIED on Lake Erie (Z-Boat, 2026-07-25):** aisstream + the stdlib WS client work against the real server; whole-lake path returned `area: Lake Erie` with ~56 real vessels (lakers/tankers/tour/USCG). Gotcha: ship TYPE lags (~6-min AIS static cycle) — `cat` is "unknown" until a static msg arrives, then classifies right. Client draw/table still want a real-browser eyeball.

## Architecture

- **`VcuLink` seam** with two implementations: `SimVcu` (full boat model — GPS
  fix, waypoint-following autonomy, battery drain, wind/wave environmental
  effects) and `RealVcu` (transport + honest protocol stubs).
- **`Engine`** owns authoritative C2 state (armed / e-stop / run / plan) and the
  arming gates. The console comes up SAFE and read-only; every actuating command
  requires an explicit ARM.
- **Safety model:** the RC transmitter is master; this console is additive and
  cannot touch the RC autonomy switch or E-stop. Link-loss is safe (stop
  commanding, surface the vehicle failsafe: motors 0 / steering straight; never
  auto-resume). Commands are validated/clamped before encode.

## Vessel configuration (the single source of truth for a modeled ASV)

Every vessel-specific parameter lives in one self-contained `vessels/<id>.json`
file — hull/windage, speeds, turn rate, guidance gains, an **energy model**,
planning defaults (incl. under-keel clearance), and spawn. The console studies ASV
behavior **across vessel types**: `--vessel <id>` picks the active profile at
startup, and the UI's vessel picker (or `POST /api/vessel`) switches live when
disarmed & idle (the sim respawns with the new physics).

**Energy model** — `power.type` is `"battery"` (voltage that sags with load; block
`battery_v` + `drain`) or `"fuel"` (diesel litres burned at ~`idle + (full-idle)·
(v/vmax)^exp`; block `fuel`). Battery vessels report V/%, fuel vessels report
fuel %/endurance/range. Validation branches on the type. The DriX is `fuel`.

**Vessel-aware nogo** — the nogo depth floor is `hull.draft_m +
planning.under_keel_clearance_m` (a deep-draft boat avoids more shallow water). The
client reads it via `/api/vessel` and **re-extracts** the nogo model on a switch.

**COLREGS Rule 9 keep-right — SUPERSEDED 2026-07-31 by the CHANNEL LANE (see the top
of this file); the description below is the retired colour design, now dead code.**
(IALA-B buoy-line generation, backported 2026-07-28) —
every transit offsets to the starboard side of a channel. The primary channel model
is the **buoy lines**: lateral marks (ENC `chan_mark` role = buoys + beacons, with
`CATLAM`) carry their channel identity in OBJNAM — `markId()` strips the designator
to get the SYSTEM name + buoy NUMBER, `markSystems()` groups and sorts each system's
port-hand and starboard-hand marks into two polylines (the red line and the green
line), and `buoyageDir()` correlates buoy number against along-track distance to
read the **direction of travel** (numbers rising = INBOUND, red kept to starboard;
falling = OUTBOUND, green to starboard; ambiguous/short hop = no claim). At each
path sample `buoyLaneAt()` gives a SIGNED offset to the line that must be kept to
starboard — so a path on the wrong side is pulled back **across** the line, which a
purely geometric wall search can never see. Where no buoyage answers, a wall-based
tier takes over (both channel walls within reach → lane 20% right of center), and
in open water an approach-alignment query (`buoyLaneAt` with an extended fairway
projection) lines the track up with an upcoming buoyed channel instead of a blind
bias. The reach is `planning.channel_reach_m` (optional vessel override; falls back
to `nogo_buffer_m*10`, the tight-marina scale — the DriX sets 120 m for the ~150 m
Lewes fairway). The offset never trades away obstacle clearance (fast occupancy
grid + exact check), a curvature limit keeps the result followable, and
`channelEndExtend()` stands the track straight on out of a channel mouth.
`pairGates()`/`gateProject()` still steer a Go-To/RTH through the outermost gate
centre and one gate-width past it. Marks are small keep-outs (don't hit a buoy) and
drawn green (port-hand) / red (starboard-hand) with their buoy lines; Go-To/RTH/
Transit banners report the reading ("buoy lane INBOUND (red to starboard)").
Regression harness: `node tests/buoy_lane.js` — **run it after ANY routing change**
(it exercises the real page functions against synthetic marked/unmarked channels).

- **Server:** `load_vessel()` reads + `validate_vessel()` checks a profile at
  load (missing/mistyped field → clear, path-pointed error; a bad file never runs
  with placeholder physics). `apply_vessel()` publishes the values to the module
  globals `SimVcu` reads (`SPEED_KN`, `MAX_TURN_RATE_DEG_S`, `BATT_*`/`DRAIN_*` or
  `FUEL_*`, `POWER_TYPE`, `MIN_NAV_DEPTH_M`, `WP_*`, `WIND_*`, `SPAWN_*`, etc.).
  **Do not reintroduce hardcoded vessel constants** — add/adjust the vessel file.
- **Client:** `loadVessel()` fetches `/api/vessel` and drives the JS mirrors
  (`SPEED_KN`, `MAX_TURN_RATE_DEG_S`, `NOGO_BUFFER_M`, `NOGO_MIN_DEPTH_M`,
  search-pattern sizes) and the energy gauge (BATT vs FUEL), so server and UI agree.
- **Adding a vessel:** drop a new `vessels/<id>.json` (copy an existing one; it
  must be complete — validation requires every field). `vessels/zboat_1800hs.json`
  models the small survey ASV; `vessels/drix08.json` models the Exail DriX H-8 (7.71 m diesel USV; see
  its `notes` for official-spec vs doc-derived vs estimated figures); `vessels/example_usv_4m.json`
  is a larger illustrative USV for comparison. A profile may name a real modeled
  vessel (it's data); keep the console *core* generic (no vendor protocol / manual figures).

## Behaviors (all ENC-aware, arm-gated)

Go-To, Return-to-Home, Hold/station-keep, Set-Home, Transit (multi-vertex),
Search patterns (expanding box / sector / parallel), and Survey (CAMP-style
boustrophedon with Punch-Out clipping to NOAA ENC features + arbitrary polygon
clip). Punch-Out also **excludes a navigation channel when the survey spans across
it** (`channelSpanKeepouts`): a coverage line that runs outside→into the channel
→outside gets a gap there. The channel is the ENC **dredged area** OR the
**buoy-gate fairway** — `pairGates()` pairs the lateral marks and sweeps each gate
line ±one gate-width into a corridor polygon (so a marked inlet with no dredged
polygon is covered too). It applies ONLY to the survey-line clip, not to the transit
routing — so normal transits still cross the channel, and a survey confined *within*
a channel (never out→in→out) is unaffected. Every commanded motion routes
clear of a startup-built **nogo model**
(shoreline + manmade features + water shallower than a 1 m corrected floor),
with COLREGS Rule-9 keep-right in channels. Real-time water-level datum
correction from NOAA CO-OPS; wind/wave sim from NOAA NDBC buoys.

**Survey operational awareness & editing:** (1) hovering the survey line the ASV is
currently on (running survey) shows a time-to-end-of-line tooltip (remaining dist /
live SOG); (2) WPT mode edits a punched plan before Upload — drag a waypoint (its
line endpoint follows), click a waypoint to delete, click a line to delete it (+ its
endpoints), click open water to add; (3) the **LINES** panel shows a per-line table
(length, planned time = length/speed, and ACTUAL time accrued while running — keyed
off the boat's active line, robust to Upload re-routing), written to the session log
as a `client:survey_lines` event on run end (`POST /api/logevent`).

Public data sources (kept): NOAA ENC / ENCDirect ArcGIS, NOAA CO-OPS water
levels, NOAA NDBC buoys, NOAA chart tiles. All cached under `charts/`
(gitignored, regenerated at runtime).

## WATER LEVEL EARNS ITS CONFIDENCE BY DISTANCE (2026-08-01)

Andy saw an **Erie water level at Lewes**. Not a fault: the console had started on the
Erie vessel, the card **named** its station, and `update_position` forces a refetch past a
3 km move — but CO-OPS polls ~every 6 min, so the previous station's value stands in the
gap and *looks exactly as authoritative as a local one*. He diagnosed it himself.

`waterTrust(wl)` now bands the reading by the **nearest contributing station**:
`local` ≤ 25 km · `far` > 25 km (ghosted + italic) · `remote` > 75 km (heavily ghosted,
warn colour, explicit "not the local tide"). **Graphical, not textual** — translucency
reads as low confidence at a glance, so the operator never has to inspect a station name
on a number that is usually fine. Manual overrides are never ghosted (the operator set
them); `!ok` is not a distance problem and keeps the existing `!` mark.
**NEAREST decides, not the average** — averaging would ghost a good local blend that has
one distant station in it, and would let two remote stations either side average into a
falsely "local" reading. Test `node tests/water_trust.js` (9 assertions, teeth-verified:
averaging → 6 fails, no manual exemption → 4, swapped thresholds → 2 and 8).

**THE OFFSET IS ALSO GATED (Andy's call, done same day).** `effectiveWaterOffset()` is
what actually corrects charted depths for the NOGO model. A `remote` reading is SHOWN
(ghosted, so the operator can see what the distant station says) but **NOT APPLIED** —
routing falls back to chart datum, exactly as it already does with no data at all.
Otherwise an 800 km tide of +1.16 m makes shallow water look 1.16 m deeper than it is:
the same failure mode as trusting a chart symbol without its size. `far` IS still applied
— indicative, not irrelevant, and the ghosting says so. A change in the effective offset
(including the gate flipping) invalidates `patClip`, since the punched survey was clipped
against the old one. The card and tooltip state that the level is not being applied, so a
`+1.16 m` on screen can't be mistaken for a depth correction that happened.
**RESIDUAL, shared with the pre-existing no-data path:** chart datum is the LOW-water
reference, so if the real local tide is BELOW datum, charted depths are optimistic. The
manual override exists for that; the manual exemption lives in `waterTrust()` and ONLY
there (a duplicate guard in `effectiveWaterOffset` was unreachable and was removed —
an unreachable guard is one nobody is testing).

## THE END ACTION — what the card says a run ENDS as (2026-08-01)

**Andy's report:** with End of Plan = RTH the boat *does* come home at the end of a Go-To,
a Transit or a Survey — the chain works — but until it fired, every readout said the run
would LOITER. "An RTH triggered at end of mission should SHOW as an RTH."

**Same shape as the completion bug above, one layer up.** `run_completion` is the literal
completion the LINK was uploaded with, and for a Go-To/Transit/Hold that really is
`loiter`. What happens NEXT is the client's chain, which the readouts knew nothing about.
Each field was accurate about itself and **wrong about the boat**.

**`endAction()` is the third value, and the ONLY one the cards show.** The run's own
completion, upgraded to `rth` when the chain will fire and downgraded `rth`→`loiter` when
it cannot. `rthPending()` holds the preconditions: a home, ARM, no E-STOP, the **live**
setting (not the frozen uploaded one), a run that actually HOLDS (`runHolds()` — repeat
laps forever, complete stops, neither can chain), and `!rthChainFailed` (doRTH refused →
retract the promise; set only for `doRTH({chained:true})`, since the button hands it a
click Event). **The link holds for both `loiter` and `rth`; only the chain makes it a
return home** — so the field never decides on its own.

**Found live while verifying it, and worth more than the display fix:** the chain's
one-shot `rthChained` was re-armed only on the idle→running edge. The console lets you
command a second Go-To while the first is still running, so `run` never leaves `running`
and that edge never fires — the second run inherited a **spent chain** and held at its
endpoint indefinitely. Invisible before; now the card would advertise a return home for
five minutes. `rearmRthChain()` re-arms on **UNDER WAY** (`running && !holding`), which is
either a new commanded run (has earned its own chain) or the chained RTH itself (excluded
by the `behavior!=="rth"` guard). Holding — including the seconds `doRTH` spends routing —
never re-arms, so the one-shot still does its job.

**Test:** `node tests/end_action.js` — 16 assertions over the real page functions.
Teeth-verified: drop `runHolds()` → 10,11; drop the `rth`→`loiter` fallback → 6,12; read
`run_completion` instead of the live setting → 1,2,12; drop `rthChainFailed` → 9; drop the
armed/estop guards → 7,8; drop `behavior!=="rth"` → 5; re-arm on every running frame → 15;
re-arm only on idle→running (the old behaviour) → 14. **Live-verified** on a scratch
console: a Go-To under RTH reads `Type GOTO / End mode RTH` from the start, the hold reads
"END OF PLAN — returning home (RTH)", and a second Go-To commanded mid-run chains its own
RTH (before the fix it sat holding for 5 min).

## SANITIZATION: THE SIBLING'S IDENTITY IS OUT OF THE CORE (2026-08-01)

Andy's call on the long-standing flag. **The line that was drawn, and the one to keep
drawing:** the SIBLING CONSOLE's identity must not appear anywhere in this repo's code —
that is the thing this derivative exists to be sanitized from. **A modeled vessel's name is
DATA and stays** (`vessels/*.json`), including `DEFAULT_VESSEL_ID = "drix08"`, which is a
data key the core cannot avoid naming.

Cleared (five in the core, comments/docstrings all): the CHANNEL LANE header and the dead
`keepRight` divergence note in `static/asv.html` → "the sibling console"; the port-number
note and the `connect()` docstring in `asv_console.py`; and the spawn-override comments in
both, which named which vessel spawns where — replaced with "each profile carries its own
operating area", which is also **more accurate**, since it does not go stale when a
profile's spawn moves.

**STANDING CHECK — this must return nothing:**
```
grep -rniE "z-?boat|teledyne" --include=*.py --include=*.html --include=*.js . | grep -v vessels/
```

**Two things found while sweeping, both fixed:**
- `tests/buoy_lane.js` cited `static/routing.js` and the sibling's page as the source it
  reads. **Neither exists here** — it reads `static/asv.html`. A ported comment sending the
  next reader after a file that was never in this repo. The rule it now states: *the source
  a harness names must be the source it actually reads.*
- `tests/turn_geometry.js` had `const ZBOAT` / `const DRIX` labelled `"4 m USV"` / `"8 m
  USV"`. Renamed to `SMALL` / `LARGE` — but the labels were also **factually wrong**: those
  are `zboat_1800hs`'s numbers and that vessel is **1.9 m LOA**, not 4 m (the real 4 m
  profile, `example_usv_4m`, has neither those speeds nor that turn rate). The same
  mislabel had propagated into CLAUDE.md's turn-geometry section and README.md; both
  corrected. Data untouched, so the 21 assertions are unchanged and still pass.

## AIS RANGE: COLLECT WIDE, FILTER NARROW (2026-08-02)

**Andy asked for a range control on the AIS card, and specified the design:** subscribe at
**150 km**, default the control to **50 km**, filter to the operator's selection inside the
app, and **do not apply it to lakes — all contacts in a lake are still displayed.**

**That is better than what I was about to build, and worth understanding why.** One radius
used to drive BOTH the service subscription and the display query, which is where the
documented invariant "they must move together" came from: widening only the query filtered
against vessels the service had never subscribed to, and silently showed nothing new. My
instinct was to honour the invariant by re-scoping the subscription on every change — which
means restarting the child process while the operator drags a number. **Collecting wide and
filtering narrow DELETES the invariant.** Every radius up to the collect width is already in
hand, so a change is instant, needs no restart, and cannot out-run the subscription.

- `AIS_COLLECT_RADIUS_KM` (150, boot-only, `--ais-collect-km`) — what the service SUBSCRIBES
  to. `AIS_SHOW_RADIUS_KM` (50, live, `--ais-radius-km`) — what the operator looks at.
  `AIS_SEA_RADIUS_KM` is **retired**; the old flag now means the display radius.
- **Filtered SERVER-SIDE in the `/api/ais` proxy**, so the chart overlay, the table and the
  count cannot disagree — one decision about what is displayed. Verified live: rows and
  overlay matched at 50 / 150 / 10 km.
- **A true great-circle CIRCLE, not the collect box** — a contact in the box corner is ~1.4×
  the radius out and must not sneak in.
- **`POST /api/ais/radius` clamps to the collected width.** Asking to see 900 km would show
  nothing extra while implying the sea beyond is empty. The control snaps back to 150.
- **NOT APPLIED ON A LAKE.** The area is the whole lake and every contact stands. The card
  disables the input and says *"whole lake — all contacts"* rather than sitting there looking
  broken — a control that silently does nothing is the failure this console keeps re-learning.
- The row reports **"3 of 6 in 150 km"**, so *nothing out there* is distinguishable from
  *I narrowed it down myself*.

**Test:** `python tests/ais_range.py` — 8 assertions against a STUB provider at known ranges,
because the subject is what the console does with an answer, not whether a real feed has
traffic near the test machine today. Teeth-verified: drop the filter → 3,4,5,8; filter a lake
→ 6; filter by box → 3,4,5,8; unclamped radius → 7. **A flake fixed in the stub itself:** it
first routed queries by substring-matching the path and mis-served the lake case, failing
check 6 for a reason unrelated to the console. It filters by BBOX now, like a real provider —
a different filter from the console's range circle, so it cannot mask what is under test.

## SPEED IS A LIVE COMMAND, NOT A PROPERTY OF THE LAST UPLOAD (2026-08-02)

**Andy's report:** speed over ground is not changing with user speed changes; these must be
real time, with application-wide awareness of the ASV state and how it affects the sim.

**He was right, and the previous commit had made it worse-looking.** `f382b85` made a speed
change recompute every planning figure on screen — turn geometry, durations, per-line times.
It did not make the boat go faster, because **`SimVcu._speed_key` was set in exactly one
place: `upload_plan()`.** There was no speed command anywhere in the stack — no seam method,
no Engine method, no endpoint. The selector recorded an intention nothing acted on.

**The tell was sitting next to it in the command bar:** `Appr m` has been a live command all
along (`/api/cmd/approach` → `set_approach`). Speed had the same shape and none of the
plumbing.

- `VcuLink.set_speed` on the seam; `SimVcu.set_speed` applies it live; **`RealVcu.set_speed`
  refuses honestly** like every other actuating call.
- `Engine.set_speed` validates against **the active vessel's own `SPEED_KN`** (so a profile
  with different speeds validates against its own), commands the link, **persists to the
  mission store** so a later Upload re-sends the operator's choice instead of reverting, and
  sets `note` — which is a SALIENT field, so the session recorder snapshots it for free.
- `/api/cmd/speed`.
- **State publishes `speed_key` + `speed_target_kn`**, and `speed_key` rides `TELEM_FIELDS`
  so a playback can put commanded speed beside speed made good. The MISSION block's new
  **Speed** row shows the BOAT's value and turns warn if it disagrees with the selector —
  because these are two values that were silently disagreeing for as long as the command
  went nowhere.

**Live-verified:** under way, SOG **4.11 → 13.94 → 7.06 → 4.08 kn** as the selector moved
low → high → survey → low. (Slightly over target is the environmental set — correct.)

**Test:** `python tests/live_speed.py` — 10 assertions, drives a REAL console, because the
failure spans a command, the link's internal state and the persisted mission. **It has to
let the boat ACCELERATE**: asserting the command was accepted proves nothing, since the old
code accepted the selector change too and dropped it. Teeth-verified: restore the bug → 6,7;
stop publishing `speed_key` → 1 (at the readiness gate); no validation → 4; skip the persist
→ 8.

**A FLAKE CAUGHT AND FIXED IN THE TEST ITSELF:** the first version waited only for the
console to ANSWER, then asserted on a status that had no telemetry in it yet — checks 3 and
4b failed once and passed on re-run. **A test that fails for the wrong reason discredits
every assertion around it.** Readiness now means answering AND the link reporting a frame.

## PLAN SPEED IS AN INPUT, NOT A LABEL (2026-08-02)

**Andy's report:** the speed selection is not monitored when a change of speed for a given
plan is suggested; speed and end-of-plan settings should initiate recalculation on user
input.

**The "suggested" part is what makes it sharp.** Punch Out ALREADY advises on speed — when
the spacing is inside `2 × minTurnRadiusM(speed)` it quotes the spacing a plain reversal
needs at the plan speed AND at low speed, precisely so the operator can choose between
widening the lines and slowing down. Acting on that advice changed **nothing**: `#c_speed`
saved the value and recomputed nothing at all. **Advice the console then ignores is worse
than no advice.**

- `recalcForSpeed()` — if a punched pattern is still drawn, re-run `punchOut()`: it OWNS
  the whole recalculation and its chart extract is cached, so it is cheap. Live proof it is
  real work: the same plan went **7 teardrops → 7 semicircles** and the routed length
  **0.63 → 0.44 → 1.27 km** across survey → low → high.
- `recalcCommittedForSpeed()` — a COMMITTED plan cannot be re-punched (anchors gone), so
  durations are recomputed from `mission.waypoints`, and the reversal feasibility is
  re-checked using `committedPatternInfo().spacing`. **Slowing down is always safe** (the
  radius shrinks); **speeding up can make a committed reversal untrackable and the plan
  looks identical on the chart** — so that case, and only that case, is reported.
- **Also called from `commitPattern()`**: `resetPattern()` blanked the duration rows at the
  moment the plan became real — the same fault as the survey card, one row over.
- **End of plan**: the note said "applies on the next Upload", which was **half true in the
  dangerous direction**. The SETTING is live the moment it is saved — the RTH chain gates on
  `s.completion` every frame — so switching to RTH mid-run arms a return the operator may
  not expect. What waits for Upload is the completion the LINK is given.

**TWO GAPS THE LIVE RUN FOUND, both fixed:** the durations blanked at `Add to plan` (above),
and **the warning did not clear** — slowing back down left it on screen claiming the plan
could not be flown at a speed it was no longer set to. `speedWarnShown` clears it, and only
if OUR banner is still the one showing, so an unrelated banner is not wiped.

**Test:** `node tests/speed_recalc.js` — 10 assertions. Teeth-verified: radius instead of
DIAMETER → 2,3,5b; warn on every change (cry-wolf) → 1,4,5,5b; never clear → 5b; fixed speed
for durations → 7; no recompute → 6,7,7b. **Live-verified:** committed at low → sped up to
high (duration recomputed, warning raised quoting 24.9 m vs 57.8 m) → slowed back (recomputed,
warning cleared).

**NOTE for anything using `flashNote()`:** `onState` overwrites `#note` with the vessel's own
note every frame, so a flashNote is visible for well under a second. Anything the operator
must actually read belongs in `showBanner()` or a panel hint.

## THE SURVEY CARD BLANKED ON A COMMITTED PLAN (2026-08-02)

**Andy's report:** the survey card's information goes blank after uploading the plan; keep
the inputs until the user clears or resets. The blanking is actually at **`Add to plan`**,
one step earlier — `addPatternToPlan()` ends with `resetPattern()`, which drops the three
anchors, and **every figure on the card was derived from those anchors alone**. Spacing,
direction, line length, width and count all went at exactly the moment the operator most
wanted to check them: immediately before Upload. The plan was still there; the chart still
drew it. Only the card forgot.

**`committedPatternInfo()` DERIVES the figures from `mission.lines` — it does not remember
them.** A remembered snapshot is one more value that can drift from the plan, which is the
bug shape this repo has paid for most often. Deriving cannot disagree with the plan,
survives a page refresh for free (the mission persists server-side), and correctly follows
a plan edited in WPT mode — the card then describes what the plan IS, not what was typed.

- **SELF-VALIDATING, not `planKind`-gated.** `planKind` is NOT persisted and resets to
  `"survey"` on refresh, so gating on it would have described a committed SEARCH as a
  survey with meaningless spacing. Instead the lines must actually BE parallel (~2°).
  Expanding-box and sector searches get no figures; parallel-track lanes do, and correctly.
- **`width` is the measured across-plan extent**, not `spacing × (n−1)`, so an unevenly
  edited plan is described truthfully. `legLength` is the LONGEST line, not the first — a
  clipped plan has short end lines.
- **DIRECTION MUST MATCH THE TYPED CONVENTION.** A boustrophedon alternates end for end, so
  line 0's raw bearing is only defined modulo 180 — reading it raw returned the RECIPROCAL
  about half the time (caught live: typed 327, card read 147). `surveyPattern` derives
  direction as `across-bearing − 90`; this derives it the same way from the across-plan
  offset. A single-line plan has no across direction and falls back to its own bearing.
- `loadMission()` now calls `updatePatReadout()` — without it a committed plan read blank
  after every page refresh, since nothing else repaints the card on load.

**Clearing:** `CLR PLAN` empties `mission.lines`, so the card blanks with it. The SURV
`Reset` discards only the pattern being DRAWN — the card then reverts to describing the
committed plan, which is still in the mission and still on the chart. That is deliberate.

**Test:** `node tests/survey_card.js` — 11 assertions. Teeth-verified: restore the blanking
→ 1 (loudly); drop the parallel test → 8; first line's length instead of the longest → 5;
width as `spacing × (n−1)` → 7; gate on `planKind` again → 9. **Live-verified** end to end:
drawn → Add to plan → Upload → page refresh all hold 34.7 m / 029° / 188 m / 21 lines, and
CLR PLAN blanks it.

**Known cosmetic difference:** the drawn `width` is the pattern's nominal box width and the
committed one is the measured line-to-line extent, so they differ by the alignment margin
(seen live: 698 → 693 m). The measured figure is the more truthful of the two.

## THE SURVEY MOVE GRIP WAS DRAWN, LIVE, AND INVISIBLE (2026-08-01)

**Andy's report:** the SURV whole-pattern move handle "is not there — find it in zboat and
apply it here". **It had already been ported, completely.** `patMoveLL` / `patMoveScreen` /
the `"M"` branch of `patHandleAt` / `patMoveLast` / the translate-every-anchor drag are all
byte-identical to the sibling, and `drawPattern` diffs identical too. Measured on the
running page: the hit test returned `"M"` at the midpoint and a drag moved the pattern
rigidly with spacing/direction/width/count preserved exactly.

**So why "not there"? It was drawn INSIDE `drawPattern()`, which `render()` calls early —
and `render()` paints the boat marker near the END.** The grip sits at the A-B midpoint, and
the operator's normal move is to drive to the survey area and draw the box **around the
boat**. A 6 px grip under a 6 px boat disc plus its 26 px heading line is simply not there.
Measured: **ZERO grip-coloured pixels when the midpoint landed on the boat, 70 when it did
not.** Live, draggable, and invisible in the commonest case there is.

- `drawPatMoveGrip()` split out and called **last in `render()`**, just before
  `drawViolation`. Dark halo ring + outlined "move" label so it reads against the boat and
  the coverage lines. Worst case (grip exactly on the boat) went 0 → 24 amber px.
- **The real port gap was the HINT.** The sibling's `#sp_hint` names the grip in both
  variants; this port's copied the strings without the mention, so nothing on screen ever
  told the operator the handle existed. Ported verbatim.
- The hit-test tie-break is unchanged and load-bearing: **corners win**, so reshape stays
  reachable on a small pattern where the grip sits near a corner.

**DIVERGENCE FROM THE Z-BOAT, and it is now the only one in this feature.** The sibling
still draws its grip inside `drawPattern()` and has the same burial — it was never noticed
there. **A future re-port of the survey code from the sibling would silently undo this**;
`tests/pattern_move_grip.js` check 5 is what will catch that. The hint strings, by contrast,
now MATCH the sibling — that half was a plain port gap, not a divergence.

**The lesson, and it is the READOUT COROLLARY again in a different costume:** "the code is
ported" and "the operator can use it" are different claims. The diff was clean, the logic
was right, and the feature was still missing. **Verify a UI port by looking at the pixels,
not the diff** — the canvas sample is what found this in about a minute.

**Test:** `node tests/pattern_move_grip.js` — 7 assertions. 5 and 6 are deliberately
**source-order** assertions (canvas z-order is not observable without a full render
harness): the grip must NOT be drawn inside `drawPattern`, and `render()` must call
`drawPatMoveGrip()` after the boat marker (anchored on `getCSS("--asv")`). Teeth-verified:
grip back inside `drawPattern` → 5; no post-boat draw → 6; drop either hint mention → 7;
wrong anchor pair → 1,2; grip wins a tie → 4; 60 px hit radius → 3.

## THE NOGO ROW WAS STUCK ON "loading…" (2026-08-01)

**Andy's report:** "the nogo entry in both cards always shows ...loading". It did — and it
was a **repaint bug wearing a vague word**, not a wording problem.

`refreshNogo()`'s success path ended `rebuildNogo(); nogo.busy=false;` — and `rebuildNogo()`
finishes by calling `updateNogoUI()`. So the row was painted **while `busy` was still true**,
printed "loading…", and then nothing ever repainted it. **The one path that ends in a working
model was the one path that never showed it.** Every behaviour routed correctly off a model
the card insisted was still loading — the worst kind of stale readout: it reports NOT READY
about something that is. Fix: clear `busy` **before** `rebuildNogo()`.

**Then the wording, which was the real ask.** `nogoReadout()` names the STATE — the same
lesson the AIS table already learned about its link status. Four states, and the pair that
matters: **"clear water" and "no chart" both look like zero keep-outs and are opposite
facts** — one is open water, the other means nothing was checked and every route is direct
and unverified. `nogo.band` (set only by a SUCCESSFUL extract) is what tells them apart;
`nogo.ready` cannot, because it is false in both.

- reading → `reading chart… 6 s`, **counting seconds** so a hung chart service does not look
  like a slow first fetch. Ticked from `tickClock()` while `busy`.
- read → `334 zones · floor 2.3 m` (the floor is **vessel-derived**, so the operator sees
  what "shallow" means for the boat they are driving), tooltip broken down by the keep-outs'
  **own `kind` strings** — it can never invent a category the model does not have.
- clear water → `clear — none charted`, normal colour.
- no chart / failed → the reason, truncated in the row and whole in the tooltip, warn colour,
  and the tooltip says routes will go DIRECT. The `catch` now sets `nogo.note` instead of
  leaving the previous one standing.

**NO NEW STATE FIELD** — every state derives from `busy` / `nogo.band` / `nogo.note` / the
counts, so nothing can drift out of step with the model behaviours actually route against.
(Only `nogo.since`, a timestamp for the elapsed display.)

**Test:** `node tests/nogo_readout.js` — 15 assertions. 10–14 drive the **real**
`refreshNogo` → `rebuildNogo` → `updateNogoUI` with only the leaves stubbed (chart fetch,
keep-out builder, banner, DOM) and record every paint, because wording assertions alone
would never have caught a statement-ordering bug. Teeth-verified: **restore the original
order → 10,11 fail**; key off `nogo.ready` → 4,6; drop the busy branch → 1,2,12; drop the
elapsed counter → 2; fold no-chart into clear-water → 5,13,14; drop the article strip → 7;
untruncated note → 6; no note on the throw path → 14. Live at Lewes: `334 zones · floor
2.3 m`, tooltip `126 × dock / pier, 93 × shoreline, 57 × charted hazard, 37 × water
shallower than 2.3 m, 16 × land, 5 × channel buoy`.

**Two harness traps this suite hit, both worth remembering:**
1. `grab()` matches `"function NAME("` and **silently drops an `async` prefix** — the torn
   body was a SyntaxError (loud, luckily). It now grabs the modifier too.
2. A **stray top-level `process.exit()`** after the async IIFE ended the process at exit 0
   after check 9, silently skipping five checks. The summary now prints the number of
   checks that RAN.

## MISSION CARD MERGED INTO THE VESSEL-STATUS CARD (2026-08-01)

Andy's call, same pass. The operator was reading the boat on one card and its run on
another. `#missionPanel` is gone; its rows live in `#vcard` as `#v_mission`, a `.vsec`
shown only while there is a run to describe (`updateMissionCard()` now targets it).

- **The old `Run mode` row (`#v_mode`) is DELETED, not moved** — it was `behaviour ·
  completion`, which is exactly the block's `Type` + `End mode`. Merging means removing
  the duplicate, not carrying it.
- `#v_wpt` moved INTO the block (so the controls window's "drop what the top bar already
  shows" rule still hides it) and gained the old `mi_wpts` pre-upload fallback, as
  "N planned". `#mi_wpts` is gone.
- Removed with the panel: its drag/persist block (the orphaned `asv_missionpanel_pos_v1`
  key is left in localStorage), and its entries in `UI_BRIDGED`, `UI_CARD_TITLES` and the
  `ui-split` hide list. **The stale comment claiming this console has no Mission card is
  now true again.**
- `.vbody` gained `max-height:calc(100vh - 170px); overflow-y:auto` — the block pushed the
  card past a laptop viewport with a run up.
- Verified live in BOTH windows: main renders the merged card; the controls window shows
  one `.uicard` "Vessel" carrying the mission rows and no stale Mission card.

## END-OF-PLAN SETTING vs RUN COMPLETION — one field per concept (2026-08-01)

**Bug Andy hit (and had hit before):** End of Plan **RTH** selected, console acting on
**loiter**. Confirmed live — the mission store said `rth`, `/api/state` said `loiter`.

**Root cause: a CONFLATED FIELD.** `Engine.completion` was doing two unrelated jobs —
the operator's persistent END-OF-PLAN SETTING (owned by the mission store, decides what
happens when a survey/search PLAN finishes) *and* the completion of the RUN CURRENTLY IN
PROGRESS. Go-To / RTH / Hold / Transit all correctly station-keep at their own endpoint,
so `_run_route()` set the field to `"loiter"` — **and thereby overwrote the setting with
it.** Nothing restored it until the next `start()` re-read the mission. The command bar
still SHOWED RTH, the RUN MODE pill read `goto · loiter`, and the client's end-of-plan
RTH chain (which gates on that value) was silently disarmed in between.

**The robust fix is structural, not a patch — one field per concept:**
- `plan_completion()` — THE SETTING. Cached in `_PLAN_COMPLETION`, refreshed by
  `_cache_plan_completion()`, which **every** mission read and write funnels through, so
  the cache cannot drift from disk and the 4 Hz telemetry loop never touches the file.
  **No Engine method writes it** — that is the invariant that kills the whole bug class.
- `Engine.run_completion` — what the run in progress does at ITS end. `_run_route` sets
  `loiter` (correct for a Go-To); `start()` sets it from `plan_completion()`.
- **Both** are published: `completion` (setting) and `run_completion` (this run). Client:
  the command-bar selector and the RTH chain read `s.completion`; the cards read
  **`endAction()`**, which is built on `runCompletion()` — see the END ACTION section
  above; the RUN MODE row that read `runCompletion()` directly is gone.
  `syncCompletionSel()` mirrors the server's setting back into the selector (skipped
  while focused), so the two **cannot drift unnoticed**.

**Test:** `python tests/completion_modes.py` — 10 assertions, ~5 s, drives a REAL console
over the API because the failure was an interaction between a command and persisted
state, which a unit test of either half alone would have missed. In the pre-commit hook.
Teeth-verified: publishing `run_completion` as `completion` → 3,7,8,9 fail; `_run_route`
writing the setting (the exact old code) → 3,7; `start()` ignoring the setting → 10;
breaking the cache refresh → 8.

**Note on check 10:** the first version of this test passed all its mutations except
`start()` ignoring the setting, because it never STARTED a plan — the setting would have
been perfectly preserved and then never used. Preserving a setting and *honouring* it are
two assertions, and a test needs both. (The same pass also caught a flake in the test
itself: it assumed a position fix instead of waiting for one, so it failed on the wrong
check. A test that fails for the wrong reason discredits every assertion around it.)

## CHARTED POINT HAZARDS HAVE AN EXTENT (2026-08-01)

**Bug Andy hit:** a live Go-To out of Lewes planned straight over a charted wreck. The
wreck was fetched (`Wreck_point` → `hazard_point`), classified and enforced (`enf.haz`
defaults **true**) — the ENC side was fine. The failure was that `blocked()` gave EVERY
point keep-out a radius of exactly the nogo buffer, so a **wrecked ship, a mooring pile
and a channel buoy were the same object to the router**. At the 3 m buffer in the
report, a charted wreck was a 3 m obstacle: a route only had to miss the charted
position by 3 m to validate clear. **The buffer is a CLEARANCE MARGIN and was being
asked to double as the OBJECT'S EXTENT.** It cannot do both.

**Fix, three parts:**
- `hazExtent(f)` gives an intrinsic radius to hazards whose extent the chart does not
  give — `HAZ_UNKNOWN_EXTENT` = Wreck / Hulk / Obstruction / Underwater-Awash-Rock
  points. `WRECK_RADIUS_M` defaults **50 m**, vessel-configurable via
  `planning.wreck_radius_m`. The buffer is then added ON TOP as the margin. Piles,
  buoys and beacons keep extent 0 — the fix must not inflate every mark on the chart.
- **VALSOU is now used.** It was fetched in `ENC_KEEP_PROPS` and thrown away. A wreck
  with a charted sounding that clears `NOGO_MIN_DEPTH_M + WRECK_CLEAR_MARGIN_M`
  (tide-corrected by `waterOffset`, same as depth areas) collapses back to a point.
  **No VALSOU means UNKNOWN, and unknown takes the full berth** — not the reverse.
- `bufferFloor()`: the vessel's `planning.nogo_buffer_m` is a FLOOR. `loadMission` was
  doing `nogo.buffer = mission.buffer_m ?? 10`, so a plan saved against a small boat
  silently gave the DriX 3 m where its own file demands 5. Same vessel-staleness class
  as the ROC standoff. The operator can still widen it beyond the floor by hand.

**BOTH clearance paths had to learn it.** `blocked`/`blockedInfo` is the exact check;
`rasterKeepouts` is the A* occupancy grid, and it stamped each point into a SINGLE CELL
before the uniform buffer dilation. Fixing only the exact check would make the search
plan through the wreck and the leg then simply fail — no detour. The raster now stamps a
disc of `pt.r` first. Sized hazards also DRAW their circle (dashed red), so the operator
can see why a route swings wide instead of reading a bare cross as the whole danger.

**Verified against the REAL cached Lewes ENC** (6,210 features, 38 `Wreck_point`
records → 7 distinct wrecks): 5 have no VALSOU → 50 m extent → a leg 10 m abeam is now
REFUSED where it was clear; 2 carry VALSOU 4.5 m and 3.6 m → extent 0 → still passable
for the DriX's 2.3 m floor, which is correct. 161 of 448 point keep-outs are now sized.
**NOTE:** the wreck in Andy's screenshot may well be one of the VALSOU pair, which the
fix deliberately still allows — a wreck with 3.6 m over it is passable for a 2.0 m draft.

**Test:** `node tests/wreck_clearance.js` — 12 assertions, in the pre-commit hook.
Teeth-verified by mutation: bare-buffer radius → 4,5,6,12 fail; single-cell raster stamp
→ 9; no VALSOU branch → 2,10; extent on every class → 1,8; no `bufferFloor` → 11.

## SURVEY TURN GEOMETRY — radius decoupled from line spacing (2026-07-31)

`teardropTurn()` in `static\asv.html` builds every line-to-line reversal. **Two
shapes, one contract**: end on the next line aligned with its heading, at a radius
the boat can HOLD at the plan speed (`minTurnRadiusM` = `1.4 × v/ω` from the vessel
file's `max_turn_rate_deg_s`), nogo-validated before return.

- **Semicircle** — line offset ≥ `2×minR`. One 180° arc at *half the offset*,
  bulging outboard; reaches exactly `R` past the line ends. Unchanged behaviour.
- **Teardrop** — line offset < `2×minR`. Three tangent circles **at `minR`**: a short
  arc away from the next line, a >180° loop over the top, a short arc onto the line.
  In a frame with the entry at the origin, `+y` = exit heading, `+x` = towards the
  next line, offset `d`: `C1=(-R,0)`, `C3=(d+R,0)`, `C2=(d/2, √(4R² − ((d+2R)/2)²))`,
  tangent points at the centre midpoints. Solvable exactly when `d ≤ 2R` — precisely
  the case the semicircle can't serve — and it degenerates into the semicircle at
  `d = 2R`, so the two families agree on their shared boundary. Along-track offset
  between the line ends (clipped lines of unequal length) is absorbed by a straight
  run collinear with a survey line.

**WHY this exists.** The old code had only the semicircle, so a boat whose minimum
radius exceeded half the spacing got **no turn at all** and fell back to a "straight"
hop between anti-parallel line ends — which is a 180° reversal at half the spacing,
i.e. the exact radius just rejected as unflyable, only now unmodelled. Coupling the
turn radius to the line spacing meant a big boat on tight lines could never get a
turn: **the 7.71 m USV needs 14.4 m of radius at its 7 kn survey speed (28.9 m of
spacing) where the 1.9 m ASV needs 2.1 m (4.1 m)**, so ordinary small-boat line spacing
silently produced no teardrops at all. That symptom is what prompted the rework.

**Cost, and what the operator is told.** A teardrop reaches up to ~`2.75×minR` past
the line ends (vs `R` for the semicircle), so `punchOut()` reports the actual
excursion, the spacing a semicircle would need at the plan speed, and the spacing
needed at low speed. If even the teardrop hits a keep-out the reversal falls back to a
straight hop and the banner calls it **untrackable**, not merely routed — that is a
plan defect to act on, not a working turn. `turnMargin` (`spacing/2`) was deliberately
**left alone**: raising it to suit the teardrop would trade coverage off every line,
which is the operator's call, not a silent default.

**Known modelling limit (unchanged, but now load-bearing):** the sim caps yaw RATE,
not radius, so `minR` grows linearly with speed. Real hulls hold a roughly constant
minimum radius — Exail publishes ~8 m for the DriX H-8 at 14 kn, where the 20°/s cap
implies 20.6 m. The cap is calibrated at survey speed (10.3 m physical vs the spec's
~8–10 m), so it is right where surveys are planned and pessimistic at high speed.

**Test:** `node tests/turn_geometry.js` — 21 assertions over the real page functions
for both shipped vessels (shape selection, radius, curvature floor along the whole
path, exit alignment, turn-away direction, outboard excursion, the `d = 2R` boundary,
nogo refusal *and* its clear-water twin, along-track absorption, skew refusal, speed
as the operator's lever). **Run it after ANY change to the turn geometry.** Verified
with teeth: restoring the old clamp fails 3 checks, building the teardrop at half the
offset fails 6, reversing the middle sweep fails 4, dropping the nogo sweep fails 1.

## Testing notes

- Headless: `python asv_console.py --sim --browser none --port 8791`, then drive
  via the `/api/cmd/*` endpoints and read `/api/state` / `/events`.
- Geometry/routing regressions run offline against `static\asv.html` with plain
  Node (no deps, no server): `node tests/turn_geometry.js`, `node tests/buoy_lane.js`.
  **A pre-commit hook runs BOTH** when `static\asv.html` or either test is staged
  (`.githooks/pre-commit`, ported from the sibling 2026-07-31; enable per clone with
  `git config core.hooksPath .githooks`, bypass with `--no-verify`). `.gitattributes`
  pins `.githooks/**` to LF — a CRLF shebang breaks the interpreter on checkout.
- The map page canvas animates continuously — **browser-pane screenshots time
  out**; verify via DOM/`read_page` or the state endpoints instead.
- **CANVAS PIXEL SAMPLING is the way to check anything DRAWN** (found 2026-08-01, and it
  found the buried move grip). `canvas.getContext("2d").getImageData(x, y, w, h)` over a
  small box at a known screen point, then count pixels matching the feature's own colour —
  one `javascript_tool` call, no screenshot, immune to the animation. Two traps: the boat
  is drawn at the same place as several handles, so **place synthetic geometry AWAY from
  the boat** unless burial is what you are testing (an accidental overlap is what made the
  grip look broken, then proved it was); and `javascript_tool` caps at ~30 s, so long waits
  belong in a `setInterval` sampler read back by a later call — but note a **hidden browser
  pane throttles timers to ~1/min**, so trust the outcome, not the sample density.
- Windows/store-Python gotcha: a stray server process can hold the port and serve
  stale code. Check `netstat -ano | grep :<port>` and `taskkill //F //PID <n>`
  before retesting server changes.

## ROC + MOVING HOME (ported from the sibling 2026-08-01)

`roc_tracks.py` — Remote Operations Center tracking, GPS ingest, and a HOME that can
MOVE. Self-contained: it owns all ROC state and imports NOTHING from the console (the
console injects the boat-fix getter). Wired in at four points in `asv_console.py`:
`ROC = roc_tracks.RocTracker(...)` global · `GET/POST /api/roc` · `ENGINE.set_home_provider(
ROC.home_intent)` in `main()` · the Engine tick, which resolves HOME every telemetry
frame and runs the moving-HOME chase.

**Shore vs ship.** A shore ROC is a fixed antenna whose ARRIVAL POINT is offset by an
operator-entered range/bearing (the ramp). A ship (mothership) ROC moves, and its offset
is normally `relative` — measured from the ship's COURSE, so "50 m astern" stays astern
as she turns. `PLACE → EDIT → CONFIRM`: staged ROCs are editable and **cannot be HOME**;
confirming activates (and starts a ship steaming). Hold reverts to staged.

**The chase.** While an RTH follows a ROC, the run loop re-aims the boat at the current
arrival point, re-issuing a single-waypoint plan only once it has drifted past ~half the
arrival radius — reusing the link's own waypoint-follow, no separate pursuit controller.
A ROC home is driven DIRECT, not ENC-routed: a detour to a moving point is stale on
arrival. Any command leaving RTH/running clears the chase.

**VESSEL-DERIVED — the divergence from the sibling.** The sibling hardcodes a 50 m astern
standoff and has no closing check. Neither survives contact with this console's vessel
system, so both are re-derived in `apply_vessel()` via `roc_tracks.configure_vessel(v)`:
- `SHIP_RECOVERY_M` = `planning.roc.ship_recovery_m` if declared, else `max(20, 6×LOA)`.
  1.9 m boat → 20 m, 7.71 m → 46.3 m. Existing ROCs keep operator-entered offsets; only
  the default for NEW ships moves.
- `ASV_MAX_SPEED_KN` = `propulsion.speeds_kn.high`, backing `Roc.closing_kn()`/`closable()`.
  RTH to a moving mothership only converges with a real overtake margin; below
  `CLOSE_MARGIN_KN` the card, `home_intent` and the RTH note all say it is unreachable.
**This is the `HULL_A_LAT` staleness trap** — an import-time-only derived constant goes
stale on a live vessel switch. Verified live: DriX→small boat moved the new-ship default
46.3→20 m and re-based the closing check 14→6 kn.

`gps_sim.py` — NMEA-0183 emitter (RMC/GGA, XOR checksums, TCP server or UDP), the "real
GPS feed" stand-in. The tracker can spawn one per ROC (`--parent-pid` reaped). Ingest
verifies the checksum and rejects a void fix: a GPS feed is untrusted input.

**Test:** `python tests/roc_tracks.py` — 17 assertions, teeth-verified (drop the relative
branch → 4 fails; let a staged ROC be HOME → 6 fails; hardcode the standoff → 9 fails;
skip `configure_vessel` → 11 fails; skip the checksum → 14 fails). Run by the pre-commit
hook. Also ported in the same pass: the **Mission card** (then `#missionPanel`, one readout
for every commanded run; **merged into the vessel-status card later the same day** — see
that section) and the **SURV whole-pattern MOVE GRIP** (`patDrag==="M"` — crosshair
at the A-B centre translates all CAMP anchors by one delta; corner handles win hit-test
ties — **but it was buried under the boat marker and unmentioned in the hint until
2026-08-01; see that section**). **NOT ported, by decision:** the sonar/payload subsystem — it hardcodes a specific
two-sonar fit and would need a vessel-declared `payloads` block first, and the single-beam
echosounder console is built from vendor manual citations and proprietary telegrams that
this console's sanitization rules forbid.

## Keep docs current

**THE START HERE HANDOFF IS REFRESHED IN THE SAME COMMIT AS THE WORK — Andy's standing
instruction (2026-08-02). Not as a follow-up commit.** Five separate "refresh the handoff"
commits were made in one session, and **each one immediately falsified its own `HEAD` line**,
because the refresh moved the tip it had just named. Folding it in ends that: the handoff
lands with the change it describes, and there is no trailing docs commit to invalidate it.

**Which is why the "Repo" line no longer quotes a hash.** A self-referential pointer cannot
be right — a commit cannot name itself. The session list carries hashes, which are
historical facts that never rot, and the tip is one `git log --oneline -5` away.

**Every commit that changes behaviour updates, in that same commit:** the START HERE session
list (one line per commit) · any section the change touches · the suite table if a suite was
added · the relevant README(s) — `README.md` (overview + "Using it"), `README_SIM.md` (sim
model / command flow / endpoints / walkthrough), `README_PLAYBACK.md` · and
`node build_docs.js` if a generated document covers it. Internal-only refactors need none of
it — say so in the commit rather than silently skipping.

**THE WHOLE `docs/` DOCX SET IS GENERATED** (docx-js; `npm install` in `tools/` first; output
paths are script-relative). **Never hand-edit a docx** — edit its script and rebuild. If
one does get hand-edited in Word, diff the text against the generated version and fold the
edits back INTO the script. All four are brand-free by rule: the console core names no
vendor; vessel FILES may name real vessels, since that is data rather than branding.
**A fifth generated artifact sits beside them:** `ASV-Console-Programming-by-Conversation.pptx`
(added 2026-08-05, Andy's request) — a presentation on this project + the DES schema for a
graduate audience. **Its generator is `tools/build_deck.js`** (`npm install` covers it —
pptxgenjs is in `tools/package.json`); a rebuild was verified to reproduce the committed
deck's slide XML byte-for-byte. Same never-hand-edit + only-commit-on-change rules as the
docx set, with the hash check on `ppt/slides/*.xml` instead of `word/document.xml`. Its
icons are pre-rendered into `tools/deck_icons.json` — regenerate ONLY when changing them
(`tools/build_deck_icons.js`; its heavy deps are deliberately not in `package.json`).
It is NOT covered by `docs_valid.py` (which globs `*.docx` and asserts exactly four), and it
names real outside projects and vendors by design (the Starlink / Q-Hub / DeltaT case-study
series; NOT the sibling) — presentation content is Andy's authored material, like the
maintainer notes in this file, and the sanitization rule is scoped to CODE.

```
cd tools && node build_docs.js     # rebuilds all four
```

| script | → `docs/` | for |
|---|---|---|
| `build_quickstart.js` | `asv-simulator-quick-start.docx` | first-time users, ~20 min to a running survey |
| `build_ops_manual.js` | `asv-simulator-operations-manual.docx` | operators: safety, display, every behaviour, contingencies, checklists (17 ch) |
| `build_tech_manual.js` | `asv-simulator-technical-manual.docx` | engineers: architecture, API, formats, extension (15 ch) |
| `build_dev_guide.js` | `asv-simulator-development-guide.docx` | contributors: testing philosophy, defect shapes, case studies (10 ch) |

**`tools/docx_kit.js` holds the shared formatting** — extracted 2026-08-02 when the set
grew to four, and the tech manual's `word/document.xml` is **byte-identical across that
extraction**, which is the only reason the refactor was safe. Add a document by writing
`build_<name>.js` against the kit, listing it in `build_docs.js`, and adding it to the
document-set table in the tech manual AND `README.md`.

## Not yet done

Git repo (local, no GitHub remote). `RealVcu` command/telemetry codecs are
unimplemented by design (this is a simulator). Design docs: `PLAN.md`,
`ASV_BEHAVIORS_PLAN.md`, `ENC_PUNCHOUT_PLAN.md`.

---

## SESSION CHECKPOINT — 2026-07-23 ("ASV Simulator Project Continued 1" handoff)

Full context for resuming in a fresh session. Everything below is committed
(clean working tree). `git log --oneline` is the authoritative record.

### How this project started
Derived from `D:\Claude\Zboat` (the Teledyne Z-Boat console) as a **sanitized,
brand-free generic ASV simulator**. All vendor/model/proprietary identity was
stripped (VCU not ACM; no ZBoat/Teledyne names, no proprietary wire protocol).
Then a **per-vessel config system** was added (`vessels/*.json`, single source of
truth loaded by server + served to client). Do NOT reintroduce brand identity into
the console core; vessel *files* may name real modeled vessels.

### Current state
- **Server running** (during dev) on port **8791**, active vessel **drix08**,
  logging ON (`logs/asv_*.jsonl`). Restart pattern: kill stale PIDs on the port
  first (see Testing notes), then `python asv_console.py --sim --vessel drix08`.
- **Vessels:** `drix08` is the **DEFAULT** (`DEFAULT_VESSEL_ID`) — it is the vessel
  actually operated, and the default also decides the AIS start-up scope (the service
  subscribes around the then-current spawn, so an Erie default left the traffic layer on
  the wrong water until a switch re-scoped it). `zboat_1800hs` (small battery ASV),
  `example_usv_4m` (battery),
  `drix08` = **Exail DriX H-8**, 7.71 m **diesel** (fuel model), operating from the
  **UDel Lewes facility** — spawn `38.789650, -75.160940` (Lewes-Rehoboth Canal
  centerline). DriX tuned params: `nogo_buffer_m 5`, `under_keel_clearance_m 0.3`
  (nogo floor 2.3 m), `channel_reach_m 120` (Rule 9 fairway reach for the wide
  Lewes channel), speeds 4/7/14 kn, `max_turn_rate_deg_s 20`.

### What was built this session (newest first — see commit hashes)
1. **Survey ops-awareness/editing:** hover current line → time-to-end tooltip;
   WPT-mode plan editing (drag waypoint / click-delete waypoint / **Shift**-click
   line to delete / plain click adds); **LINES** panel per-line table (length,
   plan, actual) logged as `client:survey_lines` via `POST /api/logevent`.
   Mission duration on Punch Out split into **Survey** + **Approach** vessel-card
   rows; TIME pill shows **local · UTC** (1 s ticker).
2. **Punch-Out channel exclusion:** a survey that SPANS ACROSS a channel excludes
   it from coverage (`channelSpanKeepouts`, survey-clip only — transits unaffected,
   internal-channel surveys unaffected). Channel = dredged area OR **buoy-gate
   fairway** (`pairGates` sweeps a corridor).
3. **Lateral channel marks (buoys/beacons):** server role `chan_mark` + `CATLAM`
   (cache bumped to `features_v3_`); client draws them (green port / red stbd),
   keeps clear, uses them as Rule 9 channel walls; `gateProject()` steers a
   Go-To/RTH through the outer gate centre and stands on past it.
4. **Rule 9 keep-right** vessel-tunable reach (`channel_reach_m`); DriX now keeps
   right in the ~150 m Lewes fairway (was tuned for tight marinas).
5. **DriX fixes:** couldn't route around ENC objects → buffer 10→5 m; UKC 0.5→0.3;
   spawn moved to Lewes (from Presque Isle).
6. **Trail:** persists across page refresh within a session, **dropped on sim
   reboot** (tagged with server `boot_id`).
7. **Named-reason nogo refusal highlight** for Go-To/RTH AND Survey/Transit/Punch
   Out legs (pulses the offending feature + ✕ marker; names the kind).
8. **Server:** suppress benign client-disconnect tracebacks; `boot_id` +
   `/api/logevent` + `/api/vessel(s)` endpoints; energy model (battery|fuel).

### NEEDS LIVE VERIFICATION (historical list — see the correction below). All were
unit/harness-tested where possible, but the click/drag/hover UX itself was unverified
in a real browser at the time:

> **The stated reason was WRONG and cost real coverage.** "localhost is blocked in the
> in-app browser" was never true — disproved 2026-08-02 by simply doing it
> (`preview_start` on `http://127.0.0.1:<port>/`, then `javascript_tool` to drive the
> page). Canvas screenshots do still time out, but `getImageData` reads the pixels
> instead. **A believed-blocked tool is worse than a missing one: nobody retries it.**
> Start a scratch console on a SPARE port so Andy's 8791 is untouched.
- WPT-mode waypoint **drag** feel + hit radius (10 px); **Shift**-click line delete.
- **Hover** time-to-end tooltip on the active line during a run.
- **LINES** panel live actuals + the auto-log on run end.
- Gate-pairing projection visually threading the Roosevelt Inlet jetty gate.

### Open threads / possible next
- Only ONE gate is charted in the Lewes ENC cell (Roosevelt Inlet jetty lights +
  Buoy 4); gate features engage only where marks exist.
- Mission-duration estimate is straight length ÷ speed (no turn/accel modeling).
- Could add a playback-viewer table view of the logged `survey_lines` events.

### Key gotchas learned (don't relearn these)
- **Client-side routing:** `routeAround`/`planNogoRoute`/`channelLaneRoute`
  are ALL browser JS (this list named `keepRight`/`gateProject` until they were
  deleted 2026-08-02). Driving via raw `/api/cmd/*` + `upload` with no `route`
  BYPASSES ENC routing → the boat crosses nogo. The GUI Punch-Out+Upload flow
  routes clear.
- **Go-To distance (2026-07-25):** two effects made distant Go-To inconsistent —
  (1) coverage: the nogo model is a ~5 km box and `doGoTo`/`doRTH`/`doTransit` didn't
  extend the fetch to the target (surveys do); (2) resolution: `routeAround`'s grid
  coarsens past ~4 km (cell = bbox/1400). **COVERAGE FIX shipped:** `ensureNogoCovers`
  (mirror of `ensureNogoArea`); the three behaviors are now `async` and `await` it
  (boat ⋃ target) before planning. **Resolution fix also shipped:** `routeAroundSeg`
  splits a leg >~4.5 km into ~2.2 km sub-legs (each keeps the fine 3 m grid), routes
  each with `routeAround`, stitches; `legPath` calls it. Safe by construction (falls
  back to a single `routeAround`); short legs byte-identical. Harness-validated on the
  Z-Boat (same code). Live GUI spot-check owed.
- **Stale server PIDs** on Windows hold the port and serve old code — always kill
  by PID before retesting server changes.
- **Testing pattern that works well:** extract the real JS functions from
  `static/asv.html` with a brace-balance grabber into a Node harness and run
  against real ENC fetched from `/api/enc` (see the many scratchpad `*.js` tests).
- Delete a stale `mission.json` to pick up new vessel defaults (it persists old
  buffer/arrival).
- **NDBC station id case:** `activestations.xml` lists coastal / C-MAN ids in
  **lowercase** (`lwsd1`, `cman4`), but the realtime2 data files are served under
  **UPPERCASE** (`LWSD1.txt`) — using the raw id 404s and silently drops the nearest
  local wind stations (near Lewes it fell back to a buoy 55 km out). Ids are now
  normalised to uppercase at ingestion + at the data URL; keep them that way.
