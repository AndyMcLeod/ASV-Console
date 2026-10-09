"""The tidal stream at a position and a time, fused from the NOAA sources that cover the water.

Andy, 2026-10-07: *"move forward with implementation as you suggest. The bottom line goal is to simulate wind/wave/
current effects on the passage of a given ASV through the water."* The console used to read ONE value from ONE
regional forecast model (an OFS, currents.py) at the boat's position and apply it uniformly. Measured that day: the
Piscataqua's model (gomofs) is 3-hourly and the build of that day could not read it (the shared reader can since,
2026-10-07), so his Little Bay session ran with NO stream
while NOAA predicted 3.8 kn of flood and 4.0 kn of ebb at the General Sullivan Bridge - and the Gulf of Maine model has
no water cells from the Memorial Bridge up, so no fix to the reader would ever have filled it.

WHAT THIS ADDS, IN THE ORDER IT IS TRUSTED
  1. NOAA's own tidal current PREDICTIONS (tidesandcurrents.noaa.gov, CO-OPS) at the stations round the boat - 26
     locations within 25 km of New Castle NH - fetched a week ahead and kept on disk, so the console has them at sea
     and for any time a plan reaches. Each station gives a signed speed on its own flood/ebb axis every 6 minutes;
     between stations the vectors are weighted by inverse distance squared (the nearest few, out to STATION_REACH_M).
  2. A gridded MODEL where one has water at the boat: the OFS the console already reads, or a PacIOOS regional ocean
     model served by ERDDAP (Oahu South Shore, the Main Hawaiian Islands, Samoa, the Western North Pacific). The model
     gives the spatial pattern; where stations lie inside it, the model is CALIBRATED to them - a gain and a time lag
     per station, least squares along the station's axis (measured at Lewes 2026-10-07: dbofs ran 30 % weak at the bay
     mouth, and scaling it to the harmonic station cut its error from 0.47 kn to 0.29 kn).
  3. The two BLENDED by distance to the nearest station: the station field near a station, the calibrated model away
     from one (weight exp(-d / BLEND_L_M)).

WHAT IT DOES NOT DO, AND WHY (each measured or checked 2026-10-07)
  * River discharge (water.noaa.gov / the National Water Model) is not a layer: through the Dover Point section the
    Lamprey's 10-day forecast peak adds about 0.01 kn. It matters above the head of tide and in floods, not here.
  * The global ocean model (RTOFS) is not a layer yet: its point service (CoastWatch ERDDAP) was unreachable from this
    machine, and NOMADS retired OPeNDAP. A dataset whose query cannot be verified is not shipped.
  * Live current meters are not yet a correction layer - the next step, where a port has one.
  * No cross-channel profile: a boat near a bank gets the field's value there. The stations are mid-channel.

CONVENTIONS: speed in knots on the wire, m/s inside; SET is where the water GOES, degrees true, as currents.py. Times
are epoch seconds UTC. Every answer that is not a value is None, never a zero: a zero current and no data are different
answers, and the console says which (the same rule as currents.py and the water level).

Standard library only, like the rest of the console. Network fetches happen ONLY in the methods named fetch_* / ensure*
and are called from the monitor's background thread; the evaluation functions (field, at, fuse) never touch the network
and never raise on missing data.
"""
import bisect
import calendar
import json
import math
import os
import threading
import time
import urllib.parse
import urllib.request

KN = 0.514444                     # m/s per knot
COOPS_STATIONS_URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=currentpredictions"
COOPS_DATA_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
APPLICATION = "asv_console"       # CO-OPS asks every caller to name itself

# Stations kept on hand round the boat. Larger than STATION_REACH_M so a boat working inside it needs no fetch.
SELECT_RADIUS_KM = 25.0
# A station's prediction reaches this far. The Piscataqua's stations are 0.5-2 km apart along the river; past 3 km the
# nearest station is usually in other water (a different reach, the far side of a point), and the model or nothing is
# the better answer.
STATION_REACH_M = 3000.0
IDW_K = 3                          # the nearest few stations
IDW_FLOOR_M = 50.0                 # so a boat on top of a station takes that station, not a division by zero
BLEND_L_M = 1000.0                 # station weight exp(-d / L) against the calibrated model
TABLE_STEP_S = 360                 # CO-OPS predictions every 6 minutes
EVENT_GAP_S = 1800                 # a gap wider than this is between EVENTS: sinusoidal, not linear
SLACK_KN = 0.05                    # an event this slow is a slack (CO-OPS writes slack as 0)
TABLE_DAYS_BACK = 1
TABLE_DAYS_AHEAD = 7
REFETCH_AHEAD_S = 2 * 86400        # a table reaching less than two days ahead is refetched
META_MAX_AGE_S = 7 * 86400         # the station list changes rarely
FETCH_TIMEOUT_S = 60.0

