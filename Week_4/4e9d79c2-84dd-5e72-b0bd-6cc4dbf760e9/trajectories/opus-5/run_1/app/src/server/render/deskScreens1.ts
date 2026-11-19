import { copy } from '../copy.js';
import { HireView, occasionLabel, stateLabel } from '../data/hires.js';
import { EnquiryRowView } from '../data/enquiries.js';
import { TripView } from '../data/trips.js';
import { Operator } from '../data/operators.js';
import { RateTable } from '../data/rates.js';
import { marginString } from '../data/hires.js';
import { DeskPage, deskShell, emptyState } from './desk.js';
import { combobox, dialog, escapeHtml, field, numberField, problems, radioGroup, selectField } from './layout.js';
import { frameTable, marker, money, note, ukDate } from './screens.js';

const OCCASION_CHOICES = [
  { value: 'all', label: 'All occasions' },
  { value: 'school', label: 'School' },
  { value: 'weddings', label: 'Weddings' },
  { value: 'company', label: 'Company' },
  { value: 'festivals', label: 'Festivals and sport' },
];

function enquiryFormFields(): string {
  const hours = Array.from({ length: 24 }, (_unused, hour) => String(hour).padStart(2, '0'));
  const hourChoices = [{ value: '', label: '' }, ...hours.map((hour) => ({ value: hour, label: hour }))];
  const minuteChoices = [
    { value: '', label: '' },
    ...['00', '15', '30', '45'].map((minutes) => ({ value: minutes, label: minutes })),
  ];
  return `${radioGroup({
    name: 'occasion',
    legend: 'Occasion',
    values: [
      { value: 'school', label: 'School', checked: true },
      { value: 'weddings', label: 'Weddings' },
      { value: 'company', label: 'Company' },
      { value: 'festivals', label: 'Festivals and sport' },
    ],
  })}
${radioGroup({
  name: 'journeyType',
  legend: 'Journey type',
  className: 'journey-type-bar',
  values: [
    { value: 'oneWay', label: 'One way', checked: true },
    { value: 'return', label: 'Return' },
    { value: 'sameDayReturn', label: 'Same day return' },
    { value: 'severalStops', label: 'Several stops' },
  ],
})}
${combobox({ id: 'from', label: 'From' })}
<div class="stops" data-stops></div>
<button type="button" data-add-stop>Add a stop</button>
${combobox({ id: 'to', label: 'To' })}
<div class="field underline-field" data-stop-details hidden>
  <label for="stop-details">Stop details</label><textarea id="stop-details" rows="3"></textarea>
</div>
${field({ id: 'out-date', label: 'Out date', extra: 'placeholder="DD/MM/YYYY"' })}
${selectField({ id: 'out-hour', label: 'Out hour', values: hourChoices })}
${selectField({ id: 'out-minutes', label: 'Out minutes', values: minuteChoices })}
<div data-repeated-hour="out" hidden></div>
<div data-return-fields hidden>
  ${field({ id: 'return-date', label: 'Return date', extra: 'placeholder="DD/MM/YYYY"' })}
  ${selectField({ id: 'return-hour', label: 'Return hour', values: hourChoices })}
  ${selectField({ id: 'return-minutes', label: 'Return minutes', values: minuteChoices })}
  <div data-repeated-hour="return" hidden></div>
</div>
${numberField({ id: 'people', label: 'People', min: 1, max: 400 })}
${numberField({ id: 'large', label: 'Large (23 kg)', value: '0', min: 0, max: 40 })}
${numberField({ id: 'medium', label: 'Medium (15 kg)', value: '0', min: 0, max: 40 })}
${numberField({ id: 'hand', label: 'Hand (7 kg)', value: '0', min: 0, max: 40 })}
${numberField({ id: 'wheelchairs', label: 'Wheelchair users', value: '0', min: 0, max: 10 })}
${field({ id: 'name', label: 'Name', autocomplete: 'name' })}
${field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email' })}
${field({ id: 'telephone', label: 'Telephone', type: 'tel', autocomplete: 'tel' })}
${selectField({
  id: 'language',
  label: 'Language for your quote',
  values: [
    { value: 'en', label: 'English' },
    { value: 'pl', label: 'Polski' },
    { value: 'ur', label: 'اردو' },
  ],
})}`;
}

