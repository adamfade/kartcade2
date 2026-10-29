// Bridges on the route. The road deck itself is the normal road mesh (its heights are levelled across the gap in
// pack.ts, since bare-earth elevation drops to the river); this adds what makes it a bridge: kerbed walkways,
// parapets, the deck slab and fascia, and the structure underneath or overhead.
//   beam  - girder deck on piers (the common case)
//   arch  - concrete-encased arch ribs over the main span, with spandrel columns below the deck and hangers above
//           it (a through arch when the span is long, like the 1922 Oregon City Bridge)
//   truss - steel side trusses
// Structure comes from OSM bridge:structure or the editor (staff pick it per bridge).

import type { Centerline } from './route.ts';
import type { MeshPart, TrackGeometry, V3 } from './mesh.ts';
import { BRIDGE_WALK } from './mesh.ts';
import type { BridgeSpan } from './roadinfo.ts';
import type { MaterialBook, MaterialLibrary } from './materials.ts';
import { macroDetailMaterial, solidMacro } from './materials.ts';
import { Mesh } from './elements.ts';

type Ground = (x: number, z: number) => number | null;

function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a: V3): V3 { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** A straight member of rectangular section between two points (w across horizontally, h in the vertical plane). */
export function beam(m: Mesh, a: V3, b: V3, w: number, h: number, uvScale = 4) {
    const t = norm(sub(b, a));
    let side = cross(t, [0, 1, 0]);
    if (Math.hypot(...side) < 1e-6) side = [1, 0, 0]; // vertical member
    side = norm(side);
    const up = norm(cross(side, t));
    const c = (p: V3, sx: number, sy: number): V3 => add(add(p, side, (sx * w) / 2), up, (sy * h) / 2);
    const L = Math.hypot(...sub(b, a)) / uvScale;
    const faces: [number, number, number, number, V3][] = [
        [-1, 1, 1, 1, up], [1, -1, -1, -1, [-up[0], -up[1], -up[2]]], [1, 1, 1, -1, side], [-1, -1, -1, 1, [-side[0], -side[1], -side[2]]],
    ];
    for (const [x0, y0, x1, y1, n] of faces) {
        m.face([c(a, x0, y0), c(b, x0, y0), c(b, x1, y1), c(a, x1, y1)], n, [[0, 0], [L, 0], [L, h / uvScale], [0, h / uvScale]]);
    }
    for (const [p, n] of [[a, [-t[0], -t[1], -t[2]]], [b, t]] as [V3, V3][]) {
        m.face([c(p, -1, -1), c(p, 1, -1), c(p, 1, 1), c(p, -1, 1)], n, [[0, 0], [w / uvScale, 0], [w / uvScale, h / uvScale], [0, h / uvScale]]);
    }
}

export interface BridgeBuild { parts: MeshPart[]; count: number }

export function buildBridges(cl: Centerline, g: TrackGeometry, spans: BridgeSpan[], ground: Ground, book: MaterialBook, lib: MaterialLibrary | undefined): BridgeBuild {
    if (!spans.length) return { parts: [], count: 0 };
    const concrete = macroDetailMaterial(book, lib, { name: 'bridge_concrete', role: 'concrete', specular: 0.08, macro: { key: 'bridge_concrete_macro', image: () => solidMacro([168, 166, 158], 128, 0.14, 41), sizeM: 16 } });
    const walk = macroDetailMaterial(book, lib, { name: 'bridge_walk', role: 'concrete', specular: 0.1, macro: { key: 'bridge_walk_macro', image: () => solidMacro([178, 176, 170], 128, 0.1, 43), sizeM: 16 } });
    const steel = macroDetailMaterial(book, lib, { name: 'bridge_steel', role: 'metal_roof', specular: 0.35, reflection: 0.12, macro: { key: 'bridge_steel_macro', image: () => solidMacro([88, 96, 92], 64, 0.08, 47), sizeM: 8 } });
    const meshes = {
        walk: new Mesh('1ROAD_BRIDGEWALK', walk),
        parapet: new Mesh('1WALL_PARAPET', concrete),
        deck: new Mesh('BRIDGE_DECK', concrete, { castShadows: true }),
        struct: new Mesh('BRIDGE_STRUCT', concrete, { castShadows: true }),
        steel: new Mesh('BRIDGE_STEEL', steel, { castShadows: true }),
    };
    const n = cl.points.length;
    const idx = (sM: number) => { let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cl.s[mid] <= sM) lo = mid; else hi = mid - 1; } return lo; };
    const right = (i: number) => ({ x: cl.tangents[i].y, y: -cl.tangents[i].x });
    const pt = (i: number, lat: number, y: number): V3 => { const r = right(i); return [cl.points[i].x + r.x * lat, y, cl.points[i].y + r.y * lat]; };
    const PAR_H = 1.05, PAR_T = 0.35;

    for (const b of spans) {
        let i0 = idx(b.from), i1 = Math.min(n - 1, idx(b.to) + 1);
        if (i1 <= i0) continue;
        const depth = b.structure === 'beam' ? 1.8 : 1.1;
        const edgeY = (i: number, side: -1 | 1) => g.roadHeightAt(i, side * g.halfAt(i));
        const outer = (i: number) => g.halfAt(i) + BRIDGE_WALK;
        // Walkways (kerb face + top), parapets, fascia and the underside, one quad strip per sample.
        for (let i = i0; i < i1; i++) {
            const j = i + 1, su = (k: number) => cl.s[k] / 4;
            for (const side of [-1, 1] as const) {
                const h0 = g.halfAt(i), h1 = g.halfAt(j), y0 = edgeY(i, side), y1 = edgeY(j, side);
                const n0: V3 = [right(i).x * -side, 0, right(i).y * -side];
                // Kerb face (towards the road) and walkway top.
                meshes.walk.face([pt(i, side * h0, y0), pt(j, side * h1, y1), pt(j, side * h1, y1 + 0.15), pt(i, side * h0, y0 + 0.15)], n0, [[su(i), 0], [su(j), 0], [su(j), 0.04], [su(i), 0.04]]);
                meshes.walk.face([pt(i, side * h0, y0 + 0.15), pt(j, side * h1, y1 + 0.15), pt(j, side * (h1 + BRIDGE_WALK - PAR_T), y1 + 0.15), pt(i, side * (h0 + BRIDGE_WALK - PAR_T), y0 + 0.15)], [0, 1, 0],
                    [[su(i), 0], [su(j), 0], [su(j), 0.5], [su(i), 0.5]]);
                // Parapet: inner face, cap, outer face continuing down as the deck fascia.
                const pi0 = side * (h0 + BRIDGE_WALK - PAR_T), pi1 = side * (h1 + BRIDGE_WALK - PAR_T), po0 = side * outer(i), po1 = side * outer(j);
                const top0 = y0 + 0.15 + PAR_H, top1 = y1 + 0.15 + PAR_H, bot0 = y0 - depth, bot1 = y1 - depth;
                meshes.parapet.face([pt(i, pi0, y0 + 0.15), pt(j, pi1, y1 + 0.15), pt(j, pi1, top1), pt(i, pi0, top0)], n0, [[su(i), 0], [su(j), 0], [su(j), PAR_H / 4], [su(i), PAR_H / 4]]);
                meshes.parapet.face([pt(i, pi0, top0), pt(j, pi1, top1), pt(j, po1, top1), pt(i, po0, top0)], [0, 1, 0], [[su(i), 0], [su(j), 0], [su(j), 0.1], [su(i), 0.1]]);
                const nOut: V3 = [-n0[0], 0, -n0[2]];
                meshes.parapet.face([pt(i, po0, bot0), pt(j, po1, bot1), pt(j, po1, top1), pt(i, po0, top0)], nOut, [[su(i), 0], [su(j), 0], [su(j), (top1 - bot1) / 4], [su(i), (top0 - bot0) / 4]]);
            }
            // Underside of the deck slab.
            const l0 = -outer(i), r0 = outer(i), l1 = -outer(j), r1 = outer(j);
            const yb0 = g.roadHeightAt(i, 0) - depth, yb1 = g.roadHeightAt(j, 0) - depth;
            meshes.deck.face([pt(i, l0, yb0), pt(j, l1, yb1), pt(j, r1, yb1), pt(i, r0, yb0)], [0, -1, 0], [[l0 / 4, cl.s[i] / 4], [l1 / 4, cl.s[j] / 4], [r1 / 4, cl.s[j] / 4], [r0 / 4, cl.s[i] / 4]]);
        }
        // Deck end faces (where the deck meets the abutments), so the slab never looks paper thin.
        for (const [i, dir] of [[i0, -1], [i1, 1]] as const) {
            const t = cl.tangents[i], nEnd: V3 = [t.x * dir, 0, t.y * dir];
            const y = g.roadHeightAt(i, 0);
            meshes.deck.face([pt(i, -outer(i), y - depth), pt(i, outer(i), y - depth), pt(i, outer(i), y), pt(i, -outer(i), y)], nEnd, [[0, 0], [1, 0], [1, 0.3], [0, 0.3]]);
        }

        // Ground clearance under the centreline along the bridge.
        const clear: number[] = [];
        for (let i = i0; i <= i1; i++) { const p = cl.points[i]; const gy = ground(p.x, p.y); clear.push(gy == null ? 0 : g.roadHeightAt(i, 0) - depth - gy); }
        const groundAt = (i: number, lat: number) => { const q = pt(i, lat, 0); return ground(q[0], q[2]) ?? g.roadHeightAt(i, 0) - depth - 3; };

        const pier = (i: number) => {
            // Two columns under the deck edges and a cap beam across.
            const topY = g.roadHeightAt(i, 0) - depth, f: V3 = [cl.tangents[i].x, 0, cl.tangents[i].y];
            const off = Math.max(1.5, g.halfAt(i) - 0.5);
            for (const side of [-1, 1]) {
                const base = pt(i, side * off, Math.min(topY - 0.5, groundAt(i, side * off) - 1));
                beam(meshes.struct, base, [base[0], topY, base[2]], 1.3, 1.3);
            }
            beam(meshes.struct, pt(i, -(off + 1), topY - 0.6), pt(i, off + 1, topY - 0.6), 1.4, 1.2);
            void f;
        };

        let main: [number, number] | null = null;
        if (b.structure === 'arch' || b.structure === 'truss') {
            // Main span: around the deepest point, while the gap stays at least 35% of its depth.
            let k = 0; for (let q = 1; q < clear.length; q++) if (clear[q] > clear[k]) k = q;
            const thr = clear[k] * 0.35;
            let a = k, c = k;
            while (a > 0 && clear[a - 1] > thr) a--;
            while (c < clear.length - 1 && clear[c + 1] > thr) c++;
            if (cl.s[i0 + c] - cl.s[i0 + a] >= 20) main = [i0 + a, i0 + c];
        }
        // Piers every ~30 m outside the main span wherever the deck is high enough to need them.
        let last = -Infinity;
        for (let i = i0 + 2; i <= i1 - 2; i++) {
            if (main && i >= main[0] - 3 && i <= main[1] + 3) continue;
            if (cl.s[i] - last < 30 || clear[i - i0] < 3) continue;
            pier(i); last = cl.s[i];
        }
        if (main && b.structure === 'arch') {
            const [a, c] = main, span = cl.s[c] - cl.s[a];
            const deckMid = g.roadHeightAt((a + c) >> 1, 0);
            const through = span >= 60;
            const springY = (i: number) => Math.max(groundAt(i, 0) + 1, g.roadHeightAt(i, 0) - depth - (through ? 0.12 * span : 0.18 * span));
            const sA = springY(a), sC = springY(c);
            const crown = through ? deckMid + Math.max(6, 0.14 * span) : deckMid - depth - 0.6;
            const ribY = (i: number) => {
                const t = (cl.s[i] - cl.s[a]) / span;
                const base = sA + (sC - sA) * t;
                return base + (crown - (sA + sC) / 2) * (1 - (2 * t - 1) ** 2);
            };
            const ribLat = (i: number) => g.halfAt(i) + (through ? BRIDGE_WALK + 0.9 : 1.2);
            for (const side of [-1, 1]) {
                let prev: V3 | null = null;
                for (let i = a; i <= c; i++) {
                    const p = pt(i, side * ribLat(i), ribY(i));
                    if (prev) beam(meshes.struct, prev, p, 1.4, 1.7);
                    prev = p;
                }
                // Skewbacks: blocks the ribs spring from.
                for (const i of [a, c]) { const p = pt(i, side * ribLat(i), springY(i)); beam(meshes.struct, [p[0], groundAt(i, side * ribLat(i)) - 1, p[2]], p, 3, 3); }
            }
            // Spandrel columns (rib below the deck) and hangers (rib above it) every ~6 m; top struts on a through arch.
            let lastV = -Infinity, lastS = -Infinity;
            for (let i = a + 1; i < c; i++) {
                const deckY = g.roadHeightAt(i, 0) - depth, rib = ribY(i);
                if (cl.s[i] - lastV >= 6) {
                    lastV = cl.s[i];
                    for (const side of [-1, 1]) {
                        const lat = side * ribLat(i);
                        if (rib < deckY - 0.5) beam(meshes.struct, pt(i, lat, rib + 0.8), pt(i, lat, deckY + 0.2), 0.8, 0.8);
                        else if (rib > deckY + 2.5) beam(meshes.steel, pt(i, lat, deckY), pt(i, lat, rib - 0.8), 0.25, 0.25);
                    }
                }
                if (through && rib > deckY + depth + 6.5 && cl.s[i] - lastS >= 9) {
                    lastS = cl.s[i];
                    beam(meshes.struct, pt(i, -ribLat(i), rib), pt(i, ribLat(i), rib), 0.8, 0.9);
                }
            }
        } else if (main && b.structure === 'truss') {
            const [a, c] = main, H = 6.5;
            const lat = (i: number) => g.halfAt(i) + BRIDGE_WALK + 0.4;
            let lastV = -Infinity, prevTop: [V3, V3] | null = null, prevBot: [V3, V3] | null = null, flip = false;
            for (let i = a; i <= c; i++) {
                if (cl.s[i] - lastV < 6 && i !== c) continue;
                lastV = cl.s[i];
                const y = g.roadHeightAt(i, 0);
                const tops: [V3, V3] = [pt(i, -lat(i), y + H), pt(i, lat(i), y + H)], bots: [V3, V3] = [pt(i, -lat(i), y - 0.3), pt(i, lat(i), y - 0.3)];
                for (const k of [0, 1]) {
                    beam(meshes.steel, bots[k], tops[k], 0.35, 0.35);
                    if (prevTop && prevBot) {
                        beam(meshes.steel, prevTop[k], tops[k], 0.5, 0.5);
                        beam(meshes.steel, prevBot[k], bots[k], 0.5, 0.5);
                        beam(meshes.steel, flip ? prevTop[k] : prevBot[k], flip ? bots[k] : tops[k], 0.3, 0.3);
                    }
                }
                beam(meshes.steel, tops[0], tops[1], 0.3, 0.3);
                prevTop = tops; prevBot = bots; flip = !flip;
            }
        } else if (main) {
            // Fall back to piers across the main span too.
            for (let i = main[0]; i <= main[1]; i++) if (cl.s[i] - last >= 30) { pier(i); last = cl.s[i]; }
        }
    }
    const parts = Object.values(meshes).flatMap((m) => m.parts).filter((p) => p.indices.length);
    return { parts, count: spans.length };
}
