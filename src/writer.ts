/**
 * Blueberry wire format writer.
 *
 * Mirrors `blueberry_serde::ser::Serializer` (Rust) and
 * `blueberry_serde.serializer.Serializer` (Python) byte-for-byte.
 *
 * Design notes:
 *   - The buffer must be in memory (not a streaming writer) because sequence
 *     and string data blocks are deferred to the end of the body, and their
 *     inline 2-byte index fields are fixed up during `finalize()`.
 *   - Alignment rules: size 1 = no pad; size 2 = align 2; size 4 = align 4;
 *     size 8 = align 4 (not 8). Inside sequence data blocks, no padding.
 *   - Consecutive booleans bit-pack into shared bytes (LSb to MSb). Any
 *     non-bool primitive flushes the current bool byte.
 *   - `setBaseOffset(HEADER_SIZE)` should be set before serializing a message
 *     body so deferred-block indices are message-relative (i.e. point past
 *     the header into the body+blocks region).
 */

interface SeqFixup {
  /** Offset in `buf` where the 2-byte `index` placeholder lives. */
  headerOffset: number;
  /** Index into `seqDataBlocks`. */
  blockIdx: number;
}

/**
 * Internal helper: a growable byte buffer with DataView access.
 */
class GrowBuf {
  bytes: Uint8Array;
  view: DataView;
  len = 0;

  constructor(initialCapacity = 64) {
    this.bytes = new Uint8Array(initialCapacity);
    this.view = new DataView(this.bytes.buffer);
  }

  private grow(min: number): void {
    let cap = this.bytes.length || 1;
    while (cap < min) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.bytes.subarray(0, this.len));
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  ensure(n: number): void {
    if (this.len + n > this.bytes.length) this.grow(this.len + n);
  }

  pushByte(v: number): void {
    this.ensure(1);
    this.bytes[this.len] = v & 0xff;
    this.len++;
  }

  extendZero(n: number): void {
    this.ensure(n);
    // Uint8Array is zero-initialized on allocation, but for the case where
    // we've grown but not yet zeroed, do an explicit fill of the affected slice.
    this.bytes.fill(0, this.len, this.len + n);
    this.len += n;
  }

  /** Return a tightly-sized `Uint8Array` view of the accumulated bytes. */
  finish(): Uint8Array {
    return this.bytes.slice(0, this.len);
  }
}

/**
 * Writer used by generated `encode` callbacks and hand-written codecs.
 *
 * Usage from generated code:
 *
 *     return serializeMessage(fields, MODULE_KEY, MESSAGE_KEY, (w, f) => {
 *       w.writeU64(f.a); w.fieldDelta();
 *       w.writeF32(f.b); w.fieldDelta();
 *     });
 *
 * `fieldDelta()` tracks the top-level payload field count, which the codec
 * encodes as `max_ordinal` in the message header.
 */
export class BlueberryWriter {
  private buf = new GrowBuf();
  private pos = 0;
  private boolBitPos = 0;
  private boolByteOffset: number | null = null;
  private inSeqData = false;
  private fieldCount = 0;
  private baseOffset = 0;
  private seqDataBlocks: Uint8Array[] = [];
  private seqFixups: SeqFixup[] = [];

  constructor(opts?: { inSeqData?: boolean; initialBytes?: Uint8Array }) {
    if (opts?.inSeqData) this.inSeqData = true;
    if (opts?.initialBytes && opts.initialBytes.length > 0) {
      this.buf.extendZero(opts.initialBytes.length);
      this.buf.bytes.set(opts.initialBytes, 0);
      this.pos = opts.initialBytes.length;
    }
  }

  /**
   * Set the offset that will be added to all deferred-block indices in
   * `finalize()`. Use `HEADER_SIZE` when the body will be prefixed by a
   * message header.
   */
  setBaseOffset(offset: number): void {
    this.baseOffset = offset;
  }

  /**
   * Mark the end of a top-level payload field.
   *
   * Generated encoders call this after each field's write calls so the codec
   * can derive `max_ordinal` for the message header.
   */
  fieldDelta(): void {
    this.fieldCount += 1;
  }

  /** Number of top-level payload fields written so far. */
  getFieldCount(): number {
    return this.fieldCount;
  }

