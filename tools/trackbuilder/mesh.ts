// Track geometry in Assetto Corsa space: X = east, Y = up, Z = north (left-handed, like DirectX).
// Front faces wind clockwise seen from above, so normals = cross(b - a, c - a) point up.

import type { Centerline } from './route.ts';

export type V3 = [number, number, number];

export interface MeshPart {
    name: string; // AC node name; physics meshes start with a digit + surface key (1ROAD_0, 1GRASS_0, 1WALL_0)
    material: string;
    positions: number[]; // xyz
    normals: number[];
    uvs: number[]; // uv
    tangents: number[];
    indices: number[];
    /** Drawn in game (default true). Invisible physics meshes give collision without a visible wall. */
    visible?: boolean;
    castShadows?: boolean;
    /** Draw distance in metres (0 / absent = always). Used for far vegetation and buildings. */
    lodOut?: number;
}

export interface Dummy { name: string; position: V3; forward: V3 }

export interface MeshOptions {
    width: number; // asphalt width, metres
    shoulder?: number; // gravel/grass shoulder flat with the road, metres (default 1)
    verge?: number; // grass out to this distance beyond the road edge (default 40)
    crown?: number; // cross-slope from centre to edge, fraction (default 0.02)
    maxBankDeg?: number; // superelevation cap (default 4)
    walls?: boolean; // invisible-ish barrier at the outer edge of the grass (default true)
    wallHeight?: number;
    /** Ground height in metres at a local point (x east, y north), for shaping the verge. */
    ground?: (x: number, y: number) => number | null;
    /** Flip the spawn direction if a build shows cars facing backwards (point-to-point only). */
    flipStart?: boolean;
    /** Circuit: number of grid slots and pit boxes (default 12). */
    gridSlots?: number;
    /** Road markings; default double yellow centre and white edge lines on roads, white edges on circuits. */
    markings?: MarkingPlan;
    /**
     * Fine elevation (1 m lidar) is available: the verge follows the real ground closely (ditches, cuttings,
     * banks) with dense columns, and the boundary walls become invisible (the terrain is the visual edge).
     */
    lidar?: boolean;
}

export interface TrackGeometry {
    parts: MeshPart[];
    dummies: Dummy[];
    /** Asphalt height at centreline index i and lateral offset (negative = left), clamped to the road. */
    roadHeightAt: (i: number, lateral: number) => number;
    /** Ground height at any lateral offset: asphalt, then the shoulder and verge as built. */
    surfaceAt: (i: number, lateral: number) => number;
    /** How far the verge reaches beyond the asphalt edge on one side (walls stand here). */
    vergeReach: (i: number, side: -1 | 1) => number;
    width: number;
}

const MAX_VERTS = 60000;

/**
 * Real-world size (metres) of one macro texture repeat per surface material. Mesh UVs are metres / this size,
 * and materials.ts derives detail tiling from it, so the two always agree.
 */
export const MACRO_M = { road: 48, shoulder: 16, verge: 64, terrain: 64, paint: 4 } as const;

/** Centre line styles (Oregon practice: 4 in yellow lines, 4 in apart; dashes 10 ft with 30 ft gaps). */
export type CentreStyle = 'double-solid' | 'passing-forward' | 'passing-back' | 'dashed' | 'none';
export interface MarkingPlan {
    centre: CentreStyle;
    edges: boolean;
    /** Stretches with a different centre line (passing zones), metres from the start. */
    overrides?: { from: number; to: number; centre: CentreStyle }[];
}

