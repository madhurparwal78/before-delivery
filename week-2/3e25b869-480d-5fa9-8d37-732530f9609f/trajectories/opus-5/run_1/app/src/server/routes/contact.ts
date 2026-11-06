import { CONTACT_TOPICS } from '../../shared/catalog.js';
import { FIELD_MESSAGES } from '../../shared/copy.js';
import { takeNumber } from '../db/numbers.js';
import { withTransaction } from '../db/pool.js';
import { contactReplyMail } from '../email/templates.js';
import {
  boundedText,
  isMultiLineText,
  parseBody,
  readEmail,
  readLiteral,
  type Reader,
} from '../http/body.js';
import type { ApiResponse, RequestContext } from '../http/context.js';
import { errors } from '../http/errors.js';
import { enqueueNotice, wakeOutbox } from '../services/outbox.js';

const readMessage: Reader<string> = (raw, path, report) => {
  if (typeof raw !== 'string' || !isMultiLineText(raw)) {
    report(path, FIELD_MESSAGES.message);
    return '';
  }
  const trimmed = raw.trim();
  if (trimmed.length < 10 || trimmed.length > 2_000) {
    report(path, FIELD_MESSAGES.message);
    return '';
  }
  return trimmed;
};

const CONTACT_SHAPE = {
  name: boundedText(FIELD_MESSAGES.name, 1, 120),
  email: readEmail,
  topic: readLiteral(CONTACT_TOPICS, FIELD_MESSAGES.topic),
  message: readMessage,
} as const;

export async function postContact(ctx: RequestContext): Promise<ApiResponse> {
  const parsed = parseBody(ctx.body, CONTACT_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  const { name, email, topic, message } = parsed.value;
  const reference = await withTransaction(async (client) => {
    const number = await takeNumber(client, 'contact');
    await client.query(
      `INSERT INTO contacts (number, name, email, topic, message, locale)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [number, name, email, topic, message, ctx.locale],
    );
    const mail = contactReplyMail({ number, topic, name }, ctx.locale);
    await enqueueNotice(client, {
      key: `contact.${number}`,
      kind: 'contact_reply',
      recipient: email,
      locale: ctx.locale,
      subject: mail.subject,
      body: mail.body,
    });
    return number;
  });
  wakeOutbox();
  return { status: 201, body: { reference } };
}
