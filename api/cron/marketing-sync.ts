// Daily marketing sync (Vercel cron, 7am Pacific).
//
// 1. Reads every booking (booking sheet) and every account (Firestore `users`).
// 2. Upserts each real customer into the Mailchimp audience. New people are added as
//    subscribed (Ad's decision, Oct 20 2026); anyone who unsubscribed stays unsubscribed.
// 3. Tags drive Mailchimp automations:
//      "Customer"               booked at least once
//      "Private event"          booked a full-venue buyout
//      "Account, never booked"  signed up on the site but has no booking -> $20 first-hour offer journey
//    The never-booked tag is removed once they book.
// 4. Mondays: emails Ad last week's scorecard.
//
// Env (Vercel): MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID, APPS_SCRIPT_ADMIN_KEY, CRON_SECRET,
//               FIREBASE_* (already set). Optional: SCORECARD_TO, MARKETING_EXCLUDE, SYNC_DRY_RUN=1.

import admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import {
    fetchAllBookings,
    flattenBookings,
    parseStation,
    isExcluded,
    FULL_BUYOUT_RIGS,
    SheetBooking,
} from '../services/bookingsSource.js';


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

const TAG_CUSTOMER = 'Customer';
const TAG_PRIVATE = 'Private event';
const TAG_NEVER_BOOKED = 'Account, never booked';

interface Contact {
    email: string;
    first: string;
    last: string;
    phone: string;
    visits: number;       // distinct past visit days
    lastVisit: string;    // YYYY-MM-DD, past visits only
    signup: string;       // YYYY-MM-DD, site account
    booked: boolean;      // any confirmed booking, past or upcoming
    privateEvent: boolean;
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const md5 = (s: string) => createHash('md5').update(s.toLowerCase()).digest('hex');

function splitName(full: string) {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : '');
    return { first: cap(parts[0] || ''), last: parts.slice(1).map(cap).join(' ') };
}

function buildContacts(bookings: SheetBooking[], users: any[]): Map<string, Contact> {
    const map = new Map<string, Contact>();
    const get = (email: string) => {
        const e = email.trim().toLowerCase();
        if (!map.has(e)) {
            map.set(e, { email: e, first: '', last: '', phone: '', visits: 0, lastVisit: '', signup: '', booked: false, privateEvent: false });
        }
        return map.get(e)!;
    };
    const now = today();
    const visitDays = new Map<string, Set<string>>();

    for (const b of bookings) {
        if (b.status !== 'Confirmed' || isExcluded(b.email)) continue;
        const c = get(b.email);
        const n = splitName(b.name);
        if (!c.first && n.first) Object.assign(c, n);
        if (!c.phone && b.phone) c.phone = String(b.phone);
        c.booked = true;
        if (parseStation(b.station).rigs >= FULL_BUYOUT_RIGS) c.privateEvent = true;
        if (b.date && b.date <= now) {
            if (!visitDays.has(c.email)) visitDays.set(c.email, new Set());
            visitDays.get(c.email)!.add(b.date);
            if (b.date > c.lastVisit) c.lastVisit = b.date;
        }
    }
    for (const [email, days] of visitDays) get(email).visits = days.size;

    for (const u of users) {
        if (!u.email || isExcluded(u.email)) continue;
        const c = get(u.email);
        const n = splitName(u.name);
        if (!c.first && n.first) Object.assign(c, n);
        if (!c.phone && u.phone) c.phone = String(u.phone);
        const created = u.createdAt?.toDate?.();
        if (created) c.signup = created.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    }
    return map;
}

// ---------- Mailchimp ----------

