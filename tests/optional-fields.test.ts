/**
 * Trailing `OptionalOrdinal` fields and `max_ordinal` forward/backward compatibility.
 *
 * Ported from `blueberry-serde-python/tests/test_optional_fields.py`. Golden
 * byte vectors are the same as Python's, asserting byte-exact compatibility
 * with the canonical Rust runtime.
 */

import { describe, expect, test } from 'vitest';

import { deserializeMessage, serializeMessage } from '../src/index.js';

const SP_MODULE = 0x01;
const SP_MSG = 0x02;

// ---- Models (declaration-order matches Python) -------------------------

interface SmallPotato {
  a: number;
  b: number;
}
const encodeSmallPotato = (m: SmallPotato) =>
  serializeMessage<SmallPotato>(m, SP_MODULE, SP_MSG, (w, f) => {
    w.writeU8(f.a);
    w.fieldDelta();
    w.writeU32(f.b);
    w.fieldDelta();
  });
const decodeSmallPotato = (b: Uint8Array) =>
  deserializeMessage<SmallPotato>(b, (r) => ({ a: r.readU8(), b: r.readU32() }));

interface SmallPotatoV1Flat {
  a: number;
  c: number;
  b: number;
}
const encodeV1 = (m: SmallPotatoV1Flat) =>
  serializeMessage<SmallPotatoV1Flat>(m, SP_MODULE, SP_MSG, (w, f) => {
    w.writeU8(f.a);
    w.fieldDelta();
    w.writeU8(f.c);
    w.fieldDelta();
    w.writeU32(f.b);
    w.fieldDelta();
  });
const decodeV1 = (b: Uint8Array) =>
  deserializeMessage<SmallPotatoV1Flat>(b, (r) => ({
    a: r.readU8(),
    c: r.readU8(),
    b: r.readU32(),
  }));

interface SmallPotatoV2Flat {
  a: number;
  c: number;
  d: number;
  b: number;
}
const encodeV2 = (m: SmallPotatoV2Flat) =>
  serializeMessage<SmallPotatoV2Flat>(m, SP_MODULE, SP_MSG, (w, f) => {
    w.writeU8(f.a);
    w.fieldDelta();
    w.writeU8(f.c);
    w.fieldDelta();
    w.writeU8(f.d);
    w.fieldDelta();
    w.writeU32(f.b);
    w.fieldDelta();
  });
const decodeV2 = (b: Uint8Array) =>
  deserializeMessage<SmallPotatoV2Flat>(b, (r) => ({
    a: r.readU8(),
    c: r.readU8(),
    d: r.readU8(),
    b: r.readU32(),
  }));

interface SmallPotatoV3Flat {
  a: number;
  c: number;
  d: number;
  e: number;
  b: number;
}
const encodeV3 = (m: SmallPotatoV3Flat) =>
  serializeMessage<SmallPotatoV3Flat>(m, SP_MODULE, SP_MSG, (w, f) => {
    w.writeU8(f.a);
    w.fieldDelta();
    w.writeU8(f.c);
    w.fieldDelta();
    w.writeU8(f.d);
    w.fieldDelta();
    w.writeU8(f.e);
    w.fieldDelta();
    w.writeU32(f.b);
    w.fieldDelta();
  });
const decodeV3 = (b: Uint8Array) =>
  deserializeMessage<SmallPotatoV3Flat>(b, (r) => ({
    a: r.readU8(),
    c: r.readU8(),
    d: r.readU8(),
    e: r.readU8(),
    b: r.readU32(),
  }));

interface SmallPotatoV4Flat {
  a: number;
  c: number;
  d: number;
  e: number;
  b: number;
  f: number;
}
const encodeV4 = (m: SmallPotatoV4Flat) =>
  serializeMessage<SmallPotatoV4Flat>(m, SP_MODULE, SP_MSG, (w, f) => {
    w.writeU8(f.a);
    w.fieldDelta();
    w.writeU8(f.c);
    w.fieldDelta();
    w.writeU8(f.d);
    w.fieldDelta();
    w.writeU8(f.e);
    w.fieldDelta();
    w.writeU32(f.b);
    w.fieldDelta();
    w.writeU32(f.f);
    w.fieldDelta();
  });
const decodeV4 = (b: Uint8Array) =>
  deserializeMessage<SmallPotatoV4Flat>(b, (r) => ({
    a: r.readU8(),
    c: r.readU8(),
    d: r.readU8(),
    e: r.readU8(),
    b: r.readU32(),
    f: r.readU32(),
  }));

