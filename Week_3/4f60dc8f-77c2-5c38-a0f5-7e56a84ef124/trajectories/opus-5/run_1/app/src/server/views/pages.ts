import {
  INVOICE_STATUS_WORD,
  MILESTONE_LABEL,
  SHOT_ORDER,
  UNIT_DECISIONS,
  UNIT_LABEL,
  milestoneSortIndex,
  shotSortIndex,
  type CaseStudy,
  type EngagementView,
  type IntakeFileView,
  type InvoiceView,
  type ReviewView,
  type Service,
  type StudioContent,
  type StudioEngagementView,
} from '../../shared/domain.js';
import { formatMoney, type CurrencyCode } from '../../shared/money.js';
import {
  FX_LINE_GBP,
  degrees,
  formatUtcDate,
  fullReadout,
  fxLineIndicative,
  fxLineLocked,
  metreReadout,
  payByLine,
} from '../../shared/format.js';
import {
  MEASUREMENT_FAILED_COPY,
  NOT_FOUND_HEADING,
  NOT_FOUND_TEXT,
  SCALE_EMPTY_COPY,
} from '../../shared/errors.js';
import { attr, escapeHtml, shell, STUDIO_NAME } from './html.js';

const canvas = (kind: string, extra = ''): string =>
  `<div class="scene" data-scene="${attr(kind)}" data-webgl="off"${extra === '' ? '' : ` ${extra}`}><canvas class="scene-canvas" aria-hidden="true"></canvas><p class="scene-fallback" data-scene-fallback hidden></p></div>`;

const caseStudyTile = (study: CaseStudy): string => `
<li class="tile" data-tile="${attr(study.slug)}">
  <div class="tile-subject" data-scene="case-study" data-webgl="off" data-transition="done" data-slug="${attr(study.slug)}" data-primitives="${attr(study.scene.primitives.join(','))}" data-accent="${attr(study.scene.accent)}"><canvas class="scene-canvas" aria-hidden="true"></canvas></div>
  <a class="tile-link" href="/work/${attr(study.slug)}">${escapeHtml(study.title)}</a>
  <p class="tile-client">${escapeHtml(study.client)}</p>
</li>`;

const servicesTable = (services: readonly Service[]): string => `
<table class="shot-prices" aria-label="Shot prices">
  <thead><tr><th scope="col">Shot</th><th scope="col">Price per colourway</th></tr></thead>
  <tbody>
    ${services
      .map(
        (service) => `<tr data-service-row="${attr(service.code)}">
      <td>
        <span class="service-object" data-scene="service" data-webgl="off" data-tilt="0" data-idle="turning" data-code="${attr(service.code)}"><canvas class="scene-canvas" aria-hidden="true"></canvas></span>
        <a href="/start">${escapeHtml(service.title)}</a>
      </td>
      <td class="numeral">${escapeHtml(formatMoney(BigInt(service.list_price_pence), 'GBP'))}</td>
    </tr>`,
      )
      .join('\n    ')}
  </tbody>
</table>`;

const PROCESS_STAGES = [
  '01 Quote',
  '02 Deposit',
  '03 Look-dev review',
  '04 Final review',
  '05 Delivered',
];

export const homePage = (content: StudioContent): string =>
  shell({
    title: 'Your CAD, lit like a launch',
    withSearch: true,
    bodyClass: 'page-home',
    bootstrap: { page: 'home', content },
    main: `
<section class="hero section" aria-label="Hero" data-hero data-scrub-progress="0.000">
  <h1 class="display">Your CAD, lit like a launch.</h1>
  ${canvas('hero', 'data-hero-scene')}
</section>

<section class="section" id="work" aria-labelledby="work-heading">
  <h2 id="work-heading" class="display">Work</h2>
  <ul class="case-studies" aria-label="Case studies" data-case-studies data-deck-index="1">
    ${content.case_studies.map(caseStudyTile).join('\n    ')}
  </ul>
</section>

<section class="section" id="services" aria-labelledby="services-heading">
  <h2 id="services-heading" class="display">Services</h2>
  ${servicesTable(content.services)}
</section>

<section class="section process" id="process" aria-label="Process" data-process data-process-step="1">
  <h2 class="display">How a commission runs</h2>
  ${canvas('process', 'data-process-scene')}
  <ol class="process-stages" aria-label="Process stages" data-process-stages>
    ${PROCESS_STAGES.map(
      (stage, index) =>
        `<li${index === 0 ? ' aria-current="step"' : ''}>${escapeHtml(stage)}</li>`,
    ).join('\n    ')}
  </ol>
</section>

<section class="section" id="studio" aria-labelledby="studio-heading">
  <h2 id="studio-heading" class="display">Studio</h2>
  <ul class="team">
    ${content.team
      .map(
        (member) =>
          `<li><h3>${escapeHtml(member.name)}</h3><p class="role">${escapeHtml(member.role)}</p><p>${escapeHtml(member.bio)}</p></li>`,
      )
      .join('\n    ')}
  </ul>
  <div class="clients" aria-label="Clients" role="region" data-marquee>
    <h3>Clients</h3>
    <button type="button" data-marquee-toggle aria-pressed="false">Pause client names</button>
    <div class="marquee-track" data-marquee-track>
      <ul class="marquee-list">
        ${content.marquee.map((name) => `<li>${escapeHtml(name)}</li>`).join('\n        ')}
      </ul>
      <ul class="marquee-list" aria-hidden="true">
        ${content.marquee.map((name) => `<li>${escapeHtml(name)}</li>`).join('\n        ')}
      </ul>
    </div>
  </div>
</section>

<section class="section" id="insights" aria-labelledby="insights-heading">
  <h2 id="insights-heading" class="display">Insights</h2>
  <ul class="insights">
    ${content.insights
      .map(
        (insight) =>
          `<li id="insight-${attr(insight.slug)}"><h3>${escapeHtml(insight.title)}</h3><p>${escapeHtml(insight.summary)}</p></li>`,
      )
      .join('\n    ')}
  </ul>
</section>`,
  });

