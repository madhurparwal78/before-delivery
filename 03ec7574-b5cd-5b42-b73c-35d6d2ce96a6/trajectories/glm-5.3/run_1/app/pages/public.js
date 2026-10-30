import { page, esc, statusBadge } from './html.js';

const CTA_ARROW = '<svg class="cta-arrow" aria-hidden="true" viewBox="0 0 12 12"><path d="M1 6h9M7 2.5L10.5 6 7 9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

export function landingPage() {
  const productCards = [
    ['Wallets for every customer', 'Give each user a wallet the moment they sign up.'],
    ['Trading desks that keep pace', 'Settle fills and rebalance positions in seconds.'],
    ['Treasury with guardrails', 'Route and spend company funds under written policies and named approvers.', '/console/approvals'],
    ['Accounts for neobanks', 'Offer dollar balances with the controls a bank expects.'],
    ['Payments by software agents', 'Let agents pay within limits that people set and can read.'],
    ['Card spend from balances', 'Fund card purchases straight from wallet balances.'],
    ['Yield on idle funds', 'Put balances that sit still to work under policy.'],
  ];
  const cases = [
    ['Northline', 'Northline pays contractors in 60 countries from one Corvo treasury'],
    ['Paygrid', 'Paygrid gives hourly workers dollar wallets on Corvo'],
    ['Tidepool', 'Tidepool runs its trading desk settlements through Corvo'],
    ['Fennick', 'Fennick ships a self-custody wallet built with Corvo'],
  ];
  const builders = [
    ['Keys kept apart', 'Signing keys live in isolated hardware with layered controls.'],
    ['Use only what you need', 'Adopt wallets, policies or approvals one at a time.'],
    ['Built to scale', 'Millions of wallets and transfers without a queue.'],
    ['High-level building blocks', 'Policies, quorums and audit trails instead of raw keys.'],
  ];
  return page({
    title: 'Corvo — Hold, move and govern digital money',
    active: 'landing',
    scripts: ['/assets/app.js'],
    body: `
<section class="hero">
  <div class="hero-inner">
    <h1 class="display blur-in">Hold, move and govern digital money <span class="slate">on your rules</span></h1>
    <p class="hero-lead blur-words">Open wallets, write spending policies and route large payouts to the people who must sign, all in one console.</p>
    <p class="hero-ctas">
      <a class="capsule capsule-dark" href="/login">Get started${CTA_ARROW}</a>
      <a class="capsule capsule-outline" href="/contact">Contact sales${CTA_ARROW}</a>
    </p>
    <div class="hero-panel-wrap">
      <div class="hero-panel" id="hero-approval" role="region" aria-label="Pending transfer preview">
        <div class="transfer-card">
          <div class="transfer-head">
            <span class="transfer-title">Transfer · 12000 USDC</span>
            ${statusBadge('pending_approval')}
          </div>
          <div class="transfer-row">
            <div class="progress-note"><span id="hero-approval-count">1 of 2 approvals</span><span class="muted" id="hero-approver-dots"><i class="dot on" aria-hidden="true"></i><i class="dot" id="hero-second-dot" aria-hidden="true"></i></span></div>
            <div class="progress" role="progressbar" aria-label="Approvals" aria-valuenow="1" aria-valuemin="0" aria-valuemax="2" id="hero-progress" style="--fill: 50%"></div>
          </div>
          <p class="transfer-memo">October hardware · Operating USDC</p>
        </div>
      </div>
    </div>
  </div>
</section>
<section class="band section-rise" id="product-cards">
  <div class="section-inner">
    <h2 class="display-2 blur-in">One wallet layer for <span class="slate">every money flow</span></h2>
    <div class="card-grid grid-4">
      ${productCards.map(([title, text, href]) => href
        ? `<a class="card card-link" href="${href}"><h3>${esc(title)}</h3><p>${esc(text)}</p></a>`
        : `<div class="card"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`).join('')}
    </div>
  </div>
</section>
<section class="band band-mist section-rise" id="stats">
  <div class="section-inner">
    <div class="stats-row">
      <div class="stat"><span class="stat-value"><svg class="icon" aria-hidden="true" viewBox="0 0 16 16"><path d="M2 14h3V8H2v6zm4.5 0h3V4h-3v10zM11 14h3V2h-3v12z" fill="currentColor"/></svg> 40M+</span><span class="stat-label">wallets opened</span></div>
      <div class="stat"><span class="stat-value"><svg class="icon" aria-hidden="true" viewBox="0 0 16 16"><path d="M2 14h3V8H2v6zm4.5 0h3V4h-3v10zM11 14h3V2h-3v12z" fill="currentColor"/></svg> 85+</span><span class="stat-label">countries</span></div>
      <div class="stat"><span class="stat-value"><svg class="icon" aria-hidden="true" viewBox="0 0 16 16"><path d="M2 14h3V8H2v6zm4.5 0h3V4h-3v10zM11 14h3V2h-3v12z" fill="currentColor"/></svg> $5B+</span><span class="stat-label">moved each month</span></div>
      <div class="stat"><span class="stat-value"><svg class="icon" aria-hidden="true" viewBox="0 0 16 16"><path d="M2 14h3V8H2v6zm4.5 0h3V4h-3v10zM11 14h3V2h-3v12z" fill="currentColor"/></svg> 99.95%</span><span class="stat-label">uptime over the last year</span></div>
    </div>
  </div>
</section>
<section class="band section-rise" id="cases">
  <div class="section-inner">
    <h2 class="display-2 blur-in">Teams building on <span class="slate">Corvo</span></h2>
    <div class="case-row">
      ${cases.map(([name, title]) => `<div class="card case-card"><span class="case-tile" aria-hidden="true">${esc(name)}</span><p>${esc(title)}</p></div>`).join('')}
    </div>
  </div>
</section>
<section class="band band-mist section-rise" id="builders">
  <div class="section-inner">
    <h2 class="display-2 blur-in">Made for builders. <span class="slate">Ready for auditors.</span></h2>
    <div class="card-grid grid-4">
      ${builders.map(([title, text]) => `<div class="card"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`).join('')}
    </div>
  </div>
</section>
<section class="band section-rise" id="cta">
  <div class="section-inner cta-final">
    <h2 class="display-2 blur-in">Start in an afternoon. <span class="slate">Ship this week.</span></h2>
    <p>Open wallets, set policies and move your first payout today.</p>
    <p class="hero-ctas">
      <a class="capsule capsule-dark" href="/login">Get started${CTA_ARROW}</a>
      <a class="capsule capsule-outline" href="/contact">Contact sales${CTA_ARROW}</a>
    </p>
  </div>
</section>`,
  });
}

