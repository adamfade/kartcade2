// Street furniture and side streets from OpenStreetMap, placed the way US roads are built:
//   - side-street stubs: the first ~45 m of every road meeting the route, so junctions read as junctions
//   - traffic signals: a mast-arm pole on the far-right corner of each approach, one head over each lane, the
//     cross street's name blade on the arm (static: route approaches green, side streets red)
//   - stop and yield signs on the approaches OSM marks, with stop lines
//   - crosswalks where OSM maps marked crossings (continental bars or two transverse lines)
//   - lane-use arrows where OSM has turn:lanes, speed limit signs where the limit changes
//   - street lamps and bus stop signs at their mapped spots
// Everything stays off the asphalt; poles near the road get collision.

import type { Centerline } from './route.ts';
import type { MeshPart, TrackGeometry, V3 } from './mesh.ts';
import type { OsmFeatures, OsmPoint, OsmWay } from './osm.ts';
import type { RoadInfo } from './roadinfo.ts';
import { laneGeometry, laneSet, wayWidth } from './roadinfo.ts';
import type { MaterialBook, MaterialLibrary } from './materials.ts';
import { macroDetailMaterial, solidMacro } from './materials.ts';
import { Mesh, box } from './elements.ts';
import { beam } from './bridge.ts';
import { busStopImage, flatImage, speedLimitImage, stopSignImage, streetNameImage, yieldSignImage } from './textures.ts';
import type { Rgba } from './dds.ts';

type P2 = { x: number; y: number };
type Ground = (x: number, z: number) => number | null;

export interface StreetStats { stubs: number; signals: number; stopSigns: number; crosswalks: number; arrows: number; speedSigns: number; lamps: number; busStops: number }
export interface StreetBuild { parts: MeshPart[]; stats: StreetStats; /** Side-street footprints (for keeping trees and buildings off them). */ stubs: { pts: P2[]; half: number }[] }

interface Branch {
    way: OsmWay;
    /** Local points from the junction outward, resampled every 2 m. */
    pts: P2[];
    /** Distance along `pts` where the stub leaves the route's asphalt. */
    t0: number;
    half: number;
    /** +1 when the branch runs along the way's direction (for direction=forward/backward tags). */
    dir: 1 | -1;
    nodeIds: number[];
    /** Cumulative distance of each original node along the branch. */
    nodeT: number[];
}
interface Junction { id: number; p: P2; i: number; branches: Branch[]; signal: boolean; crossHalf: number; name: string }

const LIFT = 0.013;

function smoothstep(t: number) { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); }
const RANK: Record<string, number> = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1, service: 0, road: 1 };
const rankOf = (t: Record<string, string>) => RANK[(t.highway ?? '').replace(/_link$/, '')] ?? 1;