export type EnquiriesView = {
  rows: EnquiryRowView[];
  state: string;
  occasion: string;
  q: string;
  nextCursor: string | null;
  prevCursor: string | null;
  search: string;
};

export function enquiriesScreen(view: EnquiriesView): string {
  const rows = view.rows.map(
    (row) => `<tr data-row="${escapeHtml(row.id)}">
  <td><a href="/enquiries/${escapeHtml(row.id)}">${escapeHtml(row.reference)}</a></td>
  <td>${escapeHtml(row.customerName)}</td>
  <td>${escapeHtml(occasionLabel(row.occasion))}</td>
  <td>${escapeHtml(stateLabel(row.state))}</td>
  <td>${ukDate(row.departDate)}, ${escapeHtml(row.departTime)}</td>
</tr>`,
  );
  const paging = `<p class="paging">
  ${view.prevCursor ? `<a href="?${view.search}&before=${encodeURIComponent(view.prevCursor)}">Previous page</a>` : ''}
  ${view.nextCursor ? `<a href="?${view.search}&after=${encodeURIComponent(view.nextCursor)}">Next page</a>` : ''}
</p>`;
  return deskShell({
    path: '/enquiries',
    heading: 'Enquiries',
    title: 'Enquiries | Wayticket',
    mainAction: `<button type="button" class="main-action" data-opens="add-enquiry">Add enquiry</button>`,
    dialogs: dialog({
      id: 'add-enquiry',
      title: 'Add enquiry',
      body: enquiryFormFields(),
      actions: `<button type="button" data-action="save-enquiry">Save enquiry</button>`,
    }),
    main: `<div class="filters">
  ${radioGroup({
    name: 'state',
    legend: 'Filter by state',
    values: [
      { value: 'all', label: 'All', checked: view.state === 'all' },
      { value: 'new', label: 'New', checked: view.state === 'new' },
      { value: 'priced', label: 'Priced', checked: view.state === 'priced' },
      { value: 'quoted', label: 'Quoted', checked: view.state === 'quoted' },
      { value: 'won', label: 'Won', checked: view.state === 'won' },
      { value: 'lost', label: 'Lost', checked: view.state === 'lost' },
    ],
  })}
  ${selectField({
    id: 'occasion-filter',
    label: 'Occasion',
    values: OCCASION_CHOICES.map((choice) => ({ ...choice, selected: choice.value === view.occasion })),
  })}
  <div class="field underline-field">
    <label for="search-enquiries">Search enquiries</label>
    <input id="search-enquiries" type="search" role="searchbox" aria-label="Search enquiries" value="${escapeHtml(view.q)}">
  </div>
</div>
${frameTable({
  name: 'Enquiries list',
  head: ['Reference', 'Customer', 'Occasion', 'State', 'Out'],
  rows,
  empty: copy.noEnquiriesMatch,
})}
${paging}`,
    data: { screen: 'enquiries' },
  });
}

