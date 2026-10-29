// Road realism from OSM and lidar: lanes and widths, bridges, side streets and street furniture, the lidar
// surface (decoding a real 3DEP point-cloud tile), lidar-driven buildings and trees, and the worker round trip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { laneSet, levelBridges, matchRoad, metres, mphOf, wayWidth, laneGeometry } from '../roadinfo.ts';
import { buildCenterline } from '../route.ts';
import { buildTrack } from '../pack.ts';
import { syntheticSite } from './fixtures.ts';
import { parseOverpass, OSM_VERSION } from '../osm.ts';
import type { OsmFeatures, OsmWay } from '../osm.ts';
import { readKn5 } from './kn5Reader.ts';
import type { ReadNode } from './kn5Reader.ts';
import { datumOffset, decodeLaz, fromMerc, pngsToSurface, rasterizeSurface, surfaceToPngs, toMerc } from '../lidar.ts';
import type { SurfaceRaster } from '../lidar.ts';
import { toPortable, fromPortable } from '../portable.ts';
import { classifyGround } from '../ground.ts';
import type { LatLon } from '../geo.ts';

function walk(n: ReadNode, f: (n: ReadNode) => void) { f(n); n.children.forEach((c) => walk(c, f)); }

test('lane layout and carriageway width from OSM tags', () => {
    const t = { highway: 'primary', lanes: '5', 'lanes:forward': '2', 'lanes:backward': '3', 'turn:lanes:backward': 'left|none|none', cycleway: 'lane', sidewalk: 'both', maxspeed: '35 mph' };
    const f = laneSet(t, 1), b = laneSet(t, -1);
    assert.deepEqual([f.fwd, f.bwd], [2, 3]);
    assert.deepEqual([b.fwd, b.bwd], [3, 2], 'driving the way backwards swaps the directions');
    assert.deepEqual(b.turnFwd, ['left', 'none', 'none']);
    assert.equal(f.edgeLines, false, 'urban street with sidewalks: no edge lines');
    assert.ok(Math.abs(wayWidth(t, f) - (5 * 3.5 + 3.2)) < 0.01);
    assert.equal(laneSet({ highway: 'secondary', lanes: '3', 'lanes:both_ways': '1' }, 1).centreTurn, true);
    assert.ok(Math.abs(metres("14'11\"") - 4.547) < 0.01);
    assert.equal(mphOf('25 mph'), 25);
    assert.ok(Math.abs(mphOf('50') - 31.07) < 0.01, 'bare numbers are km/h');
    assert.equal(wayWidth({ highway: 'residential', width: '9.5' }, laneSet({ highway: 'residential' }, 1)), 9.5);
    // Lanes: oncoming lanes on the left, ours on the right, a centre turn lane between.
    const g = laneGeometry(9, { fwd: 2, bwd: 2, centreTurn: true, oneway: false, turnFwd: null, turnBwd: null, extraL: 0, extraR: 0, edgeLines: true, laneWidth: 3.5 }, true);
    assert.ok(g.c1 > g.c0 && g.fwdLane(0) > g.c1 && g.fwdLane(1) > g.fwdLane(0) && g.bwdLane(0) < g.c0);
});

/**
 * A straight east-west test road across a valley: a 2-lane rural stretch, a bridge over the valley, then a
 * signalised 3-lane urban street; side streets with a signal, a stop sign and crossings; a lamp and a bus stop.
 */
