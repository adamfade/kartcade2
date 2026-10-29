// Site data: the real ground around a track, fetched once and stored with the project.
//   - elevation: USGS 3DEP bare-earth DEM, 1 m, public domain
//   - imagery:   USGS NAIP orthophoto, 0.5 m as stored (0.3 m native), public domain; RGB + near-infrared
// The corridor along the road is covered by square cells (fine data); a wider square overview (coarser) covers
// the distant terrain. Rasters are georeferenced by lat/lon bounding boxes in EPSG:4326, which the track's
// local projection maps linearly, so pixel <-> metre mapping is exact.

import { makeProjection } from './geo.ts';
import type { LatLon } from './geo.ts';
import type { HeightSampler } from './elevation.ts';
import { decodePNG, encodePNG } from './png.ts';
import type { Rgba } from './dds.ts';

export interface GeoBox { west: number; south: number; east: number; north: number }
import type { OsmFeatures } from './osm.ts';
import type { SurfaceRaster } from './lidar.ts';

export interface DemRaster { bbox: GeoBox; width: number; height: number; heights: Float32Array }
export interface ImageRaster { bbox: GeoBox; width: number; height: number; rgba: Uint8Array }

export interface SiteCell {
    key: string; bbox: GeoBox; sizeM: number; dem?: DemRaster; rgb?: ImageRaster; nir?: ImageRaster;
    /** Lidar surface along the corridor (height above ground of the highest return, and its class). */
    surface?: SurfaceRaster;
}

export interface SiteRasters {
    version: 1;
    cells: SiteCell[];
    overview: { bbox: GeoBox; sizeM: number; dem?: DemRaster; rgb?: ImageRaster } | null;
    sources: { elevation: string; imagery: string; fetched: string };
    /** OpenStreetMap buildings, woods, trees and barriers over the overview square (ODbL). */
    osm?: OsmFeatures;
}

export interface SitePlan {
    cells: { key: string; bbox: GeoBox; sizeM: number }[];
    overview: { bbox: GeoBox; sizeM: number };
}

export const SITE_CELL_M = 512;
export const SITE_SOURCES = {
    elevation: 'USGS 3DEP 1 m bare-earth DEM (public domain), elevation.nationalmap.gov',
    imagery: 'USGS/USDA NAIP orthoimagery (public domain), imagery.nationalmap.gov',
};

/**
 * Cells (SITE_CELL_M squares on a local grid) that touch the corridor within `corridorM` of the line, plus a
 * square overview covering the line with `marginM` around it.
 */
export function planSite(line: LatLon[], opts: { corridorM?: number; marginM?: number; cellM?: number } = {}): SitePlan {
    const cellM = opts.cellM ?? SITE_CELL_M, corridor = opts.corridorM ?? 90, margin = opts.marginM ?? 450;
    const proj = makeProjection(line[0]);
    const pts = line.map((p) => proj.toLocal(p));
    const keys = new Map<string, { cx: number; cz: number }>();
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 20));
        for (let k = 0; k <= steps; k++) {
            const x = a.x + ((b.x - a.x) * k) / steps, y = a.y + ((b.y - a.y) * k) / steps;
            for (const dx of [-corridor, 0, corridor]) for (const dy of [-corridor, 0, corridor]) {
                const cx = Math.floor((x + dx) / cellM), cz = Math.floor((y + dy) / cellM);
                keys.set(`${cx}_${cz}`, { cx, cz });
            }
        }
    }
    const box = (x0: number, z0: number, x1: number, z1: number): GeoBox => {
        const sw = proj.toLatLon({ x: x0, y: z0 }), ne = proj.toLatLon({ x: x1, y: z1 });
        return { west: sw.lon, south: sw.lat, east: ne.lon, north: ne.lat };
    };
    const cells = [...keys.entries()].sort().map(([key, { cx, cz }]) => ({ key, sizeM: cellM, bbox: box(cx * cellM, cz * cellM, (cx + 1) * cellM, (cz + 1) * cellM) }));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.y); z1 = Math.max(z1, p.y); }
    const size = Math.max(x1 - x0, z1 - z0) + 2 * margin, cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
    return { cells, overview: { sizeM: size, bbox: box(cxm - size / 2, czm - size / 2, cxm + size / 2, czm + size / 2) } };
}

export const inBox = (b: GeoBox, p: LatLon) => p.lon >= b.west && p.lon <= b.east && p.lat >= b.south && p.lat <= b.north;

