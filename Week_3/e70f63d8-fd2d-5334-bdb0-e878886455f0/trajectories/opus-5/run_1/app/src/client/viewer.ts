import { MSG } from '../shared/messages.js';
import type { MatchState } from '../shared/types.js';
import { announce, bootstrap, must, openSocket } from './dom.js';
import { StateView, announcementFor } from './stateview.js';

interface ViewerBoot {
  code: string;
  state: MatchState;
  config: { live_delay_ms: number; tick_ms: number; tick_stagger_ms: number };
}

export function startViewer(): void {
  const boot = bootstrap<ViewerBoot>();
  let state = boot.state;
  const notice = must('#notice');
  const liveStatus = must('#live-status');

  const view = new StateView({
    scoring: false,
    tick: boot.config,
    logoFor: (teamId) =>
      state.match.home.id === teamId ? state.match.home.logo_url : state.match.away.logo_url,
  });
  view.show(state, {});

  const show = (next: MatchState, event: { kind: string; seq: number }): void => {
    state = next;
    if (event.kind === 'change' || event.kind === 'undo') {
      const text = event.kind === 'change' ? MSG.viewerChanged(event.seq) : MSG.viewerUndid(event.seq);
      notice.textContent = text;
      view.show(next, { direction: 'down', announce: text });
      return;
    }
    view.show(next, { direction: 'up', announce: announcementFor(next) });
  };

  const connect = (): void => {
    const socket = openSocket(
      (message) => {
        const payload = message as {
          type: string;
          state?: MatchState;
          event?: { kind: string; seq: number };
          status?: string;
        };
        if (payload.type === 'state' && payload.state) {
          const next = payload.state;
          const event = payload.event ?? { kind: 'delivery', seq: 0 };
          setTimeout(() => show(next, event), boot.config.live_delay_ms);
          return;
        }
        if (payload.type === 'link-off') {
          liveStatus.textContent = MSG.viewerLinkOff;
          announce(MSG.viewerLinkOff);
          return;
        }
        if (payload.type === 'live' && payload.status === 'paused') {
          liveStatus.textContent = MSG.liveOutageViewer;
        }
      },
      (open) => {
        open.send(JSON.stringify({ type: 'watch', code: boot.code }));
      },
    );
    socket.addEventListener('close', () => {
      setTimeout(connect, 1000);
    });
  };

  connect();
}
