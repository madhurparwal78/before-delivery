import { call } from '../lib/api.js';
import { append, clear, el, focus, setFieldError } from '../lib/dom.js';
import { openDialog, phoneViewport } from '../lib/dialog.js';
import { liveRegion, pending, problemsSummary, select, textbox } from '../lib/forms.js';
import { pageHeading, type RenderContext, type Screen, type ScreenResult } from '../lib/router.js';
import { requireMember, isSessionError, sessionEndedNotice } from '../lib/session.js';
import { officeOf } from '../lib/store.js';
import { copy, errorCopy, officeTime } from '../lib/copy.js';
import {
  BOARD_TITLES,
  formatIsoDateHuman,
  formatMonth,
  formatMoneyCents,
} from '../../shared/format.js';
import { parseMonthKey } from '../../shared/zone.js';
import { newIdempotencyKey } from '../lib/api.js';
import type {
  Booking,
  ClientRecord,
  Licence,
  Statement,
  TalentRecord,
} from '../../shared/types.js';

const STATE_LABELS: Record<string, string> = {
  confirmed: 'Confirmed',
  invoiced: 'Invoiced',
  corrected: 'Corrected',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  expiring: 'Expiring',
  expired: 'Expired',
};

function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const bookingsScreen: Screen = {
  pattern: '/workspace/bookings',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const result = await call<{ bookings: Booking[] }>('GET', '/api/bookings');
    const bookings = result.body?.bookings ?? [];
    const table = el('table', { class: 'table tabular' }, [
      el('caption', { class: 'table-caption', text: 'Bookings' }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Reference' }),
          el('th', { scope: 'col', text: 'Day' }),
          el('th', { scope: 'col', text: 'Client' }),
          el('th', { scope: 'col', text: 'Talent' }),
          el('th', { scope: 'col', text: 'Total' }),
          el('th', { scope: 'col', text: 'State' }),
        ]),
      ]),
      el('tbody', {}, bookings.map((booking) =>
        el('tr', {}, [
          el('th', { scope: 'row' }, [
            el('a', { class: 'link', href: `/workspace/bookings/${booking.id}`, text: booking.reference }),
          ]),
          el('td', { text: formatIsoDateHuman(booking.date) }),
          el('td', { text: booking.clientCompany }),
          el('td', { text: booking.talent.map((entry) => entry.displayName).join(', ') }),
          el('td', { text: formatMoneyCents(booking.totalCents) }),
          el('td', { text: STATE_LABELS[booking.state] }),
        ]))),
    ]);
    return {
      node: el('main', { class: 'page page-workspace' }, [
        pageHeading('Bookings', { display: false }),
        el('div', { class: 'table-region', role: 'region', 'aria-label': 'Bookings', tabindex: '0' }, [table]),
      ]),
      chrome: 'workspace',
    };
  },
};

