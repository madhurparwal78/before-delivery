import { ApiError, announce, api, cartAnnounce, jsonScript, motionDuration, qs, qsa, rupees } from './core.js';
import { addToBag } from './bag.js';
import { closeDialog, openDialog } from './dialog.js';
import { GateGauge } from './gauge.js';
import { onLive } from './live.js';

type Variant = {
  sku: string;
  colour: string;
  colour_slug: string;
  size: string;
  size_slug: string;
  dimensions_cm: { height: number; width: number; depth: number };
  weight_kg: number;
  price: number;
  compare_at: number | null;
  available: number;
  badge: string;
  images: Array<{ id: string; url: string; alt: string; position: number }>;
};

type Product = {
  slug: string;
  name: string;
  category: string;
  material: string;
  warranty_years: number;
  saves: number;
  variants: Variant[];
};

let product: Product | null = null;
let selected: Variant | null = null;
let gauge: GateGauge | null = null;
let galleryIndex = 0;
let galleryTimer = 0;

function savePercent(price: number, compareAt: number | null): number | null {
  if (compareAt === null || compareAt <= 0) return null;
  return Math.floor(((compareAt - price) * 100) / compareAt + 0.5);
}

function colours(): string[] {
  return [...new Set((product?.variants ?? []).map((variant) => variant.colour))];
}

function sizes(): string[] {
  return [...new Set((product?.variants ?? []).map((variant) => variant.size))];
}

function findVariant(colour: string, size: string): Variant | undefined {
  return (product?.variants ?? []).find((variant) => variant.colour === colour && variant.size === size);
}

function renderGallery(index: number, slide: boolean): void {
  if (selected === null) return;
  const region = qs<HTMLElement>('[data-gallery]');
  const image = qs<HTMLImageElement>('[data-gallery-image]');
  if (region === null || image === null) return;
  const images = selected.images;
  if (images.length === 0) return;
  galleryIndex = ((index % images.length) + images.length) % images.length;
  const current = images[galleryIndex];
  image.src = current.url;
  image.alt = `${current.alt}, view ${galleryIndex + 1} of ${images.length}`;
  for (const tab of qsa<HTMLElement>('[data-gallery-tabs] [role="tab"]', region)) {
    const on = Number(tab.dataset.view) === galleryIndex + 1;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.setAttribute('tabindex', on ? '0' : '-1');
  }
  const zoomImage = qs<HTMLImageElement>('[data-zoom-image]');
  if (zoomImage !== null) {
    zoomImage.src = current.url;
    zoomImage.alt = current.alt;
  }
  if (!slide) {
    region.dataset.state = 'idle';
    return;
  }
  const ms = motionDuration(region, 280);
  if (ms === 0) {
    region.dataset.state = 'idle';
    return;
  }
  region.dataset.state = 'sliding';
  window.clearTimeout(galleryTimer);
  galleryTimer = window.setTimeout(() => {
    region.dataset.state = 'idle';
  }, ms);
}

function renderGalleryTabs(): void {
  if (selected === null) return;
  const holder = qs<HTMLElement>('[data-gallery-tabs]');
  if (holder === null) return;
  holder.innerHTML = selected.images
    .map(
      (image, index) =>
        `<button type="button" role="tab" aria-label="View ${index + 1}" aria-selected="${
          index === 0 ? 'true' : 'false'
        }" tabindex="${index === 0 ? '0' : '-1'}" data-view="${index + 1}">View ${index + 1}</button>`
    )
    .join('');
}

