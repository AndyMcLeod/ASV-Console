# ============================================================================
# VENDORED from the Transit Calculator: D:\Claude\Transit\currents.py,
# which itself vendored it from the DriX Fuel Planner: D:\Claude\Fuel\currents.py
#
# WHY A COPY AND NOT AN IMPORT, again. Same reason it was copied the first time:
# those are separate repositories with their own release cadence, and this console
# is a single-file stdlib server with no pip and no build step. Reaching across the
# filesystem would make the console break when either of them is moved, renamed or
# checked out at another revision. currents.py is pure standard library, so a copy
# costs nothing at runtime.
#
# THE TRADE IS DRIFT, AND THIS HEADER IS HOW YOU SEE IT. This is now the THIRD copy
# in the chain (Fuel -> Transit -> ASV), so the drift risk is real and compounding.
# Before trusting a current here for anything that matters, diff it against both
# sources above. If the three ever need to move together, that is the moment to make
# it a package rather than a copy.
#
# Copied 2026-08-10 from the Transit revision carrying the multi-OFS grid fix (grid
# dimensions read from the dataset DDS rather than hard-coded to DBOFS's 487 x 529).
#
# UNMODIFIED from the Transit copy. The console does NOT vendor Transit's ofs.py
# (multi-model chaining): this reads ONE model, dbofs by default, because the console
# asks for a current at the VESSEL'S OWN POSITION rather than along a line that may
# cross a model boundary. `--currents-ofs` picks another model for a vessel working
# outside Delaware Bay. If a hull ever needs coverage spanning two models, ofs.py +
# geo.py are the next thing to vendor, not a rewrite of this.
# ============================================================================

"""Surface currents from a NOAA Operational Forecast System, interpolated to
any position and any time inside the model box.

Usage:
    python currents.py cycles                    # what NOAA has now
    python currents.py fetch                     # cache latest cycle
    python currents.py fetch --bbox 38.6,-75.4,39.1,-74.8
    python currents.py point --at 38.7828,-75.1394
    python currents.py point --at 38.78,-75.14 --time 2026-08-13T14:00Z
    python currents.py frame --time 2026-08-13T14:00Z --csv out.csv
    python currents.py track --csv legs.csv      # lat,lon,time rows
    python currents.py verify                    # rails, see below

The animation at tidesandcurrents.noaa.gov/ofs/ofs_mapplots.html draws one PNG
per hour — arrows already rasterised, no numbers behind them. This reads the
model output those pictures were drawn from, so a current can be asked for at a
position and time rather than eyeballed off a plot.

WHICH PRODUCT, AND WHY IT MATTERS
    NOAA publishes each OFS twice: the native ROMS `fields` (curvilinear grid,
    staggered u/v points, velocities in GRID axes needing rotation by `angle`)
    and `regulargrid` (rectilinear lat/lon, `u_eastward`/`v_northward` already
    true-referenced). This reads regulargrid. The native product would need
    staggered-point averaging and a per-cell rotation before a bearing meant
    anything, and getting either wrong turns a set 40 degrees without looking
    wrong. `crosscheck` reads the native fields the hard way and compares, so
    the shortcut is evidence rather than assumption.

CONVENTIONS
    Speed in knots. Set in degrees TRUE, and set is where the water GOES —
    the same convention as `Environment.current_set_deg` in the planner, and
    the opposite of the wind convention. All times are UTC.

WHAT INTERPOLATION IS DONE
    Bilinear in latitude/longitude between the four surrounding grid nodes,
    linear in time between the two bracketing hourly frames. Land nodes (mask
    0, or the -99999 fill) are dropped from the average and the remaining
    weights renormalised, so a query in a channel one cell wide leans on the
    water nodes rather than averaging in a zero from the bank. A query with no
    water node in reach returns None, never a zero — a zero current and no
    data are different answers.

Read-only against NOAA and against this repo. Nothing here writes model.json.
"""
import argparse
import dataclasses
import csv
import gzip
import json
import math
import re
import struct
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'ofs_cache'

THREDDS = 'https://opendap.co-ops.nos.noaa.gov/thredds'
MS_TO_KT = 1.9438444924406046
FILL = -99999.0
EPOCH = datetime(2016, 1, 1, tzinfo=timezone.utc)   # OFS `time` units, verified
SURFACE = 0            # Depth[0] == 0.0 m, checked by verify()
CYCLES = ('18z', '12z', '06z', '00z')               # newest first
TIMEOUT = 180

# Principal lunar semidiurnal period. The current in this estuary is
# semidiurnal, so this is the interval a projection borrows across when the
# forecast cannot reach a requested time.
M2_PERIOD_H = 12.4206

# How far a projection may reach, in whole cycles. MEASURED, not chosen: against
# this model's own 54 h output the RMS error of a projection is 0.19 kt at one
# cycle, 0.14 at two and 0.21 at three — flat, because the tide repeats rather
# than decays. It is capped here because the non-tidal part (wind setup, river
# flow) does NOT repeat, and beyond a day and a half of extrapolation there is
# no evidence in hand that it stays this good. Three cycles is 37.3 h.
MAX_PROJECT_CYCLES = 3

# A cycle's frames: `n` files run up to the cycle hour, `f` files after it. Used
# to work out what a REMOTE cycle would cover without downloading it.
NOWCAST_H = 6
FORECAST_H = 48

# What a projection is WORTH, measured rather than asserted. Each value is the
# RMS vector error in knots of substituting the value n whole M2 periods away,
# checked against this model's OWN output across points in the operating area.
#
# It lives here rather than in a document so no document can drift from it, and
# it carries its provenance for the same reason every model.json block does.
# Re-measure with `python tools/projection_accuracy.py` when a materially
# different cycle is cached; `cycle` records what these came from.
PROJECTION_ACCURACY = {
    'cycle': 'dbofs_20260813_t00z',
    'measured_utc': '2026-08-13',
    'samples': 258,
    'projected_rms_kt': {1: 0.19, 2: 0.14, 3: 0.21},
    'persistence_rms_kt': [0.57, 2.21],   # holding the last value, across points
    'slack_rms_kt': [0.36, 1.46],         # assuming no current at all
    'note': 'Flat out to three cycles because a tide repeats rather than decays. '
            'At the bay entrance, where it runs to 2.2 kt, a projection lands '
            'within 0.27 kt while persistence is wrong by the whole tide.',
}


# --------------------------------------------------------------------------- #
#  DAP2 — the minimum needed to pull a hyperslab out of a THREDDS server.
#  Tomcat rejects raw brackets in a request target (400), so they are encoded.
# --------------------------------------------------------------------------- #
def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={
        'User-Agent': 'drix-fuel-planner/dbofs_currents',
        'Accept-Encoding': 'identity',
    })
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 3:
                raise RuntimeError(f'{url}\n  failed after 4 tries: {exc}')
    raise AssertionError('unreachable')


def _proj(projection: str) -> str:
    return projection.replace('[', '%5B').replace(']', '%5D')


_DDS_VAR = re.compile(r'^\s*(Float32|Float64|Int32|Int16|Byte)\s+(\w+)((?:\[[^\]]+\])*);')


def _parse_dds(text: str):
    """[(name, type, [dim sizes])] in declaration order — the order the binary
    section follows."""
    out = []
    for line in text.splitlines():
        m = _DDS_VAR.match(line)
        if m:
            dims = [int(d.split('=')[-1]) for d in re.findall(r'\[([^\]]+)\]', m.group(3))]
            out.append((m.group(2), m.group(1), dims))
    return out


_XDR = {'Float32': ('>f', 4), 'Float64': ('>d', 8), 'Int32': ('>i', 4), 'Int16': ('>i', 4)}


