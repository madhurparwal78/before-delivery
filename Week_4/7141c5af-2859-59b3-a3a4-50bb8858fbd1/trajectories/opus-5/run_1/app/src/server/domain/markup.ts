/**
 * Pin-note markup lives in one place, shared with the browser, so every screen,
 * the client page and the PDF render a note the same way.
 */
export { escapeHtml, noteToHtml, noteToText, parseNote, type Span } from '../../shared/noteMarkup.ts';
