// Aerial-textured ground: splits verge and terrain meshes into site regions (512 m cells, then the overview),
// gives each region its own ksPerPixelMultiMap_NMDetail material whose macro is the NAIP photo of that region,
// and maps UVs from lat/lon so the photo lines up exactly with the land.

import type { Centerline } from './route.ts';
import type { MeshPart, TrackGeometry } from './mesh.ts';
import type { Projection } from './geo.ts';
import type { GeoBox, SiteRasters } from './site.ts';
import { inBox, sampleImage, siteImageSampler } from './site.ts';
import type { SurfaceRaster } from './lidar.ts';
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
 * Where the road and shoulder are in a region image of N x N pixels: for each such pixel, the spot beyond the
 * shoulder to take its colour (and class) from instead, so the photo's own road never shows at the verge.
 */
function roadStamp(region: GroundRegion, N: number, cl: Centerline, g: TrackGeometry, beyondM: number): Map<number, { lat: number; lon: number }> {
    const b = region.bbox, proj = cl.projection;
    const sub = new Map<number, { lat: number; lon: number }>();
    const toPix = (lat: number, lon: number) => {
        const px = Math.floor(((lon - b.west) / (b.east - b.west)) * N), py = Math.floor(((b.north - lat) / (b.north - b.south)) * N);
        return px >= 0 && py >= 0 && px < N && py < N ? py * N + px : -1;
    };
    const pxM = region.sizeM / N;
    const stepLat = Math.max(0.25, pxM * 0.5);
    for (let i = 0; i < cl.points.length; i++) {
        const p = cl.points[i], t = cl.tangents[i], r = { x: t.y, y: -t.x };
        const footprintM = g.halfAt(i) + beyondM;
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
    return sub;
}

/**
 * The macro texture for a region: the aerial photo resampled to a square power-of-two image (north up),
 * with the road and shoulder painted out using the ground just beyond the shoulder, scaled x2 for the 0.5-mean
 * detail layer, alpha 0 so the photo-scanned detail shows everywhere.
 */
export function aerialMacro(region: GroundRegion, site: SiteRasters, cl: Centerline, g: TrackGeometry, beyondM = 1): Rgba {
    const N = region.texture, b = region.bbox;
    const sample = siteImageSampler(site);
    const sub = roadStamp(region, N, cl, g, beyondM);
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
    return { width: N, height: N, data };
}

/** Ground classes, in mask channel order: R grass, G pavement, B dirt / gravel, A forest floor. */
export const GROUND_LAYERS = ['grass', 'asphalt', 'dirt', 'forest_floor'] as const;
export type GroundClass = 0 | 1 | 2 | 3;

/** Classify one spot of ground from its photo colour, near-infrared and lidar height above ground. */
export function classifyGround(rgb: [number, number, number], nir: number | null, above: number | null): GroundClass {
    const [r, g, b] = rgb, lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const veg = nir != null ? (nir - r) / (nir + r + 1) > 0.12 : (2 * g - r - b) / (r + g + b + 1) > 0.045;
    if (veg) {
        if (above != null) return above > 2.0 ? 3 : 0;
        return lum < 58 ? 3 : 0;
    }
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (sat < 24 || b >= r - 4) return 1; // grey: asphalt, concrete, roofs' shadows
    return r > b + 14 && lum > 70 ? 2 : 1;
}

/**
 * The ksMultilayer mask for a region (N x N, north up): one class per spot from the photo, near-infrared and
 * lidar, overridden by mapped parking (pavement) and parks / pitches (grass where the photo is green), blurred
 * 3 x 3 so classes blend over a metre or so. Channels sum to 255.
 */
export function groundMask(region: GroundRegion, site: SiteRasters, cl: Centerline, g: TrackGeometry, N: number, beyondM = 1): Rgba {
    const b = region.bbox;
    const sample = siteImageSampler(site);
    const cells = site.cells;
    const sub = roadStamp(region, N, cl, g, beyondM);
    const proj = cl.projection;
    // Mapped areas, as rings in lat/lon with their class.
    const areas = (site.osm?.areas ?? []).map((a) => ({ cls: (a.tags.amenity === 'parking' ? 1 : 0) as GroundClass, rings: a.rings, box: ringBox(a.rings) }));
    const inArea = (p: { lat: number; lon: number }) => {
        for (const a of areas) {
            if (p.lat < a.box.south || p.lat > a.box.north || p.lon < a.box.west || p.lon > a.box.east) continue;
            if (a.rings.some((r) => inLatLonRing(p, r))) return a.cls;
        }
        return null;
    };
    void proj;
    const cls = new Uint8Array(N * N);
    for (let py = 0; py < N; py++) {
        const lat = b.north - ((py + 0.5) / N) * (b.north - b.south);
        for (let px = 0; px < N; px++) {
            const lon = b.west + ((px + 0.5) / N) * (b.east - b.west);
            const k = py * N + px;
            const at = sub.get(k) ?? { lat, lon };
            const rgb = sample(at) ?? [96, 104, 72];
            const cell = cells.find((c) => at.lon >= c.bbox.west && at.lon < c.bbox.east && at.lat >= c.bbox.south && at.lat < c.bbox.north);
            const nir = cell?.nir ? sampleImage(cell.nir, at)?.[0] ?? null : null;
            const above = cell?.surface ? surfaceAbove(cell.surface, at) : null;
            let c = classifyGround(rgb, nir, above);
            const mapped = areas.length ? inArea(at) : null;
            if (mapped === 1 && c !== 3) c = 1;
            else if (mapped === 0 && c === 2) c = 0;
            cls[k] = c;
        }
    }
    const data = new Uint8Array(N * N * 4);
    for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
        const w = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x = Math.max(0, Math.min(N - 1, px + dx)), y = Math.max(0, Math.min(N - 1, py + dy));
            w[cls[y * N + x]] += dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
        }
        const k = (py * N + px) * 4;
        // Round cumulatively so the four channels always sum to exactly 255 (no channel can wrap).
        let prev = 0, cum = 0;
        for (let c = 0; c < 4; c++) { cum += w[c]; const edge = Math.round((cum / 16) * 255); data[k + c] = edge - prev; prev = edge; }
    }
    return { width: N, height: N, data };
}

