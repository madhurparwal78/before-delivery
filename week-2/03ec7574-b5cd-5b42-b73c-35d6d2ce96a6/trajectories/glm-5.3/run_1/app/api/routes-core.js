import { errors, sendData } from '../lib/http.js';
import { newId, formatTs } from '../lib/core.js';
import { textField, checkControl, cpLength, nfc } from '../lib/text.js';
import { verifyLogin, createSession } from '../lib/session.js';
import { memberResponse } from '../lib/shapes.js';
import { withTransaction, withClient, isReady } from '../lib/db.js';
import { isDbError } from './pipeline.js';

export const contactVolumes = ['Under $1M', '$1M to $10M', '$10M to $100M', 'Over $100M'];
export const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com']);

function controlError(field) {
  return errors.validation(field, 'Remove control characters from this field');
}

export function validateContact(body) {
  // Pinned field order: full_name, work_email, company, monthly_volume, message.
  for (const k of Object.keys(body)) {
    if (!['full_name', 'work_email', 'company', 'monthly_volume', 'message'].includes(k)) {
      throw errors.unknownField(k);
    }
  }
  const fullName = contactText(body.full_name, 'full_name', 'Enter your full name (2 to 80 characters)', 2, 80);
  const workEmail = contactEmail(body.work_email);
  const company = contactText(body.company, 'company', 'Enter your company name (2 to 120 characters)', 2, 120);
  const volume = body.monthly_volume;
  if (typeof volume !== 'string' || !contactVolumes.includes(volume)) {
    throw errors.validation('monthly_volume', 'Choose a monthly volume');
  }
  if (typeof body.message !== 'string') {
    throw errors.validation('message', 'Tell us a little more (10 to 2000 characters)');
  }
  let message = nfc(body.message);
  // The one place CRLF pairs are folded to single line feeds; other controls refused.
  message = message.replace(/\r\n/g, '\n');
  if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(message)) {
    throw controlError('message');
  }
  const len = cpLength(message);
  if (len < 10 || len > 2000) {
    throw errors.validation('message', 'Tell us a little more (10 to 2000 characters)');
  }
  return { full_name: fullName, work_email: workEmail, company, monthly_volume: volume, message };
}

function contactText(value, field, message, min, max) {
  if (typeof value !== 'string') throw errors.validation(field, message);
  const s = nfc(value).trim();
  checkControl(s, field);
  const len = cpLength(s);
  if (len < min || len > max) throw errors.validation(field, message);
  return s;
}

function contactEmail(value) {
  if (typeof value !== 'string') throw errors.validation('work_email', 'Enter a valid email address');
  const s = nfc(value).trim();
  if (s.length === 0 || s.length > 254) throw errors.validation('work_email', 'Enter a valid email address');
  if (/[\u0000-\u001f\u007f-\u009f]/.test(s)) throw controlError('work_email');
  const at = s.lastIndexOf('@');
  if (at < 1 || at === s.length - 1) throw errors.validation('work_email', 'Enter a valid email address');
  const domain = s.slice(at + 1).toLowerCase();
  if (FREE_MAIL.has(domain)) throw errors.validation('work_email', 'Use your work email');
  return s;
}

export const coreRoutes = [
  {
    method: 'GET', pattern: /^\/api\/v1\/health$/, auth: 'public',
    async handler(ctx, { send }) {
      await withClient((client) => client.query('SELECT 1'));
      send(200, { status: 'ok' });
    },
  },
  {
    method: 'POST', pattern: /^\/api\/v1\/auth\/login$/, auth: 'public', bodyKeys: ['email', 'password'],
    async handler(ctx, { body, send, setCookie }) {
      const email = body.email;
      if (typeof email !== 'string' || typeof body.password !== 'string') {
        throw errors.badCredentials();
      }
      const member = await withClient((client) => verifyLogin(client, email, body.password));
      const token = await withTransaction((client) => createSession(client, member.id));
      const { rows: [org] } = await withClient((client) =>
        client.query('SELECT id, name, app_id FROM organizations WHERE id = $1', [member.organization_id]));
      setCookie(`corvo_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
      send(200, {
        token,
        member: memberResponse(member),
        organization: { id: org.id, name: org.name, app_id: org.app_id },
      });
    },
  },
  {
    method: 'POST', pattern: /^\/api\/v1\/auth\/logout$/, auth: 'members', bodyKeys: [],
    async handler(ctx, { send, clearCookie }) {
      await withTransaction((client) => client.query('DELETE FROM sessions WHERE token_hash = $1', [ctx.tokenHash]));
      clearCookie('corvo_session');
      send(200, {});
    },
  },
  {
    method: 'GET', pattern: /^\/api\/v1\/me$/, auth: 'any',
    async handler(ctx, { send }) {
      const { rows: [org] } = await withClient((client) =>
        client.query('SELECT id, name, app_id FROM organizations WHERE id = $1', [ctx.organization_id]));
      const organization = { id: org.id, name: org.name, app_id: org.app_id };
      if (ctx.kind === 'api_key') {
        send(200, { member: null, api_key: {
          id: ctx.apiKey.id, name: ctx.apiKey.name, role: ctx.apiKey.role, prefix: ctx.apiKey.prefix,
          created_by: ctx.apiKey.created_by, created_at: formatTs(ctx.apiKey.created_at),
          revoked_at: ctx.apiKey.revoked_at ? formatTs(ctx.apiKey.revoked_at) : null,
        }, organization });
        return;
      }
      send(200, { member: memberResponse(ctx.member), api_key: null, organization });
    },
  },
  {
    method: 'POST', pattern: /^\/api\/v1\/contact$/, auth: 'public',
    bodyKeys: ['full_name', 'work_email', 'company', 'monthly_volume', 'message'],
    async handler(ctx, { body, send }) {
      const valid = validateContact(body);
      const id = newId('con');
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO contact_requests (id, full_name, work_email, company, monthly_volume, message, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, valid.full_name, valid.work_email, valid.company, valid.monthly_volume, valid.message, new Date()]);
      });
      send(201, { id, created_at: formatTs(new Date()) });
    },
  },
];
