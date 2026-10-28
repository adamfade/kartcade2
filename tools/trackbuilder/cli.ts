// Node CLI: same pipeline as the admin page, for when this machine can reach the map servers.
//   npm run track -- --start "lat,lon" --end "lat,lon" [--via "lat,lon"]... --name "Pete's Mountain Rd" [--out dir]
//   npm run track -- --from "place to geocode" --to "place to geocode" --name ...
//   npm run track -- --circuit --trace lap.gpx --width 8 --name "Mac Track" [--start "lat,lon"] [--reverse] [--grid 12]
//   npm run track -- --circuit --start "lat,lon" --via "lat,lon" --via ... --width 8 --name ...   (pins joined directly)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { buildFromPins, buildFromTrace, geocode } from './fetchers.ts';
import { parseTrace, rotateLoopTo } from './trace.ts';
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
    const circuit = process.argv.includes('--circuit');
    const tracePath = arg('trace')[0];
    let start = arg('start')[0] ? ll(arg('start')[0]) : null;
    let end = arg('end')[0] ? ll(arg('end')[0]) : null;
    if (!start && arg('from')[0]) { const r = await geocode(net, arg('from')[0], 1); if (!r[0]) throw new Error('Start not found'); start = r[0]; console.log(`- Start: ${r[0].name}`); }
    if (!end && arg('to')[0]) { const r = await geocode(net, arg('to')[0], 1); if (!r[0]) throw new Error('End not found'); end = r[0]; console.log(`- End: ${r[0].name}`); }
    if (!circuit && !tracePath && (!start || !end)) throw new Error('Give --start/--end as "lat,lon" or --from/--to as place names');
    const vias = arg('via', true).map(ll);
    const width = arg('width')[0] ? parseFloat(arg('width')[0]) : undefined;
    const decode = (png: Uint8Array) => {
        const img = decodePNG(png);
        return { width: img.width, height: img.height, data: img.data, channels: 4 as const };
    };
    const reverse = process.argv.includes('--reverse');
    const includeAi = process.argv.includes('--with-ai') ? true : undefined;
    let res;
    if (circuit || tracePath) {
        // Traced line, no routing. A circuit's start/finish is the trace's first point, or --start if given.
        let line: LatLon[];
        if (tracePath) {
            const t = parseTrace(readFileSync(tracePath, 'utf8'), tracePath);
            console.log(`- Trace: ${t.format}, ${t.line.length} points${t.name ? ` (${t.name})` : ''}`);
            line = t.line;
            if (circuit && start) line = rotateLoopTo(line, start);
        } else {
            if (!start) throw new Error('A circuit needs --trace, or --start plus --via pins around the loop');
            line = [start, ...vias, ...(end ? [end] : [])];
        }
        if (!width) console.log('- No --width given; using 6.5 m (karting circuits are usually 7-10 m)');
        res = await buildFromTrace(net, decode, {
            name, line, circuit, reverse, width: width ?? 6.5, flipStart: process.argv.includes('--flip-start'),
            gridSlots: arg('grid')[0] ? parseInt(arg('grid')[0], 10) : undefined, includeAi,
        });
    } else {
        res = await buildFromPins(net, decode, { name, pins: [start!, ...vias, end!], widthOverride: width, useOverpass: !process.argv.includes('--no-overpass'), flipStart: process.argv.includes('--flip-start'), includeAi });
    }
    const out = arg('out')[0] ?? 'tracks-out';
    mkdirSync(out, { recursive: true });
    const zipPath = join(out, `${res.id}.zip`);
    writeFileSync(zipPath, res.zip);
    for (const [p, data] of Object.entries(unzipSync(res.zip))) { const f = join(out, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); }
    console.log(JSON.stringify({ zip: zipPath, folder: join(out, res.id), widthSource: 'widthSource' in res ? res.widthSource : (width ? 'set by hand' : 'default (6.5 m)'), ...res.stats }, null, 2));
}

main().catch((e) => { console.error(`Track build failed: ${(e as Error).message}`); process.exit(1); });
