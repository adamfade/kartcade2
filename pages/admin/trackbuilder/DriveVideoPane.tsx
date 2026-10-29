// The driver's own drive video beside the 3D preview. Load the video (it stays on this computer; only its name is
// saved) and the GPS log recorded with it; while it plays, the 3D view stands at the same spot on the road.
// Because the footage is the driver's own, it can also feed the build: pin a note at the moment something looks
// wrong, or straighten a frame of a building into a facade photo.

import React, { useEffect, useRef, useState } from 'react';
import { Camera, Crosshair, FileUp, MessageSquarePlus, RotateCcw, Video, X } from 'lucide-react';
import type { BuildResult } from '../../../tools/trackbuilder/pack.ts';
import { fixAt, onRoute, packFixes, parseDriveLog, thinFixes, unpackFixes, videoStartTime } from '../../../tools/trackbuilder/drivelog.ts';
import type { DriveFix } from '../../../tools/trackbuilder/drivelog.ts';
import { quadSize, warpQuad } from '../../../tools/trackbuilder/warp.ts';
import type { FollowView } from './TrackPreview3D';

/** What's saved with the project: the GPS log (1 Hz, packed) and how the video lines up with it. */
export interface SavedDrive {
    video: string;
    log: string;
    t0: number;
    data: number[];
    /** The video's start time read from the file (ms since 1970), or null to use the start of the log. */
    videoStartMs: number | null;
    /** Hand correction added to the start time, ms. */
    offsetMs: number;
}

interface Props {
    build: BuildResult;
    drive: SavedDrive | null;
    setDrive: (d: SavedDrive | null) => void;
    /** Written every frame while following; the 3D preview reads it. */
    followRef: React.MutableRefObject<FollowView | null>;
    /** Where ground view is now (for lining the video up by hand). */
    viewS: number | null;
    onNote: (s: number, text: string) => void;
    /** A straightened frame (JPEG data URL) for the facade tool. */
    onFacadeFrame: (dataUrl: string) => void;
    className?: string;
}

const MAX_OFF_ROUTE = 25; // m: further than this the video isn't on the route
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

async function readStart(f: File): Promise<number | null> {
    const head = new Uint8Array(await f.slice(0, 2 << 20).arrayBuffer());
    const tail = new Uint8Array(await f.slice(Math.max(0, f.size - (4 << 20))).arrayBuffer());
    return videoStartTime(head, tail);
}

