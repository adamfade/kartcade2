// Lidar surface model: the USGS 3DEP point cloud (public domain, served as Entwine Point Tiles on AWS) turned into
// a per-cell raster of "height above ground" plus what the highest return hit (building, vegetation, ...).
// That gives real building heights and roof shapes, and real tree positions and heights.
//
// Fetched once per site in the browser, along the corridor only (~120 m each side of the road), and stored with
// the site data as surface.png (Terrarium-encoded height above ground) and class.png (ASPRS class per pixel).
// Point clouds are LAZ; decoding uses laz-perf (WASM), passed in so this file runs in the browser and in Node.

import type { LatLon } from './geo.ts';
import type { DemRaster, GeoBox, SiteRasters } from './site.ts';
import { sampleDem } from './site.ts';
import { decodePNG, encodePNG } from './png.ts';

export interface SurfaceRaster {
    bbox: GeoBox;
    width: number;
    height: number;
    /** Height of the highest return above the bare-earth DEM, metres (NaN = no data). */
    above: Float32Array;
    /** ASPRS class of that return: 2 ground, 3-5 vegetation, 6 building, 9 water, 17 bridge deck; 0 = no data. */
    cls: Uint8Array;
}

export interface SurfaceMeta { version: 1; source: string; workunit: string; fetched: string; cells: string[]; datumOffset: number }

// ---------------------------------------------------------------- EPSG:3857 (EPT tiles are in web mercator)

const R = 6378137;
export const toMerc = (p: LatLon) => ({ x: (p.lon * Math.PI / 180) * R, y: Math.log(Math.tan(Math.PI / 4 + (p.lat * Math.PI / 180) / 2)) * R });
export const fromMerc = (x: number, y: number): LatLon => ({ lon: (x / R) * 180 / Math.PI, lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI });

// ---------------------------------------------------------------- finding the point cloud

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const EPT_ROOT = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public';
const INDEX = 'https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/8/query';

export interface Ept { url: string; workunit: string; bounds: number[]; span: number; collected: number }

/** The newest 3DEP lidar collection covering a point that has an EPT on AWS. */
export async function findEpt(fetchFn: FetchLike, at: LatLon): Promise<Ept | null> {
    const q = `${INDEX}?geometry=${at.lon},${at.lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=workunit,collect_start&returnGeometry=false&f=json`;
    const j = await (await fetchFn(q)).json();
    const units = ((j.features ?? []) as { attributes: { workunit?: string; collect_start?: number } }[])
        .map((f) => ({ w: f.attributes.workunit ?? '', t: f.attributes.collect_start ?? 0 }))
        .filter((u) => u.w).sort((a, b) => b.t - a.t);
    for (const u of units) {
        try {
            const r = await fetchFn(`${EPT_ROOT}/${u.w}/ept.json`);
            if (!r.ok) continue;
            const e = await r.json();
            if (e.dataType !== 'laszip' || e.srs?.horizontal !== '3857') continue;
            return { url: `${EPT_ROOT}/${u.w}`, workunit: u.w, bounds: e.bounds, span: e.span, collected: u.t };
        } catch { /* try the next collection */ }
    }
    return null;
}

/** Octree node keys ("D-X-Y-Z") down to `depth` whose footprint passes `keep` (a test on its 3857 xy box). */
export async function eptNodes(fetchFn: FetchLike, ept: Ept, depth: number, keep: (x0: number, y0: number, x1: number, y1: number) => boolean): Promise<string[]> {
    const [bx0, by0, , bx1, by1] = ept.bounds;
    const out: string[] = [];
    const load = async (key: string) => (await (await fetchFn(`${ept.url}/ept-hierarchy/${key}.json`)).json()) as Record<string, number>;
    const walk = async (h: Record<string, number>, key: string): Promise<void> => {
        const [d, x, y, z] = key.split('-').map(Number);
        const size = (bx1 - bx0) / 2 ** d;
        const nx0 = bx0 + x * size, ny0 = by0 + y * size;
        if (!keep(nx0, ny0, nx0 + size, ny0 + size)) return;
        let count = h[key];
        if (count === undefined) return;
        if (count === -1) { h = { ...h, ...(await load(key)) }; count = h[key]; }
        if (count > 0) out.push(key);
        if (d >= depth) return;
        const kids: Promise<void>[] = [];
        for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
            const k = `${d + 1}-${x * 2 + dx}-${y * 2 + dy}-${z * 2 + dz}`;
            if (k in h) kids.push(walk(h, k));
        }
        await Promise.all(kids);
    };
    await walk(await load('0-0-0-0'), '0-0-0-0');
    return out;
}

