// Network side of the pipeline, shared by the admin page (browser fetch) and the CLI (Node fetch).
// Every request is small and polite: one geocode per pin, one route, one optional Overpass call,
// and only the elevation tiles that cover the road.

import { bboxOf, haversine } from './geo.ts';
import type { LatLon } from './geo.ts';
import { terrariumSampler, terrariumUrl, tilesForBBox } from './elevation.ts';
import type { TilePixels } from './elevation.ts';
import { dominantWidth } from './route.ts';
import { buildTrack } from './pack.ts';
import type { BuildResult } from './pack.ts';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type DecodeTile = (png: Uint8Array) => Promise<TilePixels> | TilePixels;

export interface NetOptions {
    fetch: FetchLike;
    /** Browsers can't set User-Agent; Node can. */
    headers?: Record<string, string>;
    log?: (msg: string) => void;
}

async function getJSON(net: NetOptions, url: string, init?: RequestInit) {
    const res = await net.fetch(url, { ...init, headers: { Accept: 'application/json', ...(net.headers ?? {}), ...((init?.headers as Record<string, string>) ?? {}) } });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return res.json();
}

export interface Place { name: string; lat: number; lon: number }

export async function geocode(net: NetOptions, q: string, limit = 5): Promise<Place[]> {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${limit}&countrycodes=us&q=${encodeURIComponent(q)}`;
    const rows = (await getJSON(net, url)) as { display_name: string; lat: string; lon: string }[];
    return rows.map((r) => ({ name: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon) }));
}

export interface Route { line: LatLon[]; distanceM: number }

/** Driving route through the pins (OSRM public demo server: fine for a handful of requests). */
export async function route(net: NetOptions, pins: LatLon[]): Promise<Route> {
    if (pins.length < 2) throw new Error('Need a start and an end pin');
    const coords = pins.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=true`;
    const j = await getJSON(net, url);
    if (j.code !== 'Ok' || !j.routes?.length) throw new Error(`No route found (${j.code ?? 'unknown'})`);
    const line = (j.routes[0].geometry.coordinates as [number, number][]).map(([lon, lat]) => ({ lat, lon }));
    return { line, distanceM: j.routes[0].distance };
}

/** OSM ways along the route (for width/lanes). Optional: callers fall back to a default width on failure. */
export async function roadWays(net: NetOptions, line: LatLon[]): Promise<{ tags: Record<string, string>; length: number }[]> {
    const step = Math.max(1, Math.floor(line.length / 25));
    const pts = line.filter((_, i) => i % step === 0).map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(',');
    const q = `[out:json][timeout:20];way(around:10,${pts})[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track)(_link)?$"];out tags geom;`;
    const res = await net.fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(net.headers ?? {}) },
        body: `data=${encodeURIComponent(q)}`,
    });
    if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
    const j = await res.json();
    return (j.elements ?? []).map((e: { tags?: Record<string, string>; geometry?: LatLon[] }) => {
        const g = e.geometry ?? [];
        let length = 0;
        for (let i = 1; i < g.length; i++) length += haversine(g[i - 1], g[i]);
        return { tags: e.tags ?? {}, length };
    });
}

/** Fetch and decode the Terrarium tiles covering the road (+ verge), returning a height sampler. */
export async function elevationSampler(net: NetOptions, line: LatLon[], decode: DecodeTile, z = 14) {
    const tiles = tilesForBBox(bboxOf(line, 120), z);
    if (tiles.length > 64) throw new Error(`Road is too long for one build (${tiles.length} elevation tiles); split it`);
    const map = new Map<string, TilePixels>();
    for (const t of tiles) {
        const res = await net.fetch(terrariumUrl(t), { headers: net.headers });
        if (!res.ok) throw new Error(`Elevation tile ${t.z}/${t.x}/${t.y} answered ${res.status}`);
        map.set(`${t.x}/${t.y}`, await decode(new Uint8Array(await res.arrayBuffer())));
    }
    net.log?.(`Loaded ${tiles.length} elevation tiles (zoom ${z})`);
    return terrariumSampler(z, map);
}

export interface BuildFromPinsInput {
    name: string;
    pins: LatLon[]; // start, optional vias, end
    widthOverride?: number;
    walls?: boolean;
    flipStart?: boolean;
    city?: string;
    useOverpass?: boolean;
}

export async function buildFromPins(net: NetOptions, decode: DecodeTile, input: BuildFromPinsInput): Promise<BuildResult & { routeDistanceM: number; widthSource: string }> {
    const log = net.log ?? (() => {});
    log('Routing along the road (OSRM)');
    const r = await route(net, input.pins);
    log(`Route: ${(r.distanceM / 1000).toFixed(2)} km, ${r.line.length} points`);
    let width = input.widthOverride ?? 0;
    let widthSource = 'set by hand';
    if (!width) {
        width = 6.5; widthSource = 'default (6.5 m)';
        if (input.useOverpass ?? true) {
            try {
                log('Reading road width and lanes from OpenStreetMap (Overpass)');
                const ways = await roadWays(net, r.line);
                if (ways.length) { width = dominantWidth(ways, 6.5); widthSource = `OpenStreetMap tags (${ways.length} ways)`; }
            } catch (e) {
                log(`Overpass unavailable (${(e as Error).message}); using 6.5 m`);
            }
        }
    }
    log(`Road width ${width.toFixed(1)} m (${widthSource})`);
    const sampler = await elevationSampler(net, r.line, decode);
    const result = buildTrack({ name: input.name, polyline: r.line, heightSampler: sampler, width, walls: input.walls, flipStart: input.flipStart, city: input.city, log });
    return { ...result, routeDistanceM: r.distanceM, widthSource };
}
