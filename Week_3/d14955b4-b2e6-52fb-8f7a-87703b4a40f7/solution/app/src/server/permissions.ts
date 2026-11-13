import type { Db } from './db.js';
import { ACTIONS, TOPICS } from '../shared/types.js';
import type { Role, RuleAction, RuleBody, RuleTopic, Topic } from '../shared/types.js';

interface Decision {
  allowed: boolean;
  decidedBy: string[];
}

function decide(rules: readonly RuleBody[], action: RuleAction, topic: Topic): Decision {
  const matching = (effect: RuleBody['effect']): string[] =>
    rules.filter((r) => r.effect === effect && r.action === action && (r.topic === topic || r.topic === '*')).map((r) => r.id);
  const denies = matching('deny');
  if (denies.length > 0) return { allowed: false, decidedBy: denies };
  const grants = matching('grant');
  if (grants.length === 0) return { allowed: false, decidedBy: [] };
  if (action !== 'read') {
    const read = decide(rules, 'read', topic);
    if (!read.allowed) return { allowed: false, decidedBy: read.decidedBy };
  }
  return { allowed: true, decidedBy: grants };
}

export interface Viewer {
  role: Role;
  rules: readonly RuleBody[];
}

export function can(viewer: Viewer, action: RuleAction, topic: Topic): boolean {
  return viewer.role === 'developer' || decide(viewer.rules, action, topic).allowed;
}

export function canSee(viewer: Viewer, topic: Topic, purchaseData: boolean): boolean {
  return can(viewer, 'read', topic) && (!purchaseData || can(viewer, 'receipts', topic));
}

export function topicsAllowed(viewer: Viewer, action: RuleAction): Topic[] {
  return TOPICS.filter((topic) => can(viewer, action, topic));
}

export function effectiveEntries(rules: readonly RuleBody[]): { action: RuleAction; topic: Topic; allowed: boolean; decided_by: string[] }[] {
  return ACTIONS.flatMap((action) =>
    TOPICS.map((topic) => {
      const { allowed, decidedBy } = decide(rules, action, topic);
      return { action, topic, allowed, decided_by: decidedBy };
    }),
  );
}

export async function loadRules(db: Db, moderatorIds: string[]): Promise<Map<string, RuleBody[]>> {
  const byModerator = new Map<string, RuleBody[]>(moderatorIds.map((id) => [id, []]));
  if (moderatorIds.length === 0) return byModerator;
  const { rows } = await db.query<{ moderator_id: string; id: string; effect: RuleBody['effect']; action: RuleAction; topic: RuleTopic }>(
    'select moderator_id, id, effect, action, topic from rules where moderator_id = any($1) order by seq',
    [moderatorIds],
  );
  for (const row of rows) byModerator.get(row.moderator_id)?.push({ id: row.id, effect: row.effect, action: row.action, topic: row.topic });
  return byModerator;
}
