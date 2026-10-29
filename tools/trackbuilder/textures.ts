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
export function asphaltTexture(size = 256, opts: { centreLine?: boolean } = {}): Uint8Array {
    const centreLine = opts.centreLine ?? true;
    const img = makeImage(size, size);
    const n = noiseImage(size, 7, [64, 128, 256]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const u = (x + 0.5) / size;
        shade(img, i, [62, 62, 64], n[i], 0.35);
        const edge = u < 0.035 && u > 0.012 || u > 0.965 && u < 0.988;
        const centre = Math.abs(u - 0.488) < 0.008 || Math.abs(u - 0.512) < 0.008;
        if (edge) shade(img, i, [225, 225, 220], n[i], 0.12);
        else if (centre && centreLine) shade(img, i, [220, 175, 40], n[i], 0.12);
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

// ---------------------------------------------------------------- element textures

/** Guard rail steel: galvanised grey with the W-beam's two ridges as light bands. V runs up the beam. */
export function steelTexture(size = 64): Uint8Array {
    const img = makeImage(size, size);
    const n = noiseImage(size, 31, [8, 64]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const v = (y + 0.5) / size;
        const ridge = 0.5 + 0.5 * Math.cos(v * Math.PI * 4); // two ridges, two valleys
        const g = 120 + ridge * 70;
        shade(img, y * size + x, [g, g + 3, g + 6], n[y * size + x], 0.12);
    }
    return encodePNG(img);
}

export function barkTexture(size = 64): Uint8Array {
    const img = makeImage(size, size);
    const n = noiseImage(size, 41, [4, 16, 64]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const furrow = 0.5 + 0.5 * Math.sin((x / size) * Math.PI * 12 + n[i] * 4);
        shade(img, i, [84 - furrow * 25, 60 - furrow * 18, 42 - furrow * 12], n[i], 0.4);
    }
    return encodePNG(img);
}

/** Douglas fir needles: dark blue-green with clumps. */
export function needlesTexture(size = 128): Uint8Array {
    const img = makeImage(size, size);
    const n = noiseImage(size, 53, [8, 32, 128]);
    for (let i = 0; i < size * size; i++) shade(img, i, [38, 66, 40], n[i], 0.7);
    return encodePNG(img);
}

// 5x7 bitmap font. Each glyph = 7 rows, 5 bits per row (MSB = left column).
const FONT: Record<string, number[]> = {
    A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
    D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
    G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
    J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
    M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
    P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
    S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
    V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
    Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
    0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31],
    3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
    6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14],
    9: [14, 17, 17, 15, 1, 2, 12],
    ' ': [0, 0, 0, 0, 0, 0, 0], '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12],
    '!': [4, 4, 4, 4, 4, 0, 4], '/': [1, 1, 2, 4, 8, 16, 16], ':': [0, 12, 12, 0, 12, 12, 0],
    "'": [4, 4, 8, 0, 0, 0, 0], '&': [12, 18, 20, 8, 21, 18, 13], '?': [14, 17, 1, 2, 4, 0, 4],
};

/** Upper-cases and drops characters the sign font doesn't have. */
export function signText(t: string, max = 16): string {
    return t.toUpperCase().split('').filter((c) => c in FONT).join('').slice(0, max).trim();
}

/** Draw text centred in a box, as large as fits. */
export function drawText(img: { width: number; height: number; data: Uint8Array }, text: string, box: { x: number; y: number; w: number; h: number }, rgb: [number, number, number]) {
    const t = signText(text, 40);
    if (!t) return;
    const cols = t.length * 6 - 1; // 5 px glyph + 1 px gap
    const px = Math.max(1, Math.floor(Math.min(box.w / cols, box.h / 7)));
    const x0 = Math.round(box.x + (box.w - cols * px) / 2), y0 = Math.round(box.y + (box.h - 7 * px) / 2);
    [...t].forEach((ch, k) => {
        const g = FONT[ch];
        for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r] & (16 >> c)) {
            for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++) {
                const X = x0 + (k * 6 + c) * px + xx, Y = y0 + r * px + yy;
                if (X < 0 || Y < 0 || X >= img.width || Y >= img.height) continue;
                const i = (Y * img.width + X) * 4;
                img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
            }
        }
    });
}

