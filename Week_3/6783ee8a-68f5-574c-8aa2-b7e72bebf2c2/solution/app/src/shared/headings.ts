import { Lexer } from "marked";
import type { Token, Tokens } from "marked";

interface Heading {
  depth: number;
  text: string;
}

function plain(tokens: Token[] | undefined, fallback: string): string {
  if (!tokens) return fallback;
  return tokens
    .map((token) => {
      const inner = (token as { tokens?: Token[] }).tokens;
      if (inner) return plain(inner, token.raw);
      return "text" in token && typeof token.text === "string" ? token.text : token.raw;
    })
    .join("");
}

function collect(tokens: Token[], found: Heading[]): void {
  for (const token of tokens) {
    if (token.type === "heading") {
      const heading = token as Tokens.Heading;
      found.push({ depth: heading.depth, text: plain(heading.tokens, heading.text).trim() });
    } else if (token.type === "blockquote") {
      collect((token as Tokens.Blockquote).tokens, found);
    } else if (token.type === "list") {
      for (const item of (token as Tokens.List).items) collect(item.tokens, found);
    }
  }
}

/** Every heading of a markdown source in document order; headings inside code blocks are not headings. */
export function markdownHeadings(source: string): Heading[] {
  const found: Heading[] = [];
  collect(new Lexer().lex(source), found);
  return found;
}
