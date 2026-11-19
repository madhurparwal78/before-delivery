/** The table calculation functions: a formula that uses one of them lands at the table calculation step. */
export const TABLE_CALCULATION_FUNCTIONS = ['RUN_TOTAL', 'PREV_DIFF', 'SHARE', 'RANK_OF'] as const;

/** The 27 functions of the calculation language, as the suggestion list offers them. */
export const FUNCTIONS: readonly string[] = [
  'SUM', 'AVG', 'MEDIAN', 'MIN', 'MAX', 'COUNT', 'COUNT_UNIQUE',
  'IF', 'IFNULL', 'ISNULL',
  'ABS', 'ROUND',
  'UPPER', 'LOWER', 'LEN', 'LEFT', 'RIGHT', 'CONTAINS',
  'PART_OF', 'TRUNC_TO', 'DAYS_BETWEEN',
  'NUM', 'TEXT',
  ...TABLE_CALCULATION_FUNCTIONS,
];
