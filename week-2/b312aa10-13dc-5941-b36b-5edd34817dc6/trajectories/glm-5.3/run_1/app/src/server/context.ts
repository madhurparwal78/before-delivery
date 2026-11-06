import type { Config } from './config.js';
import type { PoolClient } from 'pg';
import { KillBillClient } from './kb.js';
import { StorageClient } from './storage.js';
import type { PeakWindow } from './pricing.js';
import { ApiError } from './errors.js';

export interface KitchenRow {
  id: string;
  name: string;
  slug: string;
  time_zone: string;
  rules_version: number;
  peak_windows: PeakWindow[];
  required_documents: string[];
  first_start_date: string | null;
  first_start_instant: Date | null;
}

export interface PersonRow {
  id: string;
  email: string;
  name: string;
  role: 'operator' | 'shift_lead' | 'member';
  kitchen_id: string;
  member_id: string | null;
}

export interface MemberRow {
  id: string;
  kitchen_id: string;
  person_id: string | null;
  business_name: string;
  allowance_hours: number;
}

export interface Caller {
  person: PersonRow;
  kitchen: KitchenRow;
}

export interface AppContext {
  config: Config;
  killbill: KillBillClient;
  storage: StorageClient;
}

export async function loadKitchen(client: PoolClient, kitchenId: string): Promise<KitchenRow> {
  const result = await client.query<KitchenRow>(`SELECT * FROM kitchens WHERE id=$1`, [kitchenId]);
  if (result.rows.length === 0) throw new ApiError('not_found');
  return result.rows[0];
}

export type StationKind = 'hourly' | 'shelf';
