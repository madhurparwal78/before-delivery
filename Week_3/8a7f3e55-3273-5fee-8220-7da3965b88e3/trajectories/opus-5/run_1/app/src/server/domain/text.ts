/** Every text length in Relayline is a count of Unicode code points, inclusive at the limit. */
export function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

export function cutToCodePoints(value: string, limit: number): string {
  const points: string[] = [];
  for (const point of value) {
    if (points.length === limit) break;
    points.push(point);
  }
  return points.join('');
}
