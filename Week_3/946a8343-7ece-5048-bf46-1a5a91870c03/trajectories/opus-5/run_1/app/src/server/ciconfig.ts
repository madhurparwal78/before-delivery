import { config } from './config';
import { globMatch } from './glob';
import { UnreadableLine, YMap, YValue, asList, asString, isMap, parseYaml } from './yaml';

export const mainConfigPath = 'spurline.pipeline.yml';

export const defaultStages = ['build', 'test', 'deploy'];

const topKeys = new Set(['stages', 'default', 'variables', 'include', 'workflow']);

const jobKeys = new Set([
  'stage',
  'extends',
  'script',
  'needs',
  'dependencies',
  'rules',
  'when',
  'start_in',
  'allow_failure',
  'retry',
  'timeout',
  'interruptible',
  'resource_group',
  'variables',
  'matrix',
  'artifacts',
  'cache',
  'environment',
]);

const ruleKeys = new Set(['if', 'changes', 'exists', 'when', 'allow_failure', 'variables', 'start_in']);

export type JobWhen = 'on_success' | 'on_failure' | 'always' | 'manual' | 'delayed';

export type ArtifactsSpec = {
  paths: string[];
  expire_in_ms: number | null;
  never_expires: boolean;
  when: 'on_success' | 'on_failure' | 'always';
};

export type CacheSpec = {
  key: string;
  fallback_keys: string[];
  paths: string[];
  policy: 'pull' | 'push' | 'pull-push';
};

export type EnvironmentSpec = {
  name: string;
  action: 'start' | 'stop';
  auto_stop_in_ms: number | null;
  on_stop: string | null;
  tier: string;
};

export type JobSpec = {
  name: string;
  stage: string;
  stage_index: number;
  config_order: number;
  script: string[];
  script_raw: string[];
  needs: string[] | null;
  dependencies: string[] | null;
  when: JobWhen;
  start_in_ms: number | null;
  allow_failure: boolean;
  retry_max: number;
  retry_when: string[];
  timeout_ms: number;
  interruptible: boolean;
  resource_group: string | null;
  variables: Record<string, string>;
  artifacts: ArtifactsSpec | null;
  cache: CacheSpec | null;
  environment: EnvironmentSpec | null;
};

export type ExpandContext = {
  files: Map<string, string>;
  predefined: Record<string, string>;
  projectVariables: Record<string, string>;
  runVariables: Record<string, string>;
  changedFiles: string[];
  treePaths: string[];
};

export type ExpandResult = {
  valid: boolean;
  errors: string[];
  summary: string;
  jobs: JobSpec[];
  stages: string[];
  workflowExcluded: boolean;
};

type Loaded = { lines: Map<string, number>; value: YMap; errors: { line: number; text: string }[] };

function mergeInto(target: YMap, source: YMap): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isMap(value) && isMap(current)) {
      mergeInto(current, value);
      continue;
    }
    target[key] = isMap(value) ? { ...value } : value;
  }
}

function loadConfig(ctx: ExpandContext): Loaded {
  const lines = new Map<string, number>();
  const value: YMap = {};
  const errors: { line: number; text: string }[] = [];
  let unreadable: number | null = null;

  const load = (path: string, chain: string[], attribution: number | null): void => {
    if (chain.includes(path)) {
      const start = chain.indexOf(path);
      const cycle = [...chain.slice(start), path].join(' -> ');
      errors.push({ line: attribution ?? 1, text: `include cycle: ${cycle}.` });
      return;
    }
    const content = ctx.files.get(path);
    if (content === undefined) {
      errors.push({ line: attribution ?? 1, text: `include "${path}" not found.` });
      return;
    }
    let parsed;
    try {
      parsed = parseYaml(content);
    } catch (error) {
      if (error instanceof UnreadableLine) {
        if (path === mainConfigPath) unreadable = error.line;
        else unreadable = attribution ?? 1;
        return;
      }
      throw error;
    }
    const includes = asList(parsed.value.include).map((item, index) => ({
      path: asString(item),
      line: parsed.lines.get(`include[${index}]`) ?? 1,
    }));
    for (const include of includes) {
      load(include.path, [...chain, path], attribution ?? include.line);
    }
    const own: YMap = { ...parsed.value };
    delete own.include;
    mergeInto(value, own);
    for (const [key, line] of parsed.lines) {
      lines.set(key, attribution ?? line);
    }
  };

  load(mainConfigPath, [], null);
  if (unreadable !== null) {
    return { lines, value: {}, errors: [{ line: unreadable, text: "can't read this line." }] };
  }
  return { lines, value, errors };
}

