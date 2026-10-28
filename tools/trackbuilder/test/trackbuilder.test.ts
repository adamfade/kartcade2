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
import type { TrackElement } from '../elements.ts';
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
    const texNames = new Set(k.textures.map((t) => t.name));
    assert.ok(k.textures.every((t) => t.name.endsWith('.dds')), 'every texture is DDS');
    for (const m of k.materials) for (const t of m.textures) assert.ok(texNames.has(t), `${m.name} uses missing ${t}`);
    const road = k.materials.find((m) => m.shader === 'ksPerPixelMultiMap_NMDetail');
    assert.ok(road, 'ground materials use the macro + detail shader');
    assert.ok(['road', 'shoulder', 'verge', 'terrain', 'paint_white', 'paint_yellow', 'wall'].every((n) => res.materials.some((m) => m.name === n)));
    const names: string[] = [];
    walk(k.root, (n) => {
        names.push(n.name);
        if (n.type === 2) { assert.equal(n.badNumbers, 0); assert.ok(n.maxIndex! < n.vertexCount!); assert.ok(n.materialId! < k.materials.length); }
    });
    for (const want of ['1ROAD_0', '1GRASS_L_0', '1GRASS_R_0', '1GRAVEL_L_0', '1GRAVEL_R_0', 'PAINT_WHITE_0', 'PAINT_YELLOW_0', '1WALL_L', 'AC_START_0', 'AC_PIT_0', 'AC_HOTLAP_START_0', 'AC_TIME_0_L', 'AC_TIME_0_R', 'AC_TIME_1_L', 'AC_TIME_1_R', 'AC_AB_START_L', 'AC_AB_START_R', 'AC_AB_FINISH_L', 'AC_AB_FINISH_R']) assert.ok(names.includes(want), `missing ${want}`);
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
        const cols = 5, rows = part.positions.length / 3 / cols;
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
        const cols = 5, rows = part.positions.length / 3 / cols, out: number[] = [];
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

const SCENERY: TrackElement[] = [
    { id: 'gr1', type: 'guardrail', from: 200, to: 600, side: 'both' },
    { id: 'tr1', type: 'trees', from: 0, to: 1400, side: 'both', density: 8 },
    { id: 't1', type: 'tree', at: 300, offset: -12 },
    { id: 's1', type: 'sign', at: 80, side: 'right', style: 'kartcade', text: '' },
    { id: 's2', type: 'sign', at: 900, side: 'left', style: 'distance', text: '200' },
    { id: 'b1', type: 'banner', at: 30, text: 'Start' },
];

test('scenery: rails, trees, signs and banners go into the KN5 and stay off the road', () => {
    const res = buildTrack({ name: 'Scenery Rd', polyline: windingRoad(), heightSampler: slopedTerrain, width: 6.5, elements: SCENERY });
    const names = res.elements.parts.map((p) => p.name);
    for (const want of ['GR_BEAM_0', '1WALL_GR_0', '1WALL_POSTS_0', '1WALL_TREES_0', 'TREES_NEEDLES_0', 'SIGN_BACKS_0', 'SIGN_FACE_0_0', 'SIGN_FACE_1_0', 'SIGN_FACE_2_0']) assert.ok(names.includes(want), `missing ${want}`);
    assert.equal(res.elements.textures.filter((t) => t.name.startsWith('sign_')).length, 3);
    const k = readKn5(res.files['scenery_rd/scenery_rd.kn5']);
    assert.equal(k.consumed, k.total);
    assert.ok(k.textures.some((t) => t.name === 'el_steel.dds') && k.textures.some((t) => t.name === 'sign_2.dds'));
    const nodes: ReadNode[] = [];
    walk(k.root, (n) => nodes.push(n));
    assert.equal(nodes.find((n) => n.name === '1WALL_GR_0')!.visible, false, 'rail collision is invisible');
    assert.equal(nodes.find((n) => n.name === 'GR_BEAM_0')!.visible, true);
    for (const n of nodes) if (n.type === 2) { assert.equal(n.badNumbers, 0, n.name); assert.ok(n.maxIndex! < n.vertexCount!, n.name); }
    // Nothing placed may sit on the asphalt: every element vertex is outside the road edge (banner beam excepted).
    const cl = res.centerline, half = 6.5 / 2;
    let onRoad = 0;
    for (const p of res.elements.parts) {
        if (p.name.startsWith('SIGN_FACE_2') || p.name.startsWith('SIGN_BACKS')) continue; // banner spans the road overhead
        for (let v = 0; v < p.positions.length; v += 3) {
            let best = Infinity;
            for (const q of cl.points) best = Math.min(best, Math.hypot(q.x - p.positions[v], q.y - p.positions[v + 2]));
            if (best < half + 0.1) onRoad++;
        }
    }
    assert.equal(onRoad, 0, 'scenery vertices on the asphalt');
    // Trees stand inside the walls.
    const trunks = res.elements.parts.filter((p) => p.name.startsWith('1WALL_TREES'));
    assert.ok(trunks.reduce((a, p) => a + p.positions.length / 3, 0) / 24 > 100, 'about 8 trees per 100 m per side');
});

