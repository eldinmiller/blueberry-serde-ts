/**
 * Wire-format constants for the Blueberry binary protocol.
 *
 * Mirrors `blueberry-serde::packet` (Rust) and `blueberry_serde.constants` (Python).
 */

/** Size of a message header in bytes (2 × 32-bit words). */
export const HEADER_SIZE = 8;

/**
 * Number of distinct fields packed into the 8-byte message header.
 *
 * Word 0 = `module_message_key`; word 1 = `length | max_ordinal | tbd`.
 * Used by older Python tooling for cross-checks; included here for parity.
 */
export const HEADER_FIELD_COUNT = 3;

/** Size of a packet header in bytes (2 × 32-bit words). */
export const PACKET_HEADER_SIZE = 8;

/** Magic start word for Blueberry packets: `{'B', 'l', 'u', 'e'}`. */
export const PACKET_MAGIC: Uint8Array = new Uint8Array([0x42, 0x6c, 0x75, 0x65]);

/** Default Blueberry protocol port: 16962 (`0x4242`, `{'B', 'B'}`). */
export const BLUEBERRY_PORT = 0x4242;
