import { copy, adultsShortLine } from '../copy.js';
import { Block } from '../../domain/hours.js';
import { seatLabels } from '../../domain/seats.js';
import { clockChangeLabel, formatUkDate } from '../../domain/time.js';
import { Customer } from '../data/customers.js';
import { DocumentRecord, DOCUMENT_LABELS } from '../data/documents.js';
import { HireView, marginString } from '../data/hires.js';
import { Operator, PAPER_LABELS } from '../data/operators.js';
import { RunRecord } from '../data/runs.js';
import { Passenger } from '../data/passengers.js';
import { deskShell, emptyState } from './desk.js';
import { dialog, escapeHtml, field, numberField, radioGroup, selectField, sheet } from './layout.js';
import { frameTable, marker, money, note, ukDate } from './screens.js';
import { seatSvg } from './svg.js';

export function operatorsScreen(operators: Operator[], standings: Map<string, string | null>): string {
  const rows = operators.map(
    (operator) => `<tr>
  <td>${escapeHtml(operator.name)}${operator.listed ? '' : ` ${marker(copy.noLongerListed)}`}</td>
  <td>${escapeHtml(operator.town)}</td>
  <td>${operator.sizes.join(', ')}</td>
  <td>${
    operator.papers.length === 0
      ? 'None'
      : operator.papers
          .map((paper) => `${escapeHtml(PAPER_LABELS[paper.kind])} ends ${ukDate(paper.endsOn)}`)
          .join('<br>')
  }</td>
  <td>${operator.dbsCheckedOn ? ukDate(operator.dbsCheckedOn) : 'None'}</td>
  <td>
    <button type="button" data-opens="upload-paper" data-operator="${escapeHtml(operator.id)}">Upload paper</button>
    <button type="button" data-opens="set-dbs" data-operator="${escapeHtml(operator.id)}">Set DBS date</button>
  </td>
</tr>`,
  );
  return deskShell({
    path: '/operators',
    heading: 'Operators',
    title: 'Operators | Wayticket',
    mainAction: `<button type="button" class="main-action" data-action="refresh-directory">Refresh directory</button>`,
    dialogs: `${dialog({
      id: 'upload-paper',
      title: 'Upload paper',
      body: `${selectField({
        id: 'paper-kind',
        label: 'Paper',
        values: [
          { value: 'operatorLicence', label: 'Operator licence' },
          { value: 'publicLiabilityCover', label: 'Public liability cover' },
        ],
      })}
${field({ id: 'ends-on', label: 'Ends on', extra: 'placeholder="DD/MM/YYYY"' })}
<div class="field underline-field"><label for="paper-file">File</label>
  <input id="paper-file" type="file" accept="application/pdf,image/jpeg,image/png"></div>`,
      actions: `<button type="button" data-action="store-paper">Store paper</button>`,
    })}
${dialog({
  id: 'set-dbs',
  title: 'Set DBS date',
  body: field({ id: 'checked-on', label: 'Checked on', extra: 'placeholder="DD/MM/YYYY"' }),
  actions: `<button type="button" data-action="save-dbs">Save date</button>`,
})}`,
    main: frameTable({
      name: 'Operators list',
      head: ['Operator', 'Town', 'Sizes', 'Papers', 'DBS checked on', ''],
      rows,
      empty: copy.noOperators,
    }),
    data: { screen: 'operators' },
  });
}

export type PaymentsView = {
  moneyHeld: number;
  bookings: {
    id: string;
    reference: string;
    customerName: string;
    paymentStateLabel: string;
    paid: number;
    owed: number;
    credit: number;
    vehicles: { seats: number; depositPaid: number; deposit: number; balancePaid: number; total: number }[];
  }[];
};

