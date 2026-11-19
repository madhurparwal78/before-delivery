import { useEffect, useState } from 'react';
import { announce } from '../../announce';
import { ApiError, api } from '../../api';
import { useConfig } from '../../clock';
import { countCodePoints, formatCount } from '../../format';
import type { Post } from '../../types';
import { Alert, Button, Dialog, Field } from '../../ui';
import './feed.css';

const GENERIC_FAILURE = 'Something went wrong. Try again.';
const WINDOW_CLOSED = 'The edit window for this post has closed.';

interface EditPostDialogProps {
  post: Post;
  open: boolean;
  onClose: () => void;
  onSaved: (post: Post) => void;
}

export function EditPostDialog({ post, open, onClose, onSaved }: EditPostDialogProps) {
  const config = useConfig();
  const [text, setText] = useState(post.text);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setText(post.text);
    setProblem(null);
    setFieldError(undefined);
  }, [open]);

  const used = countCodePoints(text);
  const over = used - config.post_max_chars;

  const save = async (): Promise<void> => {
    setPending(true);
    setProblem(null);
    setFieldError(undefined);
    try {
      const saved = await api.patch<Post>(`/api/posts/${post.id}`, { text });
      announce('Feed announcements', 'Post updated.');
      onClose();
      onSaved(saved);
    } catch (error) {
      if (error instanceof ApiError && error.body.error === 'edit_window_closed') setProblem(WINDOW_CLOSED);
      else if (error instanceof ApiError && error.field('text')) setFieldError(error.field('text'));
      else setProblem(GENERIC_FAILURE);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog name="Edit post" open={open} onClose={onClose} className="composer">
      <div className="stack-s">
        <Field multiline name={`edit-${post.id}`} label="Post text" rows={6} value={text} error={fieldError} onChange={(event) => setText(event.target.value)} />
        <div role="status" aria-label="Character count" className={over > 0 ? 'composer-counter alert' : 'composer-counter muted'}>
          {over > 0 ? `${formatCount(over)} over the limit` : `${formatCount(used)} / ${formatCount(config.post_max_chars)}`}
        </div>
        {problem ? <Alert>{problem}</Alert> : null}
      </div>
      <div className="dialog-actions">
        <Button onClick={() => void save()} disabled={pending || text.trim() === '' || over > 0}>
          Save changes
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}

interface DeletePostDialogProps {
  post: Post;
  open: boolean;
  onClose: () => void;
  onDeleted: (postId: string) => void;
}

export function DeletePostDialog({ post, open, onClose, onDeleted }: DeletePostDialogProps) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) setProblem(null);
  }, [open]);

  const remove = async (): Promise<void> => {
    setPending(true);
    setProblem(null);
    try {
      await api.delete(`/api/posts/${post.id}`);
      announce('Feed announcements', 'Post deleted.');
      onClose();
      onDeleted(post.id);
    } catch {
      setProblem(GENERIC_FAILURE);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog name="Delete post?" open={open} onClose={onClose}>
      <div className="stack-s">
        <h2 className="t-larger">Delete post?</h2>
        <p>It leaves every feed, search and notification.</p>
        {problem ? <Alert>{problem}</Alert> : null}
      </div>
      <div className="dialog-actions">
        <Button onClick={() => void remove()} disabled={pending}>
          Delete
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}
