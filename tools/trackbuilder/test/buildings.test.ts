import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuildingKit, awningAtlas, doorAtlas, garageDoorImage, shopSignImage, storefrontImage, typeLabel, windowAtlas } from '../buildings.ts';
import type { P2, Wall } from '../buildings.ts';
import { MaterialBook } from '../materials.ts';
import { Mesh } from '../elements.ts';

/** A counter-clockwise rectangle's walls (w along x, d along y), ground at 10. */
function box(w: number, d: number): Wall[] {
    const ring: P2[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];
    return ring.map((a, i) => {
        const c = ring[(i + 1) % 4], len = Math.hypot(c.x - a.x, c.y - a.y);
        return { a, c, n: { x: (c.y - a.y) / len, y: -(c.x - a.x) / len }, len, ground: 10 };
    });
}

function kitWithMeshes() {
    const book = new MaterialBook();
    const meshes = new Map<string, Mesh>();
    const kit = new BuildingKit(book, undefined, (kind, _p, mat) => { const k = `${kind}_${mat}`; let m = meshes.get(k); if (!m) meshes.set(k, (m = new Mesh(k, mat))); return m; });
    return { kit, book, meshes };
}

test('building textures: power-of-two sizes, opaque', () => {
    for (const im of [windowAtlas(), doorAtlas(), garageDoorImage(), storefrontImage(), awningAtlas(), shopSignImage('Coffee Rush', 0)]) {
        assert.equal(im.width & (im.width - 1), 0); assert.equal(im.height & (im.height - 1), 0);
        for (let i = 3; i < im.data.length; i += 4 * 97) assert.equal(im.data[i], 255);
    }
    // The sign carries the name: text pixels differ from the board colour.
    const sign = shopSignImage('Coffee Rush', 0), blank = shopSignImage('', 0);
    let diff = 0;
    for (let i = 0; i < sign.data.length; i += 4) if (sign.data[i] !== blank.data[i]) diff++;
    assert.ok(diff > 2000, `${diff} text pixels`);
    assert.equal(typeLabel({ shop: 'beauty' }), 'Salon');
    assert.equal(typeLabel({ amenity: 'fuel' }), 'Gas');
    assert.equal(typeLabel({ shop: 'bicycle_rental' }), 'Bicycle Rental');
});

test('building detail: house front with door, windows on the walls, all of it outside the walls', () => {
    const { kit, meshes } = kitWithMeshes();
    const walls = box(14, 9); // the front (index 0, y = 0) faces -y
    kit.detail({ walls, kind: 'house', base: 9.6, top: 9.6 + 6.2, levels: 2, front: 0, frontRoom: 8, seed: 5, roofMat: 'roof', shops: [] });
    assert.ok(kit.stats.windows >= 8, `windows ${kit.stats.windows}`);
    assert.equal(kit.stats.doors, 1);
    // Every vertex sits outside the footprint or on it (details stand out of the walls, never inside).
    for (const m of meshes.values()) for (const p of m.parts) for (let i = 0; i < p.positions.length; i += 3) {
        const x = p.positions[i], z = p.positions[i + 2];
        const inside = x > 0.01 && x < 13.99 && z > 0.01 && z < 8.99;
        assert.ok(!inside, `${p.name} vertex inside the house at ${x.toFixed(2)}, ${z.toFixed(2)}`);
        assert.ok(p.positions[i + 1] >= 9.2 && p.positions[i + 1] <= 16, `${p.name} y ${p.positions[i + 1]}`);
    }
    // Windows face out of their walls.
    const glass = [...meshes.values()].filter((m) => /window/.test(m.parts[0]?.material ?? '')).flatMap((m) => m.parts);
    assert.ok(glass.length);
    for (const p of glass) for (let t = 0; t < p.indices.length; t += 3) {
        const v = (k: number) => [p.positions[p.indices[t + k] * 3], p.positions[p.indices[t + k] * 3 + 1], p.positions[p.indices[t + k] * 3 + 2]];
        const a = v(0), b = v(1), c = v(2);
        const cr = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
        const mid = [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3];
        const out = [mid[0] - 7, mid[1] - 4.5];
        assert.ok(cr[0] * out[0] + cr[2] * out[1] > 0, 'glass faces out');
    }
});

test('building detail: storefronts split between the shops, signs per business, awnings only with room', () => {
    const { kit, book } = kitWithMeshes();
    const walls = box(24, 15);
    kit.detail({
        walls, kind: 'shop', base: 9.6, top: 9.6 + 7.5, levels: 2, front: 0, frontRoom: 5, seed: 9, roofMat: 'roof',
        shops: [{ name: 'Coffee Rush', tags: { amenity: 'cafe' }, u: 5 }, { tags: { shop: 'beauty' }, u: 17 }],
    });
    assert.equal(kit.stats.storefronts, 2);
    const signs = book.materials.filter((m) => m.name.startsWith('bld_sign_'));
    assert.equal(signs.length, 2);
    const narrow = kitWithMeshes();
    for (let seed = 0; seed < 20; seed++) narrow.kit.detail({ walls, kind: 'shop', base: 9.6, top: 17, levels: 2, front: 0, frontRoom: 1.5, seed, roofMat: 'roof', shops: [] });
    assert.ok(!narrow.book.materials.some((m) => m.name === 'bld_awning'), 'no awning over the road');
    assert.equal(narrow.kit.stats.porches, 0);
});

test('building detail: a facade photo replaces the windows on its wall', () => {
    const { kit, meshes } = kitWithMeshes();
    const walls = box(12, 8);
    kit.detail({ walls, kind: 'house', base: 9.6, top: 13, levels: 1, front: 0, frontRoom: 8, seed: 3, roofMat: 'roof', shops: [], photos: new Map([[0, 'facade_photo_0.dds']]) });
    assert.equal(kit.stats.photos, 1);
    assert.equal(kit.stats.doors, 0);
    // No window glass on the photo's wall (y = 0 plane).
    for (const m of meshes.values()) if (/window/.test(m.parts[0]?.material ?? '')) for (const p of m.parts) for (let i = 2; i < p.positions.length; i += 3) assert.ok(p.positions[i] > -0.01, 'glass on the photo wall');
});
