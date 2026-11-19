import { budgetName, projectTypeName } from "../domain/model.js";
import { escapeHtml } from "./html.js";
import type { EnquiryRecord } from "./database.js";

function fieldRows(enquiry: EnquiryRecord): string {
  return [
    ["Reference:", enquiry.reference],
    ["Name:", enquiry.name],
    ["Email:", enquiry.email],
    ["Project type:", projectTypeName(enquiry.project_type)],
    ["Budget range:", budgetName(enquiry.budget)],
  ]
    .map(([label, value]) => `<tr class="field"><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join("");
}

export function briefHtml(enquiry: EnquiryRecord): string {
  const escaped = escapeHtml(enquiry.description);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Project brief ${escapeHtml(enquiry.reference)}</title>
<style>
@page { size: A4; margin: 18mm 20mm; }
body { font-family: sans-serif; font-size: 12pt; color: #1a1613; margin: 0; }
h1 { font-size: 13pt; margin: 0 0 2mm; letter-spacing: 0.06em; text-transform: uppercase; }
h2 { font-size: 11pt; margin: 8mm 0 2mm; letter-spacing: 0.04em; text-transform: uppercase; }
.studio { font-size: 10pt; color: #555555; margin: 0 0 6mm; letter-spacing: 0.06em; text-transform: uppercase; }
table.fields { width: 100%; border-collapse: collapse; }
table.fields td { padding: 1.4mm 0; font-size: 10.5pt; vertical-align: top; }
table.fields td.label { width: 32mm; color: #555555; }
p.description { font-size: 10.5pt; line-height: 1.45; margin: 2mm 0 0; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
</style>
</head>
<body>
<h1>Project brief ${escapeHtml(enquiry.reference)}</h1>
<p class="studio">Sollis Studio</p>
<table class="fields">${fieldRows(enquiry)}</table>
<h2>Project description</h2>
<p class="description">${escaped}</p>
</body>
</html>`;
}
