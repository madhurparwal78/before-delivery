/** A name split before each capital letter and each digit run, in sentence case. */
export function sentenceCaseLabel(name: string): string {
  const words: string[] = [];
  let current = '';
  let previousWasDigit = false;
  for (const character of name) {
    const isDigit = character >= '0' && character <= '9';
    const isUpper = character >= 'A' && character <= 'Z';
    const boundary = isUpper || (isDigit && !previousWasDigit) || (!isDigit && previousWasDigit);
    if (boundary && current.length > 0) {
      words.push(current);
      current = '';
    }
    current += character;
    previousWasDigit = isDigit;
  }
  if (current.length > 0) words.push(current);
  const lowered = words.map((word) => word.toLowerCase()).join(' ');
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}
