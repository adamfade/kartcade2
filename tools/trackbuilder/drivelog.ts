// A drive the driver recorded themselves: phone or dashcam video plus a GPS log with times. The builder plays the
// video beside the 3D preview with the preview's camera following the same spot on the road, so the real road and
// the build can be compared frame by frame. The footage is the driver's own, so frames may also be used in the
// track (facade photos); Google imagery never is.
//
// GPS logs: GPX track points with <time>, KML <gx:Track> (when + gx:coord), GeoJSON with coordTimes, or CSV with
// time, latitude and longitude columns. The video's start time is read from the file (MP4/MOV `mvhd`, or Apple's
// creation date), then nudged by hand if the clocks disagree.

import type { LatLon } from './geo.ts';
import type { Centerline } from './route.ts';

/** One GPS fix: time in ms since 1970 (UTC). */
export interface DriveFix { t: number; lat: number; lon: number }

const valid = (f: DriveFix) => Number.isFinite(f.t) && Number.isFinite(f.lat) && Number.isFinite(f.lon) && Math.abs(f.lat) <= 90 && Math.abs(f.lon) <= 180 && !(f.lat === 0 && f.lon === 0);

function attr(tag: string, name: string) {
    return new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
}

/** ISO date, or a number of seconds / milliseconds since 1970. */
function parseTime(s: string): number {
    const v = s.trim();
    if (/^\d+(\.\d+)?$/.test(v)) { const n = parseFloat(v); return n > 1e11 ? n : n * 1000; }
    return Date.parse(v);
}

function parseGpx(text: string): DriveFix[] {
    const out: DriveFix[] = [];
    for (const m of text.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi)) {
        const time = /<time>\s*([^<]+?)\s*<\/time>/i.exec(m[2])?.[1];
        if (!time) continue;
        out.push({ t: parseTime(time), lat: parseFloat(attr(m[1], 'lat') ?? ''), lon: parseFloat(attr(m[1], 'lon') ?? '') });
    }
    return out;
}

function parseKml(text: string): DriveFix[] {
    const when = [...text.matchAll(/<when>\s*([^<]+?)\s*<\/when>/gi)].map((m) => parseTime(m[1]));
    const coord = [...text.matchAll(/<gx:coord>\s*([^<]+?)\s*<\/gx:coord>/gi)].map((m) => m[1].trim().split(/\s+/).map(Number));
    const n = Math.min(when.length, coord.length), out: DriveFix[] = [];
    for (let i = 0; i < n; i++) out.push({ t: when[i], lon: coord[i][0], lat: coord[i][1] });
    return out;
}

function parseGeoJson(text: string): DriveFix[] {
    type G = { type: string; coordinates?: number[][]; geometry?: G; features?: G[]; properties?: Record<string, unknown> };
    const out: DriveFix[] = [];
    const walk = (g: G | undefined, props?: Record<string, unknown>) => {
        if (!g) return;
        if (g.type === 'FeatureCollection') g.features?.forEach((f) => walk(f));
        else if (g.type === 'Feature') walk(g.geometry, g.properties);
        else if (g.type === 'LineString' && g.coordinates) {
            const times = (props?.coordTimes ?? (props?.coordinateProperties as Record<string, unknown> | undefined)?.times) as (string | number)[] | undefined;
            if (!times) return;
            g.coordinates.forEach(([lon, lat], i) => { if (times[i] != null) out.push({ t: parseTime(String(times[i])), lat, lon }); });
        }
    };
    walk(JSON.parse(text) as G);
    return out;
}

