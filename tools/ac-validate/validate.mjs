#!/usr/bin/env node
// Independent validator for Assetto Corsa track packages (folder or .zip).
// Usage: node validate.mjs <track-folder-or-zip> [--verbose] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseKn5, meshWorldPositions, bbox, FormatError } from './lib/kn5.mjs';
import { parseAi, extraField } from './lib/ai.mjs';
import { TriGrid } from './lib/geom.mjs';
import { Vfs, vfsFromFolder, vfsFromZip, parseIni, pngInfo, num } from './lib/files.mjs';

// ---------------------------------------------------------------- report

export class Report {
  constructor() { this.items = []; this.section = 'General'; }
  sec(name) { this.section = name; }
  add(level, msg) { this.items.push({ section: this.section, level, msg }); }
  pass(m) { this.add('PASS', m); }
  warn(m) { this.add('WARN', m); }
  fail(m) { this.add('FAIL', m); }
  info(m) { this.add('INFO', m); }
  get failures() { return this.items.filter((i) => i.level === 'FAIL').length; }
  get warnings() { return this.items.filter((i) => i.level === 'WARN').length; }
  get result() { return this.failures ? 'FAIL' : this.warnings ? 'WARN' : 'PASS'; }
  text() {
    const out = [];
    let sec = null;
    for (const it of this.items) {
      if (it.section !== sec) { sec = it.section; out.push('', `== ${sec} ==`); }
      out.push(`  ${it.level.padEnd(4)}  ${it.msg}`);
    }
    out.push('', `RESULT: ${this.result} (${this.failures} failure(s), ${this.warnings} warning(s))`);
    return out.join('\n');
  }
}

// ---------------------------------------------------------------- constants

const SURFACE_KEYS_KNOWN = new Set([
  'KEY', 'FRICTION', 'DAMPING', 'WAV', 'WAV_PITCH', 'FF_EFFECT', 'DIRT_ADDITIVE', 'IS_VALID_TRACK',
  'BLACK_FLAG_TIME', 'SIN_HEIGHT', 'SIN_LENGTH', 'IS_PITLANE', 'VIBRATION_GAIN', 'VIBRATION_LENGTH',
]);
// Keys commonly present in AC's system/data/surfaces.ini (low confidence; used only to downgrade to WARN).
const SYSTEM_SURFACES = new Set(['ROAD', 'KERB', 'GRASS', 'SAND']);

const KNOWN_SHADERS = new Set([
  'ksPerPixel', 'ksPerPixelAT', 'ksPerPixelNM', 'ksPerPixelAT_NM', 'ksPerPixelNM_UV2', 'ksPerPixelNM_UVMult',
  'ksPerPixelMultiMap', 'ksPerPixelMultiMap_AT', 'ksPerPixelMultiMap_AT_NMDetail', 'ksPerPixelMultiMap_NMDetail',
  'ksPerPixelMultiMap_damage', 'ksPerPixelMultiMap_damage_dirt', 'ksPerPixelMultiMap_emissive',
  'ksPerPixelReflection', 'ksPerPixelSimpleRefl', 'ksPerPixelAlpha', 'ksPerPixel_dual_layer',
  'ksMultilayer', 'ksMultilayer_fresnel_nm', 'ksMultilayer_objsp', 'ksMultilayer_objsp_nm4',
  'ksTree', 'ksGrass', 'ksFlags', 'ksSky', 'ksSkyBox', 'ksBrokenGlass', 'ksTyres', 'ksBrakeDisc',
  'ksWindscreen', 'ksDiscBlur', 'GL', 'ksPerPixelNM_UV2_AT',
]);
const BASE_PROPS = ['ksAmbient', 'ksDiffuse', 'ksSpecular', 'ksSpecularEXP', 'ksEmissive', 'ksAlphaRef'];

function expectedSlots(shader) {
  const s = [];
  if (/^ks(PerPixel|Multilayer|Tree|Grass|Flags)/.test(shader)) s.push('txDiffuse');
  if (/NM/.test(shader)) s.push('txNormal');
  if (/MultiMap/.test(shader)) s.push('txMaps');
  if (/^ksMultilayer/.test(shader)) s.push('txMask', 'txDetailR', 'txDetailG', 'txDetailB', 'txDetailA');
  return s;
}

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
const v3 = (a) => `(${a.map((x) => fmt(x)).join(', ')})`;

// ---------------------------------------------------------------- input

function openInput(input) {
  const st = fs.statSync(input);
  if (st.isDirectory()) return { vfs: vfsFromFolder(input), base: path.basename(path.resolve(input)) };
  const buf = fs.readFileSync(input);
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50 || /\.zip$/i.test(input)) {
    return { vfs: vfsFromZip(buf), base: path.basename(input).replace(/\.zip$/i, '') };
  }
  throw new Error('input is neither a folder nor a zip file');
}

function subVfs(vfs, root) {
  if (!root) return vfs;
  const v = new Vfs(vfs.kind);
  const pre = root.toLowerCase() + '/';
  for (const f of vfs.files.values()) {
    if (f.path.toLowerCase().startsWith(pre)) v.add(f.path.slice(pre.length), f.size, f.read);
  }
  return v;
}

function findTrackRoot(vfs, base) {
  const cands = [];
  for (const d of vfs.dirs()) {
    const name = d ? d.split('/').pop() : base;
    const p = d ? d + '/' : '';
    const sub = vfs.list(p + 'ui');
    const hasUi = vfs.has(p + 'ui/ui_track.json') || sub.some((f) => /^[^/]+\/ui_track\.json$/i.test(f.path.slice(p.length + 3)));
    const hasKn5 = vfs.has(`${p}${name}.kn5`) || vfs.has(p + 'models.ini');
    if (hasUi || hasKn5) cands.push({ dir: d, name, score: (hasUi ? 2 : 0) + (hasKn5 ? 1 : 0), depth: d ? d.split('/').length : 0 });
  }
  cands.sort((a, b) => b.score - a.score || a.depth - b.depth);
  return cands[0] || null;
}

// ---------------------------------------------------------------- main validation

