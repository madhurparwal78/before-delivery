import { randomBytes, randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/pool.ts';
import { hasAcceptedChannelsAndRate, probeAudio } from '../domain/audio.ts';
import { linkStatus, LINK_MAX_SECONDS } from '../domain/linkStatus.ts';
import {
  CREDIT_TYPES,
  isLegalProjectMove,
  isLinkableStatus,
  LAYERS,
  PROJECT_STATUSES,
  VISIBILITIES,
  type CreditType,
  type Layer,
  type ProjectStatus,
  type Visibility,
} from '../../shared/projectStatus.ts';
import { isSafeFileName, multiLineField, singleLineField } from '../domain/text.ts';
import { isJsonInteger, unwritableKeyErrors, WRITABLE_FIELDS } from '../domain/writable.ts';
import { ApiError, conflict, notFound, validation, type FieldErrors } from '../errors.ts';
import { sendJson } from '../http/respond.ts';
import type { Route } from '../http/router.ts';
import {
  groupStems,
  PROJECT_COLUMNS,
  readLinks,
  readProjectById,
  readStems,
  toConsoleLink,
  toConsoleProject,
  type LinkRow,
  type ProjectRow,
} from '../repo/projects.ts';
import { deleteObject, putObject, storageIsReachable } from '../services/storage.ts';

const STEM_SIZE_LIMIT = 20_000_000;
const STEM_MIN_DURATION_MS = 1_000;
const STEM_MAX_DURATION_MS = 180_000;

type ProjectFields = {
  slug: string;
  title: string;
  credit_type: CreditType;
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  visibility: Visibility;
  position: number;
  thresholds: Record<Layer, number>;
};

function validateThresholds(value: unknown, errors: FieldErrors): Record<Layer, number> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.thresholds = 'Give bed, pulse, lead and stinger thresholds.';
    return null;
  }
  const given = value as Record<string, unknown>;
  const keys = Object.keys(given).sort();
  if (keys.join(',') !== [...LAYERS].sort().join(',')) {
    errors.thresholds = 'Give exactly bed, pulse, lead and stinger.';
    return null;
  }
  if (given.bed !== 0) {
    errors.thresholds = 'The bed threshold is always 0.';
    return null;
  }
  const thresholds: Record<Layer, number> = { bed: 0, pulse: 0, lead: 0, stinger: 0 };
  for (const layer of LAYERS) {
    if (layer === 'bed') continue;
    const raw = given[layer];
    if (!isJsonInteger(raw) || raw < 1 || raw > 100) {
      errors.thresholds = 'Pulse, lead and stinger thresholds are whole numbers from 1 to 100.';
      return null;
    }
    thresholds[layer] = raw;
  }
  if (!(thresholds.bed < thresholds.pulse && thresholds.pulse < thresholds.lead && thresholds.lead < thresholds.stinger)) {
    errors.thresholds = 'Thresholds must rise from bed to stinger.';
    return null;
  }
  return thresholds;
}

function validateProjectFields(
  json: Record<string, unknown>,
  defaults: ProjectFields | null,
  nextPosition: number,
): Partial<ProjectFields> {
  const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.project);
  const result: Partial<ProjectFields> = {};

  if (Object.hasOwn(json, 'slug') || defaults === null) {
    const slug = json.slug;
    if (typeof slug !== 'string' || !/^[a-z0-9-]{3,48}$/.test(slug)) {
      errors.slug = 'Use 3 to 48 lowercase letters, digits and hyphens.';
    } else {
      result.slug = slug;
    }
  }
  const singleLines: Array<[keyof ProjectFields, number, number]> = [
    ['title', 1, 120],
    ['credit_line', 1, 200],
    ['role', 1, 120],
  ];
  for (const [field, min, max] of singleLines) {
    if (!Object.hasOwn(json, field) && defaults !== null) continue;
    const checked = singleLineField(json[field], min, max);
    if (!checked.ok) errors[field] = checked.message;
    else Object.assign(result, { [field]: checked.value });
  }
  if (Object.hasOwn(json, 'blurb') || defaults === null) {
    const blurb = multiLineField(json.blurb, 1, 1_000);
    if (!blurb.ok) errors.blurb = blurb.message;
    else result.blurb = blurb.value;
  }
  if (Object.hasOwn(json, 'credit_type') || defaults === null) {
    if (!CREDIT_TYPES.includes(json.credit_type as CreditType)) {
      errors.credit_type = 'Choose a shipped title, game jam or redesign.';
    } else {
      result.credit_type = json.credit_type as CreditType;
    }
  }
  if (Object.hasOwn(json, 'visibility')) {
    if (!VISIBILITIES.includes(json.visibility as Visibility)) {
      errors.visibility = 'Choose public or NDA.';
    } else {
      result.visibility = json.visibility as Visibility;
    }
  } else if (defaults === null) {
    result.visibility = 'public';
  }
  if (Object.hasOwn(json, 'tags')) {
    const tags = json.tags;
    if (!Array.isArray(tags) || tags.length > 10) {
      errors.tags = 'Give at most ten tags.';
    } else {
      const checked = tags.map((tag) => singleLineField(tag, 1, 30));
      if (checked.some((tag) => !tag.ok)) errors.tags = 'Each tag is 1 to 30 characters on one line.';
      else result.tags = checked.map((tag) => (tag as { value: string }).value);
    }
  } else if (defaults === null) {
    result.tags = [];
  }
  if (Object.hasOwn(json, 'position')) {
    if (!isJsonInteger(json.position) || json.position < 1 || json.position > 999) {
      errors.position = 'Use a whole number from 1 to 999.';
    } else {
      result.position = json.position;
    }
  } else if (defaults === null) {
    result.position = nextPosition;
  }
  if (Object.hasOwn(json, 'thresholds')) {
    const thresholds = validateThresholds(json.thresholds, errors);
    if (thresholds !== null) result.thresholds = thresholds;
  } else if (defaults === null) {
    result.thresholds = { bed: 0, pulse: 25, lead: 50, stinger: 75 };
  }

  if (Object.keys(errors).length > 0) throw validation(errors);
  return result;
}