export function enquiryScreen(hire: HireView, duplicates: { reference: string }[], mergedReferences: string[]): string {
  const lines: [string, string][] = [
    ['Occasion', occasionLabel(hire.occasion)],
    ['Journey', hire.journeyType],
    ['From', hire.stops[0]?.text ?? ''],
    ['To', hire.stops[hire.stops.length - 1]?.text ?? ''],
    ['Out', `${formatLocal(hire.departAt.date, hire.departAt.time)}`],
    ...(hire.returnAt ? ([['Return', formatLocal(hire.returnAt.date, hire.returnAt.time)]] as [string, string][]) : []),
    ['People', `${hire.party.people}`],
    ['Bags', `${hire.party.large} large, ${hire.party.medium} medium, ${hire.party.hand} hand`],
    ['Wheelchair users', `${hire.party.wheelchairs}`],
    ['Name', hire.customer.name],
    ['Email', hire.customer.email],
    ['Telephone', hire.customer.telephone],
  ];
  const unchecked = hire.stops.filter((stop) => !stop.checked);
  return deskShell({
    path: '/enquiries',
    heading: `Enquiry ${hire.reference}`,
    title: `Enquiry ${hire.reference} | Wayticket`,
    mainAction: `<a class="main-action" href="/enquiries/${escapeHtml(hire.id)}/trip">Plan this trip</a>`,
    dialogs: dialog({
      id: 'merge-enquiries',
      title: 'Merge enquiries',
      body:
        duplicates.length > 0
          ? duplicates
              .map(
                (duplicate) =>
                  `<label class="choice"><input type="checkbox" value="${escapeHtml(duplicate.reference)}"><span>${escapeHtml(duplicate.reference)}</span></label>`,
              )
              .join('')
          : note('No duplicates.'),
      actions: `<button type="button" data-action="merge-enquiries">Merge enquiries</button>`,
    }),
    main: `${radioGroup({
      name: 'enquiry-state',
      legend: 'State',
      values: (['new', 'priced', 'quoted', 'won', 'lost'] as const).map((state) => ({
        value: state,
        label: stateLabel(state),
        checked: hire.enquiryState === state,
      })),
    })}
<dl class="ticket-as-sent">${lines
      .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
      .join('')}</dl>
${unchecked.length > 0 ? unchecked.map((stop) => `<p>${escapeHtml(stop.text)} ${marker('Not checked')}</p>`).join('') : ''}
${duplicates.length > 0 ? `<p>Possible duplicates: ${duplicates.map((duplicate) => escapeHtml(duplicate.reference)).join(', ')}</p><button type="button" data-opens="merge-enquiries">Merge</button>` : ''}
${mergedReferences.length > 0 ? `<p>Merged under this reference: ${mergedReferences.map(escapeHtml).join(', ')}</p>` : ''}
<nav class="screen-links" aria-label="Hire screens">
  <a href="/enquiries/${escapeHtml(hire.id)}/trip">Trip plan</a>
  <a href="/enquiries/${escapeHtml(hire.id)}/bids">Operator bids</a>
  <a href="/hires/${escapeHtml(hire.id)}/quote">Quote</a>
  <a href="/hires/${escapeHtml(hire.id)}/hours">Drivers' hours</a>
  <a href="/hires/${escapeHtml(hire.id)}/seats">Seat plan</a>
  <a href="/hires/${escapeHtml(hire.id)}/changes">Changes</a>
</nav>`,
    data: { screen: 'enquiry', hireId: hire.id },
  });
}

function formatLocal(date: string, time: string): string {
  return `${formatUkDateText(date)}, ${time}`;
}

function formatUkDateText(date: string): string {
  return date === '' ? '' : ukDate(date).replace(/&amp;/g, '&');
}

export function tripScreen(hire: HireView, trip: TripView): string {
  const stopRows = trip.stops
    .map(
      (stop, index) => `<li class="stop-row" draggable="true" data-stop="${escapeHtml(stop.id)}">
  <span class="stop-text">${escapeHtml(stop.text)}</span>
  ${stop.checked ? '' : marker('Not checked')}
  <button type="button" data-move="up"${index === 0 ? ' aria-disabled="true"' : ''}>Move up</button>
  <button type="button" data-move="down"${index === trip.stops.length - 1 ? ' aria-disabled="true"' : ''}>Move down</button>
</li>`,
    )
    .join('');
  const legs = trip.legs
    .map((leg, index) => `<li>Leg ${index + 1}: ${escapeHtml(leg.miles)} miles, ${leg.minutes} minutes</li>`)
    .join('');
  return deskShell({
    path: '/enquiries',
    heading: `Trip plan ${hire.reference}`,
    title: `Trip plan ${hire.reference} | Wayticket`,
    mainAction: `<button type="button" class="main-action" data-action="save-plan">Save plan</button>`,
    main: `<ol class="stops-list" data-stop-list>${stopRows}</ol>
<ul class="legs">${legs.length > 0 ? legs : '<li>No legs yet.</li>'}</ul>
${trip.planOutOfDate ? marker(copy.planOutOfDate) : ''}
<button type="button" data-action="try-route">Try route again</button>
<p>Suggested: ${trip.plan.suggested.join(', ')}</p>
${field({ id: 'plan', label: 'Plan', value: (trip.plan.sizes ?? trip.plan.suggested).join(', ') })}
${trip.plan.largerThanNeeded ? marker(copy.largerThanNeeded) : ''}`,
    data: { screen: 'trip', hireId: hire.id },
  });
}

