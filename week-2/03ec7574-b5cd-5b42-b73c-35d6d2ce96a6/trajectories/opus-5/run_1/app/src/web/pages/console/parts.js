import { h } from '../../html.js';

export function badge(word) {
  return `<span class="badge badge-${h(word)}">${h(word)}</span>`;
}

export function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function amountWithAsset(amount, asset) {
  return `${amount} ${asset.toUpperCase()}`;
}

export function displayTime(timestamp) {
  if (!timestamp) return '';
  return `${timestamp.slice(0, 10)} ${timestamp.slice(11, 16)} UTC`;
}

export function approvalProgress(intent) {
  const recorded = intent.approvals.filter((approval) => approval.decision === 'approve').length;
  return { recorded, required: intent.required_approvals, text: `${recorded} of ${intent.required_approvals} approvals` };
}

export function decisionLine(intent) {
  const decision = intent.policy_decision;
  if (!decision || decision.policy_revision === null || decision.policy_revision === undefined) return 'No policy';
  const rule = decision.rule ? `${decision.action} by rule ${decision.rule}` : `${decision.action} by default`;
  return `${rule} · Decided under revision ${decision.policy_revision}`;
}

export function destinationCell(intent) {
  if (intent.kind === 'batch') return `${intent.items.length} lines`;
  return shortAddress(intent.destination_address);
}

export function emptyState(text, { id = null } = {}) {
  return `<p class="help" tabindex="-1"${id ? ` id="${h(id)}"` : ''} data-empty-state>${h(text)}</p>`;
}
