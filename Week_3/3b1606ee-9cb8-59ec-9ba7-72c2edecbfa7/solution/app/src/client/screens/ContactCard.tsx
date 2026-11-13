import type { Conversation } from '../../shared/types';
import { nameOf } from '../store/conversations';
import { unblockPeer, muteConversation } from '../store/actions';
import { useStore } from '../store/state';
import { Avatar } from '../ui/Avatar';

export const sealStatusText = (seal: Conversation['peer']['seal']): string =>
  seal === 'verified' ? 'Verified' : seal === 'changed' ? 'Seal number changed' : 'Not verified';

interface CardActions {
  onShowSeal: () => void;
  onMute: () => void;
  onBlock: () => void;
}

/** The contact card: photo, names, seal status, and the buttons for the seal number, mute and block. */
export function ContactCardBody({ conversation, actions }: { conversation: Conversation; actions: CardActions }) {
  const profile = useStore((state) => state.profiles[conversation.peer.id]);
  const muted = conversation.muted_until !== null;
  return (
    <div className="card">
      <Avatar profile={profile} size={96} />
      <p className="card__name">{nameOf(conversation)}</p>
      <p className="card__username">{conversation.peer.username}</p>
      <p className={`seal seal--${conversation.peer.seal}`}>{sealStatusText(conversation.peer.seal)}</p>
      <div className="card__buttons">
        <button type="button" className="button button--ink" onClick={actions.onShowSeal}>
          Show seal number
        </button>
        {muted ? (
          <button type="button" className="button button--ink" onClick={() => void muteConversation(conversation.id, 'off')}>
            Unmute
          </button>
        ) : (
          <button type="button" className="button button--ink" onClick={actions.onMute}>
            Mute
          </button>
        )}
        {conversation.blocked ? (
          <button type="button" className="button button--ink" onClick={() => void unblockPeer(conversation.peer.id)}>
            Unblock
          </button>
        ) : (
          <button type="button" className="button button--ink" onClick={actions.onBlock}>
            Block
          </button>
        )}
      </div>
    </div>
  );
}
