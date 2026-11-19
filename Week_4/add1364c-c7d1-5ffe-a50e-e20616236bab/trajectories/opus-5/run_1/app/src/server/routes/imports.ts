import type { PoolClient } from 'pg';
import { now } from '../clock.js';
import { ApiError, invalid, notFound } from '../errors.js';
import { query } from '../db.js';
import { withAudit, type AuditWriter } from '../audit.js';
import { optionalText, readBody, text } from '../fields.js';
import { officeDate } from '../officeTime.js';
import { newId, sealSecret } from '../secretStore.js';
import { checkRow, matchName, readUpload, type NameMatch } from '../domain/imports.js';
import { loadPeople } from '../domain/people.js';
import { allVaults } from '../domain/visibility.js';
import type { Route } from '../http.js';

type RowRecord = {
  import_id: string;
  row: number;
  outcome: 'created' | 'matched' | 'held' | 'rejected';
  credential_id: string | null;
  reason: string | null;
  names: NameMatch[];
  vault_id: string | null;
  vendor_domain: string | null;
  login_label: string | null;
  username: string | null;
  secret_cipher: string | null;
  secret_length: number | null;
  last_changed: string | null;
};

function rowJson(row: RowRecord): Record<string, unknown> {
  return {
    row: row.row,
    outcome: row.outcome,
    credential_id: row.credential_id,
    reason: row.reason,
    names: row.names,
  };
}

async function existingCredentialId(
  client: PoolClient,
  vaultId: string,
  host: string,
  username: string,
): Promise<string | null> {
  const rows = await client.query<{ id: string }>(
    `select c.id from credentials c join vendors v on v.id = c.vendor_id
      where c.vault_id = $1 and lower(v.domain) = $2 and lower(c.username) = lower($3)`,
    [vaultId, host, username],
  );
  return rows.rows[0]?.id ?? null;
}

async function vendorIdFor(
  client: PoolClient,
  write: AuditWriter,
  host: string,
  actor: { personId: string; name: string },
): Promise<string> {
  const found = await client.query<{ id: string }>('select id from vendors where lower(domain) = $1', [host]);
  const existing = found.rows[0];
  if (existing !== undefined) return existing.id;
  const id = newId();
  const inserted = await client.query<{ id: string }>(
    'insert into vendors (id, name, domain) values ($1,$2,$2) on conflict (domain) do nothing returning id',
    [id, host],
  );
  if (inserted.rows.length === 0) {
    const again = await client.query<{ id: string }>('select id from vendors where lower(domain) = $1', [host]);
    return (again.rows[0] as { id: string }).id;
  }
  await write({ actor, action: 'vendor_create', subject: { kind: 'vendor', id, name: host }, details: { domain: host } });
  return id;
}

/** Files a row's login once every held name has a choice. */
async function fileRow(
  client: PoolClient,
  write: AuditWriter,
  row: RowRecord,
  actor: { personId: string; name: string },
  today: string,
): Promise<{ outcome: 'created' | 'matched'; credentialId: string }> {
  const vaultId = row.vault_id as string;
  const host = row.vendor_domain as string;
  const username = row.username as string;
  const already = await existingCredentialId(client, vaultId, host, username);
  if (already !== null) return { outcome: 'matched', credentialId: already };
  const vendorId = await vendorIdFor(client, write, host, actor);
  const id = newId();
  const inserted = await client.query<{ id: string }>(
    `insert into credentials (id, vault_id, vendor_id, label, username, secret_cipher, secret_length,
                              last_turned_on, secret_set_on)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (vault_id, vendor_id, lower(username)) do nothing
     returning id`,
    [
      id,
      vaultId,
      vendorId,
      row.login_label,
      username,
      row.secret_cipher,
      row.secret_length,
      row.last_changed ?? today,
      today,
    ],
  );
  if (inserted.rows.length === 0) {
    const raced = await existingCredentialId(client, vaultId, host, username);
    return { outcome: 'matched', credentialId: raced as string };
  }
  for (const name of row.names) {
    if (name.person_id === null) continue;
    await client.query(
      'insert into credential_holders (credential_id, person_id) values ($1,$2) on conflict do nothing',
      [id, name.person_id],
    );
  }
  await write({
    actor,
    action: 'credential_create',
    subject: { kind: 'credential', id, name: row.login_label ?? '' },
    details: { vault_id: vaultId, vendor_id: vendorId },
  });
  return { outcome: 'created', credentialId: id };
}