export type BidsView = {
  hire: HireView;
  sort: 'priceLowest' | 'priceHighest';
  bids: {
    operatorId: string;
    operatorName: string;
    status: string;
    clear: boolean;
    reason: string | null;
    total: number | null;
    prices: number[];
  }[];
  operators: { id: string; name: string; clear: boolean; reason: string | null }[];
  awarded: { operatorName: string; at: string } | null;
};

export function bidsScreen(view: BidsView): string {
  const rows = view.bids.map(
    (bid) => `<tr>
  <td>${escapeHtml(bid.operatorName)}</td>
  <td>${bid.total === null ? 'No price' : money(bid.total)}</td>
  <td>${escapeHtml(bid.status)}</td>
  <td>${bid.clear ? 'Clear' : marker(bid.reason ?? '')}</td>
  <td>${
    bid.total !== null && !view.awarded && bid.clear
      ? `<button type="button" data-action="award" data-operator="${escapeHtml(bid.operatorId)}">Award</button>`
      : ''
  }</td>
</tr>`,
  );
  return deskShell({
    path: '/enquiries',
    heading: `Operator bids ${view.hire.reference}`,
    title: `Operator bids ${view.hire.reference} | Wayticket`,
    mainAction: `<button type="button" class="main-action" data-opens="ask-operators">Ask operators</button>`,
    dialogs: dialog({
      id: 'ask-operators',
      title: 'Ask operators',
      body: view.operators
        .map(
          (operator) => `<label class="choice">
  <input type="checkbox" value="${escapeHtml(operator.id)}">
  <span>${escapeHtml(operator.name)}${operator.clear ? '' : ` — ${escapeHtml(operator.reason ?? '')}`}</span>
</label>`,
        )
        .join(''),
      actions: `<button type="button" data-action="send-asks">Send asks</button>`,
    }),
    main: `<p><a href="?sort=${view.sort === 'priceLowest' ? 'priceHighest' : 'priceLowest'}">Sort by price</a></p>
${view.awarded ? `<p>${escapeHtml(`Awarded to ${view.awarded.operatorName}.`)}</p>` : ''}
${frameTable({ name: 'Bids', head: ['Operator', 'Total', 'Status', 'Standing', ''], rows, empty: copy.noBids })}`,
    data: { screen: 'bids', hireId: view.hire.id },
  });
}

