import { query } from '../db.js';
import { businessMonthInZone as monthInZone, shiftMonth, zonedTime } from './time.js';
import { hashPassword, hashPartnerKey } from './crypto.js';
import * as seed from './seed.js';

export async function migrate(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_info (id int PRIMARY KEY DEFAULT 1, seeded_at timestamptz);
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      slug text PRIMARY KEY,
      name text NOT NULL,
      legal_name text NOT NULL,
      lei text NOT NULL,
      jurisdiction_code text NOT NULL,
      time_zone text NOT NULL,
      city text NOT NULL,
      currency text NOT NULL,
      confirmation_limit_cents bigint NOT NULL,
      case_prefix text NOT NULL,
      sending_address text NOT NULL,
      case_sequence bigint NOT NULL DEFAULT 0,
      kb_account_id text
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS members (
      id text PRIMARY KEY,
      workspace_slug text NOT NULL,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      role text NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id text PRIMARY KEY,
      member_id text NOT NULL,
      workspace_slug text NOT NULL,
      expires_at timestamptz NOT NULL,
      ended boolean NOT NULL DEFAULT false,
      end_reason text
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS customers (
      id text PRIMARY KEY,
      workspace_slug text NOT NULL,
      name text NOT NULL,
      identity_number text NOT NULL,
      date_of_birth date NOT NULL,
      deposit_address text NOT NULL
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS counterparties (
      id text PRIMARY KEY,
      workspace_slug text NOT NULL,
      legal_name text NOT NULL,
      lei text NOT NULL,
      jurisdiction_code text NOT NULL,
      licence_number text NOT NULL,
      due_diligence text NOT NULL,
      network text NOT NULL,
      contact_email text,
      notes text NOT NULL DEFAULT '',
      signing_value text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (workspace_slug, lei)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS counterparty_names (
      id text PRIMARY KEY,
      counterparty_id text NOT NULL,
      workspace_slug text NOT NULL,
      name text NOT NULL,
      from_date date NOT NULL,
      until_date date
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS addresses (
      id text PRIMARY KEY,
      workspace_slug text NOT NULL,
      address text NOT NULL,
      counterparty_id text NOT NULL,
      UNIQUE (workspace_slug, address)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS jurisdictions (
      code text PRIMARY KEY,
      name text NOT NULL,
      region text NOT NULL,
      currency text NOT NULL
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS jurisdiction_rules (
      code text PRIMARY KEY,
      threshold_cents bigint,
      in_force_since date,
      change_threshold_cents bigint,
      change_takes_effect_on date,
      change_announced_at timestamptz
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS rule_changes (
      id text PRIMARY KEY,
      workspace_slug text NOT NULL,
      jurisdiction_code text NOT NULL,
      threshold_cents bigint NOT NULL,
      takes_effect_on date NOT NULL,
      takes_effect_at timestamptz NOT NULL,
      announced_by text NOT NULL,
      announced_at timestamptz NOT NULL,
      state text NOT NULL,
      UNIQUE (workspace_slug, jurisdiction_code, takes_effect_on)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS workspace_rules (
      workspace_slug text NOT NULL,
      jurisdiction_code text NOT NULL,
      threshold_cents bigint,
      in_force_since date,
      change_threshold_cents bigint,
      change_takes_effect_on date,
      PRIMARY KEY (workspace_slug, jurisdiction_code)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS rates (
      asset text NOT NULL,
      currency text NOT NULL,
      rate_cents bigint NOT NULL,
      in_force_since date NOT NULL,
      PRIMARY KEY (asset, currency)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS cases (
      id text PRIMARY KEY,
      workspace_slug text NOT NULL,
      reference text NOT NULL,
      created_at timestamptz NOT NULL,
      created_by_kind text NOT NULL,
      created_by_name text NOT NULL,
      asset text NOT NULL,
      amount_digits bigint NOT NULL,
      amount_scale int NOT NULL,
      destination_address text NOT NULL,
      sending_address text NOT NULL,
      wallet text NOT NULL,
      counterparty_id text,
      counterparty_name_as_sent text,
      counterparty_lei text,
      counterparty_jurisdiction text,
      counterparty_network text,
      customer_id text NOT NULL,
      originator_name text,
      originator_identity text,
      originator_dob date,
      beneficiary_name text,
      fiat_value_cents bigint NOT NULL,
      currency text NOT NULL,
      path text NOT NULL,
      status text NOT NULL,
      data_sent_channel text,
      data_sent_at timestamptz,
      answer_due_at timestamptz,
      answer_decision text,
      answer_at timestamptz,
      answer_late boolean,
      answer_via text,
      ownership_required boolean NOT NULL DEFAULT false,
      ownership_confirmed_on date,
      ownership_recorded_at timestamptz,
      ownership_recorded_by text,
      release_reason text,
      release_reason_by text,
      release_reason_at timestamptz,
      outcome text,
      closed_at timestamptz,
      archived boolean NOT NULL DEFAULT false,
      archived_at timestamptz,
      erased boolean NOT NULL DEFAULT false,
      erasure_due_at timestamptz,
      erasure_status text NOT NULL DEFAULT 'not_due',
      erased_at timestamptz,
      decided_jurisdiction text NOT NULL,
      decided_threshold_cents bigint,
      decided_threshold_currency text,
      decided_rule_since date,
      decided_rate_cents bigint NOT NULL,
      decided_confirmation_limit bigint NOT NULL,
      decided_counterparty_name text,
      decided_counterparty_rule text,
      decided_review_accepted_at timestamptz,
      review_decision text,
      review_reason text,
      review_decided_by text,
      review_decided_at timestamptz,
      UNIQUE (workspace_slug, reference)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS review_claims (
      case_id text PRIMARY KEY,
      workspace_slug text NOT NULL,
      member_id text NOT NULL,
      member_name text NOT NULL,
      claimed_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS request_pages (
      id text PRIMARY KEY,
      case_id text NOT NULL,
      workspace_slug text NOT NULL,
      token text NOT NULL UNIQUE,
      status text NOT NULL,
      sent_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      contact_email text NOT NULL,
      answer_decision text,
      answer_received_at timestamptz,
      certificate_id text
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id text PRIMARY KEY,
      workspace_slug text NOT NULL,
      message_id text NOT NULL,
      sender_counterparty_id text NOT NULL,
      type text NOT NULL,
      received_at timestamptz NOT NULL,
      sha256 text NOT NULL,
      size_bytes bigint NOT NULL,
      object_key text NOT NULL,
      outcome text NOT NULL,
      case_id text,
      first_accepted boolean NOT NULL DEFAULT true,
      working jsonb,
      metered boolean NOT NULL DEFAULT false,
      metered_at timestamptz,
      erased boolean NOT NULL DEFAULT false,
      UNIQUE (workspace_slug, sender_counterparty_id, message_id)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS certificates (
      id text PRIMARY KEY,
      workspace_slug text NOT NULL,
      case_id text NOT NULL,
      content_type text NOT NULL,
      size_bytes bigint NOT NULL,
      sha256 text NOT NULL,
      object_key text NOT NULL,
      stored_at timestamptz NOT NULL,
      erased boolean NOT NULL DEFAULT false
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS metered_messages (
      id text PRIMARY KEY,
      workspace_slug text NOT NULL,
      at timestamptz NOT NULL,
      direction text NOT NULL
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS closed_months (
      workspace_slug text NOT NULL,
      month text NOT NULL,
      status text NOT NULL,
      invoice_id text,
      closed_at timestamptz,
      lines jsonb NOT NULL,
      total_cents bigint NOT NULL,
      PRIMARY KEY (workspace_slug, month)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS partner_keys (
      id text PRIMARY KEY,
      workspace_slug text NOT NULL,
      label text NOT NULL,
      starts_with text NOT NULL,
      key_hash text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL,
      last_used_at timestamptz,
      revoked_at timestamptz
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS request_keys (
      partner_key_id text NOT NULL,
      request_key text NOT NULL,
      body_sha256 text NOT NULL,
      status int NOT NULL,
      body jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (partner_key_id, request_key)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS rate_windows (
      key text NOT NULL,
      window_start timestamptz NOT NULL,
      request_at timestamptz NOT NULL,
      count int NOT NULL DEFAULT 0,
      PRIMARY KEY (key, window_start, request_at)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS listings (
      workspace_slug text UNIQUE,
      slug text PRIMARY KEY,
      name text NOT NULL,
      jurisdiction_code text NOT NULL,
      on_network boolean NOT NULL,
      listed boolean NOT NULL
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS cases_ws_status ON cases (workspace_slug, status)`);
  await query(`CREATE INDEX IF NOT EXISTS messages_ws ON messages (workspace_slug, received_at DESC)`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS counterparties_name_norm ON counterparties (workspace_slug, legal_name)`);
}

function id(prefix: string, n: number): string {
  return `${prefix}-${n.toString().padStart(3, '0')}`;
}

export async function applySeed(): Promise<void> {
  const now = new Date();
  const info = await query<{ seeded_at: Date }>('SELECT seeded_at FROM schema_info WHERE id = 1');
  if (info.rows.length === 0) {
    await query('INSERT INTO schema_info (id, seeded_at) VALUES (1, $1)', [now]);
    await query('INSERT INTO workspaces (slug, name, legal_name, lei, jurisdiction_code, time_zone, city, currency, confirmation_limit_cents, case_prefix, sending_address, case_sequence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0)',
      [seed.WORKSPACES[0].slug, seed.WORKSPACES[0].name, seed.WORKSPACES[0].legalName, seed.WORKSPACES[0].lei, seed.WORKSPACES[0].jurisdictionCode, seed.WORKSPACES[0].timeZone, seed.WORKSPACES[0].city, seed.WORKSPACES[0].currency, seed.WORKSPACES[0].confirmationLimitCents, seed.WORKSPACES[0].casePrefix, seed.WORKSPACES[0].sendingAddress]);
    await query('INSERT INTO workspaces (slug, name, legal_name, lei, jurisdiction_code, time_zone, city, currency, confirmation_limit_cents, case_prefix, sending_address, case_sequence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0)',
      [seed.WORKSPACES[1].slug, seed.WORKSPACES[1].name, seed.WORKSPACES[1].legalName, seed.WORKSPACES[1].lei, seed.WORKSPACES[1].jurisdictionCode, seed.WORKSPACES[1].timeZone, seed.WORKSPACES[1].city, seed.WORKSPACES[1].currency, seed.WORKSPACES[1].confirmationLimitCents, seed.WORKSPACES[1].casePrefix, seed.WORKSPACES[1].sendingAddress]);
    await query('INSERT INTO listings (workspace_slug, slug, name, jurisdiction_code, on_network, listed) VALUES ($1,$2,$3,$4,$5,true)',
      [seed.WORKSPACES[0].slug, seed.WORKSPACES[0].listingSlug, seed.WORKSPACES[0].legalName, seed.WORKSPACES[0].jurisdictionCode, seed.WORKSPACES[0].onNetwork]);
    await query('INSERT INTO listings (workspace_slug, slug, name, jurisdiction_code, on_network, listed) VALUES ($1,$2,$3,$4,$5,true)',
      [seed.WORKSPACES[1].slug, seed.WORKSPACES[1].listingSlug, seed.WORKSPACES[1].legalName, seed.WORKSPACES[1].jurisdictionCode, seed.WORKSPACES[1].onNetwork]);
    let i = 1;
    for (const m of seed.MEMBERS) {
      await query('INSERT INTO members (id, workspace_slug, name, email, role, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id('mem', i), m.workspace, m.name, m.email, m.role, hashPassword(seed.STAFF_PASSWORD), now]);
      i++;
    }
    i = 1;
    for (const c of seed.CUSTOMERS) {
      await query('INSERT INTO customers (id, workspace_slug, name, identity_number, date_of_birth, deposit_address) VALUES ($1,$2,$3,$4,$5,$6)',
        [c.id, c.workspace, c.name, c.identityNumber, c.dateOfBirth, c.depositAddress]);
      i++;
    }
    for (const ws of seed.WORKSPACES) {
      let j = 1;
      for (const cp of seed.COUNTERPARTIES) {
        const cpId = `cp-${ws.slug}-${j.toString().padStart(3, '0')}`;
        const signing = seed.SIGNING_VALUE_BY_LEI[cp.lei];
        await query('INSERT INTO counterparties (id, workspace_slug, legal_name, lei, jurisdiction_code, licence_number, due_diligence, network, contact_email, notes, signing_value, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)',
          [cpId, ws.slug, cp.legalName, cp.lei, cp.jurisdictionCode, cp.licenceNumber, cp.dueDiligence, cp.network, cp.contactEmail, '', signing !== undefined ? signing[ws.slug] : null, now]);
        await query('INSERT INTO counterparty_names (id, counterparty_id, workspace_slug, name, from_date) VALUES ($1,$2,$3,$4,$5)',
          [`${cpId}-n0`, cpId, ws.slug, cp.legalName, '2026-01-01']);
        await query('INSERT INTO addresses (id, workspace_slug, address, counterparty_id) VALUES ($1,$2,$3,$4)',
          [`${ws.slug}-a${j}`, ws.slug, cp.address, cpId]);
        j++;
      }
    }
    for (const j of seed.JURISDICTIONS) {
      await query('INSERT INTO jurisdictions (code, name, region, currency) VALUES ($1,$2,$3,$4)', [j.code, j.name, j.region, j.currency]);
      await query('INSERT INTO jurisdiction_rules (code, threshold_cents, in_force_since, change_threshold_cents, change_takes_effect_on, change_announced_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [j.code, j.thresholdCents, j.inForceSince, j.change !== null ? j.change.thresholdCents : null, j.change !== null ? j.change.takesEffectOn : null, j.change !== null ? now : null]);
      for (const ws of seed.WORKSPACES) {
        await query('INSERT INTO workspace_rules (workspace_slug, jurisdiction_code, threshold_cents, in_force_since, change_threshold_cents, change_takes_effect_on) VALUES ($1,$2,$3,$4,$5,$6)',
          [ws.slug, j.code, j.thresholdCents, j.inForceSince, j.change !== null ? j.change.thresholdCents : null, j.change !== null ? j.change.takesEffectOn : null]);
      }
    }
    for (const r of seed.RATES) {
      await query('INSERT INTO rates (asset, currency, rate_cents, in_force_since) VALUES ($1,$2,$3,$4)', [r.asset, 'EUR', r.eurCents, r.since]);
      await query('INSERT INTO rates (asset, currency, rate_cents, in_force_since) VALUES ($1,$2,$3,$4)', [r.asset, 'SGD', r.sgdCents, r.since]);
    }
    for (const l of seed.LISTINGS) {
      const existing = await query('SELECT 1 FROM listings WHERE slug = $1', [l.slug]);
      if (existing.rows.length === 0) {
        await query('INSERT INTO listings (workspace_slug, slug, name, jurisdiction_code, on_network, listed) VALUES ($1,$2,$3,$4,$5,true)', [null, l.slug, l.name, l.jurisdictionCode, l.onNetwork]);
      }
    }
    for (const k of seed.PARTNER_KEYS) {
      await query('INSERT INTO partner_keys (id, workspace_slug, label, starts_with, key_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [id('pk', seed.PARTNER_KEYS.indexOf(k) + 1), k.workspace, k.label, k.key.slice(0, 9), hashPartnerKey(k.key), now]);
    }
    // Seeded metered message records for the three months before month 0.
    for (const ws of seed.WORKSPACES) {
      const tz = ws.timeZone;
      const month0 = monthInZone(now, tz);
      for (const m of seed.SEEDED_MONTHS) {
        const target = shiftMonth(month0, Number(m.month));
        const local = zonedTime(`${target}-15`, '12:00', tz);
        for (let n = 0; n < m.messages; n++) {
          await query('INSERT INTO metered_messages (id, workspace_slug, at, direction) VALUES ($1,$2,$3,$4)',
            [`${ws.slug}-${target}-${n}`, ws.slug, local, n % 2 === 0 ? 'sent' : 'received']);
        }
        await query(`INSERT INTO closed_months (workspace_slug, month, status, lines, total_cents) VALUES ($1,$2,'ready','[]',0)`, [ws.slug, target]);
      }
      await query(`INSERT INTO closed_months (workspace_slug, month, status, lines, total_cents) VALUES ($1,$2,'open','[]',0)`, [ws.slug, month0]);
    }
  }
}
