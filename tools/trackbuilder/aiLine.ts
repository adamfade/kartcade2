// ai/fast_lane.ai writer (spline the AI follows and AC uses for the track map/progress).
// Layout (version 7): int32 version, int32 count, int32 lapTime, int32 sampleCount,
//   count x { float x, y, z, float length, int32 id },
//   int32 extraCount, extraCount x 18 floats {speed, gas, brake, obsoleteLatG, radius, sideLeft, sideRight,
//   camber, direction, normal xyz, length, forward xyz, tag, grade},
//   int32 hasGrid (0 here: no precomputed lookup grid). AC reads this flag, so a file that stops after the
//   extra data is truncated; that is the likely cause of the v1 crash in Track::initAISpline.

export interface AiPoint { x: number; y: number; z: number } // AC space (X east, Y up, Z north)

export interface FastLaneOptions {
    /** Half the drivable width, metres: one value, or one per point. */
    halfWidth: number | ArrayLike<number>;
    curvature?: number[];
    grade?: number[];
    /** Circuit: the last point connects back to the first (no duplicate point at the end). */
    closed?: boolean;
}

export function writeFastLane(points: AiPoint[], opts: FastLaneOptions): Uint8Array {
    const n = points.length;
    const closed = !!opts.closed;
    const size = 16 + n * 20 + 4 + n * 18 * 4 + 4;
    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    let o = 0;
    const i32 = (v: number) => { dv.setInt32(o, v, true); o += 4; };
    const f32 = (v: number) => { dv.setFloat32(o, Number.isFinite(v) ? v : 0, true); o += 4; };
    const P = (i: number) => points[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
    i32(7); i32(n); i32(0); i32(0);
    const len: number[] = [0];
    for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z));
    const loopLen = closed ? len[n - 1] + Math.hypot(points[0].x - points[n - 1].x, points[0].y - points[n - 1].y, points[0].z - points[n - 1].z) : len[n - 1];
    for (let i = 0; i < n; i++) { f32(points[i].x); f32(points[i].y); f32(points[i].z); f32(len[i]); i32(i); }
    i32(n);
    // Target speed from curvature: v = sqrt(a_lat * r), capped; brake ahead of tight corners.
    const k = opts.curvature ?? new Array(n).fill(0);
    const speed = k.map((kk) => Math.min(45, Math.sqrt(7.5 / Math.max(1e-4, Math.abs(kk)))));
    const ds = (i: number) => (i < n - 1 ? len[i + 1] - len[i] : loopLen - len[n - 1]);
    // Backward braking passes (~0.6 g); a circuit wraps so the corner after the line slows the run to it.
    for (let pass = 0; pass < 3; pass++) for (let i = closed ? n - 1 : n - 2; i >= 0; i--) {
        const j = (i + 1) % n;
        speed[i] = Math.min(speed[i], Math.sqrt(speed[j] ** 2 + 2 * 6 * ds(i)));
    }
    for (let i = 0; i < n; i++) {
        const a = P(i - 1), b = P(i + 1);
        const fl = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
        const fwd = [(b.x - a.x) / fl, (b.y - a.y) / fl, (b.z - a.z) / fl];
        const nextSpeed = speed[closed ? (i + 3) % n : Math.min(n - 1, i + 3)];
        const braking = nextSpeed < speed[i] - 0.5;
        f32(speed[i]); // speed m/s
        f32(braking ? 0 : 1); // gas
        f32(braking ? 0.6 : 0); // brake
        f32(0); // obsolete lat G
        f32(Math.abs(k[i]) > 1e-5 ? 1 / Math.abs(k[i]) : 10000); // radius
        const hw = typeof opts.halfWidth === 'number' ? opts.halfWidth : opts.halfWidth[i];
        f32(hw); f32(hw); // side left / right
        f32(0); // camber
        f32(Math.atan2(fwd[0], fwd[2])); // direction
        f32(0); f32(1); f32(0); // normal
        f32(len[i]);
        f32(fwd[0]); f32(fwd[1]); f32(fwd[2]);
        f32(0); // tag
        f32(opts.grade?.[i] ?? 0);
    }
    i32(0); // hasGrid
    return new Uint8Array(buf);
}
