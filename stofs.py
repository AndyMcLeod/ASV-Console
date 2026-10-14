"""stofs.py - NOAA STOFS-3D's water level forecast at the tide gauges, so a passage is planned on the LOWER of it and the
tide prediction.

Andy, 2026-10-13, of https://ccrm.vims.edu/schismweb/: "review this model for added utility ... Prioritize robustness
and code reliability over speed", then "approve 1, 1b, 2 and 6". SCHISM is a modeling code; the forecast built on it is
NOAA's Surge and Tide Operational Forecast System, STOFS-3D (Atlantic and Pacific), run once a day at 12 UTC and
published to NOAA's open-data bucket about six hours later. Its STATION file - classic netCDF, ~16 MB, the same sites as
NOAA's tide gauges - carries the combined water level (tide + surge + river) hourly for 96 hours ahead (`fcast`) and the
24 hours before the cycle (`ncast`).

WHY (measured 2026-10-13 against the gauges' own observations over the 12 hours both covered): the tide predictions the
console plans a passage on missed the water by 0.275 m RMS at Lewes and 0.351 m at Portland; STOFS, tied to the gauge by
one constant, by 0.036 m and 0.216 m. Over the next 84 hours it ran 0.22-0.30 m BELOW the predictions at times, and
predictions alone would have planned on that much water she would not have.

WHAT IT DOES, AND ONLY THIS
  1  (item 1) for each tide station a passage's water window reads, STOFS's level minus the station's prediction - its
     SURGE, averaged over one tide (surge(): the tide's timing in a model and in a prediction differ by minutes, which
     on a steep tide alone reads as tenths of a meter) - and the prediction LOWERED by the negative part of it
     (lower_by_surge). Never raised: a positive surge is left out, so the planning water is today's or lower.
  1b each gauge's STOFS series is put on the station's own datum by its OBSERVATIONS over the hours both cover (one
     constant: the vertical datum difference and the model's mean bias together); where the gauge has too few
     observations - it is down - by NOAA's published NAVD88 offset for the station (STOFS writes NAVD88: measured at
     Lewes, 0.80 m against observations, NOAA's NAVD88-MLLW 0.801 m, its MSL-MLLW 0.68 m). A fit worse than
     FIT_MAX_RMS_M, or one that disagrees with NOAA's datums by more than AGREE_M, is not used at all.
  1c (Andy approved it the same evening) a station STOFS has no point at BORROWS the surge of the nearest point within
     BORROW_KM (surge_borrowed: at New Castle the console's station is Seavey Island, Fort Point's point is 2.6 km off),
     worked out at THAT point's gauge against its own prediction - a surge is smooth over a few km, a tide is not, so
     two stations' tides are never compared. A station STOFS does stand at keeps its own answer.
  2  (item 2) the surge outlook at the boat's own station for the card.
Everything here returns None with a reason rather than raising, and a station with no STOFS answer plans on its
prediction exactly as before.

RELIABILITY (item 6): the station file is read by a small classic-netCDF reader that checks every offset against the
file and refuses anything it was not written for (CdfError, in words). Files are fetched ONLY by this module's own thread
(start()), written to the cache whole (a temp file renamed in), and kept two cycles; nothing in a request waits on a
download. A cycle older than MAX_CYCLE_AGE_S is not used. Standard library only, like the rest of the console.

CONVENTIONS: epoch seconds UTC; meters; a level is above the station's datum (MLLW at sea), as the console's water level.
"""

import calendar
import math
import os
import re
import struct
import threading
import time
import urllib.error
import urllib.request