export function parseDuration(raw: YValue): { ms: number | null; never: boolean; ok: boolean } {
  const text = asString(raw).trim();
  if (text === 'never') return { ms: null, never: true, ok: true };
  const match = /^(\d+)(ms|s|m|h)$/.exec(text);
  if (match === null) return { ms: null, never: false, ok: false };
  const amount = Number(match[1]);
  const unit = match[2];
  const factor = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000;
  return { ms: amount * factor, never: false, ok: true };
}

export function expandVariables(text: string, variables: Record<string, string>): string {
  const sentinel = '\u0000DOLLAR\u0000';
  let out = text.split('$$').join(sentinel);
  for (let pass = 0; pass < 3; pass += 1) {
    out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced: string, bare: string) => {
      const name = braced ?? bare;
      return variables[name] ?? '';
    });
  }
  return out.split(sentinel).join('$');
}

type Token = { kind: 'op' | 'value' | 'var' | 'regex' | 'paren'; text: string; flags?: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (char === ' ') {
      index += 1;
      continue;
    }
    if (expression.startsWith('&&', index) || expression.startsWith('||', index)) {
      tokens.push({ kind: 'op', text: expression.slice(index, index + 2) });
      index += 2;
      continue;
    }
    if (expression.startsWith('==', index) || expression.startsWith('!=', index) || expression.startsWith('=~', index)) {
      tokens.push({ kind: 'op', text: expression.slice(index, index + 2) });
      index += 2;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ kind: 'paren', text: char });
      index += 1;
      continue;
    }
    if (char === '$') {
      const match = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/.exec(expression.slice(index));
      if (match !== null) {
        tokens.push({ kind: 'var', text: match[1] });
        index += match[0].length;
        continue;
      }
    }
    if (char === '"' || char === "'") {
      const end = expression.indexOf(char, index + 1);
      const stop = end === -1 ? expression.length : end;
      tokens.push({ kind: 'value', text: expression.slice(index + 1, stop) });
      index = stop + 1;
      continue;
    }
    if (char === '/') {
      let end = index + 1;
      while (end < expression.length && expression[end] !== '/') end += 1;
      const body = expression.slice(index + 1, end);
      let flags = '';
      let cursor = end + 1;
      while (cursor < expression.length && /[a-z]/.test(expression[cursor])) {
        flags += expression[cursor];
        cursor += 1;
      }
      tokens.push({ kind: 'regex', text: body, flags });
      index = cursor;
      continue;
    }
    const match = /^[^\s()]+/.exec(expression.slice(index));
    const word = match === null ? char : match[0];
    tokens.push({ kind: 'value', text: word });
    index += word.length;
  }
  return tokens;
}