export function validate(input, opts = {}) {
  const verbose = !!opts.verbose;
  const R = new Report();
  R.sec('Input');
  let vfsAll, base;
  try {
    ({ vfs: vfsAll, base } = openInput(input));
  } catch (e) {
    R.fail(`cannot open ${input}: ${e.message}`);
    return R;
  }
  R.info(`${vfsAll.kind} with ${vfsAll.files.size} file(s)`);
  const root = findTrackRoot(vfsAll, base);
  if (!root) {
    R.fail('no track folder found: expected <id>/<id>.kn5 or models.ini, and ui/ui_track.json');
    return R;
  }
  const id = root.name;
  const vfs = subVfs(vfsAll, root.dir);
  R.pass(`track folder "${root.dir || '.'}" (id "${id}")`);
  if (!/^[a-z0-9_\-]+$/.test(id)) R.warn(`track id "${id}" has characters other than lower-case letters, digits, "_" or "-"`);

  // Layouts
  const layouts = [];
  if (vfs.has('ui/ui_track.json')) layouts.push('');
  for (const f of vfs.list('ui')) {
    const m = f.path.match(/^ui\/([^/]+)\/ui_track\.json$/i);
    if (m) layouts.push(m[1]);
  }
  if (!layouts.length) {
    R.fail('missing ui/ui_track.json (or ui/<layout>/ui_track.json for multi-layout tracks)');
    layouts.push('');
  } else if (layouts.length > 1 || layouts[0] !== '') {
    R.info(`layouts: ${layouts.map((l) => l || '(default)').join(', ')}`);
  }

  const kn5Cache = new Map();
  for (const layout of layouts) validateLayout(R, vfs, id, layout, kn5Cache, verbose);
  return R;
}

function validateLayout(R, vfs, id, layout, kn5Cache, verbose) {
  const L = layout ? `${layout}/` : '';
  const tag = layout ? ` [${layout}]` : '';

  // ---- models
  R.sec(`Layout${tag}: models`);
  const models = [];
  const modelsIni = (layout && vfs.has(`models_${layout}.ini`)) ? `models_${layout}.ini` : vfs.has('models.ini') ? 'models.ini' : null;
  if (modelsIni) {
    const { sections, issues } = parseIni(vfs.readText(modelsIni));
    issues.forEach((i) => R.warn(`${modelsIni}: ${i}`));
    const keys = [...sections.keys()].filter((k) => /^MODEL_\d+$/.test(k)).sort((a, b) => +a.slice(6) - +b.slice(6));
    if (!keys.length) R.fail(`${modelsIni} has no [MODEL_n] sections`);
    keys.forEach((k, i) => { if (+k.slice(6) !== i) R.warn(`${modelsIni}: section numbering gap at [${k}]`); });
    for (const k of keys) {
      const s = sections.get(k);
      if (!s.FILE) { R.fail(`${modelsIni} [${k}] has no FILE=`); continue; }
      const posv = (s.POSITION || '0,0,0').split(',').map(num);
      const rotv = (s.ROTATION || '0,0,0').split(',').map(num);
      if (posv.length !== 3 || posv.some(Number.isNaN)) R.warn(`${modelsIni} [${k}] POSITION "${s.POSITION}" is not x,y,z`);
      if (rotv.some((x) => x && !Number.isNaN(x))) R.warn(`${modelsIni} [${k}] has a non-zero ROTATION; this validator ignores rotation for geometry checks`);
      if (!vfs.has(s.FILE)) R.fail(`${modelsIni} [${k}] FILE=${s.FILE} not found`);
      else models.push({ file: vfs.get(s.FILE).path, offset: posv.length === 3 && !posv.some(Number.isNaN) ? posv : [0, 0, 0] });
    }
    if (vfs.has(`${id}.kn5`)) R.info(`${id}.kn5 exists alongside ${modelsIni}; AC uses ${modelsIni}`);
    if (models.length) R.pass(`${modelsIni} references ${models.length} kn5 file(s)`);
  } else if (vfs.has(`${id}.kn5`)) {
    models.push({ file: vfs.get(`${id}.kn5`).path, offset: [0, 0, 0] });
    R.pass(`${id}.kn5 present`);
  } else {
    R.fail(`no ${id}.kn5 and no models.ini`);
  }

  const parsed = [];
  for (const m of models) {
    let k = kn5Cache.get(m.file);
    if (!k) {
      k = checkKn5(R, m.file, vfs.read(m.file), verbose);
      kn5Cache.set(m.file, k);
    } else {
      R.sec(`Layout${tag}: models`);
      R.info(`${m.file} already checked above`);
    }
    if (k) parsed.push({ ...m, kn5: k });
  }

  // ---- surfaces.ini
  R.sec(`Layout${tag}: ${L}data/surfaces.ini`);
  const surfaces = checkSurfaces(R, vfs, `${L}data/surfaces.ini`);

  // ---- ui_track.json
  const uiPath = layout ? `ui/${layout}/ui_track.json` : 'ui/ui_track.json';
  R.sec(`Layout${tag}: ${uiPath}`);
  const ui = checkUi(R, vfs, uiPath);
  const uiDir = uiPath.replace(/ui_track\.json$/i, '');
  for (const img of ['preview.png', 'outline.png']) {
    const b = vfs.read(uiDir + img);
    if (!b) R.warn(`${uiDir}${img} missing (shown in the track selection UI)`);
    else if (!pngInfo(b)) R.warn(`${uiDir}${img} is not a valid PNG`);
    else R.pass(`${uiDir}${img} present`);
  }

  // ---- physics surfaces
  R.sec(`Layout${tag}: physics surfaces`);
  const phys = checkPhysics(R, parsed, surfaces);

  // ---- dummies
  R.sec(`Layout${tag}: AC dummies`);
  const track = checkDummies(R, parsed, ui, phys);

  // ---- AI
  R.sec(`Layout${tag}: ${L}ai/fast_lane.ai`);
  const fast = vfs.read(`${L}ai/fast_lane.ai`);
  const mapIni = readMapIni(vfs, L);
  let aiLength = null;
  if (!fast) R.warn(`${L}ai/fast_lane.ai missing: no AI opponents, no track progress / position tracking`);
  else aiLength = checkAi(R, `${L}ai/fast_lane.ai`, fast, { grid: phys.validGrid, isCircuit: !track.p2p, ui, mapIni, verbose });
  const pit = vfs.read(`${L}ai/pit_lane.ai`);
  if (pit) {
    R.sec(`Layout${tag}: ${L}ai/pit_lane.ai`);
    checkAi(R, `${L}ai/pit_lane.ai`, pit, { grid: phys.allGrid, isCircuit: false, ui, mapIni: null, verbose, isPit: true });
  }
  if (aiLength && ui) {
    const uiLen = parseLength(ui.length);
    if (uiLen) {
      const diff = Math.abs(uiLen - aiLength) / aiLength;
      R.sec(`Layout${tag}: ${uiPath}`);
      if (diff > 0.1) R.warn(`ui length ${fmt(uiLen, 0)} m differs from AI spline length ${fmt(aiLength, 0)} m by ${fmt(diff * 100, 0)}%`);
      else R.pass(`ui length ${fmt(uiLen, 0)} m matches AI spline length ${fmt(aiLength, 0)} m (within 10%)`);
    }
  }

  // ---- map
  R.sec(`Layout${tag}: map`);
  checkMap(R, vfs, L, mapIni);

  // ---- other optional data files
  R.sec(`Layout${tag}: other data`);
  for (const f of ['cameras.ini', 'lighting.ini', 'groove.ini', 'audio_sources.ini', 'crew.ini']) {
    const p = `${L}data/${f}`;
    if (!vfs.has(p)) { if (f === 'cameras.ini') R.warn(`${p} missing (no replay / TV cameras)`); continue; }
    const { issues } = parseIni(vfs.readText(p));
    if (issues.length) issues.forEach((i) => R.warn(`${p}: ${i}`));
    else R.pass(`${p} parses`);
  }
}

