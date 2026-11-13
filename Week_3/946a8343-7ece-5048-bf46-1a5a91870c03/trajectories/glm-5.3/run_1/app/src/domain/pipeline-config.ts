import { parseYaml, YParseError, toJson, type Json, type YList, type YMap, type YNode, type YScalar } from './yaml.js';
import { parseDurationMs } from '../core/util.js';
import { globMatch } from './push-rules.js';

export interface JobConfig {
  name: string;
  stage: string;
  script: string[];
  needs: string[];
  dependencies: string[] | null;
  rules: Array<{ if?: string; changes?: string[]; exists?: string[]; when?: string; allow_failure?: boolean; variables?: Record<string, string>; start_in?: string }>;
  hasRules: boolean;
  when: string;
  start_in?: string;
  allow_failure: boolean;
  retry: number;
  retryWhen: string[];
  timeout?: string;
  interruptible: boolean;
  resource_group?: string;
  variables: Record<string, string>;
  matrix: Record<string, string[]>;
  artifacts: { paths: string[]; expire_in?: string; when: string };
  cache: { key?: string; fallback_keys: string[]; paths: string[]; policy: string };
  environment?: { name: string; action?: string; auto_stop_in?: string; on_stop?: string; tier?: string };
  line: number;
}

export interface RawPipeline {
  stages: string[];
  default: Record<string, Json>;
  variables: Record<string, string>;
  workflowRules: Array<{ if?: string; changes?: string[]; exists?: string[] }>;
  hasWorkflowRules: boolean;
  jobs: Map<string, JobConfig>;
  jobLines: Map<string, number>;
  valid: boolean;
  errors: LintError[];
}

export interface LintError {
  line: number;
  message: string;
}

export const DEFAULT_STAGES = ['build', 'test', 'deploy'];

type FileLoader = (path: string) => string | null;

