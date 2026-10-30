// Height of the built ground at a point: the highest triangle of the given meshes under (x, z). Things standing on
// the ground (parked cars, hydrants, stall lines) use it, so they sit on the surface that's drawn and driven on,
// not on the raw lidar, which the coarser far verge only follows at its vertices.

import type { MeshPart } from './mesh.ts';

const CELL = 8;

export function surfaceSampler(parts: MeshPart[]): (x: number, z: number) => number | null {
    // Triangles bucketed by the grid cells their bounding boxes touch.
    const grid = new Map<number, number[]>(); // cell key -> flat list of [part, triangle] pairs
    const key = (cx: number, cz: number) => cx * 73856093 ^ cz * 19349663;
    parts.forEach((p, pi) => {
        const P = p.positions, I = p.indices;
        for (let t = 0; t < I.length; t += 3) {
            const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
            const x0 = Math.floor(Math.min(P[a], P[b], P[c]) / CELL), x1 = Math.floor(Math.max(P[a], P[b], P[c]) / CELL);
            const z0 = Math.floor(Math.min(P[a + 2], P[b + 2], P[c + 2]) / CELL), z1 = Math.floor(Math.max(P[a + 2], P[b + 2], P[c + 2]) / CELL);
            if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) continue; // huge far terrain triangles: not what things stand on
            for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
                const k = key(cx, cz);
                let list = grid.get(k);
                if (!list) grid.set(k, (list = []));
                list.push(pi, t);
            }
        }
    });
    return (x, z) => {
        const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
        if (!list) return null;
        let best: number | null = null;
        for (let k = 0; k < list.length; k += 2) {
            const p = parts[list[k]], t = list[k + 1], P = p.positions, I = p.indices;
            const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
            const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2];
            const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
            if (Math.abs(d) < 1e-9) continue;
            const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
            if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
            const y = l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1];
            if (best == null || y > best) best = y;
        }
        return best;
    };
}
