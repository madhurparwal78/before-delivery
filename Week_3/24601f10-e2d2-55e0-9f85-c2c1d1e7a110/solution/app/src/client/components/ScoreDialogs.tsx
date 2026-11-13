import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { MatchView, ReportResult, MatchResult } from '../../shared/api.js';
import { isDecided } from '../../shared/rules.js';
import { api, failureOf } from '../api.js';
import { STATUS_WORDS, slotName } from '../bracketModel.js';
import { countdownText, useSecondTick } from '../clock.js';
import type { TournamentStore } from '../liveStore.js';
import { Dialog } from './Dialog.js';

export interface Viewer {
  organizer: boolean;
  entrantId: string | null;
  entrantName: string | null;
}

export interface DialogEnv {
  store: TournamentStore;
  viewer: Viewer;
  say: (text: string) => void;
  // Every dialog closes and focus returns to the match card after a successful write.
  finish: (matchId: string) => void;
  close: () => void;
}

// A write in flight: Saving... in the dialog, a refusal kept in the dialog with focus on its first spinbutton.
export function useWrite(store: TournamentStore): {
  busy: boolean; status: string; fields: Record<string, string>; refusals: number;
  run: <T>(request: () => Promise<T>) => Promise<T | null>;
} {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [refusals, setRefusals] = useState(0);
  // A button that disables itself while a write is in flight drops focus; put it back when the write ends.
  const restore = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!busy && restore.current?.isConnected) restore.current.focus();
    if (!busy) restore.current = null;
  }, [busy]);
  const run = async <T,>(request: () => Promise<T>): Promise<T | null> => {
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    setStatus('Saving...');
    setFields({});
    try {
      const result = await request();
      setStatus('');
      return result;
    } catch (error) {
      const failure = failureOf(error);
      setStatus(failure.message);
      setFields(failure.body.fields ?? {});
      if (failure.body.match) store.upsertMatch(failure.body.match);
      setRefusals((n) => n + 1);
      restore.current = null;
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, status, fields, refusals, run };
}

const parseGame = (text: string): number | null => (text.trim() === '' ? null : Number(text));

function Games({ match, upper, lower, setUpper, setLower, fields, refusals }: {
  match: MatchView;
  upper: string;
  lower: string;
  setUpper: (value: string) => void;
  setLower: (value: string) => void;
  fields: Record<string, string>;
  refusals: number;
}): ReactNode {
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (refusals) first.current?.focus();
  }, [refusals]);
  const upperName = slotName(match.upper);
  const lowerName = slotName(match.lower);
  const field = (name: string, value: string, set: (v: string) => void, error: string | undefined, ref?: typeof first): ReactNode => (
    <div className="games-field">
      <span className="games-name" aria-hidden="true">{name}</span>
      <input ref={ref} type="number" inputMode="numeric" min={0} max={99} step={1} value={value} aria-label={`${name} games`}
        data-autofocus={ref ? '' : undefined} onChange={(event) => set(event.target.value)} />
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
  return (
    <div className="games">
      {field(upperName, upper, setUpper, fields['upper_games'], first)}
      {field(lowerName, lower, setLower, fields['lower_games'])}
    </div>
  );
}

function Status({ text }: { text: string }): ReactNode {
  return <p role="status" aria-label="Dialog status" className="dialog-status">{text}</p>;
}

const opponentName = (match: MatchView, viewer: Viewer): string => {
  const mine = match.upper !== null && 'entrant_id' in match.upper && match.upper.entrant_id === viewer.entrantId;
  return slotName(mine ? match.lower : match.upper);
};

