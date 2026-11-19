import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { announce } from '../../announce';
import { ApiError, api, newIdempotencyKey } from '../../api';
import { useConfig } from '../../clock';
import { countCodePoints, formatCount } from '../../format';
import type { Network, PersonCard, Post } from '../../types';
import { Alert, Button, Dialog, Field } from '../../ui';
import { SharedPost } from './SharedPost';
import './feed.css';

const MAX_SUGGESTIONS = 5;
const FRAGMENT = /(^|\s)@(\S+)$/;
const GENERIC_FAILURE = 'Something went wrong. Try again.';

type Photo = { state: 'none' } | { state: 'uploading' } | { state: 'attached'; id: string; url: string };

interface ComposerProps {
  open: boolean;
  onClose: () => void;
  /** The original being reposted with thoughts. */
  shared?: Post | null;
  /** Where focus goes when the dialog closes, when not the control that opened it. */
  returnFocus?: () => HTMLElement | null;
  onPublished: (post: Post) => void;
}

/** The mention fragment before the caret: from `@` to the caret, when `@` starts the text or follows whitespace. */
function fragmentBefore(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = FRAGMENT.exec(before);
  return match ? { start: match.index + (match[1] ?? '').length, query: match[2] ?? '' } : null;
}

export function Composer({ open, onClose, shared, returnFocus, onPublished }: ComposerProps) {
  const config = useConfig();
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [photo, setPhoto] = useState<Photo>({ state: 'none' });
  const [suggestions, setSuggestions] = useState<PersonCard[]>([]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const box = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const addPhoto = useRef<HTMLButtonElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const submitKey = useRef(newIdempotencyKey());
  const lookup = useRef(0);
  const listId = useId();

  const fragment = fragmentBefore(text, caret);
  const listOpen = open && !dismissed && fragment !== null && suggestions.length > 0;
  const used = countCodePoints(text);
  const over = used - config.post_max_chars;
  const blank = text.trim() === '';

  useEffect(() => {
    if (!open) return;
    setText('');
    setCaret(0);
    setPhoto({ state: 'none' });
    setSuggestions([]);
    setProblem(null);
    setFieldError(undefined);
    setPending(false);
    submitKey.current = newIdempotencyKey();
  }, [open]);

  useEffect(() => {
    setDismissed(false);
    setActive(0);
  }, [fragment?.start, fragment?.query]);

  useEffect(() => {
    if (!open || !fragment) {
      setSuggestions([]);
      return;
    }
    const ticket = ++lookup.current;
    const typed = fragment.query.toLowerCase();
    const startsWithTyped = (member: PersonCard): boolean =>
      member.handle.startsWith(typed) || member.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(typed));
    void api
      .get<Network>('/api/network')
      .then((network) => {
        if (ticket !== lookup.current) return;
        const matches = network.connections.filter(startsWithTyped);
        matches.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        setSuggestions(matches.slice(0, MAX_SUGGESTIONS));
      })
      .catch(() => {
        if (ticket === lookup.current) setSuggestions([]);
      });
  }, [open, fragment?.start, fragment?.query]);

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && box.current) {
      box.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const edit = (value: string, position: number): void => {
    setText(value);
    setCaret(position);
    setProblem(null);
    setFieldError(undefined);
    submitKey.current = newIdempotencyKey();
  };

  const choose = (member: PersonCard): void => {
    if (!fragment) return;
    const replacement = `@${member.handle} `;
    const next = text.slice(0, fragment.start) + replacement + text.slice(caret);
    pendingCaret.current = fragment.start + replacement.length;
    edit(next, pendingCaret.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (listOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current) => (current + step + suggestions.length) % suggestions.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const member = suggestions[active];
        if (member) choose(member);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
      } else if (event.key === 'Tab') {
        setDismissed(true);
      }
    }
  };

  const syncCaret = (target: HTMLTextAreaElement): void => setCaret(target.selectionStart);

  const chosePhoto = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProblem(null);
    setPhoto({ state: 'uploading' });
    announce('Feed announcements', 'Uploading…');
    try {
      const stored = await api.upload<{ photo_id: string; url: string }>('/api/uploads/photo', file, file.name);
      setPhoto({ state: 'attached', id: stored.photo_id, url: stored.url });
      announce('Feed announcements', 'Photo attached.');
    } catch (error) {
      setPhoto({ state: 'none' });
      setProblem(photoProblem(error, config.photo_max_bytes));
    }
  };

  const publish = async (): Promise<void> => {
    setPending(true);
    setProblem(null);
    setFieldError(undefined);
    const body: { text: string; photo_id?: string; shared_post_id?: string } = { text };
    if (photo.state === 'attached') body.photo_id = photo.id;
    if (shared) body.shared_post_id = shared.id;
    try {
      const created = await api.post<Post>('/api/posts', body, { idempotencyKey: submitKey.current });
      announce('Feed announcements', 'Post published.');
      submitKey.current = newIdempotencyKey();
      onClose();
      onPublished(created);
    } catch (error) {
      announce('Feed announcements', 'Post not published.');
      const message = error instanceof ApiError ? error.field('text') : undefined;
      if (message) setFieldError(message);
      else setProblem(GENERIC_FAILURE);
    } finally {
      setPending(false);
    }
  };

  const counter = over > 0 ? `${formatCount(over)} over the limit` : `${formatCount(used)} / ${formatCount(config.post_max_chars)}`;
  const canPost = !blank && over <= 0 && photo.state !== 'uploading' && !pending;

  return (
    <Dialog name="Create a post" open={open} onClose={onClose} returnFocus={returnFocus} className="composer">
      <div className="stack-s">
        {shared ? <SharedPost post={shared} /> : null}
        <div className="composer-field">
          <Field
            ref={(element) => {
              box.current = element as HTMLTextAreaElement | null;
            }}
            multiline
            name="post-text"
            label="What do you want to talk about?"
            rows={6}
            value={text}
            error={fieldError}
            aria-activedescendant={listOpen ? `${listId}-${active}` : undefined}
            aria-controls={listOpen ? listId : undefined}
            onChange={(event) => edit(event.target.value, event.target.selectionStart)}
            onKeyDown={onKeyDown}
            onKeyUp={(event) => syncCaret(event.currentTarget)}
            onClick={(event) => syncCaret(event.currentTarget)}
            onSelect={(event) => syncCaret(event.currentTarget)}
          />
          {listOpen ? (
            <ul id={listId} role="listbox" aria-label="Mention suggestions" className="mention-list plain-list">
              {suggestions.map((member, index) => (
                <li
                  key={member.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className="mention-option"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(member);
                  }}
                >
                  {`${member.name} (@${member.handle})`}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div role="status" aria-label="Character count" className={over > 0 ? 'composer-counter alert' : 'composer-counter muted'}>
          {counter}
        </div>
        {photo.state === 'uploading' ? <p>Uploading…</p> : null}
        {photo.state === 'attached' ? <img className="composer-photo" src={photo.url} alt="Attached to your post" /> : null}
        {problem ? <Alert>{problem}</Alert> : null}
        <input ref={fileInput} type="file" accept="image/jpeg,image/png" aria-label="Photo" className="sr-only" tabIndex={-1} onChange={(event) => void chosePhoto(event)} />
      </div>
      <div className="dialog-actions">
        <Button ref={addPhoto} onClick={() => fileInput.current?.click()} disabled={photo.state === 'uploading'}>
          Add a photo
        </Button>
        {photo.state === 'attached' ? (
          <Button
            onClick={() => {
              setPhoto({ state: 'none' });
              addPhoto.current?.focus();
            }}
          >
            Remove photo
          </Button>
        ) : null}
        <Button onClick={() => void publish()} disabled={!canPost}>
          Post
        </Button>
      </div>
    </Dialog>
  );
}

function photoProblem(error: unknown, fallbackLimit: number): string {
  if (error instanceof ApiError) {
    if (error.body.error === 'photo_too_large') {
      const limit = typeof error.body.limit === 'number' ? error.body.limit : fallbackLimit;
      return `Photos can be up to ${formatCount(limit)} bytes.`;
    }
    if (error.body.error === 'photo_type') return 'Choose a JPEG or PNG image.';
    if (error.body.error === 'storage_unavailable') return 'Uploads are unavailable right now. Try again later.';
  }
  return GENERIC_FAILURE;
}
