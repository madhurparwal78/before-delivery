/** Revision lettering: A, B, C on, skipping I and O in every position. */

const REVISION_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function revisionLetter(seq: number): string {
  let remaining = seq;
  let letters = '';
  while (remaining > 0) {
    const index = (remaining - 1) % REVISION_LETTERS.length;
    letters = `${REVISION_LETTERS[index]}${letters}`;
    remaining = Math.floor((remaining - 1) / REVISION_LETTERS.length);
  }
  return letters;
}
