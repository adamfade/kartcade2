// Site data in the browser: fetch 1 m lidar + NAIP imagery from USGS once per route, store it in Firebase Storage
// (trackbuilder/sites/<siteId>/), and load it for every later build. The site id is a hash of the route line, so
// any project on the same road reuses the same data.

import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../../config/firebase';
import { decodeSite, demToPng, fetchSiteBytes, planSite, pngToDem } from '../../../tools/trackbuilder/site.ts';
import type { SitePlan, SiteRasters } from '../../../tools/trackbuilder/site.ts';
import type { LatLon } from '../../../tools/trackbuilder/geo.ts';
import type { Rgba } from '../../../tools/trackbuilder/dds.ts';
import { OSM_VERSION, fetchOsm } from '../../../tools/trackbuilder/osm.ts';
import type { OsmFeatures } from '../../../tools/trackbuilder/osm.ts';
import { gunzipSync, gzipSync } from 'fflate';
import { fetchSurfaces, pngsToSurface, surfaceToPngs } from '../../../tools/trackbuilder/lidar.ts';
import type { LazPerfModule, SurfaceMeta } from '../../../tools/trackbuilder/lidar.ts';
import lazWasmUrl from 'laz-perf/lib/web/laz-perf.wasm?url';

const ROOT = 'trackbuilder/sites';

export interface SiteManifest { version: 1; siteId: string; fetched: string; plan: SitePlan; files: string[] }

