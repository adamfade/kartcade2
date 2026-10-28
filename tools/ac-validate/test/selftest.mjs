// Self-test: build a minimal valid track with the test writers, check it passes, then check that
// corrupted variants fail. Run: node test/selftest.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../validate.mjs';
import { writeKn5, writeAi, writePng, writeZip, translate, IDENT } from './writers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const VALIDATE = path.join(here, '..', 'validate.mjs');
const ID = 'test_ring';

function ring(r0, r1, y, segs) {
  const verts = [], indices = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    verts.push({ p: [Math.cos(a) * r0, y, Math.sin(a) * r0], uv: [0, i] });
    verts.push({ p: [Math.cos(a) * r1, y, Math.sin(a) * r1], uv: [1, i] });
  }
  for (let i = 0; i < segs; i++) {
    const a = 2 * i, b = 2 * i + 1, c = (2 * i + 2) % (2 * segs), d = (2 * i + 3) % (2 * segs);
    indices.push(a, c, b, b, c, d);
  }
  return { verts, indices };
}

function quad(half, y) {
  return {
    verts: [[-half, y, -half], [half, y, -half], [half, y, half], [-half, y, half]].map((p) => ({ p })),
    indices: [0, 2, 1, 0, 3, 2],
  };
}

function baseSpec() {
  const road = ring(95, 105, 0, 64);
  // Minimal valid DDS: 4x4 DXT1, one level (128-byte header + one 8-byte block).
  const dds = Buffer.alloc(136);
  dds.write('DDS ', 0, 'latin1'); dds.writeUInt32LE(124, 4); dds.writeUInt32LE(0x81007, 8);
  dds.writeUInt32LE(4, 12); dds.writeUInt32LE(4, 16); dds.writeUInt32LE(8, 20); dds.writeUInt32LE(1, 28);
  dds.writeUInt32LE(32, 76); dds.writeUInt32LE(4, 80); dds.write('DXT1', 84, 'latin1'); dds.writeUInt32LE(0x1000, 108);
  const mat = (name, tex) => ({
    name, shader: 'ksPerPixel',
    props: ['ksAmbient', 'ksDiffuse', 'ksSpecular', 'ksSpecularEXP', 'ksEmissive', 'ksAlphaRef'].map((n) => ({ name: n, a: 0.5 })),
    mappings: [{ name: 'txDiffuse', slot: 0, texture: tex }],
  });
  const dummy = (name, x, y, z) => ({ type: 'dummy', name, matrix: translate(x, y, z), children: [] });
  return {
    kn5: {
      version: 6,
      textures: [{ name: 'road.dds', data: dds }, { name: 'grass.dds', data: dds }],
      materials: [mat('road', 'road.dds'), mat('grass', 'grass.dds')],
      root: {
        type: 'dummy', name: ID, matrix: IDENT, children: [
          { type: 'mesh', name: 'road_visual', ...ring(95, 105, 0, 64), materialId: 0 },
          { type: 'mesh', name: '1ROAD', ...road, materialId: 0 },
          { type: 'mesh', name: '1GRASS', ...quad(200, -0.05), materialId: 1 },
          dummy('AC_START_0', 100, 0.5, -5),
          dummy('AC_PIT_0', 98, 0.5, -12),
          dummy('AC_HOTLAP_START_0', 100, 0.5, -20),
          dummy('AC_TIME_0_L', 95, 0, 0),
          dummy('AC_TIME_0_R', 105, 0, 0),
        ],
      },
    },
    ai: (() => {
      const pts = [];
      let len = 0;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const p = [Math.cos(a) * 100, 0.3, Math.sin(a) * 100];
        if (i) len += Math.hypot(p[0] - pts[i - 1].p[0], p[2] - pts[i - 1].p[2]);
        pts.push({ p, length: len, side: [5, 5] });
      }
      return pts;
    })(),
    ui: { name: 'Test Ring', description: 'Validator fixture', tags: ['circuit'], geotags: ['0 N', '0 E'], country: 'Nowhere', city: 'Test', length: '628', width: '10', pitboxes: '1', run: 'clockwise', author: 'selftest', version: '1.0', year: 2026 },
    surfaces: `[SURFACE_0]\nKEY=ROAD\nFRICTION=0.99\nDAMPING=0\nWAV=\nWAV_PITCH=0\nFF_EFFECT=NULL\nDIRT_ADDITIVE=0\nIS_VALID_TRACK=1\nBLACK_FLAG_TIME=0\nSIN_HEIGHT=0\nSIN_LENGTH=0\nIS_PITLANE=0\nVIBRATION_GAIN=0\nVIBRATION_LENGTH=0\n\n[SURFACE_1]\nKEY=GRASS\nFRICTION=0.6\nDAMPING=0.1\nWAV=grass.wav\nIS_VALID_TRACK=0\n`,
    mapIni: `[PARAMETERS]\nWIDTH=220\nHEIGHT=220\nMARGIN=5\nSCALE_FACTOR=1\nX_OFFSET=110\nZ_OFFSET=110\nDRAWING_SIZE=10\nMAX_SIZE=1000\n`,
    extra: {},
  };
}

