import { attr, html } from './html.js';
import { display, icon } from './icons.js';
import { publicPage } from './layout.js';

const arrow = icon('arrow');

// ---------------------------------------------------------------- landing
const PRODUCTS = [
  ['Wallets for every customer', 'Give each user a wallet the moment they sign up.', 'card'],
  ['Trading desks that keep pace', 'Settle fills and rebalance positions in seconds.', 'scale'],
  ['Treasury with guardrails', 'Route and spend company funds under written policies and named approvers.', 'checklist', '/console/approvals'],
  ['Accounts for neobanks', 'Offer dollar balances with the controls a bank expects.', 'bank'],
  ['Payments by software agents', 'Let agents pay within limits that people set and can read.', 'agent'],
  ['Card spend from balances', 'Fund card purchases straight from wallet balances.', 'card'],
  ['Yield on idle funds', 'Put balances that sit still to work under policy.', 'coin'],
];
const STATS = [['40M+', 'wallets opened'], ['85+', 'countries'], ['$5B+', 'moved each month'], ['99.95%', 'uptime over the last year']];
const CASES = [
  ['Northline', 'Northline pays contractors in 60 countries from one Corvo treasury'],
  ['Paygrid', 'Paygrid gives hourly workers dollar wallets on Corvo'],
  ['Tidepool', 'Tidepool runs its trading desk settlements through Corvo'],
  ['Fennick', 'Fennick ships a self-custody wallet built with Corvo'],
];
const BUILDERS = [
  ['Keys kept apart', 'Signing keys live in isolated hardware with layered controls.', 'shield'],
  ['Use only what you need', 'Adopt wallets, policies or approvals one at a time.', 'blocks'],
  ['Built to scale', 'Millions of wallets and transfers without a queue.', 'bolt'],
  ['High-level building blocks', 'Policies, quorums and audit trails instead of raw keys.', 'layers'],
];

const ctas = html`<div class="actions">
  <a class="pill pill--dark" href="/login">Get started${arrow}</a>
  <a class="pill pill--outline" href="/contact">Contact sales${arrow}</a>
</div>`;

// The hero's drawn approval: a pending transfer that a scroll of the page carries to its second signature.
const heroPanel = html`<section class="panel-demo" aria-label="Pending transfer preview" data-hero-panel>
  <div class="panel-demo__head">${icon('transfer')}<span>Pending transfer</span>
    <span class="badge badge--pending_approval" data-hero-badge>pending_approval</span></div>
  <p class="panel-demo__amount">15000 USDC</p>
  <dl class="panel-demo__meta">
    <div><dt>From</dt><dd>Operating USDC</dd></div>
    <div><dt>To</dt><dd>0x1111…1111</dd></div>
    <div><dt>Memo</dt><dd>October hardware</dd></div>
  </dl>
  <div class="panel-demo__signers" aria-hidden="true">
    <span class="signer signer--done">AB</span><span class="signer" data-hero-signer>BO</span>
  </div>
  <div class="progress progress--hero" role="progressbar" aria-label="Approvals" aria-valuemin="0" aria-valuemax="2" aria-valuenow="1" data-hero-bar>
    <span class="progress__fill progress__fill--hero"></span>
  </div>
  <p class="panel-demo__count" data-hero-count>1 of 2 approvals</p>
</section>`;