export function pricingPage() {
  const included = ['Embedded wallets', 'One sign-in for every app', 'Audited, compliant infrastructure',
    'Usage-based billing', 'Reports and analytics', 'A console you can brand'];
  const questions = [
    ['What counts as an active wallet?', 'A wallet with at least one transfer in the month.'],
    ['Do failed transfers count?', 'No, only executed transfers count.'],
    ['Can we change plans later?', 'Yes, at any time from the next month.'],
  ];
  return page({
    title: 'Pricing — Corvo',
    active: 'pricing',
    scripts: ['/assets/app.js'],
    body: `
<section class="band pricing-hero">
  <div class="section-inner">
    <h1 class="display blur-in">Pricing that grows <span class="slate">with you.</span></h1>
    <p class="hero-lead">Start free, then pay for the active wallets and transfers you actually use.</p>
  </div>
</section>
<section class="band band-mist section-rise">
  <div class="section-inner">
    <div class="pricing-grid">
      <div class="card pricing-card" role="region" aria-label="Developer">
        <h2>Developer</h2>
        <p>For teams getting started. Every core feature, with 20,000 signatures and $250,000 in transfers free each month.</p>
        <table class="tier-table">
          <thead><tr><th scope="col">Active wallets</th><th scope="col">Price</th></tr></thead>
          <tbody>
            <tr><th scope="row">Starter</th><td>0 - 999</td><td>Free</td></tr>
            <tr><th scope="row">Growth</th><td>1,000 - 4,999</td><td>$249 / month</td></tr>
            <tr><th scope="row">Scale</th><td>5,000 - 19,999</td><td>$649 / month</td></tr>
          </tbody>
        </table>
        <a class="capsule capsule-dark" href="/login">Get started${CTA_ARROW}</a>
      </div>
      <div class="card pricing-card" role="region" aria-label="Enterprise">
        <h2>Enterprise</h2>
        <p>For platforms that need custom controls and global reach.</p>
        <ul class="tick-list">
          <li>Custom rates per transfer or per active wallet</li>
          <li>Uptime commitments and a named support lead</li>
          <li>Webhooks, single sign-on and custom integrations</li>
          <li>Volume pricing on signed transfers</li>
        </ul>
        <a class="capsule capsule-outline" href="/contact">Talk to sales${CTA_ARROW}</a>
      </div>
    </div>
  </div>
</section>
<section class="band section-rise">
  <div class="section-inner">
    <p class="trusted">Trusted by 1,400+ finance teams.</p>
    <h2>Every plan includes</h2>
    <ul class="tick-list included-list">
      ${included.map((i) => `<li>${esc(i)}</li>`).join('')}
    </ul>
  </div>
</section>
<section class="band band-mist section-rise">
  <div class="section-inner">
    <table class="matrix" aria-label="Feature comparison matrix">
      <thead><tr><th scope="col">Feature</th><th scope="col">Developer</th><th scope="col">Enterprise</th></tr></thead>
      <tbody>
        <tr><th scope="row">Policy engine</th><td><span class="check" role="img" aria-label="Included">✓</span></td><td><span class="check" role="img" aria-label="Included">✓</span></td></tr>
        <tr><th scope="row">Key quorum approvals</th><td><span class="check" role="img" aria-label="Included">✓</span></td><td><span class="check" role="img" aria-label="Included">✓</span></td></tr>
        <tr><th scope="row">Single sign-on</th><td>Add-on</td><td>Included</td></tr>
      </tbody>
    </table>
  </div>
</section>
<section class="band section-rise" id="pricing-questions">
  <div class="section-inner narrow">
    <h2 class="display-2 blur-in">Pricing questions</h2>
    ${questions.map(([q, a], i) => `
    <div class="faq">
      <h3 class="faq-heading">
        <button type="button" class="faq-btn" aria-expanded="false" aria-controls="faq-a-${i}">
          <span>${esc(q)}</span><svg class="chev" aria-hidden="true" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </h3>
      <div class="faq-panel" id="faq-a-${i}" hidden><p>${esc(a)}</p></div>
    </div>`).join('')}
  </div>
</section>`,
  });
}

