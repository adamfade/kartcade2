// Surroundings: buildings (walls with windows, gable / hip / flat roofs), trees as alpha-tested billboards, and
// mapped barriers (guard rails, fences, walls, hedges, tree rows). Everything is chunked into 256 m cells so
// Assetto Corsa can cull it, and kept off every road.
//
// Sources, best first:
//   - lidar surface (lidar.ts): real roof heights and shapes for mapped buildings, unmapped buildings, and every
//     tree as a lidar treetop with its real height
//   - near-infrared aerial: tells vegetation from buildings in the lidar, or finds tree canopy on its own
//   - OpenStreetMap: building footprints, woods and single trees where neither of the above covers

import type { Centerline } from './route.ts';
import type { MeshPart, TrackGeometry, V3 } from './mesh.ts';
import type { HeightSampler } from './elevation.ts';
import type { OsmFeatures } from './osm.ts';
import { DRIVABLE } from './osm.ts';
import type { SiteCell, SiteRasters } from './site.ts';
import { sampleImage } from './site.ts';
import type { SurfaceRaster } from './lidar.ts';
import { laneSet, wayWidth } from './roadinfo.ts';
import type { MaterialBook, MaterialLibrary } from './materials.ts';
import { macroDetailMaterial, tileNoise } from './materials.ts';
import type { Rgba } from './dds.ts';
import { Mesh, box } from './elements.ts';

type P2 = { x: number; y: number };

export interface FeatureOptions {
    /** Most trees to place (far ones are thinned first). */
    maxTrees?: number;
    /** Buildings and barriers closer than this to the road get collision. */
    collisionM?: number;
    /** Site rasters: lidar surfaces and near-infrared imagery per cell, when stored. */
    site?: SiteRasters;
    /** Side-street stubs built by streets.ts (kept clear like any road). */
    stubs?: { pts: P2[]; half: number }[];
}

export interface FeatureStats { buildings: number; trees: number; barriers: number; lidarBuildings?: number; lidarTrees?: number; canopyTrees?: number }

const CELL = 256;
function hash(n: number) { let h = (n ^ 0x9e3779b9) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------------------------------------------------------------- geometry helpers

function signedArea(r: P2[]) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
function inRing(p: P2, r: P2[]) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if ((r[i].y > p.y) !== (r[j].y > p.y) && p.x < ((r[j].x - r[i].x) * (p.y - r[i].y)) / (r[j].y - r[i].y) + r[i].x) inside = !inside;
    }
    return inside;
}
function hull(pts: P2[]): P2[] {
    const s = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo: P2[] = [], hi: P2[] = [];
    for (const p of s) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of s.slice().reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}
/** Minimum-area oriented rectangle (rotating the hull edges). */
function obb(pts: P2[]) {
    const h = hull(pts);
    let best = { area: Infinity, ax: { x: 1, y: 0 }, c: { x: 0, y: 0 }, w: 0, d: 0 };
    for (let i = 0; i < h.length; i++) {
        const a = h[i], b = h[(i + 1) % h.length];
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / l, uy = (b.y - a.y) / l;
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const p of h) { const u = p.x * ux + p.y * uy, v = -p.x * uy + p.y * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
        const area = (u1 - u0) * (v1 - v0);
        if (area < best.area) {
            const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
            best = { area, ax: { x: ux, y: uy }, c: { x: cu * ux - cv * uy, y: cu * uy + cv * ux }, w: u1 - u0, d: v1 - v0 };
        }
    }
    // Long axis first.
    if (best.d > best.w) best = { ...best, ax: { x: -best.ax.y, y: best.ax.x }, w: best.d, d: best.w };
    return best;
}

// ---------------------------------------------------------------- textures

/** Facade macro: wall colour with window bands (glass: alpha 1, so no siding detail on the glass). */
function facadeMacro(rgb: [number, number, number], windows: boolean, seed: number): Rgba {
    const N = 256, M = 8; // 8 m square: two window bays, two storeys
    const n = tileNoise(N, seed, [4, 16]);
    const data = new Uint8Array(N * N * 4);
    const glass = [38, 44, 52], trim = [235, 233, 226];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = y * N + x, u = ((x + 0.5) / N) * M, h = (1 - (y + 0.5) / N) * M; // h = metres above the wall base
        let c: number[] = rgb.map((v) => v * 2 * (0.94 + n[i] * 0.12)), a = 0;
        if (windows) {
            const bay = u % 4; // 4 m bays
            for (const [f0, f1] of [[1.0, 2.3], [3.9, 5.2]]) {
                const inWin = bay > 1.3 && bay < 2.7 && h > f0 && h < f1;
                const inTrim = bay > 1.2 && bay < 2.8 && h > f0 - 0.1 && h < f1 + 0.1;
                if (inWin) { c = glass.map((v) => v * (0.85 + 0.3 * (h - f0) / (f1 - f0))); a = 255; }
                else if (inTrim) { c = trim; a = 255; }
            }
        }
        for (let ch = 0; ch < 3; ch++) data[i * 4 + ch] = Math.max(0, Math.min(255, c[ch]));
        data[i * 4 + 3] = a;
    }
    return { width: N, height: N, data };
}

function solid(rgb: [number, number, number], seed: number, variation = 0.1): Rgba {
    const N = 64, n = tileNoise(N, seed, [2, 8]);
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, rgb[c] * 2 * (1 + (n[i] - 0.5) * variation * 2))); data[i * 4 + 3] = 0; }
    return { width: N, height: N, data };
}