export function paymentsScreen(view: PaymentsView): string {
  const rows = view.bookings.map(
    (booking) => `<tr>
  <td>${escapeHtml(booking.reference)}</td>
  <td>${escapeHtml(booking.customerName)}</td>
  <td>${escapeHtml(booking.paymentStateLabel)}</td>
  <td>${money(booking.paid)}</td>
  <td>${money(booking.owed)}</td>
  <td>${booking.credit > 0 ? escapeHtml(`Credit ${moneyText(booking.credit)}`) : ''}</td>
  <td>${booking.vehicles
    .map(
      (vehicle) =>
        `${vehicle.seats} seats: deposit ${money(vehicle.depositPaid)} of ${money(vehicle.deposit)}, balance ${money(
          vehicle.balancePaid,
        )} of ${money(vehicle.total - vehicle.deposit)}`,
    )
    .join('<br>')}</td>
</tr>`,
  );
  return deskShell({
    path: '/payments',
    heading: 'Payments',
    title: 'Payments | Wayticket',
    mainAction: `<button type="button" class="main-action" data-opens="bring-in-statement">Bring in statement</button>`,
    dialogs: sheet({
      id: 'bring-in-statement',
      title: 'Bring in statement',
      body: `<div class="field underline-field"><label for="statement-file">Statement file</label>
  <input id="statement-file" type="file" accept="text/csv"></div>
<div data-statement-preview></div>`,
      actions: `<button type="button" data-action="read-file">Read file</button><button type="button" data-action="bring-in">Bring in</button>`,
    }),
    main: `<p class="money-held">Money held <strong>${money(view.moneyHeld)}</strong></p>
<p><a href="/api/payments/download">Download payments</a></p>
${frameTable({
  name: 'Bookings',
  head: ['Reference', 'Customer', 'State', 'Paid', 'Owed', 'Credit', 'Per vehicle'],
  rows,
  empty: copy.noPayments,
})}`,
    data: { screen: 'payments' },
  });
}

