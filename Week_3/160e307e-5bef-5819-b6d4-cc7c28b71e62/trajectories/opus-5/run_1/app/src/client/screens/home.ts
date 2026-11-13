import { api, ApiFailure } from '../api.js';
import { clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { navigate, setPageStatus } from '../router.js';
import { refreshMe, state } from '../store.js';
import { openDialog, radioGroup } from '../ui.js';
import { topbar } from './shell.js';

function playField(
  id: string,
  word: string,
  colour: 'tomato' | 'cobalt',
  label: string,
  actions: (Node | string)[],
): HTMLElement {
  return el('section', { class: `field field--${colour}`, id }, [
    el('p', { class: 'crop-word', text: word }),
    el('p', { style: 'font-weight:700;margin-top:0.75rem', text: label }),
    el('div', { class: 'play-field__actions' }, actions),
  ]);
}

function createRoomDialog(): void {
  let format = 'quick';
  openDialog('Create a room', (handle) => {
    const create = el('button', { type: 'button', text: 'Create' });
    const close = el('button', { type: 'button', text: 'Close' });
    create.addEventListener('click', () => {
      void (async () => {
        create.disabled = true;
        try {
          const room = await api.post<{ code: string }>('/api/rooms', { format });
          handle.close();
          navigate(`/room/${room.code}`);
        } catch {
          create.disabled = false;
        }
      })();
    });
    close.addEventListener('click', () => handle.close());
    return [
      el('h2', { class: 'display', text: 'Create a room', style: 'font-size: var(--step-2)' }),
      radioGroup(
        'Format',
        [
          { value: 'quick', label: 'Quick' },
          { value: 'classic', label: 'Classic' },
        ],
        'quick',
        (next) => {
          format = next;
        },
      ),
      el('div', { class: 'dialog-actions' }, [create, close]),
    ];
  });
}

function linkEmailDialog(onLinked: () => void): void {
  openDialog('Link your email', (handle) => {
    const input = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'email' });
    const status = el('div', { role: 'status', style: 'font-weight:700;margin-top:0.6rem' });
    const error = el('div', { role: 'alert', class: 'inline-error' });
    const send = el('button', { type: 'button', text: 'Send link' });
    const close = el('button', { type: 'button', text: 'Close' });

    send.addEventListener('click', () => {
      void (async () => {
        clear(error);
        status.textContent = '';
        send.textContent = 'Sending...';
        send.disabled = true;
        try {
          await api.post('/api/auth/link', { email: input.value });
          status.textContent = `Link sent to ${input.value}. Open it on any device.`;
          onLinked();
        } catch (failure) {
          const code = failure instanceof ApiFailure ? failure.code : 'SERVER_ERROR';
          const message =
            code === 'MAIL_UNAVAILABLE'
              ? "We couldn't send the link. Try again in a minute."
              : code === 'ALREADY_LINKED'
                ? 'That email is already linked to another address.'
                : 'Enter a valid email address.';
          error.append(icon('circle-alert'), el('span', { text: message }));
        } finally {
          send.textContent = 'Send link';
          send.disabled = false;
        }
      })();
    });
    close.addEventListener('click', () => handle.close());

    return [
      el('h2', { class: 'display', text: 'Link your email', style: 'font-size: var(--step-2)' }),
      el('p', { text: 'Link your email to play ranked.' }),
      el('div', {}, [input, error, status]),
      el('div', { class: 'dialog-actions' }, [send, close]),
    ];
  });
}

async function enterQueue(mode: 'casual' | 'ranked'): Promise<void> {
  try {
    await api.post('/api/queue', { mode });
    navigate(`/queue/${mode}`);
  } catch (failure) {
    if (failure instanceof ApiFailure && failure.code === 'LINK_REQUIRED') {
      linkEmailDialog(() => undefined);
    }
  }
}

export async function renderHome(_params: Record<string, string>, view: HTMLElement): Promise<void> {
  await refreshMe();
  const query = new URLSearchParams(window.location.search);
  const linked = query.get('linked');
  const signedIn = query.get('signedin');
  if (linked !== null) {
    setPageStatus(`Email linked: ${linked}`);
    window.history.replaceState({}, '', '/');
  } else if (signedIn !== null) {
    setPageStatus(`Signed in as ${signedIn}`);
    window.history.replaceState({}, '', '/');
  }

  const createRoom = el('button', { type: 'button', text: 'Create a room', 'data-needs-online': 'true' });
  createRoom.addEventListener('click', () => createRoomDialog());

  const playCasual = el('button', { type: 'button', text: 'Play casual', 'data-needs-online': 'true' });
  playCasual.addEventListener('click', () => void enterQueue('casual'));

  const playRanked = el('button', { type: 'button', text: 'Play ranked', 'data-needs-online': 'true' });
  playRanked.addEventListener('click', () => {
    if (state.me?.linked !== true) {
      linkEmailDialog(() => undefined);
      return;
    }
    void enterQueue('ranked');
  });

  clear(view);
  view.append(
    el('div', {}, [
      topbar(),
      el('section', { class: 'field field--cobalt hero' }, [
        el('div', {}, [el('h1', { class: 'crop-word', text: 'DUE COIN' })]),
        el('div', {}, [
          el('p', { class: 'hero__label', text: 'Carrom, refereed in the open.' }),
          el('a', { href: '#pass-field', class: 'hero__cta', text: 'Play now' }),
        ]),
      ]),
      playField('pass-field', 'PASS', 'tomato', 'One board, two players, one device.', [
        el('a', { href: '/play/local', class: 'hero__cta', text: 'Pass and play' }),
      ]),
      playField('room-field', 'ROOM', 'cobalt', 'Share a code with one friend.', [
        createRoom,
        el('a', { href: '/join', class: 'hero__cta', text: 'Join with a code' }),
      ]),
      playField('ranked-field', 'RANKED', 'tomato', 'Rated singles against a stranger.', [
        playCasual,
        playRanked,
      ]),
    ]),
  );
  document.querySelector<HTMLAnchorElement>('a[href="#pass-field"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('pass-field')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
