// Web worker for CPU-heavy track builder work, so the page stays responsive.
// Messages: { id, op, args } -> { id, ok, result } | { id, ok: false, error }.

import { encodeDds } from '../../../tools/trackbuilder/dds.ts';
import { processPhotoMaterial } from '../../../tools/trackbuilder/materials.ts';

type Msg = { id: number; op: string; args: any };

self.onmessage = (e: MessageEvent<Msg>) => {
    const { id, op, args } = e.data;
    try {
        let result: any;
        if (op === 'encodeDds') result = encodeDds(args.img, args.opts);
        else if (op === 'processMaterial') result = processPhotoMaterial(args);
        else throw new Error(`unknown op ${op}`);
        const transfer = [result, ...Object.values(result ?? {})].filter((x: any) => x instanceof Uint8Array).map((x: any) => x.buffer);
        (self as any).postMessage({ id, ok: true, result }, transfer);
    } catch (err) {
        (self as any).postMessage({ id, ok: false, error: (err as Error).message });
    }
};