// ---------------------------------------------------------------- KN5

function checkKn5(R, file, buf, verbose) {
  R.sec(`KN5: ${file}`);
  let k;
  try {
    k = parseKn5(buf);
  } catch (e) {
    if (e instanceof FormatError) R.fail(`parse error: ${e.message}`);
    else R.fail(`parse error: ${e.stack}`);
    return null;
  }
  R.pass(`parsed ${buf.length} bytes: magic sc6969, version ${k.version}${k.extraHeader !== null ? ` (extra header int ${k.extraHeader})` : ''}`);
  if (k.version !== 5 && k.version !== 6) R.warn(`unusual KN5 version ${k.version} (expected 5 or 6)`);
  if (k.trailingBytes) R.warn(`${k.trailingBytes} unread bytes after the node tree`);
  else R.pass('no trailing bytes after the node tree');

  // Textures
  const texNames = new Map();
  for (const t of k.textures) {
    if (texNames.has(t.name)) R.warn(`duplicate texture name "${t.name}"`);
    texNames.set(t.name, t);
    if (!t.name) R.warn(`texture #${t.index} has an empty name`);
    if (t.size === 0) R.warn(`texture "${t.name}" has 0 bytes of data`);
    else if (t.kind === 'unknown') R.warn(`texture "${t.name}" data is not DDS/PNG/JPG (first bytes do not match)`);
  }
  R.info(`${k.textures.length} texture(s): ${k.textures.slice(0, 20).map((t) => `${t.name} [${t.kind}, ${t.size} B]`).join(', ')}${k.textures.length > 20 ? ', ...' : ''}`);

  // Materials
  const used = new Set();
  let missingTex = 0;
  for (const m of k.materials) {
    const props = new Set(m.props.map((p) => p.name));
    const slots = new Set(m.mappings.map((x) => x.name));
    if (!KNOWN_SHADERS.has(m.shader)) R.warn(`material "${m.name}" uses unrecognised shader "${m.shader}"`);
    if (/^ks/.test(m.shader) && m.shader !== 'ksSky' && m.shader !== 'ksSkyBox') {
      const miss = BASE_PROPS.filter((p) => !props.has(p));
      if (miss.length) R.warn(`material "${m.name}" (${m.shader}) lacks usual properties: ${miss.join(', ')}`);
    }
    const missSlots = expectedSlots(m.shader).filter((s) => !slots.has(s));
    if (missSlots.length) R.warn(`material "${m.name}" (${m.shader}) has no mapping for ${missSlots.join(', ')}`);
    for (const p of m.props) {
      const vals = [p.a, ...p.b, ...p.c, ...p.d];
      if (vals.some((x) => !Number.isFinite(x))) R.fail(`material "${m.name}" property ${p.name} contains NaN/Inf`);
    }
    for (const x of m.mappings) {
      used.add(x.texture);
      if (!texNames.has(x.texture)) {
        missingTex++;
        R.fail(`material "${m.name}" slot ${x.name} references texture "${x.texture}" which is not embedded in the kn5`);
      }
    }
    if (m.alphaBlendMode > 2) R.warn(`material "${m.name}" has unusual alphaBlendMode ${m.alphaBlendMode}`);
    if (m.depthMode < 0 || m.depthMode > 2) R.warn(`material "${m.name}" has unusual depthMode ${m.depthMode}`);
  }
  if (!missingTex) R.pass(`${k.materials.length} material(s); every texture mapping resolves to an embedded texture`);
  const unused = k.textures.filter((t) => !used.has(t.name));
  if (unused.length) R.info(`${unused.length} embedded texture(s) not referenced by any material: ${unused.slice(0, 10).map((t) => t.name).join(', ')}`);
  if (verbose) for (const m of k.materials) R.info(`material "${m.name}": ${m.shader}, blend ${m.alphaBlendMode}, alphaTest ${m.alphaTested}, depth ${m.depthMode}, props [${m.props.map((p) => `${p.name}=${fmt(p.a, 3)}`).join(' ')}], maps [${m.mappings.map((x) => `${x.name}:${x.texture}`).join(' ')}]`);

  // Nodes / meshes
  const dummies = k.nodes.filter((n) => n.cls === 1);
  const skinned = k.meshes.filter((m) => m.cls === 3);
  R.info(`node tree: ${k.nodes.length} node(s), ${dummies.length} dummy/group node(s), ${k.meshes.length} mesh(es)${skinned.length ? `, ${skinned.length} skinned` : ''}; root "${k.root.name}"`);
  if (skinned.length) R.warn(`${skinned.length} skinned mesh(es); unusual for a track (skinned layout is the least certain part of this parser)`);
  if (k.root.cls !== 1) R.warn(`root node "${k.root.name}" is not a dummy node`);

  let errors = 0, totalV = 0, totalI = 0, degTotal = 0;
  const all = bbox(new Float64Array(0));
  const lines = [];
  for (const m of k.meshes) {
    totalV += m.vertexCount; totalI += m.indexCount;
    const s = m.stats;
    if (!m.name) R.warn(`mesh at ${m.path || '(root)'} has an empty name`);
    if (m.vertexCount > 65535) { errors++; R.fail(`mesh "${m.name}" has ${m.vertexCount} vertices; 16-bit indices allow at most 65535`); }
    if (m.vertexCount === 0) R.warn(`mesh "${m.name}" has no vertices`);
    if (m.indexCount % 3) { errors++; R.fail(`mesh "${m.name}" index count ${m.indexCount} is not a multiple of 3`); }
    let maxIdx = -1, bad = 0, firstBad = -1, deg = 0;
    for (let i = 0; i < m.indexCount; i++) {
      const ix = m.indices[i];
      if (ix > maxIdx) maxIdx = ix;
      if (ix >= m.vertexCount) { bad++; if (firstBad < 0) firstBad = i; }
    }
    for (let i = 0; i + 2 < m.indexCount; i += 3) {
      const a = m.indices[i], b = m.indices[i + 1], c = m.indices[i + 2];
      if (a === b || b === c || a === c) deg++;
    }
    degTotal += deg;
    if (bad) { errors++; R.fail(`mesh "${m.name}": ${bad} index(es) out of range (first at index #${firstBad} = ${m.indices[firstBad]}, vertex count ${m.vertexCount})`); }
    if (s.nanPos) { errors++; R.fail(`mesh "${m.name}": ${s.nanPos} vertex position(s) are NaN/Inf (first vertex #${s.firstNanPos})`); }
    if (s.nanNormal) { errors++; R.fail(`mesh "${m.name}": ${s.nanNormal} normal(s) are NaN/Inf (first vertex #${s.firstNanNormal})`); }
    if (s.nanUv) R.warn(`mesh "${m.name}": ${s.nanUv} UV(s) are NaN/Inf`);
    if (s.nanTangent) R.warn(`mesh "${m.name}": ${s.nanTangent} tangent(s) are NaN/Inf`);
    if (s.zeroNormal) R.warn(`mesh "${m.name}": ${s.zeroNormal} zero-length normal(s)`);
    if (deg) R.warn(`mesh "${m.name}": ${deg} degenerate triangle(s) (repeated index)`);
    if (m.materialId >= k.materials.length) { errors++; R.fail(`mesh "${m.name}" uses material id ${m.materialId} but the kn5 has ${k.materials.length} material(s)`); }
    if (m.lodOut > 0 && m.lodIn > m.lodOut) R.warn(`mesh "${m.name}": lodIn ${m.lodIn} > lodOut ${m.lodOut}`);
    if (m.vertexCount && m.vertexCount < 65536 && maxIdx >= 0 && maxIdx < m.vertexCount - 1 && m.vertexCount - 1 - maxIdx > m.vertexCount * 0.5) {
      R.warn(`mesh "${m.name}": indices only use vertices 0..${maxIdx} of ${m.vertexCount}`);
    }
    // Bounding sphere (local space) sanity
    if (m.bsphere && m.vertexCount && !s.nanPos) {
      const { center: c, radius } = m.bsphere;
      if (![...c, radius].every(Number.isFinite)) R.warn(`mesh "${m.name}": bounding sphere has NaN/Inf`);
      else {
        let maxD = 0;
        for (let v = 0; v < m.vertexCount; v++) {
          const dx = m.pos[v * 3] - c[0], dy = m.pos[v * 3 + 1] - c[1], dz = m.pos[v * 3 + 2] - c[2];
          maxD = Math.max(maxD, Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
        if (maxD > radius * 1.01 + 0.01) R.warn(`mesh "${m.name}": vertices extend ${fmt(maxD)} from bounding-sphere centre but radius is ${fmt(radius)} (may be culled early)`);
      }
    }
    const wp = meshWorldPositions(m);
    const bb = bbox(wp);
    m.bbox = bb;
    if (!bb.empty) for (let a = 0; a < 3; a++) { all.min[a] = Math.min(all.min[a], bb.min[a]); all.max[a] = Math.max(all.max[a], bb.max[a]); }
    const mat = k.materials[m.materialId];
    lines.push(`mesh "${m.name}": ${m.vertexCount} verts, ${m.indexCount} idx (${Math.floor(m.indexCount / 3)} tris), material "${mat ? mat.name : '?'}"${bb.empty ? '' : `, bbox ${v3(bb.min)}..${v3(bb.max)}`}${m.visible ? '' : ', hidden'}${m.renderable === 0 ? ', not renderable' : ''}`);
  }
  if (!errors) R.pass(`${k.meshes.length} mesh(es), ${totalV} vertices, ${totalI} indices: indices in range, no NaN/Inf positions or normals, all <= 65535 vertices`);
  if (degTotal) R.info(`${degTotal} degenerate triangle(s) in total`);
  if (!all.empty) {
    R.info(`overall bounding box ${v3(all.min)} .. ${v3(all.max)} (size ${v3(all.max.map((x, i) => x - all.min[i]))} m)`);
    const ext = Math.max(...all.max.map((x, i) => x - all.min[i]));
    if (ext > 50000) R.warn(`model spans ${fmt(ext, 0)} m; float precision suffers far from the origin`);
    const far = Math.max(...all.min.map(Math.abs), ...all.max.map(Math.abs));
    if (far > 20000) R.warn(`geometry reaches ${fmt(far, 0)} m from the origin; float precision suffers`);
  }
  const shown = verbose ? lines : lines.slice(0, 40);
  shown.forEach((l) => R.info(l));
  if (shown.length < lines.length) R.info(`... ${lines.length - shown.length} more mesh(es); use --verbose`);
  const names = dummies.map((n) => n.name).filter((n) => n.startsWith('AC_'));
  if (names.length) R.info(`AC_ dummies: ${names.join(', ')}`);
  return k;
}

// ---------------------------------------------------------------- surfaces.ini

function checkSurfaces(R, vfs, p) {
  const out = { keys: new Map(), present: false };
  const text = vfs.readText(p);
  if (text === null) { R.fail(`${p} missing`); return out; }
  out.present = true;
  const { sections, issues } = parseIni(text);
  issues.forEach((i) => R.warn(i));
  const secs = [...sections.keys()].filter((s) => /^SURFACE_\d+$/.test(s)).sort((a, b) => +a.slice(8) - +b.slice(8));
  const other = [...sections.keys()].filter((s) => !/^SURFACE_\d+$/.test(s));
  if (other.length) R.info(`non-surface sections: ${other.join(', ')}`);
  if (!secs.length) { R.fail('no [SURFACE_n] sections'); return out; }
  secs.forEach((s, i) => { if (+s.slice(8) !== i) R.warn(`numbering gap: expected [SURFACE_${i}], found [${s}] (AC may stop reading at the first gap)`); });
  let bad = 0;
  for (const s of secs) {
    const v = sections.get(s);
    const key = v.KEY;
    if (!key) { bad++; R.fail(`[${s}] has no KEY`); continue; }
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) R.warn(`[${s}] KEY "${key}" is not upper-case letters/digits/underscore`);
    if (/\d/.test(key[0])) { bad++; R.fail(`[${s}] KEY "${key}" starts with a digit`); }
    if (out.keys.has(key)) { bad++; R.fail(`[${s}] duplicate KEY ${key} (also in [${out.keys.get(key).section}])`); }
    const f = num(v.FRICTION);
    if (v.FRICTION === undefined) { bad++; R.fail(`[${s}] ${key}: FRICTION missing`); }
    else if (Number.isNaN(f)) { bad++; R.fail(`[${s}] ${key}: FRICTION "${v.FRICTION}" is not a number`); }
    else if (f <= 0 || f > 1.5) R.warn(`[${s}] ${key}: FRICTION ${f} outside usual range (0, 1.5]`);
    const d = num(v.DAMPING);
    if (v.DAMPING === undefined) R.warn(`[${s}] ${key}: DAMPING missing`);
    else if (Number.isNaN(d)) { bad++; R.fail(`[${s}] ${key}: DAMPING "${v.DAMPING}" is not a number`); }
    else if (d < 0 || d > 1) R.warn(`[${s}] ${key}: DAMPING ${d} outside usual range [0, 1]`);
    if (v.WAV === undefined) R.warn(`[${s}] ${key}: WAV missing (may be empty, but the key is normally present)`);
    let valid = 1;
    if (v.IS_VALID_TRACK === undefined) R.warn(`[${s}] ${key}: IS_VALID_TRACK missing`);
    else if (v.IS_VALID_TRACK !== '0' && v.IS_VALID_TRACK !== '1') { bad++; R.fail(`[${s}] ${key}: IS_VALID_TRACK "${v.IS_VALID_TRACK}" must be 0 or 1`); }
    else valid = +v.IS_VALID_TRACK;
    if (v.IS_PITLANE !== undefined && v.IS_PITLANE !== '0' && v.IS_PITLANE !== '1') R.warn(`[${s}] ${key}: IS_PITLANE "${v.IS_PITLANE}" should be 0 or 1`);
    for (const nk of ['WAV_PITCH', 'DIRT_ADDITIVE', 'BLACK_FLAG_TIME', 'SIN_HEIGHT', 'SIN_LENGTH', 'VIBRATION_GAIN', 'VIBRATION_LENGTH']) {
      if (v[nk] !== undefined && v[nk] !== '' && Number.isNaN(num(v[nk]))) R.warn(`[${s}] ${key}: ${nk} "${v[nk]}" is not a number`);
    }
    if (v.FF_EFFECT !== undefined && v.FF_EFFECT !== '' && v.FF_EFFECT.toUpperCase() !== 'NULL' && Number.isNaN(num(v.FF_EFFECT))) R.warn(`[${s}] ${key}: FF_EFFECT "${v.FF_EFFECT}" is neither NULL nor a number`);
    for (const k of Object.keys(v)) if (!SURFACE_KEYS_KNOWN.has(k)) R.warn(`[${s}] ${key}: unrecognised key ${k}`);
    out.keys.set(key, { section: s, valid, friction: f, pitlane: v.IS_PITLANE === '1' });
  }
  if (!bad) R.pass(`${secs.length} surface(s): ${[...out.keys.entries()].map(([k, x]) => `${k}${x.valid ? '' : '(invalid-track)'}`).join(', ')}`);
  if (![...out.keys.values()].some((x) => x.valid)) R.fail('no surface has IS_VALID_TRACK=1; every lap would be invalid');
  return out;
}

// ---------------------------------------------------------------- ui_track.json

function checkUi(R, vfs, p) {
  const text = vfs.readText(p);
  if (text === null) { R.fail(`${p} missing`); return null; }
  let ui;
  try { ui = JSON.parse(text); } catch (e) {
    R.fail(`not valid JSON: ${e.message} (Content Manager tolerates some errors; AC's launcher may not)`);
    return null;
  }
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) { R.fail('top level is not a JSON object'); return null; }
  R.pass('valid JSON object');
  const str = (k, level) => {
    const v = ui[k];
    if (v === undefined || v === null || v === '') { R[level](`"${k}" missing or empty`); return false; }
    if (typeof v !== 'string') { R.warn(`"${k}" should be a string, got ${typeof v}`); return false; }
    return true;
  };
  if (str('name', 'fail')) R.pass(`name "${ui.name}"`);
  str('description', 'warn');
  if (str('country', 'warn')) R.pass(`country "${ui.country}"`);
  str('city', 'warn');
  // length / width / pitboxes are strings in Kunos tracks, numbers are tolerated.
  for (const k of ['length', 'width']) {
    const v = ui[k];
    if (v === undefined || v === '') { R.warn(`"${k}" missing`); continue; }
    if (typeof v !== 'string' && typeof v !== 'number') { R.warn(`"${k}" should be a string like "4200"`); continue; }
    if (typeof v === 'number') R.info(`"${k}" is a number; Kunos tracks use strings`);
    if (!parseLength(v)) R.warn(`"${k}" value "${v}" has no usable number`);
    else R.pass(`${k} "${v}"`);
  }
  const pb = ui.pitboxes;
  if (pb === undefined || pb === '') R.warn('"pitboxes" missing');
  else {
    const n = num(pb);
    if (!Number.isInteger(n) || n < 1) R.fail(`"pitboxes" "${pb}" is not a positive integer`);
    else R.pass(`pitboxes ${n}`);
  }
  if (ui.run === undefined || ui.run === '') R.warn('"run" missing (e.g. "clockwise")');
  else if (typeof ui.run !== 'string') R.warn('"run" should be a string');
  else R.pass(`run "${ui.run}"`);
  if (ui.tags !== undefined && !(Array.isArray(ui.tags) && ui.tags.every((t) => typeof t === 'string'))) R.warn('"tags" should be an array of strings');
  if (ui.geotags !== undefined) {
    if (!Array.isArray(ui.geotags)) R.warn('"geotags" should be an array (e.g. ["45.6 N", "9.3 E"])');
    else if (ui.geotags.length && ui.geotags.length !== 2 && ui.geotags.length !== 3) R.warn(`"geotags" has ${ui.geotags.length} entries; expected lat, lon (and optional altitude)`);
  }
  if (ui.year !== undefined && !Number.isInteger(num(ui.year))) R.warn(`"year" "${ui.year}" is not an integer`);
  for (const k of ['author', 'version', 'url']) if (ui[k] !== undefined && typeof ui[k] !== 'string') R.warn(`"${k}" should be a string`);
  return ui;
}

