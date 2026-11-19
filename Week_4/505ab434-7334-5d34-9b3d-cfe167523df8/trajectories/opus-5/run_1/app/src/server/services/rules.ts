import type { RuleView } from '../../shared/types.js';
import { db, type Queryable } from '../db.js';
import { repo } from '../repo.js';

export interface LiveRule {
  identifier: string;
  chapter: string;
  text: string;
  version: number;
}

export async function liveRules(source: Queryable = db): Promise<LiveRule[]> {
  const versions = await repo.publishedVersions(source);
  const rules: LiveRule[] = [];
  for (const version of versions) {
    for (const statement of version.statements) {
      rules.push({
        identifier: statement.identifier,
        chapter: version.slug,
        text: statement.text,
        version: version.number,
      });
    }
  }
  return rules;
}

export async function ruleStatuses(
  identifiers: string[],
  source: Queryable = db,
): Promise<Map<string, 'live' | 'withdrawn' | 'unknown'>> {
  const live = new Set((await liveRules(source)).map((rule) => rule.identifier));
  const statuses = new Map<string, 'live' | 'withdrawn' | 'unknown'>();
  for (const identifier of identifiers) {
    statuses.set(identifier, live.has(identifier) ? 'live' : 'withdrawn');
  }
  return statuses;
}

export async function resolveRule(identifier: string, source: Queryable = db): Promise<RuleView | null> {
  const live = (await liveRules(source)).find((rule) => rule.identifier === identifier);
  if (live) {
    return { identifier, status: 'live', chapter: live.chapter, text: live.text };
  }
  const versions = await repo.versions(source);
  const withdrawnIn = versions
    .filter((version) => version.state === 'published' || version.state === 'superseded')
    .sort((left, right) => right.number - left.number)
    .find((version) => version.withdrawn.some((entry) => entry.identifier === identifier));
  if (!withdrawnIn) return null;
  const entry = withdrawnIn.withdrawn.find((candidate) => candidate.identifier === identifier)!;
  return {
    identifier,
    status: 'withdrawn',
    withdrawnInVersion: withdrawnIn.number,
    replacedBy: entry.replacedBy,
  };
}

export async function chapterOfRule(identifier: string, source: Queryable = db): Promise<string | null> {
  const live = (await liveRules(source)).find((rule) => rule.identifier === identifier);
  if (live) return live.chapter;
  const versions = await repo.versions(source);
  const owner = versions.find((version) => version.withdrawn.some((entry) => entry.identifier === identifier));
  return owner?.slug ?? null;
}
