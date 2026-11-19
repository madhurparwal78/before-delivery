/**
 * The material library: swatches as radio groups under sticky family headings,
 * one choice across the library, a compare tray of four and the stock read.
 */
import { EMPTY, F } from '../../shared/feedback.ts';
import { grainSwatch, chairDrawing } from '../../shared/drawings.ts';
import { api, ApiError } from '../ui/api.ts';
import { DURATION, animate, crossFade, stopAnimations } from '../ui/motion.ts';
import { all, el, find, need, setHidden, setText } from '../ui/dom.ts';
import { announce, showProblems, withPending } from '../ui/shell.ts';
import { field, openModal } from '../ui/dialog.ts';
import { body, setRefresher, wireMainAction } from './deskShell.ts';
import { lotLabel } from './estimate.ts';
import { setQuery } from '../router.ts';

interface Material {
  code: string;
  name: string;
  family: string;
  unit: 'sqFt' | 'metre';
  prices: Record<string, string>;
}

interface Lot {
  lot: string;
  hides?: number;
  averageSqFt?: string;
  metres?: string;
}

interface Piece {
  id: string;
  title: string;
  state: string;
}

const TRAY_LIMIT = 4;

export async function startLibrary(): Promise<void> {
  const screen = body();

  const swatches = el('div', { class: 'tile tile-large swatches' }, [el('h2', { id: 'swatches-heading', text: 'Swatches', tabindex: '-1' })]);
  const drawing = el('div', { class: 'tile swatch-drawing', id: 'swatch-drawing', role: 'img', 'aria-label': 'Chosen material' });
  const stock = el('div', { class: 'tile', role: 'region', 'aria-label': 'Stock' }, [
    el('h2', { text: 'Stock' }),
    el('ul', { class: 'lot-list', id: 'lot-list' }),
  ]);
  const trayList = el('ul', { class: 'compare-list', id: 'compare-list' });
  const trayTile = el('div', { class: 'tile', role: 'region', 'aria-label': 'Compare tray', hidden: true }, [
    el('h2', { text: 'Compare tray' }),
    trayList,
  ]);
  const price = el('p', { class: 'figure', id: 'chosen-price', text: '\u2014' });
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Price per unit' }),
    price,
  ]);
  const refresh = el('button', { type: 'button', text: 'Refresh library', id: 'refresh-library' });
  const addCompare = el('button', { type: 'button', text: 'Add to compare', id: 'add-to-compare' });
  const hold = el('button', { type: 'button', class: 'button-primary', text: 'Hold a dye lot', id: 'hold-a-dye-lot' });

  screen.textContent = '';
  screen.append(
    mint,
    swatches,
    drawing,
    stock,
    trayTile,
    el('p', { class: 'screen-action' }, [refresh, addCompare, hold]),
  );

  let materials: Material[] = [];
  let chosen: string | null = new URL(window.location.href).searchParams.get('material');
  let tray: string[] = [];
  let lots: Lot[] = [];
  let newestStock = 0;

  const chosenMaterial = (): Material | undefined => materials.find((item) => item.code === chosen);

  const showDrawing = (): void => {
    const material = chosenMaterial();
    if (!material) {
      drawing.innerHTML = chairDrawing('library-none');
      drawing.setAttribute('aria-label', 'No material chosen');
      return;
    }
    // A further choice during the fade carries on from where it is.
    stopAnimations(drawing);
    drawing.innerHTML = chairDrawing(`${material.code}-chair`);
    drawing.setAttribute('aria-label', `${material.name} ${material.code}`);
    crossFade(drawing, DURATION.normal);
    setText(need('#chosen-price'), `\u20ac${material.prices.eur ?? ''}`);
  };

  /** The latest choice wins over a late answer. */
  const readStock = async (): Promise<void> => {
    const material = chosenMaterial();
    const list = need('#lot-list');
    if (!material) {
      list.textContent = '';
      return;
    }
    const token = ++newestStock;
    try {
      const answer = (await api.get(`/api/materials/${encodeURIComponent(material.code)}/lots`)) as { lots: Lot[] };
      if (token !== newestStock) return;
      lots = answer.lots;
      list.textContent = '';
      for (const lot of lots) list.append(el('li', { text: lotLabel(lot) }));
    } catch (error) {
      if (token !== newestStock) return;
      lots = [];
      list.textContent = '';
      if (error instanceof ApiError) list.append(el('li', { class: 'tile-empty', text: error.failure.message }));
    }
  };

  const choose = (code: string): void => {
    chosen = code;
    // The library has one choice, so choosing in one family clears the others.
    for (const radio of all<HTMLInputElement>('input[type="radio"]', swatches)) {
      radio.checked = radio.value === code;
    }
    setQuery({ material: code }, true);
    showDrawing();
    void readStock();
  };

  const drawTray = (): void => {
    setHidden(trayTile, tray.length === 0);
    const nodes = all<HTMLElement>('li', trayList);
    const before = new Map<string, DOMRect>();
    for (const node of nodes) before.set(node.dataset.code ?? '', node.getBoundingClientRect());

    trayList.textContent = '';
    for (const code of tray) {
      const material = materials.find((item) => item.code === code);
      if (!material) continue;
      const take = el('button', { type: 'button', text: `Take out ${material.name} ${material.code}` });
      take.addEventListener('click', () => {
        const at = tray.indexOf(code);
        tray = tray.filter((item) => item !== code);
        drawTray();
        // Focus moves to the next member, or to the Swatches heading when empty.
        const left = all<HTMLElement>('li button', trayList);
        if (left.length === 0) need<HTMLElement>('#swatches-heading').focus();
        else left[Math.min(at, left.length - 1)]?.focus();
      });
      const item = el('li', { 'data-code': code }, [
        el('span', { class: 'compare-grain', html: grainSwatch(code, material.unit) }),
        take,
      ]);
      trayList.append(item);
    }

    // Members close up as the same elements when one leaves.
    for (const node of all<HTMLElement>('li', trayList)) {
      const from = before.get(node.dataset.code ?? '');
      if (!from) continue;
      const to = node.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (dx === 0 && dy === 0) continue;
      animate(node, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], DURATION.quick);
    }
    if (tray.length === 1 && before.size === 0) {
      animate(trayTile, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], DURATION.normal);
    }
  };

  addCompare.addEventListener('click', () => {
    if (!chosen) return;
    if (tray.includes(chosen)) return;
    if (tray.length >= TRAY_LIMIT) {
      announce(F.trayFull);
      return;
    }
    tray = [...tray, chosen];
    drawTray();
  });

  refresh.addEventListener('click', () => {
    void withPending(refresh, async () => {
      try {
        const answer = (await api.post('/api/materials/refresh', {})) as { count: number };
        await load();
        announce(F.libraryRefreshed(answer.count));
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        announce(error.failure.message);
      }
    });
  });

  const openHold = (): void => {
    openModal({
      name: 'Hold a dye lot',
      opener: hold,
      async build(dialogBody, handle) {
        const pieceSelect = el('select', { name: 'piece' });
        const lotGroup = el('div', { role: 'radiogroup', 'aria-label': 'Lot', class: 'lot-group' });
        const quantity = el('input', { type: 'text', name: 'quantity', inputmode: 'decimal' });
        const run = el('button', { type: 'button', class: 'button-primary', text: 'Hold' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(
          field('hold-piece', 'Piece', pieceSelect),
          el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Lot' }), lotGroup]),
          field('hold-quantity', 'Quantity', quantity),
          el('p', { class: 'dialog-actions' }, [run, close]),
        );

        const pieces = ((await api.get('/api/pieces')) as { pieces: Piece[] }).pieces.filter(
          (item) => item.state !== 'archived',
        );
        for (const item of pieces) {
          pieceSelect.append(el('option', { value: item.id, text: item.title }));
        }
        lotGroup.textContent = '';
        for (const [index, lot] of lots.entries()) {
          const radio = el('input', {
            type: 'radio',
            name: 'lot',
            value: lot.lot,
            id: `hold-lot-${index}`,
            checked: index === 0,
          });
          lotGroup.append(
            el('span', { class: 'radio' }, [radio, el('label', { for: `hold-lot-${index}`, text: lotLabel(lot) })]),
          );
        }

        close.addEventListener('click', () => handle.close());
        run.addEventListener('click', () => {
          void withPending(run, async () => {
            const lot = find<HTMLInputElement>('input[name="lot"]:checked', lotGroup)?.value ?? '';
            try {
              const answer = (await api.post(`/api/pieces/${pieceSelect.value}/holds`, {
                code: chosen,
                lot,
                quantity: quantity.value,
              })) as { hold: { label: string } };
              handle.close();
              announce(answer.hold.label);
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              const message = error.failure.message;
              const problems = Object.entries(error.failure.fields).map(([name, text]) => ({
                field: name,
                message: text,
              }));
              showProblems(
                handle.problems,
                problems.length > 0 ? problems : [{ field: 'quantity', message }],
                () => quantity,
                'Problems',
              );
              announce(message);
            }
          });
        });
      },
    });
  };
  hold.addEventListener('click', openHold);
  wireMainAction(openHold);

  async function load(): Promise<void> {
    const answer = (await api.get('/api/materials')) as { materials: Material[] };
    materials = answer.materials;

    const families: string[] = [];
    for (const material of materials) {
      if (!families.includes(material.family)) families.push(material.family);
    }

    for (const node of all<HTMLElement>('.family', swatches)) node.remove();
    for (const family of families) {
      const group = el('div', { class: 'family', role: 'radiogroup', 'aria-label': family });
      group.append(el('h3', { class: 'family-heading', text: family }));
      const list = el('div', { class: 'swatch-grid' });
      const members = materials.filter((material) => material.family === family);
      for (const material of members) {
        const id = `swatch-${material.code}`;
        const radio = el('input', {
          type: 'radio',
          name: `family-${family}`,
          value: material.code,
          id,
          checked: material.code === chosen,
        });
        radio.addEventListener('change', () => {
          if (radio.checked) choose(material.code);
        });
        const label = el('label', { for: id, class: 'swatch' }, [
          el('span', { class: 'swatch-grain', html: grainSwatch(material.code, material.unit) }),
          el('span', { class: 'swatch-name', text: material.name }),
          el('span', { class: 'swatch-code', text: material.code }),
        ]);
        list.append(el('span', { class: 'swatch-holder' }, [radio, label]));
      }
      if (members.length === 0) list.append(el('p', { class: 'tile-empty', text: EMPTY.family }));
      group.append(list);

      // Arrows wrap inside a family and the group keeps one Tab stop.
      group.addEventListener('keydown', (event) => {
        const radios = all<HTMLInputElement>('input[type="radio"]', group);
        const at = radios.findIndex((radio) => radio === document.activeElement);
        if (at === -1) return;
        let next = at;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (at + 1) % radios.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (at - 1 + radios.length) % radios.length;
        else return;
        event.preventDefault();
        radios[next]!.checked = true;
        radios[next]!.focus();
        choose(radios[next]!.value);
      });
      swatches.append(group);
    }

    if (chosen && !materials.some((material) => material.code === chosen)) chosen = null;
    showDrawing();
    await readStock();
  }

  await load();
  setRefresher(async () => {
    const answer = (await api.get('/api/materials')) as { materials: Material[] };
    if (answer.materials.length !== materials.length) await load();
  });
}
