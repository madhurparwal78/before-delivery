import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Dependent, EditPreview, EditResult, MatchView } from '../../shared/api.js';
import { isDecided } from '../../shared/rules.js';
import { api } from '../api.js';
import { STATUS_WORDS, slotName } from '../bracketModel.js';
import { resetCountText, useTrace, type TraceController } from '../trace.js';
import { Dialog } from './Dialog.js';
import { useWrite, type DialogEnv } from './ScoreDialogs.js';

const parseGame = (text: string): number | null => (text.trim() === '' ? null : Number(text));

// Edit result: review the edit (Shutter trace shows every later match it would undo), then confirm or back out.
export function EditDialog({ match, env, controller, feederOf, onCancel }: {
  match: MatchView;
  env: DialogEnv;
  controller: TraceController;
  feederOf: (dependent: Dependent, reached: string[]) => string;
  onCancel: () => void;
}): ReactNode {
  const [upper, setUpper] = useState(String(match.upper_games ?? ''));
  const [lower, setLower] = useState(String(match.lower_games ?? ''));
  const [reviewed, setReviewed] = useState<EditPreview | null>(null);
  const write = useWrite(env.store);
  const trace = useTrace(controller);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (write.refusals) first.current?.focus();
  }, [write.refusals]);

  const change = (set: (value: string) => void) => (value: string): void => {
    set(value);
    if (reviewed) {
      setReviewed(null);
      controller.reverse();
    }
  };

  const body = { upper_games: parseGame(upper), lower_games: parseGame(lower), version: match.version };

  const review = async (): Promise<void> => {
    const preview = await write.run(() => api.post<EditPreview>(`/api/matches/${match.id}/edit-preview`, body));
    if (!preview) return;
    setReviewed(preview);
    controller.play(match.id, preview.dependents, feederOf);
  };

  const commitEdit = async (): Promise<void> => {
    if (!reviewed) return;
    const result = await write.run(() => api.post<EditResult>(`/api/matches/${match.id}/edit`,
      { upper_games: parseGame(upper), lower_games: parseGame(lower), preview_token: reviewed.preview_token }));
    if (!result) {
      setReviewed(null);
      controller.reverse();
      return;
    }
    controller.commit();
    env.store.upsertMatch(result.match);
    env.say('Result edited');
    env.finish(match.id);
  };

  const cancel = (): void => {
    controller.reverse();
    onCancel();
  };

  const shown = trace.reached;
  const countText = reviewed && (reviewed.count === 0 || shown.length > 0)
    ? resetCountText(shown.length, shown.filter((d) => isDecided(d.state)).length)
    : '';

  const upperName = slotName(match.upper);
  const lowerName = slotName(match.lower);
  return (
    <Dialog label="Edit result" onClose={cancel}>
      <p className="dialog-sub">{match.label}</p>
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); void review(); }}>
        <div className="games">
          <div className="games-field">
            <span className="games-name" aria-hidden="true">{upperName}</span>
            <input ref={first} type="number" inputMode="numeric" min={0} max={99} value={upper} aria-label={`${upperName} games`}
              data-autofocus="" onChange={(event) => change(setUpper)(event.target.value)} />
            {write.fields['upper_games'] ? <span className="field-error">{write.fields['upper_games']}</span> : null}
          </div>
          <div className="games-field">
            <span className="games-name" aria-hidden="true">{lowerName}</span>
            <input type="number" inputMode="numeric" min={0} max={99} value={lower} aria-label={`${lowerName} games`}
              onChange={(event) => change(setLower)(event.target.value)} />
            {write.fields['lower_games'] ? <span className="field-error">{write.fields['lower_games']}</span> : null}
          </div>
        </div>
        <p role="status" aria-label="Reset count" className="reset-count">{countText}</p>
        <ul aria-label="Matches that will reset" className="reset-list">
          {shown.map((d) => <li key={d.match_id}>{`${d.label} · ${STATUS_WORDS[d.state]}`}</li>)}
        </ul>
        <p role="status" aria-label="Dialog status" className="dialog-status">{write.status}</p>
        <div className="dialog-actions">
          <button type="submit" className="btn" disabled={write.busy}>Review edit</button>
          {reviewed ? <button type="button" className="btn" disabled={write.busy} onClick={() => void commitEdit()}>Confirm edit</button> : null}
          <button type="button" className="btn btn-quiet" onClick={cancel}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