export function landingPage() {
  return publicPage({ title: 'Corvo: govern digital money with policies and approvals', main: html`
<section class="hero">
  <div class="wrap hero__grid">
    <div class="hero__copy">
      ${display('h1', 'Hold, move and govern digital money', 'on your rules', 'display--hero')}
      <p class="lead" data-blur-lead>Open wallets, write spending policies and route large payouts to the people who must sign, all in one console.</p>
      ${ctas}
    </div>
    ${heroPanel}
  </div>
</section>

<section class="band band--mist reveal" id="products">
  <div class="wrap">
    ${display('h2', 'One wallet layer for', 'every money flow')}
    <ul class="cards cards--products">
      ${PRODUCTS.map(([title, text, glyph, href]) => (href
    ? html`<li class="card card--link"><a class="card__link" href="${href}"><span class="tile">${icon(glyph)}</span><h3>${title}</h3><p>${text}</p><span class="card__more">Open approvals${arrow}</span></a></li>`
    : html`<li class="card"><span class="tile">${icon(glyph)}</span><h3>${title}</h3><p>${text}</p></li>`))}
    </ul>
  </div>
</section>

<section class="band reveal" aria-labelledby="stats-heading">
  <div class="wrap">
    <h2 class="sr-only" id="stats-heading">Corvo in numbers</h2>
    <ul class="stats">
      ${STATS.map(([value, label]) => html`<li><span class="stat">${value}</span><span class="stat__label">${icon('chart')}${label}</span></li>`)}
    </ul>
  </div>
</section>

<section class="band band--mist reveal" id="stories">
  <div class="wrap">
    ${display('h2', 'Teams building on', 'Corvo')}
    <ul class="cards cards--cases" aria-label="Customer stories" tabindex="0">
      ${CASES.map(([company, title]) => html`<li class="card card--case"><div class="case__tile" aria-hidden="true"><span>${company}</span></div><h3>${title}</h3></li>`)}
    </ul>
  </div>
</section>

<section class="band reveal" id="builders">
  <div class="wrap">
    ${display('h2', 'Made for builders.', 'Ready for auditors.')}
    <ul class="cards cards--builders">
      ${BUILDERS.map(([title, text, glyph]) => html`<li class="card"><span class="tile">${icon(glyph)}</span><h3>${title}</h3><p>${text}</p></li>`)}
    </ul>
  </div>
</section>

<section class="band band--mist reveal closing">
  <div class="wrap closing__inner">
    ${display('h2', 'Start in an afternoon.', 'Ship this week.')}
    <p class="lead">Open wallets, set policies and move your first payout today.</p>
    ${ctas}
  </div>
</section>` });
}

// ---------------------------------------------------------------- pricing
const TIERS = [['Starter', '0 - 999', 'Free'], ['Growth', '1,000 - 4,999', '$249 / month'], ['Scale', '5,000 - 19,999', '$649 / month']];
const ENTERPRISE = ['Custom rates per transfer or per active wallet', 'Uptime commitments and a named support lead',
  'Webhooks, single sign-on and custom integrations', 'Volume pricing on signed transfers'];
const INCLUDED = [['Embedded wallets', 'card'], ['One sign-in for every app', 'shield'], ['Audited, compliant infrastructure', 'layers'],
  ['Usage-based billing', 'chart'], ['Reports and analytics', 'list'], ['A console you can brand', 'grid']];
const MATRIX = [
  ['Wallets', [['Named single-asset wallets', true, true], ['Deposits and transfers', true, true], ['Payroll batches', true, true]]],
  ['Controls', [['Policy engine', true, true], ['Key quorum approvals', true, true], ['Single sign-on', 'Add-on', true]]],
  ['Records', [['Hash-chained audit trail', true, true], ['Signed event log', true, true], ['Intents export', true, true]]],
  ['Support', [['Uptime commitments', false, true], ['Named support lead', false, true]]],
];
const QUESTIONS = [
  ['What counts as an active wallet?', 'A wallet with at least one transfer in the month.'],
  ['Do failed transfers count?', 'No. Only executed transfers count toward your plan.'],
  ['Can we change plans later?', 'Yes, at any time. The new plan starts from the next month.'],
];

const cell = (value) => {
  if (value === true) return html`<td>${icon('tick', 'Included')}</td>`;
  if (value === false) return html`<td><span class="muted">Not included</span></td>`;
  return html`<td>${value}</td>`;
};

