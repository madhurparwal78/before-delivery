// Every published API route in one router.
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';
import type { Config } from '../config.js';
import type { LayoutObject, Role } from '../domain/layout.js';
import { generateCss, generateHtml } from '../domain/generate.js';
import { TEMPLATES, type TemplateKey } from '../domain/templates.js';
import { versionDifferences } from '../domain/versions.js';
import { readTrackSize } from '../domain/sizes.js';
import { areaNameError } from '../domain/areas.js';
import { hashPassword, verifyPassword, sessionCookie, SESSION_COOKIE } from './auth.js';
import { usernameError, passwordError, layoutNameError, versionNameError, TEMPLATE_MESSAGE, TAKEN_MESSAGE, WRONG_CREDENTIALS_MESSAGE } from './validation.js';
import { badBody, invalid, json, notFound, readJson, signInRequired, HttpError, type Reply } from './http.js';
import { applyChangeRequest, withLayoutLock, layoutEquals } from './changes.js';
import * as store from '../store/store.js';
import type { Valkey } from '../scaffolding/valkey.js';
import type { LiveHub } from '../scaffolding/hub.js';

export interface RouterContext {
  pool: Pool;
  valkey: Valkey;
  hub: LiveHub;
  config: Config;
  live: () => boolean;
  publishChange: (layoutId: string, revision: number, layout: unknown, username: string, announcement: string | null) => void;
}

export interface RouteCall {
  method: string;
  path: string;
  query: URLSearchParams;
  req: IncomingMessage;
  username: string | null;
  ctx: RouterContext;
}

const TEMPLATE_KEYS: TemplateKey[] = ['blank', 'holy-grail', 'dashboard-shell', 'magazine-spread'];

function layoutObject(record: store.LayoutRecord, role: Role, live: boolean): LayoutObject {
  const data = record.data;
  return {
    id: record.id,
    name: record.name,
    role,
    revision: record.revision,
    columns: data.columns,
    rows: data.rows,
    gap: data.gap,
    areas: data.areas,
    breakpoints: data.breakpoints,
    live,
    css: generateCss(data),
    html: generateHtml(data),
  };
}

