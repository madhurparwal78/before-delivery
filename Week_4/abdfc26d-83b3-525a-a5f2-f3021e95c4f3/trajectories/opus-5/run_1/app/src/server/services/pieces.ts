import { randomBytes } from 'node:crypto';
import type { Piece, PieceTimeline, PieceUniform } from '../../shared/api.js';
import { EASING_LABELS } from '../../shared/copy.js';
import { transaction, type Queryable } from '../db/pool.js';
import { ApiError, type FieldErrors } from '../errors.js';
import { requirePieceMove } from '../domain/states.js';
import { requestShaderGraph } from '../providers/aiRenderProvider.js';
import type { Principal } from '../auth/identity.js';
import {
  loadPieceBySlug,
  loadPieceBySlugFor,
  requireOwnedPiece,
  toPiece,
  type PieceRow,
} from './pieceRows.js';

const DEFAULT_TIMELINE_SECONDS = 10;
const MIN_PROMPT = 3;
const MAX_PROMPT = 500;

function kebab(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'piece' : slug;
}

/** The title in lowercase kebab case plus `-` and 4 lowercase hex characters. */
function newSlug(title: string): string {
  return `${kebab(title)}-${randomBytes(2).toString('hex')}`;
}

function requirePrompt(body: unknown): string {
  const prompt = (body as { prompt?: unknown } | null)?.prompt;
  if (typeof prompt !== 'string' || prompt.trim().length < MIN_PROMPT || prompt.length > MAX_PROMPT) {
    throw ApiError.validation({ prompt: 'Describe the piece in 3 to 500 characters.' });
  }
  return prompt;
}

/** Describes a piece. No piece is created when the provider fails. */
export async function describePiece(creator: Principal, body: unknown): Promise<Piece> {
  const prompt = requirePrompt(body);
  const graph = await requestShaderGraph(prompt);

  const uniforms: PieceUniform[] = graph.uniforms.map((uniform) => ({
    name: uniform.name,
    label: uniform.label,
    min: uniform.min,
    max: uniform.max,
    value: uniform.default,
  }));
  const timeline: PieceTimeline = {
    duration_s: DEFAULT_TIMELINE_SECONDS,
    tracks: [],
    audio_asset_id: null,
  };

  return transaction(async (client) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = newSlug(graph.titleSuggestion);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO pieces (slug, title, creator_id, state, version, fragment_source, uniforms, timeline)
         VALUES ($1, $2, $3, 'draft', 1, $4, $5, $6)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        [
          slug,
          graph.titleSuggestion,
          creator.id,
          graph.fragmentSource,
          JSON.stringify(uniforms),
          JSON.stringify(timeline),
        ],
      );
      if (inserted.rows[0]) {
        const row = await loadPieceBySlugFor(client, slug, false);
        if (!row) throw new Error('New draft vanished before it could be read');
        return toPiece(row, creator.id);
      }
    }
    throw new Error('Could not find a free slug for the new draft');
  });
}

function readEasing(value: unknown, fields: FieldErrors & Record<string, string>, path: string): string {
  if (typeof value !== 'string' || !(value in EASING_LABELS)) {
    fields[path] = 'Use linear, ease-in, ease-out or ease-in-out.';
    return 'linear';
  }
  return value;
}

interface SaveBody {
  title: string;
  uniforms: PieceUniform[];
  timeline: PieceTimeline;
}

