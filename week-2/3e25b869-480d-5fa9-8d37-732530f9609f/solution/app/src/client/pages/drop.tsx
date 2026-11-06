// The drop page: the pinned loaf on the left, the label card on the right, holds and live stock.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { dropScent, pick } from '../../shared/catalog.js';
import { formatMoney } from '../../shared/money.js';
import { dropTime, longDate } from '../../shared/toronto.js';
import { api } from '../api';
import { cartMessage, timeLeft } from '../cart';
import { LoafScene } from '../scene/loaf';
import { SCROLL_TRAVEL } from '../scene/geometry';
import { reducedMotion, useCopy, useStore, wide } from '../state';
import type { Batch, Cart, Hold } from '../types';
import { BarItem, Live } from '../ui';

const tintOf = (scent: string) => dropScent(scent)?.tint ?? 'lilac';

/** Keyboard scrolling lands on this grid, so every published position (multiples of 200 and 2400) is reachable by keys. */
const KEY_STEP = 40;

/** Space, Page Up/Down, arrows, Home and End scroll the page instantly, never smoothed. */
function instantKeyboardScroll(e: KeyboardEvent): void {
  const target = e.target as HTMLElement;
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (target.closest('input, select, textarea, button, a, [role="listbox"], [role="radiogroup"], dialog, [contenteditable="true"]')) return;
  const page = Math.max(1, Math.floor((innerHeight * 0.875) / KEY_STEP)) * KEY_STEP;
  const max = document.documentElement.scrollHeight - innerHeight;
  const down = (by: number) => Math.floor(scrollY / KEY_STEP) * KEY_STEP + by;
  const up = (by: number) => Math.ceil(scrollY / KEY_STEP) * KEY_STEP - by;
  const moves: Record<string, number | null> = {
    PageDown: down(page),
    PageUp: up(page),
    ' ': e.shiftKey ? up(page) : down(page),
    ArrowDown: down(KEY_STEP),
    ArrowUp: up(KEY_STEP),
    Home: 0,
    End: max,
  };
  const top = moves[e.key];
  if (top === undefined || top === null) return;
  e.preventDefault();
  window.scrollTo({ top: Math.max(0, Math.min(max, top)), left: 0, behavior: 'instant' });
}

