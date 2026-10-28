// fast_lane.ai / pit_lane.ai reader, from community documentation (AcTools AiSpline layout).
//
//   int32 version (7 for current AC), int32 pointCount, int32 lapTime(?), int32 sampleCount
//   pointCount x { f32[3] position, f32 length, int32 id }                       (20 bytes)
//   int32 extraCount (== pointCount)
//   extraCount x 18 f32 (version 7):
//     speed, gas, brake, obsoleteLatG, radius, sideLeft, sideRight, camber, direction,
//     normal[3], length, forward[3], tag, grade                                   (72 bytes)
//   int32 hasGrid; if non-zero, a spatial lookup grid follows:
//     f32[3] maxExtreme, f32[3] minExtreme, int32 neighborsConsidered, f32 samplingDensity,
//     int32 itemCount, itemCount x { int32 subCount, subCount x { int32 n, n x int32 pointIndex } }
//   AC's loader reads the hasGrid flag, so a v7 file that stops right after the extra data is truncated.

import { Reader, FormatError } from './binreader.mjs';

export const EXTRA_FIELDS_V7 = [
  'speed', 'gas', 'brake', 'obsoleteLatG', 'radius', 'sideLeft', 'sideRight', 'camber', 'direction',
  'normalX', 'normalY', 'normalZ', 'length', 'forwardX', 'forwardY', 'forwardZ', 'tag', 'grade',
];

export function parseAi(buf) {
  const r = new Reader(buf);
  const version = r.i32();
  const at = r.o;
  const count = r.i32();
  if (count < 0 || count * 20 > r.remaining - 8) {
    throw new FormatError(`point count ${count} does not fit in file of ${buf.length} bytes`, at);
  }
  const lapTime = r.i32();
  const sampleCount = r.i32();
  const pos = new Float64Array(count * 3);
  const length = new Float64Array(count);
  const ids = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = r.f32(); pos[i * 3 + 1] = r.f32(); pos[i * 3 + 2] = r.f32();
    length[i] = r.f32();
    ids[i] = r.i32();
  }
  const out = { version, count, lapTime, sampleCount, pos, length, ids, extra: null, extraStride: 0, extraCount: null, trailingBytes: 0, notes: [] };
  if (r.remaining === 0) {
    out.notes.push('no extra-data section after the points');
    return out;
  }
  if (r.remaining < 4) {
    out.trailingBytes = r.remaining;
    return out;
  }
  const extraCount = r.i32();
  out.extraCount = extraCount;
  if (extraCount !== count) {
    out.notes.push(`extra-data count ${extraCount} does not match point count ${count}`);
    out.trailingBytes = r.remaining;
    return out;
  }
  let stride = version === 7 ? 18 : 0;
  if (!stride && count > 0) {
    // Unknown version: guess a float stride that fits.
    const guess = Math.floor(r.remaining / count / 4);
    if (guess > 0 && guess <= 32) stride = guess;
  }
  if (stride && count * stride * 4 <= r.remaining) {
    const extra = new Float64Array(count * stride);
    for (let i = 0; i < count * stride; i++) extra[i] = r.f32();
    out.extra = extra;
    out.extraStride = stride;
  } else if (stride) {
    out.notes.push(`extra-data section truncated: need ${count * stride * 4} bytes, ${r.remaining} left`);
    out.truncatedExtra = true;
  }
  if (out.extra && version === 7) readGrid(r, out, count);
  out.trailingBytes = r.remaining;
  return out;
}

function readGrid(r, out, count) {
  if (r.remaining < 4) { out.gridFlagMissing = true; return; }
  const flag = r.i32();
  out.hasGrid = flag !== 0;
  if (!out.hasGrid) return;
  try {
    const maxE = [r.f32(), r.f32(), r.f32()], minE = [r.f32(), r.f32(), r.f32()];
    const neighbors = r.i32(), density = r.f32();
    const items = r.i32();
    if (items < 0 || items * 4 > r.remaining) throw new FormatError(`grid item count ${items} does not fit`, r.o);
    let cells = 0, refs = 0, badRefs = 0;
    for (let i = 0; i < items; i++) {
      const subs = r.i32();
      if (subs < 0 || subs * 4 > r.remaining) throw new FormatError(`grid row ${i} count ${subs} does not fit`, r.o);
      for (let j = 0; j < subs; j++) {
        const k = r.i32();
        if (k < 0 || k * 4 > r.remaining) throw new FormatError(`grid cell ${i}/${j} count ${k} does not fit`, r.o);
        cells++;
        for (let m = 0; m < k; m++) { const v = r.i32(); refs++; if (v < 0 || v >= count) badRefs++; }
      }
    }
    out.grid = { maxE, minE, neighbors, density, items, cells, refs, badRefs };
  } catch (e) {
    out.gridError = e.message;
  }
}

export function extraField(ai, i, field) {
  if (!ai.extra || ai.extraStride !== 18) return undefined;
  const k = EXTRA_FIELDS_V7.indexOf(field);
  return ai.extra[i * 18 + k];
}
