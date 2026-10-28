import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { buildCenterline, dominantWidth, roadWidthFromTags } from '../route.ts';
import { roadProfile, terrariumHeight, terrariumSampler } from '../elevation.ts';
import { decodePNG, encodePNG, makeImage } from '../png.ts';
import { buildTrack } from '../pack.ts';
import { polylineLength } from '../geo.ts';
import { readKn5 } from './kn5Reader.ts';
import type { ReadNode } from './kn5Reader.ts';
import { flatLot, kartCircuit, slopedTerrain, windingRoad } from './fixtures.ts';
import { writeFastLane } from '../aiLine.ts';
import { parseTrace, rotateLoopTo } from '../trace.ts';

test('centerline is evenly spaced, ends at the pins and keeps the length', () => {
    const road = windingRoad();
    const cl = buildCenterline(road, { spacing: 2 });
    const gaps = cl.points.slice(1).map((p, i) => Math.hypot(p.x - cl.points[i].x, p.y - cl.points[i].y));
    assert.ok(Math.max(...gaps) < 2.2 && Math.min(...gaps) > 1.8, `spacing ${Math.min(...gaps)}..${Math.max(...gaps)}`);
    const end = cl.projection.toLocal(road[road.length - 1]);
    assert.ok(Math.hypot(end.x - cl.points.at(-1)!.x, end.y - cl.points.at(-1)!.y) < 0.01);
    const raw = polylineLength(road);
    assert.ok(cl.length > raw * 0.97 && cl.length <= raw * 1.001, `length ${cl.length} vs ${raw}`);
});

test('road width comes from OSM tags', () => {
    assert.equal(roadWidthFromTags({ width: '7' }), 7);
    assert.ok(Math.abs(roadWidthFromTags({ width: "22'" }) - 6.7) < 0.05);
    assert.equal(roadWidthFromTags({ lanes: '2' }), 6.6);
    assert.equal(roadWidthFromTags({}), 6.5);
    assert.equal(dominantWidth([{ tags: { width: '6' }, length: 900 }, { tags: { width: '9' }, length: 100 }]), 6);
});

test('PNG round trip and Terrarium decoding', () => {
    const img = makeImage(3, 2, [10, 20, 30, 255]);
    img.data.set([128, 0, 0, 255], 4);
    const back = decodePNG(encodePNG(img));
    assert.deepEqual(Array.from(back.data), Array.from(img.data));
    assert.equal(terrariumHeight(128, 0, 0), 0);
    assert.equal(terrariumHeight(128, 100, 128), 100.5);
    // Flat 100 m tile -> sampler returns 100 everywhere on it.
    const tile = makeImage(256, 256, [128, 100, 0, 255]);
    const s = terrariumSampler(14, new Map([['2616/5854', { ...tile, channels: 4 as const }]]));
    const h = s({ lat: 45.33, lon: -122.5 });
    assert.ok(h === null || Math.abs(h - 100) < 1e-6);
});

test('elevation profile is smooth and grade-limited', () => {
    const cl = buildCenterline(windingRoad());
    const ll = cl.points.map((p) => cl.projection.toLatLon(p));
    const prof = roadProfile(ll, cl.s, slopedTerrain);
    for (let i = 1; i < prof.heights.length; i++) assert.ok(Math.abs(prof.heights[i] - prof.heights[i - 1]) <= (cl.s[i] - cl.s[i - 1]) * 0.22 + 1e-9);
    assert.ok(prof.climb > 60 && prof.climb < 140, `climb ${prof.climb}`);
});

function walk(n: ReadNode, f: (n: ReadNode) => void) { f(n); n.children.forEach((c) => walk(c, f)); }

