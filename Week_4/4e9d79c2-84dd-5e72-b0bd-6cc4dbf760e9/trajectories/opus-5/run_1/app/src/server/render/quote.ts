import { addDays, ukDateOf, ukHoursInDay } from '../../domain/time.js';
import { hoursLeftToday } from '../data/enquiries.js';
import { OCCASION_PAGES } from './content.js';
import { combobox, escapeHtml, field, numberField, problems, radioGroup, selectField, shell } from './layout.js';

export type QuoteStep = 'route' | 'when' | 'details' | 'thanks';

const TICKET_LINES = [
  { key: 'occasion', label: 'Occasion' },
  { key: 'journey', label: 'Journey' },
  { key: 'from', label: 'From' },
  { key: 'to', label: 'To' },
  { key: 'stops', label: 'Stops' },
  { key: 'details', label: 'Details' },
  { key: 'out', label: 'Out' },
  { key: 'return', label: 'Return' },
  { key: 'people', label: 'People' },
  { key: 'bags', label: 'Bags' },
  { key: 'wheelchairs', label: 'Wheelchair users' },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'telephone', label: 'Telephone' },
];

function ticketLines(): string {
  return TICKET_LINES.map(
    (line) => `<div class="ticket-line" data-part="ticket-line" data-line="${line.key}">
  <span class="ticket-label">${escapeHtml(line.label)}</span>
  <span class="ticket-value">Not yet given</span>
</div>`,
  ).join('');
}

function journeyTicket(): string {
  return `<aside class="journey-ticket" aria-label="Journey ticket" data-part="ticket">
  <h2>Journey ticket</h2>
  <div class="ticket-lines">${ticketLines()}</div>
</aside>
<div class="ticket-bar" data-part="ticket-bar">
  <button type="button" class="ticket-open" data-opens="journey-ticket">Journey ticket, 1 answered</button>
  <div class="bar-action" data-part="bar-action"></div>
</div>
<div class="dialog-holder sheet-holder" data-dialog="journey-ticket" data-sheet hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Journey ticket" data-dialog-box>
    <h2>Journey ticket</h2>
    <div class="ticket-lines">${ticketLines()}</div>
    <div class="dialog-actions"><button type="button" data-close>Close</button></div>
  </div>
</div>`;
}

function hourList(id: string, label: string): string {
  const hours = Array.from({ length: 24 }, (_unused, hour) => String(hour).padStart(2, '0'));
  return selectField({
    id,
    label,
    values: [{ value: '', label: '' }, ...hours.map((hour) => ({ value: hour, label: hour }))],
  });
}

function minuteList(id: string, label: string): string {
  return selectField({
    id,
    label,
    values: [
      { value: '', label: '' },
      ...['00', '15', '30', '45'].map((minutes) => ({ value: minutes, label: minutes })),
    ],
  });
}

function calendarDialog(): string {
  return `<div class="dialog-holder" data-dialog="calendar" hidden>
  <div class="dialog calendar" role="dialog" aria-modal="true" aria-label="Choose a date" data-dialog-box>
    <h2>Choose a date</h2>
    <div class="calendar-head">
      <button type="button" data-calendar="previous">Previous month</button>
      <span data-calendar-month></span>
      <button type="button" data-calendar="next">Next month</button>
    </div>
    <table class="calendar-grid" role="grid" aria-label="Choose a date"><tbody data-calendar-body></tbody></table>
    <div class="dialog-actions"><button type="button" data-close>Close</button></div>
  </div>
</div>`;
}

function routeStep(occasion: string | null): string {
  return `<form class="quote-form" data-step="route" novalidate>
  ${problems()}
  ${radioGroup({
    name: 'occasion',
    legend: 'Occasion',
    values: OCCASION_PAGES.map((page) => ({
      value: page.occasion,
      label: page.occasion === 'festivals' ? 'Festivals and sport' : page.occasion === 'school' ? 'School' : page.occasion === 'weddings' ? 'Weddings' : 'Company',
      checked: page.occasion === occasion,
    })),
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
    <label for="stop-details">Stop details</label>
    <textarea id="stop-details" name="stopDetails" rows="3"></textarea>
  </div>
  <div class="step-actions"><button type="submit" class="main-action" data-next>Next</button></div>
</form>`;
}

