import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiFailure, SignedOut, api, signInHref } from '../lib/api.js';
import { useSession, useStage } from '../lib/app-context.js';
import { useReducedMotion, useTypedLine } from '../lib/typing.js';
import { GuideCursor, Problems } from '../components/ui.js';
import {
  BRIEF_COMPLETE,
  BRIEF_INTRO_LINE,
  BRIEF_QUESTIONS,
  KEY_CHORD_CHIPS,
  KEY_CHORD_TEXT,
  briefStepSaved,
} from '../../shared/copy.js';
import {
  ADDON_LABELS,
  ADDON_ORDER,
  AUDIENCE_DUST,
  AUDIENCE_LABELS,
  DUST_BEFORE_ANSWER,
  INSTALLATION_LABELS,
  type AddOn,
  type Audience,
  type DoorWall,
  type InstallationType,
  type Venue,
} from '../../shared/seed.js';

interface BriefShape {
  id: string;
  answers: Record<string, unknown>;
  answeredThrough: number;
  nextStep: number | null;
  commissionId: string | null;
}

const PENDING_KEY = 'spindrift.brief.pending';
const INTRO_HOLD_MS = 1100;

const DOOR_LABELS: Record<DoorWall, string> = {
  front: 'Front wall',
  back: 'Back wall',
  left: 'Left wall',
  right: 'Right wall',
};

type Answers = Record<string, unknown>;

function silhouetteFor(answers: Answers): InstallationType | 'none' {
  const type = answers['installationType'];
  return typeof type === 'string' && type in INSTALLATION_LABELS
    ? (type as InstallationType)
    : 'none';
}

function dustFor(answers: Answers): number {
  const audience = answers['audience'];
  if (typeof audience === 'string' && audience in AUDIENCE_DUST) {
    return AUDIENCE_DUST[audience as Audience];
  }
  return DUST_BEFORE_ANSWER;
}

