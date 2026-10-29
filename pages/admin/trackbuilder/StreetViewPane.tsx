// Google Street View beside the 3D preview, at the same spot and facing the same way as ground view, for
// comparison. It is Google's own embedded viewer (Maps Embed API, free with unlimited loads): nothing is
// downloaded or stored, and Street View imagery never goes into a track. Without a key it offers a link instead.

import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, MapPinned } from 'lucide-react';
import type { ViewInfo } from './TrackPreview3D';
import { streetViewLink } from './TrackPreview3D';

const KEY = (import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY as string | undefined) ?? '';

interface Props {
    /** Ground view's spot and facing (null in the overview). */
    view: ViewInfo | null;
    className?: string;
}

type Spot = { lat: number; lon: number; heading: number; pitch: number };

const embedUrl = (v: Spot) =>
    `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(KEY)}&location=${v.lat.toFixed(6)},${v.lon.toFixed(6)}&heading=${Math.round(v.heading)}&pitch=${Math.round(Math.max(-60, Math.min(60, v.pitch)))}&fov=80`;

/** Far enough apart to be worth reloading the viewer (it reloads from scratch each time). */
function moved(a: Spot | null, b: Spot) {
    if (!a) return true;
    const dm = Math.hypot((a.lat - b.lat) * 111_120, (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
    const dh = Math.abs(((a.heading - b.heading + 540) % 360) - 180);
    return dm > 4 || dh > 8 || Math.abs(a.pitch - b.pitch) > 8;
}

const StreetViewPane: React.FC<Props> = ({ view, className }) => {
    const [follow, setFollow] = useState(true);
    const [shown, setShown] = useState<Spot | null>(null);
    const latest = useRef<Spot | null>(null);
    latest.current = view ? { lat: view.at.lat, lon: view.at.lon, heading: view.headingDeg, pitch: view.pitchDeg } : latest.current;

    // Reload once the 3D view has settled for a moment (moving every frame would reload constantly).
    useEffect(() => {
        if (!follow || !view) return;
        const id = setTimeout(() => { const v = latest.current; if (v && moved(shown, v)) setShown(v); }, 600);
        return () => clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, follow]);

    // The controls sit above the viewer, never over it (Google's logo and notices must stay visible).
    const btn = 'px-2.5 py-1 rounded-md text-xs bg-white/5 hover:bg-white/10 text-white/80 flex items-center gap-1';
    return (
        <div className={`flex flex-col bg-[#0b0b0b] ${className ?? ''}`}>
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/10">
                <span className="text-[11px] uppercase tracking-wider text-white/40 flex-1">Street View · reference only</span>
                {KEY && <button type="button" className={`${btn} ${follow ? '!bg-[#2D9E49] !text-white' : ''}`} onClick={() => setFollow((f) => !f)} title="Move Street View with the 3D view">{follow ? 'Following 3D view' : 'Follow 3D view'}</button>}
                {KEY && !follow && latest.current && <button type="button" className={btn} onClick={() => latest.current && setShown(latest.current)}>Jump here</button>}
                {latest.current && <a href={streetViewLink(latest.current)} target="_blank" rel="noopener noreferrer" className={btn}><ExternalLink className="w-3 h-3" /> New tab</a>}
            </div>
            <div className="relative flex-1">
                {!view && !shown ? (
                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/50">Stand on the road in the 3D view (Ground view, or double-click the track) and Street View will show the same spot.</div>
                ) : KEY ? (
                    shown && <iframe key={embedUrl(shown)} title="Google Street View" src={embedUrl(shown)} className="absolute inset-0 w-full h-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/60">
                        <MapPinned className="w-6 h-6 text-white/40" />
                        <p>Street View can show here once a Google Maps Embed API key is added to the site (VITE_GOOGLE_MAPS_EMBED_KEY). Until then, open the same spot in a new tab.</p>
                        {latest.current && <a href={streetViewLink(latest.current)} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> Open this spot in Street View</a>}
                    </div>
                )}
            </div>
        </div>
    );
};

export default StreetViewPane;