export const caseStudyPage = (study: CaseStudy): string =>
  shell({
    title: study.title,
    withSearch: true,
    bootstrap: { page: 'case_study', study },
    main: `
<article class="case-study section" data-case-study="${attr(study.slug)}">
  <h1 class="display">${escapeHtml(study.title)}</h1>
  <figure class="case-subject" aria-label="${attr(`${study.title} in 3D`)}" data-scene="case-study" data-webgl="off" data-morph="0.000" data-idle="turning" data-transition="done" data-primitives="${attr(study.scene.primitives.join(','))}" data-accent="${attr(study.scene.accent)}">
    <canvas class="scene-canvas" aria-hidden="true"></canvas>
  </figure>
  <p class="case-summary">${escapeHtml(study.summary)}</p>
  <button type="button" role="switch" aria-checked="false" data-clay-switch>Clay view</button>
</article>`,
  });

export const notFoundPage = (): string =>
  shell({
    title: NOT_FOUND_HEADING,
    bootstrap: { page: 'not_found' },
    main: `
<section class="section not-found">
  <h1 class="display">${escapeHtml(NOT_FOUND_HEADING)}</h1>
  <p>${escapeHtml(NOT_FOUND_TEXT)}</p>
  <a href="/">${escapeHtml(STUDIO_NAME)}</a>
</section>`,
  });

export const startPage = (): string =>
  shell({
    title: 'Start a project',
    bootstrap: { page: 'start' },
    main: `
<section class="section form-section">
  <h1 class="display">Start a project</h1>
  <form aria-label="Start a project" data-start-form novalidate>
    <div class="error-summary" role="alert" data-error-summary hidden></div>
    ${[
      { name: 'brand_name', label: 'Brand name' },
      { name: 'contact_name', label: 'Your name' },
      { name: 'email', label: 'Email' },
      { name: 'title', label: 'Project title' },
      { name: 'finance_email', label: 'Finance contact email' },
      { name: 'reviewer_email', label: 'Reviewer email' },
    ]
      .map(
        (input) => `<p class="field">
      <label for="start-${attr(input.name)}">${escapeHtml(input.label)}</label>
      <input type="text" id="start-${attr(input.name)}" name="${attr(input.name)}" data-field="${attr(input.name)}">
      <span class="field-error" data-field-error="${attr(input.name)}"></span>
    </p>`,
      )
      .join('\n    ')}
    <fieldset role="radiogroup" aria-label="Account currency" data-field="currency">
      <legend>Account currency</legend>
      ${['EUR', 'GBP', 'USD', 'JPY']
        .map(
          (code) => `<label class="radio"><input type="radio" name="currency" value="${attr(code)}">${escapeHtml(code)}</label>`,
        )
        .join('\n      ')}
      <span class="field-error" data-field-error="currency"></span>
    </fieldset>
    <button type="submit" data-submit>Start project</button>
  </form>
</section>`,
  });

export const signInPage = (next: string | null): string =>
  shell({
    title: 'Sign in',
    bootstrap: { page: 'sign_in', next },
    main: `
<section class="section form-section">
  <h1 class="display">Sign in</h1>
  <form aria-label="Sign in" data-signin-form novalidate>
    <div class="error-summary" role="alert" data-error-summary hidden></div>
    <p class="field">
      <label for="signin-email">Email</label>
      <input type="text" id="signin-email" data-field="email">
      <span class="field-error" data-field-error="email"></span>
    </p>
    <button type="button" data-send-code>Send code</button>
    <p class="field">
      <label for="signin-code">Code</label>
      <input type="text" id="signin-code" data-field="code" inputmode="numeric" autocomplete="one-time-code">
      <span class="field-error" data-field-error="code"></span>
    </p>
    <button type="submit" data-signin>Sign in</button>
    <p class="form-note" data-signin-note></p>
  </form>
</section>`,
  });

