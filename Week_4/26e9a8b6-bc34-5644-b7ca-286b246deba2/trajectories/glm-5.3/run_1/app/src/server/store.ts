// Data access for guides, steps, parts, versions, forks, likes, questions and collections.

import type { PoolClient } from 'pg';
import type { Db } from './db';
import { newId, slugify } from './ids';
import type { WorkingJson, WorkingModel, WorkingPart, WorkingStep, Camera, Callout } from '../shared/working';
import { formatCost as costFormat, type CurrencyCode } from '../shared/cost';
import type { Phase } from '../shared/phase';
import { bumpFieldRevision, ensureFieldRevision } from './domain';
import { guideTotal } from '../shared/working';

export interface GuideRow {
  id: string;
  slug: string;
  title: string;
  owner_id: string;
  state: 'draft' | 'published' | 'withdrawn';
  visibility: 'public' | 'private';
  currency: CurrencyCode;
  revision: number;
  latest_version: number | null;
  published_version: number | null;
  model_id: string | null;
  forked_from_guide_id: string | null;
  forked_from_title: string | null;
  forked_from_author: string | null;
  forked_from_version: number | null;
}

export interface AccountRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  confirmed: boolean;
}

export interface QuestionRow {
  id: string;
  guide_id: string;
  step: number;
  text: string;
  asked_by: string;
  asked_at: Date;
  answer: string | null;
  answered_by: string | null;
  answered_at: Date | null;
}

export class Store {
  constructor(private db: Db) {}

  // ---- accounts -------------------------------------------------------

  async accountById(id: string): Promise<AccountRow | null> {
    return this.db.one<AccountRow>('SELECT id, name, email, password_hash, confirmed FROM accounts WHERE id = $1', [id]);
  }

  async accountByEmail(email: string): Promise<AccountRow | null> {
    return this.db.one<AccountRow>('SELECT id, name, email, password_hash, confirmed FROM accounts WHERE email = $1', [email]);
  }

  async accountName(id: string): Promise<string | null> {
    const row = await this.db.one<{ name: string }>('SELECT name FROM accounts WHERE id = $1', [id]);
    return row?.name ?? null;
  }

  async createAccount(client: PoolClient, name: string, email: string, passwordHash: string): Promise<AccountRow> {
    const id = newId('usr');
    const result = await client.query<AccountRow>(
      'INSERT INTO accounts (id, name, email, password_hash, confirmed) VALUES ($1, $2, $3, $4, false) RETURNING id, name, email, password_hash, confirmed',
      [id, name, email, passwordHash],
    );
    return result.rows[0];
  }

  async confirmAccount(id: string): Promise<void> {
    await this.db.query('UPDATE accounts SET confirmed = true WHERE id = $1', [id]);
  }

  // ---- sessions -------------------------------------------------------

  async createSession(client: PoolClient, accountId: string, token: string): Promise<void> {
    await client.query('INSERT INTO sessions (token, account_id) VALUES ($1, $2)', [token, accountId]);
  }

  async sessionAccount(token: string): Promise<AccountRow | null> {
    const row = await this.db.one<AccountRow>(
      'SELECT a.id, a.name, a.email, a.password_hash, a.confirmed FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = $1',
      [token],
    );
    return row ?? null;
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token = $1', [token]);
  }

  // ---- confirm tokens ---------------------------------------------------

  async storeConfirmToken(client: PoolClient, accountId: string, token: string): Promise<void> {
    await client.query('DELETE FROM confirm_tokens WHERE account_id = $1', [accountId]);
    await client.query('INSERT INTO confirm_tokens (token, account_id) VALUES ($1, $2)', [token, accountId]);
  }

  async confirmToken(token: string): Promise<{ account_id: string; sent_at: Date; used_at: Date | null } | null> {
    return this.db.one('SELECT account_id, sent_at, used_at FROM confirm_tokens WHERE token = $1', [token]);
  }

  async useConfirmToken(token: string): Promise<void> {
    await this.db.query('UPDATE confirm_tokens SET used_at = now() WHERE token = $1', [token]);
  }

  // ---- guides -----------------------------------------------------------

  async guideById(id: string): Promise<GuideRow | null> {
    return this.db.one<GuideRow>(
      'SELECT id, slug, title, owner_id, state, visibility, currency, revision, latest_version, published_version, model_id, forked_from_guide_id, forked_from_title, forked_from_author, forked_from_version FROM guides WHERE id = $1',
      [id],
    );
  }

