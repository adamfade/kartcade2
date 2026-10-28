// One track project: route on the map, then a 3D preview where scenery is placed, then save or download.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, Box, Download, FileUp, Flag, Loader2, MapPin, Route as RouteIcon, Save, Search, Trash2 } from 'lucide-react';
import { elevationSampler, geocode, racewaysNear, route as osrmRoute } from '../../../tools/trackbuilder/fetchers.ts';
import type { NetOptions, Place, Raceway } from '../../../tools/trackbuilder/fetchers.ts';
import type { HeightSampler, TilePixels } from '../../../tools/trackbuilder/elevation.ts';
import type { LatLon } from '../../../tools/trackbuilder/geo.ts';
import { parseTrace, rotateLoopTo } from '../../../tools/trackbuilder/trace.ts';
import { buildTrack } from '../../../tools/trackbuilder/pack.ts';
import type { BuildResult } from '../../../tools/trackbuilder/pack.ts';
import { buildElements, elementId } from '../../../tools/trackbuilder/elements.ts';
import type { TrackElement } from '../../../tools/trackbuilder/elements.ts';
import { useAuth } from '../../../contexts/AuthContext';
import { explainFirestoreError, saveProject } from './trackProjects';
import type { TrackProject } from './trackProjects';
import TrackPreview3D from './TrackPreview3D';
import type { TrackPick } from './TrackPreview3D';
import SceneryPanel from './SceneryPanel';
import type { Tool, ToolOptions } from './SceneryPanel';

type Mode = 'start' | 'via' | 'end';

