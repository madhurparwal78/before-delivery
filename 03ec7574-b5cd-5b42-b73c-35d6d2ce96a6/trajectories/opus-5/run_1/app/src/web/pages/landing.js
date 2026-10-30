import { displayHeading, h, icon } from '../html.js';
import { publicPage } from '../layout.js';

const PRODUCT_CARDS = [
  ['Wallets for every customer', 'Give each user a wallet the moment they sign up.', 'wallet', null],
  ['Trading desks that keep pace', 'Settle fills and rebalance positions in seconds.', 'bolt', null],
  ['Treasury with guardrails', 'Route and spend company funds under written policies and named approvers.', 'shield', '/console/approvals'],
  ['Accounts for neobanks', 'Offer dollar balances with the controls a bank expects.', 'card', null],
  ['Payments by software agents', 'Let agents pay within limits that people set and can read.', 'swap', null],
  ['Card spend from balances', 'Fund card purchases straight from wallet balances.', 'card', null],
  ['Yield on idle funds', 'Put balances that sit still to work under policy.', 'bars', null]
];

const STATS = [
  ['40M+', 'wallets opened'],
  ['85+', 'countries'],
  ['$5B+', 'moved each month'],
  ['99.95%', 'uptime over the last year']
];

const CASES = [
  ['Northline', 'Northline pays contractors in 60 countries from one Corvo treasury'],
  ['Paygrid', 'Paygrid gives hourly workers dollar wallets on Corvo'],
  ['Tidepool', 'Tidepool runs its trading desk settlements through Corvo'],
  ['Fennick', 'Fennick ships a self-custody wallet built with Corvo']
];

const BUILDER_CARDS = [
  ['Keys kept apart', 'Signing keys live in isolated hardware with layered controls.', 'lock'],
  ['Use only what you need', 'Adopt wallets, policies or approvals one at a time.', 'layers'],
  ['Built to scale', 'Millions of wallets and transfers without a queue.', 'bolt'],
  ['High-level building blocks', 'Policies, quorums and audit trails instead of raw keys.', 'shield']
];

function heroCapsules() {
  return `
    <div class="hero-actions">
      <a class="capsule capsule-dark" href="/login">Get started${icon('arrow')}</a>
      <a class="capsule capsule-light" href="/contact">Contact sales${icon('arrow')}</a>
    </div>`;
}

function productCard([title, sentence, iconName, href]) {
  const inner = `
    <span class="tile">${icon(iconName)}</span>
    <h3>${h(title)}</h3>
    <p>${h(sentence)}</p>`;
  return href
    ? `<a class="card card-link" href="${h(href)}">${inner}</a>`
    : `<article class="card">${inner}</article>`;
}

export function renderLanding() {
  const content = `
  <section class="hero">
    <div class="shell hero-grid">
      <div>
        ${displayHeading(1, 'Hold, move and govern digital money', 'on your rules')}
        <p class="lead">Open wallets, write spending policies and route large payouts to the people who must sign, all in one console.</p>
        ${heroCapsules()}
      </div>
      <div class="preview" role="region" aria-label="Pending transfer preview" data-hero-preview>
        <div class="row">
          <div>
            <span class="label">Operating USDC</span>
            <div class="amount" data-preview-amount>15000 USDC</div>
          </div>
          <span class="badge badge-pending_approval" data-preview-badge>pending_approval</span>
        </div>
        <div class="progress">
          <div class="fill" data-preview-fill style="width:50%"></div>
        </div>
        <p class="help" role="progressbar" aria-label="Approvals" aria-valuemin="0" aria-valuemax="2" aria-valuenow="1" aria-valuetext="1 of 2 approvals" data-preview-progress>1 of 2 approvals</p>
        <div class="dots" data-preview-dots>
          <span class="dot">AB</span>
        </div>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="shell">
      <div class="section-head reveal">
        ${displayHeading(2, 'One wallet layer for', 'every money flow')}
        <p>Every Corvo product writes to the same wallets, the same policies and the same audit trail.</p>
      </div>
      <div class="card-grid reveal">${PRODUCT_CARDS.map(productCard).join('')}</div>
    </div>
  </section>

  <section>
    <div class="shell stats reveal">
      ${STATS.map(([value, label]) => `
        <div class="stat">
          <span class="tile">${icon('bars')}</span>
          <div class="value">${h(value)}</div>
          <div class="label">${h(label)}</div>
        </div>`).join('')}
    </div>
  </section>

  <section class="band">
    <div class="shell">
      <div class="section-head reveal">${displayHeading(2, 'Teams building on', 'Corvo')}</div>
      <div class="case-row reveal">
        ${CASES.map(([name, line]) => `
          <article class="case-card">
            <div class="case-art">${h(name)}</div>
            <p>${h(line)}</p>
          </article>`).join('')}
      </div>
    </div>
  </section>

  <section>
    <div class="shell">
      <div class="section-head reveal">${displayHeading(2, 'Made for builders.', 'Ready for auditors.')}</div>
      <div class="card-grid reveal">
        ${BUILDER_CARDS.map(([title, sentence, iconName]) => `
          <article class="card">
            <span class="tile">${icon(iconName)}</span>
            <h3>${h(title)}</h3>
            <p>${h(sentence)}</p>
          </article>`).join('')}
      </div>
    </div>
  </section>

  <section class="band">
    <div class="shell reveal">
      ${displayHeading(2, 'Start in an afternoon.', 'Ship this week.')}
      <p>Open wallets, set policies and move your first payout today.</p>
      ${heroCapsules()}
    </div>
  </section>`;

  return publicPage({
    title: 'Corvo — treasury wallets, policies and approvals',
    description: 'Corvo holds company funds in named wallets, decides every transfer by policy and routes large payouts to named approvers.',
    content,
    scripts: ['landing.js']
  });
}
