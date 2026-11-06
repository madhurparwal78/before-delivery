// The publish boundary from Business rules: wikilinks, hops, the inside set, severed links and
// page slugs. The workbench counters, the manifest preview and the stored publish all call this.

export interface BoundaryNote {
  id: string;
  title: string;
  aliases: string[];
  body: string;
  private: boolean;
}

export interface Wikilink {
  target: string;
  label: string | null;
}

export const MAX_HOP = 4;
const WIKILINK = /\[\[([^\[\]\n]+?)\]\]/g;

/** `[[target]]`, `[[target|label]]`, `[[target#heading]]`, `[[target#heading|label]]`. */
export function parseWikilink(inner: string): Wikilink {
  const bar = inner.indexOf("|");
  const head = bar === -1 ? inner : inner.slice(0, bar);
  const label = bar === -1 ? null : inner.slice(bar + 1).trim();
  const hash = head.indexOf("#");
  return { target: (hash === -1 ? head : head.slice(0, hash)).trim(), label: label || null };
}

export function wikilinks(body: string): Wikilink[] {
  return [...body.matchAll(WIKILINK)].map((m) => parseWikilink(m[1]));
}

/** Link targets and names are compared ignoring case. */
export function nameKey(text: string): string {
  return text.trim().toLowerCase();
}

export function nameIndex<T extends BoundaryNote>(notes: readonly T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const note of notes) {
    for (const name of [note.title, ...note.aliases]) {
      if (!index.has(nameKey(name))) index.set(nameKey(name), note);
    }
  }
  return index;
}

/**
 * Fewest outgoing-link steps from the root. Every reached note gets a hop, but only notes that
 * are not private are travelled through, so a private note's hop is where the ring draws it.
 */
export function hops(notes: readonly BoundaryNote[], rootId: string): Map<string, number> {
  const index = nameIndex(notes);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const result = new Map<string, number>();
  const root = byId.get(rootId);
  if (!root) return result;
  result.set(root.id, 0);
  let frontier = root.private ? [] : [root];
  for (let hop = 1; frontier.length > 0; hop += 1) {
    const next: BoundaryNote[] = [];
    for (const note of frontier) {
      for (const link of wikilinks(note.body)) {
        const target = index.get(nameKey(link.target));
        if (target && !result.has(target.id)) {
          result.set(target.id, hop);
          if (!target.private) next.push(target);
        }
      }
    }
    frontier = next;
  }
  return result;
}

interface SeveredLink {
  noteId: string;
  target: string;
}

export interface Boundary {
  radius: number;
  hops: Map<string, number>;
  inside: { note_id: string; hop: number }[];
  insideIds: Set<string>;
  severed: SeveredLink[];
}

/** The inside set and the distinct (inside note, target) pairs that leave it, for one radius. */
export function boundary(notes: readonly BoundaryNote[], rootId: string, radius: number): Boundary {
  const reached = hops(notes, rootId);
  const index = nameIndex(notes);
  const inside = notes
    .filter((n) => !n.private && (reached.get(n.id) ?? Infinity) <= radius)
    .map((n) => ({ note_id: n.id, hop: reached.get(n.id) ?? 0 }))
    .sort((a, b) => a.hop - b.hop || (a.note_id < b.note_id ? -1 : a.note_id > b.note_id ? 1 : 0));
  const insideIds = new Set(inside.map((i) => i.note_id));
  const severed: SeveredLink[] = [];
  for (const note of notes) {
    if (!insideIds.has(note.id)) continue;
    const seen = new Set<string>();
    for (const link of wikilinks(note.body)) {
      const target = nameKey(link.target);
      if (seen.has(target)) continue;
      seen.add(target);
      const resolved = index.get(target);
      if (!resolved || !insideIds.has(resolved.id)) severed.push({ noteId: note.id, target });
    }
  }
  return { radius, hops: reached, inside, insideIds, severed };
}

/** Every non-private note within hop 4 of the root: what the browser sends to the server. */
export function candidates<T extends BoundaryNote>(notes: readonly T[], rootId: string): T[] {
  const reached = hops(notes, rootId);
  return notes.filter((n) => !n.private && (reached.get(n.id) ?? Infinity) <= MAX_HOP);
}

/** The candidate-list rule violations, as the `notes` field message, or null. */
export function candidateProblem(notes: readonly BoundaryNote[], rootId: string): string | null {
  if (notes.length > 500) return "at most 500 notes";
  if (new Set(notes.map((n) => n.id)).size !== notes.length) return "duplicate id";
  const root = notes.find((n) => n.id === rootId);
  if (!root) return "must include the root note";
  if (root.private) return "root note cannot be private";
  const names = notes.flatMap((n) => [...new Set([n.title, ...n.aliases].map(nameKey))]);
  if (new Set(names).size !== names.length) return "duplicate title or alias";
  return null;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "note";
}

/** Page slugs for every inside note except the root ("" is the root page). */
export function pageSlugs(notes: readonly BoundaryNote[], result: Boundary, rootId: string): Map<string, string> {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const ordered = result.inside
    .filter((i) => i.note_id !== rootId)
    .map((i) => ({ hop: i.hop, note: byId.get(i.note_id) as BoundaryNote }))
    .sort((a, b) => a.hop - b.hop || (a.note.title < b.note.title ? -1 : a.note.title > b.note.title ? 1 : 0));
  const taken = new Set<string>();
  const slugs = new Map<string, string>([[rootId, ""]]);
  for (const { note } of ordered) {
    const plain = slugify(note.title);
    let slug = plain;
    for (let k = 2; taken.has(slug); k += 1) slug = `${plain}-${k}`;
    taken.add(slug);
    slugs.set(note.id, slug);
  }
  return slugs;
}

/** Inside notes (other than the note itself) whose body links to it: the "Linked from" list. */
export function linkedFrom<T extends BoundaryNote>(notes: readonly T[], insideIds: Set<string>, noteId: string): T[] {
  const index = nameIndex(notes);
  return notes.filter((other) => other.id !== noteId && insideIds.has(other.id)
    && wikilinks(other.body).some((l) => index.get(nameKey(l.target))?.id === noteId));
}
