import { parseBody, type BodyInline } from '../../domain/bodytext.js';
import { formatCalendarDate } from '../../domain/london.js';
import { html, type Html } from '../html.js';
import type { ModelRouteData } from '../api/publicdata.js';
import { icon } from './icons.js';

export function sectionsNav(
  sections: readonly { id: string; heading: string }[],
): Html {
  return html`
    <nav aria-label="Sections" class="section-rail">
      <details class="section-disclosure" open>
        <summary>Sections</summary>
        <ol>
          ${sections.map(
            (section) => html`<li><a href="#${section.id}">${section.heading}</a></li>`,
          )}
        </ol>
      </details>
    </nav>
  `;
}

function claimMarker(number: number, claimId: string): Html {
  return html`<button type="button" class="claim-marker" data-claim="${claimId}"
    data-claim-number="${number}" aria-pressed="false" aria-label="Claim ${number}"
    ><span class="mono">${number}</span></button>`;
}

type Evidence = { readonly value: string; readonly rowId: string };

/** Links each number in a claim's text to the recorded row it came from. */
function claimEvidence(text: string, evidence: readonly Evidence[]): Html {
  const marks: { start: number; end: number; rowId: string }[] = [];
  for (const entry of evidence) {
    if (entry.value === '') continue;
    for (let from = 0; from <= text.length; ) {
      const index = text.indexOf(entry.value, from);
      if (index === -1) break;
      const end = index + entry.value.length;
      const adjacent = /[\d.]/.test(text.charAt(index - 1)) || /[\d.]/.test(text.charAt(end));
      const overlaps = marks.some((mark) => index < mark.end && end > mark.start);
      if (!adjacent && !overlaps) {
        marks.push({ start: index, end, rowId: entry.rowId });
        break;
      }
      from = index + 1;
    }
  }
  marks.sort((left, right) => left.start - right.start);
  const pieces: Html[] = [];
  let cursor = 0;
  for (const mark of marks) {
    pieces.push(html`${text.slice(cursor, mark.start)}`);
    pieces.push(
      html`<a class="evidence mono" href="#row-${mark.rowId}"
        >${text.slice(mark.start, mark.end)}</a>`,
    );
    cursor = mark.end;
  }
  pieces.push(html`${text.slice(cursor)}`);
  return html`${pieces}`;
}

type ClaimView = {
  readonly id: string;
  readonly number: number;
  readonly text: string;
  readonly evidence: readonly Evidence[];
};

function inlineParts(parts: readonly BodyInline[], claims: ReadonlyMap<string, ClaimView>): Html {
  return html`${parts.map((part) => {
    if (part.kind === 'text') return html`${part.value}`;
    const claim = claims.get(part.id);
    if (claim === undefined) return html``;
    return html`<span class="claim">${claimEvidence(claim.text, claim.evidence)}${claimMarker(
      claim.number,
      part.id,
    )}</span>`;
  })}`;
}

export function renderProse(
  body: string,
  claims: readonly ClaimView[],
): Html {
  const parsed = parseBody(body);
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  return html`
    ${parsed.lead.map((paragraph) => html`<p>${inlineParts(paragraph, byId)}</p>`)}
    ${parsed.sections.map(
      (section) => html`
        <section id="${section.id}" data-reveal="pending" class="prose-section">
          <h2>${section.heading}</h2>
          ${section.paragraphs.map((paragraph) => html`<p>${inlineParts(paragraph, byId)}</p>`)}
        </section>
      `,
    )}
  `;
}

type ChartGroup = {
  readonly benchmark: string;
  readonly evalDate: string;
  readonly rows: ModelRouteData['rows'];
};

function chartGroups(rows: ModelRouteData['rows']): ChartGroup[] {
  const groups: ChartGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.benchmark === row.benchmark && last.evalDate === row.eval_date) {
      (last.rows as ModelRouteData['rows'][number][]).push(row);
      continue;
    }
    groups.push({ benchmark: row.benchmark, evalDate: row.eval_date, rows: [row] });
  }
  return groups;
}