export function evaluateIf(expression: string, variables: Record<string, string>): boolean {
  const tokens = tokenize(expression);
  let position = 0;

  const peek = (): Token | undefined => tokens[position];

  const parsePrimary = (): boolean => {
    const token = peek();
    if (token === undefined) return false;
    if (token.kind === 'paren' && token.text === '(') {
      position += 1;
      const value = parseOr();
      if (peek()?.text === ')') position += 1;
      return value;
    }
    const left = token;
    position += 1;
    const operator = peek();
    if (operator !== undefined && operator.kind === 'op' && ['==', '!=', '=~'].includes(operator.text)) {
      position += 1;
      const right = peek();
      position += 1;
      const leftValue = left.kind === 'var' ? variables[left.text] ?? '' : left.text;
      if (right === undefined) return false;
      if (operator.text === '=~') {
        if (right.kind !== 'regex') return false;
        return new RegExp(right.text, right.flags === undefined ? '' : right.flags).test(leftValue);
      }
      const rightValue = right.kind === 'var' ? variables[right.text] ?? '' : right.text;
      return operator.text === '==' ? leftValue === rightValue : leftValue !== rightValue;
    }
    if (left.kind === 'var') return (variables[left.text] ?? '') !== '';
    return left.text !== '' && left.text !== 'false' && left.text !== 'null';
  };

  const parseAnd = (): boolean => {
    let value = parsePrimary();
    while (peek()?.text === '&&') {
      position += 1;
      const right = parsePrimary();
      value = value && right;
    }
    return value;
  };

  const parseOr = (): boolean => {
    let value = parseAnd();
    while (peek()?.text === '||') {
      position += 1;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  };

  return parseOr();
}

type RuleOutcome = {
  matched: boolean;
  when: JobWhen | 'never' | null;
  allowFailure: boolean | null;
  variables: Record<string, string>;
  startIn: string | null;
};

function evaluateRules(
  rules: YValue[],
  variables: Record<string, string>,
  ctx: ExpandContext,
  isWeb: boolean,
): RuleOutcome {
  for (const raw of rules) {
    if (!isMap(raw)) continue;
    let matched = true;
    if (raw.if !== undefined && raw.if !== null) {
      matched = evaluateIf(expandIfVars(asString(raw.if)), variables);
    }
    if (matched && raw.changes !== undefined && raw.changes !== null) {
      const globs = asList(raw.changes).map((item) => asString(item));
      matched = isWeb || globs.some((glob) => ctx.changedFiles.some((path) => globMatch(glob, path)));
    }
    if (matched && raw.exists !== undefined && raw.exists !== null) {
      const globs = asList(raw.exists).map((item) => asString(item));
      matched = globs.some((glob) => ctx.treePaths.some((path) => globMatch(glob, path)));
    }
    if (!matched) continue;
    const ruleVariables: Record<string, string> = {};
    if (isMap(raw.variables)) {
      for (const [key, value] of Object.entries(raw.variables)) {
        ruleVariables[key] = asString(value);
      }
    }
    const whenValue = raw.when === undefined || raw.when === null ? null : (asString(raw.when) as JobWhen | 'never');
    return {
      matched: true,
      when: whenValue,
      allowFailure: raw.allow_failure === undefined || raw.allow_failure === null ? null : raw.allow_failure === true,
      variables: ruleVariables,
      startIn: raw.start_in === undefined || raw.start_in === null ? null : asString(raw.start_in),
    };
  }
  return { matched: false, when: null, allowFailure: null, variables: {}, startIn: null };
}

function expandIfVars(expression: string): string {
  return expression;
}

function resolveExtends(
  name: string,
  raw: YMap,
  all: Record<string, YMap>,
  errors: { line: number; text: string }[],
  lines: Map<string, number>,
): YMap {
  const seen: string[] = [];
  const collect = (jobName: string, body: YMap, depth: number): YMap => {
    if (depth > 5) return body;
    const parents = asList(body.extends).map((item) => asString(item));
    const merged: YMap = {};
    for (const parent of parents) {
      if (seen.includes(parent)) {
        const start = seen.indexOf(parent);
        const cycle = [...seen.slice(start), parent].join(' -> ');
        errors.push({ line: lines.get(seen[start]) ?? 1, text: `extends cycle: ${cycle}.` });
        continue;
      }
      const parentBody = all[parent];
      if (parentBody === undefined) {
        errors.push({ line: lines.get(jobName) ?? 1, text: `job "${jobName}" extends unknown "${parent}".` });
        continue;
      }
      seen.push(jobName);
      mergeInto(merged, collect(parent, parentBody, depth + 1));
      seen.pop();
    }
    const own: YMap = { ...body };
    delete own.extends;
    mergeInto(merged, own);
    return merged;
  };
  seen.push(name);
  const result = collect(name, raw, 0);
  seen.pop();
  return result;
}

function cyclePath(start: string, edges: Map<string, string[]>): string[] | null {
  const path: string[] = [start];
  const visited = new Set<string>([start]);
  let current = start;
  for (let step = 0; step < 200; step += 1) {
    const next = (edges.get(current) ?? []).find((candidate) => onCycleTo(candidate, start, edges));
    if (next === undefined) return null;
    if (next === start) return [...path, start];
    if (visited.has(next)) return null;
    visited.add(next);
    path.push(next);
    current = next;
  }
  return null;
}

function onCycleTo(from: string, target: string, edges: Map<string, string[]>): boolean {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    if (node === target) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    queue.push(...(edges.get(node) ?? []));
  }
  return false;
}

