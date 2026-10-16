"""speed_zones.py - SPEED ZONES FROM STATE GIS PORTALS, merged into the chart the console serves.

Andy, 2026-10-16: "Try ingesting local data from state GIS portals and merge into the NOAA environment. Build a bounded
area that overrides commanded speed and lowers to legal speed. this releases once the ASV is clear of the area and it
returns to commanded speed." Asked first whether no-wake zones show on the ENC: measured that day over NOAA ENCDirect,
the chart has a "no wake area" category (CATREA 24) on no area in the US, publishes no RESTRN field at all, and carries
a speed only as text on ~330 restricted areas - nearly all the right whale Seasonal Management Areas, which bind vessels
65 ft and over. The local rules are the states'.

WHAT THIS DOES: for a box, asks each SOURCE (a state agency's ArcGIS layer of boating speed zones) for the polygons in
it, turns each record into one zone - {rule, limit_kn, name, source, text, min_length_m} - and returns them as GeoJSON
features with role "speed_zone", which asv_console.py adds to the chart it serves (/api/enc). The page reads them there
(static/js/speedzones.js) beside the chart's own speed text, draws them, and its speed governor holds her to them.

  * A SOURCE says where its layer is and how to read a record (`rule_of`): which field is the restriction and what each
    value means. A record whose restriction cannot be read is SKIPPED and counted (`unread`), never guessed - a zone
    read as "no limit" would be a zone that lets her through at speed.
  * mph is turned to knots here (1 kn = 1.15078 mph), once: the console's speeds are knots.
  * Each source's answer for a 0.25 degree tile is CACHED on disk (charts/speed/) for SPEED_CACHE_TTL_S; a source that
    does not answer is retried after SPEED_FAIL_RETRY_S, and its last good answer is served meanwhile, said stale.
  * Nothing here can take the chart down: every failure is a line in the report (`sources`), and the chart is served.
"""
import json
import math
import os
import threading
import time
import urllib.parse
import urllib.request

TILE_DEG = 0.25                     # the chart's own tile; a box is asked tile by tile so a cache serves any box
SPEED_CACHE_TTL_S = 7 * 86400       # a state's zones change by ordinance, not by the hour
SPEED_FAIL_RETRY_S = 600            # a source that failed is not asked again for this long (its last good answer stands)
SPEED_TIMEOUT_S = 12.0
MPH_PER_KN = 1.15078
SPEED_MAX_RECORDS = 2000            # one tile's records from one source - far more than any harbor has

_lock = threading.Lock()
_failed = {}                         # (source id, tile) -> time it failed


def kn_from_mph(mph):
    return round(float(mph) / MPH_PER_KN, 1)


# ── THE SOURCES ──────────────────────────────────────────────────────────────────────────────────────────────────────
# Each: id, name (as the operator reads it), covers (W, S, E, N - asked only for boxes that touch it), url (an ArcGIS
# FeatureServer/MapServer LAYER), and rule_of(attrs) -> {rule, limit_kn, name?, text?, min_length_m?} or None (a record
# whose restriction is not a speed rule, or cannot be read). Read from what was MEASURED against each service on
# 2026-10-16 (its fields, and every distinct value of its restriction field - scratchpad research), not its documentation.
#
# ⚠ CONDITIONS ARE APPLIED AT ALL TIMES. A zone "during flooding", "Saturdays, Sundays and holidays", "Nov 15 - Mar 31" or
# "at night" is held all the time, the most restrictive of its regimes - safety before efficiency, and the console knows
# neither the flood nor the holiday. The zone's text keeps the condition, so the operator reads what the law says.
#
# ⚠ NEW HAMPSHIRE, MAINE AND MASSACHUSETTS PUBLISH NONE (every state server and ArcGIS Online org searched, 2026-10-16):
# their rules are distances - headway within 150 ft of shore, docks and moorings (NH RSA 270-D:2 VI), within 200 ft of any
# shoreline (ME 12 MRSA 13068-A(13)) - not polygons. Their one charted speed zone is federal and is the chart's own
# (static/js/speedzones.js CFR_SPEED: 33 CFR 165.101, Kittery).
import re as _re


def _mph_numbers(s):
    return [float(x) for x in _re.findall(r"(\d+(?:\.\d+)?)\s*(?:-\s*)?MPH", str(s or "").upper())]


