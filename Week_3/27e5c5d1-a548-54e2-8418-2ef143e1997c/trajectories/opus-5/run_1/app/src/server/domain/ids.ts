const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Ids are opaque strings; anything that cannot be one of ours matches nothing. */
export function isWellFormedId(value: string): boolean {
  return ID_PATTERN.test(value);
}
