import { computeBoundary, type CandidateNote } from '../shared/boundary';
import { PUBLIC_COPY } from '../shared/copy';
import { renderDossier, type DossierRender } from '../shared/dossier';
import { nextDossierState } from '../shared/lifecycle';
import { addSeconds, formatDisplayTime } from '../shared/time';
import type { AccountRow } from './auth';
import { hashToken, newId, newToken } from './auth';
import { LOCK_CLASS_PUBLISH } from './db';
import { ApiError, storageUnavailable } from './errors';
import {
  previewLinkState,
  type DossierRow,
  type PreviewLinkRow,
} from './serialize';
import type { Services } from './services';
import {
  previewObjectKey,
  previewPrefix,
  publishObjectKey,
  publishPrefix,
  StorageUnavailableError,
} from './storage';

export interface PageRecord {
  note_id: string;
  page_slug: string;
}

export interface RenderRequest {
  dossier: DossierRow;
  owner: AccountRow;
  notes: readonly CandidateNote[];
  radius: number;
}

function invalidTransition(state: string): ApiError {
  return new ApiError(409, 'invalid_transition', 'This dossier cannot make that move.', { state });
}

export class Publisher {
  constructor(private readonly services: Services) {}

  /** Renders every object of a dossier. A preview renders under its own link token. */
  private render(request: RenderRequest, options: { previewToken: string | null; at: Date }): DossierRender {
    const preview = options.previewToken !== null;
    const footerCount = (count: number): string =>
      preview
        ? PUBLIC_COPY.draftFooter(count)
        : PUBLIC_COPY.publishedFooter(formatDisplayTime(options.at, request.owner.time_zone), count);
    const banner = preview
      ? PUBLIC_COPY.draftBanner(
          formatDisplayTime(
            addSeconds(options.at, this.services.config.timers.previewTtlSeconds),
            request.owner.time_zone,
          ),
        )
      : null;

    const boundary = computeBoundary(request.notes, request.dossier.root_note_id, request.radius);

    return renderDossier({
      notes: request.notes,
      rootNoteId: request.dossier.root_note_id,
      radius: request.radius,
      siteBaseUrl: this.services.config.publicUrl,
      basePath: preview ? `/p/${options.previewToken}/` : `/d/${request.dossier.slug}/`,
      footer: footerCount(boundary.publicCount),
      draftPreviewBanner: banner,
      assets: this.services.readerAssets,
      withSearchAndSitemap: !preview,
    });
  }

