import { CATEGORY_ORDER } from '../shared/categories.js';
import type { SharedList } from '../shared/types.js';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/app.css">
</head><body class="shared-page"><main class="sheet">${body}</main></body></html>`;
}

/** The read-only partner view: only the published share fields. */
export function sharedListPage(share: SharedList): string {
  const groups = CATEGORY_ORDER.flatMap((category) => {
    const entry = share.categories.find((candidate) => candidate.category === category);
    if (entry === undefined) return [];
    const lines = share.lines
      .filter((line) => line.category === category)
      .map(
        (line) => `<tr>
          <td class="quantity">${line.quantity}</td>
          <td class="name">${escapeHtml(line.name)}</td>
          <td class="note">${escapeHtml(line.carryNote)}</td>
          <td class="weight">${escapeHtml(line.weightDisplay)}</td>
        </tr>`,
      )
      .join('');
    return [
      `<tr class="group"><th colspan="4" scope="colgroup">
         <h3>${escapeHtml(`${category} ${entry.subtotalDisplay}`)}</h3></th></tr>${lines}`,
    ];
  }).join('');

  return page(
    share.listName,
    `<h1>${escapeHtml(share.listName)}</h1>
     <p class="meta">Shared by ${escapeHtml(share.hikerName)}</p>
     <p class="meta state">${escapeHtml(share.state)}</p>
     <section role="region" aria-label="Pack totals" class="totals-strip">
       <div><span class="label">Base</span> <span class="figure">${escapeHtml(share.totals.display.base)}</span></div>
       <div><span class="label">Worn</span> <span class="figure">${escapeHtml(share.totals.display.worn)}</span></div>
       <div><span class="label">Consumable</span> <span class="figure">${escapeHtml(share.totals.display.consumable)}</span></div>
       <div><span class="label">Skin-out</span> <span class="figure">${escapeHtml(share.totals.display.skinOut)}</span></div>
       <div class="delta">${escapeHtml(share.totals.display.delta)}</div>
     </section>
     <table class="ledger"><caption>Shared pack list</caption><tbody>${groups}</tbody></table>`,
  );
}

export function sharedListUnavailablePage(): string {
  return page(
    'Shared list',
    '<h1>Shared list</h1><p class="notice">This shared list is no longer available.</p>',
  );
}
