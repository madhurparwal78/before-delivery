import { formatBeat } from '../shared/music.js';
import type { HistoryEntry, Part, Role } from '../shared/types.js';
import { RequestFailed, request } from './api.js';
import {
  openInviteDialog,
  openRemoveDialog,
  openStaffSettingsDialog,
  openStavesDialog,
} from './dialogs.js';
import { button, clear, el, whilePending } from './dom.js';
import type { Regions } from './regions.js';
import type { ScoreState } from './score-state.js';

export const TAB_NAMES = ['Parts', 'History', 'Holds', 'Sample banks', 'People'] as const;
export type TabName = (typeof TAB_NAMES)[number];

const HISTORY_FILTERS: { label: string; search: string }[] = [
  { label: 'All changes', search: '' },
  { label: 'Notes added', search: 'type=insert' },
  { label: 'Notes deleted', search: 'type=delete' },
  { label: 'Pitch and spelling', search: 'field=pitch' },
  { label: 'Ties', search: 'field=tie' },
  { label: 'Dynamics', search: 'field=dynamic,dynamicPlacement' },
  { label: 'Text', search: 'field=text' },
];

const STATUS_WORDS: Record<Part['status'], string> = {
  draft: 'Draft',
  engraving: 'Engraving',
  rendering: 'Rendering',
  ready: 'Ready',
  pdf_pending: 'PDF pending',
};

export function roleWord(role: Role): string {
  return role === 'composer' ? 'Composer' : role === 'copyist' ? 'Copyist' : 'Section player';
}

function statusText(part: Part): string {
  return `${STATUS_WORDS[part.status]}${part.stale ? ' \u00b7 Score changed since this PDF' : ''}`;
}

export function statusChip(part: Part): HTMLElement {
  return el(
    'span',
    {
      class: 'chip',
      role: 'status',
      'aria-label': `${part.name} PDF status`,
      'data-status': part.status,
    },
    [statusText(part)],
  );
}

export async function downloadPartPdf(state: ScoreState, part: Part): Promise<void> {
  const blob = await request<Blob>(
    `/api/scores/${state.scoreId}/parts/${part.id}/pdf`,
    { expect: 'blob' },
  );
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: `${state.head.title} - ${part.name}.pdf` });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export interface ToolsContext {
  state: ScoreState;
  regions: Regions;
  selectedStaffIds: () => string[];
  openPart: (partId: string) => void;
  extractPart: (partId: string) => Promise<void>;
}

export function partsPanel(context: ToolsContext): HTMLElement {
  const panel = el('div', {}, [el('h2', {}, ['Parts'])]);
  const list = el('ul', { class: 'tool-list', role: 'list', 'aria-label': 'Parts' });
  const paint = (): void => {
    clear(list);
    for (const part of context.state.parts) {
      const item = el('li', {}, [
        el('span', { class: 'name' }, [part.name]),
        statusChip(part),
        button(`Open ${part.name}`, {}, () => context.openPart(part.id)),
      ]);
      if (part.status === 'ready') {
        const link = el(
          'a',
          { href: `/api/scores/${context.state.scoreId}/parts/${part.id}/pdf` },
          [`Download ${part.name} PDF`],
        );
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void downloadPartPdf(context.state, part);
        });
        item.append(link);
      }
      list.append(item);
    }
  };
  paint();
  context.state.on('parts', paint);
  panel.append(list);
  return panel;
}

