# Leaflet, vendored

Leaflet 1.9.4 (https://leafletjs.com, BSD-2-Clause, `LICENSE` beside this
file), the map engine under the Hub's board (docs/hub-plan.md D134). Two
files from the npm package `leaflet@1.9.4`, copied as published, nothing
changed:

| File | From | SHA-256 |
| --- | --- | --- |
| `leaflet-src.esm.js` | `dist/leaflet-src.esm.js` (the self-contained ES module, no imports) | `39ee93464f11fe3847137e50c0dc8189f706c460e36989ea7871bf7d540f3306` (hex) |
| `leaflet.css` | `dist/leaflet.css` | `p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=` (base64, the integrity value Leaflet's own install page gives) |

The board imports the module lazily (`src/systems/ui/hubBoard.js`) and
loads the stylesheet through `ensureCss('leaflet', …)`; the marker images
the stylesheet names are not shipped, since every node is a `divIcon`.

To update: copy the two files from the new package, update the version
and the hashes here, and run `node tools/hub-board-browser-test.mjs --shots`
(the one check that mounts Leaflet: a headless Chromium over the board's
module; look at its PNGs) and `node tools/lazy-graph-test.mjs` (the module
stays out of the startup graph).
