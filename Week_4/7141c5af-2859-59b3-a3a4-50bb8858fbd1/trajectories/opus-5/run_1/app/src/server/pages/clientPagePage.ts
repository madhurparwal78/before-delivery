/**
 * `/c/<token>`, decided by the server before any script runs: every string from
 * the published copy table in the client's language, with the matching `lang`
 * and `dir`.
 */
import { c, cFill, PIN_KIND_COPY, TOWN_NAMES } from '../../shared/clientCopy.ts';
import { formatDate } from '../../shared/dates.ts';
import { directionOf, type Language } from '../../shared/language.ts';
import { escapeHtml, noteToHtml } from '../domain/markup.ts';
import { isoWeekday, localTime, parseDate, TOWN_ZONE } from '../domain/time.ts';
import { renderDocument } from './shell.ts';
import type { ClientPageFacts } from '../features/clientPageData.ts';

function steps(language: Language): string {
  const ids = ['C03', 'C04', 'C05', 'C06'] as const;
  return `<nav class="steps" aria-label="${escapeHtml(c('C02', language))}"><ol>${ids
    .map((id) => `<li>${escapeHtml(c(id, language))}</li>`)
    .join('')}</ol></nav>`;
}

/** The whole page, in the client's language with nothing left in English. */
export function renderClientPage(view: ClientPageFacts): string {
  const lang = view.language;
  const dir = directionOf(lang);
  const townName = TOWN_NAMES[view.town]?.[lang] ?? view.town;

  const due = view.dueDate ? parseDate(view.dueDate) : null;
  const dueLine = due
    ? `<p class="due">${escapeHtml(
        cFill('C19', lang, { date: formatDate({ ...due, weekday: isoWeekday(due) }, lang) }),
      )}</p>`
    : '';

  const beforeAfter = `<section class="tile" id="before-after">
  <h2>${escapeHtml(c('C03', lang))}</h2>
  ${
    view.hasBefore || view.hasAfter
      ? `<div class="compare" data-part="compare">
           <figure class="compare-before"><img src="/api/client-pages/${escapeHtml(view.token)}/photographs/before" alt="${escapeHtml(
             c('C30', lang),
           )}" width="480" height="360"><figcaption>${escapeHtml(c('C27', lang))}</figcaption></figure>
           <figure class="compare-after"><img src="/api/client-pages/${escapeHtml(view.token)}/photographs/after" alt="${escapeHtml(
             c('C31', lang),
           )}" width="480" height="360"><figcaption>${escapeHtml(c('C28', lang))}</figcaption></figure>
         </div>
         <p class="field"><label for="compare-slider">${escapeHtml(c('C03', lang))}</label>
           <input id="compare-slider" type="range" min="0" max="100" value="50" role="slider"
             aria-label="${escapeHtml(c('C03', lang))}" aria-valuetext="${escapeHtml(
               cFill('C29', lang, { n: '50' }),
             )}"></p>`
      : `<p>${escapeHtml(c('C50', lang))}</p>`
  }
</section>`;

  const cover = `<section class="tile" id="cover">
  <h2>${escapeHtml(c('C04', lang))}</h2>
  ${
    view.material
      ? `<div class="cover-drawing" aria-label="${escapeHtml(c('C32', lang))}" role="img"></div>
         <dl><dt>${escapeHtml(c('C34', lang))}</dt><dd>${escapeHtml(
           `${view.material.name} ${view.material.code}`,
         )}</dd>
         <dt>${escapeHtml(c('C33', lang))}</dt><dd>${escapeHtml(view.material.lot ?? '')}</dd></dl>`
      : `<p>${escapeHtml(c('C40', lang))}</p>`
  }
</section>`;

  const notes = `<section class="tile" id="condition-notes">
  <h2>${escapeHtml(c('C42', lang))}</h2>
  ${
    view.notes.length > 0
      ? `<ul class="notes">${view.notes
          .map(
            (note) =>
              `<li><span class="kind">${escapeHtml(
                c(PIN_KIND_COPY[note.kind] ?? 'C43', lang),
              )}</span> <span class="note">${noteToHtml(note.note)}</span></li>`,
          )
          .join('')}</ul>`
      : `<p>${escapeHtml(c('C51', lang))}</p>`
  }
