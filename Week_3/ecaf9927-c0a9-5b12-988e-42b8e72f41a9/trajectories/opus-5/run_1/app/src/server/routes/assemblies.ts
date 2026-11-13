import type { ComponentType, PurchasedPart } from '../../shared/api.js';
import { newId } from '../auth.js';
import { pool, withTransaction, type Db } from '../db.js';
import {
  assemblyTree,
  billOfMaterials,
  loadCatalogue,
  toAssemblyResource,
  wouldCycle,
} from '../domain/assemblies.js';
import { withIdempotency } from '../domain/idempotency.js';
import { requireRevision } from '../domain/revision.js';
import { errors } from '../errors.js';
import { route, type Ctx, type Route } from '../http.js';
import { nameTaken, WORKSPACE_ID } from '../repo/workspace.js';
import { readIdempotencyKey, Reader, requireFounder } from '../validate.js';

const COMPONENT_TYPES = ['part', 'purchased', 'assembly'] as const;

type AssemblyRecord = { id: string; name: string; revision: number; saved_by: string };

async function findAssembly(db: Db, id: string): Promise<AssemblyRecord | null> {
  const { rows } = await db.query<AssemblyRecord>(
    'select id, name, revision, saved_by from assemblies where workspace_id = $1 and id = $2',
    [WORKSPACE_ID, id],
  );
  return rows[0] ?? null;
}

async function lockAssembly(db: Db, id: string): Promise<AssemblyRecord> {
  const { rows } = await db.query<AssemblyRecord>(
    'select id, name, revision, saved_by from assemblies where workspace_id = $1 and id = $2 for update',
    [WORKSPACE_ID, id],
  );
  return rows[0] as AssemblyRecord;
}

async function requireAssembly(id: string): Promise<AssemblyRecord> {
  const assembly = await findAssembly(pool, id);
  if (!assembly) throw errors.notFound();
  return assembly;
}

async function assemblyResource(id: string) {
  return toAssemblyResource(await loadCatalogue(pool), id);
}

async function findPurchased(db: Db, id: string): Promise<(PurchasedPart & { saved_by: string }) | null> {
  const { rows } = await db.query<PurchasedPart & { saved_by: string }>(
    'select id, name, declared_mass_g, revision, saved_by from purchased_parts where workspace_id = $1 and id = $2',
    [WORKSPACE_ID, id],
  );
  return rows[0] ?? null;
}

async function lockPurchased(db: Db, id: string): Promise<PurchasedPart & { saved_by: string }> {
  const { rows } = await db.query<PurchasedPart & { saved_by: string }>(
    `select id, name, declared_mass_g, revision, saved_by from purchased_parts
      where workspace_id = $1 and id = $2 for update`,
    [WORKSPACE_ID, id],
  );
  return rows[0] as PurchasedPart & { saved_by: string };
}

async function addInstance(ctx: Ctx, db: Db, assemblyId: string): Promise<string> {
  const assembly = await lockAssembly(db, assemblyId);
  const reader = new Reader(ctx.member.units);
  const base = reader.baseRevision(ctx.body.base_revision);
  if (!Number.isNaN(base)) await requireRevision(db, base, assembly, assembly.name);

  const source = (typeof ctx.body.component === 'object' && ctx.body.component !== null
    ? ctx.body.component
    : {}) as Record<string, unknown>;
  const type = reader.choice<ComponentType>(source.type, COMPONENT_TYPES, 'component');
  const componentId = typeof source.id === 'string' ? source.id : '';
  const quantity = reader.quantity(ctx.body.quantity);
  const catalogue = await loadCatalogue(db);
  const exists =
    type === 'part'
      ? catalogue.parts.has(componentId)
      : type === 'purchased'
        ? catalogue.purchased.has(componentId)
        : catalogue.assemblies.has(componentId);
  if (!exists) reader.componentFailed();
  reader.done();

  if (wouldCycle(catalogue, assembly.id, type, componentId)) throw errors.assemblyCycle(assembly.name);
  if (type === 'part') {
    const part = catalogue.parts.get(componentId) as { name: string; massG: number | null };
    if (part.massG === null) throw errors.noConfirmedBody(part.name);
  }

  const id = newId();
  await db.query(
    `insert into instances (id, assembly_id, component_type, component_id, quantity)
     values ($1, $2, $3, $4, $5)`,
    [id, assembly.id, type, componentId, quantity],
  );
  await db.query('update assemblies set revision = revision + 1, saved_by = $2 where id = $1', [
    assembly.id,
    ctx.member.id,
  ]);
  return id;
}

