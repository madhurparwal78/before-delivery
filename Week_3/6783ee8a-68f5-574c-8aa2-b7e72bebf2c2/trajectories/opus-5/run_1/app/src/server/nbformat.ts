import type { CellType, FieldError, NotebookOutput } from '../shared/types.js';

export const CELL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface ImportedAttachment {
  name: string;
  contentType: string;
  bytes: Buffer;
}

export interface ImportedCell {
  id: string | null;
  cell_type: CellType;
  source: string;
  metadata: Record<string, unknown>;
  execution_count: number | null;
  outputs: NotebookOutput[];
  attachments: ImportedAttachment[];
}

export interface ImportedNotebook {
  cells: ImportedCell[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringOrStringList(value: unknown): boolean {
  return typeof value === 'string' || (Array.isArray(value) && value.every((part) => typeof part === 'string'));
}

function joinText(value: string | string[]): string {
  return typeof value === 'string' ? value : value.join('');
}

function isWholeOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function imageType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const head = bytes.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  return null;
}

const OUTPUT_TYPES = ['stream', 'execute_result', 'display_data', 'error'];

class Collector {
  readonly errors: FieldError[] = [];

  add(path: string, message: string): void {
    this.errors.push({ path, message });
  }

  /** Reports a missing required key at the path it would have. */
  required(path: string): void {
    this.add(path, 'is required');
  }
}

function validateOutput(collector: Collector, path: string, output: unknown): void {
  if (!isObject(output) || output.output_type === undefined) {
    collector.required(`${path}.output_type`);
    return;
  }
  const outputType = output.output_type;
  if (typeof outputType !== 'string' || !OUTPUT_TYPES.includes(outputType)) {
    collector.add(
      `${path}.output_type`,
      'must be "stream", "execute_result", "display_data" or "error"',
    );
    return;
  }
  if (outputType === 'stream') {
    if (output.name === undefined) collector.required(`${path}.name`);
    else if (output.name !== 'stdout' && output.name !== 'stderr') {
      collector.add(`${path}.name`, 'must be "stdout" or "stderr"');
    }
    if (output.text === undefined) collector.required(`${path}.text`);
    else if (!isStringOrStringList(output.text)) {
      collector.add(`${path}.text`, 'must be a string or a list of strings');
    }
    return;
  }
  if (outputType === 'execute_result' || outputType === 'display_data') {
    if (outputType === 'execute_result') {
      if (output.execution_count === undefined) collector.required(`${path}.execution_count`);
      else if (!isWholeOrNull(output.execution_count)) {
        collector.add(`${path}.execution_count`, 'must be null or a whole number of at least 0');
      }
    }
    if (output.data === undefined) collector.required(`${path}.data`);
    else if (!isObject(output.data)) collector.add(`${path}.data`, 'must be an object');
    if (output.metadata === undefined) collector.required(`${path}.metadata`);
    else if (!isObject(output.metadata)) collector.add(`${path}.metadata`, 'must be an object');
    return;
  }
  if (output.ename === undefined) collector.required(`${path}.ename`);
  else if (typeof output.ename !== 'string') collector.add(`${path}.ename`, 'must be a string');
  if (output.evalue === undefined) collector.required(`${path}.evalue`);
  else if (typeof output.evalue !== 'string') collector.add(`${path}.evalue`, 'must be a string');
  if (output.traceback === undefined) collector.required(`${path}.traceback`);
  else if (!Array.isArray(output.traceback) || !output.traceback.every((line) => typeof line === 'string')) {
    collector.add(`${path}.traceback`, 'must be a list of strings');
  }
}

/** Checks run outputs with the same messages the import list uses. */
export function outputErrors(outputs: unknown[], prefix: string): FieldError[] {
  const collector = new Collector();
  outputs.forEach((output, index) => validateOutput(collector, `${prefix}[${index}]`, output));
  return collector.errors;
}

/**
 * Checks a notebook file against the accepted subset, reporting every error it
 * finds at its JSON path, and returns the working copy when the file is good.
 */
export function parseNotebookFile(text: string): {
  errors: FieldError[];
  notebook: ImportedNotebook | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { errors: [{ path: 'file', message: 'is not valid JSON' }], notebook: null };
  }
  const collector = new Collector();
  const root = isObject(parsed) ? parsed : {};

  if (root.nbformat === undefined) collector.required('nbformat');
  else if (root.nbformat !== 4) collector.add('nbformat', 'must be 4');

  let minor: number | null = null;
  if (root.nbformat_minor === undefined) collector.required('nbformat_minor');
  else if (root.nbformat_minor !== 4 && root.nbformat_minor !== 5) {
    collector.add('nbformat_minor', 'must be 4 or 5');
  } else minor = root.nbformat_minor;