function renderSelection(announceChange: boolean): void {
  if (product === null || selected === null) return;
  const variant = selected;

  const price = qs<HTMLElement>('[data-price]');
  if (price !== null) price.textContent = rupees(variant.price);

  const saveCopy = qs<HTMLElement>('[data-save-copy]');
  if (saveCopy !== null) {
    if (variant.compare_at === null) {
      saveCopy.hidden = true;
      saveCopy.innerHTML = '';
    } else {
      saveCopy.hidden = false;
      saveCopy.innerHTML = `<s>${rupees(variant.compare_at)}</s> Save ${savePercent(
        variant.price,
        variant.compare_at
      )}%`;
    }
  }

  const status = qs<HTMLElement>('[data-selected-variant]');
  if (status !== null) {
    status.textContent = `SKU ${variant.sku} · ${rupees(variant.price)} · ${variant.badge}`;
  }

  const addButton = qs<HTMLButtonElement>('[data-add-to-bag]');
  if (addButton !== null) {
    if (variant.badge === 'Out of stock') {
      addButton.disabled = true;
      addButton.textContent = 'Out of stock';
    } else {
      addButton.disabled = false;
      addButton.textContent = 'Add to bag';
    }
  }

  const dimensions = qs<HTMLElement>('[data-spec-dimensions]');
  if (dimensions !== null) {
    dimensions.textContent = `${variant.dimensions_cm.height} × ${variant.dimensions_cm.width} × ${variant.dimensions_cm.depth} cm`;
  }
  const weight = qs<HTMLElement>('[data-spec-weight]');
  if (weight !== null) weight.textContent = `${variant.weight_kg} kg`;

  for (const radio of qsa<HTMLElement>('[data-colour-group] [role="radio"]')) {
    const on = radio.dataset.colour === variant.colour;
    radio.setAttribute('aria-checked', on ? 'true' : 'false');
    radio.setAttribute('tabindex', on ? '0' : '-1');
  }
  for (const radio of qsa<HTMLElement>('[data-size-group] [role="radio"]')) {
    const on = radio.dataset.size === variant.size;
    radio.setAttribute('aria-checked', on ? 'true' : 'false');
    radio.setAttribute('tabindex', on ? '0' : '-1');
  }

  renderGalleryTabs();
  renderGallery(0, false);

  if (gauge !== null) {
    gauge.setBags([
      {
        sku: variant.sku,
        height_cm: variant.dimensions_cm.height,
        width_cm: variant.dimensions_cm.width,
        depth_cm: variant.dimensions_cm.depth,
        weight_kg: variant.weight_kg
      }
    ]);
  }

  const params = new URLSearchParams(window.location.search);
  params.set('sku', variant.sku);
  window.history.replaceState({}, '', `${window.location.pathname}?${params.toString().replace(/%2C/g, ',')}`);
  document.body.dataset.sku = variant.sku;

  if (announceChange) announce('product-updates', '');
}

function selectVariant(colour: string, size: string): void {
  if (product === null) return;
  const variant = findVariant(colour, size) ?? product.variants.find((item) => item.colour === colour);
  if (variant === undefined) return;
  selected = variant;
  renderSelection(true);
}

async function refreshVariant(sku: string): Promise<void> {
  if (product === null) return;
  const fresh = await api<Product>(`/api/products/${product.slug}`);
  product = fresh;
  const next = fresh.variants.find((variant) => variant.sku === sku);
  if (next !== undefined) selected = next;
  renderSelection(false);
}

