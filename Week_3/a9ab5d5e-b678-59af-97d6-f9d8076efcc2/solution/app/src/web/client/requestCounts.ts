import { Me, api } from './api';

interface SentRequest {
  /** Who made it: a swap's creator, a cost's payer. */
  createdBy?: 'planning' | 'other';
  paidBy?: 'planning' | 'other';
}

async function sentRequests(me: Me, kind: 'swaps' | 'costs'): Promise<SentRequest[]> {
  const found: SentRequest[] = [];
  let after = '';
  for (;;) {
    const page = await api<{ items: SentRequest[]; next: string | null }>(
      'GET',
      `/api/households/${me.household.id}/${kind}?state=sent&limit=100${after}`,
    );
    found.push(...page.data.items);
    if (page.data.next === null) return found;
    after = `&after=${page.data.next}`;
  }
}

/** Sent requests awaiting the signed-in parent's answer, and sent requests they created that are still unanswered. */
export async function requestCounts(me: Me): Promise<{ waiting: number; sent: number }> {
  const requests = [...(await sentRequests(me, 'swaps')), ...(await sentRequests(me, 'costs'))];
  const mine = requests.filter((request) => (request.createdBy ?? request.paidBy) === me.role).length;
  return { waiting: requests.length - mine, sent: mine };
}
