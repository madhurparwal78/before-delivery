/**
 * The API routes: one place maps requests to reads and edits, with the
 * error precedence and the one error shape.
 */
import { IncomingMessage, ServerResponse } from 'node:http';
import { PoolClient } from 'pg';
import { Database } from './db.js';
import { DocState } from './docstate.js';
import { ApiError, COPY, errorBody, invalid, notFound, forbidden } from '../shared/errors.js';
import { parseJson, RawNumber } from '../shared/decimal.js';
import { Access, documentAccess, viewFor, Person } from './access.js';
import { runEdit, RecalcResponse, readStacks, EditContext } from './edits-core.js';
import * as ops from './edits-ops.js';
import { runUndo } from './undo.js';
import { jsonTable, rowDisplay } from './jsoncells.js';
import { evaluateDoc, previewFormula } from './evaluator.js';
import { diagText } from './formula.js';
import { tableName, apiColumns } from './names.js';
import * as exports_ from './exports.js';
import { Storage } from './storage.js';
import { sendMail } from './mail.js';
import { createSession, endSession, personForSession, verifyPassword } from './auth.js';

export interface AppConfig {
  publicUrl: string;
  mailFrom: string;
  smtpHost: string;
  smtpPort: number;
  ttlSeconds: number;
}

export interface Services {
  db: Database;
  storage: Storage;
  config: AppConfig;
}

export interface RequestCtx {
  req: IncomingMessage;
  res: ServerResponse;
  services: Services;
  pathname: string;
  query: URLSearchParams;
  bodyText: string;
  body: unknown;
  sessionToken: string | undefined;
  person: Person | null;
}

const sendJson = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
};

const sendError = (res: ServerResponse, err: ApiError): void => {
  sendJson(res, err.status, errorBody(err));
};

const isDatabaseDown = (err: unknown): boolean => {
  if (err instanceof ApiError) return false;
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('ECONNREFUSED') ||
    message.includes('connection terminated') ||
    message.includes('could not connect') ||
    message.includes('terminating connection') ||
    message.includes('Connection terminated') ||
    message.includes('connection refused') ||
    message.includes('does not exist') === false && message.includes('document missing')
  );
};

/** One read transaction with the caller's session resolved. */
async function withClient<T>(services: Services, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return services.db.withClient(fn);
}

async function requirePerson(ctx: RequestCtx): Promise<Person> {
  if (!ctx.person) {
    throw new ApiError(401, 'unauthenticated', 'Sign in first.');
  }
  return ctx.person;
}

async function requireDocument(ctx: RequestCtx, documentId: string): Promise<{ person: Person; access: Access }> {
  const person = await requirePerson(ctx);
  const { access, documentExists } = await withClient(ctx.services, (client) =>
    documentAccess(client, documentId, person),
  );
  if (!documentExists) throw notFound();
  return { person, access };
}

