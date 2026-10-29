// Building detail for the buildings you drive past: framed windows with sills (some lit at night), front doors
// with steps, porches, garage doors, chimneys, storefronts with awnings and the shop's sign (from OpenStreetMap
// shop and amenity tags), and the driver's own facade photos for landmarks.
//
// Everything is extruded a few centimetres in front of the wall quads features.ts builds, so walls stay single
// quads and details can be dropped with distance (LOD) without leaving holes.

import type { Rgba } from './dds.ts';
import type { MaterialBook, MaterialLibrary } from './materials.ts';
import { contentKey, macroDetailMaterial } from './materials.ts';
import type { V3 } from './mesh.ts';
import type { Mesh } from './elements.ts';
import { drawText } from './textures.ts';

export interface P2 { x: number; y: number }

/** A wall of a footprint: a -> c along a counter-clockwise ring; n = outward unit normal (plan). */
export interface Wall { a: P2; c: P2; n: P2; len: number; ground: number }

export type BuildingKind = 'house' | 'small' | 'big' | 'barn' | 'apartments' | 'shop';

export interface Shop { name?: string; tags: Record<string, string>; /** Position along the front wall (m). */ u: number }

export interface BuildingDetail {
    walls: Wall[];
    kind: BuildingKind;
    /** y of the wall base (slightly below ground) and of the wall top. */
    base: number;
    top: number;
    levels: number;
    /** Index of the wall facing the street (-1: none). */
    front: number;
    /** Clear ground in front of the front wall before any road (m): porches, steps and awnings must fit in it. */
    frontRoom: number;
    seed: number;
    roofMat: string;
    shops: Shop[];
    /** Wall index -> texture of the driver's own photo of that facade. */
    photos?: Map<number, string>;
}

export type MeshFor = (kind: string, p: P2, material: string) => Mesh;

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
function img(w: number, h: number, fill: number[]): Rgba {
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set(fill, i * 4);
    return { width: w, height: h, data };
}
/** Flat macro texture for a target colour (macro texels carry twice the colour; alpha 0 = full photo detail). */
const macro = (rgb: number[]) => img(64, 64, [clamp(rgb[0] * 2), clamp(rgb[1] * 2), clamp(rgb[2] * 2), 0]);
function rect(im: Rgba, x0: number, y0: number, x1: number, y1: number, f: (x: number, y: number) => number[]) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(im.height, y1); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(im.width, x1); x++) {
        const c = f(x, y), i = (y * im.width + x) * 4;
        im.data[i] = clamp(c[0]); im.data[i + 1] = clamp(c[1]); im.data[i + 2] = clamp(c[2]); im.data[i + 3] = c[3] ?? 255;
    }
}

// ---------------------------------------------------------------- textures

/**
 * Window atlas, 512 x 512, 4 x 4 cells of 128: rows 0-2 daytime glass (sky reflection, mullion patterns, curtains,
 * blinds), row 3 warm curtained interiors used by windows lit at night. Each cell has a painted inner frame.
 */
export function windowAtlas(): Rgba {
    const N = 512, C = 128, im = img(N, N, [40, 46, 54, 255]);
    const r = rng(17);
    for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
        const k = cy * 4 + cx, x0 = cx * C, y0 = cy * C, lit = cy === 3;
        // Glass: sky reflection fading down, a soft diagonal streak.
        rect(im, x0, y0, x0 + C, y0 + C, (x, y) => {
            const t = (y - y0) / C, s = Math.max(0, 1 - Math.abs((x - x0) - (y - y0) * 0.6 - 30) / 18) * 0.25;
            return lit ? [150 + 60 * (1 - t), 118 + 40 * (1 - t), 78 + 20 * (1 - t)] : [70 + 70 * (1 - t) + 90 * s, 84 + 72 * (1 - t) + 90 * s, 100 + 80 * (1 - t) + 90 * s];
        });
        const style = k % 4;
        if (!lit && cy === 1) {
            // Curtains drawn to the sides.
            const col = [[196, 186, 160], [150, 60, 50], [210, 206, 196], [90, 110, 130]][cx];
            rect(im, x0, y0, x0 + 30, y0 + C, (x) => col.map((v) => v * (0.85 + 0.15 * Math.sin(x * 0.8))));
            rect(im, x0 + C - 30, y0, x0 + C, y0 + C, (x) => col.map((v) => v * (0.85 + 0.15 * Math.sin(x * 0.8))));
        } else if (!lit && cy === 2) {
            // Blinds part-way down.
            const down = 30 + r() * 70;
            rect(im, x0, y0, x0 + C, y0 + down, (_, y) => (y % 6 < 4 ? [214, 210, 200] : [170, 166, 158]));
        } else if (lit) {
            // Curtains glowing from inside, a lamp shape.
            rect(im, x0 + 8, y0 + 8, x0 + C - 8, y0 + C - 8, (x, y) => [222 - ((x * 3) % 14), 190 - ((x * 3) % 14), 128 + ((y + x) % 9)]);
            if (cx % 2) rect(im, x0 + 40, y0 + 70, x0 + 60, y0 + 100, () => [255, 236, 190]);
        }
        // Mullions: none, cross, colonial 6-over-6, slider.
        const bar = (a0: number, b0: number, a1: number, b1: number) => rect(im, a0, b0, a1, b1, () => [236, 234, 228]);
        if (style === 1) { bar(x0 + C / 2 - 3, y0, x0 + C / 2 + 3, y0 + C); bar(x0, y0 + C / 2 - 3, x0 + C, y0 + C / 2 + 3); }
        else if (style === 2) { for (const f of [1 / 3, 2 / 3]) bar(x0 + C * f - 2, y0, x0 + C * f + 2, y0 + C); for (const f of [0.25, 0.5, 0.75]) bar(x0, y0 + C * f - (f === 0.5 ? 4 : 2), x0 + C, y0 + C * f + (f === 0.5 ? 4 : 2)); }
        else if (style === 3) bar(x0 + C / 2 - 4, y0, x0 + C / 2 + 4, y0 + C);
        // Inner frame.
        for (const [a0, b0, a1, b1] of [[0, 0, C, 7], [0, C - 7, C, C], [0, 0, 7, C], [C - 7, 0, C, C]]) bar(x0 + a0, y0 + b0, x0 + a1, y0 + b1);
    }
    return im;
}

