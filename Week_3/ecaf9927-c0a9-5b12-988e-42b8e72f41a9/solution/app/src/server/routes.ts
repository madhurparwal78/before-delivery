import type { RequestContext, SignedInContext } from './http';
import { isReady } from './readiness';
import { signIn, signOut } from './auth';
import { pool } from './db';
import {
  addInstance,
  createAssembly,
  createPurchased,
  getAssembly,
  listAssemblies,
  listPurchased,
  removeInstance,
  setQuantity,
  updatePurchased,
} from './assemblies';
import { bomOf, loadCatalog, treeOf } from './catalog';
import { notFound, storageUnavailable } from './errors';
import { FIELD_MESSAGES } from '../shared/messages';
import { createFeature, updateFeature } from './features';
import { createPart, createSketch, saveOnly, updatePart } from './parts';
import { allPartIds, materials, memberById, memberJson, partJson, partRow, sketchViewJson, type MemberRow } from './repo';
import { addConstraint, addEntity, deleteConstraint, deleteEntity, updateConstraint } from './sketches';
import { getObject, storageReachable } from './storage';
import { Validator, objectBody } from './validate';

export interface Reply {
  status: number;
  body?: unknown;
  raw?: Buffer;
  headers?: Record<string, string | string[]>;
}

interface RouteBase {
  method: string;
  path: string;
  pattern: RegExp;
}

/** A route anyone may call (sign in, health), or one that needs a session and so receives the member. */
type Route =
  | (RouteBase & { public: true; handler: (ctx: RequestContext) => Promise<Reply> })
  | (RouteBase & { public: false; handler: (ctx: SignedInContext) => Promise<Reply> });

const routes: Route[] = [];

const pattern = (path: string): RegExp => new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);

function define(method: string, path: string, handler: (ctx: SignedInContext) => Promise<Reply>): void {
  routes.push({ method, path, pattern: pattern(path), public: false, handler });
}

