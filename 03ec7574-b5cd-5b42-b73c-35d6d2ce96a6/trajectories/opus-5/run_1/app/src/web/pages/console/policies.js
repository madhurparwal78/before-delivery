import { h } from '../../html.js';
import { consolePage } from '../../layout.js';
import { displayTime, emptyState } from './parts.js';

const FIELD_SOURCES = ['request_body', 'system', 'reference'];
const FIELDS = ['destination.address', 'source.asset', 'source.chain', 'source.amount', 'current_unix_timestamp'];
const OPERATORS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in'];
const METHODS = ['transfer', 'batch_payout', '*'];
const ACTIONS = ['ALLOW', 'DENY'];

export function renderPolicies({ session, data, toasts, awaiting }) {
  const content = `
    <h1>Policies</h1>
    <section class="panel">
      ${data.policies.length ? `
      <table class="stacked">
        <caption>Policies</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Chain type</th><th scope="col">Rules</th><th scope="col">Revision</th><th scope="col">Used by</th></tr></thead>
        <tbody>
          ${data.policies.map((policy) => `
            <tr>
              <td data-label="Name"><a href="/console/policies/${h(policy.id)}">${h(policy.name)}</a></td>
              <td data-label="Chain type">${h(policy.chain_type)}</td>
              <td data-label="Rules">${policy.rules.length}</td>
              <td data-label="Revision">${policy.revision}</td>
              <td data-label="Used by">${h((data.usedBy.get(policy.id) || []).join(', ') || 'No wallets')}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : emptyState('No policies yet')}
    </section>`;
  return consolePage({ title: 'Policies — Corvo console', session, active: '/console/policies', content, toasts, awaiting });
}

function selectField(name, options, value, label, { disabled, kind }) {
  return `
    <label class="sr-only" for="${h(name)}">${h(label)}</label>
    <select id="${h(name)}" name="${h(name)}" ${disabled ? 'disabled' : ''} data-editor-field data-kind="${h(kind)}">
      ${options.map((option) => `<option value="${h(option)}"${option === value ? ' selected' : ''}>${h(option)}</option>`).join('')}
    </select>`;
}

function conditionRow(ruleIndex, condition, conditionIndex, { disabled, aggregations }) {
  const prefix = `cond_${ruleIndex}_${conditionIndex}`;
  const fieldOptions = [...FIELDS, ...aggregations.map((aggregation) => `aggregation.${aggregation.id}`)];
  const value = Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value);
  return `
    <div class="batch-line" data-condition>
      <div>${selectField(`${prefix}_field_source`, FIELD_SOURCES, condition.field_source, `Rule ${ruleIndex + 1} condition ${conditionIndex + 1} field source`, { disabled, kind: 'field_source' })}</div>
      <div>${selectField(`${prefix}_field`, fieldOptions, condition.field, `Rule ${ruleIndex + 1} condition ${conditionIndex + 1} field`, { disabled, kind: 'field' })}</div>
      <div>${selectField(`${prefix}_operator`, OPERATORS, condition.operator, `Rule ${ruleIndex + 1} condition ${conditionIndex + 1} operator`, { disabled, kind: 'operator' })}</div>
      <div>
        <label class="sr-only" for="${prefix}_value">Rule ${ruleIndex + 1} condition ${conditionIndex + 1} value</label>
        <input type="text" id="${prefix}_value" name="${prefix}_value" value="${h(value)}" ${disabled ? 'disabled' : ''} data-editor-field data-kind="value">
      </div>
    </div>`;
}

function ruleRow(rule, index, options) {
  const number = index + 1;
  const { disabled } = options;
  return `
    <tr data-rule data-rule-index="${index}">
      <td data-label="Name">
        <label class="sr-only" for="rule_${index}_name">Rule ${number} name</label>
        <input type="text" id="rule_${index}_name" name="rule_${index}_name" value="${h(rule.name)}" ${disabled ? 'disabled' : ''} data-editor-field data-kind="name">
      </td>
      <td data-label="Method">${selectField(`rule_${index}_method`, METHODS, rule.method, `Rule ${number} method`, { disabled, kind: 'method' })}</td>
      <td data-label="Action">${selectField(`rule_${index}_action`, ACTIONS, rule.action, `Rule ${number} action`, { disabled, kind: 'action' })}</td>
      <td data-label="Conditions" data-conditions>
        ${rule.conditions.map((condition, conditionIndex) => conditionRow(index, condition, conditionIndex, options)).join('')}
        ${disabled ? '' : `<button type="button" class="capsule capsule-light" data-add-condition>Add condition to rule ${number}</button>`}
      </td>
      <td data-label="Order">
        ${disabled ? '' : `
          <div class="inline-actions">
            <button type="button" class="capsule capsule-light" data-move="up">Move rule ${number} up</button>
            <button type="button" class="capsule capsule-light" data-move="down">Move rule ${number} down</button>
            <button type="button" class="capsule capsule-light" data-remove-rule>Remove rule ${number}</button>
          </div>`}
      </td>
    </tr>`;
}

export function renderPolicy({ session, data, toasts, awaiting }) {
  const { policy, revisions, wallets, aggregations } = data;
  const disabled = session.member.role !== 'owner';
  const content = `
    <h1>${h(policy.name)}</h1>
    <p class="help">Revision ${policy.revision} · ${h(policy.rules.length)} rules · chain type ${h(policy.chain_type)}</p>

    <section class="panel">
      <h2>Rules</h2>
      <form method="post" action="/console/policies/${h(policy.id)}" data-policy-form>
        <input type="hidden" name="__action" value="save-policy">
        <table class="stacked">
          <caption>Rules</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Method</th><th scope="col">Action</th><th scope="col">Conditions</th><th scope="col">Order</th></tr></thead>
          <tbody data-rules>
            ${policy.rules.map((rule, index) => ruleRow(rule, index, { disabled, aggregations })).join('')}
          </tbody>
        </table>
        ${disabled ? '' : `
          <div class="inline-actions" style="margin-top:1rem">
            <button type="button" class="capsule capsule-light" data-add-rule>Add rule</button>
            <button type="submit" class="capsule capsule-dark">Save policy</button>
          </div>
          <p class="field-error" data-form-error></p>`}
      </form>
    </section>

    <section class="panel">
      <h2>Revision history</h2>
      <table class="stacked">
        <caption>Revisions</caption>
        <thead><tr><th scope="col">Revision</th><th scope="col">Name</th><th scope="col">Saved</th></tr></thead>
        <tbody>
          ${revisions.map((revision) => `
            <tr>
              <td data-label="Revision">${revision.revision}</td>
              <td data-label="Name">${h(revision.name)}</td>
              <td data-label="Saved">${h(displayTime(revision.created_at))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Simulate</h2>
      <form method="post" action="/console/policies/${h(policy.id)}" aria-label="Simulate" data-simulate-form>
        <input type="hidden" name="__action" value="simulate">
        <div class="field">
          <label for="simulate-method">Method</label>
          <select id="simulate-method" name="method">
            <option value="transfer">transfer</option>
            <option value="batch_payout">batch_payout</option>
          </select>
        </div>
        <div class="field">
          <label for="simulate-wallet">Wallet</label>
          <select id="simulate-wallet" name="wallet_id">
            ${wallets.map((wallet) => `<option value="${h(wallet.id)}">${h(wallet.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="simulate-destination">Destination address</label>
          <input type="text" id="simulate-destination" name="destination_address">
          <p class="field-error" data-error-for="destination_address"></p>
        </div>
        <div class="field">
          <label for="simulate-amount">Amount</label>
          <input type="text" id="simulate-amount" name="amount" inputmode="decimal">
          <p class="field-error" data-error-for="amount"></p>
        </div>
        <button type="submit" class="capsule capsule-dark">Simulate</button>
      </form>
      <div class="result-line" role="status" aria-label="Simulation result" data-simulation>${data.simulation ? renderSimulation(data.simulation) : ''}</div>
    </section>

    <template data-rule-template>
      ${ruleRow({ name: '', method: 'transfer', action: 'ALLOW', conditions: [{ field_source: 'request_body', field: 'destination.address', operator: 'eq', value: '' }] }, 0, { disabled: false, aggregations })}
    </template>
    <template data-condition-template>
      ${conditionRow(0, { field_source: 'request_body', field: 'destination.address', operator: 'eq', value: '' }, 0, { disabled: false, aggregations })}
    </template>`;

  return consolePage({
    title: `${policy.name} — Corvo console`,
    session,
    active: '/console/policies',
    content,
    toasts,
    awaiting
  });
}

export function renderSimulation(simulation) {
  const ruleLine = simulation.rule ? `rule ${simulation.rule}` : 'no rule matched';
  return `
    <p><strong>${h(simulation.action)}</strong> · ${h(ruleLine)}</p>
    <p>Evaluated against revision ${h(simulation.policy_revision)}</p>
    ${simulation.aggregationLines.map((line) => `<p>${h(line)}</p>`).join('')}
    ${simulation.trace.map((entry) => `<p>${h(entry)}</p>`).join('')}`;
}
