import { moneyLabel } from '../../domain/money.js';
import { formatUkDate } from '../../domain/time.js';
import { escapeHtml } from './layout.js';
import { emptyState } from './desk.js';

export function frameTable(options: { name: string; head: string[]; rows: string[]; empty: string }): string {
  if (options.rows.length === 0) return emptyState(options.empty);
  return `<div class="frame" role="region" aria-label="${escapeHtml(options.name)}" tabindex="0">
  <table class="desk-table">
    <thead><tr>${options.head.map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`).join('')}</tr></thead>
    <tbody>${options.rows.join('')}</tbody>
  </table>
</div>`;
}

export function money(pennies: number): string {
  return escapeHtml(moneyLabel(pennies));
}

export function ukDate(date: string): string {
  return escapeHtml(formatUkDate(date));
}

export function marker(line: string): string {
  return `<span class="marker"><span class="marker-square" aria-hidden="true"></span>${escapeHtml(line)}</span>`;
}

export function note(line: string): string {
  return `<p class="note">${escapeHtml(line)}</p>`;
}
