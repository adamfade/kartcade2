// Surface materials: a photo-scanned material library plus the Assetto Corsa material recipes built on it.
//
// Every ground surface (road, shoulder, verge, terrain, road paint) uses one recipe, AC's
// ksPerPixelMultiMap_NMDetail, laid out the way Kunos tracks do it:
//   - txDiffuse: a large-scale "macro" texture for colour and wear, alpha 0 so the detail shows through
//   - txDetail:  a tiled photo-scanned albedo, normalised to a mean of 0.5 so the macro sets the colour
//                (AC multiplies: colour = macro.rgb * lerp(detail.rgb, 1, macro.a))
//   - txNormalDetail: the photo-scan normal map, tiled with the detail
//   - txMaps:    specular / gloss / reflection multipliers (R/G/B) at macro scale
// UVs are in metres / macroSize, so detail tiling is detailUVMultiplier = macroSize / tileM.
// Later stages only swap the macro (generated now; aerial imagery for terrain) or the library entry.

import { encodeDds, resize } from './dds.ts';
import type { Rgba } from './dds.ts';
import type { Kn5Material, Kn5Texture } from './kn5.ts';

export type SurfaceRole = 'asphalt' | 'asphalt_track' | 'gravel' | 'grass' | 'dirt' | 'forest_floor' | 'rock' | 'concrete' | 'bark';

/** One library material, already processed to DDS. */
export interface LibraryEntry {
    role: SurfaceRole;
    label: string;
    /** Real-world size of one texture repeat, metres. */
    tileM: number;
    /** Mean colour of the raw albedo (sRGB 0..255), for picking macro colours. */
    mean: [number, number, number];
    /** Albedo as photographed (for direct use). */
    albedo: Uint8Array;
    /** Albedo normalised per channel to a mean of 0.5 (for use as a detail layer). */
    detail: Uint8Array;
    /** Tangent-space normal map, DirectX convention (green down). */
    normal: Uint8Array;
    /** R specular, G gloss, B reflection multipliers. */
    maps: Uint8Array;
    source: { provider: 'polyhaven' | 'procedural'; asset?: string; url?: string; license: string; author?: string };
}

export type MaterialLibrary = Partial<Record<SurfaceRole, LibraryEntry>>;

/** The Poly Haven assets (all CC0) the library is built from. Change here, re-import, rebuild. */
export const LIBRARY_CATALOG: Record<SurfaceRole, { asset: string; label: string; size: number }> = {
    asphalt: { asset: 'asphalt_02', label: 'Aged road asphalt', size: 2048 },
    asphalt_track: { asset: 'asphalt_track', label: 'Track asphalt', size: 2048 },
    gravel: { asset: 'gravel_road', label: 'Gravel shoulder', size: 1024 },
    grass: { asset: 'leafy_grass', label: 'Grass', size: 1024 },
    dirt: { asset: 'dirt_floor', label: 'Dirt', size: 1024 },
    forest_floor: { asset: 'forrest_ground_01', label: 'Forest floor', size: 1024 },
    rock: { asset: 'rock_face_03', label: 'Rock face (cuttings)', size: 1024 },
    concrete: { asset: 'concrete', label: 'Concrete', size: 1024 },
    bark: { asset: 'pine_bark', label: 'Pine bark', size: 1024 },
};

export const LIBRARY_VERSION = 'v1';

// ---------------------------------------------------------------- processing (shared by the importer)

/** Albedo normalised per channel so its mean is 0.5 (128). Keeps contrast, removes the photo's tint. */
export function normaliseDetail(img: Rgba): { detail: Rgba; mean: [number, number, number] } {
    const n = img.width * img.height, sum = [0, 0, 0];
    for (let i = 0; i < n; i++) { sum[0] += img.data[i * 4]; sum[1] += img.data[i * 4 + 1]; sum[2] += img.data[i * 4 + 2]; }
    const mean = sum.map((v) => v / n) as [number, number, number];
    const out = new Uint8Array(img.data.length);
    for (let i = 0; i < n; i++) {
        for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round((img.data[i * 4 + c] * 128) / Math.max(1, mean[c]))));
        out[i * 4 + 3] = 255;
    }
    return { detail: { width: img.width, height: img.height, data: out }, mean: mean.map(Math.round) as [number, number, number] };
}

