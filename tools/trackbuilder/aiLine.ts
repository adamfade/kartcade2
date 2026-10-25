// ai/fast_lane.ai writer (spline the AI follows and AC uses for the track map/progress).
// Layout (version 7): int32 version, int32 count, int32 lapTime, int32 sampleCount,
//   count x { float x, y, z, float length, int32 id },
//   int32 extraCount, extraCount x 18 floats {speed, gas, brake, obsoleteLatG, radius, sideLeft, sideRight,
//   camber, direction, normal xyz, length, forward xyz, tag, grade}.

export interface AiPoint { x: number; y: number; z: number } // AC space (X east, Y up, Z north)

export function writeFastLane(points: AiPoint[], opts: { halfWidth: number; curvature?: number[]; grade?: number[] }): Uint8Array {
    const n = points.length;
    const size = 16 + n * 20 + 4 + n * 18 * 4;
    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    let o = 0;
    const i32 = (v: number) => { dv.setInt32(o, v, true); o += 4; };
    const f32 = (v: number) => { dv.setFloat32(o, Number.isFinite(v) ? v : 0, true); o += 4; };
    i32(7); i32(n); i32(0); i32(0);
    const len: number[] = [0];
    for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z));
    for (let i = 0; i < n; i++) { f32(points[i].x); f32(points[i].y); f32(points[i].z); f32(len[i]); i32(i); }
    i32(n);
    // Target speed from curvature: v = sqrt(a_lat * r), capped; brake ahead of tight corners.
    const k = opts.curvature ?? new Array(n).fill(0);
    const speed = k.map((kk) => Math.min(45, Math.sqrt(7.5 / Math.max(1e-4, Math.abs(kk)))));
    for (let pass = 0; pass < 2; pass++) for (let i = n - 2; i >= 0; i--) {
        const ds = len[i + 1] - len[i];
        speed[i] = Math.min(speed[i], Math.sqrt(speed[i + 1] ** 2 + 2 * 6 * ds)); // ~0.6 g braking
    }
    for (let i = 0; i < n; i++) {
        const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
        const fl = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
        const fwd = [(b.x - a.x) / fl, (b.y - a.y) / fl, (b.z - a.z) / fl];
        const nextSpeed = speed[Math.min(n - 1, i + 3)];
        const braking = nextSpeed < speed[i] - 0.5;
        f32(speed[i]); // speed m/s
        f32(braking ? 0 : 1); // gas
        f32(braking ? 0.6 : 0); // brake
        f32(0); // obsolete lat G
        f32(Math.abs(k[i]) > 1e-5 ? 1 / Math.abs(k[i]) : 10000); // radius
        f32(opts.halfWidth); f32(opts.halfWidth); // side left / right
        f32(0); // camber
        f32(Math.atan2(fwd[0], fwd[2])); // direction
        f32(0); f32(1); f32(0); // normal
        f32(len[i]);
        f32(fwd[0]); f32(fwd[1]); f32(fwd[2]);
        f32(0); // tag
        f32(opts.grade?.[i] ?? 0);
    }
    return new Uint8Array(buf);
}
