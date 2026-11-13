import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { withTransaction } from '../platform/db.js';
import type { DbClient } from '../platform/db.js';
import { hashPassword } from '../platform/crypto.js';
import { SCHEMA_SQL, SEED_SQL, SEARCH_REFRESH_SQL } from '../schema.js';
import type { ClaimInput } from '../domain/lifecycles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The body text the search index holds: markers replaced by claim text. */
export function searchableBody(body: string, claims: ClaimInput[] | null): string {
  return body.replace(/\[claim:([^\]]+)\]/g, (match, id: string) => {
    const claim = claims?.find((c) => c.id === id);
    return claim ? `${claim.text}` : match;
  });
}

/** Keep the search-index row for one content item in step with its state. */
export async function indexContentItem(client: DbClient, contentId: string): Promise<void> {
  const rows = await client.query<{
    kind: string;
    slug: string;
    title: string;
    summary: string;
    body: string;
    claims: unknown;
    published_at: Date | null;
    status: string;
  }>(
    `SELECT kind, slug, title, summary, body, claims, published_at, status
     FROM content_items WHERE id = $1`,
    [contentId],
  );
  const item = rows.rows[0];
  if (!item) return;
  if (item.status !== 'published') {
    await client.query(
      `UPDATE search_index SET live = false WHERE (kind = 'model' OR kind = 'news') AND ref_id = $1`,
      [contentId],
    );
    return;
  }
  const claims = Array.isArray(item.claims) ? (item.claims as ClaimInput[]) : null;
  const bodyText = searchableBody(item.body, claims);
  await client.query(
    `INSERT INTO search_index (kind, ref_id, title, summary, body, published_at, live)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT (kind, ref_id) DO UPDATE SET
       title = $3, summary = $4, body = $5, published_at = $6, live = true`,
    [item.kind, contentId, item.title, item.summary, bodyText, item.published_at],
  );
}

async function seedPasswordHash(): Promise<string> {
  // Staff passwords are set from the code so the seed stays free of hashes.
  return hashPassword('open-record-seed-2026');
}

export async function applySchema(): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(SCHEMA_SQL);
  });
}

export async function applySeed(): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(SEED_SQL);
    // Set real password hashes for staff whose hash is still a placeholder.
    const hash = await seedPasswordHash();
    await client.query(`UPDATE staff SET password_hash = $1 WHERE password_hash = 'seed'`, [hash]);
    // Grants: idempotent per (staff, role).
    const grants: Array<[string, string]> = [
      ['ines.halloran@aldermoor.example', 'editor'],
      ['tomas.reyes@aldermoor.example', 'editor'],
      ['tomas.reyes@aldermoor.example', 'approver'],
      ['eleni.marsh@aldermoor.example', 'approver'],
      ['kofi.brennan@aldermoor.example', 'approver'],
      ['sana.qadir@aldermoor.example', 'recruiter'],
      ['jules.okonkwo@aldermoor.example', 'recruiter'],
      ['ada.penrose@aldermoor.example', 'administrator'],
    ];
    for (const [email, role] of grants) {
      await client.query(
        `INSERT INTO grants (staff_email, role, granted_by, expires_at, version)
         SELECT $1, $2, 'ada.penrose@aldermoor.example', '2027-12-31T23:59:59Z', 1
         WHERE NOT EXISTS (
           SELECT 1 FROM grants g WHERE g.staff_email = $1 AND g.role = $2
         )`,
        [email, role],
      );
    }
    await refreshSearchIndex(client);
    // Index every published content item with its claim text expanded.
    const published = await client.query<{ id: string }>(
      `SELECT id FROM content_items WHERE status = 'published'`,
    );
    for (const row of published.rows) {
      await indexContentItem(client, row.id);
    }
  });
}

export async function refreshSearchIndex(client: import('../platform/db.js').DbClient): Promise<void> {
  await client.query(SEARCH_REFRESH_SQL);
}

export type SeedSampleSpec = {
  modelSlug: string;
  sampleId: string;
  kind: 'audio' | 'image_sequence';
  title: string;
  files: string[];
};

export function seededSamples(): SeedSampleSpec[] {
  return [
    { modelSlug: 'kestrel-2', sampleId: 'pitch-contour', kind: 'audio', title: 'Pitch contour study', files: ['clip.wav'] },
    { modelSlug: 'kestrel-2', sampleId: 'rhythm-continuation', kind: 'audio', title: 'Rhythm continuation study', files: ['clip.wav'] },
    {
      modelSlug: 'kestrel-2',
      sampleId: 'denoise-sequence',
      kind: 'image_sequence',
      title: 'Denoising sequence',
      files: Array.from({ length: 12 }, (_, i) => `frame-${String(i + 1).padStart(2, '0')}.png`),
    },
  ];
}
