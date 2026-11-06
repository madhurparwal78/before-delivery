import { api } from '../api';
import { clear, el, prefersReducedMotion, svg } from '../dom';
import { frame } from '../frame';
import { Screen, ScreenParams, navigate } from '../router';
import { BoardDto } from '../types';
import { onLive } from '../live';
import { animate } from '../anim';
import { startTitleTransition } from '../components/titletransition';
import {
  BOARD_NUDGE,
  BOARD_NUDGE_SHIFT,
  CARD_HEIGHT,
  CARD_WIDTH,
  arrowEnds,
  clampBoardCoordinate,
  snapBoardCoordinate,
  zoomAbout,
} from '../../shared/board';
import {
  BOARD_LIVE_SLIDE_MS,
  BOARD_NUDGE_SAVE_MS,
  BOARD_REFUSAL_SLIDE_MS,
  DRAG_THRESHOLD_PX,
} from '../../shared/motion';
import { COPY, boardMovedManyCopy, boardMovedOneCopy } from '../../shared/copy';

type Card = { objectId: string; title: string; x: number; y: number; saved: { x: number; y: number } };

export function boardScreen(): Screen {
  let stopLive: (() => void) | null = null;
  let collectionId = '';
  let cards: Card[] = [];
  let edges: { id: string; from: string; to: string }[] = [];
  let selection = new Set<string>();
  let zoom = 1;
  let translate = { x: 0, y: 0 };
  let nudgeTimer = 0;
  let frameId = 0;

  const group = el('div', { className: 'board-group', attrs: { role: 'group', 'aria-label': 'Board' } });
  const viewport = el('div', { className: 'board-viewport', attrs: { 'data-board-viewport': '' } });
  const surface = el('div', { className: 'board-surface' });
  const arrowLayer = svg('svg', { class: 'board-arrows', 'aria-hidden': 'true' });
  const cardList = el('ul', { className: 'board-cards', attrs: { 'aria-label': 'Board cards' } });
  let lasso: HTMLElement | null = null;
  viewport.append(arrowLayer, surface);
  group.append(viewport, cardList);

  function applyTransform(): void {
    surface.style.transform = `translate(${translate.x}px, ${translate.y}px) scale(${zoom})`;
    arrowLayer.setAttribute(
      'style',
      `transform: translate(${translate.x}px, ${translate.y}px) scale(${zoom}); transform-origin: 0 0;`,
    );
    viewport.setAttribute(
      'data-board-transform',
      `${zoom.toFixed(4)},${translate.x.toFixed(4)},${translate.y.toFixed(4)}`,
    );
  }

  function cardNode(card: Card): HTMLElement {
    let node = surface.querySelector<HTMLElement>(`[data-board-card="${card.objectId}"]`);
    if (node === null) {
      node = el('div', { className: 'board-card', attrs: { 'data-board-card': card.objectId } });
      node.append(el('span', { className: 'board-card-title', text: card.title }));
      surface.append(node);
      installCardDrag(node, card);
    }
    node.style.width = `${CARD_WIDTH}px`;
    node.style.height = `${CARD_HEIGHT}px`;
    node.style.transform = `translate(${card.x}px, ${card.y}px)`;
    node.classList.toggle('selected', selection.has(card.objectId));
    return node;
  }

  function renderCards(): void {
    for (const card of cards) cardNode(card);
    for (const node of surface.querySelectorAll<HTMLElement>('[data-board-card]')) {
      const id = node.getAttribute('data-board-card') ?? '';
      if (!cards.some((card) => card.objectId === id)) node.remove();
    }
    renderList();
    drawArrows();
  }

  function renderList(): void {
    const focusedId = (document.activeElement as HTMLElement | null)?.getAttribute('data-card-button');
    clear(cardList);
    const ordered = [...cards].sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      if (a.x !== b.x) return a.x - b.x;
      return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    });
    for (const card of ordered) {
      const name = `${card.title}, x ${Math.round(card.x)}, y ${Math.round(card.y)}${
        selection.has(card.objectId) ? ', selected' : ''
      }`;
      const button = el('button', {
        className: 'board-card-button',
        text: card.title,
        attrs: { type: 'button', 'aria-label': name, 'data-card-button': card.objectId },
      });
      button.addEventListener('keydown', (event) => onCardKey(event, card));
      button.addEventListener('focus', () => {
        const node = surface.querySelector<HTMLElement>(`[data-board-card="${card.objectId}"]`);
        node?.classList.add('focused');
      });
      button.addEventListener('blur', () => {
        const node = surface.querySelector<HTMLElement>(`[data-board-card="${card.objectId}"]`);
        node?.classList.remove('focused');
      });
      cardList.append(el('li', { children: [button] }));
    }
    if (focusedId !== null && focusedId !== undefined) {
      cardList.querySelector<HTMLElement>(`[data-card-button="${focusedId}"]`)?.focus();
    }
  }

  /** Each arrow goes between the closest pair of side midpoints, recomputed every frame. */
  function drawArrows(): void {
    clear(arrowLayer);
    for (const edge of edges) {
      const from = cards.find((card) => card.objectId === edge.from);
      const to = cards.find((card) => card.objectId === edge.to);
      if (from === undefined || to === undefined) continue;
      const ends = arrowEnds(drawnPosition(from), drawnPosition(to));
      const line = svg('line', {
        'data-board-arrow': edge.id,
        x1: String(ends.from.x),
        y1: String(ends.from.y),
        x2: String(ends.to.x),
        y2: String(ends.to.y),
      });
      arrowLayer.append(line);
    }
  }

  function drawnPosition(card: Card): { x: number; y: number } {
    const node = surface.querySelector<HTMLElement>(`[data-board-card="${card.objectId}"]`);
    if (node === null) return { x: card.x, y: card.y };
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    return { x: matrix.m41, y: matrix.m42 };
  }

  function startFrameLoop(): void {
    const step = (): void => {
      drawArrows();
      frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
  }

  async function savePositions(moved: Card[]): Promise<void> {
    if (moved.length === 0) return;
    const result = await api.put<BoardDto>(`/api/collections/${collectionId}/board`, {
      positions: moved.map((card) => ({ object_id: card.objectId, x: card.x, y: card.y })),
    });
    if (!result.ok) {
      frame().showAlert(COPY.boardMoveRefused);
      for (const card of moved) {
        const node = surface.querySelector<HTMLElement>(`[data-board-card="${card.objectId}"]`);
        const from = drawnPosition(card);
        card.x = card.saved.x;
        card.y = card.saved.y;
        if (node !== null) {
          node.style.transform = `translate(${card.x}px, ${card.y}px)`;
          if (!prefersReducedMotion()) {
            animate(
              node,
              [
                { transform: `translate(${from.x}px, ${from.y}px)` },
                { transform: `translate(${card.x}px, ${card.y}px)` },
              ],
              BOARD_REFUSAL_SLIDE_MS,
            );
          }
        }
      }
      renderList();
      return;
    }
    for (const card of moved) card.saved = { x: card.x, y: card.y };
    if (moved.length === 1) {
      frame().announce(boardMovedOneCopy(moved[0].title, Math.round(moved[0].x), Math.round(moved[0].y)));
    } else {
      frame().announce(boardMovedManyCopy(moved.length));
    }
    renderList();
  }

  function onCardKey(event: KeyboardEvent, card: Card): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      const node = surface.querySelector<HTMLElement>(`[data-board-card="${card.objectId}"] .board-card-title`);
      if (node !== null) startTitleTransition(node);
      navigate(`/o/${card.objectId}`);
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      if (selection.has(card.objectId)) selection.delete(card.objectId);
      else selection.add(card.objectId);
      renderCards();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      selection.clear();
      renderCards();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selection = new Set(cards.map((candidate) => candidate.objectId));
      renderCards();
      return;
    }
    if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      const rect = group.getBoundingClientRect();
      const centre = { x: rect.width / 2, y: rect.height / 2 };
      const next = zoomAbout(zoom, translate, centre, event.key === '-' ? 100 : -100);
      zoom = next.zoom;
      translate = { x: next.x, y: next.y };
      applyTransform();
      return;
    }
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const distance = event.shiftKey ? BOARD_NUDGE_SHIFT : BOARD_NUDGE;
    const moving = selection.has(card.objectId)
      ? cards.filter((candidate) => selection.has(candidate.objectId))
      : [card];
    for (const target of moving) {
      target.x = clampBoardCoordinate(target.x + step[0] * distance);
      target.y = clampBoardCoordinate(target.y + step[1] * distance);
      const node = surface.querySelector<HTMLElement>(`[data-board-card="${target.objectId}"]`);
      if (node !== null) node.style.transform = `translate(${target.x}px, ${target.y}px)`;
    }
    renderList();
    cardList.querySelector<HTMLElement>(`[data-card-button="${card.objectId}"]`)?.focus();
    if (nudgeTimer !== 0) window.clearTimeout(nudgeTimer);
    nudgeTimer = window.setTimeout(() => void savePositions(moving), BOARD_NUDGE_SAVE_MS);
  }

  function installCardDrag(node: HTMLElement, card: Card): void {
    let startPointer = { x: 0, y: 0 };
    let starts: { card: Card; x: number; y: number }[] = [];
    let dragging = false;
    node.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      startPointer = { x: event.clientX, y: event.clientY };
      dragging = false;
      const moving = selection.has(card.objectId)
        ? cards.filter((candidate) => selection.has(candidate.objectId))
        : [card];
      starts = moving.map((candidate) => ({ card: candidate, x: candidate.x, y: candidate.y }));
      node.setPointerCapture(event.pointerId);
    });
    node.addEventListener('pointermove', (event) => {
      if (starts.length === 0) return;
      const dx = event.clientX - startPointer.x;
      const dy = event.clientY - startPointer.y;
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      for (const start of starts) {
        start.card.x = snapBoardCoordinate(start.x, dx, zoom);
        start.card.y = snapBoardCoordinate(start.y, dy, zoom);
        const moved = surface.querySelector<HTMLElement>(`[data-board-card="${start.card.objectId}"]`);
        if (moved !== null) moved.style.transform = `translate(${start.card.x}px, ${start.card.y}px)`;
      }
    });
    const release = (event: PointerEvent): void => {
      if (starts.length === 0) return;
      const moved = starts.map((start) => start.card);
      const wasDragging = dragging;
      starts = [];
      dragging = false;
      if (!wasDragging) {
        if (event.shiftKey) {
          if (selection.has(card.objectId)) selection.delete(card.objectId);
          else selection.add(card.objectId);
        } else {
          selection = new Set([card.objectId]);
        }
        renderCards();
        cardList.querySelector<HTMLElement>(`[data-card-button="${card.objectId}"]`)?.focus();
        return;
      }
      void savePositions(moved);
    };
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
  }

  function installViewportGestures(): void {
    let panning = false;
    let lassoing = false;
    let startPointer = { x: 0, y: 0 };
    let startTranslate = { x: 0, y: 0 };
    viewport.addEventListener('pointerdown', (event) => {
      startPointer = { x: event.clientX, y: event.clientY };
      startTranslate = { ...translate };
      if (event.shiftKey) {
        lassoing = true;
        lasso = el('div', { className: 'board-lasso', attrs: { 'data-board-lasso': '' } });
        viewport.append(lasso);
      } else {
        panning = true;
      }
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointermove', (event) => {
      if (panning) {
        translate = {
          x: startTranslate.x + (event.clientX - startPointer.x),
          y: startTranslate.y + (event.clientY - startPointer.y),
        };
        applyTransform();
        return;
      }
      if (lassoing && lasso !== null) {
        const rect = viewport.getBoundingClientRect();
        const left = Math.min(startPointer.x, event.clientX) - rect.left;
        const top = Math.min(startPointer.y, event.clientY) - rect.top;
        lasso.style.left = `${left}px`;
        lasso.style.top = `${top}px`;
        lasso.style.width = `${Math.abs(event.clientX - startPointer.x)}px`;
        lasso.style.height = `${Math.abs(event.clientY - startPointer.y)}px`;
      }
    });
    const release = (): void => {
      if (lassoing && lasso !== null) {
        const box = lasso.getBoundingClientRect();
        selection = new Set(
          cards
            .filter((card) => {
              const node = surface.querySelector<HTMLElement>(`[data-board-card="${card.objectId}"]`);
              if (node === null) return false;
              const rect = node.getBoundingClientRect();
              return !(
                rect.right < box.left ||
                rect.left > box.right ||
                rect.bottom < box.top ||
                rect.top > box.bottom
              );
            })
            .map((card) => card.objectId),
        );
        lasso.remove();
        lasso = null;
        renderCards();
      }
      panning = false;
      lassoing = false;
    };
    viewport.addEventListener('pointerup', release);
    viewport.addEventListener('pointercancel', release);
    viewport.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = group.getBoundingClientRect();
        const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const deltaY =
          event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * rect.height : event.deltaY;
        const next = zoomAbout(zoom, translate, pointer, deltaY);
        zoom = next.zoom;
        translate = { x: next.x, y: next.y };
        applyTransform();
      },
      { passive: false },
    );
    let pinchStart: { distance: number; zoom: number; midpoint: { x: number; y: number } } | null = null;
    const touches = new Map<number, { x: number; y: number }>();
    viewport.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) {
        const points = [...touches.values()];
        pinchStart = {
          distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
          zoom,
          midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
        };
      }
    });
    viewport.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'touch' || !touches.has(event.pointerId)) return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size !== 2 || pinchStart === null) return;
      const points = [...touches.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const rect = group.getBoundingClientRect();
      const ratio = distance / pinchStart.distance;
      const wanted = Math.min(4, Math.max(0.25, pinchStart.zoom * ratio));
      const pointer = { x: pinchStart.midpoint.x - rect.left, y: pinchStart.midpoint.y - rect.top };
      translate = {
        x: pointer.x - (pointer.x - translate.x) * (wanted / zoom),
        y: pointer.y - (pointer.y - translate.y) * (wanted / zoom),
      };
      zoom = wanted;
      applyTransform();
    });
    const endTouch = (event: PointerEvent): void => {
      touches.delete(event.pointerId);
      if (touches.size < 2) pinchStart = null;
    };
    viewport.addEventListener('pointerup', endTouch);
    viewport.addEventListener('pointercancel', endTouch);
  }

  async function load(): Promise<void> {
    const result = await api.get<BoardDto>(`/api/collections/${collectionId}/board`);
    if (!result.ok) return;
    cards = result.data.cards.map((card) => ({
      objectId: card.object_id,
      title: card.title,
      x: card.x,
      y: card.y,
      saved: { x: card.x, y: card.y },
    }));
    edges = result.data.edges;
    renderCards();
  }

  return {
    async mount(params: ScreenParams): Promise<void> {
      collectionId = params.params['id'];
      const main = frame().main;
      clear(main);
      clear(frame().margin);
      const collection = await api.get<{ name: string }>(`/api/collections/${collectionId}`);
      if (!collection.ok) {
        main.append(el('h1', { text: COPY.notFound }));
        return;
      }
      frame().setTopTitle(collection.data.name);
      main.append(el('h1', { text: collection.data.name, attrs: { tabindex: '-1' } }), group);
      applyTransform();
      await load();
      installViewportGestures();
      startFrameLoop();
      stopLive = onLive((type, data) => {
        if (type === 'board.saved' && String(data['collection_id'] ?? '') === collectionId) {
          const positions = (data['positions'] as { object_id: string; x: number; y: number }[]) ?? [];
          for (const position of positions) {
            const card = cards.find((candidate) => candidate.objectId === position.object_id);
            if (card === undefined) continue;
            const node = surface.querySelector<HTMLElement>(`[data-board-card="${card.objectId}"]`);
            const from = node === null ? { x: card.x, y: card.y } : drawnPosition(card);
            card.x = position.x;
            card.y = position.y;
            card.saved = { x: position.x, y: position.y };
            if (node === null) continue;
            node.style.transform = `translate(${card.x}px, ${card.y}px)`;
            if (!prefersReducedMotion()) {
              animate(
                node,
                [
                  { transform: `translate(${from.x}px, ${from.y}px)` },
                  { transform: `translate(${card.x}px, ${card.y}px)` },
                ],
                BOARD_LIVE_SLIDE_MS,
              );
            }
          }
          renderList();
          return;
        }
        if (type === 'object.saved' || type === 'object.removed' || type === 'backlinks.changed') void load();
      });
    },
    unmount(): void {
      if (stopLive !== null) stopLive();
      if (frameId !== 0) cancelAnimationFrame(frameId);
      if (nudgeTimer !== 0) window.clearTimeout(nudgeTimer);
    },
  };
}
