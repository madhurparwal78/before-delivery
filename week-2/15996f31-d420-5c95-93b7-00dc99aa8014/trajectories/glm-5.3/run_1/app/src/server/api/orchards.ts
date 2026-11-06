import type { Response } from "express";
import { rows, one } from "../db.ts";
import { ApiError } from "../errors.ts";
import { newId } from "../seed.ts";
import type { OrderContext, OrchardRow, GrowerRow } from "../store.ts";
import type { RuleSet } from "../domain/model.ts";
import { loadVisibleOrderContexts } from "./visibility.ts";
import type { AppServices, TypedRequest } from "../context.ts";
import { bodyOf, requireSession } from "../context.ts";
import { ORDER_LABELS, type OrderStatus } from "../domain/states.ts";

export async function listGrowers(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "broker") throw ApiError.notFound();
  const growers = await rows<GrowerRow>(services.pool, "SELECT id, name, contact_name, email FROM growers ORDER BY name");
  res.status(200).json(growers);
}

export async function listRuleSets(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "broker") throw ApiError.notFound();
  const ruleSets = await rows<RuleSet>(services.pool, "SELECT * FROM rule_sets ORDER BY effective_from");
  res.status(200).json(ruleSets.map((ruleSet) => ({
    id: ruleSet.id,
    name: ruleSet.name,
    effective_from: ruleSet.effective_from,
    thresholds: { reduced: ruleSet.threshold_reduced / 10, standard: ruleSet.threshold_standard / 10, bonus: ruleSet.threshold_bonus / 10 },
    price_per_hive_cents: {
      none: ruleSet.price_none_cents,
      reduced: ruleSet.price_reduced_cents,
      standard: ruleSet.price_standard_cents,
      bonus: ruleSet.price_bonus_cents,
    },
    commission_bps: ruleSet.commission_bps,
    deposit_per_hive_cents: ruleSet.deposit_per_hive_cents,
  })));
}

interface NewBlock {
  name: string;
  acres: number;
}

