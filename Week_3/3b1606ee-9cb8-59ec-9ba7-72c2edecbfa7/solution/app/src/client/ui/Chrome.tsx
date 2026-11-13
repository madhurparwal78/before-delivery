import { useEffect } from 'react';
import { dismissToast } from '../store/sync';
import { navigate } from '../store/router';
import { undoDelete } from '../store/actions';
import { useStore } from '../store/state';

/** Live regions the whole app shares, present from the first paint so they are announced. */
export function Chrome() {
  const outage = useStore((state) => state.outage);
  const connecting = useStore((state) => state.connecting);
  const updating = useStore((state) => state.updating);
  const toasts = useStore((state) => state.toasts);
  const updates = useStore((state) => state.updates);
  const snackbar = useStore((state) => state.snackbar);
  const unread = useStore((state) => Object.values(state.conversations).reduce((sum, conversation) => sum + (conversation.status === 'accepted' ? conversation.unread : 0), 0));

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Airfold` : 'Airfold';
  }, [unread]);

  return (
    <>
      {outage && (
        <div role="alert" className="banner">
          <p data-testid="outage-banner">Photos and files can&apos;t be sent or opened right now. Letters still go through.</p>
        </div>
      )}
      <div role="status" aria-label="Connection" className="banner banner--connection">
        {connecting && <p data-testid="connecting-bar">Connecting...</p>}
        {updating !== null && <p data-testid="updating-bar">{updating === 1 ? 'Updating... 1 letter' : `Updating... ${updating} letters`}</p>}
      </div>
      <div role="status" aria-label="Letter updates" className="sr-only">
        {updates.map((update) => (
          <p key={update.id}>{update.text}</p>
        ))}
      </div>
      <div role="status" aria-label="Notifications" className="toasts">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            className="toast"
            data-testid="toast"
            onClick={() => {
              dismissToast(toast.id);
              navigate(`/letters/${toast.conversationId}`);
            }}
          >
            <span className="toast__text">{toast.text}</span>
          </button>
        ))}
      </div>
      {snackbar && (
        <div className="toasts toasts--snackbar">
          <div className="toast toast--snackbar" data-testid="snackbar">
            <span>Letter deleted.</span>
            <button type="button" className="button button--quiet" onClick={undoDelete}>
              Undo
            </button>
          </div>
        </div>
      )}
    </>
  );
}