export async function handleApi(call: RouteCall): Promise<Reply> {
  const { method, path, ctx } = call;
  if (path === '/api/health') {
    if (method !== 'GET') throw notFound();
    const pgReady = await ctx.pool.query('select 1').then(() => true, () => false);
    if (!pgReady) return json(503, { status: 'starting' });
    const valkeyOk = await ctx.valkey.ping();
    return json(200, { status: valkeyOk ? 'ok' : 'unavailable' });
  }
  if (path === '/api/grading/setup') {
    if (ctx.config.gradingKey === null) throw notFound();
    if (call.req.headers['x-grading-key'] !== ctx.config.gradingKey) throw notFound();
    if (method !== 'POST') throw notFound();
    return gradingSetup(call);
  }
  if (path === '/api/signup' && method === 'POST') {
    const body = await readJson(call.req);
    const username = body['username'];
    const password = body['password'];
    const uErr = usernameError(username);
    if (uErr) throw invalid(uErr);
    const pErr = passwordError(password);
    if (pErr) throw invalid(pErr);
    const existing = await store.findUser(ctx.pool, username as string);
    if (existing !== null) {
      throw new HttpError(409, { error: 'taken', message: TAKEN_MESSAGE });
    }
    await store.createUser(ctx.pool, username as string, hashPassword(password as string));
    const token = await store.createSession(ctx.pool, username as string);
    return json(201, { username }, [sessionCookie(token)]);
  }
  if (path === '/api/session' && method === 'POST') {
    const body = await readJson(call.req);
    const username = body['username'];
    const password = body['password'];
    const stored = typeof username === 'string' ? await store.findUser(ctx.pool, username) : null;
    if (stored === null || typeof password !== 'string' || !verifyPassword(password, stored)) {
      throw new HttpError(401, { error: 'wrong_credentials', message: WRONG_CREDENTIALS_MESSAGE });
    }
    const token = await store.createSession(ctx.pool, username as string);
    return json(200, { username }, [sessionCookie(token)]);
  }
  if (path === '/api/session' && method === 'DELETE') {
    const raw = (call.req.headers.cookie ?? '').split(';').map((p) => p.trim()).find((p) => p.startsWith(`${SESSION_COOKIE}=`));
    if (raw) {
      const token = raw.slice(SESSION_COOKIE.length + 1);
      await store.deleteSession(ctx.pool, token);
    }
    return { status: 204, cookies: [sessionCookie('', true)] };
  }
  if (path === '/api/me' && method === 'GET') {
    if (!call.username) throw signInRequired();
    return json(200, { username: call.username });
  }
  if (path === '/api/layouts' && method === 'GET') {
    if (!call.username) throw signInRequired();
    const layouts = await store.libraryOf(ctx.pool, call.username);
    return json(200, { layouts });
  }
  if (path === '/api/layouts' && method === 'POST') {
    if (!call.username) throw signInRequired();
    const body = await readJson(call.req);
    const nameError = layoutNameError(body['name']);
    if (nameError) throw invalid(nameError);
    const template = (body['template'] ?? 'blank') as string;
    if (!TEMPLATE_KEYS.includes(template as TemplateKey)) throw invalid(TEMPLATE_MESSAGE);
    const data = structuredClone(TEMPLATES[template as TemplateKey]);
    data.name = (body['name'] as string).trim();
    const record: store.LayoutRecord = {
      id: store.newId('lay'),
      name: data.name,
      owner: call.username,
      revision: 1,
      data: { ...data, revision: 1 },
    };
    await store.insertLayout(ctx.pool, record);
    // The co-edit link exists from creation.
    await store.setJoinLink(ctx.pool, record.id, store.newToken());
    return json(201, layoutObject(record, 'owner', ctx.live()));
  }

  const layoutMatch = /^\/api\/layouts\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (layoutMatch) {
    return layoutRoutes(call, layoutMatch[1]!, layoutMatch[2] ?? '');
  }
  const viewMatch = /^\/api\/view\/([^/]+)$/.exec(path);
  if (viewMatch && method === 'GET') {
    const layoutId = await store.layoutOfViewToken(ctx.pool, viewMatch[1]!);
    if (!layoutId) throw notFound();
    const record = await store.loadLayout(ctx.pool, layoutId);
    if (!record) throw notFound();
    return json(200, layoutObject(record, 'viewer', ctx.live()));
  }
  const joinMatch = /^\/api\/join\/([^/]+)$/.exec(path);
  if (joinMatch && method === 'POST') {
    if (!call.username) throw signInRequired();
    const layoutId = await store.layoutOfJoinToken(ctx.pool, joinMatch[1]!);
    if (!layoutId) throw notFound();
    const record = await store.loadLayout(ctx.pool, layoutId);
    if (!record) throw notFound();
    if (record.owner !== call.username) {
      await store.addCollaborator(ctx.pool, layoutId, call.username);
    }
    return json(200, { layout_id: layoutId });
  }
  throw notFound();
}

