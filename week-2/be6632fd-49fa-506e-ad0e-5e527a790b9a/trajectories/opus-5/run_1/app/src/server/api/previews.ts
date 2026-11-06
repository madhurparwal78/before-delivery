import { requireRole, requireSession } from '../auth.ts';
import { config } from '../config.ts';
import { query, queryOne, transact } from '../db/pool.ts';
import { queueMail } from '../db/outbox.ts';
import { isPublicStatus } from '../../domain/dropstate.ts';
import { DEAD_LINK_CODES, DEAD_LINK_COPY, previewLinkState } from '../../domain/previewstate.ts';
import { marketCity } from '../../domain/markets.ts';
import { csvCell } from '../../domain/text.ts';
import { formatCopenhagenInstant, formatInstant } from '../../domain/time.ts';
import type { Ctx } from '../http/context.ts';
import { ApiError, conflict, gone, notFound } from '../http/errors.ts';
import { sendJson, sendText } from '../http/respond.ts';
import { email as emailField, Problems, text } from '../http/validate.ts';
import { newId, newToken, sha256Hex } from '../services/crypto.ts';
import { getObject, pressZipKey, putObject, StorageUnavailable } from '../services/storage.ts';
import { loadDrops, type DropRecord } from '../repo/drops.ts';
import { loadLooks } from './publicdrops.ts';
import { requireDrop } from './drops.ts';
import { buildZip } from '../services/zip.ts';

interface PreviewRow {
  id: string;
  workspace_id: string;
  drop_id: string;
  editor_name: string;
  editor_email: string;
  outlet: string;
  token: string;
  issued_at_ms: number;
  expires_at_ms: number;
  revoked_at_ms: number | null;
  replaced_at_ms: number | null;
}

function previewShape(row: PreviewRow, nowMs: number, dropWithdrawn: boolean): Record<string, unknown> {
  const state = previewLinkState({
    revokedAtMs: row.revoked_at_ms === null ? null : Number(row.revoked_at_ms),
    replacedAtMs: row.replaced_at_ms === null ? null : Number(row.replaced_at_ms),
    expiresAtMs: Number(row.expires_at_ms),
    dropWithdrawn,
    nowMs,
  });
  return {
    id: row.id,
    editorName: row.editor_name,
    editorEmail: row.editor_email,
    outlet: row.outlet,
    status: state === 'active' ? 'active' : state === 'revoked' ? 'revoked' : 'expired',
    issuedAt: formatInstant(Number(row.issued_at_ms)),
    expiresAt: formatInstant(Number(row.expires_at_ms)),
    link: `/press/${row.token}`,
  };
}

export async function listPreviews(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'press_lead');
  const rows = await query<PreviewRow>(
    'select * from previews where drop_id = $1 order by issued_at_ms desc',
    [drop.id],
  );
  sendJson(ctx.response, 200, {
    items: rows.map((row) => previewShape(row, ctx.nowMs, drop.status === 'withdrawn')),
  });
}

