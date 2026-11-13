// `.spurline/OWNERS` parsing and the owners of a set of changed files (see "Code owners and approvals").
import { globToRegExp } from "../../shared/glob.ts";

/** Whether a user (`name`) or a group (`group/path`) exists. */
type OwnerExists = (owner: string) => boolean;

interface OwnersLine {
  readonly line: number;
  readonly pattern: string;
  /** `user` or `group/path`, without the leading `@`, de-duplicated. */
  readonly owners: readonly string[];
}

interface OwnersSection {
  readonly name: string;
  readonly optional: boolean;
  readonly count: number;
  readonly lines: readonly OwnersLine[];
}

interface OwnersProblem {
  readonly line: number;
  readonly reason: string;
}

interface ParsedOwners {
  readonly sections: readonly OwnersSection[];
  readonly problems: readonly OwnersProblem[];
}

export interface SectionOwners {
  readonly name: string;
  readonly optional: boolean;
  readonly count: number;
  readonly owners: readonly string[];
  readonly files: readonly string[];
}

const HEADER = /^(\^?)\[([^[\]]*)\](?:\[([^[\]]*)\])?$/u;
const COUNT = /^[1-9][0-9]*$/u;
const IMPLICIT_SECTION = "Owners";

interface DraftSection {
  readonly name: string;
  readonly optional: boolean;
  readonly count: number;
  readonly lines: OwnersLine[];
}

type HeaderResult = { readonly section: DraftSection } | { readonly reason: string };

function parseHeader(text: string): HeaderResult {
  const match = HEADER.exec(text);
  if (match === null) return { reason: "bad section header" };
  const name = (match[2] ?? "").trim();
  if (name === "") return { reason: "bad section header" };
  const countText = match[3];
  let count = 1;
  if (countText !== undefined) {
    const trimmed = countText.trim();
    if (!COUNT.test(trimmed)) return { reason: "bad count" };
    count = Number(trimmed);
  }
  return { section: { name, optional: match[1] === "^", count, lines: [] } };
}

function ownerLine(
  line: number,
  text: string,
  exists: OwnerExists,
): { readonly entry: OwnersLine } | { readonly reason: string } {
  const [pattern = "", ...tokens] = text.split(/\s+/u);
  if (tokens.length === 0) return { reason: "no owners" };
  const owners: string[] = [];
  for (const token of tokens) {
    const owner = token.startsWith("@") ? token.slice(1) : token;
    if (!exists(owner)) return { reason: `unknown ${owner.includes("/") ? "group" : "user"} @${owner}` };
    if (!owners.includes(owner)) owners.push(owner);
  }
  return { entry: { line, pattern, owners } };
}

export function parseOwners(text: string, exists: OwnerExists): ParsedOwners {
  const sections: DraftSection[] = [];
  const problems: OwnersProblem[] = [];
  // Lines under a malformed header belong to no section: they are still checked, never matched.
  let current: DraftSection | null = null;
  let detached = false;
  text.split("\n").forEach((rawLine, index) => {
    const line = index + 1;
    const trimmed = rawLine.trim();
    if (trimmed === "") return;
    if (trimmed.startsWith("[") || trimmed.startsWith("^[")) {
      const header = parseHeader(trimmed);
      if ("reason" in header) {
        problems.push({ line, reason: header.reason });
        current = null;
        detached = true;
      } else {
        current = header.section;
        detached = false;
        sections.push(current);
      }
      return;
    }
    if (current === null && !detached) {
      current = { name: IMPLICIT_SECTION, optional: false, count: 1, lines: [] };
      sections.push(current);
    }
    const parsed = ownerLine(line, trimmed, exists);
    if ("reason" in parsed) problems.push({ line, reason: parsed.reason });
    else current?.lines.push(parsed.entry);
  });
  return { sections, problems };
}

export function ownersForFiles(sections: readonly OwnersSection[], changedFiles: readonly string[]): SectionOwners[] {
  const result: SectionOwners[] = [];
  for (const section of sections) {
    const matchers = section.lines.map((entry) => ({ entry, regex: globToRegExp(entry.pattern) }));
    const owners: string[] = [];
    const files: string[] = [];
    for (const file of changedFiles) {
      const winner = matchers.findLast((matcher) => matcher.regex.test(file));
      if (winner === undefined) continue;
      files.push(file);
      for (const owner of winner.entry.owners) if (!owners.includes(owner)) owners.push(owner);
    }
    if (files.length > 0) result.push({ name: section.name, optional: section.optional, count: section.count, owners, files });
  }
  return result;
}
