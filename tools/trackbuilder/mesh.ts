// Track geometry in Assetto Corsa space: X = east, Y = up, Z = north (left-handed, like DirectX).
// Front faces wind clockwise seen from above, so normals = cross(b - a, c - a) point up.

import type { Centerline } from './route.ts';
import type { LaneSet } from './roadinfo.ts';
import { laneGeometry } from './roadinfo.ts';

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
    /** Only drawn beyond this distance (far stand-ins for detailed models, e.g. tree billboards). */
    lodIn?: number;
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
    /** Asphalt width per centreline sample (from the OSM lanes); overrides `width`, which stays the default. */
    widths?: ArrayLike<number>;
    /** Lane layout per sample, for lane lines, centre turn lanes and kerbside lanes. */
    lanes?: LaneSet[];
    /** Sample ranges on bridges: no grass or gravel there (the bridge builder adds walkways and parapets). */
    bridges?: { i0: number; i1: number }[];
    /** Per sample: an urban street with sidewalks, so the shoulder is a raised concrete walk, not gravel. */
    urban?: ArrayLike<boolean | number>;
    /** Per sample: a parking lot or service way, paved flush to the sides (no kerb, no gravel). */
    lot?: ArrayLike<boolean | number>;
}

/** Bridge walkway (kerb + sidewalk) width beyond the asphalt; parapets stand at its outer edge. */
export const BRIDGE_WALK = 2.0;

export interface TrackGeometry {
    parts: MeshPart[];
    dummies: Dummy[];
    /** Asphalt height at centreline index i and lateral offset (negative = left), clamped to the road. */
    roadHeightAt: (i: number, lateral: number) => number;
    /** Ground height at any lateral offset: asphalt, then the shoulder and verge as built. */
    surfaceAt: (i: number, lateral: number) => number;
    /** How far the verge reaches beyond the asphalt edge on one side (walls stand here). */
    vergeReach: (i: number, side: -1 | 1) => number;
    /** Widest asphalt width along the road. */
    width: number;
    /** Half the asphalt width at centreline index i. */
    halfAt: (i: number) => number;
    /** Whether sample i is on a bridge. */
    onBridge: (i: number) => boolean;
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
    const n0 = cl.points.length;
    const hwArr = new Float64Array(n0);
    for (let i = 0; i < n0; i++) hwArr[i] = (opts.widths ? opts.widths[i] : opts.width) / 2;
    const hw = (i: number) => hwArr[i];
    let maxHalf = 0; for (let i = 0; i < n0; i++) maxHalf = Math.max(maxHalf, hwArr[i]);
    const bridgeRow = new Uint8Array(n0);
    for (const b of opts.bridges ?? []) for (let i = Math.max(0, b.i0); i <= Math.min(n0 - 1, b.i1); i++) bridgeRow[i] = 1;
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
    const other = clearanceToOtherSections(cl, maxHalf + shoulder + verge);
    const reach = (i: number, side: -1 | 1) => {
        let r = verge;
        for (let k = -15; k <= 15; k++) {
            const j = i + k; if (!closed && (j < 0 || j >= n)) continue;
            const kk = cl.curvature[ix(j)];
            // Turning left (kk>0) the inside is the left side (-1).
            if ((kk > 0 && side === -1) || (kk < 0 && side === 1)) r = Math.min(r, 0.8 / Math.abs(kk) - hw(i) - shoulder);
        }
        const o = (side === -1 ? other.left : other.right)[i];
        if (Number.isFinite(o)) r = Math.min(r, o - hw(i) - shoulder - 0.5);
        return Math.max(0.5, r);
    };

    const right = (i: number) => ({ x: cl.tangents[i].y, y: -cl.tangents[i].x });
    // Road surface height at lateral offset (negative = left of centre): crown, then bank into the turn.
    const surf = (i: number, lat: number) => { const h = hw(i), l = Math.max(-h, Math.min(h, lat)); return heights[i] - crown * Math.abs(l) - bank[i] * l; };
    const at = (i: number, lat: number, y: number): V3 => {
        const r = right(i);
        return [cl.points[i].x + r.x * lat, y, cl.points[i].y + r.y * lat];
    };

