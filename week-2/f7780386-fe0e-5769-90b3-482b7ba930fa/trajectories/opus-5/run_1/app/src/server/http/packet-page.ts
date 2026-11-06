import type { PacketSnapshot } from '../../shared/api.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const PACKET_STYLES = `
:root {
  --ground: #f4f5f3;
  --ink: #16181a;
  --steel: #6a7177;
  --hairline: #c9ced1;
  --space: 8px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: calc(var(--space) * 3);
  background: var(--ground);
  color: var(--ink);
  font-family: 'Public Sans', system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.45;
}
h1, h2 { font-family: 'Big Shoulders Display', 'Public Sans', sans-serif; margin: 0 0 var(--space); }
h1 { font-size: 2.1rem; letter-spacing: 0.01em; }
h2 { font-size: 1.35rem; margin-top: calc(var(--space) * 3); }
.kitchen { font-family: 'Big Shoulders Display', sans-serif; font-size: 1.5rem; }
.meta { color: var(--steel); margin-bottom: calc(var(--space) * 2); }
table { border-collapse: collapse; width: 100%; max-width: 1100px; background: #fff; }
caption { text-align: left; font-weight: 600; padding-bottom: var(--space); }
th, td {
  border: 1px solid var(--hairline);
  padding: var(--space) calc(var(--space) * 1.5);
  text-align: left;
  vertical-align: top;
}
th { background: #e9ebe8; font-weight: 600; }
td.num, td.time { font-variant-numeric: tabular-nums; }
a { color: var(--ink); }
.notice { font-size: 1.1rem; }
@media (max-width: 640px) {
  table, thead, tbody, tr, th, td { display: block; }
  thead { display: none; }
  tr { border: 1px solid var(--hairline); margin-bottom: var(--space); background: #fff; }
  td { border: none; border-bottom: 1px solid var(--hairline); }
  td::before { content: attr(data-label) ': '; color: var(--steel); font-weight: 600; }
}
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/fonts/fonts.css">
<style>${PACKET_STYLES}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function renderPacketNotValidPage(): string {
  return page(
    'Compliance packet',
    `<h1>Compliance packet</h1><p class="notice">This packet link is not valid.</p>`,
  );
}

const validity = (valid: boolean): string => (valid ? 'Valid' : 'Not valid');

export function renderPacketPage(snapshot: PacketSnapshot, token: string): string {
  const rows: string[] = [];
  for (const day of snapshot.days) {
    for (const visit of day.visits) {
      const crew =
        visit.crew.length === 0
          ? '—'
          : visit.crew
              .map(
                (cook) =>
                  `${escapeHtml(cook.name)} — ${validity(cook.food_handler_card.valid)}` +
                  (cook.food_handler_card.expires_on === null
                    ? ''
                    : ` (expires ${escapeHtml(cook.food_handler_card.expires_on)})`),
              )
              .join('<br>');
      rows.push(
        `<tr>
  <td data-label="Date" class="num">${escapeHtml(day.date)}</td>
  <td data-label="Business">${escapeHtml(visit.business_name)}</td>
  <td data-label="Station">${escapeHtml(visit.station)}</td>
  <td data-label="Time" class="time">${escapeHtml(visit.start)}–${escapeHtml(visit.end)}</td>
  <td data-label="Insurance">${validity(visit.liability_insurance.valid)}${
    visit.liability_insurance.expires_on === null
      ? ''
      : ` (expires ${escapeHtml(visit.liability_insurance.expires_on)})`
  }</td>
  <td data-label="Crew and card">${crew}</td>
</tr>`,
      );
    }
  }

  const body = `
<p class="kitchen">${escapeHtml(snapshot.kitchen)}</p>
<h1>Compliance packet</h1>
<p class="meta">Dates <span class="num">${escapeHtml(snapshot.from)}</span> to
  <span class="num">${escapeHtml(snapshot.to)}</span> · kitchen time
  (${escapeHtml(snapshot.time_zone)})</p>
<p><a href="/api/packet/${encodeURIComponent(token)}/pdf">Download PDF</a></p>
<table>
  <caption>Kitchen visits</caption>
  <thead>
    <tr><th>Date</th><th>Business</th><th>Station</th><th>Time</th><th>Insurance</th>
      <th>Crew and card</th></tr>
  </thead>
  <tbody>
${rows.length === 0 ? '<tr><td colspan="6">No kitchen visits in this date range.</td></tr>' : rows.join('\n')}
  </tbody>
</table>
`;
  return page('Compliance packet', body);
}