interface SmallPotatoOptional {
  a: number;
  c: number | null;
  d: number | null;
  e: number | null;
  b: number;
  f: number | null;
}

/**
 * Optional ordinal encoder: each field's write is wrapped in an
 * `if (value !== null)` so absent fields don't bump the field count.
 *
 * Note that Python's "trailing optional" semantic requires consecutive
 * Some values; gaps are not allowed because the wire format relies on
 * sequential positioning. The fixture follows that convention.
 */
const encodeOpt = (m: SmallPotatoOptional) =>
  serializeMessage<SmallPotatoOptional>(m, SP_MODULE, SP_MSG, (w, f) => {
    w.writeU8(f.a);
    w.fieldDelta();
    if (f.c !== null) {
      w.writeU8(f.c);
      w.fieldDelta();
    }
    if (f.d !== null) {
      w.writeU8(f.d);
      w.fieldDelta();
    }
    if (f.e !== null) {
      w.writeU8(f.e);
      w.fieldDelta();
    }
    w.writeU32(f.b);
    w.fieldDelta();
    if (f.f !== null) {
      w.writeU32(f.f);
      w.fieldDelta();
    }
  });

const decodeOpt = (b: Uint8Array) =>
  deserializeMessage<SmallPotatoOptional>(b, (r) => {
    const a = r.readU8();
    const cVal = r.hasField(3) ? r.readU8() : null;
    const dVal = r.hasField(4) ? r.readU8() : null;
    const eVal = r.hasField(5) ? r.readU8() : null;
    const bVal = r.readU32();
    const fVal = r.hasField(6) ? r.readU32() : null;
    return { a, c: cVal, d: dVal, e: eVal, b: bVal, f: fVal };
  });

// ---- Golden byte vectors (identical to Python) -------------------------

// prettier-ignore
const SP_GOLD_BASE = new Uint8Array([
  0x02, 0x00, 0x01, 0x00, // module_message_key (msg=2, mod=1)
  0x04, 0x00, 0x04, 0x00, // length=4, max_ordinal=4, tbd=0
  0x01, 0x00, 0x00, 0x00, // a=1 + 3 bytes padding for b
  0x02, 0x00, 0x00, 0x00, // b=2
]);

// prettier-ignore
const SP_GOLD_V1 = new Uint8Array([
  0x02, 0x00, 0x01, 0x00,
  0x04, 0x00, 0x05, 0x00, // max_ordinal=5
  0x01, 0x03, 0x00, 0x00, // a=1, c=3, 2 bytes padding
  0x02, 0x00, 0x00, 0x00, // b=2
]);

// prettier-ignore
const SP_GOLD_V2 = new Uint8Array([
  0x02, 0x00, 0x01, 0x00,
  0x04, 0x00, 0x06, 0x00, // max_ordinal=6
  0x01, 0x03, 0x04, 0x00, // a=1, c=3, d=4, 1 byte padding
  0x02, 0x00, 0x00, 0x00, // b=2
]);

// prettier-ignore
const SP_GOLD_V3 = new Uint8Array([
  0x02, 0x00, 0x01, 0x00,
  0x04, 0x00, 0x07, 0x00, // max_ordinal=7
  0x01, 0x03, 0x04, 0x05, // a=1, c=3, d=4, e=5 (fills gap exactly)
  0x02, 0x00, 0x00, 0x00, // b=2
]);

// prettier-ignore
const SP_GOLD_V4 = new Uint8Array([
  0x02, 0x00, 0x01, 0x00,
  0x05, 0x00, 0x08, 0x00, // length=5, max_ordinal=8
  0x01, 0x03, 0x04, 0x05, // a=1, c=3, d=4, e=5
  0x02, 0x00, 0x00, 0x00, // b=2
  0x06, 0x00, 0x00, 0x00, // f=6
]);

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---- Gold-wired serialization ------------------------------------------

describe('serialize matches Python/Rust golden bytes', () => {
  test('base', () => {
    expect(Array.from(encodeSmallPotato({ a: 1, b: 2 }))).toEqual(Array.from(SP_GOLD_BASE));
  });

  test('v1', () => {
    expect(Array.from(encodeV1({ a: 1, c: 3, b: 2 }))).toEqual(Array.from(SP_GOLD_V1));
  });

  test('v2', () => {
    expect(Array.from(encodeV2({ a: 1, c: 3, d: 4, b: 2 }))).toEqual(Array.from(SP_GOLD_V2));
  });

  test('v3', () => {
    expect(Array.from(encodeV3({ a: 1, c: 3, d: 4, e: 5, b: 2 }))).toEqual(Array.from(SP_GOLD_V3));
  });

  test('v4', () => {
    expect(Array.from(encodeV4({ a: 1, c: 3, d: 4, e: 5, b: 2, f: 6 }))).toEqual(
      Array.from(SP_GOLD_V4),
    );
  });
});