def dap_fetch(base_url: str, projection: str) -> dict:
    """Read variables over DAP2 binary. Returns {name: (flat list, dims)}."""
    raw = _get(f'{base_url}.dods?{_proj(projection)}')
    split = raw.find(b'\nData:\n')
    if split < 0:
        raise RuntimeError(f'no Data section in response for {projection}\n'
                           f'  server said: {raw[:400].decode("utf8", "replace")}')
    dds, body, pos = raw[:split].decode('utf8'), raw[split + 7:], 0
    out = {}
    for name, typ, dims in _parse_dds(dds):
        fmt, size = _XDR[typ]
        n = 1
        for d in dims:
            n *= d
        if dims:                       # arrays carry the length twice, then data
            pos += 8
        chunk = body[pos:pos + n * size]
        if len(chunk) < n * size:
            raise RuntimeError(f'{name}: short read ({len(chunk)} of {n * size} bytes)')
        out[name] = (list(struct.unpack(f'>{n}{fmt[1]}', chunk)), dims)
        pos += n * size
    return out


def dap_ascii(base_url: str, projection: str) -> list:
    """Same request over the ASCII service — used only to audit the binary path."""
    text = _get(f'{base_url}.ascii?{_proj(projection)}').decode('utf8')
    vals = []
    for line in text.split('-' * 45)[-1].splitlines():
        if ',' not in line:
            continue
        for tok in line.split(',')[1:]:
            vals.append(float(tok))
    return vals


# --------------------------------------------------------------------------- #
#  Catalogue: which cycle is current, and which hours it carries
# --------------------------------------------------------------------------- #
def _catalog(ofs: str, day: datetime) -> str:
    url = f'{THREDDS}/catalog/NOAA/{ofs.upper()}/MODELS/{day:%Y/%m/%d}/catalog.html'
    try:
        return _get(url).decode('utf8', 'replace')
    except RuntimeError:
        return ''


def available_cycles(ofs: str = 'dbofs', days_back: int = 2) -> list:
    """[(datestr, cycle, [hour files])] newest first. A cycle still being
    written appears with fewer files; the caller decides whether that is
    enough rather than this silently preferring a stale complete one."""
    now = datetime.now(timezone.utc)
    found = []
    for back in range(days_back):
        day = now - timedelta(days=back)
        html = _catalog(ofs, day)
        if not html:
            continue
        names = set(re.findall(rf'{ofs}\.t\d\dz\.\d{{8}}\.regulargrid\.[nf]\d{{3}}\.nc', html))
        for cyc in CYCLES:
            hours = sorted(n for n in names if f'.t{cyc}.' in n)
            if hours:
                found.append((f'{day:%Y%m%d}', cyc, hours))
    found.sort(key=lambda r: (r[0], r[1]), reverse=True)
    return found


def _file_url(ofs: str, datestr: str, cycle: str, hour_file: str) -> str:
    d = f'{datestr[:4]}/{datestr[4:6]}/{datestr[6:]}'
    return f'{THREDDS}/dodsC/NOAA/{ofs.upper()}/MODELS/{d}/{hour_file}'


# --------------------------------------------------------------------------- #
#  Fetch and cache one cycle
# --------------------------------------------------------------------------- #
def _tag(ofs, datestr, cycle):
    return f'{ofs}_{datestr}_t{cycle}'


def fetch_cycle(ofs='dbofs', datestr=None, cycle=None, bbox=None,
                include_nowcast=True, workers=6, cache=None, quiet=False):
    """Download the surface layer for every hour of a cycle into the cache.

    bbox = (lat0, lon0, lat1, lon1) or None for the whole model box."""
    cycles = available_cycles(ofs)
    if not cycles:
        raise RuntimeError(f'no {ofs} cycles listed on the THREDDS catalogue')
    if datestr and cycle:
        match = [c for c in cycles if c[0] == datestr and c[1] == cycle]
        if not match:
            raise RuntimeError(f'{ofs} {datestr} t{cycle} is not on the catalogue')
        datestr, cycle, hours = match[0]
    else:
        datestr, cycle, hours = cycles[0]

    hours = [h for h in hours if include_nowcast or '.f' in h.rsplit('.', 2)[-2][:1] + h]
    hours = sorted(hours, key=lambda h: ('f' in h.rsplit('.', 2)[1][:1], h.rsplit('.', 2)[1]))
    if not include_nowcast:
        hours = [h for h in hours if h.rsplit('.', 2)[1].startswith('f')]
    say = (lambda *a: None) if quiet else print

    first = _file_url(ofs, datestr, cycle, hours[0])
    say(f'{ofs.upper()} {datestr} t{cycle} — {len(hours)} hourly files')

    # ---- static geometry, read once ---------------------------------------
    # ---- MODIFIED FROM THE VENDORED ORIGINAL (see the header) --------------
    # The original hard-coded 487 x 529 — DBOFS's grid — in both the projection and
    # ny_full/nx_full. Every other OFS has its own shape (CBOFS is 693 x 509), so
    # the request ran off the end of the array and the server answered HTTP 400.
    # The dimensions are declared in the DDS, so read them instead of assuming.
    _dds = _get(first + '.dds').decode('utf8', 'replace')
    _m = re.search(r'Latitude\[ny\s*=\s*(\d+)\]\[nx\s*=\s*(\d+)\]', _dds)
    if not _m:
        raise RuntimeError(f'{ofs}: could not read grid dimensions from the DDS')
    ny_full, nx_full = int(_m.group(1)), int(_m.group(2))
    corners = dap_fetch(first, f'Latitude[0:{ny_full - 1}:{ny_full - 1}][0],'
                               f'Longitude[0][0:{nx_full - 1}:{nx_full - 1}]')
    lats_all, lons_all = corners['Latitude'][0], corners['Longitude'][0]
    dlat = (lats_all[1] - lats_all[0]) / (ny_full - 1)
    dlon = (lons_all[1] - lons_all[0]) / (nx_full - 1)

    if bbox:
        lat0, lon0, lat1, lon1 = bbox
        y0 = max(0, int(math.floor((min(lat0, lat1) - lats_all[0]) / dlat)) - 1)
        y1 = min(ny_full - 1, int(math.ceil((max(lat0, lat1) - lats_all[0]) / dlat)) + 1)
        x0 = max(0, int(math.floor((min(lon0, lon1) - lons_all[0]) / dlon)) - 1)
        x1 = min(nx_full - 1, int(math.ceil((max(lon0, lon1) - lons_all[0]) / dlon)) + 1)
        if y1 <= y0 or x1 <= x0:
            raise RuntimeError('bbox does not overlap the model box '
                               f'({fmt_span(lats_all[0], lats_all[1], "lat")}, '
                               f'{fmt_span(lons_all[0], lons_all[1], "lon")})')
    else:
        y0, y1, x0, x1 = 0, ny_full - 1, 0, nx_full - 1
    ny, nx = y1 - y0 + 1, x1 - x0 + 1

    geo = dap_fetch(first, f'Latitude[{y0}:{y1}][{x0}],Longitude[{y0}][{x0}:{x1}],'
                           f'mask[{y0}:{y1}][{x0}:{x1}],Depth[0]')
    lats = geo['Latitude'][0]
    lons = geo['Longitude'][0]
    mask = [int(v) for v in geo['mask'][0]]
    if abs(geo['Depth'][0][0]) > 1e-9:
        raise RuntimeError(f'Depth[0] is {geo["Depth"][0][0]} m, not the surface')
    say(f'grid {ny} x {nx} nodes, {fmt_span(lats[0], lats[-1], "lat", 3)}, '
        f'{fmt_span(lons[0], lons[-1], "lon", 3)}, {sum(mask)} water of {ny * nx}')

    # ---- one request per hour: time + both surface components -------------
    proj = (f'time,u_eastward[0][{SURFACE}][{y0}:{y1}][{x0}:{x1}],'
            f'v_northward[0][{SURFACE}][{y0}:{y1}][{x0}:{x1}]')

    def one(hour_file):
        got = dap_fetch(_file_url(ofs, datestr, cycle, hour_file), proj)
        return (got['time'][0][0], got['u_eastward'][0], got['v_northward'][0])

    say(f'fetching {len(hours)} hours ...')
    with ThreadPoolExecutor(max_workers=workers) as pool:
        frames = list(pool.map(one, hours))

    order = sorted(range(len(frames)), key=lambda i: frames[i][0])
    times = [frames[i][0] for i in order]
    for a, b in zip(times, times[1:]):
        if abs((b - a) - 3600) > 1:
            raise RuntimeError(f'frames are not hourly: gap of {(b - a) / 3600:.2f} h at '
                               f'{_iso(a)}')

    blob = bytearray()
    for i in order:
        blob += struct.pack(f'>{len(frames[i][1])}f', *frames[i][1])
        blob += struct.pack(f'>{len(frames[i][2])}f', *frames[i][2])

    cache = cache or CACHE
    cache.mkdir(parents=True, exist_ok=True)
    tag = _tag(ofs, datestr, cycle)
    meta = {
        'ofs': ofs, 'date': datestr, 'cycle': cycle,
        'source': f'{THREDDS}/dodsC/NOAA/{ofs.upper()}/MODELS/'
                  f'{datestr[:4]}/{datestr[4:6]}/{datestr[6:]}/',
        'product': 'regulargrid', 'depth_m': 0.0,
        'fetched_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'ny': ny, 'nx': nx, 'lat0': lats[0], 'lon0': lons[0],
        'dlat': dlat, 'dlon': dlon,
        'files': [hours[i] for i in order],
        'times': times,
        'mask': mask,
    }
    (cache / f'{tag}_meta.json').write_text(json.dumps(meta), encoding='utf8')
    with gzip.open(cache / f'{tag}_uv.bin.gz', 'wb', compresslevel=6) as fh:
        fh.write(bytes(blob))

    size = (cache / f'{tag}_uv.bin.gz').stat().st_size
    say(f'cached {len(times)} frames, {_iso(times[0])} -> {_iso(times[-1])} '
        f'({(times[-1] - times[0]) / 3600 + 1:.0f} h span), {size / 1e6:.1f} MB gzipped')
    return tag


