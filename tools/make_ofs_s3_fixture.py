"""Write tests/fixtures/ofs_s3/*.nc - four tiny frames of a made-up model "tstofs" laid out the way NOAA's OFS
regulargrid files on its S3 bucket are (measured 2026-10-09 on wcofs, gomofs, dbofs, leofs and sscofs): superblock 2,
creation-order-tracked root group with more than 8 links (so the links are DENSE - fractal heap + v2 B-tree), contiguous
float64 Latitude/Longitude/mask/Depth, `time` chunked (512,) with enough attributes to go dense too, and u_eastward /
v_northward chunked (1, nz, cy, cx) WITHOUT compression, fill -99999. Chunks of 6 x 4 on a 13 x 10 grid leave partial
chunks at both far edges, as NOAA's do.

DEV-ONLY: this needs h5py (pip), which the console itself never does - ofs_s3.py reads these with the standard library.
The values are a formula (VALUE below), so the suite checks ofs_s3 against arithmetic, not against itself.

    python tools/make_ofs_s3_fixture.py        # rewrites the four files
"""
import os
import numpy as np
import h5py

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "tests", "fixtures", "ofs_s3")
NY, NX, NZ = 13, 10, 3
LAT0, LON0, D = 40.0, -70.0, 0.01
EPOCH_UNITS = "seconds since 2018-01-01 00:00:00"      # NOT currents' 2016 epoch: the reader must convert
CYCLE_S = 276739200.0                                  # 2026-10-09T00:00Z in seconds since 2018-01-01
FRAMES = [("n006", 0), ("f001", 1), ("f002", 2), ("f003", 3)]   # (file token, hours after the cycle hour)
LAND = {(0, 0), (0, 1), (12, 9), (7, 5)}               # mask 0, u/v at the fill value


def value(k, y, x):
    """The surface u and v of frame k at node (y, x) - what the suite expects back."""
    return 0.10 * y + 0.01 * x + 0.5 * k, -(0.05 * y + 0.02 * x) - 0.25 * k


def write(token, k):
    path = os.path.join(OUT, "tstofs.t00z.20261009.regulargrid.%s.nc" % token)
    # a 1.8 low bound gives superblock 2, as NOAA's files have ("earliest" wrote superblock 0)
    with h5py.File(path, "w", libver=("v108", "v108"), track_order=True) as f:
        lat = np.array([[LAT0 + D * y for _ in range(NX)] for y in range(NY)])
        lon = np.array([[LON0 + D * x for x in range(NX)] for _ in range(NY)])
        mask = np.ones((NY, NX))
        for (y, x) in LAND:
            mask[y, x] = 0.0
        for name, data in (("Latitude", lat), ("Longitude", lon), ("mask", mask), ("h", np.full((NY, NX), 10.0))):
            ds = f.create_dataset(name, data=data, dtype="<f8", track_order=True)
            ds.attrs.create("units", np.bytes_("degrees"))
        f.create_dataset("Depth", data=np.arange(NZ, dtype="<f8"), dtype="<f8", track_order=True)
        f.create_dataset("nx", data=np.arange(NX, dtype="<f8"))
        f.create_dataset("ny", data=np.arange(NY, dtype="<f8"))
        t = f.create_dataset("time", data=np.array([CYCLE_S + 3600.0 * k]), dtype="<f8", chunks=(512,),
                             maxshape=(None,), track_order=True)
        for i, (key, text) in enumerate((("long_name", "time"), ("units", EPOCH_UNITS), ("calendar", "gregorian"),
                                         ("standard_name", "time"), ("axis", "T"), ("field", "time, scalar, series"),
                                         ("comment", "fixture"), ("source", "make_ofs_s3_fixture"),
                                         ("valid_min", "0"), ("valid_max", "1e12"))):
            t.attrs.create(key, np.bytes_(text))
        for name, comp in (("u_eastward", 0), ("v_northward", 1)):
            arr = np.full((1, NZ, NY, NX), -99999.0, dtype="<f4")
            for y in range(NY):
                for x in range(NX):
                    if (y, x) in LAND:
                        continue
                    for z in range(NZ):
                        arr[0, z, y, x] = value(k, y, x)[comp] + (100.0 * z)   # deeper layers must never be read
            ds = f.create_dataset(name, data=arr, dtype="<f4", chunks=(1, NZ, 6, 4), fillvalue=-99999.0,
                                  track_order=True)
            ds.attrs.create("units", np.bytes_("m s-1"))
        f.create_dataset("zeta", data=np.zeros((1, NY, NX)), dtype="<f4")
        f.create_dataset("temp", data=np.zeros((1, NZ, NY, NX)), dtype="<f4", chunks=(1, NZ, 6, 4))
    return path


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for token, k in FRAMES:
        p = write(token, k)
        print("wrote", os.path.relpath(p, os.path.dirname(HERE)), os.path.getsize(p), "bytes")
