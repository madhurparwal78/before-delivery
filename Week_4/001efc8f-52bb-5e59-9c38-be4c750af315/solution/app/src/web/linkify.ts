// The message-text link rule (brief: Business rules, Message text display). Text is split into
// plain runs, http(s) links and line breaks; nothing else is ever produced.

type TextPiece = { kind: "text"; text: string } | { kind: "link"; href: string } | { kind: "break" };

const SCHEME = /https?:\/\//giy;
const RUN_END = /[\s<>"]/;
const TRAILING = new Set([".", ",", ";", ":", "!", "?"]);

function isLetterOrDigit(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

function trimRun(run: string): string {
  let end = run.length;
  for (;;) {
    const last = run[end - 1];
    if (last !== undefined && TRAILING.has(last)) {
      end -= 1;
      continue;
    }
    if (last === ")") {
      const body = run.slice(0, end);
      const opens = body.split("(").length - 1;
      const closes = body.split(")").length - 1;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    return run.slice(0, end);
  }
}

function linkLine(line: string, out: TextPiece[]): void {
  let plainFrom = 0;
  let index = 0;
  while (index < line.length) {
    SCHEME.lastIndex = index;
    const match = SCHEME.test(line) && !isLetterOrDigit(line[index - 1]);
    if (!match) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < line.length && !RUN_END.test(line[end] ?? "")) end += 1;
    const run = trimRun(line.slice(index, end));
    const rest = run.slice(run.indexOf("://") + 3);
    if (rest.length === 0) {
      index = end;
      continue;
    }
    if (index > plainFrom) out.push({ kind: "text", text: line.slice(plainFrom, index) });
    out.push({ kind: "link", href: run });
    index += run.length;
    plainFrom = index;
  }
  if (plainFrom < line.length) out.push({ kind: "text", text: line.slice(plainFrom) });
}

export function linkify(text: string): TextPiece[] {
  const out: TextPiece[] = [];
  text.split("\n").forEach((line, i) => {
    if (i > 0) out.push({ kind: "break" });
    linkLine(line, out);
  });
  return out;
}
