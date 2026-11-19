import { MEASURE_NAMES, STAGE_NAMES } from '../domain/copy';
import { MEASURES, STAGES } from '../domain/factors';
import type { MeasureFigure } from '../domain/footprint';
import { type Raw, html, raw } from './html';

export function field(options: {
  id: string;
  label: string;
  name: string;
  kind?: string;
  value?: string | null;
  autocomplete?: string;
  hint?: string;
}): Raw {
  return html`<p class="field">
    <label class="field-label" for="${options.id}">${options.label}</label>
    <input id="${options.id}" name="${options.name}" type="${options.kind ?? 'text'}"
      value="${options.value ?? ''}"${raw(options.autocomplete ? ` autocomplete="${options.autocomplete}"` : '')}>
    ${options.hint ? html`<span class="field-hint">${options.hint}</span>` : ''}
  </p>`;
}

export function selectField(options: {
  id: string;
  label: string;
  name: string;
  options: { value: string; name: string }[];
  value?: string | null;
}): Raw {
  return html`<p class="field">
    <label class="field-label" for="${options.id}">${options.label}</label>
    <select id="${options.id}" name="${options.name}">
      ${raw(
        options.options
          .map(
            (entry) =>
              `<option value="${entry.value}"${entry.value === (options.value ?? '') ? ' selected' : ''}>${escape(entry.name)}</option>`,
          )
          .join(''),
      )}
    </select>
  </p>`;
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function dialog(options: {
  id: string;
  name: string;
  body: Raw;
  actions: Raw;
  sheet?: boolean;
}): Raw {
  return html`<div class="dialog${options.sheet ? ' sheet' : ''}" id="${options.id}" data-part="dialog"
    data-key="${options.id}" data-dialog="${options.id}" role="dialog" aria-modal="true"
    aria-label="${options.name}" hidden>
    <div class="dialog-card">
      <h2 class="dialog-title">${options.name}</h2>
      <div class="problems" role="region" aria-label="Problems" data-part="problems" hidden></div>
      <div class="dialog-body">${options.body}</div>
      <div class="dialog-actions">${options.actions}</div>
    </div>
  </div>`;
}

/** One horizontal band of five strata in stage order, each with its printed name. */
export function strataBand(measures: MeasureFigure[], chosen: string, ghost: MeasureFigure[] | null): Raw {
  const measure = measures.find((entry) => entry.measure === chosen) ?? (measures[0] as MeasureFigure);
  const ghostMeasure = ghost ? (ghost.find((entry) => entry.measure === chosen) ?? null) : null;
  const marker = STAGES.indexOf(measure.hotspot);
  return html`
    <div class="band-wrap">
      ${ghostMeasure
        ? html`<div class="band ghost" data-part="ghost-band" aria-hidden="true">
            ${raw(
              ghostMeasure.stages
                .map(
                  (stage) =>
                    `<div class="stratum" data-part="ghost-stratum" data-stage="${stage.stage}" data-share="${stage.share}" style="--share:${stage.share}%"></div>`,
                )
                .join(''),
            )}
          </div>`
        : ''}
      <div class="band" data-part="strata" data-measure="${measure.measure}">
        ${raw(
          measure.stages
            .map(
              (stage) =>
                `<div class="stratum weave-${stage.stage}" data-part="stratum" data-stage="${stage.stage}"
                  data-share="${stage.share}" style="--share:${stage.share}%" tabindex="-1"
                  data-action="open-factors">
                  <span class="stratum-name">${STAGE_NAMES[stage.stage]}</span>
                  <span class="roll" data-part="stratum-figure" data-stage="${stage.stage}" data-roll="1"><span
                    class="roll-value">${stage.shown}</span></span>
                  <span class="stratum-share">${stage.share}%</span>
                </div>`,
            )
            .join(''),
        )}
        <div class="hotspot-marker" data-part="hotspot-marker" data-stage="${measure.hotspot}"
          style="--at:${marker}" aria-hidden="true"></div>
      </div>
      <p class="band-total">Total <span class="roll" data-part="total-figure" data-roll="1"><span
        class="roll-value">${measure.totalShown}</span></span></p>
    </div>
  `;
}

/** The measures are one keyboard composite with a single Tab stop. */
export function measuresComposite(chosen: string): Raw {
  return html`<div class="measures" role="radiogroup" aria-label="Measure" data-part="measures">
    ${raw(
      MEASURES.map(
        (measure, index) =>
          `<span class="measure" role="radio" aria-checked="${measure === chosen ? 'true' : 'false'}"
            data-measure="${measure}" tabindex="${measure === chosen ? '0' : '-1'}"
            data-index="${index}">${MEASURE_NAMES[measure]}</span>`,
      ).join(''),
    )}
  </div>`;
}

export function factorsPopover(): Raw {
  return html`<div class="popover" id="factors-popover" data-part="popover" data-key="factors-popover"
    data-dialog="factors-popover" role="dialog" aria-modal="true" aria-label="Factors" hidden>
    <div class="popover-card">
      <h2 class="popover-title" data-part="popover-title">Factors</h2>
      <p class="popover-edition" data-part="popover-edition"></p>
      <ul class="popover-rows" data-part="popover-rows"></ul>
      <div class="dialog-actions">
        <button type="button" class="button" data-action="next-stage">Next stage</button>
        <button type="button" class="button quiet" data-action="close-dialog">Close</button>
      </div>
    </div>
  </div>`;
}

export function tableFrame(name: string, body: Raw): Raw {
  return html`<div class="table-frame" role="region" aria-label="${name}" tabindex="0">${body}</div>`;
}
