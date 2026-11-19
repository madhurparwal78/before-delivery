import { shownFigure } from '../domain/display';
import { copy } from '../domain/copy';
import { estimateClimate } from '../domain/footprint';
import { LABEL_STRIP } from '../db/seedData';
import { type Raw, html, raw } from './html';
import { actionBar, heading, page } from './layout';
import {
  WEAVES,
  factoryFragment,
  legFragment,
  materialLineFragment,
  meterFragment,
  pinnedBand,
  rowMenuFragment,
} from './fragments';

export const QUESTIONS: { slug: string; question: string; answer: string }[] = [
  {
    slug: 'who-is-it-for',
    question: 'Who is the desk for?',
    answer:
      'One independent life-cycle assessor working alone for a handful of fashion labels, from gathering supplier facts to publishing a passport a shopper can read.',
  },
  {
    slug: 'legal-claim',
    question: 'Does the desk make a legal claim?',
    answer:
      'No. The desk stores, converts units, works out published sums and shows what the providers answered. It gives no compliance advice.',
  },
  {
    slug: 'factors',
    question: 'Where do the factors come from?',
    answer:
      'From a third-party factor library, read edition by edition. Every result keeps the rows it was worked out from, so an old figure stays readable exactly as it was.',
  },
  {
    slug: 'supplier-accounts',
    question: 'Do suppliers need an account?',
    answer:
      'No. Each supplier contact gets a private answer page in their own language, types the numbers the way they write them at home, and sends once.',
  },
  {
    slug: 'poor-signal',
    question: 'What happens with poor signal?',
    answer:
      'Meter readings wait on the phone with a live count, then go in the order they were taken as soon as the network returns. Nothing is retyped.',
  },
  {
    slug: 'shopper',
    question: 'What does a shopper see?',
    answer:
      'A public product passport in English, French, Turkish or Arabic: the label, the garment, the six measures, the score, the factor edition and the data quality.',
  },
];

const GARMENTS = [
  { id: 'tshirt', name: 'T-shirt' },
  { id: 'shirt', name: 'Shirt' },
  { id: 'jeans', name: 'Jeans' },
  { id: 'coat', name: 'Coat' },
];

const FIBRES = [
  { id: 'organic-cotton', name: 'Organic cotton' },
  { id: 'cotton', name: 'Cotton' },
  { id: 'polyester', name: 'Polyester' },
  { id: 'wool', name: 'Wool' },
];

const COUNTRIES = [
  { id: 'PT', name: 'Portugal' },
  { id: 'TR', name: 'Turkey' },
  { id: 'VN', name: 'Vietnam' },
  { id: 'EG', name: 'Egypt' },
];

export interface EstimateChoice {
  garment: string;
  fibre: string;
  country: string;
}

export function readEstimateChoice(parameters: URLSearchParams): EstimateChoice {
  const garment = parameters.get('garment');
  const fibre = parameters.get('fibre');
  const country = parameters.get('country');
  return {
    garment: GARMENTS.some((entry) => entry.id === garment) ? (garment as string) : 'tshirt',
    fibre: FIBRES.some((entry) => entry.id === fibre) ? (fibre as string) : 'organic-cotton',
    country: COUNTRIES.some((entry) => entry.id === country) ? (country as string) : 'PT',
  };
}

function tryOneGarment(choice: EstimateChoice): Raw {
  const shown = `${shownFigure(estimateClimate(choice.garment, choice.fibre, choice.country))} kg CO\u2082e`;
  return html`
    <section class="try-panel" id="try-one-garment" role="region" aria-label="Try one garment" data-ui="try-panel">
      <h2 class="try-title">Try one garment</h2>
      <fieldset class="try-field">
        <legend>Garment</legend>
        <div class="radio-row" role="radiogroup" aria-label="Garment">
          ${raw(
            GARMENTS.map(
              (garment) => `<label class="radio"><input type="radio" name="garment" value="${garment.id}"
                data-action="estimate-choice"${garment.id === choice.garment ? ' checked' : ''}><span>${garment.name}</span></label>`,
            ).join(''),
          )}
        </div>
      </fieldset>
      <p class="try-field">
        <label class="field-label" for="try-fibre">Main fibre</label>
        <select id="try-fibre" name="fibre" data-action="estimate-choice">
          ${raw(
            FIBRES.map(
              (fibre) =>
                `<option value="${fibre.id}"${fibre.id === choice.fibre ? ' selected' : ''}>${fibre.name}</option>`,
            ).join(''),
          )}
        </select>
      </p>
      <p class="try-field">
        <label class="field-label" for="try-country">Making country</label>
        <select id="try-country" name="country" data-action="estimate-choice">
          ${raw(
            COUNTRIES.map(
              (country) =>
                `<option value="${country.id}"${country.id === choice.country ? ' selected' : ''}>${country.name}</option>`,
            ).join(''),
          )}
        </select>
      </p>
      <p class="try-figure">
        <span class="figure-label">Climate</span>
        <span class="roll" data-part="estimate-figure" data-roll="1"><span class="roll-value">${shown}</span></span>
      </p>
      <div class="try-weave" aria-hidden="true"></div>
    </section>
  `;
}

