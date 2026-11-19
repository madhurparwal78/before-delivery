import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { ApiError, ValidationError } from '../http/errors.js';
import { json, memberRoute, publicRoute } from '../http/router.js';
import { RANGES, asObject, isEmail, isIanaZone, onlyFields, readString } from '../domain/validate.js';
import { iso } from '../domain/views.js';
import { ensureVenueGroup } from '../providers/keycloak.js';
import { ProviderUnreachable } from '../providers/http.js';
import * as keycloak from '../providers/keycloak.js';
import * as killbill from '../providers/killbill.js';
import * as valkey from '../providers/valkey.js';
import * as svix from '../providers/svix.js';
import * as s3 from '../providers/s3.js';
import * as smtp from '../providers/smtp.js';
import { identityUnavailable, inviteMember } from './owner.js';
import type { Role, Venue } from '../domain/types.js';
import type { Route } from '../http/router.js';

const SLUG = /^[a-z0-9-]{3,20}$/;
const DEFAULT_TAKER_FEE_BPS = 100;
const DEFAULT_MAKER_FEE_BPS = 0;
const DEFAULT_FLAGSHIP = '';

async function postgresUp(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}

export const platformRoutes: Route[] = [
  publicRoute('GET', '/api/health', async () => json(200, { status: 'ok' })),

  memberRoute('GET', '/api/platform/venues', { roles: ['founder_operator'] }, async () => {
    const result = await pool.query<{
      id: string;
      slug: string;
      name: string;
      time_zone: string;
      member_count: number;
      created_at: Date;
    }>(
      `select v.id, v.slug, v.name, v.time_zone, v.created_at,
              (select count(*) from members m where m.venue_id = v.id)::int as member_count
         from venues v order by v.created_at`,
    );
    return json(200, {
      venues: result.rows.map((row) => ({ ...row, created_at: iso(row.created_at) })),
    });
  }),

  memberRoute('POST', '/api/platform/venues', { roles: ['founder_operator'] }, async ({ body }) => {
    const fields = asObject(body);
    onlyFields(fields, ['slug', 'name', 'time_zone', 'owner_email']);
    const slug = readString(fields, 'slug');
    const name = readString(fields, 'name');
    const timeZone = readString(fields, 'time_zone');
    const ownerEmail = readString(fields, 'owner_email');
    const errors: Record<string, string> = {};
    if (!SLUG.test(slug)) errors.slug = 'invalid';
    if (name.trim().length < RANGES.venueName.min || name.length > RANGES.venueName.max) {
      errors.name = 'invalid';
    }
    if (!isIanaZone(timeZone)) errors.time_zone = 'invalid';
    if (!isEmail(ownerEmail)) errors.owner_email = 'invalid';
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);

    const taken = await pool.query('select 1 from venues where slug = $1', [slug]);
    if (taken.rowCount !== 0) throw new ApiError(409, 'slug_taken');

    try {
      await ensureVenueGroup(slug);
    } catch (error) {
      if (error instanceof ProviderUnreachable) throw identityUnavailable();
      throw error;
    }

    const result = await pool.query<{
      id: string;
      slug: string;
      name: string;
      time_zone: string;
      created_at: Date;
    }>(
      `insert into venues (id, slug, name, time_zone, taker_fee_bps, maker_fee_bps, flagship_symbol)
       values ($1,$2,$3,$4,$5,$6,$7) returning id, slug, name, time_zone, created_at`,
      [
        randomUUID(),
        slug,
        name.trim(),
        timeZone,
        DEFAULT_TAKER_FEE_BPS,
        DEFAULT_MAKER_FEE_BPS,
        DEFAULT_FLAGSHIP,
      ],
    );
    const created = result.rows[0] as {
      id: string;
      slug: string;
      name: string;
      time_zone: string;
      created_at: Date;
    };
    const venue: Venue = {
      ...created,
      taker_fee_bps: DEFAULT_TAKER_FEE_BPS,
      maker_fee_bps: DEFAULT_MAKER_FEE_BPS,
      flagship_symbol: DEFAULT_FLAGSHIP,
    };
    const ownerRoles: Role[] = ['org_owner'];
    await inviteMember(venue, ownerEmail, ownerEmail.split('@')[0] as string, ownerRoles);
    return json(201, {
      id: created.id,
      slug: created.slug,
      name: created.name,
      time_zone: created.time_zone,
      member_count: 1,
      created_at: iso(created.created_at),
    });
  }),

  memberRoute('GET', '/api/platform/health', { roles: ['founder_operator'] }, async () => {
    const [keycloakUp, killbillUp, postgres, valkeyUp, svixUp, minioUp, mailpitUp] = await Promise.all([
      keycloak.up(),
      killbill.up(),
      postgresUp(),
      valkey.up(),
      svix.up(),
      s3.up(),
      smtp.up(),
    ]);
    const state = (value: boolean): 'up' | 'down' => (value ? 'up' : 'down');
    return json(200, {
      providers: {
        keycloak: state(keycloakUp),
        killbill: state(killbillUp),
        postgres: state(postgres),
        valkey: state(valkeyUp),
        svix: state(svixUp),
        minio: state(minioUp),
        mailpit: state(mailpitUp),
      },
      checked_at: iso(new Date()),
    });
  }),
];
