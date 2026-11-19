/** The ISO date of any DATE column, whether pg parsed it or not. */
export function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

// pg is imported dynamically so the type parser is installed before the pool is built.
export async function configureTypes(): Promise<void> {
  const pgmod = (await import("pg")) as unknown as { default: { types: { setTypeParser: (oid: number, fn: (v: string) => string) => void } } };
  pgmod.default.types.setTypeParser(1082, (v) => v);
}