def _len_ft(s):
    m = _re.search(r"(\d+(?:\.\d+)?)\s*(?:FEET|FT)\b[^.]{0,20}?(?:OR MORE|AND OVER|OR LONGER|OR GREATER)", str(s or "").upper())
    return round(float(m.group(1)) * 0.3048, 1) if m else None


def _fl_bra(a):
    """FWC Boating Restricted Areas (68D-24): RESTRICTION is the rule, CON_SHORT its condition."""
    r = str(a.get("RESTRICTION") or "").strip().upper()
    cond = str(a.get("CON_SHORT") or "").strip()
    if "IDLE SPEED" in r:
        out = {"rule": "idle", "limit_kn": None}
    elif "SLOW SPEED" in r:
        out = {"rule": "slow", "limit_kn": None}
    elif _mph_numbers(r):
        out = {"rule": "limit", "limit_kn": kn_from_mph(min(_mph_numbers(r)))}
    else:
        return None                     # no entry, no anchoring, no external propellers: not a speed rule
    out["name"] = str(a.get("AREA_NAME") or "").strip() or None
    out["text"] = "; ".join(x for x in (str(a.get("AREA_NUM") or a.get("RULE_NUM") or "").strip(), str(a.get("RESTRICTION") or "").strip(),
                                         cond) if x)
    ln = _len_ft(cond)
    if ln:
        out["min_length_m"] = ln
    return out


def _fl_manatee(a):
    """FWC Manatee Protection Zones (68C-22): TEXT_68C says it, seasons and all - the most restrictive of what it says."""
    t = str(a.get("TEXT_68C") or "").strip()
    u = t.upper()
    cl = str(a.get("MASTER_CL") or "").strip().upper()
    if "IDLE" in u or cl == "IS":
        out = {"rule": "idle", "limit_kn": None}
    elif "SLOW SPEED" in u or cl == "SS":
        out = {"rule": "slow", "limit_kn": None}
    elif _mph_numbers(u):
        out = {"rule": "limit", "limit_kn": kn_from_mph(min(_mph_numbers(u)))}
    elif cl.isdigit():
        out = {"rule": "limit", "limit_kn": kn_from_mph(float(cl))}
    else:
        return None                     # no entry, motorboats prohibited: not a speed rule
    out["name"] = ("Manatee protection zone" + (", " + str(a.get("COUNTY")).strip() + " County" if a.get("COUNTY") else ""))
    out["text"] = "; ".join(x for x in (str(a.get("SECT_68C") or "").strip(), t) if x)
    return out


def _nc(a):
    """NC WRC No-Wake Zones: every polygon is one; CODE cites the rule."""
    name = " - ".join(x for x in (str(a.get("WATERBODY") or "").strip(), str(a.get("LOCATION") or "").strip()) if x)
    return {"rule": "no_wake", "limit_kn": None, "name": name or None, "text": str(a.get("CODE") or "").strip()}


_MD_FIELDS = ("BDAY15", "BNIGHT15", "NDAY15", "NNIGHT15")


def _md(a):
    """MD DNR Waterways Speed Zones: four regimes (boating season / off season, day / night) - the most restrictive."""
    rules = []
    for f in _MD_FIELDS:
        v = str(a.get(f) or "").strip().upper()
        if not v or v == "NONE" or v.startswith("PRO") or v.startswith("PWC") or v == "SKI":
            continue                    # no limit; motorboats prohibited; personal watercraft only; a ski area
        if v.startswith("MIN"):
            rules.append(("slow", None))
            continue
        nums = [float(x) for x in _re.findall(r"\d+(?:\.\d+)?", v)]
        if nums:
            rules.append(("limit", min(nums)))
        elif "RESTRICT" in v:
            rules.append(("restricted", None))
    if not rules:
        return None
    qual = [r for r in rules if r[0] != "limit"]
    rule, kn = (("slow" if any(r[0] == "slow" for r in qual) else "restricted"), None) if qual else ("limit", min(r[1] for r in rules))
    return {"rule": rule, "limit_kn": kn, "name": str(a.get("RIV") or "").strip() or None,
            "text": "; ".join(x for x in (str(a.get("COMAR_CODE") or "").strip(),
                                          "season day " + str(a.get("BDAY15") or "-") + ", night " + str(a.get("BNIGHT15") or "-")
                                          + "; off season day " + str(a.get("NDAY15") or "-") + ", night " + str(a.get("NNIGHT15") or "-")) if x)}