export const bookingScreen: Screen = {
  pattern: '/workspace/bookings/:id',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const result = await call<{ booking: Booking }>('GET', `/api/bookings/${ctx.params.id}`);
    const live = liveRegion('Booking announcements');
    if (!result.body) {
      return {
        node: el('main', { class: 'page page-workspace' }, [
          pageHeading('Booking not found', { display: false }),
          live.node,
        ]),
        chrome: 'workspace',
      };
    }
    let booking = result.body.booking;
    const office = await officeOf(booking.office);
    const stateText = el('p', { class: 'booking-state', text: STATE_LABELS[booking.state] });
    const issue = el('button', { type: 'button', class: 'button', text: 'Issue invoice' });
    const node = el('main', { class: 'page page-workspace' }, []);

    const draw = (): void => {
      clear(node);
      stateText.textContent = STATE_LABELS[booking.state];
      append(node, [
        pageHeading(`Booking ${booking.reference}`, { display: false }),
        el('dl', { class: 'facts tabular' }, [
          el('dt', { text: 'Client' }),
          el('dd', { text: booking.clientCompany }),
          el('dt', { text: 'Job' }),
          el('dd', { text: booking.jobTitle }),
          el('dt', { text: 'Day' }),
          el('dd', { text: formatIsoDateHuman(booking.date) }),
          el('dt', { text: 'Talent' }),
          el('dd', { text: booking.talent.map((entry) => entry.displayName).join(', ') }),
          el('dt', { text: 'Rate card' }),
          el('dd', { text: booking.rateCard.name }),
          el('dt', { text: 'Invoice state' }),
          el('dd', {}),
        ]),
        el('div', { class: 'table-region', role: 'region', 'aria-label': 'Fee lines', tabindex: '0' }, [
          el('table', { class: 'table tabular' }, [
            el('caption', { class: 'table-caption', text: 'Fee lines' }),
            el('thead', {}, [
              el('tr', {}, [
                el('th', { scope: 'col', text: 'Line' }),
                el('th', { scope: 'col', text: 'Amount' }),
              ]),
            ]),
            el('tbody', {}, [
              ...booking.lines.map((line) =>
                el('tr', {}, [
                  el('th', { scope: 'row', text: line.label }),
                  el('td', { text: formatMoneyCents(line.amountCents) }),
                ])),
              el('tr', {}, [
                el('th', { scope: 'row', text: 'Total' }),
                el('td', { text: formatMoneyCents(booking.totalCents) }),
              ]),
            ]),
          ]),
        ]),
        member.role === 'accounts_lead' || member.role === 'agency_director' ? issue : null,
        live.node,
      ]);
      const slot = node.querySelector('dl dd:last-of-type');
      if (slot) slot.append(stateText);
    };

    issue.addEventListener('click', async () => {
      const spinner = pending(issue, 'Issuing invoice…');
      spinner.start();
      const issued = await call<{ booking: Booking }>('POST', `/api/bookings/${booking.id}/issue`, { body: {} });
      spinner.stop();
      if (issued.body) {
        booking = issued.body.booking;
        draw();
        live.announce('Invoice issued in billing.');
        focus(stateText);
        return;
      }
      const code = issued.error?.error;
      if (isSessionError(code)) {
        node.append(sessionEndedNotice((message) => live.announce(message)));
        return;
      }
      live.announce(
        code === 'already_invoiced'
          ? `This invoice was already issued by ${String(issued.error?.issuedBy ?? '')} at ${officeTime(String(issued.error?.issuedAt ?? ''), office)}.`
          : errorCopy(issued.error, office),
      );
    });

    draw();
    return { node, chrome: 'workspace' };
  },
};

