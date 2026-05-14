/**
 * Blueberry wire format reader.
 *
 * Mirrors `blueberry_serde::de::Deserializer` (Rust) and
 * `blueberry_serde.deserializer.Deserializer` (Python) byte-for-byte.
 *
 * Design notes:
 *   - Alignment, bool bit-packing, deferred-block dereferencing, and
 *     forward-compatibility skip-to-end are all mirrors of the writer's
 *     decisions on the wire side.
 *   - `setPayloadFieldCount(n)` is used together with `hasField(ordinal)` to
 *     support trailing `Option<T>` / "newer schema" fields that the message
 *     may not carry.
 */

export class BlueberryReader {
  private readonly view: DataView;
  private pos = 0;
  private boolBitPos = 0;
  private boolByte: number | null = null;
  private inSeqData = false;
  private messageByteLen: number | null = null;
  private messageStart = 0;
  private payloadFieldCount: number | null = null;
  /** Number of top-level fields already consumed via `fieldDelta()`. */
  private fieldIndex = 0;
  /**
   * While iterating a sequence element (`inSeqData = true`), tracks the
   * highest absolute byte offset consumed by any string / nested-sequence
   * deferred block dereferenced during the element's read callback. The
   * sequence walker advances `dataPos` past this value so the next element
   * starts after the prior element's inline + deferred bytes (which the
   * writer interleaves per element).
   */
  private blockTailPos = 0;

