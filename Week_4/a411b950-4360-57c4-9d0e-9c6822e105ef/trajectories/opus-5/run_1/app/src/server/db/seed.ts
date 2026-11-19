import { randomBytes, randomUUID } from 'node:crypto';
import { addMonths, businessMonth } from '../../shared/dates.ts';
import { LAYERS, type CreditType, type ProjectStatus, type Visibility } from '../../shared/projectStatus.ts';
import { renderReceipt } from '../services/emails.ts';
import { hashPassword } from '../services/auth.ts';
import { putObject } from '../services/storage.ts';
import { query, withTransaction } from './pool.ts';
import { SCHEMA_STATEMENTS } from './schema.ts';
import { synthesizeSeedStem } from './seedStems.ts';

const OPERATOR_EMAIL = 'operator@kettlehole.example';
const OPERATOR_PASSWORD = 'ladder-console-2026';
const SEED_TIME_ZONE = 'America/Toronto';

type SeedProject = {
  slug: string;
  title: string;
  credit_type: CreditType;
  credit_line: string;
  role: string;
  blurb: string;
  visibility: Visibility;
  status: ProjectStatus;
  position: number;
  thresholds: [number, number, number, number];
  tags: string[];
  withStems: boolean;
};

const SEED_PROJECTS: readonly SeedProject[] = [
  {
    slug: 'salt-flats-chase',
    title: 'Salt Flats Chase',
    credit_type: 'shipped',
    credit_line: 'Ferrous Run, Brackwater Games, 2025',
    role: 'Composer and audio implementer',
    blurb:
      'A pursuit cue that starts as tyre hum on a dry lake bed and ends as a four-layer chase. The stems were written to be stacked by the game, never crossfaded.',
    visibility: 'public',
    status: 'published',
    position: 1,
    thresholds: [0, 25, 50, 75],
    tags: ['chase', 'synth', 'adaptive'],
    withStems: true,
  },
  {
    slug: 'lantern-moth',
    title: 'Lantern Moth',
    credit_type: 'jam',
    credit_line: '48-hour jam build, 2026',
    role: 'Solo audio',
    blurb:
      'Written and implemented in a weekend for a game about a moth carrying a lamp. Everything here is one breath of air moving through tuned glass.',
    visibility: 'public',
    status: 'published',
    position: 2,
    thresholds: [0, 20, 45, 80],
    tags: ['ambient', 'jam'],
    withStems: true,
  },
  {
    slug: 'dredge-yard',
    title: 'Dredge Yard',
    credit_type: 'redesign',
    credit_line: 'Audio redesign of a public gameplay capture',
    role: 'Sound designer',
    blurb:
      'A full redesign of someone else\u2019s footage, rebuilt from recordings of a working dock. Each layer adds another machine to the yard.',
    visibility: 'public',
    status: 'published',
    position: 3,
    thresholds: [0, 25, 50, 75],
    tags: ['industrial', 'redesign'],
    withStems: true,
  },
  {
    slug: 'glasshouse',
    title: 'Glasshouse',
    credit_type: 'shipped',
    credit_line: 'Adaptive score for an unannounced title',
    role: 'Composer',
    blurb:
      'An adaptive score under NDA, scored for strings and tuned metal. The intensity ladder here follows a greenhouse filling with heat.',
    visibility: 'nda',
    status: 'published',
    position: 4,
    thresholds: [0, 30, 55, 85],
    tags: ['orchestral'],
    withStems: true,
  },
  {
    slug: 'kiln-interior',
    title: 'Kiln Interior',
    credit_type: 'redesign',
    credit_line: 'Work in progress',
    role: 'Sound designer',
    blurb: 'A room tone study inside a brick kiln. Still being cut, so nothing is mixed yet.',
    visibility: 'public',
    status: 'draft',
    position: 5,
    thresholds: [0, 25, 50, 75],
    tags: [],
    withStems: false,
  },
];

const SEED_LINK_TOKEN = 'glasshouse-seed-preview';
const SEED_LINK_EXPIRY = '2030-01-01T00:00:00.000Z';

async function markerIsNew(key: string): Promise<boolean> {
  const inserted = await query<{ key: string }>(
    `INSERT INTO seed_marker (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key`,
    [key],
  );
  return inserted.rows.length > 0;
}

export async function applySchema(): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await query(statement);
  }
}