/** Bilinear sample of a DEM at a lat/lon (pixel centres; row 0 = north). */
export function sampleDem(d: DemRaster, p: LatLon): number | null {
    if (!inBox(d.bbox, p)) return null;
    const fx = ((p.lon - d.bbox.west) / (d.bbox.east - d.bbox.west)) * d.width - 0.5;
    const fy = ((d.bbox.north - p.lat) / (d.bbox.north - d.bbox.south)) * d.height - 0.5;
    const x0 = Math.max(0, Math.min(d.width - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(d.height - 1, Math.floor(fy)));
    const x1 = Math.min(d.width - 1, x0 + 1), y1 = Math.min(d.height - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const h = (x: number, y: number) => d.heights[y * d.width + x];
    const v = (h(x0, y0) * (1 - tx) + h(x1, y0) * tx) * (1 - ty) + (h(x0, y1) * (1 - tx) + h(x1, y1) * tx) * ty;
    return Number.isFinite(v) && v > -1000 ? v : null;
}

export function sampleImage(img: ImageRaster, p: LatLon): [number, number, number] | null {
    if (!inBox(img.bbox, p)) return null;
    const fx = ((p.lon - img.bbox.west) / (img.bbox.east - img.bbox.west)) * img.width - 0.5;
    const fy = ((img.bbox.north - p.lat) / (img.bbox.north - img.bbox.south)) * img.height - 0.5;
    const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(img.height - 1, Math.floor(fy)));
    const x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const out: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
        const g = (x: number, y: number) => img.rgba[(y * img.width + x) * 4 + c];
        out[c] = (g(x0, y0) * (1 - tx) + g(x1, y0) * tx) * (1 - ty) + (g(x0, y1) * (1 - tx) + g(x1, y1) * tx) * ty;
    }
    return out;
}

/** Heights from the fine cells, then the overview, then `fallback` (e.g. Terrarium tiles). */
export function siteHeightSampler(site: SiteRasters, fallback?: HeightSampler): HeightSampler {
    const dems = site.cells.filter((c) => c.dem).map((c) => c.dem!);
    let last: DemRaster | null = null;
    return (p) => {
        if (last) { const v = sampleDem(last, p); if (v != null) return v; }
        for (const d of dems) { const v = sampleDem(d, p); if (v != null) { last = d; return v; } }
        const o = site.overview?.dem ? sampleDem(site.overview.dem, p) : null;
        if (o != null) return o;
        return fallback ? fallback(p) : null;
    };
}

/** Aerial colour at a lat/lon from the cells, then the overview. */
export function siteImageSampler(site: SiteRasters): (p: LatLon) => [number, number, number] | null {
    const imgs = site.cells.filter((c) => c.rgb).map((c) => c.rgb!);
    return (p) => {
        for (const i of imgs) { const v = sampleImage(i, p); if (v) return v; }
        return site.overview?.rgb ? sampleImage(site.overview.rgb, p) : null;
    };
}

// ---------------------------------------------------------------- storage encoding

/** DEM as a Terrarium-encoded PNG (lossless to 1/256 m), the same encoding the elevation tiles use. */
export function demToPng(d: DemRaster): Uint8Array {
    const data = new Uint8Array(d.width * d.height * 4);
    for (let i = 0; i < d.width * d.height; i++) {
        const h = Number.isFinite(d.heights[i]) && d.heights[i] > -1000 ? d.heights[i] : -32768;
        const v = Math.max(0, Math.min(65535.996, h + 32768));
        const r = Math.floor(v / 256), g = Math.floor(v) % 256, b = Math.floor((v - Math.floor(v)) * 256);
        data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
    }
    return encodePNG({ width: d.width, height: d.height, data });
}

export function pngToDem(png: Uint8Array, bbox: GeoBox): DemRaster {
    const img = decodePNG(png);
    const heights = new Float32Array(img.width * img.height);
    for (let i = 0; i < heights.length; i++) {
        const v = img.data[i * 4] * 256 + img.data[i * 4 + 1] + img.data[i * 4 + 2] / 256 - 32768;
        heights[i] = v <= -32767 ? NaN : v;
    }
    return { bbox, width: img.width, height: img.height, heights };
}

// ---------------------------------------------------------------- fetching (browser, or Node where reachable)

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export interface SiteDecoders {
    /** Float32 GeoTIFF -> heights, row 0 = north. */
    tiff: (bytes: ArrayBuffer) => Promise<{ width: number; height: number; data: Float32Array }>;
    /** JPEG -> RGBA. */
    jpeg: (bytes: ArrayBuffer) => Promise<Rgba>;
}

const DEM_SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
const NAIP_SERVICE = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
const bboxParam = (b: GeoBox) => `${b.west.toFixed(7)},${b.south.toFixed(7)},${b.east.toFixed(7)},${b.north.toFixed(7)}`;

