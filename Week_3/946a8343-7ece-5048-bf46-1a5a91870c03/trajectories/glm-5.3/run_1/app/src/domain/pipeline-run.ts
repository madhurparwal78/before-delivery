import type { PoolClient } from 'pg';
import type { Ctx } from '../api/ctx.js';
import { parseYaml, toJson, type Json, type YList, type YMap, type YNode, type YScalar } from './yaml.js';
import { globMatch } from './push-rules.js';
import { splitLines, readTreeFlat, getCommit } from './repo.js';
import { PIPELINE_FILE } from '../core/config.js';
import {
  evaluateCondition, evaluateRule, expandVariables, getNodeMap, scalarList, lintPipeline, type JobConfig, type LintError,
} from './pipeline-config.js';

export interface JobPlan {
  name: string;
  stage: string;
  stageIndex: number;
  configIndex: number;
  needs: string[];
  dependencies: string[] | null;
  when: string;
  allow_failure: boolean;
  retry: number;
  retryWhen: string[];
  timeoutMs: number | null;
  interruptible: boolean;
  resourceGroup: string | null;
  variables: Record<string, string>;
  script: string[];
  artifacts: { paths: string[]; expireIn: string | undefined; when: string };
  cache: { key: string | undefined; fallbackKeys: string[]; paths: string[]; policy: string };
  environment: { name: string; action: string | undefined; autoStopIn: string | undefined; onStop: string | undefined; tier: string | undefined } | null;
  matrixValues: Record<string, string>;
  startIn: string | undefined;
}

export interface PipelinePlan {
  created: boolean;
  reason?: string;
  errors: string[];
  stages: string[];
  jobs: JobPlan[];
}

export interface PlanContext {
  projectId: number;
  projectPath: string;
  ref: string;
  sha: string;
  source: 'push' | 'train' | 'web';
  branch: string;
  defaultBranch: string;
  commitMessage: string;
  variables: Record<string, string>;
  mrIid: number | null;
  mrSource: string | null;
  mrTarget: string | null;
  changedFiles: string[] | null;
  configText: string | null;
  existsPaths: string[];
}

export function planPipeline(ctx: Ctx, pc: PlanContext): PipelinePlan {
  void ctx;
  if (pc.configText === null) {
    return { created: false, reason: 'no config', errors: [], stages: [], jobs: [] };
  }
  const loader = (path: string): string | null => {
    if (path === PIPELINE_FILE) return pc.configText;
    return null;
  };
  const lint = lintPipeline(pc.configText, loader, { retryMax: 2 });
  if (!lint.valid) {
    return { created: true, reason: undefined, errors: lint.errors.map((e) => e.message), stages: [], jobs: [] };
  }
  const raw = lint.raw!;
  // workflow rules
  const wfVars = { ...pc.variables };
  if (raw.hasWorkflowRules) {
    let include = false;
    for (const rule of raw.workflowRules) {
      if (evaluateRule({ if: rule.if, changes: rule.changes, exists: rule.exists }, { variables: wfVars, changedFiles: pc.changedFiles, existsPaths: pc.existsPaths })) {
        include = true;
      }
    }
    if (!include) {
      return { created: false, reason: 'workflow rules excluded it', errors: [], stages: [], jobs: [] };
    }
  }
  const jobs: JobPlan[] = [];
  let idx = 0;
  for (const [name, cfg] of raw.jobs) {
    if (name.startsWith('.')) continue;
    const expansions = expandMatrix(cfg);
    for (const [expName, matrixValues] of expansions) {
      const included = jobIncluded(cfg, expName, matrixValues, pc, raw);
      if (!included) continue;
      jobs.push(toPlan(cfg, expName, matrixValues, idx, raw.stages, pc));
      idx++;
    }
  }
  if (jobs.length === 0) {
    return { created: false, reason: 'no jobs matched', errors: [], stages: [], jobs: [] };
  }
  return { created: true, errors: [], stages: raw.stages, jobs };
}

