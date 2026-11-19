import { moneyLabel } from '../../domain/money.js';
import {
  DriverLanguage,
  Language,
  customerString,
  fill,
  peopleCount,
  runString,
  vehicleCount,
} from '../../domain/strings.js';
import { formatDateForLanguage, formatUkDate } from '../../domain/time.js';
import { HireView, QuotePage } from '../data/hires.js';
import { RunRecord } from '../data/runs.js';
import { CustomerStage } from '../routes/quotes.js';
import { escapeHtml, refreshLine, shell } from './layout.js';

const STEPS: { stage: CustomerStage; key: Parameters<typeof customerString>[0] }[] = [
  { stage: 'quoteSent', key: 'quoteSent' },
  { stage: 'accepted', key: 'accepted' },
  { stage: 'deposit', key: 'deposit' },
  { stage: 'balance', key: 'balance' },
  { stage: 'travel', key: 'travel' },
];

export function customerPage(options: {
  hire: HireView;
  page: QuotePage;
  language: Language;
  stage: CustomerStage;
  state: 'open' | 'ended' | 'accepted';
  cancelled: boolean;
}): string {
  const { hire, page, language, stage } = options;
  const say = (key: Parameters<typeof customerString>[0]): string => customerString(key, language);
  const heading = fill(say('yourQuote'), { reference: hire.reference });
  const stepIndex = STEPS.findIndex((step) => step.stage === stage);
  const stepper = `<ol class="stepper" role="list" aria-label="Progress" data-part="stepper">${STEPS.map(
    (step, index) =>
      `<li${index === stepIndex ? ' aria-current="step"' : ''}>${escapeHtml(say(step.key))}</li>`,
  ).join('')}</ol>`;
  const action = options.cancelled
    ? ''
    : options.state === 'accepted'
      ? page.depositSaidSent
        ? `<p class="checking">${escapeHtml(say('checkingPayment'))}</p>`
        : `<button type="button" class="main-action" data-action="deposit-sent">${escapeHtml(say('depositSent'))}</button>`
      : `<button type="button" class="main-action" data-opens="accept-quote">${escapeHtml(say('accept'))}</button>`;
  return shell({
    title: heading,
    language,
    bodyClass: 'private customer-page',
    main: `<div class="band plum-band"><h1 tabindex="-1">${escapeHtml(heading)}</h1></div>
${refreshLine()}
${stepper}
<section class="travel">
  <h2>${escapeHtml(say('travel'))}</h2>
  <p>${escapeHtml(say('route'))}: ${hire.stops.map((stop) => escapeHtml(stop.text)).join(' – ')}</p>
  <p>${escapeHtml(say('out'))}: ${escapeHtml(formatDateForLanguage(hire.departAt.date, language))}, ${escapeHtml(hire.departAt.time)}</p>
  ${
    hire.returnAt
      ? `<p>${escapeHtml(say('return'))}: ${escapeHtml(formatDateForLanguage(hire.returnAt.date, language))}, ${escapeHtml(hire.returnAt.time)}</p>`
      : ''
  }
  <p>${escapeHtml(say('party'))}: ${escapeHtml(peopleCount(hire.party.people, language))}</p>
  <p>${escapeHtml(say('vehicles'))}: ${escapeHtml(vehicleCount(hire.vehicles.length, language))}</p>
</section>
<section class="money">
  <p>${escapeHtml(say('total'))}: ${escapeHtml(moneyLabel(hire.total))}</p>
  <p>${escapeHtml(say('depositDue'))}: ${escapeHtml(moneyLabel(hire.depositTotal))}</p>
  <p>${escapeHtml(fill(say('validUntil'), { date: formatDateForLanguage(page.validUntil, language) }))}</p>
  <p>${escapeHtml(fill(say('payByTransfer'), { reference: hire.reference }))}</p>
</section>
${
  options.state === 'ended' && !options.cancelled
    ? `<p class="ended-line">${escapeHtml(fill(say('quoteEnded'), { date: formatDateForLanguage(page.validUntil, language) }))}</p>`
    : ''
}
${options.cancelled ? `<p class="cancelled-line">${escapeHtml(say('bookingCancelled'))}</p>` : ''}
<p><a href="/api/q/${escapeHtml(page.token)}/pdf">${escapeHtml(say('downloadQuote'))}</a></p>
<form class="language-switch" method="get">
  <label for="language">${escapeHtml(say('language'))}</label>
  <select id="language" name="lang">
    <option value="en"${language === 'en' ? ' selected' : ''}>English</option>
    <option value="pl"${language === 'pl' ? ' selected' : ''}>Polski</option>
    <option value="ur"${language === 'ur' ? ' selected' : ''}>اردو</option>
  </select>
</form>`,
    after: `${action === '' ? '' : `<div class="bottom-bar">${action}</div>`}
<div class="dialog-holder" data-dialog="accept-quote" hidden>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(say('acceptThisQuote'))}" data-dialog-box>
    <h2>${escapeHtml(say('acceptThisQuote'))}</h2>
    <p class="dialog-message" data-message hidden></p>
    <div class="field underline-field">
      <label for="full-name">${escapeHtml(say('yourFullName'))}</label>
      <input id="full-name" type="text" autocomplete="name">
    </div>
    <div class="dialog-actions">
      <button type="button" data-action="confirm-acceptance">${escapeHtml(say('confirmAcceptance'))}</button>
      <button type="button" data-close>${escapeHtml(say('close'))}</button>
    </div>
  </div>
</div>`,
    data: { screen: 'customer-page', token: page.token, language, stage },
  });
}

