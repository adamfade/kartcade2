// Placed scenery: guard rails, trees, roadside signs and start/finish banners.
// Everything is positioned by distance along the centreline (metres from the start), so a saved track
// rebuilds with its scenery in the same places. Geometry is in AC space like mesh.ts: X east, Y up, Z north.

import type { Centerline } from './route.ts';
import type { CentreStyle, MeshPart, TrackGeometry, V3 } from './mesh.ts';
import { ksMaterial } from './kn5.ts';
import type { Kn5Material, Kn5Texture } from './kn5.ts';
import { bannerTexture, barkTexture, needlesTexture, signText, signTexture, solidTexture, steelTexture } from './textures.ts';
import type { SignStyle } from './textures.ts';
import { encodeDds } from './dds.ts';
import { decodePNG } from './png.ts';

export type ElementSide = 'left' | 'right' | 'both';
export type { SignStyle };

export type TrackElement =
    | { id: string; type: 'guardrail'; from: number; to: number; side: ElementSide }
    | { id: string; type: 'trees'; from: number; to: number; side: ElementSide; density?: number }
    | { id: string; type: 'tree'; at: number; offset: number }
    | { id: string; type: 'sign'; at: number; side: 'left' | 'right'; style: SignStyle; text: string }
    | { id: string; type: 'banner'; at: number; text: string }
    /** A stretch with a different centre line (e.g. a passing zone). Turned into road markings, not scenery. */
    | { id: string; type: 'lines'; from: number; to: number; centre: CentreStyle };

export const ELEMENT_LABELS: Record<TrackElement['type'], string> = {
    guardrail: 'Guard rail', trees: 'Trees', tree: 'Single tree', sign: 'Sign', banner: 'Start/finish banner', lines: 'Centre line',
};

export interface ElementBuild { parts: MeshPart[]; textures: Kn5Texture[]; materials: Kn5Material[]; warnings: string[] }

const MAX_VERTS = 60000;

/** Collects vertices into parts, starting a new numbered part before the 16-bit index limit. */
class Mesh {
    parts: MeshPart[] = [];
    private cur: MeshPart | null = null;
    private base: string;
    private material: string;
    private flags: { visible?: boolean; castShadows?: boolean };
    constructor(base: string, material: string, flags: { visible?: boolean; castShadows?: boolean } = {}) {
        this.base = base; this.material = material; this.flags = flags;
    }
    private part(extra: number): MeshPart {
        if (!this.cur || this.cur.positions.length / 3 + extra > MAX_VERTS) {
            this.cur = { name: `${this.base}_${this.parts.length}`, material: this.material, positions: [], normals: [], uvs: [], tangents: [], indices: [], ...this.flags };
            this.parts.push(this.cur);
        }
        return this.cur;
    }
    /** A flat polygon (3 or 4 corners) facing `n`; winding is fixed so cross(b - a, c - a) points along n. */
    face(pts: V3[], n: V3, uv: [number, number][]) {
        const p = this.part(pts.length);
        const b = p.positions.length / 3;
        const t = norm(sub(pts[1], pts[0]));
        pts.forEach((q, k) => { p.positions.push(...q); p.normals.push(...n); p.uvs.push(...uv[k]); p.tangents.push(...t); });
        const tri = (a: number, c: number, d: number) => {
            const cr = cross(sub(pts[c], pts[a]), sub(pts[d], pts[a]));
            if (Math.hypot(...cr) < 1e-12) return;
            if (dot(cr, n) >= 0) p.indices.push(b + a, b + c, b + d); else p.indices.push(b + a, b + d, b + c);
        };
        tri(0, 1, 2);
        if (pts.length === 4) tri(0, 2, 3);
    }
    double(pts: V3[], n: V3, uv: [number, number][], backUv?: [number, number][]) {
        this.face(pts, n, uv);
        this.face(pts, [-n[0], -n[1], -n[2]], backUv ?? uv);
    }
}

