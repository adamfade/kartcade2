# ac-validate

This is a standalone validator for Assetto Corsa track packages. It was written from public and community knowledge of the AC modding formats, not from the code of any generator. It is plain Node 20+ ESM with no dependencies.

```
node validate.mjs <track-folder-or-zip> [--verbose] [--json]
npm test            # self-test: node test/selftest.mjs
```

- The input can be a track folder (`<id>/`) or a `.zip`. Inside a zip, the track root is found automatically, for example `<id>/...` or `content/tracks/<id>/...`.
- Exit codes: `0` means PASS or WARN only, `1` means at least one FAIL, and `2` means a usage error.
- Each line of the report is tagged `PASS`, `WARN`, `FAIL` or `INFO`, grouped by section. The last line gives the overall result. `--json` produces the same report as machine-readable JSON.
- File lookups ignore case, the same way AC behaves on Windows.

## Confidence scale

- **High**: widely documented and used by many tools (Content Manager / AcTools, kn5 converters, Blender importers). I'm confident about it.
- **Medium**: matches my understanding of community tooling and Kunos files, but I can't confirm the exact details here (this environment couldn't browse).
- **Low**: a best guess or a heuristic. Checks at this level only produce WARN, never FAIL.

## Checks

### Folder layout

| Check | Level | Confidence |
|---|---|---|
| Track root found (`ui/ui_track.json`, `<id>.kn5` or `models.ini`) | FAIL | High |
| Track id contains only lower-case letters, digits, `_` and `-` | WARN | Medium (convention, not a hard rule) |
| `<id>.kn5` present, or `models.ini` with `[MODEL_n] FILE=` entries that exist | FAIL | High |
| `models.ini` POSITION is applied to geometry; a non-zero ROTATION is ignored with a WARN | WARN | Medium |
| Multi-layout tracks: `ui/<layout>/ui_track.json`, `<layout>/data`, `<layout>/ai`, `<layout>/map.png`, `models_<layout>.ini` | — | Medium |
| `data/surfaces.ini` present | FAIL | High |
| `ui/ui_track.json` present | FAIL | High |
| `ui/preview.png`, `ui/outline.png` present and valid PNGs | WARN | High |
| `ai/fast_lane.ai` present | WARN | High |
| `map.png` (track root) is a valid PNG; `data/map.ini` present | FAIL | High that both files are used, medium that a missing one is fatal |
| `data/cameras.ini` present; optional data INIs parse | WARN | High |

### KN5 (full parse)

| Check | Level | Confidence |
|---|---|---|
| Magic `sc6969` | FAIL | High |
| Version 5 or 6; an extra int32 header field follows when version > 5 | WARN on another version | Medium-high (what the extra int means is unknown) |
| Textures: int32 active, string name, uint32 size, blob. Data should start with DDS/PNG/JPG magic | WARN | High |
| Materials: name, shader, u8 blend, u8 alphaTested, int32 depthMode, properties (name + 10 floats), mappings (name, int32 slot, texture) | parse FAIL | High |
| A mapping refers to a texture that isn't embedded | FAIL | High that it's a defect. AC may fall back to a blank texture rather than crash |
| Unknown shader name; missing usual `ks*` properties or texture slots | WARN | Medium (the shader list is incomplete) |
| NaN/Inf in material properties | FAIL | High |
| Node tree: class 1 dummy (16-float matrix), class 2 mesh, class 3 skinned | parse FAIL on unknown class | High for classes 1 and 2, **low for class 3 (skinned)** |
| Mesh layout: 3 flag bytes, vertices of 44 bytes (pos, normal, uv, tangent), uint16 indices, materialId, layer, lodIn/out, bounding sphere, renderable byte | parse FAIL | High |
| More than 65535 vertices in one mesh | FAIL | High (indices are uint16) |
| Index out of range; index count not a multiple of 3 | FAIL | High |
| NaN/Inf in positions or normals | FAIL | High |
| NaN in UVs or tangents; zero normals; degenerate triangles; lodIn > lodOut | WARN | High |
| materialId at or beyond the material count | FAIL | High |
| Vertices fall outside the stored bounding sphere | WARN | Medium (I assume the sphere is in mesh-local space) |
| Bytes left over after the root node | WARN | High |
| Report lists node, mesh, vertex and index counts per mesh, material, world-space bounding box, AC_ dummies, and textures | INFO | — |
| World transform = local matrix × parent matrix (row vectors, translation in elements 12–14) | — | Medium-high |

