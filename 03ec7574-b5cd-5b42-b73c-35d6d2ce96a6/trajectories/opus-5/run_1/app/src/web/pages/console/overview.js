import { h, icon } from '../../html.js';
import { consolePage } from '../../layout.js';
import { badge } from './parts.js';

const CHAINS = ['ethereum', 'base'];
const ASSETS = ['usdc', 'eth'];

function statCard(label, value, key) {
  return `
    <article class="card">
      <span class="tile">${icon('bars')}</span>
      <div class="value" data-stat="${h(key)}">${h(value)}</div>
      <div class="label">${h(label)}</div>
    </article>`;
}

function createRow(data) {
  return `
    <tr hidden data-create-row>
      <td colspan="9">
        <form method="post" action="/console" class="batch-line" style="grid-template-columns:repeat(3,1fr)" data-create-form aria-label="Create wallet">
          <input type="hidden" name="__action" value="create-wallet">
          <div class="field"><label for="wallet-name">Name</label><input id="wallet-name" name="name" type="text"></div>
          <div class="field">
            <label for="wallet-chain">Chain</label>
            <select id="wallet-chain" name="chain">${CHAINS.map((chain) => `<option value="${chain}">${chain}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="wallet-asset">Asset</label>
            <select id="wallet-asset" name="asset">${ASSETS.map((asset) => `<option value="${asset}">${asset}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="wallet-policy">Policy</label>
            <select id="wallet-policy" name="policy_id">
              <option value="">No policy</option>
              ${[...data.policyNames].map(([id, name]) => `<option value="${h(id)}">${h(name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="wallet-quorum">Quorum</label>
            <select id="wallet-quorum" name="quorum_id">
              <option value="">No quorum</option>
              ${[...data.quorumNames].map(([id, name]) => `<option value="${h(id)}">${h(name)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label for="wallet-floor">Approval floor</label><input id="wallet-floor" name="approval_floor" type="text" value="0"></div>
          <div class="inline-actions">
            <button type="submit" class="capsule capsule-dark">Save wallet</button>
            <button type="button" class="capsule capsule-light" data-discard>Discard</button>
          </div>
          <p class="field-error" data-form-error></p>
        </form>
      </td>
    </tr>`;
}

export function renderOverview({ session, data, toasts }) {
  const content = `
    <h1>Overview</h1>
    <div class="stat-cards">
      ${statCard('Total wallets', data.stats.wallets, 'wallets')}
      ${statCard('Pending intents', data.stats.pending, 'pending')}
      ${statCard('Awaiting your approval', data.stats.awaiting, 'awaiting')}
      ${statCard('Executed in 24 hours', data.stats.executedRecently, 'executed')}
    </div>
    <section class="panel">
      <div class="inline-actions" style="justify-content:space-between;align-items:center">
        <h2>Wallets</h2>
        ${session.member.role === 'owner' ? '<button type="button" class="capsule capsule-dark" data-create-wallet>Create wallet</button>' : ''}
      </div>
      <table class="stacked">
        <caption>Wallets</caption>
        <thead>
          <tr>
            <th scope="col">Name</th><th scope="col">Chain</th><th scope="col">Asset</th>
            <th scope="col" class="num">Balance</th><th scope="col" class="num">Available</th><th scope="col" class="num">Pending</th>
            <th scope="col">Policy</th><th scope="col">Quorum</th><th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          ${createRow(data)}
          ${data.wallets.map((wallet) => `
            <tr>
              <td data-label="Name"><a href="/console/wallets/${h(wallet.id)}">${h(wallet.name)}</a></td>
              <td data-label="Chain">${h(wallet.chain)}</td>
              <td data-label="Asset">${h(wallet.asset.toUpperCase())}</td>
              <td data-label="Balance" class="num">${h(wallet.balance)}</td>
              <td data-label="Available" class="num">${h(wallet.available)}</td>
              <td data-label="Pending" class="num">${h(wallet.reserved)}</td>
              <td data-label="Policy">${h(wallet.policy_id ? data.policyNames.get(wallet.policy_id) || '' : 'None')}</td>
              <td data-label="Quorum">${h(wallet.quorum_id ? data.quorumNames.get(wallet.quorum_id) || '' : 'None')}</td>
              <td data-label="Status">${badge(wallet.status)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>`;

  return consolePage({
    title: 'Overview — Corvo console',
    session,
    active: '/console',
    content,
    toasts,
    awaiting: data.stats.awaiting
  });
}
