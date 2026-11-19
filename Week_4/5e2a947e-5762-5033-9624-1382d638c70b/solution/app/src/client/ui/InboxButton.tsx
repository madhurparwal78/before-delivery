import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MentionInfo } from '../../shared/model.ts';
import { loadInbox, markMentionRead, mentionHref, inboxUnread$ } from '../inbox.ts';
import { navigate } from '../router.ts';
import { useSignal } from '../signal.ts';
import { Icon } from './Icon.tsx';
import { Modal } from './Modal.tsx';
import { Spinner } from './Spinner.tsx';

/** `button "Inbox (<n>)"`: the count of unread mentions, opening `dialog "Inbox"` with one link per mention. */
export function InboxButton({ class: className }: { class?: string }) {
  const unread = useSignal(inboxUnread$);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    void loadInbox();
  }, []);

  return (
    <>
      <button ref={button} type="button" class={`btn btn-secondary inbox-btn${className ? ` ${className}` : ''}`} onClick={() => setOpen(true)}>
        <Icon name="inbox" size={18} />
        <span class="tnum">{`Inbox (${unread})`}</span>
      </button>
      {open ? <InboxDialog opener={button.current} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function InboxDialog({ opener, onClose }: { opener: HTMLElement | null; onClose: () => void }) {
  const [mentions, setMentions] = useState<MentionInfo[] | null>(null);
  const busy = useRef(false);

  useLayoutEffect(() => {
    let live = true;
    void loadInbox().then((found) => {
      if (live) setMentions(found);
    });
    return () => {
      live = false;
    };
  }, []);

  const open = async (event: MouseEvent, mention: MentionInfo): Promise<void> => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    await markMentionRead(mention.id);
    navigate(mentionHref(mention));
    onClose();
  };

  return (
    <Modal label="Inbox" onClose={onClose} opener={opener} className="sheet-phone">
      <div class="modal-body">
        <h2 class="modal-title">Inbox</h2>
        {mentions === null ? (
          <p class="inbox-empty">
            <Spinner /> <span>Loading mentions</span>
          </p>
        ) : mentions.length === 0 ? (
          <p class="inbox-empty">No unread mentions.</p>
        ) : (
          <ul class="inbox-list plain">
            {mentions.map((m) => (
              <li key={m.id}>
                <a class="inbox-item" href={mentionHref(m)} onClick={(event) => void open(event, m)}>
                  <span class="inbox-icon">
                    <Icon name="message-square" size={18} />
                  </span>
                  <span>{`${m.by} mentioned you`}</span>
                  <Icon name="chevron-right" size={18} />
                </a>
              </li>
            ))}
          </ul>
        )}
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
