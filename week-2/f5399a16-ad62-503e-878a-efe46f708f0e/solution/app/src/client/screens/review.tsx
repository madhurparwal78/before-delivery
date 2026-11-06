// The producer's review page: steps, film strip, pins, the Notes sheet and sending once.

import { useEffect, useRef, useState } from 'react';
import { fill, PRIVATE_COPY, type Language } from '../../shared/copy';
import { roundToTenth, type FrameRate } from '../../shared/timecode';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import { isRtl } from '../motion';
import { AsyncButton, BottomBar, Heading, LoadingBars, NotFound, Problems, TextArea, TextField, classOf, useForm } from '../ui/kit';
import { Overlay, useDialog } from '../ui/overlay';
import { clipUnder, Strip, usePlayback, type StripClip } from '../ui/strip';
import { EndedPage, pageLanguage, PrivateShell } from './private';

interface ReviewRead {
  language: Language;
  jobTitle: string;
  cut: number;
  frameRate: FrameRate;
  aspect: string;
  dueDate: string;
  endsAt: string;
  name: string | null;
  frames: { number: number; position: number; durationFrames: number; timecodeIn: string; actionNote: string; drawingUrl: string | null }[];
  notes: { id: string; frame: number; x: number; y: number; text: string; suggestedSeconds: string | null; suggestedFrames: number | null; attachmentUrl: string | null; createdAt: string }[];
}

interface DraftNote {
  frame: number;
  x: number;
  y: number;
  text: string;
  length: string;
  attachmentId: string | null;
}

interface Draft {
  notes: DraftNote[];
  current: DraftNote | null;
  name: string;
  sendKey: string;
}

function newKey(): string {
  return crypto.randomUUID();
}

function storageKey(token: string): string {
  return `clapstick.review.${token}`;
}

/** The draft on this device. A refusing device works the same and says so. */
function loadDraft(token: string): { draft: Draft; refused: boolean } {
  const empty: Draft = { notes: [], current: null, name: '', sendKey: newKey() };
  try {
    const raw = localStorage.getItem(storageKey(token));
    return { draft: raw ? { ...empty, ...(JSON.parse(raw) as Draft) } : empty, refused: false };
  } catch {
    return { draft: empty, refused: true };
  }
}