function valleyScene() {
    const lat0 = 45.36, lon0 = -122.62, mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180), mLat = 111_120;
    const ll = (east: number, north: number): LatLon => ({ lat: lat0 + north / mLat, lon: lon0 + east / mLon });
    const terrain = (p: LatLon) => {
        const e = (p.lon - lon0) * mLon;
        return 60 - (e > 300 && e < 450 ? 22 * Math.sin(((e - 300) / 150) * Math.PI) : 0); // a 22 m deep valley
    };
    const line: LatLon[] = []; for (let e = 0; e <= 800; e += 25) line.push(ll(e, 0));
    let nid = 1000;
    const node = () => nid++;
    // Route ways share their end nodes; the junction nodes are shared with the side streets.
    const ids = line.map(() => node());
    const way = (id: number, from: number, to: number, tags: Record<string, string>): OsmWay => ({ id, nodes: ids.slice(from, to + 1), line: line.slice(from, to + 1), tags });
    const w1 = way(1, 0, 12, { highway: 'secondary', lanes: '2', maxspeed: '45 mph', name: 'Valley Road' });
    const w2 = way(2, 12, 18, { highway: 'secondary', lanes: '2', bridge: 'yes', layer: '1', maxspeed: '35 mph', name: 'Valley Bridge' });
    const w3 = way(3, 18, 32, { highway: 'secondary', lanes: '3', 'lanes:forward': '2', 'lanes:backward': '1', 'turn:lanes:forward': 'left|through', maxspeed: '25 mph', sidewalk: 'both', name: 'Main Street' });
    // Cross street at e = 600 (index 24) with signals; T junction at e = 150 (index 6) with a stop sign on the side street.
    const jx = ids[24], jt = ids[6];
    const sN = node(), sS = node(), sT = node(), sTstop = node();
    const cross: OsmWay = { id: 4, nodes: [sS, jx, sN], line: [ll(600, -120), ll(600, 0), ll(600, 120)], tags: { highway: 'tertiary', lanes: '2', name: 'Oak Street' } };
    const tee: OsmWay = { id: 5, nodes: [jt, sTstop, sT], line: [ll(150, 0), ll(150, 8), ll(150, 90)], tags: { highway: 'residential', name: 'Elm Street' } };
    const pts = [
        { id: jx, at: ll(600, 0), tags: { highway: 'traffic_signals' } },
        { id: sTstop, at: ll(150, 8), tags: { highway: 'stop', direction: 'backward' } },
        { id: node(), at: ll(588, 0), tags: { highway: 'crossing', crossing: 'traffic_signals' } },
        { id: node(), at: ll(700, 0), tags: { highway: 'crossing', crossing: 'marked', 'crossing:markings': 'zebra' } },
        { id: node(), at: ll(200, 9), tags: { highway: 'street_lamp' } },
        { id: node(), at: ll(650, -7), tags: { highway: 'bus_stop' } },
    ];
    const site = syntheticSite(line, terrain);
    const osm: OsmFeatures = { version: OSM_VERSION, fetched: 'test', bbox: site.overview!.bbox, buildings: [], woods: [], trees: [], barriers: [], water: [], roads: [w1, w2, w3, cross, tee], points: pts };
    site.osm = osm;
    return { line, terrain, site, ll };
}

test('road info: lanes, tapered widths and bridges matched along the route', () => {
    const { line, site } = valleyScene();
    const cl = buildCenterline(line, { spacing: 2 });
    const r = matchRoad(cl, site.osm!.roads!, { fallbackWidth: 6.5 });
    const at = (e: number) => Math.round(e / cl.spacing);
    assert.equal(r.ways[r.wayAt[at(100)]].id, 1);
    assert.equal(r.ways[r.wayAt[at(700)]].id, 3);
    assert.deepEqual([r.lanes[at(700)].fwd, r.lanes[at(700)].bwd], [2, 1]);
    assert.ok(r.width[at(700)] > r.width[at(100)] + 2, 'the 3-lane street is wider');
    // Tapered, never a step: neighbouring samples differ by little.
    for (let i = 1; i < r.width.length; i++) assert.ok(Math.abs(r.width[i] - r.width[i - 1]) < 0.4);
    assert.equal(r.bridges.length, 1);
    assert.ok(Math.abs(r.bridges[0].from - 300) < 4 && Math.abs(r.bridges[0].to - 450) < 4, `bridge ${r.bridges[0].from}..${r.bridges[0].to}`);
    assert.equal(r.mph[at(100)], 45);
    // Levelling: the raw DEM dips 22 m under the bridge; the levelled line doesn't.
    const raw = cl.points.map((p) => site.cells[0] && 60 - ((p.x > 300 && p.x < 450) ? 22 * Math.sin(((p.x - 300) / 150) * Math.PI) : 0));
    const lev = levelBridges(raw, cl.s, r.bridges);
    assert.ok(Math.min(...lev.filter((_, i) => cl.s[i] > 300 && cl.s[i] < 450).map((v) => v!)) > 59);
});