function parseLength(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return v > 0 ? (v < 100 ? v * 1000 : v) : null;
  const m = String(v).replace(',', '.').match(/([\d.]+)\s*(km|mi|m)?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!(n > 0)) return null;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'km') n *= 1000;
  else if (unit === 'mi') n *= 1609.344;
  else if (!unit && n < 100) n *= 1000; // "5.8" almost certainly km
  return n;
}

// ---------------------------------------------------------------- physics meshes

function checkPhysics(R, parsed, surfaces) {
  const keys = [...surfaces.keys.keys()].sort((a, b) => b.length - a.length);
  const valid = [], all = [], validTags = [], allTags = [];
  const counts = new Map();
  let bad = 0, physCount = 0;
  for (const { kn5, offset, file } of parsed) {
    for (const m of kn5.meshes) {
      const mm = m.name.match(/^(\d+)(.*)$/);
      if (!mm) continue;
      physCount++;
      const rest = mm[2];
      let key = keys.find((k) => rest.startsWith(k));
      if (!key) {
        const ci = keys.find((k) => rest.toUpperCase().startsWith(k));
        const sys = [...SYSTEM_SURFACES].find((k) => rest.startsWith(k));
        if (ci) { R.warn(`physics mesh "${m.name}" matches surface ${ci} only case-insensitively`); key = ci; }
        else if (sys) { R.warn(`physics mesh "${m.name}": surface ${sys} not in this track's surfaces.ini (may fall back to AC's system surfaces.ini)`); key = sys; }
        else { bad++; R.fail(`physics mesh "${m.name}" (${file}): no surface key in surfaces.ini matches "${rest}"`); continue; }
      }
      counts.set(key, (counts.get(key) || 0) + 1);
      if (m.indexCount < 3) R.warn(`physics mesh "${m.name}" has no triangles`);
      if (m.stats.nanPos) continue;
      const wp = meshWorldPositions(m, offset);
      const s = surfaces.keys.get(key);
      const isValid = s ? s.valid : 1;
      for (let i = 0; i + 2 < m.indexCount; i += 3) {
        const a = m.indices[i], b = m.indices[i + 1], c = m.indices[i + 2];
        if (a >= m.vertexCount || b >= m.vertexCount || c >= m.vertexCount) continue;
        const tri = [wp[a * 3], wp[a * 3 + 1], wp[a * 3 + 2], wp[b * 3], wp[b * 3 + 1], wp[b * 3 + 2], wp[c * 3], wp[c * 3 + 1], wp[c * 3 + 2]];
        all.push(...tri); allTags.push(key);
        if (isValid) { valid.push(...tri); validTags.push(key); }
      }
    }
  }
  if (!physCount) R.fail('no physics meshes (mesh names starting with a digit followed by a surface KEY, e.g. 1ROAD)');
  else if (!bad) R.pass(`${physCount} physics mesh(es), all matched: ${[...counts.entries()].map(([k, n]) => `${k} x${n}`).join(', ')}`);
  if (physCount && !counts.has('ROAD')) R.warn('no ROAD physics mesh (e.g. 1ROAD)');
  for (const k of surfaces.keys.keys()) if (!counts.has(k)) R.info(`surface ${k} is defined but no mesh uses it`);
  const validGrid = valid.length ? new TriGrid(Float64Array.from(valid), validTags) : null;
  const allGrid = all.length ? new TriGrid(Float64Array.from(all), allTags) : null;
  if (physCount && !validGrid) R.fail('no physics triangles on any IS_VALID_TRACK=1 surface');
  else if (validGrid) R.info(`${validGrid.n} drivable (IS_VALID_TRACK=1) triangles, ${allGrid.n} physics triangles in total`);
  return { validGrid, allGrid, counts };
}