/** AC txMaps from PBR roughness (+ optional AO): R specular level, G gloss, B reflection. */
export function mapsFromRoughness(rough: Rgba, ao?: Rgba): Rgba {
    const out = new Uint8Array(rough.data.length);
    for (let i = 0; i < rough.width * rough.height; i++) {
        const r = rough.data[i * 4] / 255, a = ao ? ao.data[i * 4] / 255 : 1;
        const smooth = 1 - r;
        out[i * 4] = Math.round(255 * Math.min(1, (0.15 + 0.85 * smooth) * a));
        out[i * 4 + 1] = Math.round(255 * smooth);
        out[i * 4 + 2] = Math.round(255 * smooth * smooth * a);
        out[i * 4 + 3] = 255;
    }
    return { width: rough.width, height: rough.height, data: out };
}

/**
 * One library material from decoded Poly Haven maps: resize to `size` (power of two), normalise the detail,
 * derive AC maps from ARM (R = AO, G = roughness) or roughness alone, and encode every DDS with mipmaps.
 */
export function processPhotoMaterial(a: { size: number; diffuse: Rgba; normal: Rgba; arm: Rgba | null; rough: Rgba | null }) {
    const S = a.size;
    const diffuse = resize(a.diffuse, S, S);
    const normal = resize(a.normal, S, S);
    const { detail, mean } = normaliseDetail(diffuse);
    const half = Math.max(256, S / 2);
    let rough: Rgba, ao: Rgba | undefined;
    const channel = (img: Rgba, c: number): Rgba => {
        const out = new Uint8Array(img.data.length);
        for (let i = 0; i < img.width * img.height; i++) { const v = img.data[i * 4 + c]; out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255; }
        return { width: img.width, height: img.height, data: out };
    };
    if (a.arm) { const arm = resize(a.arm, half, half); rough = channel(arm, 1); ao = channel(arm, 0); }
    else if (a.rough) rough = channel(resize(a.rough, half, half), 0);
    else throw new Error('need an ARM or roughness map');
    return {
        mean,
        albedo: encodeDds(diffuse, { format: 'bc1', mips: 'color' }),
        detail: encodeDds(detail, { format: 'bc1', mips: 'color' }),
        normal: encodeDds(normal, { format: 'bc1', mips: 'normal' }),
        maps: encodeDds(mapsFromRoughness(rough, ao), { format: 'bc1', mips: 'linear' }),
    };
}

// ---------------------------------------------------------------- procedural fallback library

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** Tileable multi-octave value noise, 0..1. */
export function tileNoise(size: number, seed: number, octaves: number[]): Float32Array {
    const out = new Float32Array(size * size);
    const rand = rng(seed);
    let wsum = 0;
    octaves.forEach((cells, o) => {
        const w = 1 / (o + 1); wsum += w;
        const g = new Float32Array(cells * cells).map(() => rand());
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const gx = (x / size) * cells, gy = (y / size) * cells, x0 = Math.floor(gx), y0 = Math.floor(gy);
            const fx = gx - x0, fy = gy - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
            const at = (i: number, j: number) => g[((j % cells) * cells) + (i % cells)];
            out[y * size + x] += w * ((at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy);
        }
    });
    for (let i = 0; i < out.length; i++) out[i] /= wsum;
    return out;
}

/** Normal map from a height field (tileable), DirectX convention. */
export function normalFromHeight(h: Float32Array, size: number, strength: number): Rgba {
    const out = new Uint8Array(size * size * 4);
    const H = (x: number, y: number) => h[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
        const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
        // DirectX: +Y points down the texture, so the green channel is flipped relative to OpenGL.
        out[i] = Math.round((-dx / l + 1) * 127.5); out[i + 1] = Math.round((dy / l + 1) * 127.5); out[i + 2] = Math.round((1 / l + 1) * 127.5); out[i + 3] = 255;
    }
    return { width: size, height: size, data: out };
}

