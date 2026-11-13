// Reading one job's merged keys into its definition, before rules and matrix expansion.
import { readBool, readDuration, readText, readVariables, oneOf } from "./fields.ts";
import { asMap, asScalar, entryOf, textsOf } from "./nodes.ts";
import { messages, type Problems, UNREADABLE_LINE } from "./problems.ts";
import { JOB_WHENS, readRules, type Rule } from "./rules.ts";
import type {
  ArtifactsSpec,
  CachePolicy,
  CacheSpec,
  EnvironmentSpec,
  JobWhen,
  RetryReason,
  RetrySpec,
} from "./types.ts";
import type { YamlMap } from "./yaml.ts";

export const JOB_KEYS = [
  "stage",
  "extends",
  "script",
  "needs",
  "dependencies",
  "rules",
  "when",
  "start_in",
  "allow_failure",
  "retry",
  "timeout",
  "interruptible",
  "resource_group",
  "variables",
  "matrix",
  "artifacts",
  "cache",
  "environment",
];

const DEFAULT_STAGE = "test";
const RETRY_REASONS: readonly RetryReason[] = ["script_failure", "job_timeout", "system_failure"];
const ARTIFACT_WHENS = ["on_success", "on_failure", "always"] as const;
const CACHE_POLICIES: readonly CachePolicy[] = ["pull", "push", "pull-push"];

export interface JobDefinition {
  readonly name: string;
  readonly line: number;
  readonly stage: string;
  readonly stageIndex: number;
  readonly script: string[];
  readonly needs: string[] | null;
  readonly dependencies: string[] | null;
  readonly needsLine: number;
  readonly when: JobWhen;
  readonly startInMs: number | null;
  readonly allowFailure: boolean | null;
  readonly retry: RetrySpec;
  readonly timeoutMs: number | null;
  readonly interruptible: boolean;
  readonly resourceGroup: string | null;
  readonly variables: Record<string, string>;
  readonly matrix: { readonly key: string; readonly values: string[] }[];
  readonly artifacts: ArtifactsSpec | null;
  readonly cache: CacheSpec | null;
  readonly environment: EnvironmentSpec | null;
  readonly rules: Rule[] | null;
}

interface ReadContext {
  readonly stages: readonly string[];
  readonly retryMax: number;
  readonly problems: Problems;
}

function readRetry(map: YamlMap, context: ReadContext): RetrySpec {
  const entry = entryOf(map, "retry");
  const detail = asMap(entry?.value);
  const maxEntry = detail ? entryOf(detail, "max") : entry;
  const max = Number(asScalar(maxEntry?.value)?.value);
  if (maxEntry && Number.isInteger(max) && max > context.retryMax) {
    context.problems.add(maxEntry.line, messages.retryTooHigh(context.retryMax));
  }
  const reasons = detail ? textsOf(entryOf(detail, "when")?.value) : [];
  const when = RETRY_REASONS.filter((reason) => !detail || !entryOf(detail, "when") || reasons.includes(reason));
  return { max: Number.isInteger(max) && max > 0 ? max : 0, when };
}

function readArtifacts(map: YamlMap, context: ReadContext): ArtifactsSpec | null {
  const artifacts = asMap(entryOf(map, "artifacts")?.value);
  if (!artifacts) return null;
  return {
    paths: textsOf(entryOf(artifacts, "paths")?.value),
    expireInMs: readDuration(artifacts, "expire_in", context.problems, true),
    when: oneOf(readText(artifacts, "when"), ARTIFACT_WHENS) ?? "on_success",
  };
}

function readCache(map: YamlMap): CacheSpec | null {
  const cache = asMap(entryOf(map, "cache")?.value);
  if (!cache) return null;
  return {
    key: readText(cache, "key") ?? "default",
    fallbackKeys: textsOf(entryOf(cache, "fallback_keys")?.value),
    paths: textsOf(entryOf(cache, "paths")?.value),
    policy: oneOf(readText(cache, "policy"), CACHE_POLICIES) ?? "pull-push",
  };
}

function readEnvironment(map: YamlMap, context: ReadContext): EnvironmentSpec | null {
  const node = entryOf(map, "environment")?.value;
  const shorthand = asScalar(node);
  if (shorthand && shorthand.value !== null) {
    return { name: shorthand.text, action: "start", autoStopInMs: null, onStop: null, tier: null };
  }
  const environment = asMap(node);
  const name = environment ? readText(environment, "name") : null;
  if (!environment || name === null) return null;
  return {
    name,
    action: readText(environment, "action") === "stop" ? "stop" : "start",
    autoStopInMs: readDuration(environment, "auto_stop_in", context.problems, false),
    onStop: readText(environment, "on_stop"),
    tier: readText(environment, "tier"),
  };
}

function readScript(map: YamlMap, problems: Problems): string[] {
  const script: string[] = [];
  const node = entryOf(map, "script")?.value;
  const items = node?.kind === "list" ? node.items : node ? [node] : [];
  for (const item of items) {
    if (item.kind === "scalar") {
      if (item.value !== null) script.push(item.text);
    } else {
      problems.add(item.line, UNREADABLE_LINE);
    }
  }
  return script;
}

function readNames(map: YamlMap, key: string): string[] | null {
  const entry = entryOf(map, key);
  return entry ? textsOf(entry.value) : null;
}

export function readJob(name: string, line: number, map: YamlMap, context: ReadContext): JobDefinition {
  const { problems } = context;
  const stageEntry = entryOf(map, "stage");
  const stage = readText(map, "stage") ?? DEFAULT_STAGE;
  const stageIndex = context.stages.indexOf(stage);
  if (stageIndex < 0) problems.add(stageEntry?.line ?? line, messages.unknownStage(name, stage));

  const script = readScript(map, problems);
  if (script.length === 0) problems.add(line, messages.noScript(name));

  const when = oneOf(readText(map, "when"), JOB_WHENS) ?? "on_success";
  const matrix = asMap(entryOf(map, "matrix")?.value);
  return {
    name,
    line,
    stage,
    stageIndex,
    script,
    needs: readNames(map, "needs"),
    needsLine: entryOf(map, "needs")?.line ?? line,
    dependencies: readNames(map, "dependencies"),
    when,
    startInMs: readDuration(map, "start_in", problems, false),
    allowFailure: readBool(map, "allow_failure"),
    retry: readRetry(map, context),
    timeoutMs: readDuration(map, "timeout", problems, false),
    interruptible: readBool(map, "interruptible") ?? false,
    resourceGroup: readText(map, "resource_group"),
    variables: readVariables(entryOf(map, "variables")?.value),
    matrix: (matrix?.entries ?? []).map((entry) => ({ key: entry.key, values: textsOf(entry.value) })),
    artifacts: readArtifacts(map, context),
    cache: readCache(map),
    environment: readEnvironment(map, context),
    rules: readRules(entryOf(map, "rules")?.value, problems),
  };
}
