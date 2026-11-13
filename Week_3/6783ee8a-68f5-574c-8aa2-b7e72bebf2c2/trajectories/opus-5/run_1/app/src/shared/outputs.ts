import type { NotebookOutput, TableOutputData } from './types.js';

export const TABLE_MIME = 'application/vnd.brackenpad.table+json';

export const DISPLAY_MIMES = [
  'text/plain',
  'text/markdown',
  'text/html',
  'image/svg+xml',
  TABLE_MIME,
] as const;

export function withThousands(value: number): string {
  return value.toLocaleString('en-US');
}

export function overCapNotice(byteCap: number): string {
  return `Output removed: larger than ${withThousands(byteCap)} bytes`;
}

const encoder = new TextEncoder();

export function outputByteSize(output: NotebookOutput): number {
  return encoder.encode(JSON.stringify(output)).length;
}

/** True when this output's own JSON is larger than the byte cap. */
export function isOverByteCap(output: NotebookOutput, byteCap: number): boolean {
  return outputByteSize(output) > byteCap;
}

/**
 * The one place a run output over the byte cap is replaced, before storing.
 */
export function capRunOutputs(outputs: NotebookOutput[], byteCap: number): NotebookOutput[] {
  return outputs.map((output) =>
    isOverByteCap(output, byteCap)
      ? {
          output_type: 'display_data',
          data: { 'text/plain': overCapNotice(byteCap) },
          metadata: {},
        }
      : output,
  );
}

function outputData(output: NotebookOutput): Record<string, unknown> | null {
  const data = output.data;
  return data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

/** The table payload of an output, or null when it is not a table output. */
export function tableData(output: NotebookOutput): TableOutputData | null {
  const data = outputData(output);
  if (!data) return null;
  const payload = data[TABLE_MIME];
  if (payload === null || typeof payload !== 'object') return null;
  const candidate = payload as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(candidate.columns) || !Array.isArray(candidate.rows)) return null;
  return {
    columns: candidate.columns.map((column) => String(column)),
    rows: candidate.rows.filter((row): row is unknown[] => Array.isArray(row)),
  };
}

/** The text of a stream output, split into display lines. */
export function streamLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function streamText(output: NotebookOutput): string {
  const text = output.text;
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) return text.map((part) => String(part)).join('');
  return '';
}

export function plainText(output: NotebookOutput): string {
  const data = outputData(output);
  if (!data) return '';
  const value = data['text/plain'];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => String(part)).join('');
  return '';
}

export function rowRangeText(offset: number, shown: number, total: number): string {
  const first = total === 0 ? 0 : offset + 1;
  const last = offset + shown;
  return `Rows ${first}–${last} of ${total}`;
}
