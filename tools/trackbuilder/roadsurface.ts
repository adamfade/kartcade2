// What makes asphalt look like a real street rather than a texture: the actual repair patches you can see in the
// aerial photo (hard-edged rectangles of newer or older asphalt), tar crack sealant (transverse cracks and the
// longitudinal joints), manhole covers in the lanes and storm-drain grates at the gutter. All are thin decals a
// few millimetres above the road, so the road's physics surface is untouched.

import type { Centerline } from './route.ts';
import type { MeshPart, TrackGeometry, V3 } from './mesh.ts';
import type { RoadInfo } from './roadinfo.ts';
import type { SiteRasters } from './site.ts';
import { sampleImage } from './site.ts';
import type { MaterialBook, MaterialLibrary } from './materials.ts';
import { entryFor, macroDetailMaterial, solidMacro } from './materials.ts';
import type { Rgba } from './dds.ts';
import { Mesh } from './elements.ts';

type P2 = { x: number; y: number };

export interface RoadSurfaceStats { patches: number; cracks: number; manholes: number; drains: number }

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** A cast-iron manhole cover (256 x 256): concentric rings and radial ribs, alpha 0 outside the circle. */
export function manholeImage(): Rgba {
    const N = 256, data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5, r = Math.hypot(dx, dy) * 2, a = Math.atan2(dy, dx);
        const i = (y * N + x) * 4;
        if (r > 0.98) { data[i] = 46; data[i + 1] = 44; data[i + 2] = 42; data[i + 3] = 0; continue; }
        let v = 70;
        if (r > 0.9) v = 58; // frame
        else if (Math.abs(((r * 9) % 1) - 0.5) < 0.12 || Math.abs(Math.sin(a * 12)) < 0.12) v = 96; // raised ribs
        if (r < 0.16) v = 84;
        const rust = 0.5 + 0.5 * Math.sin(x * 0.13 + y * 0.07) * Math.cos(y * 0.11);
        data[i] = Math.round(v * (1 + rust * 0.18)); data[i + 1] = Math.round(v * (1 + rust * 0.06)); data[i + 2] = Math.round(v * 0.95); data[i + 3] = 255;
    }
    return { width: N, height: N, data };
}

/** A storm-drain grate (128 x 256): bars across a dark slot in a cast frame. */
export function drainImage(): Rgba {
    const W = 128, H = 256, data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, frame = x < 10 || x >= W - 10 || y < 10 || y >= H - 10;
        const bar = y % 22 < 9;
        const v = frame ? 74 : bar ? 88 : 14;
        data[i] = v; data[i + 1] = v - 2; data[i + 2] = v - 4; data[i + 3] = 255;
    }
    return { width: W, height: H, data };
}