test('full build: bridge deck level, arch structure, side streets, signals, signs, crosswalks, lamps', () => {
    const { line, terrain, site } = valleyScene();
    const res = buildTrack({ name: 'Valley St', polyline: line, heightSampler: terrain, width: 7, site, bridgeStyles: { '2': 'arch' } });
    const cl = res.centerline;
    // The road over the valley stays near 60 m (the DEM drops to 38 m).
    const mid = cl.points.map((_, i) => i).filter((i) => cl.s[i] > 320 && cl.s[i] < 430);
    assert.ok(mid.every((i) => res.profile.heights[i] > 58), `deck min ${Math.min(...mid.map((i) => res.profile.heights[i])).toFixed(1)}`);
    // Bridge: walkways, parapets with collision, arch ribs; no grass or gravel on the deck.
    const names = res.bridges.map((p) => p.name);
    assert.ok(names.some((n) => n.startsWith('1WALL_PARAPET')) && names.some((n) => n.startsWith('BRIDGE_STRUCT')) && names.some((n) => n.startsWith('1ROAD_BRIDGEWALK')));
    for (const p of res.geometry.parts.filter((q) => /^1(GRASS|GRAVEL)/.test(q.name))) {
        for (let k = 0; k < p.positions.length; k += 3) {
            const x = p.positions[k];
            assert.ok(x < 305 || x > 445 || Math.abs(p.positions[k + 2]) > 30, `${p.name} vertex on the deck at x=${x.toFixed(1)}`);
        }
    }
    // Width follows the lanes.
    assert.ok(res.geometry.halfAt(Math.round(700 / cl.spacing)) > res.geometry.halfAt(Math.round(100 / cl.spacing)) + 1);
    // Street furniture.
    const st = res.streetStats!;
    assert.ok(st.stubs >= 3, `stubs ${st.stubs}`);
    assert.ok(st.signals >= 3, `signal poles ${st.signals}`);
    assert.ok(st.stopSigns >= 1 && st.crosswalks >= 2 && st.lamps === 1 && st.busStops === 1 && st.arrows >= 1, JSON.stringify(st));
    assert.ok(st.speedSigns >= 2, 'speed signs where the limit changes');
    // Poles and sign posts never stand on the route's asphalt (mast arms overhang above 5 m).
    for (const p of res.streets.filter((q) => /^ST_(POLES|SIGN)/.test(q.name))) {
        for (let k = 0; k < p.positions.length; k += 3) {
            const x = p.positions[k], y = p.positions[k + 1], z = p.positions[k + 2];
            const i = Math.max(0, Math.min(cl.points.length - 1, Math.round(x / cl.spacing)));
            if (y - res.geometry.roadHeightAt(i, 0) > 4.5) continue;
            assert.ok(Math.abs(z) > res.geometry.halfAt(i) - 0.05, `${p.name} at x=${x.toFixed(1)} z=${z.toFixed(2)}`);
        }
    }
    // Lit lenses: green over the route, red on the cross street.
    assert.ok(res.materials.some((m) => m.name === 'st_lens_green') && res.materials.some((m) => m.name === 'st_lens_red'));
    // Urban stretch: concrete sidewalks instead of gravel.
    assert.ok(res.geometry.parts.some((p) => p.name.startsWith('1ROAD_WALK') && p.material === 'sidewalk'));
    // The KN5 is well formed.
    const k = readKn5(res.files['valley_st/valley_st.kn5']);
    assert.equal(k.consumed, k.total);
    const nodes: ReadNode[] = []; walk(k.root, (n) => nodes.push(n));
    for (const n of nodes) if (n.indexCount != null) { assert.ok(n.maxIndex! < n.vertexCount!, n.name); assert.equal(n.badNumbers ?? 0, 0, n.name); }
    assert.ok(k.materials.find((m) => m.name === 'st_sign_stop')!.shader === 'ksPerPixelAT');
});

test('older stored OSM data (no roads) still builds, with a single width', () => {
    const { line, terrain, site } = valleyScene();
    site.osm = { ...site.osm!, version: 1, roads: undefined, points: undefined };
    const res = buildTrack({ name: 'Old', polyline: line, heightSampler: terrain, width: 6.5, site, output: 'geometry' });
    assert.equal(res.road, null);
    assert.equal(res.geometry.width, 6.5);
});