async function layoutRoutes(call: RouteCall, layoutId: string, rest: string): Promise<Reply> {
  const { method, ctx } = call;
  // Every layout route needs a session; the published order puts sign-in before not-found.
  if (!call.username) throw signInRequired();
  const username = call.username;
  const role = await store.roleFor(ctx.pool, layoutId, username);
  const canOpen = role === 'owner' || role === 'collaborator';
  const record = await store.loadLayout(ctx.pool, layoutId);
  if (!record) throw notFound();

  if (rest === '' && method === 'GET') {
    if (!canOpen) throw notFound();
    return json(200, layoutObject(record, role!, ctx.live()));
  }
  if (rest === 'changes' && method === 'POST') {
    if (!canOpen) throw notFound();
    const body = await readJson(call.req);
    const baseRevision = body['base_revision'];
    const change = body['change'];
    if (typeof baseRevision !== 'number' || typeof change !== 'object' || change === null || Array.isArray(change)) {
      throw badBody();
    }
    const limits = { maxTracks: ctx.config.maxTracks, maxBreakpoints: ctx.config.maxBreakpoints };
    const outcome = await withLayoutLock(layoutId, () =>
      applyChangeRequest({ pool: ctx.pool, layoutId, username, baseRevision, change: change as Record<string, unknown>, limits })
    );
    if (outcome.status === 'refused') {
      if (outcome.message === 'not_found') throw notFound();
      throw invalid(outcome.message!);
    }
    if (outcome.status === 'conflict') {
      const updated = await store.loadLayout(ctx.pool, layoutId);
      throw new HttpError(409, {
        error: 'conflict',
        revision: outcome.revision,
        layout: updated ? layoutObject(updated, role!, ctx.live()) : null,
        username: outcome.conflictWith!.username,
        target: outcome.conflictWith!.target,
        message: `${outcome.conflictWith!.username} changed ${outcome.conflictWith!.target} first. Your change was not applied.`,
      });
    }
    if (outcome.status === 'unchanged') {
      return json(200, { revision: outcome.revision, unchanged: true });
    }
    ctx.publishChange(layoutId, outcome.revision!, outcome.layout, username, outcome.announcement ?? null);
    return json(200, {
      revision: outcome.revision,
      layout: layoutObject({ ...record, data: outcome.layout! }, role!, ctx.live()),
      announcement: outcome.announcement ?? null,
    });
  }
  if (rest === 'versions' && method === 'GET') {
    if (!canOpen) throw notFound();
    return json(200, { versions: await store.versionList(ctx.pool, layoutId) });
  }
  if (rest === 'versions' && method === 'POST') {
    if (!canOpen) throw notFound();
    const body = await readJson(call.req);
    const nameError = versionNameError(body['name']);
    if (nameError) throw invalid(nameError);
    const name = (body['name'] as string).trim();
    const count = await store.versionCount(ctx.pool, layoutId);
    const number = count + 1;
    await store.saveVersion(ctx.pool, layoutId, number, name, record.revision, record.data);
    return json(201, { number, name });
  }
  const versionMatch = /^versions\/(\d+)$/.exec(rest);
  if (versionMatch && method === 'GET') {
    if (!canOpen) throw notFound();
    const version = await store.versionData(ctx.pool, layoutId, Number(versionMatch[1]));
    if (!version) throw notFound();
    return json(200, {
      number: version.number,
      name: version.name,
      layout: { ...version.data, revision: version.revision, id: layoutId, name: record.name, role: role!, live: ctx.live(), css: generateCss(version.data), html: generateHtml(version.data) },
    });
  }
  if (rest === 'compare' && method === 'GET') {
    if (!canOpen) throw notFound();
    const from = Number(call.query.get('from'));
    const to = Number(call.query.get('to'));
    const fromVersion = await store.versionData(ctx.pool, layoutId, from);
    const toVersion = await store.versionData(ctx.pool, layoutId, to);
    if (!fromVersion || !toVersion) throw notFound();
    const differences = versionDifferences(
      { number: fromVersion.number, name: fromVersion.name, layout: fromVersion.data },
      { number: toVersion.number, name: toVersion.name, layout: toVersion.data }
    );
    return json(200, { differences });
  }
  if (rest === 'share' && method === 'GET') {
    if (role !== 'owner') throw notFound();
    const viewToken = await store.viewLinkOf(ctx.pool, layoutId);
    const joinToken = await store.joinLinkOf(ctx.pool, layoutId);
    return json(200, {
      view_path: viewToken ? `/view/${viewToken}` : null,
      join_path: joinToken ? `/join/${joinToken}` : null,
      collaborators: await store.collaboratorsOf(ctx.pool, layoutId),
    });
  }
  if (rest === 'view-link' && method === 'POST') {
    if (role !== 'owner') throw notFound();
    const token = store.newToken();
    await store.setViewLink(ctx.pool, layoutId, token);
    return json(201, { view_path: `/view/${token}` });
  }
  if (rest === 'view-link' && method === 'DELETE') {
    if (role !== 'owner') throw notFound();
    const existing = await store.viewLinkOf(ctx.pool, layoutId);
    if (!existing) throw new HttpError(409, { error: 'no_view_link' });
    await store.revokeViewLink(ctx.pool, layoutId);
    return { status: 204 };
  }
  if (rest === 'join-link' && method === 'POST') {
    if (role !== 'owner') throw notFound();
    const token = store.newToken();
    await store.setJoinLink(ctx.pool, layoutId, token);
    return json(201, { join_path: `/join/${token}` });
  }
  const removeCollabMatch = /^collaborators\/([^/]+)$/.exec(rest);
  if (removeCollabMatch && method === 'DELETE') {
    if (role !== 'owner') throw notFound();
    const username = removeCollabMatch[1]!;
    const list = await store.collaboratorsOf(ctx.pool, layoutId);
    if (!list.includes(username)) throw notFound();
    await store.removeCollaborator(ctx.pool, layoutId, username);
    return { status: 204 };
  }
  throw notFound();
}

