/**
 * Message and packet header encoding/decoding.
 *
 * Wire layouts mirror `blueberry-serde::header::MessageHeader` and
 * `blueberry-serde::packet::PacketHeader` byte-for-byte.
 */

import { HEADER_SIZE, PACKET_HEADER_SIZE, PACKET_MAGIC } from './constants.js';

/**
 * 8-byte message header.
 *
 * Wire layout (little-endian):
 * - Bytes 0..4: `uint32 module_message_key` (high u16 = module_key, low u16 = message_key)
 * - Bytes 4..6: `uint16 length` (total message length in 4-byte words, including header)
 * - Byte  6:    `uint8  max_ordinal` (highest top-level field ordinal present)
 * - Byte  7:    `uint8  tbd` (reserved, set to 0)
 */
export class MessageHeader {
  constructor(
    public moduleKey: number,
    public messageKey: number,
    public length: number,
    public maxOrdinal: number,
    public tbd: number = 0,
  ) {}

  /** Encode the header into a fresh 8-byte `Uint8Array`. */
  encode(): Uint8Array {
    const buf = new Uint8Array(HEADER_SIZE);
    this.encodeInto(buf, 0);
    return buf;
  }

  /** Encode the header into the first 8 bytes starting at `offset`. */
  encodeInto(buf: Uint8Array, offset = 0): void {
    if (buf.length < offset + HEADER_SIZE) {
      throw new RangeError(`MessageHeader: buffer too small (need ${HEADER_SIZE} bytes)`);
    }
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const moduleMessageKey = (((this.moduleKey & 0xffff) << 16) >>> 0) | (this.messageKey & 0xffff);
    view.setUint32(offset, moduleMessageKey >>> 0, true);
    view.setUint16(offset + 4, this.length & 0xffff, true);
    view.setUint8(offset + 6, this.maxOrdinal & 0xff);
    view.setUint8(offset + 7, this.tbd & 0xff);
  }

  /**
   * Decode a header from the first 8 bytes of `buf`.
   *
   * Returns `null` if `buf` is too short.
   */
  static decode(buf: Uint8Array, offset = 0): MessageHeader | null {
    if (buf.length < offset + HEADER_SIZE) return null;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const moduleMessageKey = view.getUint32(offset, true);
    const moduleKey = (moduleMessageKey >>> 16) & 0xffff;
    const messageKey = moduleMessageKey & 0xffff;
    const length = view.getUint16(offset + 4, true);
    const maxOrdinal = view.getUint8(offset + 6);
    const tbd = view.getUint8(offset + 7);
    return new MessageHeader(moduleKey, messageKey, length, maxOrdinal, tbd);
  }

  /** Combined 32-bit identifier `(moduleKey << 16) | messageKey`. */
  get moduleMessageKey(): number {
    return ((((this.moduleKey & 0xffff) << 16) >>> 0) | (this.messageKey & 0xffff)) >>> 0;
  }

  /** Total message length in bytes (length-words × 4). */
  get byteLength(): number {
    return this.length * 4;
  }
}

/**
 * 8-byte packet header.
 *
 * Wire layout (little-endian):
 * - Bytes 0..4: Magic `{'B','l','u','e'}` = `{0x42, 0x6c, 0x75, 0x65}`
 * - Bytes 4..6: `uint16 length_words` (total packet length in 4-byte words, including header)
 * - Bytes 6..8: `uint16 crc` (CRC-16-CCITT over the message data after the header)
 */
export class PacketHeader {
  constructor(
    public lengthWords: number,
    public crc: number,
  ) {}

  encode(): Uint8Array {
    const buf = new Uint8Array(PACKET_HEADER_SIZE);
    this.encodeInto(buf, 0);
    return buf;
  }

  encodeInto(buf: Uint8Array, offset = 0): void {
    if (buf.length < offset + PACKET_HEADER_SIZE) {
      throw new RangeError(`PacketHeader: buffer too small (need ${PACKET_HEADER_SIZE} bytes)`);
    }
    buf.set(PACKET_MAGIC, offset);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    view.setUint16(offset + 4, this.lengthWords & 0xffff, true);
    view.setUint16(offset + 6, this.crc & 0xffff, true);
  }

  /**
   * Decode a packet header. Returns `null` if too short or magic mismatch.
   */
  static decode(buf: Uint8Array, offset = 0): PacketHeader | null {
    if (buf.length < offset + PACKET_HEADER_SIZE) return null;
    for (let i = 0; i < PACKET_MAGIC.length; i++) {
      if (buf[offset + i] !== PACKET_MAGIC[i]) return null;
    }
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const lengthWords = view.getUint16(offset + 4, true);
    const crc = view.getUint16(offset + 6, true);
    return new PacketHeader(lengthWords, crc);
  }
}