function readSaveBody(body: unknown, current: PieceRow): SaveBody {
  const fields: Record<string, string> = {};
  const input = (body ?? {}) as Record<string, unknown>;

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title === '' || title.length > 140) {
    fields.title = 'Give the piece a title of 1 to 140 characters.';
  }

  const uniformValues = (input.uniforms ?? {}) as Record<string, unknown>;
  const uniforms: PieceUniform[] = current.uniforms.map((uniform) => {
    const raw = uniformValues[uniform.name];
    if (raw === undefined) return uniform;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      fields[`uniforms.${uniform.name}`] = 'Send a number inside the fader range.';
      return uniform;
    }
    const clamped = Math.min(uniform.max, Math.max(uniform.min, raw));
    return { ...uniform, value: clamped };
  });

  const timelineInput = (input.timeline ?? {}) as Record<string, unknown>;
  const duration = timelineInput.duration_s;
  const durationSeconds =
    typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : current.timeline.duration_s;

  const trackInput = Array.isArray(timelineInput.tracks) ? timelineInput.tracks : [];
  const known = new Set(current.uniforms.map((uniform) => uniform.name));
  const tracks = trackInput.map((entry, trackIndex) => {
    const track = (entry ?? {}) as Record<string, unknown>;
    const uniformName = typeof track.uniform === 'string' ? track.uniform : '';
    if (!known.has(uniformName)) {
      fields[`timeline.tracks.${trackIndex}.uniform`] = 'That piece has no such fader.';
    }
    const keyframeInput = Array.isArray(track.keyframes) ? track.keyframes : [];
    const keyframes = keyframeInput.map((keyframeEntry, keyframeIndex) => {
      const keyframe = (keyframeEntry ?? {}) as Record<string, unknown>;
      const path = `timeline.tracks.${trackIndex}.keyframes.${keyframeIndex}`;
      const timeSeconds = keyframe.time_s;
      const value = keyframe.value;
      if (typeof timeSeconds !== 'number' || !Number.isFinite(timeSeconds) || timeSeconds < 0) {
        fields[`${path}.time_s`] = 'Send a time inside the timeline.';
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fields[`${path}.value`] = 'Send a number.';
      }
      return {
        time_s: typeof timeSeconds === 'number' ? Math.round(timeSeconds * 10) / 10 : 0,
        value: typeof value === 'number' ? value : 0,
        easing: readEasing(keyframe.easing, fields, `${path}.easing`),
      };
    });
    return { uniform: uniformName, keyframes };
  });

  const audioAsset = timelineInput.audio_asset_id;
  const audioAssetId = typeof audioAsset === 'string' ? audioAsset : null;

  if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

  return {
    title,
    uniforms,
    timeline: {
      duration_s: durationSeconds,
      tracks: tracks as PieceTimeline['tracks'],
      audio_asset_id: audioAssetId,
    },
  };
}

function requireIfMatch(ifMatch: string | undefined, current: number): void {
  if (ifMatch === undefined || ifMatch.trim() === '') {
    throw ApiError.versionRequired();
  }
  const sent = Number.parseInt(ifMatch.replace(/^W\//, '').replace(/"/g, '').trim(), 10);
  if (sent !== current) {
    throw ApiError.versionConflict(current);
  }
}

/** A save must send the current version; a save over a newer version is refused. */
export async function savePiece(
  owner: Principal,
  slug: string,
  ifMatch: string | undefined,
  body: unknown,
): Promise<Piece> {
  return transaction(async (client) => {
    const row = requireOwnedPiece(await loadPieceBySlugFor(client, slug, true), owner.id);
    requireIfMatch(ifMatch, row.version);
    if (row.state !== 'draft') {
      throw ApiError.invalidTransition('Only a draft piece can be saved.');
    }

    const save = readSaveBody(body, row);
    await client.query(
      `UPDATE pieces SET title = $2, uniforms = $3, timeline = $4, version = version + 1
       WHERE id = $1`,
      [row.id, save.title, JSON.stringify(save.uniforms), JSON.stringify(save.timeline)],
    );

    const updated = await loadPieceBySlugFor(client, slug, false);
    if (!updated) throw new Error('Saved piece vanished before it could be read');
    return toPiece(updated, owner.id);
  });
}

interface PublishBody {
  editionCount: number;
  priceCents: number;
  exportRenderId: string;
}

function readPublishBody(body: unknown): PublishBody {
  const fields: Record<string, string> = {};
  const input = (body ?? {}) as Record<string, unknown>;

  const editionCount = input.edition_count;
  if (
    typeof editionCount !== 'number' ||
    !Number.isInteger(editionCount) ||
    editionCount < 1 ||
    editionCount > 500
  ) {
    fields.edition_count = 'Publish a run of 1 to 500 editions.';
  }

  const priceCents = input.price_cents;
  if (
    typeof priceCents !== 'number' ||
    !Number.isInteger(priceCents) ||
    priceCents < 100 ||
    priceCents > 500000
  ) {
    fields.price_cents = 'Price each edition between $1.00 and $5,000.00.';
  }

  const exportRenderId = input.export_render_id;
  if (typeof exportRenderId !== 'string' || exportRenderId === '') {
    fields.export_render_id = 'Choose a ready export.';
  }

  if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

  return {
    editionCount: editionCount as number,
    priceCents: priceCents as number,
    exportRenderId: exportRenderId as string,
  };
}

async function requireReadyExport(
  client: Queryable,
  pieceId: string,
  renderId: string,
): Promise<void> {
  const render = await client.query(
    "SELECT 1 FROM render_jobs WHERE id = $1 AND piece_id = $2 AND state = 'ready'",
    [renderId, pieceId],
  );
  if (render.rowCount === 0) {
    throw ApiError.validation({ export_render_id: 'Choose a ready export of this piece.' });
  }
}

export async function publishPiece(owner: Principal, slug: string, body: unknown): Promise<Piece> {
  return transaction(async (client) => {
    const row = requireOwnedPiece(await loadPieceBySlugFor(client, slug, true), owner.id);
    requirePieceMove(row.state, 'published');

    const publish = readPublishBody(body);
    if (!/^[0-9a-f-]{36}$/.test(publish.exportRenderId)) {
      throw ApiError.validation({ export_render_id: 'Choose a ready export of this piece.' });
    }
    await requireReadyExport(client, row.id, publish.exportRenderId);

    await client.query(
      `UPDATE pieces
       SET state = 'published', edition_count = $2, price_cents = $3, export_render_id = $4,
           published_at = now()
       WHERE id = $1`,
      [row.id, publish.editionCount, publish.priceCents, publish.exportRenderId],
    );

    const updated = await loadPieceBySlugFor(client, slug, false);
    if (!updated) throw new Error('Published piece vanished before it could be read');
    return toPiece(updated, owner.id);
  });
}

/** Withdrawing frees open holds; owners keep their downloads. */
export async function withdrawPiece(owner: Principal, slug: string): Promise<Piece> {
  return transaction(async (client) => {
    const row = requireOwnedPiece(await loadPieceBySlugFor(client, slug, true), owner.id);
    requirePieceMove(row.state, 'withdrawn');

    await client.query("UPDATE pieces SET state = 'withdrawn' WHERE id = $1", [row.id]);
    await client.query(
      "UPDATE edition_orders SET state = 'expired' WHERE piece_id = $1 AND state = 'held'",
      [row.id],
    );

    const updated = await loadPieceBySlugFor(client, slug, false);
    if (!updated) throw new Error('Withdrawn piece vanished before it could be read');
    return toPiece(updated, owner.id);
  });
}

/** Remixing copies the source's shader, uniforms and timeline into a new draft. */
export async function remixPiece(remixer: Principal, sourceSlug: string): Promise<Piece> {
  const source = await loadPieceBySlug(sourceSlug);
  if (!source || source.state !== 'published') throw ApiError.notFound();
  if (source.creator_id === remixer.id) {
    throw new ApiError(409, 'own_piece', 'You cannot remix your own piece.');
  }
  if (source.remix_of_id !== null) {
    throw new ApiError(409, 'remix_of_remix', 'A remix cannot be remixed.');
  }

  const title = `${source.title} (remix)`;
  return transaction(async (client) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = newSlug(title);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO pieces (slug, title, creator_id, state, version, fragment_source, uniforms,
                             timeline, remix_of_id)
         VALUES ($1, $2, $3, 'draft', 1, $4, $5, $6, $7)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        [
          slug,
          title,
          remixer.id,
          source.fragment_source,
          JSON.stringify(source.uniforms),
          JSON.stringify(source.timeline),
          source.id,
        ],
      );
      if (inserted.rows[0]) {
        const row = await loadPieceBySlugFor(client, slug, false);
        if (!row) throw new Error('New remix draft vanished before it could be read');
        return toPiece(row, remixer.id);
      }
    }
    throw new Error('Could not find a free slug for the remix draft');
  });
}