async function gradingSetup(call: RouteCall): Promise<Reply> {
  const { ctx } = call;
  const body = await readJson(call.req);
  const users = body['users'];
  const layouts = body['layouts'];
  if (!Array.isArray(users) || !Array.isArray(layouts)) throw badBody();
  const limits = { maxTracks: ctx.config.maxTracks, maxBreakpoints: ctx.config.maxBreakpoints };

  const sessions: Record<string, string> = {};
  const existingUsers = new Set<string>();
  for (const user of users) {
    if (typeof user !== 'object' || user === null) throw badBody();
    const username = (user as Record<string, unknown>)['username'];
    const password = (user as Record<string, unknown>)['password'];
    const uErr = usernameError(username);
    if (uErr) throw invalid(uErr);
    const pErr = passwordError(password);
    if (pErr) throw invalid(pErr);
    const stored = await store.findUser(ctx.pool, username as string);
    if (stored !== null) {
      if (!verifyPassword(password as string, stored)) {
        throw new HttpError(409, { error: 'taken', message: TAKEN_MESSAGE });
      }
    } else {
      await store.createUser(ctx.pool, username as string, hashPassword(password as string));
    }
    existingUsers.add(username as string);
    sessions[username as string] = await store.createSession(ctx.pool, username as string);
  }

  const created: Record<string, { id: string; revision: number; view_path: string | null; join_path: string }> = {};
  for (const spec of layouts) {
    if (typeof spec !== 'object' || spec === null) throw badBody();
    const entry = spec as Record<string, unknown>;
    const owner = entry['owner'];
    if (typeof owner !== 'string' || !existingUsers.has(owner)) throw invalid('Choose a starter template.');
    const ref = entry['ref'];
    if (typeof ref !== 'string' || ref.length === 0) throw badBody();
    const nameError = layoutNameError(entry['name']);
    if (nameError) throw invalid(nameError);
    let data: store.LayoutRecord['data'];
    const template = entry['template'];
    if (typeof template === 'string') {
      if (!TEMPLATE_KEYS.includes(template as TemplateKey)) throw invalid(TEMPLATE_MESSAGE);
      data = structuredClone(TEMPLATES[template as TemplateKey]);
    } else {
      const parsed = readLayoutSpec(entry, limits);
      data = parsed;
    }
    data.name = (entry['name'] as string).trim();
    const record: store.LayoutRecord = {
      id: store.newId('lay'),
      name: data.name,
      owner,
      revision: 1,
      data: { ...data, revision: 1 },
    };
    await store.insertLayout(ctx.pool, record);

    const versions = entry['versions'];
    if (Array.isArray(versions)) {
      for (const [index, versionSpec] of versions.entries()) {
        if (typeof versionSpec !== 'object' || versionSpec === null) throw badBody();
        const versionEntry = versionSpec as Record<string, unknown>;
        const versionNameErr = versionNameError(versionEntry['name']);
        if (versionNameErr) throw invalid(versionNameErr);
        const versionTemplate = versionEntry['template'];
        let versionData: store.LayoutRecord['data'];
        if (typeof versionTemplate === 'string') {
          if (!TEMPLATE_KEYS.includes(versionTemplate as TemplateKey)) throw invalid(TEMPLATE_MESSAGE);
          versionData = structuredClone(TEMPLATES[versionTemplate as TemplateKey]);
        } else {
          versionData = readLayoutSpec(versionEntry, limits);
        }
        versionData.name = record.name;
        await store.saveVersion(ctx.pool, record.id, index + 1, (versionEntry['name'] as string).trim(), 1, versionData);
      }
    }
    const collaborators = entry['collaborators'];
    if (Array.isArray(collaborators)) {
      for (const collaborator of collaborators) {
        if (typeof collaborator !== 'string' || !existingUsers.has(collaborator)) throw invalid('Choose a starter template.');
        await store.addCollaborator(ctx.pool, record.id, collaborator);
      }
    }
    const joinToken = store.newToken();
    await store.setJoinLink(ctx.pool, record.id, joinToken);
    let viewPath: string | null = null;
    if (entry['view_link'] === true) {
      const token = store.newToken();
      await store.setViewLink(ctx.pool, record.id, token);
      viewPath = `/view/${token}`;
    }
    created[ref] = { id: record.id, revision: 1, view_path: viewPath, join_path: `/join/${joinToken}` };
  }
  return json(201, { sessions, layouts: created });
}