function parseCsv(text: string): DriveFix[] {
    const rows = text.split(/\r?\n/).filter((r) => r.trim());
    if (rows.length < 2) return [];
    const sep = rows[0].includes(';') && !rows[0].includes(',') ? ';' : rows[0].includes('\t') ? '\t' : ',';
    const head = rows[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const col = (re: RegExp) => head.findIndex((h) => re.test(h));
    const ti = col(/^(time|timestamp|date ?time|utc|gps ?time|time ?\(utc\))/), la = col(/^lat/), lo = col(/^(lon|lng|long)/);
    if (ti < 0 || la < 0 || lo < 0) throw new Error('The CSV needs time, latitude and longitude columns');
    return rows.slice(1).map((r) => { const c = r.split(sep).map((x) => x.trim().replace(/^"|"$/g, '')); return { t: parseTime(c[ti]), lat: parseFloat(c[la]), lon: parseFloat(c[lo]) }; });
}

/** Parse a GPS log with times. Fixes come back sorted by time, duplicates and bad rows dropped. */
export function parseDriveLog(text: string, fileName = ''): DriveFix[] {
    const t = text.trimStart();
    let fixes: DriveFix[];
    if (t.startsWith('{') || /\.(geo)?json$/i.test(fileName)) fixes = parseGeoJson(text);
    else if (/<gpx\b/i.test(t) || /\.gpx$/i.test(fileName)) fixes = parseGpx(text);
    else if (/<kml\b/i.test(t) || /\.kml$/i.test(fileName)) fixes = parseKml(text);
    else fixes = parseCsv(text);
    fixes = fixes.filter(valid).sort((a, b) => a.t - b.t).filter((f, i, a) => i === 0 || f.t > a[i - 1].t);
    if (fixes.length < 2) throw new Error('No timed GPS points found (the log needs a time on every point)');
    return fixes;
}

/** Keep one fix per `stepMs` (the saved project stays small; 1 Hz is plenty for following the road). */
export function thinFixes(fixes: DriveFix[], stepMs = 1000): DriveFix[] {
    const out: DriveFix[] = [];
    for (const f of fixes) if (!out.length || f.t - out[out.length - 1].t >= stepMs) out.push(f);
    if (out[out.length - 1] !== fixes[fixes.length - 1]) out.push(fixes[fixes.length - 1]);
    return out;
}

/** Flat array for storage (Firestore has no nested arrays): t in seconds after t0, lat, lon. */
export function packFixes(fixes: DriveFix[]): { t0: number; data: number[] } {
    const t0 = fixes[0]?.t ?? 0, data: number[] = [];
    for (const f of fixes) data.push(Math.round((f.t - t0) / 100) / 10, Math.round(f.lat * 1e6) / 1e6, Math.round(f.lon * 1e6) / 1e6);
    return { t0, data };
}
export function unpackFixes(p: { t0: number; data: number[] }): DriveFix[] {
    const out: DriveFix[] = [];
    for (let i = 0; i + 2 < p.data.length; i += 3) out.push({ t: p.t0 + p.data[i] * 1000, lat: p.data[i + 1], lon: p.data[i + 2] });
    return out;
}

/** Position at time t, interpolated; null outside the log (or across a gap of more than 30 s). */
export function fixAt(fixes: DriveFix[], t: number): LatLon | null {
    if (!fixes.length || t < fixes[0].t || t > fixes[fixes.length - 1].t) return null;
    let lo = 0, hi = fixes.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fixes[mid].t <= t) lo = mid; else hi = mid; }
    const a = fixes[lo], b = fixes[hi];
    if (b.t - a.t > 30_000) return null;
    const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k };
}

export interface RoutePos { s: number; lateral: number; off: number }

/**
 * Where a GPS position is on the route: distance along it, signed offset (left negative, as the preview), and how
 * far it is from the centreline. `near` (the last known s) keeps a road that doubles back from jumping sides.
 */
export function onRoute(cl: Centerline, p: LatLon, near?: number | null): RoutePos {
    const q = cl.projection.toLocal(p);
    const n = cl.points.length, seg = cl.closed ? n : n - 1;
    let best: RoutePos = { s: 0, lateral: 0, off: Infinity }, bestScore = Infinity;
    for (let i = 0; i < seg; i++) {
        const a = cl.points[i], b = cl.points[(i + 1) % n];
        const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
        const k = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2));
        const px = a.x + dx * k, py = a.y + dy * k, d = Math.hypot(q.x - px, q.y - py);
        const s = cl.s[i] + Math.sqrt(L2) * k;
        // Prefer the stretch near the last position: a 200 m jump costs as much as 20 m of distance.
        let ds = near == null ? 0 : Math.abs(s - near);
        if (cl.closed && near != null) ds = Math.min(ds, cl.length - ds);
        const score = d + ds / 10;
        if (score < bestScore) {
            bestScore = score;
            const len = Math.sqrt(L2);
            best = { s, lateral: ((q.x - a.x) * dy - (q.y - a.y) * dx) / len, off: d };
        }
    }
    return best;
}

/**
 * The video's start time (ms since 1970, UTC) from the first and last bytes of an MP4 or MOV: Apple's creation date
 * (which carries its time zone) when present, else the `mvhd` creation time (seconds since 1904, UTC). Phones write
 * `mvhd` when recording stops on some models, so the result is a starting guess the editor lets you nudge.
 */
export function videoStartTime(...chunks: Uint8Array[]): number | null {
    for (const b of chunks) {
        const text = latin1(b);
        const apple = /com\.apple\.quicktime\.creationdate[\s\S]{0,64}?(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:[+-]\d{4}|Z))/.exec(text);
        if (apple) { const t = Date.parse(apple[1].replace(/([+-]\d\d)(\d\d)$/, '$1:$2')); if (Number.isFinite(t)) return t; }
    }
    for (const b of chunks) {
        for (let i = 4; i + 16 < b.length; i++) {
            if (b[i] !== 0x6d || b[i + 1] !== 0x76 || b[i + 2] !== 0x68 || b[i + 3] !== 0x64) continue; // 'mvhd'
            const v = b[i + 4], dv = new DataView(b.buffer, b.byteOffset + i + 8);
            const secs = v === 1 ? Number(dv.getBigUint64(0)) : dv.getUint32(0);
            const t = (secs - 2082844800) * 1000;
            if (secs > 0 && t > Date.UTC(2005, 0, 1) && t < Date.UTC(2100, 0, 1)) return t;
        }
    }
    return null;
}

function latin1(b: Uint8Array) {
    let s = '';
    for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
    return s;
}
