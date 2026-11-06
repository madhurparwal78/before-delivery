import type { Locale } from '../../shared/money.ts';
import { AUDITORIUMS, FORMATS } from '../../shared/domain.ts';
import type { Role } from '../../shared/domain.ts';
import { esc, h, labelled, tel } from './html.ts';
import { heading } from './layout.ts';

function doorSection(locale: Locale): string {
  return h(
    'section',
    { class: 'panel', id: 'door-section' },
    tel('h2', locale, 'staff_door'),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'door_screening', undefined, { for: 'door-screening' }),
      h('select', { id: 'door-screening', 'aria-describedby': 'door-screening-error' }),
      h('p', { class: 'field-error', id: 'door-screening-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'door_search', undefined, { for: 'door-search' }),
      h('input', { type: 'search', id: 'door-search', 'aria-describedby': 'door-search-error' }),
      h('p', { class: 'field-error', id: 'door-search-error' }),
    ),
    tel('button', locale, 'check_in', undefined, { type: 'button', id: 'check-in', class: 'primary' }),
    h(
      'table',
      { class: 'door-list', id: 'door-list', ...labelled(locale, 'door_list') },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          tel('th', locale, 'col_seat', undefined, { scope: 'col' }),
          tel('th', locale, 'col_initial', undefined, { scope: 'col' }),
          tel('th', locale, 'col_ticket', undefined, { scope: 'col' }),
          tel('th', locale, 'col_status', undefined, { scope: 'col' }),
        ),
      ),
      h('tbody', { id: 'door-list-body' }),
    ),
  );
}

