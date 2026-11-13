const hiddenRanges: [number, number][] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x2028, 0x2029],
  [0x200b, 0x200b],
  [0x2060, 0x2060],
  [0xfeff, 0xfeff],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

export interface TextShape {
  /** Multi-line fields allow U+000A inside the text but never as its final character. */
  allowNewlines?: boolean;
}

export function hasHiddenCharacters(value: string, shape: TextShape = {}): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x0a && shape.allowNewlines === true) {
      if (index === value.length - 1) return true;
      continue;
    }
    for (const [from, to] of hiddenRanges) {
      if (code >= from && code <= to) return true;
    }
  }
  return false;
}

export function normaliseText(value: string): string {
  return value.normalize('NFC');
}

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

export function graphemeLength(value: string): number {
  let count = 0;
  for (const _segment of segmenter.segment(value)) count += 1;
  return count;
}

const emailPattern = /^[^\s@"'(),:;<>[\\\]]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function isValidEmail(value: string): boolean {
  return emailPattern.test(value);
}
