import {
  MEASURE_NAMES,
  STAGE_NAMES,
  answerCopy,
  answerCountryNames,
  answerDueLine,
  answerIntro,
  passportCopy,
  passportCorrected,
  passportDataQuality,
  passportEdition,
  passportFactorEdition,
  passportGarmentNames,
  passportScore,
} from '../domain/copy';
import { COUNTRIES } from '../domain/factors';
import type { MeasureFigure } from '../domain/footprint';
import type { Language } from '../domain/numbers';
import { LISBON, shownDate } from '../domain/time';
import type { PublicPassport } from '../api/passports';
import type { AnswerPage } from '../api/requests';
import type { SignOffPage } from '../api/dossiers';
import { measuresOf } from '../store/read';
import { html, raw } from './html';
import { actionBar, heading, page } from './layout';

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STEP_KEYS = {
  energy: 'stepEnergy',
  water: 'stepWater',
  fibreOrigin: 'stepFibreOrigin',
} as const;

export function answerPageHtml(answerPage: AnswerPage, townName: string): string {
  const { request, label, style } = answerPage;
  const language = request.language;
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const steps = [...request.questions.map((question) => STEP_KEYS[question]), 'stepEvidence', 'stepSend'] as const;

  const rail = steps
    .map(
      (key, index) =>
        `<button type="button" class="step" data-step="${index}" data-key="${key}"
          ${index === 0 ? 'aria-current="step" tabindex="0"' : 'tabindex="-1"'}>${escape(
          answerCopy[key][language],
        )}</button>`,
    )
    .join('');

  const panels = steps
    .map((key, index) => {
      const hidden = index === 0 ? '' : ' hidden';
      if (key === 'stepEnergy') {
        return `<div class="step-panel" data-panel="${index}"${hidden}>
          <p class="field"><label class="field-label" for="energy-value">${escape(
            answerCopy.energyField[language],
          )}</label>
            <input id="energy-value" name="energyValue" type="text" inputmode="decimal" dir="ltr"></p>
          <p class="panel-actions"><button type="button" class="button" data-action="open-unit-sheet">${escape(
            answerCopy.unit[language],
          )}</button>
            <span data-part="unit-shown">${escape(answerCopy.unitKwh[language])}</span></p>
        </div>`;
      }
      if (key === 'stepWater') {
        return `<div class="step-panel" data-panel="${index}"${hidden}>
          <p class="field"><label class="field-label" for="water-value">${escape(
            answerCopy.waterField[language],
          )}</label>
            <input id="water-value" name="waterValue" type="text" inputmode="decimal" dir="ltr"></p>
        </div>`;
      }
      if (key === 'stepFibreOrigin') {
        return `<div class="step-panel" data-panel="${index}"${hidden}>
          <p class="field"><label class="field-label" for="fibre-origin">${escape(
            answerCopy.originField[language],
          )}</label>
            <select id="fibre-origin" name="fibreOrigin">${COUNTRIES.map(
              (country) =>
                `<option value="${country}">${escape(answerCountryNames[language][country])}</option>`,
            ).join('')}</select></p>
        </div>`;
      }
      if (key === 'stepEvidence') {
        return `<div class="step-panel" data-panel="${index}"${hidden}>
          <p class="field"><label class="field-label" for="evidence-file">${escape(
            answerCopy.evidenceField[language],
          )}</label>
            <input id="evidence-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png"></p>
          <ul class="plain-list" data-part="evidence-list"></ul>
        </div>`;
      }
      return `<div class="step-panel" data-panel="${index}"${hidden}>
        <p data-part="send-summary"></p>
      </div>`;
    })
    .join('');

  const main = html`
    ${heading(answerCopy.heading[language], answerCopy.problems[language])}
    <p class="lead">${answerIntro[language](label.name, style.name)}</p>
    <p class="due-line">${answerDueLine[language](request.due_date, townName)}</p>
    <div class="steps" role="group" aria-label="${answerCopy.stepsGroup[language]}" data-part="steps">
      ${raw(rail)}
    </div>
    <div class="step-panels" data-part="step-panels">${raw(panels)}</div>
    <p class="sent-line" data-part="sent-line" hidden>${answerCopy.sent[language]}</p>
    ${actionBar(html`
      <button type="button" class="button" data-action="step-back">${answerCopy.back[language]}</button>
      <button type="button" class="button green" data-action="step-next">${answerCopy.next[language]}</button>
      <button type="button" class="button green" data-action="send-answers" hidden>${
        answerCopy.sendAnswers[language]
      }</button>
    `)}
  `;

  const dialogs = html`<div class="dialog sheet unit-sheet" id="unit-sheet" data-part="dialog"
    data-dialog="unit-sheet" role="dialog" aria-modal="true" aria-label="${answerCopy.unit[language]}" hidden>
    <div class="dialog-card">
      <h2 class="dialog-title">${answerCopy.unit[language]}</h2>
      <div class="radio-column" role="radiogroup" aria-label="${answerCopy.unit[language]}">
        <label class="radio"><input type="radio" name="unit" value="kWh" checked><span>${
          answerCopy.unitKwh[language]
        }</span></label>
        <label class="radio"><input type="radio" name="unit" value="MJ"><span>${
          answerCopy.unitMj[language]
        }</span></label>
        <label class="radio"><input type="radio" name="unit" value="m3"><span>${
          answerCopy.unitGas[language]
        }</span></label>
      </div>
      <div class="dialog-actions">
        <button type="button" class="button quiet" data-action="close-dialog">${answerCopy.close[language]}</button>
      </div>
    </div>
  </div>`;

  return page({
    heading: answerCopy.heading[language],
    screen: 'answer',
    frame: 'bare',
    lang: language,
    dir,
    main,
    dialogs,
    refreshLineCopy: answerCopy.refreshFailed[language],
    data: { language, token: null, questions: request.questions, state: request.state },
  });
}

