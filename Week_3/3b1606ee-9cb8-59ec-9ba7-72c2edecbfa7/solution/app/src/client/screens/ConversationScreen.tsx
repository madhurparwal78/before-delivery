import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { composerFocus } from '../lib/focus';
import { useSize } from '../lib/hooks';
import { acceptNewSeal, acceptRequest, deleteRequest, unblockPeer } from '../store/actions';
import { nameOf, refreshConversation } from '../store/conversations';
import { navigate, hasNavigated } from '../store/router';
import { lettersOf } from '../store/selectors';
import { useStore } from '../store/state';
import { loadLetters, markRead } from '../store/sync';
import type { LocalLetter } from '../types';
import { BackGlyph } from '../ui/icons';
import { Dialog, useDialogClose } from '../ui/Dialog';
import { EmptySheet, Sheet } from '../ui/Sheet';
import { Composer } from './Composer';
import { ContactCardBody, sealStatusText } from './ContactCard';
import { BlockDialog, LetterActionsDialog, MuteDialog, SealDialog } from './Dialogs';
import { LetterView } from './LetterView';

function Back() {
  return (
    <button type="button" className="button button--quiet" onClick={() => navigate('/letters')}>
      <BackGlyph />
      Back to letters
    </button>
  );
}

function CardDialogBody({ children }: { children: React.ReactNode }) {
  const close = useDialogClose();
  return (
    <>
      {children}
      <div className="dialog__actions">
        <button type="button" className="button button--quiet" onClick={close}>
          Close
        </button>
      </div>
    </>
  );
}

type Nested = { kind: 'actions'; letter: LocalLetter; returnTo: HTMLElement } | { kind: 'seal' } | { kind: 'mute' } | { kind: 'block' };