export function expandConfig(ctx: ExpandContext): ExpandResult {
  const loaded = loadConfig(ctx);
  const errors = [...loaded.errors];
  if (errors.some((item) => item.text === "can't read this line.")) {
    return finish(errors, [], []);
  }
  const lines = loaded.lines;
  const root = loaded.value;
  const stages = asList(root.stages).length > 0 ? asList(root.stages).map((item) => asString(item)) : defaultStages;
  const topVariables: Record<string, string> = {};
  if (isMap(root.variables)) {
    for (const [key, value] of Object.entries(root.variables)) topVariables[key] = asString(value);
  }
  const defaults = isMap(root.default) ? root.default : {};
  const templates: Record<string, YMap> = {};
  const jobNames: string[] = [];
  for (const [key, value] of Object.entries(root)) {
    if (topKeys.has(key)) continue;
    if (!isMap(value)) continue;
    templates[key] = value;
    if (!key.startsWith('.')) jobNames.push(key);
  }

  for (const [key, value] of Object.entries(defaults)) {
    void value;
    if (!jobKeys.has(key)) {
      errors.push({ line: lines.get(`default.${key}`) ?? 1, text: `unknown keyword "${key}".` });
    }
  }
  if (root.workflow !== undefined && isMap(root.workflow)) {
    for (const key of Object.keys(root.workflow)) {
      if (key !== 'rules') {
        errors.push({ line: lines.get(`workflow.${key}`) ?? 1, text: `unknown keyword "${key}".` });
      }
    }
  }

  const isWeb = ctx.predefined.CI_PIPELINE_SOURCE === 'web';
  let workflowExcluded = false;
  if (isMap(root.workflow) && root.workflow.rules !== undefined) {
    const outcome = evaluateRules(asList(root.workflow.rules), { ...ctx.predefined, ...topVariables, ...ctx.projectVariables, ...ctx.runVariables }, ctx, isWeb);
    if (!outcome.matched || outcome.when === 'never') workflowExcluded = true;
  }

  const resolved: { name: string; body: YMap; order: number }[] = [];
  jobNames.forEach((name, order) => {
    const body = resolveExtends(name, templates[name], templates, errors, lines);
    const withDefaults: YMap = { ...body };
    for (const [key, value] of Object.entries(defaults)) {
      if (withDefaults[key] === undefined) withDefaults[key] = value;
    }
    resolved.push({ name, body: withDefaults, order });
  });

  for (const job of resolved) {
    for (const key of Object.keys(job.body)) {
      if (!jobKeys.has(key)) {
        errors.push({ line: lines.get(`${job.name}.${key}`) ?? lines.get(job.name) ?? 1, text: `unknown keyword "${key}".` });
      }
    }
    if (isMap(job.body.rules) === false) {
      for (const [index, rule] of asList(job.body.rules).entries()) {
        if (!isMap(rule)) continue;
        for (const key of Object.keys(rule)) {
          if (!ruleKeys.has(key)) {
            errors.push({
              line: lines.get(`${job.name}.rules[${index}].${key}`) ?? lines.get(`${job.name}.rules`) ?? 1,
              text: `unknown keyword "${key}".`,
            });
          }
        }
      }
    }
    const stage = job.body.stage === undefined || job.body.stage === null ? 'test' : asString(job.body.stage);
    if (!stages.includes(stage)) {
      errors.push({
        line: lines.get(`${job.name}.stage`) ?? lines.get(job.name) ?? 1,
        text: `job "${job.name}" uses stage "${stage}", which isn't in stages.`,
      });
    }
    if (asList(job.body.script).length === 0) {
      errors.push({ line: lines.get(job.name) ?? 1, text: `job "${job.name}" has no script.` });
    }
    const retry = job.body.retry;
    const retryMax = isMap(retry) ? Number(asString(retry.max)) : typeof retry === 'number' ? retry : 0;
    if (retryMax > config.retryMax) {
      errors.push({
        line: lines.get(`${job.name}.retry`) ?? lines.get(job.name) ?? 1,
        text: `retry max can't exceed ${config.retryMax}.`,
      });
    }
    for (const [key, path] of [
      ['timeout', `${job.name}.timeout`],
      ['start_in', `${job.name}.start_in`],
    ] as const) {
      const raw = job.body[key];
      if (raw === undefined || raw === null) continue;
      if (!parseDuration(raw).ok) {
        errors.push({ line: lines.get(path) ?? 1, text: `can't read duration "${asString(raw)}".` });
      }
    }
    if (isMap(job.body.artifacts) && job.body.artifacts.expire_in !== undefined && job.body.artifacts.expire_in !== null) {
      if (!parseDuration(job.body.artifacts.expire_in).ok) {
        errors.push({
          line: lines.get(`${job.name}.artifacts.expire_in`) ?? lines.get(`${job.name}.artifacts`) ?? 1,
          text: `can't read duration "${asString(job.body.artifacts.expire_in)}".`,
        });
      }
    }
    if (isMap(job.body.environment) && job.body.environment.auto_stop_in !== undefined && job.body.environment.auto_stop_in !== null) {
      if (!parseDuration(job.body.environment.auto_stop_in).ok) {
        errors.push({
          line: lines.get(`${job.name}.environment.auto_stop_in`) ?? lines.get(`${job.name}.environment`) ?? 1,
          text: `can't read duration "${asString(job.body.environment.auto_stop_in)}".`,
        });
      }
    }
  }

  const extendsEdges = new Map<string, string[]>();
  for (const [name, body] of Object.entries(templates)) {
    extendsEdges.set(name, asList(body.extends).map((item) => asString(item)));
  }
  reportCycles(extendsEdges, Object.keys(templates), 'extends', errors, lines);

  const specs: JobSpec[] = [];
  const removed = new Set<string>();
  let order = 0;
  for (const job of resolved) {
    const stage = job.body.stage === undefined || job.body.stage === null ? 'test' : asString(job.body.stage);
    const stageIndex = Math.max(0, stages.indexOf(stage));
    const matrix = isMap(job.body.matrix) ? job.body.matrix : null;
    const combinations = matrix === null ? [{}] : matrixCombinations(matrix);
    let anyIncluded = false;
    for (const combination of combinations) {
      const matrixName =
        matrix === null
          ? job.name
          : `${job.name} [${Object.keys(matrix)
              .map((key) => combination[key])
              .join(', ')}]`;
      const jobVariables: Record<string, string> = {};
      if (isMap(job.body.variables)) {
        for (const [key, value] of Object.entries(job.body.variables)) jobVariables[key] = asString(value);
      }
      const baseVariables: Record<string, string> = {
        ...ctx.predefined,
        ...topVariables,
        ...jobVariables,
        ...combination,
        CI_JOB_NAME: matrixName,
        CI_JOB_STAGE: stage,
      };
      let when: JobWhen = job.body.when === undefined || job.body.when === null ? 'on_success' : (asString(job.body.when) as JobWhen);
      let allowFailure = job.body.allow_failure === true;
      let startIn = job.body.start_in === undefined || job.body.start_in === null ? null : asString(job.body.start_in);
      let ruleVariables: Record<string, string> = {};
      if (job.body.rules !== undefined && job.body.rules !== null) {
        const outcome = evaluateRules(
          asList(job.body.rules),
          { ...baseVariables, ...ctx.projectVariables, ...ctx.runVariables },
          ctx,
          isWeb,
        );
        if (!outcome.matched || outcome.when === 'never') {
          removed.add(matrixName);
          continue;
        }
        if (outcome.when !== null) when = outcome.when as JobWhen;
        if (outcome.allowFailure !== null) allowFailure = outcome.allowFailure;
        if (outcome.startIn !== null) startIn = outcome.startIn;
        ruleVariables = outcome.variables;
      }
      anyIncluded = true;
      const variables: Record<string, string> = {
        ...baseVariables,
        ...ruleVariables,
        ...ctx.projectVariables,
        ...ctx.runVariables,
      };
      const retry = job.body.retry;
      const retryMax = isMap(retry) ? Number(asString(retry.max)) : typeof retry === 'number' ? retry : 0;
      const retryWhen = isMap(retry) && retry.when !== undefined && retry.when !== null
        ? asList(retry.when).map((item) => asString(item))
        : ['script_failure', 'job_timeout', 'system_failure'];
      const timeout = job.body.timeout === undefined || job.body.timeout === null ? null : parseDuration(job.body.timeout);
      const startInParsed = startIn === null ? null : parseDuration(startIn);
      specs.push({
        name: matrixName,
        stage,
        stage_index: stageIndex,
        config_order: order,
        script: asList(job.body.script).map((item) => expandVariables(asString(item), variables)),
        script_raw: asList(job.body.script).map((item) => asString(item)),
        needs: job.body.needs === undefined ? null : asList(job.body.needs).map((item) => (isMap(item) ? asString(item.job) : asString(item))),
        dependencies: job.body.dependencies === undefined ? null : asList(job.body.dependencies).map((item) => asString(item)),
        when,
        start_in_ms: startInParsed === null ? null : startInParsed.ms,
        allow_failure: allowFailure,
        retry_max: Number.isFinite(retryMax) ? retryMax : 0,
        retry_when: retryWhen,
        timeout_ms: timeout === null || timeout.ms === null ? config.jobTimeoutMs : timeout.ms,
        interruptible: job.body.interruptible === true,
        resource_group:
          job.body.resource_group === undefined || job.body.resource_group === null
            ? null
            : expandVariables(asString(job.body.resource_group), variables),
        variables,
        artifacts: artifactsOf(job.body, variables),
        cache: cacheOf(job.body, variables),
        environment: environmentOf(job.body, variables),
      });
      order += 1;
    }
    if (!anyIncluded) removed.add(job.name);
  }

  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  for (const spec of specs) {
    if (spec.needs === null) continue;
    for (const need of spec.needs) {
      const target = byName.get(need);
      const line = lines.get(`${baseName(spec.name)}.needs`) ?? lines.get(baseName(spec.name)) ?? 1;
      if (target === undefined) {
        if (removed.has(need) || [...removed].some((name) => baseName(name) === need)) {
          errors.push({ line, text: `job "${spec.name}" needs "${need}", which rules removed.` });
        } else {
          errors.push({ line, text: `job "${spec.name}" needs "${need}", which doesn't exist.` });
        }
        continue;
      }
      if (target.stage_index > spec.stage_index) {
        errors.push({ line, text: `job "${spec.name}" needs "${need}", in a later stage.` });
      }
    }
  }

  const needsEdges = new Map<string, string[]>();
  for (const spec of specs) needsEdges.set(spec.name, spec.needs ?? []);
  reportCycles(needsEdges, specs.map((spec) => spec.name), 'needs', errors, lines);

  const usedStages = stages.filter((stage) => specs.some((spec) => spec.stage === stage));
  const result = finish(errors, specs, usedStages);
  return { ...result, workflowExcluded };
}