export type SignStyle = 'kartcade' | 'distance' | 'custom' | 'warning';

/** Roadside sign face, 2:1. Kartcade red with white text; distance boards white on black; warning yellow. */
export function signTexture(text: string, style: SignStyle): Uint8Array {
    const W = 512, H = 256;
    const colours: Record<SignStyle, { bg: [number, number, number]; fg: [number, number, number]; border: [number, number, number] }> = {
        kartcade: { bg: [212, 36, 40], fg: [255, 255, 255], border: [255, 255, 255] },
        distance: { bg: [18, 18, 20], fg: [255, 255, 255], border: [255, 255, 255] },
        custom: { bg: [18, 18, 20], fg: [255, 255, 255], border: [212, 36, 40] },
        warning: { bg: [245, 183, 0], fg: [18, 18, 20], border: [18, 18, 20] },
    };
    const c = colours[style];
    const img = makeImage(W, H, [...c.bg, 255]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const b = Math.min(x, y, W - 1 - x, H - 1 - y);
        if (b >= 10 && b < 18) { const i = (y * W + x) * 4; img.data[i] = c.border[0]; img.data[i + 1] = c.border[1]; img.data[i + 2] = c.border[2]; }
    }
    if (style === 'kartcade') {
        drawText(img, text || 'KARTCADE', { x: 34, y: 40, w: W - 68, h: 120 }, c.fg);
        drawText(img, 'WEST LINN OREGON', { x: 60, y: 172, w: W - 120, h: 42 }, c.fg);
    } else drawText(img, text, { x: 34, y: 34, w: W - 68, h: H - 68 }, c.fg);
    return encodePNG(img);
}

/** Start/finish gantry banner, 8:1: chequered ends, text in the middle. */
export function bannerTexture(text: string): Uint8Array {
    const W = 1024, H = 128;
    const img = makeImage(W, H, [18, 18, 20, 255]);
    const sq = 32;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (x >= 192 && x < W - 192) continue;
        const white = (Math.floor(x / sq) + Math.floor(y / sq)) % 2 === 0;
        const i = (y * W + x) * 4; const v = white ? 245 : 18;
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
    }
    drawText(img, text, { x: 210, y: 18, w: W - 420, h: H - 36 }, [255, 255, 255]);
    return encodePNG(img);
}

// ---------------------------------------------------------------- traffic signs (RGBA, MUTCD-style colours)

const px = (img: RGBAImage, x: number, y: number, c: [number, number, number], a = 255) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const i = (y * img.width + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = a;
};

/** Fill transparent texels with the nearest edge colour (darkened) so filtering at cut-out edges stays clean. */
function bleed(img: RGBAImage, rgb: [number, number, number]) {
    for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4 + 3] === 0) { img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; }
}

/** R1-1 STOP: red octagon, white border and legend; transparent outside (alpha-tested). */
export function stopSignImage(): RGBAImage {
    const N = 256, img = makeImage(N, N, [0, 0, 0, 0]);
    const red: [number, number, number] = [176, 22, 30], white: [number, number, number] = [245, 245, 245];
    const inOct = (x: number, y: number, r: number) => { const u = Math.abs(x - N / 2), v = Math.abs(y - N / 2); return u <= r && v <= r && u + v <= r * 1.414; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!inOct(x + 0.5, y + 0.5, 124)) continue;
        px(img, x, y, inOct(x + 0.5, y + 0.5, 112) && !inOct(x + 0.5, y + 0.5, 106) ? white : inOct(x + 0.5, y + 0.5, 112) ? red : white);
    }
    drawText(img, 'STOP', { x: 36, y: 92, w: N - 72, h: 72 }, white);
    bleed(img, [120, 20, 24]);
    return img;
}

