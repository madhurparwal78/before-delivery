import {
  dateText,
  instant,
  int,
  nullableText,
  one,
  rows,
  text,
  type Queryable,
  type Row,
} from '../db';
import type { RuleSetRecord } from '../domain/rules';
import { apiError } from '../http/errors';
import type { PhotoContentType } from '../services/storage';
import type {
  DropStatus,
  InspectionLinkStatus,
  OrderStatus,
  SettlementStatus,
} from '../../shared/labels';

export interface OrchardRecord {
  id: string;
  name: string;
  county: string;
  growerId: string;
  growerName: string;
  growerContactName: string;
  growerEmail: string;
}

export interface OrderBlockRecord {
  blockId: string;
  name: string;
  acresTenths: number;
  hivesOrdered: number;
  position: number;
}

export interface DropRecord {
  id: string;
  orderId: string;
  beekeeperId: string;
  beekeeperName: string;
  yardName: string;
  hives: number;
  status: DropStatus;
  blockId: string | null;
  deliveredOn: string | null;
  disputeReason: string | null;
  resolutionNote: string | null;
}

export interface SampleRecord {
  id: string;
  blockId: string;
  dropId: string;
  colonyLabel: string;
  framesTenths: number;
}

export interface PhotoRecord {
  id: string;
  sampleId: string;
  objectKey: string;
  contentType: PhotoContentType;
}

export interface InspectionLinkRecord {
  id: string;
  orderId: string;
  inspectorEmail: string;
  status: InspectionLinkStatus;
  issuedAt: Date;
  expiresAt: Date;
  signedAt: Date | null;
  inspectorName: string | null;
  reportKey: string | null;
}

export interface SettlementShareRecord {
  beekeeperId: string;
  hives: number;
  grossCents: number;
  payoutCents: number;
}

export interface SettlementRecord {
  orderId: string;
  status: 'queued' | 'settled';
  paymentReceivedOn: string;
  ruleSetId: string;
  ruleSetName: string;
  payableCents: number;
  commissionBps: number;
  commissionCents: number;
  shares: SettlementShareRecord[];
}

export interface OrderAggregate {
  id: string;
  ref: string;
  status: OrderStatus;
  settlementStatus: SettlementStatus;
  bloomStart: string;
  bloomEnd: string;
  deliveryDeadline: string;
  orchard: OrchardRecord;
  ruleSet: RuleSetRecord;
  blocks: OrderBlockRecord[];
  drops: DropRecord[];
  samples: SampleRecord[];
  photos: PhotoRecord[];
  inspectionLink: InspectionLinkRecord | null;
  settlement: SettlementRecord | null;
  reportAvailable: boolean;
}

function toRuleSet(row: Row, prefix = ''): RuleSetRecord {
  return {
    id: text(row[`${prefix}id`]),
    name: text(row[`${prefix}name`]),
    effectiveFrom: dateText(row[`${prefix}effective_from`]),
    thresholdsTenths: {
      reduced: int(row[`${prefix}threshold_reduced_tenths`]),
      standard: int(row[`${prefix}threshold_standard_tenths`]),
      bonus: int(row[`${prefix}threshold_bonus_tenths`]),
    },
    pricePerHiveCents: {
      none: int(row[`${prefix}price_none_cents`]),
      reduced: int(row[`${prefix}price_reduced_cents`]),
      standard: int(row[`${prefix}price_standard_cents`]),
      bonus: int(row[`${prefix}price_bonus_cents`]),
    },
    commissionBps: int(row[`${prefix}commission_bps`]),
    depositPerHiveCents: int(row[`${prefix}deposit_per_hive_cents`]),
  };
}

