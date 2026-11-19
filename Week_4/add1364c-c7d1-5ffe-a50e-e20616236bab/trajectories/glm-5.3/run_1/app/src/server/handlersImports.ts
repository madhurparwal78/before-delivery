import type { Ctx } from './apiRoutes.js';
import { ApiError, conflict, invalid, notFound } from './errors.js';
import { jsonOk, readJsonBody, checkBody, type BodySpec } from './http.js';
import { COPY } from './apiCore.js';
import { requireRole } from './handlersCore.js';
import { mapPerson, type PersonRow } from './people.js';
import {
  checkImportRow,
  cutFilename,
  decodeImportFile,
  isBlankRecord,
  nameWords,
  normalizeName,
  readHost,
  splitWhoKnows,
  type ParsedRecord
} from './domain/importFile.js';
import { parseLooseUsDate, officeDateString } from './officeTime.js';
import { randomUUID } from 'node:crypto';

const IMPORT_ROW_LIMIT = 2000;

interface NameMatch {
  text: string;
  match: 'email' | 'full_name' | 'alias' | 'chosen' | 'not_on_record' | null;
  person_id: string | null;
  held: 'no_match' | 'ambiguous' | null;
  candidates: Array<{ person_id: string; full_name: string }>;
}

/**
 * Import matching: each name is matched against every person on record
 * (including people who have left) by email, then exact full name, then a
 * unique alias. Import never creates people.
 */
function matchName(text: string, people: PersonRow[]): NameMatch {
  const normalized = normalizeName(text);
  const byEmail = people.find((person) => normalizeName(person.email) === normalized);
  if (byEmail) return { text, match: 'email', person_id: byEmail.id, held: null, candidates: [] };
  const byFullName = people.find((person) => normalizeName(person.full_name) === normalized);
  if (byFullName) return { text, match: 'full_name', person_id: byFullName.id, held: null, candidates: [] };
  const aliasMatches = people.filter((person) =>
    person.aliases.some((alias) => normalizeName(alias) === normalized)
  );
  if (aliasMatches.length === 1) {
    return { text, match: 'alias', person_id: aliasMatches[0].id, held: null, candidates: [] };
  }
  if (aliasMatches.length > 1) {
    return {
      text,
      match: null,
      person_id: null,
      held: 'ambiguous',
      candidates: aliasMatches.map((person) => ({ person_id: person.id, full_name: person.full_name }))
    };
  }
  const words = new Set(nameWords(text));
  const candidates = people.filter((person) =>
    nameWords(person.full_name).some((word) => words.has(word))
  );
  return {
    text,
    match: null,
    person_id: null,
    held: 'no_match',
    candidates: candidates.map((person) => ({ person_id: person.id, full_name: person.full_name }))
  };
}

