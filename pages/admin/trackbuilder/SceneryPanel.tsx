// Scenery tools and the list of placed items. Placement happens by clicking the 3D preview; this panel
// holds the active tool, its options, quick actions and the editable list.

import React from 'react';
import { Crosshair, Eye, Flag, Shield, Signpost, Sparkles, Trash2, TreePine, Trees, X } from 'lucide-react';
import { ELEMENT_LABELS } from '../../../tools/trackbuilder/elements.ts';
import type { ElementSide, SignStyle, TrackElement } from '../../../tools/trackbuilder/elements.ts';

export type Tool = TrackElement['type'];

export interface ToolOptions {
    side: ElementSide;
    density: number;
    signStyle: SignStyle;
    signText: string;
    bannerText: string;
}

interface Props {
    tool: Tool | null;
    setTool: (t: Tool | null) => void;
    options: ToolOptions;
    setOptions: (o: ToolOptions) => void;
    pendingFrom: number | null;
    elements: TrackElement[];
    setElements: (e: TrackElement[]) => void;
    lengthM: number;
    circuit: boolean;
    onView: (s: number) => void;
    onQuick: (what: 'banners' | 'trees' | 'boards') => void;
}

const TOOLS: { t: Tool; icon: React.ReactNode; hint: string }[] = [
    { t: 'guardrail', icon: <Shield className="w-4 h-4" />, hint: 'Click where the rail starts, then where it ends' },
    { t: 'trees', icon: <Trees className="w-4 h-4" />, hint: 'Click where the trees start, then where they end' },
    { t: 'tree', icon: <TreePine className="w-4 h-4" />, hint: 'Click beside the road where the tree goes' },
    { t: 'sign', icon: <Signpost className="w-4 h-4" />, hint: 'Click the side of the road the sign stands on' },
    { t: 'banner', icon: <Flag className="w-4 h-4" />, hint: 'Click the road where the banner spans it' },
];

const STYLE_LABELS: Record<SignStyle, string> = { kartcade: 'Kartcade', distance: 'Distance board', warning: 'Warning (yellow)', custom: 'Custom (black)' };