### Physics surfaces and dummies

| Check | Level | Confidence |
|---|---|---|
| A mesh whose name starts with a digit is treated as a physics mesh; the text after the digits must start with a `KEY` from surfaces.ini (longest key wins: `1ROAD`, `2KERB_inner`, `10GRASS`) | FAIL | Medium-high (the digit-prefix convention is well known; the exact matching rule in AC is not) |
| A key matches only when case is ignored, or only one of `ROAD`/`KERB`/`GRASS`/`SAND`, which I believe are in AC's `system/data/surfaces.ini` | WARN | Low (contents of the system surfaces file) |
| No physics meshes at all; no surface with IS_VALID_TRACK=1 | FAIL | High |
| No ROAD physics mesh | WARN | Medium |
| `AC_START_n`, `AC_PIT_n`, `AC_HOTLAP_START_0` present, numbered with no gaps | WARN | High on the names. Missing START/PIT is a WARN as requested, though AC is barely usable without them |
| ui `pitboxes` is greater than the number of AC_PIT/AC_START dummies | WARN | Medium |
| Spawn dummies sit 0–5 m above a physics surface | WARN | Medium (threshold is a heuristic) |
| `AC_TIME_n_L` and `_R` both present, numbered with no gaps; L–R gate width between 2 and 150 m | FAIL / WARN | High on the names, low on the width limits |
| Circuit: `AC_TIME_0_L/R` required | FAIL | High |
| Point-to-point is detected from any `AC_AB_*` dummy, or a ui `run`/`tags` value such as "A to B", "p2p" or "hill climb". It then requires `AC_AB_START_L/R` and `AC_AB_FINISH_L/R` | FAIL | Medium-high on the names, **low on detection from ui hints** |
| An AC_ name used on a mesh instead of a dummy | WARN | Medium |

### fast_lane.ai / pit_lane.ai

| Check | Level | Confidence |
|---|---|---|
| Header: int32 version (7), count, lapTime(?), sampleCount; then points of {vec3 pos, float length, int32 id} | parse FAIL | High on version, count and point layout. **Low on what fields 3–4 of the header mean** |
| Extra block: int32 count equal to the point count, then 18 floats per point (speed, gas, brake, latG, radius, sideLeft, sideRight, camber, direction, normal×3, length, forward×3, tag, grade) | FAIL on count mismatch or truncation | Medium (field order from memory of AcTools) |
| int32 has-grid flag after the extra block | FAIL if missing (the file is truncated; AC reads this flag) | High: layout matches AcTools' `AiSpline` reader |
| Grid block when the flag is set (extremes, neighbour count, density, rows of cells of point indices) | FAIL if malformed or an index is out of range | Medium |
| Bytes left after the grid | WARN | High |
| No NaN/Inf; at least 2 points (WARN under 50) | FAIL / WARN | High |
| `length` never decreases | FAIL | High |
| Length deltas match the distance between points within 5%; gaps over 20 m; ids equal to their index; first length about 0 | WARN | Medium |
| Circuit spline closes (last point near the first) | WARN | Medium |
| sideLeft/sideRight between 0 and 100 m; speed between 0 and 200 m/s | WARN | Medium (depends on the field order) |
| **Near the road**: nearest 3D distance from each point to the triangles of IS_VALID_TRACK=1 physics surfaces. More than the road width (sideLeft+sideRight, otherwise ui `width`, otherwise 12 m) is a FAIL. More than 1.5 m for over 5% of points is a WARN. Uses a uniform XZ grid, so it scales to large tracks | FAIL / WARN | High on the method, heuristic on the thresholds. Uses every valid-track surface, not only `1ROAD`, so racing lines that cross kerbs don't fail |
| pit_lane.ai: the same checks, against all physics surfaces | — | Medium |
| ui `length` against the spline length (within 10%) | WARN | Medium |
| Points projected with `(pos + X/Z_OFFSET) / SCALE_FACTOR` land inside map.png (plus MARGIN) | WARN | **Low (the projection formula is an assumption)** |

