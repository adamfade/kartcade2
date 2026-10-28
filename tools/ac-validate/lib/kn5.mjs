// KN5 reader (Assetto Corsa model container), written from community documentation of the format
// (the layout used by AcTools / Content Manager and kn5 converters). See README for confidence notes.
//
// Layout as understood:
//   "sc6969" magic (6 bytes), int32 version, [int32 unknown if version > 5]
//   int32 textureCount; per texture: int32 active, string name, uint32 size, size bytes (DDS/PNG)
//   int32 materialCount; per material:
//     string name, string shader, u8 alphaBlendMode, u8 alphaTested, int32 depthMode,
//     int32 propCount; per prop: string name, f32 A, f32[2] B, f32[3] C, f32[4] D
//     int32 mappingCount; per mapping: string slotName, int32 slot, string textureName
//   one root node, recursive:
//     int32 class (1 dummy, 2 mesh, 3 skinned mesh), string name, int32 childCount, u8 active
//     class 1: f32[16] local matrix (row-major, translation in [12..14])
//     class 2: u8 castShadows, u8 visible, u8 transparent, uint32 vertexCount,
//              vertex = pos f32[3], normal f32[3], uv f32[2], tangent f32[3] (44 bytes)
//              uint32 indexCount, uint16 indices, uint32 materialId, uint32 layer,
//              f32 lodIn, f32 lodOut, f32[3] bsphereCenter, f32 bsphereRadius, u8 renderable
//     class 3: u8 x3, int32 boneCount, per bone: string name, f32[16] bind matrix,
//              uint32 vertexCount, vertex 76 bytes (44 + weights f32[4] + boneIndices f32[4]),
//              uint32 indexCount, uint16 indices, uint32 materialId, uint32 layer, f32 lodIn, f32 lodOut
//     then childCount child nodes.

import { Reader, FormatError } from './binreader.mjs';

export { FormatError };

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// Row-vector convention: world = local * parent.
export function matMul(a, b) {
  const r = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
      r[i * 4 + j] = s;
    }
  }
  return r;
}

export function transformPoint(m, x, y, z) {
  return [
    x * m[0] + y * m[4] + z * m[8] + m[12],
    x * m[1] + y * m[5] + z * m[9] + m[13],
    x * m[2] + y * m[6] + z * m[10] + m[14],
  ];
}

const MAX_DEPTH = 512;

export function parseKn5(buf) {
  const r = new Reader(buf);
  const magic = r.bytes(6, 'magic').toString('latin1');
  if (magic !== 'sc6969') {
    throw new FormatError(`bad magic ${JSON.stringify(magic)}, expected "sc6969"`, 0);
  }
  const version = r.i32();
  let extraHeader = null;
  if (version > 5) extraHeader = r.i32();

  // Textures
  const textures = [];
  const texCount = r.count('texture', 12);
  for (let i = 0; i < texCount; i++) {
    const at = r.o;
    const active = r.i32();
    const name = r.str(`texture[${i}] name`);
    const size = r.u32();
    r.need(size, `texture "${name}" data`);
    const head = buf.subarray(r.o, r.o + Math.min(8, size));
    r.o += size;
    let kind = 'unknown';
    if (head.length >= 4 && head.toString('latin1', 0, 4) === 'DDS ') kind = 'dds';
    else if (head.length >= 8 && head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') kind = 'png';
    else if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8) kind = 'jpg';
    textures.push({ index: i, name, active, size, kind, offset: at });
  }

  // Materials
  const materials = [];
  const matCount = r.count('material', 18);
  for (let i = 0; i < matCount; i++) {
    const at = r.o;
    const name = r.str(`material[${i}] name`);
    const shader = r.str(`material "${name}" shader`);
    const alphaBlendMode = r.u8();
    const alphaTested = r.u8();
    const depthMode = r.i32();
    const propCount = r.count(`material "${name}" property`, 44);
    const props = [];
    for (let p = 0; p < propCount; p++) {
      const pname = r.str(`material "${name}" property name`);
      const a = r.f32();
      const b = [r.f32(), r.f32()];
      const c = [r.f32(), r.f32(), r.f32()];
      const d = [r.f32(), r.f32(), r.f32(), r.f32()];
      props.push({ name: pname, a, b, c, d });
    }
    const mapCount = r.count(`material "${name}" texture mapping`, 12);
    const mappings = [];
    for (let m = 0; m < mapCount; m++) {
      const slotName = r.str(`material "${name}" mapping name`);
      const slot = r.i32();
      const texture = r.str(`material "${name}" mapping texture`);
      mappings.push({ name: slotName, slot, texture });
    }
    materials.push({ index: i, name, shader, alphaBlendMode, alphaTested, depthMode, props, mappings, offset: at });
  }

  // Nodes
  const nodes = []; // flat list, depth-first
  const meshes = [];
  const readNode = (parentWorld, depth, parentPath) => {
    if (depth > MAX_DEPTH) throw new FormatError(`node tree deeper than ${MAX_DEPTH}`, r.o);
    const at = r.o;
    const cls = r.i32();
    const name = r.str('node name');
    const childCount = r.count(`node "${name}" child`, 0);
    if (childCount > 1_000_000) throw new FormatError(`node "${name}" has implausible child count ${childCount}`, at);
    const active = r.u8();
    const path = parentPath ? `${parentPath}/${name}` : name;
    const node = { cls, name, path, depth, childCount, active, offset: at };
    let world = parentWorld;
    if (cls === 1) {
      const m = new Array(16);
      for (let k = 0; k < 16; k++) m[k] = r.f32();
      node.matrix = m;
      world = matMul(m, parentWorld);
      node.world = world;
    } else if (cls === 2 || cls === 3) {
      const mesh = readMesh(r, cls, name, path);
      mesh.world = parentWorld;
      mesh.node = node;
      node.mesh = mesh;
      node.world = parentWorld;
      meshes.push(mesh);
    } else {
      throw new FormatError(`node "${name}" has unknown node class ${cls}`, at);
    }
    nodes.push(node);
    node.children = [];
    for (let c = 0; c < childCount; c++) node.children.push(readNode(world, depth + 1, path));
    return node;
  };
  const root = readNode(IDENTITY, 0, '');

  return {
    version,
    extraHeader,
    textures,
    materials,
    root,
    nodes,
    meshes,
    trailingBytes: r.remaining,
  };
}

