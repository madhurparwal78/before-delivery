// The shared <dialog> of the page. It opens in the same turn as the click that asked for it (a layout effect), so an
// Escape pressed right after is never lost, and it hands focus back to the opener when it closes.
import { html, useRef, useLayoutEffect } from '../../lib/html.js';
import { openDialog } from '../../lib/dialog.js';

export function Sheet({ title, onClose, opener, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const handle = openDialog(ref.current, opener ?? undefined, onClose);
    return () => handle.close();
  }, []);
  return html`<dialog ref=${ref} aria-label=${title} class="sheet">${children}</dialog>`;
}
