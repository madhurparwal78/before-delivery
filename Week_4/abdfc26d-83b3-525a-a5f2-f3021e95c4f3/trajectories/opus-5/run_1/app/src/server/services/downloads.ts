import type { DownloadLink } from '../../shared/api.js';
import { query } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { objectExists, presignDownload, StorageUnavailable } from '../providers/storage.js';
import { hasRole, type Principal } from '../auth/identity.js';

type DownloadKind = 'export' | 'invoice';

interface DownloadRow {
  collector_id: string;
  state: string;
  edition_number: number;
  piece_slug: string;
  invoice_number: string | null;
  invoice_status: string;
  invoice_object_key: string | null;
  export_object_key: string | null;
  export_format: 'mp4' | 'webm' | null;
}

const PAID_STATES = new Set(['paid', 'invoiced', 'receipted', 'refunded']);

/**
 * Issues a fresh short-lived link only to the order's owner. Every other user
 * gets the same 404 as for a missing order.
 */
export async function orderDownload(
  viewer: Principal,
  orderId: string,
  kind: DownloadKind,
): Promise<DownloadLink> {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) throw ApiError.notFound();

  const result = await query<DownloadRow>(
    `SELECT o.collector_id, o.state, o.edition_number, o.invoice_number, o.invoice_status,
            o.invoice_object_key, p.slug AS piece_slug,
            export_render.object_key AS export_object_key,
            export_render.format AS export_format
     FROM edition_orders o
     JOIN pieces p ON p.id = o.piece_id
     LEFT JOIN render_jobs export_render ON export_render.id = p.export_render_id
     WHERE o.id = $1`,
    [orderId],
  );
  const order = result.rows[0];
  if (!order) throw ApiError.notFound();
  if (order.collector_id !== viewer.id && !hasRole(viewer, 'founder-operator')) {
    throw ApiError.notFound();
  }

  if (!PAID_STATES.has(order.state)) {
    throw ApiError.invalidTransition('That order has not been paid yet.');
  }

  let key: string | null;
  let filename: string;
  if (kind === 'invoice') {
    if (order.invoice_status !== 'ready' || !order.invoice_object_key) {
      throw new ApiError(409, 'invoice_pending', 'That invoice PDF is still rendering.', {
        detail: { invoice_number: order.invoice_number },
      });
    }
    key = order.invoice_object_key;
    filename = `${order.invoice_number}.pdf`;
  } else {
    key = order.export_object_key;
    filename = `${order.piece_slug}-edition-${order.edition_number}.${order.export_format ?? 'mp4'}`;
  }
  if (!key) throw ApiError.notFound();

  try {
    if (!(await objectExists(key))) throw ApiError.notFound();
    const link = await presignDownload(key, filename);
    return { url: link.url, expires_in: link.expiresIn };
  } catch (error) {
    if (error instanceof StorageUnavailable) throw ApiError.storageUnavailable();
    throw error;
  }
}
