import { conversionFor, markerByLabName } from '../shared/catalog';
import { copy } from '../shared/copy';
import { readKitCode } from '../shared/kitcode';
import { convertToPracticeUnit, parseDecimal } from './values';

export type ResultsRowStatus = 'matched' | 'unknown' | 'refused';

export interface ResultsFileRow {
  row: number;
  status: ResultsRowStatus;
  kitCode?: string;
  marker?: string;
  value?: string;
  unit?: string;
  source?: { marker: string; value: string; unit: string };
  reason?: string;
}

export interface DrawResultsContext {
  kitCodes: string[];
  /** The values already saved on the draw, by marker id. */
  savedValues: Map<string, string>;
}

export const HEADER_ROW = 'kitCode,marker,value,unit';

export class ResultsFileError extends Error {
  constructor(public readonly reason: 'encoding' | 'header') {
    super(reason);
  }
}

function decodeUtf8(bytes: Buffer): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    const text = decoder.decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    throw new ResultsFileError('encoding');
  }
}

/** Reads the lab partner's results file into preview rows. */
export function readResultsFile(bytes: Buffer, context: DrawResultsContext): ResultsFileRow[] {
  const text = decodeUtf8(bytes);
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0 || (lines[0] as string).trim() !== HEADER_ROW) {
    throw new ResultsFileError('header');
  }
  const pending = new Map(context.savedValues);
  const rows: ResultsFileRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    rows.push(readRow(index + 1, lines[index] as string, context, pending));
  }
  return rows;
}

function readRow(
  rowNumber: number,
  line: string,
  context: DrawResultsContext,
  pending: Map<string, string>,
): ResultsFileRow {
  const fields = line.split(',');
  if (fields.length < 4) {
    return { row: rowNumber, status: 'refused', reason: copy.rowNeedsFields };
  }
  const writtenKitCode = (fields[0] as string).trim();
  const writtenUnit = (fields[fields.length - 1] as string).trim();
  const writtenValue = (fields[fields.length - 2] as string).trim();
  const writtenMarker = fields
    .slice(1, fields.length - 2)
    .join(',')
    .trim();
  const source = { marker: writtenMarker, value: writtenValue, unit: writtenUnit };
  const kitCode = readKitCode(writtenKitCode).kitCode;
  if (!kitCode || !context.kitCodes.includes(kitCode)) {
    return { row: rowNumber, status: 'refused', reason: copy.kitCodeNotOnDraw, source };
  }
  const marker = markerByLabName(writtenMarker);
  if (!marker) {
    return {
      row: rowNumber,
      status: 'unknown',
      kitCode,
      reason: copy.noMarkerMatch(writtenMarker),
      source,
    };
  }
  const value = parseDecimal(writtenValue);
  if (!value) {
    return { row: rowNumber, status: 'refused', kitCode, reason: copy.valueNotNumber, source };
  }
  const conversion = conversionFor(marker, writtenUnit);
  if (!conversion) {
    return {
      row: rowNumber,
      status: 'refused',
      kitCode,
      marker: marker.id,
      reason: copy.unitNotAccepted(marker.name),
      source,
    };
  }
  const converted = convertToPracticeUnit(value, conversion, marker);
  const already = pending.get(marker.id);
  if (already !== undefined && already !== converted) {
    return {
      row: rowNumber,
      status: 'refused',
      kitCode,
      marker: marker.id,
      reason: copy.alreadySavedDifferent,
      source,
    };
  }
  pending.set(marker.id, converted);
  return {
    row: rowNumber,
    status: 'matched',
    kitCode,
    marker: marker.id,
    value: converted,
    unit: marker.unit,
    source,
  };
}