BUCKET = "https://noaa-nos-stofs3d-pds.s3.amazonaws.com/"
# The two forecast domains, and the box each is asked for in (west, south, east, north). The box only decides which
# file to read; a station is used only where a STOFS point stands at a gauge (match).
REGIONS = {
    "atl": {"prefix": "STOFS-3D-Atl/stofs_3d_atl", "box": (-99.0, 5.0, -52.0, 52.0)},
    "pac": {"prefix": "STOFS-3D-Pac/stofs_3d_pac", "box": (-170.0, 15.0, -110.0, 62.0)},
}
KINDS = ("fcast", "ncast")              # the 96 h forecast (required) and the 24 h before the cycle (for the fit)
CYCLE_HOUR = 12                         # the one daily cycle
PUBLISH_DELAY_S = 5 * 3600              # a cycle is looked for this long after its hour (it appeared ~6 h after)
MAX_CYCLE_AGE_S = 36 * 3600             # a cycle older than this is not used
MAX_FILE_BYTES = 64 << 20               # a station file is ~16 MB; anything far larger is not one
FETCH_TIMEOUT_S = 120.0
RECHECK_S = 3600.0                      # how often the thread looks for a newer cycle
MATCH_KM = 2.0                          # a STOFS point within this of the gauge it is named for
FIT_MIN_HOURS = 6                       # observed hours needed to tie a series to its gauge
FIT_MAX_RMS_M = 0.30                    # ... and how well it must track them once tied
AGREE_M = 0.25                          # an observed tie and NOAA's datum offset must agree within this
ANCHOR_TTL_S = 3600.0                   # a station's tie is worked out again after this
DATUMS_TTL_S = 30 * 86400.0             # NOAA's datums for a station, kept this long
MAX_ABS_LEVEL_M = 50.0                  # a level beyond this is not a level (a fill value)
SURGE_MEAN_H = 13                       # the surge is averaged over this many hours - one tide (surge())
SURGE_MEAN_MIN = 7                      # ... an hour with fewer of them in its window has no surge
BORROW_KM = 5.0                         # a gauge STOFS has no point at takes the surge of the nearest point within this
                                        # (surge_borrowed). Measured on the 2026-10-13 Atlantic cycle against the console's
                                        # 168 tidal Atlantic stations: 25 have no point of their own; 5 have one within
                                        # 3.7 km (Seavey Island 2.6 km from Fort Point's), the next is 10.7 km
UA = {"User-Agent": "ASV-Console/1.0"}


class CdfError(ValueError):
    """A file this reader was not written for, or one that is not what it should be."""


# --------------------------------------------------------------------------- #
#  The classic-netCDF station file
# --------------------------------------------------------------------------- #
_NC_DIMENSION, _NC_VARIABLE, _NC_ATTRIBUTE = 0x0A, 0x0B, 0x0C
_TYPES = {1: ("b", 1), 2: ("c", 1), 3: ("h", 2), 4: ("i", 4), 5: ("f", 4), 6: ("d", 8)}


class _Header:
    """A cursor over the header that refuses to read past the end."""

    def __init__(self, b):
        self.b, self.p = b, 0

    def take(self, n):
        if n < 0 or self.p + n > len(self.b):
            raise CdfError("the header runs past the end of the file (at byte %d)" % self.p)
        out = self.b[self.p:self.p + n]
        self.p += n
        return out

    def u32(self):
        return struct.unpack(">I", self.take(4))[0]

    def u64(self):
        return struct.unpack(">Q", self.take(8))[0]

    def name(self):
        n = self.u32()
        if n > 1024:
            raise CdfError("a name %d bytes long" % n)
        s = self.take(n).decode("utf-8", "replace")
        self.take((4 - n % 4) % 4)
        return s

    def values(self, t, n):
        if t not in _TYPES:
            raise CdfError("an attribute of unknown type %d" % t)
        code, size = _TYPES[t]
        if n > (1 << 24):
            raise CdfError("an attribute %d values long" % n)
        raw = self.take(n * size)
        self.take((4 - (n * size) % 4) % 4)
        if t == 2:
            return raw.split(b"\0")[0].decode("utf-8", "replace")
        return list(struct.unpack(">" + code * n, raw))

    def listing(self, want):
        tag, n = self.u32(), self.u32()
        if tag == 0 and n == 0:
            return 0
        if tag != want:
            raise CdfError("expected list tag %#x, found %#x" % (want, tag))
        if n > 4096:
            raise CdfError("a list of %d entries" % n)
        return n

    def attrs(self):
        out = {}
        for _ in range(self.listing(_NC_ATTRIBUTE)):
            k = self.name()
            t, n = self.u32(), self.u32()
            out[k] = self.values(t, n)
        return out