export async function createPreview(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'press_lead');
  if (!isPublicStatus(drop.status)) throw conflict('drop_not_public');

  const body = ctx.json();
  const problems = new Problems();
  const editorName = text(problems, body, 'editorName', { max: 80 });
  const editorEmail = emailField(problems, body, 'editorEmail');
  const outlet = text(problems, body, 'outlet', { max: 80 });
  problems.throwIfAny();

  const id = newId();
  const token = newToken();
  const expiresAtMs = ctx.nowMs + config.ttl.previewLinkSeconds * 1000;
  await transact(async (tx) => {
    await tx.query(
      `insert into previews (id, workspace_id, drop_id, editor_name, editor_email, outlet, token, issued_at_ms, expires_at_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, session.workspaceId, drop.id, editorName, editorEmail, outlet, token, ctx.nowMs, expiresAtMs],
    );
    await queuePreviewMail(tx, drop, editorName, editorEmail, token, expiresAtMs);
  });
  const rows = await query<PreviewRow>('select * from previews where id = $1', [id]);
  const created = rows[0];
  if (created === undefined) throw notFound();
  sendJson(ctx.response, 201, previewShape(created, ctx.nowMs, false));
}

async function queuePreviewMail(
  tx: Parameters<typeof queueMail>[0],
  drop: DropRecord,
  editorName: string,
  editorEmail: string,
  token: string,
  expiresAtMs: number,
): Promise<void> {
  await queueMail(
    tx,
    {
      kind: 'press_preview',
      email: editorEmail,
      name: editorName,
      dropName: drop.name,
      embargoAtMs: drop.goLiveAtMs ?? expiresAtMs,
      token,
      expiresAtMs,
    },
    `preview:${token}`,
  );
}

async function requirePreview(ctx: Ctx, workspaceId: string): Promise<PreviewRow> {
  const row = await queryOne<PreviewRow>(
    'select * from previews where id = $1 and workspace_id = $2',
    [ctx.params['previewId'] as string, workspaceId],
  );
  if (row === null) throw notFound();
  return row;
}

export async function revokePreview(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const preview = await requirePreview(ctx, session.workspaceId);
  requireRole(session, 'press_lead');
  if (preview.revoked_at_ms !== null) throw conflict('preview_revoked');
  await query('update previews set revoked_at_ms = $2 where id = $1', [preview.id, ctx.nowMs]);
  const rows = await query<PreviewRow>('select * from previews where id = $1', [preview.id]);
  sendJson(ctx.response, 200, previewShape(rows[0] as PreviewRow, ctx.nowMs, false));
}

export async function regeneratePreview(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const preview = await requirePreview(ctx, session.workspaceId);
  requireRole(session, 'press_lead');
  if (preview.revoked_at_ms !== null) throw conflict('preview_revoked');

  const drops = await loadDrops('id = $1', [preview.drop_id], ctx.nowMs);
  const drop = drops[0];
  if (drop === undefined) throw notFound();

  const token = newToken();
  const expiresAtMs = ctx.nowMs + config.ttl.previewLinkSeconds * 1000;
  const id = newId();
  await transact(async (tx) => {
    await tx.query('update previews set replaced_at_ms = $2 where id = $1', [preview.id, ctx.nowMs]);
    await tx.query(
      `insert into previews (id, workspace_id, drop_id, editor_name, editor_email, outlet, token, issued_at_ms, expires_at_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        preview.workspace_id,
        preview.drop_id,
        preview.editor_name,
        preview.editor_email,
        preview.outlet,
        token,
        ctx.nowMs,
        expiresAtMs,
      ],
    );
    await queuePreviewMail(tx, drop, preview.editor_name, preview.editor_email, token, expiresAtMs);
  });
  const rows = await query<PreviewRow>('select * from previews where id = $1', [id]);
  sendJson(ctx.response, 200, previewShape(rows[0] as PreviewRow, ctx.nowMs, false));
}

export interface LivePreview {
  preview: PreviewRow;
  drop: DropRecord;
}

/** Resolves a press token to a live link, or throws the matching dead-link 410. */
export async function requireLivePreview(ctx: Ctx): Promise<LivePreview> {
  const token = ctx.params['token'] as string;
  const preview = await queryOne<PreviewRow>('select * from previews where token = $1', [token]);
  if (preview === null) throw notFound();
  const drops = await loadDrops('id = $1', [preview.drop_id], ctx.nowMs);
  const drop = drops[0];
  if (drop === undefined) throw notFound();
  const state = previewLinkState({
    revokedAtMs: preview.revoked_at_ms === null ? null : Number(preview.revoked_at_ms),
    replacedAtMs: preview.replaced_at_ms === null ? null : Number(preview.replaced_at_ms),
    expiresAtMs: Number(preview.expires_at_ms),
    dropWithdrawn: drop.status === 'withdrawn',
    nowMs: ctx.nowMs,
  });
  if (state !== 'active') {
    throw gone(DEAD_LINK_CODES[state], { message: DEAD_LINK_COPY[state] });
  }
  return { preview, drop };
}

