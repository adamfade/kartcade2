// Kartcade TV hub. Runs on the front PC. No internet and no npm packages needed.
// Rigs post laps and live updates here; the TV board and control page read from here.
//   node server.js            (port 8787, data in ./data)
//   PORT=9000 node server.js

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATA = process.env.DATA_DIR || path.join(HERE, 'data');
const PUBLIC = path.join(HERE, 'public');
const LAPS_FILE = path.join(DATA, 'laps.jsonl');
const STATE_FILE = path.join(DATA, 'state.json');
const KEEP_DAYS = 120;
const LIVE_TIMEOUT_MS = 20_000;   // rig tile goes "offline" after this long without an update
const DAY = 86_400_000;

fs.mkdirSync(DATA, { recursive: true });

// ---------- storage ----------
const laps = [];                  // { id, at, rigId, sessionId, lapNo, driver, car, carId, track, trackId, ms, valid }
const lapIds = new Set();
if (fs.existsSync(LAPS_FILE)) {
  const cutoff = Date.now() - KEEP_DAYS * DAY;
  for (const line of fs.readFileSync(LAPS_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const l = JSON.parse(line);
      if (l.at >= cutoff && !lapIds.has(l.id)) { laps.push(l); lapIds.add(l.id); }
    } catch { /* skip a broken line */ }
  }
  fs.writeFileSync(LAPS_FILE, laps.map((l) => JSON.stringify(l)).join('\n') + (laps.length ? '\n' : ''));
}