function whenStep(): string {
  return `<form class="quote-form" data-step="when" novalidate>
  ${problems()}
  <div class="date-shortcuts">
    <button type="button" data-date-shortcut="today" aria-pressed="false">Today</button>
    <button type="button" data-date-shortcut="tomorrow" aria-pressed="false">Tomorrow</button>
  </div>
  ${field({ id: 'out-date', label: 'Out date', inputMode: 'numeric', extra: 'placeholder="DD/MM/YYYY"' })}
  <button type="button" data-opens="calendar" data-calendar-for="out-date">Choose out date</button>
  ${hourList('out-hour', 'Out hour')}
  ${minuteList('out-minutes', 'Out minutes')}
  <div data-repeated-hour="out" hidden></div>
  <div data-return-fields hidden>
    ${field({ id: 'return-date', label: 'Return date', inputMode: 'numeric', extra: 'placeholder="DD/MM/YYYY"' })}
    <button type="button" data-opens="calendar" data-calendar-for="return-date">Choose return date</button>
    ${hourList('return-hour', 'Return hour')}
    ${minuteList('return-minutes', 'Return minutes')}
    <div data-repeated-hour="return" hidden></div>
  </div>
  ${numberField({ id: 'people', label: 'People', min: 1, max: 400 })}
  ${numberField({ id: 'large', label: 'Large (23 kg)', value: '0', min: 0, max: 40 })}
  ${numberField({ id: 'medium', label: 'Medium (15 kg)', value: '0', min: 0, max: 40 })}
  ${numberField({ id: 'hand', label: 'Hand (7 kg)', value: '0', min: 0, max: 40 })}
  ${numberField({ id: 'wheelchairs', label: 'Wheelchair users', value: '0', min: 0, max: 10 })}
  <div class="step-actions">
    <button type="button" data-back>Back</button>
    <button type="submit" class="main-action" data-next>Next</button>
  </div>
</form>`;
}

function detailsStep(): string {
  return `<form class="quote-form" data-step="details" novalidate>
  ${problems()}
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
  })}
  <div class="trap" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
  <div class="step-actions">
    <button type="button" data-back>Back</button>
    <button type="submit" class="main-action" data-send>Send request</button>
  </div>
</form>`;
}

const STEP_HEADINGS: Record<QuoteStep, { heading: string; title: string }> = {
  route: { heading: 'Route', title: 'Route | Get a free quote' },
  when: { heading: 'When and who', title: 'When and who | Get a free quote' },
  details: { heading: 'Your details', title: 'Your details | Get a free quote' },
  thanks: { heading: 'Thank you', title: 'Thank you | Get a free quote' },
};

function clockChangesAfter(date: string): { forward: string | null; back: string | null } {
  let forward: string | null = null;
  let back: string | null = null;
  for (let step = 0; step <= 400 && (!forward || !back); step += 1) {
    const day = addDays(date, step);
    const hours = ukHoursInDay(day);
    if (hours === 23 && !forward) forward = day;
    if (hours === 25 && !back) back = day;
  }
  return { forward, back };
}

export function quotePage(step: QuoteStep, occasion: string | null): string {
  const now = Date.now();
  const today = ukDateOf(now);
  const headings = STEP_HEADINGS[step];
  if (step === 'thanks') {
    return shell({
      title: headings.title,
      bodyClass: 'quote thanks',
      main: `<div class="band cyan-band">
  <h1>Thank you</h1>
  <p class="reference-line" data-part="reference">Request sent.</p>
  <p><a href="/">Back to the home page</a></p>
</div>`,
      data: { step },
    });
  }
  const body = step === 'route' ? routeStep(occasion) : step === 'when' ? whenStep() : detailsStep();
  return shell({
    title: headings.title,
    bodyClass: 'quote',
    main: `<div class="band cyan-band quote-field">
  <h1 tabindex="-1">${escapeHtml(headings.heading)}</h1>
  <div class="quote-holder">${body}${journeyTicket()}</div>
</div>
${calendarDialog()}`,
    data: {
      step,
      occasion,
      today,
      tomorrow: addDays(today, 1),
      hoursToday: hoursLeftToday(now),
      clockChanges: clockChangesAfter(today),
    },
  });
}
