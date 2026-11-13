import { Fragment, useEffect, useState } from 'react';
import type { Conversation, MuteDuration } from '../../shared/types';
import { sealNumber } from '../crypto/identity';
import { api } from '../store/api';
import { blockPeer, deleteForMe, muteConversation, retractLetter, setSeal } from '../store/actions';
import { nameOf } from '../store/conversations';
import { getState } from '../store/state';
import type { Letter } from '../../shared/types';
import type { LocalLetter } from '../types';
import { Dialog, useDialogClose } from '../ui/Dialog';

function LetterActionsBody({ letter, conversationId }: { letter: LocalLetter; conversationId: string }) {
  const close = useDialogClose();
  const [canRetract, setCanRetract] = useState(false);
  useEffect(() => {
    if (letter.direction !== 'sent' || letter.seq === null) return;
    let live = true;
    api<Letter>('GET', `/api/letters/${letter.id}`).then(
      (fresh) => live && setCanRetract(fresh.can_retract),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [letter.id, letter.direction, letter.seq]);
  return (
    <div className="dialog__actions">
      <button
        type="button"
        className="button button--ink"
        onClick={() => {
          deleteForMe(letter.id, conversationId);
          close();
        }}
      >
        Delete for me
      </button>
      {canRetract && (
        <button
          type="button"
          className="button button--ink"
          onClick={() => {
            void retractLetter(letter.id);
            close();
          }}
        >
          Delete for everyone
        </button>
      )}
      <button type="button" className="button button--quiet" onClick={close}>
        Cancel
      </button>
    </div>
  );
}

export function LetterActionsDialog({ letter, conversationId, returnTo, onClose }: { letter: LocalLetter; conversationId: string; returnTo: HTMLElement | null; onClose: () => void }) {
  return (
    <Dialog label="Letter actions" returnTo={returnTo} onClose={onClose}>
      <p className="dialog__title">What would you like to do with this letter?</p>
      <LetterActionsBody letter={letter} conversationId={conversationId} />
    </Dialog>
  );
}

function SealBody({ conversation }: { conversation: Conversation }) {
  const close = useDialogClose();
  const [number, setNumber] = useState('');
  const name = nameOf(conversation);
  useEffect(() => {
    void sealNumber(getState().me!.public_key, conversation.peer.public_key).then(setNumber);
  }, [conversation.peer.public_key]);
  const verified = conversation.peer.seal === 'verified';
  return (
    <>
      <p className="dialog__title">Compare this number with {name} in person.</p>
      <p className="seal-number" data-testid="seal-number">
        {number.split(' ').map((group, at) => (
          <Fragment key={at}>
            {at > 0 && ' '}
            <span>{group}</span>
          </Fragment>
        ))}
      </p>
      <div className="dialog__actions">
        <button
          type="button"
          className="button button--ink"
          onClick={() => {
            void setSeal(conversation.peer, !verified);
          }}
        >
          {verified ? 'Remove verification' : 'Mark as verified'}
        </button>
        <button type="button" className="button button--quiet" onClick={close}>
          Close
        </button>
      </div>
    </>
  );
}

export function SealDialog({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  return (
    <Dialog label="Seal number" onClose={onClose}>
      <SealBody conversation={conversation} />
    </Dialog>
  );
}

const DURATIONS: { value: MuteDuration; label: string }[] = [
  { value: '1h', label: '1 hour' },
  { value: '8h', label: '8 hours' },
  { value: '1w', label: '1 week' },
  { value: 'always', label: 'Always' },
];

function MuteBody({ conversation }: { conversation: Conversation }) {
  const close = useDialogClose();
  const [choice, setChoice] = useState<MuteDuration | null>(null);
  return (
    <>
      <p className="dialog__title">Mute letters from {nameOf(conversation)}</p>
      <div role="radiogroup" aria-label="Mute for" className="choices">
        {DURATIONS.map((duration) => (
          <label key={duration.value} className="choice">
            <input type="radio" name="mute" value={duration.value} checked={choice === duration.value} onChange={() => setChoice(duration.value)} />
            <span>{duration.label}</span>
          </label>
        ))}
      </div>
      <div className="dialog__actions">
        <button
          type="button"
          className="button button--ink"
          disabled={choice === null}
          onClick={() => {
            if (choice) void muteConversation(conversation.id, choice);
            close();
          }}
        >
          Mute
        </button>
        <button type="button" className="button button--quiet" onClick={close}>
          Cancel
        </button>
      </div>
    </>
  );
}

export function MuteDialog({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  return (
    <Dialog label="Mute letters" onClose={onClose}>
      <MuteBody conversation={conversation} />
    </Dialog>
  );
}

function BlockBody({ conversation, onBlocked }: { conversation: Conversation; onBlocked: () => void }) {
  const close = useDialogClose();
  const name = nameOf(conversation);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="dialog__title">{name} won&apos;t be able to reach you. Letters they send while blocked are never delivered.</p>
      <div className="dialog__actions">
        <button
          type="button"
          className="button button--ink"
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void blockPeer(conversation.peer.id).then(() => {
              onBlocked();
              close();
            });
          }}
        >
          Block
        </button>
        <button type="button" className="button button--quiet" onClick={close}>
          Cancel
        </button>
      </div>
    </>
  );
}

export function BlockDialog({ conversation, onClose, onBlocked }: { conversation: Conversation; onClose: () => void; onBlocked: () => void }) {
  return (
    <Dialog label={`Block ${nameOf(conversation)}?`} onClose={onClose}>
      <BlockBody conversation={conversation} onBlocked={onBlocked} />
    </Dialog>
  );
}