export const assemblyRoutes: Route[] = [
  route('GET', '/api/assemblies', async () => {
    const catalogue = await loadCatalogue(pool);
    const assemblies = [...catalogue.assemblies.keys()]
      .map((id) => toAssemblyResource(catalogue, id))
      .sort((left, right) => left.name.localeCompare(right.name));
    return { status: 200, json: { assemblies } };
  }),

  route('POST', '/api/assemblies', async (ctx) => {
    requireFounder(ctx.member);
    const reader = new Reader(ctx.member.units);
    const name = reader.name(ctx.body.name);
    if (name !== '' && (await nameTaken(pool, name, null))) reader.nameTaken();
    reader.done();
    const id = newId();
    await pool.query(
      'insert into assemblies (id, workspace_id, name, saved_by) values ($1, $2, $3, $4)',
      [id, WORKSPACE_ID, name, ctx.member.id],
    );
    return { status: 201, json: { assembly: await assemblyResource(id) } };
  }),

  route('GET', '/api/assemblies/:id', async (ctx) => {
    const assembly = await requireAssembly(ctx.params.id as string);
    return { status: 200, json: { assembly: await assemblyResource(assembly.id) } };
  }),

  route('POST', '/api/assemblies/:id/instances', async (ctx) => {
    const assembly = await requireAssembly(ctx.params.id as string);
    requireFounder(ctx.member);
    const key = readIdempotencyKey(ctx.header('idempotency-key'));
    const outcome = await withIdempotency(ctx.member.id, ctx.path, key, ctx.body, async () => {
      const instanceId = await withTransaction((db) => addInstance(ctx, db, assembly.id));
      const resource = await assemblyResource(assembly.id);
      return {
        status: 201,
        response: {
          assembly: resource,
          instance: resource.instances.find((candidate) => candidate.id === instanceId),
        },
      };
    });
    return {
      status: outcome.status,
      json: outcome.response,
      headers: outcome.replayed ? { 'idempotent-replayed': 'true' } : ({} as Record<string, string>),
    };
  }),

  route('PATCH', '/api/assemblies/:id/instances/:iid', async (ctx) => {
    const assembly = await requireAssembly(ctx.params.id as string);
    requireFounder(ctx.member);
    await withTransaction(async (db) => {
      const locked = await lockAssembly(db, assembly.id);
      const { rows } = await db.query<{ id: string }>(
        'select id from instances where assembly_id = $1 and id = $2',
        [assembly.id, ctx.params.iid],
      );
      if (rows.length === 0) throw errors.notFound();
      const reader = new Reader(ctx.member.units);
      const base = reader.baseRevision(ctx.body.base_revision);
      if (!Number.isNaN(base)) await requireRevision(db, base, locked, locked.name);
      const quantity = reader.quantity(ctx.body.quantity);
      reader.done();
      await db.query('update instances set quantity = $2 where id = $1', [ctx.params.iid, quantity]);
      await db.query('update assemblies set revision = revision + 1, saved_by = $2 where id = $1', [
        assembly.id,
        ctx.member.id,
      ]);
    });
    return { status: 200, json: { assembly: await assemblyResource(assembly.id) } };
  }),

  route('DELETE', '/api/assemblies/:id/instances/:iid', async (ctx) => {
    const assembly = await requireAssembly(ctx.params.id as string);
    requireFounder(ctx.member);
    await withTransaction(async (db) => {
      const locked = await lockAssembly(db, assembly.id);
      const { rows } = await db.query<{ id: string }>(
        'select id from instances where assembly_id = $1 and id = $2',
        [assembly.id, ctx.params.iid],
      );
      if (rows.length === 0) throw errors.notFound();
      const reader = new Reader(ctx.member.units);
      const base = reader.baseRevision(Number(ctx.query.get('base_revision')));
      if (!Number.isNaN(base)) await requireRevision(db, base, locked, locked.name);
      reader.done();
      await db.query('delete from instances where id = $1', [ctx.params.iid]);
      await db.query('update assemblies set revision = revision + 1, saved_by = $2 where id = $1', [
        assembly.id,
        ctx.member.id,
      ]);
    });
    return { status: 200, json: { assembly: await assemblyResource(assembly.id) } };
  }),

  route('GET', '/api/assemblies/:id/tree', async (ctx) => {
    const assembly = await requireAssembly(ctx.params.id as string);
    const catalogue = await loadCatalogue(pool);
    return {
      status: 200,
      json: {
        assembly: { id: assembly.id, name: assembly.name },
        rows: assemblyTree(catalogue, assembly.id),
      },
    };
  }),

  route('GET', '/api/assemblies/:id/bom', async (ctx) => {
    const assembly = await requireAssembly(ctx.params.id as string);
    return { status: 200, json: billOfMaterials(await loadCatalogue(pool), assembly.id) };
  }),

  route('GET', '/api/purchased', async () => {
    const { rows } = await pool.query<PurchasedPart>(
      'select id, name, declared_mass_g, revision from purchased_parts where workspace_id = $1 order by name',
      [WORKSPACE_ID],
    );
    return { status: 200, json: { purchased: rows } };
  }),

  route('POST', '/api/purchased', async (ctx) => {
    requireFounder(ctx.member);
    const reader = new Reader(ctx.member.units);
    const name = reader.name(ctx.body.name);
    const mass = reader.declaredMass(ctx.body.declared_mass_g);
    if (name !== '' && (await nameTaken(pool, name, null))) reader.nameTaken();
    reader.done();
    const id = newId();
    await pool.query(
      `insert into purchased_parts (id, workspace_id, name, declared_mass_g, saved_by)
       values ($1, $2, $3, $4, $5)`,
      [id, WORKSPACE_ID, name, mass, ctx.member.id],
    );
    const record = (await findPurchased(pool, id)) as PurchasedPart;
    return {
      status: 201,
      json: {
        purchased: {
          id: record.id,
          name: record.name,
          declared_mass_g: record.declared_mass_g,
          revision: record.revision,
        },
      },
    };
  }),

  route('PATCH', '/api/purchased/:id', async (ctx) => {
    const existing = await findPurchased(pool, ctx.params.id as string);
    if (!existing) throw errors.notFound();
    requireFounder(ctx.member);
    await withTransaction(async (db) => {
      const locked = await lockPurchased(db, existing.id);
      const reader = new Reader(ctx.member.units);
      const base = reader.baseRevision(ctx.body.base_revision);
      if (!Number.isNaN(base)) await requireRevision(db, base, locked, locked.name);
      const name = ctx.body.name === undefined ? locked.name : reader.name(ctx.body.name);
      const mass =
        ctx.body.declared_mass_g === undefined
          ? locked.declared_mass_g
          : reader.declaredMass(ctx.body.declared_mass_g);
      if (name !== locked.name && name !== '' && (await nameTaken(db, name, locked.id))) {
        reader.nameTaken();
      }
      reader.done();
      await db.query(
        `update purchased_parts
            set name = $2, declared_mass_g = $3, revision = revision + 1, saved_by = $4
          where id = $1`,
        [locked.id, name, mass, ctx.member.id],
      );
    });
    const record = (await findPurchased(pool, existing.id)) as PurchasedPart;
    return {
      status: 200,
      json: {
        purchased: {
          id: record.id,
          name: record.name,
          declared_mass_g: record.declared_mass_g,
          revision: record.revision,
        },
      },
    };
  }),
];
