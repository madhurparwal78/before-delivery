export type BodyInline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'claim'; readonly id: string };

export type BodySection = {
  readonly id: string;
  readonly heading: string;
  readonly paragraphs: readonly (readonly BodyInline[])[];
};

export type ParsedBody = {
  readonly lead: readonly (readonly BodyInline[])[];
  readonly sections: readonly BodySection[];
  /** Claim ids in order of first appearance. */
  readonly markerIds: readonly string[];
};

const MARKER = /\[claim:([^\]]+)\]/g;

export function sectionId(heading: string, taken: ReadonlySet<string>): string {
  const base =
    heading
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section';
  let candidate = base;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function splitInline(text: string, markerIds: string[]): BodyInline[] {
  const parts: BodyInline[] = [];
  let cursor = 0;
  MARKER.lastIndex = 0;
  for (let match = MARKER.exec(text); match !== null; match = MARKER.exec(text)) {
    if (match.index > cursor) {
      parts.push({ kind: 'text', value: text.slice(cursor, match.index) });
    }
    const id = (match[1] as string).trim();
    if (!markerIds.includes(id)) markerIds.push(id);
    parts.push({ kind: 'claim', id });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) });
  return parts;
}

export function parseBody(body: string): ParsedBody {
  const markerIds: string[] = [];
  const lead: BodyInline[][] = [];
  const sections: BodySection[] = [];
  const taken = new Set<string>();

  let heading: string | null = null;
  let paragraphs: BodyInline[][] = [];
  let buffer: string[] = [];

  const flushParagraph = (): void => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (text === '') return;
    paragraphs.push(splitInline(text, markerIds));
  };

  const flushSection = (): void => {
    flushParagraph();
    if (heading === null) {
      lead.push(...paragraphs);
    } else {
      const id = sectionId(heading, taken);
      taken.add(id);
      sections.push({ id, heading, paragraphs });
    }
    paragraphs = [];
  };

  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      flushSection();
      heading = line.slice(3).trim();
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    buffer.push(line);
  }
  flushSection();

  return { lead, sections, markerIds };
}

export function bodyMarkerIds(body: string): readonly string[] {
  return parseBody(body).markerIds;
}

/** The published prose: markers replaced by claim text, section prefixes dropped. */
export function plainBody(body: string, claimTexts: ReadonlyMap<string, string>): string {
  const withClaims = body.replace(MARKER, (_whole, rawId: string) => {
    const id = rawId.trim();
    return claimTexts.get(id) ?? '';
  });
  return withClaims
    .split(/\r?\n/)
    .map((line) => (line.startsWith('## ') ? line.slice(3) : line))
    .join('\n');
}

export function readTimeMinutes(body: string, claimTexts: ReadonlyMap<string, string>): number {
  const words = plainBody(body, claimTexts).split(/\s+/).filter((word) => word.length > 0);
  return Math.max(1, Math.ceil(words.length / 225));
}