def _dc(a):
    """DC No Wake Zones: every polygon is one."""
    return {"rule": "no_wake", "limit_kn": None, "name": "DC no-wake zone" + (" (" + str(a.get("DESCRIPTIO")).strip().lower() + ")" if a.get("DESCRIPTIO") else ""),
            "text": "District of Columbia no-wake zone"}


SOURCES = [
    {"id": "fl_bra", "name": "Florida FWC boating restricted area", "covers": (-87.7, 24.3, -79.8, 31.1),
     "url": "https://gis.myfwc.com/hosting/rest/services/Open_Data/State_Boating_Safety_Zones_Florida/MapServer/10",
     "rule_of": _fl_bra},
    {"id": "fl_manatee", "name": "Florida FWC manatee protection zone", "covers": (-87.7, 24.3, -79.8, 31.1),
     "url": "https://gis.myfwc.com/hosting/rest/services/Open_Data/State_Manatee_Protection_Zones_in_Florida/MapServer/9",
     "rule_of": _fl_manatee},
    {"id": "nc_nwz", "name": "North Carolina WRC no-wake zone", "covers": (-84.4, 33.7, -75.3, 36.7),
     "url": "https://services1.arcgis.com/YfqBAUM5nWR3yhGP/arcgis/rest/services/NWZ/FeatureServer/0",
     "rule_of": _nc},
    {"id": "md_speed", "name": "Maryland DNR speed zone", "covers": (-79.6, 37.8, -75.0, 39.8),
     "url": "https://services.arcgis.com/njFNhDsUCentVYJW/arcgis/rest/services/Waterways_Speed_Zones_for_Public/FeatureServer/0",
     "rule_of": _md},
    {"id": "dc_nwz", "name": "DC no-wake zone", "covers": (-77.13, 38.79, -76.90, 39.0),
     "url": "https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/District_of_Columbia_No_Wake_Zones/FeatureServer/1",
     "rule_of": _dc},
]