export const licencesScreen: Screen = {
  pattern: '/workspace/licences',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const live = liveRegion('Licence announcements');
    const office = await officeOf(member.office);
    const node = el('main', { class: 'page page-workspace' }, []);
    const clientsResult = await call<{ clients: ClientRecord[] }>('GET', '/api/clients');
    const talentResult = await call<{ talent: TalentRecord[] }>('GET', '/api/talent');
    const clients = clientsResult.body?.clients ?? [];
    const talent = (talentResult.body?.talent ?? []).filter((entry) => entry.state === 'active');

    const draw = async (): Promise<void> => {
      const result = await call<{ counts: Record<string, number>; licences: Licence[] }>('GET', '/api/licences');
      if (!result.body) {
        clear(node);
        node.append(pageHeading('Licences', { display: false }), sessionEndedNotice((message) => live.announce(message)), live.node);
        return;
      }
      const { counts, licences } = result.body;
      clear(node);
      const record = el('button', { type: 'button', class: 'button', text: 'Record licence' });
      record.addEventListener('click', () => openRecordDialog(record));

      const tiles = el('ul', { class: 'tiles' }, [
        el('li', { class: 'tile tabular', text: `Active ${counts.active}` }),
        el('li', { class: 'tile tabular', text: `Expiring ${counts.expiring}` }),
        el('li', { class: 'tile tabular', text: `Expired ${counts.expired}` }),
      ]);

      const body = phoneViewport() ? cardList(licences) : licenceTable(licences);
      node.append(
        pageHeading('Licences', { display: false }),
        tiles,
        record,
        body,
        live.node,
      );
    };

    const extendDialog = (licence: Licence, endDateNode: HTMLElement, trigger: HTMLElement): void => {
      const dialog = openDialog({ title: 'Extend licence', sheet: phoneViewport(), returnFocusTo: trigger });
      const refusal = el('p', { class: 'dialog-refusal field-error', hidden: true, tabindex: '-1' });
      const months = textbox({ id: 'extend-months', label: 'Months', value: '3', inputmode: 'numeric' });
      const submit = el('button', { type: 'button', class: 'button', text: 'Extend licence' });
      const key = newIdempotencyKey();
      submit.addEventListener('click', async () => {
        refusal.hidden = true;
        const spinner = pending(submit, 'Extending licence…');
        spinner.start();
        const result = await call<{ licence: Licence }>('POST', `/api/licences/${licence.id}/extensions`, {
          body: { months: Number.parseInt(months.input.value || '0', 10), version: licence.version },
          idempotencyKey: key,
        });
        spinner.stop();
        if (result.body) {
          const updated = result.body.licence;
          live.announce(
            `Extended ${updated.talentDisplayName}'s licence by ${months.input.value} months to ${formatIsoDateHuman(updated.endsOn)}.`,
          );
          dialog.close();
          await draw();
          const refreshed = node.querySelector<HTMLElement>(`[data-licence-end="${updated.id}"]`);
          focus(refreshed ?? endDateNode);
          return;
        }
        if (result.status === 422 && result.error?.errors) {
          const [field, message] = Object.entries(result.error.errors)[0];
          setFieldError(dialog.body, field === 'months' ? 'extend-months' : 'extend-months', message);
          live.announce(copy.validation(Object.keys(result.error.errors).length));
          focus(months.input);
          return;
        }
        const code = result.error?.error;
        const message = code === 'stale_version'
          ? copy.staleLicence(String(result.error?.savedBy ?? ''), officeTime(String(result.error?.savedAt ?? ''), office))
          : code === 'billing_unavailable'
            ? copy.billingUnavailable
            : errorCopy(result.error, office);
        refusal.textContent = `Error: ${message}`;
        refusal.hidden = false;
        focus(refusal);
        live.announce(message);
      });
      dialog.body.append(refusal, months.field, el('div', { class: 'dialog-actions' }, [submit]));
      focus(months.input);
    };

    const licenceTable = (licences: Licence[]): HTMLElement =>
      el('div', { class: 'table-region', role: 'region', 'aria-label': 'Licences', tabindex: '0' }, [
        el('table', { class: 'table tabular' }, [
          el('caption', { class: 'table-caption', text: 'Licences' }),
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Talent' }),
              el('th', { scope: 'col', text: 'Client' }),
              el('th', { scope: 'col', text: 'Media' }),
              el('th', { scope: 'col', text: 'Ends' }),
              el('th', { scope: 'col', text: 'Status' }),
              el('th', { scope: 'col', text: 'Fee' }),
              el('th', { scope: 'col', text: 'Action' }),
            ]),
          ]),
          el('tbody', {}, licences.map((licence) => {
            const endDate = el('td', { 'data-licence-end': licence.id, text: formatIsoDateHuman(licence.endsOn) });
            const extend = el('button', { type: 'button', class: 'button button-quiet', text: 'Extend' });
            extend.addEventListener('click', () => extendDialog(licence, endDate, extend));
            return el('tr', {}, [
              el('th', { scope: 'row', text: licence.talentDisplayName }),
              el('td', { text: licence.clientCompany }),
              el('td', { text: licence.media }),
              endDate,
              el('td', { text: STATUS_LABELS[licence.status] }),
              el('td', { text: formatMoneyCents(licence.monthlyFeeCents) }),
              el('td', {}, [extend]),
            ]);
          })),
        ]),
      ]);

    const cardList = (licences: Licence[]): HTMLElement => {
      const list = el('ul', { class: 'licence-cards', 'aria-label': 'Licences' });
      for (const licence of licences) {
        const endDate = el('p', {
          class: 'tabular',
          'data-licence-end': licence.id,
          text: `Ends ${formatIsoDateHuman(licence.endsOn)}`,
        });
        const extend = el('button', { type: 'button', class: 'button', text: 'Extend' });
        extend.addEventListener('click', () => extendDialog(licence, endDate, extend));
        list.append(
          el('li', {}, [
            el('article', { class: 'licence-card', 'aria-label': `${licence.talentDisplayName}, ${licence.clientCompany}` }, [
              el('h2', { class: 'card-name', text: licence.talentDisplayName }),
              el('p', { text: licence.clientCompany }),
              endDate,
              el('p', { text: STATUS_LABELS[licence.status] }),
              el('div', { class: 'sticky-bar' }, [extend]),
            ]),
          ]),
        );
      }
      return list;
    };

    const openRecordDialog = (trigger: HTMLElement): void => {
      const dialog = openDialog({ title: 'Record licence', sheet: phoneViewport(), returnFocusTo: trigger });
      const problems = problemsSummary();
      const client = select({
        id: 'licence-client',
        label: 'Client',
        value: clients[0]?.id ?? '',
        choices: clients.map((entry) => ({ value: entry.id, label: entry.company })),
      });
      const talentField = select({
        id: 'licence-talent',
        label: 'Talent',
        value: talent[0]?.id ?? '',
        choices: talent.map((entry) => ({ value: entry.id, label: entry.displayName })),
      });
      const media = select({
        id: 'licence-media',
        label: 'Media',
        value: 'digital',
        choices: [
          { value: 'digital', label: 'Digital' },
          { value: 'print', label: 'Print' },
          { value: 'out_of_home', label: 'Out of home' },
          { value: 'broadcast', label: 'Broadcast' },
        ],
      });
      const territory = select({
        id: 'licence-territory',
        label: 'Territory',
        value: 'canada',
        choices: [
          { value: 'canada', label: 'Canada' },
          { value: 'north_america', label: 'North America' },
          { value: 'worldwide', label: 'Worldwide' },
        ],
      });
      const firstUse = textbox({ id: 'licence-first-use', label: 'First use date', type: 'date' });
      const months = textbox({ id: 'licence-months', label: 'Months', value: '1', inputmode: 'numeric' });
      const fee = textbox({ id: 'licence-fee', label: 'Monthly fee', value: '450.00', inputmode: 'decimal' });
      const submit = el('button', { type: 'button', class: 'button', text: 'Record licence' });
      submit.addEventListener('click', async () => {
        const spinner = pending(submit, 'Recording licence…');
        spinner.start();
        const result = await call<{ licence: Licence }>('POST', '/api/licences', {
          body: {
            clientId: client.node.value,
            talentId: talentField.node.value,
            media: media.node.value,
            territory: territory.node.value,
            firstUseDate: firstUse.input.value,
            termMonths: Number.parseInt(months.input.value || '0', 10),
            monthlyFeeCents: Math.round(Number(fee.input.value || '0') * 100),
          },
        });
        spinner.stop();
        if (result.body) {
          const licence = result.body.licence;
          live.announce(
            `Recorded licence for ${licence.talentDisplayName} with ${licence.clientCompany}, ending ${formatIsoDateHuman(licence.endsOn)}.`,
          );
          dialog.close();
          await draw();
          return;
        }
        if (result.status === 422 && result.error?.errors) {
          const ids: Record<string, string> = {
            clientId: 'licence-client',
            talentId: 'licence-talent',
            media: 'licence-media',
            territory: 'licence-territory',
            firstUseDate: 'licence-first-use',
            termMonths: 'licence-months',
            monthlyFeeCents: 'licence-fee',
          };
          problems.show(result.error.errors, ids, dialog.body);
          live.announce(copy.validation(Object.keys(result.error.errors).length));
          focus(dialog.body.querySelector<HTMLElement>(`#${ids[Object.keys(result.error.errors)[0]]}`));
          return;
        }
        live.announce(errorCopy(result.error, office));
      });
      dialog.body.append(
        problems.node,
        client.field,
        talentField.field,
        media.field,
        territory.field,
        firstUse.field,
        months.field,
        fee.field,
        el('div', { class: 'dialog-actions' }, [submit]),
      );
      focus(client.node);
    };

    await draw();
    return { node, chrome: 'workspace' };
  },
};

