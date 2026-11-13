import type { DbClient } from '../db/db.js';

export interface PushRulesRow {
  branch_name: string | null;
  commit_message: string | null;
  forbidden_files: string[];
  required_files: string[];
  secrets: boolean;
}

export interface ProtectionRow {
  pattern: string;
  allowed_to_push: string;
  allowed_to_merge: string;
}

export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'cloud-key', re: /AK[A-Z0-9]{18}/ },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'spur-token', re: /sptk_[A-Za-z0-9]{20}/ },
  { name: 'password-line', re: /password\s*=\s*"[^"]{8,}"/i },
];

export function matchesPattern(pattern: string, name: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map(escapeRe).join('.*')}$`);
  return re.test(name);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function ownersGlobToRe(pattern: string): RegExp {
  let anchored = false;
  let p = pattern;
  if (p.startsWith('/')) {
    anchored = true;
    p = p.slice(1);
  }
  let re = '';
  const segs = p.split('/');
  const endsWithSlash = pattern.endsWith('/');
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === '**') {
      re += '.*';
      continue;
    }
    let part = seg.split('*').map(escapeRe).join('[^/]*');
    re += part;
    if (i < segs.length - 1) re += '/';
  }
  if (endsWithSlash) re += '.*';
  if (!anchored) re = `(^|.*/)${re}`;
  return new RegExp(`^${re}$`);
}

export function globToRe(pattern: string): RegExp {
  // pipeline rules `changes`/`exists` use owners-file glob syntax
  return ownersGlobToRe(pattern);
}

export function globMatch(pattern: string, path: string): boolean {
  return ownersGlobToRe(pattern).test(path);
}

export interface PushContext {
  branch: string;
  isNewBranch: boolean;
  message: string;
  changedFiles: string[]; // added or changed paths
  resultingTree: string[];
  addedLines: Array<{ path: string; line: number; text: string }>;
}

export interface PushVerdict {
  ok: boolean;
  code?: string;
  status?: number;
  message?: string;
}

export async function pushRulesFor(c: DbClient, projectId: number): Promise<PushRulesRow | null> {
  const r = await c.query<PushRulesRow>(`SELECT branch_name, commit_message, forbidden_files, required_files, secrets FROM push_rules WHERE project_id = $1`, [projectId]);
  return r.rows[0] ?? null;
}

export async function protectedBranchesFor(c: DbClient, projectId: number): Promise<ProtectionRow[]> {
  const r = await c.query<ProtectionRow>(`SELECT pattern, allowed_to_push, allowed_to_merge FROM protected_branches WHERE project_id = $1`, [projectId]);
  return r.rows;
}

export async function protectedTagsFor(c: DbClient, projectId: number): Promise<Array<{ pattern: string; allowed_to_create: string }>> {
  const r = await c.query<{ pattern: string; allowed_to_create: string }>(`SELECT pattern, allowed_to_create FROM protected_tags WHERE project_id = $1`, [projectId]);
  return r.rows;
}

export async function protectionFor(c: DbClient, projectId: number, branch: string): Promise<ProtectionRow | null> {
  const rows = await protectedBranchesFor(c, projectId);
  for (const row of rows) {
    if (matchesPattern(row.pattern, branch)) return row;
  }
  return null;
}

/** The single push-rule order: branch name, commit message, forbidden files, required files, secrets. */
export function evaluatePushRules(rules: PushRulesRow, ctx: PushContext): PushVerdict {
  if (rules.branch_name && ctx.isNewBranch) {
    if (!new RegExp(rules.branch_name).test(ctx.branch)) {
      return { ok: false, code: 'push_rule', status: 422, message: `Branch name ${ctx.branch} doesn't match ${rules.branch_name}.` };
    }
  }
  if (rules.commit_message) {
    if (!new RegExp(rules.commit_message).test(ctx.message)) {
      return { ok: false, code: 'push_rule', status: 422, message: `Commit message doesn't match ${rules.commit_message}.` };
    }
  }
  for (const glob of rules.forbidden_files) {
    for (const f of ctx.changedFiles) {
      if (globMatch(glob, f)) {
        return { ok: false, code: 'push_rule', status: 422, message: `File ${f} is forbidden by push rule ${glob}.` };
      }
    }
  }
  for (const req of rules.required_files) {
    if (!ctx.resultingTree.includes(req)) {
      return { ok: false, code: 'push_rule', status: 422, message: `Required file ${req} is missing.` };
    }
  }
  if (rules.secrets) {
    for (const line of ctx.addedLines) {
      for (const pat of SECRET_PATTERNS) {
        if (pat.re.test(line.text)) {
          return { ok: false, code: 'push_rule', status: 422, message: `Secret found: ${pat.name} in ${line.path} at line ${line.line}.` };
        }
      }
    }
  }
  return { ok: true };
}
