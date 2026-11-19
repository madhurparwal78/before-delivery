import { copy } from '../shared/copy.js';
import { announce, api, bootstrap, byId, closePanel, need, openPanel, topPanel } from './dom.js';
import { connectLive } from './live.js';

type Note = {
  id: string;
  text: string;
  author_name: string;
  status: 'pending' | 'approved' | 'declined';
  reason: string | null;
};

export function startBoard(): void {
  const viewer = bootstrap<{ viewer: string }>().viewer;
  const form = need<HTMLFormElement>('note-form');
  const field = need<HTMLInputElement>('note-text');
  const list = need('notice-board');
  let pinning = false;
  let requestKey = crypto.randomUUID();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void pin();
  });

  async function pin(): Promise<void> {
    if (pinning) return;
    pinning = true;
    announce('notes-status', copy.notePinning);
    const answer = await api<{ note: Note }>('/api/notes', {
      method: 'POST',
      body: { text: field.value },
      headers: { 'Request-Key': requestKey },
    });
    pinning = false;
    if (!answer.ok) {
      announce('notes-status', answer.body.message ?? copy.photoNetwork);
      field.focus();
      return;
    }
    announce('notes-status', copy.notePinned);
    requestKey = crypto.randomUUID();
    appendNote({ ...answer.body.note, author_name: '', reason: null }, true);
    field.value = '';
    field.focus();
  }

  function appendNote(note: Note, own: boolean): void {
    const empty = list.querySelector('li:not(.note)');
    empty?.remove();
    if (list.querySelector(`[data-note="${note.id}"]`)) return;
    const item = document.createElement('li');
    item.className = 'note';
    item.dataset.note = note.id;
    item.dataset.status = note.status;
    const text = document.createElement('p');
    text.className = 'note-text';
    text.textContent = note.text;
    item.append(text);
    if (note.author_name) {
      const author = document.createElement('p');
      author.className = 'note-author';
      author.textContent = note.author_name;
      item.append(author);
    }
    if (own && note.status !== 'approved') {
      const waiting = document.createElement('p');
      waiting.className = 'note-waiting';
      waiting.textContent = copy.waitingForRanger;
      item.append(waiting);
    }
    list.append(item);
  }

  list.addEventListener('click', (event) => {
    const button = event.target as HTMLElement;
    if (!button.classList.contains('remove-note')) return;
    const item = button.closest('.note') as HTMLElement | null;
    if (!item) return;
    void api(`/api/notes/${item.dataset.note}`, { method: 'DELETE' }).then((answer) => {
      if (!answer.ok) {
        announce('notes-status', answer.body.message ?? copy.photoNetwork);
        return;
      }
      item.remove();
      announce('notes-status', copy.noteRemoved);
    });
  });

  connectLive((message) => {
    if (message.kind !== 'note') return;
    const event = String(message.event);
    if (event === 'approved') {
      const note = message.note as Note;
      const existing = list.querySelector<HTMLElement>(`[data-note="${note.id}"]`);
      if (existing) {
        existing.dataset.status = 'approved';
        existing.querySelector('.note-waiting')?.remove();
      } else appendNote(note, false);
      if (message.author_id !== viewer) announce('notes-status', copy.newNote);
      return;
    }
    if (event === 'yours_approved') {
      announce('notes-status', copy.yourNoteOnBoard);
      const existing = list.querySelector<HTMLElement>(`[data-note="${String(message.id)}"]`);
      if (existing) {
        existing.dataset.status = 'approved';
        existing.querySelector('.note-waiting')?.remove();
      }
      return;
    }
    if (event === 'yours_declined') {
      announce('notes-status', copy.yourNoteDeclined(String(message.reason)));
      list.querySelector<HTMLElement>(`[data-note="${String(message.id)}"]`)?.remove();
      return;
    }
    if (event === 'removed') list.querySelector<HTMLElement>(`[data-note="${String(message.id)}"]`)?.remove();
  });
}

export function startRanger(): void {
  const data = bootstrap<{ allowed: boolean; notRanger: string | null }>();
  if (!data.allowed) {
    announce('notes-status', data.notRanger ?? '');
    return;
  }
  const list = need('waiting-notes');
  const dialog = need('decline-dialog');
  let declining: HTMLElement | null = null;

  list.addEventListener('click', (event) => {
    const button = event.target as HTMLElement;
    const item = button.closest('.waiting-note') as HTMLElement | null;
    if (!item) return;
    if (button.classList.contains('approve-note')) void approve(item);
    else if (button.classList.contains('decline-note')) {
      declining = item;
      openPanel(dialog, button);
    }
  });

  need('decline-confirm').addEventListener('click', () => void decline());

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || topPanel() !== dialog) return;
    closePanel(dialog);
    event.preventDefault();
  });

  async function approve(item: HTMLElement): Promise<void> {
    const answer = await api(`/api/notes/${item.dataset.note}/approve`, { method: 'POST', body: {} });
    if (!answer.ok) {
      announce('notes-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    item.remove();
    announce('notes-status', copy.noteApproved);
  }

  async function decline(): Promise<void> {
    if (!declining) return;
    const reason = (document.querySelector('input[name="reason"]:checked') as HTMLInputElement | null)?.value;
    const answer = await api(`/api/notes/${declining.dataset.note}/decline`, { method: 'POST', body: { reason } });
    if (!answer.ok) {
      announce('notes-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    declining.remove();
    declining = null;
    closePanel(dialog);
    announce('notes-status', copy.noteDeclined);
  }

  connectLive((message) => {
    if (message.kind !== 'note') return;
    if (String(message.event) === 'approved') {
      const note = message.note as Note;
      byId(`waiting-${note.id}`)?.remove();
      list.querySelector<HTMLElement>(`[data-note="${note.id}"]`)?.remove();
    }
  });
}
