import { query, withTransaction } from '../db/pool.js';
import { memberShape } from '../db/repo.js';
import { hashSecret, verifyPassword } from '../domain/credentials.js';
import { newId, newToken } from '../domain/ids.js';
import { checkText, hasControlCharacters, normaliseText } from '../domain/text.js';
import { formatTimestamp } from '../domain/time.js';
import { ApiError } from '../http/errors.js';
import { ensureKnownFields, validationError } from '../http/validate.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const FREE_MAIL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com']);
export const MONTHLY_VOLUMES = ['Under $1M', '$1M to $10M', '$10M to $100M', 'Over $100M'];

export const CONTACT_MESSAGES = {
  full_name: 'Enter your full name (2 to 80 characters)',
  work_email: 'Enter a valid email address',
  work_email_free: 'Use your work email',
  company: 'Enter your company name (2 to 120 characters)',
  monthly_volume: 'Choose a monthly volume',
  message: 'Tell us a little more (10 to 2000 characters)',
  control: 'Remove control characters from this field'
};

export function organizationShape(organization) {
  return { id: organization.id, name: organization.name, app_id: organization.app_id };
}

export async function login(ctx) {
  ensureKnownFields(ctx.body, { email: true, password: true });
  if (typeof ctx.body.email !== 'string') throw validationError('email');
  if (typeof ctx.body.password !== 'string') throw validationError('password');
  const email = normaliseText(ctx.body.email).trim().toLowerCase();

  const result = await query(
    `SELECT m.*, o.id AS organization_id, o.name AS organization_name, o.app_id
       FROM members m JOIN organizations o ON o.id = m.organization_id WHERE m.email = $1`,
    [email]
  );
  const member = result.rows[0];
  if (!member || !verifyPassword(ctx.body.password, member.password_hash)) throw new ApiError('BAD_CREDENTIALS');

  const token = newToken();
  await query(
    'INSERT INTO sessions (id, member_id, token_hash, created_at) VALUES ($1, $2, $3, date_trunc(\'second\', now()))',
    [newId('ses_'), member.id, hashSecret(token)]
  );
  return {
    status: 200,
    data: {
      token,
      member: memberShape(member),
      organization: { id: member.organization_id, name: member.organization_name, app_id: member.app_id }
    }
  };
}

export async function logout(ctx) {
  await query('DELETE FROM sessions WHERE id = $1', [ctx.principal.sessionId]);
  return { status: 200, data: {} };
}

export async function me(ctx) {
  return {
    status: 200,
    data: {
      member: ctx.principal.member ? memberShape(ctx.principal.member) : null,
      api_key: ctx.principal.apiKey
        ? {
          id: ctx.principal.apiKey.id,
          name: ctx.principal.apiKey.name,
          role: ctx.principal.apiKey.role,
          prefix: ctx.principal.apiKey.prefix,
          created_by: ctx.principal.apiKey.created_by,
          created_at: formatTimestamp(ctx.principal.apiKey.created_at),
          revoked_at: formatTimestamp(ctx.principal.apiKey.revoked_at)
        }
        : null,
      organization: organizationShape(ctx.principal.organization)
    }
  };
}

function contactFieldError(field, message) {
  return new ApiError('VALIDATION_ERROR', { message, details: { field } });
}

function textFieldErrors(raw, limitName, field, message) {
  if (typeof raw !== 'string') return [{ field, message }];
  if (hasControlCharacters(normaliseText(raw).trim())) return [{ field, message: CONTACT_MESSAGES.control }];
  return checkText(raw, limitName, { trim: true }).ok ? [] : [{ field, message }];
}

/**
 * The one place the contact field rules live, in the pinned field order.
 * The route reports the first error; the page shows them all.
 */
export function checkContact(body) {
  const errors = [
    ...textFieldErrors(body.full_name, 'contactFullName', 'full_name', CONTACT_MESSAGES.full_name)
  ];

  const email = typeof body.work_email === 'string' ? normaliseText(body.work_email).trim().toLowerCase() : null;
  if (email === null) errors.push({ field: 'work_email', message: CONTACT_MESSAGES.work_email });
  else if (hasControlCharacters(email)) errors.push({ field: 'work_email', message: CONTACT_MESSAGES.control });
  else if (!EMAIL_PATTERN.test(email) || email.length > 254) errors.push({ field: 'work_email', message: CONTACT_MESSAGES.work_email });
  else if (FREE_MAIL_DOMAINS.has(email.slice(email.lastIndexOf('@') + 1))) {
    errors.push({ field: 'work_email', message: CONTACT_MESSAGES.work_email_free });
  }

  errors.push(...textFieldErrors(body.company, 'contactCompany', 'company', CONTACT_MESSAGES.company));

  if (!MONTHLY_VOLUMES.includes(body.monthly_volume)) {
    errors.push({ field: 'monthly_volume', message: CONTACT_MESSAGES.monthly_volume });
  }

  let message = null;
  if (typeof body.message !== 'string') errors.push({ field: 'message', message: CONTACT_MESSAGES.message });
  else {
    message = normaliseText(body.message).replace(/\r\n/g, '\n');
    const length = [...message].length;
    if (hasControlCharacters(message.replace(/\n/g, ''))) errors.push({ field: 'message', message: CONTACT_MESSAGES.control });
    else if (length < 10 || length > 2000) errors.push({ field: 'message', message: CONTACT_MESSAGES.message });
  }

  const values = {
    full_name: typeof body.full_name === 'string' ? normaliseText(body.full_name).trim() : '',
    work_email: email || '',
    company: typeof body.company === 'string' ? normaliseText(body.company).trim() : '',
    monthly_volume: MONTHLY_VOLUMES.includes(body.monthly_volume) ? body.monthly_volume : '',
    message: message || ''
  };
  return { errors, values };
}

export function validateContact(body) {
  const { errors, values } = checkContact(body);
  if (errors.length) throw contactFieldError(errors[0].field, errors[0].message);
  return values;
}

export async function createContactRequest(ctx) {
  ensureKnownFields(ctx.body, { full_name: true, work_email: true, company: true, monthly_volume: true, message: true });
  const fields = validateContact(ctx.body);
  const id = newId('con_');
  const created = await withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO contact_requests (id, full_name, work_email, company, monthly_volume, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, date_trunc('second', now())) RETURNING created_at`,
      [id, fields.full_name, fields.work_email, fields.company, fields.monthly_volume, fields.message]
    );
    return result.rows[0].created_at;
  });
  return { status: 201, data: { id, created_at: formatTimestamp(created) } };
}
