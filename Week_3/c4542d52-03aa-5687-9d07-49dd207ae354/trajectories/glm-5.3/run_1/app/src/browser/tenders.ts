import { h } from './dom.js';
import { get, post, put, del } from './api.js';
import type { Tender } from './api.js';
import { shell, page, navigate, announce, onSocketOpen } from './app.js';
import { onEvent } from './socket.js';
import { fmtCountdown, fmtInstant, fmtMoney } from './format.js';

/** Interprets a typed "YYYY-MM-DD HH:MM" wall-clock time as Pacific time. */
function pacificInstant(text: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return new Date(text).toISOString();
  const [, y, mo, d, hh, mm] = m;
  // Find the UTC instant whose Pacific wall clock equals the typed time by
  // probing the two possible UTC offsets around a first guess.
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm));
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const matches = (ms: number): boolean => {
    const parts = fmt.format(new Date(ms)).match(/(\d{4})-(\d{2})-(\d{2}),?\s+(\d{2}):(\d{2})/);
    return parts !== null && parts[1] === y && parts[2] === mo && parts[3] === d && parts[4] === hh && parts[5] === mm;
  };
  for (const offsetMs of [-8 * 3600_000, -7 * 3600_000]) {
    const candidate = naive - offsetMs;
    if (matches(candidate)) return new Date(candidate).toISOString();
  }
  return new Date(naive).toISOString();
}

// The Tender chapter opens with a full-bleed black band.
page('/tenders', ['investor', 'founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  const { tenders } = await get<{ tenders: Tender[] }>('/api/tenders');
  if (tenders.length === 0) {
    root.appendChild(shell(person,
      h('section', { class: 'band black full-bleed' }, h('h1', {}, 'Tender')),
      h('section', { class: 'band black' }, 'No tender is open.'),
    ));
    return;
  }
  const list = h('ul', { style: { listStyle: 'none', padding: 0 } });
  for (const t of tenders) {
    const li = h('li', { style: { marginBottom: '12px' } });
    const link = h('a', { href: `/tenders/${t.id}` }, `${t.title} (${t.state})`);
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      navigate(`/tenders/${t.id}`);
    });
    li.append(link);
    list.appendChild(li);
  }
  root.appendChild(shell(person,
    h('section', { class: 'band black full-bleed' }, h('h1', {}, 'Tender')),
    list,
  ));
});