function baseName(name: string): string {
  const index = name.indexOf(' [');
  return index === -1 ? name : name.slice(0, index);
}

function reportCycles(
  edges: Map<string, string[]>,
  order: string[],
  kind: 'needs' | 'extends',
  errors: { line: number; text: string }[],
  lines: Map<string, number>,
): void {
  const reported = new Set<string>();
  for (const name of order) {
    if (reported.has(name)) continue;
    const path = cyclePath(name, edges);
    if (path === null) continue;
    for (const node of path) reported.add(node);
    errors.push({
      line: lines.get(`${baseName(name)}.${kind}`) ?? lines.get(baseName(name)) ?? 1,
      text: `${kind} cycle: ${path.join(' -> ')}.`,
    });
  }
}

function matrixCombinations(matrix: YMap): Record<string, string>[] {
  const keys = Object.keys(matrix);
  let out: Record<string, string>[] = [{}];
  for (const key of keys) {
    const values = asList(matrix[key]).map((item) => asString(item));
    const next: Record<string, string>[] = [];
    for (const current of out) {
      for (const value of values) {
        next.push({ ...current, [key]: value });
      }
    }
    out = next;
  }
  return out;
}

function artifactsOf(body: YMap, variables: Record<string, string>): ArtifactsSpec | null {
  if (!isMap(body.artifacts)) return null;
  const spec = body.artifacts;
  const expire = spec.expire_in === undefined || spec.expire_in === null ? null : parseDuration(spec.expire_in);
  return {
    paths: asList(spec.paths).map((item) => expandVariables(asString(item), variables)),
    expire_in_ms: expire === null ? null : expire.ms,
    never_expires: expire !== null && expire.never,
    when: spec.when === undefined || spec.when === null ? 'on_success' : (asString(spec.when) as 'on_success' | 'on_failure' | 'always'),
  };
}