export function endedPrivatePage(language: Language, kind: 'quote' | 'run'): string {
  const line = customerString('pageEnded', language);
  return shell({
    title: line,
    language,
    bodyClass: 'private ended',
    main: `<div class="band plum-band"><h1 tabindex="-1">${escapeHtml(line)}</h1></div>`,
    data: { screen: 'ended', kind },
  });
}

export function bidPage(options: {
  reference: string;
  stops: string[];
  departAt: { date: string; time: string };
  returnAt: { date: string; time: string } | null;
  vehicles: { index: number; seats: number }[];
  partySize: number;
  token: string;
  prices: string[] | null;
}): string {
  const fields = options.vehicles
    .map(
      (vehicle) => `<div class="field underline-field">
  <label for="price-${vehicle.index}">Price for vehicle ${vehicle.index}</label>
  <input id="price-${vehicle.index}" type="text" inputmode="decimal"
    value="${escapeHtml(options.prices?.[vehicle.index - 1] ?? '')}">
  <span class="field-note">${vehicle.seats} seats</span>
</div>`,
    )
    .join('');
  const hasBid = options.prices !== null;
  return shell({
    title: 'Price this hire',
    bodyClass: 'private bid-page',
    main: `<div class="band plum-band"><h1 tabindex="-1">Price this hire</h1></div>
${refreshLine()}
<section class="hire-facts">
  <p>Route: ${options.stops.map((stop) => escapeHtml(stop)).join(' – ')}</p>
  <p>Out: ${escapeHtml(formatUkDate(options.departAt.date))}, ${escapeHtml(options.departAt.time)}</p>
  ${options.returnAt ? `<p>Return: ${escapeHtml(formatUkDate(options.returnAt.date))}, ${escapeHtml(options.returnAt.time)}</p>` : ''}
  <p>Vehicles: ${options.vehicles.map((vehicle) => `${vehicle.seats} seats`).join(', ')}</p>
  <p>Party size: ${options.partySize}</p>
</section>
<form class="bid-form" novalidate>${fields}</form>
${hasBid ? `<button type="button" data-opens="withdraw-bid">Withdraw bid</button>` : ''}`,
    after: `<div class="bottom-bar">
  <button type="button" class="main-action" data-action="send-price">${hasBid ? 'Change price' : 'Send price'}</button>
</div>
<div class="dialog-holder" data-dialog="withdraw-bid" hidden>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Withdraw bid" data-dialog-box>
    <h2>Withdraw bid</h2>
    <div class="dialog-actions">
      <button type="button" data-action="confirm-withdrawal">Confirm withdrawal</button>
      <button type="button" data-close>Close</button>
    </div>
  </div>
</div>`,
    data: { screen: 'bid-page', token: options.token, vehicles: options.vehicles.length },
  });
}