_TIME_UNITS = re.compile(r"^\s*(seconds|minutes|hours)\s+since\s+(\d{4})-(\d{1,2})-(\d{1,2})"
                         r"(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(?:UTC|Z|GMT)?\s*$")


def time_units_epoch(units):
    """'seconds since 2026-10-12 12:00:00 UTC' -> (scale to seconds, epoch of the origin); CdfError otherwise."""
    m = _TIME_UNITS.match(str(units or ""))
    if not m:
        raise CdfError("time units this reader does not read: %r" % units)
    scale = {"seconds": 1.0, "minutes": 60.0, "hours": 3600.0}[m.group(1)]
    y, mo, d = int(m.group(2)), int(m.group(3)), int(m.group(4))
    hh, mi, ss = int(m.group(5) or 0), int(m.group(6) or 0), int(m.group(7) or 0)
    return scale, float(calendar.timegm((y, mo, d, hh, mi, ss, 0, 0, 0)))


class StationFile:
    """One STOFS station file, read: `names`, `lat`, `lon` (degrees, -180..180), `times` (epoch) and the water level at
    each station (`level(k)` -> [(epoch, m or None)])."""

    def __init__(self, names, lat, lon, times, zeta):
        self.names, self.lat, self.lon, self.times, self._zeta = names, lat, lon, times, zeta

    def level(self, k):
        return [(t, row[k]) for t, row in zip(self.times, self._zeta)]

    def find(self, sid, lat, lon, max_km=MATCH_KM):
        """The index of the STOFS point standing at gauge `sid` (at lat, lon): its name the first digits of the gauge's id,
        within max_km of it - or None."""
        sid = str(sid or "").strip()
        best = None
        for k, n in enumerate(self.names):
            if not n or not n.isdigit() or len(n) < 6 or not sid.startswith(n):
                continue
            d = km(lat, lon, self.lat[k], self.lon[k])
            if d <= max_km and (best is None or d < best[0]):
                best = (d, k)
        return best[1] if best else None

    def nearest(self, lat, lon, max_km):
        """The STOFS point nearest (lat, lon) whatever its name, within max_km: (km, index) or None."""
        best = None
        for k, n in enumerate(self.names):
            if not n or not n.isdigit() or len(n) < 6:
                continue
            d = km(lat, lon, self.lat[k], self.lon[k])
            if d <= max_km and (best is None or d < best[0]):
                best = (d, k)
        return best


