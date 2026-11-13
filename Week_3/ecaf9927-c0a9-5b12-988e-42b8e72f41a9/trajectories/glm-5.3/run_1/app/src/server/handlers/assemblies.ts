import type { PoolClient } from "pg";
import type { Member, PurchasedPart } from "../../shared/types.js";
import {
  assemblyCycle,
  invalidFields,
  noConfirmedBody,
  notFound
} from "../errors.js";
import { newId } from "../sketchService.js";
import { bomOf, loadAssemblyContext, rollupOf, treeOf, wouldCycle } from "../assemblyService.js";
import {
  baseRevisionField,
  checkRevision,
  idempotentReplay,
  idempotencyKeyOf,
  requireFounder,
  respondJson,
  safeRollback,
  storeIdempotent
} from "../handlersCommon.js";
import type { ServerResponse } from "node:http";

/** Assembly, instance and purchased part endpoints. */

interface AssemblyRow {
  id: string;
  name: string;
  revision: number;
  last_saved_by: string | null;
}

type AssemblyContext = Awaited<ReturnType<typeof loadAssemblyContext>>;

export async function handleListAssemblies(client: PoolClient, res: ServerResponse): Promise<void> {
  const rows = (await client.query<AssemblyRow>("SELECT id, name, revision, last_saved_by FROM assemblies ORDER BY name")).rows;
  const context = await loadAssemblyContext(client);
  const assemblies = rows.map((row) => ({
    id: row.id,
    name: row.name,
    revision: row.revision,
    instances: (context.instances.get(row.id) ?? []).map((inst) => ({
      id: inst.id,
      component: componentShape(context, inst.component_type, inst.component_id),
      quantity: inst.quantity
    })),
    rollup: rollupOf(context, row.id)
  }));
  respondJson(res, 200, { assemblies });
}

function componentShape(
  context: AssemblyContext,
  type: string,
  id: string
): { type: "part" | "purchased" | "assembly"; id: string; name: string } {
  if (type === "part") return { type: "part", id, name: context.parts.get(id)?.name ?? "" };
  if (type === "purchased") return { type: "purchased", id, name: context.purchased.get(id)?.name ?? "" };
  return { type: "assembly", id, name: context.assemblies.get(id)?.name ?? "" };
}

export async function handleCreateAssembly(
  client: PoolClient,
  body: Record<string, unknown>,
  member: Member,
  res: ServerResponse
): Promise<void> {
  requireFounder(member);
  const name = typeof body.name === "string" ? body.name : "";
  if (name.trim().length === 0 || name.length > 80) {
    throw invalidFields({ name: "Enter a name of 1 to 80 characters." });
  }
  const used = await Promise.all([
    client.query("SELECT 1 FROM parts WHERE lower(name) = lower($1)", [name.trim()]),
    client.query("SELECT 1 FROM purchased_parts WHERE lower(name) = lower($1)", [name.trim()]),
    client.query("SELECT 1 FROM assemblies WHERE lower(name) = lower($1)", [name.trim()])
  ]);
  if (used.some((r) => (r.rowCount ?? 0) > 0)) throw invalidFields({ name: "That name is already used." });
  const id = newId();
  await client.query(
    "INSERT INTO assemblies (id, name, revision, is_product, last_saved_by) VALUES ($1, $2, 1, FALSE, $3)",
    [id, name.trim(), member.id]
  );
  const context = await loadAssemblyContext(client);
  respondJson(res, 201, {
    assembly: {
      id,
      name: name.trim(),
      revision: 1,
      instances: [],
      rollup: rollupOf(context, id)
    }
  });
}

export async function handleGetAssembly(client: PoolClient, id: string, res: ServerResponse): Promise<void> {
  const row = (
    await client.query<AssemblyRow>("SELECT id, name, revision, last_saved_by FROM assemblies WHERE id = $1", [id])
  ).rows[0];
  if (!row) throw notFound();
  const context = await loadAssemblyContext(client);
  respondJson(res, 200, {
    assembly: {
      id: row.id,
      name: row.name,
      revision: row.revision,
      instances: (context.instances.get(id) ?? []).map((inst) => ({
        id: inst.id,
        component: componentShape(context, inst.component_type, inst.component_id),
        quantity: inst.quantity
      })),
      rollup: rollupOf(context, id)
    }
  });
}