export function lintPipeline(content: string, fileLoader: FileLoader, opts: { retryMax: number; variables?: Record<string, string>; changedFiles?: string[]; refExists?: (glob: string) => boolean }): { valid: boolean; errors: LintError[]; raw: RawPipeline | null } {
  const errors: LintError[] = [];
  const main = parseYaml(content);
  let mainDoc: YMap | null = null;
  if ('error' in main) {
    errors.push({ line: main.error.line, message: `Line ${main.error.line}: can't read this line.` });
    return { valid: false, errors, raw: null };
  }
  mainDoc = main.value && typeof main.value === 'object' && (main.value as YNode).kind === 'map' ? (main.value as YMap) : null;
  if (!mainDoc) mainDoc = { kind: 'map', value: new Map(), keyLine: new Map(), line: 1 };

  // Load includes depth-first
  const includeMap = new Map<string, { doc: YMap; mainLine: number }>();
  const loadingChain: string[] = [];
  const cycleErrors: LintError[] = [];
  const includeItems: Array<{ path: string; line: number }> = [];

  const topLevelInclude = mainDoc.value.get('include');
  if (topLevelInclude) {
    const incLine = mainDoc.keyLine.get('include') ?? 1;
    if (topLevelInclude.kind === 'list') {
      for (const item of (topLevelInclude as YList).value) {
        if (item.kind === 'scalar' && typeof (item as YScalar).value === 'string') {
          includeItems.push({ path: (item as YScalar).value as string, line: incLine });
        }
      }
    } else if (topLevelInclude.kind === 'scalar' && typeof (topLevelInclude as YScalar).value === 'string') {
      includeItems.push({ path: (topLevelInclude as YScalar).value as string, line: incLine });
    }
  }

  function loadIncludes(items: Array<{ path: string; line: number }>, chain: string[], isTop: boolean): void {
    for (const item of items) {
      const key = item.path;
      const text = fileLoader(key);
      if (text === null) {
        errors.push({ line: item.line, message: `Line ${item.line}: include "${key}" not found.` });
        continue;
      }
      if (chain.includes(key)) {
        const startIdx = chain.indexOf(key);
        const cycle = [...chain.slice(startIdx), key];
        if (!cycleErrors.some((e) => e.message.includes(cycle.join(' -> ')))) {
          const line = isTop ? item.line : item.line;
          cycleErrors.push({ line, message: `Line ${line}: include cycle: ${cycle.join(' -> ')}.` });
        }
        continue;
      }
      const parsed = parseYaml(text);
      if ('error' in parsed) {
        errors.push({ line: item.line, message: `Line ${item.line}: can't read this line.` });
        continue;
      }
      const doc = parsed.value && typeof parsed.value === 'object' && (parsed.value as YNode).kind === 'map' ? (parsed.value as YMap) : { kind: 'map' as const, value: new Map<string, YNode>(), keyLine: new Map<string, number>(), line: 1 };
      // process nested includes
      const nestedInc = doc.value.get('include');
      if (nestedInc) {
        const nestedItems: Array<{ path: string; line: number }> = [];
        const incLine = doc.keyLine.get('include') ?? 1;
        void incLine;
        if (nestedInc.kind === 'list') {
          for (const it of (nestedInc as YList).value) {
            if (it.kind === 'scalar' && typeof (it as YScalar).value === 'string') nestedItems.push({ path: (it as YScalar).value as string, line: item.line });
          }
        } else if (nestedInc.kind === 'scalar' && typeof (nestedInc as YScalar).value === 'string') {
          nestedItems.push({ path: (nestedInc as YScalar).value as string, line: item.line });
        }
        loadIncludes(nestedItems, [...chain, key], false);
      }
      includeMap.set(key, { doc, mainLine: item.line });
    }
  }

  loadIncludes(includeItems, [], true);
  errors.push(...cycleErrors);

  // Merge: later files over earlier, then main over all
  const order: Array<{ doc: YMap; line: number; path: string | null }> = [];
  for (const [path, { doc, mainLine }] of includeMap) {
    void path;
    order.push({ doc, line: mainLine, path: null });
  }
  order.push({ doc: mainDoc, line: 1, path: null });

  const merged = new Map<string, { node: YNode | YScalar; line: number }>();
  for (const { doc } of order) {
    for (const [k, v] of doc.value.entries()) {
      merged.set(k, { node: v, line: doc.keyLine.get(k) ?? 1 });
    }
  }

  const stages = readStages(merged.get('stages')?.node);
  const defaultMap = readDefault(merged.get('default')?.node);
  const variables = readVariables(merged.get('variables')?.node);
  const workflowNode = merged.get('workflow');
  const workflowRules: Array<{ if?: string; changes?: string[]; exists?: string[] }> = [];
  let hasWorkflowRules = false;
  if (workflowNode) {
    const wr = getNodeMap(workflowNode.node)?.value.get('rules');
    if (wr && wr.kind === 'list') {
      hasWorkflowRules = true;
      for (const item of (wr as YList).value) {
        if (item.kind === 'map') {
          workflowRules.push(readRule(item as YMap));
        }
      }
    }
  }

  const jobs = new Map<string, JobConfig>();
  const jobLines = new Map<string, number>();
  const jobKeys: Array<{ name: string; line: number }> = [];
  const templates = new Set<string>();
  for (const [k, v] of merged.entries()) {
    if (['stages', 'default', 'variables', 'include', 'workflow'].includes(k)) continue;
    jobKeys.push({ name: k, line: v.line });
    if (k.startsWith('.')) templates.add(k);
  }

  const KNOWN_KEYS = new Set(['stage', 'extends', 'script', 'needs', 'dependencies', 'rules', 'when', 'start_in', 'allow_failure', 'retry', 'timeout', 'interruptible', 'resource_group', 'variables', 'matrix', 'artifacts', 'cache', 'environment']);
  for (const { name, line } of jobKeys) {
    const entry = merged.get(name)!;
    const node = getNodeMap(entry.node);
    if (!node) continue;
    for (const key of node.value.keys()) {
      if (!KNOWN_KEYS.has(key)) {
        errors.push({ line: node.keyLine.get(key) ?? line, message: `Line ${node.keyLine.get(key) ?? line}: unknown keyword "${key}".` });
      }
    }
    const cfg = buildJobConfig(name, line, node, merged, templates, stages, defaultMap, errors, opts);
    if (cfg) {
      jobs.set(name, cfg);
      jobLines.set(name, line);
    }
  }

  // needs validation
  for (const [name, cfg] of jobs) {
    for (const need of cfg.needs) {
      if (!jobs.has(need) && !templates.has(`.${need}`)) {
        errors.push({ line: cfg.line, message: `Line ${cfg.line}: job "${name}" needs "${need}", which doesn't exist.` });
      }
    }
  }
  // stage validation
  for (const [name, cfg] of jobs) {
    if (!stages.includes(cfg.stage)) {
      errors.push({ line: cfg.line, message: `Line ${cfg.line}: job "${name}" uses stage "${cfg.stage}", which isn't in stages.` });
    }
  }
  // needs later stage
  for (const [name, cfg] of jobs) {
    const myIdx = stages.indexOf(cfg.stage);
    for (const need of cfg.needs) {
      const other = jobs.get(need);
      if (!other) continue;
      const idx = stages.indexOf(other.stage);
      if (idx > myIdx) {
        errors.push({ line: cfg.line, message: `Line ${cfg.line}: job "${name}" needs "${need}", in a later stage.` });
      }
    }
  }
  // cycles
  const needsCycle = findCycle([...jobs.keys()], (n) => jobs.get(n)?.needs ?? []);
  if (needsCycle) {
    const firstJob = needsCycle[0];
    errors.push({ line: jobLines.get(firstJob) ?? 1, message: `Line ${jobLines.get(firstJob) ?? 1}: needs cycle: ${needsCycle.join(' -> ')}.` });
  }
  const extendsCycle = findCycle([...jobs.keys(), ...templates], (n) => {
    const node = getNodeMap(merged.get(n)?.node);
    if (!node) return [];
    const ex = node.value.get('extends');
    const names = scalarList(ex);
    return names;
  });
  if (extendsCycle) {
    const firstJob = extendsCycle[0];
    errors.push({ line: jobLines.get(firstJob) ?? 1, message: `Line ${jobLines.get(firstJob) ?? 1}: extends cycle: ${extendsCycle.join(' -> ')}.` });
  }

  const sorted = [...errors].sort((a, b) => a.line - b.line || a.message.localeCompare(b.message)).slice(0, 20);
  const valid = sorted.length === 0;
  if (sorted.length > 0) {
    return { valid: false, errors: sorted, raw: { stages, default: defaultMap, variables, workflowRules, hasWorkflowRules, jobs, jobLines, valid: false, errors: sorted } };
  }
  return { valid: true, errors: [], raw: { stages, default: defaultMap, variables, workflowRules, hasWorkflowRules, jobs, jobLines, valid: true, errors: [] } };
}

