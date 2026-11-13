import { KIND_LABELS, monthYear, REJECTION_REASONS, type PostKind, type PostState } from '../../shared/reference';
import { announce } from '../core/announce';
import { failureOf, get, post } from '../core/api';
import { el, focus, on } from '../core/dom';
import { onLive, onLiveReload } from '../core/live';
import type { Cleanup } from '../core/router';
import { clearFieldErrors, currentUser, fieldError, pageAlert, working } from '../core/shell';
import { choiceRadiogroup } from '../widgets/stars';

interface QueuePost {
  id: string;
  kind: PostKind;
  label: string;
  company_name: string;
  posted_month: string;
  state: PostState;
  claimed_by_name: string | null;
  title?: string;
  pros?: string;
  cons?: string;
  role_name?: string;
  annual_pay?: number;
  text?: string;
}

interface HistoryEvent {
  type: 'claimed' | 'renewed' | 'expired' | 'approved' | 'rejected';
  by_name: string | null;
  reason: string | null;
  at: string;
}

function historyText(event: HistoryEvent): string {
  switch (event.type) {
    case 'claimed':
      return `Claimed by ${event.by_name}`;
    case 'renewed':
      return `Claim renewed by ${event.by_name}`;
    case 'expired':
      return 'Claim expired';
    case 'approved':
      return `Approved by ${event.by_name}`;
    case 'rejected':
      return `Rejected by ${event.by_name}: ${event.reason}`;
  }
}

const RENEW_GAP_MS = 5000;