/**
 * Tree sprite atlas, 1024 x 512, four 256 x 512 cells: Douglas fir, Douglas fir (fuller), western red cedar,
 * bigleaf maple. Drawn from thousands of small needle/leaf clumps inside each species' silhouette, lit from the
 * upper left, alpha 0 outside the foliage (alpha-tested in AC).
 */
export function treeAtlas(): Rgba {
    const W = 1024, H = 512, CW = 256;
    const data = new Uint8Array(W * H * 4);
    const put = (x: number, y: number, c: number[], a = 255) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const i = (y * W + x) * 4;
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = a;
    };
    const blob = (cx: number, cy: number, r: number, c: number[], cell: number) => {
        for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
            if (x < cell * CW + 1 || x >= (cell + 1) * CW - 1) continue;
            const d = Math.hypot(x - cx, y - cy) / r;
            if (d <= 1) put(x, y, c.map((v) => Math.max(0, Math.min(255, v * (1.08 - 0.25 * d)))));
        }
    };
    const species = [
        { cell: 0, kind: 'fir', base: [40, 66, 38], spread: 0.36, seed: 3 },
        { cell: 1, kind: 'fir', base: [46, 74, 42], spread: 0.42, seed: 7 },
        { cell: 2, kind: 'cedar', base: [52, 78, 40], spread: 0.4, seed: 11 },
        { cell: 3, kind: 'maple', base: [62, 92, 42], spread: 0.9, seed: 13 },
    ];
    for (const sp of species) {
        const rand = rng(sp.seed);
        const cx = sp.cell * CW + CW / 2;
        // Trunk.
        const trunkTop = sp.kind === 'maple' ? H * 0.55 : H * 0.15;
        for (let y = Math.floor(trunkTop); y < H; y++) for (let x = -5; x <= 5; x++) put(Math.round(cx + x), y, [74 - Math.abs(x) * 4, 56 - Math.abs(x) * 3, 40]);
        const clumps = sp.kind === 'maple' ? 2600 : 3600;
        for (let k = 0; k < clumps; k++) {
            let x: number, y: number, r: number;
            if (sp.kind === 'maple') {
                // Several overlapping lobes making a broad crown.
                const lobe = Math.floor(rand() * 6);
                const lx = cx + Math.cos(lobe * 1.3) * CW * 0.22, ly = H * 0.3 + Math.sin(lobe * 2.1) * H * 0.1;
                const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * CW * 0.24;
                x = lx + Math.cos(a) * d; y = ly + Math.sin(a) * d * 1.1; r = 3 + rand() * 5;
            } else {
                // Conical crown: branch tiers droop outward; width grows towards the bottom.
                const t = Math.pow(rand(), 0.8); // 0 top .. 1 bottom of crown
                y = H * 0.03 + t * H * 0.85;
                const halfW = CW * sp.spread * (0.08 + t * 0.92) * (0.85 + 0.3 * Math.sin(t * 40 + sp.seed));
                const side = rand() < 0.5 ? -1 : 1, off = Math.pow(rand(), 0.6) * halfW;
                x = cx + side * off;
                y += (off / Math.max(1, halfW)) * (sp.kind === 'cedar' ? 18 : 8); // branch tips droop
                r = 2.5 + rand() * (sp.kind === 'cedar' ? 4 : 3.5);
            }
            // Light from upper left; darker inside the crown.
            const lx = (x - cx) / (CW * 0.5), ly = y / H;
            const shade = 0.75 + 0.35 * (-lx * 0.5 + (1 - ly) * 0.5) + (rand() - 0.5) * 0.25;
            blob(x, y, r, sp.base.map((v) => v * shade), sp.cell);
        }
        // Transparent texels take the crown's darker average colour, so filtering at the cut-out edge never
        // pulls in black.
        const sum = [0, 0, 0]; let n = 0;
        for (let y = 0; y < H; y++) for (let x = sp.cell * CW; x < (sp.cell + 1) * CW; x++) {
            const i = (y * W + x) * 4; if (data[i + 3]) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; n++; }
        }
        for (let y = 0; y < H; y++) for (let x = sp.cell * CW; x < (sp.cell + 1) * CW; x++) {
            const i = (y * W + x) * 4; if (!data[i + 3]) for (let c = 0; c < 3; c++) data[i + c] = Math.round((sum[c] / Math.max(1, n)) * 0.8);
        }
    }
    return { width: W, height: H, data };
}

// ---------------------------------------------------------------- builder

const WALL_COLOURS: [number, number, number][] = [[226, 223, 214], [198, 182, 152], [152, 154, 150], [140, 150, 122], [178, 152, 114], [122, 136, 150]];
const ROOF_COLOURS: [number, number, number][] = [[62, 62, 64], [46, 46, 50], [82, 66, 52]];
const BARN_COLOURS: [number, number, number][] = [[138, 48, 38], [150, 148, 140], [110, 92, 70]];
const METAL_COLOURS: [number, number, number][] = [[150, 152, 155], [70, 96, 74], [140, 52, 44]];