// ---------------------------------------------------------------- dummies

function checkDummies(R, parsed, ui, phys) {
  const dm = new Map();
  const meshNamed = new Set();
  for (const { kn5, offset } of parsed) {
    for (const n of kn5.nodes) {
      if (!n.name.startsWith('AC_')) continue;
      if (n.cls !== 1) { meshNamed.add(n.name); continue; }
      const pos = [n.world[12] + offset[0], n.world[13] + offset[1], n.world[14] + offset[2]];
      if (dm.has(n.name)) R.warn(`dummy ${n.name} appears more than once`);
      else dm.set(n.name, { pos, node: n });
    }
  }
  for (const n of meshNamed) R.warn(`${n} is a mesh, not a dummy (empty) node`);
  const seq = (prefix) => {
    const ids = [...dm.keys()].map((k) => k.match(new RegExp(`^${prefix}(\\d+)$`))).filter(Boolean).map((m) => +m[1]).sort((a, b) => a - b);
    let contiguous = 0;
    while (ids.includes(contiguous)) contiguous++;
    return { ids, contiguous };
  };
  const starts = seq('AC_START_'), pits = seq('AC_PIT_'), hot = seq('AC_HOTLAP_START_');
  const tags = Array.isArray(ui?.tags) ? ui.tags.join(' ') : '';
  const abNames = ['AC_AB_START_L', 'AC_AB_START_R', 'AC_AB_FINISH_L', 'AC_AB_FINISH_R'];
  const abPresent = abNames.filter((n) => dm.has(n));
  const p2pHint = /a\s*to\s*b|point[\s-]*to[\s-]*point|p2p|hill\s*climb/i.test(`${ui?.run || ''} ${tags}`);
  const p2p = abPresent.length > 0 || p2pHint;

  if (starts.contiguous) R.pass(`AC_START_0..${starts.contiguous - 1} (${starts.contiguous} grid slot(s))`);
  else R.warn('AC_START_0 missing (race grid spawn)');
  if (pits.contiguous) R.pass(`AC_PIT_0..${pits.contiguous - 1} (${pits.contiguous} pit box(es))`);
  else R.warn('AC_PIT_0 missing (practice / pit spawn)');
  if (hot.contiguous) R.pass('AC_HOTLAP_START_0 present');
  else R.warn('AC_HOTLAP_START_0 missing (hotlap mode spawn)');
  for (const s of [starts, pits]) if (s.ids.length !== s.contiguous) R.warn(`numbering gap in ${s === starts ? 'AC_START' : 'AC_PIT'}_n: found ${s.ids.join(',')}`);
  const pb = num(ui?.pitboxes);
  if (Number.isInteger(pb) && pb > 0) {
    if (pits.contiguous < pb) R.warn(`ui pitboxes = ${pb} but only ${pits.contiguous} AC_PIT_n dummies`);
    if (starts.contiguous < pb) R.warn(`ui pitboxes = ${pb} but only ${starts.contiguous} AC_START_n dummies`);
  }

  // Timing gates AC_TIME_n_L / _R
  const timeIdx = new Set();
  for (const k of dm.keys()) { const m = k.match(/^AC_TIME_(\d+)_[LR]$/); if (m) timeIdx.add(+m[1]); }
  const gates = [...timeIdx].sort((a, b) => a - b);
  let gateBad = 0;
  for (const g of gates) {
    const l = dm.get(`AC_TIME_${g}_L`), r = dm.get(`AC_TIME_${g}_R`);
    if (!l || !r) { gateBad++; R.fail(`timing gate ${g} incomplete: ${l ? '' : `AC_TIME_${g}_L `}${r ? '' : `AC_TIME_${g}_R`} missing`); continue; }
    gateCheck(R, `AC_TIME_${g}`, l.pos, r.pos);
  }
  gates.forEach((g, i) => { if (g !== i) R.warn(`timing gate numbering gap: expected AC_TIME_${i}, found AC_TIME_${g}`); });

  if (p2p) {
    R.info(`point-to-point layout (${abPresent.length ? 'AC_AB_* dummies present' : 'ui run/tags suggest A-to-B'})`);
    const miss = abNames.filter((n) => !dm.has(n));
    if (miss.length) R.fail(`point-to-point needs start and finish gates; missing ${miss.join(', ')}`);
    else {
      R.pass('AC_AB_START_L/R and AC_AB_FINISH_L/R present');
      gateCheck(R, 'AC_AB_START', dm.get('AC_AB_START_L').pos, dm.get('AC_AB_START_R').pos);
      gateCheck(R, 'AC_AB_FINISH', dm.get('AC_AB_FINISH_L').pos, dm.get('AC_AB_FINISH_R').pos);
      const a = dm.get('AC_AB_START_L').pos, b = dm.get('AC_AB_FINISH_L').pos;
      if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 10) R.warn('AB start and finish gates are less than 10 m apart');
    }
  } else {
    if (dm.has('AC_TIME_0_L') && dm.has('AC_TIME_0_R')) R.pass(`circuit timing: start/finish gate AC_TIME_0_L/R${gates.length > 1 ? ` + ${gates.length - 1} sector gate(s)` : ''}`);
    else if (!gates.includes(0)) R.fail('circuit has no start/finish gate AC_TIME_0_L / AC_TIME_0_R (laps will not be timed)');
  }

  // Spawn points must sit just above a physics surface.
  if (phys.allGrid) {
    let ok = 0, checked = 0;
    for (const [name, d] of dm) {
      if (!/^AC_(START|PIT|HOTLAP_START)_\d+$/.test(name)) continue;
      checked++;
      const hs = phys.allGrid.heightsAt(d.pos[0], d.pos[2]);
      const below = hs.filter((h) => h.y <= d.pos[1] + 0.5).sort((a, b) => b.y - a.y);
      if (!hs.length) R.warn(`${name} at ${v3(d.pos)} is not above any physics surface (car would fall)`);
      else if (!below.length) R.warn(`${name} at ${v3(d.pos)} is below the physics surface (nearest surface ${fmt(Math.min(...hs.map((h) => h.y)) - d.pos[1])} m above)`);
      else if (d.pos[1] - below[0].y > 5) R.warn(`${name} is ${fmt(d.pos[1] - below[0].y)} m above the surface (${below[0].tag}); car would drop`);
      else ok++;
    }
    if (checked && ok === checked) R.pass(`all ${checked} spawn dummies sit within 5 m above a physics surface`);
  }
  return { p2p, dummies: dm };
}

