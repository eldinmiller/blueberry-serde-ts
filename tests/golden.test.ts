/**
 * Golden byte vectors matching the Rust `blueberry-serde` test suite plus a
 * hand-anchored WhosThere fixture loaded from `tests/fixtures/`.
 *
 * Ported from `blueberry-serde-python/tests/test_golden.py`.
 *
 * The `SENSOR_READING_PACKET` and `DEVICE_STATUS_PACKET` vectors are byte-for-
 * byte identical to the Rust runtime's `tests/packets.rs` golden outputs and
 * are the strongest cross-language wire-format anchor.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  PACKET_HEADER_SIZE,
  PacketHeader,
  crc16Ccitt,
  deserializeMessage,
  deserializePacket,
  serializeMessage,
  serializePacket,
} from '../src/index.js';

// ---- Models -----------------------------------------------------------

interface SensorReading {
  sensorId: number;
  temperature: number;
  humidity: number;
  alertHigh: boolean;
  alertLow: boolean;
}

function encodeSensorReading(value: SensorReading): Uint8Array {
  return serializeMessage<SensorReading>(value, 0x01, 0x42, (w, f) => {
    w.writeU32(f.sensorId);
    w.fieldDelta();
    w.writeF32(f.temperature);
    w.fieldDelta();
    w.writeU16(f.humidity);
    w.fieldDelta();
    w.writeBool(f.alertHigh);
    w.fieldDelta();
    w.writeBool(f.alertLow);
    w.fieldDelta();
  });
}

function decodeSensorReading(bytes: Uint8Array) {
  return deserializeMessage<SensorReading>(bytes, (r) => ({
    sensorId: r.readU32(),
    temperature: r.readF32(),
    humidity: r.readU16(),
    alertHigh: r.readBool(),
    alertLow: r.readBool(),
  }));
}

interface DeviceStatus {
  deviceId: number;
  name: string;
  readings: number[];
  online: boolean;
  calibrated: boolean;
}

function encodeDeviceStatus(value: DeviceStatus): Uint8Array {
  return serializeMessage<DeviceStatus>(value, 0x01, 0x42, (w, f) => {
    w.writeU32(f.deviceId);
    w.fieldDelta();
    w.writeString(f.name);
    w.fieldDelta();
    const seq = w.beginSequence();
    for (const v of f.readings) {
      seq.writeElement((sw) => sw.writeU16(v));
    }
    seq.end();
    w.fieldDelta();
    w.writeBool(f.online);
    w.fieldDelta();
    w.writeBool(f.calibrated);
    w.fieldDelta();
  });
}

function decodeDeviceStatus(bytes: Uint8Array) {
  return deserializeMessage<DeviceStatus>(bytes, (r) => {
    const deviceId = r.readU32();
    const name = r.readString();
    const seq = r.beginSequence();
    const readings: number[] = [];
    for (let i = 0; i < seq.count; i++) {
      readings.push(seq.readElement((sr) => sr.readU16()));
    }
    const online = r.readBool();
    const calibrated = r.readBool();
    return { deviceId, name, readings, online, calibrated };
  });
}

// ---- Golden byte vectors (verbatim from Rust/Python) -------------------

// prettier-ignore
const SENSOR_READING_PACKET = new Uint8Array([
  0x42, 0x6c, 0x75, 0x65, 0x07, 0x00, 0xff, 0x9b,
  0x42, 0x00, 0x01, 0x00, 0x05, 0x00, 0x07, 0x00,
  0x2a, 0x00, 0x00, 0x00, 0x00, 0x00, 0xbc, 0x41,
  0x41, 0x00, 0x01, 0x00,
]);

// prettier-ignore
const DEVICE_STATUS_PACKET = new Uint8Array([
  0x42, 0x6c, 0x75, 0x65, 0x0e, 0x00, 0x72, 0xf4,
  0x42, 0x00, 0x01, 0x00, 0x0c, 0x00, 0x07, 0x00,
  0x64, 0x00, 0x00, 0x00, 0x14, 0x00, 0x24, 0x00,
  0x02, 0x00, 0x01, 0x00, 0x0c, 0x00, 0x00, 0x00,
  0x73, 0x65, 0x6e, 0x73, 0x6f, 0x72, 0x2d, 0x61,
  0x6c, 0x70, 0x68, 0x61, 0x03, 0x00, 0x00, 0x00,
  0xff, 0x03, 0xff, 0x07, 0xff, 0x0f, 0x00, 0x00,
]);

function bytesToArray(b: Uint8Array): number[] {
  return Array.from(b);
}

// ---- Tests -------------------------------------------------------------

describe('SensorReading golden', () => {
  test('serialize matches Rust byte vector', () => {
    const reading: SensorReading = {
      sensorId: 42,
      temperature: 23.5,
      humidity: 65,
      alertHigh: true,
      alertLow: false,
    };
    const msg = encodeSensorReading(reading);
    const pkt = serializePacket([msg]);
    expect(bytesToArray(pkt)).toEqual(bytesToArray(SENSOR_READING_PACKET));
  });

  test('roundtrip', () => {
    const { messages } = deserializePacket(SENSOR_READING_PACKET);
    expect(messages.length).toBe(1);
    const { fields } = decodeSensorReading(messages[0]!);
    expect(fields).toEqual({
      sensorId: 42,
      temperature: 23.5,
      humidity: 65,
      alertHigh: true,
      alertLow: false,
    });
  });

  test('embedded CRC matches recompute', () => {
    const payload = SENSOR_READING_PACKET.subarray(PACKET_HEADER_SIZE);
    const expectedCrc = new DataView(
      SENSOR_READING_PACKET.buffer,
      SENSOR_READING_PACKET.byteOffset + 6,
      2,
    ).getUint16(0, true);
    expect(crc16Ccitt(payload)).toBe(expectedCrc);
  });
});

describe('DeviceStatus golden (strings + sequences)', () => {
  test('serialize matches Rust byte vector', () => {
    const device: DeviceStatus = {
      deviceId: 100,
      name: 'sensor-alpha',
      readings: [1023, 2047, 4095],
      online: true,
      calibrated: false,
    };
    const msg = encodeDeviceStatus(device);
    const pkt = serializePacket([msg]);
    expect(bytesToArray(pkt)).toEqual(bytesToArray(DEVICE_STATUS_PACKET));
  });

  test('roundtrip', () => {
    const { messages } = deserializePacket(DEVICE_STATUS_PACKET);
    expect(messages.length).toBe(1);
    const { fields } = decodeDeviceStatus(messages[0]!);
    expect(fields).toEqual({
      deviceId: 100,
      name: 'sensor-alpha',
      readings: [1023, 2047, 4095],
      online: true,
      calibrated: false,
    });
  });

  test('embedded CRC matches recompute', () => {
    const payload = DEVICE_STATUS_PACKET.subarray(PACKET_HEADER_SIZE);
    const expectedCrc = new DataView(
      DEVICE_STATUS_PACKET.buffer,
      DEVICE_STATUS_PACKET.byteOffset + 6,
      2,
    ).getUint16(0, true);
    expect(crc16Ccitt(payload)).toBe(expectedCrc);
  });
});

// ---- WhosThere fixture (firmware-anchored) -----------------------------

function parseHexFixture(text: string): Uint8Array {
  const cleaned = text
    .split('\n')
    .map((line) => line.split('#')[0]!)
    .join(' ');
  const tokens = cleaned.match(/[0-9a-fA-F]{2}/g) ?? [];
  return new Uint8Array(tokens.map((t) => parseInt(t, 16)));
}

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/whos_there_reply.hex',
);

interface WhosThereFields {
  serialNumber: bigint;
  firmwareBuild: number;
  hardwareType: number;
  protocolMajor: number;
  protocolMinor: number;
  calibrated: boolean;
  bootComplete: boolean;
}

function decodeWhosThere(bytes: Uint8Array) {
  return deserializeMessage<WhosThereFields>(bytes, (r) => ({
    serialNumber: r.readU64(),
    firmwareBuild: r.readU32(),
    hardwareType: r.readU16(),
    protocolMajor: r.readU8(),
    protocolMinor: r.readU8(),
    calibrated: r.readBool(),
    bootComplete: r.readBool(),
  }));
}

describe('WhosThere firmware fixture', () => {
  test('decodes to expected fields after CRC fixup', () => {
    const raw = parseHexFixture(readFileSync(FIXTURE_PATH, 'utf-8'));
    // The fixture commits a zero CRC placeholder; patch the live CRC so
    // future firmware captures can replace these bytes verbatim without
    // changing the test's wire-format expectations.
    const messageData = raw.subarray(PACKET_HEADER_SIZE);
    const crc = crc16Ccitt(messageData);
    const patched = new Uint8Array(raw);
    new DataView(patched.buffer).setUint16(6, crc, true);

    // Magic + length round-trip through PacketHeader.
    const pkt = PacketHeader.decode(patched);
    expect(pkt).not.toBeNull();
    expect(pkt!.lengthWords).toBe(9);

    const { header, messages } = deserializePacket(patched);
    expect(header.lengthWords).toBe(9);
    expect(messages.length).toBe(1);

    const { header: msgHeader, fields } = decodeWhosThere(messages[0]!);
    expect(msgHeader.moduleKey).toBe(0x4244);
    expect(msgHeader.messageKey).toBe(0x1971);
    expect(msgHeader.length).toBe(7);
    expect(msgHeader.maxOrdinal).toBe(9);

    expect(fields).toEqual({
      serialNumber: 0x0102030405060708n,
      firmwareBuild: 0x00100001,
      hardwareType: 0x0002,
      protocolMajor: 0x02,
      protocolMinor: 0x01,
      calibrated: true,
      bootComplete: true,
    });
  });
});
