/**
 * Owner portal — My cars, the car page, the request-release form, the release
 * page and the invoice page. Owners see only their own records.
 */
import { api, ApiFailure, KeyHolder, NoAnswer, randomKey } from '../api.ts';
import { state } from '../state.ts';
import { announce, h, patchText, reconcile } from '../ui.ts';
import { openDialog } from '../dialog.ts';
import { Reread } from '../reread.ts';
import { registerReread, markInterrupted, navigate } from '../app.ts';
import {
  bayBillingEndsAnnouncement, bayBillingLabel, carInWorkshopCopy, carNotStoredReleaseCopy,
  myCarsBayLine, NO_ANSWER_COPY, portalHoldLine, portalInvoiceAnnouncement, portalReleaseAnnouncement,
  RELEASES_ROW_HOLD, releaseAlreadyOpenCopy, releaseHeading, releaseRequestedHeading,
  releaseRequestedText, requestingReleasePending, slotTakenCopy, startupStatusLabel,
  invoiceStatusLabel, outstandingLine, invalidTransitionCopy,
} from '../../shared/copy.ts';
import type { Screen } from './screen.ts';

interface PortalCar {
  id: string;
  name: string;
  status: string;
  bay: { code: string } | null;
  startup: { status: string; next_due: string | null };
  bay_billing: { status: string; charged_through_date: string | null; billing_end_date: string | null; cancel_requested: boolean };
  open_release: boolean;
}

export function renderPortal(main: HTMLElement): Screen {
  const region = h('p', { class: 'status-region', role: 'status', 'data-region': 'car-updates' });
  const list = h('ul', { class: 'cards', 'aria-label': 'My cars' });
  let seenBillingEnd = new Map<string, string>();

  const cardFor = (car: PortalCar): HTMLElement => {
    const link = h('a', { href: `/portal/cars/${car.id}`, text: car.name });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void navigate(`/portal/cars/${car.id}`);
    });
    return h('li', { class: 'card' },
      link,
      h('p', { 'data-cell': 'bay', text: myCarsBayLine(car.status, car.bay?.code ?? null) }),
      h('p', { 'data-cell': 'startup', text: startupStatusLabel(car.startup.status, car.startup.next_due) }),
      h('p', { 'data-cell': 'billing', text: bayBillingLabel(car.bay_billing) }));
  };

  const patchCard = (card: HTMLElement, car: PortalCar): void => {
    patchText(card.querySelector('[data-cell="bay"]') as HTMLElement, myCarsBayLine(car.status, car.bay?.code ?? null));
    patchText(card.querySelector('[data-cell="startup"]') as HTMLElement, startupStatusLabel(car.startup.status, car.startup.next_due));
    patchText(card.querySelector('[data-cell="billing"]') as HTMLElement, bayBillingLabel(car.bay_billing));
    if (car.bay_billing.billing_end_date && seenBillingEnd.get(car.id) !== car.bay_billing.billing_end_date) {
      if (seenBillingEnd.has(car.id)) {
        announce(region, bayBillingEndsAnnouncement(car.name, car.bay_billing.billing_end_date));
      }
      seenBillingEnd.set(car.id, car.bay_billing.billing_end_date);
    }
  };

  const fetchCars = async (): Promise<PortalCar[] | null> => {
    try {
      return ((await api.get('/api/cars')) as { cars: PortalCar[] }).cars;
    } catch {
      return null;
    }
  };

  const reread = new Reread(async () => {
    const cars = await fetchCars();
    if (cars) reconcile(list, cars, (car) => car.id, cardFor, patchCard);
  }, 10_000);

  const render = async (): Promise<void> => {
    main.replaceChildren(h('h1', { text: 'My cars' }), region, list);
    const cars = await fetchCars();
    if (!cars) return;
    for (const car of cars) {
      if (car.bay_billing.billing_end_date) seenBillingEnd.set(car.id, car.bay_billing.billing_end_date);
    }
    reconcile(list, cars, (car) => car.id, cardFor, patchCard);
    const needsWatch = cars.some((car) =>
      car.bay_billing.status === 'pending' ||
      (car.bay_billing.cancel_requested && car.bay_billing.status !== 'ending') ||
      car.open_release);
    if (needsWatch) {
      registerReread(reread);
      reread.start();
    }
  };

  return {
    render,
    destroy() {
      reread.stop();
      seenBillingEnd = new Map();
    },
  };
}

