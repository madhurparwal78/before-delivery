import { Router } from 'express';
import { pool } from '../db.js';
import { config } from '../config.js';
import { notFound, handle } from '../errors.js';
import { createSession } from '../auth.js';
import { hashToken, newId } from '../ids.js';
import { hashPasswordFor } from '../seed-helpers.js';
import { setOutage } from '../services.js';
import { indexRecipe } from '../search.js';
import { snapshotBody } from './snapshots.js';
import { putObject, storageUp } from '../services.js';
import { ttlSeconds } from '../config.js';

export const gradingRouter = Router();

interface SeedUser { key: string; email: string; password: string; displayName: string }
interface SeedTeam { key: string; name: string; owner: string; members: string[] }
interface SeedStep { op: string; args?: Record<string, unknown> }
interface SeedVersion { author: string; name: string; note?: string; tags?: string[]; steps: SeedStep[] }
interface SeedRecipe { key: string; owner: { user?: string; team?: string }; tags?: string[]; versions: SeedVersion[] }
interface SeedFile { key: string; owner: string; name: string; base64: string }
interface SeedSnapshot { key: string; owner: string; recipe?: string; version?: number; inputBase64?: string; fileKey?: string; outputBase64: string; ttl: string; createdAt?: string }
interface SeedBody {
  users?: SeedUser[];
  teams?: SeedTeam[];
  recipes?: SeedRecipe[];
  files?: SeedFile[];
  snapshots?: SeedSnapshot[];
}