export const accountPage = (
  engagements: { id: string; reference: string; title: string; state: string }[],
): string =>
  shell({
    title: 'Account',
    bootstrap: { page: 'account' },
    main: `
<section class="section">
  <h1 class="display">Your projects</h1>
  <ul class="engagement-list" aria-label="Engagements">
    ${engagements
      .map(
        (engagement) =>
          `<li><a href="/account/engagements/${attr(engagement.id)}">${escapeHtml(`${engagement.reference} ${engagement.title}`)}</a></li>`,
      )
      .join('\n    ')}
  </ul>
</section>`,
  });

const intakeRow = (file: IntakeFileView, isCurrentModel: boolean): string => {
  const note =
    file.kind === 'model' && isCurrentModel
      ? file.measurement === 'measured'
        ? 'Measured'
        : file.measurement === 'delayed'
          ? 'Measuring is delayed'
          : file.measurement === 'failed'
            ? MEASUREMENT_FAILED_COPY
            : 'Measuring'
      : '';
  const status = file.status === 'superseded' ? 'Superseded' : file.measurement === 'failed' ? 'Rejected' : 'Received';
  return `<li data-file="${attr(file.id)}" data-kind="${attr(file.kind)}">
  <span class="file-name">${escapeHtml(file.name)}</span>
  <span class="file-size numeral">${file.size_bytes}</span>
  <span class="file-status" data-file-status>${escapeHtml(status)}</span>
  ${note === '' ? '' : `<span class="file-note" data-file-note>${escapeHtml(note)}</span>`}
  ${file.needs_unit_confirmation ? '<button type="button" data-check-unit>Check unit</button>' : ''}
</li>`;
};

export const intakeList = (files: IntakeFileView[], withDownloads: { engagementId: string } | null): string => {
  const currentModel = [...files].reverse().find((file) => file.kind === 'model' && file.status === 'received');
  return `<ul class="intake-files" aria-label="Intake files" data-intake-files>
  ${files
    .map((file) => {
      const row = intakeRow(file, currentModel?.id === file.id);
      if (withDownloads === null) return row;
      const link = `<a href="/api/engagements/${attr(withDownloads.engagementId)}/files/${attr(file.id)}/content" aria-label="${attr(`Download ${file.name}`)}">${escapeHtml(`Download ${file.name}`)}</a>`;
      return row.replace('</li>', `  ${link}\n</li>`);
    })
    .join('\n  ')}
</ul>`;
};

const invoiceRowCells = (invoice: InvoiceView): {
  milestone: string;
  number: string;
  amount: string;
  status: string;
  payBy: string;
  action: string;
} => ({
  milestone: MILESTONE_LABEL[invoice.milestone],
  number: invoice.number ?? '',
  amount: formatMoney(BigInt(invoice.amount_minor), invoice.currency),
  status: INVOICE_STATUS_WORD[invoice.status],
  payBy:
    invoice.status === 'payment_failed' && invoice.overdue_at !== null
      ? payByLine(invoice.overdue_at)
      : '',
  action:
    invoice.status === 'issued' || invoice.status === 'payment_failed' || invoice.status === 'overdue'
      ? `<button type="button" data-pay-invoice="${attr(invoice.id)}">${escapeHtml(`Pay invoice ${invoice.number ?? ''}`)}</button>`
      : '',
});

