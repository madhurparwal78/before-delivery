// Shapes produced by the pipeline-config engine.
export type JobWhen = "on_success" | "on_failure" | "always" | "manual" | "delayed";
export type RetryReason = "script_failure" | "job_timeout" | "system_failure";
type ArtifactWhen = "on_success" | "on_failure" | "always";
export type CachePolicy = "pull" | "push" | "pull-push";

export interface RetrySpec {
  readonly max: number;
  readonly when: readonly RetryReason[];
}

export interface ArtifactsSpec {
  readonly paths: string[];
  readonly expireInMs: number | null | "never";
  readonly when: ArtifactWhen;
}

export interface CacheSpec {
  readonly key: string;
  readonly fallbackKeys: string[];
  readonly paths: string[];
  readonly policy: CachePolicy;
}

export interface EnvironmentSpec {
  readonly name: string;
  readonly action: "start" | "stop";
  readonly autoStopInMs: number | null;
  readonly onStop: string | null;
  readonly tier: string | null;
}

export interface ResolvedJob {
  readonly name: string;
  readonly line: number;
  readonly stage: string;
  readonly stageIndex: number;
  readonly script: string[];
  readonly needs: string[] | null;
  readonly dependencies: string[] | null;
  readonly when: JobWhen;
  readonly startInMs: number | null;
  readonly allowFailure: boolean;
  readonly retry: RetrySpec;
  readonly timeoutMs: number | null;
  readonly interruptible: boolean;
  readonly resourceGroup: string | null;
  readonly variables: Record<string, string>;
  readonly matrix: Record<string, string>;
  readonly artifacts: ArtifactsSpec | null;
  readonly cache: CacheSpec | null;
  readonly environment: EnvironmentSpec | null;
}

export interface ConfigResult {
  readonly errors: string[];
  readonly stages: string[];
  readonly jobs: ResolvedJob[];
  readonly workflowPasses: boolean;
  readonly summary: string;
}

export interface ResolveOptions {
  readonly mainPath: string;
  readonly content: string;
  readonly load: (path: string) => string | null;
  readonly predefined: Readonly<Record<string, string>>;
  readonly variables: Readonly<Record<string, string>>;
  readonly changedFiles: readonly string[] | null;
  readonly treeFiles: readonly string[];
  readonly retryMax: number;
  readonly defaultTimeoutMs: number;
}