def read_station_file(blob):
    """The STOFS station file in `blob` (bytes) -> StationFile. Raises CdfError, in words, for anything else."""
    if len(blob) > MAX_FILE_BYTES:
        raise CdfError("%d bytes - larger than any station file" % len(blob))
    if len(blob) < 32 or blob[:3] != b"CDF" or blob[3] not in (1, 2):
        raise CdfError("not a classic netCDF file (it starts %r)" % bytes(blob[:4]))
    h = _Header(blob)
    h.take(4)
    numrecs = h.u32()
    if numrecs == 0xFFFFFFFF:
        raise CdfError("a file still being written (streaming record count)")
    dims = []
    for _ in range(h.listing(_NC_DIMENSION)):
        dims.append((h.name(), h.u32()))
    h.attrs()
    var = {}
    for _ in range(h.listing(_NC_VARIABLE)):
        vn = h.name()
        nd = h.u32()
        if nd > 8:
            raise CdfError("variable %s with %d dimensions" % (vn, nd))
        di = [h.u32() for _ in range(nd)]
        if any(i >= len(dims) for i in di):
            raise CdfError("variable %s names a dimension that does not exist" % vn)
        va = h.attrs()
        t, vsize = h.u32(), h.u32()
        begin = h.u64() if blob[3] == 2 else h.u32()
        if t not in _TYPES:
            raise CdfError("variable %s of unknown type %d" % (vn, t))
        var[vn] = {"dims": di, "atts": va, "type": t, "vsize": vsize, "begin": begin}
    rec = [i for i, (_n, ln) in enumerate(dims) if ln == 0]
    if len(rec) > 1:
        raise CdfError("more than one record dimension")
    recvars = [v for v in var.values() if v["dims"] and rec and v["dims"][0] == rec[0]]
    if len(recvars) == 1:                          # the one case where a record is not padded
        v = recvars[0]
        recsize = _TYPES[v["type"]][1]
        for i in v["dims"][1:]:
            recsize *= dims[i][1]
    else:
        recsize = sum(v["vsize"] for v in recvars)

    def need(vn, dimnames, types):
        v = var.get(vn)
        if v is None:
            raise CdfError("no variable %s" % vn)
        got = [dims[i][0] for i in v["dims"]]
        if got != dimnames:
            raise CdfError("%s is %s, not %s" % (vn, got, dimnames))
        if v["type"] not in types:
            raise CdfError("%s is of type %d" % (vn, v["type"]))
        return v

    def read_fixed(v, n):
        code, size = _TYPES[v["type"]]
        a, z = v["begin"], v["begin"] + n * size
        if a < h.p or z > len(blob):
            raise CdfError("variable data outside the file")
        if v["type"] == 2:
            return blob[a:z]
        return struct.unpack(">" + code * n, blob[a:z])

    def read_records(v, per):
        code, size = _TYPES[v["type"]]
        last = v["begin"] + (numrecs - 1) * recsize + per * size if numrecs else v["begin"]
        if v["begin"] < h.p or last > len(blob):
            raise CdfError("record data outside the file")
        return [struct.unpack(">" + code * per, blob[v["begin"] + r * recsize: v["begin"] + r * recsize + per * size])
                for r in range(numrecs)]

    dn = {n: ln for n, ln in dims}
    tname = dims[rec[0]][0] if rec else None
    if tname is None or "station" not in dn:
        raise CdfError("no record (time) dimension or no station dimension")
    nst = dn["station"]
    if not 0 < nst <= 5000 or not 0 < numrecs <= 2000:
        raise CdfError("%d stations, %d times" % (nst, numrecs))
    sname = var.get("station_name")
    if sname is None or len(sname["dims"]) != 2 or dims[sname["dims"][0]][0] != "station" or sname["type"] != 2:
        raise CdfError("station_name is not station x characters")
    nl = dims[sname["dims"][1]][1]
    if not 0 < nl <= 256:
        raise CdfError("station names %d characters long" % nl)
    raw = read_fixed(sname, nst * nl)
    names = [raw[i * nl:(i + 1) * nl].split(b"\0")[0].decode("utf-8", "replace").strip() for i in range(nst)]
    lat = list(read_fixed(need("lat", ["station"], (5, 6)), nst))
    lon = [((x + 180.0) % 360.0) - 180.0 for x in read_fixed(need("lon", ["station"], (5, 6)), nst)]
    tv = need("time", [tname], (4, 5, 6))
    scale, origin = time_units_epoch(tv["atts"].get("units"))
    times = [origin + row[0] * scale for row in read_records(tv, 1)]
    if any(not math.isfinite(t) for t in times) or any(b <= a for a, b in zip(times, times[1:])):
        raise CdfError("the times are not finite and increasing")
    zv = need("zeta", [tname, "station"], (5, 6))
    if str(zv["atts"].get("units", "")).strip() not in ("m", "meters", "meter", "metre", "metres"):
        raise CdfError("zeta in %r, not meters" % zv["atts"].get("units"))
    fill = zv["atts"].get("_FillValue")
    fill = fill[0] if isinstance(fill, list) and fill else None
    zeta = [[None if (not math.isfinite(z) or abs(z) > MAX_ABS_LEVEL_M or (fill is not None and z == fill)) else z
             for z in row] for row in read_records(zv, nst)]
    return StationFile(names, [float(x) for x in lat], lon, times, zeta)


# --------------------------------------------------------------------------- #
#  Surge and the planning level
# --------------------------------------------------------------------------- #
def km(lat1, lon1, lat2, lon2):
    p = math.pi / 180.0
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(a)))