export const invoicesBlock = (invoices: InvoiceView[]): string => {
  const ordered = [...invoices].sort(
    (a, b) => milestoneSortIndex(a.milestone) - milestoneSortIndex(b.milestone),
  );
  const rows = ordered.map(invoiceRowCells);
  return `
<div class="invoices" data-invoices>
  <table class="invoices-wide" aria-label="Invoices" data-invoices-wide>
    <thead><tr><th scope="col">Milestone</th><th scope="col">Invoice</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (row) => `<tr>
        <td>${escapeHtml(row.milestone)}</td>
        <td class="numeral">${escapeHtml(row.number)}</td>
        <td class="numeral">${escapeHtml(row.amount)}</td>
        <td><span class="status-word">${escapeHtml(row.status)}</span>${row.payBy === '' ? '' : `<span class="pay-by">${escapeHtml(row.payBy)}</span>`}</td>
        <td>${row.action}</td>
      </tr>`,
        )
        .join('\n      ')}
    </tbody>
  </table>
  <table class="invoices-medium" aria-label="Invoices" data-invoices-medium hidden>
    <thead><tr><th scope="col">Milestone</th><th scope="col">Amount</th><th scope="col">Status</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (row) => `<tr>
        <td>${escapeHtml(row.milestone)}<span class="invoice-number numeral">${escapeHtml(row.number)}</span></td>
        <td class="numeral">${escapeHtml(row.amount)}</td>
        <td><span class="status-word">${escapeHtml(row.status)}</span>${row.payBy === '' ? '' : `<span class="pay-by">${escapeHtml(row.payBy)}</span>`}${row.action}</td>
      </tr>`,
        )
        .join('\n      ')}
    </tbody>
  </table>
  <ul class="invoices-cards" aria-label="Invoices" data-invoices-cards hidden>
    ${rows
      .map(
        (row) => `<li>
      <span class="milestone">${escapeHtml(row.milestone)}</span>
      <span class="invoice-number numeral">${escapeHtml(row.number)}</span>
      <span class="numeral">${escapeHtml(row.amount)}</span>
      <span class="status-word">${escapeHtml(row.status)}</span>
      ${row.payBy === '' ? '' : `<span class="pay-by">${escapeHtml(row.payBy)}</span>`}
      ${row.action}
    </li>`,
      )
      .join('\n    ')}
  </ul>
</div>`;
};

const paymentDialog = (name: string, payLabel: string, marker: string): string => `
<div class="dialog" role="dialog" aria-modal="true" aria-label="${attr(name)}" ${marker} hidden>
  <h2>${escapeHtml(name)}</h2>
  <p class="test-cards">Test cards: 4242 4242 4242 4242 approves, 4000 0000 0000 0002 declines.</p>
  <div class="dialog-error" data-dialog-error></div>
  <p class="field"><label for="${attr(marker)}-number">Card number</label><input type="text" id="${attr(marker)}-number" data-card="number"><span class="field-error" data-field-error="card.number"></span></p>
  <p class="field"><label for="${attr(marker)}-expiry">Expiry (MM/YY)</label><input type="text" id="${attr(marker)}-expiry" data-card="expiry"><span class="field-error" data-field-error="card.expiry"></span></p>
  <p class="field"><label for="${attr(marker)}-cvc">Security code</label><input type="text" id="${attr(marker)}-cvc" data-card="cvc"><span class="field-error" data-field-error="card.cvc"></span></p>
  <p class="field"><label for="${attr(marker)}-name">Name on card</label><input type="text" id="${attr(marker)}-name" data-card="name"><span class="field-error" data-field-error="card.name"></span></p>
  <button type="button" data-dialog-confirm>${escapeHtml(payLabel)}</button>
  <button type="button" data-dialog-cancel>Cancel</button>
</div>`;

export const engagementPage = (engagement: EngagementView): string =>
  shell({
    title: engagement.reference,
    bootstrap: { page: 'engagement', engagement },
    main: `
<section class="section engagement" data-engagement="${attr(engagement.id)}">
  <h1 class="display">${escapeHtml(engagement.reference)}</h1>
  <p class="engagement-title">${escapeHtml(engagement.title)}</p>
  <p class="engagement-state" data-state>${escapeHtml(engagement.state)}</p>
  <div data-invoices-region>${invoicesBlock(engagement.invoices)}</div>
  <h2>Receipts</h2>
  <ul class="receipts" aria-label="Receipts" data-receipts>
    ${engagement.ledger
      .map(
        (entry) =>
          `<li><span>${escapeHtml(entry.kind)}</span><span class="numeral">${escapeHtml(formatMoney(BigInt(entry.amount_minor), entry.currency))}</span><span>${escapeHtml(formatUtcDate(entry.created_at))}</span></li>`,
      )
      .join('\n    ')}
  </ul>
  <h2>Intake files</h2>
  ${intakeList(engagement.files, { engagementId: engagement.id })}
  <p><a href="/rig/${attr(engagement.id)}">Shot Rig</a></p>
  <div class="success" data-engagement-success hidden></div>
  ${paymentDialog('Pay invoice', 'Pay', 'data-pay-dialog')}
</section>`,
  });

export const quoteRegion = (engagement: EngagementView): string => {
  const quote = engagement.quote;
  const currency = quote.currency as CurrencyCode;
  const figure = (label: string, minor: number, marker: string): string =>
    `<div class="quote-figure"><span class="quote-label">${escapeHtml(label)}</span><span class="numeral" data-quote="${attr(marker)}" data-value-minor="${minor}">${escapeHtml(formatMoney(BigInt(minor), currency))}</span></div>`;
  const fxLine =
    currency === 'GBP'
      ? FX_LINE_GBP
      : quote.fx_locked && quote.fx_locked_at !== null
        ? fxLineLocked(quote.fx_rate, quote.fx_locked_at)
        : fxLineIndicative(quote.fx_rate);
  return `
<div class="quote" role="region" aria-label="Quote" tabindex="0" data-quote-region data-quote-revision="${quote.revision}">
  ${figure('Subtotal', quote.subtotal_minor, 'subtotal')}
  ${figure('VAT', quote.vat_minor, 'vat')}
  ${figure('Total', quote.total_minor, 'total')}
  ${figure('Deposit', quote.milestones.deposit_minor, 'deposit')}
  ${figure('Look-dev', quote.milestones.look_dev_minor, 'look_dev')}
  ${figure('Final delivery', quote.milestones.final_delivery_minor, 'final_delivery')}
  <p class="fx-line" data-fx-line>${escapeHtml(fxLine)}</p>
</div>`;
};

