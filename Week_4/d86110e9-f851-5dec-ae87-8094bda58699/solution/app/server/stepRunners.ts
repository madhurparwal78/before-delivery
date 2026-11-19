import { config } from './config.js';
import { compare } from './conditions.js';
import { db } from './db.js';
import { publish } from './events.js';
import type { Json } from './json.js';
import { failure, msg } from './messages.js';
import type { StepNode } from './model.js';
import { MailUnavailable, sendMail } from './mailer.js';
import { ownAddress, waitSeconds } from './publishRules.js';
import type { RunRow } from './runStore.js';
import { findTable, insertRow, listRows, NumberColumnError, updateRow } from './tables.js';
import { Template } from './template.js';

type Attempt =
  | { kind: 'ok'; input: Json; output: Json }
  | { kind: 'wait'; input: Json; seconds: number }
  | { kind: 'fail'; message: string; input: Json };

const WEBHOOK_TIMEOUT_MS = 10_000;

const fail = (message: string, input: Json = {}): Attempt => ({ kind: 'fail', message, input });

async function writeRow(run: RunRow, step: StepNode, template: Template, update: boolean): Promise<Attempt> {
  const tableId = template.text(step.fields.table ?? '');
  const values = template.values(step.fields.values ?? {});
  const rowId = update ? template.text(step.fields.row_id ?? '').trim() : '';
  const input = { table: tableId, ...(update ? { row_id: rowId } : {}), values };
  const table = await findTable(db, run.workspace_id, tableId);
  if (table === null) return fail(failure.tableNotFound(tableId), input);
  try {
    const row = update ? await updateRow(db, table, rowId, values) : await insertRow(db, table, values);
    if (row === null) return fail(failure.rowNotFound(rowId), input);
    publish(run.workspace_id, { type: 'table', table_id: table.id });
    return { kind: 'ok', input, output: row };
  } catch (error) {
    if (error instanceof NumberColumnError) return fail(msg.mustBeNumber(error.column), input);
    throw error;
  }
}

async function sendEmail(run: RunRow, step: StepNode, template: Template): Promise<Attempt> {
  const to = template.text(step.fields.to ?? '').trim();
  const subject = template.text(step.fields.subject ?? '');
  const body = template.text(step.fields.body ?? '');
  const input = { to, subject, body };
  const { rows } = await db.query<{ email: string }>(
    'SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND lower(u.email) = lower($2)',
    [run.workspace_id, to],
  );
  const member = rows[0];
  if (member === undefined) return fail(failure.recipient(to), input);
  try {
    await sendMail({ to: member.email, subject, text: body, headers: { 'X-Switchyard-Run': run.id } });
  } catch (error) {
    if (error instanceof MailUnavailable) return fail(failure.mailRejected, input);
    throw error;
  }
  return { kind: 'ok', input, output: { to: member.email, subject } };
}

async function callWebhook(step: StepNode, template: Template): Promise<Attempt> {
  const url = template.text(step.fields.url ?? '');
  const body = template.values(step.fields.body ?? {});
  const input = { url, body };
  if (!ownAddress(url)) return fail(failure.webhookUnreachable, input);
  const target = url.startsWith('/') ? new URL(url, `http://127.0.0.1:${config.port}`) : new URL(url);
  target.protocol = 'http:';
  target.host = `127.0.0.1:${config.port}`;
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) return fail(failure.webhookStatus(response.status), input);
    let parsed: Json = text;
    try {
      parsed = JSON.parse(text) as Json;
    } catch {
      parsed = text;
    }
    return { kind: 'ok', input, output: { status: response.status, body: parsed } };
  } catch {
    return fail(failure.webhookUnreachable, input);
  }
}

async function loopSource(run: RunRow, step: StepNode, template: Template): Promise<Attempt> {
  if (step.fields.source === 'table') {
    const tableId = template.text(step.fields.table ?? '');
    const table = await findTable(db, run.workspace_id, tableId);
    if (table === null) return fail(failure.tableNotFound(tableId), { table: tableId });
    const items = await listRows(db, table.id);
    return { kind: 'ok', input: { table: tableId, items }, output: { count: items.length } };
  }
  const list = template.value(step.fields.list ?? '');
  if (!Array.isArray(list)) return fail(failure.loopSource, { list });
  return { kind: 'ok', input: { items: list }, output: { count: list.length } };
}

/** Runs one attempt of one step. Nothing here decides retries, ordering or run state. */
export async function attemptStep(run: RunRow, step: StepNode, template: Template): Promise<Attempt> {
  const f = step.fields;
  switch (step.kind) {
    case 'set': {
      const values = template.values(f.values ?? {});
      return { kind: 'ok', input: values, output: values };
    }
    case 'filter':
    case 'branch': {
      const input = { left: template.text(f.left ?? ''), operator: String(f.operator ?? ''), right: template.text(f.right ?? '') };
      const result = compare(input.left, input.operator, input.right);
      return { kind: 'ok', input, output: step.kind === 'filter' ? { passed: result } : { result } };
    }
    case 'loop':
      return loopSource(run, step, template);
    case 'wait': {
      const requested = template.value(f.seconds ?? null);
      const seconds = waitSeconds(requested);
      if (seconds === null) return fail(msg.waitRange(step.id, config.waitMaxSeconds), { seconds: requested });
      return { kind: 'wait', input: { seconds }, seconds };
    }
    case 'send_email':
      return sendEmail(run, step, template);
    case 'add_row':
      return writeRow(run, step, template, false);
    case 'update_row':
      return writeRow(run, step, template, true);
    case 'call_webhook':
      return callWebhook(step, template);
  }
}

