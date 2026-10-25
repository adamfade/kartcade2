// Minimal KN5 reader used only by the tests (round-trip check of the writer).
export interface ReadNode { type: number; name: string; children: ReadNode[]; matrix?: number[]; vertexCount?: number; indexCount?: number; materialId?: number; maxIndex?: number; badNumbers?: number }

export function readKn5(bytes: Uint8Array) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 0;
    const td = new TextDecoder();
    const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
    const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
    const f32 = () => { const v = dv.getFloat32(o, true); o += 4; return v; };
    const u8 = () => bytes[o++];
    const str = () => { const n = i32(); const s = td.decode(bytes.subarray(o, o + n)); o += n; return s; };
    const magic = td.decode(bytes.subarray(0, 6)); o = 6;
    const version = i32();
    if (version > 5) i32();
    const textures: { name: string; size: number }[] = [];
    for (let i = 0, n = i32(); i < n; i++) { i32(); const name = str(); const size = i32(); o += size; textures.push({ name, size }); }
    const materials: { name: string; shader: string; textures: string[] }[] = [];
    for (let i = 0, n = i32(); i < n; i++) {
        const name = str(), shader = str(); u8(); u8(); i32();
        for (let p = 0, np = i32(); p < np; p++) { str(); o += 10 * 4; }
        const tex: string[] = [];
        for (let t = 0, nt = i32(); t < nt; t++) { str(); i32(); tex.push(str()); }
        materials.push({ name, shader, textures: tex });
    }
    const node = (): ReadNode => {
        const type = i32(), name = str(), childCount = i32(); u8();
        const n: ReadNode = { type, name, children: [] };
        if (type === 1) { n.matrix = Array.from({ length: 16 }, f32); }
        else if (type === 2) {
            u8(); u8(); u8();
            const vc = i32(); n.vertexCount = vc;
            let bad = 0;
            for (let v = 0; v < vc * 11; v++) { if (!Number.isFinite(f32())) bad++; }
            const ic = i32(); n.indexCount = ic;
            let mx = 0; for (let k = 0; k < ic; k++) mx = Math.max(mx, u16());
            n.maxIndex = mx; n.badNumbers = bad;
            n.materialId = i32(); i32(); f32(); f32(); f32(); f32(); f32(); f32(); u8();
        } else throw new Error(`Unknown node type ${type}`);
        for (let c = 0; c < childCount; c++) n.children.push(node());
        return n;
    };
    const root = node();
    return { magic, version, textures, materials, root, consumed: o, total: bytes.length };
}
