// /competitions — live competitions fed by the rig lap timer, what's coming up, and the archive.
// /competitions/:id — one competition's full, live results.
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteDoc, doc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import {
    CompetitionEntry, LiveCompetition, comboLabel, fmtDate, fmtDateTime, fmtWindow, gapText, phaseOf, sortEntries,
} from '../config/competitions';
import { backfillEntries, COMPS, useCompetition, useCompetitions, useEntries } from '../components/competitions/data';
import CompetitionForm from '../components/competitions/CompetitionForm';
import '../components/home/broadcast.css';
import '../components/competitions/competitions.css';

const equipLabel: Record<string, string> = { rigs: 'Full-size rigs', motion: 'Motion simulator', karts: 'Karts', '': 'Any simulator' };

function useNow(ms = 30_000) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
    return now;
}

function timeLeft(endMs: number, now: number) {
    const m = Math.max(0, Math.round((endMs - now) / 60000));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d >= 2) return `${d} days left`;
    if (d === 1) return `1 day ${h} hr left`;
    if (h) return `${h} hr ${mm} min left`;
    return `${mm} min left`;
}

const Phase: React.FC<{ c: LiveCompetition; now: number }> = ({ c, now }) => {
    const p = phaseOf(c, now);
    return (
        <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <span className={`phase ${p}`}>{p === 'live' ? 'Live' : p === 'upcoming' ? 'Coming up' : 'Final'}</span>
            {c.hidden && <span className="phase hidden">Hidden</span>}
        </span>
    );
};

const Board: React.FC<{ comp: LiveCompetition; max: number }> = ({ comp, max }) => {
    const entries = useEntries(comp.id, max);
    const list = entries ? sortEntries(entries) : null;
    return (
        <div className="board">
            <table>
                <tbody>
                    {list === null && <tr><td className="pos">…</td><td className="who">Loading times</td><td className="t">--:--.---</td></tr>}
                    {list?.map((e, i) => (
                        <tr key={e.id}>
                            <td className="pos">{i + 1}</td>
                            <td className="who">{e.driverName}{!comp.carId && e.car && <small>{e.car}</small>}</td>
                            <td className="t">{e.lapTime}</td>
                        </tr>
                    ))}
                    {list && list.length < max && phaseOf(comp) !== 'ended' && (
                        <tr className="you"><td className="pos">{list.length + 1}</td><td className="who">{list.length ? 'Your name here' : 'No times yet. Set the first one.'}</td><td className="t">--:--.---</td></tr>
                    )}
                    {list && list.length === 0 && phaseOf(comp) === 'ended' && <tr><td className="pos">-</td><td className="who">No laps were set</td><td className="t" /></tr>}
                </tbody>
            </table>
        </div>
    );
};

const Winner: React.FC<{ comp: LiveCompetition }> = ({ comp }) => {
    const top = useEntries(comp.id, 1);
    if (!top) return <span className="win">…</span>;
    if (!top.length) return <span className="win">No laps</span>;
    return <span className="win"><b>{top[0].lapTime}</b>{top[0].driverName}</span>;
};

