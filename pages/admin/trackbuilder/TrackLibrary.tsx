// Saved tracks: open one, start a new road or circuit, or delete.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Flag, Layers, Loader2, Mountain, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { importLibrary, loadManifest } from './materialLibrary';
import type { LibraryManifest } from './materialLibrary';
import { LIBRARY_CATALOG } from '../../../tools/trackbuilder/materials.ts';
import { deleteProject, explainFirestoreError, listProjects } from './trackProjects';
import type { TrackProject } from './trackProjects';

const when = (p: TrackProject) => {
    const d = p.updatedAt?.toDate?.();
    return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
};

const TrackLibrary: React.FC = () => {
    const [items, setItems] = useState<TrackProject[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = () => listProjects().then(setItems).catch((e) => { setError(explainFirestoreError(e)); setItems([]); });
    useEffect(() => { load(); }, []);

    const remove = async (p: TrackProject) => {
        if (!p.id || !window.confirm(`Delete "${p.name}"? This can't be undone.`)) return;
        try { await deleteProject(p.id); setItems((l) => l?.filter((x) => x.id !== p.id) ?? null); } catch (e) { setError(explainFirestoreError(e)); }
    };

    return (
        <div className="max-w-5xl mx-auto">
            <Link to="/dashboard" className="inline-flex items-center gap-2 text-white/50 hover:text-white text-sm mb-4"><ArrowLeft className="w-4 h-4" /> Dashboard</Link>
            <h1 className="font-display text-3xl md:text-4xl font-bold uppercase mb-2">Track builder</h1>
            <p className="text-white/60 mb-6 max-w-2xl">Turn a real road or circuit into an Assetto Corsa track. Pick the route on the map, preview it in 3D, add guard rails, trees and signs, then download the zip for the rigs.</p>
            <div className="flex flex-wrap gap-3 mb-8">
                <Link to="/admin/track-builder?new=road" className="px-4 py-3 rounded-lg bg-[#D42428] hover:bg-[#b91c1c] font-bold uppercase tracking-wider text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> New road track</Link>
                <Link to="/admin/track-builder?new=circuit" className="px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20 font-bold uppercase tracking-wider text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> New circuit</Link>
            </div>
            {error && <p className="mb-4 text-sm text-[#ff6b6b]">{error}</p>}
            <MaterialLibraryCard />
            {items === null ? (
                <div className="text-white/50 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading saved tracks…</div>
            ) : items.length === 0 ? (
                <p className="text-white/40">No saved tracks yet. Start one above; it's saved when you press Save.</p>
            ) : (
                <ul className="grid sm:grid-cols-2 gap-3">
                    {items.map((p) => (
                        <li key={p.id} className="bg-[#141414] border border-white/10 rounded-xl hover:border-white/25 transition-colors">
                            <Link to={`/admin/track-builder?id=${p.id}`} className="block p-4">
                                <div className="flex items-start gap-3">
                                    {p.kind === 'circuit' ? <Flag className="w-5 h-5 text-[#F5B700] mt-0.5" /> : <Mountain className="w-5 h-5 text-[#2D9E49] mt-0.5" />}
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold truncate">{p.name}</div>
                                        <div className="text-xs text-white/50 mt-1">
                                            {p.kind === 'circuit' ? 'Circuit' : 'Road'}
                                            {p.stats ? ` · ${(p.stats.lengthM / 1000).toFixed(2)} km · ${p.stats.climbM} m climb` : ''}
                                            {` · ${p.elements?.length ?? 0} scenery item${p.elements?.length === 1 ? '' : 's'}`}
                                        </div>
                                        <div className="text-xs text-white/30 mt-1">{when(p)}{p.updatedBy ? ` · ${p.updatedBy}` : ''}</div>
                                    </div>
                                </div>
                            </Link>
                            <div className="px-4 pb-3 -mt-1 flex justify-end">
                                <button type="button" onClick={() => remove(p)} className="text-xs text-white/40 hover:text-[#ff6b6b] flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default TrackLibrary;

/** Status of the photo-scanned material library, with a one-time import from Poly Haven (CC0). */
const MaterialLibraryCard: React.FC = () => {
    const { currentUser } = useAuth();
    const [manifest, setManifest] = useState<LibraryManifest | null | undefined>(undefined);
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState<string[]>([]);
    const [err, setErr] = useState<string | null>(null);
    useEffect(() => { loadManifest().then(setManifest).catch((e) => { setManifest(null); setErr(explainFirestoreError(e)); }); }, []);
    const run = async () => {
        setBusy(true); setErr(null); setLog([]);
        try { setManifest(await importLibrary(currentUser?.email, (m) => setLog((l) => [...l, m]))); }
        catch (e) { setErr(explainFirestoreError(e).replace('Firestore', 'Firebase Storage').replace('trackProjects rule', 'trackbuilder storage rule')); }
        finally { setBusy(false); }
    };
    const count = Object.keys(LIBRARY_CATALOG).length;
    return (
        <div className="mb-8 bg-[#141414] border border-white/10 rounded-xl p-5">
            <div className="flex flex-wrap items-start gap-3">
                <Layers className="w-5 h-5 text-[#F5B700] mt-0.5" />
                <div className="flex-1 min-w-[16rem]">
                    <div className="font-bold">Photo-scanned materials</div>
                    <p className="text-sm text-white/50 mt-1">
                        {manifest === undefined ? 'Checking…'
                            : manifest ? `${Object.keys(manifest.entries).length} of ${count} materials imported ${new Date(manifest.created).toLocaleDateString()}${manifest.createdBy ? ` by ${manifest.createdBy}` : ''}. Every build uses them.`
                            : `Not imported yet. Tracks build with simple generated textures until you import the ${count} photo-scanned materials (about 2 minutes, once).`}
                    </p>
                    {manifest && (
                        <p className="text-xs text-white/30 mt-2">
                            {Object.values(manifest.entries).map((e) => e && <span key={e.role} className="mr-2"><a className="underline hover:text-white/60" href={e.source.url} target="_blank" rel="noreferrer">{e.label}</a>{e.source.author ? ` (${e.source.author})` : ''}</span>)}
                            · CC0 from Poly Haven
                        </p>
                    )}
                </div>
                <button type="button" disabled={busy} onClick={run} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 text-sm flex items-center gap-2">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {manifest ? 'Re-import' : 'Import materials'}
                </button>
            </div>
            {log.length > 0 && <div className="mt-3 bg-black/40 rounded-lg p-3 text-[11px] font-mono text-white/50 max-h-40 overflow-auto">{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
            {err && <p className="mt-3 text-sm text-[#ff6b6b]">{err}</p>}
        </div>
    );
};
