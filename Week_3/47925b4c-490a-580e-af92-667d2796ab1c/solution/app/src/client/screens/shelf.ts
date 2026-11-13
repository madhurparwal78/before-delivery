import { ApiProblem, call, newKey } from '../api.js';
import { append, button, clear, combobox, el, field, showFieldError, textbox } from '../dom.js';
import { listen } from '../events.js';
import { clearBand, heading, navigation, showBand } from '../shell.js';
import { bodyCrop } from '../wall.js';
import type { SiteSummary } from './walls.js';

interface ShelfItem {
  readonly serial: string;
  readonly kind: string;
  readonly model: string;
  readonly location: string;
  readonly free: boolean;
  readonly loggedHours: string;
  readonly effectiveLumens: number | null;
}

interface Shelf {
  readonly models: readonly { model: string; free: number; atShelf: number; onSite: number }[];
  readonly freeBodies: number;
  readonly items: readonly ShelfItem[];
}

interface Movement {
  readonly id: string;
  readonly kind: string;
  readonly serial: string;
  readonly at: string;
  readonly reversesId: string | null;
  readonly entries: readonly { location: string; delta: number }[];
}

const MOVEMENTS: { value: string; label: string }[] = [
  { value: 'bought', label: 'Bought' },
  { value: 'sent_to_site', label: 'Sent to site' },
  { value: 'returned', label: 'Returned' },
  { value: 'retired', label: 'Retired' },
];

