import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { publicPage } from '../lib/chrome.js';
import { createMessageBox, FieldSet, withPending } from '../lib/forms.js';
import type { RouteContext } from '../lib/router.js';
import { createStrip, isWide } from '../lib/strip.js';
import { button, dataTable, listItem, quietButton, stripList, textbox } from '../lib/views.js';
import { formatInstant, MESSAGES } from '../../shared/copy.js';
import { formatDate, formatMoney } from '../../shared/format.js';
import { endedScreen, notFoundScreen } from './feedbackPages.js';
import { WEEK_STATUS_LABELS } from './publicYacht.js';

const REFRESH_MS = 10_000;

interface BrokerWeek {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly status: 'free' | 'held' | 'booked';
  readonly weeklyRateMinor: number;
  readonly currency: string;
}

interface BrokerYacht {
  readonly slug: string;
  readonly name: string;
  readonly base: string;
  readonly cabins: number;
  readonly lengthM: number;
  readonly weeks: readonly BrokerWeek[];
}

interface BrokerHold {
  readonly id: string;
  readonly yachtSlug: string;
  readonly weekStart: string;
  readonly clientName: string;
  readonly status: string;
  readonly position: number | null;
  readonly lapsesAt: string | null;
}

interface BrokerBody {
  readonly broker: { readonly name: string };
  readonly company: { readonly name: string };
  readonly status: 'live';
  readonly endsAt: string;
  readonly yachts: readonly BrokerYacht[];
  readonly holds: readonly BrokerHold[];
}

function statusLabel(hold: BrokerHold): string {
  if (hold.status === 'waiting') return `Waiting, ${hold.position} in line`;
  if (hold.status === 'live') return 'Live';
  if (hold.status === 'lapsed') return 'Lapsed';
  if (hold.status === 'released') return 'Released';
  return 'Charter';
}

export async function brokerPageScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<(() => void) | void> {
  const token = context.params.token;
  const first = await api.get<BrokerBody>(`/api/broker/${token}`);
  if (first.status === 410) {
    await endedScreen(host);
    return;
  }
  if (!first.ok) {
    await notFoundScreen(host);
    return;
  }
  const page = publicPage(host, `Availability for ${first.data.broker.name}`);
  const messages = createMessageBox();
  const yachtHost = el('div', { class: 'broker-yachts' });
  const holdsTable = dataTable(
    'Your holds',
    ['Client', 'Yacht', 'Week', 'Status', 'Lapses'],
    'No holds yet.',
  );
  page.main.append(messages.node, yachtHost, holdsTable.section);
  const strips: { refresh(): void; progress: HTMLElement }[] = [];

  const paint = (body: BrokerBody): void => {
    yachtHost.replaceChildren();
    strips.length = 0;
    for (const yacht of body.yachts) {
      const weeks = stripList(
        `Weeks for ${yacht.name}`,
        'No weeks yet.',
        `Weeks position for ${yacht.name}`,
      );
      weeks.setItems(
        yacht.weeks.map((week) => {
          const cells: (HTMLElement | null)[] = [
            el('p', { class: 'week-date' }, `Week of ${formatDate(week.weekStart)}`),
            el('p', { class: 'week-status' }, WEEK_STATUS_LABELS[week.status]),
            el('p', { class: 'card-figure' }, formatMoney(week.weeklyRateMinor, week.currency)),
          ];
          if (week.status !== 'booked') {
            const hold = button(`Hold ${yacht.name}, week of ${formatDate(week.weekStart)}`);
            hold.addEventListener('click', () =>
              openHoldSheet(hold, token, yacht, week, messages, load),
            );
            cells.push(hold);
          }
          return listItem(el('div', { class: 'week-card' }, ...cells));
        }),
      );
      const section = el('section', { class: 'broker-yacht' }, el('h2', { class: 'section-heading' }, yacht.name), weeks.section);
      yachtHost.appendChild(section);
      const strip = createStrip({
        viewport: weeks.viewport,
        track: weeks.list,
        progress: weeks.progress,
      });
      weeks.progress.hidden = !isWide();
      strips.push({ refresh: strip.refresh, progress: weeks.progress });
    }
    holdsTable.setRows(
      body.holds.map((hold) => [
        hold.clientName,
        hold.yachtSlug,
        `Week of ${formatDate(hold.weekStart)}`,
        statusLabel(hold),
        hold.lapsesAt === null ? '—' : formatInstant(hold.lapsesAt),
      ]),
    );
  };

  const load = async (): Promise<void> => {
    const result = await api.get<BrokerBody>(`/api/broker/${token}`);
    if (!result.ok) return;
    paint(result.data);
  };

  paint(first.data);
  const timer = window.setInterval(() => void load(), REFRESH_MS);
  const onResize = (): void => {
    for (const strip of strips) {
      strip.progress.hidden = !isWide();
      strip.refresh();
    }
  };
  window.addEventListener('resize', onResize);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('resize', onResize);
  };
}

function openHoldSheet(
  opener: HTMLButtonElement,
  token: string,
  yacht: BrokerYacht,
  week: BrokerWeek,
  messages: ReturnType<typeof createMessageBox>,
  reload: () => Promise<void>,
): void {
  const queue = week.status === 'held';
  openDialog({
    name: 'Hold for a client',
    kind: 'sheet',
    opener,
    build: (handle) => {
      const fields = new FieldSet(true);
      const clientName = textbox('Client name');
      const dialogMessage = createMessageBox();
      const confirm = button(queue ? 'Join the line' : 'Place hold');
      const cancel = quietButton('Cancel');
      cancel.addEventListener('click', () => handle.close());
      confirm.addEventListener('click', () => {
        void withPending(confirm, 'Placing hold', async () => {
          const result = await api.post<{ hold: BrokerHold }>(`/api/broker/${token}/holds`, {
            yachtSlug: yacht.slug,
            weekStart: week.weekStart,
            clientName: clientName.value,
            queue,
          });
          if (result.ok) {
            const hold = result.data.hold;
            handle.close();
            messages.show(
              hold.status === 'live'
                ? MESSAGES.holdPlaced(
                    hold.clientName,
                    yacht.name,
                    formatDate(hold.weekStart),
                    formatInstant(hold.lapsesAt as string),
                  )
                : MESSAGES.joinedLine(
                    hold.clientName,
                    hold.position as number,
                    yacht.name,
                    formatDate(hold.weekStart),
                  ),
            );
            await reload();
            return;
          }
          const body = failure(result);
          if (result.status === 429) {
            dialogMessage.show(
              MESSAGES.tooManyBrokerHolds(Number(body.retryAfterSeconds)),
              'problem',
            );
          } else if (body.error === 'week_taken') {
            dialogMessage.show(
              MESSAGES.weekTaken(String(body.takenBy), formatInstant(String(body.takenAt))),
              'problem',
            );
          } else if (body.error === 'week_booked') {
            dialogMessage.show(MESSAGES.weekBooked, 'problem');
          } else if (body.error === 'yacht_withdrawn') {
            dialogMessage.show(MESSAGES.yachtWithdrawnHold, 'problem');
          } else if (body.errors !== undefined) {
            fields.showErrors(body.errors)?.focus();
            return;
          } else {
            dialogMessage.show(MESSAGES.unexpected, 'problem');
          }
          confirm.focus();
        });
      });
      return {
        body: [
          fields.field('clientName', 'Client name', clientName),
          dialogMessage.node,
          el('div', { class: 'dialog-actions' }, confirm, cancel),
        ],
        first: () => clientName,
      };
    },
  });
}
