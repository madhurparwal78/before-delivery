import { h } from './dom.js';
import { get, post } from './api.js';
import { shell, page, navigate, announce, onSocketOpen } from './app.js';
import { onEvent } from './socket.js';
import { fmtDate } from './format.js';

interface QueueEntry {
  id: string;
  holder_name: string;
  options: number;
  strike: string;
  vesting_type: string;
  vesting_start: string;
  approvals: number;
  declines: number;
  my_vote: string | null;
}

// ---------- board queue ----------

page('/board', ['board_member', 'founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  const { quorum, grants } = await get<{ quorum: number; board_size: number; grants: QueueEntry[] }>('/api/board/queue');
  const content = h('div', {});

  if (grants.length === 0) {
    root.appendChild(shell(person, h('section', { class: 'band black' }, 'Nothing is waiting for your vote.')));
    return;
  }

  const table = h('table', { 'aria-label': 'Board queue' },
    h('thead', null, h('tr', null, h('th', null, 'Grant'), h('th', null, 'Approve'), h('th', null, 'Decline'))),
    h('tbody', null, ...grants.map((g) => h('tr', null,
      h('td', null, h('a', {
        href: `/board/${g.id}`,
        'data-grant': g.id,
        onclick: (ev: Event) => { ev.preventDefault(); navigate(`/board/${g.id}`); },
      }, g.id)),
      h('td', null, h('button', { class: 'primary', 'data-approve': g.id, onclick: (ev: Event) => { void vote(g.id, 'approve', ev); } }, `Approve ${g.id}`)),
      h('td', null, h('button', { class: 'secondary', 'data-decline': g.id, onclick: (ev: Event) => { void vote(g.id, 'decline', ev); } }, `Decline ${g.id}`)),
    ))),
  );

  content.replaceChildren(h('h1', null, 'Board queue'), table);
  root.appendChild(shell(person, content));

  async function vote(grantId: string, voteKind: 'approve' | 'decline', ev: Event): Promise<void> {
    const btn = ev.target as HTMLButtonElement;
    try {
      const r = await post<{ approvals: number; quorum?: number }>(`/api/board/queue/${grantId}/votes`, { vote: voteKind });
      if (voteKind === 'approve') {
        announce(`Your approval of ${grantId} is recorded: ${r.approvals} of ${quorum} approvals.`, `vote-${grantId}`);
      } else {
        announce(`Your decline of ${grantId} is recorded.`, `vote-${grantId}`);
      }
      navigate('/board', true);
    } catch (e) {
      const err = e as { message?: string };
      announce(err.message ?? '', `vote-fail-${grantId}`);
      void btn;
    }
  }

  onSocketOpen((open) => {
    for (const b of content.querySelectorAll<HTMLButtonElement>('button')) b.disabled = !open;
  });});

page('/board/:id', ['board_member', 'founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  const grantId = ctx.params.id!;
  const content = h('div', {});

  async function draw(): Promise<void> {
    let g: QueueEntry | null = null;
    let quorum = 0;
    try {
      const q = await get<{ quorum: number; grants: QueueEntry[] }>('/api/board/queue');
      quorum = q.quorum;
      g = q.grants.find((x) => x.id === grantId) ?? null;
    } catch {
      g = null;
    }
    if (!g) {
      content.replaceChildren(
        h('section', { class: 'band black full-bleed' },
          h('h1', null, 'Not on your register'),
          h('p', null, "This record isn't on your register.")),
      );
      return;
    }

    const heading = h('h1', { tabindex: '-1', id: 'summary-heading' }, g.id);
    const back = h('a', { href: '/board', 'data-back': g.id }, 'Back to the queue');
    back.addEventListener('click', (ev) => {
      ev.preventDefault();
      history.back();
    });

    const approve = h('button', { class: 'primary' }, `Approve ${g.id}`) as HTMLButtonElement;
    const decline = h('button', { class: 'secondary' }, `Decline ${g.id}`) as HTMLButtonElement;
    const approvalsText = h('p', null, `${g.approvals} of ${quorum} approvals`);

    approve.addEventListener('click', async () => {
      try {
        const r = await post<{ approvals: number }>(`/api/board/queue/${g!.id}/votes`, { vote: 'approve' });
        announce(`Your approval of ${g!.id} is recorded: ${r.approvals} of ${quorum} approvals.`, `vote-${g!.id}`);
        await draw();
      } catch (e) {
        const err = e as { message?: string };
        announce(err.message ?? '', `vote-fail-${g!.id}`);
      }
    });

    decline.addEventListener('click', async () => {
      try {
        await post(`/api/board/queue/${g!.id}/votes`, { vote: 'decline' });
        announce(`Your decline of ${g!.id} is recorded.`, `vote-${g!.id}`);
        await draw();
      } catch (e) {
        const err = e as { message?: string };
        announce(err.message ?? '', `vote-fail-${g!.id}`);
      }
    });

    content.replaceChildren(
      h('section', { role: 'region', 'aria-label': 'Grant summary' },
        heading,
        h('p', null, `Holder ${g.holder_name}`),
        h('p', null, `Options ${g.options.toLocaleString('en-US')}`),
        h('p', null, `Strike price $${g.strike}`),
        h('p', null, `Vesting ${g.vesting_type === 'standard' ? '4 years, 1-year cliff' : '4 years monthly, no cliff'}, from ${fmtDate(g.vesting_start)}`),
        approvalsText,
        approve,
        decline,
        back,
      ),
    );

    onSocketOpen((open) => {
      approve.disabled = !open;
      decline.disabled = !open;
    });

    onEvent((ev) => {
      const data = ev.data as Record<string, unknown> | null;
      if (ev.type === 'grant_state' && data?.grant_id === grantId) {
        void draw();
      }
    });
  }

  root.appendChild(shell(person, content));
  await draw();
  const heading = document.getElementById('summary-heading');
  if (heading instanceof HTMLElement) heading.focus();

  content.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      history.back();
    }
  });

  onEvent((ev) => {
    const data = ev.data as Record<string, unknown> | null;
    if (ev.type === 'grant_state' && data?.grant_id === grantId) {
      const stillQueued = data.state === 'board_queue';
      if (!stillQueued) {
        content.replaceChildren(
          h('section', { class: 'band black full-bleed' },
            h('h1', null, 'Not on your register'),
            h('p', null, "This record isn't on your register.")),
        );
      }
    }
  });
});
