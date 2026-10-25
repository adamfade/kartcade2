// KN5 writer (Assetto Corsa model container), layout as read by Content Manager / community kn5 tools:
//   "sc6969" | int32 version | textures | materials | node tree
// Strings are int32 length + UTF-8. Booleans are one byte. Little-endian throughout.

import type { Dummy, MeshPart } from './mesh.ts';

export interface Kn5Texture { name: string; data: Uint8Array }
export interface Kn5Material {
    name: string;
    shader: string; // e.g. ksPerPixel
    blendMode?: number; // 0 opaque
    alphaTested?: boolean;
    depthMode?: number;
    properties: { name: string; a?: number; b?: [number, number]; c?: [number, number, number]; d?: [number, number, number, number] }[];
    textures: { sampler: string; slot: number; texture: string }[];
}

class Writer {
    buf = new Uint8Array(1 << 20);
    len = 0;
    private dv = new DataView(this.buf.buffer);
    private need(n: number) {
        if (this.len + n <= this.buf.length) return;
        let cap = this.buf.length * 2;
        while (cap < this.len + n) cap *= 2;
        const nb = new Uint8Array(cap);
        nb.set(this.buf.subarray(0, this.len));
        this.buf = nb; this.dv = new DataView(nb.buffer);
    }
    u8(v: number) { this.need(1); this.buf[this.len++] = v & 0xff; }
    bool(v: boolean) { this.u8(v ? 1 : 0); }
    i32(v: number) { this.need(4); this.dv.setInt32(this.len, v, true); this.len += 4; }
    u16(v: number) { this.need(2); this.dv.setUint16(this.len, v, true); this.len += 2; }
    f32(v: number) { this.need(4); this.dv.setFloat32(this.len, v, true); this.len += 4; }
    bytes(b: Uint8Array) { this.need(b.length); this.buf.set(b, this.len); this.len += b.length; }
    str(s: string) { const b = new TextEncoder().encode(s); this.i32(b.length); this.bytes(b); }
    raw(s: string) { this.bytes(new TextEncoder().encode(s)); }
    out() { return this.buf.slice(0, this.len); }
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Row-major 4x4, DirectX style: rows are the X (right), Y (up), Z (forward) axes, last row = translation. */
export function dummyMatrix(d: Dummy): number[] {
    const f = d.forward;
    const fl = Math.hypot(f[0], f[1], f[2]) || 1;
    const z: [number, number, number] = [f[0] / fl, f[1] / fl, f[2] / fl];
    const y: [number, number, number] = [0, 1, 0];
    // Left-handed: X = Y x Z.
    const x: [number, number, number] = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
    return [...x, 0, ...y, 0, ...z, 0, ...d.position, 1];
}

export function writeKn5(opts: { textures: Kn5Texture[]; materials: Kn5Material[]; meshes: MeshPart[]; dummies: Dummy[]; version?: number }): Uint8Array {
    const w = new Writer();
    const version = opts.version ?? 5;
    w.raw('sc6969');
    w.i32(version);
    if (version > 5) w.i32(0);

    w.i32(opts.textures.length);
    for (const t of opts.textures) { w.i32(1); w.str(t.name); w.i32(t.data.length); w.bytes(t.data); }

    w.i32(opts.materials.length);
    for (const m of opts.materials) {
        w.str(m.name); w.str(m.shader);
        w.u8(m.blendMode ?? 0); w.bool(m.alphaTested ?? false); w.i32(m.depthMode ?? 0);
        w.i32(m.properties.length);
        for (const p of m.properties) {
            w.str(p.name);
            w.f32(p.a ?? 0);
            for (const v of p.b ?? [0, 0]) w.f32(v);
            for (const v of p.c ?? [0, 0, 0]) w.f32(v);
            for (const v of p.d ?? [0, 0, 0, 0]) w.f32(v);
        }
        w.i32(m.textures.length);
        for (const t of m.textures) { w.str(t.sampler); w.i32(t.slot); w.str(t.texture); }
    }

    const matIndex = new Map(opts.materials.map((m, i) => [m.name, i]));
    // Root dummy holding every mesh and dummy as children.
    w.i32(1); w.str(opts.dummies.length || opts.meshes.length ? 'TRACK_ROOT' : 'EMPTY');
    w.i32(opts.meshes.length + opts.dummies.length); w.bool(true);
    for (const v of IDENTITY) w.f32(v);

    for (const m of opts.meshes) {
        const vc = m.positions.length / 3;
        if (vc > 65535) throw new Error(`Mesh ${m.name} has ${vc} vertices (limit 65535)`);
        const mi = matIndex.get(m.material);
        if (mi == null) throw new Error(`Mesh ${m.name} uses unknown material ${m.material}`);
        w.i32(2); w.str(m.name); w.i32(0); w.bool(true);
        w.bool(true); w.bool(true); w.bool(false); // castShadows, isVisible, isTransparent
        w.i32(vc);
        let cx = 0, cy = 0, cz = 0;
        for (let v = 0; v < vc; v++) {
            const px = m.positions[v * 3], py = m.positions[v * 3 + 1], pz = m.positions[v * 3 + 2];
            cx += px; cy += py; cz += pz;
            w.f32(px); w.f32(py); w.f32(pz);
            w.f32(m.normals[v * 3]); w.f32(m.normals[v * 3 + 1]); w.f32(m.normals[v * 3 + 2]);
            w.f32(m.uvs[v * 2]); w.f32(-m.uvs[v * 2 + 1]);
            w.f32(m.tangents[v * 3]); w.f32(m.tangents[v * 3 + 1]); w.f32(m.tangents[v * 3 + 2]);
        }
        w.i32(m.indices.length);
        for (const i of m.indices) w.u16(i);
        w.i32(mi);
        w.i32(0); // layer
        w.f32(0); w.f32(0); // lodIn, lodOut (0 = always drawn)
        cx /= vc || 1; cy /= vc || 1; cz /= vc || 1;
        let r = 0;
        for (let v = 0; v < vc; v++) r = Math.max(r, Math.hypot(m.positions[v * 3] - cx, m.positions[v * 3 + 1] - cy, m.positions[v * 3 + 2] - cz));
        w.f32(cx); w.f32(cy); w.f32(cz); w.f32(r);
        w.bool(true); // isRenderable
    }
    for (const d of opts.dummies) {
        w.i32(1); w.str(d.name); w.i32(0); w.bool(true);
        for (const v of dummyMatrix(d)) w.f32(v);
    }
    return w.out();
}

/** Standard track materials: ksPerPixel with a diffuse texture. */
export function trackMaterials(): Kn5Material[] {
    const base = (name: string, tex: string, spec = 0.05): Kn5Material => ({
        name, shader: 'ksPerPixel',
        properties: [
            { name: 'ksAmbient', a: 0.45 }, { name: 'ksDiffuse', a: 0.55 }, { name: 'ksSpecular', a: spec },
            { name: 'ksSpecularEXP', a: 30 }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0 },
        ],
        textures: [{ sampler: 'txDiffuse', slot: 0, texture: tex }],
    });
    return [base('road', 'asphalt.png', 0.1), base('grass', 'grass.png', 0.02), base('wall', 'wall.png', 0.02)];
}
