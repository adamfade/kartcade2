import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, Download, Loader2, MapPin, Mountain, Route as RouteIcon, Search, Trash2 } from 'lucide-react';
import { buildFromPins, geocode, route as osrmRoute } from '../../tools/trackbuilder/fetchers.ts';
import type { NetOptions, Place } from '../../tools/trackbuilder/fetchers.ts';
import type { TilePixels } from '../../tools/trackbuilder/elevation.ts';
import type { LatLon } from '../../tools/trackbuilder/geo.ts';

// Pete's Mountain Rd, West Linn: the first road this builder was proved on.
const DEFAULT_PINS: LatLon[] = [
    { lat: 45.3397, lon: -122.6545 },
    { lat: 45.33466, lon: -122.6769 },
    { lat: 45.32645, lon: -122.678 },
    { lat: 45.3064, lon: -122.6806 },
];

type Mode = 'start' | 'via' | 'end';

/** Browser fetch with a small in-memory cache so re-builds don't re-download the same tiles. */
const cache = new Map<string, Promise<ArrayBuffer>>();
const politeFetch: NetOptions['fetch'] = async (url, init) => {
    const key = init?.method === 'POST' ? null : url;
    if (key && cache.has(key)) {
        const buf = await cache.get(key)!;
        return new Response(buf.slice(0));
    }
    const p = fetch(url, init).then(async (r) => {
        if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
        return r.arrayBuffer();
    });
    if (key) cache.set(key, p);
    try {
        return new Response((await p).slice(0));
    } catch (e) {
        if (key) cache.delete(key);
        throw e;
    }
};

async function decodeTileInBrowser(png: Uint8Array): Promise<TilePixels> {
    const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    return { width: bmp.width, height: bmp.height, data: new Uint8Array(data.buffer.slice(0)), channels: 4 };
}

