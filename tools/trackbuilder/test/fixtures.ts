import type { LatLon } from '../geo.ts';
import type { HeightSampler } from '../elevation.ts';

/** A made-up winding road near West Linn: ~1.6 km of S-bends. */
export function windingRoad(): LatLon[] {
    const pts: LatLon[] = [];
    const lat0 = 45.33, lon0 = -122.69;
    for (let i = 0; i <= 160; i++) {
        const t = i / 160;
        const north = t * 1400;
        const east = 120 * Math.sin(t * Math.PI * 4) + 40 * Math.sin(t * Math.PI * 11);
        pts.push({ lat: lat0 + north / 111_120, lon: lon0 + east / (111_320 * Math.cos((lat0 * Math.PI) / 180)) });
    }
    return pts;
}

/** Sloped terrain with a bump and a little noise. */
export const slopedTerrain: HeightSampler = (p) => {
    const north = (p.lat - 45.33) * 111_120;
    const east = (p.lon + 122.69) * 78_500;
    return 120 + 0.06 * north + 8 * Math.exp(-((north - 700) ** 2 + east ** 2) / 40_000) + 0.3 * Math.sin(east * 0.7) * Math.cos(north * 0.9);
};

/**
 * A made-up ~1 km kart circuit at the Yamhill County Fairgrounds latitude: a hairpin, two straights only
 * 30 m apart centre to centre (so their verges would overlap if not clipped), and a sweeper. Closed loop,
 * counter-clockwise, start/finish on the bottom straight.
 */
export function kartCircuit(): LatLon[] {
    const lat0 = 45.2262, lon0 = -123.1702;
    const ctrl: [number, number][] = [[0, 0], [200, 0]];
    for (let a = -90; a <= 90; a += 15) ctrl.push([200 + 15 * Math.cos((a * Math.PI) / 180), 15 + 15 * Math.sin((a * Math.PI) / 180)]);
    ctrl.push([60, 30], [45, 40], [40, 60], [40, 90], [150, 90], [175, 100], [180, 115], [165, 128], [150, 130], [-20, 130], [-35, 120], [-40, 100], [-40, 20], [-30, 5]);
    const mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
    return ctrl.map(([e, n]) => ({ lat: lat0 + n / 111_120, lon: lon0 + e / mLon }));
}

/** Nearly flat ground with a gentle 1.5 m tilt, like a fairground lot. */
export const flatLot: HeightSampler = (p) => 50 + (p.lat - 45.2262) * 111_120 * 0.01;

import { planSite } from '../site.ts';
import type { SiteRasters, GeoBox } from '../site.ts';
import { makeProjection } from '../geo.ts';

/**
 * Synthetic site data for a line: DEM from `terrain`, aerial photo of green fields with the road drawn as a
 * dark grey stripe (so tests can check the road gets painted out of the ground texture).
 */
export function syntheticSite(line: LatLon[], terrain: HeightSampler, opts: { cellPx?: number; overviewPx?: number } = {}): SiteRasters {
    const plan = planSite(line, { corridorM: 90, marginM: 300 });
    const proj = makeProjection(line[0]);
    const roadPts = line.map((p) => proj.toLocal(p));
    const nearRoad = (lat: number, lon: number) => {
        const q = proj.toLocal({ lat, lon });
        let best = Infinity;
        for (let i = 0; i < roadPts.length - 1; i++) {
            const a = roadPts[i], b = roadPts[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
            best = Math.min(best, Math.hypot(q.x - (a.x + dx * t), q.y - (a.y + dy * t)));
        }
        return best;
    };
    const dem = (bbox: GeoBox, n: number) => {
        const heights = new Float32Array(n * n);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const lat = bbox.north - ((y + 0.5) / n) * (bbox.north - bbox.south), lon = bbox.west + ((x + 0.5) / n) * (bbox.east - bbox.west);
            heights[y * n + x] = terrain({ lat, lon }) ?? 0;
        }
        return { bbox, width: n, height: n, heights };
    };
    const img = (bbox: GeoBox, n: number) => {
        const rgba = new Uint8Array(n * n * 4);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const lat = bbox.north - ((y + 0.5) / n) * (bbox.north - bbox.south), lon = bbox.west + ((x + 0.5) / n) * (bbox.east - bbox.west);
            const road = nearRoad(lat, lon) < 3.5;
            rgba.set(road ? [60, 60, 62, 255] : [90 + (x % 9), 120, 60, 255], (y * n + x) * 4);
        }
        return { bbox, width: n, height: n, rgba };
    };
    const cp = opts.cellPx ?? 64, op = opts.overviewPx ?? 128;
    return {
        version: 1,
        cells: plan.cells.map((c) => ({ ...c, dem: dem(c.bbox, cp), rgb: img(c.bbox, cp) })),
        overview: { ...plan.overview, dem: dem(plan.overview.bbox, op), rgb: img(plan.overview.bbox, op) },
        sources: { elevation: 'synthetic', imagery: 'synthetic', fetched: '2026-10-28' },
    };
}
