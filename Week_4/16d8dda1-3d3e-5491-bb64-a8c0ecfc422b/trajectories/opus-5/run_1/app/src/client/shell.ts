import { clear, element } from './dom.js';

export interface PageShell {
  root: HTMLElement;
  alert: HTMLElement;
  status: HTMLElement;
  body: HTMLElement;
  showError: (text: string | null) => void;
  setStatus: (text: string) => void;
  /** DP-34: anything the visitor cannot open shows the not-found page instead. */
  showNotFound: () => void;
}

/** Every page outside the classroom carries one alert and one Page status region. */
export function pageShell(className: string): PageShell {
  const alert = element('div', { role: 'alert', class: 'alert', hidden: true });
  const status = element('div', { role: 'status', 'aria-label': 'Page status', class: 'page-status' });
  const body = element('div', { class: 'page-body' });
  const root = element('main', { class: `page ${className}` }, [alert, status, body]);
  return {
    root,
    alert,
    status,
    body,
    showError: (text) => {
      if (text === null || text === '') {
        alert.hidden = true;
        clear(alert);
        return;
      }
      alert.hidden = false;
      alert.textContent = text;
    },
    setStatus: (text) => {
      status.textContent = text;
    },
    showNotFound: () => {
      alert.hidden = true;
      clear(alert);
      status.textContent = '';
      body.replaceChildren(
        element('h1', {}, ['Page not found']),
        element('p', {}, ["We couldn't find that page."])
      );
    }
  };
}

export function pending(control: HTMLButtonElement, busy: boolean): void {
  control.disabled = busy;
  if (busy) control.setAttribute('aria-busy', 'true');
  else control.removeAttribute('aria-busy');
}

export function navigate(path: string): void {
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function internalLink(name: string, path: string, attributes: Record<string, string> = {}): HTMLAnchorElement {
  const link = element('a', { href: path, ...attributes }, [name]);
  link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(path);
  });
  return link;
}
