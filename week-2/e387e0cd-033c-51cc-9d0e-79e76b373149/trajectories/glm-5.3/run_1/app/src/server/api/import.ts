import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, requireJsonContentType, type Ctx } from './http.js';
import { resolveWorkspace } from './auth.js';
import { isValidLei, normaliseName } from '../domain/names.js';
import { parseCsv, stripBom, IMPORT_HEADER } from '../domain/import.js';
import { codePoints } from './helpers.js';
import { newToken } from '../domain/crypto.js';

// Spreadsheet import: preview matches by LEI then normalised legal name, and
// the refusal reasons apply in the published order. Saving applies exactly
// what the preview shows.
const DUE_DILIGENCE_CELLS: Record<string, string> = { trusted: 'trusted', pending: 'pending', restricted: 'restricted', blocked: 'blocked' };

interface Existing { id: string; legalName: string; lei: string; jurisdictionCode: string; licenceNumber: string; dueDiligence: string; contactEmail: string | null; notes: string }

interface Planned {
  row: number;
  legalName: string;
  outcome: 'matched' | 'new' | 'refused';
  matchedBy: 'lei' | 'legal_name' | null;
  counterpartyId: string | null;
  changedFields: string[];
  reason: string | null;
  newLei: string | null;
  newJurisdiction: string;
  newLicence: string;
  newDue: string;
  newEmail: string;
  newNotes: string;
  matchedExisting: Existing | null;
}

export async function previewImport(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['text/csv']);
  const body = await ctx.rawBody();
  const { rows, summary } = await planImport(ws.slug, body);
  return jsonOk({ rows: rows.map(viewRow), summary });
}

export async function saveImport(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['text/csv']);
  const body = await ctx.rawBody();
  const { rows, summary } = await planImport(ws.slug, body);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const now = new Date();
  const today = await businessToday(ws.time_zone);
  for (const plan of rows) {
    if (plan.outcome === 'refused') continue;
    if (plan.outcome === 'new') {
      const id = `cp-${newToken(8).toLowerCase()}`;
      await query('INSERT INTO counterparties (id, workspace_slug, legal_name, lei, jurisdiction_code, licence_number, due_diligence, network, contact_email, notes, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)',
        [id, ws.slug, plan.legalName, plan.newLei, plan.newJurisdiction, plan.newLicence, plan.newDue, 'off_network', plan.newEmail === '' ? null : plan.newEmail, plan.newNotes, now]);
      await query('INSERT INTO counterparty_names (id, counterparty_id, workspace_slug, name, from_date) VALUES ($1,$2,$3,$4,$5)', [`${id}-n0`, id, ws.slug, plan.legalName, today]);
      created++;
    } else if (plan.matchedExisting !== null) {
      if (plan.changedFields.length === 0) {
        unchanged++;
      } else {
        const existing = plan.matchedExisting;
        const licenceNumber = plan.changedFields.includes('Licence number') ? plan.newLicence : existing.licenceNumber;
        const dueDiligence = plan.changedFields.includes('Due diligence') ? plan.newDue : existing.dueDiligence;
        const contactEmail = plan.changedFields.includes('Contact email') ? plan.newEmail : (existing.contactEmail ?? '');
        const notes = plan.changedFields.includes('Notes') ? plan.newNotes : existing.notes;
        await query('UPDATE counterparties SET licence_number = $1, due_diligence = $2, contact_email = $3, notes = $4, updated_at = $5 WHERE id = $6',
          [licenceNumber, dueDiligence, contactEmail === '' ? null : contactEmail, notes, now, existing.id]);
        updated++;
      }
    }
  }
  return jsonOk({ created, updated, unchanged, refused: summary.refused, rows: rows.map(viewRow) });
}

function viewRow(p: Planned): Record<string, unknown> {
  return {
    row: p.row, legalName: p.legalName, outcome: p.outcome, matchedBy: p.matchedBy,
    counterpartyId: p.counterpartyId, changedFields: p.changedFields, reason: p.reason,
  };
}

async function businessToday(timeZone: string): Promise<string> {
  const { businessDateInZone } = await import('../domain/time.js');
  return businessDateInZone(new Date(), timeZone);
}

