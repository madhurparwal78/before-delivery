import { type KeyboardEvent, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { isSeatingState } from '../../shared/states';
import { Icon, type IconName } from '../ui/icons';
import { ChatPanel } from './ChatPanel';
import { ActionButton, useClassroom } from './context';
import { HandsPanel } from './HandsPanel';
import { PollPanel } from './PollPanel';

export type TabId = 'seats' | 'hands' | 'poll' | 'chat';
const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'seats', label: 'Seats', icon: 'seat' },
  { id: 'hands', label: 'Hands', icon: 'hand' },
  { id: 'poll', label: 'Poll', icon: 'poll' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
];

function SeatButtons() {
  const { store, state, snapshot, canRun } = useClassroom();
  const seating = isSeatingState(snapshot.state);
  return (
    <ul className="seat-buttons" aria-label="Seat choices" role="list">
      {snapshot.seats.map((seat) => (
        <li key={seat.seatId}>
          <ActionButton
            actionKey={`seat:${seat.seatId}`}
            className={seat.seatId === state.cursor ? 'seat-button is-cursor' : 'seat-button'}
            disabled={canRun || !seating}
            aria-current={seat.learnerId !== null && seat.learnerId === snapshot.you.learnerId ? 'true' : undefined}
            data-seat-button=""
            data-native-enter=""
            onPress={() => void store.takeSeat(seat.seatId)}
          >
            <span className="seat-label">
              <b className="mono">Seat {seat.seatId}</b>
              {seat.displayName && <span>, taken by {seat.displayName}</span>}
            </span>
            {seat.table && (
              <small className="mono" aria-hidden="true">
                {seat.table}
              </small>
            )}
          </ActionButton>
        </li>
      ))}
    </ul>
  );
}

function TabPanel({ id, selected, children }: { id: TabId; selected: boolean; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="tab-panel" hidden={!selected} inert={!selected}>
      {children}
    </div>
  );
}

interface PhoneTabsProps {
  tab: TabId;
  onSelect: (tab: TabId) => void;
  chatInput: RefObject<HTMLInputElement | null>;
  returnFocus: MutableRefObject<HTMLElement | null>;
}

/** The Class panels tab bar and the selected tab's panel; closed panels are hidden and inert. */
export function PhoneTabs({ tab, onSelect, chatInput, returnFocus }: PhoneTabsProps) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    const step = keys[event.key];
    if (step === undefined) return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = tabs.findIndex((element) => element === document.activeElement);
    tabs[(at + step + tabs.length) % tabs.length]?.focus();
    event.preventDefault();
  };
  return (
    <div className="phone-tabs">
      <div role="tablist" aria-label="Class panels" onKeyDown={move}>
        {TABS.map(({ id, label, icon }) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} tabIndex={tab === id ? 0 : -1} data-native-enter="" onClick={() => onSelect(id)}>
            <Icon name={icon} size={18} />
            {label}
          </button>
        ))}
      </div>
      <TabPanel id="seats" selected={tab === 'seats'}>
        <SeatButtons />
      </TabPanel>
      <TabPanel id="hands" selected={tab === 'hands'}>
        <HandsPanel />
      </TabPanel>
      <TabPanel id="poll" selected={tab === 'poll'}>
        <PollPanel />
      </TabPanel>
      <TabPanel id="chat" selected={tab === 'chat'}>
        <ChatPanel inputRef={chatInput} returnFocus={returnFocus} />
      </TabPanel>
    </div>
  );
}