const readBodyObject = (ctx: RequestCtx): Record<string, unknown> => {
  if (ctx.body === undefined || ctx.body === null || typeof ctx.body !== 'object') return {};
  return ctx.body as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Route handling
// ---------------------------------------------------------------------------

export async function handleApi(ctx: RequestCtx): Promise<void> {
  const { pathname } = ctx;
  const method = ctx.req.method ?? 'GET';
  try {
    if (pathname === '/api/health' && method === 'GET') {
      sendJson(ctx.res, 200, { status: 'ok' });
      return;
    }

    if (pathname === '/api/auth/sign-in' && method === 'POST') {
      await signIn(ctx);
      return;
    }
    if (pathname === '/api/auth/sign-out' && method === 'POST') {
      await signOut(ctx);
      return;
    }
    if (pathname === '/api/me' && method === 'GET') {
      const person = await requirePerson(ctx);
      sendJson(ctx.res, 200, { user: { id: person.id, email: person.email, display_name: person.displayName } });
      return;
    }

    const person = await requirePerson(ctx);

    if (pathname === '/api/documents' && method === 'GET') {
      const documents = await withClient(ctx.services, async (client) => {
        const r = await client.query<{ id: string; name: string; role: string }>(
          `SELECT d.id, d.name, COALESCE(s.role, 'owner') AS role
           FROM documents d LEFT JOIN shares s ON s.document_id = d.id AND s.email = $2
           WHERE d.owner_person_id = $1 OR s.email = $2
           ORDER BY d.name`,
          [person.id, person.email],
        );
        return r.rows;
      });
      sendJson(ctx.res, 200, {
        documents: documents.map((d) => ({ id: d.id, name: d.name, role: d.role })),
      });
      return;
    }

    if (pathname === '/api/documents' && method === 'POST') {
      const body = readBodyObject(ctx);
      ops.validateDocumentName(body.name);
      const id = await withClient(ctx.services, async (client) => {
        const docId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        await client.query(
          'INSERT INTO documents (id, name, owner_person_id, revision) VALUES ($1, $2, $3, 0)',
          [docId, body.name, person.id],
        );
        return docId;
      });
      sendJson(ctx.res, 201, { document: { id, name: body.name, role: 'owner' } });
      return;
    }

    const docMatch = /^\/api\/documents\/([^/]+)$/.exec(pathname);
    if (docMatch && method === 'GET') {
      const { access } = await requireDocument(ctx, docMatch[1]!);
      const data = await withClient(ctx.services, async (client) => {
        const state = await DocState.load(client, docMatch[1]!);
        const view = viewFor(person.email, access, state);
        const stacks = await readStacks(client, person.id, docMatch[1]!);
        const ev = evaluateDoc(state, view);
        const tables = state.tables.map((t) => ({
          id: t.id,
          name: tableName(state, t),
          kind: t.kind,
          revision: t.revision,
          row_count: t.kind === 'summary' ? (ev.groups.get(t.id)?.length ?? 0) : view.visibleRows(t.id, state).length,
          column_count: apiColumns(state, t.id).length,
          source_table_id: t.sourceTableId,
        }));
        return { state, stacks, tables };
      });
      const doc = await withClient(ctx.services, (client) =>
        client.query<{ name: string; revision: number }>('SELECT name, revision FROM documents WHERE id = $1', [docMatch[1]!]),
      );
      sendJson(ctx.res, 200, {
        document: {
          id: docMatch[1],
          name: doc.rows[0]!.name,
          role: access.role,
          row_scope: access.rowScope,
          revision: data.state.revision,
          undo_count: data.stacks.undo_count,
          redo_count: data.stacks.redo_count,
        },
        tables: data.tables,
      });
      return;
    }

    const historyMatch = /^\/api\/documents\/([^/]+)\/history$/.exec(pathname);
    if (historyMatch && method === 'GET') {
      await requireDocument(ctx, historyMatch[1]!);
      const entries = await withClient(ctx.services, (client) =>
        client.query<{ revision: number; kind: string; actor_id: string; table_id: string | null }>(
          'SELECT revision, kind, actor_id, table_id FROM history WHERE document_id = $1 ORDER BY revision',
          [historyMatch[1]!],
        ),
      );
      sendJson(ctx.res, 200, {
        entries: entries.rows.map((e) => ({
          revision: e.revision,
          kind: e.kind,
          actor_id: e.actor_id,
          table_id: e.table_id,
        })),
      });
      return;
    }

    const undoMatch = /^\/api\/documents\/([^/]+)\/(undo|redo)$/.exec(pathname);
    if (undoMatch && method === 'POST') {
      const { access } = await requireDocument(ctx, undoMatch[1]!);
      const result = await runUndo(
        ctx.services.db,
        undoMatch[1]!,
        person,
        access,
        {
          method,
          path: pathname,
          query: ctx.query.toString(),
          bodyText: ctx.bodyText,
          idempotencyKey: idKey(ctx),
          ttlSeconds: ctx.services.config.ttlSeconds,
        },
        undoMatch[2] as 'undo' | 'redo',
      );
      sendJson(ctx.res, result.status, result.body, result ? (result.status === 200 && idKey(ctx) ? {} : {}) : {});
      return;
    }

    const sharesMatch = /^\/api\/documents\/([^/]+)\/shares$/.exec(pathname);
    if (sharesMatch) {
      await handleShares(ctx, person, sharesMatch[1]!, method);
      return;
    }
    const resendMatch = /^\/api\/documents\/([^/]+)\/shares\/([^/]+)\/resend$/.exec(pathname);
    if (resendMatch && method === 'POST') {
      await handleResend(ctx, person, resendMatch[1]!, resendMatch[2]!);
      return;
    }

    const exportsListMatch = /^\/api\/documents\/([^/]+)\/exports$/.exec(pathname);
    if (exportsListMatch && method === 'GET') {
      await requireDocument(ctx, exportsListMatch[1]!);
      const list = await withClient(ctx.services, (client) =>
        exports_.listExports(client, exportsListMatch[1]!, person.id),
      );
      sendJson(ctx.res, 200, { exports: list });
      return;
    }

    const exportOneMatch = /^\/api\/exports\/([^/]+)$/.exec(pathname);
    if (exportOneMatch && method === 'GET') {
      const record = await withClient(ctx.services, (client) => exports_.getExport(client, exportOneMatch[1]!));
      if (!record || record.created_by !== person.id) throw notFound();
      sendJson(ctx.res, 200, { export: record });
      return;
    }
    const downloadMatch = /^\/api\/exports\/([^/]+)\/download$/.exec(pathname);
    if (downloadMatch && method === 'GET') {
      await handleDownload(ctx, person, downloadMatch[1]!);
      return;
    }

    const tableMatch = /^\/api\/documents\/([^/]+)\/tables\/([^/]+)(?:\/(.*))?$/.exec(pathname);
    if (tableMatch) {
      await handleTable(ctx, person, tableMatch[1]!, tableMatch[2]!, tableMatch[3] ?? '', method);
      return;
    }

    const tablesMatch = /^\/api\/documents\/([^/]+)\/tables$/.exec(pathname);
    if (tablesMatch && method === 'POST') {
      const { access } = await requireDocument(ctx, tablesMatch[1]!);
      if (access.role !== 'owner') throw forbidden();
      const body = readBodyObject(ctx);
      const result = await runEdit(
        ctx.services.db,
        tablesMatch[1]!,
        person,
        access,
        editOpts(ctx),
        (editCtx) => ops.opCreateTable(editCtx, body.name),
      );
      sendJson(ctx.res, result.status, result.body);
      return;
    }

    const summaryMatch = /^\/api\/documents\/([^/]+)\/summaries$/.exec(pathname);
    if (summaryMatch && method === 'POST') {
      const { access } = await requireDocument(ctx, summaryMatch[1]!);
      if (access.role !== 'owner') throw forbidden();
      const body = readBodyObject(ctx);
      const result = await runEdit(
        ctx.services.db,
        summaryMatch[1]!,
        person,
        access,
        editOpts(ctx),
        (editCtx) =>
          ops.opCreateSummary(editCtx, {
            source_table_id: body.source_table_id,
            group_by: body.group_by,
            sum_columns: body.sum_columns ?? [],
          }),
      );
      sendJson(ctx.res, result.status, result.body);
      return;
    }

    throw notFound('Not found.');
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(ctx.res, err);
      return;
    }
    if (isDatabaseDown(err)) {
      sendError(ctx.res, new ApiError(503, 'database_unavailable', 'The database is unreachable.'));
      return;
    }
    console.error('api error:', err instanceof Error ? err.stack : err);
    sendError(ctx.res, new ApiError(500, 'internal', 'Something went wrong.'));
  }
}

