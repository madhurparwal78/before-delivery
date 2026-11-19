import { config } from '../config';
import { query } from '../db';
import { messages, stepFailures } from '../errors';
import { MailUnavailable, sendMail } from '../mail';
import { coerceValues, insertRow, loadTable, readRow, rowObjects, writeRow, valuesFromJson } from '../tables';
import { isObject } from '../util';
import { evaluateCondition } from './conditions';
import type { JsonObject, JsonValue, StepKind } from '../../shared/types';

export type StepOutcome =
  | { ok: true; output: JsonValue; items?: JsonValue[] }
  | { ok: false; message: string };

export interface EffectContext {
  workspaceId: string;
  runId: string;
}

function text(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export async function performStep(
  kind: StepKind,
  input: JsonObject,
  context: EffectContext,
): Promise<StepOutcome> {
  switch (kind) {
    case 'set':
      return { ok: true, output: valuesFromJson(input.values) };
    case 'filter': {
      const passed = evaluateCondition(text(input.operator), text(input.left), text(input.right));
      return { ok: true, output: { passed } };
    }
    case 'branch': {
      const result = evaluateCondition(text(input.operator), text(input.left), text(input.right));
      return { ok: true, output: { result } };
    }
    case 'loop':
      return loopItems(input, context);
    case 'wait':
      return { ok: true, output: { waited_seconds: Number(input.seconds ?? 0) } };
    case 'send_email':
      return sendEmailStep(input, context);
    case 'add_row':
      return addRowStep(input, context);
    case 'update_row':
      return updateRowStep(input, context);
    case 'call_webhook':
      return callWebhookStep(input);
  }
}

async function loopItems(input: JsonObject, context: EffectContext): Promise<StepOutcome> {
  if (input.source === 'table') {
    const tableId = text(input.table);
    const table = await loadTable(context.workspaceId, tableId);
    if (table === null) return { ok: false, message: stepFailures.tableNotFound(tableId) };
    const items = await rowObjects(table.id);
    return { ok: true, output: { count: items.length }, items };
  }
  const list = input.list;
  if (!Array.isArray(list)) return { ok: false, message: stepFailures.loopNotList };
  return { ok: true, output: { count: list.length }, items: list };
}

async function sendEmailStep(input: JsonObject, context: EffectContext): Promise<StepOutcome> {
  const to = text(input.to).trim();
  const members = await query<{ email: string }>(
    'select u.email from members m join users u on u.id = m.user_id where m.workspace_id = $1',
    [context.workspaceId],
  );
  const match = members.find((member) => member.email.toLowerCase() === to.toLowerCase());
  if (match === undefined) return { ok: false, message: stepFailures.notMember(to) };
  const subject = text(input.subject);
  try {
    await sendMail({
      to: match.email,
      subject,
      text: text(input.body),
      headers: { 'X-Switchyard-Run': context.runId },
    });
  } catch (error) {
    if (error instanceof MailUnavailable) return { ok: false, message: stepFailures.mailRefused };
    throw error;
  }
  return { ok: true, output: { to: match.email, subject } };
}

async function addRowStep(input: JsonObject, context: EffectContext): Promise<StepOutcome> {
  const tableId = text(input.table);
  const table = await loadTable(context.workspaceId, tableId);
  if (table === null) return { ok: false, message: stepFailures.tableNotFound(tableId) };
  const coerced = coerceValues(table.cols, valuesFromJson(input.values), null);
  if (!coerced.ok) return { ok: false, message: messages.numberColumn(coerced.column) };
  return { ok: true, output: await insertRow(table, coerced.cells) };
}

async function updateRowStep(input: JsonObject, context: EffectContext): Promise<StepOutcome> {
  const tableId = text(input.table);
  const table = await loadTable(context.workspaceId, tableId);
  if (table === null) return { ok: false, message: stepFailures.tableNotFound(tableId) };
  const rowId = text(input.row_id);
  const existing = await readRow(table.id, rowId);
  if (existing === null) return { ok: false, message: stepFailures.rowNotFound(rowId) };
  const coerced = coerceValues(table.cols, valuesFromJson(input.values), existing);
  if (!coerced.ok) return { ok: false, message: messages.numberColumn(coerced.column) };
  return { ok: true, output: await writeRow(table, rowId, coerced.cells) };
}

async function callWebhookStep(input: JsonObject): Promise<StepOutcome> {
  const raw = text(input.url).trim();
  const target = raw.startsWith('/') ? `${config.publicUrl}${raw}` : raw;
  let response: Response;
  try {
    response = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(valuesFromJson(input.body)),
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { ok: false, message: stepFailures.webhookUnreachable };
  }
  const bodyText = await response.text();
  if (response.status < 200 || response.status > 299) {
    return { ok: false, message: stepFailures.webhookStatus(response.status) };
  }
  let parsed: JsonValue = bodyText;
  try {
    const candidate: unknown = JSON.parse(bodyText);
    if (isObject(candidate) || Array.isArray(candidate)) parsed = candidate as JsonValue;
    else parsed = candidate as JsonValue;
  } catch {
    parsed = bodyText;
  }
  return { ok: true, output: { status: response.status, body: parsed } };
}