export async function siteIdFor(line: LatLon[]): Promise<string> {
    const text = line.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(';');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(hash)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function decodeJpeg(bytes: ArrayBuffer): Promise<Rgba> {
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    return { width: bmp.width, height: bmp.height, data: new Uint8Array(d.buffer.slice(0)) };
}

async function decodeTiff(bytes: ArrayBuffer) {
    const { fromArrayBuffer } = await import('geotiff');
    const tiff = await fromArrayBuffer(bytes);
    const img = await tiff.getImage();
    const [r] = await img.readRasters();
    return { width: img.getWidth(), height: img.getHeight(), data: Float32Array.from(r as ArrayLike<number>) };
}

const decoders = { tiff: decodeTiff, jpeg: decodeJpeg };

/**
 * Load the stored site for this line, or fetch it from USGS and store it. If storing is refused (rules not
 * published, not an admin), the fetched data is still returned for this session and `stored` is false.
 */
export async function ensureSite(line: LatLon[], log: (m: string) => void): Promise<{ site: SiteRasters; siteId: string; stored: boolean; fresh: boolean }> {
    const siteId = await siteIdFor(line);
    const existing = await loadSite(siteId, log).catch(() => null);
    if (existing) {
        await attachOsm(existing, siteId, line, log, true);
        await attachSurfaces(existing, siteId, line, log, true);
        return { site: existing, siteId, stored: true, fresh: false };
    }

    const plan = planSite(line);
    log(`Fetching real ground for ${plan.cells.length} areas (1 m lidar + aerial photo) from USGS`);
    let lastPct = -1;
    const bytes = await fetchSiteBytes((u, i) => fetch(u, i), plan, (done, total) => {
        const pct = Math.floor((done / total) * 10) * 10;
        if (pct !== lastPct) { lastPct = pct; log(`  ${pct}% (${done}/${total})`); }
    });
    const fetched = new Date().toISOString();
    log('Decoding elevation and imagery');
    const site = await decodeSite(plan, bytes, decoders, fetched);

    // Store: DEMs as Terrarium PNG (lossless, compact), imagery as the JPEGs USGS sent.
    let stored = true;
    try {
        log('Saving the site data for next time');
        const uploads: { name: string; data: () => Uint8Array; type: string }[] = [];
        for (const c of site.cells) {
            if (c.dem) uploads.push({ name: `${c.key}/dem.png`, data: () => demToPng(c.dem!), type: 'image/png' });
            const rgb = bytes.get(`${c.key}/rgb`), nir = bytes.get(`${c.key}/nir`);
            if (rgb) uploads.push({ name: `${c.key}/rgb.jpg`, data: () => new Uint8Array(rgb), type: 'image/jpeg' });
            if (nir) uploads.push({ name: `${c.key}/nir.jpg`, data: () => new Uint8Array(nir), type: 'image/jpeg' });
        }
        if (site.overview?.dem) uploads.push({ name: 'overview/dem.png', data: () => demToPng(site.overview!.dem!), type: 'image/png' });
        const ov = bytes.get('overview/rgb');
        if (ov) uploads.push({ name: 'overview/rgb.jpg', data: () => new Uint8Array(ov), type: 'image/jpeg' });
        const files: string[] = [];
        let next = 0;
        await Promise.all(Array.from({ length: 6 }, async () => {
            while (next < uploads.length) {
                const u = uploads[next++];
                await uploadBytes(ref(storage, `${ROOT}/${siteId}/${u.name}`), u.data(), { contentType: u.type, cacheControl: 'public, max-age=31536000, immutable' });
                files.push(u.name);
            }
        }));
        const manifest: SiteManifest = { version: 1, siteId, fetched, plan, files };
        await uploadBytes(ref(storage, `${ROOT}/${siteId}/manifest.json`), new TextEncoder().encode(JSON.stringify(manifest)), { contentType: 'application/json', cacheControl: 'no-cache' });
    } catch (e) {
        stored = false;
        log(`Couldn't save the site data (${(e as { code?: string }).code ?? (e as Error).message}); it is used for this session only`);
    }
    await attachOsm(site, siteId, line, log, stored);
    await attachSurfaces(site, siteId, line, log, stored);
    return { site, siteId, stored, fresh: true };
}

/**
 * OpenStreetMap buildings, woods, trees and barriers for the site's overview square, stored as osm.json.gz next to
 * the rasters. Sites saved before this existed get it on their next load. A failed fetch leaves the site without
 * map features (the track still builds) and is retried next time.
 */
async function attachOsm(site: SiteRasters, siteId: string, line: LatLon[], log: (m: string) => void, store: boolean) {
    if ((site.osm?.version ?? 0) >= OSM_VERSION || !site.overview) return;
    const path = `${ROOT}/${siteId}/osm.json.gz`;
    try {
        const stored = JSON.parse(new TextDecoder().decode(gunzipSync(new Uint8Array(await getBytes(ref(storage, path)))))) as OsmFeatures;
        site.osm = stored;
        if ((stored.version ?? 1) >= OSM_VERSION) return;
        log('Stored map features are from an older version; fetching roads, signals and signs too');
    } catch (e) {
        if ((e as { code?: string }).code !== 'storage/object-not-found') { log(`Couldn't read stored map features (${(e as Error).message}); fetching again`); }
    }
    try {
        log('Fetching buildings, woods and barriers from OpenStreetMap');
        const osm = await fetchOsm((u, i) => fetch(u, i), site.overview.bbox, line);
        site.osm = osm;
        log(`  ${osm.buildings.length} buildings, ${osm.woods.length} woods, ${osm.trees.length} single trees, ${osm.barriers.length} barriers, ${osm.roads?.length ?? 0} roads, ${osm.points?.length ?? 0} signals, signs and lamps`);
        if (store) {
            await uploadBytes(ref(storage, path), gzipSync(new TextEncoder().encode(JSON.stringify(osm)), { level: 9 }), { contentType: 'application/gzip', cacheControl: 'no-cache' })
                .catch((e) => log(`Couldn't save the map features (${(e as { code?: string }).code ?? (e as Error).message})`));
        }
    } catch (e) {
        log(`OpenStreetMap unavailable (${(e as Error).message}); building without buildings and woods this time`);
    }
}

const memo = new Map<string, Promise<SiteRasters | null>>();

export function loadSite(siteId: string, log?: (m: string) => void): Promise<SiteRasters | null> {
    const hit = memo.get(siteId);
    if (hit) return hit;
    const p = (async () => {
        let manifest: SiteManifest;
        try {
            manifest = JSON.parse(new TextDecoder().decode(await getBytes(ref(storage, `${ROOT}/${siteId}/manifest.json`))));
        } catch (e) {
            if ((e as { code?: string }).code === 'storage/object-not-found') return null;
            throw e;
        }
        log?.(`Loading stored site data (${manifest.plan.cells.length} areas, fetched ${new Date(manifest.fetched).toLocaleDateString()})`);
        const bytes = new Map<string, ArrayBuffer>();
        await Promise.all(manifest.files.map(async (f) => {
            const b = await getBytes(ref(storage, `${ROOT}/${siteId}/${f}`));
            bytes.set(f.replace(/\.(png|jpg)$/, ''), b);
        }));
        return decodeSite(manifest.plan, bytes, decoders, manifest.fetched);
    })();
    memo.set(siteId, p.catch((e) => { memo.delete(siteId); throw e; }));
    return p;
}

export { pngToDem };

let lazPerf: Promise<LazPerfModule> | null = null;
function loadLazPerf(): Promise<LazPerfModule> {
    lazPerf ??= import('laz-perf').then((m) => {
        // CommonJS package: the factory may sit on the namespace or on its default export depending on the bundler.
        const mod = m as unknown as { createLazPerf?: unknown; default?: { createLazPerf?: unknown } };
        const create = (mod.createLazPerf ?? mod.default?.createLazPerf) as (o: object) => Promise<LazPerfModule>;
        return create({ locateFile: () => lazWasmUrl });
    });
    return lazPerf;
}

/**
 * Lidar surface (height above ground + what was hit) along the corridor, from the 3DEP point cloud: stored per cell
 * as surface.png and class.png with a surface.json listing them. Sites saved before this get it on their next load;
 * when no point cloud covers the road (or the fetch fails) the build estimates heights as before.
 */
async function attachSurfaces(site: SiteRasters, siteId: string, line: LatLon[], log: (m: string) => void, store: boolean) {
    if (site.cells.some((c) => c.surface)) return;
    const metaPath = `${ROOT}/${siteId}/surface.json`;
    try {
        const meta = JSON.parse(new TextDecoder().decode(await getBytes(ref(storage, metaPath)))) as SurfaceMeta & { none?: boolean };
        if (meta.none) return;
        await Promise.all(site.cells.filter((c) => meta.cells.includes(c.key)).map(async (c) => {
            const [a, k] = await Promise.all([`${c.key}/surface.png`, `${c.key}/class.png`].map(async (f) => new Uint8Array(await getBytes(ref(storage, `${ROOT}/${siteId}/${f}`)))));
            c.surface = pngsToSurface(a, k, c.bbox);
        }));
        return;
    } catch (e) {
        if ((e as { code?: string }).code !== 'storage/object-not-found') log(`Couldn't read the stored lidar surface (${(e as Error).message}); fetching it again`);
    }
    try {
        const lp = await loadLazPerf();
        const res = await fetchSurfaces((u, i) => fetch(u, i), lp, site, line, log);
        if (!res) {
            if (store) await uploadBytes(ref(storage, metaPath), new TextEncoder().encode(JSON.stringify({ version: 1, none: true, cells: [] })), { contentType: 'application/json' }).catch(() => {});
            return;
        }
        for (const c of site.cells) { const sfc = res.surfaces.get(c.key); if (sfc) c.surface = sfc; }
        log(`Lidar surface ready (${res.meta.workunit.replace(/_/g, ' ')}): real building and tree heights`);
        if (!store) return;
        const uploads: Promise<unknown>[] = [];
        for (const [key, sfc] of res.surfaces) {
            const p = surfaceToPngs(sfc);
            uploads.push(uploadBytes(ref(storage, `${ROOT}/${siteId}/${key}/surface.png`), p.above, { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' }));
            uploads.push(uploadBytes(ref(storage, `${ROOT}/${siteId}/${key}/class.png`), p.cls, { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' }));
        }
        await Promise.all(uploads);
        await uploadBytes(ref(storage, metaPath), new TextEncoder().encode(JSON.stringify(res.meta)), { contentType: 'application/json', cacheControl: 'no-cache' });
    } catch (e) {
        log(`Lidar point cloud unavailable (${(e as Error).message}); building and tree heights will be estimated this time`);
    }
}