const TrackBuilderPage: React.FC = () => {
    const mapEl = useRef<HTMLDivElement>(null);
    const map = useRef<L.Map | null>(null);
    const layer = useRef<L.LayerGroup | null>(null);
    const aerial = useRef<L.TileLayer | null>(null);

    const [start, setStart] = useState<LatLon | null>(DEFAULT_PINS[0]);
    const [vias, setVias] = useState<LatLon[]>(DEFAULT_PINS.slice(1, -1));
    const [end, setEnd] = useState<LatLon | null>(DEFAULT_PINS[DEFAULT_PINS.length - 1]);
    const [mode, setMode] = useState<Mode>('start');
    const [name, setName] = useState("Pete's Mountain Rd");
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Place[]>([]);
    const [routeLine, setRouteLine] = useState<LatLon[] | null>(null);
    const [routeKm, setRouteKm] = useState<number | null>(null);
    const [width, setWidth] = useState('');
    const [walls, setWalls] = useState(true);
    const [flip, setFlip] = useState(false);
    const [showAerial, setShowAerial] = useState(false);
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ url: string; file: string; stats: Record<string, number>; widthSource: string } | null>(null);

    const pins = useMemo(() => (start && end ? [start, ...vias, end] : null), [start, vias, end]);
    const net: NetOptions = useMemo(() => ({ fetch: politeFetch, log: (m) => setLog((l) => [...l, m]) }), []);

    // Map setup.
    useEffect(() => {
        if (!mapEl.current || map.current) return;
        const m = L.map(mapEl.current, { zoomControl: true }).setView([45.326, -122.672], 14);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(m);
        aerial.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19, attribution: 'Imagery &copy; Esri (map view only; not used in the track)',
        });
        layer.current = L.layerGroup().addTo(m);
        map.current = m;
        return () => { m.remove(); map.current = null; };
    }, []);

    useEffect(() => {
        const m = map.current, a = aerial.current;
        if (!m || !a) return;
        if (showAerial) a.addTo(m); else a.remove();
    }, [showAerial]);

    // Click to place pins.
    useEffect(() => {
        const m = map.current;
        if (!m) return;
        const onClick = (e: L.LeafletMouseEvent) => {
            const p = { lat: e.latlng.lat, lon: e.latlng.lng };
            setResult(null);
            if (mode === 'start') { setStart(p); setMode(end ? 'via' : 'end'); }
            else if (mode === 'end') { setEnd(p); setMode('via'); }
            else setVias((v) => [...v, p]);
        };
        m.on('click', onClick);
        return () => { m.off('click', onClick); };
    }, [mode, end]);

    // Route preview whenever the pins change.
    useEffect(() => {
        let cancelled = false;
        setRouteLine(null); setRouteKm(null);
        if (!pins) return;
        const t = setTimeout(() => {
            osrmRoute({ fetch: politeFetch }, pins)
                .then((r) => { if (!cancelled) { setRouteLine(r.line); setRouteKm(r.distanceM / 1000); setError(null); } })
                .catch((e) => { if (!cancelled) setError(`Couldn't route between the pins: ${e.message}`); });
        }, 400);
        return () => { cancelled = true; clearTimeout(t); };
    }, [pins]);

    // Draw pins and route.
    useEffect(() => {
        const g = layer.current;
        if (!g) return;
        g.clearLayers();
        const dot = (p: LatLon, color: string, label: string) =>
            L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip(label).addTo(g);
        if (routeLine) L.polyline(routeLine.map((p) => [p.lat, p.lon] as [number, number]), { color: '#D42428', weight: 5, opacity: 0.85 }).addTo(g);
        if (start) dot(start, '#2D9E49', 'Start');
        vias.forEach((v, i) => dot(v, '#F5B700', `Via ${i + 1}`));
        if (end) dot(end, '#D42428', 'Finish');
    }, [start, vias, end, routeLine]);

    const runSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;
        try {
            setResults(await geocode({ fetch: politeFetch }, query.trim()));
        } catch (err) {
            setError(`Search failed: ${(err as Error).message}`);
        }
    };

    const build = async () => {
        if (!pins) return;
        setBusy(true); setLog([]); setError(null);
        if (result) URL.revokeObjectURL(result.url);
        setResult(null);
        try {
            const res = await buildFromPins(net, decodeTileInBrowser, {
                name: name.trim() || 'Real Road',
                pins,
                widthOverride: parseFloat(width) || undefined,
                walls, flipStart: flip, city: 'West Linn',
            });
            const url = URL.createObjectURL(new Blob([res.zip], { type: 'application/zip' }));
            setResult({ url, file: `${res.id}.zip`, stats: res.stats as unknown as Record<string, number>, widthSource: res.widthSource });
            setLog((l) => [...l, 'Done']);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const modeBtn = (m: Mode, label: string) => (
        <button
            type="button"
            onClick={() => setMode(m)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${mode === m ? 'bg-[#D42428] text-white' : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'}`}
        >
            {label}
        </button>
    );

    return (
        <div className="min-h-screen bg-[#0A0A0A] text-white pt-24 pb-16 px-4">
            <div className="max-w-6xl mx-auto">
                <Link to="/dashboard" className="inline-flex items-center gap-2 text-white/50 hover:text-white text-sm mb-4"><ArrowLeft className="w-4 h-4" /> Dashboard</Link>
                <h1 className="font-display text-3xl md:text-4xl font-bold uppercase mb-2">Track builder</h1>
                <p className="text-white/60 mb-6 max-w-2xl">Turn a real road into an Assetto Corsa point-to-point track. Drop a start and a finish on the road, add via pins if the route wanders, then build and download.</p>

                <div className="grid lg:grid-cols-[1fr_340px] gap-6">
                    <div>
                        <form onSubmit={runSearch} className="flex gap-2 mb-3">
                            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a road or town" className="flex-1 bg-[#141414] border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:border-[#2D9E49]" />
                            <button className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 flex items-center gap-2"><Search className="w-4 h-4" /> Search</button>
                        </form>
                        {results.length > 0 && (
                            <ul className="mb-3 bg-[#141414] border border-white/10 rounded-lg divide-y divide-white/5 text-sm">
                                {results.map((r) => (
                                    <li key={`${r.lat},${r.lon}`}>
                                        <button type="button" className="w-full text-left px-4 py-2 hover:bg-white/5" onClick={() => { map.current?.setView([r.lat, r.lon], 15); setResults([]); }}>{r.name}</button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                            <span className="text-white/40 text-sm mr-1">Click the map to set:</span>
                            {modeBtn('start', 'Start')}{modeBtn('via', 'Via point')}{modeBtn('end', 'Finish')}
                            <button type="button" onClick={() => { setStart(null); setEnd(null); setVias([]); setMode('start'); setResult(null); }} className="ml-auto px-3 py-2 rounded-lg text-sm bg-white/5 text-white/60 hover:text-white flex items-center gap-1"><Trash2 className="w-4 h-4" /> Clear pins</button>
                        </div>
                        <div ref={mapEl} className="h-[480px] rounded-xl overflow-hidden border border-white/10" />
                        <div className="flex flex-wrap gap-4 mt-3 text-sm text-white/60">
                            <span className="flex items-center gap-1"><RouteIcon className="w-4 h-4 text-[#D42428]" /> {routeKm != null ? `${routeKm.toFixed(2)} km route` : pins ? 'Routing…' : 'Set a start and a finish'}</span>
                            <label className="flex items-center gap-2 ml-auto"><input type="checkbox" checked={showAerial} onChange={(e) => setShowAerial(e.target.checked)} /> Aerial view (map only)</label>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="bg-[#141414] rounded-xl border border-white/10 p-5 space-y-4">
                            <label className="block text-sm">
                                <span className="text-white/60">Track name</span>
                                <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2D9E49]" />
                            </label>
                            <label className="block text-sm">
                                <span className="text-white/60">Road width in metres (blank = from OpenStreetMap, else 6.5)</span>
                                <input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="decimal" placeholder="auto" className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2D9E49]" />
                            </label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={walls} onChange={(e) => setWalls(e.target.checked)} /> Walls at the edge of the grass</label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} /> Flip start direction (if cars spawn backwards)</label>
                            <div className="text-xs text-white/40 flex items-start gap-2"><MapPin className="w-4 h-4 flex-shrink-0" /> {vias.length} via pin{vias.length === 1 ? '' : 's'}. Via pins keep the route on the road you mean.</div>
                            <button type="button" disabled={!pins || busy} onClick={build} className="w-full py-3 rounded-lg bg-[#D42428] hover:bg-[#b91c1c] disabled:opacity-40 font-bold uppercase tracking-wider flex items-center justify-center gap-2">
                                {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Building…</> : <><Mountain className="w-4 h-4" /> Build track</>}
                            </button>
                            {error && <p className="text-sm text-[#ff6b6b]">{error}</p>}
                        </div>

                        {log.length > 0 && (
                            <div className="bg-[#141414] rounded-xl border border-white/10 p-4 text-xs font-mono text-white/60 max-h-56 overflow-auto">
                                {log.map((l, i) => <div key={i}>{l}</div>)}
                            </div>
                        )}

                        {result && (
                            <div className="bg-[#141414] rounded-xl border border-[#2D9E49]/40 p-5 space-y-3">
                                <dl className="grid grid-cols-2 gap-2 text-sm">
                                    <div><dt className="text-white/40">Length</dt><dd>{(result.stats.lengthM / 1000).toFixed(2)} km</dd></div>
                                    <div><dt className="text-white/40">Climb</dt><dd>{result.stats.climbM} m</dd></div>
                                    <div><dt className="text-white/40">Max grade</dt><dd>{result.stats.maxGradePct}%</dd></div>
                                    <div><dt className="text-white/40">Width</dt><dd>{result.stats.widthM} m</dd></div>
                                </dl>
                                <p className="text-xs text-white/40">Width: {result.widthSource}.</p>
                                <a href={result.url} download={result.file} className="w-full py-3 rounded-lg bg-[#2D9E49] hover:bg-[#248a3f] font-bold uppercase tracking-wider flex items-center justify-center gap-2"><Download className="w-4 h-4" /> Download {result.file}</a>
                                <ol className="text-sm text-white/60 list-decimal pl-5 space-y-1">
                                    <li>Unzip into <code className="text-white/80">assettocorsa\content\tracks</code> on the rig, so the track folder sits directly inside <code>tracks</code>.</li>
                                    <li>Open Content Manager, pick the track under Drive, and start a Practice session.</li>
                                    <li>Drive from the start to the finish. Timing starts and stops at the first and last 25 m.</li>
                                </ol>
                            </div>
                        )}
                        <p className="text-xs text-white/30">Road data © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles. Routing: OSRM. Map data is fetched from your browser.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TrackBuilderPage;
