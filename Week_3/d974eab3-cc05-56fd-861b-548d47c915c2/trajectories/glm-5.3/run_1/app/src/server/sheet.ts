import type { ContentRecord } from '../domain/content.js';
import { editionLine, ingredientAmount, notAMedicine, packLine } from '../domain/format.js';

export function sheetHtml(content: ContentRecord): string {
  const { product } = content;
  const packLines = product.packs.map((pack) => `<p>${escapeHtml(packLine(pack.sticks, pack.price_yen))}</p>`);
  const ingredientLines = product.ingredients
    .map((ingredient) => `<p>${escapeHtml(ingredient.name)} ${escapeHtml(ingredientAmount(ingredient.mg))}</p>`)
    .join('');
  const steps = product.how_to_use
    .map((step, index) => `<p>${index + 1}. ${escapeHtml(step)}</p>`)
    .join('');
  const cautions = product.cautions.map((caution) => `<p>${escapeHtml(caution)}</p>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #16261e; margin: 24px; font-size: 12px; line-height: 1.45; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 14px 0 4px; border-top: 1px solid #16261e; padding-top: 8px; }
  p { margin: 0 0 3px; }
  .line { color: #444; font-size: 11px; }
</style>
</head>
<body>
<h1>${escapeHtml(product.name)} product information</h1>
<p class="line">Alder Quay Laboratories</p>
<p>Format: ${escapeHtml(product.format)}</p>
<p>Serving: ${escapeHtml(product.serving)}</p>
${packLines.join('')}
<h2>Ingredients per stick</h2>
${ingredientLines}
<h2>How to use</h2>
${steps}
<p>Storage: ${escapeHtml(product.storage)}</p>
<h2>Cautions</h2>
${cautions}
<p>${escapeHtml(notAMedicine(product))}</p>
<p>${escapeHtml(editionLine(content.edition))}</p>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
