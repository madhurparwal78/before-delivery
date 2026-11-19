/** Times in answers are UTC text with second precision. */
export function formatTime(value: Date): string {
  return `${value.toISOString().slice(0, 19)}Z`;
}
