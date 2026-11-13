import { randomUUID } from 'node:crypto';
import type { Assembly, ComponentType, PurchasedPart } from '../shared/api';
import { INSTANCE_LOCK, pool, transaction, type Db, type Queryable } from './db';
import { assemblyCycle, noConfirmedBody, notFound } from './errors';
import { FIELD_MESSAGES } from '../shared/messages';
import { assemblyJson, loadCatalog, wouldContainItself } from './catalog';
import { once, requireKey, type Idempotent } from './idempotency';
import { claimName, releaseName } from './names';
import { requireFounder } from './parts';
import { type MemberRow } from './repo';
import { Validator, objectBody, parseName, requireCurrentRevision } from './validate';
import { FieldProblem } from '../shared/lengths';

interface AssemblyDb { id: string; name: string; revision: number; saved_by: string }
interface PurchasedDb { id: string; name: string; declared_mass_g: number; revision: number; saved_by: string }
interface InstanceDb { id: string; assembly_id: string; quantity: number }

const COMPONENT_TYPES: readonly ComponentType[] = ['part', 'purchased', 'assembly'];

async function assemblyRow(q: Queryable, id: string, lock = false): Promise<AssemblyDb> {
  const { rows } = await q.query<AssemblyDb>(`SELECT * FROM assemblies WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

export async function getAssembly(id: string): Promise<Assembly> {
  await assemblyRow(pool, id);
  return assemblyJson(await loadCatalog(pool), id);
}

export async function listAssemblies(): Promise<Assembly[]> {
  const catalog = await loadCatalog(pool);
  return [...catalog.assemblies.keys()].map((id) => assemblyJson(catalog, id)).sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
}

export async function createAssembly(member: MemberRow, input: unknown): Promise<Assembly> {
  requireFounder(member);
  const body = objectBody(input);
  const id = randomUUID();
  return transaction(async (db) => {
    const v = new Validator();
    const name = v.take('name', () => parseName(body['name']));
    if (name) await claimName(db, v, name, 'name', id);
    v.done();
    await db.query('INSERT INTO assemblies (id, name, saved_by) VALUES ($1, $2, $3)', [id, name, member.id]);
    return assemblyJson(await loadCatalog(db), id);
  });
}

function parseQuantity(input: unknown): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1 || input > 999) throw new FieldProblem(FIELD_MESSAGES.quantity);
  return input;
}

export async function addInstance(member: MemberRow, assemblyId: string, key: string | undefined, input: unknown): Promise<Idempotent> {
  await assemblyRow(pool, assemblyId);
  requireFounder(member);
  const body = objectBody(input);
  return once(member.id, `/api/assemblies/${assemblyId}/instances`, key, input, async (db) => {
    const assembly = await assemblyRow(db, assemblyId, true);
    const v = new Validator();
    await requireCurrentRevision(db, v, body['base_revision'], { revision: assembly.revision, savedBy: assembly.saved_by }, assembly.name);
    requireKey(v, key);
    const quantity = v.take('quantity', () => parseQuantity(body['quantity']));
    await db.query('SELECT pg_advisory_xact_lock($1)', [INSTANCE_LOCK]);
    const catalog = await loadCatalog(db);
    const wanted = objectBody(body['component']);
    const type = COMPONENT_TYPES.find((t) => t === wanted['type']);
    const registry = type === 'part' ? catalog.parts : type === 'purchased' ? catalog.purchased : catalog.assemblies;
    const id = typeof wanted['id'] === 'string' && registry.has(wanted['id']) ? wanted['id'] : undefined;
    if (!type || !id) v.fail('component', FIELD_MESSAGES.component);
    v.done();
    if (type === 'assembly' && wouldContainItself(catalog, assemblyId, id as string)) throw assemblyCycle(assembly.name);
    const part = type === 'part' ? catalog.parts.get(id as string) : undefined;
    if (part && part.massG === null) throw noConfirmedBody(part.name);
    const instanceId = randomUUID();
    await db.query('INSERT INTO instances (id, assembly_id, component_type, component_id, quantity) VALUES ($1, $2, $3, $4, $5)', [
      instanceId,
      assemblyId,
      type,
      id,
      quantity,
    ]);
    await db.query('UPDATE assemblies SET revision = revision + 1, saved_by = $2 WHERE id = $1', [assemblyId, member.id]);
    const after = await loadCatalog(db);
    const json = assemblyJson(after, assemblyId);
    return { outcome: { status: 201, body: { assembly: json, instance: json.instances.find((i) => i.id === instanceId) } } };
  });
}

async function changeInstances(
  member: MemberRow,
  assemblyId: string,
  instanceId: string,
  baseInput: unknown,
  change: (db: Db, v: Validator) => Promise<void>,
): Promise<Assembly> {
  await assemblyRow(pool, assemblyId);
  const { rows } = await pool.query<InstanceDb>('SELECT id, assembly_id, quantity FROM instances WHERE id = $1 AND assembly_id = $2', [instanceId, assemblyId]);
  if (!rows[0]) throw notFound();
  requireFounder(member);
  return transaction(async (db) => {
    const assembly = await assemblyRow(db, assemblyId, true);
    const v = new Validator();
    await requireCurrentRevision(db, v, baseInput, { revision: assembly.revision, savedBy: assembly.saved_by }, assembly.name);
    await change(db, v);
    v.done();
    await db.query('UPDATE assemblies SET revision = revision + 1, saved_by = $2 WHERE id = $1', [assemblyId, member.id]);
    return assemblyJson(await loadCatalog(db), assemblyId);
  });
}

export async function setQuantity(member: MemberRow, assemblyId: string, instanceId: string, input: unknown): Promise<Assembly> {
  const body = objectBody(input);
  return changeInstances(member, assemblyId, instanceId, body['base_revision'], async (db, v) => {
    const quantity = v.take('quantity', () => parseQuantity(body['quantity']));
    v.done();
    await db.query('UPDATE instances SET quantity = $2 WHERE id = $1', [instanceId, quantity]);
  });
}

export async function removeInstance(member: MemberRow, assemblyId: string, instanceId: string, base: unknown): Promise<Assembly> {
  return changeInstances(member, assemblyId, instanceId, base, async (db) => {
    await db.query('DELETE FROM instances WHERE id = $1', [instanceId]);
  });
}

const purchasedJson = (r: PurchasedDb): PurchasedPart => ({ id: r.id, name: r.name, declared_mass_g: r.declared_mass_g, revision: r.revision });

export async function listPurchased(): Promise<PurchasedPart[]> {
  const { rows } = await pool.query<PurchasedDb>('SELECT * FROM purchased_parts ORDER BY lower(name)');
  return rows.map(purchasedJson);
}

function parseMass(input: unknown): number {
  const grams = typeof input === 'number' ? input : NaN;
  if (!(grams > 0 && grams <= 100000)) throw new FieldProblem(FIELD_MESSAGES.declaredMass);
  return grams;
}

export async function createPurchased(member: MemberRow, input: unknown): Promise<PurchasedPart> {
  requireFounder(member);
  const body = objectBody(input);
  const id = randomUUID();
  return transaction(async (db) => {
    const v = new Validator();
    const name = v.take('name', () => parseName(body['name']));
    const mass = v.take('declared_mass_g', () => parseMass(body['declared_mass_g']));
    if (name) await claimName(db, v, name, 'name', id);
    v.done();
    const { rows } = await db.query<PurchasedDb>(
      'INSERT INTO purchased_parts (id, name, declared_mass_g, saved_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, name, mass, member.id],
    );
    return purchasedJson(rows[0] as PurchasedDb);
  });
}

export async function updatePurchased(member: MemberRow, id: string, input: unknown): Promise<PurchasedPart> {
  const found = await pool.query<PurchasedDb>('SELECT * FROM purchased_parts WHERE id = $1', [id]);
  if (!found.rows[0]) throw notFound();
  requireFounder(member);
  const body = objectBody(input);
  return transaction(async (db) => {
    const { rows } = await db.query<PurchasedDb>('SELECT * FROM purchased_parts WHERE id = $1 FOR UPDATE', [id]);
    const current = rows[0] as PurchasedDb;
    const v = new Validator();
    await requireCurrentRevision(db, v, body['base_revision'], { revision: current.revision, savedBy: current.saved_by }, current.name);
    const name = 'name' in body ? v.take('name', () => parseName(body['name'])) : undefined;
    const mass = 'declared_mass_g' in body ? v.take('declared_mass_g', () => parseMass(body['declared_mass_g'])) : undefined;
    const renamed = name !== undefined && name.toLowerCase() !== current.name.toLowerCase();
    if (renamed) await claimName(db, v, name, 'name', id);
    v.done();
    if (renamed) await releaseName(db, current.name);
    const updated = await db.query<PurchasedDb>(
      'UPDATE purchased_parts SET name = COALESCE($2, name), declared_mass_g = COALESCE($3, declared_mass_g), revision = revision + 1, saved_by = $4 WHERE id = $1 RETURNING *',
      [id, name ?? null, mass ?? null, member.id],
    );
    return purchasedJson(updated.rows[0] as PurchasedDb);
  });
}
