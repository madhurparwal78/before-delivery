export interface CandidateNote {
  id: string;
  title: string;
  aliases: string[];
  frontmatter: Record<string, unknown>;
  body: string;
  private: boolean;
}

export interface Wikilink {
  /** Whole `[[...]]` source text. */
  raw: string;
  /** Link target text, before any heading or label. */
  target: string;
  label: string | null;
  index: number;
}

export const MAX_HOP = 4;

const WIKILINK = /\[\[([^\[\]\n]+)\]\]/g;

export function parseWikilinks(body: string): Wikilink[] {
  const links: Wikilink[] = [];
  WIKILINK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK.exec(body)) !== null) {
    const inner = match[1] ?? '';
    const pipe = inner.indexOf('|');
    const left = pipe === -1 ? inner : inner.slice(0, pipe);
    const label = pipe === -1 ? null : inner.slice(pipe + 1).trim();
    const hash = left.indexOf('#');
    const target = (hash === -1 ? left : left.slice(0, hash)).trim();
    links.push({ raw: match[0], target, label: label && label.length > 0 ? label : null, index: match.index });
  }
  return links;
}

/** Distinct link targets of a note, in first-seen order, compared ignoring case. */
export function distinctTargets(body: string): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const link of parseWikilinks(body)) {
    if (link.target.length === 0) continue;
    const key = link.target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(link.target);
  }
  return targets;
}

/** Index of lowercased title and alias to note id. Later entries do not displace earlier ones. */
export function buildTitleIndex(notes: readonly CandidateNote[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const note of notes) {
    for (const name of [note.title, ...note.aliases]) {
      const key = name.trim().toLowerCase();
      if (key.length > 0 && !index.has(key)) index.set(key, note.id);
    }
  }
  return index;
}

export type LinkKind = 'note' | 'stub';

export interface GraphLink {
  fromId: string;
  target: string;
  toId: string | null;
  kind: LinkKind;
}

export interface GraphAnalysis {
  notes: Map<string, CandidateNote>;
  /** Hop distance of every non-private note reachable from the root through non-private notes. */
  hops: Map<string, number>;
  /** Display hop of private notes linked from a reachable note: the linker's hop plus one. */
  privateHops: Map<string, number>;
  links: GraphLink[];
  titleIndex: Map<string, string>;
}

export function analyseGraph(notes: readonly CandidateNote[], rootNoteId: string): GraphAnalysis {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const titleIndex = buildTitleIndex(notes);

  const links: GraphLink[] = [];
  for (const note of notes) {
    for (const target of distinctTargets(note.body)) {
      const toId = titleIndex.get(target.toLowerCase()) ?? null;
      links.push({ fromId: note.id, target, toId, kind: toId === null ? 'stub' : 'note' });
    }
  }
  const outgoing = new Map<string, GraphLink[]>();
  for (const link of links) {
    const list = outgoing.get(link.fromId);
    if (list) list.push(link);
    else outgoing.set(link.fromId, [link]);
  }

  const hops = new Map<string, number>();
  const root = byId.get(rootNoteId);
  if (root && !root.private) {
    hops.set(rootNoteId, 0);
    let frontier = [rootNoteId];
    for (let hop = 1; frontier.length > 0; hop += 1) {
      const next: string[] = [];
      for (const fromId of frontier) {
        for (const link of outgoing.get(fromId) ?? []) {
          if (!link.toId || hops.has(link.toId)) continue;
          const target = byId.get(link.toId);
          if (!target || target.private) continue;
          hops.set(link.toId, hop);
          next.push(link.toId);
        }
      }
      frontier = next;
    }
  }

  const privateHops = new Map<string, number>();
  for (const link of links) {
    const fromHop = hops.get(link.fromId);
    if (fromHop === undefined || !link.toId) continue;
    const target = byId.get(link.toId);
    if (!target || !target.private) continue;
    const hop = Math.min(fromHop + 1, MAX_HOP);
    const known = privateHops.get(link.toId);
    if (known === undefined || hop < known) privateHops.set(link.toId, hop);
  }

  return { notes: byId, hops, privateHops, links, titleIndex };
}

export interface InsideNote {
  note_id: string;
  hop: number;
}

export interface BoundaryResult {
  radius: number;
  insideIds: Set<string>;
  inside: InsideNote[];
  publicCount: number;
  severedCount: number;
  /** Links from an inside note whose target is not an inside note, in a stable order. */
  cutLinks: GraphLink[];
  analysis: GraphAnalysis;
}

function insideOrder(a: InsideNote, b: InsideNote): number {
  return a.hop - b.hop || (a.note_id < b.note_id ? -1 : a.note_id > b.note_id ? 1 : 0);
}

export function computeBoundary(
  notes: readonly CandidateNote[],
  rootNoteId: string,
  radius: number,
  analysis?: GraphAnalysis,
): BoundaryResult {
  const graph = analysis ?? analyseGraph(notes, rootNoteId);
  const inside: InsideNote[] = [];
  const insideIds = new Set<string>();
  for (const [noteId, hop] of graph.hops) {
    if (hop > radius) continue;
    insideIds.add(noteId);
    inside.push({ note_id: noteId, hop });
  }
  inside.sort(insideOrder);

  const cutLinks: GraphLink[] = [];
  for (const link of graph.links) {
    if (!insideIds.has(link.fromId)) continue;
    if (link.toId !== null && insideIds.has(link.toId)) continue;
    cutLinks.push(link);
  }
  cutLinks.sort((a, b) => {
    const ha = graph.hops.get(a.fromId) ?? 0;
    const hb = graph.hops.get(b.fromId) ?? 0;
    if (ha !== hb) return ha - hb;
    const ta = graph.notes.get(a.fromId)?.title ?? '';
    const tb = graph.notes.get(b.fromId)?.title ?? '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.target.toLowerCase() < b.target.toLowerCase() ? -1 : 1;
  });

  return {
    radius,
    insideIds,
    inside,
    publicCount: inside.length,
    severedCount: cutLinks.length,
    cutLinks,
    analysis: graph,
  };
}

export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'note';
}

export interface PageSlugs {
  /** Page slug of every inside note except the root. */
  slugs: Map<string, string>;
}

/**
 * Page slugs for the inside notes other than the root. On collision the first note in
 * order of hop then title keeps the plain slug and later ones gain a "-<k>" suffix.
 */
export function assignPageSlugs(boundary: BoundaryResult, rootNoteId: string): PageSlugs {
  const ordered = boundary.inside
    .filter((entry) => entry.note_id !== rootNoteId)
    .map((entry) => ({ entry, title: boundary.analysis.notes.get(entry.note_id)?.title ?? '' }))
    .sort((a, b) => a.entry.hop - b.entry.hop || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

  const used = new Set<string>();
  const slugs = new Map<string, string>();
  for (const { entry, title } of ordered) {
    const base = slugifyTitle(title);
    let slug = base;
    for (let k = 2; used.has(slug); k += 1) slug = `${base}-${k}`;
    used.add(slug);
    slugs.set(entry.note_id, slug);
  }
  return { slugs };
}