const DriveVideoPane: React.FC<Props> = ({ build, drive, setDrive, followRef, viewS, onNote, onFacadeFrame, className }) => {
    const video = useRef<HTMLVideoElement>(null);
    const [url, setUrl] = useState<string | null>(null);
    const [videoName, setVideoName] = useState<string | null>(null);
    const [follow, setFollow] = useState(true);
    const [status, setStatus] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const [frame, setFrame] = useState<{ src: string; w: number; h: number; time: number } | null>(null);
    const fixes = useRef<DriveFix[]>([]);
    const lastS = useRef<number | null>(null);
    const pendingStart = useRef<number | null>(null); // video start read before the GPS log was chosen
    const pos = useRef<{ s: number; off: number } | null>(null);
    const live = useRef({ drive, follow, build });
    live.current = { drive, follow, build };

    useEffect(() => { fixes.current = drive ? unpackFixes(drive) : []; lastS.current = null; }, [drive?.t0, drive?.data.length]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
    useEffect(() => () => { followRef.current = null; }, [followRef]);
    useEffect(() => { if (!follow) followRef.current = null; }, [follow, followRef]);

    /** Epoch ms of the video's first frame. */
    const startMs = (d: SavedDrive) => (d.videoStartMs ?? d.t0) + d.offsetMs;

    // Each video frame: GPS position at that moment, matched to the route, handed to the 3D view.
    useEffect(() => {
        const v = video.current;
        if (!v || !url) return;
        let stop = false, handle = 0, shownAt = 0;
        const update = () => {
            const d = live.current.drive;
            if (!d || !fixes.current.length) { followRef.current = null; return; }
            const t = startMs(d) + v.currentTime * 1000;
            const p = fixAt(fixes.current, t);
            if (!p) { pos.current = null; followRef.current = null; return; }
            const r = onRoute(live.current.build.centerline, p, lastS.current);
            pos.current = { s: r.s, off: r.off };
            if (r.off <= MAX_OFF_ROUTE) {
                lastS.current = r.s;
                if (live.current.follow) followRef.current = { s: r.s, lat: NaN };
            } else followRef.current = null;
            const now = performance.now();
            if (now - shownAt > 400) {
                shownAt = now;
                setStatus(r.off <= MAX_OFF_ROUTE ? `${(r.s / 1000).toFixed(2)} km along the route · GPS ${Math.round(r.off)} m from the centre line` : `Off the route here (GPS ${Math.round(r.off)} m away)`);
            }
        };
        type RVFC = (cb: () => void) => number;
        const rvfc = (v as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(v);
        const loop = () => { if (stop) return; update(); handle = rvfc ? rvfc(loop) : requestAnimationFrame(loop); };
        loop();
        const once = () => update();
        v.addEventListener('seeked', once);
        v.addEventListener('loadeddata', once);
        return () => {
            stop = true;
            if (!rvfc) cancelAnimationFrame(handle);
            v.removeEventListener('seeked', once); v.removeEventListener('loadeddata', once);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url]);

    const chooseVideo = async (f: File) => {
        setProblem(null);
        if (url) URL.revokeObjectURL(url);
        setUrl(URL.createObjectURL(f)); setVideoName(f.name);
        const start = await readStart(f).catch(() => null);
        if (drive) {
            const fx = fixes.current, fits = start != null && fx.length > 0 && start > fx[0].t - 120_000 && start < fx[fx.length - 1].t;
            if (drive.video !== f.name || drive.videoStartMs !== (fits ? start : null)) setDrive({ ...drive, video: f.name, videoStartMs: fits ? start : null, offsetMs: drive.video === f.name ? drive.offsetMs : 0 });
            if (start != null && !fits) setProblem("The video's clock doesn't match the GPS log, so it starts at the start of the log. Use Line up below.");
        } else pendingStart.current = start;
    };

    const chooseLog = async (f: File) => {
        setProblem(null);
        try {
            const all = parseDriveLog(await f.text(), f.name);
            // 1 Hz, or coarser for drives over an hour (the project document has a size limit).
            const thin = thinFixes(all, Math.max(1000, (all[all.length - 1].t - all[0].t) / 3600));
            const packed = packFixes(thin);
            const start = pendingStart.current ?? drive?.videoStartMs ?? null;
            const fits = start != null && start > thin[0].t - 120_000 && start < thin[thin.length - 1].t;
            // How much of the drive is on this route.
            let on = 0, last: number | null = null;
            for (const p of thin) { const r = onRoute(build.centerline, p, last); if (r.off <= MAX_OFF_ROUTE) { on++; last = r.s; } }
            if (!on) { setProblem('None of that GPS log is on this route.'); return; }
            setDrive({ video: videoName ?? drive?.video ?? '', log: f.name, ...packed, videoStartMs: fits ? start : null, offsetMs: 0 });
            if (start != null && !fits) setProblem("The video's clock doesn't match the GPS log, so it starts at the start of the log. Use Line up below.");
        } catch (e) { setProblem((e as Error).message); }
    };

    const nudge = (ms: number) => { if (drive) setDrive({ ...drive, offsetMs: drive.offsetMs + ms }); };

    /** Line up by hand: the 3D view is standing where the car is in this frame. */
    const lineUp = () => {
        const v = video.current, fx = fixes.current;
        if (!v || !drive || viewS == null || fx.length < 2) return;
        const guess = startMs(drive) + v.currentTime * 1000;
        let best: { t: number; score: number } | null = null, last: number | null = null;
        for (let i = 0; i < fx.length - 1; i++) {
            const a = onRoute(build.centerline, fx[i], last), b = onRoute(build.centerline, fx[i + 1], a.s);
            last = a.s;
            if (a.off > MAX_OFF_ROUTE || b.off > MAX_OFF_ROUTE) continue;
            const lo = Math.min(a.s, b.s), hi = Math.max(a.s, b.s);
            if (viewS < lo - 3 || viewS > hi + 3) continue;
            const k = hi - lo < 0.5 ? 0 : Math.max(0, Math.min(1, (viewS - a.s) / (b.s - a.s)));
            const t = fx[i].t + (fx[i + 1].t - fx[i].t) * k;
            const score = Math.abs(t - guess); // a road driven twice: the pass nearest the current guess
            if (!best || score < best.score) best = { t, score };
        }
        if (!best) { setProblem("The GPS log never passes the 3D view's spot. Move the 3D view to where the car is in the video."); return; }
        setProblem(null);
        setDrive({ ...drive, offsetMs: drive.offsetMs + Math.round(best.t - guess) });
    };

    const note = () => {
        const v = video.current;
        if (!v || !pos.current || pos.current.off > MAX_OFF_ROUTE) return;
        v.pause();
        onNote(pos.current.s, `Drive video ${clock(v.currentTime)}: `);
    };

    const grab = () => {
        const v = video.current;
        if (!v || !v.videoWidth) return;
        v.pause();
        const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        setFrame({ src: c.toDataURL('image/jpeg', 0.92), w: c.width, h: c.height, time: v.currentTime });
    };

    const btn = 'px-2.5 py-1 rounded-md text-xs bg-white/5 hover:bg-white/10 text-white/80 flex items-center gap-1 disabled:opacity-40';
    const fileBtn = 'px-3 py-1.5 rounded-lg text-sm bg-white/10 hover:bg-white/20 flex items-center gap-1 cursor-pointer';
    const needVideo = !url;
    return (
        <div className={`flex flex-col bg-[#0b0b0b] ${className ?? ''}`}>
            <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-white/10">
                <span className="text-[11px] uppercase tracking-wider text-white/40 flex-1">My drive{videoName ? ` · ${videoName}` : drive?.video ? ` · ${drive.video}` : ''}</span>
                {url && <button type="button" className={`${btn} ${follow ? '!bg-[#2D9E49] !text-white' : ''}`} onClick={() => setFollow((f) => !f)} title="Move the 3D view with the video">{follow ? '3D follows video' : '3D follows video: off'}</button>}
                {drive && <button type="button" className={btn} onClick={() => { setDrive(null); followRef.current = null; }} title="Forget the GPS log"><X className="w-3 h-3" /> Clear</button>}
            </div>
            <div className="relative flex-1 min-h-0">
                {needVideo || !drive ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/60">
                        <Video className="w-6 h-6 text-white/40" />
                        <p>Your own drive of this road: a phone or dashcam video, and the GPS log recorded at the same time (GPX, KML, GeoJSON or CSV with times). The video stays on this computer.</p>
                        <div className="flex flex-wrap justify-center gap-2">
                            <label className={fileBtn}><Video className="w-4 h-4" /> {url ? `Video: ${videoName}` : drive?.video ? `Choose ${drive.video} again` : 'Choose video'}
                                <input type="file" accept="video/*,.mp4,.mov" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) chooseVideo(f); e.target.value = ''; }} /></label>
                            <label className={fileBtn}><FileUp className="w-4 h-4" /> {drive ? `GPS: ${drive.log}` : 'Choose GPS log'}
                                <input type="file" accept=".gpx,.kml,.geojson,.json,.csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) chooseLog(f); e.target.value = ''; }} /></label>
                        </div>
                        {problem && <p className="text-xs text-[#F5B700]">{problem}</p>}
                    </div>
                ) : null}
                {url && <video ref={video} src={url} controls playsInline muted className={`absolute inset-0 w-full h-full object-contain bg-black ${drive ? '' : 'invisible'}`} />}
            </div>
            {url && drive && (
                <div className="px-2 py-1.5 border-t border-white/10 space-y-1.5">
                    <div className="text-[11px] text-white/50">{status || 'Play or scrub the video'}{problem ? <span className="text-[#F5B700]"> · {problem}</span> : null}</div>
                    <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[11px] text-white/40 mr-1">Sync {(drive.offsetMs / 1000).toFixed(1)} s</span>
                        {[-5000, -1000, -200, 200, 1000, 5000].map((ms) => <button key={ms} type="button" className={btn} onClick={() => nudge(ms)}>{ms > 0 ? '+' : ''}{ms / 1000}</button>)}
                        <button type="button" className={btn} onClick={() => drive && setDrive({ ...drive, offsetMs: 0 })} title="Back to the time in the file"><RotateCcw className="w-3 h-3" /></button>
                        <button type="button" className={btn} disabled={viewS == null} onClick={lineUp} title="Pause where you recognise the spot, put the 3D view on the same spot (turn off follow first), then press this"><Crosshair className="w-3 h-3" /> Line up with 3D view</button>
                        <span className="flex-1" />
                        <button type="button" className={btn} onClick={note} title="Pause and pin a review note at this spot"><MessageSquarePlus className="w-3 h-3" /> Note here</button>
                        <button type="button" className={btn} onClick={grab} title="Use this frame for a building's facade"><Camera className="w-3 h-3" /> Facade from frame</button>
                    </div>
                </div>
            )}
            {frame && <CornerPicker frame={frame} onCancel={() => setFrame(null)} onUse={(d) => { setFrame(null); onFacadeFrame(d); }} />}
        </div>
    );
};