export function findCycle(names: string[], edges: (n: string) => string[]): string[] | null {
  // Find the cycle containing the first job in file order; report path starting at that job.
  const order = names;
  for (const start of order) {
    const seen = new Set<string>();
    const path: string[] = [];
    const dfs = (n: string): string[] | null => {
      if (path.includes(n)) {
        return [...path.slice(path.indexOf(n)), n];
      }
      if (seen.has(n)) return null;
      seen.add(n);
      path.push(n);
      for (const e of edges(n)) {
        const r = dfs(e);
        if (r) return r;
      }
      path.pop();
      return null;
    };
    const r = dfs(start);
    if (r) return r;
  }
  return null;
}

function readStages(node: YNode | YScalar | undefined): string[] {
  if (!node) return [...DEFAULT_STAGES];
  const list = scalarList(node);
  if (list.length === 0) return [...DEFAULT_STAGES];
  return list;
}

function readDefault(node: YNode | YScalar | undefined): Record<string, Json> {
  if (!node) return {};
  const m = getNodeMap(node);
  if (!m) return {};
  const out: Record<string, Json> = {};
  for (const [k, v] of m.value.entries()) {
    const j = toJson(v);
    if (j !== undefined) out[k] = j;
  }
  return out;
}

function readVariables(node: YNode | YScalar | undefined): Record<string, string> {
  if (!node) return {};
  const m = getNodeMap(node);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of m.value.entries()) {
    const j = toJson(v);
    out[k] = j === null || j === undefined ? '' : String(j);
  }
  return out;
}

export function getNodeMap(node: YNode | undefined): YMap | null {
  if (node && node.kind === 'map') return node as YMap;
  return null;
}

export function scalarList(node: YNode | undefined): string[] {
  if (!node) return [];
  if (node.kind === 'list') {
    return (node as YList).value.map((x) => (x.kind === 'scalar' ? String((x as YScalar).value ?? '') : ''));
  }
  if (node.kind === 'scalar') return [String((node as YScalar).value ?? '')];
  return [];
}