def tie(series, obs, datum_offset=None):
    """The constant that puts a STOFS series on the gauge's datum: {offset, how, rms, n} or {note}.
    `series` [(epoch, m or None)], `obs` {epoch: m} at whole hours, `datum_offset` NOAA's (NAVD88 - datum) or None."""
    pairs = [(obs[t] - z) for t, z in series if z is not None and t in obs]
    if len(pairs) >= FIT_MIN_HOURS:
        off = sum(pairs) / len(pairs)
        rms = math.sqrt(sum((x - off) ** 2 for x in pairs) / len(pairs))
        if rms > FIT_MAX_RMS_M:
            return {"note": "STOFS tracks the gauge to %.2f m - more than %.2f m" % (rms, FIT_MAX_RMS_M)}
        if datum_offset is not None and abs(off - datum_offset) > AGREE_M:
            return {"note": "tied to the gauge at %+.2f m, %.2f m from NOAA's datums" % (off, abs(off - datum_offset))}
        return {"offset": off, "how": "observed", "rms": rms, "n": len(pairs)}
    if datum_offset is not None:
        return {"offset": datum_offset, "how": "datum", "rms": None, "n": len(pairs)}
    return {"note": "%d observed hours and no NOAA datums to tie it by" % len(pairs)}


def surge(series, offset, pred):
    """STOFS (tied by `offset`) minus the prediction, AVERAGED OVER ONE TIDE: [(epoch, m)] at each hour both have whose
    SURGE_MEAN_H window holds SURGE_MEAN_MIN of them. `pred` {epoch: m}.

    ⚠ THE AVERAGE IS THE POINT. A model's tide and the gauge's prediction differ in TIME by minutes, and on a steep tide
    that reads as a surge of a few tenths, one way on the flood and the other on the ebb: at Fort Point, 2026-10-14
    02:00 UTC, -0.28 m between +0.33 m and +0.19 m an hour either side, on a tide rising 0.3 m in half an hour. A surge -
    wind and pressure - changes over hours; a running mean over one tide takes the timing out and keeps it (that evening
    +0.20 to +0.41 m there, +0.19 to +0.31 m at Lewes, whose gauge read 0.27 m over its prediction)."""
    raw = {t: z + offset - pred[t] for t, z in series if z is not None and t in pred}
    half = SURGE_MEAN_H // 2
    out = []
    for t in sorted(raw):
        w = [raw[t + k * 3600] for k in range(-half, half + 1) if t + k * 3600 in raw]
        if len(w) >= SURGE_MEAN_MIN:
            out.append((t, sum(w) / len(w)))
    return out


def lower_by_surge(pred_series, sg):
    """The prediction [(epoch, m)] lowered by the NEGATIVE surge `sg` [(epoch, m)] - linearly between its hours, and
    only between its first and last - and left as it is everywhere else. Never above the prediction."""
    if len(sg) < 2:
        return list(pred_series)
    ts = [t for t, _v in sg]
    out = []
    j = 0
    for e, v in pred_series:
        if e < ts[0] or e > ts[-1]:
            out.append((e, v))
            continue
        while j < len(ts) - 2 and ts[j + 1] < e:
            j += 1
        (t0, s0), (t1, s1) = sg[j], sg[j + 1]
        s = s0 if t1 == t0 else s0 + (s1 - s0) * (e - t0) / (t1 - t0)
        out.append((e, v + min(0.0, s)))
    return out


def region_of(lat, lon):
    for name, r in REGIONS.items():
        w, s, e, n = r["box"]
        if w <= lon <= e and s <= lat <= n:
            return name
    return None


# --------------------------------------------------------------------------- #
#  The forecast, kept
# --------------------------------------------------------------------------- #
def _http_get(url, timeout=FETCH_TIMEOUT_S, limit=MAX_FILE_BYTES):
    """The body at `url` (bytes), None when it is not there (404/403), raises on anything else."""
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            n = r.headers.get("Content-Length")
            if n is not None and int(n) > limit:
                raise CdfError("%s is %s bytes" % (url, n))
            body = r.read(limit + 1)
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return None
        raise
    if len(body) > limit:
        raise CdfError("%s is larger than %d bytes" % (url, limit))
    return body


