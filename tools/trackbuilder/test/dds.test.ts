import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeDds, encodeDds, mipChain, resize } from '../dds.ts';
import type { Rgba } from '../dds.ts';
import { treeAtlas } from '../features.ts';

function photoLike(w: number, h: number): Rgba {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = Math.sin(x * 0.31) * Math.cos(y * 0.17) * 30 + Math.sin((x + y) * 0.05) * 40;
        data[i] = 90 + n; data[i + 1] = 110 + n * 0.8; data[i + 2] = 60 + n * 0.5; data[i + 3] = (x * 4) & 255;
    }
    return { width: w, height: h, data };
}

const psnr = (a: Uint8Array, b: Uint8Array, channels = [0, 1, 2]) => {
    let se = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) for (const c of channels) { se += (a[i + c] - b[i + c]) ** 2; n++; }
    return 10 * Math.log10((255 * 255) / (se / n));
};

test('BC1 DDS: header, full mip chain, faithful colours', () => {
    const img = photoLike(256, 128);
    const dds = encodeDds(img, { format: 'bc1' });
    const back = decodeDds(dds);
    assert.equal(back.width, 256); assert.equal(back.height, 128); assert.equal(back.format, 'bc1');
    assert.equal(back.mips, 9, '256x128 -> 1x1 is 9 levels');
    // Sum of every level: 128 header + blocks.
    const levels = mipChain(img, 'color');
    const expected = 128 + levels.reduce((a, l) => a + Math.max(1, Math.ceil(l.width / 4)) * Math.max(1, Math.ceil(l.height / 4)) * 8, 0);
    assert.equal(dds.length, expected);
    const p = psnr(img.data, back.rgba);
    assert.ok(p > 32, `PSNR ${p.toFixed(1)} dB`);
});

test('BC3 keeps alpha; normal-map mips stay unit length', () => {
    const img = photoLike(64, 64);
    const back = decodeDds(encodeDds(img, { format: 'bc3' }));
    assert.equal(back.format, 'bc3');
    assert.ok(psnr(img.data, back.rgba, [3]) > 38, 'alpha');
    const nrm: Rgba = { width: 4, height: 4, data: new Uint8Array(64) };
    for (let i = 0; i < 16; i++) { const a = i * 0.4; nrm.data.set([Math.round((Math.sin(a) * 0.6 + 1) * 127.5), 128, Math.round((0.8 + 1) * 127.5), 255], i * 4); }
    for (const l of mipChain(nrm, 'normal').slice(1)) {
        const v = [l.data[0] / 127.5 - 1, l.data[1] / 127.5 - 1, l.data[2] / 127.5 - 1];
        assert.ok(Math.abs(Math.hypot(...v) - 1) < 0.02);
    }
});

test('resize to power of two and encode speed', () => {
    const big = resize(photoLike(300, 300), 512, 512);
    assert.equal(big.width, 512);
    const t = performance.now();
    encodeDds(resize(photoLike(1024, 1024), 1024, 1024), { format: 'bc1' });
    const ms = performance.now() - t;
    assert.ok(ms < 8000, `1024^2 BC1 with mips took ${ms.toFixed(0)} ms`);
    console.log(`  1024x1024 BC1 + mips: ${ms.toFixed(0)} ms`);
});

import { processPhotoMaterial } from '../materials.ts';
import { buildTrack } from '../pack.ts';
import { windingRoad, slopedTerrain } from './fixtures.ts';
import type { LibraryEntry } from '../materials.ts';

test('photo material processing: sizes, normalised detail, maps; builds use the library', () => {
    const img = (w: number, f: (x: number, y: number) => [number, number, number]): Rgba => {
        const data = new Uint8Array(w * w * 4);
        for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { const c = f(x, y); data.set([...c, 255], (y * w + x) * 4); }
        return { width: w, height: w, data };
    };
    // A 700 px "photo" (Poly Haven 2k scaled down for the test), not a power of two.
    const diffuse = img(700, (x, y) => [60 + (x % 7) * 3, 58 + (y % 5) * 3, 55]);
    const normal = img(700, () => [128, 128, 255]);
    const arm = img(700, (x) => [200, 180 + (x % 3), 0]);
    const out = processPhotoMaterial({ size: 512, diffuse, normal, arm, rough: null });
    const d = decodeDds(out.detail), a = decodeDds(out.albedo), m = decodeDds(out.maps);
    assert.equal(d.width, 512); assert.equal(d.mips, 10); assert.equal(m.width, 256);
    const meanOf = (rgba: Uint8Array, c: number) => { let s = 0; for (let i = c; i < rgba.length; i += 4) s += rgba[i]; return s / (rgba.length / 4); };
    assert.ok(Math.abs(meanOf(d.rgba, 0) - 128) < 6 && Math.abs(meanOf(d.rgba, 2) - 128) < 6, 'detail mean ~0.5 per channel');
    assert.ok(Math.abs(meanOf(a.rgba, 0) - out.mean[0]) < 6, 'albedo keeps the photo colour');
    const entry: LibraryEntry = { role: 'asphalt', label: 'Test asphalt', tileM: 3, mean: out.mean, albedo: out.albedo, detail: out.detail, normal: out.normal, maps: out.maps, source: { provider: 'polyhaven', asset: 'asphalt_02', license: 'CC0' } };
    const res = buildTrack({ name: 'Lib', polyline: windingRoad(), heightSampler: slopedTerrain, width: 6.5, terrain: false, library: { asphalt: entry } });
    const road = res.materials.find((x) => x.name === 'road')!;
    assert.ok(road.textures.some((t) => t.texture === 'asphalt_02_detail.dds'), 'road uses the library detail');
    assert.equal(road.properties.find((p) => p.name === 'detailUVMultiplier')!.a, 48 / 3);
});

test('cutout mips keep foliage coverage and never darken the edges', () => {
    // The real tree atlas: box-filtered alpha would thin the crowns below the 0.5 cut-off in the distance.
    const img = treeAtlas();
    const cov = (m: Rgba) => { let n = 0; for (let i = 3; i < m.data.length; i += 4) if (m.data[i] >= 128) n++; return n / (m.width * m.height); };
    const base = cov(img);
    const cut = mipChain(img, 'cutout'), plain = mipChain(img, 'color');
    for (let l = 1; l <= 5; l++) assert.ok(Math.abs(cov(cut[l]) - base) < base * 0.12, `level ${l}: ${cov(cut[l]).toFixed(3)} vs ${base.toFixed(3)}`);
    assert.ok(cov(plain[5]) < cov(cut[5]), `plain ${cov(plain[5]).toFixed(3)} vs cutout ${cov(cut[5]).toFixed(3)}`);
    // Visible texels keep foliage colour (green dominant, not darkened toward black).
    const m = cut[3];
    let dark = 0, vis = 0;
    for (let i = 0; i < m.data.length; i += 4) if (m.data[i + 3] >= 128) { vis++; if (m.data[i + 1] < 40) dark++; }
    assert.ok(dark / vis < 0.02, `${dark} of ${vis} visible texels near black`);
});
