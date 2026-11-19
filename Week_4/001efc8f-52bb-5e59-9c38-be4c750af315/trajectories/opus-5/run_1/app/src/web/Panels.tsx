import { useEffect, useState, type ReactElement } from 'react';
import type {
  Channel,
  GalleryPhoto,
  Message,
  MessageOrPlaceholder,
  MessageVersion,
  Scheduled,
  SearchResult,
  User,
} from '../shared/api';
import { ApiFailure, apiGet, apiSend } from './api';
import { when } from './format';
import { MessageArticle, type MessageAction } from './MessageList';
import { Dialog } from './Dialog';
import { MessageText } from './MessageText';

export function ThreadPanel({
  rootId,
  me,
  onAction,
  onOpenPhoto,
  onSendReply,
  refreshKey,
}: {
  rootId: string;
  me: User;
  onAction: (action: MessageAction, message: Message) => void;
  onOpenPhoto: (attachmentId: string) => void;
  onSendReply: (text: string, rootId: string) => void;
  refreshKey: number;
}): ReactElement {
  const [root, setRoot] = useState<MessageOrPlaceholder | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiGet<{ root: MessageOrPlaceholder; replies: MessageOrPlaceholder[] }>(`/api/messages/${rootId}/thread`)
      .then((result) => {
        if (cancelled) return;
        setRoot(result.root);
        setReplies(result.replies.filter((reply): reply is Message => !reply.deleted).reverse());
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rootId, refreshKey]);

  if (missing) return <p>That was not found.</p>;
  if (root === null) return <p>Loading…</p>;

  return (
    <div className="thread">
      {root.deleted ? (
        <p className="message-text">That message was deleted.</p>
      ) : (
        <MessageArticle
          message={root}
          me={me}
          dimmedPin={false}
          onAction={onAction}
          onOpenThread={() => undefined}
          onOpenPhoto={onOpenPhoto}
        />
      )}
      {replies.map((reply) => (
        <MessageArticle
          key={reply.id}
          message={reply}
          me={me}
          dimmedPin={false}
          onAction={onAction}
          onOpenThread={() => undefined}
          onOpenPhoto={onOpenPhoto}
        />
      ))}
      <div className="thread-composer">
        <label htmlFor="thread-reply">Reply</label>
        <textarea
          id="thread-reply"
          aria-label="Reply"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (draft.trim().length > 0) {
                onSendReply(draft, rootId);
                setDraft('');
              }
            }
          }}
        />
        <button
          type="button"
          onClick={() => {
            if (draft.trim().length === 0) return;
            onSendReply(draft, rootId);
            setDraft('');
          }}
        >
          Send reply
        </button>
      </div>
    </div>
  );
}

export function VersionsPanel({ messageId }: { messageId: string }): ReactElement {
  const [versions, setVersions] = useState<MessageVersion[]>([]);
  useEffect(() => {
    void apiGet<{ versions: MessageVersion[] }>(`/api/messages/${messageId}/versions`).then((result) =>
      setVersions(result.versions),
    );
  }, [messageId]);
  return (
    <ul aria-label="Versions" className="versions">
      {versions.map((version) => (
        <li key={version.version}>
          <span className="mono chip chip-version">{`v${version.version}`}</span>
          <span>{version.edited_by.name}</span>
          <time className="mono">{when(version.created_at)}</time>
          <p className="message-text">
            <MessageText text={version.text} />
          </p>
        </li>
      ))}
    </ul>
  );
}