// ---------------------------------------------------------------- LAZ decoding

export interface PointBlock { x: Float64Array; y: Float64Array; z: Float32Array; cls: Uint8Array; first: Uint8Array; count: number }

/** Minimal shape of the laz-perf module (createLazPerf()). */
export interface LazPerfModule {
    _malloc(n: number): number;
    _free(p: number): void;
    HEAPU8: Uint8Array;
    LASZip: new () => { open(p: number, n: number): void; getPoint(p: number): void; getCount(): number; getPointLength(): number; getPointFormat(): number; delete(): void };
}

/** Decode a LAZ file (a whole EPT node) to coordinates, class and first-return flags. */
export function decodeLaz(lp: LazPerfModule, bytes: Uint8Array): PointBlock {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const scale = [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)];
    const offset = [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)];
    const filePtr = lp._malloc(bytes.length);
    lp.HEAPU8.set(bytes, filePtr);
    const las = new lp.LASZip();
    try {
        las.open(filePtr, bytes.length);
        const count = las.getCount(), len = las.getPointLength(), fmt = las.getPointFormat() & 0x3f;
        const pp = lp._malloc(len);
        const x = new Float64Array(count), y = new Float64Array(count), z = new Float32Array(count), cls = new Uint8Array(count), first = new Uint8Array(count);
        try {
            for (let i = 0; i < count; i++) {
                las.getPoint(pp);
                const v = new DataView(lp.HEAPU8.buffer, pp, len);
                x[i] = v.getInt32(0, true) * scale[0] + offset[0];
                y[i] = v.getInt32(4, true) * scale[1] + offset[1];
                z[i] = v.getInt32(8, true) * scale[2] + offset[2];
                if (fmt >= 6) { const r = v.getUint8(14); first[i] = (r & 0x0f) === 1 ? 1 : 0; cls[i] = v.getUint8(16); }
                else { const r = v.getUint8(14); first[i] = (r & 0x07) === 1 ? 1 : 0; cls[i] = v.getUint8(15) & 0x1f; }
            }
        } finally { lp._free(pp); }
        return { x, y, z, cls, first, count };
    } finally { las.delete(); lp._free(filePtr); }
}

// ---------------------------------------------------------------- rasterising

const NOISE = new Set([7, 18]);

/**
 * Highest non-noise return per pixel over a cell (the cell's DEM grid: same bbox and size), as height above the
 * DEM. `datumOffset` is subtracted from point heights first (point clouds can be on a different vertical datum).
 */