/** Door atlas, 512 x 256: four doors of 128 x 256 (red, navy, white panel, glass shop door), frame painted. */
export function doorAtlas(): Rgba {
    const im = img(512, 256, [200, 200, 200, 255]);
    const cols = [[150, 40, 36], [36, 52, 84], [230, 228, 220], [60, 60, 62]];
    cols.forEach((c, k) => {
        const x0 = k * 128;
        rect(im, x0, 0, x0 + 128, 256, (x, y) => c.map((v) => v * (0.94 + 0.06 * Math.sin(y * 0.3 + x * 0.05))));
        if (k < 3) {
            // Six raised panels and a small window.
            for (const [px, py, pw, ph] of [[16, 20, 40, 50], [72, 20, 40, 50], [16, 86, 40, 70], [72, 86, 40, 70], [16, 172, 40, 64], [72, 172, 40, 64]]) {
                rect(im, x0 + px, py, x0 + px + pw, py + ph, () => c.map((v) => v * 0.82));
                rect(im, x0 + px + 4, py + 4, x0 + px + pw - 4, py + ph - 4, () => c.map((v) => v * 1.05));
            }
            if (k === 2) rect(im, x0 + 20, 22, x0 + 108, 66, (x, y) => [70 + (y - 22), 84 + (y - 22), 100 + (y - 22)]);
            rect(im, x0 + 104, 128, x0 + 112, 136, () => [200, 170, 80]); // knob
        } else {
            rect(im, x0 + 14, 14, x0 + 114, 242, (x, y) => [80 + (256 - y) * 0.25, 92 + (256 - y) * 0.25, 104 + (256 - y) * 0.25]);
            rect(im, x0 + 14, 120, x0 + 114, 128, () => [180, 180, 180]); // push bar
        }
        // Frame.
        rect(im, x0, 0, x0 + 6, 256, () => [236, 234, 228]); rect(im, x0 + 122, 0, x0 + 128, 256, () => [236, 234, 228]); rect(im, x0, 0, x0 + 128, 6, () => [236, 234, 228]);
    });
    return im;
}

/** Sectional garage door, 256 x 128 (one car wide; tiled for two), white panels. */
export function garageDoorImage(): Rgba {
    const im = img(256, 128, [226, 226, 222, 255]);
    for (let row = 0; row < 4; row++) {
        rect(im, 0, row * 32, 256, row * 32 + 3, () => [170, 170, 168]);
        for (let p = 0; p < 4; p++) rect(im, p * 64 + 8, row * 32 + 8, p * 64 + 56, row * 32 + 27, () => [212, 212, 208]);
    }
    rect(im, 0, 0, 256, 4, () => [236, 234, 228]);
    return im;
}

