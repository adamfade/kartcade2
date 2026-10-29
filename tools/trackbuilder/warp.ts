// Straighten a wall seen at an angle: the four corners clicked on a video frame are mapped to a flat rectangle
// (a perspective warp), so a facade filmed from the road becomes a front-on photo for the facade tool.

import type { Rgba } from './dds.ts';

type P = { x: number; y: number };

/** 3x3 homography (row-major, h33 = 1) taking the unit square's corners (0,0) (1,0) (1,1) (0,1) to q[0..3]. */
function squareTo(q: P[]): number[] {
    const [p0, p1, p2, p3] = q;
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
    let g = 0, h = 0;
    if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
        const den = dx1 * dy2 - dx2 * dy1;
        g = (sx * dy2 - dx2 * sy) / den;
        h = (dx1 * sy - sx * dy1) / den;
    }
    return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

/** Where (u, v) in the unit square lands in the source image. */
export function quadPoint(q: P[], u: number, v: number): P {
    const m = squareTo(q);
    const w = m[6] * u + m[7] * v + m[8];
    return { x: (m[0] * u + m[1] * v + m[2]) / w, y: (m[3] * u + m[4] * v + m[5]) / w };
}

/** Output size that keeps the wall's proportions (mean of opposite edges), longest side `max`. */
export function quadSize(q: P[], max = 384): { width: number; height: number } {
    const d = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
    const w = (d(q[0], q[1]) + d(q[3], q[2])) / 2, h = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
    const k = max / Math.max(w, h, 1);
    return { width: Math.max(8, Math.round(w * k)), height: Math.max(8, Math.round(h * k)) };
}

/**
 * Warp the quad q (corners in order: top-left, top-right, bottom-right, bottom-left, in source pixels) to a
 * width x height image, sampling bilinearly.
 */
export function warpQuad(src: Rgba, q: P[], width: number, height: number): Rgba {
    const m = squareTo(q), out = new Uint8Array(width * height * 4);
    const sw = src.width, sh = src.height, s = src.data;
    for (let y = 0; y < height; y++) {
        const v = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
            const u = (x + 0.5) / width;
            const w = m[6] * u + m[7] * v + m[8];
            const fx = Math.max(0, Math.min(sw - 1.001, (m[0] * u + m[1] * v + m[2]) / w - 0.5));
            const fy = Math.max(0, Math.min(sh - 1.001, (m[3] * u + m[4] * v + m[5]) / w - 0.5));
            const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
            const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4, o = (y * width + x) * 4;
            for (let c = 0; c < 4; c++) {
                out[o + c] = Math.round((s[i00 + c] * (1 - ax) + s[i10 + c] * ax) * (1 - ay) + (s[i01 + c] * (1 - ax) + s[i11 + c] * ax) * ay);
            }
        }
    }
    return { width, height, data: out };
}
