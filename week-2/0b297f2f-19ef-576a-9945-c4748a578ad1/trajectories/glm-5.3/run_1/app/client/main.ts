import { mountWorkspace } from './workspace.js';
import { mountLoanRegister } from './register.js';
import { mountRecordPage } from './record.js';
import { mountLenderPage } from './lender.js';

function navigate(): void {
  const root = document.getElementById('app');
  if (root === null) return;
  const path = window.location.pathname;
  if (path === '/records') {
    mountLoanRegister(root);
    return;
  }
  const recordMatch = /^\/records\/([^/]+)$/.exec(path);
  if (recordMatch !== null) {
    mountRecordPage(root, decodeURIComponent(recordMatch[1]!));
    return;
  }
  const previewMatch = /^\/p\/([^/]+)$/.exec(path);
  if (previewMatch !== null) {
    mountLenderPage(root, decodeURIComponent(previewMatch[1]!));
    return;
  }
  mountWorkspace(root);
}

document.addEventListener('DOMContentLoaded', () => {
  navigate();
  // Intercept same-origin link navigation so the app serves pages without reload.
  document.addEventListener('click', (e) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (anchor === null) return;
    const href = anchor.getAttribute('href');
    if (href === null || href.startsWith('#') || href.startsWith('http')) return;
    e.preventDefault();
    window.history.pushState({}, '', href);
    navigate();
  });
  window.addEventListener('popstate', () => {
    navigate();
  });
  window.addEventListener('hangline:navigate', () => {
    navigate();
  });
});
