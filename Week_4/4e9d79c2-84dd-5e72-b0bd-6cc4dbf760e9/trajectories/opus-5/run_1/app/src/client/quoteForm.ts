import { MEDIUM, all, announce, api, clearProblems, ddmmyyyyToIso, one, pageData, play, showProblems, whileWorking } from './dom.js';
import { closeDialog, dialogIsOpen, openDialog } from './dialogs.js';
import { startComboboxes } from './combobox.js';

type Draft = Record<string, string>;

type QuoteData = {
  step: 'route' | 'when' | 'details' | 'thanks';
  occasion: string | null;
  today: string;
  tomorrow: string;
  hoursToday: string[];
  clockChanges: { forward: string | null; back: string | null };
};

const DRAFT_KEY = 'wayticket-quote-draft';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function readDraft(): Draft {
  try {
    return JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Draft;
  } catch {
    return {};
  }
}

function writeDraft(draft: Draft): void {
  window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function ukDateLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`;
}

const JOURNEY_LABELS: Record<string, string> = {
  oneWay: 'One way',
  return: 'Return',
  sameDayReturn: 'Same day return',
  severalStops: 'Several stops',
};

const OCCASION_LABELS: Record<string, string> = {
  school: 'School',
  weddings: 'Weddings',
  company: 'Company',
  festivals: 'Festivals and sport',
};

function stopsOf(draft: Draft): string[] {
  const stops: string[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const value = draft[`stop${index}`];
    if (value && value.trim() !== '') stops.push(value.trim());
  }
  return stops;
}

type Line = { key: string; value: string | null; shown: boolean };

function lineValues(draft: Draft): Line[] {
  const journey = draft.journeyType ?? 'oneWay';
  const showsReturn = journey === 'return' || journey === 'sameDayReturn';
  const stops = stopsOf(draft);
  const whenLabel = (prefix: string): string | null => {
    const date = draft[`${prefix}Date`];
    const hour = draft[`${prefix}Hour`];
    const minutes = draft[`${prefix}Minutes`];
    if (!date || !hour || !minutes) return null;
    const iso = ddmmyyyyToIso(date);
    if (!iso) return null;
    const repeated = draft[`${prefix}RepeatedHour`];
    const suffix = repeated === 'second' ? ' (GMT)' : repeated === 'first' ? ' (BST)' : '';
    return `${ukDateLabel(iso)}, ${hour}:${minutes}${suffix}`;
  };
  const bagsTouched = ['large', 'medium', 'hand'].some((key) => draft[`${key}Touched`] === 'true');
  const people = draft.people ? Number(draft.people) : null;
  return [
    { key: 'occasion', value: draft.occasion ? (OCCASION_LABELS[draft.occasion] ?? null) : null, shown: true },
    { key: 'journey', value: JOURNEY_LABELS[journey], shown: true },
    { key: 'from', value: draft.from && draft.from.trim() !== '' ? draft.from.trim() : null, shown: true },
    { key: 'to', value: draft.to && draft.to.trim() !== '' ? draft.to.trim() : null, shown: true },
    { key: 'stops', value: stops.length > 0 ? stops.join('; ') : null, shown: stops.length > 0 },
    {
      key: 'details',
      value: draft.stopDetails && draft.stopDetails.trim() !== '' ? draft.stopDetails : null,
      shown: journey === 'severalStops',
    },
    { key: 'out', value: whenLabel('out'), shown: true },
    { key: 'return', value: whenLabel('return'), shown: showsReturn },
    {
      key: 'people',
      value: people && people > 0 ? `${people} ${people === 1 ? 'person' : 'people'}` : null,
      shown: true,
    },
    {
      key: 'bags',
      value: bagsTouched
        ? `${draft.large ?? '0'} large, ${draft.medium ?? '0'} medium, ${draft.hand ?? '0'} hand`
        : null,
      shown: true,
    },
    {
      key: 'wheelchairs',
      value: draft.wheelchairsTouched === 'true' ? (draft.wheelchairs ?? '0') : null,
      shown: true,
    },
    { key: 'name', value: draft.name && draft.name.trim() !== '' ? draft.name.trim() : null, shown: true },
    { key: 'email', value: draft.email && draft.email.trim() !== '' ? draft.email.trim() : null, shown: true },
    {
      key: 'telephone',
      value: draft.telephone && draft.telephone.trim() !== '' ? draft.telephone.trim() : null,
      shown: true,
    },
  ];
}

function answeredCount(draft: Draft): number {
  return lineValues(draft).filter((line) => line.shown && line.value !== null).length;
}

function ticketHolders(): HTMLElement[] {
  const holders: HTMLElement[] = [];
  const side = one<HTMLElement>('[data-part="ticket"]');
  if (side) holders.push(side);
  const sheet = one<HTMLElement>('[data-dialog="journey-ticket"]');
  if (sheet) holders.push(sheet);
  return holders;
}

function paintTicket(draft: Draft): void {
  const lines = lineValues(draft);
  for (const holder of ticketHolders()) {
    for (const line of lines) {
      const row = one<HTMLElement>(`[data-line="${line.key}"]`, holder);
      if (!row) continue;
      if (!line.shown) {
        row.setAttribute('hidden', '');
      } else {
        row.removeAttribute('hidden');
      }
      const value = one<HTMLElement>('.ticket-value', row);
      if (value) value.textContent = line.value ?? 'Not yet given';
    }
  }
  const button = one<HTMLElement>('.ticket-open');
  if (button) button.textContent = `Journey ticket, ${answeredCount(draft)} answered`;
}

const flights = new Map<string, { element: HTMLElement; animation: Animation | null }>();

/** The answered value lifts from its field and travels as one element to its ticket line. */
function flyToLine(key: string, value: string, from: HTMLElement): void {
  const sheetOpen = dialogIsOpen('journey-ticket');
  const wide = window.innerWidth >= 1024;
  const target = sheetOpen
    ? one<HTMLElement>(`[data-dialog="journey-ticket"] [data-line="${key}"] .ticket-value`)
    : wide
      ? one<HTMLElement>(`[data-part="ticket"] [data-line="${key}"] .ticket-value`)
      : one<HTMLElement>('.ticket-open');
  if (!target) return;
  const held = flights.get(key);
  if (held) {
    held.element.textContent = value;
    return;
  }
  const start = from.getBoundingClientRect();
  const end = target.getBoundingClientRect();
  const flying = document.createElement('span');
  flying.className = 'ticket-flight';
  flying.dataset.part = 'ticket-flight';
  flying.textContent = value;
  flying.style.position = 'fixed';
  flying.style.left = `${start.left}px`;
  flying.style.top = `${start.top}px`;
  document.body.append(flying);
  const animation = play(
    flying,
    [
      { transform: 'translate(0, 0)', opacity: 1 },
      { transform: `translate(${end.left - start.left}px, ${end.top - start.top}px)`, opacity: 0.2 },
    ],
    MEDIUM,
  );
  flights.set(key, { element: flying, animation });
  const finish = (): void => {
    flying.remove();
    flights.delete(key);
  };
  if (animation) {
    animation.finished.then(finish).catch(finish);
  } else {
    finish();
  }
}

function fieldKeyOf(input: HTMLElement): string | null {
  const id = input.id;
  const map: Record<string, string> = {
    from: 'from',
    to: 'to',
    'stop-details': 'details',
    'out-date': 'out',
    'out-hour': 'out',
    'out-minutes': 'out',
    'return-date': 'return',
    'return-hour': 'return',
    'return-minutes': 'return',
    people: 'people',
    large: 'bags',
    medium: 'bags',
    hand: 'bags',
    wheelchairs: 'wheelchairs',
    name: 'name',
    email: 'email',
    telephone: 'telephone',
  };
  if (map[id]) return map[id];
  if (/^stop-\d+$/.test(id)) return 'stops';
  return null;
}

function draftKeyOf(input: HTMLElement): string | null {
  const names: Record<string, string> = {
    from: 'from',
    to: 'to',
    'stop-details': 'stopDetails',
    'out-date': 'outDate',
    'out-hour': 'outHour',
    'out-minutes': 'outMinutes',
    'return-date': 'returnDate',
    'return-hour': 'returnHour',
    'return-minutes': 'returnMinutes',
    people: 'people',
    large: 'large',
    medium: 'medium',
    hand: 'hand',
    wheelchairs: 'wheelchairs',
    name: 'name',
    email: 'email',
    telephone: 'telephone',
    language: 'language',
    website: 'website',
  };
  if (names[input.id]) return names[input.id];
  const stop = /^stop-(\d+)$/.exec(input.id);
  if (stop) return `stop${stop[1]}`;
  return null;
}

function restore(draft: Draft): void {
  for (const input of all<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) {
    const key = draftKeyOf(input);
    if (!key) continue;
    const value = draft[key];
    if (value !== undefined) input.value = value;
  }
  const journey = draft.journeyType ?? 'oneWay';
  for (const radio of all<HTMLInputElement>('input[name="journeyType"]')) {
    radio.checked = radio.value === journey;
  }
  if (draft.occasion) {
    for (const radio of all<HTMLInputElement>('input[name="occasion"]')) {
      radio.checked = radio.value === draft.occasion;
    }
  }
  showJourneyFields(journey);
}

function showJourneyFields(journey: string): void {
  const returnFields = one<HTMLElement>('[data-return-fields]');
  if (returnFields) {
    if (journey === 'return' || journey === 'sameDayReturn') {
      returnFields.removeAttribute('hidden');
    } else {
      returnFields.setAttribute('hidden', '');
    }
  }
  const details = one<HTMLElement>('[data-stop-details]');
  if (details) {
    if (journey === 'severalStops') {
      details.removeAttribute('hidden');
    } else {
      details.setAttribute('hidden', '');
    }
  }
}

function addStopField(draft: Draft): void {
  const holder = one<HTMLElement>('[data-stops]');
  if (!holder) return;
  const count = all('[data-stop-row]', holder).length;
  if (count >= 5) return;
  const index = count + 1;
  const row = document.createElement('div');
  row.dataset.stopRow = String(index);
  row.innerHTML = `<div class="field underline-field combobox" data-combobox>
  <label for="stop-${index}">Stop ${index}</label>
  <input id="stop-${index}" type="text" role="combobox" aria-expanded="false" aria-autocomplete="list"
    aria-controls="stop-${index}-list" autocomplete="street-address">
  <ul class="combobox-list" id="stop-${index}-list" role="listbox" aria-label="Stop ${index}" hidden></ul>
</div>
<button type="button" data-remove-stop="${index}">Remove stop</button>`;
  holder.append(row);
  startComboboxes(row);
  one<HTMLInputElement>(`#stop-${index}`)?.focus();
  paintTicket(draft);
}

