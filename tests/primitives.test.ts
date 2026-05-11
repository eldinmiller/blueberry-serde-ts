/**
 * Primitive serialization, alignment, and bool packing.
 *
 * Ported from `blueberry-serde-python/tests/test_primitives.py`.
 */

import { describe, expect, test } from 'vitest';

import { BlueberryReader, BlueberryWriter, deserialize, serialize } from '../src/index.js';

describe('two u32 fields', () => {
  test('roundtrip', () => {
    const data = serialize<{ a: number; b: number }>({ a: 1, b: 2 }, (w, f) => {
      w.writeU32(f.a);
      w.writeU32(f.b);
    });
    expect(data.length).toBe(8);

    const rt = deserialize<{ a: number; b: number }>(data, (r) => ({
      a: r.readU32(),
      b: r.readU32(),
    }));
    expect(rt.a).toBe(1);
    expect(rt.b).toBe(2);
  });
});

describe('mixed primitive alignment', () => {
  test('roundtrip', () => {
    const data = serialize<{ byteVal: number; shortVal: number; intVal: number }>(
      { byteVal: 0xff, shortVal: 0x1234, intVal: 0xdeadbeef },
      (w, f) => {
        w.writeU8(f.byteVal);
        w.writeU16(f.shortVal);
        w.writeU32(f.intVal);
      },
    );
    const rt = deserialize<{ byteVal: number; shortVal: number; intVal: number }>(data, (r) => ({
      byteVal: r.readU8(),
      shortVal: r.readU16(),
      intVal: r.readU32(),
    }));
    expect(rt.byteVal).toBe(0xff);
    expect(rt.shortVal).toBe(0x1234);
    expect(rt.intVal).toBe(0xdeadbeef);
  });
});

describe('bool packing', () => {
  test('three bools then a u16 then another bool', () => {
    const data = serialize<{ a: boolean; b: boolean; c: boolean; x: number; d: boolean }>(
      { a: true, b: false, c: true, x: 0x1234, d: true },
      (w, f) => {
        w.writeBool(f.a);
        w.writeBool(f.b);
        w.writeBool(f.c);
        w.writeU16(f.x);
        w.writeBool(f.d);
      },
    );
    const rt = deserialize<{ a: boolean; b: boolean; c: boolean; x: number; d: boolean }>(
      data,
      (r) => ({
        a: r.readBool(),
        b: r.readBool(),
        c: r.readBool(),
        x: r.readU16(),
        d: r.readBool(),
      }),
    );
    expect(rt.a).toBe(true);
    expect(rt.b).toBe(false);
    expect(rt.c).toBe(true);
    expect(rt.x).toBe(0x1234);
    expect(rt.d).toBe(true);

    // a=1, b=0, c=1 packed LSb first => 0b00000101 = 0x05
    expect(data[0]).toBe(0x05);
  });

  test('eight bools fit in one byte', () => {
    const bs = [true, false, true, false, true, true, false, true];
    const data = serialize(bs, (w, f) => {
      for (const v of f) w.writeBool(v);
    });
    expect(data.length).toBe(1);
    // 0b10110101 = 0xB5 (LSb-first: b0=1, b1=0, b2=1, b3=0, b4=1, b5=1, b6=0, b7=1)
    expect(data[0]).toBe(0xb5);

    const rt = deserialize<boolean[]>(data, (r) => {
      const out: boolean[] = [];
      for (let i = 0; i < 8; i++) out.push(r.readBool());
      return out;
    });
    expect(rt).toEqual(bs);
  });

  test('ninth bool starts a new byte', () => {
    const data = serialize(null, (w) => {
      for (let i = 0; i < 9; i++) w.writeBool(true);
    });
    expect(data.length).toBe(2);
    expect(data[0]).toBe(0xff);
    expect(data[1]).toBe(0x01);
  });
});

describe('8-byte types align on 4-byte boundary', () => {
  test('u8 then u64 pads only to 4', () => {
    // a=u8 at pos 0; b=u64 should align to 4 (NOT 8), so 3 bytes of padding,
    // then 8 bytes for the u64. Total = 12 bytes.
    const data = serialize<{ a: number; b: bigint }>(
      { a: 0xaa, b: 0x0102030405060708n },
      (w, f) => {
        w.writeU8(f.a);
        w.writeU64(f.b);
      },
    );
    expect(data.length).toBe(12);
    expect(data[0]).toBe(0xaa);
    expect(data[1]).toBe(0x00);
    expect(data[2]).toBe(0x00);
    expect(data[3]).toBe(0x00);
    // u64 LE: 08 07 06 05 04 03 02 01
    expect(Array.from(data.slice(4))).toEqual([0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]);

    const rt = deserialize<{ a: number; b: bigint }>(data, (r) => ({
      a: r.readU8(),
      b: r.readU64(),
    }));
    expect(rt.a).toBe(0xaa);
    expect(rt.b).toBe(0x0102030405060708n);
  });

  test('u8 then f64 pads only to 4', () => {
    const data = serialize<{ a: number; b: number }>({ a: 0x01, b: 1.5 }, (w, f) => {
      w.writeU8(f.a);
      w.writeF64(f.b);
    });
    expect(data.length).toBe(12);
    const rt = deserialize<{ a: number; b: number }>(data, (r) => ({
      a: r.readU8(),
      b: r.readF64(),
    }));
    expect(rt.a).toBe(0x01);
    expect(rt.b).toBe(1.5);
  });
});

describe('signed primitives', () => {
  test('i8/i16/i32/i64 roundtrip', () => {
    const data = serialize(null, (w) => {
      w.writeI8(-1);
      w.writeI16(-2);
      w.writeI32(-3);
      w.writeI64(-4n);
    });
    const r = new BlueberryReader(data);
    expect(r.readI8()).toBe(-1);
    expect(r.readI16()).toBe(-2);
    expect(r.readI32()).toBe(-3);
    expect(r.readI64()).toBe(-4n);
  });

  test('i64 extremes preserved as bigint', () => {
    const min = -(2n ** 63n);
    const max = 2n ** 63n - 1n;
    const data = serialize(null, (w) => {
      w.writeI64(min);
      w.writeI64(max);
    });
    const r = new BlueberryReader(data);
    expect(r.readI64()).toBe(min);
    expect(r.readI64()).toBe(max);
  });

  test('u64 max preserved', () => {
    const max = 2n ** 64n - 1n;
    const data = serialize(null, (w) => {
      w.writeU64(max);
    });
    expect(deserialize<bigint>(data, (r) => r.readU64())).toBe(max);
  });
});

describe('float primitives', () => {
  test('f32 roundtrip', () => {
    const data = serialize(null, (w) => {
      w.writeF32(23.5);
    });
    expect(deserialize<number>(data, (r) => r.readF32())).toBe(23.5);
  });

  test('f64 roundtrip', () => {
    const data = serialize(null, (w) => {
      w.writeF64(Math.PI);
    });
    expect(deserialize<number>(data, (r) => r.readF64())).toBeCloseTo(Math.PI, 15);
  });
});

describe('field count tracking', () => {
  test('fieldDelta increments getFieldCount', () => {
    const w = new BlueberryWriter();
    w.writeU32(1);
    w.fieldDelta();
    w.writeU16(2);
    w.fieldDelta();
    w.writeBool(true);
    w.fieldDelta();
    expect(w.getFieldCount()).toBe(3);
  });
});