function mc() {
    const key = process.env.MAILCHIMP_API_KEY || '';
    const list = process.env.MAILCHIMP_AUDIENCE_ID || '';
    const dc = key.split('-')[1];
    if (!key || !list || !dc) throw new Error('MAILCHIMP_API_KEY / MAILCHIMP_AUDIENCE_ID not set');
    const base = `https://${dc}.api.mailchimp.com/3.0`;
    const auth = 'Basic ' + Buffer.from(`kartcade:${key}`).toString('base64');
    const call = async (method: string, path: string, body?: any) => {
        const res = await fetch(base + path, {
            method,
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        const json = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(`Mailchimp ${method} ${path}: ${res.status} ${json.detail || json.title || ''}`);
        return json;
    };
    return { call, list };
}

async function ensureMergeFields(call: any, list: string) {
    const wanted = [
        { tag: 'VISITS', name: 'Visits', type: 'number' },
        { tag: 'LASTVISIT', name: 'Last visit', type: 'date', options: { date_format: 'MM/DD/YYYY' } },
        { tag: 'SIGNUP', name: 'Account created', type: 'date', options: { date_format: 'MM/DD/YYYY' } },
    ];
    const existing = await call('GET', `/lists/${list}/merge-fields?count=100&fields=merge_fields.tag`);
    const have = new Set((existing.merge_fields || []).map((f: any) => f.tag));
    for (const f of wanted) {
        if (have.has(f.tag)) continue;
        try {
            await call('POST', `/lists/${list}/merge-fields`, { ...f, public: false });
        } catch (e: any) {
            console.error('merge field', f.tag, e.message); // keep going; the member update reports it too
        }
    }
}

function fingerprint(c: Contact) {
    return md5(JSON.stringify([c.first, c.last, c.phone, c.visits, c.lastVisit, c.signup, c.booked, c.privateEvent]));
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
    let i = 0;
    const errors: string[] = [];
    await Promise.all(
        Array.from({ length: size }, async () => {
            while (i < items.length) {
                const item = items[i++];
                try { await fn(item); } catch (e: any) { errors.push(e.message); }
            }
        })
    );
    return errors;
}

async function syncToMailchimp(contacts: Contact[], deadline: number) {
    const { call, list } = mc();
    await ensureMergeFields(call, list);

    const stateRef = db.collection('marketing_sync').doc('mailchimp');
    const state = ((await stateRef.get()).data()?.fingerprints || {}) as Record<string, string>;
    const changed = contacts.filter((c) => state[md5(c.email)] !== fingerprint(c));

    let synced = 0;
    const errors = await pool(changed, 12, async (c) => {
        if (Date.now() > deadline) return; // finish next run
        const hash = md5(c.email);
        const merge: Record<string, any> = { FNAME: c.first, LNAME: c.last, VISITS: c.visits };
        // Mailchimp date fields take MM/DD/YYYY
        const us = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
        if (c.lastVisit) merge.LASTVISIT = us(c.lastVisit);
        if (c.signup) merge.SIGNUP = us(c.signup);
        await call('PUT', `/lists/${list}/members/${hash}`, {
            email_address: c.email,
            status_if_new: 'subscribed',
            merge_fields: merge,
        });
        const tags = [
            { name: TAG_CUSTOMER, status: c.booked ? 'active' : 'inactive' },
            { name: TAG_PRIVATE, status: c.privateEvent ? 'active' : 'inactive' },
            { name: TAG_NEVER_BOOKED, status: !c.booked && c.signup ? 'active' : 'inactive' },
        ];
        await call('POST', `/lists/${list}/members/${hash}/tags`, { tags });
        state[hash] = fingerprint(c);
        synced++;
    });

    await stateRef.set({ fingerprints: state, lastRun: new Date().toISOString() }, { merge: true });
    return { changed: changed.length, synced, errors: errors.slice(0, 5), errorCount: errors.length };
}

// ---------- Weekly scorecard ----------

function scorecard(bookings: SheetBooking[], users: any[]) {
    // Last full Monday-Sunday week, Pacific time.
    const t = new Date(today() + 'T12:00:00');
    const dow = (t.getDay() + 6) % 7; // Mon=0
    const end = new Date(t); end.setDate(t.getDate() - dow - 1);
    const start = new Date(end); start.setDate(end.getDate() - 6);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const s = iso(start), e = iso(end);

    const parts = { 'Weekday daytime': 0, 'Weekday evening': 0, Weekend: 0 } as Record<string, number>;
    let privateEvents = 0, hourlyBookings = 0;
    const customers = new Set<string>();
    for (const b of bookings) {
        if (b.status !== 'Confirmed' || isExcluded(b.email) || b.date < s || b.date > e) continue;
        const { rigs, hours } = parseStation(b.station);
        if (rigs >= FULL_BUYOUT_RIGS) { privateEvents++; continue; }
        hourlyBookings++;
        customers.add(b.email.toLowerCase());
        const day = new Date(b.date + 'T12:00:00').getDay();
        const hour = parseInt(String(b.time).split(':')[0], 10);
        const key = day === 0 || day === 6 ? 'Weekend' : hour < 17 ? 'Weekday daytime' : 'Weekday evening';
        parts[key] += rigs * hours;
    }
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    const newAccounts = users.filter((u) => {
        const d = u.createdAt?.toDate?.()?.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
        return d && d >= s && d <= e && !isExcluded(u.email);
    }).length;
    return { week: s, end: e, total, parts, hourlyBookings, customers: customers.size, privateEvents, newAccounts };
}

async function emailScorecard(card: ReturnType<typeof scorecard>, sync: any) {
    const base = process.env.APPS_SCRIPT_URL ||
        'https://script.google.com/macros/s/AKfycbzlJM7zscm9Txy-5Q2MLqoqDtzbab6a0L-CtUWIRUWrN0Bo8b-GGK51iuDa6hQOBpV5UA/exec';
    const body = [
        `Week of ${card.week} to ${card.end}`,
        '',
        `Hourly rig-hours: ${card.total} (baseline about 13, target 25)`,
        ...Object.entries(card.parts).map(([k, v]) => `  ${k}: ${v}`),
        `Hourly bookings: ${card.hourlyBookings} from ${card.customers} customers`,
        `Private events: ${card.privateEvents}`,
        `New site accounts: ${card.newAccounts}`,
        '',
        `Mailchimp sync: ${sync.synced} contacts updated${sync.errorCount ? `, ${sync.errorCount} errors` : ''}`,
    ].join('\n');
    await fetch(base, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
            action: 'emailReport',
            key: process.env.APPS_SCRIPT_ADMIN_KEY,
            to: process.env.SCORECARD_TO || '',
            subject: `Kartcade scorecard: ${card.total} hourly rig-hours (week of ${card.week})`,
            body,
        }),
    });
    await db.collection('marketing_scorecards').doc(card.week).set({ ...card, sentAt: new Date().toISOString() });
}

