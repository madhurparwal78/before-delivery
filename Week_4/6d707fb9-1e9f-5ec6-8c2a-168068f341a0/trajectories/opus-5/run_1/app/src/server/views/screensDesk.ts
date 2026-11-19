import {
  COUNTRY_NAMES,
  LABEL_STATE_NAMES,
  REQUEST_STATE_NAMES,
  STYLE_STATE_NAMES,
  copy,
} from '../domain/copy';
import {
  LISBON,
  TOWNS,
  type Town,
  dayHours,
  localDate,
  localTime,
  shownDate,
  shownDateOfLocalDate,
} from '../domain/time';
import { requestState } from '../store/read';
import type {
  LabelRow,
  PassportRow,
  ReadingRow,
  RequestRow,
  StyleRowRecord,
  SupplierRow,
  VisitRow,
} from '../store/rows';
import { html, raw } from './html';
import { actionBar, arrivalMark, heading, page } from './layout';
import { dialog, field, selectField, tableFrame } from './parts';
import { meterFragment, rowMenuFragment } from './fragments';

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TOWN_OPTIONS = (Object.keys(TOWNS) as Town[]).map((town) => ({ value: town, name: TOWNS[town].name }));
const LANGUAGE_OPTIONS = [
  { value: 'en', name: 'English' },
  { value: 'fr', name: 'French' },
  { value: 'tr', name: 'Turkish' },
  { value: 'ar', name: 'Arabic' },
];
const COUNTRY_OPTIONS: { value: string; name: string }[] = Object.entries(COUNTRY_NAMES).map(([value, name]) => ({ value, name: name as string }));

export function labelsScreen(labels: LabelRow[]): string {
  const rows = labels
    .map(
      (label) => `<tr data-key="${label.id}">
        <td><a href="/labels/${label.id}">${escape(label.name)}</a></td>
        <td>${LABEL_STATE_NAMES[label.state]}</td>
        <td>${escape(label.contact_name ?? '')}</td>
      </tr>`,
    )
    .join('');

  const main = html`
    ${heading('Labels')}
    ${actionBar(html`<button type="button" class="button green" data-action="open-dialog" data-target="new-label">New label</button>`)}
    ${tableFrame(
      'Labels table',
      html`<table class="plain">
        <thead><tr><th scope="col">Label</th><th scope="col">State</th><th scope="col">Contact</th></tr></thead>
        <tbody>${raw(rows)}</tbody>
      </table>`,
    )}
    <p class="panel-actions"><button type="button" class="button" data-action="open-dialog" data-target="change-password">Change password</button></p>
  `;

  const dialogs = html`
    ${dialog({
      id: 'new-label',
      name: 'New label',
      body: html`
        ${field({ id: 'label-name', label: 'Name', name: 'name' })}
        ${field({ id: 'label-contact-name', label: 'Contact name', name: 'contactName' })}
        ${field({ id: 'label-contact-email', label: 'Contact email', name: 'contactEmail' })}
      `,
      actions: html`
        <button type="button" class="button green" data-action="save-label">Save label</button>
        <button type="button" class="button quiet" data-action="close-dialog">Close</button>
      `,
    })}
    ${dialog({
      id: 'change-password',
      name: 'Change password',
      body: html`
        ${field({
          id: 'current-password',
          label: 'Current password',
          name: 'currentPassword',
          kind: 'password',
          autocomplete: 'current-password',
        })}
        ${field({
          id: 'new-password',
          label: 'New password',
          name: 'newPassword',
          kind: 'password',
          autocomplete: 'new-password',
        })}
      `,
      actions: html`
        <button type="button" class="button green" data-action="save-password">Save password</button>
        <button type="button" class="button quiet" data-action="close-dialog">Close</button>
      `,
    })}
  `;

  return page({ heading: 'Labels', screen: 'labels', frame: 'desk', main, dialogs });
}

