import { useEffect, useMemo, useRef, useState } from 'react';
import type { Deck, Question, QuestionType } from '../../shared/protocol';
import { api } from '../lib/api';
import { copy, pictureFailureMessage, saveFailureMessage } from '../lib/copy';
import { Link } from '../lib/router';
import { FieldError, HostHeader, StatusRegion, describedBy } from '../components';

const TYPE_LABELS: { value: QuestionType; label: string }[] = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'estimate', label: 'Estimate' },
  { value: 'sequence', label: 'Sequence' },
];

interface Draft {
  type: QuestionType;
  prompt: string;
  timeLimitSeconds: string;
  options: string[];
  correctIndex: number;
  min: string;
  max: string;
  step: string;
  answer: string;
  tolerance: string;
  unit: string;
  items: string[];
}

function toDraft(question: Question): Draft {
  return {
    type: question.type,
    prompt: question.prompt,
    timeLimitSeconds: String(question.timeLimitSeconds),
    options:
      question.type === 'multiple_choice'
        ? [...question.options, '', '', '', ''].slice(0, 4)
        : ['', '', '', ''],
    correctIndex: question.type === 'multiple_choice' ? question.correctIndex : 0,
    min: question.type === 'estimate' ? String(question.min) : '0',
    max: question.type === 'estimate' ? String(question.max) : '100',
    step: question.type === 'estimate' ? String(question.step) : '1',
    answer: question.type === 'estimate' ? String(question.answer) : '50',
    tolerance: question.type === 'estimate' ? String(question.tolerance) : '5',
    unit: question.type === 'estimate' ? question.unit : '',
    items:
      question.type === 'sequence'
        ? [...question.items, '', '', '', '', '', ''].slice(0, 6)
        : ['', '', '', '', '', ''],
  };
}

function draftBody(draft: Draft): Record<string, unknown> {
  const common = {
    type: draft.type,
    prompt: draft.prompt,
    timeLimitSeconds: Number(draft.timeLimitSeconds),
  };
  if (draft.type === 'multiple_choice') {
    const options = draft.options.filter((option) => option.trim().length > 0);
    return { ...common, options, correctIndex: draft.correctIndex };
  }
  if (draft.type === 'estimate') {
    return {
      ...common,
      min: Number(draft.min),
      max: Number(draft.max),
      step: Number(draft.step),
      answer: Number(draft.answer),
      tolerance: Number(draft.tolerance),
      unit: draft.unit,
    };
  }
  return { ...common, items: draft.items.filter((item) => item.trim().length > 0) };
}

export function DeckEditor({ deckId }: { deckId: string }): JSX.Element {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [missing, setMissing] = useState(false);

  const load = async (): Promise<void> => {
    const result = await api.get<{ deck: Deck }>(`/api/decks/${deckId}`);
    if (result.ok) {
      setDeck(result.data.deck);
      setTitle(result.data.deck.title);
    } else {
      setMissing(true);
    }
  };

  useEffect(() => {
    void load();
  }, [deckId]);

  const saveTitle = async (): Promise<void> => {
    if (!deck) return;
    setTitleError(undefined);
    setStatus(copy.saving);
    const result = await api.patch<{ deck: Deck }>(`/api/decks/${deckId}`, {
      title,
      version: deck.version,
    });
    if (result.ok) {
      setDeck(result.data.deck);
      setStatus(copy.saved);
      return;
    }
    setTitleError(result.failure.fields['title']);
    setStatus(saveFailureMessage(result.failure));
  };

  const addQuestion = async (): Promise<void> => {
    setStatus(copy.saving);
    const result = await api.post<{ question: Question }>(`/api/decks/${deckId}/questions`, {
      type: 'multiple_choice',
      prompt: 'New question',
      timeLimitSeconds: 20,
      options: ['Option A', 'Option B'],
      correctIndex: 0,
    });
    if (!result.ok) {
      setStatus(saveFailureMessage(result.failure));
      return;
    }
    await load();
    setStatus(copy.saved);
  };

  if (missing) {
    return (
      <main className="page">
        <HostHeader title="Deck editor">
          <Link to="/host">Your decks</Link>
        </HostHeader>
        <p className="status">That deck is not available.</p>
      </main>
    );
  }

  return (
    <main className="page">
      <HostHeader title="Deck editor">
        <Link to="/host">Your decks</Link>
        <Link to="/host/nights">Past nights</Link>
      </HostHeader>
      <div className="editor editor-column">
        <div className="editor-title-row">
          <div className="field">
            <label htmlFor="deck-title">Deck title</label>
            <input
              id="deck-title"
              type="text"
              maxLength={80}
              value={title}
              aria-describedby={describedBy('deck-title-error', titleError)}
              onChange={(event) => setTitle(event.target.value)}
            />
            <FieldError id="deck-title-error" message={titleError} />
          </div>
          <button className="button" type="button" onClick={() => void saveTitle()}>
            Save title
          </button>
        </div>
        <StatusRegion label="Editor status" text={status} />
        {(deck?.questions ?? []).map((question, index) => (
          <QuestionPanel
            key={question.id}
            deckId={deckId}
            question={question}
            position={index + 1}
            setStatus={setStatus}
            reload={load}
          />
        ))}
        <button className="button button-primary" type="button" onClick={() => void addQuestion()}>
          Add question
        </button>
      </div>
    </main>
  );
}

