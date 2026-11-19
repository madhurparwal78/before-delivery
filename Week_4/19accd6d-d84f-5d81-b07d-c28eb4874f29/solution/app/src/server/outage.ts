export type OutageService = "minio" | "meilisearch" | "live";

/** Simulated outages that the grading route switches; they only ever mark a dependency as unreachable. */
export const outage: Record<OutageService, boolean> = { minio: false, meilisearch: false, live: false };