const PROCEDURAL: Record<SurfaceRole, { mean: [number, number, number]; tileM: number; octaves: number[]; contrast: number; bump: number; rough: number }> = {
    asphalt: { mean: [64, 64, 66], tileM: 3, octaves: [32, 96, 256], contrast: 0.35, bump: 6, rough: 0.8 },
    asphalt_track: { mean: [58, 58, 60], tileM: 2, octaves: [32, 128, 256], contrast: 0.3, bump: 5, rough: 0.75 },
    gravel: { mean: [118, 110, 98], tileM: 2, octaves: [16, 64, 256], contrast: 0.6, bump: 10, rough: 0.9 },
    grass: { mean: [72, 96, 44], tileM: 2, octaves: [8, 32, 128, 256], contrast: 0.55, bump: 4, rough: 0.95 },
    dirt: { mean: [104, 84, 62], tileM: 2, octaves: [8, 32, 128], contrast: 0.45, bump: 5, rough: 0.95 },
    forest_floor: { mean: [70, 56, 40], tileM: 2, octaves: [8, 32, 128, 256], contrast: 0.6, bump: 6, rough: 0.95 },
    rock: { mean: [110, 106, 100], tileM: 3, octaves: [4, 16, 64, 256], contrast: 0.5, bump: 12, rough: 0.85 },
    concrete: { mean: [150, 148, 142], tileM: 4, octaves: [16, 64, 256], contrast: 0.2, bump: 2, rough: 0.8 },
    bark: { mean: [84, 62, 44], tileM: 1.5, octaves: [4, 16, 64], contrast: 0.5, bump: 8, rough: 0.95 },
};

const procCache = new Map<SurfaceRole, LibraryEntry>();

/** A code-generated stand-in for a library entry: same layout, so builds work before the library is imported. */
export function proceduralEntry(role: SurfaceRole, size = 256): LibraryEntry {
    const hit = procCache.get(role);
    if (hit) return hit;
    const p = PROCEDURAL[role];
    const n = tileNoise(size, role.length * 977 + size, p.octaves);
    const albedo = new Uint8Array(size * size * 4), detail = new Uint8Array(size * size * 4), maps = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        const f = 1 + (n[i] - 0.5) * 2 * p.contrast;
        for (let c = 0; c < 3; c++) { albedo[i * 4 + c] = Math.min(255, p.mean[c] * f); detail[i * 4 + c] = Math.min(255, 128 * f); }
        albedo[i * 4 + 3] = detail[i * 4 + 3] = 255;
        const smooth = 1 - p.rough;
        maps[i * 4] = Math.round(255 * (0.15 + 0.85 * smooth)); maps[i * 4 + 1] = Math.round(255 * smooth); maps[i * 4 + 2] = Math.round(255 * smooth * smooth); maps[i * 4 + 3] = 255;
    }
    const e: LibraryEntry = {
        role, label: `${role} (procedural)`, tileM: p.tileM, mean: p.mean,
        albedo: encodeDds({ width: size, height: size, data: albedo }),
        detail: encodeDds({ width: size, height: size, data: detail }),
        normal: encodeDds(normalFromHeight(n, size, p.bump), { mips: 'normal' }),
        maps: encodeDds({ width: size, height: size, data: maps }, { mips: 'linear' }),
        source: { provider: 'procedural', license: 'generated in code' },
    };
    procCache.set(role, e);
    return e;
}

export function entryFor(lib: MaterialLibrary | undefined, role: SurfaceRole): LibraryEntry {
    return lib?.[role] ?? proceduralEntry(role);
}

// ---------------------------------------------------------------- KN5 material assembly

/** Collects KN5 textures and materials, de-duplicating textures by name. */
// Generated textures (macros, flat normals) by name: names carry their parameters, so a rebuild with the same
// settings reuses the encoded DDS instead of regenerating it.
const generated = new Map<string, Uint8Array>();

export class MaterialBook {
    textures: Kn5Texture[] = [];
    materials: Kn5Material[] = [];
    private names = new Set<string>();
    texture(name: string, data: Uint8Array | (() => Uint8Array)): string {
        if (!this.names.has(name)) {
            this.names.add(name);
            let bytes: Uint8Array;
            if (typeof data === 'function') {
                bytes = generated.get(name) ?? data();
                generated.set(name, bytes);
                if (generated.size > 64) generated.delete(generated.keys().next().value!);
            } else bytes = data;
            this.textures.push({ name, data: bytes });
        }
        return name;
    }
    has(material: string) { return this.materials.some((m) => m.name === material); }
    add(m: Kn5Material) { if (!this.has(m.name)) this.materials.push(m); return m.name; }
}

const FLAT_NORMAL = () => encodeDds({ width: 4, height: 4, data: new Uint8Array(64).map((_, i) => [128, 128, 255, 255][i % 4]) }, { mips: 'normal' });

