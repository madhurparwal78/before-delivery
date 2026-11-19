import { Router, type Request, type Response } from "express";
import { q, q1 } from "../db.js";
import { loadSession } from "../session.js";
import { tokenPage, parseSeatHeight } from "../api/client-page.js";
import { clientCopy, townNames, type ClientLang } from "../client-copy.js";
import { esc, pageLayout } from "./html.js";
import { err } from "../http.js";
import { renderNoteHtml } from "../markup.js";
import { printMinor } from "../decimal.js";
import { fmtDateByLang, localTimeHM, townZone, isoZ, endOfDayTurin } from "../time.js";
import { asyncHandler } from "../http.js";
import { swatchGrain, chairDrawing } from "../drawings.js";

export const clientPageRouter = Router();

const kindLabel: Record<string, (c: ClientCopy) => string> = {
  tear: (c) => c.C43, crack: (c) => c.C44, stain: (c) => c.C45, looseJoint: (c) => c.C46, woodworm: (c) => c.C47,
};
type ClientCopy = (typeof clientCopy)[ClientLang];

const renderEnded = (res: Response, lang: string): void => {
  const copy = clientCopy[(lang as ClientLang) ?? "en"];
  const dir = (lang as ClientLang) === "ar" ? "rtl" : "ltr";
  res.status(410).send(
    pageLayout({
      title: copy.C20,
      lang,
      dir,
      body: `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(copy.C20)}</title>
<link rel="stylesheet" href="/assets/fonts.css"><link rel="stylesheet" href="/assets/app.css"></head>
<body data-desk="false" data-client-page="true">
<main id="main"><h1>${esc(copy.C20)}</h1></main>
<script src="/assets/app.js" defer></script>
</body></html>`,
    })
  );
};

const renderNotFound = (res: Response): void => {
  res.status(404).send(pageLayout({ title: "Page not found", body: `<main id="main"><h1>Page not found</h1><p>The address you asked for does not exist.</p></main>` }));
};

