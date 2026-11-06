import { PoolClient } from 'pg';
import { queryOne } from '../db';
import { apiErrors } from '../http/errors';
import { AuthMember } from '../http/context';
import {
  CellDto,
  ChartDto,
  SheetDto,
  WorkbookSnapshotDto,
  WorkbookSummary,
} from '../../shared/api';
import { chartData } from '../../shared/charts';
import { Evaluation } from '../../shared/formula/evaluate';
import { qualifiedRange } from '../../shared/refs';
import { SeasonState, WorkbookState } from '../../shared/workbook';
import { jsonValue } from '../../shared/values';
import { evaluate, loadWorkbookState } from './state';

export interface WorkbookRow {
  id: string;
  station_id: string;
  name: string;
  state: SeasonState;
  closes_at_local: string | null;
  closes_at_utc: Date | null;
  original_key: string | null;
  head_seq: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

const WORKBOOK_COLUMNS = `id, station_id, name, state, closes_at_local, closes_at_utc, original_key,
  head_seq, created_by, created_at, updated_at`;

/** Another station's id is handled exactly like an id that does not exist. */
export async function loadWorkbook(workbookId: string, stationId: string, client?: PoolClient): Promise<WorkbookRow> {
  const sql = `select ${WORKBOOK_COLUMNS} from workbooks where id = $1 and station_id = $2`;
  const row = client
    ? ((await client.query(sql, [workbookId, stationId])).rows[0] as WorkbookRow | undefined)
    : await queryOne<WorkbookRow>(sql, [workbookId, stationId]);
  if (!row) throw apiErrors.notFound();
  return row;
}

export async function loadWorkbookForUpdate(
  client: PoolClient,
  workbookId: string,
  stationId: string,
): Promise<WorkbookRow> {
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [`workbook:${workbookId}`]);
  return loadWorkbook(workbookId, stationId, client);
}

export function workbookSummary(row: WorkbookRow, sheetCount: number): WorkbookSummary {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    closesAt: row.closes_at_local,
    closesAtUtc: row.closes_at_utc ? row.closes_at_utc.toISOString() : null,
    updatedAt: row.updated_at.toISOString(),
    sheetCount,
  };
}

export async function summaryFor(row: WorkbookRow): Promise<WorkbookSummary> {
  const { state } = await loadWorkbookState(row.id);
  return workbookSummary(row, state.sheets.length);
}

export function cellDto(evaluation: Evaluation, sheetId: string, ref: string): CellDto | null {
  const cell = evaluation.cell(sheetId, ref);
  if (!cell) return null;
  if (cell.input === '' && cell.numberFormat === 'general' && !cell.bold) return null;
  const dto: CellDto = {
    input: cell.input,
    value: jsonValue(cell.value),
    display: cell.display,
    format: { numberFormat: cell.numberFormat, bold: cell.bold },
  };
  if (cell.value !== null && typeof cell.value === 'object') dto.error = cell.value.err;
  return dto;
}

export function sheetDtos(state: WorkbookState, evaluation: Evaluation): SheetDto[] {
  return state.sheets.map((sheet) => {
    const cells: Record<string, CellDto> = {};
    for (const ref of sheet.cells.keys()) {
      const dto = cellDto(evaluation, sheet.id, ref);
      if (dto) cells[ref] = dto;
    }
    return { id: sheet.id, name: sheet.name, position: sheet.position, cells };
  });
}

export function chartDtos(state: WorkbookState, evaluation: Evaluation): ChartDto[] {
  return state.charts.map((chart) => {
    const sheet = state.sheets.find((candidate) => candidate.id === chart.sheetId);
    const data = chartData(chart, state, evaluation);
    return {
      id: chart.id,
      sheetId: chart.sheetId,
      type: chart.chartType,
      title: chart.title,
      range: qualifiedRange(sheet ? sheet.name : '', chart.range),
      categories: data.categories,
      series: data.series,
    };
  });
}

export async function workbookSnapshot(row: WorkbookRow, member: AuthMember): Promise<WorkbookSnapshotDto> {
  const { state, headSeq } = await loadWorkbookState(row.id);
  const evaluation = evaluate(state, member.timeZone);
  return {
    ...workbookSummary(row, state.sheets.length),
    timeZone: member.timeZone,
    headSeq,
    myRole: member.role,
    sheets: sheetDtos(state, evaluation),
    charts: chartDtos(state, evaluation),
  };
}

export function cutoffHasPassed(row: WorkbookRow, atMs = Date.now()): boolean {
  return row.closes_at_utc !== null && atMs >= row.closes_at_utc.getTime();
}
