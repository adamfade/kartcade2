// Marketing attribution: remembers which campaign brought a visitor to the site,
// so a later sign-up or booking can be credited to it (e.g. the PDX Parent e-blast).
//
// Sources, in priority order:
//   1. utm_source / utm_medium / utm_campaign on any page URL
//   2. a campaign landing page path (e.g. /pdxparent) with no UTM tags
//
// The most recent campaign visit wins and is kept for 60 days. Storage is
// best-effort: if localStorage is unavailable, attribution is simply skipped.

export interface Attribution {
    source: string;
    medium: string;
    campaign: string;
    landingPath: string;
    capturedAt: string; // ISO timestamp
}

const STORAGE_KEY = 'kc_attribution';
const MAX_AGE_DAYS = 60;

// Landing pages that imply a source even without UTM tags
const PATH_SOURCES: Record<string, { source: string; medium: string }> = {
    '/pdxparent': { source: 'pdxparent', medium: 'link' },
};

const clean = (value: string | null, max = 40): string =>
    (value || '').toLowerCase().trim().replace(/[^a-z0-9_.-]/g, '').slice(0, max);

export function captureAttribution(pathname: string, search: string): void {
    const params = new URLSearchParams(search);
    const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
    const fromPath = PATH_SOURCES[path];

    const source = clean(params.get('utm_source')) || fromPath?.source || '';
    if (!source) return; // ordinary visit: keep whatever was captured before

    const attribution: Attribution = {
        source,
        medium: clean(params.get('utm_medium')) || fromPath?.medium || '',
        campaign: clean(params.get('utm_campaign')),
        landingPath: path,
        capturedAt: new Date().toISOString(),
    };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
    } catch {
        // storage blocked (private mode, etc.) — attribution is optional
    }
}

export function getAttribution(): Attribution | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Attribution;
        const ageDays = (Date.now() - new Date(parsed.capturedAt).getTime()) / 86_400_000;
        if (!parsed.source || !(ageDays <= MAX_AGE_DAYS)) {
            localStorage.removeItem(STORAGE_KEY);
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

// Short tag like "pdxparent/email/holiday26" for booking notes and the sheet's Source column
export function attributionLabel(a: Attribution | null = getAttribution()): string {
    if (!a) return '';
    return [a.source, a.medium, a.campaign].filter(Boolean).join('/');
}

// Prefixes "[SRC: ...]" to booking notes once (prefix, so Stripe's 400-char metadata cut can't drop it). The Apps Script copies it into the Source column.
export function withAttribution(notes: string | undefined): string {
    const base = notes || '';
    const label = attributionLabel();
    if (!label || base.includes('[SRC:')) return base;
    return `[SRC: ${label}] ${base}`.trim();
}
