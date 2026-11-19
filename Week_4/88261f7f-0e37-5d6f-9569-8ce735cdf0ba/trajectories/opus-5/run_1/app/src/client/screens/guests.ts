import { notices, pendingTexts } from '../../shared/notices';
import { call } from '../api';
import { loadGuests, render, state } from '../app';
import { openDialogFor } from '../dialog';
import { button, el, labelled, select } from '../dom';
import { regionNames, setMessage, statusRegion } from '../regions';
import { Guest } from '../types';
import { shell } from './shell';

const SEARCH_DELAY_MS = 300;

const MERGE_FIELDS: Array<{ key: keyof Guest; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'company', label: 'Company' },
  { key: 'address', label: 'Address' },
];

function guestOptionLabel(guest: Guest): string {
  return guest.email === '' ? guest.name : `${guest.name} ${guest.email}`;
}

function openMergeGuests(opener: HTMLElement | null): void {
  const options = [
    { value: '', label: 'Choose' },
    ...state.guests.map((guest) => ({ value: guest.id, label: guestOptionLabel(guest) })),
  ];
  const survivor = select('Surviving guest', options, '');
  const merged = select('Merged guest', options, '');
  const conflictHost = el('div');
  const choices = new Map<string, 'survivor' | 'merged'>();
  const confirm = button('Confirm merge', () => void send());

  function review(): void {
    while (conflictHost.firstChild) conflictHost.removeChild(conflictHost.firstChild);
    choices.clear();
    const left = state.guests.find((guest) => guest.id === survivor.value);
    const right = state.guests.find((guest) => guest.id === merged.value);
    if (!left || !right) return;
    const differing = MERGE_FIELDS.filter(
      (field) => String(left[field.key]).trim() !== '' && left[field.key] !== right[field.key],
    );
    const rows = differing.map((field) => {
      const group = el('div', { role: 'radiogroup', 'aria-label': field.label, class: 'radiogroup' });
      const groupName = `merge-${field.key}-${Math.random().toString(36).slice(2)}`;
      for (const side of ['survivor', 'merged'] as const) {
        const value = String(side === 'survivor' ? left[field.key] : right[field.key]);
        const radio = el('input', {
          type: 'radio',
          name: groupName,
          'aria-label': `Keep ${value}`,
          checked: side === 'survivor',
        });
        radio.addEventListener('change', () => choices.set(field.key, side));
        group.append(el('label', { class: 'radio' }, [radio, `Keep ${value}`]));
      }
      choices.set(field.key, 'survivor');
      return el('tr', {}, [
        el('td', {}, [field.label]),
        el('td', {}, [String(left[field.key])]),
        el('td', {}, [String(right[field.key])]),
        el('td', {}, [group]),
      ]);
    });
    conflictHost.append(
      el('table', { 'aria-label': 'Merge conflicts', class: 'grid-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col' }, ['Field']),
            el('th', { scope: 'col' }, ['Surviving']),
            el('th', { scope: 'col' }, ['Merged']),
            el('th', { scope: 'col' }, ['Keep']),
          ]),
        ]),
        el('tbody', {}, rows),
      ]),
    );
  }

  async function send(): Promise<void> {
    if (confirm.getAttribute('aria-busy') === 'true') return;
    confirm.setAttribute('aria-busy', 'true');
    setMessage(regionNames.deskNotices, pendingTexts.merge);
    const body = {
      survivorId: survivor.value,
      mergedId: merged.value,
      choices: Object.fromEntries(choices),
    };
    const result = await call<{ guest: Guest; staysMoved: number }>('/api/guests/merge', {
      method: 'POST',
      body,
    });
    confirm.removeAttribute('aria-busy');
    if (result.data) {
      setMessage(regionNames.deskNotices, notices.guestsMerged(result.data.staysMoved));
      handle.close();
      await loadGuests();
      render();
      return;
    }
    setMessage(
      regionNames.deskNotices,
      result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? 'Not found.',
    );
  }

  const handle = openDialogFor({
    name: 'Merge guests',
    opener,
    className: 'panel wide',
    build: (dialog) => [
      el('h2', { text: 'Merge guests' }),
      labelled('Surviving guest', survivor),
      labelled('Merged guest', merged),
      button('Review merge', () => review()),
      conflictHost,
      el('div', { class: 'actions' }, [confirm, button('Close', () => dialog.close())]),
    ],
  });
}

export function guestsScreen(): HTMLElement {
  const search = el('input', {
    type: 'search',
    'aria-label': 'Search guests',
    value: state.guestSearch,
  });
  let timer = 0;
  search.addEventListener('input', () => {
    state.guestSearch = search.value;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void loadGuests().then(render), SEARCH_DELAY_MS);
  });

  const table = el('table', { 'aria-label': 'Guests', class: 'grid-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Name']),
        el('th', { scope: 'col' }, ['Email']),
        el('th', { scope: 'col' }, ['Phone']),
        el('th', { scope: 'col' }, ['Company']),
        el('th', { scope: 'col' }, ['Address']),
      ]),
    ]),
    el(
      'tbody',
      {},
      state.guests.map((guest) =>
        el('tr', { 'data-guest-id': guest.id }, [
          el('td', {}, [guest.name]),
          el('td', {}, [guest.email]),
          el('td', {}, [guest.phone]),
          el('td', {}, [guest.company]),
          el('td', {}, [guest.address]),
        ]),
      ),
    ),
  ]);

  return shell([], [
    el('div', { class: 'noticeline' }, [statusRegion(regionNames.deskNotices)]),
    el('main', { class: 'twocolumn' }, [
      el('div', { class: 'leftcolumn' }, [
        el('h1', { text: 'Guests' }),
        labelled('Search guests', search),
        button('Merge guests', (event) => openMergeGuests(event.currentTarget as HTMLElement)),
      ]),
      el('div', { class: 'rightcolumn' }, [table]),
    ]),
  ]);
}
