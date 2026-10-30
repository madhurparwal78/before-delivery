// Finishes: the schedule, the legacy CSV import, reorder and export.

import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { one, query, withTransaction } from '../lib/db.js';
import { conflict, forbidden, notFound, validationError, FIELD_ERRORS } from '../lib/errors.js';
import { requireSession } from '../lib/auth.js';
import { scopedProject } from '../lib/scope.js';
import { throwValidation, wrap } from './helpers.js';
import { csvEscape, csvNeutral } from '../lib/files.js';
import type { Config } from '../lib/config.js';
import { STUDIO_ROLES } from '../lib/types.js';

const CATEGORIES = ['Paint', 'Tile', 'Laminate', 'Stone', 'Timber', 'Metal', 'Fabric', 'Glass', 'Lighting', 'Other'];

interface FinishRow {
  id: string;
  project_id: string;
  position: number;
  code: string | null;
  name: string;
  category: string;
  supplier: string | null;
  product_ref: string | null;
  location: string | null;
  notes: string | null;
}

async function finishesFor(projectId: string): Promise<FinishRow[]> {
  return query<FinishRow>('SELECT * FROM finishes WHERE project_id = $1 ORDER BY position', [projectId]);
}

function finishPayload(row: FinishRow): Record<string, unknown> {
  return {
    id: row.id,
    position: row.position,
    code: row.code,
    name: row.name,
    category: row.category,
    supplier: row.supplier,
    productRef: row.product_ref,
    location: row.location,
    notes: row.notes,
  };
}