export async function createImport(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const raw = await readJsonBody(ctx.req, ctx.res, 1000000);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const idem = await beginImportIdempotent(ctx, body);
  if (idem.conflictError) throw idem.conflictError;
  if (idem.stored) {
    jsonOk(ctx.res, idem.stored.status, idem.stored.body);
    return;
  }
  const spec: BodySpec = { filename: { type: 'string', required: true }, file_base64: { type: 'string', required: true } };
  const bodyError = checkBody(spec, body);
  if (bodyError) {
    await finishImportIdempotent(ctx, body, bodyError.status, importErrorBody(bodyError));
    throw bodyError;
  }
  const filenameRaw = String(body.filename ?? '');
  const fileBase64 = String(body.file_base64 ?? '');
  const fields: Record<string, string> = {};
  const cut = cutFilename(filenameRaw);
  if (cut === null) {
    fields.filename = COPY.badFilename;
  }
  const decoded: { failure?: string; records: ParsedRecord[] } = decodeImportFile(fileBase64) as { failure?: string; records: ParsedRecord[] };
  if (decoded.failure === 'not_base64') {
    fields.file_base64 = COPY.notBase64;
  } else if (decoded.failure === 'not_utf8' || decoded.failure === 'nul_byte') {
    fields.file_base64 = COPY.notUtf8;
  } else if (decoded.failure === 'wrong_header') {
    fields.file_base64 = COPY.wrongHeader;
  } else if (decoded.records.filter((record) => !isBlankRecord(record)).length > IMPORT_ROW_LIMIT) {
    fields.file_base64 = COPY.tooManyRows;
  }
  if (Object.keys(fields).length > 0) {
    const err = invalid(fields);
    await finishImportIdempotent(ctx, body, err.status, importErrorBody(err));
    throw err;
  }
  const records = decoded.records.filter((record) => !isBlankRecord(record));
  const importId = randomUUID();
  const now = ctx.store.clock.now();
  const today = officeDateString(now);
  const peopleRows = await ctx.store.pool.query('SELECT * FROM people ORDER BY created_seq');
  const people = peopleRows.rows.map(mapPerson);
  const vaultRows = await ctx.store.pool.query('SELECT id, name FROM vaults');
  const vaultNamesLower = new Set(vaultRows.rows.map((row) => String(row.name).toLowerCase()));
  const vaultByName = new Map<string, string>();
  for (const row of vaultRows.rows) {
    vaultByName.set(String(row.name).toLowerCase(), String(row.id));
  }
  const vendorRows = await ctx.store.pool.query('SELECT id, domain, name FROM vendors');
  const vendorByDomain = new Map<string, string>();
  for (const row of vendorRows.rows) {
    vendorByDomain.set(String(row.domain).toLowerCase(), String(row.id));
  }
  const credentialKey = (vaultId: string, vendorId: string, username: string): string =>
    `${vaultId}|${vendorId}|${username.toLowerCase()}`;
  const existingCredentials = await ctx.store.pool.query('SELECT vault_id, vendor_id, username FROM credentials');
  const existingKeys = new Set(
    existingCredentials.rows.map((row) => credentialKey(String(row.vault_id), String(row.vendor_id), String(row.username)))
  );
  const rows: Array<Record<string, unknown>> = [];
  const counts = { created: 0, matched: 0, held: 0, rejected: 0 };
  const drafts: Array<{ action: string; subject: { kind: string; id: string; name: string }; details?: Record<string, unknown> }> = [];
  await ctx.store.transaction(async (client) => {
    await client.query('INSERT INTO imports (id, filename, created_at, counts) VALUES ($1,$2,$3,$4)', [
      importId,
      cut!,
      now,
      JSON.stringify(counts)
    ]);
    let rowNumber = 0;
    for (const record of records) {
      rowNumber += 1;
      const fieldsOf = (index: number): string => (record.fields.length > index ? record.fields[index] ?? '' : '');
      const vaultName = fieldsOf(0).trim();
      const reason = checkImportRow(record.fields, vaultNamesLower);
      let outcome: 'created' | 'matched' | 'held' | 'rejected';
      let credentialId: string | null = null;
      let names: NameMatch[] = [];
      const vaultId = vaultByName.get(vaultName.toLowerCase()) ?? null;
      const website = fieldsOf(2);
      const host = readHost(website);
      let vendorId: string | null = null;
      let vendorCreated = false;
      if (vaultId && host) {
        const found = vendorByDomain.get(host);
        if (found) {
          vendorId = found;
        } else {
          vendorId = randomUUID();
          vendorCreated = true;
        }
      }
      const username = fieldsOf(3);
      const key = vaultId && vendorId ? credentialKey(vaultId, vendorId, username) : null;
      if (reason !== null) {
        outcome = 'rejected';
      } else if (key && existingKeys.has(key)) {
        // the login already exists: the row is matched, its names are not evaluated
        outcome = 'matched';
      } else {
        const whoKnows = splitWhoKnows(fieldsOf(5));
        names = whoKnows.map((name) => matchName(name, people));
        const held = names.filter((name) => name.held !== null);
        if (held.length > 0) {
          outcome = 'held';
        } else {
          outcome = 'created';
        }
      }
      if (outcome === 'rejected') {
        counts.rejected += 1;
        rows.push({
          row: rowNumber,
          outcome,
          credential_id: null,
          reason,
          names: []
        });
        drafts.push({ action: 'import_row', subject: { kind: 'import', id: importId, name: cut! }, details: { row: rowNumber, outcome, reason } });
        continue;
      }
      if (outcome === 'matched') {
        counts.matched += 1;
        rows.push({
          row: rowNumber,
          outcome,
          credential_id: null,
          reason: null,
          names: []
        });
        drafts.push({ action: 'import_row', subject: { kind: 'import', id: importId, name: cut! }, details: { row: rowNumber, outcome, reason: null } });
        continue;
      }
      if (outcome === 'held') {
        counts.held += 1;
        rows.push({
          row: rowNumber,
          outcome,
          credential_id: null,
          reason: null,
          names: names.map((name) => ({
            text: name.text,
            match: name.match,
            person_id: name.person_id,
            held: name.held,
            candidates: name.candidates
          }))
        });
        drafts.push({ action: 'import_row', subject: { kind: 'import', id: importId, name: cut! }, details: { row: rowNumber, outcome, reason: null } });
        await client.query(
          `INSERT INTO import_rows (id, import_id, row, outcome, credential_id, reason, names, vault_name, login_for, website, username, last_changed, who_knows, created_at)
           VALUES ($1,$2,$3,'held',NULL,NULL,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
          [
            randomUUID(),
            importId,
            rowNumber,
            JSON.stringify(names),
            vaultName,
            fieldsOf(1),
            website,
            username,
            fieldsOf(6),
            JSON.stringify(splitWhoKnows(fieldsOf(5))),
            now
          ]
        );
        // The held row's password stays only in encrypted form, never in plain text.
        await client.query(
          'INSERT INTO held_row_secrets (import_id, row_number, held_secret) VALUES ($1,$2,$3) ON CONFLICT (import_id, row_number) DO NOTHING',
          [importId, rowNumber, ctx.store.secrets.encrypt(fieldsOf(4))]
        );
        continue;
      }
      // created
      if (vendorCreated && vendorId) {
        await client.query(
          'INSERT INTO vendors (id, name, domain, created_seq) VALUES ($1,$2,$3,nextval(\'row_seq_seq\'::regclass))',
          [vendorId, host, host]
        );
        vendorByDomain.set(host!, vendorId);
        drafts.push({ action: 'vendor_create', subject: { kind: 'vendor', id: vendorId, name: host! } });
      }
      const credentialIdNew = randomUUID();
      const secret = fieldsOf(4);
      const lastChanged = fieldsOf(6).trim() === '' ? today : parseLooseUsDate(fieldsOf(6));
      await client.query(
        `INSERT INTO credentials (id, vault_id, vendor_id, label, username, secret_enc, secret_fingerprint, last_turned_on, out_of_policy_since, created_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,nextval('row_seq_seq'::regclass))`,
        [
          credentialIdNew,
          vaultId!,
          vendorId!,
          fieldsOf(1),
          username,
          ctx.store.secrets.encrypt(secret),
          ctx.store.secrets.fingerprint(secret),
          lastChanged,
          today
        ]
      );
      const matchedPeople = names.filter((name) => name.person_id !== null);
      for (const name of matchedPeople) {
        await client.query('INSERT INTO credential_holders (credential_id, person_id, holder_left) VALUES ($1,$2,$3)', [
          credentialIdNew,
          name.person_id!,
          people.find((p) => p.id === name.person_id)?.status === 'left'
        ]);
      }
      existingKeys.add(key!);
      counts.created += 1;
      rows.push({
        row: rowNumber,
        outcome: 'created',
        credential_id: credentialIdNew,
        reason: null,
        names: names.map((name) => ({
          text: name.text,
          match: name.match,
          person_id: name.person_id,
          held: name.held,
          candidates: name.candidates
        }))
      });
      drafts.push(
        { action: 'import_row', subject: { kind: 'import', id: importId, name: cut! }, details: { row: rowNumber, outcome: 'created', reason: null } },
        { action: 'credential_create', subject: { kind: 'credential', id: credentialIdNew, name: fieldsOf(1) } }
      );
    }
    await client.query('UPDATE imports SET counts = $2 WHERE id = $1', [importId, JSON.stringify(counts)]);
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, drafts);
  });
  const response = {
    id: importId,
    filename: cut,
    counts,
    rows
  };
  await finishImportIdempotent(ctx, body, 201, response);
  jsonOk(ctx.res, 201, response);
}

export async function getImport(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const rows = await ctx.store.pool.query('SELECT * FROM imports WHERE id = $1', [ctx.params.id]);
  if (rows.rows.length === 0) throw notFound();
  const record = rows.rows[0];
  const rowRows = await ctx.store.pool.query('SELECT * FROM import_rows WHERE import_id = $1 ORDER BY row', [String(record.id)]);
  jsonOk(ctx.res, 200, {
    id: String(record.id),
    filename: String(record.filename),
    counts: record.counts,
    rows: rowRows.rows.map((row) => ({
      row: Number(row.row),
      outcome: String(row.outcome),
      credential_id: row.credential_id ? String(row.credential_id) : null,
      reason: row.reason ? String(row.reason) : null,
      names: row.names
    }))
  });
}

export async function chooseHeldName(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const importId = ctx.params.id;
  const rowNumber = Number(ctx.params.row);
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = { text: { type: 'string', required: true }, person_id: { type: 'string', required: false } };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const text = String(body.text ?? '');
  const personId = typeof body.person_id === 'string' ? body.person_id : null;
  const rows = await ctx.store.pool.query('SELECT * FROM import_rows WHERE import_id = $1 AND row = $2', [importId, rowNumber]);
  if (rows.rows.length === 0) throw notFound();
  const row = rows.rows[0];
  if (String(row.outcome) !== 'held') {
    throw conflict('row_not_held', 'This row is not held for a choice.');
  }
  const names = row.names as NameMatch[];
  const target = names.find((name) => name.text === text);
  if (!target || target.held === null) {
    throw invalid({ text: 'Pick one of this row\'s held names.' });
  }
  if (personId !== null && !target.candidates.some((candidate) => candidate.person_id === personId)) {
    throw invalid({ person_id: 'Pick one of this name\'s candidates.' });
  }
  const chosenId = personId;
  const now = ctx.store.clock.now();
  const today = officeDateString(now);
  let updatedNames: NameMatch[] = [];
  let rowOutcome: string = String(row.outcome);
  const drafts: Array<{ action: string; subject: { kind: string; id: string; name: string }; details?: Record<string, unknown> }> = [];
  let credentialId: string | null = row.credential_id ? String(row.credential_id) : null;
  await ctx.store.transaction(async (client) => {
    updatedNames = names.map((name) =>
      name.text === text
        ? { ...name, match: chosenId ? 'chosen' : 'not_on_record', person_id: chosenId, held: null, candidates: [] }
        : name
    );
    const stillHeld = updatedNames.some((name) => name.held !== null);
    drafts.push({ action: 'import_choice', subject: { kind: 'import', id: importId, name: String((await client.query('SELECT filename FROM imports WHERE id = $1', [importId])).rows[0].filename) }, details: { row: rowNumber, text } });
    if (!stillHeld) {
      // every held name has a choice: file the login now, unless it exists by then
      const vaultRows = await client.query('SELECT id, name FROM vaults');
      const vaultRow = vaultRows.rows.find((v) => String(v.name).toLowerCase() === String(row.vault_name).trim().toLowerCase());
      const vaultId = vaultRow ? String(vaultRow.id) : null;
      const host = readHost(String(row.website));
      let vendorId: string | null = null;
      let vendorCreated = false;
      if (host) {
        const vendorRows2 = await client.query('SELECT id, domain, name FROM vendors');
        const found = vendorRows2.rows.find((v) => String(v.domain).toLowerCase() === host);
        if (found) {
          vendorId = String(found.id);
        } else {
          vendorId = randomUUID();
          vendorCreated = true;
        }
      }
      const username = String(row.username);
      const existing = vaultId && vendorId
        ? await client.query('SELECT id FROM credentials WHERE vault_id = $1 AND vendor_id = $2 AND lower(username) = lower($3)', [vaultId, vendorId, username])
        : { rows: [] };
      if (existing.rows.length > 0) {
        rowOutcome = 'matched';
        credentialId = String(existing.rows[0].id);
      } else if (vaultId && vendorId) {
        if (vendorCreated) {
          await client.query('INSERT INTO vendors (id, name, domain, created_seq) VALUES ($1,$2,$3,nextval(\'row_seq_seq\'::regclass))', [vendorId, host, host]);
          drafts.push({ action: 'vendor_create', subject: { kind: 'vendor', id: vendorId, name: host! } });
        }
        // The held row's password is only ever stored in encrypted form.
        const heldSecret = await readHeldSecret(ctx, importId, rowNumber);
        const lastChanged = String(row.last_changed ?? '').trim() === '' ? today : parseLooseUsDate(String(row.last_changed));
        const newCredentialId = randomUUID();
        await client.query(
          `INSERT INTO credentials (id, vault_id, vendor_id, label, username, secret_enc, secret_fingerprint, last_turned_on, out_of_policy_since, created_seq)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,nextval('row_seq_seq'::regclass))`,
          [
            newCredentialId,
            vaultId,
            vendorId,
            String(row.login_for),
            username,
            ctx.store.secrets.encrypt(heldSecret),
            ctx.store.secrets.fingerprint(heldSecret),
            lastChanged,
            today
          ]
        );
        for (const name of updatedNames) {
          if (name.person_id) {
            const personRow = await client.query('SELECT status FROM people WHERE id = $1', [name.person_id]);
            await client.query('INSERT INTO credential_holders (credential_id, person_id, holder_left) VALUES ($1,$2,$3)', [
              newCredentialId,
              name.person_id,
              String(personRow.rows[0]?.status) === 'left'
            ]);
          }
        }
        rowOutcome = 'created';
        credentialId = newCredentialId;
        drafts.push({ action: 'credential_create', subject: { kind: 'credential', id: newCredentialId, name: String(row.login_for) } });
      }
    }
    await client.query(
      'UPDATE import_rows SET outcome = $3, credential_id = $4, names = $2::jsonb WHERE id = $1',
      [String(row.id), JSON.stringify(updatedNames), rowOutcome, credentialId]
    );
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, drafts);
  });
  jsonOk(ctx.res, 200, {
    row: rowNumber,
    outcome: rowOutcome,
    credential_id: credentialId,
    reason: null,
    names: updatedNames
  });
}

async function readHeldSecret(ctx: Ctx, importId: string, rowNumber: number): Promise<string> {
  const rows = await ctx.store.pool.query('SELECT held_secret FROM held_row_secrets WHERE import_id = $1 AND row_number = $2', [importId, rowNumber]);
  if (rows.rows.length === 0) return '';
  const box = rows.rows[0].held_secret as Buffer;
  return ctx.store.secrets.decrypt(box);
}
interface ImportIdem {
  key: string | null;
  stored: { status: number; body: unknown } | null;
  conflictError: ApiError | null;
}

async function beginImportIdempotent(ctx: Ctx, body: Record<string, unknown>): Promise<ImportIdem> {
  const header = ctx.req.headers['idempotency-key'];
  const key = typeof header === 'string' && header.length >= 1 && header.length <= 100 && header.trim().length === header.length ? header : null;
  if (key === null) return { key: null, stored: null, conflictError: null };
  const personId = ctx.person?.id ?? 'anonymous';
  const hash = simpleHash(JSON.stringify(body));
  const rows = await ctx.store.pool.query(
    'SELECT status, response_body, request_hash FROM idempotency_keys WHERE person_id = $1 AND endpoint = $2 AND key = $3',
    [personId, '/api/imports', key]
  );
  if (rows.rows.length > 0) {
    const stored = rows.rows[0];
    if (String(stored.request_hash) !== hash) {
      return { key, stored: null, conflictError: conflict('idempotency_conflict', 'This idempotency key was used with a different request.') };
    }
    return { key, stored: { status: Number(stored.status), body: JSON.parse(String(stored.response_body)) }, conflictError: null };
  }
  await ctx.store.pool.query(
    `INSERT INTO idempotency_keys (id, person_id, endpoint, key, request_hash, status, response_body, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,0,'{}',$6,$7)
     ON CONFLICT (person_id, endpoint, key) DO NOTHING`,
    [randomUUID(), personId, '/api/imports', key, hash, new Date(), new Date(Date.now() + 24 * 3600 * 1000)]
  );
  return { key, stored: null, conflictError: null };
}

async function finishImportIdempotent(ctx: Ctx, body: Record<string, unknown>, status: number, responseBody: unknown): Promise<void> {
  const header = ctx.req.headers['idempotency-key'];
  if (typeof header !== 'string' || header.length < 1) return;
  const personId = ctx.person?.id ?? 'anonymous';
  await ctx.store.pool.query(
    'UPDATE idempotency_keys SET status = $4, response_body = $5 WHERE person_id = $1 AND endpoint = $2 AND key = $3',
    [personId, '/api/imports', header, status, JSON.stringify(responseBody)]
  );
}

function importErrorBody(err: ApiError): Record<string, unknown> {
  return { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } };
}

function simpleHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return String(hash);
}
