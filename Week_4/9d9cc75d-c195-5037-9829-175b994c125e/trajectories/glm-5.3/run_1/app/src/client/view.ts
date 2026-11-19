/** Shared view-model helpers for the browser. */

export interface ViewColumn {
  name: string;
  role: "dimension" | "measure";
}

export interface ViewRow {
  values: (string | number | boolean | null)[];
}

export interface QueryAnswer {
  gen: number;
  chart: string;
  columns: ViewColumn[];
  rows: ViewRow[];
  total: (number | null)[] | null;
  reference_lines: { type: string; value: number | null }[];
  trend: { slope: number; intercept: number } | null;
  notices: string[];
}

/** The colour rule for a mark: categorical or sequential. */
export function markColor(index: number, seqValue: number | null, seqMin: number, seqMax: number, isSequential: boolean): string {
  if (isSequential && seqValue !== null) {
    const t = seqMax === seqMin ? 1 : (seqValue - seqMin) / (seqMax - seqMin);
    const low = [253, 241, 247];
    const high = [233, 71, 159];
    const ch = low.map((l, i) => Math.round(l + (high[i] - l) * t + Number.EPSILON));
    return `${ch[0]}, ${ch[1]}, ${ch[2]}`;
  }
  const colors: [number, number, number][] = [
    [233, 71, 159],
    [26, 10, 20],
    [217, 225, 63],
    [110, 74, 94],
    [234, 160, 205],
  ];
  const c = colors[index % colors.length];
  return `${c[0]}, ${c[1]}, ${c[2]}`;
}

export function markPattern(index: number, isSequential: boolean): string {
  if (isSequential) return "solid";
  const patterns = ["solid", "dots", "stripes", "checks", "rings"];
  return patterns[index % patterns.length];
}
