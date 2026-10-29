// What the road is like at every centreline sample, from the OpenStreetMap ways the route follows: carriageway
// width (lanes, parking and bike lanes), the lane layout for markings, bridges, and the speed limit.
// Matching is geometric (nearest parallel way segment), so it works for any route source (OSRM, traces).

import type { Centerline } from './route.ts';
import type { OsmWay } from './osm.ts';

export type BridgeStructure = 'beam' | 'arch' | 'truss';

export interface LaneSet {
    /** Lanes in the direction of travel (the route's direction) and against it. */
    fwd: number;
    bwd: number;
    /** A two-way centre left-turn lane between the directions. */
    centreTurn: boolean;
    oneway: boolean;
    /** turn:lanes for the direction of travel, left to right (e.g. ['left', 'through', 'through;right']). */
    turnFwd: string[] | null;
    turnBwd: string[] | null;
    /** Kerbside extras on the left and right of the direction of travel, metres (parking, bike lane). */
    extraL: number;
    extraR: number;
    /** Painted edge lines (rural roads; urban streets with kerbs and sidewalks usually have none). */
    edgeLines: boolean;
    laneWidth: number;
    /** A service way (parking aisle, lot entrance, driveway, drive-through): no markings, paved flush to the sides. */
    lot?: boolean;
}

export interface BridgeSpan {
    wayId: number;
    name: string;
    /** Metres along the route (from < to). */
    from: number;
    to: number;
    structure: BridgeStructure;
}

export interface RoadInfo {
    /** Index into `ways` per centreline sample, -1 where no way matched. */
    wayAt: Int32Array;
    /** +1 where the route runs along the way's direction, -1 against it. */
    dirAt: Int8Array;
    /** Asphalt width per sample (smoothed so changes taper over ~40 m). */
    width: Float32Array;
    lanes: LaneSet[];
    /** Speed limit in mph per sample (NaN unknown). */
    mph: Float32Array;
    bridges: BridgeSpan[];
    ways: OsmWay[];
}

const num = (v: string | undefined) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : NaN; };