async function respondWithProject(response: import('node:http').ServerResponse, id: string, status: number): Promise<void> {
  const project = await readProjectById(id);
  if (project === null) throw notFound('That project does not exist.');
  const stems = groupStems(await readStems([id]));
  sendJson(response, status, { project: toConsoleProject(project, stems.get(id) ?? []) });
}

async function loadProject(id: string): Promise<ProjectRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('That project does not exist.');
  const project = await readProjectById(id);
  if (project === null) throw notFound('That project does not exist.');
  return project;
}

async function nextFreePosition(): Promise<number> {
  const result = await query<{ next: number | null }>(`SELECT max(position) + 1 AS next FROM projects`);
  return result.rows[0]?.next ?? 1;
}

async function loadLink(id: string): Promise<LinkRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('That listening link does not exist.');
  const result = await query<LinkRow>(
    `SELECT id, project_id, label, token, expires_at, revoked_at FROM listening_links WHERE id = $1`,
    [id],
  );
  const link = result.rows[0];
  if (link === undefined) throw notFound('That listening link does not exist.');
  return link;
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export const consoleProjectRoutes: readonly Route[] = [
  {
    path: '/api/console/projects',
    method: 'GET',
    requiresSession: true,
    handler: async ({ response }) => {
      const projects = await query<ProjectRow>(
        `SELECT ${PROJECT_COLUMNS} FROM projects p ORDER BY p.position ASC, p.title ASC`,
      );
      const stems = groupStems(await readStems(projects.rows.map((project) => project.id)));
      sendJson(response, 200, {
        projects: projects.rows.map((project) => toConsoleProject(project, stems.get(project.id) ?? [])),
      });
    },
  },
  {
    path: '/api/console/projects/:id',
    method: 'GET',
    requiresSession: true,
    handler: async ({ response, params }) => {
      const project = await loadProject(params.id as string);
      await respondWithProject(response, project.id, 200);
    },
  },
  {
    path: '/api/console/projects',
    method: 'POST',
    requiresSession: true,
    handler: async ({ response, json }) => {
      const fields = validateProjectFields(json, null, await nextFreePosition()) as ProjectFields;
      const id = randomUUID();
      try {
        await query(
          `INSERT INTO projects (id, slug, title, credit_type, credit_line, role, blurb, tags, visibility, position,
             threshold_bed, threshold_pulse, threshold_lead, threshold_stinger, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft')`,
          [
            id,
            fields.slug,
            fields.title,
            fields.credit_type,
            fields.credit_line,
            fields.role,
            fields.blurb,
            fields.tags,
            fields.visibility,
            fields.position,
            fields.thresholds.bed,
            fields.thresholds.pulse,
            fields.thresholds.lead,
            fields.thresholds.stinger,
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw conflict('slug_taken', 'That slug is already used.');
        }
        throw error;
      }
      await respondWithProject(response, id, 201);
    },
  },
  {
    path: '/api/console/projects/:id',
    method: 'PATCH',
    requiresSession: true,
    handler: async ({ response, params, json }) => {
      const project = await loadProject(params.id as string);
      if (project.status === 'withdrawn') {
        throw conflict('project_withdrawn', 'That project is withdrawn.');
      }
      if (Object.keys(json).length === 0) throw validation({ body: 'Send at least one field to change.' });
      const fields = validateProjectFields(json, {
        slug: project.slug,
        title: project.title,
        credit_type: project.credit_type,
        credit_line: project.credit_line,
        role: project.role,
        blurb: project.blurb,
        tags: project.tags,
        visibility: project.visibility,
        position: project.position,
        thresholds: { bed: 0, pulse: 0, lead: 0, stinger: 0 },
      }, project.position);

      const assignments: string[] = [];
      const values: unknown[] = [project.id];
      const push = (column: string, value: unknown): void => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      };
      if (fields.slug !== undefined) push('slug', fields.slug);
      if (fields.title !== undefined) push('title', fields.title);
      if (fields.credit_type !== undefined) push('credit_type', fields.credit_type);
      if (fields.credit_line !== undefined) push('credit_line', fields.credit_line);
      if (fields.role !== undefined) push('role', fields.role);
      if (fields.blurb !== undefined) push('blurb', fields.blurb);
      if (fields.tags !== undefined) push('tags', fields.tags);
      if (fields.visibility !== undefined) push('visibility', fields.visibility);
      if (fields.position !== undefined) push('position', fields.position);
      if (fields.thresholds !== undefined) {
        push('threshold_bed', fields.thresholds.bed);
        push('threshold_pulse', fields.thresholds.pulse);
        push('threshold_lead', fields.thresholds.lead);
        push('threshold_stinger', fields.thresholds.stinger);
      }
      try {
        await query(`UPDATE projects SET ${assignments.join(', ')} WHERE id = $1`, values);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw conflict('slug_taken', 'That slug is already used.');
        }
        throw error;
      }
      await respondWithProject(response, project.id, 200);
    },
  },
  {
    path: '/api/console/projects/:id/stems',
    method: 'POST',
    body: 'stem-multipart',
    requiresSession: true,
    handler: async ({ response, params, multipart }) => {
      const project = await loadProject(params.id as string);
      if (project.status === 'withdrawn') throw conflict('project_withdrawn', 'That project is withdrawn.');

      const layer = multipart?.fields.layer ?? '';
      const file = multipart?.file ?? null;
      if (file === null || file.bytes.byteLength === 0) throw validation({ file: 'Choose a stem file.' });
      if (file.bytes.byteLength > STEM_SIZE_LIMIT) {
        throw new ApiError(413, 'file_too_large', `That stem is over ${STEM_SIZE_LIMIT} bytes.`);
      }
      const probe = probeAudio(file.bytes);
      if (
        probe === null ||
        !hasAcceptedChannelsAndRate(probe) ||
        probe.durationMs < STEM_MIN_DURATION_MS ||
        probe.durationMs > STEM_MAX_DURATION_MS
      ) {
        throw new ApiError(415, 'unsupported_media', 'Send a WAV or OGG stem.');
      }
      const errors: FieldErrors = {};
      if (!LAYERS.includes(layer as Layer)) errors.layer = 'Choose bed, pulse, lead or stinger.';
      if (!isSafeFileName(file.filename)) errors.file = 'File name is not allowed.';
      if (Object.keys(errors).length > 0) throw validation(errors);

      const stemId = randomUUID();
      const objectKey = `projects/${project.id}/stems/${stemId}.${probe.format}`;
      await putObject(objectKey, file.bytes, probe.format === 'wav' ? 'audio/wav' : 'audio/ogg');

      const replaced = await withTransaction(async (client) => {
        const previous = await client.query<{ object_key: string }>(
          `SELECT object_key FROM stems WHERE project_id = $1 AND layer = $2`,
          [project.id, layer],
        );
        await client.query(
          `INSERT INTO stems (id, project_id, layer, format, bytes, duration_ms, object_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (project_id, layer) DO UPDATE
             SET id = EXCLUDED.id, format = EXCLUDED.format, bytes = EXCLUDED.bytes,
                 duration_ms = EXCLUDED.duration_ms, object_key = EXCLUDED.object_key`,
          [stemId, project.id, layer, probe.format, file.bytes.byteLength, probe.durationMs, objectKey],
        );
        return previous.rows[0]?.object_key ?? null;
      });
      if (replaced !== null && replaced !== objectKey) {
        await deleteObject(replaced).catch(() => undefined);
      }

      sendJson(response, 201, {
        stem: {
          id: stemId,
          layer,
          format: probe.format,
          bytes: file.bytes.byteLength,
          duration_ms: probe.durationMs,
        },
      });
    },
  },
  {
    path: '/api/console/projects/:id/transition',
    method: 'POST',
    requiresSession: true,
    handler: async ({ response, params, json }) => {
      const project = await loadProject(params.id as string);
      const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.transition);
      const to = json.to;
      if (!PROJECT_STATUSES.includes(to as ProjectStatus)) errors.to = 'Choose a status this project can move to.';
      if (Object.keys(errors).length > 0) throw validation(errors);
      const target = to as ProjectStatus;

      if (!isLegalProjectMove(project.status, target)) {
        throw conflict('illegal_transition', 'That move is not allowed from the current state.', {
          from: project.status,
          to: target,
        });
      }

      if (target === 'published') {
        const stems = await readStems([project.id]);
        const missing = LAYERS.filter((layer) => !stems.some((stem) => stem.layer === layer));
        if (missing.length > 0) {
          throw conflict('stems_incomplete', 'Upload the missing stems first.', { missing });
        }
        if (!(await storageIsReachable())) {
          throw new ApiError(503, 'storage_unavailable', 'Storage is unreachable.');
        }
      }

      if (target === 'withdrawn') {
        const stems = await readStems([project.id]);
        for (const stem of stems) {
          await deleteObject(stem.object_key);
        }
        await withTransaction(async (client) => {
          await client.query(`DELETE FROM stems WHERE project_id = $1`, [project.id]);
          await client.query(
            `UPDATE listening_links SET revoked_at = now() WHERE project_id = $1 AND revoked_at IS NULL`,
            [project.id],
          );
          await client.query(`UPDATE projects SET status = 'withdrawn' WHERE id = $1`, [project.id]);
        });
        await respondWithProject(response, project.id, 200);
        return;
      }

      await query(`UPDATE projects SET status = $2 WHERE id = $1`, [project.id, target]);
      await respondWithProject(response, project.id, 200);
    },
  },
  {
    path: '/api/console/projects/:id/links',
    method: 'GET',
    requiresSession: true,
    handler: async ({ response, params, now }) => {
      const project = await loadProject(params.id as string);
      const links = await readLinks(project.id);
      sendJson(response, 200, { links: links.map((link) => toConsoleLink(link, now)) });
    },
  },
  {
    path: '/api/console/projects/:id/links',
    method: 'POST',
    requiresSession: true,
    handler: async ({ response, params, json, now }) => {
      const project = await loadProject(params.id as string);
      if (!isLinkableStatus(project.status)) {
        throw conflict('illegal_transition', 'Only a project in review or published can have listening links.', {
          from: project.status,
          to: project.status,
        });
      }
      const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.listeningLink);
      const label = singleLineField(json.label, 1, 80);
      if (!label.ok) errors.label = label.message;
      const rawExpiry = json.expires_at;
      let expiresAt: Date | null = null;
      if (typeof rawExpiry !== 'string' || Number.isNaN(Date.parse(rawExpiry))) {
        errors.expires_at = 'Give an expiry instant.';
      } else {
        const parsed = new Date(rawExpiry);
        const seconds = (parsed.getTime() - now.getTime()) / 1000;
        if (seconds <= 0) errors.expires_at = 'The expiry must be later than now.';
        else if (seconds > LINK_MAX_SECONDS) errors.expires_at = 'The expiry can be at most 365 days from now.';
        else expiresAt = parsed;
      }
      if (Object.keys(errors).length > 0) throw validation(errors);

      const id = randomUUID();
      await query(
        `INSERT INTO listening_links (id, project_id, label, token, expires_at) VALUES ($1,$2,$3,$4,$5)`,
        [id, project.id, (label as { value: string }).value, newToken(), expiresAt],
      );
      const link = await loadLink(id);
      sendJson(response, 201, { link: toConsoleLink(link, now) });
    },
  },
  {
    path: '/api/console/links/:id/revoke',
    method: 'POST',
    requiresSession: true,
    handler: async ({ response, params, json, now }) => {
      const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.empty);
      if (Object.keys(errors).length > 0) throw validation(errors);
      const link = await loadLink(params.id as string);
      if (link.revoked_at === null) {
        await query(`UPDATE listening_links SET revoked_at = now() WHERE id = $1`, [link.id]);
      }
      sendJson(response, 200, { link: toConsoleLink(await loadLink(link.id), now) });
    },
  },
  {
    path: '/api/console/links/:id/regenerate',
    method: 'POST',
    requiresSession: true,
    handler: async ({ response, params, json, now }) => {
      const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.empty);
      if (Object.keys(errors).length > 0) throw validation(errors);
      const link = await loadLink(params.id as string);
      if (linkStatus(link, now) !== 'active') {
        throw conflict('link_not_active', 'Only an active link can be regenerated.');
      }
      const id = randomUUID();
      await withTransaction(async (client) => {
        await client.query(`UPDATE listening_links SET revoked_at = now() WHERE id = $1`, [link.id]);
        await client.query(
          `INSERT INTO listening_links (id, project_id, label, token, expires_at) VALUES ($1,$2,$3,$4,$5)`,
          [id, link.project_id, link.label, newToken(), link.expires_at],
        );
      });
      sendJson(response, 201, { link: toConsoleLink(await loadLink(id), now) });
    },
  },
];
