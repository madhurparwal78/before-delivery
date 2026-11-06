import { db, tx } from './db';
import { MICRO_PER_CREDIT } from './domain/money';
import { localToInstant } from './domain/zone';
import {
  ORG_NAME,
  ORG_RETENTION_DAYS,
  ORG_TIMEZONE,
  SCHEMA_SQL,
  SEED_MEMBERS,
  SEED_MODELS,
  SEED_PASSCODE,
  SEED_TEAMS,
} from './schema';
import { recordMovement } from './store/ledger';
import { AccessValue, Context, Policy, TeamAccessValue, TeamPolicy } from './types';

const SEED_POLICY_AUTHOR = 'm_rafael';

function orgModelAccess(): Record<string, Record<Context, AccessValue>> {
  const access: Record<string, Record<Context, AccessValue>> = {};
  for (const model of SEED_MODELS) {
    access[model.slug] = {
      api: 'allowed',
      playground: model.slug === 'reel-10' ? 'blocked' : 'allowed',
    };
  }
  return access;
}

function teamModelAccess(teamId: string): Record<string, Record<Context, TeamAccessValue>> {
  const access: Record<string, Record<Context, TeamAccessValue>> = {};
  for (const model of SEED_MODELS) {
    let api: TeamAccessValue = 'inherit';
    let playground: TeamAccessValue = 'inherit';
    if (teamId === 't_campaigns' && model.slug === 'reel-10') playground = 'allowed';
    if (teamId === 't_storefront' && model.slug === 'murmur-voice') api = 'blocked';
    access[model.slug] = { api, playground };
  }
  return access;
}

function seedPolicy(): Policy {
  const teams: TeamPolicy[] = SEED_TEAMS.map((team) => ({
    id: team.id,
    name: team.name,
    concurrency: team.concurrency,
    payload_visibility: team.payloadVisibility,
    soft_cap_credits: team.softCapCredits,
    hard_cap_credits: team.hardCapCredits,
    context_defaults: { api: 'inherit', playground: 'inherit' },
    model_access: teamModelAccess(team.id),
  }));
  return {
    version: 1,
    timezone: ORG_TIMEZONE,
    retention_days: ORG_RETENTION_DAYS,
    org_model_access: orgModelAccess(),
    teams,
  };
}

export async function applySchemaAndSeed(): Promise<void> {
  await db.query(SCHEMA_SQL);

  await db.query('INSERT INTO org (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name', [
    'org',
    ORG_NAME,
  ]);

  for (const team of SEED_TEAMS) {
    await db.query(
      `INSERT INTO teams (id, name, position, grant_micro) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position`,
      [team.id, team.name, team.position, (BigInt(team.grantCredits) * MICRO_PER_CREDIT).toString()],
    );
  }

  for (const member of SEED_MEMBERS) {
    await db.query(
      `INSERT INTO members (id, name, email, role, team_id, api_key, passcode) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role,
         team_id = EXCLUDED.team_id, api_key = EXCLUDED.api_key, passcode = EXCLUDED.passcode`,
      [member.id, member.name, member.email, member.role, member.teamId, member.apiKey, SEED_PASSCODE],
    );
  }

  for (const model of SEED_MODELS) {
    await db.query(
      `INSERT INTO models (slug, name, modality, unit, unit_label, input_schema, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, modality = EXCLUDED.modality, unit = EXCLUDED.unit,
         unit_label = EXCLUDED.unit_label, input_schema = EXCLUDED.input_schema, position = EXCLUDED.position`,
      [model.slug, model.name, model.modality, model.unit, model.unitLabel, JSON.stringify(model.schema), model.position],
    );
  }

  const seedRateInstant = localToInstant(
    { year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
    ORG_TIMEZONE,
  );
  if (seedRateInstant.kind !== 'ok') throw new Error('Cannot resolve the seed rate instant');
  for (const model of SEED_MODELS) {
    await db.query(
      `INSERT INTO rates (id, model_slug, micro_per_unit, effective_at, created_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [model.rateId, model.slug, String(model.microPerUnit), seedRateInstant.instant, 'm_june'],
    );
  }

  await db.query(
    `INSERT INTO policy_versions (version, document, saved_by, saved_at)
     VALUES (1, $1, $2, now()) ON CONFLICT (version) DO NOTHING`,
    [JSON.stringify(seedPolicy()), SEED_POLICY_AUTHOR],
  );

  for (const team of SEED_TEAMS) {
    await tx(async (client) => {
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM movements WHERE team_id = $1 AND kind = 'opening_grant'`,
        [team.id],
      );
      if (rows[0] && rows[0].count !== '0') return;
      await recordMovement(client, {
        teamId: team.id,
        kind: 'opening_grant',
        minus: 'funding',
        plus: 'available',
        amountMicro: BigInt(team.grantCredits) * MICRO_PER_CREDIT,
      });
    });
  }
}
