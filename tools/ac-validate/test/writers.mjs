// Minimal writers used ONLY to produce fixtures for the validator's self-test.
// They mirror the format as this project understands it (see lib/kn5.mjs, lib/ai.mjs).
import zlib from 'node:zlib';

class W {
  constructor() { this.parts = []; }
  buf(b) { this.parts.push(Buffer.from(b)); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); this.parts.push(b); }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v); this.parts.push(b); }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); this.parts.push(b); }
  u8(v) { this.parts.push(Buffer.from([v])); }
  f32(v) { const b = Buffer.alloc(4); b.writeFloatLE(v); this.parts.push(b); }
  str(s) { const b = Buffer.from(s, 'utf8'); this.i32(b.length); this.parts.push(b); }
  done() { return Buffer.concat(this.parts); }
}

export const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

// node: { type: 'dummy', name, matrix, children } | { type: 'mesh', name, verts:[{p,n,uv,t}], indices, materialId }
export function writeKn5({ version = 6, textures = [], materials = [], root, magic = 'sc6969', rawVertexCount = null }) {
  const w = new W();
  w.buf(Buffer.from(magic, 'latin1'));
  w.i32(version);
  if (version > 5) w.i32(0);
  w.i32(textures.length);
  for (const t of textures) { w.i32(1); w.str(t.name); w.u32(t.data.length); w.buf(t.data); }
  w.i32(materials.length);
  for (const m of materials) {
    w.str(m.name); w.str(m.shader); w.u8(m.blend || 0); w.u8(m.alphaTested || 0); w.i32(m.depthMode || 0);
    w.i32(m.props.length);
    for (const p of m.props) {
      w.str(p.name); w.f32(p.a ?? 0);
      for (let i = 0; i < 9; i++) w.f32(0);
    }
    w.i32(m.mappings.length);
    for (const x of m.mappings) { w.str(x.name); w.i32(x.slot); w.str(x.texture); }
  }
  const node = (n) => {
    w.i32(n.type === 'dummy' ? 1 : 2);
    w.str(n.name);
    w.i32((n.children || []).length);
    w.u8(1);
    if (n.type === 'dummy') (n.matrix || IDENT).forEach((v) => w.f32(v));
    else {
      w.u8(1); w.u8(1); w.u8(0);
      w.u32(n.vertexCountOverride ?? n.verts.length);
      for (const v of n.verts) {
        v.p.forEach((x) => w.f32(x)); (v.n || [0, 1, 0]).forEach((x) => w.f32(x));
        (v.uv || [0, 0]).forEach((x) => w.f32(x)); (v.t || [1, 0, 0]).forEach((x) => w.f32(x));
      }
      w.u32(n.indices.length);
      n.indices.forEach((i) => w.u16(i));
      w.u32(n.materialId || 0); w.u32(0); w.f32(0); w.f32(0);
      // bounding sphere
      const c = [0, 0, 0];
      n.verts.forEach((v) => { for (let k = 0; k < 3; k++) c[k] += v.p[k] / n.verts.length; });
      let r = 0;
      n.verts.forEach((v) => { r = Math.max(r, Math.hypot(v.p[0] - c[0], v.p[1] - c[1], v.p[2] - c[2])); });
      c.forEach((x) => w.f32(Number.isFinite(x) ? x : 0)); w.f32(Number.isFinite(r) ? r + 0.01 : 1);
      w.u8(1);
    }
    (n.children || []).forEach(node);
  };
  node(root);
  return w.done();
}

// points: [{p:[x,y,z], length, side:[l,r], speed}]
export function writeAi(points, { version = 7, extra = true, gridFlag = true } = {}) {
  const w = new W();
  w.i32(version); w.i32(points.length); w.i32(0); w.i32(points.length);
  points.forEach((pt, i) => { pt.p.forEach((x) => w.f32(x)); w.f32(pt.length); w.i32(pt.id ?? i); });
  if (extra) {
    w.i32(points.length);
    for (const pt of points) {
      const f = new Array(18).fill(0);
      f[0] = pt.speed ?? 30; f[1] = 1; f[5] = pt.side?.[0] ?? 5; f[6] = pt.side?.[1] ?? 5;
      f[10] = 1; f[12] = pt.length;
      f.forEach((x) => w.f32(x));
    }
    if (gridFlag) w.i32(0);
  }
  return w.done();
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function writePng(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// files: [{ name, data }] -> zip buffer (deflate)
export function writeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