gradingRouter.post('/seed', handle(async (req, res) => {
  const body = (req.body ?? {}) as SeedBody;
  const userBy = new Map<string, string>();
  const sessions: Record<string, { id: string; session: string }> = {};
  const teamBy = new Map<string, string>();
  const recipeBy = new Map<string, { id: string; latestVersion: number }>();
  const fileBy = new Map<string, { id: string }>();
  const snapshots: Record<string, { token: string; status: string; expiresAt: string }> = {};
  let storageOk = await storageUp();

  for (const u of body.users ?? []) {
    const id = newId('u');
    userBy.set(u.key, id);
    await pool.query(
      'INSERT INTO users (id, email, email_ci, display_name, password_hash, verified) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (email_ci) DO UPDATE SET display_name = EXCLUDED.display_name',
      [id, u.email.toLowerCase(), u.email.toLowerCase(), u.displayName, hashPasswordFor(u.password)],
    );
    const dupe = await pool.query<{ id: string }>('SELECT id FROM users WHERE email_ci = $1', [u.email.toLowerCase()]);
    const realId = dupe.rows[0]?.id ?? id;
    userBy.set(u.key, realId);
    sessions[u.key] = { id: realId, session: await createSession(realId) };
  }

  for (const t of body.teams ?? []) {
    const id = newId('t');
    teamBy.set(t.key, id);
    const ownerId = userBy.get(t.owner)!;
    await pool.query('INSERT INTO teams (id, name, owner_id) VALUES ($1, $2, $3)', [id, t.name, ownerId]);
    await pool.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, \'owner\') ON CONFLICT DO NOTHING', [id, ownerId]);
    for (const m of t.members ?? []) {
      const mid = userBy.get(m);
      if (mid) await pool.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, \'member\') ON CONFLICT DO NOTHING', [id, mid]);
    }
  }

  for (const r of body.recipes ?? []) {
    const id = newId('r');
    let n = 0;
    let lastTags: string[] = r.tags ?? [];
    let lastName = r.versions[0]?.name ?? r.key;
    const ownerUserId = r.owner.user ? userBy.get(r.owner.user)! : null;
    const ownerTeamId = r.owner.team ? teamBy.get(r.owner.team)! : null;
    await pool.query('INSERT INTO recipes (id, owner_type, owner_user_id, owner_team_id, current_version) VALUES ($1, $2, $3, $4, 0)', [
      id,
      ownerUserId ? 'user' : 'team',
      ownerUserId,
      ownerTeamId,
    ]);
    for (const v of r.versions) {
      n++;
      const authorId = userBy.get(v.author)!;
      const tags = v.tags ?? r.tags ?? [];
      const name = v.name;
      const note = v.note ?? '';
      await pool.query('INSERT INTO versions (recipe_id, n, name, note, tags, steps, author_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())', [
        id,
        n,
        name,
        note,
        JSON.stringify(tags),
        JSON.stringify(v.steps.map((s) => ({ op: s.op, args: s.args ?? {}, disabled: false, breakpoint: false }))),
        authorId,
      ]);
      lastName = name;
      lastTags = tags;
    }
    await pool.query('UPDATE recipes SET current_version = $2 WHERE id = $1', [id, n]);
    recipeBy.set(r.key, { id, latestVersion: n });
    const steps = r.versions[n - 1].steps.map((s) => ({ op: s.op, args: s.args ?? {}, disabled: false, breakpoint: false }));
    if (storageOk) {
      await indexRecipe({
        id,
        name: lastName,
        note: r.versions[n - 1].note ?? '',
        tags: lastTags,
        operations: steps.map((s) => s.op),
        argumentValues: [...new Set(steps.flatMap((s) => Object.values(s.args).map(String)))],
        ownerUserId,
        teamId: ownerTeamId,
        latestVersion: n,
        updatedAt: Math.floor(Date.now() / 1000),
      }).catch(() => undefined);
    }
  }

  for (const f of body.files ?? []) {
    const id = newId('f');
    const bytes = Buffer.from(f.base64, 'base64');
    if (storageOk) {
      try {
        await putObject(`files/${id}`, bytes, config().s3.bucket);
      } catch {
        storageOk = false;
      }
    }
    await pool.query('INSERT INTO files (id, owner_id, name, bytes, sha256) VALUES ($1, $2, $3, $4, $5)', [
      id,
      userBy.get(f.owner)!,
      f.name,
      bytes.length,
      hashToken(bytes.toString('hex')),
    ]);
    fileBy.set(f.key, { id });
  }

  for (const s of body.snapshots ?? []) {
    const token = newId('s').slice(2, 18) + Math.random().toString(36).slice(2, 8);
    const createdAt = s.createdAt ? new Date(s.createdAt) : new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlSeconds(s.ttl) * 1000);
    const recipe = s.recipe ? recipeBy.get(s.recipe) : undefined;
    let steps: unknown[] = [];
    let recipeName: string | null = null;
    let recipeVersion: number | null = null;
    if (recipe) {
      const v = await pool.query<{ steps: unknown[]; name: string }>('SELECT steps, name FROM versions WHERE recipe_id = $1 AND n = $2', [recipe.id, s.version ?? 1]);
      if (v.rows[0]) {
        steps = v.rows[0].steps;
        recipeName = v.rows[0].name;
        recipeVersion = s.version ?? 1;
      }
    }
    const inputBytes = s.inputBase64 ? Buffer.from(s.inputBase64, 'base64') : null;
    const fileRec = s.fileKey ? fileBy.get(s.fileKey) : undefined;
    const outputBytes = Buffer.from(s.outputBase64, 'base64');
    const stored = storageOk && (inputBytes !== null || fileRec !== undefined);
    await pool.query(
      `INSERT INTO snapshots (token, owner_id, recipe_id, recipe_version, recipe_name, steps, input_file_id, input_b64, input_bytes, output_file_id, output_b64, output_bytes, ttl, status, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        token,
        userBy.get(s.owner)!,
        recipe?.id ?? null,
        recipeVersion,
        recipeName,
        JSON.stringify(steps),
        stored ? (inputBytes ? `snapshots/${token}/input` : `files/${fileRec!.id}`) : null,
        stored ? null : s.inputBase64 ?? null,
        inputBytes?.length ?? 0,
        null,
        s.outputBase64,
        outputBytes.length,
        s.ttl,
        'pending',
        createdAt,
        expiresAt,
      ],
    );
    if (stored && inputBytes) {
      try {
        await putObject(`snapshots/${token}/input`, inputBytes, config().s3.bucket);
        await putObject(`snapshots/${token}/output`, outputBytes, config().s3.bucket);
        await pool.query('UPDATE snapshots SET input_file_id = $2, output_file_id = $3, input_b64 = NULL, output_b64 = NULL WHERE token = $1', [
          token,
          `snapshots/${token}/input`,
          `snapshots/${token}/output`,
        ]);
      } catch {
        storageOk = false;
      }
    }
    const bodyNow = await snapshotBody(token);
    snapshots[s.key] = {
      token,
      status: bodyNow?.status ?? 'pending',
      expiresAt: expiresAt.toISOString(),
    };
  }

  res.status(201).json({
    users: sessions,
    teams: Object.fromEntries([...teamBy].map(([k, id]) => [k, { id }])),
    recipes: Object.fromEntries(recipeBy),
    files: Object.fromEntries(fileBy),
    snapshots,
  });
}));

gradingRouter.post('/outage', handle(async (req, res) => {
  const body = req.body ?? {};
  const service = body.service;
  if (service !== 'minio' && service !== 'meilisearch' && service !== 'live') throw notFound();
  const down = body.down === true;
  await setOutage(service, down);
  res.json({ service, down });
}));
