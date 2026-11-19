// Plan screen shortcuts: [ and ] move the handle 5 minutes, A opens Add target. They work from any
// control except text entry, and not while a dialog is open.
const TEXT_ENTRY = new Set(['text', 'search', 'number', 'email', 'url', 'tel', 'password', 'date', 'time']);

function isTextEntry(target) {
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target.tagName === 'INPUT' && TEXT_ENTRY.has(target.type);
}

export function installShortcuts({ moveBy, openAddTarget }) {
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || isTextEntry(event.target)) return;
    if (document.querySelector('dialog[open]')) return;
    if (event.key === '[') moveBy(-5);
    else if (event.key === ']') moveBy(5);
    else if (event.key === 'a' || event.key === 'A') openAddTarget();
    else return;
    event.preventDefault();
  });
}
