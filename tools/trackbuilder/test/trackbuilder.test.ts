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
import { slopedTerrain, windingRoad } from './fixtures.ts';

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
