import { memo, type KeyboardEvent, type ReactNode } from 'react';
import type { MatchView } from '../../shared/api.js';
import { isDecided } from '../../shared/rules.js';
import { STATUS_WORDS, cardName, slotName, winnerName } from '../bracketModel.js';
import { countdownText, useSecondTick } from '../clock.js';
import type { Shutter } from '../trace.js';

function Countdown({ autoConfirmAt }: { autoConfirmAt: string }): ReactNode {
  useSecondTick();
  return <span className="card-countdown" aria-hidden="true">{countdownText(autoConfirmAt)}</span>;
}

function Flag(): ReactNode {
  return (
    <svg className="card-flag" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4 2v16" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M4 3h11l-3 4 3 4H4z" fill="currentColor" />
    </svg>
  );
}

function Rows({ match }: { match: MatchView }): ReactNode {
  const decided = isDecided(match.state);
  const shown = decided ? [match.upper_games, match.lower_games]
    : match.state === 'reported' && match.report ? [match.report.upper_games, match.report.lower_games] : [null, null];
  const winner = winnerName(match);
  const row = (side: 'upper' | 'lower', index: number): ReactNode => {
    const name = slotName(match[side]);
    const placeholder = match[side] === null || name === 'bye';
    return (
      <span className="card-row" key={side} aria-hidden="true">
        <span className={`card-name ${placeholder ? 'card-name-quiet' : ''} ${decided && name === winner ? 'card-name-win' : ''}`}>{name}</span>
        <span className="card-score">{shown[index] ?? ''}</span>
      </span>
    );
  };
  return <>{row('upper', 0)}{row('lower', 1)}</>;
}

export const MatchCard = memo(function MatchCard({ match, tabIndex, shutter, willReset, onOpen, onKeyNav, onFocused }: {
  match: MatchView;
  tabIndex: number;
  shutter?: Shutter;
  willReset: boolean;
  onOpen: (match: MatchView) => void;
  onKeyNav: (event: KeyboardEvent<HTMLButtonElement>, match: MatchView) => void;
  onFocused: (match: MatchView) => void;
}): ReactNode {
  const quiet = match.state === 'bye' || match.state === 'not_needed' || match.state === 'waiting';
  return (
    <button
      type="button"
      className={`card card-${match.state}`}
      aria-label={cardName(match)}
      tabIndex={tabIndex}
      data-match-id={match.id}
      data-round={match.round}
      data-match={match.number}
      data-bracket={match.bracket}
      data-state={match.state}
      data-shutter={shutter}
      data-will-reset={willReset ? '' : undefined}
      onClick={() => onOpen(match)}
      onKeyDown={(event) => onKeyNav(event, match)}
      onFocus={() => onFocused(match)}
    >
      <span className="card-head" aria-hidden="true">
        <span className="card-status">{match.state === 'disputed' ? <Flag /> : null}{STATUS_WORDS[match.state]}</span>
        {match.overdue === true ? <span className="card-overdue">Overdue</span> : null}
        {willReset ? <span className="card-willreset">Will reset</span> : null}
      </span>
      {quiet ? (match.state === 'bye' ? <Rows match={match} /> : null) : <Rows match={match} />}
      {match.state === 'reported' && match.report ? <Countdown autoConfirmAt={match.report.auto_confirm_at} /> : null}
      <span className="slats" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</span>
    </button>
  );
});
