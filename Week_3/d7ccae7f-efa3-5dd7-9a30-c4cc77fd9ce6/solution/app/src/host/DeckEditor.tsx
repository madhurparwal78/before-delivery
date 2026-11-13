import { ImageOff, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import { deckQuestionSchema, deckSchema, type Deck, type DeckQuestion, type QuestionType } from "../../shared/schemas";
import { Field, Status, describedBy, type StatusMessage } from "../components";
import { ApiFailure, api, fieldErrors, upload } from "../lib/api";
import { HostShell } from "./HostShell";

const deckReply = z.object({ deck: deckSchema });
const questionReply = z.object({ question: deckQuestionSchema });
const LETTERS = ["A", "B", "C", "D"];
const ITEM_FIELDS = 6;
const typeLabels: Record<QuestionType, string> = { multiple_choice: "Multiple choice", estimate: "Estimate", sequence: "Sequence" };

type Draft = {
  key: string;
  id: string | null;
  version: number | null;
  type: QuestionType;
  prompt: string;
  seconds: string;
  options: string[];
  correct: number;
  min: string;
  max: string;
  step: string;
  answer: string;
  tolerance: string;
  unit: string;
  items: string[];
  image: DeckQuestion["image"];
};

const padded = (values: string[], length: number): string[] => [...values, ...Array.from({ length: Math.max(0, length - values.length) }, () => "")];

function blankDraft(key: string): Draft {
  return {
    key,
    id: null,
    version: null,
    type: "multiple_choice",
    prompt: "",
    seconds: "20",
    options: padded([], 4),
    correct: 0,
    min: "0",
    max: "100",
    step: "1",
    answer: "50",
    tolerance: "0",
    unit: "",
    items: padded([], ITEM_FIELDS),
    image: null,
  };
}

function draftFrom(question: DeckQuestion): Draft {
  const draft: Draft = { ...blankDraft(question.id), id: question.id, version: question.version, type: question.type, prompt: question.prompt, seconds: String(question.timeLimitSeconds), image: question.image };
  if (question.type === "multiple_choice") return { ...draft, options: padded(question.options, 4), correct: question.correctIndex };
  if (question.type === "estimate") {
    return { ...draft, min: String(question.min), max: String(question.max), step: String(question.step), answer: String(question.answer), tolerance: String(question.tolerance), unit: question.unit };
  }
  return { ...draft, items: padded(question.items, ITEM_FIELDS) };
}

const number = (text: string): number | null => (text.trim() === "" ? null : Number(text));

function bodyFrom(draft: Draft): Record<string, unknown> {
  const base = { type: draft.type, prompt: draft.prompt, timeLimitSeconds: number(draft.seconds) };
  if (draft.type === "multiple_choice") {
    const filled = draft.options.map((text, index) => ({ text: text.trim(), index })).filter((option) => option.text !== "");
    return { ...base, options: filled.map((option) => option.text), correctIndex: filled.findIndex((option) => option.index === draft.correct) };
  }
  if (draft.type === "estimate") {
    return { ...base, min: number(draft.min), max: number(draft.max), step: number(draft.step), answer: number(draft.answer), tolerance: number(draft.tolerance), unit: draft.unit };
  }
  return { ...base, items: draft.items.filter((item) => item.trim() !== "") };
}

const pictureCopy: Record<string, string> = {
  unsupported_type: "That file isn't a PNG, JPEG or WebP picture.",
  image_too_large: "That picture is too large for a question.",
  empty_file: "That file is empty.",
  image_store_unavailable: "Picture storage is down. The question is saved without a picture.",
};

type PanelProps = {
  deckId: string;
  number: number;
  draft: Draft;
  onChange: (draft: Draft) => void;
  onRemove: () => void;
  report: (message: StatusMessage) => void;
};

function QuestionPanel({ deckId, number: position, draft, onChange, onRemove, report }: PanelProps) {
  const uid = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const set = (patch: Partial<Draft>): void => onChange({ ...draft, ...patch });
  const fieldId = (name: string): string => `${uid}-${name}`;
  const text = (name: keyof Draft, label: string, errorKey: string, type = "text") => (
    <Field id={fieldId(name)} label={label} error={errors[errorKey]}>
      <input id={fieldId(name)} type={type} value={String(draft[name])} onChange={(event) => set({ [name]: event.target.value })} {...describedBy(fieldId(name), errors[errorKey])} />
    </Field>
  );

  async function save(): Promise<void> {
    report({ tone: "pending", text: "Saving…" });
    setErrors({});
    try {
      const path = draft.id ? `/api/decks/${deckId}/questions/${draft.id}` : `/api/decks/${deckId}/questions`;
      const body = draft.id ? { ...bodyFrom(draft), version: draft.version } : bodyFrom(draft);
      const { question } = await api(path, { method: draft.id ? "PUT" : "POST", body, schema: questionReply });
      onChange({ ...draft, id: question.id, version: question.version, image: question.image });
      report({ tone: "success", text: "Saved" });
    } catch (error) {
      setErrors(fieldErrors(error));
      const code = error instanceof ApiFailure ? error.body.error : "";
      report({
        tone: "error",
        text: code === "version_conflict" ? "A newer version was saved elsewhere. Reload to see it." : code === "deck_full" ? "A deck holds at most 50 questions." : "Check the highlighted fields.",
      });
    }
  }

  async function attach(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !draft.id) return;
    report({ tone: "pending", text: "Uploading picture…" });
    try {
      const { question } = await upload(`/api/decks/${deckId}/questions/${draft.id}/image`, file, questionReply);
      onChange({ ...draft, version: question.version, image: question.image });
      report({ tone: "success", text: "Picture attached" });
    } catch (error) {
      const code = error instanceof ApiFailure ? error.body.error : "";
      report({ tone: "error", text: pictureCopy[code] ?? "The picture could not be uploaded. Try again." });
    }
  }

  async function removePicture(): Promise<void> {
    report({ tone: "pending", text: "Removing picture…" });
    try {
      await api(`/api/decks/${deckId}/questions/${draft.id}/image`, { method: "DELETE" });
      const { deck } = await api(`/api/decks/${deckId}`, { schema: deckReply });
      const fresh = deck.questions.find((q) => q.id === draft.id);
      onChange({ ...draft, image: null, version: fresh?.version ?? draft.version });
      report({ tone: "success", text: "Picture removed" });
    } catch (error) {
      const code = error instanceof ApiFailure ? error.body.error : "";
      report({ tone: "error", text: pictureCopy[code] ?? "The picture could not be removed. Try again." });
    }
  }

  async function remove(): Promise<void> {
    if (draft.id) {
      try {
        await api(`/api/decks/${deckId}/questions/${draft.id}`, { method: "DELETE" });
      } catch {
        report({ tone: "error", text: "The question could not be deleted. Try again." });
        return;
      }
    }
    onRemove();
  }

  return (
    <div role="group" aria-labelledby={fieldId("heading")} className="question panel">
      <h2 id={fieldId("heading")} className="question-heading">
        Question {position}
      </h2>
      <div className="question-body">
        <div className="question-fields">
          <Field id={fieldId("type")} label="Question type" error={errors["type"]}>
            <select id={fieldId("type")} value={draft.type} onChange={(event) => set({ type: event.target.value as QuestionType })}>
              {(Object.keys(typeLabels) as QuestionType[]).map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={fieldId("prompt")} label="Prompt" error={errors["prompt"]}>
            <textarea id={fieldId("prompt")} rows={2} value={draft.prompt} onChange={(event) => set({ prompt: event.target.value })} {...describedBy(fieldId("prompt"), errors["prompt"])} />
          </Field>
          {text("seconds", "Time limit (seconds)", "timeLimitSeconds", "number")}
          {draft.type === "multiple_choice" ? (
            <div className="options">
              {LETTERS.map((letter, index) => (
                <div key={letter} className="option-row">
                  <input
                    type="radio"
                    className="correct-radio"
                    name={fieldId("correct")}
                    aria-label={`Correct: ${letter}`}
                    checked={draft.correct === index}
                    onChange={() => set({ correct: index })}
                  />
                  <Field id={fieldId(`option-${letter}`)} label={`Option ${letter}`} error={index === 0 ? errors["options"] : undefined}>
                    <input
                      id={fieldId(`option-${letter}`)}
                      value={draft.options[index] ?? ""}
                      onChange={(event) => set({ options: draft.options.map((value, i) => (i === index ? event.target.value : value)) })}
                    />
                  </Field>
                </div>
              ))}
              {errors["correctIndex"] ? <p className="field-error">{errors["correctIndex"]}</p> : null}
            </div>
          ) : null}
          {draft.type === "estimate" ? (
            <div className="estimate-grid">
              {text("min", "Minimum", "min", "number")}
              {text("max", "Maximum", "max", "number")}
              {text("step", "Step", "step", "number")}
              {text("answer", "Correct value", "answer", "number")}
              {text("tolerance", "Tolerance", "tolerance", "number")}
              {text("unit", "Unit", "unit")}
            </div>
          ) : null}
          {draft.type === "sequence" ? (
            <div className="items">
              {Array.from({ length: ITEM_FIELDS }, (_, index) => (
                <Field key={index} id={fieldId(`item-${index + 1}`)} label={`Item ${index + 1}`} error={index === 0 ? errors["items"] : undefined}>
                  <input
                    id={fieldId(`item-${index + 1}`)}
                    value={draft.items[index] ?? ""}
                    onChange={(event) => set({ items: draft.items.map((value, i) => (i === index ? event.target.value : value)) })}
                  />
                </Field>
              ))}
            </div>
          ) : null}
        </div>
        <div className="picture-area">
          <label className="button picture-pick" htmlFor={fieldId("picture")} aria-disabled={draft.id === null}>
            <Upload size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>Picture for question {position}</span>
            <input id={fieldId("picture")} type="file" className="visually-hidden" disabled={draft.id === null} onChange={(event) => void attach(event)} />
          </label>
          <p className="picture-state">{draft.image ? "Picture attached" : "No picture"}</p>
          {draft.id === null ? <p className="muted">Save the question to add a picture.</p> : null}
          {draft.image ? (
            <>
              <img className="picture-thumb" src={draft.image.previewUrl} alt={`Picture for question ${position}`} width={160} height={120} />
              <button type="button" onClick={() => void removePicture()}>
                <ImageOff size={18} strokeWidth={1.75} aria-hidden="true" />
                Remove picture
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="question-actions">
        <button type="button" className="button-primary" onClick={() => void save()}>
          Save question
        </button>
        {confirming ? (
          <span className="confirm-delete">
            <span>Delete this question?</span>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button type="button" onClick={() => void remove()}>
              Delete
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => (draft.id ? setConfirming(true) : void remove())}>
            <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
            Delete question
          </button>
        )}
      </div>
    </div>
  );
}

export function DeckEditor() {
  const { deckId = "" } = useParams();
  const [deck, setDeck] = useState<Deck | "missing" | null>(null);
  const [title, setTitle] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [titleErrors, setTitleErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<StatusMessage>({ tone: "idle", text: "" });

  useEffect(() => {
    api(`/api/decks/${deckId}`, { schema: deckReply }).then(
      ({ deck: loaded }) => {
        setDeck(loaded);
        setTitle(loaded.title);
        setDrafts(loaded.questions.map(draftFrom));
      },
      (error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) setDeck("missing");
      },
    );
  }, [deckId]);

  if (deck === "missing") return <HostShell><div className="page"><h1>Not found</h1></div></HostShell>;
  if (deck === null) return <HostShell><div className="page"><div className="skeleton" aria-busy="true" /></div></HostShell>;

  async function saveTitle(): Promise<void> {
    if (deck === null || deck === "missing") return;
    setMessage({ tone: "pending", text: "Saving…" });
    setTitleErrors({});
    try {
      const { deck: saved } = await api(`/api/decks/${deckId}`, { method: "PATCH", body: { title, version: deck.version }, schema: deckReply });
      setDeck({ ...deck, version: saved.version, title: saved.title });
      setMessage({ tone: "success", text: "Saved" });
    } catch (error) {
      setTitleErrors(fieldErrors(error));
      const code = error instanceof ApiFailure ? error.body.error : "";
      setMessage({ tone: "error", text: code === "version_conflict" ? "A newer version was saved elsewhere. Reload to see it." : "Check the deck title." });
    }
  }

  return (
    <HostShell>
      <div className="page editor">
        <p>
          <Link to="/host">All decks</Link>
        </p>
        <div className="title-row">
          <Field id="deck-title" label="Deck title" error={titleErrors["title"]}>
            <input id="deck-title" value={title} onChange={(event) => setTitle(event.target.value)} {...describedBy("deck-title", titleErrors["title"])} />
          </Field>
          <button type="button" onClick={() => void saveTitle()}>
            Save title
          </button>
        </div>
        <Status name="Editor status" message={message.text} tone={message.tone} />
        {drafts.map((draft, index) => (
          <QuestionPanel
            key={draft.key}
            deckId={deckId}
            number={index + 1}
            draft={draft}
            report={setMessage}
            onChange={(next) => setDrafts((all) => all.map((d) => (d.key === draft.key ? next : d)))}
            onRemove={() => setDrafts((all) => all.filter((d) => d.key !== draft.key))}
          />
        ))}
        <button type="button" className="add-question" onClick={() => setDrafts((all) => [...all, blankDraft(`new-${Date.now()}-${all.length}`)])}>
          <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
          Add question
        </button>
      </div>
    </HostShell>
  );
}
