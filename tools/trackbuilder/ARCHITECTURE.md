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
     `rgb.jpg` (NAIP 0.5 m), `nir.jpg` (near-infrared), `overview/` (coarser DEM + imagery), `osm.json.gz`
     (OpenStreetMap buildings, woods, trees, barriers and water over the overview square, plus the drivable roads
     and street furniture along the route; `OSM_VERSION` bumps refetch it), and per cell `surface.png` +
     `class.png` with `surface.json` (lidar surface, below). Sites stored before a layer existed get it on their
     next load.
   - projects: Firestore `trackProjects`
3. **Licences we can ship.** Only CC0 / public-domain / ODbL-with-attribution data goes into a track:
   Poly Haven (CC0), USGS 3DEP DEM, point cloud and NAIP (public domain), OpenStreetMap (ODbL, credited in
   ui_track.json).
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
bark, siding, roof, metal_roof, brick, wood. Without an imported library, `proceduralEntry` supplies stand-ins with
the same layout. Adding a role means re-running Import materials on the admin page.

Buildings and barriers use the same NMDetail recipe: the macro carries colour and windows (window texels have
alpha 1, so no siding grain on the glass) and the library supplies siding, brick, shingle or steel detail. Trees are
`ksPerPixelAT` billboards (two crossed double-sided quads, normals up) on a BC3 atlas whose mips preserve alpha
coverage (`MipKind 'cutout'`), so forests don't thin out with distance.

## Stages

