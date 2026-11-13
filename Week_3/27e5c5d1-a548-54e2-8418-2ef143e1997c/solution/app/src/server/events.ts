import type { LiveEvent, Person } from '../shared/types.ts';
import { canSee, countsFor, positionOf, shapeCard, type Snapshot, type Viewer } from './cards-data.ts';

/** What a committed change did; the recipients' events are derived from it by comparing the board before and after. */
export type Intent =
  | { type: 'card'; cardId: string; mover?: Person }
  | { type: 'board-event'; event: Extract<LiveEvent, { type: 'list.created' | 'list.updated' | 'board.updated' }> };

type Audience = 'all' | 'observers' | string[];

interface Delivery {
  audience: Audience;
  events: LiveEvent[];
}

export interface Envelope {
  boardId: string;
  deliveries: Delivery[];
}

function cardEvents(intent: Extract<Intent, { type: 'card' }>, before: Snapshot, after: Snapshot, viewer: Viewer, today: string): LiveEvent[] {
  const was = before.cards.find((card) => card.id === intent.cardId);
  const is = after.cards.find((card) => card.id === intent.cardId);
  const saw = was !== undefined && canSee(was, viewer);
  const sees = is !== undefined && canSee(is, viewer);
  if (!saw && is && sees) {
    return [{ type: 'card.created', data: { card: shapeCard(is, viewer, positionOf(after, is, viewer), today), counts: countsFor(after, [is.listId], viewer) } }];
  }
  if (saw && was && !sees) {
    return [{ type: 'card.removed', data: { cardId: was.id, counts: countsFor(after, [was.listId], viewer) } }];
  }
  if (saw && was && sees && is) {
    const card = shapeCard(is, viewer, positionOf(after, is, viewer), today);
    if (intent.mover) {
      return [
        {
          type: 'card.moved',
          data: {
            card,
            from: { listId: was.listId, position: positionOf(before, was, viewer) ?? 1 },
            to: { listId: is.listId, position: card.position ?? 1 },
            mover: intent.mover,
            counts: countsFor(after, [was.listId, is.listId], viewer),
          },
        },
      ];
    }
    return [{ type: 'card.updated', data: { card } }];
  }
  return [];
}

function eventsFor(intents: Intent[], before: Snapshot, after: Snapshot, viewer: Viewer, today: string): LiveEvent[] {
  return intents.flatMap((intent) =>
    intent.type === 'card' ? cardEvents(intent, before, after, viewer, today) : [intent.event],
  );
}

/**
 * Every recipient's events for one commit. Observers all see the same board, so they share one delivery;
 * members and admins are computed one by one and grouped by identical result.
 */
export function buildEnvelope(
  boardId: string,
  intents: Intent[],
  before: Snapshot,
  after: Snapshot,
  writers: Viewer[],
  today: string,
): Envelope {
  const deliveries: Delivery[] = [];
  const observers = eventsFor(intents, before, after, { userId: '', role: 'observer' }, today);
  if (observers.length > 0) deliveries.push({ audience: 'observers', events: observers });
  const groups = new Map<string, Delivery & { audience: string[] }>();
  for (const viewer of writers) {
    const events = eventsFor(intents, before, after, viewer, today);
    if (events.length === 0) continue;
    const key = JSON.stringify(events);
    const group = groups.get(key) ?? { audience: [], events };
    group.audience.push(viewer.userId);
    groups.set(key, group);
  }
  return { boardId, deliveries: [...deliveries, ...groups.values()] };
}
