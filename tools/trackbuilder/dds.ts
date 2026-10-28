// DDS textures for Assetto Corsa: BC1 (DXT1) and BC3 (DXT5) block compression with a full mip chain.
// AC samples DDS mipmaps, which is what keeps distant asphalt and grass from shimmering; PNGs have no mips.
// Pure TypeScript so the same code runs in the browser (admin page, worker) and in Node (CLI, tests).

export type DdsFormat = 'bc1' | 'bc3';
export type MipKind = 'color' | 'normal' | 'linear';

export interface Rgba { width: number; height: number; data: Uint8Array } // RGBA8, row-major

// ---------------------------------------------------------------- mipmaps

const toLin = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSrgb = (l: number) => { const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };

/** Half-size image (2x2 box filter). Colour maps average in linear light; normal maps renormalise. */
export function downsample(src: Rgba, kind: MipKind): Rgba {
    const w = Math.max(1, src.width >> 1), h = Math.max(1, src.height >> 1);
    const out = new Uint8Array(w * h * 4), s = src.data, sw = src.width;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const x0 = Math.min(src.width - 1, x * 2), x1 = Math.min(src.width - 1, x * 2 + 1);
        const y0 = Math.min(src.height - 1, y * 2), y1 = Math.min(src.height - 1, y * 2 + 1);
        const idx = [(y0 * sw + x0) * 4, (y0 * sw + x1) * 4, (y1 * sw + x0) * 4, (y1 * sw + x1) * 4];
        const o = (y * w + x) * 4;
        if (kind === 'color') {
            for (let c = 0; c < 3; c++) out[o + c] = toSrgb((toLin[s[idx[0] + c]] + toLin[s[idx[1] + c]] + toLin[s[idx[2] + c]] + toLin[s[idx[3] + c]]) / 4);
        } else if (kind === 'normal') {
            let nx = 0, ny = 0, nz = 0;
            for (const i of idx) { nx += s[i] / 127.5 - 1; ny += s[i + 1] / 127.5 - 1; nz += s[i + 2] / 127.5 - 1; }
            const l = Math.hypot(nx, ny, nz) || 1;
            out[o] = Math.round((nx / l + 1) * 127.5); out[o + 1] = Math.round((ny / l + 1) * 127.5); out[o + 2] = Math.round((nz / l + 1) * 127.5);
        } else {
            for (let c = 0; c < 3; c++) out[o + c] = (s[idx[0] + c] + s[idx[1] + c] + s[idx[2] + c] + s[idx[3] + c] + 2) >> 2;
        }
        out[o + 3] = (s[idx[0] + 3] + s[idx[1] + 3] + s[idx[2] + 3] + s[idx[3] + 3] + 2) >> 2;
    }
    return { width: w, height: h, data: out };
}

export function mipChain(img: Rgba, kind: MipKind): Rgba[] {
    const levels = [img];
    while (levels[levels.length - 1].width > 1 || levels[levels.length - 1].height > 1) levels.push(downsample(levels[levels.length - 1], kind));
    return levels;
}

// ---------------------------------------------------------------- block compression

const to565 = (r: number, g: number, b: number) => ((Math.round(r * 31 / 255) & 31) << 11) | ((Math.round(g * 63 / 255) & 63) << 5) | (Math.round(b * 31 / 255) & 31);
const from565 = (c: number): [number, number, number] => {
    const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
    return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
};