/** Length tag (metres, feet or feet'inches") to metres. */
export function metres(v: string | undefined): number {
    if (!v) return NaN;
    const ft = /^\s*(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?\s*$/.exec(v);
    if (ft) return parseFloat(ft[1]) * 0.3048 + (ft[2] ? parseFloat(ft[2]) * 0.0254 : 0);
    const m = /^\s*(\d+(?:\.\d+)?)\s*(m|ft)?\s*$/i.exec(v);
    if (!m) return NaN;
    return parseFloat(m[1]) * (m[2]?.toLowerCase() === 'ft' ? 0.3048 : 1);
}

export function mphOf(v: string | undefined): number {
    if (!v) return NaN;
    const m = /^\s*(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?\s*$/i.exec(v);
    if (!m) return NaN;
    const n = parseFloat(m[1]);
    return m[2] && /km/i.test(m[2]) ? n / 1.609344 : m[2] ? n : n / 1.609344; // bare numbers are km/h in OSM
}

/** Lane layout and widths of a way, for the direction of travel `dir` (+1 along the way, -1 against). */
export function laneSet(tags: Record<string, string>, dir: 1 | -1): LaneSet {
    const hw = (tags.highway ?? '').replace(/_link$/, '');
    const oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === '-1' || hw === 'motorway' || tags.junction === 'roundabout';
    const total = num(tags.lanes);
    let fwd = num(tags['lanes:forward']), bwd = num(tags['lanes:backward']);
    const both = num(tags['lanes:both_ways']);
    const turnBoth = tags['turn:lanes:both_ways'] ?? '';
    const centreTurn = !oneway && (both === 1 || /left/.test(turnBoth) || tags.centre_turn_lane === 'yes');
    if (oneway) { fwd = Number.isFinite(total) ? total : hw === 'motorway' ? 2 : 1; bwd = 0; }
    else if (!Number.isFinite(fwd) || !Number.isFinite(bwd)) {
        const t = Number.isFinite(total) ? total - (centreTurn ? 1 : 0) : 2;
        if (Number.isFinite(fwd)) bwd = Math.max(1, t - fwd);
        else if (Number.isFinite(bwd)) fwd = Math.max(1, t - bwd);
        else { fwd = Math.max(1, Math.floor(t / 2)); bwd = Math.max(1, t - fwd); }
    }
    const split = (v: string | undefined) => (v ? v.split('|').map((x) => x.trim() || 'none') : null);
    let turnFwd = split(oneway ? tags['turn:lanes'] : tags['turn:lanes:forward']), turnBwd = oneway ? null : split(tags['turn:lanes:backward']);
    const side = (k: 'left' | 'right') => {
        const v = (key: string) => tags[`${key}:${k}`] ?? tags[`${key}:both`] ?? (key === 'cycleway' ? tags.cycleway : undefined);
        const parking = v('parking') ?? tags[`parking:lane:${k}`] ?? tags['parking:lane:both'];
        const bike = v('cycleway');
        return (parking && /^(lane|parallel|yes)$/.test(parking) ? 2.4 : 0) + (bike === 'lane' ? 1.6 : 0);
    };
    let extraL = side('left'), extraR = side('right');
    if (dir === -1) {
        [fwd, bwd] = [bwd, fwd]; [turnFwd, turnBwd] = [turnBwd, turnFwd]; [extraL, extraR] = [extraR, extraL];
        if (oneway) { fwd = bwd; bwd = 0; } // driving a one-way the wrong way: treat its lanes as ours
    }
    const urban = /^(both|left|right|separate|yes)$/.test(tags.sidewalk ?? tags['sidewalk:both'] ?? tags['sidewalk:left'] ?? tags['sidewalk:right'] ?? '') && (mphOf(tags.maxspeed) || 30) <= 35;
    const laneWidth = hw === 'motorway' || hw === 'trunk' ? 3.65 : hw === 'primary' || hw === 'secondary' ? 3.5 : hw === 'tertiary' ? 3.35 : 3.1;
    const lot = hw === 'service';
    return { fwd, bwd, centreTurn, oneway, turnFwd, turnBwd, extraL, extraR, edgeLines: !urban && !lot, laneWidth, ...(lot ? { lot } : {}) };
}

/** Carriageway width (asphalt) for a way, metres. */
export function wayWidth(tags: Record<string, string>, ls: LaneSet): number {
    const tagged = metres(tags['width:carriageway'] ?? tags.width);
    if (tagged >= 3 && tagged <= 40) return tagged;
    // Service ways: parking aisles are two cars wide plus room; drive-throughs and driveways one car.
    if (ls.lot) return tags.service === 'parking_aisle' ? 7.2 : tags.service === 'drive-through' ? 3.8 : tags.service === 'driveway' ? 4.2 : 6.6;
    const lanes = ls.fwd + ls.bwd + (ls.centreTurn ? 1 : 0);
    // Residential streets without lane markings are a shared surface, usually ~8 m kerb to kerb.
    const unmarked = tags.lane_markings === 'no' && !tags.lanes;
    let core = unmarked ? 7.4 : lanes * ls.laneWidth + (ls.edgeLines ? 0.6 : 0);
    // One-way streets without a lane count are rarely a single bare lane wide.
    if (ls.oneway && !tags.lanes && !/_link$|^service$/.test(tags.highway ?? '')) core = Math.max(core, 5.5);
    return Math.max(3.2, core + ls.extraL + ls.extraR);
}

function structureOf(tags: Record<string, string>): BridgeStructure {
    const s = tags['bridge:structure'] ?? '';
    if (/arch/.test(s)) return 'arch';
    if (/truss/.test(s)) return 'truss';
    return 'beam';
}

/**
 * Match each centreline sample to the OSM way it lies on. `overrides` lets staff set a bridge's structure
 * (OSM rarely tags it); keys are way ids.
 */
export function matchRoad(cl: Centerline, ways: OsmWay[], opts: { fallbackWidth: number; bridgeStyles?: Record<string, BridgeStructure> }): RoadInfo {
    const n = cl.points.length, proj = cl.projection;
    // Segment grid.
    const G = 25, grid = new Map<string, { w: number; ax: number; ay: number; bx: number; by: number }[]>();
    ways.forEach((way, w) => {
        const pts = way.line.map((p) => proj.toLocal(p));
        for (let k = 0; k < pts.length - 1; k++) {
            const a = pts[k], b = pts[k + 1];
            const seg = { w, ax: a.x, ay: a.y, bx: b.x, by: b.y };
            const x0 = Math.floor(Math.min(a.x, b.x) / G), x1 = Math.floor(Math.max(a.x, b.x) / G);
            const y0 = Math.floor(Math.min(a.y, b.y) / G), y1 = Math.floor(Math.max(a.y, b.y) / G);
            for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const key = `${gx},${gy}`; let l = grid.get(key); if (!l) grid.set(key, (l = [])); l.push(seg); }
        }
    });
    const wayAt = new Int32Array(n).fill(-1), dirAt = new Int8Array(n).fill(1);
    for (let i = 0; i < n; i++) {
        const p = cl.points[i], t = cl.tangents[i];
        let best = -1, bestScore = Infinity, bestDir = 1;
        const cx = Math.floor(p.x / G), cy = Math.floor(p.y / G);
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) for (const s of grid.get(`${gx},${gy}`) ?? []) {
            const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy || 1, l = Math.sqrt(l2);
            const u = Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.y - s.ay) * dy) / l2));
            const d = Math.hypot(p.x - (s.ax + dx * u), p.y - (s.ay + dy * u));
            if (d > 14) continue;
            const cos = (dx * t.x + dy * t.y) / l;
            const score = d + 12 * (1 - Math.abs(cos));
            if (score < bestScore) { bestScore = score; best = s.w; bestDir = cos >= 0 ? 1 : -1; }
        }
        wayAt[i] = best; dirAt[i] = bestDir;
    }
    // Fill unmatched samples from the nearest matched neighbour; drop one- or two-sample flickers.
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) if (wayAt[i] < 0) {
        const src = pass === 0 ? i - 1 : i + 1;
        if (src >= 0 && src < n && wayAt[src] >= 0) { wayAt[i] = wayAt[src]; dirAt[i] = dirAt[src]; }
    }
    for (let i = 1; i < n - 1; i++) {
        const a = wayAt[i - 1];
        for (const span of [1, 2]) if (i + span < n && wayAt[i + span] === a && wayAt[i] !== a) {
            for (let k = 0; k < span; k++) { wayAt[i + k] = a; dirAt[i + k] = dirAt[i - 1]; }
        }
    }

    const fallbackTags: Record<string, string> = {};
    const lanes: LaneSet[] = new Array(n);
    const raw = new Float32Array(n), mph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const tags = wayAt[i] >= 0 ? ways[wayAt[i]].tags : fallbackTags;
        const ls = laneSet(tags, dirAt[i] as 1 | -1);
        lanes[i] = ls;
        raw[i] = wayAt[i] >= 0 ? wayWidth(tags, ls) : opts.fallbackWidth;
        mph[i] = mphOf(tags.maxspeed);
    }
    // Taper width changes over ~40 m (box filter), never narrower than the narrower end.
    const win = Math.max(1, Math.round(20 / cl.spacing));
    const width = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let a = 0, c = 0;
        for (let k = -win; k <= win; k++) { const j = cl.closed ? ((i + k) % n + n) % n : Math.max(0, Math.min(n - 1, i + k)); a += raw[j]; c++; }
        width[i] = a / c;
    }

    // Bridges: runs of samples on ways tagged bridge=*.
    const bridges: BridgeSpan[] = [];
    let i = 0;
    while (i < n) {
        const w = wayAt[i];
        const isBridge = w >= 0 && ways[w].tags.bridge && ways[w].tags.bridge !== 'no';
        if (!isBridge) { i++; continue; }
        let j = i;
        while (j + 1 < n && wayAt[j + 1] >= 0 && ways[wayAt[j + 1]].tags.bridge && ways[wayAt[j + 1]].tags.bridge !== 'no'
            && (wayAt[j + 1] === w || ways[wayAt[j + 1]].tags.name === ways[w].tags.name)) j++;
        const from = cl.s[i], to = cl.s[j];
        if (to - from >= 6) {
            const way = ways[w];
            bridges.push({ wayId: way.id, name: way.tags.name ?? way.tags['bridge:name'] ?? 'Bridge', from, to, structure: opts.bridgeStyles?.[String(way.id)] ?? structureOf(way.tags) });
        }
        i = j + 1;
    }
    return { wayAt, dirAt, width, lanes, mph, bridges, ways };
}

