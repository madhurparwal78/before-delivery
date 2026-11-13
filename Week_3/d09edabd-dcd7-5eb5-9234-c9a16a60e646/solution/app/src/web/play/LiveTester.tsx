import { useCallback, useState } from 'react';
import type { Marker } from '../three/roomView';
import type { PlayView } from '../../shared/types';
import { HelpSheet } from './HelpSheet';
import { HintsSheet } from './HintsSheet';
import { PlayStage } from './PlayStage';
import { PuzzlesSheet } from './PuzzlesSheet';
import { SessionPill } from './SessionPill';
import { TransportBar, type SheetName } from './TransportBar';
import { WaitingCard } from './WaitingCard';
import { useJoin } from './useJoin';
import { useUnits } from './useUnits';
import type { SolveResult } from './usePlaytest';

interface Props {
  token: string;
  view: PlayView;
  receivedAt: number;
  markers: Marker[];
  announce: (message: string) => void;
  onJoined: (view: PlayView) => void;
  onSolved: (result: SolveResult) => void;
  onExpire: () => void;
}

interface OpenSheet {
  name: SheetName;
  /** The puzzle the tester walked up to, when the sheet opened because of it. */
  nodeId: string | null;
}

/** The tester's page while their session is scheduled, in the lobby or running: the stage, the pill, the bar and the sheets. */
export function LiveTester({ token, view, receivedAt, markers, announce, onJoined, onSolved, onExpire }: Props) {
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [units, toggleUnits] = useUnits();
  const join = useJoin(token, onJoined);
  const joined = view.me.joined;
  const close = useCallback(() => setSheet(null), []);
  const approach = useCallback((nodeId: string) => setSheet({ name: 'puzzles', nodeId }), []);

  return (
    <>
      <PlayStage token={token} room={view.room} nodes={view.nodes} markers={markers} walking={view.session.state === 'running' && joined && sheet === null} onApproach={approach} />
      <SessionPill roomName={view.room.name} session={view.session} receivedAt={receivedAt} onExpire={onExpire} />
      <WaitingCard session={view.session} joined={joined} join={join} />
      <TransportBar joined={joined} joining={join.pending} units={units} onToggleUnits={toggleUnits} onOpen={(name) => setSheet({ name, nodeId: null })} />
      <PuzzlesSheet
        open={sheet?.name === 'puzzles'}
        onClose={close}
        token={token}
        nodes={view.nodes}
        placements={view.room.placements}
        units={units}
        focusNodeId={sheet?.nodeId ?? null}
        onSolved={onSolved}
        announce={announce}
      />
      <HintsSheet open={sheet?.name === 'hints'} onClose={close} hints={view.hints} />
      <HelpSheet open={sheet?.name === 'help'} onClose={close} room={view.room} units={units} />
    </>
  );
}