test('OSM v2 parse keeps roads with node ids and street furniture', () => {
    const json = { elements: [
        { type: 'way', id: 9, nodes: [1, 2], geometry: [{ lat: 45, lon: -122 }, { lat: 45.001, lon: -122 }], tags: { highway: 'residential' } },
        { type: 'way', id: 9, nodes: [1, 2], geometry: [{ lat: 45, lon: -122 }, { lat: 45.001, lon: -122 }], tags: { highway: 'residential' } },
        { type: 'way', id: 10, nodes: [3, 4], geometry: [{ lat: 45, lon: -122 }, { lat: 45.001, lon: -122 }], tags: { highway: 'footway' } },
        { type: 'node', id: 1, lat: 45, lon: -122, tags: { highway: 'traffic_signals' } },
    ] };
    const f = parseOverpass(json as never, { west: -123, east: -121, south: 44, north: 46 }, 'x');
    assert.equal(f.version, OSM_VERSION);
    assert.equal(f.roads!.length, 1, 'drivable only, no duplicates');
    assert.deepEqual(f.roads![0].nodes, [1, 2]);
    assert.equal(f.points!.length, 1);
});

const req = createRequire(import.meta.url);
async function lazPerf() { const { createLazPerf } = req('laz-perf'); return createLazPerf(); }
const node = () => new Uint8Array(readFileSync(new URL('./olcmetro_2019_node.laz', import.meta.url)));

test('lidar: decodes a real 3DEP EPT tile (OR OLC Metro 2019)', async () => {
    const b = decodeLaz(await lazPerf(), node());
    assert.equal(b.count, 27762);
    const cls = new Map<number, number>(); for (let i = 0; i < b.count; i++) cls.set(b.cls[i], (cls.get(b.cls[i]) ?? 0) + 1);
    assert.ok((cls.get(2) ?? 0) > 5000, 'ground returns');
    // Oregon City, in web mercator; heights in metres a little above the Willamette.
    const ll = fromMerc(b.x[0], b.y[0]);
    assert.ok(ll.lat > 45.3 && ll.lat < 45.4 && ll.lon > -122.65 && ll.lon < -122.55, `${ll.lat},${ll.lon}`);
    let z0 = Infinity, z1 = -Infinity; for (let i = 0; i < b.count; i++) if (b.cls[i] === 2) { z0 = Math.min(z0, b.z[i]); z1 = Math.max(z1, b.z[i]); }
    assert.ok(z0 > -5 && z1 < 120, `${z0}..${z1}`);
    const m = toMerc(ll); assert.ok(Math.abs(m.x - b.x[0]) < 1e-3 && Math.abs(m.y - b.y[0]) < 1e-3);
});

test('lidar: surface raster over a DEM, datum offset, PNG round trip', async () => {
    const b = decodeLaz(await lazPerf(), node());
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < b.count; i++) { x0 = Math.min(x0, b.x[i]); x1 = Math.max(x1, b.x[i]); y0 = Math.min(y0, b.y[i]); y1 = Math.max(y1, b.y[i]); }
    const sw = fromMerc(x0, y0), ne = fromMerc(x1, y1);
    const bbox = { west: sw.lon, south: sw.lat, east: ne.lon, north: ne.lat };
    // A DEM from the ground returns themselves (mean per pixel), shifted 3 m to test the datum offset.
    const W = 80, H = 80, sum = new Float64Array(W * H), cnt = new Uint32Array(W * H);
    for (let i = 0; i < b.count; i++) {
        if (b.cls[i] !== 2) continue;
        const ll = fromMerc(b.x[i], b.y[i]);
        const px = Math.min(W - 1, Math.floor(((ll.lon - bbox.west) / (bbox.east - bbox.west)) * W)), py = Math.min(H - 1, Math.floor(((bbox.north - ll.lat) / (bbox.north - bbox.south)) * H));
        sum[py * W + px] += b.z[i]; cnt[py * W + px]++;
    }
    let fill = 0, fc = 0; for (let k = 0; k < W * H; k++) if (cnt[k]) { fill += sum[k] / cnt[k]; fc++; }
    const heights = new Float32Array(W * H).map((_, k) => (cnt[k] ? sum[k] / cnt[k] : fill / fc) - 3);
    const dem = { bbox, width: W, height: H, heights };
    const off = datumOffset([b], [dem]);
    assert.ok(Math.abs(off - 3) < 0.6, `datum offset ${off}`);
    const s = rasterizeSurface(dem, [b], off);
    let fin = 0, tall = 0; for (let k = 0; k < W * H; k++) { if (Number.isFinite(s.above[k])) { fin++; if (s.above[k] > 3) tall++; } }
    assert.ok(fin / (W * H) > 0.8, `coverage ${fin / (W * H)}`);
    assert.ok(tall > 0, 'something stands above the ground (trees, buildings)');
    const p = surfaceToPngs(s), back = pngsToSurface(p.above, p.cls, bbox);
    for (let k = 0; k < W * H; k += 7) {
        if (!Number.isFinite(s.above[k])) { assert.ok(!Number.isFinite(back.above[k]) || back.above[k] === 0); continue; }
        assert.ok(Math.abs(back.above[k] - s.above[k]) <= 0.03, 'stored to 5 cm');
        assert.equal(back.cls[k], s.cls[k]);
    }
});