  constructor(
    private readonly data: Uint8Array,
    opts?: {
      pos?: number;
      messageStart?: number;
      messageByteLen?: number;
      inSeqData?: boolean;
    },
  ) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (opts?.pos !== undefined) this.pos = opts.pos;
    if (opts?.messageStart !== undefined) this.messageStart = opts.messageStart;
    if (opts?.messageByteLen !== undefined) this.messageByteLen = opts.messageByteLen;
    if (opts?.inSeqData) this.inSeqData = true;
  }

  /**
   * Construct a reader positioned just after a message header.
   *
   * @param data the full message buffer (header + body + deferred blocks)
   * @param bodyStart byte offset where the body begins (after the 8-byte header)
   * @param messageByteLen total message size in bytes (`header.length * 4`)
   */
  static withMessageContext(
    data: Uint8Array,
    bodyStart: number,
    messageByteLen: number,
  ): BlueberryReader {
    return new BlueberryReader(data, {
      pos: bodyStart,
      messageStart: 0,
      messageByteLen,
    });
  }

  /**
   * Tell the reader how many top-level payload fields the message actually
   * carries (derived from `max_ordinal` in the header). Used together with
   * `hasField()` for trailing-optional decode.
   */
  setPayloadFieldCount(count: number): void {
    this.payloadFieldCount = count;
  }

  /**
   * Whether a field with the given 1-based payload ordinal is present in
   * the message, according to the header's `max_ordinal`.
   *
   * If `payloadFieldCount` is unset (e.g. body-only decode without a header),
   * falls back to "are there any bytes left?" — mirroring the Rust deserializer.
   */
  hasField(ordinal: number): boolean {
    if (this.payloadFieldCount !== null) {
      return ordinal <= this.payloadFieldCount;
    }
    return this.pos < this.bodyEnd();
  }

  /**
   * Mark the end of a top-level payload field. Maintained for symmetry with
   * the writer; generators that use explicit ordinals on `hasField()` do not
   * need to call this.
   */
  fieldDelta(): void {
    this.fieldIndex += 1;
  }

  /** Skip to the end of the current message (for forward-compat). */
  skipToMessageEnd(): void {
    if (this.messageByteLen !== null) {
      const end = this.messageStart + this.messageByteLen;
      if (this.pos < end) this.pos = end;
    }
  }

  /** Current read position (mostly for tests). */
  get position(): number {
    return this.pos;
  }

  private bodyEnd(): number {
    if (this.messageByteLen !== null) {
      return this.messageStart + this.messageByteLen;
    }
    return this.data.length;
  }

  // ---- Alignment + bool packing helpers ---------------------------------

  private readPadding(size: number): void {
    if (this.inSeqData || size <= 1) return;
    const align = size >= 8 ? 4 : size;
    const rem = this.pos % align;
    if (rem !== 0) this.pos += align - rem;
  }

  private flushBools(): void {
    this.boolBitPos = 0;
    this.boolByte = null;
  }

  private checkRemaining(n: number): void {
    if (this.pos + n > this.data.length) {
      throw new RangeError(
        `BlueberryReader: unexpected EOF at pos=${this.pos} (need ${n} bytes, have ${this.data.length - this.pos})`,
      );
    }
  }

  // ---- Primitive readers ------------------------------------------------

  readU8(): number {
    this.flushBools();
    this.readPadding(1);
    this.checkRemaining(1);
    const v = this.data[this.pos] as number;
    this.pos += 1;
    return v;
  }

  readI8(): number {
    const v = this.readU8();
    return v >= 128 ? v - 256 : v;
  }

  readU16(): number {
    this.flushBools();
    this.readPadding(2);
    this.checkRemaining(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readI16(): number {
    this.flushBools();
    this.readPadding(2);
    this.checkRemaining(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readU32(): number {
    this.flushBools();
    this.readPadding(4);
    this.checkRemaining(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readI32(): number {
    this.flushBools();
    this.readPadding(4);
    this.checkRemaining(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readU64(): bigint {
    this.flushBools();
    this.readPadding(8);
    this.checkRemaining(8);
    const v = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    return v;
  }

  readI64(): bigint {
    this.flushBools();
    this.readPadding(8);
    this.checkRemaining(8);
    const v = this.view.getBigInt64(this.pos, true);
    this.pos += 8;
    return v;
  }

  readF32(): number {
    this.flushBools();
    this.readPadding(4);
    this.checkRemaining(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readF64(): number {
    this.flushBools();
    this.readPadding(8);
    this.checkRemaining(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  readBool(): boolean {
    if (this.boolByte !== null) {
      const v = ((this.boolByte >> this.boolBitPos) & 1) !== 0;
      this.boolBitPos += 1;
      if (this.boolBitPos >= 8) {
        this.boolBitPos = 0;
        this.boolByte = null;
      }
      return v;
    }
    this.readPadding(1);
    this.checkRemaining(1);
    const byte = this.data[this.pos] as number;
    this.pos += 1;
    const v = (byte & 1) !== 0;
    this.boolBitPos = 1;
    this.boolByte = byte;
    return v;
  }

  // ---- Strings -----------------------------------------------------------

  readString(): string {
    this.flushBools();
    this.readPadding(2);
    this.checkRemaining(2);
    const index = this.view.getUint16(this.pos, true);
    this.pos += 2;

    if (index === 0) return '';

    const dataStart = this.messageStart + index;
    if (dataStart + 4 > this.data.length) {
      throw new RangeError(
        `BlueberryReader: string index ${index} out of bounds (data length ${this.data.length})`,
      );
    }
    const count = this.view.getUint32(dataStart, true);
    const bytesStart = dataStart + 4;
    const bytesEnd = bytesStart + count;
    if (bytesEnd > this.data.length) {
      throw new RangeError(
        `BlueberryReader: string body out of bounds (need ${bytesEnd}, have ${this.data.length})`,
      );
    }
    if (this.inSeqData) {
      const paddedEnd = (bytesEnd + 3) & ~3;
      if (paddedEnd > this.blockTailPos) this.blockTailPos = paddedEnd;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(
      this.data.subarray(bytesStart, bytesEnd),
    );
  }

  // ---- Sequences ---------------------------------------------------------

  /**
   * Begin reading a sequence. Returns the element count and a function to
   * read each element. The reader's position advances past the inline header;
   * elements are read from the deferred data block.
   */
  beginSequence(): SequenceReader {
    this.flushBools();
    this.readPadding(2);
    this.checkRemaining(4);
    const index = this.view.getUint16(this.pos, true);
    const _elemByteLen = this.view.getUint16(this.pos + 2, true);
    this.pos += 4;

    if (index === 0 && _elemByteLen === 0) {
      return new SequenceReader(this, 0, this.data.byteOffset, 0);
    }

    const dataStart = this.messageStart + index;
    if (dataStart + 4 > this.data.length) {
      throw new RangeError(
        `BlueberryReader: sequence index ${index} out of bounds (data length ${this.data.length})`,
      );
    }
    const count = this.view.getUint32(dataStart, true);
    const elementsStart = dataStart + 4;
    if (this.inSeqData) {
      const blockEnd = elementsStart + count * _elemByteLen;
      const paddedEnd = (blockEnd + 3) & ~3;
      if (paddedEnd > this.blockTailPos) this.blockTailPos = paddedEnd;
    }
    return new SequenceReader(this, count, elementsStart, _elemByteLen);
  }

  /**
   * @internal Save/restore plumbing for `SequenceReader.readElement`.
   *
   * `dataBlockStart` is the absolute offset of the sequence's elements region
   * (the byte after the sequence's `u32 count`). The sub-writer that
   * serialized each element patched its inline string / sequence indices
   * relative to that base, so we rebase `messageStart` here for the duration
   * of the element read.
   */
  _saveAndEnterDataBlock(
    dataPos: number,
    dataBlockStart: number,
  ): {
    savedPos: number;
    savedInSeqData: boolean;
    savedMessageStart: number;
    savedBlockTailPos: number;
  } {
    const savedPos = this.pos;
    const savedInSeqData = this.inSeqData;
    const savedMessageStart = this.messageStart;
    const savedBlockTailPos = this.blockTailPos;
    this.pos = dataPos;
    this.inSeqData = true;
    this.messageStart = dataBlockStart;
    this.blockTailPos = dataPos;
    this.flushBools();
    return { savedPos, savedInSeqData, savedMessageStart, savedBlockTailPos };
  }

  /** @internal Restore reader state after `SequenceReader.readElement`. */
  _restoreFromDataBlock(saved: {
    savedPos: number;
    savedInSeqData: boolean;
    savedMessageStart: number;
    savedBlockTailPos: number;
  }): number {
    const dataPosAfter = this.pos > this.blockTailPos ? this.pos : this.blockTailPos;
    this.pos = saved.savedPos;
    this.inSeqData = saved.savedInSeqData;
    this.messageStart = saved.savedMessageStart;
    this.blockTailPos = saved.savedBlockTailPos;
    return dataPosAfter;
  }
}

/**
 * Iterates a Blueberry sequence's deferred data block.
 */
export class SequenceReader {
  private dataPos: number;
  private readonly elementsStart: number;

  constructor(
    private readonly parent: BlueberryReader,
    readonly count: number,
    elementsStart: number,
    readonly elementByteLength: number,
  ) {
    this.dataPos = elementsStart;
    this.elementsStart = elementsStart;
  }

  /**
   * Read one element. The `read` callback uses the parent reader but with
   * `inSeqData = true` (no alignment padding) and positioned in the data block.
   */
  readElement<T>(read: (r: BlueberryReader) => T): T {
    const saved = this.parent._saveAndEnterDataBlock(this.dataPos, this.elementsStart);
    const value = read(this.parent);
    this.dataPos = this.parent._restoreFromDataBlock(saved);
    return value;
  }
}
