import { FINISH_CATEGORIES } from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, rows, transact, type Queryable } from '../db/pool.js';
import { refuseContractor, requireProject, requireUuid } from '../domain/access.js';
import { csvDocument, raw as csvRaw, text as csvText } from '../domain/csv.js';
import {
  FinishImportRefused,
  planFinishImport,
  type ExistingFinish,
} from '../domain/finishesImport.js';
import { Fields } from '../domain/validate.js';
import { jsonReply, type Reply } from '../http/context.js';
import { conflict, notFound, validation } from '../http/errors.js';
import type { Router } from '../http/router.js';

interface FinishRow {
  id: string;
  position: number;
  code: string;
  name: string;
  category: string;
  supplier: string;
  product_ref: string;
  location: string;
  notes: string;
}

const FINISH_SELECT = `
  SELECT id, position, code, name, category, supplier, product_ref, location, notes
    FROM finishes`;

function finishPayload(row: FinishRow): unknown {
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

async function scheduleOf(client: Queryable, projectId: string): Promise<FinishRow[]> {
  return rows<FinishRow>(
    client,
    `${FINISH_SELECT} WHERE project_id = $1 ORDER BY position`,
    [projectId],
  );
}

function toExisting(row: FinishRow): ExistingFinish {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    supplier: row.supplier,
    productRef: row.product_ref,
    location: row.location,
    notes: row.notes,
  };
}

export function registerFinishRoutes(router: Router): void {
  router.get('/api/projects/:id/finishes', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await requireProject(pool, context.param('id'), member);
    refuseContractor(member);
    const schedule = await scheduleOf(pool, project.id);
    return jsonReply(200, { finishes: schedule.map(finishPayload) });
  });

  router.post('/api/projects/:id/finishes', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead', 'designer');
    const project = await requireProject(pool, context.param('id'), member);
    const body = await context.json();

    const fields = new Fields();
    const code =
      body.code === undefined || body.code === null
        ? ''
        : fields.text('code', body.code, { label: 'Code', min: 0, max: 20, oneLine: true });
    const name = fields.text('name', body.name, { label: 'Name', max: 120, oneLine: true });
    const category = fields.enumeration('category', body.category, 'Category', FINISH_CATEGORIES);
    const supplier = fields.text('supplier', body.supplier ?? '', {
      label: 'Supplier',
      min: 0,
      max: 120,
    });
    const productRef = fields.text('productRef', body.productRef ?? '', {
      label: 'Product ref',
      min: 0,
      max: 60,
    });
    const location = fields.text('location', body.location ?? '', {
      label: 'Location',
      min: 0,
      max: 120,
    });
    const notes = fields.text('notes', body.notes ?? '', { label: 'Notes', min: 0, max: 500 });
    fields.finish();

    if (code !== '') {
      const clash = await firstRow(
        pool,
        'SELECT 1 FROM finishes WHERE project_id = $1 AND code = $2',
        [project.id, code],
      );
      if (clash) throw conflict('code_exists');
    }

    const finishId = newId();
    const count = await firstRow<{ count: number }>(
      pool,
      'SELECT COUNT(*)::int AS count FROM finishes WHERE project_id = $1',
      [project.id],
    );
    await pool.query(
      `INSERT INTO finishes (id, project_id, position, code, name, category, supplier,
                             product_ref, location, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        finishId,
        project.id,
        (count?.count ?? 0) + 1,
        code,
        name,
        category,
        supplier,
        productRef,
        location,
        notes,
      ],
    );
    const created = await firstRow<FinishRow>(pool, `${FINISH_SELECT} WHERE id = $1`, [finishId]);
    if (!created) throw notFound();
    return jsonReply(201, { finish: finishPayload(created) });
  });

  router.post('/api/projects/:id/finishes/import', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead', 'designer');
    const project = await requireProject(pool, context.param('id'), member);
    const csv = await context.csvBody();

    const existing = (await scheduleOf(pool, project.id)).map(toExisting);
    let plan;
    try {
      plan = planFinishImport(csv, existing);
    } catch (error) {
      if (error instanceof FinishImportRefused) throw validation({ file: error.copy });
      throw error;
    }

    await transact(async (client) => {
      let nextPosition =
        (
          await firstRow<{ position: number }>(
            client,
            'SELECT COALESCE(MAX(position), 0) AS position FROM finishes WHERE project_id = $1',
            [project.id],
          )
        )?.position ?? 0;
      for (const operation of plan.operations) {
        if (operation.kind === 'create') {
          nextPosition += 1;
          await client.query(
            `INSERT INTO finishes (id, project_id, position, code, name, category, supplier,
                                   product_ref, location, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              newId(),
              project.id,
              nextPosition,
              operation.values.code,
              operation.values.name,
              operation.values.category,
              operation.values.supplier,
              operation.values.productRef,
              operation.values.location,
              operation.values.notes,
            ],
          );
          continue;
        }
        await client.query(
          `UPDATE finishes SET code = $2, name = $3, category = $4, supplier = $5,
                               product_ref = $6, location = $7, notes = $8
            WHERE id = $1`,
          [
            operation.id,
            operation.values.code,
            operation.values.name,
            operation.values.category,
            operation.values.supplier,
            operation.values.productRef,
            operation.values.location,
            operation.values.notes,
          ],
        );
      }
    });

    return jsonReply(200, { summary: plan.summary, rows: plan.rows });
  });

  router.post('/api/finishes/:id/move', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead', 'designer');
    const finishId = requireUuid(context.param('id'));
    const finish = await firstRow<{ id: string; project_id: string }>(
      pool,
      'SELECT id, project_id FROM finishes WHERE id = $1',
      [finishId],
    );
    if (!finish) throw notFound();
    const project = await requireProject(pool, finish.project_id, member);
    const body = await context.json();

    const schedule = await scheduleOf(pool, project.id);
    const fields = new Fields();
    const position = fields.integer('position', body.position, 'Position', 1, schedule.length);
    fields.finish();

    const reordered = schedule.filter((row) => row.id !== finish.id);
    const moved = schedule.find((row) => row.id === finish.id);
    if (!moved) throw notFound();
    reordered.splice(position - 1, 0, moved);

    await transact(async (client) => {
      for (const [index, row] of reordered.entries()) {
        await client.query('UPDATE finishes SET position = $2 WHERE id = $1', [row.id, index + 1]);
      }
    });

    return jsonReply(200, {
      finishes: (await scheduleOf(pool, project.id)).map(finishPayload),
    });
  });

  router.get('/api/projects/:id/finishes.csv', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await requireProject(pool, context.param('id'), member);
    refuseContractor(member);
    const schedule = await scheduleOf(pool, project.id);
    const document = csvDocument(
      ['position', 'code', 'name', 'category', 'supplier', 'product_ref', 'location', 'notes'],
      schedule.map((row) => [
        csvRaw(String(row.position)),
        csvText(row.code),
        csvText(row.name),
        csvText(row.category),
        csvText(row.supplier),
        csvText(row.product_ref),
        csvText(row.location),
        csvText(row.notes),
      ]),
    );
    return {
      status: 200,
      bytes: Buffer.from(document, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      headers: { 'Content-Disposition': 'attachment; filename="finishes.csv"' },
    };
  });
}

