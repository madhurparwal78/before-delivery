import { VNode, render } from './jsx/jsx-runtime.js';
import { api, setToken, clearToken, Collaborator } from './api.js';
import { Workspace } from './workspace.js';
import { PartPage } from './partpage.js';
import { JoinPage } from './join.js';

type MeResponse = { collaborator: Collaborator; score: { id: string; title: string } };

interface AppState {
  route: 'landing' | 'seat-invalid' | 'join' | 'workspace' | 'part';
  me: MeResponse | null;
  scoreId: string | null;
  partId: string | null;
  inviteToken: string | null;
  inviteError: string | null;
}

const state: AppState = {
  route: 'landing',
  me: null,
  scoreId: null,
  partId: null,
  inviteToken: null,
  inviteError: null,
};

function navigate(): void {
  const path = location.pathname;
  if (path.startsWith('/s/')) {
    const token = path.slice(3);
    setToken(token);
    void api
      .me()
      .then((me) => {
        state.me = me;
        state.scoreId = me.score.id;
        if (me.collaborator.role === 'player') {
          // section players land on their own part
          void api
            .get<{ parts: { id: string; staffIds: string[] }[] }>(`/api/scores/${me.score.id}/parts`)
            .then((parts) => {
              const mine = parts.parts.find((p) => p.staffIds.every((s) => me.collaborator.staffIds.includes(s)));
              if (mine) {
                state.route = 'part';
                state.partId = mine.id;
              } else {
                state.route = 'workspace';
              }
              redraw();
            })
            .catch(() => {
              state.route = 'workspace';
              redraw();
            });
        } else {
          state.route = 'workspace';
          history.replaceState(null, '', `/score/${me.score.id}`);
          redraw();
        }
      })
      .catch(() => {
        clearToken();
        state.route = 'seat-invalid';
        redraw();
      });
    return;
  }
  if (path.startsWith('/i/')) {
    state.inviteToken = path.slice(3);
    state.route = 'join';
    redraw();
    return;
  }
  if (path.startsWith('/score/')) {
    const seg = path.split('/').filter(Boolean);
    if (seg[0] === 'score' && seg[1]) {
      if (seg[2] === 'parts' && seg[3]) {
        state.scoreId = seg[1];
        state.partId = seg[3];
        state.route = 'part';
        redraw();
        return;
      }
      state.scoreId = seg[1];
      state.route = 'workspace';
      redraw();
      return;
    }
  }
  if (path === '/') {
    state.route = 'landing';
    redraw();
    return;
  }
  state.route = 'landing';
  redraw();
}

function redraw(): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();
  const node = currentScreen();
  root.appendChild(render(node));
}

export function navigateTo(path: string): void {
  history.pushState(null, '', path);
  navigate();
}

function currentScreen(): VNode {
  switch (state.route) {
    case 'landing':
      return landingScreen();
    case 'seat-invalid':
      return seatInvalidScreen();
    case 'join':
      return JoinPage({
        token: state.inviteToken ?? '',
        onJoined: (seatToken, scoreId) => {
          setToken(seatToken);
          state.route = 'workspace';
          state.scoreId = scoreId;
          history.replaceState(null, '', `/score/${scoreId}`);
          void api.me().then((me) => {
            state.me = me;
            redraw();
          });
        },
      });
    case 'part':
      return PartPage({
        scoreId: state.scoreId!,
        partId: state.partId!,
        me: state.me,
        onNeedMe: () => api.me(),
      });
    case 'workspace':
    default:
      return Workspace({
        scoreId: state.scoreId!,
        initialMe: state.me,
        onNeedMe: () => api.me(),
        onOpenPart: (partId: string) => navigateTo(`/score/${state.scoreId}/parts/${partId}`),
        onInvalidSeat: () => {
          clearToken();
          state.route = 'seat-invalid';
          redraw();
        },
      });
  }
}

function landingScreen(): VNode {
  return {
    type: 'div',
    props: { class: 'landing-stage' },
    children: [
      {
        type: 'main',
        props: { class: 'paper-card' },
        children: [
          { type: 'h1', props: {}, children: ['Fairline'] },
          { type: 'p', props: { class: 'lede' }, children: ['Open the seat link your composer sent you.'] },
        ],
      },
    ],
  };
}

function seatInvalidScreen(): VNode {
  return {
    type: 'div',
    props: { class: 'landing-stage' },
    children: [
      {
        type: 'main',
        props: { class: 'paper-card' },
        children: [
          { type: 'h1', props: {}, children: ['Seat link not valid'] },
          {
            type: 'p',
            props: { class: 'lede' },
            children: ['This seat link is not valid. Ask the composer for a new one.'],
          },
        ],
      },
    ],
  };
}

export function App(): VNode {
  window.addEventListener('popstate', () => navigate());
  // navigate after the returned node attaches; the initial call renders landing first
  setTimeout(navigate, 0);
  return landingScreen();
}
