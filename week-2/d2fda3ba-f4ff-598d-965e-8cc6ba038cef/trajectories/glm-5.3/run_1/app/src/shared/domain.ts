export const SLUG_MIN = 3;
export const SLUG_MAX = 48;
export const ENV_NAMES = ['CRN1'] as const;
export const MAX_CIPHER_BYTES = 2_000_000;

export interface CandidateNote {
  id: string;
  title: string;
  aliases: string[];
  frontmatter: Record<string, string>;
  body: string;
  private: boolean;
}

export interface ManifestInput {
  radius: number;
  notes: CandidateNote[];
}

export interface InsideNote {
  note_id: string;
  hop: number;
}

export interface Manifest {
  radius: number;
  public_count: number;
  severed_count: number;
  inside: InsideNote[];
}

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const isSlug = (v: string): boolean => /^[a-z0-9-]+$/.test(v);

const linkRe = /\[\[([^\]]+)\]\]/g;

/** Resolve a wikilink target (text before # or |, trimmed) against a candidate note. */
export const resolveLink = (
  notes: CandidateNote[],
  target: string,
): CandidateNote | undefined => {
  const t = target.trim().toLowerCase();
  if (!t) return undefined;
  const primary = (n: CandidateNote): string => n.title.trim().toLowerCase();
  let byTitle: CandidateNote | undefined;
  for (const n of notes) if (primary(n) === t) { byTitle = n; break; }
  if (byTitle) return byTitle;
  for (const n of notes)
    for (const a of n.aliases) if (a.trim().toLowerCase() === t) return n;
  return undefined;
};

/** Wikilink targets in a body, in order, with duplicates removed. */
export const linkTargets = (body: string): string[] => {
  const out: string[] = [];
  for (const m of body.matchAll(linkRe)) out.push(m[1]);
  return out;
};

export const splitTarget = (raw: string): { target: string; label: string | null } => {
  let t = raw;
  let label: string | null = null;
  const pipe = t.indexOf('|');
  if (pipe >= 0) {
    label = t.slice(pipe + 1).trim();
    t = t.slice(0, pipe);
  }
  const hash = t.indexOf('#');
  if (hash >= 0) t = t.slice(0, hash);
  return { target: t.trim(), label };
};

export interface ValidateNotesResult {
  error?: { field: string; message: string };
  notes: CandidateNote[];
  root: CandidateNote | undefined;
}

export const validateCandidates = (
  radius: unknown,
  notesRaw: unknown,
): ValidateNotesResult => {
  if (typeof radius !== 'number' || !Number.isInteger(radius) || radius < 0 || radius > 4)
    return { notes: [], root: undefined, error: { field: 'radius', message: 'radius must be an integer from 0 to 4' } };
  if (!Array.isArray(notesRaw))
    return { notes: [], root: undefined, error: { field: 'notes', message: 'notes must be a list' } };
  if (notesRaw.length < 1 || notesRaw.length > 500)
    return { notes: [], root: undefined, error: { field: 'notes', message: 'at most 500 notes' } };
  const notes: CandidateNote[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const n of notesRaw) {
    if (typeof n !== 'object' || n === null || !isUuid((n as CandidateNote).id) || typeof (n as CandidateNote).title !== 'string')
      return { notes: [], root: undefined, error: { field: 'notes', message: 'each note needs an id and a title' } };
    const c = n as CandidateNote;
    if (seenIds.has(c.id)) return { notes: [], root: undefined, error: { field: 'notes', message: 'duplicate id' } };
    seenIds.add(c.id);
    const names = [c.title, ...c.aliases].map((s) => s.trim().toLowerCase());
    for (const nm of names) {
      if (nm && seenNames.has(nm))
        return { notes: [], root: undefined, error: { field: 'notes', message: 'duplicate title or alias' } };
      if (nm) seenNames.add(nm);
    }
    notes.push({
      id: c.id,
      title: c.title,
      aliases: Array.isArray(c.aliases) ? c.aliases : [],
      frontmatter: c.frontmatter ?? {},
      body: typeof c.body === 'string' ? c.body : '',
      private: c.private === true,
    });
  }
  const root = notes[0];
  if (root.private)
    return { notes, root: undefined, error: { field: 'notes', message: 'root note cannot be private' } };
  return { notes, root };
};

/**
 * The one implementation of the exposure boundary. The publish workbench,
 * manifest preview and stored publishes all use it.
 */
export const computeManifest = (input: ManifestInput): Manifest => {
  const { radius } = input;
  const byId = new Map<string, CandidateNote>();
  for (const n of input.notes) byId.set(n.id, n);
  const root = input.notes[0];
  const hops = new Map<string, number>([[root.id, 0]]);
  if (!root.private) {
    // BFS through non-private notes only; private notes are never travelled through.
    const queue: string[] = [root.id];
    while (queue.length) {
      const cur = queue.shift() as string;
      const note = byId.get(cur) as CandidateNote;
      const h = hops.get(cur) as number;
      for (const raw of linkTargets(note.body)) {
        const { target } = splitTarget(raw);
        const t = resolveLink(input.notes, target);
        if (!t || t.private) continue;
        if (!hops.has(t.id)) {
          hops.set(t.id, h + 1);
          queue.push(t.id);
        }
      }
    }
  }
  const inside: InsideNote[] = [];
  const hopOf = new Map<string, number>();
  for (const n of input.notes) {
    if (n.private) continue;
    const h = hops.get(n.id);
    if (h === undefined || h > radius) continue;
    inside.push({ note_id: n.id, hop: h });
    hopOf.set(n.id, h);
  }
  const insideIds = new Set(inside.map((i) => i.note_id));
  let severed = 0;
  for (const item of inside) {
    const note = byId.get(item.note_id) as CandidateNote;
    const seen = new Set<string>();
    for (const raw of linkTargets(note.body)) {
      const { target } = splitTarget(raw);
      const key = target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const t = resolveLink(input.notes, target);
      if (!t || !insideIds.has(t.id)) severed++;
    }
  }
  inside.sort((a, b) => a.hop - b.hop || (a.note_id < b.note_id ? -1 : a.note_id > b.note_id ? 1 : 0));
  return { radius, public_count: inside.length, severed_count: severed, inside };
};
