/** Request state machine: decided here and nowhere else. */
export type RequestState = 'draft' | 'sent' | 'accepted' | 'declined' | 'lapsed' | 'withdrawn' | 'settled';

export interface RequestActions {
  send(from: 'draft', by: 'creator'): 'sent';
  deleteDraft(from: 'draft', by: 'creator'): null;
  accept(from: 'sent', by: 'answerer'): 'accepted';
  decline(from: 'sent', by: 'answerer'): 'declined';
  withdraw(from: 'sent', by: 'creator'): 'withdrawn';
  settle(from: 'accepted', by: 'creator'): 'settled'; // costs only
}

export type RequestKind = 'swap' | 'cost';

/** Edges shared by swaps and costs. Anything else is invalid_transition. */
export function requestTransition(
  kind: RequestKind,
  state: RequestState,
  action: 'send' | 'delete' | 'accept' | 'decline' | 'withdraw' | 'settle',
  actorIsCreator: boolean,
): { ok: boolean; next: RequestState | null; code: string | null } {
  const wrong = (code: string) => ({ ok: false, next: null, code });
  switch (action) {
    case 'send':
      if (state !== 'draft') return wrong('invalid_transition');
      if (!actorIsCreator) return wrong('not_your_request');
      return { ok: true, next: 'sent', code: null };
    case 'delete':
      if (state !== 'draft') return wrong('invalid_transition');
      if (!actorIsCreator) return wrong('not_your_request');
      return { ok: true, next: null, code: null };
    case 'accept':
      if (state === 'draft' || state === 'withdrawn' || state === 'declined') return wrong('invalid_transition');
      if (state === 'accepted' || state === 'settled' || state === 'lapsed') return wrong('invalid_transition');
      if (actorIsCreator) return wrong('not_your_answer');
      return { ok: true, next: 'accepted', code: null };
    case 'decline':
      if (state !== 'sent') return wrong('invalid_transition');
      if (actorIsCreator) return wrong('not_your_answer');
      return { ok: true, next: 'declined', code: null };
    case 'withdraw':
      if (state !== 'sent') return wrong('invalid_transition');
      if (!actorIsCreator) return wrong('not_your_request');
      return { ok: true, next: 'withdrawn', code: null };
    case 'settle':
      if (kind !== 'cost') return wrong('invalid_transition');
      if (state !== 'accepted') return wrong('invalid_transition');
      if (!actorIsCreator) return wrong('not_your_request');
      return { ok: true, next: 'settled', code: null };
  }
}
