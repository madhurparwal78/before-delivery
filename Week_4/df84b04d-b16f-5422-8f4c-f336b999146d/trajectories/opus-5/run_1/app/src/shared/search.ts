/** Query reading and matching, the one decision used by search and by the live filter. */

export interface SearchTerm {
  kind: 'word' | 'phrase' | 'tag' | 'mention' | 'complete' | 'date';
  value: string;
  negated: boolean;
}

/** What a bullet offers to the match: its original's content. */
export interface Searchable {
  text: string;
  tags: readonly string[];
  mentions: readonly string[];
  completed: boolean;
  date: string | null;
}

function splitTerms(query: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const character of query) {
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (!quoted && /\s/.test(character)) {
      if (current !== '') parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current !== '') parts.push(current);
  return parts;
}

export function parseQuery(query: string): SearchTerm[] {
  const terms: SearchTerm[] = [];
  for (const raw of splitTerms(query)) {
    let body = raw;
    let negated = false;
    if (body.startsWith('-') && body.length > 1) {
      negated = true;
      body = body.slice(1);
    }
    if (body.startsWith('"')) {
      const phrase = body.replace(/^"/, '').replace(/"$/, '');
      if (phrase !== '') terms.push({ kind: 'phrase', value: phrase.toLowerCase(), negated });
      continue;
    }
    const lower = body.toLowerCase();
    if (lower === 'is:complete') {
      terms.push({ kind: 'complete', value: '', negated });
      continue;
    }
    if (lower === 'has:date') {
      terms.push({ kind: 'date', value: '', negated });
      continue;
    }
    if (body.length > 1 && body.startsWith('#')) {
      terms.push({ kind: 'tag', value: lower.slice(1), negated });
      continue;
    }
    if (body.length > 1 && body.startsWith('@')) {
      terms.push({ kind: 'mention', value: lower.slice(1), negated });
      continue;
    }
    if (lower !== '') terms.push({ kind: 'word', value: lower, negated });
  }
  return terms;
}

function termHolds(term: SearchTerm, bullet: Searchable): boolean {
  const text = bullet.text.toLowerCase();
  switch (term.kind) {
    case 'word':
    case 'phrase':
      return text.includes(term.value);
    case 'tag':
      return bullet.tags.includes(term.value);
    case 'mention':
      return bullet.mentions.includes(term.value);
    case 'complete':
      return bullet.completed;
    case 'date':
      return bullet.date !== null;
  }
}

/** Terms combine with AND; a minus term excludes. */
export function matches(terms: readonly SearchTerm[], bullet: Searchable): boolean {
  for (const term of terms) {
    const holds = termHolds(term, bullet);
    if (term.negated ? holds : !holds) return false;
  }
  return true;
}
