import { ApiError, type Ctx } from '../api_types';
import { q, tx } from '../db';
import { isSlug } from '../../shared/domain';
import { validateCandidates, computeManifest } from '../../shared/domain';
import { requireAccount, dossierJson } from './core';
import { readAddon } from '../billing';
import { putObject, deletePrefix } from '../s3';
import { publishDossier } from './core';
import { buildPublishObjects } from '../publish/objects';
import { newToken, tokenHash } from '../crypt';
import { config } from '../config';
import { route } from './auth_routes';

const SLUG_RE = /^[a-z0-9-]{3,48}$/;

interface DossierRowFull {
  id: string; account_id: string; slug: string; root_note_id: string; state: string;
  radius: number | null; publish_id: string | null; created_at: Date; published_at: Date | null;
}

const dossierFor = async (accountId: string, id: string): Promise<DossierRowFull> => {
  const r = await q<DossierRowFull>('select * from dossiers where id = $1 and account_id = $2', [id, accountId]);
  if (!r.rows[0]) throw new ApiError('not_found', 'Dossier not found.');
  return r.rows[0];
};

const manifestInput = async (ctx: Ctx): Promise<{ radius: number; notes: ReturnType<typeof validateCandidates>['notes']; root: NonNullable<ReturnType<typeof validateCandidates>['root']> }> => {
  const json = (ctx.body?.json() ?? {}) as { radius?: unknown; notes?: unknown };
  const v = validateCandidates(json.radius, json.notes);
  if (v.error) throw new ApiError('validation_failed', 'Check the highlighted fields.', { fields: { [v.error.field]: v.error.message } });
  if (!v.root) throw new ApiError('validation_failed', 'Check the highlighted fields.', { fields: { notes: 'must include the root note' } });
  return { radius: json.radius as number, notes: v.notes, root: v.root };
};

const publishEntitled = async (accountId: string): Promise<void> => {
  const publish = await readAddon(accountId, 'publish');
  if (publish.source === 'cache' && publish.state === 'none')
    throw new ApiError('billing_unavailable', 'Billing is unavailable. Try again shortly.');
  if (publish.state !== 'active' && publish.state !== 'ending')
    throw new ApiError('publish_not_entitled', 'Publishing needs the Publish add-on.');
};

route('POST', '/api/dossiers', async (ctx) => {
  const account = requireAccount(ctx);
  const b = (ctx.body?.json() ?? {}) as { slug?: unknown; root_note_id?: unknown };
  const slug = typeof b.slug === 'string' ? b.slug : '';
  if (!SLUG_RE.test(slug) || !isSlug(slug))
    throw new ApiError('validation_failed', 'Check the highlighted fields.', { fields: { slug: 'must be 3 to 48 lowercase letters, digits and hyphens' } });
  await publishEntitled(account.id);
  const taken = await q('select 1 from dossiers where slug = $1', [slug]);
  if (taken.rows.length) throw new ApiError('slug_taken', 'This dossier address is taken.');
  const r = await q<DossierRowFull>(
    'insert into dossiers(account_id, slug, root_note_id, state) values ($1, $2, $3, $4) returning *',
    [account.id, slug, String(b.root_note_id), 'draft'],
  );
  return { status: 201, body: { dossier: await dossierJson(r.rows[0]) } };
});

route('GET', '/api/dossiers', async (ctx) => {
  const account = requireAccount(ctx);
  const rows = await q<DossierRowFull>('select * from dossiers where account_id = $1 order by created_at', [account.id]);
  return { status: 200, body: { dossiers: await Promise.all(rows.rows.map(dossierJson)) } };
});

route('GET', '/api/dossiers/<id>', async (ctx, params) => {
  const account = requireAccount(ctx);
  const d = await dossierFor(account.id, params[0]);
  return { status: 200, body: { dossier: await dossierJson(d) } };
});

