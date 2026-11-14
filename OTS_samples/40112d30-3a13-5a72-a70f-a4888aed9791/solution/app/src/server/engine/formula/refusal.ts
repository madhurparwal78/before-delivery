/** A save-time refusal of a formula or insertion; the message is the exact published sentence. */
export class Refusal extends Error {}

export function atColumn(column: number, message: string): string {
  return `Column ${column}: ${message}`;
}