export function rasterizeSurface(dem: DemRaster, blocks: PointBlock[], datumOffset: number): SurfaceRaster {
    const { width: W, height: H, bbox } = dem;
    const top = new Float32Array(W * H).fill(-Infinity), cls = new Uint8Array(W * H);
    const sw = toMerc({ lat: bbox.south, lon: bbox.west }), ne = toMerc({ lat: bbox.north, lon: bbox.east });
    for (const b of blocks) for (let i = 0; i < b.count; i++) {
        if (NOISE.has(b.cls[i])) continue;
        if (b.x[i] < sw.x || b.x[i] >= ne.x || b.y[i] < sw.y || b.y[i] >= ne.y) continue;
        // Mercator y to latitude is non-linear; convert properly, then index the lat/lon grid.
        const ll = fromMerc(b.x[i], b.y[i]);
        const px = Math.floor(((ll.lon - bbox.west) / (bbox.east - bbox.west)) * W), py = Math.floor(((bbox.north - ll.lat) / (bbox.north - bbox.south)) * H);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const k = py * W + px, zz = b.z[i] - datumOffset;
        if (zz > top[k]) { top[k] = zz; cls[k] = b.cls[i] || 1; }
    }
    const above = new Float32Array(W * H).fill(NaN);
    for (let k = 0; k < W * H; k++) {
        if (top[k] === -Infinity) continue;
        const g = dem.heights[k];
        if (!Number.isFinite(g)) continue;
        above[k] = Math.max(0, top[k] - g);
    }
    // Fill single-pixel holes (sparser returns) from neighbours.
    for (let pass = 0; pass < 2; pass++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const k = y * W + x;
        if (Number.isFinite(above[k])) continue;
        let s = 0, c = 0, best = 0, bc = 0;
        for (const d of [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1]) if (Number.isFinite(above[k + d])) { s += above[k + d]; c++; if (above[k + d] >= best) { best = above[k + d]; bc = cls[k + d]; } }
        if (c >= 4) { above[k] = s / c; cls[k] = bc; }
    }
    return { bbox, width: W, height: H, above, cls };
}

/**
 * Vertical datum offset between the point cloud and the DEM: the median of (ground-classified return - DEM)
 * over a sample of ground points. Point clouds served as EPT can be on the ellipsoid while the DEM is NAVD88.
 */
export function datumOffset(blocks: PointBlock[], dems: DemRaster[]): number {
    const d: number[] = [];
    for (const b of blocks) for (let i = 0; i < b.count && d.length < 20000; i += 7) {
        if (b.cls[i] !== 2) continue;
        const ll = fromMerc(b.x[i], b.y[i]);
        for (const dem of dems) { const g = sampleDem(dem, ll); if (g != null) { d.push(b.z[i] - g); break; } }
    }
    if (d.length < 50) return 0;
    d.sort((a, b) => a - b);
    return d[d.length >> 1];
}

export function sampleSurface(s: SurfaceRaster, p: LatLon): { above: number; cls: number } | null {
    if (p.lon < s.bbox.west || p.lon > s.bbox.east || p.lat < s.bbox.south || p.lat > s.bbox.north) return null;
    const px = Math.min(s.width - 1, Math.floor(((p.lon - s.bbox.west) / (s.bbox.east - s.bbox.west)) * s.width));
    const py = Math.min(s.height - 1, Math.floor(((s.bbox.north - p.lat) / (s.bbox.north - s.bbox.south)) * s.height));
    const k = py * s.width + px;
    return Number.isFinite(s.above[k]) ? { above: s.above[k], cls: s.cls[k] } : null;
}

// ---------------------------------------------------------------- storage

/** Height above ground as a Terrarium PNG (1/256 m) and the class as an 8-bit grey PNG. */
export function surfaceToPngs(s: SurfaceRaster): { above: Uint8Array; cls: Uint8Array } {
    const a = new Uint8Array(s.width * s.height * 4), c = new Uint8Array(s.width * s.height * 4);
    for (let i = 0; i < s.width * s.height; i++) {
        // 5 cm steps are plenty for roofs and treetops and keep the PNG small.
        const h = Number.isFinite(s.above[i]) ? Math.round(s.above[i] * 20) / 20 : NaN, v = Number.isFinite(h) ? Math.max(0, Math.min(65535.996, h + 32768)) : 0;
        a[i * 4] = Math.floor(v / 256); a[i * 4 + 1] = Math.floor(v) % 256; a[i * 4 + 2] = Math.floor((v - Math.floor(v)) * 256); a[i * 4 + 3] = 255;
        c[i * 4] = c[i * 4 + 1] = c[i * 4 + 2] = s.cls[i]; c[i * 4 + 3] = 255;
    }
    return { above: encodePNG({ width: s.width, height: s.height, data: a }), cls: encodePNG({ width: s.width, height: s.height, data: c }) };
}