export function endedPageHtml(language: Language): string {
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  return page({
    heading: answerCopy.ended[language],
    screen: 'ended',
    frame: 'bare',
    lang: language,
    dir,
    main: heading(answerCopy.ended[language], null),
    refreshLineCopy: answerCopy.refreshFailed[language],
  });
}

export function signOffPageHtml(signOff: SignOffPage): string {
  const { dossier, style, result } = signOff;
  const measures = measuresOf(result);
  const rows = measures
    .map(
      (measure) =>
        `<tr><th scope="row">${escape(MEASURE_NAMES[measure.measure])}</th><td class="figures">${escape(
          measure.totalShown,
        )}</td>${measure.stages
          .map((stage) => `<td class="figures">${escape(stage.shown)}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const heads = (measures[0] as MeasureFigure | undefined)
    ? (measures[0] as MeasureFigure).stages
        .map((stage) => `<th scope="col">${escape(STAGE_NAMES[stage.stage])}</th>`)
        .join('')
    : '';

  const main = html`
    ${heading(`Sign off ${style.name}`)}
    <p class="lead">Factor edition ${dossier.edition} \u00b7 Data quality ${result.data_quality_grade}
      (${result.data_quality_percent}%)</p>
    <table class="plain">
      <thead><tr><th scope="col">Measure</th><th scope="col">Total</th>${raw(heads)}</tr></thead>
      <tbody>${raw(rows)}</tbody>
    </table>
    <p><a href="/s/${dossier.token}/file" data-action="read-dossier">Read the dossier</a></p>
    <p class="field"><label class="field-label" for="sign-name">Your name</label>
      <input id="sign-name" name="name" type="text" autocomplete="name"></p>
    ${dossier.state === 'signedOff'
      ? html`<p data-part="signed-line">Signed off by ${dossier.signed_off_by ?? ''} on ${shownDate(
          Number(dossier.signed_off_at ?? dossier.made_at),
          LISBON,
        )}</p>`
      : ''}
    ${actionBar(html`<button type="button" class="button green" data-action="sign-off">Sign off</button>`)}
  `;

  return page({
    heading: `Sign off ${style.name}`,
    screen: 'sign-off',
    frame: 'bare',
    main,
    data: { signedOff: dossier.state === 'signedOff' },
  });
}

export function signOffEndedHtml(): string {
  return page({
    heading: answerCopy.ended.en,
    screen: 'ended',
    frame: 'bare',
    main: heading(answerCopy.ended.en, null),
  });
}

const PASSPORT_MEASURE_KEYS = {
  climate: 'climate',
  water: 'water',
  fossilEnergy: 'fossilEnergy',
  landUse: 'landUse',
  freshwaterToxicity: 'freshwaterToxicity',
  microfibres: 'microfibres',
} as const;

export function passportPageHtml(passport: PublicPassport, pathBase: string): string {
  const language = passport.lang;
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const measures = passport.measures
    .map(
      (measure) =>
        `<div class="passport-measure"><dt>${escape(
          passportCopy[PASSPORT_MEASURE_KEYS[measure.measure as keyof typeof PASSPORT_MEASURE_KEYS]][language],
        )}</dt><dd class="figures">${escape(measure.totalShown)}</dd></div>`,
    )
    .join('');

  const languages = [
    { id: 'en', name: 'English' },
    { id: 'fr', name: 'Fran\u00e7ais' },
    { id: 'tr', name: 'T\u00fcrk\u00e7e' },
    { id: 'ar', name: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' },
  ];

  const main = html`
    ${heading(passport.styleName, null)}
    <nav class="passport-languages" aria-label="Language">
      ${raw(
        languages
          .map((entry) => `<a href="${pathBase}?lang=${entry.id}" hreflang="${entry.id}">${entry.name}</a>`)
          .join(''),
      )}
    </nav>
    <dl class="passport-facts">
      <div><dt>${passportCopy.label[language]}</dt><dd>${passport.labelName}</dd></div>
      <div><dt>${passportCopy.garment[language]}</dt><dd>${
        passportGarmentNames[language][passport.garment as keyof typeof passportGarmentNames.en]
      }</dd></div>
    </dl>
    <h2>${passportCopy.footprint[language]}</h2>
    <dl class="passport-measures">${raw(measures)}</dl>
    <p>${passport.scoreShown}</p>
    <p>${passportFactorEdition[language](passport.factorEdition)}</p>
    <p>${passportDataQuality[language](passport.dataQualityGrade, passport.dataQualityPercent)}</p>
    <p>${passportEdition[language](passport.edition)}${passport.correctedOn
      ? html` \u00b7 ${passportCorrected[language](passport.correctedOn)}`
      : ''}</p>
    <p class="claim-note">${passportCopy.claimNote[language]}</p>
  `;

  return page({
    heading: passport.styleName,
    screen: 'passport',
    frame: 'bare',
    lang: language,
    dir,
    main,
  });
}

export function passportWithdrawnHtml(language: Language): string {
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  return page({
    heading: passportCopy.withdrawn[language],
    screen: 'passport-withdrawn',
    frame: 'bare',
    lang: language,
    dir,
    main: html`${heading(passportCopy.withdrawn[language], null)}
      <p class="claim-note">${passportCopy.claimNote[language]}</p>`,
  });
}

export { passportScore };
