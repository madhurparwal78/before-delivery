import { RequestFailed, forgetSeatToken, rememberSeatToken, request } from './api.js';
import { button, clear, el, whilePending } from './dom.js';
import { renderPartPage } from './part-page.js';
import { ScoreState } from './score-state.js';
import { renderWorkspace } from './workspace.js';

const mount = document.querySelector<HTMLElement>('#app')!;
let state: ScoreState | null = null;

function navigate(path: string): void {
  window.history.pushState({}, '', path);
  void route();
}

function card(heading: string, children: (Node | string)[]): HTMLElement {
  return el('div', { class: 'stage-centre' }, [
    el('div', { class: 'paper-card' }, [el('h1', {}, [heading]), ...children]),
  ]);
}

function landing(): HTMLElement {
  return card('Fairline', [el('p', {}, ['Open the seat link your composer sent you.'])]);
}

function seatNotValid(): HTMLElement {
  return card('Seat link not valid', [
    el('p', {}, ['This seat link is not valid. Ask the composer for a new one.']),
  ]);
}

async function openSeat(token: string): Promise<void> {
  rememberSeatToken(token);
  try {
    const identity = await request<{
      collaborator: { role: string; staffIds: string[] };
      score: { id: string };
    }>('/api/me');
    if (identity.collaborator.role === 'player') {
      const parts = await request<{ parts: { id: string; staffIds: string[] }[] }>(
        `/api/scores/${identity.score.id}/parts`,
      );
      const own = parts.parts.find((part) =>
        part.staffIds.every((staffId) => identity.collaborator.staffIds.includes(staffId)),
      );
      if (own) {
        navigate(`/score/${identity.score.id}/parts/${own.id}`);
        return;
      }
    }
    navigate(`/score/${identity.score.id}`);
  } catch {
    forgetSeatToken();
    clear(mount);
    mount.append(seatNotValid());
  }
}

async function joinPage(token: string): Promise<HTMLElement> {
  try {
    const payload = await request<{
      invite: { name: string; role: string; status: string; scoreTitle: string };
    }>(`/api/invites/${token}`);
    const invite = payload.invite;
    const join = button(`Join as ${invite.name}`, { 'data-primary': 'true' });
    const roleWord =
      invite.role === 'copyist' ? 'Copyist' : invite.role === 'player' ? 'Section player' : 'Composer';
    const holder = el('div', { class: 'row' }, [join]);
    join.addEventListener('click', () => {
      void whilePending(join, async () => {
        try {
          const accepted = await request<{ seatToken: string }>(
            `/api/invites/${token}/accept`,
            { method: 'POST', body: {} },
          );
          await openSeat(accepted.seatToken);
        } catch (cause) {
          clear(holder);
          holder.append(
            el('p', {}, [
              cause instanceof RequestFailed ? cause.failure.message : 'This invite is not usable.',
            ]),
          );
        }
      });
    });
    return card(`Join ${invite.scoreTitle}`, [
      el('p', {}, [`${invite.name} \u00b7 ${roleWord}`]),
      holder,
    ]);
  } catch (cause) {
    return card('Join Fairline', [
      el('p', {}, [
        cause instanceof RequestFailed ? cause.failure.message : 'This invite is not usable.',
      ]),
    ]);
  }
}

async function ensureState(): Promise<ScoreState | null> {
  if (state) return state;
  const fresh = new ScoreState();
  try {
    await fresh.load();
  } catch {
    return null;
  }
  state = fresh;
  return state;
}

async function route(): Promise<void> {
  const path = window.location.pathname;
  const seat = /^\/s\/(.+)$/.exec(path);
  if (seat) {
    await openSeat(decodeURIComponent(seat[1]!));
    return;
  }
  const invite = /^\/i\/(.+)$/.exec(path);
  if (invite) {
    clear(mount);
    mount.append(await joinPage(decodeURIComponent(invite[1]!)));
    return;
  }
  const partPath = /^\/score\/([^/]+)\/parts\/([^/]+)$/.exec(path);
  const scorePath = /^\/score\/([^/]+)$/.exec(path);
  if (partPath || scorePath) {
    const loaded = await ensureState();
    if (!loaded) {
      clear(mount);
      mount.append(seatNotValid());
      return;
    }
    clear(mount);
    mount.append(
      partPath
        ? renderPartPage(loaded, decodeURIComponent(partPath[2]!), navigate)
        : renderWorkspace(loaded, navigate),
    );
    return;
  }
  clear(mount);
  mount.append(path === '/seat-not-valid' ? seatNotValid() : landing());
}

window.addEventListener('popstate', () => void route());
void route();