test('lidar-driven surroundings: measured roof heights, unmapped buildings and treetops', () => {
    // Flat site with a synthetic lidar surface: a mapped 12 x 8 m house with a 7.5 m ridge, an unmapped 10 x 6 m
    // flat-roofed garage 3.2 m tall, and three conical trees; near-infrared marks the trees as vegetation.
    const lat0 = 45.36, lon0 = -122.62, mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180), mLat = 111_120;
    const ll = (e: number, n: number): LatLon => ({ lat: lat0 + n / mLat, lon: lon0 + e / mLon });
    const line = [ll(0, 0), ll(300, 0)];
    const flat = () => 50;
    const site = syntheticSite(line, flat);
    const house = (e: number, n: number) => e > 100 && e < 112 && n > 30 && n < 38;
    const garage = (e: number, n: number) => e > 140 && e < 150 && n > 30 && n < 36;
    const trees = [[60, 25, 18], [70, 30, 22], [200, -30, 15]];
    const heightAt = (e: number, n: number) => {
        if (house(e, n)) return 4.5 + 3 * (1 - Math.abs(n - 34) / 4);
        if (garage(e, n)) return 3.2;
        let h = 0;
        for (const [te, tn, th] of trees) { const d = Math.hypot(e - te, n - tn); if (d < th * 0.25) h = Math.max(h, th * (1 - d / (th * 0.25)) ** 0.7); }
        return h;
    };
    const veg = (e: number, n: number) => !house(e, n) && !garage(e, n) && heightAt(e, n) > 0.5;
    for (const c of site.cells) {
        const W = 256, H = 256, b = c.bbox;
        const above = new Float32Array(W * H), cls = new Uint8Array(W * H).fill(1);
        const nir = new Uint8Array(W * H * 4), rgb = new Uint8Array(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const lat = b.north - ((y + 0.5) / H) * (b.north - b.south), lon = b.west + ((x + 0.5) / W) * (b.east - b.west);
            const e = (lon - lon0) * mLon, n = (lat - lat0) * mLat, k = y * W + x;
            above[k] = heightAt(e, n);
            const v = veg(e, n);
            rgb.set(v ? [50, 80, 40, 255] : [120, 118, 112, 255], k * 4); nir.set(v ? [170, 170, 170, 255] : [110, 110, 110, 255], k * 4);
        }
        c.surface = { bbox: b, width: W, height: H, above, cls } as SurfaceRaster;
        c.rgb = { bbox: b, width: W, height: H, rgba: rgb }; c.nir = { bbox: b, width: W, height: H, rgba: nir };
    }
    const ring = [[100, 30], [112, 30], [112, 38], [100, 38], [100, 30]].map(([e, n]) => ll(e, n));
    site.osm = { version: OSM_VERSION, fetched: 'x', bbox: site.overview!.bbox, buildings: [{ id: 1, ring, tags: { building: 'house' } }], woods: [], trees: [], barriers: [], water: [], roads: [], points: [] };
    const res = buildTrack({ name: 'Lidar', polyline: line, heightSampler: flat, width: 7, site, output: 'geometry' });
    const fs = res.featureStats;
    assert.equal(fs.buildings, 2, 'the mapped house and the unmapped garage');
    assert.equal(fs.lidarBuildings, 2);
    assert.ok(fs.lidarTrees! >= 3 && fs.lidarTrees! <= 5, `treetops ${fs.lidarTrees}`);
    // The house roof peaks near its measured 7.5 m (+ ground 50), not a guess.
    let top = -Infinity;
    for (const p of res.features.filter((q) => /ROOF/.test(q.name))) for (let k = 0; k < p.positions.length; k += 3) {
        const x = p.positions[k]; if (x > 99 && x < 113) top = Math.max(top, p.positions[k + 1]);
    }
    assert.ok(top > 56 && top < 58.5, `ridge at ${top.toFixed(2)}`);
});

