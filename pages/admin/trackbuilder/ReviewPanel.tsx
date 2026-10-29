// Review: compare the build with the real road and keep a list of what to fix. Notes are pinned to spots in
// the 3D preview (click to drop one), each with a view-from-the-road button and a Street View button that opens
// Google Street View at the same spot facing the same thing (a reference to compare against; Street View
// imagery is never copied into the track). Facade photos: the driver's own photo of a landmark, put on the
// building wall clicked in the preview.

import React, { useRef } from 'react';
import { Camera, Check, ClipboardCopy, Eye, ImagePlus, MapPinned, MessageSquarePlus, Trash2, X } from 'lucide-react';

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

export type ReviewTool = 'note' | 'photo';

interface Props {
    tool: ReviewTool | null;
    setTool: (t: ReviewTool | null) => void;
    notes: ReviewNote[];
    setNotes: (n: ReviewNote[]) => void;
    photos: FacadePhoto[];
    setPhotos: (p: FacadePhoto[]) => void;
    /** A facade spot was clicked and is waiting for its photo. */
    pendingPhoto: Omit<FacadePhoto, 'dataUrl' | 'id'> | null;
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

const ReviewPanel: React.FC<Props> = ({ tool, setTool, notes, setNotes, photos, setPhotos, pendingPhoto, onPhotoChosen, cancelPhoto, activeId, setActiveId, onView, onStreetView }) => {
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
            </div>
            {tool === 'note' && <p className="text-xs text-white/50">Click anything in the preview to pin a note there (a missing sign, a wrong building, a tree in the road).</p>}
            {tool === 'photo' && !pendingPhoto && <p className="text-xs text-white/50">Click the wall of a landmark building in the preview, then choose your own photo of that side of it. Your own photos only, never Street View or Google images.</p>}
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

export default ReviewPanel;
