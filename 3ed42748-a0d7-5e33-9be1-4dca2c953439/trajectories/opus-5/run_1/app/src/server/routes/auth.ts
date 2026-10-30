import { withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { clearedSessionCookie, sessionCookie } from '../http/boundary.js';
import { validation } from '../http/errors.js';
import { checkReturnPath, DEFAULT_RETURN_PATH } from '../../shared/returnPaths.js';
import { createPostboxKey, redeemPostboxKey } from '../domain/postboxKeys.js';
import { endSession } from '../domain/sessions.js';
import { checkEmail, mailbox, sendMail, splitMailbox } from '../services/postOffice.js';
import type { AppRoute } from '../http/app.js';
import { actorOf, published } from './shared.js';

const POSTBOX_KEY_SUBJECT = 'Your Parcel Moon postbox key';

export const authRoutes: AppRoute[] = [
  {
    method: 'POST',
    pattern: '/api/auth/postbox-key',
    auth: 'anyone',
    bodyKind: 'json',
    handler: async (context) => {
      const body = published(context, { email: true, return_to: true });
      const email = checkEmail(body.email);
      const returnTo =
        body.return_to === undefined
          ? { path: DEFAULT_RETURN_PATH }
          : checkReturnPath(body.return_to);
      if ('fault' in email || 'fault' in returnTo) {
        const fields: Record<string, 'invalid' | 'too_long'> = {};
        if ('fault' in email) fields.email = email.fault;
        if ('fault' in returnTo) fields.return_to = returnTo.fault;
        throw validation(fields);
      }

      const token = await createPostboxKey(email.address, returnTo.path);
      const sender = splitMailbox(config.smtp.from);
      await sendMail({
        envelopeSender: sender.address,
        from: mailbox(sender.phrase, sender.address),
        to: email.address,
        subject: POSTBOX_KEY_SUBJECT,
        text: [
          'Your postbox on Bramble is ready.',
          '',
          `Open this link to claim your save: ${config.publicUrl}/claim?token=${token}`,
          '',
          'The link works once.',
        ].join('\n'),
      });
      return { status: 200, json: { status: 'sent' } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/redeem',
    auth: 'anyone',
    bodyKind: 'json',
    withActor: true,
    handler: async (context) => {
      const body = published(context, { token: true });
      const previous =
        context.actor === null
          ? null
          : {
              sessionId: context.actor.sessionId,
              courierId: context.actor.courier.courier_id,
            };
      const result = await redeemPostboxKey(body.token, previous, context.now);
      return {
        status: 200,
        json: {
          role: result.role,
          display_name: result.display_name,
          balance: result.balance,
          merged_guest: result.merged_guest,
          merge_report: result.merge_report,
          return_to: result.return_to,
        },
        setCookie: sessionCookie(result.sessionId),
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/sign-out',
    auth: 'session',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      published(context, {});
      await withTransaction(async (tx) => {
        await endSession(tx, actor.sessionId);
      });
      return { status: 204, setCookie: clearedSessionCookie() };
    },
  },
];
