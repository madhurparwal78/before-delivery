import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { api, refusal } from '../api';
import { clearAlerts, Dialog, EmptyState, notify, raise } from '../ui';
import { randomId } from './draw';
import { useDraft } from './draft';
import type { Model } from './model';
import { useModel } from './use-model';

export function CommentDialog({ m }: { m: Model }): JSX.Element | null {
  useModel(m);
  const at = m.commentAt;
  const draft = useDraft(`comment:${m.spriteId}`);
  const key = useRef(randomId());
  const posting = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!at) return null;
  const close = (): void => {
    m.commentAt = null;
    m.changed();
  };
  const post = async (): Promise<void> => {
    if (posting.current) return;
    if (!m.online) return raise('You are offline');
    posting.current = true;
    clearAlerts();
    notify('Posting…');
    const result = await api('POST', `/api/sprites/${m.spriteId}/comments`, { frame: at.frame, x: at.x, y: at.y, text: draft.text }, { 'Idempotency-Key': key.current });
    posting.current = false;
    if (!result.ok) {
      notify('');
      const { message, fields } = refusal(result);
      setErrors(fields);
      return raise(message);
    }
    notify('Comment posted');
    await draft.reset();
    key.current = randomId();
    close();
  };
  return (
    <Dialog label="New comment" onClose={close}>
      <div class="stack">
        <h2>New comment</h2>
        <p class="muted">
          Pinned at {at.x}, {at.y} on frame {at.frame}
        </p>
        <label class="field-label">
          Comment
          <textarea class="input" rows={4} value={draft.text} onInput={(event) => draft.edit((event.currentTarget as HTMLTextAreaElement).value)} data-autofocus aria-invalid={errors.text ? 'true' : undefined} />
        </label>
        {errors.text && <p class="field-error">{errors.text}</p>}
        <div class="row">
          <button type="button" class="pill" onClick={() => void post()}>
            Post comment
          </button>
          <button type="button" class="pill ghost" onClick={close}>
            Cancel
          </button>
          <span role="status" aria-label="Draft status" class="draft-status">
            {draft.status}
          </span>
          {draft.newer && (
            <button type="button" class="pill small" onClick={draft.loadNewer}>
              Load newer
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function Comments({ m }: { m: Model }): JSX.Element {
  useModel(m);
  const move = async (id: number, action: 'resolve' | 'reopen'): Promise<void> => {
    if (!m.online) return raise('You are offline');
    clearAlerts();
    const result = await api('POST', `/api/comments/${id}/${action}`);
    if (!result.ok) raise(refusal(result).message);
  };
  return (
    <section class="panel cornflower" aria-label="Comments">
      <div class="panel-title">
        <h2>Comments</h2>
        <button
          type="button"
          class="pill"
          aria-pressed={m.pinning}
          onClick={() => {
            m.pinning = !m.pinning;
            m.changed();
          }}
        >
          Pin comment
        </button>
      </div>
      <div class="panel-body">
        {m.comments.length === 0 ? (
          <EmptyState text="No comments yet" variant={2} />
        ) : (
          <ul aria-label="Comments" class="comment-list">
            {m.comments.map((comment) => (
              <li key={comment.id} id={`comment-${comment.id}`} class="comment" data-state={comment.state}>
                <p class="comment-meta">
                  <strong>{comment.author}</strong> · frame {comment.frame} at {comment.x}, {comment.y} · {comment.state}
                </p>
                <p class="comment-text">{comment.text}</p>
                {comment.mentions.map((mention) => (
                  <p key={mention.name} class="mention">
                    {mention.state === 'delivered' ? `Delivered to ${mention.name}` : `Sending to ${mention.name}`}
                  </p>
                ))}
                {comment.state === 'open' ? (
                  <button type="button" class="pill small" onClick={() => void move(comment.id, 'resolve')}>
                    Resolve
                  </button>
                ) : (
                  <button type="button" class="pill small" onClick={() => void move(comment.id, 'reopen')}>
                    Reopen
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
