// Admin form to create or edit a live competition. Track and car come from what the rigs have reported.
import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { LiveCompetition } from '../../config/competitions';
import { backfillEntries, Combo, COMPS, loadRigCombos } from './data';

const toLocalInput = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const defaultStart = () => { const d = new Date(); d.setMinutes(0, 0, 0); return d; };
const defaultEnd = () => { const d = new Date(); d.setDate(d.getDate() + 30); d.setHours(21, 0, 0, 0); return d; };

interface Props { existing?: LiveCompetition; onDone?: (id: string) => void; onCancel?: () => void }

const CompetitionForm: React.FC<Props> = ({ existing, onDone, onCancel }) => {
    const [combos, setCombos] = useState<Combo[] | null>(null);
    const [name, setName] = useState(existing?.name || '');
    const [description, setDescription] = useState(existing?.description || '');
    const [prize, setPrize] = useState(existing?.prize || '');
    const [trackKey, setTrackKey] = useState(existing ? `${existing.trackId}|${existing.trackName}` : '');
    const [anyLayout, setAnyLayout] = useState(existing ? !existing.trackName : false);
    const [carId, setCarId] = useState(existing?.carId || '');
    const [equipment, setEquipment] = useState(existing?.equipment ?? 'rigs');
    const [start, setStart] = useState(toLocalInput(existing ? existing.startAt.toDate() : defaultStart()));
    const [end, setEnd] = useState(toLocalInput(existing ? existing.endAt.toDate() : defaultEnd()));
    const [hidden, setHidden] = useState(existing?.hidden ?? false);
    const [backfill, setBackfill] = useState(true);
    const [manualTrack, setManualTrack] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');

    useEffect(() => { loadRigCombos().then(setCombos).catch(() => setCombos([])); }, []);

    const combo = useMemo(() => combos?.find((c) => `${c.trackId}|${c.trackName}` === trackKey), [combos, trackKey]);
    // When "any layout" is on, offer cars seen on every layout of that track.
    const cars = useMemo(() => {
        if (!combo || !combos) return existing?.carId ? [{ carId: existing.carId, carName: existing.carName }] : [];
        const pool = anyLayout ? combos.filter((c) => c.trackId === combo.trackId).flatMap((c) => c.cars) : combo.cars;
        const seen = new Map(pool.map((c) => [c.carId, c]));
        if (existing?.carId && !seen.has(existing.carId)) seen.set(existing.carId, { carId: existing.carId, carName: existing.carName });
        return [...seen.values()].sort((a, b) => a.carName.localeCompare(b.carName));
    }, [combo, combos, anyLayout, existing]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr(''); setMsg('');
        let trackId = combo?.trackId || existing?.trackId || '';
        let trackName = combo?.trackName ?? existing?.trackName ?? '';
        if (trackKey === '__manual') { trackId = manualTrack.trim(); trackName = ''; }
        if (!name.trim()) return setErr('Give it a name.');
        if (!trackId) return setErr('Pick a track.');
        const s = new Date(start), en = new Date(end);
        if (!(s < en)) return setErr('The end has to be after the start.');
        const car = cars.find((c) => c.carId === carId);
        const data = {
            name: name.trim(), description: description.trim(), prize: prize.trim(),
            game: 'Assetto Corsa', trackId, trackName: anyLayout || trackKey === '__manual' ? '' : trackName,
            trackLabel: (anyLayout ? trackName.replace(/\s*\([^)]*\)$/, '') : trackName) || trackId,
            carId, carName: carId ? car?.carName || carId : '',
            equipment, startAt: Timestamp.fromDate(s), endAt: Timestamp.fromDate(en), hidden,
        };
        setBusy(true);
        try {
            let id = existing?.id;
            if (id) await updateDoc(doc(db, COMPS, id), { ...data, updatedAt: serverTimestamp() });
            else id = (await addDoc(collection(db, COMPS), { ...data, createdAt: serverTimestamp() })).id;
            let added = 0;
            if (backfill) added = await backfillEntries({ id, ...data } as LiveCompetition);
            setMsg(existing ? `Saved.${added ? ` Added ${added} earlier lap${added > 1 ? 's' : ''}.` : ''}` : `Created.${added ? ` ${added} lap${added > 1 ? 's' : ''} already set in the window were added.` : ''}`);
            onDone?.(id);
        } catch (e2: any) {
            setErr(e2?.code === 'permission-denied' ? 'Not allowed. Sign in with an admin account (and make sure the new Firestore rules are published).' : 'Could not save. Try again.');
        } finally { setBusy(false); }
    };

    return (
        <form className="admin-box" onSubmit={submit}>
            <h3>{existing ? 'Edit competition' : 'New competition'}</h3>
            <p className="note">Only admins see this. Laps from the rig lap timer that match the track (and car, if you pick one) during the window post here automatically.</p>
            <div className="admin-grid">
                <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="November Hot Lap: Spa" maxLength={80} /></label>
                <label>Prize (optional)<input value={prize} onChange={(e) => setPrize(e.target.value)} placeholder="Free hour for the fastest lap" maxLength={120} /></label>
                <label>Track
                    <select value={trackKey} onChange={(e) => { setTrackKey(e.target.value); setCarId(''); }}>
                        <option value="">{combos === null ? 'Loading tracks from the rigs…' : 'Pick a track'}</option>
                        {existing && !combo && trackKey !== '__manual' && <option value={trackKey}>{existing.trackName || existing.trackId}</option>}
                        {combos?.map((c) => <option key={`${c.trackId}|${c.trackName}`} value={`${c.trackId}|${c.trackName}`}>{c.trackName || c.trackId} ({c.trackId}, {c.laps} session{c.laps === 1 ? '' : 's'})</option>)}
                        <option value="__manual">Not listed: type the Assetto Corsa track id</option>
                    </select>
                </label>
                {trackKey === '__manual'
                    ? <label>Track id (folder name in content/tracks)<input value={manualTrack} onChange={(e) => setManualTrack(e.target.value)} placeholder="spa" /></label>
                    : <label className="check"><input type="checkbox" checked={anyLayout} onChange={(e) => setAnyLayout(e.target.checked)} />Any layout of this track</label>}
                <label>Car
                    <select value={carId} onChange={(e) => setCarId(e.target.value)}>
                        <option value="">Any car</option>
                        {cars.map((c) => <option key={c.carId} value={c.carId}>{c.carName}</option>)}
                    </select>
                </label>
                <label>Simulators
                    <select value={equipment} onChange={(e) => setEquipment(e.target.value)}>
                        <option value="rigs">Full-size rigs</option>
                        <option value="motion">Motion simulator</option>
                        <option value="karts">Karts</option>
                        <option value="">Any</option>
                    </select>
                </label>
                <label>Starts<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
                <label>Ends<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            </div>
            <label>Description (optional)<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} placeholder="One car, one track, all month. Fastest lap wins." /></label>
            <label className="check"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />Hidden: only admins can see it (laps still post, handy for a test run)</label>
            <label className="check"><input type="checkbox" checked={backfill} onChange={(e) => setBackfill(e.target.checked)} />Also add laps already set on the rigs during this window</label>
            {err && <div className="err">{err}</div>}
            {msg && <div className="msg">{msg}</div>}
            <div className="row-btns">
                <button className="btn btn-red" type="submit" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Create competition'}</button>
                {onCancel && <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>}
            </div>
        </form>
    );
};

export default CompetitionForm;
