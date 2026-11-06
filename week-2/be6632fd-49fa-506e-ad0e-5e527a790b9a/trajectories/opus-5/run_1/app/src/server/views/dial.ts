import { isNight } from '../../domain/night.ts';
import { MARKETS, marketCity, type Market } from '../../domain/markets.ts';
import type { MarketOpening } from '../../domain/golive.ts';
import { formatInstant, formatMarketTime } from '../../domain/time.ts';
import { attrs, html, raw, type RawHtml } from './html.ts';
import { nightMark } from './layout.ts';

/** Outermost ring is Copenhagen, innermost Tokyo. */
export const PIN_ORDER: readonly Market[] = MARKETS;

const QUARTERS = 96;
const RADIUS = 150;
const CENTRE = 170;

function ringMarkup(): RawHtml {
  const ticks: string[] = [];
  for (let step = 0; step < QUARTERS; step += 1) {
    const angle = (step / QUARTERS) * 360 - 90;
    const radians = (angle * Math.PI) / 180;
    const long = step % 4 === 0;
    const outer = RADIUS;
    const inner = RADIUS - (long ? 14 : 7);
    ticks.push(
      `<line x1="${(CENTRE + Math.cos(radians) * inner).toFixed(2)}" y1="${(CENTRE + Math.sin(radians) * inner).toFixed(2)}" x2="${(CENTRE + Math.cos(radians) * outer).toFixed(2)}" y2="${(CENTRE + Math.sin(radians) * outer).toFixed(2)}" class="${long ? 'dial__tick dial__tick--hour' : 'dial__tick'}"/>`,
    );
  }

  const numerals: string[] = [];
  for (let hour = 0; hour < 24; hour += 3) {
    const angle = (hour / 24) * 360 - 90;
    const radians = (angle * Math.PI) / 180;
    const radius = RADIUS - 30;
    numerals.push(
      `<text x="${(CENTRE + Math.cos(radians) * radius).toFixed(2)}" y="${(CENTRE + Math.sin(radians) * radius).toFixed(2)}" class="dial__numeral" text-anchor="middle" dominant-baseline="middle">${String(hour).padStart(2, '0')}</text>`,
    );
  }

  // The night band runs from 22:00 round to 07:00.
  const start = (22 / 24) * 360 - 90;
  const end = (7 / 24) * 360 - 90;
  const toPoint = (degrees: number, radius: number): string => {
    const radians = (degrees * Math.PI) / 180;
    return `${(CENTRE + Math.cos(radians) * radius).toFixed(2)} ${(CENTRE + Math.sin(radians) * radius).toFixed(2)}`;
  };
  const outerRadius = RADIUS;
  const innerRadius = RADIUS - 16;
  const arc = `M ${toPoint(start, outerRadius)} A ${outerRadius} ${outerRadius} 0 1 1 ${toPoint(end, outerRadius)} L ${toPoint(end, innerRadius)} A ${innerRadius} ${innerRadius} 0 1 0 ${toPoint(start, innerRadius)} Z`;

  return raw(
    `<svg class="dial__ring" viewBox="0 0 ${CENTRE * 2} ${CENTRE * 2}" aria-hidden="true" focusable="false">
      <circle cx="${CENTRE}" cy="${CENTRE}" r="${RADIUS}" class="dial__circle"/>
      <path d="${arc}" class="dial__night-arc"/>
      ${ticks.join('')}
      ${numerals.join('')}
    </svg>`,
  );
}

export interface DialModel {
  openings: MarketOpening[] | null;
  copenhagenInstantMs: number | null;
  /** Quarter-hour step 0 to 95 of the chosen time of day. */
  step: number;
  spokenValue: string;
  gapNote: string | null;
  shiftNotes: string[];
}