export function renderPortalCar(main: HTMLElement, carId: string): Screen {
  interface CarDetail {
    car: {
      name: string;
      photos: { id: string }[];
      condition_report: { id: string } | null;
      care_entries: { at: string; started: boolean; battery_v: string | null; by: { name: string } | null }[];
      jobs: { id: string; number: string; title: string; status: string }[];
      releases: { id: string; status: string; slot_label: string }[];
    };
  }
  const notFound = (): void => {
    main.replaceChildren(h('div', { class: 'not-found' }, h('h1', { text: "We couldn't find that page" })));
  };

  const render = async (): Promise<void> => {
    let detail: CarDetail | null = null;
    try {
      detail = (await api.get(`/api/cars/${carId}`)) as CarDetail;
    } catch {
      detail = null;
    }
    if (!detail) {
      notFound();
      return;
    }
    const car = detail.car;
    const invoices = ((await api.get('/api/invoices')) as { invoices: { id: string; number: string; status: string; balance: string; total: string }[] }).invoices;
    const jobLink = (job: { id: string; number: string; title: string; status: string }): HTMLElement =>
      h('li', null, h('a', {
        href: `/portal/jobs/${job.id}`,
        text: `${job.number} ${job.title} — ${job.status}`,
        onclick: (event: Event) => {
          event.preventDefault();
          void navigate(`/portal/jobs/${job.id}`);
        },
      }));
    main.replaceChildren(
      h('h1', { class: 'car-identity', text: car.name }),
      h('section', { class: 'panel' },
        h('h2', { text: 'Photos' }),
        car.photos.length > 0
          ? h('div', { class: 'photo-grid' }, ...car.photos.map((photo) =>
            h('img', { src: `/api/photos/${photo.id}/content`, alt: `${car.name} photo` })))
          : h('p', { text: 'No photos yet.' })),
      h('section', { class: 'panel' },
        h('h2', { text: 'Condition report' }),
        car.condition_report
          ? h('a', { href: `/api/condition-reports/${car.condition_report.id}/file`, text: 'Download signed report' })
          : h('p', { text: 'No signed report for this stay.' })),
      h('section', { class: 'panel' },
        h('h2', { text: 'Care history' }),
        h('ul', null, ...car.care_entries.map((entry) =>
          h('li', { text: `${new Date(entry.at).toLocaleDateString('en-GB', { timeZone: 'Europe/Zurich' })} — ${entry.started ? 'started ' : ''}${entry.battery_v ?? ''} V by ${entry.by?.name ?? 'the house'}` })))),
      h('section', { class: 'panel' },
        h('h2', { text: 'Jobs' }),
        h('ul', null, ...car.jobs.map(jobLink))),
      h('section', { class: 'panel' },
        h('h2', { text: 'Invoices' }),
        h('ul', null, ...invoices.map((invoice) =>
          h('li', null, h('a', {
            href: `/portal/invoices/${invoice.id}`,
            text: `${invoice.number} — CHF ${invoice.total} — ${invoice.status}`,
            onclick: (event: Event) => {
              event.preventDefault();
              void navigate(`/portal/invoices/${invoice.id}`);
            },
          }))))),
      h('section', { class: 'panel' },
        h('h2', { text: 'Releases' }),
        h('ul', null, ...car.releases.map((release) =>
          h('li', null, h('a', {
            href: `/portal/releases/${release.id}`,
            text: `${release.status} — ${release.slot_label}`,
            onclick: (event: Event) => {
              event.preventDefault();
              void navigate(`/portal/releases/${release.id}`);
            },
          })))),
        h('button', {
          class: 'primary',
          text: 'Request release',
          onclick: () => void navigate(`/portal/cars/${carId}/release`),
        })),
    );
  };

  return {
    render,
    destroy() {
      // no re-read
    },
  };
}