export const CompetitionsPage: React.FC = () => {
    const { isAdmin } = useAuth();
    const comps = useCompetitions(!!isAdmin);
    const now = useNow();
    const [showForm, setShowForm] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        document.title = 'Competitions | Live Lap Times | Kartcade West Linn';
        document.querySelector('meta[name="description"]')?.setAttribute('content', 'Live sim racing competitions at Kartcade. One track, one car, a set window: every lap on the rigs posts to the live board automatically. Past results in the archive.');
    }, []);

    const live = comps?.filter((c) => phaseOf(c, now) === 'live') || [];
    const upcoming = (comps?.filter((c) => phaseOf(c, now) === 'upcoming') || []).reverse();
    const ended = comps?.filter((c) => phaseOf(c, now) === 'ended').sort((a, b) => b.endAt.toMillis() - a.endAt.toMillis()) || [];

    return (
        <div className="bc comp-page">
            <div className="wrap">
                <section>
                    <span className="eyebrow">Kartcade lap timer</span>
                    <h1>Competitions</h1>
                    <p className="lede">One track, a set window, a live board. Drive the competition track on a rig and every lap posts automatically, no forms. Fastest lap when the window closes wins.</p>
                    <div className="ctas">
                        <Link className="btn btn-red" to="/book">Book a rig</Link>
                        <Link className="btn btn-ghost" to="/leaderboard">All-time leaderboard</Link>
                        {isAdmin && !showForm && <button className="btn btn-ghost" onClick={() => setShowForm(true)}>New competition</button>}
                    </div>
                </section>

                {isAdmin && showForm && (
                    <section><CompetitionForm onCancel={() => setShowForm(false)} onDone={(id) => { setShowForm(false); navigate(`/competitions/${id}`); }} /></section>
                )}

                <section>
                    <h2 className="sub">Live now</h2>
                    {comps === null ? <div className="comp-empty">Loading…</div>
                        : live.length === 0 ? <div className="comp-empty">Nothing running right now.{upcoming.length ? ' The next one is below.' : ' Check back soon, or set a time on the all-time leaderboard.'}</div>
                            : (
                                <div className={`comp-live${live.length > 1 ? ' two' : ''}`}>
                                    {live.map((c) => (
                                        <article className="comp-card" key={c.id}>
                                            <div className="top">
                                                <Phase c={c} now={now} />
                                                <h3>{c.name}</h3>
                                                <div className="combo">{comboLabel(c)} · {equipLabel[c.equipment ?? '']}</div>
                                                <div className="when">{fmtWindow(c)} · {timeLeft(c.endAt.toMillis(), now)}</div>
                                                {c.prize && <div className="prize">Prize: {c.prize}</div>}
                                            </div>
                                            <Board comp={c} max={5} />
                                            <div className="more"><span className="mono" style={{ color: 'var(--muted)', fontSize: 13 }}>Updates live</span><Link to={`/competitions/${c.id}`}>Full results</Link></div>
                                        </article>
                                    ))}
                                </div>
                            )}
                </section>

                {upcoming.length > 0 && (
                    <section>
                        <h2 className="sub">Coming up</h2>
                        <div className="comp-list">
                            {upcoming.map((c) => (
                                <Link className="comp-row" key={c.id} to={`/competitions/${c.id}`}>
                                    <div><div className="name">{c.name}</div><div className="meta">{comboLabel(c)} · starts {fmtDateTime(c.startAt)}</div></div>
                                    <Phase c={c} now={now} />
                                </Link>
                            ))}
                        </div>
                    </section>
                )}

                <section>
                    <h2 className="sub">Archive</h2>
                    {comps !== null && ended.length === 0 ? <div className="comp-empty">Finished competitions and their results will be kept here.</div> : (
                        <div className="comp-list">
                            {ended.map((c) => (
                                <Link className="comp-row" key={c.id} to={`/competitions/${c.id}`}>
                                    <div><div className="name">{c.name}{c.hidden ? ' (hidden)' : ''}</div><div className="meta">{comboLabel(c)} · {fmtWindow(c)}</div></div>
                                    <Winner comp={c} />
                                </Link>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export const CompetitionDetailPage: React.FC = () => {
    const { id } = useParams();
    const { isAdmin } = useAuth();
    const comp = useCompetition(id);
    const entries = useEntries(id);
    const now = useNow(15_000);
    const navigate = useNavigate();
    const [editing, setEditing] = useState(false);
    const [adminMsg, setAdminMsg] = useState('');

    // Flash rows that changed since the last update.
    const seen = useRef<Map<string, number> | null>(null);
    const [fresh, setFresh] = useState<Set<string>>(new Set());
    useEffect(() => {
        if (!entries) return;
        const next = new Map(entries.map((e) => [e.id, e.lapTimeMs]));
        if (seen.current) setFresh(new Set(entries.filter((e) => seen.current!.get(e.id) !== e.lapTimeMs).map((e) => e.id)));
        seen.current = next;
    }, [entries]);

    useEffect(() => {
        if (comp) document.title = `${comp.name} | Competitions | Kartcade`;
    }, [comp]);

    if (comp === undefined) return <div className="bc comp-page"><div className="wrap"><p className="lede">Loading…</p></div></div>;
    if (comp === null) return (
        <div className="bc comp-page"><div className="wrap">
            <Link className="back" to="/competitions">← All competitions</Link>
            <h1>Not found</h1><p className="lede">This competition doesn't exist or isn't public yet.</p>
        </div></div>
    );

    const phase = phaseOf(comp, now);
    const list = entries ? sortEntries(entries) : null;
    const leader = list?.[0]?.lapTimeMs || 0;

    const removeEntry = async (e: CompetitionEntry) => {
        if (!window.confirm(`Remove ${e.driverName}'s ${e.lapTime} from this competition? Their lap stays on the all-time leaderboard.`)) return;
        await deleteDoc(doc(db, COMPS, comp.id, 'entries', e.id));
    };
    const endNow = async () => {
        if (!window.confirm('End this competition now? The board freezes and it moves to the archive.')) return;
        await updateDoc(doc(db, COMPS, comp.id), { endAt: Timestamp.now() });
    };
    const toggleHidden = () => updateDoc(doc(db, COMPS, comp.id), { hidden: !comp.hidden });
    const runBackfill = async () => {
        setAdminMsg('Checking rig laps…');
        try { const n = await backfillEntries(comp); setAdminMsg(n ? `Added ${n} lap${n > 1 ? 's' : ''}.` : 'Nothing new to add.'); }
        catch { setAdminMsg('Could not read lap times.'); }
    };
    const remove = async () => {
        if (!window.confirm('Delete this competition and its results for good? (Laps stay on the all-time leaderboard.)')) return;
        await deleteDoc(doc(db, COMPS, comp.id));
        navigate('/competitions');
    };

    return (
        <div className="bc comp-page">
            <div className="wrap">
                <section>
                    <Link className="back" to="/competitions">← All competitions</Link>
                    <div><Phase c={comp} now={now} /></div>
                    <h1 style={{ marginTop: 14 }}>{comp.name}</h1>
                    {comp.description && <p className="lede">{comp.description}</p>}
                    <div className="facts">
                        <span><b>Track</b> {comp.trackName || comp.trackLabel || comp.trackId}{!comp.trackName ? ' (any layout)' : ''}</span>
                        <span><b>Car</b> {comp.carId ? comp.carName : 'Any'}</span>
                        <span><b>Simulators</b> {equipLabel[comp.equipment ?? '']}</span>
                        <span><b>{phase === 'upcoming' ? 'Opens' : 'Opened'}</b> {fmtDateTime(comp.startAt)}</span>
                        <span><b>{phase === 'ended' ? 'Closed' : 'Closes'}</b> {fmtDateTime(comp.endAt)}{phase === 'live' ? ` (${timeLeft(comp.endAt.toMillis(), now)})` : ''}</span>
                        {comp.prize && <span><b>Prize</b> {comp.prize}</span>}
                    </div>
                    {phase !== 'ended' && (
                        <div className="ctas"><Link className="btn btn-red" to="/book">Book a rig and set a time</Link></div>
                    )}
                </section>

                <section>
                    <h2 className="sub">{phase === 'ended' ? 'Final results' : 'Live results'}</h2>
                    <div className="results-wrap">
                        <table className="results">
                            <thead><tr><th>Pos</th><th>Driver</th>{!comp.carId && <th className="hide-sm">Car</th>}<th className="hide-sm">Set</th><th style={{ textAlign: 'right' }}>Lap</th><th style={{ textAlign: 'right' }}>Gap</th>{isAdmin && <th />}</tr></thead>
                            <tbody>
                                {list === null && <tr><td className="pos">…</td><td colSpan={5}>Loading times</td></tr>}
                                {list?.length === 0 && <tr><td className="pos">-</td><td colSpan={5} style={{ color: 'var(--muted)' }}>{phase === 'upcoming' ? `Opens ${fmtDateTime(comp.startAt)}.` : phase === 'live' ? 'No times yet. The first lap on a rig shows up here within seconds.' : 'No laps were set.'}</td></tr>}
                                {list?.map((e, i) => (
                                    <tr key={e.id} className={`${i < 3 ? `p${i + 1}` : ''}${fresh.has(e.id) ? ' new' : ''}`}>
                                        <td className="pos">{i + 1}</td>
                                        <td className="d">{e.driverName}{e.rigId && <small>Rig {e.rigId}</small>}</td>
                                        {!comp.carId && <td className="hide-sm">{e.car}</td>}
                                        <td className="hide-sm" style={{ color: 'var(--muted)' }}>{fmtDate(e.at)}</td>
                                        <td className="t">{e.lapTime}</td>
                                        <td className="gap">{gapText(e.lapTimeMs, leader)}</td>
                                        {isAdmin && <td><button className="x" onClick={() => removeEntry(e)}>Remove</button></td>}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {isAdmin && (
                    <section>
                        {editing
                            ? <CompetitionForm existing={comp} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
                            : (
                                <div className="admin-box">
                                    <h3>Admin</h3>
                                    <div className="row-btns">
                                        <button className="btn btn-ghost" onClick={() => setEditing(true)}>Edit</button>
                                        <button className="btn btn-ghost" onClick={toggleHidden}>{comp.hidden ? 'Make public' : 'Hide'}</button>
                                        <button className="btn btn-ghost" onClick={runBackfill}>Add laps already set</button>
                                        {phase === 'live' && <button className="btn btn-ghost" onClick={endNow}>End now</button>}
                                        <button className="btn btn-ghost btn-danger" onClick={remove}>Delete</button>
                                    </div>
                                    {adminMsg && <div className="msg">{adminMsg}</div>}
                                </div>
                            )}
                    </section>
                )}
            </div>
        </div>
    );
};

export default CompetitionsPage;
