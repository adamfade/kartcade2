// The photo-scanned material library: imported once from Poly Haven (CC0) by an admin, processed to DDS in a
// worker, stored in Firebase Storage under trackbuilder/library/<version>/, and loaded by every build.

import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../../config/firebase';
import { LIBRARY_CATALOG, LIBRARY_VERSION } from '../../../tools/trackbuilder/materials.ts';
import type { LibraryEntry, MaterialLibrary, SurfaceRole } from '../../../tools/trackbuilder/materials.ts';
import type { Rgba } from '../../../tools/trackbuilder/dds.ts';
import { runHeavy } from './heavy';

const ROOT = `trackbuilder/library/${LIBRARY_VERSION}`;
const FILES = ['albedo', 'detail', 'normal', 'maps'] as const;

export interface LibraryManifest {
    version: string;
    created: string;
    createdBy?: string | null;
    entries: Partial<Record<SurfaceRole, Omit<LibraryEntry, 'albedo' | 'detail' | 'normal' | 'maps'>>>;
}

async function decodeImage(bytes: ArrayBuffer, type: string): Promise<Rgba> {
    const bmp = await createImageBitmap(new Blob([bytes], { type }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    return { width: bmp.width, height: bmp.height, data: new Uint8Array(d.buffer.slice(0)) };
}

async function fetchOk(url: string) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
    return r;
}

/** Import (or re-import) the whole catalogue. Calls onProgress with a line per step. */
export async function importLibrary(email: string | null | undefined, onProgress: (msg: string) => void): Promise<LibraryManifest> {
    const manifest: LibraryManifest = { version: LIBRARY_VERSION, created: new Date().toISOString(), createdBy: email ?? null, entries: {} };
    for (const [role, cat] of Object.entries(LIBRARY_CATALOG) as [SurfaceRole, typeof LIBRARY_CATALOG[SurfaceRole]][]) {
        onProgress(`${cat.label}: downloading ${cat.asset} from Poly Haven`);
        const files = await (await fetchOk(`https://api.polyhaven.com/files/${cat.asset}`)).json();
        const info = await (await fetchOk(`https://api.polyhaven.com/info/${cat.asset}`)).json();
        const res = '2k';
        const url = (key: string) => files[key]?.[res]?.jpg?.url as string | undefined;
        const need = { diffuse: url('Diffuse'), normal: url('nor_dx'), arm: url('arm'), rough: url('Rough') };
        if (!need.diffuse || !need.normal || (!need.arm && !need.rough)) throw new Error(`${cat.asset} is missing a map on Poly Haven`);
        const [diffuse, normal, arm, rough] = await Promise.all([need.diffuse, need.normal, need.arm, need.arm ? undefined : need.rough].map(async (u) => (u ? decodeImage(await (await fetchOk(u)).arrayBuffer(), 'image/jpeg') : null)));
        onProgress(`${cat.label}: processing to ${cat.size}px DDS with mipmaps`);
        const out = await runHeavy<{ mean: [number, number, number]; albedo: Uint8Array; detail: Uint8Array; normal: Uint8Array; maps: Uint8Array }>(
            'processMaterial', { size: cat.size, diffuse, normal, arm, rough },
            [diffuse!, normal!, arm, rough].filter(Boolean).map((x) => (x as Rgba).data.buffer),
        );
        onProgress(`${cat.label}: uploading`);
        for (const f of FILES) {
            await uploadBytes(ref(storage, `${ROOT}/${role}/${f}.dds`), out[f], { contentType: 'application/octet-stream', cacheControl: 'public, max-age=31536000, immutable' });
        }
        const mm = Array.isArray(info.dimensions) ? info.dimensions[0] : 2000;
        manifest.entries[role] = {
            role, label: cat.label, tileM: Math.round(mm) / 1000, mean: out.mean,
            source: { provider: 'polyhaven', asset: cat.asset, url: `https://polyhaven.com/a/${cat.asset}`, license: 'CC0', author: Object.keys(info.authors ?? {}).join(', ') || undefined },
        };
    }
    await uploadBytes(ref(storage, `${ROOT}/manifest.json`), new TextEncoder().encode(JSON.stringify(manifest, null, 2)), { contentType: 'application/json', cacheControl: 'no-cache' });
    onProgress('Library saved');
    memo = null;
    return manifest;
}

export async function loadManifest(): Promise<LibraryManifest | null> {
    try {
        const bytes = await getBytes(ref(storage, `${ROOT}/manifest.json`));
        return JSON.parse(new TextDecoder().decode(bytes)) as LibraryManifest;
    } catch (e) {
        if ((e as { code?: string }).code === 'storage/object-not-found') return null;
        throw e;
    }
}

let memo: Promise<MaterialLibrary> | null = null;

/** The library for builds (cached for the session). Empty object if nothing has been imported yet. */
export function loadLibrary(roles?: SurfaceRole[]): Promise<MaterialLibrary> {
    if (memo && !roles) return memo;
    const p = (async () => {
        const manifest = await loadManifest();
        const lib: MaterialLibrary = {};
        if (!manifest) return lib;
        const want = (roles ?? (Object.keys(manifest.entries) as SurfaceRole[])).filter((r) => manifest.entries[r]);
        await Promise.all(want.map(async (role) => {
            const meta = manifest.entries[role]!;
            const [albedo, detail, normal, maps] = await Promise.all(FILES.map(async (f) => new Uint8Array(await getBytes(ref(storage, `${ROOT}/${role}/${f}.dds`)))));
            lib[role] = { ...meta, albedo, detail, normal, maps };
        }));
        return lib;
    })();
    if (!roles) memo = p.catch((e) => { memo = null; throw e; });
    return p;
}

export const LIBRARY_ROLES_FOR_BUILD: SurfaceRole[] = ['asphalt', 'asphalt_track', 'gravel', 'grass', 'concrete'];