function moneyText(pennies: number): string {
  const whole = String(Math.floor(Math.abs(pennies) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `£${whole}.${String(Math.abs(pennies) % 100).padStart(2, '0')}`;
}

export type DiaryView = {
  week: string;
  days: { date: string; hours: number; label: string | null }[];
  rows: { runId: string; number: number; hireId: string; seats: number; driver: string | null; departAt: { date: string; time: string } }[];
  earlier: string;
  later: string;
};

export function diaryScreen(view: DiaryView): string {
  const cells = view.days
    .map(
      (day) => `<div class="diary-day" role="row">
  <div class="day-heading" role="rowheader">${ukDate(day.date)}${day.label ? ` ${marker(day.label)}` : ''}</div>
  ${view.rows
    .filter((row) => row.departAt.date === day.date)
    .map(
      (row) => `<div class="diary-card" role="gridcell" tabindex="-1" draggable="true" data-run="${escapeHtml(row.runId)}">
    <span>Run ${row.number}</span>
    <span>${escapeHtml(row.departAt.time)}</span>
    <span>${row.seats} seats</span>
    <span>${row.driver ? escapeHtml(row.driver) : 'No driver'}</span>
    <button type="button" data-opens="assign-driver" data-run="${escapeHtml(row.runId)}">Assign driver</button>
    <button type="button" data-action="tell-again" data-run="${escapeHtml(row.runId)}">Tell driver again</button>
  </div>`,
    )
    .join('')}
</div>`,
    )
    .join('');
  return deskShell({
    path: '/diary',
    heading: 'Diary',
    title: 'Diary | Wayticket',
    mainAction: `<a class="main-action" href="/diary?week=${escapeHtml(view.later)}">Later week</a>`,
    dialogs: dialog({
      id: 'assign-driver',
      title: 'Assign driver',
      body: `${field({ id: 'driver-name', label: 'Driver name', autocomplete: 'name' })}
${field({ id: 'driver-telephone', label: 'Driver telephone', type: 'tel', autocomplete: 'tel' })}`,
      actions: `<button type="button" data-action="tell-driver">Tell driver</button>`,
    }),
    main: `<p class="week-moves">
  <a href="/diary?week=${escapeHtml(view.earlier)}">Earlier week</a>
  <a href="/diary?week=${escapeHtml(view.later)}">Later week</a>
</p>
${
  view.rows.length === 0
    ? emptyState(copy.nothingThisWeek)
    : `<div class="diary-grid" role="grid" aria-label="Week" data-week="${escapeHtml(view.week)}">${cells}</div>`
}`,
    data: { screen: 'diary', week: view.week },
  });
}

export type HoursView = {
  hire: HireView;
  runs: RunRecord[];
  run: RunRecord;
  blocks: Block[];
  startTime: string;
  drivingMinutes: number;
  spreadMinutes: number;
  breaches: { rule: string; atMinute: number; atLocal: { date: string; time: string } }[];
  secondDriverCharge: number;
};

export function hoursScreen(view: HoursView): string {
  let minute = 0;
  const blocks = view.blocks
    .map((block, index) => {
      const left = minute;
      minute += block.minutes;
      const label = block.kind === 'break' ? `Break ${index + 1}` : block.kind;
      return `<div class="ribbon-block ${block.kind}" data-part="block" data-kind="${block.kind}"
  style="left:${left}px;width:${block.minutes}px"
  ${block.kind === 'break' ? `role="slider" tabindex="0" aria-label="Break ${index + 1}" aria-valuemin="0" aria-valuemax="${minute + block.minutes}" aria-valuenow="${left}" data-block-index="${index}"` : ''}>
  <span>${escapeHtml(label)}</span>
</div>`;
    })
    .join('');
  const marks = Array.from({ length: Math.ceil(minute / 60) + 1 }, (_unused, hour) => {
    const at = hour * 60;
    const hourAt = (Number(view.startTime.slice(0, 2)) + hour) % 24;
    return `<span class="ruler-mark" data-part="ruler-mark" style="left:${at}px">${String(hourAt).padStart(2, '0')}:00</span>`;
  }).join('');
  const rows = (() => {
    let at = 0;
    return view.blocks.map((block) => {
      const from = at;
      at += block.minutes;
      return `<tr><td>${escapeHtml(block.kind)}</td><td>${block.minutes}</td><td>${from}</td><td>${at}</td></tr>`;
    });
  })();
  return deskShell({
    path: '/enquiries',
    heading: `Drivers' hours ${view.hire.reference}`,
    title: `Drivers' hours ${view.hire.reference} | Wayticket`,
    mainAction: `<button type="button" class="main-action" data-action="confirm-run">Confirm run</button>`,
    dialogs: dialog({
      id: 'add-second-driver',
      title: 'Add second driver',
      body: note(`A second driver costs ${moneyText(view.secondDriverCharge)}.`),
      actions: `<button type="button" data-action="add-charge">Add charge</button>`,
    }),
    main: `${selectField({
      id: 'run-chooser',
      label: 'Run',
      values: view.runs.map((run) => ({ value: run.id, label: `Run ${run.number}`, selected: run.id === view.run.id })),
    })}
<div class="frame ribbon" role="region" aria-label="Duty ribbon" tabindex="0">
  <div class="ribbon-track" style="width:${minute}px">${marks}${blocks}</div>
</div>
${view.breaches
  .map((breach) => `<p class="breach" data-part="breach">${marker(`Over the limit from ${breach.atLocal.time}`)}</p>`)
  .join('')}
<table class="desk-table" aria-label="Duty blocks"><caption>Duty blocks</caption>
  <thead><tr><th>Kind</th><th>Minutes</th><th>From minute</th><th>To minute</th></tr></thead>
  <tbody>${rows.join('')}</tbody></table>
<p>Driving ${view.drivingMinutes} minutes, duty ${view.spreadMinutes} minutes</p>
<button type="button" data-opens="add-second-driver">Add second driver</button>
<button type="button" data-action="accept-charges">Accept charges</button>
<p>${view.run.driverName ? escapeHtml(view.run.driverName) : 'No driver'}${
      view.run.toldAt ? ` — ${escapeHtml(`Driver told at ${new Date(view.run.toldAt).toISOString().slice(11, 16)}`)}` : ''
    }</p>`,
    data: { screen: 'hours', hireId: view.hire.reference, runId: view.run.id },
  });
}

export type SeatsView = {
  hire: HireView;
  passengers: Passenger[];
  adultsNeeded: number;
  adultsShort: number;
  vehicles: {
    id: string;
    seats: number;
    grid: { seat: string; passengerId: string | null }[];
    split: { name: string; amount: number }[];
  }[];
};

export function seatsScreen(view: SeatsView): string {
  const nameOf = (id: string | null): string =>
    view.passengers.find((person) => person.id === id)?.name ?? '';
  const grids = view.vehicles
    .map(
      (vehicle) => `<div class="seat-grid" role="grid" aria-label="Seats ${vehicle.seats}-seat vehicle">
  ${vehicle.grid
    .map((cell) => {
      const name = nameOf(cell.passengerId);
      return `<div role="gridcell" tabindex="-1" class="seat ${cell.passengerId ? 'taken' : ''}" data-part="seat"
  data-seat="${escapeHtml(cell.seat)}" data-vehicle="${escapeHtml(vehicle.id)}"
  ${cell.passengerId ? `data-passenger="${escapeHtml(cell.passengerId)}" draggable="true"` : ''}
  aria-label="Seat ${escapeHtml(cell.seat)}: ${escapeHtml(name === '' ? 'empty' : name)}">
  ${seatSvg(cell.seat, cell.passengerId !== null)}<span class="seat-name">${escapeHtml(name)}</span>
</div>`;
    })
    .join('')}
</div>
<ul class="split">${vehicle.split
        .map((line) => `<li>${escapeHtml(line.name)} ${money(line.amount)}</li>`)
        .join('')}</ul>`,
    )
    .join('');
  return deskShell({
    path: '/enquiries',
    heading: `Seat plan ${view.hire.reference}`,
    title: `Seat plan ${view.hire.reference} | Wayticket`,
    mainAction: `<button type="button" class="main-action" data-opens="add-passengers">Add passengers</button>`,
    dialogs: dialog({
      id: 'add-passengers',
      title: 'Add passengers',
      body: `<div class="field underline-field"><label for="passenger-file">Passenger file</label>
  <input id="passenger-file" type="file" accept="text/csv"></div>
${field({ id: 'passenger-name', label: 'Name', autocomplete: 'name' })}
${field({ id: 'passenger-group', label: 'Group' })}
${field({ id: 'passenger-needs', label: 'Needs' })}`,
      actions: `<button type="button" data-action="add-name">Add name</button><button type="button" data-action="bring-in-list">Bring in list</button>`,
    }),
    main: `${
      view.passengers.length === 0
        ? emptyState(copy.noPassengers)
        : `<ul class="passenger-list">${view.passengers
            .map(
              (person) =>
                `<li draggable="true" data-passenger="${escapeHtml(person.id)}">${escapeHtml(person.name)}${
                  person.group ? ` (${escapeHtml(person.group)})` : ''
                }${person.listedTwice ? ` ${marker(copy.listedTwice)}` : ''}</li>`,
            )
            .join('')}</ul>`
    }
${view.adultsShort > 0 ? `<p>${marker(adultsShortLine(view.adultsShort))}</p>` : ''}
${grids}
<p><a href="/api/hires/${escapeHtml(view.hire.id)}/passengers/download">Download passengers</a></p>
<button type="button" data-action="print-plan">Print plan</button>`,
    data: { screen: 'seats', hireId: view.hire.id },
  });
}

export type ChangesView = {
  hire: HireView;
  changes: { id: string; old: unknown; new: unknown; priceMoved: boolean }[];
  cancellation: { noticeAt: string; lines: { vehicleId: string; charge: string; refundsDue: string; owed: string }[] } | null;
};

export function changesScreen(view: ChangesView): string {
  const hours = Array.from({ length: 24 }, (_unused, hour) => String(hour).padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_unused, minute) => String(minute).padStart(2, '0'));
  const vehicleFields = view.hire.vehicles
    .map(
      (vehicle, index) => `${field({
        id: `bought-price-${index + 1}`,
        label: `Bought price for vehicle ${index + 1}`,
        value: `${Math.floor(vehicle.boughtPrice / 100)}.${String(vehicle.boughtPrice % 100).padStart(2, '0')}`,
      })}
${numberField({
  id: `change-margin-${index + 1}`,
  label: `Margin for vehicle ${index + 1}`,
  value: marginString(vehicle.marginTenths),
  min: 0,
  max: 60,
})}`,
    )
    .join('');
  return deskShell({
    path: '/enquiries',
    heading: `Changes ${view.hire.reference}`,
    title: `Changes ${view.hire.reference} | Wayticket`,
    mainAction: `<button type="button" class="main-action" data-opens="change-booking">Change booking</button>`,
    dialogs: `${dialog({
      id: 'change-booking',
      title: 'Change booking',
      body: `${field({ id: 'departure-date', label: 'Departure date', value: ddmmyyyy(view.hire.departAt.date) })}
${selectField({
  id: 'departure-hour',
  label: 'Departure hour',
  values: hours.map((hour) => ({ value: hour, label: hour, selected: hour === view.hire.departAt.time.slice(0, 2) })),
})}
${selectField({
  id: 'departure-minutes',
  label: 'Departure minutes',
  values: minutes.map((minute) => ({ value: minute, label: minute, selected: minute === view.hire.departAt.time.slice(3) })),
})}
${vehicleFields}
<div class="sides">
  <div role="group" aria-label="Old" data-side="old"></div>
  <div role="group" aria-label="New" data-side="new"></div>
</div>`,
      actions: `<button type="button" data-action="save-change">Save change</button>`,
    })}
${dialog({
  id: 'cancel-booking',
  title: 'Cancel booking',
  body: `${field({ id: 'notice-date', label: 'Notice date', extra: 'placeholder="DD/MM/YYYY"' })}
${selectField({ id: 'notice-hour', label: 'Notice hour', values: hours.map((hour) => ({ value: hour, label: hour })) })}
${selectField({
  id: 'notice-minutes',
  label: 'Notice minutes',
  values: minutes.map((minute) => ({ value: minute, label: minute })),
})}
${radioGroup({
  name: 'notice-by',
  legend: 'Notice',
  values: [
    { value: 'customer', label: 'From the customer', checked: true },
    { value: 'arranger', label: 'From us' },
  ],
})}`,
  actions: `<button type="button" data-action="cancel-booking">Cancel booking</button>`,
})}`,
    main: `<div class="sides">
  <div role="group" aria-label="Old">
    <h2>Old</h2>
    <p>${ukDate(view.hire.departAt.date)}, ${escapeHtml(view.hire.departAt.time)}</p>
    <ul>${view.hire.vehicles.map((vehicle) => `<li>${vehicle.seats} seats ${money(vehicle.total)}</li>`).join('')}</ul>
  </div>
  <div role="group" aria-label="New">
    <h2>New</h2>
    <p data-new-departure>—</p>
    <ul data-new-vehicles></ul>
  </div>
</div>
<ul class="per-vehicle">${view.hire.vehicles
      .map(
        (vehicle) =>
          `<li>${vehicle.seats} seats: refunds due ${money(vehicle.refundsDue)}, owed ${money(vehicle.owedAmount)}</li>`,
      )
      .join('')}</ul>
${
  view.cancellation
    ? `<p>${escapeHtml(copy.bookingCancelled)}</p>`
    : `<button type="button" data-opens="cancel-booking">Cancel booking</button>`
}
<ul class="changes-list">${view.changes
      .map((change) => `<li>Change ${escapeHtml(change.id)}${change.priceMoved ? ' — price moved' : ''}</li>`)
      .join('')}</ul>`,
    data: { screen: 'changes', hireId: view.hire.id },
  });
}

function ddmmyyyy(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export type DocumentsView = {
  documents: DocumentRecord[];
  nextInvoice: string;
  nextCreditNote: string;
  hires: { id: string; reference: string }[];
};

export function documentsScreen(view: DocumentsView): string {
  const steps = (document: DocumentRecord): string => {
    const order = ['waiting', 'rendering', 'stored'];
    const at = order.indexOf(document.state);
    return `<ol class="steps" role="list" aria-label="Steps">${order
      .map(
        (step, index) =>
          `<li class="step ${index <= at ? 'done' : ''}" data-step="${step}">${escapeHtml(
            step === 'waiting' ? 'Waiting' : step === 'rendering' ? 'Rendering' : 'Stored',
          )}</li>`,
      )
      .join('')}</ol>`;
  };
  const rows = view.documents.map(
    (document) => `<tr>
  <td>${escapeHtml(DOCUMENT_LABELS[document.kind])}</td>
  <td>${escapeHtml(document.number ?? '')}</td>
  <td>${escapeHtml(document.customerName)}</td>
  <td>${steps(document)}</td>
  <td>${
    document.state === 'stored'
      ? `<a href="/api/documents/${escapeHtml(document.id)}/file">Download</a>`
      : ''
  }
  <button type="button" data-opens="history" data-document="${escapeHtml(document.id)}">History</button></td>
</tr>`,
  );
  return deskShell({
    path: '/documents',
    heading: 'Documents',
    title: 'Documents | Wayticket',
    mainAction: `<button type="button" class="main-action" data-opens="make-document">Make document</button>`,
    dialogs: `${dialog({
      id: 'make-document',
      title: 'Make document',
      body: `${selectField({
        id: 'document-hire',
        label: 'Hire',
        values: view.hires.map((hire) => ({ value: hire.id, label: hire.reference })),
      })}
${selectField({
  id: 'document-kind',
  label: 'Kind',
  values: [
    { value: 'quote', label: 'Quote' },
    { value: 'confirmationLetter', label: 'Confirmation letter' },
    { value: 'invoice', label: 'Invoice' },
    { value: 'creditNote', label: 'Credit note' },
    { value: 'seatPlan', label: 'Seat plan' },
  ],
})}`,
      actions: `<button type="button" data-action="make-document">Make</button>`,
    })}
${sheet({ id: 'history', title: 'History', body: '<ol data-history></ol>', actions: '' })}`,
    main: `<p>Next invoice ${escapeHtml(view.nextInvoice)} &middot; next credit note ${escapeHtml(view.nextCreditNote)}</p>
${frameTable({
  name: 'Documents list',
  head: ['Kind', 'Number', 'Customer', 'Steps', ''],
  rows,
  empty: copy.noDocuments,
})}`,
    data: { screen: 'documents' },
  });
}

export function customersScreen(
  customers: Customer[],
  filter: string,
  reviewList: { row: number; message: string }[],
): string {
  const rows = customers.map(
    (customer) => `<tr>
  <td>${escapeHtml(customer.name)}</td>
  <td>${escapeHtml(customer.email)}</td>
  <td>${escapeHtml(customer.telephone)}</td>
  <td>${customer.state === 'active' ? '' : marker(customer.state === 'closed' ? 'Closed' : 'Erasing')}</td>
  <td>
    <button type="button" data-opens="rename-customer" data-customer="${escapeHtml(customer.id)}">Rename</button>
    <button type="button" data-opens="remove-customer" data-customer="${escapeHtml(customer.id)}">Remove customer</button>
    ${
      customer.state === 'active'
        ? `<button type="button" data-action="close-customer" data-customer="${escapeHtml(customer.id)}">Close customer</button>`
        : `<button type="button" data-action="bring-back" data-customer="${escapeHtml(customer.id)}">Bring back</button>`
    }
  </td>
</tr>`,
  );
  return deskShell({
    path: '/customers',
    heading: 'Customers',
    title: 'Customers | Wayticket',
    mainAction: `<button type="button" class="main-action" data-opens="add-customer">Add customer</button>`,
    dialogs: `${dialog({
      id: 'add-customer',
      title: 'Add customer',
      body: `${field({ id: 'customer-name', label: 'Name', autocomplete: 'name' })}
${field({ id: 'customer-email', label: 'Email', type: 'email', autocomplete: 'email' })}
${field({ id: 'customer-telephone', label: 'Telephone', type: 'tel', autocomplete: 'tel' })}
${selectField({
  id: 'customer-language',
  label: 'Language',
  values: [
    { value: 'en', label: 'English' },
    { value: 'pl', label: 'Polski' },
    { value: 'ur', label: 'اردو' },
  ],
})}`,
      actions: `<button type="button" data-action="save-customer">Save customer</button>`,
    })}
${dialog({
  id: 'rename-customer',
  title: 'Rename customer',
  body: field({ id: 'rename-name', label: 'Name' }),
  actions: `<button type="button" data-action="save-name">Save name</button>`,
})}
${dialog({
  id: 'remove-customer',
  title: 'Remove customer',
  body: note('This cannot be undone.'),
  actions: `<button type="button" data-action="confirm-removal">Confirm removal</button>`,
})}
${dialog({
  id: 'bring-in-old-sheet',
  title: 'Bring in old sheet',
  body: `<div class="field underline-field"><label for="customer-sheet">Customer sheet</label>
  <input id="customer-sheet" type="file" accept="text/csv"></div>`,
  actions: `<button type="button" data-action="read-sheet">Read sheet</button>`,
})}`,
    main: `${radioGroup({
      name: 'customer-filter',
      legend: 'Filter customers',
      values: [
        { value: 'active', label: 'Active', checked: filter !== 'closed' },
        { value: 'closed', label: 'Closed', checked: filter === 'closed' },
      ],
    })}
${frameTable({
  name: 'Customers list',
  head: ['Name', 'Email', 'Telephone', 'State', ''],
  rows,
  empty: copy.noCustomers,
})}
<button type="button" data-opens="bring-in-old-sheet">Bring in old sheet</button>
<h2>Review list</h2>
<ul>${reviewList.map((row) => `<li>Row ${row.row}: ${escapeHtml(row.message)}</li>`).join('')}</ul>`,
    data: { screen: 'customers' },
  });
}

export function complaintsScreen(
  complaints: { id: string; customerName: string; summary: string; receivedDate: string; replyDue: string; holidayLine: string | null }[],
  customers: Customer[],
): string {
  const hours = Array.from({ length: 24 }, (_unused, hour) => String(hour).padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_unused, minute) => String(minute).padStart(2, '0'));
  const names = new Map<string, number>();
  for (const customer of customers) names.set(customer.name, (names.get(customer.name) ?? 0) + 1);
  const rows = complaints.map(
    (complaint) => `<tr>
  <td>${escapeHtml(complaint.customerName)}</td>
  <td>${escapeHtml(complaint.summary)}</td>
  <td>${ukDate(complaint.receivedDate)}</td>
  <td>${ukDate(complaint.replyDue)}</td>
  <td>${complaint.holidayLine ? marker(complaint.holidayLine) : ''}</td>
</tr>`,
  );
  return deskShell({
    path: '/aftercare/complaints',
    heading: 'Complaints',
    title: 'Complaints | Wayticket',
    mainAction: `<button type="button" class="main-action" data-opens="log-complaint">Log complaint</button>`,
    dialogs: dialog({
      id: 'log-complaint',
      title: 'Log complaint',
      body: `${selectField({
        id: 'complaint-customer',
        label: 'Customer',
        values: customers.map((customer) => ({
          value: customer.id,
          label: (names.get(customer.name) ?? 0) > 1 ? `${customer.name} ${customer.email}` : customer.name,
        })),
      })}
${field({ id: 'complaint-summary', label: 'Summary' })}
${field({ id: 'received-date', label: 'Received date', extra: 'placeholder="DD/MM/YYYY"' })}
${selectField({ id: 'received-hour', label: 'Received hour', values: hours.map((hour) => ({ value: hour, label: hour })) })}
${selectField({
  id: 'received-minutes',
  label: 'Received minutes',
  values: minutes.map((minute) => ({ value: minute, label: minute })),
})}`,
      actions: `<button type="button" data-action="save-complaint">Save complaint</button>`,
    }),
    main: frameTable({
      name: 'Complaints list',
      head: ['Customer', 'Summary', 'Received', 'Reply due', ''],
      rows,
      empty: copy.noComplaints,
    }),
    data: { screen: 'complaints' },
  });
}

export function lostPropertyScreen(
  items: { id: string; description: string; foundOn: string; heldTo: string; state: string }[],
): string {
  const rows = items.map(
    (item) => `<tr>
  <td>${escapeHtml(item.description)}</td>
  <td>${ukDate(item.foundOn)}</td>
  <td>${ukDate(item.heldTo)}</td>
  <td>${item.state === 'pastHoldingDate' ? marker(copy.pastHoldingDate) : escapeHtml(item.state === 'returned' ? 'Returned' : 'Held')}</td>
  <td>${
    item.state === 'returned'
      ? ''
      : `<button type="button" data-opens="return-item" data-item="${escapeHtml(item.id)}">Return item</button>`
  }</td>
</tr>`,
  );
  return deskShell({
    path: '/aftercare/lost-property',
    heading: 'Lost property',
    title: 'Lost property | Wayticket',
    mainAction: `<button type="button" class="main-action" data-opens="log-found-item">Log found item</button>`,
    dialogs: `${dialog({
      id: 'log-found-item',
      title: 'Log found item',
      body: `${field({ id: 'item-description', label: 'Item' })}
${field({ id: 'found-on', label: 'Found on', extra: 'placeholder="DD/MM/YYYY"' })}`,
      actions: `<button type="button" data-action="save-item">Save item</button>`,
    })}
${dialog({
  id: 'return-item',
  title: 'Return item',
  body: field({ id: 'owner-details', label: "Owner's details" }),
  actions: `<button type="button" data-action="record-return">Record return</button>`,
})}`,
    main: frameTable({
      name: 'Lost property list',
      head: ['Item', 'Found on', 'Held to', 'State', ''],
      rows,
      empty: copy.noFoundItems,
    }),
    data: { screen: 'lost-property' },
  });
}

export { seatLabels, clockChangeLabel, formatUkDate };
