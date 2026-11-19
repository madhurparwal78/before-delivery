import type { Pool } from "pg";
import { COUNTRY_BY_CODE, cardBehaviour, type CardBehaviour, type Zone } from "../shared/domain.js";
import { pledgeAmount } from "../shared/money.js";

// Shared row shapes and lookups used by routes and workers.

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  key: string;
}

export interface TierRow {
  id: string;
  campaign_id: string;
  title: string;
  description: string;
  price: number;
  quantity: number | null;
  shipping_domestic: number;
  shipping_europe: number;
  shipping_rest_of_world: number;
  position: number;
}

export interface MediaRow {
  id: string;
  campaign_id: string;
  kind: "cover" | "spread";
  status: "stored" | "uploading" | "failed";
  content_type: string;
  bytes: number;
  object_key: string;
  filename: string | null;
}

export function zoneFor(country: string, shipsFrom: string): Zone | null {
  const target = COUNTRY_BY_CODE.get(country);
  if (target === undefined) return null;
  if (country === shipsFrom) return "domestic";
  return target.zone;
}

export function shippingForTier(tier: TierRow, zone: Zone): number {
  switch (zone) {
    case "domestic":
      return tier.shipping_domestic;
    case "europe":
      return tier.shipping_europe;
    case "rest_of_world":
      return tier.shipping_rest_of_world;
  }
}

export function behaviourForCard(raw: string): CardBehaviour | null {
  return cardBehaviour(raw);
}

export function last4(raw: string): string {
  const digits = raw.replace(/ /g, "");
  return digits.slice(-4);
}

/** The single computation of a quote amount from tier, zone and add-on. */
export function quoteAmount(
  tier: TierRow,
  zone: Zone,
  addOn: number,
): { reward: number; shipping: number; amount: number } {
  const reward = tier.price;
  const shipping = shippingForTier(tier, zone);
  return { reward, shipping, amount: pledgeAmount({ reward, shipping, add_on: addOn }) };
}

export interface CampaignTotals {
  total: number;
  captured_total: number;
  backer_count: number;
}

export async function campaignTotals(pool: Pool, campaignId: string): Promise<CampaignTotals> {
  const result = await pool.query<{ total: string; captured_total: string; backer_count: string }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE state IN ('authorised','captured','errored')), 0) AS total,
       COALESCE(SUM(amount) FILTER (WHERE state = 'captured'), 0) AS captured_total,
       COUNT(*) FILTER (WHERE state IN ('authorised','captured','errored')) AS backer_count
     FROM pledges WHERE campaign_id = $1`,
    [campaignId],
  );
  const row = result.rows[0];
  return {
    total: Number(row?.total ?? 0),
    captured_total: Number(row?.captured_total ?? 0),
    backer_count: Number(row?.backer_count ?? 0),
  };
}