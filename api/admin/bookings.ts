// GET /api/admin/bookings — all bookings for the admin dashboard.
// Requires a Firebase ID token from a signed-in admin (same list as firestore.rules).
// Replaces the browser calling the booking sheet's allBookings action directly,
// which exposed every customer's name, email and phone to anyone with the URL.

import admin from 'firebase-admin';
import { fetchAllBookings } from '../services/bookingsSource';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });
}

const ADMIN_EMAILS = (
    process.env.ADMIN_EMAILS ||
    'kartcade.website@gmail.com,devansh7704patel@gmail.com,adamjames9@gmail.com,info@kartcade.com'
)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export default async function handler(req: any, res: any) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'method not allowed' });

    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ success: false, error: 'sign in required' });

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        const email = String(decoded.email || '').toLowerCase();
        // email_verified matters: anyone can create an unverified email/password account using an admin's address.
        if (!decoded.email_verified || !ADMIN_EMAILS.includes(email)) {
            return res.status(403).json({ success: false, error: 'forbidden' });
        }
    } catch {
        return res.status(401).json({ success: false, error: 'invalid session' });
    }

    try {
        const data = await fetchAllBookings();
        return res.status(200).json(data);
    } catch (err: any) {
        console.error('admin/bookings failed:', err?.message);
        return res.status(502).json({ success: false, error: 'booking sheet unavailable' });
    }
}
