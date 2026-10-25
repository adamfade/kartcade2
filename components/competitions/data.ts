import { useEffect, useState } from 'react';
import {
    collection, doc, getDocs, limit, onSnapshot, orderBy, query, Timestamp, where, writeBatch,
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { CompetitionEntry, LiveCompetition, driverKeyFor } from '../../config/competitions';

export const COMPS = 'live_competitions';

/** All competitions, newest window first. Admins also see hidden ones. */
export function useCompetitions(isAdmin: boolean) {
    const [list, setList] = useState<LiveCompetition[] | null>(null);
    useEffect(() => {
        const q = isAdmin ? query(collection(db, COMPS)) : query(collection(db, COMPS), where('hidden', '==', false));
        return onSnapshot(q, (snap) => {
            const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as LiveCompetition)).filter((c) => c.startAt && c.endAt);
            all.sort((a, b) => b.startAt.toMillis() - a.startAt.toMillis());
            setList(all);
        }, () => setList([]));
    }, [isAdmin]);
    return list;
}

export function useCompetition(id: string | undefined) {
    const [comp, setComp] = useState<LiveCompetition | null | undefined>(undefined);
    useEffect(() => {
        if (!id) return;
        return onSnapshot(doc(db, COMPS, id), (d) => setComp(d.exists() ? ({ id: d.id, ...d.data() } as LiveCompetition) : null), () => setComp(null));
    }, [id]);
    return comp;
}

/** Live entries, fastest first. */
export function useEntries(compId: string | undefined, max?: number) {
    const [entries, setEntries] = useState<CompetitionEntry[] | null>(null);
    useEffect(() => {
        if (!compId) return;
        const base = collection(db, COMPS, compId, 'entries');
        const q = max ? query(base, orderBy('lapTimeMs'), limit(max)) : query(base, orderBy('lapTimeMs'));
        return onSnapshot(q, (snap) => setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CompetitionEntry))), () => setEntries([]));
    }, [compId, max]);
    return entries;
}

export interface Combo { trackId: string; trackName: string; cars: { carId: string; carName: string }[]; laps: number; lastMs: number }

/** Track and car combos the rigs have reported, so admins pick exact names instead of typing them. */
export async function loadRigCombos(): Promise<Combo[]> {
    const snap = await getDocs(query(collection(db, 'lap_times'), where('source', '==', 'rig')));
    const map = new Map<string, Combo>();
    snap.docs.forEach((d) => {
        const l = d.data() as any;
        if (!l.trackId) return;
        const key = `${l.trackId}|${l.track || ''}`;
        const c = map.get(key) || { trackId: l.trackId, trackName: l.track || '', cars: [], laps: 0, lastMs: 0 };
        c.laps++;
        c.lastMs = Math.max(c.lastMs, l.updatedAt?.toMillis?.() || l.submittedAt?.toMillis?.() || 0);
        if (l.carId && !c.cars.some((x) => x.carId === l.carId)) c.cars.push({ carId: l.carId, carName: l.car || l.carId });
        map.set(key, c);
    });
    return [...map.values()].sort((a, b) => b.lastMs - a.lastMs);
}

/**
 * Add rig laps already set inside the window (for a competition created after racing started,
 * or one whose window was changed). Keeps each driver's best; never makes an entry slower.
 */
export async function backfillEntries(comp: LiveCompetition): Promise<number> {
    const snap = await getDocs(query(collection(db, 'lap_times'), where('trackId', '==', comp.trackId)));
    const start = comp.startAt.toMillis(), end = comp.endAt.toMillis();
    const best = new Map<string, any>();
    snap.docs.forEach((d) => {
        const l = d.data() as any;
        if (l.status !== 'approved' || !l.lapTimeMs) return;
        if (comp.trackName && l.track !== comp.trackName) return;
        if (comp.carId && l.carId !== comp.carId) return;
        if (comp.equipment && l.equipment !== comp.equipment) return;
        const at = l.bestAt?.toMillis?.() || l.submittedAt?.toMillis?.() || 0;
        if (at < start || at > end) return;
        const key = driverKeyFor(l.userId, l.driverName || 'Driver');
        const cur = best.get(key);
        if (!cur || l.lapTimeMs < cur.lapTimeMs) best.set(key, { ...l, _at: l.bestAt || l.submittedAt });
    });
    const existing = await getDocs(collection(db, COMPS, comp.id, 'entries'));
    const have = new Map(existing.docs.map((d) => [d.id, (d.data() as any).lapTimeMs as number]));
    const batch = writeBatch(db);
    let n = 0;
    best.forEach((l, key) => {
        const prev = have.get(key);
        if (prev && prev <= l.lapTimeMs) return;
        batch.set(doc(db, COMPS, comp.id, 'entries', key), {
            driverName: l.driverName || 'Driver', userId: l.userId || '', photoURL: l.photoURL || '',
            lapTimeMs: l.lapTimeMs, lapTime: l.lapTime, car: l.car || '', rigId: l.rigId || '', sessionId: l.sessionId || '',
            at: l._at instanceof Timestamp ? l._at : Timestamp.now(),
        });
        n++;
    });
    if (n) await batch.commit();
    return n;
}
