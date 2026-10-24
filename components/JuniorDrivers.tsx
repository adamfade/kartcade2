import React, { useState } from 'react';
import { User, Plus, X, Edit2, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

type Junior = { name: string; photoURL?: string };

const clean = (list: Junior[]) =>
    list.map(j => (j.photoURL ? { name: j.name, photoURL: j.photoURL } : { name: j.name }));

/** Inline "add a junior driver" form: saves straight to the profile, no edit modal needed. */
const QuickAdd: React.FC<{ large?: boolean; onAdded?: () => void }> = ({ large, onAdded }) => {
    const { userProfile, updateProfile } = useAuth();
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const add = async () => {
        const n = name.trim();
        if (n.length < 2 || saving) return;
        setSaving(true);
        setError(null);
        try {
            const current = (userProfile?.juniorDrivers || []) as Junior[];
            await updateProfile({ juniorDrivers: clean([...current, { name: n }]), juniorPromptDismissed: true } as any);
            setName('');
            onAdded?.();
        } catch (e) {
            console.error('[JuniorDrivers] add failed', e);
            setError('Could not save. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="flex flex-col sm:flex-row gap-2">
                <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                    placeholder="Junior driver's name"
                    aria-label="Junior driver's name"
                    className={`flex-1 bg-black/40 border border-white/15 rounded-lg px-4 text-white placeholder-white/30 focus:outline-none focus:border-[#2D9E49] ${large ? 'py-3.5 text-base' : 'py-2.5 text-sm'}`}
                />
                <button
                    onClick={add}
                    disabled={name.trim().length < 2 || saving}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D9E49] hover:bg-[#248a3f] disabled:opacity-40 text-white font-bold uppercase tracking-wider transition-colors ${large ? 'px-6 py-3.5 text-sm' : 'px-4 py-2.5 text-xs'}`}
                >
                    <Plus className="w-4 h-4" />
                    {saving ? 'Adding…' : 'Add junior driver'}
                </button>
            </div>
            {error && <p className="text-[#D42428] text-xs mt-2">{error}</p>}
        </div>
    );
};

/**
 * Shown at the top of the dashboard until the parent adds a junior or says they don't need to.
 * Junior drivers (under 18) race on their parent's account and waiver.
 */
export const JuniorDriversPrompt: React.FC = () => {
    const { userProfile, updateProfile } = useAuth();
    const [hidden, setHidden] = useState(false);
    const p = userProfile as any;
    if (!p || hidden || p.juniorPromptDismissed || (p.juniorDrivers?.length ?? 0) > 0) return null;

    const dismiss = async () => {
        setHidden(true);
        try { await updateProfile({ juniorPromptDismissed: true } as any); } catch (e) { console.error(e); }
    };

    return (
        <div className="mb-6 rounded-2xl border-2 border-[#2D9E49]/50 bg-gradient-to-br from-[#2D9E49]/15 to-[#141414] p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-xl bg-[#2D9E49]/25 flex items-center justify-center flex-shrink-0">
                        <Users className="w-7 h-7 text-[#2D9E49]" />
                    </div>
                    <div>
                        <h2 className="font-display text-xl sm:text-2xl font-bold text-white uppercase">Racing with kids?</h2>
                        <p className="text-white/70 text-sm sm:text-base mt-1">
                            Add each driver under 18 to your account. They race on your waiver and get their own spot on the leaderboard.
                        </p>
                    </div>
                </div>
                <button onClick={dismiss} aria-label="Hide this" className="text-white/40 hover:text-white p-1"><X className="w-5 h-5" /></button>
            </div>
            <QuickAdd large onAdded={() => setHidden(true)} />
            <button onClick={dismiss} className="mt-3 text-xs text-white/40 hover:text-white/70 underline underline-offset-2">
                No junior drivers, hide this
            </button>
        </div>
    );
};

/** Always-visible card on the dashboard: lists junior drivers and lets parents add more in one step. */
export const JuniorDriversCard: React.FC<{ onEdit: () => void }> = ({ onEdit }) => {
    const { userProfile } = useAuth();
    const juniors = ((userProfile as any)?.juniorDrivers || []) as Junior[];

    return (
        <div id="junior-drivers" className="bg-[#141414] rounded-2xl p-6 border border-white/10">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-[#2D9E49]/20 rounded-lg flex items-center justify-center">
                        <User className="w-6 h-6 text-[#2D9E49]" />
                    </div>
                    <div>
                        <h2 className="font-display text-lg font-bold text-white uppercase">Junior Drivers</h2>
                        <p className="text-white/60 text-sm">Under 18, covered by your waiver</p>
                    </div>
                </div>
                {juniors.length > 0 && (
                    <button onClick={onEdit} className="text-[#2D9E49] hover:text-[#248a3f] transition-colors flex items-center gap-1 text-sm">
                        <Edit2 className="w-4 h-4" />
                        <span>Photos</span>
                    </button>
                )}
            </div>

            {juniors.length > 0 && (
                <div className="space-y-2 mb-4">
                    {juniors.map((junior, index) => (
                        <div key={index} className="flex items-center gap-2 p-3 bg-black/30 rounded-lg">
                            <div className="w-8 h-8 bg-[#2D9E49]/20 rounded-full flex items-center justify-center overflow-hidden">
                                {junior.photoURL
                                    ? <img src={junior.photoURL} alt={junior.name} className="w-full h-full object-cover" />
                                    : <User className="w-4 h-4 text-[#2D9E49]" />}
                            </div>
                            <span className="text-white font-medium">{junior.name}</span>
                        </div>
                    ))}
                </div>
            )}

            <QuickAdd />
        </div>
    );
};
