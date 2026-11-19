/** Text lengths are counted in code points, on both sides. */
export const codePoints = (value: string): number => [...value].length;