export function contactPage(prefill = {}) {
  return page({
    title: 'Contact sales — Corvo',
    active: 'contact',
    scripts: ['/assets/app.js'],
    body: `
<section class="band contact-hero">
  <div class="section-inner narrow">
    <h1 class="display blur-in">Contact sales</h1>
    <p class="hero-lead">Talk to our team about building with Corvo</p>
    <form id="contact-form" class="stack-form" novalidate>
      <div class="field">
        <label for="full_name">Full name</label>
        <input id="full_name" name="full_name" type="text" autocomplete="name" value="${esc(prefill.full_name || '')}">
        <p class="field-error" id="err-full_name" hidden></p>
      </div>
      <div class="field">
        <label for="work_email">Work email</label>
        <input id="work_email" name="work_email" type="text" autocomplete="email" value="${esc(prefill.work_email || '')}">
        <p class="field-error" id="err-work_email" hidden></p>
      </div>
      <div class="field">
        <label for="company">Company</label>
        <input id="company" name="company" type="text" autocomplete="organization" value="${esc(prefill.company || '')}">
        <p class="field-error" id="err-company" hidden></p>
      </div>
      <div class="field">
        <label for="monthly_volume">Monthly volume</label>
        <select id="monthly_volume" name="monthly_volume">
          <option value="">Choose a volume</option>
          <option value="Under $1M">Under $1M</option>
          <option value="$1M to $10M">$1M to $10M</option>
          <option value="$10M to $100M">$10M to $100M</option>
          <option value="Over $100M">Over $100M</option>
        </select>
        <p class="field-error" id="err-monthly_volume" hidden></p>
      </div>
      <div class="field">
        <label for="message">How can we help?</label>
        <textarea id="message" name="message" rows="5"></textarea>
        <p class="field-error" id="err-message" hidden></p>
      </div>
      <button type="submit" class="capsule capsule-dark submit-btn">Send message${CTA_ARROW}</button>
    </form>
    <p id="contact-thanks" class="thanks" tabindex="-1" hidden>Thanks. Our team will reply within one business day.</p>
  </div>
</section>`,
  });
}

export function loginPage(next = '', error = false, email = '') {
  const safeNext = /^\/console(\/|$)/.test(next) ? next : '';
  return page({
    title: 'Sign in to Corvo',
    active: 'login',
    scripts: ['/assets/app.js'],
    body: `
<section class="band login-hero">
  <div class="section-inner narrow">
    <h1 class="display blur-in">Sign in to Corvo</h1>
    <form id="login-form" class="stack-form" novalidate>
      <input type="hidden" name="next" value="${esc(safeNext)}">
      <div class="alert" id="login-alert" role="alert" ${error ? '' : 'hidden'}>${error ? 'Email or password is incorrect' : ''}</div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="text" autocomplete="username" value="${esc(email)}">
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password">
      </div>
      <button type="submit" class="capsule capsule-dark submit-btn">Sign in</button>
    </form>
  </div>
</section>`,
  });
}

export function notFoundPageHtml() {
  return page({
    title: 'Page not found — Corvo',
    active: 'notfound',
    body: `
<section class="band">
  <div class="section-inner narrow center">
    <h1 class="display">Page not found</h1>
    <p>This address does not exist on Corvo.</p>
    <p><a class="capsule capsule-dark" href="/">Back to home${CTA_ARROW}</a></p>
  </div>
</section>`,
  });
}