export const shotPositionsTable = (
  engagement: EngagementView,
  services: readonly Service[],
): string => {
  const rows = SHOT_ORDER.map((code) => {
    const service = services.find((entry) => entry.code === code);
    const line = engagement.quote.lines.find((entry) => entry.shot_code === code);
    const title = line?.title ?? service?.title ?? code;
    const pricePence = line?.unit_price_gbp_minor ?? service?.list_price_pence ?? 0;
    return `<tr data-shot-row="${attr(code)}">
      <td>${escapeHtml(title)}</td>
      <td class="numeral">${escapeHtml(degrees(service?.azimuth_deg ?? 0))}</td>
      <td class="numeral">${escapeHtml(degrees(service?.elevation_deg ?? 0))}</td>
      <td class="numeral">${escapeHtml(formatMoney(BigInt(pricePence), 'GBP'))}</td>
      <td data-selected>${line === undefined ? 'No' : 'Yes'}</td>
    </tr>`;
  });
  return `
<table class="shot-positions" aria-label="Shot positions" tabindex="0" data-shot-positions>
  <thead><tr><th scope="col">Shot</th><th scope="col">Azimuth</th><th scope="col">Elevation</th><th scope="col">Price</th><th scope="col">Selected</th></tr></thead>
  <tbody>
    ${rows.join('\n    ')}
  </tbody>
</table>`;
};

const shotsList = (engagement: EngagementView, services: readonly Service[]): string => `
<ul class="shots" aria-label="Shots" data-shots>
  ${SHOT_ORDER.map((code) => {
    const service = services.find((entry) => entry.code === code);
    const line = engagement.quote.lines.find((entry) => entry.shot_code === code);
    const title = line?.title ?? service?.title ?? code;
    return `<li data-shot="${attr(code)}">
    <input type="checkbox" id="shot-${attr(code)}" data-shot-checkbox="${attr(code)}"${line === undefined ? '' : ' checked'}>
    <label for="shot-${attr(code)}">${escapeHtml(title)}</label>
    <input type="number" min="1" max="6" step="1" class="colourways" aria-label="${attr(`Colourways for ${title}`)}" data-colourways="${attr(code)}" value="${line?.quantity ?? 1}"${line === undefined ? ' hidden' : ''}>
  </li>`;
  }).join('\n  ')}
</ul>`;

const productScale = (engagement: EngagementView): string => {
  const model = [...engagement.files]
    .reverse()
    .find((file) => file.kind === 'model' && file.status === 'received');
  const readout =
    model !== undefined && model.dimensions_m !== null && model.unit !== null
      ? fullReadout(
          {
            x: String(model.dimensions_m.x),
            y: String(model.dimensions_m.y),
            z: String(model.dimensions_m.z),
          },
          model.unit,
        )
      : SCALE_EMPTY_COPY;
  return `<div class="product-scale" role="region" aria-label="Product scale" data-product-scale>${escapeHtml(readout)}</div>`;
};

