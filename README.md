# blueberry-serde-ts

TypeScript implementation of the [Blueberry](https://github.com/bluerobotics/blueberry-compiler) binary wire format. Companion library to [`blueberry-serde`](https://github.com/patrickelectric/blueberry-serde) (Rust) and [`blueberry-serde-python`](https://github.com/patrickelectric/blueberry-serde-python) (Python).

## Wire format

- **Little-endian** byte order throughout.
- Packets and messages are multiples of 4-byte words.
- Body alignment: size 1 = no pad, size 2 = align 2, size 4 = align 4, **size 8 = align 4** (not 8). Inside sequence data blocks, no padding.
- Consecutive `bool` fields are bit-packed (LSb to MSb).
- Sequences use a 4-byte inline header (`u16 index + u16 elementByteLength`) pointing to a deferred `u32 count + elements` block appended after the message body.
- Strings use a 2-byte inline placeholder pointing to a deferred `u32 len + UTF-8 bytes` block.
- Trailing optional fields supported via `max_ordinal` in the message header — older decoders silently truncate; newer decoders return `null` for absent trailing fields.

## Packet layout

```
┌─────────────────────────────────────────────────┐
│ Packet Header (8 bytes)                         │
│   Bytes 0..4: Magic {'B','l','u','e'}           │
│   Bytes 4..6: Total length in 4-byte words (LE) │
│   Bytes 6..8: CRC-16-CCITT of message data (LE) │
├─────────────────────────────────────────────────┤
│ Message 1 (8-byte header + body, 4-byte aligned)│
├─────────────────────────────────────────────────┤
│ Message 2 ...                                   │
├─────────────────────────────────────────────────┤
│ Padding (if needed for 4-byte alignment)        │
└─────────────────────────────────────────────────┘
```

## Message header (8 bytes)

```
Word 0 (bytes 0..4): uint32 module_message_key (high u16 = module_key, low u16 = message_key)
Word 1 (bytes 4..6): uint16 length        (total words in this message, including header)
Word 1 (byte  6):    uint8  max_ordinal   (highest field ordinal present)
Word 1 (byte  7):    uint8  tbd           (reserved, set to 0)
```

## Protocol

Operates in request-response mode on UDP port `16962` (`0x4242`, `{'B', 'B'}`). One endpoint controls the bus and initiates requests; all other devices wait for requests before responding. An empty message (header only) requests a populated response of the same type from the target device.

## Installation

```sh
npm install github:eldinmiller/blueberry-serde-ts
```

Or pin to a tagged release:

```sh
npm install github:eldinmiller/blueberry-serde-ts#v0.1.0
```

## Usage

```typescript
import {
  BlueberryWriter,
  BlueberryReader,
  serializeMessage,
  deserializeMessage,
  serializePacket,
  deserializePacket,
  BLUEBERRY_PORT,
} from 'blueberry-serde-ts';

interface StatusFields {
  id: number;
  active: boolean;
}

const MODULE_KEY = 0x0666;
const MESSAGE_KEY = 0x47;

const bytes = serializeMessage<StatusFields>(
  { id: 42, active: true },
  MODULE_KEY,
  MESSAGE_KEY,
  (w, f) => {
    w.writeI32(f.id);
    w.writeBool(f.active);
  },
);

const { header, fields } = deserializeMessage<StatusFields>(bytes, (r) => ({
  id: r.readI32(),
  active: r.readBool(),
}));

console.log(header, fields);
```

For typical use, consumers will not write encoders/decoders by hand — they will be emitted by the [`blueberry-compiler` TypeScript target](https://github.com/bluerobotics/blueberry-compiler).

## Public API

| Symbol | Description |
|--------|-------------|
| `serialize<T>(fields, encoder)` | Serialize a body without a message header. |
| `deserialize<T>(bytes, decoder)` | Deserialize a body without a message header. |
| `serializeMessage<T>(fields, moduleKey, messageKey, encoder)` | Serialize a body with an 8-byte message header. |
| `deserializeMessage<T>(bytes, decoder)` | Parse a message header and decode the body. |
| `serializePacket(messages)` | Wrap one or more messages in a packet header (magic + length + CRC). |
| `deserializePacket(bytes)` | Validate magic + CRC and split into message slices. |
| `emptyMessage(moduleKey, messageKey)` | Header-only message for request-response. |
| `BlueberryWriter` | Alignment-aware encoder (used by generated code). |
| `BlueberryReader` | Alignment-aware decoder (used by generated code). |
| `MessageHeader`, `PacketHeader` | Header encode/decode primitives. |
| `crc16Ccitt(bytes)` | CRC-16-CCITT (init `0xFFFF`, poly `0x1021`). |
| `BLUEBERRY_PORT`, `PACKET_MAGIC`, `HEADER_SIZE`, `PACKET_HEADER_SIZE`, `HEADER_FIELD_COUNT` | Constants. |

## Development

```sh
npm install
npm run test         # vitest
npm run typecheck    # tsc --noEmit
npm run lint         # prettier --check
npm run build        # tsc → dist/
```

## License

MIT — see [LICENSE](./LICENSE).