export function labelScreen(options: {
  label: LabelRow;
  suppliers: SupplierRow[];
  styles: StyleRowRecord[];
}): string {
  const { label, suppliers, styles } = options;
  const erased = label.state === 'erased';

  const main = html`
    ${heading(label.name)}
    ${actionBar(html`<button type="button" class="button green" data-action="open-dialog" data-target="rename-label">Rename label</button>`)}
    <section class="panel">
      <h2>State</h2>
      <p data-part="label-state">${LABEL_STATE_NAMES[label.state]}${label.state === 'closed' && label.erase_at
        ? ` \u00b7 to be erased on ${shownDate(Number(label.erase_at), LISBON)}, ${localTime(
            Number(label.erase_at),
            LISBON,
          )} Lisbon time`
        : ''}</p>
      <p class="panel-actions">
        ${erased
          ? ''
          : html`<button type="button" class="button" data-action="open-dialog" data-target="delete-label">Delete label</button>`}
        ${label.state === 'open'
          ? html`<button type="button" class="button" data-action="open-dialog" data-target="close-label">Close label</button>`
          : ''}
        ${label.state === 'closed'
          ? html`<button type="button" class="button" data-action="open-dialog" data-target="bring-back">Bring back</button>`
          : ''}
      </p>
    </section>
    ${erased
      ? ''
      : html`
          <section class="panel">
            <h2>Contact</h2>
            <p>${label.contact_name ?? ''} \u00b7 ${label.contact_email ?? ''}</p>
          </section>
          <section class="panel">
            <h2>Suppliers</h2>
            ${suppliers.length === 0
              ? html`<p>No suppliers yet.</p>`
              : html`<ul class="plain-list">${raw(
                  suppliers
                    .map(
                      (supplier) =>
                        `<li>${escape(supplier.name)} \u00b7 ${escape(TOWNS[supplier.town].name)} \u00b7 ${escape(
                          supplier.contact_name ?? '',
                        )} \u00b7 ${escape(supplier.contact_email ?? '')}</li>`,
                    )
                    .join(''),
                )}</ul>`}
          </section>
          <section class="panel">
            <h2>Styles</h2>
            ${styles.length === 0
              ? html`<p>No styles yet.</p>`
              : html`<ul class="plain-list">${raw(
                  styles
                    .map(
                      (style) =>
                        `<li><a href="/styles/${style.id}">${escape(style.name)}</a> \u00b7 ${
                          STYLE_STATE_NAMES[style.state]
                        }</li>`,
                    )
                    .join(''),
                )}</ul>`}
          </section>
        `}
  `;

  const dialogs = html`
    ${dialog({
      id: 'rename-label',
      name: 'Rename label',
      body: field({ id: 'rename-name', label: 'Name', name: 'name', value: label.name }),
      actions: html`
        <button type="button" class="button green" data-action="save-name">Save name</button>
        <button type="button" class="button quiet" data-action="close-dialog">Close</button>
      `,
    })}
    ${dialog({
      id: 'delete-label',
      name: 'Delete label',
      body: html`<p>Deleting takes this label and everything under it off the desk at once.</p>`,
      actions: html`
        <button type="button" class="button green" data-action="delete-label">Delete</button>
        <button type="button" class="button quiet" data-action="close-dialog">Keep</button>
      `,
    })}
    ${dialog({
      id: 'close-label',
      name: 'Close label',
      body: html`<p>A closed label can be brought back until its erase date.</p>`,
      actions: html`
        <button type="button" class="button green" data-action="close-label">Close this label</button>
        <button type="button" class="button quiet" data-action="close-dialog">Keep open</button>
      `,
    })}
    ${dialog({
      id: 'bring-back',
      name: 'Bring back',
      body: html`<p>Bringing it back returns everything exactly as it was.</p>`,
      actions: html`
        <button type="button" class="button green" data-action="bring-back-label">Bring back label</button>
        <button type="button" class="button quiet" data-action="close-dialog">Keep closed</button>
      `,
    })}
  `;

  return page({
    heading: label.name,
    screen: 'label',
    frame: 'desk',
    main,
    dialogs,
    data: { labelId: label.id, labelName: label.name, labelState: label.state },
  });
}