export function renderRequestRelease(main: HTMLElement, carId: string): Screen {
  const region = h('p', { class: 'status-region', role: 'status', 'data-region': 'release-updates' });
  const date = h('input', { type: 'text', 'data-field': 'date', class: 'mono', placeholder: 'YYYY-MM-DD' });
  const time = h('select', { 'data-field': 'time', 'aria-label': 'Time' });
  for (let minutes = 8 * 60; minutes <= 17 * 60 + 30; minutes += 30) {
    const label = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    time.append(h('option', { value: label, text: label }));
  }
  const earliestArea = h('p');
  const holder = new KeyHolder(randomKey);

  const loadEarliest = async (): Promise<void> => {
    try {
      const response = (await api.get('/api/releases/earliest-slot')) as { earliest: string; earliest_label: string };
      const [earliestDate, earliestTime] = response.earliest.split('T');
      date.value = earliestDate;
      time.value = earliestTime;
      earliestArea.textContent = `Earliest slot: ${response.earliest_label}`;
    } catch {
      // keep whatever we have
    }
  };

  const render = async (): Promise<void> => {
    const request = h('button', {
      class: 'primary',
      text: 'Request release',
      onclick: async () => {
        const summary = main.querySelector('[data-summary]') as HTMLElement;
        summary.replaceChildren();
        announce(region, requestingReleasePending());
        try {
          await api.postWithKey('/api/releases', { car_id: carId, slot: `${date.value}T${time.value}` }, holder.current());
          holder.discard();
          main.replaceChildren(
            h('h1', { text: releaseRequestedHeading() }),
            h('p', { text: releaseRequestedText(`${date.value}T${time.value}`) }),
            region,
          );
        } catch (err) {
          if (err instanceof NoAnswer) {
            announce(region, NO_ANSWER_COPY.requestRelease);
            return;
          }
          if (err instanceof ApiFailure) {
            const code = err.detail.code;
            if (code === 'session_expired') {
              markInterrupted(holder.peek() ?? '', async () => {
                announce(region, requestingReleasePending());
                await api.postWithKey('/api/releases', { car_id: carId, slot: `${date.value}T${time.value}` }, holder.current());
                holder.discard();
              });
              return;
            }
            if (code === 'slot_taken') announce(region, slotTakenCopy());
            else if (code === 'release_already_open') announce(region, releaseAlreadyOpenCopy());
            else if (code === 'car_in_workshop') announce(region, carInWorkshopCopy());
            else if (code === 'car_not_stored') announce(region, carNotStoredReleaseCopy());
            else if (err.detail.fields) {
              summary.replaceChildren(h('div', { role: 'alert' },
                h('p', { class: 'error-summary', text: 'There is a problem' }),
                h('ul', null, ...Object.values(err.detail.fields).map((message) => h('li', { text: message })))));
            } else announce(region, code ?? 'Saving failed.');
          }
        }
      },
    });
    main.replaceChildren(
      h('h1', { text: 'Request release' }),
      region,
      h('div', { 'data-summary': 'errors' }),
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { text: 'Date' }), date),
        h('div', { class: 'field' }, h('label', { text: 'Time' }), time)),
      earliestArea,
      request,
    );
    await loadEarliest();
    const reread = new Reread(loadEarliest, 60_000);
    registerReread(reread);
    reread.start();
  };

  return {
    render,
    destroy() {
      // rereads are cleared by the shell
    },
  };
}