function definePublic(method: string, path: string, handler: (ctx: RequestContext) => Promise<Reply>): void {
  routes.push({ method, path, pattern: pattern(path), public: true, handler });
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const created = (body: unknown): Reply => ({ status: 201, body });
const idempotent = (result: { replayed: boolean; outcome: { status: number; body: unknown } }): Reply => ({
  status: result.outcome.status,
  body: result.outcome.body,
  ...(result.replayed ? { headers: { 'Idempotent-Replayed': 'true' } } : {}),
});
const param = (ctx: RequestContext, name: string): string => ctx.params[name] as string;
const keyOf = (ctx: RequestContext): string | undefined => {
  const header = ctx.headers['idempotency-key'];
  return Array.isArray(header) ? header[0] : header;
};

definePublic('GET', '/api/health', async () => (isReady() ? ok({ status: 'ok' }) : { status: 503, body: { status: 'starting' } }));

definePublic('POST', '/api/session', async (ctx) => {
  const { member, cookie } = await signIn(ctx.body);
  return { status: 200, body: { member }, headers: { 'Set-Cookie': cookie } };
});
define('DELETE', '/api/session', async (ctx) => ({
  status: 204,
  headers: { 'Set-Cookie': await signOut(ctx.token) },
}));

define('GET', '/api/me', async (ctx) => ok({ member: memberJson(ctx.member) }));
define('PATCH', '/api/me', async (ctx) => {
  const body = objectBody(ctx.body);
  const v = new Validator();
  const units = body['units'];
  if ('units' in body && units !== 'mm' && units !== 'in') v.fail('units', FIELD_MESSAGES.option);
  const precision = body['precision'];
  if ('precision' in body && !(typeof precision === 'number' && Number.isInteger(precision) && precision >= 0 && precision <= 4)) {
    v.fail('precision', FIELD_MESSAGES.option);
  }
  v.done();
  await pool.query('UPDATE members SET units = COALESCE($2, units), precision = COALESCE($3, precision) WHERE id = $1', [
    ctx.member.id,
    'units' in body ? units : null,
    'precision' in body ? precision : null,
  ]);
  return ok({ member: memberJson((await memberById(pool, ctx.member.id)) as MemberRow) });
});

define('GET', '/api/workspace', async () => {
  const { rows } = await pool.query<{ name: string; assembly_id: string; assembly_name: string }>(
    'SELECT w.name, a.id AS assembly_id, a.name AS assembly_name FROM workspace w JOIN assemblies a ON a.id = w.product_assembly_id',
  );
  const members = await pool.query<{ id: string; name: string; role: 'founder' | 'engineer' }>('SELECT id, name, role FROM members ORDER BY name');
  const [workspace] = rows;
  return ok({
    name: workspace?.name,
    product: { assembly_id: workspace?.assembly_id, name: workspace?.assembly_name },
    members: members.rows,
  });
});
define('GET', '/api/materials', async () => ok({ materials: await materials(pool) }));
define('GET', '/api/status', async () => ok({ storage: (await storageReachable()) ? 'ok' : 'unreachable' }));

define('GET', '/api/parts', async () => ok({ parts: await Promise.all((await allPartIds(pool)).map((id) => partJson(pool, id))) }));
define('POST', '/api/parts', async (ctx) => created({ part: await createPart(ctx.member, ctx.body) }));
define('GET', '/api/parts/:id', async (ctx) => ok({ part: await partJson(pool, param(ctx, 'id')) }));
define('PATCH', '/api/parts/:id', async (ctx) => ok({ part: await updatePart(ctx.member, param(ctx, 'id'), ctx.body) }));
define('POST', '/api/parts/:id/save', async (ctx) => ok({ part: await saveOnly(param(ctx, 'id')) }));
define('GET', '/api/parts/:id/body', async (ctx) => {
  const { confirmed } = await partRow(pool, param(ctx, 'id'));
  if (!confirmed) throw notFound();
  const object = await getObject(confirmed.object_key);
  if (!object) throw storageUnavailable();
  return { status: 200, raw: object };
});
define('POST', '/api/parts/:id/sketches', async (ctx) => {
  const { sketch, part } = await createSketch(ctx.member, param(ctx, 'id'), ctx.body);
  return created({ sketch: await sketchViewJson(pool, sketch), part });
});
define('POST', '/api/parts/:id/features', async (ctx) =>
  idempotent(await createFeature(ctx.member, param(ctx, 'id'), keyOf(ctx), ctx.body)));
define('PATCH', '/api/parts/:id/features/:fid', async (ctx) =>
  ok(await updateFeature(ctx.member, param(ctx, 'id'), param(ctx, 'fid'), ctx.body)));

define('GET', '/api/sketches/:sid', async (ctx) => ok({ sketch: await sketchViewJson(pool, param(ctx, 'sid')) }));
define('POST', '/api/sketches/:sid/entities', async (ctx) => created(await addEntity(ctx.member, param(ctx, 'sid'), ctx.body)));
define('DELETE', '/api/sketches/:sid/entities/:eid', async (ctx) =>
  ok(await deleteEntity(ctx.member, param(ctx, 'sid'), param(ctx, 'eid'), ctx.query.get('base_revision'))));
define('POST', '/api/sketches/:sid/constraints', async (ctx) => created(await addConstraint(ctx.member, param(ctx, 'sid'), ctx.body)));
define('PATCH', '/api/sketches/:sid/constraints/:cid', async (ctx) =>
  ok(await updateConstraint(ctx.member, param(ctx, 'sid'), param(ctx, 'cid'), ctx.body)));
define('DELETE', '/api/sketches/:sid/constraints/:cid', async (ctx) =>
  ok(await deleteConstraint(ctx.member, param(ctx, 'sid'), param(ctx, 'cid'), ctx.query.get('base_revision'))));

define('GET', '/api/assemblies', async () => ok({ assemblies: await listAssemblies() }));
define('POST', '/api/assemblies', async (ctx) => created({ assembly: await createAssembly(ctx.member, ctx.body) }));
define('GET', '/api/assemblies/:id', async (ctx) => ok({ assembly: await getAssembly(param(ctx, 'id')) }));
define('POST', '/api/assemblies/:id/instances', async (ctx) =>
  idempotent(await addInstance(ctx.member, param(ctx, 'id'), keyOf(ctx), ctx.body)));
define('PATCH', '/api/assemblies/:id/instances/:iid', async (ctx) =>
  ok({ assembly: await setQuantity(ctx.member, param(ctx, 'id'), param(ctx, 'iid'), ctx.body) }));
define('DELETE', '/api/assemblies/:id/instances/:iid', async (ctx) =>
  ok({ assembly: await removeInstance(ctx.member, param(ctx, 'id'), param(ctx, 'iid'), ctx.query.get('base_revision')) }));
define('GET', '/api/assemblies/:id/tree', async (ctx) => {
  const assembly = await getAssembly(param(ctx, 'id'));
  return ok({ assembly: { id: assembly.id, name: assembly.name }, rows: treeOf(await loadCatalog(pool), assembly.id) });
});
define('GET', '/api/assemblies/:id/bom', async (ctx) => {
  const assembly = await getAssembly(param(ctx, 'id'));
  return ok(bomOf(await loadCatalog(pool), assembly.id));
});

define('GET', '/api/purchased', async () => ok({ purchased: await listPurchased() }));
define('POST', '/api/purchased', async (ctx) => created({ purchased: await createPurchased(ctx.member, ctx.body) }));
define('PATCH', '/api/purchased/:id', async (ctx) => ok({ purchased: await updatePurchased(ctx.member, param(ctx, 'id'), ctx.body) }));

export { routes };