function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: V3, b: V3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a: V3): V3 { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: number) { let s = seed || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** Centreline helpers shared by every element. */
function frame(cl: Centerline, g: TrackGeometry) {
    const n = cl.points.length;
    const index = (sM: number) => {
        let s = sM;
        if (cl.closed) s = ((s % cl.length) + cl.length) % cl.length;
        else s = Math.max(0, Math.min(cl.length, s));
        let lo = 0, hi = n - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cl.s[mid] <= s) lo = mid; else hi = mid - 1; }
        if (lo < n - 1 && s - cl.s[lo] > cl.s[lo + 1] - s) lo++;
        return lo;
    };
    /** Indices from `from` to `to` metres, every `step` metres; wraps round a circuit when to < from. */
    const span = (from: number, to: number, step: number) => {
        const out: number[] = [];
        let a = from, b = to;
        if (cl.closed && b < a) b += cl.length;
        if (!cl.closed) { a = Math.max(0, Math.min(cl.length, a)); b = Math.max(0, Math.min(cl.length, b)); if (b < a) [a, b] = [b, a]; }
        const count = Math.max(1, Math.round((b - a) / step));
        for (let k = 0; k <= count; k++) out.push(index(a + ((b - a) * k) / count));
        return out;
    };
    const right = (i: number) => ({ x: cl.tangents[i].y, z: -cl.tangents[i].x });
    const fwd = (i: number): V3 => [cl.tangents[i].x, 0, cl.tangents[i].y];
    const at = (i: number, lat: number, up = 0): V3 => {
        const r = right(i);
        return [cl.points[i].x + r.x * lat, g.surfaceAt(i, lat) + up, cl.points[i].y + r.z * lat];
    };
    const half = g.width / 2;
    /** Lateral offset for something `want` metres beyond the asphalt, kept inside the verge (and its wall). */
    const beyond = (i: number, side: -1 | 1, want: number, margin = 0.4) => side * (half + Math.max(0.3, Math.min(want, g.vergeReach(i, side) - margin)));
    return { n, index, span, right, fwd, at, half, beyond };
}

const sidesOf = (s: ElementSide): (-1 | 1)[] => (s === 'both' ? [-1, 1] : s === 'left' ? [-1] : [1]);

