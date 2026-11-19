export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function folioNameForIndex(index: number): string {
  return `Folio ${LETTERS[index]}`;
}

export function folioLetter(name: string): string {
  return name.replace('Folio ', '');
}