export interface MacroDetailSpec {
    name: string;
    /** Library role for the detail layer. */
    role: SurfaceRole;
    /** Macro texture (RGBA, alpha 0 = full detail) and its real-world size in metres. */
    macro: { key: string; image: () => Rgba; sizeM: number; format?: 'bc1' | 'bc3' };
    /** Optional macro-scale maps (spec/gloss/reflection). Default: the library maps' average via a flat texture. */
    maps?: { key: string; image: () => Rgba };
    specular?: number;
    specularExp?: number;
    reflection?: number;
    detailNormal?: number;
}

/**
 * ksPerPixelMultiMap_NMDetail material for a ground surface. Texture slots and property names are the ones
 * Content Manager's renderer reads for this shader (it mirrors AC): txDiffuse, txNormal, txMaps, txDetail,
 * txNormalDetail; useDetail, detailUVMultiplier, detailNormalBlend, fresnelC/EXP/MaxLevel, sunSpecular/EXP.
 */
export function macroDetailMaterial(book: MaterialBook, lib: MaterialLibrary | undefined, spec: MacroDetailSpec): string {
    if (book.has(spec.name)) return spec.name;
    const e = entryFor(lib, spec.role);
    const lp = e.source.provider === 'polyhaven' ? `${e.source.asset}` : `proc_${e.role}`;
    const txDiffuse = book.texture(`${spec.macro.key}.dds`, () => encodeDds(spec.macro.image(), { format: spec.macro.format ?? 'bc3' }));
    const txDetail = book.texture(`${lp}_detail.dds`, e.detail);
    const txNormalDetail = book.texture(`${lp}_normal.dds`, e.normal);
    const txNormal = book.texture('flat_normal.dds', FLAT_NORMAL);
    const txMaps = spec.maps ? book.texture(`${spec.maps.key}.dds`, () => encodeDds(spec.maps!.image(), { mips: 'linear' })) : book.texture(`${lp}_maps.dds`, e.maps);
    return book.add({
        name: spec.name, shader: 'ksPerPixelMultiMap_NMDetail',
        properties: [
            { name: 'ksAmbient', a: 0.4 }, { name: 'ksDiffuse', a: 0.6 },
            { name: 'ksSpecular', a: spec.specular ?? 0.15 }, { name: 'ksSpecularEXP', a: spec.specularExp ?? 25 },
            { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0 },
            { name: 'fresnelC', a: 0.02 }, { name: 'fresnelEXP', a: 4 }, { name: 'fresnelMaxLevel', a: spec.reflection ?? 0.12 },
            { name: 'useDetail', a: 1 }, { name: 'detailUVMultiplier', a: spec.macro.sizeM / e.tileM },
            { name: 'detailNormalBlend', a: spec.detailNormal ?? 1 },
            { name: 'sunSpecular', a: (spec.specular ?? 0.15) * 2 }, { name: 'sunSpecularEXP', a: spec.specularExp ?? 25 },
            { name: 'isAdditive', a: 0 },
        ],
        textures: [
            { sampler: 'txDiffuse', slot: 0, texture: txDiffuse },
            { sampler: 'txNormal', slot: 1, texture: txNormal },
            { sampler: 'txMaps', slot: 2, texture: txMaps },
            { sampler: 'txDetail', slot: 3, texture: txDetail },
            { sampler: 'txNormalDetail', slot: 4, texture: txNormalDetail },
        ],
    });
}

/** ksPerPixelNM material using a library albedo directly (trunks, concrete), tiled by the mesh UVs. */
export function photoMaterial(book: MaterialBook, lib: MaterialLibrary | undefined, name: string, role: SurfaceRole): string {
    if (book.has(name)) return name;
    const e = entryFor(lib, role);
    const lp = e.source.provider === 'polyhaven' ? `${e.source.asset}` : `proc_${e.role}`;
    return book.add({
        name, shader: 'ksPerPixelNM',
        properties: [
            { name: 'ksAmbient', a: 0.4 }, { name: 'ksDiffuse', a: 0.6 }, { name: 'ksSpecular', a: 0.05 }, { name: 'ksSpecularEXP', a: 20 },
            { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0 },
        ],
        textures: [
            { sampler: 'txDiffuse', slot: 0, texture: book.texture(`${lp}_albedo.dds`, e.albedo) },
            { sampler: 'txNormal', slot: 1, texture: book.texture(`${lp}_normal.dds`, e.normal) },
        ],
    });
}

// ---------------------------------------------------------------- macro textures

