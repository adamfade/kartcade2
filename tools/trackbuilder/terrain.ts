// Visual terrain around the track, from the same elevation data, so the road doesn't float in empty sky.
// It is visible only (no physics): cars stay inside the walls. Near the track the terrain is pushed
// below the built surface so it can never poke through the verge or the road (roads in cuttings).

import type { Centerline } from './route.ts';
import type { MeshPart, TrackGeometry, V3 } from './mesh.ts';
import { MACRO_M } from './mesh.ts';

export interface TerrainOptions {
    /** Ground height at a local point (x east, y north), or null. */
    ground: (x: number, y: number) => number | null;
    /** How far beyond the track's bounding box to extend, metres. */
    margin?: number;
    /** Most vertices to spend (spacing grows to fit). */
    maxVerts?: number;
    /** Exact extent in local metres (e.g. the site overview square). Default: the track's box + margin. */
    extent?: { x0: number; x1: number; z0: number; z1: number };
}

const MAX_PART_VERTS = 60000;

export function buildTerrain(cl: Centerline, g: TrackGeometry, opts: TerrainOptions): MeshPart[] {
    const margin = opts.margin ?? 350;
    const P = cl.points, n = P.length;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.y); z1 = Math.max(z1, p.y); }
    x0 -= margin; x1 += margin; z0 -= margin; z1 += margin;
    if (opts.extent) ({ x0, x1, z0, z1 } = opts.extent);
    const area = (x1 - x0) * (z1 - z0);
    const spacing = Math.max(15, Math.sqrt(area / (opts.maxVerts ?? 120000)));
    const cols = Math.ceil((x1 - x0) / spacing) + 1, rows = Math.ceil((z1 - z0) / spacing) + 1;

    // Nearest centreline sample within reach, via a coarse grid.
    const half = g.width / 2;
    const reachMax = half + 45; // asphalt + shoulder + the widest verge
    const zone = reachMax + spacing * 1.5;
    const cell = zone;
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < n; i += 1) { const k = `${Math.floor(P[i].x / cell)},${Math.floor(P[i].y / cell)}`; let b = buckets.get(k); if (!b) buckets.set(k, (b = [])); b.push(i); }
    /**
     * Highest the terrain may be at (x, z): just under the built surface (road, shoulder, verge) at the same
     * spot, measured at the nearest centreline sample. Null when the point is beyond the built corridor.
     */
    const nearestFloor = (x: number, z: number): number | null => {
        const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
        let best = -1, bd = Infinity;
        for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) for (const i of buckets.get(`${a},${b}`) ?? []) {
            const d = (x - P[i].x) ** 2 + (z - P[i].y) ** 2;
            if (d < bd) { bd = d; best = i; }
        }
        if (best < 0 || Math.sqrt(bd) > zone) return null;
        const t = cl.tangents[best];
        const lat = (x - P[best].x) * t.y + (z - P[best].y) * -t.x;
        const reachL = g.halfAt(best) + g.vergeReach(best, -1), reachR = g.halfAt(best) + g.vergeReach(best, 1);
        if (lat < -reachL - spacing * 1.5 || lat > reachR + spacing * 1.5) return null;
        return g.surfaceAt(best, Math.max(-reachL, Math.min(reachR, lat))) - 0.3;
    };

    let fallback = 0; { let c = 0; for (let i = 0; i < n; i += 10) { fallback += g.surfaceAt(i, 0); c++; } fallback /= c || 1; }
    const H: number[] = new Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = Math.min(x1, x0 + c * spacing), z = Math.min(z1, z0 + r * spacing); // last row/column on the edge, never past the data
        let h = opts.ground(x, z);
        if (h == null || !Number.isFinite(h)) h = fallback;
        const f = nearestFloor(x, z);
        if (f != null) h = Math.min(h, f);
        H[r * cols + c] = h - 0.5;
    }

    // Strip meshes in row bands under the vertex limit. Faces point up (cross(b - a, c - a).y > 0).
    const parts: MeshPart[] = [];
    const perBand = Math.max(2, Math.floor(MAX_PART_VERTS / cols));
    for (let r0 = 0, k = 0; r0 < rows - 1; r0 += perBand - 1, k++) {
        const r1 = Math.min(rows, r0 + perBand);
        const p: MeshPart = { name: `TERRAIN_${k}`, material: 'terrain', positions: [], normals: [], uvs: [], tangents: [], indices: [], castShadows: false };
        for (let r = r0; r < r1; r++) for (let c = 0; c < cols; c++) {
            const x = Math.min(x1, x0 + c * spacing), z = Math.min(z1, z0 + r * spacing), y = H[r * cols + c];
            const hx = (H[r * cols + Math.min(cols - 1, c + 1)] - H[r * cols + Math.max(0, c - 1)]) / (2 * spacing);
            const hz = (H[Math.min(rows - 1, r + 1) * cols + c] - H[Math.max(0, r - 1) * cols + c]) / (2 * spacing);
            const nl = Math.hypot(hx, 1, hz);
            p.positions.push(x, y, z); p.normals.push(-hx / nl, 1 / nl, -hz / nl);
            p.uvs.push(x / MACRO_M.terrain, z / MACRO_M.terrain); p.tangents.push(1, 0, 0);
        }
        const id = (r: number, c: number) => (r - r0) * cols + c;
        const pos = (v: number): V3 => [p.positions[v * 3], p.positions[v * 3 + 1], p.positions[v * 3 + 2]];
        const tri = (a: number, b: number, c: number) => {
            const A = pos(a), B = pos(b), C = pos(c);
            const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
            if (ny > 0) p.indices.push(a, b, c); else p.indices.push(a, c, b);
        };
        for (let r = r0; r < r1 - 1; r++) for (let c = 0; c < cols - 1; c++) { tri(id(r, c), id(r + 1, c), id(r, c + 1)); tri(id(r, c + 1), id(r + 1, c), id(r + 1, c + 1)); }
        parts.push(p);
        if (r1 === rows) break;
    }
    return parts;
}