export async function listOwnPieces(owner: Principal): Promise<
  {
    slug: string;
    title: string;
    state: string;
    version: number;
    edition_count: number | null;
    price_cents: number | null;
    editions_sold: number;
    remix_of: { slug: string; title: string; creator_display_name: string } | null;
  }[]
> {
  const result = await transaction(async (client) =>
    client.query<{
      slug: string;
      title: string;
      state: string;
      version: number;
      edition_count: number | null;
      price_cents: number | null;
      editions_sold: number;
      remix_of_slug: string | null;
      remix_of_title: string | null;
      remix_of_creator: string | null;
    }>(
      `SELECT p.slug, p.title, p.state, p.version, p.edition_count, p.price_cents,
              (SELECT count(*) FROM edition_orders o
               WHERE o.piece_id = p.id AND o.state IN ('paid','invoiced','receipted'))::int AS editions_sold,
              source.slug AS remix_of_slug, source.title AS remix_of_title,
              source_creator.display_name AS remix_of_creator
       FROM pieces p
       LEFT JOIN pieces source ON source.id = p.remix_of_id
       LEFT JOIN app_users source_creator ON source_creator.id = source.creator_id
       WHERE p.creator_id = $1
       ORDER BY p.created_at DESC`,
      [owner.id],
    ),
  );

  return result.rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    state: row.state,
    version: row.version,
    edition_count: row.edition_count,
    price_cents: row.price_cents,
    editions_sold: row.editions_sold,
    remix_of:
      row.remix_of_slug && row.remix_of_title && row.remix_of_creator
        ? {
            slug: row.remix_of_slug,
            title: row.remix_of_title,
            creator_display_name: row.remix_of_creator,
          }
        : null,
  }));
}
