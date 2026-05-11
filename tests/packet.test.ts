/**
 * Packet framing, CRC, and multi-message packets.
 *
 * Ported from `blueberry-serde-python/tests/test_packet.py`.
 */

import { describe, expect, test } from 'vitest';

import {
  BLUEBERRY_PORT,
  PACKET_HEADER_SIZE,
  PACKET_MAGIC,
  crc16Ccitt,
  deserializeMessage,
  deserializePacket,
  emptyMessage,
  serializeMessage,
  serializePacket,
} from '../src/index.js';

interface Simple {
  value: number;
}

const MODULE = 0;
const MESSAGE = 0;

function encodeSimple(value: number): Uint8Array {
  return serializeMessage<Simple>({ value }, MODULE, MESSAGE, (w, f) => {
    w.writeU32(f.value);
    w.fieldDelta();
  });
}

function decodeSimple(bytes: Uint8Array) {
  return deserializeMessage<Simple>(bytes, (r) => ({ value: r.readU32() }));
}

describe('packet framing', () => {
  test('starts with magic word', () => {
    const msg = encodeSimple(1);
    const pkt = serializePacket([msg]);
    expect(Array.from(pkt.subarray(0, 4))).toEqual(Array.from(PACKET_MAGIC));
  });

  test('is a multiple of 4 bytes', () => {
    const msg = encodeSimple(1);
    const pkt = serializePacket([msg]);
    expect(pkt.length % 4).toBe(0);
  });

  test('length field reflects total words including header', () => {
    const msg = encodeSimple(1);
    const pkt = serializePacket([msg]);
    const view = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
    const lengthWords = view.getUint16(4, true);
    expect(lengthWords * 4).toBe(pkt.length);
  });

  test('embedded CRC matches a recomputed CRC over message data', () => {
    const msg = encodeSimple(0xdeadbeef);
    const pkt = serializePacket([msg]);
    const view = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
    const embeddedCrc = view.getUint16(6, true);
    const messageData = pkt.subarray(PACKET_HEADER_SIZE);
    expect(crc16Ccitt(messageData)).toBe(embeddedCrc);
  });

  test('roundtrip a single message', () => {
    const msg = encodeSimple(42);
    const pkt = serializePacket([msg]);
    const { messages } = deserializePacket(pkt);
    expect(messages.length).toBe(1);
    const { fields } = decodeSimple(messages[0]!);
    expect(fields.value).toBe(42);
  });

  test('roundtrip multiple messages', () => {
    const messages = [encodeSimple(1), encodeSimple(2), encodeSimple(3)];
    const pkt = serializePacket(messages);
    const parsed = deserializePacket(pkt);
    expect(parsed.messages.length).toBe(3);
    expect(decodeSimple(parsed.messages[0]!).fields.value).toBe(1);
    expect(decodeSimple(parsed.messages[1]!).fields.value).toBe(2);
    expect(decodeSimple(parsed.messages[2]!).fields.value).toBe(3);
  });

  test('CRC mismatch is rejected', () => {
    const pkt = serializePacket([encodeSimple(1)]);
    // Corrupt one byte after the header.
    pkt[PACKET_HEADER_SIZE] = pkt[PACKET_HEADER_SIZE]! ^ 0xff;
    expect(() => deserializePacket(pkt)).toThrow(/CRC/);
  });

  test('bad magic is rejected', () => {
    const pkt = serializePacket([encodeSimple(1)]);
    pkt[0] = 0x00;
    expect(() => deserializePacket(pkt)).toThrow(/header/);
  });
});

describe('empty message', () => {
  test('is exactly 8 bytes', () => {
    const msg = emptyMessage(0x4244, 0x1971);
    expect(msg.length).toBe(8);
  });

  test('can be packed and unpacked', () => {
    const msg = emptyMessage(0x4244, 0x1971);
    const pkt = serializePacket([msg]);
    const { messages } = deserializePacket(pkt);
    expect(messages.length).toBe(1);
    expect(messages[0]!.length).toBe(8);
  });
});

describe('CRC-16-CCITT known vectors', () => {
  test('empty input', () => {
    expect(crc16Ccitt(new Uint8Array())).toBe(0xffff);
  });

  test('"123456789"', () => {
    const input = new TextEncoder().encode('123456789');
    expect(crc16Ccitt(input)).toBe(0x29b1);
  });
});

describe('constants', () => {
  test('BLUEBERRY_PORT is 0x4242 (16962)', () => {
    expect(BLUEBERRY_PORT).toBe(0x4242);
    expect(BLUEBERRY_PORT).toBe(16962);
  });

  test('PACKET_MAGIC is {B, l, u, e}', () => {
    expect(Array.from(PACKET_MAGIC)).toEqual([0x42, 0x6c, 0x75, 0x65]);
  });
});