export const importRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/imports',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const body = readBody(ctx.body, { filename: { kind: 'string' }, file_base64: { kind: 'string' } });
      const { records, storedName } = readUpload(text(body, 'file_base64'), text(body, 'filename'));
      const at = now();
      const today = officeDate(at);
      const vaults = await allVaults();
      const people = await loadPeople();
      const actor = { personId: ctx.caller.person.id, name: ctx.caller.person.full_name };
      const importId = newId();

      const built: RowRecord[] = [];
      await withAudit(async (client, write) => {
        await client.query('insert into imports (id, person_id, filename) values ($1,$2,$3)', [
          importId,
          ctx.caller.person.id,
          storedName,
        ]);
        for (const [index, record] of records.entries()) {
          const rowNumber = index + 1;
          const checked = checkRow(record, vaults);
          if (!checked.ok) {
            built.push({
              import_id: importId,
              row: rowNumber,
              outcome: 'rejected',
              credential_id: null,
              reason: checked.reason,
              names: [],
              vault_id: null,
              vendor_domain: null,
              login_label: null,
              username: null,
              secret_cipher: null,
              secret_length: null,
              last_changed: null,
            });
            continue;
          }
          const existing = await existingCredentialId(client, checked.vault.id, checked.host, checked.username);

          const draft: RowRecord = {
            import_id: importId,
            row: rowNumber,
            outcome: 'matched',
            credential_id: existing,
            reason: null,
            names: [],
            vault_id: checked.vault.id,
            vendor_domain: checked.host,
            login_label: checked.label,
            username: checked.username,
            secret_cipher: sealSecret(checked.secret),
            secret_length: checked.secret.length,
            last_changed: checked.lastChanged,
          };
          if (existing !== null) {
            built.push(draft);
            continue;
          }
          draft.names = checked.names.map((name) => matchName(name, people));
          if (draft.names.some((name) => name.held !== null)) {
            draft.outcome = 'held';
            built.push(draft);
            continue;
          }
          const filed = await fileRow(client, write, draft, actor, today);
          draft.outcome = filed.outcome;
          draft.credential_id = filed.credentialId;
          built.push(draft);
        }
        for (const row of built) {
          await client.query(
            `insert into import_rows (import_id, row, outcome, credential_id, reason, names, vault_id,
                                      vendor_domain, login_label, username, secret_cipher, secret_length, last_changed)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              importId,
              row.row,
              row.outcome,
              row.credential_id,
              row.reason,
              JSON.stringify(row.names),
              row.vault_id,
              row.vendor_domain,
              row.login_label,
              row.username,
              row.secret_cipher,
              row.secret_length,
              row.last_changed,
            ],
          );
          await write({
            actor,
            action: 'import_row',
            subject: { kind: 'import', id: importId, name: storedName },
            details: { row: row.row, outcome: row.outcome, reason: row.reason },
          });
        }
      });
      return { status: 201, body: await importBody(importId) };
    },
  },
  {
    method: 'GET',
    path: '/api/imports/:id',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const body = await importBody(ctx.params.id as string);
      return { status: 200, body };
    },
  },
  {
    method: 'POST',
    path: '/api/imports/:id/rows/:row/choice',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const importId = ctx.params.id as string;
      const rowNumber = Number(ctx.params.row);
      const rows = await query<RowRecord>('select * from import_rows where import_id = $1 and row = $2', [
        importId,
        rowNumber,
      ]);
      const row = rows[0];
      if (row === undefined) throw notFound();
      if (row.outcome !== 'held') throw new ApiError(409, 'row_not_held', 'This row is not held for a choice.');
      const body = readBody(ctx.body, { text: { kind: 'string' }, person_id: { kind: 'string', optional: true } });
      const wanted = text(body, 'text');
      const personId = optionalText(body, 'person_id') ?? null;
      const name = row.names.find((entry) => entry.text === wanted && entry.held !== null);
      if (name === undefined) throw invalid({ text: 'This name is not held on this row.' });
      if (personId !== null && !name.candidates.some((candidate) => candidate.person_id === personId)) {
        throw invalid({ person_id: 'Pick one of the names offered.' });
      }

      const at = now();
      const today = officeDate(at);
      const actor = { personId: ctx.caller.person.id, name: ctx.caller.person.full_name };
      const names = row.names.map((entry) =>
        entry.text === wanted && entry.held !== null
          ? {
              ...entry,
              held: null,
              match: personId === null ? ('not_on_record' as const) : ('chosen' as const),
              person_id: personId,
              candidates: entry.candidates,
            }
          : entry,
      );
      await withAudit(async (client, write) => {
        const settled = names.every((entry) => entry.held === null);
        let outcome = row.outcome;
        let credentialId = row.credential_id;
        if (settled) {
          const filed = await fileRow(client, write, { ...row, names }, actor, today);
          outcome = filed.outcome;
          credentialId = filed.credentialId;
        }
        await client.query(
          'update import_rows set names = $3, outcome = $4, credential_id = $5 where import_id = $1 and row = $2',
          [importId, rowNumber, JSON.stringify(names), outcome, credentialId],
        );
        await write({
          actor,
          action: 'import_choice',
          subject: { kind: 'import', id: importId, name: wanted },
          details: { row: rowNumber, person_id: personId },
        });
      });
      const after = await query<RowRecord>('select * from import_rows where import_id = $1 and row = $2', [
        importId,
        rowNumber,
      ]);
      const settled = after[0];
      if (settled === undefined) throw notFound();
      return { status: 200, body: rowJson(settled) };
    },
  },
];

async function importBody(importId: string): Promise<Record<string, unknown>> {
  const header = await query<{ id: string; filename: string }>('select id, filename from imports where id = $1', [
    importId,
  ]);
  const found = header[0];
  if (found === undefined) throw notFound();
  const rows = await query<RowRecord>('select * from import_rows where import_id = $1 order by row asc', [importId]);
  const counts = { created: 0, matched: 0, held: 0, rejected: 0 };
  for (const row of rows) counts[row.outcome] += 1;
  return { id: found.id, filename: found.filename, counts, rows: rows.map(rowJson) };
}
