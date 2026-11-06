import type { Session } from '../auth.ts';
import { query } from '../db/pool.ts';
import { isNight } from '../../domain/night.ts';
import { MARKETS, marketCity } from '../../domain/markets.ts';
import { rollingOpenings, simultaneousOpenings, type MarketOpening } from '../../domain/golive.ts';
import { STATUS_COPY } from '../../domain/copy.ts';
import {
  copenhagenToday,
  copenhagenTomorrow,
  copenhagenWall,
  formatCopenhagenInstant,
  formatInstant,
  formatMarketTime,
  formatTimeOfDay,
  parseLocalDateTime,
  pad,
} from '../../domain/time.ts';
import { restockOccurrences } from '../../domain/restocks.ts';
import type { DropRecord } from '../repo/drops.ts';
import { openingsFor } from '../repo/timing.ts';
import {
  button,
  dialog,
  field,
  link,
  pageData,
  panel,
  radioGroup,
  stickyBar,
  table,
} from './components.ts';
import { dialMarkup, ledgerRows, marketsSheetRows, sliderMarkup, type DialModel } from './dial.ts';
import { attrs, html, raw } from './html.ts';
import { page, problemsRegion, statusMark, statusRegion } from './layout.ts';

const DROP_TYPE_OPTIONS = [
  { value: 'simultaneous', label: 'Simultaneous' },
  { value: 'rolling', label: 'Rolling' },
];

const MARKET_OPTIONS = MARKETS.map((market) => ({ value: market, label: marketCity(market) }));

export function dropsPage(session: Session, drops: readonly DropRecord[]): string {
  const main = html`<h1 class="page-heading">Drops</h1>
${session.role === 'launch_producer' ? html`<p>${link('New drop', '/studio/drops/new', { variant: 'button' })}</p>` : raw('')}
${table({
  name: 'Drops',
  columns: ['Name', 'Type', 'Status', 'Opens'],
  rows: drops.map(
    (drop) => html`<tr>
    <td>${link(drop.name, `/studio/drops/${drop.id}`)}</td>
    <td>${drop.type === 'simultaneous' ? 'Simultaneous' : 'Rolling'}</td>
    <td>${statusMark(drop.status)}</td>
    <td class="mono">${drop.goLiveAtMs === null ? '—' : formatCopenhagenInstant(drop.goLiveAtMs)}</td>
  </tr>`,
  ),
})}
${pageData({ screen: 'drops' })}`;
  return page({ title: 'Drops', session, activePath: '/studio/drops' }, main);
}

export function newDropPage(session: Session): string {
  const main = html`<h1 class="page-heading">New drop</h1>
<form class="form new-drop" data-form="new-drop">
  ${problemsRegion()}
  <p class="new-drop__counter mono" data-step-counter>Step 1 / 4</p>

  <fieldset class="new-drop__step" data-step="1">
    <legend class="panel__heading">Basics</legend>
    ${field({ name: 'name', label: 'Drop name' })}
    ${radioGroup('type', 'Drop type', DROP_TYPE_OPTIONS, 'simultaneous')}
    ${field({ name: 'holdSeconds', label: 'Hold length in seconds', kind: 'number', value: '900', min: 10, max: 86400 })}
    ${field({ name: 'internalNote', label: 'Internal note', kind: 'textarea' })}
  </fieldset>

  <fieldset class="new-drop__step" data-step="2" hidden>
    <legend class="panel__heading">Markets</legend>
    ${MARKETS.map((market) =>
      field({
        name: `markets.${market}`,
        label: `${marketCity(market)} pieces`,
        kind: 'number',
        value: '0',
        min: 0,
        max: 100000,
      }),
    )}
  </fieldset>

  <fieldset class="new-drop__step" data-step="3" hidden>
    <legend class="panel__heading">Styles</legend>
    ${table({
      name: 'Styles',
      columns: ['Style number', 'Style name', 'Colour', 'Wholesale edition'],
      rows: [],
      bodyAttributes: { 'data-style-rows': 'rows' },
    })}
    ${button('Add style', { variant: 'quiet', action: 'add-style' })}
  </fieldset>

  <fieldset class="new-drop__step" data-step="4" hidden>
    <legend class="panel__heading">Review</legend>
    <dl class="review" data-review></dl>
    ${button('Create drop', { pending: 'Creating…', action: 'create-drop' })}
  </fieldset>

  <div class="form__actions">
    ${button('Back', { variant: 'quiet', action: 'step-back' })}
    ${button('Next', { variant: 'quiet', action: 'step-next' })}
  </div>
  ${statusRegion('New drop status')}
</form>
${pageData({ screen: 'new-drop', memberId: session.memberId })}`;
  return page({ title: 'New drop', session, activePath: '/studio/drops' }, main);
}

