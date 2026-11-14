import { api, ApiFailure, failureText } from '../api.js';
import { ErrorCell, FormErrors, FormStatus } from '../components/forms.js';
import type { SessionStateView } from '../../shared/types.js';

const EVENT_OPTIONS: { text: string; kind: string }[] = [
  { text: 'Close runway', kind: 'closure' },
  { text: 'Reopen runway', kind: 'reopen' },
  { text: 'Go-around', kind: 'go-around' },
  { text: 'Emergency', kind: 'emergency' },
  { text: 'End emergency', kind: 'end-emergency' },
  { text: 'Wind change', kind: 'wind' },
];

export interface EventDraft {
  kind: string;
  callsign: string;
  windDir: string;
  windKt: string;
  note: string;
}

export interface EventFeedback {
  status: string;
  eventError: string;
  noteErrors: Record<string, string>;
}

export function ClockControls(props: { id: string; state: SessionStateView; onError(text: string): void }) {
  const { state } = props;
  const post = async (path: string, body?: unknown) => {
    try {
      await api('POST', `/api/sessions/${props.id}/${path}`, body);
      props.onError('');
    } catch (error) {
      props.onError(failureText(error));
    }
  };
  return (
    <div class="clock-controls">
      {state.status === 'paused' ? (
        <button type="button" class="primary" onClick={() => void post('resume')}>
          Resume
        </button>
      ) : (
        <button type="button" class="primary" disabled={state.status === 'ended'} onClick={() => void post('pause')}>
          Pause
        </button>
      )}
      <div role="radiogroup" aria-label="Speed" class="speed-radios">
        {[1, 2, 4].map((speed) => (
          <label key={speed} class="radio">
            <input
              type="radio"
              name="speed"
              value={String(speed)}
              checked={state.speed === speed}
              onChange={() => void post('speed', { speed })}
            />
            <span>{`${speed}x`}</span>
          </label>
        ))}
      </div>
      <button type="button" onClick={() => void post('end')}>
        End exercise
      </button>
    </div>
  );
}

export function EventForms(props: {
  id: string;
  aircraft: string[];
  draft: EventDraft;
  setDraft(draft: EventDraft): void;
  feedback: EventFeedback;
  setFeedback(feedback: EventFeedback): void;
}) {
  const { draft, setDraft, feedback, setFeedback } = props;
  const needsAircraft = draft.kind === 'go-around' || draft.kind === 'emergency';
  const callsign = props.aircraft.includes(draft.callsign) ? draft.callsign : (props.aircraft[0] ?? '');
  return (
    <div class="event-forms stack">
      <form
        aria-label="Inject event"
        class="stack"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setFeedback({ ...feedback, status: 'Injecting...', eventError: '' });
          const body: Record<string, unknown> = { kind: draft.kind };
          if (needsAircraft) body.callsign = callsign;
          if (draft.kind === 'wind') {
            body.windDir = /^\d+$/.test(draft.windDir.trim()) ? Number(draft.windDir) : draft.windDir;
            body.windKt = /^\d+$/.test(draft.windKt.trim()) ? Number(draft.windKt) : draft.windKt;
          }
          try {
            await api('POST', `/api/sessions/${props.id}/events`, body);
            setFeedback({ ...feedback, status: 'Event injected.', eventError: '' });
          } catch (error) {
            setFeedback({ ...feedback, status: '', eventError: failureText(error) });
          }
        }}
      >
        <div class="field">
          <label for="event-kind">Event</label>
          <select id="event-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.currentTarget.value })}>
            {EVENT_OPTIONS.map((option) => (
              <option key={option.kind} value={option.kind}>
                {option.text}
              </option>
            ))}
          </select>
        </div>
        {needsAircraft ? (
          <div class="field">
            <label for="event-aircraft">Aircraft</label>
            <select id="event-aircraft" value={callsign} onChange={(e) => setDraft({ ...draft, callsign: e.currentTarget.value })}>
              {props.aircraft.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {draft.kind === 'wind' ? (
          <div class="field-grid">
            <div class="field">
              <label for="event-wind-dir">Wind direction</label>
              <input id="event-wind-dir" inputMode="numeric" value={draft.windDir} onInput={(e) => setDraft({ ...draft, windDir: e.currentTarget.value })} />
            </div>
            <div class="field">
              <label for="event-wind-kt">Wind speed</label>
              <input id="event-wind-kt" inputMode="numeric" value={draft.windKt} onInput={(e) => setDraft({ ...draft, windKt: e.currentTarget.value })} />
            </div>
          </div>
        ) : null}
        <button type="submit" class="primary">
          Inject
        </button>
        <ErrorCell label="Event error" text={feedback.eventError} />
      </form>
      <form
        aria-label="Pin note"
        class="stack"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setFeedback({ ...feedback, status: 'Pinning...', noteErrors: {} });
          try {
            await api('POST', `/api/sessions/${props.id}/notes`, { text: draft.note });
            setDraft({ ...draft, note: '' });
            setFeedback({ ...feedback, status: 'Note pinned.', noteErrors: {} });
          } catch (error) {
            const errors = error instanceof ApiFailure && error.body.errors ? error.body.errors : { text: failureText(error) };
            setFeedback({ ...feedback, status: '', noteErrors: errors });
          }
        }}
      >
        <FormErrors errors={feedback.noteErrors} fields={{ text: { id: 'note-text', label: 'Note' } }} />
        <div class="field">
          <label for="note-text">Note</label>
          <input
            id="note-text"
            value={draft.note}
            aria-invalid={feedback.noteErrors.text ? 'true' : undefined}
            onInput={(e) => setDraft({ ...draft, note: e.currentTarget.value })}
          />
        </div>
        <button type="submit">Pin note</button>
      </form>
      <FormStatus text={feedback.status} />
    </div>
  );
}