function readRule(item: YMap): { if?: string; changes?: string[]; exists?: string[]; when?: string; allow_failure?: boolean; variables?: Record<string, string>; start_in?: string } {
  const out: { if?: string; changes?: string[]; exists?: string[]; when?: string; allow_failure?: boolean; variables?: Record<string, string>; start_in?: string } = {};
  const ifNode = item.value.get('if');
  if (ifNode && ifNode.kind === 'scalar') out.if = String((ifNode as YScalar).value);
  const changes = item.value.get('changes');
  if (changes) out.changes = scalarList(changes);
  const exists = item.value.get('exists');
  if (exists) out.exists = scalarList(exists);
  const when = item.value.get('when');
  if (when && when.kind === 'scalar') out.when = String((when as YScalar).value);
  const af = item.value.get('allow_failure');
  if (af && af.kind === 'scalar') out.allow_failure = (af as YScalar).value === true || (af as YScalar).value === 'true';
  const vars = item.value.get('variables');
  if (vars) {
    const m = getNodeMap(vars);
    if (m) {
      const v: Record<string, string> = {};
      for (const [k, x] of m.value.entries()) {
        const j = toJson(x);
        v[k] = j === null || j === undefined ? '' : String(j);
      }
      out.variables = v;
    }
  }
  const si = item.value.get('start_in');
  if (si && si.kind === 'scalar') out.start_in = String((si as YScalar).value);
  return out;
}