function statement(text: string, second: string, art: Raw): Raw {
  return html`<section class="statement">
    <p class="statement-text"><span>${text}</span><span>${second}</span></p>
    ${art}
  </section>`;
}

export function homePage(choice: EstimateChoice): string {
  const main = html`
    ${raw(WEAVES)}
    <div class="intro" data-part="intro" hidden>
      <div class="intro-inner">
        <p class="intro-name" data-part="intro-name">Fio Contado Desk</p>
        <p class="intro-stages">
          <span data-part="intro-stage">Materials</span>
          <span data-part="intro-stage">Making</span>
          <span data-part="intro-stage">Transport</span>
        </p>
        <button type="button" class="intro-skip" data-action="skip-intro">Skip intro</button>
      </div>
    </div>
    <section class="hero">
      <div class="hero-words">
        ${heading("Count every thread of a garment's footprint.")}
        <p class="hero-sentence">One desk for an independent assessor: supplier facts in, exact figures out, and a
          passport a shopper can read.</p>
        ${actionBar(html`<a class="button green" href="/method">See the method</a>`)}
      </div>
      <div class="hero-stage">${tryOneGarment(choice)}</div>
    </section>
    <div class="statements">
      ${statement('Supplier facts arrive in four languages.', 'A comma and a dot stop meaning opposite things.', materialLineFragment)}
      ${statement('Meter readings wait on the phone.', 'They go in the order taken when the network returns.', meterFragment)}
      ${statement('Every tier is named.', 'Spinner, weaver and fibre co-operative, town by town.', factoryFragment)}
      ${statement('A leg is tonne-kilometres, not a guess.', 'Sea, road, rail or air, each with its own row.', legFragment)}
    </div>
    <section class="pinned" data-part="pinned-strata">
      <div class="pinned-art">${pinnedBand()}</div>
      <div class="pinned-words">
        <p class="statement-text" data-part="pinned-statement" data-measure="climate"><span>Climate sits in the
          fibre.</span><span>Materials carry nearly half of a cotton tee.</span></p>
        <p class="statement-text" data-part="pinned-statement" data-measure="water"><span>Water sits in the
          wash.</span><span>Thirty washes outweigh the dye house.</span></p>
        <p class="statement-text" data-part="pinned-statement" data-measure="fossilEnergy"><span>Fossil energy sits in
          use.</span><span>By a hair, and only the sum can tell you.</span></p>
      </div>
    </section>
    <section class="strip" role="region" aria-label="Labels on the desk" data-part="label-strip" tabindex="0">
      <div class="strip-track" data-part="strip-track">
        ${raw(
          [...LABEL_STRIP, ...LABEL_STRIP]
            .map((name) => `<span class="strip-name">${name}</span>`)
            .join(''),
        )}
      </div>
    </section>
  `;
  return page({
    heading: "Count every thread of a garment's footprint.",
    screen: 'home',
    frame: 'public',
    main,
    data: { estimate: choice },
  });
}

const STAGES = [
  {
    name: 'Materials',
    body: 'Each material line carries an exact mass in grams and a row from the factor library for every measure. Mass times row, line by line.',
  },
  {
    name: 'Making',
    body: 'Energy per kilogram of finished goods times the grid row of the tier 1 country. A supplier\u2019s own reading replaces the library figure.',
  },
  {
    name: 'Transport',
    body: 'Tonne-kilometres: total mass over a thousand, times the distance of each leg, times that mode\u2019s row.',
  },
  {
    name: 'Use',
    body: 'Washes times the wash row. Thirty washes unless the style says otherwise.',
  },
  {
    name: 'End of life',
    body: 'Total mass times the disposal row, because the garment leaves the wardrobe too.',
  },
];

