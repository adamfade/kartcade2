// Turns a road (polyline + heights) into a ready-to-install Assetto Corsa track folder and zip.

import { zipSync } from 'fflate';
import { buildCenterline, signedArea } from './route.ts';
import { roadProfile } from './elevation.ts';
import type { HeightSampler, Profile } from './elevation.ts';
import { buildGeometry } from './mesh.ts';
import type { MeshPart, TrackGeometry } from './mesh.ts';
import { trackMaterials, writeKn5 } from './kn5.ts';
import type { Kn5Material, Kn5Texture } from './kn5.ts';
import { buildElements } from './elements.ts';
import { buildTerrain } from './terrain.ts';
import type { ElementBuild, TrackElement } from './elements.ts';
import { writeFastLane } from './aiLine.ts';

export const INCLUDE_AI = false;
import { asphaltTexture, concreteTexture, grassTexture } from './textures.ts';
import { drawPolyline, encodePNG, makeImage } from './png.ts';
import type { LatLon } from './geo.ts';
import type { Centerline } from './route.ts';

export interface BuildInput {
    name: string;
    /** Folder/file id; lowercase letters, digits and underscores. Derived from name if omitted. */
    id?: string;
    polyline: LatLon[];
    heightSampler: HeightSampler;
    width: number;
    city?: string;
    country?: string;
    walls?: boolean;
    flipStart?: boolean;
    /** Circuit: treat the polyline as a closed loop. The first point is the start/finish line. */
    circuit?: boolean;
    /** Drive the route the other way round (start becomes finish; a circuit runs the opposite direction). */
    reverse?: boolean;
    /** Circuit: grid slots and pit boxes (default 12). */
    gridSlots?: number;
    /** Include ai/fast_lane.ai. Defaults to INCLUDE_AI; set true to build a test copy with the AI line. */
    includeAi?: boolean;
    /** Placed scenery (guard rails, trees, signs, banners). */
    elements?: TrackElement[];
    /** Visual terrain around the track from the elevation data (default true). */
    terrain?: boolean;
    log?: (msg: string) => void;
}

export interface BuildResult {
    id: string;
    files: Record<string, Uint8Array>; // paths relative to the zip root, inside <id>/
    zip: Uint8Array;
    stats: { lengthM: number; climbM: number; descentM: number; maxGradePct: number; widthM: number; minElevM: number; maxElevM: number; triangles: number };
    centerline: Centerline;
    profile: Profile;
    geometry: TrackGeometry;
    /** Scenery meshes, textures and materials (also inside the KN5). */
    elements: ElementBuild;
    /** Visual terrain meshes (also inside the KN5). */
    terrain: MeshPart[];
    /** The base textures and materials (road, grass, wall), for previews. */
    textures: Kn5Texture[];
    materials: Kn5Material[];
}

export function trackId(name: string) {
    const s = name.toLowerCase().normalize('NFKD').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    return s || 'real_road';
}

const ini = (sections: Record<string, Record<string, string | number>>) =>
    Object.entries(sections).map(([h, kv]) => `[${h}]\n${Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n')}\n`).join('\n');

function surfacesIni() {
    const base = { WAV: '', WAV_PITCH: 0, FF_EFFECT: 'NULL', DIRT_ADDITIVE: 0, IS_PITLANE: 0, BLACK_FLAG_TIME: 0, SIN_HEIGHT: 0, SIN_LENGTH: 0, VIBRATION_GAIN: 0, VIBRATION_LENGTH: 0 };
    return ini({
        SURFACE_0: { KEY: 'ROAD', FRICTION: 0.97, DAMPING: 0, ...base, IS_VALID_TRACK: 1 },
        SURFACE_1: { KEY: 'GRASS', FRICTION: 0.6, DAMPING: 0.1, ...base, WAV: 'grass.wav', WAV_PITCH: 0, DIRT_ADDITIVE: 1, IS_VALID_TRACK: 0, SIN_HEIGHT: 0.03, SIN_LENGTH: 0.5, VIBRATION_GAIN: 1, VIBRATION_LENGTH: 1.5 },
        SURFACE_2: { KEY: 'WALL', FRICTION: 0.3, DAMPING: 0, ...base, IS_VALID_TRACK: 0 },
    });
}