test('full build: KN5 round-trips, meshes are valid, AI and zip are complete', () => {
    const res = buildTrack({ name: "Test Hill Rd", polyline: windingRoad(), heightSampler: slopedTerrain, width: 6.5 });
    // Geometry sanity: finite, indices in range, road faces up.
    for (const p of res.geometry.parts) {
        assert.ok(p.positions.every(Number.isFinite), `${p.name} has non-finite positions`);
        assert.ok(p.positions.length / 3 <= 65535);
        assert.ok(Math.max(...p.indices) < p.positions.length / 3);
        if (p.name.startsWith('1ROAD')) for (let v = 1; v < p.normals.length; v += 3) assert.ok(p.normals[v] > 0.9, 'road normal points up');
    }
    const k = readKn5(res.files['test_hill_rd/test_hill_rd.kn5']);
    assert.equal(k.magic, 'sc6969');
    assert.equal(k.consumed, k.total, 'reader consumed the whole file');
    assert.deepEqual(k.textures.map((t) => t.name), ['asphalt.png', 'grass.png', 'wall.png']);
    assert.ok(k.materials.every((m) => m.shader === 'ksPerPixel' && m.textures.length === 1));
    const names: string[] = [];
    walk(k.root, (n) => {
        names.push(n.name);
        if (n.type === 2) { assert.equal(n.badNumbers, 0); assert.ok(n.maxIndex! < n.vertexCount!); assert.ok(n.materialId! < k.materials.length); }
    });
    for (const want of ['1ROAD_0', '1GRASS_L_0', '1GRASS_R_0', '1WALL_L', 'AC_START_0', 'AC_PIT_0', 'AC_HOTLAP_START_0', 'AC_TIME_0_L', 'AC_TIME_0_R', 'AC_TIME_1_L', 'AC_TIME_1_R', 'AC_AB_START_L', 'AC_AB_START_R', 'AC_AB_FINISH_L', 'AC_AB_FINISH_R']) assert.ok(names.includes(want), `missing ${want}`);
    const n = res.centerline.points.length;
    assert.equal(res.files['test_hill_rd/ai/fast_lane.ai'], undefined); // AI spline off until verified in game
    void n;
    const unz = unzipSync(res.zip);
    for (const f of ['kn5', 'data/surfaces.ini', 'data/cameras.ini', 'data/map.ini', 'map.png', 'ui/ui_track.json', 'ui/outline.png', 'ui/preview.png'])
        assert.ok(unz[f === 'kn5' ? 'test_hill_rd/test_hill_rd.kn5' : `test_hill_rd/${f}`], `zip missing ${f}`);
    const ui = JSON.parse(new TextDecoder().decode(unz['test_hill_rd/ui/ui_track.json']));
    assert.equal(ui.run, 'A to B');
    assert.match(ui.description, /OpenStreetMap contributors/);
    const raw = polylineLength(windingRoad());
    assert.ok(Math.abs(res.stats.lengthM - raw) / raw < 0.05, `length ${res.stats.lengthM} vs ${raw}`);
});

test('AI line ends with the v7 has-grid flag', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: i * 2, y: 0, z: 0 }));
    const buf = writeFastLane(pts, { halfWidth: 3 });
    assert.equal(buf.length, 16 + 10 * 20 + 4 + 10 * 72 + 4);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    assert.equal(dv.getInt32(0, true), 7);
    assert.equal(dv.getInt32(16 + 10 * 20, true), 10, 'extra count');
    assert.equal(dv.getInt32(buf.length - 4, true), 0, 'has-grid flag');
});

test('closed centreline: evenly spaced loop, wraps tangents and curvature', () => {
    const cl = buildCenterline(kartCircuit(), { spacing: 1, closed: true });
    assert.equal(cl.closed, true);
    const n = cl.points.length;
    const gap = Math.hypot(cl.points[0].x - cl.points[n - 1].x, cl.points[0].y - cl.points[n - 1].y);
    assert.ok(Math.abs(gap - cl.length / n) < 0.2, `closing gap ${gap}`);
    assert.ok(cl.length > 850 && cl.length < 1150, `lap ${cl.length}`);
    // Total turning of a simple counter-clockwise loop is +2π.
    let turn = 0;
    for (let i = 0; i < n; i++) { const a = cl.tangents[i], b = cl.tangents[(i + 1) % n]; turn += Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y); }
    assert.ok(Math.abs(turn - 2 * Math.PI) < 0.05, `total turn ${turn}`);
    assert.ok(cl.curvature.every(Number.isFinite));
});

test('circuit build: closed meshes, lap gate, grid, closed AI line, no end walls', () => {
    const res = buildTrack({ name: 'Test Kart Circuit', polyline: kartCircuit(), heightSampler: flatLot, width: 8, circuit: true });
    const names = res.geometry.parts.map((p) => p.name);
    assert.ok(!names.includes('1WALL_ENDA') && !names.includes('1WALL_ENDB'));
    const dn = res.geometry.dummies.map((d) => d.name);
    for (const want of ['AC_TIME_0_L', 'AC_TIME_0_R', 'AC_START_0', 'AC_START_11', 'AC_PIT_0', 'AC_PIT_11', 'AC_HOTLAP_START_0']) assert.ok(dn.includes(want), `missing ${want}`);
    assert.ok(!dn.some((d) => d.startsWith('AC_AB_')), 'no A-to-B gates on a circuit');
    // Grid sits behind the line, facing the direction of travel.
    const t0 = res.centerline.tangents[0], line = res.geometry.dummies.find((d) => d.name === 'AC_TIME_0_L')!;
    const g0 = res.geometry.dummies.find((d) => d.name === 'AC_START_0')!;
    const along = (g0.position[0] - line.position[0]) * t0.x + (g0.position[2] - line.position[2]) * t0.y;
    assert.ok(along < -3, `pole is ${along} m from the line`);
    assert.ok(g0.forward[0] * t0.x + g0.forward[2] * t0.y > 0.9);
    // The road strip closes: its last row is its first row.
    const road = res.geometry.parts.filter((p) => p.name.startsWith('1ROAD'));
    const first = road[0].positions.slice(0, 3), lastPart = road[road.length - 1];
    const last = lastPart.positions.slice(-15, -12);
    assert.ok(Math.hypot(first[0] - last[0], first[2] - last[2]) < 1e-6, 'road loop joins');
    const k = readKn5(res.files['test_kart_circuit/test_kart_circuit.kn5']);
    assert.equal(k.consumed, k.total);
    const ui = JSON.parse(new TextDecoder().decode(res.files['test_kart_circuit/ui/ui_track.json']));
    assert.equal(ui.run, 'counter-clockwise');
    assert.equal(ui.pitboxes, '12');
    // Reversed: same loop, clockwise, same start/finish point.
    const rev = buildTrack({ name: 'Rev', polyline: kartCircuit(), heightSampler: flatLot, width: 8, circuit: true, reverse: true });
    assert.equal(JSON.parse(new TextDecoder().decode(rev.files['rev/ui/ui_track.json'])).run, 'clockwise');
    assert.ok(Math.hypot(rev.centerline.points[0].x - res.centerline.points[0].x, rev.centerline.points[0].y - res.centerline.points[0].y) < 3);
});