page('/tenders/:id', ['investor', 'founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  const tenderId = ctx.params.id!;
  const content = h('div', {});
  root.appendChild(shell(person,
    h('section', { class: 'band black full-bleed' }, h('h1', {}, 'Tender')),
    content,
  ));

  async function draw(initial: boolean): Promise<void> {
    const t = await get<Tender>(`/api/tenders/${tenderId}`);

    const title = h('h2', { id: 'tender-title' }, t.title);
    const timer = h('span', { role: 'timer', 'aria-label': 'Tender closes in', class: 'num' }, t.state === 'open' ? fmtCountdown(t.closes_at) : 'Closed');
    const price = h('div', {}, h('span', { class: 'label' }, 'Price per share '), h('span', { class: 'num' }, `$${t.price_per_share}`));
    const cap = h('div', {}, h('span', { class: 'label' }, 'Share cap '), h('span', { class: 'num' }, t.share_cap.toLocaleString('en-US')));
    const remaining = h('div', {}, h('span', { class: 'label' }, 'Remaining cap '), h('span', { class: 'num' }, t.remaining_cap.toLocaleString('en-US')));
    const over = t.oversubscribed_by > 0
      ? h('div', {}, h('span', { class: 'label' }, 'Oversubscribed by '), h('span', { class: 'num' }, t.oversubscribed_by.toLocaleString('en-US')))
      : null;

    const parts: (Node | string)[] = [title, timer, price, cap, remaining, ...(over ? [over] : [])];

    if (person.role === 'investor' && t.mine) {
      const mine = t.mine;
      const ndaBtn = h('button', { class: 'primary' }, 'Sign NDA') as HTMLButtonElement;
      const sharesInput = h('input', { type: 'text', inputmode: 'numeric', id: 'tender-shares', 'aria-label': 'Shares to tender' }) as HTMLInputElement;
      const submitBtn = h('button', { class: 'primary' }, 'Submit tender') as HTMLButtonElement;
      const withdrawBtn = h('button', { class: 'secondary', style: { display: mine.submission ? '' : 'none' } }, 'Withdraw tender') as HTMLButtonElement;
      const sideNote = h('p', { class: 'side-note' }, mine.nda.status === 'sealed' ? '' : 'Sign the NDA to tender');

      if (mine.draft_shares) sharesInput.value = mine.draft_shares;
      if (mine.submission) {
        sharesInput.value = String(mine.submission.shares);
        sharesInput.readOnly = true;
      }

      // Draft saved within a second of typing.
      let draftTimer: number | null = null;
      sharesInput.addEventListener('input', () => {
        if (draftTimer) window.clearTimeout(draftTimer);
        draftTimer = window.setTimeout(async () => {
          try {
            await put(`/api/tenders/${tenderId}/draft`, { shares: sharesInput.value || null });
          } catch {
            // keep typed text; retry on the next keystroke
          }
        }, 600);
      });

      ndaBtn.addEventListener('click', async () => {
        ndaBtn.textContent = 'Sealing your NDA in the vault.';
        try {
          await post(`/api/tenders/${tenderId}/nda`);
          announce('NDA signed and sealed.', `nda-${tenderId}`);
          await draw(false);
        } catch (e) {
          const err = e as { message?: string };
          ndaBtn.textContent = 'Sign NDA';
          announce(err.message ?? '', `nda-fail-${tenderId}`);
        }
      });

      submitBtn.addEventListener('click', async () => {
        submitBtn.textContent = 'Submitting';
        const n = Number(sharesInput.value.trim());
        try {
          await post(`/api/tenders/${tenderId}/submissions`, { shares: n });
          announce(`Tender submitted: ${n} shares at $${t.price_per_share}.`, `submit-${tenderId}`);
          await draw(false);
        } catch (e) {
          const err = e as { message?: string; fields?: Record<string, string> };
          submitBtn.textContent = 'Submit tender';
          announce(err.fields?.shares ?? err.message ?? '', `submit-fail-${tenderId}`);
        }
      });

      withdrawBtn.addEventListener('click', async () => {
        try {
          await del(`/api/tenders/${tenderId}/submissions/mine`);
          announce('Tender withdrawn.', `withdraw-${tenderId}`);
          await draw(false);
        } catch (e) {
          const err = e as { message?: string };
          announce(err.message ?? '', `withdraw-fail-${tenderId}`);
        }
      });

      const allocation = h('section', { role: 'region', 'aria-label': 'Your allocation' });
      if (t.state === 'open' && mine.projected_allocation !== null) {
        allocation.replaceChildren(h('p', {}, `Projected allocation ${mine.projected_allocation.toLocaleString('en-US')}`));
      } else if (t.state === 'allocated' && mine.allocation !== null) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce || initial === false) {
          allocation.replaceChildren(h('p', {}, `Allocated ${mine.allocation.toLocaleString('en-US')} shares, proceeds $${fmtMoney(mine.proceeds ?? '0.00')}`));
        } else {
          // Count up to the final figure.
          const target = mine.allocation;
          const el = h('span', { class: 'num' }, '0');
          allocation.replaceChildren(h('p', {}, 'Allocated ', el, ' shares, proceeds $', fmtMoney(mine.proceeds ?? '0.00')));
          const started = performance.now();
          const step = (): void => {
            const p = Math.min(1, (performance.now() - started) / 320);
            el.textContent = Math.round(target * p).toLocaleString('en-US');
            if (p < 1) requestAnimationFrame(step);
            else el.textContent = target.toLocaleString('en-US');
          };
          requestAnimationFrame(step);
        }
      }

      parts.push(
        ndaBtn,
        h('label', { for: 'tender-shares' }, 'Shares to tender'),
        sharesInput,
        sideNote,
        submitBtn,
        withdrawBtn,
        allocation,
      );
    }

    if (person.role === 'founder_admin' && t.submissions) {
      const tbl = h('table', { 'aria-label': 'Tender submissions' },
        h('thead', null, h('tr', null,
          h('th', null, 'Seller'), h('th', null, 'Shares'), h('th', null, 'Sequence'), h('th', null, 'Allocation'), h('th', null, 'Proceeds'))),
        h('tbody', null, ...t.submissions.map((s) => h('tr', null,
          h('td', null, s.holder_name),
          h('td', { class: 'num' }, s.shares.toLocaleString('en-US')),
          h('td', { class: 'num' }, String(s.sequence)),
          h('td', { class: 'num' }, s.allocation !== null ? s.allocation.toLocaleString('en-US') : ''),
          h('td', { class: 'num' }, s.proceeds ?? ''),
        ))),
      );
      parts.push(tbl);
    }

    content.replaceChildren(...parts);

    onSocketOpen((open) => {
      const btns = content.querySelectorAll<HTMLButtonElement>('button');
      for (const b of btns) {
        if (b.textContent !== 'Close') b.disabled = !open;
      }
    });
  }

  await draw(true);

  onEvent((ev) => {
    const data = ev.data as Record<string, unknown> | null;
    if (ev.type === 'clock') {
      const timer = content.querySelector('[role="timer"]');
      void data;
      if (timer) void draw(false);
    }
    if (ev.type === 'tender_changed' && data?.tender_id === tenderId) {
      void draw(false);
    }
    if (ev.type === 'tender_closed' && data?.tender_id === tenderId) {
      void draw(false);
      const d = data as { allocation?: number; proceeds?: string };
      announce(`Tender ${tenderId} has closed.`, `close-${tenderId}`);
      if (d.allocation !== undefined) {
        announce(`Tender ${tenderId} allocated: you sold ${d.allocation} shares for $${d.proceeds}.`, `alloc-${tenderId}`);
      }
    }
  });
});