function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a: V3): V3 { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/**
 * A strip mesh from rows of cross-section points. rows[i][j] = position of column j at section i,
 * columns ordered left -> right across the direction of travel. uv(i, j) gives texture coords.
 * Splits into chunks below the 65k-vertex limit of 16-bit indices.
 */
function gridParts(baseName: string, material: string, rows: V3[][], uv: (i: number, j: number) => [number, number], tangentOf: (i: number) => V3): MeshPart[] {
    const cols = rows[0].length;
    const perChunk = Math.max(2, Math.floor(MAX_VERTS / cols));
    const parts: MeshPart[] = [];
    for (let start = 0, k = 0; start < rows.length - 1; start += perChunk - 1, k++) {
        const end = Math.min(rows.length, start + perChunk);
        const p: MeshPart = { name: `${baseName}_${k}`, material, positions: [], normals: [], uvs: [], tangents: [], indices: [] };
        for (let i = start; i < end; i++) for (let j = 0; j < cols; j++) {
            p.positions.push(...rows[i][j]);
            p.uvs.push(...uv(i, j));
            p.tangents.push(...tangentOf(i));
            p.normals.push(0, 0, 0);
        }
        const idx = (i: number, j: number) => (i - start) * cols + j;
        const tri = (a: number, b: number, c: number) => {
            const P = (v: number): V3 => [p.positions[v * 3], p.positions[v * 3 + 1], p.positions[v * 3 + 2]];
            let n = cross(sub(P(b), P(a)), sub(P(c), P(a)));
            if (n[1] < 0) { [b, c] = [c, b]; n = [-n[0], -n[1], -n[2]]; }
            if (Math.hypot(n[0], n[1], n[2]) < 1e-9) return; // degenerate
            p.indices.push(a, b, c);
            for (const v of [a, b, c]) { p.normals[v * 3] += n[0]; p.normals[v * 3 + 1] += n[1]; p.normals[v * 3 + 2] += n[2]; }
        };
        for (let i = start; i < end - 1; i++) for (let j = 0; j < cols - 1; j++) {
            const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
            tri(a, b, c); tri(c, b, d);
        }
        for (let v = 0; v < p.normals.length; v += 3) {
            const n = norm([p.normals[v], p.normals[v + 1], p.normals[v + 2]]);
            p.normals[v] = n[0]; p.normals[v + 1] = n[1]; p.normals[v + 2] = n[2];
        }
        parts.push(p);
        if (end === rows.length) break;
    }
    return parts;
}

/** Vertical wall strip, double-sided. */
function wallPart(name: string, material: string, base: V3[], height: number): MeshPart {
    const p: MeshPart = { name, material, positions: [], normals: [], uvs: [], tangents: [], indices: [] };
    let s = 0;
    for (let i = 0; i < base.length; i++) {
        if (i > 0) s += Math.hypot(base[i][0] - base[i - 1][0], base[i][2] - base[i - 1][2]);
        const t = i < base.length - 1 ? norm(sub(base[i + 1], base[i])) : norm(sub(base[i], base[i - 1]));
        const n = norm([t[2], 0, -t[0]]);
        p.positions.push(...base[i], base[i][0], base[i][1] + height, base[i][2]);
        p.normals.push(...n, ...n);
        p.uvs.push(s / 4, 0, s / 4, height / 4);
        p.tangents.push(...t, ...t);
    }
    for (let i = 0; i < base.length - 1; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        p.indices.push(a, b, c, c, b, d, a, c, b, c, d, b);
    }
    return p;
}

function smoothstep(t: number) { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); }

/**
 * How far the verge may reach from the centreline on one side before it meets another part of the same
 * road (the other leg of a hairpin, a parallel straight on a kart track). A point at lateral offset d is
 * closer to this section's centreline than to a far point P_j while d <= |v|^2 / (2 v.r), v = P_j - P_i.
 * "Far" means the path between them is much longer than the straight line, so neighbours along the same
 * stretch of road never count.
 */
