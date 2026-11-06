import { displayHeading, h, icon } from '../html.js';
import { publicPage } from '../layout.js';

const TIERS = [
  ['Starter', '0 - 999', 'Free'],
  ['Growth', '1,000 - 4,999', '$249 / month'],
  ['Scale', '5,000 - 19,999', '$649 / month']
];

const ENTERPRISE_LINES = [
  'Custom rates per transfer or per active wallet',
  'Uptime commitments and a named support lead',
  'Webhooks, single sign-on and custom integrations',
  'Volume pricing on signed transfers'
];

const INCLUSIONS = [
  'Embedded wallets',
  'One sign-in for every app',
  'Audited, compliant infrastructure',
  'Usage-based billing',
  'Reports and analytics',
  'A console you can brand'
];

const MATRIX = [
  ['Policy engine', 'Included', 'Included'],
  ['Key quorum approvals', 'Included', 'Included'],
  ['Single sign-on', 'Add-on', 'Included']
];

const QUESTIONS = [
  ['What counts as an active wallet?', 'A wallet with at least one transfer in the month.'],
  ['Do failed transfers count?', 'No, only executed transfers count.'],
  ['Can we change plans later?', 'Yes, at any time from the next month.']
];

function matrixCell(value) {
  if (value !== 'Included') return h(value);
  return `${icon('ticks', { label: 'Included' })}`;
}

export function renderPricing() {
  const content = `
  <section>
    <div class="shell">
      ${displayHeading(1, 'Pricing that grows', 'with you.')}
      <p class="lead">Start free, then pay for the active wallets and transfers you actually use.</p>
    </div>
  </section>

  <section class="band">
    <div class="shell card-grid two">
      <section class="card" role="region" aria-label="Developer">
        <h2>Developer</h2>
        <p>For teams getting started. Every core feature, with 20,000 signatures and $250,000 in transfers free each month.</p>
        <table>
          <caption>Tiers by active wallets</caption>
          <thead><tr><th scope="col">Tier</th><th scope="col">Active wallets</th><th scope="col">Price</th></tr></thead>
          <tbody>
            ${TIERS.map(([tier, wallets, price]) => `<tr><th scope="row">${h(tier)}</th><td>${h(wallets)}</td><td>${h(price)}</td></tr>`).join('')}
          </tbody>
        </table>
        <p><a class="capsule capsule-dark" href="/login">Get started${icon('arrow')}</a></p>
      </section>
      <section class="card" role="region" aria-label="Enterprise">
        <h2>Enterprise</h2>
        <p>For platforms that need custom controls and global reach.</p>
        <ul>${ENTERPRISE_LINES.map((line) => `<li>${h(line)}</li>`).join('')}</ul>
        <p><a class="capsule capsule-light" href="/contact">Talk to sales${icon('arrow')}</a></p>
      </section>
    </div>
  </section>

  <section>
    <div class="shell">
      <p><strong>Trusted by 1,400+ finance teams.</strong></p>
      <h2>Every plan includes</h2>
      <ul class="card-grid two">${INCLUSIONS.map((line) => `<li>${h(line)}</li>`).join('')}</ul>
    </div>
  </section>

  <section class="band">
    <div class="shell">
      <table class="panel" aria-label="Feature comparison matrix">
        <caption>Feature comparison matrix</caption>
        <thead>
          <tr><th scope="col">Feature</th><th scope="col">Developer</th><th scope="col">Enterprise</th></tr>
        </thead>
        <tbody>
          ${MATRIX.map(([feature, developer, enterprise]) => `
            <tr>
              <th scope="row">${h(feature)}</th>
              <td>${matrixCell(developer)}</td>
              <td>${matrixCell(enterprise)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </section>

  <section id="pricing-questions">
    <div class="shell">
      <h2>Pricing questions</h2>
      <div class="panel" data-questions>
        ${QUESTIONS.map(([question, answer], index) => `
          <div class="question">
            <h3>
              <button type="button" class="menu-button" aria-expanded="false" aria-controls="answer-${index}" data-question>
                ${h(question)}${icon('chevron')}
              </button>
            </h3>
            <div id="answer-${index}" hidden data-answer><p>${h(answer)}</p></div>
          </div>`).join('')}
      </div>
    </div>
  </section>`;

  return publicPage({
    title: 'Pricing — Corvo',
    description: 'Corvo pricing: start free on the Developer plan, then pay for the active wallets and transfers you use.',
    content,
    scripts: ['pricing.js']
  });
}