/** One BC1 colour block (always 4-colour mode). px = 16 RGB triples. Writes 8 bytes at out[o]. */
function encodeColorBlock(px: number[], out: Uint8Array, o: number) {
    // Principal axis of the 16 colours (power iteration on the covariance), endpoints = extreme projections.
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < 16; i++) { mr += px[i * 3]; mg += px[i * 3 + 1]; mb += px[i * 3 + 2]; }
    mr /= 16; mg /= 16; mb /= 16;
    let crr = 0, cgg = 0, cbb = 0, crg = 0, crb = 0, cgb = 0;
    for (let i = 0; i < 16; i++) {
        const r = px[i * 3] - mr, g = px[i * 3 + 1] - mg, b = px[i * 3 + 2] - mb;
        crr += r * r; cgg += g * g; cbb += b * b; crg += r * g; crb += r * b; cgb += g * b;
    }
    let ax = 1, ay = 1, az = 1;
    for (let k = 0; k < 4; k++) {
        const nx = crr * ax + crg * ay + crb * az, ny = crg * ax + cgg * ay + cgb * az, nz = crb * ax + cgb * ay + cbb * az;
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-6) break;
        ax = nx / l; ay = ny / l; az = nz / l;
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 16; i++) {
        const t = (px[i * 3] - mr) * ax + (px[i * 3 + 1] - mg) * ay + (px[i * 3 + 2] - mb) * az;
        if (t < lo) lo = t; if (t > hi) hi = t;
    }
    // Inset the endpoints slightly: reduces error from 565 quantisation at the extremes.
    const inset = (hi - lo) / 32;
    lo += inset; hi -= inset;
    const clamp = (v: number) => Math.max(0, Math.min(255, v));
    let c0 = to565(clamp(mr + ax * hi), clamp(mg + ay * hi), clamp(mb + az * hi));
    let c1 = to565(clamp(mr + ax * lo), clamp(mg + ay * lo), clamp(mb + az * lo));
    if (c0 < c1) [c0, c1] = [c1, c0];
    let indices = 0;
    if (c0 !== c1) {
        const p0 = from565(c0), p1 = from565(c1);
        const pal = [p0, p1, [(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3, (2 * p0[2] + p1[2]) / 3], [(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3, (p0[2] + 2 * p1[2]) / 3]];
        for (let i = 0; i < 16; i++) {
            let best = 0, bd = Infinity;
            for (let k = 0; k < 4; k++) {
                const dr = px[i * 3] - pal[k][0], dg = px[i * 3 + 1] - pal[k][1], db = px[i * 3 + 2] - pal[k][2];
                const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
                if (d < bd) { bd = d; best = k; }
            }
            indices |= best << (i * 2);
        }
    }
    out[o] = c0 & 255; out[o + 1] = c0 >> 8; out[o + 2] = c1 & 255; out[o + 3] = c1 >> 8;
    out[o + 4] = indices & 255; out[o + 5] = (indices >>> 8) & 255; out[o + 6] = (indices >>> 16) & 255; out[o + 7] = (indices >>> 24) & 255;
}

/** One BC3 alpha block (8-value mode). a = 16 alphas. Writes 8 bytes. */
function encodeAlphaBlock(a: number[], out: Uint8Array, o: number) {
    let a0 = 0, a1 = 255;
    for (const v of a) { if (v > a0) a0 = v; if (v < a1) a1 = v; }
    out[o] = a0; out[o + 1] = a1;
    const pal = [a0, a1];
    for (let k = 1; k < 7; k++) pal.push(((7 - k) * a0 + k * a1) / 7);
    let bits = 0n;
    if (a0 !== a1) for (let i = 0; i < 16; i++) {
        let best = 0, bd = Infinity;
        for (let k = 0; k < 8; k++) { const d = Math.abs(a[i] - pal[k]); if (d < bd) { bd = d; best = k; } }
        bits |= BigInt(best) << BigInt(i * 3);
    }
    for (let k = 0; k < 6; k++) out[o + 2 + k] = Number((bits >> BigInt(k * 8)) & 255n);
}

export function compress(img: Rgba, format: DdsFormat): Uint8Array {
    const bw = Math.max(1, Math.ceil(img.width / 4)), bh = Math.max(1, Math.ceil(img.height / 4));
    const bs = format === 'bc1' ? 8 : 16;
    const out = new Uint8Array(bw * bh * bs);
    const px: number[] = new Array(48), al: number[] = new Array(16);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
            const x = Math.min(img.width - 1, bx * 4 + i), y = Math.min(img.height - 1, by * 4 + j);
            const s = (y * img.width + x) * 4, k = j * 4 + i;
            px[k * 3] = img.data[s]; px[k * 3 + 1] = img.data[s + 1]; px[k * 3 + 2] = img.data[s + 2]; al[k] = img.data[s + 3];
        }
        const o = (by * bw + bx) * bs;
        if (format === 'bc3') { encodeAlphaBlock(al, out, o); encodeColorBlock(px, out, o + 8); }
        else encodeColorBlock(px, out, o);
    }
    return out;
}

// ---------------------------------------------------------------- DDS container

/** A DDS file with the full mip chain. Width and height should be powers of two. */
export function encodeDds(img: Rgba, opts: { format?: DdsFormat; mips?: MipKind | false } = {}): Uint8Array {
    const format = opts.format ?? 'bc1';
    const levels = opts.mips === false ? [img] : mipChain(img, opts.mips ?? 'color');
    const blocks = levels.map((l) => compress(l, format));
    const total = 128 + blocks.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    const u32 = (o: number, v: number) => dv.setUint32(o, v >>> 0, true);
    out.set([0x44, 0x44, 0x53, 0x20], 0); // "DDS "
    u32(4, 124); // header size
    u32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000 | (levels.length > 1 ? 0x20000 : 0)); // CAPS HEIGHT WIDTH PIXELFORMAT LINEARSIZE [MIPMAPCOUNT]
    u32(12, img.height); u32(16, img.width);
    u32(20, blocks[0].length); // linear size of the top level
    u32(24, 0); u32(28, levels.length);
    u32(76, 32); u32(80, 0x4); // pixel format: size, DDPF_FOURCC
    out.set(format === 'bc1' ? [0x44, 0x58, 0x54, 0x31] : [0x44, 0x58, 0x54, 0x35], 84); // DXT1 / DXT5
    u32(108, 0x1000 | (levels.length > 1 ? 0x400000 | 0x8 : 0)); // TEXTURE [MIPMAP COMPLEX]
    let o = 128;
    for (const b of blocks) { out.set(b, o); o += b.length; }
    return out;
}

