// Minimal PNG encode (RGBA8) and decode (8-bit gray/RGB/RGBA, non-interlaced). No DOM needed.

import { unzlibSync, zlibSync } from 'fflate';

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

export interface RGBAImage { width: number; height: number; data: Uint8Array } // RGBA, row-major

export function makeImage(width: number, height: number, fill: [number, number, number, number] = [0, 0, 0, 0]): RGBAImage {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
    return { width, height, data };
}

export function encodePNG(img: RGBAImage): Uint8Array {
    const { width, height, data } = img;
    const raw = new Uint8Array((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0;
        raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
    }
    const idat = zlibSync(raw, { level: 6 });
    const chunks: Uint8Array[] = [];
    const chunk = (type: string, body: Uint8Array) => {
        const c = new Uint8Array(12 + body.length);
        const dv = new DataView(c.buffer);
        dv.setUint32(0, body.length);
        for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
        c.set(body, 8);
        dv.setUint32(8 + body.length, crc32(c, 4, 8 + body.length));
        chunks.push(c);
    };
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width); dv.setUint32(4, height);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    chunk('IHDR', ihdr);
    chunk('IDAT', idat);
    chunk('IEND', new Uint8Array(0));
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const total = sig.length + chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    out.set(sig, 0);
    let o = sig.length;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
}

/** Decode to RGBA8. Supports bit depth 8, colour types 0 (gray), 2 (RGB), 4 (gray+alpha), 6 (RGBA), 3 (palette). */
export function decodePNG(bytes: Uint8Array): RGBAImage {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('Not a PNG');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
    const idat: Uint8Array[] = [];
    let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
    while (o < bytes.length) {
        const len = dv.getUint32(o);
        const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
        const body = bytes.subarray(o + 8, o + 8 + len);
        if (type === 'IHDR') {
            width = dv.getUint32(o + 8); height = dv.getUint32(o + 12);
            depth = body[8]; ctype = body[9]; interlace = body[12];
        } else if (type === 'PLTE') palette = body;
        else if (type === 'tRNS') trns = body;
        else if (type === 'IDAT') idat.push(body);
        else if (type === 'IEND') break;
        o += 12 + len;
    }
    if (depth !== 8 || interlace !== 0) throw new Error(`Unsupported PNG (depth ${depth}, interlace ${interlace})`);
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
    if (!channels) throw new Error(`Unsupported PNG colour type ${ctype}`);
    const joined = new Uint8Array(idat.reduce((a, c) => a + c.length, 0));
    let p = 0;
    for (const c of idat) { joined.set(c, p); p += c.length; }
    const raw = unzlibSync(joined);
    const stride = width * channels;
    const pix = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const f = raw[y * (stride + 1)];
        const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const dst = pix.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? pix.subarray((y - 1) * stride, y * stride) : null;
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? dst[x - channels] : 0;
            const b = prev ? prev[x] : 0;
            const c = prev && x >= channels ? prev[x - channels] : 0;
            let v = src[x];
            if (f === 1) v += a;
            else if (f === 2) v += b;
            else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) {
                const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
                v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            dst[x] = v & 0xff;
        }
    }
    const out = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        if (ctype === 6) out.set(pix.subarray(i * 4, i * 4 + 4), i * 4);
        else if (ctype === 2) { out[i * 4] = pix[i * 3]; out[i * 4 + 1] = pix[i * 3 + 1]; out[i * 4 + 2] = pix[i * 3 + 2]; out[i * 4 + 3] = 255; }
        else if (ctype === 0) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = pix[i]; out[i * 4 + 3] = 255; }
        else if (ctype === 4) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = pix[i * 2]; out[i * 4 + 3] = pix[i * 2 + 1]; }
        else if (ctype === 3) {
            const k = pix[i];
            out[i * 4] = palette![k * 3]; out[i * 4 + 1] = palette![k * 3 + 1]; out[i * 4 + 2] = palette![k * 3 + 2];
            out[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255;
        }
    }
    return { width, height, data: out };
}

/** Stamp a filled disc (for drawing thick lines into images). */
export function stampDisc(img: RGBAImage, cx: number, cy: number, r: number, rgba: [number, number, number, number]) {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(img.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(img.height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) img.data.set(rgba, (y * img.width + x) * 4);
    }
}

export function drawPolyline(img: RGBAImage, pts: { x: number; y: number }[], r: number, rgba: [number, number, number, number]) {
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(0.5, r / 2)));
        for (let k = 0; k <= steps; k++) stampDisc(img, a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps, r, rgba);
    }
}
