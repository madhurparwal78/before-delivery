import { forwardRef } from 'react';
import { GATE_LABELS, GATE_ORDER, RequestObject, SETTING_LABELS } from '../types';
import { clock } from '../format';
import { GateView, PipState, pipStates } from './boardState';

const PIP_GLYPH: Record<PipState, string> = { unchecked: '', pass: '✓', fail: '✗' };

interface Props {
  request: RequestObject;
  selected: boolean;
  hovered: boolean;
  gateView: GateView | undefined;
  message: string;
  counterRolling: boolean;
  onSelect: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  seatRef: (seatId: string, element: HTMLButtonElement | null) => void;
}

export const RequestCard = forwardRef<HTMLElement, Props>(function RequestCard(
  {
    request,
    selected,
    hovered,
    gateView,
    message,
    counterRolling,
    onSelect,
    onPointerEnter,
    onPointerLeave,
    onKeyDown,
    seatRef,
  },
  ref,
) {
  const states = pipStates(gateView);
  const classes = ['card'];
  if (selected) classes.push('selected');
  if (hovered) classes.push('hover');
  if (request.in_cancellation_window) classes.push('in-window');

  return (
    <article
      ref={ref}
      aria-label={`${request.ref} ${request.title}`}
      className={classes.join(' ')}
      tabIndex={0}
      data-request-id={request.id}
      onClick={onSelect}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
    >
      <div className="card-head">
        <span className="ref">{request.ref}</span>
        <span className="times">
          {clock(request.start)}–{clock(request.end)}
        </span>
      </div>
      <h3 className="card-title">{request.title}</h3>
      <p className="card-meta">
        {SETTING_LABELS[request.setting]} · {request.org_name} · {request.consumer.name}
      </p>
      <ul className="pips" aria-label={`Gates for ${request.ref}`}>
        {GATE_ORDER.map((gate, index) => {
          const state = states[index] ?? 'unchecked';
          const pending = gateView?.phase === 'pending';
          return (
            <li
              key={gate}
              aria-label={`${GATE_LABELS[gate]}: ${state}`}
              className={`pip ${state}${pending ? ' pending' : ''}`}
            >
              <span className="glyph" aria-hidden="true">
                {PIP_GLYPH[state]}
              </span>
              <span>{GATE_LABELS[gate]}</span>
            </li>
          );
        })}
      </ul>
      <div className="seats">
        {request.seats.map((seat) => (
          <button
            key={seat.id}
            type="button"
            ref={(element) => seatRef(seat.id, element)}
            className={`socket ${seat.status}`}
            tabIndex={-1}
            aria-label={`Seat ${seat.position} of ${request.seats_total} for ${request.ref}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
          >
            {seat.position}
          </button>
        ))}
        <span className="counter">
          <span className={`roll${counterRolling ? ' rolling' : ''}`}>
            {request.seats_claimed}/{request.seats_total}
          </span>
        </span>
      </div>
      {request.in_cancellation_window ? (
        <p className="in-window-marker">In cancellation window</p>
      ) : null}
      {message ? <p className="card-inline-reason">{message}</p> : null}
    </article>
  );
});
