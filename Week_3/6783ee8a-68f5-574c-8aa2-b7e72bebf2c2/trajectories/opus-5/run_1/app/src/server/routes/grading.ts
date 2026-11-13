import type { Cell, CellType, FieldError, NotebookOutput } from '../../shared/types.js';
import { createCheckpoint } from '../checkpoints.js';
import { config } from '../config.js';
import { query, queryOne, withTransaction } from '../db.js';
import { notFound, validationFailed } from '../errors.js';
import { readJsonBody, route, sendJson, type Ctx } from '../http.js';
import { hashPassword, newId, newToken } from '../ids.js';
import { loadCells, notebookFileOf, syncSearchDocument } from '../notebookstore.js';
import { putObject, storageKeys } from '../storage.js';

interface SeedUser {
  key: string;
  email: string;
  display_name: string;
  password: string;
}

interface SeedCell {
  id?: string;
  cell_type: CellType;
  source: string;
  outputs?: NotebookOutput[];
  execution_count?: number | null;
}

interface SeedNotebook {
  key: string;
  owner: string;
  title: string;
  cells: SeedCell[];
  execution_counter?: number;
  shares?: { user: string; role: 'editor' | 'viewer' }[];
  checkpoints?: { label: string; cells: SeedCell[] }[];
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((entry) => (entry ?? {}) as Record<string, unknown>) : [];
}

function asCellType(value: unknown): CellType | null {
  return value === 'code' || value === 'markdown' ? value : null;
}

function seedCells(raw: unknown, path: string, errors: FieldError[]): SeedCell[] {
  return asArray(raw).map((entry, index) => {
    const cellType = asCellType(entry.cell_type);
    if (cellType === null) {
      errors.push({ path: `${path}[${index}].cell_type`, message: 'must be "code" or "markdown"' });
    }
    return {
      id: typeof entry.id === 'string' ? entry.id : undefined,
      cell_type: cellType ?? 'code',
      source: typeof entry.source === 'string' ? entry.source : '',
      outputs: Array.isArray(entry.outputs) ? (entry.outputs as NotebookOutput[]) : [],
      execution_count:
        typeof entry.execution_count === 'number' ? entry.execution_count : null,
    };
  });
}

function toCells(cells: SeedCell[], ids: string[]): Cell[] {
  return cells.map((cell, index) => ({
    id: ids[index],
    position: index,
    cell_type: cell.cell_type,
    source: cell.source,
    revision: 1,
    execution_count: cell.execution_count ?? null,
    run_state: 'idle',
    outputs: cell.outputs ?? [],
    outputs_version: 1,
    metadata: {},
    locked_by: null,
  }));
}