/** R1-2 YIELD: downward white triangle with a wide red border. */
export function yieldSignImage(): RGBAImage {
    const N = 256, img = makeImage(N, N, [0, 0, 0, 0]);
    const red: [number, number, number] = [176, 22, 30], white: [number, number, number] = [245, 245, 245];
    const inTri = (x: number, y: number, m: number) => { const top = 20 + m, bot = 236 - m * 1.6; if (y < top || y > bot) return false; const half = ((bot - y) / (bot - top)) * (118 - m * 1.7); return Math.abs(x - N / 2) <= half; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inTri(x, y, 0)) px(img, x, y, inTri(x, y, 30) ? white : red);
    drawText(img, 'YIELD', { x: 80, y: 66, w: 96, h: 30 }, red);
    bleed(img, [120, 20, 24]);
    return img;
}

/** R2-1 SPEED LIMIT: white, black border. 256 x 256 texture for a 4:5 sign (stretched slightly upright in use). */
export function speedLimitImage(mph: number): RGBAImage {
    const W = 256, H = 256, img = makeImage(W, H, [245, 245, 245, 255]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const b = Math.min(x, y, W - 1 - x, H - 1 - y); if (b >= 6 && b < 13) px(img, x, y, [18, 18, 20]); }
    drawText(img, 'SPEED', { x: 30, y: 20, w: W - 60, h: 38 }, [18, 18, 20]);
    drawText(img, 'LIMIT', { x: 30, y: 64, w: W - 60, h: 38 }, [18, 18, 20]);
    drawText(img, String(Math.round(mph)), { x: 34, y: 116, w: W - 68, h: 116 }, [18, 18, 20]);
    return img;
}

/** D3-1 street name blade for a mast arm: white on green, 4:1. */
export function streetNameImage(name: string): RGBAImage {
    const W = 512, H = 128, img = makeImage(W, H, [0, 102, 64, 255]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const b = Math.min(x, y, W - 1 - x, H - 1 - y); if (b >= 5 && b < 10) px(img, x, y, [240, 240, 240]); }
    drawText(img, abbreviateStreet(name), { x: 22, y: 24, w: W - 44, h: H - 48 }, [240, 240, 240]);
    return img;
}

/** Street names as US blades print them: Street -> ST, Avenue -> AVE, ... */
export function abbreviateStreet(name: string): string {
    const map: Record<string, string> = { street: 'ST', avenue: 'AVE', road: 'RD', drive: 'DR', boulevard: 'BLVD', lane: 'LN', court: 'CT', place: 'PL', highway: 'HWY', parkway: 'PKWY', terrace: 'TER', way: 'WAY', circle: 'CIR', north: 'N', south: 'S', east: 'E', west: 'W' };
    return name.split(/\s+/).map((w) => map[w.toLowerCase()] ?? w).join(' ');
}

/** Transit stop plate (1:2): white with a blue band. */
export function busStopImage(): RGBAImage {
    const W = 128, H = 256, img = makeImage(W, H, [245, 245, 245, 255]);
    for (let y = 0; y < 84; y++) for (let x = 0; x < W; x++) px(img, x, y, [0, 70, 150]);
    drawText(img, 'BUS', { x: 14, y: 14, w: W - 28, h: 56 }, [245, 245, 245]);
    drawText(img, 'STOP', { x: 14, y: 116, w: W - 28, h: 50 }, [18, 18, 20]);
    return img;
}

/** Plain colour texture (RGBA) for steel, housings and lenses. */
export function flatImage(rgb: [number, number, number], size = 8): RGBAImage {
    return makeImage(size, size, [rgb[0], rgb[1], rgb[2], 255]);
}