/** The open conversation: header, the letters running down the sheet, and the composer under the fold line. */
export function ConversationScreen({ id }: { id: string }) {
  const conversation = useStore((state) => state.conversations[id]);
  const letters = useStore((state) => state.letters);
  const hidden = useStore((state) => state.hidden);
  useStore((state) => state.profiles);
  const size = useSize();
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<Nested | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const shown = useMemo(() => lettersOf(letters, hidden, id), [letters, hidden, id]);
  const received = shown.filter((letter) => letter.direction === 'received' && letter.seq !== null);
  const newestSeq = Math.max(0, ...received.filter((letter) => letter.state !== 'sent').map((letter) => letter.seq!));
  const [unfoldId] = useState(() => {
    if (!hasNavigated() || !conversation || conversation.unread === 0) return null;
    return received.filter((letter) => letter.state !== 'read').at(-1)?.id ?? null;
  });

  useEffect(() => {
    let live = true;
    void (async () => {
      const record = await refreshConversation(id);
      if (!live) return;
      setMissing(record === null);
      if (record) await loadLetters(id);
    })();
    return () => {
      live = false;
    };
  }, [id]);

  const status = conversation?.status;
  useEffect(() => {
    if (!status) return;
    const read = (): void => {
      if (document.visibilityState === 'visible') void markRead(id);
    };
    read();
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
  }, [id, status, newestSeq]);

  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [shown.length, conversation?.peer.seal]);

  if (missing) {
    return (
      <div className="pane pane--conversation">
        <Sheet className="sheet--conversation">
          <header className="chead">{size === 'phone' && <Back />}</header>
          <p className="notfound">We couldn&apos;t find that letter.</p>
        </Sheet>
      </div>
    );
  }
  if (!conversation) {
    return (
      <div className="pane pane--conversation">
        <Sheet className="sheet--conversation" loading>
          <header className="chead">{size === 'phone' && <Back />}</header>
        </Sheet>
      </div>
    );
  }

  const name = nameOf(conversation);
  const request = conversation.status === 'request';
  const changed = conversation.peer.seal === 'changed';
  const heading = request ? conversation.peer.username : name;

  const sheet = (
    <Sheet className="sheet--conversation" {...(request ? { 'aria-label': 'Letter request', role: 'region' } : {})}>
      <header className="chead">
        {size === 'phone' && <Back />}
        <div className="chead__who">
          <h2>{heading}</h2>
          {!request && <p className={`seal seal--${conversation.peer.seal}`}>{sealStatusText(conversation.peer.seal)}</p>}
        </div>
        {!request && size !== 'desktop' && (
          <button type="button" className="button button--quiet" onClick={() => setCardOpen(true)}>
            Contact card
          </button>
        )}
      </header>
      <ol ref={list} className="letters" aria-label="Letters">
        {shown.map((letter) => (
          <li key={letter.id}>
            <LetterView letter={letter} name={name} unfoldNow={letter.id === unfoldId} onActions={(target, opener) => setOpen({ kind: 'actions', letter: target, returnTo: opener })} />
          </li>
        ))}
        {changed && !request && <li className="keychange-row">{name}&apos;s seal number changed.</li>}
      </ol>
      {shown.length === 0 && !changed && <EmptySheet>Nothing written yet. Your first letter is sealed before it leaves this page.</EmptySheet>}
      {changed && !request && (
        <section className="keystub" aria-label="Seal number changed" data-testid="key-change-warning">
          <p>
            {name}&apos;s seal number has changed. Letters to {name} are paused until you accept the new seal number.
          </p>
          <div className="keystub__buttons">
            <button type="button" className="button button--quiet" onClick={() => setOpen({ kind: 'seal' })}>
              Compare seal numbers
            </button>
            <button
              type="button"
              className="button button--ink"
              onClick={() => void acceptNewSeal(conversation).then(() => composerFocus.focus?.())}
            >
              Accept new seal number
            </button>
          </div>
        </section>
      )}
      <div className="foldline" aria-hidden="true" />
      {request ? (
        <div className="request-actions">
          <button
            type="button"
            className="button button--ink"
            onClick={() => {
              composerFocus.id = id;
              void acceptRequest(id);
            }}
          >
            Accept
          </button>
          <button type="button" className="button button--ink" onClick={() => void deleteRequest(id).then(() => navigate('/requests'))}>
            Delete
          </button>
          <button type="button" className="button button--ink" onClick={() => setOpen({ kind: 'block' })}>
            Block
          </button>
        </div>
      ) : conversation.blocked ? (
        <div className="blocked-bar">
          <p>You blocked {name}.</p>
          <button type="button" className="button button--ink" onClick={() => void unblockPeer(conversation.peer.id)}>
            Unblock
          </button>
        </div>
      ) : (
        <Composer conversation={conversation} />
      )}
    </Sheet>
  );

  const cardActions = { onShowSeal: () => setOpen({ kind: 'seal' }), onMute: () => setOpen({ kind: 'mute' }), onBlock: () => setOpen({ kind: 'block' }) };
  return (
    <>
      <div className="pane pane--conversation">{sheet}</div>
      {!request && size === 'desktop' && (
        <aside className="pane pane--card" aria-label="Contact card" role="region">
          <Sheet className="sheet--card">
            <ContactCardBody conversation={conversation} actions={cardActions} />
          </Sheet>
        </aside>
      )}
      {open?.kind === 'actions' && <LetterActionsDialog letter={open.letter} conversationId={id} returnTo={open.returnTo} onClose={() => setOpen(null)} />}
      {open?.kind === 'seal' && <SealDialog conversation={conversation} onClose={() => setOpen(null)} />}
      {open?.kind === 'mute' && <MuteDialog conversation={conversation} onClose={() => setOpen(null)} />}
      {open?.kind === 'block' && (
        <BlockDialog
          conversation={conversation}
          onClose={() => setOpen(null)}
          onBlocked={() => {
            setCardOpen(false);
            if (request) navigate('/requests');
          }}
        />
      )}
      {cardOpen && (
        <Dialog label="Contact card" onClose={() => setCardOpen(false)}>
          <CardDialogBody>
            <ContactCardBody conversation={conversation} actions={cardActions} />
          </CardDialogBody>
        </Dialog>
      )}
    </>
  );
}
