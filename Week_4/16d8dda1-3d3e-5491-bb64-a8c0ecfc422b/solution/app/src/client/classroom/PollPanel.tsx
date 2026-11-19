import { useId } from 'react';
import { isLiveState } from '../../shared/states';
import { Empty } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { ActionButton, useClassroom } from './context';

export function PollPanel() {
  const { store, snapshot, canRun, openDialog } = useClassroom();
  const titleId = useId();
  const poll = snapshot.poll;
  const open = poll?.state === 'open';
  const teaching = isLiveState(snapshot.state);
  return (
    <section className="panel-block" aria-labelledby={titleId}>
      <h2 id={titleId} className="panel-title">
        Poll
      </h2>
      {!poll && <Empty drawing="quill">No poll is open.</Empty>}
      {poll && (
        <div role="group" aria-label="Poll" className="poll">
          <p className="poll-question">{poll.question}</p>
          {open && !canRun && (
            <div className="poll-options">
              {poll.options.map((option, index) => (
                <ActionButton
                  key={option}
                  actionKey={`answer:${index + 1}`}
                  aria-pressed={poll.yourAnswer === index + 1}
                  onPress={() => void store.answerPoll(index + 1)}
                >
                  <span className="mono key-hint" aria-hidden="true">
                    {index + 1}
                  </span>
                  {option}
                </ActionButton>
              ))}
            </div>
          )}
          {open && canRun && poll.counts && (
            <ul className="poll-counts" aria-label="Poll counts" role="list">
              {poll.options.map((option, index) => (
                <li key={option}>
                  {option}: <span className="mono">{poll.counts?.[index] ?? 0}</span>
                </li>
              ))}
            </ul>
          )}
          {poll.state === 'closed' && poll.results && (
            <ul className="poll-results" aria-label="Poll results" role="list">
              {poll.results.map((result) => (
                <li key={result.option}>
                  {result.option} <span className="mono">{result.percent}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {canRun && open && (
        <ActionButton actionKey="poll-close" onPress={() => void store.closePoll()}>
          Close poll
        </ActionButton>
      )}
      {canRun && !open && (
        <button type="button" className="primary" disabled={!teaching} onClick={() => openDialog('poll')}>
          <Icon name="poll" size={18} />
          New poll
        </button>
      )}
    </section>
  );
}