### surfaces.ini

| Check | Level | Confidence |
|---|---|---|
| At least one `[SURFACE_n]`; numbering starts at 0 with no gaps (AC may stop reading at the first gap) | FAIL / WARN | High on the section names, medium on the gap behaviour |
| `KEY` present, unique, upper-case, not starting with a digit | FAIL / WARN | High |
| `FRICTION` present and numeric (WARN outside 0–1.5) | FAIL | High |
| `DAMPING` numeric (WARN if missing or outside 0–1) | FAIL / WARN | High |
| `WAV` key present (may be empty); `IS_VALID_TRACK` 0 or 1; `IS_PITLANE` 0 or 1 | WARN / FAIL | High |
| `FF_EFFECT` is NULL or a number; other known keys (WAV_PITCH, DIRT_ADDITIVE, BLACK_FLAG_TIME, SIN_HEIGHT, SIN_LENGTH, VIBRATION_GAIN, VIBRATION_LENGTH) numeric; unknown keys | WARN | Medium |
| Defined surface keys that no mesh uses | INFO | — |

### ui_track.json

| Check | Level | Confidence |
|---|---|---|
| Strict JSON object (BOM allowed) | FAIL | Medium (Content Manager tolerates some broken JSON; AC's own launcher is stricter) |
| `name` present | FAIL | High |
| `description`, `country`, `city`, `length`, `width`, `pitboxes`, `run` present | WARN | High that these fields exist; requiredness is a judgement call |
| `length`, `width`, `pitboxes` are strings in Kunos tracks; numbers are accepted with an INFO | — | Medium-high |
| `pitboxes` is a positive integer | FAIL | High |
| `tags` is an array of strings; `geotags` is a 2–3 entry array; `year` is an integer | WARN | Medium |

### map.ini / map.png

| Check | Level | Confidence |
|---|---|---|
| `[PARAMETERS]` with numeric WIDTH, HEIGHT, X_OFFSET, Z_OFFSET, SCALE_FACTOR (> 0) | FAIL | High on the key names |
| MARGIN, DRAWING_SIZE, MAX_SIZE present and numeric | WARN | Medium |
| WIDTH/HEIGHT match the map.png size | WARN | Medium |

## Self-test

`test/writers.mjs` holds a minimal KN5, AI, PNG and zip writer. It exists only to build fixtures and mirrors this project's own reading of the formats, so it **cannot catch a misunderstanding shared by the reader and the writer**. Testing against real Kunos tracks would.

`test/selftest.mjs` builds a 200 m-radius ring circuit: a visual mesh, `1ROAD`, `1GRASS`, spawn dummies and a timing gate, plus an AI spline, surfaces.ini, ui_track.json, map.png and map.ini. It checks that:

- the folder, zip and point-to-point variants pass clean;
- 22 corrupted variants fail (or warn) with the expected message;
- the CLI exits 0 on a good track and 1 on a broken one.

The corrupted variants are: bad magic, truncated kn5, index out of range, NaN position, NaN normal, 65536 vertices, missing texture, bad material id, unknown physics key, missing surfaces.ini, non-numeric FRICTION, ui without a name, invalid JSON, no AC_TIME_0, half a timing gate, point-to-point without finish, AI off road, AI length going backwards, truncated AI, missing map.png, no kn5, and missing AI (WARN only).

## Least-certain format details

1. **Skinned mesh (class 3) layout**: the bone block and the fields after the indices. Tracks rarely use it, so it raises a WARN.
2. **fast_lane.ai header fields 3–4 and the extra-block field order**. Version 7 with 18 floats is my best recollection. The trailing has-grid flag and grid block are now parsed (layout checked against AcTools' `AiSpline`/`AiSplineGrid` readers); what AC does with a file whose flag is 0 is still unconfirmed in game.
3. **KN5 version-6 extra header int**: I'm sure it is there and 4 bytes long, but not what it means.
4. **Bounding sphere space** (mesh-local or world). Only a WARN depends on it.
5. **How AC matches physics names to keys** (prefix after the digits, case sensitivity) and **which keys AC's system surfaces.ini provides**.
6. **The map.ini projection formula** used for the "AI inside map.png" check.
7. **Point-to-point detection** when there are no `AC_AB_*` dummies.
