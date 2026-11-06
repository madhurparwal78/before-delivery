import type { Manifest } from '../../shared/domain';
import { computeManifest, linkTargets, splitTarget, resolveLink } from '../../shared/domain';
import type { Note } from '../store';

export interface RingModel {
  rootId: string;
  nodes: Array<{ id: string; title: string; hop: number; inside: boolean; private: boolean; angle: number; stub?: boolean }>;
  links: Array<{ from: string; to: string | null; stub: boolean; cut: boolean }>;
  stubs: Array<{ id: string; angle: number }>;
  stubIndex: Map<string, string>;
}

const HOPS = 4;

/** Layout for the ring: root at centre, notes on hop rings, unresolved targets as stubs. */
export const ringLayout = (notes: Note[], rootId: string, radius: number): RingModel => {
  const candidates = notes;
  const root = candidates.find((n) => n.id === rootId);
  const model: RingModel = {
    rootId,
    nodes: [],
    links: [],
    stubs: [],
    stubIndex: new Map(),
  };
  if (!root) return model;
  const manifest = computeManifest({ radius, notes: candidates.map((n) => ({ id: n.id, title: n.title, aliases: n.aliases, frontmatter: n.frontmatter, body: n.body, private: n.private })) });
  const hopOf = new Map(manifest.inside.map((i) => [i.note_id, i.hop]));
  const byId = new Map(candidates.map((n) => [n.id, n]));
  const manifestAll = computeManifest({ radius: HOPS, notes: candidates.map((n) => ({ id: n.id, title: n.title, aliases: n.aliases, frontmatter: n.frontmatter, body: n.body, private: n.private })) });
  const hopOfAll = new Map(manifestAll.inside.map((i) => [i.note_id, i.hop]));
  // angles: distribute notes on each ring evenly
  const byHop = new Map<number, Note[]>();
  for (const n of candidates) {
    const h = hopOfAll.get(n.id);
    if (h === undefined || n.private) continue;
    if (!byHop.has(h)) byHop.set(h, []);
    (byHop.get(h) as Note[]).push(n);
  }
  const angles = new Map<string, number>();
  angles.set(root.id, 0);
  for (const [h, list] of byHop) {
    list.sort((a, b) => (a.title < b.title ? -1 : 1));
    list.forEach((n, i) => angles.set(n.id, (2 * Math.PI * i) / list.length + (h % 2) * (Math.PI / list.length)));
  }
  for (const n of candidates) {
    const h = hopOfAll.get(n.id);
    if (h === undefined) continue;
    model.nodes.push({
      id: n.id, title: n.title, hop: h,
      inside: hopOf.has(n.id),
      private: n.private,
      angle: angles.get(n.id) ?? 0,
    });
  }
  // links
  const insideIds = new Set(manifest.inside.map((i) => i.note_id));
  const stubTitles = new Map<string, string>();
  for (const src of model.nodes) {
    const note = byId.get(src.id) as Note;
    const seen = new Set<string>();
    for (const raw of linkTargets(note.body)) {
      const { target } = splitTarget(raw);
      const key = target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const t = resolveLink(candidates.map((n) => ({ id: n.id, title: n.title, aliases: n.aliases, frontmatter: n.frontmatter, body: n.body, private: n.private })), target);
      if (t && hopOfAll.has(t.id) && !t.private) {
        model.links.push({ from: src.id, to: t.id, stub: false, cut: !(insideIds.has(src.id) && insideIds.has(t.id)) });
      } else {
        const stubKey = (t ? t.title : target).toLowerCase();
        if (!stubTitles.has(stubKey)) {
          stubTitles.set(stubKey, t ? t.title : target);
          model.stubs.push({ id: stubKey, angle: (angles.get(src.id) ?? 0) + 0.35 });
          model.stubIndex.set(stubKey, stubKey);
        }
        model.links.push({ from: src.id, to: null, stub: true, cut: !insideIds.has(src.id) });
      }
    }
  }
  // give stubs node entries so they render
  for (const st of model.stubs) {
    model.nodes.push({ id: `stub:${st.id}`, title: '', hop: HOPS, inside: false, private: false, angle: st.angle, stub: true });
  }
  return model;
};

export const countsAt = (notes: Note[], radius: number): { public_count: number; severed_count: number } => {
  const m: Manifest = computeManifest({ radius, notes: notes.map((n) => ({ id: n.id, title: n.title, aliases: n.aliases, frontmatter: n.frontmatter, body: n.body, private: n.private })) });
  return { public_count: m.public_count, severed_count: m.severed_count };
};
