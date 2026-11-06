import { utcSeconds } from '../shared/businessTime.js';
import { refusals } from '../shared/copy.js';
import { auditEntryObject, verifyChain } from './audit.js';
import { pool } from './db.js';
import { refuse } from './errors.js';

const FORMULA_LEADS = ['=', '+', '-', '@', '\u0009', '\u000D'];
const CSV_HEADER = 'seq,at,actor,actor_role,action,subject_type,subject_id,reason,detail,prev_hash,entry_hash';

/** Neutralises a formula-leading cell, then quotes it. */
export function csvCell(value) {
  let cell = value === null || value === undefined ? '' : String(value);
  if (cell.length > 0 && FORMULA_LEADS.includes(cell[0])) cell = `'${cell}`;
  if (/["\r\n,]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

function requireAdmin(caller, wording) {
  if (caller.role !== 'admin') refuse(403, wording);
}

async function allEntries() {
  const result = await pool.query(
    `SELECT e.*, a.name AS actor_name, r.reason AS request_reason
       FROM audit_event e
       JOIN person a ON a.id = e.actor_id
       LEFT JOIN regularisation_request r ON r.id = e.subject_id AND e.subject_type = 'request'
      ORDER BY e.seq ASC`,
  );
  return result.rows;
}

export async function readTrail(caller) {
  requireAdmin(caller, refusals.onlyAdminReadsTrail);
  const entries = await allEntries();
  return { entries: entries.reverse().map((row) => auditEntryObject(row, row.actor_name)) };
}

export async function exportTrailCsv(caller) {
  requireAdmin(caller, refusals.onlyAdminExportsTrail);
  const entries = await allEntries();
  const lines = [CSV_HEADER];
  for (const row of entries) {
    lines.push(
      [
        row.seq,
        utcSeconds(row.occurred_at),
        row.actor_name,
        row.actor_role,
        row.verb,
        row.subject_type,
        row.subject_id,
        row.subject_type === 'request' ? row.request_reason : '',
        row.note,
        row.prev_hash,
        row.entry_hash,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export async function verifyTrail(caller) {
  requireAdmin(caller, refusals.onlyAdminReadsTrail);
  const entries = await allEntries();
  return verifyChain(entries);
}