export function historyPanel(context: ToolsContext): HTMLElement {
  const show = el('select', { 'aria-label': 'Show' });
  for (const [index, filter] of HISTORY_FILTERS.entries()) {
    show.append(el('option', { value: String(index) }, [filter.label]));
  }
  const feed = el('div', { class: 'feed', role: 'feed', 'aria-label': 'Operation history' });
  const older = button('Load older changes');
  const fresh = button('Show 0 new changes', { hidden: true });
  let cursor: string | null = null;
  let newest = 0;
  let waiting = 0;

  const entryNode = (entry: HistoryEntry): HTMLElement => {
    const at = new Date(entry.at).toISOString().slice(11, 19);
    return el('article', {}, [
      `${entry.author.name} \u00b7 ${entry.summary} \u00b7 ${entry.staffName}, measure ${entry.measure}, beat ${formatBeat(entry.beat)} \u00b7 `,
      el('span', { class: 'stamp' }, [at]),
    ]);
  };

  const fetchPage = async (before: string | null): Promise<void> => {
    const search = new URLSearchParams(HISTORY_FILTERS[Number(show.value)]!.search);
    search.set('limit', '20');
    if (before !== null) search.set('before', before);
    try {
      const payload = await request<{ entries: HistoryEntry[]; nextCursor: string | null }>(
        `/api/scores/${context.state.scoreId}/history?${search.toString()}`,
      );
      if (before === null) {
        clear(feed);
        newest = payload.entries[0]?.seq ?? 0;
      }
      for (const entry of payload.entries) feed.append(entryNode(entry));
      cursor = payload.nextCursor;
      if (before !== null) {
        context.regions.say(
          'History',
          payload.entries.length === 0
            ? 'No older changes.'
            : `Loaded ${payload.entries.length} older changes.`,
        );
      }
    } catch {
      context.regions.say('History', 'Could not load history. Try again.');
    }
  };

  show.addEventListener('change', () => {
    waiting = 0;
    fresh.hidden = true;
    void fetchPage(null);
  });
  older.addEventListener('click', () => {
    if (cursor === null) {
      context.regions.say('History', 'No older changes.');
      return;
    }
    void whilePending(older, () => fetchPage(cursor));
  });
  fresh.addEventListener('click', () => {
    waiting = 0;
    fresh.hidden = true;
    void fetchPage(null);
  });

  context.state.on('voices', () => {
    void (async () => {
      const search = new URLSearchParams(HISTORY_FILTERS[Number(show.value)]!.search);
      search.set('limit', '1');
      const payload = await request<{ entries: HistoryEntry[] }>(
        `/api/scores/${context.state.scoreId}/history?${search.toString()}`,
      );
      const top = payload.entries[0]?.seq ?? 0;
      if (top > newest) {
        waiting = top - newest;
        fresh.textContent = `Show ${waiting} new changes`;
        fresh.hidden = false;
      }
    })().catch(() => undefined);
  });

  void fetchPage(null);
  return el('div', {}, [
    el('h2', {}, ['History']),
    el('div', { class: 'field' }, [el('label', {}, ['Show']), show]),
    fresh,
    feed,
    older,
  ]);
}

export function holdsPanel(context: ToolsContext): HTMLElement {
  const list = el('ul', { class: 'tool-list', role: 'list', 'aria-label': 'Current holds' });
  const hold = button('Hold selected staves');
  const release = button('Release my holds');
  const settings = button('Staff settings');

  const paint = (): void => {
    clear(list);
    for (const entry of context.state.holds) {
      list.append(
        el('li', {}, [`${context.state.staff(entry.staffId).name} \u2014 ${entry.holder.name}`]),
      );
    }
  };
  paint();
  context.state.on('holds', paint);
  context.state.on('score', paint);

  hold.addEventListener('click', () => {
    void whilePending(hold, () => requestHolds(context));
  });
  release.addEventListener('click', () => {
    void whilePending(release, async () => {
      const mine = context.state.holds
        .filter((entry) => entry.holder.id === context.state.me.id)
        .map((entry) => entry.staffId);
      if (mine.length === 0) return;
      await request(
        `/api/scores/${context.state.scoreId}/holds?staffIds=${mine.join(',')}`,
        { method: 'DELETE', expect: 'none' },
      );
      context.regions.say(
        'Holds',
        `Released ${mine.map((staffId) => context.state.staff(staffId).name).join(', ')}.`,
      );
    });
  });
  settings.addEventListener('click', () => {
    const chosen = context.selectedStaffIds();
    if (chosen.length !== 1) return;
    openStaffSettingsDialog(
      context.state,
      context.regions,
      context.state.staff(chosen[0]!),
    );
  });

  return el('div', {}, [
    el('h2', {}, ['Holds']),
    el('div', { class: 'actions' }, [hold, release, settings]),
    list,
  ]);
}

export async function requestHolds(context: ToolsContext): Promise<void> {
  const staffIds = context.selectedStaffIds();
  if (staffIds.length === 0) return;
  const names = staffIds.map((staffId) => context.state.staff(staffId).name).join(', ');
  if (context.state.connectionId === null) {
    context.regions.say('Holds', 'Reconnecting \u2014 try the hold again in a moment.');
    return;
  }
  try {
    await request(`/api/scores/${context.state.scoreId}/holds`, {
      method: 'POST',
      body: { staffIds, connectionId: context.state.connectionId },
    });
    context.regions.say('Holds', `Holding ${names}.`);
  } catch (cause) {
    if (cause instanceof RequestFailed && cause.status === 423) {
      const held = (cause.failure.staffIds ?? staffIds)
        .map((staffId) => context.state.staff(staffId).name)
        .join(', ');
      context.regions.say(
        'Holds',
        `${cause.failure.heldBy?.name ?? 'Another collaborator'} is holding ${held}. Your notes still save.`,
      );
      return;
    }
    if (cause instanceof RequestFailed && cause.failure.error === 'not_connected') {
      context.regions.say('Holds', 'Reconnecting \u2014 try the hold again in a moment.');
      return;
    }
    throw cause;
  }
}

