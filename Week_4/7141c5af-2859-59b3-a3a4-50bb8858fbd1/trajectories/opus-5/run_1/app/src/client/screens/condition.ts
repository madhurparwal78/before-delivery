/**
 * The condition map: pins placed by tap, click or keyboard crosshair, forming
 * one keyboard composite with a single Tab stop.
 */
import { EMPTY, F } from '../../shared/feedback.ts';
import { PIN_KIND_OPTIONS } from '../../shared/deskLinks.ts';
import { chairDrawing } from '../../shared/drawings.ts';
import { api, ApiError, fieldProblems } from '../ui/api.ts';
import { all, el, need, patchList, setAttr, setHidden, setText } from '../ui/dom.ts';
import { announce, clearProblems, showProblems, withPending } from '../ui/shell.ts';
import { field, openModal, openPopover } from '../ui/dialog.ts';
import { body, pieceId, setRefresher, wireMainAction } from './deskShell.ts';
import { noteToHtml } from '../../shared/noteMarkup.ts';

interface Pin {
  id: string;
  number: number;
  x: string;
  y: string;
  kind: string;
  note: string;
  signed: boolean;
}

const KIND_NAMES = new Map<string, string>(
  PIN_KIND_OPTIONS.map((option) => [option.value as string, option.label as string]),
);

function oneDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export async function startCondition(): Promise<void> {
  const screen = body();
  const piece = pieceId();

  const map = el('div', {
    class: 'condition-map',
    role: 'group',
    'aria-label': 'Condition map',
    'data-part': 'condition-map',
  });
  map.append(el('div', { class: 'map-drawing', html: chairDrawing(`condition-${piece}`) }));
  const pinLayer = el('div', { class: 'pin-layer' });
  map.append(pinLayer);

  const mapTile = el('div', { class: 'tile tile-large' }, [map]);
  const listTile = el('div', { class: 'tile' }, [
    el('h2', { text: 'Pins' }),
    el('ol', { class: 'pin-list', id: 'pin-list' }),
    el('p', { class: 'tile-empty', id: 'pin-empty', text: EMPTY.pins, hidden: true }),
  ]);
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Pins' }),
    el('p', { class: 'figure', id: 'pin-count', text: '0' }),
  ]);
  const addPin = el('button', { type: 'button', class: 'button-primary', text: 'Add a pin', id: 'add-a-pin' });

  screen.textContent = '';
  screen.append(mint, mapTile, listTile, el('p', { class: 'screen-action' }, [addPin]));

  let pins: Pin[] = [];
  let chosen = 0;
  let crosshair: HTMLElement | null = null;

  const reading = (): Pin[] =>
    [...pins].sort((a, b) => Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x));

  /** One Tab stop: the chosen pin carries it and the rest leave the order. */
  const applyRoving = (): void => {
    const buttons = all<HTMLElement>('[data-part="pin"]', pinLayer);
    buttons.forEach((button, index) => {
      setAttr(button, 'tabindex', index === chosen ? '0' : '-1');
    });
  };

  const removePin = async (pin: Pin): Promise<void> => {
    await api.remove(`/api/pieces/${piece}/pins/${pin.id}`);
    const order = reading();
    const at = order.findIndex((item) => item.id === pin.id);
    announce(F.pinRemoved);
    await load();
    // Focus moves to the next pin, or to `Add a pin` when none is left.
    const after = reading();
    if (after.length === 0) {
      addPin.focus();
      return;
    }
    chosen = Math.min(at, after.length - 1);
    applyRoving();
    all<HTMLElement>('[data-part="pin"]', pinLayer)[chosen]?.focus();
  };

  const openPinPopover = (button: HTMLElement, pin: Pin): void => {
    openPopover({
      name: `Pin ${pin.number}`,
      opener: button,
      anchor: button,
      build(popoverBody, close) {
        popoverBody.append(
          el('p', { class: 'popover-kind', text: KIND_NAMES.get(pin.kind) ?? pin.kind }),
          el('p', { class: 'popover-note', html: noteToHtml(pin.note) }),
        );
        const remove = el('button', { type: 'button', text: 'Remove pin' });
        remove.addEventListener('click', () => {
          void withPending(remove, async () => {
            close();
            await removePin(pin);
          });
        });
        popoverBody.append(el('p', {}, [remove]));
      },
    });
  };

  const savePin = (x: number, y: number, opener: HTMLElement): void => {
    openModal({
      name: 'Pin',
      opener,
      build(dialogBody, handle) {
        const kind = el('select', { name: 'kind' });
        for (const option of PIN_KIND_OPTIONS) {
          kind.append(el('option', { value: option.value, text: option.label }));
        }
        const note = el('textarea', { name: 'note', rows: 3 });
        const signed = el('input', { type: 'checkbox', name: 'signed' });
        const save = el('button', { type: 'button', class: 'button-primary', text: 'Save pin' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(
          field('pin-kind', 'Kind', kind),
          field('pin-note', 'Note', note),
          el('p', { class: 'field field-check' }, [signed, el('label', { for: 'pin-signed', text: 'Signed note' })]),
          el('p', { class: 'dialog-actions' }, [save, close]),
        );
        signed.id = 'pin-signed';
        close.addEventListener('click', () => handle.close());
        save.addEventListener('click', () => {
          void withPending(save, async () => {
            clearProblems(handle.problems, [kind, note]);
            try {
              await api.post(`/api/pieces/${piece}/pins`, {
                x: oneDecimal(x),
                y: oneDecimal(y),
                kind: kind.value,
                note: note.value,
                signed: signed.checked,
              });
              handle.close();
              announce(F.pinPlaced(oneDecimal(x), oneDecimal(y)));
              await load();
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              const problems = fieldProblems(error);
              showProblems(
                handle.problems,
                problems.length > 0 ? problems : [{ field: 'note', message: error.failure.message }],
                (name) => (name === 'kind' ? kind : note),
                'Problems',
              );
            }
          });
        });
      },
    });
  };

  // A tap or click places a pin at that point.
  map.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-part="pin"]')) return;
    if (crosshair) return;
    const box = map.getBoundingClientRect();
    const x = clamp(((event.clientX - box.left) / box.width) * 100);
    const y = clamp(((event.clientY - box.top) / box.height) * 100);
    savePin(x, y, addPin);
  });

  const stopCrosshair = (): void => {
    crosshair?.remove();
    crosshair = null;
  };

  // By keyboard, `Add a pin` shows a crosshair at the centre.
  addPin.addEventListener('click', (event) => {
    if ((event as PointerEvent).pointerType === 'mouse') {
      savePin(50, 50, addPin);
      return;
    }
    startCrosshair();
  });
  addPin.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    startCrosshair();
  });
  wireMainAction(() => startCrosshair());

  function startCrosshair(): void {
    stopCrosshair();
    let x = 50;
    let y = 50;
    const node = el('div', {
      class: 'crosshair',
      'data-part': 'crosshair',
      'data-x': '50.0',
      'data-y': '50.0',
      tabindex: '0',
      role: 'application',
      'aria-label': 'Crosshair',
    });
    crosshair = node;
    const place = (): void => {
      node.dataset.x = oneDecimal(x);
      node.dataset.y = oneDecimal(y);
      node.style.left = `${x}%`;
      node.style.top = `${y}%`;
    };
    place();
    map.append(node);
    node.focus();

    node.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 10 : 1;
      switch (event.key) {
        case 'ArrowLeft':
          x = clamp(x - step);
          break;
        case 'ArrowRight':
          x = clamp(x + step);
          break;
        case 'ArrowUp':
          y = clamp(y - step);
          break;
        case 'ArrowDown':
          y = clamp(y + step);
          break;
        case 'Enter': {
          event.preventDefault();
          const atX = x;
          const atY = y;
          stopCrosshair();
          savePin(atX, atY, addPin);
          return;
        }
        case 'Escape':
          event.preventDefault();
          stopCrosshair();
          addPin.focus();
          return;
        default:
          return;
      }
      event.preventDefault();
      place();
    });
  }

  async function load(): Promise<void> {
    const answer = (await api.get(`/api/pieces/${piece}/pins`)) as { pins: Pin[] };
    pins = answer.pins;
    const order = reading();
    if (chosen >= order.length) chosen = Math.max(0, order.length - 1);

    patchList(
      pinLayer,
      order,
      (pin) => pin.id,
      () =>
        el('button', {
          type: 'button',
          class: 'pin',
          'data-part': 'pin',
          tabindex: '-1',
        }),
      (node, pin) => {
        const name = `Pin ${pin.number}: ${KIND_NAMES.get(pin.kind) ?? pin.kind}`;
        setAttr(node, 'aria-label', name);
        setText(node, String(pin.number));
        node.dataset.x = pin.x;
        node.dataset.y = pin.y;
        node.style.left = `${pin.x}%`;
        node.style.top = `${pin.y}%`;
        node.onclick = () => {
          chosen = order.findIndex((item) => item.id === pin.id);
          applyRoving();
          openPinPopover(node, pin);
        };
        node.onkeydown = (event: KeyboardEvent) => {
          const buttons = all<HTMLElement>('[data-part="pin"]', pinLayer);
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            chosen = (chosen + 1) % buttons.length;
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            chosen = (chosen - 1 + buttons.length) % buttons.length;
          } else if (event.key === 'Enter') {
            event.preventDefault();
            openPinPopover(node, pin);
            return;
          } else {
            return;
          }
          applyRoving();
          buttons[chosen]?.focus();
        };
      },
    );
    applyRoving();

    const list = need('#pin-list');
    patchList(
      list,
      order,
      (pin) => pin.id,
      () => el('li', { class: 'pin-row' }),
      (node, pin) => {
        node.innerHTML = '';
        node.append(
          el('span', { class: 'pin-number', text: `Pin ${pin.number}` }),
          el('span', { class: 'pin-kind', text: KIND_NAMES.get(pin.kind) ?? pin.kind }),
          el('span', { class: 'pin-at', text: `${pin.x}, ${pin.y}` }),
          el('span', { class: 'pin-note', html: noteToHtml(pin.note) }),
          el('span', { class: 'pin-signed', text: pin.signed ? 'Signed note' : '' }),
        );
      },
    );
    setHidden(need<HTMLElement>('#pin-empty'), order.length > 0);
    setText(need('#pin-count'), String(order.length));
  }

  await load();
  setRefresher(load);
}