const idKey = (ctx: RequestCtx): string | undefined => {
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key === 'string' && key.length > 0) return key;
  return undefined;
};

const editOpts = (ctx: RequestCtx) => ({
  method: ctx.req.method ?? 'GET',
  path: ctx.pathname,
  query: ctx.query.toString(),
  bodyText: ctx.bodyText,
  idempotencyKey: idKey(ctx),
  ttlSeconds: ctx.services.config.ttlSeconds,
});

// ---------------------------------------------------------------------------
// Sign-in and sign-out
// ---------------------------------------------------------------------------

async function signIn(ctx: RequestCtx): Promise<void> {
  const body = readBodyObject(ctx);
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const failure = new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.');
  const result = await withClient(ctx.services, async (client) => {
    const r = await client.query<{ id: string; email: string; display_name: string; password_hash: string }>(
      'SELECT id, email, display_name, password_hash FROM persons WHERE email = $1',
      [email.toLowerCase()],
    );
    const account = r.rows[0];
    if (!account) return { ok: false as const };
    const ok = await verifyPassword(password, account.password_hash);
    if (!ok) return { ok: false as const };
    const token = await createSession(client, account.id);
    return { ok: true as const, account, token };
  });
  if (!result.ok) throw failure;
  ctx.res.setHeader('Set-Cookie', `tf_session=${result.token}; Path=/; HttpOnly; SameSite=Lax`);
  sendJson(ctx.res, 200, {
    user: { id: result.account.id, email: result.account.email, display_name: result.account.display_name },
  });
}