  /**
   * Finalize the body: flush bool packing, pad to a 4-byte word, append all
   * deferred sequence/string blocks, and fix up the inline index placeholders.
   */
  finalize(): Uint8Array {
    this.flushBools();

    if (this.seqDataBlocks.length > 0) {
      const bodyPadded = (this.buf.len + 3) & ~3;
      if (this.buf.len < bodyPadded) {
        this.buf.extendZero(bodyPadded - this.buf.len);
        this.pos = bodyPadded;
      }
    }

    const bodyLen = this.buf.len;
    let dataOffset = this.baseOffset + bodyLen;

    for (const { headerOffset, blockIdx } of this.seqFixups) {
      const block = this.seqDataBlocks[blockIdx]!;
      // Patch the 2-byte index into the existing body bytes.
      this.buf.view.setUint16(headerOffset, dataOffset & 0xffff, true);
      dataOffset += block.length;
    }

    // Total length includes all data blocks.
    let totalLen = bodyLen;
    for (const block of this.seqDataBlocks) totalLen += block.length;
    this.buf.ensure(totalLen - bodyLen);
    for (const block of this.seqDataBlocks) {
      this.buf.bytes.set(block, this.buf.len);
      this.buf.len += block.length;
    }
    return this.buf.finish();
  }

  // ---- Alignment + bool packing helpers ---------------------------------

  private writePadding(size: number): void {
    if (this.inSeqData || size <= 1) return;
    const align = size >= 8 ? 4 : size;
    const rem = this.pos % align;
    if (rem !== 0) {
      const pad = align - rem;
      this.buf.extendZero(pad);
      this.pos += pad;
    }
  }

  private flushBools(): void {
    this.boolBitPos = 0;
    this.boolByteOffset = null;
  }

  // ---- Primitive writers -------------------------------------------------

  writeU8(v: number): void {
    this.flushBools();
    this.writePadding(1);
    this.buf.pushByte(v);
    this.pos += 1;
  }

  writeI8(v: number): void {
    this.writeU8(v & 0xff);
  }

  writeU16(v: number): void {
    this.flushBools();
    this.writePadding(2);
    this.buf.ensure(2);
    this.buf.view.setUint16(this.buf.len, v & 0xffff, true);
    this.buf.len += 2;
    this.pos += 2;
  }

  writeI16(v: number): void {
    this.flushBools();
    this.writePadding(2);
    this.buf.ensure(2);
    this.buf.view.setInt16(this.buf.len, v | 0, true);
    this.buf.len += 2;
    this.pos += 2;
  }

  writeU32(v: number): void {
    this.flushBools();
    this.writePadding(4);
    this.buf.ensure(4);
    this.buf.view.setUint32(this.buf.len, v >>> 0, true);
    this.buf.len += 4;
    this.pos += 4;
  }

  writeI32(v: number): void {
    this.flushBools();
    this.writePadding(4);
    this.buf.ensure(4);
    this.buf.view.setInt32(this.buf.len, v | 0, true);
    this.buf.len += 4;
    this.pos += 4;
  }

  writeU64(v: bigint): void {
    this.flushBools();
    this.writePadding(8);
    this.buf.ensure(8);
    this.buf.view.setBigUint64(this.buf.len, BigInt.asUintN(64, v), true);
    this.buf.len += 8;
    this.pos += 8;
  }

  writeI64(v: bigint): void {
    this.flushBools();
    this.writePadding(8);
    this.buf.ensure(8);
    this.buf.view.setBigInt64(this.buf.len, BigInt.asIntN(64, v), true);
    this.buf.len += 8;
    this.pos += 8;
  }

  writeF32(v: number): void {
    this.flushBools();
    this.writePadding(4);
    this.buf.ensure(4);
    this.buf.view.setFloat32(this.buf.len, v, true);
    this.buf.len += 4;
    this.pos += 4;
  }

  writeF64(v: number): void {
    this.flushBools();
    this.writePadding(8);
    this.buf.ensure(8);
    this.buf.view.setFloat64(this.buf.len, v, true);
    this.buf.len += 8;
    this.pos += 8;
  }

  writeBool(v: boolean): void {
    if (this.boolByteOffset !== null) {
      if (v) {
        this.buf.bytes[this.boolByteOffset] |= 1 << this.boolBitPos;
      }
      this.boolBitPos += 1;
      if (this.boolBitPos >= 8) {
        this.boolBitPos = 0;
        this.boolByteOffset = null;
      }
    } else {
      this.writePadding(1);
      const offset = this.buf.len;
      this.buf.pushByte(v ? 1 : 0);
      this.pos += 1;
      this.boolBitPos = 1;
      this.boolByteOffset = offset;
    }
  }

