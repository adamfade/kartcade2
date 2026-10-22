import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../config/firebase';
import {
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    Timestamp
} from 'firebase/firestore';
import { Trophy, Medal, Award, ChevronUp, ChevronDown, Clock, Gauge, Monitor, Rocket, Zap, Trash2, Calendar, Filter, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { deleteDoc, doc } from 'firebase/firestore';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LapTime {
    id: string;
    userId: string;
    driverName: string;
    photoURL: string;
    isPro?: boolean;
    equipment: 'karts' | 'rigs' | 'motion' | 'flight';
    game: string;
    track: string;
    car: string;
    lapTime: string;
    lapTimeMs: number;
    status: 'pending' | 'approved' | 'rejected';
    submittedAt: Timestamp;
    competitionWins?: { daily: number; weekly: number; monthly: number; total: number };
    challengeId?: string | null;
}

interface Competition {
    id: string;
    type: 'daily' | 'weekly' | 'monthly';
    equipment: string;
    game: string;
    track: string;
    car: string;
    referenceTime: string;
    referenceTimeMs: number;
    setByName: string;
    startDate: string;
    endDate: string;
    status: 'active' | 'completed';
    creditReward: number;
}

type CompetitionFilter = 'all' | 'daily' | 'weekly' | 'monthly';
type EquipmentFilter = 'all' | 'karts' | 'rigs' | 'motion' | 'flight';
type SortKey = 'lapTimeMs' | 'driverName' | 'equipment' | 'game';
type SortDir = 'asc' | 'desc';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EQUIPMENT_LABELS: Record<string, string> = {
    karts: 'Racing Karts',
    rigs: 'Full-Size Rigs',
    motion: 'Motion Simulator',
    flight: 'Flight Simulator'
};

const EQUIPMENT_COLORS: Record<string, string> = {
    karts: '#2D9E49',
    rigs: '#FFFFFF',
    motion: '#D42428',
    flight: '#2D9E49'
};

const EquipmentIcon = ({ type, size = 14 }: { type: string; size?: number }) => {
    const props = { size, className: 'inline' };
    if (type === 'karts') return <Zap {...props} />;
    if (type === 'rigs') return <Monitor {...props} />;
    if (type === 'motion') return <Rocket {...props} />;
    if (type === 'flight') return <Gauge {...props} />;
    return <Gauge {...props} />;
};

function getPeriodBounds(type: CompetitionFilter, offset: number = 0): { start: Date; end: Date } | null {
    if (type === 'all') return null;
    const now = new Date();
    let start: Date, end: Date;

    if (type === 'daily') {
        start = new Date(now);
        start.setDate(now.getDate() + offset);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setHours(23, 59, 59, 999);
    } else if (type === 'weekly') {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1) + (offset * 7);
        start = new Date(now.setDate(diff));
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
    } else {
        start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999);
    }
    return { start, end };
}

// ─── Component ───────────────────────────────────────────────────────────────

const CalendarInput = React.forwardRef<HTMLButtonElement, any>(({ value, onClick }, ref) => (
    <button onClick={onClick} ref={ref} className="px-2 py-1.5 rounded-lg text-white/20 hover:text-white/40">
        <Calendar size={14} />
    </button>
));