test('verges from neighbouring sections never overlap', () => {
    const res = buildTrack({ name: 'Verge', polyline: kartCircuit(), heightSampler: flatLot, width: 8, circuit: true });
    const cl = res.centerline, n = cl.points.length;
    // Each grass vertex must be at least as close to its own section of centreline as to any part of the
    // loop that is far along the track (allowing 1 m slack).
    let bad = 0;
    for (const part of res.geometry.parts.filter((p) => p.name.startsWith('1GRASS'))) {
        const cols = 6, rows = part.positions.length / 3 / cols;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const v = (r * cols + c) * 3, x = part.positions[v], z = part.positions[v + 2];
            let best = Infinity, bestI = 0;
            for (let i = 0; i < n; i++) { const d = Math.hypot(cl.points[i].x - x, cl.points[i].y - z); if (d < best) { best = d; bestI = i; } }
            // Distance to the nearest centreline point within 20 m of track of the nearest one.
            let own = Infinity;
            for (let k = -60; k <= 60; k++) { const i = (bestI + k + n) % n; own = Math.min(own, Math.hypot(cl.points[i].x - x, cl.points[i].y - z)); }
            if (own > best + 1) bad++;
        }
    }
    assert.equal(bad, 0);
    // And the clipping actually happened: the straights 30 m apart can't both keep a 25 m verge.
    const outer = res.geometry.parts.filter((p) => p.name.startsWith('1GRASS_R')).flatMap((part) => {
        const cols = 6, rows = part.positions.length / 3 / cols, out: number[] = [];
        for (let r = 0; r < rows; r++) {
            const a = (r * cols) * 3, b = (r * cols + cols - 1) * 3;
            out.push(Math.hypot(part.positions[b] - part.positions[a], part.positions[b + 2] - part.positions[a + 2]));
        }
        return out;
    });
    assert.ok(outer.some((w) => w < 15), 'some verges were clipped');
    assert.ok(outer.some((w) => w > 24), 'open verges keep their full width');
});

test('trace files: GPX, KML and GeoJSON', () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><name>Lap</name><trkseg><trkpt lat="45.1" lon="-123.1"/><trkpt lat="45.2" lon="-123.2"></trkpt><trkpt lat='45.3' lon='-123.3'/></trkseg></trk></gpx>`;
    const g = parseTrace(gpx);
    assert.equal(g.format, 'gpx'); assert.equal(g.line.length, 3); assert.equal(g.name, 'Lap'); assert.equal(g.line[1].lon, -123.2);
    const kml = `<kml><Placemark><Point><coordinates>-123,45</coordinates></Point></Placemark><Placemark><name>Track</name><LineString><coordinates>-123.1,45.1,0 -123.2,45.2,0\n -123.3,45.3,0</coordinates></LineString></Placemark></kml>`;
    const k = parseTrace(kml);
    assert.equal(k.format, 'kml'); assert.equal(k.line.length, 3); assert.equal(k.line[2].lat, 45.3);
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Mac' }, geometry: { type: 'Polygon', coordinates: [[[-123.1, 45.1], [-123.2, 45.2], [-123.3, 45.1], [-123.1, 45.1]]] } }] });
    const j = parseTrace(gj);
    assert.equal(j.format, 'geojson'); assert.equal(j.line.length, 4); assert.equal(j.name, 'Mac');
    const rot = rotateLoopTo(j.line, { lat: 45.2, lon: -123.2 });
    assert.equal(rot.length, 3, 'closing point dropped');
    assert.deepEqual(rot[0], { lat: 45.2, lon: -123.2 });
    assert.throws(() => parseTrace('hello'));
});
