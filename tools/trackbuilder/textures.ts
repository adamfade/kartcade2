// Procedural textures (PNG) so a track needs no image assets or imagery licences.

import { encodePNG, makeImage } from './png.ts';
import type { RGBAImage } from './png.ts';

function rng(seed: number) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Tileable value noise in [0,1]. */
function noiseImage(size: number, seed: number, scales: number[]): Float32Array {
    const out = new Float32Array(size * size);
    const rand = rng(seed);
    for (const cells of scales) {
        const grid = new Float32Array(cells * cells).map(() => rand());
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const gx = (x / size) * cells, gy = (y / size) * cells;
            const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
            const at = (i: number, j: number) => grid[((j % cells) * cells) + (i % cells)];
            const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
            const v = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
            out[y * size + x] += v / scales.length;
        }
    }
    return out;
}

function shade(img: RGBAImage, i: number, base: [number, number, number], n: number, amt: number) {
    const f = 1 + (n - 0.5) * amt;
    img.data[i * 4] = Math.max(0, Math.min(255, base[0] * f));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] * f));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] * f));
    img.data[i * 4 + 3] = 255;
}

/**
 * Asphalt with markings. U runs across the road (0 = left edge, 1 = right edge), V along it.
 * White edge lines and a double yellow centre line, as on Oregon two-lane roads.
 */
export function asphaltTexture(size = 256): Uint8Array {
    const img = makeImage(size, size);
    const n = noiseImage(size, 7, [64, 128, 256]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const u = (x + 0.5) / size;
        shade(img, i, [62, 62, 64], n[i], 0.35);
        const edge = u < 0.035 && u > 0.012 || u > 0.965 && u < 0.988;
        const centre = Math.abs(u - 0.488) < 0.008 || Math.abs(u - 0.512) < 0.008;
        if (edge) shade(img, i, [225, 225, 220], n[i], 0.12);
        else if (centre) shade(img, i, [220, 175, 40], n[i], 0.12);
    }
    return encodePNG(img);
}

export function grassTexture(size = 256): Uint8Array {
    const img = makeImage(size, size);
    const n = noiseImage(size, 11, [16, 64, 256]);
    for (let i = 0; i < size * size; i++) shade(img, i, [70, 98, 46], n[i], 0.5);
    return encodePNG(img);
}

export function concreteTexture(size = 128): Uint8Array {
    const img = makeImage(size, size);
    const n = noiseImage(size, 23, [32, 128]);
    for (let i = 0; i < size * size; i++) shade(img, i, [150, 148, 142], n[i], 0.25);
    return encodePNG(img);
}

export function solidTexture(rgb: [number, number, number], size = 8): Uint8Array {
    return encodePNG(makeImage(size, size, [rgb[0], rgb[1], rgb[2], 255]));
}