const LeaderboardPage: React.FC = () => {
    const { isAdmin, currentUser, getBtpCredits, hasBtpCooldown } = useAuth();
    const [allTimes, setAllTimes] = useState<LapTime[]>([]);
    const [competitions, setCompetitions] = useState<Competition[]>([]);
    const [loading, setLoading] = useState(true);

    const [competitionFilter, setCompetitionFilter] = useState<CompetitionFilter>('all');
    const [periodOffset, setPeriodOffset] = useState<number>(0);
    const [sortKey, setSortKey] = useState<SortKey>('lapTimeMs');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    // Cascade filter state
    const [filterGame, setFilterGame] = useState<string>('');
    const [filterTrack, setFilterTrack] = useState<string>('');
    const [filterCar, setFilterCar] = useState<string>('');

    // ── Live data fetch ────────────────────────────────────────────────────
    useEffect(() => {
        const q = query(
            collection(db, 'lap_times'),
            where('status', '==', 'approved')
        );

        const unsub = onSnapshot(q, (snap) => {
            const times = snap.docs
                .map(d => ({ id: d.id, ...d.data() } as LapTime))
                .map(t => ({ ...t, game: canonicalGame(t.game) || '' }))
                .filter(t => t.game);
            // Sort locally to ensure premium responsiveness and bypass index requirements
            times.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
            setAllTimes(times);
            setLoading(false);
        }, (err) => {
            console.error('[Leaderboard] Listener error:', err);
            setLoading(false);
        });

        return () => unsub();
    }, []);

    useEffect(() => {
        const q = query(
            collection(db, 'competitions'),
            where('status', '==', 'active')
        );

        const unsub = onSnapshot(q, (snap) => {
            const comps = snap.docs.map(d => ({ id: d.id, ...d.data() } as Competition));
            // Sort locally
            comps.sort((a, b) => {
                const dateA = new Date(a.startDate).getTime();
                const dateB = new Date(b.startDate).getTime();
                return dateB - dateA;
            });
            setCompetitions(comps);
        });

        return () => unsub();
    }, []);

    // ── Active competition per type (with date range check) ────────────────
    const getLocalToday = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const todayStr = getLocalToday();

    const findActive = (type: 'daily' | 'weekly' | 'monthly') => {
        return competitions.find(c =>
            c.type === type &&
            c.status === 'active' &&
            c.startDate <= todayStr &&
            c.endDate >= todayStr
        );
    };

    const activeDaily = findActive('daily');
    const activeWeekly = findActive('weekly');
    const activeMonthly = findActive('monthly');

    // ── Cascade filter options (derived from live data) ───────────────────
    const allGames = [...new Set(allTimes.map(t => t.game).filter(Boolean))].sort();
    const tracksForGame = [...new Set(allTimes.filter(t => t.game === filterGame).map(t => t.track).filter(Boolean))].sort();
    const carsForTrack = [...new Set(allTimes.filter(t => t.game === filterGame && t.track === filterTrack).map(t => t.car).filter(Boolean))].sort();

    // ── Filtering ─────────────────────────────────────────────────────────
    const filteredTimes = allTimes.filter(t => {
        if (filterGame && t.game !== filterGame) return false;
        if (filterTrack && t.track !== filterTrack) return false;
        if (filterCar && t.car !== filterCar) return false;

        // Period filter / Challenge ID filter
        if (competitionFilter !== 'all') {
            const activeComp = competitionFilter === 'daily' ? activeDaily : competitionFilter === 'weekly' ? activeWeekly : activeMonthly;

            // Use strict challenge filter ONLY for current period (offset 0) if a challenge exists
            if (periodOffset === 0 && activeComp) {
                if (t.challengeId !== activeComp.id) return false;
            } else {
                // For historical periods or if no active challenge, use date range bounds
                const bounds = getPeriodBounds(competitionFilter, periodOffset);
                if (bounds && t.submittedAt) {
                    const ts = t.submittedAt instanceof Timestamp
                        ? t.submittedAt.toDate()
                        : new Date(t.submittedAt as any);
                    if (ts < bounds.start || ts > bounds.end) return false;
                } else {
                    return false;
                }
            }
        }
        return true;
    });

    // ── Sorting ───────────────────────────────────────────────────────────
    const sorted = [...filteredTimes].sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];

        if (valA === undefined || valB === undefined) return 0;

        if (typeof valA === 'string' && typeof valB === 'string') {
            return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }

        return sortDir === 'asc'
            ? (valA as number) - (valB as number)
            : (valB as number) - (valA as number);
    });

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('asc'); }
    };

    const handleDeleteLapTime = async (id: string) => {
        if (!window.confirm('Are you sure you want to permanently delete this lap time? This cannot be undone.')) return;
        try {
            await deleteDoc(doc(db, 'lap_times', id));
        } catch (err) {
            console.error('Delete failed:', err);
            window.alert('Failed to delete. Check permissions.');
        }
    };

    const SortIcon = ({ k }: { k: SortKey }) => {
        if (sortKey !== k) return <ChevronUp size={12} className="opacity-20 inline ml-1" />;
        return sortDir === 'asc'
            ? <ChevronUp size={12} className="text-[#2D9E49] inline ml-1" />
            : <ChevronDown size={12} className="text-[#2D9E49] inline ml-1" />;
    };

    // ── Default View Automation ───────────────────────────────────────────
    useEffect(() => {
        if (!loading && !filterGame && !filterTrack) {
            setCompetitionFilter('all');
            setPeriodOffset(0);
        }
    }, [loading]);

    // ── Helper Renders ───────────────────────────────────────────────────

    const renderBtpCta = (type: CompetitionFilter) => {
        if (!currentUser) return (
            <Link to="/login?redirect=/beat-the-pro"
                className="inline-flex items-center justify-center px-6 py-2.5 bg-[#FFD700] text-black text-xs font-black uppercase tracking-widest rounded-full hover:bg-yellow-300 transition-colors">
                Login to Participate
            </Link>
        );

        const balance = getBtpCredits();
        const cooldown = hasBtpCooldown();
        if (cooldown.active) return (
            <Link to="/dashboard"
                className="inline-flex items-center justify-center px-6 py-2.5 bg-[#FFD700] text-black text-xs font-black uppercase tracking-widest rounded-full hover:bg-yellow-300 transition-colors">
                Submit Your Lap Time
            </Link>
        );

        if (balance <= 0) return (
            <Link to="/dashboard"
                className="inline-flex items-center justify-center px-6 py-2.5 bg-[#FFD700] text-black text-xs font-black uppercase tracking-widest rounded-full hover:bg-yellow-300 transition-colors">
                Buy BTP Credit · $15
            </Link>
        );

        return (
            <Link to="/beat-the-pro"
                className="inline-flex items-center justify-center px-6 py-2.5 bg-[#FFD700] text-black text-xs font-black uppercase tracking-widest rounded-full hover:bg-yellow-300 transition-colors">
                Book Today's Session →
            </Link>
        );
    };

    const renderLeaderboardContent = (isAccordion = false) => (
        <>
            {/* Cascade Filter Dropdowns */}
            <div className={`bg-[#141414] border border-white/10 rounded-2xl p-4 sm:p-5 mb-6 ${isAccordion ? 'mx-0 sm:mx-1' : ''}`}>
                <p className="text-[10px] uppercase tracking-widest text-white/30 mb-4 font-bold">Filter Lap Times</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Game */}
                    <div>
                        <label className="block text-[10px] uppercase tracking-widest text-white/30 mb-1.5 font-bold">Game *</label>
                        <select
                            value={filterGame}
                            onChange={e => { setFilterGame(e.target.value); setFilterTrack(''); setFilterCar(''); }}
                            className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-3 text-sm text-white focus:border-[#2D9E49] focus:outline-none transition-colors appearance-none cursor-pointer"
                        >
                            <option value="">Select a game...</option>
                            {allGames.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                    </div>

                    {/* Track */}
                    <div>
                        <label className="block text-[10px] uppercase tracking-widest text-white/30 mb-1.5 font-bold">Track *</label>
                        <select
                            value={filterTrack}
                            onChange={e => { setFilterTrack(e.target.value); setFilterCar(''); }}
                            disabled={!filterGame}
                            className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-3 text-sm text-white focus:border-[#2D9E49] focus:outline-none transition-colors appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <option value="">{filterGame ? 'Select a track...' : 'Select a game first'}</option>
                            {tracksForGame.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>

                    {/* Car (optional) */}
                    <div>
                        <label className="block text-[10px] uppercase tracking-widest text-white/30 mb-1.5 font-bold">Car <span className="text-white/20">(optional)</span></label>
                        <select
                            value={filterCar}
                            onChange={e => setFilterCar(e.target.value)}
                            disabled={!filterTrack}
                            className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-3 text-sm text-white focus:border-[#2D9E49] focus:outline-none transition-colors appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <option value="">All cars</option>
                            {carsForTrack.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                {/* Row 2: period filter + count */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mt-6 pt-5 border-t border-white/5">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <span className="text-[10px] uppercase tracking-widest text-white/20 font-bold">Range:</span>
                        <div className="flex bg-black/30 p-1 rounded-xl border border-white/5 overflow-x-auto scrollbar-hide">
                            {(['all', 'daily', 'weekly', 'monthly'] as CompetitionFilter[]).map(p => (
                                <button
                                    key={p}
                                    onClick={() => { setCompetitionFilter(p); setPeriodOffset(0); }}
                                    className={`px-3 sm:px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex-shrink-0 ${competitionFilter === p ? 'bg-[#2D9E49] text-white shadow-lg' : 'text-white/40 hover:text-white'}`}
                                >
                                    {p === 'all' ? 'All Time' : p}
                                </button>
                            ))}
                        </div>
                    </div>

                    {competitionFilter !== 'all' && (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
                            <span className="text-[10px] uppercase tracking-widest text-white/20 font-bold flex-shrink-0">Period:</span>
                            <div className="flex items-center gap-2 min-w-0">
                                <div className="flex bg-black/30 p-1 rounded-xl border border-white/5 text-[10px] font-bold uppercase tracking-widest overflow-x-auto scrollbar-hide">
                                    <button
                                        onClick={() => setPeriodOffset(0)}
                                        className={`px-3 sm:px-4 py-1.5 rounded-lg transition-all ${periodOffset === 0 ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'} flex-shrink-0`}
                                    >
                                        {competitionFilter === 'daily' ? 'Today' : competitionFilter === 'weekly' ? 'This Week' : 'This Month'}
                                    </button>
                                    <button
                                        onClick={() => setPeriodOffset(-1)}
                                        className={`px-3 sm:px-4 py-1.5 rounded-lg transition-all ${periodOffset === -1 ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'} flex-shrink-0`}
                                    >
                                        {competitionFilter === 'daily' ? 'Yesterday' : competitionFilter === 'weekly' ? 'Last Week' : 'Last Month'}
                                    </button>
                                </div>
                                
                                <div className="relative flex items-center flex-shrink-0 bg-black/30 p-1 rounded-xl border border-white/5 z-50">
                                    <DatePicker
                                        selected={(() => {
                                            const bounds = getPeriodBounds(competitionFilter, periodOffset);
                                            return bounds ? bounds.start : new Date();
                                        })()}
                                        onChange={(date: Date) => {
                                            if (!date) return;
                                            const today = new Date();
                                            today.setHours(0, 0, 0, 0);
                                            const selected = new Date(date);
                                            selected.setHours(0, 0, 0, 0);
                                            
                                            const diffMs = selected.getTime() - today.getTime();
                                            const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
                                            
                                            if (competitionFilter === 'daily') setPeriodOffset(diffDays);
                                            else if (competitionFilter === 'weekly') setPeriodOffset(Math.floor(diffDays / 7));
                                            else if (competitionFilter === 'monthly') {
                                                const months = (selected.getFullYear() - today.getFullYear()) * 12 + (selected.getMonth() - today.getMonth());
                                                setPeriodOffset(months);
                                            }
                                        } }
                                        customInput={<CalendarInput />}
                                        popperPlacement="bottom-end"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="sm:ml-auto flex items-center">
                        <div className="text-[10px] uppercase tracking-widest text-white/20 font-bold">
                            {sorted.length} {sorted.length === 1 ? 'Record' : 'Records'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Leaderboard Table Container */}
            {loading ? (
                <div className="text-center py-20 text-white/30">Loading leaderboard...</div>
            ) : sorted.length === 0 ? (
                <div className="text-center py-20">
                    <Trophy size={48} className="mx-auto mb-4 text-white/10" />
                    <p className="text-white/30 text-sm">No approved lap times match your filters.</p>
                </div>
            ) : (
                <div className="rounded-2xl border border-white/10 overflow-hidden">
                    <div className="overflow-x-auto overflow-y-auto max-h-[60vh] custom-scrollbar">
                        <div className={`min-w-[920px] ${isAdmin ? 'min-w-[960px]' : ''}`}>
                        {/* Table Header */}
                        <div className={`sticky top-0 z-10 grid ${isAdmin ? 'grid-cols-[40px_minmax(220px,1fr)_150px_130px_120px_120px_100px_40px]' : 'grid-cols-[40px_minmax(220px,1fr)_150px_130px_120px_120px_100px]'} gap-3 px-5 py-3 bg-[#141414] border-b border-white/10 text-[10px] uppercase tracking-widest text-white/30`}>
                            <div className="text-center">#</div>
                            <button className="text-left hover:text-white/60 transition-colors" onClick={() => toggleSort('driverName')}>
                                Driver <SortIcon k="driverName" />
                            </button>
                            <button className="text-left hover:text-white/60 transition-colors" onClick={() => toggleSort('equipment')}>
                                Equipment <SortIcon k="equipment" />
                            </button>
                            <button className="text-left hover:text-white/60 transition-colors" onClick={() => toggleSort('game')}>
                                Game <SortIcon k="game" />
                            </button>
                            <div>Track</div>
                            <div>Car</div>
                            <button className="text-right hover:text-white/60 transition-colors" onClick={() => toggleSort('lapTimeMs')}>
                                Lap Time <SortIcon k="lapTimeMs" />
                            </button>
                            {isAdmin && <div className="text-center">Action</div>}
                        </div>

                        {/* Table Rows */}
                        <div className="flex flex-col">
                            {sorted.map((entry, i) => {
                                const eqColor = EQUIPMENT_COLORS[entry.equipment] || '#2D9E49';
                                const wins = entry.competitionWins;
                                const isTop3 = i < 3;
                                const rankColors = ['text-[#FFD700]', 'text-[#C0C0C0]', 'text-[#CD7F32]'];

                                return (
                                    <div
                                        key={entry.id}
                                        className={`grid ${isAdmin ? 'grid-cols-[40px_minmax(220px,1fr)_150px_130px_120px_120px_100px_40px]' : 'grid-cols-[40px_minmax(220px,1fr)_150px_130px_120px_120px_100px]'} gap-3 px-5 py-4 items-center border-b border-white/5 transition-colors hover:bg-white/[0.02] ${isTop3 ? 'bg-white/[0.01]' : ''}`}
                                    >
                                        <div className={`font-display font-bold text-center text-lg ${isTop3 ? rankColors[i] : 'text-white/20'}`}>
                                            {i + 1}
                                        </div>

                                        <div className="flex items-center gap-3 min-w-0">
                                            {entry.photoURL ? (
                                                <img src={entry.photoURL} alt={entry.driverName} className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-white/10" />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-[#141414] border border-white/10 flex items-center justify-center flex-shrink-0 text-white/30 text-xs font-bold">
                                                    {entry.driverName?.charAt(0)?.toUpperCase()}
                                                </div>
                                            )}
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-semibold text-sm truncate">{entry.driverName}</span>
                                                    {entry.isPro && <span className="text-[8px] font-black uppercase tracking-widest px-1 py-0.5 rounded bg-[#FFD700] text-black">PRO</span>}
                                                </div>
                                                {(wins?.total > 0 || entry.challengeId) && (
                                                    <div className="flex gap-1 mt-0.5 flex-wrap">
                                                        {entry.challengeId && <span className="text-[8px] font-bold uppercase tracking-tight bg-[#2D9E49]/20 text-[#2D9E49] px-1 py-0.5 rounded">Challenge</span>}
                                                        {wins?.daily > 0 && <span className="text-[9px] text-[#FFD700]">🏆 {wins.daily}</span>}
                                                        {wins?.weekly > 0 && <span className="text-[9px] text-[#C0C0C0]">🥇 {wins.weekly}</span>}
                                                        {wins?.monthly > 0 && <span className="text-[9px] text-[#CD7F32]">🎖️ {wins.monthly}</span>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 text-xs truncate">
                                            <span style={{ color: eqColor }}><EquipmentIcon type={entry.equipment} size={12} /></span>
                                            <span className="text-white/60">{EQUIPMENT_LABELS[entry.equipment]}</span>
                                        </div>
                                        <div className="text-xs text-white/60 truncate">{entry.game}</div>
                                        <div className="text-xs text-white/60 truncate">{entry.track}</div>
                                        <div className="text-xs text-white/60 truncate">{entry.car}</div>
                                        <div className="text-right font-mono font-bold text-[#2D9E49]">{entry.lapTime}</div>
                                        
                                        {isAdmin && (
                                            <button onClick={() => handleDeleteLapTime(entry.id)} className="text-white/10 hover:text-red-500 transition-colors flex justify-center"><Trash2 size={16} /></button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
            )}
        </>
    );

    const heroCards = [
        {
            type: 'daily' as CompetitionFilter,
            label: 'Beat the Pro',
            subLabel: activeDaily
                ? `Can you beat ${activeDaily.setByName}'s ${activeDaily.referenceTime}?`
                : 'No active challenge today',
            icon: Trophy,
            image: '/images/kartcade/btp-logo.png',
            comp: activeDaily,
            glowColor: '#FFD700',
            borderColor: 'border-[#FFD700]/40',
            bgGlow: 'from-[#FFD700]/10',
            iconColor: 'text-[#FFD700]',
            reward: '1 Credit',
        },
        {
            type: 'weekly' as CompetitionFilter,
            label: 'Weekly Challenge',
            subLabel: activeWeekly
                ? `Beat ${activeWeekly.referenceTime} to win 3 credits`
                : 'No active challenge this week',
            icon: Medal,
            comp: activeWeekly,
            glowColor: '#C0C0C0',
            borderColor: 'border-[#C0C0C0]/40',
            bgGlow: 'from-[#C0C0C0]/10',
            iconColor: 'text-[#C0C0C0]',
            reward: '3 Credits',
        },
        {
            type: 'monthly' as CompetitionFilter,
            label: 'Monthly Challenge',
            subLabel: activeMonthly
                ? `Beat ${activeMonthly.referenceTime} to win 5 credits`
                : 'No active challenge this month',
            icon: Award,
            comp: activeMonthly,
            glowColor: '#CD7F32',
            borderColor: 'border-[#CD7F32]/40',
            bgGlow: 'from-[#CD7F32]/10',
            iconColor: 'text-[#CD7F32]',
            reward: '5 Credits',
        },
    ];

    return (
        <div className="min-h-screen bg-[#0A0A0A] text-white">
            <div className="h-20" />

            <div className="max-w-7xl mx-auto px-4 md:px-6 py-12">

                {/* ── Page Header ── */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 bg-[#2D9E49]/10 border border-[#2D9E49]/30 rounded-full px-4 py-1 mb-4">
                        <Trophy size={14} className="text-[#2D9E49]" />
                        <span className="text-xs uppercase tracking-widest text-[#2D9E49] font-bold">Kartcade Racing</span>
                    </div>
                    <h1 className="font-display text-5xl md:text-6xl font-bold uppercase mb-4 tracking-tight">
                        Fastest<br />
                        <span className="text-[#2D9E49]">Lap Times</span>
                    </h1>
                    <p className="text-white/50 max-w-xl mx-auto">
                        Beat the reference time to win free credits. Daily, weekly &amp; monthly prizes up for grabs.
                    </p>
                </div>

                {/* ── Layer 1: Hero Competition Cards ── */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 mb-6">
                    {heroCards.map(({ type, label, subLabel, icon: Icon, image, comp, borderColor, bgGlow, iconColor, reward, glowColor }) => {
                        const isActive = competitionFilter === type;
                        return (
                            <React.Fragment key={type}>
                                <button
                                    onClick={() => {
                                        if (isActive) {
                                            setCompetitionFilter('all');
                                            setPeriodOffset(0);
                                        } else {
                                            setCompetitionFilter(type);
                                            setPeriodOffset(0);
                                            if (comp) {
                                                setFilterGame(comp.game);
                                                setFilterTrack(comp.track);
                                                setFilterCar(comp.car || '');
                                            }
                                        }
                                    }}
                                    className={`relative group rounded-2xl border-2 p-5 sm:p-6 text-left transition-all duration-300 overflow-hidden
                                        ${isActive
                                            ? `${borderColor} bg-gradient-to-br ${bgGlow} to-transparent`
                                            : 'border-white/10 bg-[#141414] hover:border-white/25'
                                        }`}
                                    style={isActive ? { boxShadow: `0 0 40px ${glowColor}25` } : {}}
                                >
                                    {/* Glow pulse when active */}
                                    {isActive && (
                                        <div
                                            className="absolute inset-0 rounded-2xl opacity-20 animate-pulse"
                                            style={{ background: `radial-gradient(circle at 30% 30%, ${glowColor}40, transparent 70%)` }}
                                        />
                                    )}

                                    <div className="relative z-10">
                                        <div className="flex items-center justify-between mb-4">
                                            {image ? (
                                                <img src={image} alt={label} className="h-8 object-contain" />
                                            ) : (
                                                <Icon size={32} className={`${iconColor} ${isActive ? '' : 'opacity-40 group-hover:opacity-70'} transition-opacity`} />
                                            )}
                                            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${isActive ? `${iconColor} ${borderColor}` : 'text-white/30 border-white/10'}`}>
                                                Prize: {reward}
                                            </span>
                                        </div>

                                        <h3 className={`font-display text-xl font-bold uppercase ${isActive ? iconColor : 'text-white'}`}>
                                            {label}
                                        </h3>
                                    </div>

                                    {/* Mobile Accordion Indicator */}
                                    <div className="md:hidden absolute bottom-4 right-4 text-white/20">
                                        {isActive ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                    </div>
                                </button>

                                {/* ── Mobile Accordion Content ── */}
                                {isActive && (
                                    <div className="md:hidden mt-1 mb-8 animate-in fade-in slide-in-from-top-4 duration-300 min-w-0 w-full">
                                        {/* Description with BTP CTA (reused from below) */}
                                        <div className={`p-5 rounded-2xl border ${borderColor} bg-white/[0.02] mb-4 text-sm`}>
                                            <p className="text-white font-medium mb-1.5 leading-relaxed">{subLabel}</p>
                                            {comp ? (
                                                <p className="text-xs text-white/40 mb-5">
                                                    {EQUIPMENT_LABELS[comp.equipment] || comp.equipment} · {comp.track} · {comp.car}
                                                </p>
                                            ) : (
                                                <p className="text-xs text-white/30 mb-4">No active competition for this period.</p>
                                            )}
                                            
                                            {type === 'daily' && (
                                                <div className="pt-2">
                                                    {renderBtpCta(type)}
                                                </div>
                                            )}
                                        </div>

                                        {/* The Leaderboard Content */}
                                        {renderLeaderboardContent(true)}
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* ── Layer 2: Desktop/Tablet Stable Section ── */}
                <div className={competitionFilter === 'all' ? 'block' : 'hidden md:block'}>
                    {/* Active Card Description (Desktop Only) */}
                    {competitionFilter !== 'all' && (
                        <div className="mb-10 animate-in fade-in slide-in-from-top-4 duration-500">
                            {(() => {
                                const card = heroCards.find(c => c.type === competitionFilter);
                                if (!card) return null;
                                return (
                                    <div className={`p-6 rounded-2xl border ${card.borderColor} bg-white/[0.02]`}>
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                            <div>
                                                <p className="text-white font-medium mb-1">{card.subLabel}</p>
                                                {card.comp ? (
                                                    <p className="text-xs text-white/40">
                                                        {EQUIPMENT_LABELS[card.comp.equipment] || card.comp.equipment} · {card.comp.track} · {card.comp.car}
                                                    </p>
                                                ) : (
                                                    <p className="text-xs text-white/30">No active competition for this period.</p>
                                                )}
                                            </div>

                                            {competitionFilter === 'daily' && (
                                                <div className="flex-shrink-0">
                                                    {renderBtpCta('daily')}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {renderLeaderboardContent()}
                </div>

                {/* ── Footer CTA ── */}
                <div className="mt-12 text-center">
                    <div className="inline-flex items-center gap-2 text-white/30 text-sm">
                        <Clock size={14} />
                        <span>Log in to submit your fastest lap from your dashboard</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── Game names ─────────────────────────────────────────────────────────
// Lap times are typed in by hand, so normalize common misspellings and hide
// records whose game is not one we run (e.g. a driver's name typed into the game field).
const KNOWN_GAMES = [
    'Assetto Corsa', 'Assetto Corsa Competizione', 'Assetto Corsa Rally', 'Automobilista 2',
    'BeamNG', 'F1 25', 'Grid Legends', 'Le Mans Ultimate',
];
const GAME_ALIASES: Record<string, string> = {
    'asseto corsa': 'Assetto Corsa',
    'assetto': 'Assetto Corsa',
    'ac': 'Assetto Corsa',
    'acc': 'Assetto Corsa Competizione',
    'beamng.drive': 'BeamNG',
    'f1': 'F1 25',
    'grid': 'Grid Legends',
    'lmu': 'Le Mans Ultimate',
    'ams2': 'Automobilista 2',
};
function canonicalGame(raw: string | undefined): string | null {
    const g = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!g) return null;
    const exact = KNOWN_GAMES.find(k => k.toLowerCase() === g.toLowerCase());
    if (exact) return exact;
    return GAME_ALIASES[g.toLowerCase()] || null;
}

export default LeaderboardPage;
