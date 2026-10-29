// The small things along a real street: wooden utility poles and their wires (OpenStreetMap power lines, plus
// poles found in the lidar), fire hydrants, rural mailboxes, parked cars in parking lanes and lots, driveways to
// garages that face the road, and the yellow tactile panels at crosswalk kerb ramps.

import type { Centerline } from './route.ts';
import type { MeshPart, TrackGeometry, V3 } from './mesh.ts';
import type { RoadInfo } from './roadinfo.ts';
import type { OsmFeatures } from './osm.ts';
import type { SiteRasters } from './site.ts';
import { sampleImage } from './site.ts';
import type { MaterialBook, MaterialLibrary } from './materials.ts';
import { macroDetailMaterial, solidMacro } from './materials.ts';
import type { Rgba } from './dds.ts';
import { Mesh, box } from './elements.ts';

type P2 = { x: number; y: number };
type Ground = (x: number, z: number) => number | null;

export interface Driveway { door: P2; n: P2; width: number }
export interface HouseFront { at: P2; n: P2 }

export interface RoadsideOptions {
    site?: SiteRasters;
    /** Distances along the route of crosswalks across it. */
    crossS?: number[];
    /** Side-street footprints, to keep cars and hydrants off them. */
    stubs?: { pts: P2[]; half: number }[];
    /** Garage doors facing the road (from the buildings). */
    driveways?: Driveway[];
    /** Fronts of houses (for curbside mailboxes on rural stretches). */
    fronts?: HouseFront[];
    /** Lots fill this share of their stalls, and parking lanes this share of their spaces (0..1). */
    occupancy?: number;
}

export interface RoadsideStats { stallLines: number; lamps: number; poles: number; lidarPoles: number; wires: number; hydrants: number; mailboxes: number; parkedCars: number; lotCars: number; driveways: number; ramps: number }

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function hash2(x: number, y: number) { let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(y * 10) | 0, 19349663); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; }

/** Car paint swatches in one small atlas: colour cells along u, rows: paint, glass, tyre, lights. */
export function carAtlas(): Rgba {
    const W = 256, H = 64, data = new Uint8Array(W * H * 4);
    const paints = [[230, 230, 228], [22, 22, 24], [168, 170, 172], [96, 98, 102], [40, 58, 104], [140, 24, 26], [70, 82, 70], [190, 176, 150]];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, row = Math.floor(y / 16), col = Math.floor(x / 32);
        const c = row === 0 ? paints[col] : row === 1 ? [30 + y % 16, 38 + y % 16, 46 + y % 16] : row === 2 ? [26, 26, 26] : col % 2 ? [200, 30, 24] : [240, 236, 220];
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
    return { width: W, height: H, data };
}
const swatch = (row: number, col: number): [number, number][] => { const u = (col + 0.5) / 8, v = 1 - (row + 0.5) / 4; return [[u, v], [u, v], [u, v], [u, v]]; };