function ringBox(rings: { lat: number; lon: number }[][]) {
    let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
    for (const r of rings) for (const p of r) { south = Math.min(south, p.lat); north = Math.max(north, p.lat); west = Math.min(west, p.lon); east = Math.max(east, p.lon); }
    return { south, north, west, east };
}
function inLatLonRing(p: { lat: number; lon: number }, r: { lat: number; lon: number }[]) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i], c = r[j];
        if ((a.lat > p.lat) !== (c.lat > p.lat) && p.lon < ((c.lon - a.lon) * (p.lat - a.lat)) / (c.lat - a.lat) + a.lon) inside = !inside;
    }
    return inside;
}
function surfaceAbove(s: SurfaceRaster, p: { lat: number; lon: number }): number | null {
    const px = Math.floor(((p.lon - s.bbox.west) / (s.bbox.east - s.bbox.west)) * s.width), py = Math.floor(((s.bbox.north - p.lat) / (s.bbox.north - s.bbox.south)) * s.height);
    if (px < 0 || py < 0 || px >= s.width || py >= s.height) return null;
    const v = s.above[py * s.width + px];
    return Number.isFinite(v) ? v : null;
}

/**
 * Rivers and lakes: terrain triangles inside mapped water become a separate water mesh (3DEP elevation is
 * hydro-flattened, so the terrain already lies at the water surface). Returns the land and the water parts.
 */
