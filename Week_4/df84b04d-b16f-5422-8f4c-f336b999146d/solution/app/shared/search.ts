export interface SearchTerm {
  kind: "word" | "tag" | "mention" | "complete" | "date";
  value: string;
  negated: boolean;
}

interface SearchFacts {
  text: string;
  tags: readonly string[];
  mentions: readonly string[];
  completed: boolean;
  hasDate: boolean;
}

const TOKEN = /-?"[^"]*"|\S+/g;

function termOf(raw: string): SearchTerm | null {
  if (raw === "-") return null;
  const negated = raw.length > 1 && raw.startsWith("-");
  const body = negated ? raw.slice(1) : raw;
  const lowered = body.toLowerCase();
  if (body.length >= 2 && body.startsWith('"') && body.endsWith('"')) {
    const phrase = lowered.slice(1, -1);
    return phrase === "" ? null : { kind: "word", value: phrase, negated };
  }
  if (lowered === "is:complete") return { kind: "complete", value: "", negated };
  if (lowered === "has:date") return { kind: "date", value: "", negated };
  if (lowered.startsWith("#") && lowered.length > 1) return { kind: "tag", value: lowered.slice(1), negated };
  if (lowered.startsWith("@") && lowered.length > 1) return { kind: "mention", value: lowered.slice(1), negated };
  return { kind: "word", value: lowered, negated };
}

/** The one place a search query is understood. */
export function parseQuery(query: string): SearchTerm[] {
  const terms: SearchTerm[] = [];
  for (const token of query.match(TOKEN) ?? []) {
    const term = termOf(token);
    if (term !== null) terms.push(term);
  }
  return terms;
}

function hit(term: SearchTerm, facts: SearchFacts): boolean {
  switch (term.kind) {
    case "word": return facts.text.toLowerCase().includes(term.value);
    case "tag": return facts.tags.includes(term.value);
    case "mention": return facts.mentions.includes(term.value);
    case "complete": return facts.completed;
    case "date": return facts.hasDate;
  }
}

export function matchesQuery(terms: readonly SearchTerm[], facts: SearchFacts): boolean {
  return terms.length > 0 && terms.every((term) => hit(term, facts) !== term.negated);
}
