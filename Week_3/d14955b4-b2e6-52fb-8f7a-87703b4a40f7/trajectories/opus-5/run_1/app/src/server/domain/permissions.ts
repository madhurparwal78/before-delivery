import { TOPICS, type Rule, type RuleAction, type StaffRole, type Topic } from '../../shared/types';

export interface Caller {
  staffId: string;
  gameId: string;
  name: string;
  role: StaffRole;
  /** Ordered by creation. */
  rules: Rule[];
}

export interface Decision {
  allowed: boolean;
  decidedBy: string[];
}

/** The one deny-over-grant decision. */
export function decide(rules: readonly Rule[], action: RuleAction, topic: Topic): Decision {
  const matching = rules.filter((rule) => rule.action === action && (rule.topic === topic || rule.topic === '*'));
  const denies = matching.filter((rule) => rule.effect === 'deny');
  if (denies.length > 0) return { allowed: false, decidedBy: denies.map((rule) => rule.id) };
  const grants = matching.filter((rule) => rule.effect === 'grant');
  if (grants.length === 0) return { allowed: false, decidedBy: [] };
  if (action !== 'read') {
    const read = decide(rules, 'read', topic);
    if (!read.allowed) return { allowed: false, decidedBy: read.decidedBy };
  }
  return { allowed: true, decidedBy: grants.map((rule) => rule.id) };
}

export function may(caller: Caller, action: RuleAction, topic: Topic): boolean {
  if (caller.role === 'developer') return true;
  return decide(caller.rules, action, topic).allowed;
}

export function permittedTopics(caller: Caller, action: RuleAction): Topic[] {
  return TOPICS.filter((topic) => may(caller, action, topic));
}