  // ---- Strings -----------------------------------------------------------

  writeString(v: string): void {
    this.flushBools();
    const utf8 = new TextEncoder().encode(v);

    // 2-byte inline placeholder (the index gets patched at finalize()).
    this.writePadding(2);
    const headerOffset = this.buf.len;
    this.buf.extendZero(2);
    this.pos += 2;

    // Build the data block: u32 length + UTF-8 bytes, padded to word boundary.
    const blockLen = 4 + utf8.length;
    const paddedLen = (blockLen + 3) & ~3;
    const block = new Uint8Array(paddedLen);
    new DataView(block.buffer).setUint32(0, utf8.length, true);
    block.set(utf8, 4);

    const blockIdx = this.seqDataBlocks.length;
    this.seqDataBlocks.push(block);
    this.seqFixups.push({ headerOffset, blockIdx });
  }

  // ---- Sequences ---------------------------------------------------------

  /**
   * Begin writing a sequence. The returned `SequenceWriter` lets you write
   * one element at a time. Call `end()` when done.
   *
   * The 4-byte inline header (u16 index + u16 elementByteLength) is reserved
   * inline; the data block (u32 count + elements) is deferred and gets a
   * word-aligned index assigned at finalize().
   */
  beginSequence(): SequenceWriter {
    this.flushBools();
    this.writePadding(2);
    const headerOffset = this.buf.len;
    this.buf.extendZero(4);
    this.pos += 4;

    const blockIdx = this.seqDataBlocks.length;
    this.seqDataBlocks.push(new Uint8Array(0));
    this.seqFixups.push({ headerOffset, blockIdx });

    return new SequenceWriter(this, headerOffset, blockIdx);
  }

  /** @internal Replace the deferred sequence data block for `blockIdx`. */
  _setSeqBlock(blockIdx: number, bytes: Uint8Array): void {
    this.seqDataBlocks[blockIdx] = bytes;
  }

  /** @internal Patch the 2-byte `elementByteLength` of the inline header. */
  _setSeqElementByteLength(headerOffset: number, elementByteLength: number): void {
    this.buf.view.setUint16(headerOffset + 2, elementByteLength & 0xffff, true);
  }

  /** @internal Create a sub-writer for serializing into a sequence data block. */
  _newSeqElementWriter(initialBytes: Uint8Array): BlueberryWriter {
    return new BlueberryWriter({ inSeqData: true, initialBytes });
  }
}

/**
 * Sub-writer for serializing into a sequence's deferred data block.
 *
 * The data block layout is `u32 count + elements`, but `count` is prepended
 * inside `end()`, and elements are written without alignment padding (the
 * sub-writer has `inSeqData = true`).
 */
export class SequenceWriter {
  private elementCount = 0;
  private firstElementSize: number | null = null;
  private elementsBuf: Uint8Array;

  constructor(
    private readonly parent: BlueberryWriter,
    private readonly headerOffset: number,
    private readonly blockIdx: number,
  ) {
    this.elementsBuf = new Uint8Array(0);
  }

  /**
   * Write one element. The `write` callback uses a fresh sub-writer that
   * operates inside the sequence data block (no alignment padding).
   */
  writeElement(write: (w: BlueberryWriter) => void): void {
    const sub = this.parent._newSeqElementWriter(this.elementsBuf);
    const before = this.elementsBuf.length;
    write(sub);
    this.elementsBuf = sub.finalize();
    const elemSize = this.elementsBuf.length - before;
    if (this.firstElementSize === null) {
      this.firstElementSize = elemSize;
    }
    this.elementCount += 1;
  }

  /** Finalize the sequence. Call when all elements have been written. */
  end(): void {
    // Prepend u32 count to the elements buffer, then pad to 4-byte word.
    const blockLen = 4 + this.elementsBuf.length;
    const paddedLen = (blockLen + 3) & ~3;
    const block = new Uint8Array(paddedLen);
    new DataView(block.buffer).setUint32(0, this.elementCount >>> 0, true);
    block.set(this.elementsBuf, 4);

    this.parent._setSeqBlock(this.blockIdx, block);
    this.parent._setSeqElementByteLength(this.headerOffset, this.firstElementSize ?? 0);
  }
}
