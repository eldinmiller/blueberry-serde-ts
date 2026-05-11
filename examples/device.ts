/**
 * Communicate with a real Blueberry device over UDP on `BLUEBERRY_PORT`.
 *
 * Sends empty-message requests for `IdMessage`, `VersionMessage`, and
 * `WhosThereMessage` and prints the decoded responses.
 *
 * Pass the target IP as the first argument; defaults to broadcast on the
 * local link if not provided.
 *
 *     npx tsx examples/device.ts 192.168.2.2
 */

import { createSocket } from 'node:dgram';

import {
  BLUEBERRY_PORT,
  PACKET_HEADER_SIZE,
  PacketHeader,
  type Decoder,
  deserializeMessage,
  deserializePacket,
  emptyMessage,
  serializePacket,
} from '../src/index.js';

const ID_MODULE = 0x4244;
const ID_MESSAGE = 0x0001;
const VERSION_MODULE = 0x4244;
const VERSION_MESSAGE = 0x0100;
const WHOSTHERE_MODULE = 0x4244;
const WHOSTHERE_MESSAGE = 0x1971;
const REPLY_TIMEOUT_MS = 1500;

interface IdFields {
  id: number;
}
const decodeId: Decoder<IdFields> = (r) => ({ id: r.readU32() });

const HW_TYPE: Record<number, string> = {
  0: 'SFDQ',
  1: 'BLUE_SERVO',
  2: 'LUMEN',
  3: 'NUCLEO',
  4: 'BLUE_ESC',
  5: 'GIGABOARD',
  6: 'BLUE_BRIDGE',
  65535: 'UNDEFINED',
};

const MCU_TYPE: Record<number, string> = {
  1: 'STM32F446',
  2: 'STM32H563',
  3: 'STM32H573',
  4: 'STM32G071',
  255: 'UNDEFINED',
};

interface VersionFields {
  firmwareVersion: number;
  hardwareRev: number;
  mcuType: number;
  hardwareType: number;
}
const decodeVersion: Decoder<VersionFields> = (r) => ({
  firmwareVersion: r.readU32(),
  hardwareRev: r.readU8(),
  mcuType: r.readU8(),
  hardwareType: r.readU16(),
});

function formatVersion(v: VersionFields): string {
  const hw = HW_TYPE[v.hardwareType] ?? `UNKNOWN(${v.hardwareType})`;
  const mcu = MCU_TYPE[v.mcuType] ?? `UNKNOWN(${v.mcuType})`;
  return [
    `Firmware: ${v.firmwareVersion} (0x${v.firmwareVersion.toString(16).toUpperCase().padStart(8, '0')})`,
    `HW Rev:   ${v.hardwareRev}`,
    `HW Type:  ${hw}`,
    `MCU Type: ${mcu}`,
  ].join('\n  ');
}

async function sendAndAwait(
  socket: ReturnType<typeof createSocket>,
  target: string,
  packet: Uint8Array,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeAllListeners('message');
      reject(new Error(`Timed out waiting for reply from ${target}`));
    }, REPLY_TIMEOUT_MS);

    socket.once('message', (msg) => {
      clearTimeout(timer);
      resolve(new Uint8Array(msg));
    });

    socket.send(packet, BLUEBERRY_PORT, target, (error) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

async function request<T>(
  socket: ReturnType<typeof createSocket>,
  target: string,
  moduleKey: number,
  messageKey: number,
  decoder: Decoder<T>,
): Promise<T | null> {
  const empty = emptyMessage(moduleKey, messageKey);
  const packet = serializePacket([empty]);
  try {
    const reply = await sendAndAwait(socket, target, packet);
    const { messages } = deserializePacket(reply);
    if (messages.length === 0) return null;
    const matched = messages.find((m) => {
      const hdr = PacketHeader.decode(m.subarray(0, PACKET_HEADER_SIZE));
      // m is a message buffer (not a packet); decode the message header instead.
      return hdr === null;
    });
    // `matched` should always be null because per-message slices don't carry
    // a packet header; fall through and try to decode the first message.
    void matched;
    const { fields } = deserializeMessage(messages[0]!, decoder);
    return fields;
  } catch (error) {
    console.error(`  ${(error as Error).message}`);
    return null;
  }
}

async function main(): Promise<void> {
  const target = process.argv[2] ?? '255.255.255.255';
  console.log(`Querying ${target}:${BLUEBERRY_PORT}\n`);

  const socket = createSocket('udp4');
  socket.bind(undefined, undefined, () => {
    if (target.endsWith('.255')) socket.setBroadcast(true);
  });

  try {
    console.log('Requesting IdMessage:');
    const id = await request(socket, target, ID_MODULE, ID_MESSAGE, decodeId);
    if (id !== null) {
      console.log(`  Device ID: ${id.id} (0x${id.id.toString(16).toUpperCase().padStart(8, '0')})`);
    }

    console.log('\nRequesting VersionMessage:');
    const version = await request(socket, target, VERSION_MODULE, VERSION_MESSAGE, decodeVersion);
    if (version !== null) console.log(`  ${formatVersion(version)}`);

    console.log('\nRequesting WhosThereMessage:');
    const ws = await request(socket, target, WHOSTHERE_MODULE, WHOSTHERE_MESSAGE, (r) => ({
      raw: r.readU32(),
    }));
    if (ws !== null) console.log(`  Reply received (raw u32 prefix: 0x${ws.raw.toString(16)})`);
  } finally {
    socket.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
