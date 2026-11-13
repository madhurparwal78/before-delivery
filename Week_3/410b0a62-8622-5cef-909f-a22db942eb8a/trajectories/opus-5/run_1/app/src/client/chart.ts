import { app } from './app.js';
import { el, prefersReducedMotion, svgEl } from './dom.js';
import { dataNumber, formatLongDay, formatTsb, formatTss } from './format.js';
import { addDays, mondayOfWeek } from '../domain/time.js';
import type { SeriesDay } from '../domain/types.js';

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 220;
const PAD_Y = 16;

export interface ChartHandle {
  element: HTMLElement;
  update(days: SeriesDay[], week: string, animate: boolean): void;
}

function lineY(value: number, max: number): number {
  const span = Math.max(max, 10);
  return VIEW_HEIGHT - PAD_Y - (value / span) * (VIEW_HEIGHT - 2 * PAD_Y);
}

/** The fitness chart card: the stored series, a week band, and a table mirror. */
export function createChart(): ChartHandle {
  const band = svgEl('rect', {
    class: 'week-band',
    attrs: { x: 0, y: 0, width: 0, height: VIEW_HEIGHT },
  });
  const ctlLine = svgEl('polyline', { class: 'chart-line chart-line-ctl', attrs: { points: '' } });
  const atlLine = svgEl('polyline', { class: 'chart-line chart-line-atl', attrs: { points: '' } });
  const marks = svgEl('g', { class: 'chart-points' });
  const focusLine = svgEl('line', {
    class: 'chart-focus',
    attrs: { x1: 0, x2: 0, y1: 0, y2: VIEW_HEIGHT },
  });
  const svg = svgEl('svg', {
    class: 'chart-svg',
    attrs: { viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`, 'aria-hidden': 'true' },
    children: [band, ctlLine, atlLine, marks, focusLine],
  });

  const plot = el('div', {
    class: 'chart-plot',
    attrs: {
      role: 'group',
      'aria-label': 'Fitness chart',
      tabindex: '0',
      'data-animating': 'false',
      'data-animation-ms': String(prefersReducedMotion() ? 0 : app.chartAnimationMs),
      'data-focus-date': '',
    },
    children: [svg],
  });
  const readout = el('p', {
    class: 'chart-readout',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Chart readout' },
  });
  const tableBody = el('tbody');
  const table = el('table', {
    class: 'chart-table',
    attrs: { 'aria-label': 'Fitness table' },
    children: [
      el('thead', {
        children: [
          el('tr', {
            children: ['Date', 'TSS', 'Fitness', 'Fatigue', 'Form'].map((label) =>
              el('th', { text: label, attrs: { scope: 'col' } }),
            ),
          }),
        ],
      }),
      tableBody,
    ],
  });

  const element = el('section', {
    class: 'card chart-card',
    children: [
      el('h2', { class: 'card-title', text: 'Fitness chart' }),
      plot,
      readout,
      table,
    ],
  });

  let days: SeriesDay[] = [];
  let shown: SeriesDay[] = [];
  let centreWeek = '';
  let focusDate = '';
  let frame = 0;

  function paintLines(values: SeriesDay[]): void {
    const count = values.length;
    if (count === 0) {
      ctlLine.setAttribute('points', '');
      atlLine.setAttribute('points', '');
      return;
    }
    const slot = VIEW_WIDTH / count;
    const max = Math.max(...values.map((day) => Math.max(day.ctl, day.atl)));
    ctlLine.setAttribute(
      'points',
      values.map((day, index) => `${index * slot + slot / 2},${lineY(day.ctl, max)}`).join(' '),
    );
    atlLine.setAttribute(
      'points',
      values.map((day, index) => `${index * slot + slot / 2},${lineY(day.atl, max)}`).join(' '),
    );
    marks.replaceChildren(
      ...values.map((day, index) =>
        svgEl('circle', {
          class: `chart-point${day.date === focusDate ? ' chart-point-focus' : ''}`,
          attrs: {
            cx: index * slot + slot / 2,
            cy: lineY(day.ctl, max),
            r: day.date === focusDate ? 6 : 2.5,
            'data-date': day.date,
            'data-ctl': dataNumber(day.ctl, 1),
            'data-atl': dataNumber(day.atl, 1),
            'data-tsb': dataNumber(day.tsb, 1),
          },
        }),
      ),
    );
    const focusIndex = values.findIndex((day) => day.date === focusDate);
    const x = focusIndex === -1 ? 0 : focusIndex * slot + slot / 2;
    focusLine.setAttribute('x1', String(x));
    focusLine.setAttribute('x2', String(x));
  }

  function paintBand(): void {
    const count = days.length;
    if (count === 0 || centreWeek === '') {
      band.setAttribute('width', '0');
      return;
    }
    const slot = VIEW_WIDTH / count;
    const monday = mondayOfWeek(centreWeek);
    const sunday = addDays(monday, 6);
    const first = days.findIndex((day) => day.date >= monday);
    const lastReversed = [...days].reverse().findIndex((day) => day.date <= sunday);
    const last = lastReversed === -1 ? -1 : count - 1 - lastReversed;
    band.setAttribute('data-week', centreWeek);
    if (first === -1 || last < first) {
      band.setAttribute('width', '0');
      return;
    }
    band.setAttribute('x', String(first * slot));
    band.setAttribute('width', String((last - first + 1) * slot));
  }

  function paintTable(): void {
    tableBody.replaceChildren(
      ...days.map((day) =>
        el('tr', {
          attrs: {
            'data-date': day.date,
            'data-tss': dataNumber(day.tss, 1),
            'data-ctl': dataNumber(day.ctl, 1),
            'data-atl': dataNumber(day.atl, 1),
            'data-tsb': dataNumber(day.tsb, 1),
          },
          children: [
            el('th', { text: formatLongDay(day.date), attrs: { scope: 'row' } }),
            el('td', { text: formatTss(day.tss) }),
            el('td', { text: formatTss(day.ctl) }),
            el('td', { text: formatTss(day.atl) }),
            el('td', { text: formatTsb(day.tsb) }),
          ],
        }),
      ),
    );
  }

  function readoutText(date: string): string {
    const day = days.find((candidate) => candidate.date === date);
    if (!day) return '';
    return `${formatLongDay(day.date)}: ${formatTss(day.tss)} TSS, fitness ${formatTss(
      day.ctl,
    )}, fatigue ${formatTss(day.atl)}, form ${formatTsb(day.tsb)}`;
  }

  function setFocusDate(date: string): void {
    focusDate = date;
    plot.setAttribute('data-focus-date', date);
    paintLines(shown);
    readout.textContent = readoutText(date);
  }

  plot.addEventListener('keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    const dates = days.map((day) => day.date);
    if (dates.length === 0) return;
    const index = dates.indexOf(focusDate);
    let next = index;
    if (keyboard.key === 'ArrowLeft') next = Math.max(0, index - 1);
    else if (keyboard.key === 'ArrowRight') next = Math.min(dates.length - 1, index + 1);
    else if (keyboard.key === 'Home') next = 0;
    else if (keyboard.key === 'End') next = dates.length - 1;
    else return;
    keyboard.preventDefault();
    setFocusDate(dates[next] as string);
  });

  function animateTo(target: SeriesDay[]): void {
    const from = shown;
    const duration = app.chartAnimationMs;
    const start = performance.now();
    plot.setAttribute('data-animating', 'true');
    cancelAnimationFrame(frame);
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      shown = target.map((day, index) => {
        const previous = from[index];
        return {
          date: day.date,
          tss: day.tss,
          ctl: previous ? previous.ctl + (day.ctl - previous.ctl) * progress : day.ctl,
          atl: previous ? previous.atl + (day.atl - previous.atl) * progress : day.atl,
          tsb: day.tsb,
        };
      });
      paintLines(shown);
      if (progress < 1) {
        frame = requestAnimationFrame(step);
        return;
      }
      shown = target;
      paintLines(shown);
      plot.setAttribute('data-animating', 'false');
    };
    frame = requestAnimationFrame(step);
  }

  return {
    element,
    update(nextDays, week, animate) {
      const reduced = prefersReducedMotion();
      plot.setAttribute('data-animation-ms', String(reduced ? 0 : app.chartAnimationMs));
      const changed =
        nextDays.length !== days.length ||
        nextDays.some(
          (day, index) =>
            day.ctl !== days[index]?.ctl || day.atl !== days[index]?.atl || day.tss !== days[index]?.tss,
        );
      const hadDays = days.length > 0;
      days = nextDays;
      centreWeek = week;
      if (focusDate === '' || !days.some((day) => day.date === focusDate)) {
        focusDate = days.length > 0 ? (days[days.length - 1] as SeriesDay).date : '';
        plot.setAttribute('data-focus-date', focusDate);
      }
      paintTable();
      paintBand();
      if (animate && !reduced && changed && hadDays) {
        animateTo(days);
        return;
      }
      shown = days;
      paintLines(shown);
    },
  };
}