route('POST', '/api/dossiers/<id>/manifest-preview', async (ctx, params) => {
  const account = requireAccount(ctx);
  await dossierFor(account.id, params[0]);
  const input = await manifestInput(ctx);
  const manifest = computeManifest(input);
  return { status: 200, body: manifest };
}, { limit: 5_000_000 });

const inFlight = new Set<string>();

route('POST', '/api/dossiers/<id>/publish', async (ctx, params) => {
  const account = requireAccount(ctx);
  const dossier = await dossierFor(account.id, params[0]);
  if (inFlight.has(dossier.id)) throw new ApiError('publish_in_progress', 'Another publish of this dossier is still running.');
  const input = await manifestInput(ctx);
  if (!['draft', 'in_review', 'published'].includes(dossier.state))
    throw new ApiError('invalid_transition', `This dossier is ${dossier.state}.`, { extra: { state: dossier.state } });
  await publishEntitled(account.id);
  inFlight.add(dossier.id);
  try {
    // revoke any active preview link
    await q(`update preview_links set state = 'revoked' where dossier_id = $1 and state = 'active'`, [dossier.id]);
    await publishDossier(dossier, input.radius, input.notes, input.root);
    const fresh = await dossierFor(account.id, dossier.id);
    return { status: 200, body: { dossier: await dossierJson(fresh) } };
  } finally {
    inFlight.delete(dossier.id);
  }
}, { limit: 5_000_000 });

route('POST', '/api/dossiers/<id>/unpublish', async (ctx, params) => {
  const account = requireAccount(ctx);
  const dossier = await dossierFor(account.id, params[0]);
  if (dossier.state !== 'published')
    throw new ApiError('invalid_transition', `This dossier is ${dossier.state}.`, { extra: { state: dossier.state } });
  // clear the pointer first so readers get 404 at once; the state stays published until every object is gone
  await q('update dossiers set publish_id = null where id = $1', [dossier.id]);
  let removed = 0;
  try {
    removed = await deletePrefix(`publish/${dossier.slug}/`);
  } catch {
    throw new ApiError('storage_unavailable', 'Takedown paused: storage unavailable. Try again shortly.');
  }
  if (removed > 0) {
    const still = await (await import('../s3')).listPrefix(`publish/${dossier.slug}/`);
    if (still.length) throw new ApiError('storage_unavailable', 'Takedown paused: storage unavailable. Try again shortly.');
  }
  await q('update dossiers set state = $2, unpublished_at = now() where id = $1', [dossier.id, 'unpublished']);
  const fresh = await dossierFor(account.id, dossier.id);
  return { status: 200, body: { dossier: await dossierJson(fresh) } };
});

route('POST', '/api/dossiers/<id>/reopen', async (ctx, params) => {
  const account = requireAccount(ctx);
  const dossier = await dossierFor(account.id, params[0]);
  if (!['unpublished', 'lapsed'].includes(dossier.state))
    throw new ApiError('invalid_transition', `This dossier is ${dossier.state}.`, { extra: { state: dossier.state } });
  await q('update dossiers set state = $2, unpublished_at = null where id = $1', [dossier.id, 'draft']);
  const fresh = await dossierFor(account.id, dossier.id);
  return { status: 200, body: { dossier: await dossierJson(fresh) } };
});

const renderPreviewObjects = async (dossier: DossierRowFull, radius: number, notes: ReturnType<typeof validateCandidates>['notes'], root: NonNullable<ReturnType<typeof validateCandidates>['root']>, linkId: string): Promise<void> => {
  const { renderDossierPages } = await import('../../shared/render');
  const manifest = computeManifest({ radius, notes });
  const rendered = renderDossierPages(manifest, notes, root.id);
  const prefix = `preview/${linkId}/`;
  const objects = buildPublishObjects(dossier.slug, prefix, rendered, root.id, 'p');
  // preview pages reference assets relative to the preview path
  for (const o of objects) await putObject(o.key, o.body, o.contentType);
};