function clearanceToOtherSections(cl: Centerline, maxReach: number): { left: number[]; right: number[] } {
    const n = cl.points.length, P = cl.points;
    const left = new Array(n).fill(Infinity), right = new Array(n).fill(Infinity);
    const cell = Math.max(10, 2 * maxReach); // the 3x3 cells around a point then cover every candidate within 2 * maxReach
    const grid = new Map<string, number[]>();
    const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    P.forEach((p, i) => { const k = key(p.x, p.y); let b = grid.get(k); if (!b) grid.set(k, (b = [])); b.push(i); });
    const arc = (i: number, j: number) => { const d = Math.abs(cl.s[j] - cl.s[i]); return cl.closed ? Math.min(d, cl.length - d) : d; };
    for (let i = 0; i < n; i++) {
        const p = P[i], r = { x: cl.tangents[i].y, y: -cl.tangents[i].x };
        const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
            for (const j of grid.get(`${gx},${gy}`) ?? []) {
                const vx = P[j].x - p.x, vy = P[j].y - p.y;
                const d2 = vx * vx + vy * vy, d = Math.sqrt(d2);
                if (d > maxReach * 2 || arc(i, j) < 1.6 * d + 8) continue;
                const vr = vx * r.x + vy * r.y;
                if (Math.abs(vr) < 1e-6) continue;
                const lim = d2 / (2 * Math.abs(vr));
                if (vr > 0) right[i] = Math.min(right[i], lim); else left[i] = Math.min(left[i], lim);
            }
        }
    }
    return { left, right };
}