export const statementsIndexScreen: Screen = {
  pattern: '/workspace/statements',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const result = await call<{ talent: TalentRecord[] }>('GET', '/api/talent?state=active');
    const month = monthKeyOf(new Date());
    const list = el('ul', { class: 'plain-list' }, (result.body?.talent ?? []).map((entry) =>
      el('li', {}, [
        el('a', {
          class: 'link',
          href: `/workspace/statements/${entry.id}/${month}`,
          text: `${entry.displayName} — ${BOARD_TITLES[entry.board]}`,
        }),
      ])));
    return {
      node: el('main', { class: 'page page-workspace' }, [
        pageHeading('Statements', { display: false }),
        el('p', { class: 'lede', text: `Choose a talent to read their ${formatMonth(Number(month.slice(0, 4)), Number(month.slice(5)))} statement.` }),
        list,
      ]),
      chrome: 'workspace',
    };
  },
};

export const statementScreen: Screen = {
  pattern: '/workspace/statements/:talentId/:month',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const live = liveRegion('Statement announcements');
    const node = el('main', { class: 'page page-workspace page-statement' }, []);
    const monthKey = ctx.params.month;
    const parsed = parseMonthKey(monthKey);
    const canEdit = member.role === 'accounts_lead' || member.role === 'agency_director';
    const office = await officeOf(member.office);

    const draw = async (focusReference: string | null): Promise<void> => {
      const result = await call<Statement>('GET', `/api/talent/${ctx.params.talentId}/statements/${monthKey}`);
      clear(node);
      if (!result.body) {
        append(node, [
          pageHeading('Statement not found', { display: false }),
          isSessionError(result.error?.error) ? sessionEndedNotice((message) => live.announce(message)) : null,
          live.node,
        ]);
        return;
      }
      const statement = result.body;
      const rows = statement.lines.map((line) => {
        const reverse = el('button', { type: 'button', class: 'button button-quiet', text: 'Reverse' });
        reverse.addEventListener('click', () => openReverseDialog(line.movementId, reverse));
        return el('tr', { 'data-reference': line.reference }, [
          el('th', { scope: 'row', class: 'pinned', text: formatIsoDateHuman(line.officeDate) }),
          el('td', { text: line.kind === 'booking' ? 'Booking' : line.kind === 'advance' ? 'Advance' : 'Reversal' }),
          el('td', { text: line.reference }),
          el('td', { text: line.client }),
          el('td', { text: line.description }),
          el('td', { text: formatMoneyCents(line.amountCents) }),
          el('td', { text: formatMoneyCents(line.balanceCents) }),
          canEdit ? el('td', {}, [reverse]) : el('td', {}),
        ]);
      });

      const table = el('table', { class: 'table tabular statement-table' }, [
        el('caption', { class: 'table-caption', text: 'Statement' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', class: 'pinned', text: 'Date' }),
            el('th', { scope: 'col', text: 'Type' }),
            el('th', { scope: 'col', text: 'Reference' }),
            el('th', { scope: 'col', text: 'Client' }),
            el('th', { scope: 'col', text: 'Description' }),
            el('th', { scope: 'col', text: 'Amount (CAD)' }),
            el('th', { scope: 'col', text: 'Balance (CAD)' }),
            el('th', { scope: 'col', text: 'Action' }),
          ]),
        ]),
        el('tbody', {}, rows),
      ]);

      const advances = el('ul', { class: 'plain-list tabular' }, statement.advances.map((advance) =>
        el('li', {
          text: `${formatMoneyCents(advance.amountCents)} — recouped ${formatMoneyCents(advance.recoupedCents)}, outstanding ${formatMoneyCents(advance.outstandingCents)}`,
        })));

      const recordAdvance = el('button', { type: 'button', class: 'button', text: 'Record advance' });
      recordAdvance.addEventListener('click', () => openAdvanceDialog(recordAdvance));
      const exportCsv = el('button', { type: 'button', class: 'button button-quiet', text: 'Export CSV' });
      exportCsv.addEventListener('click', async () => {
        const spinner = pending(exportCsv, 'Preparing export…');
        spinner.start();
        const response = await fetch(`/api/talent/${ctx.params.talentId}/statements/${monthKey}.csv`);
        spinner.stop();
        if (!response.ok) {
          live.announce(response.status === 503 ? copy.storageUnavailable : 'That export could not be prepared.');
          focus(exportCsv);
          return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = el('a', { href: url, download: `statement-${monthKey}.csv` });
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        live.announce(`Statement for ${parsed ? formatMonth(parsed.year, parsed.month) : monthKey} downloaded.`);
        focus(exportCsv);
      });

      node.append(
        pageHeading(`Statement — ${statement.displayName}`, { display: false }),
        el('p', { class: 'lede tabular', text: `${parsed ? formatMonth(parsed.year, parsed.month) : monthKey}. Opening ${formatMoneyCents(statement.openingBalanceCents)}, closing ${formatMoneyCents(statement.closingBalanceCents)}.` }),
        el('section', { 'aria-label': 'Statement lines', class: 'table-region', tabindex: '0' }, [table]),
        el('h2', { class: 'section-heading', text: 'Advances' }),
        advances,
        canEdit ? el('div', { class: 'actions' }, [recordAdvance, exportCsv]) : el('div', { class: 'actions' }, [exportCsv]),
        live.node,
      );
      if (focusReference) {
        const cell = node.querySelector<HTMLElement>(`[data-reference="${focusReference}"] .pinned`);
        focus(cell);
      }
    };

    const openAdvanceDialog = (trigger: HTMLElement): void => {
      const dialog = openDialog({ title: 'Record advance', sheet: phoneViewport(), returnFocusTo: trigger });
      const problems = problemsSummary();
      const amount = textbox({ id: 'advance-amount', label: 'Amount', inputmode: 'decimal' });
      const note = textbox({ id: 'advance-note', label: 'Note' });
      const submit = el('button', { type: 'button', class: 'button', text: 'Save advance' });
      submit.addEventListener('click', async () => {
        const raw = amount.input.value.trim();
        const spinner = pending(submit, 'Saving advance…');
        spinner.start();
        const result = await call<{ movement: { reference: string } }>(
          'POST',
          `/api/talent/${ctx.params.talentId}/advances`,
          {
            body: {
              ...(raw ? { amountCents: Math.round(Number(raw) * 100) } : {}),
              note: note.input.value,
            },
          },
        );
        spinner.stop();
        if (result.body) {
          dialog.close();
          live.announce(
            `Recorded an advance of ${formatMoneyCents(Math.round(Number(raw) * 100))} for this talent.`,
          );
          await draw(result.body.movement.reference);
          return;
        }
        if (result.status === 422 && result.error?.errors) {
          problems.show(result.error.errors, { amountCents: 'advance-amount', note: 'advance-note' }, dialog.body);
          live.announce(copy.validation(Object.keys(result.error.errors).length));
          focus(amount.input);
          return;
        }
        live.announce(errorCopy(result.error, office));
      });
      dialog.body.append(problems.node, amount.field, note.field, el('div', { class: 'dialog-actions' }, [submit]));
      focus(amount.input);
    };

    const openReverseDialog = (movementId: string, trigger: HTMLElement): void => {
      const dialog = openDialog({ title: 'Reverse entry', sheet: phoneViewport(), returnFocusTo: trigger });
      const refusal = el('p', { class: 'dialog-refusal field-error', hidden: true, tabindex: '-1' });
      const reason = textbox({ id: 'reverse-reason', label: 'Reason' });
      const submit = el('button', { type: 'button', class: 'button', text: 'Reverse entry' });
      submit.addEventListener('click', async () => {
        refusal.hidden = true;
        const spinner = pending(submit, 'Reversing…');
        spinner.start();
        const result = await call<{ movement: { reference: string } }>(
          'POST',
          `/api/ledger/movements/${movementId}/reversal`,
          { body: { reason: reason.input.value } },
        );
        spinner.stop();
        if (result.body) {
          dialog.close();
          const ledger = await call<{ balanceCents: number }>('GET', `/api/talent/${ctx.params.talentId}/ledger`);
          live.announce(
            `Reversed ${result.body.movement.reference}. The balance is now ${formatMoneyCents(ledger.body?.balanceCents ?? 0)}.`,
          );
          await draw(result.body.movement.reference);
          return;
        }
        if (result.status === 422 && result.error?.errors) {
          setFieldError(dialog.body, 'reverse-reason', Object.values(result.error.errors)[0]);
          live.announce(copy.validation(Object.keys(result.error.errors).length));
          focus(reason.input);
          return;
        }
        const code = result.error?.error;
        const message = code === 'already_reversed'
          ? `This entry was already reversed by ${String(result.error?.reversedBy ?? '')} at ${officeTime(String(result.error?.reversedAt ?? ''), office)}.`
          : code === 'not_invoiced'
            ? 'That booking is not invoiced yet, so it cannot be reversed.'
            : errorCopy(result.error, office);
        refusal.textContent = `Error: ${message}`;
        refusal.hidden = false;
        focus(refusal);
        live.announce(message);
      });
      dialog.body.append(refusal, reason.field, el('div', { class: 'dialog-actions' }, [submit]));
      focus(reason.input);
    };

    await draw(null);
    return { node, chrome: 'workspace' };
  },
};

