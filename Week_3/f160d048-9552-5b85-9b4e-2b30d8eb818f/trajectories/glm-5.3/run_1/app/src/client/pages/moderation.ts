// The shared moderation queue: claim, decide, history and live updates.
import { h, clear } from '../dom.js';
import { api, ApiFailure, apiErrorMessage } from '../api.js';
import { alertBand, announce } from '../feedback.js';
import { live, onReload } from '../live.js';
import { REJECTION_REASONS } from '../reference.js';
import type { QueuePost } from '../types.js';
import type { PageContext } from '../app.js';

export function moderationPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'full-width' });
  if (!ctx.me || (ctx.me.role !== 'moderator' && ctx.me.role !== 'founder')) {
    main.appendChild(h('h1', {}, 'Page not found'));
    main.appendChild(h('p', {}, 'It may have been removed, or the link is wrong.'));
    main.appendChild(h('p', {}, h('a', { href: '/jobs' }, 'Search lab jobs')));
    return main;
  }
  const tableHost = h('div', {});
  main.appendChild(h('h1', {}, 'Moderation queue'));
  main.appendChild(tableHost);
  void build(tableHost, ctx);
  return main;
}

interface HistoryEvent {
  type: string;
  by_name: string | null;
  reason: string | null;
  at: string;
}

function historyText(event: HistoryEvent): string {
  if (event.type === 'claimed') return `Claimed by ${event.by_name}`;
  if (event.type === 'renewed') return `Claim renewed by ${event.by_name}`;
  if (event.type === 'expired') return 'Claim expired';
  if (event.type === 'approved') return `Approved by ${event.by_name}`;
  return `Rejected by ${event.by_name}: ${event.reason ?? ''}`;
}

