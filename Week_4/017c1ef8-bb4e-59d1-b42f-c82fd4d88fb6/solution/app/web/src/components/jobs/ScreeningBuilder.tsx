import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { announce } from '../../announce';
import { ApiError, api } from '../../api';
import { Alert, Button, Menu } from '../../ui';
import { SOMETHING_WENT_WRONG, fieldMessages, type Question, type QuestionType } from './jobModel';

interface Card {
  /** Stable across saves; the server id arrives with the first save. */
  key: string;
  id: string | null;
  type: QuestionType;
  text: string;
  required: boolean;
  knockOut: boolean;
  ideal: 'yes' | 'no' | null;
  options: string[];
  accept: boolean[];
  minimum: string;
  maximum: string;
}

interface Conflict {
  by: string;
  current: Question[];
  version: number;
}

interface FocusRequest {
  key: string | null;
  target: 'text' | 'card' | 'add';
  n: number;
}

const TYPE_LABELS: Record<QuestionType, string> = { short_answer: 'Short answer', yes_no: 'Yes or no', single_choice: 'Single choice', number: 'Number' };
const TYPES: QuestionType[] = ['short_answer', 'yes_no', 'single_choice', 'number'];

let nextKey = 0;
const newKey = (): string => `card-${nextKey++}`;

const emptyCard = (type: QuestionType): Card => ({
  key: newKey(),
  id: null,
  type,
  text: '',
  required: false,
  knockOut: false,
  ideal: null,
  options: type === 'single_choice' ? ['', ''] : [],
  accept: type === 'single_choice' ? [false, false] : [],
  minimum: '',
  maximum: '',
});

const fromQuestion = (question: Question, key = newKey()): Card => {
  const options = question.options ?? [];
  return {
    key,
    id: question.id,
    type: question.type,
    text: question.text,
    required: question.required,
    knockOut: question.knock_out ?? false,
    ideal: question.ideal ?? null,
    options,
    accept: options.map((option) => question.accepted?.includes(option) ?? false),
    minimum: question.minimum === null || question.minimum === undefined ? '' : String(question.minimum),
    maximum: question.maximum === null || question.maximum === undefined ? '' : String(question.maximum),
  };
};

const numberOrNull = (text: string): number | null => (text.trim() === '' ? null : Number(text));

/** The question as the questions field stores it; fields a type does not use are null. */
function toInput(card: Card): Record<string, unknown> {
  return {
    ...(card.id ? { id: card.id } : {}),
    type: card.type,
    text: card.text,
    required: card.required,
    knock_out: card.knockOut,
    ideal: card.type === 'yes_no' ? card.ideal : null,
    options: card.type === 'single_choice' ? card.options : null,
    accepted: card.type === 'single_choice' ? card.options.filter((_, index) => card.accept[index]) : null,
    minimum: card.type === 'number' ? numberOrNull(card.minimum) : null,
    maximum: card.type === 'number' ? numberOrNull(card.maximum) : null,
  };
}

const TOO_MANY = 'A job can have up to 10 questions.';
const LOCKED = "Questions can't change after someone has applied.";

interface BuilderProps {
  jobId: string;
  initial: { value: Question[]; version: number };
  /** The latest stored questions when another editor saved them. */
  remote: { value: Question[]; version: number; by: string } | null;
}

