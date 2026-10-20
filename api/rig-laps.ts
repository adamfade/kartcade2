// POST /api/rig-laps — lap results from the Kartcade Lap Timer app running on each rig.
//
// One document per driver session in `lap_times` (the collection the public leaderboard
// already reads). Each upload keeps the fastest lap; `final` marks the session as stopped.
// Laps are auto-approved because they come from the rig, not a hand-typed submission.
// lap_times is publicly readable, so the email is only used to find the driver profile and is never stored.
//
// Env: RIG_KEY (shared secret, also in each rig's config.ini), FIREBASE_* (already set).

import admin from 'firebase-admin';
import { timingSafeEqual } from 'node:crypto';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });
}
const db = admin.firestore();

const EQUIPMENT = new Set(['karts', 'rigs', 'motion']);

function keyOk(given: string) {
    const expected = process.env.RIG_KEY || '';
    if (!expected || !given) return false;
    const a = Buffer.from(given), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

const clean = (v: any, max = 80) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

export function formatLap(ms: number) {
    const m = Math.floor(ms / 60000);
    const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
    return `${m}:${s}`;
}

async function findUser(email: string) {
    if (!email) return null;
    const snap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { uid: doc.id, ...(doc.data() as any) };
}

export default async function handler(req: any, res: any) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method not allowed' });
    if (!keyOk(String(req.headers['x-rig-key'] || ''))) return res.status(401).json({ ok: false, error: 'bad rig key' });

    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const lapTimeMs = Math.round(Number(b.lapTimeMs));
    const sessionId = clean(b.sessionId, 60).replace(/[^A-Za-z0-9_-]/g, '');
    const driverName = clean(b.driverName, 40);
    const equipment = EQUIPMENT.has(b.equipment) ? b.equipment : 'rigs';

    if (!sessionId || driverName.length < 2) return res.status(400).json({ ok: false, error: 'missing session or name' });
    if (!Number.isFinite(lapTimeMs) || lapTimeMs < 10_000 || lapTimeMs > 20 * 60_000) {
        return res.status(400).json({ ok: false, error: 'lap time out of range' });
    }

    try {
        const email = clean(b.email, 120).toLowerCase();
        const user = await findUser(email);
        const ref = db.collection('lap_times').doc(`rig_${sessionId}`);

        await db.runTransaction(async (tx) => {
            const cur = await tx.get(ref);
            const prev = cur.exists ? (cur.data() as any) : null;
            const best = prev && prev.lapTimeMs && prev.lapTimeMs <= lapTimeMs ? prev.lapTimeMs : lapTimeMs;
            tx.set(ref, {
                source: 'rig',
                rigId: clean(b.rigId, 20),
                sessionId,
                userId: user?.uid || '',
                driverName: user?.name || driverName,
                enteredName: driverName,
                photoURL: user?.photoURL || '',
                equipment,
                game: 'Assetto Corsa',
                track: clean(b.track),
                trackId: clean(b.trackId),
                car: clean(b.car),
                carId: clean(b.carId),
                lapTimeMs: best,
                lapTime: formatLap(best),
                laps: Math.max(Number(b.laps) || 0, prev?.laps || 0),
                status: 'approved',
                final: !!b.final || !!prev?.final,
                submittedAt: prev?.submittedAt || admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        });

        return res.status(200).json({ ok: true, linked: !!user });
    } catch (err: any) {
        console.error('rig-laps failed:', err?.message);
        return res.status(500).json({ ok: false, error: 'save failed' });
    }
}
