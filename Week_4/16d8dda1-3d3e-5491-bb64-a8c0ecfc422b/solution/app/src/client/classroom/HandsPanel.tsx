import { useId } from 'react';
import { isLiveState } from '../../shared/states';
import { Empty } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { ActionButton, useClassroom } from './context';

export function HandsPanel() {
  const { store, snapshot, canRun } = useClassroom();
  const titleId = useId();
  const teaching = isLiveState(snapshot.state);
  const raised = snapshot.hands.some((hand) => hand.learnerId === snapshot.you.learnerId);
  const seated = snapshot.seats.filter((seat) => seat.learnerId !== null && seat.displayName !== null);
  return (
    <section className="panel-block" aria-labelledby={titleId}>
      <h2 id={titleId} className="panel-title">
        Hands
      </h2>
      {snapshot.hands.length === 0 && <Empty drawing="tray">No hands raised.</Empty>}
      <ol className="hand-queue" aria-label="Raised hands" role="list">
        {snapshot.hands.map((hand, index) => (
          <li key={hand.learnerId}>
            <span className="mono hand-order">{index + 1}</span>
            <span>{hand.displayName}</span>
          </li>
        ))}
      </ol>
      {!canRun && (
        <ActionButton actionKey="hand" className={raised ? '' : 'primary'} disabled={!teaching} onPress={() => void store.toggleHand()}>
          <Icon name="hand" size={18} />
          {raised ? 'Lower hand' : 'Raise hand'}
        </ActionButton>
      )}
      {canRun && (
        <>
          <ActionButton actionKey="hands-next" className="primary" disabled={!teaching} onPress={() => void store.takeNextHand()}>
            Take next hand
          </ActionButton>
          <h3 className="panel-subtitle">Learners in seats</h3>
          <ul className="spotlight-list" aria-label="Learners in seats" role="list">
            {seated.map((seat) => (
              <li key={seat.seatId}>
                <ActionButton
                  actionKey="spotlight"
                  aria-pressed={snapshot.spotlight === seat.learnerId}
                  disabled={!teaching}
                  onPress={() => void store.spotlight(snapshot.spotlight === seat.learnerId ? null : seat.learnerId)}
                >
                  <span className="mono seat-tag" aria-hidden="true">
                    {seat.seatId}
                  </span>
                  Spotlight {seat.displayName}
                </ActionButton>
              </li>
            ))}
          </ul>
          <ActionButton actionKey="spotlight" disabled={!teaching || snapshot.spotlight === null} onPress={() => void store.spotlight(null)}>
            Clear spotlight
          </ActionButton>
        </>
      )}
    </section>
  );
}
