// Trees that read as trees from the driver's seat: Pacific Northwest species built as 3D models (trunk, limbs
// and foliage cards) for trees near the road, and far billboards rendered from those same models so the two
// match. Models switch to billboards with distance (KN5 lodIn / lodOut on 96 m chunks).
//
//   fir     Douglas fir: tall, conical, layered branch whorls
//   cedar   western red cedar: drooping fronds, broad base, buttressed trunk
//   maple   bigleaf maple: tall broad crown on a few big limbs
//   oak     Oregon white oak: wide, low, gnarled crown
//   street  street tree (planted maple/ash): small rounded crown, clean trunk
//
// Everything is generated (no tree assets needed): foliage card textures are drawn here, bark uses the library's
// photo-scanned bark.

import type { Rgba } from './dds.ts';
import type { MaterialBook, MaterialLibrary } from './materials.ts';
import { photoMaterial } from './materials.ts';
import type { MeshPart, V3 } from './mesh.ts';
import { Mesh } from './elements.ts';

export type Species = 'fir' | 'cedar' | 'maple' | 'oak' | 'street';
export const SPECIES: Species[] = ['fir', 'cedar', 'maple', 'oak', 'street'];

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const clamp = (v: number, a = 0, b = 255) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- foliage card textures

/**
 * Foliage atlas, 1024 x 1024, four 512 x 512 cards: fir needle spray, cedar frond, broadleaf cluster (maple),
 * small-leaf cluster (oak / street trees). Alpha-tested; transparent texels carry the card's mean colour so
 * filtering never darkens the edges.
 */
