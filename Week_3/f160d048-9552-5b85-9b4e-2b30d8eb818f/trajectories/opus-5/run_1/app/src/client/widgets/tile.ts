import { belowThresholdReports, money } from '../../shared/reference';
import { el } from '../core/dom';
import { countUp, markMotion, runMotion } from '../core/motion';
import { glasswareSvg } from './glassware';

export interface PayRow {
  role_family: string;
  role_name: string;
  city: string;
  city_name: string;
  report_count: number;
  threshold: number;
  band: { low: number; median: number; high: number } | null;
}

export interface SpecimenTile {
  element: HTMLElement;
  band(): string;
  showGlassware(seed: string, caption: string): void;
  showPayRow(row: PayRow, unlocked: boolean): void;
  resolvePayRow(row: PayRow, unlocked: boolean): void;
}

function rowKey(row: PayRow): string {
  return `${row.role_family}:${row.city}`;
}

/** The published caption for a pay-row tile. */
function payRowCaption(row: PayRow): string {
  return row.report_count >= row.threshold
    ? `${row.role_name}, ${row.city_name}. Pay range from ${row.report_count} reports`
    : `${row.role_name}, ${row.city_name}. ${row.report_count} of ${row.threshold} reports so far`;
}

/** The square specimen tile that holds the company's glassware or a pay band. */
export function specimenTile(): SpecimenTile {
  const face = el('div', { class: 'tile-face' });
  const caption = el('figcaption', { class: 'tile-caption' });
  const figure = el('figure', { class: 'specimen-tile', 'data-band': 'none' }, [face, caption]);
  markMotion(figure, 'band-crossfade', 'done');

  const crossfadeTo = (key: string, paint: () => void, text: string): void => {
    const changed = figure.getAttribute('data-band') !== key;
    figure.setAttribute('data-band', key);
    paint();
    caption.textContent = text;
    if (changed) runMotion(figure, 'band-crossfade', 'running', 'done');
  };

  const bandBody = (row: PayRow, unlocked: boolean): HTMLElement => {
    const body = el('div', { class: 'tile-band' });
    body.append(el('p', { class: 'tile-role', text: `${row.role_name}, ${row.city_name}` }));
    const atThreshold = row.report_count >= row.threshold;
    if (row.band) {
      const figures = el('div', { class: 'tile-figures' }, [
        el('span', { class: 'figure', 'data-part': 'low', text: money(row.band.low) }),
        el('span', { 'aria-hidden': 'true', text: ' – ' }),
        el('span', { class: 'figure', 'data-part': 'high', text: money(row.band.high) }),
      ]);
      const median = el('p', { class: 'tile-median' }, [
        document.createTextNode('Median '),
        el('span', { class: 'figure', 'data-part': 'median', text: money(row.band.median) }),
      ]);
      const track = el('div', { class: 'band-track' }, [
        el('span', { class: 'median-tick', 'data-part': 'median-tick' }),
      ]);
      const position =
        row.band.high === row.band.low ? 50 : ((row.band.median - row.band.low) / (row.band.high - row.band.low)) * 100;
      (track.firstElementChild as HTMLElement).style.left = `${position}%`;
      body.append(figures, median, track);
    } else {
      const hatch = el('div', { class: 'hatching' });
      markMotion(hatch, 'band-unhatch', 'covered');
      body.append(
        hatch,
        el('p', {
          class: 'tile-count',
          text:
            atThreshold && !unlocked
              ? 'Share one post to see this range.'
              : belowThresholdReports(row.report_count, row.threshold),
        }),
      );
    }
    return body;
  };

  return {
    element: figure,
    band: () => figure.getAttribute('data-band') ?? 'none',
    showGlassware: (seed, text) => {
      crossfadeTo('none', () => face.replaceChildren(glasswareSvg(seed)), text);
    },
    showPayRow: (row, unlocked) => {
      crossfadeTo(rowKey(row), () => face.replaceChildren(bandBody(row, unlocked)), payRowCaption(row));
    },
    resolvePayRow: (row, unlocked) => {
      figure.setAttribute('data-band', rowKey(row));
      const hatch = face.querySelector<HTMLElement>('.hatching');
      if (hatch) runMotion(hatch, 'band-unhatch', 'running', 'done', () => hatch.remove());
      const body = bandBody(row, unlocked);
      face.replaceChildren(...(hatch ? [hatch, body] : [body]));
      caption.textContent = payRowCaption(row);
      if (row.band) {
        runMotion(body, 'band-count', 'running', 'done');
        const parts: Array<[HTMLElement | null, number]> = [
          [body.querySelector('[data-part="low"]'), row.band.low],
          [body.querySelector('[data-part="high"]'), row.band.high],
          [body.querySelector('[data-part="median"]'), row.band.median],
        ];
        for (const [node, value] of parts) if (node) countUp(node, value, money);
        body.querySelector('.median-tick')?.classList.add('dropping');
      }
    },
  };
}