let saved = { mode: 'leaderboard', race: null, history: [] };
try { saved = { ...saved, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch { /* first run */ }
const saveState = () => fs.writeFile(STATE_FILE, JSON.stringify(saved, null, 2), () => {});

const live = new Map();           // rigId -> { rigId, driver, car, carId, track, trackId, lapNo, curMs, seenAt, equipment }

// ---------- helpers ----------
const clean = (v, max = 60) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const idSafe = (v) => clean(v, 60).replace(/[^A-Za-z0-9_.-]/g, '');
const driverKey = (name) => clean(name).toLowerCase().replace(/\s+/g, ' ');
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const startOfWeek = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }; // Monday

function isLan(req) {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || /^10\./.test(ip) || /^192\.168\./.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^169\.254\./.test(ip) || /^f[cd]/i.test(ip) || /^fe80/i.test(ip);
}

function bestPerDriver(list, limit = 10) {
  const best = new Map();
  for (const l of list) {
    const k = driverKey(l.driver);
    const cur = best.get(k);
    if (!cur || l.ms < cur.ms) best.set(k, l);
  }
  return [...best.values()].sort((a, b) => a.ms - b.ms).slice(0, limit)
    .map((l) => ({ driver: l.driver, ms: l.ms, rigId: l.rigId, car: l.car, at: l.at }));
}

// Leaderboard mode: the track/car combos used most recently, with today's and this week's best.
function leaderboards() {
  const week = startOfWeek(), today = startOfToday();
  const recent = laps.filter((l) => l.valid && l.at >= Math.min(week, Date.now() - 7 * DAY));
  const combos = new Map();
  for (const l of recent) {
    const k = l.trackId + '|' + l.carId;
    const c = combos.get(k) || { trackId: l.trackId, track: l.track, carId: l.carId, car: l.car, lastAt: 0, laps: [] };
    c.laps.push(l); c.lastAt = Math.max(c.lastAt, l.at);
    combos.set(k, c);
  }
  return [...combos.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, 4).map((c) => ({
    track: c.track, car: c.car, lastAt: c.lastAt,
    today: bestPerDriver(c.laps.filter((l) => l.at >= today)),
    week: bestPerDriver(c.laps.filter((l) => l.at >= week)),
  }));
}

// Race mode. scope 'all' = every valid lap since Start; 'match' = only the race's track and car.
function raceView() {
  const race = saved.race;
  if (!race) return null;
  const until = race.endedAt || Infinity;
  let pool = laps.filter((l) => l.at >= race.startedAt && l.at <= until);
  if (race.scope === 'match') {
    pool = pool.filter((l) => (!race.trackId || l.trackId === race.trackId) && (!race.carId || l.carId === race.carId));
  }
  const valid = pool.filter((l) => l.valid);
  const rigIds = new Set([...pool.map((l) => l.rigId)]);
  const now = Date.now();
  for (const [id, r] of live) if (now - r.seenAt < LIVE_TIMEOUT_MS) rigIds.add(id);

  const rigs = [...rigIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((rigId) => {
    const mine = pool.filter((l) => l.rigId === rigId);
    const myValid = mine.filter((l) => l.valid);
    const best = myValid.reduce((b, l) => (!b || l.ms < b.ms ? l : b), null);
    const last = mine[mine.length - 1] || null;
    const r = live.get(rigId);
    const online = !!r && now - r.seenAt < LIVE_TIMEOUT_MS;
    const offScope = race.scope === 'match' && online
      && ((race.trackId && r.trackId && r.trackId !== race.trackId) || (race.carId && r.carId && r.carId !== race.carId));
    return {
      rigId, online, offScope,
      driver: online && r.driver ? r.driver : (best ? best.driver : last ? last.driver : ''),
      car: online ? r.car : last?.car || '', track: online ? r.track : last?.track || '',
      running: online && !!r.driver && !race.endedAt,
      curMs: online ? r.curMs : 0, liveAt: online ? r.seenAt : 0,
      lapNo: online ? r.lapNo : 0,
      best: best ? { ms: best.ms, driver: best.driver, at: best.at } : null,
      last: last ? { ms: last.ms, valid: last.valid, at: last.at } : null,
      laps: mine.length,
    };
  });
  return { ...race, rigs, standings: bestPerDriver(valid, 20) };
}

function combosSeen() {
  const out = new Map();
  for (const l of laps.slice(-2000)) out.set(l.trackId + '|' + l.carId, { trackId: l.trackId, track: l.track, carId: l.carId, car: l.car, at: l.at });
  for (const r of live.values()) if (r.trackId) out.set(r.trackId + '|' + r.carId, { trackId: r.trackId, track: r.track, carId: r.carId, car: r.car, at: r.seenAt });
  return [...out.values()].sort((a, b) => b.at - a.at).slice(0, 20);
}

function snapshot() {
  const now = Date.now();
  return {
    now, mode: saved.mode,
    race: raceView(),
    boards: leaderboards(),
    rigsOnline: [...live.values()].filter((r) => now - r.seenAt < LIVE_TIMEOUT_MS).map((r) => r.rigId).sort(),
    history: saved.history.slice(0, 10),
  };
}

// ---------- live push (Server-Sent Events) ----------
const clients = new Set();
let pushTimer = null;
function push() {                 // coalesce bursts into at most ~4 pushes a second
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const msg = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) res.write(msg);
  }, 250);
}
setInterval(push, 5000);          // also refresh periodically so offline rigs drop off

// ---------- actions ----------
function addLap(b) {
  const lap = {
    rigId: idSafe(b.rigId) || 'rig', sessionId: idSafe(b.sessionId), lapNo: Number(b.lapNo) || 0,
    driver: clean(b.driverName, 40), car: clean(b.car, 80), carId: idSafe(b.carId),
    track: clean(b.track, 80), trackId: idSafe(b.trackId),
    ms: Math.round(Number(b.lapTimeMs)), valid: b.valid !== false,
    // A lap the rig queued while the hub was down carries its age, so it lands at the right time.
    at: Date.now() - Math.min(Math.max(Number(b.ageMs) || 0, 0), 3_600_000),
  };
  if (lap.driver.length < 2 || !(lap.ms >= 10_000 && lap.ms <= 1_200_000)) return { ok: false, error: 'bad lap' };
  lap.id = `${lap.sessionId || lap.rigId}-${lap.lapNo || lap.at}`;
  if (lapIds.has(lap.id)) return { ok: true, duplicate: true };   // rig retried
  laps.push(lap); lapIds.add(lap.id);
  fs.appendFile(LAPS_FILE, JSON.stringify(lap) + '\n', () => {});
  if (saved.race && !saved.race.endedAt && saved.race.scope === 'match' && lap.valid) {
    // "Set from first lap": the race takes the track/car of the first lap driven after Start.
    if (saved.race.autoTrack && !saved.race.trackId) { saved.race.trackId = lap.trackId; saved.race.track = lap.track; saveState(); }
    if (saved.race.autoCar && !saved.race.carId) { saved.race.carId = lap.carId; saved.race.car = lap.car; saveState(); }
  }
  push();
  return { ok: true };
}

