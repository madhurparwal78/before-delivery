// Instants leave the API as ISO 8601 UTC with a Z suffix.
export function isoUtc(at: Date | number): string {
  return new Date(at).toISOString().replace(".000Z", "Z");
}

export const isoOrNull = (at: Date | null) => (at === null ? null : isoUtc(at));
