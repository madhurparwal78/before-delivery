/** Every text limit in the brief, counted in Unicode code points and inclusive at the limit. */
export const TEXT_LIMITS = {
  title: 120,
  location: 200,
  onsite_contact_name: 80,
  consumer_name: 80,
  requester_notes: 1000,
  search: 80,
  display_name: 120,
} as const;

/** Length in Unicode code points, counted as submitted. */
export const textLength = (text: string): number => [...text].length;

/** Whether `text` is within `min`..`max` code points; a minimum of 1 also refuses whitespace-only text. */
export function textWithin(text: unknown, min: number, max: number): text is string {
  if (typeof text !== "string") return false;
  const length = textLength(text);
  if (length > max || length < min) return false;
  return min < 1 || text.trim().length > 0;
}
