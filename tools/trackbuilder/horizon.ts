// The horizon: hills and valleys out to ~20 km, so the view down a long straight ends in real landscape instead
// of the edge of the world. A coarse ring of terrain from USGS 3DEP elevation (~80 m) draped with NAIP imagery
// (~20 m), around the detailed overview square, dropping with the earth's curvature (31 m at 20 km).

import type { Centerline } from './route.ts';
import type { MeshPart } from './mesh.ts';
import type { DemRaster, GeoBox, ImageRaster } from './site.ts';
import { demUrl, naipUrl, sampleDem, sampleImage } from './site.ts';
import type { MaterialBook } from './materials.ts';
import type { Rgba } from './dds.ts';

export interface HorizonRaster { bbox: GeoBox; sizeM: number; dem?: DemRaster; rgb?: ImageRaster }

const EARTH_R = 6_371_000;

/** The horizon square: centred on the overview, `radiusM` out each way. */
export function planHorizon(overview: { bbox: GeoBox }, radiusM = 20000): { bbox: GeoBox; sizeM: number } {
    const lat = (overview.bbox.north + overview.bbox.south) / 2, lon = (overview.bbox.east + overview.bbox.west) / 2;
    const dLat = radiusM / 111_120, dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    return { bbox: { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon }, sizeM: radiusM * 2 };
}

/** USGS requests for the horizon square: elevation at ~80 m and imagery at ~20 m. */
export function horizonUrls(h: { bbox: GeoBox; sizeM: number }) {
    return { dem: demUrl(h.bbox, 512), rgb: naipUrl(h.bbox, 2048) };
}

/** The horizon photo resampled to a square power-of-two texture (north up). */
export function horizonTexture(h: HorizonRaster, N = 2048): Rgba {
    const data = new Uint8Array(N * N * 4), b = h.bbox;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const p = { lat: b.north - ((y + 0.5) / N) * (b.north - b.south), lon: b.west + ((x + 0.5) / N) * (b.east - b.west) };
        const c = (h.rgb ? sampleImage(h.rgb, p) : null) ?? [104, 112, 90];
        const i = (y * N + x) * 4;
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
    return { width: N, height: N, data };
}

/**
 * Ring mesh from the inner square (the detailed terrain's extent) to the horizon square's edge. Vertices inside
 * the inner square sink 4 m so the detailed terrain always wins where they overlap; heights drop with the
 * earth's curvature from the track's centre.
 */
export function buildHorizon(cl: Centerline, h: HorizonRaster, inner: GeoBox, book: MaterialBook, opts: { spacingM?: number } = {}): MeshPart[] {
    if (!h.dem) return [];
    const proj = cl.projection;
    const tex = book.image('horizon.dds', () => horizonTexture(h), { format: 'bc1' });
    const mat = book.add({
        name: 'horizon', shader: 'ksPerPixel',
        properties: [{ name: 'ksAmbient', a: 0.45 }, { name: 'ksDiffuse', a: 0.5 }, { name: 'ksSpecular', a: 0 }, { name: 'ksSpecularEXP', a: 1 }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0 }],
        textures: [{ sampler: 'txDiffuse', slot: 0, texture: tex }],
    });
    const a = proj.toLocal({ lat: h.bbox.south, lon: h.bbox.west }), b = proj.toLocal({ lat: h.bbox.north, lon: h.bbox.east });
    const ia = proj.toLocal({ lat: inner.south, lon: inner.west }), ib = proj.toLocal({ lat: inner.north, lon: inner.east });
    const c = cl.points.reduce((s, p) => ({ x: s.x + p.x / cl.points.length, y: s.y + p.y / cl.points.length }), { x: 0, y: 0 });
    const step = opts.spacingM ?? 200;
    const cols = Math.ceil((b.x - a.x) / step) + 1, rows = Math.ceil((b.y - a.y) / step) + 1;
    const X = (i: number) => Math.min(b.x, a.x + i * step), Z = (j: number) => Math.min(b.y, a.y + j * step);
    const inside = (x: number, z: number, pad: number) => x > ia.x + pad && x < ib.x - pad && z > ia.y + pad && z < ib.y - pad;
    const parts: MeshPart[] = [];
    let part: MeshPart | null = null;
    const vid = new Map<number, number>();
    const vertex = (i: number, j: number) => {
        const key = j * cols + i;
        let v = vid.get(key);
        if (v != null) return v;
        const x = X(i), z = Z(j), ll = proj.toLatLon({ x, y: z });
        let y = sampleDem(h.dem!, ll) ?? 0;
        if (!Number.isFinite(y)) y = 0;
        y -= ((x - c.x) ** 2 + (z - c.y) ** 2) / (2 * EARTH_R);
        if (inside(x, z, 0)) y -= 4;
        v = part!.positions.length / 3;
        part!.positions.push(x, y, z);
        part!.normals.push(0, 1, 0);
        part!.tangents.push(1, 0, 0);
        // v runs south -> north (the KN5 writer flips it to the image's rows).
        part!.uvs.push((ll.lon - h.bbox.west) / (h.bbox.east - h.bbox.west), (ll.lat - h.bbox.south) / (h.bbox.north - h.bbox.south));
        vid.set(key, v);
        return v;
    };
    for (let j = 0; j < rows - 1; j++) {
        // A new part every few rows keeps each under the vertex limit (vertices are shared within a part).
        if (!part || part.positions.length / 3 > 60000 - cols * 4) {
            part = { name: `HORIZON_${parts.length}`, material: mat, positions: [], normals: [], uvs: [], tangents: [], indices: [], castShadows: false };
            parts.push(part); vid.clear();
        }
        for (let i = 0; i < cols - 1; i++) {
            // Skip cells wholly inside the detailed square (keeping a 150 m overlap).
            if (inside(X(i), Z(j), 150) && inside(X(i + 1), Z(j + 1), 150)) continue;
            const v00 = vertex(i, j), v10 = vertex(i + 1, j), v01 = vertex(i, j + 1), v11 = vertex(i + 1, j + 1);
            part.indices.push(v00, v01, v10, v10, v01, v11);
        }
    }
    // Normals from the faces, for shading the hills.
    for (const p of parts) {
        const nrm = new Float32Array(p.positions.length);
        for (let t = 0; t < p.indices.length; t += 3) {
            const [i0, i1, i2] = [p.indices[t], p.indices[t + 1], p.indices[t + 2]];
            const ux = p.positions[i1 * 3] - p.positions[i0 * 3], uy = p.positions[i1 * 3 + 1] - p.positions[i0 * 3 + 1], uz = p.positions[i1 * 3 + 2] - p.positions[i0 * 3 + 2];
            const vx = p.positions[i2 * 3] - p.positions[i0 * 3], vy = p.positions[i2 * 3 + 1] - p.positions[i0 * 3 + 1], vz = p.positions[i2 * 3 + 2] - p.positions[i0 * 3 + 2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; [p.indices[t + 1], p.indices[t + 2]] = [p.indices[t + 2], p.indices[t + 1]]; }
            for (const k of [i0, i1, i2]) { nrm[k * 3] += nx; nrm[k * 3 + 1] += ny; nrm[k * 3 + 2] += nz; }
        }
        for (let k = 0; k < nrm.length; k += 3) { const l = Math.hypot(nrm[k], nrm[k + 1], nrm[k + 2]) || 1; p.normals[k] = nrm[k] / l; p.normals[k + 1] = nrm[k + 1] / l; p.normals[k + 2] = nrm[k + 2] / l; }
    }
    return parts.filter((p) => p.indices.length);
}
