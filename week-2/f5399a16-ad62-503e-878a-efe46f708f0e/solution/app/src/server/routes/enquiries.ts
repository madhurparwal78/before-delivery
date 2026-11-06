import { COPY, fill } from '../../shared/copy';
import { clockRoundedUp, TOWN_ZONES } from '../../shared/time';
import { config } from '../config';
import { pool } from '../db';
import { limited, ok, route } from '../http';
import { queueMail } from '../mail';
import { claimEvent, readWindow, retryAfterSeconds } from '../rate';
import { addressGiven, checkMail, checkName, filled, throwIfAny, type Fields } from '../validate';

const ENQUIRY_LIMIT = 5;

route(
  'POST',
  '/api/enquiries',
  {
    auth: 'none',
    rate: async ({ rawBody, now }) => {
      const email = addressGiven(rawBody);
      if (email === null) return;
      const held = await readWindow(`enquiry:${email}`, config.enquiryRateWindowSeconds, now);
      if (held.count >= ENQUIRY_LIMIT) {
        throw limited(fill(COPY.enquiryLimit, { time: clockRoundedUp(held.retryAt, TOWN_ZONES.amsterdam) }), retryAfterSeconds(held.retryAt, now));
      }
    },
  },
  async ({ body, now }) => {
    const fields: Fields = {};
    const name = checkName(fields, 'name', body.name);
    const email = checkMail(fields, 'email', body.email);
    if (!filled(body.message)) fields.message = COPY.typeMessage;
    throwIfAny(fields);
    const full = await claimEvent(`enquiry:${email.toLowerCase()}`, config.enquiryRateWindowSeconds, ENQUIRY_LIMIT, now);
    if (full) throw limited(fill(COPY.enquiryLimit, { time: clockRoundedUp(full.retryAt, TOWN_ZONES.amsterdam) }), retryAfterSeconds(full.retryAt, now));
    const phone = typeof body.phone === 'string' ? body.phone : '';
    await queueMail(pool, {
      clientId: null,
      to: config.mailAddress,
      subject: `Enquiry from ${name}`,
      body: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nMessage: ${body.message as string}\n`,
    });
    return ok({ message: COPY.enquiryThanks }, 202);
  },
);