export function banksPanel(context: ToolsContext): HTMLElement {
  const panel = el('div', {}, [el('h2', {}, ['Sample banks'])]);
  const list = el('ul', { class: 'tool-list', role: 'list', 'aria-label': 'Sample banks' });
  const paint = (): void => {
    clear(list);
    for (const bank of context.state.banks) {
      list.append(
        el('li', {}, [
          `${bank.fileName} \u00b7 ${context.state.staff(bank.staffId).name} \u00b7 Loaded`,
        ]),
      );
    }
  };
  paint();
  context.state.on('banks', paint);

  if (context.state.me.role === 'composer') {
    const staff = el('select', { 'aria-label': 'Staff for bank' });
    for (const item of context.state.head.staves) {
      staff.append(el('option', { value: item.id }, [item.name]));
    }
    const root = el('input', { type: 'text', value: 'A4', 'aria-label': 'Root pitch' });
    const file = el('input', { type: 'file', id: 'bank-file' });
    const upload = button('Upload sample bank');
    upload.addEventListener('click', () => {
      void whilePending(upload, async () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        const pending = el('li', {}, [
          `${chosen.name} \u00b7 ${context.state.staff(staff.value).name} \u00b7 Uploading\u2026`,
        ]);
        list.prepend(pending);
        context.regions.say('Sample banks', `Uploading ${chosen.name}\u2026`);
        try {
          const search = new URLSearchParams({
            fileName: chosen.name,
            staffId: staff.value,
            root: root.value,
          });
          await request(`/api/scores/${context.state.scoreId}/banks?${search.toString()}`, {
            method: 'POST',
            rawBody: await chosen.arrayBuffer(),
          });
          context.regions.say('Sample banks', `${chosen.name} loaded.`);
        } catch (cause) {
          const message =
            cause instanceof RequestFailed ? cause.failure.message : 'Storage is unavailable.';
          context.regions.say('Sample banks', `${chosen.name} was refused: ${message}`);
        } finally {
          pending.remove();
          await context.state.reloadBanks();
        }
      });
    });
    panel.append(
      el('div', { class: 'field' }, [el('label', { for: staff.id }, ['Staff for bank']), staff]),
      el('div', { class: 'field' }, [el('label', {}, ['Root pitch']), root]),
      el('div', { class: 'field' }, [
        el('label', { for: 'bank-file' }, ['Sample bank file']),
        file,
      ]),
      upload,
    );
  }
  panel.append(list);
  return panel;
}

export function peoplePanel(context: ToolsContext): HTMLElement {
  const panel = el('div', {}, [el('h2', {}, ['People'])]);
  const list = el('ul', { class: 'tool-list', role: 'list', 'aria-label': 'People' });
  const statusWord = (status: string): string =>
    status === 'invited' ? 'Invited' : status === 'active' ? 'Active' : 'Removed';
  const paint = (): void => {
    clear(list);
    for (const person of context.state.collaborators) {
      const item = el('li', {}, [
        `${person.name} \u00b7 ${roleWord(person.role)} \u00b7 ${statusWord(person.status)}`,
      ]);
      if (context.state.me.role === 'composer' && person.role !== 'composer') {
        item.append(
          button(`Change staves for ${person.name}`, {}, () =>
            openStavesDialog(context.state, context.regions, person),
          ),
          button(`Remove ${person.name}`, {}, () =>
            openRemoveDialog(context.state, context.regions, person),
          ),
        );
      }
      list.append(item);
    }
  };
  paint();
  context.state.on('collaborators', paint);
  panel.append(list);
  if (context.state.me.role === 'composer') {
    panel.append(
      button('Invite collaborator', {}, () => openInviteDialog(context.state, context.regions)),
    );
  }
  return panel;
}

export function buildPanel(name: TabName, context: ToolsContext): HTMLElement {
  switch (name) {
    case 'Parts':
      return partsPanel(context);
    case 'History':
      return historyPanel(context);
    case 'Holds':
      return holdsPanel(context);
    case 'Sample banks':
      return banksPanel(context);
    case 'People':
      return peoplePanel(context);
  }
}
