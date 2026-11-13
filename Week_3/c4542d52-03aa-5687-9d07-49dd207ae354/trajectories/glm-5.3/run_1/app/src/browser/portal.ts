import { h } from './dom.js';
import { get } from './api.js';
import { shell, page, navigate, announce } from './app.js';
import { onEvent } from './socket.js';
import { fmtCountdown, fmtDate, fmtInstant } from './format.js';

interface PortalData {
  first_name: string;
  vested_today?: number;
  total_options?: number;
  next_tranche_date?: string | null;
  exercisable?: number;
  window_ends_at?: string | null;
  fully_diluted_shares?: number;
  ownership?: string;
  open_tender?: { id: string; closes_at: string } | null;
  awaiting_vote?: number;
  quorum?: number;
  board_size?: number;
  fully_diluted_total?: number;
  offers_to_send?: number;
}

const PHOTOS = ['/assets/photos/robot-arms.png', '/assets/photos/workbench.png', '/assets/photos/hands-desk.png', '/assets/photos/parts-tray.png'];

page('/', async (root, ctx) => {
  const data = await get<PortalData>('/api/portal');
  const person = ctx.person;

  const nameTile = h('div', { class: 'tile name' }, h('h1', { tabindex: '-1', id: 'portal-name' }, data.first_name));

  let statTile: HTMLElement;
  if (person.role === 'option_holder') {
    statTile = h('div', { class: 'tile dark' },
      h('div', { class: 'caption' }, `Vested today`),
      h('div', { class: 'figure num' }, `${(data.vested_today ?? 0).toLocaleString('en-US')} of ${(data.total_options ?? 0).toLocaleString('en-US')}`),
    );
  } else if (person.role === 'leaver') {
    const countdown = h('span', { class: 'num' }, fmtCountdown(data.window_ends_at ?? null));
    statTile = h('div', { class: 'tile dark' },
      h('div', { class: 'caption' }, 'Exercisable now'),
      h('div', { class: 'figure num' }, (data.exercisable ?? 0).toLocaleString('en-US')),
      h('div', { class: 'caption', style: { marginTop: '10px' }, role: 'timer', 'aria-label': 'Exercise window' },
        h('span', { class: 'num' }, countdown), ' left'),
    );
  } else if (person.role === 'investor') {
    statTile = h('div', { class: 'tile dark' },
      h('div', { class: 'caption' }, 'Your fully diluted ownership'),
      h('div', { class: 'figure num' }, `${data.ownership}%`),
    );
  } else if (person.role === 'board_member') {
    statTile = h('div', { class: 'tile dark' },
      h('div', { class: 'caption' }, 'Grants awaiting your vote'),
      h('div', { class: 'figure num' }, String(data.awaiting_vote ?? 0)),
    );
  } else {
    statTile = h('div', { class: 'tile dark' },
      h('div', { class: 'caption' }, 'Fully diluted'),
      h('div', { class: 'figure num' }, (data.fully_diluted_total ?? 0).toLocaleString('en-US')),
    );
  }

  let redTile: HTMLElement;
  if (person.role === 'option_holder') {
    redTile = h('div', { class: 'tile red' },
      h('div', { class: 'caption' }, 'Next tranche'),
      data.next_tranche_date
        ? h('div', { class: 'figure num' }, fmtDate(data.next_tranche_date))
        : h('div', { class: 'figure' }, 'Fully vested'),
    );
  } else if (person.role === 'leaver') {
    redTile = h('div', { class: 'tile red' },
      h('div', { class: 'caption' }, 'Exercise window'),
      h('div', { class: 'figure num' }, fmtCountdown(data.window_ends_at ?? null)),
    );
  } else if (person.role === 'investor') {
    redTile = h('div', { class: 'tile red' },
      h('div', { class: 'caption' }, data.open_tender ? 'Tender open until' : 'No tender open'),
      data.open_tender ? h('div', { class: 'figure num' }, fmtInstant(data.open_tender.closes_at)) : h('div', { class: 'figure' }, ''),
    );
  } else if (person.role === 'board_member') {
    redTile = h('div', { class: 'tile red' },
      h('div', { class: 'caption' }, 'Quorum'),
      h('div', { class: 'figure num' }, `${data.quorum} of ${data.board_size}`),
    );
  } else {
    redTile = h('div', { class: 'tile red' },
      h('div', { class: 'caption' }, 'Offers to send'),
      h('div', { class: 'figure num' }, String(data.offers_to_send ?? 0)),
    );
  }

  const photo1 = h('div', { class: 'tile photo' }, h('img', { src: PHOTOS[0], alt: 'Robot arms on the Tidecraft work floor' }));
  const photo2 = h('div', { class: 'tile photo' }, h('img', { src: PHOTOS[2], alt: 'Hands working at a desk' }));

  const board = h('div', { class: 'board', role: 'region', 'aria-label': 'Portal board' },
    nameTile, statTile, photo1, redTile,
  );
  // Keep a two-by-two with two photographs.
  board.appendChild(photo2);

  root.appendChild(shell(person, board));
  const heading = document.getElementById('portal-name');
  if (heading instanceof HTMLElement) heading.focus();

  // Live clock for the leaver countdown.
  if (person.role === 'leaver') {
    onEvent((ev) => {
      if (ev.type === 'clock') {
        const c = board.querySelector('[role="timer"] .num');
        if (c) c.textContent = fmtCountdown(data.window_ends_at ?? null);
      }
    });
  }

  // Offer arrivals, role changes and access removal reach the open screen.
  onEvent((ev) => {
    const data2 = ev.data as Record<string, unknown> | null;
    if (ev.type === 'grant_state' && data2?.state === 'offered') {
      announce(`A grant offer is waiting: ${data2.grant_id}, ${data2.options} options.`, `offer-${data2.grant_id}`);
    }
    if (ev.type === 'role_changed') {
      announce(`Your role is now ${roleLabel(String(data2?.role))}.`, `role-${data2?.role}`);
      navigate('/', true);
    }
    if (ev.type === 'access_removed') {
      window.location.href = '/removed';
    }
    if (ev.type === 'offer_warning' && data2?.grant_id) {
      const strip = h('section', { class: 'strip', role: 'region', 'aria-label': 'Offer warning' },
        `The offer for grant ${data2.grant_id} lapses at ${fmtInstant(String(data2.expires_at))}. Accept or decline before then.`);
      const contentEl = document.getElementById('content');
      if (contentEl && !document.querySelector('[aria-label="Offer warning"]')) {
        contentEl.prepend(strip);
      }
      announce(`The offer for grant ${data2.grant_id} lapses at ${fmtInstant(String(data2.expires_at))}. Accept or decline before then.`, `offer-warn-${data2.grant_id}`);
    }
    if (ev.type === 'window_warning' && data2?.grant_id) {
      const strip = h('section', { class: 'strip', role: 'region', 'aria-label': 'Window warning' },
        `Your exercise window on grant ${data2.grant_id} closes in ${fmtCountdown(String(data2.window_ends_at))}.`);
      const contentEl = document.getElementById('content');
      if (contentEl && !document.querySelector('[aria-label="Window warning"]')) {
        contentEl.prepend(strip);
      }
      announce(`Your exercise window on grant ${data2.grant_id} closes in ${fmtCountdown(String(data2.window_ends_at))}.`, `window-warn-${data2.grant_id}`);
    }
  });
});

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    founder_admin: 'Founder admin',
    board_member: 'Board member',
    option_holder: 'Option holder',
    leaver: 'Leaver',
    investor: 'Investor',
  };
  return labels[role] ?? role;
}