export const overviewScreen: Screen = {
  pattern: '/workspace/overview',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const month = monthKeyOf(new Date());
    const [bookings, licences, talent] = await Promise.all([
      call<{ bookings: Booking[] }>('GET', `/api/bookings?month=${month}`),
      call<{ counts: Record<string, number>; licences: Licence[] }>('GET', '/api/licences'),
      call<{ talent: TalentRecord[] }>('GET', '/api/talent?state=active'),
    ]);
    const sections = (['toronto', 'vancouver'] as const).map((officeId) => {
      const officeBookings = (bookings.body?.bookings ?? []).filter((booking) => booking.office === officeId);
      const officeTalent = (talent.body?.talent ?? []).filter((entry) => entry.office === officeId);
      return el('section', { class: 'overview-office', 'aria-label': officeId === 'toronto' ? 'Toronto' : 'Vancouver' }, [
        el('h2', { class: 'section-heading', text: officeId === 'toronto' ? 'Toronto' : 'Vancouver' }),
        el('dl', { class: 'facts tabular' }, [
          el('dt', { text: 'Bookings this month' }),
          el('dd', { text: String(officeBookings.length) }),
          el('dt', { text: 'Talent on the boards' }),
          el('dd', { text: String(officeTalent.length) }),
          el('dt', { text: 'Licences active' }),
          el('dd', { text: String(licences.body?.counts.active ?? 0) }),
          el('dt', { text: 'Licences expiring' }),
          el('dd', { text: String(licences.body?.counts.expiring ?? 0) }),
          el('dt', { text: 'Licences expired' }),
          el('dd', { text: String(licences.body?.counts.expired ?? 0) }),
          el('dt', { text: 'Statements due' }),
          el('dd', { text: String(officeTalent.length) }),
        ]),
      ]);
    });
    return {
      node: el('main', { class: 'page page-workspace' }, [
        pageHeading('Overview', { display: false }),
        ...sections,
      ]),
      chrome: 'workspace',
    };
  },
};

