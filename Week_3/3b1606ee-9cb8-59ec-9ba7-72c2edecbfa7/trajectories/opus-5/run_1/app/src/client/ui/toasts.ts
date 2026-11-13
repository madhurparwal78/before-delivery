import { state } from '../data/store.js';
import { el } from './dom.js';
import { fadeIn, fadeOut } from './motion.js';
import { registerToaster, type ToastRequest } from './live.js';
import { navigate } from './router.js';

/** Toasts never take focus; tapping one opens its conversation. */
export function startToasts(region: HTMLElement): void {
  registerToaster((request: ToastRequest) => {
    region.append(toast(request));
  });
}

function toast(request: ToastRequest): HTMLElement {
  const element = el('button', { class: 'toast', testid: 'toast', text: request.text });
  element.type = 'button';
  element.tabIndex = -1;
  element.addEventListener('click', () => {
    navigate(`/letters/${request.conversationId}`);
    dismiss(element);
  });
  fadeIn(element);
  window.setTimeout(() => dismiss(element), state.config.timers.toast_ms);
  return element;
}

function dismiss(element: HTMLElement): void {
  if (!element.isConnected) return;
  void fadeOut(element).then(() => element.remove());
}