</section>`;

  const estimate = `<section class="tile" id="estimate">
  <h2>${escapeHtml(c('C05', lang))}</h2>
  ${
    view.amounts
      ? `<dl class="amounts">
           <dt>${escapeHtml(c('C34', lang))}</dt><dd>${escapeHtml(view.amounts.material)}</dd>
           <dt>${escapeHtml(c('C35', lang))}</dt><dd>${escapeHtml(view.amounts.labour)}</dd>
           <dt>${escapeHtml(c('C36', lang))}</dt><dd>${escapeHtml(view.amounts.subtotal)}</dd>
           <dt>${escapeHtml(c('C37', lang))}</dt><dd>${escapeHtml(view.amounts.tax)}</dd>
           <dt>${escapeHtml(c('C38', lang))}</dt><dd>${escapeHtml(view.amounts.total)}</dd>
         </dl>
         <ol class="milestones">${view.amounts.milestones
           .map(
             (amount, i) =>
               `<li>${escapeHtml(cFill('C39', lang, { n: String(i + 1) }))}: ${escapeHtml(amount)}</li>`,
           )
           .join('')}</ol>`
      : `<p>${escapeHtml(c('C41', lang))}</p>`
  }
</section>`;

  const signedLine =
    view.signOff === null
      ? ''
      : `<p class="signed">${escapeHtml(
          cFill('C16', lang, {
            time: localTime(TOWN_ZONE[view.town], view.signOff.atMs),
            town: townName,
          }),
        )}</p>`;

  const answerLine = view.answer
    ? `<p class="answered">${escapeHtml(c('C15', lang))} ${escapeHtml(view.answer.seatHeightCm)}</p>`
    : '';

  const main = `<section class="bento client-page" data-token="${escapeHtml(view.token)}"
     data-estimate="${escapeHtml(view.estimateId ?? '')}" data-town="${escapeHtml(view.town)}"
     data-language="${lang}">
  <h1 class="tile tile-headline" id="page-heading" tabindex="-1">${escapeHtml(c('C01', lang))}</h1>
  <p class="tile tile-facts"><span class="piece-title">${escapeHtml(view.pieceTitle)}</span>
    <span class="client-name">${escapeHtml(view.clientName)}</span>
    <span class="town">${escapeHtml(townName)}</span></p>
  ${steps(lang)}
  ${dueLine}
  <div role="region" aria-label="${escapeHtml(c('C26', lang))}" id="problems" hidden>
    <h2>${escapeHtml(c('C26', lang))}</h2><ul></ul></div>
  ${beforeAfter}
  ${cover}
  ${notes}
  ${estimate}
  ${answerLine}
  ${signedLine}
  <div class="bottom-bar" role="toolbar" aria-label="${escapeHtml(c('C48', lang))}">
    <button type="button" class="button-primary" id="your-answer">${escapeHtml(c('C06', lang))}</button>
  </div>
</section>`;

  return renderDocument({
    title: c('C01', lang),
    lang,
    dir,
    header: '',
    main,
    screen: 'client-page',
    bodyClass: 'client-page-body',
    regions: { announcements: c('C24', lang), refreshState: c('C25', lang) },
  });
}

/** The ended page, which prints its own copy with the right `lang` and `dir`. */
export function renderEndedClientPage(language: Language): string {
  const main = `<section class="bento client-page">
  <h1 class="tile tile-headline" id="page-heading" tabindex="-1">${escapeHtml(c('C01', language))}</h1>
  <p class="tile">${escapeHtml(c('C20', language))}</p>
</section>`;
  return renderDocument({
    title: c('C01', language),
    lang: language,
    dir: directionOf(language),
    header: '',
    main,
    screen: 'client-page-ended',
    bodyClass: 'client-page-body',
    regions: { announcements: c('C24', language), refreshState: c('C25', language) },
  });
}
