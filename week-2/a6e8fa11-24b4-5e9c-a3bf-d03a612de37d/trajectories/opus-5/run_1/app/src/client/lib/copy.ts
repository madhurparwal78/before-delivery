import { LimitsDto, REJECTION_TEXT } from '../../shared/api';
import { formatStationStamp } from '../../shared/zone';

export function stamp(value: string | null, timeZone: string): string {
  return value ? formatStationStamp(value, timeZone) : '';
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function reasonText(code: string): string {
  return REJECTION_TEXT[code] ?? 'the edit was not valid';
}

export function importLimitLines(limits: LimitsDto): string[] {
  const digits = (value: number): string => value.toLocaleString('en-US');
  return [
    `Files up to ${digits(limits.maxImportBytes)} bytes`,
    `Up to ${digits(limits.maxImportExpandedBytes)} bytes once unzipped`,
    `Compressed no more than ${digits(limits.maxCompressionRatio)} to 1`,
    `Up to ${digits(limits.maxSheets)} sheets`,
    `Up to ${digits(limits.maxImportCells)} filled cells`,
    `Columns A–Z and rows 1–${digits(limits.maxRows)}`,
  ];
}

export function limitDigits(limit: number | null): string {
  return limit === null ? '' : limit.toLocaleString('en-US');
}

export function importFailureText(code: string, limit: number | null): string {
  const value = limitDigits(limit);
  switch (code) {
    case 'payload_too_large':
      return `That file is larger than ${value} bytes.`;
    case 'unsupported_file':
      return "That file isn't a real .xlsx or .csv workbook.";
    case 'archive_too_large':
      return `That file expands past ${value} bytes, so it wasn't opened.`;
    case 'archive_too_compressed':
      return `That file is compressed more than ${value} to 1, so it wasn't opened.`;
    case 'unsafe_archive':
      return 'That file contains unsafe paths and was rejected.';
    case 'too_many_sheets':
      return `That file has more than ${value} sheets.`;
    case 'too_many_cells':
      return `That file has more than ${value} filled cells or goes past column Z or row 500.`;
    case 'storage_unavailable':
      return 'File storage is unavailable, so nothing was imported. Try again when the banner clears.';
    default:
      return 'That file could not be imported.';
  }
}

export const SHEET_NAME_ERROR =
  "Use 1 to 31 characters, none of ' ! [ ] : * ? / \\, and a name no other sheet has.";
export const CHART_RANGE_ERROR = 'Enter a range on this sheet of at least 2 rows and 2 columns, like A1:B4.';
export const CHART_TITLE_ERROR = 'Give the chart a title of 1 to 60 characters.';
export const READ_ONLY_NOTICE = 'This workbook is read-only for you right now.';
export const CUTOFF_FORMAT_ERROR = 'Enter a date and time as YYYY-MM-DD HH:MM.';
export const WORKBOOK_NAME_ERROR = 'Give the workbook a name of 1 to 80 characters.';
export const VERSION_LABEL_ERROR = 'Give the version a label of 1 to 60 characters.';
export const EMPTY_TRAY = 'No conflicts. Every edit you made is saved.';
export const STORAGE_BANNER =
  'File storage is unavailable. Editing and sync still work; imports, exports and versions will resume when it returns.';
export const MAIL_BANNER =
  'Email is delayed. Invites, export notices and season-close notices are queued and will send when mail returns.';
export const NOT_FOUND_HEADING = 'Workbook not found';
export const NOT_FOUND_LINE = 'It may have been removed, or it belongs to another station.';
export const SHARE_EXPIRED_HEADING = 'This link has expired or was turned off.';
export const VERSION_STORAGE_ERROR =
  "File storage is unavailable, so versions can't be saved or restored right now.";
