import { COPY, say } from '../../domain/copy.js';
import { clockTimeInRoundedUp } from '../../domain/time.js';
import { config } from '../config.js';
import type { RouteSpec } from '../http.js';
import { peekJsonBody, readJsonBody, refuse } from '../http.js';
import { enquiryMail, queueMail } from '../mail.js';
import { takeHit } from '../rate.js';
import { FieldCollector } from '../validate.js';

export const enquiryRoutes: RouteSpec[] = [
  {
    method: 'POST',
    pattern: '/api/enquiries',
    auth: 'open',
    body: 'json',
    limit: async (context) => {
      const asked = String((await peekJsonBody(context))['email'] ?? '').toLowerCase();
      if (asked === '') return;
      const verdict = await takeHit(
        `enquiries:${asked}`,
        5,
        config.timers.enquiryWindowSeconds,
      );
      if (!verdict.allowed) {
        throw refuse.rateLimited(
          say.enquiryLimit(clockTimeInRoundedUp(verdict.retryAt, 'amsterdam')),
          (verdict.retryAt.getTime() - Date.now()) / 1000,
        );
      }
    },
    handler: async (context) => {
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const name = fields.text(body, 'name', COPY.typeName);
      const email = fields.email(body);
      const message = fields.text(body, 'message', COPY.enquiryMessage);
      const phone = fields.optionalText(body, 'phone');
      fields.done();
      await queueMail(enquiryMail({ name, email, phone, message }));
      return { status: 202, body: { message: COPY.enquiryThanks } };
    },
  },
];