export function buildRoadside(cl: Centerline, g: TrackGeometry, road: RoadInfo | null, osm: OsmFeatures | undefined, ground: Ground, book: MaterialBook, lib: MaterialLibrary | undefined, opts: RoadsideOptions = {}): { parts: MeshPart[]; stats: RoadsideStats; /** Street-lamp lens centres (night lights). */ lights: V3[] } {
    const proj = cl.projection, P = cl.points, n = P.length;
    const L = (p: { lat: number; lon: number }): P2 => proj.toLocal(p);
    const lights: V3[] = [];
    const stats: RoadsideStats = { stallLines: 0, lamps: 0, poles: 0, lidarPoles: 0, wires: 0, hydrants: 0, mailboxes: 0, parkedCars: 0, lotCars: 0, driveways: 0, ramps: 0 };
    const occ = opts.occupancy ?? 0.6;

    // ------------------------------------------------ lookups
    const GC = 20, grid = new Map<string, number[]>();
    P.forEach((p, i) => { const k = `${Math.floor(p.x / GC)},${Math.floor(p.y / GC)}`; let b = grid.get(k); if (!b) grid.set(k, (b = [])); b.push(i); });
    const nearest = (p: P2, reach = 80): { i: number; d: number; lat: number } => {
        const cx = Math.floor(p.x / GC), cy = Math.floor(p.y / GC), r = Math.ceil(reach / GC);
        let best = -1, bd = Infinity;
        for (let a = cx - r; a <= cx + r; a++) for (let b = cy - r; b <= cy + r; b++) for (const i of grid.get(`${a},${b}`) ?? []) { const d = Math.hypot(p.x - P[i].x, p.y - P[i].y); if (d < bd) { bd = d; best = i; } }
        if (best < 0) return { i: -1, d: Infinity, lat: 0 };
        const t = cl.tangents[best];
        return { i: best, d: bd, lat: (p.x - P[best].x) * t.y - (p.y - P[best].y) * t.x };
    };
    const right = (i: number) => ({ x: cl.tangents[i].y, y: -cl.tangents[i].x });
    const idxAt = (sM: number) => { const x = Math.max(0, Math.min(cl.length, sM)); let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cl.s[mid] <= x) lo = mid; else hi = mid - 1; } return lo; };
    const at = (i: number, lat: number): P2 => { const r = right(i); return { x: P[i].x + r.x * lat, y: P[i].y + r.y * lat }; };
    const urban = (i: number) => !!road && !road.lanes[i]?.edgeLines && !road.lanes[i]?.lot;
    const H = (p: P2) => { const q = nearest(p, 40); if (q.i >= 0 && Math.abs(q.lat) < g.halfAt(q.i) + g.vergeReach(q.i, q.lat < 0 ? -1 : 1)) return g.surfaceAt(q.i, q.lat); return ground(p.x, p.y) ?? (q.i >= 0 ? g.surfaceAt(q.i, q.lat) : 0); };
    const stubSegs = (opts.stubs ?? []).flatMap((st) => st.pts.slice(1).map((b, k) => ({ a: st.pts[k], b, h: st.half })));
    const onStub = (p: P2, pad = 0) => stubSegs.some((s) => { const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2)); return Math.hypot(p.x - s.a.x - dx * t, p.y - s.a.y - dy * t) < s.h + pad; });

    // ------------------------------------------------ materials and meshes
    const woodM = macroDetailMaterial(book, lib, { name: 'rs_pole_wood', role: 'wood', macro: { key: 'rs_pole_wood_macro', image: () => solidMacro([92, 74, 58], 64, 0.08, 71), sizeM: 4 } });
    const flat = (name: string, rgb: [number, number, number], spec = 0.1, exp = 30) => {
        if (book.has(name)) return name;
        const tex = book.image(`${name}.dds`, () => ({ width: 8, height: 8, data: new Uint8Array(256).map((_, i) => (i % 4 === 3 ? 255 : rgb[i % 4])) }));
        return book.add({ name, shader: 'ksPerPixel', properties: [{ name: 'ksAmbient', a: 0.45 }, { name: 'ksDiffuse', a: 0.55 }, { name: 'ksSpecular', a: spec }, { name: 'ksSpecularEXP', a: exp }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0 }], textures: [{ sampler: 'txDiffuse', slot: 0, texture: tex }] });
    };
    const wireM = flat('rs_wire', [24, 24, 26], 0.3);
    const metalM = flat('rs_metal', [120, 122, 124], 0.4, 40);
    const insulM = flat('rs_insulator', [150, 112, 70], 0.5, 60);
    const hydrantM = flat('rs_hydrant', [222, 182, 30], 0.3, 30);
    const mailM = flat('rs_mailbox', [40, 42, 44], 0.4, 30);
    const tactileM = flat('rs_tactile', [214, 172, 40], 0.1);
    const carTex = book.image('rs_cars.dds', carAtlas, { format: 'bc1' });
    const carM = book.has('rs_car') ? 'rs_car' : book.add({ name: 'rs_car', shader: 'ksPerPixel', properties: [{ name: 'ksAmbient', a: 0.4 }, { name: 'ksDiffuse', a: 0.5 }, { name: 'ksSpecular', a: 0.7 }, { name: 'ksSpecularEXP', a: 60 }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0 }], textures: [{ sampler: 'txDiffuse', slot: 0, texture: carTex }] });
    const concreteM = 'gutter';
    const meshes = new Map<string, Mesh>();
    const CH = 200;
    const mesh = (kind: string, p: P2, mat: string, flags: { visible?: boolean; castShadows?: boolean } = {}) => {
        const k = `${kind}_${Math.floor(p.x / CH)}_${Math.floor(p.y / CH)}`.replace(/-/g, 'm');
        let m = meshes.get(`${k}|${mat}`);
        if (!m) meshes.set(`${k}|${mat}`, (m = new Mesh(k, mat, flags)));
        return m;
    };
    const hit = (p: P2) => mesh('1WALL_RS', p, metalM, { visible: false, castShadows: false });

    /** A tapered n-sided post from y0 to y1. */
    const post = (m: Mesh, c: V3, r0: number, r1: number, h: number, sides = 8) => {
        for (let k = 0; k < sides; k++) {
            const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
            const d0: V3 = [Math.cos(a0), 0, Math.sin(a0)], d1: V3 = [Math.cos(a1), 0, Math.sin(a1)], dn: V3 = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
            m.face([[c[0] + d0[0] * r0, c[1], c[2] + d0[2] * r0], [c[0] + d1[0] * r0, c[1], c[2] + d1[2] * r0], [c[0] + d1[0] * r1, c[1] + h, c[2] + d1[2] * r1], [c[0] + d0[0] * r1, c[1] + h, c[2] + d0[2] * r1]], dn,
                [[k / sides, 0], [(k + 1) / sides, 0], [(k + 1) / sides, h / 2], [k / sides, h / 2]]);
        }
        m.face(Array.from({ length: Math.min(4, sides) }, (_, k) => { const a = (k / 4) * Math.PI * 2; return [c[0] + Math.cos(a) * r1, c[1] + h, c[2] + Math.sin(a) * r1] as V3; }), [0, 1, 0], [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]]);
    };

    // ------------------------------------------------ utility poles
    interface Pole { p: P2; y: number; h: number; dir: P2; lidar: boolean; side: number; s: number }
    const poles: Pole[] = [];
    const lampCands: { p: P2; h: number; q: { i: number; d: number; lat: number } }[] = [];
    const lampsAndSignals = (osm?.points ?? []).filter((q) => q.tags.highway === 'street_lamp' || q.tags.highway === 'traffic_signals').map((q) => L(q.at));
    const addPole = (p: P2, h: number, lidar: boolean) => {
        if (poles.some((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) < 6)) return;
        const q = nearest(p, 120);
        if (q.i >= 0 && Math.abs(q.lat) < g.halfAt(q.i) + 0.6) return; // never on the asphalt
        if (onStub(p, 0.4)) return;
        const t = q.i >= 0 ? cl.tangents[q.i] : { x: 1, y: 0 };
        poles.push({ p, y: H(p), h, dir: { x: t.x, y: t.y }, lidar, side: q.lat < 0 ? -1 : 1, s: q.i >= 0 ? cl.s[q.i] : 0 });
    };
    for (const q of osm?.points ?? []) if (q.tags.power === 'pole' || q.tags.power === 'tower') { const p = L(q.at), nq = nearest(p, 120); if (nq.d < 120) addPole(p, q.tags.power === 'tower' ? 18 : 11 + hash2(p.x, p.y) * 2, false); }
    // Lidar: thin, isolated tall returns (a pole top and crossarm) near the road that the near-infrared says
    // aren't trees, away from mapped lamps and signals.
    for (const c of opts.site?.cells ?? []) {
        const s = c.surface;
        if (!s) continue;
        const W = s.width, Hh = s.height;
        const pxW = (s.bbox.east - s.bbox.west) / W, pxH = (s.bbox.north - s.bbox.south) / Hh;
        for (let y = 2; y < Hh - 2; y++) for (let x = 2; x < W - 2; x++) {
            const v = s.above[y * W + x];
            if (!(v >= 6.5 && v <= 17) || s.cls[y * W + x] === 17) continue;
            let isMax = true, low = 0, ring = 0;
            for (let dy = -2; dy <= 2 && isMax; dy++) for (let dx = -2; dx <= 2; dx++) {
                if (!dx && !dy) continue;
                const w = s.above[(y + dy) * W + x + dx];
                if (w > v) { isMax = false; break; }
                if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) { ring++; if (!(w > v - 4)) low++; }
            }
            if (!isMax || low < ring - 4) continue;
            const ll = { lat: s.bbox.north - (y + 0.5) * pxH, lon: s.bbox.west + (x + 0.5) * pxW };
            const p = L(ll), q = nearest(p, 40);
            if (q.i < 0 || Math.abs(q.lat) > g.halfAt(q.i) + 18) continue;
            if (c.nir && c.rgb) { const ni = sampleImage(c.nir, ll), rr = sampleImage(c.rgb, ll); if (ni && rr && (ni[0] - rr[0]) / (ni[0] + rr[0] + 1) > 0.15) continue; }
            if (lampsAndSignals.some((l) => Math.hypot(l.x - p.x, l.y - p.y) < 5)) continue;
            if (v < 9.5) { lampCands.push({ p, h: v, q }); continue; } // street-light height: a lamp, not a utility pole
            const before = poles.length;
            addPole(p, v + 0.3, true);
            if (poles.length > before) stats.lidarPoles++;
        }
    }
    const crossarm = (pl: Pole) => {
        const nrm = { x: -pl.dir.y, y: pl.dir.x }; // arm across the line
        return { a: { x: pl.p.x - nrm.x * 1.2, y: pl.p.y - nrm.y * 1.2 }, b: { x: pl.p.x + nrm.x * 1.2, y: pl.p.y + nrm.y * 1.2 }, nrm };
    };
    // ------------------------------------------------ wires
    /** A sagging wire from a to b (both V3), a thin crossed ribbon so it shows from any angle. */
    const wire = (a: V3, b: V3, sag: number, thick = 0.025) => {
        const m = mesh('RS_WIRES', { x: a[0], y: a[2] }, wireM, { castShadows: false });
        const N = 10, pts: V3[] = [];
        for (let k = 0; k <= N; k++) { const t = k / N; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]); }
        const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, side: V3 = [-dz / l * thick / 2, 0, dx / l * thick / 2];
        for (let k = 0; k < N; k++) {
            const p0 = pts[k], p1 = pts[k + 1];
            m.double([[p0[0], p0[1] - thick / 2, p0[2]], [p1[0], p1[1] - thick / 2, p1[2]], [p1[0], p1[1] + thick / 2, p1[2]], [p0[0], p0[1] + thick / 2, p0[2]]], [side[0], 0, side[2]].map((v) => v / (thick / 2)) as V3, [[0, 0], [1, 0], [1, 1], [0, 1]]);
            m.double([[p0[0] - side[0], p0[1], p0[2] - side[2]], [p1[0] - side[0], p1[1], p1[2] - side[2]], [p1[0] + side[0], p1[1], p1[2] + side[2]], [p0[0] + side[0], p0[1], p0[2] + side[2]]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
    };
    const span = (a: Pole, b: Pole) => {
        const d = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y);
        const A = crossarm(a), B = crossarm(b);
        // Match arm ends so wires don't cross.
        const flip = Math.hypot(A.a.x - B.a.x, A.a.y - B.a.y) > Math.hypot(A.a.x - B.b.x, A.a.y - B.b.y);
        const ends = (arm: ReturnType<typeof crossarm>, pl: Pole, f: number) => ({ x: pl.p.x + arm.nrm.x * f * 1.05, y: pl.p.y + arm.nrm.y * f * 1.05 });
        for (const f of [-1, 0, 1]) {
            const pa = ends(A, a, f), pb = ends(B, b, flip ? -f : f);
            wire([pa.x, a.y + a.h - 0.38, pa.y], [pb.x, b.y + b.h - 0.38, pb.y], d * 0.018);
        }
        wire([a.p.x, a.y + a.h - 3.4, a.p.y], [b.p.x, b.y + b.h - 3.4, b.p.y], d * 0.025, 0.035); // telephone / cable
        stats.wires++;
    };
    const joined = new Set<string>(), spans: [Pole, Pole][] = [], wired = new Set<Pole>();
    const join = (a: Pole, b: Pole) => { const k = [poles.indexOf(a), poles.indexOf(b)].sort().join(','); if (joined.has(k)) return; joined.add(k); spans.push([a, b]); wired.add(a); wired.add(b); };
    // Mapped lines: consecutive vertices that are poles.
    for (const ln of osm?.power ?? []) {
        const pts = ln.line.map(L);
        let prev: Pole | null = null;
        for (const p of pts) {
            const pl = poles.find((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) < 3) ?? null;
            if (pl && prev && Math.hypot(pl.p.x - prev.p.x, pl.p.y - prev.p.y) < 90) {
                // Crossarms square to the wires they carry.
                const d = norm2({ x: pl.p.x - prev.p.x, y: pl.p.y - prev.p.y });
                pl.dir = d; if (!wired.has(prev)) prev.dir = d;
                join(prev, pl);
            }
            prev = pl;
        }
    }
    // Lidar poles: chain each side of the road in order along it (20 - 70 m apart, similar offset).
    for (const side of [-1, 1]) {
        const row = poles.filter((p) => p.lidar && p.side === side).sort((a, b) => a.s - b.s);
        for (let k = 1; k < row.length; k++) {
            const a = row[k - 1], b = row[k], d = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y);
            if (d > 18 && d < 75) { a.dir = b.dir = norm2({ x: b.p.x - a.p.x, y: b.p.y - a.p.y }); join(a, b); }
        }
    }

    // A lidar spike with no neighbour to string a wire to is more likely a lamp, sign or flagpole: drop it.
    for (let k = poles.length - 1; k >= 0; k--) if (poles[k].lidar && !wired.has(poles[k])) { poles.splice(k, 1); stats.lidarPoles--; }
    for (const pl of poles) {
        const m = mesh('RS_POLES', pl.p, woodM);
        post(m, [pl.p.x, pl.y - 0.3, pl.p.y], 0.17, 0.12, pl.h + 0.3);
        const arm = crossarm(pl), ay = pl.y + pl.h - 0.6;
        box(m, [pl.p.x, ay, pl.p.y], [arm.nrm.x, 0, arm.nrm.y], 0.1, 2.4, 0.1);
        const ins = mesh('RS_INSUL', pl.p, insulM);
        for (const f of [-1, 0, 1]) box(ins, [pl.p.x + arm.nrm.x * f * 1.05, ay + 0.1, pl.p.y + arm.nrm.y * f * 1.05], [arm.nrm.x, 0, arm.nrm.y], 0.08, 0.08, 0.22);
        // Telephone / cable bracket lower down, and a transformer can on some.
        box(mesh('RS_METAL', pl.p, metalM), [pl.p.x, pl.y + pl.h - 3.4, pl.p.y], [arm.nrm.x, 0, arm.nrm.y], 0.06, 0.5, 0.06);
        if (hash2(pl.p.x, pl.p.y) < 0.22) post(mesh('RS_METAL', pl.p, metalM), [pl.p.x + arm.nrm.x * 0.35, pl.y + pl.h - 2.6, pl.p.y + arm.nrm.y * 0.35], 0.28, 0.28, 0.95, 8);
        const q = nearest(pl.p, 40);
        if (q.i >= 0 && Math.abs(q.lat) < g.halfAt(q.i) + 4) box(hit(pl.p), [pl.p.x, pl.y, pl.p.y], [1, 0, 0], 0.4, 0.4, 3);
        stats.poles++;
    }

    for (const [a, b] of spans) span(a, b);

    // ------------------------------------------------ street lights
    // Cobra-head lamps where the lidar finds a lone 6.5 - 9.5 m pole by the kerb, and on some utility poles
    // close to the road (as residential streets have them). Their lights switch on at night (ext_config).
    const lampHead = flat('st_lamp_head', [96, 98, 100], 0.3, 40), lampLens = flat('st_lamp_lens', [255, 222, 170], 0.4, 40);
    const lampAt: P2[] = [...lampsAndSignals];
    const cobra = (base: P2, y: number, toRoad: P2, armY: number, withPole: boolean) => {
        const m = mesh('RS_LAMPS', base, metalM);
        if (withPole) post(m, [base.x, y - 0.3, base.y], 0.11, 0.08, armY + 0.5 - y, 8);
        const tip: V3 = [base.x + toRoad.x * 1.8, armY + 0.25, base.y + toRoad.y * 1.8];
        // Arm: a thin box from the pole to the tip.
        const mid: V3 = [(base.x + tip[0]) / 2, armY, (base.y + tip[2]) / 2];
        box(m, mid, [toRoad.x, 0, toRoad.y], 0.07, 1.9, 0.08);
        box(mesh('RS_LAMPS', base, lampHead), [tip[0], tip[1] - 0.2, tip[2]], [toRoad.x, 0, toRoad.y], 0.32, 0.7, 0.18);
        const lc = (u: number, v: number): V3 => [tip[0] + toRoad.x * u - toRoad.y * v, tip[1] - 0.205, tip[2] + toRoad.y * u + toRoad.x * v];
        mesh('RS_LAMPS', base, lampLens).face([lc(-0.28, -0.11), lc(0.28, -0.11), lc(0.28, 0.11), lc(-0.28, 0.11)], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        lights.push(lc(0, 0));
        lampAt.push(base);
        stats.lamps++;
    };
    for (const c of lampCands) {
        if (c.q.i < 0 || Math.abs(c.q.lat) - g.halfAt(c.q.i) > 5 || lampAt.some((l) => Math.hypot(l.x - c.p.x, l.y - c.p.y) < 12)) continue;
        if (poles.some((pl) => Math.hypot(pl.p.x - c.p.x, pl.p.y - c.p.y) < 8)) continue;
        const r = right(c.q.i), sgn = Math.sign(c.q.lat || 1), toRoad = { x: -r.x * sgn, y: -r.y * sgn };
        // The lidar peak is the lamp head, which hangs over the kerb: stand the pole behind the kerb, 1.8 m back.
        const h = g.halfAt(c.q.i), poleLat = sgn * Math.max(Math.abs(c.q.lat) + 1.8, h + 0.8);
        const base = at(c.q.i, poleLat);
        if (onStub(base, 0.5)) continue;
        cobra(base, H(base), toRoad, H(base) + c.h - 0.3, true);
    }
    for (const pl of poles) {
        const q = nearest(pl.p, 40);
        if (q.i < 0 || Math.abs(q.lat) - g.halfAt(q.i) > 4 || hash2(pl.p.y, pl.p.x) > 0.45 || lampAt.some((l) => Math.hypot(l.x - pl.p.x, l.y - pl.p.y) < 20)) continue;
        const r = right(q.i), sgn = Math.sign(q.lat || 1);
        cobra(pl.p, pl.y, { x: -r.x * sgn, y: -r.y * sgn }, pl.y + pl.h - 4.6, false);
    }

    // ------------------------------------------------ hydrants
    const hydrant = (p: P2) => {
        const y = H(p), m = mesh('RS_HYDRANTS', p, hydrantM);
        post(m, [p.x, y, p.y], 0.13, 0.12, 0.62, 8);
        post(m, [p.x, y + 0.62, p.y], 0.14, 0.05, 0.14, 8);
        box(m, [p.x, y + 0.42, p.y], [1, 0, 0], 0.42, 0.1, 0.1);
        box(m, [p.x, y + 0.4, p.y], [0, 0, 1], 0.32, 0.12, 0.12);
        box(hit(p), [p.x, y, p.y], [1, 0, 0], 0.3, 0.3, 0.8);
        stats.hydrants++;
    };
    const mappedHydrants = (osm?.points ?? []).filter((q) => q.tags.emergency === 'fire_hydrant').map((q) => L(q.at));
    for (const h0 of mappedHydrants) {
        // Mapped at the kerb, but our asphalt is an estimate: never on it (push to the back of the kerb), never on a side street.
        const q = nearest(h0, 40);
        let p = h0;
        if (q.i >= 0 && Math.abs(q.lat) < g.halfAt(q.i) + 0.6) { const side = q.lat < 0 ? -1 : 1; p = at(q.i, side * (g.halfAt(q.i) + Math.max(0.6, Math.min(1.6, g.vergeReach(q.i, side) - 0.3)))); }
        if (onStub(p, 0.5)) continue;
        hydrant(p);
    }
    if (!mappedHydrants.length && road) {
        // Unmapped: one every ~140 m along town streets, at the back of the sidewalk, alternating sides.
        let side: -1 | 1 = 1;
        for (let sM = 40; sM < cl.length - 20; sM += 120 + hash2(sM, 1) * 50) {
            const i = idxAt(sM);
            if (!urban(i) || g.onBridge(i)) continue;
            const lat = side * (g.halfAt(i) + Math.max(0.5, Math.min(1.6, g.vergeReach(i, side) - 0.3)));
            const p = at(i, lat);
            if (onStub(p, 2)) continue;
            hydrant(p);
            side = side === 1 ? -1 : 1;
        }
    }

    // ------------------------------------------------ cars
    /** A parked car: centre on the ground, facing `f` (unit plan), colour index. ~5 m x 1.85 m. */
    const car = (c: P2, f: P2, colour: number, collide: boolean) => {
        const m = mesh(collide ? 'RS_CARS' : 'RS_LOTCARS', c, carM);
        const y = H(c), r = { x: -f.y, y: f.x };
        const len = 4.4 + (colour % 3) * 0.3, wid = 1.82, hb = 0.72, hc = 1.42;
        const pt = (u: number, v: number, h: number): V3 => [c.x + f.x * u + r.x * v, y + h, c.y + f.y * u + r.y * v];
        const fwd: V3 = [f.x, 0, f.y], rt: V3 = [r.x, 0, r.y];
        const paint = swatch(0, colour % 8), glass = swatch(1, colour % 8), tyre = swatch(2, 0);
        const hl = len / 2, hw = wid / 2;
        // Lower body: a box from 0.3 to hb with the bonnet and boot tops.
        m.face([pt(-hl, -hw, 0.3), pt(hl, -hw, 0.3), pt(hl, -hw, hb), pt(-hl, -hw, hb)], [-rt[0], 0, -rt[2]], paint);
        m.face([pt(hl, hw, 0.3), pt(-hl, hw, 0.3), pt(-hl, hw, hb), pt(hl, hw, hb)], rt, paint);
        m.face([pt(hl, -hw, 0.3), pt(hl, hw, 0.3), pt(hl, hw, hb - 0.05), pt(hl, -hw, hb - 0.05)], fwd, paint);
        m.face([pt(-hl, hw, 0.3), pt(-hl, -hw, 0.3), pt(-hl, -hw, hb), pt(-hl, hw, hb)], [-fwd[0], 0, -fwd[2]], paint);
        m.face([pt(-hl, -hw, hb), pt(hl, -hw, hb - 0.05), pt(hl, hw, hb - 0.05), pt(-hl, hw, hb)], [0, 1, 0], paint);
        // Cabin: glasshouse tapering in, roof in paint.
        const c0 = -hl * 0.55, c1 = hl * 0.25, w2 = hw * 0.86;
        m.face([pt(c0, -hw, hb), pt(c1 + 0.5, -hw, hb), pt(c1, -w2, hc), pt(c0 + 0.35, -w2, hc)], [-rt[0], 0.3, -rt[2]], glass);
        m.face([pt(c1 + 0.5, hw, hb), pt(c0, hw, hb), pt(c0 + 0.35, w2, hc), pt(c1, w2, hc)], [rt[0], 0.3, rt[2]], glass);
        m.face([pt(c1 + 0.5, -hw, hb), pt(c1 + 0.5, hw, hb), pt(c1, w2, hc), pt(c1, -w2, hc)], [fwd[0], 0.6, fwd[2]], glass);
        m.face([pt(c0, hw, hb), pt(c0, -hw, hb), pt(c0 + 0.35, -w2, hc), pt(c0 + 0.35, w2, hc)], [-fwd[0], 0.6, -fwd[2]], glass);
        m.face([pt(c0 + 0.35, -w2, hc), pt(c1, -w2, hc), pt(c1, w2, hc), pt(c0 + 0.35, w2, hc)], [0, 1, 0], paint);
        // Wheels (boxes) and lights.
        for (const u of [-hl + 0.85, hl - 0.85]) for (const v of [-hw + 0.12, hw - 0.12]) {
            const cc = pt(u, v, 0), m2 = mesh(collide ? 'RS_CARS' : 'RS_LOTCARS', c, carM);
            const q = (du: number, dv: number, h: number) => pt(u + du, v + dv, h);
            const side = v < 0 ? -1 : 1;
            m2.face([q(-0.33, side * 0.13, 0), q(0.33, side * 0.13, 0), q(0.33, side * 0.13, 0.64), q(-0.33, side * 0.13, 0.64)], [rt[0] * side, 0, rt[2] * side], tyre);
            void cc;
        }
        m.face([pt(hl + 0.01, -hw + 0.1, hb - 0.25), pt(hl + 0.01, -hw + 0.45, hb - 0.25), pt(hl + 0.01, -hw + 0.45, hb - 0.1), pt(hl + 0.01, -hw + 0.1, hb - 0.1)], fwd, swatch(3, 0));
        m.face([pt(hl + 0.01, hw - 0.45, hb - 0.25), pt(hl + 0.01, hw - 0.1, hb - 0.25), pt(hl + 0.01, hw - 0.1, hb - 0.1), pt(hl + 0.01, hw - 0.45, hb - 0.1)], fwd, swatch(3, 0));
        m.face([pt(-hl - 0.01, hw - 0.1, hb - 0.25), pt(-hl - 0.01, hw - 0.45, hb - 0.25), pt(-hl - 0.01, hw - 0.45, hb - 0.1), pt(-hl - 0.01, hw - 0.1, hb - 0.1)], [-fwd[0], 0, -fwd[2]], swatch(3, 1));
        m.face([pt(-hl - 0.01, -hw + 0.45, hb - 0.25), pt(-hl - 0.01, -hw + 0.1, hb - 0.25), pt(-hl - 0.01, -hw + 0.1, hb - 0.1), pt(-hl - 0.01, -hw + 0.45, hb - 0.1)], [-fwd[0], 0, -fwd[2]], swatch(3, 1));
        if (collide) box(hit(c), [c.x, y, c.y], [f.x, 0, f.y], wid, len, 1.3);
    };
    // Parking lanes on the route: the outer 2.4 m of each side where OSM maps parking.
    if (road) {
        const avoid = [...(opts.crossS ?? [])];
        for (const side of [-1, 1] as const) {
            for (let sM = 8; sM < cl.length - 8; sM += 6.4) {
                const i = idxAt(sM), ls = road.lanes[i];
                if (!ls || g.onBridge(i)) continue;
                const extra = side < 0 ? ls.extraL : ls.extraR;
                // extraL / extraR are already turned to the route's direction; parking is the outermost lane.
                if (extra < 2.3) continue;
                if (avoid.some((c) => Math.abs(c - sM) < 9)) continue;
                const h = g.halfAt(i), p = at(i, side * (h - 1.15));
                if (onStub(p, 5)) continue;
                if (hash2(sM, side) > occ) continue;
                const t = cl.tangents[i], dir = side > 0 ? { x: t.x, y: t.y } : { x: -t.x, y: -t.y };
                car(p, dir, Math.floor(hash2(sM * 3, side) * 64), true);
                stats.parkedCars++;
            }
        }
    }
    // Parking lots: rows of stalls across the lot's long axis, part full.
    for (const a of osm?.areas ?? []) {
        if (a.tags.amenity !== 'parking' || a.tags.parking === 'street_side' || a.tags.parking === 'underground' || a.tags.parking === 'multi-storey') continue;
        const ring = a.rings[0]?.map(L);
        if (!ring || ring.length < 4) continue;
        const ctr = ring.reduce((s, p) => ({ x: s.x + p.x / ring.length, y: s.y + p.y / ring.length }), { x: 0, y: 0 });
        const nq = nearest(ctr, 300);
        if (nq.d > 260) continue;
        // Long axis by the longest edge.
        let ax = { x: 1, y: 0 }, best = 0;
        for (let k = 0; k < ring.length - 1; k++) { const dx = ring[k + 1].x - ring[k].x, dy = ring[k + 1].y - ring[k].y, l = Math.hypot(dx, dy); if (l > best) { best = l; ax = { x: dx / l, y: dy / l }; } }
        const ay = { x: -ax.y, y: ax.x };
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const p of ring) { const u = (p.x - ctr.x) * ax.x + (p.y - ctr.y) * ax.y, v = (p.x - ctr.x) * ay.x + (p.y - ctr.y) * ay.y; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
        const rand = rng(a.id);
        // Double rows of 5.4 m stalls with 7 m aisles: period 17.8 m across.
        for (let v = v0 + 3.2; v < v1 - 2.6; v += 17.8) for (const vv of [v, v + 5.6]) {
            if (vv > v1 - 2.6) continue;
            for (let u = u0 + 1.5; u < u1 - 1.4; u += 2.75) {
                const p = { x: ctr.x + ax.x * u + ay.x * vv, y: ctr.y + ax.y * u + ay.y * vv };
                // Stall line on the stall's left edge (and the last stall's right edge), 10 cm wide, 5 m long.
                for (const du of u + 2.75 >= u1 - 1.4 ? [-1.375, 1.375] : [-1.375]) {
                    const c = { x: p.x + ax.x * du, y: p.y + ax.y * du };
                    const ends = [-2.5, 2.5].map((dv) => ({ x: c.x + ay.x * dv, y: c.y + ay.y * dv }));
                    if (!ends.every((e) => inRing(e, ring))) continue;
                    if (ends.some((e) => { const q = nearest(e, 40); return q.i >= 0 && Math.abs(q.lat) < g.halfAt(q.i) + 0.3; }) || ends.some((e) => onStub(e, 0.3))) continue;
                    const m = mesh('PAINT_STALLS', c, 'paint_white', { castShadows: false });
                    const w = { x: ax.x * 0.05, y: ax.y * 0.05 };
                    const P = (e: P2, sg: number): V3 => [e.x + w.x * sg, H(e) + 0.03, e.y + w.y * sg];
                    m.face([P(ends[0], -1), P(ends[1], -1), P(ends[1], 1), P(ends[0], 1)], [0, 1, 0], [[0, 0], [0, 5 / 4], [0.1 / 4, 5 / 4], [0.1 / 4, 0]]);
                    stats.stallLines++;
                }
                if (!inRing(p, ring) || rand() > occ) continue;
                const q = nearest(p, 40);
                if (q.i >= 0 && Math.abs(q.lat) < g.halfAt(q.i) + 3) continue;
                if (onStub(p, 2)) continue;
                const face = vv === v ? ay : { x: -ay.x, y: -ay.y };
                car(p, face, Math.floor(rand() * 64), false);
                stats.lotCars++;
            }
        }
    }

    // ------------------------------------------------ driveways and mailboxes
    for (const dw of opts.driveways ?? []) {
        // From the garage door straight out to the road edge, if the road is close and nothing is in the way.
        const q = nearest(dw.door, 60);
        if (q.i < 0) continue;
        const dirToRoad = { x: P[q.i].x - dw.door.x, y: P[q.i].y - dw.door.y }, dl = Math.hypot(dirToRoad.x, dirToRoad.y);
        if (dirToRoad.x * dw.n.x + dirToRoad.y * dw.n.y < dl * 0.7) continue; // the garage doesn't face the route
        const len = Math.abs(q.lat) - g.halfAt(q.i) - 0.2;
        if (len < 1 || len > 45) continue;
        const m = mesh('RS_DRIVE', dw.door, concreteM, { castShadows: false });
        const steps = Math.max(1, Math.ceil(len / 2));
        const half = dw.width / 2 + 0.3, side = { x: -dw.n.y, y: dw.n.x };
        const ptAt = (t: number, v: number): V3 => { const p = { x: dw.door.x + dw.n.x * t * len + side.x * v, y: dw.door.y + dw.n.y * t * len + side.y * v }; return [p.x, H(p) + 0.03, p.y]; };
        for (let k = 0; k < steps; k++) {
            const t0 = k / steps, t1 = (k + 1) / steps;
            m.face([ptAt(t0, -half), ptAt(t1, -half), ptAt(t1, half), ptAt(t0, half)], [0, 1, 0], [[0, t0 * len / 4], [0, t1 * len / 4], [dw.width / 4, t1 * len / 4], [dw.width / 4, t0 * len / 4]]);
        }
        stats.driveways++;
    }
    for (const fr of opts.fronts ?? []) {
        const q = nearest(fr.at, 60);
        if (q.i < 0 || urban(q.i) || g.onBridge(q.i)) continue;
        const toRoad = { x: P[q.i].x - fr.at.x, y: P[q.i].y - fr.at.y }, dl = Math.hypot(toRoad.x, toRoad.y);
        if (toRoad.x * fr.n.x + toRoad.y * fr.n.y < dl * 0.6 || Math.abs(q.lat) - g.halfAt(q.i) > 40) continue;
        const side = q.lat < 0 ? -1 : 1;
        const lat = side * (g.halfAt(q.i) + Math.max(0.8, Math.min(1.6, g.vergeReach(q.i, side) - 0.2)));
        const sM = cl.s[q.i] + (hash2(fr.at.x, fr.at.y) - 0.5) * 6;
        const i = idxAt(sM), p = at(i, lat);
        if (onStub(p, 1.5)) continue;
        const y = H(p), t = cl.tangents[i];
        box(mesh('RS_MAILPOSTS', p, woodM), [p.x, y, p.y], [t.x, 0, t.y], 0.1, 0.1, 1.0);
        box(mesh('RS_MAILBOXES', p, mailM), [p.x, y + 1.0, p.y], [-side * t.y, 0, side * t.x], 0.24, 0.48, 0.26);
        stats.mailboxes++;
    }

    // ------------------------------------------------ kerb ramps
    for (const sC of opts.crossS ?? []) {
        const i = idxAt(sC);
        if (!urban(i)) continue;
        for (const side of [-1, 1]) {
            const h = g.halfAt(i), m = mesh('PAINT_TACTILE', P[i], tactileM, { castShadows: false });
            const corner = (ds: number, dl: number): V3 => { const j = idxAt(sC + ds), r = right(j), lat = side * (h + dl); return [P[j].x + r.x * lat, g.surfaceAt(j, lat) + 0.012, P[j].y + r.y * lat]; };
            m.face([corner(-0.75, 0.05), corner(0.75, 0.05), corner(0.75, 0.7), corner(-0.75, 0.7)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
            stats.ramps++;
        }
    }

    const parts = [...meshes.values()].flatMap((m) => m.parts).filter((p) => p.indices.length);
    for (const p of parts) {
        if (p.name.startsWith('RS_LOTCARS') || p.name.startsWith('RS_MAIL') || p.name.startsWith('RS_HYDRANTS') || p.name.startsWith('RS_INSUL')) p.lodOut = 600;
        else if (p.name.startsWith('RS_WIRES')) p.lodOut = 900;
    }
    return { parts, stats, lights };
}

function norm2(p: P2): P2 { const l = Math.hypot(p.x, p.y) || 1; return { x: p.x / l, y: p.y / l }; }
function inRing(p: P2, r: P2[]) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i], c = r[j];
        if ((a.y > p.y) !== (c.y > p.y) && p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}