export async function renderModeration(container: HTMLElement): Promise<Cleanup> {
  const page = el('div', { class: 'working-screen' }, [el('h1', { text: 'Moderation queue' })]);
  container.append(page);
  const alert = pageAlert(page);
  const tableHost = el('div');
  page.append(tableHost);

  const me = currentUser();
  let posts: QueuePost[] = [];
  const decided = new Map<string, string>();
  const histories = new Map<string, HistoryEvent[]>();
  const claimButtons = new Map<string, HTMLButtonElement>();
  let openDecision: string | null = null;
  let lastRenew = 0;

  const statusText = (item: QueuePost): string => {
    const settled = decided.get(item.id);
    if (settled) return settled;
    if (item.state === 'claimed') {
      return item.claimed_by_name === me?.display_name ? 'Claimed by you' : `Claimed by ${item.claimed_by_name}`;
    }
    return 'Pending';
  };

  const loadHistory = async (id: string): Promise<void> => {
    histories.set(id, (await get<{ events: HistoryEvent[] }>(`/api/moderation/${id}/history`)).events);
  };

  const renew = (id: string): void => {
    const now = performance.now();
    if (now - lastRenew < RENEW_GAP_MS) return;
    lastRenew = now;
    void post(`/api/moderation/${id}/renew`).catch(() => undefined);
  };

  const summaryOf = (item: QueuePost): string => {
    if (item.kind === 'review') return `${item.title ?? ''} — ${item.pros ?? ''}`;
    if (item.kind === 'pay_report') return `${item.role_name ?? ''} — ${item.annual_pay ?? ''}`;
    return `${item.role_name ?? ''} — ${item.text ?? ''}`;
  };

  const focusNextClaim = (afterId: string): void => {
    const order = posts.map((item) => item.id);
    const index = order.indexOf(afterId);
    for (const id of order.slice(index + 1)) {
      const button = claimButtons.get(id);
      if (button) {
        button.focus();
        return;
      }
    }
    focus(page.querySelector('.back-link'));
  };

  const decisionForm = (item: QueuePost): HTMLElement => {
    const host = el('div', { class: 'decision-form', 'data-decision-for': item.id });
    const reasonHost = el('div');
    const detailsHost = el('div');
    const details = el('textarea', { 'aria-label': 'Reason details', class: 'textbox', rows: '2' });
    const submit = el('button', { type: 'button', class: 'solid-button', text: 'Submit decision' });

    const reasons = choiceRadiogroup(
      'Reason',
      REJECTION_REASONS.map((reason) => ({ id: reason, label: reason })),
    );
    on(reasons.element, 'choice' as keyof HTMLElementEventMap, () => {
      renew(item.id);
      detailsHost.replaceChildren(...(reasons.value() === 'Other' ? [details] : []));
    });

    const decision = choiceRadiogroup('Decision', [
      { id: 'approve', label: 'Approve' },
      { id: 'reject', label: 'Reject' },
    ]);
    on(decision.element, 'choice' as keyof HTMLElementEventMap, () => {
      renew(item.id);
      if (decision.value() === 'reject') reasonHost.replaceChildren(reasons.element);
      else {
        reasonHost.replaceChildren();
        detailsHost.replaceChildren();
      }
    });
    on(details, 'input', () => renew(item.id));

    on(submit, 'click', () => {
      clearFieldErrors(host);
      if (decision.value() === 'reject' && !reasons.value()) {
        fieldError(reasons.element, 'Choose a reason.');
        focus(reasons.firstRadio());
        return;
      }
      const done = working(submit);
      void post<{ state: string; decided_by_name: string }>(`/api/moderation/${item.id}/decision`, {
        decision: decision.value() ?? 'approve',
        reason: reasons.value(),
        details: details.value,
      })
        .then(async (outcome) => {
          decided.set(item.id, outcome.state === 'approved' ? 'Approved by you' : 'Rejected by you');
          announce(`${outcome.state === 'approved' ? 'Approved' : 'Rejected'} ${item.label}.`);
          openDecision = null;
          await loadHistory(item.id);
          const next = item.id;
          paint();
          focusNextClaim(next);
        })
        .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.'))
        .finally(done);
    });

    host.append(decision.element, reasonHost, detailsHost, submit);
    return host;
  };

  const paint = (): void => {
    claimButtons.clear();
    const visible = posts;
    const backLink = (): HTMLElement => el('a', { href: '/jobs', class: 'back-link', text: 'Back to job search' });
    if (visible.length === 0) {
      tableHost.replaceChildren(
        el('div', { class: 'empty-state' }, [el('p', { text: 'Nothing is waiting for review.' }), backLink()]),
      );
      return;
    }

    const head = el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Type' }),
        el('th', { scope: 'col', text: 'Company' }),
        el('th', { scope: 'col', text: 'Summary' }),
        el('th', { scope: 'col', text: 'Posted' }),
        el('th', { scope: 'col', text: 'Status' }),
      ]),
    ]);
    const body = el('tbody');
    for (const item of visible) {
      const summaryCell = el('td', {}, [el('p', { class: 'summary-text', text: summaryOf(item) })]);
      const historyList = el('ul', { 'aria-label': `History of ${item.label}`, class: 'history-list' });
      for (const event of histories.get(item.id) ?? []) historyList.append(el('li', { text: historyText(event) }));
      summaryCell.append(historyList);

      const statusCell = el('td', { class: 'status-cell', text: statusText(item) });
      const settled = decided.has(item.id);
      const mineClaim = item.state === 'claimed' && item.claimed_by_name === me?.display_name;

      if (!settled && !mineClaim) {
        const claim = el('button', {
          type: 'button',
          class: 'nav-action',
          'aria-label': `Claim ${item.label}`,
          text: 'Claim',
        });
        on(claim, 'click', () => {
          const done = working(claim);
          void post<{ claimed_by_name: string }>(`/api/moderation/${item.id}/claim`)
            .then(() => {
              openDecision = item.id;
              lastRenew = 0;
              announce(`Claimed ${item.label}.`);
              item.state = 'claimed';
              item.claimed_by_name = me?.display_name ?? null;
              void loadHistory(item.id).then(() => {
                paint();
                focus(tableHost.querySelector<HTMLElement>(`[data-decision-for="${item.id}"] [role="radio"]`));
              });
            })
            .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.'))
            .finally(done);
        });
        claimButtons.set(item.id, claim);
        statusCell.append(claim);
      }

      const row = el('tr', { 'data-id': item.id, class: mineClaim ? 'queue-row claimed' : 'queue-row' }, [
        el('td', { text: KIND_LABELS[item.kind] }),
        el('td', { text: item.company_name }),
        summaryCell,
        el('td', { text: monthYear(item.posted_month) }),
        statusCell,
      ]);
      body.append(row);
      if (openDecision === item.id && mineClaim) {
        const detailRow = el('tr', { class: 'decision-row' }, [el('td', { colspan: '5' }, [decisionForm(item)])]);
        body.append(detailRow);
      }
    }
    const table = el('table', { 'aria-label': 'Moderation queue', class: 'queue-table' }, [head, body]);
    const undecided = visible.some((item) => !decided.has(item.id));
    tableHost.replaceChildren(...(undecided ? [table] : [table, backLink()]));
  };

  const load = async (): Promise<void> => {
    posts = (await get<{ posts: QueuePost[] }>('/api/moderation/queue')).posts;
    for (const item of posts) await loadHistory(item.id);
    paint();
  };
  await load();

  const stopLive = onLive((messages) => {
    let changed = false;
    for (const message of messages) {
      if (message.type === 'queue.changed') {
        const id = String(message.data['post_id']);
        const state = String(message.data['state']);
        const byName = (message.data['by_name'] as string | null) ?? null;
        const item = posts.find((candidate) => candidate.id === id);
        if (state === 'approved' || state === 'rejected') {
          if (item) {
            decided.set(id, `${state === 'approved' ? 'Approved' : 'Rejected'} by ${byName}`);
            item.state = state as PostState;
          }
        } else if (state === 'deleted') {
          posts = posts.filter((candidate) => candidate.id !== id);
        } else if (item) {
          item.state = state as PostState;
          item.claimed_by_name = byName;
          if (state === 'pending' && openDecision === id) {
            openDecision = null;
            alert('Your claim on this post expired. Claim it again to decide.');
          }
        } else {
          void load();
          return;
        }
        changed = true;
      }
      if (message.type === 'queue.history') {
        const id = String(message.data['post_id']);
        const event = message.data['event'] as HistoryEvent;
        const list = histories.get(id) ?? [];
        list.push(event);
        histories.set(id, list);
        changed = true;
      }
    }
    if (changed) {
      const active = document.activeElement as HTMLElement | null;
      const activeId = active?.getAttribute('aria-label');
      paint();
      if (activeId) {
        focus(tableHost.querySelector<HTMLElement>(`[aria-label="${activeId}"]`));
      }
    }
  });
  const stopReload = onLiveReload(() => void load());

  return () => {
    stopLive();
    stopReload();
  };
}