/** The screening question builder: cards of the four types, reordered by keyboard or drag, saved as one field. */
export function ScreeningBuilder({ jobId, initial, remote }: BuilderProps) {
  const [cards, setCards] = useState<Card[]>(() => initial.value.map((question) => fromQuestion(question)));
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [alert, setAlert] = useState('');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [dragging, setDragging] = useState<{ key: string; dy: number } | null>(null);
  const cardsRef = useRef(cards);
  const version = useRef(initial.version);
  const unsaved = useRef(false);
  const saving = useRef(false);
  const again = useRef(false);
  const silent = useRef(true);
  const root = useRef<HTMLDivElement>(null);

  const update = (next: Card[]): void => {
    cardsRef.current = next;
    setCards(next);
  };

  const save = async (quiet: boolean): Promise<void> => {
    silent.current = silent.current && quiet;
    if (saving.current) {
      again.current = true;
      return;
    }
    saving.current = true;
    try {
      do {
        again.current = false;
        const sent = cardsRef.current;
        const quietNow = silent.current;
        silent.current = true;
        try {
          const stored = await api.patch<{ value: Question[]; version: number }>(`/api/jobs/${jobId}/fields/questions`, { value: sent.map(toInput), version: version.current });
          version.current = stored.version;
          unsaved.current = again.current;
          setErrors({});
          setAlert('');
          setConflict(null);
          const ids = new Map(sent.map((card, index) => [card.key, stored.value[index]?.id ?? null]));
          update(cardsRef.current.map((card) => (card.id ? card : { ...card, id: ids.get(card.key) ?? null })));
          if (!quietNow) announce('Jobs announcements', 'Screening questions saved.');
        } catch (error) {
          again.current = false;
          refuse(error, sent);
        }
      } while (again.current);
    } finally {
      saving.current = false;
    }
  };

  const refuse = (error: unknown, sent: Card[]): void => {
    if (!(error instanceof ApiError)) {
      setAlert(SOMETHING_WENT_WRONG);
      return;
    }
    const body = error.body;
    if (body.error === 'field_conflict') {
      const by = body.by as { name: string };
      setConflict({ by: by.name, current: body.current as Question[], version: body.current_version as number });
    } else if (body.error === 'questions_locked') setAlert(LOCKED);
    else if (body.error === 'too_many_questions') setAlert(TOO_MANY);
    else if (body.error === 'validation') {
      const byKey: Record<string, Record<string, string>> = {};
      for (const [path, message] of Object.entries(fieldMessages(error))) {
        const [, position, field] = path.split('.');
        const card = sent[Number(position) - 1];
        if (card && field) (byKey[card.key] ??= {})[field] = message;
      }
      setErrors(byKey);
    } else setAlert(SOMETHING_WENT_WRONG);
  };

  // Another editor's saved questions replace ours unless we have unsaved changes (our next save then meets the conflict).
  useEffect(() => {
    if (!remote || remote.version <= version.current || unsaved.current) return;
    version.current = remote.version;
    const known = new Map(cardsRef.current.flatMap((card) => (card.id ? [[card.id, card.key] as const] : [])));
    update(remote.value.map((question) => fromQuestion(question, known.get(question.id))));
  }, [remote?.version]);

  useEffect(() => {
    if (!focusRequest) return;
    const element = root.current;
    if (!element) return;
    if (focusRequest.target === 'add') element.querySelector<HTMLElement>('button[aria-haspopup="menu"]')?.focus();
    else {
      const card = element.querySelector<HTMLElement>(`[data-card-key="${focusRequest.key}"]`);
      (focusRequest.target === 'text' ? card?.querySelector<HTMLElement>('[data-question-text]') : card)?.focus();
    }
  }, [focusRequest?.n]);

  const ask = (key: string | null, target: FocusRequest['target']): void => setFocusRequest((current) => ({ key, target, n: (current?.n ?? 0) + 1 }));

  const change = (key: string, patch: Partial<Card>, saveNow: boolean): void => {
    unsaved.current = true;
    update(cardsRef.current.map((card) => (card.key === key ? { ...card, ...patch } : card)));
    if (saveNow) void save(false);
  };

  const commit = (): void => {
    if (unsaved.current) void save(false);
  };

  const add = (type: QuestionType): void => {
    const card = emptyCard(type);
    unsaved.current = true;
    update([...cardsRef.current, card]);
    ask(card.key, 'text');
  };

  const remove = (key: string): void => {
    const index = cardsRef.current.findIndex((card) => card.key === key);
    const rest = cardsRef.current.filter((card) => card.key !== key);
    unsaved.current = true;
    update(rest);
    const next = rest[index];
    if (next) ask(next.key, 'card');
    else ask(null, 'add');
    void save(false);
  };

  const move = (key: string, to: number): void => {
    const list = cardsRef.current;
    const from = list.findIndex((card) => card.key === key);
    if (from < 0 || to < 0 || to >= list.length || to === from) return;
    const next = [...list];
    const [card] = next.splice(from, 1);
    if (!card) return;
    next.splice(to, 0, card);
    unsaved.current = true;
    update(next);
    announce('Jobs announcements', `Question moved to position ${to + 1} of ${next.length}.`);
    ask(key, 'card');
    void save(true);
  };

  const cardKeyDown = (event: KeyboardEvent<HTMLLIElement>, key: string): void => {
    if (event.target !== event.currentTarget || !event.altKey) return;
    const index = cardsRef.current.findIndex((card) => card.key === key);
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(key, index - 1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(key, index + 1);
    }
  };

  const grab = (event: ReactPointerEvent<HTMLDivElement>, key: string): void => {
    if (event.button !== 0) return;
    const startY = event.clientY;
    const move_ = (next: PointerEvent): void => setDragging({ key, dy: next.clientY - startY });
    const drop = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', move_);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', drop);
      setDragging(null);
      const others = [...(root.current?.querySelectorAll<HTMLElement>('[data-card-key]') ?? [])].filter((element) => element.dataset.cardKey !== key);
      const to = others.filter((element) => {
        const box = element.getBoundingClientRect();
        return box.top + box.height / 2 < up.clientY;
      }).length;
      move(key, to);
    };
    window.addEventListener('pointermove', move_);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
  };

  return (
    <section ref={root} aria-label="Screening questions" className="stack screening">
      <h2 className="t-larger">Screening questions</h2>
      <Alert>{alert}</Alert>
      {conflict ? (
        <div role="alert" className="alert">
          <p>{`${conflict.by} changed this field while you were editing.`}</p>
          <div className="row">
            <Button
              onClick={() => {
                update(conflict.current.map((question) => fromQuestion(question)));
                version.current = conflict.version;
                unsaved.current = false;
                setConflict(null);
              }}
            >
              Use theirs
            </Button>
            <Button
              onClick={() => {
                version.current = conflict.version;
                setConflict(null);
                void save(false);
              }}
            >
              Keep mine
            </Button>
          </div>
        </div>
      ) : null}
      <ul className="plain-list questions" aria-label="Questions">
        {cards.map((card, index) => (
          <QuestionCard
            key={card.key}
            card={card}
            position={index + 1}
            errors={errors[card.key] ?? {}}
            dragY={dragging?.key === card.key ? dragging.dy : null}
            onKeyDown={(event) => cardKeyDown(event, card.key)}
            onGrab={(event) => grab(event, card.key)}
            onChange={(patch, saveNow) => change(card.key, patch, saveNow)}
            onCommit={commit}
            onRemove={() => remove(card.key)}
          />
        ))}
      </ul>
      <div>
        <Menu label="Add question" items={TYPES.map((type) => ({ label: TYPE_LABELS[type], onSelect: () => add(type) }))} />
      </div>
    </section>
  );
}

