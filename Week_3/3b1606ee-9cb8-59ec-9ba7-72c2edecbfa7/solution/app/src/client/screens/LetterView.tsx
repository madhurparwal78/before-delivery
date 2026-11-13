import { useLayoutEffect, useRef, useState } from 'react';
import { localPictures, fetchAttachment } from '../lib/attachments';
import { arrive, sendMotionFor, unfold } from '../lib/motion';
import { retryUpload } from '../store/outbox';
import { postmarkOf } from '../store/selectors';
import { fileSize } from '../lib/format';
import type { Attachment, LocalLetter } from '../types';
import { FileGlyph } from '../ui/icons';
import { Postmark } from '../ui/Postmark';
import { useFetched } from '../ui/useFetched';
import { Dialog, useDialogClose } from '../ui/Dialog';

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
const UPLOAD_FAILED = "Couldn't upload. Your letter wasn't sent.";

/** A letter's thumbnail is base64url JPEG; as a data URL it needs the standard alphabet. */
function thumbSrc(thumb: string | undefined): string | null {
  return thumb ? `data:image/jpeg;base64,${thumb.replace(/-/g, '+').replace(/_/g, '/')}` : null;
}

function PhotoViewer({ url, alt }: { url: string; alt: string }) {
  const close = useDialogClose();
  return (
    <>
      <img className="viewer__image" src={url} alt={alt} />
      <button type="button" className="button button--ink" onClick={close}>
        Close photo
      </button>
    </>
  );
}

function PhotoBox({ letter, attachment, mine, name }: { letter: LocalLetter; attachment: Attachment; mine: boolean; name: string }) {
  const local = localPictures.get(letter.id);
  const fetched = useFetched(attachment, local !== undefined);
  const [viewing, setViewing] = useState(false);
  const alt = mine ? 'Your photo' : `Photo from ${name}`;
  if (fetched !== 'loading' && fetched.status === 'corrupted') return <p className="letter__notice">Attachment corrupted</p>;
  const url = local ?? (fetched !== 'loading' && fetched.status === 'ok' ? fetched.url : null);
  const preview = thumbSrc(attachment.thumb);
  return (
    <>
      <button type="button" className="photo" aria-label="Open photo" onClick={() => setViewing(true)}>
        {preview && <img className="photo__preview" data-testid="photo-preview" src={preview} alt="" />}
        {url && <img className="photo__full" src={url} alt={alt} />}
      </button>
      {fetched !== 'loading' && fetched.status === 'unavailable' && !local && <p className="slip">This attachment can&apos;t be opened right now.</p>}
      {viewing && url && (
        <Dialog label="Photo viewer" className="dialog--viewer" onClose={() => setViewing(false)}>
          <PhotoViewer url={url} alt={alt} />
        </Dialog>
      )}
    </>
  );
}

function FileBox({ attachment }: { attachment: Attachment }) {
  const [state, setState] = useState<'idle' | 'working' | 'corrupted' | 'unavailable'>('idle');
  if (state === 'corrupted') return <p className="letter__notice">Attachment corrupted</p>;
  const download = async (): Promise<void> => {
    setState('working');
    const result = await fetchAttachment(attachment);
    if (result.status !== 'ok') {
      setState(result.status);
      return;
    }
    const link = document.createElement('a');
    link.href = result.url;
    link.download = attachment.name;
    document.body.append(link);
    link.click();
    link.remove();
    setState('idle');
  };
  return (
    <>
      <button type="button" className="filebox" aria-busy={state === 'working' || undefined} onClick={() => void download()}>
        <FileGlyph />
        <span>Download {attachment.name}</span>
        <span className="filebox__size">{fileSize(attachment.size)}</span>
      </button>
      {state === 'unavailable' && <p className="slip">This attachment can&apos;t be opened right now.</p>}
    </>
  );
}

interface LetterViewProps {
  letter: LocalLetter;
  name: string;
  unfoldNow: boolean;
  onActions: (letter: LocalLetter, opener: HTMLElement) => void;
}

/** One letter on the sheet, with its postmark, and the long press and button that open its actions. */
export function LetterView({ letter, name, unfoldNow, onActions }: LetterViewProps) {
  const article = useRef<HTMLElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLButtonElement>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const pressed = useRef(false);
  const mark = postmarkOf(letter);
  const mine = letter.direction === 'sent';
  const deleted = letter.retractedAt !== null;

  useLayoutEffect(() => {
    if (sendMotionFor(letter.id) && article.current) arrive(article.current);
    else if (unfoldNow && text.current) unfold(text.current);
    // Runs once, when the letter first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearPress = (): void => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  const body = letter.body;
  const draft = letter.draft;
  const caption = body ? (body.kind === 'file' ? '' : body.text) : (draft?.text ?? '');
  const attachment = body && body.kind !== 'text' ? body.attachment : null;
  const uploading = letter.phase === 'uploading';

  return (
    <article
      ref={article}
      className={`letter letter--${mine ? 'sent' : 'received'}`}
      data-testid="letter"
      data-letter-id={letter.id}
      data-direction={letter.direction}
      data-delivery={mark.delivery}
      onPointerDown={(event) => {
        if (deleted) return;
        pressed.current = false;
        press.current = {
          x: event.clientX,
          y: event.clientY,
          timer: setTimeout(() => {
            pressed.current = true;
            press.current = null;
            if (actions.current) onActions(letter, actions.current);
          }, LONG_PRESS_MS),
        };
      }}
      onPointerMove={(event) => {
        if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > MOVE_TOLERANCE_PX) clearPress();
      }}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={(event) => {
        if (pressed.current) event.preventDefault();
      }}
    >
      {deleted ? (
        <p className="letter__notice">{mine ? 'You deleted this letter.' : 'This letter was deleted.'}</p>
      ) : (
        <div ref={text} className="letter__body">
          {attachment && body?.kind === 'image' && (
            <PhotoBox letter={letter} attachment={attachment} mine={mine} name={name} />
          )}
          {attachment && body?.kind === 'file' && <FileBox attachment={attachment} />}
          {!attachment && letter.draft && letter.draft.kind === 'image' && (
            <span className="photo photo--waiting">
              {thumbSrc(letter.draft.thumb) && <img className="photo__preview" data-testid="photo-preview" src={thumbSrc(letter.draft.thumb)!} alt="" />}
            </span>
          )}
          {!attachment && letter.draft && letter.draft.kind === 'file' && <p className="filebox filebox--waiting">{letter.draft.name}</p>}
          {caption && <p className="letter__text">{caption}</p>}
          {uploading && <p className="letter__status">Uploading…</p>}
          {letter.phase === 'upload_failed' && (
            <>
              <p className="slip">{UPLOAD_FAILED}</p>
              <button type="button" className="button button--ink" onClick={() => retryUpload(letter.id)}>
                Retry upload
              </button>
            </>
          )}
          {letter.phase === 'refused' && <p className="slip">This letter couldn&apos;t be sent.</p>}
        </div>
      )}
      <footer className="letter__foot">
        {!deleted && <Postmark letterId={letter.id} label={mark.label} time={mark.time} />}
        {!deleted && (
          <button ref={actions} type="button" className="button button--link" onClick={(event) => onActions(letter, event.currentTarget)}>
            Letter actions
          </button>
        )}
      </footer>
    </article>
  );
}