const MEASURES = [
  ['Climate', 'kg CO\u2082e'],
  ['Water', 'L'],
  ['Fossil energy', 'MJ'],
  ['Land use', 'points'],
  ['Freshwater toxicity', 'CTUe'],
  ['Microfibres', 'mg'],
];

export function methodPage(): string {
  const main = html`
    ${heading('How a footprint is worked out')}
    <p class="lead">Five stages, six measures, one exact sum. Every figure on this desk is a worked result with its
      unit and its factor edition.</p>
    <div class="stages" id="stages">
      ${raw(
        STAGES.map(
          (stage) => `<section class="stage-card"><h2>${stage.name}</h2><p>${stage.body}</p></section>`,
        ).join(''),
      )}
    </div>
    <section class="measures-section" id="measures">
      <h2>Six measures</h2>
      <ul class="measure-list">
        ${raw(MEASURES.map(([name, unit]) => `<li><span>${name}</span><span>${unit}</span></li>`).join(''))}
      </ul>
      <p>Every figure is an exact decimal shown to three significant figures, half up, with comma grouping. Trailing
        zeros stay. A value under 0.001 shows in powers of ten.</p>
    </section>
  `;
  return page({ heading: 'How a footprint is worked out', screen: 'method', frame: 'public', main });
}

export function questionsPage(open: string | null): string {
  const main = html`
    ${heading('Questions')}
    <div class="accordions">
      ${raw(
        QUESTIONS.map((entry) => {
          const isOpen = entry.slug === open;
          return `<section class="accordion" data-slug="${entry.slug}">
            <h2 class="accordion-head"><button type="button" class="accordion-button" data-action="toggle-question"
              aria-expanded="${isOpen ? 'true' : 'false'}" aria-controls="panel-${entry.slug}">${entry.question}</button></h2>
            <div class="accordion-panel" id="panel-${entry.slug}" data-part="accordion-panel"${isOpen ? '' : ' hidden'}>
              <p>${entry.answer}</p>
            </div>
          </section>`;
        }).join(''),
      )}
    </div>
  `;
  return page({ heading: 'Questions', screen: 'questions', frame: 'public', main, data: { openQuestion: open } });
}

export function signInPage(next: string | null): string {
  const main = html`
    ${heading('Sign in')}
    <form class="one-column" data-part="sign-in-form" novalidate>
      <p class="field"><label class="field-label" for="sign-in-email">Email</label>
        <input id="sign-in-email" name="email" type="email" autocomplete="username"></p>
      <p class="field"><label class="field-label" for="sign-in-password">Password</label>
        <input id="sign-in-password" name="password" type="password" autocomplete="current-password"></p>
      ${actionBar(html`<button type="submit" class="button green" data-action="sign-in">Sign in</button>`)}
    </form>
    <p class="aside">No desk yet? <a href="/sign-up">Start a desk</a>.</p>
  `;
  return page({ heading: 'Sign in', screen: 'sign-in', frame: 'public', main, data: { next } });
}

export function signUpPage(): string {
  const main = html`
    ${heading('Start a desk')}
    <form class="one-column" data-part="sign-up-form" novalidate>
      <p class="field"><label class="field-label" for="sign-up-name">Name</label>
        <input id="sign-up-name" name="name" type="text" autocomplete="name"></p>
      <p class="field"><label class="field-label" for="sign-up-email">Email</label>
        <input id="sign-up-email" name="email" type="email" autocomplete="username"></p>
      <p class="field"><label class="field-label" for="sign-up-password">Password</label>
        <input id="sign-up-password" name="password" type="password" autocomplete="new-password"></p>
      ${actionBar(html`<button type="submit" class="button green" data-action="sign-up">Start a desk</button>`)}
    </form>
  `;
  return page({ heading: 'Start a desk', screen: 'sign-up', frame: 'public', main });
}

export function notFoundPage(): string {
  const main = html`
    ${heading(copy.notFoundHeading)}
    <p class="lead">The address you asked for is not on this desk. Try the <a href="/method">method</a> or the
      <a href="/questions">questions</a>.</p>
  `;
  return page({ heading: copy.notFoundHeading, screen: 'not-found', frame: 'public', main });
}

export { rowMenuFragment };
