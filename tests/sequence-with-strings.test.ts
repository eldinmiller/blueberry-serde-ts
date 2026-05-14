/**
 * Round-trip tests for `sequence<Struct>` where the struct contains string
 * fields.
 *
 * Regression coverage for the "string body out of bounds" bug surfaced by
 * `blueberry-studio`'s Manifest pipeline (Lane S + Lane T fake-node):
 * the string-deferred-block index inside a sequence-element sub-writer is
 * patched relative to the sub-writer's own bytes, but the outer
 * `BlueberryReader.readString` was resolving it against the parent
 * `messageStart`, blowing past the message end on the second and
 * subsequent elements.
 */

import { describe, expect, test } from 'vitest';

import { deserializeMessage, serializeMessage } from '../src/index.js';

interface StringEntry {
  kind: number;
  flags: number;
  refKey: number;
  name: string;
  unit: string;
  minValue: number;
  maxValue: number;
  typeRef: string;
}

interface ManifestLikeFields {
  partIndex: number;
  totalParts: number;
  manifestCrc: number;
  entries: StringEntry[];
}

const MODULE_KEY = 0x4244;
const MESSAGE_KEY = 0x9102;

function encodeManifestLike(fields: ManifestLikeFields): Uint8Array {
  return serializeMessage<ManifestLikeFields>(fields, MODULE_KEY, MESSAGE_KEY, (w, f) => {
    w.writeU16(f.partIndex);
    w.fieldDelta();
    w.writeU16(f.totalParts);
    w.fieldDelta();
    w.writeU32(f.manifestCrc);
    w.fieldDelta();
    const seq = w.beginSequence();
    for (const entry of f.entries) {
      seq.writeElement((sw) => {
        sw.writeU8(entry.kind);
        sw.writeU8(entry.flags);
        sw.writeU16(entry.refKey);
        sw.writeString(entry.name);
        sw.writeString(entry.unit);
        sw.writeF32(entry.minValue);
        sw.writeF32(entry.maxValue);
        sw.writeString(entry.typeRef);
      });
    }
    seq.end();
    w.fieldDelta();
  });
}

function decodeManifestLike(bytes: Uint8Array) {
  return deserializeMessage<ManifestLikeFields>(bytes, (r) => {
    const partIndex = r.readU16();
    const totalParts = r.readU16();
    const manifestCrc = r.readU32();
    const seq = r.beginSequence();
    const entries: StringEntry[] = [];
    for (let i = 0; i < seq.count; i++) {
      entries.push(
        seq.readElement((sr) => ({
          kind: sr.readU8(),
          flags: sr.readU8(),
          refKey: sr.readU16(),
          name: sr.readString(),
          unit: sr.readString(),
          minValue: sr.readF32(),
          maxValue: sr.readF32(),
          typeRef: sr.readString(),
        })),
      );
    }
    return { partIndex, totalParts, manifestCrc, entries };
  });
}

describe('sequence<Struct> with string fields', () => {
  test('round-trips a single-element sequence with strings', () => {
    const fields: ManifestLikeFields = {
      partIndex: 0,
      totalParts: 1,
      manifestCrc: 0xa1b2c3d4,
      entries: [
        {
          kind: 1,
          flags: 0,
          refKey: 0x4242,
          name: 'IdMessage',
          unit: '',
          minValue: 0,
          maxValue: 0,
          typeRef: '',
        },
      ],
    };
    const encoded = encodeManifestLike(fields);
    const { fields: decoded } = decodeManifestLike(encoded);
    expect(decoded).toEqual(fields);
  });

  test('round-trips a multi-element sequence where every element has strings', () => {
    const fields: ManifestLikeFields = {
      partIndex: 0,
      totalParts: 1,
      manifestCrc: 0xa1b2c3d4,
      entries: [
        {
          kind: 1,
          flags: 0,
          refKey: 0x4242,
          name: 'IdMessage',
          unit: '',
          minValue: 0,
          maxValue: 0,
          typeRef: '',
        },
        {
          kind: 1,
          flags: 0,
          refKey: 0x4243,
          name: 'VersionMessage',
          unit: '',
          minValue: 0,
          maxValue: 0,
          typeRef: '',
        },
        {
          kind: 4,
          flags: 1,
          refKey: 0,
          name: 'imu0_ax',
          unit: 'm/s^2',
          minValue: -16,
          maxValue: 16,
          typeRef: 'float',
        },
      ],
    };
    const encoded = encodeManifestLike(fields);
    const { fields: decoded } = decodeManifestLike(encoded);
    expect(decoded).toEqual(fields);
  });

  test('round-trips a sequence with variable-length strings per element', () => {
    const fields: ManifestLikeFields = {
      partIndex: 1,
      totalParts: 2,
      manifestCrc: 0xdeadbeef,
      entries: [
        {
          kind: 4,
          flags: 1,
          refKey: 0,
          name: 'a',
          unit: 'g',
          minValue: -1,
          maxValue: 1,
          typeRef: 'f32',
        },
        {
          kind: 4,
          flags: 3,
          refKey: 0,
          name: 'motor0_revolutions_per_second',
          unit: 'rev/s',
          minValue: -50,
          maxValue: 50,
          typeRef: 'float',
        },
        {
          kind: 5,
          flags: 0,
          refKey: 0,
          name: 'serialNumber',
          unit: 'FAKE-0001',
          minValue: 0,
          maxValue: 0,
          typeRef: '',
        },
      ],
    };
    const encoded = encodeManifestLike(fields);
    const { fields: decoded } = decodeManifestLike(encoded);
    expect(decoded).toEqual(fields);
  });
});
