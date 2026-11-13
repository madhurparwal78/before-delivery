import { HOLLOWAY_120 } from './words.js';
import { quoteGroup, type Quote, type QuoteLength } from './quotes.js';

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ticketSeed(textSeed: number, sequence: number): number {
  return (textSeed + sequence) % 2 ** 32;
}

export interface GeneratorOptions {
  readonly punctuation: boolean;
  readonly numbers: boolean;
}

export function generateWords(seed: number, count: number, options: GeneratorOptions): string[] {
  const random = mulberry32(seed);
  const words: string[] = [];
  let previousDrawn = '';
  for (let i = 0; i < count; i += 1) {
    let drawn = HOLLOWAY_120[Math.floor(random() * 120)] as string;
    while (drawn === previousDrawn) {
      drawn = HOLLOWAY_120[Math.floor(random() * 120)] as string;
    }
    previousDrawn = drawn;
    let word = drawn;
    if (options.numbers && random() < 0.15) {
      word = String(Math.floor(random() * 1000));
    }
    if (options.punctuation) {
      const y = random();
      if (y < 0.1) word += ',';
      else if (y < 0.2) word += '.';
      const previous = words[i - 1];
      if (i === 0 || (previous !== undefined && previous.endsWith('.'))) {
        word = word.charAt(0).toUpperCase() + word.slice(1);
      }
    }
    words.push(word);
  }
  return words;
}

export function pickQuote(seed: number, length: QuoteLength): Quote {
  const random = mulberry32(seed);
  const group = quoteGroup(length);
  const quote = group[Math.floor(random() * group.length)];
  if (!quote) throw new Error('empty quote group');
  return quote;
}

export function quoteWords(text: string): string[] {
  return text.split(' ');
}
