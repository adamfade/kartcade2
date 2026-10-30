// Review: compare the build with the real road and keep a list of what to fix. Notes are pinned to spots in
// the 3D preview (click to drop one), each with a view-from-the-road button and a Street View button that opens
// Google Street View at the same spot facing the same thing (a reference to compare against; Street View
// imagery is never copied into the track). Facade photos: the driver's own photo of a landmark, put on the
// building wall clicked in the preview.

import React, { useRef, useState } from 'react';
import { Camera, Check, ClipboardCopy, Eye, ImagePlus, MapPinned, MessageSquarePlus, Store, Trash2, X } from 'lucide-react';

export interface ReviewNote {
    id: string;
    /** Distance along the route and the clicked point (AC space: x east, y up, z north). */
    s: number;
    point: { x: number; y: number; z: number };
    text: string;
    done?: boolean;
}

export interface FacadePhoto {
    id: string;
    s: number;
    point: { x: number; y: number; z: number };
    at: { lat: number; lon: number };
    /** The photo, downscaled to 384 px, as a JPEG data URL (kept with the project). */
    dataUrl: string;
    label?: string;
}

/** A business OpenStreetMap lacks, named on the building it's in (gets a storefront and sign). */
export interface NamedBusiness {
    id: string;
    s: number;
    point: { x: number; y: number; z: number };
    at: { lat: number; lon: number };
    name: string;
    /** Key into BUSINESS_KINDS. */
    kind: string;
}

/** Business types and the OpenStreetMap tags the builder reads (the sign's small line and the storefront). */
export const BUSINESS_KINDS: Record<string, { label: string; tags: Record<string, string> }> = {
    arcade: { label: 'Arcade / entertainment', tags: { leisure: 'amusement_arcade' } },
    shop: { label: 'Shop', tags: { shop: 'yes' } },
    restaurant: { label: 'Restaurant', tags: { amenity: 'restaurant' } },
    cafe: { label: 'Cafe', tags: { amenity: 'cafe' } },
    bar: { label: 'Bar', tags: { amenity: 'bar' } },
    gym: { label: 'Gym', tags: { leisure: 'fitness_centre' } },
    salon: { label: 'Salon', tags: { shop: 'hairdresser' } },
    dentist: { label: 'Dentist', tags: { amenity: 'dentist' } },
    office: { label: 'Office', tags: { office: 'yes' } },
};

export type ReviewTool = 'note' | 'photo' | 'business';

interface Props {
    tool: ReviewTool | null;
    setTool: (t: ReviewTool | null) => void;
    notes: ReviewNote[];
    setNotes: (n: ReviewNote[]) => void;
    photos: FacadePhoto[];
    setPhotos: (p: FacadePhoto[]) => void;
    /** A facade spot was clicked and is waiting for its photo. */
    pendingPhoto: Omit<FacadePhoto, 'dataUrl' | 'id'> | null;
    /** A straightened frame from the drive video, waiting for its wall to be clicked. */
    pendingFrame?: string | null;
    businesses: NamedBusiness[];
    setBusinesses: (b: NamedBusiness[]) => void;
    /** A wall was clicked with the business tool and is waiting for its name. */
    pendingBusiness: Omit<NamedBusiness, 'id' | 'name' | 'kind'> | null;
    cancelBusiness: () => void;
    onPhotoChosen: (file: File) => void;
    cancelPhoto: () => void;
    activeId: string | null;
    setActiveId: (id: string | null) => void;
    onView: (s: number, look: { x: number; y: number; z: number }) => void;
    onStreetView: (s: number, look: { x: number; y: number; z: number }) => void;
}

export const MAX_FACADE_PHOTOS = 6;