function QuestionPanel({
  deckId,
  question,
  position,
  setStatus,
  reload,
}: {
  deckId: string;
  question: Question;
  position: number;
  setStatus: (text: string) => void;
  reload: () => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => toDraft(question));
  const [version, setVersion] = useState(question.version);
  const [image, setImage] = useState(question.image);
  const [fields, setFields] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(toDraft(question));
    setVersion(question.version);
    setImage(question.image);
  }, [question]);

  const ids = useMemo(() => {
    const base = `q-${question.id}`;
    return {
      type: `${base}-type`,
      prompt: `${base}-prompt`,
      time: `${base}-time`,
      option: (index: number) => `${base}-option-${index}`,
      correct: (index: number) => `${base}-correct-${index}`,
      item: (index: number) => `${base}-item-${index}`,
      min: `${base}-min`,
      max: `${base}-max`,
      step: `${base}-step`,
      answer: `${base}-answer`,
      tolerance: `${base}-tolerance`,
      unit: `${base}-unit`,
      picture: `${base}-picture`,
    };
  }, [question.id]);

  const update = (patch: Partial<Draft>): void => setDraft({ ...draft, ...patch });

  const save = async (): Promise<void> => {
    setFields({});
    setStatus(copy.saving);
    const result = await api.put<{ question: Question }>(
      `/api/decks/${deckId}/questions/${question.id}`,
      { ...draftBody(draft), version },
    );
    if (result.ok) {
      setVersion(result.data.question.version);
      setStatus(copy.saved);
      return;
    }
    setFields(result.failure.fields);
    setStatus(saveFailureMessage(result.failure));
  };

  const remove = async (): Promise<void> => {
    setStatus(copy.saving);
    const result = await api.del(`/api/decks/${deckId}/questions/${question.id}`);
    if (!result.ok) {
      setStatus(saveFailureMessage(result.failure));
      return;
    }
    await reload();
    setStatus(copy.saved);
  };

  const upload = async (file: File): Promise<void> => {
    setStatus(copy.uploadingPicture);
    const form = new FormData();
    form.append('image', file);
    const result = await api.upload<{ question: Question }>(
      `/api/decks/${deckId}/questions/${question.id}/image`,
      form,
    );
    if (fileInput.current) fileInput.current.value = '';
    if (result.ok) {
      setImage(result.data.question.image);
      setVersion(result.data.question.version);
      setStatus(copy.pictureAttached);
      return;
    }
    setStatus(pictureFailureMessage(result.failure));
  };

  const removePicture = async (): Promise<void> => {
    setStatus(copy.removingPicture);
    const result = await api.del(`/api/decks/${deckId}/questions/${question.id}/image`);
    if (result.ok) {
      setImage(null);
      setVersion(version + 1);
      setStatus(copy.pictureRemoved);
      return;
    }
    setStatus(pictureFailureMessage(result.failure));
  };

  return (
    <section className="question-panel" role="group" aria-label={`Question ${position}`}>
      <h2 className="panel-heading">Question {position}</h2>
      <div className="panel-grid">
        <div className="field-grid">
          <div className="field">
            <label htmlFor={ids.type}>Question type</label>
            <select
              id={ids.type}
              value={draft.type}
              onChange={(event) => update({ type: event.target.value as QuestionType })}
            >
              {TYPE_LABELS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.prompt}>Prompt</label>
            <input
              id={ids.prompt}
              type="text"
              maxLength={200}
              value={draft.prompt}
              aria-describedby={describedBy(`${ids.prompt}-error`, fields['prompt'])}
              onChange={(event) => update({ prompt: event.target.value })}
            />
            <FieldError id={`${ids.prompt}-error`} message={fields['prompt']} />
          </div>
          <div className="field">
            <label htmlFor={ids.time}>Time limit (seconds)</label>
            <input
              id={ids.time}
              type="number"
              min={5}
              max={120}
              step={1}
              value={draft.timeLimitSeconds}
              aria-describedby={describedBy(`${ids.time}-error`, fields['timeLimitSeconds'])}
              onChange={(event) => update({ timeLimitSeconds: event.target.value })}
            />
            <FieldError id={`${ids.time}-error`} message={fields['timeLimitSeconds']} />
          </div>

          {draft.type === 'multiple_choice' && (
            <>
              {['A', 'B', 'C', 'D'].map((letter, index) => (
                <div className="field" key={letter}>
                  <label htmlFor={ids.option(index)}>{`Option ${letter}`}</label>
                  <input
                    id={ids.option(index)}
                    type="text"
                    maxLength={80}
                    value={draft.options[index] ?? ''}
                    aria-describedby={describedBy(
                      `${ids.option(index)}-error`,
                      fields[`options.${index}`] ?? (index === 0 ? fields['options'] : undefined),
                    )}
                    onChange={(event) => {
                      const options = [...draft.options];
                      options[index] = event.target.value;
                      update({ options });
                    }}
                  />
                  <FieldError
                    id={`${ids.option(index)}-error`}
                    message={fields[`options.${index}`] ?? (index === 0 ? fields['options'] : undefined)}
                  />
                </div>
              ))}
              <div className="field">
                <span>Correct option</span>
                <div className="radio-row">
                  {['A', 'B', 'C', 'D'].map((letter, index) => (
                    <label key={letter} htmlFor={ids.correct(index)}>
                      <input
                        id={ids.correct(index)}
                        type="radio"
                        name={`correct-${question.id}`}
                        checked={draft.correctIndex === index}
                        aria-label={`Correct: ${letter}`}
                        onChange={() => update({ correctIndex: index })}
                      />
                      {`Correct: ${letter}`}
                    </label>
                  ))}
                </div>
                <FieldError id={`${ids.type}-correct-error`} message={fields['correctIndex']} />
              </div>
            </>
          )}

          {draft.type === 'estimate' && (
            <>
              {(
                [
                  ['Minimum', 'min', ids.min],
                  ['Maximum', 'max', ids.max],
                  ['Step', 'step', ids.step],
                  ['Correct value', 'answer', ids.answer],
                  ['Tolerance', 'tolerance', ids.tolerance],
                ] as const
              ).map(([label, key, id]) => (
                <div className="field" key={key}>
                  <label htmlFor={id}>{label}</label>
                  <input
                    id={id}
                    type="number"
                    value={draft[key]}
                    aria-describedby={describedBy(`${id}-error`, fields[key])}
                    onChange={(event) => update({ [key]: event.target.value } as Partial<Draft>)}
                  />
                  <FieldError id={`${id}-error`} message={fields[key]} />
                </div>
              ))}
              <div className="field">
                <label htmlFor={ids.unit}>Unit</label>
                <input
                  id={ids.unit}
                  type="text"
                  maxLength={20}
                  value={draft.unit}
                  aria-describedby={describedBy(`${ids.unit}-error`, fields['unit'])}
                  onChange={(event) => update({ unit: event.target.value })}
                />
                <FieldError id={`${ids.unit}-error`} message={fields['unit']} />
              </div>
            </>
          )}

          {draft.type === 'sequence' && (
            <>
              {draft.items.map((item, index) => (
                <div className="field" key={index}>
                  <label htmlFor={ids.item(index)}>{`Item ${index + 1}`}</label>
                  <input
                    id={ids.item(index)}
                    type="text"
                    maxLength={80}
                    value={item}
                    aria-describedby={describedBy(
                      `${ids.item(index)}-error`,
                      fields[`items.${index}`] ?? (index === 0 ? fields['items'] : undefined),
                    )}
                    onChange={(event) => {
                      const items = [...draft.items];
                      items[index] = event.target.value;
                      update({ items });
                    }}
                  />
                  <FieldError
                    id={`${ids.item(index)}-error`}
                    message={fields[`items.${index}`] ?? (index === 0 ? fields['items'] : undefined)}
                  />
                </div>
              ))}
            </>
          )}
        </div>

        <div className="picture-area">
          <div className="field">
            <label htmlFor={ids.picture}>{`Picture for question ${position}`}</label>
            <input
              id={ids.picture}
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </div>
          <p className="deck-count">{image ? 'Picture attached' : 'No picture'}</p>
          {image && (
            <>
              <img src={image.previewUrl} alt={`Picture for question ${position}`} />
              <button className="button" type="button" onClick={() => void removePicture()}>
                Remove picture
              </button>
            </>
          )}
        </div>
      </div>

      <div className="panel-actions">
        <button className="button button-primary" type="button" onClick={() => void save()}>
          Save question
        </button>
        <button className="button" type="button" onClick={() => void remove()}>
          Delete question
        </button>
      </div>
    </section>
  );
}
