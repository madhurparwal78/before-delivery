// Revision lettering: A, B, C … Z, then AA, AB …, skipping I and O in every position (brief: Drawing register).

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** The revision letter for the n-th upload of a sheet, counting from 0. */
export function revisionLetter(ordinal: number): string {
  let n = ordinal;
  let letters = "";
  do {
    letters = LETTERS[n % LETTERS.length] + letters;
    n = Math.floor(n / LETTERS.length) - 1;
  } while (n >= 0);
  return letters;
}
