import type {
  AcceptedStatus,
  BerthCell,
  BerthPreference,
  ClassEntry,
  QuotaCode,
  TrainEntry,
  TravelClass,
} from '../api';
import { ApiRequestError, api, newIdempotencyKey } from '../api';
import { clearDraft, readDraft, writeDraft } from '../app-state';
import { CoachPlanView, berthKey } from '../coachplan';
import type { BerthAnnotation } from '../coachplan';
import { LiveRegion, Modal, ribbonStopsFromTrain } from '../components';
import { clear, h, isPhoneWidth } from '../dom';
import { QUOTA_LABEL, formatMoney, hourMinute, longDate } from '../format';
import { SESSION_ENDED_KEY } from '../next-path';
import type { Screen, ScreenContext } from '../screen';

export const BOOKING_RESULT_KEY = 'pakka.booking-result';

const GENDERS = [['M', 'Male'], ['F', 'Female'], ['T', 'Transgender']] as const;
const PREFERENCES: readonly (readonly [BerthPreference, string])[] = [
  ['NONE', 'No preference'],
  ['LB', 'Lower'],
  ['MB', 'Middle'],
  ['UB', 'Upper'],
  ['SL', 'Side lower'],
  ['SU', 'Side upper'],
];

interface PassengerDraft {
  name: string;
  age: string;
  gender: 'M' | 'F' | 'T';
  berth_preference: BerthPreference;
  pickedCoach: string | null;
  pickedBerth: number | null;
}

interface BookingDraft {
  passengers: PassengerDraft[];
  keepInOneCoach: boolean;
  lowerBerthOnly: boolean;
  contactPhone: string;
}

function emptyPassenger(): PassengerDraft {
  return {
    name: '',
    age: '',
    gender: 'M',
    berth_preference: 'NONE',
    pickedCoach: null,
    pickedBerth: null,
  };
}

