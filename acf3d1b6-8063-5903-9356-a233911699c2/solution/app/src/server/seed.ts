import { RENDER_SECONDS, SEAT_CREDITS, generationCost, modelOf, planOf } from '../shared/catalog.js';
import { hashPassword } from './auth.js';
import type { CreditsService } from './credits.js';
import type { Client } from './database.js';

// Benchmark fixture accounts (brief: Seed data). The password is hashed like any other.
const SEED_PASSWORD = 'deku-demo-pw-2026';

interface SeedGeneration {
  by: string;
  project: string;
  model: 'vela-4.5' | 'vela-4-turbo' | 'vela-image-4';
  duration: number | null;
  imageCount: number | null;
  aspect: '16:9' | '9:16' | '1:1';
  prompt: string;
  at: string;
}

const WORKSPACES = [
  {
    name: 'Northlight Studio',
    plan: 'team' as const,
    at: '2026-09-14T09:00:00Z',
    people: [
      { email: 'owner@example.com', name: 'Mara Quinn', role: 'owner', at: '2026-09-14T09:00:00Z' },
      { email: 'member@example.com', name: 'Theo Park', role: 'member', at: '2026-09-15T10:30:00Z' },
    ],
    projects: [
      { name: 'Spring campaign', at: '2026-10-02T08:15:00Z' },
      { name: 'Brand film', at: '2026-10-06T13:40:00Z' },
    ],
    generations: [
      { by: 'owner@example.com', project: 'Spring campaign', model: 'vela-4.5', duration: 10, imageCount: null, aspect: '16:9',
        prompt: 'A paper boat drifting down a rain-soaked street at dusk, cinematic', at: '2026-10-20T14:10:00Z' },
      { by: 'member@example.com', project: 'Spring campaign', model: 'vela-image-4', duration: null, imageCount: 2, aspect: '1:1',
        prompt: 'A ceramic mug on a linen table in soft morning light', at: '2026-10-21T09:40:00Z' },
    ] as SeedGeneration[],
  },
  {
    name: "Ines Duarte's workspace",
    plan: 'standard' as const,
    at: '2026-09-20T16:20:00Z',
    people: [{ email: 'creator@example.com', name: 'Ines Duarte', role: 'owner', at: '2026-09-20T16:20:00Z' }],
    projects: [{ name: 'Music video', at: '2026-10-05T19:00:00Z' }],
    generations: [
      { by: 'creator@example.com', project: 'Music video', model: 'vela-4-turbo', duration: 5, imageCount: null, aspect: '9:16',
        prompt: 'Neon reflections on a wet dance floor, slow camera push', at: '2026-10-22T18:05:00Z' },
    ] as SeedGeneration[],
  },
];

/** Seeds the fixture workspaces once; a restart finds the first seeded account and changes nothing. */
export async function seed(client: Client, credits: CreditsService): Promise<void> {
  const seeded = await client.query(`SELECT 1 FROM users WHERE lower(email) = 'owner@example.com'`);
  if (seeded.rowCount) return;
  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const space of WORKSPACES) {
    const workspace = await client.query<{ id: string }>(
      'INSERT INTO workspaces (name, plan, created_at) VALUES ($1, $2, $3) RETURNING id',
      [space.name, space.plan, space.at],
    );
    const workspaceId = workspace.rows[0].id;
    const users = new Map<string, string>();
    for (const person of space.people) {
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (workspace_id, name, email, password_hash, role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [workspaceId, person.name, person.email, passwordHash, person.role, person.at],
      );
      users.set(person.email, user.rows[0].id);
      if (space.plan === 'team') {
        await credits.record(client, { workspaceId, kind: 'seat', amount: SEAT_CREDITS, userId: user.rows[0].id, createdAt: person.at });
      }
    }
    if (space.plan !== 'team') {
      await credits.record(client, {
        workspaceId,
        kind: 'plan',
        amount: planOf(space.plan).credits,
        userId: users.get(space.people[0].email)!,
        createdAt: space.at,
      });
    }
    const projects = new Map<string, string>();
    for (const project of space.projects) {
      const row = await client.query<{ id: string }>(
        'INSERT INTO projects (workspace_id, name, created_at) VALUES ($1, $2, $3) RETURNING id',
        [workspaceId, project.name, project.at],
      );
      projects.set(project.name, row.rows[0].id);
    }
    for (const g of space.generations) {
      const cost = generationCost(modelOf(g.model)!, g.duration, g.imageCount);
      const row = await client.query<{ id: string }>(
        `INSERT INTO generations
           (workspace_id, project_id, user_id, model, prompt, duration, image_count, aspect, cost, status, created_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ready', $10, $10::timestamptz + make_interval(secs => $11)) RETURNING id`,
        [workspaceId, projects.get(g.project), users.get(g.by), g.model, g.prompt, g.duration, g.imageCount, g.aspect, cost, g.at,
          RENDER_SECONDS],
      );
      await credits.record(client, {
        workspaceId,
        kind: 'charge',
        amount: -cost,
        userId: users.get(g.by)!,
        generationId: row.rows[0].id,
        createdAt: g.at,
      });
    }
  }
}