export const rigPage = (
  engagement: EngagementView,
  services: readonly Service[],
  financeEmail: string,
): string => {
  const model = [...engagement.files]
    .reverse()
    .find((file) => file.kind === 'model' && file.status === 'received');
  const asExported =
    model?.dimensions_m == null
      ? ''
      : metreReadout({
          x: String(model.dimensions_m.x),
          y: String(model.dimensions_m.y),
          z: String(model.dimensions_m.z),
        });
  return shell({
    title: `Shot Rig ${engagement.reference}`,
    bootstrap: { page: 'rig', engagement, services, finance_email: financeEmail },
    bodyClass: 'page-rig',
    main: `
<section class="section rig" data-rig-page="${attr(engagement.id)}">
  <h1 class="display">Shot Rig</h1>
  <div class="rig-grid">
    <div class="rig-uploads">
      <button type="button" data-upload-button>Upload files</button>
      <input type="file" id="rig-file-input" class="visually-hidden" tabindex="-1" multiple aria-label="Product files" data-file-input>
    </div>
    <div class="rig-canvas">
      <div class="rig-group" role="group" aria-label="Shot Rig" tabindex="0"
           data-rig data-scene="rig" data-webgl="off"
           data-frustum-count="${engagement.quote.lines.length}"
           data-focused-shot="${attr(engagement.quote.lines[0]?.shot_code ?? SHOT_ORDER[0])}"
           data-rig-phase="idle" data-orbit-azimuth="0">
        <canvas class="scene-canvas" aria-hidden="true"></canvas>
        <p class="scene-fallback" data-scene-fallback hidden></p>
      </div>
      <figure class="camera-view" aria-label="Camera view" data-pip data-pip-shot="${attr(engagement.quote.lines.at(-1)?.shot_code ?? 'overview')}">
        <canvas class="scene-canvas" aria-hidden="true"></canvas>
        <figcaption data-pip-label></figcaption>
      </figure>
    </div>
    <div class="rig-controls">
      ${shotsList(engagement, services)}
      ${quoteRegion(engagement)}
      <button type="button" class="primary rig-pay" data-pay-deposit>Pay deposit</button>
    </div>
  </div>
  ${productScale(engagement)}
  ${shotPositionsTable(engagement, services)}
  ${intakeList(engagement.files, null)}
  <div class="quote-bar" data-quote-bar>
    <span class="numeral" data-quote-bar-total>${escapeHtml(formatMoney(BigInt(engagement.quote.total_minor), engagement.quote.currency as CurrencyCode))}</span>
    <button type="button" class="primary" data-pay-deposit>Pay deposit</button>
  </div>
  <div class="live-regions">
    <div role="status" aria-label="Upload progress" data-upload-progress></div>
    <div role="status" aria-label="Quote updates" data-quote-updates></div>
    <div role="status" aria-label="Rig focus" data-rig-focus></div>
  </div>
  <div class="success" data-deposit-success hidden></div>
  ${paymentDialog('Pay deposit', 'Pay', 'data-deposit-dialog')}
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Check the export unit" data-unit-dialog hidden>
    <h2>Check the export unit</h2>
    <p class="as-exported" data-as-exported>${escapeHtml(asExported)}</p>
    <fieldset role="radiogroup" aria-label="Export unit">
      <legend>Export unit</legend>
      ${UNIT_DECISIONS.map(
        (unit) =>
          `<label class="radio"><input type="radio" name="unit" value="${attr(unit)}">${escapeHtml(UNIT_LABEL[unit])}</label>`,
      ).join('\n      ')}
    </fieldset>
    <button type="button" data-unit-confirm>Use this unit</button>
  </div>
</section>`,
  });
};

export const reviewPage = (review: ReviewView, token: string): string =>
  shell({
    title: `${review.reference} ${MILESTONE_LABEL[review.milestone]}`,
    bootstrap: { page: 'review', review, token },
    main: `
<section class="section review" data-review="${attr(token)}">
  <h1 class="display">${escapeHtml(`${review.reference} ${MILESTONE_LABEL[review.milestone]}`)}</h1>
  <p class="rounds" data-rounds>${escapeHtml(`Revision rounds used: ${review.revision_rounds_used} of 2`)}</p>
  <ul class="stills" aria-label="Stills" data-stills>
    ${review.stills
      .map(
        (still) =>
          `<li><img src="${attr(still.url)}" alt="${attr(`${still.title} still`)}" data-still="${attr(still.id)}"></li>`,
      )
      .join('\n    ')}
  </ul>
  <button type="button" data-review-accept>${escapeHtml(`Accept ${review.milestone === 'look_dev' ? 'look-dev' : 'final delivery'}`)}</button>
  <button type="button" data-review-revise>Request a revision</button>
  <div class="success" data-review-success hidden></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Request a revision" data-revision-dialog hidden>
    <h2>Request a revision</h2>
    <div class="dialog-error" data-dialog-error></div>
    <p class="field"><label for="revision-note">What should change?</label><textarea id="revision-note" data-revision-note></textarea><span class="field-error" data-field-error="note"></span></p>
    <button type="button" data-revision-send>Send request</button>
    <button type="button" data-dialog-cancel>Cancel</button>
  </div>
</section>`,
  });

export const studioSignInPage = (): string =>
  shell({
    title: 'Studio',
    bootstrap: { page: 'studio_sign_in' },
    main: `
<section class="section form-section">
  <h1 class="display">Studio</h1>
  <form aria-label="Studio sign in" data-studio-form novalidate>
    <div class="error-summary" role="alert" data-error-summary hidden></div>
    <p class="field"><label for="studio-password">Studio password</label><input type="password" id="studio-password" data-field="password"><span class="field-error" data-field-error="password"></span></p>
    <button type="submit" data-studio-signin>Sign in</button>
  </form>
</section>`,
  });

