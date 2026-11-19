/**
 * The Lozenge formula language: lexer with 1-based line and column positions.
 */

export type TokenType =
  | "number"
  | "text"
  | "boolean"
  | "null"
  | "field"
  | "parameter"
  | "function"
  | "keyword"
  | "lparen"
  | "rparen"
  | "comma"
  | "colon"
  | "lbrace"
  | "rbrace"
  | "op"
  | "unknown"
  | "end";

export interface Token {
  type: TokenType;
  text: string;
  line: number;
  column: number;
  upper: string;
}

const KEYWORDS = new Set(["AND", "OR", "NOT"]);
const OPERATORS = ["<>", "<=", ">=", "=", "<", ">", "+", "-", "*", "/", "%", "&"];

export function lexFormula(source: string): {
  tokens: Token[];
  error: { message: string; line: number; column: number } | null;
} {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  const push = (type: TokenType, text: string, startLine: number, startCol: number): void => {
    tokens.push({ type, text, line: startLine, column: startCol, upper: text.toUpperCase() });
  };

  while (i < n) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      col++;
      continue;
    }
    if (ch === "\n") {
      i++;
      line++;
      col = 1;
      continue;
    }
    const startLine = line;
    const startCol = col;

    if (ch === "[" && source[i + 1] === "@") {
      let j = i + 2;
      while (j < n && source[j] !== "]" && source[j] !== "\n") j++;
      if (j >= n || source[j] !== "]") {
        return {
          tokens,
          error: {
            message: `Line ${startLine}, column ${startCol}: formula ended early.`,
            line: startLine,
            column: startCol,
          },
        };
      }
      const name = source.slice(i + 2, j);
      push("parameter", name, startLine, startCol);
      i = j + 1;
      col = startCol + 2 + name.length + 1;
      continue;
    }
    if (ch === "[") {
      let j = i + 1;
      while (j < n && source[j] !== "]" && source[j] !== "\n") j++;
      if (j >= n || source[j] !== "]") {
        return {
          tokens,
          error: {
            message: `Line ${startLine}, column ${startCol}: formula ended early.`,
            line: startLine,
            column: startCol,
          },
        };
      }
      const name = source.slice(i + 1, j);
      push("field", name, startLine, startCol);
      i = j + 1;
      col = startCol + 1 + name.length + 1;
      continue;
    }
    if (ch === "(") {
      push("lparen", "(", startLine, startCol);
      i++;
      col++;
      continue;
    }
    if (ch === ")") {
      push("rparen", ")", startLine, startCol);
      i++;
      col++;
      continue;
    }
    if (ch === ",") {
      push("comma", ",", startLine, startCol);
      i++;
      col++;
      continue;
    }
    if (ch === ":") {
      push("colon", ":", startLine, startCol);
      i++;
      col++;
      continue;
    }
    if (ch === "{") {
      push("lbrace", "{", startLine, startCol);
      i++;
      col++;
      continue;
    }
    if (ch === "}") {
      push("rbrace", "}", startLine, startCol);
      i++;
      col++;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let text = "";
      let terminated = false;
      while (j < n) {
        if (source[j] === "'") {
          if (source[j + 1] === "'") {
            text += "'";
            j += 2;
            continue;
          }
          terminated = true;
          break;
        }
        if (source[j] === "\n") break;
        text += source[j];
        j++;
      }
      if (!terminated) {
        return {
          tokens,
          error: {
            message: `Line ${startLine}, column ${startCol}: formula ended early.`,
            line: startLine,
            column: startCol,
          },
        };
      }
      push("text", text, startLine, startCol);
      i = j + 1;
      col = startCol + text.length + 2;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9]/.test(source[j])) j++;
      if (source[j] === ".") {
        j++;
        while (j < n && /[0-9]/.test(source[j])) j++;
      }
      push("number", source.slice(i, j), startLine, startCol);
      col = startCol + (j - i);
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++;
      const word = source.slice(i, j);
      const upper = word.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") push("boolean", upper, startLine, startCol);
      else if (upper === "NULL") push("null", "NULL", startLine, startCol);
      else if (KEYWORDS.has(upper)) push("keyword", upper, startLine, startCol);
      else push("unknown", word, startLine, startCol);
      col = startCol + (j - i);
      i = j;
      continue;
    }
    const two = source.slice(i, i + 2);
    const op = OPERATORS.find((o) => two.startsWith(o));
    if (op) {
      push("op", op, startLine, startCol);
      i += op.length;
      col = startCol + op.length;
      continue;
    }
    return {
      tokens,
      error: {
        message: `Line ${startLine}, column ${startCol}: unexpected "${ch}".`,
        line: startLine,
        column: startCol,
      },
    };
  }

  tokens.push({ type: "end", text: "", line, column: col, upper: "" });
  return { tokens, error: null };
}
