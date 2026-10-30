import { fail } from '../http/errors.js';
import {
  onlineCouriers,
  publicPresence,
  readHeartbeat,
  recordHeartbeat,
} from '../domain/presence.js';
import { auditEntries, moderate } from '../domain/moderation.js';
import type { AppRoute } from '../http/app.js';
import { actorOf, published } from './shared.js';

export const presenceRoutes: AppRoute[] = [
  {
    method: 'GET',
    pattern: '/api/presence',
    auth: 'session',
    bodyKind: 'none',
    handler: async (context) => ({
      status: 200,
      json: publicPresence(
        await onlineCouriers(context.now),
        actorOf(context).courier.courier_id,
      ),
    }),
  },
  {
    method: 'POST',
    pattern: '/api/presence',
    auth: 'session',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      const body = published(context, {
        stream: true,
        seq: true,
        position: { lat: true, lon: true, heading_deg: true },
        emote: true,
      });
      const beat = readHeartbeat(body);
      return { status: 200, json: await recordHeartbeat(actor, beat, context.now) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/moderation/audit',
    auth: 'staff',
    bodyKind: 'none',
    handler: async () => ({ status: 200, json: { entries: await auditEntries() } }),
  },
  ...(['POST', 'PUT', 'PATCH', 'DELETE'] as const).map(
    (method): AppRoute => ({
      method,
      pattern: '/api/moderation/audit/*',
      auth: 'anyone',
      bodyKind: 'none',
      handler: async () => {
        throw fail('method_not_allowed');
      },
    }),
  ),
  {
    method: 'GET',
    pattern: '/api/moderation/audit/*',
    auth: 'anyone',
    bodyKind: 'none',
    handler: async () => {
      throw fail('not_found');
    },
  },
  {
    method: 'GET',
    pattern: '/api/moderation/presence',
    auth: 'staff',
    bodyKind: 'none',
    handler: async (context) => ({
      status: 200,
      json: {
        couriers: (await onlineCouriers(context.now)).map((courier) => ({
          moderation_ref: courier.moderation_ref,
          display_name: courier.display_name,
          satchel_colour: courier.satchel_colour,
          position: courier.position,
          emote: courier.emote,
          muted: courier.muted,
          name_locked: courier.name_locked,
        })),
      },
    }),
  },
  {
    method: 'POST',
    pattern: '/api/moderation/:moderation_ref/mute',
    auth: 'staff',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      published(context, {});
      const outcome = await moderate(
        actor,
        context.params.moderation_ref!,
        'mute',
        context.now,
      );
      return { status: 200, json: { display_name: outcome.display_name, muted: true } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/moderation/:moderation_ref/unmute',
    auth: 'staff',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      published(context, {});
      const outcome = await moderate(
        actor,
        context.params.moderation_ref!,
        'unmute',
        context.now,
      );
      return { status: 200, json: { display_name: outcome.display_name, muted: false } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/moderation/:moderation_ref/rename',
    auth: 'staff',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      published(context, {});
      const outcome = await moderate(
        actor,
        context.params.moderation_ref!,
        'rename',
        context.now,
      );
      return { status: 200, json: { display_name: outcome.display_name, name_locked: true } };
    },
  },
];
