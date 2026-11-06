import type { AppConfig } from './config.js';
import { Store } from './store.js';
import { writeEvent } from './api.js';
import { snapshotJsonBytes, snapshotPngBytes, type Snapshot, type SnapshotWork } from './snapshots.js';
import { display } from './dates.js';
import { sendMail } from './mail.js';
import crypto from 'node:crypto';

export interface PublishOutcome {
  previewId: string;
  recipientCount: number;
}

const CHECK_INTERVAL_MS = 3000;

/**
 * The server-side preview publisher: checks for due previews, freezes one
 * snapshot per lender with placed works, stores them, queues one email per
 * lender and retries queued email while the relay is down.
 */
export class Publisher {
  private running = false;

  constructor(
    private readonly cfg: AppConfig,
    private readonly store: Store,
    private readonly s3: { put(key: string, data: Buffer, contentType: string): Promise<void> },
    private readonly timeZone: string
  ) {}

  start(): void {
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.publishDue();
        await this.retryQueuedMail();
      } catch {
        // next tick retries
      } finally {
        this.running = false;
      }
    };
    tick();
    setInterval(tick, CHECK_INTERVAL_MS).unref();
  }

  private async publishDue(): Promise<void> {
    const { rows } = await this.store.query(
      `SELECT id, publish_at FROM previews WHERE status = 'scheduled' AND publish_at <= now() LIMIT 1`
    );
    for (const row of rows as unknown as { id: string; publish_at: Date }[]) {
      await this.publishOne(row.id, row.publish_at);
    }
  }

  private async publishOne(previewId: string, publishAt: Date): Promise<void> {
    // If the image store is down, stay scheduled until it returns.
    const [placements, lenders, exhibition, walls] = await Promise.all([
      this.store.placements(),
      this.store.lenders(),
      this.store.exhibition(),
      this.store.walls(),
    ]);
    const byLender = new Map<string, typeof placements>();
    for (const p of placements) {
      if (p.lenderId === null) continue;
      const list = byLender.get(p.lenderId) ?? [];
      list.push(p);
      byLender.set(p.lenderId, list);
    }
    const publishedAt = new Date();
    const publishedAtDisplay = display(publishedAt, exhibition.timeZone);

    const recipients: { lenderId: string; token: string; name: string; email: string; works: SnapshotWork[] }[] = [];
    for (const lender of lenders) {
      const works = byLender.get(lender.id) ?? [];
      if (works.length === 0) continue;
      recipients.push({
        lenderId: lender.id,
        token: newToken(),
        name: lender.name,
        email: lender.email,
        works: works.map((p) => ({
          title: p.objectTitle,
          objectNumber: p.objectNumber,
          wallName: p.wallName,
          offsetMm: p.offsetMm,
          centreHeightMm: p.centreHeightMm,
          widthMm: p.widthMm,
          heightMm: p.heightMm,
        })),
      });
    }

    // Freeze the snapshots first; only then flip the status.
    for (const r of recipients) {
      const snapshot: Snapshot = {
        exhibition: {
          title: exhibition.title,
          runStart: exhibition.runStart,
          runEnd: exhibition.runEnd,
        },
        lender: { name: r.name },
        publishedAt: publishedAt.toISOString(),
        publishedAtDisplay,
        walls: walls.map((w) => ({ id: w.id, name: w.name, lengthMm: w.lengthMm, heightMm: w.heightMm })),
        works: orderWorks(r.works, walls),
      };
      await this.s3.put(
        `previews/${previewId}/${r.lenderId}/snapshot.json`,
        snapshotJsonBytes(snapshot),
        'application/json; charset=utf-8'
      );
      await this.s3.put(
        `previews/${previewId}/${r.lenderId}/snapshot.png`,
        snapshotPngBytes(snapshot),
        'image/png'
      );
    }

    await this.store.transaction(async (client) => {
      const locked = await client.query(
        `SELECT status FROM previews WHERE id = $1 FOR UPDATE`, [previewId]
      );
      const status = (locked.rows[0] as unknown as { status: string } | undefined)?.status;
      if (status !== 'scheduled') return;
      await client.query(
        `UPDATE previews SET status = 'published', published_at = $2 WHERE id = $1`,
        [previewId, publishedAt]
      );
      for (const r of recipients) {
        await client.query(
          `INSERT INTO preview_recipients (preview_id, lender_id, token, delivery)
           VALUES ($1, $2, $3, 'queued') ON CONFLICT (preview_id, lender_id) DO NOTHING`,
          [previewId, r.lenderId, r.token]
        );
      }
      await writeEvent(client, {
        kind: 'preview.published',
        actor: null,
        previewId,
        recipientCount: recipients.length,
      });
    });
  }

  private async retryQueuedMail(): Promise<void> {
    const preview = await this.store.preview();
    if (preview.id === null || preview.status !== 'published') return;
    for (const recipient of preview.recipients) {
      if (recipient.delivery !== 'queued') continue;
      try {
        await sendPreviewEmail(this.cfg, this.store, preview.id, recipient.lenderId, recipient.token);
        await this.store.query(
          `UPDATE preview_recipients SET delivery = 'sent', sent_at = now()
           WHERE preview_id = $1 AND lender_id = $2 AND delivery = 'queued'`,
          [preview.id, recipient.lenderId]
        );
      } catch {
        // still queued; retried on the next tick
      }
    }
  }
}

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (const b of bytes) out += alphabet[b % 64];
  return out;
}