async function seedSettingsAndOperator(): Promise<void> {
  await query(
    `INSERT INTO settings (id, time_zone, operator_email, cursor_key)
     VALUES (1, $1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [SEED_TIME_ZONE, OPERATOR_EMAIL, randomBytes(32).toString('base64url')],
  );
  if (await markerIsNew('operator')) {
    await query(
      `INSERT INTO operators (email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING`,
      [OPERATOR_EMAIL, hashPassword(OPERATOR_PASSWORD)],
    );
  }
}

async function seedProjects(): Promise<void> {
  for (const project of SEED_PROJECTS) {
    if (!(await markerIsNew(`project:${project.slug}`))) continue;
    await query(
      `INSERT INTO projects (id, slug, title, credit_type, credit_line, role, blurb, tags, visibility, position,
         threshold_bed, threshold_pulse, threshold_lead, threshold_stinger, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (slug) DO NOTHING`,
      [
        randomUUID(),
        project.slug,
        project.title,
        project.credit_type,
        project.credit_line,
        project.role,
        project.blurb,
        project.tags,
        project.visibility,
        project.position,
        project.thresholds[0],
        project.thresholds[1],
        project.thresholds[2],
        project.thresholds[3],
        project.status,
      ],
    );
  }
}

async function seedListeningLink(): Promise<void> {
  if (!(await markerIsNew('link:glasshouse-seed-preview'))) return;
  const project = await query<{ id: string }>(`SELECT id FROM projects WHERE slug = 'glasshouse'`);
  const projectId = project.rows[0]?.id;
  if (projectId === undefined) return;
  await query(
    `INSERT INTO listening_links (id, project_id, label, token, expires_at)
     VALUES ($1, $2, 'Seed preview', $3, $4) ON CONFLICT (token) DO NOTHING`,
    [randomUUID(), projectId, SEED_LINK_TOKEN, SEED_LINK_EXPIRY],
  );
}

async function seedMonths(): Promise<void> {
  if (!(await markerIsNew('production-months'))) return;
  const current = businessMonth(new Date(), SEED_TIME_ZONE);
  for (let offset = 1; offset <= 6; offset += 1) {
    await query(
      `INSERT INTO production_months (month, capacity) VALUES ($1, 2) ON CONFLICT (month) DO NOTHING`,
      [addMonths(current, offset)],
    );
  }
}

async function seedEnquiry(): Promise<void> {
  if (!(await markerIsNew('enquiry:ENQ-000001'))) return;
  await withTransaction(async (client) => {
    const id = randomUUID();
    const reference = 'ENQ-000001';
    const name = 'Imogen Hale';
    const email = 'imogen.hale@brackwater.example';
    const brief = 'Looking for an adaptive combat score for a roguelite with four intensity tiers.';
    await client.query(
      `INSERT INTO enquiries (id, reference, version, status, name, email, studio, brief, project_slug,
         triage_notes, fit_score, rate_floor_cents, sender_key, ip_key, pacing_policy)
       VALUES ($1,$2,1,'new',$3,$4,'Brackwater Games',$5,'', 'SEED-PRIVATE-NOTE budget looks thin', 3, 800000,
         $6, 'seed', 'seed')`,
      [id, reference, name, email, brief, email.toLowerCase()],
    );
    await client.query(`SELECT setval('enquiry_reference_seq', 1, true)`);
    const message = renderReceipt({ name, email, reference, brief, queuedAt: new Date() });
    await client.query(
      `INSERT INTO mail_queue (id, kind, enquiry_id, reference, to_address, message, state, hold_seconds, sent_at)
       VALUES ($1, 'receipt', $2, $3, $4, $5, 'sent', 10, now())
       ON CONFLICT (kind, enquiry_id) DO NOTHING`,
      [randomUUID(), id, reference, message.to, message.bytes],
    );
  });
}

async function seedStemObjects(): Promise<boolean> {
  const projects = await query<{ id: string; slug: string }>(
    `SELECT id, slug FROM projects WHERE slug = ANY($1::text[])`,
    [SEED_PROJECTS.filter((project) => project.withStems).map((project) => project.slug)],
  );
  let complete = true;
  for (const project of projects.rows) {
    for (const layer of LAYERS) {
      const marker = `stem:${project.slug}:${layer}`;
      const existing = await query<{ key: string }>(`SELECT key FROM seed_marker WHERE key = $1`, [marker]);
      if (existing.rows.length > 0) continue;
      const stemId = randomUUID();
      const objectKey = `projects/${project.id}/stems/${stemId}.wav`;
      const stem = synthesizeSeedStem(project.slug, layer);
      try {
        await putObject(objectKey, stem.bytes, 'audio/wav');
      } catch {
        complete = false;
        continue;
      }
      await query(
        `INSERT INTO stems (id, project_id, layer, format, bytes, duration_ms, object_key)
         VALUES ($1,$2,$3,'wav',$4,$5,$6)
         ON CONFLICT (project_id, layer) DO NOTHING`,
        [stemId, project.id, layer, stem.bytes.byteLength, stem.durationMs, objectKey],
      );
      await query(`INSERT INTO seed_marker (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, [marker]);
    }
  }
  return complete;
}

export async function applySeedData(): Promise<void> {
  await seedSettingsAndOperator();
  await seedProjects();
  await seedListeningLink();
  await seedMonths();
  await seedEnquiry();
}

/** Keeps trying until every seed stem object is stored. */
export function startSeedStemWorker(): void {
  const attempt = async (): Promise<void> => {
    const complete = await seedStemObjects();
    if (!complete) {
      const timer = setTimeout(() => void attempt().catch(() => undefined), 10_000);
      timer.unref();
    }
  };
  void attempt().catch(() => {
    const timer = setTimeout(() => void attempt().catch(() => undefined), 10_000);
    timer.unref();
  });
}
