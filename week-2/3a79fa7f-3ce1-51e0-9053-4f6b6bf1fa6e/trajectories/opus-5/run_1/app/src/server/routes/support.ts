import { isoSeconds, now } from '../clock.js';
import { one, pool, query, withTransaction } from '../db.js';
import { NOT_FOUND_CASE, NOT_FOUND_ORDER, fail, failValidation } from '../errors.js';
import { reply, type Router } from '../http.js';
import { buildFromCode } from '../domain/buildstore.js';
import {
  EMAIL_MESSAGE,
  PHONE_MESSAGE,
  isBoundedText,
  isSafeText,
  isValidEmail,
  isValidPhone,
  normaliseEmail,
  normaliseMessage,
} from '../domain/validate.js';
import { monthShort, weekdayShort, zonedToUtc } from '../tz.js';
import { queueNotice } from '../services/notices.js';

const LOOKUP_WINDOW_SECONDS = 900;
const LOOKUP_LIMIT = 5;
const CALLBACK_LEAD_SECONDS = 7200;
const CALLBACK_HORIZON_SECONDS = 2592000;

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Puerto_Rico',
  'America/Toronto',
  'Europe/Berlin',
  'Europe/Paris',
  'Australia/Sydney',
];

const TOPICS = ['Choosing a board', 'Demo or lesson', 'Order or delivery', 'Trade-in', 'Protection plan'];

async function enforceLookupLimit(email: string, at: Date): Promise<void> {
  const since = new Date(at.getTime() - LOOKUP_WINDOW_SECONDS * 1000);
  const counted = await query<{ count: string; oldest: Date | null }>(
    'SELECT count(*) AS count, min(at) AS oldest FROM lookup_misses WHERE email = $1 AND at > $2',
    [email, since],
  );
  const row = counted[0];
  if (!row || Number(row.count) < LOOKUP_LIMIT || !row.oldest) return;
  const waitMs = row.oldest.getTime() + LOOKUP_WINDOW_SECONDS * 1000 - at.getTime();
  fail('too_many_attempts', { headers: { 'Retry-After': String(Math.max(0, Math.ceil(waitMs / 1000))) } });
}

async function recordMiss(email: string, at: Date): Promise<void> {
  await query('INSERT INTO lookup_misses (email, at) VALUES ($1, $2)', [email, at]);
}

function callbackLocalStart(value: string, timezone: string): Date {
  return zonedToUtc(
    {
      year: Number(value.slice(0, 4)),
      month: Number(value.slice(5, 7)),
      day: Number(value.slice(8, 10)),
      hour: Number(value.slice(11, 13)),
      minute: Number(value.slice(14, 16)),
      second: 0,
    },
    timezone,
  );
}

function callbackBodyLines(input: {
  name: string;
  reference: string;
  localStart: string;
  timezone: string;
  utcStart: Date;
  buildCode: string | null;
}): string {
  const firstName = input.name.split(' ')[0] ?? input.name;
  const date = input.localStart.slice(0, 10);
  const day = Number(input.localStart.slice(8, 10));
  const month = monthShort(Number(input.localStart.slice(5, 7)));
  const year = input.localStart.slice(0, 4);
  const localTime = input.localStart.slice(11, 16);
  const utcTime = `${String(input.utcStart.getUTCHours()).padStart(2, '0')}:${String(input.utcStart.getUTCMinutes()).padStart(2, '0')}`;
  const lines = [
    `Hi ${firstName},`,
    `Reference ${input.reference}`,
    `We will call you on ${weekdayShort(date)} ${day} ${month} ${year} at ${localTime} ${input.timezone} (${utcTime} UTC).`,
  ];
  if (input.buildCode) lines.push(`Build ${input.buildCode}`);
  return lines.join('\n');
}

