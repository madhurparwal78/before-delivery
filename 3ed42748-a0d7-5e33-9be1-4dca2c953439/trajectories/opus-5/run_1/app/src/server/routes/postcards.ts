import { withTransaction } from '../db/pool.js';
import { POSTCARD_BODY_LIMIT, shareUrlFor } from '../http/boundary.js';
import { fail, validation } from '../http/errors.js';
import { loadCourier } from '../domain/couriers.js';
import {
  createPostcard,
  listPostcards,
  ownedPostcard,
  postcardBody,
  postcardByShareToken,
  reserveMailSlot,
  revokePostcard,
} from '../domain/postcards.js';
import { readTicket, withTicket } from '../domain/tickets.js';
import { isoTime } from '../domain/time.js';
import { getPostcardImage } from '../services/postcardStore.js';
import { checkEmail, mailbox, sendMail } from '../services/postOffice.js';
import type { AppRoute } from '../http/app.js';
import { actorOf, published, rawJson } from './shared.js';
import { postcardPage, returnedToSenderPage } from '../pages/postcardPage.js';

const POSTCARD_SENDER_ADDRESS = 'postcards@kitefold.example';

export const postcardRoutes: AppRoute[] = [
  {
    method: 'GET',
    pattern: '/api/postcards',
    auth: 'courier',
    bodyKind: 'none',
    handler: async (context) => ({
      status: 200,
      json: {
        postcards: (await listPostcards(actorOf(context).courier.courier_id)).map(postcardBody),
      },
    }),
  },
  {
    method: 'POST',
    pattern: '/api/postcards',
    auth: 'courier',
    bodyKind: 'png',
    bodyLimit: POSTCARD_BODY_LIMIT,
    handler: async (context) => {
      const actor = actorOf(context);
      const record = await createPostcard(actor.courier.courier_id, context.body);
      return { status: 201, json: postcardBody(record) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/postcards/:postcard_id',
    auth: 'session',
    bodyKind: 'none',
    handler: async (context) => {
      const actor = actorOf(context);
      await revokePostcard(actor.courier.courier_id, context.params.postcard_id!);
      return { status: 204 };
    },
  },
  {
    method: 'POST',
    pattern: '/api/postcards/:postcard_id/mail',
    auth: 'session',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      const ticket = readTicket(context.request, 'mail');
      const raw = rawJson(context);
      const postcardId = context.params.postcard_id!;
      const fingerprint = JSON.stringify({ postcard_id: postcardId, to: raw.to ?? null });

      return withTransaction(async (tx) => {
        const stored = await withTicket(
          tx,
          actor.courier.courier_id,
          'mail',
          ticket,
          fingerprint,
          async () => {
            const postcard = await ownedPostcard(actor.courier.courier_id, postcardId);
            if (postcard === null) throw fail('not_found');
            const body = published(context, { to: true });
            const friend = checkEmail(body.to);
            if ('fault' in friend) throw validation({ to: friend.fault });

            await reserveMailSlot(tx, actor.courier.courier_id);

            const sender = await loadCourier(actor.courier.courier_id);
            const name = sender!.display_name;
            const shareUrl = shareUrlFor(postcard.share_token);
            const sentAt = await sendMail({
              envelopeSender: POSTCARD_SENDER_ADDRESS,
              from: mailbox(`${name} via Parcel Moon`, POSTCARD_SENDER_ADDRESS),
              to: friend.address,
              subject: `${name} sent you a postcard from Bramble`,
              text: `${name} took this postcard on Bramble: ${shareUrl}`,
            });
            return { status: 200, body: { status: 'sent', sent_at: isoTime(sentAt) } };
          },
        );
        return { status: stored.status, json: stored.body };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/p/:share_token',
    auth: 'anyone',
    bodyKind: 'none',
    handler: async (context) => {
      const postcard = await postcardByShareToken(context.params.share_token!);
      if (postcard === null) {
        return {
          status: 404,
          body: returnedToSenderPage(),
          contentType: 'text/html; charset=utf-8',
          headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' },
        };
      }
      const sender = await loadCourier(postcard.courier_id);
      return {
        status: 200,
        body: postcardPage(sender!.display_name, postcard.share_token),
        contentType: 'text/html; charset=utf-8',
        headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/p/:share_token/image.png',
    auth: 'anyone',
    bodyKind: 'none',
    handler: async (context) => {
      const postcard = await postcardByShareToken(context.params.share_token!);
      if (postcard === null) throw fail('not_found');
      return {
        status: 200,
        body: await getPostcardImage(postcard.postcard_id),
        contentType: 'image/png',
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': 'inline; filename="postcard.png"',
          'Cache-Control': 'no-store',
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/p/*',
    auth: 'anyone',
    bodyKind: 'none',
    handler: async () => {
      throw fail('not_found');
    },
  },
];