export function Brief(): JSX.Element {
  const { briefId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { me, loading } = useSession();
  const { patch } = useStage();
  const reducedMotion = useReducedMotion();

  const isNew = briefId === undefined;
  const rawStep = params.get('step');
  const [brief, setBrief] = useState<BriefShape | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState('');
  const [introDone, setIntroDone] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const replayed = useRef(false);

  // Step 1 of a new brief always lives at /brief/new?step=1.
  useEffect(() => {
    if (!isNew) return;
    if (rawStep !== '1') setParams({ step: '1' }, { replace: true });
    setStep(1);
  }, [isNew, rawStep, setParams]);

  // Load the draft and settle on a step that exists.
  useEffect(() => {
    if (isNew || briefId === undefined) return;
    let cancelled = false;
    api
      .get<BriefShape>(`/api/briefs/${briefId}`)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded.commissionId) {
          navigate(`/c/${loaded.commissionId}`, { replace: true });
          return;
        }
        setBrief(loaded);
        setAnswers(loaded.answers);
        const highest = loaded.nextStep ?? 6;
        const asked = Number.parseInt(rawStep ?? '', 10);
        if (!Number.isInteger(asked) || asked < 1 || asked > highest) {
          setParams({ step: String(highest) }, { replace: true });
          setStep(highest);
        } else {
          setStep(asked);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof SignedOut || (error instanceof ApiFailure && error.status === 401)) {
          window.location.href = signInHref(`/briefs/${briefId}?step=${rawStep ?? '1'}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [briefId, isNew, navigate, rawStep, setParams]);

  // The intro line plays only on the first step of a new brief.
  useEffect(() => {
    if (!isNew) return undefined;
    if (reducedMotion) {
      setIntroDone(true);
      return undefined;
    }
    setIntroDone(false);
    const timer = setTimeout(() => setIntroDone(true), INTRO_HOLD_MS);
    return () => clearTimeout(timer);
  }, [isNew, reducedMotion]);

  // The stage is at full brightness on the brief and follows the saved answers.
  useEffect(() => {
    patch({
      scene: 'brief',
      entrance: 1,
      silhouette: silhouetteFor(answers) === 'none' ? 'none' : silhouetteFor(answers),
      roomWidthM: typeof answers['widthM'] === 'number' ? (answers['widthM'] as number) : null,
      roomDepthM: typeof answers['depthM'] === 'number' ? (answers['depthM'] as number) : null,
      dust: dustFor(answers),
    });
  }, [answers, patch]);

  const question = BRIEF_QUESTIONS[step - 1] ?? BRIEF_QUESTIONS[0]!;

  const leave = useCallback(() => {
    navigate(me ? '/commissions' : '/');
  }, [me, navigate]);

  const saveStep = useCallback(
    async (targetBrief: BriefShape | null, value: Answers): Promise<void> => {
      setSaving(true);
      setErrors({});
      try {
        let draft = targetBrief;
        if (!draft) {
          draft = await api.post<BriefShape>('/api/briefs');
        }
        const saved = await api.put<BriefShape>(`/api/briefs/${draft.id}/steps/${step}`, {
          answer: value,
        });
        setBrief(saved);
        setAnswers(saved.answers);
        if (step === 6) {
          const commission = await api.post<{ id: string }>(`/api/briefs/${saved.id}/complete`);
          setProgress(BRIEF_COMPLETE);
          navigate(`/c/${commission.id}`, { replace: true });
          return;
        }
        const next = step + 1;
        setProgress(briefStepSaved(next));
        navigate(`/briefs/${saved.id}?step=${next}`, { replace: isNew });
        setStep(next);
      } catch (error) {
        if (error instanceof SignedOut) return;
        if (error instanceof ApiFailure) {
          if (error.status === 401) {
            // Keep the answer and come back to this step after signing in.
            sessionStorage.setItem(
              PENDING_KEY,
              JSON.stringify({ step, answer: value, briefId: targetBrief?.id ?? null }),
            );
            window.location.href = signInHref(
              targetBrief ? `/briefs/${targetBrief.id}?step=${step}` : '/brief/new?step=1',
            );
            return;
          }
          setErrors(error.fieldErrors);
          const first = Object.values(error.fieldErrors)[0];
          if (first) setProgress(first);
        }
      } finally {
        setSaving(false);
      }
    },
    [isNew, navigate, step],
  );

  // After signing in, replay the kept answer once.
  useEffect(() => {
    if (loading || !me || replayed.current) return;
    const stored = sessionStorage.getItem(PENDING_KEY);
    if (!stored) return;
    replayed.current = true;
    sessionStorage.removeItem(PENDING_KEY);
    let pending: { step: number; answer: Answers; briefId: string | null };
    try {
      pending = JSON.parse(stored) as { step: number; answer: Answers; briefId: string | null };
    } catch {
      return;
    }
    if (pending.step !== step) return;
    void saveStep(brief, pending.answer);
  }, [brief, loading, me, saveStep, step]);

  return (
    <main className="brief-screen">
      <button
        type="button"
        className="chip-chrome close-brief"
        aria-label="Close brief"
        onClick={leave}
      >
        <span aria-hidden="true">CLOSE ×</span>
      </button>
      <div className="brief-inner">
        {isNew && !introDone ? (
          <IntroLine reducedMotion={reducedMotion} />
        ) : (
          <StepScreen
            key={`${brief?.id ?? 'new'}-${step}`}
            step={step}
            question={question}
            answers={answers}
            errors={errors}
            saving={saving}
            reducedMotion={reducedMotion}
            onSubmit={(value) => void saveStep(brief, value)}
            onEscape={leave}
          />
        )}
        <div role="status" aria-label="Brief progress" aria-live="polite" className="muted">
          {progress}
        </div>
      </div>
    </main>
  );
}

function IntroLine({ reducedMotion }: { reducedMotion: boolean }): JSX.Element {
  const line = useTypedLine(BRIEF_INTRO_LINE, reducedMotion);
  return (
    <h1 className="cue-line" aria-label={BRIEF_INTRO_LINE} data-typed={String(line.typed)}>
      <span aria-hidden="true">
        {Array.from(BRIEF_INTRO_LINE).map((character, index) => (
          <span key={index} className="cue-letter" data-letter={line.letters[index] ?? 'hidden'}>
            {character === ' ' ? '\u00a0' : character}
          </span>
        ))}
        <GuideCursor />
      </span>
    </h1>
  );
}

interface StepProps {
  step: number;
  question: string;
  answers: Answers;
  errors: Record<string, string>;
  saving: boolean;
  reducedMotion: boolean;
  onSubmit: (answer: Answers) => void;
  onEscape: () => void;
}

function StepScreen(props: StepProps): JSX.Element {
  const { step, question, answers, errors, saving, reducedMotion, onSubmit, onEscape } = props;
  const line = useTypedLine(question, reducedMotion);
  const controlsVisible = reducedMotion || line.settled;
  const firstControl = useRef<HTMLElement | null>(null);
  const [draft, setDraft] = useState<Answers>(() => ({ ...answers }));

  useEffect(() => {
    setDraft({ ...answers });
  }, [answers, step]);

  // Focus moves to the first answer control when a new question appears.
  useEffect(() => {
    if (!controlsVisible) return;
    firstControl.current?.focus();
  }, [controlsVisible, step]);

  const value = useCallback((name: string) => draft[name], [draft]);
  const set = useCallback((name: string, next: unknown) => {
    setDraft((current) => ({ ...current, [name]: next }));
  }, []);

  const hasAnswer = useMemo(() => {
    switch (step) {
      case 1:
        return (
          typeof value('installationType') === 'string' &&
          String(value('title') ?? '').trim().length >= 2
        );
      case 2:
        return typeof value('venueId') === 'string' && value('venueId') !== '';
      case 3:
        return typeof value('widthM') === 'number' && typeof value('depthM') === 'number';
      case 4:
        return typeof value('doorWall') === 'string';
      case 5:
        return typeof value('audience') === 'string';
      case 6:
        return true;
      default:
        return false;
    }
  }, [step, value]);

  const submit = (): void => {
    if (!hasAnswer || saving) return;
    onSubmit(answerFor(step, draft));
  };

  // Enter anywhere in the step submits it.
  const onKeyDown = (event: React.KeyboardEvent<HTMLFormElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== 'Enter') return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement && event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  return (
    <form
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 22 }}
    >
      <h1 className="cue-line" aria-label={question} data-typed={String(line.typed)}>
        <span aria-hidden="true">
          {Array.from(question).map((character, index) => (
            <span key={index}>
              <span className="cue-letter" data-letter={line.letters[index] ?? 'hidden'}>
                {character === ' ' ? '\u00a0' : character}
              </span>
              {index === line.typed - 1 ? <GuideCursor /> : null}
            </span>
          ))}
          {line.typed === 0 ? <GuideCursor /> : null}
        </span>
      </h1>

      {controlsVisible ? (
        <>
          <Problems errors={errors} />
          <StepControls
            step={step}
            question={question}
            draft={draft}
            set={set}
            errors={errors}
            firstControl={firstControl}
          />
          <div className="inline">
            <button
              type="submit"
              className="primary ok-arrow"
              disabled={!hasAnswer || saving}
            >
              OK
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </button>
            <span className="key-chord" aria-hidden="true">
              {step === 1 || step === 6 ? KEY_CHORD_TEXT : KEY_CHORD_CHIPS}
            </span>
          </div>
        </>
      ) : null}
    </form>
  );
}

function answerFor(step: number, draft: Answers): Answers {
  switch (step) {
    case 1:
      return {
        installationType: draft['installationType'],
        title: String(draft['title'] ?? '').trim(),
      };
    case 2:
      return { venueId: draft['venueId'] };
    case 3:
      return { widthM: draft['widthM'], depthM: draft['depthM'] };
    case 4:
      return { doorWall: draft['doorWall'] };
    case 5:
      return { audience: draft['audience'] };
    default:
      return {
        addOns: Array.isArray(draft['addOns']) ? draft['addOns'] : [],
        notes: String(draft['notes'] ?? ''),
      };
  }
}

interface ControlsProps {
  step: number;
  question: string;
  draft: Answers;
  set: (name: string, value: unknown) => void;
  errors: Record<string, string>;
  firstControl: React.MutableRefObject<HTMLElement | null>;
}

function StepControls(props: ControlsProps): JSX.Element {
  const { step, question, draft, set, errors, firstControl } = props;

  if (step === 1) {
    return (
      <>
        <RadioChips
          name={question}
          options={Object.entries(INSTALLATION_LABELS).map(([id, label]) => ({ id, label }))}
          selected={String(draft['installationType'] ?? '')}
          onSelect={(id) => set('installationType', id)}
          firstControl={firstControl}
        />
        <input
          id="field-title"
          className="answer-field"
          aria-label="Name the piece"
          placeholder="Name the piece"
          value={String(draft['title'] ?? '')}
          onChange={(event) => set('title', event.target.value)}
        />
        {errors['title'] ? <p className="muted">{errors['title']}</p> : null}
      </>
    );
  }

  if (step === 2) {
    return (
      <VenueCombobox
        selectedId={String(draft['venueId'] ?? '')}
        onSelect={(venue) => set('venueId', venue.id)}
        firstControl={firstControl}
      />
    );
  }

  if (step === 3) {
    return (
      <div className="inline">
        <input
          id="field-widthM"
          className="answer-field"
          aria-label="Width in metres"
          placeholder="Width in metres"
          inputMode="decimal"
          ref={(element) => {
            if (element) firstControl.current = element;
          }}
          value={draft['widthM'] === undefined ? '' : String(draft['widthM'])}
          onChange={(event) =>
            set('widthM', event.target.value === '' ? undefined : Number(event.target.value))
          }
        />
        <input
          id="field-depthM"
          className="answer-field"
          aria-label="Depth in metres"
          placeholder="Depth in metres"
          inputMode="decimal"
          value={draft['depthM'] === undefined ? '' : String(draft['depthM'])}
          onChange={(event) =>
            set('depthM', event.target.value === '' ? undefined : Number(event.target.value))
          }
        />
      </div>
    );
  }

  if (step === 4) {
    return (
      <RadioChips
        name={question}
        options={Object.entries(DOOR_LABELS).map(([id, label]) => ({ id, label }))}
        selected={String(draft['doorWall'] ?? '')}
        onSelect={(id) => set('doorWall', id)}
        firstControl={firstControl}
      />
    );
  }

  if (step === 5) {
    return (
      <RadioChips
        name={question}
        options={Object.entries(AUDIENCE_LABELS).map(([id, label]) => ({ id, label }))}
        selected={String(draft['audience'] ?? '')}
        onSelect={(id) => set('audience', id)}
        firstControl={firstControl}
      />
    );
  }

  const chosen = Array.isArray(draft['addOns']) ? (draft['addOns'] as string[]) : [];
  return (
    <>
      <div role="group" aria-label={question} className="chip-grid few">
        {ADDON_ORDER.map((addOn, index) => (
          <button
            key={addOn}
            type="button"
            role="checkbox"
            aria-checked={chosen.includes(addOn)}
            className="chip"
            ref={(element) => {
              if (index === 0 && element) firstControl.current = element;
            }}
            onClick={() =>
              set(
                'addOns',
                chosen.includes(addOn)
                  ? chosen.filter((item) => item !== addOn)
                  : [...chosen, addOn],
              )
            }
          >
            <span className="box" aria-hidden="true">
              {chosen.includes(addOn) ? '✓' : ''}
            </span>
            <span className="label">{ADDON_LABELS[addOn as AddOn]}</span>
          </button>
        ))}
      </div>
      <textarea
        id="field-notes"
        className="answer-field"
        aria-label="Notes for the studio"
        placeholder="Notes for the studio"
        value={String(draft['notes'] ?? '')}
        onChange={(event) => set('notes', event.target.value)}
      />
      {errors['notes'] ? <p className="muted">{errors['notes']}</p> : null}
    </>
  );
}

/** Radio chips: arrow keys move between them and Space ticks one. */
function RadioChips({
  name,
  options,
  selected,
  onSelect,
  firstControl,
}: {
  name: string;
  options: { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
  firstControl: React.MutableRefObject<HTMLElement | null>;
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number): void => {
    const next = (from + delta + options.length) % options.length;
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={name} className="chip-grid">
      {options.map((option, index) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={selected === option.id}
          tabIndex={selected === option.id || (selected === '' && index === 0) ? 0 : -1}
          className="chip"
          ref={(element) => {
            refs.current[index] = element;
            if (index === 0 && element) firstControl.current = element;
          }}
          onClick={() => onSelect(option.id)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              move(index, 1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(index, -1);
            } else if (event.key === ' ') {
              event.preventDefault();
              onSelect(option.id);
            }
          }}
        >
          <span className="box" aria-hidden="true">
            {selected === option.id ? '✓' : ''}
          </span>
          <span className="label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The venue field asks the server 250 milliseconds after the last keystroke and
 * shows only the reply to the latest text.
 */
function VenueCombobox({
  selectedId,
  onSelect,
  firstControl,
}: {
  selectedId: string;
  onSelect: (venue: Venue) => void;
  firstControl: React.MutableRefObject<HTMLElement | null>;
}): JSX.Element {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<Venue[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const latestQuery = useRef(0);
  /** The name of the venue just picked, so choosing one does not search again. */
  const chosenName = useRef('');

  useEffect(() => {
    if (text.trim() === '' || text === chosenName.current) {
      setOptions([]);
      setOpen(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      const ticket = latestQuery.current + 1;
      latestQuery.current = ticket;
      api
        .get<{ venues: Venue[] }>(`/api/venues?q=${encodeURIComponent(text.trim())}`)
        .then((result) => {
          // A slower reply to earlier text is dropped.
          if (ticket !== latestQuery.current) return;
          setOptions(result.venues);
          setOpen(true);
          setActive(0);
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);

  const choose = (venue: Venue): void => {
    onSelect(venue);
    chosenName.current = venue.name;
    setText(venue.name);
    setOptions([]);
    setOpen(false);
  };

  return (
    <div>
      <input
        id="field-venueId"
        className="answer-field"
        role="combobox"
        aria-label="Venue"
        aria-expanded={open}
        aria-controls="venue-listbox"
        aria-autocomplete="list"
        placeholder="Start typing the venue or address"
        value={text}
        ref={(element) => {
          if (element) firstControl.current = element;
        }}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (!open || options.length === 0) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((current) => (current + 1) % options.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => (current - 1 + options.length) % options.length);
          } else if (event.key === 'Enter') {
            const venue = options[active];
            if (venue) {
              event.preventDefault();
              event.stopPropagation();
              choose(venue);
            }
          }
        }}
      />
      <ul id="venue-listbox" role="listbox" aria-label="Venues" className="list">
        {open
          ? options.map((venue, index) => (
              <li key={venue.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active || venue.id === selectedId}
                  className="chip"
                  onClick={() => choose(venue)}
                >
                  <span className="label">
                    {venue.name} — {venue.address}, {venue.city}
                  </span>
                </button>
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}
