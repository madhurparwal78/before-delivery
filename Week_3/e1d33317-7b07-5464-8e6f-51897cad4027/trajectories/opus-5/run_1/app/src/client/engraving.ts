import type { EngravedSystem, EngravingResponse } from '../shared/types.js';
import { request } from './api.js';
import { el } from './dom.js';

const SYSTEMS_PER_REQUEST = 8;

/** Follows the server's cursor until it is null, so every client shows the same breaks. */
export async function fetchSystems(
  scoreId: string,
  view: 'score' | 'part',
  partId: string | null,
): Promise<{ systems: EngravedSystem[]; lamport: number }> {
  const systems: EngravedSystem[] = [];
  let cursor: string | null = null;
  let lamport = 0;
  for (;;) {
    const search = new URLSearchParams({ view, limit: String(SYSTEMS_PER_REQUEST) });
    if (partId !== null) search.set('partId', partId);
    if (cursor !== null) search.set('cursor', cursor);
    const page: EngravingResponse = await request<EngravingResponse>(
      `/api/scores/${scoreId}/engraving?${search.toString()}`,
    );
    systems.push(...page.systems);
    lamport = page.lamport;
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  return { systems, lamport };
}

export function systemGroup(system: EngravedSystem): HTMLElement {
  const group = el('div', {
    class: 'system',
    role: 'group',
    'aria-label': `System ${system.index}, measures ${system.firstMeasure}\u2013${system.lastMeasure}`,
    'data-system': system.index,
    'data-first': system.firstMeasure,
    'data-last': system.lastMeasure,
  });
  group.innerHTML = system.svg;
  return group;
}

export function pageGroups(systems: EngravedSystem[]): HTMLElement[] {
  const pages = new Map<number, EngravedSystem[]>();
  for (const system of systems) {
    const list = pages.get(system.page) ?? [];
    list.push(system);
    pages.set(system.page, list);
  }
  return [...pages.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, members]) =>
      el(
        'div',
        { class: 'part-page', role: 'group', 'aria-label': `Page ${page}` },
        members.map((system) => systemGroup(system)),
      ),
    );
}