/** Replace raw elevation samples on bridges (bare-earth DEMs drop to the river) with the deck line. */
export function levelBridges(raw: (number | null)[], s: number[], bridges: BridgeSpan[]): (number | null)[] {
    const out = raw.slice();
    const near = (from: number, to: number) => {
        const v: number[] = [];
        for (let i = 0; i < s.length; i++) if (s[i] >= from && s[i] <= to && raw[i] != null) v.push(raw[i]!);
        v.sort((a, b) => a - b);
        return v.length ? v[v.length >> 1] : null;
    };
    for (const b of bridges) {
        // Deck ends: the ground just outside each end (abutments).
        const h0 = near(b.from - 8, b.from - 1) ?? near(b.from, b.from + 3), h1 = near(b.to + 1, b.to + 8) ?? near(b.to - 3, b.to);
        if (h0 == null || h1 == null) continue;
        const L = b.to - b.from;
        const crest = Math.min(1.5, L * 0.008); // a gentle vertical curve, as built bridges have
        for (let i = 0; i < s.length; i++) {
            if (s[i] < b.from - 1 || s[i] > b.to + 1) continue;
            const t = Math.max(0, Math.min(1, (s[i] - b.from) / L));
            out[i] = h0 + (h1 - h0) * t + crest * 4 * t * (1 - t);
        }
    }
    return out;
}

