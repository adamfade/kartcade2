// Triangle soup + uniform XZ grid for nearest-distance and "surface under point" queries.

export class TriGrid {
  // tris: Float64Array, 9 numbers per triangle (ax ay az bx by bz cx cy cz); tags: per-triangle label
  constructor(tris, tags, cellSize = 8) {
    this.t = tris;
    this.tags = tags;
    this.n = tris.length / 9;
    this.cs = cellSize;
    this.cells = new Map();
    this.big = [];
    this.stamp = new Uint32Array(this.n);
    this.query = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 9;
      const x0 = Math.min(tris[o], tris[o + 3], tris[o + 6]);
      const x1 = Math.max(tris[o], tris[o + 3], tris[o + 6]);
      const z0 = Math.min(tris[o + 2], tris[o + 5], tris[o + 8]);
      const z1 = Math.max(tris[o + 2], tris[o + 5], tris[o + 8]);
      if (![x0, x1, z0, z1].every(Number.isFinite)) continue;
      const ix0 = Math.floor(x0 / cellSize), ix1 = Math.floor(x1 / cellSize);
      const iz0 = Math.floor(z0 / cellSize), iz1 = Math.floor(z1 / cellSize);
      if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > 4096) { this.big.push(i); continue; }
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = ix + ',' + iz;
          let c = this.cells.get(k);
          if (!c) this.cells.set(k, (c = []));
          c.push(i);
        }
      }
    }
  }

  *_candidates(x, z, radius) {
    this.query = (this.query + 1) >>> 0;
    if (this.query === 0) { this.stamp.fill(0); this.query = 1; }
    const q = this.query;
    const cs = this.cs;
    const r = Math.ceil(radius / cs);
    const cx = Math.floor(x / cs), cz = Math.floor(z / cs);
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const c = this.cells.get(ix + ',' + iz);
        if (!c) continue;
        for (const i of c) {
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          yield i;
        }
      }
    }
    for (const i of this.big) yield i;
  }

  // Nearest 3D distance to any triangle within `radius` (horizontal search window); Infinity if none.
  nearest(x, y, z, radius) {
    let best = Infinity, bestTri = -1;
    for (const i of this._candidates(x, z, radius)) {
      const d = pointTriDistSq(x, y, z, this.t, i * 9);
      if (d < best) { best = d; bestTri = i; }
    }
    return { dist: Math.sqrt(best), tri: bestTri };
  }

  // Heights of all triangles whose XZ projection contains (x, z).
  heightsAt(x, z) {
    const out = [];
    for (const i of this._candidates(x, z, 0)) {
      const o = i * 9, t = this.t;
      const h = heightInTri(x, z, t[o], t[o + 1], t[o + 2], t[o + 3], t[o + 4], t[o + 5], t[o + 6], t[o + 7], t[o + 8]);
      if (h !== null) out.push({ y: h, tri: i, tag: this.tags[i] });
    }
    return out;
  }
}

function heightInTri(px, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-12) return null;
  const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
  const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
  const l3 = 1 - l1 - l2;
  const e = -1e-6;
  if (l1 < e || l2 < e || l3 < e) return null;
  return l1 * ay + l2 * by + l3 * cy;
}

// Squared distance from point to triangle (Ericson, Real-Time Collision Detection 5.1.5).
export function pointTriDistSq(px, py, pz, t, o) {
  const ax = t[o], ay = t[o + 1], az = t[o + 2];
  const bx = t[o + 3], by = t[o + 4], bz = t[o + 5];
  const cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  const sq = (x, y, z) => x * x + y * y + z * z;
  if (d1 <= 0 && d2 <= 0) return sq(apx, apy, apz);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return sq(px - (ax + v * abx), py - (ay + v * aby), pz - (az + v * abz));
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return sq(px - (ax + w * acx), py - (ay + w * acy), pz - (az + w * acz));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return sq(px - (bx + w * (cx - bx)), py - (by + w * (cy - by)), pz - (bz + w * (cz - bz)));
  }
  const sum = va + vb + vc;
  if (!(Math.abs(sum) > 1e-20)) return Math.min(sq(apx, apy, apz), sq(bpx, bpy, bpz), sq(cpx, cpy, cpz));
  const denom = 1 / sum;
  const v = vb * denom, w = vc * denom;
  return sq(px - (ax + abx * v + acx * w), py - (ay + aby * v + acy * w), pz - (az + abz * v + acz * w));
}
