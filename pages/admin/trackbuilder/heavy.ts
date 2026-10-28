// Promise wrapper around heavy.worker.ts (one shared worker).

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function get(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./heavy.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result); else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => { pending.forEach((p) => p.reject(new Error(e.message || 'worker failed'))); pending.clear(); worker = null; };
    return worker;
}

export function runHeavy<T>(op: string, args: unknown, transfer: Transferable[] = []): Promise<T> {
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        get().postMessage({ id, op, args }, transfer);
    });
}