export type StudioDashboardData = {
  engagements: { id: string; reference: string; title: string; state: string; brand_name: string }[];
  caseStudies: CaseStudy[];
  services: Service[];
  rates: { currency: string; rate: string; effective_at: string; status: 'Current' | 'Scheduled' }[];
  health: Record<string, 'up' | 'down'>;
};

const HEALTH_LABELS: { key: string; label: string }[] = [
  { key: 'postgres', label: 'Postgres' },
  { key: 'killbill', label: 'Kill Bill' },
  { key: 'minio', label: 'File storage' },
  { key: 'mailpit', label: 'Email' },
  { key: 'pocketbase', label: 'Studio content' },
  { key: 'rabbitmq', label: 'Measuring queue' },
  { key: 'gotenberg', label: 'Documents' },
  { key: 'meilisearch', label: 'Search' },
  { key: 'ntfy', label: 'Studio alerts' },
];

export const studioDashboardPage = (data: StudioDashboardData): string =>
  shell({
    title: 'Studio',
    bootstrap: { page: 'studio', data },
    main: `
<section class="section studio-dashboard">
  <h1 class="display">Studio</h1>
  <div role="region" aria-label="Service health" class="service-health" data-service-health>
    <h2>Service health</h2>
    <ul>
      ${HEALTH_LABELS.map(
        (service) =>
          `<li data-health="${attr(service.key)}"><span>${escapeHtml(service.label)}</span><span data-health-state>${escapeHtml(data.health[service.key] === 'up' ? 'Up' : 'Down')}</span></li>`,
      ).join('\n      ')}
    </ul>
  </div>

  <table class="engagements" aria-label="Engagements">
    <thead><tr><th scope="col">Reference</th><th scope="col">Brand</th><th scope="col">Title</th><th scope="col">State</th></tr></thead>
    <tbody>
      ${data.engagements
        .map(
          (engagement) => `<tr>
        <td><a href="/studio/engagements/${attr(engagement.id)}">${escapeHtml(engagement.reference)}</a></td>
        <td>${escapeHtml(engagement.brand_name)}</td>
        <td>${escapeHtml(engagement.title)}</td>
        <td>${escapeHtml(engagement.state)}</td>
      </tr>`,
        )
        .join('\n      ')}
    </tbody>
  </table>

  <ul class="studio-case-studies" aria-label="Studio case studies" data-studio-case-studies>
    ${data.caseStudies
      .map(
        (study) => `<li data-case-study="${attr(study.slug)}">
      <span class="tile-subject" data-scene="case-study" data-webgl="off" data-primitives="${attr(study.scene.primitives.join(','))}" data-accent="${attr(study.scene.accent)}"><canvas class="scene-canvas" aria-hidden="true"></canvas></span>
      <span class="study-title">${escapeHtml(study.title)}</span>
      <span class="study-client">${escapeHtml(study.client)}</span>
      <span class="study-state">${escapeHtml(study.published ? 'Published' : 'Draft')}</span>
      <button type="button" data-toggle-published="${attr(study.slug)}">${escapeHtml(study.published ? 'Unpublish' : 'Publish')}</button>
    </li>`,
      )
      .join('\n    ')}
  </ul>

  <form class="service-editor" aria-label="Shot titles and prices" data-service-editor>
    <h2>Shot titles and prices</h2>
    ${data.services
      .map(
        (service) => `<p class="field" data-service="${attr(service.code)}">
      <label for="service-title-${attr(service.code)}">${escapeHtml(service.code)} title</label>
      <input type="text" id="service-title-${attr(service.code)}" data-service-title value="${attr(service.title)}">
      <label for="service-price-${attr(service.code)}">${escapeHtml(service.code)} price in pence</label>
      <input type="number" id="service-price-${attr(service.code)}" data-service-price value="${service.list_price_pence}">
      <button type="button" data-save-service="${attr(service.code)}">Save service</button>
    </p>`,
      )
      .join('\n    ')}
  </form>

  <table class="exchange-rates" aria-label="Exchange rates" data-exchange-rates>
    <thead><tr><th scope="col">Currency</th><th scope="col">Rate</th><th scope="col">Effective from</th><th scope="col">Status</th></tr></thead>
    <tbody>
      ${data.rates
        .map(
          (rate) => `<tr>
        <td>${escapeHtml(rate.currency)}</td>
        <td class="numeral">${escapeHtml(rate.rate)}</td>
        <td>${escapeHtml(formatUtcDate(rate.effective_at))}</td>
        <td>${escapeHtml(rate.status)}</td>
      </tr>`,
        )
        .join('\n      ')}
    </tbody>
  </table>

  <form class="rate-form" aria-label="Add a rate" data-rate-form>
    <p class="field"><label for="rate-currency">Currency</label>
      <select id="rate-currency" data-rate-currency><option value="EUR">EUR</option><option value="USD">USD</option><option value="JPY">JPY</option></select>
      <span class="field-error" data-field-error="currency"></span></p>
    <p class="field"><label for="rate-value">Rate</label><input type="text" id="rate-value" data-rate-value><span class="field-error" data-field-error="rate"></span></p>
    <p class="field"><label for="rate-effective">Effective from</label><input type="text" id="rate-effective" data-rate-effective placeholder="ISO 8601"><span class="field-error" data-field-error="effective_at"></span></p>
    <button type="button" data-add-rate>Add rate</button>
  </form>
  <div class="success" data-studio-success hidden></div>
</section>`,
  });

