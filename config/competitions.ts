// Live competitions: a track (and optionally a car) over a date window.
// Laps from the rig Lap Timer that match are posted automatically by /api/rig-laps.
//
// Firestore:
//   live_competitions/{id}            the competition (admin-written, public read)
//   live_competitions/{id}/entries/{driverKey}
//                                     each driver's best matching lap in the window
//
// (The older `competitions` collection is Beat the Pro's reference-time challenges; separate on purpose.)
import { Timestamp } from 'firebase/firestore';

export interface LiveCompetition {
    id: string;
    name: string;
    description?: string;
    prize?: string;
    game: string;          // 'Assetto Corsa'
    trackId: string;       // AC track id, e.g. 'spa'
    trackName: string;     // display name as the rig reports it, incl. layout; '' = any layout
    trackLabel?: string;   // name to show (set even when any layout counts)
    carId: string;         // AC car id; '' = any car
    carName: string;
    equipment: string;     // 'rigs' | 'karts' | 'motion' | '' (any)
    startAt: Timestamp;
    endAt: Timestamp;
    hidden?: boolean;      // admin-only while being set up
    createdAt?: Timestamp;
}

export interface CompetitionEntry {
    id: string;            // driver key
    driverName: string;
    userId?: string;
    photoURL?: string;
    lapTimeMs: number;
    lapTime: string;
    car?: string;
    rigId?: string;
    sessionId?: string;
    at?: Timestamp;
}

export type CompetitionPhase = 'upcoming' | 'live' | 'ended';

export const phaseOf = (c: Pick<LiveCompetition, 'startAt' | 'endAt'>, now = Date.now()): CompetitionPhase => {
    const s = c.startAt?.toMillis?.() ?? 0;
    const e = c.endAt?.toMillis?.() ?? 0;
    if (now < s) return 'upcoming';
    if (now <= e) return 'live';
    return 'ended';
};

const TZ = 'America/Los_Angeles';
export const fmtDate = (t?: Timestamp) =>
    t ? t.toDate().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }) : '';
export const fmtDateTime = (t?: Timestamp) =>
    t ? t.toDate().toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export const fmtWindow = (c: Pick<LiveCompetition, 'startAt' | 'endAt'>) => `${fmtDate(c.startAt)} to ${fmtDate(c.endAt)}`;

export const sortEntries = (list: CompetitionEntry[]) =>
    [...list].sort((a, b) => a.lapTimeMs - b.lapTimeMs || (a.at?.toMillis?.() ?? 0) - (b.at?.toMillis?.() ?? 0));

export const gapText = (ms: number, leaderMs: number) => (ms === leaderMs ? '' : `+${((ms - leaderMs) / 1000).toFixed(3)}`);

export const comboLabel = (c: Pick<LiveCompetition, 'trackName' | 'trackLabel' | 'trackId' | 'carName' | 'carId'>) =>
    `${c.trackName || c.trackLabel || c.trackId}${c.carId ? ` · ${c.carName || c.carId}` : ' · any car'}`;

/** Same driver key the API uses: the linked account, else the typed name. */
export const driverKeyFor = (userId: string | undefined, name: string) =>
    userId ? `u_${userId}` : `n_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'driver'}`;
