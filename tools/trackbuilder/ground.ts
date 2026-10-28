// Aerial-textured ground: splits verge and terrain meshes into site regions (512 m cells, then the overview),
// gives each region its own ksPerPixelMultiMap_NMDetail material whose macro is the NAIP photo of that region,
// and maps UVs from lat/lon so the photo lines up exactly with the land.

import type { Centerline } from './route.ts';
import type { MeshPart, TrackGeometry } from './mesh.ts';
import type { Projection } from './geo.ts';
import type { GeoBox, SiteRasters } from './site.ts';
import { inBox, siteImageSampler } from './site.ts';
import type { Rgba } from './dds.ts';

export interface GroundRegion { key: string; bbox: GeoBox; sizeM: number; texture: number }

/** The regions a site offers: every cell with imagery, then the overview. */
export function siteRegions(site: SiteRasters): GroundRegion[] {
    const out: GroundRegion[] = site.cells.filter((c) => c.rgb).map((c) => ({ key: c.key.replace('-', 'm').replace(/-/g, 'm'), bbox: c.bbox, sizeM: c.sizeM, texture: 1024 }));
    if (site.overview?.rgb) out.push({ key: 'overview', bbox: site.overview.bbox, sizeM: site.overview.sizeM, texture: 2048 });
    return out;
}

/**
 * Split parts by the region containing each triangle's centroid. Triangles outside every region keep the
 * original material. New parts are named `<base>_<region>_<n>` and get lat/lon UVs for that region.
 */
export function splitByRegion(parts: MeshPart[], regions: GroundRegion[], proj: Projection, materialOf: (r: GroundRegion) => string): MeshPart[] {
    const out: MeshPart[] = [];
    const find = (x: number, z: number) => { const p = proj.toLatLon({ x, y: z }); return regions.find((r) => inBox(r.bbox, p)) ?? null; };
    for (const part of parts) {
        const base = part.name.replace(/_\d+$/, '');
        const buckets = new Map<string, { region: GroundRegion | null; tris: number[] }>();
        for (let t = 0; t < part.indices.length; t += 3) {
            const [a, b, c] = [part.indices[t], part.indices[t + 1], part.indices[t + 2]];
            const cx = (part.positions[a * 3] + part.positions[b * 3] + part.positions[c * 3]) / 3;
            const cz = (part.positions[a * 3 + 2] + part.positions[b * 3 + 2] + part.positions[c * 3 + 2]) / 3;
            const r = find(cx, cz);
            const k = r?.key ?? '';
            let bk = buckets.get(k);
            if (!bk) buckets.set(k, (bk = { region: r, tris: [] }));
            bk.tris.push(a, b, c);
        }
        for (const [k, { region, tris }] of buckets) {
            const p: MeshPart = { ...part, name: region ? `${base}_${k}` : base, material: region ? materialOf(region) : part.material, positions: [], normals: [], uvs: [], tangents: [], indices: [] };
            const remap = new Map<number, number>();
            for (const v of tris) {
                let nv = remap.get(v);
                if (nv == null) {
                    nv = p.positions.length / 3;
                    remap.set(v, nv);
                    const x = part.positions[v * 3], y = part.positions[v * 3 + 1], z = part.positions[v * 3 + 2];
                    p.positions.push(x, y, z);
                    p.normals.push(part.normals[v * 3], part.normals[v * 3 + 1], part.normals[v * 3 + 2]);
                    p.tangents.push(part.tangents[v * 3], part.tangents[v * 3 + 1], part.tangents[v * 3 + 2]);
                    if (region) {
                        // u west -> east, v south -> north, inset half a texel so the wrap never shows.
                        const ll = proj.toLatLon({ x, y: z }), n = region.texture;
                        const u = (ll.lon - region.bbox.west) / (region.bbox.east - region.bbox.west);
                        const vv = (ll.lat - region.bbox.south) / (region.bbox.north - region.bbox.south);
                        p.uvs.push((0.5 + Math.max(0, Math.min(1, u)) * (n - 1)) / n, (0.5 + Math.max(0, Math.min(1, vv)) * (n - 1)) / n);
                    } else p.uvs.push(part.uvs[v * 2], part.uvs[v * 2 + 1]);
                }
                p.indices.push(nv);
            }
            // Keep each piece under the vertex limit by splitting again if needed.
            if (p.positions.length / 3 <= 60000) out.push(p);
            else out.push(...chunk(p));
        }
    }
    // Number the pieces per base name.
    const counts = new Map<string, number>();
    for (const p of out) { const n = counts.get(p.name) ?? 0; counts.set(p.name, n + 1); p.name = `${p.name}_${n}`; }
    return out;
}