export async function handlePostInstance(
  client: PoolClient,
  assemblyId: string,
  body: Record<string, unknown>,
  member: Member,
  req: import("node:http").IncomingMessage,
  res: ServerResponse
): Promise<void> {
  requireFounder(member);
  const key = idempotencyKeyOf(req);
  if (!key) throw invalidFields({ idempotency_key: "Send an Idempotency-Key header of 1 to 100 visible characters." });
  const endpoint = `/api/assemblies/${assemblyId}/instances`;
  await client.query("BEGIN");
  try {
    const replay = await idempotentReplay(client, member, endpoint, key, body);
    if (replay) {
      await client.query("COMMIT");
      respondJson(res, replay.status, replay.body, { "Idempotent-Replayed": "true" });
      return;
    }
    const assembly = (
      await client.query<AssemblyRow>(
        "SELECT id, name, revision, last_saved_by FROM assemblies WHERE id = $1 FOR UPDATE",
        [assemblyId]
      )
    ).rows[0];
    if (!assembly) throw notFound();
    const base = baseRevisionField(body);
    await checkRevision(client, "assemblies", assemblyId, base, assembly.name, member);
    const component = body.component as Record<string, unknown> | undefined;
    const quantity = body.quantity;
    const fields: Record<string, string> = {};
    const type = component?.type;
    if (type !== "part" && type !== "purchased" && type !== "assembly") {
      fields.component = "Choose one of the listed components.";
    }
    const componentId = typeof component?.id === "string" ? component.id : "";
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      fields.quantity = "Enter a whole number from 1 to 999.";
    }
    if (Object.keys(fields).length > 0) throw invalidFields(fields);
    const context = await loadAssemblyContext(client);
    if (type === "part") {
      const part = context.parts.get(componentId);
      if (!part) throw invalidFields({ component: "Choose one of the listed components." });
      if (part.mass === null) throw noConfirmedBody(part.name);
    } else if (type === "purchased") {
      if (!context.purchased.has(componentId)) {
        throw invalidFields({ component: "Choose one of the listed components." });
      }
    } else {
      if (!context.assemblies.has(componentId)) {
        throw invalidFields({ component: "Choose one of the listed components." });
      }
      const cycle = await wouldCycleLocal(client, assemblyId, componentId);
      if (cycle) throw assemblyCycle(assembly.name);
    }
    const componentType = type as "part" | "purchased" | "assembly";
    const instanceId = newId();
    const position = (context.instances.get(assemblyId)?.length ?? 0) + 1;
    await client.query(
      `INSERT INTO instances (id, assembly_id, component_type, component_id, quantity, position)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [instanceId, assemblyId, componentType, componentId, quantity as number, position]
    );
    await client.query("UPDATE assemblies SET revision = revision + 1, last_saved_by = $1 WHERE id = $2", [
      member.id,
      assemblyId
    ]);
    const refreshedContext = await loadAssemblyContext(client);
    const responseBody = {
      assembly: {
        id: assemblyId,
        name: assembly.name,
        revision: assembly.revision + 1,
        instances: (refreshedContext.instances.get(assemblyId) ?? []).map((inst) => ({
          id: inst.id,
          component: componentShape(refreshedContext, inst.component_type, inst.component_id),
          quantity: inst.quantity
        })),
        rollup: rollupOf(refreshedContext, assemblyId)
      },
      instance: {
        id: instanceId,
        component: componentShape(refreshedContext, componentType, componentId),
        quantity
      }
    };
    await storeIdempotent(client, member, endpoint, key, body, { status: 201, body: responseBody });
    await client.query("COMMIT");
    respondJson(res, 201, responseBody);
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

async function wouldCycleLocal(client: PoolClient, containerId: string, candidateId: string): Promise<boolean> {
  const context = await loadAssemblyContext(client);
  return wouldCycle(context, containerId, candidateId);
}

export async function handlePatchInstance(
  client: PoolClient,
  assemblyId: string,
  instanceId: string,
  body: Record<string, unknown>,
  member: Member,
  res: ServerResponse
): Promise<void> {
  requireFounder(member);
  await client.query("BEGIN");
  try {
    const assembly = (
      await client.query<AssemblyRow>(
        "SELECT id, name, revision, last_saved_by FROM assemblies WHERE id = $1 FOR UPDATE",
        [assemblyId]
      )
    ).rows[0];
    if (!assembly) throw notFound();
    const instance = (
      await client.query<{ id: string }>("SELECT id FROM instances WHERE id = $1 AND assembly_id = $2", [
        instanceId,
        assemblyId
      ])
    ).rows[0];
    if (!instance) throw notFound();
    const base = baseRevisionField(body);
    await checkRevision(client, "assemblies", assemblyId, base, assembly.name, member);
    const quantity = body.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw invalidFields({ quantity: "Enter a whole number from 1 to 999." });
    }
    await client.query("UPDATE instances SET quantity = $1 WHERE id = $2", [quantity, instanceId]);
    await client.query("UPDATE assemblies SET revision = revision + 1, last_saved_by = $1 WHERE id = $2", [
      member.id,
      assemblyId
    ]);
    const context = await loadAssemblyContext(client);
    await client.query("COMMIT");
    respondJson(res, 200, {
      assembly: {
        id: assemblyId,
        name: assembly.name,
        revision: assembly.revision + 1,
        instances: (context.instances.get(assemblyId) ?? []).map((inst) => ({
          id: inst.id,
          component: componentShape(context, inst.component_type, inst.component_id),
          quantity: inst.quantity
        })),
        rollup: rollupOf(context, assemblyId)
      }
    });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

export async function handleDeleteInstance(
  client: PoolClient,
  assemblyId: string,
  instanceId: string,
  query: URLSearchParams,
  member: Member,
  res: ServerResponse
): Promise<void> {
  requireFounder(member);
  await client.query("BEGIN");
  try {
    const assembly = (
      await client.query<AssemblyRow>(
        "SELECT id, name, revision, last_saved_by FROM assemblies WHERE id = $1 FOR UPDATE",
        [assemblyId]
      )
    ).rows[0];
    if (!assembly) throw notFound();
    const instance = (
      await client.query<{ id: string }>("SELECT id FROM instances WHERE id = $1 AND assembly_id = $2", [
        instanceId,
        assemblyId
      ])
    ).rows[0];
    if (!instance) throw notFound();
    const base = Number(query.get("base_revision"));
    if (!Number.isInteger(base)) throw invalidFields({ base_revision: "Send the revision you started from." });
    await checkRevision(client, "assemblies", assemblyId, base, assembly.name, member);
    await client.query("DELETE FROM instances WHERE id = $1", [instanceId]);
    await client.query("UPDATE assemblies SET revision = revision + 1, last_saved_by = $1 WHERE id = $2", [
      member.id,
      assemblyId
    ]);
    const context = await loadAssemblyContext(client);
    await client.query("COMMIT");
    respondJson(res, 200, {
      assembly: {
        id: assemblyId,
        name: assembly.name,
        revision: assembly.revision + 1,
        instances: (context.instances.get(assemblyId) ?? []).map((inst) => ({
          id: inst.id,
          component: componentShape(context, inst.component_type, inst.component_id),
          quantity: inst.quantity
        })),
        rollup: rollupOf(context, assemblyId)
      }
    });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

export async function handleGetTree(client: PoolClient, id: string, res: ServerResponse): Promise<void> {
  const row = (await client.query<{ id: string; name: string }>("SELECT id, name FROM assemblies WHERE id = $1", [id])).rows[0];
  if (!row) throw notFound();
  const context = await loadAssemblyContext(client);
  respondJson(res, 200, {
    assembly: { id: row.id, name: row.name },
    rows: treeOf(context, id)
  });
}

export async function handleGetBom(client: PoolClient, id: string, res: ServerResponse): Promise<void> {
  const row = (await client.query<{ id: string }>("SELECT id FROM assemblies WHERE id = $1", [id])).rows[0];
  if (!row) throw notFound();
  const context = await loadAssemblyContext(client);
  respondJson(res, 200, bomOf(context, id));
}

// ---- Purchased parts ----

export async function handleListPurchased(client: PoolClient, res: ServerResponse): Promise<void> {
  const rows = (
    await client.query<{ id: string; name: string; declared_mass_g: number; revision: number }>(
      "SELECT id, name, declared_mass_g, revision FROM purchased_parts ORDER BY name"
    )
  ).rows;
  respondJson(res, 200, { purchased: rows });
}

export async function handleCreatePurchased(
  client: PoolClient,
  body: Record<string, unknown>,
  member: Member,
  res: ServerResponse
): Promise<void> {
  requireFounder(member);
  const name = typeof body.name === "string" ? body.name : "";
  const fields: Record<string, string> = {};
  if (name.trim().length === 0 || name.length > 80) fields.name = "Enter a name of 1 to 80 characters.";
  const massValue = body.declared_mass_g;
  const mass = typeof massValue === "number" && Number.isFinite(massValue) && massValue > 0 && massValue <= 100000
    ? massValue
    : null;
  if (mass === null) {
    fields.declared_mass_g = "Enter a mass greater than 0 and at most 100000 g.";
    throw invalidFields(fields);
  }
  if (Object.keys(fields).length > 0) throw invalidFields(fields);
  const used = await Promise.all([
    client.query("SELECT 1 FROM parts WHERE lower(name) = lower($1)", [name.trim()]),
    client.query("SELECT 1 FROM purchased_parts WHERE lower(name) = lower($1)", [name.trim()]),
    client.query("SELECT 1 FROM assemblies WHERE lower(name) = lower($1)", [name.trim()])
  ]);
  if (used.some((r) => (r.rowCount ?? 0) > 0)) throw invalidFields({ name: "That name is already used." });
  const id = newId();
  await client.query(
    "INSERT INTO purchased_parts (id, name, declared_mass_g, revision, last_saved_by) VALUES ($1, $2, $3, 1, $4)",
    [id, name.trim(), mass, member.id]
  );
  respondJson(res, 201, {
    purchased: { id, name: name.trim(), declared_mass_g: mass, revision: 1 } satisfies PurchasedPart
  });
}

export async function handlePatchPurchased(
  client: PoolClient,
  id: string,
  body: Record<string, unknown>,
  member: Member,
  res: ServerResponse
): Promise<void> {
  requireFounder(member);
  await client.query("BEGIN");
  try {
    const row = (
      await client.query<{ id: string; name: string; declared_mass_g: number; revision: number; last_saved_by: string | null }>(
        "SELECT id, name, declared_mass_g, revision, last_saved_by FROM purchased_parts WHERE id = $1 FOR UPDATE",
        [id]
      )
    ).rows[0];
    if (!row) throw notFound();
    const base = baseRevisionField(body);
    await checkRevision(client, "purchased_parts", id, base, row.name, member);
    const fields: Record<string, string> = {};
    let name = row.name;
    if (body.name !== undefined) {
      const candidate = typeof body.name === "string" ? body.name : "";
      if (candidate.trim().length === 0 || candidate.length > 80) fields.name = "Enter a name of 1 to 80 characters.";
      else name = candidate.trim();
    }
    let mass = row.declared_mass_g;
    if (body.declared_mass_g !== undefined) {
      const candidate = body.declared_mass_g;
      if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0 || candidate > 100000) {
        fields.declared_mass_g = "Enter a mass greater than 0 and at most 100000 g.";
      } else {
        mass = candidate;
      }
    }
    if (Object.keys(fields).length > 0) throw invalidFields(fields);
    await client.query(
      "UPDATE purchased_parts SET name = $1, declared_mass_g = $2, revision = revision + 1, last_saved_by = $3 WHERE id = $4",
      [name, mass, member.id, id]
    );
    await client.query("COMMIT");
    respondJson(res, 200, {
      purchased: { id, name, declared_mass_g: mass, revision: row.revision + 1 } satisfies PurchasedPart
    });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}
