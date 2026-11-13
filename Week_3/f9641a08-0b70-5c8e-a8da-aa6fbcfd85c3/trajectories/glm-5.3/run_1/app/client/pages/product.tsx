import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { api, ApiFailure } from '../lib/api.js';
import { navigate, usePath, useReducedMotion } from '../lib/router.js';
import { announce, LoadingPanel, ErrorPanel } from '../app.js';
import { store, useStore, onLiveEvent, type Cart } from '../lib/store.js';
import { rupees } from '../lib/format.js';
import { GateGauge } from '../components/gauge.js';
import type { ProductDetail } from './collection.js';
import { showToast } from '../components/toast.js';

const FIT_CATEGORIES = new Set(['luggage', 'backpacks', 'totes']);

export function Product(props: { slug: string }): JSX.Element {
  const path = usePath();
  const url = useMemo(() => new URL(path, location.origin), [path]);
  const skuParam = url.searchParams.get('sku');
  const airlineParam = url.searchParams.get('airline') ?? 'skyline-indus';
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [sku, setSku] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reduced = useReducedMotion();
  useStore();

  useEffect(() => {
    setDetail(null);
    setFailed(false);
    void api.get<ProductDetail>(`/api/products/${props.slug}`)
      .then((d) => {
        setDetail(d);
        // Without sku, the first colour and first size in seed order are selected.
        const found = d.variants.find((v) => v.sku === skuParam);
        setSku(found !== undefined ? found.sku : d.variants[0].sku);
      })
      .catch(() => setFailed(true));
  }, [props.slug, skuParam]);

  // Live price and stock updates reach open product pages without a reload.
  useEffect(() => {
    const handler = (type: string, data: Record<string, unknown>): void => {
      if (detail === null) return;
      const sku = typeof data.sku === 'string' ? data.sku : '';
      if (sku === '' || !detail.variants.some((v) => v.sku === sku)) return;
      if (type === 'price') {
        announce('product-updates', `Price updated to ${rupees(Number(data.price))}.`);
        void api.get<ProductDetail>(`/api/products/${props.slug}`).then(setDetail).catch(() => undefined);
      }
      if (type === 'stock') {
        announce('product-updates', String(data.badge));
        void api.get<ProductDetail>(`/api/products/${props.slug}`).then(setDetail).catch(() => undefined);
      }
    };
    return onLiveEvent(handler);
  }, [detail, props.slug]);

  if (failed) return <ErrorPanel message="Something went wrong on our side. Try again." />;
  if (detail === null || sku === null) return <LoadingPanel />;

  const variant = detail.variants.find((v) => v.sku === sku) ?? detail.variants[0];
  const colourGroups = [...new Set(detail.variants.map((v) => v.colour))];
  const sizeGroups = [...new Set(detail.variants.map((v) => v.size))];
  const saved = store.wishlist.items.some((w) => w.slug === detail.slug);

  const selectColour = (colour: string): void => {
    const sameColour = detail.variants.find((v) => v.colour === colour && v.size === variant.size);
    const next = sameColour ?? detail.variants.find((v) => v.colour === colour)!;
    setSku(next.sku);
    // The variant change replaces the current history entry.
    navigate(`/products/${props.slug}?sku=${next.sku}${airlineParam !== 'skyline-indus' ? `&airline=${airlineParam}` : ''}`, true);
    announce('selected-variant', `SKU ${next.sku} · ${rupees(next.price)} · ${next.badge}`);
  };

  const selectSize = (size: string): void => {
    const next = detail.variants.find((v) => v.colour === variant.colour && v.size === size) ?? variant;
    setSku(next.sku);
    navigate(`/products/${props.slug}?sku=${next.sku}${airlineParam !== 'skyline-indus' ? `&airline=${airlineParam}` : ''}`, true);
    announce('selected-variant', `SKU ${next.sku} · ${rupees(next.price)} · ${next.badge}`);
  };

  const addToBag = async (): Promise<void> => {
    setBusy(true);
    try {
      const cart = await api.post<Cart>('/api/cart/lines', { sku: variant.sku, quantity: 1 });
      store.cart = cart;
      store.emit();
      const text = `Added ${detail.name} — ${variant.colour}, ${variant.size} to your bag. Bag total ${rupees(cart.totals.total)}.`;
      announce('cart-updates', text);
      showToast(`Added ${detail.name} to your bag. Bag total ${rupees(cart.totals.total)}.`);
    } catch (err) {
      if (err instanceof ApiFailure) {
        announce('cart-updates', err.body.message);
        showToast(err.body.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleSave = async (): Promise<void> => {
    setBusy(true);
    try {
      if (saved) {
        store.wishlist = await api.delete(`/api/wishlist/${detail.slug}`);
        announce('cart-updates', `Removed ${detail.name} from your wishlist.`);
      } else {
        store.wishlist = await api.put(`/api/wishlist/${detail.slug}`);
        announce('cart-updates', `Saved ${detail.name} to your wishlist.`);
      }
      store.emit();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="product-page">
      <div class="left-zone">
        <table aria-label="Specifications" class="specs">
          <tbody>
            <tr><th scope="row">Dimensions</th><td>{variant.dimensions_cm.height} × {variant.dimensions_cm.width} × {variant.dimensions_cm.depth} cm</td></tr>
            <tr><th scope="row">Weight</th><td>{variant.weight_kg} kg</td></tr>
            <tr><th scope="row">Material</th><td>{detail.material}</td></tr>
            <tr><th scope="row">Warranty</th><td>{detail.warranty_years} {detail.warranty_years === 1 ? 'year' : 'years'}</td></tr>
          </tbody>
        </table>
        <p class="saves">Saved by {detail.saves}</p>
      </div>
      <div class="product-main">
        <h1>{detail.name}</h1>
        <p class="price">
          {variant.compare_at !== null ? <s>{rupees(variant.compare_at)}</s> : null}
          {rupees(variant.price)}
          {variant.save_percent !== null ? ` Save ${variant.save_percent}%` : ''}
        </p>
        <div class="product-layout">
          <Gallery detail={detail} variant={variant} reduced={reduced} />
          <div class="picker-zone">
            <fieldset>
              <legend>Colour</legend>
              <div role="radiogroup" aria-label="Colour" class="radios">
                {colourGroups.map((colour) => (
                  <label key={colour} class={`radio ${variant.colour === colour ? 'selected' : ''}`}>
                    <input type="radio" name="colour" value={colour} checked={variant.colour === colour} onChange={() => selectColour(colour)} />
                    <span>{colour}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Size</legend>
              <div role="radiogroup" aria-label="Size" class="radios">
                {sizeGroups.map((size) => (
                  <label key={size} class={`radio ${variant.size === size ? 'selected' : ''}`}>
                    <input type="radio" name="size" value={size} checked={variant.size === size} onChange={() => selectSize(size)} />
                    <span>{size}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p role="status" aria-live="polite" id="selected-variant-region" class="visually-hidden">{`SKU ${variant.sku} · ${rupees(variant.price)} · ${variant.badge}`}</p>
            <p class={`badge ${variant.badge === 'Out of stock' ? 'out' : variant.badge.startsWith('Only') ? 'low' : 'in'}`}>{variant.badge}</p>
            <button class="primary" disabled={busy || variant.available <= 0} onClick={() => { void addToBag(); }}>
              {variant.available <= 0 ? 'Out of stock' : busy ? 'Adding' : 'Add to bag'}
            </button>
            <button class="secondary" aria-pressed={saved} disabled={busy} onClick={() => { void toggleSave(); }}>
              {saved ? `Remove ${detail.name} from wishlist` : `Save ${detail.name} to wishlist`}
            </button>
          </div>
        </div>
        {FIT_CATEGORIES.has(detail.category) ? (
          <GateGauge
            airline={airlineParam}
            airlines={undefined}
            onAirlineChange={(code) => navigate(`/products/${props.slug}?sku=${variant.sku}${code !== 'skyline-indus' ? `&airline=${code}` : ''}`, true)}
            bags={[{ sku: variant.sku, name: detail.name, height: variant.dimensions_cm.height, width: variant.dimensions_cm.width, depth: variant.dimensions_cm.depth, weight: variant.weight_kg, colour: variant.colour }]}
            selectedSku={variant.sku}
            showPicker={false}
          />
        ) : null}
      </div>
    </div>
  );
}


function Gallery(props: { detail: ProductDetail; variant: ProductDetail['variants'][0]; reduced: boolean }): JSX.Element {
  const images = props.variant.images;
  const [position, setPosition] = useState(0);
  const [motionState, setMotionState] = useState<'idle' | 'sliding'>('idle');
  const [zoomOpen, setZoomOpen] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<number | null>(null);
  const view = images[position] ?? images[0];

  useEffect(() => {
    setPosition(0);
  }, [props.variant.sku]);

  const go = (next: number): void => {
    const count = images.length;
    const target = ((next % count) + count) % count;
    setPosition(target);
    if (props.reduced) {
      setMotionState('idle');
    } else {
      setMotionState('sliding');
      setTimeout(() => setMotionState('idle'), 280);
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(position + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(position - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(images.length - 1); }
    else if (e.key === 'z' || e.key === 'Z') { openZoom(); }
  };

  const openZoom = (): void => { setZoomOpen(true); };

  const onTabKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'z' || e.key === 'Z') {
      const region = regionRef.current;
      if (region !== null && region.contains(document.activeElement)) openZoom();
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', onTabKeyDown);
    return () => document.removeEventListener('keydown', onTabKeyDown);
  });

  return (
    <div class="gallery-zone">
      <div
        ref={regionRef}
        role="region"
        aria-label="Gallery"
        class="gallery"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-motion-ms={props.reduced ? '0' : '280'}
        data-state={motionState}
        onTouchStart={(e) => { touchStart.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchStart.current === null) return;
          const delta = e.changedTouches[0].clientX - touchStart.current;
          if (Math.abs(delta) >= 40) go(delta < 0 ? position + 1 : position - 1);
          touchStart.current = null;
        }}
      >
        <img src={view?.url} alt={`${view?.alt}, view ${position + 1} of ${images.length}`} />
        <div role="tablist" aria-label="Gallery views" class="gallery-tabs">
          {images.map((image, i) => (
            <button key={image.id} role="tab" aria-selected={i === position} tabIndex={i === position ? 0 : -1} class={i === position ? 'selected' : ''}
              onClick={() => go(i)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); focusTab(i + 1); }
                else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); focusTab(i - 1); }
                else if (e.key === 'Home') { e.preventDefault(); go(0); focusTab(0); }
                else if (e.key === 'End') { e.preventDefault(); go(images.length - 1); focusTab(images.length - 1); }
              }}
              aria-label={`View ${i + 1}`}>View {i + 1}</button>
          ))}
        </div>
        <button class="zoom-button" onClick={openZoom} aria-label="Zoom image">Zoom image</button>
      </div>
      {zoomOpen ? (
        <div class="dialog-backdrop">
          <div role="dialog" aria-modal="true" aria-label="Zoomed image" class="dialog zoom-dialog" data-motion-ms="0" data-state="open">
            <img src={view?.url} alt={`${view?.alt}, view ${position + 1} of ${images.length}`} />
            <button class="primary" onClick={() => setZoomOpen(false)} aria-label="Close zoom">Close zoom</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function focusTab(index: number): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.gallery-tabs [role="tab"]');
  tabs[Math.max(0, Math.min(index, tabs.length - 1))]?.focus();
}
