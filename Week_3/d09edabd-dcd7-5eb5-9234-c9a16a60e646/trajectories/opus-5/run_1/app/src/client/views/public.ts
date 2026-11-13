import { ApiFailure, request } from '../api.js';
import { copy } from '../../shared/copy.js';
import { chainOrder } from '../../shared/chain.js';
import { starterRooms } from '../../shared/starter.js';
import type { Placement } from '../../shared/types.js';
import { el, field, prefersReducedMotion } from '../dom.js';
import { RoomStage } from '../stage/stage.js';

const vault = starterRooms[starterRooms.length - 1];

function tourPlacements(): Placement[] {
  return vault.placements.map((placement, index) => ({
    id: `tour-${index}`,
    kind: placement.kind,
    label: placement.label,
    propId: null,
    entry: placement.entry === true,
    xMm: placement.xMm,
    yMm: placement.yMm,
    zMm: placement.zMm,
    rotationDeg: placement.rotationDeg,
    widthMm: placement.widthMm,
    depthMm: placement.depthMm,
    heightMm: placement.heightMm,
    version: 1,
  }));
}

function tourNodeTitles(): string[] {
  const nodes = vault.nodes.map((node) => ({
    id: node.title,
    prerequisites: node.needs ?? [],
  }));
  return chainOrder(nodes).map((node) => node.id);
}

const panels: { heading: string; text: string }[] = [
  {
    heading: 'Walk the room before you build it.',
    text: 'Lay out the room to true scale in millimetres, then walk in at player height.',
  },
  {
    heading: 'Wire the chain as trigger nodes.',
    text: 'Puzzles, maglocks, cues and the exit, with their prerequisites.',
  },
  {
    heading: 'Read the bottleneck.',
    text: 'The longest linear run tells you how much of the team is standing idle.',
  },
  {
    heading: 'Run a remote playtest.',
    text: 'Invite testers by email, watch one server clock and send hints.',
  },
  {
    heading: 'Freeze a build pack.',
    text: 'The carpenter reads metres, or feet, inches and sixteenths.',
  },
];

export function publicView(root: HTMLElement, go: (path: string) => void): void {
  document.body.className = 'scrolls';
  const stage = new RoomStage();
  stage.setRoom(vault, tourPlacements());
  root.append(stage.element);

  const titles = tourNodeTitles();
  const items = titles.map((title) => el('li', { text: title }));
  const chainList = el('div', { class: 'chain-list' }, [
    el('h2', { text: "Vault chain" }),
    el('ul', { role: 'list', 'aria-label': 'Vault chain' }, items),
  ]);
  const progressStatus = el('p', {
    role: 'status',
    'aria-label': 'Tour progress',
    text: '0 of 6 cues lit',
  });
  chainList.append(progressStatus);

  const header = el('div', { class: 'public-header' }, [
    el('span', { class: 'wordmark' }, [
      el('span', { class: 'mark', 'aria-hidden': 'true' }),
      document.createTextNode(' Keyway'),
      el('span', { text: 'bench' }),
    ]),
  ]);
  const signIn = el('a', { href: '/signin', text: 'Sign in' });
  signIn.addEventListener('click', (event) => {
    event.preventDefault();
    go('/signin');
  });
  header.append(signIn);

  const page = el('div', { class: 'public' }, [
    ...panels.map((panel, index) =>
      el('section', { class: 'tour-panel' }, [
        el('div', { class: 'box' }, [
          index === 0
            ? el('h1', { text: panel.heading })
            : el('h2', { text: panel.heading }),
          el('p', { text: panel.text }),
        ]),
      ]),
    ),
  ]);

  const email = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'email' });
  const password = el('input', {
    type: 'password',
    'aria-label': 'Password',
    autocomplete: 'new-password',
  });
  const name = el('input', { type: 'text', 'aria-label': 'Your name' });
  const venue = el('input', { type: 'text', 'aria-label': 'Venue name' });
  const problem = el('p', { class: 'field-error', role: 'alert' });
  const form = el('form', { class: 'signup-sheet', 'aria-label': 'Create your venue' }, [
    el('h2', { text: 'Open your bench' }),
    field('Email', email),
    field('Password', password),
    field('Your name', name),
    field('Venue name', venue),
    problem,
    el('button', { type: 'submit', class: 'primary', text: 'Create venue' }),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    problem.textContent = '';
    void request<unknown>('POST', '/api/auth/signup', {
      body: {
        email: email.value,
        password: password.value,
        displayName: name.value,
        venueName: venue.value,
      },
    })
      .then(() => go('/app'))
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.body.error === 'email_taken') {
          problem.textContent = copy.emailTaken;
          return;
        }
        if (error instanceof ApiFailure && error.body.errors) {
          problem.textContent = Object.values(error.body.errors)[0] ?? '';
          return;
        }
        problem.textContent = copy.linkInvalid;
      });
  });
  page.append(form);
  root.append(header, chainList, page);

  const reduced = prefersReducedMotion();
  const update = (): void => {
    const scrollable = Math.max(1, document.body.scrollHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, window.scrollY / scrollable));
    let lit = 0;
    items.forEach((item, index) => {
      const on = progress >= (index + 1) / 7;
      if (on) lit += 1;
      item.classList.toggle('lit', on);
    });
    progressStatus.textContent = `${lit} of 6 cues lit`;
    stage.setTourProgress(reduced ? 0 : progress);
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}
