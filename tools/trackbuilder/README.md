# Track builder

Turns a stretch of real road into an Assetto Corsa point-to-point track, or a real circuit into a lap track.
For a road, pick a start and a finish (plus via pins); for a circuit, give it the loop (an OpenStreetMap
raceway, a GPX/KML/GeoJSON trace, or pins joined directly). It builds a drivable track on the real elevation
profile, packed as a zip ready for `assettocorsa/content/tracks`.

Two ways to run it, sharing the same library:

- **Admin page:** `/admin/track-builder` on the Kartcade site (admins only; there's a "Track builder" button in the
  dashboard's admin bar). Everything runs in the browser, and the zip downloads directly.
- **CLI:** `npm run track -- ...`. See [CLI.md](CLI.md).

## Data sources and licenses

| What | Source | License / terms |
|---|---|---|
| Search | Nominatim (nominatim.openstreetmap.org) | OSM data, ODbL. Usage policy: max 1 request/second, no bulk geocoding. The page only searches when you press Search. |
| Route along the road | OSRM demo server (router.project-osrm.org) | OSM data, ODbL. Demo server: light use only, no heavy or automated traffic. |
| Road width and lanes (optional) | Overpass API (overpass-api.de) | OSM data, ODbL. If Overpass fails, the build falls back to 6.5 m. You can also type a width. |
| Circuit outline (optional) | Overpass API, `highway=raceway` ways near the map centre | OSM data, ODbL. Admin page only. Overpass is blocked from the build sandbox, so this lookup is untested against the live API. |
| Elevation | AWS Terrain Tiles, Terrarium encoding (s3.amazonaws.com/elevation-tiles-prod), zoom 14 | Open data. Attribution for the underlying sources (USGS 3DEP/NED in the US, and others) is listed at https://github.com/tilezen/joerd/blob/master/docs/attribution.md |
| Map display | OpenStreetMap standard tiles | ODbL / OSM tile usage policy. Shown in the page only. |
| Aerial view (off by default) | Esri World Imagery (server.arcgisonline.com) | Esri terms. **Map display only**: it is never baked into the track. |

Every track's `ui_track.json` and `README.txt` carry the OSM attribution ("© OpenStreetMap contributors, ODbL").
Textures are generated in code (asphalt with lines, grass, concrete), so the output contains no third-party
imagery.

No code was copied from other track generators.

## What it outputs

```
<track_id>/
  <track_id>.kn5        model: road, grass verges, walls (KN5 v5, ksPerPixel, textures embedded)
  ai/fast_lane.ai       AI line along the centre (v7). Left out by default until confirmed in game; --with-ai adds it
  data/surfaces.ini     ROAD / GRASS / WALL
  data/cameras.ini      3 replay cameras
  data/map.ini, map.png minimap
  ui/ui_track.json      name, length, width, "A to B" run, OSM attribution
  ui/outline.png, ui/preview.png
  README.txt
```

Model details:

- **Physics meshes:** `1ROAD_n`, `1GRASS_L_n`, `1GRASS_R_n`, `1WALL_L`, `1WALL_R`, `1WALL_ENDA`, `1WALL_ENDB`.
- **Spawns and gates (road):** `AC_START_0`, `AC_PIT_0`, `AC_HOTLAP_START_0`. Timing gates `AC_AB_START_L/R` and
  `AC_AB_FINISH_L/R` sit 25 m from each end, with matching `AC_TIME_0/1_L/R` dummies.
- **Spawns and gates (circuit):** start/finish gate `AC_TIME_0_L/R` at the first point of the loop. A staggered
  grid `AC_START_0..N-1` forms up behind it (7 m rows, pole on the left; 12 slots by default, fewer if the lap is
  short). Pit boxes `AC_PIT_0..N-1` share the grid spots, since there is no pit lane. `AC_HOTLAP_START_0` is up
  to 120 m before the line.
- **Verges never overlap:** each verge is cut off where it would get closer to another part of the same road
  (a hairpin's other leg, a parallel straight) than to its own, and the wall goes there. Circuits also get a
  flat grass floor under everything so infield gaps aren't sky.
- **Road shape:** gentle crown, banking up to 4°, 1 m shoulders, 40 m of grass each side, and walls at the edge of
  the grass.
- **Elevation:** smoothed with a median filter, then a Gaussian (sigma 18 m), and grades are clamped at 22%. Real
  DEM noise would otherwise make bumps.

## Circuit mode

Race and karting circuits aren't routable (OSRM won't drive onto a raceway), so a circuit is built from a traced
loop instead of a route:

- **Admin page:** switch to *Circuit (laps)*, then *Find raceway at map centre* (OSM `highway=raceway`), *Load
  GPX / KML / GeoJSON*, or click points around the loop. *Set start/finish* moves the line. Width defaults to 8 m.
- **CLI:** `--circuit --trace lap.gpx --width 8`. See [CLI.md](CLI.md).

Differences from a road build: the loop closes (meshes, walls and the AI line join at the line), no end walls,
lap timing at `AC_TIME_0`, 12 pit boxes, verges of 25 m, banking capped at 2°, elevation smoothed over 12 m and
continuous across the line. `ui_track.json` says `clockwise` or `counter-clockwise`. *Drive the loop the other
way round* (`--reverse`) keeps the same start/finish point.

Circuit limits: no pit lane, no kerbs, one width all the way round, and the ~10 m elevation data means a kart
track's real camber and dips won't show. For Mac Track, a 1 m DOGAMI LiDAR DEM would be the upgrade.

## Limits

- **One road only.** No junctions, side roads, buildings, trees, barriers or signs; the land beyond the verge is
  flat grass at road height.
- **One AI line** down the centre, with speeds from curvature. Not in the default build until a recorded
  line confirms the format (v1 crashed AC in `Track::initAISpline`; the writer was missing the trailing
  has-grid flag, now fixed). No pit lane; one pit box at the start of a road.
- **Width:** single width for the whole track (OSM `width`, else `lanes` × 3.25 m, else 6.5 m). The live
  Overpass call is optional and was blocked from the build sandbox, so it is untested against the live API.
- **Elevation:** ~10 m DEM resolution at zoom 14. Cuttings and bridges come out as the ground under them.
- **Route length:** the elevation fetch is capped at 64 tiles, roughly 15–20 km of road.
- **Public services:** Nominatim and the OSRM demo are rate-limited community services. Fine for a few builds; not
  for automation.
- **Night lighting:** none. No CSP / Shaders Patch extension config.

## Tests

`npm run test:trackbuilder` runs the Node tests on a synthetic winding hill road and a synthetic 1 km kart
circuit: centreline (open and closed), widths, PNG and Terrarium decode, grade clamp, full builds with a KN5
read-back, required node names, the AI file layout, verge overlap, trace parsing (GPX, KML, GeoJSON), zip
contents and ui_track.json.

The Pete's Mountain Rd build (West Linn, 5.77 km, 252 m of climb) was also checked with a separate validator
written independently from these formats. It passed with no failures or warnings, and the browser build matched
the CLI build.

## Test plan for Ad on a rig

Nothing here has been loaded in Assetto Corsa yet. Allow about 20 minutes.

1. **Install.** Build Pete's Mountain Rd on `/admin/track-builder` (the default pins) or use the zip you were sent.
   Unzip so that `assettocorsa\content\tracks\petes_mountain_rd\petes_mountain_rd.kn5` exists.
2. **It appears.** Open Content Manager → Drive → Tracks. "Pete's Mountain Rd" should be listed with its outline,
   preview and 5.77 km length. *Screenshot the track card.*
3. **It loads.** Start a Practice session with any road car (e.g. a Mazda MX-5). If it fails, copy the CM error and
   the end of `Documents\Assetto Corsa\logs\log.txt`.
4. **Spawn.** Check the car sits on the road at the start, facing downhill along the road (not into the grass).
   - If it faces backwards, rebuild with **Flip start direction** ticked and report it.
   - *Screenshot from the cockpit.*
5. **Drive it.** Drive to the finish. Look for:
   - the road surface feeling normal (not grass-slippery)
   - grass feeling slippery
   - walls stopping you
   - no falling through the world
   - no sudden steps in the road
   Note anywhere it feels wrong (distance from start, or a screenshot).
6. **Timing.** Confirm a time appears when you cross the finish. If not, note whether the timer started at all.
7. **AI.** Start a Quick Race with 1–2 AI. Check they drive the road and don't stall or drive into the grass. A
   wobbly AI is expected with a simple line; stopping or reversing is not.
8. **Minimap.** Check the minimap shows the road shape and your car dot follows it (not mirrored).
9. **Report.** Send what passed/failed with the screenshots. The likely fixes are small (start direction, map
   orientation, AI layout), and a rebuild takes seconds.
