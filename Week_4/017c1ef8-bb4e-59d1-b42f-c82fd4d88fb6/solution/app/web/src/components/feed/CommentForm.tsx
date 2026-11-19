import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { announce } from '../../announce';
import { ApiError, api, newIdempotencyKey } from '../../api';
import type { Comment } from '../../types';
import { Alert, Button, Field } from '../../ui';
import './feed.css';

const GENERIC_FAILURE = 'Something went wrong. Try again.';

interface CommentFormProps {
  postId: string;
  /** The comment being answered; a reply to a reply is stored under its top-level comment by the server. */
  parentId?: string;
  label: string;
  submitLabel: string;
  initialText?: string;
  /** Focus the text box when the form appears and each time this value changes. */
  focusSignal?: number;
  onPosted: (comment: Comment) => void;
  onEscape?: () => void;
}

/** One comment or reply box. A failed send keeps its text and focus; sending again makes one comment (same key). */
export function CommentForm({ postId, parentId, label, submitLabel, initialText = '', focusSignal = 0, onPosted, onEscape }: CommentFormProps) {
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [refocus, setRefocus] = useState(0);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const key = useRef(newIdempotencyKey());
  const name = useId();

  useEffect(() => {
    const element = box.current;
    if (!element || (focusSignal === 0 && refocus === 0)) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [focusSignal, refocus]);

  const send = async (): Promise<void> => {
    setPending(true);
    setProblem(null);
    try {
      const created = await api.post<Comment>(`/api/posts/${postId}/comments`, parentId ? { text, parent_id: parentId } : { text }, { idempotencyKey: key.current });
      announce('Feed announcements', 'Comment posted.');
      key.current = newIdempotencyKey();
      setText('');
      onPosted(created);
    } catch (error) {
      announce('Feed announcements', 'Comment not posted.');
      setProblem((error instanceof ApiError ? error.field('text') : undefined) ?? GENERIC_FAILURE);
      setRefocus((value) => value + 1);
    } finally {
      setPending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape' && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    }
  };

  return (
    <div className="comment-form stack-s">
      <Field
        ref={(element) => {
          box.current = element as HTMLTextAreaElement | null;
        }}
        multiline
        name={`comment-${name}`}
        label={label}
        rows={3}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          key.current = newIdempotencyKey();
        }}
        onKeyDown={onKeyDown}
      />
      {problem ? <Alert>{problem}</Alert> : null}
      <Button onClick={() => void send()} disabled={pending || text.trim() === ''}>
        {submitLabel}
      </Button>
    </div>
  );
}
