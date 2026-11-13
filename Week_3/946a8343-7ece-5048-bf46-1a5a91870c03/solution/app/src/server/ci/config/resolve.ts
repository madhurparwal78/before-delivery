// The pipeline-config engine: file text in, validated and expanded jobs plus lint messages out. No I/O.
import { findCycles } from "./cycles.ts";
import { readVariables } from "./fields.ts";
import { loadMergedConfig } from "./include.ts";
import { JOB_KEYS, readJob, type JobDefinition } from "./job.ts";
import { asMap, EMPTY_MAP, entryOf, mergeMaps, textsOf, withoutKey } from "./nodes.ts";
import { messages, Problems } from "./problems.ts";
import { firstMatchingRule, readRules } from "./rules.ts";
import type { ConfigResult, ResolvedJob, ResolveOptions } from "./types.ts";
import type { YamlEntry, YamlMap } from "./yaml.ts";

export type * from "./types.ts";

const DEFAULT_STAGES = ["build", "test", "deploy"];
const RESERVED_KEYS = new Set(["stages", "default", "variables", "workflow"]);
const MAX_EXTENDS_LEVELS = 5;

interface Instance {
  readonly name: string;
  readonly definition: JobDefinition;
  readonly matrix: Record<string, string>;
}

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

function checkKeys(map: YamlMap, allowed: readonly string[], problems: Problems): void {
  for (const entry of map.entries) {
    if (!allowed.includes(entry.key)) problems.add(entry.line, messages.unknownKeyword(entry.key));
  }
}

function expandMatrix(definition: JobDefinition): Instance[] {
  let combinations: [string, string][][] = [[]];
  for (const { key, values } of definition.matrix) {
    combinations = combinations.flatMap((prefix) => values.map((value): [string, string][] => [...prefix, [key, value]]));
  }
  if (definition.matrix.length === 0) return [{ name: definition.name, definition, matrix: {} }];
  return combinations.map((combination) => ({
    name: `${definition.name} [${combination.map(([, value]) => value).join(", ")}]`,
    definition,
    matrix: Object.fromEntries(combination),
  }));
}

