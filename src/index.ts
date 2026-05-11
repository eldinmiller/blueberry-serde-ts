/**
 * Public surface of `blueberry-serde-ts`.
 *
 * This module re-exports every symbol intended for consumers of the runtime,
 * including generated TypeScript code emitted by `blueberry-compiler`.
 */

export {
  BLUEBERRY_PORT,
  HEADER_FIELD_COUNT,
  HEADER_SIZE,
  PACKET_HEADER_SIZE,
  PACKET_MAGIC,
} from './constants.js';

export { crc16Ccitt } from './crc.js';

export { MessageHeader, PacketHeader } from './header.js';

export { BlueberryReader, SequenceReader } from './reader.js';

export { BlueberryWriter, SequenceWriter } from './writer.js';

export {
  type Decoder,
  type Encoder,
  deserialize,
  deserializeMessage,
  deserializePacket,
  emptyMessage,
  serialize,
  serializeMessage,
  serializePacket,
} from './codec.js';

export type { OptionalOrdinal } from './types.js';
