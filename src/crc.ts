/**
 * CRC-16-CCITT (CCITT-FALSE variant).
 *
 * - Polynomial: `0x1021`
 * - Initial value: `0xFFFF`
 * - No input/output bit reflection
 * - No final XOR
 *
 * Byte-identical to `blueberry_serde::packet::crc16_ccitt` (Rust) and the
 * CRC implementation in `blueberry_transcode_firmware`.
 *
 * @example
 *   crc16Ccitt(new TextEncoder().encode('123456789')) === 0x29B1
 */
export function crc16Ccitt(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] as number) << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc & 0xffff;
}