const ORDER_COLUMNS = `
  o.id, o.ref, o.status, o.settlement_status, o.bloom_start, o.bloom_end, o.delivery_deadline,
  orc.id as orchard_id, orc.name as orchard_name, orc.county as orchard_county,
  grower.id as grower_id, grower.business_name as grower_name,
  grower.contact_name as grower_contact_name, grower.email as grower_email,
  rs.id as rs_id, rs.name as rs_name, rs.effective_from as rs_effective_from,
  rs.threshold_reduced_tenths as rs_threshold_reduced_tenths,
  rs.threshold_standard_tenths as rs_threshold_standard_tenths,
  rs.threshold_bonus_tenths as rs_threshold_bonus_tenths,
  rs.price_none_cents as rs_price_none_cents, rs.price_reduced_cents as rs_price_reduced_cents,
  rs.price_standard_cents as rs_price_standard_cents, rs.price_bonus_cents as rs_price_bonus_cents,
  rs.commission_bps as rs_commission_bps, rs.deposit_per_hive_cents as rs_deposit_per_hive_cents
`;

const ORDER_FROM = `
  from orders o
  join orchards orc on orc.id = o.orchard_id
  join users grower on grower.id = orc.grower_id
  join rule_sets rs on rs.id = o.rule_set_id
`;

type OrderHeader = Omit<
  OrderAggregate,
  'blocks' | 'drops' | 'samples' | 'photos' | 'inspectionLink' | 'settlement' | 'reportAvailable'
>;

function orderHeader(row: Row): OrderHeader {
  return {
    id: text(row.id),
    ref: text(row.ref),
    status: text(row.status) as OrderStatus,
    settlementStatus: text(row.settlement_status) as SettlementStatus,
    bloomStart: dateText(row.bloom_start),
    bloomEnd: dateText(row.bloom_end),
    deliveryDeadline: dateText(row.delivery_deadline),
    orchard: {
      id: text(row.orchard_id),
      name: text(row.orchard_name),
      county: text(row.orchard_county),
      growerId: text(row.grower_id),
      growerName: text(row.grower_name),
      growerContactName: text(row.grower_contact_name),
      growerEmail: text(row.grower_email),
    },
    ruleSet: toRuleSet(row, 'rs_'),
  };
}