  /** Writes every object under a fresh publish id and only then switches the live pointer. */
  async publish(request: RenderRequest): Promise<DossierRow> {
    const target = nextDossierState(request.dossier.state, 'publish');
    if (!target) throw invalidTransition(request.dossier.state);

    const outcome = await this.services.db.withAdvisoryLock(LOCK_CLASS_PUBLISH, request.dossier.id, async () => {
      const at = new Date();
      const render = this.render(request, { previewToken: null, at });
      const publishId = newId();

      try {
        for (const object of render.objects) {
          await this.services.store.put(
            publishObjectKey(request.dossier.slug, publishId, object.key),
            object.body,
            object.contentType,
          );
        }
      } catch (error) {
        if (error instanceof StorageUnavailableError) throw storageUnavailable();
        throw error;
      }

      const pages: PageRecord[] = render.pages.map((page) => ({ note_id: page.noteId, page_slug: page.pageSlug }));
      const updated = await this.services.db.transaction(async (client) => {
        await client.query(
          `insert into publish_manifests (publish_id, dossier_id, radius, public_count, severed_count, pages, object_keys)
             values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            publishId,
            request.dossier.id,
            request.radius,
            render.boundary.publicCount,
            render.boundary.severedCount,
            JSON.stringify(pages),
            JSON.stringify(render.objects.map((object) => object.key)),
          ],
        );
        await client.query(
          `update preview_links set state = 'revoked' where dossier_id = $1 and state = 'active'`,
          [request.dossier.id],
        );
        const row = await client.query<DossierRow>(
          `update dossiers
              set state = $2, radius = $3, public_count = $4, severed_count = $5,
                  published_at = $6, live_publish_id = $7
            where id = $1
            returning id, account_id, slug, root_note_id, state, radius, public_count, severed_count,
                      published_at, live_publish_id`,
          [
            request.dossier.id,
            target,
            request.radius,
            render.boundary.publicCount,
            render.boundary.severedCount,
            at,
            publishId,
          ],
        );
        return row.rows[0] ?? request.dossier;
      });

      await this.deleteReplacedObjects(request.dossier.id, request.dossier.slug, publishId);
      return updated;
    });

    if (!outcome) {
      throw new ApiError(409, 'publish_in_progress', 'Another publish of this dossier is still running.');
    }
    return outcome;
  }

  private async deleteReplacedObjects(dossierId: string, slug: string, livePublishId: string): Promise<void> {
    const stale = await this.services.db.query<{ publish_id: string }>(
      'select publish_id from publish_manifests where dossier_id = $1 and publish_id <> $2',
      [dossierId, livePublishId],
    );
    for (const row of stale) {
      try {
        await this.services.store.deletePrefix(`${publishPrefix(slug)}${row.publish_id}/`);
        await this.services.db.query('delete from publish_manifests where publish_id = $1', [row.publish_id]);
      } catch (error) {
        if (!(error instanceof StorageUnavailableError)) throw error;
      }
    }
  }

  /** Clears the live pointer first, then removes every object before reporting success. */
  async withdraw(dossier: DossierRow, action: 'unpublish' | 'takedown'): Promise<DossierRow> {
    const target = nextDossierState(dossier.state, action);
    if (!target) throw invalidTransition(dossier.state);

    await this.services.db.query('update dossiers set live_publish_id = null where id = $1', [dossier.id]);

    try {
      await this.services.store.deletePrefix(publishPrefix(dossier.slug));
      const left = await this.services.store.list(publishPrefix(dossier.slug));
      if (left.length > 0) throw storageUnavailable();
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }

    const row = await this.services.db.one<DossierRow>(
      `update dossiers set state = $2, published_at = null
         where id = $1
         returning id, account_id, slug, root_note_id, state, radius, public_count, severed_count,
                   published_at, live_publish_id`,
      [dossier.id, target],
    );
    await this.services.db.query('delete from publish_manifests where dossier_id = $1', [dossier.id]);
    return row ?? { ...dossier, state: target, live_publish_id: null, published_at: null };
  }

  async createPreviewLink(request: RenderRequest): Promise<{ link: PreviewLinkRow; token: string }> {
    const target = nextDossierState(request.dossier.state, 'create_preview_link');
    if (!target) throw invalidTransition(request.dossier.state);

    const at = new Date();
    const linkId = newId();
    const token = newToken();
    const render = this.render(request, { previewToken: token, at });

    try {
      for (const object of render.objects) {
        await this.services.store.put(previewObjectKey(linkId, object.key), object.body, object.contentType);
      }
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }

    const pages: PageRecord[] = render.pages.map((page) => ({ note_id: page.noteId, page_slug: page.pageSlug }));
    const expiresAt = addSeconds(at, this.services.config.timers.previewTtlSeconds);
    const replaced = await this.services.db.transaction(async (client) => {
      const previous = await client.query<{ id: string }>(
        `update preview_links set state = 'replaced' where dossier_id = $1 and state = 'active' returning id`,
        [request.dossier.id],
      );
      await client.query(
        `insert into preview_links (id, dossier_id, token_hash, state, pages, object_keys, created_at, expires_at)
           values ($1, $2, $3, 'active', $4, $5, $6, $7)`,
        [
          linkId,
          request.dossier.id,
          hashToken(token),
          JSON.stringify(pages),
          JSON.stringify(render.objects.map((object) => object.key)),
          at,
          expiresAt,
        ],
      );
      await client.query('update dossiers set state = $2 where id = $1', [request.dossier.id, target]);
      return previous.rows.map((row) => row.id);
    });

    for (const id of replaced) {
      await this.removePreviewObjects(id).catch(() => undefined);
    }

    return {
      link: { id: linkId, dossier_id: request.dossier.id, state: 'active', created_at: at, expires_at: expiresAt },
      token,
    };
  }

  async revokePreviewLink(dossier: DossierRow, link: PreviewLinkRow): Promise<PreviewLinkRow> {
    if (previewLinkState(link, new Date()) !== 'active') {
      throw new ApiError(409, 'preview_link_inactive', 'That preview link is no longer active.');
    }
    await this.removePreviewObjects(link.id);
    await this.services.db.transaction(async (client) => {
      await client.query(`update preview_links set state = 'revoked' where id = $1`, [link.id]);
      if (dossier.state === 'in_review') {
        await client.query(`update dossiers set state = 'draft' where id = $1`, [dossier.id]);
      }
    });
    return { ...link, state: 'revoked' };
  }

  async removePreviewObjects(linkId: string): Promise<void> {
    try {
      await this.services.store.deletePrefix(previewPrefix(linkId));
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
  }
}
