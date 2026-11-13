import { ParentRole } from '../domain/plan';
import { daysInMonth, isoWeekday, toDateString } from '../domain/time';
import { formatDisplayDate, formatMoney } from '../lib/format';

export interface YearRecordDay {
  date: string;
  owner: ParentRole | null;
}

export interface YearRecordSwapLine {
  firstNight: string;
  lastNight: string;
  toParentName: string;
  makeup: { firstNight: string; lastNight: string; giverName: string } | null;
}

export interface YearRecordCostLine {
  custodyDay: string;
  description: string;
  amountMinor: number;
  payerName: string;
  planningShare: number;
  otherShare: number;
}

export interface YearRecordContent {
  year: number;
  householdName: string;
  planningName: string;
  otherName: string;
  digest: string;
  nights: { planning: number; other: number };
  days: YearRecordDay[];
  swaps: YearRecordSwapLine[];
  costs: YearRecordCostLine[];
  currency: string;
  currencyExponent: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthTable(content: YearRecordContent, month: number): string {
  const owners = new Map(content.days.map((day) => [day.date, day.owner]));
  const total = daysInMonth(content.year, month);
  const firstWeekday = isoWeekday(toDateString(content.year, month, 1));
  const cells: string[] = [];
  for (let blank = 1; blank < firstWeekday; blank += 1) cells.push('<td class="blank"></td>');
  for (let day = 1; day <= total; day += 1) {
    const date = toDateString(content.year, month, day);
    const owner = owners.get(date) ?? null;
    const name = owner === 'planning' ? content.planningName : owner === 'other' ? content.otherName : '';
    const className = owner === null ? 'none' : owner;
    cells.push(`<td class="${className}"><span class="num">${day}</span><span class="who">${escapeHtml(name)}</span></td>`);
  }
  while (cells.length % 7 !== 0) cells.push('<td class="blank"></td>');
  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 7) {
    rows.push(`<tr>${cells.slice(index, index + 7).join('')}</tr>`);
  }
  return `<section class="month"><h3>${monthNames[month - 1] as string} ${content.year}</h3>
<table><thead><tr><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Sun</th></tr></thead>
<tbody>${rows.join('')}</tbody></table></section>`;
}

/** The published lines for the pinned year, its swaps and its cost ledger. */
export function yearRecordHtml(content: YearRecordContent): string {
  const money = (minor: number): string => formatMoney(minor, content.currency, content.currencyExponent);
  const lines: string[] = [
    `Twohouse year record ${content.year}`,
    content.householdName,
    `Year digest ${content.digest}`,
    `Nights: ${content.planningName} ${content.nights.planning}, ${content.otherName} ${content.nights.other}`,
  ];
  for (const swap of content.swaps) {
    lines.push(
      `Swap ${formatDisplayDate(swap.firstNight)} to ${formatDisplayDate(swap.lastNight)} with ${swap.toParentName}`,
    );
    if (swap.makeup) {
      lines.push(
        `Make-up ${formatDisplayDate(swap.makeup.firstNight)} to ${formatDisplayDate(swap.makeup.lastNight)} with ${swap.makeup.giverName}`,
      );
    }
  }
  for (const cost of content.costs) {
    lines.push(
      `${formatDisplayDate(cost.custodyDay)} ${cost.description} ${money(cost.amountMinor)} paid by ${cost.payerName}: ` +
        `${content.planningName} ${money(cost.planningShare)}, ${content.otherName} ${money(cost.otherShare)}`,
    );
  }
  const months = Array.from({ length: 12 }, (_unused, index) => monthTable(content, index + 1)).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Twohouse year record ${content.year}</title>
<style>
  body { font-family: sans-serif; color: #15110f; margin: 24px; }
  .line { font-size: 12px; margin: 2px 0; }
  .months { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
  .month { width: 30%; }
  .month h3 { font-size: 12px; margin: 4px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 8px; }
  th, td { border: 1px solid #d8d4d1; height: 26px; vertical-align: top; }
  td.planning { background: #c9ecd8; }
  td.other { background: #f8d4e2; }
  td.none { background: #ffffff; }
  td.blank { background: #f3f1ef; }
  .num { display: block; font-weight: bold; }
  .who { display: block; font-size: 6px; }
</style></head>
<body>
${lines.map((line) => `<p class="line">${escapeHtml(line)}</p>`).join('\n')}
<div class="months">${months}</div>
</body></html>`;
}
