export type CasePath = 'counterparty' | 'sunrise' | 'below_threshold' | 'self_hosted' | 'review';

export type CaseStatus =
  | 'awaiting_ownership'
  | 'in_review'
  | 'awaiting_answer'
  | 'accepted'
  | 'rejected'
  | 'no_response'
  | 'cleared'
  | 'released'
  | 'returned';

export type DueDiligence = 'trusted' | 'pending' | 'restricted' | 'blocked';
export type NetworkStanding = 'on_network' | 'off_network';
export type DataChannel = 'network' | 'request_page';
export type Wallet = 'hosted' | 'self_hosted';
export type CounterpartyRule = 'in_force' | 'no_rule';
export type AnswerDecision = 'accepted' | 'rejected';
export type CaseOutcome = 'released' | 'returned';
export type ErasureStatus = 'not_due' | 'scheduled' | 'pending' | 'erased';

export type StationName = 'screened' | 'counterparty' | 'data_sent' | 'answered' | 'closed';
export type StationState = 'pending' | 'current' | 'done' | 'late' | 'refused' | 'not_required';

export const STATION_LABELS: Readonly<Record<StationName, string>> = {
  screened: 'Screened',
  counterparty: 'Counterparty found',
  data_sent: 'Data sent',
  answered: 'Answered',
  closed: 'Closed',
};

export interface Station {
  readonly station: StationName;
  readonly label: string;
  readonly state: StationState;
  readonly text: string;
  readonly at: string | null;
}

/** What the path decision needs, as it stood at the case's instant. */
export interface PathInputs {
  readonly inRegistry: boolean;
  readonly dueDiligence: DueDiligence | null;
  readonly network: NetworkStanding | null;
  readonly fiatValueCents: bigint;
  readonly workspaceThresholdCents: bigint;
  readonly confirmationLimitCents: bigint;
  readonly counterpartyRule: CounterpartyRule | null;
}

export interface PathOutcome {
  readonly path: CasePath;
  readonly status: CaseStatus;
  readonly wallet: Wallet;
  readonly dataChannel: DataChannel | null;
  readonly ownershipRequired: boolean;
  readonly awaitsAnswer: boolean;
}

export class CounterpartyBlocked extends Error {}

/**
 * Steps 4 to 6 of the path decision: used at creation and again when a review
 * case is accepted, with the rules recorded at creation.
 */
export function decideAfterReview(inputs: PathInputs): PathOutcome {
  if (inputs.fiatValueCents < inputs.workspaceThresholdCents) {
    return {
      path: 'below_threshold',
      status: 'cleared',
      wallet: 'hosted',
      dataChannel: null,
      ownershipRequired: false,
      awaitsAnswer: false,
    };
  }
  const channel: DataChannel = inputs.network === 'on_network' ? 'network' : 'request_page';
  if (inputs.counterpartyRule === 'no_rule') {
    return {
      path: 'sunrise',
      status: 'cleared',
      wallet: 'hosted',
      dataChannel: channel,
      ownershipRequired: false,
      awaitsAnswer: false,
    };
  }
  return {
    path: 'counterparty',
    status: 'awaiting_answer',
    wallet: 'hosted',
    dataChannel: channel,
    ownershipRequired: false,
    awaitsAnswer: true,
  };
}

/** The one path decision, applied at creation. */
export function decidePath(inputs: PathInputs): PathOutcome {
  if (!inputs.inRegistry) {
    const overLimit = inputs.fiatValueCents > inputs.confirmationLimitCents;
    return {
      path: 'self_hosted',
      status: overLimit ? 'awaiting_ownership' : 'cleared',
      wallet: 'self_hosted',
      dataChannel: null,
      ownershipRequired: overLimit,
      awaitsAnswer: false,
    };
  }
  if (inputs.dueDiligence === 'blocked') throw new CounterpartyBlocked();
  if (inputs.dueDiligence === 'restricted') {
    return {
      path: 'review',
      status: 'in_review',
      wallet: 'hosted',
      dataChannel: null,
      ownershipRequired: false,
      awaitsAnswer: false,
    };
  }
  return decideAfterReview(inputs);
}

export function isClosed(status: CaseStatus): boolean {
  return status === 'released' || status === 'returned';
}

/** `releaseAllowed` is true exactly in the releasable states. */
export function releaseAllowed(status: CaseStatus, hasReleaseReason: boolean): boolean {
  if (status === 'accepted' || status === 'cleared') return true;
  return status === 'no_response' && hasReleaseReason;
}