function addDays(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00+05:30`) + days * 86_400_000 + 330 * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** The best status the fare panel's availability label offers the whole party. */
export function acceptedStatus(entry: ClassEntry | null, partySize: number): AcceptedStatus {
  if (entry === null) return 'WL';
  if (entry.quota === 'LD' || entry.quota === 'SS') return 'CNF';
  if (entry.avl >= partySize) return 'CNF';
  if (entry.quota === 'GN' && entry.avl + (entry.rac ?? 0) >= partySize) return 'RAC';
  return 'WL';
}

export async function renderBooking(context: ScreenContext): Promise<Screen> {
  const { main, router, url, state } = context;
  const path = `${url.pathname}${url.search}`;
  if (state.account === null) {
    router.go(`/signin?next=${encodeURIComponent(path)}`, true);
    return { ribbon: [] };
  }

  const trainNumber = url.searchParams.get('train') ?? '';
  const runDate = url.searchParams.get('run_date') ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const travelClass = (url.searchParams.get('class') ?? 'SL') as TravelClass;
  const quota = (url.searchParams.get('quota') ?? 'GN') as QuotaCode;

  const draft: BookingDraft = readDraft<BookingDraft>(path) ?? {
    passengers: [emptyPassenger()],
    keepInOneCoach: false,
    lowerBerthOnly: false,
    contactPhone: state.account.phone,
  };

  let train: TrainEntry | null = null;
  let classEntry: ClassEntry | null = null;
  let choosingFor = 1;
  let fareTotal = 0;
  let fareTimer = 0;
  let payDialog: Modal | null = null;
  let acceptOverride: AcceptedStatus | null = null;
  const cellsByCoach = new Map<string, readonly BerthCell[]>();

  const fareLines = h('ul', { class: 'fare-lines plain-list', 'aria-label': 'Fare lines' });
  const fareTotalRegion = new LiveRegion('Fare total', 'status', 'fare-total');
  const fareAvailability = new LiveRegion('Fare availability', 'status');
  const bookingResult = new LiveRegion('Booking result', 'status');
  const formProblems = new LiveRegion('Form problems', 'alert', 'alert');
  const bookingProblem = new LiveRegion('Booking problem', 'alert', 'alert');
  const problemActions = h('div', { class: 'card-actions' });
  const passengerHost = h('div', { class: 'stack' });
  const choosingHost = h('fieldset', { role: 'radiogroup', 'aria-label': 'Choosing for' });
  const reviewButton = h('button', { type: 'button', class: 'btn' }, ['Review and pay']);

  const planView = new CoachPlanView({
    vertical: isPhoneWidth(),
    annotations: new Map(),
    onPick: pickBerth,
    note: true,
  });

  function save(): void {
    writeDraft(path, draft);
  }

  function partySize(): number {
    return draft.passengers.filter((passenger) => Number(passenger.age) >= 5).length;
  }

  function annotations(): Map<string, BerthAnnotation> {
    const tags = new Map<string, string[]>();
    draft.passengers.forEach((passenger, index) => {
      if (passenger.pickedCoach === null || passenger.pickedBerth === null) return;
      const key = berthKey(passenger.pickedCoach, passenger.pickedBerth);
      tags.set(key, [...(tags.get(key) ?? []), `preferred by passenger ${index + 1}`]);
    });
    const map = new Map<string, BerthAnnotation>();
    for (const [key, list] of tags) map.set(key, { tags: list, hold: null });
    return map;
  }

  function refreshPlan(): void {
    planView.setOptions({
      vertical: isPhoneWidth(),
      annotations: annotations(),
      onPick: pickBerth,
      note: true,
    });
  }

  function pickBerth(coach: string, cell: BerthCell): void {
    const passenger = draft.passengers[choosingFor - 1];
    if (passenger === undefined) return;
    passenger.berth_preference = cell.type;
    passenger.pickedCoach = coach;
    passenger.pickedBerth = cell.berth;
    save();
    clearProblem();
    paintPassengers();
    refreshPlan();
    planView.element
      .querySelector<HTMLButtonElement>(`button[data-coach="${coach}"][data-berth="${cell.berth}"]`)
      ?.focus();
  }

  function clearProblem(): void {
    bookingProblem.say('');
    clear(problemActions);
    acceptOverride = null;
  }

  function paintChoosing(): void {
    clear(choosingHost);
    choosingHost.appendChild(h('legend', {}, ['Choosing for']));
    const row = h('div', { class: 'radio-row' });
    draft.passengers.forEach((_passenger, index) => {
      const id = `choosing-${index + 1}`;
      const input = h('input', {
        type: 'radio',
        name: 'choosing-for',
        id,
        checked: choosingFor === index + 1,
      });
      input.addEventListener('change', () => {
        choosingFor = index + 1;
      });
      row.appendChild(h('span', { class: 'radio' }, [
        input,
        h('label', { for: id }, [`Passenger ${index + 1}`]),
      ]));
    });
    choosingHost.appendChild(row);
  }

  function paintPassengers(): void {
    clear(passengerHost);
    draft.passengers.forEach((passenger, index) => {
      const number = index + 1;
      const ids = {
        name: `p${number}-name`,
        age: `p${number}-age`,
        gender: `p${number}-gender`,
        berth_preference: `p${number}-berth_preference`,
      };
      const name = h('input', { type: 'text', id: ids.name, value: passenger.name });
      name.addEventListener('input', () => {
        passenger.name = name.value;
        save();
        clearProblem();
      });
      const age = h('input', {
        type: 'number',
        id: ids.age,
        min: '0',
        max: '125',
        value: passenger.age,
      });
      age.addEventListener('input', () => {
        passenger.age = age.value;
        save();
        clearProblem();
        scheduleFare();
      });
      const gender = h('select', { id: ids.gender }, GENDERS.map(([value, label]) =>
        h('option', { value, selected: passenger.gender === value }, [label])));
      gender.addEventListener('change', () => {
        passenger.gender = gender.value as 'M' | 'F' | 'T';
        save();
        clearProblem();
      });
      const preference = h('select', { id: ids.berth_preference }, PREFERENCES.map(
        ([value, label]) =>
          h('option', { value, selected: passenger.berth_preference === value }, [label]),
      ));
      preference.addEventListener('change', () => {
        passenger.berth_preference = preference.value as BerthPreference;
        passenger.pickedCoach = null;
        passenger.pickedBerth = null;
        save();
        clearProblem();
        refreshPlan();
      });
      const remove = h('button', { type: 'button', class: 'btn--quiet btn' }, [
        `Remove passenger ${number}`,
      ]);
      remove.addEventListener('click', () => {
        draft.passengers.splice(index, 1);
        if (draft.passengers.length === 0) draft.passengers.push(emptyPassenger());
        choosingFor = 1;
        save();
        clearProblem();
        paintPassengers();
        paintChoosing();
        refreshPlan();
        scheduleFare();
      });
      passengerHost.appendChild(h('fieldset', {
        role: 'group',
        'aria-label': `Passenger ${number}`,
      }, [
        h('legend', {}, [`Passenger ${number}`]),
        h('div', { class: 'field' }, [h('label', { for: ids.name }, ['Name']), name]),
        h('div', { class: 'field' }, [h('label', { for: ids.age }, ['Age']), age]),
        h('div', { class: 'field' }, [h('label', { for: ids.gender }, ['Gender']), gender]),
        h('div', { class: 'field' }, [
          h('label', { for: ids.berth_preference }, ['Berth preference']),
          preference,
        ]),
        remove,
      ]));
    });
  }

  function scheduleFare(): void {
    window.clearTimeout(fareTimer);
    fareTimer = window.setTimeout(() => {
      void refreshFare();
    }, 150);
  }

  async function refreshFare(): Promise<void> {
    const ages = draft.passengers.map((passenger) => Number(passenger.age));
    if (ages.some((age) => !Number.isInteger(age) || age < 0 || age > 125)) return;
    const body = await api.fareQuote({
      train: trainNumber,
      run_date: runDate,
      from,
      to,
      class: travelClass,
      quota,
      passengers: ages.map((age) => ({ age })),
    }).catch(() => null);
    if (body === null) return;
    clear(fareLines);
    for (const line of body.lines) {
      fareLines.appendChild(h('li', {}, [
        h('span', {}, [line.label]),
        h('span', { class: 'num' }, [formatMoney(line.amount_paise)]),
      ]));
    }
    fareTotal = body.total_paise;
    fareTotalRegion.say(`Total ${formatMoney(fareTotal)}`);
    fareTotalRegion.element.classList.remove('fare-total--changed');
    void fareTotalRegion.element.offsetWidth;
    fareTotalRegion.element.classList.add('fare-total--changed');
  }

  async function findTrain(): Promise<TrainEntry | null> {
    for (const offsetDays of [0, 1, 2]) {
      const query = new URLSearchParams({
        from,
        to,
        date: addDays(runDate, offsetDays),
        quota,
        class: travelClass,
      }).toString();
      const body = await api.trains(query).catch(() => null);
      const found = body?.trains.find(
        (entry) => entry.number === trainNumber && entry.run_date === runDate,
      );
      if (found !== undefined) return found;
    }
    return null;
  }

  async function loadTrain(): Promise<void> {
    const found = await findTrain();
    if (found === null) return;
    train = found;
    classEntry = found.classes.find((entry) => entry.class === travelClass) ?? null;
  }

  async function loadPlan(): Promise<void> {
    const query = new URLSearchParams({ class: travelClass, from, to }).toString();
    const body = await api.coaches(trainNumber, runDate, query).catch(() => null);
    if (body === null) return;
    cellsByCoach.clear();
    for (const coach of body.coaches) cellsByCoach.set(coach.coach, coach.berths);
    planView.setCoaches(body.coaches);
    refreshPlan();
  }

  function fieldTarget(key: string): HTMLElement | null {
    if (key === 'passengers') return main.querySelector<HTMLElement>('#add-passenger');
    if (key === 'contact_phone') return main.querySelector<HTMLElement>('#contact-phone');
    const match = /^passengers\[(\d+)\]\.(\w+)$/.exec(key);
    if (match === null) return null;
    return main.querySelector<HTMLElement>(`#p${Number(match[1]) + 1}-${match[2]}`);
  }

  function showFieldErrors(errors: Record<string, string>): void {
    clear(formProblems.element);
    const list = h('ul');
    for (const [key, message] of Object.entries(errors)) {
      const link = h('a', { href: '#' }, [message]);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        fieldTarget(key)?.focus();
      });
      list.appendChild(h('li', {}, [link]));
    }
    formProblems.element.append(h('h2', {}, ['Check these fields']), list);
    formProblems.element.setAttribute('tabindex', '-1');
    formProblems.element.focus();
  }

  function payload(): Record<string, unknown> {
    return {
      train: trainNumber,
      run_date: runDate,
      from,
      to,
      class: travelClass,
      quota,
      passengers: draft.passengers.map((passenger) => ({
        name: passenger.name,
        age: Number(passenger.age),
        gender: passenger.gender,
        berth_preference: passenger.berth_preference,
      })),
      keep_in_one_coach: draft.keepInOneCoach,
      lower_berth_only: draft.lowerBerthOnly,
      accept: acceptOverride ?? acceptedStatus(classEntry, partySize()),
      contact_phone: draft.contactPhone,
    };
  }

  async function submit(): Promise<void> {
    bookingResult.say('Processing payment');
    clear(formProblems.element);
    try {
      const body = await api.book(payload(), newIdempotencyKey());
      clearDraft(path);
      payDialog?.close();
      sessionStorage.setItem(
        BOOKING_RESULT_KEY,
        `Booked. PNR ${body.pnr}. E-ticket saved. Email copy queued.`,
      );
      router.go(`/bookings/${body.pnr}`);
    } catch (error) {
      if (!(error instanceof ApiRequestError)) throw error;
      bookingResult.say('');
      payDialog?.close();
      await showBookingProblem(error);
    }
  }

  async function showBookingProblem(error: ApiRequestError): Promise<void> {
    const failure = error.payload;
    if (error.status === 401) {
      sessionStorage.setItem(SESSION_ENDED_KEY, '1');
      router.go(`/signin?next=${encodeURIComponent(path)}`);
      return;
    }
    if (failure.error === 'validation') {
      showFieldErrors(failure.errors ?? {});
      return;
    }
    clear(problemActions);
    switch (failure.error) {
      case 'availability_changed': {
        const label = failure.offer?.label ?? '';
        bookingProblem.say(
          `Availability changed before you paid. Nothing was charged. Now available: ${label}.`,
        );
        const accept = failure.offer?.accept ?? 'WL';
        const again = h('button', { type: 'button', class: 'btn' }, [`Book at ${label}`]);
        again.addEventListener('click', () => {
          acceptOverride = accept;
          void submit();
        });
        problemActions.appendChild(again);
        break;
      }
      case 'waitlist_full':
        bookingProblem.say(
          'The waiting list for this train is full. Nothing was booked or charged.',
        );
        break;
      case 'party_split':
        bookingProblem.say('Party could not be kept in one coach. Nothing was booked or charged.');
        break;
      case 'no_lower_berth':
        bookingProblem.say('No lower berth could be allotted. Nothing was booked or charged.');
        break;
      case 'quota_full':
        bookingProblem.say(
          `Not enough ${QUOTA_LABEL[quota]} quota berths are left. Nothing was booked or charged.`,
        );
        break;
      case 'booking_not_open':
        bookingProblem.say(`Bookings for this train open on ${longDate(failure.opens_at ?? '')}.`);
        break;
      case 'tatkal_not_open':
        bookingProblem.say(
          `Tatkal opens at ${hourMinute(failure.opens_at ?? '')} IST on `
          + `${longDate(failure.opens_at ?? '')}.`,
        );
        break;
      case 'chart_prepared':
        bookingProblem.say('The chart for this train is prepared. Bookings are closed.');
        break;
      case 'payment_unavailable':
        bookingProblem.say(
          'Payments are down right now. Nothing was charged and no berth is held. '
          + 'Try again in a few minutes.',
        );
        break;
      case 'ticket_storage_unavailable':
        bookingProblem.say(
          "E-tickets can't be saved right now. Nothing was charged and no berth is held. "
          + 'Try again in a few minutes.',
        );
        break;
      default:
        bookingProblem.say(failure.message);
        break;
    }
    await loadTrain();
    if (classEntry !== null) fareAvailability.say(classEntry.label);
  }

  function openPayDialog(): void {
    const pay = h('button', { type: 'button', class: 'btn' }, [`Pay ${formatMoney(fareTotal)}`]);
    const back = h('button', { type: 'button', class: 'btn--quiet btn' }, ['Back']);
    payDialog = new Modal({
      label: 'Confirm and pay',
      onClose: () => {
        payDialog = null;
      },
      initialFocus: () => pay,
    }, [
      h('h2', {}, ['Confirm and pay']),
      h('p', {}, [
        `${partySize()} passengers aged 5 or over · ${travelClass} · ${QUOTA_LABEL[quota]}`,
      ]),
      h('div', { class: 'dialog__actions' }, [pay, back]),
    ]);
    pay.addEventListener('click', () => {
      pay.disabled = true;
      void submit().finally(() => {
        pay.disabled = false;
      });
    });
    back.addEventListener('click', () => payDialog?.close());
  }

  reviewButton.addEventListener('click', () => {
    clearProblem();
    openPayDialog();
  });

  const addPassenger = h('button', {
    type: 'button',
    class: 'btn--quiet btn',
    id: 'add-passenger',
  }, ['Add passenger']);
  addPassenger.addEventListener('click', () => {
    draft.passengers.push(emptyPassenger());
    save();
    clearProblem();
    paintPassengers();
    paintChoosing();
    scheduleFare();
  });

  const keepCheckbox = h('input', {
    type: 'checkbox',
    id: 'keep-one-coach',
    checked: draft.keepInOneCoach,
  });
  keepCheckbox.addEventListener('change', () => {
    draft.keepInOneCoach = keepCheckbox.checked;
    save();
    clearProblem();
  });
  const lowerCheckbox = h('input', {
    type: 'checkbox',
    id: 'lower-only',
    checked: draft.lowerBerthOnly,
  });
  lowerCheckbox.addEventListener('change', () => {
    draft.lowerBerthOnly = lowerCheckbox.checked;
    save();
    clearProblem();
  });
  const changeSearch = h('a', { href: '/', class: 'link-target' }, ['Change search']);
  changeSearch.addEventListener('click', (event) => {
    event.preventDefault();
    router.go('/');
  });

  const phoneInput = h('input', { type: 'tel', id: 'contact-phone', value: draft.contactPhone });
  phoneInput.addEventListener('input', () => {
    draft.contactPhone = phoneInput.value;
    save();
    clearProblem();
  });

  const formPane = h('div', { class: 'panel stack' }, [
    h('h1', {}, ['Book this train']),
    formProblems.element,
    bookingProblem.element,
    problemActions,
    passengerHost,
    addPassenger,
    h('span', { class: 'check' }, [
      keepCheckbox,
      h('label', { for: 'keep-one-coach' }, ['Keep party in one coach']),
    ]),
    h('span', { class: 'check' }, [
      lowerCheckbox,
      h('label', { for: 'lower-only' }, ['Book only if a lower berth is allotted']),
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'contact-phone' }, ['Mobile number']),
      phoneInput,
    ]),
    choosingHost,
  ]);

  const farePane = h('div', { class: 'panel stack' }, [
    h('h2', {}, ['Fare']),
    fareLines,
    fareTotalRegion.element,
    fareAvailability.element,
    bookingResult.element,
    h('div', { class: 'paybar' }, [reviewButton]),
    h('p', {}, [changeSearch]),
  ]);

  main.appendChild(h('div', { class: 'layout layout--three' }, [
    formPane,
    h('div', {}, [planView.element]),
    farePane,
  ]));

  paintPassengers();
  paintChoosing();
  train = await findTrain();
  classEntry = train?.classes.find((entry) => entry.class === travelClass) ?? null;
  if (classEntry !== null) fareAvailability.say(classEntry.label);
  await loadPlan();
  await refreshFare();
  if (readDraft<BookingDraft>(path) !== null) reviewButton.focus();
  save();

  const onFocusIn = (event: FocusEvent): void => {
    if (!isPhoneWidth()) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !formPane.contains(target)) return;
    const bar = main.querySelector<HTMLElement>('.paybar');
    if (bar === null) return;
    const rect = target.getBoundingClientRect();
    const barTop = bar.getBoundingClientRect().top;
    if (rect.bottom > barTop) window.scrollBy({ top: rect.bottom - barTop + 12 });
  };
  main.addEventListener('focusin', onFocusIn);
  const onResize = (): void => refreshPlan();
  window.addEventListener('resize', onResize);

  const ribbon = train === null ? [] : ribbonStopsFromTrain(train.stops, from, to);
  return {
    ribbon,
    cleanup: () => {
      window.clearTimeout(fareTimer);
      window.removeEventListener('resize', onResize);
      main.removeEventListener('focusin', onFocusIn);
      payDialog?.close();
    },
  };
}
