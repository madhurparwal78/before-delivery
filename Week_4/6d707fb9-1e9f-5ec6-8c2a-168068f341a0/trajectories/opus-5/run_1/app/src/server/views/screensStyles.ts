import { query } from '../db/pool';
import {
  COUNTRY_NAMES,
  GARMENT_NAMES,
  MEASURE_NAMES,
  MODE_NAMES,
  STAGE_NAMES,
  STYLE_STATE_NAMES,
  copy,
} from '../domain/copy';
import { dec } from '../domain/decimal';
import { shownMass } from '../domain/display';
import { MATERIALS } from '../domain/factors';
import type { MeasureFigure } from '../domain/footprint';
import { LISBON, localTime, shownDate } from '../domain/time';
import { dossierStateName } from '../api/dossiers';
import type { ScenarioFigures } from '../api/results';
import {
  climateShownOf,
  dossierShape,
  measuresOf,
  newerFactorsFor,
  readLegs,
  readLines,
  readScore,
  scoreShape,
} from '../store/read';
import type { DossierRow, LabelRow, LegRow, LineRow, PassportRow, ResultRow, StyleRowRecord } from '../store/rows';
import { html, raw } from './html';
import { actionBar, arrivalMark, heading, page } from './layout';
import {
  dialog,
  factorsPopover,
  field,
  measuresComposite,
  selectField,
  strataBand,
  tableFrame,
} from './parts';
import { WEAVES, materialLineFragment, strataFragment } from './fragments';
import type { StyleListPage } from '../api/styles';

const STATE_OPTIONS = [
  { value: '', name: 'All states' },
  { value: 'draft', name: 'Draft' },
  { value: 'worked', name: 'Worked' },
  { value: 'published', name: 'Published' },
  { value: 'archived', name: 'Archived' },
];

const GARMENT_OPTIONS: { value: string; name: string }[] = Object.entries(GARMENT_NAMES).map(([value, name]) => ({ value, name: name as string }));
const COUNTRY_OPTIONS: { value: string; name: string }[] = Object.entries(COUNTRY_NAMES).map(([value, name]) => ({ value, name: name as string }));
const MODE_OPTIONS: { value: string; name: string }[] = Object.entries(MODE_NAMES).map(([value, name]) => ({ value, name: name as string }));

