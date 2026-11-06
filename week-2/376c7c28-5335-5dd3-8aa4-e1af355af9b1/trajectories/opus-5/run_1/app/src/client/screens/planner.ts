import { call, del, get, newIdempotencyKey, post, RequestFailed } from '../api.ts';
import type { ScreenRender } from '../app.ts';
import { openDialog } from '../dialog.ts';
import { clearRefusal, drawElevation, showRefusal, type Drawing } from '../elevation.ts';
import { el, replace } from '../dom.ts';
import { dollars } from '../format.ts';
import { failureCopy, Region, withPending } from '../feedback.ts';
import { onLive } from '../live.ts';
import { countTo, reducedMotion, shrinkAway, slideFrom, springFrom } from '../motion.ts';
import { LOAD_STATUS_LABELS, type LoadStatus } from '../../shared/labels.ts';
import type { Kiln, Load, Ticket } from '../types.ts';

const TAKEN_LINGER_MS = 3_400;

interface Hint {
  readonly kind: 'place' | 'move' | 'remove' | 'plain';
  readonly pieceId?: string;
  readonly from?: { x: number; y: number };
}

const PLACEMENT_COPY: Record<string, string | undefined> = {
  load_not_planning: 'This load is no longer being planned.',
};

export const renderPlanner: ScreenRender = ({ mount }) => {
  const region = new Region('Planner status');
  const railList = el('div', {
    class: 'rail-list',
    role: 'listbox',
    'aria-label': 'Waiting pieces',
    tabindex: '0',
  });
  const railPanel = el('details', { class: 'rail', open: true }, [
    el('summary', { class: 'heading small', text: 'WAITING' }),
    railList,
  ]);
  const elevationHost = el('div', { class: 'elevation-host' });
  const figuresBody = el('div', { class: 'stack' });
  const figures = el('section', {
    class: 'panel',
    role: 'region',
    'aria-label': 'Load figures',
  }, [el('h2', { class: 'heading small', text: 'LOAD FIGURES' }), figuresBody]);
  const decksList = el('ul', { class: 'decks', role: 'list', 'aria-label': 'Decks' });
  const loadPicker = el('select', { class: 'picker', 'aria-label': 'Load' });
  const newLoadButton = el('button', { type: 'button', class: 'btn ghost', text: 'NEW LOAD' });
  const placeButton = el('button', { type: 'button', class: 'btn primary', text: 'PLACE PIECE' });
  const addDeckButton = el('button', { type: 'button', class: 'btn ghost', text: 'ADD DECK' });
  const removeDeckButton = el('button', { type: 'button', class: 'btn ghost', text: 'REMOVE TOP DECK' });
  const markLoadedButton = el('button', { type: 'button', class: 'btn ghost', text: 'MARK LOADED' });
  const startFiringButton = el('button', { type: 'button', class: 'btn ghost', text: 'START FIRING' });
  const startCoolingButton = el('button', { type: 'button', class: 'btn ghost', text: 'START COOLING' });
  const unloadButton = el('button', { type: 'button', class: 'btn ghost', text: 'UNLOAD' });
  const cancelLoadButton = el('button', { type: 'button', class: 'btn ghost', text: 'CANCEL LOAD' });
  const firingTag = el('span', { class: 'tag firing', text: 'FIRING' });
  firingTag.hidden = true;

  mount.appendChild(
    el('div', { class: 'planner' }, [
      el('section', { class: 'panel rail-panel' }, [railPanel]),
      el('section', { class: 'panel elevation-panel' }, [
        el('div', { class: 'row wrap' }, [loadPicker, newLoadButton, firingTag]),
        el('div', { class: 'row wrap' }, [
          placeButton,
          addDeckButton,
          removeDeckButton,
          markLoadedButton,
          startFiringButton,
          startCoolingButton,
          unloadButton,
          cancelLoadButton,
        ]),
        region.node,
        elevationHost,
      ]),
      el('section', { class: 'panel figures-panel' }, [figures, el('div', { class: 'panel bare' }, [decksList])]),
    ]),
  );

  let loads: Load[] = [];
  let kilns: Kiln[] = [];
  let current: Load | null = null;
  let waiting: Ticket[] = [];
  const taken = new Set<string>();
  let selectedTicket: string | null = null;
  let railFor: string | null = null;
  let drawing: Drawing = drawElevation(null, 300, 420);
  elevationHost.appendChild(drawing.root);
  let previousBaseY = new Map<number, number>();
  const headroomNode = el('span', { class: 'mono' });
  const valueNode = el('span', { class: 'mono' });
  const headroomMeter = el('div', {
    role: 'meter',
    'aria-label': 'Headroom',
    'aria-valuemin': '0',
    'aria-valuemax': '27',
    class: 'meter',
  });

  const planning = (): boolean => current?.status === 'planning';

  interface DeckFigure {
    readonly text: HTMLElement;
    readonly meter: HTMLElement;
    readonly wrap: HTMLElement;
  }
  const deckFigures = new Map<number, DeckFigure>();

  function deckFigure(number: number): DeckFigure {
    const held = deckFigures.get(number);
    if (held) return held;
    const text = el('span', { class: 'mono' });
    const meter = el('div', {
      role: 'meter',
      'aria-label': `Footprint, deck ${number}`,
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      class: 'meter',
    });
    const made = { text, meter, wrap: el('div', { class: 'figure' }, [text, meter]) };
    deckFigures.set(number, made);
    return made;
  }

  // The figure nodes outlive each redraw so their numerals can count from their old values.
  const drawFigures = (): void => {
    const load = current;
    if (!load) {
      replace(figuresBody, [el('p', { class: 'muted', text: 'No load selected.' })]);
      return;
    }
    replace(figuresBody, [
      el('div', { class: 'figure' }, [headroomNode, headroomMeter]),
      ...load.decks.map((deck) => deckFigure(deck.number).wrap),
      el('div', { class: 'figure' }, [valueNode]),
    ]);
    headroomMeter.setAttribute('aria-valuenow', String(load.headroom_in));
    countTo(headroomNode, load.headroom_in, (value) => `HEADROOM ${value.toFixed(3)} IN`);
    for (const deck of load.decks) {
      const figure = deckFigure(deck.number);
      figure.meter.setAttribute('aria-valuenow', String(deck.footprint_pct));
      countTo(
        figure.text,
        deck.footprint_pct,
        (value) => `FOOTPRINT D${deck.number} ${value.toFixed(1)}%`,
      );
    }
    countTo(valueNode, load.value_cents, (value) => `LOAD VALUE $${dollars(Math.round(value))}`);
  };

  const drawDecks = (): void => {
    const load = current;
    if (!load) {
      replace(decksList, []);
      return;
    }
    replace(
      decksList,
      load.decks.map((deck) =>
        el('li', { class: 'deck-row' }, [
          el('span', {
            class: 'mono',
            text: `DECK ${deck.number} · POST ${deck.post_height_in} IN · ${deck.pieces.length} PIECES`,
          }),
          el(
            'ul',
            { class: 'deck-pieces', role: 'list' },
            deck.pieces.map((piece) => {
              const move = el('button', {
                type: 'button',
                class: 'btn ghost small',
                'aria-label': `Move ${piece.title}`,
                text: 'MOVE',
              });
              move.disabled = !planning();
              move.addEventListener('click', () => openMoveDialog(piece, deck.number, move));
              const remove = el('button', {
                type: 'button',
                class: 'btn ghost small',
                'aria-label': `Remove ${piece.title}`,
                text: 'REMOVE',
              });
              remove.disabled = !planning();
              remove.addEventListener('click', () => void removePiece(piece, remove));
              return el('li', {}, [
                el('span', { class: 'piece-title', text: piece.title }),
                move,
                remove,
              ]);
            }),
          ),
        ]),
      ),
    );
  };

  const drawRail = (): void => {
    const options = waiting.map((piece) => {
      const option = el('div', {
        class: taken.has(piece.id) ? 'ticket taken' : 'ticket',
        role: 'option',
        id: `ticket-${piece.id}`,
        'data-piece': piece.id,
        'aria-selected': selectedTicket === piece.id ? 'true' : 'false',
        'aria-disabled': taken.has(piece.id) ? 'true' : null,
      }, [
        el('span', { class: 'ticket-head', text: `${piece.title} · ${piece.owner_handle}` }),
        el('span', {
          class: 'mono muted',
          text: `${piece.length_in} × ${piece.width_in} × ${piece.height_in} IN`,
        }),
        el('span', { class: 'muted', text: piece.clay_body }),
        taken.has(piece.id) ? el('span', { class: 'tag', text: 'TAKEN' }) : null,
      ]);
      if (!taken.has(piece.id)) {
        option.addEventListener('click', () => selectTicket(piece.id));
        option.addEventListener('pointerdown', (event) => beginTicketDrag(event, piece));
      }
      return option;
    });
    replace(railList, options);
    if (selectedTicket) railList.setAttribute('aria-activedescendant', `ticket-${selectedTicket}`);
    else railList.removeAttribute('aria-activedescendant');
    syncButtons();
  };

  const selectTicket = (pieceId: string): void => {
    selectedTicket = pieceId;
    for (const node of Array.from(railList.children)) {
      const isSelected = node.getAttribute('data-piece') === pieceId;
      node.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      node.classList.toggle('selected', isSelected);
    }
    railList.setAttribute('aria-activedescendant', `ticket-${pieceId}`);
    syncButtons();
  };

  railList.addEventListener('keydown', (event) => {
    const usable = waiting.filter((piece) => !taken.has(piece.id));
    if (usable.length === 0) return;
    const index = usable.findIndex((piece) => piece.id === selectedTicket);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectTicket((usable[Math.min(usable.length - 1, index + 1)] as Ticket).id);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      selectTicket((usable[Math.max(0, index <= 0 ? 0 : index - 1)] as Ticket).id);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectTicket((usable[index === -1 ? 0 : index] as Ticket).id);
    }
  });

  const syncButtons = (): void => {
    const status = current?.status ?? null;
    placeButton.disabled = !planning() || selectedTicket === null;
    addDeckButton.disabled = !planning();
    removeDeckButton.disabled = !planning();
    markLoadedButton.disabled = status !== 'planning';
    startFiringButton.disabled = status !== 'loaded';
    startCoolingButton.disabled = status !== 'firing';
    unloadButton.disabled = status !== 'cooling';
    cancelLoadButton.disabled = status !== 'planning' && status !== 'loaded';
    firingTag.hidden = status !== 'firing';
  };

  const redraw = (hint: Hint): void => {
    const box = elevationHost.getBoundingClientRect();
    const width = Math.max(240, Math.floor(box.width) || 320);
    const height = Math.max(420, Math.floor(box.height) || 420);
    const nextDrawing = drawElevation(current, width, height);
    replace(elevationHost, [nextDrawing.root]);
    const oldBase = previousBaseY;
    previousBaseY = nextDrawing.deckBaseY;
    drawing = nextDrawing;

    if (!reducedMotion()) {
      for (const [deckNumber, baseY] of nextDrawing.deckBaseY) {
        const before = oldBase.get(deckNumber);
        if (before !== undefined && Math.abs(before - baseY) > 0.5) {
          slideFrom(nextDrawing.deckGroups.get(deckNumber) as SVGElement, before - baseY);
        }
      }
      if ((hint.kind === 'place' || hint.kind === 'move') && hint.pieceId) {
        const rect = nextDrawing.pieceRects.get(hint.pieceId);
        if (rect) {
          const target = rect.getBoundingClientRect();
          const from = hint.from ?? railAnchor(hint.pieceId);
          springFrom(rect, from.x - target.x, from.y - target.y);
        }
      }
    }
    drawDecks();
    drawFigures();
    syncButtons();
  };

  const railAnchor = (pieceId: string): { x: number; y: number } => {
    const node = railList.querySelector(`[data-piece="${pieceId}"]`);
    const box = (node ?? railList).getBoundingClientRect();
    return { x: box.x, y: box.y };
  };

  const applyLoad = (load: Load, hint: Hint): void => {
    current = load;
    const index = loads.findIndex((candidate) => candidate.id === load.id);
    if (index === -1) loads = [load, ...loads];
    else loads[index] = load;
    drawPicker();
    redraw(hint);
    void loadWaiting();
  };

  const drawPicker = (): void => {
    const selected = current?.id ?? '';
    replace(
      loadPicker,
      [
        el('option', { value: '', text: 'No load selected' }),
        ...loads.map((load) =>
          el('option', {
            value: load.id,
            text: `${load.kiln.name} · ${load.firing} · ${LOAD_STATUS_LABELS[load.status]}`,
          }),
        ),
      ],
    );
    loadPicker.value = selected;
  };

  loadPicker.addEventListener('change', () => {
    const chosen = loads.find((load) => load.id === loadPicker.value) ?? null;
    current = chosen;
    selectedTicket = null;
    previousBaseY = new Map();
    redraw({ kind: 'plain' });
    void loadWaiting();
  });

  const loadWaiting = async (): Promise<void> => {
    const firing = current?.firing ?? 'bisque';
    const status = firing === 'bisque' ? 'waiting_bisque' : 'waiting_glaze';
    const pieces = await get<Ticket[]>(`/api/pieces?status=${status}&unplaced=1`).catch(() => null);
    if (!pieces) return;
    const placedHere = new Set(
      (current?.decks ?? []).flatMap((deck) => deck.pieces.map((piece) => piece.id)),
    );
    const fresh = new Set(pieces.map((piece) => piece.id));
    const key = `${current?.id ?? 'none'}|${firing}`;
    const sameRail = railFor === key;
    railFor = key;
    if (!sameRail) {
      taken.clear();
      waiting = pieces.filter((piece) => !placedHere.has(piece.id));
      if (selectedTicket && !waiting.some((piece) => piece.id === selectedTicket)) {
        selectedTicket = null;
      }
      drawRail();
      return;
    }
    // A ticket another tech placed leaves the rail only after showing as taken.
    for (const held of waiting) {
      if (!fresh.has(held.id) && !placedHere.has(held.id)) takeTicket(held.id);
    }
    waiting = [
      ...pieces.filter((piece) => !placedHere.has(piece.id)),
      ...waiting.filter((piece) => taken.has(piece.id) && !fresh.has(piece.id)),
    ];
    if (selectedTicket && !waiting.some((piece) => piece.id === selectedTicket)) {
      selectedTicket = null;
    }
    drawRail();
  };

  function takeTicket(pieceId: string): void {
    if (taken.has(pieceId)) return;
    taken.add(pieceId);
    if (selectedTicket === pieceId) selectedTicket = null;
    window.setTimeout(() => {
      taken.delete(pieceId);
      waiting = waiting.filter((piece) => piece.id !== pieceId);
      drawRail();
    }, TAKEN_LINGER_MS);
  }

  const markTaken = (pieceId: string): void => {
    takeTicket(pieceId);
    drawRail();
  };

  const refusalFor = (failure: RequestFailed['failure'], deckNumber: number): boolean => {
    if (
      failure.code === 'exceeds_headroom' ||
      failure.code === 'exceeds_footprint' ||
      failure.code === 'validation'
    ) {
      const reason =
        failure.code === 'validation'
          ? 'That deck is no longer in this load.'
          : failure.message;
      showRefusal(drawing, deckNumber, reason);
      region.say(reason);
      return true;
    }
    return false;
  };

  const sendPlacement = async (
    pieceId: string,
    deckNumber: number,
    from: { x: number; y: number } | null,
    onRefused?: (reason: string) => void,
  ): Promise<boolean> => {
    if (!current) return false;
    clearRefusal(drawing);
    const title = waiting.find((piece) => piece.id === pieceId)?.title ?? 'Piece';
    region.say('Placing…');
    try {
      const load = await post<Load>(`/api/loads/${current.id}/placements`, {
        piece_id: pieceId,
        deck: deckNumber,
      });
      applyLoad(load, { kind: 'place', pieceId, ...(from ? { from } : {}) });
      region.say(`${title} placed on deck ${deckNumber}.`);
      return true;
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.failure.code === 'piece_taken') {
        markTaken(pieceId);
        region.say(`Taken: ${title} is already in another load.`);
        onRefused?.(`Taken: ${title} is already in another load.`);
        return false;
      }
      if (refusalFor(error.failure, deckNumber)) {
        onRefused?.(
          error.failure.code === 'validation'
            ? 'That deck is no longer in this load.'
            : error.failure.message,
        );
        return false;
      }
      const copy = failureCopy(error.failure, {
        ...PLACEMENT_COPY,
        wrong_firing: `${title} is waiting for a different firing.`,
      });
      region.say(copy);
      onRefused?.(copy);
      return false;
    }
  };

  const sendMove = async (
    piece: Ticket,
    deckNumber: number,
    from: { x: number; y: number } | null,
    onRefused?: (reason: string) => void,
  ): Promise<boolean> => {
    if (!current) return false;
    clearRefusal(drawing);
    region.say('Moving…');
    try {
      const load = await post<Load>(`/api/loads/${current.id}/moves`, {
        piece_id: piece.id,
        deck: deckNumber,
      });
      applyLoad(load, { kind: 'move', pieceId: piece.id, ...(from ? { from } : {}) });
      region.say(`${piece.title} moved to deck ${deckNumber}.`);
      return true;
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (refusalFor(error.failure, deckNumber)) {
        onRefused?.(
          error.failure.code === 'validation'
            ? 'That deck is no longer in this load.'
            : error.failure.message,
        );
        return false;
      }
      const copy = failureCopy(error.failure, PLACEMENT_COPY);
      region.say(copy);
      onRefused?.(copy);
      return false;
    }
  };

  const removePiece = async (piece: Ticket, button: HTMLButtonElement): Promise<void> => {
    if (!current) return;
    const rect = drawing.pieceRects.get(piece.id);
    await withPending(region, button, 'Updating load…', async () => {
      try {
        const load = await del<Load>(`/api/loads/${current?.id}/placements/${piece.id}`);
        if (rect) {
          await new Promise<void>((resolve) => shrinkAway(rect, resolve));
        }
        applyLoad(load, { kind: 'remove', pieceId: piece.id });
        region.say('Load updated.');
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        region.say(failureCopy(error.failure, PLACEMENT_COPY));
      }
    });
  };

  const deckDialog = (
    label: string,
    confirmLabel: string,
    opener: HTMLElement,
    startDeck: number,
    heading: string | null,
    send: (deckNumber: number, onRefused: (reason: string) => void) => Promise<boolean>,
  ): void => {
    if (!current) return;
    const decks = current.decks.map((deck) => deck.number);
    let chosen = decks.includes(startDeck) ? startDeck : (decks[0] ?? 1);
    const error = el('p', { class: 'field-error' });
    const list = el('div', { class: 'deck-listbox', role: 'listbox', 'aria-label': 'Deck', tabindex: '0' });
    const confirm = el('button', { type: 'button', class: 'btn primary', text: confirmLabel.toUpperCase() });
    const cancel = el('button', { type: 'button', class: 'btn ghost', text: 'CANCEL' });

    const paint = (): void => {
      replace(
        list,
        decks.map((number) => {
          const option = el('div', {
            class: number === chosen ? 'deck-option selected' : 'deck-option',
            role: 'option',
            id: `deck-option-${number}`,
            'aria-selected': number === chosen ? 'true' : 'false',
            text: `Deck ${number}`,
          });
          option.addEventListener('click', () => {
            chosen = number;
            paint();
          });
          return option;
        }),
      );
      list.setAttribute('aria-activedescendant', `deck-option-${chosen}`);
    };
    paint();
    list.addEventListener('keydown', (event) => {
      const index = decks.indexOf(chosen);
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        chosen = decks[Math.min(decks.length - 1, index + 1)] as number;
        paint();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        chosen = decks[Math.max(0, index - 1)] as number;
        paint();
      }
    });

    const dialog = openDialog({
      label,
      opener,
      focusFallback: () => placeButton,
      children: [
        heading ? el('h2', { class: 'heading small', text: heading }) : null,
        list,
        error,
        el('div', { class: 'row' }, [confirm, cancel]),
      ],
    });
    cancel.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', () => {
      void withPending(region, confirm, label === 'Move piece' ? 'Moving…' : 'Placing…', async () => {
        const ok = await send(chosen, (reason) => {
          error.textContent = reason;
        });
        if (ok) dialog.close();
      });
    });
    window.setTimeout(() => list.focus(), 0);
  };

  placeButton.addEventListener('click', () => {
    const pieceId = selectedTicket;
    if (!pieceId) return;
    deckDialog('Place piece', 'Confirm placement', placeButton, 1, null, (deckNumber, onRefused) =>
      sendPlacement(pieceId, deckNumber, null, onRefused),
    );
  });

  const openMoveDialog = (piece: Ticket, deckNumber: number, opener: HTMLElement): void => {
    deckDialog(
      'Move piece',
      'Confirm move',
      opener,
      deckNumber,
      `MOVE ${piece.title}`,
      (target, onRefused) => sendMove(piece, target, null, onRefused),
    );
  };

  addDeckButton.addEventListener('click', () => {
    void withPending(region, addDeckButton, 'Updating load…', async () => {
      if (!current) return;
      try {
        const load = await post<Load>(`/api/loads/${current.id}/decks`);
        applyLoad(load, { kind: 'plain' });
        region.say('Load updated.');
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        region.say(failureCopy(error.failure, PLACEMENT_COPY));
      }
    });
  });

  removeDeckButton.addEventListener('click', () => {
    void withPending(region, removeDeckButton, 'Updating load…', async () => {
      if (!current) return;
      const top = current.decks[current.decks.length - 1];
      if (!top) return;
      try {
        const load = await del<Load>(`/api/loads/${current.id}/decks/${top.number}`);
        applyLoad(load, { kind: 'plain' });
        region.say('Load updated.');
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        region.say(
          failureCopy(error.failure, {
            ...PLACEMENT_COPY,
            deck_not_removable: 'Only an empty top deck can be removed.',
          }),
        );
      }
    });
  });

  const changeStatus = (next: LoadStatus, button: HTMLButtonElement): void => {
    void withPending(region, button, 'Updating load…', async () => {
      if (!current) return;
      try {
        const load = await post<Load>(`/api/loads/${current.id}/status`, { status: next });
        applyLoad(load, { kind: 'plain' });
        region.say(`Load is now ${LOAD_STATUS_LABELS[load.status]}.`);
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        region.say(
          failureCopy(error.failure, {
            empty_load: 'Place at least one piece first.',
          }),
        );
      }
    });
  };

  markLoadedButton.addEventListener('click', () => changeStatus('loaded', markLoadedButton));
  startFiringButton.addEventListener('click', () => changeStatus('firing', startFiringButton));
  startCoolingButton.addEventListener('click', () => changeStatus('cooling', startCoolingButton));
  cancelLoadButton.addEventListener('click', () => changeStatus('cancelled', cancelLoadButton));

  unloadButton.addEventListener('click', () => {
    if (!current) return;
    const key = newIdempotencyKey();
    const pieces = current.decks.flatMap((deck) => deck.pieces);
    const chosen = new Map<string, string>();
    const groups = pieces.map((piece) => {
      chosen.set(piece.id, 'intact');
      const group = el('div', {
        role: 'radiogroup',
        'aria-label': `${piece.title} outcome`,
        class: 'radiogroup',
      }, [el('span', { class: 'label', text: piece.title })]);
      for (const outcome of ['intact', 'cracked', 'damaged'] as const) {
        const id = `outcome-${piece.id}-${outcome}`;
        const input = el('input', {
          type: 'radio',
          name: `outcome-${piece.id}`,
          id,
          value: outcome,
        });
        input.checked = outcome === 'intact';
        input.addEventListener('change', () => chosen.set(piece.id, outcome));
        group.appendChild(
          el('span', { class: 'radio' }, [
            input,
            el('label', { for: id, text: outcome.charAt(0).toUpperCase() + outcome.slice(1) }),
          ]),
        );
      }
      return group;
    });
    const confirm = el('button', { type: 'button', class: 'btn primary', text: 'CONFIRM UNLOAD' });
    const dialog = openDialog({
      label: 'Unload',
      opener: unloadButton,
      children: [el('h2', { class: 'heading small', text: 'UNLOAD' }), ...groups, confirm],
    });
    confirm.addEventListener('click', () => {
      void withPending(region, confirm, 'Unloading…', async () => {
        try {
          const answer = await call<{ load: Load; charges: { status: string }[] }>(
            'POST',
            `/api/loads/${current?.id}/unload`,
            { body: { outcomes: Object.fromEntries(chosen) }, idempotencyKey: key },
          );
          dialog.close();
          applyLoad(answer.load, { kind: 'plain' });
          const pendingCount = answer.charges.filter((charge) => charge.status === 'pending').length;
          if (pendingCount > 0) {
            region.say(
              `Unloaded. ${pendingCount} charges are waiting for billing and will settle automatically.`,
            );
          } else {
            region.say(
              `Unloaded. ${answer.charges.length} charges settled; receipts follow by email.`,
            );
          }
        } catch (error) {
          if (!(error instanceof RequestFailed)) throw error;
          region.say(
            failureCopy(error.failure, {
              illegal_transition: "This load can't be unloaded now.",
            }),
          );
        }
      });
    });
  });

  newLoadButton.addEventListener('click', () => {
    const kilnSelect = el('select', { 'aria-label': 'Kiln' });
    replace(
      kilnSelect,
      kilns.map((kiln) => el('option', { value: kiln.id, text: kiln.name })),
    );
    let firing: 'bisque' | 'glaze' = 'bisque';
    const firingGroup = el('div', { role: 'radiogroup', 'aria-label': 'Firing', class: 'radiogroup' });
    for (const option of ['bisque', 'glaze'] as const) {
      const id = `new-load-${option}`;
      const input = el('input', { type: 'radio', name: 'new-load-firing', id, value: option });
      input.checked = option === 'bisque';
      input.addEventListener('change', () => {
        firing = option;
      });
      firingGroup.appendChild(
        el('span', { class: 'radio' }, [
          input,
          el('label', { for: id, text: option === 'bisque' ? 'Bisque' : 'Glaze' }),
        ]),
      );
    }
    const create = el('button', { type: 'button', class: 'btn primary', text: 'CREATE LOAD' });
    const dialog = openDialog({
      label: 'New load',
      opener: newLoadButton,
      children: [
        el('h2', { class: 'heading small', text: 'NEW LOAD' }),
        kilnSelect,
        firingGroup,
        create,
      ],
    });
    create.addEventListener('click', () => {
      void withPending(region, create, 'Creating load…', async () => {
        try {
          const load = await post<Load>('/api/loads', {
            kiln_id: kilnSelect.value,
            firing,
          });
          dialog.close();
          selectedTicket = null;
          previousBaseY = new Map();
          applyLoad(load, { kind: 'plain' });
          region.say('Load created.');
        } catch (error) {
          if (!(error instanceof RequestFailed)) throw error;
          region.say(failureCopy(error.failure, {}));
        }
      });
    });
  });

  // Drag placement and drag moves share one pointer gesture.
  let drag:
    | {
        readonly pieceId: string;
        readonly title: string;
        readonly source: 'rail' | 'deck';
        readonly fromDeck: number | null;
        readonly ghost: HTMLElement;
      }
    | null = null;

  const deckUnderPointer = (x: number, y: number): number | null => {
    const node = document.elementFromPoint(x, y);
    const band = node?.closest?.('[data-deck-band]');
    const value = band?.getAttribute('data-deck-band');
    return value === null || value === undefined ? null : Number.parseInt(value, 10);
  };

  const tintBand = (deckNumber: number | null): void => {
    for (const [number, band] of drawing.bands) {
      band.classList.toggle('active', number === deckNumber);
    }
  };

  const endDrag = (commit: { deck: number } | null, point: { x: number; y: number }): void => {
    const held = drag;
    drag = null;
    tintBand(null);
    if (!held) return;
    held.ghost.remove();
    if (!commit) return;
    if (held.source === 'rail') {
      void sendPlacement(held.pieceId, commit.deck, point);
    } else if (held.fromDeck !== commit.deck) {
      const piece = current?.decks
        .flatMap((deck) => deck.pieces)
        .find((candidate) => candidate.id === held.pieceId);
      if (piece) void sendMove(piece, commit.deck, point);
    }
  };

  const trackPointer = (event: PointerEvent): void => {
    if (!drag) return;
    drag.ghost.style.left = `${event.clientX - 40}px`;
    drag.ghost.style.top = `${event.clientY - 16}px`;
    tintBand(deckUnderPointer(event.clientX, event.clientY));
  };
  const releasePointer = (event: PointerEvent): void => {
    if (!drag) return;
    const deckNumber = deckUnderPointer(event.clientX, event.clientY);
    endDrag(deckNumber === null ? null : { deck: deckNumber }, {
      x: event.clientX,
      y: event.clientY,
    });
  };
  window.addEventListener('pointermove', trackPointer);
  window.addEventListener('pointerup', releasePointer);
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && drag) endDrag(null, { x: 0, y: 0 });
  };
  window.addEventListener('keydown', onKey);

  function startDrag(
    event: PointerEvent,
    pieceId: string,
    title: string,
    source: 'rail' | 'deck',
    fromDeck: number | null,
  ): void {
    const ghost = el('div', { class: 'drag-ghost mono', text: title });
    ghost.style.left = `${event.clientX - 40}px`;
    ghost.style.top = `${event.clientY - 16}px`;
    document.body.appendChild(ghost);
    drag = { pieceId, title, source, fromDeck, ghost };
  }

  function beginTicketDrag(event: PointerEvent, piece: Ticket): void {
    if (!planning()) return;
    const start = { x: event.clientX, y: event.clientY };
    const watch = (move: PointerEvent): void => {
      if (Math.hypot(move.clientX - start.x, move.clientY - start.y) <= 4) return;
      window.removeEventListener('pointermove', watch);
      startDrag(move, piece.id, piece.title, 'rail', null);
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', watch);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', watch);
    window.addEventListener('pointerup', stop);
  }

  elevationHost.addEventListener('pointerdown', (event) => {
    if (!planning()) return;
    const target = (event.target as Element).closest?.('[data-piece]');
    const pieceId = target?.getAttribute('data-piece');
    if (!pieceId) return;
    const deck = current?.decks.find((candidate) =>
      candidate.pieces.some((piece) => piece.id === pieceId),
    );
    const piece = deck?.pieces.find((candidate) => candidate.id === pieceId);
    if (!deck || !piece) return;
    const start = { x: event.clientX, y: event.clientY };
    const watch = (move: PointerEvent): void => {
      if (Math.hypot(move.clientX - start.x, move.clientY - start.y) <= 4) return;
      window.removeEventListener('pointermove', watch);
      startDrag(move, piece.id, piece.title, 'deck', deck.number);
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', watch);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', watch);
    window.addEventListener('pointerup', stop);
  });

  const placedIds = (load: Load | null): string[] =>
    (load?.decks ?? []).flatMap((deck) => deck.pieces.map((piece) => piece.id));

  const refresh = async (): Promise<void> => {
    const before = placedIds(current);
    const open = await get<Load[]>('/api/loads?open=1').catch(() => null);
    if (open) {
      loads = open;
      if (current) current = open.find((load) => load.id === current?.id) ?? null;
      if (!current) current = open.find((load) => load.status === 'planning') ?? null;
      drawPicker();
    }
    // A placement another tech made plays the same motion, starting from the ticket's rail place.
    const added = placedIds(current).filter((id) => !before.includes(id));
    redraw(added.length === 1 ? { kind: 'place', pieceId: added[0] as string } : { kind: 'plain' });
    await loadWaiting();
  };

  void (async () => {
    kilns = await get<Kiln[]>('/api/kilns').catch(() => [] as Kiln[]);
    await refresh();
  })();

  const stopLive = onLive((message) => {
    if (message.kind === 'load' || message.kind === 'piece') void refresh();
  });

  const onResize = (): void => redraw({ kind: 'plain' });
  window.addEventListener('resize', onResize);

  return () => {
    stopLive();
    window.removeEventListener('pointermove', trackPointer);
    window.removeEventListener('pointerup', releasePointer);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
  };
};