/** What the handshake track is built from. */
export interface TrackInputs {
  readonly path: CasePath;
  readonly status: CaseStatus;
  readonly wallet: Wallet;
  readonly screenedAt: Date;
  readonly counterpartyNameAsDecided: string | null;
  readonly counterpartyAt: Date | null;
  readonly reviewRejectedAt: Date | null;
  readonly dataChannel: DataChannel | null;
  readonly dataSentAt: Date | null;
  readonly ownershipRequired: boolean;
  readonly ownershipRecordedAt: Date | null;
  readonly answerDecision: AnswerDecision | null;
  readonly answerAt: Date | null;
  readonly answerLate: boolean;
  readonly answerDueAt: Date | null;
  readonly hasReleaseReason: boolean;
  readonly outcome: CaseOutcome | null;
  readonly closedAt: Date | null;
}

type Draft = { state: StationState; text: string; at: Date | null };

function counterpartyStation(input: TrackInputs): Draft {
  if (input.wallet === 'self_hosted') {
    return { state: 'done', text: 'Self-hosted wallet', at: input.screenedAt };
  }
  if (input.reviewRejectedAt !== null) {
    return { state: 'refused', text: 'Rejected in review', at: input.reviewRejectedAt };
  }
  if (input.counterpartyAt === null) {
    return { state: 'current', text: 'In review', at: null };
  }
  return {
    state: 'done',
    text: input.counterpartyNameAsDecided ?? '',
    at: input.counterpartyAt,
  };
}

function dataSentStation(input: TrackInputs): Draft {
  if (input.wallet === 'self_hosted') {
    return input.ownershipRequired
      ? { state: 'done', text: 'Ownership', at: input.screenedAt }
      : { state: 'not_required', text: 'Not required', at: null };
  }
  if (input.counterpartyAt === null || input.reviewRejectedAt !== null) {
    return { state: 'pending', text: 'Not reached', at: null };
  }
  if (input.path === 'below_threshold') {
    return { state: 'not_required', text: 'Below threshold', at: null };
  }
  return {
    state: 'done',
    text: input.dataChannel === 'network' ? 'Message sent' : 'Request page sent',
    at: input.dataSentAt,
  };
}

function answeredStation(input: TrackInputs): Draft {
  if (input.wallet === 'self_hosted') {
    if (!input.ownershipRequired) return { state: 'not_required', text: 'Not required', at: null };
    return input.ownershipRecordedAt === null
      ? { state: 'current', text: 'Ownership pending', at: null }
      : { state: 'done', text: 'Confirmed', at: input.ownershipRecordedAt };
  }
  if (input.counterpartyAt === null || input.reviewRejectedAt !== null) {
    return { state: 'pending', text: 'Not reached', at: null };
  }
  if (input.path === 'below_threshold') return { state: 'not_required', text: 'Not required', at: null };
  if (input.path === 'sunrise') return { state: 'not_required', text: 'No rule in force', at: null };
  if (input.status === 'no_response') {
    return { state: 'late', text: 'No response', at: input.answerDueAt };
  }
  if (input.answerDecision === 'accepted') {
    return { state: 'done', text: 'Accepted', at: input.answerAt };
  }
  if (input.answerDecision === 'rejected') {
    return { state: 'refused', text: 'Rejected', at: input.answerAt };
  }
  return { state: 'current', text: 'Waiting for answer', at: null };
}

function closedStation(input: TrackInputs, reachedEarlier: boolean): Draft {
  if (input.outcome === 'released') return { state: 'done', text: 'Released', at: input.closedAt };
  if (input.outcome === 'returned') return { state: 'done', text: 'Returned', at: input.closedAt };
  if (input.status === 'rejected') return { state: 'current', text: 'Return only', at: null };
  if (input.status === 'no_response' && !input.hasReleaseReason) {
    return { state: 'current', text: 'Reason needed', at: null };
  }
  if (releaseAllowed(input.status, input.hasReleaseReason)) {
    return { state: 'current', text: 'Ready to release', at: null };
  }
  return { state: 'pending', text: reachedEarlier ? 'Not reached' : 'Open', at: null };
}

function instant(value: Date | null): string | null {
  if (value === null) return null;
  return `${new Date(Math.floor(value.getTime() / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

/** The one place the handshake track's five stations are decided. */
export function buildTrack(input: TrackInputs): Station[] {
  const drafts: Array<[StationName, Draft]> = [
    ['screened', { state: 'done', text: 'Address checked', at: input.screenedAt }],
    ['counterparty', counterpartyStation(input)],
    ['data_sent', dataSentStation(input)],
    ['answered', answeredStation(input)],
  ];
  const returnedEarly = input.outcome === 'returned';
  const resolved = drafts.map(([name, draft]): [StationName, Draft] => {
    if (returnedEarly && draft.state === 'current') {
      return [name, { state: 'pending', text: 'Not reached', at: null }];
    }
    return [name, draft];
  });
  resolved.push(['closed', closedStation(input, false)]);
  return resolved.map(([station, draft]) => ({
    station,
    label: STATION_LABELS[station],
    state: draft.state,
    text: draft.text,
    at: draft.state === 'done' || draft.state === 'late' || draft.state === 'refused' ? instant(draft.at) : null,
  }));
}
