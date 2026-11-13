import type { Action, Effect, RuleTopic } from '../server/domain';

export function ruleText(rule: { effect: string; action: string; topic: string }): string {
  const topicWords = rule.topic === '*' ? 'all topics' : `${rule.topic} threads`;
  return `${rule.effect} ${rule.action} on ${topicWords}`;
}

export type RuleFields = { effect: Effect; action: Action; topic: RuleTopic };