function jobIncluded(cfg: JobConfig, name: string, matrixValues: Record<string, string>, pc: PlanContext, raw: NonNullable<ReturnType<typeof lintPipeline>['raw']>): boolean {
  void name;
  void raw;
  if (!cfg.hasRules) return true;
  const vars = { ...pc.variables, ...matrixValues };
  for (const rule of cfg.rules) {
    if (evaluateRule({ if: rule.if, changes: rule.changes, exists: rule.exists }, { variables: vars, changedFiles: pc.changedFiles, existsPaths: pc.existsPaths })) {
      return rule.when !== 'never';
    }
  }
  return false;
}

function expandMatrix(cfg: JobConfig): Array<[string, Record<string, string>]> {
  const keys = Object.keys(cfg.matrix);
  if (keys.length === 0) return [[cfg.name, {}]];
  const combos: Array<Record<string, string>> = [];
  const build = (i: number, acc: Record<string, string>): void => {
    if (i === keys.length) {
      combos.push({ ...acc });
      return;
    }
    const k = keys[i];
    for (const v of cfg.matrix[k]) {
      acc[k] = v;
      build(i + 1, acc);
    }
  };
  build(0, {});
  return combos.map((m) => {
    const label = keys.map((k) => m[k]).join(', ');
    return [`${cfg.name} [${label}]`, m] as [string, Record<string, string>];
  });
}

function toPlan(cfg: JobConfig, name: string, matrixValues: Record<string, string>, idx: number, stages: string[], pc: PlanContext): JobPlan {
  const stageIndex = stages.indexOf(cfg.stage);
  let when = cfg.when;
  if (cfg.hasRules) {
    when = 'on_success';
    for (const rule of cfg.rules) {
      if (evaluateRule({ if: rule.if, changes: rule.changes, exists: rule.exists }, { variables: { ...pc.variables, ...matrixValues }, changedFiles: pc.changedFiles, existsPaths: pc.existsPaths })) {
        when = rule.when ?? 'on_success';
        break;
      }
    }
  }
  let needs = cfg.needs;
  if (needs.length === 0) needs = [];
  const expandedNeeds = expandNeeds(cfg, needs);
  const timeoutMs = cfg.timeout ? parseDuration(cfg.timeout) : null;
  return {
    name,
    stage: cfg.stage,
    stageIndex,
    configIndex: idx,
    needs: expandedNeeds,
    dependencies: cfg.dependencies,
    when,
    allow_failure: cfg.allow_failure,
    retry: cfg.retry,
    retryWhen: cfg.retryWhen,
    timeoutMs,
    interruptible: cfg.interruptible,
    resourceGroup: cfg.resource_group ?? null,
    variables: { ...cfg.variables, ...matrixValues },
    script: cfg.script,
    artifacts: { paths: cfg.artifacts.paths, expireIn: cfg.artifacts.expire_in, when: cfg.artifacts.when },
    cache: { key: cfg.cache.key, fallbackKeys: cfg.cache.fallback_keys, paths: cfg.cache.paths, policy: cfg.cache.policy },
    environment: cfg.environment ? { name: cfg.environment.name, action: cfg.environment.action, autoStopIn: cfg.environment.auto_stop_in, onStop: cfg.environment.on_stop, tier: cfg.environment.tier } : null,
    matrixValues,
    startIn: cfg.start_in,
  };
}

function expandNeeds(cfg: JobConfig, needs: string[]): string[] {
  void cfg;
  return needs;
}