export function buildStreets(cl: Centerline, g: TrackGeometry, road: RoadInfo, osm: OsmFeatures, ground: Ground, book: MaterialBook, lib: MaterialLibrary | undefined): StreetBuild {
    const proj = cl.projection, P = cl.points, n = P.length;
    const L = (p: { lat: number; lon: number }): P2 => proj.toLocal(p);
    const stats: StreetStats = { stubs: 0, signals: 0, stopSigns: 0, crosswalks: 0, arrows: 0, speedSigns: 0, lamps: 0, busStops: 0 };

    // ---------------------------------------------------------------- centreline lookups
    const GC = 20, grid = new Map<string, number[]>();
    P.forEach((p, i) => { const k = `${Math.floor(p.x / GC)},${Math.floor(p.y / GC)}`; let b = grid.get(k); if (!b) grid.set(k, (b = [])); b.push(i); });
    const nearest = (p: P2, reach = 60): { i: number; d: number; lat: number } => {
        const cx = Math.floor(p.x / GC), cy = Math.floor(p.y / GC), r = Math.ceil(reach / GC);
        let best = -1, bd = Infinity;
        for (let a = cx - r; a <= cx + r; a++) for (let b = cy - r; b <= cy + r; b++) for (const i of grid.get(`${a},${b}`) ?? []) {
            const d = Math.hypot(p.x - P[i].x, p.y - P[i].y); if (d < bd) { bd = d; best = i; }
        }
        if (best < 0) return { i: -1, d: Infinity, lat: 0 };
        const t = cl.tangents[best];
        const lat = (p.x - P[best].x) * t.y - (p.y - P[best].y) * t.x;
        return { i: best, d: bd, lat };
    };
    const right = (i: number) => ({ x: cl.tangents[i].y, y: -cl.tangents[i].x });
    const idxAt = (sM: number) => { const x = Math.max(0, Math.min(cl.length, sM)); let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cl.s[mid] <= x) lo = mid; else hi = mid - 1; } return lo; };
    /** A point on the route at distance sM and lateral offset lat, on whatever surface is there (+ up). */
    const routePt = (sM: number, lat: number, up = 0, paint = false): V3 => {
        const i = idxAt(sM), j = Math.min(n - 1, i + 1);
        const t = cl.s[j] > cl.s[i] ? (Math.max(0, Math.min(cl.length, sM)) - cl.s[i]) / (cl.s[j] - cl.s[i]) : 0;
        const at = (k: number): V3 => { const r = right(k); const y = Math.abs(lat) <= g.halfAt(k) || paint ? g.roadHeightAt(k, lat) : g.surfaceAt(k, lat); return [P[k].x + r.x * lat, y + up, P[k].y + r.y * lat]; };
        const a = at(i), b = at(j);
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    };
    const fwdAt = (sM: number): V3 => { const t = cl.tangents[idxAt(sM)]; return [t.x, 0, t.y]; };

    // ---------------------------------------------------------------- materials and meshes
    const flat = (name: string, rgb: [number, number, number], emissive?: [number, number, number], spec = 0.1) => {
        if (book.has(name)) return name;
        const tex = book.image(`${name}.dds`, () => flatImage(rgb));
        return book.add({
            name, shader: 'ksPerPixel',
            properties: [{ name: 'ksAmbient', a: 0.45 }, { name: 'ksDiffuse', a: 0.55 }, { name: 'ksSpecular', a: spec }, { name: 'ksSpecularEXP', a: 40 }, { name: 'ksEmissive', c: emissive ?? [0, 0, 0] }, { name: 'ksAlphaRef', a: 0 }],
            textures: [{ sampler: 'txDiffuse', slot: 0, texture: tex }],
        });
    };
    const signMat = (name: string, make: () => Rgba, cutout: boolean) => {
        if (book.has(name)) return name;
        const tex = book.image(`${name}.dds`, make, { format: cutout ? 'bc3' : 'bc1', mips: cutout ? 'cutout' : 'color' });
        return book.add({
            name, shader: cutout ? 'ksPerPixelAT' : 'ksPerPixel', alphaTested: cutout,
            properties: [{ name: 'ksAmbient', a: 0.5 }, { name: 'ksDiffuse', a: 0.5 }, { name: 'ksSpecular', a: 0.15 }, { name: 'ksSpecularEXP', a: 30 }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: cutout ? 0.5 : 0 }],
            textures: [{ sampler: 'txDiffuse', slot: 0, texture: tex }],
        });
    };
    const steelM = macroDetailMaterial(book, lib, { name: 'st_steel', role: 'metal_roof', specular: 0.35, reflection: 0.15, macro: { key: 'st_steel_macro', image: () => solidMacro([150, 154, 156], 64, 0.06, 61), sizeM: 4 } });
    const housingM = flat('st_housing', [34, 36, 30]);
    const lensOff = flat('st_lens_off', [22, 22, 24], undefined, 0.6);
    const lensRed = flat('st_lens_red', [200, 20, 16], [24, 2, 1], 0.6);
    const lensGreen = flat('st_lens_green', [20, 190, 120], [2, 22, 12], 0.6);
    const lampHeadM = flat('st_lamp_head', [96, 98, 100], undefined, 0.3);
    const lampLensM = flat('st_lamp_lens', [255, 222, 170], [10, 8, 5], 0.4);
    const backM = flat('st_sign_back', [128, 132, 136], undefined, 0.2);
    const sideRoadM = 'road';
    const meshes = new Map<string, Mesh>();
    const mesh = (name: string, material: string, flags: { visible?: boolean; castShadows?: boolean } = {}) => {
        const key = `${name}|${material}`;
        let m = meshes.get(key);
        if (!m) meshes.set(key, (m = new Mesh(name, material, flags)));
        return m;
    };
    const poles = () => mesh('ST_POLES', steelM);
    const hits = () => mesh('1WALL_POLES', steelM, { visible: false, castShadows: false });
    const paint = () => mesh('PAINT_WHITE_X', 'paint_white', { castShadows: false });
    const paintY = () => mesh('PAINT_YELLOW_X', 'paint_yellow', { castShadows: false });

    // ---------------------------------------------------------------- route ways and junction branches
    const routeWays = new Set<number>();
    for (let i = 0; i < n; i++) if (road.wayAt[i] >= 0) routeWays.add(road.ways[road.wayAt[i]].id);
    const roads = osm.roads ?? [];
    const branches: { b: Branch; node: number; p: P2; i: number }[] = [];
    for (const way of roads) {
        const pts = way.line.map(L);
        const near = pts.map((p) => nearest(p));
        const on = near.map((q) => q.i >= 0 && q.d < Math.max(3.5, g.halfAt(q.i) * 0.6));
        for (let j = 0; j < pts.length; j++) {
            if (!on[j]) continue;
            for (const dir of [-1, 1] as const) {
                const k = j + dir;
                if (k < 0 || k >= pts.length || on[k]) continue;
                // Walk outward along the way.
                const raw: P2[] = [pts[j]], ids = [way.nodes[j]];
                for (let m = k; m >= 0 && m < pts.length && !on[m]; m += dir) { raw.push(pts[m]); ids.push(way.nodes[m]); }
                const service = way.tags.highway === 'service';
                const maxL = service ? (way.tags.service === 'driveway' ? 8 : 18) : 45;
                // Resample every 2 m up to maxL; remember where each node lands.
                const nodeT: number[] = [0];
                for (let q = 1; q < raw.length; q++) nodeT.push(nodeT[q - 1] + Math.hypot(raw[q].x - raw[q - 1].x, raw[q].y - raw[q - 1].y));
                const total = Math.min(maxL, nodeT[nodeT.length - 1]);
                const out: P2[] = [];
                for (let t = 0, q = 0; t <= total + 1e-6; t += 2) {
                    while (q < raw.length - 2 && nodeT[q + 1] < t) q++;
                    const seg = nodeT[q + 1] - nodeT[q] || 1, u = Math.max(0, Math.min(1, (t - nodeT[q]) / seg));
                    out.push({ x: raw[q].x + (raw[q + 1].x - raw[q].x) * u, y: raw[q].y + (raw[q + 1].y - raw[q].y) * u });
                }
                if (out.length < 3) continue;
                const end = nearest(out[out.length - 1], 80);
                const jn = near[j];
                if (end.i >= 0 && end.d < g.halfAt(jn.i) + 3) continue; // runs alongside the route (slip lane, dual carriageway)
                const ls = laneSet(way.tags, dir === 1 ? 1 : -1);
                const half = Math.min(9, wayWidth(way.tags, ls) / 2) * (service ? 0.8 : 1);
                // Where the stub leaves the route asphalt.
                let t0 = 0;
                for (let q = 0; q < out.length; q++) { const nq = nearest(out[q]); if (nq.i < 0 || Math.abs(nq.lat) >= g.halfAt(nq.i) - 0.4 || nq.d > g.halfAt(nq.i) + 1) { t0 = q * 2; break; } }
                branches.push({ b: { way, pts: out, t0, half, dir: dir === 1 ? 1 : -1, nodeIds: ids, nodeT }, node: way.nodes[j], p: pts[j], i: jn.i });
            }
        }
    }
    // Junctions: branches grouped by node (and nodes within 12 m, e.g. split carriageways).
    const junctions: Junction[] = [];
    for (const br of branches) {
        let J = junctions.find((q) => q.id === br.node || Math.hypot(q.p.x - br.p.x, q.p.y - br.p.y) < 12);
        if (!J) junctions.push((J = { id: br.node, p: br.p, i: br.i, branches: [], signal: false, crossHalf: 0, name: '' }));
        J.branches.push(br.b);
        J.crossHalf = Math.max(J.crossHalf, br.b.half);
        if (!J.name && br.b.way.tags.name && !routeWays.has(br.b.way.id)) J.name = br.b.way.tags.name;
    }
    const points = osm.points ?? [];
    const signals = points.filter((p) => p.tags.highway === 'traffic_signals').map((p) => ({ p: L(p.at), tags: p.tags }));
    for (const J of junctions) J.signal = signals.some((q) => Math.hypot(q.p.x - J.p.x, q.p.y - J.p.y) < 28);

    // ---------------------------------------------------------------- side-street stubs
    const stubFootprints: { pts: P2[]; half: number }[] = [];
    const stubSurface = new Map<Branch, (t: number, v: number) => V3>();
    for (const J of junctions) for (const b of J.branches) {
        const rows: V3[][] = [];
        const k0 = Math.max(0, Math.floor(b.t0 / 2) - 1);
        const tan = (k: number): P2 => { const a = b.pts[Math.max(0, k - 1)], c = b.pts[Math.min(b.pts.length - 1, k + 1)]; const l = Math.hypot(c.x - a.x, c.y - a.y) || 1; return { x: (c.x - a.x) / l, y: (c.y - a.y) / l }; };
        const jy = g.roadHeightAt(J.i, Math.max(-g.halfAt(J.i), Math.min(g.halfAt(J.i), nearest(b.pts[k0]).lat)));
        const heightAt = (p: P2, t: number) => {
            const q = nearest(p);
            let gy = ground(p.x, p.y) ?? jy;
            if (q.i >= 0 && Math.abs(q.lat) <= g.halfAt(q.i) + g.vergeReach(q.i, q.lat < 0 ? -1 : 1)) gy = Math.max(gy, g.surfaceAt(q.i, q.lat));
            if (q.i >= 0 && Math.abs(q.lat) < g.halfAt(q.i)) gy = g.roadHeightAt(q.i, q.lat) - 0.02; // under the route's asphalt
            const w = smoothstep((t - b.t0) / 10);
            return (jy - 0.02) * (1 - w) + (gy + 0.03) * w;
        };
        for (let k = k0; k < b.pts.length; k++) {
            const c = b.pts[k], t = tan(k), r = { x: t.y, y: -t.x }, tm = k * 2;
            rows.push([-1, -0.5, 0, 0.5, 1].map((f) => { const p = { x: c.x + r.x * f * b.half, y: c.y + r.y * f * b.half }; return [p.x, heightAt(p, tm) - 0.02 * Math.abs(f) * b.half * 0.5, p.y] as V3; }));
        }
        if (rows.length < 2) continue;
        const m = mesh('1ROAD_SIDE', sideRoadM);
        for (let k = 0; k < rows.length - 1; k++) for (let c = 0; c < 4; c++) {
            const q = [rows[k][c], rows[k][c + 1], rows[k + 1][c + 1], rows[k + 1][c]];
            // Road-aligned UVs (across, along) like the route, so the asphalt's wear runs along the street.
            const uv = (row: number, col: number): [number, number] => [0.5 + ((col - 2) / 2) * b.half / 48, ((k0 + row) * 2) / 48];
            m.face(q, [0, 1, 0], [uv(k, c), uv(k, c + 1), uv(k + 1, c + 1), uv(k + 1, c)]);
        }
        stubFootprints.push({ pts: b.pts.slice(k0), half: b.half });
        stubSurface.set(b, (tm: number, v: number) => {
            const k = Math.max(0, Math.min(rows.length - 1, Math.round(tm / 2) - k0));
            const row = rows[k], f = Math.max(-1, Math.min(1, v / b.half));
            const pos = (f + 1) * 2, c = Math.min(3, Math.floor(pos)), u = pos - c;
            const A = row[c], B = row[c + 1];
            return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u];
        });
        stats.stubs++;
    }
    /** Point on a stub at distance t from the junction and lateral v (right of the outward direction). */
    const stubPt = (b: Branch, t: number, v: number, up = 0): V3 => { const p = stubSurface.get(b)!(t, v); return [p[0], p[1] + up, p[2]]; };
    const stubDir = (b: Branch, t: number): P2 => { const k = Math.max(1, Math.min(b.pts.length - 1, Math.round(t / 2))); const a = b.pts[k - 1], c = b.pts[k]; const l = Math.hypot(c.x - a.x, c.y - a.y) || 1; return { x: (c.x - a.x) / l, y: (c.y - a.y) / l }; };
    const onStub = (p: P2, margin = 0.6) => stubFootprints.some((f) => f.pts.some((q, k) => k % 2 === 0 && Math.hypot(q.x - p.x, q.y - p.y) < f.half + margin + 1));

    // ---------------------------------------------------------------- paint helpers
    const quad = (m: Mesh, c: V3[]) => m.face(c, [0, 1, 0], c.map((v) => [v[0] / 4, v[2] / 4] as [number, number]));
    /** A paint rectangle on the route: s from a to b, lateral from l0 to l1 (split along s so it follows the surface). */
    const routeRect = (m: Mesh, a: number, b: number, l0: number, l1: number) => {
        const steps = Math.max(1, Math.ceil((b - a) / 1.5));
        for (let k = 0; k < steps; k++) {
            const s0 = a + ((b - a) * k) / steps, s1 = a + ((b - a) * (k + 1)) / steps;
            quad(m, [routePt(s0, l0, LIFT, true), routePt(s0, l1, LIFT, true), routePt(s1, l1, LIFT, true), routePt(s1, l0, LIFT, true)]);
        }
    };
    const stubRect = (m: Mesh, b: Branch, t0: number, t1: number, v0: number, v1: number) => quad(m, [stubPt(b, t0, v0, LIFT), stubPt(b, t0, v1, LIFT), stubPt(b, t1, v1, LIFT), stubPt(b, t1, v0, LIFT)]);

    // ---------------------------------------------------------------- crosswalks
    const crossingPts = points.filter((p) => p.tags.highway === 'crossing' || p.tags.crossing);
    const style = (t: Record<string, string>): 'bars' | 'lines' | null => {
        const mk = t['crossing:markings'] ?? '';
        if (t.crossing === 'unmarked' || t.crossing === 'no' || mk === 'no') return null;
        if (/zebra|ladder|dashes/.test(mk) || t.crossing_ref === 'zebra' || t.crossing === 'zebra') return 'bars';
        if (/lines|yes/.test(mk) || t.crossing === 'traffic_signals') return 'lines';
        return t.crossing === 'marked' || t.crossing === 'uncontrolled' ? 'bars' : null;
    };
    const crosswalkAcrossRoute = (sC: number, kind: 'bars' | 'lines') => {
        const i = idxAt(sC), h = g.halfAt(i);
        if (kind === 'lines') { routeRect(paint(), sC - 1.65, sC - 1.35, -h + 0.2, h - 0.2); routeRect(paint(), sC + 1.35, sC + 1.65, -h + 0.2, h - 0.2); }
        else for (let v = -h + 0.4; v + 0.6 <= h - 0.2; v += 1.2) routeRect(paint(), sC - 1.5, sC + 1.5, v, v + 0.6);
        stats.crosswalks++;
    };
    const routeCrossS: number[] = [];
    for (const c of crossingPts) {
        const kind = style(c.tags);
        if (!kind) continue;
        const p = L(c.at), q = nearest(p);
        if (q.i >= 0 && q.d < 2.5) { crosswalkAcrossRoute(cl.s[q.i], kind); routeCrossS.push(cl.s[q.i]); continue; }
        // On a side street?
        for (const J of junctions) for (const b of J.branches) {
            if (!b.nodeIds.includes(c.id) || !stubSurface.has(b)) continue;
            const t = b.nodeT[b.nodeIds.indexOf(c.id)];
            if (t < b.t0 + 1 || t > (b.pts.length - 2) * 2) continue;
            if (kind === 'lines') { stubRect(paint(), b, t - 1.65, t - 1.35, -b.half + 0.2, b.half - 0.2); stubRect(paint(), b, t + 1.35, t + 1.65, -b.half + 0.2, b.half - 0.2); }
            else for (let v = -b.half + 0.4; v + 0.6 <= b.half - 0.2; v += 1.2) stubRect(paint(), b, t - 1.5, t + 1.5, v, v + 0.6);
            stats.crosswalks++;
        }
    }

    // ---------------------------------------------------------------- signs
    /** A flat sign face on a post: centre point, facing direction (normal), size; post from ground to the sign. */
    const signOnPost = (base: V3, facing: V3, w: number, h: number, height: number, mat: string, post = true) => {
        const f = facing, r: V3 = [-f[2], 0, f[0]]; // right as seen by the driver facing the sign
        const cy = base[1] + height;
        const c = (u: number, v: number): V3 => [base[0] + r[0] * (u - 0.5) * w + f[0] * 0.04, cy + (v - 0.5) * h, base[2] + r[2] * (u - 0.5) * w + f[2] * 0.04];
        mesh(`ST_SIGN_${mat.toUpperCase()}`, mat).face([c(0, 0), c(1, 0), c(1, 1), c(0, 1)], f, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        const bc = (u: number, v: number): V3 => [base[0] + r[0] * (u - 0.5) * w, cy + (v - 0.5) * h, base[2] + r[2] * (u - 0.5) * w];
        mesh('ST_SIGN_BACKS', backM).face([bc(0, 0), bc(1, 0), bc(1, 1), bc(0, 1)], [-f[0], 0, -f[2]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        if (post) { box(poles(), [base[0] - f[0] * 0.05, base[1], base[2] - f[2] * 0.05], [f[0], 0, f[2]], 0.07, 0.07, height + h / 2); box(hits(), base, [f[0], 0, f[2]], 0.2, 0.2, 2.5); }
    };
    const stopM = signMat('st_sign_stop', stopSignImage, true);
    const yieldM = signMat('st_sign_yield', yieldSignImage, true);
    /** A sign beside the route at sM, side -1/+1, facing traffic that travels `towards` (+1 = route direction). */
    const routeSign = (sM: number, side: -1 | 1, towards: 1 | -1, w: number, h: number, height: number, mat: string) => {
        let s = sM;
        for (let tries = 0; tries < 6; tries++) {
            const i = idxAt(s), lat = side * (g.halfAt(i) + Math.min(1.4, Math.max(0.6, g.vergeReach(i, side) - 0.4)));
            const r = right(i), p = { x: P[i].x + r.x * lat, y: P[i].y + r.y * lat };
            if (!onStub(p)) {
                const f = fwdAt(s), facing: V3 = [-f[0] * towards, 0, -f[2] * towards];
                signOnPost(routePt(s, lat), facing, w, h, height, mat);
                return true;
            }
            s += towards * 4;
        }
        return false;
    };
    const rankRoute = (i: number) => (road.wayAt[i] >= 0 ? rankOf(road.ways[road.wayAt[i]].tags) : 3);

    // Stop / give way.
    for (const J of junctions) {
        if (J.signal) continue;
        const ids = new Set(J.branches.flatMap((b) => b.nodeIds));
        ids.add(J.id);
        const ctl = points.filter((p) => (p.tags.highway === 'stop' || p.tags.highway === 'give_way') && (ids.has(p.id) || Math.hypot(L(p.at).x - J.p.x, L(p.at).y - J.p.y) < 20));
        if (!ctl.length) continue;
        const allWay = ctl.some((p) => p.tags.stop === 'all');
        for (const b of J.branches) {
            if (!stubSurface.has(b)) continue;
            const own = ctl.find((p) => b.nodeIds.includes(p.id) && p.id !== J.id) ?? (allWay || rankOf(b.way.tags) < rankRoute(J.i) ? ctl[0] : undefined);
            if (!own) continue;
            const isYield = own.tags.highway === 'give_way';
            const tSign = Math.max(b.t0 + 2.5, Math.min((b.pts.length - 2) * 2, b.nodeIds.includes(own.id) ? b.nodeT[b.nodeIds.indexOf(own.id)] : b.t0 + 2.5));
            // Traffic on the stub heads towards the junction (-d); its right side is our left of d.
            const d = stubDir(b, tSign), out: V3 = [d.x, 0, d.y];
            const rightOfApproach = -1; // lateral v is measured to the right of the outward direction
            const base = stubPt(b, tSign, rightOfApproach * (b.half + 0.8));
            const gy = ground(base[0], base[2]);
            if (gy != null) base[1] = Math.max(gy, base[1] - 0.05);
            signOnPost(base, out, 0.76, 0.76, 2.2, isYield ? yieldM : stopM);
            if (!isYield) stubRect(paint(), b, tSign - 1.6, tSign - 1.15, -b.half + 0.3, -0.1);
            stats.stopSigns++;
        }
        if (allWay) for (const towards of [1, -1] as const) {
            const sJ = cl.s[J.i], sS = sJ - towards * (J.crossHalf + 4);
            if (routeSign(sS, towards === 1 ? 1 : -1, towards, 0.76, 0.76, 2.2, stopM)) {
                const i = idxAt(sS), geo = laneGeometry(g.halfAt(i), road.lanes[i], false);
                if (towards === 1) routeRect(paint(), sS + 0.6, sS + 1.05, geo.c1, geo.R0); else routeRect(paint(), sS - 1.05, sS - 0.6, geo.L0, geo.c0);
                stats.stopSigns++;
            }
        }
    }

    // ---------------------------------------------------------------- traffic signals
    /** Mast-arm signal: pole at `base`, arm along `armDir` reaching heads at the given arm offsets; heads face `facing`. */
    const mastArm = (base: V3, armDir: V3, offsets: number[], facing: V3, lit: 'green' | 'red', name: string) => {
        const top = base[1] + 6.4, reach = Math.max(2.5, ...offsets.map((o) => o + 0.6));
        beam(poles(), [base[0], base[1] - 0.3, base[2]], [base[0], top + 0.6, base[2]], 0.32, 0.32);
        box(hits(), base, facing, 0.5, 0.5, 3);
        const armEnd: V3 = [base[0] + armDir[0] * reach, top + 0.25, base[2] + armDir[2] * reach];
        beam(poles(), [base[0], top, base[2]], armEnd, 0.18, 0.2);
        for (const o of offsets) {
            const c: V3 = [base[0] + armDir[0] * o, top - 0.15, base[2] + armDir[2] * o];
            const f = facing, r: V3 = [-f[2], 0, f[0]];
            // Housing (box hanging below the arm), back plate, and three lenses (lit one emissive).
            box(mesh('ST_SIGNAL_HOUSING', housingM), [c[0], c[1] - 1.15, c[2]], f, 0.38, 0.3, 1.1);
            const plate = (u: number, v: number): V3 => [c[0] + r[0] * u - f[0] * 0.17, c[1] - 0.6 + v, c[2] + r[2] * u - f[2] * 0.17];
            mesh('ST_SIGNAL_HOUSING', housingM).double([plate(-0.32, -0.6), plate(0.32, -0.6), plate(0.32, 0.62), plate(-0.32, 0.62)], f, [[0, 0], [1, 0], [1, 1], [0, 1]]);
            [['red', 0.36], ['amber', 0], ['green', -0.36]].forEach(([col, dy]) => {
                const mat = col === lit ? (lit === 'green' ? lensGreen : lensRed) : lensOff;
                const lc = (u: number, v: number): V3 => [c[0] + r[0] * u + f[0] * 0.16, c[1] - 0.6 + (dy as number) + v, c[2] + r[2] * u + f[2] * 0.16];
                mesh(`ST_SIGNAL_${mat.toUpperCase()}`, mat).face([lc(-0.13, -0.13), lc(0.13, -0.13), lc(0.13, 0.13), lc(-0.13, 0.13)], f, [[0, 0], [1, 0], [1, 1], [0, 1]]);
            });
        }
        if (name) {
            const nm = signMat(`st_name_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 24)}`, () => streetNameImage(name), false);
            const at = Math.min(reach - 0.5, 2.6);
            const c: V3 = [base[0] + armDir[0] * at, top + 0.75, base[2] + armDir[2] * at];
            signOnPost([c[0], c[1] - 0.75, c[2]], facing, 2.0, 0.5, 0.85, nm, false);
        }
        stats.signals++;
    };
    for (const J of junctions) {
        if (!J.signal) continue;
        const sJ = cl.s[J.i];
        for (const towards of [1, -1] as const) {
            // Far-side pole on the right of approaching traffic, past the cross street.
            const sP = sJ + towards * (J.crossHalf + 3);
            if (sP < 2 || sP > cl.length - 2) continue;
            const i = idxAt(sP), h = g.halfAt(i), ls = road.lanes[i];
            const geo = laneGeometry(h, ls, false);
            const side = towards === 1 ? 1 : -1;
            const lat = side * (h + 1.6);
            const base = routePt(sP, lat);
            const r = right(i), armDir: V3 = [-r.x * side, 0, -r.y * side];
            const lanes = towards === 1 ? Array.from({ length: Math.max(1, ls.fwd) }, (_, k) => geo.fwdLane(k)) : Array.from({ length: Math.max(1, ls.bwd) }, (_, k) => geo.bwdLane(k));
            if (towards === -1 && geo.oneway) continue; // nobody comes the other way
            const offsets = lanes.map((l) => Math.abs(lat - l));
            const f = fwdAt(sP);
            mastArm(base, armDir, offsets, [-f[0] * towards, 0, -f[2] * towards], 'green', J.name);
            // Stop line before the cross street (and before any crosswalk there).
            const sStop = sJ - towards * (J.crossHalf + (routeCrossS.some((x) => Math.abs(x - (sJ - towards * (J.crossHalf + 1.5))) < 4) ? 4.2 : 1.8));
            if (towards === 1) routeRect(paint(), sStop - 0.45, sStop, geo.c1, geo.R0); else routeRect(paint(), sStop, sStop + 0.45, geo.L0, geo.c0);
        }
        for (const b of J.branches) {
            if (!stubSurface.has(b) || b.pts.length * 2 < b.t0 + 8) continue;
            const t = b.t0 + 2;
            const d = stubDir(b, t);
            // Near-right corner for traffic approaching on the stub (their right = our -v), arm across their lanes.
            const base = stubPt(b, t, -(b.half + 1.4));
            const gy = ground(base[0], base[2]); if (gy != null) base[1] = gy;
            // +v (right of the outward direction) points from the pole across the approach lanes.
            const armDir: V3 = [d.y, 0, -d.x];
            const lanesOn = Math.max(1, Math.round(b.half / 3.3));
            const offsets = Array.from({ length: lanesOn }, (_, k) => 1.4 + (k + 0.5) * (b.half / lanesOn));
            mastArm(base, armDir, offsets, [d.x, 0, d.y], 'red', '');
            stubRect(paint(), b, t + 1.2, t + 1.65, -b.half + 0.3, -0.1);
        }
    }

    // ---------------------------------------------------------------- lane-use arrows
    const arrow = (m: Mesh, at: (u: number, v: number) => V3, kinds: string) => {
        const k = kinds.split(';');
        const tri = (a: [number, number], b: [number, number], c: [number, number]) => m.face([at(...a), at(...b), at(...c)], [0, 1, 0], [[0, 0], [1, 0], [0, 1]]);
        const rect = (u0: number, u1: number, v0: number, v1: number) => m.face([at(u0, v0), at(u0, v1), at(u1, v1), at(u1, v0)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        const through = k.includes('through');
        rect(0, through ? 3.3 : 2.4, -0.15, 0.15);
        if (through) tri([3.3, -0.45], [3.3, 0.45], [4.6, 0]);
        for (const side of [['left', -1], ['right', 1]] as const) {
            if (!k.some((x) => x === side[0] || x === `slight_${side[0]}`)) continue;
            const sg = side[1], u0 = through ? 1.6 : 2.4;
            // Diagonal arm and a head pointing out to the side.
            const e: [number, number] = [u0 + 0.9, sg * 0.75];
            m.face([at(u0 - 0.15, -0.15 * sg), at(u0 + 0.15, 0.15 * sg), at(e[0] + 0.12, e[1] + 0.12 * sg), at(e[0] - 0.12, e[1] - 0.12 * sg)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
            const dU = 0.55, dV = 0.83 * sg, tip: [number, number] = [e[0] + dU * 0.9, e[1] + dV * 0.9];
            tri([e[0] - 0.83 * 0.5, e[1] + 0.55 * 0.5 * sg], [e[0] + 0.83 * 0.5, e[1] - 0.55 * 0.5 * sg], tip);
        }
    };
    for (let i = 0; i < n;) {
        const w = road.wayAt[i];
        let j = i; while (j + 1 < n && road.wayAt[j + 1] === w) j++;
        const a = cl.s[i], b = cl.s[j];
        if (w >= 0 && b - a > 24) {
            const ls = road.lanes[i];
            const geo = (s: number) => laneGeometry(g.halfAt(idxAt(s)), road.lanes[idxAt(s)], false);
            const go = (turns: string[] | null, towards: 1 | -1) => {
                if (!turns || turns.every((t) => t === 'none' || t === '')) return;
                const sA = towards === 1 ? b - 14 : a + 14;
                turns.forEach((t, k) => {
                    if (t === 'none' || t === '' || t === 'reverse') return;
                    const lat = towards === 1 ? geo(sA).fwdLane(k) : geo(sA).bwdLane(k);
                    arrow(paint(), (u, v) => routePt(sA - towards * 4.6 + towards * u, lat + towards * v, LIFT, true), t);
                    stats.arrows++;
                });
            };
            if (!ls.oneway || road.dirAt[i] === 1) go(ls.turnFwd, 1);
            go(ls.turnBwd, -1);
        }
        i = j + 1;
    }

    // ---------------------------------------------------------------- speed limit signs
    const mphAt = (i: number) => { for (let k = i; k >= 0; k--) if (Number.isFinite(road.mph[k])) return road.mph[k]; for (let k = i; k < n; k++) if (Number.isFinite(road.mph[k])) return road.mph[k]; return NaN; };
    const changes: { s: number; before: number; after: number }[] = [];
    let prev = mphAt(0);
    if (Number.isFinite(prev)) changes.push({ s: 0, before: NaN, after: prev });
    for (let i = 1; i < n; i++) { const v = road.mph[i]; if (Number.isFinite(v) && v !== prev) { changes.push({ s: cl.s[i], before: prev, after: v }); prev = v; } }
    if (Number.isFinite(prev)) changes.push({ s: cl.length, before: prev, after: NaN });
    const nearJunction = (s: number) => junctions.some((J) => Math.abs(cl.s[J.i] - s) < J.crossHalf + 6);
    let lastF = -Infinity, lastB = Infinity;
    for (const c of changes) {
        if (Number.isFinite(c.after) && c.s < cl.length - 30) {
            let s = c.s + (c.s === 0 ? 40 : 15); while (nearJunction(s) && s < c.s + 60) s += 5;
            if (s - lastF > 80 && routeSign(s, 1, 1, 0.6, 0.75, 2.1, signMat(`st_speed_${c.after}`, () => speedLimitImage(c.after), false))) { lastF = s; stats.speedSigns++; }
        }
        if (Number.isFinite(c.before) && c.s > 30) {
            let s = c.s - (c.s >= cl.length ? 40 : 15); while (nearJunction(s) && s > c.s - 60) s -= 5;
            if (lastB - s > 80 && routeSign(s, -1, -1, 0.6, 0.75, 2.1, signMat(`st_speed_${c.before}`, () => speedLimitImage(c.before), false))) { lastB = s; stats.speedSigns++; }
        }
    }

    // ---------------------------------------------------------------- street lamps and bus stops
    /** Push a mapped roadside point off the asphalt (OSM nodes often sit on the road line). */
    const offRoad = (pt: OsmPoint, clearance: number): { p: P2; i: number; lat: number } | null => {
        const p = L(pt.at), q = nearest(p);
        if (q.i < 0 || q.d > 45) return null;
        const h = g.halfAt(q.i);
        let lat = q.lat;
        if (Math.abs(lat) < h + clearance) lat = (lat < 0 ? -1 : 1) * (h + clearance);
        const r = right(q.i);
        const pp = Math.abs(q.lat) < h + clearance ? { x: P[q.i].x + r.x * lat, y: P[q.i].y + r.y * lat } : p;
        if (onStub(pp, 0.3)) return null;
        return { p: pp, i: q.i, lat };
    };
    const yOf = (p: P2, i: number, lat: number) => (Math.abs(lat) <= g.halfAt(i) + g.vergeReach(i, lat < 0 ? -1 : 1) ? g.surfaceAt(i, lat) : ground(p.x, p.y) ?? g.surfaceAt(i, lat));
    for (const lp of points.filter((p) => p.tags.highway === 'street_lamp')) {
        const o = offRoad(lp, 1.2);
        if (!o) continue;
        const y = yOf(o.p, o.i, o.lat), base: V3 = [o.p.x, y, o.p.y];
        const r = right(o.i), toRoad: V3 = [-r.x * Math.sign(o.lat || 1), 0, -r.y * Math.sign(o.lat || 1)];
        beam(poles(), [base[0], y - 0.3, base[2]], [base[0], y + 9, base[2]], 0.2, 0.2);
        const tip: V3 = [base[0] + toRoad[0] * 2.2, y + 9.25, base[2] + toRoad[2] * 2.2];
        beam(poles(), [base[0], y + 8.8, base[2]], tip, 0.1, 0.12);
        box(mesh('ST_LAMP_HEAD', lampHeadM), [tip[0], tip[1] - 0.2, tip[2]], toRoad, 0.35, 0.75, 0.2);
        const lc = (u: number, v: number): V3 => [tip[0] + toRoad[0] * u - toRoad[2] * v, tip[1] - 0.205, tip[2] + toRoad[2] * u + toRoad[0] * v];
        mesh('ST_LAMP_LENS', lampLensM).face([lc(-0.3, -0.12), lc(0.3, -0.12), lc(0.3, 0.12), lc(-0.3, 0.12)], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        if (Math.abs(o.lat) - g.halfAt(o.i) < 8) box(hits(), base, toRoad, 0.35, 0.35, 3);
        stats.lamps++;
    }
    const busM = signMat('st_sign_bus', busStopImage, false);
    for (const bp of points.filter((p) => p.tags.highway === 'bus_stop')) {
        const o = offRoad(bp, 1.0);
        if (!o) continue;
        const y = yOf(o.p, o.i, o.lat);
        const f = cl.tangents[o.i];
        // Faces traffic on its own side of the road.
        const towards = o.lat >= 0 ? 1 : -1;
        signOnPost([o.p.x, y, o.p.y], [-f.x * towards, 0, -f.y * towards], 0.4, 0.8, 2.3, busM);
        stats.busStops++;
    }

    const parts = [...meshes.values()].flatMap((m) => m.parts).filter((p) => p.indices.length);
    for (const p of parts) if (p.name.startsWith('PAINT_')) p.castShadows = false;
    void paintY;
    return { parts, stats, stubs: stubFootprints };
}
