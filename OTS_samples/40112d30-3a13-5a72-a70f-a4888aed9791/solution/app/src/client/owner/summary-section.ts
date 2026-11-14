import { M57, M58_HIGHEST, M58_LOWEST, M58_MEAN } from '../../shared/messages.ts';
import type { SummaryQuestion, SummaryRow } from '../../shared/types.ts';
import { h } from '../lib/dom.ts';
import { barChart } from './bar-chart.ts';
import { optionTable, rankingTable } from './summary-table.ts';

// One region per question, in form order: how many answered, the figures, then its table beside its chart.

function panel(heading: string | null, table: HTMLElement, chart: SVGSVGElement | null): HTMLElement {
  return h('div', { class: 'panel' }, heading === null ? null : h('h3', {}, heading), table, chart);
}

function optionPanel(name: string, heading: string | null, rows: SummaryRow[]): HTMLElement {
  return panel(heading, optionTable(`${name} table`, rows), barChart(name, rows));
}

function panels(question: SummaryQuestion): HTMLElement[] {
  if (question.grid.length > 0) {
    return question.grid.map((row) => optionPanel(`${question.label}: ${row.label}`, row.label, row.rows));
  }
  if (question.rows.length > 0) return [optionPanel(question.label, null, question.rows)];
  if (question.ranking.length > 0) return [panel(null, rankingTable(`${question.label} table`, question.ranking), null)];
  return [];
}

function figures(question: SummaryQuestion): HTMLElement | null {
  if (question.mean === null || question.lowest === null || question.highest === null) return null;
  return h('div', { class: 'figures' },
    h('p', {}, M58_MEAN(question.mean)), h('p', {}, M58_LOWEST(question.lowest)), h('p', {}, M58_HIGHEST(question.highest)));
}

export function questionSection(question: SummaryQuestion, count: string): HTMLElement {
  const headingId = `summary-${question.key}`;
  return h('section', { class: 'question', 'aria-labelledby': headingId, 'data-key': question.key },
    h('h2', { id: headingId }, question.label),
    h('p', { class: 'figures' }, M57(question.answered, count)),
    figures(question),
    panels(question));
}
