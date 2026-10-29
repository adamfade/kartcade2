import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCenterline } from '../route.ts';
import { fixAt, onRoute, packFixes, parseDriveLog, thinFixes, unpackFixes, videoStartTime } from '../drivelog.ts';
import type { DriveFix } from '../drivelog.ts';
import { quadPoint, quadSize, warpQuad } from '../warp.ts';

const T0 = Date.UTC(2026, 9, 30, 17, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

test('drive logs: GPX, KML gx:Track, GeoJSON and CSV with times', () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>
        <trkpt lat="45.3900" lon="-122.6440"><ele>30</ele><time>${iso(T0)}</time></trkpt>
        <trkpt lat="45.3901" lon="-122.6441"><time>${iso(T0 + 1000)}</time></trkpt>
        <trkpt lat="45.3902" lon="-122.6442"><time>${iso(T0 + 1000)}</time></trkpt>
        <trkpt lat="45.3903" lon="-122.6443"></trkpt>
        <trkpt lat="45.3904" lon="-122.6444"><time>${iso(T0 + 2000)}</time></trkpt></trkseg></trk></gpx>`;
    const g = parseDriveLog(gpx, 'drive.gpx');
    assert.equal(g.length, 3, 'duplicate time and untimed point dropped');
    assert.equal(g[0].t, T0);
    assert.equal(g[2].lat, 45.3904);

    const kml = `<kml><gx:Track><when>${iso(T0)}</when><when>${iso(T0 + 2000)}</when><gx:coord>-122.644 45.39 30</gx:coord><gx:coord>-122.645 45.391 31</gx:coord></gx:Track></kml>`;
    const k = parseDriveLog(kml);
    assert.deepEqual(k.map((f) => [f.t - T0, f.lat, f.lon]), [[0, 45.39, -122.644], [2000, 45.391, -122.645]]);

    const gj = JSON.stringify({ type: 'Feature', properties: { coordTimes: [iso(T0), iso(T0 + 1000)] }, geometry: { type: 'LineString', coordinates: [[-122.644, 45.39], [-122.645, 45.391]] } });
    assert.equal(parseDriveLog(gj).length, 2);

    const csv = `time,lat,lon,speed\n${T0 / 1000},45.39,-122.644,10\n${T0 / 1000 + 1},45.3901,-122.6441,11\n`;
    const c = parseDriveLog(csv, 'log.csv');
    assert.equal(c.length, 2);
    assert.equal(c[1].t, T0 + 1000);

    assert.throws(() => parseDriveLog('<gpx><trk><trkpt lat="1" lon="2"></trkpt></trk></gpx>'), /No timed GPS points/);
    assert.throws(() => parseDriveLog('a,b,c\n1,2,3'), /time, latitude and longitude/);
});

test('drive logs: thinning, packing for the project, interpolation', () => {
    const fixes: DriveFix[] = [];
    for (let i = 0; i <= 50; i++) fixes.push({ t: T0 + i * 200, lat: 45.39 + i * 1e-5, lon: -122.644 });
    const thin = thinFixes(fixes);
    assert.equal(thin.length, 11);
    assert.equal(thin.at(-1)!.t, T0 + 10_000);
    const back = unpackFixes(packFixes(thin));
    assert.equal(back.length, thin.length);
    assert.ok(back.every((f, i) => Math.abs(f.t - thin[i].t) < 1 && Math.abs(f.lat - thin[i].lat) < 1e-6));
    const mid = fixAt(thin, T0 + 1500)!;
    assert.ok(Math.abs(mid.lat - (45.39 + 7.5e-5)) < 1e-9);
    assert.equal(fixAt(thin, T0 - 1), null);
    assert.equal(fixAt([{ t: T0, lat: 45, lon: -122 }, { t: T0 + 60_000, lat: 45.1, lon: -122 }], T0 + 30_000), null, 'no guessing across a long gap');
});

test('drive logs: GPS positions land on the route, and a hairpin does not jump sides', () => {
    // Up 400 m, a hairpin, back down 400 m 30 m to the east.
    const line = [];
    for (let i = 0; i <= 40; i++) line.push({ lat: 45.39 + (i * 10) / 111_120, lon: -122.644 });
    for (let i = 0; i <= 40; i++) line.push({ lat: 45.39 + ((400 - i * 10) / 111_120), lon: -122.644 + 30 / (111_320 * Math.cos((45.39 * Math.PI) / 180)) });
    const cl = buildCenterline(line, { spacing: 2, smoothSigma: 3 });
    const east3 = 3 / (111_320 * Math.cos((45.39 * Math.PI) / 180));
    // 200 m up the first leg, 3 m east of it (to the right when driving north).
    const up = onRoute(cl, { lat: 45.39 + 200 / 111_120, lon: -122.644 + east3 });
    assert.ok(Math.abs(up.s - 200) < 3, `s ${up.s}`);
    assert.ok(Math.abs(up.lateral - 3) < 0.3, `lateral ${up.lateral}`);
    assert.ok(up.off < 3.3);
    // Halfway between the legs (15 m from each): the last known position decides which leg.
    const between = { lat: 45.39 + 200 / 111_120, lon: -122.644 + 15 / (111_320 * Math.cos((45.39 * Math.PI) / 180)) };
    const down = onRoute(cl, between, cl.length - 210);
    assert.ok(down.s > cl.length / 2, `s ${down.s} should be on the way back down`);
    const upAgain = onRoute(cl, between, 190);
    assert.ok(upAgain.s < cl.length / 2);
});

test('drive video: start time from Apple creation date or the mvhd box', () => {
    const enc = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    const apple = enc('....mdta com.apple.quicktime.creationdate ....data....2026-10-30T10:00:05-0700....');
    assert.equal(videoStartTime(apple), Date.UTC(2026, 9, 30, 17, 0, 5));
    // mvhd version 0: size, 'mvhd', version 0, flags, creation time (seconds since 1904).
    const box = new Uint8Array(40), dv = new DataView(box.buffer);
    dv.setUint32(0, 40); box.set(enc('mvhd'), 4); dv.setUint32(12, T0 / 1000 + 2082844800);
    assert.equal(videoStartTime(new Uint8Array(100), box), T0);
    assert.equal(videoStartTime(new Uint8Array(64)), null);
});

test('facade frames: the four clicked corners warp to a flat rectangle', () => {
    // A 100 x 100 image: left half red, right half blue; the "wall" is a trapezoid seen at an angle.
    const W = 100, src = { width: W, height: W, data: new Uint8Array(W * W * 4) };
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; src.data[i] = x < 50 ? 255 : 0; src.data[i + 2] = x < 50 ? 0 : 255; src.data[i + 3] = 255; }
    const q = [{ x: 10, y: 20 }, { x: 90, y: 5 }, { x: 90, y: 95 }, { x: 10, y: 80 }];
    // Corners map exactly.
    for (const [u, v, k] of [[0, 0, 0], [1, 0, 1], [1, 1, 2], [0, 1, 3]] as const) {
        const p = quadPoint(q, u, v);
        assert.ok(Math.hypot(p.x - q[k].x, p.y - q[k].y) < 1e-6);
    }
    const size = quadSize(q, 64);
    assert.equal(size.width, 64);
    const out = warpQuad(src, q, size.width, size.height);
    assert.equal(out.data.length, size.width * size.height * 4);
    // Perspective: the image's x = 50 seam lands right of the middle (the far side is foreshortened).
    const row = Math.floor(size.height / 2), firstBlue = [...Array(size.width).keys()].find((x) => out.data[(row * size.width + x) * 4 + 2] > 128)!;
    assert.ok(firstBlue > size.width / 2, `seam at ${firstBlue} of ${size.width}`);
});