interface CardProps {
  card: Card;
  position: number;
  errors: Record<string, string>;
  dragY: number | null;
  onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => void;
  onGrab: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onChange: (patch: Partial<Card>, saveNow: boolean) => void;
  onCommit: () => void;
  onRemove: () => void;
}

function Message({ text }: { text?: string }) {
  return text ? <p className="field-message">{text}</p> : null;
}

function QuestionCard({ card, position, errors, dragY, onKeyDown, onGrab, onChange, onCommit, onRemove }: CardProps) {
  const uid = useId();
  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit();
    }
  };
  return (
    <li
      className="question-card surface stack-s"
      tabIndex={0}
      data-card-key={card.key}
      data-question-id={card.id ?? card.key}
      data-question-type={card.type}
      data-position={position}
      data-dragging={dragY !== null ? 'true' : undefined}
      style={dragY !== null ? { transform: `translateY(${dragY}px)` } : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="card-grip" onPointerDown={onGrab}>
        {`Question ${position} · ${TYPE_LABELS[card.type]}`}
      </div>
      <div className="field">
        <label htmlFor={`${uid}-text`} className="field-label">
          Question text
        </label>
        <input
          id={`${uid}-text`}
          className="input"
          data-question-text
          value={card.text}
          onChange={(event) => onChange({ text: event.target.value }, false)}
          onBlur={onCommit}
          onKeyDown={commitOnEnter}
        />
        <Message text={errors.text} />
      </div>
      <div className="row">
        <label className="choice">
          <input type="checkbox" checked={card.required} onChange={(event) => onChange({ required: event.target.checked }, true)} />
          Required
        </label>
        <label className="choice">
          <input type="checkbox" checked={card.knockOut} onChange={(event) => onChange({ knockOut: event.target.checked }, true)} />
          Knock-out
        </label>
      </div>
      {card.type === 'yes_no' ? (
        <div>
          <div role="radiogroup" aria-label="Ideal answer" className="choices">
            {(['yes', 'no'] as const).map((value) => (
              <label key={value} className="choice">
                <input type="radio" name={`${uid}-ideal`} checked={card.ideal === value} onChange={() => onChange({ ideal: value }, true)} />
                {value === 'yes' ? 'Yes' : 'No'}
              </label>
            ))}
          </div>
          <Message text={errors.ideal} />
        </div>
      ) : null}
      {card.type === 'single_choice' ? (
        <div className="stack-s">
          {card.options.map((option, index) => (
            <div key={index} className="option-row">
              <input
                className="input"
                aria-label={`Option ${index + 1}`}
                value={option}
                onChange={(event) => onChange({ options: card.options.map((text, i) => (i === index ? event.target.value : text)) }, false)}
                onBlur={onCommit}
                onKeyDown={commitOnEnter}
              />
              <label className="choice">
                <input
                  type="checkbox"
                  aria-label={`Accept ${option || `option ${index + 1}`}`}
                  checked={card.accept[index] ?? false}
                  onChange={(event) => onChange({ accept: card.accept.map((value, i) => (i === index ? event.target.checked : value)) }, true)}
                />
                Accept
              </label>
            </div>
          ))}
          <Message text={errors.options} />
          <Message text={errors.accepted} />
          <div>
            <Button onClick={() => onChange({ options: [...card.options, ''], accept: [...card.accept, false] }, false)}>Add option</Button>
          </div>
        </div>
      ) : null}
      {card.type === 'number' ? (
        <div>
          <div className="row">
            <div className="field">
              <label htmlFor={`${uid}-min`} className="field-label">
                Minimum
              </label>
              <input id={`${uid}-min`} className="input" type="number" step="any" value={card.minimum} onChange={(event) => onChange({ minimum: event.target.value }, false)} onBlur={onCommit} onKeyDown={commitOnEnter} />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-max`} className="field-label">
                Maximum
              </label>
              <input id={`${uid}-max`} className="input" type="number" step="any" value={card.maximum} onChange={(event) => onChange({ maximum: event.target.value }, false)} onBlur={onCommit} onKeyDown={commitOnEnter} />
            </div>
          </div>
          <Message text={errors.minimum} />
        </div>
      ) : null}
      <div>
        <Button onClick={onRemove}>Remove question</Button>
      </div>
    </li>
  );
}