export function setupProduct(): void {
  product = jsonScript<Product | null>('product-data', null);
  if (product === null) return;
  const sku = document.body.dataset.sku ?? '';
  selected = product.variants.find((variant) => variant.sku === sku) ?? product.variants[0];

  const gaugeRoot = qs<HTMLElement>('[data-gauge]');
  if (gaugeRoot !== null && selected !== undefined) {
    gauge = new GateGauge(gaugeRoot, [
      {
        sku: selected.sku,
        height_cm: selected.dimensions_cm.height,
        width_cm: selected.dimensions_cm.width,
        depth_cm: selected.dimensions_cm.depth,
        weight_kg: selected.weight_kg
      }
    ]);
    gauge.setupTouchDrag();
  }

  renderGalleryTabs();
  renderGallery(0, false);

  const colourGroup = qs<HTMLElement>('[data-colour-group]');
  colourGroup?.addEventListener('click', (event) => {
    const radio = (event.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
    if (radio === null || selected === null) return;
    selectVariant(radio.dataset.colour ?? '', selected.size);
  });
  colourGroup?.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (selected === null) return;
    const list = colours();
    const index = list.indexOf(selected.colour);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = list[(index + step + list.length) % list.length];
    selectVariant(next, selected.size);
    qs<HTMLElement>(`[data-colour-group] [data-colour="${next}"]`)?.focus();
  });

  const sizeGroup = qs<HTMLElement>('[data-size-group]');
  sizeGroup?.addEventListener('click', (event) => {
    const radio = (event.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
    if (radio === null || selected === null) return;
    selectVariant(selected.colour, radio.dataset.size ?? '');
  });
  sizeGroup?.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (selected === null) return;
    const list = sizes();
    const index = list.indexOf(selected.size);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = list[(index + step + list.length) % list.length];
    selectVariant(selected.colour, next);
    qs<HTMLElement>(`[data-size-group] [data-size="${next}"]`)?.focus();
  });

  const gallery = qs<HTMLElement>('[data-gallery]');
  gallery?.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (tab === null) return;
    renderGallery(Number(tab.dataset.view) - 1, true);
  });
  gallery?.addEventListener('keydown', (event: KeyboardEvent) => {
    if (selected === null) return;
    const count = selected.images.length;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      renderGallery(galleryIndex + 1, true);
      focusCurrentTab();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      renderGallery(galleryIndex - 1, true);
      focusCurrentTab();
    } else if (event.key === 'Home') {
      event.preventDefault();
      renderGallery(0, true);
      focusCurrentTab();
    } else if (event.key === 'End') {
      event.preventDefault();
      renderGallery(count - 1, true);
      focusCurrentTab();
    } else if (event.key === 'z' || event.key === 'Z') {
      event.preventDefault();
      openDialog('zoom', event.target as HTMLElement);
    }
  });

  let touchStartX = 0;
  gallery?.addEventListener(
    'touchstart',
    (event: TouchEvent) => {
      touchStartX = event.touches[0]?.clientX ?? 0;
    },
    { passive: true }
  );
  gallery?.addEventListener(
    'touchend',
    (event: TouchEvent) => {
      const endX = event.changedTouches[0]?.clientX ?? 0;
      const delta = endX - touchStartX;
      if (Math.abs(delta) < 40) return;
      renderGallery(galleryIndex + (delta < 0 ? 1 : -1), true);
    },
    { passive: true }
  );

  const zoomButton = qs<HTMLElement>('[data-zoom-open]');
  zoomButton?.addEventListener('click', () => openDialog('zoom', zoomButton));
  qs<HTMLElement>('[data-dialog-close="zoom"]')?.addEventListener('click', () => closeDialog('zoom'));

  const addButton = qs<HTMLButtonElement>('[data-add-to-bag]');
  addButton?.addEventListener('click', () => {
    if (selected === null || product === null) return;
    const variant = selected;
    addButton.disabled = true;
    addButton.textContent = 'Adding';
    void addToBag(variant.sku, 1, `${product.name} — ${variant.colour}, ${variant.size}`)
      .catch((error: unknown) => {
        if (error instanceof ApiError) cartAnnounce(error.body.message);
      })
      .finally(() => {
        addButton.disabled = variant.badge === 'Out of stock';
        addButton.textContent = variant.badge === 'Out of stock' ? 'Out of stock' : 'Add to bag';
      });
  });

  onLive((type, data) => {
    if (product === null) return;
    const sku = String(data.sku ?? '');
    if (!product.variants.some((variant) => variant.sku === sku)) return;
    if (type === 'stock') {
      announce('product-updates', String(data.badge ?? ''));
      void refreshVariant(selected?.sku ?? sku);
    }
    if (type === 'price') {
      announce('product-updates', `Price updated to ${rupees(Number(data.price ?? 0))}.`);
      void refreshVariant(selected?.sku ?? sku);
    }
  });
}

function focusCurrentTab(): void {
  qs<HTMLElement>(`[data-gallery-tabs] [data-view="${galleryIndex + 1}"]`)?.focus();
}
