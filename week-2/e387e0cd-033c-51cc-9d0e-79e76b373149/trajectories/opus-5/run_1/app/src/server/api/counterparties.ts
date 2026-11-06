import { FIELD_COPY } from '../../shared/copy';
import { businessDate } from '../../shared/businesstime';
import { query, queryOne } from '../db/pool';
import { newId } from '../db/seed';
import { DueDiligence } from '../domain/case';
import { canonicalLei, isValidLei } from '../domain/lei';
import { normaliseName } from '../domain/names';
import { ExistingCounterparty, ImportRow, planImport } from '../domain/importsheet';
import { failure } from '../http/errors';
import { ALL_STAFF, define, Registered, Role } from '../http/runtime';
import { codePoints, FieldCheck, hasKey, isAddress, readText } from '../http/validate';
import {
  CounterpartyRow,
  findCounterparty,
  listCounterparties,
  presentCounterparty,
  previousNames,
  registryAddresses,
} from '../store/counterparties';
import { listCustomers, presentCustomer } from '../store/customers';
import { allJurisdictions, findJurisdiction } from '../store/workspace';

const OFFICER_ANALYST: readonly Role[] = ['compliance_officer', 'compliance_analyst'];
const DUE_DILIGENCES: readonly DueDiligence[] = ['trusted', 'pending', 'restricted', 'blocked'];
const EMAIL_SHAPE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

interface CounterpartyFields {
  readonly legalName: string;
  readonly lei: string;
  readonly jurisdictionCode: string;
  readonly licenceNumber: string;
  readonly dueDiligence: DueDiligence;
  readonly contactEmail: string;
  readonly notes: string;
  readonly addresses: readonly string[];
}

function readAddresses(body: unknown): string[] | null {
  const value = (body as Record<string, unknown>).addresses;
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((entry): entry is string => typeof entry === 'string')) return null;
  return value;
}

async function counterpartyPage(
  workspaceSlug: string,
  row: CounterpartyRow,
): Promise<Record<string, unknown>> {
  return {
    ...presentCounterparty(row),
    previousNames: (await previousNames(row.id)).map((entry) => ({
      name: entry.name,
      from: entry.from_date,
      until: entry.until_date,
    })),
    addresses: await registryAddresses(workspaceSlug, row.id),
  };
}

async function applyImportRows(
  workspaceSlug: string,
  rows: readonly ImportRow[],
  today: string,
  now: Date,
): Promise<{ created: number; updated: number; unchanged: number; refused: number }> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const row of rows) {
    if (row.outcome === 'new' && row.create !== null) {
      await query(
        `INSERT INTO counterparties (id, workspace_slug, legal_name, normalised_name, name_from, lei,
           jurisdiction_code, licence_number, due_diligence, network, contact_email, notes,
           signing_value, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'off_network',$10,$11,NULL,$12,$12)`,
        [
          newId('cp'),
          workspaceSlug,
          row.create.legalName,
          normaliseName(row.create.legalName),
          today,
          row.create.lei,
          row.create.jurisdictionCode,
          row.create.licenceNumber,
          row.create.dueDiligence,
          row.create.contactEmail,
          row.create.notes,
          now,
        ],
      );
      created += 1;
      continue;
    }
    if (row.outcome === 'matched' && row.counterpartyId !== null) {
      if (row.update === null) {
        unchanged += 1;
        continue;
      }
      await query(
        `UPDATE counterparties SET licence_number = COALESCE($2, licence_number),
           due_diligence = COALESCE($3, due_diligence), contact_email = COALESCE($4, contact_email),
           notes = COALESCE($5, notes), updated_at = $6 WHERE id = $1`,
        [
          row.counterpartyId,
          row.update.licenceNumber ?? null,
          row.update.dueDiligence ?? null,
          row.update.contactEmail ?? null,
          row.update.notes ?? null,
          now,
        ],
      );
      updated += 1;
    }
  }
  return {
    created,
    updated,
    unchanged,
    refused: rows.filter((row) => row.outcome === 'refused').length,
  };
}

function importRowBody(row: ImportRow): Record<string, unknown> {
  return {
    row: row.row,
    legalName: row.legalName,
    outcome: row.outcome,
    matchedBy: row.matchedBy,
    counterpartyId: row.counterpartyId,
    changedFields: row.changedFields,
    reason: row.reason,
  };
}

async function existingForImport(workspaceSlug: string): Promise<ExistingCounterparty[]> {
  return (await listCounterparties(workspaceSlug)).map((row) => ({
    id: row.id,
    lei: row.lei,
    legalName: row.legal_name,
    licenceNumber: row.licence_number,
    dueDiligence: row.due_diligence as DueDiligence,
    contactEmail: row.contact_email,
    notes: row.notes,
  }));
}

