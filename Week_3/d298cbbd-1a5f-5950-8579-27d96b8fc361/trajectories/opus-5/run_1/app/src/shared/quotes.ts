export type QuoteGroup = 'short' | 'medium' | 'long';
export type QuoteLength = QuoteGroup | 'all';
export type QuoteId = 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6';

export interface Quote {
  readonly id: QuoteId;
  readonly group: QuoteGroup;
  readonly text: string;
  readonly source: string;
}

export const QUOTES: readonly Quote[] = [
  {
    id: 'q1',
    group: 'short',
    text: 'Brevity is the soul of wit.',
    source: 'William Shakespeare, Hamlet (1603)',
  },
  {
    id: 'q2',
    group: 'short',
    text: 'Beware; for I am fearless, and therefore powerful.',
    source: 'Mary Shelley, Frankenstein (1818)',
  },
  {
    id: 'q3',
    group: 'medium',
    text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
    source: 'Jane Austen, Pride and Prejudice (1813)',
  },
  {
    id: 'q4',
    group: 'medium',
    text: 'I went to the woods because I wished to live deliberately, to front only the essential facts of life.',
    source: 'Henry David Thoreau, Walden (1854)',
  },
  {
    id: 'q5',
    group: 'long',
    text: 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.',
    source: 'Charles Dickens, A Tale of Two Cities (1859)',
  },
  {
    id: 'q6',
    group: 'long',
    text: "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it.",
    source: 'Lewis Carroll, Alice\'s Adventures in Wonderland (1865)',
  },
];

export function quoteGroup(length: QuoteLength): readonly Quote[] {
  return length === 'all' ? QUOTES : QUOTES.filter((quote) => quote.group === length);
}

export function quoteById(id: QuoteId): Quote {
  const quote = QUOTES.find((candidate) => candidate.id === id);
  if (!quote) throw new Error(`unknown quote ${id}`);
  return quote;
}