/** Normalise a code: trimmed, upper-cased. */
function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Normalise a name: trimmed, inner whitespace collapsed. */
function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function finishesRouter(config: Config): Router {
  const router = Router();
  router.use('/api', requireSession(config.timing.sessionIdleTimeout));

  router.get('/api/projects/:id/finishes', wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    if (member.role === 'contractor') throw forbidden();
    res.json({ finishes: (await finishesFor(project.id)).map(finishPayload) });
  }));

  router.post('/api/projects/:id/finishes', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
    const project = await scopedProject(req, req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const code = typeof body.code === 'string' && body.code.trim() ? normaliseCode(body.code) : null;
    if (code && code.length > 20) errors.code = FIELD_ERRORS.tooLong('Finish code', 20);
    const name = typeof body.name === 'string' ? body.name : '';
    if (!name.trim()) errors.name = FIELD_ERRORS.required('Finish name');
    if (name && name.length > 120) errors.name = FIELD_ERRORS.tooLong('Finish name', 120);
    const category = typeof body.category === 'string' ? body.category : '';
    if (!CATEGORIES.includes(category)) errors.category = FIELD_ERRORS.required('Category');
    const supplier = typeof body.supplier === 'string' ? body.supplier : null;
    const productRef = typeof body.productRef === 'string' ? body.productRef : null;
    const location = typeof body.location === 'string' ? body.location : null;
    const notes = typeof body.notes === 'string' ? body.notes : null;
    if (code) {
      const existing = await one('SELECT id FROM finishes WHERE project_id = $1 AND upper(code) = $2', [project.id, code]);
      if (existing) throw conflict('code_exists');
    }
    throwValidation(errors);
    const position = (await finishesFor(project.id)).length + 1;
    const id = randomUUID();
    await query(
      'INSERT INTO finishes (id, project_id, position, code, name, category, supplier, product_ref, location, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, project.id, position, code, name.trim(), category, supplier, productRef, location, notes],
    );
    const row = await one<FinishRow>('SELECT * FROM finishes WHERE id = $1', [id]);
    res.status(201).json({ finish: finishPayload(row!) });
  }));

  router.post('/api/projects/:id/finishes/import', express.raw({ type: 'text/csv', limit: '1000000b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
    const project = await scopedProject(req, req.params.id);
    const raw = req.body as Buffer;
    if (raw && raw.length > 1_000_000) {
      throw validationError({ file: FIELD_ERRORS.fileTooLarge('The file', 1_000_000) });
    }
    let text = raw ? raw.toString('utf8') : '';
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const lines = text.split(/\r\n|\n|\r/).filter((line) => line.length > 0);
    if (lines.length - 1 > 2000) throw validationError({ file: FIELD_ERRORS.csvTooManyRows });
    const headerCells = parseCsvLine(lines[0] ?? '').map((cell) => cell.trim().toLowerCase());
    const required = ['finish name', 'category'];
    for (const requiredHeader of required) {
      if (!headerCells.includes(requiredHeader)) throw validationError({ file: FIELD_ERRORS.csvMissingColumns });
    }
    const colIndex = (label: string): number => headerCells.indexOf(label);
    const rows: {
      line: number;
      status: 'created' | 'updated' | 'unchanged' | 'rejected';
      code: string | null;
      name: string;
      reason: string | null;
      data: Record<string, string>;
    }[] = [];
    const seenInFile = new Map<string, number>();
    const existing = await finishesFor(project.id);
    const summary = { created: 0, updated: 0, unchanged: 0, rejected: 0 };

    const parseRow = (line: string): Record<string, string> => {
      const cells = parseCsvLine(line);
      const data: Record<string, string> = {};
      for (const header of headerCells) {
        data[header] = cells[colIndex(header)] ?? '';
      }
      return data;
    };

    for (const [index, line] of lines.slice(1).entries()) {
      const lineNumber = index + 2; // header is line 1
      const data = parseRow(line);
      const rawCode = data['finish code'] ?? '';
      const code = rawCode.trim() ? normaliseCode(rawCode) : '';
      const name = normaliseName(data['finish name'] ?? '');
      const category = (data['category'] ?? '').trim();
      const entry = {
        line: lineNumber,
        status: 'rejected' as 'created' | 'updated' | 'unchanged' | 'rejected',
        code: code || null,
        name,
        reason: null as string | null,
        data,
      };
      rows.push(entry);
      if (!name) {
        entry.reason = 'Name is missing.';
        summary.rejected += 1;
        continue;
      }
      if (name.length > 120) {
        entry.reason = FIELD_ERRORS.tooLong('Finish name', 120);
        summary.rejected += 1;
        continue;
      }
      if (code && code.length > 20) {
        entry.reason = FIELD_ERRORS.tooLong('Finish code', 20);
        summary.rejected += 1;
        continue;
      }
      const matchedCategory = CATEGORIES.find((c) => c.toLowerCase() === category.toLowerCase());
      if (!matchedCategory) {
        entry.reason = `Unknown category ${category}.`;
        summary.rejected += 1;
        continue;
      }
      // Duplicates within the file.
      const codeKey = code ? code.toLowerCase() : null;
      const nameKey = `name:${name.toLowerCase()}`;
      if (codeKey && seenInFile.has(codeKey)) {
        entry.reason = `Duplicate of line ${seenInFile.get(codeKey)}.`;
        summary.rejected += 1;
        continue;
      }
      if (seenInFile.has(nameKey)) {
        entry.reason = `Duplicate of line ${seenInFile.get(nameKey)}.`;
        summary.rejected += 1;
        continue;
      }
      if (codeKey) seenInFile.set(codeKey, lineNumber);
      seenInFile.set(nameKey, lineNumber);

      const supplier = data['supplier'] ?? '';
      const productRef = data['product ref'] ?? '';
      const location = data['location'] ?? '';
      const notes = data['notes'] ?? '';
      const fields: FinishFields = {
        code: code || null,
        name,
        category: matchedCategory,
        supplier: supplier.trim() || null,
        productRef: productRef.trim() || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
      };
      // 1. Code matches an existing code.
      const byCode = code ? existing.find((f) => f.code !== null && f.code.toUpperCase() === code) : undefined;
      const byName = existing.filter((f) => f.name.toLowerCase() === name.toLowerCase());
      if (byCode) {
        const changed = applyUpdate(byCode, fields);
        entry.status = changed ? 'updated' : 'unchanged';
        summary[changed ? 'updated' : 'unchanged'] += 1;
        continue;
      }
      if (byName.length === 1) {
        const match = byName[0];
        if (code && match.code !== null && match.code.toUpperCase() !== code) {
          entry.reason = `Code ${code} conflicts with ${match.code} for the same name.`;
          summary.rejected += 1;
          continue;
        }
        const changed = applyUpdate(match, fields);
        entry.status = changed ? 'updated' : 'unchanged';
        summary[changed ? 'updated' : 'unchanged'] += 1;
        continue;
      }
      if (byName.length > 1) {
        entry.reason = 'Name matches more than one finish.';
        summary.rejected += 1;
        continue;
      }
      // No match: create at the end of the schedule.
      const newFinish = {
        id: randomUUID(),
        project_id: project.id,
        position: existing.length + 1,
        ...fields,
        isNew: true,
      } as unknown as NewFinish;
      existing.push(newFinish);
      entry.status = 'created';
      summary.created += 1;
    }

    // Persist in one unit: created rows insert at the end, updated rows update.
    await withTransaction(async (client) => {
      const createRows = rows.filter((row) => row.status === 'created');
      let nextPosition = existing.filter((f) => !(f as NewFinish).isNew).length + 1;
      for (const row of createRows) {
        const createdFinish = existing.find((f) => (f as NewFinish).isNew && f.name === row.name);
        if (!createdFinish) continue;
        await client.query(
          'INSERT INTO finishes (id, project_id, position, code, name, category, supplier, product_ref, location, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            createdFinish.id,
            project.id,
            nextPosition,
            createdFinish.code,
            createdFinish.name,
            createdFinish.category,
            createdFinish.supplier,
            createdFinish.product_ref,
            createdFinish.location,
            createdFinish.notes,
          ],
        );
        (createdFinish as NewFinish).isNew = false;
        nextPosition += 1;
      }
      const updateRows = rows.filter((row) => row.status === 'updated');
      for (const row of updateRows) {
        const match =
          (row.code ? existing.find((f) => f.code !== null && f.code.toUpperCase() === row.code) : undefined) ??
          existing.find((f) => f.name.toLowerCase() === row.name.toLowerCase() && !(f as NewFinish).isNew);
        if (!match) continue;
        await client.query(
          'UPDATE finishes SET code = $1, category = $2, supplier = $3, product_ref = $4, location = $5, notes = $6 WHERE id = $7',
          [match.code, match.category, match.supplier, match.product_ref, match.location, match.notes, match.id],
        );
      }
    });
    res.json({
      summary,
      rows: rows.map((row) => ({
        line: row.line,
        status: row.status,
        code: row.code,
        name: row.name,
        reason: row.reason,
      })),
    });
  }));

  router.post('/api/finishes/:id/move', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
    const finish = await one<FinishRow>('SELECT * FROM finishes WHERE id = $1', [req.params.id]);
    if (!finish) throw notFound();
    const project = await scopedProject(req, finish.project_id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const position = body.position;
    if (typeof position !== 'number' || !Number.isInteger(position)) throw validationError({ position: FIELD_ERRORS.required('Position') });
    const finishes = await finishesFor(project.id);
    if (position < 1 || position > finishes.length) throw validationError({ position: FIELD_ERRORS.range('Position', `1 and ${finishes.length}`) });
    await withTransaction(async (client) => {
      const rows = (await client.query<FinishRow>('SELECT * FROM finishes WHERE project_id = $1 ORDER BY position', [project.id])).rows;
      const from = rows.findIndex((row) => row.id === finish.id);
      const moving = rows.splice(from, 1)[0];
      rows.splice(position - 1, 0, moving);
      for (const [index, row] of rows.entries()) {
        await client.query('UPDATE finishes SET position = $1 WHERE id = $2', [index + 1, row.id]);
      }
    });
    res.json({ finishes: (await finishesFor(project.id)).map(finishPayload) });
  }));

  router.get('/api/projects/:id/finishes.csv', wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    if (!STUDIO_ROLES.includes(member.role)) throw forbidden();
    const finishes = await finishesFor(project.id);
    const lines = ['position,code,name,category,supplier,product_ref,location,notes'];
    for (const finish of finishes) {
      lines.push(
        [
          String(finish.position),
          finish.code ?? '',
          finish.name,
          finish.category,
          finish.supplier ?? '',
          finish.product_ref ?? '',
          finish.location ?? '',
          finish.notes ?? '',
        ]
          .map((cell) => csvEscape(csvNeutral(cell)))
          .join(','),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(lines.join('\r\n') + '\r\n');
  }));

  return router;
}

interface NewFinish extends FinishRow {
  isNew: boolean;
}

interface FinishFields {
  code: string | null;
  name: string;
  category: string;
  supplier: string | null;
  productRef: string | null;
  location: string | null;
  notes: string | null;
}

function applyUpdate(finish: FinishRow, fields: FinishFields): boolean {
  let changed = false;
  if (finish.category !== fields.category) {
    finish.category = fields.category;
    changed = true;
  }
  if ((finish.supplier ?? '') !== (fields.supplier ?? '')) {
    finish.supplier = fields.supplier;
    changed = true;
  }
  if ((finish.product_ref ?? '') !== (fields.productRef ?? '')) {
    finish.product_ref = fields.productRef;
    changed = true;
  }
  if ((finish.location ?? '') !== (fields.location ?? '')) {
    finish.location = fields.location;
    changed = true;
  }
  if ((finish.notes ?? '') !== (fields.notes ?? '')) {
    finish.notes = fields.notes;
    changed = true;
  }
  if (finish.code === null && fields.code !== null) {
    finish.code = fields.code;
    changed = true;
  }
  return changed;
}

/** Parse one CSV line with RFC 4180 quoting. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
