'use strict';

const db = require('../lib/db');
const clock = require('../lib/clock');
const errors = require('../lib/errors');
const validate = require('../lib/validate');

const NAME_MAX = 120;
const MESSAGE_MAX = 5000;
const RATE_LIMIT = 5;
const SOURCES = ['contact', 'sales'];

function inquiryWindowSeconds() {
  const raw = Number(process.env.INQUIRY_RATE_WINDOW_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 600;
}

// Each text field is trimmed, normalised to NFC, then measured in code points.
function readNormalised(raw) {
  if (typeof raw !== 'string') return { ok: false };
  if (validate.hasForbiddenEverywhere(raw)) return { ok: false };
  return { ok: true, value: raw.trim().normalize('NFC') };
}

function readName(raw, fields, field, blankMessage) {
  const read = readNormalised(raw);
  if (!read.ok) {
    fields.add(field, blankMessage);
    return null;
  }
  const single = validate.readSingleLine(read.value, { trim: false });
  if (!single.ok) {
    fields.add(field, blankMessage);
    return null;
  }
  const length = validate.codePointLength(read.value);
  if (length === 0) {
    fields.add(field, blankMessage);
    return null;
  }
  if (length > NAME_MAX) {
    fields.add(field, 'Keep this to 120 characters or fewer');
    return null;
  }
  return read.value;
}

function isHoneypotFilled(website) {
  if (website === undefined || website === null) return false;
  if (typeof website === 'string') return website.trim().length > 0;
  return true;
}

async function create(ctx) {
  const body = ctx.json();

  // The honeypot is answered as a success, before validation and rate counting.
  if (isHoneypotFilled(body.website)) {
    return { status: 201, body: { id: db.newId(), created_at: clock.nowIso() } };
  }

  const fields = new validate.FieldErrors();

  let email = null;
  const emailRead = readNormalised(body.email);
  if (!emailRead.ok) fields.add('email', 'Enter a valid email');
  else {
    const checked = validate.readEmail(emailRead.value);
    if (!checked.ok) fields.add('email', 'Enter a valid email');
    else email = checked.value;
  }

  const firstName = readName(body.first_name, fields, 'first_name', 'Enter your first name');
  const lastName = readName(body.last_name, fields, 'last_name', 'Enter your last name');
  const company = readName(body.company, fields, 'company', 'Enter your company');

  let message = null;
  const messageRead = readNormalised(body.message);
  if (!messageRead.ok) fields.add('message', 'Enter a message');
  else {
    const multi = validate.readMultiLine(messageRead.value, { trim: false });
    if (!multi.ok) fields.add('message', 'Enter a message');
    else {
      const length = validate.codePointLength(messageRead.value);
      if (length === 0) fields.add('message', 'Enter a message');
      else if (length > MESSAGE_MAX) {
        fields.add('message', 'Keep your message to 5,000 characters or fewer');
      } else message = messageRead.value;
    }
  }

  let source = null;
  if (body.source === undefined || body.source === null) source = 'contact';
  else if (typeof body.source !== 'string' || !SOURCES.includes(body.source)) {
    fields.add('source', 'Choose contact or sales');
  } else source = body.source;

  if (fields.any) throw errors.validation(fields.fields);

  // Inquiries for one email are counted one at a time, against stored rows.
  return db.transaction(async (client) => {
    await client.query(
      'INSERT INTO inquiry_email_locks (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [email]
    );
    await client.query('SELECT email FROM inquiry_email_locks WHERE email = $1 FOR UPDATE', [email]);

    const since = new Date(clock.nowMs() - inquiryWindowSeconds() * 1000);
    const stored = await client.query(
      'SELECT count(*)::int AS n FROM inquiries WHERE email = $1 AND created_at > $2',
      [email, since]
    );
    if (stored.rows[0].n >= RATE_LIMIT) throw errors.tooManyRequests('rate_limited');

    const id = db.newId();
    const createdAt = clock.now();
    await client.query(
      `INSERT INTO inquiries (id, email, first_name, last_name, company, message, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, email, firstName, lastName, company, message, source, createdAt]
    );
    return { status: 201, body: { id, created_at: createdAt.toISOString() } };
  });
}

module.exports = { create };
