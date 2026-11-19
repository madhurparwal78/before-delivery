/**
 * The hide lay. One keyboard composite with one Tab stop, a mouse drag at 1280
 * and a bottom bar at 375 that does it all with no drag. Every refusal comes
 * from the server and every glide is the same element moving.
 */
import { F } from '../../shared/feedback.ts';
import { hideGrain } from '../../shared/drawings.ts';
import { PIECE_NAMES, allowedRotations, boxOf, type PieceName } from '../../shared/pattern.ts';
import { api, ApiError } from '../ui/api.ts';
import { DURATION, animate, reducedMotion, rollFigure, stopAnimations } from '../ui/motion.ts';
import { all, el, find, need, setAttr, setText } from '../ui/dom.ts';
import { announce, withPending } from '../ui/shell.ts';
import { openModal } from '../ui/dialog.ts';
import { body, pieceId, setRefresher } from './deskShell.ts';

interface Placement {
  name: PieceName;
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  rotation: number;
  state: 'tray' | 'placed';
}

interface Flaw {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Layout {
  version: number;
  hide: { widthCm: number; heightCm: number; areaSqFt: string };
  flaws: Flaw[];
  pieces: Placement[];
  usedSqFt: string;
  usedPercent: string;
}

/** A piece lifted off the hide, held only on screen until the server answers. */
interface Lifted {
  name: PieceName;
  x: number;
  y: number;
  rotation: number;
  /** Where it was lifted from, so Escape can put it back. */
  from: { x: number | null; y: number | null; rotation: number; state: 'tray' | 'placed' };
  /** The version read when it was lifted. */
  version: number;
}

export async function startHide(): Promise<void> {
  const screen = body();
  const piece = pieceId();

  let layout: Layout | null = null;
  let chosen = 0;
  let lifted: Lifted | null = null;

  const hide = el('div', {
    class: 'hide',
    'data-part': 'hide',
    role: 'application',
    'aria-label': 'Hide',
    tabindex: '0',
  });
  const hideTile = el('div', { class: 'tile tile-large' }, [hide]);
  const tray = el('div', { class: 'tile', role: 'region', 'aria-label': 'Tray' }, [
    el('h2', { text: 'Tray' }),
    el('ul', { class: 'tray-list', id: 'tray-list' }),
  ]);
  const figure = el('p', { class: 'figure', 'data-part': 'hide-figure', id: 'hide-figure' });
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Leather used' }),
    figure,
  ]);
  const clear = el('button', { type: 'button', text: 'Clear the hide', id: 'clear-hide' });
  const bar = find<HTMLElement>('#hide-controls');

  screen.textContent = '';
  screen.append(mint, hideTile, tray, el('p', { class: 'screen-action' }, [clear]));

  // ----------------------------------------------------------------- drawing

  const pieceNodes = new Map<PieceName, HTMLElement>();

  const liveOf = (name: PieceName): Placement => {
    const stored = layout!.pieces.find((p) => p.name === name)!;
    if (lifted && lifted.name === name) {
      const box = boxOf(name, lifted.rotation);
      return { ...stored, x: lifted.x, y: lifted.y, rotation: lifted.rotation, ...box, state: 'placed' };
    }
    return stored;
  };

  const draw = (): void => {
    if (!layout) return;
    const { widthCm, heightCm } = layout.hide;
    let grain = find<HTMLElement>('.hide-grain', hide);
    if (!grain) {
      hide.innerHTML = `<svg class="hide-grain" viewBox="0 0 ${widthCm} ${heightCm}" preserveAspectRatio="none" aria-hidden="true">${hideGrain(
        piece,
        widthCm,
        heightCm,
      )}${layout.flaws
        .map(
          (flaw) =>
            `<rect data-part="flaw" data-x="${flaw.x}" data-y="${flaw.y}" data-width="${flaw.width}" data-height="${flaw.height}" x="${flaw.x}" y="${flaw.y}" width="${flaw.width}" height="${flaw.height}" class="flaw"/>`,
        )
        .join('')}</svg>`;
      grain = find<HTMLElement>('.hide-grain', hide);
    }

    for (const name of PIECE_NAMES) {
      const placement = liveOf(name);
      let node = pieceNodes.get(name);
      if (!node) {
        node = el('div', { class: 'pattern-piece', 'data-part': 'pattern-piece', 'data-piece': name }, [
          el('span', { class: 'piece-name', text: name }),
        ]);
        pieceNodes.set(name, node);
      }
      const isLifted = lifted?.name === name;
      const state = isLifted ? 'lifted' : placement.state;
      setAttr(node, 'data-state', state);
      setAttr(node, 'data-chosen', PIECE_NAMES[chosen] === name ? 'true' : null);
      setAttr(node, 'data-rotation', String(placement.rotation));

      if (state === 'tray') {
        node.removeAttribute('data-x');
        node.removeAttribute('data-y');
        if (node.parentElement !== need('#tray-list')) {
          const item = el('li', {}, [node]);
          need('#tray-list').append(item);
        }
        node.style.removeProperty('left');
        node.style.removeProperty('top');
        node.style.removeProperty('width');
        node.style.removeProperty('height');
      } else {
        setAttr(node, 'data-x', String(placement.x ?? 0));
        setAttr(node, 'data-y', String(placement.y ?? 0));
        const box = boxOf(name, placement.rotation);
        node.style.left = `${((placement.x ?? 0) / widthCm) * 100}%`;
        node.style.top = `${((placement.y ?? 0) / heightCm) * 100}%`;
        node.style.width = `${(box.width / widthCm) * 100}%`;
        node.style.height = `${(box.height / heightCm) * 100}%`;
        if (node.parentElement !== hide) {
          node.parentElement?.closest('li')?.remove();
          hide.append(node);
        }
      }
    }

    rollFigure(figure, F.hideFigure(layout.usedSqFt, layout.usedPercent));
    drawBar();
  };

  // ------------------------------------------------------------------ server

  const refuse = (error: unknown): void => {
    if (!(error instanceof ApiError)) throw error;
    announce(error.failure.message);
  };

  const place = async (): Promise<boolean> => {
    if (!lifted || !layout) return false;
    const held = lifted;
    try {
      const answer = (await api.put(`/api/pieces/${piece}/layout/placements/${encodeURIComponent(held.name)}`, {
        x: held.x,
        y: held.y,
        rotation: held.rotation,
        version: held.version,
      })) as { layout: Layout };
      layout = answer.layout;
      lifted = null;
      draw();
      announce(F.placed(held.name, held.x, held.y));
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.failure.status === 412) {
        // The piece stays lifted where it was dropped; the next try uses the
        // newest version.
        const fresh = (await api.get(`/api/pieces/${piece}/layout`)) as { layout: Layout };
        layout = fresh.layout;
        held.version = fresh.layout.version;
        draw();
        announce(error.failure.message);
        return false;
      }
      refuse(error);
      return false;
    }
  };

  const toTray = async (name: PieceName): Promise<void> => {
    if (!layout) return;
    try {
      const answer = (await api.remove(
        `/api/pieces/${piece}/layout/placements/${encodeURIComponent(name)}?version=${layout.version}`,
      )) as { layout: Layout };
      layout = answer.layout;
      lifted = null;
      draw();
      announce(F.toTray(name));
    } catch (error) {
      refuse(error);
    }
  };

  // ------------------------------------------------------------------ actions

  const lift = (): void => {
    if (!layout || lifted) return;
    const name = PIECE_NAMES[chosen]!;
    const stored = layout.pieces.find((p) => p.name === name)!;
    const node = pieceNodes.get(name);
    const from = node?.getBoundingClientRect();
    lifted = {
      name,
      // A piece lifted from the tray moves to 0, 0 on the hide.
      x: stored.state === 'placed' ? (stored.x ?? 0) : 0,
      y: stored.state === 'placed' ? (stored.y ?? 0) : 0,
      rotation: stored.rotation,
      from: { x: stored.x, y: stored.y, rotation: stored.rotation, state: stored.state },
      version: layout.version,
    };
    draw();
    if (node && from && stored.state === 'tray') {
      animate(node, [{ opacity: 0.6 }, { opacity: 1 }], DURATION.quick);
      const to = node.getBoundingClientRect();
      animate(
        node,
        [
          { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
          { transform: 'none' },
        ],
        DURATION.normal,
      );
    }
    announce(F.lifted(name));
  };

  /** A further press during a glide carries on from where the piece is. */
  const step = (dx: number, dy: number): void => {
    if (!lifted) return;
    const node = pieceNodes.get(lifted.name);
    const from = node?.getBoundingClientRect();
    lifted.x += dx;
    lifted.y += dy;
    draw();
    if (node && from && !reducedMotion()) {
      stopAnimations(node);
      const to = node.getBoundingClientRect();
      animate(
        node,
        [
          { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
          { transform: 'none' },
        ],
        DURATION.quick,
      );
    }
  };

  const rotate = (): void => {
    if (!lifted) return;
    const allowed = allowedRotations(lifted.name);
    const at = allowed.indexOf(lifted.rotation);
    lifted.rotation = allowed[(at + 1) % allowed.length]!;
    const node = pieceNodes.get(lifted.name);
    draw();
    if (node) animate(node, [{ opacity: 0.7 }, { opacity: 1 }], DURATION.normal);
  };

  const putBack = (): void => {
    if (!lifted) return;
    const held = lifted;
    const node = pieceNodes.get(held.name);
    const from = node?.getBoundingClientRect();
    lifted = null;
    draw();
    if (node && from) {
      const to = node.getBoundingClientRect();
      animate(
        node,
        [
          { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
          { transform: 'none' },
        ],
        DURATION.normal,
      );
    }
    announce(F.putBack(held.name));
  };

  // ----------------------------------------------------------------- keyboard

  hide.addEventListener('keydown', (event) => {
    if (!layout) return;
    const key = event.key;
    if (!lifted) {
      if (key === 'ArrowRight' || key === 'ArrowDown') {
        event.preventDefault();
        chosen = (chosen + 1) % PIECE_NAMES.length;
        draw();
      } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
        event.preventDefault();
        chosen = (chosen - 1 + PIECE_NAMES.length) % PIECE_NAMES.length;
        draw();
      } else if (key === 'Enter') {
        event.preventDefault();
        lift();
      }
      return;
    }
    const amount = event.shiftKey ? 10 : 1;
    switch (key) {
      case 'ArrowLeft':
        event.preventDefault();
        step(-amount, 0);
        break;
      case 'ArrowRight':
        event.preventDefault();
        step(amount, 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(0, -amount);
        break;
      case 'ArrowDown':
        event.preventDefault();
        step(0, amount);
        break;
      case 'r':
      case 'R':
        event.preventDefault();
        rotate();
        break;
      case 'Delete':
      case 'Backspace': {
        event.preventDefault();
        const name = lifted.name;
        void toTray(name);
        break;
      }
      case 'Enter':
        event.preventDefault();
        void place();
        break;
      case 'Escape':
        event.preventDefault();
        putBack();
        break;
      default:
        break;
    }
  });

  // -------------------------------------------------------------- mouse drag

  hide.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || !layout) return;
    const target = (event.target as Element).closest<HTMLElement>('[data-part="pattern-piece"]');
    if (!target) return;
    const name = target.dataset.piece as PieceName;
    chosen = PIECE_NAMES.indexOf(name);
    if (!lifted) lift();
    if (!lifted) return;

    const box = hide.getBoundingClientRect();
    const cmPerPx = layout.hide.widthCm / box.width;
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = lifted.x;
    const originY = lifted.y;
    hide.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      if (!lifted) return;
      lifted.x = Math.round(originX + (moveEvent.clientX - startX) * cmPerPx);
      lifted.y = Math.round(originY + (moveEvent.clientY - startY) * cmPerPx);
      draw();
    };
    const up = (): void => {
      hide.removeEventListener('pointermove', move);
      hide.removeEventListener('pointerup', up);
      if (!lifted) return;
      const held = lifted;
      const node = pieceNodes.get(held.name);
      const from = node?.getBoundingClientRect();
      void place().then((ok) => {
        if (ok) {
          if (node) animate(node, [{ opacity: 0.85 }, { opacity: 1 }], DURATION.quick);
          return;
        }
        // A drop refused for its place glides home; a 412 leaves it lifted.
        if (lifted) return;
        if (node && from) {
          const to = node.getBoundingClientRect();
          animate(
            node,
            [
              { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
              { transform: 'none' },
            ],
            DURATION.normal,
          );
        }
      });
    };
    hide.addEventListener('pointermove', move);
    hide.addEventListener('pointerup', up);
    event.preventDefault();
  });

  hide.addEventListener('keyup', (event) => {
    if (event.key === 'Escape' && lifted) putBack();
  });

  // -------------------------------------------------------------- phone bar

  function drawBar(): void {
    if (!bar || bar.dataset.built === 'true') {
      if (bar) {
        for (const button of all<HTMLElement>('[data-piece-choice]', bar)) {
          setAttr(button, 'aria-pressed', button.dataset.pieceChoice === PIECE_NAMES[chosen] ? 'true' : 'false');
        }
      }
      return;
    }
    bar.dataset.built = 'true';
    bar.textContent = '';
    for (const name of PIECE_NAMES) {
      const button = el('button', { type: 'button', text: name, 'data-piece-choice': name, 'aria-pressed': 'false' });
      button.addEventListener('click', () => {
        chosen = PIECE_NAMES.indexOf(name);
        draw();
      });
      bar.append(button);
    }
    const action = (label: string, run: () => void): void => {
      const button = el('button', { type: 'button', text: label });
      button.addEventListener('click', run);
      bar.append(button);
    };
    action('Lift', lift);
    action('Up', () => step(0, -1));
    action('Down', () => step(0, 1));
    action('Left', () => step(-1, 0));
    action('Right', () => step(1, 0));
    action('Rotate', rotate);
    action('Place', () => {
      void place();
    });
    action('Put back', putBack);
    action('To tray', () => {
      const name = lifted?.name ?? PIECE_NAMES[chosen]!;
      void toTray(name);
    });
  }

  // ------------------------------------------------------------ clear the hide

  clear.addEventListener('click', () => {
    openModal({
      name: 'Clear the hide',
      opener: clear,
      build(dialogBody, handle) {
        const run = el('button', { type: 'button', class: 'button-primary', text: 'Clear' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(
          el('p', { text: 'Every pattern piece goes back to the tray.' }),
          el('p', { class: 'dialog-actions' }, [run, close]),
        );
        close.addEventListener('click', () => handle.close());
        run.addEventListener('click', () => {
          void withPending(run, async () => {
            if (!layout) return;
            const answer = (await api.post(`/api/pieces/${piece}/layout`, {
              version: layout.version,
              placements: [],
            })) as { layout: Layout };
            layout = answer.layout;
            lifted = null;
            handle.close();
            draw();
            announce(F.hideCleared);
          });
        });
      },
    });
  });

  // ------------------------------------------------------------------- loading

  async function load(): Promise<void> {
    const answer = (await api.get(`/api/pieces/${piece}/layout`)) as { layout: Layout };
    const before = layout;
    // A refresh with no new data starts no motion and replaces no element.
    if (before && before.version === answer.layout.version) return;
    layout = answer.layout;
    if (lifted) lifted.version = answer.layout.version;
    draw();
  }

  await load();
  setRefresher(load);
  setText(need('#hide-figure'), F.hideFigure(layout!.usedSqFt, layout!.usedPercent));
}
