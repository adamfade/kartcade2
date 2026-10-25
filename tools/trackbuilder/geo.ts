// Geodesy helpers: a local east/north projection in metres around an origin.
// Good to well under a metre over a few tens of kilometres, which is all a road track needs.

export type LatLon = { lat: number; lon: number };
/** Local metres: x = east, y = north. */
export type Vec2 = { x: number; y: number };

const DEG = Math.PI / 180;

export interface Projection {
    origin: LatLon;
    toLocal(p: LatLon): Vec2;
    toLatLon(v: Vec2): LatLon;
}

export function makeProjection(origin: LatLon): Projection {
    const lat0 = origin.lat * DEG;
    // Metres per degree at this latitude (WGS84 series expansion).
    const mLat = 111132.92 - 559.82 * Math.cos(2 * lat0) + 1.175 * Math.cos(4 * lat0) - 0.0023 * Math.cos(6 * lat0);
    const mLon = 111412.84 * Math.cos(lat0) - 93.5 * Math.cos(3 * lat0) + 0.118 * Math.cos(5 * lat0);
    return {
        origin,
        toLocal: (p) => ({ x: (p.lon - origin.lon) * mLon, y: (p.lat - origin.lat) * mLat }),
        toLatLon: (v) => ({ lat: origin.lat + v.y / mLat, lon: origin.lon + v.x / mLon }),
    };
}

export function haversine(a: LatLon, b: LatLon): number {
    const R = 6371008.8;
    const dLat = (b.lat - a.lat) * DEG;
    const dLon = (b.lon - a.lon) * DEG;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function polylineLength(points: LatLon[]): number {
    let d = 0;
    for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
    return d;
}

export type BBox = { south: number; west: number; north: number; east: number };

export function bboxOf(points: LatLon[], padMetres = 0): BBox {
    let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
    for (const p of points) {
        south = Math.min(south, p.lat); north = Math.max(north, p.lat);
        west = Math.min(west, p.lon); east = Math.max(east, p.lon);
    }
    const dLat = padMetres / 111_000;
    const dLon = padMetres / (111_000 * Math.cos(((south + north) / 2) * DEG));
    return { south: south - dLat, west: west - dLon, north: north + dLat, east: east + dLon };
}