export const studioEngagementPage = (
  engagement: StudioEngagementView,
  services: readonly Service[],
): string =>
  shell({
    title: `Studio ${engagement.reference}`,
    bootstrap: { page: 'studio_engagement', engagement, services },
    main: `
<section class="section studio-engagement" data-studio-engagement="${attr(engagement.id)}">
  <h1 class="display">${escapeHtml(engagement.reference)}</h1>
  <p>${escapeHtml(engagement.title)} &middot; ${escapeHtml(engagement.brand.name)} &middot; <span data-state>${escapeHtml(engagement.state)}</span></p>

  <h2>Intake files</h2>
  <ul class="intake-files" aria-label="Intake files">
    ${engagement.files
      .map(
        (file) =>
          `<li><span>${escapeHtml(file.name)}</span> <a href="/api/studio/engagements/${attr(engagement.id)}/files/${attr(file.id)}/content" aria-label="${attr(`Download ${file.name}`)}">${escapeHtml(`Download ${file.name}`)}</a></li>`,
      )
      .join('\n    ')}
  </ul>

  <h2>Stills</h2>
  ${(['look_dev', 'final_delivery'] as const)
    .map(
      (milestone) => `<div class="still-uploads" data-milestone="${attr(milestone)}">
    <h3>${escapeHtml(MILESTONE_LABEL[milestone])}</h3>
    ${[...engagement.quote.lines]
      .sort((a, b) => shotSortIndex(a.shot_code) - shotSortIndex(b.shot_code))
      .map(
        (line) => `<p class="field">
      <input type="file" id="still-${attr(milestone)}-${attr(line.shot_code)}" class="visually-hidden" tabindex="-1" aria-hidden="true" data-still-input="${attr(milestone)}:${attr(line.shot_code)}">
      <button type="button" data-still-upload="${attr(milestone)}:${attr(line.shot_code)}">${escapeHtml(`Upload ${MILESTONE_LABEL[milestone]} still for ${line.title}`)}</button>
    </p>`,
      )
      .join('\n    ')}
  </div>`,
    )
    .join('\n  ')}

  <button type="button" data-send-for-review>Send for review</button>
  <button type="button" data-revoke-review-link>Revoke review link</button>

  <h2>Invoices</h2>
  <ul class="studio-invoices" data-studio-invoices>
    ${engagement.invoices
      .map(
        (invoice) => `<li data-invoice="${attr(invoice.id)}">
      <span>${escapeHtml(MILESTONE_LABEL[invoice.milestone])}</span>
      <span class="numeral">${escapeHtml(formatMoney(BigInt(invoice.amount_minor), invoice.currency))}</span>
      <span class="status-word">${escapeHtml(INVOICE_STATUS_WORD[invoice.status])}</span>
      ${invoice.status === 'draft' ? `<button type="button" data-issue-invoice="${attr(invoice.id)}">${escapeHtml(`Issue invoice ${MILESTONE_LABEL[invoice.milestone]}`)}</button>` : ''}
    </li>`,
      )
      .join('\n    ')}
  </ul>

  <h2>Ledger</h2>
  <ul class="ledger" aria-label="Ledger">
    ${engagement.ledger
      .map(
        (entry) =>
          `<li><span>${escapeHtml(entry.kind)}</span><span class="numeral">${escapeHtml(formatMoney(BigInt(entry.amount_minor), entry.currency))}</span><span>${escapeHtml(formatUtcDate(entry.created_at))}</span></li>`,
      )
      .join('\n    ')}
  </ul>

  <button type="button" data-cancel-refund>Cancel and refund</button>
  <div class="success" data-studio-success hidden></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Cancel and refund" data-cancel-dialog hidden>
    <h2>Cancel and refund</h2>
    <div class="dialog-error" data-dialog-error></div>
    <p class="field"><label for="refund-amount">Refund amount</label><input type="text" id="refund-amount" data-refund-amount><span class="field-error" data-field-error="refund_minor"></span></p>
    <button type="button" data-cancel-confirm>Cancel and refund</button>
    <button type="button" data-dialog-cancel>Close</button>
  </div>
  ${services.length === 0 ? '' : ''}
</section>`,
  });
