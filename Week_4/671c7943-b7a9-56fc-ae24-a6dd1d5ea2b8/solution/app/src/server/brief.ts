import { BRIEF_COPY, FOOTER_COPY, MAIL_COPY, SITE_NAME } from "../shared/copy.js";
import { config } from "./config.js";
import { escapeHtml } from "./html.js";
import { fieldPairs, type StoredEnquiry } from "./mail.js";

const GOTENBERG_DEADLINE_MS = 10_000;

/**
 * One A4 page. The description keeps its line breaks, breaks overlong runs anywhere, and its type size is
 * reduced by the page itself until the whole text fits; nothing is clipped or dropped.
 */
function briefHtml(enquiry: StoredEnquiry): string {
  const lines = fieldPairs(enquiry)
    .map(([label, value]) => `<p class="line"><span class="key">${escapeHtml(label)}</span> ${escapeHtml(value)}</p>`)
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(BRIEF_COPY.title(enquiry.reference))}</title>
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 296mm; overflow: hidden; background: #ffffff; color: #1e1a15; }
body { font-family: "Liberation Sans", Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; }
.sheet { height: 296mm; padding: 20mm 20mm 16mm; display: flex; flex-direction: column; }
.brand { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 0.6pt solid #cfc6b4; padding-bottom: 4mm; }
.brand strong { font-family: "Liberation Serif", Georgia, serif; font-size: 20pt; font-weight: 400; letter-spacing: 0.01em; }
.brand span { font-size: 9pt; color: #625a4f; }
h1 { font-family: "Liberation Serif", Georgia, serif; font-weight: 400; font-size: 30pt; line-height: 1.1; margin: 10mm 0 6mm; height: 11mm; }
.line { margin: 0 0 1.6mm; overflow-wrap: anywhere; }
.key { color: #625a4f; display: inline-block; min-width: 34mm; }
h2 { font-size: 11pt; font-weight: 700; margin: 8mm 0 2mm; }
.description { flex: 1 1 auto; min-height: 0; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; border-top: 0.6pt solid #cfc6b4; padding-top: 3mm; }
.note { margin: 4mm 0 0; font-size: 8pt; color: #625a4f; }
</style></head>
<body><div class="sheet">
<div class="brand"><strong>${escapeHtml(SITE_NAME)}</strong><span>Maren Sollis, independent designer</span></div>
<h1>${escapeHtml(BRIEF_COPY.title(enquiry.reference))}</h1>
${lines}
<h2>${escapeHtml(MAIL_COPY.descriptionLabel)}</h2>
<div class="description" id="description">${escapeHtml(enquiry.description)}</div>
<p class="note">${escapeHtml(FOOTER_COPY.fiction)}</p>
</div>
<script>
(function () {
  var box = document.getElementById("description");
  var size = 11;
  box.style.fontSize = size + "pt";
  while (box.scrollHeight > box.clientHeight && size > 1) {
    size -= 0.25;
    box.style.fontSize = size + "pt";
  }
})();
</script>
</body></html>`;
}

/** Renders the stored enquiry through Gotenberg's Chromium HTML conversion; null when it cannot be reached. */
export async function renderBrief(enquiry: StoredEnquiry): Promise<Buffer | null> {
  const form = new FormData();
  form.append("files", new Blob([briefHtml(enquiry)], { type: "text/html" }), "index.html");
  form.append("preferCssPageSize", "true");
  form.append("printBackground", "true");
  try {
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(GOTENBERG_DEADLINE_MS),
    });
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** True when Gotenberg answers its health route. */
export async function gotenbergAnswers(): Promise<boolean> {
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}
