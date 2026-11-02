import crypto from 'node:crypto';
import { CANADIAN_REGION_CODES, STOCKISTS } from '../../shared/catalogue.js';
import { applicationCopy } from '../../shared/copy.js';
import { isoTimestamp } from '../../shared/time.js';
import { query, queryOne } from '../db/pool.js';
import {
  LICENCE_CONTENT_TYPES,
  parseMultipart,
  sniffLicenceType,
} from '../domain/multipart.js';
import { notFound, tooLarge, unsupportedType, validationError } from '../http/errors.js';
import type { Route } from '../http/router.js';
import { objectKeys, putObjectOnce } from '../services/files.js';

const EARTH_RADIUS_KM = 6371;
const LICENCE_LIMIT_BYTES = 5_000_000;

/** Great-circle distance on a sphere of radius 6371 km, in kilometres. */
function distanceKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLng / 2) ** 2;
  return (
    Math.round(
      EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)) * 10,
    ) / 10
  );
}

interface ApplicationRow {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  province: string;
  licence_extension: string;
  licence_content_type: string;
  status: string;
  submitted_at: Date;
}

export function applicationBody(row: ApplicationRow): unknown {
  return {
    id: row.id,
    status: row.status,
    business_name: row.business_name,
    submitted_at: isoTimestamp(row.submitted_at),
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export const stockistRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/stockists',
    handle: async (ctx) => {
      const latText = ctx.query.get('lat');
      const lngText = ctx.query.get('lng');
      if (latText === null || lngText === null) {
        return {
          status: 200,
          json: {
            stockists: [...STOCKISTS]
              .sort((left, right) => left.name.localeCompare(right.name))
              .map((stockist) => ({ ...stockist, distance_km: null })),
          },
        };
      }
      const lat = Number(latText);
      const lng = Number(lngText);
      const fields: Record<string, string> = {};
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        fields.lat = 'Latitude runs from -90 to 90.';
      }
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        fields.lng = 'Longitude runs from -180 to 180.';
      }
      if (Object.keys(fields).length > 0) throw validationError(fields);

      const nearest = STOCKISTS.map((stockist) => ({
        ...stockist,
        distance_km: distanceKm({ lat, lng }, stockist),
      }))
        .sort(
          (left, right) =>
            left.distance_km - right.distance_km || left.name.localeCompare(right.name),
        )
        .slice(0, 5);
      return { status: 200, json: { stockists: nearest } };
    },
  },
  {
    method: 'POST',
    path: '/api/retailer-applications',
    body: 'upload',
    handle: async (ctx) => {
      const contentType = String(ctx.headers['content-type'] ?? '');
      const parsed = parseMultipart(ctx.rawBody, contentType);
      if (parsed === null) throw unsupportedType();

      const licence = parsed.files.find((file) => file.field === 'licence');
      if (licence !== undefined && licence.content.byteLength > LICENCE_LIMIT_BYTES) {
        throw tooLarge();
      }
      const kind = licence === undefined ? null : sniffLicenceType(licence.content);
      if (licence !== undefined && kind === null) throw unsupportedType();

      const fields: Record<string, string> = {};
      const businessName = (parsed.fields.business_name ?? '').trim();
      const contactName = (parsed.fields.contact_name ?? '').trim();
      const email = (parsed.fields.email ?? '').trim();
      const province = (parsed.fields.province ?? '').trim().toUpperCase();
      if (businessName.length < 2 || businessName.length > 120) {
        fields.business_name = applicationCopy.fields.businessName;
      }
      if (contactName.length < 2 || contactName.length > 80) {
        fields.contact_name = applicationCopy.fields.contactName;
      }
      if (!EMAIL_PATTERN.test(email)) fields.email = applicationCopy.fields.email;
      if (!CANADIAN_REGION_CODES.includes(province)) {
        fields.province = applicationCopy.fields.province;
      }
      if (licence === undefined || kind === null) {
        fields.licence = applicationCopy.fields.unsupportedType;
      }
      if (Object.keys(fields).length > 0) throw validationError(fields);

      const id = crypto.randomUUID();
      // The licence is stored before the application is recorded: if storing
      // fails, nothing is recorded.
      await putObjectOnce(
        objectKeys.licence(id, kind!),
        licence!.content,
        LICENCE_CONTENT_TYPES[kind!],
      );
      const rows = await query<ApplicationRow>(
        `insert into retailer_applications (
           id, business_name, contact_name, email, province,
           licence_extension, licence_content_type, status
         ) values ($1,$2,$3,$4,$5,$6,$7,'submitted') returning *`,
        [id, businessName, contactName, email, province, kind!, LICENCE_CONTENT_TYPES[kind!]],
      );
      return { status: 201, json: { application: applicationBody(rows[0]!) } };
    },
  },
  {
    method: 'GET',
    path: '/api/retailer-applications/:id',
    handle: async (ctx) => {
      if (!isUuid(ctx.params.id!)) throw notFound();
      const row = await queryOne<ApplicationRow>(
        'select * from retailer_applications where id = $1',
        [ctx.params.id!],
      );
      if (row === null) throw notFound();
      return { status: 200, json: { application: applicationBody(row) } };
    },
  },
];