/** Guard rail: posts every 4 m and a W-beam, with an invisible collision wall along the same line. */
function guardrail(e: Extract<TrackElement, { type: 'guardrail' }>, f: ReturnType<typeof frame>, rail: Mesh, posts: Mesh, hit: Mesh) {
    for (const side of sidesOf(e.side)) {
        const idx = f.span(e.from, e.to, 2);
        const base = idx.map((i) => f.at(i, f.beyond(i, side, 1.6)));
        let s = 0;
        for (let k = 0; k < base.length - 1; k++) {
            const a = base[k], b = base[k + 1];
            const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
            if (d < 1e-3) continue;
            const t = norm(sub(b, a));
            const n = norm([t[2], 0, -t[0]]);
            const up = (p: V3, h: number): V3 => [p[0], p[1] + h, p[2]];
            rail.double([up(a, 0.45), up(b, 0.45), up(b, 0.8), up(a, 0.8)], n, [[s / 4, 0], [(s + d) / 4, 0], [(s + d) / 4, 1], [s / 4, 1]]);
            hit.double([up(a, -0.3), up(b, -0.3), up(b, 1.0), up(a, 1.0)], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
            s += d;
        }
        // Posts every 4 m along the rail.
        let acc = 0;
        for (let k = 0; k < base.length; k++) {
            if (k > 0) acc += Math.hypot(base[k][0] - base[k - 1][0], base[k][2] - base[k - 1][2]);
            if (k === 0 || acc >= 4 || k === base.length - 1) { box(posts, base[k], f.fwd(idx[k]), 0.15, 0.15, 0.75); acc = 0; }
        }
    }
}

/** Upright box standing on `p`, aligned with `fw`. */
function box(m: Mesh, p: V3, fw: V3, w: number, d: number, h: number) {
    const fx = norm(fw), rx: V3 = [fx[2], 0, -fx[0]];
    const c = (sx: number, sz: number, y: number): V3 => [p[0] + rx[0] * sx * w / 2 + fx[0] * sz * d / 2, p[1] + y, p[2] + rx[2] * sx * w / 2 + fx[2] * sz * d / 2];
    const uv: [number, number][] = [[0, 0], [1, 0], [1, h], [0, h]];
    m.face([c(-1, -1, -0.2), c(1, -1, -0.2), c(1, -1, h), c(-1, -1, h)], [-fx[0], 0, -fx[2]], uv);
    m.face([c(1, 1, -0.2), c(-1, 1, -0.2), c(-1, 1, h), c(1, 1, h)], fx, uv);
    m.face([c(-1, 1, -0.2), c(-1, -1, -0.2), c(-1, -1, h), c(-1, 1, h)], [-rx[0], 0, -rx[2]], uv);
    m.face([c(1, -1, -0.2), c(1, 1, -0.2), c(1, 1, h), c(1, -1, h)], rx, uv);
    m.face([c(-1, -1, h), c(1, -1, h), c(1, 1, h), c(-1, 1, h)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

/** A Douglas-fir-like tree: hexagonal trunk (with collision) and two stacked cones of needles. */
function tree(trunk: Mesh, crown: Mesh, p: V3, H: number, rand: () => number) {
    const r = Math.max(0.18, H * 0.018), th = H * 0.35, seg = 6;
    const rot = rand() * Math.PI * 2;
    for (let k = 0; k < seg; k++) {
        const a0 = rot + (k / seg) * Math.PI * 2, a1 = rot + ((k + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
        const q = (a: number, y: number, rr = r): V3 => [p[0] + Math.cos(a) * rr, p[1] + y, p[2] + Math.sin(a) * rr];
        trunk.face([q(a0, -0.3), q(a1, -0.3), q(a1, th), q(a0, th)], [Math.cos(am), 0, Math.sin(am)], [[k / seg, 0], [(k + 1) / seg, 0], [(k + 1) / seg, th / 2], [k / seg, th / 2]]);
    }
    const cone = (y0: number, y1: number, R: number, sides = 9) => {
        const apex: V3 = [p[0], p[1] + y1, p[2]];
        for (let k = 0; k < sides; k++) {
            const a0 = rot + (k / sides) * Math.PI * 2, a1 = rot + ((k + 1) / sides) * Math.PI * 2;
            const b0: V3 = [p[0] + Math.cos(a0) * R, p[1] + y0, p[2] + Math.sin(a0) * R];
            const b1: V3 = [p[0] + Math.cos(a1) * R, p[1] + y0, p[2] + Math.sin(a1) * R];
            const n = norm(cross(sub(b1, b0), sub(apex, b0)));
            const out: V3 = dot(n, [Math.cos(a0), 0, Math.sin(a0)]) < 0 ? [-n[0], -n[1], -n[2]] : n;
            crown.face([b0, b1, apex], out, [[0, 0], [1, 0], [0.5, 2]]);
            crown.face([b0, b1, [p[0], p[1] + y0, p[2]]], [0, -1, 0], [[0, 0], [1, 0], [0.5, 0.5]]);
        }
    };
    cone(H * 0.22, H * 0.78, H * 0.26);
    cone(H * 0.5, H, H * 0.18, 8);
}

/** Roadside sign on two posts, facing oncoming traffic. Posts carry collision. */
function sign(e: Extract<TrackElement, { type: 'sign' }>, f: ReturnType<typeof frame>, faceMesh: Mesh, back: Mesh, posts: Mesh) {
    const side = e.side === 'left' ? -1 : 1;
    const i = f.index(e.at);
    const p = f.at(i, f.beyond(i, side, 2.6, 1));
    const fw = f.fwd(i), rx: V3 = [fw[2], 0, -fw[0]];
    const W = 2.4, Hh = 1.2, y0 = 1.1;
    const c = (u: number, v: number): V3 => [p[0] + rx[0] * (u - 0.5) * W, p[1] + y0 + v * Hh, p[2] + rx[2] * (u - 0.5) * W];
    // Front faces the cars coming towards it (normal against the direction of travel); u runs to the
    // driver's right, v = 1 at the top (the KN5 writer flips v for AC).
    faceMesh.face([c(0, 0), c(1, 0), c(1, 1), c(0, 1)], [-fw[0], 0, -fw[2]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    back.face([c(0, 0), c(1, 0), c(1, 1), c(0, 1)], fw, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    for (const u of [0.15, 0.85]) { const b = c(u, 0); box(posts, [b[0] + fw[0] * 0.06, p[1], b[2] + fw[2] * 0.06], fw, 0.12, 0.08, y0 + Hh); }
}

/** Start/finish gantry: posts each side and a banner across the road, facing oncoming traffic. */
function banner(e: Extract<TrackElement, { type: 'banner' }>, f: ReturnType<typeof frame>, faceMesh: Mesh, back: Mesh, posts: Mesh) {
    const i = f.index(e.at);
    const L = f.at(i, f.beyond(i, -1, 1.5, 0.6)), R = f.at(i, f.beyond(i, 1, 1.5, 0.6));
    const fw = f.fwd(i);
    const top = Math.max(L[1], R[1]) + 5.6, bottom = top - 1.1;
    const pL: V3 = [L[0], bottom, L[2]], pR: V3 = [R[0], bottom, R[2]];
    const q = (a: V3, y: number): V3 => [a[0], y, a[2]];
    faceMesh.face([q(pL, bottom), q(pR, bottom), q(pR, top), q(pL, top)], [-fw[0], 0, -fw[2]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    back.face([q(pL, bottom), q(pR, bottom), q(pR, top), q(pL, top)], fw, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    box(posts, L, fw, 0.3, 0.3, top - L[1]);
    box(posts, R, fw, 0.3, 0.3, top - R[1]);
}

/** Build every placed element into meshes, plus the textures and materials they use. */
export function buildElements(cl: Centerline, g: TrackGeometry, elements: TrackElement[]): ElementBuild {
    const f = frame(cl, g);
    const warnings: string[] = [];
    const rail = new Mesh('GR_BEAM', 'el_steel');
    const railHit = new Mesh('1WALL_GR', 'el_steel', { visible: false, castShadows: false });
    const posts = new Mesh('1WALL_POSTS', 'el_post');
    const trunks = new Mesh('1WALL_TREES', 'el_bark');
    const crowns = new Mesh('TREES_NEEDLES', 'el_needles');
    const backs = new Mesh('SIGN_BACKS', 'el_post');
    const faces = new Map<string, { mesh: Mesh; tex: string; data: () => Uint8Array }>();
    const faceFor = (key: string, data: () => Uint8Array) => {
        let x = faces.get(key);
        if (!x) {
            const k = faces.size;
            x = { mesh: new Mesh(`SIGN_FACE_${k}`, `el_sign_${k}`), tex: `sign_${k}.png`, data };
            faces.set(key, x);
        }
        return x.mesh;
    };

    for (const e of elements) {
        switch (e.type) {
            case 'guardrail': guardrail(e, f, rail, posts, railHit); break;
            case 'trees': {
                const rand = rng(hash(e.id));
                const per100 = Math.max(0.5, Math.min(40, e.density ?? 6));
                for (const side of sidesOf(e.side)) {
                    let a = e.from, b = e.to;
                    if (cl.closed && b < a) b += cl.length;
                    if (!cl.closed && b < a) [a, b] = [b, a];
                    for (let s = a + rand() * (100 / per100); s < b; s += (100 / per100) * (0.5 + rand())) {
                        const i = f.index(s);
                        const reach = g.vergeReach(i, side);
                        // Keep the crown (radius 0.26 x height) off the asphalt and the trunk inside the wall.
                        let H = 9 + rand() * 13;
                        const room = reach - 1.5 - 1;
                        if (0.26 * H > room) H = room / 0.26;
                        if (H < 6) { rand(); continue; } // no room between the shoulder and the wall
                        const minOff = 0.26 * H + 1;
                        const lat = side * (f.half + minOff + rand() * Math.max(0, reach - 1.5 - minOff));
                        tree(trunks, crowns, f.at(i, lat), H, rand);
                    }
                }
                break;
            }
            case 'tree': {
                const i = f.index(e.at);
                const side = e.offset < 0 ? -1 : 1;
                const want = Math.abs(e.offset) - f.half;
                if (want < 4.6) warnings.push(`Tree at ${Math.round(e.at)} m moved off the road`);
                const off = Math.abs(f.beyond(i, side, Math.max(4.6, want), 1.5)) - f.half;
                tree(trunks, crowns, f.at(i, side * (f.half + off)), Math.max(6, Math.min(16, (off - 1) / 0.26)), rng(hash(e.id)));
                break;
            }
            case 'sign': {
                const style = e.style, text = signText(e.text) || (style === 'kartcade' ? 'KARTCADE' : '');
                sign(e, f, faceFor(`s:${style}:${text}`, () => signTexture(text, style)), backs, posts);
                break;
            }
            case 'banner': {
                const text = signText(e.text, 24) || 'START';
                banner(e, f, faceFor(`b:${text}`, () => bannerTexture(text)), backs, posts);
                break;
            }
        }
    }

    const parts = [rail, railHit, posts, trunks, crowns, backs, ...[...faces.values()].map((x) => x.mesh)].flatMap((m) => m.parts).filter((p) => p.indices.length);
    const used = new Set(parts.map((p) => p.material));
    const textures: Kn5Texture[] = [];
    const materials: Kn5Material[] = [];
    // Element textures are drawn as PNGs, then stored as DDS with mipmaps like everything else.
    const add = (mat: string, tex: string, data: () => Uint8Array, spec = 0.05) => {
        if (!used.has(mat)) return;
        const name = tex.replace(/\.png$/, '.dds');
        const img = decodePNG(data());
        textures.push({ name, data: encodeDds(img, { format: 'bc1' }) });
        materials.push(ksMaterial(mat, name, spec));
    };
    add('el_steel', 'el_steel.png', () => steelTexture(), 0.4);
    add('el_post', 'el_post.png', () => solidTexture([105, 108, 112]), 0.2);
    add('el_bark', 'el_bark.png', () => barkTexture(), 0.02);
    add('el_needles', 'el_needles.png', () => needlesTexture(), 0.02);
    [...faces.values()].forEach((x, k) => add(`el_sign_${k}`, x.tex, x.data, 0.1));
    return { parts, textures, materials, warnings };
}

/** A short unique id for a new element. */
export function elementId() {
    return Math.random().toString(36).slice(2, 10);
}
