export interface RosterLine {
  line: number;
  seed: number | null;
  name: string;
  username: string | null;
}

export interface ParsedRoster {
  ok: boolean;
  errors: string[];
  lines: RosterLine[];
}

export function decodeRosterText(buf: Buffer): string | null {
  let bytes = buf;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3);
  }
  if (buf.length === 0) return "";
  try {
    // Strict UTF-8 validation
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Parse roster text. Lines may end in LF or CRLF. Blank lines and lines whose
 * first non-space character is '#' are ignored. Every physical line counts for
 * numbering, starting at 1.
 */
export function parseRoster(text: string): RosterLine[] {
  const out: RosterLine[] = [];
  const physical = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < physical.length; i++) {
    const raw = physical[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    let seed: number | null = null;
    let rest = raw;
    const pipe = raw.indexOf("|");
    if (pipe !== -1) {
      const seedText = raw.slice(0, pipe).trim();
      seed = seedText === "" ? null : Number(seedText);
      rest = raw.slice(pipe + 1);
    }
    let username: string | null = null;
    const at = rest.match(/\s@([^\s]+)\s*$/);
    if (at) {
      username = at[1].toLowerCase();
      rest = rest.slice(0, at.index ?? 0);
    }
    out.push({ line: i + 1, seed, name: rest.trim(), username });
  }
  return out;
}
