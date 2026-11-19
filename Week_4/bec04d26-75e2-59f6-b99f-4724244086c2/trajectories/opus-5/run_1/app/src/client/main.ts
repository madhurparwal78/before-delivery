import { App } from './app';

const app = new App();

function sameOriginLink(target: HTMLAnchorElement): boolean {
  return target.origin === window.location.origin;
}

document.addEventListener('click', (event: MouseEvent) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
  const target = (event.target as Element | null)?.closest('a');
  if (!(target instanceof HTMLAnchorElement)) return;
  if (target.dataset.link !== 'true' || !sameOriginLink(target)) return;
  if (target.closest('[data-dragged="true"]')) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  app.navigate(target.pathname + target.search);
});

window.addEventListener('popstate', () => {
  app.state.path = window.location.pathname;
  app.state.search = window.location.search;
  app.state.notFound = false;
  app.state.openDay = null;
  app.state.bandPhase = 'closed';
  app.state.focusedDate = null;
  void app.load();
});

app.render();
void app.boot();