async function signOut(ctx: RequestCtx): Promise<void> {
  await withClient(ctx.services, (client) => endSession(client, ctx.sessionToken));
  ctx.res.setHeader('Set-Cookie', 'tf_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  ctx.res.writeHead(204, { 'Cache-Control': 'no-store' });
  ctx.res.end();
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

async function handleTable(
  ctx: RequestCtx,
  person: Person,
  documentId: string,
  tableId: string,
  rest: string,
  method: string,
): Promise<void> {
  const { access } = await requireDocument(ctx, documentId);
  const opts = editOpts(ctx);

  // GET table read
  if (rest === '' && method === 'GET') {
    const data = await withClient(ctx.services, async (client) => {
      const state = await DocState.load(client, documentId);
      if (!state.tableById(tableId)) throw notFound();
      const view = viewFor(person.email, access, state);
      const ev = evaluateDoc(state, view);
      const stacks = await readStacks(client, person.id, documentId);
      return {
        table: jsonTable(state, view, tableId, ev),
        stacks,
        revision: state.revision,
      };
    });
    sendJson(ctx.res, 200, {
      table: data.table,
      access: { role: access.role, row_scope: access.rowScope },
      stacks: data.stacks,
      document_revision: data.revision,
    });
    return;
  }

  const body = readBodyObject(ctx);
  const run = (
    op: (editCtx: EditContext) => Promise<import('./edits-core.js').EditOutcome>,
    preRun?: (editCtx: EditContext) => Promise<void>,
  ) => runEdit(ctx.services.db, documentId, person, access, opts, op, preRun);

  if (rest === '' && method === 'PATCH') {
    const result = await run(
      (editCtx) => ops.opRenameTable(editCtx, tableId, body.name, body.revision),
      async (editCtx) => {
        const table = editCtx.preState.tableById(tableId);
        if (!table) throw notFound();
        if (access.role === 'viewer') throw forbidden();
        if (access.role !== 'owner') throw forbidden();
      },
    );
    sendJson(ctx.res, result.status, result.body);
    return;
  }

  if (rest === 'columns' && method === 'POST') {
    const result = await run(
      (editCtx) =>
        ops.opAddColumn(editCtx, tableId, {
          name: body.name,
          type: body.type,
          target_table_id: body.target_table_id,
          formula: body.formula,
        }),
      async (editCtx) => {
        if (!editCtx.preState.tableById(tableId)) throw notFound();
        if (access.role !== 'owner') throw forbidden();
      },
    );
    sendJson(ctx.res, result.status, result.body);
    return;
  }

  const columnMatch = /^columns\/([^/]+)$/.exec(rest);
  if (columnMatch && method === 'PATCH') {
    const columnId = columnMatch[1]!;
    const result = await run(
      (editCtx) =>
        ops.opUpdateColumn(editCtx, tableId, columnId, {
          revision: body.revision,
          name: body.name,
          type: body.type,
          formula: body.formula,
        }, false),
      async (editCtx) => {
        const table = editCtx.preState.tableById(tableId);
        if (!table) throw notFound();
        if (!editCtx.preState.columnOf(tableId, columnId)) throw notFound();
        if (access.role === 'viewer') throw forbidden();
        if (access.role !== 'owner' && (body.name !== undefined || body.type !== undefined)) throw forbidden();
      },
    );
    sendJson(ctx.res, result.status, result.body);
    return;
  }
  if (columnMatch && method === 'DELETE') {
    const columnId = columnMatch[1]!;
    const result = await run(
      (editCtx) => ops.opDeleteColumn(editCtx, tableId, columnId),
      async (editCtx) => {
        const table = editState(editCtx, tableId);
        if (!table) throw notFound();
        if (!editCtx.preState.columnOf(tableId, columnId)) throw notFound();
        if (access.role !== 'owner') throw forbidden();
      },
    );
    sendJson(ctx.res, result.status, result.body);
    return;
  }

  if (rest === 'access' && method === 'PUT') {
    const result = await run(
      (editCtx) => ops.opSetAccess(editCtx, tableId, body.owner_column_id ?? null),
      async (editCtx) => {
        if (!editCtx.preState.tableById(tableId)) throw notFound();
        if (access.role !== 'owner') throw forbidden();
      },
    );
    sendJson(ctx.res, result.status, result.body);
    return;
  }

  if (rest === 'rows' && method === 'POST') {
    const result = await run(
      (editCtx) => ops.opAddRow(editCtx, tableId, (body.cells as Record<string, unknown>) ?? {}),
      async (editCtx) => {
        if (!editCtx.preState.tableById(tableId)) throw notFound();
        if (access.role === 'viewer') throw forbidden();
      },
    );
    sendJson(ctx.res, result.status, result.body);
    return;
  }

  const rowMatch = /^rows\/([^/]+)$/.exec(rest);
  if (rowMatch && method === 'DELETE') {
    const rowId = rowMatch[1]!;
    const revision = parseRevision(ctx.query.get('revision'));
    const result = await run(
      (editCtx) => ops.opDeleteRow(editCtx, tableId, rowId, revision),
      async (editCtx) => {
        const row = editCtx.preState.rows.get(rowId);
        if (!row || row.deleted || row.tableId !== tableId) throw notFound();
        if (!editCtx.view.visibleRows(tableId, editCtx.preState).some((r) => r.id === rowId)) throw notFound();
        if (access.role === 'viewer') throw forbidden();
      },
    );
    sendJson(ctx.res, result.status, result.body);
    return;
  }

  const cellMatch = /^rows\/([^/]+)\/cells\/([^/]+)$/.exec(rest);
  if (cellMatch && method === 'PUT') {
    const [rowId, columnId] = [cellMatch[1]!, cellMatch[2]!];
    const result = await run(
      (editCtx) => ops.opWriteCell(editCtx, tableId, rowId, columnId, body.value, body.revision),
      async (editCtx) => {
        ops.resolveWriteTarget(editCtx, tableId, rowId, columnId);
        if (access.role === 'viewer') throw forbidden();
      },
    );
    sendJson(ctx.res, result.status, result.body);
    return;
  }

  if (rest === 'cells' && method === 'POST') {
    const writes = (body.writes as ops.PasteWrite[]) ?? [];
    const result = await run(
      (editCtx) => ops.opPaste(editCtx, tableId, writes),
      async (editCtx) => {
        if (writes.length < 1 || writes.length > 500) return;
        const seen = new Set<string>();
        for (const w of writes) {
          if (typeof w.row_id !== 'string' || typeof w.column_id !== 'string') return;
          const key = `${w.row_id}:${w.column_id}`;
          if (seen.has(key)) throw invalid({ writes: COPY.pasteDuplicate });
          seen.add(key);
        }
        for (const w of writes) {
          ops.resolveWriteTarget(editCtx, tableId, w.row_id as string, w.column_id as string);
        }
        if (access.role === 'viewer') throw forbidden();
      },
    );
    sendJson(ctx.res, result.status, result.body);
    return;
  }

  if (rest === 'formula-preview' && method === 'POST') {
    const state = await withClient(ctx.services, (client) => DocState.load(client, documentId));
    const table = state.tableById(tableId);
    if (!table) throw notFound();
    const view = viewFor(person.email, access, state);
    if (typeof body.row_id !== 'string') throw invalid({ row_id: COPY.chooseRow });
    const row = state.rows.get(body.row_id);
    if (
      !row ||
      row.deleted ||
      row.tableId !== tableId ||
      !view.visibleRows(tableId, state).some((r) => r.id === body.row_id)
    ) {
      throw invalid({ row_id: COPY.chooseRow });
    }
    const formula = typeof body.formula === 'string' ? body.formula : '';
    const result = previewFormula(
      state,
      view,
      tableId,
      body.row_id,
      formula,
      diagText,
      (errorDisplay) => tooltipCopy(errorDisplay),
    );
    sendJson(ctx.res, 200, result);
    return;
  }

  if (rest === 'exports' && method === 'POST') {
    const state = await withClient(ctx.services, (client) => DocState.load(client, documentId));
    const table = state.tableById(tableId);
    if (!table) throw notFound();
    const fileName = `${tableName(state, table)}.csv`;
    const record = await exports_.runExport(
      ctx.services.db,
      ctx.services.storage,
      documentId,
      tableId,
      fileName,
      person,
      access,
    );
    sendJson(ctx.res, 201, { export: record });
    return;
  }

  if (rest === 'formula-preview') throw invalid({ row_id: COPY.chooseRow });
  throw notFound('Not found.');
}

const editState = (editCtx: EditContext, tableId: string) => editCtx.preState.tableById(tableId);

const parseRevision = (raw: string | null): unknown => {
  if (raw === null) return undefined;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return raw;
};

export function tooltipCopy(errorDisplay: string): string {
  switch (errorDisplay) {
    case '#DIV/0!':
      return COPY.tooltip.DIV0;
    case '#TYPE!':
      return COPY.tooltip.TYPE;
    case '#NAME?':
      return COPY.tooltip.NAME;
    case '#REF!':
      return COPY.tooltip.REF;
    case '#CIRC!':
      return COPY.tooltip.CIRC;
    default:
      return COPY.tooltip.TYPE;
  }
}

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

const validShareEmail = (email: unknown): string | null => {
  if (typeof email !== 'string' || email.length < 1 || email.length > 254) return null;
  if (email.split('@').length !== 2) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return null;
  for (const ch of email) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return null;
    if (',;<>"()'.includes(ch)) return null;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') return null;
  }
  return email.toLowerCase();
};

async function handleShares(
  ctx: RequestCtx,
  person: Person,
  documentId: string,
  method: string,
): Promise<void> {
  const { access } = await requireDocument(ctx, documentId);
  if (method === 'GET') {
    const shares = await withClient(ctx.services, (client) =>
      client.query<{ id: string; email: string; role: string; row_scope: string; invite_status: string }>(
        'SELECT id, email, role, row_scope, invite_status FROM shares WHERE document_id = $1 ORDER BY position',
        [documentId],
      ),
    );
    sendJson(ctx.res, 200, {
      shares: shares.rows.map((s) => ({
        id: s.id,
        email: s.email,
        role: s.role,
        row_scope: s.row_scope,
        invite_status: s.invite_status,
      })),
    });
    return;
  }
  if (method !== 'POST') throw notFound();
  if (access.role !== 'owner') throw forbidden();
  const body = readBodyObject(ctx);
  const email = validShareEmail(body.email);
  if (!email) throw invalid({ email: COPY.emailInvalid });
  if (email === person.email.toLowerCase()) throw invalid({ email: COPY.emailSelf });
  if (body.role !== 'editor' && body.role !== 'viewer') {
    throw invalid({ role: 'Choose Editor or Viewer.' });
  }
  if (body.row_scope !== 'all' && body.row_scope !== 'own') {
    throw invalid({ row_scope: 'Choose All rows or Only their own rows.' });
  }
  // one linearisable share action
  const result = await ctx.services.db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`shares:${documentId}`]);
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM shares WHERE document_id = $1 AND email = $2',
      [documentId, email],
    );
    let shareId: string;
    let created: boolean;
    if (existing.rows[0]) {
      shareId = existing.rows[0].id;
      created = false;
      await client.query('UPDATE shares SET role = $1, row_scope = $2 WHERE id = $3', [
        body.role,
        body.row_scope,
        shareId,
      ]);
    } else {
      created = true;
      shareId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const pos = await client.query<{ n: string }>('SELECT COALESCE(MAX(position), 0)::text AS n FROM shares WHERE document_id = $1', [documentId]);
      await client.query(
        'INSERT INTO shares (id, document_id, position, email, role, row_scope, invite_status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [shareId, documentId, parseInt(pos.rows[0]!.n, 10) + 1, email, body.role, body.row_scope, 'sent'],
      );
    }
    return { shareId, created };
  });
  // attempt exactly one invite email, after the share is saved
  const doc = await withClient(ctx.services, (client) =>
    client.query<{ name: string }>('SELECT name FROM documents WHERE id = $1', [documentId]),
  );
  const documentName = doc.rows[0]!.name;
  let sent = true;
  try {
    await sendMail(ctx.services.config.smtpHost, ctx.services.config.smtpPort, {
      from: ctx.services.config.mailFrom,
      to: email,
      subjectDecoded: `${person.displayName} shared ${documentName} with you`,
      body: `${person.displayName} shared "${documentName}" with you as ${body.role === 'editor' ? 'Editor' : 'Viewer'}.\nOpen it here: ${ctx.services.config.publicUrl}/d/${documentId}`,
    });
  } catch {
    sent = false;
  }
  await withClient(ctx.services, (client) =>
    client.query('UPDATE shares SET invite_status = $1 WHERE id = $2', [sent ? 'sent' : 'not_sent', result.shareId]),
  );
  const status = sent ? 'sent' : 'not_sent';
  sendJson(ctx.res, result.created ? 201 : 200, {
    share: {
      id: result.shareId,
      email,
      role: body.role,
      row_scope: body.row_scope,
      invite_status: status,
    },
  });
}