export function requestsScreen(options: {
  requests: (RequestRow & { style_name: string })[];
  styles: StyleRowRecord[];
  now: number;
  expanded: string | null;
  arrival: { key: string; text: string } | null;
}): string {
  const { requests, styles, now, expanded } = options;

  const rows = requests
    .map((request) => {
      const state = requestState(request, now);
      const open = expanded === request.id;
      const answer = request.answer;
      const detail = open
        ? `<tr class="answer-row" data-key="${request.id}-answer"><td colspan="7">
            ${answer
              ? `<dl class="facts">
                  <dt>Energy</dt><dd class="figures">${escape(answer.energyMjPerKg ?? 'not answered')} MJ per kg</dd>
                  <dt>Water</dt><dd class="figures">${escape(answer.waterLitresPerKg ?? 'not answered')} L per kg</dd>
                  <dt>Fibre origin</dt><dd>${escape(
                    answer.fibreOrigin === null ? 'not answered' : COUNTRY_NAMES[answer.fibreOrigin],
                  )}</dd>
                </dl>
                ${answer.evidenceIds
                  .map(
                    (id, index) =>
                      `<button type="button" class="button quiet" data-action="download-evidence"
                        data-evidence="${id}">Download evidence ${index + 1} for ${escape(
                        request.supplier_name,
                      )}</button>`,
                  )
                  .join('')}`
              : '<p>No answer yet.</p>'}
          </td></tr>`
        : '';
      return `<tr data-key="${request.id}" data-request="${request.id}">
        <td>${escape(request.supplier_name)}</td>
        <td>${escape(request.style_name)}</td>
        <td>${escape(LANGUAGE_OPTIONS.find((entry) => entry.value === request.language)?.name ?? request.language)}</td>
        <td>${escape(TOWNS[request.town].name)}</td>
        <td>${escape(shownDateOfLocalDate(request.due_date))}</td>
        <td>${REQUEST_STATE_NAMES[state]}</td>
        <td class="actions">
          <button type="button" class="button quiet" data-action="show-answer" aria-expanded="${open ? 'true' : 'false'}"
            >Show answer for ${escape(request.supplier_name)}</button>
          <button type="button" class="button quiet" data-action="new-request-address">New address for ${escape(
            request.supplier_name,
          )}</button>
          <button type="button" class="button quiet" data-action="end-request">End page for ${escape(
            request.supplier_name,
          )}</button>
        </td>
      </tr>${detail}`;
    })
    .join('');

  const main = html`
    ${heading('Requests')}
    ${arrivalMark(options.arrival)}
    ${actionBar(html`<button type="button" class="button green" data-action="open-dialog" data-target="new-request">New request</button>`)}
    ${tableFrame(
      'Requests table',
      html`<table class="plain">
        <thead><tr><th scope="col">Supplier</th><th scope="col">Style</th><th scope="col">Language</th>
          <th scope="col">Town</th><th scope="col">Due</th><th scope="col">State</th>
          <th scope="col">Actions</th></tr></thead>
        <tbody>${raw(rows)}</tbody>
      </table>`,
    )}
    ${requests.length === 0
      ? html`<div class="empty">${rowMenuFragment}<p>No requests yet. <strong>New request</strong> is the first
          action.</p></div>`
      : ''}
  `;

  const dialogs = dialog({
    id: 'new-request',
    name: 'New request',
    body: html`
      ${selectField({
        id: 'request-style',
        label: 'Style',
        name: 'styleId',
        options: styles.map((style) => ({ value: style.id, name: style.name })),
      })}
      <p class="field"><label class="field-label" for="request-line">Material line</label>
        <select id="request-line" name="lineId" data-part="request-lines"></select></p>
      ${field({ id: 'request-supplier', label: 'Supplier', name: 'supplierName' })}
      ${field({ id: 'request-contact-name', label: 'Contact name', name: 'contactName' })}
      ${field({ id: 'request-contact-email', label: 'Contact email', name: 'contactEmail' })}
      ${selectField({ id: 'request-town', label: 'Town', name: 'town', value: 'izmir', options: TOWN_OPTIONS })}
      ${selectField({
        id: 'request-language',
        label: 'Language',
        name: 'language',
        value: 'tr',
        options: LANGUAGE_OPTIONS,
      })}
      <fieldset class="field"><legend>Questions</legend>
        <label class="radio"><input type="checkbox" name="questions" value="energy" checked><span>Energy</span></label>
        <label class="radio"><input type="checkbox" name="questions" value="water" checked><span>Water</span></label>
        <label class="radio"><input type="checkbox" name="questions" value="fibreOrigin" checked><span>Fibre
          origin</span></label>
      </fieldset>
      ${field({ id: 'request-due', label: 'Due date', name: 'dueDate', hint: 'YYYY-MM-DD' })}
    `,
    actions: html`
      <button type="button" class="button green" data-action="send-request">Send request</button>
      <button type="button" class="button quiet" data-action="close-dialog">Close</button>
    `,
  });

  return page({
    heading: 'Requests',
    screen: 'requests',
    frame: 'desk',
    main,
    dialogs,
    data: {
      expanded,
      lines: styles.map((style) => ({ styleId: style.id })),
    },
  });
}