function pinMarkup(opening: MarketOpening | null, market: Market, ring: number): RawHtml {
  const night = opening === null ? false : isNight(opening.localTime);
  return html`<div class="dial__pin-ring"${attrs({ 'data-pin-ring': market, style: `--ring:${ring}` })}>
  <div class="dial__pin"${attrs({
    'data-market': market,
    'data-local-time': opening === null ? '' : opening.localTime,
    'data-night': night ? 'true' : 'false',
    'data-utc': opening === null ? '' : formatInstant(opening.instantMs),
  })}>
    <span class="dial__pin-city">${marketCity(market)}</span>
    <span class="dial__pin-time mono" data-pin-time>${opening === null ? '—' : opening.localTime}</span>
    <span class="dial__pin-night"${attrs({ hidden: !night })} data-pin-night>${nightMark()}</span>
  </div>
</div>`;
}

export function dialMarkup(model: DialModel): RawHtml {
  const openingFor = (market: Market): MarketOpening | null =>
    model.openings?.find((opening) => opening.market === market) ?? null;

  return html`<div class="dial" role="group" aria-label="Embargo dial"${attrs({
    'data-dial': 'root',
    'data-utc': model.copenhagenInstantMs === null ? '' : formatInstant(model.copenhagenInstantMs),
  })}>
  ${ringMarkup()}
  <div class="dial__hand" data-dial-hand aria-hidden="true"></div>
  <div class="dial__pins">${PIN_ORDER.map((market, index) => pinMarkup(openingFor(market), market, index + 1))}</div>
  <p class="dial__countdown mono" role="timer" aria-label="Countdown to go-live"${attrs({
    'data-countdown': 'golive',
    'data-deadline': model.copenhagenInstantMs === null ? '' : formatInstant(model.copenhagenInstantMs),
  })}>00:00:00</p>
</div>`;
}

export function sliderMarkup(model: DialModel): RawHtml {
  return html`<div class="dial-slider">
  <span class="dial-slider__label" id="dial-slider-label">Drop time</span>
  <div class="dial-slider__track"
    role="slider"
    tabindex="0"
    aria-labelledby="dial-slider-label"
    data-dial-slider
    aria-valuemin="0"
    aria-valuemax="95"${attrs({ 'aria-valuenow': model.step, 'aria-valuetext': model.spokenValue })}>
    <span class="dial-slider__thumb" aria-hidden="true"></span>
  </div>
  <p class="dial-slider__notes" data-dial-notes>${model.gapNote ?? model.shiftNotes.join(' ')}</p>
</div>`;
}

export function ledgerRows(model: DialModel): RawHtml[] {
  return PIN_ORDER.map((market) => {
    const opening = model.openings?.find((entry) => entry.market === market) ?? null;
    const night = opening === null ? false : isNight(opening.localTime);
    return html`<tr${attrs({ 'data-ledger-row': market })}>
      <td>${marketCity(market)}</td>
      <td class="mono" data-ledger-local>${opening === null ? '—' : opening.localTime}</td>
      <td data-ledger-night>${night ? nightMark() : raw('')}</td>
      <td class="mono" data-ledger-opens>${opening === null ? '—' : formatMarketTime(opening.instantMs, market)}</td>
      <td class="mono" data-ledger-utc>${opening === null ? '—' : formatInstant(opening.instantMs)}</td>
    </tr>`;
  });
}

export function marketsSheetRows(model: DialModel): RawHtml {
  return html`<ul class="markets-sheet__list">
  ${PIN_ORDER.map((market) => {
    const opening = model.openings?.find((entry) => entry.market === market) ?? null;
    const night = opening === null ? false : isNight(opening.localTime);
    return html`<li class="markets-sheet__item"${attrs({ 'data-sheet-market': market })}>
      <span>${marketCity(market)}</span>
      <span class="mono" data-sheet-local>${opening === null ? '—' : opening.localTime}</span>
      <span data-sheet-night>${night ? nightMark() : raw('')}</span>
    </li>`;
  })}
</ul>`;
}
