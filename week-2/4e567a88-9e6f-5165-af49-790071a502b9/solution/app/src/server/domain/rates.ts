// Rate selection: a job's rate is the latest rate whose effective instant is at or before its submission.

import type { Db } from "../db";
import { single } from "../db";

export interface RateRow {
  id: string;
  model: string;
  micro_per_unit: bigint;
  effective_at: Date;
  created_by: string | null;
}

/** Every model has a seeded rate in effect from 2026-01-01, so a rate always applies. */
export async function rateAt(db: Db, model: string, at: Date): Promise<RateRow> {
  return single<RateRow>(db,
    `SELECT id, model, micro_per_unit, effective_at, created_by FROM rates
     WHERE model = $1 AND effective_at <= $2 ORDER BY effective_at DESC, created_at DESC LIMIT 1`, [model, at]);
}

type RateStatus = "past" | "current" | "scheduled";

export function rateStatus(rate: RateRow, current: RateRow, now: Date): RateStatus {
  if (rate.effective_at > now) return "scheduled";
  return rate.id === current.id ? "current" : "past";
}