/** Decode a BC1/BC3 DDS top level back to RGBA (tests and previews). */
export function decodeDds(buf: Uint8Array): { width: number; height: number; mips: number; format: DdsFormat; rgba: Uint8Array } {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (dv.getUint32(0, true) !== 0x20534444) throw new Error('not a DDS file');
    const height = dv.getUint32(12, true), width = dv.getUint32(16, true), mips = Math.max(1, dv.getUint32(28, true));
    const fourcc = String.fromCharCode(buf[84], buf[85], buf[86], buf[87]);
    if (fourcc !== 'DXT1' && fourcc !== 'DXT5') throw new Error(`unsupported DDS format ${fourcc}`);
    const format: DdsFormat = fourcc === 'DXT1' ? 'bc1' : 'bc3';
    const bs = format === 'bc1' ? 8 : 16;
    const bw = Math.max(1, Math.ceil(width / 4)), bh = Math.max(1, Math.ceil(height / 4));
    const rgba = new Uint8Array(width * height * 4);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
        const o = 128 + (by * bw + bx) * bs, co = format === 'bc3' ? o + 8 : o;
        const c0 = buf[co] | (buf[co + 1] << 8), c1 = buf[co + 2] | (buf[co + 3] << 8);
        const p0 = from565(c0), p1 = from565(c1);
        const pal = c0 > c1
            ? [p0, p1, p0.map((v, k) => (2 * v + p1[k]) / 3), p0.map((v, k) => (v + 2 * p1[k]) / 3)]
            : [p0, p1, p0.map((v, k) => (v + p1[k]) / 2), [0, 0, 0]];
        const idx = buf[co + 4] | (buf[co + 5] << 8) | (buf[co + 6] << 16) | (buf[co + 7] << 24);
        let alphas: number[] | null = null;
        if (format === 'bc3') {
            const a0 = buf[o], a1 = buf[o + 1];
            const ap = a0 > a1 ? [a0, a1, ...[1, 2, 3, 4, 5, 6].map((k) => ((7 - k) * a0 + k * a1) / 7)] : [a0, a1, ...[1, 2, 3, 4].map((k) => ((5 - k) * a0 + k * a1) / 5), 0, 255];
            let bits = 0n;
            for (let k = 0; k < 6; k++) bits |= BigInt(buf[o + 2 + k]) << BigInt(k * 8);
            alphas = Array.from({ length: 16 }, (_, i) => ap[Number((bits >> BigInt(i * 3)) & 7n)]);
        }
        for (let i = 0; i < 16; i++) {
            const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
            if (x >= width || y >= height) continue;
            const c = pal[(idx >>> (i * 2)) & 3], d = (y * width + x) * 4;
            rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2]; rgba[d + 3] = alphas ? alphas[i] : 255;
        }
    }
    return { width, height, mips, format, rgba };
}

/** Resize to w x h (bilinear, wraps for tiling textures). For bringing photo textures to power-of-two sizes. */
export function resize(src: Rgba, w: number, h: number, wrap = true): Rgba {
    if (src.width === w && src.height === h) return src;
    // Box-filter down by halves first when shrinking a lot, then bilinear for the remainder.
    let s = src;
    while (s.width >= w * 2 && s.height >= h * 2) s = downsample(s, 'linear');
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const fx = ((x + 0.5) * s.width) / w - 0.5, fy = ((y + 0.5) * s.height) / h - 0.5;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const px = (xx: number, yy: number) => {
            const X = wrap ? ((xx % s.width) + s.width) % s.width : Math.max(0, Math.min(s.width - 1, xx));
            const Y = wrap ? ((yy % s.height) + s.height) % s.height : Math.max(0, Math.min(s.height - 1, yy));
            return (Y * s.width + X) * 4;
        };
        const a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), d = px(x0 + 1, y0 + 1), o = (y * w + x) * 4;
        for (let k = 0; k < 4; k++) out[o + k] = Math.round((s.data[a + k] * (1 - tx) + s.data[b + k] * tx) * (1 - ty) + (s.data[c + k] * (1 - tx) + s.data[d + k] * tx) * ty);
    }
    return { width: w, height: h, data: out };
}