  if (root.metadata === undefined) collector.required('metadata');
  else if (!isObject(root.metadata)) collector.add('metadata', 'must be an object');

  if (root.cells === undefined) {
    collector.required('cells');
    return { errors: collector.errors, notebook: null };
  }
  if (!Array.isArray(root.cells)) {
    collector.add('cells', 'must be an array');
    return { errors: collector.errors, notebook: null };
  }

  const cells: ImportedCell[] = [];
  const idSeenAt = new Map<string, number>();
  root.cells.forEach((rawCell: unknown, index: number) => {
    const path = `cells[${index}]`;
    if (!isObject(rawCell)) {
      collector.add(path, 'must be an object');
      return;
    }
    let cellType: CellType | null = null;
    if (rawCell.cell_type === undefined) collector.required(`${path}.cell_type`);
    else if (rawCell.cell_type !== 'code' && rawCell.cell_type !== 'markdown') {
      collector.add(`${path}.cell_type`, 'must be "code" or "markdown"');
    } else cellType = rawCell.cell_type;

    if (rawCell.source === undefined) collector.required(`${path}.source`);
    else if (!isStringOrStringList(rawCell.source)) {
      collector.add(`${path}.source`, 'must be a string or a list of strings');
    }

    if (rawCell.metadata === undefined) collector.required(`${path}.metadata`);
    else if (!isObject(rawCell.metadata)) collector.add(`${path}.metadata`, 'must be an object');

    let id: string | null = null;
    if (rawCell.id === undefined) {
      if (minor === 5) collector.required(`${path}.id`);
    } else if (typeof rawCell.id !== 'string' || !CELL_ID_PATTERN.test(rawCell.id)) {
      collector.add(`${path}.id`, 'must be 1 to 64 characters of letters, digits, "-" or "_"');
    } else {
      const seenAt = idSeenAt.get(rawCell.id);
      if (seenAt === undefined) {
        idSeenAt.set(rawCell.id, index);
        id = rawCell.id;
      } else {
        collector.add(`${path}.id`, `duplicates cells[${seenAt}].id`);
      }
    }

    const outputs: NotebookOutput[] = [];
    const attachments: ImportedAttachment[] = [];
    let executionCount: number | null = null;

    if (cellType === 'code') {
      if (rawCell.execution_count === undefined) collector.required(`${path}.execution_count`);
      else if (!isWholeOrNull(rawCell.execution_count)) {
        collector.add(`${path}.execution_count`, 'must be null or a whole number of at least 0');
      } else executionCount = rawCell.execution_count as number | null;

      if (rawCell.outputs === undefined) collector.required(`${path}.outputs`);
      else if (!Array.isArray(rawCell.outputs)) collector.add(`${path}.outputs`, 'must be an array');
      else {
        rawCell.outputs.forEach((output: unknown, outputIndex: number) => {
          validateOutput(collector, `${path}.outputs[${outputIndex}]`, output);
          if (isObject(output)) outputs.push(output as NotebookOutput);
        });
      }
    } else if (cellType === 'markdown') {
      if (rawCell.outputs !== undefined) {
        collector.add(`${path}.outputs`, 'is not allowed on a markdown cell');
      }
      if (isObject(rawCell.attachments)) {
        for (const [name, value] of Object.entries(rawCell.attachments)) {
          const attachmentPath = `${path}.attachments["${name}"]`;
          const encoded = isObject(value)
            ? Object.values(value).find((part): part is string => typeof part === 'string')
            : undefined;
          if (encoded === undefined) {
            collector.add(attachmentPath, 'must be a PNG, JPEG or GIF image');
            continue;
          }
          const bytes = Buffer.from(encoded, 'base64');
          const contentType = imageType(bytes);
          if (contentType === null) {
            collector.add(attachmentPath, 'must be a PNG, JPEG or GIF image');
            continue;
          }
          attachments.push({ name, contentType, bytes });
        }
      }
    }

    if (cellType !== null) {
      cells.push({
        id,
        cell_type: cellType,
        source: isStringOrStringList(rawCell.source) ? joinText(rawCell.source as string | string[]) : '',
        metadata: isObject(rawCell.metadata) ? rawCell.metadata : {},
        execution_count: executionCount,
        outputs,
        attachments,
      });
    }
  });

  if (collector.errors.length > 0) return { errors: collector.errors, notebook: null };
  return { errors: [], notebook: { cells } };
}

export function importedExecutionCounter(cells: ImportedCell[]): number {
  return cells.reduce((highest, cell) => Math.max(highest, cell.execution_count ?? 0), 0);
}