export function visitsScreen(options: { visits: VisitRow[]; labels: LabelRow[] }): string {
  const groups = new Map<string, VisitRow[]>();
  for (const visit of options.visits) {
    const date = localDate(Number(visit.at), LISBON);
    const held = groups.get(date);
    if (held) held.push(visit);
    else groups.set(date, [visit]);
  }

  const diary = [...groups.entries()]
    .map(([date, visits]) => {
      const hours = dayHours(date, LISBON);
      const title = hours === 24 ? shownDateOfLocalDate(date) : `${shownDateOfLocalDate(date)}, ${hours} hours`;
      return `<section class="diary-group" data-key="${date}" data-date="${date}">
        <h2>${escape(title)}</h2>
        <ul class="plain-list">${visits
          .map(
            (visit) => `<li><a href="/visits/${visit.id}">${escape(visit.factory_name)}</a> \u00b7 ${escape(
              localTime(Number(visit.at), TOWNS[visit.town].zone),
            )} ${escape(TOWNS[visit.town].name)} time \u00b7 ${escape(
              localTime(Number(visit.at), LISBON),
            )} Lisbon time</li>`,
          )
          .join('')}</ul>
      </section>`;
    })
    .join('');

  const main = html`
    ${heading('Visits')}
    ${actionBar(html`<button type="button" class="button green" data-action="open-dialog" data-target="book-visit">Book visit</button>`)}
    <div class="diary" data-part="diary">${raw(diary)}</div>
    ${options.visits.length === 0
      ? html`<div class="empty">${meterFragment}<p>No visits booked. <strong>Book visit</strong> is the first
          action.</p></div>`
      : ''}
  `;

  const dialogs = dialog({
    id: 'book-visit',
    name: 'Book visit',
    body: html`
      ${field({ id: 'visit-factory', label: 'Factory', name: 'factoryName' })}
      ${selectField({
        id: 'visit-label',
        label: 'Label',
        name: 'labelId',
        options: options.labels
          .filter((label) => label.state === 'open')
          .map((label) => ({ value: label.id, name: label.name })),
      })}
      ${selectField({ id: 'visit-town', label: 'Town', name: 'town', value: 'izmir', options: TOWN_OPTIONS })}
      ${field({ id: 'visit-date', label: 'Date', name: 'localDate', hint: 'YYYY-MM-DD' })}
      ${field({ id: 'visit-time', label: 'Local time', name: 'localTime', hint: 'HH:MM' })}
    `,
    actions: html`
      <button type="button" class="button green" data-action="save-visit">Save visit</button>
      <button type="button" class="button quiet" data-action="close-dialog">Close</button>
    `,
  });

  return page({ heading: 'Visits', screen: 'visits', frame: 'desk', main, dialogs });
}