route('POST', '/api/dossiers/<id>/preview-links', async (ctx, params) => {
  const account = requireAccount(ctx);
  const dossier = await dossierFor(account.id, params[0]);
  const input = await manifestInput(ctx);
  if (!['draft', 'in_review'].includes(dossier.state))
    throw new ApiError('invalid_transition', `This dossier is ${dossier.state}.`, { extra: { state: dossier.state } });
  await publishEntitled(account.id);
  const token = newToken(32);
  const expiresAt = new Date(Date.now() + config.timers.previewTtl * 1000);
  const created = await tx(async (client) => {
    // at most one active link: the previous one becomes replaced
    await client.query(`update preview_links set state = 'replaced' where dossier_id = $1 and state = 'active'`, [dossier.id]);
    const r = await client.query<{ id: string }>(
      'insert into preview_links(dossier_id, state, token_hash, expires_at) values ($1, $2, $3, $4) returning id',
      [dossier.id, 'active', tokenHash(token), expiresAt],
    );
    await client.query('update dossiers set state = $2 where id = $1', [dossier.id, 'in_review']);
    return r.rows[0];
  });
  try {
    await renderPreviewObjects(dossier, input.radius, input.notes, input.root, created.id);
  } catch {
    throw new ApiError('storage_unavailable', 'Preview paused: storage unavailable.');
  }
  return {
    status: 201,
    body: {
      preview_link: { id: created.id, state: 'active', created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), expires_at: expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z') },
      url: `/p/${token}/`,
    },
  };
}, { limit: 5_000_000 });

route('GET', '/api/dossiers/<id>/preview-links', async (ctx, params) => {
  const account = requireAccount(ctx);
  const dossier = await dossierFor(account.id, params[0]);
  const rows = await q<{ id: string; state: string; created_at: Date; expires_at: Date }>(
    'select id, state, created_at, expires_at from preview_links where dossier_id = $1 order by created_at desc',
    [dossier.id],
  );
  return {
    status: 200,
    body: {
      preview_links: rows.rows.map((r) => {
        const state = r.state === 'active' && r.expires_at.getTime() < Date.now() ? 'expired' : r.state;
        return { id: r.id, state, created_at: r.created_at.toISOString().replace(/\.\d{3}Z$/, 'Z'), expires_at: r.expires_at.toISOString().replace(/\.\d{3}Z$/, 'Z') };
      }),
    },
  };
});

route('DELETE', '/api/dossiers/<id>/preview-links/<link_id>', async (ctx, params) => {
  const account = requireAccount(ctx);
  const dossier = await dossierFor(account.id, params[0]);
  const linkId = params[1];
  const r = await q<{ id: string; state: string; created_at: Date; expires_at: Date }>(
    'select id, state, created_at, expires_at from preview_links where id = $1 and dossier_id = $2',
    [linkId, dossier.id],
  );
  const link = r.rows[0];
  if (!link) throw new ApiError('not_found', 'Preview link not found.');
  const nowActive = link.state === 'active' && link.expires_at.getTime() >= Date.now();
  if (!nowActive) throw new ApiError('preview_link_inactive', 'This preview link is no longer active.');
  try {
    await deletePrefix(`preview/${link.id}/`);
  } catch {
    throw new ApiError('storage_unavailable', 'Preview paused: storage unavailable.');
  }
  await tx(async (client) => {
    await client.query(`update preview_links set state = 'revoked' where id = $1`, [link.id]);
    await client.query('update dossiers set state = $2 where id = $1 and state = $3', [dossier.id, 'draft', 'in_review']);
  });
  return {
    status: 200,
    body: { preview_link: { id: link.id, state: 'revoked', created_at: link.created_at.toISOString().replace(/\.\d{3}Z$/, 'Z'), expires_at: link.expires_at.toISOString().replace(/\.\d{3}Z$/, 'Z') } },
  };
});