function chunk(p: MeshPart): MeshPart[] {
    const out: MeshPart[] = [];
    let cur: MeshPart | null = null, remap = new Map<number, number>();
    for (let t = 0; t < p.indices.length; t += 3) {
        if (!cur || cur.positions.length / 3 > 59997) { cur = { ...p, positions: [], normals: [], uvs: [], tangents: [], indices: [] }; out.push(cur); remap = new Map(); }
        for (let k = 0; k < 3; k++) {
            const v = p.indices[t + k];
            let nv = remap.get(v);
            if (nv == null) {
                nv = cur.positions.length / 3; remap.set(v, nv);
                cur.positions.push(p.positions[v * 3], p.positions[v * 3 + 1], p.positions[v * 3 + 2]);
                cur.normals.push(p.normals[v * 3], p.normals[v * 3 + 1], p.normals[v * 3 + 2]);
                cur.tangents.push(p.tangents[v * 3], p.tangents[v * 3 + 1], p.tangents[v * 3 + 2]);
                cur.uvs.push(p.uvs[v * 2], p.uvs[v * 2 + 1]);
            }
            cur.indices.push(nv);
        }
    }
    return out;
}

/**
 * The macro texture for a region: the aerial photo resampled to a square power-of-two image (north up),
 * with the road and shoulder painted out using the ground just beyond the shoulder, scaled x2 for the 0.5-mean
 * detail layer, alpha 0 so the photo-scanned detail shows everywhere.
 */
export function aerialMacro(region: GroundRegion, site: SiteRasters, cl: Centerline, g: TrackGeometry, footprintM: number): Rgba {
    const N = region.texture, b = region.bbox;
    const sample = siteImageSampler(site);
    const proj = cl.projection;
    // Stamp the road footprint: for each marked pixel remember where to take its colour from instead.
    const sub = new Map<number, { lat: number; lon: number }>();
    const toPix = (lat: number, lon: number) => {
        const px = Math.floor(((lon - b.west) / (b.east - b.west)) * N), py = Math.floor(((b.north - lat) / (b.north - b.south)) * N);
        return px >= 0 && py >= 0 && px < N && py < N ? py * N + px : -1;
    };
    const pxM = region.sizeM / N;
    const stepLat = Math.max(0.25, pxM * 0.5);
    for (let i = 0; i < cl.points.length; i++) {
        const p = cl.points[i], t = cl.tangents[i], r = { x: t.y, y: -t.x };
        for (const side of [-1, 1] as const) {
            const take = proj.toLatLon({ x: p.x + r.x * side * (footprintM + 3), y: p.y + r.y * side * (footprintM + 3) });
            for (let d = 0; d <= footprintM + 0.75; d += stepLat) {
                // Also stamp half a step along the road so gaps between samples are covered.
                for (const along of [-0.5, 0, 0.5]) {
                    const q = proj.toLatLon({ x: p.x + r.x * side * d + t.x * along * cl.spacing, y: p.y + r.y * side * d + t.y * along * cl.spacing });
                    const k = toPix(q.lat, q.lon);
                    if (k >= 0 && !sub.has(k)) sub.set(k, take);
                }
            }
        }
    }
    const data = new Uint8Array(N * N * 4);
    for (let py = 0; py < N; py++) {
        const lat = b.north - ((py + 0.5) / N) * (b.north - b.south);
        for (let px = 0; px < N; px++) {
            const lon = b.west + ((px + 0.5) / N) * (b.east - b.west);
            const k = py * N + px;
            const from = sub.get(k);
            const c = (from ? sample(from) : null) ?? sample({ lat, lon }) ?? [96, 104, 72];
            for (let ch = 0; ch < 3; ch++) data[k * 4 + ch] = Math.min(255, Math.round(c[ch] * 1.9));
            data[k * 4 + 3] = 0;
        }
    }
    void g;
    return { width: N, height: N, data };
}