function files(spec) {
  const f = {
    [`${ID}.kn5`]: spec.kn5Buf || writeKn5(spec.kn5),
    'data/surfaces.ini': Buffer.from(spec.surfaces),
    'data/map.ini': Buffer.from(spec.mapIni),
    'data/cameras.ini': Buffer.from('[HEADER]\nVERSION=3\nCAMERA_COUNT=0\n'),
    'map.png': writePng(220, 220),
    'ui/ui_track.json': Buffer.from(JSON.stringify(spec.ui, null, 2)),
    'ui/preview.png': writePng(4, 4),
    'ui/outline.png': writePng(4, 4),
    'ai/fast_lane.ai': spec.aiBuf || writeAi(spec.ai),
    ...spec.extra,
  };
  for (const [k, v] of Object.entries(f)) if (v === null) delete f[k];
  return f;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-validate-'));
function writeFolder(name, spec) {
  const dir = path.join(tmp, name, ID);
  for (const [rel, data] of Object.entries(files(spec))) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), data);
  }
  return dir;
}

const find = (spec, name) => {
  const walk = (n) => (n.name === name ? n : (n.children || []).map(walk).find(Boolean));
  return walk(spec.kn5.root);
};

const cases = [
  { name: 'valid folder', expect: 'pass', mod: () => {} },
  { name: 'valid zip', expect: 'pass', zip: true, mod: () => {} },
  {
    name: 'valid point-to-point', expect: 'pass', mod: (s) => {
      const kids = s.kn5.root.children.filter((c) => !c.name.startsWith('AC_TIME'));
      const d = (name, x, z) => ({ type: 'dummy', name, matrix: translate(x, 0, z), children: [] });
      kids.push(d('AC_AB_START_L', 95, 0), d('AC_AB_START_R', 105, 0), d('AC_AB_FINISH_L', -95, 0), d('AC_AB_FINISH_R', -105, 0));
      s.kn5.root.children = kids;
      s.ui.run = 'A to B';
      s.ui.length = '314';
      s.ai = s.ai.slice(0, 100); // half ring, open spline
    },
  },
  { name: 'bad KN5 magic', expect: 'fail', grep: /bad magic/, mod: (s) => { s.kn5.magic = 'sc6970'; } },
  { name: 'truncated KN5', expect: 'fail', grep: /unexpected end of file/, mod: (s) => { const b = writeKn5(s.kn5); s.kn5Buf = b.subarray(0, b.length - 300); } },
  { name: 'index out of range', expect: 'fail', grep: /out of range/, mod: (s) => { find(s, 'road_visual').indices[4] = 500; } },
  { name: 'NaN vertex position', expect: 'fail', grep: /position\(s\) are NaN/, mod: (s) => { find(s, 'road_visual').verts[3].p[1] = NaN; } },
  { name: 'NaN normal', expect: 'fail', grep: /normal\(s\) are NaN/, mod: (s) => { find(s, 'road_visual').verts[0].n = [NaN, 1, 0]; } },
  {
    name: 'over 65535 vertices', expect: 'fail', grep: /65535/, mod: (s) => {
      const verts = Array.from({ length: 65536 }, (_, i) => ({ p: [i % 100, 0, Math.floor(i / 100)] }));
      s.kn5.root.children.push({ type: 'mesh', name: 'huge', verts, indices: [0, 1, 2], materialId: 0 });
    },
  },
  { name: 'missing texture', expect: 'fail', grep: /not embedded/, mod: (s) => { s.kn5.textures = s.kn5.textures.slice(0, 1); } },
  { name: 'material id out of range', expect: 'fail', grep: /material id/, mod: (s) => { find(s, 'road_visual').materialId = 9; } },
  { name: 'physics key not in surfaces.ini', expect: 'fail', grep: /no surface key/, mod: (s) => { find(s, '1GRASS').name = '1ASPHALTX'; } },
  { name: 'missing surfaces.ini', expect: 'fail', grep: /surfaces\.ini missing/, mod: (s) => { s.extra['data/surfaces.ini'] = null; } },
  { name: 'surface FRICTION not a number', expect: 'fail', grep: /FRICTION "abc"/, mod: (s) => { s.surfaces = s.surfaces.replace('FRICTION=0.99', 'FRICTION=abc'); } },
  { name: 'ui_track.json without name', expect: 'fail', grep: /"name" missing/, mod: (s) => { delete s.ui.name; } },
  { name: 'ui_track.json invalid JSON', expect: 'fail', grep: /not valid JSON/, mod: (s) => { s.extra['ui/ui_track.json'] = Buffer.from('{ "name": "x", }x'); } },
  { name: 'circuit without AC_TIME_0', expect: 'fail', grep: /AC_TIME_0/, mod: (s) => { s.kn5.root.children = s.kn5.root.children.filter((c) => !c.name.startsWith('AC_TIME')); } },
  { name: 'timing gate missing R', expect: 'fail', grep: /incomplete/, mod: (s) => { s.kn5.root.children = s.kn5.root.children.filter((c) => c.name !== 'AC_TIME_0_R'); } },
  {
    name: 'point-to-point missing finish', expect: 'fail', grep: /AC_AB_FINISH_L/, mod: (s) => {
      s.kn5.root.children.push({ type: 'dummy', name: 'AC_AB_START_L', matrix: translate(95, 0, 0) }, { type: 'dummy', name: 'AC_AB_START_R', matrix: translate(105, 0, 0) });
    },
  },
  { name: 'AI points off the road', expect: 'fail', grep: /farther than the road width/, mod: (s) => { s.ai.slice(50, 80).forEach((p) => { p.p[0] *= 1.6; p.p[2] *= 1.6; }); } },
  { name: 'AI length not monotonic', expect: 'fail', grep: /length decreases/, mod: (s) => { s.ai[120].length = 1; } },
  { name: 'AI file truncated', expect: 'fail', grep: /parse error|does not fit|truncated/, mod: (s) => { const b = writeAi(s.ai); s.aiBuf = b.subarray(0, b.length - 1000); } },
  { name: 'AI file missing has-grid flag', expect: 'fail', grep: /has-grid flag is missing/, mod: (s) => { s.aiBuf = writeAi(s.ai, { gridFlag: false }); } },
  { name: 'truncated DDS texture', expect: 'fail', grep: /need 136/, mod: (s) => { s.kn5.textures[0] = { name: 'road.dds', data: s.kn5.textures[0].data.subarray(0, 130) }; } },
  { name: 'missing map.png', expect: 'fail', grep: /map\.png missing/, mod: (s) => { s.extra['map.png'] = null; } },
  { name: 'no kn5 at all', expect: 'fail', grep: /no test_ring\.kn5/, mod: (s) => { s.extra[`${ID}.kn5`] = null; } },
  { name: 'missing fast_lane.ai warns only', expect: 'warn', grep: /fast_lane\.ai missing/, mod: (s) => { s.extra['ai/fast_lane.ai'] = null; } },
];