// ---- Forward-compat: read newer wire with older schema ------------------

describe('forward compatibility (read newer wire with older schema)', () => {
  test('v4 wire as base', () => {
    const { fields } = decodeSmallPotato(SP_GOLD_V4);
    expect(fields.a).toBe(1);
    expect(fields.b).toBe(2);
  });

  test('v4 wire as v1', () => {
    const { fields } = decodeV1(SP_GOLD_V4);
    expect(fields).toEqual({ a: 1, c: 3, b: 2 });
  });

  test('v4 wire as v2', () => {
    const { fields } = decodeV2(SP_GOLD_V4);
    expect(fields).toEqual({ a: 1, c: 3, d: 4, b: 2 });
  });

  test('v4 wire as v3', () => {
    const { fields } = decodeV3(SP_GOLD_V4);
    expect(fields).toEqual({ a: 1, c: 3, d: 4, e: 5, b: 2 });
  });

  test('v3 wire as base', () => {
    const { fields } = decodeSmallPotato(SP_GOLD_V3);
    expect(fields).toEqual({ a: 1, b: 2 });
  });
});

// ---- Roundtrips ---------------------------------------------------------

describe('basic roundtrips', () => {
  test('base roundtrip', () => {
    const data = encodeSmallPotato({ a: 1, b: 2 });
    expect(decodeSmallPotato(data).fields).toEqual({ a: 1, b: 2 });
  });

  test('v1 roundtrip', () => {
    const data = encodeV1({ a: 1, c: 3, b: 2 });
    expect(decodeV1(data).fields).toEqual({ a: 1, c: 3, b: 2 });
  });

  test('v3 roundtrip', () => {
    const data = encodeV3({ a: 1, c: 3, d: 4, e: 5, b: 2 });
    expect(decodeV3(data).fields).toEqual({ a: 1, c: 3, d: 4, e: 5, b: 2 });
  });

  test('v4 roundtrip', () => {
    const data = encodeV4({ a: 1, c: 3, d: 4, e: 5, b: 2, f: 6 });
    expect(decodeV4(data).fields).toEqual({ a: 1, c: 3, d: 4, e: 5, b: 2, f: 6 });
  });
});

// ---- OptionalOrdinal-style trailing fields ------------------------------

describe('OptionalOrdinal trailing fields', () => {
  test('roundtrip all-present', () => {
    const data = encodeOpt({ a: 1, c: 3, d: 4, e: 5, b: 2, f: 6 });
    expect(bytesEqual(data, SP_GOLD_V4)).toBe(true);
    const { fields } = decodeOpt(data);
    expect(fields).toEqual({ a: 1, c: 3, d: 4, e: 5, b: 2, f: 6 });
  });

  test('roundtrip all-absent matches base bytes', () => {
    const data = encodeOpt({ a: 1, c: null, d: null, e: null, b: 2, f: null });
    expect(bytesEqual(data, SP_GOLD_BASE)).toBe(true);
    const { fields } = decodeOpt(data);
    expect(fields).toEqual({ a: 1, c: null, d: null, e: null, b: 2, f: null });
  });

  test('decode v4 wire as optional', () => {
    const { fields } = decodeOpt(SP_GOLD_V4);
    expect(fields).toEqual({ a: 1, c: 3, d: 4, e: 5, b: 2, f: 6 });
  });

  test('decode base wire as optional', () => {
    const { fields } = decodeOpt(SP_GOLD_BASE);
    expect(fields).toEqual({ a: 1, c: null, d: null, e: null, b: 2, f: null });
  });

  test('decode v1 wire as optional: c=present, rest null', () => {
    const { fields } = decodeOpt(SP_GOLD_V1);
    expect(fields).toEqual({ a: 1, c: 3, d: null, e: null, b: 2, f: null });
  });

  test('decode v2 wire as optional: c,d present', () => {
    const { fields } = decodeOpt(SP_GOLD_V2);
    expect(fields).toEqual({ a: 1, c: 3, d: 4, e: null, b: 2, f: null });
  });

  test('decode v3 wire as optional: c,d,e present, f null', () => {
    const { fields } = decodeOpt(SP_GOLD_V3);
    expect(fields).toEqual({ a: 1, c: 3, d: 4, e: 5, b: 2, f: null });
  });
});