export function buildRoadSurface(cl: Centerline, g: TrackGeometry, road: RoadInfo | null, site: SiteRasters | undefined, book: MaterialBook, lib: MaterialLibrary | undefined, opts: { crossS?: number[]; stubs?: { pts: P2[]; half: number }[]; seed?: number } = {}): { parts: MeshPart[]; stats: RoadSurfaceStats } {
    const P = cl.points, n = P.length;
    const stats: RoadSurfaceStats = { patches: 0, cracks: 0, manholes: 0, drains: 0 };
    const right = (i: number) => ({ x: cl.tangents[i].y, y: -cl.tangents[i].x });
    const idxAt = (sM: number) => { const x = Math.max(0, Math.min(cl.length, sM)); let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cl.s[mid] <= x) lo = mid; else hi = mid - 1; } return lo; };
    /** A point on the asphalt at distance sM along and lat across, lifted by `up`. */
    const pt = (sM: number, lat: number, up: number): V3 => {
        const i = idxAt(sM), j = Math.min(n - 1, i + 1);
        const t = cl.s[j] > cl.s[i] ? (Math.max(0, Math.min(cl.length, sM)) - cl.s[i]) / (cl.s[j] - cl.s[i]) : 0;
        const at = (k: number): V3 => { const r = right(k); return [P[k].x + r.x * lat, g.roadHeightAt(k, lat) + up, P[k].y + r.y * lat]; };
        const a = at(i), b = at(j);
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    };
    const urban = (i: number) => !!road && !road.lanes[i]?.edgeLines;
    const stubSegs = (opts.stubs ?? []).flatMap((st) => st.pts.slice(1).map((b, k) => ({ a: st.pts[k], b, h: st.half })));
    const nearStub = (p: P2, pad: number) => stubSegs.some((s) => { const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2)); return Math.hypot(p.x - s.a.x - dx * t, p.y - s.a.y - dy * t) < s.h + pad; });
    const rand = rng(opts.seed ?? 97);

    const asphalt = entryFor(lib, 'asphalt').mean;
    const patchMat = (k: 'dark' | 'light') => macroDetailMaterial(book, lib, {
        name: `road_patch_${k}`, role: 'asphalt', specular: 0.2, specularExp: 30, reflection: 0.12,
        macro: { key: `road_patch_${k}_macro`, image: () => solidMacro(asphalt.map((c) => c * (k === 'dark' ? 0.78 : 1.16)) as [number, number, number], 128, 0.12, k === 'dark' ? 41 : 43), sizeM: 8 },
    });
    const flat = (name: string, rgb: number[], spec: number, exp: number) => {
        if (book.has(name)) return name;
        const tex = book.image(`${name}.dds`, () => ({ width: 8, height: 8, data: new Uint8Array(256).map((_, i) => (i % 4 === 3 ? 255 : rgb[i % 4])) }));
        return book.add({ name, shader: 'ksPerPixel', properties: [{ name: 'ksAmbient', a: 0.4 }, { name: 'ksDiffuse', a: 0.5 }, { name: 'ksSpecular', a: spec }, { name: 'ksSpecularEXP', a: exp }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0 }], textures: [{ sampler: 'txDiffuse', slot: 0, texture: tex }] });
    };
    const decal = (name: string, make: () => Rgba, cutout: boolean) => {
        if (book.has(name)) return name;
        const tex = book.image(`${name}.dds`, make, { format: cutout ? 'bc3' : 'bc1', mips: cutout ? 'cutout' : 'color' });
        return book.add({ name, shader: cutout ? 'ksPerPixelAT' : 'ksPerPixel', alphaTested: cutout, properties: [{ name: 'ksAmbient', a: 0.4 }, { name: 'ksDiffuse', a: 0.55 }, { name: 'ksSpecular', a: 0.35 }, { name: 'ksSpecularEXP', a: 40 }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: cutout ? 0.5 : 0 }], textures: [{ sampler: 'txDiffuse', slot: 0, texture: tex }] });
    };
    const meshes = new Map<string, Mesh>();
    const CH = 200;
    const mesh = (kind: string, p: V3, mat: string) => {
        const k = `${kind}_${Math.floor(p[0] / CH)}_${Math.floor(p[2] / CH)}`.replace(/-/g, 'm');
        let m = meshes.get(`${k}|${mat}`);
        if (!m) meshes.set(`${k}|${mat}`, (m = new Mesh(k, mat, { castShadows: false })));
        return m;
    };
    /** A rectangle on the road between s0..s1 and lat0..lat1, following its surface in 1 m steps. */
    const rect = (kind: string, mat: string, s0: number, s1: number, l0: number, l1: number, up: number, uv: (s: number, l: number) => [number, number]) => {
        const steps = Math.max(1, Math.ceil((s1 - s0) / 1));
        for (let k = 0; k < steps; k++) {
            const a = s0 + ((s1 - s0) * k) / steps, b = s0 + ((s1 - s0) * (k + 1)) / steps;
            const m = mesh(kind, pt(a, l0, up), mat);
            m.face([pt(a, l0, up), pt(a, l1, up), pt(b, l1, up), pt(b, l0, up)], [0, 1, 0], [uv(a, l0), uv(a, l1), uv(b, l1), uv(b, l0)]);
        }
    };

    // ------------------------------------------------ real patches from the aerial photo
    // Sample the photo's brightness on a 0.5 m grid along the road, compare with the street's own median over
    // 40 m, and keep rectangular, lane-sized blobs that are clearly darker or lighter: the repairs you can see
    // from the air. Cars (lidar returns above the road) and painted lines (bright, thin) are left out.
    const cells = (site?.cells ?? []).filter((c) => c.rgb);
    if (cells.length) {
        const DS = 0.5, rows = Math.floor(cl.length / DS);
        const maxHalf = Math.max(...Array.from({ length: n }, (_, i) => g.halfAt(i)));
        const cols = Math.ceil((2 * maxHalf) / DS);
        const lum = new Float32Array(rows * cols).fill(NaN);
        const proj = cl.projection;
        for (let r = 0; r < rows; r++) {
            const sM = (r + 0.5) * DS, i = idxAt(sM), h = g.halfAt(i) - 0.4, rr = right(i);
            if (g.onBridge(i)) continue;
            for (let c = 0; c < cols; c++) {
                const lat = -maxHalf + (c + 0.5) * DS;
                if (Math.abs(lat) > h) continue;
                const ll = proj.toLatLon({ x: P[i].x + rr.x * lat, y: P[i].y + rr.y * lat });
                const cell = cells.find((cc) => ll.lon >= cc.bbox.west && ll.lon < cc.bbox.east && ll.lat >= cc.bbox.south && ll.lat < cc.bbox.north);
                if (!cell) continue;
                const v = sampleImage(cell.rgb!, ll);
                if (!v) continue;
                const sat = Math.max(...v) - Math.min(...v), L = 0.3 * v[0] + 0.59 * v[1] + 0.11 * v[2];
                if (sat > 34) continue; // yellow paint, a coloured car
                if (cell.surface) {
                    const s = cell.surface, px = Math.floor(((ll.lon - s.bbox.west) / (s.bbox.east - s.bbox.west)) * s.width), py = Math.floor(((s.bbox.north - ll.lat) / (s.bbox.north - s.bbox.south)) * s.height);
                    const a = px >= 0 && py >= 0 && px < s.width && py < s.height ? s.above[py * s.width + px] : NaN;
                    if (a > 0.6) continue; // a vehicle or an overhanging tree
                }
                lum[r * cols + c] = L;
            }
        }
        // Local median per 40 m window (all columns).
        const W = Math.round(40 / DS), med = new Float32Array(rows);
        for (let r = 0; r < rows; r += 10) {
            const vals: number[] = [];
            for (let q = Math.max(0, r - W / 2); q < Math.min(rows, r + W / 2); q += 2) for (let c = 0; c < cols; c++) { const v = lum[q * cols + c]; if (Number.isFinite(v)) vals.push(v); }
            vals.sort((a, b) => a - b);
            const m = vals.length ? vals[Math.floor(vals.length / 2)] : NaN;
            for (let q = r; q < Math.min(rows, r + 10); q++) med[q] = m;
        }
        const cls = new Int8Array(rows * cols);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const v = lum[r * cols + c], m = med[r];
            if (!Number.isFinite(v) || !Number.isFinite(m)) continue;
            if (v > m * 1.45) continue; // white paint
            cls[r * cols + c] = v < m * 0.86 ? -1 : v > m * 1.13 ? 1 : 0;
        }
        const seen = new Uint8Array(rows * cols);
        for (let k0 = 0; k0 < rows * cols; k0++) {
            if (!cls[k0] || seen[k0]) continue;
            const want = cls[k0], comp: number[] = [], stack = [k0]; seen[k0] = 1;
            while (stack.length && comp.length < 4000) {
                const k = stack.pop()!; comp.push(k);
                const r = Math.floor(k / cols), c = k % cols;
                for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const r2 = r + dr, c2 = c + dc; if (r2 < 0 || c2 < 0 || r2 >= rows || c2 >= cols) continue;
                    const k2 = r2 * cols + c2; if (cls[k2] === want && !seen[k2]) { seen[k2] = 1; stack.push(k2); }
                }
            }
            let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
            for (const k of comp) { const r = Math.floor(k / cols), c = k % cols; r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
            const len = (r1 - r0 + 1) * DS, wid = (c1 - c0 + 1) * DS, fill = comp.length / ((r1 - r0 + 1) * (c1 - c0 + 1));
            if (len < 2.5 || wid < 1.5 || len > 80 || fill < 0.7) continue; // too small, or ragged (tree shadow)
            const s0 = r0 * DS, s1 = (r1 + 1) * DS, l0 = -maxHalf + c0 * DS, l1 = -maxHalf + (c1 + 1) * DS;
            const i = idxAt((s0 + s1) / 2), h = g.halfAt(i) - 0.05;
            rect('PAINT_PATCH', patchMat(want < 0 ? 'dark' : 'light'), s0, s1, Math.max(-h, l0), Math.min(h, l1), 0.004, (s, l) => [l / 8, s / 8]);
            stats.patches++;
        }
    }

    // ------------------------------------------------ crack sealant
    const sealM = flat('road_sealant', [20, 20, 22], 0.5, 60);
    /** A meandering sealant line from (s, lat) along direction (ds, dl) for len metres. */
    const crack = (s: number, lat: number, ds: number, dl: number, len: number, w: number) => {
        const N = Math.max(2, Math.round(len / 0.35));
        const pts: [number, number][] = [];
        let a = Math.atan2(dl, ds);
        let cs = s, cl2 = lat;
        for (let k = 0; k <= N; k++) {
            pts.push([cs, cl2]);
            a += (rand() - 0.5) * 0.5;
            const base = Math.atan2(dl, ds);
            a = base + Math.max(-0.5, Math.min(0.5, a - base));
            cs += Math.cos(a) * (len / N); cl2 += Math.sin(a) * (len / N);
        }
        for (let k = 0; k < N; k++) {
            const [sa, la] = pts[k], [sb, lb] = pts[k + 1];
            const i = idxAt(sa), h = g.halfAt(i) - 0.05;
            if (Math.abs(la) > h || Math.abs(lb) > h) continue;
            const dx = sb - sa, dy = lb - la, l = Math.hypot(dx, dy) || 1, ox = (-dy / l) * w / 2, oy = (dx / l) * w / 2;
            const m = mesh('PAINT_SEAL', pt(sa, la, 0.003), sealM);
            m.face([pt(sa - ox, la - oy, 0.003), pt(sb - ox, lb - oy, 0.003), pt(sb + ox, lb + oy, 0.003), pt(sa + ox, la + oy, 0.003)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
        stats.cracks++;
    };
    for (let sM = 6; sM < cl.length - 6;) {
        const i = idxAt(sM), h = g.halfAt(i);
        if (!g.onBridge(i)) {
            // Transverse: across most of the width; on older rural roads, more of them.
            if (rand() < (urban(i) ? 0.35 : 0.6)) crack(sM, -h + 0.3 + rand() * 0.6, 0.05, 1, 2 * h - 1.2 - rand() * 2, 0.05 + rand() * 0.03);
            // Longitudinal: the paving joint near the centre and inside the edges, in runs.
            if (rand() < 0.3) crack(sM, (rand() - 0.5) * 0.6, 1, 0.02, 4 + rand() * 10, 0.05);
            if (rand() < 0.2) crack(sM, (rand() < 0.5 ? -1 : 1) * (h - 0.6), 1, 0, 3 + rand() * 8, 0.05);
        }
        sM += 9 + rand() * 18;
    }

    // ------------------------------------------------ manholes and storm drains
    const manholeM = decal('road_manhole', manholeImage, true);
    const drainM = decal('road_drain', drainImage, false);
    const lanes = (i: number) => {
        const ls = road?.lanes[i], h = g.halfAt(i);
        if (!ls) return [-h / 2, h / 2];
        const total = ls.fwd + ls.bwd + (ls.centreTurn ? 1 : 0), lw = (2 * h - ls.extraL - ls.extraR) / Math.max(1, total);
        return Array.from({ length: total }, (_, k) => -h + ls.extraL + lw * (k + 0.5));
    };
    for (let sM = 30 + rand() * 40; sM < cl.length - 10; sM += 70 + rand() * 60) {
        const i = idxAt(sM);
        if (!urban(i) || g.onBridge(i)) continue;
        const ls = lanes(i), lat = ls[Math.floor(rand() * ls.length)] + (rand() < 0.5 ? -1 : 1) * 0.9 * rand(); // often in a wheel path
        const c = pt(sM, lat, 0.005), r = 0.4;
        const m = mesh('PAINT_MANHOLE', c, manholeM);
        m.face([pt(sM - r, lat - r, 0.005), pt(sM - r, lat + r, 0.005), pt(sM + r, lat + r, 0.005), pt(sM + r, lat - r, 0.005)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        stats.manholes++;
    }
    // Drains at the gutter: just before crosswalks and junctions, and every ~60 m between.
    const drainAt = new Set<number>();
    for (const c of opts.crossS ?? []) { drainAt.add(c - 4); drainAt.add(c + 4); }
    for (let sM = 20; sM < cl.length - 10; sM += 55 + rand() * 20) drainAt.add(sM);
    for (const sM of drainAt) {
        if (sM < 2 || sM > cl.length - 2) continue;
        const i = idxAt(sM);
        if (!urban(i) || g.onBridge(i)) continue;
        for (const side of [-1, 1]) {
            if (rand() < 0.35) continue;
            const h = g.halfAt(i), rr = right(i);
            if (nearStub({ x: P[i].x + rr.x * side * h, y: P[i].y + rr.y * side * h }, 1.5)) continue;
            const l0 = side * (h - 0.05), l1 = side * (h - 0.55);
            const m = mesh('PAINT_DRAIN', pt(sM, l0, 0.006), drainM);
            m.face([pt(sM - 0.45, Math.min(l0, l1), 0.012), pt(sM - 0.45, Math.max(l0, l1), 0.012), pt(sM + 0.45, Math.max(l0, l1), 0.012), pt(sM + 0.45, Math.min(l0, l1), 0.012)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
            stats.drains++;
        }
    }

    const parts = [...meshes.values()].flatMap((m) => m.parts).filter((p) => p.indices.length);
    for (const p of parts) if (p.name.startsWith('PAINT_SEAL') || p.name.startsWith('PAINT_DRAIN') || p.name.startsWith('PAINT_MANHOLE')) p.lodOut = 250;
    return { parts, stats };
}
