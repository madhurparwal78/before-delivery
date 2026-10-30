import { createContactRequest } from '../api/auth.js';
import {
  createApiKey, createMember, createQuorum, patchMember, patchQuorum,
  readWebhookSecret, removeMember, revokeApiKey, rotateWebhookSecret, verifyAuditChain
} from '../api/governance.js';
import { approveIntent, cancelIntent, rejectIntent } from '../api/intents.js';
import { createAggregation, evaluatePolicyRoute, patchPolicy } from '../api/policies.js';
import { createBatch, createTransfer } from '../api/transfers.js';
import { createDeposit, createWallet, freezeWallet, getWalletRoute, unfreezeWallet } from '../api/wallets.js';
import { listAggregations } from '../db/repo.js';
import { formatAmount } from '../domain/amounts.js';
import { ApiError } from '../http/errors.js';
import { BATCH_MESSAGES, SEND_MESSAGES, TOASTS } from './messages.js';
import { statCounts } from './data.js';

function actionContext(session, { params = {}, body = {} } = {}) {
  return {
    method: 'POST',
    path: '',
    params,
    query: new URLSearchParams(),
    headers: {},
    body,
    principal: session.principal,
    organization: session.organization,
    createdBy: session.member.id
  };
}

function text(form, key) {
  const value = form.get(key);
  return value === null ? undefined : value;
}

function optionalId(form, key) {
  const value = form.get(key);
  return value === null || value === '' ? undefined : value;
}

function batchItems(form) {
  const indices = [...form.keys()]
    .map((key) => /^destination_(\d+)$/.exec(key))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
  return indices.map((index) => ({
    destination_address: form.get(`destination_${index}`) ?? '',
    amount: form.get(`amount_${index}`) ?? '',
    memo: form.get(`memo_${index}`) ?? ''
  }));
}

function policyRules(form) {
  const ruleIndices = [...form.keys()]
    .map((key) => /^rule_(\d+)_name$/.exec(key))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
  return ruleIndices.map((ruleIndex) => {
    const conditionIndices = [...form.keys()]
      .map((key) => new RegExp(`^cond_${ruleIndex}_(\\d+)_field_source$`).exec(key))
      .filter(Boolean)
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);
    return {
      name: form.get(`rule_${ruleIndex}_name`) ?? '',
      method: form.get(`rule_${ruleIndex}_method`) ?? '',
      conditions: conditionIndices.map((conditionIndex) => {
        const operator = form.get(`cond_${ruleIndex}_${conditionIndex}_operator`) ?? '';
        const raw = form.get(`cond_${ruleIndex}_${conditionIndex}_value`) ?? '';
        return {
          field_source: form.get(`cond_${ruleIndex}_${conditionIndex}_field_source`) ?? '',
          field: form.get(`cond_${ruleIndex}_${conditionIndex}_field`) ?? '',
          operator,
          value: operator === 'in' ? raw.split(',').map((entry) => entry.trim()).filter(Boolean) : raw
        };
      }),
      action: form.get(`rule_${ruleIndex}_action`) ?? ''
    };
  });
}

function sendResultLine(intent) {
  return intent.status === 'executed' ? SEND_MESSAGES.executed : SEND_MESSAGES.waiting(intent.required_approvals);
}

function batchResultLine(intent) {
  return intent.status === 'executed' ? BATCH_MESSAGES.executed : BATCH_MESSAGES.waiting(intent.required_approvals);
}

/** Turns a policy denial into the pinned send or batch wording. */
export function denialMessage(error, { batch = false } = {}) {
  const rule = error.details.rule;
  if (!batch) return rule ? SEND_MESSAGES.blockedByRule(rule) : SEND_MESSAGES.blockedDefault;
  const line = Number(error.details.index) + 1;
  return rule ? BATCH_MESSAGES.blockedByRule(line, rule) : BATCH_MESSAGES.blockedDefault(line);
}

async function walletView(session, walletId) {
  const answer = await getWalletRoute(actionContext(session, { params: { id: walletId } }));
  return answer.data;
}

