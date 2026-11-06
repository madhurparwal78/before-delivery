import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { handleAccessFailure, staffPage } from '../lib/chrome.js';
import {
  createMessageBox,
  FieldSet,
  handOffMessage,
  takeHandOffMessage,
  withPending,
} from '../lib/forms.js';
import { link, navigate, type RouteContext } from '../lib/router.js';
import { createStrip, isWide } from '../lib/strip.js';
import {
  button,
  columns,
  dataTable,
  definitionList,
  listItem,
  quietButton,
  radioGroup,
  stripList,
  textbox,
} from '../lib/views.js';
import { formatInstant, MESSAGES } from '../../shared/copy.js';
import { formatDate, formatMoney } from '../../shared/format.js';
import type { Charter, Hold, Quote, StaffWeek, YachtProfile } from '../lib/types.js';
import { WEEK_STATUS_LABELS } from './publicYacht.js';

const REFRESH_MS = 10_000;

export function holdStatusLabel(hold: Hold): string {
  if (hold.status === 'waiting') return `Waiting, ${hold.position} in line`;
  if (hold.status === 'live') return 'Live';
  if (hold.status === 'lapsed') return 'Lapsed';
  if (hold.status === 'released') return 'Released';
  return 'Charter';
}

export function lapseCell(hold: Hold): string {
  return hold.lapsesAt === null ? '—' : formatInstant(hold.lapsesAt);
}

function holdRow(hold: Hold, workspaceSlug: string): readonly (HTMLElement | string)[] {
  return [
    hold.yachtSlug,
    `Week of ${formatDate(hold.weekStart)}`,
    link(hold.clientName, `/w/${workspaceSlug}/holds/${hold.id}`),
    hold.placedBy.name,
    holdStatusLabel(hold),
    lapseCell(hold),
  ];
}

export async function holdsScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<(() => void) | void> {
  const workspaceSlug = context.params.ws;
  const page = await staffPage(host, workspaceSlug, 'Holds');
  if (page === null) return;
  const table = dataTable(
    'Holds',
    ['Yacht', 'Week', 'Client', 'Placed by', 'Status', 'Lapses'],
    'No holds yet.',
  );
  const messages = createMessageBox();
  page.main.append(messages.node, table.section);

  const load = async (): Promise<void> => {
    const result = await api.get<{ holds: readonly Hold[] }>(`/api/w/${workspaceSlug}/holds`);
    if (!result.ok) return;
    table.setRows(result.data.holds.map((hold) => holdRow(hold, workspaceSlug)));
  };
  await load();
  const timer = window.setInterval(() => void load(), REFRESH_MS);
  return () => window.clearInterval(timer);
}

export async function staffYachtScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<(() => void) | void> {
  const workspaceSlug = context.params.ws;
  const yachtSlug = context.params.yachtSlug;
  const yachtResult = await api.get<{ yacht: YachtProfile }>(
    `/api/w/${workspaceSlug}/yachts/${yachtSlug}`,
  );
  if (!yachtResult.ok) {
    const { notFoundScreen } = await import('./feedbackPages.js');
    await notFoundScreen(host);
    return;
  }
  const yacht = yachtResult.data.yacht;
  const page = await staffPage(host, workspaceSlug, yacht.name);
  if (page === null) return;
  const messages = createMessageBox();
  const weeks = stripList('Weeks', 'No weeks yet.', 'Weeks position');
  const holdsTable = dataTable(
    'Holds on this yacht',
    ['Yacht', 'Week', 'Client', 'Placed by', 'Status', 'Lapses'],
    'No holds yet.',
  );
  page.main.append(messages.node, weeks.section, holdsTable.section);
  const strip = createStrip({
    viewport: weeks.viewport,
    track: weeks.list,
    progress: weeks.progress,
  });
  weeks.progress.hidden = !isWide();

  const load = async (): Promise<void> => {
    const [weekResult, holdResult] = await Promise.all([
      api.get<{ weeks: readonly StaffWeek[] }>(`/api/w/${workspaceSlug}/yachts/${yachtSlug}/weeks`),
      api.get<{ holds: readonly Hold[] }>(
        `/api/w/${workspaceSlug}/holds?yachtSlug=${encodeURIComponent(yachtSlug)}`,
      ),
    ]);
    if (weekResult.ok) {
      weeks.setItems(
        weekResult.data.weeks.map((week) => {
          const cells: (HTMLElement | null)[] = [
            el('p', { class: 'week-date' }, `Week of ${formatDate(week.weekStart)}`),
            el('p', { class: 'week-status' }, WEEK_STATUS_LABELS[week.status]),
            el('p', { class: 'card-figure' }, formatMoney(week.weeklyRateMinor, week.currency)),
          ];
          if (week.status !== 'booked') {
            const hold = button(`Hold week of ${formatDate(week.weekStart)}`);
            hold.addEventListener('click', () =>
              openPlaceHold({ opener: hold, workspaceSlug, yacht, week }),
            );
            cells.push(hold);
          }
          return listItem(el('div', { class: 'week-card' }, ...cells));
        }),
      );
      strip.refresh();
    }
    if (holdResult.ok) {
      holdsTable.setRows(holdResult.data.holds.map((hold) => holdRow(hold, workspaceSlug)));
    }
  };
  await load();
  const timer = window.setInterval(() => void load(), REFRESH_MS);
  const onResize = (): void => {
    weeks.progress.hidden = !isWide();
    strip.refresh();
  };
  window.addEventListener('resize', onResize);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('resize', onResize);
  };
}