interface ReleaseRecord {
  id: string;
  car: { name: string };
  slot_label: string;
  status: string;
  bay_code: string | null;
  held_by: { number: string }[];
  events: { status: string; at: string; by: { name: string } | null }[];
}

export function renderPortalRelease(main: HTMLElement, releaseId: string): Screen {
  const region = h('p', { class: 'status-region', role: 'status', 'data-region': 'release-updates' });
  const heading = h('h1', { 'data-line': 'heading' });
  const holdLine = h('p', { class: 'hold', 'data-line': 'hold' });
  const historyArea = h('ul', { 'data-line': 'history' });
  const actionsArea = h('div', { 'data-line': 'actions', class: 'row-flex' });
  let previousStatus: string | null = null;

  const fetchRelease = async (): Promise<ReleaseRecord | null> => {
    try {
      return ((await api.get(`/api/releases/${releaseId}`)) as { release: ReleaseRecord }).release;
    } catch {
      return null;
    }
  };

  const patch = (release: ReleaseRecord, announceChange: boolean): void => {
    const headingText = releaseHeading(release.status);
    patchText(heading, headingText);
    if (release.status === 'staged' && release.held_by.length > 0) {
      const text = portalHoldLine(release.held_by.map((invoice) => invoice.number));
      if (holdLine.textContent !== text) holdLine.textContent = text;
    } else if (holdLine.textContent !== '') {
      holdLine.textContent = '';
    }
    historyArea.replaceChildren(...release.events.map((event) =>
      h('li', { text: `${event.status} — ${new Date(event.at).toLocaleString('en-GB', { timeZone: 'Europe/Zurich' })} — ${event.by?.name ?? ''}` })));
    const canCancel = ['requested', 'booked'].includes(release.status);
    actionsArea.replaceChildren(canCancel
      ? h('button', {
          text: 'Cancel release',
          onclick: async () => {
            announce(region, 'Saving...');
            try {
              await api.post(`/api/releases/${releaseId}/cancel`);
              announce(region, 'Release cancelled.');
              const fresh = await fetchRelease();
              if (fresh) patch(fresh, false);
            } catch (err) {
              if (err instanceof ApiFailure) announce(region, invalidTransitionCopy());
            }
          },
        })
      : h('span', null, release.bay_code ? `Bay ${release.bay_code}` : ''));
    if (announceChange && previousStatus !== null && previousStatus !== release.status) {
      announce(region, portalReleaseAnnouncement(release.status, release.slot_label));
    }
    previousStatus = release.status;
  };

  const reread = new Reread(async () => {
    const release = await fetchRelease();
    if (release) patch(release, true);
  }, 10_000);

  const render = async (): Promise<void> => {
    main.replaceChildren(
      heading, holdLine, region,
      h('p', { 'data-line': 'slot' }),
      historyArea,
      actionsArea,
    );
    const release = await fetchRelease();
    if (!release) {
      main.replaceChildren(h('div', { class: 'not-found' }, h('h1', { text: "We couldn't find that page" })));
      return;
    }
    patchText(main.querySelector('[data-line="slot"]') as HTMLElement, release.slot_label);
    patch(release, false);
    registerReread(reread);
    reread.start();
  };

  return {
    render,
    destroy() {
      reread.stop();
    },
  };
}

interface PortalInvoice {
  id: string;
  number: string;
  car: { name: string };
  lines: { description: string; quantity: string; unit_price: string | null; net: string; vat: string }[];
  net_total: string;
  vat_total: string;
  rounding: string;
  total: string;
  balance: string;
  balance_live: boolean;
  status: string;
  paid_at: string | null;
  status_confirmed_at: string | null;
  payments: { amount: string; refunded: string; at: string }[];
}