export function buildTrack(input: BuildInput): BuildResult {
    const log = input.log ?? (() => {});
    const id = input.id ?? trackId(input.name);
    const circuit = !!input.circuit;
    let polyline = input.reverse ? input.polyline.slice().reverse() : input.polyline;
    // Reversing a loop keeps the same start/finish point.
    if (circuit && input.reverse) polyline = [polyline[polyline.length - 1], ...polyline.slice(0, -1)];
    log(circuit ? 'Smoothing the circuit loop' : 'Smoothing the centerline');
    const cl = buildCenterline(polyline, { spacing: circuit ? 1 : 2, closed: circuit });
    const ll = cl.points.map((p) => cl.projection.toLatLon(p));
    log(`Sampling elevation along ${(cl.length / 1000).toFixed(2)} km`);
    const profile = roadProfile(ll, cl.s, input.heightSampler, circuit ? { closed: true, loopLength: cl.length, sigmaM: 12 } : {});
    const ground = (x: number, y: number) => input.heightSampler(cl.projection.toLatLon({ x, y }));
    log('Building road, verges and walls');
    const geometry = buildGeometry(cl, profile.heights, {
        width: input.width, walls: input.walls ?? true, ground, flipStart: circuit ? false : input.flipStart,
        gridSlots: input.gridSlots, ...(circuit ? { verge: 25, maxBankDeg: 2 } : {}),
    });
    const pitboxes = geometry.dummies.filter((d) => d.name.startsWith('AC_PIT_')).length;
    const clockwise = circuit && signedArea(cl.points) < 0;

    const terrain = input.terrain === false ? [] : buildTerrain(cl, geometry, { ground: (x, y) => input.heightSampler(cl.projection.toLatLon({ x, y })) });
    if (terrain.length) log('Adding the surrounding terrain');
    const elements = buildElements(cl, geometry, input.elements ?? []);
    if (input.elements?.length) log(`Placed ${input.elements.length} scenery item${input.elements.length === 1 ? '' : 's'}`);
    elements.warnings.forEach((w) => log(w));
    const triangles = [...geometry.parts, ...elements.parts].reduce((a, p) => a + p.indices.length / 3, 0);
    log('Writing the KN5 model');
    const textures: Kn5Texture[] = [
        { name: 'asphalt.png', data: asphaltTexture(256, { centreLine: !circuit }) }, // circuits: edge lines only
        { name: 'grass.png', data: grassTexture() },
        { name: 'wall.png', data: concreteTexture() },
    ];
    const materials = trackMaterials();
    const kn5 = writeKn5({
        textures: [...textures, ...elements.textures],
        materials: [...materials, ...elements.materials],
        meshes: [...geometry.parts, ...elements.parts, ...terrain],
        dummies: geometry.dummies,
    });

    log('Writing the AI line');
    const half = input.width / 2;
    const aiPts = cl.points.map((p, i) => ({ x: p.x, y: geometry.roadHeightAt(i, 0), z: p.y }));
    const grade = profile.heights.map((h, i) => {
        if (i > 0) return (h - profile.heights[i - 1]) / (cl.s[i] - cl.s[i - 1] || 1);
        return circuit ? (h - profile.heights[profile.heights.length - 1]) / (cl.length - cl.s[cl.s.length - 1] || 1) : 0;
    });
    const ai = writeFastLane(aiPts, { halfWidth: half, curvature: cl.curvature, grade, closed: circuit });

    log('Drawing the map and previews');
    const xs = cl.points.map((p) => p.x), zs = cl.points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const margin = 20;
    const extent = Math.max(maxX - minX, maxZ - minZ, 1);
    const scale = Math.max(1, extent / (1024 - 2 * margin)); // metres per pixel
    const mw = Math.ceil((maxX - minX) / scale) + 2 * margin, mh = Math.ceil((maxZ - minZ) / scale) + 2 * margin;
    // AC map: pixel = (world + offset) / scale on both axes (world Z maps straight to image rows),
    // so the car marker lines up with the drawn road.
    const map = makeImage(mw, mh);
    const toMap = (x: number, z: number) => ({ x: (x - minX) / scale + margin, y: (z - minZ) / scale + margin });
    const loopPts = circuit ? [...cl.points, cl.points[0]] : cl.points;
    drawPolyline(map, loopPts.map((p) => toMap(p.x, p.y)), 3, [255, 255, 255, 255]);
    const mapIni = ini({ PARAMETERS: { WIDTH: mw, HEIGHT: mh, MARGIN: margin, SCALE_FACTOR: scale.toFixed(6), X_OFFSET: (-minX + margin * scale).toFixed(3), Z_OFFSET: (-minZ + margin * scale).toFixed(3), DRAWING_SIZE: 10, MAX_SIZE: Math.max(mw, mh) } });

    const thumb = (w: number, h: number, bg: [number, number, number, number], fg: [number, number, number, number], r: number) => {
        const img = makeImage(w, h, bg);
        const pad = 20, s = Math.max((maxX - minX) / (w - 2 * pad), (maxZ - minZ) / (h - 2 * pad), 1e-6);
        const ox = (w - (maxX - minX) / s) / 2, oy = (h - (maxZ - minZ) / s) / 2;
        drawPolyline(img, loopPts.map((p) => ({ x: ox + (p.x - minX) / s, y: h - (oy + (p.y - minZ) / s) })), r, fg);
        return encodePNG(img);
    };

    const lengthM = Math.round(cl.length);
    const uiTrack = {
        name: input.name,
        description: `${input.name}, built from the real ${circuit ? 'circuit' : 'road'}. ${circuit ? `Circuit, ${(cl.length / 1000).toFixed(2)} km lap, ${pitboxes} pit boxes` : `Point to point, ${(cl.length / 1000).toFixed(1)} km, ${Math.round(profile.climb)} m of climb`}. Road data © OpenStreetMap contributors (ODbL); elevation from Mapzen/AWS Terrain Tiles (USGS 3DEP, SRTM). Made for Kartcade.`,
        tags: circuit ? ['circuit', 'real track', 'Oregon', 'Kartcade'] : ['point to point', 'real road', 'Oregon', 'Kartcade'],
        geotags: [input.polyline[0].lat.toFixed(5), input.polyline[0].lon.toFixed(5)],
        country: input.country ?? 'USA',
        city: input.city ?? 'West Linn',
        length: String(lengthM),
        width: String(Math.round(input.width * 10) / 10),
        pitboxes: String(pitboxes),
        run: circuit ? (clockwise ? 'clockwise' : 'counter-clockwise') : 'A to B',
        author: 'Kartcade',
        version: '0.1',
        url: 'https://www.kartcade.com',
        year: new Date().getFullYear(),
    };
    const cameras = ini({
        HEADER: { VERSION: 3, CAMERA_COUNT: 3, SET_NAME: 'TV1' },
        ...Object.fromEntries([0.15, 0.5, 0.85].map((f, k) => {
            const i = Math.round(f * (cl.points.length - 1));
            const r = { x: cl.tangents[i].y, y: -cl.tangents[i].x };
            const pos = [cl.points[i].x + r.x * 15, profile.heights[i] + 6, cl.points[i].y + r.y * 15];
            return [`CAMERA_${k}`, {
                NAME: `Cam ${k + 1}`, POSITION: pos.map((v) => v.toFixed(2)).join(','), FORWARD: `${(-r.x).toFixed(3)},-0.2,${(-r.y).toFixed(3)}`, UP: '0,1,0',
                MIN_FOV: 10, MAX_FOV: 45, IN_POINT: k === 0 ? 0 : [0.15, 0.5, 0.85][k - 1] + 0.175, OUT_POINT: k === 2 ? 1 : [0.15, 0.5, 0.85][k] + 0.175,
                SHADOW_SPLIT0: 50, SHADOW_SPLIT1: 150, SHADOW_SPLIT2: 350, NEAR_PLANE: 1, FAR_PLANE: 5000, MIN_EXPOSURE: 0, MAX_EXPOSURE: 10000, DOF_FACTOR: 10, DOF_RANGE: 10000, DOF_FOCUS: 0, DOF_MANUAL: 0, SPLINE: '', SPLINE_ROTATION: 0, FOV_GAMMA: 0, SPLINE_ANIMATION_LENGTH: 0, IS_FIXED: 0,
            }];
        })),
    });

    const enc = new TextEncoder();
    const files: Record<string, Uint8Array> = {
        [`${id}/${id}.kn5`]: kn5,
        // AI spline left out until its format is confirmed against a file recorded in game (v7 crashed AC on load).
        ...((input.includeAi ?? INCLUDE_AI) ? { [`${id}/ai/fast_lane.ai`]: ai } : {}),
        [`${id}/data/surfaces.ini`]: enc.encode(surfacesIni()),
        [`${id}/data/cameras.ini`]: enc.encode(cameras),
        [`${id}/data/map.ini`]: enc.encode(mapIni),
        [`${id}/map.png`]: encodePNG(map),
        [`${id}/ui/ui_track.json`]: enc.encode(JSON.stringify(uiTrack, null, 2)),
        [`${id}/ui/outline.png`]: thumb(400, 400, [0, 0, 0, 0], [255, 255, 255, 255], 4),
        [`${id}/ui/preview.png`]: thumb(640, 360, [18, 18, 20, 255], [212, 36, 40, 255], 4),
        [`${id}/README.txt`]: enc.encode(`${input.name}\n\nInstall: unzip so this folder sits in assettocorsa/content/tracks/${id}, then pick the track in Content Manager.\n${circuit ? `Circuit, ${clockwise ? 'clockwise' : 'counter-clockwise'}; the start/finish line is at the first point of the trace.` : 'Point to point: start at the first pins, finish at the last.'} Road data (c) OpenStreetMap contributors (ODbL).\n`),
    };
    log('Packing the zip');
    const zip = zipSync(files, { level: 6 });
    return {
        id, files, zip, centerline: cl, profile, geometry, elements, terrain, textures, materials,
        stats: { lengthM, climbM: Math.round(profile.climb), descentM: Math.round(profile.descent), maxGradePct: Math.round(profile.maxGrade * 1000) / 10, widthM: input.width, minElevM: Math.round(profile.min), maxElevM: Math.round(profile.max), triangles },
    };
}