export function buildFeatures(cl: Centerline, g: TrackGeometry, osm: OsmFeatures, ground: HeightSampler, book: MaterialBook, lib: MaterialLibrary | undefined, opts: FeatureOptions = {}): { parts: MeshPart[]; stats: FeatureStats } {
    const proj = cl.projection;
    const L = (p: { lat: number; lon: number }): P2 => proj.toLocal(p);
    const H = (p: P2) => ground(proj.toLatLon(p)) ?? 0;
    const collisionM = opts.collisionM ?? 45;

    // Nearest centreline sample (grid) for road clearance and collision decisions.
    const P = cl.points, GC = 50;
    const grid = new Map<string, number[]>();
    P.forEach((p, i) => { const k = `${Math.floor(p.x / GC)},${Math.floor(p.y / GC)}`; let b = grid.get(k); if (!b) grid.set(k, (b = [])); b.push(i); });
    /** Distance to the route centreline and the nearest sample. */
    const nearRoute = (p: P2, max = 150): { d: number; i: number } => {
        const cx = Math.floor(p.x / GC), cy = Math.floor(p.y / GC), r = Math.ceil(max / GC);
        let best = Infinity, bi = 0;
        for (let a = cx - r; a <= cx + r; a++) for (let b = cy - r; b <= cy + r; b++) for (const i of grid.get(`${a},${b}`) ?? []) { const d = Math.hypot(p.x - P[i].x, p.y - P[i].y); if (d < best) { best = d; bi = i; } }
        return { d: best, i: bi };
    };
    const roadDist = (p: P2, max = 150) => nearRoute(p, max).d;
    /** Clearance from the route's asphalt edge (negative = on it). */
    const routeEdge = (p: P2, max = 150) => { const q = nearRoute(p, max); return q.d - g.halfAt(q.i); };

    // Every other road (side streets, roads further off) as segments with half widths, for keeping things off them.
    const RG = 30, roadSegs = new Map<string, { ax: number; ay: number; bx: number; by: number; h: number }[]>();
    const addSeg = (a: P2, b: P2, h: number) => {
        const seg = { ax: a.x, ay: a.y, bx: b.x, by: b.y, h };
        const x0 = Math.floor((Math.min(a.x, b.x) - h) / RG), x1 = Math.floor((Math.max(a.x, b.x) + h) / RG);
        const y0 = Math.floor((Math.min(a.y, b.y) - h) / RG), y1 = Math.floor((Math.max(a.y, b.y) + h) / RG);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const k = `${gx},${gy}`; let l = roadSegs.get(k); if (!l) roadSegs.set(k, (l = [])); l.push(seg); }
    };
    for (const w of osm.roads ?? []) {
        if (!DRIVABLE.test(w.tags.highway ?? '')) continue;
        const h = Math.min(9, wayWidth(w.tags, laneSet(w.tags, 1)) / 2);
        const pts = w.line.map(L);
        for (let k = 0; k < pts.length - 1; k++) addSeg(pts[k], pts[k + 1], h);
    }
    for (const st of opts.stubs ?? []) for (let k = 0; k < st.pts.length - 1; k++) addSeg(st.pts[k], st.pts[k + 1], st.half);
    /** Clearance from the edge of any mapped road (Infinity when none is near). */
    const otherRoadEdge = (p: P2) => {
        let best = Infinity;
        for (const sgm of roadSegs.get(`${Math.floor(p.x / RG)},${Math.floor(p.y / RG)}`) ?? []) {
            const dx = sgm.bx - sgm.ax, dy = sgm.by - sgm.ay, l2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((p.x - sgm.ax) * dx + (p.y - sgm.ay) * dy) / l2));
            best = Math.min(best, Math.hypot(p.x - sgm.ax - dx * t, p.y - sgm.ay - dy * t) - sgm.h);
        }
        return best;
    };
    const clearOfRoads = (p: P2) => Math.min(routeEdge(p), otherRoadEdge(p));

    // Site rasters per cell: lidar surface and near-infrared.
    const cells = (opts.site?.cells ?? []).filter((c) => c.surface || c.nir);
    const cellAt = (ll: { lat: number; lon: number }) => cells.find((c) => ll.lon >= c.bbox.west && ll.lon < c.bbox.east && ll.lat >= c.bbox.south && ll.lat < c.bbox.north);
    /** Normalised difference vegetation index from the NAIP near-infrared and red bands (null without NIR). */
    const ndviAt = (c: SiteCell, ll: { lat: number; lon: number }) => {
        if (!c.nir || !c.rgb) return null;
        const n = sampleImage(c.nir, ll), r = sampleImage(c.rgb, ll);
        if (!n || !r) return null;
        return (n[0] - r[0]) / (n[0] + r[0] + 1);
    };
    const surfaceCovers = (ll: { lat: number; lon: number }) => {
        const c = cellAt(ll); if (!c?.surface) return false;
        const s = c.surface, px = Math.floor(((ll.lon - s.bbox.west) / (s.bbox.east - s.bbox.west)) * s.width), py = Math.floor(((s.bbox.north - ll.lat) / (s.bbox.north - s.bbox.south)) * s.height);
        return px >= 0 && py >= 0 && px < s.width && py < s.height && Number.isFinite(s.above[py * s.width + px]);
    };

    // Chunked meshes per (kind, cell, material).
    const meshes = new Map<string, Mesh>();
    const meshFor = (kind: string, p: P2, material: string, flags: { visible?: boolean; castShadows?: boolean } = {}) => {
        const k = `${kind}_${Math.floor(p.x / CELL)}_${Math.floor(p.y / CELL)}_${material}`.replace(/-/g, 'm');
        let m = meshes.get(k);
        if (!m) meshes.set(k, (m = new Mesh(k, material, flags)));
        return m;
    };

    // Materials (macro colour x photo-scanned detail).
    const wallMat = (rgb: [number, number, number], role: 'siding' | 'brick' | 'concrete', windows: boolean) => macroDetailMaterial(book, lib, {
        name: `bld_wall_${role}_${rgb.join('_')}_${windows ? 'w' : 'p'}`, role, specular: 0.05, reflection: 0.02,
        macro: { key: `facade_${rgb.join('_')}_${windows ? 'w' : 'p'}`, image: () => facadeMacro(rgb, windows, rgb[0]), sizeM: 8, format: windows ? 'bc3' : 'bc1' },
    });
    const roofMat = (rgb: [number, number, number], role: 'roof' | 'metal_roof') => macroDetailMaterial(book, lib, {
        name: `bld_${role}_${rgb.join('_')}`, role, specular: role === 'metal_roof' ? 0.3 : 0.06, reflection: role === 'metal_roof' ? 0.15 : 0.02,
        macro: { key: `roofm_${rgb.join('_')}`, image: () => solid(rgb, rgb[1]), sizeM: 8 },
    });
    let treeMat = '';
    const treeMaterial = () => {
        if (treeMat) return treeMat;
        const tex = book.image('tree_atlas.dds', treeAtlas, { format: 'bc3', mips: 'cutout' });
        treeMat = book.add({
            name: 'tree_billboard', shader: 'ksPerPixelAT', alphaTested: true,
            properties: [{ name: 'ksAmbient', a: 0.5 }, { name: 'ksDiffuse', a: 0.5 }, { name: 'ksSpecular', a: 0 }, { name: 'ksSpecularEXP', a: 1 }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0.5 }],
            textures: [{ sampler: 'txDiffuse', slot: 0, texture: tex }],
        });
        return treeMat;
    };

    const stats: FeatureStats = { buildings: 0, trees: 0, barriers: 0, lidarBuildings: 0, lidarTrees: 0, canopyTrees: 0 };

    /** Lidar heights inside a footprint: sorted heights above ground of non-vegetation returns. */
    const roofSamples = (ring: P2[]): number[] => {
        const ll0 = proj.toLatLon(ring[0]), c = cellAt(ll0);
        if (!c?.surface) return [];
        const s = c.surface;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
        const out: number[] = [];
        for (let y = y0 + 0.4; y < y1; y += 0.8) for (let x = x0 + 0.4; x < x1; x += 0.8) {
            const p = { x, y };
            if (!inRing(p, ring)) continue;
            const ll = proj.toLatLon(p);
            if (ll.lon < s.bbox.west || ll.lon >= s.bbox.east || ll.lat < s.bbox.south || ll.lat >= s.bbox.north) continue;
            const px = Math.floor(((ll.lon - s.bbox.west) / (s.bbox.east - s.bbox.west)) * s.width), py = Math.floor(((s.bbox.north - ll.lat) / (s.bbox.north - s.bbox.south)) * s.height);
            const v = s.above[py * s.width + px];
            if (!Number.isFinite(v)) continue;
            const nd = ndviAt(c, ll);
            if (nd != null && nd > 0.22) continue; // a tree over the roof
            out.push(v);
        }
        return out.sort((a, b) => a - b);
    };
    const pct = (a: number[], q: number) => a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))];

    // ------------------------------------------------ buildings
    const footprints: P2[][] = [];
    /** One building: walls from the footprint, roof by shape. `measured` = lidar wall and ridge heights. */
    const addBuilding = (ringIn: P2[], t: Record<string, string>, id: number, measured: { wall: number; rise: number; flat: boolean } | null) => {
        let ring = ringIn;
        if (signedArea(ring) < 0) ring = ring.slice().reverse(); // counter-clockwise
        const area = Math.abs(signedArea(ring));
        const kind = t.building ?? 'yes';
        const rnd = hash(id);
        const barn = /^(barn|farm_auxiliary|shed|stable|cowshed|greenhouse)$/.test(kind);
        const big = /^(commercial|industrial|retail|warehouse|supermarket|school|hospital|office|apartments)$/.test(kind) || area > 700;
        const small = /^(garage|garages|carport|shed|hut)$/.test(kind) || area < 45;
        const levels = parseFloat(t['building:levels'] ?? '') || (small ? 1 : big ? 2 : area > 140 && rnd > 0.6 ? 2 : 1);
        const tagged = parseFloat(t.height ?? '');
        const wallH = measured ? measured.wall : tagged ? Math.max(2.5, tagged * 0.75) : levels * 2.9 + 0.4;
        const gz = ring.map((p) => H(p));
        const base = Math.min(...gz) - 0.4, top = Math.max(...gz) + wallH;
        const centre = ring.reduce((a, p) => ({ x: a.x + p.x / ring.length, y: a.y + p.y / ring.length }), { x: 0, y: 0 });
        const coll = roadDist(centre) < collisionM;
        const wmat = barn ? wallMat(BARN_COLOURS[Math.floor(rnd * 3)], 'siding', false)
            : big ? wallMat([168, 164, 156], rnd > 0.5 ? 'brick' : 'concrete', true)
            : wallMat(WALL_COLOURS[Math.floor(rnd * WALL_COLOURS.length)], small ? 'siding' : rnd > 0.85 ? 'brick' : 'siding', !small);
        const walls = meshFor(coll ? '1WALL_BLD' : 'BLD', centre, wmat);
        // Walls: one quad per footprint edge, outward normals, UV = metres along the perimeter / 8, height / 8.
        let perim = 0;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], c = ring[(i + 1) % ring.length], len = Math.hypot(c.x - a.x, c.y - a.y);
            if (len < 0.05) continue;
            const n: V3 = [(c.y - a.y) / len, 0, -(c.x - a.x) / len]; // right of a->c is outside for CCW rings
            const u0 = perim / 8, u1 = (perim + len) / 8, v0 = (base - (top - wallH)) / 8;
            walls.face([[a.x, base, a.y], [c.x, base, c.y], [c.x, top, c.y], [a.x, top, a.y]], n, [[u0, v0], [u1, v0], [u1, wallH / 8], [u0, wallH / 8]]);
            perim += len;
        }
        // Roof.
        const flat = measured ? measured.flat : big || t['roof:shape'] === 'flat';
        const rmat = barn || big ? roofMat(METAL_COLOURS[Math.floor(rnd * 3)], 'metal_roof') : roofMat(ROOF_COLOURS[Math.floor(rnd * 3)], 'roof');
        const roof = meshFor(coll ? '1WALL_ROOF' : 'ROOF', centre, rmat);
        const o = obb(ring);
        const rect = area / Math.max(1, o.w * o.d);
        if (flat) {
            // Flat roof: fan over the footprint (triangulated from the centroid; fine for near-convex shapes).
            for (let i = 0; i < ring.length; i++) {
                const a = ring[i], c = ring[(i + 1) % ring.length];
                roof.face([[centre.x, top + 0.05, centre.y], [a.x, top + 0.05, a.y], [c.x, top + 0.05, c.y]], [0, 1, 0], [[centre.x / 8, centre.y / 8], [a.x / 8, a.y / 8], [c.x / 8, c.y / 8]]);
            }
        } else if (rect > 0.78) {
            // Gable over the oriented rectangle, ridge along the long axis, 0.4 m overhang (26.6 deg pitch, or lidar).
            const ov = 0.4, hw = o.w / 2 + ov, hd = o.d / 2 + ov;
            const rise = measured ? Math.max(0.8, Math.min(measured.rise, o.d * 0.6)) : (o.d / 2) * 0.5;
            const ax = o.ax, ay = { x: -ax.y, y: ax.x };
            const pt = (u: number, v: number, y: number): V3 => [o.c.x + ax.x * u + ay.x * v, y, o.c.y + ax.y * u + ay.y * v];
            const slope = Math.hypot(hd, rise);
            for (const sd of [-1, 1]) {
                const nx = ay.x * sd * rise, nz = ay.y * sd * rise, ny = hd, nl = Math.hypot(nx, ny, nz);
                roof.double([pt(-hw, sd * hd, top - ov * (rise / (o.d / 2))), pt(hw, sd * hd, top - ov * (rise / (o.d / 2))), pt(hw, 0, top + rise), pt(-hw, 0, top + rise)], [nx / nl, ny / nl, nz / nl],
                    [[0, 0], [2 * hw / 8, 0], [2 * hw / 8, slope / 8], [0, slope / 8]]);
            }
            // Gable ends (siding) under the roof.
            for (const sd of [-1, 1]) {
                const n: V3 = [ax.x * sd, 0, ax.y * sd];
                walls.face([pt(sd * o.w / 2, -o.d / 2, top), pt(sd * o.w / 2, o.d / 2, top), pt(sd * o.w / 2, 0, top + rise)], n, [[0, 0], [o.d / 8, 0], [o.d / 16, rise / 8]]);
            }
        } else {
            // Hip: every eave edge slopes up to an apex over the centre.
            const rise = measured ? Math.max(0.8, Math.min(measured.rise, Math.min(o.w, o.d) * 0.5)) : Math.min(o.w, o.d) * 0.35;
            for (let i = 0; i < ring.length; i++) {
                const a = ring[i], c = ring[(i + 1) % ring.length];
                const e = { x: (a.x + c.x) / 2 - centre.x, y: (a.y + c.y) / 2 - centre.y }, el = Math.hypot(e.x, e.y) || 1;
                const n: V3 = [e.x / el * rise, el, e.y / el * rise], nl = Math.hypot(...n);
                roof.double([[a.x, top, a.y], [c.x, top, c.y], [centre.x, top + rise, centre.y]], [n[0] / nl, n[1] / nl, n[2] / nl], [[0, 0], [Math.hypot(c.x - a.x, c.y - a.y) / 8, 0], [0.5, Math.hypot(el, rise) / 8]]);
            }
        }
        footprints.push(ring);
        stats.buildings++;
    };
    /** Wall and ridge heights from lidar samples in a footprint (null when too few). */
    const measure = (samples: number[]) => {
        if (samples.length < 10) return null;
        const p15 = pct(samples, 0.15), p50 = pct(samples, 0.5), p95 = pct(samples, 0.95);
        if (p95 < 1.8) return null; // nothing standing there (demolished, or a mapping error)
        const flat = p95 - pct(samples, 0.3) < 1.0;
        return flat ? { wall: Math.max(2.4, pct(samples, 0.9)), rise: 0, flat: true } : { wall: Math.max(2.3, Math.min(p50, p15 + 0.5)), rise: Math.max(0.8, p95 - Math.max(2.3, Math.min(p50, p15 + 0.5))), flat: false };
    };
    for (const b of osm.buildings) {
        const ring = b.ring.slice(0, -1).map(L);
        if (ring.length < 3) continue;
        const area = Math.abs(signedArea(ring));
        if (area < 8 || area > 25000) continue;
        if (Math.min(...ring.map((p) => clearOfRoads(p))) < 1 || P.some((p, i) => i % 5 === 0 && inRing(p, ring))) continue; // never on a road
        const m = measure(roofSamples(ring));
        if (m) stats.lidarBuildings!++;
        addBuilding(ring, b.tags, b.id, m);
    }
    const onBuilding = (p: P2) => footprints.some((r) => Math.abs(r[0].x - p.x) < 80 && Math.abs(r[0].y - p.y) < 80 && inRing(p, r));

    // Unmapped buildings from lidar: tall, non-vegetation blobs outside every mapped footprint and off the roads.
    for (const c of cells) {
        const s = c.surface;
        if (!s || !c.nir) continue; // without near-infrared, trees and roofs can't be told apart
        const W = s.width, Hh = s.height, pxW = (s.bbox.east - s.bbox.west) / W, pxH = (s.bbox.north - s.bbox.south) / Hh;
        const llOf = (k: number) => ({ lat: s.bbox.north - ((Math.floor(k / W) + 0.5) * pxH), lon: s.bbox.west + ((k % W) + 0.5) * pxW });
        const mask = new Uint8Array(W * Hh);
        for (let k = 0; k < W * Hh; k++) {
            const v = s.above[k];
            if (!(v >= 2.6) || s.cls[k] === 17 || s.cls[k] === 9) continue;
            const ll = llOf(k), nd = ndviAt(c, ll);
            if (nd == null || nd > 0.06) continue;
            mask[k] = 1;
        }
        const seen = new Uint8Array(W * Hh);
        const a1 = proj.toLocal(llOf(0)), a2 = proj.toLocal(llOf(W + 1));
        const pxArea = Math.abs((a2.x - a1.x) * (a2.y - a1.y));
        for (let k0 = 0; k0 < W * Hh; k0++) {
            if (!mask[k0] || seen[k0]) continue;
            const comp: number[] = [], stack = [k0]; seen[k0] = 1;
            while (stack.length && comp.length < 6000) {
                const k = stack.pop()!; comp.push(k);
                const x = k % W, y = Math.floor(k / W);
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= Hh) continue;
                    const kk = ny * W + nx; if (mask[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); }
                }
            }
            const area = comp.length * pxArea;
            if (area < 22 || area > 2500) continue;
            const pts = comp.map((k) => proj.toLocal(llOf(k)));
            const ctr = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
            if (onBuilding(ctr) || clearOfRoads(ctr) < 3) continue;
            const o = obb(pts);
            const w = o.w + 0.8, d = o.d + 0.8;
            if (area / (w * d) < 0.5 || Math.min(w, d) < 3) continue; // ragged blobs are hedges, trucks or noise
            const ax = o.ax, ay = { x: -ax.y, y: ax.x };
            const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: o.c.x + ax.x * u * w / 2 + ay.x * v * d / 2, y: o.c.y + ax.y * u * w / 2 + ay.y * v * d / 2 }));
            if (Math.min(...ring.map((p) => clearOfRoads(p))) < 1) continue;
            const hs = comp.map((k) => s.above[k]).sort((a, b) => a - b);
            const m = measure(hs);
            if (!m) continue;
            addBuilding(ring, { building: area < 45 ? 'garage' : 'yes' }, Math.round(ctr.x * 7 + ctr.y * 13), m);
            stats.lidarBuildings!++;
        }
    }

    // ------------------------------------------------ trees
    type Tree = { p: P2; h: number; w: number; variant: number; d: number };
    const trees: Tree[] = [];
    const widthOf = (variant: number, h: number) => h * (variant === 3 ? 0.75 : variant === 2 ? 0.5 : 0.42);
    const addTree = (p: P2, variant: number, h: number, fixedW?: number) => {
        const q = nearRoute(p, 600), d = q.d;
        const half = g.halfAt(q.i);
        if (d < half + 2 || onBuilding(p)) return;
        const other = otherRoadEdge(p);
        if (other < 0.8) return; // trunk on a street
        // The sprite must stay off the asphalt: trees close to the road are younger (smaller); other streets may be
        // overhung a little, as street trees are.
        const room = Math.min(d - (half + 1), other + 1.5);
        let w = fixedW ?? widthOf(variant, h);
        if (w / 2 > room) { h *= (room * 2) / w; w = room * 2; }
        if (h < 3.5) return;
        trees.push({ p, h, w, variant, d });
    };
    // 1. Lidar treetops: local maxima of height above ground where the aerial says vegetation.
    for (const c of cells) {
        const s = c.surface;
        if (!s) continue;
        const W = s.width, Hh = s.height, pxW = (s.bbox.east - s.bbox.west) / W, pxH = (s.bbox.north - s.bbox.south) / Hh;
        const a1 = proj.toLocal({ lat: s.bbox.north, lon: s.bbox.west }), a2 = proj.toLocal({ lat: s.bbox.north - pxH, lon: s.bbox.west + pxW });
        const mx = Math.abs(a2.x - a1.x), my = Math.abs(a2.y - a1.y); // metres per pixel
        const llOf = (x: number, y: number) => ({ lat: s.bbox.north - (y + 0.5) * pxH, lon: s.bbox.west + (x + 0.5) * pxW });
        // Smooth the canopy model a little (3x3) so one crown gives one top, not several.
        const sm = new Float32Array(W * Hh).fill(NaN);
        for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) {
            let a = 0, c2 = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const u = s.above[(y + dy) * W + x + dx]; if (Number.isFinite(u)) { a += u * (dx || dy ? 1 : 2); c2 += dx || dy ? 1 : 2; } }
            if (c2 >= 6 && Number.isFinite(s.above[y * W + x])) sm[y * W + x] = a / c2;
        }
        for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) {
            const k = y * W + x, v = sm[k];
            if (!(v >= 3.5) || s.cls[k] === 17 || s.cls[k] === 9 || s.cls[k] === 6) continue;
            const r = Math.max(2, Math.min(6, 0.12 * v + 1.5));
            const rx = Math.ceil(r / mx), ry = Math.ceil(r / my);
            let isMax = true, sum = 0, cnt = 0;
            for (let dy = -ry; dy <= ry && isMax; dy++) for (let dx = -rx; dx <= rx; dx++) {
                if (!dx && !dy) continue;
                const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= Hh) continue;
                if ((dx * mx) ** 2 + (dy * my) ** 2 > r * r) continue;
                const u = sm[yy * W + xx];
                if (u > v || (u === v && yy * W + xx < k)) { isMax = false; break; }
                if (Number.isFinite(u)) { sum += u; cnt++; }
            }
            if (!isMax) continue;
            const ll = llOf(x, y);
            if (c.nir) { const nd = ndviAt(c, ll); if (nd == null || nd < 0.1) continue; } // a roof corner or a pole
            const p = L(ll);
            // Pointed crowns (much lower around the top) are conifers; rounded ones broadleaf.
            const ratio = cnt ? sum / cnt / v : 1;
            const variant = ratio < 0.86 ? (hash(k + 17) < 0.2 ? 2 : hash(k) < 0.5 ? 0 : 1) : 3;
            addTree(p, variant, v + 0.4);
            stats.lidarTrees!++;
        }
    }
    // 2. Near-infrared canopy where there is no lidar: scatter trees over dark, green pixels.
    for (const c of cells) {
        if (c.surface || !c.nir || !c.rgb) continue;
        const rand = rng(c.key.length * 977 + 13);
        const a = L({ lat: c.bbox.south, lon: c.bbox.west }), b = L({ lat: c.bbox.north, lon: c.bbox.east });
        for (let y = a.y + 3; y < b.y; y += 6) for (let x = a.x + 3; x < b.x; x += 6) {
            const p = { x: x + (rand() - 0.5) * 4, y: y + (rand() - 0.5) * 4 };
            const ll = proj.toLatLon(p), nd = ndviAt(c, ll), rgb = sampleImage(c.rgb, ll);
            if (nd == null || !rgb || nd < 0.18 || (rgb[0] + rgb[1] + rgb[2]) / 3 > 90) continue;
            const v = rand() < 0.72 ? (rand() < 0.5 ? 0 : 1) : rand() < 0.55 ? 2 : 3;
            addTree(p, v, v === 3 ? 12 + rand() * 8 : 20 + rand() * 14);
            stats.canopyTrees!++;
        }
    }
    // 3. OpenStreetMap woods and trees where neither covers.
    const covered = (p: P2) => { const ll = proj.toLatLon(p); const c = cellAt(ll); return !!c && (c.surface ? surfaceCovers(ll) : !!c.nir); };
    for (const w of osm.woods) {
        const rings = w.rings.map((r) => r.map(L));
        const orchard = w.tags.landuse === 'orchard', vineyard = w.tags.landuse === 'vineyard', scrub = w.tags.natural === 'scrub';
        if (vineyard) continue;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const r of rings) for (const p of r) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
        const rand = rng(w.id);
        // Denser near the road, sparser far away (far woods also read from the aerial photo on the terrain).
        for (let y = y0; y < y1;) {
            const dRow = roadDist({ x: (x0 + x1) / 2, y }, 600);
            const step = orchard ? 6 : dRow < 150 ? 6.5 : dRow < 500 ? 11 : 20;
            for (let x = x0; x < x1; x += step) {
                const p = { x: x + (orchard ? 0 : (rand() - 0.5) * step * 0.9), y: y + (orchard ? 0 : (rand() - 0.5) * step * 0.9) };
                if (!rings.some((r) => inRing(p, r)) || covered(p)) continue;
                const v = orchard || scrub ? 3 : rand() < 0.72 ? (rand() < 0.5 ? 0 : 1) : rand() < 0.55 ? 2 : 3;
                const h = orchard ? 4 + rand() * 2 : scrub ? 3 + rand() * 3 : v === 3 ? 12 + rand() * 8 : 22 + rand() * 16;
                addTree(p, v, h);
            }
            y += step;
        }
    }
    for (const t of osm.trees) { const p = L(t.at); if (!covered(p)) addTree(p, 3, 10 + hash(t.id) * 8); }
    // Tree rows (barrier list) become lines of trees.
    for (const b of osm.barriers.filter((b) => b.tags.barrier === 'tree_row')) {
        const line = b.line.map(L);
        for (let i = 0; i < line.length - 1; i++) {
            const a = line[i], c = line[i + 1], len = Math.hypot(c.x - a.x, c.y - a.y);
            for (let s = 0; s < len; s += 8) { const p = { x: a.x + ((c.x - a.x) * s) / len, y: a.y + ((c.y - a.y) * s) / len }; if (!covered(p)) addTree(p, 3, 9 + hash(b.id + s) * 6); }
        }
    }
    // Thin the farthest first if over budget.
    const maxTrees = opts.maxTrees ?? 30000;
    trees.sort((a, b) => a.d - b.d);
    const kept = trees.slice(0, maxTrees);
    if (kept.length) {
        const mat = treeMaterial();
        for (const t of kept) {
            const y = H(t.p) - 0.2;
            const w = t.w;
            const far = t.d > 700;
            const m = meshFor(far ? 'TREES_FAR' : 'TREES', t.p, mat, { castShadows: !far });
            const u0 = t.variant * 0.25 + 0.002, u1 = (t.variant + 1) * 0.25 - 0.002;
            const rot = hash(t.p.x * 7.1 + t.p.y * 3.3) * Math.PI;
            for (const k of [0, 1]) {
                const a = rot + (k * Math.PI) / 2, dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
                // Both faces of each plane; stored normals point up so foliage lights evenly from every side.
                const pn: V3 = [-Math.sin(a), 0, Math.cos(a)];
                m.double([[t.p.x - dx, y, t.p.y - dz], [t.p.x + dx, y, t.p.y + dz], [t.p.x + dx, y + t.h, t.p.y + dz], [t.p.x - dx, y + t.h, t.p.y - dz]], pn,
                    [[u0, 0], [u1, 0], [u1, 1], [u0, 1]], undefined, [0, 1, 0]);
            }
            // Trees inside the drivable corridor get a hidden trunk to hit.
            if (t.d < g.halfAt(nearRoute(t.p, 200).i) + 45) box(meshFor('1WALL_TRUNKS', t.p, mat, { visible: false, castShadows: false }), [t.p.x, y, t.p.y], [1, 0, 0], 0.5, 0.5, 3);
        }
        stats.trees = kept.length;
    }

    // ------------------------------------------------ barriers
    const concrete = macroDetailMaterial(book, lib, { name: 'osm_concrete', role: 'concrete', macro: { key: 'osm_concrete_macro', image: () => solid([150, 148, 142], 21), sizeM: 8 } });
    const woodM = macroDetailMaterial(book, lib, { name: 'osm_wood', role: 'wood', macro: { key: 'osm_wood_macro', image: () => solid([118, 98, 76], 23), sizeM: 8 } });
    const hedgeM = macroDetailMaterial(book, lib, { name: 'osm_hedge', role: 'grass', macro: { key: 'osm_hedge_macro', image: () => solid([46, 70, 36], 25, 0.2), sizeM: 8 } });
    const steelM = macroDetailMaterial(book, lib, { name: 'osm_steel', role: 'metal_roof', specular: 0.4, reflection: 0.2, macro: { key: 'osm_steel_macro', image: () => solid([160, 162, 165], 27), sizeM: 8 } });
    for (const b of osm.barriers) {
        const kind = b.tags.barrier;
        if (kind === 'tree_row') continue;
        const line = b.line.map(L);
        const near = Math.min(...line.map((p) => roadDist(p, 200)));
        if (near > 600) continue; // only what you can see from the road
        const coll = near < collisionM;
        const spec = kind === 'guard_rail' ? { h: 0.8, t: 0.08, mat: steelM, posts: 4, base: 0.45 }
            : kind === 'fence' ? { h: 1.2, t: 0.05, mat: woodM, posts: 2.4, base: 0.3 }
            : kind === 'hedge' ? { h: 1.6, t: 0.9, mat: hedgeM, posts: 0, base: 0 }
            : { h: kind === 'retaining_wall' ? 1.5 : 1.2, t: 0.3, mat: concrete, posts: 0, base: 0 };
        for (let i = 0; i < line.length - 1; i++) {
            const a = line[i], c = line[i + 1], len = Math.hypot(c.x - a.x, c.y - a.y);
            if (len < 0.1) continue;
            const steps = Math.max(1, Math.ceil(len / 2));
            for (let k = 0; k < steps; k++) {
                const p0 = { x: a.x + ((c.x - a.x) * k) / steps, y: a.y + ((c.y - a.y) * k) / steps };
                const p1 = { x: a.x + ((c.x - a.x) * (k + 1)) / steps, y: a.y + ((c.y - a.y) * (k + 1)) / steps };
                if (clearOfRoads(p0) < 1.5 || clearOfRoads(p1) < 1.5) continue; // gaps where it would cross a road
                const y0 = H(p0), y1 = H(p1), n: V3 = [(p1.y - p0.y) / (len / steps), 0, -(p1.x - p0.x) / (len / steps)];
                const m = meshFor(coll ? '1WALL_BAR' : 'BAR', p0, spec.mat);
                const segL = len / steps, u0 = (k * segL) / 8, u1 = ((k + 1) * segL) / 8;
                if (spec.t >= 0.3) {
                    // Solid wall or hedge: two faces and a top.
                    for (const s of [-1, 1]) {
                        const o = { x: n[0] * s * spec.t / 2, y: n[2] * s * spec.t / 2 };
                        m.face([[p0.x + o.x, y0 - 0.2, p0.y + o.y], [p1.x + o.x, y1 - 0.2, p1.y + o.y], [p1.x + o.x, y1 + spec.h, p1.y + o.y], [p0.x + o.x, y0 + spec.h, p0.y + o.y]], [n[0] * s, 0, n[2] * s], [[u0, 0], [u1, 0], [u1, spec.h / 8], [u0, spec.h / 8]]);
                    }
                    m.face([[p0.x - n[0] * spec.t / 2, y0 + spec.h, p0.y - n[2] * spec.t / 2], [p1.x - n[0] * spec.t / 2, y1 + spec.h, p1.y - n[2] * spec.t / 2], [p1.x + n[0] * spec.t / 2, y1 + spec.h, p1.y + n[2] * spec.t / 2], [p0.x + n[0] * spec.t / 2, y0 + spec.h, p0.y + n[2] * spec.t / 2]], [0, 1, 0], [[u0, 0], [u1, 0], [u1, 0.1], [u0, 0.1]]);
                } else {
                    // Rail or plank band between base and top, with posts.
                    m.double([[p0.x, y0 + spec.base, p0.y], [p1.x, y1 + spec.base, p1.y], [p1.x, y1 + spec.h, p1.y], [p0.x, y0 + spec.h, p0.y]], n, [[u0, 0], [u1, 0], [u1, (spec.h - spec.base) / 8], [u0, (spec.h - spec.base) / 8]]);
                    if (spec.posts && (k * segL) % spec.posts < segL) box(m, [p0.x, y0, p0.y], [p1.x - p0.x, 0, p1.y - p0.y], 0.12, 0.12, spec.h + 0.05);
                }
            }
        }
        stats.barriers++;
    }

    const parts = [...meshes.values()].flatMap((m) => m.parts).filter((p) => p.indices.length);
    for (const p of parts) {
        if (p.name.startsWith('TREES_FAR')) p.lodOut = 3500;
        else if ((p.name.startsWith('BLD') || p.name.startsWith('ROOF')) && p.name.split('_').length > 2) {
            // Far building chunks drop out beyond 4 km (Assetto Corsa LOD).
            p.lodOut = 4000;
        }
    }
    return { parts, stats };
}