function setLive(b) {
  const rigId = idSafe(b.rigId);
  if (!rigId) return { ok: false };
  live.set(rigId, {
    rigId, driver: clean(b.driverName, 40), car: clean(b.car, 80), carId: idSafe(b.carId),
    track: clean(b.track, 80), trackId: idSafe(b.trackId), equipment: idSafe(b.equipment),
    lapNo: Number(b.laps) || 0, curMs: Math.max(0, Number(b.curMs) || 0), seenAt: Date.now(),
  });
  push();
  return { ok: true };
}

function control(action, b) {
  const now = Date.now();
  if (action === 'mode') {
    if (['leaderboard', 'race'].includes(b.mode)) saved.mode = b.mode;
  } else if (action === 'race/start') {
    if (saved.race && !saved.race.endedAt) saved.history.unshift({ ...saved.race, endedAt: now, results: raceView().standings });
    const [trackId, carId] = [idSafe(b.trackId), idSafe(b.carId)];
    const combo = combosSeen().find((c) => (!trackId || c.trackId === trackId));
    const carCombo = combosSeen().find((c) => (!carId || c.carId === carId));
    saved.race = {
      id: 'race-' + now, name: clean(b.name, 40) || 'Race', startedAt: now, endedAt: null,
      scope: b.scope === 'match' ? 'match' : 'all',
      trackId, track: trackId ? combo?.track || trackId : '', autoTrack: !trackId,
      carId, car: carId ? carCombo?.car || carId : '', autoCar: !carId,
    };
    saved.mode = 'race';
  } else if (action === 'race/scope') {
    if (saved.race) saved.race.scope = b.scope === 'match' ? 'match' : 'all';
  } else if (action === 'race/end') {
    if (saved.race && !saved.race.endedAt) {
      saved.race.endedAt = now;
      saved.history.unshift({ ...saved.race, results: raceView().standings });
      saved.history = saved.history.slice(0, 50);
    }
  } else if (action === 'race/clear') {
    saved.race = null; saved.mode = 'leaderboard';
  } else {
    return { ok: false, error: 'unknown action' };
  }
  saveState(); push();
  return { ok: true };
}

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const PAGES = { '/': 'tv.html', '/tv': 'tv.html', '/control': 'control.html' };

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 20_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (!isLan(req)) { res.writeHead(403); return res.end('LAN only'); }
  const url = new URL(req.url, 'http://hub');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'POST') {
    const b = await readBody(req);
    if (p === '/api/lap') return json(res, 200, addLap(b));
    if (p === '/api/live') return json(res, 200, setLive(b));
    if (p.startsWith('/api/control/')) return json(res, 200, control(p.slice('/api/control/'.length), b));
    return json(res, 404, { ok: false });
  }
  if (p === '/api/state') return json(res, 200, { ...snapshot(), combos: combosSeen() });
  if (p === '/api/combos') return json(res, 200, combosSeen());
  if (p === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 2000\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/health') return json(res, 200, { ok: true, laps: laps.length });

  const file = PAGES[p] || p.slice(1);
  const full = path.join(PUBLIC, path.normalize(file));
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kartcade hub running. TV: http://localhost:${PORT}/tv  Control: http://localhost:${PORT}/control  (${laps.length} laps loaded)`);
});
