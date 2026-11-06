import type { ImportReport, ImportRow } from '../../../shared/types';
import { lockWorkspaceImport, newId, withTransaction, type Queryable } from '../../db';
import { readCsv } from '../../domain/csv';
import {
  LEGACY_HEADER,
  MAX_IMPORT_ROWS,
  duplicateKey,
  emailDomain,
  fallbackContactName,
  headerMatches,
  importNoteTitle,
  isPersonalDomain,
  normaliseEmail,
  readLegacyRow,
  rowSkipReason,
} from '../../domain/legacyimport';
import { plainTextBody } from '../../domain/sanitize';
import { recordAudit } from '../../repo/session';
import { Router, requirePrincipal } from '../kernel';
import { failField } from '../validate';

interface ContactState {
  id: string | null;
  companyId: string | null;
  duplicateKeys: Set<string>;
}

/**
 * Runs the legacy feedback import. A dry run writes nothing and reports what the
 * real import would do at that moment.
 */
async function runImport(
  db: Queryable,
  workspaceId: string,
  memberId: string,
  csv: string,
  dryRun: boolean,
): Promise<ImportReport> {
  const records = readCsv(csv);
  if (records.length === 0 || !headerMatches(records[0].fields)) {
    failField('csv', 'The CSV header does not match the legacy feedback format.');
  }
  const dataRecords = records.slice(1).filter((record) => record.fields.some((field) => field.trim() !== ''));
  if (dataRecords.length > MAX_IMPORT_ROWS) {
    failField('csv', `A legacy import may hold at most ${MAX_IMPORT_ROWS} rows.`);
  }

  const contacts = new Map<string, ContactState>();
  const domains = new Map<string, string | null>();
  const rows: ImportRow[] = [];
  let created = 0;
  let matched = 0;
  let skipped = 0;
  let companiesCreated = 0;

  const loadContact = async (email: string): Promise<ContactState> => {
    const cached = contacts.get(email);
    if (cached) return cached;
    const { rows: contactRows } = await db.query<{ id: string; company_id: string | null }>(
      'SELECT id, company_id FROM contacts WHERE workspace_id = $1 AND lower(email) = $2',
      [workspaceId, email],
    );
    const state: ContactState = contactRows[0]
      ? { id: contactRows[0].id, companyId: contactRows[0].company_id, duplicateKeys: new Set() }
      : { id: null, companyId: null, duplicateKeys: new Set() };
    if (state.id !== null) {
      const { rows: noteRows } = await db.query<{ text: string; received_on: string | null }>(
        'SELECT text, received_on FROM notes WHERE contact_id = $1',
        [state.id],
      );
      for (const note of noteRows) state.duplicateKeys.add(duplicateKey(note.text, note.received_on ?? ''));
    }
    contacts.set(email, state);
    return state;
  };

  const loadDomain = async (domain: string): Promise<string | null> => {
    if (domains.has(domain)) return domains.get(domain) ?? null;
    const { rows: domainRows } = await db.query<{ company_id: string }>(
      'SELECT company_id FROM company_domains WHERE workspace_id = $1 AND domain = $2',
      [workspaceId, domain],
    );
    const companyId = domainRows[0]?.company_id ?? null;
    domains.set(domain, companyId);
    return companyId;
  };

  for (const record of dataRecords) {
    const row = readLegacyRow(record.line, record.fields);
    const reason = rowSkipReason(row);
    if (reason !== null) {
      rows.push({ line: row.line, outcome: 'skipped', reason, noteId: null });
      skipped += 1;
      continue;
    }
    const email = normaliseEmail(row.email);
    const state = await loadContact(email);
    const key = duplicateKey(row.feedback, row.receivedOn);
    if (state.duplicateKeys.has(key)) {
      rows.push({ line: row.line, outcome: 'skipped', reason: 'duplicate', noteId: null });
      skipped += 1;
      continue;
    }

    const isNewContact = state.id === null;
    let contactId = state.id;
    let companyId = state.companyId;

    if (isNewContact) {
      const domain = emailDomain(email);
      if (!isPersonalDomain(domain)) {
        companyId = await loadDomain(domain);
        if (companyId === null) {
          companyId = newId();
          const companyName = row.companyName.trim() === '' ? domain : row.companyName.trim();
          if (!dryRun) {
            await db.query('INSERT INTO companies (id, workspace_id, name) VALUES ($1, $2, $3)', [
              companyId,
              workspaceId,
              companyName,
            ]);
            await db.query(
              'INSERT INTO company_domains (workspace_id, domain, company_id) VALUES ($1, $2, $3)',
              [workspaceId, domain, companyId],
            );
          }
          domains.set(domain, companyId);
          companiesCreated += 1;
        }
      }
      contactId = newId();
      const contactName = row.contactName.trim() === '' ? fallbackContactName(email) : row.contactName.trim();
      if (!dryRun) {
        await db.query(
          'INSERT INTO contacts (id, workspace_id, company_id, name, email) VALUES ($1, $2, $3, $4, $5)',
          [contactId, workspaceId, companyId, contactName, email],
        );
      }
      state.id = contactId;
      state.companyId = companyId;
      created += 1;
    } else {
      matched += 1;
    }

    const noteId = newId();
    const { body, doc } = plainTextBody(row.feedback.trim());
    if (!dryRun) {
      await db.query(
        `INSERT INTO notes (id, workspace_id, contact_id, title, body, text, source, status, received_on)
         VALUES ($1, $2, $3, $4, $5, $6, 'csv_import', 'unprocessed', $7)`,
        [
          noteId,
          workspaceId,
          contactId,
          importNoteTitle(doc.text),
          body,
          doc.text,
          row.receivedOn.trim() === '' ? null : row.receivedOn.trim(),
        ],
      );
    }
    state.duplicateKeys.add(key);
    rows.push({
      line: row.line,
      outcome: isNewContact ? 'created' : 'matched',
      reason: null,
      noteId: dryRun ? null : noteId,
    });
  }

  if (!dryRun) {
    await recordAudit(db, workspaceId, memberId, 'import.run', 'workspace', workspaceId, {
      rows: dataRecords.length,
    });
  }

  return {
    dryRun,
    totals: {
      rows: dataRecords.length,
      created,
      matched,
      skipped,
      notes: created + matched,
      companiesCreated,
    },
    rows,
  };
}

export function registerImportRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/imports',
    access: 'member',
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const csv = ctx.body.csv;
      if (typeof csv !== 'string' || csv.trim() === '') {
        failField('csv', `Paste a CSV with the header ${LEGACY_HEADER.join(',')}.`);
      }
      const dryRun = ctx.body.dryRun !== false;
      if (dryRun) {
        const report = await runImport(ctx.db, principal.workspaceId, principal.memberId, csv, true);
        return { status: 200, json: report };
      }
      const report = await withTransaction(async (client) => {
        await lockWorkspaceImport(client, principal.workspaceId);
        return runImport(client, principal.workspaceId, principal.memberId, csv, false);
      });
      return { status: 201, json: report };
    },
  });
}