function gateCheck(R, name, l, r) {
  const w = Math.hypot(l[0] - r[0], l[2] - r[2]);
  if (w < 2) R.warn(`${name}: L and R are only ${fmt(w)} m apart (gate too narrow?)`);
  else if (w > 150) R.warn(`${name}: L and R are ${fmt(w)} m apart (gate very wide)`);
}

// ---------------------------------------------------------------- AI spline

function checkAi(R, name, buf, { grid, isCircuit, ui, mapIni, verbose, isPit }) {
  let ai;
  try { ai = parseAi(buf); } catch (e) { R.fail(`parse error: ${e.message}`); return null; }
  if (ai.version === 7) R.pass(`version 7, ${ai.count} points, sampleCount ${ai.sampleCount}`);
  else R.warn(`version ${ai.version} (expected 7), ${ai.count} points`);
  ai.notes.forEach((n) => (/does not match|truncated/.test(n) ? R.fail(n) : R.warn(n)));
  if (ai.extra) R.pass(`extra data: ${ai.extraStride} floats per point`);
  if (ai.gridFlagMissing) R.fail('file ends right after the extra data: the int32 has-grid flag is missing (AC reads past the end of the file)');
  else if (ai.gridError) R.fail(`grid section malformed: ${ai.gridError}`);
  else if (ai.grid) {
    const g = ai.grid;
    if (g.badRefs) R.fail(`grid references ${g.badRefs} point index(es) outside 0..${ai.count - 1}`);
    else R.pass(`grid present: ${g.items} x ${g.cells / Math.max(1, g.items)} cells, ${g.refs} point refs, density ${fmt(g.density)}, neighbours ${g.neighbors}`);
  } else if (ai.hasGrid === false) R.info('has-grid flag is 0 (no precomputed lookup grid)');
  if (ai.trailingBytes) R.warn(`${ai.trailingBytes} unexpected trailing byte(s) after the AI data`);
  if (ai.count < 2) { R.fail(`only ${ai.count} point(s)`); return null; }
  if (ai.count < 50 && !isPit) R.warn(`only ${ai.count} points; AI recorded by AC usually has one point every ~1 m`);

  const n = ai.count, P = ai.pos, Lg = ai.length;
  let nan = 0;
  for (let i = 0; i < n * 3; i++) if (!Number.isFinite(P[i])) nan++;
  for (let i = 0; i < n; i++) if (!Number.isFinite(Lg[i])) nan++;
  if (nan) { R.fail(`${nan} NaN/Inf value(s) in point positions or lengths`); return null; }

  // Length monotonic, consistent with point spacing
  let dec = 0, firstDec = -1, flat = 0, maxGap = 0, maxGapAt = 0, sumD = 0, sumL = 0, idBad = 0;
  for (let i = 1; i < n; i++) {
    const dl = Lg[i] - Lg[i - 1];
    if (dl < 0) { dec++; if (firstDec < 0) firstDec = i; }
    else if (dl === 0) flat++;
    const d = Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2], P[i * 3 + 2] - P[i * 3 - 1]);
    if (d > maxGap) { maxGap = d; maxGapAt = i; }
    sumD += d; sumL += dl;
  }
  for (let i = 0; i < n; i++) if (ai.ids[i] !== i) idBad++;
  if (dec) R.fail(`length decreases at ${dec} point(s) (first at #${firstDec}: ${fmt(Lg[firstDec - 1])} -> ${fmt(Lg[firstDec])})`);
  else R.pass(`length is monotonic: ${fmt(Lg[0])} .. ${fmt(Lg[n - 1])} m`);
  if (flat) R.warn(`${flat} consecutive point pair(s) with equal length`);
  if (Math.abs(Lg[0]) > 1) R.warn(`first point length is ${fmt(Lg[0])}, expected about 0`);
  if (sumD > 0 && Math.abs(sumL - sumD) / sumD > 0.05) R.warn(`length deltas sum to ${fmt(sumL)} m but point-to-point distance is ${fmt(sumD)} m (${fmt(Math.abs(sumL - sumD) / sumD * 100, 1)}% off)`);
  if (maxGap > 20) R.warn(`largest gap between consecutive points is ${fmt(maxGap)} m (at #${maxGapAt})`);
  if (idBad) R.warn(`${idBad} point id(s) are not equal to their index`);
  let total = sumD;
  if (isCircuit) {
    const close = Math.hypot(P[0] - P[n * 3 - 3], P[1] - P[n * 3 - 2], P[2] - P[n * 3 - 1]);
    total += close;
    if (close > Math.max(30, maxGap * 3)) R.warn(`circuit spline does not close: last point is ${fmt(close)} m from the first`);
    else R.pass(`circuit spline closes (last-to-first ${fmt(close)} m), lap ${fmt(total, 0)} m`);
  }

  // Extra fields sanity (v7)
  let sides = null;
  if (ai.extra && ai.extraStride === 18) {
    let badSide = 0, badSpeed = 0, nanX = 0;
    sides = new Float64Array(n);
    for (let i = 0; i < n * 18; i++) if (!Number.isFinite(ai.extra[i])) nanX++;
    for (let i = 0; i < n; i++) {
      const l = extraField(ai, i, 'sideLeft'), r = extraField(ai, i, 'sideRight'), sp = extraField(ai, i, 'speed');
      if (!(l >= 0 && l < 100 && r >= 0 && r < 100)) badSide++;
      else sides[i] = l + r;
      if (!(sp >= 0 && sp < 200)) badSpeed++;
    }
    if (nanX) R.fail(`${nanX} NaN/Inf value(s) in extra data`);
    if (badSide) { R.warn(`${badSide} point(s) with implausible sideLeft/sideRight (expect 0..100 m)`); sides = null; }
    else R.pass('sideLeft/sideRight plausible at every point');
    if (badSpeed) R.warn(`${badSpeed} point(s) with implausible speed (expect 0..200 m/s)`);
  }

  // Proximity to drivable physics surfaces
  if (!grid) R.warn('no drivable physics triangles to compare against; proximity check skipped');
  else {
    const uiW = parseLength(ui?.width);
    const defaultWidth = uiW && uiW > 2 && uiW < 100 ? uiW : 12;
    const onRoad = 1.5; // metres; AI points sit on or just above the surface
    let off = 0, far = 0, worst = 0, worstAt = -1, sum = 0;
    const R0 = Math.max(defaultWidth * 2, 30);
    for (let i = 0; i < n; i++) {
      const { dist } = grid.nearest(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], R0);
      const width = sides && sides[i] > 1 ? sides[i] : defaultWidth;
      if (dist > worst) { worst = dist; worstAt = i; }
      if (Number.isFinite(dist)) sum += dist;
      if (dist > width) far++;
      else if (dist > onRoad) off++;
    }
    const what = isPit ? 'physics surface' : 'drivable surface';
    const ws = worst === Infinity ? `> ${R0} m` : `${fmt(worst)} m`;
    if (far) R.fail(`${far} of ${n} point(s) are farther than the road width from any ${what} (worst ${ws} at #${worstAt}, ${v3([P[worstAt * 3], P[worstAt * 3 + 1], P[worstAt * 3 + 2]])})`);
    else if (off > n * 0.05) R.warn(`${off} of ${n} point(s) are more than ${onRoad} m from the ${what} (worst ${ws} at #${worstAt})`);
    else R.pass(`all points within road width of the ${what}; ${n - off} of ${n} within ${onRoad} m (mean ${fmt(sum / n)} m, worst ${ws})`);
  }

  // Map projection (low confidence formula)
  if (mapIni && mapIni.ok) {
    const { W, H, X, Z, S, M } = mapIni;
    let out = 0;
    for (let i = 0; i < n; i++) {
      const px = (P[i * 3] + X) / S, pz = (P[i * 3 + 2] + Z) / S;
      if (px < -M || px > W + M || pz < -M || pz > H + M) out++;
    }
    if (out) R.warn(`${out} of ${n} point(s) project outside map.png using (pos + OFFSET) / SCALE_FACTOR (formula is an assumption)`);
    else R.pass('all points project inside map.png bounds using map.ini offsets/scale');
  }
  if (verbose) for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 10))) R.info(`#${i}: ${v3([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]])} length ${fmt(Lg[i])}`);
  return isCircuit ? total : Lg[n - 1] - Lg[0];
}