export function foliageAtlas(): Rgba {
    const W = 1024, data = new Uint8Array(W * W * 4);
    const cell = (ci: number) => ({ x0: (ci % 2) * 512, y0: Math.floor(ci / 2) * 512 });
    const put = (ci: number, x: number, y: number, c: number[]) => {
        if (x < 1 || y < 1 || x >= 511 || y >= 511) return;
        const { x0, y0 } = cell(ci), i = ((y0 + Math.floor(y)) * W + x0 + Math.floor(x)) * 4;
        data[i] = clamp(c[0]); data[i + 1] = clamp(c[1]); data[i + 2] = clamp(c[2]); data[i + 3] = 255;
    };
    const line = (ci: number, ax: number, ay: number, bx: number, by: number, w: number, c: number[]) => {
        const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(len));
        for (let k = 0; k <= n; k++) {
            const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, ww = w * (1 - 0.5 * t);
            for (let dy = -ww; dy <= ww; dy++) for (let dx = -ww; dx <= ww; dx++) if (dx * dx + dy * dy <= ww * ww) put(ci, x + dx, y + dy, c);
        }
    };
    const blob = (ci: number, cx: number, cy: number, rx: number, ry: number, rot: number, c: number[]) => {
        const r = Math.max(rx, ry);
        for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
            const u = (x * Math.cos(rot) + y * Math.sin(rot)) / rx, v = (-x * Math.sin(rot) + y * Math.cos(rot)) / ry;
            const d = u * u + v * v;
            if (d <= 1) put(ci, cx + x, cy + y, c.map((ch) => ch * (1.06 - 0.22 * d + 0.12 * u)));
        }
    };
    // 0: Douglas fir branch: a flat spray, main twig along the card (left = attached end) with side twigs, dense
    //    short needles, dark blue-green, lighter new growth at the tips.
    {
        const r = rng(3);
        for (let br = 0; br < 3; br++) {
            const y0 = 150 + br * 105 + (r() - 0.5) * 30, len = 470 - br * 20, sag = 30 + r() * 30;
            const at = (t: number): [number, number] => [18 + len * t, y0 + sag * t * t];
            for (let t = 0; t < 1; t += 0.004) { const [x, y] = at(t); line(0, x, y, x + 2, y, 3 * (1 - t) + 1, [66, 52, 38]); }
            for (let t = 0.04; t < 0.97; t += 0.045) {
                const [x, y] = at(t), tl = (1 - t) * 120 + 25;
                for (const sgn of [-1, 1]) {
                    const a = sgn * (0.75 + r() * 0.25) + 0.15, ex = x + Math.cos(a) * tl, ey = y + Math.sin(a) * tl * 0.75;
                    line(0, x, y, ex, ey, 1.6, [62, 52, 38]);
                    for (let u = 0.05; u < 1; u += 0.035) {
                        const nx = x + (ex - x) * u, ny = y + (ey - y) * u, tip = t > 0.75 || u > 0.8;
                        for (const s2 of [-1, 1]) {
                            const na = a + s2 * (1.1 + r() * 0.3), nl = 9 + r() * 5, sh = 0.8 + r() * 0.35;
                            const col = tip ? [62 * sh, 96 * sh, 58 * sh] : [36 * sh, 64 * sh, 48 * sh];
                            line(0, nx, ny, nx + Math.cos(na) * nl, ny + Math.sin(na) * nl, 2.2, col);
                        }
                    }
                }
            }
        }
    }
    // 1: Western red cedar frond: flat, fern-like, drooping, yellow-green.
    {
        const r = rng(5);
        for (let f = 0; f < 5; f++) {
            const y0 = 140 + f * 60 + (r() - 0.5) * 30;
            const pts: [number, number][] = [];
            for (let t = 0; t <= 1.0001; t += 0.02) pts.push([20 + t * 470, y0 + 140 * t * t + (r() - 0.5) * 3]);
            for (let k = 1; k < pts.length; k++) line(1, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1], 3, [64, 82, 40]);
            for (let k = 2; k < pts.length; k++) {
                const [x, y] = pts[k], len = 60 * (1 - k / pts.length) + 12;
                for (const sgn of [-1, 1]) {
                    const ex = x + len * 0.55, ey = y + sgn * len;
                    for (let t = 0; t < 1; t += 0.05) blob(1, x + (ex - x) * t, y + (ey - y) * t, 5, 4, 0, [72 + r() * 18, 104 + r() * 20, 44]);
                }
            }
        }
    }
    // 2: Broadleaf cluster (bigleaf maple): big five-lobed leaves overlapping, light from the top.
    {
        const r = rng(7);
        for (let k = 0; k < 70; k++) {
            const cx = 70 + r() * 372, cy = 70 + r() * 372, s = 26 + r() * 22, shade = 0.7 + (1 - cy / 512) * 0.35 + r() * 0.15;
            for (let l = 0; l < 5; l++) {
                const a = (l / 5) * Math.PI * 2 + r() * 0.3;
                blob(2, cx + Math.cos(a) * s * 0.55, cy + Math.sin(a) * s * 0.55, s * 0.55, s * 0.3, a, [66 * shade, 104 * shade, 40 * shade]);
            }
            blob(2, cx, cy, s * 0.45, s * 0.45, 0, [62 * shade, 98 * shade, 38 * shade]);
        }
    }
    // 3: Small-leaf cluster (oak, street trees): six to nine clumps of small leaves round a twig fork, ragged edge.
    {
        const r = rng(11);
        const clumps: [number, number, number][] = [];
        for (let k = 0; k < 8; k++) { const a = r() * Math.PI * 2, d = 40 + r() * 130; clumps.push([256 + Math.cos(a) * d, 256 + Math.sin(a) * d, 60 + r() * 45]); }
        for (const [cx, cy] of clumps) line(3, 256, 300, cx, cy, 3, [70, 56, 42]);
        for (const [cx, cy, cr] of clumps) for (let k = 0; k < 130; k++) {
            const a = r() * Math.PI * 2, d = Math.sqrt(r()) * cr, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
            const shade = 0.7 + (1 - y / 512) * 0.35 + (1 - d / cr) * 0.1 + r() * 0.15;
            blob(3, x, y, 10 + r() * 5, 5 + r() * 3, r() * Math.PI, [56 * shade, 86 * shade, 38 * shade]);
        }
    }
    // Bleed card colour into transparent texels.
    for (let ci = 0; ci < 4; ci++) {
        const { x0, y0 } = cell(ci); const sum = [0, 0, 0]; let n = 0;
        for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const i = ((y0 + y) * W + x0 + x) * 4; if (data[i + 3]) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; n++; } }
        for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const i = ((y0 + y) * W + x0 + x) * 4; if (!data[i + 3]) for (let c = 0; c < 3; c++) data[i + c] = Math.round((sum[c] / Math.max(1, n)) * 0.75); }
    }
    return { width: W, height: W, data };
}