function parseDuration(s: string): number | null {
  const m = s.trim().match(/^(\d+)(ms|s|m|h)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (m[2] === 'ms') return n;
  if (m[2] === 's') return n * 1000;
  if (m[2] === 'm') return n * 60_000;
  return n * 3_600_000;
}

// ---- Layer/row/x/y ----

export function layoutGraph(jobs: Array<{ name: string; stageIndex: number; needs: string[] }>): Array<{ layer: number; row: number; x: number; y: number }> {
  const byName = new Map(jobs.map((j) => [j.name, j]));
  const layerOf = new Map<string, number>();
  const layerFor = (name: string, seen: Set<string>): number => {
    const j = byName.get(name);
    if (!j) return j === undefined ? 0 : 0;
    if (layerOf.has(name)) return layerOf.get(name)!;
    if (seen.has(name)) return 0;
    seen.add(name);
    let layer = j.stageIndex;
    for (const need of j.needs) {
      const l = layerFor(need, seen);
      layer = Math.max(layer, l + 1);
    }
    layerOf.set(name, layer);
    return layer;
  };
  for (const j of jobs) {
    layerOf.set(j.name, layerFor(j.name, new Set()));
  }
  // rows: within layer, by stage index then config order
  const byLayer = new Map<number, Array<{ name: string; stageIndex: number; configIndex: number }>>();
  jobs.forEach((j, i) => {
    const layer = layerOf.get(j.name) ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push({ name: j.name, stageIndex: j.stageIndex, configIndex: i });
  });
  const out: Array<{ layer: number; row: number; x: number; y: number }> = [];
  for (const j of jobs) {
    const layer = layerOf.get(j.name) ?? 0;
    const rows = byLayer.get(layer)!.slice().sort((a, b) => a.stageIndex - b.stageIndex || a.configIndex - b.configIndex);
    const row = rows.findIndex((r) => r.name === j.name);
    out.push({ layer, row, x: 40 + layer * 240, y: 40 + row * 96 });
  }
  return out;
}

// ---- Job runtime helpers ----

export interface LogLine {
  n: number;
  stream: 'out' | 'sys';
  text: string;
}

export class JobLogWriter {
  private lines: LogLine[] = [];

  add(stream: 'out' | 'sys', text: string): void {
    this.lines.push({ n: this.lines.length + 1, stream, text });
  }

  all(): LogLine[] {
    return this.lines;
  }

  formatted(): string[] {
    return this.lines.map((l) => `${l.n} ${l.stream} ${l.text}`);
  }
}

export function sectionStart(name: string): string {
  return `section_start ${name}`;
}

export function sectionEnd(name: string): string {
  return `section_end ${name}`;
}

export function formatDurationText(startedAt: number | null, finishedAt: number | null, now: number): string {
  if (startedAt === null) return 'not started';
  const end = finishedAt ?? now;
  const secs = Math.max(0, Math.round((end - startedAt) / 1000));
  if (finishedAt === null) return 'in progress';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export function expandScript(script: string[], vars: Record<string, string>): string[] {
  return script.map((cmd) => expandVariables(cmd, vars));
}

export interface CommandRun {
  kind: 'print' | 'write' | 'wait' | 'exit' | 'emit' | 'unknown';
  text: string;
}

export function parseCommand(cmd: string): CommandRun {
  const trimmed = cmd.trim();
  if (trimmed.startsWith('print ')) return { kind: 'print', text: trimmed.slice(6) };
  if (trimmed === 'print') return { kind: 'print', text: '' };
  if (trimmed.startsWith('write ')) {
    const rest = trimmed.slice(6);
    const sp = rest.indexOf(' ');
    if (sp < 0) return { kind: 'write', text: rest };
    return { kind: 'write', text: rest };
  }
  if (trimmed.startsWith('wait ')) return { kind: 'wait', text: trimmed.slice(5) };
  if (trimmed.startsWith('exit ')) return { kind: 'exit', text: trimmed.slice(5) };
  if (trimmed === 'exit') return { kind: 'exit', text: '0' };
  if (trimmed.startsWith('emit ')) return { kind: 'emit', text: trimmed.slice(5) };
  return { kind: 'unknown', text: trimmed };
}

export function writeCommandTarget(cmd: string): { path: string; text: string } | null {
  const rest = cmd.trim().slice(6);
  const sp = rest.indexOf(' ');
  if (sp < 0) return { path: rest, text: '' };
  return { path: rest.slice(0, sp), text: rest.slice(sp + 1) };
}

export function emitCommandParts(cmd: string): { kind: string; path: string } | null {
  const rest = cmd.trim().slice(5).trim();
  const sp = rest.indexOf(' ');
  if (sp < 0) return null;
  return { kind: rest.slice(0, sp), path: rest.slice(sp + 1) };
}

export { globMatch, splitLines, readTreeFlat, getCommit };
export { parseYaml, toJson };
export type { Json, YNode, YMap, YScalar, YList };
export type { JobConfig, LintError };
export { getNodeMap, scalarList, evaluateCondition, evaluateRule, expandVariables, lintPipeline };