function openPlaceHold(options: {
  readonly opener: HTMLButtonElement;
  readonly workspaceSlug: string;
  readonly yacht: YachtProfile;
  readonly week: StaffWeek;
}): void {
  const { workspaceSlug, yacht, week } = options;
  const queue = week.status === 'held';
  openDialog({
    name: 'Place hold',
    opener: options.opener,
    build: (handle) => {
      const fields = new FieldSet(true);
      const clientName = textbox('Client name');
      const dialogMessage = createMessageBox();
      const confirm = button(queue ? 'Join the line' : 'Place hold');
      const cancel = quietButton('Cancel');
      cancel.addEventListener('click', () => handle.close());
      confirm.addEventListener('click', () => {
        void withPending(confirm, 'Placing hold', async () => {
          const result = await api.post<{ hold: Hold }>(`/api/w/${workspaceSlug}/holds`, {
            yachtSlug: yacht.slug,
            weekStart: week.weekStart,
            clientName: clientName.value,
            queue,
          });
          if (result.ok) {
            const hold = result.data.hold;
            handOffMessage(
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
            handle.close();
            navigate(`/w/${workspaceSlug}/holds/${hold.id}`);
            return;
          }
          const body = failure(result);
          if (body.errors !== undefined) {
            fields.showErrors(body.errors)?.focus();
            return;
          }
          if (body.error === 'week_taken') {
            dialogMessage.show(
              MESSAGES.weekTaken(String(body.takenBy), formatInstant(String(body.takenAt))),
            );
          } else if (body.error === 'week_booked') {
            dialogMessage.show(MESSAGES.weekBooked);
          } else if (body.error === 'yacht_withdrawn') {
            dialogMessage.show(MESSAGES.yachtWithdrawnHold);
          } else if (!handleAccessFailure(result, dialogMessage)) {
            dialogMessage.show(MESSAGES.unexpected);
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

export async function holdDetailScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<(() => void) | void> {
  const workspaceSlug = context.params.ws;
  const holdId = context.params.holdId;
  const first = await api.get<{ hold: Hold }>(`/api/w/${workspaceSlug}/holds/${holdId}`);
  if (!first.ok) {
    const { notFoundScreen } = await import('./feedbackPages.js');
    await notFoundScreen(host);
    return;
  }
  const page = await staffPage(host, workspaceSlug, `Hold for ${first.data.hold.clientName}`);
  if (page === null) return;
  const messages = createMessageBox();
  const details = el('div', { class: 'hold-details' });
  takeHandOffMessage(messages);
  const deposit = button('Record deposit');
  const release = button('Release hold');
  const actions = el('div', { class: 'hold-actions' }, deposit, release);
  const charterLink = el('p', { class: 'card-links' });
  page.main.append(
    messages.node,
    columns([details, charterLink], [actions]),
  );

  const paint = (hold: Hold): void => {
    details.replaceChildren(
      definitionList([
        ['Yacht', hold.yachtSlug],
        ['Week', `Week of ${formatDate(hold.weekStart)}`],
        ['Client', hold.clientName],
        ['Placed by', hold.placedBy.name],
        ['Status', holdStatusLabel(hold)],
        ['Lapses', lapseCell(hold)],
      ]),
    );
    deposit.disabled = hold.status !== 'live';
    release.disabled = hold.status !== 'live' && hold.status !== 'waiting';
    charterLink.replaceChildren();
    if (hold.status === 'charter' && hold.charterId !== null) {
      charterLink.appendChild(link('Open charter', `/w/${workspaceSlug}/charters/${hold.charterId}`));
    }
  };

  let hold = first.data.hold;
  paint(hold);
  const load = async (): Promise<void> => {
    const result = await api.get<{ hold: Hold }>(`/api/w/${workspaceSlug}/holds/${holdId}`);
    if (!result.ok) return;
    hold = result.data.hold;
    paint(hold);
  };

  release.addEventListener('click', () => {
    openDialog({
      name: 'Release hold',
      opener: release,
      build: (handle) => {
        const keep = quietButton('Keep hold');
        keep.addEventListener('click', () => handle.close());
        const confirm = button('Release hold');
        const dialogMessage = createMessageBox();
        confirm.addEventListener('click', () => {
          void withPending(confirm, 'Releasing hold', async () => {
            const result = await api.post(`/api/w/${workspaceSlug}/holds/${holdId}/release`);
            if (result.ok) {
              handle.close();
              messages.show(MESSAGES.holdReleased);
              await load();
              return;
            }
            const body = failure(result);
            if (body.error === 'hold_lapsed') {
              dialogMessage.show(MESSAGES.holdLapsed(formatInstant(String(body.lapsedAt))));
            } else if (body.error === 'hold_not_live') {
              dialogMessage.show(MESSAGES.holdNotLive);
            } else if (!handleAccessFailure(result, dialogMessage)) {
              dialogMessage.show(MESSAGES.unexpected);
            }
            await load();
            confirm.focus();
          });
        });
        return {
          body: [dialogMessage.node, el('div', { class: 'dialog-actions' }, keep, confirm)],
          first: () => keep,
        };
      },
    });
  });

  deposit.addEventListener('click', () => {
    openDialog({
      name: 'Record deposit',
      opener: deposit,
      build: (handle) => {
        const fields = new FieldSet(true);
        const clientEmail = textbox('Client email', '', 'email');
        const currency = radioGroup(
          'Currency',
          [
            { value: 'EUR', label: 'EUR' },
            { value: 'GBP', label: 'GBP' },
            { value: 'USD', label: 'USD' },
          ],
          'EUR',
        );
        const priceTable = dataTable('Price', ['Line', 'EUR', 'Client currency'], 'No price yet.');
        const dialogMessage = createMessageBox();
        const confirm = button('Record deposit');
        const cancel = quietButton('Cancel');
        cancel.addEventListener('click', () => handle.close());

        const loadQuote = async (): Promise<void> => {
          const result = await api.get<{ quote: Quote }>(
            `/api/w/${workspaceSlug}/holds/${holdId}/quote?currency=${currency.value()}`,
          );
          if (!result.ok) return;
          const quote = result.data.quote;
          priceTable.setRows([
            ...quote.lines.map((line) => [
              line.label,
              formatMoney(line.eurMinor, 'EUR'),
              formatMoney(line.amountMinor, quote.currency),
            ]),
            [
              'Total',
              formatMoney(quote.totalEurMinor, 'EUR'),
              formatMoney(quote.totalMinor, quote.currency),
            ],
          ]);
        };
        currency.onChange(() => void loadQuote());
        void loadQuote();

        confirm.addEventListener('click', () => {
          void withPending(confirm, 'Recording deposit', async () => {
            const result = await api.post<{ charter: Charter }>(
              `/api/w/${workspaceSlug}/holds/${holdId}/deposit`,
              { clientEmail: clientEmail.value, currency: currency.value() },
            );
            if (result.ok) {
              handle.close();
              handOffMessage(MESSAGES.depositRecorded(result.data.charter.clientEmail));
              navigate(`/w/${workspaceSlug}/charters/${result.data.charter.id}`);
              return;
            }
            const body = failure(result);
            if (body.errors !== undefined) {
              fields.showErrors(body.errors)?.focus();
              return;
            }
            if (body.error === 'billing_unavailable') {
              dialogMessage.show(MESSAGES.billingUnavailable, 'problem');
            } else if (body.error === 'mail_unavailable') {
              dialogMessage.show(MESSAGES.mailUnavailable, 'problem');
            } else if (body.error === 'hold_lapsed') {
              dialogMessage.show(MESSAGES.holdLapsed(formatInstant(String(body.lapsedAt))), 'problem');
            } else if (body.error === 'hold_not_live') {
              dialogMessage.show(MESSAGES.holdNotLive, 'problem');
            } else if (!handleAccessFailure(result, dialogMessage)) {
              dialogMessage.show(MESSAGES.unexpected, 'problem');
            }
            confirm.focus();
          });
        });

        return {
          body: [
            fields.field('clientEmail', 'Client email', clientEmail),
            currency.node,
            priceTable.section,
            dialogMessage.node,
            el('div', { class: 'dialog-actions' }, confirm, cancel),
          ],
          first: () => clientEmail,
        };
      },
    });
  });

  const timer = window.setInterval(() => void load(), REFRESH_MS);
  return () => window.clearInterval(timer);
}