export function dialModelFor(drop: DropRecord, nowMs: number): DialModel {
  const saved = openingsFor({
    type: drop.type,
    goLiveAtMs: drop.goLiveAtMs,
    copenhagenGoLive: drop.copenhagenGoLive,
    localGoLive: drop.localGoLive,
  });
  const date = plannerDate(drop, nowMs);
  const time = plannerTime(drop);
  const openings = saved ?? previewOpenings(drop, date, time);
  const copenhagen = openings?.find((opening) => opening.market === 'copenhagen') ?? null;
  const step = Number(time.slice(0, 2)) * 4 + Number(time.slice(3, 5)) / 15;
  return {
    openings,
    copenhagenInstantMs: copenhagen?.instantMs ?? null,
    step,
    spokenValue:
      copenhagen === null ? `${date} ${time}` : formatCopenhagenInstant(copenhagen.instantMs),
    gapNote: null,
    shiftNotes: (openings ?? [])
      .filter((opening) => opening.shiftedTo !== null)
      .map((opening) => STATUS_COPY.rollingShift(marketCity(opening.market), opening.localTime)),
  };
}

/** The openings the dial shows for a date and time that are not saved yet. */
function previewOpenings(drop: DropRecord, date: string, time: string): MarketOpening[] | null {
  const wall = parseLocalDateTime(`${date}T${time}`);
  if (wall === null) return null;
  if (drop.type === 'rolling') return rollingOpenings(wall);
  const copenhagen = rollingOpenings(wall).find((opening) => opening.market === 'copenhagen');
  return copenhagen === undefined ? null : simultaneousOpenings(copenhagen.instantMs);
}

export function plannerDate(drop: DropRecord, nowMs: number): string {
  if (drop.type === 'rolling' && drop.localGoLive !== null) return drop.localGoLive.slice(0, 10);
  if (drop.copenhagenGoLive !== null) return drop.copenhagenGoLive.slice(0, 10);
  if (drop.goLiveAtMs !== null) {
    const wall = copenhagenWall(drop.goLiveAtMs);
    return `${pad(wall.year, 4)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}`;
  }
  return copenhagenTomorrow(nowMs);
}

export function plannerTime(drop: DropRecord): string {
  if (drop.type === 'rolling' && drop.localGoLive !== null) return drop.localGoLive.slice(11, 16);
  if (drop.copenhagenGoLive !== null) return drop.copenhagenGoLive.slice(11, 16);
  if (drop.goLiveAtMs !== null) return formatTimeOfDay(copenhagenWall(drop.goLiveAtMs));
  return '10:00';
}