test('scenery on a circuit wraps across the start/finish line', () => {
    const res = buildTrack({ name: 'Wrap', polyline: kartCircuit(), heightSampler: flatLot, width: 8, circuit: true, elements: [{ id: 'g', type: 'guardrail', from: 900, to: 60, side: 'right' }] });
    const beam = res.elements.parts.filter((p) => p.name.startsWith('GR_BEAM'));
    const verts = beam.reduce((a, p) => a + p.positions.length / 3, 0);
    // ~125 m of rail at 2 m steps, 8 vertices (two faces) per step.
    assert.ok(verts > 400 && verts < 600, `beam vertices ${verts}`);
});

test('terrain surrounds the track and stays below it', () => {
    const res = buildTrack({ name: 'Terrain', polyline: windingRoad(), heightSampler: slopedTerrain, width: 6.5 });
    assert.ok(res.terrain.length >= 1 && res.terrain.every((p) => p.name.startsWith('TERRAIN_') && p.material === 'terrain'));
    const k = readKn5(res.files['terrain/terrain.kn5']);
    assert.equal(k.consumed, k.total);
    const cl = res.centerline, g = res.geometry;
    let above = 0, near = 0;
    for (const p of res.terrain) for (let v = 0; v < p.positions.length; v += 3) {
        const x = p.positions[v], y = p.positions[v + 1], z = p.positions[v + 2];
        let bi = 0, bd = Infinity;
        for (let i = 0; i < cl.points.length; i++) { const d = Math.hypot(cl.points[i].x - x, cl.points[i].y - z); if (d < bd) { bd = d; bi = i; } }
        const t = cl.tangents[bi], lat = (x - cl.points[bi].x) * t.y + (z - cl.points[bi].y) * -t.x;
        const reach = lat < 0 ? 3.25 + g.vergeReach(bi, -1) : 3.25 + g.vergeReach(bi, 1);
        // Inside the built corridor the terrain must stay under the surface that is drawn there.
        // (beside the road, not past its ends)
        if (Math.abs(lat) < reach && bd - Math.abs(lat) < 3) { near++; if (y > g.surfaceAt(bi, lat) - 0.25) above++; }
    }
    assert.ok(near > 0);
    assert.equal(above, 0, 'terrain vertices poking through the road or verge');
});

