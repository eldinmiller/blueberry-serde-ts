/**
 * Marker types for optional ordinal-tracked fields.
 *
 * The Blueberry wire format supports trailing-optional fields via the
 * `max_ordinal` byte in the message header. A `T | null` annotation alone is
 * ambiguous; this alias documents that a `null` value is intentional and
 * means "field absent in this message" (rather than "field present with no
 * value").
 *
 * Generated code can use `OptionalOrdinal<T>` to mark trailing-optional
 * fields and emit `if (reader.hasField()) ...` guards around reads.
 */
export type OptionalOrdinal<T> = T | null;
