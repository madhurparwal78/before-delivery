import type { Task } from '../api.js';
import { el, on } from '../dom.js';
import { enableDrag, elementUnder } from '../drag.js';
import { animate, fixed4 } from '../motion.js';
import { patchTask } from '../save.js';
import { announce } from '../status.js';
import { settings } from '../state.js';
import { traceLine, type ProjectContext, type View } from './shared.js';

const STATUS = 'Board status';

interface Pickup {
  taskId: string;
  fromSection: string;
  fromPosition: number;
  section: string;
  position: number;
}

export function createBoardView(context: ProjectContext): View {
  const node = el('div', { class: 'board' });
  const traceHost = el('div', { class: 'trace-host' });
  const columns = el('div', { class: 'board__columns' });
  node.append(traceHost, columns);

  let pickup: Pickup | null = null;
  const tokens = new WeakMap<HTMLElement, number>();
  let nextToken = 1;

  const sectionName = (sectionId: string): string =>
    context.project.sections.find((section) => section.id === sectionId)?.name ?? '';

  const columnNode = (sectionId: string): HTMLElement | null =>
    columns.querySelector<HTMLElement>(`[data-column-section="${sectionId}"] .board__cards`);

  const cardNode = (taskId: string): HTMLElement | null =>
    columns.querySelector<HTMLElement>(`[data-task="${taskId}"]`);

  const cardsIn = (sectionId: string): HTMLElement[] => {
    const host = columnNode(sectionId);
    return host ? Array.from(host.querySelectorAll<HTMLElement>('[data-task]')) : [];
  };

  const relabel = () => {
    for (const section of context.project.sections) {
      const cards = cardsIn(section.id);
      cards.forEach((card, index) => {
        const task = context.byId.get(card.dataset.task as string);
        if (!task) return;
        card.dataset.position = String(index + 1);
        card.dataset.section = section.id;
        card.setAttribute(
          'aria-label',
          `${task.name}, ${section.name}, position ${index + 1} of ${cards.length}`,
        );
      });
    }
  };

  const describe = (taskId: string): string => {
    const card = cardNode(taskId);
    return card ? (card.getAttribute('aria-label') as string) : '';
  };

  const animateMove = (card: HTMLElement, before: DOMRect) => {
    const after = card.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    const token = nextToken;
    nextToken += 1;
    tokens.set(card, token);
    card.setAttribute('data-motion', 'moving');
    animate(
      settings.moveMs,
      (eased) => {
        if (tokens.get(card) !== token) return;
        card.setAttribute('data-move-progress', fixed4(eased));
        card.style.setProperty(
          'transform',
          `translate(${dx * (1 - eased)}px, ${dy * (1 - eased)}px)`,
        );
      },
      () => {
        if (tokens.get(card) !== token) return;
        card.setAttribute('data-move-progress', '1.0000');
        card.setAttribute('data-motion', 'settled');
        card.style.removeProperty('transform');
      },
    );
  };

  const placeCard = (card: HTMLElement, sectionId: string, position: number) => {
    const host = columnNode(sectionId);
    if (!host) return;
    const others = Array.from(host.querySelectorAll<HTMLElement>('[data-task]')).filter(
      (candidate) => candidate !== card,
    );
    const target = others[position - 1] ?? null;
    host.insertBefore(card, target);
  };

  const buildCard = (task: Task): HTMLElement => {
    const card = el('div', {
      role: 'button',
      tabindex: '0',
      class: 'board__card',
      'data-task': task.id,
      'data-section': task.section,
      'data-position': String(task.position),
      'data-move-progress': '1.0000',
      'data-motion': 'settled',
    });
    card.appendChild(el('p', { class: 'board__card-name' }, task.name));
    if (task.effort !== null) {
      card.appendChild(el('p', { class: 'board__card-meta tabular' }, `${task.effort} h`));
    }
    enableDrag(card, {
      onStart: () => card.classList.add('is-dragging'),
      onDrop: (x, y) => {
        card.classList.remove('is-dragging');
        const before = card.getBoundingClientRect();
        const column = elementUnder<HTMLElement>(x, y, '[data-column-section]');
        if (!column) return;
        const sectionId = column.dataset.columnSection as string;
        const siblings = cardsIn(sectionId).filter((candidate) => candidate !== card);
        let position = siblings.length + 1;
        for (let index = 0; index < siblings.length; index += 1) {
          const box = siblings[index].getBoundingClientRect();
          if (y < box.top + box.height / 2) {
            position = index + 1;
            break;
          }
        }
        placeCard(card, sectionId, position);
        relabel();
        animateMove(card, before);
        announce(
          STATUS,
          `Dropped ${task.name} in ${sectionName(sectionId)}, position ${position} of ${cardsIn(sectionId).length}.`,
        );
        void commit(task.id, sectionId, position);
      },
      onCancel: () => card.classList.remove('is-dragging'),
    });
    on(card, 'click', () => {
      if (pickup) return;
      context.openTask(task.id, card);
    });
    return card;
  };

  const commit = async (taskId: string, sectionId: string, position: number) => {
    const task = context.byId.get(taskId);
    if (!task) return;
    const outcome = await patchTask(taskId, {
      version: task.version,
      section: sectionId,
      position,
    });
    if (!outcome.task) rebuild();
  };

  on(node, 'keydown', (event) => {
    const card = (event.target as HTMLElement).closest('[data-task]') as HTMLElement | null;
    if (!card) return;
    const taskId = card.dataset.task as string;
    const task = context.byId.get(taskId);
    if (!task) return;

    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (!pickup) {
        const cards = cardsIn(task.section);
        pickup = {
          taskId,
          fromSection: card.dataset.section as string,
          fromPosition: cards.indexOf(card) + 1,
          section: card.dataset.section as string,
          position: cards.indexOf(card) + 1,
        };
        card.classList.add('is-picked');
        card.setAttribute('aria-grabbed', 'true');
        announce(
          STATUS,
          `Picked up ${task.name}. ${sectionName(pickup.section)}, position ${pickup.position} of ${cards.length}.`,
        );
        return;
      }
      const before = card.getBoundingClientRect();
      const dropped = pickup;
      pickup = null;
      card.classList.remove('is-picked');
      card.removeAttribute('aria-grabbed');
      relabel();
      animateMove(card, before);
      const count = cardsIn(dropped.section).length;
      announce(
        STATUS,
        `Dropped ${task.name} in ${sectionName(dropped.section)}, position ${dropped.position} of ${count}.`,
      );
      void commit(taskId, dropped.section, dropped.position);
      return;
    }

    if (event.key === 'Escape' && pickup) {
      event.preventDefault();
      const original = pickup;
      pickup = null;
      card.classList.remove('is-picked');
      card.removeAttribute('aria-grabbed');
      placeCard(card, original.fromSection, original.fromPosition);
      relabel();
      const count = cardsIn(original.fromSection).length;
      announce(
        STATUS,
        `Move cancelled. ${task.name} is back in ${sectionName(original.fromSection)}, position ${original.fromPosition} of ${count}.`,
      );
      return;
    }

    if (event.key === 'Enter' && !pickup) {
      event.preventDefault();
      context.openTask(taskId, card);
      return;
    }

    if (!pickup) return;
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const sections = context.project.sections;
    const sectionIndex = sections.findIndex((section) => section.id === pickup!.section);

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const nextSection = sections[sectionIndex + (event.key === 'ArrowRight' ? 1 : -1)];
      if (!nextSection) return;
      const existing = cardsIn(nextSection.id).filter((candidate) => candidate !== card).length;
      const position = Math.min(pickup.position, existing + 1);
      pickup.section = nextSection.id;
      pickup.position = position;
      placeCard(card, nextSection.id, position);
    } else {
      const siblings = cardsIn(pickup.section);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const position = Math.min(Math.max(1, pickup.position + delta), siblings.length);
      pickup.position = position;
      placeCard(card, pickup.section, position);
    }
    relabel();
    card.focus();
    announce(STATUS, `${describe(pickup.taskId)}.`);
  });

  const rebuild = () => {
    columns.replaceChildren();
    for (const section of context.project.sections) {
      const cards = el('div', { class: 'board__cards' });
      const column = el(
        'div',
        {
          role: 'group',
          'aria-label': section.name,
          class: 'board__column',
          'data-column-section': section.id,
        },
        [el('h3', { class: 'board__column-title' }, section.name), cards],
      );
      for (const task of context.tasks.filter(
        (candidate) => candidate.parentId === null && candidate.section === section.id,
      )) {
        cards.appendChild(buildCard(task));
      }
      columns.appendChild(column);
    }
    relabel();
  };

  const upsert = (task: Task) => {
    const card = cardNode(task.id);
    if (task.parentId !== null) {
      card?.remove();
      relabel();
      return;
    }
    if (!card) {
      const fresh = buildCard(task);
      placeCard(fresh, task.section, task.position);
      relabel();
      return;
    }
    const name = card.querySelector('.board__card-name');
    if (name) name.textContent = task.name;
    if (card.dataset.section !== task.section || Number(card.dataset.position) !== task.position) {
      const before = card.getBoundingClientRect();
      placeCard(card, task.section, task.position);
      relabel();
      animateMove(card, before);
      announce(STATUS, `${describe(task.id)}.`);
      return;
    }
    relabel();
  };

  const remove = (taskId: string) => {
    cardNode(taskId)?.remove();
    relabel();
  };

  const trace = (taskIds: string[]) => {
    traceHost.replaceChildren();
    const host = traceHost.getBoundingClientRect();
    const points = taskIds
      .map((id) => cardNode(id))
      .filter((card): card is HTMLElement => card !== null)
      .map((card) => {
        const box = card.getBoundingClientRect();
        return {
          x: box.left - host.left + box.width / 2,
          y: box.top - host.top + box.height / 2,
        };
      });
    const line = traceLine(points);
    if (line) traceHost.appendChild(line);
  };

  rebuild();
  return { node, upsert, remove, rebuild, trace };
}