export function buildGeometry(cl: Centerline, heights: number[], opts: MeshOptions): TrackGeometry {
    const W = opts.width, half = W / 2;
    const shoulder = opts.shoulder ?? 1;
    const verge = opts.verge ?? 40;
    const crown = opts.crown ?? 0.02;
    const maxBank = Math.tan(((opts.maxBankDeg ?? 4) * Math.PI) / 180);
    const n = cl.points.length;
    const closed = cl.closed;
    // Rows of the strip meshes: a circuit repeats row 0 at the end so the strips join at the line.
    const rowCount = closed ? n + 1 : n;
    const ix = (i: number) => (closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i)));
    const sRow = (i: number) => (i === n ? cl.length : cl.s[i]); // distance for UVs, continuous across the seam

    // Superelevation: proportional to curvature, capped. Positive bank raises the right side (left turn).
    const bank = cl.curvature.map((k) => Math.max(-maxBank, Math.min(maxBank, k * 12)));

    // Inner-side reach is limited by the turn radius so the verge never folds over itself, and by the
    // distance to other parts of the road so verges from neighbouring sections never overlap.
    const other = clearanceToOtherSections(cl, half + shoulder + verge);
    const reach = (i: number, side: -1 | 1) => {
        let r = verge;
        for (let k = -15; k <= 15; k++) {
            const j = i + k; if (!closed && (j < 0 || j >= n)) continue;
            const kk = cl.curvature[ix(j)];
            // Turning left (kk>0) the inside is the left side (-1).
            if ((kk > 0 && side === -1) || (kk < 0 && side === 1)) r = Math.min(r, 0.8 / Math.abs(kk) - half - shoulder);
        }
        const o = (side === -1 ? other.left : other.right)[i];
        if (Number.isFinite(o)) r = Math.min(r, o - half - shoulder - 0.5);
        return Math.max(0.5, r);
    };

    const right = (i: number) => ({ x: cl.tangents[i].y, y: -cl.tangents[i].x });
    // Road surface height at lateral offset (negative = left of centre): crown, then bank into the turn.
    const surf = (i: number, lat: number) => heights[i] - crown * Math.abs(Math.max(-half, Math.min(half, lat))) - bank[i] * Math.max(-half, Math.min(half, lat));
    const at = (i: number, lat: number, y: number): V3 => {
        const r = right(i);
        return [cl.points[i].x + r.x * lat, y, cl.points[i].y + r.y * lat];
    };

    // Road: five columns across.
    const roadCols = [-half, -half / 2, 0, half / 2, half];
    const roadRows = Array.from({ length: rowCount }, (_, i) => roadCols.map((lat) => at(ix(i), lat, surf(ix(i), lat))));
    const tangent3 = (i: number): V3 => { const r = right(ix(i)); return [r.x, 0, r.y]; };
    const parts: MeshPart[] = gridParts('1ROAD', 'road', roadRows, (i, j) => [0.5 + roadCols[j] / MACRO_M.road, sRow(i) / MACRO_M.road], tangent3);

    // Grass both sides: from the road edge outward, blending into the ground.
    // prof[0] = left, prof[1] = right: offsets beyond the asphalt edge and their heights, per row.
    const prof: { offs: number[]; ys: number[] }[][] = [new Array(n), new Array(n)];
    const sideRow = (i: number, side: -1 | 1) => {
        const edge = surf(i, side * half);
        const lim = reach(i, side);
        const steps = opts.lidar ? [0, 0, 0.8, 1.8, 3, 5, 8, 12, 18, 26, 36] : [0, 0, 3, 10, 22];
        const offs = [...steps.map((d, k) => (k === 0 ? 0 : shoulder + d)), shoulder + verge].map((d) => Math.min(d, lim + shoulder));
        // Keep offsets strictly increasing even when clamped.
        for (let k = 1; k < offs.length; k++) offs[k] = Math.max(offs[k], offs[k - 1] + 0.05);
        prof[side === -1 ? 0 : 1][i] = { offs: offs.slice(), ys: [] };
        const pts = offs.map((d, k) => {
            const lat = side * (half + d);
            const p = at(i, lat, 0);
            let y = edge - (k === 0 ? 0 : 0.03); // shoulder a touch below the asphalt
            if (k >= 2 && opts.ground) {
                const g = opts.ground(p[0], p[2]);
                // Lidar: the real ground (it already contains the road bench, ditches and cuttings), eased in
                // over 1.5 m from the shoulder. Coarse elevation: a long blend hides its 10 m cells.
                if (g != null && Number.isFinite(g)) y = opts.lidar
                    ? (edge - 0.05) + (g - (edge - 0.05)) * smoothstep((d - shoulder) / 1.5)
                    : edge + (g - edge) * smoothstep((d - shoulder) / (verge * 0.6));
            }
            p[1] = y;
            prof[side === -1 ? 0 : 1][i].ys.push(y);
            return p;
        });
        return side === -1 ? pts.reverse() : pts; // columns left -> right
    };
    const Lr = Array.from({ length: n }, (_, i) => sideRow(i, -1)), Rr = Array.from({ length: n }, (_, i) => sideRow(i, 1));
    const L = Array.from({ length: rowCount }, (_, i) => Lr[ix(i)]), R = Array.from({ length: rowCount }, (_, i) => Rr[ix(i)]);
    // Columns: L rows run outer edge -> asphalt edge (k = 5..0), R rows asphalt edge -> outer edge (k = 0..5).
    // The first strip (asphalt edge to edge + shoulder) is the gravel shoulder; the rest is the grass verge.
    const nc = L[0].length;
    // Shoulder strips: Ls columns are [edge + shoulder, asphalt edge], Rs columns are [asphalt edge, edge + shoulder].
    const shU = (lat: number) => 0.5 + lat / MACRO_M.shoulder;
    const worldUv = (rows: V3[][]) => (i: number, j: number): [number, number] => [rows[i][j][0] / MACRO_M.verge, rows[i][j][2] / MACRO_M.verge];
    const Ls = L.map((r) => r.slice(nc - 2)), Rs = R.map((r) => r.slice(0, 2));
    const Lv = L.map((r) => r.slice(0, nc - 1)), Rv = R.map((r) => r.slice(1));
    parts.push(...gridParts('1GRAVEL_L', 'shoulder', Ls, (i, j) => [shU(j === 0 ? -(half + shoulder) : -half), sRow(i) / MACRO_M.shoulder], tangent3));
    parts.push(...gridParts('1GRAVEL_R', 'shoulder', Rs, (i, j) => [shU(j === 0 ? half : half + shoulder), sRow(i) / MACRO_M.shoulder], tangent3));
    parts.push(...gridParts('1GRASS_L', 'verge', Lv, worldUv(Lv), tangent3));
    parts.push(...gridParts('1GRASS_R', 'verge', Rv, worldUv(Rv), tangent3));

    // Road markings: thin painted strips 12 mm above the asphalt, following its crown and banking.
    parts.push(...markingParts(cl, opts.markings ?? (closed ? { centre: 'none', edges: true } : { centre: 'double-solid', edges: true }), half, surf, at));

    if (opts.walls ?? true) {
        const h = opts.wallHeight ?? 2.5;
        const wl = wallPart('1WALL_L', 'wall', L.map((r) => r[0]), h), wr = wallPart('1WALL_R', 'wall', R.map((r) => r[r.length - 1]), h);
        if (opts.lidar) { wl.visible = wr.visible = false; wl.castShadows = wr.castShadows = false; }
        parts.push(wl, wr);
        if (!closed) {
            // Cap the two ends so cars can't drive off the start or the finish.
            const capAt = (i: number, flip: boolean) => {
                const row = [...L[i], ...R[i]];
                return wallPart(`1WALL_END${flip ? 'B' : 'A'}`, 'wall', row, h);
            };
            const ca = capAt(0, false), cb = capAt(n - 1, true);
            if (opts.lidar) { ca.visible = cb.visible = false; ca.castShadows = cb.castShadows = false; }
            parts.push(ca, cb);
        }
    }

    // AC dummies. Positions on the road surface; forward = direction of travel.
    const on = (i: number, lat: number, up: number): V3 => at(i, lat, surf(i, lat) + up);
    const fwd = (i: number, flip = false): V3 => { const t = cl.tangents[i]; return flip ? [-t.x, 0, -t.y] : [t.x, 0, t.y]; };
    const dummies: Dummy[] = closed ? circuitDummies(cl, half, on, fwd, opts.gridSlots ?? 12) : (() => {
        const idxAt = (sM: number) => Math.max(0, Math.min(n - 1, Math.round(sM / cl.spacing)));
        const flip = !!opts.flipStart;
        const startI = idxAt(Math.min(12, cl.length * 0.05));
        const pitI = idxAt(Math.min(6, cl.length * 0.02));
        const hotI = idxAt(Math.min(4, cl.length * 0.01));
        const lineA = idxAt(Math.min(25, cl.length * 0.1));
        const lineB = idxAt(Math.max(cl.length - 25, cl.length * 0.9));
        return [
            { name: 'AC_START_0', position: on(startI, 0, 0.1), forward: fwd(startI, flip) },
            { name: 'AC_PIT_0', position: on(pitI, 0, 0.1), forward: fwd(pitI, flip) },
            { name: 'AC_HOTLAP_START_0', position: on(hotI, 0, 0.1), forward: fwd(hotI, flip) },
            { name: 'AC_TIME_0_L', position: on(lineA, -half - 1, 1), forward: fwd(lineA) },
            { name: 'AC_TIME_0_R', position: on(lineA, half + 1, 1), forward: fwd(lineA) },
            { name: 'AC_TIME_1_L', position: on(lineB, -half - 1, 1), forward: fwd(lineB) },
            { name: 'AC_TIME_1_R', position: on(lineB, half + 1, 1), forward: fwd(lineB) },
            // Point-to-point (A to B) timing reads these gates.
            { name: 'AC_AB_START_L', position: on(lineA, -half - 1, 1), forward: fwd(lineA) },
            { name: 'AC_AB_START_R', position: on(lineA, half + 1, 1), forward: fwd(lineA) },
            { name: 'AC_AB_FINISH_L', position: on(lineB, -half - 1, 1), forward: fwd(lineB) },
            { name: 'AC_AB_FINISH_R', position: on(lineB, half + 1, 1), forward: fwd(lineB) },
        ];
    })();
    const surfaceAt = (i: number, lat: number) => {
        if (Math.abs(lat) <= half) return surf(i, lat);
        const p = prof[lat < 0 ? 0 : 1][i], d = Math.abs(lat) - half;
        for (let k = 1; k < p.offs.length; k++) if (d <= p.offs[k]) {
            const t = (d - p.offs[k - 1]) / (p.offs[k] - p.offs[k - 1] || 1);
            return p.ys[k - 1] + (p.ys[k] - p.ys[k - 1]) * t;
        }
        return p.ys[p.ys.length - 1];
    };
    const vergeReach = (i: number, side: -1 | 1) => { const o = prof[side === -1 ? 0 : 1][i].offs; return o[o.length - 1]; };
    return { parts, dummies, roadHeightAt: surf, surfaceAt, vergeReach, width: W };
}

