// The lookbook: a grid of image cards reorderable by drag or keyboard, with each
// move announced, and the Add look dialog.
import { api, apiOk, failOf, type DropStaff, type LookOut } from './api.js';
import { el, buttonEl, liveRegion, announce, pending, openDialog, emptyRow } from './ui.js';
import { renderHeader, renderAuthNeeded, renderNotFoundScreen, ensureMember } from './staff-helpers.js';

export async function renderLookbook(root: HTMLElement, dropId: string): Promise<HTMLElement> {
  if (!(await ensureMember())) return renderAuthNeeded(root, `/studio/drops/${dropId}/lookbook`);
  renderHeader('/studio/drops');
  let drop: DropStaff | null = null;
  try { drop = await apiOk<DropStaff>('GET', `/api/drops/${dropId}`); } catch { drop = null; }
  if (!drop) return renderNotFoundScreen(root);
  const h = el('h1', {}, `Lookbook · ${drop.name}`);
  const status = liveRegion('Lookbook status');
  let looks: LookOut[] = [];
  let orderVersion = 1;
  async function reload(): Promise<void> {
    try {
      const res = await apiOk<{ items: LookOut[]; orderVersion: number }>('GET', `/api/drops/${dropId}/looks`);
      looks = res.items ?? [];
      orderVersion = res.orderVersion;
      draw();
    } catch { /* keep */ }
  }

  const list = el('ul', { 'aria-label': 'Looks', class: 'look-grid', role: 'list' });
  function draw(): void {
    list.replaceChildren();
    looks.forEach((look, i) => {
      const li = el('li', { class: 'look-card' });
      li.append(el('img', { src: look.imageUrl, alt: look.altText }));
      li.append(el('p', { text: look.title }));
      li.append(el('p', { class: 'mono', text: `${i + 1} / ${looks.length}` }));
      const move = buttonEl({ class: 'btn btn-sm', text: 'Move', 'aria-label': `Move ${look.title}` });
      attachMoveHandlers(move, li, look, i);
      li.append(move);
      list.append(li);
    });
  }

  function saveOrder(): void {
    const order = [...list.children].map(c => (c as HTMLElement).dataset.lookId ?? '');
    const restore = pending(announce as unknown as HTMLButtonElement, 'Saving order…');
    void restore;
    api('PUT', `/api/drops/${dropId}/looks/order`, { orderVersion, lookIds: order }).then(async res => {
      const data = res.data as { orderVersion: number } | null;
      if (data) orderVersion = data.orderVersion;
      announce(status, 'Look order saved.');
      await reload();
    }).catch(err => {
      const fail = failOf(err);
      if (fail.status === 412) announce(status, `Not saved: ${fail.savedBy} saved a newer version at ${fail.savedAt}. The saved order is back.`, true);
      else announce(status, fail.message, true);
      void reload();
    });
  }

  function attachMoveHandlers(handle: HTMLButtonElement, card: HTMLElement, look: LookOut, index: number): void {
    card.dataset.lookId = look.id;
    let lifted = false;
    let currentIndex = index;
    const positionOf = (): number => Array.prototype.indexOf.call(list.children, card) + 1;

    handle.addEventListener('click', () => {
      if (lifted) { lifted = false; card.classList.remove('lifted'); announce(status, `${look.title} dropped at position ${positionOf()} / ${looks.length}.`); saveOrder(); return; }
      lifted = true;
      card.classList.add('lifted');
      announce(status, `Picked up ${look.title}. Position ${positionOf()} / ${looks.length}.`);
    });
    handle.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        lifted = false;
        card.classList.remove('lifted');
        void reload();
        announce(status, `Move cancelled. ${look.title} is back at position ${currentIndex + 1} / ${looks.length}.`);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentIndex === 0) return;
        list.insertBefore(card, list.children[currentIndex - 1]);
        currentIndex -= 1;
        announce(status, `${look.title} moved to position ${positionOf()} / ${looks.length}.`);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (currentIndex >= list.children.length - 1) return;
        list.insertBefore(card, list.children[currentIndex + 2] ?? null);
        currentIndex += 1;
        announce(status, `${look.title} moved to position ${positionOf()} / ${looks.length}.`);
      }
    });
    // Touch: press and hold the handle for a third of a second lifts the card.
    let holdTimer: number | undefined;
    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.pointerType === 'touch' && !lifted) {
        holdTimer = window.setTimeout(() => { lifted = true; card.classList.add('lifted'); announce(status, `Picked up ${look.title}. Position ${positionOf()} / ${looks.length}.`); }, 300);
      } else if (e.pointerType !== 'touch' && e.buttons > 0) {
        // Mouse or pen drag moves the card directly.
        lifted = true;
        card.classList.add('lifted');
      }
    });
    handle.addEventListener('pointerup', () => { window.clearTimeout(holdTimer); });
    handle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!lifted || e.pointerType === 'touch') return;
      const over = Array.from(list.children).find(child => {
        const r = (child as HTMLElement).getBoundingClientRect();
        return e.clientY >= r.top && e.clientY <= r.bottom;
      }) as HTMLElement | undefined;
      if (over && over !== card) {
        const overIdx = Array.prototype.indexOf.call(list.children, over);
        const myIdx = Array.prototype.indexOf.call(list.children, card);
        if (overIdx !== myIdx) {
          list.insertBefore(card, overIdx < myIdx ? over : over.nextSibling);
          currentIndex = Array.prototype.indexOf.call(list.children, card);
        }
      }
    });
    handle.addEventListener('pointerup', () => {
      if (!lifted) return;
      lifted = false;
      card.classList.remove('lifted');
      announce(status, `${look.title} dropped at position ${positionOf()} / ${looks.length}.`);
      saveOrder();
    });
  }

  const addBtn = buttonEl({ class: 'btn btn-primary', text: 'Add look', onclick: () => {
    openDialog({
      label: 'Add look', opener: addBtn,
      body: (dlg) => {
        const file = el('input', { type: 'file', 'aria-label': 'Look image' }) as HTMLInputElement;
        const title = el('input', { type: 'text', 'aria-label': 'Look title' }) as HTMLInputElement;
        const alt = el('input', { type: 'text', 'aria-label': 'Alt text' }) as HTMLInputElement;
        const submit = buttonEl({ class: 'btn btn-primary', text: 'Upload look', onclick: async () => {
          if (!file.files?.[0]) {
            const box = dlg.root.querySelector('.dialog-error') as HTMLElement;
            if (box) { box.hidden = false; box.textContent = 'This field is required.'; }
            return;
          }
          const fd = new FormData();
          fd.append('file', file.files[0]);
          fd.append('title', title.value);
          fd.append('altText', alt.value);
          const restore = pending(submit, 'Uploading…');
          try {
            const res = await fetch(`/api/drops/${dropId}/looks`, { method: 'POST', body: fd });
            if (!res.ok) {
              const text = await res.text();
              let msg = 'Image storage is unavailable right now. Nothing was uploaded. Try again shortly.';
              try { msg = (JSON.parse(text) as { error: { message: string } }).error.message; } catch { /* keep */ }
              const box = dlg.root.querySelector('.dialog-error') as HTMLElement;
              if (box) { box.hidden = false; box.textContent = msg; }
              return;
            }
            dlg.root.close();
            announce(status, 'Look added.');
            await reload();
          } finally { restore(); }
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {},
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Look image' }), file),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Look title' }), title),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Alt text' }), alt),
          el('div', { class: 'btn-row' }, submit, cancel));
      }
    });
  } });

  root.append(h, el('section', { class: 'panel col-12' }, addBtn, status, list));
  await reload();
  void emptyRow;
  return h;
}