async function planImport(wsSlug: string, body: Buffer): Promise<{ rows: Planned[]; summary: { matched: number; new: number; refused: number } }> {
  const text = stripBom(body.toString('utf8'));
  const table = parseCsv(text);
  if (table.length === 0 || !table[0].map((c) => c.trim()).every((c, i) => c === IMPORT_HEADER[i])) {
    throw errors.invalid({ file: 'The header row must be exactly Legal name,LEI,Jurisdiction,Licence number,Due diligence,Contact email,Notes.' });
  }
  const existingRows = await query<Existing>(
    'SELECT id, legal_name AS \"legalName\", lei, jurisdiction_code AS \"jurisdictionCode\", licence_number AS \"licenceNumber\", due_diligence AS \"dueDiligence\", contact_email AS \"contactEmail\", notes FROM counterparties WHERE workspace_slug = $1',
    [wsSlug],
  );
  const byLei = new Map<string, Existing>();
  const byName = new Map<string, Existing>();
  for (const row of existingRows.rows) {
    byLei.set(row.lei, row);
    byName.set(normaliseName(row.legalName), row);
  }
  const jurisdictionCodes = new Set((await query<{ code: string }>('SELECT code FROM jurisdictions')).rows.map((r) => r.code));

  const plans: Planned[] = [];
  const seenCounterparty = new Map<string, number>();
  const plannedNew = new Map<string, number>();
  const blank = (v: string | undefined): string => (v === undefined ? '' : v.trim());

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const rowNumber = i + 1;
    const legalName = blank(cells[0]);
    const leiCell = blank(cells[1]);
    const jurisdiction = blank(cells[2]);
    const licence = blank(cells[3]);
    const dueCell = blank(cells[4]);
    const email = blank(cells[5]);
    const notes = cells[6] === undefined ? '' : cells[6].trim();

    const plan: Planned = {
      row: rowNumber, legalName, outcome: 'refused', matchedBy: null, counterpartyId: null, changedFields: [], reason: null,
      newLei: leiCell === '' ? null : leiCell.toUpperCase(), newJurisdiction: jurisdiction, newLicence: licence,
      newDue: dueCell === '' ? 'pending' : DUE_DILIGENCE_CELLS[dueCell.toLowerCase()] ?? '',
      newEmail: email, newNotes: notes, matchedExisting: null,
    };

    let matched: Existing | null = null;
    let matchedBy: 'lei' | 'legal_name' | null = null;
    if (leiCell !== '' && isValidLei(leiCell)) {
      const found = byLei.get(leiCell.toUpperCase());
      if (found !== undefined) {
        matched = found;
        matchedBy = 'lei';
      }
    } else if (leiCell === '') {
      const found = byName.get(normaliseName(legalName));
      if (found !== undefined) {
        matched = found;
        matchedBy = 'legal_name';
      }
    }

    if (matched !== null) {
      plan.outcome = 'matched';
      plan.matchedBy = matchedBy;
      plan.counterpartyId = matched.id;
      plan.matchedExisting = matched;
      const earlier = seenCounterparty.get(matched.id);
      if (earlier !== undefined) {
        plan.outcome = 'refused';
        plan.reason = `Same counterparty as row ${earlier}`;
      } else {
        seenCounterparty.set(matched.id, rowNumber);
        if (licence !== '' && licence !== matched.licenceNumber) plan.changedFields.push('Licence number');
        const due = plan.newDue === '' ? matched.dueDiligence : plan.newDue;
        if (plan.newDue !== '' && due !== matched.dueDiligence) plan.changedFields.push('Due diligence');
        if (email !== '' && email !== (matched.contactEmail ?? '')) plan.changedFields.push('Contact email');
        if (notes !== '' && notes !== matched.notes) plan.changedFields.push('Notes');
      }
    }

    if (plan.outcome !== 'matched') {
      // Refusal reasons in the published order.
      if (legalName === '') plan.reason = 'Legal name is required';
      else if (leiCell !== '' && !isValidLei(leiCell)) plan.reason = 'LEI check digits do not match';
      else if ((jurisdiction !== '' && !jurisdictionCodes.has(jurisdiction.toUpperCase())) || (jurisdiction === '' && matched === null)) plan.reason = 'Unknown jurisdiction';
      else if (dueCell !== '' && plan.newDue === '') plan.reason = 'Unknown due diligence status';
      else if (codePoints(notes) > 2000) plan.reason = 'Notes are longer than 2,000 characters';
      else {
        const sameRow = matched !== null ? seenCounterparty.get(matched.id) : byLeiRow(plannedNew, 'lei', plan.newLei) ?? byLeiRow(plannedNew, 'name', normaliseName(legalName));
        if (sameRow !== undefined) {
          plan.reason = `Same counterparty as row ${sameRow}`;
        } else if (leiCell !== '' && isValidLei(leiCell) && byName.get(normaliseName(legalName)) !== undefined) {
          plan.reason = 'Legal name matches another counterparty with a different LEI';
        } else if (leiCell === '') {
          plan.reason = 'LEI is required for a new counterparty';
        } else if (licence === '') {
          plan.reason = 'Licence number is required for a new counterparty';
        } else if (email === '') {
          plan.reason = 'Contact email is required';
        } else {
          plan.outcome = 'new';
          plannedNew.set(`lei:${plan.newLei}`, rowNumber);
          plannedNew.set(`name:${normaliseName(legalName)}`, rowNumber);
        }
      }
    }

    plans.push(plan);
  }

  const summary = { matched: plans.filter((p) => p.outcome === 'matched').length, new: plans.filter((p) => p.outcome === 'new').length, refused: plans.filter((p) => p.outcome === 'refused').length };
  return { rows: plans, summary };
}

function byLeiRow(plannedNew: Map<string, number>, kind: 'lei' | 'name', key: string | null): number | undefined {
  if (key === null) return undefined;
  return plannedNew.get(`${kind}:${key}`);
}