// Tenders admin: the open-tender form and the submissions table.
page('/admin/tenders', ['founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  const content = h('div', {});
  root.appendChild(shell(person, content));

  async function draw(): Promise<void> {
    const { tenders } = await get<{ tenders: Tender[] }>('/api/tenders');
    const title = h('input', { type: 'text', id: 't-title' }) as HTMLInputElement;
    const price = h('input', { type: 'text', id: 't-price' }) as HTMLInputElement;
    const cap = h('input', { type: 'text', id: 't-cap' }) as HTMLInputElement;
    const closes = h('input', { type: 'text', id: 't-closes' }) as HTMLInputElement;
    const error = h('p', { class: 'field-error', style: { display: 'none' } });
    const openBtn = h('button', { class: 'primary' }, 'Open tender') as HTMLButtonElement;

    openBtn.addEventListener('click', async () => {
      error.style.display = 'none';
      try {
        // The hint reads "YYYY-MM-DD HH:MM, Pacific time": interpret the typed
        // wall-clock time in America/Los_Angeles whatever this device's zone is.
        const t = await post<Tender>('/api/tenders', {
          title: title.value,
          price_per_share: price.value,
          share_cap: Number(cap.value),
          closes_at: pacificInstant(closes.value),
        });
        announce(`Tender ${t.id} is open until ${fmtInstant(t.closes_at)}.`, `open-${t.id}`);
        await draw();
      } catch (e) {
        const err = e as { message?: string; fields?: Record<string, string> };
        error.textContent = Object.values(err.fields ?? {})[0] ?? err.message ?? '';
        error.style.display = 'block';
      }
    });

    const list = h('ul', { style: { listStyle: 'none', padding: 0 } });
    for (const t of tenders) {
      const li = h('li', null, `${t.id} — ${t.title} (${t.state}), closes ${fmtInstant(t.closes_at)}`);
      list.appendChild(li);
    }

    content.replaceChildren(
      h('h1', null, 'Tenders'),
      h('form', { class: 'narrow', 'aria-label': 'Open tender offer', onsubmit: (ev: Event) => ev.preventDefault() },
        h('label', { for: 't-title' }, 'Title'), title,
        h('label', { for: 't-price' }, 'Price per share'), price,
        h('label', { for: 't-cap' }, 'Share cap'), cap,
        h('label', { for: 't-closes' }, 'Closes at'), closes,
        h('p', { class: 'hint' }, 'YYYY-MM-DD HH:MM, Pacific time'),
        error,
        openBtn,
      ),
      list,
    );

    onSocketOpen((open) => { openBtn.disabled = !open; });
  }

  await draw();});