const m = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`);
const input = 'w-full bg-black/40 border border-white/10 rounded-md px-2 py-1 text-sm focus:outline-none focus:border-[#2D9E49]';

/** Downscale a photo to fit 384 x 384 and return a JPEG data URL (kept small: the project document is capped at 1 MB). */
export async function photoToDataUrl(file: File): Promise<string> {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 384 / Math.max(bmp.width, bmp.height)); // ~30-50 KB each, so six fit in the project
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
}

/** A stored photo as a 512 x 512 RGBA image for the builder (stretched to the wall it covers). */
export async function dataUrlToRgba(url: string): Promise<{ width: number; height: number; data: Uint8Array }> {
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const c = new OffscreenCanvas(512, 512);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, 512, 512);
    return { width: 512, height: 512, data: new Uint8Array(ctx.getImageData(0, 0, 512, 512).data.buffer.slice(0)) };
}

const ReviewPanel: React.FC<Props> = ({ tool, setTool, notes, setNotes, photos, setPhotos, pendingPhoto, pendingFrame, businesses, setBusinesses, pendingBusiness, cancelBusiness, onPhotoChosen, cancelPhoto, activeId, setActiveId, onView, onStreetView }) => {
    const file = useRef<HTMLInputElement>(null);
    const open = notes.filter((n) => !n.done).length;
    const copy = () => {
        const text = notes.map((n) => `${n.done ? '[x]' : '[ ]'} ${m(n.s)}: ${n.text || '(no text)'}`).join('\n');
        navigator.clipboard?.writeText(text).catch(() => {});
    };
    const btn = (on: boolean) => `flex-1 flex items-center justify-center gap-1 rounded-lg py-2 text-xs transition-colors ${on ? 'bg-[#D42428] text-white' : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'}`;

    return (
        <div className="bg-[#141414] rounded-xl border border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
                <div className="text-sm font-bold uppercase tracking-wider flex-1">Review</div>
                {notes.length > 0 && <span className="text-xs text-white/40">{open} open · {notes.length - open} fixed</span>}
            </div>
            <div className="flex gap-1">
                <button type="button" className={btn(tool === 'note')} onClick={() => setTool(tool === 'note' ? null : 'note')}><MessageSquarePlus className="w-4 h-4" /> Pin a note</button>
                <button type="button" className={btn(tool === 'photo')} onClick={() => setTool(tool === 'photo' ? null : 'photo')} disabled={photos.length >= MAX_FACADE_PHOTOS}><Camera className="w-4 h-4" /> Facade photo</button>
                <button type="button" className={btn(tool === 'business')} onClick={() => setTool(tool === 'business' ? null : 'business')}><Store className="w-4 h-4" /> Name a business</button>
            </div>
            {tool === 'business' && !pendingBusiness && <p className="text-xs text-white/50">For a business OpenStreetMap doesn't have: click the front wall of its unit in the preview, then type its name. It gets a storefront and a sign on the next rebuild.</p>}
            {pendingBusiness && <BusinessForm s={pendingBusiness.s} onCancel={cancelBusiness} onAdd={(name, kind) => { setBusinesses([...businesses, { id: `biz${Date.now().toString(36)}`, ...pendingBusiness, name, kind }]); cancelBusiness(); }} />}
            {businesses.length > 0 && (
                <ul className="space-y-1">
                    {businesses.map((b) => (
                        <li key={b.id} className="flex items-center gap-2 rounded-lg bg-black/30 p-2 text-xs">
                            <Store className="w-3.5 h-3.5 text-white/40" />
                            <span className="flex-1 truncate">{b.name} <span className="text-white/40">· {BUSINESS_KINDS[b.kind]?.label ?? b.kind} · {m(b.s)}</span></span>
                            <button type="button" title="View from the road" onClick={() => onView(b.s, b.point)} className="text-white/50 hover:text-white"><Eye className="w-3.5 h-3.5" /></button>
                            <button type="button" title="Remove" onClick={() => setBusinesses(businesses.filter((x) => x.id !== b.id))} className="text-white/50 hover:text-[#ff6b6b]"><Trash2 className="w-3.5 h-3.5" /></button>
                        </li>
                    ))}
                </ul>
            )}
            {tool === 'note' && <p className="text-xs text-white/50">Click anything in the preview to pin a note there (a missing sign, a wrong building, a tree in the road).</p>}
            {tool === 'photo' && pendingFrame && (
                <div className="rounded-lg border border-[#F5B700]/40 bg-[#F5B700]/5 p-2 text-xs flex items-center gap-2">
                    <img src={pendingFrame} alt="Frame from your drive" className="w-12 h-12 object-cover rounded" />
                    <span className="flex-1">Frame from your drive is ready. Click that wall in the 3D view.</span>
                    <button type="button" onClick={cancelPhoto} className="text-white/50 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
            )}
            {tool === 'photo' && !pendingPhoto && !pendingFrame && <p className="text-xs text-white/50">Click the wall of a landmark building in the preview, then choose your own photo of that side of it. Your own photos only, never Street View or Google images.</p>}
            {pendingPhoto && (
                <div className="rounded-lg border border-[#F5B700]/40 bg-[#F5B700]/5 p-2 text-xs flex items-center gap-2">
                    <span className="flex-1">Wall at {m(pendingPhoto.s)} picked.</span>
                    <button type="button" onClick={() => file.current?.click()} className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 flex items-center gap-1"><ImagePlus className="w-3.5 h-3.5" /> Choose photo</button>
                    <button type="button" onClick={cancelPhoto} className="text-white/50 hover:text-white"><X className="w-4 h-4" /></button>
                    <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhotoChosen(f); e.target.value = ''; }} />
                </div>
            )}
            {notes.length > 0 && (
                <ul className="space-y-1 max-h-72 overflow-auto pr-1">
                    {notes.slice().sort((a, b) => a.s - b.s).map((n) => (
                        <li key={n.id} onMouseEnter={() => setActiveId(n.id)} onMouseLeave={() => setActiveId(null)}
                            className={`rounded-lg p-2 text-xs space-y-1 ${activeId === n.id ? 'bg-[#F5B700]/10' : 'bg-black/30'} ${n.done ? 'opacity-60' : ''}`}>
                            <div className="flex items-center gap-2">
                                <span className="text-white/50 w-14">{m(n.s)}</span>
                                <span className="flex-1" />
                                <button type="button" title="View from the road" onClick={() => onView(n.s, n.point)} className="text-white/50 hover:text-white"><Eye className="w-3.5 h-3.5" /></button>
                                <button type="button" title="Compare: open Google Street View here, facing the pin (reference only)" onClick={() => onStreetView(n.s, n.point)} className="text-white/50 hover:text-white"><MapPinned className="w-3.5 h-3.5" /></button>
                                <button type="button" title={n.done ? 'Reopen' : 'Mark fixed'} onClick={() => setNotes(notes.map((x) => (x.id === n.id ? { ...x, done: !x.done } : x)))} className={n.done ? 'text-[#2D9E49]' : 'text-white/50 hover:text-[#2D9E49]'}><Check className="w-3.5 h-3.5" /></button>
                                <button type="button" title="Delete" onClick={() => setNotes(notes.filter((x) => x.id !== n.id))} className="text-white/50 hover:text-[#ff6b6b]"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                            <input value={n.text} autoFocus={!n.text} placeholder="What's wrong here?" onChange={(e) => setNotes(notes.map((x) => (x.id === n.id ? { ...x, text: e.target.value } : x)))} className={input} />
                        </li>
                    ))}
                </ul>
            )}
            {notes.length > 0 && <button type="button" onClick={copy} className="px-2 py-1 rounded-md text-xs bg-white/5 hover:bg-white/10 flex items-center gap-1"><ClipboardCopy className="w-3 h-3" /> Copy as a checklist</button>}
            {photos.length > 0 && (
                <div>
                    <div className="text-xs text-white/40 mb-1">Facade photos ({photos.length}/{MAX_FACADE_PHOTOS}) · rebuild to apply</div>
                    <ul className="grid grid-cols-3 gap-2">
                        {photos.map((p) => (
                            <li key={p.id} className="relative group">
                                <img src={p.dataUrl} alt={p.label ?? 'Facade'} className="w-full aspect-square object-cover rounded-md border border-white/10" />
                                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 rounded-b-md px-1 py-0.5 text-[10px]">
                                    <button type="button" title="View from the road" onClick={() => onView(p.s, p.point)}><Eye className="w-3 h-3" /></button>
                                    <span>{m(p.s)}</span>
                                    <button type="button" title="Remove" onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}><Trash2 className="w-3 h-3" /></button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

const BusinessForm: React.FC<{ s: number; onCancel: () => void; onAdd: (name: string, kind: string) => void }> = ({ s, onCancel, onAdd }) => {
    const [name, setName] = useState('');
    const [kind, setKind] = useState('shop');
    return (
        <form className="rounded-lg border border-[#F5B700]/40 bg-[#F5B700]/5 p-2 text-xs space-y-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onAdd(name.trim(), kind); }}>
            <div className="flex items-center gap-2"><span className="flex-1">Wall at {m(s)} picked.</span><button type="button" onClick={onCancel} className="text-white/50 hover:text-white"><X className="w-4 h-4" /></button></div>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name, as on its sign" maxLength={40} className={input} />
            <div className="flex gap-2">
                <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${input} flex-1`}>
                    {Object.entries(BUSINESS_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <button type="submit" disabled={!name.trim()} className="px-3 py-1 rounded-md bg-[#2D9E49] disabled:opacity-40">Add</button>
            </div>
        </form>
    );
};

export default ReviewPanel;