function saveDraft(token: string, draft: Draft): boolean {
  try {
    localStorage.setItem(storageKey(token), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function tenth(value: number): number {
  return roundToTenth(Math.max(0, Math.min(100, value)));
}

const STEPS = ['frames', 'notes', 'send'] as const;
type Step = (typeof STEPS)[number];

export function ReviewPage({ token }: { token: string }) {
  const language = pageLanguage();
  const copy = PRIVATE_COPY[language];
  const live = useLive(() => api<ReviewRead>(`/api/r/${token}`));
  const [step, setStep] = useState<Step>('frames');
  const [position, setPosition] = useState(0);
  const [loaded] = useState(() => loadDraft(token));
  const [draft, setDraft] = useState<Draft>(loaded.draft);
  const [refused, setRefused] = useState(loaded.refused);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null);
  const [lengthFrames, setLengthFrames] = useState<number | null>(null);
  const sheet = useDialog('reviewNotes');
  const pinButton = useRef<HTMLButtonElement>(null);
  const stepButtons = useRef(new Map<Step, HTMLButtonElement>());
  const form = useForm(null, () => ({ name: loaded.draft.name }));
  const noteForm = useForm(null, () => ({ text: loaded.draft.current?.text ?? '', length: loaded.draft.current?.length ?? '' }), { focusMessage: true });
  const noteFocusStep = useRef(false);
  const [sent, setSent] = useState(false);

  const data = live.data;
  const clips: StripClip[] = (data?.frames ?? []).map((frame) => ({ number: frame.number, durationFrames: frame.durationFrames, drawingUrl: frame.drawingUrl }));
  const total = clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
  const shown = Math.min(position, Math.max(0, total - 1));
  const { playing, toggle } = usePlayback(data?.frameRate ?? '25', total, shown, setPosition);

  useEffect(() => {
    if (!saveDraft(token, draft)) setRefused(true);
  }, [draft, token]);

  useEffect(() => {
    if (noteFocusStep.current) {
      noteFocusStep.current = false;
      stepButtons.current.get(step)?.focus();
    }
  }, [step]);

  if (live.failedStatus === 410) return <EndedPage token={token} canAsk />;
  if (live.failedStatus === 404) return <NotFound />;
  if (!data) return <PrivateShell copy={copy}><LoadingBars /></PrivateShell>;

  const frame = clipUnder(clips, shown)?.clip ?? null;
  const frameData = data.frames.find((held) => held.number === frame?.number);
  const rtl = isRtl();

  const placePin = (x: number, y: number) => {
    if (!frame) return;
    const current: DraftNote = { frame: frame.number, x: tenth(x), y: tenth(y), text: noteForm.values.text, length: noteForm.values.length, attachmentId: draft.current?.attachmentId ?? null };
    setDraft((held) => ({ ...held, current }));
    pinButton.current?.focus({ preventScroll: true });
    sheet.show();
  };

  const updateCurrent = (changes: Partial<DraftNote>) => {
    setDraft((held) => {
      const base = held.current ?? (frame ? { frame: frame.number, x: 50, y: 50, text: '', length: '', attachmentId: null } : null);
      return base ? { ...held, current: { ...base, ...changes } } : held;
    });
  };

  const noteBound = {
    ...noteForm,
    set: (name: string, value: unknown) => {
      noteForm.set(name as 'text', value);
      updateCurrent({ [name]: value } as Partial<DraftNote>);
      if (name === 'length') setLengthFrames(null);
    },
  };

  const checkLength = async (): Promise<boolean> => {
    const typed = noteForm.values.length.trim();
    if (!typed) {
      setLengthFrames(null);
      return true;
    }
    try {
      const answer = await api<{ seconds: string; frames: number }>(`/api/r/${token}/length`, { method: 'POST', body: { length: typed } });
      setLengthFrames(answer.frames);
      noteForm.clear();
      return true;
    } catch (error) {
      if (error instanceof ApiError) noteForm.refuse(error.message, error.fields);
      return false;
    }
  };

  const addNote = async () => {
    if (!noteForm.values.text.trim()) {
      noteForm.refuse(copy.emptyNote, { text: copy.emptyNote });
      return;
    }
    if (!(await checkLength())) return;
    const base = draft.current ?? { frame: frame?.number ?? 0, x: 50, y: 50, text: '', length: '', attachmentId: null };
    const note: DraftNote = { ...base, text: noteForm.values.text, length: noteForm.values.length };
    setDraft((held) => ({ ...held, notes: [...held.notes, note], current: null }));
    noteForm.setAll({ text: '', length: '' });
    setLengthFrames(null);
    noteForm.clear();
    sheet.hide();
  };

  const attach = async (file: File) => {
    try {
      const answer = await api<{ attachmentId: string }>(`/api/r/${token}/attachments`, { method: 'POST', file });
      updateCurrent({ attachmentId: answer.attachmentId });
      noteForm.clear();
    } catch (error) {
      if (error instanceof ApiError) noteForm.refuse(error.message, { attachment: error.message });
    }
  };

  const send = () =>
    form.submit(async () => {
      const name = data.name ? null : form.values.name;
      if (!data.name && !form.values.name.trim()) {
        form.refuse(copy.emptyName, { name: copy.emptyName });
        return;
      }
      if (!draft.notes.length) {
        form.refuse(copy.emptyNote);
        return;
      }
      await api(`/api/r/${token}/notes`, {
        method: 'POST',
        body: {
          sendKey: draft.sendKey,
          name,
          notes: draft.notes.map((note) => ({ frame: note.frame, x: note.x, y: note.y, text: note.text, suggestedLength: note.length || null, attachmentId: note.attachmentId })),
        },
      });
      setDraft({ notes: [], current: null, name: '', sendKey: newKey() });
      await live.reload();
      setSent(true);
      announce(copy.notesSent);
    });

  const onStepKey = (event: React.KeyboardEvent) => {
    const at = STEPS.indexOf(step);
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next: number | null = null;
    if (event.key === forward) next = Math.min(STEPS.length - 1, at + 1);
    if (event.key === backward) next = Math.max(0, at - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = STEPS.length - 1;
    if (next === null) return;
    event.preventDefault();
    noteFocusStep.current = true;
    setStep(STEPS[next] as Step);
    if (STEPS[next] === step) stepButtons.current.get(step)?.focus();
  };

  const stepLabel: Record<Step, string> = { frames: copy.stepFrames, notes: copy.stepNotes, send: copy.stepSend };
  const at = STEPS.indexOf(step);
  const pins = [
    ...data.notes.filter((note) => note.frame === frame?.number).map((note) => ({ key: note.id, x: note.x, y: note.y })),
    ...draft.notes.filter((note) => note.frame === frame?.number).map((note, index) => ({ key: `draft-${index}`, x: note.x, y: note.y })),
    ...(draft.current && draft.current.frame === frame?.number ? [{ key: 'current', x: draft.current.x, y: draft.current.y }] : []),
  ];
  const countText = lengthFrames === null ? null : lengthFrames === 1 ? copy.lengthOneFrame : fill(copy.lengthFrames, { count: lengthFrames });
  const noteList = [
    ...data.notes.map((note) => ({ key: note.id, frame: note.frame, text: note.text })),
    ...draft.notes.map((note, index) => ({ key: `draft-${index}`, frame: note.frame, text: note.text })),
  ];

  return (
    <PrivateShell copy={copy}>
      <Heading title={fill(copy.reviewHeading, { title: data.jobTitle })} refreshFailed={live.refreshFailed} />
      {refused ? <p className="notice">{copy.draftRefused}</p> : null}
      <div role="group" aria-label={copy.steps} className="steps" onKeyDown={onStepKey}>
        {STEPS.map((name) => (
          <button
            key={name}
            ref={(element) => { if (element) stepButtons.current.set(name, element); }}
            type="button"
            className="step"
            aria-current={step === name ? 'step' : undefined}
            tabIndex={step === name ? 0 : -1}
            onClick={() => setStep(name)}
          >
            {stepLabel[name]}
          </button>
        ))}
      </div>
      {step === 'frames' ? (
        <>
          {clips.length ? (
            <Strip
              clips={clips}
              rate={data.frameRate}
              position={shown}
              onPosition={setPosition}
              groupLabel={copy.filmStrip}
              clipLabel={(number) => fill(copy.clip, { number })}
              motion=""
              onTogglePlay={toggle}
            />
          ) : null}
          <div className="tools strip-tools">
            <button type="button" className="btn btn-plain" onClick={() => setPosition(Math.max(0, shown - 1))}>{copy.earlier}</button>
            <button type="button" className="btn btn-plain" onClick={toggle}>{playing ? copy.pause : copy.play}</button>
            <button type="button" className="btn btn-plain" onClick={() => setPosition(Math.min(total - 1, shown + 1))}>{copy.later}</button>
          </div>
          <div
            className="frame-view"
            data-part="frame-view"
            dir="ltr"
            style={{ aspectRatio: data.aspect.replace(':', ' / ') }}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              placePin(((event.clientX - box.left) / box.width) * 100, ((event.clientY - box.top) / box.height) * 100);
            }}
          >
            {frameData?.drawingUrl ? <img src={frameData.drawingUrl} alt="" draggable={false} /> : <div className="slate-empty" />}
            {pins.map((pin) => <span key={pin.key} className="pin" data-part="pin" data-x={pin.x} data-y={pin.y} style={{ left: `${pin.x}%`, top: `${pin.y}%` }} />)}
            {crosshair ? <span className="crosshair" data-part="crosshair" data-x={crosshair.x} data-y={crosshair.y} style={{ left: `${crosshair.x}%`, top: `${crosshair.y}%` }} /> : null}
          </div>
          {frameData ? <p className="frame-caption-line"><span className="tabular" dir="ltr">{frameData.timecodeIn}</span> {frameData.actionNote}</p> : null}
          <div className="tools">
            <button
              ref={pinButton}
              type="button"
              className="btn btn-ink"
              onClick={(event) => {
                event.currentTarget.focus();
                setCrosshair({ x: 50, y: 50 });
              }}
              onKeyDown={(event) => {
                if (!crosshair) return;
                const by = event.shiftKey ? 10 : 1;
                const delta: Record<string, [number, number]> = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by] };
                const move = delta[event.key];
                if (move) {
                  event.preventDefault();
                  setCrosshair({ x: tenth(crosshair.x + move[0]), y: tenth(crosshair.y + move[1]) });
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  setCrosshair(null);
                  placePin(crosshair.x, crosshair.y);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setCrosshair(null);
                }
              }}
            >
              {copy.placePin}
            </button>
            <button type="button" className="btn btn-plain" onClick={sheet.show}>{copy.openSheet}</button>
          </div>
        </>
      ) : null}
      {step === 'notes' ? (
        <>
          <ul className="plain-list">
            {noteList.map((note) => <li key={note.key}><strong className="tabular" dir="ltr">{note.frame}</strong> {note.text}</li>)}
          </ul>
          <div className="tools">
            <button type="button" className="btn btn-plain" onClick={sheet.show}>{copy.openSheet}</button>
          </div>
        </>
      ) : null}
      {step === 'send' ? (
        <>
          <Problems form={form} />
          {sent ? <p className="signed-line">{copy.notesSent}</p> : null}
          {data.name ? null : (
            <TextField
              form={{ ...form, set: (name: string, value: unknown) => { form.set(name as 'name', value); setDraft((held) => ({ ...held, name: value as string })); } }}
              name="name"
              label={copy.nameField}
              autoComplete="name"
            />
          )}
        </>
      ) : null}
      <BottomBar>
        {at > 0 ? <button type="button" className="btn btn-plain" onClick={() => setStep(STEPS[at - 1] as Step)}>{copy.back}</button> : null}
        {step === 'send' ? (
          <AsyncButton label={copy.sendNotes} onPress={send} />
        ) : (
          <button type="button" className={classOf('primary')} onClick={() => setStep(STEPS[at + 1] as Step)}>{copy.next}</button>
        )}
      </BottomBar>
      <Overlay state={sheet} title={copy.stepNotes} sheet closeLabel={copy.close}>
        <Problems form={noteForm} />
        <TextArea form={noteBound} name="text" label={copy.noteField} onBlur={() => undefined} />
        <TextField form={noteBound} name="length" label={copy.lengthField} inputMode="decimal" onBlur={() => void checkLength()} />
        {countText ? <p className="tabular length-count">{countText}</p> : null}
        <div className="field">
          <label className="btn btn-plain file-button">
            {copy.attachment}
            <input
            id={noteForm.fieldId('attachment')}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg"
            aria-invalid={noteForm.fields.attachment ? true : undefined}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void attach(file);
              event.target.value = '';
            }}
            />
          </label>
        </div>
        <AsyncButton label={copy.addNote} onPress={addNote} />
      </Overlay>
    </PrivateShell>
  );
}