export const counterpartyRoutes: readonly Registered[] = [
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/counterparties',
    roles: ALL_STAFF,
    handler: async (context) => ({
      status: 200,
      json: {
        counterparties: (await listCounterparties(context.workspace.slug)).map(presentCounterparty),
      },
    }),
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/counterparties/:counterpartyId',
    roles: ALL_STAFF,
    load: async (context) => {
      const row = await findCounterparty(context.workspace.slug, context.params.counterpartyId);
      if (row === null) throw failure('not_found');
      return row;
    },
    handler: async (context) => ({
      status: 200,
      json: { counterparty: await counterpartyPage(context.workspace.slug, context.loaded) },
    }),
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/counterparties',
    roles: OFFICER_ANALYST,
    content: 'json',
    handler: async (context) => {
      const legalName = readText(context.body, 'legalName');
      const lei = readText(context.body, 'lei');
      const jurisdictionCode = readText(context.body, 'jurisdictionCode');
      const licenceNumber = readText(context.body, 'licenceNumber');
      const dueDiligence = readText(context.body, 'dueDiligence');
      const contactEmail = readText(context.body, 'contactEmail');
      const notes = readText(context.body, 'notes') ?? '';
      const addresses = readAddresses(context.body);

      if (lei !== null && isValidLei(lei)) {
        const taken = await queryOne<{ id: string }>(
          'SELECT id FROM counterparties WHERE workspace_slug = $1 AND lei = $2',
          [context.workspace.slug, canonicalLei(lei)],
        );
        if (taken !== null) throw failure('lei_taken');
      }
      if (legalName !== null && legalName !== '') {
        const taken = await queryOne<{ id: string }>(
          'SELECT id FROM counterparties WHERE workspace_slug = $1 AND normalised_name = $2',
          [context.workspace.slug, normaliseName(legalName)],
        );
        if (taken !== null) throw failure('name_taken');
      }
      if (addresses !== null && addresses.every(isAddress)) {
        for (const address of addresses) {
          const taken = await queryOne<{ address: string }>(
            'SELECT address FROM address_registry WHERE workspace_slug = $1 AND address = $2',
            [context.workspace.slug, address],
          );
          if (taken !== null) throw failure('address_taken');
        }
      }

      const check = new FieldCheck();
      if (legalName === null || codePoints(legalName) < 1 || codePoints(legalName) > 200) {
        check.add('legalName', FIELD_COPY.legalName);
      }
      if (lei === null || !isValidLei(lei)) check.add('lei', FIELD_COPY.lei);
      const jurisdiction =
        jurisdictionCode === null ? null : await findJurisdiction(jurisdictionCode.toUpperCase());
      if (jurisdiction === null) check.add('jurisdictionCode', FIELD_COPY.jurisdictionCode);
      if (licenceNumber === null || licenceNumber.length < 1 || licenceNumber.length > 60) {
        check.add('licenceNumber', 'Enter a licence number of 1 to 60 characters.');
      }
      if (dueDiligence === null || !DUE_DILIGENCES.includes(dueDiligence as DueDiligence)) {
        check.add('dueDiligence', 'Choose a due diligence status.');
      }
      if (contactEmail === null || !EMAIL_SHAPE.test(contactEmail)) {
        check.add('contactEmail', FIELD_COPY.contactEmail);
      }
      if (codePoints(notes) > 2000) check.add('notes', FIELD_COPY.notes);
      if (addresses === null || !addresses.every(isAddress)) {
        check.add('addresses', FIELD_COPY.address);
      }
      check.settle();

      const fields: CounterpartyFields = {
        legalName: legalName as string,
        lei: canonicalLei(lei as string),
        jurisdictionCode: (jurisdiction as { code: string }).code,
        licenceNumber: licenceNumber as string,
        dueDiligence: dueDiligence as DueDiligence,
        contactEmail: contactEmail as string,
        notes,
        addresses: addresses as string[],
      };
      const id = newId('cp');
      await query(
        `INSERT INTO counterparties (id, workspace_slug, legal_name, normalised_name, name_from, lei,
           jurisdiction_code, licence_number, due_diligence, network, contact_email, notes,
           signing_value, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'off_network',$10,$11,NULL,$12,$12)`,
        [
          id,
          context.workspace.slug,
          fields.legalName,
          normaliseName(fields.legalName),
          businessDate(context.now, context.workspace.timeZone),
          fields.lei,
          fields.jurisdictionCode,
          fields.licenceNumber,
          fields.dueDiligence,
          fields.contactEmail,
          fields.notes,
          context.now,
        ],
      );
      for (const address of fields.addresses) {
        await query(
          'INSERT INTO address_registry (workspace_slug, address, counterparty_id) VALUES ($1,$2,$3)',
          [context.workspace.slug, address, id],
        );
      }
      const row = await findCounterparty(context.workspace.slug, id);
      return { status: 201, json: { counterparty: presentCounterparty(row as CounterpartyRow) } };
    },
  }),
  define({
    kind: 'staff',
    method: 'PATCH',
    path: '/api/w/:slug/counterparties/:counterpartyId',
    roles: OFFICER_ANALYST,
    content: 'json',
    load: async (context) => {
      const row = await findCounterparty(context.workspace.slug, context.params.counterpartyId);
      if (row === null) throw failure('not_found');
      return row;
    },
    handler: async (context) => {
      const current = context.loaded;
      const legalName = readText(context.body, 'legalName');
      if (legalName !== null && legalName !== '') {
        const taken = await queryOne<{ id: string }>(
          `SELECT id FROM counterparties WHERE workspace_slug = $1 AND normalised_name = $2 AND id <> $3`,
          [context.workspace.slug, normaliseName(legalName), current.id],
        );
        if (taken !== null) throw failure('name_taken');
      }
      const check = new FieldCheck();
      if (hasKey(context.body, 'lei')) check.add('lei', FIELD_COPY.leiUnchangeable);
      if (hasKey(context.body, 'legalName')) {
        if (legalName === null || codePoints(legalName) < 1 || codePoints(legalName) > 200) {
          check.add('legalName', FIELD_COPY.legalName);
        }
      }
      const licenceNumber = readText(context.body, 'licenceNumber');
      if (hasKey(context.body, 'licenceNumber')) {
        if (licenceNumber === null || licenceNumber.length < 1 || licenceNumber.length > 60) {
          check.add('licenceNumber', 'Enter a licence number of 1 to 60 characters.');
        }
      }
      const dueDiligence = readText(context.body, 'dueDiligence');
      if (hasKey(context.body, 'dueDiligence')) {
        if (dueDiligence === null || !DUE_DILIGENCES.includes(dueDiligence as DueDiligence)) {
          check.add('dueDiligence', 'Choose a due diligence status.');
        }
      }
      const contactEmail = readText(context.body, 'contactEmail');
      if (hasKey(context.body, 'contactEmail')) {
        if (contactEmail === null || !EMAIL_SHAPE.test(contactEmail)) {
          check.add('contactEmail', FIELD_COPY.contactEmail);
        }
      }
      const notes = readText(context.body, 'notes');
      if (hasKey(context.body, 'notes')) {
        if (notes === null || codePoints(notes) > 2000) check.add('notes', FIELD_COPY.notes);
      }
      check.settle();

      const today = businessDate(context.now, context.workspace.timeZone);
      if (legalName !== null && legalName !== current.legal_name) {
        await query(
          `INSERT INTO counterparty_previous_names (id, counterparty_id, name, from_date, until_date, recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [newId('pn'), current.id, current.legal_name, current.name_from, today, context.now],
        );
      }
      await query(
        `UPDATE counterparties SET
           legal_name = COALESCE($2, legal_name),
           normalised_name = COALESCE($3, normalised_name),
           name_from = CASE WHEN $2 IS NULL OR $2 = legal_name THEN name_from ELSE $4 END,
           licence_number = COALESCE($5, licence_number),
           due_diligence = COALESCE($6, due_diligence),
           contact_email = COALESCE($7, contact_email),
           notes = COALESCE($8, notes),
           updated_at = $9
         WHERE id = $1`,
        [
          current.id,
          legalName,
          legalName === null ? null : normaliseName(legalName),
          today,
          licenceNumber,
          dueDiligence,
          contactEmail,
          notes,
          context.now,
        ],
      );
      const row = await findCounterparty(context.workspace.slug, current.id);
      return { status: 200, json: { counterparty: presentCounterparty(row as CounterpartyRow) } };
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/counterparties/import/preview',
    roles: OFFICER_ANALYST,
    content: 'csv',
    bodyLimit: 1000000,
    handler: async (context) => {
      const plan = planImport(
        context.raw.toString('utf8'),
        await existingForImport(context.workspace.slug),
        (await allJurisdictions()).map((row) => row.code),
      );
      return {
        status: 200,
        json: { rows: plan.rows.map(importRowBody), summary: plan.summary },
      };
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/counterparties/import',
    roles: OFFICER_ANALYST,
    content: 'csv',
    bodyLimit: 1000000,
    handler: async (context) => {
      const plan = planImport(
        context.raw.toString('utf8'),
        await existingForImport(context.workspace.slug),
        (await allJurisdictions()).map((row) => row.code),
      );
      const counts = await applyImportRows(
        context.workspace.slug,
        plan.rows,
        businessDate(context.now, context.workspace.timeZone),
        context.now,
      );
      return {
        status: 200,
        json: { ...counts, rows: plan.rows.map(importRowBody) },
      };
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/customers',
    roles: ALL_STAFF,
    handler: async (context) => ({
      status: 200,
      json: {
        customers: (await listCustomers(context.workspace.slug)).map((row) =>
          presentCustomer(row, context.member.role),
        ),
      },
    }),
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/address-registry',
    roles: ALL_STAFF,
    handler: async (context) => {
      const rows = await query<{ address: string; counterparty_id: string; legal_name: string }>(
        `SELECT a.address, a.counterparty_id, c.legal_name
         FROM address_registry a JOIN counterparties c ON c.id = a.counterparty_id
         WHERE a.workspace_slug = $1 ORDER BY c.legal_name, a.address`,
        [context.workspace.slug],
      );
      return {
        status: 200,
        json: {
          addresses: rows.map((row) => ({
            address: row.address,
            counterpartyId: row.counterparty_id,
            counterpartyName: row.legal_name,
          })),
        },
      };
    },
  }),
];
