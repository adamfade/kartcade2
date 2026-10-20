// Server-side access to the booking sheet (Google Apps Script web app).
// The admin key never reaches the browser: it lives in Vercel as APPS_SCRIPT_ADMIN_KEY
// and in Apps Script as the ADMIN_KEY script property.

const DEFAULT_URL =
    'https://script.google.com/macros/s/AKfycbzlJM7zscm9Txy-5Q2MLqoqDtzbab6a0L-CtUWIRUWrN0Bo8b-GGK51iuDa6hQOBpV5UA/exec';

export interface SheetBooking {
    id: string;
    date: string;      // YYYY-MM-DD
    time: string;      // HH:MM
    station: string;   // e.g. "Rigs:2 (1.5h)"
    drivers: number;
    name: string;
    email: string;
    phone: string;
    paymentMethod: string;
    status: string;
}

export interface AllBookingsResponse {
    success: boolean;
    today?: SheetBooking[];
    upcoming?: SheetBooking[];
    past?: SheetBooking[];
    stats?: Record<string, number>;
    full?: boolean;
    error?: string;
}

export async function fetchAllBookings(full = false): Promise<AllBookingsResponse> {
    const key = process.env.APPS_SCRIPT_ADMIN_KEY;
    if (!key) throw new Error('APPS_SCRIPT_ADMIN_KEY is not set');
    const base = process.env.APPS_SCRIPT_URL || DEFAULT_URL;
    const url = `${base}?action=allBookings&key=${encodeURIComponent(key)}${full ? '&full=1' : ''}&t=${Date.now()}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Booking sheet returned ${res.status}`);
    const data = (await res.json()) as AllBookingsResponse;
    if (!data.success) throw new Error(`Booking sheet refused: ${data.error || 'unknown'}`);
    return data;
}

export function flattenBookings(data: AllBookingsResponse): SheetBooking[] {
    return [...(data.today || []), ...(data.upcoming || []), ...(data.past || [])];
}

// "Karts:5, Rigs:3 (2h)" -> { rigs: 8, hours: 2 }
export function parseStation(station: string): { rigs: number; hours: number } {
    const s = String(station || '');
    const m = s.match(/\(([\d.]+)h\)/);
    const hours = m ? parseFloat(m[1]) : 1;
    let rigs = 0;
    for (const part of s.replace(/\([\d.]+h\)/, '').split(',')) {
        const q = part.trim().match(/(.+):(\d+)/);
        if (q) rigs += parseInt(q[2], 10);
        else if (part.trim()) rigs += 1;
    }
    return { rigs, hours };
}

// Accounts Kartcade uses to block the calendar, plus test accounts. Never counted, never emailed.
// Extra addresses can be added in Vercel as MARKETING_EXCLUDE (comma-separated).
const BASE_EXCLUDE = [
    'adam@kartcade.com',
    'info@kartcade.com',
    'block@kartcade.com',
    'kartcade.website@gmail.com',
    'kartcade2025@gmail.com',
    'adamjames9@gmail.com',
    'devansh7704patel@gmail.com',
    'devanshpatel200@gmail.com',
];

export function isExcluded(email: string): boolean {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !e.includes('@')) return true;
    const extra = (process.env.MARKETING_EXCLUDE || '')
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
    return BASE_EXCLUDE.includes(e) || extra.includes(e) || e.endsWith('@kartcade.com');
}

export const FULL_BUYOUT_RIGS = 10;
