// OpenStreetMap features around a track (ODbL, credited in ui_track.json): buildings, woods, single trees,
// barriers, the drivable roads near the route (lanes, widths, bridges, side streets) and street furniture
// (signals, stop signs, crossings, lamps, bus stops). Fetched once from the Overpass API in the browser and
// stored with the site data. Bump OSM_VERSION when the query changes so stored sites refetch.

import type { LatLon } from './geo.ts';
import type { GeoBox } from './site.ts';

export interface OsmBuilding { id: number; ring: LatLon[]; tags: Record<string, string> }
export interface OsmArea { id: number; rings: LatLon[][]; tags: Record<string, string> }
export interface OsmPoint { id: number; at: LatLon; tags: Record<string, string> }
export interface OsmLine { id: number; line: LatLon[]; tags: Record<string, string> }
/** A road with its node ids, so junctions (shared nodes) and signals on it can be found. */
export interface OsmWay { id: number; nodes: number[]; line: LatLon[]; tags: Record<string, string> }

export const OSM_VERSION = 4;
/** Highways a car can use (side streets, the route itself). */
export const DRIVABLE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)(_link)?$/;

export interface OsmFeatures {
    /** Query version (absent = 1: no roads or street furniture). */
    version?: number;
    fetched: string;
    bbox: GeoBox;
    buildings: OsmBuilding[];
    /** Woods, forests, orchards, scrub (outer rings). */
    woods: OsmArea[];
    trees: OsmPoint[];
    /** Guard rails, fences, walls, hedges, retaining walls. */
    barriers: OsmLine[];
    water: OsmArea[];
    /** Drivable roads within ~200 m of the route (v2+). */
    roads?: OsmWay[];
    /** Street furniture within ~60 m of the route (v2+): signals, stop/give way, crossings, lamps, bus stops, signs;
     *  fire hydrants and power poles (v3+). */
    points?: OsmPoint[];
    /** Shops, restaurants, offices and other businesses within ~120 m of the route (v3+): storefronts. */
    pois?: OsmPoint[];
    /** Power and telephone lines within ~150 m of the route (v3+). */
    power?: OsmLine[];
    /** Ground-cover areas near the route (v3+): parking, parks, pitches, grass, cemeteries. */
    areas?: OsmArea[];
}

/** Douglas-Peucker in degrees scaled to metres (for Overpass `around` lines, which have a length limit). */
export function simplifyLine(line: LatLon[], tolM = 8): LatLon[] {
    if (line.length < 3) return line.slice();
    const kx = 111320 * Math.cos((line[0].lat * Math.PI) / 180), ky = 110540;
    const keep = new Uint8Array(line.length); keep[0] = keep[line.length - 1] = 1;
    const stack: [number, number][] = [[0, line.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop()!;
        const ax = line[a].lon * kx, ay = line[a].lat * ky, dx = line[b].lon * kx - ax, dy = line[b].lat * ky - ay, l2 = dx * dx + dy * dy || 1;
        let best = -1, bd = tolM;
        for (let i = a + 1; i < b; i++) {
            const px = line[i].lon * kx - ax, py = line[i].lat * ky - ay, t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2));
            const d = Math.hypot(px - dx * t, py - dy * t);
            if (d > bd) { bd = d; best = i; }
        }
        if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return line.filter((_, i) => keep[i]);
}

