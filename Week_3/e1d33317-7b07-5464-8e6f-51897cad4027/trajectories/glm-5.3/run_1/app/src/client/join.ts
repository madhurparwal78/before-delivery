import { VNode, render } from './jsx/jsx-runtime.js';
import { api, ApiError } from './api.js';

interface InviteInfo {
  invite: { name: string; role: string; status: string; scoreTitle: string };
}

export function JoinPage(props: { token: string; onJoined: (seatToken: string, scoreId: string) => void }): VNode {
  let info: InviteInfo['invite'] | null = null;
  let usedMessage: string | null = null;
  let busy = false;
  let error = '';

  async function load(): Promise<void> {
    try {
      const res = await api.get<InviteInfo>(`/api/invites/${props.token}`);
      info = res.invite;
      if (res.invite.status !== 'invited') {
        usedMessage =
          res.invite.status === 'removed'
            ? 'This invite was withdrawn.'
            : 'This invite has already been used.';
      }
    } catch (err) {
      usedMessage = err instanceof ApiError ? err.body.message : 'This invite is not available.';
    }
    rerender();
  }

  async function join(): Promise<void> {
    busy = true;
    rerender();
    try {
      const res = await api.post<{ seatToken: string; collaborator: { id: string } }>(`/api/invites/${props.token}/accept`, {});
      const me = await api.me();
      props.onJoined(res.seatToken, me.score.id);
    } catch (err) {
      busy = false;
      error = err instanceof ApiError ? err.body.message : 'Joining failed. Try again.';
      rerender();
    }
  }

  function rerender(): void {
    const host = document.getElementById('join-host');
    if (host) {
      host.replaceChildren(render(body()));
    }
  }

  function body(): VNode {
    if (!info && !usedMessage) {
      return { type: 'p', props: { class: 'lede' }, children: ['Loading…'] };
    }
    const children: VNode[] = [
      {
        type: 'h1',
        props: {},
        children: [`Join ${info?.scoreTitle ?? 'the score'}`],
      },
      {
        type: 'p',
        props: { class: 'lede' },
        children: [
          `${info?.name ?? ''} · ${info ? roleWord(info.role) : ''}`,
        ],
      },
    ];
    if (usedMessage) {
      children.push({ type: 'p', props: { class: 'lede' }, children: [usedMessage] });
    } else {
      children.push({
        type: 'button',
        props: {
          class: 'btn',
          disabled: busy,
          onclick: () => void join(),
        },
        children: [busy ? `Join as ${info?.name}…` : `Join as ${info?.name}`],
      });
    }
    if (error) children.push({ type: 'p', props: { class: 'lede' }, children: [error] });
    return { type: '#fragment', props: {}, children };
  }

  setTimeout(() => void load(), 0);

  return {
    type: 'div',
    props: { class: 'landing-stage' },
    children: [
      {
        type: 'main',
        props: { class: 'paper-card', id: 'join-host' },
        children: [body()],
      },
    ],
  };
}

export function roleWord(role: string): string {
  if (role === 'composer') return 'Composer';
  if (role === 'copyist') return 'Copyist';
  return 'Section player';
}
