# S-57 object catalog tables

`s57.py` turns the numbers in an S-57 chart cell into names with these three tables. An object class code becomes an
acronym, for example 42 becomes DEPARE. An attribute code becomes an acronym, for example 87 becomes DRVAL1. An
enumerated value becomes its meaning, for example CATSLC 12 becomes "ramp".

| File | What it holds |
|---|---|
| `s57objectclasses.csv` | object class code, name, acronym, attribute sets, primitives |
| `s57attributes.csv` | attribute code, name, acronym, type (E enumerated, L list, F float, I integer, A/S text) |
| `s57expectedinput.csv` | attribute code, value id, meaning |

They are the IHO S-57 Edition 3.1 object catalog as the GDAL project publishes it. The files are copied unchanged
from GDAL v3.10.0, `ogr/ogrsf_frmts/s57/data/` (https://github.com/OSGeo/gdal). GDAL is licensed under the MIT terms
below; its LICENSE.TXT lists no exception for these files.

Two of the files are not in the same encoding: `s57attributes.csv` is UTF-8 and `s57expectedinput.csv` is Latin-1.
`s57.py` reads each file as UTF-8 first and falls back to Latin-1.

## GDAL's license (MIT)

> In general GDAL/OGR is licensed under an MIT style license with the following terms:
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of
> the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
> WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Chart cells are not kept here

NOAA's cells are not committed to this repository. NOAA's user agreement discourages re-hosting its charts for
distribution. A cell is read from NOAA's own zip (charts.noaa.gov/ENCs/<CELL>.zip). Any copy kept locally goes in the
chart cache (`charts/`), which git ignores.
