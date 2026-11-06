import { h } from '../../html.js';
import { consolePage } from '../../layout.js';

const METRICS = ['sum_amount', 'count'];
const ASSETS = ['usdc', 'eth'];
const GROUPS = ['wallet', 'destination'];

function quorumForm(quorum, { members, action, label }) {
  const prefix = quorum ? `edit-${quorum.id}` : 'create';
  return `
    <form method="post" action="/console/quorums" data-quorum-form>
      <input type="hidden" name="__action" value="${h(action)}">
      ${quorum ? `<input type="hidden" name="quorum_id" value="${h(quorum.id)}">` : ''}
      <div class="field">
        <label for="${prefix}-name">Quorum name</label>
        <input type="text" id="${prefix}-name" name="name" value="${h(quorum ? quorum.name : '')}">
      </div>
      <fieldset>
        <legend>Members</legend>
        ${members.map((member) => `
          <label><input type="checkbox" name="member_ids" value="${h(member.id)}"
            ${quorum && quorum.member_ids.includes(member.id) ? 'checked' : ''}> ${h(member.name)} (${h(member.role)})</label>`).join('')}
      </fieldset>
      <div class="field">
        <label for="${prefix}-threshold">Threshold</label>
        <input type="number" id="${prefix}-threshold" name="authorization_threshold" min="1" value="${quorum ? quorum.authorization_threshold : 2}">
      </div>
      <div class="field">
        <label for="${prefix}-expiry">Expiry seconds</label>
        <input type="number" id="${prefix}-expiry" name="expiry_seconds" min="60" max="2592000" value="${quorum ? quorum.expiry_seconds : 604800}">
      </div>
      <button type="submit" class="capsule capsule-dark">${h(label)}</button>
      <p class="field-error" data-form-error></p>
    </form>`;
}

export function renderQuorums({ session, data, toasts, awaiting }) {
  const isOwner = session.member.role === 'owner';
  const eligible = data.members.filter((member) => ['owner', 'approver'].includes(member.role));
  const content = `
    <h1>Quorums</h1>
    <section class="panel">
      <div class="inline-actions" style="justify-content:space-between;align-items:center">
        <h2>Key quorums</h2>
        ${isOwner ? '<button type="button" class="capsule capsule-dark" data-toggle="create-quorum">Create key quorum</button>' : ''}
      </div>
      <table class="stacked">
        <caption>Key quorums</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Members</th><th scope="col">Threshold</th><th scope="col">Expiry</th><th scope="col">Wallets</th><th scope="col">Edit</th></tr></thead>
        <tbody>
          ${data.quorums.map((quorum) => `
            <tr>
              <td data-label="Name">${h(quorum.name)}</td>
              <td data-label="Members">${h(quorum.member_ids.map((id) => data.names.get(id) || id).join(', '))}</td>
              <td data-label="Threshold">${h(`${quorum.authorization_threshold} of ${quorum.member_ids.length}`)}</td>
              <td data-label="Expiry">${h(`${quorum.expiry_seconds / 3600} hours`)}</td>
              <td data-label="Wallets">${h((data.walletsByQuorum.get(quorum.id) || []).join(', ') || 'No wallets')}</td>
              <td data-label="Edit">
                ${isOwner ? `<button type="button" class="capsule capsule-light" data-toggle="quorum-${h(quorum.id)}">Edit ${h(quorum.name)}</button>` : ''}
              </td>
            </tr>
            ${isOwner ? `<tr hidden data-panel="quorum-${h(quorum.id)}"><td colspan="6">${quorumForm(quorum, { members: eligible, action: 'edit-quorum', label: 'Save key quorum' })}</td></tr>` : ''}`).join('')}
        </tbody>
      </table>
      ${isOwner ? `<div hidden data-panel="create-quorum">${quorumForm(null, { members: eligible, action: 'create-quorum', label: 'Save key quorum' })}</div>` : ''}
    </section>

    <section class="panel">
      <div class="inline-actions" style="justify-content:space-between;align-items:center">
        <h2>Aggregations</h2>
        ${isOwner ? '<button type="button" class="capsule capsule-dark" data-toggle="create-aggregation">Create aggregation</button>' : ''}
      </div>
      <table class="stacked">
        <caption>Aggregations</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Metric</th><th scope="col">Window</th><th scope="col">Asset</th><th scope="col">Grouping</th><th scope="col">Policies</th></tr></thead>
        <tbody>
          ${data.aggregations.map((aggregation) => `
            <tr>
              <td data-label="Name">${h(aggregation.name)}</td>
              <td data-label="Metric">${h(aggregation.metric)}</td>
              <td data-label="Window">${h(`${aggregation.window_seconds / 3600} hours`)}</td>
              <td data-label="Asset">${h(aggregation.asset.toUpperCase())}</td>
              <td data-label="Grouping">${h(aggregation.group_by)}</td>
              <td data-label="Policies">${h((data.policiesByAggregation.get(aggregation.id) || []).join(', ') || 'No policies')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${isOwner ? `
        <div hidden data-panel="create-aggregation">
          <form method="post" action="/console/quorums" data-aggregation-form>
            <input type="hidden" name="__action" value="create-aggregation">
            <div class="field"><label for="aggregation-name">Aggregation name</label><input type="text" id="aggregation-name" name="name"></div>
            <div class="field">
              <label for="aggregation-metric">Metric</label>
              <select id="aggregation-metric" name="metric">${METRICS.map((metric) => `<option value="${metric}">${metric}</option>`).join('')}</select>
            </div>
            <div class="field"><label for="aggregation-window">Window seconds</label><input type="number" id="aggregation-window" name="window_seconds" value="86400" min="60" max="2592000"></div>
            <div class="field">
              <label for="aggregation-asset">Asset</label>
              <select id="aggregation-asset" name="asset">${ASSETS.map((asset) => `<option value="${asset}">${asset}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label for="aggregation-group">Grouping</label>
              <select id="aggregation-group" name="group_by">${GROUPS.map((group) => `<option value="${group}">${group}</option>`).join('')}</select>
            </div>
            <button type="submit" class="capsule capsule-dark">Save aggregation</button>
            <p class="field-error" data-form-error></p>
          </form>
        </div>` : ''}
    </section>`;

  return consolePage({ title: 'Quorums — Corvo console', session, active: '/console/quorums', content, toasts, awaiting });
}
