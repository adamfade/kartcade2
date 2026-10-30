// Pretends to be rigs so you can check the TV board without Assetto Corsa.
//   node tools/fake-rigs.js [rigCount] [hubUrl]
// Each fake rig sends a live update every second and a lap every 20-30 seconds.

const COUNT = Number(process.argv[2] || 6);
const HUB = (process.argv[3] || 'http://localhost:8787').replace(/\/+$/, '');
const NAMES = ['Maya R', 'Jordan K', 'Sam P', 'Alex T', 'Riley M', 'Chris D', 'Taylor B', 'Jamie L', 'Morgan S'];
const TRACK = { track: 'Brands Hatch (indy)', trackId: 'ks_brands_hatch', car: 'Mazda MX-5 Cup', carId: 'ks_mazda_mx5_cup' };

const post = (path, body) => fetch(HUB + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});

const rigs = Array.from({ length: COUNT }, (_, i) => ({
  rigId: 'rig-' + String(i + 1).padStart(2, '0'),
  driver: NAMES[i % NAMES.length],
  base: 60_000 + Math.random() * 6000,
  sessionId: `fake-${i + 1}-${Date.now()}`,
  laps: 0, lapStart: Date.now() - Math.random() * 20_000, lapLen: 0,
}));
for (const r of rigs) r.lapLen = r.base + Math.random() * 3000;

setInterval(() => {
  const now = Date.now();
  for (const r of rigs) {
    const cur = now - r.lapStart;
    if (cur >= r.lapLen) {
      r.laps += 1;
      const valid = Math.random() > 0.15;
      post('/api/lap', { rigId: r.rigId, equipment: 'rigs', sessionId: r.sessionId, lapNo: r.laps, driverName: r.driver,
        lapTimeMs: Math.round(r.lapLen), valid, ...TRACK });
      r.lapStart = now; r.lapLen = r.base + Math.random() * 3000;
    }
    post('/api/live', { rigId: r.rigId, equipment: 'rigs', driverName: r.driver, laps: r.laps, curMs: Math.round(now - r.lapStart), ...TRACK });
  }
}, 1000);
console.log(`Sending ${COUNT} fake rigs to ${HUB}. Ctrl+C to stop.`);