/** Flat macro: one colour (sRGB) scaled for a 0.5-mean detail, with gentle large-scale variation. */
export function solidMacro(target: [number, number, number], size = 256, variation = 0.12, seed = 1): Rgba {
    const n = tileNoise(size, seed, [2, 4, 8]);
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        const f = 1 + (n[i] - 0.5) * 2 * variation;
        for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, target[c] * 2 * f));
        data[i * 4 + 3] = 0;
    }
    return { width: size, height: size, data };
}

/**
 * Road macro, `sizeM` metres square. u = 0.5 + lateral / sizeM, v = distance / sizeM. Darker, smoother
 * wheel paths in each lane, a lighter crown between them, faint sealed cracks and patch repairs.
 */
export function roadMacro(widthM: number, sizeM: number, target: [number, number, number], opts: { lanes?: number; seed?: number; size?: number } = {}): { image: Rgba; maps: Rgba } {
    const size = opts.size ?? 1024, lanes = opts.lanes ?? 2;
    const n = tileNoise(size, opts.seed ?? 11, [3, 6, 12, 24]);
    const fine = tileNoise(size, (opts.seed ?? 11) + 5, [48, 96]);
    const img = new Uint8Array(size * size * 4), maps = new Uint8Array(size * size * 4);
    const laneW = widthM / lanes;
    const rand = rng(opts.seed ?? 11);
    // A few rectangular patch repairs and sealed crack lines, placed deterministically.
    const patches = Array.from({ length: 5 }, () => ({ u: rand(), v: rand(), w: 0.6 + rand() * 1.8, h: 1 + rand() * 4, shade: rand() < 0.5 ? 0.86 : 1.1 }));
    const cracks = Array.from({ length: 7 }, () => ({ v: rand(), lat: (rand() - 0.5) * widthM, len: 1 + rand() * 3, ang: rand() * Math.PI }));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const lat = ((x + 0.5) / size - 0.5) * sizeM, along = ((y + 0.5) / size) * sizeM;
        let f = 1 + (n[i] - 0.5) * 0.18;
        let shine = 0.35;
        if (Math.abs(lat) <= widthM / 2) {
            // Wheel paths: 0.9 m either side of each lane's centre, ~0.6 m wide.
            for (let l = 0; l < lanes; l++) {
                const c = -widthM / 2 + laneW * (l + 0.5);
                for (const off of [-0.9, 0.9]) {
                    const d = Math.abs(lat - (c + off));
                    if (d < 0.45) { const t = 1 - d / 0.45; f *= 1 - 0.1 * t * t; shine += 0.35 * t * t; }
                }
            }
            for (const p of patches) {
                const pu = (p.u - 0.5) * widthM, pv = p.v * sizeM;
                if (Math.abs(lat - pu) < p.w / 2 && Math.abs(along - pv) < p.h / 2) { f *= p.shade; shine *= p.shade < 1 ? 1.4 : 0.8; }
            }
            for (const c of cracks) {
                const cv = c.v * sizeM;
                const dx = lat - c.lat, dy = along - cv;
                const t = dx * Math.cos(c.ang) + dy * Math.sin(c.ang), d = Math.abs(-dx * Math.sin(c.ang) + dy * Math.cos(c.ang));
                if (Math.abs(t) < c.len / 2 && d < 0.03 + fine[i] * 0.02) { f *= 0.55; shine = 0.7; }
            }
        }
        for (let c = 0; c < 3; c++) img[i * 4 + c] = Math.max(0, Math.min(255, target[c] * 2 * f));
        img[i * 4 + 3] = 0;
        const s = Math.max(0, Math.min(1, shine));
        maps[i * 4] = Math.round(255 * (0.25 + 0.6 * s)); maps[i * 4 + 1] = Math.round(255 * s); maps[i * 4 + 2] = Math.round(255 * s * 0.6); maps[i * 4 + 3] = 255;
    }
    return { image: { width: size, height: size, data: img }, maps: { width: size, height: size, data: maps } };
}

/** Road paint macro: worn paint colour with a little grain, over the asphalt detail. */
export function paintMacro(rgb: [number, number, number], seed: number): Rgba {
    const size = 128, n = tileNoise(size, seed, [8, 32, 64]);
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        const wear = 0.85 + n[i] * 0.3;
        for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, rgb[c] * wear));
        // Some detail shows through worn paint; mostly paint.
        data[i * 4 + 3] = Math.round(255 * Math.min(1, 0.55 + n[i] * 0.5));
    }
    return { width: size, height: size, data };
}
