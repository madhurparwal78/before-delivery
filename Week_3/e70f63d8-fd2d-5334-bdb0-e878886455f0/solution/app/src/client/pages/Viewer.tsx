import type { JSX } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import { copy } from '../../shared/copy.js';
import type { MatchState, ServerMessage } from '../../shared/wire.js';
import { Bands, Commentary, MatchLines, Scoreboard, ThisOver } from '../components/Board.js';
import { Loading, PageHeading } from '../components/ui.js';
import { announce, deliveryAnnouncement } from '../lib/announce.js';
import { get } from '../lib/api.js';
import { loadConfig } from '../lib/config.js';
import { Link } from '../lib/router.js';
import { openSocket } from '../lib/socket.js';
import { NotFound } from './NotFound.js';

type StateMessage = Extract<ServerMessage, { type: 'state' }>;

/** What a viewer's page says when it shows a state it received live: the notice and the announcement. */
const wording = (message: StateMessage): { notice: string | null; announcement: string | null } => {
  const { kind, seq } = message.event;
  if (kind === 'change') return { notice: copy.viewerChange(seq), announcement: copy.viewerChange(seq) };
  if (kind === 'undo') return { notice: copy.viewerUndo(seq), announcement: copy.viewerUndo(seq) };
  if (kind === 'delivery' || kind === 'retirement') return { notice: null, announcement: deliveryAnnouncement(message.state) };
  return { notice: null, announcement: null };
};

export const ViewerPage = ({ code }: { code: string }): JSX.Element => {
  const [state, setState] = useState<MatchState | null>(null);
  const [notice, setNotice] = useState('');
  const [liveStatus, setLiveStatus] = useState('');
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    let current = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const first = (delay: number) => (message: ServerMessage): void => {
      if (message.type === 'state') {
        timers.push(setTimeout(() => {
          if (!current) return;
          const { notice: changed, announcement } = wording(message);
          setState(message.state);
          if (changed !== null) setNotice(changed);
          if (announcement !== null) announce(announcement);
        }, delay));
      } else if (message.type === 'link-off') {
        setLiveStatus(copy.linkOff);
      } else if (message.type === 'live') {
        setLiveStatus(copy.liveOutageViewer);
      }
    };
    let socket: ReturnType<typeof openSocket> | null = null;
    loadConfig().then((config) => {
      if (!current) return;
      socket = openSocket((send) => {
        send({ type: 'watch', code });
        get<MatchState>(`/api/live/${code}/state`).then((loaded) => { if (current) setState(loaded); }, () => { if (current) setFailed(true); });
      }, first(config.live_delay_ms));
    }, () => setFailed(true));
    return () => {
      current = false;
      for (const timer of timers) clearTimeout(timer);
      socket?.close();
    };
  }, [code]);

  if (failed) return <NotFound />;
  if (!state) return <Loading />;
  return (
    <div class="live">
      <PageHeading>{state.match.title}</PageHeading>
      <div class="panels">
        <Scoreboard state={state} />
        <MatchLines state={state} />
        <ThisOver state={state} />
        <p id="notice" class="notice">{notice}</p>
        <div id="live-status" class="live-status" role="status">{liveStatus}</div>
        <Bands state={state} />
        <Commentary items={state.commentary} />
      </div>
      <p class="scorecard-link"><Link href={`/live/${code}/scorecard`}>Scorecard</Link></p>
    </div>
  );
};