export function registerGradingRoutes(): void {
  route('POST', '/api/grading/seed', async (ctx: Ctx) => {
    if (!config.grading) throw notFound();
    const body = await readJsonBody(ctx);
    const errors: FieldError[] = [];

    const users: SeedUser[] = asArray(body.users).map((entry, index) => {
      const user: SeedUser = {
        key: typeof entry.key === 'string' ? entry.key : '',
        email: typeof entry.email === 'string' ? entry.email : '',
        display_name: typeof entry.display_name === 'string' ? entry.display_name : '',
        password: typeof entry.password === 'string' ? entry.password : '',
      };
      if (user.key === '') errors.push({ path: `users[${index}].key`, message: 'is required' });
      if (user.email === '') errors.push({ path: `users[${index}].email`, message: 'is required' });
      if (user.display_name === '') {
        errors.push({ path: `users[${index}].display_name`, message: 'is required' });
      }
      if (user.password === '') errors.push({ path: `users[${index}].password`, message: 'is required' });
      return user;
    });

    const notebooks: SeedNotebook[] = asArray(body.notebooks).map((entry, index) => {
      const path = `notebooks[${index}]`;
      const notebook: SeedNotebook = {
        key: typeof entry.key === 'string' ? entry.key : '',
        owner: typeof entry.owner === 'string' ? entry.owner : '',
        title: typeof entry.title === 'string' ? entry.title : '',
        cells: seedCells(entry.cells, `${path}.cells`, errors),
        execution_counter: typeof entry.execution_counter === 'number' ? entry.execution_counter : 0,
        shares: asArray(entry.shares).map((share, shareIndex) => {
          const user = typeof share.user === 'string' ? share.user : '';
          const role = share.role === 'editor' || share.role === 'viewer' ? share.role : null;
          if (user === '') errors.push({ path: `${path}.shares[${shareIndex}].user`, message: 'is required' });
          if (role === null) {
            errors.push({ path: `${path}.shares[${shareIndex}].role`, message: 'must be "editor" or "viewer"' });
          }
          return { user, role: role ?? 'viewer' };
        }),
        checkpoints: asArray(entry.checkpoints).map((checkpoint, checkpointIndex) => ({
          label: typeof checkpoint.label === 'string' ? checkpoint.label : `Checkpoint ${checkpointIndex + 1}`,
          cells: seedCells(checkpoint.cells, `${path}.checkpoints[${checkpointIndex}].cells`, errors),
        })),
      };
      if (notebook.key === '') errors.push({ path: `${path}.key`, message: 'is required' });
      if (notebook.title === '') errors.push({ path: `${path}.title`, message: 'is required' });
      if (!users.some((user) => user.key === notebook.owner)) {
        errors.push({ path: `${path}.owner`, message: 'must name a seeded user' });
      }
      return notebook;
    });
    if (errors.length > 0) throw validationFailed(errors);

    const userIds = new Map<string, string>();
    const userCookies = new Map<string, string>();
    for (const user of users) {
      const emailLower = user.email.trim().toLowerCase();
      const existing = await queryOne<{ id: string }>(`select id from users where email_lower = $1`, [
        emailLower,
      ]);
      const id = existing ? existing.id : newId();
      if (existing) {
        await query(
          `update users set display_name = $1, password_hash = $2, verified = true, email = $3 where id = $4`,
          [user.display_name, hashPassword(user.password), user.email.trim(), id],
        );
      } else {
        await query(
          `insert into users (id, email, email_lower, display_name, password_hash, verified)
           values ($1, $2, $3, $4, $5, true)`,
          [id, user.email.trim(), emailLower, user.display_name, hashPassword(user.password)],
        );
      }
      const sessionId = newId();
      await query(`insert into sessions (id, user_id) values ($1, $2)`, [sessionId, id]);
      userIds.set(user.key, id);
      userCookies.set(user.key, `bp_session=${sessionId}`);
    }

    const notebookResults: Record<string, { id: string; cell_ids: string[]; checkpoint_ids: string[] }> = {};
    for (const notebook of notebooks) {
      const notebookId = newId();
      const ownerId = userIds.get(notebook.owner) as string;
      const cellIds = notebook.cells.map((cell) => cell.id ?? newId());
      const checkpointIds: string[] = [];

      await withTransaction(async (client) => {
        await client.query(
          `insert into notebooks (id, owner_id, title, execution_counter) values ($1, $2, $3, $4)`,
          [notebookId, ownerId, notebook.title, notebook.execution_counter ?? 0],
        );
        for (let index = 0; index < notebook.cells.length; index += 1) {
          const cell = notebook.cells[index];
          await client.query(
            `insert into cells
               (notebook_id, id, position, cell_type, source, execution_count, outputs)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              notebookId,
              cellIds[index],
              index,
              cell.cell_type,
              cell.source,
              cell.execution_count ?? null,
              JSON.stringify(cell.outputs ?? []),
            ],
          );
        }
        if (notebook.cells.length === 0) {
          await client.query(
            `insert into cells (notebook_id, id, position, cell_type, source) values ($1, $2, 0, 'code', '')`,
            [notebookId, newId()],
          );
        }
        for (const share of notebook.shares ?? []) {
          const sharedUserId = userIds.get(share.user) as string;
          const email = users.find((user) => user.key === share.user) as SeedUser;
          await client.query(
            `insert into shares (id, notebook_id, email, email_lower, role, status, user_id, token)
             values ($1, $2, $3, $4, $5, 'active', $6, $7)`,
            [
              newId(),
              notebookId,
              email.email.trim(),
              email.email.trim().toLowerCase(),
              share.role,
              sharedUserId,
              newToken(),
            ],
          );
        }
        for (const checkpoint of notebook.checkpoints ?? []) {
          const ids = checkpoint.cells.map((cell, index) => cell.id ?? cellIds[index] ?? newId());
          const stored = await createCheckpoint(
            client,
            notebookId,
            checkpoint.label,
            toCells(checkpoint.cells, ids),
          );
          checkpointIds.push(stored.id);
        }
        const stored = await loadCells(notebookId, client);
        await putObject(
          storageKeys.working(notebookId),
          Buffer.from(notebookFileOf(stored), 'utf8'),
          'application/json',
        );
      });

      await syncSearchDocument(notebookId);
      notebookResults[notebook.key] = {
        id: notebookId,
        cell_ids: (await loadCells(notebookId)).map((cell) => cell.id),
        checkpoint_ids: checkpointIds,
      };
    }

    sendJson(ctx, 201, {
      users: Object.fromEntries(
        users.map((user) => [
          user.key,
          { id: userIds.get(user.key) as string, cookie: userCookies.get(user.key) as string },
        ]),
      ),
      notebooks: notebookResults,
    });
  });
}
