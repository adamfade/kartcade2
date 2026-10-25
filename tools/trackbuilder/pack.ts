// Turns a road (polyline + heights) into a ready-to-install Assetto Corsa track folder and zip.

import { zipSync } from 'fflate';
import { buildCenterline } from './route.ts';
import { roadProfile } from './elevation.ts';
import type { HeightSampler, Profile } from './elevation.ts';
import { buildGeometry } from './mesh.ts';
import type { TrackGeometry } from './mesh.ts';
import { trackMaterials, writeKn5 } from './kn5.ts';
import { writeFastLane } from './aiLine.ts';
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
    log('Smoothing the centerline');
    const cl = buildCenterline(input.polyline, { spacing: 2 });
    const ll = cl.points.map((p) => cl.projection.toLatLon(p));
    log(`Sampling elevation along ${(cl.length / 1000).toFixed(2)} km`);
    const profile = roadProfile(ll, cl.s, input.heightSampler);
    const ground = (x: number, y: number) => input.heightSampler(cl.projection.toLatLon({ x, y }));
    log('Building road, verges and walls');
    const geometry = buildGeometry(cl, profile.heights, { width: input.width, walls: input.walls ?? true, ground, flipStart: input.flipStart });
    const triangles = geometry.parts.reduce((a, p) => a + p.indices.length / 3, 0);

    log('Writing the KN5 model');
    const kn5 = writeKn5({
        textures: [
            { name: 'asphalt.png', data: asphaltTexture() },
            { name: 'grass.png', data: grassTexture() },
            { name: 'wall.png', data: concreteTexture() },
        ],
        materials: trackMaterials(),
        meshes: geometry.parts,
        dummies: geometry.dummies,
    });

    log('Writing the AI line');
    const half = input.width / 2;
    const aiPts = cl.points.map((p, i) => ({ x: p.x, y: geometry.roadHeightAt(i, 0), z: p.y }));
    const grade = profile.heights.map((h, i) => (i > 0 ? (h - profile.heights[i - 1]) / (cl.s[i] - cl.s[i - 1] || 1) : 0));
    const ai = writeFastLane(aiPts, { halfWidth: half, curvature: cl.curvature, grade });

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
    drawPolyline(map, cl.points.map((p) => toMap(p.x, p.y)), 3, [255, 255, 255, 255]);
    const mapIni = ini({ PARAMETERS: { WIDTH: mw, HEIGHT: mh, MARGIN: margin, SCALE_FACTOR: scale.toFixed(6), X_OFFSET: (-minX + margin * scale).toFixed(3), Z_OFFSET: (-minZ + margin * scale).toFixed(3), DRAWING_SIZE: 10, MAX_SIZE: Math.max(mw, mh) } });

    const thumb = (w: number, h: number, bg: [number, number, number, number], fg: [number, number, number, number], r: number) => {
        const img = makeImage(w, h, bg);
        const pad = 20, s = Math.max((maxX - minX) / (w - 2 * pad), (maxZ - minZ) / (h - 2 * pad), 1e-6);
        const ox = (w - (maxX - minX) / s) / 2, oy = (h - (maxZ - minZ) / s) / 2;
        drawPolyline(img, cl.points.map((p) => ({ x: ox + (p.x - minX) / s, y: h - (oy + (p.y - minZ) / s) })), r, fg);
        return encodePNG(img);
    };

    const lengthM = Math.round(cl.length);
    const uiTrack = {
        name: input.name,
        description: `${input.name}, built from the real road. Point to point, ${(cl.length / 1000).toFixed(1)} km, ${Math.round(profile.climb)} m of climb. Road data © OpenStreetMap contributors (ODbL); elevation from Mapzen/AWS Terrain Tiles (USGS 3DEP, SRTM). Made for Kartcade.`,
        tags: ['point to point', 'real road', 'Oregon', 'Kartcade'],
        geotags: [input.polyline[0].lat.toFixed(5), input.polyline[0].lon.toFixed(5)],
        country: input.country ?? 'USA',
        city: input.city ?? 'West Linn',
        length: String(lengthM),
        width: String(Math.round(input.width * 10) / 10),
        pitboxes: '1',
        run: 'A to B',
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
        [`${id}/ai/fast_lane.ai`]: ai,
        [`${id}/data/surfaces.ini`]: enc.encode(surfacesIni()),
        [`${id}/data/cameras.ini`]: enc.encode(cameras),
        [`${id}/data/map.ini`]: enc.encode(mapIni),
        [`${id}/map.png`]: encodePNG(map),
        [`${id}/ui/ui_track.json`]: enc.encode(JSON.stringify(uiTrack, null, 2)),
        [`${id}/ui/outline.png`]: thumb(400, 400, [0, 0, 0, 0], [255, 255, 255, 255], 4),
        [`${id}/ui/preview.png`]: thumb(640, 360, [18, 18, 20, 255], [212, 36, 40, 255], 4),
        [`${id}/README.txt`]: enc.encode(`${input.name}\n\nInstall: unzip so this folder sits in assettocorsa/content/tracks/${id}, then pick the track in Content Manager.\nPoint to point: start at the first pins, finish at the last. Road data (c) OpenStreetMap contributors (ODbL).\n`),
    };
    log('Packing the zip');
    const zip = zipSync(files, { level: 6 });
    return {
        id, files, zip, centerline: cl, profile, geometry,
        stats: { lengthM, climbM: Math.round(profile.climb), descentM: Math.round(profile.descent), maxGradePct: Math.round(profile.maxGrade * 1000) / 10, widthM: input.width, minElevM: Math.round(profile.min), maxElevM: Math.round(profile.max), triangles },
    };
}
