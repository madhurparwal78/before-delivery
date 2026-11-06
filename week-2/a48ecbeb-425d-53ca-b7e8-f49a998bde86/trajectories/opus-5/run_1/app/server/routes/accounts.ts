import { findProvince } from '../../shared/catalogue.js';
import { accountCopy, checkoutCopy } from '../../shared/copy.js';
import { attachCartToUser } from '../db/cart.js';
import { endSession, SESSION_COOKIE, startSession } from '../db/sessions.js';
import { normalisePostalCode } from '../domain/postal.js';
import { ApiError, conflict, notFound, validationError } from '../http/errors.js';
import type { Route } from '../http/router.js';
import {
  authenticateUser,
  clearOtherDefaults,
  createAddress,
  createUser,
  findUserByEmail,
  getAddress,
  listAddresses,
  updateAddress,
  type PocketBaseAddress,
} from '../services/pocketbase.js';
import { CUSTOMER_ONLY } from './support.js';

function addressBody(address: PocketBaseAddress): unknown {
  return {
    id: address.id,
    name: address.name,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    province: address.province,
    postal_code: address.postal_code,
    is_default: address.is_default,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AddressFields {
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: string;
  postal_code: string;
  is_default: boolean;
}

function readAddress(body: unknown, partial: PocketBaseAddress | null): AddressFields {
  const payload = (body ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const text = (key: keyof AddressFields, fallback: string) => {
    const value = payload[key];
    if (value === undefined) return fallback;
    return typeof value === 'string' ? value.trim() : '';
  };

  const name = text('name', partial?.name ?? '');
  const line1 = text('line1', partial?.line1 ?? '');
  const line2 = text('line2', partial?.line2 ?? '');
  const city = text('city', partial?.city ?? '');
  const provinceCode = text('province', partial?.province ?? '');
  const postal = text('postal_code', partial?.postal_code ?? '');

  if (name === '') fields.name = checkoutCopy.fields.name;
  if (line1 === '') fields.line1 = checkoutCopy.fields.line1;
  if (city === '') fields.city = checkoutCopy.fields.city;
  const province = findProvince(provinceCode);
  if (province === undefined) fields.province = "We don't ship to that province yet.";

  let normalised = postal;
  if (province !== undefined) {
    const result = normalisePostalCode(postal, province.code);
    if (!result.ok) fields.postal_code = checkoutCopy.fields.postalCode(province.name);
    else normalised = result.value;
  }

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return {
    name,
    line1,
    line2,
    city,
    province: provinceCode,
    postal_code: normalised,
    is_default:
      payload.is_default === undefined ? (partial?.is_default ?? false) : payload.is_default === true,
  };
}

export const accountRoutes: readonly Route[] = [
  {
    method: 'POST',
    path: '/api/auth/sign-up',
    handle: async (ctx) => {
      const payload = (ctx.body ?? {}) as Record<string, unknown>;
      const fields: Record<string, string> = {};
      const email = typeof payload.email === 'string' ? payload.email.trim() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!EMAIL_PATTERN.test(email)) fields.email = 'Enter a valid email.';
      if (password.length < 10 || password.length > 128) {
        fields.password = 'Use a password of 10 to 128 characters.';
      }
      if (name.length < 1 || name.length > 80) fields.name = 'Enter your name.';
      if (Object.keys(fields).length > 0) throw validationError(fields);

      if ((await findUserByEmail(email)) !== null) {
        throw conflict('email_taken', accountCopy.emailTaken);
      }
      const user = await createUser({ email, password, name, role: 'customer' });
      const token = await startSession(user);
      if (ctx.cartId !== null) await attachCartToUser(ctx.cartId, user.id);
      return {
        status: 201,
        json: { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
        cookies: [{ name: SESSION_COOKIE, value: token, maxAgeSeconds: 60 * 60 * 24 * 30 }],
      };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/sign-in',
    handle: async (ctx) => {
      const payload = (ctx.body ?? {}) as Record<string, unknown>;
      const email = typeof payload.email === 'string' ? payload.email.trim() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      const user = await authenticateUser(email, password);
      if (user === null) {
        throw new ApiError(401, 'invalid_credentials', accountCopy.invalidCredentials);
      }
      const token = await startSession(user);
      if (ctx.cartId !== null) await attachCartToUser(ctx.cartId, user.id);
      return {
        status: 200,
        json: { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
        cookies: [{ name: SESSION_COOKIE, value: token, maxAgeSeconds: 60 * 60 * 24 * 30 }],
      };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/sign-out',
    body: 'none',
    handle: async (ctx) => {
      const token = ctx.cookies[SESSION_COOKIE];
      if (token !== undefined) await endSession(token);
      return { status: 204, cookies: [{ name: SESSION_COOKIE, value: '', maxAgeSeconds: 0 }] };
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    handle: async (ctx) => ({
      status: 200,
      json: {
        user:
          ctx.user === null
            ? null
            : {
                id: ctx.user.id,
                email: ctx.user.email,
                name: ctx.user.name,
                role: ctx.user.role,
              },
      },
    }),
  },
  {
    method: 'GET',
    path: '/api/addresses',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) => ({
      status: 200,
      json: { addresses: (await listAddresses(ctx.user!.id)).map(addressBody) },
    }),
  },
  {
    method: 'POST',
    path: '/api/addresses',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) => {
      const existing = await listAddresses(ctx.user!.id);
      const input = readAddress(ctx.body, null);
      const makeDefault = input.is_default || existing.length === 0;
      const address = await createAddress({
        user: ctx.user!.id,
        name: input.name,
        line1: input.line1,
        line2: input.line2,
        city: input.city,
        province: input.province,
        postal_code: input.postal_code,
        is_default: makeDefault,
      });
      if (makeDefault) await clearOtherDefaults(ctx.user!.id, address.id);
      return { status: 201, json: { address: addressBody(address) } };
    },
  },
  {
    method: 'PATCH',
    path: '/api/addresses/:id',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) => {
      const current = await getAddress(ctx.params.id!);
      if (current === null || current.user !== ctx.user!.id) throw notFound();
      const input = readAddress(ctx.body, current);
      const address = await updateAddress(current.id, {
        name: input.name,
        line1: input.line1,
        line2: input.line2,
        city: input.city,
        province: input.province,
        postal_code: input.postal_code,
        is_default: input.is_default,
      });
      if (address.is_default) await clearOtherDefaults(ctx.user!.id, address.id);
      return { status: 200, json: { address: addressBody(address) } };
    },
  },
];
