let deliveryEl: HTMLElement | null = null;
let uploadEl: HTMLElement | null = null;
let noticesEl: HTMLElement | null = null;
let noticesListeners = new Set<(text: string) => void>();

export function initLiveRegions(): void {
  deliveryEl = document.createElement('div');
  deliveryEl.className = 'visually-hidden';
  deliveryEl.setAttribute('role', 'status');
  deliveryEl.setAttribute('aria-label', 'Delivery updates');
  document.body.append(deliveryEl);

  uploadEl = document.createElement('div');
  uploadEl.className = 'visually-hidden';
  uploadEl.setAttribute('role', 'status');
  uploadEl.setAttribute('aria-label', 'Upload progress');
  document.body.append(uploadEl);

  noticesEl = document.createElement('div');
  noticesEl.className = 'visually-hidden';
  noticesEl.setAttribute('role', 'status');
  noticesEl.setAttribute('aria-label', 'Notices');
  document.body.append(noticesEl);
}

export function announceDelivery(text: string): void {
  if (deliveryEl) deliveryEl.textContent = '';
  window.setTimeout(() => {
    if (deliveryEl) deliveryEl.textContent = text;
  }, 30);
}

export function announceUpload(text: string): void {
  if (uploadEl) uploadEl.textContent = '';
  window.setTimeout(() => {
    if (uploadEl) uploadEl.textContent = text;
  }, 30);
}

export function announceNotice(text: string): void {
  if (noticesEl) noticesEl.textContent = '';
  window.setTimeout(() => {
    if (noticesEl) noticesEl.textContent = text;
  }, 30);
  for (const fn of noticesListeners) fn(text);
}

export function onNotice(fn: (text: string) => void): () => void {
  noticesListeners.add(fn);
  return () => noticesListeners.delete(fn);
}