async function handleResend(
  ctx: RequestCtx,
  person: Person,
  documentId: string,
  shareId: string,
): Promise<void> {
  const { access } = await requireDocument(ctx, documentId);
  if (access.role !== 'owner') throw forbidden();
  // exactly one of simultaneous resends sends an email
  const result = await ctx.services.db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`resend:${shareId}`]);
    const share = await client.query<{ id: string; email: string; role: string; invite_status: string }>(
      'SELECT id, email, role, invite_status FROM shares WHERE id = $1 AND document_id = $2',
      [shareId, documentId],
    );
    const row = share.rows[0];
    if (!row) throw notFound();
    if (row.invite_status === 'sent') {
      throw new ApiError(409, 'invite_already_sent', 'This invite was already sent.');
    }
    return row;
  });
  const doc = await withClient(ctx.services, (client) =>
    client.query<{ name: string }>('SELECT name FROM documents WHERE id = $1', [documentId]),
  );
  const documentName = doc.rows[0]!.name;
  let sent = true;
  try {
    await sendMail(ctx.services.config.smtpHost, ctx.services.config.smtpPort, {
      from: ctx.services.config.mailFrom,
      to: result.email,
      subjectDecoded: `${person.displayName} shared ${documentName} with you`,
      body: `${person.displayName} shared "${documentName}" with you as ${result.role === 'editor' ? 'Editor' : 'Viewer'}.\nOpen it here: ${ctx.services.config.publicUrl}/d/${documentId}`,
    });
  } catch {
    sent = false;
  }
  if (!sent) {
    throw new ApiError(503, 'mail_unavailable', 'The mail server is unreachable.');
  }
  await withClient(ctx.services, (client) =>
    client.query('UPDATE shares SET invite_status = $1 WHERE id = $2', ['sent', shareId]),
  );
  sendJson(ctx.res, 200, {
    share: {
      id: result.id,
      email: result.email,
      role: result.role,
      row_scope: (await withClient(ctx.services, (client) => client.query<{ row_scope: string }>('SELECT row_scope FROM shares WHERE id = $1', [shareId]))).rows[0]?.row_scope ?? 'all',
      invite_status: 'sent',
    },
  });
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

async function handleDownload(ctx: RequestCtx, person: Person, exportId: string): Promise<void> {
  const record = await withClient(ctx.services, (client) => exports_.getExport(client, exportId));
  if (!record || record.created_by !== person.id) throw notFound();
  if (record.status !== 'ready') {
    throw new ApiError(409, 'export_not_ready', 'This file is not ready to download yet.');
  }
  const documentId = await withClient(ctx.services, (client) =>
    client.query<{ document_id: string }>('SELECT document_id FROM exports WHERE id = $1', [exportId]),
  );
  const bytes = await exports_.downloadExport(
    ctx.services.storage,
    documentId.rows[0]!.document_id,
    exportId,
    record,
  );
  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': exports_.contentDisposition(record.file_name),
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
  });
  ctx.res.end(bytes);
}

export { rowDisplay, evaluateDoc };
export type { RecalcResponse };