/**
 * Circuit dummies. The start/finish line (AC_TIME_0) is at the first point of the loop. The grid forms up
 * behind it in a staggered two-by-two, 7 m apart; pit boxes share the grid spots (there is no pit lane,
 * and practice/qualifying spawn in the pits while races spawn on the grid, so they never overlap in use).
 */
function circuitDummies(cl: Centerline, half: number, on: (i: number, lat: number, up: number) => V3, fwd: (i: number) => V3, slots: number): Dummy[] {
    const n = cl.points.length;
    const back = (m: number) => ((n - Math.round(m / cl.spacing)) % n + n) % n; // index m metres before the line
    const spacing = 7, first = 6;
    const maxSlots = Math.max(1, Math.floor((cl.length * 0.35 - first) / (spacing / 2)) + 1);
    const count = Math.max(1, Math.min(slots, maxSlots));
    const lat = Math.min(half / 2, 2.5);
    const dummies: Dummy[] = [];
    for (let k = 0; k < count; k++) {
        const i = back(first + k * (spacing / 2));
        const side = k % 2 === 0 ? -1 : 1; // pole on the left
        dummies.push({ name: `AC_START_${k}`, position: on(i, side * lat, 0.1), forward: fwd(i) });
        dummies.push({ name: `AC_PIT_${k}`, position: on(i, side * lat, 0.1), forward: fwd(i) });
    }
    const hot = back(Math.min(120, cl.length * 0.25));
    dummies.push({ name: 'AC_HOTLAP_START_0', position: on(hot, 0, 0.1), forward: fwd(hot) });
    dummies.push({ name: 'AC_TIME_0_L', position: on(0, -half - 1, 1), forward: fwd(0) });
    dummies.push({ name: 'AC_TIME_0_R', position: on(0, half + 1, 1), forward: fwd(0) });
    return dummies;
}