/** Click the wall's four corners on the frame; the wall is straightened into a front-on photo. */
const CornerPicker: React.FC<{ frame: { src: string; w: number; h: number; time: number }; onCancel: () => void; onUse: (dataUrl: string) => void }> = ({ frame, onCancel, onUse }) => {
    const [pts, setPts] = useState<{ x: number; y: number }[]>([]);
    const img = useRef<HTMLImageElement>(null);
    const names = ['top left', 'top right', 'bottom right', 'bottom left'];
    const click = (e: React.MouseEvent) => {
        if (!img.current) return;
        const r = img.current.getBoundingClientRect();
        const p = { x: ((e.clientX - r.left) / r.width) * frame.w, y: ((e.clientY - r.top) / r.height) * frame.h };
        setPts((cur) => (cur.length >= 4 ? cur : [...cur, p]));
    };
    const use = async () => {
        const bmp = await createImageBitmap(await (await fetch(frame.src)).blob());
        const c = new OffscreenCanvas(frame.w, frame.h), ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0);
        const src = { width: frame.w, height: frame.h, data: new Uint8Array(ctx.getImageData(0, 0, frame.w, frame.h).data.buffer) };
        const size = quadSize(pts, 384), out = warpQuad(src, pts, size.width, size.height);
        const oc = document.createElement('canvas');
        oc.width = out.width; oc.height = out.height;
        oc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out.data.buffer), out.width, out.height), 0, 0);
        onUse(oc.toDataURL('image/jpeg', 0.8));
    };
    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onCancel}>
            <div className="bg-[#141414] rounded-xl border border-white/10 p-4 max-w-5xl w-full space-y-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{pts.length < 4 ? `Click the wall's ${names[pts.length]} corner` : 'Wall marked. Use it, then click that wall in the 3D view.'} <span className="text-white/40">(frame at {clock(frame.time)})</span></span>
                    <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/20" onClick={() => setPts([])}>Start over</button>
                    <button type="button" disabled={pts.length < 4} className="px-3 py-1.5 rounded-lg text-xs bg-[#2D9E49] disabled:opacity-40" onClick={use}>Use for facade</button>
                    <button type="button" className="text-white/50 hover:text-white" onClick={onCancel}><X className="w-4 h-4" /></button>
                </div>
                <div className="relative cursor-crosshair select-none" onClick={click}>
                    <img ref={img} src={frame.src} alt="Video frame" className="w-full h-auto rounded-md" draggable={false} />
                    <svg viewBox={`0 0 ${frame.w} ${frame.h}`} className="absolute inset-0 w-full h-full pointer-events-none">
                        {pts.length > 1 && <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(45,158,73,0.18)" stroke="#2D9E49" strokeWidth={frame.w / 400} />}
                        {pts.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r={frame.w / 160} fill="#F5B700" /><text x={p.x + frame.w / 120} y={p.y - frame.w / 160} fill="#F5B700" fontSize={frame.w / 50}>{i + 1}</text></g>)}
                    </svg>
                </div>
                <p className="text-[11px] text-white/40">A frame from straight across the street works best. Your own footage only.</p>
            </div>
        </div>
    );
};

export default DriveVideoPane;
