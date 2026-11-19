import { MEDIUM, all, one, play, reducedMotion } from './dom.js';

const openers = new WeakMap<Element, HTMLElement>();
const running = new WeakMap<Element, Animation>();

export function dialogHolder(name: string): HTMLElement | null {
  return one(`[data-dialog="${name}"]`);
}

function focusables(within: ParentNode): HTMLElement[] {
  return all<HTMLElement>(
    'a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
    within,
  ).filter((element) => element.offsetParent !== null || element === document.activeElement);
}

function slideFrom(holder: HTMLElement): Keyframe[] {
  const isSheet = holder.hasAttribute('data-sheet');
  const narrow = window.innerWidth < 768;
  if (isSheet && narrow) return [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }];
  if (isSheet) {
    const rightToLeft = document.documentElement.dir === 'rtl';
    return [
      { transform: `translateX(${rightToLeft ? '-100%' : '100%'})` },
      { transform: 'translateX(0)' },
    ];
  }
  return [
    { transform: 'scale(0.9)', opacity: 0 },
    { transform: 'scale(1)', opacity: 1 },
  ];
}

export function openDialog(name: string, opener?: HTMLElement): void {
  const holder = dialogHolder(name);
  if (!holder) return;
  const box = one('[data-dialog-box]', holder) ?? holder;
  const held = running.get(holder);
  if (held) held.cancel();
  if (opener) openers.set(holder, opener);
  holder.removeAttribute('hidden');
  holder.setAttribute('data-open', 'true');
  const animation = play(box, slideFrom(holder), MEDIUM);
  if (animation) running.set(holder, animation);
  const first = focusables(box).find((element) => !element.hasAttribute('data-close'));
  (first ?? box).focus({ preventScroll: true });
}

export function closeDialog(name: string): void {
  const holder = dialogHolder(name);
  if (!holder || holder.hasAttribute('hidden')) return;
  const box = one('[data-dialog-box]', holder) ?? holder;
  holder.removeAttribute('data-open');
  const opener = openers.get(holder);
  const held = running.get(holder);
  if (held) held.cancel();
  const finish = (): void => {
    if (!holder.hasAttribute('data-open')) holder.setAttribute('hidden', '');
  };
  if (reducedMotion()) {
    finish();
  } else {
    const animation = play(box, slideFrom(holder).reverse(), MEDIUM);
    if (animation) {
      running.set(holder, animation);
      animation.finished.then(finish).catch(() => undefined);
    } else {
      finish();
    }
  }
  if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
}

export function openDialogName(): string | null {
  const open = all('[data-dialog][data-open="true"]');
  return open.length > 0 ? (open[open.length - 1].getAttribute('data-dialog') ?? null) : null;
}

export function dialogIsOpen(name: string): boolean {
  return dialogHolder(name)?.getAttribute('data-open') === 'true';
}

export function startDialogs(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const opener = target?.closest<HTMLElement>('[data-opens]');
    if (opener) {
      openDialog(opener.getAttribute('data-opens') as string, opener);
      return;
    }
    const closer = target?.closest<HTMLElement>('[data-close]');
    if (closer) {
      const holder = closer.closest<HTMLElement>('[data-dialog]');
      if (holder) closeDialog(holder.getAttribute('data-dialog') as string);
      return;
    }
    const holder = target?.closest<HTMLElement>('[data-sheet][data-open="true"]');
    if (holder && target === holder) {
      closeDialog(holder.getAttribute('data-dialog') as string);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const list = one('[data-combobox] .combobox-list:not([hidden])');
      if (list) return;
      const open = openDialogName();
      if (open) {
        event.stopPropagation();
        closeDialog(open);
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const open = openDialogName();
    if (!open) return;
    const holder = dialogHolder(open);
    const box = holder ? (one('[data-dialog-box]', holder) ?? holder) : null;
    if (!box) return;
    const stops = focusables(box);
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  });
}