export function resolvePipelineConfig(options: ResolveOptions): ConfigResult {
  const problems = new Problems();
  const failed = (stages: string[], workflowPasses: boolean): ConfigResult => ({
    errors: problems.lines(),
    stages,
    jobs: [],
    workflowPasses,
    summary: "",
  });

  const merged = loadMergedConfig(options.mainPath, options.content, { load: options.load, problems });
  if (!merged || problems.unreadable) return failed([], true);

  const stagesList = textsOf(entryOf(merged, "stages")?.value);
  const stages = stagesList.length > 0 ? stagesList : DEFAULT_STAGES;
  const topVariables = readVariables(entryOf(merged, "variables")?.value);
  const defaults = asMap(entryOf(merged, "default")?.value) ?? EMPTY_MAP;
  checkKeys(defaults, JOB_KEYS, problems);

  const baseVars = { ...options.predefined, ...topVariables, ...options.variables };
  const workflow = asMap(entryOf(merged, "workflow")?.value);
  if (workflow) checkKeys(workflow, ["rules"], problems);
  const workflowRules = workflow ? readRules(entryOf(workflow, "rules")?.value, problems) : null;
  const workflowMatch = workflowRules
    ? firstMatchingRule(workflowRules, { vars: baseVars, changedFiles: options.changedFiles, treeFiles: options.treeFiles })
    : null;
  const workflowPasses = workflowRules === null || (workflowMatch !== null && workflowMatch.when !== "never");

  const definitions = new Map<string, YamlEntry & { readonly map: YamlMap }>();
  for (const entry of merged.entries) {
    if (RESERVED_KEYS.has(entry.key)) continue;
    const map = asMap(entry.value);
    if (!map) {
      problems.add(entry.line, messages.unknownKeyword(entry.key));
      continue;
    }
    checkKeys(map, JOB_KEYS, problems);
    definitions.set(entry.key, { ...entry, map });
  }
  const order = [...definitions.keys()];

  const extendsEdges = new Map<string, string[]>();
  for (const name of order) {
    const extendsEntry = entryOf(definitions.get(name)?.map ?? EMPTY_MAP, "extends");
    const parents = textsOf(extendsEntry?.value);
    for (const parent of parents) {
      if (!definitions.has(parent)) problems.add(extendsEntry?.line ?? 1, messages.extendsUnknown(name, parent));
    }
    extendsEdges.set(name, parents);
  }
  for (const cycle of findCycles(order, extendsEdges)) {
    const first = cycle[0] ?? "";
    problems.add(definitions.get(first)?.line ?? 1, messages.extendsCycle(cycle));
  }

  const withParents = (name: string, chain: readonly string[]): YamlMap => {
    const own = definitions.get(name)?.map ?? EMPTY_MAP;
    let result: YamlMap = EMPTY_MAP;
    if (chain.length <= MAX_EXTENDS_LEVELS) {
      for (const parent of extendsEdges.get(name) ?? []) {
        if (definitions.has(parent) && !chain.includes(parent)) {
          result = mergeMaps(result, withParents(parent, [...chain, parent]));
        }
      }
    }
    return mergeMaps(result, withoutKey(own, "extends"));
  };

  const readContext = { stages, retryMax: options.retryMax, problems };
  const definitionsInOrder: JobDefinition[] = [];
  for (const name of order) {
    const definition = definitions.get(name);
    if (!definition || isHidden(name)) continue;
    let map = withParents(name, [name]);
    for (const entry of defaults.entries) {
      if (!entryOf(map, entry.key)) map = { ...map, entries: [...map.entries, entry] };
    }
    definitionsInOrder.push(readJob(name, definition.line, map, readContext));
  }

  const requestVars = options.variables;
  const instancesOf = new Map(definitionsInOrder.map((definition) => [definition, expandMatrix(definition)] as const));
  const survivors: { instance: Instance; job: Omit<ResolvedJob, "needs" | "dependencies"> }[] = [];
  for (const [definition, instances] of instancesOf) {
    for (const instance of instances) {
      const jobVars = { ...topVariables, ...definition.variables, ...instance.matrix };
      const rule = definition.rules
        ? firstMatchingRule(definition.rules, {
            vars: { ...options.predefined, ...jobVars, ...requestVars },
            changedFiles: options.changedFiles,
            treeFiles: options.treeFiles,
          })
        : null;
      if (definition.rules && (!rule || rule.when === "never")) continue;
      const when = rule?.when && rule.when !== "never" ? rule.when : definition.when;
      survivors.push({
        instance,
        job: {
          name: instance.name,
          line: definition.line,
          stage: definition.stage,
          stageIndex: definition.stageIndex,
          script: definition.script,
          when,
          startInMs: rule?.startInMs ?? definition.startInMs,
          allowFailure: rule?.allowFailure ?? definition.allowFailure ?? when === "manual",
          retry: definition.retry,
          timeoutMs: definition.timeoutMs,
          interruptible: definition.interruptible,
          resourceGroup: definition.resourceGroup,
          variables: { ...jobVars, ...rule?.variables },
          matrix: instance.matrix,
          artifacts: definition.artifacts,
          cache: definition.cache,
          environment: definition.environment,
        },
      });
    }
  }

  const everyInstance = new Map<string, JobDefinition>();
  for (const [definition, instances] of instancesOf) {
    for (const instance of instances) everyInstance.set(instance.name, definition);
  }
  const aliveNames = new Set(survivors.map(({ instance }) => instance.name));
  const aliveByBase = new Map<string, string[]>();
  for (const { instance } of survivors) {
    aliveByBase.set(instance.definition.name, [...(aliveByBase.get(instance.definition.name) ?? []), instance.name]);
  }
  const baseOf = new Map(definitionsInOrder.map((definition) => [definition.name, definition]));
  const lookup = (name: string): { definition: JobDefinition; alive: boolean } | null => {
    const base = baseOf.get(name);
    if (base) return { definition: base, alive: aliveByBase.has(name) };
    const definition = everyInstance.get(name);
    return definition ? { definition, alive: aliveNames.has(name) } : null;
  };
  const expandNames = (name: string): string[] => {
    const expansions = aliveByBase.get(name);
    if (expansions) return expansions;
    return aliveNames.has(name) ? [name] : [];
  };

  const needsEdges = new Map<string, string[]>();
  for (const definition of definitionsInOrder) {
    if (!aliveByBase.has(definition.name)) continue;
    const targets: string[] = [];
    for (const need of definition.needs ?? []) {
      const target = lookup(need);
      if (!target) {
        problems.add(definition.needsLine, messages.needsMissing(definition.name, need));
      } else if (
        target.definition.stageIndex > definition.stageIndex &&
        definition.stageIndex >= 0 &&
        target.definition.stageIndex >= 0
      ) {
        problems.add(definition.needsLine, messages.needsLater(definition.name, need));
      } else if (!target.alive) {
        problems.add(definition.needsLine, messages.needsRemoved(definition.name, need));
      } else {
        targets.push(target.definition.name);
      }
    }
    needsEdges.set(definition.name, targets);
  }
  const needsOrder = definitionsInOrder.filter((definition) => aliveByBase.has(definition.name)).map((d) => d.name);
  for (const cycle of findCycles(needsOrder, needsEdges)) {
    const first = baseOf.get(cycle[0] ?? "");
    problems.add(first?.line ?? 1, messages.needsCycle(cycle));
  }

  if (problems.any) return failed(stages, workflowPasses);

  const jobs: ResolvedJob[] = survivors.map(({ instance, job }) => {
    const { needs, dependencies } = instance.definition;
    return {
      ...job,
      needs: needs && [...new Set(needs.flatMap(expandNames))],
      dependencies: dependencies && [...new Set(dependencies.flatMap((name) => {
        const expanded = expandNames(name);
        return expanded.length > 0 ? expanded : [name];
      }))],
    };
  });
  return {
    errors: [],
    stages,
    jobs,
    workflowPasses,
    summary: `Valid. ${jobs.length} jobs in ${stages.length} stages.`,
  };
}
