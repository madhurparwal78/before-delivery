import type { JSX } from 'preact';
import { useId, useState } from 'preact/hooks';
import { copy } from '../../shared/copy.js';
import { MAX_RUNS, MAX_RUN_OUT_RUNS, WICKET_KINDS, enteredRuns, needsFielder, runsPart, wicketAllowed } from '../../shared/rules.js';
import type { BatterOut, DeliveryItem, Extra, MatchState, PlayerRef, WicketBody, WicketKind } from '../../shared/wire.js';
import { actionOf } from '../lib/keys.js';
import { Modal } from './Modal.js';
import { EXTRA_LABELS } from './Pad.js';
import { Field } from './ui.js';

const KIND_LABELS: Record<WicketKind, string> = {
  bowled: 'Bowled', caught: 'Caught', lbw: 'LBW', stumped: 'Stumped', 'hit-wicket': 'Hit wicket', 'run-out': 'Run out',
};

/** Sends a dialog's choice; resolves to the refusal sentence, or null when it was accepted. */
type Submit<T> = (choice: T) => Promise<string | null>;

const Failure = ({ message }: { message: string | null }): JSX.Element | null =>
  message ? <p class="band band-field">{message}</p> : null;

const Radio = ({ name, value, label, checked, disabled, onSelect }: {
  name: string; value: string; label: string; checked: boolean; disabled?: boolean; onSelect: () => void;
}): JSX.Element => (
  <label class="radio">
    <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onSelect} />
    {label}
  </label>
);

const Group = ({ label, children }: { label: string; children: JSX.Element[] }): JSX.Element => {
  const id = useId();
  return (
    <div class="group-field">
      <span class="group-label" id={id}>{label}</span>
      <div role="radiogroup" aria-labelledby={id} class="radios">{children}</div>
    </div>
  );
};

interface WicketDialogProps {
  state: MatchState;
  fielding: PlayerRef[];
  armed: Extra | null;
  onSubmit: Submit<{ extra: Extra; runs: number; wicket: WicketBody }>;
  onClose: () => void;
}