export function registerSupportRoutes(router: Router): void {
  router.add('POST', '/api/callbacks', 'anyone', async (ctx) => {
    const at = now();
    const fields: Record<string, string> = {};
    const { name, email, phone, timezone, preferred_start: preferredStart, topic, message } = ctx.body;

    if (!isSafeText(name, 2, 60)) fields.name = 'Enter your name.';
    if (!isValidEmail(email)) fields.email = EMAIL_MESSAGE;
    if (!isValidPhone(phone)) fields.phone = PHONE_MESSAGE;
    const zone = typeof timezone === 'string' && TIMEZONES.includes(timezone) ? timezone : null;
    if (!zone) fields.timezone = 'Choose a timezone.';
    if (typeof topic !== 'string' || !TOPICS.includes(topic)) fields.topic = 'Choose a topic.';
    const note = message === undefined ? '' : message;
    if (!isBoundedText(note, 0, 1000)) fields.message = 'Keep your message under 1000 characters.';

    let utcStart: Date | null = null;
    if (typeof preferredStart !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(preferredStart)) {
      fields.preferred_start = 'Choose a date and time.';
    } else {
      const month = Number(preferredStart.slice(5, 7));
      const day = Number(preferredStart.slice(8, 10));
      const hour = Number(preferredStart.slice(11, 13));
      const minute = Number(preferredStart.slice(14, 16));
      if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23) {
        fields.preferred_start = 'Choose a date and time.';
      } else if (minute !== 0 && minute !== 30) {
        fields.preferred_start = 'Choose a time on the hour or half hour.';
      } else if (zone) {
        const weekday = weekdayShort(preferredStart.slice(0, 10));
        const minutes = hour * 60 + minute;
        if (weekday === 'Sat' || weekday === 'Sun' || minutes < 9 * 60 || minutes > 16 * 60 + 30) {
          fields.preferred_start = 'We call on weekdays between 9:00 and 17:00 your time.';
        } else {
          utcStart = callbackLocalStart(preferredStart, zone);
          if (utcStart.getTime() < at.getTime() + CALLBACK_LEAD_SECONDS * 1000) {
            fields.preferred_start = 'Choose a time at least 2 hours from now.';
          } else if (utcStart.getTime() > at.getTime() + CALLBACK_HORIZON_SECONDS * 1000) {
            fields.preferred_start = 'Choose a time within the next 30 days.';
          }
        }
      }
    }

    const buildCode = ctx.body.build_code;
    let resolvedBuild: string | null = null;
    if (buildCode !== undefined && buildCode !== null && buildCode !== '') {
      const build = typeof buildCode === 'string' ? await buildFromCode(pool, buildCode) : null;
      if (!build) fields.build_code = 'We could not find that build.';
      else resolvedBuild = build.code;
    }

    if (Object.keys(fields).length > 0) failValidation(fields);
    const normalisedEmail = normaliseEmail(email as string);
    const start = utcStart as Date;

    return withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`callback:${normalisedEmail}`]);
      const upcoming = await one<{ count: string }>(
        client,
        'SELECT count(*) AS count FROM callbacks WHERE email = $1 AND preferred_start_utc > $2',
        [normalisedEmail, at],
      );
      if (Number(upcoming?.count ?? 0) >= 2) fail('too_many_requests');

      const counter = (
        await client.query(`UPDATE counters SET value = value + 1 WHERE name = 'callback_reference' RETURNING value`)
      ).rows[0] as { value: string };
      const reference = `CB-${counter.value}`;

      await client.query(
        `INSERT INTO callbacks (reference, name, email, phone, timezone, preferred_start_utc, topic, message, build_code, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          reference,
          name,
          normalisedEmail,
          phone,
          zone,
          start,
          topic,
          normaliseMessage(note as string),
          resolvedBuild,
          at,
        ],
      );
      await queueNotice(
        client,
        {
          to: normalisedEmail,
          template: 'callback_requested',
          reference,
          subject: `Callback requested: ${reference}`,
          body: callbackBodyLines({
            name: name as string,
            reference,
            localStart: preferredStart as string,
            timezone: zone as string,
            utcStart: start,
            buildCode: resolvedBuild,
          }),
        },
        at,
      );
      return reply(201, { reference, preferred_start_utc: isoSeconds(start) });
    });
  });

  router.add('POST', '/api/track', 'anyone', async (ctx) => {
    const at = now();
    const raw = ctx.body.email;
    if (typeof raw !== 'string') fail('not_found', { message: NOT_FOUND_ORDER });
    const email = normaliseEmail(raw);
    await enforceLookupLimit(email, at);

    const orderNumber = typeof ctx.body.order_number === 'string' ? ctx.body.order_number.trim() : '';
    const order = (
      await query<{ number: string; status: string }>(
        `SELECT o.number, o.status FROM orders o JOIN users u ON u.id = o.user_id
         WHERE o.number = $1 AND lower(u.email) = $2`,
        [orderNumber, email],
      )
    )[0];
    if (!order) {
      await recordMiss(email, at);
      fail('not_found', { message: NOT_FOUND_ORDER });
    }

    const events = await query<{ status: string; at: Date }>(
      'SELECT status, at FROM order_events WHERE order_number = $1 ORDER BY id',
      [order.number],
    );
    const lines = await query<{ name: string }>('SELECT name FROM order_lines WHERE order_number = $1 ORDER BY id', [
      order.number,
    ]);
    return {
      number: order.number,
      status: order.status,
      events: events.map((event) => ({ status: event.status, at: isoSeconds(event.at) })),
      lines: lines.map((line) => line.name),
    };
  });

  router.add('POST', '/api/cases', 'anyone', async (ctx) => {
    const at = now();
    const fields: Record<string, string> = {};
    if (!isValidEmail(ctx.body.email)) fields.email = EMAIL_MESSAGE;
    if (!isSafeText(ctx.body.subject, 5, 120)) fields.subject = 'Enter a subject of 5 to 120 characters.';
    if (!isBoundedText(ctx.body.message, 20, 2000)) fields.message = 'Enter a message of 20 to 2000 characters.';
    const orderNumber = ctx.body.order_number;
    if (orderNumber !== undefined && orderNumber !== null && orderNumber !== '' && typeof orderNumber !== 'string') {
      fields.order_number = 'Enter your order number.';
    }
    if (Object.keys(fields).length > 0) failValidation(fields);

    return withTransaction(async (client) => {
      const counter = (
        await client.query(`UPDATE counters SET value = value + 1 WHERE name = 'case_reference' RETURNING value`)
      ).rows[0] as { value: string };
      const reference = `SC-${counter.value}`;
      const email = normaliseEmail(ctx.body.email as string);
      await client.query(
        `INSERT INTO support_cases (reference, email, order_number, subject, message, status, opened_at)
         VALUES ($1,$2,$3,$4,$5,'open',$6)`,
        [
          reference,
          email,
          typeof orderNumber === 'string' && orderNumber !== '' ? orderNumber : null,
          ctx.body.subject,
          normaliseMessage(ctx.body.message as string),
          at,
        ],
      );
      await queueNotice(
        client,
        {
          to: email,
          template: 'case_opened',
          reference,
          subject: `Support case opened: ${reference}`,
          body: `We have opened your support case.\nReference ${reference}\nSubject ${ctx.body.subject as string}`,
        },
        at,
      );
      return reply(201, { reference });
    });
  });

  router.add('POST', '/api/cases/lookup', 'anyone', async (ctx) => {
    const at = now();
    const raw = ctx.body.email;
    if (typeof raw !== 'string') fail('not_found', { message: NOT_FOUND_CASE });
    const email = normaliseEmail(raw);
    await enforceLookupLimit(email, at);

    const reference = typeof ctx.body.reference === 'string' ? ctx.body.reference.trim() : '';
    const found = (
      await query<{ reference: string; status: string; subject: string; opened_at: Date }>(
        'SELECT reference, status, subject, opened_at FROM support_cases WHERE reference = $1 AND lower(email) = $2',
        [reference, email],
      )
    )[0];
    if (!found) {
      await recordMiss(email, at);
      fail('not_found', { message: NOT_FOUND_CASE });
    }
    return {
      reference: found.reference,
      status: found.status,
      subject: found.subject,
      opened_at: isoSeconds(found.opened_at),
    };
  });

  router.add('POST', '/api/newsletter', 'anyone', async (ctx) => {
    const fields: Record<string, string> = {};
    if (!isValidEmail(ctx.body.email)) fields.email = EMAIL_MESSAGE;
    if (ctx.body.consent !== true) fields.consent = 'Please agree to the terms to sign up.';
    if (Object.keys(fields).length > 0) failValidation(fields);

    const inserted = await query<{ email: string }>(
      'INSERT INTO newsletter_signups (email, created_at) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING email',
      [normaliseEmail(ctx.body.email as string), now()],
    );
    return reply(inserted.length > 0 ? 201 : 200, { message: 'Thanks for subscribing.' });
  });

  router.add('POST', '/api/partner-applications', 'anyone', async (ctx) => {
    const fields: Record<string, string> = {};
    if (!isSafeText(ctx.body.business_name, 2, 80)) fields.business_name = 'Enter your business name.';
    if (!isValidEmail(ctx.body.email)) fields.email = EMAIL_MESSAGE;
    if (typeof ctx.body.country !== 'string' || !/^[A-Z]{2}$/.test(ctx.body.country)) {
      fields.country = 'Enter a two-letter country code.';
    }
    if (typeof ctx.body.kind !== 'string' || !['dealer', 'wholesale', 'affiliate'].includes(ctx.body.kind)) {
      fields.kind = 'Choose a partner type.';
    }
    const website = ctx.body.website;
    const websiteGiven = website !== undefined && website !== null && website !== '';
    if (websiteGiven && (typeof website !== 'string' || website.length > 200 || !/^https?:\/\/\S+$/.test(website))) {
      fields.website = 'Enter a web address starting with http:// or https://.';
    }
    if (Object.keys(fields).length > 0) failValidation(fields);

    const created = await query<{ id: string }>(
      `INSERT INTO partner_applications (business_name, email, country, kind, website, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [
        ctx.body.business_name,
        normaliseEmail(ctx.body.email as string),
        ctx.body.country,
        ctx.body.kind,
        websiteGiven ? website : null,
        now(),
      ],
    );
    const row = created[0];
    if (!row) fail('already_applied');
    return reply(201, { id: Number(row.id) });
  });
}
