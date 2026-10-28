// Site data in the browser: fetch 1 m lidar + NAIP imagery from USGS once per route, store it in Firebase Storage
// (trackbuilder/sites/<siteId>/), and load it for every later build. The site id is a hash of the route line, so
// any project on the same road reuses the same data.

import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../../config/firebase';
import { decodeSite, demToPng, fetchSiteBytes, planSite, pngToDem } from '../../../tools/trackbuilder/site.ts';
import type { SitePlan, SiteRasters } from '../../../tools/trackbuilder/site.ts';
import type { LatLon } from '../../../tools/trackbuilder/geo.ts';
import type { Rgba } from '../../../tools/trackbuilder/dds.ts';

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
    if (existing) return { site: existing, siteId, stored: true, fresh: false };

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
    return { site, siteId, stored, fresh: true };
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
