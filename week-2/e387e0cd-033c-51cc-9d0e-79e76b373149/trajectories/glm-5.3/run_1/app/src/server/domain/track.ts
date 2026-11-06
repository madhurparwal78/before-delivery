// The one Handshake track rule. The server computes the five stations for a
// case; screens render them without recomputation.
export type StationName = 'screened' | 'counterparty' | 'data_sent' | 'answered' | 'closed';
export type StationState = 'pending' | 'current' | 'done' | 'late' | 'refused' | 'not_required';

export interface TrackStation {
  station: StationName;
  label: string;
  state: StationState;
  text: string;
  at: string | null;
}

export const STATION_LABELS: Record<StationName, string> = {
  screened: 'Screened',
  counterparty: 'Counterparty found',
  data_sent: 'Data sent',
  answered: 'Answered',
  closed: 'Closed',
};

export const STATION_ORDER: StationName[] = ['screened', 'counterparty', 'data_sent', 'answered', 'closed'];

export interface TrackCase {
  createdAt: string;
  path: 'counterparty' | 'sunrise' | 'below_threshold' | 'self_hosted' | 'review';
  status: string;
  wallet: 'hosted' | 'self_hosted';
  counterpartyNameAsSent: string | null;
  dataSent: { channel: 'network' | 'request_page'; at: string } | null;
  dataSentText: string | null;
  answer: { decision: 'accepted' | 'rejected'; at: string; late: boolean } | null;
  answerDueAt: string | null;
  ownershipRequired: boolean;
  ownershipRecordedAt: string | null;
  reviewAcceptedAt: string | null;
  releaseAllowed: boolean;
  releaseReasonRecorded: boolean;
  outcome: 'released' | 'returned' | null;
  closedAt: string | null;
}

export function computeTrack(c: TrackCase): TrackStation[] {
  const screened: TrackStation = { station: 'screened', label: STATION_LABELS.screened, state: 'done', text: 'Address checked', at: c.createdAt };
  const selfHostedLabel = c.wallet === 'self_hosted' ? 'Self-hosted wallet' : (c.counterpartyNameAsSent ?? 'Self-hosted wallet');
  const closed = c.closedAt !== null;

  let counterparty: TrackStation;
  let dataSent: TrackStation;
  let answered: TrackStation;
  let closedStation: TrackStation;

  const reviewAccepted = c.path === 'review' && c.reviewAcceptedAt !== null;
  const reviewRejected = c.path === 'review' && c.status === 'returned' && c.answer === null && c.dataSent === null;

  if (reviewRejected) {
    counterparty = { station: 'counterparty', label: STATION_LABELS.counterparty, state: 'refused', text: 'Rejected in review', at: c.closedAt };
    dataSent = { station: 'data_sent', label: STATION_LABELS.data_sent, state: 'pending', text: 'Not reached', at: null };
    answered = { station: 'answered', label: STATION_LABELS.answered, state: 'pending', text: 'Not reached', at: null };
    closedStation = { station: 'closed', label: STATION_LABELS.closed, state: 'done', text: 'Returned', at: c.closedAt };
    return [screened, counterparty, dataSent, answered, closedStation];
  }

  if (c.path === 'review') {
    if (reviewAccepted) {
      counterparty = { station: 'counterparty', label: STATION_LABELS.counterparty, state: 'done', text: selfHostedLabel, at: c.reviewAcceptedAt };
    } else {
      counterparty = { station: 'counterparty', label: STATION_LABELS.counterparty, state: 'current', text: 'In review', at: null };
    }
  } else {
    counterparty = { station: 'counterparty', label: STATION_LABELS.counterparty, state: 'done', text: selfHostedLabel, at: c.createdAt };
  }

  if (c.path === 'review' && !reviewAccepted) {
    dataSent = { station: 'data_sent', label: STATION_LABELS.data_sent, state: 'pending', text: 'Not reached', at: null };
    answered = { station: 'answered', label: STATION_LABELS.answered, state: 'pending', text: 'Not reached', at: null };
  } else if (c.path === 'self_hosted') {
    if (c.ownershipRequired) {
      dataSent = { station: 'data_sent', label: STATION_LABELS.data_sent, state: 'done', text: 'Ownership', at: c.createdAt };
      if (c.status === 'awaiting_ownership') {
        answered = { station: 'answered', label: STATION_LABELS.answered, state: 'current', text: 'Ownership pending', at: null };
      } else {
        answered = { station: 'answered', label: STATION_LABELS.answered, state: 'done', text: 'Confirmed', at: c.ownershipRecordedAt ?? c.createdAt };
      }
    } else {
      dataSent = { station: 'data_sent', label: STATION_LABELS.data_sent, state: 'not_required', text: 'Not required', at: null };
      answered = { station: 'answered', label: STATION_LABELS.answered, state: 'not_required', text: 'Not required', at: null };
    }
  } else if (c.path === 'below_threshold') {
    dataSent = { station: 'data_sent', label: STATION_LABELS.data_sent, state: 'not_required', text: 'Below threshold', at: null };
    answered = { station: 'answered', label: STATION_LABELS.answered, state: 'not_required', text: 'Not required', at: null };
  } else if (c.path === 'sunrise') {
    const text = c.dataSentText ?? (c.dataSent ? (c.dataSent.channel === 'network' ? 'Message sent' : 'Request page sent') : 'Message sent');
    dataSent = { station: 'data_sent', label: STATION_LABELS.data_sent, state: 'done', text, at: c.dataSent?.at ?? c.createdAt };
    answered = { station: 'answered', label: STATION_LABELS.answered, state: 'not_required', text: 'No rule in force', at: null };
  } else {
    const text = c.dataSentText ?? (c.dataSent ? (c.dataSent.channel === 'network' ? 'Message sent' : 'Request page sent') : 'Message sent');
    dataSent = { station: 'data_sent', label: STATION_LABELS.data_sent, state: 'done', text, at: c.dataSent?.at ?? c.createdAt };
    if (c.answer !== null && !c.answer.late) {
      answered = { station: 'answered', label: STATION_LABELS.answered, state: c.answer.decision === 'accepted' ? 'done' : 'refused', text: c.answer.decision === 'accepted' ? 'Accepted' : 'Rejected', at: c.answer.at };
    } else if (c.status === 'no_response') {
      answered = { station: 'answered', label: STATION_LABELS.answered, state: 'late', text: 'No response', at: c.answerDueAt };
    } else if (closed) {
      answered = { station: 'answered', label: STATION_LABELS.answered, state: 'pending', text: 'Not reached', at: null };
    } else {
      answered = { station: 'answered', label: STATION_LABELS.answered, state: 'current', text: 'Waiting for answer', at: null };
    }
  }

  if (closed) {
    closedStation = { station: 'closed', label: STATION_LABELS.closed, state: 'done', text: c.outcome === 'released' ? 'Released' : 'Returned', at: c.closedAt };
  } else if (c.releaseAllowed) {
    closedStation = { station: 'closed', label: STATION_LABELS.closed, state: 'current', text: 'Ready to release', at: null };
  } else if (c.status === 'rejected') {
    closedStation = { station: 'closed', label: STATION_LABELS.closed, state: 'current', text: 'Return only', at: null };
  } else if (c.status === 'no_response' && !c.releaseReasonRecorded) {
    closedStation = { station: 'closed', label: STATION_LABELS.closed, state: 'current', text: 'Reason needed', at: null };
  } else {
    closedStation = { station: 'closed', label: STATION_LABELS.closed, state: 'pending', text: 'Open', at: null };
  }

  const result = [screened, counterparty, dataSent, answered, closedStation]; 
  return result;
}