/** Browser fetch with a small in-memory cache so re-builds don't re-download the same tiles. */
const cache = new Map<string, Promise<ArrayBuffer>>();
const politeFetch: NetOptions['fetch'] = async (url, init) => {
    const key = init?.method === 'POST' ? null : url;
    if (key && cache.has(key)) return new Response((await cache.get(key)!).slice(0));
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

const loopKm = (line: LatLon[]) => {
    let m = 0;
    for (let i = 0; i < line.length; i++) {
        const a = line[i], b = line[(i + 1) % line.length];
        const k = Math.cos((a.lat * Math.PI) / 180);
        m += Math.hypot((b.lat - a.lat) * 111_195, (b.lon - a.lon) * 111_195 * k);
    }
    return m / 1000;
};

const TrackEditor: React.FC<{ initial: TrackProject }> = ({ initial }) => {
    const { currentUser } = useAuth();
    const navigate = useNavigate();
    const mapEl = useRef<HTMLDivElement>(null);
    const map = useRef<L.Map | null>(null);
    const layer = useRef<L.LayerGroup | null>(null);
    const aerial = useRef<L.TileLayer | null>(null);

    const kind = initial.kind;
    const [projectId, setProjectId] = useState(initial.id);
    const [name, setName] = useState(initial.name);
    const [start, setStart] = useState<LatLon | null>(initial.pins[0] ?? null);
    const [vias, setVias] = useState<LatLon[]>(initial.pins.slice(1, -1));
    const [end, setEnd] = useState<LatLon | null>(initial.pins.length > 1 ? initial.pins[initial.pins.length - 1] : null);
    const [loop, setLoop] = useState<LatLon[]>(initial.loop);
    const [loopSource, setLoopSource] = useState(initial.source ?? (initial.loop.length ? 'saved' : ''));
    const [line, setLine] = useState<LatLon[] | null>(initial.line);
    const [width, setWidth] = useState(initial.width ? String(initial.width) : '');
    const [walls, setWalls] = useState(initial.walls);
    const [flip, setFlip] = useState(initial.flipStart);
    const [reverse, setReverse] = useState(initial.reverse);
    const [gridSlots, setGridSlots] = useState(String(initial.gridSlots));
    const [elements, setElementsRaw] = useState<TrackElement[]>(initial.elements);
    const [dirty, setDirty] = useState(!initial.id);
    const [savedAt, setSavedAt] = useState<Date | null>(null);

    const [mode, setMode] = useState<Mode>('start');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Place[]>([]);
    const [raceways, setRaceways] = useState<Raceway[]>([]);
    const [pickStart, setPickStart] = useState(false);
    const [routePreview, setRoutePreview] = useState<{ line: LatLon[]; km: number } | null>(null);
    const [showAerial, setShowAerial] = useState(false);
    const [busy, setBusy] = useState<'' | 'preview' | 'download' | 'save'>('');
    const [log, setLog] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    const [base, setBase] = useState<BuildResult | null>(null);
    const sampler = useRef<{ key: string; fn: HeightSampler } | null>(null);
    const [tool, setToolRaw] = useState<Tool | null>(null);
    const [pendingFrom, setPendingFrom] = useState<number | null>(null);
    const [toolOpts, setToolOpts] = useState<ToolOptions>({ side: 'both', density: 6, signStyle: 'kartcade', signText: '', bannerText: 'START' });
    const [goTo, setGoTo] = useState<{ s: number; nonce: number } | null>(null);

    const pins = useMemo(() => (start && end ? [start, ...vias, end] : null), [start, vias, end]);
    const net: NetOptions = useMemo(() => ({ fetch: politeFetch, log: (m) => setLog((l) => [...l, m]) }), []);
    const touch = () => setDirty(true);
    const setElements = (e: TrackElement[]) => { setElementsRaw(e); touch(); };
    const setTool = (t: Tool | null) => { setToolRaw(t); setPendingFrom(null); };

    // Route changes invalidate the built centreline (and with it the preview).
    const routeChanged = useCallback(() => { setLine(null); setBase(null); setToolRaw(null); setPendingFrom(null); touch(); }, []);

    // ---- map
    useEffect(() => {
        if (!mapEl.current || map.current) return;
        const pts = kind === 'road' ? initial.pins : initial.loop;
        const m = L.map(mapEl.current, { zoomControl: true }).setView(pts[0] ? [pts[0].lat, pts[0].lon] : [45.326, -122.672], 14);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(m);
        aerial.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19, attribution: 'Imagery &copy; Esri (map view only; not used in the track)',
        });
        layer.current = L.layerGroup().addTo(m);
        map.current = m;
        if (pts.length > 1) m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon] as [number, number])), { padding: [30, 30] });
        return () => { m.remove(); map.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const m = map.current, a = aerial.current;
        if (!m || !a) return;
        if (showAerial) a.addTo(m); else a.remove();
    }, [showAerial]);

    useEffect(() => {
        const m = map.current;
        if (!m) return;
        const onClick = (e: L.LeafletMouseEvent) => {
            const p = { lat: e.latlng.lat, lon: e.latlng.lng };
            if (kind === 'circuit') {
                if (pickStart) { setLoop((l) => (l.length >= 3 ? rotateLoopTo(l, p) : l)); setPickStart(false); }
                else { setLoop((l) => [...l, p]); setLoopSource((s) => s || 'drawn on the map'); }
                routeChanged();
                return;
            }
            if (mode === 'start') { setStart(p); setMode(end ? 'via' : 'end'); }
            else if (mode === 'end') { setEnd(p); setMode('via'); }
            else setVias((v) => [...v, p]);
            routeChanged();
        };
        m.on('click', onClick);
        return () => { m.off('click', onClick); };
    }, [mode, end, kind, pickStart, routeChanged]);

    // OSRM preview of the road whenever the pins change (uses the saved line until then).
    useEffect(() => {
        if (kind !== 'road' || !pins) { setRoutePreview(null); return; }
        if (line) { setRoutePreview({ line, km: 0 }); return; }
        let cancelled = false;
        const t = setTimeout(() => {
            osrmRoute({ fetch: politeFetch }, pins)
                .then((r) => { if (!cancelled) { setRoutePreview({ line: r.line, km: r.distanceM / 1000 }); setError(null); } })
                .catch((e) => { if (!cancelled) setError(`Couldn't route between the pins: ${e.message}`); });
        }, 400);
        return () => { cancelled = true; clearTimeout(t); };
    }, [pins, kind, line]);

    useEffect(() => {
        const g = layer.current;
        if (!g) return;
        g.clearLayers();
        const dot = (p: LatLon, color: string, label: string) =>
            L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip(label).addTo(g);
        if (kind === 'circuit') {
            raceways.forEach((r) => L.polyline(r.line.map((p) => [p.lat, p.lon] as [number, number]), { color: '#F5B700', weight: 3, opacity: 0.5, dashArray: '6 6' }).bindTooltip(r.name).addTo(g));
            if (loop.length >= 2) L.polygon(loop.map((p) => [p.lat, p.lon] as [number, number]), { color: '#D42428', weight: 5, opacity: 0.85, fill: false }).addTo(g);
            if (loop.length && loop.length <= 60) loop.slice(1).forEach((p, i) => L.circleMarker([p.lat, p.lon], { radius: 4, color: '#fff', weight: 1, fillColor: '#F5B700', fillOpacity: 1 }).bindTooltip(`Point ${i + 2}`).addTo(g));
            if (loop.length) dot(loop[0], '#2D9E49', 'Start / finish line');
            return;
        }
        if (routePreview) L.polyline(routePreview.line.map((p) => [p.lat, p.lon] as [number, number]), { color: '#D42428', weight: 5, opacity: 0.85 }).addTo(g);
        if (start) dot(start, '#2D9E49', 'Start');
        vias.forEach((v, i) => dot(v, '#F5B700', `Via ${i + 1}`));
        if (end) dot(end, '#D42428', 'Finish');
    }, [start, vias, end, routePreview, kind, loop, raceways]);

    // ---- map tools
    const runSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;
        try { setResults(await geocode({ fetch: politeFetch }, query.trim())); } catch (err) { setError(`Search failed: ${(err as Error).message}`); }
    };
    const findRaceways = async () => {
        const m = map.current; if (!m) return;
        setError(null); setRaceways([]);
        const c = m.getCenter();
        try {
            const found = await racewaysNear({ fetch: politeFetch }, { lat: c.lat, lon: c.lng });
            if (!found.length) { setError('No OpenStreetMap raceway within 600 m of the map centre. Draw the loop or load a trace file.'); return; }
            setRaceways(found);
        } catch (e) { setError(`Raceway search failed: ${(e as Error).message}`); }
    };
    const pickRaceway = (r: Raceway) => {
        setLoop(rotateLoopTo(r.line, r.line[0]));
        setLoopSource(`OpenStreetMap: ${r.name}${r.closed ? '' : ' (not a closed way; check the join)'}`);
        if (r.width && !width) setWidth(String(r.width));
        if (name === 'New circuit') setName(r.name);
        setRaceways([]); routeChanged();
        map.current?.fitBounds(L.latLngBounds(r.line.map((p) => [p.lat, p.lon] as [number, number])), { padding: [30, 30] });
    };
    const loadTrace = async (file: File) => {
        setError(null);
        try {
            const t = parseTrace(await file.text(), file.name);
            setLoop(rotateLoopTo(t.line, t.line[0]));
            setLoopSource(`${file.name} (${t.format.toUpperCase()}, ${t.line.length} points)`);
            if (t.name && name === 'New circuit') setName(t.name);
            routeChanged();
            map.current?.fitBounds(L.latLngBounds(t.line.map((p) => [p.lat, p.lon] as [number, number])), { padding: [30, 30] });
        } catch (e) { setError(`Couldn't read ${file.name}: ${(e as Error).message}`); }
    };

    // ---- building
    const widthM = () => parseFloat(width) || (kind === 'circuit' ? 8 : 6.5);
    const buildInputs = async (): Promise<{ polyline: LatLon[]; fn: HeightSampler }> => {
        let polyline = line;
        if (!polyline) {
            if (kind === 'road') {
                if (!pins) throw new Error('Set a start and a finish');
                net.log?.('Routing along the road (OSRM)');
                polyline = (await osrmRoute(net, pins)).line;
            } else {
                if (loop.length < 3) throw new Error('Add the circuit loop first');
                polyline = loop;
            }
            setLine(polyline);
        }
        const key = `${polyline.length}:${polyline[0].lat},${polyline[0].lon}:${polyline[polyline.length - 1].lat}`;
        if (sampler.current?.key !== key) sampler.current = { key, fn: await elevationSampler(net, polyline, decodeTileInBrowser) };
        return { polyline, fn: sampler.current.fn };
    };
    const buildWith = (polyline: LatLon[], fn: HeightSampler, withElements: boolean) => buildTrack({
        name: name.trim() || 'Track', polyline, heightSampler: fn, width: widthM(), walls,
        flipStart: flip, circuit: kind === 'circuit', reverse, gridSlots: parseInt(gridSlots, 10) || 12,
        city: kind === 'circuit' ? 'Oregon' : 'West Linn', elements: withElements ? elements : [], log: (m) => setLog((l) => [...l, m]),
    });

    const buildPreview = async () => {
        setBusy('preview'); setLog([]); setError(null);
        try {
            const { polyline, fn } = await buildInputs();
            await new Promise((r) => setTimeout(r, 0));
            setBase(buildWith(polyline, fn, false));
        } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
    };

    // Rebuild the base when options that change its shape change (keeps the preview honest).
    const optsKey = `${width}|${walls}|${flip}|${reverse}|${gridSlots}`;
    const lastOpts = useRef(optsKey);
    useEffect(() => {
        if (lastOpts.current === optsKey) return;
        lastOpts.current = optsKey;
        if (base && line && sampler.current) setBase(buildWith(line, sampler.current.fn, false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [optsKey]);

    // Open a saved project with a built line straight into the preview.
    useEffect(() => { if (initial.line) buildPreview(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const scenery = useMemo(() => (base ? buildElements(base.centerline, base.geometry, elements) : null), [base, elements]);

    const download = async () => {
        setBusy('download'); setLog([]); setError(null);
        try {
            const { polyline, fn } = await buildInputs();
            await new Promise((r) => setTimeout(r, 0));
            const res = buildWith(polyline, fn, true);
            const url = URL.createObjectURL(new Blob([res.zip], { type: 'application/zip' }));
            const a = document.createElement('a');
            a.href = url; a.download = `${res.id}.zip`; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
            setLog((l) => [...l, `Downloaded ${res.id}.zip`]);
        } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
    };

    const save = async () => {
        setBusy('save'); setError(null);
        try {
            const id = await saveProject({
                id: projectId, name: name.trim() || 'Untitled track', kind,
                pins: pins ?? [], loop, line, width: parseFloat(width) || null, walls, flipStart: flip, reverse,
                gridSlots: parseInt(gridSlots, 10) || 12, elements, source: loopSource || undefined,
                stats: base ? { lengthM: base.stats.lengthM, climbM: base.stats.climbM } : (initial.stats ?? null),
            }, currentUser?.email);
            if (!projectId) { setProjectId(id); navigate(`/admin/track-builder?id=${id}`, { replace: true }); }
            setDirty(false); setSavedAt(new Date());
        } catch (e) { setError(explainFirestoreError(e)); } finally { setBusy(''); }
    };

    // ---- scenery placement from 3D picks
    const onPick = (p: TrackPick) => {
        if (!tool || !base) return;
        const id = elementId();
        if (tool === 'guardrail' || tool === 'trees') {
            if (pendingFrom == null) { setPendingFrom(p.s); return; }
            let from = pendingFrom, to = p.s;
            if (!base.centerline.closed && to < from) [from, to] = [to, from];
            if (Math.abs(to - from) < 2) { setPendingFrom(null); return; }
            setElements([...elements, tool === 'guardrail'
                ? { id, type: 'guardrail', from, to, side: toolOpts.side }
                : { id, type: 'trees', from, to, side: toolOpts.side, density: toolOpts.density }]);
            setPendingFrom(null);
        } else if (tool === 'tree') setElements([...elements, { id, type: 'tree', at: p.s, offset: p.lateral === 0 ? 8 : p.lateral }]);
        else if (tool === 'sign') setElements([...elements, { id, type: 'sign', at: p.s, side: p.lateral < 0 ? 'left' : 'right', style: toolOpts.signStyle, text: toolOpts.signStyle === 'kartcade' ? '' : toolOpts.signText || (toolOpts.signStyle === 'distance' ? '100' : 'KARTCADE') }]);
        else if (tool === 'banner') setElements([...elements, { id, type: 'banner', at: p.s, text: toolOpts.bannerText || 'START' }]);
    };

    const onQuick = (what: 'banners' | 'trees' | 'boards') => {
        if (!base) return;
        const len = base.centerline.length, circuit = base.centerline.closed;
        const finish = circuit ? len : len - 25;
        const add: TrackElement[] = [];
        if (what === 'banners') {
            if (circuit) add.push({ id: elementId(), type: 'banner', at: 0, text: 'START FINISH' });
            else add.push({ id: elementId(), type: 'banner', at: 25, text: 'START' }, { id: elementId(), type: 'banner', at: len - 25, text: 'FINISH' });
        } else if (what === 'trees') add.push({ id: elementId(), type: 'trees', from: 0, to: circuit ? len - 1 : len, side: 'both', density: 5 });
        else for (const d of [300, 200, 100]) if (finish - d > 0) add.push({ id: elementId(), type: 'sign', at: finish - d, side: 'right', style: 'distance', text: String(d) });
        setElements([...elements, ...add]);
    };

    const modeBtn = (m: Mode, label: string) => (
        <button type="button" onClick={() => setMode(m)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${mode === m ? 'bg-[#D42428] text-white' : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'}`}>{label}</button>
    );
    const canBuild = kind === 'circuit' ? loop.length >= 3 : !!pins;
    const field = 'mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2D9E49]';

    return (
        <div className="max-w-7xl mx-auto">
            <Link to="/admin/track-builder" className="inline-flex items-center gap-2 text-white/50 hover:text-white text-sm mb-4"><ArrowLeft className="w-4 h-4" /> All tracks</Link>
            <div className="flex flex-wrap items-center gap-3 mb-5">
                <input value={name} onChange={(e) => { setName(e.target.value); touch(); }} className="font-display text-2xl md:text-3xl font-bold uppercase bg-transparent border-b border-transparent hover:border-white/20 focus:border-[#2D9E49] focus:outline-none flex-1 min-w-[12rem]" />
                <span className="text-xs uppercase tracking-wider text-white/40">{kind === 'road' ? 'Road · A to B' : 'Circuit · laps'}</span>
                <button type="button" onClick={save} disabled={!!busy} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 flex items-center gap-2 text-sm">
                    {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {dirty ? 'Save' : savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Saved'}
                </button>
                <button type="button" onClick={download} disabled={!canBuild || !!busy} className="px-4 py-2 rounded-lg bg-[#2D9E49] hover:bg-[#248a3f] disabled:opacity-40 font-bold uppercase tracking-wider text-sm flex items-center gap-2">
                    {busy === 'download' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download zip
                </button>
            </div>
            {error && <p className="mb-4 text-sm text-[#ff6b6b]">{error}</p>}

            {/* Step 1: route */}
            <div className="grid lg:grid-cols-[1fr_320px] gap-6 mb-8">
                <div>
                    {kind === 'road' && (
                        <form onSubmit={runSearch} className="flex gap-2 mb-3">
                            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a road or town" className="flex-1 bg-[#141414] border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:border-[#2D9E49]" />
                            <button className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 flex items-center gap-2"><Search className="w-4 h-4" /> Search</button>
                        </form>
                    )}
                    {results.length > 0 && (
                        <ul className="mb-3 bg-[#141414] border border-white/10 rounded-lg divide-y divide-white/5 text-sm">
                            {results.map((r) => (
                                <li key={`${r.lat},${r.lon}`}><button type="button" className="w-full text-left px-4 py-2 hover:bg-white/5" onClick={() => { map.current?.setView([r.lat, r.lon], 15); setResults([]); }}>{r.name}</button></li>
                            ))}
                        </ul>
                    )}
                    {kind === 'circuit' ? (
                        <div className="mb-3 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" onClick={findRaceways} className="px-3 py-2 rounded-lg text-sm bg-white/10 hover:bg-white/20 flex items-center gap-1"><Search className="w-4 h-4" /> Find raceway at map centre</button>
                                <label className="px-3 py-2 rounded-lg text-sm bg-white/10 hover:bg-white/20 flex items-center gap-1 cursor-pointer"><FileUp className="w-4 h-4" /> Load GPX / KML / GeoJSON
                                    <input type="file" accept=".gpx,.kml,.geojson,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadTrace(f); e.target.value = ''; }} />
                                </label>
                                <button type="button" disabled={loop.length < 3} onClick={() => setPickStart((v) => !v)} className={`px-3 py-2 rounded-lg text-sm flex items-center gap-1 disabled:opacity-40 ${pickStart ? 'bg-[#2D9E49] text-white' : 'bg-white/5 text-white/60 hover:text-white'}`}><Flag className="w-4 h-4" /> {pickStart ? 'Click the start/finish line' : 'Set start/finish'}</button>
                                <button type="button" onClick={() => { setLoop([]); setLoopSource(''); setRaceways([]); routeChanged(); }} className="ml-auto px-3 py-2 rounded-lg text-sm bg-white/5 text-white/60 hover:text-white flex items-center gap-1"><Trash2 className="w-4 h-4" /> Clear loop</button>
                            </div>
                            {raceways.length > 0 && (
                                <ul className="bg-[#141414] border border-white/10 rounded-lg divide-y divide-white/5 text-sm">
                                    {raceways.map((r) => (
                                        <li key={r.id}><button type="button" className="w-full text-left px-4 py-2 hover:bg-white/5" onClick={() => pickRaceway(r)}>
                                            {r.name} <span className="text-white/40">· {(r.lengthM / 1000).toFixed(2)} km{r.closed ? ' loop' : ' (open way)'}{r.width ? ` · ${r.width} m wide` : ''}</span>
                                        </button></li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                            <span className="text-white/40 text-sm mr-1">Click the map to set:</span>
                            {modeBtn('start', 'Start')}{modeBtn('via', 'Via point')}{modeBtn('end', 'Finish')}
                            <button type="button" onClick={() => { setStart(null); setEnd(null); setVias([]); setMode('start'); routeChanged(); }} className="ml-auto px-3 py-2 rounded-lg text-sm bg-white/5 text-white/60 hover:text-white flex items-center gap-1"><Trash2 className="w-4 h-4" /> Clear pins</button>
                        </div>
                    )}
                    <div ref={mapEl} className="h-[380px] rounded-xl overflow-hidden border border-white/10" />
                    <div className="flex flex-wrap gap-4 mt-3 text-sm text-white/60">
                        <span className="flex items-center gap-1"><RouteIcon className="w-4 h-4 text-[#D42428]" /> {kind === 'circuit'
                            ? (loop.length >= 3 ? `${loopKm(loop).toFixed(2)} km lap · ${loopSource}` : 'Add the circuit loop')
                            : line ? 'Route saved with the track' : routePreview ? `${routePreview.km.toFixed(2)} km route` : pins ? 'Routing…' : 'Set a start and a finish'}</span>
                        <label className="flex items-center gap-2 ml-auto"><input type="checkbox" checked={showAerial} onChange={(e) => setShowAerial(e.target.checked)} /> Aerial view (map only)</label>
                    </div>
                </div>

                <div className="bg-[#141414] rounded-xl border border-white/10 p-5 space-y-4 self-start">
                    <label className="block text-sm"><span className="text-white/60">{kind === 'circuit' ? 'Track width in metres (blank = 8)' : 'Road width in metres (blank = 6.5)'}</span>
                        <input value={width} onChange={(e) => { setWidth(e.target.value); touch(); }} inputMode="decimal" placeholder="auto" className={field} />
                    </label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={walls} onChange={(e) => { setWalls(e.target.checked); touch(); }} /> Walls at the edge of the grass</label>
                    {kind === 'circuit' ? (<>
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reverse} onChange={(e) => { setReverse(e.target.checked); touch(); }} /> Drive the loop the other way round</label>
                        <label className="block text-sm"><span className="text-white/60">Grid slots / pit boxes</span>
                            <input value={gridSlots} onChange={(e) => { setGridSlots(e.target.value); touch(); }} inputMode="numeric" className={field} />
                        </label>
                    </>) : (<>
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flip} onChange={(e) => { setFlip(e.target.checked); touch(); }} /> Flip start direction (if cars spawn backwards)</label>
                        <div className="text-xs text-white/40 flex items-start gap-2"><MapPin className="w-4 h-4 flex-shrink-0" /> {vias.length} via pin{vias.length === 1 ? '' : 's'}. Via pins keep the route on the road you mean.</div>
                    </>)}
                    {!line && elements.length > 0 && <p className="text-xs text-[#F5B700]">The route changed. Scenery is placed by distance from the start, so check it in the preview.</p>}
                    <button type="button" disabled={!canBuild || !!busy} onClick={buildPreview} className="w-full py-3 rounded-lg bg-[#D42428] hover:bg-[#b91c1c] disabled:opacity-40 font-bold uppercase tracking-wider flex items-center justify-center gap-2">
                        {busy === 'preview' ? <><Loader2 className="w-4 h-4 animate-spin" /> Building…</> : <><Box className="w-4 h-4" /> {base ? 'Rebuild 3D preview' : 'Build 3D preview'}</>}
                    </button>
                    {log.length > 0 && <div className="bg-black/40 rounded-lg p-3 text-[11px] font-mono text-white/50 max-h-32 overflow-auto">{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
                    {base && (
                        <dl className="grid grid-cols-2 gap-2 text-sm">
                            <div><dt className="text-white/40">Length</dt><dd>{(base.stats.lengthM / 1000).toFixed(2)} km</dd></div>
                            <div><dt className="text-white/40">{kind === 'circuit' ? 'Climb per lap' : 'Climb'}</dt><dd>{base.stats.climbM} m</dd></div>
                            <div><dt className="text-white/40">Max grade</dt><dd>{base.stats.maxGradePct}%</dd></div>
                            <div><dt className="text-white/40">Width</dt><dd>{base.stats.widthM} m</dd></div>
                        </dl>
                    )}
                </div>
            </div>

            {/* Step 2: 3D preview and scenery */}
            {base && scenery && (
                <div className="grid lg:grid-cols-[1fr_340px] gap-6">
                    <TrackPreview3D build={base} scenery={scenery} picking={!!tool} marker={pendingFrom} onPick={onPick} goTo={goTo} className="h-[600px] rounded-xl overflow-hidden border border-white/10 bg-black" />
                    <SceneryPanel tool={tool} setTool={setTool} options={toolOpts} setOptions={setToolOpts} pendingFrom={pendingFrom}
                        elements={elements} setElements={setElements} lengthM={base.centerline.length} circuit={base.centerline.closed}
                        onView={(s) => setGoTo({ s: base.centerline.closed ? s - 30 : Math.max(0, s - 30), nonce: Date.now() })} onQuick={onQuick} />
                </div>
            )}
            <p className="mt-6 text-xs text-white/30">Road data © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles. Routing: OSRM. Raceway search: Overpass API. Map data is fetched from this browser.</p>
        </div>
    );
};

export default TrackEditor;