export function closedBidPage(): string {
  return shell({
    title: 'This bid page has closed',
    bodyClass: 'private ended',
    main: `<div class="band plum-band"><h1 tabindex="-1">This bid page has closed</h1></div>`,
    data: { screen: 'bid-closed' },
  });
}

export function runSheetPage(options: {
  run: RunRecord;
  language: DriverLanguage;
  presses: { stopId: string; kind: string }[];
  flightUnavailable: boolean;
  chargesTotal: number;
}): string {
  const { run, language } = options;
  const say = (key: Parameters<typeof runString>[0]): string => runString(key, language);
  const heading = fill(say('run'), { number: String(run.number) });
  const pressed = (stopId: string, kind: string): boolean =>
    options.presses.some((press) => press.stopId === stopId && press.kind === kind);
  const stops = run.stops
    .map(
      (stop, index) => `<section class="run-stop" role="group" aria-label="${escapeHtml(
        fill(say('stopOf'), { i: String(index + 1), n: String(run.stops.length) }),
      )}" data-stop="${escapeHtml(stop.id)}">
  <h2>${escapeHtml(fill(say('stopOf'), { i: String(index + 1), n: String(run.stops.length) }))}</h2>
  <p>${escapeHtml(stop.text)}</p>
  <div class="press-row">
    ${(['arrived', 'boarded', 'left', 'comfortStop', 'backOnTheRoad'] as const)
      .map(
        (kind) => `<button type="button" class="press" data-press="${kind}" data-stop="${escapeHtml(stop.id)}"
      ${pressed(stop.id, kind) ? 'data-done="true"' : ''}>${escapeHtml(say(kind))}</button>`,
      )
      .join('')}
  </div>
</section>`,
    )
    .join('');
  return shell({
    title: heading,
    language: language === 'pl' ? 'pl' : 'en',
    bodyClass: 'private run-sheet',
    main: `<div class="band plum-band"><h1 tabindex="-1">${escapeHtml(heading)}</h1></div>
${refreshLine()}
<p class="waiting-count" data-part="waiting-count">${escapeHtml(say('allSent'))}</p>
${options.flightUnavailable ? `<p class="flight-line">${escapeHtml(say('flightTimesUnavailable'))}</p>` : ''}
${
  options.chargesTotal > 0
    ? `<p class="charge-line">${escapeHtml(fill(say('waitingCharge'), { amount: moneyLabel(options.chargesTotal) }))}</p>`
    : ''
}
<div class="run-stops">${stops}</div>
<button type="button" data-opens="run-details">${escapeHtml(say('runDetails'))}</button>
<form class="language-switch" method="get">
  <label for="language">${escapeHtml(say('language'))}</label>
  <select id="language" name="lang">
    <option value="en"${language === 'en' ? ' selected' : ''}>English</option>
    <option value="pl"${language === 'pl' ? ' selected' : ''}>Polski</option>
  </select>
</form>`,
    after: `<div class="dialog-holder sheet-holder" data-dialog="run-details" data-sheet hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(say('runDetails'))}" data-dialog-box>
    <h2>${escapeHtml(say('runDetails'))}</h2>
    <p>${escapeHtml(formatUkDate(run.departAt.date))}, ${escapeHtml(run.departAt.time)}</p>
    <p>${run.seats} seats</p>
    <div class="dialog-actions"><button type="button" data-close>${escapeHtml(say('close'))}</button></div>
  </div>
</div>`,
    data: { screen: 'run-sheet', token: run.sheetToken, language, stops: run.stops.map((stop) => stop.id) },
  });
}
