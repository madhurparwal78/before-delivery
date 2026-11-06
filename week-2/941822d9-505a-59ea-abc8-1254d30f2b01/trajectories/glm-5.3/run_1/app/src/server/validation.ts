import { notFound } from "./errors.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids are opaque UUIDs; anything else reads as an unknown id. */
export const uuidOr404 = (raw: string): string => {
  if (!UUID_PATTERN.test(raw)) throw notFound();
  return raw;
};
