import { Access, ProjectRow, levelOf, roleLevels } from './access';
import { Sql } from './db';
import { ApiError, errors } from './errors';
import { branchPatternMatch, globMatch } from './glob';
import { lineDiff } from './diff';

export type PushRules = {
  branch_name: string | null;
  commit_message: string | null;
  forbidden_files: string[];
  required_files: string[];
  secrets: boolean;
};

export const emptyPushRules: PushRules = {
  branch_name: null,
  commit_message: null,
  forbidden_files: [],
  required_files: [],
  secrets: false,
};

export type ProtectedBranch = { pattern: string; allowed_to_push: string; allowed_to_merge: string };

export const secretPatterns: { name: string; pattern: RegExp }[] = [
  { name: 'cloud-key', pattern: /AK[A-Z0-9]{18}/ },
  { name: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'spur-token', pattern: /sptk_[A-Za-z0-9]{20}/ },
  { name: 'password-line', pattern: /password\s*=\s*"[^"]{8,}"/i },
];

export async function pushRulesOf(sql: Sql, projectId: number): Promise<PushRules> {
  const row = await sql.one<{ rules: PushRules }>('select rules from push_rules where project_id = $1', [projectId]);
  return row === null ? { ...emptyPushRules } : { ...emptyPushRules, ...row.rules };
}

export async function protectionFor(
  sql: Sql,
  projectId: number,
  branch: string,
): Promise<ProtectedBranch | null> {
  const rows = await sql.query<ProtectedBranch>(
    'select pattern, allowed_to_push, allowed_to_merge from protected_branches where project_id = $1',
    [projectId],
  );
  const exact = rows.find((row) => row.pattern === branch);
  if (exact !== undefined) return exact;
  return rows.find((row) => branchPatternMatch(row.pattern, branch)) ?? null;
}

export async function tagProtectionFor(
  sql: Sql,
  projectId: number,
  tag: string,
): Promise<{ pattern: string; allowed_to_create: string } | null> {
  const rows = await sql.query<{ pattern: string; allowed_to_create: string }>(
    'select pattern, allowed_to_create from protected_tags where project_id = $1',
    [projectId],
  );
  const exact = rows.find((row) => row.pattern === tag);
  if (exact !== undefined) return exact;
  return rows.find((row) => branchPatternMatch(row.pattern, tag)) ?? null;
}

export async function isProtectedBranch(sql: Sql, projectId: number, branch: string): Promise<boolean> {
  return (await protectionFor(sql, projectId, branch)) !== null;
}

export function protectedBranchError(branch: string, kind: 'push' | 'merge' | 'delete'): ApiError {
  const text =
    kind === 'push'
      ? `You can't push to protected branch ${branch}.`
      : kind === 'merge'
        ? `You can't merge into protected branch ${branch}.`
        : `You can't delete protected branch ${branch}.`;
  return new ApiError(403, 'protected_branch', text);
}

export async function assertCanPush(
  sql: Sql,
  project: ProjectRow,
  access: Access,
  branch: string,
): Promise<void> {
  const protection = await protectionFor(sql, project.id, branch);
  if (protection === null) {
    if (access.level < roleLevels.developer) throw errors.forbidden();
    return;
  }
  if (access.permissions.includes('push_protected')) return;
  if (access.level < levelOf(protection.allowed_to_push)) throw protectedBranchError(branch, 'push');
}

export async function assertCanMerge(
  sql: Sql,
  project: ProjectRow,
  access: Access,
  branch: string,
): Promise<void> {
  const protection = await protectionFor(sql, project.id, branch);
  if (protection === null) {
    if (access.level < roleLevels.developer) throw errors.forbidden();
    return;
  }
  if (access.level < levelOf(protection.allowed_to_merge)) throw protectedBranchError(branch, 'merge');
}

export type PushCheckInput = {
  branch: string;
  isNewBranch: boolean;
  message: string;
  before: Map<string, string>;
  after: Map<string, string>;
};

export function pushRuleFailure(message: string): ApiError {
  return new ApiError(422, 'push_rule', message);
}

export function checkPushRules(rules: PushRules, input: PushCheckInput): ApiError | null {
  if (input.isNewBranch && rules.branch_name !== null && rules.branch_name !== '') {
    if (!new RegExp(rules.branch_name).test(input.branch)) {
      return pushRuleFailure(`Branch name ${input.branch} doesn't match ${rules.branch_name}.`);
    }
  }
  if (rules.commit_message !== null && rules.commit_message !== '') {
    if (!new RegExp(rules.commit_message).test(input.message)) {
      return pushRuleFailure(`Commit message doesn't match ${rules.commit_message}.`);
    }
  }
  const touched = [...input.after.keys()]
    .filter((path) => input.before.get(path) !== input.after.get(path))
    .sort();
  for (const glob of rules.forbidden_files) {
    for (const path of touched) {
      if (globMatch(glob, path)) {
        return pushRuleFailure(`File ${path} is forbidden by push rule ${glob}.`);
      }
    }
  }
  for (const required of rules.required_files) {
    if (!input.after.has(required)) {
      return pushRuleFailure(`Required file ${required} is missing.`);
    }
  }
  if (rules.secrets) {
    for (const path of touched) {
      const before = input.before.get(path) ?? '';
      const after = input.after.get(path) ?? '';
      const added = lineDiff(before === '' ? [] : before.replace(/\n$/, '').split('\n'), after === '' ? [] : after.replace(/\n$/, '').split('\n'))
        .filter((line) => line.type === 'add')
        .map((line) => ({ number: line.new ?? 0, text: line.text }))
        .sort((a, b) => a.number - b.number);
      for (const line of added) {
        for (const secret of secretPatterns) {
          if (secret.pattern.test(line.text)) {
            return pushRuleFailure(`Secret found: ${secret.name} in ${path} at line ${line.number}.`);
          }
        }
      }
    }
  }
  return null;
}

export async function assertPushRules(sql: Sql, projectId: number, input: PushCheckInput): Promise<void> {
  const rules = await pushRulesOf(sql, projectId);
  const failure = checkPushRules(rules, input);
  if (failure !== null) throw failure;
}
