import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, parseJsonBody, requireJsonContentType, type Ctx } from './http.js';
import { resolveWorkspace } from './auth.js';
import { isStr, invalid, codePoints, formatInstant } from './helpers.js';
import { isValidLei } from '../domain/names.js';
import { parseCsv, stripBom, IMPORT_HEADER } from '../domain/import.js';
import { newToken } from '../domain/crypto.js';
import { initials, maskIdentity } from '../../shared/util.js';

const DUE_DILIGENCE = ['trusted', 'pending', 'restricted', 'blocked'];
const ADDRESS_RE = /^lnl1[0-9a-z]{30}$/;

interface CounterpartyRow {
  id: string; legal_name: string; lei: string; jurisdiction_code: string; licence_number: string;
  due_diligence: string; network: string; contact_email: string | null; notes: string; created_at: Date; updated_at: Date;
}

function view(row: CounterpartyRow): Record<string, unknown> {
  return {
    id: row.id, legalName: row.legal_name, lei: row.lei, jurisdictionCode: row.jurisdiction_code,
    licenceNumber: row.licence_number, dueDiligence: row.due_diligence, network: row.network,
    contactEmail: row.contact_email, notes: row.notes, updatedAt: formatInstant(row.updated_at),
  };
}

export async function listCounterparties(ctx: Ctx): Promise<Response> {
  await resolveWorkspace(ctx);
  const r = await query<CounterpartyRow>('SELECT * FROM counterparties WHERE workspace_slug = $1 ORDER BY legal_name', [ctx.params.slug]);
  return jsonOk({ counterparties: r.rows.map(view) });
}

export async function getCounterparty(ctx: Ctx): Promise<Response> {
  await resolveWorkspace(ctx);
  const r = await query<CounterpartyRow>('SELECT * FROM counterparties WHERE id = $1 AND workspace_slug = $2', [ctx.params.id, ctx.params.slug]);
  if (r.rows.length === 0) throw errors.notFound();
  const names = await query<{ name: string; from_date: string; until_date: string | null }>(
    `SELECT name, to_char(from_date, 'YYYY-MM-DD') AS from_date, to_char(until_date, 'YYYY-MM-DD') AS until_date FROM counterparty_names WHERE counterparty_id = $1 AND workspace_slug = $2 ORDER BY from_date`,
    [ctx.params.id, ctx.params.slug],
  );
  const addresses = await query<{ address: string }>('SELECT address FROM addresses WHERE counterparty_id = $1 AND workspace_slug = $2 ORDER BY address', [ctx.params.id, ctx.params.slug]);
  const cases = await query<{ id: string; reference: string; data_sent_at: Date; counterparty_name_as_sent: string | null }>(
    `SELECT id, reference, data_sent_at, counterparty_name_as_sent FROM cases
     WHERE workspace_slug = $1 AND counterparty_id = $2 AND data_sent_at IS NOT NULL ORDER BY data_sent_at DESC`,
    [ctx.params.slug, ctx.params.id],
  );
  return jsonOk({
    counterparty: {
      ...view(r.rows[0]),
      previousNames: names.rows.map((n) => ({ name: n.name, from: n.from_date, until: n.until_date ?? null })),
      addresses: addresses.rows.map((a) => a.address),
      casesSent: cases.rows.map((c) => ({ id: c.id, reference: c.reference, dataSentAt: formatInstant(c.data_sent_at), nameAsSent: c.counterparty_name_as_sent })),
    },
  });
}

interface CounterpartyInput { legalName: string; lei: string; jurisdictionCode: string; licenceNumber: string; dueDiligence: string; contactEmail: string | null; notes: string; addresses: string[] }