function deepMerge(target: Record<string, Json>, source: Record<string, Json>): Record<string, Json> {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, Json>, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function buildJobConfig(
  name: string,
  line: number,
  node: YMap,
  merged: Map<string, { node: YNode | YScalar; line: number }>,
  templates: Set<string>,
  stages: string[],
  defaults: Record<string, Json>,
  errors: LintError[],
  opts: { retryMax: number },
): JobConfig | null {
  void stages;
  // extends chain
  let mergedKeys: Record<string, Json> = {};
  const extendsNode = node.value.get('extends');
  const extendsNames = scalarList(extendsNode);
  for (const exName of extendsNames) {
    const tpl = getNodeMap(merged.get(exName)?.node);
    if (!tpl) {
      if (!templates.has(exName) && !merged.has(exName)) {
        errors.push({ line, message: `Line ${line}: job "${name}" extends unknown "${exName}".` });
        continue;
      }
    }
    const tplJson = nodeToRecord(tpl ?? node);
    mergedKeys = deepMerge(mergedKeys, tplJson);
  }
  const own = nodeToRecord(node);
  mergedKeys = deepMerge(mergedKeys, own);

  // default fills missing keys
  for (const [k, v] of Object.entries(defaults)) {
    if (mergedKeys[k] === undefined) mergedKeys[k] = v;
  }

  const stage = typeof mergedKeys.stage === 'string' ? mergedKeys.stage : 'test';
  const script = Array.isArray(mergedKeys.script) ? mergedKeys.script.map(String) : [];
  const needs = Array.isArray(mergedKeys.needs) ? mergedKeys.needs.map(String) : [];
  const dependencies = Array.isArray(mergedKeys.dependencies) ? mergedKeys.dependencies.map(String) : null;
  const rules: JobConfig['rules'] = [];
  const rulesNode = mergedKeys.rules;
  if (Array.isArray(rulesNode)) {
    for (const r of rulesNode) {
      if (typeof r === 'object' && r !== null) {
        const rr = r as Record<string, Json>;
        rules.push({
          if: typeof rr.if === 'string' ? rr.if : undefined,
          changes: Array.isArray(rr.changes) ? rr.changes.map(String) : undefined,
          exists: Array.isArray(rr.exists) ? rr.exists.map(String) : undefined,
          when: typeof rr.when === 'string' ? rr.when : undefined,
          allow_failure: rr.allow_failure === true,
          variables: typeof rr.variables === 'object' && rr.variables !== null && !Array.isArray(rr.variables) ? mapToStrings(rr.variables as Record<string, Json>) : undefined,
          start_in: typeof rr.start_in === 'string' ? rr.start_in : undefined,
        });
      }
    }
  }
  const hasRules = rules.length > 0;
  let when = typeof mergedKeys.when === 'string' ? mergedKeys.when : 'on_success';
  if (rules.length > 0 && typeof mergedKeys.when === 'string') when = mergedKeys.when;
  let retry = 0;
  const retryNode = mergedKeys.retry;
  if (typeof retryNode === 'number') retry = retryNode;
  else if (retryNode === 'max' || typeof retryNode === 'object') {
    const r = retryNode as unknown;
    if (typeof r === 'object' && r !== null) {
      const rr = r as Record<string, Json>;
      retry = typeof rr.max === 'number' ? rr.max : 0;
    }
  }
  if (retry > opts.retryMax) {
    errors.push({ line, message: `Line ${line}: retry max can't exceed ${opts.retryMax}.` });
  }
  const timeout = typeof mergedKeys.timeout === 'string' ? mergedKeys.timeout : undefined;
  if (timeout !== undefined && parseDurationMs(timeout) === null) {
    errors.push({ line, message: `Line ${line}: can't read duration "${timeout}".` });
  }
  const artifactsNode = mergedKeys.artifacts;
  let artifacts: JobConfig['artifacts'] = { paths: [], when: 'on_success' };
  if (artifactsNode && typeof artifactsNode === 'object' && !Array.isArray(artifactsNode)) {
    const a = artifactsNode as Record<string, Json>;
    artifacts = {
      paths: Array.isArray(a.paths) ? a.paths.map(String) : [],
      expire_in: typeof a.expire_in === 'string' ? a.expire_in : undefined,
      when: typeof a.when === 'string' ? a.when : 'on_success',
    };
  }
  const cacheNode = mergedKeys.cache;
  let cache: JobConfig['cache'] = { fallback_keys: [], paths: [], policy: 'pull-push' };
  if (cacheNode && typeof cacheNode === 'object' && !Array.isArray(cacheNode)) {
    const cn = cacheNode as Record<string, Json>;
    cache = {
      key: typeof cn.key === 'string' ? cn.key : undefined,
      fallback_keys: Array.isArray(cn.fallback_keys) ? cn.fallback_keys.map(String) : [],
      paths: Array.isArray(cn.paths) ? cn.paths.map(String) : [],
      policy: typeof cn.policy === 'string' ? cn.policy : 'pull-push',
    };
  }
  const envNode = mergedKeys.environment;
  let environment: JobConfig['environment'] | undefined;
  if (typeof envNode === 'string') environment = { name: envNode };
  else if (envNode && typeof envNode === 'object' && !Array.isArray(envNode)) {
    const e = envNode as Record<string, Json>;
    environment = {
      name: typeof e.name === 'string' ? e.name : '',
      action: typeof e.action === 'string' ? e.action : undefined,
      auto_stop_in: typeof e.auto_stop_in === 'string' ? e.auto_stop_in : undefined,
      on_stop: typeof e.on_stop === 'string' ? e.on_stop : undefined,
      tier: typeof e.tier === 'string' ? e.tier : undefined,
    };
  }
  const matrixNode = mergedKeys.matrix;
  let matrix: Record<string, string[]> = {};
  if (matrixNode && typeof matrixNode === 'object' && !Array.isArray(matrixNode)) {
    const m = matrixNode as Record<string, Json>;
    for (const [k, v] of Object.entries(m)) {
      if (Array.isArray(v)) matrix[k] = v.map(String);
    }
  }
  if (script.length === 0 && !name.startsWith('.')) {
    errors.push({ line, message: `Line ${line}: job "${name}" has no script.` });
  }
  return {
    name,
    stage,
    script,
    needs,
    dependencies,
    rules,
    hasRules,
    when,
    start_in: typeof mergedKeys.start_in === 'string' ? mergedKeys.start_in : undefined,
    allow_failure: mergedKeys.allow_failure === true,
    retry,
    retryWhen: ['script_failure', 'job_timeout', 'system_failure'],
    timeout,
    interruptible: mergedKeys.interruptible === true,
    resource_group: typeof mergedKeys.resource_group === 'string' ? mergedKeys.resource_group : undefined,
    variables: typeof mergedKeys.variables === 'object' && mergedKeys.variables !== null && !Array.isArray(mergedKeys.variables) ? mapToStrings(mergedKeys.variables as Record<string, Json>) : {},
    matrix,
    artifacts,
    cache,
    environment,
    line,
  };
}

function nodeToRecord(node: YMap | null): Record<string, Json> {
  if (!node) return {};
  const j = toJson(node);
  if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, Json>;
  return {};
}

function mapToStrings(m: Record<string, Json>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) out[k] = v === null || v === undefined ? '' : String(v);
  return out;
}

// ---- Rule evaluation ----

export interface RuleContext {
  variables: Record<string, string>;
  changedFiles: string[] | null; // null means always true
  existsPaths: string[];
}

