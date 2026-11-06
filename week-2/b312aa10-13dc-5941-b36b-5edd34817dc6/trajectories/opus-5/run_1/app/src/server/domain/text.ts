/** Text normalisation, counting and the refused business-name characters. */

export function normalise(text: string): string {
  return text.normalize('NFC');
}

export function codePointLength(text: string): number {
  return [...text].length;
}

const refusedInBusinessName = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

export function businessNameIsValid(text: string): boolean {
  const length = codePointLength(text);
  return length >= 1 && length <= 80 && !refusedInBusinessName.test(text);
}

export function withinLength(text: string, min: number, max: number): boolean {
  const length = codePointLength(text);
  return length >= min && length <= max;
}