function readMesh(r, cls, name, path) {
  const castShadows = r.u8();
  const visible = r.u8();
  const transparent = r.u8();
  const bones = [];
  if (cls === 3) {
    const boneCount = r.count(`skinned mesh "${name}" bone`, 68);
    for (let i = 0; i < boneCount; i++) {
      const bname = r.str('bone name');
      r.skip(64, 'bone matrix');
      bones.push(bname);
    }
  }
  const stride = cls === 2 ? 44 : 76;
  const vcAt = r.o;
  const vertexCount = r.count(`mesh "${name}" vertex`, stride, false);
  const pos = new Float32Array(vertexCount * 3);
  const stats = { nanPos: 0, nanNormal: 0, nanUv: 0, nanTangent: 0, zeroNormal: 0, firstNanPos: -1, firstNanNormal: -1 };
  const b = r.b;
  let o = r.o;
  for (let v = 0; v < vertexCount; v++) {
    const px = b.readFloatLE(o), py = b.readFloatLE(o + 4), pz = b.readFloatLE(o + 8);
    const nx = b.readFloatLE(o + 12), ny = b.readFloatLE(o + 16), nz = b.readFloatLE(o + 20);
    const u = b.readFloatLE(o + 24), w = b.readFloatLE(o + 28);
    const tx = b.readFloatLE(o + 32), ty = b.readFloatLE(o + 36), tz = b.readFloatLE(o + 40);
    pos[v * 3] = px; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz;
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
      if (stats.firstNanPos < 0) stats.firstNanPos = v;
      stats.nanPos++;
    }
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
      if (stats.firstNanNormal < 0) stats.firstNanNormal = v;
      stats.nanNormal++;
    } else if (nx * nx + ny * ny + nz * nz < 1e-8) stats.zeroNormal++;
    if (!Number.isFinite(u) || !Number.isFinite(w)) stats.nanUv++;
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz)) stats.nanTangent++;
    o += stride;
  }
  r.o = o;
  const indexCount = r.count(`mesh "${name}" index`, 2, false);
  const indices = new Uint16Array(indexCount);
  o = r.o;
  for (let i = 0; i < indexCount; i++) { indices[i] = b.readUInt16LE(o); o += 2; }
  r.o = o;
  const materialId = r.u32();
  const layer = r.u32();
  const lodIn = r.f32();
  const lodOut = r.f32();
  let bsphere = null;
  let renderable = null;
  if (cls === 2) {
    bsphere = { center: [r.f32(), r.f32(), r.f32()], radius: r.f32() };
    renderable = r.u8();
  }
  return {
    cls, name, path, castShadows, visible, transparent, bones,
    vertexCount, vertexCountOffset: vcAt, indexCount, pos, indices, stats,
    materialId, layer, lodIn, lodOut, bsphere, renderable,
  };
}

// Bounding box of a mesh in world space (after parent transforms + optional offset).
export function meshWorldPositions(mesh, offset = [0, 0, 0]) {
  const m = mesh.world;
  const n = mesh.vertexCount;
  const out = new Float64Array(n * 3);
  const p = mesh.pos;
  for (let v = 0; v < n; v++) {
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    out[v * 3] = x * m[0] + y * m[4] + z * m[8] + m[12] + offset[0];
    out[v * 3 + 1] = x * m[1] + y * m[5] + z * m[9] + m[13] + offset[1];
    out[v * 3 + 2] = x * m[2] + y * m[6] + z * m[10] + m[14] + offset[2];
  }
  return out;
}

export function bbox(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (!Number.isFinite(v)) continue;
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max, empty: min[0] === Infinity };
}