export function pricingPage() {
  return publicPage({ title: 'Pricing | Corvo', main: html`
<section class="hero hero--page">
  <div class="wrap">
    ${display('h1', 'Pricing that grows', 'with you.', 'display--page')}
    <p class="lead" data-blur-lead>Start free, then pay for the active wallets and transfers you actually use.</p>
  </div>
</section>

<section class="band band--tight reveal">
  <div class="wrap plans">
    <section class="plan" aria-labelledby="plan-developer">
      <h2 id="plan-developer">Developer</h2>
      <p>For teams getting started. Every core feature, with 20,000 signatures and $250,000 in transfers free each month.</p>
      <table class="tiers">
        <caption class="sr-only">Developer prices by active wallets</caption>
        <thead><tr><th scope="col">Tier</th><th scope="col">Active wallets</th><th scope="col">Price</th></tr></thead>
        <tbody>${TIERS.map(([tier, range, price]) => html`<tr><th scope="row">${tier}</th><td>${range}</td><td>${price}</td></tr>`)}</tbody>
      </table>
      <a class="pill pill--dark" href="/login">Get started${arrow}</a>
    </section>
    <section class="plan plan--enterprise" aria-labelledby="plan-enterprise">
      <h2 id="plan-enterprise">Enterprise</h2>
      <p>For platforms that need custom controls and global reach.</p>
      <ul class="ticks">${ENTERPRISE.map((line) => html`<li>${icon('tick')}<span>${line}</span></li>`)}</ul>
      <a class="pill pill--outline" href="/contact">Talk to sales${arrow}</a>
    </section>
  </div>
</section>

<section class="band band--mist reveal">
  <div class="wrap">
    <p class="kicker">Trusted by 1,400+ finance teams.</p>
    <h2 class="section-title">Every plan includes</h2>
    <ul class="cards cards--included">
      ${INCLUDED.map(([label, glyph]) => html`<li class="card card--flat"><span class="tile">${icon(glyph)}</span><span class="card__label">${label}</span></li>`)}
    </ul>
  </div>
</section>

<section class="band reveal" id="matrix">
  <div class="wrap">
    <h2 class="section-title">Compare the plans</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Plan comparison">
      <table class="matrix" aria-label="Feature comparison matrix">
        <thead><tr><th scope="col">Feature</th><th scope="col">Developer</th><th scope="col">Enterprise</th></tr></thead>
        ${MATRIX.map(([group, rows]) => html`<tbody>
          <tr class="matrix__group"><th scope="colgroup" colspan="3">${group}</th></tr>
          ${rows.map(([feature, dev, ent]) => html`<tr><th scope="row">${feature}</th>${cell(dev)}${cell(ent)}</tr>`)}
        </tbody>`)}
      </table>
    </div>
  </div>
</section>

<section class="band band--mist reveal" id="pricing-questions">
  <div class="wrap faq">
    <h2 class="section-title">Pricing questions</h2>
    ${QUESTIONS.map(([question, answer], i) => html`<div class="faq__item" data-faq>
      <h3><button type="button" class="faq__button" aria-expanded="false" aria-controls="answer-${i + 1}">${question}${icon('chevron')}</button></h3>
      <div class="faq__answer" id="answer-${i + 1}"><p>${answer}</p></div>
    </div>`)}
    <p class="muted faq__note">Plans are arranged with our team; this site takes no payment.</p>
  </div>
</section>` });
}

// ---------------------------------------------------------------- contact
const FIELDS = [
  ['full_name', 'Full name', 'text', 'name'],
  ['work_email', 'Work email', 'email', 'email'],
  ['company', 'Company', 'text', 'organization'],
];
export const VOLUME_OPTIONS = ['Under $1M', '$1M to $10M', '$10M to $100M', 'Over $100M'];

function described(name, errors) {
  return errors[name] ? html` aria-invalid="true" aria-describedby="e-${name}"` : '';
}

function fieldError(name, errors) {
  return errors[name] ? html`<p class="field__error" id="e-${name}">${errors[name]}</p>` : '';
}