export function visitScreen(options: { visit: VisitRow; readings: ReadingRow[] }): string {
  const { visit, readings } = options;
  const at = Number(visit.at);
  const town = TOWNS[visit.town];

  const rows = readings
    .map(
      (reading) => `<tr data-key="${reading.id}">
        <td class="figures">${reading.meter}</td>
        <td class="figures">${escape(reading.value)}</td>
        <td>${escape(reading.unit)}</td>
        <td>${escape(localTime(Number(reading.taken_at), town.zone))} ${escape(town.name)} time</td>
      </tr>`,
    )
    .join('');

  const main = html`
    ${heading(`Visit to ${visit.factory_name}`)}
    ${actionBar(html`<button type="button" class="button green" data-action="record-reading">Record reading</button>`)}
    <section class="panel">
      <h2>When</h2>
      <p>${shownDate(at, town.zone)}, ${localTime(at, town.zone)} ${town.name} time \u00b7
        ${localTime(at, LISBON)} Lisbon time</p>
      <p class="waiting-line" data-part="waiting-line">${copy.allSent}</p>
    </section>
    <section class="panel">
      <h2>Record a reading</h2>
      ${field({ id: 'reading-meter', label: 'Meter', name: 'meter' })}
      ${field({ id: 'reading-value', label: 'Reading', name: 'value' })}
      ${selectField({
        id: 'reading-unit',
        label: 'Unit',
        name: 'unit',
        value: 'kWh',
        options: [
          { value: 'kWh', name: 'kWh' },
          { value: 'MJ', name: 'MJ' },
          { value: 'm3', name: 'm\u00b3 of natural gas' },
        ],
      })}
    </section>
    <section class="panel">
      <h2>Readings</h2>
      <table class="plain" data-part="readings">
        <thead><tr><th scope="col">Meter</th><th scope="col">Reading</th><th scope="col">Unit</th>
          <th scope="col">Taken</th></tr></thead>
        <tbody>${raw(rows)}</tbody>
      </table>
    </section>
  `;

  const dialogs = html`<div class="dialog" id="lower-reading" data-part="dialog" data-key="lower-reading"
    data-dialog="lower-reading" role="dialog" aria-modal="true" aria-label="Lower reading" hidden>
    <div class="dialog-card">
      <h2 class="dialog-title" data-part="lower-reading-text"></h2>
      <div class="dialog-actions">
        <button type="button" class="button green" data-action="keep-mine">Keep mine</button>
        <button type="button" class="button" data-action="keep-recorded">Keep recorded</button>
      </div>
    </div>
  </div>`;

  return page({
    heading: `Visit to ${visit.factory_name}`,
    screen: 'visit',
    frame: 'desk',
    main,
    dialogs,
    data: { visitId: visit.id, town: visit.town, townName: town.name },
  });
}

export function passportsScreen(rows: (PassportRow & { style_name: string })[]): string {
  const newest = new Map<string, number>();
  for (const row of rows) {
    const held = newest.get(row.gtin) ?? 0;
    if (row.edition > held) newest.set(row.gtin, row.edition);
  }

  const body = rows
    .map((row) => {
      const isNewest = newest.get(row.gtin) === row.edition;
      const canWithdraw = isNewest && row.state === 'published';
      return `<tr data-key="${row.id}" data-style="${row.style_id}">
        <td>${escape(row.style_name)}</td>
        <td class="figures">${escape(row.gtin)}</td>
        <td class="figures">${row.edition}</td>
        <td>${row.state === 'published' ? 'Published' : 'Withdrawn'}</td>
        <td>${escape(shownDate(Number(row.published_at), LISBON))}</td>
        <td><a href="/p/${escape(row.gtin)}/e/${row.edition}">${escape(row.style_name)} edition ${row.edition}</a></td>
        <td class="actions">${
          canWithdraw
            ? `<button type="button" class="button quiet" data-action="open-withdraw"
                data-style="${row.style_id}">Withdraw ${escape(row.style_name)}</button>`
            : ''
        }</td>
      </tr>`;
    })
    .join('');

  const main = html`
    ${heading('Passports')}
    ${tableFrame(
      'Passports table',
      html`<table class="plain">
        <thead><tr><th scope="col">Style</th><th scope="col">GTIN</th><th scope="col">Edition</th>
          <th scope="col">State</th><th scope="col">Published</th><th scope="col">Passport</th>
          <th scope="col">Actions</th></tr></thead>
        <tbody>${raw(body)}</tbody>
      </table>`,
    )}
    ${rows.length === 0 ? html`<div class="empty">${rowMenuFragment}<p>No passports yet.</p></div>` : ''}
  `;

  const dialogs = dialog({
    id: 'withdraw-passport',
    name: 'Withdraw passport',
    body: html`<p>Withdrawing takes every edition of this passport off the public address.</p>`,
    actions: html`
      <button type="button" class="button green" data-action="withdraw-passport">Withdraw</button>
      <button type="button" class="button quiet" data-action="close-dialog">Keep</button>
    `,
  });

  return page({ heading: 'Passports', screen: 'passports', frame: 'desk', main, dialogs });
}

export { COUNTRY_OPTIONS };
