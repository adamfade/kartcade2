// Elevation: Terrarium tiles (AWS elevation-tiles-prod) or any height sampler; profile smoothing along the road.

import type { BBox, LatLon } from './geo.ts';

/** Returns ground height in metres above sea level, or null when unknown. */
export type HeightSampler = (p: LatLon) => number | null;

export interface TilePixels { width: number; height: number; data: Uint8Array; channels: 3 | 4 }

export function terrariumHeight(r: number, g: number, b: number): number {
    return r * 256 + g + b / 256 - 32768;
}

export function lonLatToTileXY(lon: number, lat: number, z: number) {
    const n = 2 ** z;
    const x = ((lon + 180) / 360) * n;
    const latR = (lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
    return { x, y };
}

/** Tile coordinates (x, y) at zoom z covering a bounding box. */
export function tilesForBBox(b: BBox, z: number): { x: number; y: number; z: number }[] {
    const a = lonLatToTileXY(b.west, b.north, z);
    const c = lonLatToTileXY(b.east, b.south, z);
    const out: { x: number; y: number; z: number }[] = [];
    for (let x = Math.floor(a.x); x <= Math.floor(c.x); x++) for (let y = Math.floor(a.y); y <= Math.floor(c.y); y++) out.push({ x, y, z });
    return out;
}

export function terrariumUrl(t: { x: number; y: number; z: number }) {
    return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${t.z}/${t.x}/${t.y}.png`;
}

/** Bilinear height sampler over a set of decoded Terrarium tiles at one zoom level. */
export function terrariumSampler(z: number, tiles: Map<string, TilePixels>): HeightSampler {
    const pxAt = (gx: number, gy: number): number | null => {
        const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
        const tile = tiles.get(`${tx}/${ty}`);
        if (!tile) return null;
        const px = Math.min(tile.width - 1, Math.max(0, Math.floor(gx - tx * 256)));
        const py = Math.min(tile.height - 1, Math.max(0, Math.floor(gy - ty * 256)));
        const i = (py * tile.width + px) * tile.channels;
        return terrariumHeight(tile.data[i], tile.data[i + 1], tile.data[i + 2]);
    };
    return (p) => {
        const { x, y } = lonLatToTileXY(p.lon, p.lat, z);
        const gx = x * 256 - 0.5, gy = y * 256 - 0.5;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0;
        const h00 = pxAt(x0, y0), h10 = pxAt(x0 + 1, y0), h01 = pxAt(x0, y0 + 1), h11 = pxAt(x0 + 1, y0 + 1);
        if (h00 == null || h10 == null || h01 == null || h11 == null) return h00 ?? h10 ?? h01 ?? h11 ?? null;
        return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
    };
}

export interface Profile {
    heights: number[]; // smoothed road surface height at each centerline point, metres
    climb: number; // total ascent, metres
    descent: number;
    maxGrade: number; // fraction, over ~20 m windows
    min: number;
    max: number;
}

function median(a: number[]) { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }

/**
 * Heights along the centerline. Raw DEM samples are noisy (trees, bridges, 10 m cells), so:
 * median filter -> Gaussian -> grade clamp. sigmaM is the Gaussian radius in metres.
 */
export function roadProfile(points: LatLon[], s: number[], sampler: HeightSampler, opts: { sigmaM?: number; maxGrade?: number } = {}): Profile {
    const n = points.length;
    const raw = points.map((p) => sampler(p));
    // Fill unknowns from the nearest known sample.
    let last: number | null = raw.find((v) => v != null) ?? 0;
    const filled = raw.map((v) => { if (v != null) last = v; return last as number; });
    const step = n > 1 ? s[n - 1] / (n - 1) : 2;
    const mWin = Math.max(1, Math.round(6 / step));
    const med = filled.map((_, i) => median(filled.slice(Math.max(0, i - mWin), Math.min(n, i + mWin + 1))));
    const sig = Math.max(0.5, (opts.sigmaM ?? 18) / step);
    const r = Math.ceil(sig * 3);
    let h = med.map((_, i) => {
        let a = 0, w = 0;
        for (let k = -r; k <= r; k++) {
            const j = Math.min(n - 1, Math.max(0, i + k));
            const ww = Math.exp(-(k * k) / (2 * sig * sig));
            a += med[j] * ww; w += ww;
        }
        return a / w;
    });
    // Clamp grade so a bad DEM cell can't make a wall.
    const g = opts.maxGrade ?? 0.22;
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < n; i++) { const d = (s[i] - s[i - 1]) * g; h[i] = Math.min(h[i - 1] + d, Math.max(h[i - 1] - d, h[i])); }
        for (let i = n - 2; i >= 0; i--) { const d = (s[i + 1] - s[i]) * g; h[i] = Math.min(h[i + 1] + d, Math.max(h[i + 1] - d, h[i])); }
    }
    let climb = 0, descent = 0, maxGrade = 0;
    for (let i = 1; i < n; i++) { const d = h[i] - h[i - 1]; if (d > 0) climb += d; else descent -= d; }
    const win = Math.max(1, Math.round(20 / step));
    for (let i = win; i < n; i++) maxGrade = Math.max(maxGrade, Math.abs(h[i] - h[i - win]) / (s[i] - s[i - win] || 1));
    return { heights: h, climb, descent, maxGrade, min: Math.min(...h), max: Math.max(...h) };
}