export function benchmarkChart(
  rows: ModelRouteData['rows'],
  dynamicCss: string[],
): Html {
  const groups = chartGroups(rows);
  for (const [index, row] of rows.entries()) {
    dynamicCss.push(
      `.bar-row[data-row-id="${row.id}"] .bar{--bar-length:${Number.parseFloat(
        row.score,
      )}%;--bar-index:${index}}`,
    );
  }
  return html`
    <figure class="chart" aria-label="Benchmark results" data-chart data-entered="false">
      <figcaption>Benchmark results</figcaption>
      <div class="chart-plot">
        ${groups.map(
          (group) => html`
            <div class="chart-group" data-benchmark="${group.benchmark}"
              data-eval-date="${group.evalDate}">
              <h3 class="chart-group-heading">
                ${group.benchmark}
                <span class="chart-group-date mono">${formatCalendarDate(group.evalDate)}</span>
              </h3>
              ${group.rows.map(
                (row) => html`
                  <div class="bar-row" data-row-id="${row.id}" data-cited="true"
                    data-subject="${row.subject}">
                    <span class="bar-name">${row.subject_name}</span>
                    <span class="bar-track"><span class="bar"></span></span>
                    <a class="bar-score mono" href="#row-${row.id}">${row.score}</a>
                  </div>
                `,
              )}
            </div>
          `,
        )}
        <span class="tether-line" data-tether-line="" aria-hidden="true"
          ><span class="tether-bracket-label mono"></span></span>
        <span class="tether-delta mono" data-tether-delta aria-hidden="true"></span>
      </div>
      <p class="status-line" role="status" aria-live="polite" aria-label="Claim tether"
        data-tether-status></p>
    </figure>
  `;
}

export function evaluationTable(rows: ModelRouteData['rows']): Html {
  return html`
    <table class="record-table" aria-label="Recorded evaluation rows">
      <caption>Recorded evaluation rows</caption>
      <thead>
        <tr>
          <th scope="col">Model</th>
          <th scope="col">Organisation</th>
          <th scope="col">Benchmark</th>
          <th scope="col">Evaluation date</th>
          <th scope="col">Score</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (row) => html`
            <tr id="row-${row.id}">
              <td data-label="Model">${row.subject_name}</td>
              <td data-label="Organisation">${row.organisation}</td>
              <td data-label="Benchmark">${row.benchmark}</td>
              <td data-label="Evaluation date" class="mono">${formatCalendarDate(row.eval_date)}</td>
              <td data-label="Score" class="mono">${row.score}</td>
            </tr>
          `,
        )}
      </tbody>
    </table>
  `;
}

export function sampleGallery(route: ModelRouteData): Html {
  if (route.samples_available === false) {
    return html`
      <section class="samples" aria-label="Samples">
        <h2>Samples</h2>
        <p class="notice">Samples are unavailable right now. The recorded benchmarks above are
        unaffected.</p>
      </section>
    `;
  }
  if (route.samples.length === 0) {
    return html`
      <section class="samples" aria-label="Samples">
        <h2>Samples</h2>
        <p class="notice">No samples recorded for this model.</p>
      </section>
    `;
  }
  return html`
    <section class="samples" aria-label="Samples">
      <h2>Samples</h2>
      <ul class="sample-list">
        ${route.samples.map((sample) =>
          sample.kind === 'audio'
            ? html`
                <li class="sample" data-gallery-item>
                  <h3>${sample.title}</h3>
                  <audio data-sample-audio preload="none" src="${sample.urls[0] ?? ''}"></audio>
                  <div class="sample-controls">
                    <button type="button" data-sample-play>${icon('play')}Play ${sample.title}</button>
                    <button type="button" data-sample-pause>${icon('pause')}Pause ${sample.title}</button>
                  </div>
                </li>
              `
            : html`
                <li class="sample" data-gallery-item data-sequence>
                  <h3>${sample.title}</h3>
                  <div class="frame-view" tabindex="0" data-frame-view
                    data-frames="${sample.urls.length}">
                    ${sample.urls.map(
                      (url, index) => html`<img src="${url}" alt="${sample.title}, frame ${index + 1}"
                        loading="lazy" data-frame="${index + 1}" ${index === 0 ? '' : 'hidden'}>`,
                    )}
                  </div>
                  <div class="sample-controls">
                    <button type="button" data-frame-previous>${icon('chevron-left')}Previous frame</button>
                    <button type="button" data-frame-next>${icon('chevron-right')}Next frame</button>
                  </div>
                  <p class="status-line mono" role="status" aria-label="Frame position"
                    data-frame-status>Frame 1 of ${sample.urls.length}</p>
                </li>
              `,
        )}
      </ul>
    </section>
  `;
}
