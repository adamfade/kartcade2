// A build result as plain data, so the editor's preview build can run in a web worker and come back to the page.
// Functions (the projection, surface heights) become tables and are rebuilt on the other side.

import type { BuildResult } from './pack.ts';
import type { TrackGeometry } from './mesh.ts';
import { makeProjection } from './geo.ts';

const STEP = 0.5; // metres between surface samples across the road

export interface PortableBuild extends Omit<BuildResult, 'geometry' | 'centerline'> {
    geometry: Omit<TrackGeometry, 'roadHeightAt' | 'surfaceAt' | 'vergeReach' | 'halfAt' | 'onBridge'> & {
        half: Float32Array; reachL: Float32Array; reachR: Float32Array; bridge: Uint8Array;
        /** surfaceAt(i, lat) for lat = -span .. +span every STEP metres, row per sample. */
        span: number; surf: Float32Array; road: Float32Array;
    };
    centerline: Omit<BuildResult['centerline'], 'projection'> & { origin: { lat: number; lon: number } };
}

export function toPortable(r: BuildResult): PortableBuild {
    const g = r.geometry, cl = r.centerline, n = cl.points.length;
    const half = new Float32Array(n), reachL = new Float32Array(n), reachR = new Float32Array(n), bridge = new Uint8Array(n);
    let span = 0;
    for (let i = 0; i < n; i++) {
        half[i] = g.halfAt(i); reachL[i] = g.vergeReach(i, -1); reachR[i] = g.vergeReach(i, 1); bridge[i] = g.onBridge(i) ? 1 : 0;
        span = Math.max(span, half[i] + reachL[i], half[i] + reachR[i]);
    }
    span = Math.ceil(span);
    const cols = Math.round((2 * span) / STEP) + 1;
    const surf = new Float32Array(n * cols), road = new Float32Array(n * cols);
    for (let i = 0; i < n; i++) for (let c = 0; c < cols; c++) {
        const lat = -span + c * STEP;
        surf[i * cols + c] = g.surfaceAt(i, lat);
        road[i * cols + c] = g.roadHeightAt(i, lat);
    }
    const { projection, ...clRest } = cl;
    return {
        ...r,
        geometry: { parts: g.parts, dummies: g.dummies, width: g.width, half, reachL, reachR, bridge, span, surf, road },
        centerline: { ...clRest, origin: projection.origin },
    };
}

export function fromPortable(p: PortableBuild): BuildResult {
    const g = p.geometry, cols = Math.round((2 * g.span) / STEP) + 1, n = g.half.length;
    const look = (tab: Float32Array) => (i: number, lat: number) => {
        const ii = Math.max(0, Math.min(n - 1, i));
        const f = (Math.max(-g.span, Math.min(g.span, lat)) + g.span) / STEP, c = Math.min(cols - 2, Math.floor(f)), t = f - c;
        return tab[ii * cols + c] * (1 - t) + tab[ii * cols + c + 1] * t;
    };
    const geometry: TrackGeometry = {
        parts: g.parts, dummies: g.dummies, width: g.width,
        roadHeightAt: look(g.road), surfaceAt: look(g.surf),
        vergeReach: (i, side) => (side === -1 ? g.reachL : g.reachR)[Math.max(0, Math.min(n - 1, i))],
        halfAt: (i) => g.half[Math.max(0, Math.min(n - 1, i))],
        onBridge: (i) => g.bridge[Math.max(0, Math.min(n - 1, i))] === 1,
    };
    const { origin, ...clRest } = p.centerline;
    return { ...p, geometry, centerline: { ...clRest, projection: makeProjection(origin) } } as BuildResult;
}