export const myCalendarScreen: Screen = {
  pattern: '/workspace/me',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const live = liveRegion('Calendar announcements');
    const office = await officeOf(member.office);
    const feed = await call<{ url: string }>('GET', '/api/me/calendar-feed');
    const ladder = member.talentId
      ? await call<{ days: Array<{ date: string; dayState: string; options: Array<{ clientCompany: string; rank: number | null; state: string; jobTitle: string }> }> }>(
        'GET',
        `/api/talent/${member.talentId}/ladder?days=14`,
      )
      : null;
    const month = monthKeyOf(new Date());

    const link = el('input', { class: 'input', id: 'feed-link', readonly: true, value: feed.body?.url ?? '' });
    const regenerate = el('button', { type: 'button', class: 'button', text: 'Regenerate feed link' });
    regenerate.addEventListener('click', async () => {
      const spinner = pending(regenerate, 'Creating new link…');
      spinner.start();
      const result = await call<{ url: string }>('POST', '/api/me/calendar-feed', { body: {} });
      spinner.stop();
      if (result.body) {
        link.value = result.body.url;
        live.announce('New feed link ready. The old link no longer works.');
        return;
      }
      live.announce(errorCopy(result.error, office));
    });

    const days = (ladder?.body?.days ?? []).map((day) =>
      el('li', { class: 'my-day' }, [
        el('span', { class: 'tabular', text: formatIsoDateHuman(day.date) }),
        el('span', {
          text: day.options.length === 0
            ? 'Open'
            : day.options
              .map((option) =>
                option.state === 'confirmed'
                  ? `Booked ${option.clientCompany}`
                  : `${option.rank === 1 ? '1st' : option.rank === 2 ? '2nd' : '3rd'} ${option.clientCompany}`)
              .join(', '),
        }),
      ]));

    return {
      node: el('main', { class: 'page page-workspace' }, [
        pageHeading('My calendar', { display: false }),
        el('ul', { class: 'plain-list', 'aria-label': 'Next 14 days' }, days),
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label', for: 'feed-link', text: 'Feed link' }),
          link,
        ]),
        regenerate,
        member.talentId
          ? el('a', {
            class: 'link',
            href: `/workspace/statements/${member.talentId}/${month}`,
            text: 'My statement',
          })
          : null,
        live.node,
      ]),
      chrome: 'workspace',
    };
  },
};