export const WicketDialog = ({ state, fielding, armed, onSubmit, onClose }: WicketDialogProps): JSX.Element => {
  const extra: Extra = armed ?? 'none';
  const [kind, setKind] = useState<WicketKind | null>(null);
  const [fielder, setFielder] = useState('');
  const [out, setOut] = useState<BatterOut>('striker');
  const [completed, setCompleted] = useState(0);
  const [newBatter, setNewBatter] = useState(state.yet_to_bat[0]?.player ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fielderRequired = kind !== null && needsFielder(kind);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (kind === null) return;
    setBusy(true);
    const message = await onSubmit({
      extra, runs: kind === 'run-out' ? completed : 0,
      wicket: { kind, fielder: fielderRequired ? fielder : null, batter_out: kind === 'run-out' ? out : 'striker', new_batter: state.yet_to_bat.length > 0 ? newBatter : null },
    });
    setFailure(message);
    setBusy(false);
  };

  return (
    <Modal title="Wicket" onClose={onClose} initialFocus="input[type=radio]:not(:disabled)">
      <form onSubmit={submit} class="dialog-form">
        {state.free_hit ? <p class="free-hit-copy">{copy.freeHitWicket}</p> : null}
        <Group label="How out">
          {WICKET_KINDS.map((candidate) => (
            <Radio key={candidate} name="how-out" value={candidate} label={KIND_LABELS[candidate]} checked={kind === candidate}
              disabled={!wicketAllowed(candidate, extra, state.free_hit)} onSelect={() => setKind(candidate)} />
          ))}
        </Group>
        {fielderRequired ? (
          <Field label="Fielder">
            {(props) => (
              <select {...props} value={fielder} onChange={(e) => setFielder(e.currentTarget.value)}>
                <option value="">Choose a fielder</option>
                {fielding.map((player) => <option key={player.id} value={player.id}>{player.short_name}</option>)}
              </select>
            )}
          </Field>
        ) : null}
        {kind === 'run-out' ? (
          <>
            <Group label="Batter out">
              {state.batters.map((batter) => (
                <Radio key={batter.player} name="batter-out" value={batter.player} label={batter.short_name} checked={out === (batter.on_strike ? 'striker' : 'non-striker')}
                  onSelect={() => setOut(batter.on_strike ? 'striker' : 'non-striker')} />
              ))}
            </Group>
            <Field label="Runs completed">
              {(props) => (
                <select {...props} value={completed} onChange={(e) => setCompleted(Number(e.currentTarget.value))}>
                  {Array.from({ length: MAX_RUN_OUT_RUNS + 1 }, (_, runs) => <option key={runs} value={runs}>{runs}</option>)}
                </select>
              )}
            </Field>
          </>
        ) : null}
        {state.yet_to_bat.length > 0 ? (
          <Field label="New batter">
            {(props) => (
              <select {...props} value={newBatter} onChange={(e) => setNewBatter(e.currentTarget.value)}>
                {state.yet_to_bat.map((player) => (
                  <option key={player.player} value={player.player}>{player.retired_hurt ? `${player.short_name} (retired hurt)` : player.short_name}</option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <Failure message={failure} />
        <div class="dialog-actions">
          <button type="submit" class="button button-primary" disabled={busy || kind === null || (fielderRequired && fielder === '')}>Record wicket</button>
          <button type="button" class="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
};

export const NextBowlerDialog = ({ state, fielding, onSubmit, onClose }: {
  state: MatchState; fielding: PlayerRef[]; onSubmit: Submit<string>; onClose: () => void;
}): JSX.Element => {
  const reasonOf = (id: string): string => state.barred_bowlers.find((barred) => barred.player === id)?.reason ?? 'none';
  const [bowler, setBowler] = useState((fielding.find((player) => reasonOf(player.id) === 'none') ?? fielding[0])?.id ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Next bowler" onClose={onClose} initialFocus="select">
      <form
        class="dialog-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setFailure(await onSubmit(bowler));
          setBusy(false);
        }}
      >
        <Field label="Bowler" error={failure ?? undefined}>
          {(props) => (
            <select {...props} value={bowler} onChange={(e) => setBowler(e.currentTarget.value)}>
              {fielding.map((player) => <option key={player.id} value={player.id} data-barred={reasonOf(player.id)}>{player.short_name}</option>)}
            </select>
          )}
        </Field>
        <div class="dialog-actions">
          <button type="submit" class="button button-primary" disabled={busy}>Start over</button>
          <button type="button" class="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
};

export const RetireDialog = ({ state, onSubmit, onClose }: {
  state: MatchState; onSubmit: Submit<{ batter: string; new_batter: string }>; onClose: () => void;
}): JSX.Element => {
  const [batter, setBatter] = useState('');
  const [newBatter, setNewBatter] = useState(state.yet_to_bat[0]?.player ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Retire batter" onClose={onClose} initialFocus="input[type=radio]">
      <form
        class="dialog-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setFailure(await onSubmit({ batter, new_batter: newBatter }));
          setBusy(false);
        }}
      >
        <Group label="Batter">
          {state.batters.map((candidate) => (
            <Radio key={candidate.player} name="retiring" value={candidate.player} label={candidate.text} checked={batter === candidate.player} onSelect={() => setBatter(candidate.player)} />
          ))}
        </Group>
        {state.yet_to_bat.length > 0 ? (
          <Field label="New batter">
            {(props) => (
              <select {...props} value={newBatter} onChange={(e) => setNewBatter(e.currentTarget.value)}>
                {state.yet_to_bat.map((player) => (
                  <option key={player.player} value={player.player}>{player.retired_hurt ? `${player.short_name} (retired hurt)` : player.short_name}</option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <Failure message={failure} />
        <div class="dialog-actions">
          <button type="submit" class="button button-primary" disabled={busy || batter === ''}>Retire</button>
          <button type="button" class="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
};

export const StartInningsDialog = ({ batting, fielding, state, onSubmit, onClose }: {
  batting: PlayerRef[]; fielding: PlayerRef[]; state: MatchState;
  onSubmit: Submit<{ striker: string; non_striker: string; bowler: string }>; onClose: () => void;
}): JSX.Element => {
  const barred = (id: string): boolean => state.barred_bowlers.some((entry) => entry.player === id);
  const [striker, setStriker] = useState(batting[0]?.id ?? '');
  const [nonStriker, setNonStriker] = useState(batting[1]?.id ?? '');
  const [bowler, setBowler] = useState((fielding.find((player) => !barred(player.id)) ?? fielding[0])?.id ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = (players: PlayerRef[], value: string, set: (value: string) => void, label: string, error?: string): JSX.Element => (
    <Field label={label} error={error}>
      {(props) => (
        <select {...props} value={value} onChange={(e) => set(e.currentTarget.value)}>
          {players.map((player) => <option key={player.id} value={player.id}>{player.short_name}</option>)}
        </select>
      )}
    </Field>
  );
  return (
    <Modal title="Start innings" onClose={onClose} initialFocus="select">
      <form
        class="dialog-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setFailure(await onSubmit({ striker, non_striker: nonStriker, bowler }));
          setBusy(false);
        }}
      >
        {pick(batting, striker, setStriker, 'Striker')}
        {pick(batting, nonStriker, setNonStriker, 'Non-striker')}
        {pick(fielding, bowler, setBowler, 'Bowler', failure ?? undefined)}
        <div class="dialog-actions">
          <button type="submit" class="button button-primary" disabled={busy}>Start innings</button>
          <button type="button" class="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
};

export const ChangeDialog = ({ item, onSubmit, onClose }: {
  item: DeliveryItem; onSubmit: Submit<{ extra: Extra; runs: number }>; onClose: () => void;
}): JSX.Element => {
  const [extra, setExtra] = useState<Extra>(item.extra);
  const [runs, setRuns] = useState(enteredRuns(item));
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pickExtra = (chosen: Exclude<Extra, 'none'>): void => setExtra(extra === chosen ? 'none' : chosen);
  return (
    <Modal title={`Change delivery ${item.seq}`} onClose={onClose} initialFocus={`[data-run="${enteredRuns(item)}"]`}>
      <form
        class="dialog-form"
        onKeyDown={(event) => {
          const action = actionOf(event);
          if (action?.type === 'digit') { event.preventDefault(); setRuns(action.value); }
          if (action?.type === 'extra') { event.preventDefault(); pickExtra(action.extra); }
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          const message = await onSubmit({ extra, runs });
          setFailure(message);
          setBusy(false);
        }}
      >
        <div role="group" aria-label="Change pad" class="pad change-pad">
          {Array.from({ length: MAX_RUNS + 1 }, (_, value) => (
            <button type="button" key={value} class="key" data-run={value} aria-pressed={runs === value} onClick={() => setRuns(value)}>{value}</button>
          ))}
          {EXTRA_LABELS.map(({ extra: candidate, label, hint }) => (
            <button type="button" key={candidate} class="key key-extra" aria-pressed={extra === candidate} onClick={() => pickExtra(candidate)}>
              {label}<span class="hint" aria-hidden="true">{hint}</span>
            </button>
          ))}
        </div>
        <p id="change-preview" class="preview">{`New: ${runsPart(extra, runs)}`}</p>
        <Failure message={failure} />
        <div class="dialog-actions">
          <button type="submit" class="button button-primary" disabled={busy}>Save change</button>
          <button type="button" class="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
};
