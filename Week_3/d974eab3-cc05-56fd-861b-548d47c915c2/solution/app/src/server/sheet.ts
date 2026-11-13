import type { Product } from "../shared/content.js";
import { CAUTIONS_HEADING, HOW_TO_USE_HEADING, INGREDIENTS_HEADING, detailLines, editionLine, ingredientLine, notice, storageLine } from "../shared/format.js";
import { escapeHtml } from "../shared/html.js";
import { COMPANY } from "../shared/titles.js";

function lines(entries: string[], className = ""): string {
  return entries.map((entry) => `<p${className ? ` class="${className}"` : ""}>${escapeHtml(entry)}</p>`).join("\n");
}

/** The product sheet, printed from the stored product record on every request. */
export function sheetHtml(product: Product, edition: number): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(product.name)} product information</title>
<style>
@page { size: A4; margin: 20mm 22mm; }
body { font-family: "Liberation Sans", "Noto Sans", Arial, sans-serif; color: #10201a; font-size: 11pt; line-height: 1.5; }
h1 { font-family: "Liberation Serif", "Noto Serif", Georgia, serif; font-weight: 500; font-size: 26pt; margin: 0 0 4pt; }
h2 { font-family: "Liberation Serif", "Noto Serif", Georgia, serif; font-weight: 500; font-size: 14pt; margin: 18pt 0 6pt; padding-top: 8pt; border-top: 0.75pt solid #c8c0aa; }
p { margin: 0 0 4pt; }
.maker { letter-spacing: 0.08em; font-size: 9pt; color: #4b5a51; margin-bottom: 14pt; }
.notice { margin-top: 18pt; padding: 8pt 10pt; border-left: 3pt solid #7b1530; background: #f6f2e8; }
.edition { margin-top: 12pt; font-size: 9pt; color: #4b5a51; }
</style></head><body>
<h1>${escapeHtml(product.name)} product information</h1>
<p class="maker">${escapeHtml(COMPANY)}</p>
${lines(detailLines(product))}
<h2>${INGREDIENTS_HEADING}</h2>
${lines(product.ingredients.map(ingredientLine))}
<h2>${HOW_TO_USE_HEADING}</h2>
${lines(product.how_to_use.map((step, index) => `${index + 1}. ${step}`))}
${lines([storageLine(product)])}
<h2>${CAUTIONS_HEADING}</h2>
${lines(product.cautions)}
${lines([notice(product)], "notice")}
${lines([editionLine(edition)], "edition")}
</body></html>`;
}
