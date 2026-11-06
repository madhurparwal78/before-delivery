/** The listed value equal to `value`, typed as the list's own member; undefined when it is not listed. */
export function oneOf<T>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value);
}