test('worker round trip: a portable build answers like the original', () => {
    const { line, terrain, site } = valleyScene();
    const res = buildTrack({ name: 'Port', polyline: line, heightSampler: terrain, width: 7, site, output: 'geometry' });
    const back = fromPortable(structuredClone(toPortable(res)));
    const g = res.geometry, h = back.geometry;
    for (let i = 0; i < res.centerline.points.length; i += 17) for (const lat of [-9, -3.3, 0, 2.1, 7.7]) {
        assert.ok(Math.abs(g.surfaceAt(i, lat) - h.surfaceAt(i, lat)) < 0.03, `surface at ${i},${lat}`);
        assert.ok(Math.abs(g.halfAt(i) - h.halfAt(i)) < 1e-4);
    }
    const p = { x: 123, y: 45 }, a = res.centerline.projection.toLatLon(p), b = back.centerline.projection.toLatLon(p);
    assert.ok(Math.abs(a.lat - b.lat) < 1e-12 && Math.abs(a.lon - b.lon) < 1e-12);
    assert.equal(back.streets.length, res.streets.length);
});

test('ground classes: photo, near-infrared and lidar decide grass, pavement, dirt and forest floor', () => {
    assert.equal(classifyGround([70, 110, 60], 180, 0.1), 0, 'green with high NIR, low: lawn');
    assert.equal(classifyGround([40, 60, 40], 140, 14), 3, 'vegetation under tall lidar returns: forest floor');
    assert.equal(classifyGround([120, 120, 124], 110, 0), 1, 'grey: pavement');
    assert.equal(classifyGround([170, 140, 100], 150, 0), 2, 'tan, no vegetation signal: dirt');
    assert.equal(classifyGround([70, 110, 60], null, null), 0, 'no NIR: greenness decides');
});

test('ground, water and roadside: multilayer aerial ground, river, kerbs, poles and wires, hydrants, cars, ramps', () => {
    const { line, terrain, site, ll } = valleyScene();
    const osm = site.osm!;
    // A power line along the north side of Main Street with three poles, a parking lot, a pond in the valley.
    const poleAt = [ll(520, 12), ll(560, 12), ll(600 - 6, 12)];
    poleAt.forEach((at, k) => osm.points!.push({ id: 9000 + k, at, tags: { power: 'pole' } }));
    osm.power = [{ id: 9100, line: poleAt, tags: { power: 'minor_line' } }];
    const sq = (e0: number, n0: number, e1: number, n1: number) => [ll(e0, n0), ll(e1, n0), ll(e1, n1), ll(e0, n1), ll(e0, n0)];
    osm.areas = [{ id: 9200, rings: [sq(640, -70, 720, -25)], tags: { amenity: 'parking' } }];
    osm.water = [{ id: 9300, rings: [sq(340, -200, 410, -60)], tags: { natural: 'water' } }];
    const res = buildTrack({ name: 'Valley St', polyline: line, heightSampler: terrain, width: 7, site, bridgeStyles: { '2': 'arch' } });
    // Aerial ground is ksMultilayer with a mask and four details.
    const aerial = res.materials.filter((m) => m.name.startsWith('aerial_'));
    assert.ok(aerial.length && aerial.every((m) => m.shader === 'ksMultilayer' && m.textures.length === 6));
    const mask = res.textures.find((t) => t.name.startsWith('aerialmask_'));
    assert.ok(mask, 'mask texture');
    // Water mesh in the valley.
    assert.ok(res.terrain.some((p) => p.name.startsWith('WATER_') && p.material === 'water'));
    const ext = new TextDecoder().decode(res.files['valley_st/extension/ext_config.ini']);
    assert.match(ext, /USE_MULTILAYER_MASK = 1/);
    assert.match(ext, /\[Material_Water\][\s\S]*Materials = water/);
    // Kerbs and gutters on the urban stretch only.
    const kerbs = res.geometry.parts.filter((p) => p.name.startsWith('KERB_'));
    assert.ok(kerbs.length >= 2 && res.geometry.parts.some((p) => p.name.startsWith('PAINT_GUTTER_')));
    for (const p of kerbs) for (let k = 0; k < p.positions.length; k += 3) assert.ok(p.positions[k] > 440, `kerb at x=${p.positions[k].toFixed(1)}`);
    // Roadside: the mapped poles with wires between them, hydrants in town, cars in the lot, kerb ramp panels.
    const rs = res.roadsideStats!;
    assert.equal(rs.poles, 3);
    assert.equal(rs.wires, 2);
    assert.ok(rs.hydrants >= 1 && rs.lotCars >= 4 && rs.ramps >= 2, JSON.stringify(rs));
    const cl = res.centerline;
    for (const p of res.streets.filter((q) => /^RS_(POLES|HYDRANTS|LOTCARS)/.test(q.name))) {
        for (let k = 0; k < p.positions.length; k += 3) {
            const x = p.positions[k], z = p.positions[k + 2];
            const i = Math.max(0, Math.min(cl.points.length - 1, Math.round(x / cl.spacing)));
            assert.ok(Math.abs(z) > res.geometry.halfAt(i) - 0.05, `${p.name} on the road at x=${x.toFixed(1)} z=${z.toFixed(2)}`);
        }
    }
    const k = readKn5(res.files['valley_st/valley_st.kn5']);
    assert.equal(k.consumed, k.total);
});

