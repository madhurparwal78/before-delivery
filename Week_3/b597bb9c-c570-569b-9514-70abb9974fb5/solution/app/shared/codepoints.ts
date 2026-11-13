/** Unicode code points in a string (a flag of two regional indicators counts 2). */
export function codePoints(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}
