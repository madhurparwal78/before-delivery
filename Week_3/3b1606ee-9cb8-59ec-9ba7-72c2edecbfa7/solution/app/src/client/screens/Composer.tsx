import { useLayoutEffect, useRef, useState } from 'react';
import type { Conversation } from '../../shared/types';
import { localPictures } from '../lib/attachments';
import { composerFocus } from '../lib/focus';
import { codePoints, fileSize, megabytes } from '../lib/format';
import { beginSend } from '../lib/motion';
import { preparePhoto, PHOTO_TYPES } from '../lib/photo';
import { writeLetter, type PreparedAttachment } from '../store/outbox';
import { useStore } from '../store/state';
import { PaperclipGlyph, PhotoGlyph, SendGlyph } from '../ui/icons';
import { Slip } from '../ui/Field';

const MAX_LETTER = 8000;
const SEAL_TAG_BYTES = 16;

interface Chosen {
  prepared: PreparedAttachment;
  preview: string | null;
}

/** The composer in the sheet's blank lower third: a textbox, two attach buttons and Send. */
export function Composer({ conversation }: { conversation: Conversation }) {
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const well = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cap = useStore((state) => state.config!.attachment_max_bytes);
  const tooLong = codePoints(text) > MAX_LETTER;

  useLayoutEffect(() => {
    composerFocus.focus = () => area.current?.focus();
    if (composerFocus.id === conversation.id) {
      composerFocus.id = null;
      area.current?.focus();
    }
    return () => {
      composerFocus.focus = null;
    };
  }, [conversation.id]);

  function discard(): void {
    if (chosen?.preview) URL.revokeObjectURL(chosen.preview);
    setChosen(null);
  }

  function send(): void {
    if (tooLong || (text.trim() === '' && !chosen)) return;
    const body = text;
    const attachment = chosen;
    const id = writeLetter(conversation.id, body, attachment ? attachment.prepared : null);
    if (attachment?.preview) localPictures.set(id, attachment.preview);
    if (well.current) beginSend(id, conversation.id, well.current, body || attachment?.prepared.name || '');
    setText('');
    setChosen(null);
    setProblem(null);
    if (area.current) area.current.value = '';
    area.current?.focus();
  }

  async function choosePhoto(file: File): Promise<void> {
    if (!PHOTO_TYPES.includes(file.type)) {
      setProblem('Choose a JPEG, PNG or WebP photo.');
      return;
    }
    try {
      const photo = await preparePhoto(file);
      if (photo.bytes.length + SEAL_TAG_BYTES > cap) {
        setProblem(`This file is larger than ${megabytes(cap)} and can't be sent.`);
        return;
      }
      const preview = URL.createObjectURL(new Blob([photo.bytes], { type: 'image/jpeg' }));
      setProblem(null);
      discard();
      setChosen({ prepared: { kind: 'image', bytes: photo.bytes, name: file.name, type: 'image/jpeg', width: photo.width, height: photo.height, thumb: photo.thumb }, preview });
    } catch {
      setProblem('Choose a JPEG, PNG or WebP photo.');
    }
  }

  async function chooseFile(file: File): Promise<void> {
    if (file.size + SEAL_TAG_BYTES > cap) {
      setProblem(`This file is larger than ${megabytes(cap)} and can't be sent.`);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    setProblem(null);
    discard();
    setChosen({ prepared: { kind: 'file', bytes, name: file.name, type: file.type || 'application/octet-stream' }, preview: null });
  }

  const describedBy = [tooLong ? 'composer-long' : '', problem ? 'composer-problem' : ''].filter(Boolean).join(' ') || undefined;
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {chosen && (
        <div className="pinned">
          <span className="pinned__name">{chosen.prepared.name}</span>
          <span className="pinned__size">{fileSize(chosen.prepared.bytes.length)}</span>
          <button type="button" className="button button--quiet" onClick={discard}>
            Remove attachment
          </button>
        </div>
      )}
      <div ref={well} className="well well--composer">
        <textarea
          ref={area}
          aria-label="Write a letter"
          placeholder="Write a letter…"
          aria-describedby={describedBy}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
      </div>
      {tooLong && <Slip id="composer-long">Letters can be up to 8,000 characters.</Slip>}
      {problem && <Slip id="composer-problem">{problem}</Slip>}
      <div className="composer__actions">
        <button type="button" className="button button--quiet" onClick={() => photoInput.current?.click()}>
          <PhotoGlyph />
          Attach photo
        </button>
        <button type="button" className="button button--quiet" onClick={() => fileInput.current?.click()}>
          <PaperclipGlyph />
          Attach file
        </button>
        <button type="submit" className="button button--ink" disabled={tooLong}>
          <SendGlyph />
          Send
        </button>
      </div>
      <input
        ref={photoInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void choosePhoto(file);
        }}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void chooseFile(file);
        }}
      />
    </form>
  );
}