export function PhotosPanel({
  channel,
  refreshKey,
  onOpenPhoto,
}: {
  channel: Channel;
  refreshKey: number;
  onOpenPhoto: (attachmentId: string) => void;
}): ReactElement {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  useEffect(() => {
    void apiGet<{ photos: GalleryPhoto[] }>(`/api/channels/${channel.id}/gallery`).then((result) =>
      setPhotos(result.photos),
    );
  }, [channel.id, refreshKey]);
  return (
    <ul aria-label="Photos" className="gallery">
      {photos.map((photo) => (
        <li key={photo.attachment_id}>
          <a
            href={`?photo=${photo.attachment_id}`}
            aria-label={`Photo ${photo.filename} by ${photo.uploaded_by.name}`}
            onClick={(event) => {
              event.preventDefault();
              onOpenPhoto(photo.attachment_id);
            }}
          >
            <img src={photo.thumb_url} alt={photo.filename} />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ScheduledPanel({
  channel,
  canCancel,
  refreshKey,
  onNotice,
  onChanged,
}: {
  channel: Channel;
  canCancel: boolean;
  refreshKey: number;
  onNotice: (copy: string) => void;
  onChanged: () => void;
}): ReactElement {
  const [posts, setPosts] = useState<Scheduled[]>([]);
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ scheduled: Scheduled[] }>(`/api/channels/${channel.id}/scheduled`).then((result) =>
      setPosts(result.scheduled),
    );
  }, [channel.id, refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void apiGet<{ scheduled: Scheduled[] }>(`/api/channels/${channel.id}/scheduled`).then((result) =>
        setPosts(result.scheduled),
      );
    }, 5000);
    return () => window.clearInterval(timer);
  }, [channel.id]);

  const stateLabel = (state: string): string =>
    state === 'sent' ? 'Sent' : state === 'cancelled' ? 'Cancelled' : 'Scheduled';

  return (
    <ul aria-label="Scheduled posts" className="scheduled">
      {posts.map((post) => (
        <li key={post.id}>
          <p className="message-text">
            <MessageText text={post.text} />
          </p>
          <time className="mono">{post.next_fire_local === null ? '' : when(post.next_fire_local)}</time>
          <span className="chip chip-state">{stateLabel(post.state)}</span>
          {post.upcoming_local.length > 0 ? (
            <ul aria-label="Upcoming">
              {post.upcoming_local.map((occurrence) => (
                <li key={occurrence}>{when(occurrence)}</li>
              ))}
            </ul>
          ) : null}
          {canCancel && post.state === 'scheduled' ? (
            <button
              type="button"
              disabled={working === post.id}
              onClick={() => {
                setWorking(post.id);
                void apiSend<void>('DELETE', `/api/scheduled/${post.id}`)
                  .then(() => onNotice('Scheduled post cancelled.'))
                  .catch((error: unknown) => {
                    if (error instanceof ApiFailure) onNotice(error.message);
                  })
                  .finally(() => {
                    setWorking(null);
                    onChanged();
                  });
              }}
            >
              {working === post.id ? 'Cancelling…' : 'Cancel scheduled post'}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function SearchPanel({
  results,
  loading,
  onOpenResult,
}: {
  results: SearchResult[] | null;
  loading: boolean;
  onOpenResult: (result: SearchResult) => void;
}): ReactElement {
  if (loading) return <p>Searching…</p>;
  if (results === null) return <p>No results.</p>;
  return (
    <ul className="search-results">
      {results.map((result) => (
        <li key={`${result.message_id}-${result.attachment_id ?? 'message'}`}>
          <button type="button" className="link-button" onClick={() => onOpenResult(result)}>
            <span className="mono">{`#${result.channel.name}`}</span>
            <span>{result.author_name}</span>
            <time className="mono">{when(result.sent_at)}</time>
            <span className="snippet">{result.snippet}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PhotoDialog({
  attachment,
  onClose,
  onGoToMessage,
}: {
  attachment: { id: string; filename: string; messageId: string | null } | null;
  onClose: () => void;
  onGoToMessage: (messageId: string) => void;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  const [outage, setOutage] = useState(false);

  useEffect(() => {
    if (attachment === null) return;
    setFailed(false);
    setOutage(false);
    void fetch(`/api/attachments/${attachment.id}`, { credentials: 'same-origin', method: 'GET' })
      .then((response) => {
        if (response.status === 503) setOutage(true);
        else if (!response.ok) setFailed(true);
      })
      .catch(() => setFailed(true));
  }, [attachment]);

  return (
    <Dialog label="Photo" onClose={onClose}>
      <h2>Photo</h2>
      {attachment === null || failed ? (
        <p>That was not found.</p>
      ) : outage ? (
        <p>Photo unavailable while storage is unreachable.</p>
      ) : (
        <img className="full-photo" src={`/api/attachments/${attachment.id}`} alt={attachment.filename} />
      )}
      <div className="dialog-actions">
        {attachment?.messageId != null ? (
          <button type="button" onClick={() => onGoToMessage(attachment.messageId as string)}>
            Go to message
          </button>
        ) : null}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
