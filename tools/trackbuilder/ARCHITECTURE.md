# Track builder architecture: the realism pipeline

Goal: tracks that look as close to the real road as open data allows, built by staff in a browser.
This file says how the pieces fit, so new stages slot in without rework. Keep it current.

## Principles

1. **Build = pure function of stored inputs.** A track is rebuilt from: the project (pins or loop, options,
   placed elements), its *site data* (route line, elevation, imagery, map features), and the *material
   library*. Nothing is fetched during a build that isn't stored first, so rebuilds are repeatable and fast.
2. **Fetch once, in the browser, store in Firebase.** Source services (Poly Haven, USGS, OpenStreetMap)
   are reachable from browsers, not from the build sandbox. The admin page fetches, processes and stores:
   - material library: Storage `trackbuilder/library/<version>/<role>/{albedo,detail,normal,maps}.dds` + `manifest.json`
   - site data: Storage `trackbuilder/sites/<siteId>/` (siteId = hash of the route line, so projects on the same road
     share it): `manifest.json` (plan, fetch date, files), per cell `dem.png` (Terrarium-encoded 1 m DEM),
     `rgb.jpg` (NAIP 0.5 m), `nir.jpg` (near-infrared), and `overview/` (coarser DEM + imagery)
   - projects: Firestore `trackProjects`
3. **Licences we can ship.** Only CC0 / public-domain / ODbL-with-attribution data goes into a track:
   Poly Haven (CC0), USGS 3DEP and NAIP (public domain), OpenStreetMap (ODbL, credited in ui_track.json).
   Google Maps / Earth / Street View content is never copied, traced or stored (Map Tiles API policies);
   the editor only *links* to Street View for staff reference.
4. **AC-correct output.** DDS textures with full mip chains (BC1, BC3 for alpha), documented shader slots and
   properties (see "Materials"), meshes split under the 16-bit index limit, physics names `1KEY_…` matching
   `data/surfaces.ini`. Every build is checked by `tools/ac-validate` (written independently of the builder).
5. **The preview shows what AC will show.** `TrackPreview3D` renders the same meshes and DDS textures, with the
   same UV convention (v negated, rows top-first) and the same macro/detail blend.

## Materials

All ground surfaces use `ksPerPixelMultiMap_NMDetail` (`materials.ts: macroDetailMaterial`):

| Slot | Content | Scale |
|---|---|---|
| `txDiffuse` | macro: colour, wear, patches; alpha 0 = full detail | `MACRO_M[surface]` metres per repeat |
| `txDetail` | library albedo normalised to mean 0.5 | `detailUVMultiplier = macroSize / tileM` |
| `txNormalDetail` | library normal map (DirectX) | with the detail |
| `txNormal` | flat (macro normals later if needed) | macro |
| `txMaps` | R specular, G gloss, B reflection | macro or library |

AC (and Content Manager) blend `colour = macro.rgb * lerp(detail.rgb, 1, macro.a)`, so macro = target colour x 2
over a 0.5-mean detail. Mesh UVs are metres / `MACRO_M` (road-aligned for road, shoulder and paint; world
planar for verge and terrain, so aerial imagery can be the macro later). Paint is separate meshes 12 mm above
the asphalt with no physics.

Library roles (`LIBRARY_CATALOG`): asphalt, asphalt_track, gravel, grass, dirt, forest_floor, rock, concrete,
bark. Without an imported library, `proceduralEntry` supplies stand-ins with the same layout.

## Stages

| # | Stage | State |
|---|---|---|
| 1 | Photo-scanned material library, macro + detail surfaces, DDS, markings, gravel shoulder, CSP config | done |
| 2 | Street View reference links in the editor | done |
| 3 | Site data: USGS 3DEP 1 m elevation and NAIP aerial imagery (RGB + near-infrared), fetched in the browser and stored per route (`site.ts`, `siteStore.ts`); verge follows the lidar ground; aerial photo as the verge/terrain macro per 512 m cell with the road painted out (`ground.ts`); invisible boundary walls | done |
| 3b | Surface classes from imagery (forest floor, dirt, gravel drives), tree placement from near-infrared, a distant low-res terrain ring to the horizon | planned |
| 4 | OpenStreetMap features: buildings (footprints, heights, roofs), woods (dense billboard trees), mapped barriers and fences, water; all spatially chunked | planned |
| 5 | Vegetation and detail: billboard tree species, GrassFX tuning, LODs, roadside clutter (mailboxes, posts, signs from reference) | planned |

## Builds

The editor preview runs a geometry-only build on the page (`output: 'geometry'`: lazy textures, no KN5/zip). The
download runs the full build in a web worker (`heavy.worker.ts`, op `buildTrack`) from plain data: inputs,
Terrarium tiles, site rasters and the material library.

## Output layout

`<id>/<id>.kn5` (one model; meshes chunked), `data/surfaces.ini`, `data/cameras.ini`, `data/map.ini`, `map.png`,
`ui/ui_track.json` (+ outline, preview), `extension/ext_config.ini` (CSP: GrassFX, RainFX), `ai/fast_lane.ai`
(only with `--with-ai` until a rig test confirms it), `README.txt`.