async function build(host: HTMLElement, ctx: PageContext): Promise<void> {
  let posts: QueuePost[] = [];
  const histories = new Map<string, HistoryEvent[]>();
  let claimedId: string | null = null;
  let lastRenew = 0;

  const table = h('table', {}, h('caption', { class: 'visually-hidden' }, 'Moderation queue'));
  const tbody = h('tbody', {});
  table.appendChild(tbody);
  host.appendChild(table);

  async function reload(): Promise<void> {
    const response = await api.get<{ posts: QueuePost[] }>('/api/moderation/queue');
    posts = response.posts;
    await Promise.all(
      posts.map(async (post) => {
        const history = await api.get<{ events: HistoryEvent[] }>(`/api/moderation/${post.id}/history`);
        histories.set(post.id, history.events);
      }),
    );
    render();
  }

  function statusText(post: QueuePost): string {
    if (post.state === 'claimed') {
      return post.claimed_by_you ? 'Claimed by you' : `Claimed by ${post.claimed_by_name ?? ''}`;
    }
    if (post.state === 'approved') return post.claimed_by_you ? 'Approved by you' : `Approved by ${post.claimed_by_name ?? ''}`;
    if (post.state === 'rejected') return post.claimed_by_you ? 'Rejected by you' : `Rejected by ${post.claimed_by_name ?? ''}`;
    return 'Pending';
  }

  function render(): void {
    clear(tbody);
    for (const post of posts) {
      const row = h('tr', { 'data-id': post.id, class: post.state === 'claimed' && post.claimed_by_you ? 'claimed-row' : '' });
      row.appendChild(h('td', {}, post.kind === 'pay_report' ? 'pay report' : post.kind === 'interview_note' ? 'interview note' : 'review'));
      row.appendChild(h('td', {}, post.company_name));
      row.appendChild(h('td', {}, post.label));
      row.appendChild(h('td', {}, post.posted_month));
      row.appendChild(h('td', { class: 'post-status', 'data-state': post.state }, statusText(post)));
      const historyCell = h('td', {});
      const historyList = h('ul', { role: 'list', 'aria-label': `History of ${post.label}` });
      for (const event of histories.get(post.id) ?? []) {
        historyList.appendChild(h('li', {}, historyText(event)));
      }
      historyCell.appendChild(historyList);
      row.appendChild(historyCell);
      const actionCell = h('td', {});
      if (post.state === 'pending') {
        const claim = h('button', { class: 'text-button', type: 'button' }, `Claim ${post.label}`);
        claim.addEventListener('click', async () => {
          try {
            await api.post(`/api/moderation/${post.id}/claim`);
            claimedId = post.id;
            announce(`Claimed ${post.label}.`);
            await reload();
            const rowEl = tbody.querySelector(`tr[data-id="${post.id}"]`);
            (rowEl?.querySelector('input[value="approve"]') as HTMLElement | null)?.focus();
          } catch (err) {
            alertBand(apiErrorMessage(err));
          }
        });
        actionCell.appendChild(claim);
      } else if (post.state === 'claimed' && post.claimed_by_you) {
        actionCell.appendChild(decisionForm(post));
      }
      row.appendChild(actionCell);
      tbody.appendChild(row);
    }
    if (posts.length === 0) {
      host.appendChild(h('p', {}, 'Nothing is waiting for review. ', h('a', { href: '/jobs' }, 'Back to job search')));
    }
  }

  function decisionForm(post: QueuePost): HTMLElement {
    const form = h('div', { class: 'decision-form' });
    const decisionGroup = h('div', { role: 'radiogroup', 'aria-label': 'Decision' });
    const approve = h('input', { type: 'radio', name: `decision-${post.id}`, id: `approve-${post.id}`, value: 'approve' }) as HTMLInputElement;
    const reject = h('input', { type: 'radio', name: `decision-${post.id}`, id: `reject-${post.id}`, value: 'reject' }) as HTMLInputElement;
    decisionGroup.appendChild(h('label', { for: `approve-${post.id}` }, 'Approve'));
    decisionGroup.appendChild(approve);
    decisionGroup.appendChild(h('label', { for: `reject-${post.id}` }, 'Reject'));
    decisionGroup.appendChild(reject);
    const reasonGroup = h('div', { role: 'radiogroup', 'aria-label': 'Reason', hidden: 'hidden' });
    const details = h('textarea', { rows: '2', 'aria-label': 'Reason details', hidden: 'hidden' }) as HTMLTextAreaElement;
    const submit = h('button', { class: 'solid-button', type: 'button' }, 'Submit decision');

    async function renew(): Promise<void> {
      const now = Date.now();
      if (now - lastRenew < 5000) return;
      lastRenew = now;
      try {
        await api.post(`/api/moderation/${post.id}/renew`);
      } catch {
        // a lost lease shows the conflict on submit
      }
    }

    approve.addEventListener('change', () => renew());
    reject.addEventListener('change', () => {
      reasonGroup.removeAttribute('hidden');
      reasonGroup.replaceChildren(
        ...REJECTION_REASONS.map((reason, index) => {
          const radio = h('input', { type: 'radio', name: `reason-${post.id}`, id: `reason-${post.id}-${index}`, value: reason }) as HTMLInputElement;
          radio.addEventListener('change', () => {
            if (reason === 'Other') {
              details.removeAttribute('hidden');
            } else {
              details.setAttribute('hidden', 'hidden');
            }
            void renew();
          });
          const cell = h('label', { for: `reason-${post.id}-${index}` }, reason);
          const wrap = h('div', { class: 'field-row' }, radio, cell);
          return wrap;
        }),
      );
      void renew();
    });
    details.addEventListener('input', () => void renew());

    submit.addEventListener('click', async () => {
      const decision = approve.checked ? 'approve' : reject.checked ? 'reject' : null;
      if (!decision) {
        alertBand('Choose a decision.');
        return;
      }
      let reason: string | null = null;
      let detailsText: string | null = null;
      if (decision === 'reject') {
        const checked = reasonGroup.querySelector<HTMLInputElement>('input:checked');
        if (!checked) {
          alertBand('Choose a reason.');
          (reasonGroup.querySelector('input') as HTMLElement)?.focus();
          return;
        }
        reason = checked.value;
        if (reason === 'Other') {
          detailsText = details.value;
          if (detailsText.trim().length < 5) {
            alertBand('Add 5 to 200 characters.');
            details.focus();
            return;
          }
        }
      }
      try {
        const result = await api.post<{ state: string }>(`/api/moderation/${post.id}/decision`, {
          decision,
          reason,
          details: detailsText,
        });
        announce(decision === 'approve' ? `Approved ${post.label}.` : `Rejected ${post.label}.`);
        claimedId = null;
        await reload();
        void result;
        const rows = Array.from(tbody.querySelectorAll('button[class*="Claim"]'));
        if (rows.length > 0) {
          (rows[0] as HTMLElement).focus();
        } else {
          const back = host.querySelector('a');
          (back as HTMLElement | null)?.focus();
        }
      } catch (err) {
        if (err instanceof ApiFailure) {
          alertBand(err.body.message);
        } else {
          alertBand(apiErrorMessage(err));
        }
      }
    });

    form.appendChild(decisionGroup);
    form.appendChild(reasonGroup);
    form.appendChild(details);
    form.appendChild(submit);
    return form;
  }

  await reload();

  live.subscribe((event) => {
    if (event.type === 'queue.changed') {
      const postId = event.data.post_id as string;
      const state = event.data.state as string;
      const byName = event.data.by_name as string | null;
      const row = tbody.querySelector(`tr[data-id="${postId}"]`);
      if (row) {
        const status = row.querySelector('.post-status');
        if (status) {
          status.setAttribute('data-state', state);
          status.textContent =
            state === 'claimed'
              ? byName === ctx.me!.display_name
                ? 'Claimed by you'
                : `Claimed by ${byName ?? ''}`
              : state === 'approved'
                ? byName === ctx.me!.display_name
                  ? 'Approved by you'
                  : `Approved by ${byName ?? ''}`
                : state === 'rejected'
                  ? byName === ctx.me!.display_name
                    ? 'Rejected by you'
                    : `Rejected by ${byName ?? ''}`
                  : 'Pending';
        }
      }
    }
    if (event.type === 'queue.history') {
      const postId = event.data.post_id as string;
      const historyEvent = event.data.event as HistoryEvent;
      const events = histories.get(postId) ?? [];
      events.push(historyEvent);
      histories.set(postId, events);
      const row = tbody.querySelector(`tr[data-id="${postId}"]`);
      const list = row?.querySelector('ul');
      if (list) {
        list.appendChild(h('li', {}, historyText(historyEvent)));
      }
    }
  });
  onReload(() => void reload());
}
