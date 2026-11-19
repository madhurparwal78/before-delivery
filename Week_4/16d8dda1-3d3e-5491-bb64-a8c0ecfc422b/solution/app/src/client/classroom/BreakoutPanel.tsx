import { useId } from 'react';
import { clockText } from '../../shared/clock';
import { Empty } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { ActionButton, useClassroom } from './context';
import { breakoutSecondsLeft } from './store';

export function StartBreakoutsButton() {
  const { openDialog } = useClassroom();
  return (
    <button type="button" className="primary" onClick={() => openDialog('breakouts')}>
      <Icon name="tables" size={18} />
      Start breakouts
    </button>
  );
}

/** The breakout timer, urgent (brick) only while the server says the warning has fired. */
function BreakoutTimer() {
  const { state, snapshot, now } = useClassroom();
  const breakout = snapshot.breakout;
  if (!breakout) return null;
  return (
    <p className="breakout-clock">
      <span role="timer" aria-label="Breakout time left" className="mono breakout-timer" data-urgent={breakout.warning ? 'true' : 'false'}>
        {clockText(breakoutSecondsLeft(state, now))}
      </span>
      {breakout.warning && <span className="urgent-words">Ending soon</span>}
    </p>
  );
}

export function BreakoutPanel({ phone = false }: { phone?: boolean }) {
  const { store, snapshot, isOwner } = useClassroom();
  const titleId = useId();
  const breakout = snapshot.breakout;
  if (phone && !breakout) return null;
  const names = (learnerIds: string[]) =>
    learnerIds.map((id) => snapshot.seats.find((seat) => seat.learnerId === id)?.displayName).filter((name): name is string => Boolean(name));
  return (
    <section className={phone ? 'panel-block breakout-phone' : 'panel-block'} aria-labelledby={titleId}>
      <h2 id={titleId} className="panel-title">
        Breakout
      </h2>
      {!breakout && !(isOwner && snapshot.state === 'live') && <Empty drawing="seats">No breakout is running.</Empty>}
      {!breakout && isOwner && snapshot.state === 'live' && <StartBreakoutsButton />}
      {breakout && (
        <>
          <div className="row">
            <BreakoutTimer />
            {isOwner && (
              <ActionButton actionKey="extend" onPress={() => void store.extendBreakouts()}>
                <Icon name="plus" size={18} />
                Add 2 minutes
              </ActionButton>
            )}
          </div>
          <ul className="breakout-tables" aria-label="Breakout tables" role="list">
            {breakout.tables.map((table) => (
              <li key={table.tableId}>
                <span className="mono">{table.tableId}</span>: {names(table.learnerIds).join(', ') || 'No one'}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
