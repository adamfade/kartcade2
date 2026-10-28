// Reading a traced line (a circuit lap, or a road) from GPX, KML or GeoJSON text.
// Circuits aren't routable (OSRM won't drive onto a raceway), so their centreline comes from a trace:
// a GPS lap, a line drawn in Google Earth / geojson.io, or an OpenStreetMap raceway way.

import type { LatLon } from './geo.ts';

export interface Trace { line: LatLon[]; name?: string; format: 'gpx' | 'kml' | 'geojson' }

const num = (s: string | undefined) => (s == null ? NaN : parseFloat(s));
const valid = (p: LatLon) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

function attr(tag: string, name: string) {
    const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
    return m?.[1];
}

function parseGpx(text: string): Trace {
    // Track points first, then route points, then waypoints (a hand-made GPX is often just waypoints).
    for (const el of ['trkpt', 'rtept', 'wpt']) {
        const line: LatLon[] = [];
        for (const m of text.matchAll(new RegExp(`<${el}\\b[^>]*>`, 'gi'))) {
            const p = { lat: num(attr(m[0], 'lat')), lon: num(attr(m[0], 'lon')) };
            if (valid(p)) line.push(p);
        }
        if (line.length >= 2) return { line, name: /<name>\s*([^<]+?)\s*<\/name>/i.exec(text)?.[1], format: 'gpx' };
    }
    throw new Error('No track, route or waypoint coordinates found in the GPX file');
}

function parseKml(text: string): Trace {
    // The longest <coordinates> block is the line we want (placemark pins are single points).
    let best: LatLon[] = [];
    for (const m of text.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)) {
        const line = m[1].trim().split(/\s+/).map((t) => { const [lon, lat] = t.split(',').map(Number); return { lat, lon }; }).filter(valid);
        if (line.length > best.length) best = line;
    }
    if (best.length < 2) throw new Error('No line coordinates found in the KML file');
    return { line: best, name: /<name>\s*([^<]+?)\s*<\/name>/i.exec(text)?.[1], format: 'kml' };
}

type Geo = { type: string; coordinates?: unknown; geometry?: Geo; features?: Geo[]; geometries?: Geo[]; properties?: Record<string, unknown> };

function parseGeoJson(text: string): Trace {
    const root = JSON.parse(text) as Geo;
    const lines: { line: LatLon[]; name?: string }[] = [];
    const toLine = (c: unknown) => (c as number[][]).map(([lon, lat]) => ({ lat, lon })).filter(valid);
    const walk = (g: Geo | undefined, name?: string) => {
        if (!g) return;
        const nm = (g.properties?.name as string | undefined) ?? name;
        switch (g.type) {
            case 'FeatureCollection': g.features?.forEach((f) => walk(f)); break;
            case 'Feature': walk(g.geometry, nm); break;
            case 'GeometryCollection': g.geometries?.forEach((x) => walk(x, nm)); break;
            case 'LineString': lines.push({ line: toLine(g.coordinates), name: nm }); break;
            case 'MultiLineString': (g.coordinates as unknown[]).forEach((c) => lines.push({ line: toLine(c), name: nm })); break;
            case 'Polygon': lines.push({ line: toLine((g.coordinates as unknown[])[0]), name: nm }); break; // outer ring
        }
    };
    walk(root);
    const best = lines.sort((a, b) => b.line.length - a.line.length)[0];
    if (!best || best.line.length < 2) throw new Error('No LineString or Polygon found in the GeoJSON');
    return { line: best.line, name: best.name, format: 'geojson' };
}

/** Parse GPX, KML or GeoJSON. The format is sniffed from the content; the file name is only a hint. */
export function parseTrace(text: string, fileName = ''): Trace {
    const t = text.trimStart();
    if (t.startsWith('{') || /\.(geo)?json$/i.test(fileName)) return parseGeoJson(text);
    if (/<gpx\b/i.test(t) || /\.gpx$/i.test(fileName)) return parseGpx(text);
    if (/<kml\b/i.test(t) || /\.kml$/i.test(fileName)) return parseKml(text);
    throw new Error('Unrecognised trace: expected GPX, KML or GeoJSON');
}

/**
 * Move the start of a closed loop to the point nearest `at` (the start/finish line), keeping direction.
 * A repeated closing point is dropped first.
 */
export function rotateLoopTo(line: LatLon[], at: LatLon): LatLon[] {
    const pts = line.slice();
    const a = pts[0], b = pts[pts.length - 1];
    if (pts.length > 2 && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7) pts.pop();
    const k = Math.cos((at.lat * Math.PI) / 180);
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = (p.lat - at.lat) ** 2 + ((p.lon - at.lon) * k) ** 2; if (d < bd) { bd = d; best = i; } });
    return [...pts.slice(best), ...pts.slice(0, best)];
}
