import { randomUUID } from 'node:crypto';
import {
  businessDate,
  businessMonth,
  fromWallClock,
  previousBusinessMonth,
} from '../../shared/businesstime';
import { normaliseName } from '../domain/names';
import { hashPartnerKey, hashPassword } from '../domain/password';
import { query, queryOne } from './pool';
import {
  RATES_IN_FORCE_SINCE,
  SEED_COUNTERPARTIES,
  SEED_CUSTOMERS,
  SEED_JURISDICTIONS,
  SEED_LISTINGS,
  SEED_MEMBERS,
  SEED_METERED_MONTHS,
  SEED_PARTNER_KEYS,
  SEED_PASSWORD,
  SEED_RATES,
  SEED_WORKSPACES,
} from './seeddata';

interface DeploymentRow {
  started_at: Date;
  first_business_date_neris: string;
  first_business_date_kallang: string;
}

export interface Deployment {
  readonly startedAt: Date;
  readonly firstBusinessDate: Readonly<Record<string, string>>;
}

async function readOrCreateDeployment(): Promise<Deployment> {
  const existing = await queryOne<DeploymentRow>('SELECT * FROM deployment WHERE id = 1');
  if (existing !== null) {
    return {
      startedAt: existing.started_at,
      firstBusinessDate: {
        neris: existing.first_business_date_neris,
        kallang: existing.first_business_date_kallang,
      },
    };
  }
  const now = new Date();
  await query(
    `INSERT INTO deployment (id, started_at, first_business_date_neris, first_business_date_kallang)
     VALUES (1, $1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [now, businessDate(now, 'Europe/Vilnius'), businessDate(now, 'Asia/Singapore')],
  );
  const row = await queryOne<DeploymentRow>('SELECT * FROM deployment WHERE id = 1');
  if (row === null) throw new Error('The deployment record could not be written');
  return {
    startedAt: row.started_at,
    firstBusinessDate: {
      neris: row.first_business_date_neris,
      kallang: row.first_business_date_kallang,
    },
  };
}

async function seedWorkspaces(): Promise<void> {
  for (const workspace of SEED_WORKSPACES) {
    await query(
      `INSERT INTO workspaces (slug, name, legal_name, lei, jurisdiction_code, time_zone, city,
         currency, confirmation_limit_cents, case_prefix, sending_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (slug) DO NOTHING`,
      [
        workspace.slug,
        workspace.name,
        workspace.legalName,
        workspace.lei,
        workspace.jurisdictionCode,
        workspace.timeZone,
        workspace.city,
        workspace.currency,
        workspace.confirmationLimitCents.toString(),
        workspace.casePrefix,
        workspace.sendingAddress,
      ],
    );
  }
}

async function seedMembers(startedAt: Date): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const member of SEED_MEMBERS) {
    await query(
      `INSERT INTO members (id, workspace_slug, name, email, role, password_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (email) DO NOTHING`,
      [
        `mem-${member.email.split('@')[0]}-${member.workspaceSlug}`,
        member.workspaceSlug,
        member.name,
        member.email,
        member.role,
        passwordHash,
        startedAt,
      ],
    );
  }
}

async function seedJurisdictions(): Promise<void> {
  let order = 0;
  for (const entry of SEED_JURISDICTIONS) {
    order += 1;
    await query(
      `INSERT INTO jurisdictions (code, name, region, currency, reference_status,
         reference_threshold_cents, reference_in_force_since, reference_change_threshold_cents,
         reference_change_takes_effect_on, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (code) DO NOTHING`,
      [
        entry.code,
        entry.name,
        entry.region,
        entry.currency,
        entry.status,
        entry.thresholdCents === null ? null : entry.thresholdCents.toString(),
        entry.inForceSince,
        entry.changeThresholdCents === null ? null : entry.changeThresholdCents.toString(),
        entry.changeTakesEffectOn,
        order,
      ],
    );
  }
}

async function seedListings(): Promise<void> {
  let order = 0;
  for (const listing of SEED_LISTINGS) {
    order += 1;
    await query(
      `INSERT INTO listings (slug, name, jurisdiction_code, on_network, workspace_slug, listed, sort_order)
       VALUES ($1,$2,$3,$4,$5,true,$6) ON CONFLICT (slug) DO NOTHING`,
      [listing.slug, listing.name, listing.jurisdictionCode, listing.onNetwork, listing.workspaceSlug, order],
    );
  }
}

/** Each workspace's rule book starts as a copy of the jurisdiction reference table. */
async function seedThresholdChanges(startedAt: Date): Promise<void> {
  for (const workspace of SEED_WORKSPACES) {
    for (const entry of SEED_JURISDICTIONS) {
      if (entry.inForceSince !== null && entry.thresholdCents !== null) {
        await insertSeededChange(
          workspace.slug,
          workspace.timeZone,
          entry.code,
          entry.thresholdCents,
          entry.inForceSince,
          startedAt,
        );
      }
      if (entry.changeTakesEffectOn !== null && entry.changeThresholdCents !== null) {
        await insertSeededChange(
          workspace.slug,
          workspace.timeZone,
          entry.code,
          entry.changeThresholdCents,
          entry.changeTakesEffectOn,
          startedAt,
        );
      }
    }
  }
}

async function insertSeededChange(
  workspaceSlug: string,
  timeZone: string,
  jurisdictionCode: string,
  thresholdCents: bigint,
  takesEffectOn: string,
  announcedAt: Date,
): Promise<void> {
  const [year, month, day] = takesEffectOn.split('-').map((part) => Number.parseInt(part, 10));
  await query(
    `INSERT INTO threshold_changes (id, workspace_slug, jurisdiction_code, threshold_cents,
       takes_effect_on, takes_effect_at, announced_by, announced_at)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,$7)
     ON CONFLICT (workspace_slug, jurisdiction_code, takes_effect_on) DO NOTHING`,
    [
      `tc-${workspaceSlug}-${jurisdictionCode}-${takesEffectOn}`,
      workspaceSlug,
      jurisdictionCode,
      thresholdCents.toString(),
      takesEffectOn,
      fromWallClock(timeZone, year, month, day),
      announcedAt,
    ],
  );
}

async function seedRates(): Promise<void> {
  for (const workspace of SEED_WORKSPACES) {
    for (const rate of SEED_RATES) {
      await query(
        `INSERT INTO rates (workspace_slug, asset, currency, rate_cents, in_force_since)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_slug, asset) DO NOTHING`,
        [
          workspace.slug,
          rate.asset,
          workspace.currency,
          (workspace.currency === 'EUR' ? rate.eurCents : rate.sgdCents).toString(),
          RATES_IN_FORCE_SINCE,
        ],
      );
    }
  }
}

async function seedCustomers(): Promise<void> {
  let order = 0;
  for (const customer of SEED_CUSTOMERS) {
    order += 1;
    await query(
      `INSERT INTO customers (id, workspace_slug, name, identity_number, date_of_birth, deposit_address, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [
        customer.id,
        customer.workspaceSlug,
        customer.name,
        customer.identityNumber,
        customer.dateOfBirth,
        customer.depositAddress,
        order,
      ],
    );
  }
}

async function seedCounterparties(startedAt: Date, firstDates: Readonly<Record<string, string>>): Promise<void> {
  for (const workspace of SEED_WORKSPACES) {
    for (const counterparty of SEED_COUNTERPARTIES) {
      const id = `cp-${workspace.slug}-${counterparty.key}`;
      await query(
        `INSERT INTO counterparties (id, workspace_slug, legal_name, normalised_name, name_from, lei,
           jurisdiction_code, licence_number, due_diligence, network, contact_email, notes,
           signing_value, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'',$12,$13,$13)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          workspace.slug,
          counterparty.legalName,
          normaliseName(counterparty.legalName),
          firstDates[workspace.slug],
          counterparty.lei,
          counterparty.jurisdictionCode,
          counterparty.licenceNumber,
          counterparty.dueDiligence,
          counterparty.network,
          counterparty.contactEmail,
          counterparty.signingValues[workspace.slug] ?? null,
          startedAt,
        ],
      );
      await query(
        `INSERT INTO address_registry (workspace_slug, address, counterparty_id)
         VALUES ($1,$2,$3) ON CONFLICT (workspace_slug, address) DO NOTHING`,
        [workspace.slug, counterparty.registryAddress, id],
      );
    }
  }
}

async function seedPartnerKeys(startedAt: Date): Promise<void> {
  for (const entry of SEED_PARTNER_KEYS) {
    await query(
      `INSERT INTO partner_keys (id, workspace_slug, label, starts_with, key_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [
        `pk-${entry.workspaceSlug}-seed`,
        entry.workspaceSlug,
        entry.label,
        entry.key.slice(0, 9),
        hashPartnerKey(entry.key),
        startedAt,
      ],
    );
  }
}

/**
 * Metered message records, not stored messages, for the three business months
 * before the month that holds the first start instant.
 */
async function seedMeteredMessages(startedAt: Date): Promise<void> {
  for (const workspace of SEED_WORKSPACES) {
    let month = businessMonth(startedAt, workspace.timeZone);
    for (const count of SEED_METERED_MONTHS) {
      month = previousBusinessMonth(month);
      const [year, index] = month.split('-').map((part) => Number.parseInt(part, 10));
      const at = fromWallClock(workspace.timeZone, year, index, 15, 12, 0, 0);
      await query(
        `INSERT INTO metered_messages (id, workspace_slug, direction, sent_at, business_month)
         SELECT 'mm-' || $1 || '-' || $2 || '-' || n, $1, 'sent', $3, $2
         FROM generate_series(1, $4) AS n
         ON CONFLICT (id) DO NOTHING`,
        [workspace.slug, month, at, count],
      );
    }
  }
}

export async function applySeed(): Promise<Deployment> {
  const record = await readOrCreateDeployment();
  await seedWorkspaces();
  await seedMembers(record.startedAt);
  await seedJurisdictions();
  await seedListings();
  await seedThresholdChanges(record.startedAt);
  await seedRates();
  await seedCustomers();
  await seedCounterparties(record.startedAt, record.firstBusinessDate);
  await seedPartnerKeys(record.startedAt);
  await seedMeteredMessages(record.startedAt);
  return record;
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
