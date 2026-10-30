export const SEND_MESSAGES = {
  executed: 'Transfer executed',
  waiting: (required) => `Waiting for approval: 0 of ${required} approvals`,
  blockedByRule: (rule) => `Blocked by policy rule ${rule}`,
  blockedDefault: 'Blocked by policy: no rule allowed this transfer'
};

export const BATCH_MESSAGES = {
  executed: 'Batch executed',
  waiting: (required) => `Batch waiting for approval: 0 of ${required} approvals`,
  blockedByRule: (line, rule) => `Line ${line} blocked by policy rule ${rule}`,
  blockedDefault: (line) => `Line ${line} blocked by policy: no rule allowed it`
};

export const TOASTS = {
  walletCreated: 'Wallet created',
  walletFrozen: 'Wallet frozen',
  walletUnfrozen: 'Wallet unfrozen',
  approved: (recorded, required) => `Approved: ${recorded} of ${required} approvals`,
  transferExecuted: 'Transfer executed',
  batchExecuted: 'Batch executed',
  intentRejected: 'Intent rejected',
  intentCancelled: 'Intent cancelled',
  depositRecorded: 'Deposit recorded',
  policySaved: (revision) => `Policy saved, revision ${revision}`,
  quorumSaved: 'Key quorum saved',
  aggregationCreated: 'Aggregation created',
  memberAdded: 'Member added',
  memberUpdated: 'Member updated',
  memberRemoved: 'Member removed',
  apiKeyCreated: 'API key created',
  apiKeyRevoked: 'API key revoked',
  secretRotated: 'Signing secret rotated',
  addressCopied: 'Address copied'
};

export const DATABASE_OUTAGE = "Corvo can't reach its database. Nothing was changed. Try again in a moment.";
export const NO_ACCESS = 'You do not have access to this page';
export const NOT_FOUND_TEXT = 'Not found';
