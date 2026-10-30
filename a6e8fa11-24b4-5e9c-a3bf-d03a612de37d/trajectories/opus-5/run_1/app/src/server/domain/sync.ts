import { PoolClient } from 'pg';
import { DependentDto, OpResult, SyncResponse } from '../../shared/api';
import { ClientOp } from '../../shared/ops';
import { applyOp } from '../../shared/ops';
import { jsonValue } from '../../shared/values';
import { WorkbookState, findSheetById } from '../../shared/workbook';
import { AuthMember } from '../http/context';
import { uuid } from '../secrets';
import { checkEdit, rejectionKeptInTray } from './editChecks';
import { evaluate, insertOp, touchWorkbook } from './state';
import { WorkbookRow, cutoffHasPassed } from './workbooks';
import { Evaluation } from '../../shared/formula/evaluate';

export interface BatchInput {
  deviceId: string;
  baseSeq: number;
  ops: ClientOp[];
}

interface AppliedRecord {
  op: ClientOp;
  seq: number;
}

export async function insertConflict(
  client: PoolClient,
  entry: {
    workbookId: string;
    memberId: string;
    kind: 'conflict' | 'rejected';
    sheetId: string;
    sheetName: string;
    cell: string;
    myInput: string;
    currentInput: string;
    currentAuthorId: string | null;
    reason: string | null;
  },
): Promise<string> {
  const id = uuid();
  await client.query(
    `insert into conflicts (id, workbook_id, member_id, kind, sheet_id, sheet_name, cell, my_input,
       current_input, current_author_id, reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      entry.workbookId,
      entry.memberId,
      entry.kind,
      entry.sheetId,
      entry.sheetName,
      entry.cell,
      entry.myInput,
      entry.currentInput,
      entry.currentAuthorId,
      entry.reason,
    ],
  );
  return id;
}

function dependentDtos(evaluation: Evaluation, state: WorkbookState, sheetId: string, ref: string): DependentDto[] {
  return evaluation.closure(sheetId, ref).map((entry) => {
    const sheet = findSheetById(state, entry.sheetId);
    const cell = evaluation.cell(entry.sheetId, entry.ref);
    const dto: DependentDto = {
      sheetId: entry.sheetId,
      sheetName: sheet ? sheet.name : '',
      cell: entry.ref,
      depth: entry.depth,
      value: cell ? jsonValue(cell.value) : null,
      display: cell ? cell.display : '',
    };
    if (cell && cell.value !== null && typeof cell.value === 'object') dto.error = cell.value.err;
    return dto;
  });
}

/** Applies one op batch in order against the stored sequence, one batch per workbook at a time. */
export async function applyBatch(
  client: PoolClient,
  row: WorkbookRow,
  member: AuthMember,
  input: BatchInput,
  state: WorkbookState,
  headSeq: number,
): Promise<SyncResponse> {
  const cutoffPassed = cutoffHasPassed(row);
  const results: OpResult[] = [];
  const applied: AppliedRecord[] = [];
  let seq = headSeq;

  for (const op of input.ops) {
    const context = { state, season: row.state, cutoffPassed, role: member.role };
    const check = checkEdit(op, context);
    if (!check.ok) {
      let conflictId: string | null = null;
      if (rejectionKeptInTray(op, check.reason) && op.type === 'setCell') {
        const sheet = findSheetById(state, op.sheetId);
        conflictId = await insertConflict(client, {
          workbookId: row.id,
          memberId: member.id,
          kind: 'rejected',
          sheetId: op.sheetId,
          sheetName: sheet?.name ?? '',
          cell: op.cell,
          myInput: op.input,
          currentInput: sheet?.cells.get(op.cell)?.input ?? '',
          currentAuthorId: null,
          reason: check.reason,
        });
      }
      results.push({ opId: op.opId, status: 'rejected', reason: check.reason, conflictId });
      continue;
    }

    if (op.type === 'setCell') {
      const sheet = findSheetById(state, op.sheetId);
      const existing = sheet?.cells.get(op.cell);
      if (existing && existing.lastSeq > input.baseSeq && existing.lastAuthorId !== member.id) {
        const conflictId = await insertConflict(client, {
          workbookId: row.id,
          memberId: member.id,
          kind: 'conflict',
          sheetId: op.sheetId,
          sheetName: sheet?.name ?? '',
          cell: op.cell,
          myInput: op.input,
          currentInput: existing.input,
          currentAuthorId: existing.lastAuthorId,
          reason: null,
        });
        const author = await authorName(client, existing.lastAuthorId);
        results.push({
          opId: op.opId,
          status: 'conflict',
          conflictId,
          current: { input: existing.input, author },
        });
        continue;
      }
    }

    seq += 1;
    await insertOp(client, row.id, seq, member.id, op);
    applyOp(state, op, seq, member.id);
    applied.push({ op, seq });
    results.push({ opId: op.opId, status: 'applied', seq });
  }

  if (seq !== headSeq) await touchWorkbook(client, row.id, seq);

  if (applied.some((record) => record.op.type === 'setCell')) {
    const evaluation = evaluate(state, member.timeZone);
    for (const result of results) {
      if (result.status !== 'applied') continue;
      const record = applied.find((candidate) => candidate.op.opId === result.opId);
      if (!record || record.op.type !== 'setCell') continue;
      const op = record.op;
      const cell = evaluation.cell(op.sheetId, op.cell);
      result.cell = {
        sheetId: op.sheetId,
        cell: op.cell,
        value: cell ? jsonValue(cell.value) : null,
        display: cell ? cell.display : '',
      };
      if (cell && cell.value !== null && typeof cell.value === 'object') result.cell.error = cell.value.err;
      result.dependents = dependentDtos(evaluation, state, op.sheetId, op.cell);
    }
  }

  return {
    batch: { key: '', deviceId: input.deviceId, headSeq: seq },
    results,
  };
}

export async function authorName(client: PoolClient, memberId: string): Promise<{ id: string; name: string }> {
  const result = await client.query('select id, name from members where id = $1', [memberId]);
  const found = result.rows[0] as { id: string; name: string } | undefined;
  return found ?? { id: memberId, name: 'A removed member' };
}