// ---------------------------------------------------------------- map

function readMapIni(vfs, L) {
  const text = vfs.readText(`${L}data/map.ini`);
  if (text === null) return null;
  const { sections, issues } = parseIni(text);
  const p = sections.get('PARAMETERS') || {};
  const v = { W: num(p.WIDTH), H: num(p.HEIGHT), X: num(p.X_OFFSET), Z: num(p.Z_OFFSET), S: num(p.SCALE_FACTOR), M: num(p.MARGIN) };
  if (Number.isNaN(v.M)) v.M = 0;
  v.ok = [v.W, v.H, v.X, v.Z, v.S].every(Number.isFinite) && v.S > 0;
  return { ...v, raw: p, issues, hasSection: sections.has('PARAMETERS') };
}

function checkMap(R, vfs, L, mapIni) {
  const png = vfs.read(`${L}map.png`);
  const info = png ? pngInfo(png) : null;
  if (!png) R.fail(`${L}map.png missing`);
  else if (!info) R.fail(`${L}map.png is not a valid PNG`);
  else R.pass(`${L}map.png ${info.width}x${info.height}`);
  if (!mapIni) { R.fail(`${L}data/map.ini missing`); return; }
  mapIni.issues.forEach((i) => R.warn(`map.ini: ${i}`));
  if (!mapIni.hasSection) { R.fail('map.ini has no [PARAMETERS] section'); return; }
  const need = ['WIDTH', 'HEIGHT', 'X_OFFSET', 'Z_OFFSET', 'SCALE_FACTOR'];
  const opt = ['MARGIN', 'DRAWING_SIZE', 'MAX_SIZE'];
  let bad = 0;
  for (const k of need) {
    if (mapIni.raw[k] === undefined) { bad++; R.fail(`map.ini [PARAMETERS] ${k} missing`); }
    else if (Number.isNaN(num(mapIni.raw[k]))) { bad++; R.fail(`map.ini ${k} "${mapIni.raw[k]}" is not a number`); }
  }
  for (const k of opt) {
    if (mapIni.raw[k] === undefined) R.warn(`map.ini ${k} missing`);
    else if (Number.isNaN(num(mapIni.raw[k]))) R.warn(`map.ini ${k} "${mapIni.raw[k]}" is not a number`);
  }
  if (!bad) {
    if (!(mapIni.S > 0)) R.fail(`map.ini SCALE_FACTOR ${mapIni.S} must be > 0`);
    else R.pass(`map.ini WIDTH ${mapIni.W} HEIGHT ${mapIni.H} SCALE_FACTOR ${mapIni.S} X_OFFSET ${mapIni.X} Z_OFFSET ${mapIni.Z}`);
    if (info && (Math.round(mapIni.W) !== info.width || Math.round(mapIni.H) !== info.height)) {
      R.warn(`map.ini WIDTH/HEIGHT ${mapIni.W}x${mapIni.H} differ from map.png ${info.width}x${info.height}`);
    }
  }
}

// ---------------------------------------------------------------- CLI

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const pos = args.filter((a) => !a.startsWith('--'));
  if (pos.length !== 1 || flags.has('--help')) {
    console.error('usage: node validate.mjs <track-folder-or-zip> [--verbose] [--json]');
    process.exit(2);
  }
  const R = validate(pos[0], { verbose: flags.has('--verbose') });
  if (flags.has('--json')) console.log(JSON.stringify({ result: R.result, failures: R.failures, warnings: R.warnings, items: R.items }, null, 2));
  else console.log(R.text());
  process.exit(R.failures ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