const WALL_ORDER = ['North wall', 'East wall', 'South wall', 'West wall'];

function orderWorks(works: SnapshotWork[], walls: { name: string }[]): SnapshotWork[] {
  const names = walls.map((w) => w.name);
  const rank = (name: string) => {
    const idx = names.indexOf(name);
    return idx >= 0 ? idx : names.length + WALL_ORDER.indexOf(name);
  };
  return [...works].sort((a, b) =>
    rank(a.wallName) - rank(b.wallName) || a.offsetMm - b.offsetMm
  );
}

export async function sendPreviewEmail(
  cfg: AppConfig,
  store: Store,
  previewId: string,
  lenderId: string,
  token: string
): Promise<void> {
  const lender = await store.lenderById(lenderId);
  const exhibition = await store.exhibition();
  if (lender === null) return;
  const previewRow = await store.preview();
  const snapshotKey = `previews/${previewId}/${lenderId}/snapshot.json`;
  void snapshotKey;
  const link = `${cfg.publicBaseUrl}/p/${token}`;
  const works = await worksForLender(store, lenderId);
  const text = [
    `Dear ${lender.name},`,
    '',
    `Your loans are now in place in ${exhibition.title} at Ashgrove Museum of Art.`,
    `Published ${previewRow.publishedAt ? display(new Date(previewRow.publishedAt), exhibition.timeZone) : ''}.`,
    '',
    ...works.map((w) => `- ${w.title} (${w.wallName})`),
    '',
    `Open your preview: ${link}`,
    '',
    'This link is private to you. Please don\'t share it.',
  ].join('\n');
  const html = `<p>Dear ${escapeHtml(lender.name)},</p>
<p>Your loans are now in place in <strong>${escapeHtml(exhibition.title)}</strong> at Ashgrove Museum of Art.</p>
<p>Published ${escapeHtml(previewRow.publishedAt ? display(new Date(previewRow.publishedAt), exhibition.timeZone) : '')}.</p>
<ul>${works.map((w) => `<li>${escapeHtml(w.title)} (${escapeHtml(w.wallName)})</li>`).join('')}</ul>
<p><a href="${link}">Open your preview</a></p>
<p>This link is private to you. Please don\'t share it.</p>`;
  await sendMail(cfg.smtp, {
    to: lender.email,
    subject: `Preview of ${exhibition.title}: your loans in place`,
    text,
    html,
  });
}

async function worksForLender(store: Store, lenderId: string): Promise<SnapshotWork[]> {
  const placements = await store.placements();
  return placements
    .filter((p) => p.lenderId === lenderId)
    .map((p) => ({
      title: p.objectTitle,
      objectNumber: p.objectNumber,
      wallName: p.wallName,
      offsetMm: p.offsetMm,
      centreHeightMm: p.centreHeightMm,
      widthMm: p.widthMm,
      heightMm: p.heightMm,
    }));
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sends withdrawal notices to every lender whose preview email went out. */
export async function queueWithdrawalMail(cfg: AppConfig, store: Store, previewId: string): Promise<void> {
  const preview = await store.preview();
  const exhibition = await store.exhibition();
  if (preview.id !== previewId) return;
  for (const recipient of preview.recipients) {
    if (recipient.delivery !== 'sent') continue;
    const lender = await store.lenderById(recipient.lenderId);
    if (lender === null) continue;
    try {
      await sendMail(cfg.smtp, {
        to: lender.email,
        subject: `Preview withdrawn: ${exhibition.title}`,
        text: `Dear ${lender.name},\n\nThe preview of ${exhibition.title} has been withdrawn by the museum. The earlier link no longer works.\n`,
        html: `<p>Dear ${escapeHtml(lender.name)},</p><p>The preview of <strong>${escapeHtml(exhibition.title)}</strong> has been withdrawn by the museum. The earlier link no longer works.</p>`,
      });
    } catch {
      // The notice is best-effort; the withdrawal itself is done.
    }
  }
}

/** Queues (sends) preview emails right after publish. Kept for the API module. */
export async function queuePreviewMail(): Promise<void> {
  // Sending happens in the publisher's retry loop; nothing to do here.
}