export function pngsToSurface(above: Uint8Array, cls: Uint8Array, bbox: GeoBox): SurfaceRaster {
    const a = decodePNG(above), c = decodePNG(cls);
    const out = new Float32Array(a.width * a.height), k = new Uint8Array(a.width * a.height);
    for (let i = 0; i < out.length; i++) {
        const v = a.data[i * 4] * 256 + a.data[i * 4 + 1] + a.data[i * 4 + 2] / 256 - 32768;
        out[i] = v <= -32767 ? NaN : v;
        k[i] = c.data[i * 4];
    }
    return { bbox, width: a.width, height: a.height, above: out, cls: k };
}

// ---------------------------------------------------------------- the whole job (browser)

/** Within `bufferM` of the route line, in 3857 units (which are ~1/cos(lat) metres). */
function corridorTest(line: LatLon[], bufferM: number) {
    const pts = line.map(toMerc);
    const scale = 1 / Math.cos((line[0].lat * Math.PI) / 180);
    const buf = bufferM * scale;
    return (x0: number, y0: number, x1: number, y1: number) => {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / l2));
            const qx = a.x + dx * t, qy = a.y + dy * t;
            if (Math.abs(qx - cx) <= hx + buf && Math.abs(qy - cy) <= hy + buf) return true;
        }
        return false;
    };
}

/**
 * Fetch the point cloud along the route and rasterise it into each site cell. Returns the surfaces keyed by cell,
 * or null when no 3DEP point cloud covers the site.
 */
export async function fetchSurfaces(fetchFn: FetchLike, lp: LazPerfModule, site: SiteRasters, line: LatLon[],
    log: (m: string) => void, opts: { bufferM?: number; depth?: number; concurrency?: number } = {}): Promise<{ surfaces: Map<string, SurfaceRaster>; meta: SurfaceMeta } | null> {
    const mid = line[line.length >> 1];
    const ept = await findEpt(fetchFn, mid);
    if (!ept) { log('No 3DEP point cloud covers this road; building and tree heights will be estimated'); return null; }
    // Depth where points are about 1 m apart on the ground.
    const cube = ept.bounds[3] - ept.bounds[0], scale = 1 / Math.cos((mid.lat * Math.PI) / 180);
    const depth = opts.depth ?? Math.max(0, Math.ceil(Math.log2(cube / ept.span / (1.0 * scale))));
    const keys = await eptNodes(fetchFn, ept, depth, corridorTest(line, opts.bufferM ?? 120));
    log(`Fetching the ${ept.workunit.replace(/_/g, ' ')} lidar point cloud (${keys.length} tiles)`);
    const blocks: PointBlock[] = [];
    let next = 0, done = 0, lastPct = -1;
    await Promise.all(Array.from({ length: opts.concurrency ?? 6 }, async () => {
        while (next < keys.length) {
            const k = keys[next++];
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const r = await fetchFn(`${ept.url}/ept-data/${k}.laz`);
                    if (!r.ok) throw new Error(`lidar tile ${k}: ${r.status}`);
                    blocks.push(decodeLaz(lp, new Uint8Array(await r.arrayBuffer())));
                    break;
                } catch (e) { if (attempt === 2) throw e; await new Promise((res) => setTimeout(res, 1000 * (attempt + 1))); }
            }
            const pct = Math.floor((++done / keys.length) * 10) * 10;
            if (pct !== lastPct) { lastPct = pct; log(`  ${pct}%`); }
        }
    }));
    const dems = site.cells.filter((c) => c.dem).map((c) => c.dem!);
    const off = datumOffset(blocks, dems);
    const surfaces = new Map<string, SurfaceRaster>();
    for (const c of site.cells) if (c.dem) surfaces.set(c.key, rasterizeSurface(c.dem, blocks, off));
    return { surfaces, meta: { version: 1, source: 'USGS 3DEP lidar point cloud (public domain), AWS usgs-lidar-public', workunit: ept.workunit, fetched: new Date().toISOString(), cells: [...surfaces.keys()], datumOffset: off } };
}