function cacheOf(body: YMap, variables: Record<string, string>): CacheSpec | null {
  if (!isMap(body.cache)) return null;
  const spec = body.cache;
  return {
    key: expandVariables(asString(spec.key ?? 'default'), variables),
    fallback_keys: asList(spec.fallback_keys).map((item) => expandVariables(asString(item), variables)),
    paths: asList(spec.paths).map((item) => expandVariables(asString(item), variables)),
    policy: spec.policy === undefined || spec.policy === null ? 'pull-push' : (asString(spec.policy) as 'pull' | 'push' | 'pull-push'),
  };
}

function environmentOf(body: YMap, variables: Record<string, string>): EnvironmentSpec | null {
  if (body.environment === undefined || body.environment === null) return null;
  const spec = isMap(body.environment) ? body.environment : { name: asString(body.environment) };
  const name = expandVariables(asString(spec.name), variables);
  const autoStop = spec.auto_stop_in === undefined || spec.auto_stop_in === null ? null : parseDuration(spec.auto_stop_in);
  const tier = spec.tier === undefined || spec.tier === null ? (name === 'production' ? 'production' : 'other') : asString(spec.tier);
  return {
    name,
    action: spec.action === undefined || spec.action === null ? 'start' : (asString(spec.action) as 'start' | 'stop'),
    auto_stop_in_ms: autoStop === null ? null : autoStop.ms,
    on_stop: spec.on_stop === undefined || spec.on_stop === null ? null : asString(spec.on_stop),
    tier,
  };
}