async function goToStep(step: string, direction: 'forward' | 'back'): Promise<void> {
  const answer = await fetch(`/quote/${step}`, { headers: { 'x-wayticket-refresh': '1' } });
  const text = await answer.text();
  const fresh = new DOMParser().parseFromString(text, 'text/html');
  const main = document.getElementById('main');
  const freshMain = fresh.getElementById('main');
  if (!main || !freshMain) {
    window.location.assign(`/quote/${step}`);
    return;
  }
  main.innerHTML = freshMain.innerHTML;
  document.title = fresh.title;
  window.history.pushState({ step }, '', `/quote/${step}`);
  play(
    main,
    [
      { transform: direction === 'forward' ? 'translateX(40px)' : 'translateX(-40px)', opacity: 0 },
      { transform: 'translateX(0)', opacity: 1 },
    ],
    MEDIUM,
  );
  startQuoteStep();
  one<HTMLElement>('h1')?.focus();
}

function bodyFromDraft(draft: Draft): Record<string, unknown> {
  const journey = draft.journeyType ?? 'oneWay';
  const stops = [
    { text: (draft.from ?? '').trim(), checked: draft.fromChecked === 'true' },
    ...stopsOf(draft).map((text) => ({ text, checked: false })),
    { text: (draft.to ?? '').trim(), checked: draft.toChecked === 'true' },
  ];
  const localOf = (prefix: string): Record<string, unknown> | null => {
    const iso = ddmmyyyyToIso(draft[`${prefix}Date`] ?? '');
    const hour = draft[`${prefix}Hour`];
    const minutes = draft[`${prefix}Minutes`];
    if (!iso || !hour || !minutes) return null;
    const repeated = draft[`${prefix}RepeatedHour`];
    return { date: iso, time: `${hour}:${minutes}`, ...(repeated ? { repeatedHour: repeated } : {}) };
  };
  return {
    occasion: draft.occasion ?? null,
    journeyType: journey,
    stops,
    departAt: localOf('out'),
    returnAt: journey === 'return' || journey === 'sameDayReturn' ? localOf('return') : null,
    party: {
      people: draft.people ? Number(draft.people) : 0,
      large: Number(draft.large ?? 0),
      medium: Number(draft.medium ?? 0),
      hand: Number(draft.hand ?? 0),
      wheelchairs: Number(draft.wheelchairs ?? 0),
    },
    details: draft.stopDetails ?? null,
    name: draft.name ?? '',
    email: draft.email ?? '',
    telephone: draft.telephone ?? '',
    language: draft.language ?? 'en',
    website: draft.website ?? '',
  };
}

