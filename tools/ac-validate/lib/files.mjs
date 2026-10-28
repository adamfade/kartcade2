// Virtual file system over a folder or a zip, plus small INI / PNG helpers.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export class Vfs {
  constructor(kind) {
    this.kind = kind;
    this.files = new Map(); // lower-case path -> { path, size, read }
  }
  add(p, size, read) {
    this.files.set(p.toLowerCase(), { path: p, size, read });
  }
  // Case-insensitive like AC on Windows.
  get(p) {
    return this.files.get(p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()) || null;
  }
  has(p) { return !!this.get(p); }
  read(p) {
    const f = this.get(p);
    return f ? f.read() : null;
  }
  readText(p) {
    const b = this.read(p);
    if (!b) return null;
    return b.toString('utf8').replace(/^﻿/, '');
  }
  list(prefix = '') {
    const pre = prefix ? prefix.toLowerCase().replace(/\/?$/, '/') : '';
    return [...this.files.values()].filter((f) => f.path.toLowerCase().startsWith(pre));
  }
  dirs() {
    const s = new Set(['']);
    for (const f of this.files.values()) {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join('/'));
    }
    return [...s];
  }
}

export function vfsFromFolder(dir) {
  const v = new Vfs('folder');
  let count = 0;
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(a, r);
      else if (e.isFile()) {
        if (++count > 200000) throw new Error('more than 200000 files; refusing to scan');
        const size = fs.statSync(a).size;
        v.add(r, size, () => fs.readFileSync(a));
      }
    }
  };
  walk(dir, '');
  return v;
}

// Minimal zip reader: stored (0) and deflate (8) entries, no zip64, no encryption.
export function vfsFromZip(buf) {
  const v = new Vfs('zip');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let o = buf.readUInt32LE(eocd + 16);
  if (o === 0xffffffff || total === 0xffff) throw new Error('zip64 archives are not supported');
  if (o + cdSize > buf.length) throw new Error('zip central directory out of range');
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(o) !== 0x02014b50) throw new Error(`bad zip central directory entry #${n}`);
    const flags = buf.readUInt16LE(o + 8);
    const method = buf.readUInt16LE(o + 10);
    const csize = buf.readUInt32LE(o + 20);
    const usize = buf.readUInt32LE(o + 24);
    const nl = buf.readUInt16LE(o + 28), xl = buf.readUInt16LE(o + 30), cl = buf.readUInt16LE(o + 32);
    const local = buf.readUInt32LE(o + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', o + 46, o + 46 + nl).replace(/\\/g, '/');
    o += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`zip entry "${name}" is encrypted`);
    v.add(name, usize, () => {
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header for "${name}"`);
      const lnl = buf.readUInt16LE(local + 26), lxl = buf.readUInt16LE(local + 28);
      const start = local + 30 + lnl + lxl;
      const data = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`zip entry "${name}" uses unsupported compression method ${method}`);
    });
  }
  return v;
}

// AC-style INI: [SECTION], KEY=VALUE, ';' and '//' comments. Keys upper-cased.
export function parseIni(text) {
  const sections = new Map();
  const issues = [];
  let cur = null;
  text.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    let line = raw;
    const sc = line.indexOf(';');
    if (sc >= 0) line = line.slice(0, sc);
    const sl = line.indexOf('//');
    if (sl >= 0) line = line.slice(0, sl);
    line = line.trim();
    if (!line) return;
    if (line.startsWith('[')) {
      const m = line.match(/^\[([^\]]+)\]$/);
      if (!m) { issues.push(`line ${i + 1}: malformed section header "${raw.trim()}"`); cur = null; return; }
      const name = m[1].trim().toUpperCase();
      if (sections.has(name)) issues.push(`line ${i + 1}: duplicate section [${name}]`);
      else sections.set(name, {});
      cur = sections.get(name);
      return;
    }
    const eq = line.indexOf('=');
    if (eq < 0) { issues.push(`line ${i + 1}: not KEY=VALUE: "${raw.trim()}"`); return; }
    if (!cur) { issues.push(`line ${i + 1}: key outside any section`); return; }
    const k = line.slice(0, eq).trim().toUpperCase();
    if (k in cur) issues.push(`line ${i + 1}: duplicate key ${k}`);
    cur[k] = line.slice(eq + 1).trim();
  });
  return { sections, issues };
}

export function pngInfo(buf) {
  if (!buf || buf.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function num(v) {
  if (v === undefined || v === null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return NaN;
  return Number(s);
}
