import { announce as say } from '../../shared/copy.js';
import { displayText } from '../../shared/types.js';
import { clear, el } from '../dom.js';
import { announce } from '../regions.js';
import { nodeName, type Node, type Tree } from './model.js';

export interface BoardHost {
  tree: Tree;
  move(bulletId: string, parentId: string, index: number): Promise<boolean>;
}

interface Column {
  node: Node;
  cards: Node[];
}

/** The board: the view's children as columns, their children as cards. */
export function renderBoard(host: BoardHost, container: HTMLElement): void {
  const columns: Column[] = host.tree.roots.map((node) => ({ node, cards: [...node.children] }));
  let held: { card: Node; from: { column: number; index: number } } | null = null;
  let heldAt: { column: number; index: number } | null = null;
  let focusId: string | null = null;

  const cardElements = new Map<string, HTMLElement>();

  const columnName = (index: number): string => displayText(columns[index]!.node.bullet);

  const draw = (): void => {
    clear(container);
    cardElements.clear();
    for (const [columnIndex, column] of columns.entries()) {
      const list = el('ul', { role: 'list', class: 'board-cards' });
      for (const [cardIndex, card] of column.cards.entries()) {
        const item = el('li', {
          role: 'listitem',
          class: 'board-card',
          tabindex: '0',
          'aria-label': nodeName(card.bullet),
          'data-bullet-id': card.bullet.id,
          'data-column': columnIndex,
          'data-index': cardIndex
        }, [el('span', { class: 'board-card-text' }, [displayText(card.bullet)])]);
        if (held !== null && held.card.bullet.id === card.bullet.id) item.classList.add('held');
        cardElements.set(card.bullet.id, item);
        list.append(item);
      }
      const count = column.cards.length;
      container.append(
        el('section', {
          role: 'region',
          class: 'board-column',
          'aria-label': displayText(column.node.bullet),
          'data-column': columnIndex
        }, [
          el('header', { class: 'board-column-head' }, [
            el('h2', {}, [displayText(column.node.bullet)]),
            el('p', { class: 'card-count' }, [count === 1 ? '1 card' : `${count} cards`])
          ]),
          list
        ])
      );
    }
    if (focusId !== null) cardElements.get(focusId)?.focus();
  };

  const place = (target: { column: number; index: number }): void => {
    if (held === null || heldAt === null) return;
    const source = columns[heldAt.column]!;
    source.cards.splice(heldAt.index, 1);
    const destination = columns[target.column]!;
    const index = Math.max(0, Math.min(target.index, destination.cards.length));
    destination.cards.splice(index, 0, held.card);
    heldAt = { column: target.column, index };
    focusId = held.card.bullet.id;
    draw();
  };

  const announceStep = (): void => {
    if (held === null || heldAt === null) return;
    const column = columns[heldAt.column]!;
    announce(
      say.boardStep(
        displayText(held.card.bullet),
        heldAt.index + 1,
        column.cards.length,
        columnName(heldAt.column)
      )
    );
  };

  const pickUp = (card: Node, columnIndex: number, index: number): void => {
    held = { card, from: { column: columnIndex, index } };
    heldAt = { column: columnIndex, index };
    focusId = card.bullet.id;
    draw();
    announce(say.boardPickUp(displayText(card.bullet)));
  };

  const cancel = (): void => {
    if (held === null) return;
    const card = held.card;
    const from = held.from;
    place(from);
    const name = displayText(card.bullet);
    held = null;
    heldAt = null;
    draw();
    announce(say.boardCancel(name, columnName(from.column)));
  };

  const drop = (): void => {
    if (held === null || heldAt === null) return;
    const card = held.card;
    const at = heldAt;
    const column = columns[at.column]!;
    held = null;
    heldAt = null;
    draw();
    announce(
      say.boardDrop(displayText(card.bullet), displayText(column.node.bullet), at.index + 1, column.cards.length)
    );
    void host.move(card.bullet.id, column.node.bullet.id, at.index);
  };

  const locate = (id: string): { column: number; index: number } | null => {
    for (const [columnIndex, column] of columns.entries()) {
      const index = column.cards.findIndex((card) => card.bullet.id === id);
      if (index > -1) return { column: columnIndex, index };
    }
    return null;
  };

  container.addEventListener('keydown', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('.board-card');
    if (target === null) return;
    const id = target.dataset['bulletId'];
    if (id === undefined) return;
    const at = locate(id);
    if (at === null) return;
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (held === null) {
        const card = columns[at.column]!.cards[at.index]!;
        pickUp(card, at.column, at.index);
      } else {
        drop();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (held === null || heldAt === null) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = heldAt.index + (event.key === 'ArrowUp' ? -1 : 1);
      if (next < 0 || next >= columns[heldAt.column]!.cards.length) return;
      place({ column: heldAt.column, index: next });
      announceStep();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const nextColumn = heldAt.column + (event.key === 'ArrowLeft' ? -1 : 1);
      if (nextColumn < 0 || nextColumn >= columns.length) return;
      const cards = columns[nextColumn]!.cards.length;
      place({ column: nextColumn, index: Math.min(heldAt.index, cards) });
      announceStep();
    }
  });

  let pointerStart: { x: number; y: number; id: string; column: number; index: number } | null = null;
  let longPress = 0;
  let dragging = false;

  const dropLine = el('div', { class: 'drop-line', 'aria-hidden': 'true' });

  const targetFromPoint = (x: number, y: number): { column: number; index: number } | null => {
    const sections = [...container.querySelectorAll<HTMLElement>('.board-column')];
    let columnIndex = -1;
    for (const [index, section] of sections.entries()) {
      const rect = section.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right) columnIndex = index;
    }
    if (columnIndex === -1) return null;
    const cards = [...sections[columnIndex]!.querySelectorAll<HTMLElement>('.board-card')];
    let index = cards.length;
    for (const [cardIndex, card] of cards.entries()) {
      const rect = card.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        index = cardIndex;
        break;
      }
    }
    return { column: columnIndex, index };
  };

  container.addEventListener('pointerdown', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.board-card');
    if (card === null) return;
    const id = card.dataset['bulletId'];
    if (id === undefined) return;
    const at = locate(id);
    if (at === null) return;
    pointerStart = { x: event.clientX, y: event.clientY, id, column: at.column, index: at.index };
    if (event.pointerType === 'touch') {
      longPress = window.setTimeout(() => {
        const node = columns[at.column]!.cards[at.index]!;
        dragging = true;
        pickUp(node, at.column, at.index);
      }, 450);
    }
  });

  container.addEventListener('pointermove', (event) => {
    if (pointerStart === null) return;
    const moved =
      Math.abs(event.clientX - pointerStart.x) + Math.abs(event.clientY - pointerStart.y) > 6;
    if (!dragging && moved && event.pointerType !== 'touch') {
      const node = columns[pointerStart.column]!.cards[pointerStart.index]!;
      dragging = true;
      pickUp(node, pointerStart.column, pointerStart.index);
    }
    if (!dragging) return;
    event.preventDefault();
    const target = targetFromPoint(event.clientX, event.clientY);
    if (target === null) return;
    const section = container.querySelector<HTMLElement>(`.board-column[data-column="${target.column}"]`);
    const list = section?.querySelector('.board-cards');
    if (list === null || list === undefined) return;
    const cards = [...list.querySelectorAll('.board-card')];
    const before = cards[target.index] ?? null;
    list.insertBefore(dropLine, before);
    const lifted = cardElements.get(pointerStart.id);
    if (lifted !== undefined) {
      lifted.classList.add('lifted');
      lifted.style.transform = `translate(${event.clientX - pointerStart.x}px, ${event.clientY - pointerStart.y}px)`;
    }
  });

  const endPointer = (event: PointerEvent): void => {
    window.clearTimeout(longPress);
    if (pointerStart === null) return;
    const started = pointerStart;
    pointerStart = null;
    if (!dragging) return;
    dragging = false;
    dropLine.remove();
    const lifted = cardElements.get(started.id);
    if (lifted !== undefined) {
      lifted.classList.remove('lifted');
      lifted.style.transform = '';
    }
    const target = targetFromPoint(event.clientX, event.clientY);
    if (target !== null) {
      const adjusted =
        target.column === started.column && target.index > started.index
          ? { column: target.column, index: target.index - 1 }
          : target;
      place(adjusted);
      drop();
      return;
    }
    cancel();
  };

  container.addEventListener('pointerup', endPointer);
  container.addEventListener('pointercancel', endPointer);

  draw();
}