export function splitWater(parts: MeshPart[], water: { rings: { lat: number; lon: number }[][] }[], proj: Projection, material: string): { land: MeshPart[]; water: MeshPart[] } {
    if (!water.length) return { land: parts, water: [] };
    const areas = water.map((w) => ({ rings: w.rings, box: ringBox(w.rings) }));
    const wet = (x: number, z: number) => {
        const p = proj.toLatLon({ x, y: z });
        return areas.some((a) => p.lat >= a.box.south && p.lat <= a.box.north && p.lon >= a.box.west && p.lon <= a.box.east && a.rings.some((r) => inLatLonRing(p, r)));
    };
    const land: MeshPart[] = [], out: MeshPart[] = [];
    let n = 0;
    for (const part of parts) {
        const keep: number[] = [], wetTris: number[] = [];
        for (let t = 0; t < part.indices.length; t += 3) {
            const [a, b, c] = [part.indices[t], part.indices[t + 1], part.indices[t + 2]];
            const cx = (part.positions[a * 3] + part.positions[b * 3] + part.positions[c * 3]) / 3, cz = (part.positions[a * 3 + 2] + part.positions[b * 3 + 2] + part.positions[c * 3 + 2]) / 3;
            (wet(cx, cz) ? wetTris : keep).push(a, b, c);
        }
        if (!wetTris.length) { land.push(part); continue; }
        land.push({ ...part, indices: keep });
        const w: MeshPart = { name: `WATER_${n++}`, material, positions: [], normals: [], uvs: [], tangents: [], indices: [], castShadows: false };
        const remap = new Map<number, number>();
        for (const v of wetTris) {
            let nv = remap.get(v);
            if (nv == null) {
                nv = w.positions.length / 3; remap.set(v, nv);
                const x = part.positions[v * 3], z = part.positions[v * 3 + 2];
                w.positions.push(x, part.positions[v * 3 + 1] + 0.05, z);
                w.normals.push(0, 1, 0); w.tangents.push(1, 0, 0); w.uvs.push(x / 24, z / 24);
            }
            w.indices.push(nv);
        }
        out.push(w);
    }
    return { land: land.filter((p) => p.indices.length), water: out };
}

/** Wind ripples for water: a tileable tangent-space normal map (DirectX convention, green down). */
export function rippleNormals(N = 256): Rgba {
    const h = new Float32Array(N * N);
    // Sum of a few directional waves with integer frequencies, so it tiles.
    const waves = [[3, 1, 0.5], [1, 4, 0.35], [5, -2, 0.25], [-2, 7, 0.15], [9, 4, 0.1], [-7, 10, 0.08]];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let v = 0;
        waves.forEach(([fx, fy, a], k) => { v += a * Math.sin(((fx * x + fy * y) / N) * Math.PI * 2 + k * 1.7); });
        h[y * N + x] = v;
    }
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)], dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
        const nx = -dx * 2, ny = -dy * 2, nz = 1, l = Math.hypot(nx, ny, nz);
        const k = (y * N + x) * 4;
        data[k] = Math.round((nx / l * 0.5 + 0.5) * 255); data[k + 1] = Math.round((-ny / l * 0.5 + 0.5) * 255); data[k + 2] = Math.round((nz / l * 0.5 + 0.5) * 255); data[k + 3] = 255;
    }
    return { width: N, height: N, data };
}

/**
 * Split parts by mapped areas: triangles whose centre lies inside any of the areas go to `inside` (named by
 * `rename`), the rest stay as they were. Materials, UVs and normals are kept.
 */
export function splitInside(parts: MeshPart[], areas: { rings: { lat: number; lon: number }[][] }[], proj: Projection, rename: (name: string) => string): { inside: MeshPart[]; outside: MeshPart[] } {
    if (!areas.length) return { inside: [], outside: parts };
    const boxes = areas.map((a) => ({ rings: a.rings, box: ringBox(a.rings) }));
    const isIn = (x: number, z: number) => {
        const p = proj.toLatLon({ x, y: z });
        return boxes.some((a) => p.lat >= a.box.south && p.lat <= a.box.north && p.lon >= a.box.west && p.lon <= a.box.east && a.rings.some((r) => inLatLonRing(p, r)));
    };
    const inside: MeshPart[] = [], outside: MeshPart[] = [];
    for (const part of parts) {
        const keep: number[] = [], take: number[] = [];
        for (let t = 0; t < part.indices.length; t += 3) {
            const [a, b, c] = [part.indices[t], part.indices[t + 1], part.indices[t + 2]];
            const cx = (part.positions[a * 3] + part.positions[b * 3] + part.positions[c * 3]) / 3, cz = (part.positions[a * 3 + 2] + part.positions[b * 3 + 2] + part.positions[c * 3 + 2]) / 3;
            (isIn(cx, cz) ? take : keep).push(a, b, c);
        }
        if (!take.length) { outside.push(part); continue; }
        if (keep.length) outside.push({ ...part, indices: keep });
        // The taken triangles keep the same vertex arrays (unused vertices are harmless).
        inside.push({ ...part, name: rename(part.name), indices: take });
    }
    return { inside, outside };
}
