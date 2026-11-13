import { useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent } from 'react';
import type { Format, MatchView } from '../../shared/api.js';
import { isOpen, regionCurrentRound } from '../../shared/rounds.js';
import { nextFocus, type PhoneTab, type RegionModel } from '../bracketModel.js';
import { useTrace, type TraceController } from '../trace.js';
import { MatchCard } from './MatchCard.js';

const SWIPE_PX = 50;

// On a phone the bracket shows one round at a time under tablist "Rounds"; a horizontal swipe moves between rounds.
export function PhoneRounds({ tabs, regions, format, current, controller, onOpen }: {
  tabs: PhoneTab[];
  regions: RegionModel[];
  format: Format;
  current: { bracket: string; round: number } | null;
  controller: TraceController;
  onOpen: (match: MatchView) => void;
}): ReactNode {
  const initial = Math.max(0, tabs.findIndex((tab) => tab.bracket === current?.bracket && (tab.bracket === 'final' || tab.rounds[0]?.round === current?.round)));
  const [selected, setSelected] = useState(initial);
  const [focused, setFocused] = useState<string | null>(null);
  const trace = useTrace(controller);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tab = tabs[Math.min(selected, tabs.length - 1)];
  if (!tab) return null;

  const select = (index: number, focus = false): void => {
    const bounded = Math.min(Math.max(index, 0), tabs.length - 1);
    setSelected(bounded);
    if (focus) tabRefs.current[bounded]?.focus();
  };

  const tabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      select(selected + (event.key === 'ArrowRight' ? 1 : -1), true);
    }
  };

  const start = (event: TouchEvent<HTMLDivElement>): void => {
    const point = event.touches[0];
    touch.current = point ? { x: point.clientX, y: point.clientY } : null;
  };
  const end = (event: TouchEvent<HTMLDivElement>): void => {
    const from = touch.current;
    const point = event.changedTouches[0];
    touch.current = null;
    if (!from || !point) return;
    const dx = point.clientX - from.x;
    const dy = point.clientY - from.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) select(selected + (dx < 0 ? 1 : -1));
  };

  const region = regions.find((r) => r.bracket === tab.bracket) as RegionModel;
  const matches = tab.rounds.flatMap((r) => r.matches);
  const open = regionCurrentRound(matches.map((m) => ({ bracket: m.bracket, round: m.round, open: isOpen(m.state, m.upper, m.lower) })), tab.bracket);
  const defaultId = tab.rounds.find((r) => r.round === open)?.matches[0]?.id ?? matches[0]?.id ?? null;
  const tabStop = focused && matches.some((m) => m.id === focused) ? focused : defaultId;

  const cardKey = (event: KeyboardEvent<HTMLButtonElement>, match: MatchView): void => {
    const target = nextFocus({ ...region, rounds: tab.rounds }, match, event.key, format);
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (target) document.querySelector<HTMLElement>(`[data-match-id="${target.id}"]`)?.focus();
  };

  return (
    <div className="phone-rounds">
      <div role="tablist" aria-label="Rounds" className="tabs">
        {tabs.map((item, index) => (
          <button key={item.name} ref={(el) => { tabRefs.current[index] = el; }} role="tab" type="button" id={`round-tab-${index}`}
            aria-selected={index === selected} aria-controls="round-panel" tabIndex={index === selected ? 0 : -1}
            className="tab" onClick={() => select(index)} onKeyDown={tabKey}>{item.name}</button>
        ))}
      </div>
      <div role="tabpanel" id="round-panel" aria-labelledby={`round-tab-${selected}`} className="panel"
        onTouchStart={start} onTouchEnd={end}>
        {tab.rounds.map((round) => (
          <div className="panel-round" key={round.round}>
            {tab.rounds.length > 1 ? <p className="round-label">{round.label}</p> : null}
            {round.matches.map((match) => (
              <MatchCard key={match.id} match={match} tabIndex={match.id === tabStop ? 0 : -1} shutter={trace.shutters.get(match.id)}
                willReset={trace.willReset.has(match.id)} onOpen={onOpen} onKeyNav={cardKey} onFocused={(m) => setFocused(m.id)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
