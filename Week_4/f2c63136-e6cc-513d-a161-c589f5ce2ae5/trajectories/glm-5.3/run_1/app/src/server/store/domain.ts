import type pg from 'pg';
import type { AppConfig } from '../config.js';
import type { Clock } from '../clock.js';
import type { Storage } from '../storage.js';
import type { Mailer } from '../mail.js';
import type { LiveHub } from '../live.js';
import { contentKey } from '../storage.js';
import { byteOrder, byteLength } from '../../shared/bytes.js';
import { fileLevelApply, type CombinedFile } from '../../shared/rules.js';
import { lineMovement } from '../../shared/lines.js';
import {
  getBranch, getChange, getRevision, insertRevision, revisionFileRows, revisionFileTexts,
  changeCombinedDiff, changeHeadRevision, computeRevisionId, type ChangeRow, type RepoRow, type Tx,
} from './revisions.js';

export interface ServiceDeps {
  db: pg.Pool;
  cfg: AppConfig;
  clock: Clock;
  storage: Storage;
  mailer: Mailer;
  live: LiveHub;
}

/** Sentences for the Review updates region, built in exactly one place each. */
export const Sentences = {
  approval: (n: number, name: string) => `#${n}: ${name} approved`,
  requestChanges: (n: number, name: string) => `#${n}: ${name} requested changes`,
  reviewDismissed: (n: number, name: string) => `#${n}: review by ${name} dismissed`,
  check: (n: number, name: string, state: string) => `#${n}: check ${name} ${state}`,
  newRevision: (n: number, id: string, name: string, kept: boolean) =>
    `#${n}: new revision ${id} from ${name}, approvals ${kept ? 'kept' : 'dismissed'}`,
  restack: (n: number, lower: number, kept: boolean) =>
    `#${n}: restacked onto #${lower}, approvals ${kept ? 'kept' : 'dismissed'}`,
  restackConflict: (n: number, count: number) => `#${n}: restack conflict in ${count} files`,
  notRestacked: (n: number) => `#${n}: not restacked`,
  queuePosition: (n: number, p: number) => `#${n}: queue position ${p}`,
  queueRemoved: (n: number, reason: string) => `#${n}: ${reason}`,
  merged: (n: number) => `#${n} merged`,
  newComment: (n: number, name: string) => `#${n}: new comment from ${name}`,
} as const;

export const CheckStateWords = {
  queued: 'Queued',
  in_progress: 'In progress',
  success: 'Passed',
  failure: 'Failed',
  timed_out: 'Timed out',
} as const;

export function diffSignature(files: CombinedFile[]): string {
  return JSON.stringify(files.map((f) => [f.path, f.status, f.baseText, f.headText]));
}

/**
 * The merge box rules, decided in one place. Returns the unmet rules with
 * their exact texts, in the published fixed order.
 */
export function mergeBoxRules(input: {
  change: ChangeRow;
  repo: RepoRow;
  diff: CombinedFile[];
  conflicting: boolean;
  conflictPaths: string[];
  approvals: Array<{ reviewer: string }>;
  changesRequested: Array<{ name: string }>;
  codeOwnerPaths: string[];
  checks: Array<{ name: string; state: string }>;
}): Array<{ rule: string; text: string }> {
  const rules: Array<{ rule: string; text: string }> = [];
  if (input.change.draft) rules.push({ rule: 'draft', text: 'This change is a draft' });
  if (input.conflicting) {
    rules.push({ rule: 'conflicting', text: `Conflicts with ${input.change.base_branch}: ${input.conflictPaths.join(', ')}` });
  }
  if (input.repo.required_approvals > input.approvals.length) {
    rules.push({ rule: 'approvals', text: `Needs ${input.repo.required_approvals} approvals, has ${input.approvals.length}` });
  }
  if (input.codeOwnerPaths.length > 0) {
    rules.push({ rule: 'code-owners', text: `Needs code owner approval for ${input.codeOwnerPaths.join(', ')}` });
  }
  if (input.changesRequested.length > 0) {
    rules.push({ rule: 'changes-requested', text: `Changes requested by ${input.changesRequested.map((c) => c.name).join(', ')}` });
  }
  const unmet = input.checks.filter((c) => c.state !== 'success');
  if (unmet.length > 0) {
    rules.push({
      rule: 'checks',
      text: `Required checks not passed: ${unmet.map((c) => `${c.name} (${CheckStateWords[c.state as keyof typeof CheckStateWords] ?? c.state})`).join(', ')}`,
    });
  }
  return rules;
}