export function contactForm({ values = {}, errors = {}, sent = false }) {
  if (sent) {
    return html`<div class="form-card" id="contact-card"><p class="thanks" tabindex="-1" data-focus-on-load>${icon('tick')}Thanks. Our team will reply within one business day.</p></div>`;
  }
  return html`<div class="form-card" id="contact-card">
  <form method="post" action="/contact" novalidate data-fetch="contact" aria-labelledby="contact-heading">
    ${FIELDS.map(([name, label, type, auto]) => html`<div class="field${errors[name] ? ' field--invalid' : ''}">
      <label for="f-${name}">${label}</label>
      <input id="f-${name}" name="${name}" type="${type}" autocomplete="${auto}" value="${values[name] || ''}"${described(name, errors)}>
      ${fieldError(name, errors)}
    </div>`)}
    <div class="field${errors.monthly_volume ? ' field--invalid' : ''}">
      <label for="f-monthly_volume">Monthly volume</label>
      <select id="f-monthly_volume" name="monthly_volume"${described('monthly_volume', errors)}>
        <option value="">Choose one</option>
        ${VOLUME_OPTIONS.map((v) => html`<option value="${v}"${attr('selected', values.monthly_volume === v)}>${v}</option>`)}
      </select>
      ${fieldError('monthly_volume', errors)}
    </div>
    <div class="field${errors.message ? ' field--invalid' : ''}">
      <label for="f-message">How can we help?</label>
      <textarea id="f-message" name="message" rows="5"${described('message', errors)}>${values.message || ''}</textarea>
      ${fieldError('message', errors)}
    </div>
    <button class="pill pill--dark" type="submit">Send message${arrow}</button>
  </form>
</div>`;
}

export function contactPage(state) {
  return publicPage({ title: 'Contact sales | Corvo', main: html`
<section class="hero hero--form">
  <div class="wrap form-page">
    <div>
      <h1 class="display display--page" id="contact-heading">Contact sales</h1>
      <p class="lead">Talk to our team about building with Corvo</p>
      <ul class="ticks ticks--contact">
        <li>${icon('tick')}<span>A walkthrough of policies, key quorums and the audit trail</span></li>
        <li>${icon('tick')}<span>Pricing for your volume and active wallets</span></li>
        <li>${icon('tick')}<span>A reply within one business day</span></li>
      </ul>
    </div>
    ${contactForm(state)}
  </div>
</section>` });
}

// ---------------------------------------------------------------- sign in, not found, errors
export function loginPage({ next = '', email = '', error = '', outage = false }) {
  return publicPage({ title: 'Sign in | Corvo', bodyClass: 'site--auth', main: html`
<section class="auth">
  <div class="auth__card">
    <h1 class="display display--auth">Sign in to Corvo</h1>
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${next}">
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" value="${email}" required${error ? html` aria-describedby="login-error"` : ''}>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required${error ? html` aria-describedby="login-error"` : ''}>
      </div>
      ${error ? html`<p class="form-alert" id="login-error" role="alert">${error}</p>` : ''}
      ${outage ? html`<p class="form-alert" role="alert">Corvo can't reach its database. Nothing was changed. Try again in a moment.</p>` : ''}
      <button class="pill pill--dark pill--wide" type="submit">Sign in</button>
    </form>
  </div>
</section>` });
}

export function notFoundPage() {
  return publicPage({ title: 'Page not found | Corvo', main: html`
<section class="hero hero--form"><div class="wrap message">
  <h1 class="display display--page">Page not found</h1>
  <p class="lead">Nothing lives at this address.</p>
  <a class="pill pill--dark" href="/">Back to home${arrow}</a>
</div></section>` });
}

export function errorPage({ heading, text, toast = null }) {
  return publicPage({ title: `${heading} | Corvo`, toast, main: html`
<section class="hero hero--form"><div class="wrap message">
  <h1 class="display display--page">${heading}</h1>
  <p class="lead">${text}</p>
  <a class="pill pill--dark" href="/">Back to home${arrow}</a>
</div></section>` });
}