export function ReportDialog({ match, env }: { match: MatchView; env: DialogEnv }): ReactNode {
  const { organizer } = env.viewer;
  const prefill = organizer && match.report;
  const [upper, setUpper] = useState(prefill ? String(prefill.upper_games) : '');
  const [lower, setLower] = useState(prefill ? String(prefill.lower_games) : '');
  const write = useWrite(env.store);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const body = { upper_games: parseGame(upper), lower_games: parseGame(lower), version: match.version };
    const base = `/api/matches/${match.id}`;
    const result = await write.run(() => (organizer
      ? api.post<MatchResult>(`${base}/result`, body) : api.post<ReportResult>(`${base}/report`, body)));
    if (!result) return;
    env.store.upsertMatch(result.match);
    const outcome = 'outcome' in result ? result.outcome : 'saved';
    env.say(outcome === 'saved' ? 'Result saved' : outcome === 'confirmed' ? 'Score confirmed' : outcome === 'disputed'
      ? 'Score disputed' : `Score reported, awaiting ${opponentName(match, env.viewer)}`);
    env.finish(match.id);
  };

  const call = async (): Promise<void> => {
    const result = await write.run(() => api.post<MatchResult>(`/api/matches/${match.id}/call`, { version: match.version }));
    if (!result) return;
    env.store.upsertMatch(result.match);
    env.say('Match called');
    env.finish(match.id);
  };

  return (
    <Dialog label="Report score" onClose={env.close}>
      <p className="dialog-sub">{match.label}</p>
      <form onSubmit={(event) => void submit(event)}>
        <Games match={match} upper={upper} lower={lower} setUpper={setUpper} setLower={setLower} fields={write.fields} refusals={write.refusals} />
        <Status text={write.status} />
        <div className="dialog-actions">
          <button type="submit" className="btn" disabled={write.busy}>{organizer ? 'Save result' : 'Submit score'}</button>
          {organizer && match.state === 'pending' ? (
            <button type="button" className="btn" disabled={write.busy} onClick={() => void call()}>Call match</button>
          ) : null}
          <button type="button" className="btn btn-quiet" onClick={env.close}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({ match, env }: { match: MatchView; env: DialogEnv }): ReactNode {
  const report = match.report as NonNullable<MatchView['report']>;
  const [upper, setUpper] = useState(String(report.upper_games));
  const [lower, setLower] = useState(String(report.lower_games));
  const write = useWrite(env.store);
  useSecondTick();

  const answer = async (kind: 'confirm' | 'dispute'): Promise<void> => {
    const body = kind === 'confirm' ? { version: match.version }
      : { upper_games: parseGame(upper), lower_games: parseGame(lower), version: match.version };
    const result = await write.run(() => api.post<MatchResult>(`/api/matches/${match.id}/${kind}`, body));
    if (!result) return;
    env.store.upsertMatch(result.match);
    env.say(kind === 'confirm' ? 'Score confirmed' : 'Score disputed');
    env.finish(match.id);
  };

  return (
    <Dialog label="Confirm score" onClose={env.close}>
      <p className="dialog-sub">{`${report.by} reported ${report.upper_games}-${report.lower_games}`}</p>
      <p className="dialog-sub">{countdownText(report.auto_confirm_at)}</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        void answer(upper === String(report.upper_games) && lower === String(report.lower_games) ? 'confirm' : 'dispute');
      }}>
        <Games match={match} upper={upper} lower={lower} setUpper={setUpper} setLower={setLower} fields={write.fields} refusals={write.refusals} />
        <Status text={write.status} />
        <div className="dialog-actions">
          <button type="submit" className="btn" disabled={write.busy}>Confirm score</button>
          <button type="button" className="btn" disabled={write.busy} onClick={() => void answer('dispute')}>Dispute score</button>
          <button type="button" className="btn btn-quiet" onClick={env.close}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

export function ResolveDialog({ match, env, onResolved }: {
  match: MatchView;
  env: DialogEnv;
  onResolved?: (match: MatchView) => void;
}): ReactNode {
  const [upper, setUpper] = useState('');
  const [lower, setLower] = useState('');
  const write = useWrite(env.store);
  const claims = [match.report, match.dispute].flatMap((claim) => (claim ? [claim] : []));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const result = await write.run(() => api.post<MatchResult>(`/api/matches/${match.id}/resolve`,
      { upper_games: parseGame(upper), lower_games: parseGame(lower), version: match.version }));
    if (!result) return;
    env.store.upsertMatch(result.match);
    env.say('Dispute resolved');
    if (onResolved) onResolved(result.match);
    else env.finish(match.id);
  };

  return (
    <Dialog label="Resolve dispute" onClose={env.close}>
      <p className="dialog-sub">{match.label}</p>
      {claims.map((claim) => <p key={claim.by} className="dialog-sub">{`${claim.by} says ${claim.upper_games}-${claim.lower_games}`}</p>)}
      <form onSubmit={(event) => void submit(event)}>
        <Games match={match} upper={upper} lower={lower} setUpper={setUpper} setLower={setLower} fields={write.fields} refusals={write.refusals} />
        <Status text={write.status} />
        <div className="dialog-actions">
          <button type="submit" className="btn" disabled={write.busy}>Resolve</button>
          <button type="button" className="btn btn-quiet" onClick={env.close}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

export function DetailsDialog({ match, env, onEdit }: { match: MatchView; env: DialogEnv; onEdit?: () => void }): ReactNode {
  const decided = isDecided(match.state);
  return (
    <Dialog label="Match details" onClose={env.close}>
      <p className="dialog-sub">{match.label}</p>
      <p className="dialog-sub">{`${slotName(match.upper)} vs ${slotName(match.lower)}`}</p>
      <p className="dialog-sub">{STATUS_WORDS[match.state]}</p>
      {match.upper_games !== null ? <p className="dialog-sub">{`${match.upper_games}-${match.lower_games}`}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={env.close} data-autofocus="">Close</button>
        {env.viewer.organizer && decided && onEdit ? <button type="button" className="btn" onClick={onEdit}>Edit result</button> : null}
      </div>
    </Dialog>
  );
}