class Stofs:
    """The newest STOFS-3D cycle for the domain the boat is in, read and kept (`cache_dir`), and each tide station tied
    to its gauge. INERT until start(): nothing is fetched or read from disk until the console starts the thread and a
    position wants a domain (wants). Every reader takes only what is already held - none waits on a download."""

    def __init__(self, cache_dir, fetch=_http_get, now=time.time):
        self.cache_dir, self._fetch, self._now = cache_dir, fetch, now
        self._lock = threading.Lock()
        self._held = {}                  # region -> {"cycle": "YYYYMMDD", "t": epoch, "fcast": SF, "ncast": SF or None}
        self._notes = {}                 # region -> why it has nothing, or the last refusal
        self._want = set()
        self._ties = {}                  # (sid, datum, cycle) -> (at, tie dict)
        self._datums = {}                # sid -> (at, {name: m} or None)
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread = None
        self.on_new = None               # called (no arguments) when a newer cycle is held - the console's water pass

    # -- the thread ------------------------------------------------------------
    def start(self):
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="stofs", daemon=True)
            self._thread.start()

    def stop(self):
        self._stop.set()
        self._wake.set()

    def wants(self, lat, lon):
        """A position: its domain is fetched (by the thread) and kept current."""
        r = region_of(lat, lon)
        if r is None:
            return
        with self._lock:
            new = r not in self._want
            self._want.add(r)
        if new:
            self._wake.set()

    def _loop(self):
        while not self._stop.is_set():
            with self._lock:
                regions = sorted(self._want)
            for r in regions:
                try:
                    self.refresh(r)
                except Exception as e:           # noqa: BLE001 - said, kept, and tried again next pass
                    with self._lock:
                        self._notes[r] = "the last look failed: %s: %s" % (type(e).__name__, e)
            self._wake.wait(RECHECK_S)
            self._wake.clear()

    # -- cycles ------------------------------------------------------------------
    def _paths(self, r, cycle, kind):
        return os.path.join(self.cache_dir, "%s_%s_t%02dz_%s.nc" % (r, cycle, CYCLE_HOUR, kind))

    def _key(self, r, cycle, kind):
        pre = REGIONS[r]["prefix"]
        return "%s%s.%s/%s.t%02dz.%s.station.profile.nc" % (BUCKET, pre, cycle, pre.split("/")[-1], CYCLE_HOUR, kind)

    def candidates(self, now=None):
        """The cycles that could be out, newest first: ("YYYYMMDD", epoch of its hour)."""
        now = self._now() if now is None else now
        day = int(now // 86400) * 86400
        out = []
        for back in range(0, 3):
            t = day - back * 86400 + CYCLE_HOUR * 3600
            if now >= t + PUBLISH_DELAY_S and now - t <= MAX_CYCLE_AGE_S:
                out.append((time.strftime("%Y%m%d", time.gmtime(t)), t))
        return out

    def refresh(self, r, now=None):
        """Hold the newest cycle of domain `r`: from the cache when it is there, else fetched. True when a cycle is held."""
        now = self._now() if now is None else now
        with self._lock:
            held = self._held.get(r)
        cands = self.candidates(now)
        for cycle, t in cands:
            if held and held["cycle"] == cycle:
                return True                       # the newest that could be out is the one held
            got = self._load(r, cycle) or self._download(r, cycle)
            if got is None:
                continue
            fc, nc = got
            with self._lock:
                self._held[r] = {"cycle": cycle, "t": t, "fcast": fc, "ncast": nc}
                self._notes.pop(r, None)
            self._prune(r, cycle)
            if self.on_new is not None:
                try:
                    self.on_new()
                except Exception:                    # noqa: BLE001 - a listener's fault is not the forecast's
                    pass
            return True
        if not cands:
            with self._lock:
                self._notes[r] = "no cycle young enough to use"
        elif held is None:
            with self._lock:
                self._notes.setdefault(r, "no cycle found on NOAA's bucket")
        return held is not None

    def _load(self, r, cycle):
        try:
            with open(self._paths(r, cycle, "fcast"), "rb") as f:
                fc = read_station_file(f.read())
        except (OSError, CdfError):
            return None
        nc = None
        try:
            with open(self._paths(r, cycle, "ncast"), "rb") as f:
                nc = read_station_file(f.read())
        except (OSError, CdfError):
            pass
        return fc, nc

    def _download(self, r, cycle):
        body = self._fetch(self._key(r, cycle, "fcast"))
        if body is None:
            return None
        try:
            fc = read_station_file(body)
        except CdfError as e:
            with self._lock:
                self._notes[r] = "the %s forecast was refused: %s" % (cycle, e)
            return None
        self._write(self._paths(r, cycle, "fcast"), body)
        nc = None
        try:
            nb = self._fetch(self._key(r, cycle, "ncast"))
            if nb is not None:
                nc = read_station_file(nb)
                self._write(self._paths(r, cycle, "ncast"), nb)
        except (CdfError, OSError) as e:
            with self._lock:
                self._notes[r + ":ncast"] = "the %s nowcast was not read: %s" % (cycle, e)
        return fc, nc

    def _write(self, path, body):
        """Whole or not at all: a temp file of this thread's own, renamed in."""
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = "%s.%d.%d.part" % (path, os.getpid(), threading.get_ident())
            with open(tmp, "wb") as f:
                f.write(body)
            os.replace(tmp, path)
        except OSError:
            pass                                 # held in memory all the same; the next start fetches it again

    def _prune(self, r, keep):
        """This domain's cached cycles but the newest two."""
        try:
            files = sorted(f for f in os.listdir(self.cache_dir) if f.startswith(r + "_") and f.endswith(".nc"))
        except OSError:
            return
        cycles = sorted({f.split("_")[1] for f in files}, reverse=True)
        for c in cycles[2:]:
            for f in files:
                if f.split("_")[1] == c:
                    try:
                        os.remove(os.path.join(self.cache_dir, f))
                    except OSError:
                        pass

    # -- readers -----------------------------------------------------------------
    def held(self, lat, lon, now=None):
        """The cycle held for (lat, lon)'s domain, young enough to use: (held dict, None) or (None, why not)."""
        now = self._now() if now is None else now
        r = region_of(lat, lon)
        if r is None:
            return None, "outside STOFS-3D's domains"
        with self._lock:
            h, note = self._held.get(r), self._notes.get(r)
        if h is None:
            return None, note or "the STOFS forecast is not loaded yet"
        if now - h["t"] > MAX_CYCLE_AGE_S:
            return None, "the STOFS cycle held (%s) is %.0f h old" % (h["cycle"], (now - h["t"]) / 3600)
        return h, None

    def series(self, sid, lat, lon, now=None):
        """Gauge `sid`'s STOFS level, the nowcast before the forecast: ([(epoch, m or None)], held) or (None, why not)."""
        h, why = self.held(lat, lon, now)
        if h is None:
            return None, why
        k = h["fcast"].find(sid, lat, lon)
        if k is None:
            return None, "no STOFS point at %s" % sid
        out = dict(h["fcast"].level(k))
        if h["ncast"] is not None:
            kn = h["ncast"].find(sid, lat, lon)
            if kn is not None:
                for t, z in h["ncast"].level(kn):
                    out.setdefault(t, z)
        return sorted(out.items()), h

    def datums(self, sid, fetch_datums):
        now = self._now()
        with self._lock:
            hit = self._datums.get(sid)
        if hit and now - hit[0] < (DATUMS_TTL_S if hit[1] is not None else 600):
            return hit[1]
        try:
            d = fetch_datums(sid)
        except Exception:                        # noqa: BLE001 - no datums is an answer, not a failure
            d = None
        with self._lock:
            self._datums[sid] = (now, d)
        return d

    def tie_for(self, sid, datum, lat, lon, fetch_obs, fetch_datums, now=None):
        """Gauge `sid`'s tie on `datum` (tie()), kept ANCHOR_TTL_S per cycle: (tie, series, held) or (None, why, None)."""
        now = self._now() if now is None else now
        ser, h = self.series(sid, lat, lon, now)
        if ser is None:
            return None, h, None
        key = (sid, datum, h["cycle"])
        with self._lock:
            hit = self._ties.get(key)
        if hit and now - hit[0] < ANCHOR_TTL_S:
            tdict = hit[1]
        else:
            obs = {}
            try:
                for t, v in fetch_obs(sid, datum, now - 26 * 3600, now) or []:
                    if t % 3600 == 0 and v is not None and math.isfinite(v):
                        obs[t] = v
            except Exception:                    # noqa: BLE001 - no observations: the datums may still tie it
                obs = {}
            d = self.datums(sid, fetch_datums)
            doff = (d["NAVD88"] - d[datum]) if d and d.get("NAVD88") is not None and d.get(datum) is not None else None
            tdict = tie(ser, obs, doff)
            with self._lock:
                if len(self._ties) > 2000:
                    self._ties.clear()
                self._ties[key] = (now, tdict)
        if "offset" not in tdict:
            return None, tdict.get("note"), None
        return tdict, ser, h

    def surge_at(self, sid, datum, lat, lon, pred_series, fetch_obs, fetch_datums, now=None):
        """Gauge `sid`'s surge against its prediction: ([(epoch, m)], info) or (None, why not)."""
        tdict, ser, h = self.tie_for(sid, datum, lat, lon, fetch_obs, fetch_datums, now)
        if tdict is None:
            return None, ser
        sg = surge(ser, tdict["offset"], dict(pred_series))
        if len(sg) < 2:
            return None, "the STOFS hours and the prediction do not overlap"
        return sg, {"cycle": h["cycle"], "age_h": round(((self._now() if now is None else now) - h["t"]) / 3600, 1),
                    "how": tdict["how"], "fit_m": None if tdict["rms"] is None else round(tdict["rms"], 3),
                    "offset_m": round(tdict["offset"], 3)}

    def surge_borrowed(self, sid, datum, lat, lon, pred_series, fetch_obs, fetch_datums, resolve, fetch_pred, now=None):
        """Gauge `sid`'s surge (surge_at) - or, where STOFS has NO point at it, the surge at the nearest point within
        BORROW_KM (Andy, 2026-10-13, approving it: near New Castle the console's station is Seavey Island, which STOFS
        has no point at, and Fort Point's is 2.6 km off). The borrowed surge is worked out at the OTHER gauge, against
        ITS OWN prediction and tie: a surge is smooth over a few km, a tide is not, so two stations' tides are never
        compared. A gauge STOFS does stand at keeps its own answer, whatever it is - a fit refused there is never
        replaced by a neighbor's. `resolve(name, lat, lon)` -> the NOAA gauge {id, name, lat, lng} a STOFS point stands
        at, or None; `fetch_pred(id, datum)` -> its predictions. ([(epoch, m)], info + from_id/from_name/from_km) or
        (None, why not)."""
        sg, meta = self.surge_at(sid, datum, lat, lon, pred_series, fetch_obs, fetch_datums, now)
        if sg is not None:
            return sg, meta
        h, _why = self.held(lat, lon, now)
        if h is None or h["fcast"].find(sid, lat, lon) is not None:
            return None, meta
        near = h["fcast"].nearest(lat, lon, BORROW_KM)
        if near is None:
            return None, "no STOFS point at %s or within %g km of it" % (sid, BORROW_KM)
        dkm, k = near
        name, plat, plon = h["fcast"].names[k], h["fcast"].lat[k], h["fcast"].lon[k]
        try:
            gauge = resolve(name, plat, plon)
        except Exception:                        # noqa: BLE001 - no gauge found is an answer: the prediction stands
            gauge = None
        if not gauge:
            return None, "STOFS point %s, %.1f km from %s, matches no NOAA tide station" % (name, dkm, sid)
        try:
            dpred = fetch_pred(gauge["id"], datum)
        except Exception:                        # noqa: BLE001 - as above
            dpred = None
        if not dpred:
            return None, "no predictions at %s, the STOFS point %.1f km from %s" % (gauge["id"], dkm, sid)
        sg, dmeta = self.surge_at(gauge["id"], datum, gauge["lat"], gauge["lng"], dpred, fetch_obs, fetch_datums, now)
        if sg is None:
            return None, "%s (borrowing for %s)" % (dmeta, sid)
        return sg, dict(dmeta, from_id=gauge["id"], from_name=gauge.get("name"), from_km=round(dkm, 1),
                        from_lat=gauge["lat"], from_lng=gauge["lng"])