clientPageRouter.get("/c/:token", asyncHandler(async (req: Request, res: Response) => {
  const row = await tokenPage(req.params.token!);
  if (!row) {
    renderNotFound(res);
    return;
  }
  if (row.state === "ended" || row.ends_at.getTime() <= Date.now()) {
    renderEnded(res, row.language);
    return;
  }
  const lang = row.language as ClientLang;
  const copy = clientCopy[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";
  const town = townNames[lang][row.town] ?? row.town;

  const estimate = await q1<{ id: string; currency: string; material_code: string | null; lot: string | null; material_minor: number; labour_minor: number; subtotal_minor: number; tax_minor: number; total_minor: number; milestones: { percent: number; amountMinor: number }[] }>(
    "SELECT id, currency, material_code, lot, material_minor, labour_minor, subtotal_minor, tax_minor, total_minor, milestones FROM estimates WHERE piece_id=$1 AND state IN ('open','signedOff') ORDER BY version DESC LIMIT 1", [row.piece_id]
  );
  const material = estimate?.material_code
    ? await q1<{ code: string; name: string; unit: string }>("SELECT code, name, unit FROM materials WHERE desk_id=$1 AND code=$2", [row.desk_id, estimate.material_code])
    : null;
  const notes = await q<{ kind: string; note: string }>("SELECT kind, note FROM pins WHERE piece_id=$1 AND signed=true ORDER BY y, x", [row.piece_id]);
  const currency = (estimate?.currency ?? "EUR") as "EUR" | "GBP" | "USD" | "JPY" | "AED";
  const dueText = row.due_date ? fmtDateByLang[lang]!(new Date(`${String(row.due_date).slice(0, 10)}T12:00:00Z`), townZone[row.town as "Turin"]) : "";
  const signOffAt = (row.sign_off as { at: string } | null)?.at;
  const townLabel = townNames[lang][row.town] ?? row.town;
  const answered = row.answer as { seatHeightCm: string; typed: string; answeredAt: string } | null;

  const body = `
<main id="main" class="client-main" data-token="${esc(row.token)}">
  <h1>${esc(copy.C01)}</h1>
  <nav class="steps" aria-label="${esc(copy.C02)}">
    <span class="step">${esc(copy.C03)}</span><span class="step">${esc(copy.C04)}</span><span class="step">${esc(copy.C42)}</span><span class="step">${esc(copy.C05)}</span>
  </nav>
  <p class="due">${esc(copy.C19.replace("<date>", dueText))}</p>
  <section class="tile">
    <h2 id="slider-heading">${esc(copy.C03)}</h2>
    <div class="ba-compare" id="ba-compare">
      <img src="/api/client-pages/${esc(row.token)}/photographs/before" alt="${esc(copy.C30)}" id="ba-before">
      <img src="/api/client-pages/${esc(row.token)}/photographs/after" alt="${esc(copy.C31)}" id="ba-after" class="ba-after">
    </div>
    <div class="ba-controls">
      <span>${esc(copy.C27)}</span>
      <input type="range" min="0" max="100" value="50" id="ba-slider" aria-label="${esc(copy.C03)}" aria-valuetext="50% ${lang === "en" ? "before" : ""}">
      <span>${esc(copy.C28)}</span>
    </div>
  </section>
  <section class="tile">
    <h2>${esc(copy.C04)}</h2>
    <div class="material-drawing" id="material-drawing">${material ? swatchGrain(material.code, 120, 90) : chairDrawing("lounge", 120, 100)}</div>
    <p>${esc(copy.C34)}: ${material ? `${esc(material.name)} ${esc(material.code)}` : esc(copy.C40)}</p>
    <p>${esc(copy.C33)}: ${esc(estimate?.lot ?? "")}</p>
  </section>
  <section class="tile">
    <h2>${esc(copy.C42)}</h2>
    ${notes.length ? `<ul class="condition-notes">${notes.map((n) => `<li><strong>${esc(kindLabel[n.kind]?.(copy) ?? n.kind)}</strong> — ${renderNoteHtml(n.note)}</li>`).join("")}</ul>` : `<p>${esc(copy.C51)}</p>`}
  </section>
  <section class="tile">
    <h2>${esc(copy.C05)}</h2>
    ${estimate ? `
    <dl class="estimate-lines">
      <div><dt>${esc(copy.C34)}</dt><dd>${esc(printMinor(estimate.material_minor, currency))}</dd></div>
      <div><dt>${esc(copy.C35)}</dt><dd>${esc(printMinor(estimate.labour_minor, currency))}</dd></div>
      <div><dt>${esc(copy.C36)}</dt><dd>${esc(printMinor(estimate.subtotal_minor, currency))}</dd></div>
      <div><dt>${esc(copy.C37)}</dt><dd>${esc(printMinor(estimate.tax_minor, currency))}</dd></div>
      <div><dt>${esc(copy.C38)}</dt><dd><strong>${esc(printMinor(estimate.total_minor, currency))}</strong></dd></div>
    </dl>
    <ol class="milestones">
      ${(estimate.milestones ?? []).map((m, i) => `<li>${esc(copy.C39.replace("<n>", String(i + 1)))} — ${esc(printMinor(m.amountMinor, currency))}</li>`).join("")}
    </ol>` : `<p>${esc(copy.C41)}</p>`}
  </section>
  <div class="answer-summary" id="answer-summary">
    ${answered ? `<p>${esc(copy.C15)}</p>` : ""}
    ${signOffAt ? `<p>${esc(copy.C16.replace("<time>", localTimeHM(new Date(signOffAt), townZone[row.town as "Turin"])).replace("<town>", townLabel))}</p>` : ""}
  </div>
  <p class="page-ends" data-ends-at="${esc(isoZ(row.ends_at))}"></p>
</main>
<div class="bottom-bar" data-bar="main-action">
  <button id="your-answer" class="primary" data-opens="answer-sheet">${esc(copy.C06)}</button>
</div>
<div id="answer-sheet" class="sheet" hidden data-sheet="true">
  <div class="sheet-panel">
    <h2>${esc(copy.C06)}</h2>
    <form id="answer-form" data-endpoint="/api/client-pages/${esc(row.token)}/answer">
      <p id="answer-question">${esc(copy.C07)}</p>
      <label>${esc(copy.C08)}<input type="text" inputmode="decimal" name="seatHeight" autocomplete="off" data-local-rule="${lang}"></label>
      <button type="submit" class="primary">${esc(copy.C09)}</button>
    </form>
    <form id="signoff-form" data-endpoint="/api/client-pages/${esc(row.token)}/sign-off">
      <p id="signoff-question">${esc(copy.C11)}</p>
      <label>${esc(copy.C10)}<input type="text" name="typedName" autocomplete="name"></label>
      <input type="hidden" name="estimateId" value="${esc(estimate?.id ?? "")}">
      <button type="submit" class="primary">${esc(copy.C11)}</button>
    </form>
    <button id="answer-close">${esc(copy.C12)}</button>
  </div>
</div>`;
  res.send(
    pageLayout({
      title: copy.C01,
      lang,
      dir,
      body: `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(copy.C01)}</title>
<link rel="stylesheet" href="/assets/fonts.css"><link rel="stylesheet" href="/assets/app.css"></head>
<body data-desk="false" data-client-page="true" data-lang="${lang}" data-dir="${dir}" data-token="${esc(row.token)}" data-town="${esc(town)}">
${body}
<script src="/assets/app.js" defer></script>
</body></html>`,
    })
  );
}));

void q;
void loadSession;
void endOfDayTurin;
void parseSeatHeight;
void err;