/** Exactly the press payload fields: nothing commercial, internal or about staff. */
export async function pressPayload(live: LivePreview): Promise<Record<string, unknown>> {
  const { preview, drop } = live;
  const story = await queryOne<{ published_html: string | null }>(
    'select published_html from stories where drop_id = $1',
    [drop.id],
  );
  const looks = await loadLooks(drop.id);
  return {
    brand: await brandName(drop.workspaceId),
    dropName: drop.name,
    type: drop.type,
    embargoUntil: drop.goLiveAtMs === null ? null : formatInstant(drop.goLiveAtMs),
    expiresAt: formatInstant(Number(preview.expires_at_ms)),
    markets: drop.markets.map((entry) => ({
      market: entry.market,
      city: marketCity(entry.market),
      goLiveAt: entry.goLiveAtMs === null ? null : formatInstant(entry.goLiveAtMs),
    })),
    storyHtml: story?.published_html ?? '',
    looks: looks.map((look) => ({
      id: look.id,
      position: look.position + 1,
      title: look.title,
      altText: look.alt_text,
      imageUrl: `/api/press/${preview.token}/looks/${look.id}/image`,
      width: look.width,
      height: look.height,
    })),
  };
}

async function brandName(workspaceId: string): Promise<string> {
  const row = await queryOne<{ name: string }>('select name from workspaces where id = $1', [
    workspaceId,
  ]);
  return row?.name ?? '';
}

export async function getPressPayload(ctx: Ctx): Promise<void> {
  const live = await requireLivePreview(ctx);
  sendJson(ctx.response, 200, await pressPayload(live));
}

export async function getPressLookImage(ctx: Ctx): Promise<void> {
  const live = await requireLivePreview(ctx);
  const look = await queryOne<{
    id: string;
    object_key: string;
    content_type: string;
  }>('select id, object_key, content_type from looks where id = $1 and drop_id = $2', [
    ctx.params['lookId'] as string,
    live.drop.id,
  ]);
  if (look === null) throw notFound();
  try {
    const bytes = await getObject(look.object_key);
    sendText(ctx.response, 200, look.content_type, bytes);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError(503, 'storage_unavailable');
    throw error;
  }
}

export async function getPressZip(ctx: Ctx): Promise<void> {
  const live = await requireLivePreview(ctx);
  const looks = await loadLooks(live.drop.id);
  try {
    const entries: { name: string; bytes: Buffer }[] = [];
    for (const look of looks) {
      const bytes = await getObject(look.object_key);
      const extension = look.content_type === 'image/png' ? 'png' : look.content_type === 'image/webp' ? 'webp' : 'jpg';
      entries.push({
        name: `look-${String(look.position + 1).padStart(2, '0')}.${extension}`,
        bytes,
      });
    }
    const manifest = {
      dropName: live.drop.name,
      embargoUntil: live.drop.goLiveAtMs === null ? null : formatInstant(live.drop.goLiveAtMs),
      files: entries.map((entry) => ({
        name: entry.name,
        sizeBytes: entry.bytes.length,
        sha256: sha256Hex(entry.bytes),
      })),
    };
    const zip = buildZip([
      ...entries,
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    ]);
    await putObject(pressZipKey(live.preview.id), zip, 'application/zip');
    sendText(ctx.response, 200, 'application/zip', zip, {
      'content-disposition': `attachment; filename="${csvCell(live.drop.slug)}-press.zip"`,
    });
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError(503, 'storage_unavailable');
    throw error;
  }
}

export function pressEmbargoLine(drop: DropRecord): string {
  return drop.goLiveAtMs === null
    ? 'Embargoed until the drop opens'
    : `Embargoed until ${formatCopenhagenInstant(drop.goLiveAtMs)}`;
}
