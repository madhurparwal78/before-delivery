// The shared interface primitives of the Plotfold client. Everything is plain React + CSS from `styles/ui.css`; all colours and sizes come
// from `styles/tokens.css` (one working text size, square corners, sage only for `aria-pressed="true"`, `[data-active-tool]` and
// `Button primary`, no transitions).
//
// Dialog        <Dialog name onClose opener? placement? titleHidden?>children</Dialog>
//               Native <dialog> + showModal(), rendered only while open. `name` is the accessible name and the visible title
//               (`titleHidden` hides it). Initial focus: `[data-autofocus]`, else the first control. Tab / Shift+Tab wrap inside.
//               Escape calls `onClose`; on unmount focus returns to `opener` (a ref) or the element that was focused when the dialog
//               first rendered. `placement="bottom"` is the full-width bottom sheet (at most the lower 60 percent).
// Toasts        <Toasts /> once at the root: `status "Notices"`. pushToast(text) shows a toast for PLOT_TOAST_MS (setTimeout) with the
//               `toast-enter` animation (skipped under reduced motion); a toast never takes focus.
// Announcer     <Announcer /> once at the root: visually hidden `status "Drawing announcements"`. announce(text) replaces its text.
// Button        <Button primary? ...button attrs>. Square, >= 44 px on touch layouts.
// Chip          <Chip className?>: flat surface chip; `chip--group` drops the box so each control inside is its own chip.
// PanelHeader   `button "<panel name>"` with aria-expanded and a drawn chevron.
// Tabs          <Tabs label items selected onSelect>: WAI-ARIA tablist, roving tabindex, ArrowLeft/Right wrap, Home/End, automatic
//               activation. Items: {id, label, tabId?, panelId?}. Draws only the tablist.
// Frame         <Frame caption?>svg or img</Frame>: contact-sheet frame, 120 px wide with a line border; the child scales to it.
//               EmptyFrame: the empty frame drawn in code; `dimmed` is the static loading skeleton of a frame.
// Notice        <Notice tone="plain|error" ...div attrs>sentence</Notice>: plain sentence in a surface block.
// NotAvailable  <NotAvailable sentences={[...]} />: the Not available screen.
// useMediaLayout()  'phone' (< 768) | 'tablet' (768-1279) | 'desk' (>= 1280), reactive.
// animateWithId(element, keyframes, {id, duration})  element.animate with the shared ease-out curve; returns null and creates nothing
//               under reduced motion.
// CSS helper classes: `visually-hidden`, `surface` (surface block with a line border), `sheet-line` (ink stroke for drawn frames).
// CSS custom properties: tokens.css (`--ground --surface --line --line-control --ink --ink-bright --muted --accent --focus`,
// `--step-0`, `--space-1..5`, `--control` = 44 px on phone/tablet, 28 px on desk).

export { Announcer, announce } from './Announcer.tsx';
export { Button } from './Button.tsx';
export { Chip } from './Chip.tsx';
export { Dialog } from './Dialog.tsx';
export { EmptyFrame, Frame } from './Frame.tsx';
export { NotAvailable } from './NotAvailable.tsx';
export { Notice } from './Notice.tsx';
export { PanelHeader } from './PanelHeader.tsx';
export { Tabs } from './Tabs.tsx';
export { Toasts, pushToast } from './Toasts.tsx';
export { animateWithId } from './motion.ts';
export { useMediaLayout, type MediaLayout } from './useMediaLayout.ts';
