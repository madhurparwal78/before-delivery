export interface Limits {
  maxDocBytes: number;
  maxDepth: number;
  scanLimit: number;
  pageSize: number;
  importMaxLines: number;
  schemaSample: number;
  previewDocs: number;
  maxStages: number;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return fallback;
  return n;
}

export function readLimitsFromEnv(): Limits {
  return {
    maxDocBytes: int("JARFUL_MAX_DOC_BYTES", 16384),
    maxDepth: int("JARFUL_MAX_DEPTH", 20),
    scanLimit: int("JARFUL_SCAN_LIMIT", 10000),
    pageSize: int("JARFUL_PAGE_SIZE", 20),
    importMaxLines: int("JARFUL_IMPORT_MAX_LINES", 5000),
    schemaSample: int("JARFUL_SCHEMA_SAMPLE", 1000),
    previewDocs: int("JARFUL_PREVIEW_DOCS", 5),
    maxStages: int("JARFUL_MAX_STAGES", 20),
  };
}

/** Single published definition of the query depth limit (DP-79). */
export const QUERY_DEPTH_LIMIT = 32;