    // Road: five columns across.
    const roadCols = (i: number) => { const h = hw(i); return [-h, -h / 2, 0, h / 2, h]; };
    const roadRows = Array.from({ length: rowCount }, (_, i) => roadCols(ix(i)).map((lat) => at(ix(i), lat, surf(ix(i), lat))));
    const tangent3 = (i: number): V3 => { const r = right(ix(i)); return [r.x, 0, r.y]; };
    const parts: MeshPart[] = gridParts('1ROAD', 'road', roadRows, (i, j) => [0.5 + roadCols(ix(i))[j] / MACRO_M.road, sRow(i) / MACRO_M.road], tangent3);

    // Grass both sides: from the road edge outward, blending into the ground.
    // prof[0] = left, prof[1] = right: offsets beyond the asphalt edge and their heights, per row.
    const prof: { offs: number[]; ys: number[] }[][] = [new Array(n), new Array(n)];
    const steps = opts.lidar ? [0, 0, 0.8, 1.8, 3, 5, 8, 12, 18, 26, 36] : [0, 0, 3, 10, 22];
    const lotRow = (i: number) => !!opts.lot?.[i];
    const urbanRow = (i: number) => !!opts.urban?.[i] && !lotRow(i);
    /** Shoulder kind per row: 0 gravel (rural), 1 sidewalk (urban), 2 paved lot. */
    const shoulderKind = (i: number) => (lotRow(i) ? 2 : urbanRow(i) ? 1 : 0);
    const sideRow = (i: number, side: -1 | 1) => {
        const half = hw(i);
        const edge = surf(i, side * half);
        if (bridgeRow[i]) {
            // On a bridge the "verge" is the walkway: kerb up 0.15 m, then flat to the parapet.
            const offs = steps.map((_, k) => (k === 0 ? 0 : k === 1 ? 0.25 : 0.25 + ((BRIDGE_WALK - 0.25) * (k - 1)) / (steps.length - 1)));
            offs.push(BRIDGE_WALK);
            const ys = offs.map((_, k) => (k === 0 ? edge : edge + 0.15));
            prof[side === -1 ? 0 : 1][i] = { offs: offs.slice(), ys };
            const pts = offs.map((d, k) => { const p = at(i, side * (half + d), 0); p[1] = ys[k]; return p; });
            return side === -1 ? pts.reverse() : pts;
        }
        const lim = reach(i, side);
        const offs = [...steps.map((d, k) => (k === 0 ? 0 : shoulder + d)), shoulder + verge].map((d) => Math.min(d, lim + shoulder));
        // Keep offsets strictly increasing even when clamped.
        for (let k = 1; k < offs.length; k++) offs[k] = Math.max(offs[k], offs[k - 1] + 0.05);
        prof[side === -1 ? 0 : 1][i] = { offs: offs.slice(), ys: [] };
        const pts = offs.map((d, k) => {
            const lat = side * (half + d);
            const p = at(i, lat, 0);
            // Shoulder a touch below the asphalt; on urban streets a sidewalk rising to kerb height.
            const walk = urbanRow(i), flush = lotRow(i);
            const shoulderY = walk ? edge + 0.15 : flush ? edge - 0.005 : edge - 0.03;
            // Urban: the sidewalk is flat at kerb height right from the asphalt edge (the kerb face is its own mesh).
            let y = k === 0 ? (walk ? edge + 0.15 : edge) : shoulderY;
            if (k >= 2 && opts.ground) {
                const g = opts.ground(p[0], p[2]);
                // Lidar: the real ground (it already contains the road bench, ditches and cuttings), eased in
                // over 1.5 m from the shoulder. Coarse elevation: a long blend hides its 10 m cells.
                const from = walk ? shoulderY - 0.02 : flush ? edge - 0.01 : edge - 0.05;
                if (g != null && Number.isFinite(g)) y = opts.lidar
                    ? from + (g - from) * smoothstep((d - shoulder) / 1.5)
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
    // Shoulders and verges skip bridge rows (the bridge has its own walkways); each run of land rows is its own
    // set of strips. A run includes the bridge's end rows so the land meets the deck.
    const runs: [number, number][] = [];
    for (let i = 0; i < rowCount;) {
        if (bridgeRow[ix(i)] && i < rowCount - 1 && bridgeRow[ix(i + 1)]) { i++; continue; }
        let j = i;
        while (j + 1 < rowCount && !(bridgeRow[ix(j)] && bridgeRow[ix(j + 1)])) j++;
        if (j > i) runs.push([i, j]);
        i = j + 1;
    }
    // Shoulder strips also change between gravel (rural) and sidewalk (urban); verges run on regardless.
    const shoulderRuns: [number, number, boolean, number][] = [];
    for (const [a, b] of runs) {
        let k = a;
        while (k < b) {
            const kind = shoulderKind(ix(k));
            let j = k; while (j < b && shoulderKind(ix(j + 1)) === kind) j++;
            shoulderRuns.push([k, Math.min(b, j + 1), kind === 1, kind]);
            k = j + 1;
        }
    }
    shoulderRuns.forEach(([a, b, , kind], r) => {
        const sfx = shoulderRuns.length > 1 ? `_r${r}` : '';
        const sl = (rows: V3[][]) => rows.slice(a, b + 1);
        const row = (i: number) => a + i;
        const [name, mat] = kind === 1 ? ['1ROAD_WALK', 'sidewalk'] : kind === 2 ? ['1ROAD_LOT', 'lot'] : ['1GRAVEL', 'shoulder'];
        parts.push(...gridParts(`${name}_L${sfx}`, mat, sl(Ls), (i, j) => { const h = hw(ix(row(i))); return [shU(j === 0 ? -(h + shoulder) : -h), sRow(row(i)) / MACRO_M.shoulder]; }, (i) => tangent3(row(i))));
        parts.push(...gridParts(`${name}_R${sfx}`, mat, sl(Rs), (i, j) => { const h = hw(ix(row(i))); return [shU(j === 0 ? h : h + shoulder), sRow(row(i)) / MACRO_M.shoulder]; }, (i) => tangent3(row(i))));
    });
    // Kerbs and gutters on urban streets: the 15 cm kerb face at the asphalt edge, and the 0.45 m concrete gutter
    // pan in front of it.
    shoulderRuns.forEach(([a, b, u], r) => {
        if (!u) return;
        for (const side of [-1, 1] as const) {
            const tag = `${side < 0 ? 'L' : 'R'}_${r}`;
            const kerb: MeshPart = { name: `KERB_${tag}`, material: 'sidewalk', positions: [], normals: [], uvs: [], tangents: [], indices: [] };
            const gutter: MeshPart = { name: `PAINT_GUTTER_${tag}`, material: 'gutter', positions: [], normals: [], uvs: [], tangents: [], indices: [] };
            for (let k = a; k <= b; k++) {
                const i = ix(k), half = hw(i), e = surf(i, side * half), rr = right(i), sM = sRow(k);
                const inward: V3 = [-side * rr.x, 0, -side * rr.y];
                const bot = at(i, side * half, e - 0.02), top = at(i, side * half, e + 0.15);
                kerb.positions.push(...bot, ...top); kerb.normals.push(...inward, ...inward); kerb.uvs.push(sM / 2, 0, sM / 2, 0.08); kerb.tangents.push(cl.tangents[i].x, 0, cl.tangents[i].y, cl.tangents[i].x, 0, cl.tangents[i].y);
                const gi = side * (half - 0.45);
                const g0 = at(i, gi, surf(i, gi) + 0.008), g1 = at(i, side * half, e + 0.008);
                gutter.positions.push(...g0, ...g1); gutter.normals.push(0, 1, 0, 0, 1, 0); gutter.uvs.push(0.5, sM / MACRO_M.shoulder, 0.5 + 0.45 / MACRO_M.shoulder, sM / MACRO_M.shoulder); gutter.tangents.push(rr.x, 0, rr.y, rr.x, 0, rr.y);
                if (k > a) {
                    const v = (k - a) * 2;
                    for (const [m, want] of [[kerb, inward], [gutter, [0, 1, 0] as V3]] as const) {
                        const P = (q: number): V3 => [m.positions[q * 3], m.positions[q * 3 + 1], m.positions[q * 3 + 2]];
                        const tri = (x: number, y: number, z: number) => { const c = cross(sub(P(y), P(x)), sub(P(z), P(x))); if (c[0] * want[0] + c[1] * want[1] + c[2] * want[2] >= 0) m.indices.push(x, y, z); else m.indices.push(x, z, y); };
                        tri(v - 2, v, v - 1); tri(v - 1, v, v + 1);
                    }
                }
            }
            parts.push(kerb, gutter);
        }
    });
    runs.forEach(([a, b], r) => {
        const sfx = runs.length > 1 ? `_r${r}` : '';
        const sl = (rows: V3[][]) => rows.slice(a, b + 1);
        const row = (i: number) => a + i;
        parts.push(...gridParts(`1GRASS_L${sfx}`, 'verge', sl(Lv), worldUv(sl(Lv)), (i) => tangent3(row(i))));
        parts.push(...gridParts(`1GRASS_R${sfx}`, 'verge', sl(Rv), worldUv(sl(Rv)), (i) => tangent3(row(i))));
    });

    // Road markings: thin painted strips 12 mm above the asphalt, following its crown and banking.
    parts.push(...markingParts(cl, opts.markings ?? (closed ? { centre: 'none', edges: true } : { centre: 'double-solid', edges: true }), hw, surf, at, opts.lanes));

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
    const dummies: Dummy[] = closed ? circuitDummies(cl, hw(0), on, fwd, opts.gridSlots ?? 12) : (() => {
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
            { name: 'AC_TIME_0_L', position: on(lineA, -hw(lineA) - 1, 1), forward: fwd(lineA) },
            { name: 'AC_TIME_0_R', position: on(lineA, hw(lineA) + 1, 1), forward: fwd(lineA) },
            { name: 'AC_TIME_1_L', position: on(lineB, -hw(lineB) - 1, 1), forward: fwd(lineB) },
            { name: 'AC_TIME_1_R', position: on(lineB, hw(lineB) + 1, 1), forward: fwd(lineB) },
            // Point-to-point (A to B) timing reads these gates.
            { name: 'AC_AB_START_L', position: on(lineA, -hw(lineA) - 1, 1), forward: fwd(lineA) },
            { name: 'AC_AB_START_R', position: on(lineA, hw(lineA) + 1, 1), forward: fwd(lineA) },
            { name: 'AC_AB_FINISH_L', position: on(lineB, -hw(lineB) - 1, 1), forward: fwd(lineB) },
            { name: 'AC_AB_FINISH_R', position: on(lineB, hw(lineB) + 1, 1), forward: fwd(lineB) },
        ];
    })();
    const surfaceAt = (i: number, lat: number) => {
        const half = hw(i);
        if (Math.abs(lat) <= half) return surf(i, lat);
        const p = prof[lat < 0 ? 0 : 1][i], d = Math.abs(lat) - half;
        for (let k = 1; k < p.offs.length; k++) if (d <= p.offs[k]) {
            const t = (d - p.offs[k - 1]) / (p.offs[k] - p.offs[k - 1] || 1);
            return p.ys[k - 1] + (p.ys[k] - p.ys[k - 1]) * t;
        }
        return p.ys[p.ys.length - 1];
    };
    const vergeReach = (i: number, side: -1 | 1) => { const o = prof[side === -1 ? 0 : 1][i].offs; return o[o.length - 1]; };
    return { parts, dummies, roadHeightAt: surf, surfaceAt, vergeReach, width: maxHalf * 2, halfAt: hw, onBridge: (i: number) => bridgeRow[i] === 1 };
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

/** One painted line at a centreline sample: lateral position, colour and pattern. */
interface LineAt { lat: number; colour: 'white' | 'yellow'; pattern: 'solid' | 'dash' }

/**
 * The painted lines at sample i, keyed so the same line can be followed from sample to sample. US practice:
 * yellow separates opposing traffic (double solid, passing zones, two-way left-turn lane: solid outside, dashed
 * inside), white separates lanes going the same way (dashed; solid beside an exclusive turn lane), white edge
 * lines on rural roads, a white line between the travel lane and a bike or parking lane.
 */
function linesAt(i: number, h: number, ls: LaneSet, centre: CentreStyle, plan: MarkingPlan): Map<string, LineAt> {
    const out = new Map<string, LineAt>();
    if (ls.lot) return out; // parking aisles and service ways carry no lane lines
    const OFF = 0.1; // half the gap between the lines of a pair, plus half a line
    const edges = plan.edges && ls.edgeLines;
    // Travel lanes span [L0, R0]; kerbside lanes (parking, bike) sit outside them.
    const geo = laneGeometry(h, ls, edges);
    const { L0, R0 } = geo;
    if (ls.extraR > 0) out.set('kerbR', { lat: R0, colour: 'white', pattern: 'solid' });
    else if (edges) out.set('edgeR', { lat: h - 0.25, colour: 'white', pattern: 'solid' });
    if (ls.oneway || ls.bwd === 0) {
        if (ls.extraL > 0) out.set('kerbL', { lat: L0, colour: 'white', pattern: 'solid' });
        else if (edges) out.set('edgeL', { lat: -h + 0.25, colour: 'yellow', pattern: 'solid' });
        for (let k = 1; k < ls.fwd; k++) out.set(`f${k}`, { lat: L0 + k * geo.lw, colour: 'white', pattern: dividerPattern(ls.turnFwd, k) });
        return out;
    }
    if (ls.extraL > 0) out.set('kerbL', { lat: L0, colour: 'white', pattern: 'solid' });
    else if (edges) out.set('edgeL', { lat: -h + 0.25, colour: 'white', pattern: 'solid' });
    const lw = geo.lw, c0 = geo.c0; // c0: left edge of the centre (or of our lanes)
    for (let k = 1; k < ls.bwd; k++) out.set(`b${k}`, { lat: c0 - k * lw, colour: 'white', pattern: dividerPattern(ls.turnBwd, k) });
    let c1 = c0;
    if (ls.centreTurn) {
        c1 = c0 + lw;
        out.set('tlA', { lat: c0 - OFF, colour: 'yellow', pattern: 'solid' });
        out.set('tlB', { lat: c0 + OFF, colour: 'yellow', pattern: 'dash' });
        out.set('tlC', { lat: c1 - OFF, colour: 'yellow', pattern: 'dash' });
        out.set('tlD', { lat: c1 + OFF, colour: 'yellow', pattern: 'solid' });
    } else {
        // Two-lane roads take the plan's centre (passing zones); wider roads always get a double solid.
        const st = ls.fwd + ls.bwd <= 2 ? centre : centre === 'none' ? 'none' : 'double-solid';
        if (st === 'dashed') out.set('cM', { lat: c0, colour: 'yellow', pattern: 'dash' });
        else if (st !== 'none') {
            out.set('cL', { lat: c0 - OFF, colour: 'yellow', pattern: st === 'passing-back' ? 'dash' : 'solid' });
            out.set('cR', { lat: c0 + OFF, colour: 'yellow', pattern: st === 'passing-forward' ? 'dash' : 'solid' });
        }
    }
    for (let k = 1; k < ls.fwd; k++) out.set(`f${k}`, { lat: c1 + k * lw, colour: 'white', pattern: dividerPattern(ls.turnFwd, k) });
    void i;
    return out;
}

/** Divider between lane k-1 and k (left to right): solid beside an exclusive turn lane, else dashed. */
function dividerPattern(turns: string[] | null, k: number): 'solid' | 'dash' {
    if (!turns || turns.length <= k) return 'dash';
    const excl = (t: string) => /^(left|right|slight_left|slight_right|merge_to_left|merge_to_right)$/.test(t);
    return excl(turns[k - 1]) !== excl(turns[k]) ? 'solid' : 'dash';
}

/** Painted lines as their own meshes (PAINT_WHITE_n, PAINT_YELLOW_n): no physics, so they never change grip. */
function markingParts(cl: Centerline, plan: MarkingPlan, hw: (i: number) => number, surf: (i: number, lat: number) => number,
    at: (i: number, lat: number, y: number) => V3, lanes?: LaneSet[]): MeshPart[] {
    const LINE = 0.1, LIFT = 0.012, DASH = 3.05, PERIOD = 12.2, STEP = 1;
    const L = cl.length, n = cl.points.length;
    const styleAt = (sM: number): CentreStyle => {
        for (const o of plan.overrides ?? []) {
            const inside = o.from <= o.to ? sM >= o.from && sM <= o.to : sM >= o.from || sM <= o.to; // wraps on a circuit
            if (inside) return o.centre;
        }
        return plan.centre;
    };
    const plain: LaneSet = { fwd: 1, bwd: 1, centreTurn: false, oneway: false, turnFwd: null, turnBwd: null, extraL: 0, extraR: 0, edgeLines: true, laneWidth: 3.3 };
    // Lines per sample (keyed), then each key followed along the road.
    const per: Map<string, LineAt>[] = [];
    for (let i = 0; i < n; i++) per.push(linesAt(i, hw(i), lanes?.[i] ?? plain, styleAt(cl.s[i]), plan));
    const keys = new Set<string>(); per.forEach((m) => m.forEach((l, k) => keys.add(`${k}|${l.colour}|${l.pattern}`)));
    const idxAt = (sM: number) => {
        let lo = 0, hi = n - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cl.s[mid] <= sM) lo = mid; else hi = mid - 1; }
        return lo;
    };
    const parts: Record<'white' | 'yellow', MeshPart[]> = { white: [], yellow: [] };
    const part = (colour: 'white' | 'yellow') => {
        const list = parts[colour], c = list[list.length - 1];
        if (c && c.positions.length / 3 < MAX_VERTS - 4) return c;
        const p: MeshPart = { name: `PAINT_${colour.toUpperCase()}_${list.length}`, material: `paint_${colour}`, positions: [], normals: [], uvs: [], tangents: [], indices: [], castShadows: false };
        list.push(p);
        return p;
    };
    for (const key of keys) {
        const [name, colour, pattern] = key.split('|') as [string, 'white' | 'yellow', 'solid' | 'dash'];
        const has = (i: number) => { const l = per[i].get(name); return !!l && l.colour === colour && l.pattern === pattern; };
        const latOf = (i: number) => per[i].get(name)!.lat;
        // Position at distance sM, lateral offset interpolated between the samples either side.
        const spot = (sM: number, dLat: number): V3 => {
            const x = cl.closed ? ((sM % L) + L) % L : Math.max(0, Math.min(L, sM));
            const lo = idxAt(x), nxt = cl.closed ? (lo + 1) % n : Math.min(n - 1, lo + 1);
            const segEnd = nxt === 0 && cl.closed ? L : cl.s[nxt];
            const t = segEnd > cl.s[lo] ? (x - cl.s[lo]) / (segEnd - cl.s[lo]) : 0;
            const la = (has(lo) ? latOf(lo) : latOf(nxt)) + dLat, lb = (has(nxt) ? latOf(nxt) : latOf(lo)) + dLat;
            const a = at(lo, la, surf(lo, la) + LIFT), b = at(nxt, lb, surf(nxt, lb) + LIFT);
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        };
        // Runs of samples carrying this line, as metre spans (half a sample beyond each end).
        const spans: [number, number][] = [];
        for (let i = 0; i < n;) {
            if (!has(i)) { i++; continue; }
            let j = i; while (j + 1 < n && has(j + 1)) j++;
            const a = i === 0 ? 0 : cl.s[i] - cl.spacing / 2, b = j === n - 1 ? L : cl.s[j] + cl.spacing / 2;
            if (b - a > 0.5) spans.push([a, b]);
            i = j + 1;
        }
        const pieces: [number, number][] = [];
        for (const [a, b] of spans) {
            if (pattern === 'solid') pieces.push([a, b]);
            else for (let d = Math.floor(a / PERIOD) * PERIOD; d < b; d += PERIOD) { const x0 = Math.max(a, d), x1 = Math.min(b, d + DASH); if (x1 - x0 > 0.3) pieces.push([x0, x1]); }
        }
        for (const [s0, s1] of pieces) {
            const steps = Math.max(1, Math.ceil((s1 - s0) / STEP));
            for (let k = 0; k < steps; k++) {
                const a = s0 + ((s1 - s0) * k) / steps, b = s0 + ((s1 - s0) * (k + 1)) / steps;
                const p = part(colour), base = p.positions.length / 3;
                const corners: [number, number][] = [[a, -LINE / 2], [a, LINE / 2], [b, LINE / 2], [b, -LINE / 2]];
                const pts = corners.map(([sM, d]) => spot(sM, d));
                const t = norm(sub(pts[3], pts[0]));
                corners.forEach(([sM, d], q) => { p.positions.push(...pts[q]); p.normals.push(0, 1, 0); p.uvs.push(0.5 + d / MACRO_M.paint, sM / MACRO_M.paint); p.tangents.push(t[2], 0, -t[0]); });
                const ny = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))[1];
                if (ny > 0) p.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
                else p.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
            }
        }
    }
    return [...parts.white, ...parts.yellow].filter((p) => p.indices.length);
}