export async function loadOrderAggregates(
  client: Queryable,
  orderIds: readonly string[],
): Promise<Map<string, OrderAggregate>> {
  const result = new Map<string, OrderAggregate>();
  if (orderIds.length === 0) return result;
  const ids = [...orderIds];

  const orderRows = await rows(
    client,
    `select ${ORDER_COLUMNS} ${ORDER_FROM} where o.id = any($1::text[])`,
    [ids],
  );
  const blockRows = await rows(
    client,
    `select ob.order_id, ob.block_id, ob.hives_ordered, ob.position, b.name, b.acres_tenths
       from order_blocks ob join blocks b on b.id = ob.block_id
      where ob.order_id = any($1::text[]) order by ob.position, b.name`,
    [ids],
  );
  const dropRows = await rows(
    client,
    `select d.id, d.order_id, d.beekeeper_id, d.yard_name, d.hives, d.status, d.block_id,
            d.delivered_on, d.dispute_reason, d.resolution_note, u.business_name as beekeeper_name
       from drops d join users u on u.id = d.beekeeper_id
      where d.order_id = any($1::text[]) order by d.id`,
    [ids],
  );
  const sampleRows = await rows(
    client,
    `select id, order_id, block_id, drop_id, colony_label, frames_tenths
       from samples where order_id = any($1::text[]) order by id`,
    [ids],
  );
  const photoRows = await rows(
    client,
    `select id, order_id, sample_id, object_key, content_type
       from photos where order_id = any($1::text[]) order by id`,
    [ids],
  );
  const linkRows = await rows(
    client,
    `select id, order_id, inspector_email, status, issued_at, expires_at, signed_at,
            inspector_name, report_key
       from inspection_links where order_id = any($1::text[]) order by issued_at`,
    [ids],
  );
  const settlementRows = await rows(
    client,
    `select s.order_id, s.status, s.payment_received_on, s.rule_set_id, s.payable_cents,
            s.commission_bps, s.commission_cents, s.shares, rs.name as rule_set_name
       from settlements s join rule_sets rs on rs.id = s.rule_set_id
      where s.order_id = any($1::text[])`,
    [ids],
  );

  for (const row of orderRows) {
    result.set(text(row.id), {
      ...orderHeader(row),
      blocks: [],
      drops: [],
      samples: [],
      photos: [],
      inspectionLink: null,
      settlement: null,
      reportAvailable: false,
    });
  }
  for (const row of blockRows) {
    result.get(text(row.order_id))?.blocks.push({
      blockId: text(row.block_id),
      name: text(row.name),
      acresTenths: int(row.acres_tenths),
      hivesOrdered: int(row.hives_ordered),
      position: int(row.position),
    });
  }
  for (const row of dropRows) {
    result.get(text(row.order_id))?.drops.push({
      id: text(row.id),
      orderId: text(row.order_id),
      beekeeperId: text(row.beekeeper_id),
      beekeeperName: text(row.beekeeper_name),
      yardName: text(row.yard_name),
      hives: int(row.hives),
      status: text(row.status) as DropStatus,
      blockId: nullableText(row.block_id),
      deliveredOn: row.delivered_on === null ? null : dateText(row.delivered_on),
      disputeReason: nullableText(row.dispute_reason),
      resolutionNote: nullableText(row.resolution_note),
    });
  }
  for (const row of sampleRows) {
    result.get(text(row.order_id))?.samples.push({
      id: text(row.id),
      blockId: text(row.block_id),
      dropId: text(row.drop_id),
      colonyLabel: text(row.colony_label),
      framesTenths: int(row.frames_tenths),
    });
  }
  for (const row of photoRows) {
    result.get(text(row.order_id))?.photos.push({
      id: text(row.id),
      sampleId: text(row.sample_id),
      objectKey: text(row.object_key),
      contentType: text(row.content_type) as PhotoContentType,
    });
  }
  for (const row of linkRows) {
    const aggregate = result.get(text(row.order_id));
    if (aggregate === undefined) continue;
    const link: InspectionLinkRecord = {
      id: text(row.id),
      orderId: text(row.order_id),
      inspectorEmail: text(row.inspector_email),
      status: text(row.status) as InspectionLinkStatus,
      issuedAt: instant(row.issued_at),
      expiresAt: instant(row.expires_at),
      signedAt: row.signed_at === null ? null : instant(row.signed_at),
      inspectorName: nullableText(row.inspector_name),
      reportKey: nullableText(row.report_key),
    };
    aggregate.inspectionLink = link;
    if (link.status === 'signed' && link.reportKey !== null) aggregate.reportAvailable = true;
  }
  for (const row of settlementRows) {
    const aggregate = result.get(text(row.order_id));
    if (aggregate === undefined) continue;
    aggregate.settlement = {
      orderId: text(row.order_id),
      status: text(row.status) as 'queued' | 'settled',
      paymentReceivedOn: dateText(row.payment_received_on),
      ruleSetId: text(row.rule_set_id),
      ruleSetName: text(row.rule_set_name),
      payableCents: int(row.payable_cents),
      commissionBps: int(row.commission_bps),
      commissionCents: int(row.commission_cents),
      shares: row.shares as SettlementShareRecord[],
    };
  }
  return result;
}

export async function loadOrderAggregate(
  client: Queryable,
  orderId: string,
): Promise<OrderAggregate | null> {
  const found = await loadOrderAggregates(client, [orderId]);
  return found.get(orderId) ?? null;
}

export async function loadRuleSets(client: Queryable): Promise<RuleSetRecord[]> {
  const ruleSetRows = await rows(client, 'select * from rule_sets order by effective_from');
  return ruleSetRows.map((row) => toRuleSet(row));
}

/** A drop of this order, or a 404 when the id is not one of its drops. */
export function requireDrop(order: OrderAggregate, dropId: string): DropRecord {
  const drop = order.drops.find((entry) => entry.id === dropId);
  if (drop === undefined) throw apiError.notFound();
  return drop;
}

export async function findDropOwner(
  client: Queryable,
  dropId: string,
): Promise<{ orderId: string; beekeeperId: string } | null> {
  const row = await one(client, 'select order_id, beekeeper_id from drops where id = $1', [dropId]);
  return row === null
    ? null
    : { orderId: text(row.order_id), beekeeperId: text(row.beekeeper_id) };
}
