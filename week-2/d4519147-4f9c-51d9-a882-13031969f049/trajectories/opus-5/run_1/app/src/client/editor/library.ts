import { SYSTEM_KINDS, ZONE_KINDS } from '../../shared/kinds';
import { COPY } from '../../shared/copy';
import { ICONS, el, icon } from '../dom';
import type { SystemKindId, ZoneKindId } from '../../shared/types';

export interface LibraryHandlers {
  addShape(kind: SystemKindId): void;
  addZone(kind: ZoneKindId): void;
  canAddZone(): boolean;
  readOnly(): boolean;
}

const KIND_ICONS: Record<SystemKindId, string> = {
  server: ICONS.server,
  database: ICONS.database,
  firewall: ICONS.firewall,
  router: ICONS.router,
  load_balancer: ICONS.balancer,
  web_app: ICONS.web,
  api_service: ICONS.api,
  payment_terminal: ICONS.terminal,
  workstation: ICONS.workstation,
  cloud_service: ICONS.cloud,
  third_party: ICONS.thirdParty,
  backup_storage: ICONS.backup,
};

export interface LibraryView {
  element: HTMLElement;
  sync(): void;
}

/** The shape library: every published system kind and zone kind, filtered by search. */
export function createLibrary(handlers: LibraryHandlers, variant: 'rail' | 'sheet'): LibraryView {
  const search = el('input', {
    type: 'search',
    role: 'searchbox',
    'aria-label': 'Search shapes',
    placeholder: 'Search shapes',
  });
  const grid = el('div', { class: 'library-grid' });
  const empty = el('p', { text: COPY.emptyLibrarySearch, hidden: 'hidden' });

  const buttons: Array<{ node: HTMLButtonElement; name: string; zone: boolean }> = [];
  for (const kind of SYSTEM_KINDS) {
    const node = el('button', { type: 'button', 'data-kind': kind.id }, [
      icon(KIND_ICONS[kind.id]),
      el('span', { text: `Add ${kind.name}` }),
    ]);
    node.setAttribute('aria-label', `Add ${kind.name}`);
    node.draggable = true;
    node.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/x-scopewright-kind', `shape:${kind.id}`);
    });
    node.addEventListener('click', () => handlers.addShape(kind.id));
    buttons.push({ node, name: kind.name, zone: false });
  }
  for (const kind of ZONE_KINDS) {
    const node = el('button', { type: 'button', 'data-zone-kind': kind.id }, [
      icon(ICONS.zone),
      el('span', { text: `Add ${kind.name} zone` }),
    ]);
    node.setAttribute('aria-label', `Add ${kind.name} zone`);
    node.draggable = true;
    node.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/x-scopewright-kind', `zone:${kind.id}`);
    });
    node.addEventListener('click', () => handlers.addZone(kind.id));
    buttons.push({ node, name: kind.name, zone: true });
  }

  const applyFilter = (): void => {
    const term = search.value.trim().toLowerCase();
    let visible = 0;
    for (const entry of buttons) {
      const matches = term.length === 0 || entry.name.toLowerCase().includes(term);
      if (matches) visible += 1;
      entry.node.hidden = !matches;
    }
    empty.hidden = visible > 0;
  };
  search.addEventListener('input', applyFilter);

  grid.append(...buttons.map((entry) => entry.node));
  const heading = el('h2', { text: 'Shape library' });
  const children: HTMLElement[] = [heading, search, grid, empty];

  let element: HTMLElement;
  if (variant === 'rail') {
    element = el('aside', { class: 'library rail', role: 'complementary', 'aria-label': 'Shape library' }, children);
  } else {
    element = el('div', {}, children);
  }

  const sync = (): void => {
    const readOnly = handlers.readOnly();
    const canAddZone = handlers.canAddZone();
    for (const entry of buttons) {
      entry.node.disabled = readOnly || (entry.zone && !canAddZone);
    }
    applyFilter();
  };
  sync();
  return { element, sync };
}