# --------------------------------------------------------------------------- #
#  Query
# --------------------------------------------------------------------------- #
def _iso(secs: float) -> str:
    return (EPOCH + timedelta(seconds=secs)).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_time(text: str) -> datetime:
    t = text.strip().replace('Z', '+00:00')
    dt = datetime.fromisoformat(t)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class Currents:
    """A cached cycle, queryable at any position and time inside it."""

    def __init__(self, tag=None, cache=None):
        # Resolved HERE, not as a default argument: a default binds the module
        # value at import and no later reassignment can reach it, which made a
        # test that pointed the cache at a temp directory silently read the
        # operator's real one instead.
        cache = cache or CACHE
        if tag is None:
            metas = sorted(cache.glob('*_meta.json'))
            if not metas:
                raise RuntimeError(f'nothing cached in {cache} — run `fetch` first')
            tag = metas[-1].name[:-len('_meta.json')]
        self.tag = tag
        self.meta = json.loads((cache / f'{tag}_meta.json').read_text(encoding='utf8'))
        m = self.meta
        self.ny, self.nx = m['ny'], m['nx']
        self.lat0, self.lon0, self.dlat, self.dlon = m['lat0'], m['lon0'], m['dlat'], m['dlon']
        self.times = m['times']
        self.mask = m['mask']
        n = self.ny * self.nx
        with gzip.open(cache / f'{tag}_uv.bin.gz', 'rb') as fh:
            raw = fh.read()
        want = len(self.times) * 2 * n * 4
        if len(raw) != want:
            raise RuntimeError(f'{tag}: cache is {len(raw)} bytes, expected {want}')
        flat = struct.unpack(f'>{len(raw) // 4}f', raw)
        self.u = [flat[(2 * k) * n:(2 * k + 1) * n] for k in range(len(self.times))]
        self.v = [flat[(2 * k + 1) * n:(2 * k + 2) * n] for k in range(len(self.times))]

    # -- span ---------------------------------------------------------------
    @property
    def start(self):
        return EPOCH + timedelta(seconds=self.times[0])

    @property
    def end(self):
        return EPOCH + timedelta(seconds=self.times[-1])

    def box(self):
        return (self.lat0, self.lon0,
                self.lat0 + (self.ny - 1) * self.dlat,
                self.lon0 + (self.nx - 1) * self.dlon)

    def frame_times(self):
        return [EPOCH + timedelta(seconds=t) for t in self.times]

    # -- one frame, bilinear in space ---------------------------------------
    def _at_frame(self, k, lat, lon):
        fy = (lat - self.lat0) / self.dlat
        fx = (lon - self.lon0) / self.dlon
        if not (-0.5 <= fy <= self.ny - 0.5) or not (-0.5 <= fx <= self.nx - 0.5):
            return None
        iy = min(max(int(math.floor(fy)), 0), self.ny - 2)
        ix = min(max(int(math.floor(fx)), 0), self.nx - 2)
        ty, tx = fy - iy, fx - ix
        u = self.u[k]
        v = self.v[k]
        su = sv = sw = 0.0
        for dy, wy in ((0, 1 - ty), (1, ty)):
            for dx, wx in ((0, 1 - tx), (1, tx)):
                w = wy * wx
                if w <= 0:
                    continue
                j = (iy + dy) * self.nx + (ix + dx)
                if not self.mask[j]:
                    continue                      # land node: drop, renormalise
                uu, vv = u[j], v[j]
                if uu <= FILL / 2 or vv <= FILL / 2:
                    continue                      # dry / no value this hour
                su += w * uu
                sv += w * vv
                sw += w
        if sw <= 0:
            return None                           # no water in reach: not zero
        return su / sw, sv / sw

    # -- position and time --------------------------------------------------
    def at(self, lat, lon, when):
        """(speed_kt, set_degT, u_east_ms, v_north_ms) or None outside water."""
        t = (when - EPOCH).total_seconds()
        if t < self.times[0] - 1e-6 or t > self.times[-1] + 1e-6:
            raise ValueError(f'{when:%Y-%m-%dT%H:%M:%SZ} is outside the cached span '
                             f'{self.start:%Y-%m-%dT%H:%MZ}..{self.end:%Y-%m-%dT%H:%MZ}')
        k = min(max(int((t - self.times[0]) // 3600), 0), len(self.times) - 2)
        frac = (t - self.times[k]) / (self.times[k + 1] - self.times[k])
        a = self._at_frame(k, lat, lon)
        b = self._at_frame(k + 1, lat, lon)
        if a is None or b is None:
            return None
        u = a[0] + (b[0] - a[0]) * frac
        v = a[1] + (b[1] - a[1]) * frac
        return uv_to_set(u, v)


    # -- best effort, when the span does not reach ------------------------- #
    def at_best(self, lat, lon, when):
        """(values, shift_hours) — a value for `when` even outside the span.

        `shift_hours` is 0.0 when the answer came from a real frame. Otherwise
        it is how far in time the value was borrowed from, signed: negative
        means projected FORWARD from earlier data, positive means projected
        BACKWARD from later data.

        **The projection is by whole tidal cycles, not by holding or by a
        line.** The current here is semidiurnal, so the value one M2 period away
        is the best estimate available from data we already hold — measured
        against this model's own output, projecting one to three cycles lands
        within **0.14–0.21 kt RMS**, where holding the last value is wrong by
        0.57–2.21 kt and assuming slack water by 0.36–1.46 kt. Extrapolating a
        reversing tide linearly is worse than all three and is not offered.

        Position is NOT projected. `None` still means no model water at that
        point, and no amount of time shifting invents an ocean there.

        Raises ValueError past MAX_PROJECT_CYCLES, because a guess has a range
        beyond which it stops being one — see the constant.
        """
        t = (when - EPOCH).total_seconds()
        lo, hi = self.times[0], self.times[-1]
        step = M2_PERIOD_H * 3600.0
        src = t
        if t > hi + 1e-6:
            k = math.ceil((t - hi) / step)
            src = t - k * step
        elif t < lo - 1e-6:
            k = math.ceil((lo - t) / step)
            src = t + k * step
        else:
            k = 0
        if k > MAX_PROJECT_CYCLES:
            raise ValueError(
                f'{when:%Y-%m-%dT%H:%M:%SZ} is {k} tidal cycles outside the '
                f'cached span {self.start:%Y-%m-%dT%H:%MZ}..'
                f'{self.end:%Y-%m-%dT%H:%MZ} — past the '
                f'{MAX_PROJECT_CYCLES}-cycle limit a projection is offered over')
        # A span shorter than one cycle could leave the shifted time still
        # outside. Not reachable with a 54 h cycle, but it must not answer
        # wrongly if one ever were.
        if src < lo - 1e-6 or src > hi + 1e-6:
            raise ValueError(
                f'cached span is shorter than one tidal cycle — cannot project')
        return self.at(lat, lon, EPOCH + timedelta(seconds=src)), (src - t) / 3600.0


def uv_to_set(u, v):
    """East/north m/s -> (knots, degrees TRUE the water SETS TOWARD, u, v)."""
    speed = math.hypot(u, v) * MS_TO_KT
    return speed, (90.0 - math.degrees(math.atan2(v, u))) % 360.0, u, v


# --------------------------------------------------------------------------- #
#  Position formatting
#
#  A position is DISPLAYED with its hemisphere — 075.1394 W, not -75.1394 E.
#  A signed number under an "E" heading reads as east to anyone scanning it,
#  with the minus sign the only thing saying otherwise, and this whole domain
#  is west. Longitude is padded to three integer digits the way charts and
#  every fix format write it, which also tells the two apart at a glance.
#
#  FOR HUMANS ONLY. Everything on the wire — the JSON API, the CSV exports,
#  the cache metadata — stays SIGNED DECIMAL DEGREES, because that is what
#  every consumer of those already parses. Do not "fix" those to match.
# --------------------------------------------------------------------------- #
def fmt_lat(lat, places=4):
    return f'{abs(lat):0{places + 3}.{places}f} {"S" if lat < 0 else "N"}'


def fmt_lon(lon, places=4):
    return f'{abs(lon):0{places + 4}.{places}f} {"W" if lon < 0 else "E"}'


def fmt_pos(lat, lon, places=4):
    return f'{fmt_lat(lat, places)}  {fmt_lon(lon, places)}'


def fmt_span(lo, hi, kind='lat', places=2):
    """A range with a hemisphere on EACH end, so a box straddling the meridian
    or the equator reads as what it is rather than as a stray sign."""
    fmt = fmt_lat if kind == 'lat' else fmt_lon
    return f'{fmt(lo, places)} to {fmt(hi, places)}'


# --------------------------------------------------------------------------- #
#  Verification rails — every one of these has caught something or pins a
#  convention that is invisible when wrong. Do not delete them.
# --------------------------------------------------------------------------- #
def verify(tag=None, cache=None):
    cur = Currents(tag, cache)
    ok, fail = [], []

    def check(name, cond, detail=''):
        (ok if cond else fail).append(f'{name}{"  " + detail if detail else ""}')

    # 1. the direction convention, both axes, independent of any data
    s, d, _, _ = uv_to_set(1.0, 0.0)
    check('set: due-east flow reads 090', abs(d - 90) < 1e-9, f'got {d:.3f}')
    check('set: due-north flow reads 000', abs(uv_to_set(0.0, 1.0)[1]) < 1e-9)
    check('set: southwest flow reads 225', abs(uv_to_set(-1, -1)[1] - 225) < 1e-9)
    check('speed: 1 m/s is 1.9438 kt', abs(s - 1.9438444924406) < 1e-9)

    # 2. interpolation lands on the node value at a node
    k, mid = 0, None
    for j, water in enumerate(cur.mask):
        if water and cur.u[0][j] > FILL / 2:
            mid = j
            break
    iy, ix = divmod(mid, cur.nx)
    lat = cur.lat0 + iy * cur.dlat
    lon = cur.lon0 + ix * cur.dlon
    got = cur._at_frame(k, lat, lon)
    check('bilinear at a node returns that node',
          got and abs(got[0] - cur.u[0][mid]) < 1e-6 and abs(got[1] - cur.v[0][mid]) < 1e-6)

    # 3. time interpolation is linear and hits the frames exactly
    tmid = cur.frame_times()[1]
    a = cur._at_frame(1, lat, lon)
    b = cur.at(lat, lon, tmid)
    check('at() on a frame time equals that frame',
          b and abs(b[2] - a[0]) < 1e-6 and abs(b[3] - a[1]) < 1e-6)

    # 4. the span is hourly and unbroken
    gaps = [(x - y) for x, y in zip(cur.times[1:], cur.times[:-1])]
    check('frames are hourly with no gap', all(abs(g - 3600) < 1 for g in gaps),
          f'{len(cur.times)} frames, {min(gaps) / 3600:.2f}..{max(gaps) / 3600:.2f} h')

    # 5. land returns None rather than a zero current
    land = next((j for j, w in enumerate(cur.mask) if not w), None)
    if land is not None:
        ly, lx = divmod(land, cur.nx)
        near = cur._at_frame(0, cur.lat0 + ly * cur.dlat, cur.lon0 + lx * cur.dlon)
        neighbours = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                jj = (ly + dy) * cur.nx + (lx + dx)
                if 0 <= jj < len(cur.mask):
                    neighbours.append(cur.mask[jj])
        if not any(neighbours):
            check('inland node returns None, not 0.0', near is None)

    # 6. outside the span raises rather than extrapolating
    try:
        cur.at(lat, lon, cur.end + timedelta(hours=1))
        check('a time past the span raises', False)
    except ValueError:
        check('a time past the span raises', True)

    # 7. the binary transport agrees with NOAA's own ASCII rendering
    m = cur.meta
    url = f'{m["source"]}{m["files"][0]}'
    proj = f'u_eastward[0][{SURFACE}][10:12][10:12]'
    try:
        bin_vals = dap_fetch(url, proj)['u_eastward'][0]
        asc_vals = dap_ascii(url, proj)
        check('DAP2 binary matches the ASCII service',
              len(bin_vals) == len(asc_vals) == 9
              and all(abs(a - b) < 1e-3 for a, b in zip(bin_vals, asc_vals)),
              f'{len(bin_vals)} values')
    except RuntimeError as exc:
        fail.append(f'ASCII cross-check could not run: {exc}')

    # 8. speeds are physical — a tidal estuary is not a 20-knot river
    speeds = []
    for k in range(len(cur.times)):
        u, v = cur.u[k], cur.v[k]
        for j in range(0, len(u), 37):
            if cur.mask[j] and u[j] > FILL / 2:
                speeds.append(math.hypot(u[j], v[j]) * MS_TO_KT)
    peak = max(speeds) if speeds else 0.0
    check('sampled peak speed is plausible (<8 kt)', peak < 8.0, f'peak {peak:.2f} kt')

    print(f'{cur.tag}: {len(ok)} passed, {len(fail)} failed')
    for line in ok:
        print(f'  ok    {line}')
    for line in fail:
        print(f'  FAIL  {line}')
    return not fail


def crosscheck(tag=None, cache=None, points=None):
    """Read the NATIVE curvilinear ROMS fields, do the staggered averaging and
    the `angle` rotation by hand, and compare with the regulargrid product this
    tool reads. Two independent paths from the same model run: if they agree,
    the shortcut is earned."""
    cur = Currents(tag, cache)
    m = cur.meta
    day = f'{m["date"][:4]}/{m["date"][4:6]}/{m["date"][6:]}'
    native = (f'{THREDDS}/dodsC/NOAA/{m["ofs"].upper()}/MODELS/{day}/'
              f'{m["files"][0].replace("regulargrid", "fields")}')

    print(f'native  {native.rsplit("/", 1)[-1]}')
    grid = dap_fetch(native, 'lon_rho[0:731][0:118],lat_rho[0:731][0:118],'
                             'angle[0:731][0:118],mask_rho[0:731][0:118]')
    lon_rho, lat_rho = grid['lon_rho'][0], grid['lat_rho'][0]
    angle, mask_rho = grid['angle'][0], grid['mask_rho'][0]
    eta, xi = 732, 119
    uv = dap_fetch(native, 'u[0][9][0:731][0:117],v[0][9][0:730][0:118]')
    u_grid, v_grid = uv['u'][0], uv['v'][0]

    when = cur.frame_times()[0]
    print(f'frame   {when:%Y-%m-%dT%H:%MZ}\n')
    print(f'{"position":>24} {"native kt":>10} {"native set":>11} '
          f'{"regular kt":>11} {"regular set":>12} {"d kt":>7} {"d set":>7}')

    rows = []
    for lat, lon in (points or DEFAULT_POINTS):
        best, bj = 1e9, None
        for j in range(len(lat_rho)):
            if not mask_rho[j]:
                continue
            d = (lat_rho[j] - lat) ** 2 + ((lon_rho[j] - lon) * 0.78) ** 2
            if d < best:
                best, bj = d, j
        j_eta, j_xi = divmod(bj, xi)
        if not (0 < j_eta < eta - 1 and 0 < j_xi < xi - 1):
            continue
        # staggered (Arakawa-C) -> rho point, then rotate out of grid axes
        ug = 0.5 * (u_grid[j_eta * 118 + j_xi - 1] + u_grid[j_eta * 118 + j_xi])
        vg = 0.5 * (v_grid[(j_eta - 1) * 119 + j_xi] + v_grid[j_eta * 119 + j_xi])
        if ug > 1e30 or vg > 1e30:
            continue
        a = angle[bj]
        ue = ug * math.cos(a) - vg * math.sin(a)
        vn = ug * math.sin(a) + vg * math.cos(a)
        n_kt, n_set, _, _ = uv_to_set(ue, vn)

        got = cur.at(lat_rho[bj], lon_rho[bj], when)
        if got is None:
            continue
        r_kt, r_set = got[0], got[1]
        dset = abs((n_set - r_set + 180) % 360 - 180)
        rows.append((abs(n_kt - r_kt), dset))
        print(f'{fmt_pos(lat_rho[bj], lon_rho[bj]):>24} {n_kt:10.2f} {n_set:10.1f}  '
              f'{r_kt:11.2f} {r_set:11.1f}  {n_kt - r_kt:+7.2f} {dset:7.1f}')

    if rows:
        print(f'\n{len(rows)} points: median |d speed| {sorted(r[0] for r in rows)[len(rows) // 2]:.3f} kt, '
              f'median |d set| {sorted(r[1] for r in rows)[len(rows) // 2]:.1f} deg')
        print('The two products are NOT identical by construction — regulargrid is\n'
              'NOAA\'s own interpolation of the native grid, so small differences are\n'
              'the regridding, not an error. A set differing by tens of degrees at a\n'
              'strong-current point would be the rotation being wrong.')


# --------------------------------------------------------------------------- #
#  Resolving a MISSION onto the forecast
#
#  The planner has no geography in it: a leg is a distance, a course and a
#  speed. To ask the forecast what the water is doing on a leg, the mission has
#  to be put on the chart — dead-reckoned from a departure position and time,
#  exactly as the mission clock already reckons the hours.
#
#  What comes back fills `Leg.current_speed_kt` / `Leg.current_set_deg`, which
#  the engine already understands. NOTHING in the model changes: this supplies
#  inputs an operator would otherwise read off a tide table and type in.
# --------------------------------------------------------------------------- #
NM_PER_DEG = 60.0


def dead_reckon(lat, lon, course_deg, distance_nm):
    """Rhumb-line step on a mid-latitude parallel — metres of error over a leg
    of this length, and the same flat-earth approximation the planner's own
    distances already assume."""
    c = math.radians(course_deg)
    dlat = distance_nm * math.cos(c) / NM_PER_DEG
    mid = math.radians(lat + dlat / 2.0)
    dlon = distance_nm * math.sin(c) / (NM_PER_DEG * max(math.cos(mid), 1e-6))
    return lat + dlat, lon + dlon


def resolve_legs(origin_lat, origin_lon, departure, legs, tag=None, cache=None,
                 samples=13, project=True):
    """Per-leg current for a mission leaving `origin` at `departure` (UTC).

    `legs` are dicts carrying what the planner's Leg carries: name, kind,
    distance_nm, speed_kt, course_deg, loiter_hours, and for a survey the
    lines/line_length_nm. Returns (per-leg dicts, provenance dict).

    A TRANSIT is sampled along its track, each sample at the time the vehicle
    would be there. A SURVEY is sampled at the survey ground across the leg's
    duration and does NOT advance the position: a lawnmower ends roughly where
    it started, and walking it `distance_nm` down the first line's course would
    put the run home in the wrong water — tens of miles wrong on a long survey.

    A loiter is taken at the START of the leg, matching the engine, so a hold
    delays everything after it, including which way the tide is then running.
    """
    cur = Currents(tag, cache or CACHE)
    lat, lon, when = float(origin_lat), float(origin_lon), departure
    out = []

    for leg in legs:
        kind = leg.get('kind', 'transit')
        speed = float(leg.get('speed_kt') or 0.0)
        course = float(leg.get('course_deg') or 0.0)
        if kind == 'survey' and leg.get('lines'):
            distance = float(leg['lines']) * float(leg.get('line_length_nm') or 0.0)
        else:
            distance = float(leg.get('distance_nm') or 0.0)
        loiter = float(leg.get('loiter_hours') or 0.0)
        hours = (distance / speed) if speed > 0 else 0.0

        when += timedelta(hours=loiter)          # the hold comes first
        start_lat, start_lon, start_at = lat, lon, when
        end_lat, end_lon = ((lat, lon) if kind == 'survey'
                            else dead_reckon(lat, lon, course, distance))

        us, vs, missed, outside = [], [], 0, None
        shifts = []
        for i in range(samples):
            f = i / (samples - 1) if samples > 1 else 0.0
            slat = start_lat + (end_lat - start_lat) * f
            slon = start_lon + (end_lon - start_lon) * f
            try:
                if project:
                    got, shift = cur.at_best(slat, slon,
                                             when + timedelta(hours=hours * f))
                else:
                    got, shift = cur.at(slat, slon,
                                        when + timedelta(hours=hours * f)), 0.0
            except ValueError as exc:
                # Still refused: either projection is off, or the time is past
                # even the projection's reach. A leg nobody can answer for stays
                # unanswered rather than being filled with a worse guess.
                outside = str(exc)
                break
            if got is None:
                missed += 1
                continue
            us.append(got[2])
            vs.append(got[3])
            if shift:
                shifts.append(shift)

        row = {
            'name': leg.get('name', kind),
            'kind': kind,
            'start': [round(start_lat, 5), round(start_lon, 5)],
            'end': [round(end_lat, 5), round(end_lon, 5)],
            'start_utc': start_at.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'hours': round(hours + loiter, 3),
            'samples': len(us),
            'of': samples,
        }
        if outside:
            row['error'] = outside
        elif us:
            u, v = sum(us) / len(us), sum(vs) / len(vs)
            kt, deg, _, _ = uv_to_set(u, v)
            row['current_speed_kt'] = round(kt, 2)
            row['current_set_deg'] = round(deg, 1)
            # Signed component along the course made good: + carries the hull
            # along, - is a head current. The engine derives this itself from
            # the vector; it is reported so the sign can be eyeballed before the
            # numbers are accepted into a plan.
            row['along_kt'] = round((u * math.sin(math.radians(course))
                                     + v * math.cos(math.radians(course))) * MS_TO_KT, 2)
            notes = []
            if missed:
                notes.append(f'{missed} of {samples} sample points fell on land or '
                             f'outside the model — averaged over the rest')
            if shifts:
                # NEVER silently. An estimate that reads like a forecast is
                # worse than no answer, because it is acted on with the same
                # confidence. The flag is machine-readable and the note says it
                # in words; both surfaces and the report carry it.
                back = sum(1 for s in shifts if s > 0)
                far = max(abs(s) for s in shifts)
                row['estimated'] = True
                row['projected_hours'] = round(far, 2)
                row['projected_samples'] = len(shifts)
                way = 'backward from later' if back > len(shifts) / 2 else \
                      'forward from earlier'
                notes.append(
                    f'ESTIMATE — {len(shifts)} of {len(us)} samples lie outside the '
                    f'forecast, projected {way} data across whole tidal cycles '
                    f'(up to {far:.1f} h). Typically within about 0.2 kt, but it '
                    f'is not a forecast')
            if notes:
                row['note'] = '. '.join(notes)
        else:
            # No value at all. Deliberately NOT zero: a leg the forecast cannot
            # see and a leg with no current are different answers, and only one
            # of them belongs in a plan.
            row['note'] = ('no model water on this leg — outside the domain, or '
                           'entirely over land')

        out.append(row)
        lat, lon, when = end_lat, end_lon, when + timedelta(hours=hours)

    prov = {
        'model': cur.meta['ofs'].upper(),
        'cycle': f'{cur.meta["date"]} t{cur.meta["cycle"]}',
        'tag': cur.tag,
        'product': cur.meta.get('product', 'regulargrid'),
        'depth_m': cur.meta.get('depth_m', 0.0),
        'fetched_utc': cur.meta.get('fetched_utc'),
        'span': [cur.start.strftime('%Y-%m-%dT%H:%M:%SZ'),
                 cur.end.strftime('%Y-%m-%dT%H:%M:%SZ')],
        'source': cur.meta.get('source'),
    }
    prov['label'] = (f'{prov["model"]} {prov["cycle"]} surface forecast '
                     f'({prov["span"][0][:16]}Z to {prov["span"][1][:16]}Z)')
    # A plan that borrowed values must not be filed under the cycle's name
    # alone. The label is what the mission report prints, so the qualification
    # travels with it rather than living only on screen.
    est = [r['name'] for r in out if r.get('estimated')]
    if est:
        prov['estimated_legs'] = est
        prov['projected_hours'] = max(r['projected_hours'] for r in out
                                      if r.get('estimated'))
        prov['label'] += (f' — PART ESTIMATED: {", ".join(est)} projected across '
                          f'tidal cycles from outside the forecast')
    return out, prov


def env_factory(base_env, departure, tag=None, cache=None, project=True):
    """An `env_at(lat, lon, hours)` for `engine.plan()`.

    This is the seam that turns the current from a per-leg NUMBER into a
    FIELD. The engine calls it once per run — per survey line, per transit
    segment — with where the vehicle is and how long into the mission it is,
    and gets back that leg's environment with the current replaced by what the
    forecast says there and then.

    Returns None when the forecast cannot answer, and the engine falls back to
    the leg's own current. That is deliberate: a line over a shoal the model
    calls land degrades to the number an operator typed rather than failing the
    plan or silently planning slack water. `env_at.covered` / `.asked` record
    how much of the mission the field actually answered for, so a surface can
    say so.

    **A run past the end of the forecast is PROJECTED rather than dropped**
    (`project=True`), by the same whole-tidal-cycle rule `at_best` uses — which
    matters more here than on the per-leg path, because a survey held on one
    ground through a turning tide is exactly the case the field exists for, and
    losing its tail to the horizon puts the leg back on a single averaged number
    at the point the tide is doing the most. `env_at.estimated` counts those
    runs and `.projected_hours` is the furthest any of them reached, so
    `covered` never passes a borrowed value off as a forecast one.

    `dataclasses.replace` rather than an import of Environment: the engine
    does not import this module and this module should not import the engine
    just to name a type.
    """
    cur = Currents(tag, cache)

    def env_at(lat, lon, hours):
        env_at.asked += 1
        when = departure + timedelta(hours=hours)
        try:
            if project:
                got, shift = cur.at_best(lat, lon, when)
            else:
                got, shift = cur.at(lat, lon, when), 0.0
        except ValueError:
            return None                      # past even the projection's reach
        if got is None:
            return None                      # land, or outside the domain
        env_at.covered += 1
        if shift:
            # Counted, not just tolerated: `covered` alone would report a
            # projected run as though the forecast had answered for it, which is
            # the difference between a field and a guess dressed as one.
            env_at.estimated += 1
            env_at.projected_hours = max(env_at.projected_hours, abs(shift))
        return dataclasses.replace(base_env, current_speed_kt=got[0],
                                   current_set_deg=got[1])

    env_at.asked = 0
    env_at.covered = 0
    env_at.estimated = 0
    env_at.projected_hours = 0.0
    env_at.tag = cur.tag
    env_at.label = (f'{cur.meta["ofs"].upper()} {cur.meta["date"]} '
                    f't{cur.meta["cycle"]} surface forecast')
    return env_at


def mission_bbox(origin_lat, origin_lon, legs, margin_deg=0.25):
    """A box round everywhere the mission goes, for a targeted fetch."""
    lat, lon = float(origin_lat), float(origin_lon)
    lats, lons = [lat], [lon]
    for leg in legs:
        if leg.get('kind') == 'survey':
            reach = (float(leg.get('line_length_nm') or 0.0)
                     or float(leg.get('distance_nm') or 0.0) / 2.0)
            for brg in (0.0, 90.0, 180.0, 270.0):
                a, b = dead_reckon(lat, lon, brg, reach)
                lats.append(a)
                lons.append(b)
            continue
        lat, lon = dead_reckon(lat, lon, float(leg.get('course_deg') or 0.0),
                               float(leg.get('distance_nm') or 0.0))
        lats.append(lat)
        lons.append(lon)
    return (min(lats) - margin_deg, min(lons) - margin_deg,
            max(lats) + margin_deg, max(lons) + margin_deg)


def cached_cycles(cache=None):
    """[(tag, meta)] newest cycle first."""
    cache = cache or CACHE
    out = []
    for meta_file in sorted(cache.glob('*_meta.json')):
        try:
            meta = json.loads(meta_file.read_text(encoding='utf8'))
        except (OSError, ValueError):
            continue
        out.append((meta_file.name[:-len('_meta.json')], meta))
    out.sort(key=lambda r: (r[1].get('date', ''), r[1].get('cycle', '')), reverse=True)
    return out


def covering_cycle(start, end, bbox=None, cache=None):
    """The newest cached cycle whose span AND box cover the mission, else None.

    The box matters as much as the span: a cycle fetched for a box round Lewes
    cannot answer for a mission out of Cape May, and without this check it
    would answer "no water on this leg" for every leg — which reads like a
    forecast of slack water rather than the wrong file.
    """
    for tag, meta in cached_cycles(cache):
        times = meta.get('times') or []
        if not times:
            continue
        span0 = EPOCH + timedelta(seconds=times[0])
        span1 = EPOCH + timedelta(seconds=times[-1])
        if not (span0 <= start and end <= span1):
            continue
        if bbox:
            lat0, lon0 = meta['lat0'], meta['lon0']
            lat1 = lat0 + (meta['ny'] - 1) * meta['dlat']
            lon1 = lon0 + (meta['nx'] - 1) * meta['dlon']
            if not (lat0 <= bbox[0] and bbox[2] <= lat1
                    and lon0 <= bbox[1] and bbox[3] <= lon1):
                continue
        return tag
    return None


def cycle_span(datestr, cycle, hours=None):
    """(start, end) UTC a cycle covers, WITHOUT downloading it.

    `n` files run up to the cycle hour and `f` files after it, so the span is
    read off the file names when `available_cycles` supplied them and falls back
    to the published 6/48 shape when it did not. This is what lets the caller
    ask "does NOAA still hold something covering this?" for the price of one
    catalog page rather than 33 MB.
    """
    base = (datetime.strptime(datestr, '%Y%m%d').replace(tzinfo=timezone.utc)
            + timedelta(hours=int(cycle[:2])))
    if hours:
        # Match the FRAME token, not a bare '.n' — every one of these names ends
        # in '.nc', so a substring test counts each forecast file as a nowcast
        # one and pushes the span two days early. Found by a test, which is the
        # only reason it is not still there.
        kinds = [m.group(1) for m in
                 (re.search(r'\.([nf])\d{3}\.nc$', h) for h in hours) if m]
        n = kinds.count('n')
        f = kinds.count('f')
    else:
        n, f = NOWCAST_H, FORECAST_H
    return base - timedelta(hours=max(n - 1, 0)), base + timedelta(hours=f)


def remote_cycle_covering(start, end, ofs='dbofs', days_back=3):
    """(datestr, cycle, span) of the newest cycle NOAA still serves covering the
    window, or None.

    NOAA keeps only about two days of these: measured 2026-08-13, the catalog
    held three cycles for that day, four for the day before, one for the day
    before that and nothing earlier. So this answers for a mission that started
    within roughly two days and nothing further back — which is exactly the
    range over which real data can replace an estimate.
    """
    for datestr, cyc, hours in available_cycles(ofs, days_back):
        span = cycle_span(datestr, cyc, hours)
        if span[0] <= start and end <= span[1]:
            return datestr, cyc, span
    return None


def ensure_cycle_covering(start, end, bbox=None, ofs='dbofs', cache=None,
                          allow_fetch=True, quiet=True):
    """(tag, fetched) for a cycle covering the window, downloading one if the
    cache has none and NOAA still serves one. (None, False) when nothing covers
    it and the caller must fall back to projecting.

    REAL DATA BEATS AN ESTIMATE, which is the whole point of the lookup: a
    mission that started yesterday is answerable exactly, and only a time no
    cycle reaches — past the forecast horizon, or older than the archive — is
    worth guessing at.
    """
    cache = cache or CACHE
    have = covering_cycle(start, end, bbox, cache)
    if have:
        return have, False
    if not allow_fetch:
        return None, False
    found = remote_cycle_covering(start, end, ofs)
    if not found:
        return None, False
    datestr, cyc, _ = found
    fetch_cycle(ofs=ofs, datestr=datestr, cycle=cyc, bbox=bbox,
                cache=cache, quiet=quiet)
    return _tag(ofs, datestr, cyc), True


COOPS_API = 'https://api.tidesandcurrents.noaa.gov'


def station_check(station='DEB0002', tag=None, cache=None):
    """Compare the model against CO-OPS HARMONIC current predictions — a wholly
    separate product, computed from tidal constituents rather than run as a
    model. They should agree on phase and roughly on strength; they will NOT
    agree exactly, and the differences are informative rather than faults:

      * the harmonic prediction is ASTRONOMICAL TIDE ONLY. DBOFS adds wind,
        river discharge and density, which is precisely why a forecast model
        is worth reading instead of a tide table.
      * the prediction is RECTILINEAR — one signed number along a mean flood
        axis — while the model carries a true vector that can cross it.
      * the station bin sits several feet DOWN; the model layer read here is
        the surface, which runs faster and feels the wind first.
    """
    cur = Currents(tag, cache)
    meta = json.loads(_get(f'{COOPS_API}/mdapi/prod/webapi/stations/{station}.json'
                           f'?type=currentpredictions').decode('utf8'))
    st = meta['stations'][0]
    lat, lon = float(st['lat']), float(st['lng'])

    begin = cur.start.strftime('%Y%m%d')
    end = cur.end.strftime('%Y%m%d')
    url = (f'{COOPS_API}/api/prod/datagetter?product=currents_predictions'
           f'&begin_date={begin}&end_date={end}&station={station}'
           f'&time_zone=gmt&interval=60&units=english&format=json')
    pred = json.loads(_get(url).decode('utf8'))['current_predictions']['cp']

    flood = float(pred[0]['meanFloodDir'])
    ebb = float(pred[0]['meanEbbDir'])
    print(f'{station}  {st["name"]}')
    print(f'  {fmt_pos(lat, lon)}   bin {pred[0]["Bin"]} at {pred[0]["Depth"]} ft')
    print(f'  mean flood {flood:.0f}T, mean ebb {ebb:.0f}T\n')
    print(f'{"time UTC":>17} {"harmonic":>9} {"model along":>12} {"model kt":>9} '
          f'{"model set":>10}')

    fx, fy = math.sin(math.radians(flood)), math.cos(math.radians(flood))
    rows = []
    for p in pred:
        when = datetime.strptime(p['Time'], '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc)
        if not (cur.start <= when <= cur.end):
            continue
        got = cur.at(lat, lon, when)
        if got is None:
            continue
        kt, deg, u, v = got
        # project the model vector onto the station's flood axis: east/north
        # against a compass bearing, so north is y and east is x.
        along = (u * fx + v * fy) * MS_TO_KT
        harm = float(p['Velocity_Major'])
        rows.append((when, harm, along, kt, deg))
        print(f'{when:%Y-%m-%d %H:%MZ} {harm:9.2f} {along:12.2f} {kt:9.2f} {deg:10.1f}')

    if len(rows) < 6:
        print('\nnot enough overlapping hours to judge')
        return
    h = [r[1] for r in rows]
    m = [r[2] for r in rows]
    mh, mm = sum(h) / len(h), sum(m) / len(m)
    cov = sum((a - mh) * (b - mm) for a, b in zip(h, m))
    r = cov / math.sqrt(sum((a - mh) ** 2 for a in h) * sum((b - mm) ** 2 for b in m))
    rms = math.sqrt(sum((a - b) ** 2 for a, b in zip(h, m)) / len(h))
    # slack crossings, which is where a phase error would show up plainly
    def crossings(series):
        out = []
        for i in range(1, len(series)):
            a, b = series[i - 1], series[i]
            if a == 0 or (a < 0) != (b < 0):
                frac = abs(a) / (abs(a) + abs(b)) if (a or b) else 0
                out.append(rows[i - 1][0] + timedelta(hours=frac))
        return out
    ch, cm = crossings(h), crossings(m)
    print(f'\n{len(rows)} hours: correlation {r:+.3f}, RMS difference {rms:.2f} kt, '
          f'harmonic peak {max(abs(x) for x in h):.2f} kt vs model {max(abs(x) for x in m):.2f} kt')
    if ch and cm:
        pairs = [(a, min(cm, key=lambda b: abs((b - a).total_seconds()))) for a in ch]
        offs = [(b - a).total_seconds() / 60 for a, b in pairs]
        print(f'slack water: {len(ch)} harmonic turns, model turns offset by '
              f'{min(offs):+.0f} to {max(offs):+.0f} min '
              f'(mean {sum(offs) / len(offs):+.0f})')


# Delaware Bay: the entrance, the ship channel, and open shelf water.
DEFAULT_POINTS = [
    (38.7828, -75.1394),   # Lewes, DE — the ASV console's home berth
    (38.7817, -75.0900),   # Cape Henlopen, off the point
    (38.8600, -75.0300),   # Delaware Bay entrance, mid-channel
    (39.0800, -75.2400),   # up-bay, Ship John Shoal approach
    (38.6000, -74.9000),   # open shelf, outside the mouth
]


# --------------------------------------------------------------------------- #
#  CLI
# --------------------------------------------------------------------------- #
def _fmt_row(when, got):
    if got is None:
        return f'{when:%Y-%m-%d %H:%MZ}      —  (no water at this position)'
    kt, deg, u, v = got
    return (f'{when:%Y-%m-%d %H:%MZ} {kt:7.2f} kt  sets {deg:5.1f}°T'
            f'   (u {u:+.3f}, v {v:+.3f} m/s)')


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('--cache-dir', type=Path, default=CACHE)
    sub = p.add_subparsers(dest='cmd', required=True)

    s = sub.add_parser('cycles', help='list the cycles NOAA is serving')
    s.add_argument('--ofs', default='dbofs')

    s = sub.add_parser('fetch', help='cache a cycle')
    s.add_argument('--ofs', default='dbofs')
    s.add_argument('--date')
    s.add_argument('--cycle')
    s.add_argument('--bbox', help='lat0,lon0,lat1,lon1 (default: whole model box)')
    s.add_argument('--forecast-only', action='store_true')
    s.add_argument('--workers', type=int, default=6)

    s = sub.add_parser('point', help='current at one position')
    s.add_argument('--at', required=True, help='LAT,LON')
    s.add_argument('--time', help='ISO UTC; omit for the whole span')
    s.add_argument('--csv', type=Path)

    s = sub.add_parser('frame', help='one hour over the whole cached box, as CSV')
    s.add_argument('--time', required=True)
    s.add_argument('--csv', type=Path, required=True)
    s.add_argument('--stride', type=int, default=1)

    s = sub.add_parser('track', help='sample along a lat,lon,time CSV')
    s.add_argument('--csv', type=Path, required=True)
    s.add_argument('--out', type=Path)

    sub.add_parser('verify', help='run the rails')
    sub.add_parser('crosscheck', help='compare against the native ROMS fields')
    s = sub.add_parser('station', help='compare against CO-OPS harmonic predictions')
    s.add_argument('--station', default='DEB0002')

    a = p.parse_args(argv)
    cache = a.cache_dir

    if a.cmd == 'cycles':
        for datestr, cycle, hours in available_cycles(a.ofs):
            n = sum(1 for h in hours if '.n' in h.rsplit('.', 2)[1][:1] + '.n')
            f = sum(1 for h in hours if h.rsplit('.', 2)[1].startswith('f'))
            print(f'{datestr} t{cycle}  {len(hours):3d} files  '
                  f'({f} forecast, {len(hours) - f} nowcast)')
        return 0

    if a.cmd == 'fetch':
        bbox = tuple(float(x) for x in a.bbox.split(',')) if a.bbox else None
        fetch_cycle(a.ofs, a.date, a.cycle, bbox,
                    include_nowcast=not a.forecast_only, workers=a.workers, cache=cache)
        return 0

    if a.cmd == 'verify':
        return 0 if verify(cache=cache) else 1

    if a.cmd == 'crosscheck':
        crosscheck(cache=cache)
        return 0

    if a.cmd == 'station':
        station_check(a.station, cache=cache)
        return 0

    cur = Currents(cache=cache)

    if a.cmd == 'point':
        lat, lon = (float(x) for x in a.at.split(','))
        b = cur.box()
        print(f'{cur.tag}  box {fmt_span(b[0], b[2], "lat")}  '
              f'{fmt_span(b[1], b[3], "lon")}')
        print(f'span {cur.start:%Y-%m-%d %H:%MZ} -> {cur.end:%Y-%m-%d %H:%MZ} '
              f'({len(cur.times)} hourly frames)')
        print(f'position {fmt_pos(lat, lon)}\n')
        if a.time:
            when = parse_time(a.time)
            print(_fmt_row(when, cur.at(lat, lon, when)))
            return 0
        rows = []
        for when in cur.frame_times():
            got = cur.at(lat, lon, when)
            print(_fmt_row(when, got))
            rows.append((when.strftime('%Y-%m-%dT%H:%M:%SZ'),
                         '' if got is None else f'{got[0]:.3f}',
                         '' if got is None else f'{got[1]:.1f}',
                         '' if got is None else f'{got[2]:.4f}',
                         '' if got is None else f'{got[3]:.4f}'))
        speeds = [float(r[1]) for r in rows if r[1]]
        if speeds:
            print(f'\npeak {max(speeds):.2f} kt, mean {sum(speeds) / len(speeds):.2f} kt, '
                  f'slackest {min(speeds):.2f} kt')
        if a.csv:
            with open(a.csv, 'w', newline='', encoding='utf8') as fh:
                w = csv.writer(fh)
                w.writerow(['time_utc', 'speed_kt', 'set_deg_true', 'u_east_ms', 'v_north_ms'])
                w.writerows(rows)
            print(f'wrote {a.csv}')
        return 0

    if a.cmd == 'frame':
        when = parse_time(a.time)
        with open(a.csv, 'w', newline='', encoding='utf8') as fh:
            w = csv.writer(fh)
            w.writerow(['lat', 'lon', 'speed_kt', 'set_deg_true', 'u_east_ms', 'v_north_ms'])
            n = 0
            for iy in range(0, cur.ny, a.stride):
                lat = cur.lat0 + iy * cur.dlat
                for ix in range(0, cur.nx, a.stride):
                    lon = cur.lon0 + ix * cur.dlon
                    got = cur.at(lat, lon, when)
                    if got is None:
                        continue
                    w.writerow([f'{lat:.5f}', f'{lon:.5f}', f'{got[0]:.3f}',
                                f'{got[1]:.1f}', f'{got[2]:.4f}', f'{got[3]:.4f}'])
                    n += 1
        print(f'{when:%Y-%m-%d %H:%MZ}: wrote {n} water nodes to {a.csv}')
        return 0

    if a.cmd == 'track':
        out = []
        with open(a.csv, newline='', encoding='utf8') as fh:
            for row in csv.DictReader(fh):
                lat, lon = float(row['lat']), float(row['lon'])
                when = parse_time(row['time'])
                got = cur.at(lat, lon, when)
                out.append([row.get('name', ''), lat, lon,
                            when.strftime('%Y-%m-%dT%H:%M:%SZ'),
                            '' if got is None else round(got[0], 3),
                            '' if got is None else round(got[1], 1)])
                print(f'{row.get("name", ""):>12}  {_fmt_row(when, got)}')
        if a.out:
            with open(a.out, 'w', newline='', encoding='utf8') as fh:
                w = csv.writer(fh)
                w.writerow(['name', 'lat', 'lon', 'time_utc', 'speed_kt', 'set_deg_true'])
                w.writerows(out)
            print(f'wrote {a.out}')
        return 0

    return 1


if __name__ == '__main__':
    sys.exit(main())