const m = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`);

const input = 'w-full bg-black/40 border border-white/10 rounded-md px-2 py-1 text-sm focus:outline-none focus:border-[#2D9E49]';

const SceneryPanel: React.FC<Props> = ({ tool, setTool, options, setOptions, pendingFrom, elements, setElements, lengthM, circuit, onView, onQuick }) => {
    const set = (patch: Partial<ToolOptions>) => setOptions({ ...options, ...patch });
    const update = (id: string, patch: Partial<TrackElement>) => setElements(elements.map((e) => (e.id === id ? ({ ...e, ...patch } as TrackElement) : e)));
    const clampS = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(lengthM, v)) : 0);
    const active = TOOLS.find((x) => x.t === tool);

    return (
        <div className="bg-[#141414] rounded-xl border border-white/10 p-4 space-y-4">
            <div>
                <div className="text-sm font-bold uppercase tracking-wider mb-2">Scenery</div>
                <div className="grid grid-cols-5 gap-1">
                    {TOOLS.map(({ t, icon }) => (
                        <button key={t} type="button" title={ELEMENT_LABELS[t]} onClick={() => setTool(tool === t ? null : t)}
                            className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] leading-tight transition-colors ${tool === t ? 'bg-[#D42428] text-white' : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'}`}>
                            {icon}<span>{ELEMENT_LABELS[t].replace('Start/finish ', '')}</span>
                        </button>
                    ))}
                </div>
            </div>

            {active && (
                <div className="rounded-lg border border-[#D42428]/40 bg-[#D42428]/5 p-3 space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                        <Crosshair className="w-4 h-4 mt-0.5 text-[#D42428] flex-shrink-0" />
                        <span className="flex-1">{pendingFrom != null ? `Start set at ${m(pendingFrom)}. Now click where it ends.` : active.hint}{(tool === 'guardrail' || tool === 'trees') && circuit ? ' (runs in the driving direction)' : ''}</span>
                        <button type="button" onClick={() => setTool(null)} className="text-white/50 hover:text-white" title="Done"><X className="w-4 h-4" /></button>
                    </div>
                    {(tool === 'guardrail' || tool === 'trees') && (
                        <div className="flex gap-1">
                            {(['left', 'right', 'both'] as ElementSide[]).map((sd) => (
                                <button key={sd} type="button" onClick={() => set({ side: sd })} className={`flex-1 py-1 rounded-md text-xs capitalize ${options.side === sd ? 'bg-white/20' : 'bg-white/5 text-white/60'}`}>{sd}</button>
                            ))}
                        </div>
                    )}
                    {tool === 'trees' && (
                        <label className="block text-xs text-white/60">Trees per 100 m per side: {options.density}
                            <input type="range" min={1} max={20} value={options.density} onChange={(e) => set({ density: parseInt(e.target.value, 10) })} className="w-full" />
                        </label>
                    )}
                    {tool === 'sign' && (<>
                        <select value={options.signStyle} onChange={(e) => set({ signStyle: e.target.value as SignStyle })} className={input}>
                            {(Object.keys(STYLE_LABELS) as SignStyle[]).map((k) => <option key={k} value={k}>{STYLE_LABELS[k]}</option>)}
                        </select>
                        {options.signStyle !== 'kartcade' && <input value={options.signText} onChange={(e) => set({ signText: e.target.value })} maxLength={16} placeholder={options.signStyle === 'distance' ? '200' : 'Sign text'} className={input} />}
                    </>)}
                    {tool === 'banner' && <input value={options.bannerText} onChange={(e) => set({ bannerText: e.target.value })} maxLength={24} placeholder="START" className={input} />}
                </div>
            )}

            <div className="flex flex-wrap gap-1">
                <button type="button" onClick={() => onQuick('banners')} className="px-2 py-1 rounded-md text-xs bg-white/5 hover:bg-white/10 flex items-center gap-1"><Sparkles className="w-3 h-3" /> {circuit ? 'Start/finish banner' : 'Start & finish banners'}</button>
                <button type="button" onClick={() => onQuick('trees')} className="px-2 py-1 rounded-md text-xs bg-white/5 hover:bg-white/10 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Trees all the way</button>
                <button type="button" onClick={() => onQuick('boards')} className="px-2 py-1 rounded-md text-xs bg-white/5 hover:bg-white/10 flex items-center gap-1"><Sparkles className="w-3 h-3" /> 300/200/100 boards</button>
            </div>

            <div>
                <div className="text-xs text-white/40 mb-1">{elements.length ? `${elements.length} placed · distances are metres from the start` : 'Nothing placed yet.'}</div>
                <ul className="space-y-1 max-h-80 overflow-auto pr-1">
                    {elements.map((e) => (
                        <li key={e.id} className="bg-black/30 rounded-lg p-2 text-xs space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="font-medium flex-1">{ELEMENT_LABELS[e.type]}{e.type === 'sign' ? ` · ${STYLE_LABELS[e.style]}` : ''}</span>
                                <button type="button" title="View from the road" onClick={() => onView('at' in e ? e.at : e.from)} className="text-white/50 hover:text-white"><Eye className="w-3.5 h-3.5" /></button>
                                <button type="button" title="Remove" onClick={() => setElements(elements.filter((x) => x.id !== e.id))} className="text-white/50 hover:text-[#ff6b6b]"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                            <div className="flex flex-wrap items-center gap-1 text-white/60">
                                {'from' in e ? (<>
                                    <input type="number" value={Math.round(e.from)} onChange={(ev) => update(e.id, { from: clampS(parseFloat(ev.target.value)) })} className={`${input} !w-20`} />
                                    <span>to</span>
                                    <input type="number" value={Math.round(e.to)} onChange={(ev) => update(e.id, { to: clampS(parseFloat(ev.target.value)) })} className={`${input} !w-20`} />
                                    <select value={e.side} onChange={(ev) => update(e.id, { side: ev.target.value as ElementSide })} className={`${input} !w-20`}>
                                        <option value="left">left</option><option value="right">right</option><option value="both">both</option>
                                    </select>
                                </>) : (<>
                                    <span>at</span>
                                    <input type="number" value={Math.round(e.at)} onChange={(ev) => update(e.id, { at: clampS(parseFloat(ev.target.value)) })} className={`${input} !w-20`} />
                                    {e.type === 'sign' && <select value={e.side} onChange={(ev) => update(e.id, { side: ev.target.value as 'left' | 'right' })} className={`${input} !w-20`}><option value="left">left</option><option value="right">right</option></select>}
                                    {e.type === 'tree' && <span>{e.offset < 0 ? 'left' : 'right'}</span>}
                                </>)}
                                {e.type === 'trees' && <span>{e.density ?? 6}/100 m</span>}
                                {e.type === 'sign' && e.style !== 'kartcade' && <input value={e.text} maxLength={16} onChange={(ev) => update(e.id, { text: ev.target.value })} className={`${input} !w-28`} />}
                                {e.type === 'banner' && <input value={e.text} maxLength={24} onChange={(ev) => update(e.id, { text: ev.target.value })} className={`${input} !w-32`} />}
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

export default SceneryPanel;
