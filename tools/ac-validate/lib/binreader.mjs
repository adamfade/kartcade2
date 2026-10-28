// Little-endian bounds-checked binary reader shared by the KN5 and AI parsers.

export class FormatError extends Error {
  constructor(msg, offset) {
    super(offset === undefined ? msg : `${msg} (at byte offset ${offset})`);
    this.offset = offset;
  }
}

export class Reader {
  constructor(buf) {
    this.b = buf;
    this.o = 0;
  }
  get remaining() {
    return this.b.length - this.o;
  }
  need(n, what = 'data') {
    if (n < 0 || this.o + n > this.b.length) {
      throw new FormatError(
        `unexpected end of file reading ${what}: need ${n} bytes, ${this.b.length - this.o} left`,
        this.o,
      );
    }
  }
  u8() { this.need(1); return this.b[this.o++]; }
  i32() { this.need(4); const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  u32() { this.need(4); const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  u16() { this.need(2); const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  f32() { this.need(4); const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  bytes(n, what) { this.need(n, what); const s = this.b.subarray(this.o, this.o + n); this.o += n; return s; }
  skip(n, what) { this.need(n, what); this.o += n; }
  // KN5 strings: int32 byte length followed by the bytes (no terminator).
  str(what = 'string', max = 4096) {
    const at = this.o;
    const n = this.i32();
    if (n < 0 || n > max) throw new FormatError(`implausible ${what} length ${n}`, at);
    this.need(n, what);
    const s = this.b.toString('utf8', this.o, this.o + n);
    this.o += n;
    return s;
  }
  // Validate a count against the bytes left, given a minimum per-item size.
  count(what, minItemBytes, signed = true) {
    const at = this.o;
    const n = signed ? this.i32() : this.u32();
    if (n < 0) throw new FormatError(`negative ${what} count ${n}`, at);
    if (minItemBytes > 0 && n * minItemBytes > this.remaining) {
      throw new FormatError(
        `${what} count ${n} needs at least ${n * minItemBytes} bytes but only ${this.remaining} remain`,
        at,
      );
    }
    return n;
  }
}