def _get_json(url, ssl_ctx, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": "asv-console/speed-zones"})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def esri_to_geojson(geom):
    """An Esri JSON polygon {rings: [...]} as a GeoJSON Polygon. Its rings - outer and holes, and the parts of a
    multipart polygon - are kept as they come: the page's point test (geometry.js ptInGeom) is even-odd over every ring,
    which is what an Esri polygon means. None for anything else."""
    rings = (geom or {}).get("rings")
    if not rings:
        return None
    rings = [[[float(c[0]), float(c[1])] for c in r] for r in rings if r and len(r) >= 4]
    return {"type": "Polygon", "coordinates": rings} if rings else None


def _tiles(bbox):
    w, s, e, n = bbox
    out = []
    for tx in range(int(math.floor(w / TILE_DEG)), int(math.floor((e - 1e-12) / TILE_DEG)) + 1):
        for ty in range(int(math.floor(s / TILE_DEG)), int(math.floor((n - 1e-12) / TILE_DEG)) + 1):
            out.append((round(tx * TILE_DEG, 4), round(ty * TILE_DEG, 4), round((tx + 1) * TILE_DEG, 4), round((ty + 1) * TILE_DEG, 4)))
    return out


def _cache_path(cache_dir, src_id, tile):
    return os.path.join(cache_dir, "speed_%s_%.4f_%.4f_%.4f_%.4f.json" % ((src_id,) + tuple(tile)))


def _fetch_tile(src, tile, ssl_ctx, timeout):
    """One source's records in one tile, as zone features. Raises on a failed or refused query."""
    q = {"where": src.get("where", "1=1"), "geometry": "%f,%f,%f,%f" % tile, "geometryType": "esriGeometryEnvelope",
         "inSR": "4326", "outSR": "4326", "spatialRel": "esriSpatialRelIntersects", "outFields": "*",
         "returnGeometry": "true", "f": "json"}
    # PAGED: a service answers at most its own page (North Carolina's is 600) and says when there is more
    recs, exceeded = [], False
    for _page in range(SPEED_MAX_RECORDS // 100):
        q["resultOffset"] = str(len(recs))
        d = _get_json(src["url"].rstrip("/") + "/query?" + urllib.parse.urlencode(q), ssl_ctx, timeout)
        if "error" in d:
            raise RuntimeError("the service refused the query: %s" % (d["error"].get("message") or d["error"]))
        got = d.get("features") or []
        recs.extend(got)
        exceeded = bool(d.get("exceededTransferLimit"))
        if not exceeded or not got or len(recs) >= SPEED_MAX_RECORDS:
            break
    feats, unread = [], []
    for f in recs:
        attrs = f.get("attributes") or {}
        g = esri_to_geojson(f.get("geometry"))
        oid = attrs.get("OBJECTID", attrs.get("FID", attrs.get("objectid")))
        r = src["rule_of"](attrs) if g else None
        if not r:
            unread.append(oid)          # by id: a record astride two tiles is one record not read, not two
            continue
        props = {"rule": r["rule"], "limit_kn": r.get("limit_kn"), "name": r.get("name") or src["name"],
                 "source": src["name"], "text": (r.get("text") or "")[:300], "zone_id": "%s|%s" % (src["id"], oid)}
        if r.get("min_length_m"):
            props["min_length_m"] = r["min_length_m"]
        feats.append({"role": "speed_zone", "cls": "Speed_Zone_" + src["id"], "geometry": g, "props": props})
    return {"features": feats, "unread": unread, "exceeded": exceeded}


def zones_for_bbox(bbox, cache_dir, ssl_ctx=None, sources=None, timeout=SPEED_TIMEOUT_S, now=None):
    """THE SPEED ZONES IN A BOX, from every source that covers it: (features, report). `report` lists each source asked
    - {id, name, ok, count, unread, cached, stale, error} - so a source that failed is said, never silent."""
    now = time.time() if now is None else now
    srcs = SOURCES if sources is None else sources
    os.makedirs(cache_dir, exist_ok=True)
    feats, report, seen = [], [], set()
    for src in srcs:
        cov = src.get("covers")
        if cov and (bbox[2] < cov[0] or bbox[0] > cov[2] or bbox[3] < cov[1] or bbox[1] > cov[3]):
            continue                                      # not this state's water
        rep = {"id": src["id"], "name": src["name"], "ok": True, "count": 0, "unread": 0, "cached": 0, "stale": 0, "error": None}
        unread_ids = set()
        for tile in _tiles(bbox):
            path = _cache_path(cache_dir, src["id"], tile)
            got, age = None, None
            try:
                with open(path, encoding="utf-8") as fh:
                    got = json.load(fh)
                age = now - float(got.get("t", 0))
            except (OSError, ValueError):
                got = None
            fresh = got is not None and age is not None and age < SPEED_CACHE_TTL_S
            with _lock:
                failed_at = _failed.get((src["id"], tile))
            fetched = False
            if not fresh and not (failed_at and now - failed_at < SPEED_FAIL_RETRY_S):
                try:
                    res = _fetch_tile(src, tile, ssl_ctx, timeout)
                    got = {"t": now, **res}
                    tmp = path + ".tmp%d" % os.getpid()
                    with open(tmp, "w", encoding="utf-8") as fh:
                        json.dump(got, fh)
                    os.replace(tmp, path)
                    fresh = fetched = True
                    with _lock:
                        _failed.pop((src["id"], tile), None)
                except Exception as e:                    # a source down never takes the chart with it
                    with _lock:
                        _failed[(src["id"], tile)] = now
                    rep["ok"] = False
                    rep["error"] = str(e)[:200]
            elif not fresh:
                rep["ok"] = False
                rep["error"] = rep["error"] or "it did not answer a few minutes ago; asked again shortly"
            if got is None:
                continue
            if not fresh:
                rep["stale"] += 1                          # its last good answer, past its week: served, and said
            elif not fetched:
                rep["cached"] += 1
            u = got.get("unread")
            if isinstance(u, list):
                unread_ids.update(str(x) for x in u if x is not None)
            for f in got.get("features") or []:
                zid = f.get("props", {}).get("zone_id")
                if zid in seen:                            # a zone crossing a tile edge is served once
                    continue
                seen.add(zid)
                feats.append(f)
                rep["count"] += 1
        rep["unread"] = len(unread_ids)
        report.append(rep)
    return feats, report


def merge_into_chart(data, bbox, cache_dir, ssl_ctx=None, sources=None):
    """The chart's answer with the state zones in it: their features appended and `speed_sources` saying what was asked.
    Never raises - a failure is one line in the report and the chart goes out as it was."""
    try:
        feats, report = zones_for_bbox(bbox, cache_dir, ssl_ctx, sources)
    except Exception as e:                                # belt and braces: the chart is served whatever happens here
        feats, report = [], [{"id": "speed_zones", "name": "speed zones", "ok": False, "count": 0, "error": str(e)[:200]}]
    if isinstance(data, dict):
        data["features"] = list(data.get("features") or []) + feats
        data["speed_sources"] = report
    return data
