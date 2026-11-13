/** `name` if free, else `<name> (k)` with the lowest free k from 2: the Merge renaming rule. */
export function freeName(name: string, isTaken: (candidate: string) => boolean): string {
  if (!isTaken(name)) return name;
  let k = 2;
  while (isTaken(`${name} (${k})`)) k += 1;
  return `${name} (${k})`;
}

/** Layer `0` always exists and can't be deleted or renamed. */
export const ZERO_LAYER = '0';
