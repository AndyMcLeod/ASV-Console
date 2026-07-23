# Chart-feature "Punch Out" survey planning

> **STATUS: IMPLEMENTED (2026-07-20).** Server ENC fetch/cache (`/api/enc`) +
> client overlay, `SURV` panel Min-depth/Buffer/enforce toggles, and the
> `Punch Out` clip all shipped and verified in sim against live NOAA data
> (Presque Isle Bay: a 23-line rectangle → 6 safe segments; enforce-off keeps all
> 23 at full length; min-depth 100 m → ~0). Decisions taken: conservative DRVAL1
> depth test, 10 m default buffer, all four feature classes enforced by default.

A new survey-planning paradigm: instead of hand-drawing a keep-out polygon, the
operator defines a **large rectangular survey area**, sets a **minimum water
depth**, and clicks **Punch Out** — the console trims every survey line's extents
to real **ENC chart features**: shorelines, docks, fixed aids, hazards, and water
too shallow for the survey.

## 1. Data source (verified live 2026-07-20)

NOAA **ENCDirect** vector MapServer (same chart data as our raster tiles, but as
queryable geometry), scale-banded:
`gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_{harbour,approach,coastal,general}/MapServer`.

- Query by bbox → **GeoJSON** (`/{layerId}/query?geometry=<xmin,ymin,xmax,ymax>&
  geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=*&
  returnGeometry=true&f=geojson`).
- **Depth_Area** polygons carry **`DRVAL1`/`DRVAL2`** (shallowest/deepest depth,
  metres) — confirmed real values near Erie (DRVAL1 1.8, DRVAL2 3.6 …).
- Coverage is scale-dependent: pick the **finest band that returns features** for
  the bbox (harbour first, then approach, coastal, general). Confirmed: Presque
  Isle Bay returns 279 Depth_Area + 76 Land_Area in enc_harbour, 0 in coarser bands.

Relevant layer classes (ids differ per band — resolve by name at runtime):
Depth_Area, Depth_Contour_line, Sounding_point, Land_Area, Coastline_line,
Shoreline_Construction (area+line), Pontoon_line, Mooring_Warping_Facility_point,
Buoy_* / Beacon_* points, Obstruction (point+area), Wreck (point+area),
Underwater_Awash_Rock_point, Pile_point, Dredged_Area, Restricted_Area.

## 2. Architecture

- **Server** `asv_console.py`:
  - `fetch_enc_features(bbox, classes)` — resolves the finest scale band with
    coverage, queries each class, normalizes to one FeatureCollection whose
    features are **tagged by role** (`land | shallow | hazard_point | hazard_line
    | hazard_area | depth_contour | sounding`), and **caches to disk**
    (`charts/enc/<band>/<class>/<bbox-key>.geojson`) so a mission prepped online
    works offline — mirrors the existing tile cache + circuit breaker.
  - `GET /api/enc?bbox=…&min_depth=…` → tagged FeatureCollection (+ which band).
- **Browser** `asv.html`:
  - Renders the fetched features as a **chart-features overlay** (land fills,
    shoreline, depth contours, hazard marks, shallow-water hatch).
  - Survey panel gains a **Min depth (m)** input, a **Buffer (m)** input, per-role
    **enforce toggles**, and a **Punch Out** button.
  - Punch-out builds the **keep-out set** and clips each survey line to safe water.

## 3. Keep-out set (what a line is trimmed against)

Union of:
- **Land / shoreline / docks**: Land_Area, Coastline (buffered), Shoreline_
  Construction area+line (buffered), Pontoon, Mooring — hard avoid.
- **Outside the depth window [min,max]** (updated 2026-07-20): a Depth_Area is
  excluded if it is entirely too shallow (**deepest edge `DRVAL2 < min`**) or, when
  a max is set, entirely too deep (`DRVAL1 > max`). Classifying too-shallow by the
  band's *deepest* edge keeps bands that merely straddle the minimum, so genuinely
  deeper water in a mixed band is not clipped (the earlier `DRVAL1 < min` rule cut
  the whole straddling band). Blank max ⇒ deep water is surveyed.
- **Point/line hazards**: Buoys, Beacons, Piles, Rocks, Wrecks, Obstructions —
  buffered by the safety radius into keep-out disks/corridors.
- **Areas**: Obstruction_area, Wreck_area, Dredged_Area/Restricted_Area (optional).

Each keep-out is expanded by a **safety buffer** (default configurable) so lines
keep clear, not just barely outside.

## 4. Clipping algorithm (survey line → safe sub-segments)

General "segment minus polygon-set" (handles every role uniformly once
points/lines are buffered to polygons):
1. For each survey line segment, collect all parameters *t* ∈ (0,1) where it
   crosses any keep-out polygon edge; add 0 and 1; sort.
2. For each consecutive interval, test its **midpoint**: keep the sub-segment iff
   the midpoint is **outside every keep-out polygon** (point-in-polygon).
3. The kept sub-segments replace the original line. Waypoints regenerate from the
   surviving sub-segments (boustrophedon order preserved); a line fully inside
   keep-out drops out entirely.

Runs client-side (JS) for responsiveness; features fetched/cached server-side.

## 5. Safety framing (non-negotiable)

- **Planning aid, not a certified ENC engine.** ENC scale/coverage varies, data
  can be stale, and clipping is geometric — the operator remains responsible for
  the plan (consistent with the manual and this project's "estimated/ not
  hydrographic-certified" honesty elsewhere). A visible banner says so.
- **Conservative by default** (shallowest-depth test, buffered keep-outs).
- Online fetch, cached for offline; if features can't be fetched, Punch Out
  **refuses and says so** rather than silently passing lines through unclipped.
- Punch-out is **non-destructive**: it edits line extents but the original
  rectangle/handles remain so the operator can re-run with different depth/buffer.

## 6. Scope

Pure planning-side feature — independent of the VCU protocol, fully buildable and
testable in sim now. Does **not** replace the CAMP 3-click pattern; it augments
it (define a big rectangle, then Punch Out).

**Arbitrary polygon boundary (CAMP `SurveyArea`) — DONE (2026-07-20).** `BND` mode
draws an arbitrary (incl. concave) survey-area polygon; the pattern's legs are
clipped to it by exact line-vs-polygon intersection (`clipToPoly`), splitting legs
that cross a concavity. It **composes** with Punch Out — the boundary is a keep-in
region, ENC features are keep-out — so `patSourceLines()` (boundary-clipped) feeds
`clipLine` (ENC). Verified in sim: chevron shortens center legs (200–320 m); a
U-shape splits 18/25 legs into 2+; boundary + ENC over the bay → 24 → 29 segments.