test('OSM v3 parse: businesses, power lines, parking and parks', () => {
    const json = { elements: [
        { type: 'node', id: 1, lat: 45.1, lon: -122.1, tags: { shop: 'bakery', name: 'Sweet' } },
        { type: 'node', id: 2, lat: 45.1, lon: -122.1, tags: { amenity: 'cafe' } },
        { type: 'node', id: 3, lat: 45.1, lon: -122.1, tags: { power: 'pole' } },
        { type: 'node', id: 4, lat: 45.1, lon: -122.1, tags: { emergency: 'fire_hydrant' } },
        { type: 'way', id: 5, tags: { power: 'line' }, geometry: [{ lat: 45.1, lon: -122.1 }, { lat: 45.2, lon: -122.1 }] },
        { type: 'way', id: 6, tags: { amenity: 'parking' }, geometry: [{ lat: 45.1, lon: -122.1 }, { lat: 45.2, lon: -122.1 }, { lat: 45.2, lon: -122.2 }, { lat: 45.1, lon: -122.1 }] },
        { type: 'way', id: 7, tags: { leisure: 'park', natural: 'wood' }, geometry: [{ lat: 45.1, lon: -122.1 }, { lat: 45.2, lon: -122.1 }, { lat: 45.2, lon: -122.2 }, { lat: 45.1, lon: -122.1 }] },
    ] };
    const f = parseOverpass(json as never, { south: 45, west: -123, north: 46, east: -122 }, 'x');
    assert.equal(f.pois!.length, 2);
    assert.equal(f.points!.length, 2);
    assert.equal(f.power!.length, 1);
    assert.equal(f.areas!.length, 1);
    assert.equal(f.woods.length, 1, 'a wooded park stays a wood');
});

test('road surface: sealed cracks, manholes and drains on the asphalt, worn alpha-tested paint', () => {
    const { line, terrain, site } = valleyScene();
    const res = buildTrack({ name: 'Valley St', polyline: line, heightSampler: terrain, width: 7, site, output: 'geometry' });
    const st = res.surfaceStats!;
    assert.ok(st.cracks >= 5 && st.manholes >= 1 && st.drains >= 1, JSON.stringify(st));
    const cl = res.centerline;
    for (const p of res.streets.filter((q) => /^PAINT_(SEAL|MANHOLE|DRAIN|PATCH)/.test(q.name))) {
        assert.ok(p.castShadows === false);
        for (let k = 0; k < p.positions.length; k += 3) {
            const x = p.positions[k], y = p.positions[k + 1], z = p.positions[k + 2];
            const i = Math.max(0, Math.min(cl.points.length - 1, Math.round(x / cl.spacing)));
            assert.ok(Math.abs(z) <= res.geometry.halfAt(i) + 0.1, `${p.name} off the asphalt at z=${z.toFixed(2)}`);
            assert.ok(y - res.geometry.roadHeightAt(i, z) < 0.05 && y - res.geometry.roadHeightAt(i, z) > -0.05, `${p.name} height`);
        }
    }
    const paint = res.materials.find((m) => m.name === 'paint_white')!;
    assert.equal(paint.shader, 'ksPerPixelMultiMap_AT_NMDetail');
    assert.equal(paint.alphaTested, true);
});
