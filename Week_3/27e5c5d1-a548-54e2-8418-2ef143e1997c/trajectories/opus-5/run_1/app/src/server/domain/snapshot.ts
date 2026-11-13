import type {
  BoardMemberPayload,
  BoardRole,
  CardPayload,
  CountEntry,
  ListPayload,
  WorkspacePersonPayload,
  WorkspaceRole,
} from '../../shared/types';
import type { BoardMemberRow, BoardRow, CardRecord, ListRow, WorkspaceMemberRow } from '../db/repo';
import { canEditCards, canSeeCard } from './access';
import { dueState } from './cardRules';

export interface Viewer {
  userId: string;
  role: BoardRole;
}

/** Holds one board's stored state and answers it in the shape each viewer may see. */
export class BoardSnapshot {
  constructor(
    readonly board: BoardRow,
    readonly lists: ListRow[],
    readonly cards: CardRecord[],
    readonly timeZone: string,
    readonly parentName: string,
    private readonly now: Date = new Date(),
  ) {}

  canSee(card: CardRecord, viewer: Viewer): boolean {
    return canSeeCard(
      viewer.role,
      card.privateMembers.map((member) => member.userId),
      viewer.userId,
    );
  }

  private liveCardsIn(listId: string, viewer: Viewer): CardRecord[] {
    return this.cards
      .filter((card) => card.listId === listId && card.status !== 'archived' && this.canSee(card, viewer))
      .sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0));
  }

  position(cardId: string, viewer: Viewer): number | null {
    const card = this.cards.find((item) => item.id === cardId);
    if (card === undefined || card.status === 'archived' || !this.canSee(card, viewer)) return null;
    const index = this.liveCardsIn(card.listId, viewer).findIndex((item) => item.id === cardId);
    return index === -1 ? null : index + 1;
  }

  count(listId: string, viewer: Viewer): number {
    return this.liveCardsIn(listId, viewer).length;
  }

  counts(listIds: readonly string[], viewer: Viewer): CountEntry[] {
    const unique = [...new Set(listIds)];
    return unique.map((listId) => ({ listId, count: this.count(listId, viewer) }));
  }

  openCards(viewer: Viewer): number {
    return this.cards.filter((card) => card.status === 'open' && this.canSee(card, viewer)).length;
  }

  cardById(cardId: string): CardRecord | undefined {
    return this.cards.find((card) => card.id === cardId);
  }

  /** Every non-archived card the viewer may see, mapped to the list it sits in. */
  visibleCardIds(viewer: Viewer): Map<string, string> {
    const visible = new Map<string, string>();
    for (const card of this.cards) {
      if (card.status === 'archived' || !this.canSee(card, viewer)) continue;
      visible.set(card.id, card.listId);
    }
    return visible;
  }

  cardPayload(card: CardRecord, viewer: Viewer): CardPayload {
    return shapeCard(card, viewer, this.position(card.id, viewer), this.timeZone, this.now);
  }

  listPayloads(viewer: Viewer): ListPayload[] {
    return this.lists.map((list) => {
      const cards = this.liveCardsIn(list.id, viewer);
      return {
        id: list.id,
        name: list.name,
        count: cards.length,
        cards: cards.map((card, index) => shapeCard(card, viewer, index + 1, this.timeZone, this.now)),
      };
    });
  }
}

/** The one place that shapes a card for the caller's role. */
export function shapeCard(
  card: CardRecord,
  viewer: Viewer,
  position: number | null,
  timeZone: string,
  now: Date,
): CardPayload {
  const shared: CardPayload = {
    id: card.id,
    boardId: card.boardId,
    listId: card.listId,
    title: card.title,
    position,
    labels: card.labels,
    dueDate: card.dueDate,
    dueState: dueState(card.dueDate, card.status, timeZone, now),
    status: card.status,
    version: card.version,
    owner:
      card.owner === null
        ? null
        : {
            displayName: card.owner.displayName,
            initials: card.owner.initials,
            colour: card.owner.colour,
            ...(canEditCards(viewer.role) ? { userId: card.owner.userId } : {}),
          },
    checklist: card.checklist,
  };
  if (!canEditCards(viewer.role)) return shared;
  return {
    ...shared,
    notes: card.notes,
    isPrivate: card.privateMembers.length > 0,
    privateMembers: card.privateMembers,
    attachments: card.attachments,
  };
}

export function shapeBoardMember(row: BoardMemberRow, viewerRole: BoardRole): BoardMemberPayload {
  const base: BoardMemberPayload = {
    displayName: row.display_name,
    initials: row.initials,
    colour: row.colour,
  };
  if (viewerRole === 'observer') return base;
  const withMember: BoardMemberPayload = { ...base, userId: row.user_id, role: row.state, phone: row.phone };
  if (viewerRole === 'member') return withMember;
  return { ...withMember, email: row.email };
}

export function shapeWorkspacePerson(row: WorkspaceMemberRow, viewerRole: WorkspaceRole): WorkspacePersonPayload {
  const base: WorkspacePersonPayload = {
    displayName: row.display_name,
    initials: row.initials,
    colour: row.colour,
  };
  if (viewerRole !== 'admin') return base;
  return { ...base, userId: row.user_id, role: row.role, email: row.email, phone: row.phone };
}
