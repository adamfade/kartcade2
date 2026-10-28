// OpenStreetMap features around a track (ODbL, credited in ui_track.json): buildings, woods, single trees,
// barriers. Fetched once from the Overpass API in the browser and stored with the site data.

import type { LatLon } from './geo.ts';
import type { GeoBox } from './site.ts';

export interface OsmBuilding { id: number; ring: LatLon[]; tags: Record<string, string> }
export interface OsmArea { id: number; rings: LatLon[][]; tags: Record<string, string> }
export interface OsmPoint { id: number; at: LatLon; tags: Record<string, string> }
export interface OsmLine { id: number; line: LatLon[]; tags: Record<string, string> }

export interface OsmFeatures {
    fetched: string;
    bbox: GeoBox;
    buildings: OsmBuilding[];
    /** Woods, forests, orchards, scrub (outer rings). */
    woods: OsmArea[];
    trees: OsmPoint[];
    /** Guard rails, fences, walls, hedges, retaining walls. */
    barriers: OsmLine[];
    water: OsmArea[];
}

export function overpassQuery(b: GeoBox): string {
    const bb = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
    return `[out:json][timeout:90];
(
  way["building"](${bb});
  relation["building"]["type"="multipolygon"](${bb});
  way["landuse"~"^(forest|orchard|vineyard)$"](${bb});
  relation["landuse"="forest"](${bb});
  way["natural"~"^(wood|scrub|tree_row|water)$"](${bb});
  relation["natural"~"^(wood|water)$"](${bb});
  node["natural"="tree"](${bb});
  way["barrier"~"^(guard_rail|fence|wall|hedge|retaining_wall)$"](${bb});
);
out tags geom qt;`;
}

type El = { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] };

const ring = (g: { lat: number; lon: number }[] | undefined) => (g ?? []).filter((p) => p && Number.isFinite(p.lat)).map((p) => ({ lat: p.lat, lon: p.lon }));
const closed = (r: LatLon[]) => r.length >= 4 && Math.abs(r[0].lat - r[r.length - 1].lat) < 1e-9 && Math.abs(r[0].lon - r[r.length - 1].lon) < 1e-9;

/** Join a multipolygon's outer member ways into closed rings. */
function joinOuter(members: El['members']): LatLon[][] {
    const parts = (members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => ring(m.geometry)).filter((r) => r.length >= 2);
    const out: LatLon[][] = [];
    const same = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9;
    while (parts.length) {
        let cur = parts.shift()!;
        let grew = true;
        while (!closed(cur) && grew) {
            grew = false;
            for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                if (same(cur[cur.length - 1], p[0])) cur = [...cur, ...p.slice(1)];
                else if (same(cur[cur.length - 1], p[p.length - 1])) cur = [...cur, ...p.slice(0, -1).reverse()];
                else if (same(cur[0], p[p.length - 1])) cur = [...p, ...cur.slice(1)];
                else if (same(cur[0], p[0])) cur = [...p.slice().reverse(), ...cur.slice(1)];
                else continue;
                parts.splice(i, 1); grew = true; break;
            }
        }
        if (closed(cur)) out.push(cur);
    }
    return out;
}

export function parseOverpass(json: { elements?: El[] }, bbox: GeoBox, fetched: string): OsmFeatures {
    const f: OsmFeatures = { fetched, bbox, buildings: [], woods: [], trees: [], barriers: [], water: [] };
    for (const e of json.elements ?? []) {
        const t = e.tags ?? {};
        if (e.type === 'node') {
            if (t.natural === 'tree' && e.lat != null && e.lon != null) f.trees.push({ id: e.id, at: { lat: e.lat, lon: e.lon }, tags: t });
            continue;
        }
        const rings = e.type === 'way' ? [ring(e.geometry)].filter(closed) : joinOuter(e.members);
        if (t.building && t.building !== 'no') { for (const r of rings) f.buildings.push({ id: e.id, ring: r, tags: t }); continue; }
        if (t.barrier && e.type === 'way') { const l = ring(e.geometry); if (l.length >= 2) f.barriers.push({ id: e.id, line: l, tags: t }); continue; }
        if (t.natural === 'tree_row' && e.type === 'way') { const l = ring(e.geometry); if (l.length >= 2) f.barriers.push({ id: e.id, line: l, tags: { ...t, barrier: 'tree_row' } }); continue; }
        if (t.natural === 'water') { if (rings.length) f.water.push({ id: e.id, rings, tags: t }); continue; }
        if (t.landuse === 'forest' || t.natural === 'wood' || t.natural === 'scrub' || t.landuse === 'orchard' || t.landuse === 'vineyard') {
            if (rings.length) f.woods.push({ id: e.id, rings, tags: t });
        }
    }
    return f;
}

/** Fetch from Overpass (public instance; the page waits and retries once if it is busy). */
export async function fetchOsm(fetchFn: (u: string, i?: RequestInit) => Promise<Response>, bbox: GeoBox): Promise<OsmFeatures> {
    const body = `data=${encodeURIComponent(overpassQuery(bbox))}`;
    let last: unknown = null;
    for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
        try {
            const r = await fetchFn(host, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            if (!r.ok) throw new Error(`${new URL(host).host} answered ${r.status}`);
            return parseOverpass(await r.json(), bbox, new Date().toISOString());
        } catch (e) { last = e; }
    }
    throw last instanceof Error ? last : new Error('Overpass unavailable');
}
