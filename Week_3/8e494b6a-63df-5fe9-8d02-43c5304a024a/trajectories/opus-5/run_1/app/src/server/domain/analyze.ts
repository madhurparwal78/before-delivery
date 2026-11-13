export type AnalyzerName = 'standard' | 'keyword' | 'whitespace';

export type Token = { token: string; position: number; start: number; end: number };

const STOPWORDS = new Set(
  'a an and are as at be but by for from in is it of on or that the to was with'.split(' '),
);

const SUFFIXES: [string, string][] = [
  ['ies', 'y'],
  ['ing', ''],
  ['ed', ''],
  ['es', ''],
  ['s', ''],
];

/** The suffix table of rule D: the first row that leaves at least 3 characters applies. */
export function applySuffixTable(token: string): string {
  for (const [suffix, replacement] of SUFFIXES) {
    if (token.length > suffix.length && token.endsWith(suffix)) {
      const stem = token.slice(0, token.length - suffix.length) + replacement;
      if (stem.length >= 3) return stem;
    }
  }
  return token;
}

function isWordCharacter(char: string): boolean {
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9');
}

export function analyze(analyzer: AnalyzerName, text: string): Token[] {
  if (analyzer === 'keyword') {
    return [{ token: text, position: 0, start: 0, end: text.length }];
  }
  if (analyzer === 'whitespace') {
    const tokens: Token[] = [];
    let position = 0;
    let start = -1;
    for (let index = 0; index <= text.length; index += 1) {
      const char = index < text.length ? text[index] : ' ';
      const isSpace = /\s/.test(char);
      if (!isSpace && start < 0) start = index;
      if (isSpace && start >= 0) {
        tokens.push({ token: text.slice(start, index), position, start, end: index });
        position += 1;
        start = -1;
      }
    }
    return tokens;
  }
  const tokens: Token[] = [];
  let position = 0;
  let start = -1;
  for (let index = 0; index <= text.length; index += 1) {
    const inWord = index < text.length && isWordCharacter(text[index]);
    if (inWord && start < 0) start = index;
    if (!inWord && start >= 0) {
      const run = text.slice(start, index).toLowerCase();
      const slot = position;
      position += 1;
      if (!STOPWORDS.has(run)) {
        tokens.push({ token: applySuffixTable(run), position: slot, start, end: index });
      }
      start = -1;
    }
  }
  return tokens;
}
