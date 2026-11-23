# The Corps' river catalog, shipped

`u37.xml` is the US Army Corps of Engineers' Inland ENC catalog
(`IENCU37ProductsCatalog.xml` on ienccloud.us), byte for byte as the Corps published
it and as the console read it on 2026-11-23: 109 river cells on 21 rivers, every
entry readable.

The console reads it only on a first run, when no catalog copy is kept in
`charts/ienc` and the Corps' host does not answer (`enc_cells.CellSource._shipped`).
It is read as a catalog past its age. Where it names no river cell, NOAA's charts
are read as they always were; where it names one, that cell is asked for, and with
the host silent its water is unread. It is never written as the copy kept. The first
catalog the console reads from the Corps replaces it.

To ship a newer one, copy a console's `charts/ienc/u37.xml` over this file, update the
date in `RiverCells.SHIPPED_CATALOG` (`enc_cells.py`), and run `tests/ienc_cells.py`.
Its check 1e confirms the copy reads whole.
