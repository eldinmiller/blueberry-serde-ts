/**
 * Top-level serialize/deserialize functions for the Blueberry wire format.
 *
 * Mirrors the public API of `blueberry-serde` (Rust) and `blueberry-serde-python`.
 */

import { HEADER_FIELD_COUNT, HEADER_SIZE, PACKET_HEADER_SIZE } from './constants.js';
import { crc16Ccitt } from './crc.js';
import { MessageHeader, PacketHeader } from './header.js';
import { BlueberryReader } from './reader.js';
import { BlueberryWriter } from './writer.js';

/** Callback shape used by encode helpers. */
export type Encoder<T> = (writer: BlueberryWriter, fields: T) => void;

/** Callback shape used by decode helpers. */
export type Decoder<T> = (reader: BlueberryReader) => T;

/**
 * Serialize a body without a message header.
 *
 * Use this for raw data serialization or for testing individual types.
 */
export function serialize<T>(fields: T, encoder: Encoder<T>): Uint8Array {
  const writer = new BlueberryWriter();
  encoder(writer, fields);
  return writer.finalize();
}

/**
 * Deserialize a body without a message header.
 */
export function deserialize<T>(bytes: Uint8Array, decoder: Decoder<T>): T {
  const reader = new BlueberryReader(bytes);
  return decoder(reader);
}

/**
 * Serialize a body with an 8-byte Blueberry message header.
 *
 * The header encodes `module_key`, `message_key`, total message length in
 * 4-byte words, `max_ordinal` (derived from the writer's field count), and
 * a reserved `tbd` byte.
 *
 * Deferred-block indices are made message-relative (i.e. include the
 * 8-byte header offset) so consumers can address the entire message with a
 * single buffer.
 */
export function serializeMessage<T>(
  fields: T,
  moduleKey: number,
  messageKey: number,
  encoder: Encoder<T>,
): Uint8Array {
  const writer = new BlueberryWriter();
  writer.setBaseOffset(HEADER_SIZE);
  encoder(writer, fields);
  const fieldCount = writer.getFieldCount();
  const body = writer.finalize();

  const totalBytes = HEADER_SIZE + body.length;
  const paddedBytes = (totalBytes + 3) & ~3;
  const lengthWords = paddedBytes >>> 2;

  // The header carries 3 conceptual fields (ord 0..2). Payload fields start
  // at ordinal 3; max_ordinal = 2 + field_count (clamped to u8).
  const baseOrdinal = HEADER_FIELD_COUNT - 1; // = 2
  const maxOrdinal = Math.min(255, fieldCount + baseOrdinal);

  const header = new MessageHeader(moduleKey, messageKey, lengthWords, maxOrdinal, 0);
  const result = new Uint8Array(paddedBytes);
  header.encodeInto(result, 0);
  result.set(body, HEADER_SIZE);
  return result;
}

/**
 * Parse the 8-byte message header and decode the body via `decoder`.
 *
 * Returns `{ header, fields }`. Throws if the buffer is too short or the
 * header is malformed.
 */
export function deserializeMessage<T>(
  bytes: Uint8Array,
  decoder: Decoder<T>,
): { header: MessageHeader; fields: T } {
  const header = MessageHeader.decode(bytes);
  if (header === null) {
    throw new Error('deserializeMessage: invalid or truncated message header');
  }
  const messageByteLen = header.length * 4;
  const baseOrdinal = HEADER_FIELD_COUNT - 1;
  const payloadFieldCount = Math.max(0, header.maxOrdinal - baseOrdinal);

  const reader = BlueberryReader.withMessageContext(bytes, HEADER_SIZE, messageByteLen);
  reader.setPayloadFieldCount(payloadFieldCount);
  const fields = decoder(reader);
  return { header, fields };
}

/**
 * Header-only message for request-response mode.
 *
 * A device receiving an empty message of a type it understands responds with
 * a populated message of the same type.
 */
export function emptyMessage(moduleKey: number, messageKey: number): Uint8Array {
  const lengthWords = HEADER_SIZE >>> 2;
  const baseOrdinal = HEADER_FIELD_COUNT - 1;
  const header = new MessageHeader(moduleKey, messageKey, lengthWords, baseOrdinal, 0);
  return header.encode();
}

/**
 * Pack one or more pre-serialized messages into a Blueberry packet.
 *
 * The packet is prefixed with an 8-byte header (magic, length-in-words, CRC).
 * The packet is padded to a multiple of 4 bytes; the CRC is computed over
 * all bytes after the packet header, including any trailing padding.
 */
export function serializePacket(messages: ReadonlyArray<Uint8Array>): Uint8Array {
  let messageDataLen = 0;
  for (const m of messages) messageDataLen += m.length;

  const totalBytes = PACKET_HEADER_SIZE + messageDataLen;
  const paddedBytes = (totalBytes + 3) & ~3;
  const lengthWords = paddedBytes >>> 2;

  const messageData = new Uint8Array(paddedBytes - PACKET_HEADER_SIZE);
  let offset = 0;
  for (const m of messages) {
    messageData.set(m, offset);
    offset += m.length;
  }
  // Trailing bytes already zeroed by Uint8Array allocation.

  const crc = crc16Ccitt(messageData);
  const pktHeader = new PacketHeader(lengthWords, crc);

  const result = new Uint8Array(paddedBytes);
  pktHeader.encodeInto(result, 0);
  result.set(messageData, PACKET_HEADER_SIZE);
  return result;
}

/**
 * Parse a Blueberry packet. Validates magic, length, and CRC, then splits
 * the body into per-message byte slices (each suitable for `deserializeMessage`).
 */
export function deserializePacket(bytes: Uint8Array): {
  header: PacketHeader;
  messages: Uint8Array[];
} {
  const pktHeader = PacketHeader.decode(bytes);
  if (pktHeader === null) {
    throw new Error('deserializePacket: invalid packet header (bad magic or too short)');
  }
  const totalBytes = pktHeader.lengthWords * 4;
  if (bytes.length < totalBytes) {
    throw new Error(
      `deserializePacket: unexpected EOF (need ${totalBytes} bytes, have ${bytes.length})`,
    );
  }

  const messageData = bytes.subarray(PACKET_HEADER_SIZE, totalBytes);
  const expectedCrc = crc16Ccitt(messageData);
  if (pktHeader.crc !== expectedCrc) {
    throw new Error(
      `deserializePacket: CRC mismatch (expected 0x${expectedCrc.toString(16)}, got 0x${pktHeader.crc.toString(16)})`,
    );
  }

  const messages: Uint8Array[] = [];
  let offset = PACKET_HEADER_SIZE;
  while (offset + HEADER_SIZE <= totalBytes) {
    const msgHeader = MessageHeader.decode(bytes, offset);
    if (msgHeader === null) {
      throw new Error(`deserializePacket: invalid message header at offset ${offset}`);
    }
    const msgByteLen = msgHeader.length * 4;
    if (msgByteLen < HEADER_SIZE) break;
    const msgEnd = offset + msgByteLen;
    if (msgEnd > totalBytes) {
      throw new Error(`deserializePacket: message at offset ${offset} extends past packet end`);
    }
    messages.push(bytes.subarray(offset, msgEnd));
    offset = msgEnd;
  }

  return { header: pktHeader, messages };
}
