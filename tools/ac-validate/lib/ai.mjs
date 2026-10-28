// fast_lane.ai / pit_lane.ai reader, from community documentation (AcTools AiSpline layout).
//
//   int32 version (7 for current AC), int32 pointCount, int32 lapTime(?), int32 sampleCount
//   pointCount x { f32[3] position, f32 length, int32 id }                       (20 bytes)
//   int32 extraCount (== pointCount)
//   extraCount x 18 f32 (version 7):
//     speed, gas, brake, obsoleteLatG, radius, sideLeft, sideRight, camber, direction,
//     normal[3], length, forward[3], tag, grade                                   (72 bytes)
//   optional trailing data (grid / cache) - not validated.

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
  out.trailingBytes = r.remaining;
  return out;
}

export function extraField(ai, i, field) {
  if (!ai.extra || ai.extraStride !== 18) return undefined;
  const k = EXTRA_FIELDS_V7.indexOf(field);
  return ai.extra[i * 18 + k];
}