export async function renderShelf(screen: HTMLElement, chrome: HTMLElement): Promise<() => void> {
  clear(chrome);
  chrome.appendChild(navigation('/kit'));

  const sites = (await call<{ items: SiteSummary[] }>('/api/sites')).items;
  const kitStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Kit' });
  const historyBody = el('tbody');
  let cursor: string | null = null;

  const kind = combobox('Movement', MOVEMENTS);
  const serial = textbox('Serial');
  const model = textbox('Model');
  const startingHours = textbox('Starting hours');
  const destination = combobox(
    'Destination site',
    sites.map((site) => ({ value: site.id, label: site.name })),
  );
  const hoursSerial = combobox('Body serial', []);
  const showHours = textbox('Show hours');

  const record = async (): Promise<void> => {
    clearBand();
    showFieldError('movement/serial', null);
    const body: Record<string, unknown> = { kind: kind.value, serial: serial.value };
    if (kind.value === 'bought') {
      body['model'] = model.value;
      if (startingHours.value !== '') body['loggedHours'] = startingHours.value;
    }
    if (kind.value === 'sent_to_site') body['siteId'] = destination.value;
    try {
      await call('/api/kit/movements', { method: 'POST', key: newKey(), body });
      kitStatus.textContent = 'Movement recorded.';
      serial.value = '';
      await draw();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      const errors = error.body.errors ?? {};
      for (const [pointer, copy] of Object.entries(errors)) showFieldError(`movement${pointer}`, copy);
      if (error.body.errors === undefined) showBand(error.body.detail);
    }
  };

  const logHours = async (): Promise<void> => {
    clearBand();
    showFieldError('hours/hours', null);
    try {
      await call(`/api/kit/bodies/${hoursSerial.value}/hours`, {
        method: 'POST',
        key: newKey(),
        body: { hours: showHours.value },
      });
      showHours.value = '';
      await draw();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      const copy = (error.body.errors ?? {})['/hours'];
      if (copy !== undefined) showFieldError('hours/hours', copy);
      else showBand(error.body.detail);
    }
  };

  const reverse = async (movementId: string): Promise<void> => {
    clearBand();
    try {
      await call(`/api/kit/movements/${movementId}/reverse`, { method: 'POST', key: newKey(), body: {} });
      kitStatus.textContent = 'Movement recorded.';
      await draw();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
  };

  const movementRow = (movement: Movement): HTMLElement =>
    el('tr', {}, [
      el('td', { text: movement.serial }),
      el('td', { text: movement.kind }),
      el('td', {
        text: movement.entries
          .slice()
          .sort((left, right) => left.delta - right.delta)
          .map((entry) => `${entry.location} ${entry.delta > 0 ? '+1' : '-1'}`)
          .join(' to '),
      }),
      el('td', { text: movement.at }),
      el('td', {}, [button(`Reverse ${movement.id}`, () => void reverse(movement.id), { text: `Reverse ${movement.id.slice(0, 8)}` })]),
    ]);

  const loadHistory = async (append_: boolean): Promise<void> => {
    const page = await call<{ items: Movement[]; nextCursor: string | null }>(
      `/api/kit/movements?limit=20${append_ && cursor !== null ? `&after=${encodeURIComponent(cursor)}` : ''}`,
    );
    if (!append_) clear(historyBody);
    append(historyBody, page.items.map(movementRow));
    cursor = page.nextCursor;
    older.disabled = cursor === null;
  };

  const older = el('button', {
    type: 'button',
    'aria-label': 'Older movements',
    text: 'Older movements',
    onclick: () => void loadHistory(true),
  });

  const kitBody = el('tbody');
  const freeList = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Free bodies' });
  const sentenceHost = el('div');

  const draw = async (): Promise<void> => {
    const shelf = await call<Shelf>('/api/kit/shelf');
    clear(sentenceHost);
    sentenceHost.appendChild(
      heading({
        sentence:
          `THE SHELF HOLDS ${shelf.freeBodies} FREE ${shelf.freeBodies === 1 ? 'BODY' : 'BODIES'}`,
        slot: bodyCrop(),
      }),
    );
    clear(kitBody);
    append(
      kitBody,
      shelf.items.map((item) =>
        el('tr', {}, [
          el('td', { text: item.serial }),
          el('td', { text: item.model }),
          el('td', { text: item.location }),
          el('td', { text: item.free ? 'Free' : 'Bound' }),
          el('td', { text: Number(item.loggedHours).toFixed(1) }),
          el('td', { text: item.effectiveLumens === null ? '' : String(item.effectiveLumens) }),
        ]),
      ),
    );
    clear(freeList);
    append(
      freeList,
      shelf.models.map((model_) => el('li', {}, [el('span', { text: `${model_.model} ${model_.free} free` })])),
    );
    clear(hoursSerial);
    append(
      hoursSerial,
      shelf.items
        .filter((item) => item.kind === 'body')
        .map((item) => el('option', { value: item.serial, text: item.serial })),
    );
    cursor = null;
    await loadHistory(false);
  };

  // The first read lands before the screen is mounted, so the sentence is never pushed in above what is on show.
  let failure: unknown = null;
  await draw().catch((error: unknown) => {
    failure = error;
  });
  clear(screen);
  append(screen, [
    sentenceHost,
    el('div', { class: 'columns' }, [
      el('div', { class: 'lede' }, [
        el('form', { 'aria-label': 'Record a movement', onsubmit: (event: Event) => event.preventDefault() }, [
          el('label', {}, ['Movement', kind]),
          field('Serial', serial, 'movement/serial'),
          el('label', {}, ['Model', model]),
          el('label', {}, ['Starting hours', startingHours]),
          el('label', {}, ['Destination site', destination]),
          button('Record movement', () => void record()),
        ]),
        kitStatus,
        el('form', { 'aria-label': 'Log show hours', onsubmit: (event: Event) => event.preventDefault() }, [
          el('label', {}, ['Body serial', hoursSerial]),
          field('Show hours', showHours, 'hours/hours'),
          button('Log hours', () => void logHours()),
        ]),
        freeList,
      ]),
      el('div', { class: 'evidence' }, [
        el('table', { 'aria-label': 'Kit' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Serial' }),
              el('th', { scope: 'col', text: 'Model' }),
              el('th', { scope: 'col', text: 'Location' }),
              el('th', { scope: 'col', text: 'Free' }),
              el('th', { scope: 'col', text: 'Hours' }),
              el('th', { scope: 'col', text: 'Effective lumens' }),
            ]),
          ]),
          kitBody,
        ]),
        el('table', { 'aria-label': 'Movement history' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Serial' }),
              el('th', { scope: 'col', text: 'Movement' }),
              el('th', { scope: 'col', text: 'Entries' }),
              el('th', { scope: 'col', text: 'At' }),
              el('th', { scope: 'col', text: 'Correction' }),
            ]),
          ]),
          historyBody,
        ]),
        older,
      ]),
    ]),
  ]);

  if (failure !== null) throw failure;
  return listen('/api/events', (event) => {
    if (event.type === 'kit.moved' || event.type === 'sheet.changed') void draw();
  });
}
