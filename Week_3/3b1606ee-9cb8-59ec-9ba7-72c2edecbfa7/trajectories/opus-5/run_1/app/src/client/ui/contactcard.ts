import { base64urlDecode } from '../../shared/scheme.js';
import type { ConversationRecord, MuteDuration } from '../../shared/types.js';
import { say } from '../copy.js';
import { sealNumber } from '../crypto/seal.js';
import { api } from '../data/api.js';
import { conversationOf, emit, peerName, state } from '../data/store.js';
import { contactAvatar } from './avatar.js';
import { button, el, openDialog, withBusy, type Dialog } from './dom.js';
import { navigate } from './router.js';

function sealLabel(record: ConversationRecord): string {
  if (record.peer.seal === 'verified') return 'Verified';
  if (record.peer.seal === 'changed') return 'Seal number changed';
  return 'Not verified';
}

async function refresh(conversationId: string): Promise<ConversationRecord> {
  const record = await api.conversation(conversationId);
  state.conversations.set(record.id, record);
  emit('conversations');
  return record;
}

export function sealNumberDialog(conversationId: string, opener: HTMLElement | null): void {
  const record = conversationOf(conversationId);
  const me = state.me;
  if (record === null || me === null) return;

  openDialog({
    label: 'Seal number',
    opener,
    build: (dialog) => {
      const digits = el('p', { class: 'seal-digits', testid: 'seal-number' });
      void sealNumber(
        base64urlDecode(me.public_key),
        base64urlDecode(record.peer.public_key),
      ).then((value) => {
        digits.textContent = value;
      });
      const verified = record.peer.seal === 'verified';
      const mark = button(verified ? 'Remove verification' : 'Mark as verified', () => {
        void withBusy(mark, async () => {
          await api.seal(record.peer.id, record.peer.key_id, !verified);
          await refresh(conversationId);
          dialog.close();
        });
      }, { class: 'ink-button' });
      return [digits, mark, button('Close', () => dialog.close())];
    },
  });
}

function muteDialog(conversationId: string, opener: HTMLElement | null): void {
  openDialog({
    label: 'Mute letters',
    opener,
    build: (dialog: Dialog) => {
      const choices: { label: string; value: MuteDuration }[] = [
        { label: '1 hour', value: '1h' },
        { label: '8 hours', value: '8h' },
        { label: '1 week', value: '1w' },
        { label: 'Always', value: 'always' },
      ];
      const name = `mute-${conversationId}`;
      const radios = choices.map((choice, index) => {
        const input = el('input', {
          attrs: { type: 'radio', name, 'aria-label': choice.label, value: choice.value },
        });
        if (index === 0) input.checked = true;
        return el('label', { class: 'radio' }, [input, el('span', { text: choice.label })]);
      });
      const confirm = button('Mute', () => {
        const chosen = radios
          .map((label) => label.querySelector('input') as HTMLInputElement)
          .find((input) => input.checked);
        void withBusy(confirm, async () => {
          await api.mute(conversationId, (chosen?.value ?? '1h') as MuteDuration);
          await refresh(conversationId);
          dialog.close();
        });
      }, { class: 'ink-button' });
      return [...radios, confirm, button('Cancel', () => dialog.close())];
    },
  });
}

function blockDialog(conversationId: string, opener: HTMLElement | null): void {
  const record = conversationOf(conversationId);
  if (record === null) return;
  const name = peerName(record);
  openDialog({
    label: say.blockDialogTitle(name),
    opener,
    build: (dialog) => {
      const confirm = button('Block', () => {
        void withBusy(confirm, async () => {
          await api.block(record.peer.id);
          await refresh(conversationId);
          dialog.close();
        });
      }, { class: 'ink-button' });
      return [
        el('p', { text: say.blockBody(name) }),
        confirm,
        button('Cancel', () => dialog.close()),
      ];
    },
  });
}

function cardControls(record: ConversationRecord): HTMLElement[] {
  const showSeal = button('Show seal number', () => sealNumberDialog(record.id, showSeal));
  const muted = record.muted_until !== null;
  const mute = button(muted ? 'Unmute' : 'Mute', () => {
    if (!muted) {
      muteDialog(record.id, mute);
      return;
    }
    void withBusy(mute, async () => {
      await api.mute(record.id, 'off');
      await refresh(record.id);
    });
  });
  const block = button(record.blocked ? 'Unblock' : 'Block', () => {
    if (!record.blocked) {
      blockDialog(record.id, block);
      return;
    }
    void withBusy(block, async () => {
      await api.unblock(record.peer.id);
      await refresh(record.id);
    });
  });
  return [showSeal, mute, block];
}

function cardBody(record: ConversationRecord): HTMLElement[] {
  const parts: HTMLElement[] = [
    el('div', { class: 'card-plate' }, [
      contactAvatar(state.peerProfiles.get(record.peer.id) ?? null),
    ]),
    el('p', { class: 'card-name', text: peerName(record) }),
    el('p', { class: 'card-username', text: record.peer.username }),
    el('p', { class: 'card-seal', text: sealLabel(record) }),
  ];
  if (record.peer.seal === 'verified') {
    parts.push(el('p', { class: 'verified-mark', text: 'Verified' }));
  }
  return parts;
}

export function openContactCard(conversationId: string, opener: HTMLElement | null): void {
  const record = conversationOf(conversationId);
  if (record === null) return;
  openDialog({
    label: 'Contact card',
    className: 'contact-card-dialog',
    opener,
    build: () => [...cardBody(record), ...cardControls(record)],
  });
}

/** From 1200 pixels wide the contact card is a standing column. */
export function contactCardColumn(conversationId: string): HTMLElement {
  const record = conversationOf(conversationId);
  const column = el('section', {
    class: 'contact-card',
    attrs: { role: 'region', 'aria-label': 'Contact card' },
  });
  if (record === null) return column;
  column.append(...cardBody(record), ...cardControls(record));
  return column;
}

export function openConversationFor(peerId: string): Promise<void> {
  return api.startConversation(peerId).then((record) => {
    state.conversations.set(record.id, record);
    emit('conversations');
    navigate(`/letters/${record.id}`);
  });
}