  async guideBySlug(slug: string): Promise<GuideRow | null> {
    return this.db.one<GuideRow>(
      'SELECT id, slug, title, owner_id, state, visibility, currency, revision, latest_version, published_version, model_id, forked_from_guide_id, forked_from_title, forked_from_author, forked_from_version FROM guides WHERE slug = $1',
      [slug],
    );
  }

  async isCoauthor(guideId: string, accountId: string): Promise<boolean> {
    const row = await this.db.one('SELECT 1 FROM coauthors WHERE guide_id = $1 AND account_id = $2', [guideId, accountId]);
    return row !== null;
  }

  async slugTaken(slug: string): Promise<boolean> {
    const row = await this.db.one('SELECT 1 FROM guides WHERE slug = $1', [slug]);
    return row !== null;
  }

  async uniqueSlug(title: string): Promise<string> {
    const base = slugify(title);
    for (let n = 0; n < 1000; n++) {
      const candidate = n === 0 ? base : `${base}-${n + 1}`;
      if (!(await this.slugTaken(candidate))) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  async createGuide(client: PoolClient, owner: string, title: string, currency: CurrencyCode): Promise<GuideRow> {
    const id = newId('gde');
    const slug = await this.uniqueSlug(title);
    const result = await client.query<GuideRow>(
      `INSERT INTO guides (id, slug, title, owner_id, state, visibility, currency)
       VALUES ($1, $2, $3, $4, 'draft', 'public', $5)
       RETURNING id, slug, title, owner_id, state, visibility, currency, revision, latest_version, published_version, model_id, forked_from_guide_id, forked_from_title, forked_from_author, forked_from_version`,
      [id, slug, title, owner, currency],
    );
    return result.rows[0];
  }

  async deleteGuide(guideId: string): Promise<void> {
    await this.db.tx(async (client) => {
      await client.query('DELETE FROM guides WHERE id = $1', [guideId]);
    });
  }

  async tags(guideId: string): Promise<string[]> {
    const result = await this.db.query<{ tag: string }>('SELECT tag FROM guide_tags WHERE guide_id = $1 ORDER BY tag', [guideId]);
    return result.rows.map((row) => row.tag);
  }

  async setTags(client: PoolClient, guideId: string, tags: string[]): Promise<void> {
    await client.query('DELETE FROM guide_tags WHERE guide_id = $1', [guideId]);
    for (const tag of tags) {
      await client.query('INSERT INTO guide_tags (guide_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guideId, tag]);
    }
  }

  // ---- steps and parts --------------------------------------------------

  async steps(guideId: string): Promise<WorkingStep[]> {
    const result = await this.db.query<{ id: string; position: number; title: string; text: string; phase: Phase; explode: number; focus_parts: string[]; camera: Camera }>(
      'SELECT id, position, title, text, phase, explode, focus_parts, camera FROM steps WHERE guide_id = $1 ORDER BY position',
      [guideId],
    );
    return result.rows.map((row, index) => ({
      id: row.id,
      number: index + 1,
      title: row.title,
      text: row.text,
      phase: row.phase,
      explode: row.explode,
      focus_parts: row.focus_parts ?? [],
      camera: row.camera,
      callouts: [],
    }));
  }

  async stepCallouts(guideId: string): Promise<Map<string, Callout[]>> {
    // Callouts live in a separate table keyed by step.
    const result = await this.db.query<{ step_id: string; part_id: string; text: string; position: number }>(
      'SELECT step_id, part_id, text, position FROM callouts WHERE guide_id = $1 ORDER BY step_id, position',
      [guideId],
    );
    const map = new Map<string, Callout[]>();
    for (const row of result.rows) {
      const list = map.get(row.step_id) ?? [];
      list.push({ part_id: row.part_id, text: row.text });
      map.set(row.step_id, list);
    }
    return map;
  }

  async parts(guideId: string): Promise<WorkingPart[]> {
    const result = await this.db.query<{ id: string; name: string; node_path: string; unbound: boolean; axis: 'x' | 'y' | 'z'; apart_mm: number; quantity: number; unit_price: string | number; fitted_at: string | null; position: number }>(
      'SELECT id, name, node_path, unbound, axis, apart_mm, quantity, unit_price, fitted_at, position FROM parts WHERE guide_id = $1 ORDER BY position',
      [guideId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      node_path: row.node_path,
      unbound: row.unbound,
      axis: row.axis,
      apart_mm: row.apart_mm,
      quantity: row.quantity,
      unit_price: Number(row.unit_price),
      fitted_at: row.fitted_at,
    }));
  }

  async addStep(client: PoolClient, guideId: string, title: string): Promise<{ id: string; number: number; revision: number }> {
    const position = await this.nextStepPosition(client, guideId);
    const id = newId('stp');
    await client.query(
      `INSERT INTO steps (id, guide_id, position, title, text, phase, explode, focus_parts, camera)
       VALUES ($1, $2, $3, $4, '', 'open_up', 0, '[]'::jsonb, $5::jsonb)`,
      [id, guideId, position, title, JSON.stringify({ yaw: 30, pitch: 15, zoom: 1 })],
    );
    await ensureFieldRevision(client, guideId, `step/${id}/title`);
    await ensureFieldRevision(client, guideId, `step/${id}/text`);
    await ensureFieldRevision(client, guideId, `step/${id}/phase`);
    await ensureFieldRevision(client, guideId, `step/${id}/explode`);
    await ensureFieldRevision(client, guideId, `step/${id}/focus_parts`);
    await ensureFieldRevision(client, guideId, `step/${id}/camera`);
    await ensureFieldRevision(client, guideId, `step/${id}/callouts`);
    const revision = await this.bumpRevision(client, guideId);
    return { id, number: position + 1, revision };
  }

  private async nextStepPosition(client: PoolClient, guideId: string): Promise<number> {
    const row = await client.query<{ next: number }>('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM steps WHERE guide_id = $1', [guideId]);
    return row.rows[0].next;
  }

  async deleteStep(client: PoolClient, guideId: string, stepId: string): Promise<number> {
    await client.query('UPDATE parts SET fitted_at = NULL WHERE guide_id = $1 AND fitted_at = $2', [guideId, stepId]);
    await client.query('DELETE FROM steps WHERE guide_id = $1 AND id = $2', [guideId, stepId]);
    await this.renumberSteps(client, guideId);
    await client.query('DELETE FROM field_revisions WHERE guide_id = $1 AND field_path LIKE $2', [guideId, `step/${stepId}/%`]);
    const revision = await this.bumpRevision(client, guideId);
    return revision;
  }

  async renumberSteps(client: PoolClient, guideId: string): Promise<void> {
    await client.query(
      `WITH ordered AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY position) - 1 AS pos
         FROM steps WHERE guide_id = $1
       )
       UPDATE steps s SET position = ordered.pos FROM ordered WHERE s.id = ordered.id`,
      [guideId],
    );
  }

  async moveStep(client: PoolClient, guideId: string, stepId: string, position: number): Promise<string[]> {
    const count = await this.stepCount(guideId);
    if (position < 0 || position >= count) return [];
    const current = await this.db.one<{ position: number }>('SELECT position FROM steps WHERE guide_id = $1 AND id = $2', [guideId, stepId]);
    if (!current) return [];
    if (current.position < position) {
      await client.query('UPDATE steps SET position = position - 1 WHERE guide_id = $1 AND position > $2 AND position <= $3', [guideId, current.position, position]);
    } else {
      await client.query('UPDATE steps SET position = position + 1 WHERE guide_id = $1 AND position >= $2 AND position < $3', [guideId, position, current.position]);
    }
    await client.query('UPDATE steps SET position = $2 WHERE guide_id = $1 AND id = $3', [guideId, position, stepId]);
    const order = await this.orderedStepIds(client, guideId);
    return order;
  }

  private async orderedStepIds(client: PoolClient, guideId: string): Promise<string[]> {
    const result = await client.query<{ id: string }>('SELECT id FROM steps WHERE guide_id = $1 ORDER BY position', [guideId]);
    return result.rows.map((row) => row.id);
  }

  async stepCount(guideId: string): Promise<number> {
    const row = await this.db.one<{ count: number }>('SELECT COUNT(*)::int AS count FROM steps WHERE guide_id = $1', [guideId]);
    return row?.count ?? 0;
  }

  async deletePart(client: PoolClient, guideId: string, partId: string): Promise<number> {
    await client.query('DELETE FROM parts WHERE guide_id = $1 AND id = $2', [guideId, partId]);
    await client.query('DELETE FROM field_revisions WHERE guide_id = $1 AND field_path LIKE $2', [guideId, `part/${partId}/%`]);
    const revision = await this.bumpRevision(client, guideId);
    return revision;
  }

  async partById(guideId: string, partId: string): Promise<WorkingPart | null> {
    const row = await this.db.one<{ id: string; name: string; node_path: string; unbound: boolean; axis: 'x' | 'y' | 'z'; apart_mm: number; quantity: number; unit_price: string | number; fitted_at: string | null; position: number }>(
      'SELECT id, name, node_path, unbound, axis, apart_mm, quantity, unit_price, fitted_at, position FROM parts WHERE guide_id = $1 AND id = $2',
      [guideId, partId],
    );
    if (!row) return null;
    return {
      id: row.id, name: row.name, node_path: row.node_path, unbound: row.unbound,
      axis: row.axis, apart_mm: row.apart_mm, quantity: row.quantity,
      unit_price: Number(row.unit_price), fitted_at: row.fitted_at,
    };
  }

  async stepById(guideId: string, stepId: string): Promise<WorkingStep | null> {
    const row = await this.db.one<{ id: string; position: number; title: string; text: string; phase: Phase; explode: number; focus_parts: string[]; camera: Camera }>(
      'SELECT id, position, title, text, phase, explode, focus_parts, camera FROM steps WHERE guide_id = $1 AND id = $2',
      [guideId, stepId],
    );
    if (!row) return null;
    return {
      id: row.id, number: row.position + 1, title: row.title, text: row.text,
      phase: row.phase, explode: row.explode, focus_parts: row.focus_parts ?? [],
      camera: row.camera, callouts: [],
    };
  }

  async calloutsByStep(guideId: string, stepId: string): Promise<Callout[]> {
    const result = await this.db.query<{ part_id: string; text: string }>(
      'SELECT part_id, text FROM callouts WHERE guide_id = $1 AND step_id = $2 ORDER BY position',
      [guideId, stepId],
    );
    return result.rows.map((row) => ({ part_id: row.part_id, text: row.text }));
  }

  async setStepCallouts(client: PoolClient, guideId: string, stepId: string, callouts: Callout[]): Promise<void> {
    await client.query('DELETE FROM callouts WHERE guide_id = $1 AND step_id = $2', [guideId, stepId]);
    for (const [index, callout] of callouts.entries()) {
      await client.query(
        'INSERT INTO callouts (guide_id, step_id, part_id, text, position) VALUES ($1, $2, $3, $4, $5)',
        [guideId, stepId, callout.part_id, callout.text, index],
      );
    }
  }

  private async bumpRevision(client: PoolClient, guideId: string): Promise<number> {
    const result = await client.query<{ revision: number }>('UPDATE guides SET revision = revision + 1 WHERE id = $1 RETURNING revision', [guideId]);
    return result.rows[0].revision;
  }

  async fieldRevisions(guideId: string): Promise<Record<string, number>> {
    const result = await this.db.query<{ field_path: string; revision: number }>(
      'SELECT field_path, revision FROM field_revisions WHERE guide_id = $1',
      [guideId],
    );
    const out: Record<string, number> = {};
    for (const row of result.rows) out[row.field_path] = row.revision;
    return out;
  }

  // ---- working copy -----------------------------------------------------

  async workingJson(guide: GuideRow): Promise<WorkingJson> {
    const [steps, parts, calloutsByStep, tags, model, fieldRevisions] = await Promise.all([
      this.steps(guide.id),
      this.parts(guide.id),
      this.stepCallouts(guide.id),
      this.tags(guide.id),
      this.modelRow(guide.id),
      this.fieldRevisions(guide.id),
    ]);
    return this.assembleWorking(guide, steps, parts, calloutsByStep, tags, model, fieldRevisions);
  }

  /** The working copy computed inside the caller's transaction, after a commit. */
  async workingJsonTx(client: PoolClient, guide: GuideRow): Promise<WorkingJson> {
    const steps = await this.stepsTx(client, guide.id);
    const parts = await this.partsTx(client, guide.id);
    const calloutsByStep = new Map<string, Callout[]>();
    const callouts = await client.query<{ step_id: string; part_id: string; text: string }>(
      'SELECT step_id, part_id, text FROM callouts WHERE guide_id = $1 ORDER BY step_id, position',
      [guide.id],
    );
    for (const row of callouts.rows) {
      const list = calloutsByStep.get(row.step_id) ?? [];
      list.push({ part_id: row.part_id, text: row.text });
      calloutsByStep.set(row.step_id, list);
    }
    const tags = await client.query<{ tag: string }>('SELECT tag FROM guide_tags WHERE guide_id = $1 ORDER BY tag', [guide.id]);
    const guideRow = await client.query<{ revision: number; latest_version: number | null }>(
      'SELECT revision, latest_version FROM guides WHERE id = $1', [guide.id],
    );
    const model = await client.query<{ model_id: string; bytes: number; sha256: string; bbox_mm: [number, number, number]; scale: number; scale_confirmed: boolean }>(
      'SELECT m.id AS model_id, m.bytes, m.sha256, m.bbox_mm, m.scale, m.scale_confirmed FROM guides g JOIN models m ON m.id = g.model_id WHERE g.id = $1',
      [guide.id],
    );
    const fieldRevisions = await client.query<{ field_path: string; revision: number }>(
      'SELECT field_path, revision FROM field_revisions WHERE guide_id = $1', [guide.id],
    );
    const revisions: Record<string, number> = {};
    for (const row of fieldRevisions.rows) revisions[row.field_path] = row.revision;
    const modelRow = model.rows[0]
      ? { id: model.rows[0].model_id, state: 'stored' as const, bytes: model.rows[0].bytes, sha256: model.rows[0].sha256, bbox_mm: model.rows[0].bbox_mm, scale: model.rows[0].scale, scale_confirmed: model.rows[0].scale_confirmed }
      : null;
    return this.assembleWorking(
      { ...guide, revision: guideRow.rows[0]?.revision ?? guide.revision, latest_version: guideRow.rows[0]?.latest_version ?? guide.latest_version },
      steps, parts, calloutsByStep, tags.rows.map((row) => row.tag), modelRow, revisions,
    );
  }

  private assembleWorking(
    guide: GuideRow,
    steps: WorkingStep[],
    parts: WorkingPart[],
    calloutsByStep: Map<string, Callout[]>,
    tags: string[],
    model: WorkingModel | null,
    fieldRevisions: Record<string, number>,
  ): WorkingJson {
    for (const step of steps) {
      step.callouts = calloutsByStep.get(step.id) ?? [];
    }
    const total = guideTotal(steps, parts);
    return {
      id: guide.id,
      slug: guide.slug,
      title: guide.title,
      state: guide.state,
      visibility: guide.visibility,
      currency: guide.currency,
      tags,
      revision: guide.revision,
      latest_version: guide.latest_version,
      guide_total: total,
      guide_total_text: costFormat(total, guide.currency),
      field_revisions: fieldRevisions,
      model,
      parts,
      steps,
      forked_from: guide.forked_from_guide_id
        ? { guide_id: guide.forked_from_guide_id, title: guide.forked_from_title ?? '', author_name: guide.forked_from_author ?? '', version: guide.forked_from_version ?? 0 }
        : null,
    };
  }

  private async stepsTx(client: PoolClient, guideId: string): Promise<WorkingStep[]> {
    const result = await client.query<{ id: string; position: number; title: string; text: string; phase: Phase; explode: number; focus_parts: string[]; camera: Camera }>(
      'SELECT id, position, title, text, phase, explode, focus_parts, camera FROM steps WHERE guide_id = $1 ORDER BY position',
      [guideId],
    );
    return result.rows.map((row, index) => ({
      id: row.id,
      number: index + 1,
      title: row.title,
      text: row.text,
      phase: row.phase,
      explode: row.explode,
      focus_parts: row.focus_parts ?? [],
      camera: row.camera,
      callouts: [],
    }));
  }

  private async partsTx(client: PoolClient, guideId: string): Promise<WorkingPart[]> {
    const result = await client.query<{ id: string; name: string; node_path: string; unbound: boolean; axis: 'x' | 'y' | 'z'; apart_mm: number; quantity: number; unit_price: string | number; fitted_at: string | null; position: number }>(
      'SELECT id, name, node_path, unbound, axis, apart_mm, quantity, unit_price, fitted_at, position FROM parts WHERE guide_id = $1 ORDER BY position',
      [guideId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      node_path: row.node_path,
      unbound: row.unbound,
      axis: row.axis,
      apart_mm: row.apart_mm,
      quantity: row.quantity,
      unit_price: Number(row.unit_price),
      fitted_at: row.fitted_at,
    }));
  }

  async modelRow(guideId: string): Promise<WorkingModel | null> {
    const row = await this.db.one<{ model_id: string; bytes: number; sha256: string; bbox_mm: [number, number, number]; scale: number; scale_confirmed: boolean }>(
      `SELECT m.id AS model_id, m.bytes, m.sha256, m.bbox_mm, m.scale, m.scale_confirmed
       FROM guides g JOIN models m ON m.id = g.model_id WHERE g.id = $1`,
      [guideId],
    );
    if (!row) return null;
    return {
      id: row.model_id, state: 'stored', bytes: row.bytes, sha256: row.sha256,
      bbox_mm: row.bbox_mm, scale: row.scale, scale_confirmed: row.scale_confirmed,
    };
  }

  // ---- versions ---------------------------------------------------------

  async saveVersion(client: PoolClient, guide: GuideRow, savedBy: string, restoredFrom: number | null): Promise<number> {
    const [steps, parts, calloutsByStep] = await Promise.all([
      this.steps(guide.id),
      this.parts(guide.id),
      this.stepCallouts(guide.id),
    ]);
    for (const step of steps) step.callouts = calloutsByStep.get(step.id) ?? [];
    const number = (guide.latest_version ?? 0) + 1;
    const partsCost = guideTotal(steps, parts);
    await client.query(
      `INSERT INTO versions (guide_id, number, saved_by, restored_from, steps, parts, model_id, parts_cost)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [guide.id, number, savedBy, restoredFrom, JSON.stringify(steps), JSON.stringify(parts), guide.model_id, partsCost],
    );
    await client.query('UPDATE guides SET latest_version = $2 WHERE id = $1', [guide.id, number]);
    return number;
  }

  async versions(guideId: string, cursor: string | null, limit: number): Promise<{ items: VersionItem[]; nextCursor: string | null }> {
    // Newest first, paged by version number as the opaque cursor.
    const max = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8')) : 2147483647;
    const boundary = Number.isFinite(max) ? max : 2147483647;
    const result = await this.db.query<VersionRow>(
      `SELECT v.number, v.saved_at, v.saved_by, v.restored_from, v.steps, v.parts, v.parts_cost
       FROM versions v WHERE v.guide_id = $1 AND v.number < $2
       ORDER BY v.number DESC LIMIT $3`,
      [guideId, boundary, limit],
    );
    const items: VersionItem[] = [];
    for (const row of result.rows) {
      const steps = row.steps as WorkingStep[];
      items.push({
        number: row.number,
        saved_at: row.saved_at.toISOString(),
        saved_by: await this.accountName(row.saved_by) ?? row.saved_by,
        restored_from: row.restored_from,
        step_count: steps.length,
        parts_cost: Number(row.parts_cost),
        parts_cost_text: '',
      });
    }
    const nextCursor = result.rows.length === limit
      ? Buffer.from(String(result.rows[result.rows.length - 1].number), 'utf8').toString('base64url')
      : null;
    return { items, nextCursor };
  }

  async versionRow(guideId: string, number: number): Promise<VersionRow | null> {
    return this.db.one<VersionRow>(
      'SELECT guide_id, number, saved_at, saved_by, restored_from, steps, parts, model_id, parts_cost FROM versions WHERE guide_id = $1 AND number = $2',
      [guideId, number],
    );
  }

  async restoreVersion(client: PoolClient, guide: GuideRow, version: VersionRow, restoredBy: string): Promise<{ number: number; restoredFrom: number }> {
    // Make the working copy equal to the chosen version, then append it as a new version.
    const steps = version.steps as WorkingStep[];
    const parts = version.parts as WorkingPart[];
    await client.query('DELETE FROM callouts WHERE guide_id = $1', [guide.id]);
    await client.query('DELETE FROM steps WHERE guide_id = $1', [guide.id]);
    for (const [index, step] of steps.entries()) {
      await client.query(
        `INSERT INTO steps (id, guide_id, position, title, text, phase, explode, focus_parts, camera)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
         ON CONFLICT (guide_id, id) DO UPDATE SET position = $3, title = $4, text = $5, phase = $6, explode = $7, focus_parts = $8, camera = $9`,
        [step.id, guide.id, index, step.title, step.text, step.phase, step.explode, JSON.stringify(step.focus_parts), JSON.stringify(step.camera)],
      );
      for (const [calloutIndex, callout] of (step.callouts ?? []).entries()) {
        await client.query(
          'INSERT INTO callouts (guide_id, step_id, part_id, text, position) VALUES ($1, $2, $3, $4, $5)',
          [guide.id, step.id, callout.part_id, callout.text, calloutIndex],
        );
      }
    }
    await client.query('DELETE FROM parts WHERE guide_id = $1', [guide.id]);
    for (const part of parts) {
      await client.query(
        `INSERT INTO parts (id, guide_id, name, node_path, unbound, axis, apart_mm, quantity, unit_price, fitted_at, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET name = $3, node_path = $4, unbound = $5, axis = $6, apart_mm = $7, quantity = $8, unit_price = $9, fitted_at = $10`,
        [part.id, guide.id, part.name, part.node_path, part.unbound, part.axis, part.apart_mm, part.quantity, part.unit_price, part.fitted_at, 0],
      );
    }
    await client.query('UPDATE guides SET model_id = $2 WHERE id = $1', [guide.id, version.model_id]);
    const number = (guide.latest_version ?? 0) + 1;
    await client.query(
      `INSERT INTO versions (guide_id, number, saved_by, restored_from, steps, parts, model_id, parts_cost)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [guide.id, number, restoredBy, version.number, JSON.stringify(steps), JSON.stringify(parts), version.model_id, Number(version.parts_cost)],
    );
    await client.query('UPDATE guides SET latest_version = $2 WHERE id = $1', [guide.id, number]);
    return { number, restoredFrom: version.number };
  }

  // ---- questions ----------------------------------------------------------

  async questions(guideId: string, cursor: string | null, limit: number): Promise<{ items: QuestionJson[]; nextCursor: string | null }> {
    const after = cursor ? decodeCursor(cursor) : { id: '', time: 0 };
    const result = await this.db.query<{ id: string; step: number; text: string; asked_by: string; asked_at: Date; answer: string | null; answered_by: string | null; answered_at: Date | null }>(
      `SELECT q.id, q.step, q.text, q.asked_by, q.asked_at, q.answer, q.answered_by, q.answered_at
       FROM questions q
       WHERE q.guide_id = $1 AND (q.asked_at, q.id) < ($2::timestamptz, $3)
       ORDER BY q.asked_at DESC, q.id DESC LIMIT $4`,
      [guideId, new Date(after.time), after.id, limit],
    );
    const items: QuestionJson[] = [];
    for (const row of result.rows) {
      items.push(await this.questionJson(row));
    }
    const nextCursor = result.rows.length === limit ? encodeCursor(result.rows[result.rows.length - 1].asked_at.getTime(), result.rows[result.rows.length - 1].id) : null;
    return { items, nextCursor };
  }

  async questionById(id: string): Promise<QuestionRow | null> {
    return this.db.one<QuestionRow>('SELECT id, guide_id, step, text, asked_by, asked_at, answer, answered_by, answered_at FROM questions WHERE id = $1', [id]);
  }

  async questionJson(row: { id: string; guide_id?: string; step: number; text: string; asked_by: string; asked_at: Date; answer: string | null; answered_by: string | null; answered_at: Date | null }): Promise<QuestionJson> {
    const askedBy = await this.accountName(row.asked_by) ?? '';
    const answeredBy = row.answered_by ? (await this.accountName(row.answered_by) ?? '') : null;
    return {
      id: row.id,
      guide_id: row.guide_id ?? '',
      step: row.step,
      text: row.text,
      asked_by: askedBy,
      asked_at: row.asked_at.toISOString(),
      answer: row.answer === null
        ? null
        : { text: row.answer, answered_by: answeredBy ?? '', answered_at: (row.answered_at ?? new Date()).toISOString() },
    };
  }

  async createQuestion(client: PoolClient, guideId: string, step: number, text: string, askedBy: string): Promise<QuestionRow> {
    const id = newId('qst');
    await client.query('INSERT INTO questions (id, guide_id, step, text, asked_by) VALUES ($1, $2, $3, $4, $5)', [id, guideId, step, text, askedBy]);
    const row = await this.questionByIdTx(client, id);
    if (!row) throw new Error('question_missing');
    return row;
  }

  async answerQuestion(client: PoolClient, question: QuestionRow, text: string, answeredBy: string): Promise<QuestionRow> {
    await client.query('UPDATE questions SET answer = $2, answered_by = $3, answered_at = now() WHERE id = $1', [question.id, text, answeredBy]);
    const row = await this.questionByIdTx(client, question.id);
    if (!row) throw new Error('question_missing');
    return row;
  }

  async questionByIdTx(client: PoolClient, id: string): Promise<QuestionRow | null> {
    const result = await client.query<QuestionRow>('SELECT id, guide_id, step, text, asked_by, asked_at, answer, answered_by, answered_at FROM questions WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  // ---- likes -------------------------------------------------------------

  async likeCount(guideId: string): Promise<number> {
    const row = await this.db.one<{ count: number }>('SELECT COUNT(*)::int AS count FROM likes WHERE guide_id = $1', [guideId]);
    return row?.count ?? 0;
  }

  /** Counted inside the caller's transaction so the answer includes the new row. */
  async likeCountTx(client: PoolClient, guideId: string): Promise<number> {
    const result = await client.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM likes WHERE guide_id = $1', [guideId]);
    return result.rows[0]?.count ?? 0;
  }

  async putLike(client: PoolClient, guideId: string, accountId: string): Promise<number> {
    await client.query('INSERT INTO likes (guide_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guideId, accountId]);
    return this.likeCount(guideId);
  }

  async removeLike(client: PoolClient, guideId: string, accountId: string): Promise<number> {
    await client.query('DELETE FROM likes WHERE guide_id = $1 AND account_id = $2', [guideId, accountId]);
    return this.likeCount(guideId);
  }

  // ---- forks --------------------------------------------------------------

  async forkCount(guideId: string): Promise<number> {
    const row = await this.db.one<{ count: number }>('SELECT COUNT(*)::int AS count FROM guides WHERE forked_from_guide_id = $1', [guideId]);
    return row?.count ?? 0;
  }

  // ---- collections ----------------------------------------------------------

  async collectionById(id: string): Promise<CollectionRow | null> {
    return this.db.one<CollectionRow>('SELECT id, slug, title, owner_id, visibility FROM collections WHERE id = $1', [id]);
  }

  async collectionItems(collectionId: string): Promise<CollectionItemRow[]> {
    const result = await this.db.query<CollectionItemRow>(
      `SELECT ci.guide_id, ci.position, g.title, g.slug
       FROM collection_items ci JOIN guides g ON g.id = ci.guide_id
       WHERE ci.collection_id = $1 ORDER BY ci.position`,
      [collectionId],
    );
    return result.rows;
  }

  async addCollectionItem(client: PoolClient, collectionId: string, guideId: string): Promise<number> {
    const row = await client.query<{ next: number }>('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM collection_items WHERE collection_id = $1', [collectionId]);
    const position = row.rows[0].next;
    await client.query('INSERT INTO collection_items (collection_id, guide_id, position) VALUES ($1, $2, $3)', [collectionId, guideId, position]);
    return position;
  }

  async moveCollectionItem(client: PoolClient, collectionId: string, guideId: string, position: number): Promise<string[]> {
    const count = await this.collectionItemCount(collectionId);
    if (position < 0 || position >= count) return [];
    const current = await this.db.one<{ position: number }>('SELECT position FROM collection_items WHERE collection_id = $1 AND guide_id = $2', [collectionId, guideId]);
    if (!current) return [];
    if (current.position < position) {
      await client.query('UPDATE collection_items SET position = position - 1 WHERE collection_id = $1 AND position > $2 AND position <= $3', [collectionId, current.position, position]);
    } else {
      await client.query('UPDATE collection_items SET position = position + 1 WHERE collection_id = $1 AND position >= $2 AND position < $3', [collectionId, position, current.position]);
    }
    await client.query('UPDATE collection_items SET position = $2 WHERE collection_id = $1 AND guide_id = $3', [collectionId, position, guideId]);
    const result = await client.query<{ guide_id: string }>('SELECT guide_id FROM collection_items WHERE collection_id = $1 ORDER BY position', [collectionId]);
    return result.rows.map((row) => row.guide_id);
  }

  async collectionItemCount(collectionId: string): Promise<number> {
    const row = await this.db.one<{ count: number }>('SELECT COUNT(*)::int AS count FROM collection_items WHERE collection_id = $1', [collectionId]);
    return row?.count ?? 0;
  }

}

export interface VersionRow {
  guide_id: string;
  number: number;
  saved_at: Date;
  saved_by: string;
  restored_from: number | null;
  steps: WorkingStep[];
  parts: WorkingPart[];
  model_id: string | null;
  parts_cost: string | number;
}

export interface VersionItem {
  number: number;
  saved_at: string;
  saved_by: string;
  restored_from: number | null;
  step_count: number;
  parts_cost: number;
  parts_cost_text: string;
}

export interface QuestionJson {
  id: string;
  guide_id: string;
  step: number;
  text: string;
  asked_by: string;
  asked_at: string;
  answer: { text: string; answered_by: string; answered_at: string } | null;
}

export interface CollectionRow {
  id: string;
  slug: string;
  title: string;
  owner_id: string;
  visibility: 'public' | 'private';
}

export interface CollectionItemRow {
  guide_id: string;
  position: number;
  title: string;
  slug: string;
}

function encodeCursor(time: number, id: string): string {
  return Buffer.from(`${time}:${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { time: number; id: string } {
  const [time, id] = Buffer.from(cursor, 'base64url').toString('utf8').split(':');
  return { time: Number(time) || 0, id: id ?? '' };
}
