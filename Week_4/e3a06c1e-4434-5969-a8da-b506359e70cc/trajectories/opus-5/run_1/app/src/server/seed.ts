import { randomUUID } from 'node:crypto';
import { hashKeySecret, hashPassword, keyPrefix } from './auth.js';
import { query, queryOne } from './db/pool.js';
import { readWav } from './domain/audio.js';
import { currentPeriod } from './domain/quota.js';
import { parseSidecar } from './domain/sidecar.js';
import { replayAtOnce } from './engine.js';
import { objectExists, putObject, sessionKeys } from './services/storage.js';
import { seedOrgs, seedSessionAudio, seedSessions, SEED_PASSWORD, type SeedSession } from './seeddata.js';
import type { Plan } from '../shared/types.js';

const findProject = (orgId: string, name: string): Promise<{ id: string } | null> =>
  queryOne<{ id: string }>('select id from projects where org_id = $1 and name_folded = $2', [
    orgId,
    name.toLowerCase(),
  ]);

const seedOrganisations = async (): Promise<void> => {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const org of seedOrgs) {
    await query(
      'insert into orgs (id, name, slug, plan) values ($1, $2, $3, $4) on conflict (slug) do nothing',
      [randomUUID(), org.name, org.slug, org.plan],
    );
    const row = await queryOne<{ id: string }>('select id from orgs where slug = $1', [org.slug]);
    if (row === null) throw new Error(`seed organisation ${org.slug} missing`);

    for (const project of org.projects) {
      await query(
        `insert into projects (id, org_id, name, name_folded, monthly_quota_minutes)
         values ($1, $2, $3, $4, $5) on conflict (org_id, name_folded) do nothing`,
        [randomUUID(), row.id, project.name, project.name.toLowerCase(), project.quotaMinutes],
      );
      const projectRow = await findProject(row.id, project.name);
      if (projectRow === null) throw new Error(`seed project ${project.name} missing`);
      await query(
        `insert into api_keys (id, project_id, name, prefix, key_hash) values ($1, $2, $3, $4, $5)
         on conflict (key_hash) do nothing`,
        [
          randomUUID(),
          projectRow.id,
          project.keyName,
          keyPrefix(project.keySecret),
          hashKeySecret(project.keySecret),
        ],
      );
    }

    for (const member of org.members) {
      await query(
        `insert into members (id, org_id, name, email, role, password_hash) values ($1, $2, $3, $4, $5, $6)
         on conflict (lower(email)) do nothing`,
        [randomUUID(), row.id, member.name, member.email, member.role, passwordHash],
      );
      const memberRow = await queryOne<{ id: string }>('select id from members where lower(email) = lower($1)', [
        member.email,
      ]);
      if (memberRow === null) throw new Error(`seed member ${member.email} missing`);
      const names = member.projects === 'all' ? org.projects.map((project) => project.name) : member.projects;
      for (const name of names) {
        const projectRow = await findProject(row.id, name);
        if (projectRow === null) continue;
        await query(
          'insert into member_projects (member_id, project_id) values ($1, $2) on conflict do nothing',
          [memberRow.id, projectRow.id],
        );
      }
    }
  }
};

const seedOneSession = async (session: SeedSession): Promise<void> => {
  const org = await queryOne<{ id: string; plan: Plan }>('select id, plan from orgs where slug = $1', [
    session.orgSlug,
  ]);
  if (org === null) return;
  const project = await findProject(org.id, session.projectName);
  if (project === null) return;

  const existing = await queryOne<{ id: string; ended_at: Date | null }>(
    'select id, ended_at from sessions where project_id = $1 and label = $2',
    [project.id, session.label],
  );
  const period = currentPeriod(new Date());
  if (existing !== null) {
    if (existing.ended_at === null || existing.ended_at < period.start)
      await query('update sessions set ended_at = now() where id = $1', [existing.id]);
    return;
  }

  const key = await queryOne<{ id: string }>(
    'select id from api_keys where project_id = $1 order by created_at limit 1',
    [project.id],
  );
  const wav = seedSessionAudio(session);
  const info = readWav(wav);
  if (info === null) throw new Error(`seed audio for ${session.label} is not a readable WAV`);
  const cues = parseSidecar(session.sidecar);
  if (cues === null) throw new Error(`seed sidecar for ${session.label} is not valid WebVTT`);

  const sessionId = randomUUID();
  await query(
    `insert into sessions (id, project_id, org_id, kind, source, label, state, channels, plan, key_id, has_sidecar)
     values ($1, $2, $3, 'replay', 'upload', $4, 'connecting', $5, $6, $7, true)`,
    [sessionId, project.id, org.id, session.label, session.channels, org.plan, key?.id ?? null],
  );
  await replayAtOnce(
    {
      sessionId,
      projectId: project.id,
      orgId: org.id,
      channels: session.channels,
      plan: org.plan,
      source: 'upload',
      keyId: key?.id ?? null,
    },
    Buffer.from(wav.subarray(info.dataOffset, info.dataOffset + info.dataBytes)),
    cues,
  );
};

/** Seed audio and sidecars are uploaded whenever missing, retrying until storage is reachable. */
export const uploadSeedArtifacts = async (): Promise<void> => {
  for (const session of seedSessions) {
    const org = await queryOne<{ id: string }>('select id from orgs where slug = $1', [session.orgSlug]);
    if (org === null) continue;
    const project = await findProject(org.id, session.projectName);
    if (project === null) continue;
    const row = await queryOne<{ id: string }>('select id from sessions where project_id = $1 and label = $2', [
      project.id,
      session.label,
    ]);
    if (row === null) continue;
    const keys = sessionKeys(org.id, project.id, row.id);
    if (!(await objectExists(keys.upload))) await putObject(keys.upload, seedSessionAudio(session));
    if (!(await objectExists(keys.sidecar)))
      await putObject(keys.sidecar, Buffer.from(session.sidecar, 'utf8'));
  }
};

export const applySeed = async (): Promise<void> => {
  await seedOrganisations();
  for (const session of seedSessions) await seedOneSession(session);
  await uploadSeedArtifacts().catch(() => undefined);
};
