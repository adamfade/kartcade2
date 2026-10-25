// Node CLI: same pipeline as the admin page, for when this machine can reach the map servers.
//   npm run track -- --start "lat,lon" --end "lat,lon" [--via "lat,lon"]... --name "Pete's Mountain Rd" [--out dir]
//   npm run track -- --from "place to geocode" --to "place to geocode" --name ...
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { buildFromPins, geocode } from './fetchers.ts';
import type { NetOptions } from './fetchers.ts';
import { decodePNG } from './png.ts';
import type { LatLon } from './geo.ts';

const UA = 'KartcadeTrackBuilder/0.1 (+https://www.kartcade.com; info@kartcade.com)';

function arg(name: string, all = false): string[] {
    const out: string[] = [];
    const a = process.argv.slice(2);
    for (let i = 0; i < a.length; i++) if (a[i] === `--${name}` && a[i + 1] != null) out.push(a[++i]);
    return all ? out : out.slice(0, 1);
}
const ll = (s: string): LatLon => { const [lat, lon] = s.split(',').map(Number); if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Bad coordinate: ${s}`); return { lat, lon }; };

async function main() {
    const net: NetOptions = { fetch: globalThis.fetch.bind(globalThis), headers: { 'User-Agent': UA }, log: (m) => console.log(`- ${m}`) };
    const name = arg('name')[0] ?? 'Real Road';
    let start = arg('start')[0] ? ll(arg('start')[0]) : null;
    let end = arg('end')[0] ? ll(arg('end')[0]) : null;
    if (!start && arg('from')[0]) { const r = await geocode(net, arg('from')[0], 1); if (!r[0]) throw new Error('Start not found'); start = r[0]; console.log(`- Start: ${r[0].name}`); }
    if (!end && arg('to')[0]) { const r = await geocode(net, arg('to')[0], 1); if (!r[0]) throw new Error('End not found'); end = r[0]; console.log(`- End: ${r[0].name}`); }
    if (!start || !end) throw new Error('Give --start/--end as "lat,lon" or --from/--to as place names');
    const vias = arg('via', true).map(ll);
    const width = arg('width')[0] ? parseFloat(arg('width')[0]) : undefined;
    const res = await buildFromPins(net, (png) => {
        const img = decodePNG(png);
        return { width: img.width, height: img.height, data: img.data, channels: 4 as const };
    }, { name, pins: [start, ...vias, end], widthOverride: width, useOverpass: !process.argv.includes('--no-overpass'), flipStart: process.argv.includes('--flip-start') });
    const out = arg('out')[0] ?? 'tracks-out';
    mkdirSync(out, { recursive: true });
    const zipPath = join(out, `${res.id}.zip`);
    writeFileSync(zipPath, res.zip);
    for (const [p, data] of Object.entries(unzipSync(res.zip))) { const f = join(out, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); }
    console.log(JSON.stringify({ zip: zipPath, folder: join(out, res.id), widthSource: res.widthSource, ...res.stats }, null, 2));
}

main().catch((e) => { console.error(`Track build failed: ${(e as Error).message}`); process.exit(1); });
