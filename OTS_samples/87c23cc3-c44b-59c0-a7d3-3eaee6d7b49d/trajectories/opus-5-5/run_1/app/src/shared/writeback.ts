import { printEntityLines, printGroup, printLinkLine, printName } from "./canonical.js";
import type { Group, Model, Ref } from "./model.js";
import type { ParseResult } from "./mortise.js";

export interface TextLine {
  content: string;
  eol: "" | "\n" | "\r\n";
}

export function splitLines(text: string): TextLine[] {
  if (text === "") return [];
  const parts = text.split("\n");
  const lines: TextLine[] = [];
  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    if (last && part === "") return;
    if (last) lines.push({ content: part, eol: "" });
    else if (part.endsWith("\r")) lines.push({ content: part.slice(0, -1), eol: "\r\n" });
    else lines.push({ content: part, eol: "\n" });
  });
  return lines;
}

export function joinLines(lines: TextLine[]): string {
  return lines.map((l) => l.content + l.eol).join("");
}

/** The line ending of the last line that has one, or LF. */
function trailingEol(lines: TextLine[]): "\n" | "\r\n" {
  for (let i = lines.length - 1; i >= 0; i--) {
    const eol = lines[i]!.eol;
    if (eol) return eol;
  }
  return "\n";
}

export interface LinkInsertion {
  text: string;
  line: string;
  lineNumber: number;
}

/** Inserts a many-to-one link line after the owning entity's block and the link lines right after it. */
export function insertLinkLine(text: string, parse: ParseResult, from: Ref, to: Ref): LinkInsertion {
  const owner = parse.model.entities.find((e) => e.name === from.entity)!;
  let after = owner.endLine;
  while (parse.linkLines.has(after + 1)) after++;
  const line = printLinkLine({ from, token: ">-", to, action: null });
  const lines = splitLines(text);
  const previous = lines[after - 1]!;
  if (previous.eol === "") {
    previous.eol = trailingEol(lines);
    lines.splice(after, 0, { content: line, eol: "" });
  } else {
    lines.splice(after, 0, { content: line, eol: previous.eol });
  }
  return { text: joinLines(lines), line, lineNumber: after + 1 };
}

/** Appends a block at the end of the text, preceded by exactly one blank line. */
export function appendBlock(text: string, blockLines: string[]): string {
  if (text === "") return blockLines.join("\n") + "\n";
  const lines = splitLines(text);
  const eol = trailingEol(lines);
  const block = blockLines.join(eol) + eol;
  return text.endsWith("\n") ? text + eol + block : text + eol + eol + block;
}

export function appendGroup(text: string, group: Pick<Group, "name" | "entities">): string {
  return appendBlock(text, [printGroup(group)]);
}

/** Removes a group block and exactly one blank line before it, when there is one. */
export function removeGroupBlock(text: string, group: Group): string {
  const lines = splitLines(text);
  let start = group.line - 1;
  if (start > 0 && lines[start - 1]!.content.trim() === "") start--;
  lines.splice(start, group.endLine - start);
  return joinLines(lines);
}

/** Rewrites an entity's name and every reference to it, in canonical name form. */
export function renameEntityText(text: string, parse: ParseResult, from: string, to: string): string {
  const spans = parse.entitySpans.filter((s) => s.entity === from).sort((a, b) => b.start - a.start);
  let result = text;
  const replacement = printName(to);
  for (const span of spans) result = result.slice(0, span.start) + replacement + result.slice(span.end);
  return result;
}

export function starterEntityName(model: Model): string {
  const taken = new Set(model.entities.map((e) => e.name));
  if (!taken.has("new_entity")) return "new_entity";
  let n = 2;
  while (taken.has(`new_entity_${n}`)) n++;
  return `new_entity_${n}`;
}

export function appendStarterEntity(text: string, model: Model): string {
  const name = starterEntityName(model);
  return appendBlock(
    text,
    printEntityLines({
      name,
      columns: [
        { name: "id", type: { name: "int", params: [] }, key: true, auto: true, required: false, unique: false, default: null, link: null },
      ],
      indexes: [],
      line: 0,
      endLine: 0,
    }),
  );
}
