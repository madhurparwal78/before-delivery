import { CATEGORY_ORDER } from '../shared/categories.js';
import type { PaperSize, Profile, TripList } from '../shared/types.js';

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

const PAGE_SIZE: Record<PaperSize, string> = {
  A4: '210mm 297mm',
  Letter: '8.5in 11in',
};

/** The pack sheet: in-closet lines only, and nothing private. */
export function packSheetHtml(list: TripList, profile: Profile): string {
  const sections = CATEGORY_ORDER.flatMap((category) => {
    const entry = list.categories.find((candidate) => candidate.category === category);
    if (entry === undefined) return [];
    const lines = list.lines.filter((line) => line.inCloset && line.category === category);
    const rows = lines
      .map(
        (line) => `<tr>
        <td class="box">&#9744;</td>
        <td class="item">${escapeHtml(`${line.quantity} × ${line.name}`)}</td>
        <td class="note">${escapeHtml(line.carryNote)}</td>
        <td class="weight">${escapeHtml(line.weightDisplay)}</td>
      </tr>`,
      )
      .join('');
    return [
      `<section><h2>${escapeHtml(`${category} ${entry.subtotalDisplay}`)}</h2>
       <table>${rows}</table></section>`,
    ];
  }).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pack sheet</title>
<style>
  @page { size: ${PAGE_SIZE[profile.paperSize]}; margin: 16mm; }
  body { font-family: Helvetica, Arial, sans-serif; color: #15201a; font-size: 10pt; }
  h1 { font-size: 20pt; margin: 0 0 2mm; }
  h2 { font-size: 12pt; margin: 6mm 0 1mm; border-bottom: 1px solid #15201a; }
  .meta { font-size: 10pt; margin: 0 0 4mm; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1mm 0; border-bottom: 0.3pt solid #b9b4a7; vertical-align: top; }
  td.box { width: 8mm; }
  td.note { width: 34mm; }
  td.weight { width: 24mm; text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-top: 8mm; }
  .totals div { padding: 0.6mm 0; }
</style></head>
<body>
  <h1>${escapeHtml(list.name)} — Pack sheet</h1>
  <p class="meta">${escapeHtml(profile.displayName)} — ${escapeHtml(list.state)}</p>
  ${sections}
  <div class="totals">
    <div>Base ${escapeHtml(list.totals.display.base)}</div>
    <div>Worn ${escapeHtml(list.totals.display.worn)}</div>
    <div>Consumable ${escapeHtml(list.totals.display.consumable)}</div>
    <div>Skin-out ${escapeHtml(list.totals.display.skinOut)}</div>
    <div>Goal ${escapeHtml(list.totals.display.goal)}</div>
    <div>${escapeHtml(list.totals.display.delta)}</div>
  </div>
</body></html>`;
}
