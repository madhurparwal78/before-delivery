import type { Mission, MissionEvent, MissionEventKind } from '../../shared/types.js';
import { ApiFailure, isCurrent, request } from '../api.js';
import type { Mounted, ScreenFactory } from '../app.js';
import { button, el, setText } from '../dom.js';

const KIND_LABELS: [MissionEventKind, string][] = [
  ['created', 'Created'],
  ['assignments', 'Assignments'],
  ['status', 'Status'],
  ['line', 'Line'],
  ['file', 'File'],
  ['alert', 'Alert'],
  ['infill', 'Infill'],
  ['owner', 'Owner'],
  ['hold', 'Hold'],
  ['geofence', 'Geofence'],
  ['rerun', 'Rerun'],
];

/** Every event of a mission, newest first, with server times and actors. */
export const historyScreen: ScreenFactory = (shell, context): Mounted => {
  const missionId = context.screen.kind === 'missionHistory' ? context.screen.missionId : '';

  const heading = el('h1', {});
  const status = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'History status',
    class: 'live-region',
  });
  shell.registerRegion('History status', status);

  const list = el('ul', { 'aria-label': 'Mission events', class: 'event-list' });
  const loadOlder = button('Load older events');
  loadOlder.hidden = true;

  const kindsGroup = el('div', { role: 'group', 'aria-label': 'Event kinds', class: 'kinds' });
  const checkboxes = new Map<MissionEventKind, HTMLInputElement>();
  const selected = new Set<MissionEventKind>(
    (context.query.get('kinds') ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part): part is MissionEventKind =>
        KIND_LABELS.some(([kind]) => kind === part),
      ),
  );
  if (selected.size === 0) for (const [kind] of KIND_LABELS) selected.add(kind);

  for (const [kind, label] of KIND_LABELS) {
    const input = el('input', { type: 'checkbox', id: `kind-${kind}` });
    input.checked = selected.has(kind);
    input.addEventListener('change', () => {
      if (input.checked) selected.add(kind);
      else selected.delete(kind);
      writeAddress();
      void load(null, true);
    });
    checkboxes.set(kind, input);
    kindsGroup.append(
      el('span', { class: 'kind-choice' }, [input, el('label', { for: `kind-${kind}` }, [label])]),
    );
  }

  function writeAddress(): void {
    const params = new URLSearchParams();
    // With every kind checked the parameter is absent.
    if (selected.size !== KIND_LABELS.length) params.set('kinds', [...selected].join(','));
    window.history.replaceState(
      null,
      '',
      `/missions/${missionId}/history${params.toString() ? `?${params.toString()}` : ''}`,
    );
  }

  const node = el('section', { class: 'history' }, [heading, kindsGroup, status, list, loadOlder]);

  let shown = 0;
  let nextCursor: number | null = null;

  function row(event: MissionEvent): HTMLElement {
    const at = new Date(event.at).toISOString();
    return el('li', {}, [
      `${at.slice(0, 10)} ${at.slice(11, 19)} UTC · ${event.actor} · ${event.summary}`,
    ]);
  }

  async function load(before: number | null, reset: boolean): Promise<void> {
    const at = shell.generation;
    const params = new URLSearchParams();
    if (selected.size !== KIND_LABELS.length) params.set('kinds', [...selected].join(','));
    if (before !== null) params.set('before', String(before));
    try {
      const result = await request<{ events: MissionEvent[]; next: number | null }>(
        `/api/missions/${missionId}/history${params.toString() ? `?${params.toString()}` : ''}`,
      );
      if (!isCurrent(at)) return;
      if (reset) {
        list.replaceChildren();
        shown = 0;
      }
      const added = result.events.map((event) => row(event));
      for (const node_ of added) list.append(node_);
      shown += added.length;
      nextCursor = result.next;
      loadOlder.hidden = nextCursor === null;
      setText(status, `Showing ${shown} events`);
      if (!reset) added[0]?.focus();
    } catch {
      setText(status, `Showing ${shown} events`);
    }
  }

  loadOlder.addEventListener('click', () => {
    if (nextCursor !== null) void load(nextCursor, false);
  });

  const at = shell.generation;
  void request<Mission>(`/api/missions/${missionId}`)
    .then((mission) => {
      if (!isCurrent(at)) return;
      setText(heading, `History of ${mission.name}`);
    })
    .catch((error: unknown) => {
      if (isCurrent(at) && error instanceof ApiFailure && error.status === 404) shell.notFound();
    });
  void load(null, true);

  return { node, dispose: () => shell.unregisterRegion('History status') };
};