export async function plannerPage(
  session: Session,
  drop: DropRecord,
  nowMs: number,
): Promise<string> {
  const model = dialModelFor(drop, nowMs);
  const series = await query<{
    id: string;
    weekday: string;
    copenhagen_time: string;
    first_restock: string;
  }>('select id, weekday, copenhagen_time, first_restock from restock_series where drop_id = $1 order by created_at_ms', [
    drop.id,
  ]);
  const first = series[0];
  const firstWall = first === undefined ? null : parseLocalDateTime(first.first_restock);
  const occurrences = firstWall === null ? [] : restockOccurrences(firstWall, nowMs, 8);

  const main = html`<h1 class="page-heading">Plan ${drop.name}</h1>
<div class="planner">
  <div class="planner__controls">
    ${field({ name: 'dropDate', label: 'Drop date', value: plannerDate(drop, nowMs), placeholder: 'YYYY-MM-DD' })}
    ${radioGroup('dropType', 'Drop type', DROP_TYPE_OPTIONS, drop.type)}
    ${sliderMarkup(model)}
  </div>
  <div class="planner__dial">${dialMarkup(model)}</div>
  <div class="planner__ledger">
    ${panel(
      'Market times',
      table({
        name: 'Market times',
        columns: ['Market', 'Local time', 'Night', 'Opens', 'UTC'],
        rows: ledgerRows(model),
        bodyAttributes: { 'data-ledger': 'rows' },
      }),
    )}
  </div>
  <div class="planner__actions">
    ${problemsRegion()}
    <div class="planner__buttons planner__buttons--desktop">
      ${button('Save time', { pending: 'Saving time…', action: 'save-time' })}
      ${button('Schedule drop', { variant: 'quiet', pending: 'Scheduling…', action: 'schedule-drop' })}
      ${button('Withdraw drop', { variant: 'danger', action: 'open-withdraw' })}
      ${button('Add VIP members', { variant: 'quiet', action: 'open-vip' })}
    </div>
    ${statusRegion('Planner status')}
  </div>
  <div class="planner__restock">
    <section class="panel" role="region" aria-label="Weekly restock">
      <h2 class="panel__heading">Weekly restock</h2>
      ${field({ name: 'firstRestockDate', label: 'First restock date', value: first === undefined ? '' : first.first_restock.slice(0, 10), placeholder: 'YYYY-MM-DD' })}
      ${field({ name: 'restockTime', label: 'Restock time', value: first === undefined ? '' : first.copenhagen_time, placeholder: 'HH:MM' })}
      ${MARKETS.map((market) =>
        field({
          name: `restock.${market}`,
          label: `${marketCity(market)} restock pieces`,
          kind: 'number',
          value: '0',
          min: 0,
          max: 100000,
        }),
      )}
      ${button('Save restock', { pending: 'Saving restock…', action: 'save-restock' })}
    </section>
  </div>
  <div class="planner__next">
    ${panel(
      'Next restocks',
      table({
        name: 'Next restocks',
        columns: ['#', 'Copenhagen', 'London', 'New York', 'UTC'],
        rows: occurrences.map(
          (instant, index) => html`<tr>
          <td class="mono">${index + 1}</td>
          <td class="mono">${formatMarketTime(instant, 'copenhagen')}</td>
          <td class="mono">${formatMarketTime(instant, 'london')}</td>
          <td class="mono">${formatMarketTime(instant, 'new_york')}</td>
          <td class="mono">${formatInstant(instant)}</td>
        </tr>`,
        ),
        bodyAttributes: { 'data-next-restocks': 'rows' },
      }),
    )}
  </div>
  <section class="markets-sheet" role="region" aria-label="Markets">
    <h2 class="panel__heading">Markets</h2>
    ${marketsSheetRows(model)}
  </section>
</div>
${stickyBar(button('Save time', { pending: 'Saving time…', action: 'save-time' }))}
${dialog({
  name: 'Withdraw drop',
  body: field({ name: 'reason', label: 'Reason', kind: 'textarea' }),
  actions: html`${button('Withdraw drop', { variant: 'danger', pending: 'Withdrawing…', action: 'withdraw-drop' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${dialog({
  name: 'Add VIP members',
  body: html`${field({ name: 'vipMarket', label: 'Market', kind: 'select', options: MARKET_OPTIONS, value: 'copenhagen' })}
${field({ name: 'vipList', label: 'VIP list', kind: 'textarea', rows: 5, hint: 'One "Name <email>" per line.' })}`,
  actions: html`${button('Add members', { pending: 'Adding members…', action: 'add-vip' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${pageData({
  screen: 'planner',
  dropId: drop.id,
  dropName: drop.name,
  status: drop.status,
  type: drop.type,
  date: plannerDate(drop, nowMs),
  time: plannerTime(drop),
  step: model.step,
  today: copenhagenToday(nowMs),
  markets: MARKETS,
  nights: (model.openings ?? []).map((opening) => ({
    market: opening.market,
    night: isNight(opening.localTime),
  })),
})}`;
  return page({ title: `Plan ${drop.name}`, session, activePath: '/studio/drops' }, main);
}
