import { showRefreshLine } from './dom.js';

const REFRESH_MS = 5000;

/** Patches the page in place: focus, open dialogs, typed values and scroll all stay. */
function morph(live: Element, fresh: Element): void {
  if (live.tagName !== fresh.tagName) {
    live.replaceWith(fresh.cloneNode(true));
    return;
  }
  const liveElement = live as HTMLElement;
  if (liveElement.hasAttribute('data-open')) return;
  if (document.activeElement === live && live.tagName === 'INPUT') return;

  for (const attribute of [...fresh.attributes]) {
    if (attribute.name === 'data-open') continue;
    if (live.getAttribute(attribute.name) !== attribute.value) {
      live.setAttribute(attribute.name, attribute.value);
    }
  }
  for (const attribute of [...live.attributes]) {
    if (!fresh.hasAttribute(attribute.name) && attribute.name !== 'data-open') {
      live.removeAttribute(attribute.name);
    }
  }
  if (live instanceof HTMLInputElement || live instanceof HTMLSelectElement || live instanceof HTMLTextAreaElement) {
    return;
  }

  const liveChildren = [...live.childNodes];
  const freshChildren = [...fresh.childNodes];
  const most = Math.max(liveChildren.length, freshChildren.length);
  for (let index = 0; index < most; index += 1) {
    const liveChild = liveChildren[index];
    const freshChild = freshChildren[index];
    if (!freshChild) {
      liveChild?.parentNode?.removeChild(liveChild);
      continue;
    }
    if (!liveChild) {
      live.appendChild(freshChild.cloneNode(true));
      continue;
    }
    if (liveChild.nodeType === Node.TEXT_NODE && freshChild.nodeType === Node.TEXT_NODE) {
      if (liveChild.textContent !== freshChild.textContent) liveChild.textContent = freshChild.textContent;
      continue;
    }
    if (liveChild.nodeType === Node.ELEMENT_NODE && freshChild.nodeType === Node.ELEMENT_NODE) {
      morph(liveChild as Element, freshChild as Element);
      continue;
    }
    liveChild.parentNode?.replaceChild(freshChild.cloneNode(true), liveChild);
  }
}

async function readPage(): Promise<Document | null> {
  try {
    const answer = await fetch(`${window.location.pathname}${window.location.search}`, {
      headers: { 'x-wayticket-refresh': '1' },
    });
    if (answer.status === 410) {
      const text = await answer.text();
      return new DOMParser().parseFromString(text, 'text/html');
    }
    if (!answer.ok) return null;
    const text = await answer.text();
    return new DOMParser().parseFromString(text, 'text/html');
  } catch {
    return null;
  }
}

/** A private page open when its re-read answers 410 changes in place to its ended heading. */
function pageHasEnded(fresh: Document): boolean {
  return fresh.body.classList.contains('ended');
}

export function startRefresh(onFresh?: (fresh: Document) => void): void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (stopped || document.visibilityState === 'hidden') return;
    const fresh = await readPage();
    if (!fresh) {
      showRefreshLine(true);
      return;
    }
    showRefreshLine(false);
    if (pageHasEnded(fresh) && !document.body.classList.contains('ended')) {
      document.body.className = fresh.body.className;
      document.title = fresh.title;
      const main = document.getElementById('main');
      const freshMain = fresh.getElementById('main');
      if (main && freshMain) {
        main.innerHTML = freshMain.innerHTML;
        const heading = main.querySelector<HTMLElement>('h1');
        heading?.focus();
      }
      stopped = true;
      return;
    }
    const main = document.getElementById('main');
    const freshMain = fresh.getElementById('main');
    if (main && freshMain) morph(main, freshMain);
    if (document.title !== fresh.title) document.title = fresh.title;
    onFresh?.(fresh);
  };
  window.setInterval(() => {
    void tick();
  }, REFRESH_MS);
}

export { morph };
