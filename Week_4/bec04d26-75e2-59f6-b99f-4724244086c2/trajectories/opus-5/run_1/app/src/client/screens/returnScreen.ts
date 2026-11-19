import { ReturnRecord } from '../../shared/types';
import { longDateString } from '../../shared/dates';
import type { App } from '../app';
import { centralStamp } from '../clock';
import { el } from '../dom';
import { returnData, tile } from '../components/tile';
import { isUnfiled } from '../../shared/status';

const CARRY_LABELS: Record<string, string> = {
  next_business: 'Next business day',
  fixed: 'Fixed date',
};

export function editionLine(record: ReturnRecord): string {
  const edition = record.edition;
  return `Rule edition effective ${edition.effective_date} · due day ${edition.due_day} · ${CARRY_LABELS[edition.carry]} · reference rate ${edition.rate}%`;
}

function amountsForm(app: App, record: ReturnRecord): HTMLElement | null {
  if (record.status !== 'not_started' && record.status !== 'prepared') return null;
  const draft = app.draft(record);
  const errors = app.state.formErrors;
  const submit = (): void => {
    void app.saveAmounts(record);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };
  const field = (name: 'gross_sales' | 'tax_due', label: string): HTMLElement => {
    const id = `amount-${name}`;
    const message = errors[name];
    return el(
      'div',
      { class: 'field' },
      el('label', { for: id }, label),
      el('input', {
        id,
        type: 'text',
        inputmode: 'decimal',
        value: draft[name],
        'data-focus-key': `amount:${name}`,
        'aria-invalid': message ? 'true' : null,
        'aria-describedby': message ? `${id}-error` : null,
        onInput: (event: Event) => {
          app.setDraft(record.id, { [name]: (event.target as HTMLInputElement).value });
        },
        onKeydown: onKeyDown,
      }),
      message
        ? el('span', { class: 'field-error', id: `${id}-error`, 'data-field-error': name }, message)
        : null,
    );
  };

  return el(
    'div',
    { class: 'card' },
    el('h2', {}, 'Amounts'),
    field('gross_sales', 'Gross sales'),
    field('tax_due', 'Tax due'),
    el(
      'div',
      { class: 'row' },
      el(
        'button',
        {
          type: 'button',
          class: 'primary',
          'data-focus-key': 'save-amounts',
          onClick: submit,
        },
        app.isBusy('save-amounts') ? 'Saving' : 'Save amounts',
      ),
      record.status === 'not_started'
        ? el(
            'button',
            {
              type: 'button',
              'data-focus-key': 'mark-prepared',
              onClick: () => {
                void app.markPrepared(record);
              },
            },
            app.isBusy('mark-prepared') ? 'Saving' : 'Mark prepared',
          )
        : null,
    ),
  );
}

function bookkeeperActions(app: App, record: ReturnRecord): HTMLElement {
  const buttons: (HTMLElement | null)[] = [
    record.status === 'client_approved'
      ? el(
          'button',
          {
            type: 'button',
            class: 'primary',
            'data-focus-key': 'mark-filed',
            onClick: () =>
              app.openDialog({
                kind: 'mark-filed',
                openerKey: 'mark-filed',
                clientId: record.client.id,
                clientName: record.client.name,
                stateCode: record.state,
                returnId: record.id,
                fields: {},
              }),
          },
          'Mark filed',
        )
      : null,
    isUnfiled(record.status) && record.extension === null
      ? el(
          'button',
          {
            type: 'button',
            'data-focus-key': 'file-extension',
            onClick: () =>
              app.openDialog({
                kind: 'file-extension',
                openerKey: 'file-extension',
                clientId: record.client.id,
                clientName: record.client.name,
                stateCode: record.state,
                returnId: record.id,
                fields: {},
              }),
          },
          'File extension',
        )
      : null,
    record.status === 'filed' || record.status === 'packeted'
      ? el(
          'button',
          {
            type: 'button',
            'data-focus-key': 'record-amendment',
            onClick: () =>
              app.openDialog({
                kind: 'record-amendment',
                openerKey: 'record-amendment',
                clientId: record.client.id,
                clientName: record.client.name,
                stateCode: record.state,
                returnId: record.id,
                fields: {
                  gross_sales: record.gross_sales ?? '',
                  tax_due: record.tax_due ?? '',
                  note: '',
                },
              }),
          },
          'Record amendment',
        )
      : null,
  ];
  return el('div', { class: 'row' }, ...buttons);
}

function ownerActions(app: App, record: ReturnRecord): HTMLElement {
  const name = `${record.state} ${record.period_label}`;
  const canApprove = record.status === 'prepared' && record.awaiting_approval;
  const canSendBack = canApprove || record.status === 'client_approved';
  return el(
    'div',
    { class: 'pinned-actions' },
    canSendBack
      ? el(
          'button',
          {
            type: 'button',
            'data-focus-key': 'send-back',
            onClick: () => app.openSendBack(record),
          },
          `Send back ${name}`,
        )
      : null,
    canApprove
      ? el(
          'button',
          {
            type: 'button',
            class: 'primary',
            'data-focus-key': 'approve',
            onClick: () => {
              void app.approve(record);
            },
          },
          app.isBusy('approve') ? 'Saving' : `Approve ${name}`,
        )
      : null,
  );
}