/** UV rectangle of a foliage card in the atlas. */
const CARD: Record<Species, number> = { fir: 0, cedar: 1, maple: 2, oak: 3, street: 3 };
// Mesh v runs bottom-up (the KN5 writer stores -v, so v = 1 is the image's top row).
const cardUv = (ci: number) => ({ u0: (ci % 2) * 0.5 + 0.004, v0: 1 - (Math.floor(ci / 2) * 0.5 + 0.496), u1: (ci % 2) * 0.5 + 0.496, v1: 1 - (Math.floor(ci / 2) * 0.5 + 0.004) });

// ---------------------------------------------------------------- models

/** A tree model: triangles in local metres (base at the origin, y up), split into bark and foliage. */
export interface TreeModel {
    species: Species;
    height: number;
    width: number;
    bark: Quad[];
    leaves: Quad[];
}

/** A quad: corners, per-corner shading normals and uv, and the side it faces (decides the winding). */
export interface Quad { p: V3[]; n: V3[]; uv: [number, number][]; facing: V3 }
type Buf = Quad[];
const empty = (): Buf => [];

function quad(b: Buf, c: V3[], n: V3[], uv: [number, number][], facing: V3) { b.push({ p: c, n, uv, facing }); }
/** A tapered prism (trunk or limb) from a to b, `sides` faces. */
function limb(b: Buf, a: V3, e: V3, r0: number, r1: number, sides = 6, vScale = 1) {
    const t = norm(sub(e, a)), side = norm(Math.abs(t[1]) > 0.95 ? cross(t, [1, 0, 0]) : cross(t, [0, 1, 0])), up = cross(side, t);
    const L = Math.hypot(...sub(e, a));
    for (let k = 0; k < sides; k++) {
        const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
        const dir = (ang: number): V3 => add(scale(side, Math.cos(ang)), scale(up, Math.sin(ang)));
        const d0 = dir(a0), d1 = dir(a1);
        quad(b, [add(a, scale(d0, r0)), add(a, scale(d1, r0)), add(e, scale(d1, r1)), add(e, scale(d0, r1))], [d0, d1, d1, d0],
            [[k / sides, 0], [(k + 1) / sides, 0], [(k + 1) / sides, (L / 2) * vScale], [k / sides, (L / 2) * vScale]], norm(add(d0, d1)));
    }
}
function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a: V3, b: V3): V3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a: V3, k: number): V3 { return [a[0] * k, a[1] * k, a[2] * k]; }
function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a: V3): V3 { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/**
 * A foliage card: quad from `root` along `dir` (length L, width w), tilted by `droop`, both faces. Normals point
 * out from the crown centre (soft, volumetric lighting, as game trees do).
 */
function card(b: Buf, root: V3, dir: V3, L: number, w: number, ci: number, crownC: V3, rollUp = 0) {
    const d = norm(dir);
    let side = norm(cross(d, [0, 1, 0]));
    if (Math.hypot(...side) < 1e-6) side = [1, 0, 0];
    // Roll the card so it isn't always horizontal.
    const up = norm(cross(side, d));
    const s2 = norm(add(scale(side, Math.cos(rollUp)), scale(up, Math.sin(rollUp))));
    const c = [add(root, scale(s2, -w / 2)), add(add(root, scale(d, L)), scale(s2, -w / 2)), add(add(root, scale(d, L)), scale(s2, w / 2)), add(root, scale(s2, w / 2))] as V3[];
    const nrm = c.map((q) => norm(add(sub(q, crownC), [0, 0.35 * Math.hypot(...sub(q, crownC)), 0])));
    const { u0, v0, u1, v1 } = cardUv(ci);
    // u runs along the card (twig base at u0), v across.
    const uv: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const pn = norm(cross(d, s2));
    quad(b, c, nrm, uv, pn);
    quad(b, c, nrm, uv, scale(pn, -1));
}

/** A foliage card facing `out` (both faces), centred on `c`, spun about `out`; normals from the crown centre. */
function facingCard(b: Buf, c: V3, out: V3, size: number, ci: number, crownC: V3, spin: number) {
    const o = norm(out), t0 = norm(Math.abs(o[1]) > 0.9 ? cross(o, [1, 0, 0]) : cross(o, [0, 1, 0])), t1 = cross(o, t0);
    const ax = add(scale(t0, Math.cos(spin)), scale(t1, Math.sin(spin))), ay = cross(o, ax), h = size / 2;
    const p: V3[] = [add(c, add(scale(ax, -h), scale(ay, -h))), add(c, add(scale(ax, h), scale(ay, -h))), add(c, add(scale(ax, h), scale(ay, h))), add(c, add(scale(ax, -h), scale(ay, h)))];
    const nrm = p.map((q) => norm(add(sub(q, crownC), [0, 0.35 * Math.hypot(...sub(q, crownC)), 0])));
    const { u0, v0, u1, v1 } = cardUv(ci);
    const uv: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    quad(b, p, nrm, uv, o);
    quad(b, p, nrm, uv, scale(o, -1));
}

/** A tree model of a species and nominal height (deterministic for a seed). */
export function treeModel(species: Species, height: number, seed: number): TreeModel {
    const r = rng(seed * 7919 + species.length * 131);
    const bark = empty(), leaves = empty(), H = height;
    const ci = CARD[species];
    let width = 0;
    if (species === 'fir' || species === 'cedar') {
        const cedar = species === 'cedar';
        const crownBase = H * (cedar ? 0.06 : 0.18), rTrunk = H * (cedar ? 0.024 : 0.018);
        limb(bark, [0, -0.3, 0], [0, H * 0.96, 0], rTrunk * (cedar ? 1.5 : 1.15), rTrunk * 0.15, 7, 1);
        const whorlStep = H * (cedar ? 0.05 : 0.065);
        for (let y = crownBase; y < H * 0.97; y += whorlStep * (0.85 + r() * 0.3)) {
            const t = (y - crownBase) / (H - crownBase); // 0 bottom .. 1 top
            const reach = H * (cedar ? 0.24 : 0.235) * (1 - t) ** 0.85 + H * 0.03;
            width = Math.max(width, reach * 2);
            const n = t > 0.85 ? 3 : cedar ? 6 : 5, phase = r() * Math.PI * 2;
            for (let k = 0; k < n; k++) {
                const a = phase + (k / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
                const droop = cedar ? -0.45 - 0.2 * (1 - t) : -0.18 - 0.15 * (1 - t);
                const dir: V3 = [Math.cos(a), droop + 0.3 * t, Math.sin(a)];
                const root: V3 = [Math.cos(a) * rTrunk, y, Math.sin(a) * rTrunk];
                // Two cards per branch: one flat-ish, one rolled, giving the spray depth.
                card(leaves, root, dir, reach, reach * (cedar ? 0.62 : 0.75), ci, [0, y + reach * 0.2, 0], (r() - 0.5) * 0.6);
                if (t < 0.85) card(leaves, add(root, scale(norm(dir), reach * 0.15)), dir, reach * 0.85, reach * 0.5, ci, [0, y, 0], 1.2 + (r() - 0.5) * 0.4);
                if (t < 0.6 && reach > H * 0.06) limb(bark, root, add(root, scale(norm(dir), reach * 0.6)), rTrunk * 0.25, rTrunk * 0.08, 4, 1);
            }
        }
        // Leader: crossed cards at the tip.
        for (const a of [0, Math.PI / 2]) card(leaves, [0, H * 0.9, 0], [Math.cos(a) * 0.15, 1, Math.sin(a) * 0.15], H * 0.1, H * 0.05, ci, [0, H * 0.9, 0], 0);
    } else {
        // Broadleaf: trunk to a fork, a few main limbs, crown of leaf-cluster cards on an ellipsoid shell.
        const oak = species === 'oak', street = species === 'street';
        const forkY = H * (oak ? 0.32 : street ? 0.38 : 0.4), rTrunk = H * (oak ? 0.04 : street ? 0.022 : 0.03);
        const crownC: V3 = [0, H * (oak ? 0.6 : street ? 0.66 : 0.64), 0];
        const rx = H * (oak ? 0.48 : street ? 0.3 : 0.38), ry = H * (oak ? 0.34 : street ? 0.32 : 0.36);
        width = rx * 2;
        limb(bark, [0, -0.3, 0], [0, forkY, 0], rTrunk * 1.2, rTrunk * 0.9, 7, 1);
        const limbs = oak ? 5 : street ? 3 : 4;
        const tips: V3[] = [];
        for (let k = 0; k < limbs; k++) {
            const a = (k / limbs) * Math.PI * 2 + r() * 0.6;
            const tip: V3 = [Math.cos(a) * rx * 0.55, crownC[1] + (r() - 0.3) * ry * 0.6, Math.sin(a) * rx * 0.55];
            const mid: V3 = [tip[0] * 0.45 + (oak ? (r() - 0.5) * rx * 0.3 : 0), forkY + (tip[1] - forkY) * 0.5, tip[2] * 0.45 + (oak ? (r() - 0.5) * rx * 0.3 : 0)];
            limb(bark, [0, forkY - 0.2, 0], mid, rTrunk * 0.8, rTrunk * 0.5, 5, 1);
            limb(bark, mid, tip, rTrunk * 0.5, rTrunk * 0.15, 5, 1);
            tips.push(tip);
        }
        // Crown: cards facing out on nested shells (outer bias, so it reads full but not hollow), plus clusters at
        // the limb tips. Flattened at the bottom, as real crowns are.
        const n = oak ? 46 : street ? 34 : 40;
        for (let k = 0; k < n; k++) {
            const u = r() * Math.PI * 2, v = Math.acos(1 - r() * 1.75);
            const dirOut: V3 = [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)];
            const shell = 0.55 + 0.4 * Math.sqrt(r());
            const pos: V3 = [crownC[0] + dirOut[0] * rx * shell, crownC[1] + dirOut[1] * ry * shell * (dirOut[1] < 0 ? 0.6 : 1), crownC[2] + dirOut[2] * rx * shell];
            const size = H * (oak ? 0.2 : street ? 0.18 : 0.22) * (0.8 + r() * 0.4);
            const tilt = norm(add(dirOut, [(r() - 0.5) * 0.8, (r() - 0.5) * 0.6, (r() - 0.5) * 0.8]));
            facingCard(leaves, pos, tilt, size, ci, crownC, r() * Math.PI * 2);
        }
        for (const tip of tips) for (let k = 0; k < 3; k++) {
            const out = norm(add(sub(tip, crownC), [(r() - 0.5) * 2, r(), (r() - 0.5) * 2]));
            facingCard(leaves, add(tip, scale(out, H * 0.05)), out, H * 0.2, ci, crownC, r() * 6.28);
        }
        void tips;
    }
    return { species, height: H, width, bark, leaves };
}

// ---------------------------------------------------------------- billboards rendered from the models

/**
 * Billboard atlas, 2048 x 1024: eight 512 x 512 cells (fir, cedar, maple, oak, street, then a second fir, cedar
 * and maple variant), each a side view of the model rendered in software with the foliage atlas and simple
 * lighting. Cell covers width = height of the tree, base at the bottom edge.
 */
export const BILLBOARD_CELLS: { species: Species; seed: number }[] = [
    { species: 'fir', seed: 1 }, { species: 'cedar', seed: 1 }, { species: 'maple', seed: 1 }, { species: 'oak', seed: 1 },
    { species: 'street', seed: 1 }, { species: 'fir', seed: 2 }, { species: 'cedar', seed: 2 }, { species: 'maple', seed: 2 },
];

/** A billboard cell spans this times the tree's height, square, base on the bottom edge. */
export const BB_FRAME = 1.2;

export function billboardAtlas(foliage: Rgba = foliageAtlas()): Rgba {
    const CW = 512, W = CW * 4, H = CW * 2;
    const data = new Uint8Array(W * H * 4);
    const depth = new Float32Array(W * H).fill(Infinity);
    const bark: [number, number, number] = [86, 70, 56];
    const light = norm([-0.45, 0.75, -0.5]);
    BILLBOARD_CELLS.forEach(({ species, seed }, k) => {
        const m = treeModel(species, 20, seed);
        const ox = (k % 4) * CW, oy = Math.floor(k / 4) * CW;
        const toPx = (p: number, q: number): [number, number] => [ox + CW / 2 + (p / (20 * BB_FRAME)) * CW, oy + CW - 2 - (q / (20 * BB_FRAME)) * (CW - 4)];
        const raster = (b: Buf, leavesTex: boolean) => {
            for (const q of b) for (const tri of [[0, 1, 2], [0, 2, 3]]) {
                const V = tri.map((i) => q.p[i]), N = tri.map((i) => q.n[i]), UV = tri.map((i) => q.uv[i]);
                const P = V.map((v) => toPx(v[0], v[1]));
                const Z = V.map((v) => v[2]);
                const minX = Math.max(ox, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), maxX = Math.min(ox + CW - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
                const minY = Math.max(oy, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), maxY = Math.min(oy + CW - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
                const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]);
                if (Math.abs(den) < 1e-9) continue;
                for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
                    const w0 = ((P[1][1] - P[2][1]) * (x + 0.5 - P[2][0]) + (P[2][0] - P[1][0]) * (y + 0.5 - P[2][1])) / den;
                    const w1 = ((P[2][1] - P[0][1]) * (x + 0.5 - P[2][0]) + (P[0][0] - P[2][0]) * (y + 0.5 - P[2][1])) / den;
                    const w2 = 1 - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    const z = w0 * Z[0] + w1 * Z[1] + w2 * Z[2], pi = y * W + x;
                    if (z >= depth[pi]) continue;
                    const nrm = norm([0, 1, 2].map((c) => w0 * N[0][c] + w1 * N[1][c] + w2 * N[2][c]) as V3);
                    let col: number[];
                    if (leavesTex) {
                        const u = w0 * UV[0][0] + w1 * UV[1][0] + w2 * UV[2][0], v = w0 * UV[0][1] + w1 * UV[1][1] + w2 * UV[2][1];
                        const tx = Math.min(foliage.width - 1, Math.max(0, Math.floor(u * foliage.width))), ty = Math.min(foliage.height - 1, Math.max(0, Math.floor((1 - v) * foliage.height)));
                        const fi = (ty * foliage.width + tx) * 4;
                        if (foliage.data[fi + 3] < 128) continue;
                        col = [foliage.data[fi], foliage.data[fi + 1], foliage.data[fi + 2]];
                    } else col = bark;
                    const lit = 0.62 + 0.5 * Math.max(0, nrm[0] * light[0] + nrm[1] * light[1] + nrm[2] * light[2]);
                    depth[pi] = z;
                    data[pi * 4] = clamp(col[0] * lit); data[pi * 4 + 1] = clamp(col[1] * lit); data[pi * 4 + 2] = clamp(col[2] * lit); data[pi * 4 + 3] = 255;
                }
            }
        };
        raster(m.bark, false);
        raster(m.leaves, true);
        // Bleed into transparent texels.
        const sum = [0, 0, 0]; let n = 0;
        for (let y = oy; y < oy + CW; y++) for (let x = ox; x < ox + CW; x++) { const i = (y * W + x) * 4; if (data[i + 3]) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; n++; } }
        for (let y = oy; y < oy + CW; y++) for (let x = ox; x < ox + CW; x++) { const i = (y * W + x) * 4; if (!data[i + 3]) for (let c = 0; c < 3; c++) data[i + c] = Math.round((sum[c] / Math.max(1, n)) * 0.8); }
    });
    return { width: W, height: H, data };
}