export function quoteScreen(hire: HireView): string {
  const rows = hire.vehicles
    .map(
      (vehicle, index) => `<tr>
  <td>${vehicle.seats} seats</td>
  <td>${money(vehicle.sellingPrice)}</td>
  <td>${money(vehicle.vat)}</td>
  <td>${money(vehicle.quoteTotal)}</td>
  <td>${money(vehicle.deposit)}</td>
  <td>${numberField({
    id: `margin-${index + 1}`,
    label: `Margin for vehicle ${index + 1}`,
    value: marginString(vehicle.marginTenths),
    min: 0,
    max: 60,
  })}</td>
</tr>`,
    )
    .join('');
  const quoteTotal = hire.vehicles.reduce((sum, vehicle) => sum + vehicle.quoteTotal, 0);
  return deskShell({
    path: '/enquiries',
    heading: `Quote ${hire.reference}`,
    title: `Quote ${hire.reference} | Wayticket`,
    mainAction: `<button type="button" class="main-action" data-opens="send-quote">Send quote</button>`,
    dialogs: dialog({
      id: 'send-quote',
      title: 'Send quote',
      body: note(`The customer gets one mail with the total and the private page.`),
      actions: `<button type="button" data-action="send-quote">Send now</button><button type="button" data-action="reload">Reload</button>`,
    }),
    main: `${
      hire.vehicles.length === 0
        ? emptyState('No vehicles yet. Award a bid first.')
        : `<table class="desk-table"><thead><tr><th>Vehicle</th><th>Selling price</th><th>VAT</th><th>Total</th><th>Deposit</th><th>Margin</th></tr></thead><tbody>${rows}</tbody></table>`
    }
<div class="totals" role="group" aria-label="Totals">
  <p>Total <span data-total>${money(quoteTotal)}</span></p>
  <p>Deposit due <span data-deposit-total>${money(hire.depositTotal)}</span></p>
</div>
<p>Rates in force: table from ${ukDate(hire.rates.effectiveFrom)}</p>
${hire.page ? `<p>Quote sent, valid until ${ukDate(hire.page.validUntil)}</p>` : '<p>Not sent yet.</p>'}`,
    data: { screen: 'quote', hireId: hire.id, version: hire.quoteVersion },
  });
}

export function ratesScreen(tables: RateTable[], inForce: string): string {
  const rows = tables.map(
    (table) => `<tr>
  <td>${ukDate(table.effectiveFrom)}${table.id === inForce ? ` ${marker('In force')}` : ''}</td>
  <td>${escapeHtml(marginString(table.defaultMarginTenths))}</td>
  <td>${money(table.waitingRatePerHour)}</td>
  <td>${money(table.secondDriverCharge)}</td>
  <td>${money(table.depositMinibus)} / ${money(table.depositMinibusHigher)}</td>
  <td>${money(table.depositCoach)} / ${money(table.depositCoachHigher)}</td>
</tr>`,
  );
  const current = tables.find((table) => table.id === inForce);
  return deskShell({
    path: '/rates',
    heading: 'Rate tables',
    title: 'Rate tables | Wayticket',
    mainAction: `<button type="button" class="main-action" data-opens="add-rate-table">Add rate table</button>`,
    dialogs: dialog({
      id: 'add-rate-table',
      title: 'Add rate table',
      body: `${field({ id: 'takes-effect-on', label: 'Takes effect on', extra: 'placeholder="DD/MM/YYYY"' })}
${field({ id: 'default-margin', label: 'Default margin', value: current ? marginString(current.defaultMarginTenths) : '15' })}
${field({ id: 'waiting-rate', label: 'Waiting rate per hour', value: current ? moneyPlain(current.waitingRatePerHour) : '20.00' })}
${field({ id: 'second-driver', label: 'Second driver charge', value: current ? moneyPlain(current.secondDriverCharge) : '150.00' })}
${field({ id: 'minibus-deposit', label: 'Minibus deposit', value: current ? moneyPlain(current.depositMinibus) : '50.00' })}
${field({ id: 'higher-minibus-deposit', label: 'Higher minibus deposit', value: current ? moneyPlain(current.depositMinibusHigher) : '100.00' })}
${field({ id: 'coach-deposit', label: 'Coach deposit', value: current ? moneyPlain(current.depositCoach) : '100.00' })}
${field({ id: 'higher-coach-deposit', label: 'Higher coach deposit', value: current ? moneyPlain(current.depositCoachHigher) : '150.00' })}`,
      actions: `<button type="button" data-action="save-rate-table">Save table</button>`,
    }),
    main: frameTable({
      name: 'Rate tables list',
      head: ['Takes effect on', 'Default margin', 'Waiting rate', 'Second driver', 'Minibus deposits', 'Coach deposits'],
      rows,
      empty: 'No rate tables yet.',
    }),
    data: { screen: 'rates' },
  });
}

function moneyPlain(pennies: number): string {
  return `${Math.floor(pennies / 100)}.${String(pennies % 100).padStart(2, '0')}`;
}

export { problems, DeskPage };