// ---------- Handler ----------

export default async function handler(req: any, res: any) {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    const deadline = Date.now() + 50_000;
    try {
        const sheet = await fetchAllBookings(true);
        // Without the full history (older script versions cap past bookings at 50) real
        // customers would be tagged "never booked". Refuse to sync rather than mis-tag.
        if (!sheet.full) throw new Error('Booking sheet did not return full history; update the Apps Script (allBookings full=1)');
        const bookings = flattenBookings(sheet);
        const users = (await db.collection('users').select('email', 'name', 'phone', 'createdAt').get()).docs.map((d) => d.data());
        const contacts = [...buildContacts(bookings, users).values()];

        const summary: any = {
            contacts: contacts.length,
            customers: contacts.filter((c) => c.booked).length,
            neverBooked: contacts.filter((c) => !c.booked && c.signup).length,
        };
        if (process.env.SYNC_DRY_RUN === '1' || req.query?.dry === '1') {
            return res.status(200).json({ dryRun: true, ...summary, scorecard: scorecard(bookings, users) });
        }

        summary.mailchimp = await syncToMailchimp(contacts, deadline);
        console.log('marketing-sync', JSON.stringify(summary));

        const isMonday = new Date(today() + 'T12:00:00').getDay() === 1;
        if (isMonday || req.query?.scorecard === '1') {
            const card = scorecard(bookings, users);
            await emailScorecard(card, summary.mailchimp);
            summary.scorecard = card;
        }
        return res.status(200).json(summary);
    } catch (err: any) {
        console.error('marketing-sync failed:', err?.message);
        return res.status(500).json({ error: err?.message || 'failed' });
    }
}