/** Painted lines as their own meshes (PAINT_WHITE_n, PAINT_YELLOW_n): no physics, so they never change grip. */
function markingParts(cl: Centerline, plan: MarkingPlan, half: number, surf: (i: number, lat: number) => number,
    at: (i: number, lat: number, y: number) => V3): MeshPart[] {
    const LINE = 0.1, GAP = 0.1, LIFT = 0.012, DASH = 3.05, PERIOD = 12.2, STEP = 1;
    const L = cl.length, n = cl.points.length;
    const styleAt = (sM: number): CentreStyle => {
        for (const o of plan.overrides ?? []) {
            const inside = o.from <= o.to ? sM >= o.from && sM <= o.to : sM >= o.from || sM <= o.to; // wraps on a circuit
            if (inside) return o.centre;
        }
        return plan.centre;
    };
    // Position on the painted surface at distance sM (interpolated between centreline samples).
    const spot = (sM: number, lat: number): V3 => {
        let x = cl.closed ? ((sM % L) + L) % L : Math.max(0, Math.min(L, sM));
        let lo = 0, hi = n - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cl.s[mid] <= x) lo = mid; else hi = mid - 1; }
        const nxt = cl.closed ? (lo + 1) % n : Math.min(n - 1, lo + 1);
        const segEnd = nxt === 0 && cl.closed ? L : cl.s[nxt];
        const t = segEnd > cl.s[lo] ? (x - cl.s[lo]) / (segEnd - cl.s[lo]) : 0;
        const a = at(lo, lat, surf(lo, lat) + LIFT), b = at(nxt, lat, surf(nxt, lat) + LIFT);
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    };
    // Which stretches of each line are painted: lists of [from, to] in metres.
    const sample = (pred: (sM: number) => boolean): [number, number][] => {
        const out: [number, number][] = [];
        let open: number | null = null;
        for (let sM = 0; sM <= L; sM += 0.5) {
            const on = pred(Math.min(sM, L));
            if (on && open === null) open = sM;
            if (!on && open !== null) { out.push([open, sM]); open = null; }
        }
        if (open !== null) out.push([open, L]);
        return out;
    };
    const dashes = (pred: (sM: number) => boolean): [number, number][] => {
        const out: [number, number][] = [];
        for (let a = 0; a < L; a += PERIOD) { const b = Math.min(L, a + DASH); if (pred((a + b) / 2)) out.push([a, b]); }
        return out;
    };
    const lines: { lat: number; colour: 'white' | 'yellow'; spans: [number, number][] }[] = [];
    if (plan.edges) {
        const e = half - 0.2 - LINE / 2;
        lines.push({ lat: -e, colour: 'white', spans: [[0, L]] }, { lat: e, colour: 'white', spans: [[0, L]] });
    }
    const off = (GAP + LINE) / 2;
    const isDouble = (st: CentreStyle) => st === 'double-solid' || st === 'passing-forward' || st === 'passing-back';
    // Left line of the pair faces oncoming traffic; the right line is on the driver's own (right-hand) side.
    lines.push({ lat: -off, colour: 'yellow', spans: [...sample((s) => isDouble(styleAt(s)) && styleAt(s) !== 'passing-back'), ...dashes((s) => styleAt(s) === 'passing-back')] });
    lines.push({ lat: off, colour: 'yellow', spans: [...sample((s) => isDouble(styleAt(s)) && styleAt(s) !== 'passing-forward'), ...dashes((s) => styleAt(s) === 'passing-forward')] });
    lines.push({ lat: 0, colour: 'yellow', spans: dashes((s) => styleAt(s) === 'dashed') });

    const parts: Record<'white' | 'yellow', MeshPart[]> = { white: [], yellow: [] };
    const part = (colour: 'white' | 'yellow') => {
        const list = parts[colour], c = list[list.length - 1];
        if (c && c.positions.length / 3 < MAX_VERTS - 4) return c;
        const p: MeshPart = { name: `PAINT_${colour.toUpperCase()}_${list.length}`, material: `paint_${colour}`, positions: [], normals: [], uvs: [], tangents: [], indices: [], castShadows: false };
        list.push(p);
        return p;
    };
    for (const ln of lines) for (const [s0, s1] of ln.spans) {
        const steps = Math.max(1, Math.ceil((s1 - s0) / STEP));
        for (let k = 0; k < steps; k++) {
            const a = s0 + ((s1 - s0) * k) / steps, b = s0 + ((s1 - s0) * (k + 1)) / steps;
            const p = part(ln.colour), base = p.positions.length / 3;
            const corners: [number, number][] = [[a, ln.lat - LINE / 2], [a, ln.lat + LINE / 2], [b, ln.lat + LINE / 2], [b, ln.lat - LINE / 2]];
            const pts = corners.map(([sM, lat]) => spot(sM, lat));
            const t = norm(sub(pts[3], pts[0]));
            corners.forEach(([sM, lat], q) => { p.positions.push(...pts[q]); p.normals.push(0, 1, 0); p.uvs.push(0.5 + lat / MACRO_M.paint, sM / MACRO_M.paint); p.tangents.push(t[2], 0, -t[0]); });
            const ny = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))[1];
            if (ny > 0) p.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            else p.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
    }
    return [...parts.white, ...parts.yellow].filter((p) => p.indices.length);
}
