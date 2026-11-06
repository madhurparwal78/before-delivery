import { randomBytes, scryptSync } from 'node:crypto';
import type { PoolClient } from 'pg';
import { toFixed } from '../../domain/decimal';
import { dec } from '../../domain/decimal';
import { polygonArea } from '../../domain/geometry';
import { formatTimestamp } from '../../domain/time';
import { lockMigration, pool, unlockMigration, withClient } from './pool';
import { SCHEMA_SQL } from './schema';
import { SEED_ORG, SEED_PASSWORD, SEED_PEOPLE, SEED_PROJECTS, seedReadings } from './seed-data';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, expectedHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !expectedHex) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex');
  return derived.length === expectedHex.length && derived === expectedHex;
}

async function applySeedData(client: PoolClient): Promise<void> {
  await client.query('insert into orgs (id, name) values ($1, $2) on conflict (id) do update set name = excluded.name', [
    SEED_ORG.id,
    SEED_ORG.name,
  ]);

  for (const person of SEED_PEOPLE) {
    await client.query(
      `insert into people (id, org_id, name, email, password_hash, org_role)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set name = excluded.name, email = excluded.email,
         org_role = excluded.org_role`,
      [person.id, SEED_ORG.id, person.name, person.email, hashPassword(SEED_PASSWORD), person.orgRole],
    );
  }

  for (const project of SEED_PROJECTS) {
    await client.query(
      `insert into projects (slug, name, kind, code, floor_pct, buffer_pct, lead_person_id,
         boundary, boundary_area_m2)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (slug) do update set name = excluded.name, kind = excluded.kind,
         code = excluded.code, floor_pct = excluded.floor_pct, buffer_pct = excluded.buffer_pct,
         lead_person_id = excluded.lead_person_id, boundary = excluded.boundary,
         boundary_area_m2 = excluded.boundary_area_m2`,
      [
        project.slug,
        project.name,
        project.kind,
        project.code,
        project.floorPct,
        project.bufferPct,
        project.leadPersonId,
        JSON.stringify(project.boundary),
        polygonArea(project.boundary).toString(),
      ],
    );
    await client.query(
      'insert into figure_counters (project_slug, next_seq) values ($1, 1) on conflict do nothing',
      [project.slug],
    );
    for (const sensor of project.sensors) {
      await client.query(
        `insert into sensors (project_slug, id, kind, polygon) values ($1, $2, $3, $4)
         on conflict (project_slug, id) do update set kind = excluded.kind,
           polygon = excluded.polygon`,
        [project.slug, sensor.id, sensor.kind, JSON.stringify(sensor.polygon)],
      );
    }
  }

  const grantsApplied = await client.query('select 1 from seed_state where key = $1', ['grants']);
  if (grantsApplied.rowCount === 0) {
    for (const person of SEED_PEOPLE) {
      for (const grant of person.grants) {
        await client.query(
          `insert into project_grants (person_id, project_slug, role) values ($1, $2, $3)
           on conflict (person_id, project_slug) do nothing`,
          [person.id, grant.project, grant.role],
        );
      }
    }
    await client.query('insert into seed_state (key, applied_at) values ($1, now())', ['grants']);
  }

  for (const project of SEED_PROJECTS) {
    const key = `readings:${project.slug}`;
    const applied = await client.query('select 1 from seed_state where key = $1', [key]);
    if (applied.rowCount !== 0) continue;
    const readings = seedReadings(project.slug);
    const chunkSize = 500;
    for (let offset = 0; offset < readings.length; offset += chunkSize) {
      const chunk = readings.slice(offset, offset + chunkSize);
      const values: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((reading) => {
        const base = params.length;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
        params.push(
          project.slug,
          reading.sensorId,
          formatTimestamp(reading.intervalStartMs),
          toFixed(dec(reading.fc4, 4), 4),
          toFixed(dec(reading.fch44, 4), 4),
          reading.qc,
        );
      });
      if (values.length > 0) {
        await client.query(
          `insert into readings (project_slug, sensor_id, interval_start, fc, fch4, qc)
           values ${values.join(', ')} on conflict do nothing`,
          params,
        );
      }
    }
    await client.query('insert into seed_state (key, applied_at) values ($1, now())', [key]);
  }
}

async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/** Applies the schema and seed data; safe when two instances start at once. */
export async function migrateAndSeed(): Promise<void> {
  await waitForDatabase();
  await withClient(async (client) => {
    await lockMigration(client);
    try {
      await client.query(SCHEMA_SQL);
      await client.query('begin');
      try {
        await applySeedData(client);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    } finally {
      await unlockMigration(client);
    }
  });
}