let failed = 0;
for (const c of cases) {
  const spec = baseSpec();
  c.mod(spec);
  let target;
  const slug = c.name.replace(/\W+/g, '_');
  if (c.zip) {
    target = path.join(tmp, `${slug}.zip`);
    fs.writeFileSync(target, writeZip(Object.entries(files(spec)).map(([n, d]) => ({ name: `${ID}/${n}`, data: d }))));
  } else target = writeFolder(slug, spec);
  const R = validate(target);
  const text = R.text();
  const got = R.result.toLowerCase();
  let ok = c.expect === 'pass' ? got !== 'fail' && R.warnings === 0 : got === c.expect;
  if (ok && c.grep && !c.grep.test(text)) ok = false;
  if (!ok) {
    failed++;
    console.log(`not ok - ${c.name}: expected ${c.expect}${c.grep ? ` matching ${c.grep}` : ''}, got ${R.result}`);
    console.log(text.split('\n').filter((l) => /FAIL|WARN/.test(l)).map((l) => '      ' + l).join('\n'));
  } else console.log(`ok     - ${c.name} (${R.result}${c.expect !== 'pass' ? `: ${(R.items.find((i) => i.level === c.expect.toUpperCase() && (!c.grep || c.grep.test(i.msg))) || {}).msg}` : ''})`);
}

// CLI exit codes
const cli = (p) => spawnSync(process.execPath, [VALIDATE, p], { encoding: 'utf8' }).status;
const good = writeFolder('cli_good', baseSpec());
const badSpec = baseSpec(); badSpec.kn5.magic = 'xx6969';
const bad = writeFolder('cli_bad', badSpec);
const g = cli(good), b = cli(bad);
if (g !== 0) { failed++; console.log(`not ok - CLI exit code on valid track: ${g}`); } else console.log('ok     - CLI exits 0 on valid track');
if (b !== 1) { failed++; console.log(`not ok - CLI exit code on broken track: ${b}`); } else console.log('ok     - CLI exits 1 on broken track');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} test(s) failed` : `\nall ${cases.length + 2} tests passed`);
process.exit(failed ? 1 : 0);
