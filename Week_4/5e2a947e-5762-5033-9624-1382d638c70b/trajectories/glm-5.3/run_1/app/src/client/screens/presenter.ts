import { el, openDialog } from '../lib/dom.js';
import { api, errorOf } from '../lib/api.js';
import type { EditorStore } from '../lib/store.js';

/**
 * region "Presenter": slide ordering, go live, follower count and
 * speaker notes, with the audience link to copy.
 */

export async function openPresenter(store: EditorStore, mapId: string, opener: HTMLElement, focusedId: string): Promise<void> {
  const start = await api<{ presentation: { id: string; code: string; state: string; slide_index: number; followers: number } }>(`/api/maps/${mapId}/presentations`, 'POST');
  if (!start.ok) {
    store.announce(errorOf(start).message);
    return;
  }
  const pres = (start.body as { presentation: { id: string; code: string; state: string; slide_index: number; followers: number } }).presentation;

  openDialog({
    label: 'Presenter',
    opener,
    panelClass: 'presenter-panel',
    build(body, close) {
      const region = el('div', { class: 'presenter', role: 'region', 'aria-label': 'Presenter' });
      const aside = el('aside', {});
      const slidesList = el('ol', { role: 'list', 'aria-label': 'Slides' });
      const drawSlides = () => {
        slidesList.replaceChildren();
        store.state.slides.forEach((id, i) => {
          const t = store.state.topics.get(id);
          const li = el('li', { class: 'outline-row', tabindex: '-1' }, `${i + 1}. ${t?.title ?? ''}`);
          li.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' && e.altKey) {
              const order = [...store.state.slides];
              if (i > 0) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; void store.send([{ op_id: `o-${crypto.randomUUID()}`, kind: 'slides', order }]); }
              e.preventDefault();
            }
            if (e.key === 'ArrowDown' && e.altKey) {
              const order = [...store.state.slides];
              if (i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; void store.send([{ op_id: `o-${crypto.randomUUID()}`, kind: 'slides', order }]); }
              e.preventDefault();
            }
          });
          slidesList.appendChild(li);
        });
      };
      drawSlides();
      store.subscribe(drawSlides);
      const addSlide = el('button', { class: 'secondary', 'aria-label': 'Add slide' }, 'Add slide');
      addSlide.addEventListener('click', () => {
        if (focusedId && !store.state.slides.includes(focusedId)) {
          void store.send([{ op_id: `o-${crypto.randomUUID()}`, kind: 'slides', order: [...store.state.slides, focusedId] }]);
        }
      });
      const goLive = el('button', { class: 'primary', 'aria-label': 'Go live' }, 'Go live');
      const endBtn = el('button', { class: 'secondary', 'aria-label': 'End presentation', hidden: '' }, 'End presentation');
      const copyLink = el('button', { class: 'secondary', 'aria-label': 'Copy link' }, 'Copy link');
      const linkText = el('p', {}, `${location.origin}/p/${pres.code}`);
      copyLink.addEventListener('click', () => { void navigator.clipboard?.writeText(`${location.origin}/p/${pres.code}`); });
      aside.append(slidesList, addSlide, goLive, endBtn, copyLink, linkText);

      const notesRegion = el('div', { class: 'speaker-notes', role: 'region', 'aria-label': 'Speaker notes' });
      const followerText = el('p', {}, '0 following');
      const slideCounter = el('p', {}, 'Slide 1 of 0');
      const main = el('div', {});
      main.append(followerText, slideCounter, notesRegion);
      region.append(aside, main);
      body.appendChild(region);

      let live = false;
      const drawSlideContent = async () => {
        const slideId = store.state.slides[0];
        const t = slideId ? store.state.topics.get(slideId) : null;
        notesRegion.textContent = t?.note ?? '';
        slideCounter.textContent = `Slide 1 of ${store.state.slides.length}`;
        const res = await api<{ followers: number }>(`/api/presentations/by-code/${pres.code}`);
        if (res.ok) followerText.textContent = `${(res.body as { followers: number }).followers} following`;
      };
      void drawSlideContent();

      goLive.addEventListener('click', async () => {
        const res = await api(`/api/presentations/${pres.id}/state`, 'POST', { to: 'live' });
        if (res.ok) {
          live = true;
          goLive.hidden = true;
          endBtn.hidden = false;
          void drawSlideContent();
        } else {
          store.announce(errorOf(res).message);
        }
      });
      endBtn.addEventListener('click', async () => {
        await api(`/api/presentations/${pres.id}/state`, 'POST', { to: 'ended' });
        close();
        opener.focus();
      });
      region.addEventListener('keydown', async (e) => {
        if (!live) return;
        if (e.key === 'ArrowRight' || e.key === ' ') {
          e.preventDefault();
          const current = store.state.slides.indexOf(store.state.slides[0]);
          void stepTo(Math.min(current + 1, store.state.slides.length - 1));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const current = store.state.slides.indexOf(store.state.slides[0]);
          void stepTo(Math.max(0, current - 1));
        } else if (e.key === 'Escape') {
          await api(`/api/presentations/${pres.id}/state`, 'POST', { to: 'ended' });
          close();
        }
      });
      const stepTo = async (index: number) => {
        const res = await api<{ skipped: { index: number; reason: string }[] }>(`/api/presentations/${pres.id}/step`, 'POST', { index });
        if (res.ok) {
          const data = res.body as { skipped: { index: number; reason: string }[] };
          for (const s of data.skipped ?? []) {
            store.announce(s.reason === 'deleted'
              ? `Slide ${s.index + 1} was skipped: its topic was deleted.`
              : `Slide ${s.index + 1} was skipped: it is restricted.`);
          }
          void drawSlideContent();
        }
      };
      // live updates
      window.addEventListener('sprig-presentation', ((e: CustomEvent) => {
        const detail = e.detail as { presentation?: { followers?: number; slide_index?: number } };
        if (detail.presentation?.followers !== undefined) followerText.textContent = `${detail.presentation.followers} following`;
      }) as EventListener);
    },
  });
}