export function stylesScreen(options: {
  list: StyleListPage;
  labels: LabelRow[];
  seasons: string[];
  parameters: URLSearchParams;
}): string {
  const { list, labels, seasons, parameters } = options;
  const openLabels = labels.filter((label) => label.state === 'open');
  const rows = list.rows
    .map(
      (entry) => `<tr data-key="${entry.style.id}" data-style="${entry.style.id}">
        <td><a href="/styles/${entry.style.id}" data-action="open-style">${escape(entry.style.name)}</a></td>
        <td>${escape(entry.labelName)}</td>
        <td>${escape(entry.style.season)}</td>
        <td>${STYLE_STATE_NAMES[entry.style.state]}</td>
        <td>${escape(entry.suppliers.join('; '))}</td>
        <td class="figures">${escape(entry.climateShown ?? '')}</td>
        <td class="actions"><button type="button" class="button quiet row-menu-button"
          data-action="open-row-menu" data-style="${entry.style.id}" aria-haspopup="true" aria-expanded="false"
          >Actions for ${escape(entry.style.name)}</button></td>
      </tr>`,
    )
    .join('');

  const main = html`
    ${heading('Styles')}
    ${actionBar(html`<button type="button" class="button green" data-action="open-dialog" data-target="new-style">New style</button>`)}
    <div class="filters">
      ${selectField({
        id: 'filter-label',
        label: 'Label',
        name: 'label',
        value: parameters.get('label') ?? '',
        options: [{ value: '', name: 'All labels' }, ...labels.map((label) => ({ value: label.id, name: label.name }))],
      })}
      ${selectField({
        id: 'filter-season',
        label: 'Season',
        name: 'season',
        value: parameters.get('season') ?? '',
        options: [{ value: '', name: 'All seasons' }, ...seasons.map((season) => ({ value: season, name: season }))],
      })}
      ${selectField({
        id: 'filter-state',
        label: 'State',
        name: 'state',
        value: parameters.get('state') ?? '',
        options: STATE_OPTIONS,
      })}
      ${selectField({
        id: 'filter-sort',
        label: 'Sort by',
        name: 'sort',
        value: parameters.get('sort') === 'climate' ? 'climate' : 'name',
        options: [
          { value: 'name', name: 'Name' },
          { value: 'climate', name: 'Climate figure' },
        ],
      })}
      <p class="field">
        <label class="field-label" for="filter-search">Search styles</label>
        <input id="filter-search" type="search" name="q" value="${parameters.get('q') ?? ''}">
      </p>
      <p class="field end">
        <button type="button" class="button" data-action="open-dialog" data-target="bring-in-catalogue">Bring in catalogue</button>
      </p>
    </div>
    ${tableFrame(
      'Styles table',
      html`<table class="plain" data-part="styles-table">
        <thead><tr><th scope="col">Style</th><th scope="col">Label</th><th scope="col">Season</th>
          <th scope="col">State</th><th scope="col">Suppliers</th><th scope="col">Climate</th>
          <th scope="col">Actions</th></tr></thead>
        <tbody>${raw(rows)}</tbody>
      </table>`,
    )}
    ${list.nextCursor
      ? html`<button type="button" class="button" data-action="next-page"
          data-cursor="${list.nextCursor}">Next page</button>`
      : ''}
    ${list.rows.length === 0
      ? html`<div class="empty">${materialLineFragment}<p>No styles here yet. <strong>New style</strong> is the
          first step.</p></div>`
      : ''}
    <div class="row-menu" data-part="row-menu" data-dialog="row-menu" hidden>
      <ul role="menu" aria-label="Row actions" data-part="row-menu-list">
        <li role="none"><button type="button" role="menuitem" data-action="menu-open">Open</button></li>
        <li role="none"><button type="button" role="menuitem" data-action="menu-duplicate">Duplicate</button></li>
        <li role="none"><button type="button" role="menuitem" data-action="menu-archive">Archive</button></li>
      </ul>
    </div>
  `;

  const dialogs = html`
    ${dialog({
      id: 'new-style',
      name: 'New style',
      body: html`
        ${selectField({
          id: 'new-style-label',
          label: 'Label',
          name: 'labelId',
          options: openLabels.map((label) => ({ value: label.id, name: label.name })),
        })}
        ${field({ id: 'new-style-name', label: 'Name', name: 'name' })}
        ${field({ id: 'new-style-code', label: 'Style code', name: 'styleCode' })}
        ${field({ id: 'new-style-season', label: 'Season', name: 'season' })}
        ${field({ id: 'new-style-gtin', label: 'GTIN', name: 'gtin' })}
        ${selectField({
          id: 'new-style-garment',
          label: 'Garment',
          name: 'garment',
          value: 'tshirt',
          options: GARMENT_OPTIONS,
        })}
        ${field({ id: 'new-style-washes', label: 'Washes', name: 'washes' })}
        ${selectField({
          id: 'new-style-repair',
          label: 'Repair service offered',
          name: 'repairService',
          value: '',
          options: [
            { value: '', name: 'Not stated' },
            { value: 'true', name: 'Yes' },
            { value: 'false', name: 'No' },
          ],
        })}
        ${field({ id: 'new-style-range', label: 'Range size', name: 'rangeSize' })}
        ${field({ id: 'new-style-notes', label: 'Notes', name: 'notes' })}
      `,
      actions: html`
        <button type="button" class="button green" data-action="save-style">Save style</button>
        <button type="button" class="button quiet" data-action="close-dialog">Close</button>
      `,
    })}
    ${dialog({
      id: 'bring-in-catalogue',
      name: 'Bring in catalogue',
      body: html`
        ${selectField({
          id: 'catalogue-label',
          label: 'Label',
          name: 'labelId',
          options: openLabels.map((label) => ({ value: label.id, name: label.name })),
        })}
        <p class="field"><label class="field-label" for="catalogue-file">Catalogue file</label>
          <input id="catalogue-file" name="file" type="file" accept=".csv,text/csv"></p>
        <div data-part="catalogue-preview"></div>
      `,
      actions: html`
        <button type="button" class="button" data-action="preview-catalogue">Preview</button>
        <button type="button" class="button green" data-action="save-catalogue">Save catalogue</button>
        <button type="button" class="button quiet" data-action="close-dialog">Close</button>
      `,
    })}
  `;

  return page({
    heading: 'Styles',
    screen: 'styles',
    frame: 'desk',
    main,
    dialogs,
    data: { shownCount: list.shownCount },
  });
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface StyleScreenData {
  style: StyleRowRecord;
  label: LabelRow;
  result: ResultRow | null;
  shownResult: ResultRow | null;
  earlier: ResultRow[];
  dossiers: DossierRow[];
  passports: PassportRow[];
  measure: string;
  newerFactors: string | null;
  arrival: { key: string; text: string } | null;
  labelContact: string;
}

export async function styleScreen(data: StyleScreenData): Promise<string> {
  const { style, label, shownResult, earlier, dossiers, passports } = data;
  const score = scoreShape(await readScore(style.id));
  const measures = shownResult ? measuresOf(shownResult) : [];
  const chosen = measures.some((measure) => measure.measure === data.measure) ? data.measure : 'climate';
  const newestDossier = dossiers[0] ?? null;
  const newestPassport = passports[passports.length - 1] ?? null;

  const main = html`
    ${raw(WEAVES)}
    ${heading(style.name)}
    ${arrivalMark(data.arrival)}
    ${actionBar(html`<button type="button" class="button green" data-action="work-out-footprint">Work out footprint</button>`)}
    <section class="panel style-header">
      <dl class="facts">
        <dt>Label</dt><dd>${label.name}</dd>
        <dt>GTIN</dt><dd class="figures">${style.gtin}</dd>
        <dt>Garment</dt><dd>${GARMENT_NAMES[style.garment]}</dd>
        <dt>State</dt><dd>${STYLE_STATE_NAMES[style.state]}</dd>
      </dl>
      <p class="links">
        <a href="/styles/${style.id}/materials">Materials</a>
        <a href="/styles/${style.id}/scenarios">Scenarios</a>
      </p>
    </section>
    <section class="panel footprint-panel">
      <h2>Footprint</h2>
      ${data.newerFactors
        ? html`<p class="band-note" data-part="newer-factors">${copy.newerFactors(data.newerFactors)}</p>`
        : ''}
      ${shownResult
        ? html`
            <p class="panel-facts">
              <span data-part="result-edition">Factor edition ${shownResult.edition}</span>
              <span data-part="result-quality">Data quality ${shownResult.data_quality_grade} (${shownResult.data_quality_percent}%)</span>
              <span>Worked out ${shownDate(Number(shownResult.worked_out_at), LISBON)}, ${localTime(Number(shownResult.worked_out_at), LISBON)} Lisbon time</span>
            </p>
            ${measuresComposite(chosen)}
            ${strataBand(measures, chosen, null)}
            ${factorsPopover()}
          `
        : html`<div class="empty">${strataFragment}<p>No footprint yet. <strong>Work out footprint</strong> is the
            first action.</p></div>`}
      <p class="panel-actions"><button type="button" class="button" data-action="check-newer-factors">Check for newer factors</button></p>
    </section>
    <section class="panel score-panel" data-part="score-panel">
      <h2>Textile score</h2>
      <p data-part="score-line">${score.shown === null ? 'No score yet.' : (score.shown as string)}
        ${score.state === 'outdated' ? html`<span class="tag">${copy.scoreStale}</span>` : ''}</p>
      ${(score.worstCaseFacts as string[]).includes('repairService')
        ? html`<p class="band-note">${copy.worstCaseRepair}</p>`
        : ''}
      ${(score.worstCaseFacts as string[]).includes('rangeSize')
        ? html`<p class="band-note">${copy.worstCaseRange}</p>`
        : ''}
      <p class="panel-actions"><button type="button" class="button" data-action="ask-for-score">Ask for score</button></p>
    </section>
    <section class="panel dossier-panel">
      <h2>Dossier</h2>
      <p data-part="dossier-line">${newestDossier ? dossierStateName(newestDossier) : 'No dossier yet.'}</p>
      <p class="panel-actions">
        <button type="button" class="button" data-action="make-dossier">Make dossier</button>
        ${newestDossier
          ? html`<button type="button" class="button" data-action="download-dossier"
              data-dossier="${newestDossier.id}">Download dossier</button>
            <button type="button" class="button" data-action="send-sign-off"
              data-dossier="${newestDossier.id}">Send sign-off page</button>`
          : ''}
        <button type="button" class="button" data-action="download-results">Download results file</button>
      </p>
    </section>
    <section class="panel passport-panel">
      <h2>Product passport</h2>
      <p data-part="passport-line">${newestPassport
        ? `Edition ${newestPassport.edition}, ${newestPassport.state === 'published' ? 'Published' : 'Withdrawn'}`
        : 'Not published yet.'}</p>
      <p class="panel-actions">
        <button type="button" class="button" data-action="publish-passport">${newestPassport &&
        newestPassport.state === 'published'
          ? 'Publish correction'
          : 'Publish passport'}</button>
      </p>
    </section>
    <section class="panel earlier-panel">
      <h2>Earlier results</h2>
      ${earlier.length === 0
        ? html`<p>No earlier results.</p>`
        : html`<ul class="plain-list">${raw(
            earlier
              .map(
                (result) =>
                  `<li><a href="/styles/${style.id}?result=${result.id}">${escape(result.edition)} \u00b7 ${escape(
                    shownDate(Number(result.worked_out_at), LISBON),
                  )}</a></li>`,
              )
              .join(''),
          )}</ul>`}
    </section>
  `;

  const dialogs = html`
    ${dialog({
      id: 'withdraw-passport',
      name: 'Withdraw passport',
      body: html`<p>Withdrawing takes every edition of this passport off the public address.</p>`,
      actions: html`
        <button type="button" class="button green" data-action="withdraw-passport">Withdraw</button>
        <button type="button" class="button quiet" data-action="close-dialog">Keep</button>
      `,
    })}
  `;

  return page({
    heading: style.name,
    screen: 'style',
    frame: 'desk',
    main,
    dialogs,
    data: {
      styleId: style.id,
      resultId: shownResult ? shownResult.id : null,
      measures,
      measure: chosen,
      version: style.version,
      labelContact: data.labelContact,
    },
  });
}

export async function materialsScreen(style: StyleRowRecord, label: LabelRow): Promise<string> {
  const lines = await readLines(style.id);
  const legs = await readLegs(style.id);

  const main = html`
    ${heading(`Materials for ${style.name}`)}
    ${actionBar(html`<button type="button" class="button green" data-action="open-dialog" data-target="add-material">Add material</button>`)}
    <section class="panel">
      <h2>Material lines</h2>
      <ul class="lines" data-part="lines">
        ${raw(
          lines
            .map(
              (line) => `<li class="line" role="listitem" aria-label="${escape(materialOf(line))}"
                data-key="${line.id}" data-line="${line.id}" data-position="${line.position}">
                <span class="line-position">${line.position}</span>
                <span class="line-material">${escape(materialOf(line))}</span>
                <span class="line-mass figures">${escape(massOf(line))}</span>
                <span class="line-fibres">${escape(
                  line.fibres.map((fibre) => `${fibre.name} ${fibre.sharePercent}%`).join(', '),
                )}</span>
                <span class="line-tiers">${escape(tiersOf(line))}</span>
                <span class="line-controls">
                  <button type="button" class="button quiet" data-action="move-line" data-direction="up"
                    ${line.position === 1 ? 'aria-disabled="true"' : ''}>Move up</button>
                  <button type="button" class="button quiet" data-action="move-line" data-direction="down"
                    ${line.position === lines.length ? 'aria-disabled="true"' : ''}>Move down</button>
                  <button type="button" class="button quiet" data-action="edit-line">Edit</button>
                  <button type="button" class="button quiet" data-action="remove-line">Remove</button>
                </span>
              </li>`,
            )
            .join(''),
        )}
      </ul>
      ${lines.length === 0
        ? html`<div class="empty">${materialLineFragment}<p>No material lines yet. <strong>Add material</strong> is
            the first action.</p></div>`
        : ''}
    </section>
    <section class="panel">
      <h2>Transport legs</h2>
      <ul class="legs" data-part="legs">
        ${raw(
          legs
            .map(
              (leg, index) => `<li class="leg" data-key="${leg.id}" data-leg="${leg.id}" data-index="${index}">
                <span>${MODE_NAMES[leg.mode]}</span>
                <span class="figures">${escape(leg.km)} km</span>
                <button type="button" class="button quiet" data-action="remove-leg">Remove leg</button>
              </li>`,
            )
            .join(''),
        )}
      </ul>
      <p class="panel-actions"><button type="button" class="button" data-action="open-dialog"
        data-target="add-leg">Add leg</button></p>
    </section>
  `;

  const dialogs = html`
    ${dialog({
      id: 'add-material',
      name: 'Add material',
      sheet: true,
      body: html`
        <p class="field">
          <label class="field-label" for="material-search">Material</label>
          <input id="material-search" type="text" role="combobox" aria-expanded="false"
            aria-controls="material-listbox" aria-autocomplete="list" autocomplete="off">
          <ul class="listbox" id="material-listbox" role="listbox" aria-label="Materials" data-part="material-listbox"
            hidden></ul>
        </p>
        <fieldset class="field">
          <legend>How to give the mass</legend>
          <div role="radiogroup" aria-label="How to give the mass" class="radio-row">
            <label class="radio"><input type="radio" name="massKind" value="weight" checked><span>Fabric weight and
              area</span></label>
            <label class="radio"><input type="radio" name="massKind" value="plain"><span>Plain mass</span></label>
          </div>
        </fieldset>
        ${field({ id: 'line-weight', label: 'Fabric weight (g/m\u00b2)', name: 'fabricWeightGsm' })}
        ${field({ id: 'line-area', label: 'Area (m\u00b2)', name: 'areaM2' })}
        ${field({ id: 'line-mass', label: 'Mass (g)', name: 'massGrams' })}
        <div data-part="fibres">
          ${field({ id: 'fibre-1-name', label: 'Fibre 1 name', name: 'fibre1Name' })}
          ${field({ id: 'fibre-1-share', label: 'Fibre 1 share (%)', name: 'fibre1Share' })}
        </div>
        <p class="panel-actions"><button type="button" class="button quiet" data-action="add-fibre">Add fibre</button></p>
        ${field({ id: 'tier1-factory', label: 'Tier 1 factory', name: 'tier1Factory' })}
        ${field({ id: 'tier1-town', label: 'Tier 1 town', name: 'tier1Town' })}
        ${selectField({
          id: 'tier1-country',
          label: 'Tier 1 country',
          name: 'tier1Country',
          value: '',
          options: [{ value: '', name: 'Not known yet' }, ...COUNTRY_OPTIONS],
        })}
        ${field({ id: 'tier2-factory', label: 'Tier 2 factory', name: 'tier2Factory' })}
        ${field({ id: 'tier2-town', label: 'Tier 2 town', name: 'tier2Town' })}
        ${selectField({
          id: 'tier2-country',
          label: 'Tier 2 country',
          name: 'tier2Country',
          value: '',
          options: [{ value: '', name: 'Not known yet' }, ...COUNTRY_OPTIONS],
        })}
        ${field({ id: 'tier3-factory', label: 'Tier 3 factory', name: 'tier3Factory' })}
        ${field({ id: 'tier3-town', label: 'Tier 3 town', name: 'tier3Town' })}
        ${selectField({
          id: 'tier3-country',
          label: 'Tier 3 country',
          name: 'tier3Country',
          value: '',
          options: [{ value: '', name: 'Not known yet' }, ...COUNTRY_OPTIONS],
        })}
      `,
      actions: html`
        <button type="button" class="button green" data-action="save-material">Save material</button>
        <button type="button" class="button quiet" data-action="close-dialog">Close</button>
      `,
    })}
    ${dialog({
      id: 'add-leg',
      name: 'Add leg',
      body: html`
        ${selectField({ id: 'leg-mode', label: 'Mode', name: 'mode', value: 'road', options: MODE_OPTIONS })}
        ${field({ id: 'leg-km', label: 'Distance (km)', name: 'km' })}
      `,
      actions: html`
        <button type="button" class="button green" data-action="save-leg">Save leg</button>
        <button type="button" class="button quiet" data-action="close-dialog">Close</button>
      `,
    })}
  `;

  return page({
    heading: `Materials for ${style.name}`,
    screen: 'materials',
    frame: 'desk',
    main,
    dialogs,
    data: { styleId: style.id, version: style.version, lineCount: lines.length, labelState: label.state },
  });
}

function materialOf(line: LineRow): string {
  return MATERIALS.find((material) => material.id === line.material_id)?.name ?? line.material_id;
}

function massOf(line: LineRow): string {
  return shownMass(dec(line.mass_grams));
}

function tiersOf(line: LineRow): string {
  return [line.tier1, line.tier2, line.tier3]
    .map((tier) =>
      tier === null
        ? 'none'
        : [tier.factory, tier.town, tier.country === null ? 'Not known yet' : COUNTRY_NAMES[tier.country]]
            .filter((piece) => piece !== null && piece !== '')
            .join(', '),
    )
    .join(' \u00b7 ');
}

export interface ScenarioScreenData {
  style: StyleRowRecord;
  result: ResultRow | null;
  lines: LineRow[];
  legs: LegRow[];
  figures: ScenarioFigures | null;
  measure: string;
  saved: { id: string; name: string; measures: MeasureFigure[]; differences: { measure: string; shown: string }[] }[];
  changes: { recycled: Record<string, number>; material: Record<string, string>; factory: Record<string, string>; mode: Record<number, string> };
}

export function scenariosScreen(data: ScenarioScreenData): string {
  const { style, result, lines, legs, figures } = data;
  const baseline = result ? measuresOf(result) : [];
  const shownMeasures = figures ? figures.measures : baseline;
  const chosen = shownMeasures.some((measure) => measure.measure === data.measure) ? data.measure : 'climate';

  const comparison = html`<table class="plain" data-part="comparison">
    <thead><tr><th scope="col">Measure</th><th scope="col">Baseline</th><th scope="col">Scenario</th>
      <th scope="col">Difference</th></tr></thead>
    <tbody>${raw(
      shownMeasures
        .map((measure) => {
          const base = baseline.find((entry) => entry.measure === measure.measure);
          const difference = figures
            ? figures.differences.find((entry) => entry.measure === measure.measure)?.shown
            : 'no change';
          return `<tr data-key="${measure.measure}"><th scope="row">${MEASURE_NAMES[measure.measure]}</th>
            <td class="figures">${escape(base?.totalShown ?? '')}</td>
            <td class="figures">${escape(measure.totalShown)}</td>
            <td class="figures">${escape(difference ?? 'no change')}</td></tr>`;
        })
        .join(''),
    )}</tbody>
  </table>`;

  const main = html`
    ${raw(WEAVES)}
    ${heading(`Scenarios for ${style.name}`)}
    ${actionBar(html`<button type="button" class="button green" data-action="open-dialog" data-target="save-scenario">Save scenario</button>`)}
    ${result
      ? html`
          <section class="panel">
            <h2>Changes</h2>
            ${raw(
              lines
                .map((line) => {
                  const name = materialOf(line);
                  const recycled = data.changes.recycled[line.id] ?? 0;
                  const material = data.changes.material[line.id] ?? line.material_id;
                  const factory = data.changes.factory[line.id] ?? line.tier1?.country ?? 'PT';
                  return `<div class="scenario-line" data-line="${line.id}">
                    <p class="field"><label class="field-label" for="recycled-${line.id}">Recycled share for ${escape(
                      name,
                    )}</label>
                      <input id="recycled-${line.id}" type="range" min="0" max="100" step="5" value="${recycled}"
                        data-action="scenario-recycled" data-line="${line.id}"></p>
                    <p class="field"><label class="field-label" for="material-${line.id}">Material for ${escape(
                      name,
                    )}</label>
                      <select id="material-${line.id}" data-action="scenario-material" data-line="${line.id}">${MATERIALS.map(
                        (entry) =>
                          `<option value="${entry.id}"${entry.id === material ? ' selected' : ''}>${escape(
                            entry.name,
                          )}</option>`,
                      ).join('')}</select></p>
                    <p class="field"><label class="field-label" for="factory-${line.id}">Factory country for ${escape(
                      name,
                    )}</label>
                      <select id="factory-${line.id}" data-action="scenario-factory" data-line="${line.id}">${COUNTRY_OPTIONS.map(
                        (entry) =>
                          `<option value="${entry.value}"${entry.value === factory ? ' selected' : ''}>${escape(
                            entry.name,
                          )}</option>`,
                      ).join('')}</select></p>
                  </div>`;
                })
                .join(''),
            )}
            ${raw(
              legs
                .map((leg, index) => {
                  const mode = data.changes.mode[index] ?? leg.mode;
                  return `<p class="field"><label class="field-label" for="mode-${index}">Mode for leg ${index + 1}</label>
                    <select id="mode-${index}" data-action="scenario-mode" data-index="${index}">${MODE_OPTIONS.map(
                      (entry) =>
                        `<option value="${entry.value}"${entry.value === mode ? ' selected' : ''}>${escape(
                          entry.name,
                        )}</option>`,
                    ).join('')}</select></p>`;
                })
                .join(''),
            )}
          </section>
          <section class="panel">
            <h2>${MEASURE_NAMES[chosen as keyof typeof MEASURE_NAMES]}</h2>
            ${measuresComposite(chosen)}
            ${strataBand(shownMeasures, chosen, baseline)}
          </section>
          <section class="panel">
            <h2>Comparison</h2>
            ${tableFrame('Comparison', comparison)}
          </section>
          <section class="panel">
            <h2>Saved scenarios</h2>
            ${data.saved.length === 0
              ? html`<p>No saved scenarios.</p>`
              : html`<ul class="plain-list">${raw(
                  data.saved.map((scenario) => `<li>${escape(scenario.name)}</li>`).join(''),
                )}</ul>`}
          </section>
        `
      : html`<div class="empty">${strataFragment}<p>Work out a footprint first, then scenarios can answer against
          it.</p></div>`}
  `;

  const dialogs = dialog({
    id: 'save-scenario',
    name: 'Save scenario',
    body: field({ id: 'scenario-name', label: 'Name', name: 'name' }),
    actions: html`
      <button type="button" class="button green" data-action="save-scenario">Save</button>
      <button type="button" class="button quiet" data-action="close-dialog">Close</button>
    `,
  });

  return page({
    heading: `Scenarios for ${style.name}`,
    screen: 'scenarios',
    frame: 'desk',
    main,
    dialogs,
    data: {
      styleId: style.id,
      resultId: result ? result.id : null,
      measures: shownMeasures,
      baseline,
      measure: chosen,
    },
  });
}

export async function seasonsOf(deskId: string): Promise<string[]> {
  const rows = await query<{ season: string }>(
    `select distinct s.season from styles s join labels l on l.id = s.label_id
     where s.assessor_id = $1 and l.state <> 'erased' order by s.season`,
    [deskId],
  );
  return rows.map((row) => row.season);
}

export { climateShownOf, dossierShape, newerFactorsFor, STAGE_NAMES };