/** Storefront glass, 256 x 256 (one 2.4 m bay): reflection over a shop interior of shelves and goods. */
export function storefrontImage(): Rgba {
    const im = img(256, 256, [60, 64, 70, 255]);
    const r = rng(23);
    rect(im, 0, 0, 256, 256, (x, y) => [56 + (256 - y) * 0.14, 60 + (256 - y) * 0.16, 68 + (256 - y) * 0.2]);
    for (let k = 0; k < 4; k++) {
        const sy = 70 + k * 46;
        rect(im, 10, sy, 246, sy + 4, () => [150, 140, 120]);
        for (let g = 0; g < 14; g++) { const gx = 14 + g * 16 + r() * 4, gh = 14 + r() * 20; const c = [100 + r() * 140, 80 + r() * 120, 60 + r() * 120]; rect(im, gx, sy - gh, gx + 10, sy, () => c); }
    }
    // Diagonal reflection streaks.
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const s = Math.max(0, 1 - Math.abs(x - y * 0.7 - 40) / 26) + Math.max(0, 1 - Math.abs(x - y * 0.7 - 170) / 14) * 0.6;
        if (s > 0) { const i = (y * 256 + x) * 4; for (let c = 0; c < 3; c++) im.data[i + c] = clamp(im.data[i + c] + 80 * s); }
    }
    rect(im, 0, 0, 256, 6, () => [40, 40, 42]); rect(im, 0, 0, 6, 256, () => [40, 40, 42]);
    return im;
}

/** Awning canvas, 256 x 256: four rows of stripes (green, red, navy, black). */
export function awningAtlas(): Rgba {
    const im = img(256, 256, [255, 255, 255, 255]);
    const cols = [[30, 96, 60], [160, 36, 40], [30, 44, 86], [32, 32, 34]];
    cols.forEach((c, k) => rect(im, 0, k * 64, 256, (k + 1) * 64, (x, y) => (Math.floor(x / 32) % 2 && k < 3 ? [236, 232, 220] : c).map((v) => v * (0.9 + 0.1 * ((y - k * 64) / 64)))));
    return im;
}

/** A shop sign: the business name on a dark or light board (512 x 128). */
export function shopSignImage(name: string, style: number): Rgba {
    const bg = [[24, 28, 32], [236, 230, 214], [40, 64, 52], [92, 30, 30]][style % 4];
    const fg: [number, number, number] = style % 4 === 1 ? [40, 36, 30] : [240, 232, 210];
    const im = img(512, 128, [...bg, 255]);
    rect(im, 0, 0, 512, 6, () => [200, 190, 160]); rect(im, 0, 122, 512, 128, () => [200, 190, 160]);
    if (name) drawText(im, name.toUpperCase(), { x: 20, y: 22, w: 472, h: 84 }, fg);
    return im;
}

// ---------------------------------------------------------------- kit

export interface DetailStats { windows: number; doors: number; porches: number; garages: number; storefronts: number; chimneys: number; photos: number }

export class BuildingKit {
    readonly stats: DetailStats = { windows: 0, doors: 0, porches: 0, garages: 0, storefronts: 0, chimneys: 0, photos: 0 };
    /** Garage doors (for driveways) and house fronts (for mailboxes), in plan. */
    readonly driveways: { door: P2; n: P2; width: number }[] = [];
    readonly fronts: { at: P2; n: P2 }[] = [];
    /** Night lights: porch lights over front doors, shop windows spilling onto the sidewalk. */
    readonly lights: { at: V3; dir: V3; kind: 'porch' | 'shop' }[] = [];
    private mats = new Map<string, string>();
    private book: MaterialBook;
    private lib: MaterialLibrary | undefined;
    private meshFor: MeshFor;
    constructor(book: MaterialBook, lib: MaterialLibrary | undefined, meshFor: MeshFor) { this.book = book; this.lib = lib; this.meshFor = meshFor; }