| # | Stage | State |
|---|---|---|
| 1 | Photo-scanned material library, macro + detail surfaces, DDS, markings, gravel shoulder, CSP config | done |
| 2 | Street View reference links in the editor | done |
| 3 | Site data: USGS 3DEP 1 m elevation and NAIP aerial imagery (RGB + near-infrared), fetched in the browser and stored per route (`site.ts`, `siteStore.ts`); verge follows the lidar ground; aerial photo as the verge/terrain macro per 512 m cell with the road painted out (`ground.ts`); invisible boundary walls | done |
| 3b | Trees from the near-infrared canopy where there is no lidar; ground classes from the aerial photo: each region's ground is `ksMultilayer` with a mask (R grass, G pavement, B dirt, A forest floor) classified from the photo, near-infrared, lidar heights and mapped parking/parks (`ground.ts`), GrassFX bound to the mask; rivers and lakes as a water mesh (CSP water shader); a 40 km horizon ring from coarse 3DEP + NAIP with earth curvature (`horizon.ts`) | done |
| 4 | OpenStreetMap features (`osm.ts`, `features.ts`): buildings from footprints with levels/height tags, gable roofs on rectangles, hip otherwise, flat on big buildings; woods filled with billboard trees (denser near the road, smaller where they would overhang it, far ones thinned and LOD'd out); single trees and tree rows; guard rails, fences, walls and hedges with gaps at the road. Chunked into 256 m cells; collision (`1WALL_*`) only within 45 m of the road. Water is fetched and stored for stage 3b | done |
| 4b | The road as mapped (`roadinfo.ts`): each centreline sample matched to its OSM way; width from lanes, parking and bike lanes (tapered over 40 m); lane lines per US practice (double yellow, two-way turn lane, white dashed lane lines, solid beside turn pockets, kerbside lines); raised concrete sidewalks on urban streets | done |
| 4c | Bridges (`bridge.ts`): the deck levelled across the gap (bare-earth DEMs drop to the river); kerbed walkways, parapets with collision, deck slab; beam bridges on piers, arch (through arch on long spans: ribs, hangers, struts) or steel truss, chosen per bridge in the editor | done |
| 4d | Streets (`streets.ts`): side-street stubs at every junction; mast-arm signals (far-right corner, a head per lane, street name blade; static green for the route, red for side streets); stop and yield signs with stop lines; crosswalks (continental or two lines); lane-use arrows; speed limit signs where the limit changes; street lights; bus stops | done |
| 4e | Lidar surface (`lidar.ts`): the 3DEP point cloud (EPT on AWS) fetched along the corridor (~120 m each side) and rasterised to height-above-ground + class per cell, datum-checked against the DEM. Gives real roof heights and shapes, unmapped buildings (tall, non-vegetation blobs), and every tree as a lidar treetop with its real height and crown shape (pointed = conifer) | done |
| 5 | Trees (`trees.ts`): Douglas fir, western red cedar, bigleaf maple, Oregon white oak and street trees as card-based 3D models within ~25 m of the road, handing over (KN5 `lodIn`/`lodOut` on 96 m chunks) to billboards rendered in software from the same models | done |
| 5b | Buildings (`buildings.ts`): roof colour read from the aerial photo; framed windows with sills (a third lit at night), front doors with steps or porches, garage doors, eaves (fascia, soffit, rake boards), chimneys; storefronts for OSM shops/amenities with glass, bulkhead, a sign with the business name and awnings; the driver's own facade photos for landmarks | done |
| 5c | Roadside (`roadside.ts`): kerbs and concrete gutters on town streets (`mesh.ts`); wooden utility poles (OSM, plus lidar spikes that string to a neighbour) with power and phone wires; cobra-head lamps (lidar 6.5-9.5 m poles, some utility poles); hydrants; rural mailboxes; parked cars in OSM parking lanes and lots; driveways to road-facing garages; tactile kerb-ramp panels at crosswalks | done |
| 5d | Road surface (`roadsurface.ts`): real repair patches read from the aerial photo, tar crack sealant, manholes, storm drains; worn, alpha-tested paint | done |
| 5e | Night (CSP): light series for street lamps, porch lights and shop windows; emissive adjustments for lit windows, shop glass, signs and lamp lenses on `NIGHT_SMOOTH` (from CSP's `common/conditions.ini`, included at the top); CSP tiling fix on photo-detail materials; per-pixel fog on the horizon | done |
| 5f | Review (`ReviewPanel.tsx`): notes pinned in the preview with a view-from-the-road and a Street View compare (same spot, facing the pin), a copyable checklist; facade photos; the preview honours `lodIn`/`lodOut` | done |
| 5g | Compare (`StreetViewPane.tsx`, `DriveVideoPane.tsx`, `drivelog.ts`, `warp.ts`): Google's Street View viewer beside the preview, following ground view (embedded, never stored); the driver's own video with its GPS log driving ground view frame by frame (`follow`, `onViewChange` on the preview), notes at the video's spot, and frames straightened into facade photos | done |
| 5h | Drivable surroundings: 150 m lidar verges (`DRIVABLE_M`) and end aprons, paved ground split to road grip (`groundClassAt`, `splitWhere`), all nearby OSM streets as road, one-sided inward boundary walls (two layers), solid terrain and a map-edge wall as a backstop, things seated on the built surface (`surface.ts`), named businesses | done |
| 5i | Pavement edges from the aerial photo (`edges.ts`): recentre the line on the asphalt and measure its width where both edges are traced, within limits of the mapped width | done |

## Builds

Both builds run in a web worker (`heavy.worker.ts`) from plain data: inputs, Terrarium tiles, site rasters and the
material library. The preview (op `buildPreview`) is geometry-only (`output: 'geometry'`: lazy textures, no KN5 or
zip) and comes back through `portable.ts`, which turns the geometry's functions into tables. The download (op
`buildTrack`) packs the full track.

Source priority for surroundings: lidar surface, then near-infrared canopy, then OpenStreetMap woods and trees.

LOD and budget: 3D tree models only near the road (default cap 1,500) and drawn to 230 m, their billboards from
200 m; window, door and trim detail only on buildings within 150 m of the road, drawn to 900 m; far building
chunks to 4 km; wires to 900 m, small roadside items and lot cars to 600 m; road decals to 250 m.
Buildings always come from OSM footprints (lidar sets their heights), plus lidar-only buildings where OSM has none.

## Output layout

`<id>/<id>.kn5` (one model; meshes chunked), `data/surfaces.ini`, `data/cameras.ini`, `data/map.ini`, `map.png`,
`ui/ui_track.json` (+ outline, preview), `extension/ext_config.ini` (CSP: GrassFX bound to the ground mask, RainFX,
water, night lights and glowing materials, tiling fix, horizon fog), `ai/fast_lane.ai`
(only with `--with-ai` until a rig test confirms it), `README.txt`.
