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
