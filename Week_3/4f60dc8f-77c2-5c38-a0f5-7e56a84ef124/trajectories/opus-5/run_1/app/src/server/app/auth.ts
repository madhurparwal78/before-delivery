import { fail } from '../http/app-error.js';
import { readCookies, type Ctx } from '../http/kernel.js';
import {
  findBrand,
  findSession,
  type BrandRow,
  type ContactRow,
} from '../db/brands.js';
import { query } from '../db/pool.js';
import { findEngagement, type EngagementRow } from '../db/engagements.js';

export const CLIENT_COOKIE = 'gw_session';
export const STUDIO_COOKIE = 'gw_studio';

export type ClientSession = { brand: BrandRow; contact: ContactRow };

export const optionalClientSession = async (ctx: Ctx): Promise<ClientSession | null> => {
  const token = readCookies(ctx)[CLIENT_COOKIE];
  if (token === undefined) return null;
  const session = await findSession(token);
  if (session === null || session.kind !== 'client' || session.brand_id === null) return null;
  const brand = await findBrand(session.brand_id);
  if (brand === null) return null;
  const contact = (
    await query<ContactRow>(
      'SELECT id, brand_id, role, name, email FROM contacts WHERE id = $1',
      [session.contact_id],
    )
  ).rows[0];
  if (contact === undefined) return null;
  return { brand, contact };
};

export const requireClientSession = async (ctx: Ctx): Promise<ClientSession> => {
  const session = await optionalClientSession(ctx);
  if (session === null) fail('unauthenticated');
  return session as ClientSession;
};

export const hasStudioSession = async (ctx: Ctx): Promise<boolean> => {
  const token = readCookies(ctx)[STUDIO_COOKIE];
  if (token === undefined) return false;
  const session = await findSession(token);
  return session !== null && session.kind === 'studio';
};

export const requireStudioSession = async (ctx: Ctx): Promise<void> => {
  if (!(await hasStudioSession(ctx))) fail('unauthenticated');
};

/** Brand scope: another brand's id answers exactly like a missing one. */
export const brandEngagement = async (
  brandId: string,
  engagementId: string,
): Promise<EngagementRow> => {
  const engagement = await findEngagement(engagementId);
  if (engagement === null || engagement.brand_id !== brandId) fail('not_found');
  return engagement as EngagementRow;
};