function programmeSection(locale: Locale): string {
  return h(
    'section',
    { class: 'panel', id: 'programme-section' },
    tel('h2', locale, 'staff_programme'),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'season_slug', undefined, { for: 'season-slug' }),
      h('input', { type: 'text', id: 'season-slug', 'aria-describedby': 'season-slug-error' }),
      h('p', { class: 'field-error', id: 'season-slug-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'title_en', undefined, { for: 'season-title-en' }),
      h('input', { type: 'text', id: 'season-title-en', 'aria-describedby': 'season-title-en-error' }),
      h('p', { class: 'field-error', id: 'season-title-en-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'title_fr', undefined, { for: 'season-title-fr' }),
      h('input', { type: 'text', id: 'season-title-fr', 'aria-describedby': 'season-title-fr-error' }),
      h('p', { class: 'field-error', id: 'season-title-fr-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'public_sale_date', undefined, { for: 'season-sale-date' }),
      h('input', { type: 'date', id: 'season-sale-date', 'aria-describedby': 'season-sale-date-error' }),
      h('p', { class: 'field-error', id: 'season-sale-date-error' }),
    ),
    tel('button', locale, 'create_season', undefined, { type: 'button', id: 'create-season', class: 'primary' }),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'season_select', undefined, { for: 'screening-season' }),
      h('select', { id: 'screening-season', 'aria-describedby': 'screening-season-error' }),
      h('p', { class: 'field-error', id: 'screening-season-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'film_title', undefined, { for: 'screening-film' }),
      h('input', { type: 'text', id: 'screening-film', 'aria-describedby': 'screening-film-error' }),
      h('p', { class: 'field-error', id: 'screening-film-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'format_select', undefined, { for: 'screening-format' }),
      h(
        'select',
        { id: 'screening-format', 'aria-describedby': 'screening-format-error' },
        ...FORMATS.map((format) => h('option', { value: format }, esc(format))),
      ),
      h('p', { class: 'field-error', id: 'screening-format-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'auditorium_select', undefined, { for: 'screening-auditorium' }),
      h(
        'select',
        { id: 'screening-auditorium', 'aria-describedby': 'screening-auditorium-error' },
        ...AUDITORIUMS.map((code) => h('option', { value: code }, esc(code))),
      ),
      h('p', { class: 'field-error', id: 'screening-auditorium-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'first_showtime', undefined, { for: 'screening-first' }),
      h('input', { type: 'datetime-local', id: 'screening-first', 'aria-describedby': 'screening-first-error' }),
      h('p', { class: 'field-error', id: 'screening-first-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'weekly_occurrences', undefined, { for: 'screening-weeks' }),
      h('input', {
        type: 'number',
        id: 'screening-weeks',
        min: 1,
        max: 26,
        step: 1,
        value: 1,
        'aria-describedby': 'screening-weeks-error',
      }),
      h('p', { class: 'field-error', id: 'screening-weeks-error' }),
    ),
    tel('button', locale, 'add_screenings', undefined, { type: 'button', id: 'add-screenings', class: 'primary' }),
    h(
      'table',
      { class: 'seasons-table', id: 'seasons-table', ...labelled(locale, 'seasons_table') },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          tel('th', locale, 'col_slug', undefined, { scope: 'col' }),
          tel('th', locale, 'col_state', undefined, { scope: 'col' }),
          tel('th', locale, 'col_actions', undefined, { scope: 'col' }),
        ),
      ),
      h('tbody', { id: 'seasons-body' }),
    ),
    h(
      'div',
      {
        id: 'withdraw-dialog',
        class: 'dialog',
        role: 'dialog',
        'aria-modal': 'true',
        ...labelled(locale, 'withdraw_season'),
        hidden: true,
      },
      tel('h2', locale, 'withdraw_season'),
      h(
        'div',
        { class: 'field' },
        tel('label', locale, 'reason', undefined, { for: 'withdraw-reason' }),
        h('input', { type: 'text', id: 'withdraw-reason', 'aria-describedby': 'withdraw-reason-error' }),
        h('p', { class: 'field-error', id: 'withdraw-reason-error' }),
      ),
      tel('button', locale, 'confirm_withdrawal', undefined, {
        type: 'button',
        id: 'confirm-withdrawal',
        class: 'primary',
      }),
      tel('button', locale, 'close', undefined, { type: 'button', id: 'withdraw-close', class: 'secondary' }),
    ),
  );
}

function financeSection(locale: Locale): string {
  return h(
    'section',
    { class: 'panel', id: 'finance-section' },
    tel('h2', locale, 'staff_finance'),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'find_booking', undefined, { for: 'finance-search' }),
      h('input', { type: 'search', id: 'finance-search', 'aria-describedby': 'finance-search-error' }),
      h('p', { class: 'field-error', id: 'finance-search-error' }),
    ),
    tel('button', locale, 'search', undefined, { type: 'button', id: 'finance-search-button', class: 'primary' }),
    h('div', { id: 'finance-result', class: 'finance-result' }),
    h(
      'div',
      {
        id: 'refund-dialog',
        class: 'dialog',
        role: 'dialog',
        'aria-modal': 'true',
        ...labelled(locale, 'refund_booking'),
        hidden: true,
      },
      tel('h2', locale, 'refund_booking'),
      h(
        'div',
        { class: 'field' },
        tel('label', locale, 'reason', undefined, { for: 'refund-reason' }),
        h('input', { type: 'text', id: 'refund-reason', 'aria-describedby': 'refund-reason-error' }),
        h('p', { class: 'field-error', id: 'refund-reason-error' }),
      ),
      tel('button', locale, 'confirm_refund', undefined, { type: 'button', id: 'confirm-refund', class: 'primary' }),
      tel('button', locale, 'close', undefined, { type: 'button', id: 'refund-close', class: 'secondary' }),
    ),
    h(
      'div',
      {
        id: 'goodwill-dialog',
        class: 'dialog',
        role: 'dialog',
        'aria-modal': 'true',
        ...labelled(locale, 'issue_goodwill'),
        hidden: true,
      },
      tel('h2', locale, 'issue_goodwill'),
      h(
        'div',
        { class: 'field' },
        tel('label', locale, 'amount_in_dollars', undefined, { for: 'goodwill-amount' }),
        h('input', { type: 'text', id: 'goodwill-amount', 'aria-describedby': 'goodwill-amount-error' }),
        h('p', { class: 'field-error', id: 'goodwill-amount-error' }),
      ),
      h(
        'div',
        { class: 'field' },
        tel('label', locale, 'reason', undefined, { for: 'goodwill-reason' }),
        h('input', { type: 'text', id: 'goodwill-reason', 'aria-describedby': 'goodwill-reason-error' }),
        h('p', { class: 'field-error', id: 'goodwill-reason-error' }),
      ),
      tel('button', locale, 'issue_credit', undefined, { type: 'button', id: 'issue-credit', class: 'primary' }),
      tel('button', locale, 'close', undefined, { type: 'button', id: 'goodwill-close', class: 'secondary' }),
    ),
    h(
      'section',
      { class: 'panel', role: 'region', ...labelled(locale, 'region_reconciliation') },
      tel('h3', locale, 'region_reconciliation'),
      h(
        'div',
        { class: 'field' },
        tel('label', locale, 'business_day', undefined, { for: 'recon-date' }),
        h('input', { type: 'date', id: 'recon-date', 'aria-describedby': 'recon-date-error' }),
        h('p', { class: 'field-error', id: 'recon-date-error' }),
      ),
      tel('button', locale, 'load_day', undefined, { type: 'button', id: 'load-day', class: 'primary' }),
      h(
        'table',
        { class: 'takings', id: 'takings', ...labelled(locale, 'takings_table') },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            tel('th', locale, 'col_figure', undefined, { scope: 'col' }),
            tel('th', locale, 'col_local', undefined, { scope: 'col' }),
            tel('th', locale, 'col_killbill', undefined, { scope: 'col' }),
          ),
        ),
        h('tbody', { id: 'takings-body' }),
      ),
      tel('a', locale, 'download_csv', undefined, { id: 'download-csv', href: '/api/finance/reconciliation.csv' }),
      tel('button', locale, 'accept_killbill', undefined, {
        type: 'button',
        id: 'accept-killbill',
        class: 'secondary',
      }),
      h(
        'div',
        {
          id: 'accept-dialog',
          class: 'dialog',
          role: 'dialog',
          'aria-modal': 'true',
          ...labelled(locale, 'accept_killbill'),
          hidden: true,
        },
        tel('h2', locale, 'accept_killbill'),
        h(
          'div',
          { class: 'field' },
          tel('label', locale, 'reason', undefined, { for: 'accept-reason' }),
          h('input', { type: 'text', id: 'accept-reason', 'aria-describedby': 'accept-reason-error' }),
          h('p', { class: 'field-error', id: 'accept-reason-error' }),
        ),
        tel('button', locale, 'confirm', undefined, { type: 'button', id: 'confirm-accept', class: 'primary' }),
        tel('button', locale, 'close', undefined, { type: 'button', id: 'accept-close', class: 'secondary' }),
      ),
    ),
    h(
      'table',
      { class: 'audit', id: 'audit-table', ...labelled(locale, 'audit_list') },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          tel('th', locale, 'col_when', undefined, { scope: 'col' }),
          tel('th', locale, 'col_actor', undefined, { scope: 'col' }),
          tel('th', locale, 'col_action', undefined, { scope: 'col' }),
          tel('th', locale, 'col_target', undefined, { scope: 'col' }),
          tel('th', locale, 'col_amount', undefined, { scope: 'col' }),
          tel('th', locale, 'col_reason', undefined, { scope: 'col' }),
        ),
      ),
      h('tbody', { id: 'audit-body' }),
    ),
    h(
      'table',
      { class: 'outbox', id: 'outbox-table', ...labelled(locale, 'mail_outbox') },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          tel('th', locale, 'col_when', undefined, { scope: 'col' }),
          tel('th', locale, 'col_to', undefined, { scope: 'col' }),
          tel('th', locale, 'col_subject', undefined, { scope: 'col' }),
          tel('th', locale, 'col_state', undefined, { scope: 'col' }),
        ),
      ),
      h('tbody', { id: 'outbox-body' }),
    ),
    h(
      'table',
      { class: 'enquiries', id: 'enquiries-table', ...labelled(locale, 'enquiries_table') },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          tel('th', locale, 'col_reference', undefined, { scope: 'col' }),
          tel('th', locale, 'col_subject', undefined, { scope: 'col' }),
          tel('th', locale, 'col_state', undefined, { scope: 'col' }),
          tel('th', locale, 'col_actions', undefined, { scope: 'col' }),
        ),
      ),
      h('tbody', { id: 'enquiries-body' }),
    ),
    h(
      'div',
      { id: 'enquiry-reply', class: 'field', hidden: true },
      tel('label', locale, 'reply', undefined, { for: 'reply-body' }),
      h('textarea', { id: 'reply-body', rows: 4, 'aria-describedby': 'reply-body-error' }, ''),
      h('p', { class: 'field-error', id: 'reply-body-error' }),
      tel('button', locale, 'send_reply', undefined, { type: 'button', id: 'send-reply', class: 'primary' }),
    ),
  );
}

export function staffMain(locale: Locale, role: Role): string {
  const links: string[] = [];
  if (role === 'door') links.push(h('li', {}, tel('a', locale, 'staff_door', undefined, { href: '#door-section' })));
  if (role === 'programmer') {
    links.push(h('li', {}, tel('a', locale, 'staff_programme', undefined, { href: '#programme-section' })));
  }
  if (role === 'finance') {
    links.push(h('li', {}, tel('a', locale, 'staff_finance', undefined, { href: '#finance-section' })));
  }
  return [
    heading(locale, 'staff_heading'),
    h('nav', { class: 'staff-nav', ...labelled(locale, 'staff_nav') }, h('ul', {}, ...links)),
    h('p', { id: 'staff-status', role: 'status', 'aria-live': 'polite', ...labelled(locale, 'staff_status') }),
    h('p', { id: 'staff-error', role: 'alert', class: 'error-text', ...labelled(locale, 'staff_error') }),
    role === 'door' ? doorSection(locale) : '',
    role === 'programmer' ? programmeSection(locale) : '',
    role === 'finance' ? financeSection(locale) : '',
  ].join('');
}