    private flat(name: string, tex: string, opts: { spec?: number; exp?: number; at?: boolean } = {}): string {
        return this.book.add({
            name, shader: opts.at ? 'ksPerPixelAT' : 'ksPerPixel', alphaTested: !!opts.at,
            properties: [{ name: 'ksAmbient', a: 0.5 }, { name: 'ksDiffuse', a: 0.5 }, { name: 'ksSpecular', a: opts.spec ?? 0.05 }, { name: 'ksSpecularEXP', a: opts.exp ?? 10 }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0.5 }],
            textures: [{ sampler: 'txDiffuse', slot: 0, texture: tex }],
        });
    }
    mat(key: string): string {
        let m = this.mats.get(key);
        if (m) return m;
        const b = this.book;
        if (key === 'window' || key === 'window_lit') m = this.flat(key === 'window' ? 'bld_window' : 'bld_window_lit', b.image('bld_windows.dds', windowAtlas, { format: 'bc1' }), { spec: 0.5, exp: 60 });
        else if (key === 'door') m = this.flat('bld_door', b.image('bld_doors.dds', doorAtlas, { format: 'bc1' }), { spec: 0.15, exp: 20 });
        else if (key === 'garage') m = this.flat('bld_garage', b.image('bld_garage.dds', garageDoorImage, { format: 'bc1' }), { spec: 0.1 });
        else if (key === 'shop_glass') m = this.flat('bld_shop_glass', b.image('bld_storefront.dds', storefrontImage, { format: 'bc1' }), { spec: 0.6, exp: 80 });
        else if (key === 'awning') m = this.flat('bld_awning', b.image('bld_awning.dds', awningAtlas, { format: 'bc1' }), { spec: 0.05 });
        else if (key === 'trim') m = macroDetailMaterial(b, this.lib, { name: 'bld_trim', role: 'wood', macro: { key: 'bld_trim_macro', image: () => macro([232, 230, 222]), sizeM: 4 } });
        else if (key === 'dark') m = macroDetailMaterial(b, this.lib, { name: 'bld_dark_trim', role: 'concrete', macro: { key: 'bld_dark_macro', image: () => macro([38, 38, 40]), sizeM: 4 } });
        else if (key === 'brick') m = macroDetailMaterial(b, this.lib, { name: 'bld_chimney', role: 'brick', macro: { key: 'bld_chimney_macro', image: () => macro([128, 66, 50]), sizeM: 4 } });
        else if (key === 'concrete') m = macroDetailMaterial(b, this.lib, { name: 'bld_step', role: 'concrete', macro: { key: 'bld_step_macro', image: () => macro([156, 152, 144]), sizeM: 4 } });
        else if (key.startsWith('sign:')) {
            const [, style, name] = key.split(':');
            const id = `bld_sign_${contentKey(`${style}:${name}`)}`;
            m = this.flat(id, b.image(`${id}.dds`, () => shopSignImage(name, Number(style)), { format: 'bc1' }), { spec: 0.1 });
        } else throw new Error(`unknown building material ${key}`);
        this.mats.set(key, m);
        return m;
    }

    /** Builds the detail for one building into meshes chunked by `meshFor`. */
    detail(d: BuildingDetail) {
        const r = rng(d.seed * 2654435761);
        const floorH = 2.9, ground = (w: Wall) => w.ground;
        const isHouse = d.kind === 'house';
        // Front-wall features first, so windows can keep clear of them.
        const blocked = new Map<number, [number, number, number][]>(); // wall -> [u0, u1, maxY above base]
        const block = (wi: number, u0: number, u1: number, yTop: number) => { let l = blocked.get(wi); if (!l) blocked.set(wi, (l = [])); l.push([u0, u1, yTop]); };
        const wallTopAbove = d.top - d.base;

        // Photos replace everything on their wall.
        for (const [wi, tex] of d.photos ?? []) {
            const w = d.walls[wi]; if (!w) continue;
            const m = this.meshFor('BLDD', w.a, this.flat(`bld_photo_${tex.replace(/\W/g, '_')}`, tex));
            this.quad(m, w, 0, w.len, d.base + 0.4, d.top, 0.05, [[0, 0], [1, 0], [1, 1], [0, 1]]);
            block(wi, -1, w.len + 1, 1e9);
            this.stats.photos++;
        }

        const F = d.front >= 0 && !d.photos?.has(d.front) ? d.walls[d.front] : null;
        if (F && isHouse) this.fronts.push({ at: { x: (F.a.x + F.c.x) / 2 + F.n.x * 0.1, y: (F.a.y + F.c.y) / 2 + F.n.y * 0.1 }, n: F.n });
        if (F && (d.kind === 'shop' || d.shops.length) && F.len >= 4 && wallTopAbove >= 4) {
            this.storefront(F, d, r);
            block(d.front, -1, F.len + 1, 4.2);
        } else if (F && (isHouse || d.kind === 'apartments') && F.len >= 4) {
            const g0 = ground(F);
            // Garage door at one end of a wide house front.
            let uLo = 0.6, uHi = F.len - 0.6;
            if (isHouse && F.len >= 10 && r() < 0.55) {
                const gw = F.len >= 14 && r() < 0.5 ? 4.9 : 2.7, left = r() < 0.5;
                const u0 = left ? 0.8 : F.len - 0.8 - gw;
                this.garageDoor(F, u0, u0 + gw, g0);
                block(d.front, u0 - 0.3, u0 + gw + 0.3, 2.6);
                if (left) uLo = u0 + gw + 0.8; else uHi = u0 - 0.8;
            }
            if (uHi - uLo >= 1.4) {
                const uc = uLo + (uHi - uLo) * (0.3 + r() * 0.4);
                const step = Math.max(0.15, g0 - d.base - 0.4 + 0.35);
                if (isHouse && uHi - uLo >= 3.6 && d.frontRoom > 4 && r() < 0.55) {
                    const pw = Math.min(4.2, uHi - uLo), pu0 = Math.max(uLo, Math.min(uHi - pw, uc - pw / 2));
                    this.porch(F, pu0, pu0 + pw, g0, d.roofMat, r);
                    block(d.front, pu0 - 0.2, pu0 + pw + 0.2, 0); // windows above the porch roof only
                    this.door(F, pu0 + pw / 2, g0 + 0.35, r() < 0.3 ? 2 : Math.floor(r() * 3));
                    block(d.front, pu0 + pw / 2 - 1.2, pu0 + pw / 2 + 1.2, floorH);
                } else {
                    const stepped = d.frontRoom > 2;
                    this.door(F, uc, g0 + (stepped ? Math.min(0.35, step) : 0), Math.floor(r() * 3));
                    if (stepped) this.step(F, uc, g0);
                    block(d.front, uc - 1.0, uc + 1.0, floorH);
                }
            }
        } else if (F && d.kind === 'small' && F.len >= 3 && r() < 0.6) {
            const gw = Math.min(F.len - 0.6, F.len > 6 ? 4.9 : 2.7), u0 = (F.len - gw) / 2;
            this.garageDoor(F, u0, u0 + gw, ground(F));
            block(d.front, u0, u0 + gw, 2.6);
        }

        // Windows on every wall long enough, floor by floor, in bays.
        if (d.kind === 'small' || d.kind === 'barn') return;
        const spec = d.kind === 'big' || d.kind === 'shop' ? { bay: 3.4, w: 1.7, h: 1.6, sill: 0.95 } : d.kind === 'apartments' ? { bay: 2.8, w: 1.25, h: 1.45, sill: 0.9 } : { bay: 3.1, w: 0.95, h: 1.35, sill: 0.9 };
        const floors = Math.max(1, Math.min(d.levels, Math.floor((wallTopAbove - 0.6) / floorH + 0.25)));
        d.walls.forEach((w, wi) => {
            if (w.len < 2.2) return;
            const n = Math.max(1, Math.floor(w.len / spec.bay));
            const bay = w.len / n;
            const fl = ground(w) - d.base; // ground above the wall base on this side
            for (let f = 0; f < floors; f++) {
                const y0 = d.base + fl + 0.25 + f * floorH + spec.sill, y1 = y0 + spec.h * (f ? 0.92 : 1);
                if (y1 > d.top - 0.25) break;
                for (let k = 0; k < n; k++) {
                    if (isHouse && n > 2 && r() < 0.18) continue; // houses are not perfectly regular
                    const uc = (k + 0.5) * bay, ww = Math.min(spec.w, bay - 0.6);
                    if (ww < 0.5) continue;
                    if ((blocked.get(wi) ?? []).some(([b0, b1, yt]) => uc + ww / 2 > b0 && uc - ww / 2 < b1 && (yt === 0 ? y0 < d.base + fl + 3.2 : y0 - d.base < yt))) continue;
                    this.window(w, uc - ww / 2, uc + ww / 2, y0, y1, r, isHouse);
                }
            }
        });
    }

    /** Chimney on a pitched roof: brick stack from below the ridge to 0.9 m above it. */
    chimney(at: V3, ridgeY: number, eaveY: number) {
        const m = this.meshFor('BLDD', { x: at[0], y: at[2] }, this.mat('brick'));
        const w = 0.6, dpt = 0.9, y0 = eaveY, y1 = ridgeY + 0.9;
        const c = (sx: number, sz: number, y: number): V3 => [at[0] + sx * w / 2, y, at[2] + sz * dpt / 2];
        const uv = (h: number): [number, number][] => [[0, 0], [w / 2, 0], [w / 2, h / 2], [0, h / 2]];
        m.face([c(-1, -1, y0), c(1, -1, y0), c(1, -1, y1), c(-1, -1, y1)], [0, 0, -1], uv(y1 - y0));
        m.face([c(1, 1, y0), c(-1, 1, y0), c(-1, 1, y1), c(1, 1, y1)], [0, 0, 1], uv(y1 - y0));
        m.face([c(-1, 1, y0), c(-1, -1, y0), c(-1, -1, y1), c(-1, 1, y1)], [-1, 0, 0], uv(y1 - y0));
        m.face([c(1, -1, y0), c(1, 1, y0), c(1, 1, y1), c(1, -1, y1)], [1, 0, 0], uv(y1 - y0));
        m.face([c(-1, -1, y1), c(1, -1, y1), c(1, 1, y1), c(-1, 1, y1)], [0, 1, 0], [[0, 0], [0.3, 0], [0.3, 0.45], [0, 0.45]]);
        this.stats.chimneys++;
    }

    // ------------------------------------------------ pieces (u = metres along the wall from a, d = metres out)

    private pt(w: Wall, u: number, y: number, dd: number): V3 {
        const dx = (w.c.x - w.a.x) / w.len, dy = (w.c.y - w.a.y) / w.len;
        return [w.a.x + dx * u + w.n.x * dd, y, w.a.y + dy * u + w.n.y * dd];
    }
    private quad(m: Mesh, w: Wall, u0: number, u1: number, y0: number, y1: number, dd: number, uv: [number, number][]) {
        m.face([this.pt(w, u0, y0, dd), this.pt(w, u1, y0, dd), this.pt(w, u1, y1, dd), this.pt(w, u0, y1, dd)], [w.n.x, 0, w.n.y], uv);
    }
    /** A block standing out of the wall: front face at d1 and four sides back to d0. */
    private slab(m: Mesh, w: Wall, u0: number, u1: number, y0: number, y1: number, d0: number, d1: number, top = true) {
        const P = (u: number, y: number, dd: number) => this.pt(w, u, y, dd);
        const N: V3 = [w.n.x, 0, w.n.y], T: V3 = [(w.c.x - w.a.x) / w.len, 0, (w.c.y - w.a.y) / w.len];
        const s = 0.5; // uv metres scale
        m.face([P(u0, y0, d1), P(u1, y0, d1), P(u1, y1, d1), P(u0, y1, d1)], N, [[u0 * s, y0 * s], [u1 * s, y0 * s], [u1 * s, y1 * s], [u0 * s, y1 * s]]);
        if (top) m.face([P(u0, y1, d1), P(u1, y1, d1), P(u1, y1, d0), P(u0, y1, d0)], [0, 1, 0], [[u0 * s, 0], [u1 * s, 0], [u1 * s, (d1 - d0) * s], [u0 * s, (d1 - d0) * s]]);
        m.face([P(u0, y0, d0), P(u1, y0, d0), P(u1, y0, d1), P(u0, y0, d1)], [0, -1, 0], [[u0 * s, 0], [u1 * s, 0], [u1 * s, (d1 - d0) * s], [u0 * s, (d1 - d0) * s]]);
        m.face([P(u0, y0, d0), P(u0, y0, d1), P(u0, y1, d1), P(u0, y1, d0)], [-T[0], 0, -T[2]], [[0, y0 * s], [(d1 - d0) * s, y0 * s], [(d1 - d0) * s, y1 * s], [0, y1 * s]]);
        m.face([P(u1, y0, d1), P(u1, y0, d0), P(u1, y1, d0), P(u1, y1, d1)], T, [[0, y0 * s], [(d1 - d0) * s, y0 * s], [(d1 - d0) * s, y1 * s], [0, y1 * s]]);
    }
    /** Atlas cell (column, row from the image top) -> mesh uv corners (v runs bottom-up). */
    private cell(cx: number, cy: number, nx: number, ny: number, inset = 0.002): [number, number][] {
        const u0 = cx / nx + inset, u1 = (cx + 1) / nx - inset, vb = 1 - (cy + 1) / ny + inset, vt = 1 - cy / ny - inset;
        return [[u0, vb], [u1, vb], [u1, vt], [u0, vt]];
    }

    private window(w: Wall, u0: number, u1: number, y0: number, y1: number, r: () => number, house: boolean) {
        const lit = r() < 0.32;
        const glass = this.meshFor('BLDD', w.a, this.mat(lit ? 'window_lit' : 'window'));
        const cx = Math.floor(r() * 4), cy = lit ? 3 : Math.floor(r() * 3);
        this.quad(glass, w, u0, u1, y0, y1, 0.03, this.cell(house ? cx : cx & 2 ? 0 : 3, cy, 4, 4));
        const trim = this.meshFor('BLDD', w.a, this.mat('trim'));
        const t = house ? 0.1 : 0.06, out = 0.07;
        this.slab(trim, w, u0 - t, u1 + t, y1, y1 + t, 0, out);
        this.slab(trim, w, u0 - t, u0, y0, y1, 0, out, false);
        this.slab(trim, w, u1, u1 + t, y0, y1, 0, out, false);
        this.slab(trim, w, u0 - t - 0.04, u1 + t + 0.04, y0 - 0.07, y0, 0, out + 0.05); // sill
        this.stats.windows++;
    }

    private door(w: Wall, uc: number, y0: number, style: number) {
        const m = this.meshFor('BLDD', w.a, this.mat('door'));
        this.lights.push({ at: this.pt(w, uc + 0.75, y0 + 2.2, 0.25), dir: [w.n.x * 0.3, -1, w.n.y * 0.3], kind: 'porch' });
        this.quad(m, w, uc - 0.48, uc + 0.48, y0, y0 + 2.1, 0.04, this.cell(style, 0, 4, 1));
        const trim = this.meshFor('BLDD', w.a, this.mat('trim'));
        this.slab(trim, w, uc - 0.62, uc + 0.62, y0 + 2.1, y0 + 2.26, 0, 0.09);
        this.slab(trim, w, uc - 0.62, uc - 0.48, y0, y0 + 2.1, 0, 0.09, false);
        this.slab(trim, w, uc + 0.48, uc + 0.62, y0, y0 + 2.1, 0, 0.09, false);
        this.stats.doors++;
    }

    private step(w: Wall, uc: number, g0: number) {
        const m = this.meshFor('BLDD', w.a, this.mat('concrete'));
        this.slab(m, w, uc - 0.8, uc + 0.8, g0 - 0.3, g0 + 0.18, 0, 0.9);
        this.slab(m, w, uc - 0.7, uc + 0.7, g0 - 0.3, g0 + 0.35, 0, 0.5);
    }

    private garageDoor(w: Wall, u0: number, u1: number, g0: number) {
        const m = this.meshFor('BLDD', w.a, this.mat('garage'));
        const mid = this.pt(w, (u0 + u1) / 2, 0, 0.1);
        this.driveways.push({ door: { x: mid[0], y: mid[2] }, n: w.n, width: u1 - u0 });
        const reps = Math.max(1, Math.round((u1 - u0) / 2.6));
        this.quad(m, w, u0, u1, g0 - 0.05, g0 + 2.15, 0.03, [[0, 0], [reps, 0], [reps, 1], [0, 1]]);
        const trim = this.meshFor('BLDD', w.a, this.mat('trim'));
        this.slab(trim, w, u0 - 0.12, u1 + 0.12, g0 + 2.15, g0 + 2.3, 0, 0.08);
        this.slab(trim, w, u0 - 0.12, u0, g0 - 0.05, g0 + 2.15, 0, 0.08, false);
        this.slab(trim, w, u1, u1 + 0.12, g0 - 0.05, g0 + 2.15, 0, 0.08, false);
        this.stats.garages++;
    }

    private porch(w: Wall, u0: number, u1: number, g0: number, roofMat: string, r: () => number) {
        const depth = 1.7 + r() * 0.5, deckY = g0 + 0.35;
        const deck = this.meshFor('BLDD', w.a, this.mat(r() < 0.5 ? 'concrete' : 'trim'));
        this.slab(deck, w, u0, u1, g0 - 0.3, deckY, 0, depth);
        const trim = this.meshFor('BLDD', w.a, this.mat('trim'));
        const yRoof0 = g0 + 2.95, yRoof1 = g0 + 2.6;
        for (const u of [u0 + 0.1, u1 - 0.26]) this.slab(trim, w, u, u + 0.16, deckY, yRoof1, depth - 0.26, depth - 0.1);
        // Beam and shed roof.
        this.slab(trim, w, u0, u1, yRoof1 - 0.22, yRoof1, depth - 0.3, depth - 0.05);
        const roof = this.meshFor('BLDD', w.a, roofMat);
        const P = (u: number, y: number, dd: number) => this.pt(w, u, y, dd);
        const rise = yRoof0 - yRoof1, nrm = norm3([w.n.x * rise, depth, w.n.y * rise]);
        roof.double([P(u0 - 0.15, yRoof0, 0), P(u1 + 0.15, yRoof0, 0), P(u1 + 0.15, yRoof1 - 0.05, depth + 0.15), P(u0 - 0.15, yRoof1 - 0.05, depth + 0.15)], nrm,
            [[0, 0], [(u1 - u0) / 8, 0], [(u1 - u0) / 8, depth / 8], [0, depth / 8]]);
        this.stats.porches++;
    }

    private storefront(w: Wall, d: BuildingDetail, r: () => number) {
        const g0 = w.ground, gl0 = g0 + 0.45, gl1 = g0 + 2.9;
        const shops = d.shops.length ? d.shops.slice().sort((a, b) => a.u - b.u) : [{ tags: {}, u: w.len / 2 } as Shop];
        // Split the front between the shops at midpoints of their positions.
        const edges = [0.3];
        for (let k = 1; k < shops.length; k++) edges.push(Math.max(edges[k - 1] + 2.5, Math.min(w.len - 2.5, (shops[k - 1].u + shops[k].u) / 2)));
        edges.push(w.len - 0.3);
        const dark = this.meshFor('BLDD', w.a, this.mat('dark'));
        const glass = this.meshFor('BLDD', w.a, this.mat('shop_glass'));
        shops.forEach((s, k) => {
            const u0 = edges[k] + 0.15, u1 = edges[k + 1] - 0.15;
            if (u1 - u0 < 2) return;
            // Bulkhead, glass, piers between sections, glass door.
            this.slab(dark, w, u0, u1, d.base, gl0, 0, 0.1);
            const ud = u0 + 0.6 + r() * Math.max(0, u1 - u0 - 2.2);
            const pane = (a: number, b: number) => { if (b - a > 0.2) this.quad(glass, w, a, b, gl0, gl1, 0.04, [[a / 2.4, 0], [b / 2.4, 0], [b / 2.4, 1], [a / 2.4, 1]]); };
            pane(u0, ud); pane(ud + 1.0, u1);
            const door = this.meshFor('BLDD', w.a, this.mat('door'));
            this.quad(door, w, ud, ud + 1.0, g0, g0 + 2.3, 0.04, this.cell(3, 0, 4, 1));
            this.slab(dark, w, ud - 0.06, ud, g0, gl1, 0, 0.1, false);
            this.slab(dark, w, ud + 1.0, ud + 1.06, g0, gl1, 0, 0.1, false);
            for (let u = u0 + 2.4; u < u1 - 0.5; u += 2.4) if (u < ud - 0.2 || u > ud + 1.2) this.slab(dark, w, u - 0.05, u + 0.05, gl0, gl1, 0, 0.08, false);
            this.slab(dark, w, u0, u1, gl1, gl1 + 0.15, 0, 0.12);
            // Sign band with the business name.
            const name = (s.tags.name ?? s.tags.brand ?? typeLabel(s.tags)).replace(/:/g, ' ').slice(0, 28);
            const style = Math.floor(r() * 4);
            const sign = this.meshFor('BLDD', w.a, this.mat(`sign:${style}:${name}`));
            const sw = Math.min(u1 - u0 - 0.2, Math.max(2.4, name.length * 0.28));
            const sc = (u0 + u1) / 2;
            const sh = Math.min(0.7, sw / 4);
            this.quad(sign, w, sc - sw / 2, sc + sw / 2, gl1 + 0.3, gl1 + 0.3 + sh, 0.07, [[0, 0], [1, 0], [1, 1], [0, 1]]);
            // Awning over the windows.
            if (d.frontRoom > 2.4 && r() < 0.55) {
                const aw = this.meshFor('BLDD', w.a, this.mat('awning'));
                const row = Math.floor(r() * 4), v0 = 1 - (row + 1) / 4 + 0.01, v1 = 1 - row / 4 - 0.01, reps = (u1 - u0) / 2;
                const P = (u: number, y: number, dd: number) => this.pt(w, u, y, dd);
                const out = 1.3, yTop = gl1 + 0.2, yLow = gl1 - 0.35;
                const nrm = norm3([w.n.x * (yTop - yLow), out, w.n.y * (yTop - yLow)]);
                aw.double([P(u0, yTop, 0.02), P(u1, yTop, 0.02), P(u1, yLow, out), P(u0, yLow, out)], nrm, [[0, v1], [reps, v1], [reps, v0], [0, v0]]);
                aw.double([P(u0, yLow, out), P(u1, yLow, out), P(u1, yLow - 0.25, out), P(u0, yLow - 0.25, out)], [w.n.x, 0, w.n.y], [[0, v1], [reps, v1], [reps, v0 + 0.05], [0, v0 + 0.05]]);
            }
            this.lights.push({ at: this.pt(w, (u0 + u1) / 2, gl1 - 0.4, 0.5), dir: [w.n.x, -0.35, w.n.y], kind: 'shop' });
            this.stats.storefronts++;
        });
    }
}

/** What an unnamed business's sign says: its type, as storefronts put it. */
export function typeLabel(t: Record<string, string>): string {
    const k = t.amenity ?? t.shop ?? t.office ?? t.craft ?? '';
    const map: Record<string, string> = {
        restaurant: 'Restaurant', cafe: 'Coffee', fast_food: 'Food', bar: 'Bar', pub: 'Pub', bank: 'Bank', pharmacy: 'Pharmacy', post_office: 'Post Office',
        library: 'Library', clinic: 'Clinic', dentist: 'Dental', doctors: 'Medical', ice_cream: 'Ice Cream', fuel: 'Gas', car_wash: 'Car Wash', veterinary: 'Animal Clinic',
        beauty: 'Salon', hairdresser: 'Hair', florist: 'Flowers', bakery: 'Bakery', convenience: 'Market', clothes: 'Clothing', furniture: 'Furniture', antiques: 'Antiques',
        car_repair: 'Auto Repair', car_parts: 'Auto Parts', toys: 'Toys', books: 'Books', hardware: 'Hardware', supermarket: 'Grocery', alcohol: 'Liquor', gift: 'Gifts',
    };
    return map[k] ?? (k ? k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');
}

function norm3(a: V3): V3 { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
