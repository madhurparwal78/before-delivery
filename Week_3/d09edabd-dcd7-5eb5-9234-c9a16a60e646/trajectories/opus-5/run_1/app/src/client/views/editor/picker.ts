import { copy, figures } from '../../../shared/copy.js';
import { button, el, isPhone } from '../../dom.js';
import { appVersion } from '../../version.js';
import { roomCardThumb } from './sheets.js';
import { hooks, setWalkInPreference, state, walkInPreference } from './state.js';

export interface PickerParts {
  header: HTMLElement;
  content: HTMLElement;
  highlight: () => string | null;
  move: (delta: number) => void;
  jump: (index: number) => void;
  openHighlighted: () => void;
  focusHighlighted: () => void;
}

/** The Open a room dialog: cards for the workspace's rooms, alphabetically. */
export function pickerParts(close: () => void): PickerParts {
  const header = el('div', { class: 'sheet-header' }, [
    el('div', {}, [
      el('div', { class: 'wordmark' }, [
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        document.createTextNode(' Keyway'),
        el('span', { text: 'bench' }),
      ]),
      el('div', { class: 'build-line mono', text: `bench ${appVersion}` }),
    ]),
  ]);
  const closeButton = button('Close', {}, [document.createTextNode('✕')]);
  closeButton.addEventListener('click', close);
  header.append(closeButton);

  const backChevron = button('Back', {}, [document.createTextNode('‹')]);
  backChevron.addEventListener('click', close);
  const section = el('div', { class: 'section-row' }, [
    backChevron,
    el('h2', { text: 'Pick a room' }),
  ]);
  const subtitle = el('p', {
    class: 'subtitle',
    text: 'Choose a draft or a starter room. Enter walks you in.',
  });

  const grid = el('ul', { class: 'card-grid', role: 'listbox', 'aria-label': 'Rooms' });
  let active = 0;

  const paint = (): void => {
    grid.replaceChildren();
    state.rooms.forEach((room, index) => {
      const option = el('li', {
        class: 'card',
        role: 'option',
        'aria-label': room.name,
        'aria-selected': index === active ? 'true' : 'false',
        tabindex: index === active ? '0' : '-1',
        'data-room-id': room.id,
      });
      option.append(
        roomCardThumb(room),
        el('div', { class: 'strip' }, [
          el('div', { class: 'name', text: room.name }),
          el('div', { class: 'figures', text: figures.card(room.stats) }),
        ]),
      );
      option.addEventListener('mouseenter', () => {
        active = index;
        mark();
      });
      option.addEventListener('click', () => {
        active = index;
        open();
      });
      grid.append(option);
    });
  };

  const mark = (): void => {
    [...grid.children].forEach((child, index) => {
      child.setAttribute('aria-selected', index === active ? 'true' : 'false');
      child.setAttribute('tabindex', index === active ? '0' : '-1');
    });
  };

  const open = (): void => {
    const room = state.rooms[active];
    if (!room) return;
    void hooks.openRoom(room.id, walkIn.checked);
  };

  const newRoom = el('a', { href: '#', text: 'New room' });
  newRoom.addEventListener('click', (event) => {
    event.preventDefault();
    hooks.openNewRoom(newRoom);
  });

  const walkIn = el('input', {
    type: 'checkbox',
    'aria-label': 'Walk in when I pick a room',
  });
  walkIn.checked = walkInPreference();
  walkIn.addEventListener('change', () => setWalkInPreference(walkIn.checked));

  const libraryLink = el('a', { href: '#', text: 'Prop library' });
  libraryLink.addEventListener('click', (event) => {
    event.preventDefault();
    hooks.openLibrary(libraryLink, false);
  });
  const versionsLink = el('a', { href: '#', text: 'Versions' });
  versionsLink.addEventListener('click', (event) => {
    event.preventDefault();
    const room = state.rooms[active];
    if (room) void hooks.openRoom(room.id, false).then(() => hooks.openVersions(null, false));
  });
  const shortcutsLink = el('a', { href: '#', text: 'Keyboard shortcuts' });
  shortcutsLink.addEventListener('click', (event) => {
    event.preventDefault();
    hooks.openShortcuts(shortcutsLink);
  });

  const footer = el('div', { class: 'picker-footer' }, [
    el('div', { class: 'check-row' }, [
      walkIn,
      el('span', { text: 'Walk in when I pick a room' }),
    ]),
    el('div', { class: 'links' }, [libraryLink, versionsLink, shortcutsLink]),
  ]);

  const content = el('div', {}, [
    section,
    subtitle,
    grid,
    el('p', { class: 'centre-link' }, [newRoom]),
    footer,
  ]);
  if (state.rooms.length === 0) {
    content.append(el('p', { class: 'subtitle', text: copy.emptyRoom }));
  }
  paint();

  return {
    header,
    content,
    highlight: () => state.rooms[active]?.id ?? null,
    move: (delta: number) => {
      if (state.rooms.length === 0) return;
      active = Math.min(Math.max(active + delta, 0), state.rooms.length - 1);
      mark();
      focus();
    },
    jump: (index: number) => {
      if (state.rooms.length === 0) return;
      active = Math.min(Math.max(index, 0), state.rooms.length - 1);
      mark();
      focus();
    },
    openHighlighted: open,
    focusHighlighted: () => focus(),
  };

  function focus(): void {
    const option = grid.children[active];
    if (option instanceof HTMLElement) option.focus();
  }
}

export function pickerColumns(): number {
  return isPhone() ? 2 : 4;
}
