import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (runs server-side only)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });
}

const db = getFirestore();

// Bot filtering regex: matches common crawlers, lighthouse audits, and messaging link previews
const BOT_REGEX = /bot|crawler|spider|crawling|lighthouse|headless|facebookexternalhit|twitterbot|whatsapp|slackbot|telegrambot|discordbot|applebot|linkedinbot|googlebot|bingbot|yandex|baidu/i;

export default async function handler(req: any, res: any) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // Support channel parameter from query or body
        const channel = (req.query.channel || req.body?.channel || '').toLowerCase().trim();
        const userAgent = req.headers['user-agent'] || '';

        // Validate channel
        const allowedChannels = ['mailer', 'email', 'august', 'pdxparent'];
        if (!channel || !allowedChannels.includes(channel)) {
            return res.status(400).json({ error: 'Invalid or missing channel' });
        }

        // Detect bot traffic
        const isBot = BOT_REGEX.test(userAgent);

        if (isBot) {
            // Silently ignore bots (return 200 so crawlers/messaging apps get a successful response, but don't count it)
            return res.status(200).json({ success: true, status: 'ignored_bot' });
        }

        // Get IP (or hash of it) for basic deduplication or debugging if needed (optional)
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        
        // Save scan/hit to Firestore
        const docRef = db.collection('campaign_scans').doc();
        const tag = (v: any) => String(v || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
        await docRef.set({
            channel,
            utmMedium: tag(req.query.utm_medium || req.body?.utm_medium),
            utmCampaign: tag(req.query.utm_campaign || req.body?.utm_campaign),
            userAgent,
            ipHash: ip ? createHash(String(ip)) : 'unknown',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        return res.status(200).json({ success: true, status: 'logged' });
    } catch (error: any) {
        console.error('Error logging campaign scan:', error);
        return res.status(500).json({ error: 'Internal server error logging hit' });
    }
}

// Simple non-cryptographic hash helper for client IPs to protect privacy while enabling duplicate prevention
function createHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
}