function remindersRegion(app: App): HTMLElement {
  return el(
    'section',
    { role: 'region', 'aria-label': 'Reminders', class: 'quiet-card' },
    el('h2', {}, 'Reminders'),
    app.state.reminders.length === 0
      ? el('p', { class: 'hint' }, 'No reminders are scheduled.')
      : el(
          'ul',
          { class: 'stack' },
          ...app.state.reminders.map((reminder) =>
            el(
              'li',
              { 'data-lead-days': String(reminder.lead_days) },
              `${reminder.lead_days === 7 ? '7 days' : '1 day'} before · ${centralStamp(reminder.scheduled_for)} · ${
                reminder.status === 'sent' ? 'Sent' : 'Pending'
              }`,
            ),
          ),
        ),
  );
}

function approvalsRegion(record: ReturnRecord): HTMLElement {
  return el(
    'section',
    { role: 'region', 'aria-label': 'Approvals', class: 'quiet-card' },
    el('h2', {}, 'Approvals'),
    record.approvals.length === 0
      ? el('p', { class: 'hint' }, 'No approvals yet.')
      : el(
          'ul',
          { class: 'stack' },
          ...record.approvals.map((approval) =>
            el(
              'li',
              {},
              approval.action === 'approved'
                ? `Approved by ${approval.by} on ${centralStamp(approval.at)}`
                : `Sent back by ${approval.by} on ${centralStamp(approval.at)}: ${approval.reason ?? ''}`,
            ),
          ),
        ),
  );
}

function amendmentsRegion(record: ReturnRecord): HTMLElement {
  return el(
    'section',
    { role: 'region', 'aria-label': 'Amendments', class: 'quiet-card' },
    el('h2', {}, 'Amendments'),
    record.amendments.length === 0
      ? el('p', { class: 'hint' }, 'No amendments.')
      : el(
          'ul',
          { class: 'stack' },
          ...record.amendments.map((amendment) =>
            el(
              'li',
              {},
              el(
                'div',
                { class: 'definition' },
                el('span', {}, 'Original'),
                el(
                  'span',
                  {},
                  `gross sales ${amendment.original.gross_sales}, tax due ${amendment.original.tax_due}`,
                ),
                el('span', {}, 'Amended'),
                el(
                  'span',
                  {},
                  `gross sales ${amendment.amended.gross_sales}, tax due ${amendment.amended.tax_due}`,
                ),
              ),
              el('p', { class: 'hint' }, `${amendment.by} on ${centralStamp(amendment.at)}`),
              amendment.note ? el('p', {}, amendment.note) : null,
            ),
          ),
        ),
  );
}

function packetRegion(record: ReturnRecord): HTMLElement {
  return el(
    'section',
    { role: 'region', 'aria-label': 'Filing packet', class: 'quiet-card' },
    el('h2', {}, 'Filing packet'),
    record.packet === 'ready'
      ? el(
          'a',
          {
            href: `/api/returns/${record.id}/packet`,
            target: '_blank',
            rel: 'noopener',
            'data-focus-key': 'filing-packet',
          },
          'Filing packet',
        )
      : record.packet === 'pending'
        ? el('p', {}, 'Packet pending')
        : el('p', { class: 'hint' }, 'No packet until this return is filed.'),
    record.packet_revisions > 0
      ? el('p', { class: 'hint' }, `Packet revision ${record.packet_revisions}`)
      : null,
  );
}

function latestSavedRegion(record: ReturnRecord): HTMLElement {
  return el(
    'section',
    { role: 'region', 'aria-label': 'Latest saved return', class: 'quiet-card' },
    el(
      'p',
      {},
      `Saved: gross sales ${record.gross_sales ?? '—'}, tax due ${record.tax_due ?? '—'}, version ${record.version}, ${record.status_label}`,
    ),
  );
}

export function renderReturn(app: App): HTMLElement {
  const record = app.state.detail;
  const me = app.state.me;
  if (!record || !me) return el('main', { class: 'screen' });
  const bookkeeper = me.user.role === 'bookkeeper';

  return el(
    'main',
    { class: 'screen form-layout', ...returnData(record) },
    el(
      'div',
      { class: 'form-column' },
      el(
        'h1',
        { tabindex: '-1', 'data-focus-key': 'return-heading' },
        `${record.client.name} · ${record.state_name} ${record.period_label}`,
      ),
      el('p', { class: 'hero-deadline', style: 'margin:0.75rem 0' }, `${record.state} ${longDateString(record.due_date)}`),
      el('p', {}, record.due_line),
      record.carried_from
        ? el('p', { class: 'carried-line' }, `Carried from ${longDateString(record.carried_from)}`)
        : null,
      el('p', {}, editionLine(record)),
      el(
        'p',
        { class: 'row', style: 'margin-top:0.75rem' },
        el(
          'span',
          { class: `chip chip-${record.overdue ? 'black' : 'sage'}`, 'data-status-chip': record.status },
          record.overdue ? `${record.status_label} · Overdue` : record.status_label,
        ),
      ),
      record.extension
        ? el('p', {}, `Extended to ${longDateString(record.due_date)}`)
        : null,
      bookkeeper ? amountsForm(app, record) : null,
      bookkeeper ? bookkeeperActions(app, record) : ownerActions(app, record),
      bookkeeper ? remindersRegion(app) : null,
      approvalsRegion(record),
      amendmentsRegion(record),
      packetRegion(record),
      latestSavedRegion(record),
    ),
    el('div', { class: 'pinned-tile' }, tile(record)),
  );
}