function validateCreate(body: Record<string, unknown>): CounterpartyInput | never {
  const fields: Record<string, string> = {};
  const legalName = isStr(body.legalName) ? body.legalName : '';
  const leiRaw = isStr(body.lei) ? body.lei : '';
  const jurisdictionCode = isStr(body.jurisdictionCode) ? body.jurisdictionCode : '';
  const licenceNumber = isStr(body.licenceNumber) ? body.licenceNumber : '';
  const dueDiligence = isStr(body.dueDiligence) ? body.dueDiligence : '';
  const contactEmail = isStr(body.contactEmail) ? body.contactEmail : '';
  const notes = isStr(body.notes) ? body.notes : '';
  const addresses = Array.isArray(body.addresses) ? body.addresses.filter((a): a is string => typeof a === 'string') : [];

  if (codePoints(legalName) < 1 || codePoints(legalName) > 200) fields.legalName = 'Enter the legal name.';
  const lei = leiRaw.toUpperCase();
  if (!isValidLei(lei)) fields.lei = 'Enter a 20-character LEI whose check digits are valid.';
  if (jurisdictionCode === '') fields.jurisdictionCode = 'Choose a jurisdiction.';
  if (codePoints(licenceNumber) < 1 || codePoints(licenceNumber) > 60) fields.licenceNumber = 'Enter the licence number.';
  if (!DUE_DILIGENCE.includes(dueDiligence)) fields.dueDiligence = 'Choose a due diligence status.';
  if (contactEmail !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) fields.contactEmail = "Enter the compliance contact's email.";
  if (codePoints(notes) > 2000) fields.notes = 'Notes can be at most 2,000 characters.';
  const badAddress = addresses.find((a) => !ADDRESS_RE.test(a));
  if (badAddress !== undefined) fields.addresses = 'Each address must be lnl1 followed by 30 lower-case letters or digits.';
  if (Object.keys(fields).length > 0) invalid(fields);
  return { legalName, lei, jurisdictionCode, licenceNumber, dueDiligence, contactEmail: contactEmail === '' ? null : contactEmail, notes, addresses };
}

export async function createCounterparty(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const input = validateCreate(parseJsonBody(await ctx.rawBody()));

  const leiTaken = await query('SELECT 1 FROM counterparties WHERE workspace_slug = $1 AND lei = $2', [ws.slug, input.lei]);
  if (leiTaken.rows.length > 0) throw errors.conflict('lei_taken', 'A counterparty with this LEI already exists.');
  const nameTaken = await query('SELECT 1 FROM counterparties WHERE workspace_slug = $1 AND lower(legal_name) = lower($2)', [ws.slug, input.legalName]);
  if (nameTaken.rows.length > 0) throw errors.conflict('name_taken', 'A counterparty with this legal name already exists.');
  const jurisdiction = await query('SELECT 1 FROM jurisdictions WHERE code = $1', [input.jurisdictionCode]);
  if (jurisdiction.rows.length === 0) invalid({ jurisdictionCode: 'Choose a jurisdiction.' });
  for (const address of input.addresses) {
    const taken = await query('SELECT 1 FROM addresses WHERE workspace_slug = $1 AND address = $2', [ws.slug, address]);
    if (taken.rows.length > 0) throw errors.conflict('address_taken', 'An address is already in the address registry.');
  }

  const id = `cp-${newToken(8).toLowerCase()}`;
  const now = new Date();
  const today = await businessToday(ws.time_zone);
  await query('INSERT INTO counterparties (id, workspace_slug, legal_name, lei, jurisdiction_code, licence_number, due_diligence, network, contact_email, notes, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)',
    [id, ws.slug, input.legalName, input.lei, input.jurisdictionCode, input.licenceNumber, input.dueDiligence, 'off_network', input.contactEmail, input.notes, now]);
  await query('INSERT INTO counterparty_names (id, counterparty_id, workspace_slug, name, from_date) VALUES ($1,$2,$3,$4,$5)', [`${id}-n0`, id, ws.slug, input.legalName, today]);
  for (const [i, address] of input.addresses.entries()) {
    await query('INSERT INTO addresses (id, workspace_slug, address, counterparty_id) VALUES ($1,$2,$3,$4)', [`${id}-a${i}`, ws.slug, address, id]);
  }
  const created = await query<CounterpartyRow>('SELECT * FROM counterparties WHERE id = $1', [id]);
  return jsonOk({ counterparty: view(created.rows[0]) }, 201);
}

