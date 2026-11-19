import { h, clear, api, announce } from './dom';
import { me } from './live';
import { renderTopbar } from './topbar';
import { InboxItem } from '../shared/types';

export async function renderInbox(root: HTMLElement): Promise<void> {
  const who = await me();
  if (!who) { window.location.href = '/account'; return; }
  const res = await api<{ unread: number; items: InboxItem[] }>('GET', '/api/inbox');
  const items = res.data.items ?? [];

  clear(root);
  renderTopbar(root, { personName: who.name, unread: res.data.unread ?? 0, active: 'inbox' });
  const main = h('main', { class: 'viewbody', style: 'max-width:1100px;margin:0 auto' });
  main.append(h('h1', {}, 'Inbox'));

  if (items.length === 0) {
    main.append(h('div', { class: 'empty' }, h('h2', { class: 'h5' }, 'Inbox is empty')));
    root.append(main);
    return;
  }

  const list = h('ul', { class: 'inboxlist', 'aria-label': 'Inbox' });
  items.forEach((item, i) => {
    const li = h('li', {
      class: `inboxitem ${item.read ? '' : 'unread'}`, tabindex: '0',
      'data-item': item.id, 'data-read': String(item.read),
    }, h('span', { class: 'txt' }, item.text));
    const decide = item.kind === 'approval' && item.taskId
      ? h('button', {
          class: 'pill outline', 'aria-label': `Decide on ${item.text}`, onclick: () => openDecide(item.taskId!),
        }, 'Decide')
      : null;
    if (decide) li.append(decide);
    li.addEventListener('keydown', async e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const all = Array.from(list.querySelectorAll<HTMLElement>('.inboxitem'));
        const next = all[all.indexOf(li) + (e.key === 'ArrowDown' ? 1 : -1)];
        next?.focus();
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        const r = await api<InboxItem>('PATCH', `/api/inbox/${item.id}`, { read: !item.read });
        if (r.ok) { item.read = r.data.read; li.dataset.read = String(item.read); li.classList.toggle('unread', !item.read); announce('Inbox status', r.data.read ? 'Marked as read' : 'Marked as unread'); }
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        const r = await api('PATCH', `/api/inbox/${item.id}`, { archived: true });
        if (r.ok) { li.remove(); announce('Inbox status', 'Archived'); }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (item.taskId) window.location.href = `/projects/x?task=${item.taskId}`;
        return;
      }
    });
    list.append(li);
  });
  main.append(list);
  root.append(main);
  const first = list.querySelector<HTMLElement>('.inboxitem');
  first?.focus();

  async function openDecide(taskId: string): Promise<void> {
    const { openDialog } = await import('./dom');
    const detail = await api<{ name: string }>('GET', `/api/tasks/${taskId}`);
    openDialog((container, close) => {
      const radios = (['Approve', 'Request changes', 'Reject'] as const).map((label, i) => {
        const r = h('input', { type: 'radio', name: 'decision', value: label.toLowerCase().replace(' ', '_'), id: `d-${i}` }) as HTMLInputElement;
        return { r, label };
      });
      const comment = h('textarea', { 'aria-label': 'Comment', maxlength: '500' }) as HTMLTextAreaElement;
      const err = h('div', { class: 'err' });
      const submit = h('button', {
        class: 'pill primary', onclick: async () => {
          const chosen = radios.find(x => x.r.checked);
          if (!chosen) { err.textContent = 'Choose a decision'; return; }
          const decision = chosen.label === 'Approve' ? 'approve' : chosen.label === 'Request changes' ? 'request_changes' : 'reject';
          if (decision !== 'approve' && !comment.value.trim()) { err.textContent = 'Add a comment for this decision'; return; }
          const r = await api('POST', `/api/tasks/${taskId}/decision`, { decision, comment: comment.value.trim() });
          if (r.status === 422 && r.data.errors?.comment) { err.textContent = r.data.errors.comment; return; }
          if (r.ok) {
            announce('Approval status', `Decision saved: ${chosen.label}`);
            close();
            window.location.reload();
          }
        },
      }, 'Submit decision');
      container.append(h('h2', {}, `Decide on ${detail.data.name}`),
        ...radios.map(x => h('label', { for: `d-${x.label === 'Approve' ? 0 : x.label === 'Request changes' ? 1 : 2}` }, x.r, ` ${x.label}`)),
        h('div', { class: 'field' }, h('label', {}, 'Comment'), comment),
        err,
        h('div', { class: 'actions' }, h('button', { class: 'pill quiet', onclick: close }, 'Cancel'), submit));
    });
  }
}
