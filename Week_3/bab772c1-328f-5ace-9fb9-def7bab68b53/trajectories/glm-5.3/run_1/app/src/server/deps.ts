// Every dependency client maps transport failures to the brief's 503 codes in
// one place. All probes use a 3-second timeout unless stated otherwise.

export type DependencyCode = "storage" | "search" | "queue" | "cache" | "billing" | "webhooks" | "ephemeris" | "renderer";

export const DEPENDENCY_503: Record<DependencyCode, string> = {
  storage: "storage_unavailable",
  search: "search_unavailable",
  queue: "queue_unavailable",
  cache: "cache_unavailable",
  billing: "billing_unavailable",
  webhooks: "webhooks_unavailable",
  ephemeris: "ephemeris_unavailable",
  renderer: "renderer_unavailable",
};

export class DependencyError extends Error {
  readonly dependency: DependencyCode;
  constructor(dependency: DependencyCode) {
    super(`${dependency} unreachable`);
    this.dependency = dependency;
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DependencyError) throw err;
    throw new Error(`fetch failed: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`environment variable ${name} is not set`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export function retrySeconds(): number {
  const raw = Number(optionalEnv("DEPENDENCY_RETRY_SECONDS") ?? "5");
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}