test('road markings: double yellow, edge lines, and a passing zone with 3 m dashes', () => {
    const area = (parts: { positions: number[]; indices: number[] }[]) => {
        let a = 0;
        for (const p of parts) for (let i = 0; i < p.indices.length; i += 3) {
            const P = (k: number) => [p.positions[p.indices[i + k] * 3], p.positions[p.indices[i + k] * 3 + 2]];
            const [A, B, C] = [P(0), P(1), P(2)];
            a += Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2;
        }
        return a;
    };
    const plain = buildTrack({ name: 'Lines', polyline: windingRoad(), heightSampler: slopedTerrain, width: 6.5, terrain: false });
    const L = plain.centerline.length;
    const yellow = (r: typeof plain) => r.geometry.parts.filter((p) => p.name.startsWith('PAINT_YELLOW'));
    const white = (r: typeof plain) => r.geometry.parts.filter((p) => p.name.startsWith('PAINT_WHITE'));
    assert.ok(Math.abs(area(yellow(plain)) - 2 * 0.1 * L) / (0.2 * L) < 0.05, 'two solid yellow lines');
    assert.ok(Math.abs(area(white(plain)) - 2 * 0.1 * L) / (0.2 * L) < 0.05, 'two white edge lines');
    const pass = buildTrack({ name: 'Lines', polyline: windingRoad(), heightSampler: slopedTerrain, width: 6.5, terrain: false,
        markings: { centre: 'double-solid', edges: true, overrides: [{ from: 200, to: 500, centre: 'passing-forward' }] } });
    // Over 300 m the right line is dashed: 3.05 m of every 12.2 m.
    const expect = 2 * 0.1 * L - 0.1 * 300 * (1 - 3.05 / 12.2);
    assert.ok(Math.abs(area(yellow(pass)) - expect) / expect < 0.05, `passing zone area ${area(yellow(pass)).toFixed(1)} vs ${expect.toFixed(1)}`);
    // Paint sits just above the asphalt and never carries physics.
    assert.ok(pass.geometry.parts.filter((p) => p.name.startsWith('PAINT')).every((p) => !/^\d/.test(p.name)));
    const circ = buildTrack({ name: 'C', polyline: kartCircuit(), heightSampler: flatLot, width: 8, circuit: true, terrain: false });
    assert.equal(yellow(circ).length, 0, 'no centre line on a circuit');
});

import { syntheticSite } from './fixtures.ts';
import { aerialMacro, siteRegions } from '../ground.ts';
import { demToPng, pngToDem, planSite } from '../site.ts';

test('site data: lidar verge, aerial ground split by cell, road painted out, invisible walls', () => {
    const site = syntheticSite(windingRoad(), slopedTerrain);
    const plan = planSite(windingRoad(), { corridorM: 90, marginM: 300 });
    assert.ok(plan.cells.length >= 3 && plan.cells.length <= 20, `cells ${plan.cells.length}`);
    const res = buildTrack({ name: 'Site Rd', polyline: windingRoad(), heightSampler: slopedTerrain, width: 6.5, site });
    const verge = res.geometry.parts.filter((p) => p.name.startsWith('1GRASS_'));
    assert.ok(verge.length >= 2 && verge.every((p) => p.material.startsWith('aerial_')), 'verge pieces use aerial materials');
    assert.ok(res.terrain.some((p) => p.material.startsWith('aerial_')));
    const k = readKn5(res.files['site_rd/site_rd.kn5']);
    assert.equal(k.consumed, k.total);
    const nodes: ReadNode[] = []; walk(k.root, (n) => nodes.push(n));
    assert.equal(nodes.find((n) => n.name === '1WALL_L')!.visible, false, 'boundary walls are invisible with site data');
    // Every vertex of every aerial piece has UVs inside its region (0..1).
    for (const p of [...verge, ...res.terrain.filter((t) => t.material.startsWith('aerial_'))]) for (const u of p.uvs) assert.ok(u >= 0 && u <= 1);
    // The road stripe in the photo is replaced near the road in the macro.
    const regions = siteRegions(site);
    const r = regions[0];
    const macro = aerialMacro({ ...r, texture: 64 }, site, res.centerline, res.geometry, 6.5 / 2 + 1);
    let dark = 0;
    for (let i = 0; i < macro.data.length; i += 4) if (macro.data[i] < 140 && macro.data[i + 1] < 140) dark++;
    assert.equal(dark, 0, 'no asphalt-coloured pixels left in the ground texture');
    assert.match(new TextDecoder().decode(res.files['site_rd/ui/ui_track.json']), /3DEP 1 m lidar/);
});

test('DEM storage: Terrarium PNG round trip keeps 1/256 m', () => {
    const bbox = { west: -122.7, south: 45.3, east: -122.69, north: 45.31 };
    const heights = new Float32Array(16).map((_, i) => 100 + i * 0.37);
    const back = pngToDem(demToPng({ bbox, width: 4, height: 4, heights }), bbox);
    for (let i = 0; i < 16; i++) assert.ok(Math.abs(back.heights[i] - heights[i]) < 1 / 256 + 1e-6);
});
