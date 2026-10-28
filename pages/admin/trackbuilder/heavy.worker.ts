// Web worker for CPU-heavy track builder work, so the page stays responsive.
// Messages: { id, op, args } -> { id, ok, result } | { id, ok: false, error }.

import { encodeDds } from '../../../tools/trackbuilder/dds.ts';
import { processPhotoMaterial } from '../../../tools/trackbuilder/materials.ts';
import { buildTrack } from '../../../tools/trackbuilder/pack.ts';
import type { BuildInput } from '../../../tools/trackbuilder/pack.ts';
import { terrariumSampler } from '../../../tools/trackbuilder/elevation.ts';
import type { TilePixels } from '../../../tools/trackbuilder/elevation.ts';

/** A full track build from plain data (the page can't send functions): returns the zip and stats. */
function buildFromData(a: { input: Omit<BuildInput, 'heightSampler' | 'log'>; z: number; tiles: Map<string, TilePixels>; id: number }) {
    const log: string[] = [];
    const res = buildTrack({ ...a.input, heightSampler: terrariumSampler(a.z, a.tiles), log: (m) => { log.push(m); (self as any).postMessage({ id: a.id, progress: m }); } });
    return { zip: res.zip, id: res.id, stats: res.stats, log };
}

type Msg = { id: number; op: string; args: any };

self.onmessage = (e: MessageEvent<Msg>) => {
    const { id, op, args } = e.data;
    try {
        let result: any;
        if (op === 'encodeDds') result = encodeDds(args.img, args.opts);
        else if (op === 'processMaterial') result = processPhotoMaterial(args);
        else if (op === 'buildTrack') result = buildFromData({ ...args, id });
        else throw new Error(`unknown op ${op}`);
        const transfer = [result, ...Object.values(result ?? {})].filter((x: any) => x instanceof Uint8Array && x.byteLength).map((x: any) => x.buffer);
        (self as any).postMessage({ id, ok: true, result }, transfer);
    } catch (err) {
        (self as any).postMessage({ id, ok: false, error: (err as Error).message });
    }
};