export function renderPortalInvoice(main: HTMLElement, invoiceId: string): Screen {
  const region = h('p', { class: 'status-region', role: 'status', 'data-region': 'invoice-updates' });
  const statusLine = h('p', { 'data-line': 'status' });
  const outstanding = h('p', { 'data-line': 'outstanding' });
  const linesBody = h('tbody');
  const totalsArea = h('div', { 'data-line': 'totals' });
  const paymentsArea = h('ul', { 'data-line': 'payments' });
  let previousBalance: string | null = null;

  const fetchInvoice = async (): Promise<PortalInvoice | null> => {
    try {
      return ((await api.get(`/api/invoices/${invoiceId}`)) as { invoice: PortalInvoice }).invoice;
    } catch {
      return null;
    }
  };

  const patch = (invoice: PortalInvoice, announceChange: boolean): void => {
    patchText(statusLine, invoiceStatusLabel(invoice.balance === '0.00', invoice.balance_live ? null : invoice.status_confirmed_at));
    patchText(outstanding, invoice.balance !== '0.00' ? outstandingLine(invoice.balance, invoice.balance_live ? null : invoice.status_confirmed_at) : '');
    const rows = invoice.lines.map((line) => h('tr', null,
      h('td', { text: line.description }),
      h('td', { class: 'num', text: line.quantity }),
      h('td', { class: 'num', text: line.unit_price ?? '' }),
      h('td', { class: 'num', text: line.net }),
      h('td', { class: 'num', text: line.vat })));
    linesBody.replaceChildren(...rows);
    totalsArea.replaceChildren(
      h('p', { class: 'right', text: `Net CHF ${invoice.net_total} · VAT CHF ${invoice.vat_total} · Rounding CHF ${invoice.rounding} · Total CHF ${invoice.total}` }));
    paymentsArea.replaceChildren(...invoice.payments.map((payment) =>
      h('li', { text: `Payment CHF ${payment.amount}${payment.refunded !== '0.00' ? ` (refunded CHF ${payment.refunded})` : ''}` })));
    if (announceChange && previousBalance !== null && previousBalance !== invoice.balance) {
      const wasPaid = previousBalance === '0.00';
      const nowPaid = invoice.balance === '0.00';
      if (nowPaid) {
        announce(region, portalInvoiceAnnouncement('paid', invoice.number, invoice.balance));
      } else if (wasPaid) {
        announce(region, portalInvoiceAnnouncement('unpaid_again', invoice.number, invoice.balance));
      } else {
        announce(region, portalInvoiceAnnouncement('fell', invoice.number, invoice.balance));
      }
    }
    previousBalance = invoice.balance;
  };

  const reread = new Reread(async () => {
    const invoice = await fetchInvoice();
    if (invoice) patch(invoice, true);
  }, 10_000);

  const render = async (): Promise<void> => {
    main.replaceChildren(
      h('h1', { 'data-line': 'number' }),
      h('p', { 'data-line': 'car' }),
      h('table', { class: 'sheet', 'aria-label': 'Invoice lines' },
        h('thead', null, h('tr', null,
          h('th', { text: 'Description' }), h('th', { class: 'num', text: 'Quantity' }),
          h('th', { class: 'num', text: 'Unit price' }), h('th', { class: 'num', text: 'Net' }),
          h('th', { class: 'num', text: 'VAT' }))),
        linesBody),
      totalsArea,
      statusLine,
      outstanding,
      h('h2', { text: 'Payments' }),
      paymentsArea,
      region,
    );
    const invoice = await fetchInvoice();
    if (!invoice) {
      main.replaceChildren(h('div', { class: 'not-found' }, h('h1', { text: "We couldn't find that page" })));
      return;
    }
    patchText(main.querySelector('[data-line="number"]') as HTMLElement, `Invoice ${invoice.number}`);
    patchText(main.querySelector('[data-line="car"]') as HTMLElement, invoice.car.name);
    patch(invoice, false);
    registerReread(reread);
    reread.start();
  };

  return {
    render,
    destroy() {
      reread.stop();
    },
  };
}

export { RELEASES_ROW_HOLD, openDialog, state };
