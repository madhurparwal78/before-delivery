import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import type { EntryFields, Technique } from "../../shared/api";
import { COPY } from "../copy";
import { MicIcon, StopIcon } from "../ui/icons";
import type { KeptMemo } from "./device";

export interface Draft {
  fields: EntryFields;
  memo: KeptMemo | null;
}

const TECHNIQUES: { value: Technique; label: string }[] = [
  { value: "none", label: "None" },
  { value: "mild", label: "MILD" },
  { value: "ssild", label: "SSILD" },
];

const whole = (value: string): number => (value.trim() === "" ? Number.NaN : Number(value));

interface Recording {
  recorder: MediaRecorder;
  startedAt: number;
  finished: Promise<Blob>;
}

interface NewEntryProps {
  initial: Draft | null;
  techniqueUnlocked: boolean;
  titleRef: RefObject<HTMLInputElement | null>;
  focusTitle: boolean;
  onSave: (draft: Draft) => Promise<void>;
}

/** The new-entry form. A recording attaches to the entry being written and uploads after the entry is saved. */
export function NewEntry({ initial, techniqueUnlocked, titleRef, focusTitle, onSave }: NewEntryProps) {
  const ids = { title: useId(), text: useId(), recalled: useId(), minutes: useId(), heading: useId() };
  const [title, setTitle] = useState(initial?.fields.title ?? "");
  const [text, setText] = useState(initial?.fields.text ?? "");
  const [recalled, setRecalled] = useState(String(initial?.fields.dreams_recalled ?? 1));
  const [lucid, setLucid] = useState(initial?.fields.lucid ?? false);
  const [wbtb, setWbtb] = useState(initial?.fields.wbtb ?? false);
  const [technique, setTechnique] = useState<Technique>(initial?.fields.technique ?? "none");
  const [minutes, setMinutes] = useState(String(initial?.fields.technique_minutes ?? 0));
  const [recording, setRecording] = useState<Recording | null>(null);
  const [memoNote, setMemoNote] = useState(initial?.memo ? "Voice memo attached." : "");
  const memo = useRef<Promise<KeptMemo | null>>(Promise.resolve(initial?.memo ?? null));

  useEffect(() => {
    if (focusTitle) titleRef.current?.focus();
  }, [focusTitle, titleRef]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const finished = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          for (const track of stream.getTracks()) track.stop();
          resolve(new Blob(chunks, { type: recorder.mimeType }));
        };
      });
      recorder.start();
      setRecording({ recorder, startedAt: performance.now(), finished });
      setMemoNote("Recording.");
    } catch {
      setMemoNote("The microphone is not available.");
    }
  };

  const stopRecording = (active: Recording) => {
    const durationMs = Math.max(1, Math.round(performance.now() - active.startedAt));
    active.recorder.stop();
    memo.current = active.finished.then((blob) => ({ blob, type: blob.type || active.recorder.mimeType || "audio/webm", durationMs }));
    setRecording(null);
    setMemoNote("Voice memo attached.");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (recording) stopRecording(recording);
    const attached = await memo.current;
    const fields: EntryFields = {
      title,
      text,
      dreams_recalled: whole(recalled),
      lucid,
      wbtb: techniqueUnlocked && wbtb,
      technique: techniqueUnlocked ? technique : "none",
      technique_minutes: techniqueUnlocked ? whole(minutes) : 0,
    };
    setTitle("");
    setText("");
    setRecalled("1");
    setLucid(false);
    setWbtb(false);
    setTechnique("none");
    setMinutes("0");
    setMemoNote("");
    memo.current = Promise.resolve(null);
    await onSave({ fields, memo: attached });
  };

  return (
    <form className="new-entry panel" aria-labelledby={ids.heading} onSubmit={(event) => void submit(event)}>
      <h2 id={ids.heading} className="visually-hidden">
        New entry
      </h2>
      <div className="field">
        <label htmlFor={ids.title}>Dream title</label>
        <input ref={titleRef} id={ids.title} className="input" value={title} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.text}>Dream text</label>
        <textarea id={ids.text} className="input" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="new-entry-row">
        <div className="field">
          <label htmlFor={ids.recalled}>Dreams recalled</label>
          <input id={ids.recalled} className="input" type="number" inputMode="numeric" min={0} max={20} step={1} value={recalled} onChange={(e) => setRecalled(e.target.value)} />
        </div>
        <label className="choice">
          <input type="checkbox" checked={lucid} onChange={(e) => setLucid(e.target.checked)} />
          Lucid
        </label>
      </div>
      {techniqueUnlocked ? (
        <div className="technique">
          <label className="choice">
            <input type="checkbox" checked={wbtb} onChange={(e) => setWbtb(e.target.checked)} />
            Woke for WBTB
          </label>
          <div role="radiogroup" aria-label="Technique" className="field">
            <span className="label" aria-hidden="true">
              Technique
            </span>
            <div className="choices">
              {TECHNIQUES.map((option) => (
                <label key={option.value} className="choice">
                  <input type="radio" name="technique" value={option.value} checked={technique === option.value} onChange={() => setTechnique(option.value)} />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
          <div className="field" style={{ maxWidth: "12rem" }}>
            <label htmlFor={ids.minutes}>Technique minutes</label>
            <input id={ids.minutes} className="input" type="number" inputMode="numeric" min={0} max={180} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
        </div>
      ) : (
        <p className="hint">{COPY.techniqueLocked}</p>
      )}
      <div className="form-actions">
        <button type="button" className="button quiet" onClick={() => (recording ? stopRecording(recording) : void startRecording())}>
          {recording ? <StopIcon /> : <MicIcon />}
          {recording ? "Stop recording" : "Record voice memo"}
        </button>
        <button type="submit" className="button primary">
          Save entry
        </button>
        <span className="recording" aria-live="polite">
          {memoNote}
        </span>
      </div>
    </form>
  );
}