function aggregationLines(aggregations, values) {
  return aggregations.map((aggregation) => {
    const raw = values[aggregation.id] ?? '0';
    const display = aggregation.metric === 'count' ? raw : formatAmount(raw, aggregation.asset);
    return `${aggregation.name}: ${display}`;
  });
}

function traceLines(trace) {
  return trace.map((entry) => {
    if (!entry.considered) return `${entry.rule}: skipped (method)`;
    return `${entry.rule}: ${entry.matched ? 'matched' : 'not matched'}`;
  });
}

const ACTIONS = {
  'create-wallet': async (session, form) => {
    const answer = await createWallet(actionContext(session, {
      body: {
        name: text(form, 'name'),
        chain: text(form, 'chain'),
        asset: text(form, 'asset'),
        policy_id: optionalId(form, 'policy_id'),
        quorum_id: optionalId(form, 'quorum_id'),
        approval_floor: text(form, 'approval_floor') || '0'
      }
    }));
    return { toast: TOASTS.walletCreated, view: { wallet: answer.data } };
  },

  send: async (session, form, { walletId }) => {
    const answer = await createTransfer(actionContext(session, {
      params: { id: walletId },
      body: { destination_address: text(form, 'destination_address'), amount: text(form, 'amount'), memo: text(form, 'memo') }
    }));
    return {
      toast: answer.data.status === 'executed' ? TOASTS.transferExecuted : null,
      result: sendResultLine(answer.data),
      view: { wallet: await walletView(session, walletId), intent: answer.data }
    };
  },

  deposit: async (session, form, { walletId }) => {
    await createDeposit(actionContext(session, {
      params: { id: walletId },
      body: { amount: text(form, 'amount'), reference: text(form, 'reference') }
    }));
    return {
      toast: TOASTS.depositRecorded,
      result: TOASTS.depositRecorded,
      view: { wallet: await walletView(session, walletId) }
    };
  },

  batch: async (session, form, { walletId }) => {
    const answer = await createBatch(actionContext(session, {
      params: { id: walletId },
      body: { items: batchItems(form) }
    }));
    return {
      toast: answer.data.status === 'executed' ? TOASTS.batchExecuted : null,
      result: batchResultLine(answer.data),
      view: { wallet: await walletView(session, walletId), intent: answer.data }
    };
  },

  freeze: async (session, form, { walletId }) => {
    await freezeWallet(actionContext(session, { params: { id: walletId } }));
    return { toast: TOASTS.walletFrozen };
  },

  unfreeze: async (session, form, { walletId }) => {
    await unfreezeWallet(actionContext(session, { params: { id: walletId } }));
    return { toast: TOASTS.walletUnfrozen };
  },

  approve: async (session, form) => {
    const answer = await approveIntent(actionContext(session, { params: { id: text(form, 'intent_id') } }));
    const intent = answer.data;
    const recorded = intent.approvals.filter((approval) => approval.decision === 'approve').length;
    const executed = intent.status === 'executed';
    return {
      toast: executed
        ? (intent.kind === 'batch' ? TOASTS.batchExecuted : TOASTS.transferExecuted)
        : TOASTS.approved(recorded, intent.required_approvals),
      view: { intent, stats: await statCounts(session.organization.id, session.member.id) }
    };
  },

  reject: async (session, form) => {
    const answer = await rejectIntent(actionContext(session, {
      params: { id: text(form, 'intent_id') },
      body: { reason: text(form, 'reason') }
    }));
    return {
      toast: TOASTS.intentRejected,
      view: { intent: answer.data, stats: await statCounts(session.organization.id, session.member.id) }
    };
  },

  cancel: async (session, form) => {
    await cancelIntent(actionContext(session, { params: { id: text(form, 'intent_id') } }));
    return { toast: TOASTS.intentCancelled };
  },

  'save-policy': async (session, form, { policyId }) => {
    const answer = await patchPolicy(actionContext(session, { params: { id: policyId }, body: { rules: policyRules(form) } }));
    return { toast: TOASTS.policySaved(answer.data.revision) };
  },

  simulate: async (session, form, { policyId }) => {
    const ctx = actionContext(session, {
      params: { id: policyId },
      body: {
        method: text(form, 'method'),
        wallet_id: text(form, 'wallet_id'),
        destination_address: text(form, 'destination_address'),
        amount: text(form, 'amount')
      }
    });
    const answer = await evaluatePolicyRoute(ctx);
    const aggregations = await listAggregations(null, session.organization.id);
    const referenced = aggregations.filter((aggregation) => answer.data.aggregations[aggregation.id] !== undefined);
    return {
      view: {
        simulation: {
          action: answer.data.action,
          rule: answer.data.rule,
          policy_revision: answer.data.policy_revision,
          aggregationLines: aggregationLines(referenced, answer.data.aggregations),
          trace: traceLines(answer.data.trace)
        }
      }
    };
  },

  'create-quorum': async (session, form) => {
    await createQuorum(actionContext(session, {
      body: {
        name: text(form, 'name'),
        member_ids: form.getAll('member_ids'),
        authorization_threshold: Number(text(form, 'authorization_threshold')),
        expiry_seconds: Number(text(form, 'expiry_seconds'))
      }
    }));
    return { toast: TOASTS.quorumSaved };
  },

  'edit-quorum': async (session, form) => {
    await patchQuorum(actionContext(session, {
      params: { id: text(form, 'quorum_id') },
      body: {
        name: text(form, 'name'),
        member_ids: form.getAll('member_ids'),
        authorization_threshold: Number(text(form, 'authorization_threshold')),
        expiry_seconds: Number(text(form, 'expiry_seconds'))
      }
    }));
    return { toast: TOASTS.quorumSaved };
  },

  'create-aggregation': async (session, form) => {
    await createAggregation(actionContext(session, {
      body: {
        name: text(form, 'name'),
        metric: text(form, 'metric'),
        window_seconds: Number(text(form, 'window_seconds')),
        asset: text(form, 'asset'),
        group_by: text(form, 'group_by')
      }
    }));
    return { toast: TOASTS.aggregationCreated };
  },

  'add-member': async (session, form) => {
    await createMember(actionContext(session, {
      body: { name: text(form, 'name'), email: text(form, 'email'), role: text(form, 'role'), password: text(form, 'password') }
    }));
    return { toast: TOASTS.memberAdded };
  },

  'update-member': async (session, form) => {
    await patchMember(actionContext(session, { params: { id: text(form, 'member_id') }, body: { role: text(form, 'role') } }));
    return { toast: TOASTS.memberUpdated };
  },

  'remove-member': async (session, form) => {
    await removeMember(actionContext(session, { params: { id: text(form, 'member_id') } }));
    return { toast: TOASTS.memberRemoved };
  },

  'create-api-key': async (session, form) => {
    const answer = await createApiKey(actionContext(session, { body: { name: text(form, 'name'), role: text(form, 'role') } }));
    return { toast: TOASTS.apiKeyCreated, view: { secret: answer.data.secret }, stay: true };
  },

  'revoke-api-key': async (session, form) => {
    await revokeApiKey(actionContext(session, { params: { id: text(form, 'api_key_id') } }));
    return { toast: TOASTS.apiKeyRevoked };
  },

  'reveal-secret': async (session) => {
    const answer = await readWebhookSecret(actionContext(session));
    return { view: { secret: answer.data.secret }, stay: true };
  },

  'rotate-secret': async (session) => {
    const answer = await rotateWebhookSecret(actionContext(session));
    return { toast: TOASTS.secretRotated, view: { secret: answer.data.secret }, stay: true };
  },

  'verify-chain': async (session) => {
    const answer = await verifyAuditChain(actionContext(session));
    return { view: { chain: answer.data }, stay: true };
  },

  contact: async (session, form) => {
    await createContactRequest({
      body: {
        full_name: text(form, 'full_name'),
        work_email: text(form, 'work_email'),
        company: text(form, 'company'),
        monthly_volume: text(form, 'monthly_volume'),
        message: text(form, 'message')
      }
    });
    return { sent: true };
  }
};

export async function runAction(name, session, form, context = {}) {
  const action = ACTIONS[name];
  if (!action) throw new ApiError('NOT_FOUND');
  return action(session, form, context);
}
