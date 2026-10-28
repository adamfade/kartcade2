# Track builder CLI

Runs the same pipeline as `/admin/track-builder`, from Node 22+ (the `.ts` files run directly).

```
npm run track -- --name "Pete's Mountain Rd" \
  --start 45.33970,-122.65450 \
  --via 45.33466,-122.67690 --via 45.32645,-122.67800 \
  --end 45.30640,-122.68060 \
  --out ./tracks
```

A circuit, from a traced lap (GPX, KML or GeoJSON):

```
npm run track -- --circuit --name "Mac Track" --trace mac_track.geojson --width 8 --out ./tracks
```

This writes `./tracks/petes_mountain_rd.zip` plus the unzipped `./tracks/petes_mountain_rd/` folder, and prints the
stats as JSON.

## Options

| Flag | Meaning |
|---|---|
| `--name "..."` | Track name. The folder id is derived from it (`petes_mountain_rd`). |
| `--start lat,lon` / `--end lat,lon` | Start and finish pins. |
| `--via lat,lon` | Via pin; repeatable, in order. Use these to keep the route on the road you mean. |
| `--from "place"` / `--to "place"` | Geocode the start/end with Nominatim instead of coordinates. |
| `--width 7` | Road width in metres (skips the OSM lookup). |
| `--no-overpass` | Don't ask Overpass for width/lanes; use 6.5 m unless `--width` is given. |
| `--flip-start` | Reverse the spawn direction if cars face backwards in game (roads). |
| `--circuit` | Build a closed lap track. Needs `--trace`, or `--start` plus `--via` pins around the loop (joined directly, not routed). |
| `--trace file` | GPX (track, route or waypoints), KML (longest line) or GeoJSON (longest LineString or a Polygon's outer ring). Without `--circuit` it builds a road from the trace instead of routing. |
| `--start lat,lon` with `--trace --circuit` | Moves the start/finish line to the trace point nearest this. |
| `--reverse` | Drive it the other way. A circuit keeps its start/finish point. |
| `--grid 12` | Circuit grid slots and pit boxes (default 12). |
| `--with-ai` | Include `ai/fast_lane.ai`, which is off by default until a rig test confirms it. For test builds. |
| `--out dir` | Output folder (default `./tracks-out`). |

## Network

The CLI fetches only from these domains:

- `nominatim.openstreetmap.org`: only with `--from` / `--to`
- `router.project-osrm.org`: the route
- `overpass-api.de`: width and lanes. Optional; a failure falls back to 6.5 m.
- `s3.amazonaws.com` (`elevation-tiles-prod`): elevation tiles, about 8 for a 6 km road
- `server.arcgisonline.com`: used only by the admin page's optional aerial map view, never by the CLI or the
  build

Every request sends the User-Agent `KartcadeTrackBuilder/0.1 (+https://www.kartcade.com; info@kartcade.com)`.

A build makes one OSRM request, one Overpass request and a handful of tile requests. Please keep it that way;
these are free community services.

Behind an HTTP(S) proxy, Node's `fetch` ignores `HTTPS_PROXY` unless you set `NODE_USE_ENV_PROXY=1`:

```
NODE_USE_ENV_PROXY=1 npm run track -- ...
```

## Tests

```
npm run test:trackbuilder
```
