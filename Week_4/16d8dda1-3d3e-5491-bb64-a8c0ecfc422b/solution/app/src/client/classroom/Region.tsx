import { useCallback, useState } from 'react';
import { Alert } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { useClassroom } from './context';
import { Fallback } from './Fallback';
import { RoomCanvas } from './RoomCanvas';
import { breakoutSecondsLeft } from './store';

function Board() {
  const { snapshot } = useClassroom();
  const { slide, breakout } = snapshot;
  return (
    <div className="board" data-modal-inert="" data-board="" data-slide={slide.current} data-slide-total={slide.total} data-dimmed={breakout ? 'true' : 'false'}>
      <span className="mono board-text">
        Slide {slide.current} of {slide.total}
      </span>
      {slide.fileId && <img className="board-image" src={`/api/files/${slide.fileId}`} alt={`Slide ${slide.current}`} />}
    </div>
  );
}

function Announcements() {
  const { state } = useClassroom();
  const { announcements } = state;
  return (
    <div className="announcements" role="status" aria-label="Class announcements" aria-live="polite">
      {announcements.map((announcement, index) => (
        <p key={announcement.id} className={index === announcements.length - 1 ? undefined : 'visually-hidden'}>
          {announcement.text}
        </p>
      ))}
    </div>
  );
}

/** The seats, tables and model as plain DOM: it changes when the server's message arrives, never on a frame. */
function Mirror() {
  const { state, snapshot, now } = useClassroom();
  const left = snapshot.breakout ? String(breakoutSecondsLeft(state, now)) : '';
  return (
    <div className="mirror" data-modal-inert="">
      <ul className="seat-key" aria-label="Seats" role="list">
        {snapshot.seats.map((seat) => (
          <li
            key={seat.seatId}
            data-seat-id={seat.seatId}
            data-table={seat.table ?? ''}
            data-row={seat.row}
            data-column={seat.column}
            data-occupant={seat.learnerId ?? ''}
            data-occupant-name={seat.displayName ?? ''}
            data-hand={seat.hand}
            data-spotlit={String(seat.learnerId !== null && seat.learnerId === snapshot.spotlight)}
            data-selected={String(seat.seatId === state.cursor)}
            data-breakout-table={seat.breakoutTable ?? ''}
          >
            <span className="mono seat-id">{seat.seatId}</span>
            {seat.displayName && <span className="seat-name">{seat.displayName}</span>}
            {seat.hand === 'raised' && <Icon name="hand" size={14} />}
          </li>
        ))}
      </ul>
      <ul className="table-key" aria-label="Tables" role="list">
        {snapshot.tables.map((table) => (
          <li key={table.tableId} data-table-id={table.tableId} data-row={table.row} data-column={table.column} data-breakout-remaining={left}>
            <span className="mono">{table.tableId}</span>
          </li>
        ))}
      </ul>
      <div className="visually-hidden" data-model="" data-model-id={snapshot.modelFileId ?? ''}>
        {snapshot.modelFileId ? 'A model is on show.' : 'No model is on show.'}
      </div>
    </div>
  );
}

export function ClassroomRegion() {
  const { state, snapshot, now, reduced, mode } = useClassroom();
  const [webgl, setWebgl] = useState<'on' | 'off'>('on');
  const unavailable = useCallback(() => setWebgl('off'), []);
  const returning = !reduced && now < state.returningUntil;
  return (
    <section className={`room room-${mode}`} aria-label="Classroom" data-motion={reduced ? 'reduced' : 'animated'} data-webgl={webgl} data-returning={returning ? 'true' : 'false'}>
      <Board />
      <div className="stage" data-modal-inert="">
        {!snapshot.live && (
          <div className="stage-banner">
            <Alert>Live updates are paused. Your class will resume on its own.</Alert>
          </div>
        )}
        {webgl === 'on' ? <RoomCanvas onUnavailable={unavailable} /> : <Fallback />}
      </div>
      <Announcements />
      <Mirror />
    </section>
  );
}
