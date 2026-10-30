// The real edges of the asphalt, traced from the aerial photo (NAIP, ~0.6 m) and the lidar surface. OpenStreetMap
// gives a road's line and lane count, not where the pavement actually is: lines are often a metre or two off the
// middle, and lane counts make a width that ignores real shoulders and narrow lanes. Every sample along the route
// looks sideways for where the grey of the road gives way to grass, dirt or gravel; the result recentres the
// centreline on the pavement and sets the width, within limits of the mapped width.

import type { Centerline } from './route.ts';
import type { SiteRasters } from './site.ts';
import { sampleImage } from './site.ts';
import { classifyGround } from './ground.ts';
import type { SurfaceRaster } from './lidar.ts';

export interface EdgeTrace {
    /** Distance from the centreline to the pavement edge on each side (m), smoothed; NaN where not traced. */
    left: Float64Array;
    right: Float64Array;
    /** Share of samples with a confident edge on both sides. */
    coverage: number;
}

const STEP = 0.25;

function surfaceAbove(s: SurfaceRaster, p: { lat: number; lon: number }): number | null {
    const px = Math.floor(((p.lon - s.bbox.west) / (s.bbox.east - s.bbox.west)) * s.width), py = Math.floor(((s.bbox.north - p.lat) / (s.bbox.north - s.bbox.south)) * s.height);
    if (px < 0 || py < 0 || px >= s.width || py >= s.height) return null;
    const v = s.above[py * s.width + px];
    return Number.isFinite(v) ? v : null;
}

/**
 * 1 paved, 0 not (grass, dirt, gravel, forest floor), -1 unknown (no fine photo, or something standing there: a
 * parked car, an overhanging tree, a sign).
 */
export function pavedAt(site: SiteRasters): (p: { lat: number; lon: number }) => 1 | 0 | -1 {
    return (p) => {
        const cell = site.cells.find((c) => c.rgb && p.lon >= c.bbox.west && p.lon < c.bbox.east && p.lat >= c.bbox.south && p.lat < c.bbox.north);
        if (!cell?.rgb) return -1;
        const above = cell.surface ? surfaceAbove(cell.surface, p) : null;
        if (above != null && above > 0.5) return -1;
        const rgb = sampleImage(cell.rgb, p);
        if (!rgb) return -1;
        const nir = cell.nir ? sampleImage(cell.nir, p)?.[0] ?? null : null;
        return classifyGround(rgb, nir, null) === 1 ? 1 : 0;
    };
}

function median(a: number[]) { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

/**
 * Trace both edges along the route. `guess(i)` is the expected half width (from OSM); edges are looked for out to
 * 2.5 m beyond it (pavement running on past that is a lot, a driveway or a wide shoulder, so that side counts as
 * not traced). An edge is where at least 0.75 m of unpaved ground follows pavement.
 */
export function traceEdges(cl: Centerline, site: SiteRasters, guess: (i: number) => number): EdgeTrace {
    const n = cl.points.length, test = pavedAt(site);
    const raw: number[][] = [new Array(n).fill(NaN), new Array(n).fill(NaN)];
    for (let i = 0; i < n; i++) {
        const t = cl.tangents[i], r = { x: t.y, y: -t.x }, P = cl.points[i], max = guess(i) + 2.5;
        for (const [k, side] of [[0, -1], [1, 1]] as const) {
            let paved = 0, run = 0, runStart = 0, unknown = 0, edge = NaN;
            for (let d = 0.25; d <= max; d += STEP) {
                const v = test(cl.projection.toLatLon({ x: P.x + r.x * side * d, y: P.y + r.y * side * d }));
                if (v === 1) { paved++; run = 0; }
                else if (v === 0) { if (run === 0) runStart = d; run++; if (run * STEP >= 0.75 && paved * STEP >= 1) { edge = runStart; break; } }
                else { unknown++; run = 0; }
            }
            // Trust it only if most of the way out was seen (not hidden under cars or trees).
            if (Number.isFinite(edge) && unknown * STEP < edge * 0.5) raw[k][i] = edge;
        }
    }
    // Robust smoothing: a running median over ~18 m drops single bad reads, then a light average over ~10 m.
    const smooth = (a: number[]) => {
        const med = new Float64Array(n).fill(NaN);
        for (let i = 0; i < n; i++) {
            const w: number[] = [];
            for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) if (Number.isFinite(a[j])) w.push(a[j]);
            if (w.length >= 5) med[i] = median(w);
        }
        const out = new Float64Array(n).fill(NaN);
        for (let i = 0; i < n; i++) {
            let s = 0, c = 0;
            for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) if (Number.isFinite(med[j])) { s += med[j]; c++; }
            if (c >= 3) out[i] = s / c;
        }
        return out;
    };
    const left = smooth(raw[0]), right = smooth(raw[1]);
    let both = 0; for (let i = 0; i < n; i++) if (Number.isFinite(left[i]) && Number.isFinite(right[i])) both++;
    return { left, right, coverage: n ? both / n : 0 };
}

/**
 * From a trace: how far to move the centreline right (m) at each sample to sit mid-pavement, eased in and out of
 * traced stretches, capped at `maxShift`. Untraced samples get 0.
 */
export function recentreOffsets(tr: EdgeTrace, maxShift = 1.5): Float64Array {
    const n = tr.left.length, raw = new Float64Array(n), w = new Float64Array(n);
    for (let i = 0; i < n; i++) if (Number.isFinite(tr.left[i]) && Number.isFinite(tr.right[i])) { raw[i] = Math.max(-maxShift, Math.min(maxShift, (tr.right[i] - tr.left[i]) / 2)); w[i] = 1; }
    // Gaussian over ~20 m so the line never kinks; weights fade the shift out where the trace stops.
    const out = new Float64Array(n), R = 10, sig = 5;
    for (let i = 0; i < n; i++) {
        let s = 0, ws = 0, all = 0;
        for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) { const g = Math.exp(-((j - i) ** 2) / (2 * sig * sig)); s += g * w[j] * raw[j]; ws += g * w[j]; all += g; }
        out[i] = ws > 0 ? (s / ws) * (ws / all) : 0;
    }
    return out;
}
