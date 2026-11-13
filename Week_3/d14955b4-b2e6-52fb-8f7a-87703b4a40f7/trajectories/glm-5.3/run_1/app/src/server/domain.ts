// Domain vocabulary for staff actions, topics and rules.
export type Topic = 'bug' | 'account' | 'purchase' | 'other';
export type RuleTopic = Topic | '*';
export type Action = 'read' | 'reply' | 'close' | 'receipts';
export type Effect = 'grant' | 'deny';
export type Role = 'developer' | 'moderator';
export type ThreadStatus = 'waiting' | 'answered' | 'closed';

export const TOPICS: Topic[] = ['bug', 'account', 'purchase', 'other'];
export const ACTIONS: Action[] = ['read', 'reply', 'close', 'receipts'];
export const EFFECTS: Effect[] = ['grant', 'deny'];

export interface StoredRule {
  id: string;
  effect: Effect;
  action: Action;
  topic: RuleTopic;
  position: number;
}

export const RULE_TOPIC_LABELS: Record<RuleTopic, string> = {
  '*': 'all topics',
  bug: 'bug threads',
  account: 'account threads',
  purchase: 'purchase threads',
  other: 'other threads',
};

export const TOPIC_LABELS: Record<Topic, string> = {
  bug: 'bug',
  account: 'account',
  purchase: 'purchase',
  other: 'other',
};

export function topicWords(topic: RuleTopic): string {
  return RULE_TOPIC_LABELS[topic];
}

export function ruleText(rule: { effect: Effect; action: Action; topic: RuleTopic }): string {
  return `${rule.effect} ${rule.action} on ${topicWords(rule.topic)}`;
}

function ruleMatches(rule: StoredRule, action: Action, topic: Topic, effect: Effect): boolean {
  return rule.effect === effect && rule.action === action && (rule.topic === '*' || rule.topic === topic);
}

export interface PermissionDecision {
  allowed: boolean;
  decidedBy: string[];
}

/**
 * The one deny-over-grant decision. Every route and derived surface uses it.
 */
export function decide(rules: StoredRule[], action: Action, topic: Topic): PermissionDecision {
  const denies = rules.filter((rule) => ruleMatches(rule, action, topic, 'deny'));
  if (denies.length > 0) {
    return { allowed: false, decidedBy: denies.map((rule) => rule.id) };
  }
  const grants = rules.filter((rule) => ruleMatches(rule, action, topic, 'grant'));
  if (grants.length === 0) {
    return { allowed: false, decidedBy: [] };
  }
  if (action !== 'read') {
    const read = decide(rules, 'read', topic);
    if (!read.allowed) return { allowed: false, decidedBy: read.decidedBy };
  }
  return { allowed: true, decidedBy: grants.map((rule) => rule.id) };
}

export interface EffectiveEntry {
  action: Action;
  topic: Topic;
  allowed: boolean;
  decided_by: string[];
}

export function effectivePermissions(rules: StoredRule[]): EffectiveEntry[] {
  const entries: EffectiveEntry[] = [];
  for (const action of ACTIONS) {
    for (const topic of TOPICS) {
      const decision = decide(rules, action, topic);
      entries.push({ action, topic, allowed: decision.allowed, decided_by: decision.decidedBy });
    }
  }
  return entries;
}