function finish(
  errors: { line: number; text: string }[],
  jobs: JobSpec[],
  stages: string[],
): ExpandResult {
  const unique = new Map<string, { line: number; text: string }>();
  for (const error of errors) unique.set(`${error.line}:${error.text}`, error);
  const sorted = [...unique.values()]
    .sort((a, b) => a.line - b.line || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
    .slice(0, 20)
    .map((error) => `Line ${error.line}: ${error.text}`);
  const valid = sorted.length === 0;
  return {
    valid,
    errors: sorted,
    summary: valid ? `Valid. ${jobs.length} jobs in ${stages.length} stages.` : `Lint found ${sorted.length} problems.`,
    jobs: valid ? jobs : [],
    stages,
    workflowExcluded: false,
  };
}

export function lintSummary(result: ExpandResult): string {
  if (result.valid) return result.summary;
  return result.errors.length === 1 ? 'Lint found 1 problem.' : `Lint found ${result.errors.length} problems.`;
}

export function graphPositions(jobs: JobSpec[]): Map<string, { layer: number; row: number; x: number; y: number }> {
  const byName = new Map(jobs.map((job) => [job.name, job]));
  const layers = new Map<string, number>();
  const layerOf = (job: JobSpec, depth: number): number => {
    const known = layers.get(job.name);
    if (known !== undefined) return known;
    if (depth > 50) return job.stage_index;
    let value = job.stage_index;
    if (job.needs !== null && job.needs.length > 0) {
      for (const need of job.needs) {
        const target = byName.get(need);
        if (target === undefined) continue;
        value = Math.max(value, layerOf(target, depth + 1) + 1);
      }
    }
    layers.set(job.name, value);
    return value;
  };
  for (const job of jobs) layerOf(job, 0);
  const out = new Map<string, { layer: number; row: number; x: number; y: number }>();
  const grouped = new Map<number, JobSpec[]>();
  for (const job of jobs) {
    const layer = layers.get(job.name) ?? job.stage_index;
    const bucket = grouped.get(layer) ?? [];
    bucket.push(job);
    grouped.set(layer, bucket);
  }
  for (const [layer, bucket] of grouped) {
    bucket
      .slice()
      .sort((a, b) => a.stage_index - b.stage_index || a.config_order - b.config_order)
      .forEach((job, row) => {
        out.set(job.name, { layer, row, x: 40 + layer * 240, y: 40 + row * 96 });
      });
  }
  return out;
}
