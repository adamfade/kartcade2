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
    /** Flip the spawn direction if a build shows cars facing backwards. */
    flipStart?: boolean;
}

export interface TrackGeometry { parts: MeshPart[]; dummies: Dummy[]; roadHeightAt: (i: number, lateral: number) => number }

const MAX_VERTS = 60000;

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

export function buildGeometry(cl: Centerline, heights: number[], opts: MeshOptions): TrackGeometry {
    const W = opts.width, half = W / 2;
    const shoulder = opts.shoulder ?? 1;
    const verge = opts.verge ?? 40;
    const crown = opts.crown ?? 0.02;
    const maxBank = Math.tan(((opts.maxBankDeg ?? 4) * Math.PI) / 180);
    const n = cl.points.length;

    // Superelevation: proportional to curvature, capped. Positive bank raises the right side (left turn).
    const bank = cl.curvature.map((k) => Math.max(-maxBank, Math.min(maxBank, k * 12)));

    // Inner-side reach is limited by the turn radius so the verge never folds over itself.
    const reach = (i: number, side: -1 | 1) => {
        let r = verge;
        for (let k = -15; k <= 15; k++) {
            const j = i + k; if (j < 0 || j >= n) continue;
            const kk = cl.curvature[j];
            // Turning left (kk>0) the inside is the left side (-1).
            if ((kk > 0 && side === -1) || (kk < 0 && side === 1)) r = Math.min(r, 0.8 / Math.abs(kk) - half - shoulder);
        }
        return Math.max(2, r);
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
    const roadRows = Array.from({ length: n }, (_, i) => roadCols.map((lat) => at(i, lat, surf(i, lat))));
    const tangent3 = (i: number): V3 => [right(i).x, 0, right(i).y];
    const parts: MeshPart[] = gridParts('1ROAD', 'road', roadRows, (i, j) => [(roadCols[j] + half) / W, cl.s[i] / 8], tangent3);

    // Grass both sides: from the road edge outward, blending into the ground.
    const sideRows = (side: -1 | 1) => Array.from({ length: n }, (_, i) => {
        const edge = surf(i, side * half);
        const lim = reach(i, side);
        const offs = [0, shoulder, shoulder + 3, shoulder + 10, shoulder + 22, shoulder + verge].map((d) => Math.min(d, lim + shoulder));
        // Keep offsets strictly increasing even when clamped.
        for (let k = 1; k < offs.length; k++) offs[k] = Math.max(offs[k], offs[k - 1] + 0.05);
        const pts = offs.map((d, k) => {
            const lat = side * (half + d);
            const p = at(i, lat, 0);
            let y = edge - (k === 0 ? 0 : 0.03); // shoulder a touch below the asphalt
            if (k >= 2 && opts.ground) {
                const g = opts.ground(p[0], p[2]);
                if (g != null && Number.isFinite(g)) y = edge + (g - edge) * smoothstep((d - shoulder) / (verge * 0.6));
            }
            p[1] = y;
            return p;
        });
        return side === -1 ? pts.reverse() : pts; // columns left -> right
    });
    const L = sideRows(-1), R = sideRows(1);
    parts.push(...gridParts('1GRASS_L', 'grass', L, (i, j) => [L[i][j][0] / 10, cl.s[i] / 10], tangent3));
    parts.push(...gridParts('1GRASS_R', 'grass', R, (i, j) => [R[i][j][0] / 10, cl.s[i] / 10], tangent3));

    if (opts.walls ?? true) {
        const h = opts.wallHeight ?? 2.5;
        parts.push(wallPart('1WALL_L', 'wall', L.map((r) => r[0]), h));
        parts.push(wallPart('1WALL_R', 'wall', R.map((r) => r[r.length - 1]), h));
        // Cap the two ends so cars can't drive off the start or the finish.
        const capAt = (i: number, flip: boolean) => {
            const row = [...L[i], ...R[i]];
            return wallPart(`1WALL_END${flip ? 'B' : 'A'}`, 'wall', row, h);
        };
        parts.push(capAt(Math.min(n - 1, 0), false), capAt(n - 1, true));
    }

    // AC dummies. Positions on the road surface; forward = direction of travel.
    const idxAt = (sM: number) => Math.max(0, Math.min(n - 1, Math.round(sM / cl.spacing)));
    const fwd = (i: number, flip = false): V3 => { const t = cl.tangents[i]; return flip ? [-t.x, 0, -t.y] : [t.x, 0, t.y]; };
    const flip = !!opts.flipStart;
    const startI = idxAt(Math.min(12, cl.length * 0.05));
    const pitI = idxAt(Math.min(6, cl.length * 0.02));
    const hotI = idxAt(Math.min(4, cl.length * 0.01));
    const lineA = idxAt(Math.min(25, cl.length * 0.1));
    const lineB = idxAt(Math.max(cl.length - 25, cl.length * 0.9));
    const on = (i: number, lat: number, up: number): V3 => { const p = at(i, lat, surf(i, lat) + up); return p; };
    const dummies: Dummy[] = [
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
    return { parts, dummies, roadHeightAt: surf };
}