/** Cell index in the billboard atlas for a species (two variants for fir, cedar and maple). */
export function billboardCell(species: Species, pick: number): number {
    const cells = BILLBOARD_CELLS.map((c, k) => ({ ...c, k })).filter((c) => c.species === species);
    return cells[Math.floor(pick * cells.length) % cells.length].k;
}

// ---------------------------------------------------------------- placing trees

export interface PlacedTree { x: number; z: number; y: number; h: number; species: Species; seed: number; /** 3D model (near the road) or billboard only. */ model: boolean; distM: number }

const CHUNK = 96;
const MODEL_OUT = 230, BILLBOARD_IN = 200;

/**
 * Meshes for placed trees: 3D models (bark + foliage) for `model` trees, chunked so they drop out beyond ~230 m,
 * where billboards take over; billboards for every tree, those for modelled trees only drawn beyond ~200 m.
 */
export function treeMeshes(trees: PlacedTree[], book: MaterialBook, lib: MaterialLibrary | undefined): MeshPart[] {
    if (!trees.length) return [];
    const barkMat = photoMaterial(book, lib, 'tree_bark', 'bark');
    const foliageTex = book.image('tree_foliage.dds', foliageAtlas, { format: 'bc3', mips: 'cutout' });
    const foliageMat = book.add({
        name: 'tree_foliage', shader: 'ksPerPixelAT', alphaTested: true,
        properties: [{ name: 'ksAmbient', a: 0.55 }, { name: 'ksDiffuse', a: 0.5 }, { name: 'ksSpecular', a: 0 }, { name: 'ksSpecularEXP', a: 1 }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0.5 }],
        textures: [{ sampler: 'txDiffuse', slot: 0, texture: foliageTex }],
    });
    const bbTex = book.image('tree_billboards.dds', () => billboardAtlas(), { format: 'bc3', mips: 'cutout' });
    const bbMat = book.add({
        name: 'tree_billboard', shader: 'ksPerPixelAT', alphaTested: true,
        properties: [{ name: 'ksAmbient', a: 0.55 }, { name: 'ksDiffuse', a: 0.45 }, { name: 'ksSpecular', a: 0 }, { name: 'ksSpecularEXP', a: 1 }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0.5 }],
        textures: [{ sampler: 'txDiffuse', slot: 0, texture: bbTex }],
    });
    const meshes = new Map<string, Mesh>();
    const mesh = (kind: string, x: number, z: number, mat: string, flags: { castShadows?: boolean } = {}) => {
        const k = `${kind}_${Math.floor(x / CHUNK)}_${Math.floor(z / CHUNK)}`.replace(/-/g, 'm');
        let m = meshes.get(k);
        if (!m) meshes.set(k, (m = new Mesh(k, mat, flags)));
        return m;
    };
    // Templates per (species, seed): a few variants each, scaled per tree.
    const templates = new Map<string, TreeModel>();
    const template = (sp: Species, seed: number) => { const key = `${sp}${seed}`; let t = templates.get(key); if (!t) templates.set(key, (t = treeModel(sp, 20, seed))); return t; };
    for (const t of trees) {
        const rot = ((t.seed * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
        const cos = Math.cos(rot), sin = Math.sin(rot), k = t.h / 20;
        if (t.model) {
            const tm = template(t.species, (t.seed % 3) + 1);
            for (const [buf, kind, mat] of [[tm.bark, 'TREE3D_BARK', barkMat], [tm.leaves, 'TREE3D_LEAVES', foliageMat]] as const) {
                const m = mesh(kind, t.x, t.z, mat, { castShadows: true });
                // Append the template rotated about y, scaled and moved (a proper rotation keeps the winding).
                const tf = (v: V3): V3 => [t.x + (v[0] * cos - v[2] * sin) * k, t.y + v[1] * k, t.z + (v[0] * sin + v[2] * cos) * k];
                const rn = (v: V3): V3 => [v[0] * cos - v[2] * sin, v[1], v[0] * sin + v[2] * cos];
                for (const q of buf) m.faceN(q.p.map(tf), rn(q.facing), q.uv, q.n.map(rn));
            }
        }
        // Billboard: two crossed double-sided quads, normals up so foliage lights evenly.
        const cellK = billboardCell(t.species, ((t.seed * 40503) % 1000) / 1000);
        // Cell row r covers image rows r/2 .. (r+1)/2 from the top; mesh v is bottom-up.
        const u0 = (cellK % 4) * 0.25 + 0.001, u1 = (cellK % 4 + 1) * 0.25 - 0.001, row = Math.floor(cellK / 4), vBot = 1 - (row + 1) * 0.5 + 0.001, vTop = 1 - row * 0.5 - 0.001;
        const far = t.distM > 700;
        const bm = mesh(t.model ? 'TREEBB_NEAR' : far ? 'TREES_FAR' : 'TREES', t.x, t.z, bbMat, { castShadows: !far });
        const w = t.h * BB_FRAME, bh = t.h * BB_FRAME; // the cell is square and framed with headroom
        for (const a of [rot, rot + Math.PI / 2]) {
            const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2, pn: V3 = [-Math.sin(a), 0, Math.cos(a)];
            bm.double([[t.x - dx, t.y, t.z - dz], [t.x + dx, t.y, t.z + dz], [t.x + dx, t.y + bh, t.z + dz], [t.x - dx, t.y + bh, t.z - dz]], pn,
                [[u0, vBot], [u1, vBot], [u1, vTop], [u0, vTop]], undefined, [0, 1, 0]);
        }
    }
    const parts = [...meshes.values()].flatMap((m) => m.parts).filter((p) => p.indices.length);
    for (const p of parts) {
        if (p.name.startsWith('TREE3D_')) p.lodOut = MODEL_OUT;
        else if (p.name.startsWith('TREEBB_NEAR')) p.lodIn = BILLBOARD_IN;
        else if (p.name.startsWith('TREES_FAR')) p.lodOut = 3500;
    }
    return parts;
}
