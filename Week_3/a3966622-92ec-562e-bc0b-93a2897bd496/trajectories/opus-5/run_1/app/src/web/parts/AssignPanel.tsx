import { useEffect, useState } from 'react';
import { NoReply, send } from '../api.ts';
import { NO_REPLY } from '../format.ts';
import { useKeyedControl } from '../hooks.ts';
import type { Eligibility, Move, TurnEntry } from '../types.ts';
import { Panel } from './Panel.tsx';

const REST_REASONS = ['rest', 'night_rest', 'rota_days'];

function verdictText(entry: TurnEntry): string {
  if (entry.eligible) return 'eligible';
  return entry.reasons.join(', ');
}

export function AssignPanel({
  move,
  open,
  onClose,
  onAssigned,
  announce,
}: {
  move: Move;
  open: boolean;
  onClose: () => void;
  onAssigned: (move: Move) => void;
  announce: (text: string) => void;
}): JSX.Element {
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const control = useKeyedControl();

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const reply = await send<Eligibility>(
        'GET',
        `/api/moves/${encodeURIComponent(move.ref)}/eligibility`,
      ).catch(() => null);
      if (reply !== null && reply.ok) setEligibility(reply.data);
    })();
  }, [open, move.ref]);

  const entries = eligibility?.turn ?? [];
  const selected = entries.find((entry) => entry.pilot_id === chosen);
  const breachesRest =
    selected !== undefined && selected.reasons.some((code) => REST_REASONS.includes(code));

  const refreshTurn = (turn: TurnEntry[] | undefined): void => {
    if (turn !== undefined) setEligibility({ ...(eligibility as Eligibility), turn });
    else {
      void (async () => {
        const reply = await send<Eligibility>(
          'GET',
          `/api/moves/${encodeURIComponent(move.ref)}/eligibility`,
        ).catch(() => null);
        if (reply !== null && reply.ok) setEligibility(reply.data);
      })();
    }
  };

  const assign = (): void => {
    if (chosen === null || control.pending) return;
    const body: Record<string, unknown> = { pilot_id: chosen };
    if (note !== '') body.note = note;
    if (breachesRest && reason !== '') body.rest_override_reason = reason;
    const key = control.keyFor(JSON.stringify([move.ref, body]));
    control.setPending(true);
    announce('Assigning pilot...');
    void (async () => {
      try {
        const reply = await send<Move>(
          'POST',
          `/api/moves/${encodeURIComponent(move.ref)}/assignment`,
          { body, ifMatch: move.version, key },
        );
        control.replyReceived();
        if (reply.ok) {
          announce(`Pilot ${reply.data.pilot?.name ?? ''} assigned to ${reply.data.ref}`);
          onAssigned(reply.data);
          onClose();
          return;
        }
        const name = selected?.name ?? '';
        const error = reply.error;
        if (error.error === 'stale_version' || error.error === 'illegal_transition') {
          announce('Another dispatcher changed this move. Fresh data shown.');
          if (error.current !== undefined) onAssigned(error.current);
          refreshTurn(error.turn);
        } else if (error.error === 'licence_not_covering') {
          announce(`Pilot ${name} is not licensed for this vessel. Fresh turn list shown.`);
          refreshTurn(error.turn);
        } else if (error.error === 'not_next_in_turn') {
          announce(`Pilot ${name} is not next eligible. Fresh turn list shown.`);
          refreshTurn(error.turn);
        } else if (error.error === 'rest_breach') {
          announce('Rest rules not met. Type an immediate-safety reason to override.');
          refreshTurn(error.turn);
        } else if (error.errors?.rest_override_reason !== undefined) {
          announce(
            'Override reason not accepted. Type 10 to 500 characters for a pilot breaching rest.',
          );
        } else {
          announce(error.message);
        }
      } catch (cause) {
        if (cause instanceof NoReply) announce(NO_REPLY);
      } finally {
        control.setPending(false);
      }
    })();
  };

  return (
    <Panel open={open} label="Assign pilot" kind="dialog" onClose={onClose}>
      <h3>{`Assign pilot to ${move.ref}`}</h3>
      <div role="radiogroup" aria-label="Pilot" className="rows">
        {entries.map((entry) => (
          <label key={entry.pilot_id} className="row touch-row choice">
            <input
              type="radio"
              name="pilot"
              aria-label={`${entry.name} ${verdictText(entry)}`}
              checked={chosen === entry.pilot_id}
              onChange={() => setChosen(entry.pilot_id)}
            />
            <span>{`${entry.position}. ${entry.name} ${entry.licence_class}`}</span>
            <span className={entry.eligible ? 'dim' : 'negative'}>{verdictText(entry)}</span>
          </label>
        ))}
      </div>
      <label>
        Dispatcher note
        <textarea
          aria-label="Dispatcher note"
          value={note}
          rows={2}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {breachesRest && (
        <label>
          Rest override reason
          <textarea
            aria-label="Rest override reason"
            value={reason}
            rows={2}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      )}
      <div className="keel-controls">
        <button type="button" className="primary" onClick={assign}>
          Assign
        </button>
        <button type="button" onClick={onClose}>
          Close assignment
        </button>
      </div>
    </Panel>
  );
}
