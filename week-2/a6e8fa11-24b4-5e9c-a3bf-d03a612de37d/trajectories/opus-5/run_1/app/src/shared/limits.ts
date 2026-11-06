export const LIMITS = {
  maxJsonBytes: 1000000,
  maxImportBytes: 5000000,
  maxImportExpandedBytes: 50000000,
  maxCompressionRatio: 100,
  maxImportCells: 100000,
  maxSheets: 20,
  maxColumns: 26,
  maxRows: 500,
  maxInputChars: 2000,
  maxFormulaNodes: 500,
  maxFormulaCells: 10000,
  maxDependencyDepth: 256,
  maxOpsPerBatch: 200,
  maxSearchChars: 100,
} as const;

export const MAX_IMPORT_REQUEST_BYTES = 5100000;
export const MAX_SHEET_NAME_CHARS = 31;
export const MAX_WORKBOOK_NAME_CHARS = 80;
export const MAX_CHART_TITLE_CHARS = 60;
export const MAX_VERSION_LABEL_CHARS = 60;
export const MIN_PASSWORD_CHARS = 10;
export const MIN_SHARE_SECONDS = 10;
export const MAX_SHARE_SECONDS = 2592000;