/**
 * Where the lanes are across the asphalt (lateral metres, negative = left of the centreline, right = direction
 * of travel). Travel lanes span [L0, R0]; oncoming lanes run from L0 to c0, a centre turn lane from c0 to c1,
 * our lanes from c1 to R0. `edges` = painted edge lines (they take 0.3 m each side).
 */
export function laneGeometry(h: number, ls: LaneSet, edges: boolean) {
    const L0 = -h + (ls.extraL > 0 ? ls.extraL : edges ? 0.3 : 0.15);
    const R0 = h - (ls.extraR > 0 ? ls.extraR : edges ? 0.3 : 0.15);
    const oneway = ls.oneway || ls.bwd === 0;
    const total = oneway ? Math.max(1, ls.fwd) : ls.fwd + ls.bwd + (ls.centreTurn ? 1 : 0);
    const lw = (R0 - L0) / Math.max(1, total);
    const c0 = oneway ? L0 : L0 + ls.bwd * lw;
    const c1 = oneway ? L0 : c0 + (ls.centreTurn ? lw : 0);
    /** Centre of our k-th lane from the left, and of the oncoming k-th lane from their left (next to the centre). */
    const fwdLane = (k: number) => c1 + (k + 0.5) * lw;
    const bwdLane = (k: number) => c0 - (k + 0.5) * lw;
    return { L0, R0, lw, c0, c1, oneway, fwdLane, bwdLane };
}