/** POST /api/orchards — broker creates an orchard with its named blocks. */
export async function createOrchard(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "broker") throw ApiError.notFound();
  const body = bodyOf(req);
  const fields: Record<string, string> = {};

  const growerId = typeof body.grower_id === "string" ? body.grower_id : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const county = typeof body.county === "string" ? body.county.trim() : "";
  const blocksInput = Array.isArray(body.blocks) ? body.blocks : [];
  if (!growerId) fields.grower_id = "Choose a grower";
  if (name.length < 1 || name.length > 80) fields.name = "Orchard name must be 1 to 80 characters";
  if (county.length < 1 || county.length > 40) fields.county = "County must be 1 to 40 characters";
  if (blocksInput.length < 1 || blocksInput.length > 12) {
    fields.blocks = "An orchard needs 1 to 12 blocks";
  }

  const parsedBlocks: NewBlock[] = [];
  const seenNames = new Set<string>();
  blocksInput.forEach((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      fields[`blocks.${index}.name`] = "Block names must be 1 to 30 characters and unique in the orchard";
      fields[`blocks.${index}.acres`] = "Acres must be between 1 and 500 with at most one decimal";
      return;
    }
    const block = raw as Record<string, unknown>;
    const blockName = typeof block.name === "string" ? block.name.trim() : "";
    const acres = typeof block.acres === "number" ? block.acres : Number.NaN;
    if (blockName.length < 1 || blockName.length > 30 || seenNames.has(blockName)) {
      fields[`blocks.${index}.name`] = "Block names must be 1 to 30 characters and unique in the orchard";
    } else {
      seenNames.add(blockName);
    }
    if (!Number.isFinite(acres) || acres < 1 || acres > 500 || Math.round(acres * 10) !== acres * 10) {
      fields[`blocks.${index}.acres`] = "Acres must be between 1 and 500 with at most one decimal";
    }
    parsedBlocks.push({ name: blockName, acres });
  });

  if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

  const grower = await one<GrowerRow>(services.pool, "SELECT * FROM growers WHERE id = $1", [growerId]);
  if (!grower) throw ApiError.validation({ grower_id: "Choose a grower" });

  const orchardId = newId("orc");
  const client = await services.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO orchards (id, grower_id, name, county) VALUES ($1,$2,$3,$4)", [
      orchardId, growerId, name, county,
    ]);
    let position = 1;
    for (const block of parsedBlocks) {
      await client.query("INSERT INTO blocks (id, orchard_id, name, acres, position) VALUES ($1,$2,$3,$4,$5)", [
        newId("blk"), orchardId, block.name, block.acres.toFixed(1), position,
      ]);
      position += 1;
    }
    await client.query("INSERT INTO audit_log (entity, entity_id, action, actor) VALUES ($1,$2,$3,$4)", [
      "orchard", orchardId, "created", actor.id,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const orchard = await one<OrchardRow>(services.pool, "SELECT * FROM orchards WHERE id = $1", [orchardId]);
  const blocks = await rows<{ id: string; name: string; acres: string }>(
    services.pool, "SELECT id, name, acres FROM blocks WHERE orchard_id = $1 ORDER BY position", [orchardId],
  );
  res.status(201).json({
    id: orchardId,
    name: orchard?.name ?? name,
    county: orchard?.county ?? county,
    blocks: blocks.map((b) => ({ id: b.id, name: b.name, acres: Number(b.acres) })),
  });
}

/** GET /api/orchards — the orchards the caller can see, with visible orders. */
export async function listOrchards(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);

  let orchards: (OrchardRow & { grower_name?: string })[];
  if (actor.role === "broker") {
    orchards = await rows<OrchardRow & { grower_name: string }>(
      services.pool,
      `SELECT o.*, g.name AS grower_name FROM orchards o JOIN growers g ON g.id = o.grower_id ORDER BY o.name, o.id`,
    );
  } else if (actor.role === "grower") {
    orchards = await rows<OrchardRow>(
      services.pool, "SELECT * FROM orchards WHERE grower_id = $1 ORDER BY name, id", [actor.id],
    );
  } else {
    orchards = await rows<OrchardRow>(
      services.pool,
      `SELECT DISTINCT o.* FROM orchards o JOIN orders od ON od.orchard_id = o.id
       WHERE od.status <> 'draft' ORDER BY o.name, o.id`,
    );
  }

  const visibleOrders = await loadVisibleOrderContexts(services.pool, actor);
  const ordersByOrchard = new Map<string, OrderContext[]>();
  for (const context of visibleOrders) {
    const list = ordersByOrchard.get(context.order.orchard_id) ?? [];
    list.push(context);
    ordersByOrchard.set(context.order.orchard_id, list);
  }

  const blocksByOrchard = new Map<string, { id: string; name: string; acres: number }[]>();
  const blockRows = actor.role === "broker"
    ? await rows<{ id: string; orchard_id: string; name: string; acres: string }>(services.pool, "SELECT id, orchard_id, name, acres FROM blocks ORDER BY orchard_id, position")
    : await rows<{ id: string; orchard_id: string; name: string; acres: string }>(
        services.pool,
        `SELECT b.id, b.orchard_id, b.name, b.acres FROM blocks b
         WHERE b.orchard_id = ANY($1) ORDER BY b.orchard_id, b.position`,
        [orchards.map((o) => o.id)],
      );
  for (const block of blockRows) {
    const list = blocksByOrchard.get(block.orchard_id) ?? [];
    list.push({ id: block.id, name: block.name, acres: Number(block.acres) });
    blocksByOrchard.set(block.orchard_id, list);
  }

  const payload = orchards
    .filter((orchard) => {
      if (actor.role === "beekeeper") return (ordersByOrchard.get(orchard.id) ?? []).length > 0;
      return true;
    })
    .map((orchard) => {
      const orders = (ordersByOrchard.get(orchard.id) ?? [])
        .sort((a, b) => a.order.created_at.getTime() - b.order.created_at.getTime())
        .map((context) => ({
          id: context.order.id,
          ref: context.order.ref,
          status: context.order.settlement_status === "queued" && context.order.status === "inspected"
            ? "Settlement queued"
            : ORDER_LABELS[context.order.status as OrderStatus],
          bloom_start: context.order.bloom_start,
        }));
      const entry: Record<string, unknown> = {
        id: orchard.id,
        name: orchard.name,
        county: orchard.county,
        blocks: blocksByOrchard.get(orchard.id) ?? [],
        orders,
      };
      if (actor.role === "broker" && orchard.grower_name) {
        entry.grower = { id: orchard.grower_id, name: orchard.grower_name };
      }
      return entry;
    });
  res.status(200).json(payload);
}