/**
 * Pixel size for a bbox: `rows` tall and as wide as keeps pixels square in degrees. Matching the bbox aspect
 * ratio means ArcGIS returns exactly the requested extent instead of adjusting it.
 */
export function rasterSize(b: GeoBox, rows: number): [number, number] {
    const w = Math.round((rows * (b.east - b.west)) / (b.north - b.south));
    return [Math.max(1, w), rows];
}
export function demUrl(b: GeoBox, rows: number) {
    const [w, h] = rasterSize(b, rows);
    return `${DEM_SERVICE}?bbox=${bboxParam(b)}&bboxSR=4326&imageSR=4326&size=${w},${h}&format=tiff&pixelType=F32&noDataInterpretation=esriNoDataMatchAny&interpolation=RSP_BilinearInterpolation&f=image`;
}
export function naipUrl(b: GeoBox, rows: number, band?: number) {
    const [w, h] = rasterSize(b, rows);
    return `${NAIP_SERVICE}?bbox=${bboxParam(b)}&bboxSR=4326&imageSR=4326&size=${w},${h}&format=jpg${band != null ? `&bandIds=${band}` : ''}&f=image`;
}

/** Raw bytes for every raster in the plan (what gets stored). Runs `concurrency` requests at a time. */
export async function fetchSiteBytes(fetchFn: FetchLike, plan: SitePlan, onProgress: (done: number, total: number, what: string) => void, concurrency = 4) {
    type Job = { key: string; kind: 'dem' | 'rgb' | 'nir'; url: string };
    const jobs: Job[] = [];
    for (const c of plan.cells) {
        jobs.push({ key: c.key, kind: 'dem', url: demUrl(c.bbox, 512) }); // ~1 m
        jobs.push({ key: c.key, kind: 'rgb', url: naipUrl(c.bbox, 1024) }); // ~0.5 m
        jobs.push({ key: c.key, kind: 'nir', url: naipUrl(c.bbox, 512, 3) });
    }
    jobs.push({ key: 'overview', kind: 'dem', url: demUrl(plan.overview.bbox, Math.min(2048, Math.ceil(plan.overview.sizeM / 4))) });
    jobs.push({ key: 'overview', kind: 'rgb', url: naipUrl(plan.overview.bbox, Math.min(2800, Math.max(1024, Math.ceil(plan.overview.sizeM / 2)))) });
    const out = new Map<string, ArrayBuffer>();
    let done = 0, next = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const j = jobs[next++];
            let lastErr: unknown = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const r = await fetchFn(j.url);
                    if (!r.ok) throw new Error(`${new URL(j.url).host} answered ${r.status}`);
                    const type = r.headers.get('content-type') ?? '';
                    if (!/image|tiff|octet/.test(type)) throw new Error(`${new URL(j.url).host} sent ${type || 'no content type'}`);
                    out.set(`${j.key}/${j.kind}`, await r.arrayBuffer());
                    lastErr = null;
                    break;
                } catch (e) { lastErr = e; await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); }
            }
            if (lastErr) throw lastErr;
            onProgress(++done, jobs.length, `${j.key} ${j.kind}`);
        }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return out;
}

/** Decode stored/fetched bytes into rasters. DEM bytes may be a GeoTIFF (fresh) or a Terrarium PNG (stored). */
export async function decodeSite(plan: SitePlan, bytes: Map<string, ArrayBuffer>, dec: SiteDecoders, fetched: string): Promise<SiteRasters> {
    const dem = async (b: ArrayBuffer | undefined, bbox: GeoBox): Promise<DemRaster | undefined> => {
        if (!b) return undefined;
        const u = new Uint8Array(b);
        if (u[0] === 0x89 && u[1] === 0x50) return pngToDem(u, bbox);
        const t = await dec.tiff(b);
        return { bbox, width: t.width, height: t.height, heights: t.data };
    };
    const img = async (b: ArrayBuffer | undefined, bbox: GeoBox): Promise<ImageRaster | undefined> => {
        if (!b) return undefined;
        const r = await dec.jpeg(b);
        return { bbox, width: r.width, height: r.height, rgba: r.data };
    };
    const cells: SiteCell[] = [];
    for (const c of plan.cells) {
        cells.push({ ...c, dem: await dem(bytes.get(`${c.key}/dem`), c.bbox), rgb: await img(bytes.get(`${c.key}/rgb`), c.bbox), nir: await img(bytes.get(`${c.key}/nir`), c.bbox) });
    }
    return {
        version: 1, cells,
        overview: { ...plan.overview, dem: await dem(bytes.get('overview/dem'), plan.overview.bbox), rgb: await img(bytes.get('overview/rgb'), plan.overview.bbox) },
        sources: { ...SITE_SOURCES, fetched },
    };
}