export function startQuoteStep(): void {
  const data = pageData<QuoteData>();
  const draft = readDraft();
  if (data.occasion && !draft.occasion) draft.occasion = data.occasion;
  if (!draft.journeyType) draft.journeyType = 'oneWay';
  writeDraft(draft);
  startComboboxes();
  restore(draft);
  paintTicket(draft);

  const held = readDraft();
  const stopsNeeded = Object.keys(held).filter((key) => /^stop\d+$/.test(key)).length;
  for (let index = 0; index < stopsNeeded; index += 1) addStopField(held);
  restore(held);
  paintTicket(held);
}

export function startQuoteForm(): void {
  const data = pageData<QuoteData>();
  if (data.step === 'thanks') {
    const reference = window.sessionStorage.getItem('wayticket-reference');
    const line = one<HTMLElement>('[data-part="reference"]');
    if (line && reference) {
      line.textContent = `Request sent. Your reference is ${reference}.`;
      announce(`Request sent. Your reference is ${reference}.`);
    }
    return;
  }
  startQuoteStep();

  document.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const draft = readDraft();
    if (target instanceof HTMLInputElement && target.name === 'occasion') {
      draft.occasion = target.value;
      writeDraft(draft);
      paintTicket(draft);
      flyToLine('occasion', OCCASION_LABELS[target.value] ?? target.value, target);
      return;
    }
    if (target instanceof HTMLInputElement && target.name === 'journeyType') {
      draft.journeyType = target.value;
      writeDraft(draft);
      showJourneyFields(target.value);
      paintTicket(draft);
      flyToLine('journey', JOURNEY_LABELS[target.value] ?? target.value, target);
      return;
    }
    const key = draftKeyOf(target);
    if (!key) return;
    const input = target as HTMLInputElement;
    draft[key] = input.value;
    if (['large', 'medium', 'hand'].includes(input.id)) draft[`${input.id}Touched`] = 'true';
    if (input.id === 'wheelchairs') draft.wheelchairsTouched = 'true';
    if (input.id === 'from') draft.fromChecked = input.dataset.checked === 'true' ? 'true' : 'false';
    if (input.id === 'to') draft.toChecked = input.dataset.checked === 'true' ? 'true' : 'false';
    if (draft.journeyType === 'sameDayReturn' && input.id === 'out-date') {
      draft.returnDate = input.value;
      const returnDate = one<HTMLInputElement>('#return-date');
      if (returnDate) returnDate.value = input.value;
    }
    writeDraft(draft);
    const lineKey = fieldKeyOf(target);
    const lines = lineValues(draft);
    const line = lines.find((row) => row.key === lineKey);
    paintTicket(draft);
    if (line?.value) flyToLine(line.key, line.value, target);
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('[data-add-stop]')) {
      addStopField(readDraft());
      return;
    }
    const remove = target.closest<HTMLElement>('[data-remove-stop]');
    if (remove) {
      const index = remove.getAttribute('data-remove-stop');
      const draft = readDraft();
      delete draft[`stop${index}`];
      writeDraft(draft);
      remove.closest('[data-stop-row]')?.remove();
      const next = one<HTMLElement>('[data-remove-stop]') ?? one<HTMLElement>('[data-add-stop]');
      next?.focus();
      paintTicket(draft);
      return;
    }
    const shortcut = target.closest<HTMLElement>('[data-date-shortcut]');
    if (shortcut) {
      const draft = readDraft();
      const which = shortcut.getAttribute('data-date-shortcut');
      const iso = which === 'today' ? data.today : data.tomorrow;
      const [year, month, day] = iso.split('-');
      const typed = `${day}/${month}/${year}`;
      const input = one<HTMLInputElement>('#out-date');
      if (input) {
        input.value = typed;
        draft.outDate = typed;
        writeDraft(draft);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      for (const button of all<HTMLElement>('[data-date-shortcut]')) {
        button.setAttribute('aria-pressed', String(button === shortcut));
      }
      return;
    }
    if (target.closest('[data-back]')) {
      const step = data.step === 'details' ? 'when' : 'route';
      void goToStep(step, 'back');
      return;
    }
    if (target.closest('[data-next]')) {
      const step = data.step === 'route' ? 'when' : 'details';
      void goToStep(step, 'forward');
      return;
    }
    const send = target.closest<HTMLElement>('[data-send]');
    if (send) {
      event.preventDefault();
      void whileWorking(send, async () => {
        clearProblems();
        const answer = await api<{ reference: string }>('/api/public/enquiries', {
          method: 'POST',
          body: bodyFromDraft(readDraft()),
        });
        if (!answer.ok) {
          showProblems(document, answer.body.error.fields ?? {}, answer.body.error.message);
          announce(answer.body.error.message);
          return;
        }
        window.sessionStorage.setItem('wayticket-reference', answer.body.reference);
        window.sessionStorage.removeItem(DRAFT_KEY);
        window.location.assign('/quote/thanks');
      });
    }
  });

  document.addEventListener('submit', (event) => {
    event.preventDefault();
  });

  window.addEventListener('popstate', () => {
    window.location.reload();
  });
}

export { openDialog, closeDialog };