export async function updateCounterparty(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  const existing = await query<CounterpartyRow>('SELECT * FROM counterparties WHERE id = $1 AND workspace_slug = $2', [ctx.params.id, ws.slug]);
  if (existing.rows.length === 0) throw errors.notFound();
  const row = existing.rows[0];
  if ('lei' in body) invalid({ lei: "The LEI can't be changed." });

  const fields: Record<string, string> = {};
  const legalName = 'legalName' in body ? (isStr(body.legalName) ? body.legalName : '') : row.legal_name;
  const licenceNumber = 'licenceNumber' in body ? (isStr(body.licenceNumber) ? body.licenceNumber : '') : row.licence_number;
  const dueDiligence = 'dueDiligence' in body ? (isStr(body.dueDiligence) ? body.dueDiligence : '') : row.due_diligence;
  const contactEmail = 'contactEmail' in body ? (isStr(body.contactEmail) ? body.contactEmail : '') : (row.contact_email ?? '');
  const notes = 'notes' in body ? (isStr(body.notes) ? body.notes : '') : row.notes;
  if (codePoints(legalName) < 1 || codePoints(legalName) > 200) fields.legalName = 'Enter the legal name.';
  if (codePoints(licenceNumber) < 1 || codePoints(licenceNumber) > 60) fields.licenceNumber = 'Enter the licence number.';
  if (!DUE_DILIGENCE.includes(dueDiligence)) fields.dueDiligence = 'Choose a due diligence status.';
  if (contactEmail !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) fields.contactEmail = "Enter the compliance contact's email.";
  if (codePoints(notes) > 2000) fields.notes = 'Notes can be at most 2,000 characters.';
  if (Object.keys(fields).length > 0) invalid(fields);

  if (legalName !== row.legal_name) {
    const nameTaken = await query('SELECT 1 FROM counterparties WHERE workspace_slug = $1 AND lower(legal_name) = lower($2) AND id <> $3', [ws.slug, legalName, row.id]);
    if (nameTaken.rows.length > 0) throw errors.conflict('name_taken', 'A counterparty with this legal name already exists.');
  }

  const now = new Date();
  await query('UPDATE counterparties SET legal_name = $1, licence_number = $2, due_diligence = $3, contact_email = $4, notes = $5, updated_at = $6 WHERE id = $7',
    [legalName, licenceNumber, dueDiligence, contactEmail === '' ? null : contactEmail, notes, now, row.id]);
  if (legalName !== row.legal_name) {
    const today = await businessToday(ws.time_zone);
    await query('UPDATE counterparty_names SET until_date = $1 WHERE counterparty_id = $2 AND until_date IS NULL', [today, row.id]);
    await query('INSERT INTO counterparty_names (id, counterparty_id, workspace_slug, name, from_date) VALUES ($1,$2,$3,$4,$5)', [`${row.id}-n${now.getTime()}`, row.id, ws.slug, legalName, today]);
  }
  const updated = await query<CounterpartyRow>('SELECT * FROM counterparties WHERE id = $1', [row.id]);
  return jsonOk({ counterparty: view(updated.rows[0]) });
}

async function businessToday(timeZone: string): Promise<string> {
  const { businessDateInZone } = await import('../domain/time.js');
  return businessDateInZone(new Date(), timeZone);
}

export async function customers(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const support = ctx.session?.role === 'support_agent';
  const r = await query<{ id: string; name: string; identity_number: string; date_of_birth: string; deposit_address: string }>('SELECT id, name, identity_number, date_of_birth, deposit_address FROM customers WHERE workspace_slug = $1 ORDER BY name', [ws.slug]);
  return jsonOk({
    customers: r.rows.map((c) => ({
      id: c.id,
      name: support ? initials(c.name) : c.name,
      identityNumber: support ? maskIdentity(c.identity_number) : c.identity_number,
      ...(support ? {} : { dateOfBirth: c.date_of_birth }),
      depositAddress: c.deposit_address,
    })),
  });
}

export async function addressRegistry(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const r = await query('SELECT a.address, a.counterparty_id, cp.legal_name AS counterparty_name FROM addresses a JOIN counterparties cp ON cp.id = a.counterparty_id WHERE a.workspace_slug = $1 ORDER BY a.address', [ws.slug]);
  return jsonOk({ addresses: r.rows.map((a) => ({ address: a.address, counterpartyId: a.counterparty_id, counterpartyName: a.counterparty_name })) });
}

// --- Spreadsheet import ---

export interface ImportRow { row: number; legalName: string; outcome: 'matched' | 'new' | 'refused'; matchedBy: 'lei' | 'legal_name' | null; counterpartyId: string | null; changedFields: string[]; reason: string | null }