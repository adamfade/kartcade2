// Centerline: OSM/OSRM polyline -> smoothed line in local metres, resampled at a fixed spacing.

import { makeProjection } from './geo.ts';
import type { LatLon, Projection, Vec2 } from './geo.ts';

export interface Centerline {
    projection: Projection;
    /** Points in local metres (x east, y north), evenly spaced. */
    points: Vec2[];
    /** Distance along the line at each point, metres. */
    s: number[];
    /** Unit tangent at each point. */
    tangents: Vec2[];
    /** Signed curvature (1/m), positive = turning left. */
    curvature: number[];
    length: number;
    spacing: number;
}

export interface CenterlineOptions {
    spacing?: number; // metres, default 2
    /** Smoothing radius in metres (Gaussian sigma). Removes the kinks between OSM nodes. Default 6. */
    smoothSigma?: number;
}

function dist(a: Vec2, b: Vec2) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Resample a polyline at a fixed spacing (keeps both ends). */
export function resample(points: Vec2[], spacing: number): Vec2[] {
    const pts = points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > 1e-6);
    if (pts.length < 2) throw new Error('Route has fewer than two distinct points');
    const total = pts.slice(1).reduce((acc, p, i) => acc + dist(pts[i], p), 0);
    const n = Math.max(2, Math.round(total / spacing) + 1);
    const step = total / (n - 1);
    const out: Vec2[] = [pts[0]];
    let seg = 0, segStart = 0, segLen = dist(pts[0], pts[1]);
    for (let k = 1; k < n - 1; k++) {
        const target = k * step;
        while (segStart + segLen < target && seg < pts.length - 2) {
            segStart += segLen;
            seg++;
            segLen = dist(pts[seg], pts[seg + 1]);
        }
        const t = segLen > 0 ? (target - segStart) / segLen : 0;
        out.push({ x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t, y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * t });
    }
    out.push(pts[pts.length - 1]);
    return out;
}

/** Gaussian smoothing of a 2D polyline with fixed end points. sigma in samples. */
export function smooth2(points: Vec2[], sigmaSamples: number): Vec2[] {
    if (sigmaSamples <= 0) return points.slice();
    const r = Math.ceil(sigmaSamples * 3);
    const w: number[] = [];
    for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples)));
    const n = points.length;
    return points.map((p, i) => {
        if (i === 0 || i === n - 1) return p;
        // Shrink the window near the ends so the line still ends exactly at the pins.
        const rr = Math.min(r, i, n - 1 - i);
        let sx = 0, sy = 0, sw = 0;
        for (let k = -rr; k <= rr; k++) {
            const ww = w[k + r];
            sx += points[i + k].x * ww; sy += points[i + k].y * ww; sw += ww;
        }
        return { x: sx / sw, y: sy / sw };
    });
}

export function buildCenterline(polyline: LatLon[], opts: CenterlineOptions = {}): Centerline {
    if (polyline.length < 2) throw new Error('Route needs at least two points');
    const spacing = opts.spacing ?? 2;
    const sigmaM = opts.smoothSigma ?? 6;
    const projection = makeProjection(polyline[0]);
    const local = polyline.map((p) => projection.toLocal(p));
    // Dense resample first so smoothing works in metres, then smooth, then final resample.
    let pts = resample(local, 1);
    pts = smooth2(pts, sigmaM);
    pts = resample(pts, spacing);
    const n = pts.length;
    const s: number[] = [0];
    for (let i = 1; i < n; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]));
    const tangents = pts.map((_, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        const l = dist(a, b) || 1;
        return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    });
    const curvature = pts.map((_, i) => {
        if (i === 0 || i === n - 1) return 0;
        const t0 = tangents[i - 1], t1 = tangents[i + 1];
        const cross = t0.x * t1.y - t0.y * t1.x;
        const dot = t0.x * t1.x + t0.y * t1.y;
        const ang = Math.atan2(cross, dot);
        return ang / (s[i + 1] - s[i - 1] || 1);
    });
    // Light smoothing of curvature so banking doesn't twitch.
    const kSm = curvature.map((_, i) => {
        let a = 0, c = 0;
        for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < n) { a += curvature[j]; c++; } }
        return a / c;
    });
    return { projection, points: pts, s, tangents, curvature: kSm, length: s[n - 1], spacing };
}

/** Road width in metres from OSM way tags. */
export function roadWidthFromTags(tags: Record<string, string> | undefined, fallback = 6.5): number {
    if (!tags) return fallback;
    const w = tags.width ?? tags['width:carriageway'] ?? tags.est_width;
    if (w) {
        const m = /^\s*([\d.]+)\s*(m|ft|')?\s*$/i.exec(w);
        if (m) {
            let v = parseFloat(m[1]);
            if (m[2] && /ft|'/i.test(m[2])) v *= 0.3048;
            if (v >= 3 && v <= 20) return v;
        }
    }
    const lanes = parseInt(tags.lanes ?? '', 10);
    if (lanes >= 1 && lanes <= 6) return Math.max(4, lanes * 3.3);
    if (tags.highway === 'residential' || tags.highway === 'unclassified') return 6;
    if (tags.highway === 'track' || tags.highway === 'service') return 4;
    if (tags.highway === 'primary' || tags.highway === 'trunk') return 7.4;
    return fallback;
}

/** Length-weighted median width across the OSM ways that make up the route. */
export function dominantWidth(ways: { tags: Record<string, string>; length: number }[], fallback = 6.5): number {
    if (!ways.length) return fallback;
    const items = ways.map((w) => ({ v: roadWidthFromTags(w.tags, fallback), l: Math.max(1, w.length) })).sort((a, b) => a.v - b.v);
    const half = items.reduce((a, b) => a + b.l, 0) / 2;
    let acc = 0;
    for (const it of items) { acc += it.l; if (acc >= half) return it.v; }
    return items[items.length - 1].v;
}