# CALIBRATION of a model against a station: accepted only where the fit is a fit.
CAL_MIN_SAMPLES = 24               # half-hourly over at least 12 h
CAL_MIN_R = 0.6                    # correlation along the station's axis
CAL_GAIN_RANGE = (0.4, 2.5)
CAL_LAGS_S = range(-5400, 5401, 600)   # +-90 min in 10 min steps
CAL_REACH_M = 15000.0              # a station's calibration informs the model this far from it


# --------------------------------------------------------------------------- #
#  small helpers
# --------------------------------------------------------------------------- #
def dist_m(lat1, lon1, lat2, lon2):
    p = math.pi / 180.0
    h = (math.sin((lat2 - lat1) * p / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2)
    return 12742000.0 * math.asin(min(1.0, math.sqrt(h)))


def axis_vector(v_kn, flood_deg, ebb_deg):
    """A signed major-axis speed (+ flood, - ebb, knots) -> (east, north) m/s along the station's own flood or ebb
    direction. Flood and ebb are NOT assumed opposite: at the harbor entrance they are 342 and 194 degrees."""
    if v_kn is None:
        return None
    d = flood_deg if v_kn >= 0 else ebb_deg
    if d is None:
        return None
    s = abs(v_kn) * KN
    a = math.radians(d)
    return s * math.sin(a), s * math.cos(a)


def speed_set(u, v):
    """(east, north) m/s -> (knots, degrees true the water goes toward)."""
    return math.hypot(u, v) / KN, (math.degrees(math.atan2(u, v)) + 360.0) % 360.0


def fetch_json(url, timeout=FETCH_TIMEOUT_S):
    req = urllib.request.Request(url, headers={"User-Agent": "asv-console (stream_fusion)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _write_json_atomic(path, obj):
    """Whole-file writes only: a reader never sees half a table. Windows refuses a replace while another handle has the
    file open (see the console's own note on this), so the replace is retried briefly; on failure the old file stands
    and the caller still has the data in memory."""
    tmp = "%s.%d.part" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"))
    for _ in range(10):
        try:
            os.replace(tmp, path)
            return True
        except PermissionError:
            time.sleep(0.05)
    try:
        os.remove(tmp)
    except OSError:
        pass
    return False


# --------------------------------------------------------------------------- #
#  1. NOAA tidal current predictions at stations
# --------------------------------------------------------------------------- #
class StationTable:
    """One station's predictions: signed speeds on its own flood/ebb axis at explicit times (epoch, ascending).

    TWO SHAPES OF SERIES, ONE TABLE (found on the live smoke test, 2026-10-07). A HARMONIC station answers a 6-minute
    series; a SUBORDINATE station answers only its EVENTS - each maximum flood, slack and maximum ebb, about 56 points
    in eight days - however the request is worded. Resampled linearly onto a regular step, the events made a triangle
    of the tide and could step straight over a maximum. So the times are kept as given, and between two points more
    than EVENT_GAP_S apart the curve is the tide's own shape between events (see major_at); within a 6-minute series
    it is linear."""

    __slots__ = ("id", "bin", "name", "lat", "lon", "depth_ft", "kind", "flood_deg", "ebb_deg", "ts", "v", "fetched")

    def __init__(self, sid, bin_, name, lat, lon, depth_ft, kind, flood_deg, ebb_deg, ts, v, fetched=None):
        self.id, self.bin, self.name = sid, bin_, name
        self.lat, self.lon, self.depth_ft, self.kind = float(lat), float(lon), depth_ft, kind
        self.flood_deg, self.ebb_deg = flood_deg, ebb_deg
        self.ts, self.v = [float(t) for t in ts], [float(x) for x in v]
        self.fetched = fetched

    @property
    def t0(self):
        return self.ts[0] if self.ts else 0.0

    @property
    def t1(self):
        return self.ts[-1] if self.ts else 0.0

    def covers(self, t):
        return len(self.ts) >= 2 and self.ts[0] - 1e-6 <= t <= self.ts[-1] + 1e-6

    def major_at(self, t):
        """The signed major-axis speed at epoch `t` (knots); None outside the table."""
        if not self.covers(t):
            return None
        k = bisect.bisect_right(self.ts, t) - 1
        k = min(max(k, 0), len(self.ts) - 2)
        ta, tb = self.ts[k], self.ts[k + 1]
        a, b = self.v[k], self.v[k + 1]
        f = (t - ta) / (tb - ta) if tb > ta else 0.0
        f = min(1.0, max(0.0, f))
        if tb - ta <= EVENT_GAP_S:
            return a + (b - a) * f                       # a 6-minute series: linear
        # BETWEEN EVENTS the tide is a sinusoid, and a slack is its ZERO CROSSING, not an extremum. So a slack-to-
        # strength segment is a QUARTER cycle - v = Vmax sin(90 f), the curve NOAA's tables have always told mariners to
        # use - and so is strength-to-slack; strength to strength (a current that never goes slack: min flood, min ebb)
        # is a HALF cycle. A smooth step on a quarter cycle reads the middle of it as half strength where it is 0.71.
        sa, sb = abs(a) < SLACK_KN, abs(b) < SLACK_KN
        if sa and not sb:
            return a + (b - a) * math.sin(math.pi * f / 2.0)
        if sb and not sa:
            return b + (a - b) * math.cos(math.pi * f / 2.0)
        return a + (b - a) * (1.0 - math.cos(math.pi * f)) / 2.0

    def vec_at(self, t):
        return axis_vector(self.major_at(t), self.flood_deg, self.ebb_deg)

    def to_json(self):
        return {"id": self.id, "bin": self.bin, "name": self.name, "lat": self.lat, "lon": self.lon,
                "depth_ft": self.depth_ft, "kind": self.kind, "flood_deg": self.flood_deg, "ebb_deg": self.ebb_deg,
                "ts": [int(round(t)) for t in self.ts], "v": [round(x, 3) for x in self.v], "fetched": self.fetched}

    @classmethod
    def from_json(cls, d):
        return cls(d["id"], d.get("bin"), d.get("name"), d["lat"], d["lon"], d.get("depth_ft"), d.get("kind"),
                   d.get("flood_deg"), d.get("ebb_deg"), d["ts"], d["v"], d.get("fetched"))


def _parse_time(text):
    """A CO-OPS "YYYY-MM-DD HH:MM" asked for with time_zone=gmt -> epoch seconds UTC (calendar.timegm: no local
    zone, no daylight-saving edge)."""
    return calendar.timegm(time.strptime(text, "%Y-%m-%d %H:%M"))


def parse_coops_series(payload, meta):
    """A CO-OPS `currents_predictions` reply (time_zone=gmt, units=english) -> StationTable, or None when it carried
    no predictions (a weak-and-variable station, or an error answered in words). Duplicate times keep the first."""
    cp = ((payload or {}).get("current_predictions") or {}).get("cp") or []
    pts = {}
    flood = ebb = None
    for r in cp:
        try:
            t, v = _parse_time(r["Time"]), float(r["Velocity_Major"])
        except (KeyError, ValueError, TypeError):
            continue
        pts.setdefault(t, v)
        if flood is None and r.get("meanFloodDir") not in (None, ""):
            flood = float(r["meanFloodDir"])
        if ebb is None and r.get("meanEbbDir") not in (None, ""):
            ebb = float(r["meanEbbDir"])
    if len(pts) < 2:
        return None
    ts = sorted(pts)
    return StationTable(meta["id"], meta.get("bin"), meta.get("name"), meta["lat"], meta["lon"], meta.get("depth_ft"),
                        meta.get("kind"), flood, ebb, ts, [pts[t] for t in ts], time.time())


def pick_stations(rows, lat, lon, radius_km=SELECT_RADIUS_KM):
    """The CO-OPS station list -> one entry per LOCATION within `radius_km`, at its SHALLOWEST bin (a surface vessel
    feels the top of the water column: PIR0710 lists bins at 3, 8 and 15 ft). Depth unknown sorts after any depth known.
    Weak-and-variable stations (type W) are left out: they publish no predictions. Nearest first."""
    best = {}
    for s in rows or ():
        try:
            slat, slon = float(s["lat"]), float(s["lng"] if "lng" in s else s["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        if str(s.get("type")) == "W":
            continue
        d = dist_m(lat, lon, slat, slon)
        if d > radius_km * 1000.0:
            continue
        depth = s.get("depth")
        key = (0, float(depth)) if isinstance(depth, (int, float)) else (1, 0.0)
        cur = best.get(s["id"])
        if cur is None or key < cur[0]:
            best[s["id"]] = (key, {"id": s["id"], "bin": s.get("currbin"), "name": s.get("name"), "lat": slat,
                                   "lon": slon, "depth_ft": depth, "kind": s.get("type"), "dist_m": d})
    return sorted((v for _, v in best.values()), key=lambda m: m["dist_m"])


class StationPredictions:
    """The station tables round the boat, on disk under `cache_dir` and in memory.

    ensure() does the networking (call it from a background thread); tables() hands back an immutable tuple the
    evaluation side reads without a lock. Never raises: a failure is returned as the reason, and the tables already held
    stand."""

    def __init__(self, cache_dir, fetch=fetch_json, now=time.time):
        self.cache_dir = cache_dir
        self._fetch = fetch
        self._now = now
        self._tables = ()
        self._meta = None
        self._meta_at = 0.0
        self._center = None
        self.last_note = None

    def tables(self):
        return self._tables

    # -- the station list ------------------------------------------------------
    def _meta_path(self):
        return os.path.join(self.cache_dir, "stations_currentpredictions.json")

    def load_meta(self):
        now = self._now()
        if self._meta is not None and now - self._meta_at < META_MAX_AGE_S:
            return self._meta
        path = self._meta_path()
        try:
            st = os.stat(path)
            if now - st.st_mtime < META_MAX_AGE_S:
                with open(path, encoding="utf-8") as f:
                    rows = json.load(f)
                self._meta, self._meta_at = rows, st.st_mtime
                return rows
        except (OSError, ValueError):
            pass
        payload = self._fetch(COOPS_STATIONS_URL)
        keep = ("id", "name", "lat", "lng", "currbin", "depth", "depthType", "type")
        rows = [{k: s.get(k) for k in keep} for s in (payload or {}).get("stations", [])]
        if rows:
            os.makedirs(self.cache_dir, exist_ok=True)
            _write_json_atomic(path, rows)
            self._meta, self._meta_at = rows, now
        elif self._meta is None:
            # keep a stale file over nothing at all
            try:
                with open(path, encoding="utf-8") as f:
                    self._meta = json.load(f)
            except (OSError, ValueError):
                self._meta = []
        return self._meta

    # -- one station's table -----------------------------------------------------
    def _table_path(self, m):
        return os.path.join(self.cache_dir, "pred2_%s_b%s.json" % (m["id"], m.get("bin")))

    def _load_table(self, m):
        try:
            with open(self._table_path(m), encoding="utf-8") as f:
                return StationTable.from_json(json.load(f))
        except (OSError, ValueError, KeyError):
            return None

    def fetch_table(self, m):
        now = self._now()
        t0 = now - TABLE_DAYS_BACK * 86400
        t1 = now + TABLE_DAYS_AHEAD * 86400
        q = {"product": "currents_predictions", "application": APPLICATION,
             "begin_date": time.strftime("%Y%m%d %H:%M", time.gmtime(t0)),
             "end_date": time.strftime("%Y%m%d %H:%M", time.gmtime(t1)),
             "station": m["id"], "time_zone": "gmt", "interval": "6", "units": "english", "format": "json"}
        if m.get("bin") is not None:
            q["bin"] = str(m["bin"])
        payload = self._fetch(COOPS_DATA_URL + "?" + urllib.parse.urlencode(q))
        tab = parse_coops_series(payload, m)
        if tab is not None:
            os.makedirs(self.cache_dir, exist_ok=True)
            _write_json_atomic(self._table_path(m), tab.to_json())
        return tab

    def ensure(self, lat, lon):
        """Hold a table covering now .. now + 2 days for every station within SELECT_RADIUS_KM. Returns None when done,
        or the reason it could not be (the tables already held, and any read from disk, stand either way)."""
        try:
            rows = self.load_meta()
        except Exception as e:                                   # the station list itself unreachable
            rows = self._meta or []
            if not rows:
                self.last_note = "NOAA current-prediction stations unreachable (%s)" % type(e).__name__
                return self.last_note
        picks = pick_stations(rows, lat, lon)
        now = self._now()
        out, failed = [], 0
        for m in picks:
            tab = self._load_table(m)
            if tab is None or tab.t1 < now + REFETCH_AHEAD_S or tab.t0 > now:
                try:
                    fresh = self.fetch_table(m)
                    tab = fresh or tab
                except Exception:
                    failed += 1
            if tab is not None and tab.v:
                out.append(tab)
        self._tables = tuple(out)
        self._center = (lat, lon)
        self.last_note = (None if not failed else
                          "%d of %d prediction stations could not be refreshed - using what is cached" % (failed, len(picks)))
        if not picks:
            self.last_note = "no NOAA current-prediction station within %d km" % int(SELECT_RADIUS_KM)
        return self.last_note


def stations_field(tables, lat, lon, t, reach_m=STATION_REACH_M, k=IDW_K):
    """The station layer at (lat, lon, t): inverse-distance-squared weighting of the nearest `k` stations within
    `reach_m` whose tables cover `t`. Returns {u, v, near_m, used: [(id, name, dist_m, weight, bin)]} or None.
    The BIN is last (2026-10-09): a station predicts at several depths and its NOAA page shows one, so the console's
    Current window needs the one this read - see asv_console.current_page."""
    cand = []
    for tab in tables or ():
        d = dist_m(lat, lon, tab.lat, tab.lon)
        if d > reach_m:
            continue
        vec = tab.vec_at(t)
        if vec is None:
            continue
        cand.append((d, tab, vec))
    if not cand:
        return None
    cand.sort(key=lambda c: c[0])
    cand = cand[:k]
    w = [1.0 / (d * d + IDW_FLOOR_M * IDW_FLOOR_M) for d, _, _ in cand]
    sw = sum(w)
    u = sum(wi * c[2][0] for wi, c in zip(w, cand)) / sw
    v = sum(wi * c[2][1] for wi, c in zip(w, cand)) / sw
    return {"u": u, "v": v, "near_m": cand[0][0],
            "used": [(c[1].id, c[1].name, round(c[0]), round(wi / sw, 3), c[1].bin) for wi, c in zip(w, cand)]}


# --------------------------------------------------------------------------- #
#  2. Gridded models served by ERDDAP (PacIOOS regional ocean models)
# --------------------------------------------------------------------------- #
# Each verified 2026-10-07 by its /info record and a surface point query. Variables u, v in m/s on
# [time][depth][latitude][longitude]; the shallowest level is 0.25 m. Smallest domain first: it is the finest.
ERDDAP_MODELS = [
    {"key": "pacioos_oahu_south", "label": "PacIOOS Oahu South Shore",
     "url": "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/roms_hiomsg",
     "lat": (21.23194, 21.32355), "lon": (-158.1218, -157.7903), "depth": 0.25},
    {"key": "pacioos_samoa", "label": "PacIOOS Samoa",
     "url": "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/roms_samoa",
     "lat": (-15.5, -12.49855), "lon": (-174.0, -168.8088), "depth": 0.25},
    {"key": "pacioos_hawaii", "label": "PacIOOS Main Hawaiian Islands",
     "url": "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/roms_hiig",
     "lat": (17.01843, 23.98239), "lon": (-163.8307, -152.5193), "depth": 0.25},
    {"key": "pacioos_wpac", "label": "PacIOOS Western North Pacific",
     "url": "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/roms_wpac",
     "lat": (1.949913, 26.9439), "lon": (116.0992, 148.9012), "depth": 0.25},
]


def erddap_model_for(lat, lon):
    for m in ERDDAP_MODELS:
        if m["lat"][0] <= lat <= m["lat"][1] and m["lon"][0] <= lon <= m["lon"][1]:
            return m
    return None


class GridPatch:
    """A small gridded window of a model: ascending lats/lons/times (epoch), u/v [t][y][x] in m/s with None for land.
    `at` is bilinear in space over the WATER nodes only (land dropped, weights renormalised - a query in a one-cell
    channel leans on the water rather than averaging in a zero from the bank) and linear in time; None outside the
    window or with no water in reach - never a zero."""

    def __init__(self, lats, lons, times, u, v, label=None, key=None, fetched=None):
        self.lats, self.lons, self.times = list(lats), list(lons), list(times)
        self.u, self.v = u, v
        self.label, self.key, self.fetched = label, key, fetched

    def covers(self, lat, lon, t=None, margin_cells=1):
        if len(self.lats) < 2 or len(self.lons) < 2:
            return False
        dy = (self.lats[-1] - self.lats[0]) / (len(self.lats) - 1)
        dx = (self.lons[-1] - self.lons[0]) / (len(self.lons) - 1)
        inside = (self.lats[0] + margin_cells * dy <= lat <= self.lats[-1] - margin_cells * dy
                  and self.lons[0] + margin_cells * dx <= lon <= self.lons[-1] - margin_cells * dx)
        if t is None:
            return inside
        return inside and self.times[0] - 1e-6 <= t <= self.times[-1] + 1e-6

    @staticmethod
    def _bracket(axis, x):
        if x < axis[0] or x > axis[-1]:
            return None
        k = 0
        while k < len(axis) - 2 and axis[k + 1] < x:
            k += 1
        span = axis[k + 1] - axis[k]
        return k, ((x - axis[k]) / span if span else 0.0)

    def _frame(self, k, lat, lon):
        by = self._bracket(self.lats, lat)
        bx = self._bracket(self.lons, lon)
        if by is None or bx is None:
            return None
        (y, fy), (x, fx) = by, bx
        su = sv = sw = 0.0
        for yy, wy in ((y, 1 - fy), (y + 1, fy)):
            for xx, wx in ((x, 1 - fx), (x + 1, fx)):
                uu, vv = self.u[k][yy][xx], self.v[k][yy][xx]
                if uu is None or vv is None:
                    continue
                w = wy * wx
                su += w * uu
                sv += w * vv
                sw += w
        if sw <= 1e-9:
            return None
        return su / sw, sv / sw

    def at(self, lat, lon, t):
        if not self.times:
            return None
        if len(self.times) == 1:
            return self._frame(0, lat, lon) if abs(t - self.times[0]) < 1800 else None
        bt = self._bracket(self.times, t)
        if bt is None:
            return None
        k, f = bt
        a = self._frame(k, lat, lon)
        b = self._frame(k + 1, lat, lon)
        if a is None or b is None:
            return a if b is None and f < 0.5 else (b if a is None and f >= 0.5 else None)
        return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f


def fetch_erddap_patch(model, lat, lon, t0, t1, half_deg=0.05, fetch=fetch_json):
    """A window of `model` round (lat, lon) over [t0, t1], one request. ERDDAP griddap index-value syntax; the reply's
    rows are (time, depth, latitude, longitude, u, v). Raises on a network or format failure - the caller says why."""
    la0, la1 = max(model["lat"][0], lat - half_deg), min(model["lat"][1], lat + half_deg)
    lo0, lo1 = max(model["lon"][0], lon - half_deg), min(model["lon"][1], lon + half_deg)
    ts = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
    sl = "[(%s):(%s)][(%s)][(%.5f):(%.5f)][(%.5f):(%.5f)]" % (ts(t0), ts(t1), model["depth"], la0, la1, lo0, lo1)
    q = "u" + sl + ",v" + sl
    url = model["url"] + ".json?" + urllib.parse.quote(q, safe="(),:=")
    payload = fetch(url)
    table = payload["table"]
    cols = table["columnNames"]
    it, iy, ix = cols.index("time"), cols.index("latitude"), cols.index("longitude")
    iu, iv = cols.index("u"), cols.index("v")
    rows = table["rows"]
    times = sorted({r[it] for r in rows})
    lats = sorted({r[iy] for r in rows})
    lons = sorted({r[ix] for r in rows})
    ti = {t: k for k, t in enumerate(times)}
    yi = {y: k for k, y in enumerate(lats)}
    xi = {x: k for k, x in enumerate(lons)}
    U = [[[None] * len(lons) for _ in lats] for _ in times]
    V = [[[None] * len(lons) for _ in lats] for _ in times]
    for r in rows:
        k, y, x = ti[r[it]], yi[r[iy]], xi[r[ix]]
        U[k][y][x] = r[iu] if isinstance(r[iu], (int, float)) else None
        V[k][y][x] = r[iv] if isinstance(r[iv], (int, float)) else None
    import calendar
    tsec = [calendar.timegm(time.strptime(t, "%Y-%m-%dT%H:%M:%SZ")) for t in times]
    return GridPatch(lats, lons, tsec, U, V, label=model["label"], key=model["key"], fetched=time.time())


# --------------------------------------------------------------------------- #
#  3. Calibration of a model against stations, and the fusion
# --------------------------------------------------------------------------- #
def calibrate(model_uv, tab, t0, t1, step_s=1800):
    """Fit `model_uv(lat, lon, t) -> (u, v) | None` to one station's predictions over [t0, t1]: the time LAG and GAIN
    that make gain * model(t + lag), projected on the station's axis, best match the prediction. Returns
    {gain, lag_s, r, n, rms_raw_kn, rms_kn} or None where the model has no water there, too little overlap, or the fit
    is not a fit (correlation under CAL_MIN_R, gain outside CAL_GAIN_RANGE)."""
    if tab.flood_deg is None or tab.ebb_deg is None:
        return None
    # the axis: flood direction, with ebb read as its negative (the two are not exactly opposite; the flood axis is the
    # reference the signed prediction is measured on)
    ax = math.radians(tab.flood_deg)
    ex, ey = math.sin(ax), math.cos(ax)
    pts = []
    t = max(t0, tab.t0)
    end = min(t1, tab.t1)
    while t <= end:
        p = tab.major_at(t)
        if p is not None:
            pts.append((t, p))
        t += step_s
    if len(pts) < CAL_MIN_SAMPLES:
        return None
    # no model water at the station at all: nothing to fit, and no reason to walk every lag finding that out
    if all(model_uv(tab.lat, tab.lon, t) is None for t, _ in pts[::max(1, len(pts) // 6)]):
        return None
    best = None
    for lag in CAL_LAGS_S:
        mm, pp = [], []
        for t, p in pts:
            uv = model_uv(tab.lat, tab.lon, t + lag)
            if uv is None:
                continue
            mm.append((uv[0] * ex + uv[1] * ey) / KN)
            pp.append(p)
        if len(mm) < CAL_MIN_SAMPLES:
            continue
        smm = sum(m * m for m in mm)
        if smm <= 1e-9:
            continue
        g = sum(m * p for m, p in zip(mm, pp)) / smm
        rms = math.sqrt(sum((g * m - p) ** 2 for m, p in zip(mm, pp)) / len(mm))
        if best is None or rms < best[0]:
            best = (rms, lag, g, mm, pp)
    if best is None:
        return None
    rms, lag, g, mm, pp = best
    n = len(mm)
    mbar, pbar = sum(mm) / n, sum(pp) / n
    cov = sum((m - mbar) * (p - pbar) for m, p in zip(mm, pp))
    vm = math.sqrt(sum((m - mbar) ** 2 for m in mm))
    vp = math.sqrt(sum((p - pbar) ** 2 for p in pp))
    r = cov / (vm * vp) if vm > 1e-9 and vp > 1e-9 else 0.0
    raw = []
    for t, p in pts:
        uv = model_uv(tab.lat, tab.lon, t)
        if uv is not None:
            raw.append(((uv[0] * ex + uv[1] * ey) / KN - p) ** 2)
    rms_raw = math.sqrt(sum(raw) / len(raw)) if raw else None
    if r < CAL_MIN_R or not (CAL_GAIN_RANGE[0] <= g <= CAL_GAIN_RANGE[1]):
        return None
    return {"gain": round(g, 3), "lag_s": lag, "r": round(r, 3), "n": n,
            "rms_raw_kn": round(rms_raw, 3) if rms_raw is not None else None, "rms_kn": round(rms, 3)}


def calibrate_all(model_uv, tables, t0, t1):
    out = {}
    for tab in tables or ():
        c = calibrate(model_uv, tab, t0, t1)
        if c is not None:
            out[tab.id] = dict(c, lat=tab.lat, lon=tab.lon, name=tab.name)
    return out


def calibration_at(cals, lat, lon, reach_m=CAL_REACH_M):
    """The gain and lag to apply to the model at (lat, lon): inverse-distance-squared over the calibrated stations
    within `reach_m`; (1.0, 0) where none is. Returns (gain, lag_s, n_used)."""
    acc = []
    for c in (cals or {}).values():
        d = dist_m(lat, lon, c["lat"], c["lon"])
        if d <= reach_m:
            acc.append((1.0 / (d * d + 250.0 ** 2), c["gain"], c["lag_s"]))
    if not acc:
        return 1.0, 0, 0
    sw = sum(a[0] for a in acc)
    return (sum(a[0] * a[1] for a in acc) / sw, sum(a[0] * a[2] for a in acc) / sw, len(acc))


def fuse(lat, lon, t, tables=(), model_uv=None, cals=None, model_label=None):
    """THE STREAM AT (lat, lon, t). Returns None when no layer has a value, else
    {u, v, speed_kn, set_deg, source, w_stations, stations: [...], model: {...} | None}."""
    st = stations_field(tables, lat, lon, t)
    mod = None
    if model_uv is not None:
        g, lag, ncal = calibration_at(cals, lat, lon)
        uv = model_uv(lat, lon, t + lag)
        if uv is not None:
            mod = {"u": g * uv[0], "v": g * uv[1], "gain": round(g, 3), "lag_s": round(lag), "calibrated_by": ncal,
                   "label": model_label}
    if st is None and mod is None:
        return None
    if st is not None and mod is not None:
        w = math.exp(-st["near_m"] / BLEND_L_M)
    elif st is not None:
        w = 1.0
    else:
        w = 0.0
    u = w * (st["u"] if st else 0.0) + (1 - w) * (mod["u"] if mod else 0.0)
    v = w * (st["v"] if st else 0.0) + (1 - w) * (mod["v"] if mod else 0.0)
    kn, sd = speed_set(u, v)
    parts = []
    if st is not None and w > 0.005:
        parts.append("NOAA predictions")
    if mod is not None and w < 0.995:
        parts.append((model_label or "model") + (" calibrated" if mod["calibrated_by"] else ""))
    return {"u": u, "v": v, "speed_kn": kn, "set_deg": sd, "source": " + ".join(parts) or "NOAA predictions",
            "w_stations": round(w, 3), "stations": (st or {}).get("used", []),
            "near_station_m": round(st["near_m"]) if st else None, "model": mod}


# --------------------------------------------------------------------------- #
#  4. The sources, kept current on a background thread
# --------------------------------------------------------------------------- #
class StreamSources:
    """Holds the station tables, the model window and the calibrations round the boat, refreshed on ITS OWN THREAD.

    WHY ITS OWN THREAD. The console's current monitor recomputes its reading every minute and the simulator asks for the
    stream every tick; a station fetch takes seconds (26 stations round New Castle: ~7 s) and a PacIOOS window up to
    25 s. Neither may wait on the other, so this thread does all the networking and the readers take immutable
    references - a tuple of tables, one GridPatch, one dict of calibrations - swapped whole when new ones are ready.

    `model_provider()` returns (model_uv, label, key) for the OFS the monitor already holds, or (None, None, None); the
    calibration is redone when that key, the station tables or the model window change."""

    POLL_S = 900.0
    REFETCH_KM = 15.0
    PATCH_HALF_DEG = 0.05            # ~5.5 km each way: a boat at 14 kn crosses it in about 25 minutes
    PATCH_BACK_S = 12 * 3600         # a day's window round now: enough for the calibration (two tidal cycles)
    PATCH_AHEAD_S = 12 * 3600
    PATCH_MAX_AGE_S = 3 * 3600
    CAL_WINDOW_S = 12 * 3600

    def __init__(self, cache_dir, model_provider=None, fetch=fetch_json, start=True):
        self.stations = StationPredictions(cache_dir, fetch=fetch)
        self._fetch = fetch
        self._model_provider = model_provider
        self._patch = None
        self._patch_note = None
        self._cals = {}
        self._cal_key = None
        self._pos = None
        self._looked_at = None
        self.error = None
        self._force = threading.Event()
        self._stop = threading.Event()
        if start:
            threading.Thread(target=self._loop, daemon=True, name="stream-sources").start()

    # -- readers (any thread) ------------------------------------------------------
    def tables(self):
        return self.stations.tables()

    def patch(self):
        return self._patch

    def cals(self):
        return self._cals

    def status(self):
        """What the readout says about the sources, in words: why a layer is missing, never a bare dash."""
        notes = [n for n in (self.stations.last_note, self._patch_note) if n]
        return {"stations": len(self.tables()), "model_window": (self._patch.label if self._patch else None),
                "calibrated": len(self._cals), "note": "; ".join(notes) or None, "error": self.error}

    # -- the position, and when to look again -----------------------------------
    def update_position(self, lat, lon):
        old, self._pos = self._pos, (lat, lon)
        p = self._patch
        moved = old is None or self._looked_at is None or             dist_m(self._looked_at[0], self._looked_at[1], lat, lon) > self.REFETCH_KM * 1000.0
        left_window = p is not None and not p.covers(lat, lon, margin_cells=2)
        entered_model = p is None and erddap_model_for(lat, lon) is not None and self._patch_note is None
        if moved or left_window or entered_model:
            self._force.set()

    def refresh_now(self):
        self._force.set()

    def stop(self):
        self._stop.set()
        self._force.set()

    # -- the work (the sources thread, or a test calling it directly) --------------
    def run_once(self, lat, lon, now=None):
        now = time.time() if now is None else now
        self._looked_at = (lat, lon)
        self.stations.ensure(lat, lon)
        self._ensure_patch(lat, lon, now)
        self._recalibrate(now)

    def _ensure_patch(self, lat, lon, now):
        model = erddap_model_for(lat, lon)
        if model is None:
            self._patch, self._patch_note = None, None
            return
        p = self._patch
        if (p is not None and p.key == model["key"] and p.covers(lat, lon, now, margin_cells=2)
                and now - (p.fetched or 0) < self.PATCH_MAX_AGE_S):
            return
        try:
            self._patch = fetch_erddap_patch(model, lat, lon, now - self.PATCH_BACK_S, now + self.PATCH_AHEAD_S,
                                             half_deg=self.PATCH_HALF_DEG, fetch=self._fetch)
            self._patch_note = None
        except Exception as e:
            # the old window stands if it still covers her; otherwise the model layer is simply absent, and SAID
            if p is not None and not p.covers(lat, lon, now):
                self._patch = None
            self._patch_note = "%s unreachable (%s)" % (model["label"], type(e).__name__)

    def _recalibrate(self, now):
        uv, label, key = (self._model_provider() if self._model_provider else (None, None, None))
        if uv is None and self._patch is not None:
            uv, label, key = self._patch.at, self._patch.label, ("patch", self._patch.key, self._patch.fetched)
        tabs = self.tables()
        ck = (key, tuple((t.id, t.t1) for t in tabs))
        if ck == self._cal_key:
            return
        self._cals = calibrate_all(uv, tabs, now - self.CAL_WINDOW_S, now + self.CAL_WINDOW_S) if uv else {}
        self._cal_key = ck

    def _loop(self):
        while not self._stop.is_set():
            pos = self._pos
            if pos is not None:
                try:
                    self.run_once(pos[0], pos[1])
                    self.error = None
                except Exception as e:               # the thread must outlive any surprise, and say what it was
                    self.error = "%s: %s" % (type(e).__name__, str(e)[:120])
            if self._force.wait(self.POLL_S):
                self._force.clear()
