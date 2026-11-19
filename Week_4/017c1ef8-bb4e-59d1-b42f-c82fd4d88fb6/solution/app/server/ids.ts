import { randomInt } from 'node:crypto';

// Record ids keep the UUID v4 layout, drawn from decimal digits only (about 100 random bits),
// so an address such as /posts/<id> reads the same way in every log and report line.
const digits = (n: number): string => Array.from({ length: n }, () => randomInt(10)).join('');

export const newId = (): string =>
  `${digits(8)}-${digits(4)}-4${digits(3)}-${8 + randomInt(2)}${digits(3)}-${digits(12)}`;
