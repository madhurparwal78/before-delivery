// The published limits (GET /api/limits). Every limit is inclusive.
export const LIMITS = {
  maxJsonBytes: 1_000_000,
  maxImportBytes: 5_000_000,
  maxImportExpandedBytes: 50_000_000,
  maxCompressionRatio: 100,
  maxImportCells: 100_000,
  maxSheets: 20,
  maxColumns: 26,
  maxRows: 500,
  maxInputChars: 2000,
  maxFormulaNodes: 500,
  maxFormulaCells: 10_000,
  maxDependencyDepth: 256,
  maxOpsPerBatch: 200,
  maxSearchChars: 100,
} as const;

/** A whole request carrying an import may be this much larger than its file part. */
export const MAX_IMPORT_REQUEST_BYTES = 5_100_000;
