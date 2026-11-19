import { get, send } from '../api.js';
import { el, svg } from '../dom.js';
import { planFor } from '../plan.js';
import { session } from '../session.js';
import { ChartView } from '../view/chart.js';
import { renderTwin } from '../view/table.js';
import type { QueryResult, SheetSpec } from '../../shared/types.js';

const SAMPLE_SHEET = 'sample-sheet';

function sticker(kind: 'pill' | 'sum' | 'blob' | 'badge', className: string): HTMLElement {
  const root = svg('svg', { class: `sticker ${className}`, width: 180, height: 120, viewBox: '0 0 180 120', 'aria-hidden': 'true' });
  if (kind === 'pill') {
    root.append(svg('rect', { x: 10, y: 30, width: 150, height: 56, rx: 28, fill: 'rgb(217, 225, 63)', stroke: 'rgb(26,10,20)', 'stroke-width': 3 }));
  }
  if (kind === 'sum') {
    root.append(svg('rect', { x: 10, y: 24, width: 150, height: 68, rx: 34, fill: 'rgb(233, 71, 159)', stroke: 'rgb(26,10,20)', 'stroke-width': 3 }));
    root.append(svg('text', { x: 85, y: 70, 'text-anchor': 'middle', class: 'sticker-text' }, ['SUM']));
  }
  if (kind === 'blob') {
    root.append(svg('circle', { cx: 86, cy: 58, r: 46, fill: 'rgb(234, 160, 205)', stroke: 'rgb(26,10,20)', 'stroke-width': 3 }));
  }
  if (kind === 'badge') {
    root.append(svg('rect', { x: 24, y: 24, width: 120, height: 68, rx: 20, fill: 'rgb(253, 241, 247)', stroke: 'rgb(26,10,20)', 'stroke-width': 3 }));
    root.append(svg('text', { x: 84, y: 70, 'text-anchor': 'middle', class: 'sticker-text' }, ['AT']));
  }
  return root as unknown as HTMLElement;
}

export async function homePage(host: HTMLElement): Promise<void> {
  document.body.dataset.field = 'ground';
  const hero = el('section', { class: 'hero' }, [
    el('h1', { class: 'hero-headline' }, [
      el('span', { class: 'hero-grey', text: 'Charts you ' }),
      el('span', { class: 'hero-ink', text: 'can explain.' }),
    ]),
  ]);
  const region = el('section', { class: 'sample-sheet', 'aria-label': 'Sample sheet' });
  region.setAttribute('role', 'region');
  const chartHost = el('div', { class: 'chart-card' });
  const tableHost = el('div', { class: 'twin-card' });
  region.append(chartHost, tableHost);

  const linkHost = el('p', { class: 'hero-cta' }, [
    el('a', {
      href: session.me === null ? '/signin?next=/workbooks' : '/workbooks',
      class: 'pill-link lime',
      text: 'Open a workbook',
    }),
  ]);

  host.append(
    el('div', { class: 'home' }, [
      sticker('pill', 'sticker-tl'),
      sticker('sum', 'sticker-tr'),
      sticker('blob', 'sticker-bl'),
      sticker('badge', 'sticker-br'),
      hero,
      region,
      linkHost,
    ]),
  );

  const sheetRes = await get<SheetSpec & { calculations: { name: string; formula: string }[] }>(
    `/api/sheets/${SAMPLE_SHEET}`,
  );
  if (sheetRes.status !== 200) return;
  const queryRes = await send<QueryResult>('POST', `/api/sheets/${SAMPLE_SHEET}/query?gen=1`, {
    filters: [],
    parameters: {},
    sets: {},
  });
  if (queryRes.status !== 200) return;
  const result = queryRes.data;
  const plan = planFor(sheetRes.data, [], result.chart === 'none' ? null : result.chart);
  const chart = new ChartView(chartHost);
  chart.draw({ result, plan, height: 300 });
  renderTwin(tableHost, sheetRes.data.name, result, plan.primary);
}