function readLayoutSpec(entry: Record<string, unknown>, limits: { maxTracks: number; maxBreakpoints: number }): store.LayoutRecord['data'] {
  const columns = entry['columns'];
  const rows = entry['rows'];
  const gap = entry['gap'];
  const areas = entry['areas'];
  const breakpoints = entry['breakpoints'];
  if (!Array.isArray(columns) || !Array.isArray(rows) || columns.length === 0 || rows.length === 0) {
    throw invalid('A layout needs at least one column.');
  }
  if (columns.length > limits.maxTracks) throw invalid(`A layout can have at most ${limits.maxTracks} columns.`);
  if (rows.length > limits.maxTracks) throw invalid(`A layout can have at most ${limits.maxTracks} rows.`);
  const columnSizes = columns.map((c) => readSpecSize(c));
  const rowSizes = rows.map((r) => readSpecSize(r));
  if (typeof gap !== 'object' || gap === null) throw badBody();
  const gapEntry = gap as Record<string, unknown>;
  const rowGap = gapEntry['row'];
  const columnGap = gapEntry['column'];
  if (typeof rowGap !== 'number' || typeof columnGap !== 'number' || rowGap < 0 || rowGap > 200 || columnGap < 0 || columnGap > 200) {
    throw invalid('Gaps are whole pixels from 0 to 200.');
  }
  const areaLines = Array.isArray(areas) ? areas.map((a) => readSpecArea(a)) : [];
  const bpList: store.LayoutRecord['data']['breakpoints'] = [];
  const seenWidths = new Set<number>();
  if (Array.isArray(breakpoints)) {
    for (const bp of breakpoints) {
      if (typeof bp !== 'object' || bp === null) throw badBody();
      const bpEntry = bp as Record<string, unknown>;
      const minWidth = bpEntry['min_width'];
      if (typeof minWidth !== 'number' || minWidth < 400 || minWidth > 1440) {
        throw invalid('Breakpoints start between 400px and 1440px.');
      }
      if (seenWidths.has(minWidth)) throw invalid(`There is already a breakpoint at ${minWidth}px.`);
      seenWidths.add(minWidth);
      const bpColumns = bpEntry['columns'];
      const bpRows = bpEntry['rows'];
      if (!Array.isArray(bpColumns) || !Array.isArray(bpRows) || bpColumns.length === 0 || bpRows.length === 0) {
        throw invalid('A layout needs at least one column.');
      }
      const bpGap = bpEntry['gap'];
      const bpGapValue = bpGap === null || bpGap === undefined ? null : readSpecGap(bpGap as Record<string, unknown>);
      bpList.push({
        min_width: minWidth,
        columns: bpColumns.map((c) => readSpecSize(c)),
        rows: bpRows.map((r) => readSpecSize(r)),
        areas: Array.isArray(bpEntry['areas']) ? bpEntry['areas'].map((a) => readSpecArea(a)) : [],
        gap: bpGapValue,
      });
    }
    if (bpList.length > limits.maxBreakpoints) throw invalid(`A layout can have at most ${limits.maxBreakpoints} breakpoints.`);
    bpList.sort((a, b) => a.min_width - b.min_width);
  }
  return {
    name: '',
    revision: 1,
    columns: columnSizes,
    rows: rowSizes,
    gap: { row: rowGap, column: columnGap },
    areas: areaLines,
    breakpoints: bpList,
  };
}

function readSpecSize(value: unknown): string {
  if (typeof value !== 'string') throw invalid('Use a size like 1fr, 200px, 25%, auto or minmax(100px, 1fr).');
  const result = readTrackSize(value);
  if (result.error) throw invalid(result.error);
  return result.size!;
}

function readSpecGap(gap: Record<string, unknown>): { row: number; column: number } {
  const row = gap['row'];
  const column = gap['column'];
  if (typeof row !== 'number' || typeof column !== 'number' || row < 0 || row > 200 || column < 0 || column > 200) {
    throw invalid('Gaps are whole pixels from 0 to 200.');
  }
  return { row, column };
}

function readSpecArea(value: unknown): store.LayoutRecord['data']['areas'][number] {
  if (typeof value !== 'object' || value === null) throw badBody();
  const entry = value as Record<string, unknown>;
  const name = entry['name'];
  if (typeof name !== 'string') throw badBody();
  const nameError = areaNameError(name);
  if (nameError) throw invalid(nameError);
  const rowStart = entry['row_start'];
  const columnStart = entry['column_start'];
  const rowEnd = entry['row_end'];
  const columnEnd = entry['column_end'];
  if (typeof rowStart !== 'number' || typeof columnStart !== 'number' || typeof rowEnd !== 'number' || typeof columnEnd !== 'number') {
    throw badBody();
  }
  return { name, row_start: rowStart, column_start: columnStart, row_end: rowEnd, column_end: columnEnd };
}

