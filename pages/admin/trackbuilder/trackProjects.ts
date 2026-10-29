// Saved track projects (Firestore collection `trackProjects`, admin-only by firestore.rules).
// A project keeps everything needed to rebuild the same track: the pins or loop, the resolved centreline,
// the build options and the placed scenery.

import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import type { LatLon } from '../../../tools/trackbuilder/geo.ts';
import type { TrackElement } from '../../../tools/trackbuilder/elements.ts';

export type TrackKind = 'road' | 'circuit';

export interface TrackProject {
    id?: string;
    name: string;
    kind: TrackKind;
    /** Road: start, via pins, finish. */
    pins: LatLon[];
    /** Circuit: the loop, first point = start/finish line. */
    loop: LatLon[];
    /** The centreline the track was built on (OSRM route or the loop). Rebuilds reuse it so scenery stays put. */
    line: LatLon[] | null;
    width: number | null;
    walls: boolean;
    flipStart: boolean;
    reverse: boolean;
    gridSlots: number;
    elements: TrackElement[];
    source?: string;
    /** Stored site data (lidar + imagery) for `line`: Storage trackbuilder/sites/<siteId>/. */
    siteId?: string | null;
    /** Build with the real ground (lidar + aerial photo). Default true. */
    realGround?: boolean;
    /** Bridge structure per OSM way id, chosen in the editor. */
    bridgeStyles?: Record<string, 'beam' | 'arch' | 'truss'>;
    /** Review notes pinned in the 3D preview. */
    reviewNotes?: { id: string; s: number; point: { x: number; y: number; z: number }; text: string; done?: boolean }[];
    /** The driver's own facade photos (512 px JPEG data URLs), applied to the wall nearest each point. */
    facadePhotos?: { id: string; s: number; point: { x: number; y: number; z: number }; at: { lat: number; lon: number }; dataUrl: string; label?: string }[];
    /** The driver's own drive of the route: GPS log (packed) and video sync. The video itself stays on their computer. */
    drive?: { video: string; log: string; t0: number; data: number[]; videoStartMs: number | null; offsetMs: number } | null;
    stats?: { lengthM: number; climbM: number } | null;
    createdBy?: string;
    updatedBy?: string;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
}

const COL = 'trackProjects';

const round = (p: LatLon) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 });

/** Firestore rejects undefined; strip it and round coordinates to ~10 cm. */
function clean(p: TrackProject) {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = p;
    const out = JSON.parse(JSON.stringify({
        ...rest,
        pins: rest.pins.map(round),
        loop: rest.loop.map(round),
        line: rest.line ? rest.line.map(round) : null,
    }));
    return out as Omit<TrackProject, 'id' | 'createdAt' | 'updatedAt'>;
}

export async function listProjects(): Promise<TrackProject[]> {
    const snap = await getDocs(query(collection(db, COL), orderBy('updatedAt', 'desc')));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as TrackProject) }));
}

export async function loadProject(id: string): Promise<TrackProject | null> {
    const d = await getDoc(doc(db, COL, id));
    return d.exists() ? { id: d.id, ...(d.data() as TrackProject) } : null;
}

/** Create or update; returns the project id. */
export async function saveProject(p: TrackProject, email: string | null | undefined): Promise<string> {
    const data = clean({ ...p, updatedBy: email ?? undefined });
    if (p.id) {
        await updateDoc(doc(db, COL, p.id), { ...data, updatedAt: serverTimestamp() });
        return p.id;
    }
    const ref = await addDoc(collection(db, COL), { ...data, createdBy: email ?? null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
}

export async function deleteProject(id: string) {
    await deleteDoc(doc(db, COL, id));
}

// Pete's Mountain Rd, West Linn: the first road this builder was proved on.
export const DEFAULT_ROAD_PINS: LatLon[] = [
    { lat: 45.3397, lon: -122.6545 },
    { lat: 45.33466, lon: -122.6769 },
    { lat: 45.32645, lon: -122.678 },
    { lat: 45.3064, lon: -122.6806 },
];

export function newProject(kind: TrackKind): TrackProject {
    return {
        name: kind === 'road' ? "Pete's Mountain Rd" : 'New circuit',
        kind,
        pins: kind === 'road' ? DEFAULT_ROAD_PINS : [],
        loop: [],
        line: null,
        width: null,
        walls: true,
        flipStart: false,
        reverse: false,
        gridSlots: 12,
        elements: [],
        stats: null,
    };
}

/** Firestore permission errors usually mean the rules weren't published or the account isn't an admin. */
export function explainFirestoreError(e: unknown): string {
    const m = (e as Error)?.message ?? String(e);
    if (/permission|insufficient/i.test(m)) return 'Firestore refused access. The trackProjects rule may not be published yet, or this account is not on the admin list in firestore.rules.';
    return m;
}