export function DropPage() {
  const { m, l } = useCopy();
  const isWide = useStore(wide);
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [message, setMessage] = useState('');
  const [holding, setHolding] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const figure = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const caption = useRef<HTMLElement>(null);
  const section = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLUListElement>(null);
  const holdButton = useRef<HTMLButtonElement>(null);
  const scene = useRef<LoafScene | null>(null);
  const deepLinked = useRef(false);

  const load = async () => {
    const [drop, current] = await Promise.all([api<{ batches: Batch[] }>('GET', '/api/drop'), api<Cart>('GET', '/api/cart')]);
    if (drop.ok) setBatches(drop.data.batches);
    if (current.ok) setCart(current.data);
  };

  useLayoutEffect(() => {
    // The viewport height is measured once at page load, so toolbar changes never alter the scroll travel.
    if (section.current) section.current.style.height = `${innerHeight + SCROLL_TRAVEL}px`;
    if (figure.current && canvas.current && caption.current) {
      scene.current = new LoafScene(figure.current, canvas.current, caption.current, { caption: m.caption, diagram: m.loafDiagram });
    }
    const onScroll = () => scene.current?.onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('keydown', instantKeyboardScroll);
    void load();
    const poll = setInterval(() => void load(), 5000);
    return () => {
      clearInterval(poll);
      removeEventListener('scroll', onScroll);
      removeEventListener('keydown', instantKeyboardScroll);
      scene.current?.destroy();
    };
  }, []);

  useEffect(() => scene.current?.setLabels({ caption: m.caption, diagram: m.loafDiagram }), [l]);

  const requested = new URLSearchParams(location.search).get('batch');
  const fallback = batches?.find((b) => b.state === 'live') ?? batches?.[0];
  const batch = batches?.find((b) => b.code === (code ?? requested)) ?? fallback ?? null;

  useLayoutEffect(() => {
    if (!batch || !scene.current) return;
    scene.current.setBatch({ code: batch.code, tint: tintOf(batch.scent), bars: batch.bars.map((b) => b.status) });
    if (!deepLinked.current) {
      deepLinked.current = true;
      const k = /^#bar-(\d+)$/.exec(location.hash)?.[1];
      const exact = batch.code === requested;
      window.scrollTo({ top: exact && k ? LoafScene.deepLink(Number(k), batch.bars_cut) : 0, left: 0, behavior: 'instant' });
      scene.current.onScroll();
    }
  }, [batch?.code]);

  useLayoutEffect(() => {
    if (batch) scene.current?.setStock(batch.bars.map((b) => b.status));
  }, [batch?.bars.map((b) => b.status).join('')]);

  const choose = (next: string) => {
    setCode(next);
    history.replaceState(null, '', `/?batch=${encodeURIComponent(next)}`);
  };

  const hold = async () => {
    if (!batch || holding) return;
    const focused = document.activeElement === holdButton.current;
    setHolding(true);
    const before = cart?.total.cents ?? 0;
    const r = await api<{ hold: Hold; cart: Cart }>('POST', '/api/holds', { batch: batch.code });
    setHolding(false);
    if (r.ok) {
      const life = Date.parse(r.data.hold.expires_at) - Date.parse(r.data.hold.created_at);
      setCart(r.data.cart);
      setMessage(cartMessage(m, l, [m.cartHeld(r.data.hold.bar, timeLeft(life))], before, r.data.cart.total.cents));
    } else if (r.status === 0) setMessage(m.network);
    else setMessage(r.error.message);
    await load();
    if (focused) holdButton.current?.focus();
  };

  const toggleList = () => {
    const opening = !listOpen;
    setListOpen(opening);
    if (opening && !reducedMotion.get()) {
      queueMicrotask(() => {
        const el = panel.current;
        if (!el) return;
        const height = el.scrollHeight;
        el.animate([{ height: '0px', opacity: 0 }, { height: `${height}px`, opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      });
    }
  };

  const holds = cart?.holds.length ?? 0;
  const name = batch ? pick(dropScent(batch.scent)?.name ?? { en: batch.scent, fr: batch.scent }, l) : '';
  const notes = batch ? pick(dropScent(batch.scent)?.notes ?? { en: '', fr: '' }, l) : '';

  const holdControl = () => {
    if (!batch) return null;
    if (batch.state === 'scheduled') return <p class="hold-state">{m.dropOpens(batch.drop_at ? dropTime(new Date(batch.drop_at), l) : '')}</p>;
    if (batch.state === 'sold_out') return <p class="hold-state">{m.soldOut}</p>;
    const allHeld = batch.available === 0;
    const label = holding ? m.holding : allHeld ? m.allHeld : m.holdBar;
    return (
      <button
        type="button"
        class="button primary wide-button"
        ref={holdButton}
        aria-disabled={holding || allHeld ? 'true' : undefined}
        aria-busy={holding ? 'true' : undefined}
        onClick={() => !allHeld && void hold()}
      >
        {label}
      </button>
    );
  };

  return (
    <div class="drop" ref={section}>
      <div class="drop-figure-col">
        <figure aria-label={m.loaf} class="loaf-figure" ref={figure}>
          <canvas role="img" aria-label={m.loafCanvas} ref={canvas} />
          <figcaption ref={caption} class="loaf-caption" />
        </figure>
      </div>
      <div class="label-card">
        <h1 tabIndex={-1}>{name || m.loading}</h1>
        {batches && batches.length === 0 && <p class="lede">{m.noDrops}</p>}
        <div role="radiogroup" aria-label={m.scent} class="chips scent-chips">
          {(batches ?? []).map((b) => (
            <label class="chip" key={b.code}>
              <input type="radio" name="scent" value={b.code} checked={batch?.code === b.code} onChange={() => choose(b.code)} />
              <span>{pick(dropScent(b.scent)?.name ?? { en: b.scent, fr: b.scent }, l)}</span>
            </label>
          ))}
        </div>
        {batch && (
          <>
            <section aria-label={m.batch} class="label-row">
              <p class="label-name">{m.batch}</p>
              <p>
                <span class="num">{batch.code}</span> · {m.barsCut(batch.bars_cut)}
              </p>
            </section>
            <section aria-label={m.cureDate} class="label-row">
              <p class="label-name">{m.cureDate}</p>
              <p class="num">{longDate(batch.cure_date, l)}</p>
            </section>
            <section aria-label={m.scentNotes} class="label-row">
              <p class="label-name">{m.scentNotes}</p>
              <p>{notes}</p>
            </section>
            <section aria-label={m.dropTime} class="label-row">
              <p class="label-name">{m.dropTime}</p>
              <p>{batch.drop_at ? <time dateTime={batch.drop_at}>{dropTime(new Date(batch.drop_at), l)}</time> : '—'}</p>
            </section>
            <section aria-label={m.price} class="label-row">
              <p class="label-name">{m.price}</p>
              <p class="num">{m.priceEach(formatMoney(batch.unit_price.cents, l))}</p>
            </section>
            <div role="status" aria-label={m.batchCounts} class="counts num label-row">
              {m.counts(batch.bars_cut, batch.available, batch.held, batch.sold)}
            </div>
            <div class="label-row hold-row-control">
              {holdControl()}
              <Live name={m.cartUpdates} text={message} class="result-line" />
              {holds > 0 && (
                <a class="button secondary wide-button" href="/checkout">
                  {m.goCheckout(holds)}
                </a>
              )}
            </div>
            <div class="label-row bar-list-block">
              {!isWide && (
                <button type="button" class="button secondary disclosure" aria-expanded={listOpen ? 'true' : 'false'} aria-controls="bar-list" onClick={toggleList}>
                  <span>{m.showBarList}</span>
                  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
                    <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                </button>
              )}
              <ul id="bar-list" aria-label={m.barList} class="bar-list" ref={panel} hidden={!isWide && !listOpen}>
                {batch.bars.map((b) => (
                  <BarItem key={b.number} k={b.number} status={b.status} />
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