export function evaluateCondition(expr: string, ctx: RuleContext): boolean {
  const vars = ctx.variables;
  const tokens = tokenize(expr);
  let pos = 0;
  const parseOr = (): boolean => {
    let left = parseAnd();
    while (pos < tokens.length && tokens[pos] === '||') {
      pos++;
      const right = parseAnd();
      left = left || right;
    }
    return left;
  };
  const parseAnd = (): boolean => {
    let left = parseAtom();
    while (pos < tokens.length && tokens[pos] === '&&') {
      pos++;
      const right = parseAtom();
      left = left && right;
    }
    return left;
  };
  const parseAtom = (): boolean => {
    const t = tokens[pos];
    if (t === '(') {
      pos++;
      const v = parseOr();
      if (tokens[pos] === ')') pos++;
      return v;
    }
    if (t === '!') {
      pos++;
      return !parseAtom();
    }
    // comparison or bare var
    const next = tokens[pos + 1];
    if (next === '==' || next === '!=') {
      const left = varValue(t, vars);
      pos += 2;
      const right = literalValue(tokens[pos], vars);
      pos++;
      if (next === '==') return left === right;
      return left !== right;
    }
    if (next === '=~') {
      const left = varValue(t, vars);
      pos += 2;
      const reTok = tokens[pos];
      pos++;
      const m = reTok.match(/^\/(.*)\/(i?)$/s);
      if (!m) return false;
      try {
        return new RegExp(m[1], m[2]).test(left);
      } catch {
        return false;
      }
    }
    pos++;
    const v = varValue(t, vars);
    return v !== '';
  };
  const result = parseOr();
  void pos;
  return result;
}

function tokenize(expr: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === ' ') {
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      out.push(c);
      i++;
      continue;
    }
    if (expr.startsWith('=~', i)) {
      // capture /re/ or /re/i
      const m = expr.slice(i).match(/^=~\s*(\/(?:[^/\\]|\\.)+\/[a-z]*)/);
      if (m) {
        out.push('=~', m[1]);
        i += m[0].length;
        continue;
      }
    }
    if (expr.startsWith('&&', i)) {
      out.push('&&');
      i += 2;
      continue;
    }
    if (expr.startsWith('||', i)) {
      out.push('||');
      i += 2;
      continue;
    }
    if (expr.startsWith('==', i)) {
      out.push('==');
      i += 2;
      continue;
    }
    if (expr.startsWith('!=', i)) {
      out.push('!=');
      i += 2;
      continue;
    }
    if (c === '!') {
      out.push('!');
      i++;
      continue;
    }
    let j = i;
    while (j < expr.length && !' ()'.includes(expr[j]) && !expr.startsWith('==', j) && !expr.startsWith('!=', j) && !expr.startsWith('&&', j) && !expr.startsWith('||', j) && !expr.startsWith('=~', j)) {
      j++;
    }
    if (j === i) j++;
    out.push(expr.slice(i, j));
    i = j;
  }
  return out;
}

function varValue(tok: string, vars: Record<string, string>): string {
  if (tok.startsWith('$')) {
    const name = tok.slice(1).replace(/^\{|\}$/g, '');
    return vars[name] ?? '';
  }
  if (tok.startsWith('"') && tok.endsWith('"')) return tok.slice(1, -1);
  if (tok.startsWith("'") && tok.endsWith("'")) return tok.slice(1, -1);
  return tok;
}

function literalValue(tok: string, vars: Record<string, string>): string {
  return varValue(tok, vars);
}

export function evaluateRule(rule: JobConfig['rules'][number], ctx: RuleContext): boolean {
  if (rule.if !== undefined && !evaluateCondition(rule.if, ctx)) return false;
  if (rule.changes && ctx.changedFiles !== null) {
    const ok = ctx.changedFiles.some((f) => rule.changes!.some((g) => globMatch(g, f)));
    if (!ok) return false;
  }
  if (rule.exists && ctx.existsPaths.length >= 0) {
    const ok = rule.exists.some((g) => ctx.existsPaths.some((p) => globMatch(g, p)));
    if (!ok) return false;
  }
  return true;
}

export function expandVariables(text: string, vars: Record<string, string>): string {
  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, braced, plain) => {
      if (m === '$$') return '\u0000';
      const name = braced ?? plain;
      return vars[name] ?? '';
    });
    if (next === out) break;
    out = next;
  }
  return out.replace(/\u0000/g, '$');
}