export function overpassQuery(b: GeoBox, route?: LatLon[]): string {
    const bb = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
    let near = '';
    if (route && route.length >= 2) {
        let tol = 8, s = simplifyLine(route, tol);
        while (s.length > 400) s = simplifyLine(route, (tol *= 1.6));
        const L = s.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(',');
        near = `
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)(_link)?$"](around:200,${L});
  node["highway"~"^(traffic_signals|stop|give_way|crossing|street_lamp|bus_stop|speed_camera)$"](around:60,${L});
  node["traffic_sign"](around:60,${L});
  node["railway"="level_crossing"](around:60,${L});
  node["emergency"="fire_hydrant"](around:60,${L});
  node["power"~"^(pole|tower)$"](around:120,${L});
  way["power"~"^(line|minor_line)$"](around:150,${L});
  node["shop"](around:120,${L});
  node["amenity"~"^(restaurant|cafe|fast_food|bar|pub|bank|pharmacy|post_office|library|clinic|dentist|doctors|ice_cream|fuel|car_wash|veterinary)$"](around:120,${L});
  node["office"](around:120,${L});
  node["craft"](around:120,${L});
  node["leisure"~"^(amusement_arcade|fitness_centre|sports_centre|escape_game|bowling_alley)$"](around:120,${L});
  way["amenity"="parking"](around:200,${L});
  way["leisure"~"^(park|pitch|playground|golf_course)$"](around:300,${L});
  way["landuse"~"^(grass|meadow|cemetery|recreation_ground|village_green)$"](around:300,${L});`;
    }
    return `[out:json][timeout:120];
(
  way["building"](${bb});
  relation["building"]["type"="multipolygon"](${bb});
  way["landuse"~"^(forest|orchard|vineyard)$"](${bb});
  relation["landuse"="forest"](${bb});
  way["natural"~"^(wood|scrub|tree_row|water)$"](${bb});
  relation["natural"~"^(wood|water)$"](${bb});
  node["natural"="tree"](${bb});
  way["barrier"~"^(guard_rail|fence|wall|hedge|retaining_wall)$"](${bb});${near}
);
out body geom qt;`;
}

type El = { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; tags?: Record<string, string>; nodes?: number[]; geometry?: { lat: number; lon: number }[]; members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] };

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
    const f: OsmFeatures = { version: OSM_VERSION, fetched, bbox, buildings: [], woods: [], trees: [], barriers: [], water: [], roads: [], points: [], pois: [], power: [], areas: [] };
    const seen = new Set<string>();
    for (const e of json.elements ?? []) {
        const key = `${e.type}${e.id}`;
        if (seen.has(key)) continue; // a feature matched by two parts of the query
        seen.add(key);
        const t = e.tags ?? {};
        if (e.type === 'node') {
            if (e.lat == null || e.lon == null) continue;
            if (t.natural === 'tree') f.trees.push({ id: e.id, at: { lat: e.lat, lon: e.lon }, tags: t });
            else if (t.highway || t.traffic_sign || t.railway === 'level_crossing' || t.emergency === 'fire_hydrant' || t.power === 'pole' || t.power === 'tower') f.points!.push({ id: e.id, at: { lat: e.lat, lon: e.lon }, tags: t });
            else if (t.shop || t.amenity || t.office || t.craft || /^(amusement_arcade|fitness_centre|sports_centre|escape_game|bowling_alley)$/.test(t.leisure ?? '')) f.pois!.push({ id: e.id, at: { lat: e.lat, lon: e.lon }, tags: t });
            continue;
        }
        if (e.type === 'way' && t.highway && DRIVABLE.test(t.highway) && t.area !== 'yes') {
            const l = ring(e.geometry);
            if (l.length >= 2 && e.nodes?.length === l.length) f.roads!.push({ id: e.id, nodes: e.nodes, line: l, tags: t });
            continue;
        }
        const rings = e.type === 'way' ? [ring(e.geometry)].filter(closed) : joinOuter(e.members);
        if (t.building && t.building !== 'no') { for (const r of rings) f.buildings.push({ id: e.id, ring: r, tags: t }); continue; }
        if ((t.power === 'line' || t.power === 'minor_line') && e.type === 'way') { const l = ring(e.geometry); if (l.length >= 2) f.power!.push({ id: e.id, line: l, tags: t }); continue; }
        if (!t.natural && t.landuse !== 'forest' && (t.amenity === 'parking' || /^(park|pitch|playground|golf_course)$/.test(t.leisure ?? '') || (t.landuse && /^(grass|meadow|cemetery|recreation_ground|village_green)$/.test(t.landuse))) && !t.building) { if (rings.length) f.areas!.push({ id: e.id, rings, tags: t }); continue; }
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
export async function fetchOsm(fetchFn: (u: string, i?: RequestInit) => Promise<Response>, bbox: GeoBox, route?: LatLon[]): Promise<OsmFeatures> {
    const body = `data=${encodeURIComponent(overpassQuery(bbox, route))}`;
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
